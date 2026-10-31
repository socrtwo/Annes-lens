/**
 * Synchronize Windows: the open windows side by side, following the active one's zoom, pan and
 * navigation (next, previous, first, last, go to). Clicking a window makes it the one followed.
 */
import type { App } from '../app';
import { viewHooks } from './viewHooks';

export const sync = { on: false, last: '' };
const STEP: Record<string, number> = { 'view.next': 1, 'view.previous': -1 };

export function setSync(app: App, on: boolean): void {
  sync.on = on; sync.last = '';
  app.ui.workspace.classList.toggle('qn-tiled', on);
  app.ui.workspace.style.setProperty('--qn-tiles', String(Math.min(4, Math.max(1, app.tabs.length))));
  app.activate(app.tab);
  for (const t of app.tabs) t.ui.layout();
  if (on) followView(app);
}

/** Copies the active window's relative zoom and center to the others. */
export function followView(app: App): void {
  const v = app.tab.ui.viewRel(); if (!v) return;
  const key = `${v.rel.toFixed(4)}|${v.nx.toFixed(4)}|${v.ny.toFixed(4)}`; if (key === sync.last) return; sync.last = key;
  for (const t of app.tabs) if (t !== app.tab && t.picture) t.ui.applyRel(v);
}

export function installSync(app: App): void {
  viewHooks.tiled = () => sync.on;
  viewHooks.changed = (v) => { if (sync.on && v.tab === app.tab) followView(app); };
  app.afterExec.push((id, arg) => {
    if (!sync.on || app.tabs.length < 2) return;
    const others = app.tabs.filter((t) => t !== app.tab && t.folder.length);
    for (const t of others) {
      const f = t.folder; let moved = false;
      if (STEP[id]) moved = f.step(STEP[id], app.prefs.wrap);
      else if (id === 'view.first') moved = f.select(0);
      else if (id === 'view.last') moved = f.select(f.length - 1);
      else if (id === 'view.gotoIndex' && typeof arg === 'number') moved = f.select(arg);
      if (moved) void t.show().then(() => { sync.last = ''; followView(app); });
    }
  });
}
