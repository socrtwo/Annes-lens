/**
 * On-device models: ONNX Runtime Web (WebGPU when the browser has it, WebAssembly otherwise),
 * a registry of permissively licensed models on the Hugging Face Hub, a download cache (Cache
 * API) and the pre- and post-processing for each job: portrait matting, depth, inpainting,
 * super-resolution and CLIP embeddings. The jobs take a Backend so tests can run them against a
 * fake session; src/ai/index.ts wires the real runtime.
 */
import type { Raster } from '../codecs/raster';
import { resample } from '../picture/ops';
import type { Rect } from '../picture/mask';
import { makeClipTokenizer, type ClipTokenizer } from './clipTokenizer';
import { runtimeBase as resolveRuntime } from '../platform/runtimes';

export const ORT_VERSION = '1.31.1';
export const RUNTIME_CDN = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

export type Task = 'matte' | 'depth' | 'inpaint' | 'upscale' | 'clip';
export interface ModelSpec {
  id: string; title: string; task: Task; repo: string; license: string; licenseUrl: string;
  files: { quantized: string[]; fp32: string[] };
  sizes: { quantized: number; fp32: number };
  note: string; scale?: number;
}

/** Only permissive licenses (checked on the model cards at implementation time). */
export const MODELS: ModelSpec[] = [
  { id: 'modnet', title: 'MODNet portrait matting', task: 'matte', repo: 'Xenova/modnet', license: 'Apache-2.0', licenseUrl: 'https://huggingface.co/Xenova/modnet', files: { quantized: ['onnx/model_quantized.onnx'], fp32: ['onnx/model.onnx'] }, sizes: { quantized: 6632188, fp32: 25888640 }, note: 'Subject cut-outs: Remove, Replace and Blur Background, Select Subject, Smart Crop, Generate Background.' },
  { id: 'depth-anything-v2-small', title: 'Depth Anything V2 Small', task: 'depth', repo: 'onnx-community/depth-anything-v2-small', license: 'Apache-2.0', licenseUrl: 'https://huggingface.co/onnx-community/depth-anything-v2-small', files: { quantized: ['onnx/model_quantized.onnx'], fp32: ['onnx/model.onnx'] }, sizes: { quantized: 27258801, fp32: 99060839 }, note: 'Depth Map, Blur Background, Relight.' },
  { id: 'lama', title: 'LaMa inpainting (big-lama)', task: 'inpaint', repo: 'Carve/LaMa-ONNX', license: 'Apache-2.0', licenseUrl: 'https://huggingface.co/Carve/LaMa-ONNX', files: { quantized: ['lama_fp32.onnx'], fp32: ['lama_fp32.onnx'] }, sizes: { quantized: 208044816, fp32: 208044816 }, note: 'Erase Object and Repair Damage on the device (512×512 tiles). A large download.' },
  { id: 'swin2sr-x2', title: 'Swin2SR ×2', task: 'upscale', scale: 2, repo: 'Xenova/swin2SR-classical-sr-x2-64', license: 'Apache-2.0', licenseUrl: 'https://huggingface.co/Xenova/swin2SR-classical-sr-x2-64', files: { quantized: ['onnx/model_quantized.onnx'], fp32: ['onnx/model.onnx'] }, sizes: { quantized: 21471413, fp32: 54428699 }, note: 'Upscale 2×.' },
  { id: 'swin2sr-x4-real', title: 'Swin2SR ×4 real-world', task: 'upscale', scale: 4, repo: 'Xenova/swin2SR-realworld-sr-x4-64-bsrgan-psnr', license: 'Apache-2.0', licenseUrl: 'https://huggingface.co/Xenova/swin2SR-realworld-sr-x4-64-bsrgan-psnr', files: { quantized: ['onnx/model_quantized.onnx'], fp32: ['onnx/model.onnx'] }, sizes: { quantized: 21438622, fp32: 52772645 }, note: 'Upscale 4×; Unblur and AI Noise Reduction (restored at the original size).' },
  { id: 'clip-vit-b32', title: 'CLIP ViT-B/32', task: 'clip', repo: 'Xenova/clip-vit-base-patch32', license: 'MIT', licenseUrl: 'https://huggingface.co/Xenova/clip-vit-base-patch32', files: { quantized: ['onnx/vision_model_quantized.onnx', 'onnx/text_model_quantized.onnx', 'vocab.json', 'merges.txt'], fp32: ['onnx/vision_model.onnx', 'onnx/text_model.onnx', 'vocab.json', 'merges.txt'] }, sizes: { quantized: 89117001 + 64504507 + 862328 + 524619, fp32: 351685709 + 254058553 + 862328 + 524619 }, note: 'Search by Content and Find Similar by Content (pictures and text in one space).' },
];
export const modelById = (id: string): ModelSpec => { const m = MODELS.find((x) => x.id === id); if (!m) throw new Error(`Unknown model ${id}`); return m; };

