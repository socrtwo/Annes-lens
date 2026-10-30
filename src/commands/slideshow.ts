/**
 * Slideshow tab: Start Slideshow, Start from Current, Slideshow Settings (timing, order, loop,
 * captions, transitions), Transition, Timing, Loop, Random Order, Captions, Pause / Resume, Kiosk
 * Mode and Export as HTML Slideshow. Background Music and Phone Remote come with the media work.
 */
import { def } from './registry';
import type { App } from '../app';
import { openDialog, toast } from '../ui/dialog';
import { show, start, stop, togglePause, buildSlideshowHtml, DEFAULT_SLIDESHOW, type Transition } from '../picture/slideshow';
import { decodePicture, encodeCanvas } from '../codecs/registry';
import { saveAs } from '../platform/native';
import { fmtSize } from '../ui/shell';
import { expandOsd } from '../ui/overlays';

const hasFolder = (app: App) => app.folder.length > 0;
const S = (app: App) => ({ ...DEFAULT_SLIDESHOW, ...app.prefs.slideshow });
const save = (app: App, patch: Partial<typeof DEFAULT_SLIDESHOW>) => { app.prefs.slideshow = { ...S(app), ...patch }; app.savePrefs(); };
const TRANSITIONS: [Transition, string][] = [['none', 'None'], ['fade', 'Fade'], ['wipe', 'Wipe'], ['slide', 'Slide'], ['zoom', 'Zoom'], ['panzoom', 'Pan and zoom'], ['random', 'Random']];

