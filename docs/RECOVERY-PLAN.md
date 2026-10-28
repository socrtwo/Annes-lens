# Recovery plan: damaged pictures

> **Plan.** Anne's Lens has no code yet. This is the design of its recovery pipeline, the picture counterpart of the recovery engines in the sister apps, descended from the author's [Immortal Unzipper / Immortal Zip](https://socrtwo.github.io/Immortal-Zip/), [Word Recovery](https://github.com/socrtwo/wordrecovery-SF) and [Universal File Repair Tool](https://github.com/socrtwo/Universal-File-Repair-Tool) projects.

## Principles

- **Never refuse what can be shown.** A picture with damage opens with everything that can be decoded, the rest filled with a neutral gray or checkerboard, and a banner: *"This picture is damaged. 82% of it could be read. Recovery Report…"*.
- **Never write over the damaged file.** Repaired output is a new, unsaved picture; *Save* asks for a new name by default.
- **Explain.** **File ▸ Recovery Report** (`file.recoveryReport`) lists what was wrong, what each method did, and what is missing, in plain language with a technical section below.
- **Commands.** **Open and Repair** (`file.openRepair`) runs every method; ordinary *Open* runs only the cheap tolerant decoding so a damaged file never fails silently. **Recover Pictures from Any File** (`file.recoverAny`) carves pictures from arbitrary data.

## Pipeline

1. **Identify** the format from its bytes (the suite's identifier, extended with every format in [FORMATS-PLAN.md](FORMATS-PLAN.md)). Mismatched extensions are reported.
2. **Tolerant decode** with error concealment: decoders continue past bad data instead of throwing.
3. **Format-specific repair** (below).
4. **Fallbacks:** embedded previews and thumbnails (EXIF thumbnail, MPF secondary images, RAW previews, PSD composite, TIFF reduced-resolution subfiles, Photo CD base images), which often survive when the main data is gone.
5. **Carving** for containers and unknown data: scan for format signatures, validate structure, extract candidates.
6. **Report** and open the best result; other candidates appear in a *Recovered* virtual folder.

## Format-specific methods

| Format | Damage | Method |
|---|---|---|
| JPEG | truncated file (interrupted copy or download) | decode to the last complete MCU row; fill the rest; report the percentage |
| JPEG | corrupted entropy data mid-file | resynchronize at restart markers (RSTn) when present; otherwise search for plausible Huffman resync points and conceal damaged blocks from neighbors; show a damage map |
| JPEG | bad or missing headers (DQT, DHT, SOF) | rebuild standard Huffman tables; borrow quantization and frame headers from a **reference picture** from the same camera (the user picks one; the app also suggests one from the same folder with matching EXIF Make/Model and size) |
| JPEG | color shift from a damaged block onward | per-segment DC offset correction |
| PNG | bad CRCs | ignore CRCs and validate by decompression; report which chunks |
| PNG | truncated IDAT or broken zlib stream | the suite's tolerant inflater (ImmortalInflate) decodes up to the damage; remaining rows filled |
| PNG | missing IEND, junk after IEND | accepted; junk reported (it may be another file) |
| GIF | truncated animation | frames decoded until the break; LZW resync attempted for the damaged frame |
| TIFF | broken IFD chain or offsets | scan for IFD-shaped structures; rebuild strip/tile offsets from byte counts; try both byte orders |
| TIFF | multipage file with one bad page | other pages open; bad page is a placeholder |
| WebP / AVIF / HEIC / JPEG XL | truncated containers | box/chunk walker that tolerates bad sizes; decode what is complete; fall back to the thumbnail item |
| BMP | wrong size or offset fields | infer from file length and bit depth; offer row-stride guesses with previews |
| RAW | damaged main image | embedded preview extracted at full size; metadata recovered |
| PSD | damaged layer data | composite image section used; or vice versa |
| Any picture | wrong dimensions (headerless or misinterpreted) | **Open RAW Pixel Data** (`file.openRawPixels`) with live preview while adjusting width and offset; the stride finder suggests widths by autocorrelation |

## Carving (`file.recoverAny`)

Recover Pictures from Any File accepts disk images (.img, .iso, .dd), memory-card dumps, phone backups, browser and app caches, damaged ZIP/7z/TAR archives (via the suite's ZIP salvage), Office and OpenDocument files, PDFs, e-mail files, and anything else. It:

- scans for signatures of every format the app reads and validates each candidate's structure (markers, chunk lengths, box sizes, CRCs where present), so false positives are discarded before they are shown;
- for JPEG, follows the marker structure to find the true end, and recovers **fragmented** files on FAT/exFAT cards where clusters are out of order by testing candidate cluster continuations for decode continuity (bounded search with a time limit);
- groups results by type, size and EXIF date in a *Recovered* virtual folder with thumbnails, so you keep what you want with *Save Selected To…*;
- never writes to the source; for a card or drive, it asks you to make an image first or reads read-only through the platform.

## Tests

Each method arrives with a corpus of damaged files made by the project's own fault injector (truncation, bit flips, zeroed ranges, shuffled clusters, broken headers) from openly licensed originals, with expected recovery percentages checked in CI.
