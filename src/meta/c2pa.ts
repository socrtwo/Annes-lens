/**
 * Content Credentials (C2PA 1.x manifests, as the C2PA technical specification describes them): a manifest store in
 * JUMBF boxes with an assertion store (c2pa.actions with the AI provenance, c2pa.hash.data over the file), a claim and
 * its COSE_Sign1 signature (ES256, the signing certificate in the x5chain header), embedded in JPEG files as APP11
 * segments and in PNG files as a caBX chunk. The signer is a self-signed ECDSA P-256 certificate the app makes on the
 * device and keeps in the keystore: validators report the hashes and signature as sound and the signer as not on
 * their trust list, which is the truth. The reader parses a store back, checks the hashes and the signature with the
 * embedded certificate, and reports what it found for the details pane.
 */
import { cborEncode, cborDecode, Tagged } from './cbor';
import { selfSignedCertificate, readCertificate, type CertInfo } from './der';
import { crc32 } from './metaWrite';

const enc = new TextEncoder(), dec = new TextDecoder();
const SUFFIX = [0x00, 0x11, 0x00, 0x10, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71];
const uuid = (type: string): Uint8Array => new Uint8Array([...enc.encode(type), ...SUFFIX]);
const UUID = { store: uuid('c2pa'), manifest: uuid('c2ma'), assertions: uuid('c2as'), claim: uuid('c2cl'), signature: uuid('c2cs'), cbor: uuid('cbor'), json: uuid('json') };
const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const concat = (parts: Uint8Array[]): Uint8Array => { const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const box = (type: string, body: Uint8Array): Uint8Array => concat([new Uint8Array([...u32(8 + body.length), ...enc.encode(type)]), body]);
const describe = (id: Uint8Array, label: string): Uint8Array => box('jumd', concat([id, new Uint8Array([0x03]), enc.encode(label), new Uint8Array([0])]));
const superbox = (id: Uint8Array, label: string, ...content: Uint8Array[]): Uint8Array => box('jumb', concat([describe(id, label), ...content]));
const sha256 = async (u8: Uint8Array): Promise<Uint8Array> => new Uint8Array(await crypto.subtle.digest('SHA-256', u8 as BufferSource));
const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
const uuidString = (): string => { const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80; const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };

// ---- The signer -------------------------------------------------------------------------------------------------

export interface Signer { privateKey: CryptoKey; cert: Uint8Array }
export interface StoredSigner { pkcs8: string; cert: string; created: string }
const b64 = (u8: Uint8Array): string => btoa(String.fromCharCode(...u8));
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** A new signing key and its self-signed certificate (10 years), in the form the keystore holds. */
export async function makeSigner(commonName: string, organization?: string): Promise<StoredSigner> {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const cert = await selfSignedCertificate(keys, { commonName, organization });
  return { pkcs8: b64(new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey))), cert: b64(cert), created: new Date().toISOString() };
}
export async function loadSigner(s: StoredSigner): Promise<Signer> {
  const privateKey = await crypto.subtle.importKey('pkcs8', unb64(s.pkcs8) as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return { privateKey, cert: unb64(s.cert) };
}

// ---- Building a manifest ----------------------------------------------------------------------------------------

export interface ManifestInput {
  /** The file's name (dc:title) and MIME type (dc:format). */
  title: string; format: 'image/jpeg' | 'image/png';
  generator: { name: string; version: string };
  /** The creation or edit: what made it and how. */
  action: { action: 'c2pa.created' | 'c2pa.edited'; when: string; softwareAgent: string; digitalSourceType: string; description?: string; parameters?: Record<string, string> };
  /** Further actions (edits done afterwards in the app). */
  more?: { action: string; when: string; softwareAgent?: string; description?: string }[];
}

interface Built { store: Uint8Array; hashAt: number }
/** The manifest store bytes for a file whose hash-excluded range is known; `hash` fills c2pa.hash.data (zeros while sizing). */
async function buildStore(input: ManifestInput, signer: Signer, exclusion: { start: number; length: number }, hash: Uint8Array, manifestLabel: string, instance: string): Promise<Built> {
  const actions = { actions: [{ action: input.action.action, when: input.action.when, softwareAgent: input.action.softwareAgent, digitalSourceType: input.action.digitalSourceType, ...(input.action.description ? { description: input.action.description } : {}), ...(input.action.parameters ? { parameters: input.action.parameters } : {}) }, ...(input.more || []).map((a) => ({ action: a.action, when: a.when, ...(a.softwareAgent ? { softwareAgent: a.softwareAgent } : {}), ...(a.description ? { description: a.description } : {}) }))] };
  const hashData = { exclusions: [{ start: exclusion.start, length: exclusion.length }], alg: 'sha256', hash, name: 'jumbf manifest', pad: new Uint8Array(0) };
  const assertionBoxes = [
    { label: 'c2pa.actions', bytes: superbox(UUID.cbor, 'c2pa.actions', box('cbor', cborEncode(actions))) },
    { label: 'c2pa.hash.data', bytes: superbox(UUID.cbor, 'c2pa.hash.data', box('cbor', cborEncode(hashData))) },
  ];
  const hashed = [];
  for (const a of assertionBoxes) hashed.push({ url: `self#jumbf=c2pa.assertions/${a.label}`, alg: 'sha256', hash: await sha256(a.bytes.subarray(8)) }); // the box's content after its LBox/TBox header
  const claim = { 'dc:title': input.title, 'dc:format': input.format, instanceID: instance, claim_generator: `${input.generator.name.replace(/\s+/g, '_')}/${input.generator.version}`, claim_generator_info: [{ name: input.generator.name, version: input.generator.version }], signature: 'self#jumbf=c2pa.signature', assertions: hashed, alg: 'sha256' };
  const claimBytes = cborEncode(claim);
  // COSE_Sign1 (RFC 9052): protected header with the algorithm and the certificate chain; the claim is the detached payload.
  const protectedHeader = cborEncode(new Map<number, unknown>([[1, -7], [33, [signer.cert]]]));
  const sigStructure = cborEncode(['Signature1', protectedHeader, new Uint8Array(0), claimBytes]);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signer.privateKey, sigStructure as BufferSource));
  const cose = cborEncode(new Tagged(18, [protectedHeader, new Map(), null, signature]));
  const manifest = superbox(UUID.manifest, manifestLabel,
    superbox(UUID.assertions, 'c2pa.assertions', ...assertionBoxes.map((a) => a.bytes)),
    superbox(UUID.claim, 'c2pa.claim', box('cbor', claimBytes)),
    superbox(UUID.signature, 'c2pa.signature', box('cbor', cose)));
  const store = superbox(UUID.store, 'c2pa', manifest);
  return { store, hashAt: 0 };
}

