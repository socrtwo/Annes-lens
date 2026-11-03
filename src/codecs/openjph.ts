/**
 * OpenJPH (BSD-2-Clause), the High-Throughput JPEG 2000 reference implementation, as WebAssembly from
 * Cornerstone's codec-openjph build (MIT), for OpenEXR's lossless HTJ2K compression (HTJ2K256, HTJ2K32).
 * That build hands back every component at one bit depth, so only blocks whose channels are all HALF are
 * decoded (the usual RGB/RGBA case); FLOAT and UINT channels are refused with a message.
 * The script is a classic (UMD) one: it is fetched and imported as a module from a Blob, which the desktop
 * app's Content Security Policy allows, from the build's local copy or the pinned CDN address.
 */
import { runtimeBase } from '../platform/runtimes';

export const OPENJPH_CDN = 'https://cdn.jsdelivr.net/npm/@cornerstonejs/codec-openjph@2.4.11/';
let mod: any = null, loading: Promise<any> | null = null;
/** For tests and tools: an already instantiated module. */
export function setOpenJph(m: any): void { mod = m; }
export const openJphReady = (): boolean => !!mod;
export function loadOpenJph(): Promise<any> {
  if (mod) return Promise.resolve(mod);
  return (loading ??= (async () => {
    const base = await runtimeBase('openjph', OPENJPH_CDN);
    const text = await (await fetch(base + 'dist/openjphjs.js')).text();
    const url = URL.createObjectURL(new Blob([text + '\nexport default Module;\n'], { type: 'text/javascript' }));
    try {
      const factory = (await import(/* @vite-ignore */ url)).default;
      mod = await factory({ locateFile: (f: string) => base + 'dist/' + f });
      return mod;
    } finally { URL.revokeObjectURL(url); }
  })().catch((e) => { loading = null; throw new Error(`The HTJ2K decoder (OpenJPH) could not be loaded: ${(e as Error).message}`); }));
}

/** One OpenEXR HTJ2K block: its header ('HT', payload length, codestream component → file channel map) and codestream. */
export function exrHtHeader(src: Uint8Array): { map: number[]; codestream: Uint8Array } {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  if (src.length < 8 || dv.getUint16(0) !== 0x4854) {
    if (src.length >= 2 && dv.getUint16(0) === 0x484c) throw new Error('OpenEXR LJ2K (lossy HTJ2K) compression is not supported yet');
    throw new Error('Damaged OpenEXR HTJ2K block (header)');
  }
  const len = dv.getUint32(2); if (6 + len > src.length || len < 2) throw new Error('Damaged OpenEXR HTJ2K block (header)');
  const n = dv.getUint16(6), map: number[] = [];
  for (let i = 0; i < n; i++) map.push(dv.getUint16(8 + i * 2));
  return { map, codestream: src.subarray(6 + len) };
}

/** Decodes a codestream; every component must have the same size and 16-bit samples. Interleaved 16-bit samples. */
export function decodeHtj2k16(codestream: Uint8Array): { width: number; height: number; components: number; samples: Uint16Array } {
  if (!mod) throw new Error('The HTJ2K decoder is not loaded');
  const d = new mod.HTJ2KDecoder();
  try {
    d.getEncodedBuffer(codestream.length).set(codestream);
    d.decode();
    const fi = d.getFrameInfo();
    if (fi.bitsPerSample !== 16) throw new Error(`OpenEXR HTJ2K with ${fi.bitsPerSample}-bit samples is not supported`);
    const out: Uint8Array = d.getDecodedBuffer();
    if (out.length !== fi.width * fi.height * fi.componentCount * 2) throw new Error('OpenEXR HTJ2K: subsampled channels are not supported');
    const samples = new Uint16Array(out.length / 2);
    for (let i = 0; i < samples.length; i++) samples[i] = out[i * 2] | (out[i * 2 + 1] << 8);
    return { width: fi.width, height: fi.height, components: fi.componentCount, samples };
  } finally { d.delete(); }
}
