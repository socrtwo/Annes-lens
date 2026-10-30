/**
 * Selection masks: a byte per picture pixel (255 = selected) with the rectangle that bounds the
 * selected area. Ellipse, polygon (lasso), magic wand (flood fill by tolerance), color range,
 * inversion, bounds, and the display outline the viewer draws.
 */
import type { Raster } from '../codecs/raster';
export interface Rect { x: number; y: number; w: number; h: number }

export function ellipseMask(w: number, h: number, r: Rect): Uint8Array {
  const m = new Uint8Array(w * h), cx = r.x + r.w / 2, cy = r.y + r.h / 2, rx = r.w / 2, ry = r.h / 2;
  for (let y = Math.max(0, r.y); y < Math.min(h, r.y + r.h); y++) for (let x = Math.max(0, r.x); x < Math.min(w, r.x + r.w); x++) { const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry; if (dx * dx + dy * dy <= 1) m[y * w + x] = 255; }
  return m;
}
/** Even-odd polygon fill (scanline). */
export function polygonMask(w: number, h: number, pts: [number, number][]): Uint8Array {
  const m = new Uint8Array(w * h); if (pts.length < 3) return m;
  const ys = pts.map((p) => p[1]); const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5, xs: number[] = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xa, ya] = pts[i], [xb, yb] = pts[j]; if ((ya <= yc && yb > yc) || (yb <= yc && ya > yc)) xs.push(xa + ((yc - ya) * (xb - xa)) / (yb - ya)); }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x < Math.min(w, Math.ceil(xs[k + 1] - 0.5)); x++) m[y * w + x] = 255;
  }
  return m;
}
const dist = (d: Uint8ClampedArray, i: number, c: [number, number, number]) => Math.max(Math.abs(d[i] - c[0]), Math.abs(d[i + 1] - c[1]), Math.abs(d[i + 2] - c[2]));
/** Magic wand: pixels within `tolerance` of the seed pixel's color, contiguous (4-connected flood) or anywhere. */
export function wandMask(src: Raster, sx: number, sy: number, tolerance = 32, contiguous = true): Uint8Array {
  const w = src.width, h = src.height, d = src.data, m = new Uint8Array(w * h);
  sx = Math.max(0, Math.min(w - 1, Math.floor(sx))); sy = Math.max(0, Math.min(h - 1, Math.floor(sy)));
  const o = (sy * w + sx) * 4, seed: [number, number, number] = [d[o], d[o + 1], d[o + 2]];
  if (!contiguous) return colorRangeMask(src, seed, tolerance);
  const stack = [sy * w + sx]; m[stack[0]] = 255;
  while (stack.length) { const j = stack.pop()!; const x = j % w, y = (j - x) / w; for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) { if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const k = ny * w + nx; if (m[k] || dist(d, k * 4, seed) > tolerance) continue; m[k] = 255; stack.push(k); } }
  return m;
}
export function colorRangeMask(src: Raster, color: [number, number, number], tolerance = 32): Uint8Array {
  const m = new Uint8Array(src.width * src.height), d = src.data;
  for (let j = 0; j < m.length; j++) if (dist(d, j * 4, color) <= tolerance) m[j] = 255;
  return m;
}
export function invertMask(m: Uint8Array): Uint8Array { const o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = 255 - m[i]; return o; }
export function maskBounds(m: Uint8Array, w: number, h: number): Rect | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
export const maskCount = (m: Uint8Array): number => { let n = 0; for (let i = 0; i < m.length; i++) if (m[i]) n++; return n; };
/** RGBA for the viewer: unselected pixels dimmed, selected edge pixels white. */
export function maskOverlay(m: Uint8Array, w: number, h: number): Uint8ClampedArray {
  const o = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const j = y * w + x, i = j * 4; if (!m[j]) { o[i + 3] = 90; continue; } const edge = (x > 0 && !m[j - 1]) || (x < w - 1 && !m[j + 1]) || (y > 0 && !m[j - w]) || (y < h - 1 && !m[j + w]) || x === 0 || y === 0 || x === w - 1 || y === h - 1; if (edge) { o[i] = o[i + 1] = o[i + 2] = 255; o[i + 3] = 255; } }
  return o;
}
/** Composes an edit done on the `rect` crop back into the picture, keeping unselected pixels (by mask) unchanged. */
export function composeMasked(orig: Raster, done: Raster, rect: Rect, mask: Uint8Array): Raster {
  const out = { width: orig.width, height: orig.height, data: orig.data.slice() as Uint8ClampedArray<ArrayBuffer> };
  for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) { const px = rect.x + x, py = rect.y + y; if (!mask[py * orig.width + px]) continue; const so = (y * done.width + x) * 4, o = (py * orig.width + px) * 4; out.data[o] = done.data[so]; out.data[o + 1] = done.data[so + 1]; out.data[o + 2] = done.data[so + 2]; out.data[o + 3] = done.data[so + 3]; }
  return out;
}
