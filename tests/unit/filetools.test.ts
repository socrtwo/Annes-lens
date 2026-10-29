import { describe, it, expect } from 'vitest';
import { landmarks, hexDump, rawPixels, guessSizes } from '../../src/commands/fileTools';

describe('hex view', () => {
  it('lists JPEG markers, PNG chunks, RIFF chunks and TIFF IFDs with offsets', () => {
    const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xe1, 0, 8, 0x45, 0x78, 0x69, 0x66, 0, 0, 0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9]);
    expect(landmarks(jpg).map((m) => `${m.offset}:${m.label}`)).toEqual(['0:Start of file', '2:APP0 JFIF (4 bytes)', '8:APP1 EXIF (8 bytes)', '18:SOS scan data (2 bytes)', '25:EOI end of image', '0:End of file']);
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...new Array(17).fill(0), 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0]);
    expect(landmarks(png).slice(1, 3).map((m) => m.label)).toEqual(['IHDR chunk (13 bytes)', 'IEND chunk (0 bytes)']);
    const riff = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 20, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, 4, 0, 0, 0, 1, 2, 3, 4, 0x45, 0x58, 0x49, 0x46, 0, 0, 0, 0]);
    expect(landmarks(riff).map((m) => m.label)).toContain('EXIF chunk (0 bytes)');
    const tiff = Uint8Array.from([0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0, 1, 3, 0, 1, 0, 0, 0, 2, 0, 0, 0, 26, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(landmarks(tiff).map((m) => m.label)).toEqual(['Start of file', 'IFD0 (1 entries)', 'IFD1 (0 entries)', 'End of file']);
  });
  it('dumps hex and ASCII columns', () => {
    const u8 = Uint8Array.from([...'Hello, world!'].map((c) => c.charCodeAt(0)));
    const dump = hexDump(u8, 0, 2);
    expect(dump).toBe('000000  48 65 6c 6c 6f 2c 20 77  6f 72 6c 64 21           Hello, world!');
    expect(hexDump(new Uint8Array(40), 16, 1)).toMatch(/^000010  00 00/);
  });
});

describe('RAW pixel data', () => {
  it('interprets common layouts, strides, offsets and bottom-up rows', () => {
    const rgb = rawPixels(Uint8Array.from([9, 9, 255, 0, 0, 0, 0, 255, 0]), { width: 2, height: 1, layout: 'rgb', offset: 2, littleEndian: true, flip: false });
    expect([...rgb.raster.data]).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
    expect(rgb.truncated).toBe(false);
    const bgra = rawPixels(Uint8Array.from([255, 0, 0, 128]), { width: 1, height: 1, layout: 'bgra', offset: 0, littleEndian: true, flip: false });
    expect([...bgra.raster.data]).toEqual([0, 0, 255, 128]);
    const g16 = rawPixels(Uint8Array.from([0x00, 0x80, 0x80, 0x00]), { width: 2, height: 1, layout: 'gray16', offset: 0, littleEndian: true, flip: false });
    expect([g16.raster.data[0], g16.raster.data[4]]).toEqual([128, 0]);
    const be = rawPixels(Uint8Array.from([0x00, 0x80]), { width: 1, height: 1, layout: 'gray16', offset: 0, littleEndian: false, flip: false });
    expect(be.raster.data[0]).toBe(0);
    const strided = rawPixels(Uint8Array.from([1, 0, 0, 0, 2, 0, 0, 0]), { width: 1, height: 2, layout: 'gray8', offset: 0, stride: 4, littleEndian: true, flip: true });
    expect([strided.raster.data[0], strided.raster.data[4]]).toEqual([2, 1]);
    const mono = rawPixels(Uint8Array.from([0b10100000]), { width: 3, height: 1, layout: 'mono', offset: 0, littleEndian: true, flip: false });
    expect([mono.raster.data[0], mono.raster.data[4], mono.raster.data[8]]).toEqual([255, 0, 255]);
    const r565 = rawPixels(Uint8Array.from([0x00, 0xf8]), { width: 1, height: 1, layout: 'rgb565', offset: 0, littleEndian: true, flip: false });
    expect([...r565.raster.data]).toEqual([255, 0, 0, 255]);
    const f = rawPixels(new Uint8Array(new Float32Array([1]).buffer), { width: 1, height: 1, layout: 'gray32f', offset: 0, littleEndian: true, flip: false });
    expect(f.raster.data[0]).toBe(255);
    const short = rawPixels(Uint8Array.from([1, 2, 3]), { width: 2, height: 1, layout: 'rgb', offset: 0, littleEndian: true, flip: false });
    expect(short.truncated).toBe(true);
    expect(short.raster.data[7]).toBe(0);
    expect(short.bytesNeeded).toBe(6);
  });
  it('guesses sizes that divide the pixel count, common screen sizes first', () => {
    expect(guessSizes(640 * 480 * 3, 24)[0]).toEqual([640, 480]);
    expect(guessSizes(256 * 256 * 4, 32)[0]).toEqual([256, 256]);
    for (const [w, h] of guessSizes(1200, 8)) expect(w * h).toBe(1200);
    expect(guessSizes(7, 24)).toEqual([[2, 1]]);
    expect(guessSizes(0, 24)).toEqual([]);
  });
});
