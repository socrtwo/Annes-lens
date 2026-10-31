# Color management

## What happens on open

- A JPEG (APP2), PNG (iCCP), WebP (ICCP) or TIFF (tag 34675) with an RGB or gray ICC profile other than sRGB keeps its own values. The platform decoder is told not to convert them (`colorSpaceConversion: 'none'`), and the page records the profile. Info notes show it as `color profile: <name>`.
- Untagged files, sRGB-tagged files, CMYK files, animations and profiles the app cannot use are decoded by the platform as before, which converts them to sRGB. Their values are treated as sRGB.
- Edits, the eyedropper, histograms and pixel readouts work on the picture's own values, in its own profile.

## Display

The viewer, navigator, loupe and Compare panes show the values through the picture's profile, converted to the sRGB canvas (relative colorimetric). The browser and the operating system then map the canvas to the monitor.

- Colors outside sRGB are clipped on screen only. The values themselves are kept.
- **View ▸ Color-Managed Display** turns this off, so you see the raw values as if they were sRGB. Use it to see what an application without color management shows.
- **Image ▸ Soft Proof** previews the picture through an output profile:
  - The profile can be RGB, gray or CMYK, built in or loaded from a file.
  - Choose a rendering intent and, optionally, black point compensation.
  - **Simulate paper color and ink black** uses absolute colorimetric from the proof profile to the screen, so the paper's tint and the press's black show.
  - **Gamut warning** paints magenta where the round trip through the printer moves a color by more than ΔE 6.
  - The picture is not changed. Run the command again to turn the proof off.

## Convert and Assign

- **Convert to Color Profile** changes the values so the colors look the same in the new profile.
  - Destinations: sRGB, Display P3, an Adobe RGB (1998)-compatible space, ProPhoto RGB (ROMM), Rec. 2020, linear sRGB, Gray Gamma 2.2, Gray Gamma 1.8, gray with the sRGB tone curve, or any RGB or gray profile file.
  - Rendering intent: perceptual, relative colorimetric, saturation or absolute colorimetric. Display (matrix) profiles convert colorimetrically whatever the intent. Profiles with A2B/B2A tables use the intent you pick.
  - Black point compensation is on by default.
  - Converting is one Undo step and covers every page.
- **Assign Color Profile** keeps the values and changes what they mean. Use it for untagged scans or mislabeled files. You can choose the profile embedded in the file, a built-in space, a profile file, or Untagged (shown as sRGB).
- CMYK profiles are refused for Convert and Assign, because the app holds pixels as RGB(A). Use them with Soft Proof.

## Save

- JPEG, PNG and WebP embed the picture's profile, even when "Keep metadata" is off, because the profile defines the colors.
- A gray profile is written as an RGB stand-in (sRGB colorants, the gray tone curve), because the encoders write three channels.
- An untagged or sRGB picture keeps an sRGB profile from the source file. Any other source profile is dropped, because the platform has already converted those values to sRGB.
- The other formats (BMP, TGA, Netpbm, QOI, WBMP) cannot carry a profile. Convert to sRGB before saving to them. The Save As dialog says so when the picture has a profile.
- Batch conversion follows the same rules.

## Profiles

- The built-in spaces are written as ICC v4 matrix-shaper (or gray TRC) profiles. Their colorants come from the published primaries and are adapted to D50 with Bradford, the way LittleCMS builds its sRGB profile.
- The reader handles:
  - ICC v2 and v4;
  - `XYZ`, `curv` and `para` (all five function types), `desc`, `mluc` and `text`;
  - `mft1`, `mft2`, `mAB ` and `mBA ` (input and output curves, matrix with offset, multilinear CLUT, legacy and v4 Lab encodings);
  - media white points for absolute colorimetric.
- Profile files loaded in a session appear in every profile list until the app closes.

## Verification

`scripts/gen-color-fixtures.py` builds two things:
- a synthetic v2 CMYK press profile (lut16 tables, Lab PCS, a yellowish paper, black at L* 14);
- LittleCMS 2 reference conversions, through Pillow's ImageCms.

The unit tests (`tests/unit/color.test.ts`) require these tolerances against LittleCMS:

| Path | Tolerance against LittleCMS |
| --- | --- |
| Display-profile conversions (sRGB to P3, Adobe RGB, ProPhoto, Rec. 2020, linear and gray, and back) | 1 level |
| CMYK press, to device values (perceptual, relative, relative + BPC) | 6 levels |
| CMYK press to sRGB (relative, absolute) | 1 level |
| Soft proof transforms (normal and paper simulation) | 3 levels |

The end-to-end test checks, in Chromium:
- tagged Adobe RGB PNG and JPEG files show the LittleCMS-predicted sRGB colors;
- the toggle, the gray and press proofs, and the gamut warning;
- Convert, Assign and Undo;
- a save that embeds Display P3 and looks the same when reopened.

To regenerate the fixtures:
```
npx vite-node scripts/write-spaces.ts
python3 scripts/gen-color-fixtures.py
```
