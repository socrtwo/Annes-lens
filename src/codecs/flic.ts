/**
 * Autodesk Animator animations (FLI from Animator, FLC from Animator Pro and others), read by the app's own
 * code from the format's description: every frame, with its delay (1/70 s units in FLI, milliseconds in FLC).
 * Chunks: COLOR_256 and COLOR_64 (6-bit colors widened to the full range, palette changes during the
 * animation too), BYTE_RUN, DELTA_FLI (LC), DELTA_FLC (SS2, with line skips and an odd width's last byte),
 * BLACK, FLI_COPY; postage stamps and the prefix chunk are skipped. The extra "ring" frame is not shown.
 */
import { makeRaster, type DecodeResult } from './raster';

const le16 = (u: Uint8Array, o: number) => u[o] | (u[o + 1] << 8);
const le32 = (u: Uint8Array, o: number) => (u[o] | (u[o + 1] << 8) | (u[o + 2] << 16) | (u[o + 3] << 24)) >>> 0;
const MAGICS: Record<number, string> = { 0xaf11: 'FLI (Animator)', 0xaf12: 'FLC (Animator Pro)', 0xaf30: 'FLC (Huffman BWT, not supported)', 0xaf31: 'FLC (frame shift, not supported)', 0xaf44: 'FLC (non-8-bit, not supported)' };

export const isFlic = (u8: Uint8Array): boolean => u8.length >= 128 + 16 && (le16(u8, 4) === 0xaf11 || le16(u8, 4) === 0xaf12) && le16(u8, 12) <= 8 && le16(u8, 8) > 0 && le16(u8, 10) > 0;

export const flicOptions = { maxFrames: 2000, maxPixels: 400e6 };

