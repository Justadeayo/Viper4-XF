# Viper4-XF (fork of ViPERFX_RE)

A reverse-engineered, modernized port of ViPER4Android. The DSP has been re-implemented from a decompilation of the original `libv4a_fx.so`, with audio processed in float32, dead code removed, and dependencies refreshed.

If you want ViPER on desktop instead of Android, see:

- [ViPER4Windows](https://github.com/likelikeslike/ViPER4Windows)
- [ViPER4Mac](https://github.com/likelikeslike/ViPER4Mac)

## Module Architecture

ViPERFX_RE ships as **two separate Magisk modules**, both built around the same DSP engine (`ViPERDSP`) but integrated through different Android audio HAL interfaces. They are not interchangeable: each module is designed for a specific generation of Android’s audio framework. Installing the wrong one may either do nothing or cause boot issues.

### Non-AIDL (Legacy) Module

The non-AIDL module uses the **classic Android audio effect plugin interface** (often informally referred to as the “HIDL-based” path due to its association with the older audio HAL stack).

- **Why it no longer works on Android 15+:** Google has migrated the audio effect framework from the legacy C-based plugin model to a stable AIDL HAL implementation. Devices launching with Android 15 no longer support loading `effect_handle_t` plugins, as the old framework path has been removed entirely. See [AIDL for HALs](https://source.android.com/docs/core/architecture/aidl/aidl-hals) for more details.

### AIDL Module

The AIDL module implements the **modern audio effect HAL** introduced in Android 13, which became the only officially supported audio effect path for devices launching with Android 15 and later.

### Which module should you install?

Run the following command:

```bash
adb shell ps -A | grep "audio.*aidl"
adb shell su -c 'service list | grep -i IFactory'
```

If your see any process related to audio HAL with "aidl" and the following output, you need the AIDL module. If not, the non-AIDL module should work.

```shell
... android.hardware.audio.effect.IFactory/default: [android.hardware.audio.effect.IFactory]
```

## Built-in WebUI (no companion app)

The non-AIDL module ships a control panel in `webroot/`. Open it from the KernelSU manager (module → open WebUI). It sets the effect parameters directly, so the ViPER4Android app is not needed.

How it works:

- The DSP driver watches `/data/local/tmp/viper_re/params.conf` and applies changes within about one second. It runs on its own thread and hands updates to the audio thread without blocking it.
- `bin/viperctl.sh` writes that file. It keeps the saved state in `/data/adb/viper_re/current.conf`, restores it at boot, and manages presets in `/data/adb/viper_re/presets/`.
- The WebUI polls nothing. It only runs commands when you change a control or open the page, so it adds no background load.

Config file format, one parameter per line (`#` starts a comment):

```text
<param> <type> <value>      # type: b = bool, i = int, f = float
0x10160 b 1
0x10163 f 2.5
```

Controls currently exposed: output limiter, playback gain, bass, clarity and tube. The file accepts any parameter ID the driver supports, so more controls can be added to `webroot/app.js` without changing the driver.

> [!IMPORTANT]
> Confirm that `audioserver` can read `/data/local/tmp/viper_re/params.conf` on your device. SELinux may block it. If it does, change `VIPER_CONFIG_PATH` in `src/ConfigWatcher.h` and the paths in `module/service.sh` and `module/bin/viperctl.sh` to a location the audio process can read, or add a policy rule. Check the driver log with `adb logcat -s ViPER4Android:*` for a "ConfigWatcher" error.

## Disclaimers

- **Tested hardware is narrow.** Non-AIDL is confirmed on Pixel 8 Pro / Android 14. AIDL is confirmed on Pixel 8 Pro / Android 16. Other devices may bootloop, may need vendor-specific shims (e.g. ShadoV's [PIXAML](https://github.com/ShadoV90/PIXAML) for AIDL on some Pixels), or may simply do nothing. Make a backup before flashing.
- **Audio fidelity is best-effort.** The DSP is decompiled from `libv4a_fx.so`. Subtle deviations from the original ViPER4Android are expected. If you spot one, please open a PR — the source is here precisely so it can be improved.
- **Not for commercial use.** This is a reverse-engineering project and may carry legal restrictions in your jurisdiction. Use at your own risk.

## Installation

1. Download the **module zip matching your device** (non-AIDL vs. AIDL — see [Which module should you install?](#which-module-should-you-install)) from the [Releases page](https://github.com/likelikeslike/ViPERFX_RE/releases), and the [ViPER4Android app](https://github.com/likelikeslike/ViPER4Android).
2. Flash the Magisk module. **Do not flash both modules.**
3. Install the app.
4. Reboot. Open the app and verify effects are applied (use any of the diagnostic commands below to confirm).

### Self-mounting behavior

Under KernelSU and APatch, both modules ship `skip_mount` and `skip_mountify`, so the manager or metamodule does not mount their `system` trees. Each module instead bind-mounts its driver libraries and patched audio-effect configuration from its own module directory during `service.sh`. Under Magisk, the markers are removed and Magisk mounts the module tree normally.

This behavior is compatible with Magisk, KernelSU, APatch, Hybrid Mount, Magic Mount RS, Magic Mount, meta-overlayfs, and Mountify.

## Troubleshooting

> [!NOTE]
> Both modules mount the driver `.so` and the `audio_effects*.xml` config into `/vendor` (and `/system` where present). This is verified with **MagiskSU** and **KernelSU Next**. The AIDL module is confirmed not compatible with **AudioModificationLibrary**, so disable it if you want to use AIDL module.

> [!IMPORTANT]
> When opening an issue, capture the relevant logs _while reproducing the problem_ and attach them. The commands below are listed in the order you should run them when troubleshooting. Run the section that matches your module.

### Log Tags

Both drivers (and the shared DSP) log under a single tag, **`ViPER4Android`**. The `AHAL_*` tags come from the AOSP AIDL effect framework and appear only on the AIDL path.

| Tag                  | Module    | Level   |
| -------------------- | --------- | ------- |
| `ViPER`              | both      | D/I/E   |
| `AHAL_EffectImpl`    | AIDL only | D/I/V/E |
| `AHAL_EffectContext` | AIDL only | E       |
| `AHAL_EffectThread`  | AIDL only | V       |

### Non-AIDL (Legacy)

The non-AIDL driver is `libv4a_re.so`. It receives parameters over the classic `effect_param_t` command interface.

#### 1. Check if the driver is loaded

```bash
adb logcat -d -s 'ViPER4Android:*' | grep -E 'Welcome|version|created'
```

Expected (the version line must match the module you flashed):

```bash
ViPER4Android: Welcome to ViPER FX
ViPER4Android: Current version is ...
ViPER4Android: ViperContext created
```

If missing, the audio framework never loaded the `.so`. Verify the config was patched (`audio_effects.xml` under `/vendor/etc` and/or `/system/etc`):

```bash
adb shell su -c 'grep -r v4a /vendor/etc /system/etc 2>/dev/null'
```

Expected:

```bash
/vendor/etc/audio_effects.xml:        <library name="v4a_re" path="libv4a_re.so"/>
/vendor/etc/audio_effects.xml:        <effect name="v4a_standard_re" library="v4a_re" uuid="90380da3-8536-4744-a6a3-5731970e640f"/>
/system/etc/audio_effects.xml:        <library name="v4a_re" path="libv4a_re.so"/>
/system/etc/audio_effects.xml:        <effect name="v4a_standard_re" library="v4a_re" uuid="90380da3-8536-4744-a6a3-5731970e640f"/>
```

Then verify the SELinux label on the library itself:

```bash
adb shell su -c 'ls -Z /vendor/lib*/soundfx/libv4a_re.so'
```

Expected:

```bash
u:object_r:vendor_file:s0 /vendor/lib/soundfx/libv4a_re.so
u:object_r:vendor_file:s0 /vendor/lib64/soundfx/libv4a_re.so
```

#### 2. Dump the audioserver effect list

```bash
adb shell su -c 'dumpsys media.audio_flinger | grep -E -A5 -B7 "90380da3"'
```

Expected:

```bash
1 effects for session 0
    In buffer                         Out buffer                           Active tracks:
    0xb40000718d612da0 -> 0x72579a1000   0x72579a1000 -> 0xb40000718d612da0   0
    Effect ID 11:
        Session State Registered Internal Enabled Suspended:
        00000   002   y          n        y       n
        Descriptor:
        - UUID: 90380da3-8536-4744-a6a3-5731970e640f
        - TYPE: ec7178ec-e5e1-4432-a3f4-4657e6795210
        - apiVersion: 00000000
        - flags: 00005010 (conn. mode: insert, insert pref: last, volume mgmt: none, input mode: direct, output mode: direct)
        - name: ViPERDSP
        - implementor: viper.WYF, Martmists, Iscle, llsl
```

#### 3. Check SELinux denials

```bash
adb logcat -d -s audit | grep v4a
# or, broader:
adb logcat -d | grep -E 'avc.*denied.*(v4a|soundfx)'
```

If you see `avc: denied` lines naming the audio process and the driver `.so`, the live policy injection from `post-fs-data.sh` did not stick. This is the single most common cause of "module installs cleanly but audio is unprocessed." The legacy effect runs inside `audioserver` (or the legacy audio HAL), not the AIDL service.

### AIDL

The AIDL driver is `libv4a_aidl.so`. It publishes a binder service, **`viper.control`**, when the audio HAL loads it, the app sends all parameters, DDC/convolver data, and status requests over that service.

#### 1. Check if the AIDL driver is loaded and the service is registered

```bash
adb logcat -d -s 'ViPER:*' | grep -E 'Welcome|version|AServiceManager|context created'
```

Expected (the version line must match the module you flashed; the `addService -> 0` line must be present):

```bash
ViPER: Welcome to ViPER FX
ViPER: Current version is ...
ViPER: Ctrl: AServiceManager_addService viper.control -> 0
ViPER: ViPER (AIDL) context created, sample_rate=...
```

Confirm the service is published:

```bash
adb shell su -c 'service list | grep -i viper'
```

Expected:

```bash
... viper.control: [viper.fx.IViperControl]
```

If `Welcome to ViPER FX` is missing, the audio framework never loaded the `.so`. Verify the config was patched:

```bash
adb shell su -c 'grep v4a /vendor/etc/audio_effects_config.xml'
```

Expected:

```bash
<library name="v4a_aidl" path="libv4a_aidl.so"/>
<effect name="v4a_standard_aidl" library="v4a_aidl" uuid="90380da3-8536-4744-a6a3-5731970e640f" type="7261676f-6d75-7369-6364-28e2fd3ac39e"/>
```

Then verify the SELinux label on the library itself:

```bash
adb shell su -c 'ls -Z /vendor/lib*/soundfx/libv4a_aidl.so'
```

Expected:

```bash
u:object_r:vendor_file:s0 /vendor/lib/soundfx/libv4a_aidl.so
u:object_r:vendor_file:s0 /vendor/lib64/soundfx/libv4a_aidl.so
```

#### 2. Dump the audioserver effect list

```bash
adb shell su -c 'dumpsys media.audio_flinger | grep -E -A5 -B7 "90380da3"'
```

Expected:

```bash
1 effects for session 0
    In buffer                               Out buffer                                 Active tracks:
    0xb40000778e915020 -> 0xb40000778e959220   0xb40000778e959220 -> 0xb40000778e915020   0
    Effect ID 1035:
        Session State Registered Internal Enabled Suspended:
        00000   003   y          n        y       n
        Descriptor:
        - UUID: 90380da3-8536-4744-a6a3-5731970e640f
        - TYPE: 7261676f-6d75-7369-6364-28e2fd3ac39e
        - apiVersion: 00020000
        - flags: 00410208 (conn. mode: insert, insert pref: first, volume mgmt: none, device indication: requires updates, input mode: not set, output mode: not set, hardware acceleration: non-tunneled, offloadable)
        - name: ViPER4Android
        - implementor: ViPER520 / RE Team
```

#### 3. Check the binder service SELinux declaration

`viper.control` must be declared as a typed service and permitted by policy, otherwise registration or the app's `find` is silently denied.

```bash
adb shell su -c 'grep -i viper /vendor/etc/selinux/vendor_service_contexts'
```

Expected:

```bash
viper.control    u:object_r:viper_control_service:s0
```

Check for denials while toggling the master switch or dragging a slider in the app:

```bash
adb logcat -d -s audit | grep -iE 'viper.control|service_manager'
# or, broader:
adb shell su -c 'dmesg | grep -iE "avc.*viper.control"'
```

Expected: **no output.** Common denials and what they mean:

- `denied { add } ... name=viper.control ... tclass=service_manager`: the HAL could not register the service
- `denied { find } ... name=viper.control scontext=u:r:untrusted_app ...`: the app could not look up the service

#### 4. Filter logcat by the audio HAL process

```bash
# Find the audio HAL process name (device-specific)
adb shell ps -A | grep audio
```

Expected (Pixel 8 Pro):

```bash
audioserver   ...  S android.hardware.audio.service-aidl.aoc
audioserver   ...  S audioserver
```

Then filter logcat by the HAL PID:

```bash
adb logcat --pid=$(adb shell pidof android.hardware.audio.service-aidl.aoc | tr -d '\r') -s 'ViPER:*' 'AHAL_EffectImpl:*'
```

**The HAL process name is device-specific.**

## Building

Prerequisites: Android NDK, CMake, Make. Set `ANDROID_NDK_HOME` (or `ANDROID_NDK_ROOT`).

```bash
make libs   # build libv4a_re.so for arm64-v8a and armeabi-v7a
make zip    # build + package a flashable Magisk module zip
```

## Credits

- Zhuhang and ViPER520 — original ViPER4Android.
- Martmists, Iscle, llsl — reverse-engineering of the DSP.

## Credits

Viper4-XF is a fork of ViPERFX_RE and builds on work by many people:

- **Zhuhang** and **ViPER520**: original ViPER4Android.
- **Martmists**, **Iscle**, **llsl**: reverse engineering of the DSP.
- **pittvandewitt**, **MrWhite214**, **Zackptg5**: Magisk module packaging and tooling.
- Upstream projects: [ViPERFX_RE](https://github.com/likelikeslike/ViPERFX_RE), [ViPER4Android](https://github.com/likelikeslike/ViPER4Android).

The WebUI control layer (`module/webroot`, `module/bin`, `src/ConfigWatcher.*`) is new in this fork.

## License

Viper4-XF is licensed under the GNU General Public License v2.0 (see [LICENSE](LICENSE)), the same license as the upstream project.
