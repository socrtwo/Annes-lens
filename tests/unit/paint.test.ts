import { describe, expect, it } from 'vitest';
import { dabAlpha, dabsAlong, newCoverage, cloneDab, healDab, redEyePixel, redEyeDab, replacePixel, colorReplaceDab, sprayDab, pencilLine, floodFill, arrowHead, hexRgba, rgbaHex, discMean } from '../../src/paint/engine';
import { rng } from '../../src/picture/effects';
import type { Raster } from '../../src/codecs/raster';

const ras = (w: number, h: number, f: (x: number, y: number) => [number, number, number, number]): Raster => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(f(x, y), (y * w + x) * 4); return { width: w, height: h, data: d as Uint8ClampedArray<ArrayBuffer> }; };
const px = (r: Raster, x: number, y: number) => [...r.data.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 4)];
const copy = (r: Raster): Raster => ({ width: r.width, height: r.height, data: r.data.slice() as Uint8ClampedArray<ArrayBuffer> });

describe('brush shape and spacing', () => {
  it('falls off from a hard core to the edge', () => {
    expect(dabAlpha(0, 10, 0.5)).toBe(1); expect(dabAlpha(5, 10, 0.5)).toBe(1); expect(dabAlpha(10, 10, 0.5)).toBe(0);
    expect(dabAlpha(7.5, 10, 0.5)).toBeCloseTo(0.5, 6); expect(dabAlpha(9.9, 10, 1)).toBe(1);
  });
  it('spaces dabs evenly along a path, carrying the remainder across segments', () => {
    const d = dabsAlong([[0, 0], [10, 0], [10, 10]], 4);
    expect(d.map((p) => p.map((v) => +v.toFixed(3)))).toEqual([[0, 0], [4, 0], [8, 0], [10, 2], [10, 6], [10, 10]]);
    expect(dabsAlong([[3, 3]], 4)).toEqual([[3, 3]]);
  });
});

describe('clone and heal', () => {
  const base = ras(40, 20, (x) => (x < 20 ? [200, 50, 50, 255] : [50, 50, 200, 255]));
  it('clones from an offset and does not smear on a second pass', () => {
    const work = copy(base), cov = newCoverage(40, 20);
    cloneDab(work, base, cov, 30, 10, -20, 0, 4, 1, 1);
    expect(px(work, 30, 10)).toEqual([200, 50, 50, 255]); expect(px(work, 36, 10)).toEqual([50, 50, 200, 255]);
    cloneDab(work, base, cov, 29, 10, -20, 0, 4, 1, 1); // overlapping dab reads the base again, not the painted pixels
    expect(px(work, 30, 10)).toEqual([200, 50, 50, 255]);
  });
  it('heals: source texture, target tone', () => {
    // Source: a checker on gray 100; target: flat gray 180. The healed pixels keep the checker's contrast at the target's level.
    const b = ras(40, 20, (x, y) => (x < 20 ? ((x + y) % 2 ? [120, 120, 120, 255] : [80, 80, 80, 255]) : [180, 180, 180, 255]));
    const work = copy(b), cov = newCoverage(40, 20);
    healDab(work, b, cov, 30, 10, -20, 0, 3, 1, 1);
    const a = px(work, 30, 10)[0], c = px(work, 31, 10)[0];
    expect(Math.abs(a - c)).toBeGreaterThan(30); expect(Math.abs((a + c) / 2 - 180)).toBeLessThan(6);
    expect(discMean(b, 30, 10, 3)[0]).toBe(180);
  });
});

