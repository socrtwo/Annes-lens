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
