import android.media.audiofx.AudioEffect;
import java.io.BufferedReader;
import java.io.FileReader;
import java.io.IOException;
import java.lang.reflect.Constructor;
import java.util.UUID;

/**
 * Keeps the ViPER global effect alive without the companion app.
 *
 * The non-AIDL driver is only loaded when an AudioEffect is created on the
 * global audio session (0). The ViPER4Android app did that. This process does
 * the same thing and holds the effect open. It has no UI.
 *
 * Started from service.sh with app_process, as root.
 */
public final class ViperDaemon {
    private static final UUID EFFECT_TYPE = UUID.fromString("ec7178ec-e5e1-4432-a3f4-4657e6795210");
    private static final UUID EFFECT_UUID = UUID.fromString("90380da3-8536-4744-a6a3-5731970e640f");
    private static final int GLOBAL_SESSION = 0;
    private static final long POLL_MS = 2000L;
    private static final String POWER_FILE = "/data/adb/viper_re/power";

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

    public static void main(String[] args) throws Exception {
        Constructor<AudioEffect> ctor = findConstructor();
        AudioEffect effect = null;
        boolean lastOn = true;
        while (true) {
            try {
                boolean on = powerOn();
                if (on != lastOn) {
                    System.out.println("viperd: power " + (on ? "on" : "off"));
                    lastOn = on;
                }
                if (effect == null) {
                    // Only load the driver while the power is on.
                    if (on) {
                        effect = ctor.newInstance(EFFECT_TYPE, EFFECT_UUID, 0, GLOBAL_SESSION);
                        effect.setEnabled(true);
                        System.out.println("viperd: effect created on session 0");
                    }
                } else if (on && !effect.getEnabled()) {
                    effect.setEnabled(true);
                    System.out.println("viperd: effect enabled");
                } else if (!on && effect.getEnabled()) {
                    effect.setEnabled(false);
                    System.out.println("viperd: effect disabled");
                }
            } catch (Throwable t) {
                System.out.println("viperd: effect not available yet: " + t);
                if (effect != null) {
                    effect.release();
                }
                effect = null;
            }
            Thread.sleep(POLL_MS);
        }
    }
}
