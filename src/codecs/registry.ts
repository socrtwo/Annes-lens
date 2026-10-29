/**
 * Content sniffing and codec selection. A picture is recognized by its bytes, never by its name; the
 * decoder is the platform (createImageBitmap, ImageDecoder) for the formats it handles and the app's own
 * readers for GIF (every frame), TIFF, BMP, ICO and CUR, TGA, Netpbm, QOI, PCX, XPM, XBM, WBMP, PSD, ICNS,
 * DDS and Radiance HDR; camera RAW files show their largest embedded JPEG preview. Decoding happens off the main thread where the
 * platform allows (createImageBitmap) and is tolerant: a damaged GIF or TIFF shows what was readable.
 */
import { Picture, transformPage, orientationOps, type Page, type Frame } from '../picture/model';
import type { Entry } from '../picture/folder';
import { decodeGif, isGif } from './gif';
import { decodeTiff, isTiff } from './tiff';
import { decodeBmp, isBmp } from './bmp';
import { isIco, readIco, decodeIcoDibs } from './ico';
import { jpegInfo, pngInfo, webpInfo, type ContainerInfo } from './info';
import { decodeTga, isTga } from './tga';
import { decodePnm, isPnm } from './pnm';
import { decodeQoi, isQoi } from './qoi';
import { decodePcx, isPcx, isDcx } from './pcx';
import { decodeXpm, decodeXbm, isXpm, isXbm } from './xpm';
import { decodeWbmp, isWbmp } from './wbmp';
import { decodePsd, isPsd } from './psd';
import { isIcns, readIcns, decodeIcnsClassic } from './icns';
import { decodeDds, isDds } from './dds';
import { decodeHdr, isHdr } from './hdr';
import { identifyRaw, findEmbeddedJpegs, RAW_EXTENSIONS } from './rawpreview';
import { readExif } from '../meta/exif';
import type { DecodedPage, Raster } from './raster';

export interface FormatInfo {
  id: string;
  label: string;
  mime: string;
  extensions: string[];
  /** How Anne's Lens decodes it: its own reader, the platform's codec, or both. */
  decoder: 'own' | 'platform' | 'platform+own';
  /** Writable by Save As (through the canvas encoders or the app's own writers). */
  save: boolean;
  notes?: string;
}

