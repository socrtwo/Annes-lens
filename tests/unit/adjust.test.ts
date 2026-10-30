import { describe, it, expect } from 'vitest';
import { colorCorrect, saturate, vibrance, levels, autoLevels, autoContrast, autoColor, whiteBalance, equalize, hsl, rgbToHsl, hslToRgb, tint, posterize, colorBalance, channelMixer, gaussianBlur, boxBlur, unsharpMask, sharpen, despeckle, denoise, redEye, shadowsHighlights, vignette, dehaze, clarity, autoAdjust, enhance, restoreFaded } from '../../src/picture/adjust';
import type { Raster } from '../../src/codecs/raster';

const raster = (w: number, h: number, px: number[][]): Raster => ({ width: w, height: h, data: Uint8ClampedArray.from(px.flat()) as Uint8ClampedArray<ArrayBuffer> });
const px = (r: Raster, x: number, y: number) => [...r.data.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 3)];
const gray = (v: number) => [v, v, v, 255];

describe('tone', () => {
  it('brightness, contrast, gamma, exposure and channel balance', () => {
    const r = raster(1, 1, [gray(100)]);
    expect(px(colorCorrect(r, { brightness: 20 }), 0, 0)).toEqual([120, 120, 120]);
    expect(px(colorCorrect(r, { contrast: 50 }), 0, 0)[0]).toBeLessThan(100);
    expect(px(colorCorrect(raster(1, 1, [gray(200)]), { contrast: 50 }), 0, 0)[0]).toBeGreaterThan(200);
    expect(px(colorCorrect(r, { gamma: 2 }), 0, 0)[0]).toBeGreaterThan(100);
    expect(px(colorCorrect(r, { exposure: 1 }), 0, 0)).toEqual([200, 200, 200]);
    expect(px(colorCorrect(r, { red: 30, blue: -30 }), 0, 0)).toEqual([130, 100, 70]);
    expect(px(colorCorrect(r, {}), 0, 0)).toEqual([100, 100, 100]);
  });
  it('levels and automatic stretches', () => {
    expect(px(levels(raster(1, 1, [gray(50)]), { inBlack: 50, inWhite: 150 }), 0, 0)).toEqual([0, 0, 0]);
    expect(px(levels(raster(1, 1, [gray(150)]), { inBlack: 50, inWhite: 150, outWhite: 200 }), 0, 0)).toEqual([200, 200, 200]);
    expect(px(levels(raster(1, 1, [[100, 100, 100, 255]]), { inBlack: 50, channel: 'r' }), 0, 0)).toEqual([62, 100, 100]);
    const pxs: number[][] = []; for (let i = 0; i < 400; i++) pxs.push([60 + (i % 100), 80 + (i % 100), 100 + (i % 100), 255]);
    const flat = raster(20, 20, pxs);
    const al = autoLevels(flat);
    let mn = 255, mx = 0; for (let i = 0; i < al.data.length; i += 4) { mn = Math.min(mn, al.data[i]); mx = Math.max(mx, al.data[i]); }
    expect(mn).toBeLessThan(5); expect(mx).toBeGreaterThan(250);
    const ac = autoContrast(flat);
    expect(ac.data[0]).toBeLessThan(ac.data[2]); // the blue cast stays with auto contrast
    const col = autoColor(flat);
    expect(Math.abs(col.data[0] - col.data[2])).toBeLessThan(Math.abs(flat.data[0] - flat.data[2]));
    expect(equalize(flat).data.length).toBe(flat.data.length);
    expect(restoreFaded(flat).data.length).toBe(flat.data.length);
    expect(autoAdjust(flat).data.length).toBe(flat.data.length); expect(enhance(flat).data.length).toBe(flat.data.length);
  });
  it('white balance, shadows/highlights, vignette, dehaze and clarity run and pull in the expected direction', () => {
    const r = raster(1, 1, [[100, 120, 140, 255]]);
    expect(px(whiteBalance(r, { neutral: [100, 120, 140] }), 0, 0)).toEqual([120, 120, 120]);
    expect(px(whiteBalance(r, { temperature: 100 }), 0, 0)[0]).toBeGreaterThan(100);
    const img: number[][] = []; for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) img.push(gray(x < 8 ? 30 : 220));
    const sh = shadowsHighlights(raster(16, 16, img), 100, 0, 2);
    expect(px(sh, 0, 0)[0]).toBeGreaterThan(30);
    const v = vignette(raster(16, 16, img.map(() => gray(200))), 100, 0.2);
    expect(px(v, 0, 0)[0]).toBeLessThan(px(v, 8, 8)[0]);
    expect(dehaze(raster(16, 16, img.map(() => gray(180))), 50).data.length).toBe(16 * 16 * 4);
    expect(clarity(raster(16, 16, img), 50).data.length).toBe(16 * 16 * 4);
  });
});

