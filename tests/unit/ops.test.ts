import { describe, it, expect } from 'vitest';
import { crop, canvasSize, resample, grayscale, negative, otsu, threshold, adaptiveThreshold, reduceColors, swapChannels, showChannel, flatten, replaceColor, autoCropRect, clampRect, hexToRgb } from '../../src/picture/ops';
import type { Raster } from '../../src/codecs/raster';

const raster = (w: number, h: number, px: number[][]): Raster => ({ width: w, height: h, data: Uint8ClampedArray.from(px.flat()) as Uint8ClampedArray<ArrayBuffer> });
const px = (r: Raster, x: number, y: number) => [...r.data.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 4)];
const RED = [255, 0, 0, 255], GREEN = [0, 255, 0, 255], BLUE = [0, 0, 255, 255], WHITE = [255, 255, 255, 255], BLACK = [0, 0, 0, 255], CLEAR = [0, 0, 0, 0];

describe('geometry', () => {
  it('crops, clamps rectangles and resizes the canvas with an anchor', () => {
    const r = raster(3, 2, [RED, GREEN, BLUE, WHITE, BLACK, CLEAR]);
    expect([...crop(r, { x: 1, y: 0, w: 2, h: 2 }).data]).toEqual([...GREEN, ...BLUE, ...BLACK, ...CLEAR]);
    expect(clampRect({ x: -5, y: 1, w: 10, h: 10 }, 3, 2)).toEqual({ x: 0, y: 1, w: 3, h: 1 });
    expect(clampRect({ x: 5, y: 5, w: 1, h: 1 }, 3, 2)).toBeNull();
    const c = canvasSize(raster(1, 1, [RED]), 3, 3, 1, 1, [0, 0, 255, 255]);
    expect(px(c, 1, 1)).toEqual(RED); expect(px(c, 0, 0)).toEqual(BLUE);
    const off = canvasSize(raster(2, 1, [RED, GREEN]), 1, 1, -1, 0, [0, 0, 0, 0]);
    expect(px(off, 0, 0)).toEqual(GREEN);
  });
  it('resamples: nearest keeps exact pixels on integer scales, Lanczos keeps flat colors and alpha', () => {
    const r = raster(2, 2, [RED, GREEN, BLUE, WHITE]);
    const up = resample(r, 4, 4, 'nearest');
    expect(px(up, 1, 1)).toEqual(RED); expect(px(up, 3, 0)).toEqual(GREEN); expect(px(up, 0, 3)).toEqual(BLUE);
    const flat = resample(raster(5, 5, Array(25).fill([30, 60, 90, 255])), 13, 7, 'lanczos3');
    for (let y = 0; y < 7; y++) for (let x = 0; x < 13; x++) expect(px(flat, x, y)).toEqual([30, 60, 90, 255]);
    const down = resample(raster(8, 8, Array(64).fill(CLEAR).map((_, i) => (i % 2 ? RED : CLEAR))), 4, 4, 'bilinear');
    expect(down.data[3]).toBeGreaterThan(100); expect(down.data[3]).toBeLessThan(200);
    expect(px(down, 0, 0).slice(0, 3)).toEqual([255, 0, 0]); // transparent pixels do not bleed black into the color
    const lin = resample(raster(2, 1, [BLACK, WHITE]), 3, 1, 'bilinear', true);
    expect(px(lin, 1, 0)[0]).toBeGreaterThan(150); // mid-gray in linear light is brighter than 128
    for (const k of ['box', 'bicubic', 'mitchell', 'catmullrom', 'bspline', 'lanczos2'] as const) expect(resample(r, 3, 5, k).data.length).toBe(60);
  });
});

describe('color', () => {
  it('grayscale, negative, channel swaps and views, flatten', () => {
    expect(px(grayscale(raster(1, 1, [RED])), 0, 0)).toEqual([76, 76, 76, 255]);
    expect(px(negative(raster(1, 1, [RED])), 0, 0)).toEqual([0, 255, 255, 255]);
    expect(px(negative(raster(1, 1, [RED]), [false, true, false]), 0, 0)).toEqual([255, 255, 0, 255]);
    expect(px(swapChannels(raster(1, 1, [[10, 20, 30, 40]]), 'bgr'), 0, 0)).toEqual([30, 20, 10, 40]);
    expect(px(showChannel(raster(1, 1, [[10, 20, 30, 40]]), 'alpha'), 0, 0)).toEqual([40, 40, 40, 255]);
    expect(px(flatten(raster(1, 1, [[255, 0, 0, 128]]), [0, 0, 255]), 0, 0)).toEqual([128, 0, 127, 255]);
  });
  it('thresholds: Otsu separates two clusters; fixed and adaptive levels', () => {
    const pxs: number[][] = []; for (let i = 0; i < 100; i++) pxs.push(i < 50 ? [40, 40, 40, 255] : [200, 200, 200, 255]);
    const r = raster(10, 10, pxs);
    const t = otsu(r); expect(t).toBeGreaterThanOrEqual(40); expect(t).toBeLessThan(200);
    expect(px(threshold(r, t), 0, 0)).toEqual(BLACK); expect(px(threshold(r, t), 9, 9)).toEqual(WHITE);
    const ad = adaptiveThreshold(r, 2, 0);
    expect(px(ad, 9, 9)).toEqual(WHITE);
  });
  it('reduces colors with every dithering mode and keeps alpha', () => {
    const pxs: number[][] = []; for (let i = 0; i < 64; i++) pxs.push([i * 4, 128, 255 - i * 4, i < 8 ? 0 : 255]);
    const r = raster(8, 8, pxs);
    for (const d of ['none', 'floyd', 'atkinson', 'ordered'] as const) {
      const { raster: out, palette } = reduceColors(r, 4, d);
      expect(palette.colors.length).toBe(4);
      const seen = new Set<string>();
      for (let i = 0; i < out.data.length; i += 4) seen.add(out.data.slice(i, i + 3).join(','));
      expect(seen.size, d).toBeLessThanOrEqual(4);
      expect(out.data[3]).toBe(0); expect(out.data[63 * 4 + 3]).toBe(255);
    }
    const gray = reduceColors(r, 2, 'none', { colors: [[0, 0, 0], [255, 255, 255]] });
    expect([...gray.raster.data.subarray(0, 3)]).toEqual([255, 255, 255]);
    expect([...gray.raster.data.subarray(63 * 4, 63 * 4 + 3)]).toEqual([0, 0, 0]);
  });
  it('replaces or clears a color within a tolerance, and finds uniform borders', () => {
    const r = raster(2, 1, [[250, 250, 250, 255], BLUE]);
    expect(px(replaceColor(r, [255, 255, 255], 8, null), 0, 0)[3]).toBe(0);
    expect(px(replaceColor(r, [255, 255, 255], 8, [0, 255, 0, 255]), 0, 0)).toEqual(GREEN);
    expect(px(replaceColor(r, [255, 255, 255], 8, null), 1, 0)).toEqual(BLUE);
    const bordered: number[][] = []; for (let y = 0; y < 6; y++) for (let x = 0; x < 7; x++) bordered.push(x >= 2 && x < 5 && y >= 1 && y < 4 ? RED : WHITE);
    expect(autoCropRect(raster(7, 6, bordered))).toEqual({ x: 2, y: 1, w: 3, h: 3 });
    expect(autoCropRect(raster(2, 2, [RED, GREEN, BLUE, WHITE]))).toBeNull();
    expect(autoCropRect(raster(2, 2, [WHITE, WHITE, WHITE, WHITE]))).toBeNull();
    expect(hexToRgb('#1a2b3c')).toEqual([26, 43, 60]);
  });
});
