import { describe, it, expect } from 'vitest';
import { ellipseMask, polygonMask, wandMask, colorRangeMask, invertMask, maskBounds, maskCount, maskOverlay, composeMasked } from '../../src/picture/mask';
import type { Raster } from '../../src/codecs/raster';

const raster = (w: number, h: number, f: (x: number, y: number) => number[]): Raster => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = f(x, y); d.set([p[0], p[1], p[2], 255], (y * w + x) * 4); } return { width: w, height: h, data: d as Uint8ClampedArray<ArrayBuffer> }; };

describe('selection masks', () => {
  it('ellipse and polygon fills', () => {
    const e = ellipseMask(20, 20, { x: 0, y: 0, w: 20, h: 20 });
    expect(e[10 * 20 + 10]).toBe(255); expect(e[0]).toBe(0); expect(maskCount(e)).toBeGreaterThan(280); expect(maskCount(e)).toBeLessThan(330);
    const t = polygonMask(10, 10, [[0, 0], [10, 0], [0, 10]]);
    expect(t[1 * 10 + 1]).toBe(255); expect(t[8 * 10 + 8]).toBe(0); expect(maskCount(t)).toBeGreaterThan(40); expect(maskCount(t)).toBeLessThan(60);
    expect(maskCount(polygonMask(10, 10, [[1, 1], [2, 2]]))).toBe(0);
  });
  it('wand floods contiguous similar pixels; color range selects anywhere', () => {
    const r = raster(10, 10, (x) => (x < 5 ? [200, 0, 0] : x === 7 ? [200, 0, 0] : [0, 0, 200]));
    const w = wandMask(r, 1, 1, 10, true); expect(maskCount(w)).toBe(50); expect(w[7]).toBe(0);
    const any = wandMask(r, 1, 1, 10, false); expect(maskCount(any)).toBe(60);
    expect(maskCount(colorRangeMask(r, [0, 0, 200], 10))).toBe(40);
    expect(maskBounds(w, 10, 10)).toEqual({ x: 0, y: 0, w: 5, h: 10 }); expect(maskBounds(new Uint8Array(100), 10, 10)).toBeNull();
    expect(maskCount(invertMask(w))).toBe(50);
  });
  it('overlay marks edges and dims the rest; compose keeps unselected pixels', () => {
    const m = ellipseMask(8, 8, { x: 0, y: 0, w: 8, h: 8 }); const o = maskOverlay(m, 8, 8);
    expect(o[(0 * 8 + 0) * 4 + 3]).toBe(90); expect(o[(4 * 8 + 0) * 4 + 3]).toBe(255); expect(o[(4 * 8 + 0) * 4]).toBe(255);
    const orig = raster(8, 8, () => [10, 10, 10]), done = raster(4, 4, () => [250, 250, 250]);
    const mask = new Uint8Array(64); mask[2 * 8 + 2] = 255;
    const out = composeMasked(orig, done, { x: 2, y: 2, w: 4, h: 4 }, mask);
    expect(out.data[(2 * 8 + 2) * 4]).toBe(250); expect(out.data[(3 * 8 + 3) * 4]).toBe(10); expect(out.data[0]).toBe(10);
  });
});
