import { Ppmd7, RangeRar } from './ppmd';

/**
 * RAR decompression of the app's own: the RAR 1.5 and 2.0 coders (multimedia blocks included), the RAR 2.9
 * (RAR 3.x/4.x archives) and RAR 5.0 LZ coders with their
 * standard filters (x86 E8/E8E9, Itanium, delta, RGB and audio for 2.9; E8, E8E9, ARM and delta for 5.0),
 * solid streams (the window, tables and recent distances carry over from file to file) and RAR's
 * circular window with filtered blocks written in order. Written for Anne's Lens; it contains no RARLAB
 * (unRAR) code. PPMd blocks (RAR 2.9 text compression) use ppmd.ts.
 */

export class RarError extends Error {}

// Bit input over one file's packed data, most significant bit first; bytes past the end read as zero.
class Bits {
  addr = 0; bit = 0;
  constructor(public b: Uint8Array) {}
  private byte(i: number): number { return i < this.b.length ? this.b[i] : 0; }
  get16(): number { const a = this.addr; return (((this.byte(a) << 16) | (this.byte(a + 1) << 8) | this.byte(a + 2)) >>> (8 - this.bit)) & 0xffff; }
  get32(): number { const a = this.addr; const v = ((this.byte(a) << 24) | (this.byte(a + 1) << 16) | (this.byte(a + 2) << 8) | this.byte(a + 3)) >>> 0; return this.bit ? ((v << this.bit) | (this.byte(a + 4) >>> (8 - this.bit))) >>> 0 : v; }
  add(n: number): void { n += this.bit; this.addr += n >> 3; this.bit = n & 7; }
  align(): void { if (this.bit) { this.addr++; this.bit = 0; } }
  get over(): boolean { return this.addr > this.b.length; }
}

/** Canonical Huffman table (codes up to 15 bits), decoded the way RAR does: limits on left-aligned 16-bit values. */
class Huff {
  limit = new Uint32Array(16); pos = new Uint32Array(16); num: Uint16Array; quickLen = new Uint8Array(1 << 10); quickNum = new Uint16Array(1 << 10);
  constructor(lens: ArrayLike<number>, off: number, n: number) {
    const count = new Uint32Array(16);
    for (let i = 0; i < n; i++) count[lens[off + i] & 15]++;
    count[0] = 0;
    let upper = 0;
    for (let i = 1; i < 16; i++) { upper += count[i]; this.limit[i] = Math.min(upper << (16 - i), 0x10000); upper *= 2; }
    const start = new Uint32Array(16);
    for (let i = 1; i < 16; i++) { this.pos[i] = this.pos[i - 1] + count[i - 1]; start[i] = this.pos[i]; }
    this.num = new Uint16Array(n);
    for (let i = 0; i < n; i++) { const l = lens[off + i] & 15; if (l) this.num[start[l]++] = i; }
    // A 10-bit quick table.
    for (let code = 0; code < 1 << 10; code++) {
      const field = code << 6; let bits = 1;
      while (bits < 16 && field >= this.limit[bits]) bits++;
      if (bits > 10) { this.quickLen[code] = 0; continue; }
      const dist = (field - (bits > 1 ? this.limit[bits - 1] : 0)) >>> (16 - bits);
      const p = this.pos[bits] + dist;
      this.quickLen[code] = bits; this.quickNum[code] = p < n ? this.num[p] : 0;
    }
  }
  decode(inp: Bits): number {
    const field = inp.get16() & 0xfffe, q = field >>> 6;
    if (this.quickLen[q]) { inp.add(this.quickLen[q]); return this.quickNum[q]; }
    let bits = 11;
    while (bits < 15 && field >= this.limit[bits]) bits++;
    inp.add(bits);
    const p = this.pos[bits] + ((field - this.limit[bits - 1]) >>> (16 - bits));
    return p < this.num.length ? this.num[p] : 0;
  }
}

/** Reads the 20-entry bit-length table, then `size` code lengths (deltas on `old` for RAR 2.9). */
function readLengths(inp: Bits, size: number, old: Uint8Array | null): Uint8Array {
  const bl = new Uint8Array(20);
  for (let i = 0; i < 20; i++) {
    const len = inp.get16() >>> 12; inp.add(4);
    if (len === 15) {
      let zeros = inp.get16() >>> 12; inp.add(4);
      if (zeros === 0) bl[i] = 15; else { zeros += 2; while (zeros-- > 0 && i < 20) bl[i++] = 0; i--; }
    } else bl[i] = len;
  }
  const bd = new Huff(bl, 0, 20), t = new Uint8Array(size);
  for (let i = 0; i < size;) {
    if (inp.over) throw new RarError('The compressed data ends inside a table');
    const n = bd.decode(inp);
    if (n < 16) { t[i] = old ? (n + old[i]) & 15 : n; i++; }
    else if (n < 18) {
      let c: number; if (n === 16) { c = (inp.get16() >>> 13) + 3; inp.add(3); } else { c = (inp.get16() >>> 9) + 11; inp.add(7); }
      if (i === 0) throw new RarError('Damaged Huffman table');
      while (c-- > 0 && i < size) { t[i] = t[i - 1]; i++; }
    } else {
      let c: number; if (n === 18) { c = (inp.get16() >>> 13) + 3; inp.add(3); } else { c = (inp.get16() >>> 9) + 11; inp.add(7); }
      while (c-- > 0 && i < size) t[i++] = 0;
    }
  }
  return t;
}

let CRC_TABLE: Uint32Array | null = null;
export function crc32(u8: Uint8Array, crc = 0): number {
  if (!CRC_TABLE) { CRC_TABLE = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; } }
  let c = ~crc;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}

/** The shared machinery: circular window, output with the file's size, and the window size rule. */
abstract class Unpacker {
  win: Uint8Array = new Uint8Array(0); mask = 0;
  unpPtr = 0; wrPtr = 0;
  out: Uint8Array = new Uint8Array(0); outPos = 0; written = 0; // `written` counts as RAR does (also past the file size)
  oldDist = [0, 0, 0, 0]; lastLength = 0;
  /** Windows only grow (at least 256 KB); a solid stream cannot ask for a larger one. */
  protected window(dict: number, solid: boolean): void {
    const size = Math.max(0x40000, dict);
    if (size <= this.win.length) return;
    if (solid && this.win.length) throw new RarError('A solid file asks for a larger dictionary than the files before it');
    if (size > 0x40000000) throw new RarError(`The archive uses a ${Math.round(size / 1048576)} MB dictionary, more than Anne's Lens unpacks`);
    this.win = new Uint8Array(size); this.mask = size - 1;
  }
  protected put(data: Uint8Array): void {
    const left = this.out.length - this.outPos;
    if (left > 0) { const n = Math.min(left, data.length); this.out.set(n === data.length ? data : data.subarray(0, n), this.outPos); this.outPos += n; }
    this.written += data.length;
  }
  protected writeArea(start: number, end: number): void {
    if (end !== start) {
      if (end < start) { this.put(this.win.subarray(start)); this.put(this.win.subarray(0, end)); }
      else this.put(this.win.subarray(start, end));
    }
  }
  protected copyString(length: number, distance: number): void {
    const w = this.win, m = this.mask; let p = this.unpPtr, s = (p - distance) & m;
    for (let i = 0; i < length; i++) { w[p] = w[s]; p = (p + 1) & m; s = (s + 1) & m; }
    this.unpPtr = p;
  }
  protected insertOldDist(d: number): void { const o = this.oldDist; o[3] = o[2]; o[2] = o[1]; o[1] = o[0]; o[0] = d; }
  protected windowBlock(start: number, length: number): Uint8Array {
    const end = (start + length) & this.mask, mem = new Uint8Array(length);
    if (start < end || end === 0) mem.set(this.win.subarray(start, start + length));
    else { const first = this.win.length - start; mem.set(this.win.subarray(start)); mem.set(this.win.subarray(0, end), first); }
    return mem;
  }
}

