/**
 * FlashPix (.fpx; Kodak, Microsoft, HP and Live Picture, 1996): a compound file holding the picture at several
 * resolutions in 64 × 64 tiles. The full resolution is decoded: uncompressed, single-color and JPEG tiles
 * (the shared JPEG tables from the Image Contents properties, the internal YCbCr conversion as the tile says),
 * in monochrome, NIF RGB or Photo YCC (Kodak's conversion), with an opacity channel when there is one.
 * JPEG tiles are decoded by pdf.js's JPEG decoder.
 * The file's viewing transform (Section 7 of the FlashPix specification) is honored: when the file carries a cached
 * result image, that is shown as it is; otherwise the source image is shown through the transform: the rectangle of
 * interest (the rest transparent), the spatial orientation (an affine map from the displayed picture to the source,
 * sampled bilinearly, pixel-exact for turns and flips), the result aspect ratio, the colortwist in normalized
 * PhotoYCC with the contrast curve, and filtering as an approximate sharpening or blur.
 */
import { Cfb, isCfb, propertySet } from './cfb';
import { makeRaster, type DecodeResult, type Raster } from './raster';
import { photoYcc } from './retro';

const le32 = (u: Uint8Array, o: number) => (u[o] | (u[o + 1] << 8) | (u[o + 2] << 16) | (u[o + 3] << 24)) >>> 0;
const STORE = 'Data Object Store 000001';

export function isFlashPix(u8: Uint8Array): boolean {
  if (!isCfb(u8)) return false;
  try { return new Cfb(u8).has(`${STORE}/\x05Image Contents`); } catch { return false; }
}

interface Store { r: Raster; w: number; h: number; chans: number; spaceName: string; opacity: boolean; nres: number; tiles: number; jpegTiles: number }
const pad6 = (n: number) => String(n).padStart(6, '0');

/** One FlashPix image object (a "Data Object Store") at its full resolution. */
function decodeStore(cfb: Cfb, store: string, jpeg: any, warnings: string[]): Store {
  const contents = cfb.stream(`${store}/\x05Image Contents`);
  if (!contents) throw new Error('This compound file holds no FlashPix picture');
  const props = propertySet(contents);
  const nres: number = props.get(0x01000000) ?? 1;
  // The full resolution is the last one (Resolution 0000 is the smallest).
  let res = nres - 1;
  while (res > 0 && !cfb.has(`${store}/Resolution ${String(res).padStart(4, '0')}/Subimage 0000 Header`)) res--;
  const dir = `${store}/Resolution ${String(res).padStart(4, '0')}`;
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
  return { r, w, h, chans, spaceName: space === 2 ? 'Photo YCC' : colorChans === 1 ? 'monochrome' : 'NIF RGB', opacity: opacityAt >= 0, nres, tiles, jpegTiles };
}

// The viewing transform (Section 7) ------------------------------------------------------------------
export interface View { roi: number[] | null; aspect: number | null; affine: number[] | null; filtering: number; twist: number[] | null; contrast: number }
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const same = (a: number[] | null, b: number[]) => !a || (a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6));
/** The transform property set's view parameters; null when there is none. */
export function readView(cfb: Cfb, index: number): View | null {
  const s = cfb.stream(`\x05Transform ${pad6(index)}`);
  if (!s) return null;
  const t = propertySet(s);
  const vec = (id: number, n: number): number[] | null => { const v = t.get(id); return Array.isArray(v) && v.length >= n && v.slice(0, n).every((x) => typeof x === 'number' && isFinite(x)) ? v.slice(0, n) : null; };
  const num = (id: number, dflt: number): number => { const v = t.get(id); return typeof v === 'number' && isFinite(v) ? v : dflt; };
  return { roi: vec(0x10000001, 4), aspect: typeof t.get(0x10000000) === 'number' ? num(0x10000000, 0) : null, affine: vec(0x10000003, 16), filtering: num(0x10000002, 0), twist: vec(0x10000004, 16), contrast: num(0x10000005, 1) };
}