/** The exclusion's length is inside the hashed assertion, so the store is rebuilt until its size no longer moves. */
async function settle(build: (length: number) => Promise<Uint8Array>): Promise<Uint8Array> {
  let len = 0, out = await build(0);
  for (let i = 0; i < 4 && out.length !== len; i++) { len = out.length; out = await build(len); }
  if (out.length !== len) throw new Error('C2PA: the manifest size did not settle');
  return out;
}

/** Where a JPEG's APP11 manifest goes: after the leading APPn segments (Exif stays first), before the tables and frame. */
function jpegInsertAt(u8: Uint8Array): number {
  let p = 2;
  while (p + 4 <= u8.length && u8[p] === 0xff) {
    const m = u8[p + 1];
    if (m >= 0xe0 && m <= 0xef) { p += 2 + ((u8[p + 2] << 8) | u8[p + 3]); continue; }
    break;
  }
  return p;
}
const APP11_MAX = 65535 - 2 - 2 - 2 - 4 - 8; // the payload a segment holds after Lp, 'JP', En, Z and the box header
function app11Segments(store: Uint8Array): Uint8Array {
  const header = store.subarray(0, 8), payload = store.subarray(8), parts: Uint8Array[] = [];
  for (let z = 1, o = 0; o < payload.length || z === 1; z++) {
    const chunk = payload.subarray(o, o + APP11_MAX);
    const len = 2 + 2 + 2 + 4 + 8 + chunk.length;
    parts.push(new Uint8Array([0xff, 0xeb, len >> 8, len & 255, 0x4a, 0x50, 0, 1, ...u32(z)]), header, chunk);
    o += chunk.length;
  }
  return concat(parts);
}

/** Embeds a signed manifest in a JPEG or PNG; the file comes back with its Content Credentials. */
export async function embedManifest(file: Uint8Array, input: ManifestInput, signer: Signer): Promise<Uint8Array> {
  const label = `urn:uuid:${uuidString()}`, instance = `xmp:iid:${uuidString()}`;
  if (input.format === 'image/jpeg') {
    if (file[0] !== 0xff || file[1] !== 0xd8) throw new Error('Not a JPEG file');
    const at = jpegInsertAt(file);
    const hash = await sha256(file); // the file without the manifest segments, which the exclusion removes
    const final = await settle((len) => buildStore(input, signer, { start: at, length: len }, hash, label, instance).then((b) => app11Segments(b.store)));
    return concat([file.subarray(0, at), final, file.subarray(at)]);
  }
  if (file.length < 8 || file[0] !== 0x89 || file[1] !== 0x50) throw new Error('Not a PNG file');
  // After IHDR (and PLTE if present), before the image data.
  let at = 8, p = 8;
  while (p + 8 <= file.length) { const len = ((file[p] << 24) | (file[p + 1] << 16) | (file[p + 2] << 8) | file[p + 3]) >>> 0, type = dec.decode(file.subarray(p + 4, p + 8)); if (type === 'IHDR' || type === 'PLTE') { at = p + 12 + len; p = at; continue; } break; }
  const chunk = (store: Uint8Array): Uint8Array => { const body = concat([enc.encode('caBX'), store]); return concat([new Uint8Array(u32(store.length)), body, new Uint8Array(u32(crc32(body)))]); };
  const hash = await sha256(file);
  const final = await settle((len) => buildStore(input, signer, { start: at, length: len }, hash, label, instance).then((b) => chunk(b.store)));
  return concat([file.subarray(0, at), final, file.subarray(at)]);
}