// Files and cache --------------------------------------------------------------------------------

/** Tests point this at local fixture models. */
export let modelUrlOverride: ((spec: ModelSpec, path: string) => string) | null = null;
export const setModelUrlOverride = (fn: typeof modelUrlOverride): void => { modelUrlOverride = fn; };
export const modelUrl = (spec: ModelSpec, path: string): string => modelUrlOverride ? modelUrlOverride(spec, path) : `https://huggingface.co/${spec.repo}/resolve/main/${path}`;
export const modelFiles = (spec: ModelSpec, dtype: 'quantized' | 'fp32'): string[] => spec.files[dtype];

const CACHE = 'annes-lens-ai-models-v1';
const memory = new Map<string, ArrayBuffer>();
const openCache = async (): Promise<Cache | null> => { try { return typeof caches !== 'undefined' ? await caches.open(CACHE) : null; } catch { return null; } };

export async function isCached(url: string): Promise<boolean> {
  if (memory.has(url)) return true;
  const c = await openCache(); if (!c) return false;
  return !!(await c.match(url));
}
export async function isDownloaded(spec: ModelSpec, dtype: 'quantized' | 'fp32'): Promise<boolean> {
  for (const f of modelFiles(spec, dtype)) if (!(await isCached(modelUrl(spec, f)))) return false;
  return true;
}
/** Bytes held in the cache for every registered model (both precisions). */
export async function downloadedModels(): Promise<{ spec: ModelSpec; bytes: number; dtypes: string[] }[]> {
  const out: { spec: ModelSpec; bytes: number; dtypes: string[] }[] = [];
  for (const spec of MODELS) {
    let bytes = 0; const dtypes: string[] = [];
    for (const dtype of ['quantized', 'fp32'] as const) {
      if (dtype === 'fp32' && spec.files.fp32.join() === spec.files.quantized.join()) continue;
      if (await isDownloaded(spec, dtype)) { bytes += spec.sizes[dtype]; dtypes.push(dtype); }
    }
    if (dtypes.length) out.push({ spec, bytes, dtypes });
  }
  return out;
}
export async function deleteModels(): Promise<void> {
  memory.clear(); sessions.clear();
  try { if (typeof caches !== 'undefined') await caches.delete(CACHE); } catch { /* */ }
}

export type Progress = (done: number, total: number, file: string) => void;
/** Downloads (once) and returns a model file. */
export async function fetchModelFile(url: string, expected: number, onProgress?: Progress, signal?: AbortSignal): Promise<ArrayBuffer> {
  const hit = memory.get(url); if (hit) return hit;
  const c = await openCache();
  const cached = c ? await c.match(url) : null;
  if (cached) { const b = await cached.arrayBuffer(); memory.set(url, b); return b; }
  const res = await fetch(url, { signal, redirect: 'follow' });
  if (!res.ok) throw new Error(`Could not download ${url.split('/').pop()}: the server answered ${res.status}`);
  if (/text\/html/i.test(res.headers.get('content-type') || '')) throw new Error(`Could not download ${url.split('/').pop()}: the server answered with a web page instead of the file`);
  const total = Number(res.headers.get('content-length')) || expected;
  let bytes: Uint8Array;
  if (res.body) {
    const reader = res.body.getReader(); const chunks: Uint8Array[] = []; let done = 0;
    for (;;) { const { value, done: end } = await reader.read(); if (end) break; chunks.push(value); done += value.length; onProgress?.(done, total, url.split('/').pop() || ''); }
    bytes = new Uint8Array(done); let o = 0; for (const ch of chunks) { bytes.set(ch, o); o += ch.length; }
  } else bytes = new Uint8Array(await res.arrayBuffer());
  const buf = bytes.buffer as ArrayBuffer;
  memory.set(url, buf);
  if (c) { try { await c.put(url, new Response(buf.slice(0), { headers: { 'content-type': 'application/octet-stream', 'content-length': String(buf.byteLength) } })); } catch { /* quota */ } }
  return buf;
}
export async function ensureModel(spec: ModelSpec, dtype: 'quantized' | 'fp32', onProgress?: Progress, signal?: AbortSignal): Promise<ArrayBuffer[]> {
  const files = modelFiles(spec, dtype); const out: ArrayBuffer[] = [];
  const per = spec.sizes[dtype] / files.length;
  let base = 0;
  for (const f of files) { out.push(await fetchModelFile(modelUrl(spec, f), per, (d, t, file) => onProgress?.(base + d, spec.sizes[dtype], file), signal)); base += per; }
  return out;
}

