import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeFlashPix, isFlashPix } from '../../src/codecs/flashpix';
import { Cfb, propertySet } from '../../src/codecs/cfb';
import { decodePngTolerant } from '../../src/codecs/png';
import type { Raster } from '../../src/codecs/raster';

let pdfjs: any;
beforeAll(async () => { const path = 'pdfjs-dist/image_decoders/pdf.image_decoders.mjs'; pdfjs = await import(/* @vite-ignore */ path); });
const fx = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/flashpix/${n}`));
const ref = (n: string) => decodePngTolerant(fx(n)).pages[0].frames[0].raster;
/** Largest and mean RGB difference within columns [x0, x1). */
function diff(a: Raster, b: Raster, x0 = 0, x1 = a.width): { max: number; mean: number } {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  let max = 0, sum = 0, n = 0;
  for (let y = 0; y < a.height; y++) for (let x = x0; x < x1; x++) for (let c = 0; c < 3; c++) { const i = (y * a.width + x) * 4 + c, v = Math.abs(a.data[i] - b.data[i]); max = Math.max(max, v); sum += v; n++; }
  return { max, mean: sum / n };
}

describe('Compound files', () => {
  it('reads the directory and streams, small ones from the mini stream', () => {
    const c = new Cfb(fx('input_truecolor.fpx'));
    expect(c.entries.map((e) => e.path)).toContain('Data Object Store 000001/Resolution 0001/Subimage 0000 Data');
    const p = propertySet(c.stream('Data Object Store 000001/\x05Image Contents')!);
    expect([p.get(0x01000000), p.get(0x01000002), p.get(0x01000003)]).toEqual([2, 70, 46]);
    expect(c.stream('Data Object Store 000001/Resolution 0001/Subimage 0000 Data')!.length).toBe(12344 + 28 + 12288); // the second tile at offset 12344
  });
});

describe('FlashPix (ImageMagick\'s samples, made by Kodak\'s toolkit)', () => {
  it('is recognized', () => { expect(isFlashPix(fx('input_jpeg.fpx'))).toBe(true); expect(isFlashPix(fx('rose.png'))).toBe(false); });
  for (const n of ['input_truecolor', 'input_256', 'input_grayscale', 'input_bw']) {
    it(`${n}: the first tile column as Pillow reads it`, () => {
      const d = decodeFlashPix(fx(`${n}.fpx`)); expect(d.warnings).toEqual([]);
      expect(diff(d.pages[0].frames[0].raster, ref(`${n}.pillow.png`), 0, 64).max).toBe(0);
    });
  }
  it('the edge tiles too: the whole picture is the rose', () => {
    const d = decodeFlashPix(fx('input_truecolor.fpx')), a = d.pages[0].frames[0].raster, rose = ref('rose.png');
    const left = diff(a, rose, 0, 64), right = diff(a, rose, 64, 70);
    expect(right.max).toBeLessThanOrEqual(left.max); expect(right.mean).toBeLessThan(2);
    expect(d.pages[0].notes[0]).toBe('FlashPix, NIF RGB, 2 resolutions (the full one shown), 2 tiles');
  });
  it('JPEG tiles with shared tables (pdf.js\'s JPEG decoder)', () => {
    const d = decodeFlashPix(fx('input_jpeg.fpx'), pdfjs); expect(d.warnings).toEqual([]);
    // As libjpeg decodes the same tiles (its chroma upsampling differs from pdf.js's), and near the rose.
    const lib = diff(d.pages[0].frames[0].raster, ref('input_jpeg.libjpeg.png'));
    expect(lib.mean).toBeLessThan(3); expect(lib.max).toBeLessThanOrEqual(40);
    expect(diff(d.pages[0].frames[0].raster, ref('rose.png')).mean).toBeLessThan(12);
    expect(d.pages[0].notes[0]).toMatch(/2 JPEG-compressed/);
    expect(() => decodeFlashPix(fx('input_jpeg.fpx'))).toThrow(/JPEG decoder/);
  });
});
