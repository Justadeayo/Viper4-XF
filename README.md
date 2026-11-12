# Viper4-XF

Viper4-XF is a KernelSU/Magisk module that runs the ViPER4Android audio DSP for devices with the classic (non-AIDL) audio effect HAL. It replaces the ViPER4Android companion app with a control panel that runs inside the KernelSU manager.

The DSP is a reverse-engineered, float32 re-implementation of `libv4a_fx.so`, built from [ViPERFX_RE](https://github.com/likelikeslike/ViPERFX_RE). See [Credits](#credits).

## Features

- **No companion app.** Tune the audio from the module's WebUI in the KernelSU manager.
- **Live changes.** The driver applies new settings within about one second. No restart is needed.
- **Presets.** Save, load and delete named presets on the device. They survive reboots.
- **Low background cost.** The WebUI only runs commands when you change a control or open the page. It does not poll.

Controls in the WebUI:

| Group | Controls |
| --- | --- |
| Output | Limiter threshold, output volume, channel pan |
| Playback gain | Enable, strength, max gain, output threshold |
| Bass | Enable, mode (Natural / Pure Bass+ / Subwoofer), frequency, gain, anti-pop |
| Clarity | Enable, mode (Natural / OZone+ / XHiFi), gain |
| Tube | Enable, model, drive, mix |

The DSP includes more effects (equalizer, convolver, surround, reverb and others). They are not yet in the WebUI. See [Known limitations](#known-limitations).

## Compatibility

Viper4-XF supports **non-AIDL devices only**. Check your device before you flash. Run this in a root shell (for example Termux with `su`):

```sh
su -c 'service list | grep -i IFactory'
```

- **No output:** your device is non-AIDL. Continue with [Install](#install).
- **A line containing `android.hardware.audio.effect.IFactory`:** your device uses AIDL. The installer stops with an error, and this fork does not support it.

The result of this command decides compatibility, not the Android version number.

Tested on Pixel 8 Pro / Android 14. Other devices may bootloop, may do nothing, or may need vendor-specific changes. Back up your device before flashing.

Requirements:

- Root with KernelSU (or Magisk).
- A non-AIDL device (see above).

## Install

1. Download the zip from Releases, or [build it](#build).
2. Flash it in KernelSU (or Magisk).
3. Do not also flash ViPERFX_RE or any other ViPER module. Only one should be active.
4. Reboot.
5. Open the module's WebUI: **KernelSU → Modules → Viper4-XF → WebUI**.
6. Check the status line at the top of the WebUI. It should read **Driver active** after you play some audio. If it doesn't, see [Troubleshooting](#troubleshooting).

You do not need the ViPER4Android app. Keeping it installed alongside this module may cause conflicts.

## Using the WebUI

- Move a slider or flip a switch and the change is applied within about a second.
- **Reset all** writes the default value for every control. It does not just clear the saved file. The driver keeps the last value it received for any parameter that is missing, so the defaults have to be written explicitly.
- **Presets:** type a name (1–32 letters, digits, `-` or `_`) and press **Save** to store the current settings. Press **Load** to apply a preset. Press **Delete** to remove it.

## How it works

Viper4-XF has three parts:

1. **The driver** (`libv4a_re.so`) is the non-AIDL audio effect. It runs inside the audio server. A background thread watches `/data/local/tmp/viper_re/params.conf` once per second. When the file changes, the driver applies the new values on the audio thread, so audio is never blocked. See `src/ConfigWatcher.*`.
2. **The control script** (`bin/viperctl.sh`) writes that file. It keeps the saved state in `/data/adb/viper_re/current.conf`, stores presets in `/data/adb/viper_re/presets/`, and validates every value before writing it.
3. **The WebUI** (`webroot/`) is plain HTML, CSS and JavaScript. It calls the control script through the KernelSU `exec` API.

At boot, `service.sh` copies the saved state to the live path, so the driver starts with your last settings.

### Config file format

The config file holds the full state, one parameter per line. Lines starting with `#` are comments. Malformed lines are ignored.

```text
# <param> <type> <value>      type: b = bool, i = int, f = float
0x10160 b 1
0x10163 f 2.5
0x10161 i 2
```

You can edit the live file directly, but the WebUI overwrites it on the next change. Edit `/data/adb/viper_re/current.conf` and reboot if you want changes to persist.

## Troubleshooting

Run these in a root shell. Use `adb shell` with `su -c` if you're on a computer.

**1. Is the driver loaded?**

```sh
su -c 'logcat -d -s ViPER4Android:* | grep -E "Welcome|version|created"'
```

Expected: a `Welcome to ViPER FX` line and a `ViperContext created` line. If they're missing, the audio framework did not load the driver. Check step 2.

**2. Is the effect patched into the audio config?**

```sh
su -c 'grep -r v4a_re /vendor/etc /system/etc 2>/dev/null'
```

Expected: `v4a_re` library and `v4a_standard_re` effect lines in `audio_effects*.xml`.

**3. Is the effect registered in audioserver?**

```sh
su -c 'dumpsys media.audio_flinger | grep -E -A5 -B7 "90380da3"'
```

Expected: an effect entry with UUID `90380da3-8536-4744-a6a3-5731970e640f` and the name `ViPERDSP`.

**4. Is SELinux blocking the driver?**

```sh
su -c 'logcat -d | grep -E "avc.*denied.*(v4a|soundfx|viper)"'
```

Any denial that names the audio process and the driver library means the policy injection did not stick. A denial that names `viper_re` or `params.conf` means the audio server cannot read the config file. See [Known limitations](#known-limitations).

**5. Are settings reaching the driver?**

```sh
su -c 'cat /data/local/tmp/viper_re/params.conf'
su -c 'logcat -d -s ViPER4Android:* | grep ConfigWatcher'
```

The first command should show your settings. The second should show no `ConfigWatcher` errors. A `DSP rejected param` error means the driver does not accept that parameter ID.

When you report a bug, include the output of the logcat command above.

## Build

Prerequisites: Android NDK (set `ANDROID_NDK_HOME`), CMake, make and zip.

The DSP source is a git submodule (`ViPERDSP`, from upstream). Fetch it first:

```sh
git submodule update --init
```

Then build:

```sh
make libs   # build libv4a_re.so for arm64-v8a and armeabi-v7a
make zip    # build and package a flashable module in out/
```

The zip is named `Viper4-XF-<version>.zip`. Set `VERSION_NAME` and `VERSION_CODE` on the command line to override the defaults.

## Known limitations

- **Non-AIDL only.** AIDL devices are not supported.
- **Partial WebUI.** Only the controls listed above are exposed. Other DSP effects can be added to `webroot/app.js` by their parameter ID.
- **Config path.** The driver reads `/data/local/tmp/viper_re/params.conf`. SELinux may block the audio server from reading it on some devices. If so, change `VIPER_CONFIG_PATH` in `src/ConfigWatcher.h`, and update the paths in `module/service.sh` and `module/bin/viperctl.sh`, or add a policy rule.
- **Audio fidelity is best-effort.** The DSP is decompiled from `libv4a_fx.so`. Subtle differences from the original ViPER4Android are expected.
- **Upstream submodule.** `ViPERDSP` is fetched from upstream. 

## Credits

Viper4-XF is a fork of ViPERFX_RE and builds on work by many people:

- **Zhuhang** and **ViPER520**: original ViPER4Android.
- **Martmists**, **Iscle** and **llsl**: reverse engineering of the DSP.
- **pittvandewitt**, **MrWhite214** and **Zackptg5**: Magisk module packaging and tooling.
- Upstream projects: [ViPERFX_RE](https://github.com/likelikeslike/ViPERFX_RE) and [ViPER4Android](https://github.com/likelikeslike/ViPER4Android).

The WebUI, config watcher and control script are new in this fork.

## License

Viper4-XF is licensed under the GNU General Public License v2.0. See [LICENSE](LICENSE). This is the same license as the upstream project.

This is a reverse-engineering project. It may have legal restrictions in your jurisdiction, is not for commercial use, and is used at your own risk.
