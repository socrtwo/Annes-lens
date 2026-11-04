/**
 * Windows Clipboard Viewer files (.clp; Windows 3.x and NT): a directory of clipboard formats. The picture shown
 * is the best one present: a device-independent bitmap (CF_DIB, CF_DIBV5, as a BMP), an enhanced metafile
 * (CF_ENHMETAFILE), a Windows metafile (CF_METAFILEPICT, sized from its extents), or a device-dependent bitmap
 * (CF_BITMAP: 1, 24 and 32 bits; 4 and 8 bits in the standard VGA and system colors).
 */
import { makeRaster, type DecodeResult } from './raster';

const le16 = (u: Uint8Array, o: number) => u[o] | (u[o + 1] << 8);
const s16 = (u: Uint8Array, o: number) => (le16(u, o) << 16) >> 16;
const le32 = (u: Uint8Array, o: number) => (u[o] | (u[o + 1] << 8) | (u[o + 2] << 16) | (u[o + 3] << 24)) >>> 0;
export const CF_NAMES: Record<number, string> = { 1: 'text', 2: 'bitmap', 3: 'metafile', 4: 'SYLK', 5: 'DIF', 6: 'TIFF', 7: 'OEM text', 8: 'DIB', 9: 'palette', 10: 'pen data', 11: 'RIFF', 12: 'wave', 13: 'Unicode text', 14: 'enhanced metafile', 15: 'file list', 16: 'locale', 17: 'DIB v5' };

export interface ClpEntry { id: number; name: string; data: Uint8Array }
export function isClp(u8: Uint8Array): boolean {
  if (u8.length < 4) return false;
  const id = le16(u8, 0), n = le16(u8, 2);
  if (id !== 0xc350 && id !== 0xc351 && id !== 0xc352) return false;
  const per = id === 0xc350 ? 2 + 4 + 4 + 79 : 4 + 4 + 4 + 158; // an entry: format, length, offset, name
  return n > 0 && n < 512 && 4 + n * per <= u8.length;
}
export function clpEntries(u8: Uint8Array): { nt: boolean; entries: ClpEntry[] } {
  const nt = le16(u8, 0) !== 0xc350, n = le16(u8, 2), entries: ClpEntry[] = [];
  let p = 4;
  for (let i = 0; i < n; i++) {
    const id = nt ? le32(u8, p) : le16(u8, p), q = p + (nt ? 4 : 2);
    const len = le32(u8, q), off = le32(u8, q + 4), nameAt = q + 8;
    let name = '';
    if (nt) { for (let k = 0; k < 79; k++) { const c = le16(u8, nameAt + k * 2); if (!c) break; name += String.fromCharCode(c); } p = nameAt + 158; }
    else { for (let k = 0; k < 79; k++) { const c = u8[nameAt + k]; if (!c) break; name += String.fromCharCode(c); } p = nameAt + 79; }
    entries.push({ id, name: name || CF_NAMES[id] || `format ${id}`, data: u8.subarray(Math.min(off, u8.length), Math.min(off + len, u8.length)) });
  }
  return { nt, entries };
}

/** A DIB (BITMAPINFO and bits) as a BMP file. */
export function dibToBmp(dib: Uint8Array): Uint8Array {
  const hs = le32(dib, 0), bpp = hs === 12 ? le16(dib, 10) : le16(dib, 14), comp = hs >= 40 ? le32(dib, 16) : 0;
  const used = hs >= 40 ? le32(dib, 32) : 0;
  const colors = used || (bpp <= 8 ? 1 << bpp : 0);
  const masks = hs === 40 && (comp === 3 || comp === 6) ? (comp === 6 ? 16 : 12) : 0;
  const off = 14 + hs + masks + colors * (hs === 12 ? 3 : 4);
  const out = new Uint8Array(14 + dib.length);
  out[0] = 0x42; out[1] = 0x4d;
  new DataView(out.buffer).setUint32(2, out.length, true); new DataView(out.buffer).setUint32(10, off, true);
  out.set(dib, 14);
  return out;
}