// Runtime ----------------------------------------------------------------------------------------

export interface Feed { name?: string; data: Float32Array | BigInt64Array | Int32Array; dims: number[] }
export interface Output { name: string; data: Float32Array; dims: number[] }
/** Runs a model: feeds in session input order (or by name), every output as float32. */
export interface Backend { infer(key: string, bytes: () => Promise<ArrayBuffer>, feeds: Feed[]): Promise<Output[]>; release?(): void }

const sessions = new Map<string, any>();
let ortPromise: Promise<any> | null = null;
let ortBase = '';
export const runtimeStatus = { loaded: false, provider: '' };

async function loadOrt(base: string): Promise<any> {
  if (ortPromise && ortBase === base) return ortPromise;
  ortBase = base;
  ortPromise = (async () => {
    // '' = the build's local copy (runtimes.json) when there is one, else the pinned CDN.
    const abs = base ? new URL(base, typeof document !== 'undefined' ? document.baseURI : 'http://localhost/').href : await resolveRuntime('ort', RUNTIME_CDN);
    const ort: any = await import(/* @vite-ignore */ abs + 'ort.webgpu.bundle.min.mjs');
    ort.env.wasm.wasmPaths = abs;
    ort.env.wasm.numThreads = (globalThis as any).crossOriginIsolated ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1)) : 1;
    runtimeStatus.loaded = true;
    return ort;
  })();
  return ortPromise;
}

let gpuPromise: Promise<boolean> | null = null;
/** WebGPU with a usable adapter (headless and older browsers expose navigator.gpu without one). */
export function gpuAvailable(): Promise<boolean> {
  return (gpuPromise ??= (async () => { try { const gpu = (navigator as any).gpu; return !!gpu && !!(await gpu.requestAdapter()); } catch { return false; } })());
}

/** The real backend: sessions are kept until Delete Downloaded Models or release(). */
export function ortBackend(base: string): Backend {
  return {
    async infer(key, bytes, feeds) {
      const ort = await loadOrt(base);
      let s = sessions.get(key);
      if (!s) {
        const providers = (await gpuAvailable()) ? ['webgpu', 'wasm'] : ['wasm'];
        const buf = await bytes();
        // ORT may transfer the buffer it is given; each attempt gets its own copy.
        try { s = await ort.InferenceSession.create(buf.slice(0), { executionProviders: providers }); runtimeStatus.provider = providers[0]; }
        catch (e) { if (providers.length > 1) { s = await ort.InferenceSession.create(buf.slice(0), { executionProviders: ['wasm'] }); runtimeStatus.provider = 'wasm'; } else throw e; }
        sessions.set(key, s);
      }
      const fd: Record<string, any> = {};
      feeds.forEach((f, i) => { const type = f.data instanceof BigInt64Array ? 'int64' : f.data instanceof Int32Array ? 'int32' : 'float32'; fd[f.name || s.inputNames[i]] = new ort.Tensor(type, f.data, f.dims); });
      const res = await s.run(fd);
      return s.outputNames.map((n: string) => { const t = res[n]; return { name: n, data: t.data instanceof Float32Array ? t.data : Float32Array.from(t.data as any, Number), dims: [...t.dims] }; });
    },
    release() { for (const s of sessions.values()) { try { s.release?.(); } catch { /* */ } } sessions.clear(); },
  };
}