// x86 call/jump addresses made absolute by the compressor.
function e8(data: Uint8Array, fileOffset: number, e9: boolean, mod: boolean): void {
  const FILE_SIZE = 0x1000000, n = data.length;
  for (let pos = 0; pos + 4 < n;) {
    const b = data[pos++];
    if (b === 0xe8 || (e9 && b === 0xe9)) {
      const offset = mod ? (pos + fileOffset) % FILE_SIZE : (pos + fileOffset) >>> 0;
      const addr = (data[pos] | (data[pos + 1] << 8) | (data[pos + 2] << 16) | (data[pos + 3] << 24)) >>> 0;
      let v: number | null = null;
      if (addr & 0x80000000) { if (!(((addr + offset) >>> 0) & 0x80000000)) v = (addr + FILE_SIZE) >>> 0; }
      else if (((addr - FILE_SIZE) >>> 0) & 0x80000000) v = (addr - offset) >>> 0;
      if (v !== null) { data[pos] = v & 255; data[pos + 1] = (v >>> 8) & 255; data[pos + 2] = (v >>> 16) & 255; data[pos + 3] = v >>> 24; }
      pos += 4;
    }
  }
}
function delta(src: Uint8Array, channels: number): Uint8Array {
  const n = src.length, dst = new Uint8Array(n); let s = 0;
  for (let c = 0; c < channels; c++) { let prev = 0; for (let d = c; d < n; d += channels) dst[d] = prev = (prev - src[s++]) & 255; }
  return dst;
}

// RAR 2.9 ---------------------------------------------------------------------------------------------
const NC3 = 299, DC3 = 60, LDC3 = 17, RC3 = 28, TABLE3 = NC3 + DC3 + LDC3 + RC3;
const LDECODE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224];
const LBITS = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5];
const DDECODE = new Uint32Array(DC3), DBITS = new Uint8Array(DC3);
{ const counts = [4, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 14, 0, 12]; let slot = 0, dist = 0; counts.forEach((c, bits) => { for (let j = 0; j < c; j++, slot++, dist += 1 << bits) { DDECODE[slot] = dist; DBITS[slot] = bits; } }); }
const SDDECODE = [0, 4, 8, 16, 32, 64, 128, 192], SDBITS = [2, 2, 3, 4, 5, 6, 6, 6];
// Standard VM filters, recognized by the length and CRC-32 of their byte code.
const STD_FILTERS: Record<string, string> = { '53:ad576887': 'e8', '57:3cd7e57e': 'e8e9', '120:3769893f': 'itanium', '29:0e06077d': 'delta', '149:1c2c5dc8': 'rgb', '216:bc85e701': 'audio' };
interface Filter3 { type: string; blockStart: number; blockLength: number; nextWindow: boolean; r: number[]; parent: number }

/** Reads VM-style numbers from a filter record. */
function vmData(b: Bits): number {
  const d = b.get16();
  switch (d & 0xc000) {
    case 0: b.add(6); return (d >>> 10) & 15;
    case 0x4000: if ((d & 0x3c00) === 0) { b.add(14); return (0xffffff00 | ((d >>> 2) & 0xff)) >>> 0; } b.add(10); return (d >>> 6) & 0xff;
    case 0x8000: { b.add(2); const v = b.get16(); b.add(16); return v; }
    default: { b.add(2); const hi = b.get16(); b.add(16); const lo = b.get16(); b.add(16); return ((hi << 16) | lo) >>> 0; }
  }
}

export class Unpack3 extends Unpacker {
  private inp = new Bits(new Uint8Array(0));
  private ld!: Huff; private dd!: Huff; private ldd!: Huff; private rd!: Huff;
  private oldTable = new Uint8Array(TABLE3); private tablesRead = false;
  private prevLowDist = 0; private lowDistRep = 0;
  private filters: { type: string }[] = []; private oldFilterLengths: number[] = []; private lastFilter = 0; private stack: (Filter3 | null)[] = [];
  private ppm = false;
  private model: Ppmd7 | null = null; private rc: RangeRar | null = null; private escChar = 2;

  unpack(packed: Uint8Array, size: number, dict: number, solid: boolean): Uint8Array {
    this.window(dict, solid);
    this.out = new Uint8Array(size); this.outPos = 0; this.written = 0;
    this.inp = new Bits(packed);
    if (!solid) {
      this.oldDist = [0, 0, 0, 0]; this.lastLength = 0; this.unpPtr = this.wrPtr = 0;
      this.tablesRead = false; this.oldTable.fill(0); this.ppm = false; this.escChar = 2;
      this.filters = []; this.oldFilterLengths = []; this.lastFilter = 0;
    }
    this.stack = [];
    if (!solid || !this.tablesRead) this.readTables();
    const inp = this.inp;
    for (;;) {
      this.unpPtr &= this.mask;
      if (inp.over) break;
      if (((this.wrPtr - this.unpPtr) & this.mask) < 260 && this.wrPtr !== this.unpPtr) this.writeBuf();
      if (this.ppm) { if (!this.ppmStep()) break; continue; }
      const n = this.ld.decode(inp);
      if (n < 256) { this.win[this.unpPtr++] = n; continue; }
      if (n >= 271) {
        const ln = n - 271; let length = LDECODE[ln] + 3; let bits = LBITS[ln];
        if (bits > 0) { length += inp.get16() >>> (16 - bits); inp.add(bits); }
        const dn = this.dd.decode(inp); let distance = DDECODE[dn] + 1; bits = DBITS[dn];
        if (bits > 0) {
          if (dn > 9) {
            if (bits > 4) { distance += (inp.get16() >>> (20 - bits)) << 4; inp.add(bits - 4); }
            if (this.lowDistRep > 0) { this.lowDistRep--; distance += this.prevLowDist; }
            else {
              const low = this.ldd.decode(inp);
              if (low === 16) { this.lowDistRep = 15; distance += this.prevLowDist; } else { distance += low; this.prevLowDist = low; }
            }
          } else { distance += inp.get16() >>> (16 - bits); inp.add(bits); }
        }
        if (distance >= 0x2000) { length++; if (distance >= 0x40000) length++; }
        this.insertOldDist(distance); this.lastLength = length; this.copyString(length, distance);
        continue;
      }
      if (n === 256) { if (!this.endOfBlock()) break; continue; }
      if (n === 257) { this.readVmCode(); continue; }
      if (n === 258) { if (this.lastLength) this.copyString(this.lastLength, this.oldDist[0]); continue; }
      if (n < 263) {
        const k = n - 259, distance = this.oldDist[k];
        for (let i = k; i > 0; i--) this.oldDist[i] = this.oldDist[i - 1];
        this.oldDist[0] = distance;
        const ln = this.rd.decode(inp); let length = LDECODE[ln] + 2; const bits = LBITS[ln];
        if (bits > 0) { length += inp.get16() >>> (16 - bits); inp.add(bits); }
        this.lastLength = length; this.copyString(length, distance);
        continue;
      }
      { // 263…270: short distances, length 2
        const k = n - 263; let distance = SDDECODE[k] + 1; const bits = SDBITS[k];
        if (bits > 0) { distance += inp.get16() >>> (16 - bits); inp.add(bits); }
        this.insertOldDist(distance); this.lastLength = 2; this.copyString(2, distance);
      }
    }
    this.writeBuf();
    return this.out;
  }
  get produced(): number { return this.outPos; }

