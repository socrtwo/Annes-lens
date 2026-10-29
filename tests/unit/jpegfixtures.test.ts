import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readJpegCoefficients, writeJpegCoefficients, losslessTransform } from '../../src/codecs/jpegLossless';

// Fixtures written by Pillow (libjpeg): the same picture as baseline and progressive, 4:2:0 / 4:2:2 / 4:4:4 / grayscale,
// with optimized tables, restart intervals and EOB runs. Progressive and baseline files of one picture hold identical
// quantized coefficients, which pins the progressive decoder (DC/AC first and refinement scans) to libjpeg's output.
const dir = 'tests/fixtures/jpeg/';
const read = (n: string) => readJpegCoefficients(new Uint8Array(readFileSync(dir + n)));
const sameCoefs = (a: ReturnType<typeof read>, b: ReturnType<typeof read>) => {
  expect(b.width).toBe(a.width); expect(b.height).toBe(a.height); expect(b.components.length).toBe(a.components.length);
  for (let i = 0; i < a.components.length; i++) {
    const x = a.components[i].coefs, y = b.components[i].coefs;
    expect(y.length).toBe(x.length);
    let bad = -1; for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) { bad = k; break; }
    expect(bad, `component ${i} differs at ${bad}`).toBe(-1);
  }
};

describe('lossless JPEG against libjpeg files', () => {
  it('decodes progressive scans to the same coefficients as the baseline file', () => {
    for (const [a, b] of [['base-420.jpg', 'prog-420.jpg'], ['base-444.jpg', 'prog-444-opt.jpg'], ['gray.jpg', 'gray-prog.jpg'], ['smooth-base.jpg', 'smooth-prog.jpg'], ['smooth-base.jpg', 'smooth-prog-rst.jpg']]) {
      const fa = read(a), fb = read(b);
      expect(fa.progressive, a).toBe(false); expect(fb.progressive, b).toBe(true);
      expect(fa.warnings, a).toEqual([]); expect(fb.warnings, b).toEqual([]);
      sameCoefs(fa, fb);
    }
  });
  it('reads restart intervals and 4:2:2 sampling', () => {
    const f = read('base-422-rst.jpg');
    expect(f.restartInterval).toBe(3);
    expect([f.components[0].h, f.components[0].v]).toEqual([2, 1]);
    expect(f.warnings).toEqual([]);
    sameCoefs(f, read(f.progressive ? 'base-422-rst.jpg' : 'base-422-rst.jpg'));
  });
  it('rewrites every fixture to the same coefficients, usually smaller', () => {
    for (const n of ['base-420.jpg', 'prog-420.jpg', 'base-444.jpg', 'base-422-rst.jpg', 'gray.jpg', 'smooth-prog-rst.jpg', 'smooth-base.jpg']) {
      const f = read(n);
      const bytes = writeJpegCoefficients(f);
      const g = readJpegCoefficients(bytes);
      expect(g.warnings, n).toEqual([]);
      sameCoefs(f, g);
      expect(bytes.length, n).toBeLessThan(readFileSync(dir + n).length + 64);
    }
  });
  it('a quarter turn followed by its reverse gives the original coefficients and quantization tables back', () => {
    const src = new Uint8Array(readFileSync(dir + 'smooth-base.jpg'));
    const once = losslessTransform(src, 'rot90', { trim: true });
    const back = losslessTransform(once.bytes, 'rot270', {});
    const a = readJpegCoefficients(losslessTransform(src, 'none', { trim: true }).bytes), b = readJpegCoefficients(back.bytes);
    sameCoefs(a, b);
    for (let q = 0; q < 4; q++) expect(b.qt[q] ? Array.from(b.qt[q]!) : null).toEqual(a.qt[q] ? Array.from(a.qt[q]!) : null);
    // The tables moved with the coefficients: after one turn the luminance table is transposed, not equal.
    const t = readJpegCoefficients(once.bytes);
    expect(Array.from(t.qt[0]!)).not.toEqual(Array.from(a.qt[0]!));
  });
});
