import { defineConfig } from 'vite';

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const here = dirname(fileURLToPath(import.meta.url));

/**
 * On-device runtimes: ONNX Runtime Web (AI models), Tesseract (OCR, with the English language
 * data) and zxing (barcodes). With QN_ORT_LOCAL=1 (the desktop build; its Content Security Policy
 * only allows the app's own scripts) they are copied into dist/ and listed in dist/runtimes.json,
 * which src/platform/runtimes.ts reads; without it the app loads them from their pinned CDN
 * addresses. `npm run e2e` stages the same files itself.
 */
export const ORT_FILES = ['ort.webgpu.bundle.min.mjs', 'ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm', 'ort-wasm-simd-threaded.jspi.mjs', 'ort-wasm-simd-threaded.jspi.wasm', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm'];
export const LOCAL_RUNTIMES: { from: string; to: string; files: string[] }[] = [
  { from: 'node_modules/onnxruntime-web/dist', to: 'ort', files: ORT_FILES },
  { from: 'node_modules/tesseract.js/dist', to: 'ocr', files: ['tesseract.esm.min.js', 'worker.min.js'] },
  { from: 'node_modules/tesseract.js-core', to: 'ocr/core', files: ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'] },
  { from: 'node_modules/@tesseract.js-data/eng/4.0.0_best_int', to: 'ocr/lang', files: ['eng.traineddata.gz'] },
  { from: 'node_modules/zxing-wasm/dist/reader', to: 'zxing', files: ['zxing_reader.wasm'] },
];
export const RUNTIME_MANIFEST = { ort: 'ort/', ocr: 'ocr/', zxing: 'zxing/', ocrLangs: ['eng'] };
export function stageRuntimes(dist: string): void {
  for (const r of LOCAL_RUNTIMES) {
    const out = join(dist, r.to); mkdirSync(out, { recursive: true });
    for (const f of r.files) if (existsSync(join(here, r.from, f))) copyFileSync(join(here, r.from, f), join(out, f));
  }
  writeFileSync(join(dist, 'runtimes.json'), JSON.stringify(RUNTIME_MANIFEST));
}
function localRuntimes() {
  return {
    name: 'annes-lens-local-runtimes',
    closeBundle() { if (process.env.QN_ORT_LOCAL === '1') stageRuntimes(join(here, 'dist')); },
  };
}

export default defineConfig({
  plugins: [localRuntimes()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    assetsInlineLimit: 0,
  },
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
  },
} as any);
