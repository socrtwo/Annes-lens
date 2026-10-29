/**
 * The ribbon: one tab per plan tab, one group per plan group, in the plan's order, plus the Home tab the
 * plan describes (docs/MENUS-PLAN.md ▸ Ribbon). Groups reference command ids only, so users can rebuild
 * any of it with Customize Tabs. Commands the app does not have yet are skipped when rendering, so the
 * layout can name the whole plan; commands the plan marks "not in tabs" are left out (they stay reachable
 * through the menus, the Quick Access Bar chooser, Customize Tabs and command search). Contextual tabs (Pages and Frames, RAW, Picture Tools) appear when
 * they apply.
 */
import type { App } from '../app';
import { PLAN_TABS, PLAN_HOME_TAB, PLAN_COMMANDS } from '../plan.generated';

export interface RibbonGroup { id: string; label: string; items: string[]; launcher?: string }
export interface RibbonTab { id: string; label: string; groups: RibbonGroup[]; contextual?: (app: App) => boolean; accent?: string; custom?: boolean }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const CONTEXTUAL: Record<string, { test: (app: App) => boolean; accent: string }> = {
  pages: { test: (app) => !!app.picture && (app.picture.multipage || app.picture.animated), accent: '#2F6F8F' },
  raw: { test: (app) => !!app.picture && app.picture.format.id === 'raw', accent: '#8F5A2F' },
};

export const DEFAULT_TABS: RibbonTab[] = [
  { id: 'home', label: 'Home', groups: PLAN_HOME_TAB.map((g) => ({ id: slug(g.group), label: g.group, items: [...g.commands] })) },
  ...PLAN_TABS.map((t): RibbonTab => ({
    id: t.prefix, label: t.name,
    groups: t.groups.map((g) => ({ id: slug(g.name), label: g.name, items: g.commands.filter((id) => !PLAN_COMMANDS[id]?.notInTabs) })),
    contextual: CONTEXTUAL[t.prefix]?.test, accent: CONTEXTUAL[t.prefix]?.accent,
  })),
];

export const BACKSTAGE_ITEMS = ['file.open', 'file.openFolder', 'file.openRecent', 'file.save', 'file.saveAs', 'file.print', 'file.share', 'file.close', 'file.options'];

export function tabsFor(app: App): RibbonTab[] {
  const p = app.prefs;
  const order = p.tabOrder.length ? p.tabOrder : [];
  const builtIn = DEFAULT_TABS.filter((t) => !p.hiddenTabs.includes(t.id));
  const custom: RibbonTab[] = p.customTabs.filter((t) => !t.hidden).map((t) => ({ id: t.id, label: t.label, groups: t.groups, custom: true }));
  const all = [...builtIn, ...custom];
  if (!order.length) return all;
  return [...all].sort((a, b) => {
    const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
}

export function idsInTabs(): Set<string> {
  const s = new Set<string>();
  for (const t of DEFAULT_TABS) for (const g of t.groups) for (const id of g.items) s.add(id);
  return s;
}
