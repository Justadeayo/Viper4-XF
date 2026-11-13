import android.media.audiofx.AudioEffect;
import java.io.BufferedReader;
import java.io.FileReader;
import java.io.IOException;
import java.io.File;
import java.io.InputStreamReader;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.List;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Attaches the ViPER effect to every app that is playing audio, the same way
 * the ViPER4Android app does in its default per-app mode.
 *
 * Every poll it reads "dumpsys audio" as root to find active playback
 * sessions, creates one effect per session, and releases it when playback
 * stops. The driver loads on the first effect and processes audio for each
 * session. It has no UI.
 *
 * The power file controls whether anything is attached. When it says "off",
 * all effects are released.
 *
 * Started from service.sh with app_process, as root.
 */
public final class ViperDaemon {
    private static final UUID EFFECT_TYPE = UUID.fromString("ec7178ec-e5e1-4432-a3f4-4657e6795210");
    private static final UUID EFFECT_UUID = UUID.fromString("90380da3-8536-4744-a6a3-5731970e640f");
    private static final long POLL_MS = 2000L;
    private static final String POWER_FILE = "/data/adb/viper_re/power";
    private static final String PARAMS_FILE = "/data/local/tmp/viper_re/params.conf";

    // Payload types, matching ViperParamPayload in the app.
    private static final int TYPE_BOOL = 1;
    private static final int TYPE_INT = 2;
    private static final int TYPE_FLOAT = 3;
    private static final int NO_INDEX = -1;

    private static final class Param {
        final int id;
        final char type;
        final double value;

        Param(int id, char type, double value) {
            this.id = id;
            this.type = type;
            this.value = value;
        }
    }

    private static final Pattern PIID = Pattern.compile("piid:(\\d+)");
    private static final Pattern SESSION = Pattern.compile("session(?:Id)?:(\\d+)");

    // The public SDK only exposes a no-arg AudioEffect constructor. The
    // (type, uuid, priority, session) constructor is hidden, so it is reached
    // by reflection, the same way the ViPER4Android app does it.
    private static Constructor<AudioEffect> findConstructor() throws NoSuchMethodException {
        return AudioEffect.class.getConstructor(UUID.class, UUID.class, int.class, int.class);
    }

    private ViperDaemon() {}

    // The WebUI power button writes "on" or "off" here. A missing file means on.
    private static boolean powerOn() {
        try (BufferedReader r = new BufferedReader(new FileReader(POWER_FILE))) {
            String line = r.readLine();
            return line == null || !"off".equals(line.trim());
        } catch (IOException e) {
            return true;
        }
    }

