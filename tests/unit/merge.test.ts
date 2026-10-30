import { describe, it, expect } from 'vitest';
import { exposureFusion, focusStack, fusionWeights } from '../../src/picture/merge';
import type { Raster } from '../../src/codecs/raster';

const raster = (w: number, h: number, f: (x: number, y: number) => number[]): Raster => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = f(x, y); d.set([p[0], p[1], p[2], 255], (y * w + x) * 4); } return { width: w, height: h, data: d as Uint8ClampedArray<ArrayBuffer> }; };
const px = (r: Raster, x: number, y: number) => [...r.data.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 3)];

describe('merging', () => {
  it('exposure fusion prefers the well-exposed source per region', () => {
    // Left half: dark picture is right (bright one clips); right half: bright picture is right (dark one is black).
    const dark = raster(64, 32, (x) => (x < 32 ? [120, 110, 100] : [5, 5, 5]));
    const bright = raster(64, 32, (x) => (x < 32 ? [255, 255, 255] : [130, 120, 110]));
    const w = fusionWeights([dark, bright]);
    expect(w[0][16]).toBeGreaterThan(w[1][16]); expect(w[1][48]).toBeGreaterThan(w[0][48]);
    const out = exposureFusion([dark, bright], { levels: 3 });
    expect(out.width).toBe(64); expect(px(out, 8, 16)[0]).toBeLessThan(200); expect(px(out, 8, 16)[0]).toBeGreaterThan(90); expect(px(out, 56, 16)[0]).toBeGreaterThan(60);
    expect(exposureFusion([dark])).toBe(dark);
  });
  it('focus stack takes the sharp half of each source', () => {
    const chk = (x: number, y: number) => ((x + y) & 1 ? 255 : 0);
    const a = raster(40, 20, (x, y) => (x < 20 ? [chk(x, y), chk(x, y), chk(x, y)] : [128, 128, 128])); // sharp left, flat right
    const b = raster(40, 20, (x, y) => (x >= 20 ? [chk(x, y), chk(x, y), chk(x, y)] : [128, 128, 128])); // sharp right
    const { raster: out, map } = focusStack([a, b], 2);
    expect(map[10 * 40 + 5]).toBe(0); expect(map[10 * 40 + 35]).toBe(1);
    expect(px(out, 5, 10)[0]).toBe(chk(5, 10)); expect(px(out, 35, 10)[0]).toBe(chk(35, 10));
  });
});
