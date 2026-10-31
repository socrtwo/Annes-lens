/** View ▸ Language…: pick the interface language, load or export string tables, or translate with the AI service. */
import { def } from './registry';
import type { App } from '../app';
import { openDialog, toast } from '../ui/dialog';
import { openDocuments, saveAs } from '../platform/native';
import { applyStrings, englishTable, validateTable, coverage, currentStrings, SECTIONS, type StringTable, type Section } from '../i18n/strings';
import { installed, storeTable, removeTable, tableFor, ENGLISH } from '../i18n/languages';
import { askText, withJob, hasText } from '../ai';
import { extractJson } from '../ai/hosted';

const redraw = (app: App) => { app.ui.renderTabs(); app.ui.renderRibbon(); app.ui.applyPrefs(); };
export function useLanguage(app: App, code: string): boolean {
  const t = code === ENGLISH.language ? null : tableFor(code);
  if (code !== ENGLISH.language && !t) return false;
  applyStrings(t);
  app.prefs.language = code; app.savePrefs();
  redraw(app);
  return true;
}
const coverText = (t: StringTable) => { const c = coverage(t); return (['labels', 'tabs', 'groups', 'menus', 'tips'] as Section[]).filter((s) => c[s][1]).map((s) => `${s} ${c[s][0]}/${c[s][1]}`).join(', '); };

/** Translates the English strings with the configured AI service, in batches; returns a table. */
export async function translateWithAi(app: App, lang: { code: string; name: string }, withTips: boolean, onProgress?: (done: number, total: number) => void): Promise<StringTable | null> {
  const en = englishTable();
  const sections: Section[] = withTips ? SECTIONS : SECTIONS.filter((s) => s !== 'tips');
  const batches: { section: Section; items: Record<string, string> }[] = [];
  for (const s of sections) {
    const entries = Object.entries(en[s] || {}), size = s === 'tips' ? 40 : 120;
    for (let i = 0; i < entries.length; i += size) batches.push({ section: s, items: Object.fromEntries(entries.slice(i, i + size)) });
  }
  const out: StringTable = { format: 'annes-lens-strings', version: 1, language: lang.code, name: lang.name, source: '', labels: {}, tips: {}, tabs: {}, groups: {}, menus: {} };
  let service = '';
  const r = await withJob(app, `Translating the interface into ${lang.name}`, async (status, signal) => {
    for (const [i, b] of batches.entries()) {
      status(`Translating into ${lang.name}: ${i + 1} of ${batches.length}`); onProgress?.(i, batches.length);
      const kind = { labels: 'command names (menu items and buttons)', tips: 'tooltips (one sentence each)', tabs: 'ribbon tab names', groups: 'ribbon group names', menus: 'menu names' }[b.section];
      const ans = await askText(app, {
        command: 'view.language', json: true, temperature: 0, maxTokens: 6000,
        system: 'You translate software user interfaces. You keep the meaning, the terms a picture viewer and editor uses in that language, and the length short.',
        prompt: `Translate these ${kind} of a picture viewer and editor from English into ${lang.name} (${lang.code}). Keep a trailing "…", keyboard keys, file formats and abbreviations (JPEG, EXIF, OCR, RAW, PDF, QR), and product names starting with "Anne's" unchanged. Answer with a JSON object that has exactly the same keys and the translations as values.\nSTRINGS:\n${JSON.stringify(b.items)}`,
      }, undefined, signal);
      if (!ans) return null;
      service = ans.service;
      let j: any; try { j = extractJson(ans.text); } catch { throw new Error(`The service did not answer with JSON (batch ${i + 1})`); }
      for (const k of Object.keys(b.items)) if (typeof j?.[k] === 'string' && j[k].trim()) (out[b.section] as Record<string, string>)[k] = j[k].trim();
    }
    onProgress?.(batches.length, batches.length);
    return true;
  });
  if (!r) return null;
  out.source = `AI translation (${service}, ${new Date().toISOString().slice(0, 10)}); check it before relying on it`;
  return out;
}

async function download(t: object, name: string): Promise<void> {
  const r = await saveAs(new Blob([JSON.stringify(t, null, 1)], { type: 'application/json' }), name);
  if (r) toast(`Saved ${r.name}`);
}

