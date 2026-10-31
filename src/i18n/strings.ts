/**
 * Interface languages: the words on the ribbon, the menus and the command names and tooltips. A
 * language is a string table (the format below, also what translators edit). Tables are matched by
 * the English text for tab, group and menu names, by command id for labels and tips; anything
 * missing stays in English. Dialogs and messages are in English for now.
 */
import { allCommands } from '../commands/registry';
import { DEFAULT_TABS } from '../ui/ribbonLayout';
import { CLASSIC_MENUS, type ClassicItem } from '../ui/classicMenus';
import { PLAN_COMMANDS } from '../plan.generated';

export interface StringTable {
  format: 'annes-lens-strings';
  version: 1;
  /** BCP 47 code ("es", "pt-BR") and the language's own name ("Español"). */
  language: string;
  name: string;
  /** How the table was made (shown in the Language dialog): "built in", "AI (service, date)", a translator's name. */
  source?: string;
  labels?: Record<string, string>;
  tips?: Record<string, string>;
  tabs?: Record<string, string>;
  groups?: Record<string, string>;
  menus?: Record<string, string>;
}
export type Section = 'labels' | 'tips' | 'tabs' | 'groups' | 'menus';
export const SECTIONS: Section[] = ['labels', 'tips', 'tabs', 'groups', 'menus'];

let current: StringTable | null = null;
// English originals, captured the first time a language other than English is applied.
let english: { labels: Map<string, string>; tips: Map<string, string | undefined>; keywords: Map<string, string | undefined>; tabs: Map<object, string>; menus: Map<object, string> } | null = null;

const walkMenus = (fn: (node: { label: string }) => void) => { const walk = (items: ClassicItem[]) => { for (const it of items) if (typeof it !== 'string') { fn(it); walk(it.items); } }; for (const menus of Object.values(CLASSIC_MENUS)) for (const m of menus) { fn(m); walk(m.items); } };

function capture(): NonNullable<typeof english> {
  if (english) return english;
  const e = { labels: new Map<string, string>(), tips: new Map<string, string | undefined>(), keywords: new Map<string, string | undefined>(), tabs: new Map<object, string>(), menus: new Map<object, string>() };
  for (const c of allCommands()) { e.labels.set(c.id, c.label); e.tips.set(c.id, c.tip); e.keywords.set(c.id, c.keywords); }
  for (const t of DEFAULT_TABS) { e.tabs.set(t, t.label); for (const g of t.groups) e.tabs.set(g, g.label); }
  walkMenus((n) => e.menus.set(n, n.label));
  english = e;
  return e;
}

/** The English source of every translatable string, keyed as a table expects (the translators' template). */
export function englishTable(): StringTable {
  const e = english || capture();
  const t: StringTable = { format: 'annes-lens-strings', version: 1, language: 'xx', name: 'Language name', source: '', labels: {}, tips: {}, tabs: {}, groups: {}, menus: {} };
  for (const [id, l] of e.labels) t.labels![id] = l;
  for (const [id, tip] of e.tips) if (tip) t.tips![id] = tip;
  for (const tab of DEFAULT_TABS) { t.tabs![e.tabs.get(tab)!] = e.tabs.get(tab)!; for (const g of tab.groups) t.groups![e.tabs.get(g)!] = e.tabs.get(g)!; }
  t.tabs!.File = 'File';
  for (const name of e.menus.values()) t.menus![name] = name;
  return t;
}

/** Applies a table (null: English). The caller re-renders the ribbon and menus. */
export function applyStrings(table: StringTable | null): void {
  if (!table && !english) { current = null; return; }
  const e = capture();
  current = table;
  for (const c of allCommands()) {
    const en = e.labels.get(c.id); if (en === undefined) continue;
    c.label = table?.labels?.[c.id] || en;
    c.tip = table?.tips?.[c.id] || e.tips.get(c.id);
    // Command search keeps finding the English names too.
    c.keywords = table ? [e.keywords.get(c.id), en].filter(Boolean).join(' ') : e.keywords.get(c.id);
  }
  for (const t of DEFAULT_TABS) { const en = e.tabs.get(t)!; t.label = table?.tabs?.[en] || en; for (const g of t.groups) { const eg = e.tabs.get(g)!; g.label = table?.groups?.[eg] || eg; } }
  walkMenus((n) => { const en = e.menus.get(n) ?? n.label; n.label = table?.menus?.[en] || en; });
  if (typeof document !== 'undefined') document.documentElement.lang = table?.language || 'en-US';
}
export const currentStrings = (): StringTable | null => current;
/** A UI word outside the command table ("File" on the tab row). */
export const word = (section: Section, en: string): string => (current?.[section] as Record<string, string> | undefined)?.[en] || en;

/** Checks a table read from a file or a service: the right shape, strings only, no unknown keys (returned as warnings). */
export function validateTable(raw: unknown): { table: StringTable | null; problems: string[] } {
  const problems: string[] = [];
  if (!raw || typeof raw !== 'object') return { table: null, problems: ['Not a string table (JSON object expected).'] };
  const r = raw as Record<string, any>;
  if (r.format !== 'annes-lens-strings') problems.push('The "format" is not "annes-lens-strings".');
  if (typeof r.language !== 'string' || !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(r.language) || r.language === 'xx') return { table: null, problems: [...problems, 'Set "language" to a language code such as "es" or "pt-BR".'] };
  const en = englishTable();
  const t: StringTable = { format: 'annes-lens-strings', version: 1, language: r.language, name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : r.language, source: typeof r.source === 'string' ? r.source : undefined };
  for (const s of SECTIONS) {
    const v = r[s]; if (v === undefined) continue;
    if (!v || typeof v !== 'object' || Array.isArray(v)) { problems.push(`"${s}" is not an object.`); continue; }
    // Labels may name commands of the plan that are not built yet (a table can run ahead of the program).
    const out: Record<string, string> = {}, known = s === 'labels' ? { ...PLAN_COMMANDS, ...en.labels } : en[s] || {};
    let unknown = 0;
    for (const [k, x] of Object.entries(v)) { if (typeof x !== 'string' || !x.trim()) continue; if (!(k in known)) { unknown++; continue; } out[k] = x.trim().slice(0, s === 'tips' ? 600 : 120); }
    if (unknown) problems.push(`${unknown} ${s} entr${unknown === 1 ? 'y does' : 'ies do'} not match this version and ${unknown === 1 ? 'was' : 'were'} skipped.`);
    t[s] = out;
  }
  if (!SECTIONS.some((s) => t[s] && Object.keys(t[s]!).length)) return { table: null, problems: [...problems, 'The table has no translated strings.'] };
  return { table: t, problems };
}

/** How complete a table is, per section, against this version's English strings. */
export function coverage(t: StringTable): Record<Section, [number, number]> {
  const en = englishTable();
  return Object.fromEntries(SECTIONS.map((s) => [s, [Object.keys(t[s] || {}).filter((k) => k in (en[s] || {})).length, Object.keys(en[s] || {}).length]])) as Record<Section, [number, number]>;
}
