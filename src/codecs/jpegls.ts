/**
 * JPEG-LS (ITU-T T.87 / ISO 14495-1), the LOCO-I lossless and near-lossless coder used for DICOM pixel data, written
 * from the Recommendation: the median-edge predictor with context modeling (365 contexts, bias correction), Golomb
 * coding with the limited code length, run mode with its interruption samples, 2 to 16 bits per sample, the three
 * interleave modes (separate scans, line and sample interleaved), the LSE preset parameters (MAXVAL, T1–T3, RESET)
 * restart intervals and the LSE mapping tables (ID 2 with ID 3 continuations: a one-component picture whose scan names
 * a table comes out mapped through it, 1-byte entries as gray, 3 as RGB, 4 as RGBA, 2 as a 16-bit sample). Not
 * supported: subsampled components, the point transform.
 * Output: the samples, pixel-interleaved, as unsigned P-bit values.
 */
export interface JlsFrame { width: number; height: number; comps: number; precision: number; near: number; data: Uint16Array; warnings: string[]; /** Set when a mapping table was applied: its id and entry width. */ mapped?: { id: number; width: number; entries: number } }

const J = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 9, 10, 11, 12, 13, 14, 15];

/** The entropy-coded bit reader: after an 0xFF byte the next byte carries 7 bits; a marker ends the data. */
class Bits {
  p: number; acc = 0; n = 0; done = false;
  constructor(private u8: Uint8Array, start: number, private end: number) { this.p = start; }
  private fill(): void {
    while (this.n <= 16) { // at most 15 bits are added per step, so the 32-bit accumulator never overflows
      if (this.done || this.p >= this.end) { this.acc = (this.acc << 8) >>> 0; this.n += 8; continue; } // zeros past the end
      const b = this.u8[this.p];
      if (b === 0xff) {
        const nx = this.p + 1 < this.end ? this.u8[this.p + 1] : 0;
        if (nx & 0x80) { this.done = true; continue; } // a marker
        this.acc = ((this.acc << 8) | 0xff) >>> 0; this.n += 8; this.p++;
        this.acc = ((this.acc << 7) | (nx & 0x7f)) >>> 0; this.n += 7; this.p++; // the stuffed byte: 7 bits
        continue;
      }
      this.acc = ((this.acc << 8) | b) >>> 0; this.n += 8; this.p++;
    }
  }
  bit(): number { if (this.n < 1) this.fill(); this.n--; return (this.acc >>> this.n) & 1; }
  read(k: number): number {
    if (k === 0) return 0;
    if (k > 16) return ((this.read(k - 16) << 16) | this.read(16)) >>> 0;
    if (this.n < k) this.fill();
    this.n -= k; return (this.acc >>> this.n) & ((1 << k) - 1);
  }
  /** Zeros until a one (the one is consumed). */
  unary(): number { let q = 0; while (!this.bit()) { if (++q > 80) throw new Error(this.done || this.p >= this.end ? 'JPEG-LS: the data is cut short' : 'JPEG-LS: damaged data (unary code too long)'); } return q; }
  /** Forgets the buffered bits; the position of the next unread byte (a marker, when one ended the data). */
  resume(): number { this.acc = 0; this.n = 0; this.done = false; return this.p; }
}

export function isJpegLs(u8: Uint8Array): boolean {
  if (u8.length < 4 || u8[0] !== 0xff || u8[1] !== 0xd8) return false;
  for (let p = 2; p + 4 <= u8.length && u8[p] === 0xff;) { const m = u8[p + 1]; if (m === 0xf7) return true; if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; } p += 2 + ((u8[p + 2] << 8) | u8[p + 3]); }
  return false;
}

interface Preset { maxval: number; t1: number; t2: number; t3: number; reset: number }

