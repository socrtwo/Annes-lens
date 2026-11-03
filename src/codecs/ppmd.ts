/**
 * PPMd variant H (Dmitry Shkarin's PPMd var.H, as used by RAR 2.9 text compression and the 7z PPMd method),
 * decoder only. The model lives in one byte array laid out as the reference implementation lays it out
 * (12-byte units, contexts, 6-byte states, the sub-allocator's free lists and gluing), so the model runs out
 * of memory and restarts exactly where the compressor's did. Two range decoders: RAR's (low/code/range,
 * carry-less) and 7z's (code/range).
 */

export interface RangeDecoder {
  threshold(total: number): number;
  decode(start: number, size: number): void;
  bit(size0: number, total: number): number;
}

/** 7z's range decoder. */
export class Range7z implements RangeDecoder {
  range = 0xffffffff; code = 0;
  constructor(private next: () => number) {
    if (next() !== 0) throw new Error('Damaged PPMd data');
    for (let i = 0; i < 4; i++) this.code = ((this.code << 8) | next()) >>> 0;
  }
  private normalize(): void {
    while (this.range < 0x1000000) { this.code = ((this.code << 8) | this.next()) >>> 0; this.range = (this.range << 8) >>> 0; }
  }
  threshold(total: number): number { this.range = Math.floor(this.range / total); return Math.floor(this.code / this.range); }
  decode(start: number, size: number): void { this.code = (this.code - start * this.range) >>> 0; this.range = (this.range * size) >>> 0; this.normalize(); }
  bit(size0: number, total: number): number {
    const bound = (Math.floor(this.range / total) * size0) >>> 0;
    let s: number;
    if (this.code < bound) { s = 0; this.range = bound; } else { s = 1; this.code = (this.code - bound) >>> 0; this.range = (this.range - bound) >>> 0; }
    this.normalize(); return s;
  }
}

/** RAR's range decoder (Subbotin's carry-less coder). */
export class RangeRar implements RangeDecoder {
  low = 0; code = 0; range = 0xffffffff;
  constructor(public next: () => number) { for (let i = 0; i < 4; i++) this.code = ((this.code << 8) | next()) >>> 0; }
  private normalize(): void {
    for (;;) {
      if (((this.low ^ ((this.low + this.range) >>> 0)) >>> 0) >= 0x1000000) {
        if (this.range >= 0x8000) return;
        this.range = (0 - this.low) & 0x7fff;
      }
      this.code = ((this.code << 8) | this.next()) >>> 0; this.range = (this.range << 8) >>> 0; this.low = (this.low << 8) >>> 0;
    }
  }
  threshold(total: number): number { this.range = Math.floor(this.range / total); return Math.floor(((this.code - this.low) >>> 0) / this.range); }
  decode(start: number, size: number): void { this.low = (this.low + start * this.range) >>> 0; this.range = (this.range * size) >>> 0; this.normalize(); }
  bit(size0: number, total: number): number {
    if (this.threshold(total) < size0) { this.decode(0, size0); return 0; }
    this.decode(size0, total - size0); return 1;
  }
}

const MAX_O = 64, UNIT = 12, MAX_FREQ = 124, INT_BITS = 7, PERIOD_BITS = 7, BIN_SCALE = 1 << (INT_BITS + PERIOD_BITS), N_INDEXES = 38;
const EXP_ESCAPE = [25, 14, 9, 7, 5, 5, 4, 4, 4, 3, 3, 3, 2, 2, 2, 2];
const INIT_BIN_ESC = [0x3cdd, 0x1f3f, 0x59bf, 0x48f3, 0x64a1, 0x5abc, 0x6632, 0x6051];
const I2U = new Uint8Array(N_INDEXES), U2I = new Uint8Array(128), NS2INDX = new Uint8Array(256), NS2BSINDX = new Uint8Array(256), HB2FLAG = new Uint8Array(256);
{
  let k = 0;
  for (let i = 0; i < N_INDEXES; i++) { let step = i >= 12 ? 4 : (i >> 2) + 1; do U2I[k++] = i; while (--step); I2U[i] = k; }
  NS2BSINDX[0] = 0; NS2BSINDX[1] = 2; NS2BSINDX.fill(4, 2, 11); NS2BSINDX.fill(6, 11);
  let i = 0; for (; i < 3; i++) NS2INDX[i] = i;
  for (let m = i, kk = 1; i < 256; i++) { NS2INDX[i] = m; if (--kk === 0) kk = ++m - 2; }
  HB2FLAG.fill(8, 0x40);
}
interface See { summ: number; shift: number; count: number }

