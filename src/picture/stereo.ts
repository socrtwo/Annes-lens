/**
 * Stereo View: a left/right pair from an MPO file (its first two JPEGs), a side-by-side picture
 * (split down the middle), or two pictures; shown as a red-cyan anaglyph (Dubois color, gray or
 * half-color), cross-eye (right|left) or parallel (left|right).
 */
import type { Raster } from '../codecs/raster';
import { findEmbeddedJpegs } from '../codecs/rawpreview';

/** The first two same-size JPEGs in the file, in file order (an MPO stereo pair). */
export function mpoPair(u8: Uint8Array): { left: Uint8Array; right: Uint8Array } | null {
  const js = findEmbeddedJpegs(u8, 6).sort((a, b) => a.offset - b.offset);
  if (js.length < 2 || js[0].offset !== 0) return null;
  const second = js.slice(1).find((j) => j.width === js[0].width && j.height === js[0].height);
  if (!second) return null;
  return { left: u8.subarray(0, js[0].length), right: u8.subarray(second.offset, second.offset + second.length) };
}

export function splitSideBySide(r: Raster): { left: Raster; right: Raster } {
  const hw = Math.floor(r.width / 2), mk = (x0: number): Raster => { const d = new Uint8ClampedArray(hw * r.height * 4); for (let y = 0; y < r.height; y++) d.set(r.data.subarray((y * r.width + x0) * 4, (y * r.width + x0 + hw) * 4), y * hw * 4); return { width: hw, height: r.height, data: d as Uint8ClampedArray<ArrayBuffer> }; };
  return { left: mk(0), right: mk(r.width - hw) };
}

export type StereoMode = 'dubois' | 'gray' | 'half' | 'crossEye' | 'parallel' | 'left' | 'right';
// Dubois least-squares red-cyan matrices.
const DL = [0.437, 0.449, 0.164, -0.062, -0.062, -0.024, -0.048, -0.050, -0.017];
const DR = [-0.011, -0.032, -0.007, 0.377, 0.761, 0.009, -0.026, -0.093, 1.234];
const gray = (d: Uint8ClampedArray, o: number) => 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];

/** The pair rendered for viewing. Both eyes must be the same size (the right one is used as given). */
export function renderStereo(L: Raster, R: Raster, mode: StereoMode, swap = false): Raster {
  if (swap) [L, R] = [R, L];
  const w = Math.min(L.width, R.width), h = Math.min(L.height, R.height);
  if (mode === 'left' || mode === 'right') { const s = mode === 'left' ? L : R; return { width: s.width, height: s.height, data: s.data.slice() as Uint8ClampedArray<ArrayBuffer> }; }
  if (mode === 'crossEye' || mode === 'parallel') {
    const a = mode === 'crossEye' ? R : L, b = mode === 'crossEye' ? L : R, out = new Uint8ClampedArray(w * 2 * h * 4);
    for (let y = 0; y < h; y++) { out.set(a.data.subarray(y * a.width * 4, (y * a.width + w) * 4), y * w * 2 * 4); out.set(b.data.subarray(y * b.width * 4, (y * b.width + w) * 4), (y * w * 2 + w) * 4); }
    return { width: w * 2, height: h, data: out as Uint8ClampedArray<ArrayBuffer> };
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ol = (y * L.width + x) * 4, or = (y * R.width + x) * 4, o = (y * w + x) * 4, l = L.data, r = R.data;
    if (mode === 'gray') { out[o] = gray(l, ol); out[o + 1] = out[o + 2] = gray(r, or); }
    else if (mode === 'half') { out[o] = gray(l, ol); out[o + 1] = r[or + 1]; out[o + 2] = r[or + 2]; }
    else for (let c = 0; c < 3; c++) out[o + c] = DL[c * 3] * l[ol] + DL[c * 3 + 1] * l[ol + 1] + DL[c * 3 + 2] * l[ol + 2] + DR[c * 3] * r[or] + DR[c * 3 + 1] * r[or + 1] + DR[c * 3 + 2] * r[or + 2];
    out[o + 3] = 255;
  }
  return { width: w, height: h, data: out as Uint8ClampedArray<ArrayBuffer> };
}
