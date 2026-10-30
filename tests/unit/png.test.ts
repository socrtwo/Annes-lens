import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { deflateSync, deflateRawSync, gzipSync } from 'node:zlib';
import { inflate } from '../../src/codecs/inflate';
import { decodePngTolerant } from '../../src/codecs/png';
import { decodePnm } from '../../src/codecs/pnm';

describe('tolerant inflate', () => {
  const text = new TextEncoder().encode('Anne\'s Lens '.repeat(400) + 'and some different bytes at the end 0123456789'.repeat(7));
  it('inflates zlib, raw and gzip streams written by Node', () => {
    for (const [name, bytes] of [['zlib', deflateSync(text)], ['raw', deflateRawSync(text)], ['gzip', gzipSync(text)], ['stored', deflateSync(text, { level: 0 })], ['fixed', deflateRawSync(text, { strategy: 2 /* fixed */ })]] as [string, Buffer][]) {
      const r = inflate(new Uint8Array(bytes));
      expect(r.complete, name).toBe(true);
      expect(r.error, name).toBeUndefined();
      expect(Buffer.from(r.data).equals(text), name).toBe(true);
    }
  });
  it('returns the readable prefix of a truncated or corrupt stream', () => {
    const z = new Uint8Array(deflateSync(text));
    const cut = inflate(z.subarray(0, Math.floor(z.length / 2)));
    expect(cut.complete).toBe(false);
    expect(cut.error).toMatch(/end of data/);
    expect(cut.data.length).toBeGreaterThan(100);
    expect(Buffer.from(cut.data).equals(text.subarray(0, cut.data.length))).toBe(true);
    const bad = z.slice(); for (let i = 40; i < 60; i++) bad[i] ^= 0x5a;
    const r = inflate(bad);
    expect(r.complete).toBe(false);
    expect(r.error).toBeTruthy();
  });
});

describe('tolerant PNG reader against Pillow files', () => {
  const dir = 'tests/fixtures/png/';
  const expected = (name: string) => {
    const rgb = decodePnm(new Uint8Array(readFileSync(dir + name + '.ppm'))).pages[0].frames[0].raster;
    const a = decodePnm(new Uint8Array(readFileSync(dir + name + '-alpha.pgm'))).pages[0].frames[0].raster;
    const out = new Uint8ClampedArray(rgb.data.length);
    for (let i = 0; i < rgb.data.length; i += 4) { out[i] = rgb.data[i]; out[i + 1] = rgb.data[i + 1]; out[i + 2] = rgb.data[i + 2]; out[i + 3] = a.data[i]; }
    return { width: rgb.width, height: rgb.height, data: out };
  };
  it('decodes every color type and bit depth, interlaced or not, to the same pixels as Pillow', () => {
    for (const [file, exp] of [['rgba8', 'rgba8'], ['rgba8-i', 'rgba8'], ['rgb8', 'rgb8'], ['rgb8-i', 'rgb8'], ['gray8', 'gray8'], ['la8', 'la8'], ['pal8', 'pal8'], ['pal8-i', 'pal8'], ['gray1', 'gray1'], ['gray1-i', 'gray1'], ['pal4', 'pal4'], ['gray16', 'gray16'], ['pal-trns', 'pal-trns']]) {
      const d = decodePngTolerant(new Uint8Array(readFileSync(`${dir}${file}.png`)));
      const e = expected(exp);
      expect(d.warnings, file).toEqual([]);
      expect([d.pages[0].width, d.pages[0].height], file).toEqual([e.width, e.height]);
      const got = d.pages[0].frames[0].raster.data;
      let bad = -1; for (let i = 0; i < got.length; i++) if (got[i] !== e.data[i]) { bad = i; break; }
      expect(bad, `${file}: pixel ${Math.floor(bad / 4)} channel ${bad % 4}: ${got[bad]} vs ${e.data[bad]}`).toBe(-1);
      expect(d.rowsDecoded, file).toBe(d.rowsTotal);
    }
    expect(decodePngTolerant(new Uint8Array(readFileSync(`${dir}pal-trns.png`))).pages[0].hasAlpha).toBe(true);
    expect(decodePngTolerant(new Uint8Array(readFileSync(`${dir}gray16.png`))).pages[0].bitDepth).toBe(16);
  });
  it('recovers the top of a truncated file and reports the damage', () => {
    const d = decodePngTolerant(new Uint8Array(readFileSync(`${dir}rgb8-truncated.png`)));
    expect(d.warnings.join(' ')).toMatch(/truncated|cut off/);
    expect(d.warnings.join(' ')).toMatch(/rows/);
    expect(d.rowsDecoded).toBeGreaterThan(2);
    expect(d.rowsDecoded).toBeLessThan(d.rowsTotal);
    const e = expected('rgb8');
    const got = d.pages[0].frames[0].raster.data;
    for (let i = 0; i < d.rowsDecoded * d.pages[0].width * 4; i++) expect(got[i], `byte ${i}`).toBe(e.data[i]);
    expect(got[(d.rowsTotal - 1) * d.pages[0].width * 4 + 3]).toBe(0);
    expect(d.pages[0].hasAlpha).toBe(true);
  });
});
