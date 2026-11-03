# Clean-room, trademark and licensing notes

This file records how Anne's Lens will provide the complete command set of the major picture viewers while avoiding other vendors' trademarks and copyrights. It summarizes the practice the other Anne's Office apps follow; it is not legal advice. Milestone 1 is built under these rules; this file states them for the rest of the plan.

## What is reproduced, and why it is safe

- **Functionality and command names.** Viewer operations (Rotate Left, Resize/Resample, Batch Conversion, Lossless JPEG Transformations, Contact Sheet, Slideshow) are functional ideas, and their names are ordinary descriptive words used across the industry. Functionality is not protected by copyright, and descriptive terms are not trademarks for those functions.
- **Menu arrangements.** The classic menu layouts ([MENUS-PLAN.md](MENUS-PLAN.md)) reproduce how commands are *grouped* in familiar programs, so people can find them, under Anne's Lens's own labels, ordering details, tooltips and help text. Grouping commands under File, Edit, Image, Options and View is a common, functional arrangement. No menu text, dialog layout, help file or tooltip is copied.
- **Keyboard shortcuts.** Long-standing single-key conventions (O to open, R and L to rotate, Space for next) are functional conventions users rely on; all of them can be rebound.
- **File formats.** Formats are implemented from public specifications (JPEG/JFIF, PNG, GIF, TIFF 6.0, WebP, AVIF/HEIF (ISO/IEC 23008-12), JPEG XL, JPEG 2000, OpenEXR, DNG, PDF, SVG, EXIF/DCF, IPTC, XMP, ICC, C2PA) and from open-source references with permissive licenses. Undocumented formats are read only as far as public, clean-room information allows.
- **Plug-in compatibility.** Hosting Photoshop-compatible 8BF filters uses the publicly documented plug-in interface; no Adobe code is included.

## What is deliberately not reproduced

- No vendor logos, icons, splash screens, color schemes or trade dress. Command icons will be Google's Material Symbols (Apache 2.0); the app icon is original and part of the suite family.
- No vendor names in the app's own name or interface, except as the *names of menu layouts* in View ▸ Classic Menu Layout ("IrfanView style"), which identify an arrangement (nominative use), and in file-type lists to identify formats. Brand-specific feature names are replaced with generic terms:

| Vendor term | Anne's Lens term |
|---|---|
| Copy Shop (IrfanView) | Print Copies and Posters |
| I'm Feeling Lucky (Picasa) | One-Click Enhance |
| Light EQ (ACDSee) | Tone Equalizer |
| Instant Alpha (Preview) | Replace Color / Select by Color Range |
| Live Text (Apple), Lens (Google), Copy text from picture (Microsoft) | Recognize Text (OCR) |
| Visual Look Up (Apple) | Identify |
| Magic Eraser, Clean Up, Generative erase | Erase Object |
| Photo Unblur, Portrait Light | Unblur, Relight |
| Best Take, Photo Fuse | Combine Group Shots |
| Magic Editor, Reimagine, Generative Fill (as a brand) | Edit by Instruction, Generative Fill (generic description) |
| Draw Board (FastStone) | Markup Board |
| Light Table, Batch Queue Manager (digiKam) | Light Table, Batch Queue (generic) |
| Copilot and other assistant brand names | AI tab |
| Content Credentials | used as the C2PA standard's published term |

- No copied help text, sample pictures, effects presets, frames, slideshow music, transitions or icons. Effects are implemented from their mathematical descriptions; presets, frames and sounds are original or openly licensed.
- No reverse engineering of license checks or DRM; no decoding of formats whose only documentation is leaked or decompiled code.

## Nominative use

Anne's Lens's documentation names other products (IrfanView, XnView, FastStone Image Viewer, ACDSee, Windows Photo Viewer, Microsoft Photos, Windows Live Photo Gallery, Picasa, Google Photos, Preview, Apple Photos, iPhoto, digiKam, nomacs, gThumb, Geeqie, ImageGlass, Honeyview, JPEGView, FastPictureViewer, FastRawViewer, Photo Mechanic, Lightroom Classic, PhotoScape, ThumbsPlus, Graphic Workshop, LView Pro, Kodak/Wang Imaging, Photoshop and others) only to identify file formats, plug-in interfaces and menu arrangements, or to credit where an idea came from ("Batch Steps, inspired by IrfanView"). This is nominative use; it does not imply affiliation, sponsorship or endorsement. The names are trademarks of their respective owners, including:

