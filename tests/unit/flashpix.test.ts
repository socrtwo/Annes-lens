import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeFlashPix, isFlashPix, readView } from '../../src/codecs/flashpix';
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
  it('the whole picture, edge tiles included, as the raw tiles hold it', () => {
    expect(diff(decodeFlashPix(fx('input_truecolor.fpx')).pages[0].frames[0].raster, ref('input_truecolor.decoded.png')).max).toBe(0);
  });
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

describe('FlashPix viewing transforms (files written from the specification; pixel-exact cases checked against numpy)', () => {
  const page = (n: string) => decodeFlashPix(fx(n)).pages[0];
  const rgba = (a: Raster, b: Raster) => { expect([a.width, a.height]).toEqual([b.width, b.height]); let max = 0; for (let i = 0; i < a.data.length; i++) max = Math.max(max, Math.abs(a.data[i] - b.data[i])); return max; };
  it('the transform property set is read', () => {
    const v = readView(new Cfb(fx('view-crop.fpx')), 1)!;
    expect(v.roi!.map((x) => +x.toFixed(4))).toEqual([0.3043, 0.2174, 0.8696, 0.5217]); expect(v.aspect).toBeCloseTo(40 / 24, 5); expect(v.affine!.length).toBe(16); expect(v.contrast).toBe(1);
    expect(readView(new Cfb(fx('input_truecolor.fpx')), 1)).toBeNull();
  });
  it('a rectangle of interest alone leaves the rest transparent', () => { const p = page('view-roi.fpx'); expect(rgba(p.frames[0].raster, ref('view-roi.png'))).toBe(0); expect(p.hasAlpha).toBe(true); expect(p.notes[1]).toBe("seen through the file's viewing transform: rectangle of interest"); });
  it('a crop: the rectangle mapped onto the result rectangle', () => { const p = page('view-crop.fpx'); expect([p.width, p.height]).toEqual([40, 24]); expect(diff(p.frames[0].raster, ref('view-crop.png')).max).toBe(0); });
  it('a quarter turn and a flip are pixel-exact', () => {
    const t = page('view-rot90.fpx'); expect([t.width, t.height]).toEqual([46, 70]); expect(diff(t.frames[0].raster, ref('view-rot90.png')).max).toBe(0); expect(t.notes[1]).toMatch(/a quarter turn, result aspect ratio 0.657/);
    const f = page('view-flip.fpx'); expect([f.width, f.height]).toEqual([70, 46]); expect(diff(f.frames[0].raster, ref('view-flip.png')).max).toBe(0); expect(f.notes[1]).toMatch(/a flip$/);
  });
  it('colortwist and contrast (against this script\'s reading of the specification)', () => { const p = page('view-color.fpx'); expect(diff(p.frames[0].raster, ref('view-color.png')).max).toBeLessThanOrEqual(1); expect(p.notes[1]).toBe("seen through the file's viewing transform: colortwist, contrast 1.20"); });
  it('a cached result image is shown as it is, the transform left alone', () => { const p = page('view-cached.fpx'); expect(diff(p.frames[0].raster, ref('input_grayscale.pillow.png'), 0, 64).max).toBe(0); expect(p.notes[1]).toMatch(/cached result/); });
});
