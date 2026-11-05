/**
 * ASN.1 DER, as much as a self-signed X.509 signing certificate needs (RFC 5280): an encoder for the TBSCertificate
 * with its names, validity, subject public key, key usage, extended key usage and basic constraints, the ECDSA
 * signature wrapped as a SEQUENCE of two INTEGERs, and a reader that walks a certificate back for its subject name,
 * validity and public key. Keys are ECDSA P-256 through WebCrypto; signatures use SHA-256.
 */
const enc = new TextEncoder();
export const OID = {
  ecPublicKey: '1.2.840.10045.2.1', p256: '1.2.840.10045.3.1.7', ecdsaWithSha256: '1.2.840.10045.4.3.2',
  commonName: '2.5.4.3', organization: '2.5.4.10', basicConstraints: '2.5.29.19', keyUsage: '2.5.29.15', extKeyUsage: '2.5.29.37', subjectKeyId: '2.5.29.14', authorityKeyId: '2.5.29.35',
  emailProtection: '1.3.6.1.5.5.7.3.4', documentSigning: '1.3.6.1.5.5.7.3.36',
};

export function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  const b: number[] = []; let v = n; while (v) { b.unshift(v & 255); v = Math.floor(v / 256); }
  return [0x80 | b.length, ...b];
}
export const tlv = (tag: number, body: Uint8Array | number[]): Uint8Array => new Uint8Array([tag, ...derLength(body.length), ...body]);
export const seq = (...parts: Uint8Array[]): Uint8Array => tlv(0x30, concat(parts));
export const set = (...parts: Uint8Array[]): Uint8Array => tlv(0x31, concat(parts));
export const concat = (parts: Uint8Array[]): Uint8Array => { const n = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
export function oid(s: string): Uint8Array {
  const parts = s.split('.').map(Number), body: number[] = [parts[0] * 40 + parts[1]];
  for (const p of parts.slice(2)) { const b: number[] = []; let v = p; do { b.unshift(v & 127); v = Math.floor(v / 128); } while (v); for (let i = 0; i < b.length - 1; i++) b[i] |= 128; body.push(...b); }
  return tlv(0x06, body);
}
export function integer(v: number | Uint8Array): Uint8Array {
  let b: number[];
  if (typeof v === 'number') { b = []; let x = v; do { b.unshift(x & 255); x = Math.floor(x / 256); } while (x); }
  else { b = Array.from(v); while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b.shift(); }
  if (b[0] & 0x80) b.unshift(0);
  return tlv(0x02, b);
}
export const utf8 = (s: string): Uint8Array => tlv(0x0c, enc.encode(s));
export const printable = (s: string): Uint8Array => tlv(0x13, enc.encode(s));
export const bitString = (bytes: Uint8Array, unused = 0): Uint8Array => tlv(0x03, [unused, ...bytes]);
export const octets = (bytes: Uint8Array): Uint8Array => tlv(0x04, bytes);
export const bool = (v: boolean): Uint8Array => tlv(0x01, [v ? 0xff : 0]);
export const explicit = (n: number, body: Uint8Array): Uint8Array => tlv(0xa0 | n, body);
export const utcTime = (d: Date): Uint8Array => tlv(0x17, enc.encode(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));
export const generalizedTime = (d: Date): Uint8Array => tlv(0x18, enc.encode(d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z'));
const time = (d: Date): Uint8Array => (d.getUTCFullYear() < 2050 ? utcTime(d) : generalizedTime(d));
export const name = (cn: string, o?: string): Uint8Array => seq(...(o ? [set(seq(oid(OID.organization), utf8(o)))] : []), set(seq(oid(OID.commonName), utf8(cn))));
export const algorithm = (id: string, params?: Uint8Array): Uint8Array => seq(oid(id), ...(params ? [params] : []));

/** Raw r||s (as WebCrypto gives it) to the DER SEQUENCE of two INTEGERs a certificate carries. */
export function ecdsaRawToDer(raw: Uint8Array): Uint8Array { const h = raw.length / 2; return seq(integer(raw.subarray(0, h)), integer(raw.subarray(h))); }
/** The DER signature back to raw r||s of `size` bytes each. */
export function ecdsaDerToRaw(der: Uint8Array, size = 32): Uint8Array {
  const s = read(der, 0); if (s.tag !== 0x30) throw new Error('DER: not a signature');
  const r = read(der, s.start), t = read(der, r.end);
  const out = new Uint8Array(size * 2);
  const put = (x: { start: number; end: number }, at: number) => { let b = der.subarray(x.start, x.end); while (b.length > size && b[0] === 0) b = b.subarray(1); out.set(b, at + size - b.length); };
  put(r, 0); put(t, size);
  return out;
}

export interface SelfSignedOptions { commonName: string; organization?: string; serial?: Uint8Array; notBefore?: Date; notAfter?: Date }
/**
 * A self-signed end-entity certificate for signing (key usage digitalSignature, extended key usage emailProtection
 * as C2PA accepts, not a CA), its subject public key from the WebCrypto key pair, signed with the private key.
 */
export async function selfSignedCertificate(keys: CryptoKeyPair, o: SelfSignedOptions): Promise<Uint8Array> {
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey));
  const serial = o.serial || crypto.getRandomValues(new Uint8Array(16));
  serial[0] &= 0x7f; if (!serial[0]) serial[0] = 1;
  const notBefore = o.notBefore || new Date(Date.now() - 60000), notAfter = o.notAfter || new Date(notBefore.getTime() + 10 * 365.25 * 86400000);
  const subject = name(o.commonName, o.organization);
  const keyId = new Uint8Array(await crypto.subtle.digest('SHA-1', spki));
  const extensions = explicit(3, seq(
    seq(oid(OID.basicConstraints), bool(true), octets(seq())),
    seq(oid(OID.keyUsage), bool(true), octets(bitString(new Uint8Array([0x80]), 7))),
    seq(oid(OID.extKeyUsage), octets(seq(oid(OID.emailProtection)))),
    seq(oid(OID.subjectKeyId), octets(octets(keyId))),
    seq(oid(OID.authorityKeyId), octets(seq(tlv(0x80, keyId)))),
  ));
  const tbs = seq(explicit(0, integer(2)), integer(serial), algorithm(OID.ecdsaWithSha256), subject, seq(time(notBefore), time(notAfter)), subject, spki, extensions);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, tbs as BufferSource));
  return seq(tbs, algorithm(OID.ecdsaWithSha256), bitString(ecdsaRawToDer(sig)));
}

