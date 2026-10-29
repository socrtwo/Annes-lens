/** Pages and Frames (contextual): multipage files (TIFF, ICO) and animations (GIF, APNG, WebP). */
import { def } from './registry';
import type { App } from '../app';
import { openDialog, toast } from '../ui/dialog';

const hasPages = (app: App) => !!app.picture && app.picture.pages.length > 1;
const hasFrames = (app: App) => !!app.picture && app.picture.animated;

function setPage(app: App, i: number): void {
  const p = app.picture!;
  p.page = Math.max(0, Math.min(p.pages.length - 1, i)); p.frame = 0;
  app.viewer.pictureChanged(); app.refresh();
}
function setFrame(app: App, i: number): void {
  const p = app.picture!;
  const n = p.current.frames.length;
  p.frame = ((i % n) + n) % n;
  if (app.viewer.playing) { app.viewer.playing = false; app.viewer.stopAnimation(); }
  app.viewer.draw(); app.refresh();
}

def([
  { id: 'pages.next', icon: 'skip_next', noRecord: true, isEnabled: hasPages, run: (app) => setPage(app, app.picture!.page + 1) },
  { id: 'pages.previous', icon: 'skip_previous', noRecord: true, isEnabled: hasPages, run: (app) => setPage(app, app.picture!.page - 1) },
  {
    id: 'pages.goto', icon: 'pin', noRecord: true, isEnabled: hasPages,
    run: async (app, n?: number) => {
      const p = app.picture!;
      if (typeof n !== 'number') { const r = await openDialog({ title: 'Go to Page', fields: [{ key: 'n', label: `Page (1–${p.pages.length})`, type: 'list', options: p.pages.map((pg, i) => ({ value: String(i + 1), label: `${i + 1}: ${pg.width} × ${pg.height}, ${pg.bitDepth} bpp` })), value: String(p.page + 1) }] }); if (!r) return; n = +r.n; }
      setPage(app, (n || 1) - 1);
    },
  },
  { id: 'frames.play', icon: 'play_pause', kind: 'toggle', noRecord: true, isEnabled: hasFrames, isActive: (app) => !!app.viewer?.playing && hasFrames(app), run: (app) => app.viewer.togglePlay() },
  { id: 'frames.next', icon: 'skip_next', noRecord: true, isEnabled: hasFrames, run: (app) => setFrame(app, app.picture!.frame + 1) },
  { id: 'frames.previous', icon: 'skip_previous', noRecord: true, isEnabled: hasFrames, run: (app) => setFrame(app, app.picture!.frame - 1) },
  {
    id: 'frames.speed', icon: 'speed', kind: 'menu', noRecord: true, isEnabled: hasFrames,
    menu: (app) => [0.25, 0.5, 1, 2, 4].map((s) => ({ id: 'frames.speed', arg: s, label: `${s}×`, checked: ((app as any).animSpeed || 1) === s })),
    run: (app, s?: number) => {
      const speed = s || 1;
      const p = app.picture!;
      const prev = (app as any).animSpeed || 1;
      for (const pg of p.pages) for (const f of pg.frames) f.delay = f.delay * prev / speed;
      (app as any).animSpeed = speed;
      if (app.viewer.playing) app.viewer.startAnimation();
      toast(`Animation speed ${speed}×`);
    },
  },
]);
