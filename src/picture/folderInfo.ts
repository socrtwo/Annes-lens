/**
 * Per-entry facts for filtering, grouping and timelines: type, size, date (EXIF date taken, else
 * the file date), camera and lens, dimensions and orientation, location, rating, label, keywords
 * and flag. Read once per entry (bytes decoded for the header only) and cached.
 */
import type { App } from '../app';
import type { Entry } from './folder';
import { readMeta } from './metadata';
import { readExif } from '../meta/exif';
import { sniff } from '../codecs/registry';
import { bytesAndFormat } from './metadata';

export interface EntryInfo { name: string; ext: string; size: number; date: Date | null; exifDate: boolean; camera: string; lens: string; width: number; height: number; orientation: 'landscape' | 'portrait' | 'square' | ''; hasGps: boolean; rating: number; label: string; keywords: string[]; flag: string; favorite: boolean }
const cache = new WeakMap<Entry, EntryInfo>();
export const infoOf = (e: Entry): EntryInfo | undefined => cache.get(e);
export const parseExifDate = (s?: string): Date | null => { if (!s) return null; const m = s.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null; };

export async function entryInfo(app: App, e: Entry): Promise<EntryInfo> {
  const hit = cache.get(e); if (hit) return hit;
  const info: EntryInfo = { name: e.name, ext: (e.name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase(), size: e.size || 0, date: e.mtime ? new Date(e.mtime) : null, exifDate: false, camera: '', lens: '', width: 0, height: 0, orientation: '', hasGps: false, rating: 0, label: '', keywords: [], flag: '', favorite: false };
  try {
    const bf = await bytesAndFormat(app, e);
    if (bf) {
      info.size = info.size || bf.bytes.length;
      const exif = readExif(bf.bytes);
      if (exif) { const d = parseExifDate(exif.dateTaken); if (d) { info.date = d; info.exifDate = true; } info.camera = [exif.make, exif.model].filter(Boolean).join(' '); info.lens = exif.lens || ''; info.hasGps = !!exif.gps; }
      const fmt = sniff(bf.bytes, e.name);
      if (fmt && ['jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'].includes(fmt.id)) { try { const bmp = await createImageBitmap(new Blob([bf.bytes as BlobPart], { type: fmt.mime })); info.width = bmp.width; info.height = bmp.height; bmp.close(); } catch { /* none */ } }
      if (info.width && info.height) info.orientation = info.width > info.height ? 'landscape' : info.width < info.height ? 'portrait' : 'square';
      const m = await readMeta(app, e);
      if (m) { const p = m.props; info.rating = p.rating || 0; info.label = (p.label || '').toLowerCase(); info.keywords = p.keywords || []; info.flag = p.flag || ''; info.favorite = !!p.favorite; if (p.lat !== undefined) info.hasGps = true; }
    }
  } catch { /* keep what we have */ }
  cache.set(e, info);
  return info;
}
export const forgetInfo = (e: Entry): void => { cache.delete(e); };

/** Reads every entry's info, reporting progress. */
export async function collectInfo(app: App, entries: Entry[], progress?: (i: number, n: number) => void): Promise<Map<Entry, EntryInfo>> {
  const out = new Map<Entry, EntryInfo>(); let i = 0;
  for (const e of entries) { i++; if (progress && i % 10 === 0) progress(i, entries.length); out.set(e, await entryInfo(app, e)); }
  return out;
}

export interface FilterSpec { types?: string[]; minRating?: number; label?: string; keyword?: string; text?: string; from?: Date | null; to?: Date | null; camera?: string; hasGps?: boolean | null; orientation?: '' | 'landscape' | 'portrait' | 'square'; flag?: string; favorite?: boolean | null }
/** The predicate for a filter spec over entry info (pure). */
export function makeFilter(spec: FilterSpec): (info: EntryInfo) => boolean {
  const types = (spec.types || []).map((t) => t.toLowerCase()).filter(Boolean), kw = (spec.keyword || '').toLowerCase(), text = (spec.text || '').toLowerCase(), camera = (spec.camera || '').toLowerCase(), label = (spec.label || '').toLowerCase();
  const norm = (ext: string) => (ext === 'jpg' || ext === 'jpe' ? 'jpeg' : ext === 'tif' ? 'tiff' : ext);
  return (i) => {
    if (types.length && !types.map(norm).includes(norm(i.ext))) return false;
    if (spec.minRating && i.rating < spec.minRating) return false;
    if (label && i.label !== label) return false;
    if (kw && !i.keywords.some((k) => k.toLowerCase().includes(kw))) return false;
    if (text && !`${i.name} ${i.keywords.join(' ')} ${i.camera}`.toLowerCase().includes(text)) return false;
    if (spec.from && (!i.date || i.date < spec.from)) return false;
    if (spec.to && (!i.date || i.date > spec.to)) return false;
    if (camera && !i.camera.toLowerCase().includes(camera)) return false;
    if (spec.hasGps === true && !i.hasGps) return false; if (spec.hasGps === false && i.hasGps) return false;
    if (spec.orientation && i.orientation !== spec.orientation) return false;
    if (spec.flag && i.flag !== spec.flag) return false;
    if (spec.favorite === true && !i.favorite) return false;
    return true;
  };
}

export type GroupKey = 'none' | 'date' | 'camera' | 'lens' | 'rating' | 'label' | 'keyword' | 'type' | 'stack';
const pad = (n: number) => String(n).padStart(2, '0');
export function groupLabel(key: GroupKey, i: EntryInfo, stackOf?: (name: string) => string): string {
  switch (key) {
    case 'date': return i.date ? `${i.date.getFullYear()}-${pad(i.date.getMonth() + 1)}-${pad(i.date.getDate())}` : 'No date';
    case 'camera': return i.camera || 'Unknown camera'; case 'lens': return i.lens || 'Unknown lens';
    case 'rating': return i.rating ? '★'.repeat(i.rating) : 'Unrated'; case 'label': return i.label ? i.label[0].toUpperCase() + i.label.slice(1) : 'No label';
    case 'keyword': return i.keywords[0] || 'No keywords'; case 'type': return i.ext.toUpperCase() || 'File';
    case 'stack': return stackOf ? stackOf(i.name) : i.name;
    default: return '';
  }
}

/** Stacks: RAW+JPEG pairs share a base name; bursts are runs of pictures taken within `gapSeconds` of each other. Returns a stack id per entry name. */
export function stackIds(infos: EntryInfo[], gapSeconds = 3): Map<string, string> {
  const byBase = new Map<string, string[]>();
  for (const i of infos) { const b = i.name.replace(/\.[^.]+$/, '').toLowerCase(); byBase.set(b, [...(byBase.get(b) || []), i.name]); }
  const out = new Map<string, string>();
  const sorted = [...infos].filter((i) => i.date).sort((a, b) => a.date!.getTime() - b.date!.getTime());
  let burst = 0, last: EntryInfo | null = null;
  for (const i of sorted) { if (last && i.date!.getTime() - last.date!.getTime() <= gapSeconds * 1000) { if (!out.has(last.name)) out.set(last.name, `Burst ${++burst}`); out.set(i.name, out.get(last.name)!); } last = i; }
  for (const [b, names] of byBase) if (names.length > 1) for (const n of names) if (!out.has(n)) out.set(n, `Pair ${b}`);
  for (const i of infos) if (!out.has(i.name)) out.set(i.name, 'Single pictures');
  return out;
}
