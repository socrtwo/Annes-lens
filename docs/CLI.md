# Command line (desktop)

The desktop app (Windows, macOS, Linux) takes options in the spirit of IrfanView's switches. Help ▸ Command-Line Help shows the same list in the app. The browser and phone apps have no command line.

```
annes-lens [options] [pictures or folders]
```

On Windows the program is `Anne's Lens.exe`; on macOS, the binary inside the app (`"/Applications/Anne's Lens.app/Contents/MacOS/Anne's Lens"`); on Linux, the AppImage or the installed `annes-lens`.

## View

| Option | What it does |
|---|---|
| `-f`, `--fullscreen` | Opens the pictures full screen. |
| `-s`, `--slideshow` | Starts a slideshow of the pictures or folders given. |

A folder opens every picture in it. When Anne's Lens is already running, files given on the command line open in that window, and the view options apply only when the program starts.

## Convert (no window)

`--convert=PATTERN` writes each input and exits. No window opens, and it runs alongside a copy that is already open.

- `*` in the pattern stands for the input's name without its extension.
- The pattern's extension picks the format: png, jpg, webp, bmp, tga, ppm, qoi or wbmp.
- Folders in the pattern are created.
- Inputs can be files or folders; for a folder, the pictures directly in it are converted.

| Option | What it does |
|---|---|
| `--resize=WxH` | Fits within W × H pixels, keeping proportions. |
| `--resize=W`, `--resize=xH` | Sets the width (or the height); the other side follows. |
| `--resize=N%` | Scales to N percent. |
| `--long=N` | Makes the long side N pixels. |
| `--shrink-only` | With `--resize` or `--long`: leaves pictures that are already small enough. |
| `--rotate=90\|180\|270\|exif` | Turns the picture clockwise by the angle, or upright by its EXIF orientation. |
| `--flip=h\|v` | Mirrors left to right (h) or top to bottom (v). |
| `--gray` | Converts to grayscale. |
| `--quality=1-100` | Sets the JPEG and WebP quality (default 90). |
| `--strip` | Leaves EXIF and XMP out of the output. A color profile is kept, because it defines the colors. |
| `--overwrite` | Replaces output files that exist. Without it, a number is added: `name (2).jpg`. |

The steps run in this order: turn, resize, gray, flip.

- Each converted picture prints one line: `input -> output (W × H, size)`.
- Failures go to standard error.
- Exit status: 0 when every picture was written, 1 when some failed, 2 for a usage error or nothing to convert.

The work is done by the same Batch engine as File ▸ Batch Convert, running in a hidden window. The decoders, the Lanczos resampling, the encoders and the metadata and color-profile handling are therefore the ones the app uses.

## Other

| Option | What it does |
|---|---|
| `-h`, `--help` | Prints the options and exits. |
| `-v`, `--version` | Prints the version and exits. |

Electron and Chromium switches (for example `--no-sandbox`) pass through unchanged.

## Examples

```sh
annes-lens --slideshow ~/Pictures/Trip
annes-lens --convert="web/*.jpg" --long=1600 --quality=85 --strip ~/Pictures/Trip
annes-lens --convert="*.png" --rotate=exif scan1.tif scan2.tif
annes-lens --convert="thumbs/*-thumb.webp" --resize=320x320 --shrink-only ~/Pictures
```

## Tests

- `tests/unit/cli.test.ts` covers parsing and the mapping onto the Batch engine.
- `xvfb-run -a npm run e2e:desktop` runs the real program: help, version, a usage error, conversions with resize, rotate and gray, the no-overwrite numbering, `--overwrite`, nothing to convert, and `--fullscreen`.