/** The PPMd var.H model. Offsets into `m` stand for the reference implementation's pointers (0 = null). */
export class Ppmd7 {
  m: Uint8Array; private size: number; private align: number;
  get memSize(): number { return this.size; }
  /** How often the model filled its memory and started over, and how often free blocks were glued (for tests). */
  restarts = -1; glues = 0;
  private lo = 0; private hi = 0; private text = 0; private unitsStart = 0; private glueCount = 0;
  private free = new Uint32Array(N_INDEXES);
  minContext = 0; private maxContext = 0; private found = 0;
  private orderFall = 0; private initEsc = 0; private prevSuccess = 0; maxOrder = 0; private hiBitsFlag = 0; private runLength = 0; private initRL = 0;
  private see: See[][] = []; private dummySee: See = { summ: 0, shift: PERIOD_BITS, count: 64 };
  private binSumm = new Uint16Array(128 * 64);
  private charMask = new Int8Array(256);
  private ps = new Uint32Array(256);

  constructor(size: number) {
    if (size < 2048 || size > 0x40000000) throw new Error(`PPMd memory size ${size} is out of range`);
    this.size = size; this.align = 4 - (size & 3);
    this.m = new Uint8Array(this.align + size + UNIT * 2);
  }
  // Memory access (little-endian).
  private u16(o: number): number { return this.m[o] | (this.m[o + 1] << 8); }
  private s16(o: number, v: number): void { this.m[o] = v & 255; this.m[o + 1] = (v >>> 8) & 255; }
  private u32(o: number): number { return (this.m[o] | (this.m[o + 1] << 8) | (this.m[o + 2] << 16) | (this.m[o + 3] << 24)) >>> 0; }
  private s32(o: number, v: number): void { this.m[o] = v & 255; this.m[o + 1] = (v >>> 8) & 255; this.m[o + 2] = (v >>> 16) & 255; this.m[o + 3] = (v >>> 24) & 255; }
  // Context: NumStats u16, SummFreq u16, Stats u32, Suffix u32; its one state overlays SummFreq/Stats.
  private numStats(c: number): number { return this.u16(c); }
  private summFreq(c: number): number { return this.u16(c + 2); }
  private stats(c: number): number { return this.u32(c + 4); }
  private suffix(c: number): number { return this.u32(c + 8); }
  // State: Symbol u8, Freq u8, Successor u32 (as two u16 halves).
  private sym(s: number): number { return this.m[s]; }
  private freq(s: number): number { return this.m[s + 1]; }
  private setFreq(s: number, v: number): void { this.m[s + 1] = v & 255; }
  private succ(s: number): number { return this.u32(s + 2); }
  private setSucc(s: number, v: number): void { this.s32(s + 2, v); }
  private copyState(to: number, from: number): void { this.m.copyWithin(to, from, from + 6); }
  private swapStates(a: number, b: number): void { const t = this.m.slice(a, a + 6); this.m.copyWithin(a, b, b + 6); this.m.set(t, b); }