/** A clipboard metafile (METAFILEPICT and a WMF without its placeable header) as a placeable WMF of the intended size. */
export function metafilePictToWmf(data: Uint8Array, nt: boolean): Uint8Array {
  const mm = nt ? le32(data, 0) | 0 : s16(data, 0), xExt = nt ? le32(data, 4) | 0 : s16(data, 2), yExt = nt ? le32(data, 8) | 0 : s16(data, 4);
  const wmf = data.subarray(nt ? 16 : 8);
  if (!((mm === 7 || mm === 8) && xExt > 0 && yExt > 0) || wmf.length < 18) return wmf;
  // The window extent (SetWindowExt) in logical units, mapped onto xExt × yExt hundredths of a millimeter.
  let p = le16(wmf, 2) * 2, wx = 0, wy = 0;
  while (p + 6 <= wmf.length) { const size = le32(wmf, p), fn = le16(wmf, p + 4); if (!size || !fn) break; if (fn === 0x020c) { wy = s16(wmf, p + 6); wx = s16(wmf, p + 8); break; } p += size * 2; }
  if (!wx || !wy) return wmf;
  const inch = Math.max(1, Math.round(Math.abs(wx) / (xExt / 2540)));
  const head = new Uint8Array(22), dv = new DataView(head.buffer);
  dv.setUint32(0, 0x9ac6cdd7, true); dv.setInt16(10, Math.abs(wx), true); dv.setInt16(12, Math.abs(wy), true); dv.setUint16(14, inch, true);
  let ck = 0; for (let i = 0; i < 10; i++) ck ^= dv.getUint16(i * 2, true); dv.setUint16(20, ck, true);
  const out = new Uint8Array(22 + wmf.length); out.set(head); out.set(wmf, 22);
  return out;
}

const VGA16 = [0x000000, 0x800000, 0x008000, 0x808000, 0x000080, 0x800080, 0x008080, 0xc0c0c0, 0x808080, 0xff0000, 0x00ff00, 0xffff00, 0x0000ff, 0xff00ff, 0x00ffff, 0xffffff];
/** A device-dependent bitmap (BITMAP header and its rows). */
export function decodeDdb(data: Uint8Array, nt: boolean): DecodeResult {
  const w = nt ? le32(data, 4) : s16(data, 2), h = nt ? le32(data, 8) : s16(data, 4), rowBytes = nt ? le32(data, 12) : s16(data, 6);
  const planes = nt ? le16(data, 16) : data[8], bpp = nt ? le16(data, 18) : data[9], start = nt ? 24 : 14;
  if (!(w > 0 && h > 0) || w * h > 200e6) throw new Error('This clipboard bitmap has an impossible size');
  const depth = bpp * planes, r = makeRaster(w, h), d = r.data, warnings: string[] = [];
  if (![1, 4, 8, 24, 32].includes(depth)) throw new Error(`Clipboard bitmaps of ${depth} bits per pixel are not supported`);
  if (depth === 4 || depth === 8) warnings.push('The bitmap\'s colors come from the display it was copied on; the standard VGA colors are used');
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const row = start + y * rowBytes, o = (y * w + x) * 4;
    let R = 0, G = 0, B = 0;
    if (depth === 1) { R = G = B = (data[row + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0; }
    else if (depth === 4 || depth === 8) { const v = depth === 4 ? (data[row + (x >> 1)] >> (x & 1 ? 0 : 4)) & 15 : data[row + x]; const c = VGA16[v & 15] ?? 0; R = c >> 16; G = (c >> 8) & 255; B = c & 255; if (depth === 8 && v > 15) R = G = B = v; }
    else { const q = row + x * (depth >> 3); B = data[q]; G = data[q + 1]; R = data[q + 2]; }
    d[o] = R; d[o + 1] = G; d[o + 2] = B; d[o + 3] = 255;
  }
  return { pages: [{ width: w, height: h, frames: [{ raster: r, delay: 0 }], loops: 0, bitDepth: depth, hasAlpha: false, notes: [`device-dependent bitmap, ${depth} bit${depth === 1 ? '' : 's'}`] }], info: {}, warnings };
}

export type ClpPicture = { kind: 'bmp' | 'emf' | 'wmf'; bytes: Uint8Array; entry: ClpEntry } | { kind: 'ddb'; entry: ClpEntry };
/** The picture to show, the best kind first. */
export function clpPicture(u8: Uint8Array): { picture: ClpPicture | null; nt: boolean; entries: ClpEntry[] } {
  const { nt, entries } = clpEntries(u8);
  const find = (id: number) => entries.find((e) => e.id === id && e.data.length > 0);
  const dib = find(17) || find(8), emf = find(14), mf = find(3), ddb = find(2);
  let picture: ClpPicture | null = null;
  if (dib) picture = { kind: 'bmp', bytes: dibToBmp(dib.data), entry: dib };
  else if (emf) picture = { kind: 'emf', bytes: emf.data, entry: emf };
  else if (mf) picture = { kind: 'wmf', bytes: metafilePictToWmf(mf.data, nt), entry: mf };
  else if (ddb) picture = { kind: 'ddb', entry: ddb };
  return { picture, nt, entries };
}
