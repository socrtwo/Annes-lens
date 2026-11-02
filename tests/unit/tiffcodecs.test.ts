import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeTiff } from '../../src/codecs/tiff';
import { decodePngTolerant } from '../../src/codecs/png';
import { decodeCcitt } from '../../src/codecs/ccitt';

const fx = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/tiff/${n}`));
const png = (n: string) => decodePngTolerant(fx(n)).pages[0].frames[0].raster;
async function compare(tif: string, ref: string) {
  const d = await decodeTiff(fx(tif)), page = d.pages[0], r = page.frames[0].raster, e = png(ref);
  expect([r.width, r.height], tif).toEqual([e.width, e.height]);
  let max = 0, sum = 0;
  for (let i = 0; i < r.data.length; i += 4) for (let c = 0; c < 3; c++) { const v = Math.abs(r.data[i + c] - e.data[i + c]); max = Math.max(max, v); sum += v; }
  return { max, mean: sum / (r.data.length / 4 * 3), notes: page.notes.join(', '), warnings: d.warnings };
}

describe('TIFF: CCITT fax compression (against libtiff)', () => {
  for (const n of ['rle', 'g3', 'g3-2d', 'g4', 'g4-lsb']) it(`fax-${n}`, async () => {
    const r = await compare(`fax-${n}.tif`, 'fax.png');
    expect(r.max, r.notes).toBe(0);
  });
  it('runs past 2560 pixels (extended make-up codes)', async () => {
    for (const n of ['g3', 'g4']) expect((await compare(`fax-wide-${n}.tif`, 'fax-wide.png')).max, n).toBe(0);
  });
  it('rejects broken data instead of guessing', () => {
    expect(() => decodeCcitt(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1, 0xff, 0xff]), 8, 2, { compression: 4 })).toThrow(/CCITT/);
  });
});

describe('TIFF: planar, floating-point, signed and CMYK samples', () => {
  it('planar RGB, 8 and 16 bits', async () => {
    for (const n of ['planar-rgb.tif', 'planar-rgb16.tif']) { const r = await compare(n, 'planar-rgb.png'); expect(r.max, n).toBe(0); expect(r.notes).toMatch(/planar/); }
  });
  it('floats (0…1), half floats, the floating-point predictor, and signed heights stretched to their range', async () => {
    for (const [t, p, tol] of [['float-gray.tif', 'float-gray.png', 1], ['half-gray.tif', 'half-gray.png', 1], ['float-pred.tif', 'float-pred.png', 1], ['dem-int16.tif', 'dem-int16.png', 1]] as const) {
      const r = await compare(t, p); expect(r.max, `${t} ${r.notes}`).toBeLessThanOrEqual(tol);
    }
    expect((await compare('dem-int16.tif', 'dem-int16.png')).notes).toMatch(/16-bit signed integers, -120…2300 shown as black…white/);
    expect((await compare('float-pred.tif', 'float-pred.png')).notes).toMatch(/floating-point predictor/);
  });
  it('CMYK through the embedded profile matches LittleCMS; without one, the simple conversion', async () => {
    for (const n of ['cmyk-icc.tif', 'cmyk16-icc.tif']) { const r = await compare(n, 'cmyk-icc.png'); expect(r.max, `${n} mean ${r.mean}`).toBeLessThanOrEqual(3); expect(r.mean).toBeLessThan(0.8); expect(r.notes).toMatch(/CMYK through the embedded profile/); }
    const plain = await compare('cmyk-plain.tif', 'cmyk-plain.png'); expect(plain.max).toBe(0); expect(plain.notes).toMatch(/no profile/);
  });
});
