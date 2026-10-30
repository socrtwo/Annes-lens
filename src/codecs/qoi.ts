/** QOI, the Quite OK Image format (qoiformat.org): reader and writer. */
import { makeRaster, type DecodeResult, type Raster } from './raster';

export const isQoi = (u8: Uint8Array): boolean => u8.length >= 14 && u8[0] === 0x71 && u8[1] === 0x6f && u8[2] === 0x69 && u8[3] === 0x66;

export function decodeQoi(u8: Uint8Array): DecodeResult {
  if (!isQoi(u8)) throw new Error('Not a QOI file');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const w = dv.getUint32(4), h = dv.getUint32(8), channels = u8[12], colorspace = u8[13];
  if (!w || !h || w * h > 80_000_000) throw new Error('Bad QOI dimensions');
  const out = makeRaster(w, h);
  const d = out.data;
  const index = new Uint8Array(64 * 4);
  let r = 0, g = 0, b = 0, a = 255;
  let p = 14;
  const total = w * h * 4;
  let o = 0;
  const end = u8.length - 8;
  const warnings: string[] = [];
  while (o < total) {
    if (p >= end) { warnings.push('Data ends early; the rest is left black'); break; }
    const b1 = u8[p++];
    let run = 0;
    if (b1 === 0xfe) { r = u8[p++]; g = u8[p++]; b = u8[p++]; }
    else if (b1 === 0xff) { r = u8[p++]; g = u8[p++]; b = u8[p++]; a = u8[p++]; }
    else {
      const tag = b1 & 0xc0;
      if (tag === 0x00) { const i = (b1 & 63) * 4; r = index[i]; g = index[i + 1]; b = index[i + 2]; a = index[i + 3]; }
      else if (tag === 0x40) { r = (r + ((b1 >> 4) & 3) - 2) & 255; g = (g + ((b1 >> 2) & 3) - 2) & 255; b = (b + (b1 & 3) - 2) & 255; }
      else if (tag === 0x80) { const b2 = u8[p++]; const dg = (b1 & 63) - 32; r = (r + dg - 8 + ((b2 >> 4) & 15)) & 255; g = (g + dg) & 255; b = (b + dg - 8 + (b2 & 15)) & 255; }
      else run = b1 & 63;
    }
    const i = ((r * 3 + g * 5 + b * 7 + a * 11) & 63) * 4;
    index[i] = r; index[i + 1] = g; index[i + 2] = b; index[i + 3] = a;
    for (let k = 0; k <= run && o < total; k++) { d[o++] = r; d[o++] = g; d[o++] = b; d[o++] = a; }
  }
  let hasAlpha = false;
  if (channels === 4) for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) { hasAlpha = true; break; }
  return { pages: [{ width: w, height: h, frames: [{ raster: out, delay: 0 }], loops: 0, bitDepth: channels * 8, hasAlpha, notes: [`${channels === 4 ? 'RGBA' : 'RGB'}, ${colorspace === 1 ? 'linear' : 'sRGB'}`] }], info: {}, warnings };
}

export function encodeQoi(src: Raster): Uint8Array {
  const { width: w, height: h, data } = src;
  let alpha = false;
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) { alpha = true; break; }
  const out = new Uint8Array(14 + w * h * 5 + 8);
  const dv = new DataView(out.buffer);
  out.set([0x71, 0x6f, 0x69, 0x66]); dv.setUint32(4, w); dv.setUint32(8, h); out[12] = alpha ? 4 : 3; out[13] = 0;
  let p = 14;
  const index = new Uint8Array(64 * 4);
  let pr = 0, pg = 0, pb = 0, pa = 255, run = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = alpha ? data[i + 3] : 255;
    if (r === pr && g === pg && b === pb && a === pa) {
      run++;
      if (run === 62 || i + 4 >= data.length) { out[p++] = 0xc0 | (run - 1); run = 0; }
      continue;
    }
    if (run) { out[p++] = 0xc0 | (run - 1); run = 0; }
    const ix = ((r * 3 + g * 5 + b * 7 + a * 11) & 63) * 4;
    if (index[ix] === r && index[ix + 1] === g && index[ix + 2] === b && index[ix + 3] === a) out[p++] = ix / 4;
    else {
      index[ix] = r; index[ix + 1] = g; index[ix + 2] = b; index[ix + 3] = a;
      if (a === pa) {
        const dr = ((r - pr) << 24) >> 24, dg = ((g - pg) << 24) >> 24, db = ((b - pb) << 24) >> 24;
        const drg = dr - dg, dbg = db - dg;
        if (dr > -3 && dr < 2 && dg > -3 && dg < 2 && db > -3 && db < 2) out[p++] = 0x40 | ((dr + 2) << 4) | ((dg + 2) << 2) | (db + 2);
        else if (drg > -9 && drg < 8 && dg > -33 && dg < 32 && dbg > -9 && dbg < 8) { out[p++] = 0x80 | (dg + 32); out[p++] = ((drg + 8) << 4) | (dbg + 8); }
        else { out[p++] = 0xfe; out[p++] = r; out[p++] = g; out[p++] = b; }
      } else { out[p++] = 0xff; out[p++] = r; out[p++] = g; out[p++] = b; out[p++] = a; }
    }
    pr = r; pg = g; pb = b; pa = a;
  }
  out.set([0, 0, 0, 0, 0, 0, 0, 1], p); p += 8;
  return out.slice(0, p);
}
