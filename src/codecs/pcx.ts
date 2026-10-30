/**
 * ZSoft PCX (1, 2, 4, 8 and 24 bits; 1–4 planes; RLE; EGA and VGA palettes) and DCX, the multipage
 * container used by fax software, whose pages are PCX files.
 */
import { makeRaster, type DecodeResult, type DecodedPage } from './raster';

export function isPcx(u8: Uint8Array): boolean {
  return u8.length > 128 && u8[0] === 0x0a && [0, 2, 3, 4, 5].includes(u8[1]) && (u8[2] === 0 || u8[2] === 1) && [1, 2, 4, 8].includes(u8[3]) && u8[65] >= 1 && u8[65] <= 4;
}
export function isDcx(u8: Uint8Array): boolean {
  return u8.length > 8 && u8[0] === 0xb1 && u8[1] === 0x68 && u8[2] === 0xde && u8[3] === 0x3a;
}

export function decodePcx(u8: Uint8Array): DecodeResult {
  const warnings: string[] = [];
  if (isDcx(u8)) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const pages: DecodedPage[] = [];
    for (let i = 0; i < 1024; i++) {
      const off = dv.getUint32(4 + i * 4, true);
      if (!off) break;
      if (off >= u8.length) { warnings.push(`Page ${i + 1} lies beyond the end of the file`); break; }
      try { pages.push(decodeOne(u8.subarray(off), warnings)); } catch (e: any) { warnings.push(`Page ${i + 1}: ${e?.message || e}`); }
    }
    if (!pages.length) throw new Error(warnings[0] || 'No readable page');
    return { pages, info: { container: 'DCX' }, warnings };
  }
  if (!isPcx(u8)) throw new Error('Not a PCX file');
  return { pages: [decodeOne(u8, warnings)], info: {}, warnings };
}

const EGA_DEFAULT = [0x000000, 0x0000aa, 0x00aa00, 0x00aaaa, 0xaa0000, 0xaa00aa, 0xaa5500, 0xaaaaaa, 0x555555, 0x5555ff, 0x55ff55, 0x55ffff, 0xff5555, 0xff55ff, 0xffff55, 0xffffff];

