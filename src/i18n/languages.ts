/**
 * The installed interface languages: English, the built-in tables, and tables loaded from files or
 * made with the AI service on this device (kept in local storage).
 */
import { applyStrings, validateTable, type StringTable } from './strings';
import ES from './es.json';

export const ENGLISH = { language: 'en-US', name: 'English (United States)' };
export const BUILT_IN: StringTable[] = [ES as StringTable];
const STORE = 'quilllens.strings.v1';

export function storedTables(): StringTable[] {
  try { const raw = JSON.parse(localStorage.getItem(STORE) || '[]'); return Array.isArray(raw) ? raw.map((t) => validateTable(t).table).filter((t): t is StringTable => !!t) : []; } catch { return []; }
}
/** Saves (or replaces) a table on this device. */
export function storeTable(t: StringTable): void {
  const list = storedTables().filter((x) => x.language !== t.language);
  list.push(t);
  try { localStorage.setItem(STORE, JSON.stringify(list)); } catch { throw new Error('There is no room to keep this language on this device.'); }
}
export function removeTable(code: string): void { try { localStorage.setItem(STORE, JSON.stringify(storedTables().filter((x) => x.language !== code))); } catch { /* */ } }

/** Every language a user can pick: device tables override built-in ones with the same code. */
export function installed(): { language: string; name: string; table: StringTable | null; where: 'built in' | 'this device' | 'English' }[] {
  const device = storedTables();
  return [
    { ...ENGLISH, table: null, where: 'English' as const },
    ...BUILT_IN.filter((b) => !device.some((d) => d.language === b.language)).map((t) => ({ language: t.language, name: t.name, table: t, where: 'built in' as const })),
    ...device.map((t) => ({ language: t.language, name: t.name, table: t, where: 'this device' as const })),
  ];
}
export function tableFor(code: string): StringTable | null { return installed().find((x) => x.language === code)?.table ?? null; }
/** Applies the preferred language at start-up (before the ribbon is drawn). */
export function applyPreferred(code: string): void { const t = code && code !== ENGLISH.language ? tableFor(code) : null; applyStrings(t); }
