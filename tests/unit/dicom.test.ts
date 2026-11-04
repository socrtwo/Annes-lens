import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { decodeDicom, isDicom, isRawDicom, NOT_FOR_DIAGNOSIS } from '../../src/codecs/dicom';
import { decodePngTolerant } from '../../src/codecs/png';
import { sniff } from '../../src/codecs/registry';
import { setOpenJpeg } from '../../src/codecs/openjpeg16';
import { createRequire } from 'node:module';

let pdfjs: any;
beforeAll(async () => {
  const path = 'pdfjs-dist/image_decoders/pdf.image_decoders.mjs';
  pdfjs = await import(/* @vite-ignore */ path);
  const W = 'node_modules/pdfjs-dist/wasm/';
  pdfjs.JpxImage.setOptions({ useWasm: true, useWorkerFetch: false, wasmUrl: '', getHandler: () => ({ sendWithPromise: async (_k: string, { filename }: { filename: string }) => new Uint8Array(readFileSync(W + filename)) }) });
  const factory = createRequire(import.meta.url)(process.cwd() + '/node_modules/@cornerstonejs/codec-openjpeg/dist/openjpegjs_decode.js'); // by file (package exports hide it)
  openjpeg = await factory({ wasmBinary: readFileSync('node_modules/@cornerstonejs/codec-openjpeg/dist/openjpegwasm_decode.wasm'), print: () => {}, printErr: () => {} });
  setOpenJpeg(openjpeg);
});
let openjpeg: any;
const DIR = 'tests/fixtures/dicom/';
const fx = (n: string) => new Uint8Array(readFileSync(DIR + n));
const ref = (n: string) => decodePngTolerant(fx(n)).pages[0].frames[0].raster;
const expected: Record<string, { frames: number; width: number; height: number; pi: string; ts: string | null; what: string; unsupported?: string }> = JSON.parse(readFileSync(DIR + 'expected.json', 'utf8'));

/** Mean and greatest absolute difference over the RGB channels. */
function diff(a: { width: number; height: number; data: Uint8ClampedArray }, b: { width: number; height: number; data: Uint8ClampedArray }): { mean: number; max: number } {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  let sum = 0, max = 0, n = 0;
  for (let i = 0; i < a.data.length; i += 4) for (let c = 0; c < 3; c++) { const d = Math.abs(a.data[i + c] - b.data[i + c]); sum += d; n++; if (d > max) max = d; }
  return { mean: sum / n, max };
}
// Tolerances: exact (rounding aside) for native, RLE, lossless, JPEG 2000 and palette pixel data; a little for DCT
// JPEGs: pdf.js's and the app's IDCTs differ from libjpeg's by a level, and pdf.js replicates subsampled chroma where
// libjpeg interpolates it, which shows at sharp color edges (the dcmtk 4:2:2 test pattern).
const TOL: Record<string, [number, number]> = { '1.2.840.10008.1.2.4.50': [3, 80], '1.2.840.10008.1.2.4.51': [0.6, 4] };

