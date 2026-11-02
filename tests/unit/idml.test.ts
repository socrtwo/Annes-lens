import { describe, expect, it } from 'vitest';
import { buildIdml, gridPages, spreadsOf, withPngPpi, BOOK_SIZES, type IdmlImage } from '../../src/suite/idml';
import { readZip, readZipEntry } from '../../src/codecs/zip';

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'), (c) => c.charCodeAt(0));
const img = (w: number, h: number, o: Partial<IdmlImage> = {}): IdmlImage => ({ data: PNG, mime: 'image/png', width: w, height: h, name: `p${w}x${h}.png`, ...o });
const parts = (zip: Uint8Array) => { const z = readZip(zip); return { order: z.entries.map((e) => e.name), methods: z.entries.map((e) => e.method), get: (n: string) => new TextDecoder().decode(readZipEntry(zip, z.entries.find((e) => e.name === n)!)) }; };
const wellFormed = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagName('parsererror').length === 0;

describe('IDML for Anne\'s Press', () => {
  it('lays out one, two or four pictures a page with captions and a title page', () => {
    const items = [1, 2, 3, 4, 5].map((i) => ({ image: img(400, 300), caption: `Picture ${i}` }));
    const p1 = gridPages(items, { width: 612, height: 792, perPage: 1, captions: true, coverTitle: 'Book' });
    expect(p1.length).toBe(6);
    expect(p1[0].frames[0]).toMatchObject({ kind: 'text', style: 'Title', text: 'Book' });
    expect(p1[1].frames.map((f) => [f.kind, f.x, f.y, f.w, f.h])).toEqual([['image', 36, 36, 540, 720 - 26], ['text', 36, 36 + 720 - 26 + 4, 540, 22]]);
    const p2 = gridPages(items, { width: 792, height: 612, perPage: 2, captions: false });
    expect(p2.length).toBe(3);
    expect(p2[0].frames.map((f) => Math.round(f.x))).toEqual([36, 36 + 351 + 18]); // side by side on a landscape page
    const p4 = gridPages(items, { width: 576, height: 576, perPage: 4, captions: false });
    expect([p4.length, p4[0].frames.length, p4[1].frames.length]).toEqual([2, 4, 1]);
    expect(BOOK_SIZES.square8).toMatchObject({ w: 576, h: 576 });
  });
  it('pairs facing pages after a first right-hand page', () => {
    const doc = (n: number, facing: boolean) => ({ width: 100, height: 100, facing, pages: Array.from({ length: n }, () => ({ frames: [] })) });
    expect(spreadsOf(doc(5, true))).toEqual([[0], [1, 2], [3, 4]]);
    expect(spreadsOf(doc(4, true))).toEqual([[0], [1, 2], [3]]);
    expect(spreadsOf(doc(3, false))).toEqual([[0], [1], [2]]);
  });
  it('writes a package InDesign, Affinity Publisher and Scribus read', () => {
    const z = parts(buildIdml({ width: 576, height: 576, facing: true, title: 'A & B', pages: gridPages([{ image: img(1200, 800, { alt: 'A red "barn"', ppi: 300 }), caption: 'Barn & sky' }, { image: img(400, 600) }], { width: 576, height: 576, perPage: 1, captions: true, coverTitle: 'Family' }) }));
    expect([z.order[0], z.methods[0], z.get('mimetype')]).toEqual(['mimetype', 0, 'application/vnd.adobe.indesign-idml-package']);
    for (const n of z.order.filter((n) => n.endsWith('.xml'))) expect(wellFormed(z.get(n))).toBe(true);
    const design = z.get('designmap.xml');
    expect((design.match(/<idPkg:Spread /g) || []).length).toBe(2); // title page, then the two pictures facing
    const spread2 = z.get(z.order.find((n) => n.startsWith('Spreads/') && z.get(n).includes('PageCount="2"'))!);
    // Left page from the binding edge, right page at it; the 1200 × 800 px picture at 300 ppi is 288 × 192 pt.
    expect(spread2).toContain('ItemTransform="1 0 0 1 -576 -288"'); expect(spread2).toContain('ItemTransform="1 0 0 1 0 -288"');
    expect(spread2).toContain('<GraphicBounds Left="0" Top="0" Right="288" Bottom="192"/>');
    expect(spread2).toContain('CustomAltText="A red &quot;barn&quot;"');
    expect(spread2).toContain('FittingOnEmptyFrame="None"'); expect(spread2).toContain('StoredState="Embedded"');
    const stories = z.order.filter((n) => n.startsWith('Stories/')).map((n) => z.get(n)).join('');
    expect(stories).toContain('<Content>Barn &amp; sky</Content>'); expect(stories).toContain('ParagraphStyle/Title');
  });
  it('sets the PNG resolution so every reader sizes the picture alike', () => {
    const out = withPngPpi(PNG, 300), dv = new DataView(out.buffer);
    expect(String.fromCharCode(...out.subarray(37, 41))).toBe('pHYs');
    expect([dv.getUint32(41), out[49]]).toEqual([11811, 1]);
    expect(withPngPpi(out, 72).length).toBe(out.length); // replaced, not added twice
  });
});
