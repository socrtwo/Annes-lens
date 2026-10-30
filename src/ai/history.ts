/** AI History: what was sent where, the prompt, the result, the time taken (localStorage). */
export interface HistoryEntry { id: string; time: string; command: string; service: string; model: string; prompt?: string; input?: string; result: string; ms: number; thumb?: string }
const KEY = 'annes-lens.ai.history.v1';
export function readHistory(): HistoryEntry[] { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
export function addHistory(e: Omit<HistoryEntry, 'id' | 'time'>, max = 200): HistoryEntry {
  const entry: HistoryEntry = { id: Math.random().toString(36).slice(2, 10), time: new Date().toISOString(), ...e };
  const all = [entry, ...readHistory()].slice(0, Math.max(0, max));
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* full */ }
  return entry;
}
export function clearHistory(): void { try { localStorage.removeItem(KEY); } catch { /* */ } }