def([{
  id: 'view.language', icon: 'translate', noRecord: true, tip: 'The language of the ribbon, the menus and the command names; load or export translation files, or translate with your AI service',
  run: async (app, arg?: string | { action: 'load'; files?: File[] } | { action: 'template' | 'export' | 'remove'; code?: string } | { action: 'ai'; code: string; name: string; tips?: boolean }) => {
    if (typeof arg === 'string') { if (!useLanguage(app, arg)) toast(`The language ${arg} is not installed.`); return; }
    let a = arg;
    if (!a) {
      const list = installed(), cur = app.prefs.language || ENGLISH.language;
      const r = await openDialog({ title: 'Language', ok: 'Use', fields: [
        { key: 'lang', label: 'Interface language', type: 'list', value: cur, options: list.map((x) => ({ value: x.language, label: `${x.name} — ${x.where}${x.table ? ` (${coverText(x.table)})` : ''}` })) },
        { key: 'act', label: 'Or', type: 'radio', value: 'use', options: [
          { value: 'use', label: 'Use the language chosen above' },
          { value: 'load', label: 'Load a translation file (.json)…' },
          { value: 'ai', label: hasText(app) ? 'Translate with the AI service…' : 'Translate with the AI service (set one up in AI ▸ Set Up AI first)' },
          { value: 'template', label: 'Export the English strings as a template for translators…' },
          { value: 'export', label: 'Export the chosen language as a file…' },
          { value: 'remove', label: 'Remove the chosen language from this device' },
        ] },
        { key: 'n', type: 'info', label: 'The ribbon, the menus, the command names and their tooltips change. Dialogs and messages are in English for now. Command search finds commands by their English names too.' },
      ] });
      if (!r) return;
      if (r.act === 'use') { useLanguage(app, String(r.lang)); toast(`Language: ${list.find((x) => x.language === r.lang)?.name}`, { ms: 1500 }); return; }
      if (r.act === 'ai') {
        if (!hasText(app)) { toast('Set up an AI service first (AI ▸ Set Up AI).'); return; }
        const q = await openDialog({ title: 'Translate with the AI Service', ok: 'Translate', fields: [
          { key: 'name', label: 'Language (its own name)', type: 'text', value: 'Deutsch', placeholder: 'Deutsch, Français, Português (Brasil)…' },
          { key: 'code', label: 'Language code', type: 'text', value: 'de', placeholder: 'de, fr, pt-BR, ja…' },
          { key: 'tips', label: 'Tooltips too (about ten times as many requests)', type: 'checkbox', value: false },
          { key: 'n', type: 'info', label: 'The English strings (command names, tab, group and menu names) are sent to your AI service in batches; nothing about your pictures is sent. The result is kept on this device and can be exported and corrected.' },
        ], validate: (v) => (/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(String(v.code).trim()) && String(v.code).trim() !== 'en-US' ? null : 'Use a language code such as de, fr or pt-BR.') });
        if (!q) return;
        a = { action: 'ai', code: String(q.code).trim(), name: String(q.name).trim() || String(q.code).trim(), tips: !!q.tips };
      } else a = { action: r.act, code: String(r.lang) } as any;
    }
    if (!a) return;
    if (a.action === 'template') { await download(englishTable(), 'annes-lens-strings-template.json'); return; }
    if (a.action === 'export') { const t = tableFor(a.code || app.prefs.language) || currentStrings(); if (!t) { toast('English is the source; export the template instead.'); return; } await download(t, `annes-lens-strings-${t.language}.json`); return; }
    if (a.action === 'remove') {
      const code = a.code || app.prefs.language, item = installed().find((x) => x.language === code);
      if (!item || item.where !== 'this device') { toast('Only languages loaded or translated on this device can be removed.'); return; }
      removeTable(code); if (app.prefs.language === code) useLanguage(app, tableFor(code) ? code : ENGLISH.language);
      toast(`Removed ${item.name}.`); return;
    }
    if (a.action === 'load') {
      const files = a.files || (await openDocuments('.json,application/json', ['application/json'], false)).map((f: any) => (f instanceof File ? f : new File([f.data], f.name)));
      if (!files.length) return;
      let raw: unknown; try { raw = JSON.parse(await files[0].text()); } catch { toast(`${files[0].name} is not JSON.`); return; }
      const { table, problems } = validateTable(raw);
      if (!table) { toast(problems.join(' '), { ms: 6000 }); return; }
      storeTable(table); useLanguage(app, table.language);
      toast(`Language: ${table.name} (${coverText(table)})${problems.length ? '. ' + problems.join(' ') : ''}`, { ms: 5000 });
      return;
    }
    if (a.action === 'ai') {
      if (!hasText(app)) { toast('Set up an AI service first (AI ▸ Set Up AI).'); return; }
      const t = await translateWithAi(app, { code: a.code, name: a.name }, !!a.tips);
      if (!t) return;
      const { table, problems } = validateTable(t);
      if (!table) { toast(`The translation came back empty. ${problems.join(' ')}`, { ms: 6000 }); return; }
      storeTable(table); useLanguage(app, table.language);
      toast(`Language: ${table.name} (${coverText(table)}). AI translations can be wrong: export the file to correct it.`, { ms: 6000 });
    }
  },
}]);