  private readTables(): void {
    const inp = this.inp; inp.align();
    const field = inp.get16();
    if (field & 0x8000) { this.ppm = true; this.ppmInit(); return; }
    this.ppm = false; this.prevLowDist = 0; this.lowDistRep = 0;
    if (!(field & 0x4000)) this.oldTable.fill(0);
    inp.add(2);
    const t = readLengths(inp, TABLE3, this.oldTable);
    this.ld = new Huff(t, 0, NC3); this.dd = new Huff(t, NC3, DC3); this.ldd = new Huff(t, NC3 + DC3, LDC3); this.rd = new Huff(t, NC3 + DC3 + LDC3, RC3);
    this.oldTable.set(t); this.tablesRead = true;
  }
  // PPMd blocks: the model's flags byte (order, reset, memory, escape character), then range-coded symbols.
  private byte(): number { const b = this.inp.addr < this.inp.b.length ? this.inp.b[this.inp.addr] : 0; this.inp.addr++; return b; }
  private ppmInit(): void {
    const flags = this.byte(), reset = !!(flags & 0x20);
    let maxMB = 0;
    if (reset) maxMB = this.byte(); else if (!this.model) throw new RarError('Damaged PPMd data (no model to continue)');
    if (flags & 0x40) this.escChar = this.byte();
    this.rc = new RangeRar(() => this.byte());
    if (reset) {
      let order = (flags & 0x1f) + 1;
      if (order > 16) order = 16 + (order - 16) * 3;
      if (order === 1) { this.model = null; throw new RarError('Damaged PPMd data (order 1)'); }
      const size = (maxMB + 1) * 1048576;
      if (!this.model || this.model.memSize !== size) this.model = new Ppmd7(size);
      this.model.init(order);
    }
  }
  private ppmChar(): number { const c = this.model!.decodeSymbol(this.rc!); if (c < 0) { this.ppm = false; return -1; } return c; }
  /** One PPMd step: a literal, or an escape (new tables, end of file, filter, match). False ends the file. */
  private ppmStep(): boolean {
    const ch = this.ppmChar();
    if (ch === -1) return false; // as RAR does: the file ends here, and its CRC tells whether that was right
    if (ch === this.escChar) {
      const next = this.ppmChar();
      if (next === 0) { this.readTables(); return true; }
      if (next === -1 || next === 2) return false;
      if (next === 3) {
        const first = this.ppmChar(); if (first < 0) return false;
        let length = (first & 7) + 1;
        if (length === 7) { const b = this.ppmChar(); if (b < 0) return false; length = b + 7; }
        else if (length === 8) { const b1 = this.ppmChar(), b2 = b1 < 0 ? -1 : this.ppmChar(); if (b2 < 0) return false; length = b1 * 256 + b2; }
        if (!length) return false;
        const code = new Uint8Array(length);
        for (let i = 0; i < length; i++) { const c = this.ppmChar(); if (c < 0) return false; code[i] = c; }
        this.addVmCode(first, code); return true;
      }
      if (next === 4) {
        let distance = 0, length = 0;
        for (let i = 0; i < 4; i++) { const c = this.ppmChar(); if (c < 0) return false; if (i === 3) length = c; else distance = distance * 256 + c; }
        this.copyString(length + 32, distance + 2); return true;
      }
      if (next === 5) { const length = this.ppmChar(); if (length < 0) return false; this.copyString(length + 4, 1); return true; }
      // 1, or anything else: the escape character itself
    }
    this.win[this.unpPtr++] = ch;
    return true;
  }
  /** "1": new table here; "00": end of file; "01": end of file, new table at the start of the next. */
  private endOfBlock(): boolean {
    const f = this.inp.get16(); let newTable: boolean, newFile = false;
    if (f & 0x8000) { newTable = true; this.inp.add(1); } else { newFile = true; newTable = !!(f & 0x4000); this.inp.add(2); }
    this.tablesRead = !newTable;
    if (newFile) return false;
    this.readTables(); return true;
  }
  private readVmCode(): void {
    const inp = this.inp, first = inp.get16() >>> 8; inp.add(8);
    let length = (first & 7) + 1;
    if (length === 7) { length = (inp.get16() >>> 8) + 7; inp.add(8); } else if (length === 8) { length = inp.get16(); inp.add(16); }
    if (!length) throw new RarError('Damaged filter record');
    const code = new Uint8Array(length);
    for (let i = 0; i < length; i++) { code[i] = inp.get16() >>> 8; inp.add(8); }
    this.addVmCode(first, code);
  }
  private addVmCode(first: number, code: Uint8Array): void {
    const b = new Bits(code);
    let pos: number;
    if (first & 0x80) { pos = vmData(b); if (pos === 0) { this.filters = []; this.oldFilterLengths = []; } else pos--; }
    else pos = this.lastFilter;
    if (pos > this.filters.length || pos > this.oldFilterLengths.length) throw new RarError('Damaged filter record');
    this.lastFilter = pos;
    const isNew = pos === this.filters.length;
    if (isNew) { if (pos > 1024) throw new RarError('Too many filters'); this.filters.push({ type: '' }); this.oldFilterLengths.push(0); }
    // Reuse an empty slot of the pending list, as RAR does.
    const live = this.stack.filter((f) => f); this.stack = live;
    if (this.stack.length > 1024) throw new RarError('Too many filters');
    let start = vmData(b); if (first & 0x40) start += 258;
    const f: Filter3 = { type: '', blockStart: (start + this.unpPtr) & this.mask, blockLength: 0, nextWindow: false, r: [0, 0, 0, 0, 0, 0, 0], parent: pos };
    if (first & 0x20) { f.blockLength = vmData(b); this.oldFilterLengths[pos] = f.blockLength; }
    else f.blockLength = pos < this.oldFilterLengths.length ? this.oldFilterLengths[pos] : 0;
    f.nextWindow = this.wrPtr !== this.unpPtr && ((this.wrPtr - this.unpPtr) & this.mask) <= start;
    f.r[4] = f.blockLength;
    if (first & 0x10) { const initMask = b.get16() >>> 9; b.add(7); for (let i = 0; i < 7; i++) if (initMask & (1 << i)) f.r[i] = vmData(b); }
    if (isNew) {
      const size = vmData(b);
      if (size >= 0x10000 || size === 0 || b.addr + size > code.length + 1) throw new RarError('Damaged filter record');
      const prg = new Uint8Array(size); for (let i = 0; i < size; i++) { prg[i] = b.get16() >>> 8; b.add(8); }
      let xor = 0; for (let i = 1; i < size; i++) xor ^= prg[i];
      const type = xor === prg[0] ? STD_FILTERS[`${size}:${crc32(prg).toString(16).padStart(8, '0')}`] : undefined;
      if (!type) throw new RarError('The archive uses a filter program Anne\'s Lens does not run');
      this.filters[pos].type = type;
    }
    f.type = this.filters[pos].type;
    this.stack.push(f); // global data (first & 8) is not used by the standard filters
  }
  private run(f: Filter3, mem: Uint8Array): Uint8Array {
    const r = f.r.slice(); r[6] = this.written >>> 0;
    const n = r[4] >>> 0, data = n <= mem.length ? mem.subarray(0, n) : mem;
    switch (f.type) {
      case 'e8': case 'e8e9': { if (n > 0x40000 || n < 4) throw new RarError('Damaged filter'); const d = data.slice(); e8(d, r[6], f.type === 'e8e9', false); return d; }
      case 'itanium': { if (n > 0x40000 || n < 21) throw new RarError('Damaged filter'); const d = data.slice(); itanium(d, r[6]); return d; }
      case 'delta': { if (n > 0x20000 || r[0] > 1024 || r[0] === 0) throw new RarError('Damaged filter'); return delta(data, r[0]); }
      case 'rgb': { if (n > 0x20000 || n < 3 || r[0] - 3 > n || r[1] > 2) throw new RarError('Damaged filter'); return rgb(data, r[0] - 3, r[1]); }
      case 'audio': { if (n > 0x20000 || r[0] > 128 || r[0] === 0) throw new RarError('Damaged filter'); return audio(data, r[0]); }
    }
    throw new RarError('Unknown filter');
  }
  private writeBuf(): void {
    let border = this.wrPtr, size = (this.unpPtr - border) & this.mask;
    const st = this.stack;
    for (let i = 0; i < st.length; i++) {
      const f = st[i]; if (!f) continue;
      if (f.nextWindow) { f.nextWindow = false; continue; }
      const start = f.blockStart, length = f.blockLength;
      if (((start - border) & this.mask) < size) {
        if (border !== start) { this.writeArea(border, start); border = start; size = (this.unpPtr - border) & this.mask; }
        if (length <= size) {
          const end = (start + length) & this.mask;
          let data = this.run(f, this.windowBlock(start, length));
          st[i] = null;
          while (i + 1 < st.length) { // several filters on one block
            const g = st[i + 1];
            if (!g || g.blockStart !== start || g.blockLength !== data.length || g.nextWindow) break;
            data = this.run(g, data); i++; st[i] = null;
          }
          this.put(data);
          border = end; size = (this.unpPtr - border) & this.mask;
        } else {
          for (let j = i; j < st.length; j++) { const g = st[j]; if (g && g.nextWindow) g.nextWindow = false; }
          this.wrPtr = border; return;
        }
      }
    }
    this.writeArea(border, this.unpPtr);
    this.wrPtr = this.unpPtr;
  }
}

