import { describe, it, expect } from 'vitest';
import { histogram, clippingMask, peakingMask, displayLut, applyDisplay, expandOsd, formatColor } from '../../src/ui/overlays';

const rgba = (...px: number[][]) => Uint8ClampedArray.from(px.flatMap((p) => [p[0], p[1], p[2], 255]));

describe('overlay helpers', () => {
  it('histogram counts channels and clipping', () => {
    const h = histogram(rgba([255, 10, 10], [0, 0, 0], [100, 100, 100]));
    expect(h.r[255]).toBe(1); expect(h.lum[0]).toBe(1); expect(h.clippedHi).toBe(1); expect(h.clippedLo).toBe(1); expect(h.g[100]).toBe(1);
  });
  it('clipping mask marks highlights red and shadows blue', () => {
    const m = clippingMask(rgba([255, 10, 10], [0, 0, 0], [100, 100, 100]));
    expect([...m.subarray(0, 4)]).toEqual([255, 0, 0, 200]); expect([...m.subarray(4, 8)]).toEqual([0, 0, 255, 200]); expect(m[11]).toBe(0);
  });
  it('focus peaking marks a sharp edge only', () => {
    const w = 8, h = 3, d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = x < 4 ? 0 : 255; d.set([v, v, v, 255], (y * w + x) * 4); }
    const m = peakingMask(d, w, h, 40);
    expect(m[(1 * w + 3) * 4 + 3]).toBe(255); expect(m[(1 * w + 4) * 4 + 3]).toBe(255); expect(m[(1 * w + 1) * 4 + 3]).toBe(0);
  });
  it('display LUT and filters', () => {
    const id = displayLut(0, 0, 1); expect(id[0]).toBe(0); expect(id[128]).toBe(128); expect(id[255]).toBe(255);
    expect(displayLut(50, 0, 1)[100]).toBeGreaterThan(100); expect(displayLut(0, 50, 1)[200]).toBeGreaterThan(200); expect(displayLut(0, 0, 2)[64]).toBeGreaterThan(64);
    const g = applyDisplay(rgba([200, 40, 40]), { grayscale: true }); expect(g[0]).toBe(g[1]); expect(g[1]).toBe(g[2]);
    const p = applyDisplay(rgba([200, 40, 40]), { colorBlind: 'protanopia' }); expect(p[0]).toBeLessThan(200);
    expect([...applyDisplay(rgba([10, 20, 30]), {}).subarray(0, 3)]).toEqual([10, 20, 30]);
  });
  it('OSD template and color formats', () => {
    expect(expandOsd('{name} {w}×{h}\n{missing}\n{n}/{total}', { name: 'a.jpg', w: 10, h: 5, n: 1, total: 3 })).toBe('a.jpg 10×5\n\n1/3');
    expect(formatColor([255, 0, 128], 'hex')).toBe('#ff0080'); expect(formatColor([255, 0, 128], 'rgb')).toBe('rgb(255, 0, 128)'); expect(formatColor([255, 0, 0], 'hsl')).toBe('hsl(0, 100%, 50%)'); expect(formatColor([250, 2, 3], 'name')).toBe('red');
  });
});
