// Desktop (Electron) checks: Next / Previous Folder on a real folder tree (siblings and parents),
// Full Screen on Another Display (two displays faked in the main process), and Frameless Window
// (the window is rebuilt without its frame and reopens the picture). Needs a display: run with
// `xvfb-run -a npm run e2e:desktop` after `npm run build`.
import { _electron as electron } from 'playwright';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

if (!existsSync('build/desktop-app/package.json')) execFileSync('node', ['scripts/prepare-desktop.mjs'], { stdio: 'inherit' });
const failures = [];
const check = (name, got, want, note) => { if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}${note ? ' [' + note + ']' : ''}`); };

// A tiny solid PNG.
const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const png = (r, g, b) => { const ih = Buffer.alloc(13); ih.writeUInt32BE(4, 0); ih.writeUInt32BE(4, 4); ih[8] = 8; ih[9] = 2; const row = Buffer.from([0, ...Array(4).fill([r, g, b]).flat()]); return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(Buffer.concat(Array(4).fill(row)))), chunk('IEND', Buffer.alloc(0))]); };

const base = mkdtempSync(join(tmpdir(), 'ql-desktop-')), lib = join(base, 'library');
const put = (rel, color) => { const p = join(lib, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, png(...color)); return p; };
const first = put('Photos/2023/01 Jan/a.png', [255, 0, 0]);
put('Photos/2023/02 Feb/raw/b.png', [0, 255, 0]);
mkdirSync(join(lib, 'Photos/2023/02 Feb/empty'), { recursive: true });
put('Photos/2024/c.png', [0, 0, 255]); put('Photos/2024/d.png', [0, 0, 255]);
put('Photos/.cache/x.png', [9, 9, 9]);
put('Scans/e.png', [255, 255, 0]);
const config = join(base, 'config');

const app = await electron.launch({ executablePath: 'node_modules/electron/dist/electron', args: ['--no-sandbox', 'build/desktop-app', first], env: { ...process.env, XDG_CONFIG_HOME: config } });
app.process().stderr?.on('data', (d) => process.stderr.write('[main] ' + d));
app.process().stdout?.on('data', (d) => process.stderr.write('[main] ' + d));
try {
  let w = await app.firstWindow();
  await w.waitForFunction(() => window.qn && window.qn.picture?.name === 'a.png', null, { timeout: 30000 });
  const where = () => w.evaluate(() => `${qn.folder.name}:${qn.folder.length}:${qn.picture?.name}`);
  const steps = [await where()];
  for (const key of ['Control+ArrowRight', 'Control+ArrowRight', 'Control+ArrowRight', 'Control+ArrowLeft', 'Control+ArrowLeft', 'Control+ArrowLeft']) {
    const before = await where();
    await w.keyboard.press(key);
    await w.waitForFunction((b) => `${qn.folder.name}:${qn.folder.length}:${qn.picture?.name}` !== b, before, { timeout: 8000 }).catch(() => undefined);
    await w.waitForTimeout(200);
    steps.push(await where());
  }
  check('desktop next / previous folder: subfolders first, then siblings, then the parent\'s siblings', steps, ['01 Jan:1:a.png', 'raw:1:b.png', '2024:2:c.png', 'Scans:1:e.png', '2024:2:c.png', 'raw:1:b.png', '01 Jan:1:a.png']);

  // Two displays (faked in the main process): the window moves to the second and goes full screen; leaving restores it.
  await app.evaluate(({ screen }) => {
    const d = [{ id: 1, label: 'Built-in', bounds: { x: 0, y: 0, width: 1280, height: 800 }, workArea: { x: 0, y: 0, width: 1280, height: 800 } }, { id: 2, label: 'Projector', bounds: { x: 1280, y: 0, width: 1024, height: 768 }, workArea: { x: 1280, y: 0, width: 1024, height: 768 } }];
    screen.getAllDisplays = () => d; screen.getPrimaryDisplay = () => d[0]; screen.getDisplayMatching = (b) => (b.x >= 1280 ? d[1] : d[0]);
  });
  const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  const listed = await w.evaluate(() => window.quillDesktop.listDisplays());
  await w.evaluate(() => qn.exec('view.fullScreenDisplay', 1));
  await w.waitForTimeout(1200);
  const during = await app.evaluate(({ BrowserWindow }) => { const b = BrowserWindow.getAllWindows()[0]; return { full: b.isFullScreen() }; });
  const cls = await w.evaluate(() => document.body.classList.contains('ql-fullscreen'));
  await w.evaluate(() => qn.exec('view.fullScreen'));
  await w.waitForTimeout(1500);
  const after = await app.evaluate(({ BrowserWindow }) => { const b = BrowserWindow.getAllWindows()[0]; return { full: b.isFullScreen(), bounds: b.getBounds() }; });
  check('desktop displays listed', listed.map((x) => [x.label, x.primary, x.current]), [['Built-in', true, true], ['Projector', false, false]]);
  check('desktop full screen on the second display, and back', [during.full, cls, after.full, after.bounds.x === before.x && after.bounds.width === before.width], [true, true, false, true], JSON.stringify({ before, during, after }));

  // Script Console under the desktop Content Security Policy (blob: worker, importScripts, no eval).
  const con = await w.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const run = qn.exec('dev.console', 'const p = await picture.pixels(); return [p.width, p.height, p.data[0], p.data[1], p.data[2]];');
    let dlg; for (let i = 0; i < 60 && !(dlg = [...document.querySelectorAll('.ql-dialog')].find((d) => /Script Console/.test(d.textContent))); i++) await wait(50);
    [...dlg.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Run').click();
    const log = () => dlg.querySelector('.qn-console-out').textContent;
    for (let i = 0; i < 100 && !/←|✖/.test(log()); i++) await wait(50);
    const text = log();
    [...dlg.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Close').click(); await run;
    return text.replace(/\s+/g, ' ');
  });
  check('desktop script console runs under the app\'s security policy', /← \[ 4, 4, 255, 0, 0 \]/.test(con), true, con);

  // Frameless: a new window without a frame, the same picture in it, the title bar's window buttons shown.
  // The window that asks is replaced, so the call itself never returns.
  const next = app.waitForEvent('window');
  void w.evaluate(() => qn.exec('view.frameless')).catch(() => undefined);
  w = await next;
  await w.waitForFunction(() => window.qn && window.qn.picture?.name === 'a.png' && document.body.classList.contains('qn-frameless'), null, { timeout: 30000 });
  const fl = await w.evaluate(() => ({ winctl: getComputedStyle(document.querySelector('.ql-winctl')).display !== 'none' && document.querySelector('.ql-winctl').getBoundingClientRect().width > 60, drag: getComputedStyle(document.querySelector('.ql-titlebar')).getPropertyValue('-webkit-app-region') || getComputedStyle(document.querySelector('.ql-titlebar')).getPropertyValue('app-region'), active: window.__qnGetCommand('view.frameless').isActive(qn), folder: qn.folder.name }));
  const count = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  check('desktop frameless window reopens the picture with window buttons', [fl, count], [{ winctl: true, drag: 'drag', active: true, folder: '01 Jan' }, 1]);
  await w.evaluate(() => window.quillDesktop.windowControl({ action: 'maximize' }));
  await w.waitForTimeout(300);
  const back = app.waitForEvent('window');
  void w.evaluate(() => qn.exec('view.frameless')).catch(() => undefined);
  w = await back;
  await w.waitForFunction(() => window.qn && window.qn.picture?.name === 'a.png', null, { timeout: 30000 });
  check('desktop framed again', await w.evaluate(() => [document.body.classList.contains('qn-frameless'), getComputedStyle(document.querySelector('.ql-winctl')).display]), [false, 'none']);
} finally {
  await app.close().catch(() => undefined);
}

// The command line: help, version, usage errors, and --convert without a window.
const ELECTRON = 'node_modules/electron/dist/electron', APPDIR = 'build/desktop-app';
const cliRun = (args, cwd) => { const r = spawnSync(join(process.cwd(), ELECTRON), ['--no-sandbox', join(process.cwd(), APPDIR), ...args], { cwd: cwd || process.cwd(), encoding: 'utf8', timeout: 90000, env: { ...process.env, XDG_CONFIG_HOME: config } }); return { code: r.status, out: r.stdout, err: (r.stderr || '').split('\n').filter((l) => /annes-lens|Run annes-lens/.test(l)).join('\n') }; };
const pngSize = (p) => { const b = readFileSync(p); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
try {
  const help = cliRun(['--help']), ver = cliRun(['--version']), bad = cliRun(['--rotate=45', '--convert=*.png', 'x.png']);
  check('cli --help', [help.code, /--convert=PATTERN/.test(help.out), /Exit status/.test(help.out)], [0, true, true], help.out.slice(0, 200));
  check('cli --version', [ver.code, /^\d+\.\d+\.\d+/.test(ver.out)], [0, true], ver.out);
  check('cli usage error', [bad.code, /--rotate=45: use 90, 180, 270 or exif/.test(bad.err)], [2, true], bad.err);
  const out1 = cliRun(['--convert=small/*-s.png', '--resize=2x2', '--rotate=90', '--gray', join(lib, 'Photos/2024'), join(lib, 'Scans/e.png')], base);
  const made = existsSync(join(base, 'small')) ? readdirSync(join(base, 'small')).sort() : [];
  check('cli --convert writes resized, turned, gray pictures and reports them', [out1.code, made, made.map((f) => pngSize(join(base, 'small', f))), out1.out.trim().split('\n').length], [0, ['c-s.png', 'd-s.png', 'e-s.png'], [[2, 2], [2, 2], [2, 2]], 3], out1.out + out1.err);
  const again = cliRun(['--convert=small/*-s.png', join(lib, 'Scans/e.png')], base), over = cliRun(['--convert=small/*-s.png', '--overwrite', join(lib, 'Scans/e.png')], base);
  check('cli --convert keeps existing files unless --overwrite', [again.code, /e\.png -> e-s \(2\)\.png/.test(again.out), over.code, /e\.png -> e-s\.png/.test(over.out), readdirSync(join(base, 'small')).length], [0, true, 0, true, 4], again.out + over.out);
  const none = cliRun(['--convert=x/*.png', join(base, 'missing.png')], base);
  check('cli --convert with nothing to convert', [none.code, /no pictures to convert/.test(none.err)], [2, true], none.err);
  // --fullscreen at start-up.
  const fsApp = await electron.launch({ executablePath: ELECTRON, args: ['--no-sandbox', APPDIR, '--fullscreen', first], env: { ...process.env, XDG_CONFIG_HOME: config } });
  const fw = await fsApp.firstWindow();
  const fsOn = await fw.waitForFunction(() => window.qn?.picture?.name === 'a.png' && document.body.classList.contains('ql-fullscreen'), null, { timeout: 30000 }).then(() => true).catch(() => false);
  await fsApp.close().catch(() => undefined);
  check('cli --fullscreen opens the picture full screen', fsOn, true);
} finally {
  rmSync(base, { recursive: true, force: true });
}
if (failures.length) { console.error('Desktop e2e failures:\n' + failures.join('\n')); process.exit(1); }
console.log('Desktop e2e passed');
