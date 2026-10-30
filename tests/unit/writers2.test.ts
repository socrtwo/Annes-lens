import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { makePdf } from '../../src/codecs/pdfwrite';
import { encodeTiff } from '../../src/codecs/tiffwrite';
import { decodeTiff } from '../../src/codecs/tiff';
import type { Raster } from '../../src/codecs/raster';

const raster = (w: number, h: number, f: (x: number, y: number) => number[]): Raster => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = f(x, y); d.set([p[0], p[1], p[2], p[3] ?? 255], (y * w + x) * 4); } return { width: w, height: h, data: d as Uint8ClampedArray<ArrayBuffer> }; };
const has = (cmd: string) => { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };

describe('tiff writer', () => {
  it('writes multipage RGB/RGBA the decoder reads back exactly', async () => {
    const a = raster(37, 11, (x, y) => [x * 6, y * 20, (x + y) & 255]), b = raster(5, 300, (x, y) => [y & 255, x * 50, 7, 128 + (y % 100)]);
    const tif = encodeTiff([{ raster: a, dpi: 300 }, { raster: b, alpha: true }]);
    expect(tif.subarray(0, 4)).toEqual(Uint8Array.from([0x49, 0x49, 42, 0]));
    const d = await decodeTiff(tif);
    expect(d.pages.length).toBe(2);
    expect([d.pages[0].width, d.pages[0].height, d.pages[1].width, d.pages[1].height]).toEqual([37, 11, 5, 300]);
    const px = (p: any, x: number, y: number) => [...p.frames[0].raster.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 4)];
    expect(px(d.pages[0], 10, 3)).toEqual([60, 60, 13, 255]);
    expect(px(d.pages[1], 2, 250)).toEqual([250, 100, 7, 178]);
  });
});

describe('pdf writer', () => {
  const jpeg = () => { const c = document.createElement('canvas'); c.width = 8; c.height = 8; return c; };
  it('produces a valid cross-reference table and pages that poppler reads', () => {
    void jpeg;
    const raw = raster(4, 3, (x) => [x * 60, 0, 0]);
    const rgb = new Uint8Array(4 * 3 * 3); for (let i = 0, j = 0; i < raw.data.length; i += 4, j += 3) { rgb[j] = raw.data[i]; rgb[j + 1] = raw.data[i + 1]; rgb[j + 2] = raw.data[i + 2]; }
    const pdf = makePdf([{ image: rgb, raw: true, width: 4, height: 3, pageWidth: 200, pageHeight: 100, margin: 10, caption: 'first (caption)' }, { image: rgb, raw: true, width: 4, height: 3 }], { title: 'Test' });
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect((text.match(/\/Type \/Page\b/g) || []).length).toBe(2);
    const start = +text.match(/startxref\n(\d+)/)![1];
    expect(text.slice(start, start + 4)).toBe('xref');
    const offsets = [...text.matchAll(/^(\d{10}) 00000 n/gm)].map((m) => +m[1]);
    offsets.forEach((o, i) => expect(text.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    expect(text).toContain('/Parent');
    expect(text.match(/\/Parent (\d+) 0 R/)![1]).toBe(text.match(/(\d+) 0 obj\n<< \/Type \/Pages/)![1]);
    if (has('pdfinfo')) {
      const dir = mkdtempSync(join(tmpdir(), 'ql-pdf-')); const f = join(dir, 't.pdf'); writeFileSync(f, pdf);
      const info = execFileSync('pdfinfo', [f]).toString();
      expect(info).toMatch(/Pages:\s+2/); expect(info).toMatch(/Title:\s+Test/); expect(info).toMatch(/Page size:\s+200 x 100/);
    }
  });
});