export const FORMATS: FormatInfo[] = [
  { id: 'jpeg', label: 'JPEG', mime: 'image/jpeg', extensions: ['jpg', 'jpeg', 'jpe', 'jfif'], decoder: 'platform', save: true, notes: 'baseline and progressive; CMYK and 12-bit where the platform decodes them' },
  { id: 'png', label: 'PNG', mime: 'image/png', extensions: ['png'], decoder: 'platform', save: true, notes: 'APNG animation where the platform has ImageDecoder' },
  { id: 'apng', label: 'Animated PNG', mime: 'image/apng', extensions: ['apng', 'png'], decoder: 'platform', save: false },
  { id: 'gif', label: 'GIF', mime: 'image/gif', extensions: ['gif'], decoder: 'own', save: false, notes: 'every frame, delays, loop count, comments' },
  { id: 'webp', label: 'WebP', mime: 'image/webp', extensions: ['webp'], decoder: 'platform', save: true, notes: 'animation where the platform has ImageDecoder' },
  { id: 'avif', label: 'AVIF', mime: 'image/avif', extensions: ['avif'], decoder: 'platform', save: false, notes: 'where the platform decodes it' },
  { id: 'heic', label: 'HEIC / HEIF', mime: 'image/heic', extensions: ['heic', 'heif', 'hif'], decoder: 'platform', save: false, notes: 'where the platform decodes it (iOS, macOS, recent Android)' },
  { id: 'jxl', label: 'JPEG XL', mime: 'image/jxl', extensions: ['jxl'], decoder: 'platform', save: false, notes: 'where the platform decodes it' },
  { id: 'bmp', label: 'Windows Bitmap', mime: 'image/bmp', extensions: ['bmp', 'dib', 'rle'], decoder: 'platform+own', save: true, notes: '1–32 bits, RLE, bit fields, OS/2 headers' },
  { id: 'ico', label: 'Windows Icon', mime: 'image/x-icon', extensions: ['ico'], decoder: 'own', save: false, notes: 'every size as a page' },
  { id: 'cur', label: 'Windows Cursor', mime: 'image/x-icon', extensions: ['cur'], decoder: 'own', save: false, notes: 'every size as a page, with the hotspot' },
  { id: 'tiff', label: 'TIFF', mime: 'image/tiff', extensions: ['tif', 'tiff'], decoder: 'own', save: false, notes: 'baseline: uncompressed, PackBits, LZW, Deflate; strips and tiles; 1–16 bits; multipage; BigTIFF' },
  { id: 'svg', label: 'SVG', mime: 'image/svg+xml', extensions: ['svg', 'svgz'], decoder: 'platform', save: false, notes: 'rendered by the platform with scripts disabled' },
  { id: 'tga', label: 'Truevision TGA', mime: 'image/x-tga', extensions: ['tga', 'tpic', 'icb', 'vda', 'vst'], decoder: 'own', save: true, notes: 'color-mapped, true color and grayscale; RLE; TGA 2.0 extension area' },
  { id: 'pnm', label: 'Netpbm', mime: 'image/x-portable-anymap', extensions: ['pnm', 'ppm', 'pgm', 'pbm', 'pam', 'pfm'], decoder: 'own', save: true, notes: 'PBM, PGM, PPM (plain and raw), PAM, PFM; 16-bit; several pictures per file as pages' },
  { id: 'qoi', label: 'QOI', mime: 'image/qoi', extensions: ['qoi'], decoder: 'own', save: true },
  { id: 'pcx', label: 'ZSoft PCX', mime: 'image/x-pcx', extensions: ['pcx', 'dcx'], decoder: 'own', save: false, notes: '1–24 bits, EGA and VGA palettes; DCX multipage' },
  { id: 'xpm', label: 'X PixMap', mime: 'image/x-xpixmap', extensions: ['xpm'], decoder: 'own', save: false, notes: 'XPM 2 and 3; X11 color names' },
  { id: 'xbm', label: 'X BitMap', mime: 'image/x-xbitmap', extensions: ['xbm'], decoder: 'own', save: false },
  { id: 'wbmp', label: 'Wireless Bitmap', mime: 'image/vnd.wap.wbmp', extensions: ['wbmp'], decoder: 'own', save: true, notes: 'type 0, 1 bit' },
  { id: 'psd', label: 'Photoshop', mime: 'image/vnd.adobe.photoshop', extensions: ['psd', 'psb'], decoder: 'own', save: false, notes: 'the merged composite; bitmap, grayscale, indexed, RGB, CMYK, Lab; 8/16/32 bits; layer names listed' },
  { id: 'icns', label: 'Apple Icon', mime: 'image/icns', extensions: ['icns'], decoder: 'platform+own', save: false, notes: 'every size as a page; PNG elements by the platform, classic packed and 1-bit elements by the app' },
  { id: 'dds', label: 'DirectDraw Surface', mime: 'image/vnd-ms.dds', extensions: ['dds'], decoder: 'own', save: false, notes: 'uncompressed and BC1–BC5 (DXT1/3/5); cube faces as pages' },
  { id: 'hdr', label: 'Radiance HDR', mime: 'image/vnd.radiance', extensions: ['hdr', 'pic', 'rgbe'], decoder: 'own', save: false, notes: 'RGBE, tone-mapped for display' },
  { id: 'raw', label: 'Camera RAW', mime: 'image/x-raw', extensions: RAW_EXTENSIONS, decoder: 'platform+own', save: false, notes: 'the largest embedded JPEG preview, with the file\'s EXIF; development needs the RAW module' },
];

