# Verifying the platform-bound file commands on an Android device (Termux)

The commands below confirm, once, on a real device, each Android capability that the platform-bound file commands rely on. They need **Termux** and the **Termux:API** add-on (both from F-Droid; install the `termux-api` package inside Termux: `pkg install termux-api`). Give Termux the permissions it asks for the first time each tool runs. None of this is needed to use Anne's Lens; it checks the device, not the app.

Put a test picture on the device first, for example:

```sh
pkg install termux-api imagemagick
cd ~ && magick -size 1080x1920 gradient:navy-orange test.png
termux-setup-storage        # grants access to ~/storage/shared (press Allow)
cp test.png ~/storage/shared/Pictures/annes-lens-test.png
am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/annes-lens-test.png
```

Run the checks in order; each prints what to expect. The script `scripts/termux-verify.sh` runs them all with a pause between steps.

| Command in Anne's Lens | What the app does | Termux check | Expected |
|---|---|---|---|
| **Set as Wallpaper** (`file.wallpaper`) | `WallpaperManager.setBitmap(…, FLAG_SYSTEM)` with the picture rendered at the screen size (permission `SET_WALLPAPER`) | `termux-wallpaper -f ~/test.png` | The home screen shows the gradient. |
| **Set as Lock Screen** (`file.lockScreen`) | the same with `FLAG_LOCK` | `termux-wallpaper -l -f ~/test.png` | The lock screen shows the gradient (some launchers keep home and lock in sync). |
| **Set as Contact Photo** (`file.contactPhoto`) | `ACTION_ATTACH_DATA` with a `content://` URI from the app's FileProvider and MIME `image/png` | `am start -a android.intent.action.ATTACH_DATA -d file:///sdcard/Pictures/annes-lens-test.png -t image/png` (on Android 7+, use `termux-share -a send ~/test.png` and pick Contacts if the `file:` URI is refused) | A chooser lists Contacts (Set as contact photo) and the wallpaper picker; choosing Contacts asks which contact. |
| **Cast to Display** (`file.cast`) | opens `android.settings.CAST_SETTINGS` (then `WIFI_DISPLAY_SETTINGS`, then display settings) and shows the picture full screen | `am start -a android.settings.CAST_SETTINGS` | The system's Cast / Screen cast page opens and lists nearby displays (a TV, a Chromecast, Miracast). If "Activity not found", run `am start -a android.settings.WIFI_DISPLAY_SETTINGS`. |
| **Copy as File** (`file.copyAsFile`) | `ClipData.newUri(…)` with a FileProvider URI | `termux-clipboard-set "content://test"` then `termux-clipboard-get` | The text comes back unchanged (the clipboard works; `am` cannot place a URI clip, so the URI paste is checked in a file manager: in Anne's Lens run Copy as File, then paste in Files by Google or Solid Explorer). |
| **File Properties (system)** (`file.sysProperties`) | the app shows name, size, modified time and the `content://` address (Android has no system properties window) | `ls -l ~/storage/shared/Pictures/annes-lens-test.png` and `content query --uri content://media/external/images/media --projection _display_name:_size:date_modified --where "_display_name='annes-lens-test.png'"` | Both print the same size; the second shows the MediaStore row the file picker exposes. |
| **Hide Picture** (`file.hide`) | a per-folder hidden list in the app's settings; the file is not touched | `ls -la ~/storage/shared/Pictures/` before and after hiding in the app | The file is still there with the same size and date. |
| **File Associations** (`file.associations`) | opens `Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS` | `am start -a android.settings.MANAGE_DEFAULT_APPS_SETTINGS` and `pm resolve-activity --brief -a android.intent.action.VIEW -t image/png` | The Default apps page opens; the second command prints the component that opens PNG files now (after choosing Anne's Lens in Settings ▸ Apps ▸ Default apps ▸ Opening links, it prints `io.github.socrtwo.quilllens/…`). |
| **Scan…** / **Batch Scanning…** (`file.scan`, `file.batchScan`) | `ACTION_IMAGE_CAPTURE` with `EXTRA_OUTPUT` into the app's cache through the FileProvider (`<queries>` lists the action for Android 11+), then Crop Page from Photo and deskew | `termux-camera-photo -c 0 ~/scan-test.jpg && magick identify ~/scan-test.jpg` | A JPEG with the camera's full resolution; the camera permission prompt appeared once. `am start -a android.media.action.IMAGE_CAPTURE` opens the camera app itself. |
| **Import from Camera or Phone** (`file.importCamera`, `file.importRules`) | `ACTION_OPEN_DOCUMENT_TREE` for the source (DCIM) and the destination, `DocumentsContract.createDocument` with `vnd.android.document/directory` for dated subfolders | `ls ~/storage/dcim/Camera | head` and `mkdir -p ~/storage/shared/Pictures/Import/2026/2026-10-30 && ls ~/storage/shared/Pictures/Import` | DCIM lists the phone's photos; the nested folders are created (the app creates the same tree through the Storage Access Framework). |
| **Next Folder** / **Previous Folder** (`view.nextFolder`, `view.previousFolder`) | `DocumentsContract.buildChildDocumentsUriUsingTree` on the picked tree, keeping folders (`MIME_TYPE_DIR`) for `listSubfolders` and listing a folder document inside the tree with `listFolder` | `for d in "2019 Reunion" "2019 Reunion/extras" "2020 Wedding" Empty; do mkdir -p ~/storage/shared/Pictures/AnnesLensTree/"$d"; done; cp ~/test.png ~/storage/shared/Pictures/AnnesLensTree/"2019 Reunion"/a.png; cp ~/test.png ~/storage/shared/Pictures/AnnesLensTree/"2019 Reunion"/extras/b.png; cp ~/test.png ~/storage/shared/Pictures/AnnesLensTree/"2020 Wedding"/c.png; ls -R ~/storage/shared/Pictures/AnnesLensTree` | `ls` shows the tree. In Anne's Lens, Open Folder ▸ Pictures ▸ AnnesLensTree (Use this folder ▸ Allow) shows **2019 Reunion** (the picked folder has only folders). Next Folder (Ctrl+Right, or Alt+Q "next folder") shows **extras**, then **2020 Wedding**. Next Folder again says there is no folder with pictures after it (Empty is skipped). Previous Folder walks back. |
| **AI services** (`ai.*` through a hosted service) | `HttpURLConnection` from the plugin (no WebView cross-origin limits) | `curl -sS -m 10 https://api.openai.com/v1/models -o /dev/null -w "%{http_code}\n"` | `401` (reachable; a key is needed). `000` means no network path. |
| **On-device models** | ONNX Runtime Web (WebAssembly; WebGPU where the WebView has it) with models cached from huggingface.co | `curl -sSL -m 20 -o /dev/null -w "%{http_code} %{size_download}\n" https://huggingface.co/Xenova/modnet/resolve/main/onnx/model_quantized.onnx` | `200 6632188` (the smallest model downloads). |

Notes

- `am`, `pm` and `content` are the Android shell tools; in Termux they work without root on most devices. If one prints `SecurityException`, run it from `adb shell` on a computer instead.
- `termux-wallpaper`, `termux-share`, `termux-clipboard-*` and `termux-camera-photo` come from the Termux:API add-on and need the app installed, not only the package.
- Wallpaper checks change the device's wallpaper; set the old one back from the launcher afterwards.
