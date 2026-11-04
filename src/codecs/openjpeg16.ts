/**
 * OpenJPEG (BSD-2-Clause), the JPEG 2000 reference implementation, as WebAssembly from Cornerstone's codec-openjpeg
 * build (MIT; the decode-only module), for pixel data that must keep its full precision: the 12- to 16-bit, signed
 * or unsigned samples of DICOM files, which pdf.js's build of the same library hands back reduced to 8 bits.
 * The script is a classic (UMD) one: it is fetched and imported as a module from a Blob, which the desktop app's
 * Content Security Policy allows, from the build's local copy or the pinned CDN address.
 */
import { runtimeBase } from '../platform/runtimes';

export const OPENJPEG_CDN = 'https://cdn.jsdelivr.net/npm/@cornerstonejs/codec-openjpeg@1.3.6/';
let mod: any = null, loading: Promise<any> | null = null;
/** For tests and tools: an already instantiated module (or null to forget it). */
export function setOpenJpeg(m: any): void { mod = m; }
export const openJpegReady = (): boolean => !!mod;
export function loadOpenJpeg(): Promise<any> {
  if (mod) return Promise.resolve(mod);
  return (loading ??= (async () => {
    const base = await runtimeBase('openjpeg', OPENJPEG_CDN);
    const text = await (await fetch(base + 'dist/openjpegjs_decode.js')).text();
    const url = URL.createObjectURL(new Blob([text + '\nexport default OpenJPEGJS;\n'], { type: 'text/javascript' }));
    try {
      const factory = (await import(/* @vite-ignore */ url)).default;
      mod = await factory({ locateFile: (f: string) => base + 'dist/' + f, print: () => {}, printErr: () => {} });
      return mod;
    } finally { URL.revokeObjectURL(url); }
  })().catch((e) => { loading = null; throw new Error(`The JPEG 2000 decoder (OpenJPEG) could not be loaded: ${(e as Error).message}`); }));
}

export interface J2kFrame { width: number; height: number; components: number; bits: number; signed: boolean; samples: Int32Array }

/** Decodes a J2K codestream (or JP2 file) to interleaved samples at their full precision. */
export function decodeJ2k16(codestream: Uint8Array): J2kFrame {
  if (!mod) throw new Error('The JPEG 2000 decoder is not loaded');
  const d = new mod.J2KDecoder();
  try {
    d.getEncodedBuffer(codestream.length).set(codestream);
    d.decode();
    const fi = d.getFrameInfo();
    const out: Uint8Array = d.getDecodedBuffer();
    const n = fi.width * fi.height * fi.componentCount, bytes = fi.bitsPerSample > 8 ? 2 : 1;
    if (out.length < n * bytes) throw new Error('JPEG 2000: the decoded data is shorter than the picture');
    const samples = new Int32Array(n);
    if (bytes === 1) { if (fi.isSigned) for (let i = 0; i < n; i++) samples[i] = (out[i] << 24) >> 24; else samples.set(out.subarray(0, n)); }
    else if (fi.isSigned) { const v = new Int16Array(out.buffer, out.byteOffset, n); samples.set(v); }
    else { const v = new Uint16Array(out.buffer, out.byteOffset, n); samples.set(v); }
    return { width: fi.width, height: fi.height, components: fi.componentCount, bits: fi.bitsPerSample, signed: !!fi.isSigned, samples };
  } finally { d.delete(); }
}
