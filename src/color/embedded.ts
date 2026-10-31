/**
 * Profiles in files: finding the embedded ICC profile (JPEG APP2, PNG iCCP, WebP ICCP, TIFF tag
 * 34675), deciding whether it can describe a picture's pixels (RGB or gray, usable both ways),
 * and the profile a saved file should carry.
 */
import { extractMeta, pngIcc, injectPngIcc, injectMeta, hasMeta, type PictureMeta } from '../meta/metaWrite';
import { readIfd } from '../codecs/tiff';
import { parseIcc, writeIcc, type IccProfile } from './icc';
import { side } from './transform';
import { isSrgb, spaceProfile } from './spaces';

const parsed = new WeakMap<Uint8Array, IccProfile | null>();
/** Parses (once per byte array) and returns null for anything that is not a readable profile. */
export function profileOf(bytes: Uint8Array | undefined | null): IccProfile | null {
  if (!bytes) return null;
  if (!parsed.has(bytes)) { let p: IccProfile | null = null; try { p = parseIcc(bytes); } catch { /* not a profile */ } parsed.set(bytes, p); }
  return parsed.get(bytes)!;
}
/** A profile that can describe a picture's pixels: RGB or gray, convertible to and from the PCS. */
export function docProfile(bytes: Uint8Array | undefined | null): IccProfile | null {
  const p = profileOf(bytes);
  if (!p || (p.colorSpace !== 'RGB' && p.colorSpace !== 'GRAY')) return null;
  try { const s = side(p, 1); s.fromPcs(s.toPcs(p.colorSpace === 'GRAY' ? [0.5] : [0.5, 0.5, 0.5])); return p; } catch { return null; }
}
export const profileName = (bytes: Uint8Array | undefined | null): string => (bytes ? profileOf(bytes)?.description || 'Unnamed profile' : 'sRGB (untagged)');

/** The ICC profile embedded in a JPEG, PNG, WebP or TIFF file, or null. */
export async function embeddedIcc(u8: Uint8Array, formatId: string): Promise<Uint8Array | null> {
  if (formatId === 'jpeg' || formatId === 'webp') return extractMeta(u8).icc || null;
  if (formatId === 'png' || formatId === 'apng') return pngIcc(u8);
  if (formatId === 'tiff') {
    const le = u8[0] === 0x49, big = (le ? u8[2] | (u8[3] << 8) : (u8[2] << 8) | u8[3]) === 43;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const ifd = big ? Number(dv.getBigUint64(8, le)) : dv.getUint32(4, le);
    const e = readIfd(u8, ifd, le, big).tags.get(34675);
    return e ? Uint8Array.from(e.values) : null;
  }
  return null;
}

/** The embedded profile when the pixels should stay in it (a usable profile other than sRGB). */
export async function keepEmbedded(u8: Uint8Array, formatId: string): Promise<{ icc: Uint8Array; profile: IccProfile } | null> {
  let icc: Uint8Array | null = null;
  try { icc = await embeddedIcc(u8, formatId); } catch { return null; }
  const p = docProfile(icc);
  return icc && p && !isSrgb(p) ? { icc, profile: p } : null;
}

/** An RGB stand-in for a gray profile (R = G = B pixels in a 3-channel file): sRGB colorants, the gray tone curve. */
export function grayAsRgb(p: IccProfile): Uint8Array {
  const f = p.grayTrc!, t = Array.from({ length: 1024 }, (_, i) => f(i / 1023));
  return writeIcc({ description: `${p.description || 'Gray'} (as RGB)`, matrix: spaceProfile('srgb').matrix!, trc: t });
}

/**
 * The profile a saved JPEG, PNG or WebP carries: the page's profile (gray profiles as their RGB
 * stand-in), the source's own profile when the pixels are sRGB and it is an sRGB profile, else none.
 */
export function iccForSave(pageIcc: Uint8Array | undefined, sourceIcc: Uint8Array | undefined): Uint8Array | undefined {
  if (pageIcc) { const p = docProfile(pageIcc); return p?.colorSpace === 'GRAY' ? grayAsRgb(p) : pageIcc; }
  const s = profileOf(sourceIcc);
  return s && isSrgb(s) ? sourceIcc : undefined;
}

/** Writes EXIF/XMP and the profile into an encoded JPEG, PNG or WebP. */
export async function writeWithProfile(bytes: Uint8Array, format: 'jpeg' | 'png' | 'webp', meta: PictureMeta, icc: Uint8Array | undefined): Promise<Uint8Array> {
  const m: PictureMeta = { exif: meta.exif, xmp: meta.xmp, icc };
  let out = hasMeta(m) ? injectMeta(bytes, format, m) : bytes;
  if (format === 'png' && icc) out = await injectPngIcc(out, icc, profileName(icc));
  return out;
}