// Pre- and post-processing -----------------------------------------------------------------------

/** NCHW float tensor from RGBA: (v / 255 - mean) / std per channel. */
export function toTensor(r: Raster, mean: [number, number, number], std: [number, number, number]): Float32Array {
  const n = r.width * r.height, out = new Float32Array(3 * n), d = r.data;
  for (let i = 0; i < n; i++) { const o = i * 4; out[i] = (d[o] / 255 - mean[0]) / std[0]; out[n + i] = (d[o + 1] / 255 - mean[1]) / std[1]; out[2 * n + i] = (d[o + 2] / 255 - mean[2]) / std[2]; }
  return out;
}
/** RGBA raster from an NCHW float tensor whose values span 0..1 (or 0..255 with scale 1). */
export function fromTensor(t: Float32Array, w: number, h: number, scale = 255): Raster {
  const n = w * h, data = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) { const o = i * 4; data[o] = t[i] * scale; data[o + 1] = t[n + i] * scale; data[o + 2] = t[2 * n + i] * scale; data[o + 3] = 255; }
  return { width: w, height: h, data: data as Uint8ClampedArray<ArrayBuffer> };
}
/** Bilinear resize of a single-channel float map. */
export function resizeFloat(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  if (sw === dw && sh === dh) return src.slice();
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.max(0, (y + 0.5) * sh / dh - 0.5)), y0 = Math.floor(sy), y1 = Math.min(sh - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.max(0, (x + 0.5) * sw / dw - 0.5)), x0 = Math.floor(sx), x1 = Math.min(sw - 1, x0 + 1), fx = sx - x0;
      out[y * dw + x] = (src[y0 * sw + x0] * (1 - fx) + src[y0 * sw + x1] * fx) * (1 - fy) + (src[y1 * sw + x0] * (1 - fx) + src[y1 * sw + x1] * fx) * fy;
    }
  }
  return out;
}
const pick = (outs: Output[], name: string): Output => outs.find((o) => o.name === name) || outs[0];
const roundTo = (v: number, m: number) => Math.max(m, Math.round(v / m) * m);