  // Sub-allocator.
  private insertNode(node: number, indx: number): void { this.s32(node, this.free[indx]); this.free[indx] = node; }
  private removeNode(indx: number): number { const node = this.free[indx]; this.free[indx] = this.u32(node); return node; }
  private splitBlock(ptr: number, oldIndx: number, newIndx: number): void {
    const nu = I2U[oldIndx] - I2U[newIndx]; ptr += I2U[newIndx] * UNIT;
    let i = U2I[nu - 1];
    if (I2U[i] !== nu) { const k = I2U[--i]; this.insertNode(ptr + k * UNIT, nu - k - 1); }
    this.insertNode(ptr, i);
  }
  private glueFreeBlocks(): void {
    this.glues++;
    // Nodes: Stamp u16, NU u16, Next u32, Prev u32.
    const head = this.align + this.size; let n = head;
    this.glueCount = 255;
    for (let i = 0; i < N_INDEXES; i++) {
      const nu = I2U[i]; let next = this.free[i]; this.free[i] = 0;
      while (next !== 0) {
        const node = next;
        this.s32(node + 4, n); this.s32(n + 8, node); n = node;
        next = this.u32(node);
        this.s16(node, 0); this.s16(node + 2, nu);
      }
    }
    this.s16(head, 1); this.s32(head + 4, n); this.s32(n + 8, head);
    if (this.lo !== this.hi) this.s16(this.lo, 1);
    while (n !== head) {
      const node = n; let nu = this.u16(node + 2);
      for (;;) {
        const node2 = node + nu * UNIT;
        nu += this.u16(node2 + 2);
        if (this.u16(node2) !== 0 || nu >= 0x10000) break;
        const prev = this.u32(node2 + 8), nxt = this.u32(node2 + 4);
        this.s32(prev + 4, nxt); this.s32(nxt + 8, prev);
        this.s16(node + 2, nu);
      }
      n = this.u32(node + 4);
    }
    for (n = this.u32(head + 4); n !== head;) {
      let node = n; const next = this.u32(node + 4); let nu = this.u16(node + 2);
      for (; nu > 128; nu -= 128, node += 128 * UNIT) this.insertNode(node, N_INDEXES - 1);
      let i = U2I[nu - 1];
      if (I2U[i] !== nu) { const k = I2U[--i]; this.insertNode(node + k * UNIT, nu - k - 1); }
      this.insertNode(node, i);
      n = next;
    }
  }
  private allocUnitsRare(indx: number): number {
    if (this.glueCount === 0) { this.glueFreeBlocks(); if (this.free[indx] !== 0) return this.removeNode(indx); }
    let i = indx;
    do {
      if (++i === N_INDEXES) {
        const bytes = I2U[indx] * UNIT; this.glueCount--;
        return this.unitsStart - this.text > bytes ? (this.unitsStart -= bytes) : 0;
      }
    } while (this.free[i] === 0);
    const r = this.removeNode(i); this.splitBlock(r, i, indx); return r;
  }
  private allocUnits(indx: number): number {
    if (this.free[indx] !== 0) return this.removeNode(indx);
    const bytes = I2U[indx] * UNIT;
    if (bytes <= this.hi - this.lo) { const r = this.lo; this.lo += bytes; return r; }
    return this.allocUnitsRare(indx);
  }
  private shrinkUnits(old: number, oldNU: number, newNU: number): number {
    const i0 = U2I[oldNU - 1], i1 = U2I[newNU - 1];
    if (i0 === i1) return old;
    if (this.free[i1] !== 0) { const p = this.removeNode(i1); this.m.copyWithin(p, old, old + newNU * UNIT); this.insertNode(old, i0); return p; }
    this.splitBlock(old, i0, i1); return old;
  }