export function decodeFlic(u8: Uint8Array, o = flicOptions): DecodeResult {
  const magic = le16(u8, 4), w = le16(u8, 8), h = le16(u8, 10), n = le16(u8, 6), fli = magic === 0xaf11;
  if (!MAGICS[magic] || magic > 0xaf12) throw new Error(`This Autodesk animation (${MAGICS[magic] || 'unknown kind'}) is not supported`);
  const speed = fli ? le16(u8, 16) * 1000 / 70 : le32(u8, 16);
  const count = Math.min(n || 1, o.maxFrames, Math.max(1, Math.floor(o.maxPixels / (w * h))));
  const warnings: string[] = [];
  const idx = new Uint8Array(w * h), pal = new Uint8Array(768);
  const frames: { raster: ReturnType<typeof makeRaster>; delay: number }[] = [];
  let p = !fli && le32(u8, 80) ? le32(u8, 80) : 128;
  const six = (v: number) => ((v & 63) << 2) | ((v & 63) >> 4);
  for (let f = 0; f < count && p + 16 <= u8.length;) {
    const size = le32(u8, p), type = le16(u8, p + 4), chunks = le16(u8, p + 6);
    if (size < 6) { warnings.push('A damaged frame header; the rest is not read'); break; }
    const end = Math.min(u8.length, p + size);
    if (type === 0xf100) { p += size; continue; } // prefix chunk
    if (type !== 0xf1fa) { warnings.push(`Unknown chunk 0x${type.toString(16)}; the rest is not read`); break; }
    const delay = !fli && le16(u8, p + 8) ? le16(u8, p + 8) : speed;
    let q = p + 16;
    for (let c = 0; c < chunks && q + 6 <= end; c++) {
      const cs = le32(u8, q), ct = le16(u8, q + 4), d = q + 6, ce = Math.min(end, q + Math.max(6, cs));
      try {
        switch (ct) {
          case 4: case 11: { // palette packets: skip, count (0 = 256), colors
            let i = 0, r = d + 2;
            for (let k = le16(u8, d); k > 0 && r + 2 <= ce; k--) {
              i += u8[r]; let m = u8[r + 1] || 256; r += 2;
              for (; m > 0 && i < 256 && r + 3 <= ce; m--, i++, r += 3) for (let z = 0; z < 3; z++) pal[i * 3 + z] = ct === 11 ? six(u8[r + z]) : u8[r + z];
            }
            break;
          }
          case 13: idx.fill(0); break;
          case 16: idx.set(u8.subarray(d, Math.min(ce, d + w * h))); break;
          case 15: { // BYTE_RUN: per line a packet count (ignored), then runs (positive) and literals (negative)
            let r = d;
            for (let y = 0; y < h && r < ce; y++) {
              r++; let x = 0; const row = y * w;
              while (x < w && r < ce) {
                const c8 = (u8[r++] << 24) >> 24;
                if (c8 >= 0) { const v = u8[r++]; idx.fill(v, row + x, row + Math.min(w, x + c8)); x += c8; }
                else { const m = Math.min(-c8, w - x); idx.set(u8.subarray(r, r + m), row + x); x += -c8; r += -c8; }
              }
            }
            break;
          }
          case 12: { // DELTA_FLI: first line, line count; per line packets of skip, then literal (positive) or run (negative) bytes
            let y = le16(u8, d), r = d + 4;
            for (let lines = le16(u8, d + 2); lines > 0 && y < h && r < ce; lines--, y++) {
              let x = 0; const row = y * w;
              for (let k = u8[r++]; k > 0 && r < ce; k--) {
                x += u8[r++]; const c8 = (u8[r++] << 24) >> 24;
                if (c8 >= 0) { const m = Math.max(0, Math.min(c8, w - x)); idx.set(u8.subarray(r, r + m), row + x); x += c8; r += c8; }
                else { const m = Math.max(0, Math.min(-c8, w - x)); idx.fill(u8[r++], row + x, row + x + m); x += -c8; }
              }
            }
            break;
          }
          case 7: { // DELTA_FLC: lines of word packets; flag words skip lines or set the last byte of an odd width
            let r = d + 2, y = 0;
            for (let lines = le16(u8, d); lines > 0 && y < h && r + 2 <= ce;) {
              const word = le16(u8, r); r += 2;
              if ((word & 0xc000) === 0xc000) { y += 0x10000 - word; continue; }
              if ((word & 0xc000) === 0x8000) { if (y < h) idx[y * w + w - 1] = word & 0xff; continue; }
              let x = 0; const row = y * w;
              for (let k = word; k > 0 && r + 2 <= ce; k--) {
                x += u8[r]; const c8 = (u8[r + 1] << 24) >> 24; r += 2;
                if (c8 >= 0) { for (let i = 0; i < c8 * 2; i++, x++) if (x < w) idx[row + x] = u8[r + i]; r += c8 * 2; }
                else { const a = u8[r], b = u8[r + 1]; r += 2; for (let i = 0; i < -c8; i++) { if (x < w) idx[row + x] = a; x++; if (x < w) idx[row + x] = b; x++; } }
              }
              y++; lines--;
            }
            break;
          }
          case 18: break; // postage stamp
          default: if (!warnings.some((m) => m.includes(`chunk type ${ct}`))) warnings.push(`Unknown chunk type ${ct} is skipped`);
        }
      } catch { warnings.push(`Frame ${f + 1}: a damaged chunk`); }
      q += Math.max(6, cs);
    }
    const r = makeRaster(w, h), dd = r.data;
    for (let i = 0; i < w * h; i++) { const c = idx[i] * 3; dd[i * 4] = pal[c]; dd[i * 4 + 1] = pal[c + 1]; dd[i * 4 + 2] = pal[c + 2]; dd[i * 4 + 3] = 255; }
    frames.push({ raster: r, delay: Math.max(10, Math.round(delay)) });
    f++;
    p += size;
  }
  if (!frames.length) throw new Error('This Autodesk animation has no readable frame');
  if (frames.length < (n || 1)) warnings.push(`${frames.length} of ${n} frames are shown${count < n ? ' (too many to keep)' : ' (the file is cut short)'}`);
  const notes = [`Autodesk ${MAGICS[magic]}, ${frames.length === 1 ? 'one frame' : `animation of ${frames.length} frames`}, ${Math.round(speed)} ms a frame`];
  return { pages: [{ width: w, height: h, frames, loops: 0, bitDepth: 8, paletteSize: 256, hasAlpha: false, notes }], info: {}, warnings };
}
