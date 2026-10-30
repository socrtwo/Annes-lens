import { describe, it, expect } from 'vitest';
import { dhash, phash, hamming, meanAbsDiff, quality, groupDuplicates, type Fingerprint } from '../../src/picture/similar';

const gray = (w: number, h: number, f: (x: number, y: number) => number) => { const g = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = f(x, y); return g; };
const seeded = (s: number) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };

describe('perceptual hashes', () => {
  it('are stable, 64 bits, and distance 0 for identical input', () => {
    const g = gray(9, 8, (x, y) => (x * 20 + y * 7) % 256);
    expect(dhash(g)).toMatch(/^[0-9a-f]{16}$/); expect(dhash(g)).toBe(dhash(g)); expect(hamming(dhash(g), dhash(g))).toBe(0);
    const p = gray(32, 32, (x, y) => 128 + 100 * Math.sin(x / 5) * Math.cos(y / 7));
    expect(phash(p)).toMatch(/^[0-9a-f]{16}$/); expect(hamming(phash(p), phash(p))).toBe(0);
  });
  it('tolerate brightness changes and mild noise, but separate different pictures', () => {
    const rnd = seeded(1);
    const base = gray(32, 32, (x, y) => 60 + 120 * Math.sin(x / 4) * Math.sin(y / 6) + rnd() * 10);
    const brighter = base.map((v) => Math.min(255, v * 1.3 + 20)) as Float32Array;
    const noisy = base.map((v) => v + (rnd() - 0.5) * 16) as Float32Array;
    const other = gray(32, 32, (x, y) => 128 + 120 * Math.cos(x / 3 + y / 2));
    expect(hamming(phash(base), phash(brighter))).toBeLessThanOrEqual(2);
    expect(hamming(phash(base), phash(noisy))).toBeLessThanOrEqual(8);
    expect(hamming(phash(base), phash(other))).toBeGreaterThan(16);
    expect(hamming('0000000000000000', 'ffffffffffffffff')).toBe(64); expect(hamming('00', '0f')).toBe(4);
    expect(meanAbsDiff(base, base)).toBe(0); expect(meanAbsDiff(base, brighter)).toBeGreaterThan(10);
  });
});

describe('quality', () => {
  it('ranks sharp over blurred, clean over noisy, mid-exposed over clipped', () => {
    const rnd = seeded(7);
    const w = 64, h = 64;
    const sharp = gray(w, h, (x, y) => ((x >> 3) + (y >> 3)) & 1 ? 200 : 50);
    const blurred = gray(w, h, (x, y) => 125 + 75 * Math.sin(x / 10) * Math.sin(y / 10));
    const noisy = gray(w, h, () => 125 + (rnd() - 0.5) * 60);
    const clipped = gray(w, h, (x) => (x < 48 ? 255 : 0));
    const qs = quality(sharp, w, h, 1), qb = quality(blurred, w, h, 1), qn = quality(noisy, w, h, 1), qc = quality(clipped, w, h, 1);
    expect(qs.sharpness).toBeGreaterThan(qb.sharpness);
    expect(qb.noise).toBeGreaterThan(qn.noise);
    expect(qb.exposure).toBeGreaterThan(qc.exposure);
    expect(quality(blurred, w, h, 4).compression).toBeGreaterThan(quality(blurred, w, h, 0.1).compression);
    expect(quality(blurred, w, h, null).compression).toBe(70);
    for (const q of [qs, qb, qn, qc]) for (const v of Object.values(q)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
  });
});

describe('grouping', () => {
  const fp = (name: string, o: Partial<Fingerprint>): Fingerprint => ({ entry: { name, uri: null, read: async () => new ArrayBuffer(0) }, width: 100, height: 80, size: 1000, dhash: '0000000000000000', phash: '0000000000000000', gray: new Float32Array(256), bytesHash: '', canvas: null, ...o });
  it('classifies identical, same-pixel, resized and similar pairs and keeps the largest first', () => {
    const a = fp('a', { bytesHash: 'x' }), b = fp('b', { bytesHash: 'x', size: 500 });
    const c = fp('c', { phash: '0000000000000001' }), d = fp('d', { width: 50, height: 40, dhash: '0000000000000003' });
    const far = fp('e', { phash: 'ffffffffffffffff', dhash: 'ffffffffffffffff' });
    const sim = fp('f', { phash: '000000000000003f', dhash: '000000000000003f' });
    const all = { identical: true, pixels: true, resized: true, similar: false, threshold: 8 };
    const g = groupDuplicates([b, a, c, d, far, sim], all);
    expect(g.length).toBe(1);
    expect(g[0].kind).toBe('resized');
    expect(g[0].items.map((x) => x.entry.name).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(g[0].items[0].entry.name).not.toBe('d'); // the small one is not first
    expect(g[0].items[0].entry.name).toBe('a'); // the larger file of the identical pair
    expect(groupDuplicates([b, a, c, d, far, sim], { ...all, similar: true }).length).toBe(1);
    expect(groupDuplicates([b, a, c, d, far, sim], { ...all, similar: true })[0].items.length).toBe(5);
    expect(groupDuplicates([a, b], { ...all, identical: false, pixels: false }).length).toBe(0);
    expect(groupDuplicates([a, far], all).length).toBe(0);
  });
});
