import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodePsp, isPsp } from '../../src/codecs/psp';
import { decodePngTolerant } from '../../src/codecs/png';

const fx = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/psp/${n}`));
const ref = (n: string) => decodePngTolerant(fx(n)).pages[0].frames[0].raster;
function maxDiff(a: { width: number; height: number; data: Uint8ClampedArray }, b: { width: number; height: number; data: Uint8ClampedArray }) {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  let m = 0; for (let i = 0; i < a.data.length; i += 4) for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(a.data[i + c] - b.data[i + c])); return m;
}

describe('Paint Shop Pro (files written from the format description; GIMP\'s reader as the reference)', () => {
  it('is recognized', () => { expect(isPsp(fx('layers.psp'))).toBe(true); expect(isPsp(fx('layers.png'))).toBe(false); });
  for (const n of ['rgb-none', 'rgb-rle', 'rgb-lz77', 'pal8', 'gray', 'odd', 'pal4', 'hidden']) {
    it(`${n}: as GIMP reads it`, () => { const d = decodePsp(fx(`${n}.psp`)); expect(d.warnings).toEqual([]); expect(maxDiff(d.pages[0].frames[0].raster, ref(`${n}.png`))).toBe(0); });
  }
  for (const n of ['layers', 'multiply', 'screen', 'darken', 'lighten', 'difference', 'hue', 'saturation', 'color', 'luminosity', 'overlay', 'hardlight', 'softlight', 'dodge', 'burn', 'exclusion', 'psp5', 'psp3']) {
    it(`${n}: layers merged as GIMP merges them`, () => { const d = decodePsp(fx(`${n}.psp`)); expect(d.warnings).toEqual([]); expect(maxDiff(d.pages[0].frames[0].raster, ref(`${n}.png`))).toBeLessThanOrEqual(1); });
  }
  it('1 bit (checked against the written picture only)', () => { expect(maxDiff(decodePsp(fx('mono.psp')).pages[0].frames[0].raster, ref('mono.png'))).toBe(0); });
  it('notes', () => {
    const d = decodePsp(fx('layers.psp'));
    expect(d.pages[0].notes[0]).toBe('Paint Shop Pro 8 picture (format 6.0), 2 layers merged, 24-bit, LZ77');
    expect(d.pages[0].dpi).toEqual([72, 72]);
    expect(decodePsp(fx('psp5.psp')).pages[0].notes[0]).toMatch(/^Paint Shop Pro 7 picture \(format 5\.0\)/);
    expect(decodePsp(fx('psp3.psp')).pages[0].notes[0]).toMatch(/^Paint Shop Pro 5 picture \(format 3\.0\), 2 layers/);
  });
});
