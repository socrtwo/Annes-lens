/** Wireless Bitmap (WBMP type 0): 1-bit pictures from WAP phones. Reader and writer. */
import { makeRaster, type DecodeResult, type Raster } from './raster';

function uintvar(u8: Uint8Array, p: number): [number, number] {
  let v = 0;
  for (let i = 0; i < 5 && p < u8.length; i++) { const b = u8[p++]; v = (v << 7) | (b & 127); if (!(b & 128)) return [v, p]; }
  return [-1, p];
}

export function isWbmp(u8: Uint8Array, name = ''): boolean {
  if (u8.length < 4 || u8[0] !== 0 || u8[1] !== 0) return false;
  const [w, p1] = uintvar(u8, 2); const [h, p2] = uintvar(u8, p1);
  if (w <= 0 || h <= 0 || w > 65535 || h > 65535) return false;
  const need = p2 + Math.ceil(w / 8) * h;
  return u8.length === need || (/\.wbmp$/i.test(name) && u8.length >= need);
}

export function decodeWbmp(u8: Uint8Array): DecodeResult {
  if (u8.length < 4 || u8[0] !== 0) throw new Error('Not a WBMP type 0 file');
  const [w, p1] = uintvar(u8, 2); const [h, p] = uintvar(u8, p1);
  if (w <= 0 || h <= 0 || w * h > 80_000_000) throw new Error('Bad WBMP dimensions');
  const stride = Math.ceil(w / 8);
  const out = makeRaster(w, h);
  const d = out.data;
  const warnings: string[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const b = u8[p + y * stride + (x >> 3)];
    if (b === undefined) { if (!warnings.length) warnings.push(`Pixel data is truncated at row ${y + 1}`); break; }
    const v = (b >> (7 - (x & 7))) & 1 ? 255 : 0;
    const o = (y * w + x) * 4; d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255;
  }
  return { pages: [{ width: w, height: h, frames: [{ raster: out, delay: 0 }], loops: 0, bitDepth: 1, hasAlpha: false, notes: ['WBMP type 0, 1 bit'] }], info: {}, warnings };
}

export function encodeWbmp(r: Raster, threshold = 128): Uint8Array {
  const { width: w, height: h, data } = r;
  const var7 = (v: number) => { const b: number[] = []; do { b.unshift(v & 127); v >>= 7; } while (v); return b.map((x, i) => (i < b.length - 1 ? x | 128 : x)); };
  const head = [0, 0, ...var7(w), ...var7(h)];
  const stride = Math.ceil(w / 8);
  const out = new Uint8Array(head.length + stride * h);
  out.set(head);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    const white = data[i + 3] < 128 || l >= threshold;
    if (white) out[head.length + y * stride + (x >> 3)] |= 0x80 >> (x & 7);
  }
  return out;
}
