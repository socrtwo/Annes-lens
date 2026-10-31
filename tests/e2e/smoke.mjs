// Browser smoke test: serves dist/ with `vite preview`, opens generated pictures through the drop command,
// walks the folder, zooms, rotates, undoes, reads pixel info, switches menus and saves a copy.
// Usage: npm run build && npm run e2e   (set QN_URL to test an already-running server instead)
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startMockAi } from './mockAi.mjs';

// The on-device runtimes (ONNX Runtime, Tesseract with English, zxing) and the tiny AI fixture models
// are staged into dist/ with a runtimes.json, as the desktop build does (never committed there).
const LOCAL_RUNTIMES = [
  ['node_modules/onnxruntime-web/dist', 'ort', ['ort.webgpu.bundle.min.mjs', 'ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm', 'ort-wasm-simd-threaded.jspi.mjs', 'ort-wasm-simd-threaded.jspi.wasm', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']],
  ['node_modules/tesseract.js/dist', 'ocr', ['tesseract.esm.min.js', 'worker.min.js']],
  ['node_modules/tesseract.js-core', 'ocr/core', ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int', 'ocr/lang', ['eng.traineddata.gz']],
  ['node_modules/zxing-wasm/dist/reader', 'zxing', ['zxing_reader.wasm']],
];
if (existsSync('dist')) {
  for (const [from, to, files] of LOCAL_RUNTIMES) { mkdirSync(`dist/${to}`, { recursive: true }); for (const f of files) if (existsSync(`${from}/${f}`)) copyFileSync(`${from}/${f}`, `dist/${to}/${f}`); }
  writeFileSync('dist/runtimes.json', JSON.stringify({ ort: 'ort/', ocr: 'ocr/', zxing: 'zxing/', ocrLangs: ['eng'] }));
  mkdirSync('dist/ai-fixtures', { recursive: true });
  for (const f of readdirSync('tests/fixtures/ai')) copyFileSync(`tests/fixtures/ai/${f}`, `dist/ai-fixtures/${f}`);
}
const AI_PORT = 4193;
const mockAi = await startMockAi(AI_PORT, 'tests/fixtures/ai');

const PORT = 4192;
let server = null;
let url = process.env.QN_URL;
if (!url) {
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
  url = `http://localhost:${PORT}/`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
}

const exe = existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {};
const browser = await chromium.launch(exe);
const failures = [];
const check = (name, got, want, note) => { if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}${note ? ' [' + note + ']' : ''}`); };

try {
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.addInitScript(() => localStorage.setItem('quilllens.prefs.v1', JSON.stringify({ firstRun: false })));
  await p.goto(url, { waitUntil: 'networkidle' });
  await p.waitForSelector('.qn-viewer');
  await p.waitForTimeout(500);

  check('commands registered', await p.evaluate(() => window.__qnAllIds.length > 70), true);
  check('menu bar', await p.evaluate(() => [...document.querySelectorAll('.ql-menubar-item')].map((b) => b.textContent)), ['File', 'Edit', 'Image', 'Options', 'View', 'AI', 'Help']);

  // Three generated pictures (PNG, JPEG, BMP via the app's writer) dropped at once.
  const opened = await p.evaluate(async () => {
    const mk = (w, h, color) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.fillRect(0, 0, 1, 1); return c; };
    const blob = (c, t, q) => new Promise((r) => c.toBlob(r, t, q));
    const { encodeCanvas } = await window.__qnCodecs();
    const files = [
      new File([await blob(mk(40, 30, '#ff0000'), 'image/png')], 'b.png', { type: 'image/png' }),
      new File([await blob(mk(640, 480, '#00ff00'), 'image/jpeg', 0.9)], 'a.jpg', { type: 'image/jpeg' }),
      new File([await encodeCanvas(mk(20, 10, '#0000ff'), 'bmp')], 'c.bmp', { type: 'image/bmp' }),
    ];
    await qn.exec('file.openDropped', files);
    await new Promise((r) => setTimeout(r, 800));
    return { n: qn.folder.length, name: qn.picture?.name, w: qn.picture?.width, fmt: qn.picture?.format.id };
  });
  check('opened', opened, { n: 3, name: 'a.jpg', w: 640, fmt: 'jpeg' });

  // Next / previous / wrap, prefetch cache.
  await p.evaluate(() => qn.exec('view.next'));
  await p.waitForTimeout(400);
  check('next', await p.evaluate(() => [qn.picture.name, qn.picture.format.id, qn.picture.decoder]), ['b.png', 'png', 'platform']);
  await p.evaluate(() => qn.exec('view.next'));
  await p.waitForTimeout(400);
  check('bmp', await p.evaluate(() => [qn.picture.name, qn.picture.width, qn.picture.height]), ['c.bmp', 20, 10]);
  check('prefetched', await p.evaluate(() => qn.tab.loader.has(qn.folder.entries[0])), true);
  await p.evaluate(() => qn.exec('view.next'));
  await p.waitForTimeout(300);
  check('wrap', await p.evaluate(() => qn.picture.name), 'a.jpg');

  // Zoom modes and pixel info.
  await p.evaluate(() => qn.exec('view.actualSize'));
  check('actual size', await p.evaluate(() => qn.viewer.zoom), 1);
  await p.evaluate(() => qn.exec('view.zoomIn'));
  check('zoom in', await p.evaluate(() => Math.round(qn.viewer.zoom * 100)), 125);
  await p.evaluate(() => qn.exec('view.fitWindow'));
  check('fit', await p.evaluate(() => qn.viewer.mode), 'fit');
  check('pixel corner', await p.evaluate(() => { const [r, g] = qn.viewer.pixelAt(0, 0); return [r > 90, g > 240]; }), [true, true]);
  check('pixel green', await p.evaluate(() => { const [r, g, b] = qn.viewer.pixelAt(300, 200); return [r < 40, g > 200, b < 40]; }), [true, true, true]);

  // Rotate, undo, redo.
  await p.evaluate(() => qn.exec('image.rotateRight'));
  check('rotated', await p.evaluate(() => [qn.picture.width, qn.picture.height, qn.tab.dirty]), [480, 640, true]);
  await p.evaluate(() => qn.exec('edit.undo'));
  check('undo', await p.evaluate(() => [qn.picture.width, qn.tab.dirty]), [640, false]);
  await p.evaluate(() => qn.exec('edit.redo'));
  check('redo', await p.evaluate(() => qn.picture.width), 480);
  await p.evaluate(() => qn.exec('image.flipH'));
  check('flip', await p.evaluate(() => qn.tab.undoLabel), 'Flip Horizontal');

  // Information dialog opens and closes; menus switch; full screen toggles.
  await p.evaluate(() => { void qn.exec('image.info'); });
  await p.waitForSelector('.ql-dialog');
  check('info rows', await p.evaluate(() => document.querySelectorAll('.ql-dialog table tr').length > 8), true);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  await p.evaluate(() => qn.exec('view.menuMode', 'classic'));
  check('classic only', await p.evaluate(() => getComputedStyle(document.querySelector('.ql-ribbon')).display), 'none');
  await p.evaluate(() => qn.exec('view.menuLayout', 'xnview'));
  check('xnview bar', await p.evaluate(() => document.querySelector('.ql-menubar-item').textContent), 'File');
  await p.evaluate(() => qn.exec('view.menuMode', 'both'));
  await p.evaluate(() => qn.exec('view.fullScreen'));
  check('full screen', await p.evaluate(() => document.body.classList.contains('ql-fullscreen')), true);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(200);
  check('full screen off', await p.evaluate(() => document.body.classList.contains('ql-fullscreen')), false);

  // Keyboard: Space moves on, Backspace back (after undoing the edits, or the save prompt would ask first).
  await p.evaluate(() => { qn.exec('edit.undo'); qn.exec('edit.undo'); });
  check('clean again', await p.evaluate(() => qn.tab.dirty), false);
  await p.evaluate(() => qn.focus());
  await p.keyboard.press('Space');
  await p.waitForTimeout(400);
  check('space', await p.evaluate(() => qn.picture.name), 'b.png');
  await p.keyboard.press('Backspace');
  await p.waitForTimeout(400);
  check('backspace', await p.evaluate(() => qn.picture.name), 'a.jpg');

  // Save a copy through the download path (no file picker in headless Chromium): the encoder runs.
  const encoded = await p.evaluate(async () => { const { encodeCanvas } = await window.__qnCodecs(); const b = await encodeCanvas(qn.picture.frameCanvas(), 'webp', 0.8); return [b.type, b.size > 100]; });
  check('encode webp', encoded, ['image/webp', true]);

  // The app's own writers and readers through the real pipeline: TGA, QOI, PPM and a PSD composite open as pictures.
  const own = await p.evaluate(async () => {
    const { encodeCanvas } = await window.__qnCodecs();
    const mk = (w, h, color) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h); return c; };
    const psd = Uint8Array.from([0x38, 0x42, 0x50, 0x53, 0, 1, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 1, 0, 0, 0, 2, 0, 8, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 255, 0, 0]);
    const files = [
      new File([await encodeCanvas(mk(12, 8, '#ff00ff'), 'tga')], 'd.tga'),
      new File([await encodeCanvas(mk(6, 5, '#00ffff'), 'qoi')], 'e.qoi'),
      new File([await encodeCanvas(mk(7, 3, '#ffff00'), 'ppm')], 'f.ppm'),
      new File([psd], 'g.psd'),
    ];
    await qn.exec('file.openDropped', files);
    await new Promise((r) => setTimeout(r, 600));
    const out = [];
    for (let i = 0; i < 4; i++) { const pic = await qn.tab.loader.get(qn.folder.entries[i]); out.push([pic.name, pic.format.id, pic.decoder, pic.width, pic.height]); }
    return out;
  });
  check('own formats', own, [['d.tga', 'tga', 'tga', 12, 8], ['e.qoi', 'qoi', 'qoi', 6, 5], ['f.ppm', 'pnm', 'pnm', 7, 3], ['g.psd', 'psd', 'psd', 2, 1]]);
  check('psd pixel', await p.evaluate(async () => { const pic = await qn.tab.loader.get(qn.folder.entries[3]); const d = pic.frameCanvas().getContext('2d').getImageData(0, 0, 2, 1).data; return [...d]; }), [255, 0, 0, 255, 0, 255, 0, 255]);

  // Open as Hex dumps the bytes (the TGA just written) with landmarks; the Recovery Report describes the picture.
  await p.evaluate(() => qn.folder.select(0));
  await p.waitForTimeout(400);
  check('hex subject', await p.evaluate(() => qn.picture.name), 'd.tga');
  await p.evaluate(() => { void qn.exec('file.openHex'); });
  await p.waitForSelector('.ql-hex');
  check('hex dump', await p.evaluate(() => document.querySelector('.ql-hex').textContent.startsWith('000000  00 00 02 00')), true);
  check('hex landmarks', await p.evaluate(() => [...document.querySelectorAll('.ql-dialog select option')].some((o) => /End of file/.test(o.textContent))), true);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  await p.evaluate(() => { void qn.exec('file.recoveryReport'); });
  await p.waitForSelector('.ql-dialog table');
  check('recovery report', await p.evaluate(() => [...document.querySelectorAll('.ql-dialog table tr')].map((r) => r.children[0].textContent)).then((k) => k.includes('Condition') && k.includes('Recognized as')), true);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);

  // Lossless JPEG: a platform-encoded JPEG rotated by its coefficients decodes to the rotated picture (within JPEG noise).
  const lossless = await p.evaluate(async () => {
    const { losslessTransform } = await window.__qnLossless();
    const c = document.createElement('canvas'); c.width = 96; c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = '#ff0000'; x.fillRect(0, 0, 48, 64); x.fillStyle = '#0000ff'; x.fillRect(48, 0, 48, 64); x.fillStyle = '#00ff00'; x.fillRect(0, 0, 96, 16);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
    const src = new Uint8Array(await blob.arrayBuffer());
    const out = losslessTransform(src, 'rot90', {});
    const bmp = await createImageBitmap(new Blob([out.bytes], { type: 'image/jpeg' }));
    const d = document.createElement('canvas'); d.width = bmp.width; d.height = bmp.height;
    const y = d.getContext('2d'); y.drawImage(bmp, 0, 0);
    const px = (px_, py_) => [...y.getImageData(px_, py_, 1, 1).data].slice(0, 3);
    // After a 90° clockwise turn: green strip (old top) is at the right; red (old left) at the top, blue at the bottom.
    return { size: [bmp.width, bmp.height], perfect: out.perfect, warnings: out.warnings, right: px(56, 32), top: px(20, 20), bottom: px(20, 80), smaller: out.bytes.length < src.length + 200 };
  });
  check('lossless size', lossless.size, [64, 96]);
  check('lossless perfect', lossless.perfect, true);
  check('lossless warnings', lossless.warnings, []);
  check('lossless green right', lossless.right[1] > 180 && lossless.right[0] < 90 && lossless.right[2] < 90, true);
  check('lossless red top', lossless.top[0] > 180 && lossless.top[1] < 90, true);
  check('lossless blue bottom', lossless.bottom[2] > 180 && lossless.bottom[0] < 90, true);
  check('lossless no bloat', lossless.smaller, true);

  // Damaged files: a JPEG cut in half opens through the coefficient rebuild; a truncated PNG through the tolerant reader.
  const damaged = await p.evaluate(async () => {
    const mk = (w, h, color) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h); return c; };
    const blob = (c, t, q) => new Promise((r) => c.toBlob(r, t, q));
    // A textured picture, so the scan data (not the headers) makes up most of the file.
    const tex = mk(256, 256, '#3366cc'); const tx = tex.getContext('2d'); const id = tx.getImageData(0, 0, 256, 256);
    for (let i = 0; i < id.data.length; i += 4) { const x = (i / 4) % 256, y = Math.floor(i / 4 / 256); id.data[i] = (x * 7 + y * 3 + ((x * y) % 13) * 9) & 255; id.data[i + 1] = (x ^ y) & 255; id.data[i + 2] = (y * 5 + (x % 17) * 11) & 255; }
    tx.putImageData(id, 0, 0);
    const jpg = new Uint8Array(await (await blob(tex, 'image/jpeg', 0.9)).arrayBuffer());
    const whole = await createImageBitmap(new Blob([jpg], { type: 'image/jpeg' }));
    const wc = mk(256, 256, '#000'); wc.getContext('2d').drawImage(whole, 0, 0);
    const want = [...wc.getContext('2d').getImageData(2, 2, 1, 1).data].slice(0, 3);
    const png = new Uint8Array(await (await blob(mk(64, 64, '#cc6633'), 'image/png')).arrayBuffer());
    const files = [new File([jpg.subarray(0, Math.floor(jpg.length * 0.6))], 'cut.jpg'), new File([png.subarray(0, Math.floor(png.length * 0.7))], 'cut.png')];
    await qn.exec('file.openDropped', files);
    await new Promise((r) => setTimeout(r, 800));
    const out = [];
    for (let i = 0; i < 2; i++) { try { const pic = await qn.tab.loader.get(qn.folder.entries[i]); const d = pic.frameCanvas().getContext('2d').getImageData(2, 2, 1, 1).data; out.push([pic.name, pic.decoder, pic.width, pic.warnings.length > 0, [...d].slice(0, 3)]); } catch (e) { out.push([String(e)]); } }
    return { out, want, size: jpg.length };
  });
  check('cut jpeg', damaged.out[0] && damaged.out[0].slice(0, 4), ['cut.jpg', 'jpeg (repaired)', 256, true]);
  check('cut jpeg textured', damaged.size > 20000, true);
  check('cut jpeg pixel', damaged.out[0] && damaged.out[0][4] && damaged.out[0][4].every((v, i) => Math.abs(v - damaged.want[i]) <= 4), true);
  check('cut png', damaged.out[1] && damaged.out[1].slice(0, 4), ['cut.png', 'png (tolerant)', 64, true]);
  check('cut png pixel', damaged.out[1] && damaged.out[1][4] && damaged.out[1][4][0] === 204 && damaged.out[1][4][1] === 102, true);

  // JPEG-compressed TIFF (Pillow) decodes through the platform per strip; a CBZ opens as a folder of its pages.
  const tiffBytes = [...readFileSync('tests/fixtures/tiff/jpeg-strips.tif')];
  const tiffJpeg = await p.evaluate(async (bytes) => {
    const f = new File([Uint8Array.from(bytes)], 'jpeg-strips.tif');
    await qn.exec('file.openDropped', [f]);
    await new Promise((r) => setTimeout(r, 800));
    const pic = qn.picture;
    const d = pic.frameCanvas().getContext('2d').getImageData(60, 50, 1, 1).data;
    return [pic.format.id, pic.decoder, pic.width, pic.height, pic.warnings.length, pic.current.notes[0], [...d].slice(0, 3)];
  }, tiffBytes);
  check('tiff jpeg', tiffJpeg.slice(0, 5), ['tiff', 'tiff', 203, 112, 0]);
  check('tiff jpeg note', /JPEG-compressed strips/.test(tiffJpeg[5]), true);
  check('tiff jpeg pixel (inside the blue ellipse)', tiffJpeg[6][2] > 150 && tiffJpeg[6][0] < 90, true);
  const cbz = await p.evaluate(async () => {
    const { encodeCanvas } = await window.__qnCodecs();
    const mk = (w, h, color) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h); return c; };
    const pages = [['p10.png', await (await encodeCanvas(mk(8, 8, '#f00'), 'png')).arrayBuffer()], ['p2.png', await (await encodeCanvas(mk(9, 7, '#0f0'), 'png')).arrayBuffer()]];
    // Stored-method zip written by hand (local headers + central directory).
    const le16 = (v) => [v & 255, (v >> 8) & 255], le32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
    const parts = [], central = [];
    for (const [name, buf] of pages) { const data = new Uint8Array(buf); const nm = [...new TextEncoder().encode(name)]; const off = parts.length; const common = [...le16(20), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(data.length), ...le32(data.length), ...le16(nm.length)]; parts.push(...le32(0x04034b50), ...common, ...le16(0), ...nm, ...data); central.push(...le32(0x02014b50), ...le16(20), ...common, ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(off), ...nm); }
    const eocd = [...le32(0x06054b50), ...le16(0), ...le16(0), ...le16(2), ...le16(2), ...le32(central.length), ...le32(parts.length), ...le16(0)];
    const zip = Uint8Array.from([...parts, ...central, ...eocd]);
    await qn.exec('file.openDropped', [new File([zip], 'book.cbz')]);
    await new Promise((r) => setTimeout(r, 800));
    return [qn.folder.name, qn.folder.entries.map((e) => e.name), qn.picture?.name, qn.picture?.width];
  });
  check('cbz as folder', cbz, ['book.cbz', ['p2.png', 'p10.png'], 'p2.png', 9]);

  // Print Layouts builds pages and previews the first one; Export Animation and Export Palette produce files.
  await p.evaluate(() => { void qn.exec('file.printLayouts'); });
  await p.waitForSelector('.ql-dialog .ql-print-page');
  check('layout preview', await p.evaluate(() => { const pg = document.querySelector('.ql-dialog .ql-print-page'); return [pg.style.display, pg.querySelectorAll('img').length]; }), ['grid', 1]);
  await p.evaluate(() => { const sel = document.querySelector('.ql-dialog select'); sel.value = 'wallet'; sel.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(500);
  check('wallet cells', await p.evaluate(() => +(document.querySelector('.ql-dialog .ql-print-page').style.gridTemplateColumns.match(/repeat\((\d+)/) || [])[1] >= 2), true);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  const exported = await p.evaluate(async () => {
    const { medianCut, encodePalette } = await window.__qnPalette();
    const pic = qn.picture; const c = pic.frameCanvas(); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const pal = medianCut(d, 4);
    return [pal.colors.length, new TextDecoder().decode(encodePalette(pal, 'gpl').bytes).split('\n')[0]];
  });
  check('palette export', exported, [1, 'GIMP Palette']);

  // M3: selection, crop, resize, grayscale, canvas size and undo through the real commands.
  const editOps = await p.evaluate(async () => {
    const mk = (w, h, color) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h); x.fillStyle = '#00ff00'; x.fillRect(10, 10, 20, 20); return c; };
    const blob = (c, t) => new Promise((r) => c.toBlob(r, t));
    await qn.exec('file.openDropped', [new File([await blob(mk(100, 80, '#ff0000'), 'image/png')], 'edit.png')]);
    await new Promise((r) => setTimeout(r, 600));
    const out = {};
    qn.tab.setSelection({ x: 10, y: 10, w: 20, h: 20 });
    await new Promise((r) => setTimeout(r, 120));
    out.sel = [...document.querySelectorAll('.ql-status .ql-status-item')].some((e) => /20 × 20 at 10, 10/.test(e.textContent));
    await qn.exec('edit.crop'); await new Promise((r) => setTimeout(r, 100));
    out.cropped = [qn.picture.width, qn.picture.height, [...qn.viewer.pixelAt(5, 5)].slice(0, 3), qn.tab.selection];
    await qn.exec('edit.undo');
    out.undone = [qn.picture.width, qn.picture.height];
    const { resizeTo } = await window.__qnImageOps();
    resizeTo(qn, 50, 40, 'lanczos3');
    out.resized = [qn.picture.width, qn.picture.height, [...qn.viewer.pixelAt(2, 2)].slice(0, 3), [...qn.viewer.pixelAt(10, 10)].slice(0, 3)];
    await qn.exec('image.grayscale');
    out.gray = [...qn.viewer.pixelAt(2, 2)].slice(0, 3);
    await qn.exec('image.negative', 'all');
    out.neg = [...qn.viewer.pixelAt(2, 2)].slice(0, 3);
    out.undoLabel = qn.tab.undoLabel;
    await qn.exec('edit.selectAll');
    out.all = qn.tab.selection;
    await qn.exec('edit.copy'); await new Promise((r) => setTimeout(r, 200));
    out.clip = qn.clipRaster ? [qn.clipRaster.width, qn.clipRaster.height] : null;
    return out;
  });
  check('selection in status', editOps.sel, true);
  check('crop', editOps.cropped, [20, 20, [0, 255, 0], null]);
  check('crop undo', editOps.undone, [100, 80]);
  check('resize', editOps.resized, [50, 40, [255, 0, 0], [0, 255, 0]]);
  check('grayscale', editOps.gray, [76, 76, 76]);
  check('negative', editOps.neg, [179, 179, 179]);
  check('negative label', editOps.undoLabel, 'Negative');
  check('select all', editOps.all, { x: 0, y: 0, w: 50, h: 40 });
  check('copy selection', editOps.clip, [50, 40]);

  // Thumbnails: the grid lists the folder, thumbnails decode lazily, clicking one shows it, T closes the grid.
  await p.evaluate(async () => {
    const mk = (w, h, color) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h); return c; };
    const blob = (c, t) => new Promise((r) => c.toBlob(r, t));
    const files = [];
    for (const [n, col] of [['t1.png', '#f00'], ['t2.png', '#0f0'], ['t3.png', '#00f']]) files.push(new File([await blob(mk(64, 48, col), 'image/png')], n));
    await qn.exec('file.openDropped', files);
  });
  await p.waitForTimeout(600);
  await p.evaluate(() => qn.exec('browse.thumbnails'));
  await p.waitForSelector('.qn-thumb-pic canvas');
  await p.waitForTimeout(400);
  check('thumb grid', await p.evaluate(() => { const w = qn.tab.el; return [w.querySelectorAll('.qn-thumb').length, w.querySelectorAll('.qn-thumb-pic canvas').length, getComputedStyle(w.querySelector('.qn-viewer')).display, w.querySelector('.qn-thumb.qn-current .qn-thumb-name').textContent]; }), [3, 3, 'none', 't1.png']);
  await p.click('.qn-thumb:nth-child(2)');
  await p.waitForTimeout(400);
  check('thumb click', await p.evaluate(() => [qn.picture.name, document.querySelector('.qn-thumb.qn-current .qn-thumb-name').textContent]), ['t2.png', 't2.png']);
  await p.evaluate(() => { const t = document.querySelector('.qn-thumb:nth-child(3)'); t.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); });
  check('thumb mark', await p.evaluate(() => [qn.tab.marked.size, document.querySelectorAll('.qn-thumb.qn-marked').length]), [1, 1]);
  await p.evaluate(() => qn.exec('browse.viewMode', 'filmstrip'));
  await p.waitForTimeout(200);
  check('filmstrip', await p.evaluate(() => { const w = qn.tab.el; return [getComputedStyle(w.querySelector('.qn-viewer')).display !== 'none', w.querySelector('.qn-thumbs').classList.contains('qn-thumbs-strip')]; }), [true, true]);
  await p.evaluate(() => qn.exec('browse.viewMode', 'off'));
  check('thumbs off', await p.evaluate(() => qn.tab.el.querySelector('.qn-thumbs').style.display), 'none');

  // Batch: the engine converts the three thumbnails to JPEG at 32 px with a counter pattern into a collecting sink.
  const batch = await p.evaluate(async () => {
    const { runBatch } = await window.__qnBatch();
    const outputs = [];
    const job = { inputs: [...qn.folder.entries], format: 'jpeg', quality: 80, keepMeta: true, steps: { resize: { mode: 'long', value: 32, kernel: 'lanczos3', onlyShrink: true }, grayscale: true }, names: { pattern: 'out-{n:2}', start: 1, pad: 2 } };
    const res = await runBatch(qn, job, async (r) => { outputs.push({ name: r.name, size: r.data.length, head: [...r.data.subarray(0, 3)] }); return { uri: null, name: r.name }; }, { silent: true });
    const bmp = await createImageBitmap(new Blob([await (async () => { const { runBatch: rb } = await window.__qnBatch(); let d; await rb(qn, { ...job, inputs: [qn.folder.entries[1]] }, async (r) => { d = r.data; return { uri: null, name: r.name }; }, { silent: true }); return d; })()], { type: 'image/jpeg' }));
    return { names: outputs.map((o) => o.name), heads: outputs.map((o) => o.head), done: res.done.length, failed: res.failed.length, size: [bmp.width, bmp.height] };
  });
  check('batch names', batch.names, ['out-01.jpg', 'out-02.jpg', 'out-03.jpg']);
  check('batch jpeg', batch.heads.every((h) => h[0] === 255 && h[1] === 216), true);
  check('batch counts', [batch.done, batch.failed], [3, 0]);
  check('batch resize', batch.size, [32, 24]);

  // Adjust: auto-adjust, sharpen and Before/After through the real commands (on the picture the batch left open).
  const adj = await p.evaluate(async () => {
    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#303030'); g.addColorStop(1, '#a0a0a0'); x.fillStyle = g; x.fillRect(0, 0, w, h); return c; };
    const blob = (c, t) => new Promise((r) => c.toBlob(r, t));
    await qn.exec('file.openDropped', [new File([await blob(mk(80, 20), 'image/png')], 'adj.png')]);
    await new Promise((r) => setTimeout(r, 600));
    const before = [...qn.viewer.pixelAt(79, 10)].slice(0, 3);
    await qn.exec('adjust.auto');
    const after = [...qn.viewer.pixelAt(79, 10)].slice(0, 3);
    await qn.exec('adjust.sharpen');
    const label = qn.tab.undoLabel;
    await qn.exec('adjust.beforeAfter');
    const orig = [...qn.viewer.pixelAt(79, 10)].slice(0, 3);
    const showing = qn.tab.showingOriginal;
    await qn.exec('adjust.beforeAfter');
    return { before, after, label, orig, showing, back: qn.tab.showingOriginal, canUndo: qn.tab.canUndo };
  });
  check('auto adjust brightens the light end', adj.after[0] > adj.before[0] + 30, true);
  check('sharpen label', adj.label, 'Sharpen');
  check('before/after shows the original', [adj.orig, adj.showing, adj.back, adj.canUndo], [adj.before, true, false, true]);

  // Effects: a dialog effect accepted through its OK button, Repeat Last, a canvas-changing frame, the browser grid and the custom convolution.
  const fxr = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const ok = async () => { for (let i = 0; i < 40; i++) { const b = document.querySelector('.ql-dialog .ql-primary'); if (b && document.querySelector('.ql-dialog-preview img')) { b.click(); return true; } await wait(50); } return false; };
    const w0 = qn.picture.width, h0 = qn.picture.height;
    const before = [...qn.viewer.pixelAt(40, 10)].slice(0, 3);
    const run = qn.exec('fx.solarize'); const clicked = await ok(); await run; await wait(100);
    const sol = [...qn.viewer.pixelAt(40, 10)].slice(0, 3), label1 = qn.tab.undoLabel;
    await qn.exec('fx.repeatLast'); await wait(100);
    const twice = [...qn.viewer.pixelAt(40, 10)].slice(0, 3), label2 = qn.tab.undoLabel;
    const run2 = qn.exec('fx.instantFrame'); const clicked2 = await ok(); await run2; await wait(100);
    const framed = [qn.picture.width, qn.picture.height];
    const run3 = qn.exec('fx.browser'); let cards = 0; for (let i = 0; i < 40; i++) { cards = document.querySelectorAll('.qn-fxcard img[src^="data:"]').length; if (cards >= 10) break; await wait(50); }
    document.querySelector('.ql-dialog .ql-btn:not(.ql-primary)')?.click(); await run3;
    const run4 = qn.exec('fx.convolution'); const clicked4 = await ok(); await run4; await wait(100);
    return { clicked, clicked2, clicked4, before, sol, twice, label1, label2, w0, h0, framed, cards, label4: qn.tab.undoLabel, canUndo: qn.tab.canUndo };
  });
  check('solarize dialog applied', [fxr.clicked, fxr.label1], [true, 'Solarize']);
  check('solarize inverts the light end', fxr.sol[0] < fxr.before[0] && fxr.sol[0] === 255 - fxr.before[0], true);
  check('repeat last effect re-solarizes', [fxr.label2, fxr.twice[0] < fxr.sol[0] || fxr.twice[0] === fxr.sol[0]], ['Solarize', true]);
  check('instant frame grows the canvas', [fxr.clicked2, fxr.framed[0] > fxr.w0, fxr.framed[1] > fxr.h0 + (fxr.framed[0] - fxr.w0) / 2], [true, true, true]);
  check('effects browser renders thumbnails', fxr.cards >= 10, true);
  check('custom convolution applied', [fxr.clicked4, fxr.label4, fxr.canUndo], [true, 'Custom Filter', true]);

  // Metadata: rating and favorite through the commands, the caption dialog, Strip Metadata and a checksum (the web File has no URI, so writes go through the download path).
  const md = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const M = await window.__qnMeta(), N = await window.__qnNative();
    const dialog = async () => { for (let i = 0; i < 60; i++) { if (document.querySelector('.ql-dialog .ql-primary')) return true; await wait(50); } return false; };
    // A fake File System Access handle so the dropped file has somewhere to write back to.
    const store = { parts: [] };
    const handle = { name: qn.picture.name, kind: 'file', isSameEntry: async () => false, createWritable: async () => ({ write: async (b) => { store.parts.push(b); }, close: async () => {} }) };
    qn.picture.entry.uri = 'fsa:' + (await N.handleId(handle));
    await qn.exec('browse.rate', 4); await wait(150);
    const v1 = await M.readMeta(qn, qn.picture.entry);
    await qn.exec('browse.favorite'); await wait(150);
    const fav = (await M.readMeta(qn, qn.picture.entry)).props.favorite;
    const run = qn.exec('meta.caption'); const d1 = await dialog();
    const title = document.querySelector('.ql-dialog input[id^="f_title_"]'); title.value = 'E2E title'; title.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.ql-dialog .ql-primary').click(); await run; await wait(200);
    const v2 = await M.readMeta(qn, qn.picture.entry);
    const sizeBefore = qn.picture.bytes.length;
    const run2 = qn.exec('meta.strip'); const d2 = await dialog(); document.querySelector('.ql-dialog .ql-primary').click(); await run2; await wait(200);
    const v3 = await M.readMeta(qn, qn.picture.entry);
    return { writes: store.parts.length, uriKept: qn.picture.entry.uri.startsWith('fsa:'), d1, d2, format: qn.picture.format.id, rating: v1.props.rating, fav, title: v2.props.title, ratingKept: v2.props.rating, embeddedAfterStrip: v3.embedded, smaller: qn.picture.bytes.length < sizeBefore, md5: M.md5(new Uint8Array(0)), width: qn.picture.width };
  });
  check('rating written into the PNG', [md.format, md.rating, md.fav, md.writes, md.uriKept], ['png', 4, true, 4, true]);
  check('caption dialog saved the title and kept the rating', [md.d1, md.title, md.ratingKept], [true, 'E2E title', 4]);
  check('strip removed the packet', [md.d2, md.embeddedAfterStrip, md.smaller, md.md5], [true, null, true, 'd41d8cd98f00b204e9800998ecf8427e']);

  // Region Tags: add a region from the selection, save it into the PNG, read it back.
  const reg = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const M = await window.__qnMeta(), N = await window.__qnNative();
    const top = () => [...document.querySelectorAll('.ql-dialog')].pop();
    const title = (d) => d?.querySelector('h2')?.textContent || '';
    const waitFor = async (pred, ms = 6000) => { for (let i = 0; i < ms / 50; i++) { const d = top(); if (d && pred(d)) return d; await wait(50); } throw new Error('dialog not found; top is ' + title(top())); };
    const noDialog = async () => { for (let i = 0; i < 80 && document.querySelector('.ql-dialog'); i++) await wait(50); };
    const field = (d, key) => d.querySelector(`[id^="f_${key}_"]`);
    const btn = (d, text) => [...d.querySelectorAll('button')].find((b) => b.textContent.trim().replace(/…$/, '') === text);
    await noDialog();
    const store = { parts: [] };
    const handle = { name: qn.picture.name, kind: 'file', isSameEntry: async () => false, createWritable: async () => ({ write: async (b) => { store.parts.push(b); }, close: async () => {} }) };
    qn.picture.entry.uri = 'fsa:' + (await N.handleId(handle));
    qn.tab.setSelection({ x: 10, y: 8, w: 20, h: 16 });
    const run = qn.exec('meta.regions');
    let d = await waitFor((x) => title(x) === 'Region Tags');
    btn(d, 'Add region').click();
    d = await waitFor((x) => title(x) === 'Add Region' && !!field(x, 'name'));
    field(d, 'name').value = 'Anne'; field(d, 'name').dispatchEvent(new Event('input', { bubbles: true }));
    const fs = field(d, 'fromSel'); if (fs) { fs.checked = true; fs.dispatchEvent(new Event('change', { bubbles: true })); }
    d.querySelector('.ql-primary').click();
    // The Region Tags dialog reopens with the new region listed.
    d = await waitFor((x) => title(x) === 'Region Tags' && /Anne/.test(x.textContent) && !!btn(x, 'Save'));
    btn(d, 'Save').click();
    await run; await noDialog();
    for (let i = 0; i < 60 && !store.parts.length; i++) await wait(50);
    await wait(150);
    const view = await M.readMeta(qn, qn.picture.entry);
    const doc = M.readRegions(view.embedded);
    qn.tab.setSelection(null);
    return { writes: store.parts.length, count: doc.regions.length, name: doc.regions[0]?.name, type: doc.regions[0]?.type, dimsOk: !!(doc.dims && doc.dims.w > 0 && doc.dims.h > 0), cx: doc.regions[0] ? Math.round(doc.regions[0].area.x * 100) : 0, person: view.props.personInImage, left: document.querySelectorAll('.ql-dialog').length };
  });
  check('region written to the PNG and read back', [reg.writes > 0, reg.count, reg.name, reg.type, reg.dimsOk, reg.cx > 0 && reg.cx < 100, reg.person, reg.left], [true, 1, 'Anne', 'Face', true, true, ['Anne'], 0]);

  // Find Duplicates: two byte-identical files plus a resized copy and a different picture, grouped through the dialog.
  const dup = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const mk = (w, h, f) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); for (let y = 0; y < h; y += 8) for (let i = 0; i < w; i += 8) { x.fillStyle = f(i, y); x.fillRect(i, y, 8, 8); } return c; };
    const blob = (c) => new Promise((r) => c.toBlob(r, 'image/png'));
    const pat = (i, y) => `hsl(${(i * 3 + y * 5) % 360}, 70%, ${40 + ((i + y) % 32)}%)`;
    const big = mk(128, 96, pat), other = mk(128, 96, (i, y) => ((i / 8 + y / 8) % 2 ? '#fff' : '#000'));
    const small = document.createElement('canvas'); small.width = 64; small.height = 48; small.getContext('2d').drawImage(big, 0, 0, 64, 48);
    const b1 = await blob(big);
    await qn.exec('file.openDropped', [new File([b1], 'one.png'), new File([b1], 'two.png'), new File([await blob(small)], 'half.png'), new File([await blob(other)], 'other.png')]);
    await wait(600);
    const run = qn.exec('browse.findDuplicates');
    for (let i = 0; i < 60 && !document.querySelector('.ql-dialog .ql-primary'); i++) await wait(50);
    document.querySelector('.ql-dialog .ql-primary').click();
    let title = ''; for (let i = 0; i < 100; i++) { const t = document.querySelector('.ql-dialog-head'); if (t && /Duplicates —/.test(t.textContent)) { title = t.textContent; break; } await wait(50); }
    const cards = document.querySelectorAll('.ql-dialog .qn-fxcard').length;
    document.querySelector('.ql-dialog .ql-primary').click(); await run; await wait(100);
    return { title, cards, marked: qn.tab.marked.size, order: qn.folder.length };
  });
  check('duplicates grouped', [/1 group/.test(dup.title), dup.cards, dup.marked, dup.order], [true, 3, 2, 4]);

  // Adjust: Curves with the Brighten preset through its dialog, then Copy / Paste Adjustments onto the next picture.
  const cv = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const dialog = async () => { for (let i = 0; i < 60; i++) { if (document.querySelector('.ql-dialog .ql-primary') && document.querySelector('.ql-dialog-preview img')) return true; await wait(50); } return false; };
    const before = [...qn.viewer.pixelAt(10, 10)].slice(0, 3);
    const run = qn.exec('adjust.curves'); const d1 = await dialog();
    const curve = !!document.querySelector('.ql-dialog canvas.qn-curve');
    const presetSel = document.querySelectorAll('.ql-dialog select')[1]; presetSel.value = 'Brighten'; presetSel.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(300);
    document.querySelector('.ql-dialog .ql-primary').click(); await run; await wait(200);
    const after = [...qn.viewer.pixelAt(10, 10)].slice(0, 3);
    await qn.exec('adjust.copySettings'); await wait(50);
    qn.prefs.confirmClose = false; // leaving an edited picture must not prompt here
    await qn.exec('view.next'); await wait(500);
    const name2 = qn.picture.name; const b2 = [...qn.viewer.pixelAt(10, 10)].slice(0, 3);
    await qn.exec('adjust.pasteSettings'); await wait(200);
    const a2 = [...qn.viewer.pixelAt(10, 10)].slice(0, 3);
    return { d1, curve, before, after, name2, b2, a2, label: qn.tab.undoLabel };
  });
  check('curves preset brightens', [cv.d1, cv.curve, cv.after[1] > cv.before[1]], [true, true, true]);
  check('paste adjustments replays the curve', [cv.a2[1] > cv.b2[1], cv.label], [true, 'Paste Adjustments']);

  // Insert Text through its dialog (bottom-right corner changes), then Join Side by Side of the four pictures into a new window, and the History panel.
  const ins = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const dialog = async () => { for (let i = 0; i < 80; i++) { if (document.querySelector('.ql-dialog .ql-primary') && document.querySelector('.ql-dialog-preview img')) return true; await wait(50); } return false; };
    const w = qn.picture.width, h = qn.picture.height;
    const before = [...qn.viewer.pixelAt(w - 3, h - 3)].slice(0, 3);
    const run = qn.exec('edit.insertText'); const d1 = await dialog();
    const ta = document.querySelector('.ql-dialog textarea'); ta.value = 'HELLO {w}'; ta.dispatchEvent(new Event('input', { bubbles: true }));
    const anchor = [...document.querySelectorAll('.ql-dialog select')].find((s) => [...s.options].some((o) => o.value === 'br')); anchor.value = 'mc'; anchor.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(300); document.querySelector('.ql-dialog .ql-primary').click(); await run; await wait(200);
    let changed = false; for (let y = Math.floor(h * 0.3); y < h * 0.7 && !changed; y += 2) for (let x = Math.floor(w * 0.2); x < w * 0.8; x += 2) { const px = qn.viewer.pixelAt(x, y); if (px[0] > 240 && px[1] > 240 && px[2] > 240) { changed = true; break; } }
    const label = qn.tab.undoLabel;
    const runH = qn.exec('edit.history'); for (let i = 0; i < 40 && !document.querySelector('.ql-dialog .qn-fxcard'); i++) await wait(50);
    const cards = document.querySelectorAll('.ql-dialog .qn-fxcard').length; document.querySelector('.ql-dialog .ql-primary').click(); await runH;
    for (let i = 0; i < 40 && document.querySelector('.ql-dialog'); i++) await wait(50);
    const windowsBefore = qn.tabs.length;
    const run2 = qn.exec('create.panoramaJoin'); for (let i = 0; i < 40 && !document.querySelector('.ql-dialog .ql-primary'); i++) await wait(50);
    document.querySelector('.ql-dialog .ql-primary').click(); await run2; await wait(800);
    return { d1, before, changed, label, cards, windowsBefore, windowsAfter: qn.tabs.length, name: qn.picture?.name, width: qn.picture?.width, height: qn.picture?.height };
  });
  check('insert text drew white text', [ins.d1, ins.changed, ins.label], [true, true, 'Insert Text']);
  check('history panel lists the states', ins.cards >= 2, true);
  check('join side by side opened a new window', [ins.windowsAfter, /-joined\.png$/.test(ins.name), ins.height], [ins.windowsBefore + 1, true, 48]);

  // Geometry: Auto Straighten levels a picture of lines tilted by 5°; Crop Page from Photo flattens a bright page on a dark background.
  const geo = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const blob = (c) => new Promise((r) => c.toBlob(r, 'image/png'));
    const tilted = document.createElement('canvas'); tilted.width = 240; tilted.height = 180; { const x = tilted.getContext('2d'); x.fillStyle = '#eee'; x.fillRect(0, 0, 240, 180); x.translate(120, 90); x.rotate((5 * Math.PI) / 180); for (let y = -80; y < 80; y += 16) { const g = x.createLinearGradient(0, y, 0, y + 6); g.addColorStop(0, '#eee'); g.addColorStop(0.5, '#222'); g.addColorStop(1, '#eee'); x.fillStyle = g; x.fillRect(-150, y, 300, 6); } }
    const page = document.createElement('canvas'); page.width = 200; page.height = 150; { const x = page.getContext('2d'); x.fillStyle = '#222'; x.fillRect(0, 0, 200, 150); x.fillStyle = '#f4f4f4'; x.beginPath(); x.moveTo(50, 30); x.lineTo(160, 40); x.lineTo(150, 125); x.lineTo(40, 115); x.closePath(); x.fill(); }
    qn.prefs.confirmClose = false;
    await qn.exec('file.openDropped', [new File([await blob(tilted)], 'a-tilted.png'), new File([await blob(page)], 'b-page.png')]);
    await wait(600);
    await qn.exec('image.autoStraighten'); await wait(200);
    const label = qn.tab.undoLabel;
    await qn.exec('view.next'); await wait(500);
    const before = [qn.picture.width, qn.picture.height];
    await qn.exec('edit.cropPage'); await wait(300);
    const after = [qn.picture.width, qn.picture.height];
    const fc = qn.picture.frameCanvas(); const center = [...fc.getContext('2d').getImageData(Math.floor(fc.width / 2), Math.floor(fc.height / 2), 1, 1).data].slice(0, 3);
    return { label, before, after, center, label2: qn.tab.undoLabel };
  });
  check('auto straighten found about -5°', /^Auto Straighten -(4|5|6)\./.test(geo.label), true);
  check('crop page flattened the page', [geo.label2, geo.after[0] < geo.before[0], geo.after[1] < geo.before[1], geo.center[0] > 200], ['Crop Page from Photo', true, true, true]);

  // Batch Steps: an ordered job (resize, border, text watermark, metadata) through the runner with an in-memory sink.
  const bs = await p.evaluate(async () => {
    const B = await window.__qnBatch(), S = await window.__qnBatchSteps(), M = await window.__qnMeta();
    const entries = qn.tab.folder.entries;
    const actions = S.resolveActions([{ kind: 'resize', mode: 'long', value: 100, kernel: 'bilinear', onlyShrink: true }, { kind: 'border', size: 5, color: '#ff0000' }, { kind: 'text', text: '{basename}', size: 10, color: '#ffffff', anchor: 'mc', margin: 0, opacity: 1, outline: 1, font: 'sans-serif' }, { kind: 'metadata', patch: { rights: '© test', keywords: ['batch'] } }], 100);
    const job = { inputs: entries, format: 'png', quality: 90, keepMeta: true, steps: { actions }, names: { pattern: '{name}-steps' } };
    const outs = [];
    const res = await B.runBatch(qn, job, async (r) => { outs.push(r); return { uri: null, name: r.name }; }, { silent: true });
    const first = outs[0];
    const props = M.parseXmp(new TextDecoder().decode(M.extractMeta(first.data).xmp));
    const bmp = await createImageBitmap(new Blob([first.data], { type: 'image/png' }));
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
    const corner = [...x.getImageData(1, 1, 1, 1).data].slice(0, 3);
    return { n: res.done.length, names: outs.map((o) => o.name), size: [bmp.width, bmp.height], corner, rights: props.rights, keywords: props.keywords, desc: S.describeAction(actions[1]) };
  });
  check('batch steps ran in order', [bs.n, bs.names[0].endsWith('-steps.png'), bs.size, bs.corner, bs.rights, bs.keywords, bs.desc], [2, true, [110, 85], [255, 0, 0], '© test', ['batch'], 'Border 5 px']);

  // Frames and pages: an APNG with three frames reversed and its loop count set; a two-page TIFF with a page deleted.
  const pf = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const A = await window.__qnAnim();
    const mkr = (w, h, v) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255).map((x, i) => (i % 4 === 0 ? v : i % 4 === 3 ? 255 : 0)) });
    const apng = await A.encodeApng([{ raster: mkr(16, 16, 10), delay: 100 }, { raster: mkr(16, 16, 120), delay: 100 }, { raster: mkr(16, 16, 250), delay: 100 }], 0);
    const tif = A.encodeTiff([{ raster: mkr(20, 10, 30) }, { raster: mkr(12, 8, 200) }]);
    qn.prefs.confirmClose = false;
    await qn.exec('file.openDropped', [new File([apng], 'a-anim.png'), new File([tif], 'b-pages.tif')]);
    await wait(700);
    const frames = qn.picture.current.frames.length;
    const first = qn.picture.frameCanvas(qn.picture.current.frames[0]).getContext('2d').getImageData(0, 0, 1, 1).data[0];
    await qn.exec('frames.reverse'); await wait(100);
    const firstAfter = qn.picture.frameCanvas(qn.picture.current.frames[0]).getContext('2d').getImageData(0, 0, 1, 1).data[0];
    const run = qn.exec('frames.loopCount'); for (let i = 0; i < 40 && !document.querySelector('.ql-dialog .ql-primary'); i++) await wait(50);
    const inp = document.querySelector('.ql-dialog input[type=number]'); inp.value = '3'; inp.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.ql-dialog .ql-primary').click(); await run; await wait(100);
    const loops = qn.picture.current.loops;
    await qn.exec('view.next'); await wait(600);
    const pages = qn.picture.pages.length;
    await qn.exec('pages.delete'); await wait(100);
    return { frames, first, firstAfter, loops, pages, pagesAfter: qn.picture.pages.length, width: qn.picture.width, label: qn.tab.undoLabel };
  });
  check('frames reversed and loop count set', [pf.frames, pf.first, pf.firstAfter, pf.loops], [3, 10, 250, 3]);
  check('page deleted', [pf.pages, pf.pagesAfter, pf.width, pf.label], [2, 1, 12, 'Delete page 1']);

  // View overlays: the grid draws white lines on the picture, grayscale preview changes the display but not the pixels, clipping warnings mark the white page.
  const ov = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const O = await window.__qnOverlays();
    const blob = (c) => new Promise((r) => c.toBlob(r, 'image/png'));
    const c = document.createElement('canvas'); c.width = 120; c.height = 90; const x = c.getContext('2d'); x.fillStyle = '#c03030'; x.fillRect(0, 0, 120, 90); x.fillStyle = '#ffffff'; x.fillRect(80, 60, 40, 30);
    await qn.exec('file.openDropped', [new File([await blob(c)], 'ov.png')]); await wait(600);
    await qn.exec('view.actualSize'); await wait(200);
    const v = qn.viewer; const r = v.pictureRect(); const vc = v.el.querySelector('canvas'); const vx = vc.getContext('2d'); const dpr = vc.width / v.el.clientWidth;
    const at = (px, py) => [...vx.getImageData(Math.round((r.x + px) * dpr), Math.round((r.y + py) * dpr), 1, 1).data].slice(0, 3);
    const plain = at(40, 30);
    await qn.exec('view.grid', 'thirds'); await wait(150);
    const onLine = [39, 40, 41].map((xx) => at(xx, 30)).reduce((a, b) => (b[1] > a[1] ? b : a));
    await qn.exec('view.grid', 'off'); await qn.exec('view.grayscalePreview'); await wait(150);
    const gray = at(20, 20); const pixel = [...v.pixelAt(20, 20)].slice(0, 3);
    await qn.exec('view.grayscalePreview'); await qn.exec('view.clipping'); await wait(150);
    const clipped = at(100, 75);
    await qn.exec('view.clipping'); await qn.exec('view.osd'); await wait(150);
    const osd = O.viewState.osd; await qn.exec('view.osd');
    return { plain, onLine, gray, pixel, clipped, osd };
  });
  check('grid line is white over red', [ov.plain[0] > 150 && ov.plain[1] < 80, ov.onLine[1] > 150], [true, true]);
  check('grayscale preview leaves the pixels', [Math.abs(ov.gray[0] - ov.gray[1]) < 3, ov.pixel[0] > 150 && ov.pixel[1] < 80], [true, true]);
  check('clipping marks the white area red', [ov.clipped[0] > 200, ov.clipped[1] < 80, ov.osd], [true, true, true]);

  // Slideshow: a 1-second show over three pictures advances, pauses on Space and stops on Escape, restoring the view.
  const sl = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const blob = (c) => new Promise((r) => c.toBlob(r, 'image/png'));
    const mk = (v) => { const c = document.createElement('canvas'); c.width = 30; c.height = 20; const x = c.getContext('2d'); x.fillStyle = v; x.fillRect(0, 0, 30, 20); return c; };
    qn.prefs.confirmClose = false;
    await qn.exec('file.openDropped', [new File([await blob(mk('#f00'))], 's1.png'), new File([await blob(mk('#0f0'))], 's2.png'), new File([await blob(mk('#00f'))], 's3.png')]); await wait(600);
    qn.prefs.slideshow = { seconds: 0.6, transition: 'fade', transitionMs: 100, loop: true, random: false, captions: true };
    const SH = await window.__qnShow();
    await qn.exec('show.start'); await wait(100);
    const running = SH.show.running, full = document.body.classList.contains('ql-fullscreen'), osd = (await window.__qnOverlays()).viewState.osd;
    const i0 = qn.folder.index; await wait(900); const i1 = qn.folder.index;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); await wait(50); const paused = SH.show.paused;
    await wait(900); const i2 = qn.folder.index;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(100);
    return { running, full, osd, i0, i1, paused, i2, stopped: !SH.show.running, fullAfter: document.body.classList.contains('ql-fullscreen'), osdAfter: (await window.__qnOverlays()).viewState.osd };
  });
  check('slideshow runs full screen with captions and advances', [sl.running, sl.full, sl.osd, sl.i0, sl.i1], [true, true, true, 0, 1]);
  check('slideshow pauses on Space and stops on Escape', [sl.paused, sl.i2, sl.stopped, sl.fullAfter, sl.osdAfter], [true, 1, true, false, false]);

  // Tools: a QR code opened as a picture through its dialog, an encrypted package round trip, carving pictures out of junk, and Document Cleanup through its dialog.
  const tl = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const T = await window.__qnTools();
    const windows = qn.tabs.length;
    const run = qn.exec('tools.makeQr'); for (let i = 0; i < 60 && !(document.querySelector('.ql-dialog .ql-primary') && document.querySelector('.ql-dialog-preview svg')); i++) await wait(50);
    const ta = document.querySelector('.ql-dialog textarea'); ta.value = 'https://example.org/lens'; ta.dispatchEvent(new Event('input', { bubbles: true })); await wait(150);
    document.querySelector('.ql-dialog .ql-primary').click(); await run; await wait(600);
    const qrName = qn.picture?.name, qrSize = qn.picture?.width, qrWindows = qn.tabs.length;
    const px = qn.viewer.pixelAt(0, 0); const corner = px ? px[0] : -1; const finder = qn.viewer.pixelAt(4 * 8 + 4, 4 * 8 + 4)[0];
    const pkg = await T.encryptPicture(qn.picture.bytes, 'qr.png', 'pass-word-1', 3000); const back = await T.decryptPicture(pkg, 'pass-word-1');
    let wrong = ''; try { await T.decryptPicture(pkg, 'nope'); } catch (e) { wrong = e.message; }
    const junk = new Uint8Array(50).fill(7); const all = new Uint8Array([...junk, ...qn.picture.bytes, ...junk]); const carved = T.carvePictures(all);
    const run2 = qn.exec('tools.docCleanup'); for (let i = 0; i < 80 && !(document.querySelector('.ql-dialog .ql-primary') && document.querySelector('.ql-dialog-preview img')); i++) await wait(50);
    document.querySelector('.ql-dialog .ql-primary').click(); await run2; await wait(300);
    return { qrName, qrSize, newWindow: qrWindows === windows + 1, corner, finder, back: back.name === 'qr.png' && back.bytes.length === qn.picture.bytes.length, wrong, carved: carved.map((c) => [c.format, c.offset, c.width]), label: qn.tab.undoLabel };
  });
  check('qr code opened as a picture', [tl.qrName, tl.newWindow, tl.corner, tl.finder], ['qr-code.png', true, 255, 0]);
  check('qr size is version 2 with a quiet zone', tl.qrSize, (25 + 8) * 8);
  check('encrypted package round trip', [tl.back, /Wrong password/.test(tl.wrong)], [true, true]);
  check('carved the png out of junk', tl.carved, [['png', 50, (25 + 8) * 8]]);
  check('document cleanup applied', tl.label, 'Document Cleanup');

  // Organize: the Filter Bar through its dialog narrows the thumbnails by name; Group By puts headers in the grid.
  const org = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const blob = (c) => new Promise((r) => c.toBlob(r, 'image/png'));
    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').fillRect(0, 0, w, h); return c; };
    qn.prefs.confirmClose = false;
    await qn.exec('file.openDropped', [new File([await blob(mk(30, 20))], 'wide-1.png'), new File([await blob(mk(20, 30))], 'tall-2.png'), new File([await blob(mk(30, 20))], 'wide-3.png')]); await wait(600);
    const run = qn.exec('browse.filter'); for (let i = 0; i < 80 && !document.querySelector('.ql-dialog .ql-primary'); i++) await wait(50);
    const inputs = [...document.querySelectorAll('.ql-dialog input[type=text]')]; const textField = inputs.find((i) => i.id.startsWith('f_text_')); textField.value = 'wide'; textField.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.ql-dialog .ql-primary').click(); await run; await wait(300);
    const shown = qn.tab.el.querySelectorAll('.qn-thumb').length, active = !!qn.tab.thumbs.filter;
    await qn.exec('browse.groupBy', 'type'); await wait(200);
    const headers = [...qn.tab.el.querySelectorAll('.qn-thumb-group')].map((x) => x.textContent);
    await qn.exec('browse.groupBy', 'none'); const run2 = qn.exec('browse.filter'); for (let i = 0; i < 80 && !document.querySelector('.ql-dialog .ql-btn'); i++) await wait(50);
    [...document.querySelectorAll('.ql-dialog .ql-btn')].find((b) => b.textContent === 'Clear filter').click(); await run2; await wait(200);
    return { shown, active, headers, after: qn.tab.el.querySelectorAll('.qn-thumb').length, cleared: !qn.tab.thumbs.filter };
  });
  check('filter bar narrows the thumbnails', [org.shown, org.active, org.headers, org.after, org.cleared], [2, true, ['PNG'], 3, true]);

  // Create, part two: a calendar page through its dialog, pictures pulled out of a ZIP document, and the fusion engines through the hooks.
  const cr = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const M = await window.__qnMerge(), B = await window.__qnBatch();
    const windows = qn.tabs.length;
    const run = qn.exec('create.calendar'); for (let i = 0; i < 60 && !document.querySelector('.ql-dialog .ql-primary'); i++) await wait(50);
    document.querySelector('.ql-dialog .ql-primary').click(); await run; await wait(800);
    const cal = { name: qn.picture?.name, w: qn.picture?.width, h: qn.picture?.height, newWindow: qn.tabs.length === windows + 1 };
    const zip = B.writeZip([{ name: 'word/document.xml', data: new TextEncoder().encode('<w/>') }, { name: 'word/media/image1.png', data: qn.tab.folder.entries[0] ? new Uint8Array(await qn.tab.folder.entries[0].read()) : new Uint8Array(0) }]);
    const inZip = M.picturesInZip(zip).map((p) => p.name);
    const mk = (v) => ({ width: 16, height: 16, data: new Uint8ClampedArray(16 * 16 * 4).map((_, i) => (i % 4 === 3 ? 255 : v)) });
    const fused = M.exposureFusion([mk(20), mk(230)], { levels: 2 }); const mid = fused.data[0];
    return { cal, inZip, mid, stack: M.focusStack([mk(50), mk(60)], 2).raster.width };
  });
  check('calendar page opened', [/^calendar-\d{4}-\d{2}\.png$/.test(cr.cal.name), cr.cal.w, cr.cal.h, cr.cal.newWindow], [true, 2480, 3508, true]);
  check('pictures found inside a docx-style zip', cr.inZip, ['image1.png']);
  check('fusion and stacking engines run', [cr.mid > 20 && cr.mid < 230, cr.stack], [true, 16]);

  // Selections with masks: Select All → Ellipse Selection turns the rectangle into an ellipse; Negative then changes the center but not the corner; Invert flips it; Magic Wand through its dialog selects one color region.
  const sm = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const blob = (c) => new Promise((r) => c.toBlob(r, 'image/png'));
    const c = document.createElement('canvas'); c.width = 40; c.height = 40; const x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, 40, 40); x.fillStyle = '#0000ff'; x.fillRect(0, 0, 20, 40);
    qn.prefs.confirmClose = false;
    await qn.exec('file.openDropped', [new File([await blob(c)], 'mask.png')]); await wait(600);
    await qn.exec('edit.selectAll'); await qn.exec('edit.selectEllipse'); await wait(100);
    const hasMask = !!qn.tab.selectionMask, count = qn.tab.selectionMask ? [...qn.tab.selectionMask].filter((v) => v).length : 0;
    await qn.exec('image.negative'); await wait(200);
    const center = [...qn.viewer.pixelAt(30, 20)].slice(0, 3), inside = [...qn.viewer.pixelAt(10, 20)].slice(0, 3), corner = [...qn.viewer.pixelAt(0, 0)].slice(0, 3);
    await qn.exec('edit.selectInvert'); await wait(100);
    const inv = [...qn.tab.selectionMask].filter((v) => v).length;
    await qn.exec('edit.selectNone');
    const run = qn.exec('edit.selectWand'); for (let i = 0; i < 60 && !document.querySelector('.ql-dialog .ql-primary'); i++) await wait(50);
    document.querySelector('.ql-dialog .ql-primary').click(); await run; await wait(100);
    const wand = qn.tab.selectionMask ? [...qn.tab.selectionMask].filter((v) => v).length : 0, wandRect = qn.tab.selection;
    return { hasMask, count, center, inside, corner, inv, wand, wandRect };
  });
  check('ellipse mask limits the edit', [sm.hasMask, sm.count > 1100 && sm.count < 1300, sm.center, sm.inside, sm.corner], [true, true, [0, 0, 0], [255, 255, 0], [0, 0, 255]]);
  // The wand floods the black (negated) part of the right half: the ellipse's share of it, not the still-white corners.
  check('invert and magic wand', [sm.inv, sm.wand > 500 && sm.wand < 800, sm.wandRect && sm.wandRect.w], [1600 - sm.count, true, 20]);

  // Content-Aware Resize through its dialog narrows the picture by seams; Alpha from Mask makes the unselected area transparent.
  const sc = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await qn.exec('edit.selectNone');
    for (let i = 0; i < 40 && document.querySelector('.ql-dialog'); i++) await wait(50); // the previous dialog fades out
    const w0 = qn.picture.width;
    const run = qn.exec('image.seamCarve'); for (let i = 0; i < 60 && !document.querySelector('.ql-dialog input[id^="f_w_"]'); i++) await wait(50);
    const dlg = [...document.querySelectorAll('.ql-dialog')].pop(); const wf = dlg.querySelector('input[id^="f_w_"]'); wf.value = String(w0 - 10); wf.dispatchEvent(new Event('input', { bubbles: true }));
    dlg.querySelector('.ql-primary').click(); await run; await wait(500);
    const w1 = qn.picture.width, label = qn.tab.undoLabel;
    await qn.exec('edit.selectAll'); await qn.exec('edit.selectEllipse'); await wait(50);
    for (let i = 0; i < 40 && document.querySelector('.ql-dialog'); i++) await wait(50);
    const run2 = qn.exec('image.alphaFromMask'); for (let i = 0; i < 60 && !document.querySelector('.ql-dialog .ql-primary'); i++) await wait(50);
    document.querySelector('.ql-dialog .ql-primary').click(); await run2; await wait(300);
    const fc = qn.picture.frameCanvas(); const x = fc.getContext('2d'); const cornerA = x.getImageData(0, 0, 1, 1).data[3], centerA = x.getImageData(Math.floor(fc.width / 2), Math.floor(fc.height / 2), 1, 1).data[3];
    return { w0, w1, label, cornerA, centerA, hasAlpha: qn.picture.current.hasAlpha };
  });
  check('seam carving narrowed the picture', [sc.w1, sc.label], [sc.w0 - 10, 'Content-Aware Resize']);
  check('alpha from the ellipse mask', [sc.cornerA, sc.centerA, sc.hasAlpha], [0, 255, true]);

  // Command palette finds commands; QAT add all is idempotent.
  check('search', await p.evaluate(() => window.__qnGetCommand('view.next').label), 'Next Picture');
  await p.evaluate(() => qn.exec('view.qatAddAll'));
  const qat1 = await p.evaluate(() => qn.prefs.qat.length);
  await p.evaluate(() => qn.exec('view.qatAddAll'));
  check('qat add all idempotent', await p.evaluate(() => qn.prefs.qat.length), qat1);

  // Trace to Vector, Magnifier Callout, Search by Color, Export as PDF, New Folder.
  const vec = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const top = () => [...document.querySelectorAll('.ql-dialog')].pop();
    const title = (d) => d?.querySelector('h2')?.textContent || '';
    const waitFor = async (pred, ms = 6000) => { for (let i = 0; i < ms / 50; i++) { const d = top(); if (d && pred(d)) return d; await wait(50); } throw new Error('dialog not found; top is ' + title(top())); };
    const noDialog = async () => { for (let i = 0; i < 80 && document.querySelector('.ql-dialog'); i++) await wait(50); };
    const field = (d, key) => d.querySelector(`[id^="f_${key}_"]`);
    const set = (d, key, value) => { const f = field(d, key); if (f.type === 'checkbox') f.checked = !!value; else f.value = String(value); f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true })); };
    const pixel = (x, y) => [...qn.picture.frameCanvas().getContext('2d').getImageData(x, y, 1, 1).data];
    const N = await window.__qnNative();
    await noDialog();
    const mk = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); draw(x); return new Promise((r) => c.toBlob(r, 'image/png')); };
    const files = [
      new File([await mk(120, 80, (x) => { x.fillStyle = '#fff'; x.fillRect(0, 0, 120, 80); x.fillStyle = '#000'; x.fillRect(20, 20, 40, 40); x.lineWidth = 6; x.strokeStyle = '#000'; x.beginPath(); x.arc(92, 40, 20, 0, Math.PI * 2); x.stroke(); })], 'v-logo.png', { type: 'image/png' }),
      new File([await mk(40, 40, (x) => { x.fillStyle = '#f00'; x.fillRect(0, 0, 40, 40); })], 'w-red.png', { type: 'image/png' }),
      new File([await mk(40, 40, (x) => { x.fillStyle = '#00f'; x.fillRect(0, 0, 40, 40); })], 'x-blue.png', { type: 'image/png' }),
    ];
    qn.prefs.confirmClose = false;
    await qn.exec('file.openDropped', files); await wait(600);
    const home = qn.tab; const back = async () => { if (qn.tab !== home) qn.closeTab(qn.tab); qn.activate(home); await wait(300); };
    const out = { first: qn.picture.name };
    // Trace to Vector: open the SVG as a picture and look at it.
    let run = qn.exec('tools.vectorize'); let d = await waitFor((x) => title(x).startsWith('Trace to Vector'));
    await wait(300); out.preview = /<svg/.test(d.querySelector('.ql-dialog-preview')?.innerHTML || '');
    d.querySelector('.ql-primary').click(); await run; await noDialog(); await wait(600);
    out.svg = { name: qn.picture.name, fmt: qn.picture.format.id, size: [qn.picture.width, qn.picture.height], square: pixel(40, 40)[3] > 200 && pixel(40, 40)[0] < 60, background: pixel(100, 8)[3], ringHole: pixel(92, 40)[3], ring: pixel(92, 21)[3] > 200 };
    await back();
    // Magnifier Callout over part of the black square: the inset lands bottom right.
    qn.tab.setSelection({ x: 20, y: 20, w: 20, h: 20 });
    const before = pixel(110, 72);
    run = qn.exec('edit.callout'); d = await waitFor((x) => title(x) === 'Magnifier Callout');
    set(d, 'shadow', false); d.querySelector('.ql-primary').click(); await run; await noDialog(); await wait(300);
    out.callout = { before: before.slice(0, 3), after: pixel(110, 72).slice(0, 3), label: qn.tab.undoLabel, size: [qn.picture.width, qn.picture.height], selection: qn.tab.selection };
    await qn.exec('edit.undo'); await wait(200);
    // Search by Color: only the red picture.
    run = qn.exec('browse.searchColor'); d = await waitFor((x) => title(x) === 'Search by Color');
    set(d, 'color', '#ff0000'); d.querySelector('.ql-primary').click();
    d = await waitFor((x) => title(x) === 'Color #ff0000'); out.color = { hits: [...d.querySelectorAll('.qn-ai-card')].map((c) => c.textContent), label: qn.tab.thumbs ? qn.tab.thumbs.filterLabel : '' };
    d.querySelector('.ql-primary').click(); await run; await noDialog();
    if (qn.tab.thumbs) { qn.tab.thumbs.filter = null; qn.tab.thumbs.filterLabel = ''; qn.tab.thumbs.refilter(); }
    // Export as PDF of the folder, captured through a stubbed save picker.
    const saved = { parts: [], name: '' };
    const picker = window.showSaveFilePicker;
    window.showSaveFilePicker = async (o) => { saved.name = o?.suggestedName || ''; return { name: saved.name, createWritable: async () => ({ write: async (b) => { saved.parts.push(b); }, close: async () => {} }) }; };
    run = qn.exec('file.export.pdf'); d = await waitFor((x) => title(x) === 'Export as PDF');
    set(d, 'which', 'folder'); set(d, 'captions', true); d.querySelector('.ql-primary').click(); await run; await noDialog();
    window.showSaveFilePicker = picker;
    const blob = new Blob(saved.parts); const u8 = new Uint8Array(await blob.arrayBuffer());
    let bin = ''; for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    out.pdf = { name: saved.name, b64: btoa(bin), head: String.fromCharCode(...u8.subarray(0, 5)) };
    // New Folder in a (fake) picked directory.
    const made = [];
    const dir = { kind: 'directory', name: 'root', isSameEntry: async () => false, getDirectoryHandle: async (name, o) => { made.push([name, !!o?.create]); return { kind: 'directory', name, isSameEntry: async () => false }; } };
    qn.folder.uri = 'fsadir:' + (await N.handleId(dir));
    out.newFolderEnabled = window.__qnGetCommand('browse.newFolder').isEnabled(qn);
    run = qn.exec('browse.newFolder'); d = await waitFor((x) => title(x) === 'New Folder');
    set(d, 'v', 'Scans 1926'); d.querySelector('.ql-primary').click(); await run; await noDialog();
    out.made = made;
    return out;
  });
  check('vector: opened as an SVG picture with the shapes and the hole', [vec.svg.fmt, vec.svg.size, vec.svg.square, vec.svg.background, vec.svg.ringHole, vec.svg.ring, vec.preview, /\.svg$/.test(vec.svg.name)], ['svg', [120, 80], true, 0, 0, true, true, true]);
  check('magnifier callout inset in the free corner', [vec.callout.before, vec.callout.after, vec.callout.label, vec.callout.size, vec.callout.selection], [[255, 255, 255], [0, 0, 0], 'Magnifier Callout', [120, 80], null]);
  check('search by color finds only the red picture', [vec.color.hits.length, /^w-red\.png — 100%/.test(vec.color.hits[0] || ''), vec.color.label], [1, true, 'Color #ff0000']);
  check('new folder created in the picked directory', [vec.newFolderEnabled, vec.made], [true, [['Scans 1926', true]]]);
  check('export as PDF captured', [vec.pdf.head, /\.pdf$/.test(vec.pdf.name)], ['%PDF-', true]);
  {
    const { execFileSync } = await import('node:child_process');
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const file = `${mkdtempSync(`${tmpdir()}/qn-pdf-`)}/export.pdf`;
    writeFileSync(file, Buffer.from(vec.pdf.b64, 'base64'));
    let info = '';
    try { info = execFileSync('pdfinfo', ['-f', '1', '-l', '3', file], { encoding: 'utf8' }); } catch { info = ''; }
    if (info) {
      const pages = +(info.match(/^Pages:\s+(\d+)/m) || [])[1];
      const sizes = [...info.matchAll(/^Page\s+\d+ size:\s+([\d.]+) x ([\d.]+)/gm)].map((m) => (+m[1] > +m[2] ? 'landscape' : 'portrait'));
      check('PDF has a page per picture, oriented by each picture', [pages, sizes], [3, ['landscape', 'portrait', 'portrait']]);
    }
  }

  // View tools, part two: Info Pane, Navigator and Measure with real mouse input, Filmstrip,
  // Reset All Adjustments, and Keep the Original / Revert to Original through a save.
  const vt0 = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 80 && document.querySelector('.ql-dialog'); i++) await wait(50);
    const mk = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); draw(x); return new Promise((r) => c.toBlob(r, 'image/png')); };
    const big = await mk(1600, 1000, (x) => { x.fillStyle = '#204080'; x.fillRect(0, 0, 800, 1000); x.fillStyle = '#e0c020'; x.fillRect(800, 0, 800, 1000); x.fillStyle = '#fff'; x.fillRect(100, 100, 300, 300); });
    qn.prefs.confirmClose = false;
    await qn.exec('file.openDropped', [new File([big], 'nav-big.png', { type: 'image/png' }), new File([await mk(60, 40, (x) => { x.fillStyle = '#888'; x.fillRect(0, 0, 60, 40); })], 'nav-small.png', { type: 'image/png' })]);
    for (let i = 0; i < 60 && qn.picture?.name !== 'nav-big.png'; i++) await wait(50);
    await wait(300);
    const out = { name: qn.picture.name };
    // Info Pane.
    await qn.exec('view.infoPane'); await wait(200);
    const pane = qn.viewer.el.querySelector('.qn-infopane');
    const hc = pane?.querySelector('canvas'); let histInk = 0;
    if (hc) { const d = hc.getContext('2d').getImageData(0, 0, hc.width, hc.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) histInk++; }
    out.info = { inViewer: !!pane, text: pane ? pane.textContent : '', histInk, active: window.__qnGetCommand('view.infoPane').isActive(qn) };
    await qn.exec('view.infoPane'); await wait(100);
    out.infoClosed = !qn.viewer.el.querySelector('.qn-infopane');
    // Navigator at 2x.
    await qn.exec('view.navigator');
    qn.viewer.setZoom(2); qn.viewer.panTo(400, 250); await wait(150);
    const vb = qn.viewer.el.getBoundingClientRect(); const nav = qn.viewer.navigatorBox();
    out.nav = { box: nav, view: { left: vb.left, top: vb.top, w: vb.width, h: vb.height }, start: qn.viewer.viewCenter };
    return out;
  });
  check('info pane shows the facts and a histogram, then closes', [vt0.name, vt0.info.inViewer, /nav-big\.png/.test(vt0.info.text), /1600 × 1000/.test(vt0.info.text), vt0.info.histInk > 500, vt0.info.active, vt0.infoClosed], ['nav-big.png', true, true, true, true, true, true]);
  check('navigator shown when zoomed in', !!vt0.nav.box, true);
  if (vt0.nav.box) {
    const n = vt0.nav.box, L = vt0.nav.view.left, T = vt0.nav.view.top;
    // A click in the navigator's lower right centers the view there (clamped to the picture's edge).
    await p.mouse.click(L + n.x + n.w * 0.85, T + n.y + n.h * 0.85);
    const afterClick = await p.evaluate(() => ({ c: qn.viewer.viewCenter, sel: qn.tab.selection }));
    // A drag inside it follows the pointer back toward the upper left.
    await p.mouse.move(L + n.x + n.w * 0.8, T + n.y + n.h * 0.8); await p.mouse.down();
    await p.mouse.move(L + n.x + n.w * 0.5, T + n.y + n.h * 0.4, { steps: 6 }); await p.mouse.move(L + n.x + n.w * 0.3, T + n.y + n.h * 0.3, { steps: 6 }); await p.mouse.up();
    const afterDrag = await p.evaluate(() => qn.viewer.viewCenter);
    check('navigator click pans to the lower right', [afterClick.c.x > 1150, afterClick.c.y > 700, afterClick.sel], [true, true, null]);
    check('navigator drag follows the pointer', [Math.abs(afterDrag.x - 0.3 * 1600) < 30, Math.abs(afterDrag.y - 0.3 * 1000) < 30], [true, true]);
  }
  // Measure: two clicks give the distance and angle; Set Scale from that line; then a closed shape.
  const mv = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await qn.exec('view.navigator'); qn.viewer.setZoom('fit'); await wait(150);
    await qn.exec('view.measure', 'toggle'); await wait(50);
    const r = qn.viewer.pictureRect(), z = qn.viewer.zoom, b = qn.viewer.el.getBoundingClientRect();
    const at = (x, y) => [b.left + r.x + x * z, b.top + r.y + y * z];
    return { a: at(100, 100), b: at(400, 500), c: at(700, 100), d: at(700, 500), z };
  });
  await p.mouse.click(...mv.a); await p.mouse.click(...mv.b);
  const m1 = await p.evaluate(async () => { const V = await window.__qnView2(); const m = V.viewState.measure; return { n: m.pts.length, len: V.dist(m.pts[0], m.pts[1]), lines: V.readout(m.pts, m.closed, m.scale) }; });
  check('measure: distance and angle from two clicks', [m1.n, Math.abs(m1.len - 500) < 5, /^Distance /.test(m1.lines[0]), /^Angle -5[23]\.\d+°$/.test(m1.lines[1])], [2, true, true, true]);
  const msc = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const top = () => [...document.querySelectorAll('.ql-dialog')].pop();
    const run = qn.exec('view.measure', 'scale'); let d; for (let i = 0; i < 80 && !(d = top())?.querySelector('[id^="f_known_"]'); i++) await wait(50);
    const k = d.querySelector('[id^="f_known_"]'); k.value = '50'; k.dispatchEvent(new Event('input', { bubbles: true }));
    const u = d.querySelector('[id^="f_unit_"]'); u.value = 'cm'; u.dispatchEvent(new Event('input', { bubbles: true }));
    d.querySelector('.ql-primary').click(); await run; for (let i = 0; i < 80 && document.querySelector('.ql-dialog'); i++) await wait(50);
    const V = await window.__qnView2(); const m = V.viewState.measure;
    const lines = V.readout(m.pts, m.closed, m.scale);
    await qn.exec('view.measure', 'clear');
    return { unit: m.scale?.unit, line: lines[0] };
  });
  check('measure: scale set from the measured line', [msc.unit, /^Distance 50 cm \(/.test(msc.line)], ['cm', true]);
  await p.mouse.click(...mv.a); await p.mouse.click(...mv.c); await p.mouse.dblclick(...mv.d);
  const m2 = await p.evaluate(async () => {
    const V = await window.__qnView2(); const m = V.viewState.measure;
    const out = { n: m.pts.length, closed: m.closed, areaPx: V.polygonArea(m.pts), lines: V.readout(m.pts, m.closed, m.scale) };
    await qn.exec('view.measure', 'toggle');
    out.offPts = V.viewState.measure.pts.length; out.on = V.viewState.measure.on;
    return out;
  });
  // Triangle (100,100) (700,100) (700,500): 0.5 × 600 × 400 = 120000 px².
  check('measure: a closed shape gives its area in the scale\'s unit', [m2.n, m2.closed, Math.abs(m2.areaPx - 120000) / 120000 < 0.03, /^Perimeter .* cm /.test(m2.lines[0]), /^Area .* cm² /.test(m2.lines[1]), m2.on, m2.offPts], [3, true, true, true, true, false, 0]);
  const vt1 = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const pixel = (x, y) => [...qn.picture.frameCanvas().getContext('2d').getImageData(x, y, 1, 1).data].slice(0, 3);
    const N = await window.__qnNative();
    const out = {};
    // Filmstrip.
    await qn.exec('view.filmstrip'); await wait(100);
    out.strip = [qn.tab.thumbs.open, qn.tab.thumbs.mode];
    await qn.exec('view.filmstrip'); await wait(100);
    out.stripOff = qn.tab.thumbs.open;
    // Reset All Adjustments.
    out.resetDisabled = !window.__qnGetCommand('adjust.resetAll').isEnabled(qn);
    const p0 = pixel(200, 200);
    await qn.exec('image.negative', 'all'); await wait(150);
    const p1 = pixel(200, 200);
    await qn.exec('adjust.resetAll'); await wait(250);
    out.reset = { p0, p1, p2: pixel(200, 200), label: qn.tab.undoLabel };
    qn.tab.undo(); await wait(150); out.reset.undone = pixel(200, 200);
    qn.tab.undo(); await wait(150);
    // Keep the original on save, then Revert to Original.
    const files = new Map(); const fileHandle = (name, bytes) => ({ kind: 'file', name, isSameEntry: async (o) => o === undefined, getFile: async () => new File([bytes.value], name, { type: 'image/png' }), createWritable: async () => { const parts = []; return { write: async (b) => { parts.push(b); }, close: async () => { bytes.value = new Uint8Array(await new Blob(parts).arrayBuffer()); } }; } });
    const origBytes = qn.picture.bytes.slice();
    const self = { value: origBytes };
    const fh = fileHandle('nav-big.png', self);
    const dir = { kind: 'directory', name: 'scans', isSameEntry: async () => false, getFileHandle: async (name, o) => { if (!files.has(name)) { if (!o?.create) throw new DOMException('missing', 'NotFoundError'); files.set(name, { value: new Uint8Array() }); } return fileHandle(name, files.get(name)); } };
    qn.picture.entry.uri = 'fsa:' + (await N.handleId(fh));
    qn.folder.uri = 'fsadir:' + (await N.handleId(dir));
    qn.prefs.keepOriginal = true;
    await qn.exec('image.negative', 'all'); await wait(150);
    await qn.exec('file.save'); await wait(600);
    out.kept = { names: [...files.keys()], sameAsOriginal: files.has('nav-big (original).png') && files.get('nav-big (original).png').value.length === origBytes.length && files.get('nav-big (original).png').value.every((v, i) => v === origBytes[i]), savedChanged: self.value.length > 0 && !(self.value.length === origBytes.length && self.value.every((v, i) => v === origBytes[i])), inFolder: qn.folder.entries.some((e) => e.name === 'nav-big (original).png'), afterSave: pixel(200, 200) };
    // A second save keeps the first original.
    await qn.exec('image.negative', 'all'); await wait(150); await qn.exec('file.save'); await wait(600);
    out.kept.count = [...files.keys()].filter((n) => /original/.test(n)).length;
    await qn.exec('image.negative', 'all'); await wait(150);
    await qn.exec('adjust.revertOriginal'); await wait(600);
    out.revert = { pixel: pixel(200, 200), label: qn.tab.undoLabel, dirty: qn.tab.dirty };
    qn.prefs.keepOriginal = false;
    for (let i = 0; i < 80 && document.querySelector('.ql-dialog'); i++) await wait(50);
    return out;
  });
  check('filmstrip toggles the thumbnail strip', [vt1.strip, vt1.stripOff], [[true, 'strip'], false]);
  check('reset all adjustments returns to the opened pixels as one undoable step', [vt1.resetDisabled, vt1.reset.p1.join() !== vt1.reset.p0.join(), vt1.reset.p2, vt1.reset.label, vt1.reset.undone], [true, true, vt1.reset.p0, 'Reset All Adjustments', vt1.reset.p1]);
  check('keep the original on the first save over a file', [vt1.kept.names.includes('nav-big (original).png'), vt1.kept.sameAsOriginal, vt1.kept.savedChanged, vt1.kept.inFolder, vt1.kept.count], [true, true, true, true, 1]);
  check('revert to original restores the kept pixels', [vt1.revert.pixel, vt1.revert.label, vt1.revert.dirty], [[255, 255, 255], 'Revert to Original', true]);

  // Recognize Text (OCR) on rendered text, Find on the picture, Read QR Code from the app's own QR encoder.
  const external = []; const onReq = (r) => { const u = r.url(); if (!/^(http:\/\/localhost|blob:|data:)/.test(u)) external.push(u); };
  p.on('request', onReq);
  const ocr = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const top = () => [...document.querySelectorAll('.ql-dialog')].pop();
    const title = (d) => d?.querySelector('h2')?.textContent || '';
    const waitFor = async (pred, ms = 60000) => { for (let i = 0; i < ms / 100; i++) { const d = top(); if (d && pred(d)) return d; await wait(100); } throw new Error('dialog not found; top is ' + title(top())); };
    const noDialog = async () => { for (let i = 0; i < 80 && document.querySelector('.ql-dialog'); i++) await wait(50); };
    const field = (d, key) => d.querySelector(`[id^="f_${key}_"]`);
    await noDialog();
    const O = await window.__qnOcr(), T = await window.__qnTools();
    const c = document.createElement('canvas'); c.width = 900; c.height = 260; const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 900, 260); x.fillStyle = '#111'; x.font = 'bold 64px sans-serif'; x.fillText("ANNE'S LENS 1926", 40, 100); x.font = '44px serif'; x.fillText('Family records of Bath', 40, 190);
    const qr = T.qrRaster(T.encodeQr('https://example.org/annes-lens', 'M'), 8, 4);
    const q = document.createElement('canvas'); q.width = qr.width; q.height = qr.height; q.getContext('2d').putImageData(new ImageData(qr.data, qr.width, qr.height), 0, 0);
    const blob = (cv) => new Promise((r) => cv.toBlob(r, 'image/png'));
    qn.prefs.confirmClose = false;
    await qn.exec('file.openDropped', [new File([await blob(c)], 'o-text.png', { type: 'image/png' }), new File([await blob(q)], 'p-qr.png', { type: 'image/png' })]);
    for (let i = 0; i < 60 && qn.picture?.name !== 'o-text.png'; i++) await wait(50);
    await wait(200);
    const out = {};
    let run = qn.exec('tools.ocr'); let d = await waitFor((x) => title(x) === 'Recognize Text (OCR)');
    d.querySelector('.ql-primary').click();
    d = await waitFor((x) => title(x) === 'Recognized Text');
    out.text = field(d, 'text').value; out.help = d.textContent.match(/(\d+) words? in (\d+) lines?, (\d+)% confidence/)?.slice(1).map(Number);
    out.boxes = O.viewState.ocr.words.length; out.shown = O.viewState.ocr.show;
    const qf = field(d, 'q'); qf.value = '1926'; qf.dispatchEvent(new Event('input', { bubbles: true })); qf.dispatchEvent(new Event('change', { bubbles: true })); await wait(100);
    out.matches = O.viewState.ocr.words.filter((w) => O.ocrMatch(w.text, O.viewState.ocr.query)).map((w) => w.text);
    out.matchBox = O.viewState.ocr.words.find((w) => w.text === '1926')?.bbox;
    out.count = d.querySelector('.qn-ocr-count')?.textContent;
    d.querySelector('.ql-primary').click(); await run; await noDialog();
    out.clearedAfter = O.viewState.ocr.words.length;
    // Read Code on the QR picture.
    await qn.exec('view.next'); for (let i = 0; i < 60 && qn.picture?.name !== 'p-qr.png'; i++) await wait(50); await wait(200);
    run = qn.exec('tools.readCode'); d = await waitFor((x) => /^Codes? Found$/.test(title(x)));
    out.code = { text: d.textContent, outlines: O.viewState.codes.length, corner: O.viewState.codes[0]?.corners[0], hasOpen: [...d.querySelectorAll('button')].some((b) => /Open link/.test(b.textContent)) };
    d.querySelector('.ql-primary').click(); await run; await noDialog();
    out.codesAfter = O.viewState.codes.length;
    return out;
  });
  p.off('request', onReq);
  check('OCR recognized the rendered text', [/ANNE'S LENS 1926/.test(ocr.text), /Family records of Bath/.test(ocr.text), (ocr.help || [])[0] >= 6, (ocr.help || [])[2] >= 80, ocr.boxes >= 6, ocr.shown], [true, true, true, true, true, true]);
  check('OCR find highlights the word where it is', [ocr.matches, ocr.count, ocr.matchBox && ocr.matchBox.x0 > 400 && ocr.matchBox.x1 < 900 && ocr.matchBox.y0 > 40 && ocr.matchBox.y1 < 110, ocr.clearedAfter], [['1926'], '1 match', true, 0]);
  check('QR code read with its outline', [/QRCode/.test(ocr.code.text), /https:\/\/example\.org\/annes-lens/.test(ocr.code.text), ocr.code.outlines, ocr.code.corner, ocr.code.hasOpen, ocr.codesAfter], [true, true, 1, [32, 32], true, 0]);
  check('OCR and code reading made no requests off the machine', external, []);

  // Paint pane and Markup Board with real mouse input.
  const pz = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 80 && document.querySelector('.ql-dialog'); i++) await wait(50);
    const c = document.createElement('canvas'); c.width = 400; c.height = 300; const x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 200, 300); x.fillStyle = '#2050c0'; x.fillRect(200, 0, 200, 300);
    x.fillStyle = '#e02020'; x.beginPath(); x.arc(300, 150, 20, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#505050'; x.fillRect(60, 60, 40, 40);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    qn.prefs.confirmClose = false;
    await qn.exec('file.openDropped', [new File([blob], 'q-paint.png', { type: 'image/png' })]);
    for (let i = 0; i < 60 && qn.picture?.name !== 'q-paint.png'; i++) await wait(50);
    qn.viewer.setZoom(1); qn.viewer.center(); await wait(200);
    const r = qn.viewer.pictureRect(), b = qn.viewer.el.getBoundingClientRect();
    return { ox: b.left + r.x, oy: b.top + r.y, z: qn.viewer.zoom, folder: qn.folder.length };
  });
  const at = (x, y) => [pz.ox + (x + 0.5) * pz.z, pz.oy + (y + 0.5) * pz.z];
  const px = (x, y) => p.evaluate(([x, y]) => [...qn.picture.frameCanvas().getContext('2d').getImageData(x, y, 1, 1).data], [x, y]);
  const setPaint = (o) => p.evaluate(async (o) => { const P = await window.__qnPaint(); Object.assign(P.paint, o); P.paint.onChange(); }, o);
  const drag = async (a, b, steps = 12) => { await p.mouse.move(...at(...a)); await p.mouse.down(); await p.mouse.move(...at(...b), { steps }); await p.mouse.up(); await p.waitForTimeout(120); };
  const click = async (x, y) => { await p.mouse.click(...at(x, y)); await p.waitForTimeout(120); };
  const label = () => p.evaluate(() => qn.tab.undoLabel);
  // Brush.
  await p.evaluate(() => qn.exec('paint.brush'));
  await setPaint({ color: '#000000', size: 10, opacity: 100, hardness: 100 });
  await drag([20, 200], [180, 200]);
  const brush = { on: await px(100, 200), off: await px(100, 185), label: await label(), paneOpen: await p.evaluate(() => !!qn.viewer.el.querySelector('.qn-paintbar')) };
  await p.evaluate(() => qn.tab.undo()); await p.waitForTimeout(100);
  brush.undone = await px(100, 200);
  check('brush stroke painted, one undoable step', [brush.paneOpen, brush.on[0] < 30, brush.off, brush.label, brush.undone], [true, true, [255, 255, 255, 255], 'Brush', [255, 255, 255, 255]]);
  // Flood fill the white half.
  await p.evaluate(() => qn.exec('paint.fill')); await setPaint({ color: '#00ff00', tolerance: 16, contiguous: true });
  await click(30, 30);
  const fill = { inside: await px(30, 30), blue: await px(350, 30), gray: await px(80, 80), label: await label() };
  await p.evaluate(() => qn.tab.undo()); await p.waitForTimeout(100);
  check('flood fill stays in the clicked area', [fill.inside, fill.blue, fill.gray, fill.label], [[0, 255, 0, 255], [32, 80, 192, 255], [80, 80, 80, 255], 'Flood Fill']);
  // Color picker.
  await p.evaluate(() => qn.exec('paint.colorPicker')); await click(350, 30);
  const picked = await p.evaluate(async () => (await window.__qnPaint()).paint.color);
  check('color picker took the blue', picked, '#2050c0');
  // Red-eye brush across the red disc.
  await p.evaluate(() => qn.exec('paint.redEye')); await setPaint({ size: 60, hardness: 100 });
  await drag([300, 150], [302, 151], 3);
  const eye = await px(300, 150);
  check('red-eye neutralized the red', [eye[0] < 60, eye[1], eye[2], await label()], [true, 32, 32, 'Red-Eye Brush']);
  // Clone: Alt+click the gray square, then paint on the white area.
  await p.evaluate(() => qn.exec('paint.clone')); await setPaint({ size: 16, hardness: 100, opacity: 100, cloneSource: null, cloneOffset: null });
  await p.keyboard.down('Alt'); await click(80, 80); await p.keyboard.up('Alt');
  await drag([30, 250], [40, 250], 4);
  const cloned = await px(35, 250);
  check('clone copied the gray square', [cloned, await label()], [[80, 80, 80, 255], 'Clone Stamp']);
  // Rectangle outline.
  await p.evaluate(() => qn.exec('paint.rect')); await setPaint({ color: '#000000', size: 4, opacity: 100, fillShapes: false });
  await drag([140, 20], [190, 60]);
  const rect = { edge: await px(140, 40), inside: await px(165, 40), label: await label() };
  check('rectangle outline drawn, inside untouched', [rect.edge[0] < 40, rect.inside, rect.label], [true, [255, 255, 255, 255], 'Rectangle']);
  // Markup Board: an arrow, select and move it, Delete removes it (the file stays), Undo, steps, Flatten.
  await p.evaluate(() => qn.exec('edit.markup'));
  await p.evaluate(async () => { const P = await window.__qnPaint(); P.paint.markupTool = 'arrow'; P.paint.markupColor = '#e02020'; P.paint.markupWidth = 4; P.paint.onChange(); });
  const underStart = await p.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName}.${e.className} ${e.textContent?.slice(0, 40) || ''}` : null; }, at(40, 280));
  await drag([40, 280], [140, 230]);
  const mk = await p.evaluate(async () => { const P = await window.__qnPaint(); const it = P.markup.itemsOf(qn.picture); return { n: it.length, kind: it[0]?.kind, pts: it[0]?.pts.map((q) => q.map(Math.floor)) }; });
  const pixelNotChanged = await px(90, 255);
  await p.evaluate(async () => { const P = await window.__qnPaint(); P.paint.markupTool = 'select'; P.paint.onChange(); });
  await click(90, 255);
  const sel = await p.evaluate(async () => (await window.__qnPaint()).paint.selected);
  await drag([90, 255], [110, 255], 5);
  const moved = await p.evaluate(async () => (await window.__qnPaint()).markup.itemsOf(qn.picture)[0]?.pts.map((q) => q.map(Math.floor)));
  await p.keyboard.press('Delete'); await p.waitForTimeout(150);
  const afterDelete = await p.evaluate(async () => ({ items: (await window.__qnPaint()).markup.itemsOf(qn.picture).length, folder: qn.folder.length, name: qn.picture?.name, dialogs: document.querySelectorAll('.ql-dialog').length }));
  for (let i = 0; i < 20 && afterDelete.dialogs; i++) { await p.keyboard.press('Escape'); await p.waitForTimeout(100); afterDelete.dialogs = await p.evaluate(() => document.querySelectorAll('.ql-dialog').length); }
  check('markup arrow created over the picture, not in it', [mk.n, mk.kind, mk.pts, pixelNotChanged], [1, 'arrow', [[40, 280], [140, 230]], [255, 255, 255, 255]], 'under the start point: ' + underStart);
  check('markup select, move and Delete (the file is not deleted)', [sel > 0, moved, afterDelete.items, afterDelete.folder, afterDelete.name, afterDelete.dialogs], [true, [[60, 280], [160, 230]], 0, pz.folder, 'q-paint.png', 0]);
  await p.evaluate(async () => { const P = await window.__qnPaint(); P.markup.undoMarkup(qn.picture); P.paint.markupTool = 'step'; P.paint.markupColor = '#e02020'; P.paint.onChange(); });
  await click(250, 250); await click(330, 250);
  const steps = await p.evaluate(async () => (await window.__qnPaint()).markup.itemsOf(qn.picture).filter((i) => i.kind === 'step').map((i) => i.n));
  const beforeFlat = await px(260, 250);
  await p.evaluate(() => qn.exec('edit.flattenMarkup')); await p.waitForTimeout(200);
  const flat = { px: await px(260, 250), items: await p.evaluate(async () => (await window.__qnPaint()).markup.itemsOf(qn.picture).length), label: await label() };
  await p.evaluate(() => qn.exec('edit.markup')); await p.waitForTimeout(100);
  const closed = await p.evaluate(async () => ({ open: (await window.__qnPaint()).paint.open, pane: !!qn.viewer.el.querySelector('.qn-paintbar') }));
  check('numbered steps count up and Flatten draws the markup in', [steps, beforeFlat[0] < 100 && beforeFlat[2] > 150, flat.px[0] > 180 && flat.px[1] < 80, flat.items, flat.label], [[1, 2], true, true, 0, 'Flatten Markup']);
  check('closing the pane hands the mouse back', [closed.open, closed.pane], [false, false]);

  // Before/After Slider, Compare Pictures and Synchronize Windows, with real mouse input.
  const sp = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 80 && document.querySelector('.ql-dialog'); i++) await wait(50);
    const mk = (w, h, color) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h); return new Promise((r) => c.toBlob(r, 'image/png')); };
    qn.prefs.confirmClose = false;
    await qn.exec('file.openDropped', [new File([await mk(300, 200, '#ffffff')], 'r-split.png', { type: 'image/png' }), new File([await mk(300, 200, '#00c000')], 'r-zz.png', { type: 'image/png' })]);
    for (let i = 0; i < 60 && qn.picture?.name !== 'r-split.png'; i++) await wait(50);
    qn.viewer.setZoom(1); qn.viewer.center(); await wait(150);
    await qn.exec('image.negative', 'all'); await wait(150);
    await qn.exec('view.compareSplit'); await wait(300);
    const C = await window.__qnCompare();
    const canvas = qn.viewer.el.querySelector('canvas.qn-canvas'), dpr = canvas.width / qn.viewer.el.clientWidth;
    const r = qn.viewer.pictureRect(), b = qn.viewer.el.getBoundingClientRect();
    const sample = (x, y) => [...canvas.getContext('2d').getImageData(Math.round((r.x + x) * dpr), Math.round((r.y + y) * dpr), 1, 1).data].slice(0, 3);
    return { on: C.split.on, label: C.split.labelA, left: sample(50, 100), right: sample(250, 100), handle: [b.left + r.x + 150, b.top + r.y + 100], to: [b.left + r.x + 30, b.top + r.y + 100], dpr };
  });
  check('slider shows the picture as opened left of the divider', [sp.on, sp.label, sp.left, sp.right], [true, 'As opened', [255, 255, 255], [0, 0, 0]]);
  await p.mouse.move(...sp.handle); await p.mouse.down(); await p.mouse.move(...sp.to, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(150);
  const sp2 = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const C = await window.__qnCompare();
    const canvas = qn.viewer.el.querySelector('canvas.qn-canvas'), dpr = canvas.width / qn.viewer.el.clientWidth, r = qn.viewer.pictureRect();
    const out = { x: C.split.x, at50: [...canvas.getContext('2d').getImageData(Math.round((r.x + 50) * dpr), Math.round((r.y + 100) * dpr), 1, 1).data].slice(0, 3), sel: qn.tab.selection };
    await qn.exec('view.next'); for (let i = 0; i < 60 && qn.picture?.name !== 'r-zz.png'; i++) await wait(50); await wait(150);
    out.offAfterNav = !C.split.on;
    return out;
  });
  check('dragging the divider moves it (no selection drawn); a new picture turns the slider off', [Math.abs(sp2.x - 0.1) < 0.02, sp2.at50, sp2.sel, sp2.offAfterNav], [true, [0, 0, 0], null, true]);
  // Compare three marked pictures.
  const cmp = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const mk = (w, h, color) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h); x.fillStyle = '#000'; x.fillRect(w / 2 - 2, 0, 4, h); return new Promise((r) => c.toBlob(r, 'image/png')); };
    await qn.exec('file.openDropped', [new File([await mk(400, 300, '#e00000')], 's-red.png', { type: 'image/png' }), new File([await mk(400, 300, '#00b000')], 't-green.png', { type: 'image/png' }), new File([await mk(400, 300, '#0000e0')], 'u-blue.png', { type: 'image/png' })]);
    for (let i = 0; i < 60 && qn.picture?.name !== 's-red.png'; i++) await wait(50); await wait(200);
    for (const e of qn.folder.entries) qn.tab.marked.add(e);
    await qn.exec('view.compare'); await wait(400);
    const C = await window.__qnCompare(), cv = C.compareOpen();
    const panes = [...qn.viewer.el.querySelectorAll('.qn-cmp-pane')];
    const color = (pane) => { const c = pane.querySelector('canvas'); const d = c.getContext('2d').getImageData(Math.round(c.width * 0.25), Math.round(c.height / 2), 1, 1).data; return [d[0], d[1], d[2]]; };
    const box = (pane) => { const r = pane.querySelector('canvas').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width, r.height]; };
    return { open: !!cv, n: panes.length, labels: panes.map((x) => x.querySelector('.qn-cmp-label').textContent.split(' · ')[0]), colors: panes.map(color), boxes: panes.map(box) };
  });
  check('compare opens three panes with their pictures', [cmp.open, cmp.n, cmp.labels, cmp.colors.map((c) => c.indexOf(Math.max(...c)))], [true, 3, ['s-red.png', 't-green.png', 'u-blue.png'], [0, 1, 2]]);
  if (cmp.boxes.length === 3) {
    await p.mouse.move(cmp.boxes[1][0], cmp.boxes[1][1]); for (let i = 0; i < 4; i++) { await p.mouse.wheel(0, -100); await p.waitForTimeout(40); } await p.waitForTimeout(120);
    await p.mouse.move(cmp.boxes[0][0], cmp.boxes[0][1]); await p.mouse.down(); await p.mouse.move(cmp.boxes[0][0] + 60, cmp.boxes[0][1], { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(150);
  }
  const cmp2 = await p.evaluate(async () => {
    const C = await window.__qnCompare(), cv = C.compareOpen();
    const zooms = [...qn.viewer.el.querySelectorAll('.qn-cmp-label')].map((l) => l.textContent.split(' · ')[2]);
    const st = cv ? { ...cv.state } : null;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 100));
    return { st, zooms, closed: !C.compareOpen() && !qn.viewer.el.querySelector('.qn-compare') };
  });
  check('compare: wheel zooms and a drag pans every pane together; Esc closes', [cmp2.st && cmp2.st.rel > 1.5, cmp2.st && cmp2.st.nx < 0.5, new Set(cmp2.zooms).size, cmp2.closed], [true, true, 1, true]);
  // Synchronize two windows.
  const sw = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const mk = (w, h, color) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h); return new Promise((r) => c.toBlob(r, 'image/png')); };
    qn.tab.marked.clear();
    await qn.exec('file.openDropped', [new File([await mk(800, 600, '#aa0000')], 'v1.png', { type: 'image/png' }), new File([await mk(800, 600, '#aa5500')], 'v2.png', { type: 'image/png' }), new File([await mk(800, 600, '#aaaa00')], 'v3.png', { type: 'image/png' })]);
    for (let i = 0; i < 60 && qn.picture?.name !== 'v1.png'; i++) await wait(50);
    const A = qn.tab; // the window that received v1–v3 (a window with unsaved edits makes the drop open a new one)
    for (const t of [...qn.tabs]) if (t !== A) qn.closeTab(t);
    qn.activate(A);
    let B = qn.createTab(); qn.activate(B);
    await qn.exec('file.openDropped', [new File([await mk(400, 300, '#0000aa')], 'w1.png', { type: 'image/png' }), new File([await mk(400, 300, '#0055aa')], 'w2.png', { type: 'image/png' }), new File([await mk(400, 300, '#00aaaa')], 'w3.png', { type: 'image/png' })]);
    for (let i = 0; i < 60 && qn.picture?.name !== 'w1.png'; i++) await wait(50);
    B = qn.tab;
    for (const t of [...qn.tabs]) if (t !== A && t !== B) qn.closeTab(t);
    qn.activate(A); await wait(150);
    await qn.exec('view.syncWindows'); await wait(300);
    const out = { tiled: qn.ui.workspace.classList.contains('qn-tiled'), hidden: qn.tabs.map((t) => t.el.classList.contains('ql-hidden-tab')), activeFramed: A.el.classList.contains('qn-window-active') };
    await qn.exec('view.next'); for (let i = 0; i < 60 && !(A.picture?.name === 'v2.png' && B.picture?.name === 'w2.png'); i++) await wait(50);
    out.afterNext = [A.picture?.name, B.picture?.name];
    A.ui.setZoom(A.ui.zoom * 2); await wait(250);
    out.rel = [A.ui.viewRel().rel, B.ui.viewRel().rel].map((v) => +v.toFixed(3));
    const bb = B.ui.el.getBoundingClientRect(); out.clickB = [bb.left + bb.width / 2, bb.top + bb.height / 2];
    return out;
  });
  await p.mouse.click(...sw.clickB); await p.waitForTimeout(150);
  const sw2 = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const B = qn.tabs[qn.tabs.length - 1];
    const out = { bActive: qn.tab === B };
    await qn.exec('view.syncWindows'); await wait(150);
    out.untiled = !qn.ui.workspace.classList.contains('qn-tiled'); out.hiddenAfter = qn.tabs.filter((t) => t.el.classList.contains('ql-hidden-tab')).length;
    qn.closeTab(B); await wait(150);
    out.tabs = qn.tabs.length;
    return out;
  });
  check('synchronize windows: side by side, next steps both, zoom follows', [sw.tiled, sw.hidden, sw.activeFramed, sw.afterNext, sw.rel[0] === sw.rel[1]], [true, [false, false], true, ['v2.png', 'w2.png'], true]);
  check('a click makes the other window the one followed; turning sync off hides it again', [sw2.bActive, sw2.untiled, sw2.hiddenAfter, sw2.tabs], [true, true, 1, 1]);

  // Special views: Stereo (a real two-JPEG MPO), 360° (mouse drag), Two-Page with right-to-left
  // reading (keyboard), and a motion photo (a JPEG with a VP9 clip appended): play, pause, frame.
  const vp9 = readFileSync('tests/fixtures/media/blue-vp9.mp4').toString('base64');
  const stv = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 80 && document.querySelector('.ql-dialog'); i++) await wait(50);
    const eye = (x0) => { const c = document.createElement('canvas'); c.width = 300; c.height = 200; const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 300, 200); x.fillStyle = '#fff'; x.fillRect(x0, 50, 50, 100); return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.97)); };
    const L = new Uint8Array(await (await eye(100)).arrayBuffer()), R = new Uint8Array(await (await eye(120)).arrayBuffer());
    const mpo = new Uint8Array(L.length + R.length); mpo.set(L); mpo.set(R, L.length);
    const bands = document.createElement('canvas'); bands.width = 400; bands.height = 200; const bx = bands.getContext('2d'); ['#ff0000', '#00ff00', '#0000ff', '#ffff00'].forEach((c, i) => { bx.fillStyle = c; bx.fillRect(i * 100, 0, 100, 200); });
    qn.prefs.confirmClose = false;
    await qn.exec('file.openDropped', [new File([mpo], 'x-pair.jpg', { type: 'image/jpeg' }), new File([await new Promise((r) => bands.toBlob(r, 'image/png'))], 'x-sphere.png', { type: 'image/png' })]);
    for (let i = 0; i < 60 && qn.picture?.name !== 'x-pair.jpg'; i++) await wait(50); await wait(200);
    const S = await window.__qnSpecial();
    await qn.exec('view.stereo', 'gray'); await wait(300);
    const sv = S.specialOpen(), comp = sv.stereo.composite, at = (x, y) => [...comp.data.subarray((y * comp.width + x) * 4, (y * comp.width + x) * 4 + 3)];
    const out = { how: sv.el.querySelector('b').textContent, size: [comp.width, comp.height], leftOnly: at(110, 100), both: at(135, 100), rightOnly: at(160, 100), none: at(250, 100) };
    const sel = sv.el.querySelector('select'); sel.value = 'crossEye'; sel.dispatchEvent(new Event('change')); await wait(100);
    out.cross = [sv.stereo.composite.width, sv.stereo.composite.height];
    sv.close();
    // 360°: yaw 45° faces the blue band; then a drag turns the view.
    await qn.exec('view.next'); for (let i = 0; i < 60 && qn.picture?.name !== 'x-sphere.png'; i++) await wait(50); await wait(150);
    await qn.exec('view.sphere'); await wait(200);
    const sp = S.specialOpen(); sp.look = { yaw: 45, pitch: 0, fov: 40 }; sp.paint();
    const cv = sp.canvas, d = cv.getContext('2d').getImageData(Math.floor(cv.width / 2), Math.floor(cv.height / 2), 1, 1).data;
    out.sphere = { kind: sp.kind, center: [d[0], d[1], d[2]] };
    const r = cv.getBoundingClientRect(); out.drag = [r.left + r.width / 2, r.top + r.height / 2]; out.yaw0 = sp.look.yaw; out.vw = cv.clientWidth; out.fov = sp.look.fov;
    return out;
  });
  check('stereo: an MPO pair as a gray anaglyph', [stv.how, stv.size, stv.leftOnly[0] > 200 && stv.leftOnly[1] < 60, stv.both.every((v) => v > 200), stv.rightOnly[0] < 60 && stv.rightOnly[2] > 200, stv.none.every((v) => v < 40), stv.cross], ['Stereo View · MPO pair', [300, 200], true, true, true, true, [600, 200]]);
  check('360° view faces the band at its yaw', [stv.sphere.kind, stv.sphere.center], ['sphere', [0, 0, 255]]);
  await p.mouse.move(...stv.drag); await p.mouse.down(); await p.mouse.move(stv.drag[0] - 120, stv.drag[1], { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(100);
  const sph2 = await p.evaluate(async () => { const S = await window.__qnSpecial(); const sv = S.specialOpen(); const yaw = sv.look.yaw; await qn.exec('view.previous'); await new Promise((r) => setTimeout(r, 300)); return { yaw, closedOnNav: !S.specialOpen() }; });
  check('360° drag turns the view by the dragged share of the field of view; a new picture closes it', [Math.abs(sph2.yaw - (stv.yaw0 + 120 * stv.fov / stv.vw)) < 0.5, sph2.closedOnNav], [true, true], `yaw ${sph2.yaw}, expected ${stv.yaw0 + 120 * stv.fov / stv.vw}`);
  // Two-page view over four pictures.
  await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const mk = (c) => { const cv = document.createElement('canvas'); cv.width = 200; cv.height = 300; const x = cv.getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, 200, 300); return new Promise((r) => cv.toBlob(r, 'image/png')); };
    const files = []; for (const [i, c] of ['#ff0000', '#00ff00', '#0000ff', '#ffff00'].entries()) files.push(new File([await mk(c)], `y${i + 1}.png`, { type: 'image/png' }));
    await qn.exec('file.openDropped', files); for (let i = 0; i < 60 && qn.picture?.name !== 'y1.png'; i++) await wait(50); await wait(150);
    await qn.exec('view.twoPage'); await wait(300);
  });
  const spread = () => p.evaluate(async () => { const S = await window.__qnSpecial(); const sv = S.specialOpen(); const c = sv.image, x = c.getContext('2d'); const at = (f) => [...x.getImageData(Math.floor(c.width * f), Math.floor(c.height / 2), 1, 1).data].slice(0, 3); return { w: c.width, h: c.height, left: at(0.25), right: at(0.75), info: sv.el.querySelector('.ql-help').textContent }; });
  const sp0 = await spread();
  await p.keyboard.press('ArrowRight'); await p.waitForTimeout(250);
  const spA = await spread();
  await p.evaluate(() => qn.exec('view.rtl')); await p.waitForTimeout(250);
  const spB = await spread();
  await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(250);
  const spC = await spread();
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  const spEnd = await p.evaluate(async () => { const S = await window.__qnSpecial(); const out = { closed: !S.specialOpen(), current: qn.picture?.name }; if (S.reading.rtl) await qn.exec('view.rtl'); return out; });
  check('two-page view: the cover alone, then facing pages', [sp0.w, sp0.left, spA.w, spA.left, spA.right, spA.info], [200, [255, 0, 0], 400, [0, 255, 0], [0, 0, 255], '2–3 of 4']);
  check('right-to-left reading swaps the pages and the arrow keys', [spB.left, spB.right, /right to left/.test(spB.info), spC.w, spC.left, spEnd.closed, spEnd.current], [[0, 0, 255], [0, 255, 0], true, 200, [255, 255, 0], true, 'y4.png']);
  // Motion photo.
  const mov = await p.evaluate(async (vp9) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const c = document.createElement('canvas'); c.width = 256; c.height = 144; const x = c.getContext('2d'); x.fillStyle = '#d02020'; x.fillRect(0, 0, 256, 144);
    const jpg = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer());
    const clip = Uint8Array.from(atob(vp9), (ch) => ch.charCodeAt(0));
    const both = new Uint8Array(jpg.length + clip.length); both.set(jpg); both.set(clip, jpg.length);
    await qn.exec('file.openDropped', [new File([both], 'z-motion.jpg', { type: 'image/jpeg' })]);
    for (let i = 0; i < 60 && qn.picture?.name !== 'z-motion.jpg'; i++) await wait(50); await wait(150);
    const S = await window.__qnSpecial();
    const out = { enabled: window.__qnGetCommand('view.motionPhoto').isEnabled(qn), clipLen: S.clipOf(qn.picture)?.length, expected: clip.length };
    await qn.exec('view.motionPhoto'); await wait(100);
    const v = S.specialOpen()?.video;
    out.loaded = await new Promise((r) => { if (!v) return r('no video'); if (v.readyState >= 2) return r('loaded'); v.onloadeddata = () => r('loaded'); v.onerror = () => r('error'); setTimeout(() => r('timeout'), 8000); });
    out.size = v ? [v.videoWidth, v.videoHeight] : null;
    await wait(300);
    await qn.exec('view.mediaPlay'); await wait(100); out.pausedAfterToggle = v.paused;
    await qn.exec('view.mediaPlay'); await wait(200); out.playingAgain = !v.paused;
    const tabs0 = qn.tabs.length;
    await qn.exec('view.mediaFrame'); for (let i = 0; i < 80 && qn.tabs.length === tabs0; i++) await wait(50); await wait(300);
    out.frame = { name: qn.picture?.name, size: [qn.picture?.width, qn.picture?.height], px: qn.picture ? [...qn.picture.frameCanvas().getContext('2d').getImageData(128, 72, 1, 1).data].slice(0, 3) : null };
    if (qn.tabs.length > tabs0) qn.closeTab(qn.tab);
    await wait(150); S.specialOpen()?.close();
    return out;
  }, vp9);
  check('motion photo: the appended clip found and played', [mov.enabled, mov.clipLen, mov.loaded, mov.size, mov.pausedAfterToggle, mov.playingAgain], [true, mov.expected, 'loaded', [256, 144], true, true]);
  check('save current frame opens the clip frame as a picture', [/^z-motion \(frame [\d.]+ s\)\.png$/.test(mov.frame.name || ''), mov.frame.size, mov.frame.px && mov.frame.px[2] > 200 && mov.frame.px[0] < 40], [true, [256, 144], true]);

  // Next / Previous Folder through a File System Access tree (a folder of folders: Open Folder shows
  // the first one with pictures), with the keyboard; Full Screen on Another Display on a stubbed
  // two-screen Window Management API.
  const fnav = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 80 && document.querySelector('.ql-dialog'); i++) await wait(50);
    const seen = []; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('ql-toast')) seen.push(n.textContent); }).observe(document.body, { childList: true, subtree: true });
    const png = async (color) => { const c = document.createElement('canvas'); c.width = 8; c.height = 8; const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, 8, 8); return new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/png'))).arrayBuffer()); };
    const file = (name, bytes) => { const f = { kind: 'file', name, isSameEntry: async (o) => o === f, getFile: async () => new File([bytes], name, { type: 'image/png' }) }; return f; };
    const dir = (name, kids) => { const d = { kind: 'directory', name, isSameEntry: async (o) => o === d, entries: async function* () { for (const k of kids) yield [k.name, k]; } }; return d; };
    const root = dir('Family', [file('notes.txt', new Uint8Array([1])), dir('2019 Reunion', [file('a.png', await png('#ff0000')), dir('extras', [file('b.png', await png('#00ff00'))])]), dir('.hidden', [file('h.png', await png('#ffffff'))]), dir('2020 Wedding', [file('c.png', await png('#0000ff')), file('d.png', await png('#0000ff'))]), dir('Empty', [])]);
    window.showDirectoryPicker = async () => root;
    const where = () => ({ folder: qn.folder.name, n: qn.folder.length, pic: qn.picture?.name });
    const settle = async (name) => { for (let i = 0; i < 60 && qn.folder.name !== name; i++) await wait(50); await wait(250); };
    const out = {};
    await qn.exec('file.openFolder'); await settle('2019 Reunion'); out.opened = where();
    out.enabled = window.__qnGetCommand('view.nextFolder').isEnabled(qn);
    return out;
  });
  check('open folder of folders shows the first with pictures', [fnav.opened, fnav.enabled], [{ folder: '2019 Reunion', n: 1, pic: 'a.png' }, true]);
  const fsteps = [];
  for (const key of ['Control+ArrowRight', 'Control+ArrowRight', 'Control+ArrowRight', 'Control+ArrowLeft', 'Control+ArrowLeft']) {
    await p.keyboard.press(key); await p.waitForTimeout(700);
    fsteps.push(await p.evaluate(() => `${qn.folder.name}:${qn.folder.length}:${qn.picture?.name}`));
  }
  check('next / previous folder walk the tree (subfolders first, hidden and empty skipped)', fsteps, ['extras:1:b.png', '2020 Wedding:2:c.png', '2020 Wedding:2:c.png', 'extras:1:b.png', '2019 Reunion:1:a.png']);
  const fsd = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const seen = []; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('ql-toast')) seen.push(n.textContent); }).observe(document.body, { childList: true, subtree: true });
    const screens = [{ label: 'Built-in', width: 1920, height: 1080, isPrimary: true }, { label: 'Projector', width: 1280, height: 720, isPrimary: false }];
    let count = 2;
    window.getScreenDetails = async () => ({ screens: screens.slice(0, count), currentScreen: screens[0] });
    const asked = []; const orig = document.documentElement.requestFullscreen; document.documentElement.requestFullscreen = function (o) { asked.push(o); return Promise.resolve(); };
    const out = { enabled: window.__qnGetCommand('view.fullScreenDisplay').isEnabled(qn), framelessEnabled: window.__qnGetCommand('view.frameless').isEnabled(qn) };
    // The dialog lists both displays and preselects the one the window is not on.
    const run = qn.exec('view.fullScreenDisplay'); let d; for (let i = 0; i < 60 && !(d = document.querySelector('.ql-dialog .ql-primary')); i++) await wait(50);
    const dlg = document.querySelector('.ql-dialog'); out.labels = [...dlg.querySelectorAll('label')].map((l) => l.textContent.trim()).filter((t) => /Built-in|Projector/.test(t));
    out.preselected = dlg.querySelector('input[type=radio]:checked')?.value; d.click(); await run; await wait(100);
    out.screen = asked[0]?.screen?.label; out.fullscreen = document.body.classList.contains('ql-fullscreen');
    await qn.exec('view.fullScreen'); await wait(100); out.after = document.body.classList.contains('ql-fullscreen');
    count = 1; await qn.exec('view.fullScreenDisplay'); await wait(150); out.single = seen.find((t) => /Only one display/.test(t)) || null; out.calls = asked.length;
    document.documentElement.requestFullscreen = orig;
    for (let i = 0; i < 80 && document.querySelector('.ql-dialog'); i++) await wait(50);
    return out;
  });
  check('full screen on another display uses the chosen screen', [fsd.enabled, fsd.framelessEnabled, fsd.labels.length, fsd.preselected, fsd.screen, fsd.fullscreen, fsd.after, fsd.single, fsd.calls], [true, false, 2, '1', 'Projector', true, false, 'Only one display is connected.', 1], JSON.stringify(fsd));

  // Color management: a PNG and a JPEG tagged with the Adobe RGB-compatible profile decode to their
  // own values and display through the profile (LittleCMS: (180, 60, 60) shows as (208, 57, 57));
  // the toggle, soft proof (gray, a CMYK press with the gamut warning), Convert and Assign, and a
  // save that carries the new profile and looks the same after reopening.
  const cref = JSON.parse(readFileSync('tests/fixtures/color/lcms-reference.json', 'utf8'));
  const cfx = ['tagged-adobergb.png', 'tagged-adobergb.jpg', 'press-cmyk.icc'].map((f) => readFileSync('tests/fixtures/color/' + f).toString('base64'));
  const cm = await p.evaluate(async ([png64, jpg64, press64]) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const b64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
    for (let i = 0; i < 80 && document.querySelector('.ql-dialog'); i++) await wait(50);
    const C = await window.__qnColor(), N = await window.__qnNative();
    const seen = []; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('ql-toast')) seen.push(n.textContent); }).observe(document.body, { childList: true, subtree: true });
    const raw = (fx) => [...qn.picture.frameCanvas().getContext('2d').getImageData(Math.floor(qn.picture.width * fx), 24, 1, 1).data].slice(0, 3);
    const shown = (fx) => { const v = qn.viewer, r = v.pictureRect(), dpr = window.devicePixelRatio || 1; return [...v.canvas.getContext('2d').getImageData(Math.round((r.x + r.w * fx) * dpr), Math.round((r.y + r.h / 2) * dpr), 1, 1).data].slice(0, 3); };
    const both = () => ({ raw: [raw(0.25), raw(0.75)], shown: [shown(0.25), shown(0.75)] });
    const redraw = async () => { qn.tab.ui.draw(); await wait(120); };
    const pngBytes = b64(png64), jpgBytes = b64(jpg64);
    await qn.exec('file.openDropped', [new File([pngBytes], 'cm-adobe.png', { type: 'image/png' }), new File([jpgBytes], 'cm-adobe.jpg', { type: 'image/jpeg' })]);
    for (let i = 0; i < 60 && qn.picture?.name !== 'cm-adobe.png'; i++) await wait(50); await wait(250); await redraw();
    const out = { png: { ...both(), note: qn.picture.current.notes.find((n) => /color profile/.test(n)) } };
    await qn.exec('view.colorManaged'); await redraw(); out.unmanaged = both().shown; await qn.exec('view.colorManaged'); await redraw(); out.managedAgain = both().shown;
    // The platform's own default decode converts to sRGB (what the app used to show).
    const bmp = await createImageBitmap(new Blob([jpgBytes], { type: 'image/jpeg' })); const c0 = document.createElement('canvas'); c0.width = bmp.width; c0.height = bmp.height; c0.getContext('2d').drawImage(bmp, 0, 0);
    out.platformDefault = [...c0.getContext('2d').getImageData(16, 24, 1, 1).data].slice(0, 3);
    const goto = async (name) => { const i = qn.folder.entries.findIndex((e) => e.name === name); if (i >= 0 && qn.folder.select(i)) await qn.tab.show(); for (let k = 0; k < 60 && qn.picture?.name !== name; k++) await wait(50); await wait(250); await redraw(); };
    await goto('cm-adobe.jpg');
    out.jpg = { ...both(), tagged: !!qn.picture.current.icc };
    await goto('cm-adobe.png'); out.backOnPng = qn.picture.name;
    // Soft proof: gray, then the CMYK press with the gamut warning; both leave the values alone.
    await qn.exec('image.softProof', { profile: 'S:gray22' }); await redraw(); out.proofGray = both(); out.proofActive = window.__qnGetCommand('image.softProof').isActive(qn);
    await qn.exec('image.softProof'); await redraw(); out.proofOff = both().shown;
    const press = await C.loadProfileFile([new File([b64(press64)], 'press.icc')]);
    await qn.exec('image.softProof', { profile: 'L:' + C.loadedProfiles.indexOf(press), gamutWarning: true }); await redraw(); out.proofPress = both().shown;
    await qn.exec('image.softProof', { profile: 'L:' + C.loadedProfiles.indexOf(press), gamutWarning: false }); await redraw(); out.proofPressPlain = both().shown;
    await qn.exec('image.softProof'); await redraw();
    // Convert keeps the look and changes the values; Assign keeps the values and changes the look.
    await qn.exec('image.convertProfile', { to: 'S:srgb' }); await redraw(); out.toSrgb = { ...both(), name: C.profileName(qn.picture.current.icc), label: qn.tab.undoLabel };
    qn.tab.undo(); await redraw(); out.undone = { ...both(), name: C.profileName(qn.picture.current.icc) };
    await qn.exec('image.assignProfile', 'S:srgb'); await redraw(); out.assigned = both(); qn.tab.undo(); await redraw();
    await qn.exec('image.convertProfile', { to: 'L:' + C.loadedProfiles.indexOf(press) }); out.refusedCmyk = seen.some((t) => /pictures can be in RGB or gray profiles only/.test(t)) && C.profileName(qn.picture.current.icc) === 'Adobe RGB (1998) compatible';
    await qn.exec('image.convertProfile', { to: 'S:gray22' }); await redraw(); out.gray = both(); qn.tab.undo(); await redraw();
    // Convert to Display P3 and save through a writable handle; the file reopens tagged and looks the same.
    await qn.exec('image.convertProfile', { to: 'S:p3' }); await redraw(); const p3 = both();
    const saved = { value: null }; const fh = { kind: 'file', name: 'cm-adobe.png', isSameEntry: async (o) => o === undefined, getFile: async () => new File([saved.value || pngBytes], 'cm-adobe.png', { type: 'image/png' }), createWritable: async () => { const parts = []; return { write: async (b) => { parts.push(b); }, close: async () => { saved.value = new Uint8Array(await new Blob(parts).arrayBuffer()); } }; } };
    qn.picture.entry.uri = 'fsa:' + (await N.handleId(fh)); qn.prefs.keepOriginal = false;
    await qn.exec('file.save'); for (let i = 0; i < 60 && !saved.value; i++) await wait(50); await wait(500); await redraw();
    const embedded = saved.value && (await C.pngIcc(saved.value));
    out.saved = { p3, embedded: embedded && C.profileName(embedded), reopened: { ...both(), name: C.profileName(qn.picture.current.icc), dirty: qn.tab.dirty } };
    for (let i = 0; i < 80 && document.querySelector('.ql-dialog'); i++) await wait(50);
    out.toasts = seen;
    return out;
  }, cfx);
  const near = (a, b, t = 2) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= t);
  const [adobeRed, adobeGreen] = cref.tagged['adobergb>srgb'];
  check('color: a tagged PNG keeps its values and displays through its profile', [near(cm.png.raw[0], [180, 60, 60], 1) && near(cm.png.raw[1], [0, 200, 0], 1), near(cm.png.shown[0], adobeRed), near(cm.png.shown[1], adobeGreen), cm.png.note], [true, true, true, 'color profile: Adobe RGB (1998) compatible'], JSON.stringify(cm.png.shown));
  check('color: Color-Managed Display off shows the raw values, on again the managed ones', [near(cm.unmanaged[0], [180, 60, 60], 1) && near(cm.unmanaged[1], [0, 200, 0], 1), near(cm.managedAgain[0], adobeRed)], [true, true], JSON.stringify(cm.unmanaged));
  check('color: the platform converts by default (why the app decodes tagged files itself)', near(cm.platformDefault, adobeRed, 3), true, JSON.stringify(cm.platformDefault));
  check('color: a tagged JPEG (APP2) too', [cm.backOnPng === 'cm-adobe.png', cm.jpg.tagged, near(cm.jpg.raw[0], [180, 60, 60], 2), near(cm.jpg.shown[0], adobeRed, 3)], [true, true, true, true], JSON.stringify(cm.jpg));
  const g = cm.proofGray.shown[0];
  check('color: soft proof on gray shows neutral tones and leaves the values', [cm.proofActive, g[0] === g[1] && g[1] === g[2], Math.abs(g[0] - cref.tagged['adobergb>gray22'][0][0]) <= 3, near(cm.proofGray.raw[0], [180, 60, 60], 1), near(cm.proofOff[0], adobeRed)], [true, true, true, true, true], JSON.stringify(cm.proofGray));
  check('color: press proof marks the out-of-gamut green in magenta; without the warning it prints duller', [cm.proofPress[1], cm.proofPressPlain[1][0] - adobeGreen[0] > 30 && cm.proofPressPlain[1][2] - adobeGreen[2] > 30], [[255, 0, 255], true], JSON.stringify([cm.proofPress, cm.proofPressPlain]));
  check('color: Convert to sRGB changes the values, keeps the look, and undoes', [near(cm.toSrgb.raw[0], adobeRed, 1), near(cm.toSrgb.shown[0], adobeRed), cm.toSrgb.name, cm.toSrgb.label, near(cm.undone.raw[0], [180, 60, 60], 1), cm.undone.name], [true, true, 'sRGB IEC61966-2.1', 'Convert to sRGB IEC61966-2.1', true, 'Adobe RGB (1998) compatible'], JSON.stringify(cm.toSrgb));
  check('color: Assign sRGB keeps the values and changes the look', [near(cm.assigned.raw[0], [180, 60, 60], 1), near(cm.assigned.shown[0], cm.assigned.raw[0], 1)], [true, true], JSON.stringify(cm.assigned));
  check('color: a CMYK profile is refused for the pixels', cm.refusedCmyk, true);
  check('color: Convert to gray makes neutral values', [cm.gray.raw[0][0] === cm.gray.raw[0][1] && cm.gray.raw[0][1] === cm.gray.raw[0][2], Math.abs(cm.gray.raw[0][0] - cref.tagged['adobergb>gray22'][0][0]) <= 1], [true, true], JSON.stringify(cm.gray));
  check('color: Convert to P3 and save; the file carries the profile and looks the same reopened', [cm.saved.embedded, cm.saved.reopened.name, near(cm.saved.reopened.raw[0], cm.saved.p3.raw[0], 1) && near(cm.saved.reopened.raw[1], cm.saved.p3.raw[1], 1), near(cm.saved.reopened.shown[0], adobeRed), cm.saved.reopened.dirty], ['Display P3', 'Display P3', true, true, false], JSON.stringify(cm.saved));
  if (cm.toasts.some((t) => /Not converted|failed/i.test(t))) failures.push('color toasts: ' + cm.toasts.join(' | '));

  // AI tab: a mock OpenAI-compatible service (text, vision, generation, masked edits) and the on-device
  // runtime (ONNX Runtime Web, WebAssembly) with tiny fixture models shaped like the real ones.
  const ai = await p.evaluate(async (AI_PORT) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const noDialog = async () => { for (let i = 0; i < 60 && document.querySelector('.ql-dialog'); i++) await wait(50); };
    const dialog = async () => { for (let i = 0; i < 100; i++) { const d = [...document.querySelectorAll('.ql-dialog')].pop(); if (d && d.querySelector('.ql-primary')) return d; await wait(50); } throw new Error('no dialog; toasts: ' + seen.join(' | ') + '; tab ' + (qn.picture && qn.picture.name) + ' tabs ' + qn.tabs.length); };
    const field = (d, key) => d.querySelector(`[id^="f_${key}_"]`);
    const setField = (d, key, value) => { const f = field(d, key); if (!f) throw new Error('no field ' + key); if (f.type === 'checkbox') f.checked = !!value; else f.value = String(value); f.dispatchEvent(new Event(f.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true })); };
    const seen = []; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('ql-toast')) seen.push(n.textContent); }).observe(document.body, { childList: true, subtree: true });
    const toasts = () => seen.slice();
    const done = (p) => Promise.race([p, wait(60000).then(() => { throw new Error('timeout; toasts: ' + seen.join(' | ') + '; dialogs ' + document.querySelectorAll('.ql-dialog').length + ' ' + [...document.querySelectorAll('.ql-dialog h2, .ql-dialog .ql-dialog-title')].map((e) => e.textContent).join('/')); })]);
    const pixel = (x, y) => [...qn.picture.frameCanvas().getContext('2d').getImageData(x, y, 1, 1).data];
    const out = {};
    const A = await window.__qnAi();
    window.__qnOrtBase = './ort/';
    const MAP = { modnet: 'matte-test.onnx', 'depth-anything-v2-small': 'depth-test.onnx', lama: 'inpaint-test.onnx', 'swin2sr-x2': 'sr-x2-test.onnx', 'swin2sr-x4-real': 'sr-x4-test.onnx' };
    A.device.setModelUrlOverride((spec, path) => `./ai-fixtures/${MAP[spec.id] || ({ 'onnx/vision_model_quantized.onnx': 'clip-vision-test.onnx', 'onnx/text_model_quantized.onnx': 'clip-text-test.onnx' })[path] || path.split('/').pop()}`);
    for (const spec of A.device.MODELS) await A.device.ensureModel(spec, 'quantized'); // the fixtures: no download dialog later
    const mk = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); draw(x); return new Promise((r) => c.toBlob(r, 'image/png')); };
    const files = [
      new File([await mk(160, 120, (x) => { x.fillStyle = '#000'; x.fillRect(0, 0, 160, 120); x.fillStyle = '#fff'; x.fillRect(40, 30, 80, 60); })], 'a-subject.png', { type: 'image/png' }),
      new File([await mk(40, 40, (x) => { x.fillStyle = '#f00'; x.fillRect(0, 0, 40, 40); })], 'b-red.png', { type: 'image/png' }),
      new File([await mk(40, 40, (x) => { x.fillStyle = '#0f0'; x.fillRect(0, 0, 40, 40); })], 'c-green.png', { type: 'image/png' }),
      new File([await mk(40, 40, (x) => { x.fillStyle = '#e00'; x.fillRect(0, 0, 40, 40); })], 'd-red2.png', { type: 'image/png' }),
    ];
    qn.prefs.confirmClose = false;
    await qn.exec('file.openDropped', files); await wait(600);
    const aiTab = qn.tab; const back = async () => { if (qn.tab !== aiTab) qn.closeTab(qn.tab); qn.activate(aiTab); await wait(300); };
    qn.prefs.ai.services = [{ id: 'mock', name: 'Mock', api: 'openai', baseUrl: `http://localhost:${AI_PORT}/v1`, key: 'k', textModel: 'mock-vision', imageModel: 'mock-image' }, { id: 'mock2', name: 'Mock Two', api: 'openai', baseUrl: `http://localhost:${AI_PORT}/v1`, key: 'k2', textModel: 'mock-vision', imageModel: '' }];
    qn.prefs.ai.textService = 'mock'; qn.prefs.ai.imageService = 'mock'; qn.prefs.ai.privacy.confirmSend = false; qn.prefs.ai.prefer = 'device'; qn.savePrefs();
    out.enabled = ['ai.describe', 'ai.generate', 'ai.fill', 'ai.removeBackground', 'ai.stop'].map((id) => { const c = window.__qnGetCommand(id); return !c.isEnabled || c.isEnabled(qn); });
    out.first = qn.picture.name;
    // Describe: the answer appears in a text dialog.
    let run = qn.exec('ai.describe'); let d = await dialog(); out.describe = field(d, 'text').value; d.querySelector('.ql-primary').click(); await done(run); await noDialog();
    // Alt Text: JSON parsed into two fields.
    run = qn.exec('ai.altText'); d = await dialog(); out.alt = [field(d, 'alt').value, field(d, 'ext').value]; d.querySelector('.ql-cancel, .ql-btn:not(.ql-primary)').click(); await done(run); await noDialog();
    // Suggest Keywords: one checkbox per keyword.
    run = qn.exec('ai.autoTag'); d = await dialog(); out.tags = [...d.querySelectorAll('input[type=checkbox]')].map((c) => c.parentElement.textContent.trim()).filter((t) => t && !/existing/i.test(t)).slice(0, 3); d.querySelector('.ql-cancel, .ql-btn:not(.ql-primary)').click(); await done(run); await noDialog();
    // Select by Description: a normalized box becomes the selection.
    run = qn.exec('ai.selectByPrompt'); d = await dialog(); setField(d, 'what', 'the square'); d.querySelector('.ql-primary').click(); await done(run); await wait(200); out.box = qn.tab.selection && [qn.tab.selection.x, qn.tab.selection.y, qn.tab.selection.w, qn.tab.selection.h];
    // Generate: a new picture with provenance metadata opens in a new window.
    const tabs0 = qn.tabs.length;
    run = qn.exec('ai.generate'); d = await dialog(); setField(d, 'prompt', 'a bicycle'); d.querySelector('.ql-primary').click(); await done(run); await wait(800);
    const M = await window.__qnMeta();
    out.gen = { tabs: qn.tabs.length - tabs0, name: qn.picture.name, w: qn.picture.width, center: pixel(32, 32).slice(0, 3), xmp: (M.extractMeta(qn.picture.bytes).xmp ? new TextDecoder().decode(M.extractMeta(qn.picture.bytes).xmp) : '') };
    out.genProv = { source: /trainedAlgorithmicMedia/.test(out.gen.xmp), prompt: /AiPrompt>a bicycle</.test(out.gen.xmp), provider: /AiProvider>Mock</.test(out.gen.xmp) }; delete out.gen.xmp;
    await back();
    // Generative Fill: the service's blue answer is blended inside the selection only.
    qn.tab.setSelection({ x: 50, y: 40, w: 30, h: 20 });
    run = qn.exec('ai.fill'); d = await dialog(); setField(d, 'prompt', 'a pond'); d.querySelector('.ql-primary').click(); await done(run); await wait(800);
    out.fill = { name: qn.picture.name, size: [qn.picture.width, qn.picture.height], inside: pixel(65, 50).slice(0, 3), outsideWhite: pixel(100, 60).slice(0, 3), outsideBlack: pixel(5, 5).slice(0, 3) };
    await back();
    // Remove Background on the device: the matting fixture keeps the white subject.
    qn.tab.setSelection(null);
    run = qn.exec('ai.removeBackground'); d = await dialog(); setField(d, 'where', 'device'); d.querySelector('.ql-primary').click(); await done(run); await wait(1500);
    out.rb = { name: qn.picture.name, subjectA: pixel(80, 60)[3], cornerA: pixel(5, 5)[3], provider: A.device.runtimeStatus.provider };
    await back();
    // Erase Object on the device: the inpainting fixture fills the selection with mid-gray.
    qn.tab.setSelection({ x: 50, y: 40, w: 30, h: 20 });
    run = qn.exec('ai.erase'); d = await dialog(); setField(d, 'where', 'device'); d.querySelector('.ql-primary').click(); await done(run); await wait(1500);
    out.erase = { inside: pixel(65, 50)[0], outside: pixel(100, 60)[0], black: pixel(5, 5)[0] };
    await back();
    // Upscale 2× on the device.
    qn.tab.setSelection(null);
    run = qn.exec('ai.upscale'); d = await dialog(); d.querySelector('.ql-primary').click(); await done(run); await wait(2500);
    out.up = { size: [qn.picture.width, qn.picture.height], center: pixel(160, 120)[0], corner: pixel(2, 2)[0] };
    await back();
    // Depth Map as a selection by distance: the near (white) subject.
    run = qn.exec('ai.depth'); d = await dialog(); setField(d, 'out', 'selection'); d.querySelector('.ql-primary').click(); await done(run); await wait(1500);
    out.depthSel = qn.tab.selection && [qn.tab.selection.x, qn.tab.selection.y, qn.tab.selection.w, qn.tab.selection.h];
    qn.tab.setSelection(null);
    // Search by Content (CLIP fixture): every picture scores; the thumbnails are filtered.
    run = qn.exec('ai.searchContent'); d = await dialog(); setField(d, 'q', 'red'); setField(d, 'min', 0); d.querySelector('.ql-primary').click(); await done(run); await wait(500);
    d = await dialog(); out.search = { hits: d.querySelectorAll('.qn-ai-card').length, top: (d.querySelector('.qn-ai-card') || {}).textContent, label: qn.tab.thumbs ? qn.tab.thumbs.filterLabel : '' }; d.querySelector('.ql-primary').click(); await noDialog();
    if (qn.tab.thumbs) { qn.tab.thumbs.filter = null; qn.tab.thumbs.filterLabel = ''; qn.tab.thumbs.refilter(); }
    // Find Similar by Content from the red picture: the other red one comes first.
    for (let i = 0; i < 6 && qn.picture?.name !== 'b-red.png'; i++) { await qn.exec('view.next'); await wait(250); }
    out.simCur = qn.picture?.name;
    run = qn.exec('ai.findSimilarSemantic'); await done(run); await wait(300); d = await dialog(); out.similar = [...d.querySelectorAll('.qn-ai-card')].map((c) => c.textContent.split(' — ')[0]); d.querySelector('.ql-primary').click(); await noDialog();
    if (qn.tab.thumbs) { qn.tab.thumbs.filter = null; qn.tab.thumbs.filterLabel = ''; qn.tab.thumbs.refilter(); }
    // Several AIs (master): two members answer, the master combines; the discussion is shown.
    qn.prefs.ai.ensemble = { mode: 'master', members: ['mock', 'mock2'], master: 'mock', showDeliberation: true }; qn.savePrefs();
    run = qn.exec('ai.describe'); d = await dialog(); out.ensemble = { text: field(d, 'text').value, discussion: /## Mock .*round 1[\s\S]*## Mock Two[\s\S]*## Master: Mock/.test(field(d, 'delib').value) }; d.querySelector('.ql-primary').click(); await done(run); await noDialog();
    qn.prefs.ai.ensemble.mode = 'single'; qn.savePrefs();
    out.history = A.history.readHistory().map((e) => `${e.command}:${e.service}`);
    out.models = (await A.device.downloadedModels()).map((m) => m.spec.id).sort();
    out.toasts = toasts();
    return out;
  }, AI_PORT);
  check('ai commands enabled with a service', ai.enabled, [true, true, false, true, false]);
  check('ai describe', ai.describe, 'A red rectangle on a white background.');
  check('ai alt text', ai.alt, ['A red square', 'A plain red square on a white background.']);
  check('ai keywords', ai.tags, ['sunset', 'beach', 'sea']);
  check('ai select by description', ai.box, [40, 30, 80, 60]);
  check('ai generate opens a labeled picture', [ai.gen.tabs, ai.gen.w, ai.gen.center, ai.genProv], [1, 64, [255, 220, 0], { source: true, prompt: true, provider: true }]);
  check('ai fill blends inside the selection', [ai.fill.size, ai.fill.inside, ai.fill.outsideWhite, ai.fill.outsideBlack, /AI edit/.test(ai.fill.name)], [[160, 120], [0, 0, 255], [255, 255, 255], [0, 0, 0], true]);
  check('ai remove background on the device', [ai.rb.subjectA, ai.rb.cornerA, ai.rb.provider], [255, 0, 'wasm']);
  check('ai erase on the device', [Math.abs(ai.erase.inside - 128) < 6, ai.erase.outside, ai.erase.black], [true, 255, 0]);
  check('ai upscale on the device', [ai.up.size, ai.up.center, ai.up.corner], [[320, 240], 255, 0]);
  check('ai depth selection', ai.depthSel, [40, 30, 80, 60]);
  check('ai search by content filters the panel to matches', [ai.search.hits >= 1 && ai.search.hits <= 4, /^[bd]-red/.test(ai.search.top || ''), ai.search.label], [true, true, 'Search: red']);
  check('ai find similar by content ranks a red picture first', [/red/.test(ai.similar[0] || ''), ai.simCur], [true, 'b-red.png']);
  check('ai block started on the subject picture', ai.first, 'a-subject.png');
  check('ai ensemble master', [ai.ensemble.text, ai.ensemble.discussion], ['Combined: a red rectangle on a white background.', true]);
  check('ai history', [ai.history.includes('ai.generate:Mock'), ai.history.includes('ai.describe:Mock (master of 2)'), ai.history.some((h) => /^ai\.upscale:this device/.test(h))], [true, true, true]);
  check('ai models cached', ai.models, ['clip-vit-b32', 'depth-anything-v2-small', 'lama', 'modnet', 'swin2sr-x2', 'swin2sr-x4-real']);
  const sent = mockAi.requests;
  check('ai requests carried the picture and the key', [sent.find((r) => r.kind === 'chat')?.images, sent.find((r) => r.kind === 'chat')?.auth, sent.find((r) => r.kind === 'generate')?.prompt, sent.find((r) => r.kind === 'edit')?.hasMask, sent.filter((r) => r.kind === 'chat' && r.json).length > 0], [1, 'Bearer k', 'a bicycle', true, true]);
  if (ai.toasts.some((t) => /: the service|Could not|failed|stopped/i.test(t))) failures.push('ai toasts: ' + ai.toasts.join(' | '));

  if (errs.length) failures.push(...errs);
} finally {
  await browser.close();
  if (server) try { process.kill(-server.pid); } catch { /* already gone */ }
  mockAi.close();
}

if (failures.length) { console.error('E2E failures:\n' + failures.join('\n')); process.exit(1); }
console.log('E2E smoke test passed');
