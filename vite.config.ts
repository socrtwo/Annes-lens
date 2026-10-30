import { defineConfig } from 'vite';

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const here = dirname(fileURLToPath(import.meta.url));

/**
 * ONNX Runtime Web for the on-device AI models. The bundle (`ort.webgpu.bundle.min.mjs`) and its
 * WebAssembly file are loaded at run time from `<app>/ort/` when they are there, else from the jsDelivr
 * CDN (src/ai/device.ts). They are copied into dist/ort when QN_ORT_LOCAL=1 (the desktop build does
 * this; the Android build leaves them to the CDN to keep the APK small; `npm run e2e` copies them itself).
 */
/** The bundle plus the WebAssembly variants the runtime picks between (asyncify / JSPI for the CPU, JSEP for WebGPU). */
export const ORT_FILES = ['ort.webgpu.bundle.min.mjs', 'ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm', 'ort-wasm-simd-threaded.jspi.mjs', 'ort-wasm-simd-threaded.jspi.wasm', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm'];
function ortRuntime() {
  return {
    name: 'annes-lens-ort-runtime',
    closeBundle() {
      if (process.env.QN_ORT_LOCAL !== '1') return;
      const src = join(here, 'node_modules/onnxruntime-web/dist'), out = join(here, 'dist/ort');
      mkdirSync(out, { recursive: true });
      for (const f of ORT_FILES) if (existsSync(join(src, f))) copyFileSync(join(src, f), join(out, f));
    },
  };
}

export default defineConfig({
  plugins: [ortRuntime()],
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
