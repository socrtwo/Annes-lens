import { describe, it, expect } from 'vitest';
import { curveLut, curves, toneEqualizer, selectiveColor, parseCube, applyLut3d, dustScratches, descreen } from '../../src/picture/adjust';
import type { Raster } from '../../src/codecs/raster';

const raster = (w: number, h: number, f: (x: number, y: number) => number[]): Raster => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = f(x, y); d.set([p[0], p[1], p[2], 255], (y * w + x) * 4); } return { width: w, height: h, data: d as Uint8ClampedArray<ArrayBuffer> }; };
const px = (r: Raster, x: number, y: number) => [...r.data.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 3)];

describe('curves', () => {
  it('identity, monotone interpolation, clamping and per-channel composition', () => {
    const id = curveLut([[0, 0], [255, 255]]); for (const v of [0, 17, 128, 255]) expect(id[v]).toBe(v);
    const s = curveLut([[0, 0], [64, 48], [192, 208], [255, 255]]);
    expect(s[64]).toBe(48); expect(s[192]).toBe(208); expect(s[128]).toBeGreaterThan(120); expect(s[128]).toBeLessThan(136);
    for (let i = 1; i < 256; i++) expect(s[i]).toBeGreaterThanOrEqual(s[i - 1]); // monotone, no overshoot
    expect(curveLut([[0, 255], [255, 0]])[10]).toBe(245);
    expect(curveLut([[40, 0], [200, 255]])[10]).toBe(0); expect(curveLut([[40, 0], [200, 255]])[250]).toBe(255);
    expect(curveLut([])[100]).toBe(100); expect(curveLut([[128, 200]])[5]).toBe(200);
    const r = raster(1, 1, () => [100, 100, 100]);
    expect(px(curves(r, { all: [[0, 0], [128, 160], [255, 255]] }), 0, 0)[0]).toBeGreaterThan(110);
    expect(px(curves(r, { r: [[0, 255], [255, 0]] }), 0, 0)).toEqual([155, 100, 100]);
  });
});

describe('tone equalizer and selective color', () => {
  it('lifts only the band asked for', () => {
    const r = raster(32, 32, (x) => (x < 16 ? [30, 30, 30] : [220, 220, 220]));
    const t = toneEqualizer(r, [60, 0, 0, 0, 0], 2);
    expect(px(t, 2, 16)[0]).toBeGreaterThan(30); expect(px(t, 30, 16)[0]).toBe(220);
    const w = toneEqualizer(r, [0, 0, 0, 0, -60], 2);
    expect(px(w, 30, 16)[0]).toBeLessThan(220); expect(px(w, 2, 16)[0]).toBe(30);
  });
  it('selective color changes reds, leaves blues', () => {
    const r = raster(2, 1, (x) => (x ? [40, 40, 220] : [220, 40, 40]));
    const s = selectiveColor(r, { reds: { saturation: -100 } });
    const red = px(s, 0, 0); expect(Math.abs(red[0] - red[1])).toBeLessThan(5);
    expect(px(s, 1, 0)).toEqual([40, 40, 220]);
    expect(px(selectiveColor(r, { blues: { lightness: 50 } }), 1, 0)[2]).toBeGreaterThan(220);
    expect(px(selectiveColor(r, {}), 0, 0)).toEqual([220, 40, 40]);
  });
});

describe('3-D LUTs', () => {
  const cube = (size: number, f: (r: number, g: number, b: number) => number[]) => { const lines = [`TITLE "t"`, `LUT_3D_SIZE ${size}`]; for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) lines.push(f(r / (size - 1), g / (size - 1), b / (size - 1)).join(' ')); return lines.join('\n'); };
  it('parses .cube and applies identity and inversion with interpolation', () => {
    const id = parseCube(cube(3, (r, g, b) => [r, g, b]));
    expect(id.size).toBe(3); expect(id.title).toBe('t');
    const r = raster(1, 1, () => [37, 150, 240]);
    expect(px(applyLut3d(r, id), 0, 0)).toEqual([37, 150, 240]);
    expect(px(applyLut3d(r, parseCube(cube(2, (x, y, z) => [1 - x, 1 - y, 1 - z]))), 0, 0)).toEqual([218, 105, 15]);
    expect(px(applyLut3d(r, parseCube(cube(2, (x, y, z) => [1 - x, 1 - y, 1 - z])), 0.5), 0, 0)[2]).toBe(128);
    expect(() => parseCube('LUT_3D_SIZE 4\n0 0 0')).toThrow();
    const oneD = parseCube('LUT_1D_SIZE 2\n0 0 0\n0.5 0.5 0.5'); expect(px(applyLut3d(raster(1, 1, () => [255, 255, 255]), oneD), 0, 0)).toEqual([128, 128, 128]);
  });
});

describe('scans', () => {
  it('dust and scratches removes a speck and reports the mask; descreen smooths a screen', () => {
    const r = raster(9, 9, (x, y) => (x === 4 && y === 4 ? [255, 255, 255] : [60, 60, 60]));
    const { raster: out, mask } = dustScratches(r, 1, 24);
    expect(px(out, 4, 4)).toEqual([60, 60, 60]); expect(mask[4 * 9 + 4]).toBe(1); expect(mask.reduce((a, b) => a + b, 0)).toBe(1);
    const screen = raster(32, 32, (x, y) => ((x + y) & 1 ? [255, 255, 255] : [0, 0, 0]));
    const d = descreen(screen, 4, 0);
    expect(Math.abs(px(d, 16, 16)[0] - px(d, 17, 16)[0])).toBeLessThan(40);
  });
});
