/**
 * Apple icon files (.icns): every size as a page. Modern elements hold PNG (or JPEG 2000) data and are
 * decoded by the platform; classic elements (is32/il32/ih32/it32 24-bit packed RGB with s8mk/l8mk/h8mk/
 * t8mk 8-bit masks, and the 1-bit ICON/icm#/ics#/ICN# forms) are decoded here.
 */
import { makeRaster, type DecodedPage } from './raster';

export const isIcns = (u8: Uint8Array): boolean => u8.length > 8 && u8[0] === 0x69 && u8[1] === 0x63 && u8[2] === 0x6e && u8[3] === 0x73;

export interface IcnsElement { type: string; bytes: Uint8Array; size: number; png: boolean; jp2: boolean }

const RGB: Record<string, [number, string]> = { is32: [16, 's8mk'], il32: [32, 'l8mk'], ih32: [48, 'h8mk'], it32: [128, 't8mk'] };
const MONO: Record<string, [number, number]> = { ICON: [32, 0], 'ICN#': [32, 1], 'icm#': [16, 1], 'ics#': [16, 1] }; // [size, hasMask]
const SIZES: Record<string, number> = { icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024, ic11: 32, ic12: 64, ic13: 256, ic14: 512, ic04: 16, ic05: 32, icsb: 18, icsB: 36, sb24: 24, SB24: 48 };

/** Lists the elements; nested TOC and 'icnV'/'name'/'info' entries are skipped. */
export function readIcns(u8: Uint8Array): { elements: IcnsElement[]; warnings: string[] } {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const elements: IcnsElement[] = [];
  const warnings: string[] = [];
  const total = Math.min(u8.length, dv.getUint32(4) || u8.length);
  let p = 8;
  while (p + 8 <= total) {
    const type = String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
    const len = dv.getUint32(p + 4);
    if (len < 8 || p + len > u8.length) { warnings.push(`Element ${type} is truncated`); break; }
    const bytes = u8.subarray(p + 8, p + len);
    if (!['TOC ', 'icnV', 'name', 'info'].includes(type)) {
      const png = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50;
      const jp2 = bytes.length > 12 && bytes[4] === 0x6a && bytes[5] === 0x50;
      elements.push({ type, bytes, size: SIZES[type] || RGB[type]?.[0] || MONO[type]?.[0] || 0, png, jp2 });
    }
    p += len;
  }
  return { elements, warnings };
}

/** Decodes the classic (non-PNG) elements; returns a page per RGB or mono picture element. */
export function decodeIcnsClassic(elements: IcnsElement[]): { pages: DecodedPage[]; warnings: string[] } {
  const pages: DecodedPage[] = [];
  const warnings: string[] = [];
  const byType = new Map(elements.map((e) => [e.type, e]));
  for (const e of elements) {
    const rgb = RGB[e.type];
    if (rgb) {
      const [size, maskType] = rgb;
      let data = e.bytes;
      if (e.type === 'it32' && data.length > 4 && data[0] === 0 && data[1] === 0 && data[2] === 0 && data[3] === 0) data = data.subarray(4);
      const n = size * size;
      const chans = unpackIcns(data, n * 3);
      const mask = byType.get(maskType)?.bytes;
      const out = makeRaster(size, size);
      const d = out.data;
      for (let i = 0; i < n; i++) { d[i * 4] = chans[i]; d[i * 4 + 1] = chans[n + i]; d[i * 4 + 2] = chans[2 * n + i]; d[i * 4 + 3] = mask && mask.length >= n ? mask[i] : 255; }
      pages.push({ width: size, height: size, frames: [{ raster: out, delay: 0 }], loops: 0, bitDepth: 32, hasAlpha: !!mask, notes: [`${e.type} 24-bit packed${mask ? ` with ${maskType} mask` : ''}`] });
      continue;
    }
    const mono = MONO[e.type];
    if (mono) {
      const [size, hasMask] = mono;
      const stride = size / 8, n = stride * size;
      if (e.bytes.length < n) { warnings.push(`${e.type} is too short`); continue; }
      const out = makeRaster(size, size);
      const d = out.data;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const bit = (e.bytes[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1;
        const m = hasMask && e.bytes.length >= 2 * n ? (e.bytes[n + y * stride + (x >> 3)] >> (7 - (x & 7))) & 1 : 1;
        const o = (y * size + x) * 4; d[o] = d[o + 1] = d[o + 2] = bit ? 0 : 255; d[o + 3] = m ? 255 : 0;
      }
      pages.push({ width: size, height: size, frames: [{ raster: out, delay: 0 }], loops: 0, bitDepth: 1, hasAlpha: !!hasMask, notes: [`${e.type} 1-bit`] });
    }
  }
  return { pages, warnings };
}

/** The icns byte-run packing (like PackBits without the -128 no-op): 0–127 literal n+1 bytes, 128–255 repeat the next byte n−125 times. */
function unpackIcns(src: Uint8Array, n: number): Uint8Array {
  const out = new Uint8Array(n);
  if (src.length === n) { out.set(src); return out; }
  let i = 0, o = 0;
  while (i < src.length && o < n) {
    const b = src[i++];
    if (b < 128) { for (let k = 0; k <= b && i < src.length && o < n; k++) out[o++] = src[i++]; }
    else { const v = src[i++]; for (let k = 0; k < b - 125 && o < n; k++) out[o++] = v; }
  }
  return out;
}