describe('red-eye and color replacement', () => {
  it('removes a strong red cast and leaves skin and neutral pixels', () => {
    expect(redEyePixel(220, 40, 40)).toEqual([40, 40, 40]);
    expect(redEyePixel(200, 150, 120)).toEqual([200, 150, 120]); // skin
    expect(redEyePixel(40, 10, 10)).toEqual([40, 10, 10]); // too dark to judge
    const b = ras(10, 10, () => [230, 30, 50, 255]), w = copy(b), cov = newCoverage(10, 10);
    redEyeDab(w, b, cov, 5, 5, 3, 1); expect(px(w, 5, 5)).toEqual([40, 30, 50, 255]); expect(px(w, 0, 0)).toEqual([230, 30, 50, 255]);
  });
  it('replaces a color at each pixel\'s lightness, only within the tolerance', () => {
    expect(replacePixel([200, 30, 30], [200, 30, 30], [30, 30, 200], 40)).toEqual([105, 105, 255].map((v, i) => [Math.min(255, Math.round(30 * (0.299 * 200 + 0.587 * 30 + 0.114 * 30) / (0.299 * 30 + 0.587 * 30 + 0.114 * 200))), Math.min(255, Math.round(30 * (0.299 * 200 + 0.587 * 30 + 0.114 * 30) / (0.299 * 30 + 0.587 * 30 + 0.114 * 200))), 255][i]));
    expect(replacePixel([30, 200, 30], [200, 30, 30], [30, 30, 200], 40)).toBeNull();
    const b = ras(10, 10, (x) => (x < 5 ? [200, 30, 30, 255] : [30, 200, 30, 255])), w = copy(b), cov = newCoverage(10, 10);
    colorReplaceDab(w, b, cov, 5, 5, 10, 1, [200, 30, 30], [30, 30, 200], 40);
    expect(px(w, 2, 5)[2]).toBeGreaterThan(200); expect(px(w, 7, 5)).toEqual([30, 200, 30, 255]);
  });
});

describe('spray, pencil, fill, arrow', () => {
  it('sprays a deterministic number of dots inside the disc', () => {
    const w = ras(50, 50, () => [255, 255, 255, 255]); sprayDab(w, 25, 25, 10, [0, 0, 0, 255], 1, 60, rng(3));
    let dark = 0, outside = 0; for (let y = 0; y < 50; y++) for (let x = 0; x < 50; x++) if (px(w, x, y)[0] === 0) { dark++; if (Math.hypot(x + 0.5 - 25, y + 0.5 - 25) > 11.5) outside++; }
    expect(dark).toBeGreaterThan(30); expect(dark).toBeLessThanOrEqual(60); expect(outside).toBe(0);
  });
  it('draws a hard pencil line of the given width, clipped', () => {
    const w = ras(20, 10, () => [255, 255, 255, 255]); pencilLine(w, [2, 5], [17, 5], 3, [0, 0, 0, 255]);
    expect(px(w, 2, 4)[0]).toBe(0); expect(px(w, 10, 6)[0]).toBe(0); expect(px(w, 10, 7)[0]).toBe(255); expect(px(w, 1, 5)[0]).toBe(0);
    const c = ras(20, 10, () => [255, 255, 255, 255]); pencilLine(c, [0, 5], [19, 5], 1, [0, 0, 0, 255], { x: 5, y: 0, w: 5, h: 10 });
    expect(px(c, 4, 5)[0]).toBe(255); expect(px(c, 7, 5)[0]).toBe(0); expect(px(c, 10, 5)[0]).toBe(255);
  });
  it('fills the contiguous area only, or every matching pixel', () => {
    const r = ras(10, 10, (x) => (x === 4 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const a = floodFill(r, 1, 1, [255, 0, 0, 255], 16, true); expect(a.filled).toBe(40); expect(px(a.raster, 1, 1)).toEqual([255, 0, 0, 255]); expect(px(a.raster, 8, 1)).toEqual([255, 255, 255, 255]);
    const b = floodFill(r, 1, 1, [255, 0, 0, 255], 16, false); expect(b.filled).toBe(90);
    const h = floodFill(r, 1, 1, [255, 0, 0, 255], 16, true, 0.5); expect(px(h.raster, 1, 1)).toEqual([255, 128, 128, 255]);
  });
  it('points the arrowhead back along the line', () => {
    const [tip, l, r] = arrowHead([0, 0], [100, 0], 3);
    expect(tip).toEqual([100, 0]); expect(l[0]).toBeLessThan(100); expect(r[0]).toBeLessThan(100); expect(Math.sign(l[1])).toBe(-Math.sign(r[1]));
    expect(hexRgba('#ff8000')).toEqual([255, 128, 0, 255]); expect(rgbaHex([255, 128, 0])).toBe('#ff8000');
  });
});