export function formatById(id: string): FormatInfo | undefined { return FORMATS.find((f) => f.id === id); }
export function formatFromName(name: string): FormatInfo | undefined { const ext = (name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase(); return FORMATS.find((f) => f.extensions.includes(ext)); }

export const OPEN_ACCEPT = 'image/*,' + FORMATS.flatMap((f) => f.extensions).map((e) => '.' + e).join(',');
export const OPEN_MIMES = ['image/*', ...new Set(FORMATS.map((f) => f.mime)), 'application/octet-stream'];

const at = (u8: Uint8Array, o: number, s: string) => { for (let i = 0; i < s.length; i++) if (u8[o + i] !== s.charCodeAt(i)) return false; return true; };

/** The format of `u8` from its first bytes (the name only settles formats without a magic number), or null. */
export function sniff(u8: Uint8Array, name = ''): FormatInfo | null {
  if (u8.length < 4) return null;
  if (isPsd(u8)) return formatById('psd')!;
  if (isQoi(u8)) return formatById('qoi')!;
  if (isIcns(u8)) return formatById('icns')!;
  if (isDds(u8)) return formatById('dds')!;
  if (isHdr(u8)) return formatById('hdr')!;
  if (isPnm(u8)) return formatById('pnm')!;
  if (isDcx(u8)) return formatById('pcx')!;
  if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return formatById('jpeg')!;
  if (at(u8, 0, '\x89PNG\r\n\x1a\n')) { return pngInfo(u8).animated ? formatById('apng')! : formatById('png')!; }
  if (isGif(u8)) return formatById('gif')!;
  if (at(u8, 0, 'RIFF') && at(u8, 8, 'WEBP')) return formatById('webp')!;
  if (u8.length >= 12 && at(u8, 4, 'ftyp')) {
    const brand = String.fromCharCode(...u8.subarray(8, 12));
    const compat = String.fromCharCode(...u8.subarray(16, Math.min(u8.length, 64)));
    if (/avi[fs]/.test(brand) || /avi[fs]/.test(compat)) return formatById('avif')!;
    if (/hei[cfxms]|mif1|msf1/.test(brand) || /heic|mif1/.test(compat)) return formatById('heic')!;
  }
  if ((u8[0] === 0xff && u8[1] === 0x0a) || at(u8, 0, '\0\0\0\x0cJXL ')) return formatById('jxl')!;
  if (isBmp(u8)) return formatById('bmp')!;
  if (isIco(u8)) return (u8[2] | (u8[3] << 8)) === 2 ? formatById('cur')! : formatById('ico')!;
  if (isTiff(u8)) return identifyRaw(u8, name) ? formatById('raw')! : formatById('tiff')!;
  if (identifyRaw(u8, name)) return formatById('raw')!;
  if (u8[0] === 0x1f && u8[1] === 0x8b) return formatById('svg')!; // svgz (checked again by the platform)
  if (isPcx(u8)) return formatById('pcx')!;
  const head = new TextDecoder('utf-8', { fatal: false }).decode(u8.subarray(0, Math.min(u8.length, 2048)));
  if (/<svg[\s>]/i.test(head) && !/<script/i.test(head.slice(0, 200))) return formatById('svg')!;
  if (isXpm(u8)) return formatById('xpm')!;
  if (isXbm(u8)) return formatById('xbm')!;
  // Formats without a magic number come last: a plausible header, or the name.
  if (isTga(u8, name)) return formatById('tga')!;
  if (isWbmp(u8, name)) return formatById('wbmp')!;
  return null;
}

/** Decoding options the app sets from its preferences. */
export const decodeOptions = {
  /** Turn pictures upright by their EXIF Orientation tag when decoding (Options ▸ Auto-rotate by EXIF orientation). */
  autoRotate: true,
};

/** Decodes bytes into a Picture. Throws with a readable message when nothing can be shown. */
export async function decodePicture(u8: Uint8Array, entry: Entry): Promise<Picture> {
  const fmt = sniff(u8, entry.name) || formatFromName(entry.name);
  if (!fmt) throw new Error('Not a picture format Anne\'s Lens can open');
  const exif = safe(() => readExif(u8));
  let decoded: { pages: Page[]; info: Record<string, string>; warnings: string[]; decoder: string };
  if (fmt.id === 'gif') decoded = fromOwn(decodeGif(u8), 'gif');
  else if (fmt.id === 'tiff') decoded = fromOwn(await decodeTiff(u8), 'tiff');
  else if (fmt.id === 'ico' || fmt.id === 'cur') decoded = await decodeIcoFile(u8);
  else if (fmt.id === 'tga') decoded = fromOwn(decodeTga(u8), 'tga');
  else if (fmt.id === 'pnm') decoded = fromOwn(decodePnm(u8), 'pnm');
  else if (fmt.id === 'qoi') decoded = fromOwn(decodeQoi(u8), 'qoi');
  else if (fmt.id === 'pcx') decoded = fromOwn(decodePcx(u8), 'pcx');
  else if (fmt.id === 'xpm') decoded = fromOwn(decodeXpm(u8), 'xpm');
  else if (fmt.id === 'xbm') decoded = fromOwn(decodeXbm(u8), 'xbm');
  else if (fmt.id === 'wbmp') decoded = fromOwn(decodeWbmp(u8), 'wbmp');
  else if (fmt.id === 'psd') decoded = fromOwn(decodePsd(u8), 'psd');
  else if (fmt.id === 'dds') decoded = fromOwn(decodeDds(u8), 'dds');
  else if (fmt.id === 'hdr') decoded = fromOwn(decodeHdr(u8), 'hdr');
  else if (fmt.id === 'icns') decoded = await decodeIcnsFile(u8);
  else if (fmt.id === 'raw') decoded = await decodeRawPreview(u8, entry.name);
  else if (fmt.id === 'bmp') {
    try { decoded = await fromPlatform(u8, fmt, null); } catch { decoded = fromOwn(decodeBmp(u8), 'bmp'); }
  } else {
    const info: ContainerInfo | null = fmt.id === 'jpeg' ? safe(() => jpegInfo(u8)) : fmt.id === 'png' || fmt.id === 'apng' ? safe(() => pngInfo(u8)) : fmt.id === 'webp' ? safe(() => webpInfo(u8)) : null;
    decoded = await fromPlatform(u8, fmt, info);
  }
  const pic = new Picture(entry, u8, fmt, decoded.pages, exif, decoded.info, decoded.warnings, decoded.decoder);
  if (exif?.dpi) for (const p of pic.pages) if (!p.dpi) p.dpi = exif.dpi;
  // EXIF orientation: the platform decodes with imageOrientation 'none', so the pixels are as stored.
  const ops = decodeOptions.autoRotate && fmt.id !== 'tiff' && fmt.id !== 'raw' ? orientationOps(pic.orientation) : [];
  if (ops.length && typeof document !== 'undefined') { pic.pages = pic.pages.map((pg) => ops.reduce((acc, op) => transformPage(acc, op), pg)); pic.orientationApplied = true; }
  return pic;
}

function safe<T>(fn: () => T): T | null { try { return fn(); } catch { return null; } }

function rasterToFrame(r: Raster, delay: number): Frame {
  const c = document.createElement('canvas');
  c.width = r.width; c.height = r.height;
  c.getContext('2d')!.putImageData(new ImageData(r.data, r.width, r.height), 0, 0);
  return { image: c, width: r.width, height: r.height, delay };
}

function pageFromDecoded(d: DecodedPage): Page {
  return { width: d.width, height: d.height, frames: d.frames.map((f) => rasterToFrame(f.raster, f.delay)), loops: d.loops, bitDepth: d.bitDepth, paletteSize: d.paletteSize, hasAlpha: d.hasAlpha, dpi: d.dpi, notes: d.notes };
}

function fromOwn(r: { pages: DecodedPage[]; info: Record<string, string>; warnings: string[] }, decoder: string) {
  return { pages: r.pages.map(pageFromDecoded), info: r.info, warnings: r.warnings, decoder };
}

async function decodeIcoFile(u8: Uint8Array) {
  const { entries, cursor } = readIco(u8);
  const { pages, warnings } = decodeIcoDibs(entries);
  const out: Page[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (pages[i]) { out.push(pageFromDecoded(pages[i]!)); continue; }
    if (!e.png) continue;
    try {
      const bmp = await createImageBitmap(new Blob([e.bytes as BlobPart], { type: 'image/png' }));
      out.push({ width: bmp.width, height: bmp.height, frames: [{ image: bmp, width: bmp.width, height: bmp.height, delay: 0 }], loops: 0, bitDepth: 32, hasAlpha: true, notes: ['PNG inside the icon'] });
    } catch (err: any) { warnings.push(`Icon ${i + 1}: ${err?.message || err}`); }
  }
  if (!out.length) throw new Error(warnings[0] || 'No readable icon');
  return { pages: out, info: { entries: String(entries.length), kind: cursor ? 'cursor' : 'icon' }, warnings, decoder: 'ico' };
}

async function decodeIcnsFile(u8: Uint8Array) {
  const { elements, warnings } = readIcns(u8);
  const classic = decodeIcnsClassic(elements);
  warnings.push(...classic.warnings);
  const out: { page: Page; size: number }[] = classic.pages.map((p) => ({ page: pageFromDecoded(p), size: p.width }));
  for (const e of elements) {
    if (!e.png && !e.jp2) continue;
    try {
      const bmp = await createImageBitmap(new Blob([e.bytes as BlobPart], { type: e.png ? 'image/png' : 'image/jp2' }));
      out.push({ page: { width: bmp.width, height: bmp.height, frames: [{ image: bmp, width: bmp.width, height: bmp.height, delay: 0 }], loops: 0, bitDepth: 32, hasAlpha: true, notes: [`${e.type}: ${e.png ? 'PNG' : 'JPEG 2000'} element${e.size && e.size !== bmp.width ? ` (${e.size} pt, ${Math.round(bmp.width / e.size)}×)` : ''}`] }, size: bmp.width });
    } catch (err: any) { warnings.push(`${e.type}: ${e.jp2 ? 'JPEG 2000 elements need the platform decoder' : err?.message || err}`); }
  }
  if (!out.length) throw new Error(warnings[0] || 'No readable icon element');
  out.sort((a, b) => b.size - a.size);
  return { pages: out.map((x) => x.page), info: { elements: elements.map((e) => e.type).join(', ') }, warnings, decoder: 'icns' };
}

async function decodeRawPreview(u8: Uint8Array, name: string) {
  const id = identifyRaw(u8, name) || { family: 'RAW', make: 'unknown camera' };
  const previews = findEmbeddedJpegs(u8);
  const info: Record<string, string> = { 'RAW family': `${id.family} (${id.make})`, previews: previews.length ? previews.map((p) => `${p.width}×${p.height}`).join(', ') : 'none' };
  if (!previews.length) throw new Error(`${id.family} file from ${id.make}: no embedded JPEG preview, and RAW development needs the RAW module`);
  const warnings: string[] = [];
  for (const pv of previews) {
    try {
      const bytes = u8.subarray(pv.offset, pv.offset + pv.length);
      const r = await fromPlatform(bytes, formatById('jpeg')!, safe(() => jpegInfo(bytes)));
      r.pages[0].notes.unshift(`embedded ${pv.width}×${pv.height} JPEG preview of a ${id.family} file`);
      return { pages: r.pages, info: { ...info, ...r.info }, warnings: [...warnings, ...r.warnings], decoder: 'raw preview' };
    } catch (e: any) { warnings.push(`Preview ${pv.width}×${pv.height}: ${e?.message || e}`); }
  }
  throw new Error(warnings[0] || 'The embedded previews could not be decoded');
}

/** The platform's decoders: ImageDecoder (every frame of an animation) where available, else createImageBitmap. */
async function fromPlatform(u8: Uint8Array, fmt: FormatInfo, info: ContainerInfo | null) {
  const blob = new Blob([u8 as BlobPart], { type: fmt.mime });
  const warnings = [...(info?.warnings || [])];
  const notes = info?.notes || [];
  const meta = { loops: info?.loops ?? 0, bitDepth: info?.bitDepth ?? 24, hasAlpha: info?.hasAlpha ?? false, dpi: info?.dpi, paletteSize: info?.paletteSize };
  const ImageDecoderCtor = (globalThis as any).ImageDecoder;
  if (info?.animated && ImageDecoderCtor) {
    try {
      if (!(await ImageDecoderCtor.isTypeSupported(fmt.mime))) throw new Error('type not supported');
      const dec = new ImageDecoderCtor({ data: u8, type: fmt.mime });
      await dec.tracks.ready;
      const track = dec.tracks.selectedTrack;
      const count = Math.min(track?.frameCount || 1, 2000);
      const frames: Frame[] = [];
      for (let i = 0; i < count; i++) {
        const { image } = await dec.decode({ frameIndex: i, completeFramesOnly: true });
        const bmp = await createImageBitmap(image);
        frames.push({ image: bmp, width: bmp.width, height: bmp.height, delay: image.duration ? Math.max(10, image.duration / 1000) : 100 });
        image.close();
      }
      dec.close();
      if (frames.length) {
        return { pages: [{ width: frames[0].width, height: frames[0].height, frames, ...meta, loops: track?.repetitionCount === Infinity ? 0 : meta.loops, notes: [...notes, `${frames.length} frames`] }], info: info?.info || {}, warnings, decoder: 'platform (ImageDecoder)' };
      }
    } catch (e: any) {
      warnings.push(`Animation frames could not be decoded (${e?.message || e}); showing the first frame`);
    }
  }
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob, { imageOrientation: 'none' as any, premultiplyAlpha: 'none' as any });
  } catch (e: any) {
    // Some engines reject the options or the format through createImageBitmap but render it in an <img>.
    bmp = await viaImageElement(blob, fmt);
  }
  const page: Page = { width: bmp.width, height: bmp.height, frames: [{ image: bmp, width: bmp.width, height: bmp.height, delay: 0 }], loops: 0, bitDepth: meta.bitDepth, hasAlpha: meta.hasAlpha, dpi: meta.dpi, paletteSize: meta.paletteSize, notes: [...notes] };
  if (fmt.id === 'svg') page.notes.push('vector, rendered at its intrinsic size');
  return { pages: [page], info: info?.info || {}, warnings, decoder: 'platform' };
}

