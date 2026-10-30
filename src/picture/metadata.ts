/**
 * Metadata at the application level: reading a picture's XMP properties (embedded packet, or the
 * .xmp sidecar next to the file), and writing edits back — into the file for JPEG, PNG and WebP, or
 * into a sidecar for the rest (and when the preference says so) — for the current picture or any
 * folder entry, keeping the decoded pixels and the thumbnails.
 */
import type { App } from '../app';
import type { Entry } from './folder';
import { entryFromBytes } from './folder';
import { sniff } from '../codecs/registry';
import { extractMeta } from '../meta/metaWrite';
import { readExif } from '../meta/exif';
import { parseXmp, updateXmp, type XmpProps } from '../meta/xmp';
import { setXmp, canEmbed, decodeText } from '../meta/metaEdit';
import { listFolderOf, readUri, writeBack, writeIntoFolder, saveAs } from '../platform/native';
import { dirUriOf } from '../commands/fileOps';
import { toast } from '../ui/dialog';

const utf8 = (s: string) => new TextEncoder().encode(s);
export const baseName = (n: string) => n.replace(/\.[^.]+$/, '');

/** Bytes and format id of an entry (the current picture's bytes when it is the one shown). */
export async function bytesAndFormat(app: App, e: Entry): Promise<{ bytes: Uint8Array; format: string } | null> {
  const pic = app.tab.picture;
  if (pic && pic.entry === e) return { bytes: pic.bytes, format: pic.format.id };
  try { const buf = await e.read(); const bytes = new Uint8Array(buf); return { bytes, format: sniff(bytes, e.name)?.id || '' }; } catch { return null; }
}

// Sidecars -----------------------------------------------------------------------------------------
const listings = new Map<string, { at: number; entries: { uri: string; name: string }[] }>();
async function folderListing(dirUri: string): Promise<{ uri: string; name: string }[]> {
  const c = listings.get(dirUri);
  if (c && Date.now() - c.at < 5000) return c.entries;
  const l = await listFolderOf(dirUri);
  const entries = l ? l.entries : [];
  listings.set(dirUri, { at: Date.now(), entries });
  return entries;
}
export const forgetListings = (): void => listings.clear();

/** The sidecar file next to an entry ("name.xmp" or "base.xmp"), when the folder can be listed. */
export async function findSidecar(app: App, e: Entry): Promise<{ uri: string; name: string } | null> {
  const dir = dirUriOf(e, app.tab.folder);
  if (!dir) return null;
  const want = [`${e.name}.xmp`.toLowerCase(), `${baseName(e.name)}.xmp`.toLowerCase()];
  const entries = await folderListing(dir);
  return entries.find((x) => want.includes(x.name.toLowerCase())) || null;
}
export async function readSidecar(app: App, e: Entry): Promise<string | null> {
  const sc = await findSidecar(app, e);
  if (!sc) return null;
  const f = await readUri(sc.uri);
  return f ? decodeText(new Uint8Array(f.data)) : null;
}

// Reading ------------------------------------------------------------------------------------------
/** The last properties read for an entry (for menu check marks and toggles; filled by readMeta). */
const propsCache = new WeakMap<Entry, XmpProps>();
export const propsOf = (e: Entry | null | undefined): XmpProps | undefined => (e ? propsCache.get(e) : undefined);
export interface MetaView { props: XmpProps; embedded: string | null; sidecar: string | null; format: string; bytes: Uint8Array }
/** Properties from the sidecar (when present) merged over the embedded packet. */
export async function readMeta(app: App, e: Entry): Promise<MetaView | null> {
  const bf = await bytesAndFormat(app, e);
  if (!bf) return null;
  const emb = extractMeta(bf.bytes).xmp;
  const embedded = emb ? decodeText(emb) : null;
  const sidecar = await readSidecar(app, e);
  const props = { ...(embedded ? parseXmp(embedded) : {}), ...(sidecar ? parseXmp(sidecar) : {}) };
  propsCache.set(e, props);
  return { props, embedded, sidecar, format: bf.format, bytes: bf.bytes };
}

// Writing ------------------------------------------------------------------------------------------
/** Swaps the entry's bytes in the folder, the loader and the current picture (pixels kept). */
export function replaceBytes(app: App, e: Entry, bytes: Uint8Array, uri: string | null = e.uri): Entry {
  const tab = app.tab;
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const ne = entryFromBytes(e.name, buf, uri);
  ne.mtime = Date.now();
  const i = tab.folder.entries.indexOf(e);
  if (i >= 0) tab.folder.entries[i] = ne;
  if (tab.marked.delete(e)) tab.marked.add(ne);
  tab.loader.rekey(e, ne);
  propsCache.delete(e);
  const pic = tab.picture;
  if (pic && pic.entry === e) { pic.entry = ne; pic.bytes = bytes; pic.exif = readExif(bytes); pic.version++; tab.ui.pictureChanged(); }
  else tab.loader.invalidate(ne);
  app.refresh();
  return ne;
}

export type WriteResult = 'written' | 'sidecar' | 'savedAs' | 'unsupported' | 'failed' | 'canceled';

