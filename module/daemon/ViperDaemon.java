import android.media.audiofx.AudioEffect;
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
    private static final long RETRY_MS = 5000L;

    private ViperDaemon() {}

    public static void main(String[] args) throws InterruptedException {
        AudioEffect effect = null;
        while (true) {
            try {
                if (effect == null) {
                    effect = new AudioEffect(EFFECT_TYPE, EFFECT_UUID, 0, GLOBAL_SESSION);
                    effect.setEnabled(true);
                    System.out.println("viperd: effect created on session 0");
                } else if (!effect.getEnabled()) {
                    effect.setEnabled(true);
                    System.out.println("viperd: effect re-enabled");
                }
            } catch (Throwable t) {
                System.out.println("viperd: effect not available yet: " + t);
                if (effect != null) {
                    effect.release();
                }
                effect = null;
            }
            Thread.sleep(RETRY_MS);
        }
    }
}
