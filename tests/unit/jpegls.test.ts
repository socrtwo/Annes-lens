import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeJpegLs, isJpegLs } from '../../src/codecs/jpegls';

const DIR = 'tests/fixtures/jpegls/';
const fx = (n: string) => new Uint8Array(readFileSync(DIR + n));
const cases: Record<string, { w: number; h: number; bits: number; comps: number; near: number; ilv: number; maxErr: number }> = JSON.parse(readFileSync(DIR + 'cases.json', 'utf8'));

describe('JPEG-LS (T.87; codestreams from CharLS)', () => {
  it('is recognized by its SOF55 marker', () => {
    expect(isJpegLs(fx('g8.jls'))).toBe(true);
    expect(isJpegLs(new Uint8Array(readFileSync('tests/fixtures/dicom/jpeg-gray.dcm')))).toBe(false);
  });
  for (const [n, c] of Object.entries(cases)) {
    it(`${n}: ${c.bits} bits, ${c.comps} component${c.comps > 1 ? `s, interleave mode ${c.ilv}` : ''}, NEAR ${c.near}: the samples CharLS decodes`, () => {
      const d = decodeJpegLs(fx(`${n}.jls`));
      expect([d.width, d.height, d.comps, d.precision, d.near]).toEqual([c.w, c.h, c.comps, c.bits, c.near]);
      const exp = new Uint16Array(new Uint8Array(readFileSync(DIR + `${n}.exp`)).buffer);
      let bad = 0;
      for (let i = 0; i < exp.length; i++) if (d.data[i] !== exp[i]) bad++;
      expect(bad).toBe(0);
      expect(d.warnings).toEqual([]);
    });
  }
  it('refuses what it cannot read, and reports a cut-short stream', () => {
    expect(() => decodeJpegLs(new Uint8Array(readFileSync('tests/fixtures/dicom/jpeg-gray.dcm')))).toThrow(/not a JPEG stream/);
    const g = fx('g8.jls');
    expect(() => decodeJpegLs(g.subarray(0, 15))).toThrow(/no scan/);
    expect(() => decodeJpegLs(g.subarray(0, g.length - 40))).toThrow(/the data is cut short/);
  });
});