describe('color', () => {
  it('saturation, vibrance, HSL, tint, posterize, balance and mixers', () => {
    const r = raster(1, 1, [[200, 100, 100, 255]]);
    expect(px(saturate(r, -1), 0, 0)).toEqual([130, 130, 130]);
    expect(px(saturate(r, 1), 0, 0)[0]).toBeGreaterThan(200);
    expect(px(vibrance(raster(1, 1, [[140, 120, 120, 255]]), 1), 0, 0)[0]).toBeGreaterThan(140);
    const [h, s, l] = rgbToHsl(255, 0, 0); expect([h, s, l]).toEqual([0, 1, 0.5]); expect(hslToRgb(h, s, l)).toEqual([255, 0, 0]);
    expect(px(hsl(raster(1, 1, [[255, 0, 0, 255]]), { hue: 120 }), 0, 0)).toEqual([0, 255, 0]);
    expect(px(hsl(raster(1, 1, [[255, 0, 0, 255]]), { saturation: -100 }), 0, 0)).toEqual([128, 128, 128]);
    expect(px(hsl(raster(1, 1, [[100, 100, 100, 255]]), { lightness: 50 }), 0, 0)[0]).toBeGreaterThan(150);
    const sep = px(tint(raster(1, 1, [gray(128)]), [112, 66, 20], 1), 0, 0); expect(sep[0]).toBeGreaterThan(sep[2]);
    expect(px(posterize(raster(1, 1, [[100, 200, 10, 255]]), 2), 0, 0)).toEqual([0, 255, 0]);
    expect(px(colorBalance(raster(1, 1, [gray(30)]), { shadows: [50, 0, 0] }), 0, 0)[0]).toBeGreaterThan(30);
    expect(px(channelMixer(raster(1, 1, [[100, 50, 0, 255]]), [[0, 100, 0], [100, 0, 0], [0, 0, 100]]), 0, 0)).toEqual([50, 100, 0]);
    expect(px(channelMixer(raster(1, 1, [[100, 50, 0, 255]]), [[50, 50, 0], [0, 0, 0], [0, 0, 0]], true), 0, 0)).toEqual([75, 75, 75]);
  });
});

describe('detail', () => {
  it('blurs spread a dot, unsharp mask strengthens an edge, despeckle removes a speckle, denoise keeps edges, red-eye reduces red', () => {
    const dot: number[][] = []; for (let i = 0; i < 25; i++) dot.push(gray(i === 12 ? 255 : 0));
    const g = gaussianBlur(raster(5, 5, dot), 2);
    expect(px(g, 2, 2)[0]).toBeLessThan(255); expect(px(g, 1, 2)[0]).toBeGreaterThan(0);
    const bx = boxBlur(raster(5, 5, dot), 1);
    expect(px(bx, 1, 1)[0]).toBe(28); // 255 / 9
    const edge: number[][] = []; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) edge.push(gray(x < 4 ? 80 : 160));
    const u = unsharpMask(raster(8, 8, edge), 100, 1, 0);
    expect(px(u, 3, 3)[0]).toBeLessThan(80); expect(px(u, 4, 3)[0]).toBeGreaterThan(160);
    expect(sharpen(raster(8, 8, edge)).data.length).toBe(256);
    const d = despeckle(raster(5, 5, dot));
    expect(px(d, 2, 2)[0]).toBe(0);
    const dn = denoise(raster(8, 8, edge), 2, 20);
    expect(px(dn, 3, 3)[0]).toBeLessThan(100); expect(px(dn, 4, 3)[0]).toBeGreaterThan(140);
    expect(px(redEye(raster(1, 1, [[220, 40, 50, 255]])), 0, 0)[0]).toBeLessThan(60);
    expect(px(redEye(raster(1, 1, [[120, 110, 100, 255]])), 0, 0)).toEqual([120, 110, 100]);
  });
});
