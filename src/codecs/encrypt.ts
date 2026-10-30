/**
 * The .qlpe package: a picture encrypted with AES-256-GCM under a key derived from a password with
 * PBKDF2-SHA-256 (600 000 iterations). Layout: "QLPE" 0x01, 16-byte salt, 12-byte nonce, 4-byte
 * iteration count, 2-byte name length, the UTF-8 file name, then the ciphertext (with its GCM tag).
 * The original name is authenticated as additional data.
 */
const MAGIC = [0x51, 0x4c, 0x50, 0x45, 0x01];
export const QLPE_EXT = 'qlpe';
export const isQlpe = (u8: Uint8Array): boolean => MAGIC.every((b, i) => u8[i] === b);

async function keyFor(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptPicture(bytes: Uint8Array, name: string, password: string, iterations = 600000): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16)), nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(password, salt, iterations);
  const nameBytes = new TextEncoder().encode(name).subarray(0, 65535);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource, additionalData: nameBytes as BufferSource }, key, bytes as BufferSource));
  const out = new Uint8Array(5 + 16 + 12 + 4 + 2 + nameBytes.length + ct.length); const dv = new DataView(out.buffer);
  out.set(MAGIC, 0); out.set(salt, 5); out.set(nonce, 21); dv.setUint32(33, iterations); dv.setUint16(37, nameBytes.length); out.set(nameBytes, 39); out.set(ct, 39 + nameBytes.length);
  return out;
}

export async function decryptPicture(pkg: Uint8Array, password: string): Promise<{ name: string; bytes: Uint8Array }> {
  if (!isQlpe(pkg) || pkg.length < 39 + 16) throw new Error('Not an Anne\'s Lens encrypted picture (.qlpe).');
  const dv = new DataView(pkg.buffer, pkg.byteOffset, pkg.byteLength);
  const salt = pkg.subarray(5, 21), nonce = pkg.subarray(21, 33), iterations = dv.getUint32(33), nlen = dv.getUint16(37);
  if (iterations < 1000 || iterations > 10_000_000) throw new Error('The package header is damaged.');
  const nameBytes = pkg.subarray(39, 39 + nlen), name = new TextDecoder().decode(nameBytes);
  const key = await keyFor(password, salt, iterations);
  try { const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce as BufferSource, additionalData: nameBytes as BufferSource }, key, pkg.subarray(39 + nlen) as BufferSource); return { name, bytes: new Uint8Array(pt) }; }
  catch { throw new Error('Wrong password, or the package is damaged.'); }
}
