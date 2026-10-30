import { describe, it, expect } from 'vitest';
import { rotateRaster, straightenAngle, deskewAngle, perspective, lensCorrect, findPageCorners } from '../../src/picture/geometry';
import type { Raster } from '../../src/codecs/raster';

const raster = (w: number, h: number, f: (x: number, y: number) => number[]): Raster => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = f(x, y); d.set([p[0], p[1], p[2], p[3] ?? 255], (y * w + x) * 4); } return { width: w, height: h, data: d as Uint8ClampedArray<ArrayBuffer> }; };
const px = (r: Raster, x: number, y: number) => [...r.data.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 4)];
/** A picture of horizontal dark stripes (text-like lines) rotated by `deg`. */
const stripes = (w: number, h: number, deg: number, period = 12, smooth = false) => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return raster(w, h, (x, y) => { const yy = -(x - w / 2) * s + (y - h / 2) * c; if (smooth) { const v = Math.round(132 + 110 * Math.cos((2 * Math.PI * yy) / period)); return [v, v, v]; } const ink = ((yy % period) + period) % period < 3; return ink ? [20, 20, 20] : [245, 245, 245]; }); };

describe('rotation', () => {
  it('0° is identity, 90° transposes, expand grows the canvas, keep crops with the background', () => {
    const r = raster(20, 10, (x, y) => [x * 10, y * 20, 7]);
    expect(rotateRaster(r, 0, false).data).toEqual(r.data);
    const q = rotateRaster(r, 90, true); expect([q.width, q.height]).toEqual([10, 20]); expect(px(q, 9, 0).slice(0, 2)).toEqual(px(r, 0, 0).slice(0, 2));
    const e = rotateRaster(r, 45, true, [1, 2, 3]); expect(e.width).toBeGreaterThan(20); expect(px(e, 0, 0).slice(0, 3)).toEqual([1, 2, 3]);
    const k = rotateRaster(r, 45, false, null); expect([k.width, k.height]).toEqual([20, 10]); expect(px(k, 10, 5)[3]).toBe(255);
    const sq = rotateRaster(raster(10, 10, () => [9, 9, 9]), 45, false, null); expect(px(sq, 0, 0)[3]).toBe(0); expect(px(sq, 5, 5)[3]).toBe(255);
  });
});

describe('detectors', () => {
  it('straighten finds the tilt of dominant edges', () => {
    expect(Math.abs(straightenAngle(stripes(200, 160, 0, 12, true)))).toBeLessThan(0.3);
    expect(straightenAngle(stripes(200, 160, 4, 12, true))).toBeCloseTo(-4, 0);
    expect(straightenAngle(stripes(200, 160, -6.5, 12, true))).toBeCloseTo(6.5, 0);
  });
  it('deskew finds the text-line angle', () => {
    expect(deskewAngle(stripes(300, 200, 0, 20))).toBe(0);
    expect(deskewAngle(stripes(300, 200, 3, 20))).toBeCloseTo(-3, 0);
    expect(deskewAngle(stripes(300, 200, -2.5, 20))).toBeCloseTo(2.5, 0);
  });
  it('finds a bright page on a dark background', () => {
    const r = raster(200, 150, (x, y) => (x > 40 && x < 160 && y > 30 && y < 120 ? [230, 230, 230] : [30, 30, 30]));
    const q = findPageCorners(r)!;
    expect(q).toBeTruthy(); expect(q[0][0]).toBeCloseTo(41, -1); expect(q[0][1]).toBeCloseTo(31, -1); expect(q[2][0]).toBeCloseTo(159, -1); expect(q[2][1]).toBeCloseTo(119, -1);
    expect(findPageCorners(raster(50, 50, () => [100, 100, 100]))).toBeNull();
  });
});

describe('perspective and lens', () => {
  it('an axis-aligned quad is a crop; a skewed quad straightens its content', () => {
    const r = raster(100, 80, (x, y) => [x * 2, y * 3, 0]);
    const c = perspective(r, [[10, 10], [60, 10], [60, 50], [10, 50]]);
    expect([c.width, c.height]).toEqual([50, 40]); expect(px(c, 0, 0).slice(0, 2)).toEqual(px(r, 10, 10).slice(0, 2)); expect(px(c, 49, 39)[0]).toBeCloseTo(px(r, 59, 49)[0], -1);
    // A trapezoid whose top edge is narrower: after correction the left column samples run down the left edge of the trapezoid.
    const t = perspective(r, [[30, 0], [70, 0], [100, 79], [0, 79]], 40, 80);
    expect(px(t, 0, 0)[0]).toBeCloseTo(60, -1); expect(px(t, 0, 79)[0]).toBeCloseTo(0, -1); expect(px(t, 39, 0)[0]).toBeCloseTo(140, -1);
    expect(px(perspective(r, [[-50, -50], [50, -50], [50, 50], [-50, 50]]), 0, 0)[3]).toBe(0);
  });
  it('lens correction with zero parameters is the identity; distortion moves the corners; vignetting brightens them', () => {
    const r = raster(60, 40, (x, y) => [100 + x, 100 + y, 100]);
    expect(lensCorrect(r, {}).data).toEqual(r.data);
    const d = lensCorrect(r, { k1: 0.3 }); expect(px(d, 30, 20)).toEqual(px(r, 30, 20)); expect(px(d, 2, 2)).not.toEqual(px(r, 2, 2));
    const v = lensCorrect(r, { vignette: 0.5 }); expect(px(v, 1, 1)[2]).toBeGreaterThan(100); expect(px(v, 30, 20)[2]).toBe(100);
    const ca = lensCorrect(r, { caRed: 20 }); const reds = (q: Raster) => [...q.data].filter((_, i) => i % 4 === 0), greens = (q: Raster) => [...q.data].filter((_, i) => i % 4 === 1);
    expect(reds(ca)).not.toEqual(reds(r)); expect(greens(ca)).toEqual(greens(r));
  });
});