function itanium(d: Uint8Array, fileOffset: number): void {
  const MASKS = [4, 4, 6, 6, 0, 0, 7, 7, 4, 4, 0, 0, 4, 4, 0, 0];
  const get = (o: number, pos: number, count: number) => { const a = o + (pos >> 3); const v = ((d[a] | (d[a + 1] << 8) | (d[a + 2] << 16) | (d[a + 3] << 24)) >>> (pos & 7)) >>> 0; return v & (0xffffffff >>> (32 - count)); };
  const set = (o: number, value: number, pos: number, count: number) => {
    const a = o + (pos >> 3), sh = pos & 7; let and = ~(((0xffffffff >>> (32 - count)) << sh) >>> 0) >>> 0; let v = (value << sh) >>> 0;
    for (let i = 0; i < 4; i++) { d[a + i] = (d[a + i] & and) | (v & 255); and = ((and >>> 8) | 0xff000000) >>> 0; v >>>= 8; }
  };
  let off = fileOffset >>> 4;
  for (let o = 0; o < d.length - 21; o += 16, off++) {
    const b = (d[o] & 0x1f) - 0x10;
    if (b < 0) continue;
    const mask = MASKS[b];
    if (mask) for (let i = 0; i <= 2; i++) if (mask & (1 << i)) {
      const start = i * 41 + 5;
      if (get(o, start + 37, 4) === 5) set(o, (get(o, start + 13, 20) - off) & 0xfffff, start + 13, 20);
    }
  }
}
function rgb(src: Uint8Array, width: number, posR: number): Uint8Array {
  const n = src.length, dst = new Uint8Array(n); let s = 0;
  for (let c = 0; c < 3; c++) {
    let prev = 0;
    for (let i = c; i < n; i += 3) {
      let predicted = prev;
      if (i >= width + 3) {
        const up = dst[i - width], upLeft = dst[i - width - 3];
        predicted = prev + up - upLeft;
        const pa = Math.abs(predicted - prev), pb = Math.abs(predicted - up), pc = Math.abs(predicted - upLeft);
        predicted = pa <= pb && pa <= pc ? prev : pb <= pc ? up : upLeft;
      }
      dst[i] = prev = (predicted - src[s++]) & 255;
    }
  }
  for (let i = posR; i < n - 2; i += 3) { const g = dst[i + 1]; dst[i] = (dst[i] + g) & 255; dst[i + 2] = (dst[i + 2] + g) & 255; }
  return dst;
}
function audio(src: Uint8Array, channels: number): Uint8Array {
  const n = src.length, dst = new Uint8Array(n); let s = 0;
  const sb = (v: number) => ((v & 255) << 24) >> 24;
  for (let c = 0; c < channels; c++) {
    let prev = 0, prevDelta = 0, d1 = 0, d2 = 0, d3 = 0, k1 = 0, k2 = 0, k3 = 0; const dif = new Array(7).fill(0);
    for (let i = c, count = 0; i < n; i += channels, count++) {
      d3 = d2; d2 = prevDelta - d1; d1 = prevDelta;
      let predicted = ((((8 * prev + k1 * d1 + k2 * d2 + k3 * d3) >>> 0) >>> 3) & 0xff);
      const cur = src[s++];
      predicted = (predicted - cur) & 255;
      dst[i] = predicted;
      prevDelta = sb(predicted - prev); prev = predicted;
      const d = sb(cur) * 8;
      dif[0] += Math.abs(d); dif[1] += Math.abs(d - d1); dif[2] += Math.abs(d + d1); dif[3] += Math.abs(d - d2); dif[4] += Math.abs(d + d2); dif[5] += Math.abs(d - d3); dif[6] += Math.abs(d + d3);
      if ((count & 0x1f) === 0) {
        let min = dif[0], which = 0; dif[0] = 0;
        for (let j = 1; j < 7; j++) { if (dif[j] < min) { min = dif[j]; which = j; } dif[j] = 0; }
        switch (which) { case 1: if (k1 >= -16) k1--; break; case 2: if (k1 < 16) k1++; break; case 3: if (k2 >= -16) k2--; break; case 4: if (k2 < 16) k2++; break; case 5: if (k3 >= -16) k3--; break; case 6: if (k3 < 16) k3++; break; }
      }
    }
  }
  return dst;
}

