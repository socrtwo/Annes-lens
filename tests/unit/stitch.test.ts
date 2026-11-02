import { describe, it, expect } from 'vitest';
import { stitch, homographyFrom, ransac, apply3, focalsFromHomography, largestRect, toCyl, fromCyl, mulberry, mul3, inv3, type Mat3 } from '../../src/picture/stitch';
import type { Raster } from '../../src/codecs/raster';

// A detailed, non-repeating test scene: value noise at several scales in each channel.
const hash = (x: number, y: number, c: number) => { let h = (x * 374761393 + y * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const smooth = (x: number, y: number, s: number, c: number) => { const gx = x / s, gy = y / s, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); return (hash(x0, y0, c) * (1 - u) + hash(x0 + 1, y0, c) * u) * (1 - v) + (hash(x0, y0 + 1, c) * (1 - u) + hash(x0 + 1, y0 + 1, c) * u) * v; };
const tex = (x: number, y: number, c: number) => 255 * (0.45 * smooth(x, y, 40, c) + 0.3 * smooth(x, y, 13, c + 3) + 0.25 * smooth(x, y, 5, c + 7));
const texAt = (x: number, y: number): number[] => [tex(x, y, 0), tex(x, y, 1), tex(x, y, 2)];
function render(w: number, h: number, f: (x: number, y: number) => number[]): Raster {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = f(x + 0.5, y + 0.5), i = (y * w + x) * 4; d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2]; d[i + 3] = 255; }
  return { width: w, height: h, data: d };
}
const px = (r: Raster, x: number, y: number) => { const i = (y * r.width + x) * 4; return [r.data[i], r.data[i + 1], r.data[i + 2]]; };

