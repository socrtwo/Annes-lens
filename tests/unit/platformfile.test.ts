import { describe, expect, it } from 'vitest';
import { expandImportName, tidyScan } from '../../src/commands/platformFile';
import type { Raster } from '../../src/codecs/raster';

describe('import names', () => {
  const date = new Date(2026, 9, 30, 14, 5);
  it('expands the fields and keeps the extension', () => {
    expect(expandImportName('{name}', { name: 'IMG_0001.JPG', date, n: 3 })).toBe('IMG_0001.JPG');
    expect(expandImportName('{date} {n:4}', { name: 'IMG_0001.JPG', date, n: 3 })).toBe('2026-10-30 0003.JPG');
    expect(expandImportName('{yyyy}{mm}{dd}_{hh}{min} {name}', { name: 'a.png', date, n: 1 })).toBe('20261030_1405 a.png');
    expect(expandImportName('{yyyy}/{date}.x', { name: 'x.x', date, n: 1 })).toBe('2026/2026-10-30.x');
  });
});

describe('scan tidying', () => {
  it('leaves a plain page alone when nothing is asked and deskews a slight tilt', () => {
    const w = 120, h = 80, r: Raster = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) as Uint8ClampedArray<ArrayBuffer> };
    expect(tidyScan(r, { autoCrop: false, deskew: false })).toBe(r);
    const t = tidyScan(r, { autoCrop: false, deskew: true }); expect([t.width, t.height]).toEqual([w, h]);
  });
});