/** Writes new bytes for an entry: back into the file, else (current picture only) through Save As. */
export async function writeEntryBytes(app: App, e: Entry, bytes: Uint8Array, mime = 'application/octet-stream'): Promise<WriteResult> {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  if (e.uri) {
    let ok = false;
    try { ok = await writeBack(e.uri, blob); } catch { ok = false; }
    if (ok) { replaceBytes(app, e, bytes); return 'written'; }
  }
  const isCurrent = app.tab.picture?.entry === e;
  if (!isCurrent) return 'failed';
  const r = await saveAs(blob, e.name);
  if (!r) return 'canceled';
  replaceBytes(app, e, bytes, r.uri);
  return 'savedAs';
}

/** Writes a sidecar packet next to the entry (overwriting an existing one). */
export async function writeSidecar(app: App, e: Entry, xml: string): Promise<WriteResult> {
  const data = utf8(xml);
  const existing = await findSidecar(app, e);
  if (existing) { try { if (await writeBack(existing.uri, new Blob([data], { type: 'application/rdf+xml' }))) return 'sidecar'; } catch { /* fall through */ } }
  const dir = dirUriOf(e, app.tab.folder);
  if (dir) { try { await writeIntoFolder(dir, `${e.name}.xmp`, data.buffer as ArrayBuffer); listings.delete(dir); return 'sidecar'; } catch { /* fall through */ } }
  if (app.tab.picture?.entry !== e) return 'failed';
  const r = await saveAs(new Blob([data], { type: 'application/rdf+xml' }), `${e.name}.xmp`);
  return r ? 'savedAs' : 'canceled';
}

/** Applies an XMP-level patch to an entry, embedded or as a sidecar per the preference and the format. */
export async function patchXmp(app: App, e: Entry, patch: Partial<XmpProps> | ((xml: string | null) => string)): Promise<WriteResult> {
  const view = await readMeta(app, e);
  if (!view) return 'failed';
  const apply = (xml: string | null) => (typeof patch === 'function' ? patch(xml) : updateXmp(xml, patch));
  const mode = app.prefs.sidecarMode;
  const embed = canEmbed(view.format) && mode !== 'sidecar';
  const side = !canEmbed(view.format) || mode !== 'embed' || !!view.sidecar;
  let result: WriteResult = 'unsupported';
  if (embed) {
    const xml = apply(view.embedded);
    result = await writeEntryBytes(app, e, setXmp(view.bytes, view.format, utf8(xml)), `image/${view.format}`);
    if (result === 'canceled' || result === 'failed') return result;
  }
  if (side) {
    const r = await writeSidecar(app, e, apply(view.sidecar ?? (embed ? null : view.embedded)));
    if (!embed || r === 'failed') result = r;
  }
  return result;
}

/** Applies a bytes-level edit (strip, comment, IPTC, EXIF dates) to an entry whose format supports it. */
export async function patchBytes(app: App, e: Entry, fn: (bytes: Uint8Array, format: string) => Uint8Array | null): Promise<WriteResult> {
  const bf = await bytesAndFormat(app, e);
  if (!bf || !canEmbed(bf.format)) return 'unsupported';
  const out = fn(bf.bytes, bf.format);
  if (!out) return 'unsupported';
  return writeEntryBytes(app, e, out, `image/${bf.format}`);
}

/** The pictures a metadata command acts on: the marked thumbnails, else the current picture. */
export function metaTargets(app: App): Entry[] {
  const t = app.tab;
  const marked = t.folder.entries.filter((e) => t.marked.has(e));
  if (marked.length) return marked;
  return t.picture ? [t.picture.entry] : [];
}

/** Runs a per-entry writer over the targets and reports once. */
export async function forTargets(app: App, label: string, fn: (e: Entry) => Promise<WriteResult>): Promise<{ ok: number; failed: number; unsupported: number }> {
  const targets = metaTargets(app);
  const n = { ok: 0, failed: 0, unsupported: 0 };
  let canceled = false;
  for (const e of targets) {
    const r = await fn(e);
    if (r === 'written' || r === 'sidecar' || r === 'savedAs') n.ok++; else if (r === 'unsupported') n.unsupported++; else if (r === 'failed') n.failed++;
    if (r === 'canceled') { canceled = true; break; }
  }
  app.tab.thumbs.sync();
  if (app.tab.picture) await readMeta(app, app.tab.picture.entry); // refresh the cached properties behind menus and toggles
  app.refresh();
  if (canceled && !n.ok) { toast('Canceled (the picture has no file to write back to; Save As keeps the metadata).', { ms: 4000 }); return n; }
  const bits = [`${label}: ${n.ok} of ${targets.length}`];
  if (n.unsupported) bits.push(`${n.unsupported} format${n.unsupported === 1 ? '' : 's'} cannot carry it`);
  if (n.failed) bits.push(`${n.failed} could not be written (read-only file?)`);
  toast(bits.join('; '), { ms: n.failed || n.unsupported ? 6000 : 2500 });
  return n;
}
