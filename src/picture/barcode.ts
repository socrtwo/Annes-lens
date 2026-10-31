/**
 * Read QR Code or Barcode with zxing-cpp (zxing-wasm): QR, Micro QR, Data Matrix, Aztec, PDF417,
 * MaxiCode and the linear codes (EAN/UPC, Code 128/39/93, Codabar, ITF, DataBar). The WebAssembly
 * module comes from the build's local copy (runtimes.json) or from its pinned CDN address.
 */
import type { Raster } from '../codecs/raster';
import { runtimeBase } from '../platform/runtimes';

export const ZXING_VERSION = '3.1.6';
const CDN = `https://cdn.jsdelivr.net/npm/zxing-wasm@${ZXING_VERSION}/dist/reader/`;

export interface CodeResult { text: string; format: string; corners: [number, number][]; bytes: number; ecLevel?: string }

let prepared: Promise<any> | null = null;
async function reader(): Promise<any> {
  return (prepared ??= (async () => {
    const z: any = await import('zxing-wasm/reader');
    const base = await runtimeBase('zxing', CDN);
    z.prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? base + path : prefix + path) }, fireImmediately: true });
    return z;
  })());
}

/** Every code found in the raster, with its four corners in picture pixels. */
export async function readCodes(r: Raster, o: { tryHarder?: boolean; max?: number } = {}): Promise<CodeResult[]> {
  const z = await reader();
  const img = new ImageData(new Uint8ClampedArray(r.data), r.width, r.height);
  const found = await z.readBarcodes(img, { tryHarder: o.tryHarder !== false, tryRotate: true, tryInvert: true, tryDownscale: true, maxNumberOfSymbols: o.max ?? 32, formats: [] });
  return found.filter((f: any) => f.isValid).map((f: any) => ({ text: String(f.text), format: String(f.format), bytes: f.bytes?.length ?? 0, ecLevel: f.ecLevel || undefined, corners: [f.position.topLeft, f.position.topRight, f.position.bottomRight, f.position.bottomLeft].map((p: any) => [p.x, p.y] as [number, number]) }));
}

export type CodeKind = 'url' | 'wifi' | 'contact' | 'email' | 'phone' | 'geo' | 'text';
/** What a code's text is, for the actions offered on it. */
export function classify(text: string): CodeKind {
  const t = text.trim();
  if (/^https?:\/\/\S+$/i.test(t)) return 'url';
  if (/^WIFI:/i.test(t)) return 'wifi';
  if (/^BEGIN:VCARD/i.test(t) || /^MECARD:/i.test(t)) return 'contact';
  if (/^mailto:/i.test(t) || /^MATMSG:/i.test(t)) return 'email';
  if (/^tel:/i.test(t)) return 'phone';
  if (/^geo:-?\d/i.test(t)) return 'geo';
  return 'text';
}
/** Wi-Fi network fields from a WIFI: code (S:ssid;T:WPA;P:pass;H:hidden). */
export function parseWifi(text: string): { ssid: string; type: string; password: string; hidden: boolean } | null {
  if (!/^WIFI:/i.test(text)) return null;
  const body = text.slice(5), out: Record<string, string> = {};
  let i = 0;
  while (i < body.length) {
    const k = body[i]; if (body[i + 1] !== ':') { i++; continue; }
    let v = '', j = i + 2;
    for (; j < body.length && body[j] !== ';'; j++) { if (body[j] === '\\' && j + 1 < body.length) j++; v += body[j]; }
    out[k.toUpperCase()] = v; i = j + 1;
  }
  return { ssid: out.S || '', type: out.T || 'nopass', password: out.P || '', hidden: /^true$/i.test(out.H || '') };
}
