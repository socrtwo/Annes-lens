import { describe, it, expect } from 'vitest';
import { extractMeta, injectJpegMeta, injectPngMeta, injectWebpMeta, setExifOrientation, exifOrientation, crc32 } from '../../src/meta/metaWrite';
import { readExif } from '../../src/meta/exif';

const ascii = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
/** A minimal little-endian EXIF block with Orientation = 6 and Make = "Acme". */
function exifBlock(orientation = 6): Uint8Array {
  const le16 = (v: number) => [v & 255, v >> 8], le32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  const b = [0x49, 0x49, 42, 0, 8, 0, 0, 0, ...le16(2)];
  const makeAt = 8 + 2 + 2 * 12 + 4;
  b.push(...le16(0x10f), ...le16(2), ...le32(5), ...le32(makeAt));
  b.push(...le16(0x112), ...le16(3), ...le32(1), ...le16(orientation), 0, 0);
  b.push(...le32(0), ...ascii('Acme\0'), 0);
  return Uint8Array.from(b);
}
const jpeg = () => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xdb, 0, 4, 0, 1, 0xff, 0xda, 0, 2, 9, 0xff, 0xd9]);

describe('metadata across saves', () => {
  it('round-trips EXIF, XMP and a split ICC profile through a JPEG', () => {
    const icc = new Uint8Array(70000); for (let i = 0; i < icc.length; i++) icc[i] = i & 255;
    const xmp = ascii('<x:xmpmeta/>');
    const out = injectJpegMeta(jpeg(), { exif: exifBlock(), xmp, icc });
    expect(out.subarray(0, 2)).toEqual(Uint8Array.from([0xff, 0xd8]));
    expect(out[2] === 0xff && out[3] === 0xe0).toBe(true); // APP0 stays first
    const m = extractMeta(out);
    expect([...m.exif!]).toEqual([...exifBlock()]);
    expect([...m.xmp!]).toEqual([...xmp]);
    expect(m.icc!.length).toBe(70000);
    expect(m.icc![69999]).toBe(69999 & 255);
    expect(readExif(out)?.make).toBe('Acme');
    expect(readExif(out)?.orientation).toBe(6);
    expect(out[out.length - 1]).toBe(0xd9);
  });
  it('resets the orientation tag without touching the rest', () => {
    const e = exifBlock(6);
    const upright = setExifOrientation(e, 1);
    expect(exifOrientation(e)).toBe(6);
    expect(exifOrientation(upright)).toBe(1);
    expect(upright.length).toBe(e.length);
    expect(readExif(injectJpegMeta(jpeg(), { exif: upright }))?.make).toBe('Acme');
  });
  it('writes eXIf and iTXt chunks before IDAT with correct CRCs, and reads them back', () => {
    const ihdr = Uint8Array.from([0, 0, 0, 13, ...ascii('IHDR'), 0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0, 0x3a, 0x7e, 0x9b, 0x55]);
    const idat = Uint8Array.from([0, 0, 0, 0, ...ascii('IDAT'), 0x35, 0xaf, 0x06, 0x1e]);
    const iend = Uint8Array.from([0, 0, 0, 0, ...ascii('IEND'), 0xae, 0x42, 0x60, 0x82]);
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, ...ihdr, ...idat, ...iend]);
    expect(crc32(ascii('IEND'))).toBe(0xae426082);
    const out = injectPngMeta(png, { exif: exifBlock(3), xmp: ascii('<x/>') });
    const types: string[] = [];
    let p = 8;
    while (p + 12 <= out.length) { const len = (out[p] << 24 | out[p + 1] << 16 | out[p + 2] << 8 | out[p + 3]) >>> 0; const t = String.fromCharCode(...out.subarray(p + 4, p + 8)); types.push(t); expect(crc32(out, p + 4, p + 8 + len), t).toBe(((out[p + 8 + len] << 24) | (out[p + 9 + len] << 16) | (out[p + 10 + len] << 8) | out[p + 11 + len]) >>> 0); p += 12 + len; }
    expect(types).toEqual(['IHDR', 'eXIf', 'iTXt', 'IDAT', 'IEND']);
    const m = extractMeta(out);
    expect(exifOrientation(m.exif!)).toBe(3);
    expect(String.fromCharCode(...m.xmp!)).toBe('<x/>');
    expect(readExif(out)?.orientation).toBe(3);
  });
  it('creates a VP8X header for a simple WebP and appends EXIF and XMP chunks', () => {
    // VP8L chunk: signature 0x2f, then 14-bit width-1 (=2), 14-bit height-1 (=1), alpha bit set.
    const bits = (2) | (1 << 14) | (1 << 28);
    const vp8l = [0x2f, bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, (bits >>> 24) & 255, 0];
    const body = [...ascii('VP8L'), vp8l.length, 0, 0, 0, ...vp8l];
    const webp = Uint8Array.from([...ascii('RIFF'), body.length + 4, 0, 0, 0, ...ascii('WEBP'), ...body]);
    const out = injectWebpMeta(webp, { exif: exifBlock(8), xmp: ascii('<x/>') });
    expect(String.fromCharCode(...out.subarray(12, 16))).toBe('VP8X');
    const flags = out[20];
    expect(flags & 0x08).toBe(0x08); expect(flags & 0x04).toBe(0x04); expect(flags & 0x10).toBe(0x10);
    expect(out[24] | (out[25] << 8)).toBe(2); // canvas width - 1
    expect(out[27] | (out[28] << 8)).toBe(1);
    const riffSize = out[4] | (out[5] << 8) | (out[6] << 16) | (out[7] << 24);
    expect(riffSize).toBe(out.length - 8);
    const m = extractMeta(out);
    expect(exifOrientation(m.exif!)).toBe(8);
    expect(String.fromCharCode(...m.xmp!)).toBe('<x/>');
    expect(readExif(out)?.orientation).toBe(8);
    // Re-injecting replaces rather than duplicates.
    const again = injectWebpMeta(out, { exif: exifBlock(1) });
    expect(exifOrientation(extractMeta(again).exif!)).toBe(1);
    expect(again.length).toBe(out.length - 8 - 4); // the XMP chunk is gone
  });
  it('leaves other formats and files without metadata alone', () => {
    expect(extractMeta(Uint8Array.from([1, 2, 3, 4]))).toEqual({});
    const j = jpeg();
    expect(injectJpegMeta(j, {})).toBe(j);
    expect(extractMeta(j)).toEqual({});
  });
});
