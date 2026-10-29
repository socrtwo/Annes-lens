import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import '../../src/commands/index';
import { allCommands, getCommand } from '../../src/commands/registry';
import { DEFAULT_TABS, BACKSTAGE_ITEMS, idsInTabs } from '../../src/ui/ribbonLayout';
import { QAT_STANDARD, QAT_CHOICES, DEFAULT_QAT, addAllQatChoices, defaultPrefs } from '../../src/prefs';
import { CLASSIC_MENUS, classicIds, DEFAULT_LAYOUT } from '../../src/ui/classicMenus';
import { PLAN_COMMANDS, PLAN_TABS, PLAN_LAYOUTS, PLAN_COMMAND_COUNT } from '../../src/plan.generated';
import { canonicalKey } from '../../src/util/keys';
import { catalog } from '../../scripts/catalog';

const plan = JSON.parse(readFileSync('docs/commands-plan.json', 'utf8'));
const label = (id: string) => getCommand(id)?.label;

describe('the plan and the registry', () => {
  it('src/plan.generated.ts matches docs/commands-plan.json (run npm run plan)', () => {
    expect(Object.keys(PLAN_COMMANDS).sort()).toEqual(Object.keys(plan.commands).sort());
    expect(PLAN_COMMAND_COUNT).toBe(Object.keys(plan.commands).length);
    expect(PLAN_TABS.map((t) => t.name)).toEqual(plan.tabs.map((t: any) => t.name));
    expect(Object.keys(PLAN_LAYOUTS)).toEqual(Object.keys(plan.menuLayouts));
    for (const [id, c] of Object.entries(plan.commands) as [string, any][]) expect(PLAN_COMMANDS[id].label, id).toBe(c.label);
  });

  it('every registered command is in the plan, with the plan\'s label, tab and group', () => {
    for (const c of allCommands()) {
      const p = plan.commands[c.id];
      expect(p, `${c.id} is not in docs/commands-plan.json`).toBeTruthy();
      expect(c.label, c.id).toBe(p.label);
      expect(c.tab, c.id).toBe(p.tab);
      expect(c.group, c.id).toBe(p.group);
    }
  });

  it('every command has a label, an icon and a tab, and ids follow area.name', () => {
    for (const c of allCommands()) {
      expect(c.label, c.id).toBeTruthy();
      expect(c.icon, c.id).toBeTruthy();
      expect(c.tab, c.id).toBeTruthy();
      expect(c.id, c.id).toMatch(/^[a-z][a-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/);
    }
  });

  it('default shortcuts are the plan\'s, and each key belongs to one command (context-shared pairs aside)', () => {
    const shared = new Set(['Escape', 'Space']);
    const by = new Map<string, string[]>();
    for (const c of allCommands()) {
      const planned = PLAN_COMMANDS[c.id].keys;
      expect(c.keys, c.id).toEqual(planned);
      for (const k of c.keys || []) { const ck = canonicalKey(k); by.set(ck, [...(by.get(ck) || []), c.id]); }
    }
    const clashes = [...by].filter(([k, ids]) => ids.length > 1 && !shared.has(k)).map(([k, ids]) => `${k}: ${ids.join(', ')}`);
    expect(clashes).toEqual([]);
  });

  it('the ribbon mirrors the plan: every plan tab, every group, in order, plus the Home tab', () => {
    expect(DEFAULT_TABS[0].id).toBe('home');
    expect(DEFAULT_TABS.slice(1).map((t) => t.label)).toEqual(plan.tabs.map((t: any) => t.name));
    for (const [i, t] of plan.tabs.entries()) expect(DEFAULT_TABS[i + 1].groups.map((g) => g.items)).toEqual(t.groups.map((g: any) => g.commands.filter((id: string) => !plan.commands[id].notInTabs)));
    expect(DEFAULT_TABS[0].groups.map((g) => g.items)).toEqual(plan.homeTab.map((g: any) => g.commands));
  });

  it('every id the ribbon, the backstage, the Quick Access Bar and the classic layouts name is planned', () => {
    const planned = new Set(Object.keys(plan.commands));
    for (const id of [...idsInTabs(), ...BACKSTAGE_ITEMS, ...DEFAULT_QAT, ...QAT_CHOICES, ...classicIds()]) expect(planned.has(id), id).toBe(true);
  });

  it('every id the UI executes directly exists', () => {
    for (const id of ['file.openDropped', 'file.open', 'file.openFolder', 'file.openRecent', 'file.saveAs', 'file.close', 'file.newWindow', 'file.options', 'edit.pasteAsNew', 'view.next', 'view.previous', 'view.gotoIndex', 'view.fullScreen', 'view.cmdSearch', 'view.qatAddAll', 'view.qatPosition', 'view.qatShow', 'view.collapseRibbon', 'view.zoomIn', 'view.zoomOut', 'view.fitWindow', 'view.actualSize', 'view.menuMode', 'image.info', 'meta.exif', 'help.menuMap', 'help.about', 'dev.stopRecording', 'dev.runMacro']) expect(getCommand(id), id).toBeTruthy();
  });

  it('classic layouts: IrfanView is the default and every layout has a Help menu and built commands', () => {
    expect(DEFAULT_LAYOUT).toBe('irfanview');
    expect(defaultPrefs().menuLayout).toBe('irfanview');
    for (const [key, menus] of Object.entries(CLASSIC_MENUS)) {
      const names = menus.map((m) => m.label);
      expect(names, key).toContain('Help');
      const built = [...classicIds(key)].filter((id) => getCommand(id));
      expect(built.length, `${key} has too few built commands`).toBeGreaterThan(5);
    }
  });

  it('reports milestone coverage of the plan', () => {
    const done = Object.keys(plan.commands).filter((id) => getCommand(id));
    expect(done.length).toBeGreaterThan(70);
    // M1 commands that must exist.
    for (const id of ['file.open', 'file.openFolder', 'file.openRecent', 'file.save', 'file.saveAs', 'file.exportSettings', 'file.portableMode', 'file.customizeQat', 'file.customizeRibbon', 'file.customizeKeyboard', 'view.next', 'view.previous', 'view.zoomIn', 'view.zoomOut', 'view.fitWindow', 'view.actualSize', 'view.fullScreen', 'view.menuMode', 'view.menuLayout', 'view.qatAddAll', 'view.cmdSearch', 'image.info', 'image.rotateLeft', 'image.rotateRight', 'image.flipH', 'image.flipV', 'meta.exif', 'pages.next', 'frames.play', 'dev.recordMacro', 'help.menuMap']) expect(getCommand(id), id).toBeTruthy();
  });

  it('docs/COMMANDS.md is up to date (run npm run catalog)', () => {
    expect(existsSync('docs/COMMANDS.md')).toBe(true);
    expect(readFileSync('docs/COMMANDS.md', 'utf8')).toBe(catalog());
  });
});

describe('Quick Access Bar choices', () => {
  it('every drop-down choice is planned, and the built ones are registered', () => {
    for (const id of QAT_CHOICES) expect(plan.commands[id], id).toBeTruthy();
    for (const id of DEFAULT_QAT) expect(getCommand(id), id).toBeTruthy();
  });

  it('covers the suite standard choices that apply to a picture viewer', () => {
    for (const id of ['edit.pasteAsNew', 'file.open', 'file.save', 'file.email', 'file.quickPrint', 'file.print', 'edit.undo', 'edit.redo', 'view.touchMode', 'file.openRecent']) expect(QAT_STANDARD).toContain(id);
  });

  it('Add All gives Save and Print first, then the built choices A–Z', () => {
    const out = addAllQatChoices(DEFAULT_QAT, label);
    expect(out.slice(0, 2)).toEqual(['file.save', 'file.print']);
    const rest = out.slice(2).filter((id) => QAT_CHOICES.includes(id));
    const labels = rest.map((id) => label(id)!.toLowerCase());
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
    expect(addAllQatChoices(out, label)).toEqual(out);
  });

  it('Add All keeps other items after the choices', () => {
    const out = addAllQatChoices([...DEFAULT_QAT, '|', 'macro:x'], (id) => (id === 'macro:x' ? 'x' : label(id)));
    expect(out.slice(-2)).toEqual(['|', 'macro:x']);
  });
});
