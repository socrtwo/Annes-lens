/**
 * Content sniffing and codec selection. A picture is recognized by its bytes, never by its name; the
 * decoder is the platform (createImageBitmap, ImageDecoder) for the formats it handles and the app's own
 * readers for GIF (every frame), TIFF, BMP, ICO and CUR. Decoding happens off the main thread where the
 * platform allows (createImageBitmap) and is tolerant: a damaged GIF or TIFF shows what was readable.
 */
import { Picture, type Page, type Frame } from '../picture/model';
import type { Entry } from '../picture/folder';
import { decodeGif, isGif } from './gif';
import { decodeTiff, isTiff } from './tiff';
import { decodeBmp, isBmp } from './bmp';
import { isIco, readIco, decodeIcoDibs } from './ico';
import { jpegInfo, pngInfo, webpInfo, type ContainerInfo } from './info';
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
];

export function formatById(id: string): FormatInfo | undefined { return FORMATS.find((f) => f.id === id); }
export function formatFromName(name: string): FormatInfo | undefined { const ext = (name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase(); return FORMATS.find((f) => f.extensions.includes(ext)); }

export const OPEN_ACCEPT = 'image/*,' + FORMATS.flatMap((f) => f.extensions).map((e) => '.' + e).join(',');
export const OPEN_MIMES = ['image/*', ...new Set(FORMATS.map((f) => f.mime)), 'application/octet-stream'];

const at = (u8: Uint8Array, o: number, s: string) => { for (let i = 0; i < s.length; i++) if (u8[o + i] !== s.charCodeAt(i)) return false; return true; };

/** The format of `u8` from its first bytes, or null when it is not a picture Anne's Lens knows. */
export function sniff(u8: Uint8Array): FormatInfo | null {
  if (u8.length < 12) return null;
  if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return formatById('jpeg')!;
  if (at(u8, 0, '\x89PNG\r\n\x1a\n')) { return pngInfo(u8).animated ? formatById('apng')! : formatById('png')!; }
  if (isGif(u8)) return formatById('gif')!;
  if (at(u8, 0, 'RIFF') && at(u8, 8, 'WEBP')) return formatById('webp')!;
  if (at(u8, 4, 'ftyp')) {
    const brand = String.fromCharCode(...u8.subarray(8, 12));
    const compat = String.fromCharCode(...u8.subarray(16, Math.min(u8.length, 64)));
    if (/avi[fs]/.test(brand) || /avi[fs]/.test(compat)) return formatById('avif')!;
    if (/hei[cfxms]|mif1|msf1/.test(brand) || /heic|mif1/.test(compat)) return formatById('heic')!;
  }
  if ((u8[0] === 0xff && u8[1] === 0x0a) || at(u8, 0, '\0\0\0\x0cJXL ')) return formatById('jxl')!;
  if (isBmp(u8)) return formatById('bmp')!;
  if (isIco(u8)) return (u8[2] | (u8[3] << 8)) === 2 ? formatById('cur')! : formatById('ico')!;
  if (isTiff(u8)) return formatById('tiff')!;
  if (u8[0] === 0x1f && u8[1] === 0x8b) return formatById('svg')!; // svgz (checked again by the platform)
  const head = new TextDecoder('utf-8', { fatal: false }).decode(u8.subarray(0, Math.min(u8.length, 2048)));
  if (/<svg[\s>]/i.test(head) && !/<script/i.test(head.slice(0, 200))) return formatById('svg')!;
  return null;
}

/** Decodes bytes into a Picture. Throws with a readable message when nothing can be shown. */
export async function decodePicture(u8: Uint8Array, entry: Entry): Promise<Picture> {
  const fmt = sniff(u8) || formatFromName(entry.name);
  if (!fmt) throw new Error('Not a picture format Anne\'s Lens can open');
  const exif = safe(() => readExif(u8));
  let decoded: { pages: Page[]; info: Record<string, string>; warnings: string[]; decoder: string };
  if (fmt.id === 'gif') decoded = fromOwn(decodeGif(u8), 'gif');
  else if (fmt.id === 'tiff') decoded = fromOwn(await decodeTiff(u8), 'tiff');
  else if (fmt.id === 'ico' || fmt.id === 'cur') decoded = await decodeIcoFile(u8);
  else if (fmt.id === 'bmp') {
    try { decoded = await fromPlatform(u8, fmt, null); } catch { decoded = fromOwn(decodeBmp(u8), 'bmp'); }
  } else {
    const info: ContainerInfo | null = fmt.id === 'jpeg' ? safe(() => jpegInfo(u8)) : fmt.id === 'png' || fmt.id === 'apng' ? safe(() => pngInfo(u8)) : fmt.id === 'webp' ? safe(() => webpInfo(u8)) : null;
    decoded = await fromPlatform(u8, fmt, info);
  }
  const pic = new Picture(entry, u8, fmt, decoded.pages, exif, decoded.info, decoded.warnings, decoded.decoder);
  if (exif?.dpi) for (const p of pic.pages) if (!p.dpi) p.dpi = exif.dpi;
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

/** Encodes a canvas to the chosen format through the platform (PNG, JPEG, WebP) or the app's writer (BMP). */
export async function encodeCanvas(c: HTMLCanvasElement, format: 'png' | 'jpeg' | 'webp' | 'bmp', quality = 0.9): Promise<Blob> {
  if (format === 'bmp') {
    const { encodeBmp } = await import('./bmp');
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    const id = ctx.getImageData(0, 0, c.width, c.height);
    return new Blob([encodeBmp({ width: c.width, height: c.height, data: id.data }) as BlobPart], { type: 'image/bmp' });
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
