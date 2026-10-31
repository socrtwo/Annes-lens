/**
 * Motion Photo: the video clip stored after the picture in Google motion photos (XMP
 * Container:Directory or the older GCamera:MicroVideoOffset) and Samsung motion photos
 * ("MotionPhoto_Data" marker), or, failing those, an MP4/QuickTime file appended after the JPEG.
 */
import { findEmbeddedJpegs } from '../codecs/rawpreview';

export interface Clip { offset: number; length: number; mime: string; how: string }
const latin = (u8: Uint8Array, a: number, n: number) => { let s = ''; for (let i = a; i < Math.min(u8.length, a + n); i++) s += String.fromCharCode(u8[i]); return s; };
const indexOf = (u8: Uint8Array, s: string, from = 0): number => { const c0 = s.charCodeAt(0); outer: for (let i = from; i <= u8.length - s.length; i++) { if (u8[i] !== c0) continue; for (let k = 1; k < s.length; k++) if (u8[i + k] !== s.charCodeAt(k)) continue outer; return i; } return -1; };
const mimeOf = (u8: Uint8Array, at: number) => (latin(u8, at + 8, 4) === 'qt  ' ? 'video/quicktime' : 'video/mp4');
const isFtyp = (u8: Uint8Array, at: number) => at >= 0 && at + 12 <= u8.length && latin(u8, at + 4, 4) === 'ftyp';

export function findMotionClip(u8: Uint8Array): Clip | null {
  if (u8.length < 16 || u8[0] !== 0xff || u8[1] !== 0xd8) return null;
  const head = latin(u8, 0, Math.min(u8.length, 256 * 1024));
  // Google, current: the last directory item that is the video, with its length.
  const items = [...head.matchAll(/<Container:Item\b[^>]*>/gi)].map((m) => m[0]);
  const vid = items.find((it) => /Item:Mime=["']video\//i.test(it) || /Item:Semantic=["']MotionPhoto["']/i.test(it));
  const len = vid?.match(/Item:Length=["'](\d+)["']/i);
  if (len) { const L = +len[1], at = u8.length - L; if (isFtyp(u8, at)) return { offset: at, length: L, mime: mimeOf(u8, at), how: 'Google motion photo' }; }
  // Google, older: MicroVideoOffset counts from the end of the file.
  const mvo = head.match(/MicroVideoOffset(?:=["']|>)(\d+)/i);
  if (mvo) { const at = u8.length - +mvo[1]; if (isFtyp(u8, at)) return { offset: at, length: u8.length - at, mime: mimeOf(u8, at), how: 'Google motion photo' }; }
  // Samsung: the clip follows a "MotionPhoto_Data" marker.
  const sm = indexOf(u8, 'MotionPhoto_Data');
  if (sm >= 0 && isFtyp(u8, sm + 16)) return { offset: sm + 16, length: u8.length - sm - 16, mime: mimeOf(u8, sm + 16), how: 'Samsung motion photo' };
  // Otherwise, an MP4 appended after the JPEG.
  const first = findEmbeddedJpegs(u8, 1)[0];
  const end = first && first.offset === 0 ? first.length : 2;
  for (let i = indexOf(u8, 'ftyp', end); i >= 0; i = indexOf(u8, 'ftyp', i + 4)) if (isFtyp(u8, i - 4)) return { offset: i - 4, length: u8.length - (i - 4), mime: mimeOf(u8, i - 4), how: 'video after the picture' };
  return null;
}
