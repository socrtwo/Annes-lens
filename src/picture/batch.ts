/**
 * Batch helpers without a DOM: output-name patterns with counters, dates and metadata fields, and a
 * ZIP writer (stored entries) for browsers that have no folder to write into.
 */
import { crc32 } from '../meta/metaWrite';

export interface NameContext { name: string; ext: string; index: number; date?: Date; exifDate?: Date; make?: string; model?: string; width?: number; height?: number; folder?: string }
export interface NameOptions { pattern: string; start?: number; step?: number; pad?: number; case?: 'keep' | 'lower' | 'upper' | 'title'; find?: string; replace?: string; regex?: boolean }

const pad = (n: number, w: number) => String(n).padStart(w, '0');
const safe = (s: string) => s.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');

/**
 * Expands a pattern: {name} {ext} {n} {n:4} {date} {time} {yyyy} {mm} {dd} {hh} {min} {ss} {exifdate} {make} {model} {w} {h} {folder}.
 * The extension is added by the caller (it depends on the output format); a pattern may still use {ext}.
 */
export function expandName(o: NameOptions, c: NameContext): string {
  const n = (o.start ?? 1) + c.index * (o.step ?? 1);
  const d = c.date || new Date(0);
  const ed = c.exifDate || c.date || new Date(0);
  const fields: Record<string, string> = {
    name: c.name, ext: c.ext, n: pad(n, o.pad ?? 1), date: `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`, time: `${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}${pad(d.getSeconds(), 2)}`,
    yyyy: String(d.getFullYear()), mm: pad(d.getMonth() + 1, 2), dd: pad(d.getDate(), 2), hh: pad(d.getHours(), 2), min: pad(d.getMinutes(), 2), ss: pad(d.getSeconds(), 2),
    exifdate: `${ed.getFullYear()}-${pad(ed.getMonth() + 1, 2)}-${pad(ed.getDate(), 2)}`, exiftime: `${pad(ed.getHours(), 2)}${pad(ed.getMinutes(), 2)}${pad(ed.getSeconds(), 2)}`,
    make: c.make || '', model: c.model || '', w: c.width ? String(c.width) : '', h: c.height ? String(c.height) : '', folder: c.folder || '',
  };
  let out = o.pattern.replace(/\{(\w+)(?::(\d+))?\}/g, (m, key: string, width?: string) => {
    if (key === 'n') return pad(n, width ? +width : o.pad ?? 1);
    return key in fields ? fields[key] : m;
  });
  if (o.find) {
    try { out = o.regex ? out.replace(new RegExp(o.find, 'g'), o.replace || '') : out.split(o.find).join(o.replace || ''); } catch { /* bad regex: leave the name */ }
  }
  if (o.case === 'lower') out = out.toLowerCase(); else if (o.case === 'upper') out = out.toUpperCase(); else if (o.case === 'title') out = out.replace(/\b\w/g, (ch) => ch.toUpperCase());
  return safe(out).trim() || `picture-${n}`;
}

/** Appends " (2)", " (3)"… before the extension until the name is unused. */
export function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name.toLowerCase())) { used.add(name.toLowerCase()); return name; }
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; i < 100000; i++) { const n = `${base} (${i})${ext}`; if (!used.has(n.toLowerCase())) { used.add(n.toLowerCase()); return n; } }
  return name;
}

/** A ZIP archive with stored (uncompressed) entries: pictures are already compressed. */
export function writeZip(entries: { name: string; data: Uint8Array; mtime?: number }[]): Uint8Array {
  const le16 = (v: number) => [v & 255, (v >> 8) & 255], le32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  const parts: Uint8Array[] = [], central: number[] = [];
  let offset = 0;
  const enc = new TextEncoder();
  for (const e of entries) {
    const nm = enc.encode(e.name);
    const d = new Date(e.mtime || Date.now());
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosDate = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const crc = crc32(e.data);
    const common = [...le16(20), ...le16(0x800), ...le16(0), ...le16(dosTime), ...le16(dosDate), ...le32(crc), ...le32(e.data.length), ...le32(e.data.length), ...le16(nm.length)];
    const local = Uint8Array.from([...le32(0x04034b50), ...common, ...le16(0), ...nm]);
    parts.push(local, e.data);
    central.push(...le32(0x02014b50), ...le16(20), ...common, ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(offset), ...nm);
    offset += local.length + e.data.length;
  }
  const eocd = [...le32(0x06054b50), ...le16(0), ...le16(0), ...le16(entries.length), ...le16(entries.length), ...le32(central.length), ...le32(offset), ...le16(0)];
  const out = new Uint8Array(offset + central.length + eocd.length);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  out.set(central, o); out.set(eocd, o + central.length);
  return out;
}
