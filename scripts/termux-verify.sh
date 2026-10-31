#!/data/data/com.termux/files/usr/bin/bash
# One-time verification of the Android capabilities behind Anne's Lens's platform-bound file commands.
# Needs Termux with the Termux:API add-on: pkg install termux-api imagemagick. See docs/TERMUX-VERIFY.md.
set -u
step() { echo; echo "== $1"; echo "   expect: $2"; }
pause() { read -r -p "   press Enter for the next check " _; }
PIC=~/annes-lens-test.png
[ -f "$PIC" ] || magick -size 1080x1920 gradient:navy-orange "$PIC" 2>/dev/null || { echo "ImageMagick missing: pkg install imagemagick"; exit 1; }
termux-setup-storage 2>/dev/null || true
mkdir -p ~/storage/shared/Pictures && cp "$PIC" ~/storage/shared/Pictures/annes-lens-test.png
am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/annes-lens-test.png >/dev/null 2>&1

step "Set as Wallpaper" "the home screen shows the gradient"; termux-wallpaper -f "$PIC"; pause
step "Set as Lock Screen" "the lock screen shows the gradient"; termux-wallpaper -l -f "$PIC"; pause
step "Set as Contact Photo (ACTION_ATTACH_DATA)" "a chooser with Contacts (Set as contact photo)"; am start -a android.intent.action.ATTACH_DATA -d file:///sdcard/Pictures/annes-lens-test.png -t image/png || termux-share -a send "$PIC"; pause
step "Cast to Display" "the Cast / Screen cast settings page"; am start -a android.settings.CAST_SETTINGS || am start -a android.settings.WIFI_DISPLAY_SETTINGS; pause
step "Clipboard" "the same text back"; termux-clipboard-set "content://annes-lens/test"; termux-clipboard-get; echo; pause
step "File facts (File Properties)" "the same size from ls and MediaStore"; ls -l ~/storage/shared/Pictures/annes-lens-test.png; content query --uri content://media/external/images/media --projection _display_name:_size:date_modified --where "_display_name='annes-lens-test.png'"; pause
step "Default apps (File Associations)" "the Default apps page; then the PNG opener"; am start -a android.settings.MANAGE_DEFAULT_APPS_SETTINGS; pm resolve-activity --brief -a android.intent.action.VIEW -t image/png; pause
step "Camera capture (Scan)" "a full-resolution JPEG"; termux-camera-photo -c 0 ~/annes-lens-scan.jpg && magick identify ~/annes-lens-scan.jpg; pause
step "Import folders" "DCIM photos listed; nested folders created"; ls ~/storage/dcim/Camera 2>/dev/null | head -5; mkdir -p ~/storage/shared/Pictures/Import/2026/2026-10-30 && ls -R ~/storage/shared/Pictures/Import; pause
T=~/storage/shared/Pictures/AnnesLensTree
step "Folder tree (Next / Previous Folder)" "the tree listed; then in the app: Open Folder AnnesLensTree, Next Folder twice (extras, 2020 Wedding)"; for d in "2019 Reunion" "2019 Reunion/extras" "2020 Wedding" Empty; do mkdir -p "$T/$d"; done; cp "$PIC" "$T/2019 Reunion/a.png"; cp "$PIC" "$T/2019 Reunion/extras/b.png"; cp "$PIC" "$T/2020 Wedding/c.png"; ls -R "$T"; pause
step "AI service reachable" "401 (reachable, key needed)"; curl -sS -m 10 https://api.openai.com/v1/models -o /dev/null -w "%{http_code}\n"
step "Model download reachable" "200 6632188"; curl -sSL -m 30 -o /dev/null -w "%{http_code} %{size_download}\n" https://huggingface.co/Xenova/modnet/resolve/main/onnx/model_quantized.onnx
echo; echo "Done. Set your wallpaper back from the launcher if needed."