export function decodeJpegLs(u8: Uint8Array): JlsFrame {
  if (u8.length < 4 || u8[0] !== 0xff || u8[1] !== 0xd8) throw new Error('JPEG-LS: not a JPEG stream');
  const warnings: string[] = [];
  let p = 2, width = 0, height = 0, precision = 0, comps = 0, restart = 0, near = 0;
  const preset: Preset = { maxval: 0, t1: 0, t2: 0, t3: 0, reset: 0 };
  const compIds: number[] = [], tables = new Map<number, { width: number; bytes: number[] }>();
  let data: Uint16Array | null = null, tableUsed = 0;
  const u16 = (o: number) => (u8[o] << 8) | u8[o + 1];
  const scanned = new Set<number>();
  while (p + 4 <= u8.length) {
    if (u8[p] !== 0xff) { p++; continue; }
    const m = u8[p + 1];
    if (m === 0xff) { p++; continue; }
    if (m === 0xd9) break;
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { p += 2; continue; }
    const len = u16(p + 2), seg = p + 4, segEnd = p + 2 + len;
    if (m === 0xf7) { // SOF55
      precision = u8[seg]; height = u16(seg + 1); width = u16(seg + 3); comps = u8[seg + 5];
      if (precision < 2 || precision > 16) throw new Error(`JPEG-LS with ${precision}-bit samples is not supported`);
      for (let i = 0; i < comps; i++) { compIds.push(u8[seg + 6 + i * 3]); if (u8[seg + 7 + i * 3] !== 0x11) throw new Error('JPEG-LS with subsampled components is not supported'); }
    } else if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) throw new Error('Not a JPEG-LS stream (another JPEG process)');
    else if (m === 0xf8) { // LSE
      const id = u8[seg];
      if (id === 1) { preset.maxval = u16(seg + 1); preset.t1 = u16(seg + 3); preset.t2 = u16(seg + 5); preset.t3 = u16(seg + 7); preset.reset = u16(seg + 9); }
      else if (id === 4) throw new Error('JPEG-LS pictures larger than 65535 pixels a side are not supported');
      else if (id === 2 || id === 3) { // a mapping table, or the continuation of one (C.2.4.1.2)
        const tid = u8[seg + 1], wt = u8[seg + 2];
        if (!tid || !wt) throw new Error('JPEG-LS: a mapping table with no id or entry width');
        const t = tables.get(tid);
        if (id === 2) tables.set(tid, { width: wt, bytes: Array.from(u8.subarray(seg + 3, segEnd)) });
        else if (!t) throw new Error(`JPEG-LS: a continuation of mapping table ${tid} before the table itself`);
        else if (t.width !== wt) throw new Error(`JPEG-LS: mapping table ${tid} continues with another entry width`);
        else t.bytes.push(...u8.subarray(seg + 3, segEnd));
      } else warnings.push(`JPEG-LS: unknown LSE parameter id ${id} ignored`);
    } else if (m === 0xdd) restart = u16(seg);
    else if (m === 0xda) { // SOS
      if (!width || !height) throw new Error('JPEG-LS: a scan before the frame header');
      const ns = u8[seg], sel: number[] = [];
      for (let i = 0; i < ns; i++) {
        const id = u8[seg + 1 + i * 2], ci = compIds.indexOf(id), tm = u8[seg + 2 + i * 2];
        if (ci < 0) throw new Error(`JPEG-LS: scan of an unknown component ${id}`);
        sel.push(ci);
        if (tm) { if (!tables.has(tm)) throw new Error(`JPEG-LS: the scan names mapping table ${tm}, which the stream does not carry`); if (comps === 1) tableUsed = tm; else if (!warnings.includes('JPEG-LS: mapping tables on a picture with several components are ignored')) warnings.push('JPEG-LS: mapping tables on a picture with several components are ignored'); }
      }
      near = u8[seg + 1 + ns * 2];
      const ilv = u8[seg + 2 + ns * 2], al = u8[seg + 3 + ns * 2] & 0x0f;
      if (al) throw new Error('JPEG-LS with a point transform is not supported');
      if (ns > 1 && ilv === 0) throw new Error('JPEG-LS: several components in a non-interleaved scan');
      if (!data) data = new Uint16Array(width * height * comps);
      p = decodeScan(u8, segEnd, u8.length, data, width, height, comps, sel, ilv, near, precision, preset, restart, warnings);
      for (const c of sel) scanned.add(c);
      if (scanned.size >= comps) break;
      continue;
    }
    p = segEnd;
  }
  if (!data) throw new Error('JPEG-LS: no scan found');
  if (scanned.size < comps) warnings.push(`JPEG-LS: ${comps - scanned.size} of ${comps} components have no scan`);
  if (tableUsed) { // the samples index the table; each entry's bytes become the output samples
    const t = tables.get(tableUsed)!, wt = t.width, entries = Math.floor(t.bytes.length / wt), n = width * height;
    if (!entries) throw new Error(`JPEG-LS: mapping table ${tableUsed} is empty`);
    const outComps = wt === 2 ? 1 : wt, mapped = new Uint16Array(n * outComps);
    let over = false;
    for (let i = 0; i < n; i++) {
      let k = data[i]; if (k >= entries) { k = entries - 1; over = true; }
      const b = k * wt;
      if (wt === 2) mapped[i] = (t.bytes[b] << 8) | t.bytes[b + 1];
      else for (let c = 0; c < wt; c++) mapped[i * wt + c] = t.bytes[b + c];
    }
    if (over) warnings.push(`JPEG-LS: samples beyond the ${entries} entries of mapping table ${tableUsed} take its last entry`);
    return { width, height, comps: outComps, precision: wt === 2 ? 16 : 8, near, data: mapped, warnings, mapped: { id: tableUsed, width: wt, entries } };
  }
  return { width, height, comps, precision, near, data, warnings };
}

