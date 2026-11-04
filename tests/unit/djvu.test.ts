import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeDjvu, djvuKind, setDjvuModule, djvuOptions, repairDjvu, salvageBundle } from '../../src/codecs/djvu';
import { decodePngTolerant } from '../../src/codecs/png';
import { sniff, formatById } from '../../src/codecs/registry';
import type { Raster } from '../../src/codecs/raster';

// djvu-rs from node_modules, initialized from the WebAssembly bytes of the build its loader picks.
beforeAll(async () => {
  const root = process.cwd() + '/node_modules/djvu-rs/';
  const m: any = await import(/* @vite-ignore */ root + 'djvu_rs.js');
  await m.default(readFileSync(root + (m.wasmSimd128Supported() ? 'simd128' : 'scalar') + '/djvu_rs_bg.wasm'));
  setDjvuModule(m);
});
const fx = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/djvu/${n}`));
const ref = (n: string) => decodePngTolerant(fx(n)).pages[0].frames[0].raster;
/** Largest difference over R, G and B (the references are DjVuLibre's renderings, as RGB, gray or bitonal PNG). */
function diff(a: Raster, b: Raster): number {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  let max = 0;
  for (let i = 0; i < a.data.length; i += 4) for (let c = 0; c < 3; c++) max = Math.max(max, Math.abs(a.data[i + c] - b.data[i + c]));
  return max;
}
const opts = (o: Partial<typeof djvuOptions> = {}) => ({ ...djvuOptions, ...o });

describe('DjVu (djvu-rs; files from DjVuLibre)', () => {
  it('is recognized by its IFF form, not by its name', () => {
    expect(sniff(fx('book.djvu'), 'x.bin')?.id).toBe('djvu');
    expect(sniff(fx('bitonal.djvu'), 'x')?.id).toBe('djvu');
    expect([djvuKind(fx('color.djvu')), djvuKind(fx('book.djvu')), djvuKind(fx('indirect.djvu'))]).toEqual(['DJVU', 'DJVM', 'DJVM']);
    expect(djvuKind(new TextEncoder().encode('AT&TFORM\0\0\0\x04ILBM'))).toBeNull();
    expect(formatById('djvu')?.extensions).toEqual(['djvu', 'djv']);
  });
  it('IW44 color and gray pages are the same as DjVuLibre renders them', async () => {
    const c = await decodeDjvu(fx('color.djvu'), opts());
    expect(diff(c.pages[0].frames[0].raster, ref('color.png'))).toBe(0);
    expect(c.pages[0].dpi).toEqual([100, 100]);
    expect(c.pages[0].notes).toContain('rendered at full resolution by djvu-rs');
    const g = await decodeDjvu(fx('gray.djvu'), opts());
    expect(diff(g.pages[0].frames[0].raster, ref('gray.png'))).toBe(0);
  });
  it('a bitonal JB2 page, and a compound page (mask, foreground colors, IW44 background)', async () => {
    const b = await decodeDjvu(fx('bitonal.djvu'), opts());
    expect(diff(b.pages[0].frames[0].raster, ref('bitonal.png'))).toBe(0);
    expect(b.pages[0].notes).toContain('bitonal (no background layer)');
    const k = await decodeDjvu(fx('compound.djvu'), opts());
    expect(diff(k.pages[0].frames[0].raster, ref('compound.png'))).toBe(0);
    expect(k.pages[0].notes.some((n) => /IW44 background in 3 refinement chunks/.test(n))).toBe(true);
  });
  it('a bundled document: every page, the page rotation, the text layer', async () => {
    const d = await decodeDjvu(fx('book.djvu'), opts());
    expect(d.pages.length).toBe(4);
    expect(d.info).toMatchObject({ pages: '4', document: 'bundled (several pages in one file)', 'text layer': '1 of 4 pages' });
    expect(diff(d.pages[0].frames[0].raster, ref('color.png'))).toBe(0);
    expect([d.pages[1].width, d.pages[1].height]).toEqual([150, 200]); // turned 90° by the page's INFO
    expect(diff(d.pages[1].frames[0].raster, ref('book-2.png'))).toBe(0);
    expect(diff(d.pages[2].frames[0].raster, ref('bitonal.png'))).toBe(0);
    expect(diff(d.pages[3].frames[0].raster, ref('compound.png'))).toBe(0);
    expect(d.pages[0].notes[0]).toBe('DjVu page 1 of 4');
    const t = d.pages[2].textLayer!;
    expect(t.text).toBe('Parish register 1851\nBaptisms and burials');
    expect(t.words.map((w) => w.text)).toEqual(['Parish', 'register', '1851', 'Baptisms', 'and', 'burials']);
    // Written bottom-up as (word 30 190 141 221 "Parish") on a 260-pixel-high page: top-left boxes here.
    expect(t.words[0].bbox).toEqual({ x0: 30, y0: 39, x1: 141, y1: 70 });
    expect(d.pages[0].textLayer).toBeUndefined();
    expect(d.pages[2].notes.some((n) => /text layer: 6 words/.test(n))).toBe(true);
  });
  it('pages whose glyphs come from shared JB2 dictionaries (minidjvu)', async () => {
    const d = await decodeDjvu(fx('shared.djvu'), opts());
    expect(d.pages.length).toBe(3);
    for (let i = 0; i < 3; i++) expect(diff(d.pages[i].frames[0].raster, ref(`shared-${i + 1}.png`))).toBe(0);
  });
  it('the page limit and the pixel budget (resolution and word boxes scaled together)', async () => {
    const d = await decodeDjvu(fx('book.djvu'), opts({ maxPages: 2 }));
    expect(d.pages.length).toBe(2); expect(d.info.pages).toBe('4');
    expect(d.warnings.some((w) => /Pages 1–2 of 4/.test(w))).toBe(true);
    const s = await decodeDjvu(fx('bitonal.djvu'), opts({ budget: 600 * 260 / 4 }));
    expect(s.pages[0].dpi).toEqual([150, 150]);
    expect([s.pages[0].width, s.pages[0].height]).toEqual([300, 130]);
    expect(s.warnings.some((w) => /below the scanned resolution/.test(w))).toBe(true);
    const b = await decodeDjvu(fx('book.djvu'), opts({ budget: 1000 }));
    expect(b.pages[2].dpi![0]).toBe(72); // not below 72 dpi
    const w = b.pages[2].textLayer!.words[0].bbox;
    expect(w.x0).toBeCloseTo(30 * 72 / 300, 0); expect(w.y0).toBeCloseTo(39 * 72 / 300, 0);
  });
  it('a file cut short shows what arrived', async () => {
    // A single page: the complete chunks (two of the three IW44 refinement chunks).
    const c = fx('color.djvu'), cut = c.subarray(0, 1500);
    expect(repairDjvu(c)).toBeNull();
    const r = repairDjvu(cut)!; expect(r.kept).toBeLessThan(1500);
    const p = await decodeDjvu(cut, opts());
    expect(p.pages[0].notes).toContain('IW44 background in 2 refinement chunks');
    expect(p.warnings[0]).toMatch(/cut short \(1500 bytes; \d+ at the end are an incomplete part\): the page that arrived is shown/);
    // A bundle whose directory lists pages that are missing: the pages that arrived, one by one.
    const b = await decodeDjvu(fx('book.djvu').subarray(0, 3500), opts()); // page 3's JB2 data arrived, its text chunk did not
    expect(b.pages.length).toBe(3);
    expect(b.pages[0].notes[0]).toBe('DjVu page 1 (of a document cut short)');
    expect(diff(b.pages[0].frames[0].raster, ref('color.png'))).toBe(0);
    expect(diff(b.pages[1].frames[0].raster, ref('book-2.png'))).toBe(0); // its rotation kept
    expect(diff(b.pages[2].frames[0].raster, ref('bitonal.png'))).toBe(0); expect(b.pages[2].textLayer).toBeUndefined();
    // Shared dictionaries go with the pages that include them.
    const sh = fx('shared.djvu');
    expect(salvageBundle(sh).length).toBe(3);
    const s = await decodeDjvu(sh.subarray(0, sh.length - 200), opts());
    expect(s.pages.length).toBe(3);
    expect(diff(s.pages[0].frames[0].raster, ref('shared-1.png'))).toBe(0);
    expect(diff(s.pages[1].frames[0].raster, ref('shared-2.png'))).toBe(0);
  });
  it('indirect documents, shared data and damaged files are reported', async () => {
    await expect(decodeDjvu(fx('indirect.djvu'), opts())).rejects.toThrow(/index of an indirect DjVu document/);
    await expect(decodeDjvu(new TextEncoder().encode('AT&TFORM\0\0\0\x04DJVI'), opts())).rejects.toThrow(/shared by the pages/);
    const book = fx('book.djvu');
    await expect(decodeDjvu(book.subarray(0, 40), opts())).rejects.toThrow(/could not be read/);
  });
});
