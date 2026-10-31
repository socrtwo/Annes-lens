import { describe, expect, it } from 'vitest';
import { traceMask, area, simplify, pathData, traceToSvg } from '../../src/picture/trace';
import type { Raster } from '../../src/codecs/raster';

const maskOf = (w: number, h: number, f: (x: number, y: number) => boolean) => { const m = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = f(x, y) ? 1 : 0; return m; };
const count = (m: Uint8Array) => m.reduce((s, v) => s + (v ? 1 : 0), 0);
const total = (loops: [number, number][][]) => Math.abs(loops.reduce((s, l) => s + area(l), 0));

describe('exact contour tracing', () => {
  it('traces a square as one 4-corner loop with the exact area', () => {
    const m = maskOf(10, 8, (x, y) => x >= 2 && x < 7 && y >= 1 && y < 5);
    const loops = traceMask(m, 10, 8);
    expect(loops.length).toBe(1); expect(loops[0].length).toBe(4); expect(Math.abs(area(loops[0]))).toBe(20);
  });
  it('keeps a hole as a second loop of opposite orientation (net area = pixels)', () => {
    const m = maskOf(12, 12, (x, y) => x >= 1 && x < 11 && y >= 1 && y < 11 && !(x >= 4 && x < 8 && y >= 4 && y < 8));
    const loops = traceMask(m, 12, 12);
    expect(loops.length).toBe(2); expect(Math.sign(area(loops[0]))).not.toBe(Math.sign(area(loops[1])));
    expect(total(loops)).toBe(count(m));
  });
  it('joins diagonally touching pixels and still matches the pixel count', () => {
    const m = maskOf(4, 4, (x, y) => (x === 0 && y === 0) || (x === 1 && y === 1) || (x === 2 && y === 2));
    const loops = traceMask(m, 4, 4);
    expect(total(loops)).toBe(3);
  });
  it('matches the pixel count on a random blob field (every edge used once)', () => {
    let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const m = maskOf(40, 30, () => rnd() < 0.45);
    expect(total(traceMask(m, 40, 30))).toBe(count(m));
  });
  it('traces a disc whose simplified outline stays close in area and much shorter', () => {
    const m = maskOf(80, 80, (x, y) => (x + 0.5 - 40) ** 2 + (y + 0.5 - 40) ** 2 < 30 * 30);
    const [loop] = traceMask(m, 80, 80);
    const s = simplify(loop, 1);
    expect(s.length).toBeLessThan(loop.length / 2);
    expect(Math.abs(Math.abs(area(s)) - count(m)) / count(m)).toBeLessThan(0.03);
  });
  it('writes lines at sharp corners and curves elsewhere', () => {
    expect(pathData([[0, 0], [10, 0], [10, 10], [0, 10]], true)).not.toContain('Q');
    const circle: [number, number][] = Array.from({ length: 24 }, (_, i) => [50 + 20 * Math.cos(i / 24 * 2 * Math.PI), 50 + 20 * Math.sin(i / 24 * 2 * Math.PI)]);
    const d = pathData(circle, true); expect(d).toContain('Q'); expect(d).not.toContain('L'); expect(d.endsWith('Z')).toBe(true);
  });
});

describe('traceToSvg', () => {
  const ras = (w: number, h: number, f: (x: number, y: number) => [number, number, number, number]): Raster => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(f(x, y), (y * w + x) * 4); return { width: w, height: h, data: d as Uint8ClampedArray<ArrayBuffer> }; };
  it('line art: one black path, Otsu threshold, speckles dropped', () => {
    const r = ras(40, 40, (x, y) => ((x >= 5 && x < 30 && y >= 5 && y < 30) || (x === 37 && y === 37) ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const t = traceToSvg(r, { mode: 'bw', minArea: 4, tolerance: 0, smooth: false });
    expect(t.paths).toBe(1); expect(t.svg).toContain('viewBox="0 0 40 40"'); expect(t.svg).toContain('fill="#000000"');
    expect(t.svg).toContain('M5 5L30 5L30 30L5 30Z');
  });
  it('color mode: one path per color, largest first, gap stroke', () => {
    const r = ras(30, 20, (x) => (x < 20 ? [200, 30, 30, 255] : [20, 40, 220, 255]));
    const t = traceToSvg(r, { mode: 'color', colors: 2, tolerance: 0, smooth: false });
    expect(t.paths).toBe(2); expect(t.colors.length).toBe(2);
    const first = t.colors[0]; expect(parseInt(first.slice(1, 3), 16)).toBeGreaterThan(150); // the red (larger) area first
    expect(t.svg).toMatch(/stroke-width="0.8"/);
  });
  it('skips transparent pixels and adds a background when asked', () => {
    const r = ras(10, 10, (x) => (x < 5 ? [0, 0, 0, 255] : [0, 0, 0, 0]));
    const t = traceToSvg(r, { mode: 'bw', tolerance: 0, smooth: false, background: '#ffffff' });
    expect(t.svg).toContain('<rect width="10" height="10" fill="#ffffff"/>'); expect(t.svg).toContain('M0 0L5 0L5 10L0 10Z');
  });
});