function viaImageElement(blob: Blob, fmt: FormatInfo): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = 'async';
    img.onload = async () => {
      try { resolve(await createImageBitmap(img)); } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`${fmt.label} is not decodable on this platform`)); };
    img.src = url;
  });
}

export type EncodeFormat = 'png' | 'jpeg' | 'webp' | 'bmp' | 'tga' | 'ppm' | 'pgm' | 'pam' | 'qoi' | 'wbmp';
/** The formats Save As writes, with the extension used and the MIME type. */
export const ENCODERS: Record<EncodeFormat, { label: string; ext: string; mime: string; lossy?: boolean; platform?: boolean }> = {
  png: { label: 'PNG (lossless)', ext: 'png', mime: 'image/png', platform: true },
  jpeg: { label: 'JPEG', ext: 'jpg', mime: 'image/jpeg', lossy: true, platform: true },
  webp: { label: 'WebP', ext: 'webp', mime: 'image/webp', lossy: true, platform: true },
  bmp: { label: 'Windows Bitmap (BMP)', ext: 'bmp', mime: 'image/bmp' },
  tga: { label: 'Truevision TGA', ext: 'tga', mime: 'image/x-tga' },
  ppm: { label: 'Netpbm PPM (color)', ext: 'ppm', mime: 'image/x-portable-pixmap' },
  pgm: { label: 'Netpbm PGM (grayscale)', ext: 'pgm', mime: 'image/x-portable-graymap' },
  pam: { label: 'Netpbm PAM (with transparency)', ext: 'pam', mime: 'image/x-portable-anymap' },
  qoi: { label: 'QOI', ext: 'qoi', mime: 'image/qoi' },
  wbmp: { label: 'Wireless Bitmap (WBMP, 1 bit)', ext: 'wbmp', mime: 'image/vnd.wap.wbmp' },
};
/** The encoder that writes the format a picture was read from, when one exists. */
export function encoderFor(formatId: string): EncodeFormat | undefined {
  return ({ png: 'png', jpeg: 'jpeg', webp: 'webp', bmp: 'bmp', tga: 'tga', pnm: 'ppm', qoi: 'qoi', wbmp: 'wbmp' } as Record<string, EncodeFormat>)[formatId];
}

