import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseXmp, updateXmp, scrubXmp, emptyXmp, parseXmpGps, formatXmpGps } from '../../src/meta/xmp';
import { readIptc, writeIptc, parseIim, buildIim } from '../../src/meta/iptc';
import { setXmp, getComment, setComment, stripMeta, removeGpsFromExif, hasGpsIfd, exifDates, mapExifDates, minimalExif, detectProvenance, md5, sha, parseExifDate, formatExifDate } from '../../src/meta/metaEdit';
import { extractMeta, exifOrientation } from '../../src/meta/metaWrite';
import { readExif } from '../../src/meta/exif';
import { sniff } from '../../src/codecs/registry';
import { jpegInfo, pngInfo } from '../../src/codecs/info';
const sizeOf = (u8: Uint8Array, format: string) => { const id = sniff(u8)?.id; if (id !== format) return null; if (format === 'jpeg') { const i = jpegInfo(u8) as any; return [i.width, i.height]; } if (format === 'png') { const i = pngInfo(u8) as any; return [i.width, i.height]; } const dv = new DataView(u8.buffer, u8.byteOffset); return [(dv.getUint32(24, true) & 0xffffff) + 1, (dv.getUint32(27, true) & 0xffffff) + 1]; };

const fx = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/meta/${n}`));
const txt = (u8: Uint8Array | undefined) => (u8 ? new TextDecoder().decode(u8) : '');

describe('xmp', () => {
  it('reads the fixture packet (attributes, alt, bag, seq)', () => {
    const p = parseXmp(txt(extractMeta(fx('tagged.jpg')).xmp));
    expect(p.rating).toBe(3); expect(p.city).toBe('Bath'); expect(p.title).toBe('A title & more'); expect(p.keywords).toEqual(['one', 'two']); expect(p.creator).toEqual(['Jane Doe']); expect(p.personInImage).toEqual(['Bob']);
    expect(p.digitalSourceType).toContain('trainedAlgorithmicMedia');
  });
  it('updates properties in place and keeps the rest', () => {
    const orig = txt(extractMeta(fx('tagged.jpg')).xmp);
    const out = updateXmp(orig, { rating: 5, keywords: ['three'], title: 'New <title>', label: 'Red', favorite: true, flag: 'pick', lat: 51.5, lon: -0.125, citation: { repository: 'Somerset Archives', page: '12' } });
    const p = parseXmp(out);
    expect(p.rating).toBe(5); expect(p.keywords).toEqual(['three']); expect(p.title).toBe('New <title>'); expect(p.label).toBe('Red'); expect(p.favorite).toBe(true); expect(p.flag).toBe('pick');
    expect(p.lat).toBeCloseTo(51.5, 5); expect(p.lon).toBeCloseTo(-0.125, 5); expect(p.citation).toEqual({ repository: 'Somerset Archives', page: '12' });
    expect(p.city).toBe('Bath'); expect(p.creator).toEqual(['Jane Doe']); expect(p.personInImage).toEqual(['Bob']); // untouched
    expect(out.match(/<xmp:Rating>/g)!.length).toBe(1); expect(out).not.toMatch(/xmp:Rating=/);
    const cleared = parseXmp(updateXmp(out, { rating: undefined, keywords: [], favorite: false, lat: undefined, lon: undefined, citation: {} }));
    expect(cleared.rating).toBeUndefined(); expect(cleared.keywords).toBeUndefined(); expect(cleared.favorite).toBeUndefined(); expect(cleared.lat).toBeUndefined(); expect(cleared.citation).toBeUndefined();
  });
  it('creates a packet from nothing and scrubs location, people and history', () => {
    const p = parseXmp(updateXmp(null, { description: 'Caption', rights: '© 2026', creator: ['A', 'B'] }));
    expect(p).toMatchObject({ description: 'Caption', rights: '© 2026', creator: ['A', 'B'] });
    expect(parseXmp(emptyXmp())).toEqual({});
    const s = parseXmp(scrubXmp(updateXmp(txt(extractMeta(fx('tagged.jpg')).xmp), { lat: 1, lon: 2 }), { location: true, people: true, history: true }));
    expect(s.city).toBeUndefined(); expect(s.lat).toBeUndefined(); expect(s.personInImage).toBeUndefined(); expect(s.rating).toBe(3);
  });
  it('GPS forms', () => { expect(parseXmpGps('51,30N')).toBeCloseTo(51.5); expect(parseXmpGps('0,7,30W')).toBeCloseTo(-0.125); expect(parseXmpGps(formatXmpGps(-33.8688, true))).toBeCloseTo(-33.8688, 5); expect(formatXmpGps(51.5, true)).toBe('51,30N'); });
});

describe('iptc', () => {
  it('round-trips fields through APP13 and parses IIM', () => {
    const f = { title: 'Title', keywords: ['k1', 'k2'], byline: 'Jane Dóe', caption: 'A caption', copyright: '© Jane', city: 'Bath', dateCreated: '20200506' };
    const out = writeIptc(fx('tagged.jpg'), f);
    expect(readIptc(fx('tagged.jpg'))).toBeUndefined();
    expect(readIptc(out)).toEqual(f);
    expect(parseIim(buildIim(f))).toEqual(f);
    const again = writeIptc(out, { title: 'Only' });
    expect(readIptc(again)).toEqual({ title: 'Only' });
    expect(readIptc(writeIptc(again, null))).toBeUndefined();
    expect(readExif(out)?.model).toBe('TestModel'); // EXIF untouched
    expect(parseXmp(txt(extractMeta(out).xmp)).rating).toBe(3);
  });
});

describe('container edits', () => {
  for (const [name, format] of [['tagged.jpg', 'jpeg'], ['tagged.png', 'png'], ['tagged.webp', 'webp']] as const) {
    it(`replaces and removes the XMP packet in ${format} and keeps the picture decodable`, async () => {
      const src = fx(name);
      const out = setXmp(src, format, new TextEncoder().encode(updateXmp(txt(extractMeta(src).xmp), { rating: 1 })));
      expect(parseXmp(txt(extractMeta(out).xmp)).rating).toBe(1);
      expect(readExif(out)?.orientation).toBe(6);
      const gone = setXmp(out, format, null);
      expect(extractMeta(gone).xmp).toBeUndefined(); expect(readExif(gone)?.orientation).toBe(6);
      const fresh = setXmp(gone, format, new TextEncoder().encode(updateXmp(null, { rating: 2 })));
      expect(parseXmp(txt(extractMeta(fresh).xmp)).rating).toBe(2);
      expect(sizeOf(fresh, format)).toEqual([24, 16]);
    });
    it(`strips ${format} keeping the orientation only`, async () => {
      const src0 = fx(name), src = extractMeta(src0).xmp ? src0 : setXmp(src0, format, extractMeta(fx('tagged.jpg')).xmp!);
      const out = stripMeta(src, format, { orientation: true, exifReplacement: minimalExif({ orientation: 6 }) });
      const m = extractMeta(out);
      expect(m.xmp).toBeUndefined(); expect(readExif(out)?.orientation).toBe(6); expect(readExif(out)?.model).toBeUndefined();
      expect(getComment(out, format)).toBeUndefined();
      const bare = stripMeta(src, format, {});
      expect(extractMeta(bare).exif).toBeUndefined(); expect(bare.length).toBeLessThan(src.length);
      expect(sizeOf(bare, format)).toEqual([24, 16]);
      const keep = stripMeta(src, format, { exif: true, xmp: true });
      expect(readExif(keep)?.model).toBe('TestModel'); expect(parseXmp(txt(extractMeta(keep).xmp)).rating).toBe(3);
    });
  }
  it('comments in JPEG and PNG', () => {
    expect(getComment(fx('tagged.jpg'), 'jpeg')).toBe('A comment');
    const j = setComment(fx('tagged.jpg'), 'jpeg', 'Changed ✓'); expect(getComment(j, 'jpeg')).toBe('Changed ✓'); expect(getComment(setComment(j, 'jpeg', ''), 'jpeg')).toBeUndefined();
    const p = setComment(fx('tagged.png'), 'png', 'PNG note'); expect(getComment(p, 'png')).toBe('PNG note'); expect(readExif(p)?.orientation).toBe(6);
  });
  it('EXIF: GPS removal, dates in place, minimal block', () => {
    const exif = extractMeta(fx('tagged.jpg')).exif!;
    expect(hasGpsIfd(exif)).toBe(true); expect(readExif(fx('tagged.jpg'))?.gps?.lat).toBeCloseTo(51.5);
    const noGps = removeGpsFromExif(exif);
    expect(hasGpsIfd(noGps)).toBe(false); expect(noGps.length).toBe(exif.length);
    const parsed = (() => { const j = fx('tagged.jpg'); const { setXmp: _s } = { setXmp }; void _s; return readExif(stripMeta(j, 'jpeg', { exifReplacement: noGps, xmp: true, comment: true })); })();
    expect(parsed?.gps).toBeUndefined(); expect(parsed?.model).toBe('TestModel'); expect(parsed?.orientation).toBe(6);
    expect(exifDates(exif)).toEqual({ dateTime: '2020:05:06 07:08:09', original: '2020:05:06 07:08:09', digitized: '2020:05:06 07:08:10' });
    const shifted = mapExifDates(exif, (old) => formatExifDate(new Date(parseExifDate(old)!.getTime() + 3600e3)));
    expect(exifDates(shifted)).toEqual({ dateTime: '2020:05:06 08:08:09', original: '2020:05:06 08:08:09', digitized: '2020:05:06 08:08:10' });
    expect(shifted.length).toBe(exif.length);
    const min = minimalExif({ orientation: 8, artist: 'Me', copyright: '© Me' })!;
    expect(exifOrientation(min)).toBe(8); const r = readExif(stripMeta(fx('tagged.jpg'), 'jpeg', { exifReplacement: min })); expect(r?.artist).toBe('Me'); expect(r?.copyright).toBe('© Me');
    expect(minimalExif({ orientation: 1 })).toBeNull();
  });
  it('detects content credentials boxes and reads the digital source type', () => {
    expect(detectProvenance(fx('tagged.jpg')).c2pa).toBe(false);
    const box = new TextEncoder().encode('JP\0\0\0\0\0\x20jumbc2pa.manifest');
    const withC2pa = new Uint8Array([0xff, 0xd8, 0xff, 0xeb, (box.length + 2) >> 8, (box.length + 2) & 255, ...box, ...fx('tagged.jpg').subarray(2)]);
    const p = detectProvenance(withC2pa); expect(p.c2pa).toBe(true); expect(p.where).toEqual(['JPEG APP11 JUMBF']); expect(p.jumbfLabels).toContain('c2pa.manifest');
  });
  it('checksums', async () => {
    expect(md5(new Uint8Array(0))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5(new TextEncoder().encode('The quick brown fox jumps over the lazy dog'))).toBe('9e107d9d372bb6826bd81d3542a419d6');
    expect(md5(new Uint8Array(100).fill(97))).toBe('36a92cc94a9e0fa21f625f8bfb007adf');
    expect(await sha(new Uint8Array(0), 'SHA-256')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