  restart(): void {
    this.restarts++;
    this.free.fill(0);
    this.text = this.align; this.hi = this.text + this.size;
    this.lo = this.unitsStart = this.hi - Math.floor(Math.floor(this.size / 8) / UNIT) * 7 * UNIT;
    this.glueCount = 0;
    this.orderFall = this.maxOrder;
    this.runLength = this.initRL = -(this.maxOrder < 12 ? this.maxOrder : 12) - 1;
    this.prevSuccess = 0;
    this.hi -= UNIT; this.minContext = this.maxContext = this.hi;
    this.s32(this.minContext + 8, 0); this.s16(this.minContext, 256); this.s16(this.minContext + 2, 257);
    this.found = this.lo; this.s32(this.minContext + 4, this.lo);
    for (let i = 0; i < 256; i++) { const s = this.lo + i * 6; this.m[s] = i; this.m[s + 1] = 1; this.setSucc(s, 0); }
    this.lo += 128 * UNIT;
    for (let i = 0; i < 128; i++) for (let k = 0; k < 8; k++) { const v = BIN_SCALE - Math.floor(INIT_BIN_ESC[k] / (i + 2)); for (let m = 0; m < 64; m += 8) this.binSumm[i * 64 + k + m] = v; }
    this.see = Array.from({ length: 25 }, (_, i) => Array.from({ length: 16 }, () => ({ summ: ((5 * i + 10) << (PERIOD_BITS - 4)) & 0xffff, shift: PERIOD_BITS - 4, count: 4 })));
  }
  init(maxOrder: number): void { this.maxOrder = maxOrder; this.restart(); this.dummySee = { summ: 0, shift: PERIOD_BITS, count: 64 }; }