/** Encodes raw RGBA pixels with one of the app's own writers (no DOM needed). */
export async function encodeRaster(r: Raster, format: Exclude<EncodeFormat, 'png' | 'jpeg' | 'webp'>, opts: { rle?: boolean; threshold?: number } = {}): Promise<Uint8Array> {
  switch (format) {
    case 'bmp': return (await import('./bmp')).encodeBmp(r);
    case 'tga': return (await import('./tga')).encodeTga(r, { rle: opts.rle });
    case 'ppm': case 'pgm': case 'pam': return (await import('./pnm')).encodePnm(r, format);
    case 'qoi': return (await import('./qoi')).encodeQoi(r);
    case 'wbmp': return (await import('./wbmp')).encodeWbmp(r, opts.threshold);
  }
}

/** Encodes a canvas to the chosen format through the platform (PNG, JPEG, WebP) or the app's writers. */
export async function encodeCanvas(c: HTMLCanvasElement, format: EncodeFormat, quality = 0.9, opts: { rle?: boolean; threshold?: number } = {}): Promise<Blob> {
  if (format !== 'png' && format !== 'jpeg' && format !== 'webp') {
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    const id = ctx.getImageData(0, 0, c.width, c.height);
    const bytes = await encodeRaster({ width: c.width, height: c.height, data: id.data as Uint8ClampedArray<ArrayBuffer> }, format, opts);
    return new Blob([bytes as BlobPart], { type: ENCODERS[format].mime });
  }
  const mime = format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp';
  let src = c;
  if (format === 'jpeg') { // JPEG has no alpha: flatten onto white.
    src = document.createElement('canvas'); src.width = c.width; src.height = c.height;
    const x = src.getContext('2d')!; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(c, 0, 0);
  }
  const blob = await new Promise<Blob | null>((res) => src.toBlob(res, mime, quality));
  if (!blob) throw new Error(`Could not encode ${format.toUpperCase()}`);
  if (blob.type !== mime) throw new Error(`${format.toUpperCase()} encoding is not available on this platform`);
  return blob;
}