describe('DICOM (pydicom test files and files written with pydicom)', () => {
  it('is recognized by the Part 10 header, and raw data sets by their first element', () => {
    expect(isDicom(fx('CT_small.dcm'))).toBe(true);
    expect(isDicom(fx('raw-noheader.dcm'))).toBe(false);
    expect(isRawDicom(fx('raw-noheader.dcm'))).toBe(true);
    expect(isRawDicom(fx('CT_small.dcm'))).toBe(false);
    expect(sniff(fx('MR_small.dcm'), 'x.bin')?.id).toBe('dicom');
    expect(sniff(fx('raw-noheader.dcm'), 'scan.dcm')?.id).toBe('dicom');
    expect(sniff(fx('raw-noheader.dcm'), 'scan.bin')?.id ?? null).not.toBe('dicom');
  });
  for (const [name, e] of Object.entries(expected)) {
    if (e.unsupported) continue;
    it(`${name}: ${e.what}`, async () => {
      const d = await decodeDicom(fx(name), pdfjs);
      expect(d.pages.length).toBe(e.frames);
      expect([d.pages[0].width, d.pages[0].height]).toEqual([e.width, e.height]);
      const [meanTol, maxTol] = TOL[e.ts || ''] || [0.05, 1];
      for (const f of e.frames > 1 ? [0, e.frames - 1] : [0]) {
        const png = e.frames > 1 ? `${name.slice(0, -4)}.f${f}.png` : `${name.slice(0, -4)}.png`;
        expect(existsSync(DIR + png), png).toBe(true);
        const r = diff(d.pages[f].frames[0].raster, ref(png));
        expect(r.mean, `${name} frame ${f} mean`).toBeLessThanOrEqual(meanTol);
        expect(r.max, `${name} frame ${f} max`).toBeLessThanOrEqual(maxTol);
      }
      expect(d.info.notice).toBe(NOT_FOR_DIAGNOSIS);
      expect(d.pages[0].notes.at(-1)).toBe(NOT_FOR_DIAGNOSIS);
    });
  }
  it('names the transfer syntax, the window, the rescale and the patient in the details', async () => {
    const d = await decodeDicom(fx('ct-window.dcm'), pdfjs);
    expect(d.info.modality).toBe('CT');
    expect(d.info.kind).toBe('Secondary capture');
    expect(d.info.patient).toBe('Lens Anne');
    expect(d.info['patient ID']).toBe('AL-0001');
    expect(d.info['study date']).toBe('2024-03-11');
    expect(d.info['transfer syntax']).toBe('explicit VR little endian (1.2.840.10008.1.2.1)');
    expect(d.info.window).toBe('center 40, width 400 (first of 2)');
    expect(d.info.rescale).toBe('× 1 + -1024 (Hounsfield units)');
    expect(d.info['pixel spacing']).toBe('0.5 × 0.5 mm');
    expect(d.info['slice thickness']).toBe('2.5 mm');
    expect(d.info['body part']).toBe('CHEST');
    expect(d.info.pixels).toBe('monochrome, 12 of 16 bits, MONOCHROME2');
    expect(d.pages[0].dpi).toEqual([50.8, 50.8]);
    expect(d.pages[0].notes[0]).toBe('window center 40, width 400, after the rescale');
    expect(d.warnings).toEqual([]);
  });
  it('frames become pages, each with its number', async () => {
    const d = await decodeDicom(fx('frames.dcm'), pdfjs);
    expect(d.pages.map((p) => p.notes[0])).toEqual(['frame 1 of 4', 'frame 2 of 4', 'frame 3 of 4', 'frame 4 of 4']);
    expect(d.info.pixels).toBe('monochrome, 8 of 8 bits, MONOCHROME2, 4 frames');
    const r = await decodeDicom(fx('rtdose.dcm'), pdfjs, { maxFrames: 5 });
    expect(r.pages.length).toBe(5);
    expect(r.warnings).toEqual(['Only the first 5 of 15 frames are shown']);
  });
  it('explains what it cannot open', async () => {
    await expect(decodeDicom(fx('MR_small_jpeg_ls_lossless.dcm'), pdfjs)).rejects.toThrow(/JPEG-LS lossless \(JPEG-LS\) pixel data is not supported yet/);
    setOpenJpeg(null);
    try { await expect(decodeDicom(fx('MR_small_jp2klossless.dcm'), null)).rejects.toThrow(/JPEG 2000 lossless pixel data needs the JPEG decoders/); } finally { setOpenJpeg(openjpeg); }
    await expect(decodeDicom(fx('jpeg-gray.dcm'), null)).rejects.toThrow(/JPEG baseline pixel data needs the JPEG decoders/);
    expect((await decodeDicom(fx('JPGExtended.dcm'), null)).pages.length).toBe(1); // 12-bit JPEG: the app's own decoder
    await expect(decodeDicom(fx('CT_small.dcm').subarray(0, 300), pdfjs)).rejects.toThrow(/no picture|No DICOM data set/);
    const cut = await decodeDicom(fx('frames.dcm').subarray(0, fx('frames.dcm').length - 24 * 16 * 2 - 10), pdfjs);
    expect(cut.pages.length).toBe(2);
    expect(cut.warnings).toEqual(['The pixel data ends after frame 2 of 4']);
  });
  it('MONOCHROME1 is inverted and the first window of several is used; the JPEG 2000 depth note', async () => {
    const m = await decodeDicom(fx('mono1.dcm'), pdfjs);
    expect(m.pages[0].notes).toContain('MONOCHROME1: low values are bright');
    setOpenJpeg(null); // without the full-precision decoder: pdf.js's 8-bit samples, said so in the notes
    try {
      const j = await decodeDicom(fx('j2k-12bit.dcm'), pdfjs);
      expect(j.pages[0].notes.some((n) => /full-precision JPEG 2000 decoder was not available.*steps of 256$/.test(n))).toBe(true);
      const r = diff(j.pages[0].frames[0].raster, ref('j2k-12bit.png'));
      expect(r.max).toBeLessThanOrEqual(24);
      const s = await decodeDicom(fx('693_J2KI.dcm'), pdfjs);
      expect(s.pages[0].notes.some((n) => /and negative values are lost$/.test(n))).toBe(true);
    } finally { setOpenJpeg(openjpeg); }
  });
});
