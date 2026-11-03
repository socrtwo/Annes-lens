import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeExr, isExr } from '../../src/codecs/exr';
import { decodePngTolerant } from '../../src/codecs/png';

const fx = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/exr/${n}`));
function compare(exr: string, png: string, page = 0) {
  const d = decodeExr(fx(exr)), p = d.pages[page], r = p.frames[0].raster, e = decodePngTolerant(fx(png)).pages[0].frames[0].raster;
  expect([r.width, r.height], exr).toEqual([e.width, e.height]);
  let max = 0;
  for (let i = 0; i < r.data.length; i += 4) for (let c = 0; c < (p.hasAlpha ? 4 : 3); c++) max = Math.max(max, Math.abs(r.data[i + c] - e.data[i + c]));
  return { max, notes: p.notes.join(' | '), pages: d.pages.length, warnings: d.warnings };
}

describe('OpenEXR (written and decoded by the OpenEXR library)', () => {
  for (const c of ['none', 'rle', 'zips', 'zip', 'piz', 'pxr24', 'b44', 'b44a']) it(`half, ${c}`, () => {
    expect(isExr(fx(`half-${c}.exr`))).toBe(true);
    const r = compare(`half-${c}.exr`, `half-${c}.png`); expect(r.max, r.notes).toBeLessThanOrEqual(1);
  });
  for (const c of ['zip', 'piz', 'pxr24']) it(`float, ${c}`, () => { const r = compare(`float-${c}.exr`, `float-${c}.png`); expect(r.max, r.notes).toBeLessThanOrEqual(1); });
  it('premultiplied RGBA, luminance only, layers', () => {
    const a = compare('rgba-piz.exr', 'rgba-piz.png'); expect(a.max, a.notes).toBeLessThanOrEqual(1);
    const y = compare('gray-y.exr', 'gray-y.png'); expect(y.max).toBeLessThanOrEqual(1); expect(y.notes).toMatch(/luminance/);
    const l = compare('layers.exr', 'layers.png'); expect(l.max).toBeLessThanOrEqual(1); expect(l.notes).toMatch(/layer diffuse/);
  });
  it('tiled (16 and 32 pixel tiles, partial ones at the edges)', () => {
    for (const n of ['tiled-zip', 'tiled-piz']) { const r = compare(`${n}.exr`, `${n}.png`); expect(r.max, r.notes).toBeLessThanOrEqual(1); expect(r.notes).toMatch(/tiled/); }
  });
  it('multi-part: each part a page', () => {
    const a = compare('multipart.exr', 'multipart-1.png', 0), b = compare('multipart.exr', 'multipart-2.png', 1);
    expect([a.pages, a.max <= 1, b.max <= 1]).toEqual([2, true, true]);
    expect(b.notes).toMatch(/part 2 \(luma\)/);
  });
  it('refuses DWAA with a message', () => {
    expect(() => decodeExr(fx('dwaa.exr'))).toThrow(/DWAA compression is not supported/);
  });
});
