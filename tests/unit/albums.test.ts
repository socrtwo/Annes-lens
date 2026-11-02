import { describe, expect, it } from 'vitest';
import { addRefs, refOf, specToStore, specFromStore, describeSpec, type Album } from '../../src/picture/albums';
import { colorLayout, sketchDistance } from '../../src/picture/sketch';
import type { Raster } from '../../src/codecs/raster';

const ras = (w: number, h: number, f: (x: number, y: number) => [number, number, number, number]): Raster => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(f(x, y), (y * w + x) * 4); return { width: w, height: h, data: d as Uint8ClampedArray<ArrayBuffer> }; };
const entry = (name: string, uri: string | null, size = 100) => ({ name, uri, size, read: async () => new ArrayBuffer(0) });

describe('albums', () => {
  it('keeps pictures that have an address and skips duplicates', async () => {
    expect(refOf(entry('a.jpg', null))).toBeNull();
    const a: Album = { id: 'x', name: 'A', created: 0, items: [] };
    const r1 = refOf(entry('a.jpg', 'file:///p/a.jpg'))!, r2 = refOf(entry('b.jpg', 'content://t/b'))!;
    expect(await addRefs(a, [r1, r2, { ...r1 }])).toBe(2);
    expect(await addRefs(a, [refOf(entry('a.jpg', 'file:///p/a.jpg'))!])).toBe(0);
    expect(a.items.map((i) => i.uri)).toEqual(['file:///p/a.jpg', 'content://t/b']);
    // Browser handles: the same name and size count as the same picture when isSameEntry cannot tell.
    const h = { name: 'c.png', kind: 'file' };
    expect(await addRefs(a, [{ uri: null, name: 'c.png', size: 7, handle: h, added: 0 }, { uri: null, name: 'c.png', size: 7, handle: { ...h }, added: 0 }])).toBe(1);
  });
  it('stores filters with their dates and describes them', () => {
    const spec = { minRating: 3, keyword: 'reunion', from: new Date('2019-06-01T00:00:00Z'), to: null, hasGps: true };
    const back = specFromStore(JSON.parse(JSON.stringify(specToStore(spec))));
    expect(back.from!.toISOString()).toBe('2019-06-01T00:00:00.000Z'); expect(back.to).toBeNull();
    expect(describeSpec(back)).toBe('★3+ · keyword "reunion" · with location · 2019-06-01 to …');
    expect(describeSpec({})).toBe('everything');
  });
});

describe('search by sketch', () => {
  // A landscape: blue sky over green fields; a beach: blue over sand; a night picture.
  const landscape = ras(96, 72, (_x, y) => (y < 36 ? [70, 130, 220, 255] : [50, 140, 60, 255]));
  const beach = ras(96, 72, (_x, y) => (y < 36 ? [70, 130, 220, 255] : [220, 200, 140, 255]));
  const night = ras(96, 72, () => [15, 15, 30, 255]);
  it('ranks pictures by the painted layout and ignores empty parts of the sketch', () => {
    const sketch = ras(240, 180, (_x, y) => (y < 60 ? [60, 125, 215, 255] : y > 120 ? [45, 145, 55, 255] : [0, 0, 0, 0]));
    const sk = colorLayout(sketch, true);
    expect(sk.painted!.filter((p) => p === 0).length).toBe(36); // the empty middle band: 3 rows of 12 cells
    const d = [landscape, beach, night].map((r) => sketchDistance(sk, colorLayout(r))!);
    expect(d[0]).toBeLessThan(d[1]); expect(d[1]).toBeLessThan(d[2]);
    expect(d[0]).toBeLessThan(5);
    expect(sketchDistance(colorLayout(ras(240, 180, () => [0, 0, 0, 0]), true), colorLayout(landscape))).toBeNull();
  });
});
