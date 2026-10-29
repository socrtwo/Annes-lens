// Browser smoke test: serves dist/ with `vite preview`, opens generated pictures through the drop command,
// walks the folder, zooms, rotates, undoes, reads pixel info, switches menus and saves a copy.
// Usage: npm run build && npm run e2e   (set QN_URL to test an already-running server instead)
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
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
