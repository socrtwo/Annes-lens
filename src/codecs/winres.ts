/**
 * Icons and cursors inside Windows programs and libraries: 32- and 64-bit (PE) .exe, .dll, .icl, .ocx, .cpl, .scr
 * files and 16-bit (NE) ones, such as Windows 3.x icon libraries (.icl), read from their resource directories by
 * the app's own code. Each icon or cursor group (RT_GROUP_ICON, RT_GROUP_CURSOR) is put back together as the .ico or
 * .cur file it was made from (the same bytes), for the icon reader to show.
 */
const le16 = (u: Uint8Array, o: number) => u[o] | (u[o + 1] << 8);
const le32 = (u: Uint8Array, o: number) => (u[o] | (u[o + 1] << 8) | (u[o + 2] << 16) | (u[o + 3] << 24)) >>> 0;
export const RT = { CURSOR: 1, ICON: 3, GROUP_CURSOR: 12, GROUP_ICON: 14 } as const;

export interface Resource { type: number; id: number | string; data: Uint8Array }
export interface IconGroup { kind: 'icon' | 'cursor'; id: number | string; file: Uint8Array; sizes: string[] }

/** 'pe' or 'ne' for a Windows module (an "MZ" file with a PE or NE header), else null. */
export function winModuleKind(u8: Uint8Array): 'pe' | 'ne' | null {
  if (u8.length < 64 || u8[0] !== 0x4d || u8[1] !== 0x5a) return null;
  const at = le32(u8, 0x3c);
  if (at < 64 || at + 64 > u8.length) return null;
  if (u8[at] === 0x50 && u8[at + 1] === 0x45 && u8[at + 2] === 0 && u8[at + 3] === 0) return 'pe';
  if (u8[at] === 0x4e && u8[at + 1] === 0x45) return 'ne';
  return null;
}

/** Every resource of the module (the first language of each). */
export function resources(u8: Uint8Array): Resource[] {
  const kind = winModuleKind(u8);
  if (kind === 'pe') return peResources(u8);
  if (kind === 'ne') return neResources(u8);
  return [];
}

function peResources(u8: Uint8Array): Resource[] {
  const pe = le32(u8, 0x3c), sections = le16(u8, pe + 6), optSize = le16(u8, pe + 20), opt = pe + 24;
  const magic = le16(u8, opt), dirs = opt + (magic === 0x20b ? 112 : 96);
  if (le32(u8, opt + (magic === 0x20b ? 108 : 92)) < 3) return [];
  const rsrcRva = le32(u8, dirs + 16), rsrcSize = le32(u8, dirs + 20);
  if (!rsrcRva || !rsrcSize) return [];
  const sec = opt + optSize, table: { va: number; size: number; raw: number }[] = [];
  for (let i = 0; i < sections; i++) { const s = sec + i * 40; table.push({ va: le32(u8, s + 12), size: Math.max(le32(u8, s + 8), le32(u8, s + 16)), raw: le32(u8, s + 20) }); }
  const off = (rva: number) => { for (const s of table) if (rva >= s.va && rva < s.va + s.size) return rva - s.va + s.raw; return -1; };
  const base = off(rsrcRva);
  if (base < 0) return [];
  const name = (o: number): string => { const p = base + (o & 0x7fffffff), n = le16(u8, p); let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(le16(u8, p + 2 + i * 2)); return s; };
  const entries = (dirOff: number) => {
    const p = base + dirOff, n = le16(u8, p + 12) + le16(u8, p + 14), out: { id: number | string; target: number; dir: boolean }[] = [];
    for (let i = 0; i < n && p + 16 + i * 8 + 8 <= u8.length; i++) {
      const e = p + 16 + i * 8, nm = le32(u8, e), to = le32(u8, e + 4);
      out.push({ id: nm & 0x80000000 ? name(nm) : nm, target: to & 0x7fffffff, dir: !!(to & 0x80000000) });
    }
    return out;
  };
  const out: Resource[] = [];
  let guard = 0;
  for (const t of entries(0)) {
    if (!t.dir || typeof t.id !== 'number') continue;
    for (const r of entries(t.target)) {
      if (!r.dir) continue;
      const lang = entries(r.target)[0];
      if (!lang || lang.dir || guard++ > 100000) continue;
      const de = base + lang.target, dataOff = off(le32(u8, de)), size = le32(u8, de + 4);
      if (dataOff >= 0 && dataOff + size <= u8.length) out.push({ type: t.id, id: r.id, data: u8.subarray(dataOff, dataOff + size) });
    }
  }
  return out;
}