/** Alpha matte (0..1 per pixel) for the subject. */
export async function matte(b: Backend, bytes: () => Promise<ArrayBuffer>, r: Raster): Promise<Float32Array> {
  const k = 512 / Math.min(r.width, r.height);
  const w = roundTo(r.width * k, 32), h = roundTo(r.height * k, 32);
  const small = resample(r, w, h, 'lanczos3');
  const [out] = await b.infer('matte', bytes, [{ data: toTensor(small, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]), dims: [1, 3, h, w] }]);
  const ow = out.dims[out.dims.length - 1], oh = out.dims[out.dims.length - 2];
  const a = resizeFloat(out.data.subarray(0, ow * oh), ow, oh, r.width, r.height);
  for (let i = 0; i < a.length; i++) a[i] = a[i] < 0 ? 0 : a[i] > 1 ? 1 : a[i];
  return a;
}
/** Relative depth, 0 (far) .. 1 (near) per pixel. */
export async function depth(b: Backend, bytes: () => Promise<ArrayBuffer>, r: Raster): Promise<Float32Array> {
  const S = 518;
  const small = resample(r, S, S, 'lanczos3');
  const [out] = await b.infer('depth', bytes, [{ data: toTensor(small, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]), dims: [1, 3, S, S] }]);
  const ow = out.dims[out.dims.length - 1], oh = out.dims[out.dims.length - 2];
  const d = out.data.subarray(0, ow * oh);
  let lo = Infinity, hi = -Infinity; for (let i = 0; i < d.length; i++) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; }
  const norm = new Float32Array(d.length); const span = hi - lo || 1; for (let i = 0; i < d.length; i++) norm[i] = (d[i] - lo) / span;
  return resizeFloat(norm, ow, oh, r.width, r.height);
}
/** Fills the masked pixels (255 in `mask`) from their surroundings; one 512×512 tile around the mask. */
export async function inpaint(b: Backend, bytes: () => Promise<ArrayBuffer>, r: Raster, mask: Uint8Array, bounds: Rect): Promise<Raster> {
  const S = 512;
  const margin = Math.round(Math.max(bounds.w, bounds.h) * 0.5) + 32;
  let x0 = bounds.x - margin, y0 = bounds.y - margin, x1 = bounds.x + bounds.w + margin, y1 = bounds.y + bounds.h + margin;
  const side = Math.max(x1 - x0, y1 - y0); const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  x0 = Math.round(cx - side / 2); y0 = Math.round(cy - side / 2); x1 = x0 + side; y1 = y0 + side;
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(r.width, x1); y1 = Math.min(r.height, y1);
  const rw = x1 - x0, rh = y1 - y0;
  const region = { width: rw, height: rh, data: new Uint8ClampedArray(rw * rh * 4) as Uint8ClampedArray<ArrayBuffer> };
  const mreg = new Uint8Array(rw * rh);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) { const si = ((y + y0) * r.width + x + x0), di = y * rw + x; region.data.set(r.data.subarray(si * 4, si * 4 + 4), di * 4); mreg[di] = mask[si]; }
  const small = resample(region, S, S, 'lanczos3');
  const m = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) m[y * S + x] = mreg[Math.min(rh - 1, Math.floor((y + 0.5) * rh / S)) * rw + Math.min(rw - 1, Math.floor((x + 0.5) * rw / S))] ? 1 : 0;
  const [out] = await b.infer('inpaint', bytes, [{ data: toTensor(small, [0, 0, 0], [1, 1, 1]), dims: [1, 3, S, S] }, { data: m, dims: [1, 1, S, S] }]);
  let peak = 0; for (let i = 0; i < out.data.length; i++) if (out.data[i] > peak) peak = out.data[i];
  const filled = resample(fromTensor(out.data, S, S, peak > 2 ? 1 : 255), rw, rh, 'lanczos3');
  const result = { width: r.width, height: r.height, data: r.data.slice() as Uint8ClampedArray<ArrayBuffer> };
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) { const di = y * rw + x; if (!mreg[di]) continue; const si = ((y + y0) * r.width + x + x0) * 4; result.data[si] = filled.data[di * 4]; result.data[si + 1] = filled.data[di * 4 + 1]; result.data[si + 2] = filled.data[di * 4 + 2]; }
  return result;
}
/** Super-resolution by `scale`, in overlapping tiles whose sides are multiples of 8. */
export async function upscale(b: Backend, bytes: () => Promise<ArrayBuffer>, r: Raster, scale: number, onTile?: (done: number, total: number) => void): Promise<Raster> {
  const T = 256, O = 16, W = T + 2 * O;
  const pw = Math.max(W, Math.ceil(r.width / 8) * 8), ph = Math.max(W, Math.ceil(r.height / 8) * 8);
  const padded = pw === r.width && ph === r.height ? r : padEdge(r, pw, ph);
  const out = { width: pw * scale, height: ph * scale, data: new Uint8ClampedArray(pw * scale * ph * scale * 4) as Uint8ClampedArray<ArrayBuffer> };
  const xs = starts(pw, W, T), ys = starts(ph, W, T);
  let n = 0;
  for (const ty of ys) for (const tx of xs) {
    const tile = { width: W, height: W, data: new Uint8ClampedArray(W * W * 4) as Uint8ClampedArray<ArrayBuffer> };
    for (let y = 0; y < W; y++) tile.data.set(padded.data.subarray(((ty + y) * pw + tx) * 4, ((ty + y) * pw + tx + W) * 4), y * W * 4);
    const [res] = await b.infer(`upscale${scale}`, bytes, [{ data: toTensor(tile, [0, 0, 0], [1, 1, 1]), dims: [1, 3, W, W] }]);
    const ow = res.dims[res.dims.length - 1], oh = res.dims[res.dims.length - 2];
    const up = fromTensor(res.data, ow, oh);
    const big = ow === W * scale && oh === W * scale ? up : resample(up, W * scale, W * scale, 'lanczos3');
    const ix0 = tx === 0 ? 0 : O, iy0 = ty === 0 ? 0 : O, ix1 = tx + W >= pw ? W : W - O, iy1 = ty + W >= ph ? W : W - O;
    for (let y = iy0 * scale; y < iy1 * scale; y++) out.data.set(big.data.subarray((y * W * scale + ix0 * scale) * 4, (y * W * scale + ix1 * scale) * 4), (((ty * scale) + y) * pw * scale + (tx + ix0) * scale) * 4);
    onTile?.(++n, xs.length * ys.length);
  }
  if (pw === r.width && ph === r.height) return out;
  const cw = r.width * scale, ch = r.height * scale, cropped = { width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) as Uint8ClampedArray<ArrayBuffer> };
  for (let y = 0; y < ch; y++) cropped.data.set(out.data.subarray(y * pw * scale * 4, (y * pw * scale + cw) * 4), y * cw * 4);
  return cropped;
}
function starts(size: number, win: number, step: number): number[] { const out: number[] = []; for (let s = 0; ; s += step) { if (s + win >= size) { out.push(size - win); break; } out.push(s); } return out; }
function padEdge(r: Raster, w: number, h: number): Raster {
  const out = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) as Uint8ClampedArray<ArrayBuffer> };
  for (let y = 0; y < h; y++) { const sy = Math.min(y, r.height - 1); for (let x = 0; x < w; x++) { const sx = Math.min(x, r.width - 1); out.data.set(r.data.subarray((sy * r.width + sx) * 4, (sy * r.width + sx) * 4 + 4), (y * w + x) * 4); } }
  return out;
}

