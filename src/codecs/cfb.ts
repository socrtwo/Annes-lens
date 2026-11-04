/**
 * Microsoft Compound File Binary (OLE2 structured storage) reader: the container of FlashPix pictures and of
 * old Office documents. Sectors of 512 or 4096 bytes, the FAT and its DIFAT chain, the mini stream for small
 * streams, and the directory tree (storages and streams by path, "Storage/Stream").
 */
const le16 = (u: Uint8Array, o: number) => u[o] | (u[o + 1] << 8);
const le32 = (u: Uint8Array, o: number) => (u[o] | (u[o + 1] << 8) | (u[o + 2] << 16) | (u[o + 3] << 24)) >>> 0;
const END = 0xfffffffe, FREE = 0xffffffff;

export const isCfb = (u8: Uint8Array): boolean => u8.length >= 512 && le32(u8, 0) === 0xe011cfd0 && le32(u8, 4) === 0xe11ab1a1;

export interface CfbEntry { name: string; path: string; type: 'storage' | 'stream' | 'root'; size: number; clsid: Uint8Array }
export class Cfb {
  readonly entries: CfbEntry[] = [];
  private fat: Uint32Array;
  private miniFat: Uint32Array;
  private miniStream: Uint8Array;
  private readonly secSize: number;
  private readonly cutoff: number;
  private readonly starts = new Map<string, number>();

  constructor(private readonly u8: Uint8Array) {
    if (!isCfb(u8)) throw new Error('Not a compound file');
    const shift = le16(u8, 0x1e);
    if (shift !== 9 && shift !== 12) throw new Error('Unsupported compound-file sector size');
    this.secSize = 1 << shift; this.cutoff = le32(u8, 0x38) || 4096;
    // The FAT's sectors: 109 in the header, the rest in the DIFAT chain.
    const fatSecs: number[] = [];
    for (let i = 0; i < 109; i++) { const s = le32(u8, 0x4c + i * 4); if (s < END) fatSecs.push(s); }
    let dif = le32(u8, 0x44), guard = 0;
    while (dif < END && guard++ < 1e5) {
      const o = this.off(dif), per = this.secSize / 4 - 1;
      for (let i = 0; i < per; i++) { const s = le32(u8, o + i * 4); if (s < END) fatSecs.push(s); }
      dif = le32(u8, o + per * 4);
    }
    const fat = new Uint32Array(fatSecs.length * (this.secSize / 4));
    fatSecs.forEach((s, k) => { const o = this.off(s); for (let i = 0; i < this.secSize / 4; i++) fat[k * (this.secSize / 4) + i] = o + i * 4 + 4 <= u8.length ? le32(u8, o + i * 4) : FREE; });
    this.fat = fat;
    const dir = this.read(le32(u8, 0x30), Infinity);
    const miniFatBytes = this.read(le32(u8, 0x3c), Infinity);
    this.miniFat = new Uint32Array(miniFatBytes.length >> 2).map((_, i) => le32(miniFatBytes, i * 4));
    // Directory: a red-black tree per storage (left and right siblings, child).
    const n = dir.length >> 7, at = (i: number) => i * 128;
    const name = (i: number) => { const len = Math.max(0, le16(dir, at(i) + 64) - 2); let s = ''; for (let k = 0; k < len; k += 2) s += String.fromCharCode(le16(dir, at(i) + k)); return s; };
    const types = { 1: 'storage', 2: 'stream', 5: 'root' } as const;
    this.miniStream = n ? this.read(le32(dir, 116), le32(dir, 120)) : new Uint8Array(0);
    const seen = new Set<number>();
    const walk = (i: number, prefix: string) => {
      if (i >= n || i === FREE || seen.has(i)) return;
      seen.add(i);
      const o = at(i), type = types[dir[o + 66] as 1 | 2 | 5];
      walk(le32(dir, o + 68), prefix);
      if (type) {
        const nm = name(i), path = prefix + nm, size = le32(dir, o + 120);
        this.entries.push({ name: nm, path, type, size, clsid: dir.slice(o + 80, o + 96) });
        this.starts.set(path, le32(dir, o + 116));
        if (type === 'storage') walk(le32(dir, o + 76), path + '/');
      }
      walk(le32(dir, o + 72), prefix);
    };
    if (n) { seen.add(0); walk(le32(dir, 76), ''); }
  }
  private off(sec: number): number { return (sec + 1) * this.secSize; }
  /** A chain of big sectors, cut to `size`. */
  private read(start: number, size: number): Uint8Array {
    const parts: Uint8Array[] = []; let s = start, total = 0, guard = 0;
    while (s < END && total < size && guard++ <= this.fat.length) {
      const o = this.off(s); if (o >= this.u8.length) break;
      const p = this.u8.subarray(o, Math.min(o + this.secSize, this.u8.length)); parts.push(p); total += p.length;
      s = this.fat[s] ?? END;
    }
    const out = new Uint8Array(Math.min(total, size)); let k = 0;
    for (const p of parts) { const take = Math.min(p.length, out.length - k); out.set(p.subarray(0, take), k); k += take; }
    return out;
  }
  private readMini(start: number, size: number): Uint8Array {
    const out = new Uint8Array(size); let s = start, k = 0, guard = 0;
    while (s < END && k < size && guard++ < this.miniFat.length + 1) {
      const o = s * 64, take = Math.min(64, size - k);
      out.set(this.miniStream.subarray(o, o + take), k); k += take;
      s = this.miniFat[s] ?? END;
    }
    return k < size ? out.subarray(0, k) : out;
  }
  has(path: string): boolean { return this.entries.some((e) => e.path === path && e.type === 'stream'); }
  /** A stream's bytes by its path ("Storage/Stream"); null when there is none. */
  stream(path: string): Uint8Array | null {
    const e = this.entries.find((x) => x.path === path && x.type === 'stream');
    if (!e) return null;
    const start = this.starts.get(path)!;
    return e.size < this.cutoff ? this.readMini(start, e.size) : this.read(start, e.size);
  }
}