- IrfanView is a trademark of Irfan Skiljan.
- XnView is a trademark of Pierre-Emmanuel Gougelet.
- FastStone is a trademark of FastStone Soft.
- ACDSee is a trademark of ACD Systems International Inc.
- Windows, Microsoft Photos and Windows Live are trademarks of Microsoft Corporation.
- Picasa and Google Photos are trademarks of Google LLC.
- Preview, Photos, iPhoto, Live Text and Visual Look Up are trademarks of Apple Inc.
- Photoshop and Lightroom are trademarks of Adobe Inc.
- Other names belong to their respective owners.

## Third-party components (planned)

The final list will be generated from `package.json` and the WASM build manifests into a third-party notices file at build time, as in the sister apps. Only permissive licenses are accepted in the base app:

| Component | License |
|---|---|
| libjpeg-turbo (WASM build) | IJG / BSD-3-Clause / zlib |
| libpng, zlib | libpng / zlib |
| libwebp, libjxl, dav1d, OpenJPEG | BSD |
| UTIF-style TIFF code and pako | MIT |
| pdf.js (PDF pages), with its WebAssembly decoders: OpenJPEG (JPEG 2000), PDFium's JBIG2, qcms, QuickJS | Apache 2.0; BSD-2-Clause; BSD-3-Clause; MIT; MIT |
| ONNX Runtime Web, Transformers.js | MIT, Apache 2.0 |
| tesseract.js and Tesseract | Apache 2.0 |
| SQLite (WASM) | public domain |
| Material Symbols | Apache 2.0 |
| fzstd (Zstandard decoding in TIFF) | MIT |
| world-atlas (Natural Earth country outlines for the offline map) | ISC; Natural Earth data public domain |
| OpenStreetMap map tiles (online, Browse ▸ Map) | map data © OpenStreetMap contributors, ODbL; credited on the map; tile usage policy followed (identifying User-Agent on the desktop, no bulk downloading) |
| Capacitor, Electron, electron-builder | MIT |
| On-device models | each model's own license, shown before download; permissive only (see AI-PLAN.md) |
| YuNet face detection, SFace face recognition (Browse ▸ People; OpenCV Zoo via huggingface.co/opencv) | MIT; Apache 2.0 |

**Optional modules** (separate downloads, dynamically loaded, license shown first, never required): RAW development (LibRaw, LGPL-2.1 or CDDL-1.0), HEIC decoding where the platform lacks it (libheif LGPL-3.0 with an HEVC decoder; patent notice). Their source and license texts are linked from Help ▸ About, and they can be replaced by the user, as the LGPL requires.

**Not used:** Ghostscript (AGPL), G'MIC and GIMP code (GPL), dcraw-derived GPL code, RARLAB's unRAR code (RAR and CBR archives are read by the app's own decoder, which contains none of it; Anne's Lens does not create RAR archives), non-commercial-only model weights.

## Online services

Anne's Lens works offline. Online services are called only when the user invokes the matching command: the chosen AI services (AI tab), model and format-module downloads, map tiles (Browse ▸ Map; OpenStreetMap tile usage policy respected, offline outline or another tile server selectable), Open URL, and update checks (desktop and APK builds, opt-in). The phone remote (desktop) is a server on the local network only, reachable through a random address, and stops when turned off or when the app quits. Picture metadata, including location, is stripped from anything sent to an AI service unless the command needs it.

## Test pictures

The People tests use five official White House portraits from Wikimedia Commons (Barack Obama, Joe Biden, Kamala Harris, and the 2009 and 2012 joint portraits of Obama and Biden). They are works of the United States federal government and in the public domain; `scripts/gen-people-fixtures.py` lists their sources. Face recognition runs only when the user turns People on, only on the device, and its data stays in the app's storage until Forget all faces.

The WMF and EMF test files are made by `scripts/gen-metafile-fixtures.py`: two written record by record by the script, and LibreOffice's own exports of a drawing made for the tests (`drawing.svg`). LibreOffice (MPL 2.0) is used only on the developer's machine to export those files and render the reference pictures; nothing from it ships in the app, whose metafile interpreter is its own code.

The RAR tests use archives from libarchive's test suite (BSD-2-Clause; `tests/fixtures/rar/LICENSE-libarchive`), fetched at a pinned commit by `scripts/gen-rar-fixtures.py`, which also fetches archives made with RAR 1.54 and RAR 2.50 by the rars project (Apache-2.0; `LICENSE-rars`) and one from Python rarfile's tests (ISC; `LICENSE-rarfile`), and writes two stored comic archives of its own. No RAR compressor was used to make any test file.

PPMd (used by 7z and by RAR's text compression) is the app's own implementation of Dmitry Shkarin's PPMd variant H, an algorithm he placed in the public domain. The 7z PPMd test archives are made with py7zr and pyppmd on the developer's machine; nothing from them ships in the app.