function decodeOne(u8: Uint8Array, warnings: string[]): DecodedPage {
  if (!isPcx(u8)) throw new Error('Not a PCX page');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const version = u8[1], rle = u8[2] === 1, bpp = u8[3];
  const xmin = dv.getUint16(4, true), ymin = dv.getUint16(6, true), xmax = dv.getUint16(8, true), ymax = dv.getUint16(10, true);
  const hdpi = dv.getUint16(12, true), vdpi = dv.getUint16(14, true);
  const planes = u8[65], bytesPerLine = dv.getUint16(66, true), paletteInfo = dv.getUint16(68, true);
  const w = xmax - xmin + 1, h = ymax - ymin + 1;
  if (w <= 0 || h <= 0 || w * h > 80_000_000) throw new Error('Bad PCX dimensions');
  const scanBytes = bytesPerLine * planes;
  // Decode the RLE stream into whole scan lines.
  const lines = new Uint8Array(scanBytes * h);
  let p = 128, o = 0;
  let truncated = false;
  if (rle) {
    while (o < lines.length) {
      if (p >= u8.length) { truncated = true; break; }
      let b = u8[p++], n = 1;
      if ((b & 0xc0) === 0xc0) { n = b & 63; if (p >= u8.length) { truncated = true; break; } b = u8[p++]; }
      for (let k = 0; k < n && o < lines.length; k++) lines[o++] = b;
    }
  } else { const n = Math.min(lines.length, u8.length - 128); lines.set(u8.subarray(128, 128 + n)); o = n; p = 128 + n; truncated = n < lines.length; }
  if (truncated) warnings.push(`Pixel data is truncated at ${(o / scanBytes).toFixed(0)} of ${h} lines`);
  // Palette: VGA (256 entries after a 0x0C byte at the end), else the EGA header palette, else defaults.
  const bits = bpp * planes;
  let palette: number[] = [];
  if (bits === 8 && u8.length >= p + 769 && u8[u8.length - 769] === 0x0c) { for (let i = 0; i < 256; i++) { const q = u8.length - 768 + i * 3; palette.push((u8[q] << 16) | (u8[q + 1] << 8) | u8[q + 2]); } }
  else if (bits <= 4) {
    for (let i = 0; i < 16; i++) palette.push((u8[16 + i * 3] << 16) | (u8[17 + i * 3] << 8) | u8[18 + i * 3]);
    if (bits === 1) palette = palette[0] !== palette[1] && (palette[0] || palette[1]) && !(palette[0] === 0 && palette[1] === 0x0000aa) ? [palette[0], palette[1]] : [0x000000, 0xffffff];
    else if (palette.every((c) => c === 0) || version === 0 || (version === 2 && bits === 4 && paletteInfo === 0 && palette.slice(1).every((c) => c === 0))) palette = EGA_DEFAULT.slice();
    if (bits === 2) { // CGA: palette byte 3 of the header chooses the set (crude but adequate)
      const bg = u8[16] >> 4, set = u8[19] & 0x80 ? [0x55ffff, 0xff55ff, 0xffffff] : u8[19] & 0x40 ? [0x55ff55, 0xff5555, 0xffff55] : [0x55ffff, 0xff55ff, 0xffffff];
      palette = [EGA_DEFAULT[bg] ?? 0, ...set];
    }
  } else if (bits === 8 && planes === 1) { palette = []; for (let i = 0; i < 256; i++) palette.push((i << 16) | (i << 8) | i); warnings.push('No VGA palette at the end of the file; shown as grayscale'); }
  const out = makeRaster(w, h);
  const d = out.data;
  const gray = palette.length === 256 && palette.every((c, i) => c === ((i << 16) | (i << 8) | i));
  for (let y = 0; y < h; y++) {
    const line = y * scanBytes;
    for (let x = 0; x < w; x++) {
      const o4 = (y * w + x) * 4;
      let r: number, g: number, b: number, a = 255;
      if (bpp === 8 && planes >= 3) { r = lines[line + x]; g = lines[line + bytesPerLine + x]; b = lines[line + 2 * bytesPerLine + x]; if (planes === 4) a = lines[line + 3 * bytesPerLine + x]; }
      else if (bpp === 8) { const c = palette[lines[line + x]] ?? 0; r = c >> 16; g = (c >> 8) & 255; b = c & 255; }
      else {
        let idx = 0;
        for (let pl = 0; pl < planes; pl++) {
          const bit = x * bpp;
          const byte = lines[line + pl * bytesPerLine + (bit >> 3)];
          const v = (byte >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
          idx |= v << (pl * bpp);
        }
        const c = palette[idx] ?? 0; r = c >> 16; g = (c >> 8) & 255; b = c & 255;
      }
      d[o4] = r; d[o4 + 1] = g; d[o4 + 2] = b; d[o4 + 3] = a;
    }
  }
  let hasAlpha = false;
  if (planes === 4 && bpp === 8) { for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) { hasAlpha = true; break; } if (!hasAlpha) for (let i = 3; i < d.length; i += 4) d[i] = 255; }
  const dpi: [number, number] | undefined = hdpi > 0 && vdpi > 0 && hdpi < 10000 ? [hdpi, vdpi] : undefined;
  const notes = [`version ${version}, ${bpp} bits × ${planes} plane${planes > 1 ? 's' : ''}${rle ? ', RLE' : ''}${gray ? ', grayscale' : ''}`];
  return { width: w, height: h, frames: [{ raster: out, delay: 0 }], loops: 0, bitDepth: bits, paletteSize: bits <= 8 && !gray ? palette.length : undefined, hasAlpha, dpi, notes };
}