/** Normalized PhotoYCC from nonlinear RGB (equation 5.5) through the colortwist, back to RGB, then the contrast curve (7.6). */
function tone(d: Uint8ClampedArray, twist: number[] | null, K: number): void {
  const m = twist || IDENTITY, p = 0.43;
  const curve = (v: number) => { const j = v - 0.5; return (j < 0 ? -p * Math.pow(-j / p, K) : p * Math.pow(j / p, K)) + 0.5; };
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    if (twist) {
      const y = 0.299 * r + 0.587 * g + 0.114 * b, c1 = -0.299 * r - 0.587 * g + 0.886 * b, c2 = 0.701 * r - 0.587 * g - 0.114 * b;
      const Y = m[0] * y + m[1] * c1 + m[2] * c2 + m[3], C1 = m[4] * y + m[5] * c1 + m[6] * c2 + m[7], C2 = m[8] * y + m[9] * c1 + m[10] * c2 + m[11];
      r = Y + C2; b = Y + C1; g = (Y - 0.299 * r - 0.114 * b) / 0.587;
    }
    if (K !== 1) { r = curve(r); g = curve(g); b = curve(b); }
    d[i] = Math.round(r * 255); d[i + 1] = Math.round(g * 255); d[i + 2] = Math.round(b * 255);
  }
}

/** An approximate reading of the filtering parameter: sharpening (positive) or blurring (negative) by a 3 × 3 kernel. */
function filtering(r: Raster, f: number): Raster {
  const amount = Math.max(-20, Math.min(20, f)) / 20, { width: w, height: h, data: s } = r, out = makeRaster(w, h), d = out.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy)); sum += s[(yy * w + xx) * 4 + c]; }
      const blur = sum / 9, v = s[o + c];
      d[o + c] = Math.round(Math.max(0, Math.min(255, amount >= 0 ? v + amount * (v - blur) : v + (-amount) * (blur - v))));
    }
    d[o + 3] = s[o + 3];
  }
  return out;
}

/** The source picture seen through the view: the parts applied are named in `applied`. */
export function applyView(src: Raster, view: View): { r: Raster; applied: string[] } {
  const applied: string[] = [];
  const { width: w, height: h } = src, R = w / h;
  const roi = view.roi && !same(view.roi, [0, 0, R, 1]) ? view.roi : null;
  const aspect = view.aspect && Math.abs(view.aspect - R) > 1e-6 ? view.aspect : R;
  const affine = view.affine && !same(view.affine, IDENTITY) ? view.affine : null;
  let r = src;
  if (view.filtering) { r = filtering(r, view.filtering); applied.push(`${view.filtering > 0 ? 'sharpening' : 'blurring'} ${Math.abs(view.filtering).toFixed(1)} (approximate)`); }
  if (roi || affine || aspect !== R) {
    const a = affine || IDENTITY;
    // The output grid keeps the source's pixel density along each displayed axis.
    const sx = Math.hypot(a[0], a[4]), sy = Math.hypot(a[1], a[5]);
    let W = Math.round(aspect * h * (sx || 1)), H = Math.round(h * (sy || 1));
    const cap = Math.sqrt(50e6 / Math.max(1, W * H)); if (cap < 1) { W = Math.floor(W * cap); H = Math.floor(H * cap); }
    W = Math.max(1, W); H = Math.max(1, H);
    const out = makeRaster(W, H), d = out.data, s = r.data;
    const [x0, y0, rw, rh] = roi || [0, 0, R, 1];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const xd = (i + 0.5) * aspect / W, yd = (j + 0.5) / H;
      const x = a[0] * xd + a[1] * yd + a[3], y = a[4] * xd + a[5] * yd + a[7];
      const o = (j * W + i) * 4;
      if (!(x >= 0 && x < R && y >= 0 && y < 1) || !(x >= x0 && x < x0 + rw && y >= y0 && y < y0 + rh)) { d[o + 3] = 0; continue; }
      // Bilinear sampling at the source pixel position (pixel centers at (k + 0.5) / h).
      const px = Math.min(w - 1, Math.max(0, x * h - 0.5)), py = Math.min(h - 1, Math.max(0, y * h - 0.5));
      const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy, ix1 = Math.min(w - 1, ix + 1), iy1 = Math.min(h - 1, iy + 1);
      for (let c = 0; c < 4; c++) {
        const v = s[(iy * w + ix) * 4 + c] * (1 - fx) * (1 - fy) + s[(iy * w + ix1) * 4 + c] * fx * (1 - fy) + s[(iy1 * w + ix) * 4 + c] * (1 - fx) * fy + s[(iy1 * w + ix1) * 4 + c] * fx * fy;
        d[o + c] = Math.round(v);
      }
    }
    r = out;
    if (roi) applied.push('rectangle of interest');
    if (affine) { const turn = Math.abs(a[0]) < 1e-6 && Math.abs(a[5]) < 1e-6, flip = !turn && (a[0] < 0 || a[5] < 0); applied.push(turn ? 'a quarter turn' : flip ? 'a flip' : 'spatial orientation (rotation, scale or shear)'); }
    if (aspect !== R) applied.push(`result aspect ratio ${aspect.toFixed(3)}`);
  }
  if ((view.twist && !same(view.twist, IDENTITY)) || view.contrast !== 1) {
    if (r === src) { r = makeRaster(w, h); r.data.set(src.data); }
    tone(r.data, view.twist && !same(view.twist, IDENTITY) ? view.twist : null, view.contrast);
    if (view.twist && !same(view.twist, IDENTITY)) applied.push('colortwist');
    if (view.contrast !== 1) applied.push(`contrast ${view.contrast.toFixed(2)}`);
  }
  return { r, applied };
}

