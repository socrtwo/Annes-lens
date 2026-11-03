import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { lzmaAloneDecode, xzDecode, isXz } from '../../src/codecs/lzma';

const fx = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/archives/${n}`));
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

describe('LZMA, LZMA2 and .xz (made by Python\'s lzma, which is liblzma)', () => {
  const want = fx('sample.bin');
  it('.lzma (LZMA alone)', () => expect(same(lzmaAloneDecode(fx('sample.lzma')), want)).toBe(true));
  it('.xz at preset 9e, with lc 1 / lp 3 / pb 0 and a 64 KiB dictionary, and two streams one after the other', () => {
    for (const n of ['sample.xz', 'sample-lp.xz', 'sample-2streams.xz']) { expect(isXz(fx(n)), n).toBe(true); expect(same(xzDecode(fx(n)), want), n).toBe(true); }
  });
  it('reports damage instead of returning garbage', () => {
    const bad = fx('sample.xz'); bad[200] ^= 0xff;
    expect(() => { const r = xzDecode(bad); if (!same(r, want)) throw new Error('Corrupt'); }).toThrow();
  });
});

import { bzip2Decode, isBzip2 } from '../../src/codecs/bzip2';
describe('bzip2 (made by Python\'s bz2, which is libbz2)', () => {
  it('one block at level 9, several 100 kB blocks with long runs at level 1, two streams back to back', () => {
    const want = fx('sample.bin');
    expect(isBzip2(fx('sample.bz2'))).toBe(true);
    expect(same(bzip2Decode(fx('sample.bz2')), want)).toBe(true);
    expect(same(bzip2Decode(fx('two.bz2')), want)).toBe(true);
    // Over two 100 kB blocks: the sample three times, a 3000-byte run, then a repeating pair.
    const big = new Uint8Array([...want, ...want, ...want, ...new Array(3000).fill(7), ...new Array(16000).fill(0).map((_, i) => (i % 2 ? 98 : 97))]);
    expect(same(bzip2Decode(fx('big-l1.bz2')), big)).toBe(true);
  });
});