// RAR 1.5 and 2.0 ------------------------------------------------------------------------------------
// RAR 1.5: adaptive symbol rankings with fixed prefix codes; RAR 2.0: Huffman LZ, and multimedia blocks
// that predict audio samples. Both stop after the file's size and carry state into the next solid file.
const DEC_L1 = [0x8000, 0xa000, 0xc000, 0xd000, 0xe000, 0xea00, 0xee00, 0xf000, 0xf200, 0xf200, 0xffff], POS_L1 = [0, 0, 0, 2, 3, 5, 7, 11, 16, 20, 24, 32, 32];
const DEC_L2 = [0xa000, 0xc000, 0xd000, 0xe000, 0xea00, 0xee00, 0xf000, 0xf200, 0xf240, 0xffff], POS_L2 = [0, 0, 0, 0, 5, 7, 9, 13, 18, 22, 26, 34, 36];
const DEC_HF0 = [0x8000, 0xc000, 0xe000, 0xf200, 0xf200, 0xf200, 0xf200, 0xf200, 0xffff], POS_HF0 = [0, 0, 0, 0, 0, 8, 16, 24, 33, 33, 33, 33, 33];
const DEC_HF1 = [0x2000, 0xc000, 0xe000, 0xf000, 0xf200, 0xf200, 0xf7e0, 0xffff], POS_HF1 = [0, 0, 0, 0, 0, 0, 4, 44, 60, 76, 80, 80, 127];
const DEC_HF2 = [0x1000, 0x2400, 0x8000, 0xc000, 0xfa00, 0xffff, 0xffff, 0xffff], POS_HF2 = [0, 0, 0, 0, 0, 0, 2, 7, 53, 117, 233, 0, 0];
const DEC_HF3 = [0x800, 0x2400, 0xee00, 0xfe80, 0xffff, 0xffff, 0xffff], POS_HF3 = [0, 0, 0, 0, 0, 0, 0, 2, 16, 218, 251, 0, 0];
const DEC_HF4 = [0xff00, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff], POS_HF4 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0];
const SHORT_LEN1 = [1, 3, 4, 4, 5, 6, 7, 8, 8, 4, 4, 5, 6, 6, 4, 0], SHORT_XOR1 = [0, 0xa0, 0xd0, 0xe0, 0xf0, 0xf8, 0xfc, 0xfe, 0xff, 0xc0, 0x80, 0x90, 0x98, 0x9c, 0xb0];
const SHORT_LEN2 = [2, 3, 3, 3, 4, 4, 5, 6, 6, 4, 4, 5, 6, 6, 4, 0], SHORT_XOR2 = [0, 0x40, 0x60, 0xa0, 0xd0, 0xe0, 0xf0, 0xf8, 0xfc, 0xc0, 0x80, 0x90, 0x98, 0x9c, 0xb0];
const NC2 = 298, DC2 = 48, RC2 = 28, BC2 = 19, MC2 = 257;
const DDECODE2 = [0, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512, 768, 1024, 1536, 2048, 3072, 4096, 6144, 8192, 12288, 16384, 24576, 32768, 49152, 65536, 98304, 131072, 196608, 262144, 327680, 393216, 458752, 524288, 589824, 655360, 720896, 786432, 851968, 917504, 983040];
const DBITS2 = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16];
interface Audio { k: number[]; d: number[]; lastDelta: number; lastChar: number; dif: number[]; count: number }
const newAudio = (): Audio => ({ k: [0, 0, 0, 0, 0], d: [0, 0, 0, 0], lastDelta: 0, lastChar: 0, dif: new Array(11).fill(0), count: 0 });

export class UnpackOld extends Unpacker {
  private inp = new Bits(new Uint8Array(0)); private left = 0; // bytes still to produce, minus one (RAR's DestUnpSize)
  // 1.5
  private chSet = new Uint16Array(256); private chSetA = new Uint16Array(256); private chSetB = new Uint16Array(256); private chSetC = new Uint16Array(256);
  private nToPl = new Uint8Array(256); private nToPlB = new Uint8Array(256); private nToPlC = new Uint8Array(256);
  private avrPlc = 0; private avrPlcB = 0; private avrLn1 = 0; private avrLn2 = 0; private avrLn3 = 0; private numHuf = 0; private buf60 = 0; private maxDist3 = 0; private nhfb = 0; private nlzb = 0;
  private flagsCnt = 0; private flagBuf = 0; private stMode = 0; private lCount = 0; private lastDist = 0; private oldDistPtr = 0;
  // 2.0
  private tablesRead = false; private audio = false; private channels = 1; private curChannel = 0; private channelDelta = 0;
  private aud: Audio[] = [newAudio(), newAudio(), newAudio(), newAudio()]; private oldTable = new Uint8Array(MC2 * 4);
  private ld!: Huff; private dd!: Huff; private rd!: Huff; private md: Huff[] = [];

  unpack(packed: Uint8Array, size: number, dict: number, solid: boolean, version: number): Uint8Array {
    this.window(dict, solid);
    this.out = new Uint8Array(size); this.outPos = 0; this.written = 0;
    this.inp = new Bits(packed);
    if (!solid) { this.oldDist = [0, 0, 0, 0]; this.oldDistPtr = 0; this.lastDist = 0; this.lastLength = 0; this.unpPtr = this.wrPtr = 0; this.win.fill(0); }
    this.left = size - 1;
    if (version < 20) this.unpack15(solid); else this.unpack20(solid);
    this.writeOld();
    return this.out;
  }
  private writeOld(): void { this.writeArea(this.wrPtr, this.unpPtr & this.mask); this.wrPtr = this.unpPtr & this.mask; }
  private copy15(distance: number, length: number): void {
    this.left -= length;
    if (distance === 0 || distance > this.win.length) { for (let i = 0; i < length; i++) { this.win[this.unpPtr] = 0; this.unpPtr = (this.unpPtr + 1) & this.mask; } }
    else this.copyString(length, distance);
  }
  private decodeNum(num: number, start: number, dec: number[], pos: number[]): number {
    num &= 0xfff0; let i = 0;
    for (; dec[i] <= num; i++) start++;
    this.inp.add(start);
    return ((num - (i ? dec[i - 1] : 0)) >>> (16 - start)) + pos[start];
  }