def([
  { id: 'show.start', icon: 'slideshow', popular: true, noRecord: true, isEnabled: hasFolder, tip: 'Full-screen show of the folder from its first picture (Esc stops, Space pauses, arrows move)', run: (app) => { start(app, false); toast(`Slideshow: ${app.folder.length} pictures, ${S(app).seconds} s each. Esc stops.`, { ms: 2500 }); } },
  { id: 'show.fromCurrent', icon: 'play_arrow', noRecord: true, isEnabled: hasFolder, run: (app) => start(app, true) },
  { id: 'show.pause', icon: 'pause', kind: 'toggle', noRecord: true, isEnabled: () => show.running, isActive: () => show.paused, run: (app) => { if (!show.running) { toast('No slideshow is running (Start Slideshow, Ctrl+F5).'); return; } togglePause(app); } },
  {
    id: 'show.settings', icon: 'settings', noRecord: true, tip: 'Seconds per picture, order, loop, transitions and captions',
    run: async (app) => {
      const s = S(app);
      const r = await openDialog({ title: 'Slideshow Settings', ok: 'Save', fields: [
        { key: 'seconds', label: 'Seconds per picture (0 = manual)', type: 'number', min: 0, max: 3600, step: 0.5, value: s.seconds, half: true },
        { key: 'transition', label: 'Transition', type: 'select', options: TRANSITIONS.map(([value, label]) => ({ value, label })), value: s.transition, half: true },
        { key: 'transitionMs', label: 'Transition length (ms)', type: 'number', min: 0, max: 5000, value: s.transitionMs, half: true },
        { key: 'loop', label: 'Loop', type: 'checkbox', value: s.loop, half: true }, { key: 'random', label: 'Random order', type: 'checkbox', value: s.random, half: true },
        { key: 'captions', label: 'Captions', type: 'checkbox', value: s.captions, half: true }, { key: 'captionTemplate', label: 'Caption template', type: 'textarea', rows: 2, value: s.captionTemplate, help: '{name} {w} {h} {n} {total} {exifdate} {camera} {exposure} {size}' },
        { key: 'kiosk', label: 'Kiosk mode (locked full-screen loop; only Esc leaves)', type: 'checkbox', value: s.kiosk },
      ], buttons: [{ label: 'Start', primary: true, onClick: (v, ctl) => { ctl.close(v); setTimeout(() => app.exec('show.start'), 50); } }] });
      if (!r) return;
      save(app, { seconds: Math.max(0, +r.seconds || 0), transition: r.transition, transitionMs: Math.max(0, +r.transitionMs || 0), loop: !!r.loop, random: !!r.random, captions: !!r.captions, captionTemplate: String(r.captionTemplate || '{name}'), kiosk: !!r.kiosk });
    },
  },
  { id: 'show.transition', icon: 'animation', kind: 'menu', noRecord: true, menu: (app) => TRANSITIONS.map(([value, label]) => ({ id: 'show.transition', arg: value, label, checked: S(app).transition === value })), run: (app, arg?: Transition) => { if (arg) save(app, { transition: arg }); } },
  { id: 'show.timing', icon: 'timer', kind: 'menu', noRecord: true, menu: (app) => [1, 2, 3, 4, 5, 8, 10, 15, 30, 0].map((n) => ({ id: 'show.timing', arg: n, label: n ? `${n} seconds` : 'Manual (keys only)', checked: S(app).seconds === n })), run: (app, arg?: number) => { if (typeof arg === 'number') { save(app, { seconds: arg }); if (show.running) togglePause(app), togglePause(app); } } },
  { id: 'show.loop', icon: 'repeat', kind: 'toggle', noRecord: true, isActive: (app) => S(app).loop, run: (app) => save(app, { loop: !S(app).loop }) },
  { id: 'show.random', icon: 'shuffle', kind: 'toggle', noRecord: true, isActive: (app) => S(app).random, run: (app) => save(app, { random: !S(app).random }) },
  { id: 'show.captions', icon: 'closed_caption', kind: 'toggle', noRecord: true, isActive: (app) => S(app).captions, tip: 'File name, date and other fields over the picture (template in Slideshow Settings)', run: (app) => save(app, { captions: !S(app).captions }) },
  { id: 'show.kiosk', icon: 'tv', noRecord: true, isEnabled: hasFolder, tip: 'A locked full-screen loop for displays: keys and clicks are ignored; Esc leaves', run: (app) => { save(app, { loop: true }); start(app, false, true); toast('Kiosk mode: Esc leaves.', { ms: 3000 }); } },
  {
    id: 'show.exportHtml', icon: 'html', noRecord: true, isEnabled: hasFolder, tip: 'One self-contained page with the pictures, timing, transitions and captions',
    run: async (app) => {
      const s = S(app); const f = app.tab.folder; const marked = f.entries.filter((e) => app.tab.marked.has(e)); const entries = marked.length ? marked : f.entries;
      const r = await openDialog({ title: 'Export as HTML Slideshow', ok: 'Save…', help: `${entries.length} pictures${marked.length ? ' (the marked thumbnails)' : ''} embedded as JPEG; keep the longest side modest to keep the page small.`, fields: [{ key: 'maxSide', label: 'Longest side (px)', type: 'number', min: 200, max: 4096, value: 1600, half: true }, { key: 'quality', label: 'JPEG quality (%)', type: 'number', min: 30, max: 100, value: 82, half: true }, { key: 'title', label: 'Title', type: 'text', value: f.name || 'Slideshow' }] });
      if (!r) return;
      const items: { name: string; dataUrl: string; caption: string }[] = []; let i = 0;
      for (const e of entries) {
        i++; if (i % 5 === 0) toast(`Encoding ${i} of ${entries.length}…`, { ms: 700 });
        try {
          const pic = await decodePicture(new Uint8Array(await e.read()), e);
          try {
            const src = pic.frameCanvas(); const k = Math.min(1, +r.maxSide / Math.max(src.width, src.height)); const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(src.width * k)); c.height = Math.max(1, Math.round(src.height * k)); const x = c.getContext('2d')!; x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height);
            const blob = await encodeCanvas(c, 'jpeg', +r.quality / 100);
            const dataUrl = await new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(blob); });
            items.push({ name: e.name, dataUrl, caption: expandOsd(s.captionTemplate, { name: e.name, w: pic.width, h: pic.height, n: i, total: entries.length, exifdate: pic.exif?.dateTaken || '', camera: [pic.exif?.make, pic.exif?.model].filter(Boolean).join(' '), exposure: pic.exif?.exposure || '', size: fmtSize(pic.bytes.length), zoom: 100, page: 1, pages: pic.pages.length }) });
          } finally { pic.release(); }
        } catch { /* skipped */ }
      }
      if (!items.length) { toast('No picture could be encoded.'); return; }
      const html = buildSlideshowHtml(items, s, String(r.title || 'Slideshow'));
      const saved = await saveAs(new Blob([html], { type: 'text/html' }), `${(String(r.title || f.name || 'slideshow')).replace(/[\\/:*?"<>|]/g, '_')}.html`);
      if (saved) toast(`Saved ${saved.name} (${items.length} pictures, ${fmtSize(html.length)})`);
    },
  },
]);
