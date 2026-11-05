# Installing Anne's Lens

Every release on the [Releases page](https://github.com/socrtwo/annes-lens/releases) carries a build for each platform, made by the release workflow from the same commit, with a `SHA256SUMS.txt` to check the files against. Prereleases (`v0.2.0`, `v0.2.0-build.N`) are what the milestones produce; they are not yet polished for everyone.

| Platform | File |
|---|---|
| Windows 10/11 | `QuillLens-<version>-windows-x64-setup.exe`, `…-windows-arm64-setup.exe`, or `…-windows-portable.exe` (no install) |
| macOS 11+ (Apple silicon and Intel) | `QuillLens-<version>-mac-universal.dmg` or `.zip` |
| Linux (x64, arm64, armv7l) | `QuillLens-<version>-linux-<arch>.AppImage` or `.deb` |
| Raspberry Pi OS | 64-bit: the `arm64` AppImage or `.deb`; 32-bit: the `armv7l` `.deb` |
| ChromeOS | the Android `.apk`, the Linux `.deb` (Linux development environment), or the web app installed from the browser |
| Android 7+ | `QuillLens-<version>.apk` (sideload) or `.aab` (Play Console) |
| iOS / iPadOS 15+ | `QuillLens-<version>-ios-unsigned.ipa` (must be signed with your own Apple ID) |
| Web | `QuillLens-<version>-web.zip` (static files for any web server) |

## Windows

Run the installer (`…-setup.exe`); it installs for the current user by default and lets you choose the folder. Windows SmartScreen may warn that the publisher is unknown, because the builds are not code-signed: choose *More info* ▸ *Run anyway*. The installer registers the picture formats Anne's Lens opens, so they appear under *Open with*.

The portable `.exe` needs no installation. To keep the settings beside the program instead of in your profile, make a folder named `QuillLens-portable` next to the `.exe` (or next to the installed program): the app then reads and writes its settings, catalog and journal there, which suits a USB stick.

## macOS

Open the `.dmg` and drag Anne's Lens to Applications. The app is signed ad hoc, not notarized, so the first launch is refused by Gatekeeper: right-click (or Control-click) the app and choose *Open*, then *Open* again in the dialog; after that it opens normally. On macOS 13 and later the same is done from *System Settings* ▸ *Privacy & Security* ▸ *Open Anyway*. The universal build runs natively on Apple silicon and on Intel Macs.

## Linux

**AppImage:** make it executable (`chmod +x QuillLens-*.AppImage`) and run it. It needs FUSE 2 (`libfuse2` on Debian and Ubuntu); without it, run with `--appimage-extract-and-run`. **Debian and Ubuntu:** `sudo apt install ./QuillLens-<version>-linux-<arch>.deb` installs the program, a desktop entry and the file associations. The `arm64` builds suit Raspberry Pi OS 64-bit and ChromeOS on ARM; `armv7l` suits Raspberry Pi OS 32-bit.

Scanning uses SANE (`scanimage`), and *Open with External Editor* and *External Tools* use the programs you name; install them with your distribution's package manager.

## Android

Download the `.apk` on the device and open it; allow installation from this source when asked (Android 8 and later ask per app, older versions have a switch under *Settings* ▸ *Security*). The app asks for access to pictures when it first opens a folder. The `.aab` is for publishing through the Play Console, not for sideloading.

On ChromeOS the `.apk` installs the same way when Android apps are enabled.

## iOS and iPadOS

Apple allows only signed apps. The `.ipa` is unsigned: sign it with your own Apple ID through a sideloading tool (Sideloadly, AltStore and similar), which installs it for 7 days at a time with a free account or for a year with a paid developer account. The app is not on the App Store yet.

## Web

Unpack the `.zip` onto any static web server. Served over HTTPS (or from `localhost`), the app installs as a web app from the browser's menu and works offline; its optional runtimes (OCR, barcode reading, the extra decoders) are in the same folder, so nothing is fetched from elsewhere. Opening local folders in the browser uses the File System Access API (Chrome, Edge, Opera); other browsers open files through the file picker and drag and drop.

## Checking a download

`sha256sum QuillLens-<file>` on Linux and macOS (`certutil -hashfile <file> SHA256` on Windows) must match the line for that file in `SHA256SUMS.txt`.

## Updating

Install the new version over the old one; settings, the catalog and the file-operation journal are kept. Portable installations: replace the program and keep the `QuillLens-portable` folder.
