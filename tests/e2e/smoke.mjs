// Browser smoke test: serves dist/ with `vite preview`, opens generated pictures through the drop command,
// walks the folder, zooms, rotates, undoes, reads pixel info, switches menus and saves a copy.
// Usage: npm run build && npm run e2e   (set QN_URL to test an already-running server instead)
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

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
const check = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };

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
  check('menu bar', await p.evaluate(() => [...document.querySelectorAll('.ql-menubar-item')].map((b) => b.textContent)), ['File', 'Edit', 'Image', 'Options', 'View', 'AI', 'Help'].filter((m) => m !== 'AI'));

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

  // Command palette finds commands; QAT add all is idempotent.
  check('search', await p.evaluate(() => window.__qnGetCommand('view.next').label), 'Next Picture');
  await p.evaluate(() => qn.exec('view.qatAddAll'));
  const qat1 = await p.evaluate(() => qn.prefs.qat.length);
  await p.evaluate(() => qn.exec('view.qatAddAll'));
  check('qat add all idempotent', await p.evaluate(() => qn.prefs.qat.length), qat1);

  if (errs.length) failures.push(...errs);
} finally {
  await browser.close();
  if (server) try { process.kill(-server.pid); } catch { /* already gone */ }
}

if (failures.length) { console.error('E2E failures:\n' + failures.join('\n')); process.exit(1); }
console.log('E2E smoke test passed');
