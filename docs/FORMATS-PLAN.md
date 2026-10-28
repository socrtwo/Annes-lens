# File formats (plan)

Anne's Lens will open pictures from every current and historical program it can read faithfully, recognizing each file by its **content, not its extension**, the same way the other Anne's Office apps do. A misnamed file, or one with no extension, opens with the right reader, and a short note says when the content and the name disagree (*File ▸ Rename* offers the right extension).

Decoders come from three places, chosen per platform at run time:
1. **The platform's own codecs** where they are complete and fast (HEIC/HEIF and AVIF on recent Android, iOS and macOS; WIC on Windows for formats with installed codecs).
2. **The app's own readers and writers**, TypeScript or WebAssembly built from permissively licensed libraries, so every platform (including the web build) opens the same set.
3. **Optional format modules**, downloaded on request, for codecs whose size or license keeps them out of the base app. Each shows its license before download.

Fidelity tiers:
- **Full**: pixels, bit depth, transparency, color profile, metadata, pages/frames/layers as composite.
- **High**: pixels and metadata; some format features shown approximately (for example a rare compression mode decoded to 8 bits per channel).
- **Preview**: the embedded preview or a single composite, with metadata (used for formats whose full data is undocumented).
- **Identify**: the format is recognized and described, its metadata shown, and the reason it cannot be opened is explained.

## Raster formats in common use

| Format | Extensions | Detection | Open | Save | Notes |
|---|---|---|---|---|---|
| JPEG | .jpg .jpeg .jpe .jfif | `FF D8 FF` | Full | Yes | baseline, progressive, arithmetic, 12-bit, CMYK/YCCK; lossless transforms; quality estimate; MPF (multi-picture) and motion-photo containers |
| PNG / APNG | .png .apng | `89 50 4E 47` | Full | Yes | 1–16 bits, palette, gAMA/cHRM/iCCP/sRGB/cICP, text chunks, animation; optional lossless optimizer |
| GIF | .gif | `GIF87a` / `GIF89a` | Full | Yes | animation, comments, plain-text extension ignored |
| WebP | .webp | RIFF `WEBP` | Full | Yes | lossy, lossless, alpha, animation (libwebp, BSD) |
| AVIF | .avif | ISOBMFF `ftyp avif/avis` | Full | Yes | 8/10/12 bit, alpha, HDR, sequences (dav1d BSD decoder; encoder module optional) |
| HEIC / HEIF | .heic .heif .hif | ISOBMFF `ftyp heic/heix/mif1` | Full where the platform decodes it; module otherwise | Platform only | live/motion parts, depth and gain maps shown; see *Licensing* |
| JPEG XL | .jxl | `FF 0A` or ISOBMFF `JXL ` | Full | Yes | libjxl (BSD); lossless JPEG recompression and reconstruction |
| JPEG 2000 | .jp2 .j2k .jpf .jpx | `00 00 00 0C 6A 50` / `FF 4F FF 51` | High | Yes | OpenJPEG (BSD) |
| TIFF / BigTIFF | .tif .tiff | `II*\0` / `MM\0*` / BigTIFF | Full | Yes | multipage, tiles, LZW/Deflate/PackBits/JPEG/CCITT G3/G4/ZSTD, 1–32-bit and float, CMYK, Lab |
| BMP / DIB / RLE | .bmp .dib .rle | `BM` | Full | Yes | OS/2 variants, RLE4/8, bitfields, alpha |
| ICO / CUR / ANI | .ico .cur .ani | reserved/type words, RIFF `ACON` | Full | Yes (ICO, CUR) | all sizes listed as pages |
| Apple icons | .icns | `icns` | Full | Yes | |
| Photoshop | .psd .psb | `8BPS` | High (composite) | No | layers listed, composite shown; layered editing not planned |
| TGA | .tga | footer / heuristics | Full | Yes | |
| Netpbm | .pbm .pgm .ppm .pnm .pam .pfm | `P1`–`P7`, `Pf/PF` | Full | Yes | |
| QOI | .qoi | `qoif` | Full | Yes | |
| OpenEXR | .exr | `76 2F 31 01` | High | Yes | half/float, tone-mapped for display |
| Radiance HDR | .hdr .pic | `#?RADIANCE` | High | Yes | |
| DDS | .dds | `DDS ` | High | No | BCn decompression |
| SVG / SVGZ | .svg .svgz | XML root `svg` | Full (rendered) | Export (from trace) | rendered at any zoom; scripts never run |
| PDF and AI-compatible PDF | .pdf .ai | `%PDF-` | High (pages rendered by pdf.js) | Yes (Export as PDF) | pages as a multipage picture; hand-off to Anne's Folio |
| EPS / PostScript | .eps .ps | `%!PS` / DOS EPS header | Preview | No | embedded TIFF/WMF preview; full PostScript interpretation is not planned (licensing) |
| WMF / EMF | .wmf .emf | placeable header / `EMF` record | High | No | rendered by the app's own metafile renderer |
| PCX / DCX | .pcx .dcx | `0A` + version | Full | Yes | |
| XPM / XBM | .xpm .xbm | C source patterns | Full | Yes | |
| WBMP | .wbmp | heuristics | Full | Yes | |
| DjVu | .djvu .djv | `AT&TFORM` | High | No | multipage; text layer for search |
| DICOM | .dcm | `DICM` at offset 128 | High | No | window/level, multiframe; *not for diagnosis* notice |
| FITS | .fits .fit .fts | `SIMPLE  =` | High | No | astronomy; stretch for display |
| CBZ / CB7 / CBT, EPUB pictures | .cbz .cb7 .cbt .epub | ZIP/7z/TAR | Full (as a folder) | CBZ | comics and books in two-page and right-to-left views |
| CBR / RAR | .cbr .rar | `Rar!` | Identify, or Full with a module | No | only with a permissively licensed decoder; see *Licensing* |
| MPO (stereo) | .mpo | JPEG + MPF | Full | No | stereo views |
| Animated containers | .gif .apng .webp .avif .jxl | as above | Full | Yes | frame editor |
| Video and audio met while browsing | .mp4 .mov .webm .mkv .avi .mp3 .ogg … | containers | Play via the platform's decoders | No | frame grab; no editing |