function thresholds(maxval: number, near: number): [number, number, number] {
  const B1 = 3, B2 = 7, B3 = 21;
  if (maxval >= 128) {
    const f = Math.floor((Math.min(maxval, 4095) + 128) / 256);
    return [f * (B1 - 2) + 2 + 3 * near, f * (B2 - 3) + 3 + 5 * near, f * (B3 - 4) + 4 + 7 * near];
  }
  const f = Math.floor(256 / (maxval + 1));
  return [Math.max(2, Math.floor(B1 / f) + 3 * near), Math.max(3, Math.floor(B2 / f) + 5 * near), Math.max(4, Math.floor(B3 / f) + 7 * near)];
}

/** One scan of the components `sel` in interleave mode `ilv`; returns the position after its entropy-coded data. */
function decodeScan(u8: Uint8Array, start: number, end: number, out: Uint16Array, W: number, H: number, comps: number, sel: number[], ilv: number, near: number, precision: number, preset: Preset, restart: number, warnings: string[]): number {
  const maxval = preset.maxval || (1 << precision) - 1, reset = preset.reset || 64;
  const [dT1, dT2, dT3] = thresholds(maxval, near);
  const T1 = preset.t1 || dT1, T2 = preset.t2 || dT2, T3 = preset.t3 || dT3;
  const RANGE = Math.floor((maxval + 2 * near) / (2 * near + 1)) + 1;
  const qbpp = Math.ceil(Math.log2(RANGE)), bpp = Math.max(2, Math.ceil(Math.log2(maxval + 1))), LIMIT = 2 * (bpp + Math.max(8, bpp));
  const step = 2 * near + 1, wrap = RANGE * step;
  const A = new Int32Array(729), B = new Int32Array(729), C = new Int32Array(729), N = new Int32Array(729);
  const rA = new Int32Array(2), rN = new Int32Array(2), rNn = new Int32Array(2);
  let runIndex = 0;
  const bits = new Bits(u8, start, end);
  const nc = ilv === 0 ? 1 : sel.length;
  // Reference lines per scanned component: index 0 is the sample left of the line (Rc for x = 0), 1..W the samples, W + 1 a copy of the last (Rd at the edge).
  const prev: Int32Array[] = [], cur: Int32Array[] = [];
  const init = () => {
    const a0 = Math.max(2, Math.floor((RANGE + 32) / 64));
    A.fill(a0); B.fill(0); C.fill(0); N.fill(1); rA.fill(a0); rN.fill(1); rNn.fill(0); runIndex = 0;
    prev.length = cur.length = 0;
    for (let i = 0; i < nc; i++) { prev.push(new Int32Array(W + 2)); cur.push(new Int32Array(W + 2)); }
  };
  init();
  const quant = (d: number): number => (d <= -T3 ? -4 : d <= -T2 ? -3 : d <= -T1 ? -2 : d < -near ? -1 : d <= near ? 0 : d < T1 ? 1 : d < T2 ? 2 : d < T3 ? 3 : 4);
  const golomb = (k: number, limit: number): number => { const q = bits.unary(); return q < limit - qbpp - 1 ? ((q << k) | bits.read(k)) >>> 0 : bits.read(qbpp) + 1; };
  const reconstruct = (px: number, e: number): number => { let rx = px + e; if (rx < -near) rx += wrap; else if (rx > maxval + near) rx -= wrap; return rx < 0 ? 0 : rx > maxval ? maxval : rx; };

  /** A regular-mode sample from its neighbors and quantized gradients (already sign-normalized). */
  const regular = (ra: number, rb: number, rc: number, q1: number, q2: number, q3: number, sign: number): number => {
    const ctx = (q1 + 4) * 81 + (q2 + 4) * 9 + q3 + 4;
    let px = rc >= Math.max(ra, rb) ? Math.min(ra, rb) : rc <= Math.min(ra, rb) ? Math.max(ra, rb) : ra + rb - rc;
    px += sign * C[ctx]; if (px < 0) px = 0; else if (px > maxval) px = maxval;
    let k = 0; while (N[ctx] << k < A[ctx]) k++;
    const m = golomb(k, LIMIT);
    let e: number;
    if (near === 0 && k === 0 && 2 * B[ctx] <= -N[ctx]) e = m & 1 ? m >> 1 : -(m >> 1) - 1; // A.5.2: the mapping with the sign swapped
    else e = m & 1 ? -((m + 1) >> 1) : m >> 1;
    B[ctx] += e * step; A[ctx] += Math.abs(e);
    if (N[ctx] === reset) { A[ctx] >>= 1; B[ctx] >>= 1; N[ctx] >>= 1; }
    N[ctx]++;
    if (B[ctx] <= -N[ctx]) { B[ctx] += N[ctx]; if (C[ctx] > -128) C[ctx]--; if (B[ctx] <= -N[ctx]) B[ctx] = -N[ctx] + 1; }
    else if (B[ctx] > 0) { B[ctx] -= N[ctx]; if (C[ctx] < 127) C[ctx]++; if (B[ctx] > 0) B[ctx] = 0; }
    return reconstruct(px, sign * e * step);
  };
  /** A run-interruption sample: type 1 (Ra ≈ Rb, predicted from Ra) or type 0 (from Rb, the sign from Ra vs Rb). */
  const interruption = (ra: number, rb: number, type: number): number => {
    const temp = rA[type] + (type ? rN[type] >> 1 : 0);
    let k = 0; while (rN[type] << k < temp) k++;
    const em = golomb(k, LIMIT - J[runIndex] - 1), t = em + type, map = t & 1, abs = (t + map) >> 1;
    const e = (k !== 0 || 2 * rNn[type] >= rN[type]) === !!map ? -abs : abs;
    if (e < 0) rNn[type]++;
    rA[type] += (em + 1 - type) >> 1;
    if (rN[type] === reset) { rA[type] >>= 1; rN[type] >>= 1; rNn[type] >>= 1; }
    rN[type]++;
    return type ? reconstruct(ra, e * step) : reconstruct(rb, (ra > rb ? -1 : 1) * e * step);
  };

  let line = 0;
  const q = new Int32Array(3), runIndices = new Int32Array(nc);
  for (let y = 0; y < H; y++) {
    if (restart && line && line % restart === 0) { // an RSTn marker, then everything starts afresh (the reference line too)
      let m = bits.resume();
      while (m + 1 < end && !(u8[m] === 0xff && u8[m + 1] >= 0xd0 && u8[m + 1] <= 0xd7)) m++;
      if (m + 1 < end) { bits.p = m + 2; init(); runIndices.fill(0); } else warnings.push('JPEG-LS: a restart marker is missing');
    }
    line++;
    for (let i = 0; i < nc; i++) cur[i][0] = prev[i][1];
    if (ilv === 1) { for (let i = 0; i < nc; i++) { runIndex = runIndices[i]; decodeLine(cur[i], prev[i]); runIndices[i] = runIndex; } } // line interleaved: each component's line in turn, the contexts shared, RUNindex per component
    else if (ilv === 2) decodeLineSamples(cur, prev);
    else decodeLine(cur[0], prev[0]);
    for (let i = 0; i < nc; i++) {
      const c = sel[i], row = cur[i];
      for (let x = 0; x < W; x++) out[(y * W + x) * comps + c] = row[x + 1];
      row[W + 1] = row[W];
      const t = prev[i]; prev[i] = row; cur[i] = t;
    }
  }
  return bits.resume();

  function decodeLine(row: Int32Array, up: Int32Array): void {
    let x = 0;
    while (x < W) {
      const ra = row[x], rb = up[x + 1], rc = up[x], rd = up[x + 2];
      const d1 = rd - rb, d2 = rb - rc, d3 = rc - ra;
      if (Math.abs(d1) <= near && Math.abs(d2) <= near && Math.abs(d3) <= near) { // run mode
        for (;;) {
          if (bits.bit()) {
            const n = 1 << J[runIndex], take = Math.min(n, W - x);
            for (let i = 0; i < take; i++) row[x + 1 + i] = ra;
            x += take;
            if (take === n && runIndex < 31) runIndex++;
            if (x >= W) break;
          } else {
            const n = bits.read(J[runIndex]);
            for (let i = 0; i < n; i++) row[x + 1 + i] = ra;
            x += n;
            const rb2 = up[x + 1];
            row[x + 1] = interruption(ra, rb2, Math.abs(ra - rb2) <= near ? 1 : 0); // coded with the run's J[RUNindex]
            if (runIndex > 0) runIndex--;
            x++;
            break;
          }
        }
        continue;
      }
      q[0] = quant(d1); q[1] = quant(d2); q[2] = quant(d3);
      let sign = 1;
      if (q[0] < 0 || (q[0] === 0 && (q[1] < 0 || (q[1] === 0 && q[2] < 0)))) { sign = -1; q[0] = -q[0]; q[1] = -q[1]; q[2] = -q[2]; }
      row[x + 1] = regular(ra, rb, rc, q[0], q[1], q[2], sign);
      x++;
    }
  }
  /** Sample interleaved: the components of each pixel in turn; run mode only when every component's gradients are flat. */
  function decodeLineSamples(rows: Int32Array[], ups: Int32Array[]): void {
    const n = rows.length;
    let x = 0;
    while (x < W) {
      let run = true;
      for (let i = 0; i < n && run; i++) {
        const ra = rows[i][x], rb = ups[i][x + 1], rc = ups[i][x], rd = ups[i][x + 2];
        if (Math.abs(rd - rb) > near || Math.abs(rb - rc) > near || Math.abs(rc - ra) > near) run = false;
      }
      if (run) {
        for (;;) {
          if (bits.bit()) {
            const len = 1 << J[runIndex], take = Math.min(len, W - x);
            for (let i = 0; i < n; i++) { const ra = rows[i][x]; for (let j = 0; j < take; j++) rows[i][x + 1 + j] = ra; }
            x += take;
            if (take === len && runIndex < 31) runIndex++;
            if (x >= W) break;
          } else {
            const len = bits.read(J[runIndex]);
            for (let i = 0; i < n; i++) { const ra = rows[i][x]; for (let j = 0; j < len; j++) rows[i][x + 1 + j] = ra; }
            x += len;
            for (let i = 0; i < n; i++) rows[i][x + 1] = interruption(rows[i][x], ups[i][x + 1], 0);
            if (runIndex > 0) runIndex--;
            x++;
            break;
          }
        }
        continue;
      }
      for (let i = 0; i < n; i++) {
        const row = rows[i], up = ups[i];
        const ra = row[x], rb = up[x + 1], rc = up[x], rd = up[x + 2];
        q[0] = quant(rd - rb); q[1] = quant(rb - rc); q[2] = quant(rc - ra);
        let sign = 1;
        if (q[0] < 0 || (q[0] === 0 && (q[1] < 0 || (q[1] === 0 && q[2] < 0)))) { sign = -1; q[0] = -q[0]; q[1] = -q[1]; q[2] = -q[2]; }
        row[x + 1] = regular(ra, rb, rc, q[0], q[1], q[2], sign);
      }
      x++;
    }
  }
}
