/**
 * Classic menu bars. Each layout reproduces where a picture viewer put its commands, so people who
 * learned one of them find every command where they expect it. The layouts come from the plan
 * (docs/menus-plan.src.txt → docs/commands-plan.json → src/plan.generated.ts): items are command ids,
 * '---' a separator, { submenu, items } a submenu. A command missing from the registry is skipped, so a
 * layout can name every command the plan has; labels come from the commands themselves.
 */
import { PLAN_LAYOUTS, type PlanMenuItem } from '../plan.generated';

export type ClassicItem = string | { label: string; items: ClassicItem[] };
export interface ClassicMenu { label: string; items: ClassicItem[] }

const convert = (items: PlanMenuItem[]): ClassicItem[] => items.map((it) => (typeof it === 'string' ? (it === '---' ? '|' : it) : { label: it.submenu, items: convert(it.items) }));

export const CLASSIC_MENUS: Record<string, ClassicMenu[]> = Object.fromEntries(Object.entries(PLAN_LAYOUTS).map(([key, L]) => [key, L.menus.map((m) => ({ label: m.name, items: convert(m.items) }))]));

export const CLASSIC_LAYOUT_NAMES: Record<string, string> = Object.fromEntries(Object.entries(PLAN_LAYOUTS).map(([key, L]) => [key, L.name]));
export const CLASSIC_LAYOUT_MODELS: Record<string, string> = Object.fromEntries(Object.entries(PLAN_LAYOUTS).map(([key, L]) => [key, L.modeledOn]));
export const DEFAULT_LAYOUT = 'irfanview';

/** Every command id any classic layout names (for tests and the menu map). */
export function classicIds(layout?: string): Set<string> {
  const s = new Set<string>();
  const walk = (items: ClassicItem[]) => { for (const it of items) { if (it === '|') continue; if (typeof it === 'string') s.add(it); else walk(it.items); } };
  for (const [k, menus] of Object.entries(CLASSIC_MENUS)) if (!layout || k === layout) for (const m of menus) walk(m.items);
  return s;
}

/** Where a command sits in a layout: ["File", "Open as"] style paths, one per occurrence. */
export function menuPaths(layout: string, id: string): string[][] {
  const out: string[][] = [];
  const walk = (items: ClassicItem[], path: string[]) => { for (const it of items) { if (it === '|') continue; if (typeof it === 'string') { if (it === id) out.push(path); } else walk(it.items, [...path, it.label]); } };
  for (const m of CLASSIC_MENUS[layout] || []) walk(m.items, [m.label]);
  return out;
}