  private createSuccessors(skip: boolean): number {
    let c = this.minContext; const upBranch = this.succ(this.found), fsym = this.sym(this.found);
    const ps: number[] = [];
    if (!skip) ps.push(this.found);
    while (this.suffix(c)) {
      c = this.suffix(c);
      let s: number;
      if (this.numStats(c) !== 1) { s = this.stats(c); while (this.sym(s) !== fsym) s += 6; } else s = c + 2;
      const successor = this.succ(s);
      if (successor !== upBranch) { c = successor; if (ps.length === 0) return c; break; }
      ps.push(s);
    }
    const upSym = this.m[upBranch], upSucc = upBranch + 1;
    let upFreq: number;
    if (this.numStats(c) === 1) upFreq = this.freq(c + 2);
    else {
      let s = this.stats(c); while (this.sym(s) !== upSym) s += 6;
      const cf = this.freq(s) - 1, s0 = this.summFreq(c) - this.numStats(c) - cf;
      upFreq = 1 + (2 * cf <= s0 ? (5 * cf > s0 ? 1 : 0) : Math.floor((2 * cf + 3 * s0 - 1) / (2 * s0)));
    }
    do {
      let c1: number;
      if (this.hi !== this.lo) c1 = this.hi -= UNIT;
      else if (this.free[0] !== 0) c1 = this.removeNode(0);
      else { c1 = this.allocUnitsRare(0); if (!c1) return 0; }
      this.s16(c1, 1); this.m[c1 + 2] = upSym; this.m[c1 + 3] = upFreq & 255; this.setSucc(c1 + 2, upSucc);
      this.s32(c1 + 8, c);
      this.setSucc(ps.pop()!, c1);
      c = c1;
    } while (ps.length);
    return c;
  }
  private updateModel(): void {
    let fSuccessor = this.succ(this.found);
    const fSym = this.sym(this.found), fFreq = this.freq(this.found);
    if (fFreq < MAX_FREQ / 4 && this.suffix(this.minContext) !== 0) {
      const c = this.suffix(this.minContext);
      if (this.numStats(c) === 1) { const s = c + 2; if (this.freq(s) < 32) this.setFreq(s, this.freq(s) + 1); }
      else {
        let s = this.stats(c);
        if (this.sym(s) !== fSym) {
          do s += 6; while (this.sym(s) !== fSym);
          if (this.freq(s) >= this.freq(s - 6)) { this.swapStates(s, s - 6); s -= 6; }
        }
        if (this.freq(s) < MAX_FREQ - 9) { this.setFreq(s, this.freq(s) + 2); this.s16(c + 2, this.summFreq(c) + 2); }
      }
    }
    if (this.orderFall === 0) {
      this.minContext = this.maxContext = this.createSuccessors(true);
      if (this.minContext === 0) { this.restart(); return; }
      this.setSucc(this.found, this.minContext);
      return;
    }
    this.m[this.text++] = fSym;
    let successor = this.text;
    if (this.text >= this.unitsStart) { this.restart(); return; }
    if (fSuccessor) {
      if (fSuccessor <= successor) {
        const cs = this.createSuccessors(false);
        if (cs === 0) { this.restart(); return; }
        fSuccessor = cs;
      }
      if (--this.orderFall === 0) { successor = fSuccessor; if (this.maxContext !== this.minContext) this.text--; }
    } else {
      this.setSucc(this.found, successor);
      fSuccessor = this.minContext;
    }
    const ns = this.numStats(this.minContext);
    const s0 = this.summFreq(this.minContext) - ns - (this.freq(this.found) - 1);
    for (let c = this.maxContext; c !== this.minContext; c = this.suffix(c)) {
      const ns1 = this.numStats(c);
      if (ns1 !== 1) {
        if ((ns1 & 1) === 0) {
          const oldNU = ns1 >>> 1, i = U2I[oldNU - 1];
          if (i !== U2I[oldNU]) {
            const ptr = this.allocUnits(i + 1);
            if (!ptr) { this.restart(); return; }
            const old = this.stats(c);
            this.m.copyWithin(ptr, old, old + oldNU * UNIT);
            this.insertNode(old, i);
            this.s32(c + 4, ptr);
          }
        }
        const sf = this.summFreq(c);
        this.s16(c + 2, sf + (2 * ns1 < ns ? 1 : 0) + 2 * ((4 * ns1 <= ns ? 1 : 0) & (sf <= 8 * ns1 ? 1 : 0)));
      } else {
        const s = this.allocUnits(0);
        if (!s) { this.restart(); return; }
        this.copyState(s, c + 2);
        this.s32(c + 4, s);
        let f = this.freq(s);
        f = f < MAX_FREQ / 4 - 1 ? f << 1 : MAX_FREQ - 4;
        this.setFreq(s, f);
        this.s16(c + 2, f + this.initEsc + (ns > 3 ? 1 : 0));
      }
      let cf = 2 * this.freq(this.found) * (this.summFreq(c) + 6);
      const sf = s0 + this.summFreq(c);
      if (cf < 6 * sf) { cf = 1 + (cf > sf ? 1 : 0) + (cf >= 4 * sf ? 1 : 0); this.s16(c + 2, this.summFreq(c) + 3); }
      else { cf = 4 + (cf >= 9 * sf ? 1 : 0) + (cf >= 12 * sf ? 1 : 0) + (cf >= 15 * sf ? 1 : 0); this.s16(c + 2, this.summFreq(c) + cf); }
      const s = this.stats(c) + ns1 * 6;
      this.setSucc(s, successor); this.m[s] = fSym; this.m[s + 1] = cf; this.s16(c, ns1 + 1);
    }
    this.maxContext = this.minContext = fSuccessor;
  }
  private rescale(): void {
    const mc = this.minContext, stats = this.stats(mc);
    let s = this.found;
    { const tmp = this.m.slice(s, s + 6); for (; s !== stats; s -= 6) this.copyState(s, s - 6); this.m.set(tmp, s); }
    let escFreq = this.summFreq(mc) - this.freq(s);
    const adder = this.orderFall !== 0 ? 1 : 0;
    this.setFreq(s, (this.freq(s) + 4 + adder) >>> 1);
    let sumFreq = this.freq(s);
    let i = this.numStats(mc) - 1;
    do {
      s += 6; escFreq -= this.freq(s);
      this.setFreq(s, (this.freq(s) + adder) >>> 1);
      sumFreq += this.freq(s);
      if (this.freq(s) > this.freq(s - 6)) {
        let s1 = s; const tmp = this.m.slice(s1, s1 + 6);
        do this.copyState(s1, s1 - 6); while ((s1 -= 6) !== stats && tmp[1] > this.freq(s1 - 6));
        this.m.set(tmp, s1);
      }
    } while (--i);
    if (this.freq(s) === 0) {
      const numStats = this.numStats(mc);
      do i++; while (this.freq(s -= 6) === 0);
      escFreq += i;
      this.s16(mc, numStats - i);
      if (this.numStats(mc) === 1) {
        const tmp = this.m.slice(stats, stats + 6);
        do { tmp[1] -= tmp[1] >>> 1; escFreq >>>= 1; } while (escFreq > 1);
        this.insertNode(stats, U2I[((numStats + 1) >>> 1) - 1]);
        this.found = mc + 2; this.m.set(tmp, this.found);
        return;
      }
      const n0 = (numStats + 1) >>> 1, n1 = (this.numStats(mc) + 1) >>> 1;
      if (n0 !== n1) this.s32(mc + 4, this.shrinkUnits(stats, n0, n1));
    }
    this.s16(mc + 2, sumFreq + escFreq - (escFreq >>> 1));
    this.found = this.stats(mc);
  }
  private makeEscFreq(numMasked: number): [See, number] {
    const mc = this.minContext, ns = this.numStats(mc), nonMasked = ns - numMasked;
    if (ns !== 256) {
      const see = this.see[NS2INDX[nonMasked - 1]][
        (nonMasked < this.numStats(this.suffix(mc)) - ns ? 1 : 0) + 2 * (this.summFreq(mc) < 11 * ns ? 1 : 0) + 4 * (numMasked > nonMasked ? 1 : 0) + this.hiBitsFlag];
      const r = see.summ >>> see.shift; see.summ = (see.summ - r) & 0xffff;
      return [see, r + (r === 0 ? 1 : 0)];
    }
    return [this.dummySee, 1];
  }
  private nextContext(): void {
    const c = this.succ(this.found);
    if (this.orderFall === 0 && c > this.text) this.minContext = this.maxContext = c; else this.updateModel();
  }
  private update1(): void {
    let s = this.found;
    this.setFreq(s, this.freq(s) + 4); this.s16(this.minContext + 2, this.summFreq(this.minContext) + 4);
    if (this.freq(s) > this.freq(s - 6)) { this.swapStates(s, s - 6); this.found = s -= 6; if (this.freq(s) > MAX_FREQ) this.rescale(); }
    this.nextContext();
  }
  private update1_0(): void {
    this.prevSuccess = 2 * this.freq(this.found) > this.summFreq(this.minContext) ? 1 : 0;
    this.runLength += this.prevSuccess;
    this.s16(this.minContext + 2, this.summFreq(this.minContext) + 4);
    this.setFreq(this.found, this.freq(this.found) + 4);
    if (this.freq(this.found) > MAX_FREQ) this.rescale();
    this.nextContext();
  }
  private update2(): void {
    this.setFreq(this.found, this.freq(this.found) + 4); this.s16(this.minContext + 2, this.summFreq(this.minContext) + 4);
    if (this.freq(this.found) > MAX_FREQ) this.rescale();
    this.runLength = this.initRL;
    this.updateModel();
  }

