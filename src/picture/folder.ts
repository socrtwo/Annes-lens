/**
 * A folder: the ordered list of pictures next/previous move through, and the current position in it.
 * Entries read their bytes lazily from a File (web), a File System Access handle (directory picker),
 * a platform URI (desktop file system, Android content URI, iOS document) or bytes already in memory
 * (a dropped or shared file).
 */
import { readUri, type FolderEntry } from '../platform/native';

export interface Entry {
  name: string;
  /** Platform address for re-reading and write-back; null for in-memory and web File entries. */
  uri: string | null;
  size?: number;
  mtime?: number;
  read(): Promise<ArrayBuffer>;
}

const PICTURE_EXT = /\.(jpe?g|jpe|jfif|png|apng|gif|webp|avif|heic|heif|hif|bmp|dib|ico|cur|tiff?|svgz?|jxl|psd|tga)$/i;

export function isPictureName(name: string): boolean { return PICTURE_EXT.test(name); }

export function entryFromFile(f: File): Entry {
  return { name: f.name, uri: null, size: f.size, mtime: f.lastModified, read: () => f.arrayBuffer() };
}
export function entryFromBytes(name: string, data: ArrayBuffer, uri: string | null = null): Entry {
  let cached: ArrayBuffer | null = data;
  return {
    name, uri, size: data.byteLength,
    read: async () => {
      if (cached) return cached;
      const r = uri ? await readUri(uri) : null;
      if (!r) throw new Error('The file is no longer available.');
      return r.data;
    },
    // A shared or launched file keeps its bytes only until it is first shown; after that it is re-read by URI when possible.
    ...({ release: () => { if (uri) cached = null; } } as object),
  };
}
export function entryFromUri(e: FolderEntry): Entry {
  return { name: e.name, uri: e.uri, size: e.size, mtime: e.mtime, read: async () => { const r = await readUri(e.uri); if (!r) throw new Error('The file could not be read.'); return r.data; } };
}
export function entryFromHandle(name: string, handle: any): Entry {
  let uri: string | null = null;
  return {
    name, get uri() { return uri; }, set uri(v) { uri = v; },
    read: async () => { const f: File = await handle.getFile(); if (!uri) { const { handleId } = await import('../platform/native'); uri = 'fsa:' + (await handleId(handle)); } return f.arrayBuffer(); },
  } as Entry;
}

export type SortKey = 'name' | 'natural' | 'date' | 'size' | 'type';

export class Folder {
  entries: Entry[] = [];
  index = -1;
  name = '';
  /** Platform address of the folder itself, when known. */
  uri: string | null = null;
  private listeners = new Set<() => void>();

  constructor(entries: Entry[] = [], name = '') { this.entries = entries; this.name = name; }

  get current(): Entry | null { return this.entries[this.index] || null; }
  get length(): number { return this.entries.length; }

  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private changed(): void { for (const l of this.listeners) l(); }

  select(i: number): boolean {
    if (!this.entries.length) { this.index = -1; this.changed(); return false; }
    const j = Math.max(0, Math.min(this.entries.length - 1, i));
    this.index = j;
    this.changed();
    return true;
  }
  /** Moves by `d` pictures; wraps at the ends when asked. Returns false at an end without wrapping. */
  step(d: number, wrap: boolean): boolean {
    if (!this.entries.length) return false;
    let j = this.index + d;
    if (j < 0 || j >= this.entries.length) { if (!wrap) return false; j = ((j % this.entries.length) + this.entries.length) % this.entries.length; }
    return this.select(j);
  }
  /** The entry `d` steps away (for prefetching), or null. */
  peek(d: number, wrap: boolean): Entry | null {
    if (!this.entries.length) return null;
    let j = this.index + d;
    if (j < 0 || j >= this.entries.length) { if (!wrap) return null; j = ((j % this.entries.length) + this.entries.length) % this.entries.length; }
    return this.entries[j] || null;
  }
  indexOfName(name: string): number { return this.entries.findIndex((e) => e.name === name); }
  add(entries: Entry[]): void { this.entries.push(...entries); this.changed(); }
  remove(e: Entry): void {
    const i = this.entries.indexOf(e);
    if (i < 0) return;
    this.entries.splice(i, 1);
    if (this.index >= this.entries.length) this.index = this.entries.length - 1;
    else if (i < this.index) this.index--;
    this.changed();
  }
  sort(key: SortKey, descending = false): void {
    const cur = this.current;
    const collator = new Intl.Collator(undefined, { numeric: key === 'natural', sensitivity: 'base' });
    const ext = (n: string) => (n.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
    this.entries.sort((a, b) => {
      let r = 0;
      if (key === 'date') r = (a.mtime || 0) - (b.mtime || 0);
      else if (key === 'size') r = (a.size || 0) - (b.size || 0);
      else if (key === 'type') r = collator.compare(ext(a.name), ext(b.name));
      return (r || collator.compare(a.name, b.name)) * (descending ? -1 : 1);
    });
    this.index = cur ? this.entries.indexOf(cur) : -1;
    this.changed();
  }
}
