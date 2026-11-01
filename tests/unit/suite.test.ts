import { describe, expect, it } from 'vitest';
import { buildDocx, buildPptx, fitEmu, type DocPicture } from '../../src/suite/ooxml';
import { readZip, readZipEntry } from '../../src/codecs/zip';
import { sanitizePrefs } from '../../src/prefs';
import { CLASSIC_MENUS, CLASSIC_LAYOUT_NAMES, installCustomMenus, menuPaths } from '../../src/ui/classicMenus';

const pic = (o: Partial<DocPicture> = {}): DocPicture => ({ data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mime: 'image/jpeg', width: 1200, height: 800, name: 'a.jpg', ...o });
const parts = (zip: Uint8Array) => { const z = readZip(zip); return Object.fromEntries(z.entries.map((e) => [e.name, readZipEntry(zip, e)])); };
const text = (u8: Uint8Array) => new TextDecoder().decode(u8);
const wellFormed = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagName('parsererror').length === 0;

describe('Office hand-off files', () => {
  it('fits pictures by their physical size inside the box', () => {
    expect(fitEmu(pic({ dpi: 300 }), 10 * 914400, 10 * 914400)).toEqual([4 * 914400, Math.round((800 / 300) * 914400)]);
    expect(fitEmu(pic({ dpi: 100 }), 6 * 914400, 9 * 914400)).toEqual([6 * 914400, 4 * 914400]);
  });
  it('writes a Word document with alt text, titles, escaped captions and numbered figures', () => {
    const p = parts(buildDocx([pic({ caption: 'Tom & "Jerry" <1940>', alt: 'Two friends', title: 'Friends' }), pic({ mime: 'image/png', name: 'b.png' })], { title: 'Album', numberFigures: true, paper: 'a4' }));
    expect(Object.keys(p).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/media/image1.jpeg', 'word/media/image2.png', 'word/styles.xml']);
    const doc = text(p['word/document.xml']);
    for (const k of Object.keys(p)) if (/\.(xml|rels)$/.test(k)) expect(wellFormed(text(p[k]))).toBe(true);
    expect(doc).toContain('<wp:docPr id="1" name="a.jpg" descr="Two friends" title="Friends"/>');
    expect(doc).toContain('Tom &amp; &quot;Jerry&quot; &lt;1940&gt;');
    expect((doc.match(/SEQ Figure/g) || []).length).toBe(2);
    expect(doc).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    expect(text(p['word/_rels/document.xml.rels'])).toContain('Target="media/image2.png"');
  });
  it('writes a deck with one picture per slide, the caption as the title and the alt text', () => {
    const p = parts(buildPptx([pic({ caption: 'Reunion 1952', alt: 'Family on a porch' }), pic({ name: 'b.jpg' })]));
    for (const k of Object.keys(p)) if (/\.(xml|rels)$/.test(k)) expect(wellFormed(text(p[k]))).toBe(true);
    const s1 = text(p['ppt/slides/slide1.xml']), s2 = text(p['ppt/slides/slide2.xml']);
    expect(s1).toContain('<p:ph type="title"/>'); expect(s1).toContain('<a:t>Reunion 1952</a:t>'); expect(s1).toContain('descr="Family on a porch"');
    expect(s2).not.toContain('type="title"');
    expect(text(p['ppt/presentation.xml'])).toContain('<p:sldId id="257" r:id="rId4"/>');
    expect(text(p['[Content_Types].xml'])).toContain('/ppt/slides/slide2.xml');
  });
});

describe('Customize Menus layouts', () => {
  it('keeps well-formed layouts in the settings and drops the rest', () => {
    const out = sanitizePrefs({ menuLayout: 'custom-abc', customMenus: [{ key: 'custom-abc', name: 'Mine', menus: [{ label: 'Pics', items: ['file.open', '|', { label: 'More', items: ['file.save', 5] }, 7] }] }, { key: 'irfanview', name: 'x', menus: [] }, 'junk'] });
    expect(out.menuLayout).toBe('custom-abc');
    expect(out.customMenus).toEqual([{ key: 'custom-abc', name: 'Mine', menus: [{ label: 'Pics', items: ['file.open', '|', { label: 'More', items: ['file.save'] }] }] }]);
    expect(sanitizePrefs({ menuLayout: 'nonsense' }).menuLayout).toBeUndefined();
  });
  it('installs custom layouts beside the built-in ones and replaces them on the next save', () => {
    installCustomMenus([{ key: 'custom-x', name: 'Mine', menus: [{ label: 'Pics', items: ['file.open', { label: 'More', items: ['file.save'] }] }] }]);
    expect([CLASSIC_LAYOUT_NAMES['custom-x'], menuPaths('custom-x', 'file.save')]).toEqual(['Mine', [['Pics', 'More']]]);
    expect(CLASSIC_MENUS.irfanview.length).toBeGreaterThan(3);
    installCustomMenus([]);
    expect('custom-x' in CLASSIC_MENUS).toBe(false);
  });
});