// ---- Reading --------------------------------------------------------------------------------------------------
export interface Tlv { tag: number; at: number; start: number; end: number; next: number }
export function read(u8: Uint8Array, p: number): Tlv {
  const tag = u8[p]; let len = u8[p + 1], q = p + 2;
  if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + u8[q++]; }
  return { tag, at: p, start: q, end: q + len, next: q + len };
}
export function children(u8: Uint8Array, t: Tlv): Tlv[] { const out: Tlv[] = []; let p = t.start; while (p < t.end) { const c = read(u8, p); out.push(c); p = c.next; } return out; }
export function oidString(u8: Uint8Array, t: Tlv): string {
  const b = u8.subarray(t.start, t.end), out = [Math.floor(b[0] / 40), b[0] % 40];
  let v = 0; for (let i = 1; i < b.length; i++) { v = v * 128 + (b[i] & 127); if (!(b[i] & 128)) { out.push(v); v = 0; } }
  return out.join('.');
}
export interface CertInfo { subject: string; organization?: string; issuer: string; notBefore: string; notAfter: string; spki: Uint8Array; selfSigned: boolean; tbs: Uint8Array; signature: Uint8Array }
/** The parts of a certificate the app shows and verifies with. */
export function readCertificate(der: Uint8Array): CertInfo {
  const cert = read(der, 0), [tbs, , sigBits] = children(der, cert);
  const f = children(der, tbs);
  const i = f[0].tag === 0xa0 ? 1 : 0; // the explicit version
  const issuer = f[i + 2], validity = f[i + 3], subject = f[i + 4], spki = f[i + 5];
  const nameOf = (n: Tlv, which: string): string | undefined => { for (const st of children(der, n)) for (const a of children(der, st)) { const [o, v] = children(der, a); if (oidString(der, o) === which) return new TextDecoder().decode(der.subarray(v.start, v.end)); } return undefined; };
  const [nb, na] = children(der, validity);
  const t = (x: Tlv): string => { const s = new TextDecoder().decode(der.subarray(x.start, x.end)); const y = x.tag === 0x17 ? (+s.slice(0, 2) < 50 ? '20' : '19') + s.slice(0, 2) : s.slice(0, 4), rest = x.tag === 0x17 ? s.slice(2) : s.slice(4); return `${y}-${rest.slice(0, 2)}-${rest.slice(2, 4)}T${rest.slice(4, 6)}:${rest.slice(6, 8)}:${rest.slice(8, 10)}Z`; };
  const subjectCn = nameOf(subject, OID.commonName) || '', issuerCn = nameOf(issuer, OID.commonName) || '';
  return { subject: subjectCn, organization: nameOf(subject, OID.organization), issuer: issuerCn, notBefore: t(nb), notAfter: t(na), spki: der.slice(spki.at, spki.end), selfSigned: subjectCn === issuerCn, tbs: der.slice(tbs.at, tbs.end), signature: der.slice(sigBits.start + 1, sigBits.end) };
}
