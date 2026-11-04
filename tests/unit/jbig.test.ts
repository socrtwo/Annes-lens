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
  it('resolution layers are decoded to the full picture: every option, stripe order, SDRST and NEWLEN', () => {
    const page = ref('layers.png');
    for (const n of ['layers', 'layers-plain', 'layers-tp', 'layers-two', 'layers-d3', 'layers-reset', 'layers-newlen', ...[0, 2, 4, 5, 6, 8, 10, 11, 12, 13, 14].map((o) => `order-${o}`)]) {
      const d = decodeJbig(fx(`${n}.jbg`));
      expect(bad(d.pages[0].frames[0].raster, page), n).toBe(0);
      expect(d.warnings, n).toEqual([]);
    }
    expect(decodeJbig(fx('layers.jbg')).pages[0].notes[1]).toBe('3 resolution layers (200 × 130, 400 × 260, 800 × 520), decoded to the full resolution with typical and deterministic prediction');
    expect(decodeJbig(fx('layers-tp.jbg')).pages[0].notes[1]).toBe('2 resolution layers (400 × 260, 800 × 520), decoded to the full resolution with typical prediction');
    expect(decodeJbig(fx('layers-plain.jbg')).pages[0].notes[1]).toBe('3 resolution layers (200 × 130, 400 × 260, 800 × 520), decoded to the full resolution');
  });
  it('8 bit planes with a resolution layer', () => {
    expect(bad(decodeJbig(fx('gray-layers.jbg')).pages[0].frames[0].raster, ref('gray-layers.png'))).toBe(0);
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