function neResources(u8: Uint8Array): Resource[] {
  const ne = le32(u8, 0x3c), rt = ne + le16(u8, ne + 0x24);
  if (rt >= u8.length) return [];
  const shift = le16(u8, rt), out: Resource[] = [];
  let p = rt + 2;
  while (p + 8 <= u8.length) {
    const type = le16(u8, p); if (!type) break;
    const count = le16(u8, p + 2); p += 8;
    for (let i = 0; i < count && p + 12 <= u8.length; i++, p += 12) {
      const o = le16(u8, p) * 2 ** shift, len = le16(u8, p + 2) * 2 ** shift, rid = le16(u8, p + 6);
      const id: number | string = rid & 0x8000 ? rid & 0x7fff : neName(u8, rt + rid);
      if (type & 0x8000 && o + len <= u8.length) out.push({ type: type & 0x7fff, id, data: u8.subarray(o, o + len) });
    }
  }
  return out;
}
const neName = (u8: Uint8Array, p: number) => new TextDecoder('latin1').decode(u8.subarray(p + 1, p + 1 + u8[p]));

/** The icon and cursor groups, each as the .ico or .cur file it was made from. */
export function iconGroups(u8: Uint8Array, max = 1000): IconGroup[] {
  const res = resources(u8), out: IconGroup[] = [];
  const find = (type: number, id: number) => res.find((r) => r.type === type && r.id === id);
  for (const g of res) {
    if (out.length >= max) break;
    if (g.type !== RT.GROUP_ICON && g.type !== RT.GROUP_CURSOR) continue;
    const cursor = g.type === RT.GROUP_CURSOR, d = g.data, n = le16(d, 4);
    if (d.length < 6 + n * 14) continue;
    const images: { head: number[]; data: Uint8Array; hot?: [number, number] }[] = [], sizes: string[] = [];
    for (let i = 0; i < n; i++) {
      const e = 6 + i * 14, id = le16(d, e + 12), r = find(cursor ? RT.CURSOR : RT.ICON, id);
      if (!r) continue;
      if (cursor) {
        // A cursor resource starts with its hotspot; the group gives the width and twice the height.
        const hx = le16(r.data, 0), hy = le16(r.data, 2), dib = r.data.subarray(4);
        const w = le16(d, e), h = le16(d, e + 2) / 2, bits = le16(d, e + 6), dibBits = le32(dib, 0) === 40 ? le16(dib, 14) : bits;
        const size = le32(d, e + 8) - 4;
        images.push({ head: [w >= 256 ? 0 : w, h >= 256 ? 0 : h, dibBits <= 8 ? (1 << dibBits) & 0xff : 0, 0, hx, hy], data: dib.subarray(0, Math.max(0, Math.min(size, dib.length))) });
        sizes.push(`${w} × ${h}`);
      } else {
        const size = le32(d, e + 8);
        images.push({ head: [d[e], d[e + 1], d[e + 2], d[e + 3], le16(d, e + 4), le16(d, e + 6)], data: r.data.subarray(0, Math.min(size, r.data.length)) });
        sizes.push(`${d[e] || 256} × ${d[e + 1] || 256}`);
      }
    }
    if (!images.length) continue;
    const head = 6 + images.length * 16, total = head + images.reduce((s, x) => s + x.data.length, 0);
    const file = new Uint8Array(total), dv = new DataView(file.buffer);
    dv.setUint16(2, cursor ? 2 : 1, true); dv.setUint16(4, images.length, true);
    let o = head;
    images.forEach((im, i) => {
      const e = 6 + i * 16;
      file[e] = im.head[0]; file[e + 1] = im.head[1]; file[e + 2] = im.head[2]; file[e + 3] = im.head[3];
      dv.setUint16(e + 4, im.head[4], true); dv.setUint16(e + 6, im.head[5], true); dv.setUint32(e + 8, im.data.length, true); dv.setUint32(e + 12, o, true);
      file.set(im.data, o); o += im.data.length;
    });
    out.push({ kind: cursor ? 'cursor' : 'icon', id: g.id, file, sizes });
  }
  return out;
}