const CLIP_MEAN: [number, number, number] = [0.48145466, 0.4578275, 0.40821073], CLIP_STD: [number, number, number] = [0.26862954, 0.26130258, 0.27577711];
export function normalizeVec(v: Float32Array): Float32Array { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; s = Math.sqrt(s) || 1; const o = new Float32Array(v.length); for (let i = 0; i < v.length; i++) o[i] = v[i] / s; return o; }
export function cosine(a: Float32Array | number[], b: Float32Array | number[]): number { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
/** CLIP image embedding (unit length). */
export async function clipImage(b: Backend, bytes: () => Promise<ArrayBuffer>, r: Raster): Promise<Float32Array> {
  const S = 224, k = S / Math.min(r.width, r.height), w = Math.max(S, Math.round(r.width * k)), h = Math.max(S, Math.round(r.height * k));
  const small = resample(r, w, h, 'lanczos3'), x0 = Math.floor((w - S) / 2), y0 = Math.floor((h - S) / 2);
  const c = { width: S, height: S, data: new Uint8ClampedArray(S * S * 4) as Uint8ClampedArray<ArrayBuffer> };
  for (let y = 0; y < S; y++) c.data.set(small.data.subarray(((y + y0) * w + x0) * 4, ((y + y0) * w + x0 + S) * 4), y * S * 4);
  const outs = await b.infer('clip-vision', bytes, [{ data: toTensor(c, CLIP_MEAN, CLIP_STD), dims: [1, 3, S, S] }]);
  return normalizeVec(pick(outs, 'image_embeds').data);
}
/** CLIP text embedding (unit length). */
export async function clipText(b: Backend, bytes: () => Promise<ArrayBuffer>, tok: ClipTokenizer, text: string): Promise<Float32Array> {
  const { ids, mask } = tok.encode(text);
  const outs = await b.infer('clip-text', bytes, [{ name: 'input_ids', data: BigInt64Array.from(ids.map((x) => BigInt(x))), dims: [1, ids.length] }, { name: 'attention_mask', data: BigInt64Array.from(mask.map((x) => BigInt(x))), dims: [1, mask.length] }]);
  return normalizeVec(pick(outs, 'text_embeds').data);
}
export async function clipTokenizerFrom(vocabBytes: ArrayBuffer, mergesBytes: ArrayBuffer): Promise<ClipTokenizer> {
  const dec = new TextDecoder();
  return makeClipTokenizer(JSON.parse(dec.decode(vocabBytes)), dec.decode(mergesBytes));
}
