import { describe, it, expect } from 'vitest';
import { expandName, uniqueName, writeZip } from '../../src/picture/batch';
import { readZip, readZipEntry } from '../../src/codecs/zip';

describe('batch names', () => {
  const ctx = { name: 'IMG_0042', ext: 'jpg', index: 2, date: new Date(2026, 4, 17, 9, 5, 3), exifDate: new Date(2024, 0, 2, 3, 4, 5), make: 'Acme', model: 'X1', width: 640, height: 480 };
  it('expands fields, counters with padding, dates and case', () => {
    expect(expandName({ pattern: '{name}' }, ctx)).toBe('IMG_0042');
    expect(expandName({ pattern: 'pic-{n:4}', start: 10, step: 5 }, ctx)).toBe('pic-0020');
    expect(expandName({ pattern: '{date}_{time}_{n}', pad: 3 }, ctx)).toBe('2026-05-17_090503_003');
    expect(expandName({ pattern: '{yyyy}{mm}{dd}-{exifdate}-{make}-{model}-{w}x{h}' }, ctx)).toBe('20260517-2024-01-02-Acme-X1-640x480');
    expect(expandName({ pattern: '{name}', case: 'lower' }, ctx)).toBe('img_0042');
    expect(expandName({ pattern: 'my photo', case: 'title' }, ctx)).toBe('My Photo');
    expect(expandName({ pattern: '{name}', find: 'IMG_', replace: 'holiday-' }, ctx)).toBe('holiday-0042');
    expect(expandName({ pattern: '{name}', find: '(\\d+)$', replace: 'n$1', regex: true }, ctx)).toBe('IMG_n0042');
    expect(expandName({ pattern: 'a/b:c*{unknown}' }, ctx)).toBe('a_b_c_{unknown}');
    expect(expandName({ pattern: '' }, { ...ctx, index: 0 })).toBe('picture-1');
  });
  it('makes names unique', () => {
    const used = new Set<string>();
    expect(uniqueName('a.jpg', used)).toBe('a.jpg');
    expect(uniqueName('A.JPG', used)).toBe('A (2).JPG');
    expect(uniqueName('a.jpg', used)).toBe('a (3).jpg');
  });
  it('writes a ZIP the reader lists and extracts', () => {
    const z = writeZip([{ name: 'one.png', data: Uint8Array.from([1, 2, 3]) }, { name: 'sub/two.jpg', data: new Uint8Array(1000).fill(7), mtime: Date.UTC(2025, 5, 6) }]);
    const { entries, warnings } = readZip(z);
    expect(warnings).toEqual([]);
    expect(entries.map((e) => [e.name, e.size, e.method])).toEqual([['one.png', 3, 0], ['sub/two.jpg', 1000, 0]]);
    expect([...readZipEntry(z, entries[0])]).toEqual([1, 2, 3]);
    expect(readZipEntry(z, entries[1])[999]).toBe(7);
  });
});