  // RAR 1.5 ------------------------------------------------------------
  private unpack15(solid: boolean): void {
    if (!solid) {
      this.avrPlcB = this.avrLn1 = this.avrLn2 = this.avrLn3 = this.numHuf = this.buf60 = 0;
      this.avrPlc = 0x3500; this.maxDist3 = 0x2001; this.nhfb = this.nlzb = 0x80;
      for (let i = 0; i < 256; i++) { this.chSet[i] = this.chSetB[i] = i << 8; this.chSetA[i] = i; this.chSetC[i] = ((~i + 1) & 0xff) << 8; }
      this.nToPl.fill(0); this.nToPlB.fill(0); this.nToPlC.fill(0);
      this.corrHuff(this.chSetB, this.nToPlB);
    }
    this.flagsCnt = 0; this.flagBuf = 0; this.stMode = 0; this.lCount = 0;
    if (this.left >= 0) { this.getFlagsBuf(); this.flagsCnt = 8; }
    while (this.left >= 0) {
      this.unpPtr &= this.mask;
      if (this.inp.over) break;
      if (((this.wrPtr - this.unpPtr) & this.mask) < 270 && this.wrPtr !== this.unpPtr) this.writeOld();
      if (this.stMode) { this.huffDecode(); continue; }
      if (--this.flagsCnt < 0) { this.getFlagsBuf(); this.flagsCnt = 7; }
      if (this.flagBuf & 0x80) {
        this.flagBuf = (this.flagBuf << 1) & 0xff;
        if (this.nlzb > this.nhfb) this.longLZ(); else this.huffDecode();
      } else {
        this.flagBuf = (this.flagBuf << 1) & 0xff;
        if (--this.flagsCnt < 0) { this.getFlagsBuf(); this.flagsCnt = 7; }
        if (this.flagBuf & 0x80) { this.flagBuf = (this.flagBuf << 1) & 0xff; if (this.nlzb > this.nhfb) this.huffDecode(); else this.longLZ(); }
        else { this.flagBuf = (this.flagBuf << 1) & 0xff; this.shortLZ(); }
      }
    }
  }
  private corrHuff(set: Uint16Array, toPlace: Uint8Array): void {
    let k = 0;
    for (let i = 7; i >= 0; i--) for (let j = 0; j < 32; j++, k++) set[k] = (set[k] & ~0xff) | i;
    toPlace.fill(0);
    for (let i = 6; i >= 0; i--) toPlace[i] = (7 - i) * 32;
  }
  private getFlagsBuf(): void {
    const place = this.decodeNum(this.inp.get16(), 5, DEC_HF2, POS_HF2);
    if (place >= 256) return;
    let flags: number, newPlace: number;
    for (;;) {
      flags = this.chSetC[place]; this.flagBuf = flags >>> 8;
      newPlace = this.nToPlC[flags & 0xff]++; flags++;
      if (flags & 0xff) break;
      this.corrHuff(this.chSetC, this.nToPlC);
    }
    this.chSetC[place] = this.chSetC[newPlace]; this.chSetC[newPlace] = flags;
  }
  private shortLZ(): void {
    const inp = this.inp; this.numHuf = 0;
    let field = inp.get16();
    if (this.lCount === 2) {
      inp.add(1);
      if (field >= 0x8000) { this.copy15(this.lastDist, this.lastLength); return; }
      field = (field << 1) & 0xffff; this.lCount = 0;
    }
    field >>>= 8;
    let length = 0;
    if (this.avrLn1 < 37) {
      const len = (i: number) => (i === 1 ? this.buf60 + 3 : SHORT_LEN1[i]);
      for (; length < 15; length++) if (((field ^ SHORT_XOR1[length]) & ~(0xff >>> len(length)) & 0xff) === 0) break;
      inp.add(len(length));
    } else {
      const len = (i: number) => (i === 3 ? this.buf60 + 3 : SHORT_LEN2[i]);
      for (; length < 15; length++) if (((field ^ SHORT_XOR2[length]) & ~(0xff >>> len(length)) & 0xff) === 0) break;
      inp.add(len(length));
    }
    if (length >= 9) {
      if (length === 9) { this.lCount++; this.copy15(this.lastDist, this.lastLength); return; }
      if (length === 14) {
        this.lCount = 0;
        length = this.decodeNum(inp.get16(), 3, DEC_L2, POS_L2) + 5;
        const distance = (inp.get16() >>> 1) | 0x8000; inp.add(15);
        this.lastLength = length; this.lastDist = distance; this.copy15(distance, length); return;
      }
      this.lCount = 0;
      const save = length, distance = this.oldDist[(this.oldDistPtr - (length - 9)) & 3];
      length = this.decodeNum(inp.get16(), 2, DEC_L1, POS_L1) + 2;
      if (length === 0x101 && save === 10) { this.buf60 ^= 1; return; }
      if (distance > 256) length++;
      if (distance >= this.maxDist3) length++;
      this.oldDist[this.oldDistPtr++] = distance; this.oldDistPtr &= 3;
      this.lastLength = length; this.lastDist = distance; this.copy15(distance, length); return;
    }
    this.lCount = 0;
    this.avrLn1 += length; this.avrLn1 -= this.avrLn1 >>> 4;
    let place = this.decodeNum(inp.get16(), 5, DEC_HF2, POS_HF2) & 0xff;
    let distance = this.chSetA[place];
    if (--place !== -1) { this.chSetA[place + 1] = this.chSetA[place]; this.chSetA[place] = distance; }
    length += 2;
    this.oldDist[this.oldDistPtr++] = ++distance; this.oldDistPtr &= 3;
    this.lastLength = length; this.lastDist = distance; this.copy15(distance, length);
  }
  private longLZ(): void {
    const inp = this.inp; this.numHuf = 0;
    this.nlzb += 16; if (this.nlzb > 0xff) { this.nlzb = 0x90; this.nhfb >>>= 1; }
    const oldAvr2 = this.avrLn2;
    let field = inp.get16(), length: number;
    if (this.avrLn2 >= 122) length = this.decodeNum(field, 3, DEC_L2, POS_L2);
    else if (this.avrLn2 >= 64) length = this.decodeNum(field, 2, DEC_L1, POS_L1);
    else if (field < 0x100) { length = field; inp.add(16); }
    else { for (length = 0; ((field << length) & 0x8000) === 0; length++); inp.add(length + 1); }
    this.avrLn2 += length; this.avrLn2 -= this.avrLn2 >>> 5;
    field = inp.get16();
    let place: number;
    if (this.avrPlcB > 0x28ff) place = this.decodeNum(field, 5, DEC_HF2, POS_HF2);
    else if (this.avrPlcB > 0x6ff) place = this.decodeNum(field, 5, DEC_HF1, POS_HF1);
    else place = this.decodeNum(field, 4, DEC_HF0, POS_HF0);
    this.avrPlcB += place; this.avrPlcB -= this.avrPlcB >>> 8;
    let distance: number, newPlace: number;
    for (;;) {
      distance = this.chSetB[place & 0xff];
      newPlace = this.nToPlB[distance & 0xff]++; distance = (distance + 1) & 0xffff;
      if (!(distance & 0xff)) this.corrHuff(this.chSetB, this.nToPlB); else break;
    }
    this.chSetB[place & 0xff] = this.chSetB[newPlace]; this.chSetB[newPlace] = distance;
    distance = ((distance & 0xff00) | (inp.get16() >>> 8)) >>> 1; inp.add(7);
    const oldAvr3 = this.avrLn3;
    if (length !== 1 && length !== 4) {
      if (length === 0 && distance <= this.maxDist3) { this.avrLn3++; this.avrLn3 -= this.avrLn3 >>> 8; }
      else if (this.avrLn3 > 0) this.avrLn3--;
    }
    length += 3;
    if (distance >= this.maxDist3) length++;
    if (distance <= 256) length += 8;
    this.maxDist3 = oldAvr3 > 0xb0 || (this.avrPlc >= 0x2a00 && oldAvr2 < 0x40) ? 0x7f00 : 0x2001;
    this.oldDist[this.oldDistPtr++] = distance; this.oldDistPtr &= 3;
    this.lastLength = length; this.lastDist = distance; this.copy15(distance, length);
  }
  private huffDecode(): void {
    const inp = this.inp;
    let field = inp.get16(), place: number;
    if (this.avrPlc > 0x75ff) place = this.decodeNum(field, 8, DEC_HF4, POS_HF4);
    else if (this.avrPlc > 0x5dff) place = this.decodeNum(field, 6, DEC_HF3, POS_HF3);
    else if (this.avrPlc > 0x35ff) place = this.decodeNum(field, 5, DEC_HF2, POS_HF2);
    else if (this.avrPlc > 0x0dff) place = this.decodeNum(field, 5, DEC_HF1, POS_HF1);
    else place = this.decodeNum(field, 4, DEC_HF0, POS_HF0);
    place &= 0xff;
    if (this.stMode) {
      if (place === 0 && field > 0xfff) place = 0x100;
      if (--place === -1) {
        field = inp.get16(); inp.add(1);
        if (field & 0x8000) { this.numHuf = this.stMode = 0; return; }
        const length = field & 0x4000 ? 4 : 3; inp.add(1);
        let distance = this.decodeNum(inp.get16(), 5, DEC_HF2, POS_HF2);
        distance = (distance << 5) | (inp.get16() >>> 11); inp.add(5);
        this.copy15(distance, length); return;
      }
    } else if (this.numHuf++ >= 16 && this.flagsCnt === 0) this.stMode = 1;
    this.avrPlc += place; this.avrPlc -= this.avrPlc >>> 8;
    this.nhfb += 16; if (this.nhfb > 0xff) { this.nhfb = 0x90; this.nlzb >>>= 1; }
    this.win[this.unpPtr++] = this.chSet[place] >>> 8; this.left--;
    let cur: number, newPlace: number;
    for (;;) {
      cur = this.chSet[place];
      newPlace = this.nToPl[cur & 0xff]++; cur = (cur + 1) & 0xffff;
      if ((cur & 0xff) > 0xa1) this.corrHuff(this.chSet, this.nToPl); else break;
    }
    this.chSet[place] = this.chSet[newPlace]; this.chSet[newPlace] = cur;
  }