  /** One symbol (0…255); −1 at the end mark (an escape from the order −1 context); −2 on damaged data. */
  decodeSymbol(rc: RangeDecoder): number {
    const mask = this.charMask;
    const mc0 = this.minContext;
    if (mc0 <= this.text || mc0 > this.m.length - UNIT) return -2;
    if (this.numStats(mc0) !== 1) {
      let s = this.stats(mc0);
      if (s <= this.text || s > this.m.length) return -2;
      let i: number; let hiCnt: number;
      const count = rc.threshold(this.summFreq(mc0));
      if (count < (hiCnt = this.freq(s))) {
        rc.decode(0, this.freq(s)); this.found = s; const sym = this.sym(s); this.update1_0(); return sym;
      }
      this.prevSuccess = 0;
      i = this.numStats(mc0) - 1;
      do {
        s += 6;
        if ((hiCnt += this.freq(s)) > count) { rc.decode(hiCnt - this.freq(s), this.freq(s)); this.found = s; const sym = this.sym(s); this.update1(); return sym; }
      } while (--i);
      if (count >= this.summFreq(mc0)) return -2;
      this.hiBitsFlag = HB2FLAG[this.sym(this.found)];
      rc.decode(hiCnt, this.summFreq(mc0) - hiCnt);
      mask.fill(-1);
      mask[this.sym(s)] = 0;
      i = this.numStats(mc0) - 1;
      do { s -= 6; mask[this.sym(s)] = 0; } while (--i);
    } else {
      const one = mc0 + 2;
      this.hiBitsFlag = HB2FLAG[this.sym(this.found)];
      const idx = (this.freq(one) - 1) * 64 + this.prevSuccess + NS2BSINDX[this.numStats(this.suffix(mc0)) - 1] + this.hiBitsFlag + 2 * HB2FLAG[this.sym(one)] + ((this.runLength >> 26) & 0x20);
      const prob = this.binSumm[idx];
      if (rc.bit(prob, BIN_SCALE) === 0) {
        this.binSumm[idx] = (prob + (1 << INT_BITS) - ((prob + (1 << (PERIOD_BITS - 2))) >> PERIOD_BITS)) & 0xffff;
        this.found = one; const sym = this.sym(one);
        this.setFreq(one, this.freq(one) + (this.freq(one) < 128 ? 1 : 0));
        this.prevSuccess = 1; this.runLength++;
        this.nextContext();
        return sym;
      }
      const np = (prob - ((prob + (1 << (PERIOD_BITS - 2))) >> PERIOD_BITS)) & 0xffff;
      this.binSumm[idx] = np;
      this.initEsc = EXP_ESCAPE[np >>> 10];
      mask.fill(-1); mask[this.sym(one)] = 0;
      this.prevSuccess = 0;
    }
    const ps = this.ps;
    for (;;) {
      let numMasked = this.numStats(this.minContext);
      do {
        this.orderFall++;
        const suf = this.suffix(this.minContext);
        if (!suf) return -1;
        if (suf <= this.text || suf > this.m.length - UNIT) return -2;
        this.minContext = suf;
      } while (this.numStats(this.minContext) === numMasked);
      const mc = this.minContext;
      let hiCnt = 0, s = this.stats(mc), i = 0;
      if (s <= this.text || s > this.m.length) return -2;
      const num = this.numStats(mc) - numMasked;
      do {
        const k = mask[this.sym(s)];
        hiCnt += this.freq(s) & k;
        ps[i] = s; s += 6; i -= k;
      } while (i !== num);
      const [see, esc] = this.makeEscFreq(numMasked);
      const freqSum = esc + hiCnt;
      const count = rc.threshold(freqSum);
      if (count < hiCnt) {
        let k = 0; hiCnt = 0;
        while ((hiCnt += this.freq(ps[k])) <= count) k++;
        s = ps[k];
        rc.decode(hiCnt - this.freq(s), this.freq(s));
        if (see.shift < PERIOD_BITS && --see.count === 0) { see.summ = (see.summ << 1) & 0xffff; see.count = 3 << see.shift++; }
        this.found = s; const sym = this.sym(s); this.update2(); return sym;
      }
      if (count >= freqSum) return -2;
      rc.decode(hiCnt, freqSum - hiCnt);
      see.summ = (see.summ + freqSum) & 0xffff;
      do mask[this.sym(ps[--i])] = 0; while (i !== 0);
      numMasked = this.numStats(mc);
      void numMasked;
    }
  }
}
export { MAX_O as PPMD7_MAX_ORDER };
