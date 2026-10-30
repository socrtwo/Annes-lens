# Anne's Lens

*Part of the Anne's Office suite: [Anne's Pen](https://github.com/socrtwo/QuillPen) (documents), [Anne's Grid](https://github.com/socrtwo/QuillGrid) (spreadsheets), [Anne's Post](https://github.com/socrtwo/QuillPost) (email), [Anne's Stage](https://github.com/socrtwo/QuillStage) (presentations), [Anne's Loom](https://github.com/socrtwo/QuillLoom) (web sites), [Anne's Press](https://github.com/socrtwo/QuillPress) (desktop publishing), [Anne's Folio](https://github.com/socrtwo/QuillFolio) (PDF) and **Anne's Lens** (pictures).*

An original, open-source picture viewer, organizer and converter for Android, iOS, Windows, macOS, Linux, ChromeOS and the web, in the tradition of IrfanView: fast, keyboard-driven, and able to open almost anything. Its goal is the same as the rest of the Anne's Office suite: **no missing commands**. Anne's Lens gathers the commands of the major picture viewers past and present (IrfanView first, then XnView, FastStone, ACDSee, Picasa, Windows Photo Viewer and Photos, Preview and Apple Photos, Google Photos, digiKam and the open-source viewers), adds ideas of its own, and has an **AI** tab and menu for generating and editing pictures. Every feature is a command, and every command can be put on the Quick Access Bar, on your own tab, in any classic menu layout, on a keyboard shortcut, in a macro or a batch recipe, and found with command search. When a picture is damaged, Anne's Lens shows what it can recover instead of refusing to open it.

> **Status: milestone 2 in progress (0.2.0-dev) — files, formats and lossless.** The app builds for the web, Android, iOS and desktop with the same CI and release workflows as the sister apps. What works today:
>
> - **The suite shell:** command registry, ribbon, Quick Access Bar with Add All Choices, Customize Tabs and Keyboard, command search (Alt+Q), Backstage, Options, settings export/import (JSON shared with the suite, or an IrfanView-style key list), portable mode on the desktop, macros.
> - **Classic menus:** View ▸ Menus shows the ribbon, a classic menu bar or both; the bar follows the IrfanView layout by default and can follow IrfanView Thumbnails, XnView, FastStone, ACDSee, Windows Photo Viewer, Picasa, Preview, digiKam, all viewers combined, or the complete layout. Help ▸ Menu Map shows where any command lives.
> - **Viewing:** open files, folders (including Android folders through the Storage Access Framework), recent pictures, dropped or pasted pictures, and pictures handed over with *Open with* or *Share to* on every platform; next/previous through the folder with the neighbors decoded ahead of time; fit and zoom modes, pan, wheel and pinch zoom, full screen; EXIF auto-rotate; rotate and flip with undo; Picture Information, EXIF, histogram, unique colors; pixel position and color in the status bar; animated GIF/APNG/WebP playback; multipage TIFF and every size of an ICO or ICNS as pages.
> - **Formats:** JPEG, PNG, GIF, WebP, BMP, ICO/CUR, baseline TIFF, TGA, Netpbm (PBM/PGM/PPM/PAM/PFM), QOI, PCX/DCX, XPM, XBM, WBMP, Photoshop PSD/PSB composites, Apple ICNS, DDS (BC1–BC5), Radiance HDR, the embedded previews of camera RAW files (CR2, CR3, NEF, ARW, RAF, ORF, RW2, PEF, DNG and others) and of EPS files, JPEG-compressed TIFF, and ZIP/CBZ/EPUB archives as folders; HEIC, AVIF, JPEG XL and SVG where the platform decodes them. Save and Save As write PNG, JPEG, WebP, BMP, TGA, PPM/PGM/PAM, QOI and WBMP, and carry EXIF, XMP and the color profile into JPEG, PNG and WebP. Save for Web and Save to Target File Size.
> - **Lossless JPEG (Shift+J):** rotate, flip, transpose, transverse, crop at the block grid, grayscale, Huffman optimization and metadata stripping on the DCT coefficients of baseline and progressive files, without re-encoding a pixel; Lossless Auto-Rotate by EXIF; Estimate JPEG Quality.
> - **Files:** rename, move, copy, delete (to the Recycle Bin / Trash on the desktop), Quick Move and Quick Copy to nine folders (Alt+1…9, Alt+Shift+1…9), file dates, all journaled so **Undo File Operation** (Ctrl+Alt+Z) takes them back, including deleted files.
> - **Damaged pictures:** truncated or corrupt JPEG, PNG and GIF files open with everything readable (JPEGs are rebuilt from their coefficients, PNGs decoded past bad CRCs and broken zlib streams); Open and Repair reports every method tried; Recovery Report, Open as Hex (with marker, chunk and IFD landmarks), Open as Text and Open RAW Pixel Data for headerless dumps.
> - **Also:** Print, Print Setup, Print Layouts (grids, wallet, 4×6, 5×7, 8×10, contact pages), Print Copies and Posters, Print at True Size with a calibration ruler, Screen Capture, Camera Capture, Open URL, Open with External Editor, Export Palette, Export Metadata as CSV, Export as Icon, Export Animation (GIF, APNG).
> - **137 of the 557 planned commands** are built; [docs/COMMANDS.md](docs/COMMANDS.md) lists both. A command is registered only when it works.
>
> Everything else below is still the plan: see [docs/ROADMAP.md](docs/ROADMAP.md) for the milestones. Issues and discussion are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## The plan in brief

- **557 planned commands** in File, Edit, Image, Adjust, Effects, Browse, Metadata, Batch, Create, View, Slideshow, Tools, AI, Developer and Help, plus contextual Pages and Frames, RAW and Picture Tools tabs. Each command records where the idea comes from. See [docs/COMMANDS-PLAN.md](docs/COMMANDS-PLAN.md).
- **Classic menus as well as the ribbon.** View ▸ Menus switches between the suite ribbon, a classic menu bar, or both. The menu bar defaults to an **IrfanView-style** layout and can follow **IrfanView Thumbnails, XnView, FastStone, ACDSee, Windows Photo Viewer, Picasa, Preview or digiKam** arrangements, **all viewers combined**, or a **complete** layout with every command. Customize Menus edits any of them. See [docs/MENUS-PLAN.md](docs/MENUS-PLAN.md).
- **IrfanView's keys and habits:** O open, S save as, T thumbnails, W slideshow, B batch, I information, L/R rotate, H/V flip, Ctrl+R resize, Shift+G color corrections, Shift+U auto-adjust, Shift+J lossless JPEG, Ctrl+Y crop, Space and Backspace for next and previous, Enter for full screen, and portable mode. All keys can be rebound; an IrfanView-style key list can be imported.
- **Fast.** Next and previous pictures are decoded ahead of time, JPEGs at reduced scale when that is enough, RAW files by their embedded preview, and very large pictures in tiles.
- **Opens almost anything,** recognized by content rather than extension: JPEG, PNG/APNG, GIF, WebP, AVIF, HEIC, JPEG XL, JPEG 2000, TIFF, BMP, ICO/ICNS, PSD composites, TGA, EXR/HDR, SVG, PDF pages, DjVu, DICOM, FITS, camera RAW previews and development, comics and archives as folders, and dozens of historical formats from MacPaint and Amiga IFF to Kodak Photo CD. See [docs/FORMATS-PLAN.md](docs/FORMATS-PLAN.md).
- **Lossless where possible:** JPEG rotate, flip and crop on the compressed data; metadata edits without re-encoding.
- **Batch:** conversion and rename with ordered steps, saved recipes, a background queue, a dry run, and **Undo Last Batch**. File renames, moves and deletes are journaled and undoable too.
- **Organize:** thumbnails and a browser with folder tree, ratings, color labels, favorites, keywords, captions, a filter bar, an optional catalog, watch folders, timeline, map, opt-in on-device People, albums and smart albums, duplicates and similar pictures, and a **Cull Mode** for keep/reject at camera speed.
- **Edit:** selections, crop variants, resize with every common kernel, color depth and palette, color profiles, non-destructive adjustments with presets and before/after, effects, paint tools, a Markup Board, true pixel redaction.
- **Create:** contact sheets, side-by-side joins and stitched panoramas, collages, image strips, animations, multipage TIFF/PDF, web galleries, slideshow videos, focus stacks, exposure merges, icon sets.
- **AI tab and menu (optional):** generate pictures from text, sketches and references; edit by instruction; generative fill, erase objects, expand pictures, replace objects and backgrounds, relight, restyle, upscale, unblur, colorize and repair old photos; select subjects; describe, write alt text, suggest keywords, transcribe handwriting and search your pictures by content. Small models run on the device where they do the job well; a setup wizard covers local servers (ComfyUI and others) and hosted services, and **Compare Providers** sends one prompt to several services side by side. AI results carry Content Credentials. See [docs/AI-PLAN.md](docs/AI-PLAN.md).
- **For records and family history:** document cleanup, crop page from a phone photo, deskew, descreen, dust and scratch removal, faded-color restoration, OCR to Anne's Pen, source citations and person links stored with the scan, checksums and fixity reports.
- **Corrupt-file recovery:** truncated and damaged JPEG, PNG, GIF, TIFF and other files open with everything readable; embedded previews are used when the main picture is gone; **Recover Pictures from Any File** carves pictures out of disk images, caches, documents and broken archives. See [docs/RECOVERY-PLAN.md](docs/RECOVERY-PLAN.md).
- **Ideas new to picture viewers** are listed in [docs/INNOVATIONS.md](docs/INNOVATIONS.md#8-new-in-annes-lens): before/after slider and difference overlay, print at true size, privacy check before sharing, content-credentials viewer, measure with scale, color-blindness simulation, and more.

## Platforms

Each release has builds for **Android** (APK and AAB), **iOS/iPadOS** (an unsigned .ipa you sign with your Apple ID), **Windows** (installer for x64 or ARM, or portable), **macOS** (universal), **Linux** (AppImage or .deb for x64, arm64 and armv7l, which covers **Raspberry Pi OS**), **ChromeOS** (Android app, Linux app or web app) and the **web** (static files; offline-capable and installable). On Android, Anne's Lens registers for *Open with* and *Share to* on every supported picture type; the desktop apps register the picture extensions, the web app is a PWA file handler, and iOS lists the picture types. CI and release workflows match the sister apps. See [docs/ARCHITECTURE-PLAN.md](docs/ARCHITECTURE-PLAN.md) and [docs/ROADMAP.md](docs/ROADMAP.md).

## The Anne's Office suite

| App | What it is | Repository |
|---|---|---|
| **Anne's Pen** | Word processor | https://github.com/socrtwo/QuillPen |
| **Anne's Grid** | Spreadsheet | https://github.com/socrtwo/QuillGrid |
| **Anne's Post** | Email | https://github.com/socrtwo/QuillPost |
| **Anne's Stage** | Presentations | https://github.com/socrtwo/QuillStage |
| **Anne's Loom** | Web sites | https://github.com/socrtwo/QuillLoom |
| **Anne's Press** | Desktop publishing | https://github.com/socrtwo/QuillPress |
| **Anne's Folio** | PDF | https://github.com/socrtwo/QuillFolio |
| **Anne's Lens** | Pictures (this project) | https://github.com/socrtwo/Annes-lens |

The apps share one application shell: command registry, Quick Access Bar, customizable tabs and keyboard, command search, macro recorder, AI setup wizard and providers, recovery engine and platform layer. Anne's Lens sends pictures with their captions, alt text and citations to Anne's Pen, Stage, Press and Folio, OCR text to Anne's Pen, web galleries to Anne's Loom, and e-mail through Anne's Post.

## Documentation

| File | Contents |
|---|---|
| [docs/INNOVATIONS.md](docs/INNOVATIONS.md) | Survey of picture viewers and organizers, past and present, and what Anne's Lens adopts from each |
| [docs/COMMANDS-PLAN.md](docs/COMMANDS-PLAN.md) | The planned command inventory, tab by tab, with ids, shortcuts and origins (generated) |
| [docs/MENUS-PLAN.md](docs/MENUS-PLAN.md) | The classic menu layouts and the ribbon's Home tab (generated) |
| [docs/commands-plan.json](docs/commands-plan.json) | The same data as JSON; `scripts/gen-plan-ts.mjs` turns it into `src/plan.generated.ts`, which the registry, the ribbon and the classic menus are built from, and the catalog test checks the registry against it (generated) |
| [docs/COMMANDS.md](docs/COMMANDS.md) | What is built so far and what is still planned, from the live registry (generated by `npm run catalog`) |
| [docs/QAT.md](docs/QAT.md) | The Quick Access Bar plan |
| [docs/AI-PLAN.md](docs/AI-PLAN.md) | The AI tab: services, on-device models, provenance, privacy and limits |
| [docs/FORMATS-PLAN.md](docs/FORMATS-PLAN.md) | Every format to open and save, current and historical, with fidelity and licensing notes |
| [docs/RECOVERY-PLAN.md](docs/RECOVERY-PLAN.md) | Damaged-picture repair and carving |
| [docs/ARCHITECTURE-PLAN.md](docs/ARCHITECTURE-PLAN.md) | Intended architecture: shell, picture pipeline, codecs, catalog, menus, security, builds |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Milestones |
| [docs/ENSEMBLE.md](docs/ENSEMBLE.md) | Several AIs on one request: master synthesis or Quaker consensus |
| [docs/LEGAL.md](docs/LEGAL.md) | Clean-room, trademark and licensing notes |

The command and menu plans are generated: edit [docs/commands-plan.src.txt](docs/commands-plan.src.txt) or [docs/menus-plan.src.txt](docs/menus-plan.src.txt) and run `npm run plan` (`python3 scripts/gen-plan.py`, which checks ids, menu references and shortcut conflicts, then `node scripts/gen-plan-ts.mjs`).

## Building

```bash
npm ci
npm run dev        # web app at http://localhost:5173
npm run typecheck
npm test           # unit tests (vitest): codecs, EXIF, settings, the catalog against the plan
npm run build      # dist/ (PWA)
npm run e2e        # browser smoke test against dist/ (Playwright)
npm run desktop    # Electron app from dist/
npm run android:build   # APK (Android SDK required); scripts/termux-build.sh builds on a phone
```

The release workflow (`.github/workflows/release.yml`) builds every platform from a `v*` tag, a manual run or a `[release]` commit.

## Project language

The interface, code comments and documentation use American English.

## License

[MIT](LICENSE). Copyright (c) 2026 Paul D Pruitt.

## Legal

Anne's Lens is an independent, clean-room project released under the MIT License. It is not affiliated with, endorsed by, or sponsored by Irfan Skiljan, the makers of XnView, FastStone, ACDSee, Picasa, Photos, Preview or digiKam, any AI provider, or any other vendor. Product names appear only to describe file-format compatibility, the arrangement a classic menu layout follows, or the origin of an idea (nominative use). IrfanView is a trademark of Irfan Skiljan; other names belong to their owners. The interface, icons, effects presets and text will be original or openly licensed. See [docs/LEGAL.md](docs/LEGAL.md).