/** An OLE property set (the first section): property id → number, string, bytes or array. */
export function propertySet(u8: Uint8Array): Map<number, any> {
  const out = new Map<number, any>();
  if (u8.length < 48 || le16(u8, 0) !== 0xfffe) return out;
  const sec = le32(u8, 44), count = le32(u8, sec + 4);
  for (let i = 0; i < count && sec + 8 + i * 8 + 8 <= u8.length; i++) {
    const id = le32(u8, sec + 8 + i * 8), o = sec + le32(u8, sec + 12 + i * 8);
    if (o + 4 > u8.length) continue;
    const t = le32(u8, o);
    const one = (type: number, p: number): [any, number] => {
      switch (type) {
        case 2: return [(le16(u8, p) << 16) >> 16, 2];
        case 3: return [le32(u8, p) | 0, 4];
        case 18: return [le16(u8, p), 2];
        case 19: return [le32(u8, p), 4];
        case 4: return [new DataView(u8.buffer, u8.byteOffset + p, 4).getFloat32(0, true), 4];
        case 5: return [new DataView(u8.buffer, u8.byteOffset + p, 8).getFloat64(0, true), 8];
        case 11: return [le16(u8, p) !== 0, 2];
        case 17: return [u8[p], 1];
        case 30: { const n = le32(u8, p); return [new TextDecoder('latin1').decode(u8.subarray(p + 4, p + 4 + n)).replace(/\0+$/, ''), 4 + ((n + 3) & ~3)]; }
        case 65: { const n = le32(u8, p); return [u8.slice(p + 4, p + 4 + n), 4 + ((n + 3) & ~3)]; }
        default: return [undefined, 0];
      }
    };
    try {
      if (t & 0x1000) { const n = le32(u8, o + 4), arr: any[] = []; let p = o + 8; for (let k = 0; k < n && p < u8.length; k++) { const [v, len] = one(t & 0xfff, p); if (!len) break; arr.push(v); p += len; } out.set(id, arr); }
      else { const [v] = one(t, o + 4); if (v !== undefined) out.set(id, v); }
    } catch { /* a damaged property */ }
  }
  return out;
}
