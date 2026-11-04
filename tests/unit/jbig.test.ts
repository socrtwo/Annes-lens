import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeJbig, isJbig, decodeJbig2, isJbig2, jbig2Segments } from '../../src/codecs/jbig';
import { decodePngTolerant } from '../../src/codecs/png';

let pdfjs: any;
beforeAll(async () => {
  const path = 'pdfjs-dist/image_decoders/pdf.image_decoders.mjs';
  pdfjs = await import(/* @vite-ignore */ path);
  const W = 'node_modules/pdfjs-dist/wasm/';
  pdfjs.JpxImage.setOptions({ useWasm: true, useWorkerFetch: false, wasmUrl: '', getHandler: () => ({ sendWithPromise: async (_k: string, { filename }: { filename: string }) => new Uint8Array(readFileSync(W + filename)) }) });
});
const fx = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/jbig/${n}`));
const ref = (n: string) => decodePngTolerant(fx(n)).pages[0].frames[0].raster;
function bad(a: { width: number; height: number; data: Uint8ClampedArray }, b: { width: number; height: number; data: Uint8ClampedArray }): number {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  let n = 0; for (let i = 0; i < a.data.length; i += 4) if (a.data[i] !== b.data[i]) n++; return n;
}

describe('JBIG (T.82; files from jbigkit)', () => {
  it('is recognized', () => { expect(isJbig(fx('seq.jbg'))).toBe(true); expect(isJbig(fx('page.jb2'))).toBe(false); });
  for (const n of ['plain', 'seq', 'two', 'reset', 'newlen', 'fax', 'gray', 'gray-planes']) {
    it(`${n} is as jbgtopbm decodes it`, () => {
      const d = decodeJbig(fx(`${n}.jbg`));
      expect(bad(d.pages[0].frames[0].raster, ref(`${n}.png`))).toBe(0);
      expect(d.warnings).toEqual([]);
    });
  }
  it('details: comment, NEWLEN height, planes', () => {
    expect(decodeJbig(fx('reset.jbg')).info.comment).toBe('Parish register, page 12');
    expect(decodeJbig(fx('newlen.jbg')).pages[0].height).toBe(380);
    expect(decodeJbig(fx('gray.jbg')).pages[0].notes[0]).toMatch(/8 bit planes \(Gray code\)/);
  });
  it('differential layers: the lowest layer, with a note', () => {
    const d = decodeJbig(fx('layers.jbg'));
    expect(bad(d.pages[0].frames[0].raster, ref('layers.png'))).toBe(0);
    expect(d.warnings[0]).toMatch(/lowest resolution layer \(200 × 130\)/);
  });
});

describe('JBIG2 (T.88) files through pdf.js', () => {
  it('sequential and random-access organization', async () => {
    expect(isJbig2(fx('page.jb2'))).toBe(true);
    expect(jbig2Segments(fx('random.jb2')).segs.map((s) => s.type)).toEqual([48, 38, 49, 51]);
    for (const n of ['page.jb2', 'random.jb2']) {
      const d = await decodeJbig2(fx(n), pdfjs);
      expect(bad(d.pages[0].frames[0].raster, ref('page.png'))).toBe(0);
    }
  });
});