## Camera RAW

| Family | Extensions | Open |
|---|---|---|
| DNG | .dng | Full (develop) and embedded preview |
| Canon, Nikon, Sony, Fujifilm, Olympus/OM, Panasonic, Pentax, Leica, Hasselblad, Phase One, Sigma, Samsung, others | .cr2 .cr3 .crw .nef .nrw .arw .srf .sr2 .raf .orf .rw2 .pef .rwl .3fr .iiq .x3f .srw … | **Preview** (embedded JPEG) in the base app; **develop** through the optional RAW module |

The base app reads every RAW file's TIFF-like structure and metadata and shows the embedded preview instantly, which is what culling needs. Full development (demosaicing, camera color matrices, highlight recovery) is an optional module because the mature open decoders are LGPL/CDDL-licensed; the module is a separate download, dynamically loaded, with its license shown (see [LEGAL.md](LEGAL.md)).

## Historical formats

| Format | Program(s) | Era | Extensions | Planned tier |
|---|---|---|---|---|
| MacPaint | MacPaint | 1984– | .mac .pntg | Full |
| PICT | QuickDraw | 1984–2009 | .pict .pct | High (bitmap opcodes; vector opcodes rendered) |
| IFF ILBM / PBM (Amiga, Deluxe Paint) | Deluxe Paint | 1985– | .iff .ilbm .lbm | Full (HAM, EHB, color cycling shown as animation) |
| Degas, NEOchrome (Atari ST) | | 1985– | .pi1–.pi3 .neo | Full |
| Koala, Doodle (Commodore 64) | | 1980s | .koa .dd | Full |
| GEM IMG | GEM/Ventura | 1985– | .img | Full |
| Sun Raster, SGI, Utah RLE | Unix workstations | 1980s–90s | .ras .sgi .rgb .rle | Full |
| Kodak Photo CD | Photo CD | 1992–2004 | .pcd | High (all resolutions) |
| FlashPix | Kodak/Microsoft | 1996– | .fpx | High |
| Paint Shop Pro | Jasc | 1990s–2000s | .psp .pspimage | Preview (composite) |
| CorelDRAW / Corel PHOTO-PAINT | Corel | 1990s– | .cdr .cpt | Preview (embedded) |
| Microsoft Paint (Windows 1–3) | Paintbrush | 1985–92 | .msp | Full |
| Windows clipboard, cursors and icon libraries | Windows 3.x | 1990s | .clp .icl | Full |
| Fax formats | fax software | 1990s | .fax .g3 .g4 .tif (Class F) | Full |
| Autodesk animation | Animator | 1990s | .fli .flc | Full (animation) |
| JBIG / JBIG2 bilevel | scanners, PDF | 1990s– | .jbg .jb2 | High |
| Wavelet and fractal oddities | various | 1990s | .wi .fif | Identify |

Formats that are proprietary and undocumented are attempted only clean-room from public information; where that is not enough, Anne's Lens identifies the file, shows any embedded preview, and explains why it cannot open the rest.

## Files from other kinds of programs

Anne's Lens recognizes documents, spreadsheets, presentations, PDFs and e-mail by content too. It offers to open them in the matching Anne's Office app when installed, or to **Extract Embedded Pictures** (`create.extractEmbedded`) from them: pictures inside .docx, .pptx, .xlsx, .odt, .odp, .epub, .pdf, .eml and .mbox files are listed as a virtual folder, opened and saved at their original quality.

## Saving

Every writable format has an options dialog (quality, chroma subsampling, progressive, compression method, bit depth, palette and dithering, transparency, color profile, which metadata to keep). **Save for Web** and **Save to Target File Size** sit on top of the same writers. When the destination format cannot hold something the picture has (alpha in JPEG, 16-bit in GIF, layers anywhere), the save dialog says what will be lost before writing.

## Licensing notes

- **HEIC/HEIF** uses HEVC, which is covered by patent pools in many countries. Anne's Lens decodes HEIC through the operating system where the system provides it (the platform vendor has the license) and offers a separate decoder module elsewhere with a notice. It does not encode HEIC itself; *Save As* offers AVIF, JPEG XL or JPEG instead.
- **RAR** decompression is available only through permissively licensed decoders; the official unRAR source license forbids building a RAR compressor and has conditions the suite avoids bundling. Without a module, .cbr/.rar files are identified, not opened.
- **Ghostscript** (AGPL) is not used; EPS and PostScript open by their embedded previews.
