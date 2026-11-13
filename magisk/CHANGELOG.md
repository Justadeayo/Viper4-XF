## 1.0.0 (Viper4-XF)

Fork of ViPERFX_RE for non-AIDL devices.

### Added

- KernelSU WebUI: control the DSP without the ViPER4Android app
- Live config: the driver applies `/data/local/tmp/viper_re/params.conf` changes within about a second
- Presets saved on the device, restored at boot
- Output, playback gain, bass, clarity and tube controls

### Removed

- AIDL module, its issue template and update feed
- Dependency on the ViPER4Android companion app

## 2.1.1

### Improved

- Quadric tube simulator
- Handle file mounting for KSU (metamodule is not required since this version)

### Fixed

- Send correct dynamic system strength value to DSP
- **AIDL**: Pin AIDL lib against vendor factory `dlclose` (#32)

### App Requirements:

2.1.1+

## 2.1.2

### Added

- WebUI themes: Material, iOS liquid glass, ViPER app (classic) and Miuix, with an accent colour picker
- Accent and Monet: the Material, iOS, Miuix and ViPER app themes follow KernelSU's Monet colours when Monet is on
- Dynamic system device presets, including High-End Headphone (v1 and v2)
- Per-app attach: the effect is attached to each app as it plays

### Changed

- Settings are pushed straight to the effect, the same way the app does
- Dropdowns use themed pickers instead of native menus

## 2.1.0

### Added

- HAL type detection
- Add update.json for update checking (#21)

### Changed

- **AIDL**: Replace shared memory with control service for AIDL driver
- Dispatch raw semantic values via typed param value

### App Requirements:

2.1.0+
