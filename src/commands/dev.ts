/** Developer tab: macros (recorded command lists), the macro editor, command list export. */
import { def, getCommand, allCommands } from './registry';
import type { App } from '../app';
import type { Macro } from '../prefs';
import { openDialog, toast, confirmDialog, promptDialog } from '../ui/dialog';
import { saveAs } from '../platform/native';

async function runMacro(app: App, name: string): Promise<void> {
  const m = app.prefs.macros.find((x) => x.name === name);
  if (!m) { toast(`No macro named "${name}".`); return; }
  for (const s of m.steps) {
    if (s.id === 'dev.runMacro' && s.arg === name) continue; // never recurse into itself
    if (!getCommand(s.id)) { toast(`Macro "${name}" stopped: the command ${s.id} no longer exists.`); return; }
    const r = app.exec(s.id, s.arg);
    if (r instanceof Promise) await r;
  }
}

function stepsLabel(m: Macro): string {
  return m.steps.map((s) => getCommand(s.id)?.label || s.id).slice(0, 6).join(' → ') + (m.steps.length > 6 ? ' …' : '');
}

def([
  {
    id: 'dev.macros', icon: 'smart_button', noRecord: true,
    tip: 'Run, rename, delete or put a macro on the Quick Access Bar',
    run: async (app) => {
      const ms = app.prefs.macros;
      if (!ms.length) { toast('No macros yet. Use Record Macro to make one.', { action: 'Record', onAction: () => app.exec('dev.recordMacro') }); return; }
      const r = await openDialog({ title: 'Macros', fields: [
        { key: 'm', label: 'Macro', type: 'list', options: ms.map((m) => ({ value: m.name, label: `${m.name} — ${stepsLabel(m)}` })), value: ms[0].name },
        { key: 'act', label: 'Action', type: 'radio', options: [{ value: 'run', label: 'Run' }, { value: 'edit', label: 'Edit…' }, { value: 'rename', label: 'Rename…' }, { value: 'qat', label: 'Add to Quick Access Bar' }, { value: 'delete', label: 'Delete' }], value: 'run' },
      ] });
      if (!r?.m) return;
      const m = ms.find((x) => x.name === r.m)!;
      if (r.act === 'run') await runMacro(app, m.name);
      else if (r.act === 'edit') app.exec('dev.macroEditor', m.name);
      else if (r.act === 'rename') { const n = await promptDialog('Rename Macro', 'Name', m.name); if (n && !ms.some((x) => x.name === n)) { const old = m.name; m.name = n; app.prefs.qat = app.prefs.qat.map((q) => (q === `macro:${old}` ? `macro:${n}` : q)); app.savePrefs(); app.ui.renderQat(); } }
      else if (r.act === 'qat') { if (!app.prefs.qat.includes(`macro:${m.name}`)) app.prefs.qat = [...app.prefs.qat, `macro:${m.name}`]; app.savePrefs(); app.ui.renderQat(); }
      else if (r.act === 'delete' && (await confirmDialog('Delete Macro', `Delete "${m.name}"?`, 'Delete'))) { app.prefs.macros = ms.filter((x) => x !== m); app.prefs.qat = app.prefs.qat.filter((q) => q !== `macro:${m.name}`); app.savePrefs(); app.ui.renderQat(); }
    },
  },
  { id: 'dev.runMacro', label: 'Run Macro', icon: 'play_arrow', tab: 'Developer', internal: true, noRecord: true, run: (app, name: string) => runMacro(app, name) },
  {
    id: 'dev.recordMacro', icon: 'fiber_manual_record', kind: 'toggle', noRecord: true,
    tip: 'Record the commands you run (rotations, zoom, saves) to replay them later',
    isActive: (app) => !!app.recording,
    run: async (app) => {
      if (app.recording) { app.exec('dev.stopRecording'); return; }
      const name = await promptDialog('Record Macro', 'Macro name', `Macro${app.prefs.macros.length + 1}`);
      if (!name) return;
      if (app.prefs.macros.some((m) => m.name === name) && !(await confirmDialog('Record Macro', `Replace the macro "${name}"?`, 'Replace'))) return;
      app.recording = { name, steps: [] };
      app.recordingPaused = false;
      app.ui.status?.('● Recording macro');
    },
  },
  {
    id: 'dev.stopRecording', icon: 'stop', noRecord: true, isEnabled: (app) => !!app.recording,
    run: (app) => {
      const rec = app.recording;
      if (!rec) return;
      app.recording = null;
      app.ui.status?.('');
      if (!rec.steps.length) { toast('Nothing was recorded.'); return; }
      app.prefs.macros = [...app.prefs.macros.filter((m) => m.name !== rec.name), { name: rec.name, steps: rec.steps, created: Date.now() }];
      app.savePrefs();
      toast(`Macro "${rec.name}" saved with ${rec.steps.length} step(s).`, { action: 'Add to QAT', onAction: () => { app.prefs.qat = [...app.prefs.qat, `macro:${rec.name}`]; app.savePrefs(); app.ui.renderQat(); } });
    },
  },
  {
    id: 'dev.macroEditor', icon: 'code', noRecord: true,
    tip: 'Edit a macro\'s steps (one command per line: id and an optional JSON argument)',
    run: async (app, name?: string) => {
      const ms = app.prefs.macros;
      const m = ms.find((x) => x.name === name) || ms[0];
      const text = m ? m.steps.map((s) => (s.arg === undefined ? s.id : `${s.id} ${JSON.stringify(s.arg)}`)).join('\n') : 'image.rotateRight\nfile.save';
      const r = await openDialog({ title: m ? `Edit Macro: ${m.name}` : 'New Macro', wide: true, fields: [
        { key: 'name', label: 'Name', type: 'text', value: m?.name || `Macro${ms.length + 1}` },
        { key: 'desc', label: 'Description', type: 'text', value: m?.description || '' },
        { key: 'steps', label: 'Steps', type: 'textarea', rows: 14, value: text, help: 'Find command ids in Help ▸ Command Reference or the Customize dialogs. Macros run Anne\'s Lens commands only; the JavaScript picture API comes with a later milestone.' },
      ], validate: (v) => {
        for (const [i, line] of String(v.steps).split('\n').entries()) {
          const t = line.trim(); if (!t || t.startsWith('#')) continue;
          const [id, ...rest] = t.split(/\s+/);
          if (!getCommand(id)) return `Line ${i + 1}: unknown command "${id}".`;
          if (rest.length) { try { JSON.parse(rest.join(' ')); } catch { return `Line ${i + 1}: the argument is not valid JSON.`; } }
        }
        return v.name ? null : 'Give the macro a name.';
      } });
      if (!r) return;
      const steps = String(r.steps).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => { const [id, ...rest] = l.split(/\s+/); return rest.length ? { id, arg: JSON.parse(rest.join(' ')) } : { id }; });
      app.prefs.macros = [...ms.filter((x) => x.name !== r.name && x !== m), { name: r.name, description: r.desc || undefined, steps, created: m?.created || Date.now() }];
      app.savePrefs();
      toast(`Saved "${r.name}".`, { action: 'Run', onAction: () => void runMacro(app, r.name) });
    },
  },
  {
    id: 'dev.exportCommands', icon: 'download', noRecord: true, tip: 'Every command as JSON: id, label, tab, group, keys, origin',
    run: async () => {
      const list = allCommands().map((c) => ({ id: c.id, label: c.label, tab: c.tab, group: c.group, keys: c.keys, kind: c.kind, origin: c.origin, notInTabs: c.notInTabs }));
      const r = await saveAs(new Blob([JSON.stringify(list, null, 1)], { type: 'application/json' }), 'annes-lens-commands.json');
      if (r) toast(`Saved ${r.name} (${list.length} commands)`);
    },
  },
]);
