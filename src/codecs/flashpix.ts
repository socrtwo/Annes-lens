/**
 * FlashPix (.fpx; Kodak, Microsoft, HP and Live Picture, 1996): a compound file holding the picture at several
 * resolutions in 64 × 64 tiles. The full resolution is decoded: uncompressed, single-color and JPEG tiles
 * (the shared JPEG tables from the Image Contents properties, the internal YCbCr conversion as the tile says),
 * in monochrome, NIF RGB or Photo YCC (Kodak's conversion), with an opacity channel when there is one.
 * JPEG tiles are decoded by pdf.js's JPEG decoder.
 */
import { Cfb, isCfb, propertySet } from './cfb';
import { makeRaster, type DecodeResult } from './raster';
import { photoYcc } from './retro';

const le32 = (u: Uint8Array, o: number) => (u[o] | (u[o + 1] << 8) | (u[o + 2] << 16) | (u[o + 3] << 24)) >>> 0;
const STORE = 'Data Object Store 000001';

export function isFlashPix(u8: Uint8Array): boolean {
  if (!isCfb(u8)) return false;
  try { return new Cfb(u8).has(`${STORE}/\x05Image Contents`); } catch { return false; }
}

/** `jpeg` is pdf.js's image-decoders module (its JpegImage), needed only for JPEG tiles. */
export function decodeFlashPix(u8: Uint8Array, jpeg?: any): DecodeResult {
  const cfb = new Cfb(u8), warnings: string[] = [];
  const contents = cfb.stream(`${STORE}/\x05Image Contents`);
  if (!contents) throw new Error('This compound file holds no FlashPix picture');
  const props = propertySet(contents);
  const nres: number = props.get(0x01000000) ?? 1, W: number = props.get(0x01000002), H: number = props.get(0x01000003);
  // The full resolution is the last one (Resolution 0000 is the smallest).
  let res = nres - 1;
  while (res > 0 && !cfb.has(`${STORE}/Resolution ${String(res).padStart(4, '0')}/Subimage 0000 Header`)) res--;
  const dir = `${STORE}/Resolution ${String(res).padStart(4, '0')}`;
  const header = cfb.stream(`${dir}/Subimage 0000 Header`), data = cfb.stream(`${dir}/Subimage 0000 Data`);
  if (!header || !data) throw new Error('The FlashPix picture data is missing');
  const w = le32(header, 32), h = le32(header, 36), tiles = le32(header, 40), tw = le32(header, 44), th = le32(header, 48), chans = le32(header, 52);
  const tableAt = 28 + le32(header, 56), entryLen = le32(header, 60) || 16;
  if (!(w > 0 && h > 0) || w * h > 200e6 || !(tw > 0 && th > 0) || chans < 1 || chans > 4) throw new Error(`This FlashPix picture has an impossible size (${w} × ${h}, ${chans} channels)`);
  // Color: the channels' color space (1 monochrome, 2 Photo YCC, 3 NIF RGB) and which one is opacity (0x7FFE).
  const blob: Uint8Array | undefined = props.get(0x02000002 | (res << 16));
  const colors: number[] = [];
  if (blob && blob.length >= 8) for (let i = 0; i < le32(blob, 4) && 8 + i * 4 + 4 <= blob.length; i++) colors.push(le32(blob, 8 + i * 4) & 0x7fffffff);
  const space = colors.length ? colors[0] >>> 16 & 0x7fff : chans >= 3 ? 3 : 1;
  const opacityAt = colors.findIndex((c) => (c & 0xffff) === 0x7ffe);
  const premultiplied = colors.some((c) => c & 0x8000);
  const cols = Math.ceil(w / tw), pix = new Uint8Array(cols * tw * Math.ceil(h / th) * th * chans);
  const stride = cols * tw * chans;
  let jpegTiles = 0, failed = 0;
  for (let t = 0; t < tiles; t++) {
    const e = tableAt + t * entryLen;
    if (e + 16 > header.length) break;
    const off = le32(header, e) + 28, size = le32(header, e + 4), comp = le32(header, e + 8), sub = header.subarray(e + 12, e + 16);
    const tx = (t % cols) * tw, ty = Math.floor(t / cols) * th;
    const put = (src: (x: number, y: number, c: number) => number) => {
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) for (let c = 0; c < chans; c++) pix[(ty + y) * stride + (tx + x) * chans + c] = src(x, y, c);
    };
    if (comp === 1) { put((_x, _y, c) => sub[c]); continue; }
    if (comp === 0) { put((x, y, c) => data[off + (y * tw + x) * chans + c] ?? 0); continue; }
    if (comp === 2) {
      if (!jpeg) throw new Error('The JPEG decoder for FlashPix tiles is not loaded');
      jpegTiles++;
      try {
        const conv = sub[2], table = sub[3];
        let bytes = data.subarray(off, off + size);
        if (table) {
          const tables: Uint8Array | undefined = props.get(0x03000001 | (table << 16));
          if (tables) { // the shared tables (an abbreviated stream without EOI), then the tile without its SOI
            const head = tables[tables.length - 2] === 0xff && tables[tables.length - 1] === 0xd9 ? tables.subarray(0, tables.length - 2) : tables;
            const body = bytes[0] === 0xff && bytes[1] === 0xd8 ? bytes.subarray(2) : bytes;
            const joined = new Uint8Array(head.length + body.length); joined.set(head); joined.set(body, head.length); bytes = joined;
          } else warnings.push(`JPEG table set ${table} is missing`);
        }
        const img = new jpeg.JpegImage({ colorTransform: conv ? 1 : 0 });
        img.parse(bytes);
        const jw = img.width, jh = img.height, out: Uint8ClampedArray = img.getData({ width: jw, height: jh, forceRGB: false });
        const n = out.length / (jw * jh);
        put((x, y, c) => (x < jw && y < jh ? out[(y * jw + x) * n + Math.min(c, n - 1)] : 0));
      } catch (err: any) { failed++; if (failed === 1) warnings.push(`A JPEG tile could not be decoded (${err?.message || err})`); }
      continue;
    }
    if (failed++ === 0) warnings.push(`Tiles with compression ${comp} are not supported`);
  }
  if (failed > 1) warnings.push(`${failed} tiles could not be decoded`);
  const r = makeRaster(w, h), d = r.data;
  const colorChans = opacityAt >= 0 ? chans - 1 : chans;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * stride + x * chans, o = (y * w + x) * 4;
    const v = (k: number) => pix[p + (opacityAt >= 0 && k >= opacityAt ? k + 1 : k)];
    const a = opacityAt >= 0 ? pix[p + opacityAt] : 255;
    let R: number, G: number, B: number;
    if (colorChans === 1) R = G = B = v(0);
    else if (space === 2) [R, G, B] = photoYcc(v(0), v(1), v(2));
    else { R = v(0); G = v(1); B = v(2); }
    if (premultiplied && opacityAt >= 0 && a > 0 && a < 255) { R = Math.min(255, Math.round(R * 255 / a)); G = Math.min(255, Math.round(G * 255 / a)); B = Math.min(255, Math.round(B * 255 / a)); }
    d[o] = R; d[o + 1] = G; d[o + 2] = B; d[o + 3] = a;
  }
  const spaceName = space === 2 ? 'Photo YCC' : colorChans === 1 ? 'monochrome' : 'NIF RGB';
  const notes = [`FlashPix, ${spaceName}${opacityAt >= 0 ? ' with opacity' : ''}, ${nres} resolution${nres === 1 ? '' : 's'} (the full one shown), ${tiles} tile${tiles === 1 ? '' : 's'}${jpegTiles ? `, ${jpegTiles} JPEG-compressed` : ''}`];
  return { pages: [{ width: w, height: h, frames: [{ raster: r, delay: 0 }], loops: 0, bitDepth: chans * 8, hasAlpha: opacityAt >= 0, notes }], info: { resolutions: String(nres) }, warnings };
}
