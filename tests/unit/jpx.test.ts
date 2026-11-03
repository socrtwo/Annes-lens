import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeJpx, jpxInfo, isJp2, isJ2k, setJpxModule } from '../../src/codecs/jpx';
import { decodePngTolerant } from '../../src/codecs/png';
import { sniff } from '../../src/codecs/registry';
import { embeddedIcc } from '../../src/color/embedded';

// OpenJPEG from pdf.js's image decoders, fed the WebAssembly from node_modules (as the app loads it from the PDF runtime).
beforeAll(async () => {
  const path = 'pdfjs-dist/image_decoders/pdf.image_decoders.mjs'; // untyped module
  const m: any = await import(/* @vite-ignore */ path);
  const W = 'node_modules/pdfjs-dist/wasm/';
  m.JpxImage.setOptions({ useWasm: true, useWorkerFetch: false, wasmUrl: '', getHandler: () => ({ sendWithPromise: async (_k: string, { filename }: { filename: string }) => new Uint8Array(readFileSync(W + filename)) }) });
  setJpxModule(m);
});
const fx = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/jpx/${n}`));
async function compare(file: string, ref: string) {
  const d = await decodeJpx(fx(file)), p = d.pages[0], r = p.frames[0].raster, e = decodePngTolerant(fx(ref)).pages[0].frames[0].raster;
  expect([r.width, r.height], file).toEqual([e.width, e.height]);
  let max = 0;
  for (let i = 0; i < r.data.length; i++) max = Math.max(max, Math.abs(r.data[i] - e.data[i]));
  return { max, notes: p.notes.join(' | '), page: p, warnings: d.warnings };
}

describe('JPEG 2000 (OpenJPEG; files from OpenJPEG and OpenJPH)', () => {
  it('is recognized as JP2 and as a codestream', () => {
    expect([isJp2(fx('rgb-lossless.jp2')), isJ2k(fx('lossy-tiled.j2k')), isJ2k(fx('ht.j2c')), isJp2(fx('ht.jph'))]).toEqual([true, true, true, true]);
    expect(sniff(fx('rgb-lossless.jp2'), 'x.bin')?.id).toBe('jp2');
    expect(sniff(fx('lossy-tiled.j2k'), 'x.bin')?.id).toBe('jp2');
  });
  it('lossless RGB is exact', async () => {
    const r = await compare('rgb-lossless.jp2', 'rgb.png');
    expect(r.max).toBe(0); expect(r.notes).toMatch(/JP2, lossless \(5\/3 wavelet\)/); expect(r.notes).toMatch(/RGB; 3 components of 8\/8\/8 bits/);
  });
  it('16-bit gray shows its top 8 bits', async () => {
    const r = await compare('gray16.jp2', 'gray16.png');
    expect(r.max).toBe(0); expect(r.notes).toMatch(/gray; 1 component of 16 bits; shown at 8 bits/); expect(r.page.bitDepth).toBe(16);
  });
  it('alpha', async () => {
    const r = await compare('rgba.jp2', 'rgba.png');
    expect([r.max, r.page.hasAlpha]).toEqual([0, true]);
  });
  it('lossy, tiled, layered codestream: as OpenJPEG decodes it', async () => {
    const r = await compare('lossy-tiled.j2k', 'lossy-tiled.png');
    expect(r.max).toBe(0);
    expect(r.notes).toMatch(/codestream, lossy \(9\/7 wavelet\)/); expect(r.notes).toMatch(/4 resolution levels, 3 quality layers, RPCL progression, 2 × 2 tiles/);
  });
  it('sYCC and CMYK are converted to RGB', async () => {
    const y = await compare('sycc.jp2', 'rgb.png'); expect(y.max).toBeLessThanOrEqual(3); expect(y.notes).toMatch(/sYCC/);
    const c = await compare('cmyk.jp2', 'cmyk.png'); expect(c.max).toBe(0); expect(c.page.hasAlpha).toBe(false);
  });
  it('HTJ2K, as a codestream and in a JPH file', async () => {
    for (const f of ['ht.j2c', 'ht.jph']) { const r = await compare(f, 'rgb.png'); expect(r.max, f).toBe(0); expect(r.notes, f).toMatch(/High-Throughput, HTJ2K/); }
    expect(jpxInfo(fx('ht.jph')).family).toBe('jph');
  });
  it('ICC profile, resolution and XMP of a JP2', async () => {
    const i = jpxInfo(fx('tagged.jp2'));
    expect([i.colorspace, i.dpi, /Parish register, folio 117/.test(i.xmp || '')]).toEqual(['ICC', [300, 300], true]);
    expect(i.icc?.length).toBe(readFileSync('tests/fixtures/color/adobergb.icc').length);
    expect(await embeddedIcc(fx('tagged.jp2'), 'jp2')).toEqual(i.icc);
    const d = await decodeJpx(fx('tagged.jp2'));
    expect([d.pages[0].dpi, /folio 117/.test(d.info.XMP)]).toEqual([[300, 300], true]);
  });
  it('a very large picture is decoded at a reduced resolution level', async () => {
    const full = await decodeJpx(fx('big.jp2'));
    expect([full.pages[0].width, full.pages[0].height, full.warnings]).toEqual([1024, 768, []]);
    const small = await decodeJpx(fx('big.jp2'), { maxPixels: 120e6, maxSide: 300 });
    expect([small.pages[0].width, small.pages[0].height]).toEqual([256, 192]);
    expect(small.warnings[0]).toMatch(/1\/4 size/);
    // The reduced picture is the full one at a quarter: compare a pixel well inside a flat area.
    const a = full.pages[0].frames[0].raster.data, b = small.pages[0].frames[0].raster.data;
    const at = (d: Uint8ClampedArray, w: number, x: number, y: number) => [...d.subarray((y * w + x) * 4, (y * w + x) * 4 + 3)];
    expect(at(b, 256, 100, 80).map((v, k) => Math.abs(v - at(a, 1024, 401, 321)[k]) <= 3)).toEqual([true, true, true]);
  });
  it('damaged data is reported', async () => {
    const u = fx('rgb-lossless.jp2').slice(0, 300);
    await expect(decodeJpx(u)).rejects.toThrow(/JPEG 2000/);
    expect(() => jpxInfo(new Uint8Array([0, 0, 0, 12, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a, 0, 0]))).toThrow(/no codestream/);
  });
});