describe('stitch: geometry', () => {
  it('fits a homography and rejects outliers with RANSAC', () => {
    const H: Mat3 = [1.02, 0.03, 40, -0.02, 0.98, -12, 1e-4, -5e-5, 1];
    const rnd = mulberry(3), a: [number, number][] = [], b: [number, number][] = [];
    for (let k = 0; k < 120; k++) { const p: [number, number] = [rnd() * 600, rnd() * 400]; a.push(p); const q = apply3(H, p[0], p[1]); b.push(k % 4 === 3 ? [rnd() * 600, rnd() * 400] : [q[0] + (rnd() - 0.5) * 0.4, q[1] + (rnd() - 0.5) * 0.4]); }
    const r = ransac(a, b, 'homography', 2, 800, mulberry(5))!;
    expect(r.inliers.length).toBeGreaterThanOrEqual(88); expect(r.inliers.length).toBeLessThanOrEqual(92);
    for (const [x, y] of [[0, 0], [600, 0], [600, 400], [0, 400]]) { const p = apply3(r.M, x, y), q = apply3(H, x, y); expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThan(0.5); }
    const exact = homographyFrom([[0, 0], [1, 0], [1, 1], [0, 1]], [[10, 10], [12, 10], [12, 13], [10, 13]])!;
    expect(apply3(exact, 0.5, 0.5).map((v) => +v.toFixed(6))).toEqual([11, 11.5]);
    expect(mul3(exact, inv3(exact)!).map((v) => +v.toFixed(9) + 0)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });
  it('recovers the focal length of a rotating camera', () => {
    const f = 480, th = 0.35, K = [f, 0, 0, 0, f, 0, 0, 0, 1], R = [Math.cos(th), 0, Math.sin(th), 0, 1, 0, -Math.sin(th), 0, Math.cos(th)];
    const H = mul3(K, mul3(R, inv3(K)!)), r = focalsFromHomography(H);
    expect(r.f0).toBeCloseTo(f, 3); expect(r.f1).toBeCloseTo(f, 3);
    const c = toCyl(200, -80, f), back = fromCyl(c[0], c[1], f); expect(back[0]).toBeCloseTo(200, 9); expect(back[1]).toBeCloseTo(-80, 9);
  });
  it('finds the largest rectangle inside a mask', () => {
    const w = 8, h = 5, m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = x >= 1 && x <= 6 && y >= 1 && y <= 3 ? 1 : x === 0 && y === 2 ? 1 : 0;
    expect(largestRect(m, w, h)).toEqual({ x: 1, y: 1, w: 6, h: 3 });
  });
});

describe('stitch: pictures', () => {
  const W = 1300, H = 420, scene = render(W, H, texAt);
  const crop = (x0: number, w: number, gain = 1) => render(w, H, (x, y) => texAt(x + x0, y).map((v) => v * gain));
  it('joins shifted pieces exactly (flat) and in the planar projection', () => {
    for (const projection of ['flat', 'planar'] as const) {
      const r = stitch([crop(420, 560), crop(0, 560), crop(840, 460)], { projection, workSide: 600 });
      expect(r.projection).toBe(projection); expect(r.used).toEqual([0, 1, 2]); expect(r.skipped).toEqual([]);
      expect(Math.abs(r.raster.width - W)).toBeLessThanOrEqual(2); expect(Math.abs(r.raster.height - H)).toBeLessThanOrEqual(2);
      // The left piece's transform puts its origin at the result's left edge.
      const o = apply3(r.transforms[1], 0, 0); expect(Math.abs(o[0])).toBeLessThan(1.5); expect(Math.abs(o[1])).toBeLessThan(1.5);
      let diff = 0, n = 0; for (let y = 10; y < r.raster.height - 10; y += 7) for (let x = 10; x < r.raster.width - 10; x += 7) { const a = px(r.raster, x, y), b = px(scene, Math.max(0, Math.min(W - 1, x - Math.round(o[0]))), Math.max(0, Math.min(H - 1, y - Math.round(o[1])))); diff += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]); n += 3; }
      expect(diff / n).toBeLessThan(2);
    }
  });
  it('keeps shifted pieces planar in automatic mode (no perspective to estimate a lens from)', () => {
    const r = stitch([crop(0, 560), crop(420, 560), crop(840, 460)], { workSide: 600 });
    expect(r.projection).toBe('planar'); expect(Math.abs(r.raster.width - W)).toBeLessThanOrEqual(2);
  });
  it('evens out a darker picture and leaves out one that does not overlap', () => {
    const stranger = render(400, H, (x, y) => texAt(x + 5000, y + 3000));
    const r = stitch([crop(0, 560), crop(420, 560, 0.8), stranger], { projection: 'flat', workSide: 600 });
    expect(r.used).toEqual([0, 1]); expect(r.skipped).toEqual([2]);
    expect(r.gains[1] / r.gains[0]).toBeGreaterThan(1.2); expect(r.gains[1] / r.gains[0]).toBeLessThan(1.3);
    const left = px(r.raster, 100, 200), right = px(r.raster, 900, 200), want = [texAt(100.5, 200.5), texAt(900.5, 200.5)];
    const g0 = r.gains[0];
    for (let c = 0; c < 3; c++) { expect(Math.abs(left[c] - want[0][c] * g0)).toBeLessThan(6); expect(Math.abs(right[c] - want[1][c] * g0)).toBeLessThan(6); }
  });
  it('turns a wide pan into a cylindrical panorama with the camera\'s focal length', () => {
    const f = 500, vw = 640, vh = 420, yaws = [0, 0.5, 1.0, 1.5], U0 = 2000, V0 = 300;
    const view = (yaw: number) => render(vw, vh, (x, y) => { const xc = x - vw / 2, yc = y - vh / 2, th = yaw + Math.atan(xc / f), v = (f * yc) / Math.hypot(xc, f); return texAt(U0 + f * th, V0 + v); });
    const r = stitch(yaws.map(view), { workSide: 700, crop: false });
    expect(r.projection).toBe('cylindrical'); expect(r.used).toEqual([0, 1, 2, 3]);
    expect(Math.abs(r.focal! - f) / f).toBeLessThan(0.02); // estimated from the homographies (the fallback guess would be 512)
    const ox = r.offsets!.map((o) => o[0]);
    for (let i = 1; i < 4; i++) expect(Math.abs(ox[i] - ox[i - 1] - (r.focal! * 0.5))).toBeLessThan(4);
    // Near the middle of a picture the result shows the scene's texture where the camera pointed.
    const ref = 1, [cx, cy] = r.offsets![ref]; let diff = 0, n = 0;
    for (let dy = -150; dy <= 150; dy += 10) for (let dx = -150; dx <= 150; dx += 10) { const a = px(r.raster, Math.round(cx + dx), Math.round(cy + dy)), b = texAt(U0 + f * yaws[ref] + dx * (f / r.focal!), V0 + dy * (f / r.focal!)); diff += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]); n += 3; }
    expect(diff / n).toBeLessThan(8);
  });
});
