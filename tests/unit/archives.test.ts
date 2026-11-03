import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readTar, untarable, isTar } from '../../src/codecs/tar';
import { SevenZip, isSevenZip } from '../../src/codecs/sevenzip';

const fx = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/archives/${n}`));
const LONG = 'a-very-long-folder-name-'.repeat(5) + '/photo with a long name.png';
const NAMES = ['empty.png', LONG, 'notes.txt', 'page 1.png', 'page 2.jpg', 'sub/page 10.png'].sort();
// The plain tar (Python's tarfile, GNU format) holds the bytes as they are: the reference for the rest.
const plain = fx('pics.tar'), ref = new Map(readTar(plain).entries.map((e) => [e.name, plain.slice(e.offset, e.offset + e.size)]));
const same = (a: Uint8Array, b: Uint8Array | undefined) => !!b && a.length === b.length && a.every((v, i) => v === b[i]);

describe('tar archives (Python tarfile)', () => {
  it('GNU tar: names (long ones too), sizes, dates', () => {
    expect(isTar(plain)).toBe(true);
    const { entries, warnings } = readTar(plain);
    expect(entries.map((e) => e.name).sort()).toEqual(NAMES); expect(warnings).toEqual([]);
    expect(entries.every((e) => e.mtime === 1700000000000)).toBe(true);
    expect([...ref.get('page 1.png')!.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
  it('pax tar inside gzip, bzip2 and xz', async () => {
    for (const n of ['pics.tar.gz', 'pics.tbz2', 'pics.cbt']) {
      const r = await untarable(fx(n)); expect(r, n).not.toBeNull();
      const { entries } = readTar(r!.tar);
      expect(entries.map((e) => e.name).sort(), n).toEqual(NAMES);
      for (const e of entries) expect(same(r!.tar.slice(e.offset, e.offset + e.size), ref.get(e.name)), `${n} ${e.name}`).toBe(true);
    }
    expect(await untarable(fx('sample.xz'))).toBeNull(); // compressed, but not a tar
  });
});

describe('7z archives (py7zr)', () => {
  for (const n of ['pics-lzma2.7z', 'pics-lzma.7z', 'pics-bzip2.7z', 'pics-deflate.cb7', 'pics-copy.7z']) it(n, async () => {
    const u8 = fx(n); expect(isSevenZip(u8)).toBe(true);
    const z = await SevenZip.open(u8);
    expect(z.entries.map((e) => e.name).sort()).toEqual(NAMES);
    for (const e of z.entries) expect(same(await z.read(e), ref.get(e.name)), `${n} ${e.name}`).toBe(true);
  });
  it('refuses an encrypted archive with a message', async () => {
    const z = await SevenZip.open(fx('pics-aes.7z'));
    expect(z.encrypted).toBe(true);
    expect(await z.read(z.entries[0]).then(() => 'read', (e: Error) => e.message)).toMatch(/encrypted/);
    expect((await SevenZip.open(fx('pics-lzma2.7z'))).encrypted).toBe(false);
  });
});