  // RAR 2.0 ------------------------------------------------------------
  private copy20(length: number, distance: number): void {
    this.lastDist = this.oldDist[this.oldDistPtr++ & 3] = distance; this.oldDistPtr &= 3;
    this.lastLength = length; this.left -= length;
    this.copyString(length, distance);
  }
  private unpack20(solid: boolean): void {
    if (!solid) { this.tablesRead = false; this.audio = false; this.channelDelta = 0; this.curChannel = 0; this.channels = 1; this.aud = [newAudio(), newAudio(), newAudio(), newAudio()]; this.oldTable.fill(0); }
    if ((!solid || !this.tablesRead) && !this.readTables20()) return;
    const inp = this.inp;
    while (this.left >= 0) {
      this.unpPtr &= this.mask;
      if (inp.over) break;
      if (((this.wrPtr - this.unpPtr) & this.mask) < 270 && this.wrPtr !== this.unpPtr) this.writeOld();
      if (this.audio) {
        const n = this.md[this.curChannel].decode(inp);
        if (n === 256) { if (!this.readTables20()) break; continue; }
        this.win[this.unpPtr++] = this.decodeAudio(n);
        if (++this.curChannel === this.channels) this.curChannel = 0;
        this.left--; continue;
      }
      let n = this.ld.decode(inp);
      if (n < 256) { this.win[this.unpPtr++] = n; this.left--; continue; }
      if (n > 269) {
        n -= 270; let length = LDECODE[n] + 3, bits = LBITS[n];
        if (bits > 0) { length += inp.get16() >>> (16 - bits); inp.add(bits); }
        const dn = this.dd.decode(inp); let distance = DDECODE2[dn] + 1; bits = DBITS2[dn];
        if (bits > 0) { distance += inp.get16() >>> (16 - bits); inp.add(bits); }
        if (distance >= 0x2000) { length++; if (distance >= 0x40000) length++; }
        this.copy20(length, distance); continue;
      }
      if (n === 269) { if (!this.readTables20()) break; continue; }
      if (n === 256) { this.copy20(this.lastLength, this.lastDist); continue; }
      if (n < 261) {
        const distance = this.oldDist[(this.oldDistPtr - (n - 256)) & 3];
        const ln = this.rd.decode(inp); let length = LDECODE[ln] + 2; const bits = LBITS[ln];
        if (bits > 0) { length += inp.get16() >>> (16 - bits); inp.add(bits); }
        if (distance >= 0x101) { length++; if (distance >= 0x2000) { length++; if (distance >= 0x40000) length++; } }
        this.copy20(length, distance); continue;
      }
      { // 261…269: short distances, length 2
        const k = n - 261; let distance = SDDECODE[k] + 1; const bits = SDBITS[k];
        if (bits > 0) { distance += inp.get16() >>> (16 - bits); inp.add(bits); }
        this.copy20(2, distance);
      }
    }
    // A table change right after the file's data belongs to the next solid file.
    if (inp.b.length >= inp.addr + 5) {
      if (this.audio) { if (this.md[this.curChannel].decode(inp) === 256) this.readTables20(); }
      else if (this.ld.decode(inp) === 269) this.readTables20();
    }
  }
  private readTables20(): boolean {
    const inp = this.inp, field = inp.get16();
    this.audio = !!(field & 0x8000);
    if (!(field & 0x4000)) this.oldTable.fill(0);
    inp.add(2);
    let size: number;
    if (this.audio) { this.channels = ((field >>> 12) & 3) + 1; if (this.curChannel >= this.channels) this.curChannel = 0; inp.add(2); size = MC2 * this.channels; }
    else size = NC2 + DC2 + RC2;
    const bl = new Uint8Array(BC2);
    for (let i = 0; i < BC2; i++) { bl[i] = inp.get16() >>> 12; inp.add(4); }
    const bd = new Huff(bl, 0, BC2), t = new Uint8Array(size);
    for (let i = 0; i < size;) {
      if (inp.over) return false;
      const n = bd.decode(inp);
      if (n < 16) { t[i] = (n + this.oldTable[i]) & 15; i++; }
      else if (n === 16) {
        let c = (inp.get16() >>> 14) + 3; inp.add(2);
        if (i === 0) return false;
        while (c-- > 0 && i < size) { t[i] = t[i - 1]; i++; }
      } else {
        let c: number; if (n === 17) { c = (inp.get16() >>> 13) + 3; inp.add(3); } else { c = (inp.get16() >>> 9) + 11; inp.add(7); }
        while (c-- > 0 && i < size) t[i++] = 0;
      }
    }
    this.tablesRead = true;
    if (inp.over) return true;
    if (this.audio) { this.md = []; for (let i = 0; i < this.channels; i++) this.md.push(new Huff(t, i * MC2, MC2)); }
    else { this.ld = new Huff(t, 0, NC2); this.dd = new Huff(t, NC2, DC2); this.rd = new Huff(t, NC2 + DC2, RC2); }
    this.oldTable.set(t);
    return true;
  }
  private decodeAudio(delta: number): number {
    const v = this.aud[this.curChannel], d = v.d, k = v.k;
    v.count++;
    d[3] = d[2]; d[2] = d[1]; d[1] = v.lastDelta - d[0]; d[0] = v.lastDelta;
    const pch = ((8 * v.lastChar + k[0] * d[0] + k[1] * d[1] + k[2] * d[2] + k[3] * d[3] + k[4] * this.channelDelta) >> 3) & 0xff;
    const ch = (pch - delta) & 0xff;
    const x = (((delta & 255) << 24) >> 24) * 8, dif = v.dif;
    dif[0] += Math.abs(x); dif[1] += Math.abs(x - d[0]); dif[2] += Math.abs(x + d[0]); dif[3] += Math.abs(x - d[1]); dif[4] += Math.abs(x + d[1]);
    dif[5] += Math.abs(x - d[2]); dif[6] += Math.abs(x + d[2]); dif[7] += Math.abs(x - d[3]); dif[8] += Math.abs(x + d[3]); dif[9] += Math.abs(x - this.channelDelta); dif[10] += Math.abs(x + this.channelDelta);
    this.channelDelta = v.lastDelta = (((ch - v.lastChar) & 255) << 24) >> 24;
    v.lastChar = ch;
    if ((v.count & 0x1f) === 0) {
      let min = dif[0], which = 0; dif[0] = 0;
      for (let i = 1; i < 11; i++) { if (dif[i] < min) { min = dif[i]; which = i; } dif[i] = 0; }
      if (which) { const j = (which - 1) >> 1; if (which & 1) { if (k[j] >= -16) k[j]--; } else if (k[j] < 16) k[j]++; }
    }
    return ch;
  }
}

// RAR 5.0 ---------------------------------------------------------------------------------------------
const NC5 = 306, DC5 = 64, LDC5 = 16, RC5 = 44, TABLE5 = NC5 + DC5 + LDC5 + RC5;
interface Filter5 { type: number; blockStart: number; blockLength: number; channels: number; nextWindow: boolean }

export class Unpack5 extends Unpacker {
  private inp = new Bits(new Uint8Array(0));
  private ld!: Huff; private dd!: Huff; private ldd!: Huff; private rd!: Huff; private tablesRead = false;
  private filters: Filter5[] = [];
  private writeBorder = 0;
  private block = { start: 0, size: 0, bitSize: 0, last: false, table: false };