// ---- Reading a manifest --------------------------------------------------------------------------------------

interface Box { type: string; at: number; end: number; body: Uint8Array; label?: string; id?: Uint8Array; children?: Box[] }
function parseBoxes(u8: Uint8Array, start = 0, end = u8.length): Box[] {
  const out: Box[] = [];
  let p = start;
  while (p + 8 <= end) {
    let len = ((u8[p] << 24) | (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3]) >>> 0;
    const type = dec.decode(u8.subarray(p + 4, p + 8));
    if (len === 0) len = end - p;
    if (len < 8 || p + len > end) break;
    const b: Box = { type, at: p, end: p + len, body: u8.subarray(p + 8, p + len) };
    if (type === 'jumb') {
      const kids = parseBoxes(u8, p + 8, p + len), d = kids.find((k) => k.type === 'jumd');
      if (d) { b.id = d.body.subarray(0, 16); const toggles = d.body[16]; if (toggles & 2) { let e = 17; while (e < d.body.length && d.body[e]) e++; b.label = dec.decode(d.body.subarray(17, e)); } }
      b.children = kids.filter((k) => k.type !== 'jumd');
    }
    out.push(b);
    p += len;
  }
  return out;
}

export interface ManifestInfo {
  title?: string; format?: string; generator?: string; instanceID?: string; label: string;
  actions: { action: string; when?: string; softwareAgent?: string; digitalSourceType?: string; description?: string; parameters?: Record<string, string> }[];
  signer?: CertInfo & { der: Uint8Array };
  /** What checked out: the file hash, the assertion hashes, the signature. */
  checks: { hash: boolean | null; assertions: boolean; signature: boolean | null };
  problems: string[];
}

/** The embedded manifest store of a JPEG or PNG (the bytes and where they sit), or null. */
export function findManifestStore(u8: Uint8Array): { store: Uint8Array; exclusions: { start: number; length: number }[] } | null {
  if (u8[0] === 0xff && u8[1] === 0xd8) {
    const parts: Uint8Array[] = [], exclusions: { start: number; length: number }[] = [];
    let p = 2, header: Uint8Array | null = null;
    while (p + 4 <= u8.length && u8[p] === 0xff) {
      const m = u8[p + 1], len = (u8[p + 2] << 8) | u8[p + 3];
      if (m === 0xda) break;
      if (m === 0xeb && u8[p + 4] === 0x4a && u8[p + 5] === 0x50 && len >= 2 + 2 + 2 + 4 + 8) {
        const seg = u8.subarray(p + 4 + 8, p + 2 + len), h = seg.subarray(0, 8), isC2pa = dec.decode(h.subarray(4, 8)) === 'jumb';
        if (isC2pa) { if (!header) header = h; parts.push(seg.subarray(8)); const last = exclusions[exclusions.length - 1]; if (last && last.start + last.length === p) last.length += 2 + len; else exclusions.push({ start: p, length: 2 + len }); }
      }
      p += 2 + len;
    }
    if (!header) return null;
    return { store: concat([header, ...parts]), exclusions };
  }
  if (u8[0] === 0x89 && u8[1] === 0x50) {
    let p = 8;
    while (p + 8 <= u8.length) {
      const len = ((u8[p] << 24) | (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3]) >>> 0, type = dec.decode(u8.subarray(p + 4, p + 8));
      if (type === 'caBX') return { store: u8.subarray(p + 8, p + 8 + len), exclusions: [{ start: p, length: 12 + len }] };
      if (type === 'IDAT' || type === 'IEND') break;
      p += 12 + len;
    }
  }
  return null;
}

