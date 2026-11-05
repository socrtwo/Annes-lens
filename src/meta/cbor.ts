/**
 * CBOR (RFC 8949), the encoding of C2PA claims, assertions and COSE signatures: an encoder for the JavaScript
 * values the manifest code builds (maps with text or integer keys, arrays, strings, byte strings, integers, booleans,
 * null, floats, tagged values) and a decoder for reading manifests back. Integers encode in their shortest form;
 * maps keep the order given (C2PA does not require canonical ordering).
 */
export class Tagged { constructor(public tag: number, public value: unknown) {} }
export type CborValue = unknown;

export function cborEncode(v: CborValue): Uint8Array {
  const out: number[] = [];
  write(out, v);
  return new Uint8Array(out);
}
function head(out: number[], major: number, n: number): void {
  const m = major << 5;
  if (n < 24) out.push(m | n);
  else if (n < 0x100) out.push(m | 24, n);
  else if (n < 0x10000) out.push(m | 25, n >> 8, n & 255);
  else if (n < 0x100000000) out.push(m | 26, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
  else { const hi = Math.floor(n / 0x100000000), lo = n >>> 0; out.push(m | 27, (hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255); }
}
function write(out: number[], v: CborValue): void {
  if (v === null || v === undefined) { out.push(0xf6); return; }
  if (v === true) { out.push(0xf5); return; }
  if (v === false) { out.push(0xf4); return; }
  if (typeof v === 'number') {
    if (Number.isInteger(v) && Math.abs(v) < 2 ** 53) { if (v >= 0) head(out, 0, v); else head(out, 1, -1 - v); return; }
    const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v); out.push(0xfb, ...b); return;
  }
  if (typeof v === 'bigint') { if (v >= 0n) head(out, 0, Number(v)); else head(out, 1, Number(-1n - v)); return; }
  if (typeof v === 'string') { const b = new TextEncoder().encode(v); head(out, 3, b.length); for (const x of b) out.push(x); return; }
  if (v instanceof Uint8Array) { head(out, 2, v.length); for (const x of v) out.push(x); return; }
  if (v instanceof Tagged) { head(out, 6, v.tag); write(out, v.value); return; }
  if (Array.isArray(v)) { head(out, 4, v.length); for (const x of v) write(out, x); return; }
  if (v instanceof Map) { head(out, 5, v.size); for (const [k, x] of v) { write(out, k); write(out, x); } return; }
  if (typeof v === 'object') { const keys = Object.keys(v as object); head(out, 5, keys.length); for (const k of keys) { write(out, k); write(out, (v as any)[k]); } return; }
  throw new Error(`CBOR: cannot encode ${typeof v}`);
}

/** Decodes one CBOR item; maps with string keys become objects, others Map; byte strings Uint8Array; tags Tagged. */
export function cborDecode(u8: Uint8Array): CborValue { const r = new Reader(u8); const v = r.item(); return v; }
export function cborDecodeWithLength(u8: Uint8Array): { value: CborValue; length: number } { const r = new Reader(u8); return { value: r.item(), length: r.p }; }
class Reader {
  p = 0;
  constructor(private u8: Uint8Array) {}
  private byte(): number { if (this.p >= this.u8.length) throw new Error('CBOR: cut short'); return this.u8[this.p++]; }
  private len(info: number): number {
    if (info < 24) return info;
    if (info === 24) return this.byte();
    if (info === 25) return (this.byte() << 8) | this.byte();
    if (info === 26) return ((this.byte() << 24) >>> 0) + ((this.byte() << 16) | (this.byte() << 8) | this.byte());
    if (info === 27) { let n = 0; for (let i = 0; i < 8; i++) n = n * 256 + this.byte(); return n; }
    if (info === 31) return -1;
    throw new Error('CBOR: bad length');
  }
  item(): CborValue {
    const b = this.byte(), major = b >> 5, info = b & 31;
    switch (major) {
      case 0: return this.len(info);
      case 1: return -1 - this.len(info);
      case 2: { const n = this.len(info); if (n < 0) { const parts: number[] = []; for (;;) { const c = this.u8[this.p]; if (c === 0xff) { this.p++; break; } const s = this.item() as Uint8Array; parts.push(...s); } return new Uint8Array(parts); } const v = this.u8.subarray(this.p, this.p + n); this.p += n; return new Uint8Array(v); }
      case 3: { const n = this.len(info); if (n < 0) { let s = ''; for (;;) { if (this.u8[this.p] === 0xff) { this.p++; break; } s += this.item(); } return s; } const v = new TextDecoder().decode(this.u8.subarray(this.p, this.p + n)); this.p += n; return v; }
      case 4: { const n = this.len(info), a: CborValue[] = []; if (n < 0) { while (this.u8[this.p] !== 0xff) a.push(this.item()); this.p++; } else for (let i = 0; i < n; i++) a.push(this.item()); return a; }
      case 5: {
        const n = this.len(info), entries: [CborValue, CborValue][] = [];
        if (n < 0) { while (this.u8[this.p] !== 0xff) { const k = this.item(); entries.push([k, this.item()]); } this.p++; } else for (let i = 0; i < n; i++) { const k = this.item(); entries.push([k, this.item()]); }
        if (entries.every(([k]) => typeof k === 'string')) { const o: Record<string, CborValue> = {}; for (const [k, v] of entries) o[k as string] = v; return o; }
        return new Map(entries);
      }
      case 6: { const tag = this.len(info); return new Tagged(tag, this.item()); }
      default: {
        if (info === 20) return false; if (info === 21) return true; if (info === 22 || info === 23) return null;
        if (info === 25) { const h = (this.byte() << 8) | this.byte(); const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 31, f = h & 1023; return e === 0 ? s * f * 2 ** -24 : e === 31 ? (f ? NaN : s * Infinity) : s * (1 + f / 1024) * 2 ** (e - 15); }
        if (info === 26) { const v = new DataView(this.u8.buffer, this.u8.byteOffset + this.p, 4).getFloat32(0); this.p += 4; return v; }
        if (info === 27) { const v = new DataView(this.u8.buffer, this.u8.byteOffset + this.p, 8).getFloat64(0); this.p += 8; return v; }
        throw new Error('CBOR: unsupported simple value');
      }
    }
  }
}
