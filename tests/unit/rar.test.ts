import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { Rar, isRar } from '../../src/codecs/rar';
import { crc32 } from '../../src/codecs/rarunpack';

// libarchive's test archives (BSD-2-Clause) and two stored comics written by scripts/gen-rar-fixtures.py.
// Every RAR file carries a CRC-32 of its contents, and Rar.read() checks it, so a decoded file is a correct one.
const fx = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/rar/${n}`));
const open = (n: string) => new Rar(fx(n));
const file = (r: Rar, name: string) => { const e = r.entries.find((x) => x.name === name); if (!e) throw new Error(`no ${name} in ${r.entries.map((x) => x.name)}`); return e; };
const text = (u: Uint8Array) => new TextDecoder().decode(u);

describe('RAR 2.x–4.x archives', () => {
  it('lists files, links and folders, and reads stored files', () => {
    const r = open('la-rar.rar');
    expect([r.format, isRar(fx('la-rar.rar'))]).toEqual([4, true]);
    expect(r.entries.map((e) => [e.name, e.dir, e.link])).toEqual([['test.txt', false, false], ['testlink', false, true], ['testdir/test.txt', false, false], ['testdir', true, false], ['testemptydir', true, false]]);
    expect(text(r.read(file(r, 'testdir/test.txt')))).toBe('test text document\r\n');
  });
  it('unpacks the 2.9 LZ coder (normal compression; a 20 MB file of many blocks)', () => {
    const r = open('la-rar-compress-normal.rar');
    const html = text(r.read(file(r, 'LibarchiveAddingTest.html')));
    expect([html.length, html.startsWith('<!DOCTYPE')]).toEqual([20111, true]);
    expect(text(r.read(file(r, 'testdir/test.txt')))).toBe('test text document\r\n');
    const m = open('la-rar-multi-lzss-blocks.rar'), big = m.read(m.entries[0]);
    expect(big.length).toBe(20131111);
  });
  it('resets the repeated low distance with each new table', () => {
    const r = open('la-rar3-lowdist-reset.rar');
    expect([...r.read(file(r, 'lowdist-reset.bin'))]).toEqual([...Array(40).keys(), 2, 3, 4, 5, 6, 7, 13, 14, 15, ...Array.from({ length: 15 }, (_, i) => 0x28 + i)]);
  });
  it('runs the x86 (E8) filter', () => {
    const r = open('la-rar-filter.rar'), d = r.read(file(r, 'bsdcat.exe'));
    expect([d.length, [...d.subarray(0, 12)]]).toEqual([204288, [0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0]]);
  });
  it('decodes Unicode names (Japanese) and keeps folder paths', () => {
    const r = open('la-rar-unicode.rar');
    expect(r.entries.map((e) => e.name)).toContain('表だよ/漢字長いファイル名long-filename-in-漢字.txt');
    expect(r.read(file(r, 'abcdefghijklmnopqrsテスト.txt')).length).toBe(16);
  });
  it('PPMd text compression (best compression)', () => {
    const b = open('la-rar-compress-best.rar'), html = text(b.read(file(b, 'LibarchiveAddingTest.html')));
    expect([html.length, html.endsWith('</BODY>\n</HTML>')]).toEqual([20111, true]);
    expect(text(b.read(file(b, 'testdir/test.txt')))).toBe('test text document\r\n');
  });
  it('a 241 MB file that switches between PPMd and LZ blocks', () => {
    const r = open('la-rar-ppmd-lzss-conversion.rar'), d = r.read(r.entries[0]); // CRC-checked
    expect([d.length, text(d.subarray(d.length - 42))]).toEqual([241647978, 'gin-bottom: 0in"><BR>\n</P>\n</BODY>\n</HTML>']);
  }, 60000);
  it('says so for encryption and damaged archives', () => {
    const d = open('la-rar-encryption-data.rar');
    expect(d.encrypted).toBe(true); expect(() => d.read(d.entries[0])).toThrow(/encrypted/);
    const h = open('la-rar-encryption-header.rar');
    expect([h.headersEncrypted, h.entries.length]).toEqual([true, 0]);
    const t = open('la-rar-invalid1.rar');
    expect(() => t.read(t.entries[0])).toThrow(/cut short/);
  });
});

describe('RAR 1.5 and 2.0 coders (archives made with RAR 1.54 and RAR 2.50)', () => {
  it('RAR 1.5: a file matches the original byte for byte', () => {
    const r = open('rars-154-readme.rar'), e = r.entries[0];
    expect([e.version, e.method]).toEqual([15, 3]);
    expect(r.read(e)).toEqual(fx('rars-README.md'));
  });
  it('RAR 1.5: 17 files of best compression', () => {
    const r = open('rars-154-docs.rar');
    expect(r.entries.length).toBe(17);
    expect(r.entries.reduce((n, e) => n + r.read(e).length, 0)).toBe(r.entries.reduce((n, e) => n + e.size, 0));
  });
  it('RAR 1.5: a solid archive continues whatever the per-file flag says', () => {
    const r = open('rars-154-solid-flag-cleared.rar');
    expect(r.entries.map((e) => [e.solid, r.read(e).length])).toEqual([[false, expect.any(Number)], [true, expect.any(Number)]]);
  });
  it('RAR 1.5 comments: headers whose CRC old RAR wrote wrong are not called damaged', () => {
    const r = open('rarfile-rar15-comment.rar');
    expect(r.warnings).toEqual([]);
    expect(r.entries.map((e) => text(r.read(e)).length)).toEqual([7, 8]);
  });
  it('RAR 2.0: multimedia-switch and text files, a long LZ stream, a solid pair, zero fill', () => {
    for (const [n, sizes] of [['rars-250-audio-switch.rar', [32768]], ['rars-250-text.rar', [2300]], ['rars-250-biglz.rar', [167936]], ['rars-250-solid.rar', [15840, 13800]], ['rars-20-zero-fill.rar', [240]]] as const) {
      const r = open(n);
      expect(r.entries.map((e) => [e.version, r.read(e).length]), n).toEqual(sizes.map((x) => [20, x]));
    }
  });
  it('a compressed entry with no data is an empty file', () => {
    const r = open('rars-30-empty-compressed.rar');
    expect([r.entries[0].method, r.read(r.entries[0]).length]).toEqual([3, 0]);
  });
});

describe('RAR 5.0 archives', () => {
  it('stored and compressed files', () => {
    const s = open('la-rar5-stored.rar');
    expect([s.format, text(s.read(file(s, 'helloworld.txt')))]).toEqual([5, 'hello libarchive test suite!\n']);
    const c = open('la-rar5-compressed.rar');
    expect(c.read(file(c, 'test.bin')).length).toBe(1200);
    const m = open('la-rar5-multiple-files.rar');
    expect(m.entries.map((e) => m.read(e).length)).toEqual([4096, 4096, 4096, 4096]);
    const w = open('la-rar5-win32.rar');
    expect(w.entries.filter((e) => !e.dir).map((e) => w.read(e).length)).toEqual([1200, 4096, 4096, 4096, 4096, 4096, 4096]);
  });
  it('solid archives, read in order and out of order', () => {
    const inOrder = open('la-rar5-solid.rar'), all = inOrder.entries.map((e) => inOrder.read(e));
    expect(all.map((d) => d.length)).toEqual([1200, 4096, 4096, 4096, 4096, 4096, 4096]);
    const out = open('la-rar5-solid.rar');
    for (const i of [5, 2, 6, 0, 3]) expect(crc32(out.read(out.entries[i]))).toBe(crc32(all[i]));
    const m = open('la-rar5-multiple-files-solid.rar');
    expect([m.solid, m.read(m.entries[3]).length, m.read(m.entries[1]).length]).toEqual([true, 4096, 4096]);
  });
  it('the ARM filter, and a file checked only by BLAKE2sp', () => {
    const a = open('la-rar5-arm.rar');
    expect(crc32(a.read(file(a, 'elf-Linux-ARMv7-ls')))).toBe(0x886f91eb);
    const b = open('la-rar5-blake2.rar'), e = file(b, 'cebula.txt');
    expect(e.crc).toBeNull(); expect(crc32(b.read(e))).toBe(0x7e5ec49e);
  });
  it('Unicode names, links and encrypted files', () => {
    expect(open('la-rar5-unicode.rar').entries.map((e) => e.name)).toEqual(['\u{1f44b}\u{1f30e}.txt', 'Ⓗⓐⓡⓓ Ⓛⓘⓝⓚ.txt', '𝒮𝓎𝓂𝒷𝑜𝓁𝒾𝒸 𝐿𝒾𝓃𝓀.txt']);
    expect(open('la-rar5-symlink.rar').entries.map((e) => [e.name, e.link, e.dir])).toEqual([['file.txt', false, false], ['symlink.txt', true, false], ['dirlink', true, false], ['dir', false, true]]);
    const enc = open('la-rar5-encrypted.rar');
    expect(enc.entries.map((e) => e.encrypted)).toEqual([false, true, false, true]);
    expect(text(enc.read(enc.entries[0]))).toMatch(/a\.txt/); expect(() => enc.read(enc.entries[1])).toThrow(/encrypted/);
    expect(open('la-rar5-encrypted-filenames.rar').headersEncrypted).toBe(true);
  });
});

describe('damaged and hostile archives', () => {
  // libarchive's fuzzing samples: each must open or fail with a message, quickly, and never hang.
  const names = readdirSync('tests/fixtures/rar').filter((n) => /^la-.*(overflow|leftshift|truncated|invalid|bad-window|desync|different-solid|pointer-leak|nonempty|dirdata|block-size|huge|use-after-free|out-of-bounds)/.test(n));
  it(`${names.length} samples`, () => {
    expect(names.length).toBeGreaterThan(15);
    for (const n of names) {
      const t0 = Date.now();
      try { const r = new Rar(fx(n)); for (const e of r.entries) { try { r.read(e); } catch (err) { expect(err).toBeInstanceOf(Error); } } }
      catch (err) { expect(err).toBeInstanceOf(Error); }
      expect(Date.now() - t0, n).toBeLessThan(3000);
    }
  });
});

describe('stored comics written by the fixture script', () => {
  for (const n of ['comic4.cbr', 'comic5.cbr']) it(n, () => {
    const r = open(n);
    expect(r.entries.filter((e) => !e.dir).map((e) => [e.name, e.size])).toEqual([['page-01.png', expect.any(Number)], ['page-02.jpg', expect.any(Number)], ['page-10.png', expect.any(Number)], ['notes.txt', 19], ['extras/cover.png', expect.any(Number)]]);
    expect(r.entries.filter((e) => e.dir).map((e) => e.name)).toEqual(['extras']);
    const png = r.read(file(r, 'page-01.png'));
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(r.read(file(r, 'extras/cover.png'))).toEqual(png);
    expect(new Date(file(r, 'page-02.jpg').mtime).getUTCFullYear()).toBe(2010);
  });
});