/** Reads and verifies the active manifest of a file; null when it has none. */
export async function readManifest(u8: Uint8Array): Promise<ManifestInfo | null> {
  const found = findManifestStore(u8);
  if (!found) return null;
  const problems: string[] = [];
  const [store] = parseBoxes(found.store);
  if (!store || store.type !== 'jumb' || store.label !== 'c2pa') return null;
  const manifests = (store.children || []).filter((b) => b.type === 'jumb');
  const m = manifests[manifests.length - 1];
  if (!m) return null;
  const info: ManifestInfo = { label: m.label || '', actions: [], checks: { hash: null, assertions: true, signature: null }, problems };
  const find = (label: string) => (m.children || []).find((b) => b.label === label);
  const cborOf = (b: Box | undefined): any => { const c = b?.children?.find((k) => k.type === 'cbor'); return c ? cborDecode(c.body) : null; };
  const claimBox = find('c2pa.claim'), claim = cborOf(claimBox);
  if (!claim || typeof claim !== 'object') { problems.push('no claim'); return info; }
  info.title = claim['dc:title']; info.format = claim['dc:format']; info.generator = claim.claim_generator_info?.[0] ? `${claim.claim_generator_info[0].name} ${claim.claim_generator_info[0].version || ''}`.trim() : claim.claim_generator; info.instanceID = claim.instanceID;
  const assertions = find('c2pa.assertions');
  for (const h of claim.assertions || []) {
    const label = String(h.url || '').replace(/^self#jumbf=c2pa\.assertions\//, '');
    const a = assertions?.children?.find((b) => b.label === label);
    if (!a) { info.checks.assertions = false; problems.push(`assertion ${label} missing`); continue; }
    if (!same(await sha256(found.store.subarray(a.at + 8, a.end)), h.hash)) { info.checks.assertions = false; problems.push(`assertion ${label} changed`); }
    const v = cborOf(a);
    if (label === 'c2pa.actions' && v?.actions) info.actions = v.actions.map((x: any) => ({ action: x.action, when: x.when, softwareAgent: x.softwareAgent, digitalSourceType: x.digitalSourceType, description: x.description, parameters: x.parameters }));
    if (label === 'c2pa.hash.data' && v) {
      const ex: { start: number; length: number }[] = (v.exclusions || []).map((e: any) => ({ start: e.start, length: e.length })).sort((a: any, b: any) => a.start - b.start);
      const parts: Uint8Array[] = []; let p = 0;
      for (const e of ex) { parts.push(u8.subarray(p, e.start)); p = e.start + e.length; }
      parts.push(u8.subarray(p));
      info.checks.hash = same(await sha256(concat(parts)), v.hash);
      if (!info.checks.hash) problems.push('the picture data changed since it was signed');
    }
  }
  // The signature: COSE_Sign1 over the claim bytes, verified with the certificate in the header.
  const sigBox = find('c2pa.signature')?.children?.find((k) => k.type === 'cbor');
  const claimBytes = claimBox?.children?.find((k) => k.type === 'cbor')?.body;
  if (sigBox && claimBytes) {
    try {
      let cose: any = cborDecode(sigBox.body);
      if (cose instanceof Tagged) cose = cose.value;
      const [prot, unprot, , signature] = cose as [Uint8Array, Map<unknown, unknown>, unknown, Uint8Array];
      const ph: any = cborDecode(prot), chain = (ph instanceof Map ? ph.get(33) : null) || (unprot instanceof Map ? unprot.get(33) : null), alg = ph instanceof Map ? ph.get(1) : null;
      const certDer: Uint8Array | undefined = Array.isArray(chain) ? chain[0] : chain instanceof Uint8Array ? chain : undefined;
      if (certDer) {
        const cert = readCertificate(certDer);
        info.signer = { ...cert, der: certDer };
        if (alg === -7) {
          const key = await crypto.subtle.importKey('spki', cert.spki as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
          const sigStructure = cborEncode(['Signature1', prot, new Uint8Array(0), claimBytes]);
          info.checks.signature = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature as BufferSource, sigStructure as BufferSource);
          if (!info.checks.signature) problems.push('the signature does not match the claim');
        } else problems.push(`signature algorithm ${alg} is not checked here (only ES256 is)`);
      } else problems.push('no certificate in the signature');
    } catch (e) { problems.push(`the signature could not be read: ${(e as Error).message}`); }
  } else problems.push('no signature');
  return info;
}

/** One line for the details pane. */
export function describeManifest(m: ManifestInfo): string {
  const ok = m.checks.hash === true && m.checks.assertions && m.checks.signature === true;
  const who = m.signer ? `${m.signer.subject}${m.signer.organization ? ` (${m.signer.organization})` : ''}${m.signer.selfSigned ? ', self-signed' : ''}` : 'unknown signer';
  const acts = m.actions.map((a) => `${a.action.replace(/^c2pa\./, '')}${a.digitalSourceType ? ` (${a.digitalSourceType.replace(/^.*\//, '')})` : ''}${a.softwareAgent ? ` by ${a.softwareAgent}` : ''}${a.when ? ` on ${a.when.slice(0, 10)}` : ''}`).join('; ');
  return `${ok ? 'valid' : m.problems.length ? `not valid: ${m.problems.join(', ')}` : 'partly checked'}; signed by ${who}; ${acts || 'no actions'}${m.generator ? `; made by ${m.generator}` : ''}`;
}
