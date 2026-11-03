/**
 * RAR decompression of the app's own: the RAR 2.9 (RAR 3.x/4.x archives) and RAR 5.0 LZ coders with their
 * standard filters (x86 E8/E8E9, Itanium, delta, RGB and audio for 2.9; E8, E8E9, ARM and delta for 5.0),
 * solid streams (the window, tables and recent distances carry over from file to file) and RAR's
 * circular window with filtered blocks written in order. Written for Anne's Lens; it contains no RARLAB
 * (unRAR) code. PPMd blocks (RAR 2.9 text compression) are refused with a message.
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

  unpack(packed: Uint8Array, size: number, dict: number, solid: boolean): Uint8Array {
    this.window(dict, solid);
    this.out = new Uint8Array(size); this.outPos = 0; this.written = 0;
    this.inp = new Bits(packed);
    if (!solid) {
      this.oldDist = [0, 0, 0, 0]; this.lastLength = 0; this.unpPtr = this.wrPtr = 0;
      this.tablesRead = false; this.oldTable.fill(0); this.ppm = false;
      this.filters = []; this.oldFilterLengths = []; this.lastFilter = 0;
    }
    this.stack = [];
    if (!solid || !this.tablesRead) this.readTables();
    if (this.ppm) throw new RarError('This RAR archive uses PPMd text compression, which Anne\'s Lens does not unpack yet');
    const inp = this.inp;
    for (;;) {
      this.unpPtr &= this.mask;
      if (inp.over) break;
      if (((this.wrPtr - this.unpPtr) & this.mask) < 260 && this.wrPtr !== this.unpPtr) this.writeBuf();
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
      if (n === 256) { if (!this.endOfBlock()) break; if (this.ppm) throw new RarError('This RAR archive uses PPMd text compression, which Anne\'s Lens does not unpack yet'); continue; }
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
    if (field & 0x8000) { this.ppm = true; return; }
    this.ppm = false; this.prevLowDist = 0; this.lowDistRep = 0;
    if (!(field & 0x4000)) this.oldTable.fill(0);
    inp.add(2);
    const t = readLengths(inp, TABLE3, this.oldTable);
    this.ld = new Huff(t, 0, NC3); this.dd = new Huff(t, NC3, DC3); this.ldd = new Huff(t, NC3 + DC3, LDC3); this.rd = new Huff(t, NC3 + DC3 + LDC3, RC3);
    this.oldTable.set(t); this.tablesRead = true;
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