/** `jpeg` is pdf.js's image-decoders module (its JpegImage), needed only for JPEG tiles. */
export function decodeFlashPix(u8: Uint8Array, jpeg?: any): DecodeResult {
  const cfb = new Cfb(u8), warnings: string[] = [];
  // The image view: which image object is the output, and whether a transform leads from the source to it.
  const globalInfo = cfb.stream('\x05Global Info'), global = globalInfo ? propertySet(globalInfo) : new Map<number, any>();
  const visible: number = (Array.isArray(global.get(0x00010100)) && global.get(0x00010100)[0]) || 1;
  const descStream = cfb.stream(`\x05Data Object ${pad6(visible)}`), desc = descStream ? propertySet(descStream) : new Map<number, any>();
  const cached = ((desc.get(0x00010100) ?? 1) & 0xffff) === 1 && cfb.has(`Data Object Store ${pad6(visible)}/\x05Image Contents`);
  const transformIndex: number = desc.get(0x00010101) || 1;
  let store = `Data Object Store ${pad6(cached ? visible : 1)}`;
  if (!cfb.has(`${store}/\x05Image Contents`)) store = STORE;
  const st = decodeStore(cfb, store, jpeg, warnings);
  let r = st.r, viewNote = '', hasAlpha = st.opacity;
  const view = visible !== 1 || !cached ? readView(cfb, transformIndex) : null;
  if (cached && visible !== 1) viewNote = 'the cached result of the file\'s viewing transform, as saved';
  else if (view) {
    const v = applyView(st.r, view);
    if (v.applied.length) { r = v.r; viewNote = `seen through the file's viewing transform: ${v.applied.join(', ')}`; if (view.roi || view.affine || (view.aspect !== null && Math.abs(view.aspect - st.w / st.h) > 1e-6)) hasAlpha = true; }
  }
  const notes = [`FlashPix, ${st.spaceName}${st.opacity ? ' with opacity' : ''}, ${st.nres} resolution${st.nres === 1 ? '' : 's'} (the full one shown), ${st.tiles} tile${st.tiles === 1 ? '' : 's'}${st.jpegTiles ? `, ${st.jpegTiles} JPEG-compressed` : ''}`];
  if (viewNote) notes.push(viewNote);
  return { pages: [{ width: r.width, height: r.height, frames: [{ raster: r, delay: 0 }], loops: 0, bitDepth: st.chans * 8, hasAlpha, notes }], info: { resolutions: String(st.nres), ...(viewNote ? { view: viewNote } : {}) }, warnings };
}