  unpack(packed: Uint8Array, size: number, dict: number, solid: boolean): Uint8Array {
    this.window(dict, solid);
    this.out = new Uint8Array(size); this.outPos = 0; this.written = 0;
    this.inp = new Bits(packed);
    if (!solid) {
      this.oldDist = [0, 0, 0, 0]; this.lastLength = 0; this.unpPtr = this.wrPtr = 0; this.tablesRead = false;
      this.writeBorder = Math.min(this.win.length, 0x400000) & this.mask;
    }
    this.filters = [];
    if (!packed.length) return this.out;
    this.readBlockHeader(); this.readTables();
    if (!this.tablesRead) throw new RarError('The compressed data starts without Huffman tables');
    const inp = this.inp;
    for (;;) {
      this.unpPtr &= this.mask;
      let done = false;
      while (inp.addr > this.block.start + this.block.size - 1 || (inp.addr === this.block.start + this.block.size - 1 && inp.bit >= this.block.bitSize)) {
        if (this.block.last) { done = true; break; }
        this.readBlockHeader(); this.readTables();
      }
      if (done || inp.over) break;
      if (((this.writeBorder - this.unpPtr) & this.mask) < 0x1004 && this.writeBorder !== this.unpPtr) this.writeBuf();
      const slot = this.ld.decode(inp);
      if (slot < 256) { this.win[this.unpPtr++] = slot; continue; }
      if (slot >= 262) {
        let length = this.slotToLength(slot - 262);
        const ds = this.dd.decode(inp); let distance = 1, dbits = 0;
        if (ds < 4) distance += ds; else { dbits = (ds >>> 1) - 1; distance += (2 | (ds & 1)) * 2 ** dbits; }
        if (dbits > 0) {
          if (dbits >= 4) {
            if (dbits > 4) { distance += (Math.floor(inp.get32() / 2 ** (36 - dbits))) * 16; inp.add(dbits - 4); }
            distance += this.ldd.decode(inp);
          } else { distance += inp.get32() >>> (32 - dbits); inp.add(dbits); }
        }
        if (distance > 0x100) { length++; if (distance > 0x2000) { length++; if (distance > 0x40000) length++; } }
        this.insertOldDist(distance); this.lastLength = length; this.copyString(length, distance);
        continue;
      }
      if (slot === 256) { this.readFilter(); continue; }
      if (slot === 257) { if (this.lastLength) this.copyString(this.lastLength, this.oldDist[0]); continue; }
      { // 258…261: a recent distance
        const k = slot - 258, distance = this.oldDist[k];
        for (let i = k; i > 0; i--) this.oldDist[i] = this.oldDist[i - 1];
        this.oldDist[0] = distance;
        const length = this.slotToLength(this.rd.decode(inp));
        this.lastLength = length; this.copyString(length, distance);
      }
    }
    this.writeBuf();
    return this.out;
  }
  private slotToLength(slot: number): number {
    let bits = 0, length = 2;
    if (slot < 8) length += slot; else { bits = (slot >>> 2) - 1; length += (4 | (slot & 3)) << bits; }
    if (bits > 0) { length += this.inp.get16() >>> (16 - bits); this.inp.add(bits); }
    return length;
  }
  private readBlockHeader(): void {
    const inp = this.inp; inp.align();
    const flags = inp.get16() >>> 8; inp.add(8);
    const count = ((flags >>> 3) & 3) + 1;
    if (count === 4) throw new RarError('Damaged block header');
    const check = inp.get16() >>> 8; inp.add(8);
    let size = 0; for (let i = 0; i < count; i++) { size += (inp.get16() >>> 8) << (i * 8); inp.add(8); }
    if ((0x5a ^ flags ^ size ^ (size >>> 8) ^ (size >>> 16)) & 0xff ^ check) throw new RarError('Damaged block header');
    if (inp.addr + size > inp.b.length + 1) throw new RarError('The compressed data is cut short');
    this.block = { start: inp.addr, size, bitSize: (flags & 7) + 1, last: !!(flags & 0x40), table: !!(flags & 0x80) };
  }
  private readTables(): void {
    if (!this.block.table) return;
    const t = readLengths(this.inp, TABLE5, null);
    this.ld = new Huff(t, 0, NC5); this.dd = new Huff(t, NC5, DC5); this.ldd = new Huff(t, NC5 + DC5, LDC5); this.rd = new Huff(t, NC5 + DC5 + LDC5, RC5);
    this.tablesRead = true;
  }
  private readFilter(): void {
    const inp = this.inp;
    const data = () => { const n = (inp.get16() >>> 14) + 1; inp.add(2); let v = 0; for (let i = 0; i < n; i++) { v += (inp.get16() >>> 8) * 2 ** (i * 8); inp.add(8); } return v; };
    const start = data(); let length = data(); if (length > 0x400000) length = 0;
    const type = inp.get16() >>> 13; inp.add(3);
    let channels = 0; if (type === 0) { channels = (inp.get16() >>> 11) + 1; inp.add(5); }
    if (this.filters.length >= 8192) { this.writeBuf(); if (this.filters.length >= 8192) this.filters = []; }
    const nextWindow = this.wrPtr !== this.unpPtr && ((this.wrPtr - this.unpPtr) & this.mask) <= start;
    this.filters.push({ type: type > 3 ? -1 : type, blockStart: (start + this.unpPtr) & this.mask, blockLength: type > 3 ? 0 : length, channels, nextWindow });
  }
  private apply(data: Uint8Array, f: Filter5): Uint8Array {
    switch (f.type) {
      case 1: case 2: e8(data, this.written >>> 0, f.type === 2, true); return data;
      case 3: { // ARM BL
        const off = this.written >>> 0;
        for (let p = 0; p + 3 < data.length; p += 4) if (data[p + 3] === 0xeb) {
          const v = (data[p] + data[p + 1] * 0x100 + data[p + 2] * 0x10000 - ((off + p) >>> 2)) >>> 0;
          data[p] = v & 255; data[p + 1] = (v >>> 8) & 255; data[p + 2] = (v >>> 16) & 255;
        }
        return data;
      }
      case 0: return delta(data, f.channels);
    }
    return data;
  }
  private writeBuf(): void {
    let border = this.wrPtr; const full = (this.unpPtr - border) & this.mask; let left = full, notAll = false;
    for (let i = 0; i < this.filters.length; i++) {
      const f = this.filters[i];
      if (f.type === -2) continue;
      if (f.nextWindow) { if (((f.blockStart - this.wrPtr) & this.mask) <= full) f.nextWindow = false; continue; }
      const start = f.blockStart, length = f.blockLength;
      if (((start - border) & this.mask) < left) {
        if (border !== start) { this.writeArea(border, start); border = start; left = (this.unpPtr - border) & this.mask; }
        if (length <= left) {
          if (length > 0) {
            const end = (start + length) & this.mask;
            this.put(this.apply(this.windowBlock(start, length), f));
            border = end; left = (this.unpPtr - border) & this.mask;
          }
          f.type = -2;
        } else {
          this.wrPtr = border;
          for (let j = i; j < this.filters.length; j++) if (this.filters[j].type !== -2) this.filters[j].nextWindow = false;
          notAll = true; break;
        }
      }
    }
    this.filters = this.filters.filter((f) => f.type !== -2);
    if (!notAll) { this.writeArea(border, this.unpPtr); this.wrPtr = this.unpPtr; }
    this.writeBorder = (this.unpPtr + Math.min(this.win.length, 0x400000)) & this.mask;
    if (this.writeBorder === this.unpPtr || (this.wrPtr !== this.unpPtr && ((this.wrPtr - this.unpPtr) & this.mask) < ((this.writeBorder - this.unpPtr) & this.mask))) this.writeBorder = this.wrPtr;
  }
}
