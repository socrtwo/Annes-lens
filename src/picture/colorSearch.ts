/** Search by Color: CIE L*a*b* distance (ΔE76) and the share of a picture's pixels near a color. */
import type { Raster } from '../codecs/raster';

export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
export const deltaE = (a: [number, number, number], b: [number, number, number]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The share (0..1) of opaque pixels within `tolerance` ΔE of `rgb`. */
export function colorShare(r: Raster, rgb: [number, number, number], tolerance: number): number {
  const target = rgbToLab(rgb[0], rgb[1], rgb[2]), d = r.data, cache = new Map<number, boolean>();
  let n = 0, hit = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue; n++;
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let near = cache.get(key);
    if (near === undefined) { near = deltaE(rgbToLab(d[i], d[i + 1], d[i + 2]), target) <= tolerance; cache.set(key, near); }
    if (near) hit++;
  }
  return n ? hit / n : 0;
}
/** The average color of a rectangle (for "use the selection's color"). */
export function averageColor(r: Raster, rect: { x: number; y: number; w: number; h: number }): [number, number, number] {
  let s0 = 0, s1 = 0, s2 = 0, n = 0;
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) { const o = (y * r.width + x) * 4; if (r.data[o + 3] < 128) continue; s0 += r.data[o]; s1 += r.data[o + 1]; s2 += r.data[o + 2]; n++; }
  return n ? [Math.round(s0 / n), Math.round(s1 / n), Math.round(s2 / n)] : [0, 0, 0];
}