    // Returns the session ids of players that are currently playing, or null
    // if dumpsys could not be read this round.
    private static Set<Integer> activeSessions() {
        try {
            Process p = new ProcessBuilder("sh", "-c", "dumpsys audio | grep -E 'state:started|new player'")
                .redirectErrorStream(true)
                .start();
            Map<Integer, Integer> piidToSession = new HashMap<>();
            Set<Integer> activePiids = new HashSet<>();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream()))) {
                String line;
                while ((line = r.readLine()) != null) {
                    String trimmed = line.trim();
                    Integer piid = firstInt(PIID, trimmed);
                    if (piid == null) continue;
                    Integer sid = firstInt(SESSION, trimmed);
                    if (sid != null && sid > 0) piidToSession.put(piid, sid);
                    if (trimmed.contains("state:started")) activePiids.add(piid);
                }
            }
            if (!p.waitFor(5, java.util.concurrent.TimeUnit.SECONDS)) {
                p.destroyForcibly();
                return null;
            }
            Set<Integer> sessions = new HashSet<>();
            for (int piid : activePiids) {
                Integer sid = piidToSession.get(piid);
                if (sid != null) sessions.add(sid);
            }
            return sessions;
        } catch (Exception e) {
            System.out.println("viperd: dumpsys failed: " + e);
            return null;
        }
    }

    private static Integer firstInt(Pattern pattern, String text) {
        Matcher m = pattern.matcher(text);
        if (!m.find()) return null;
        try {
            return Integer.valueOf(m.group(1));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    // Returns the whole params file as text, or "" if it cannot be read.
    private static String readText() {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new FileReader(PARAMS_FILE))) {
            String line;
            while ((line = r.readLine()) != null) sb.append(line).append('\n');
        } catch (IOException e) {
            return "";
        }
        return sb.toString();
    }

    private static List<Param> parseParams(String text) {
        List<Param> out = new ArrayList<>();
        {
            for (String line : text.split("\n")) {
                String[] parts = line.trim().split("\\s+");
                if (parts.length < 3 || parts[0].startsWith("#")) continue;
                try {
                    int id = Integer.decode(parts[0]);
                    char type = parts[1].charAt(0);
                    if (type != 'b' && type != 'i' && type != 'f') continue;
                    out.add(new Param(id, type, Double.parseDouble(parts[2])));
                } catch (RuntimeException e) {
                    System.out.println("viperd: bad param line ignored: " + line);
                }
            }
        }
        return out;
    }

    // setParameter(byte[], byte[]) is hidden in the public SDK, like the
    // constructor above, so it is also reached by reflection.
    private static Method findSetParameter() throws NoSuchMethodException {
        return AudioEffect.class.getMethod("setParameter", byte[].class, byte[].class);
    }

    private static int setParameter(Method m, AudioEffect fx, byte[] param, byte[] value) throws Exception {
        return (Integer) m.invoke(fx, param, value);
    }

    private static byte[] le(int... values) {
        ByteBuffer b = ByteBuffer.allocate(values.length * 4).order(ByteOrder.LITTLE_ENDIAN);
        for (int v : values) b.putInt(v);
        return b.array();
    }

    private static byte[] payload(Param p) {
        if (p.type == 'b') {
            ByteBuffer b = ByteBuffer.allocate(12 + 1).order(ByteOrder.LITTLE_ENDIAN);
            b.putInt(TYPE_BOOL).putInt(NO_INDEX).putInt(1).put((byte) (p.value != 0.0 ? 1 : 0));
            return b.array();
        }
        if (p.type == 'i') {
            ByteBuffer b = ByteBuffer.allocate(12 + 4).order(ByteOrder.LITTLE_ENDIAN);
            b.putInt(TYPE_INT).putInt(NO_INDEX).putInt(1).putInt((int) p.value);
            return b.array();
        }
        ByteBuffer b = ByteBuffer.allocate(12 + 4).order(ByteOrder.LITTLE_ENDIAN);
        b.putInt(TYPE_FLOAT).putInt(NO_INDEX).putInt(1).putFloat((float) p.value);
        return b.array();
    }

    // Same call the app makes: effect.setParameter(paramId, typedPayload).
    private static void pushAll(Method setParam, AudioEffect fx, List<Param> params) {
        int ok = 0;
        for (Param p : params) {
            try {
                if (setParameter(setParam, fx, le(p.id), payload(p)) == AudioEffect.SUCCESS) ok++;
            } catch (Exception e) {
                System.out.println("viperd: setParameter 0x" + Integer.toHexString(p.id) + " failed: " + e);
            }
        }
        System.out.println("viperd: pushed " + ok + " of " + params.size() + " params");
    }

    public static void main(String[] args) throws Exception {
        Constructor<AudioEffect> ctor = findConstructor();
        Map<Integer, AudioEffect> open = new HashMap<>();
        boolean lastOn = true;
        String lastParamsText = null;
        Method setParam = findSetParameter();
        List<Param> params = new ArrayList<>();

        while (true) {
            try {
                boolean on = powerOn();
                if (on != lastOn) {
                    System.out.println("viperd: power " + (on ? "on" : "off"));
                    lastOn = on;
                }

                Set<Integer> active = on ? activeSessions() : Collections.<Integer>emptySet();
                if (active != null) {
                    Iterator<Map.Entry<Integer, AudioEffect>> it = open.entrySet().iterator();
                    while (it.hasNext()) {
                        Map.Entry<Integer, AudioEffect> e = it.next();
                        if (!active.contains(e.getKey())) {
                            e.getValue().setEnabled(false);
                            e.getValue().release();
                            it.remove();
                            System.out.println("viperd: session " + e.getKey() + " closed");
                        }
                    }
                    for (int sid : active) {
                        if (open.containsKey(sid)) continue;
                        try {
                            AudioEffect fx = ctor.newInstance(EFFECT_TYPE, EFFECT_UUID, 0, sid);
                            fx.setEnabled(true);
                            pushAll(setParam, fx, params);
                            open.put(sid, fx);
                            System.out.println("viperd: session " + sid + " opened");
                        } catch (Throwable t) {
                            System.out.println("viperd: session " + sid + " failed: " + t);
                        }
                    }
                }

                // Push values whenever the params file changes, to every open session.
                // Compare contents, not timestamps, so unrelated file touches do not re-push.
                String text = readText();
                if (!text.equals(lastParamsText)) {
                    lastParamsText = text;
                    params = parseParams(text);
                    for (AudioEffect fx : open.values()) pushAll(setParam, fx, params);
                }

                for (AudioEffect fx : open.values()) {
                    if (on && !fx.getEnabled()) fx.setEnabled(true);
                }
            } catch (Throwable t) {
                System.out.println("viperd: error: " + t);
            }
            Thread.sleep(POLL_MS);
        }
    }
}
