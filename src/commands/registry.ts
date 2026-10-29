/**
 * Command registry.
 *
 * Every user-facing action in Anne's Lens is a Command. The ribbon tabs, the classic menu bar, the Quick
 * Access Bar, context menus, keyboard shortcuts, the command search palette, macros and the customization
 * dialogs all reference commands by id, so anything that exists in the app can be placed anywhere.
 *
 * Commands are data, and the plan is the source of that data: docs/commands-plan.json (generated into
 * src/plan.generated.ts) fixes every command's id, label, tab, group and default shortcuts. A module that
 * registers a command gives its id, icon and behavior; label, tab, group and keys come from the plan unless
 * the module overrides them, and a unit test fails when a registered id is not in the plan.
 */
import type { App } from '../app';
import { PLAN_COMMANDS, PLAN_ORIGINS } from '../plan.generated';

export type CommandKind = 'button' | 'toggle' | 'menu' | 'split' | 'color' | 'gallery' | 'combo' | 'size';

export interface MenuEntry {
  id?: string;           // command id to run
  arg?: any;             // argument passed to the command
  label?: string;        // override label
  icon?: string;
  separator?: boolean;
  checked?: boolean;
  swatch?: string;       // color swatch preview
  preview?: string;      // inline CSS for a preview label
  submenu?: MenuEntry[];
  heading?: string;      // section heading inside a menu
}

export interface Command {
  id: string;
  label: string;
  icon?: string;
  /** Primary tab (category) used by the chooser: "File", "Edit", "Image", … */
  tab: string;
  group?: string;
  keys?: string[];
  tip?: string;
  kind?: CommandKind;
  run: (app: App, arg?: any) => unknown;
  isActive?: (app: App) => boolean;
  isEnabled?: (app: App) => boolean;
  /** Menu entries for menu/split/gallery commands. */
  menu?: (app: App) => MenuEntry[];
  /** Do not record while recording a macro (navigation, UI toggles). */
  noRecord?: boolean;
  /** Changes the picture (undoable through the tab's history). */
  edits?: boolean;
  /** Where the idea comes from (nominative use; see docs/LEGAL.md). Filled from the plan's origins. */
  origin?: string;
  /** Popular commands appear in the default chooser list. */
  popular?: boolean;
  /** Internal commands are hidden from choosers and need not be in the plan. */
  internal?: boolean;
  /** Free-text search keywords. */
  keywords?: string;
  /** Current value shown by combo/size boxes (e.g. the zoom level). */
  value?: (app: App) => string | number | null;
  /** True when the plan lists the command as "not in tabs". */
  notInTabs?: boolean;
}

/** What a module gives; the rest is filled from the plan. */
export type CommandDef = Omit<Command, 'label' | 'tab'> & { label?: string; tab?: string };

const registry = new Map<string, Command>();

function originText(codes: string[]): string {
  return codes.map((c) => (c === 'NEW' ? 'new in Anne\'s Lens' : c === 'SUITE' ? 'the Anne\'s Office suite' : c === 'ALL' ? 'most picture viewers' : PLAN_ORIGINS[c]?.name || c)).join(', ');
}

export function def(c: CommandDef | CommandDef[]): void {
  const list = Array.isArray(c) ? c : [c];
  for (const d of list) {
    if (registry.has(d.id)) console.warn(`Duplicate command id ${d.id}`);
    const p = PLAN_COMMANDS[d.id];
    if (!p && !d.internal) console.warn(`Command ${d.id} is not in docs/commands-plan.json`);
    const cmd: Command = {
      ...d,
      label: d.label ?? p?.label ?? d.id,
      tab: d.tab ?? p?.tab ?? 'Tools',
      group: d.group ?? p?.group,
      keys: d.keys ?? (p ? [...p.keys] : []),
      origin: d.origin ?? (p?.origins.length ? originText(p.origins) : undefined),
      notInTabs: d.notInTabs ?? p?.notInTabs ?? false,
      keywords: [d.keywords, p?.notes].filter(Boolean).join(' ') || undefined,
    };
    registry.set(cmd.id, cmd);
  }
}

export function getCommand(id: string): Command | undefined {
  const c = registry.get(id);
  if (c) return c;
  if (id.startsWith('macro:')) {
    const name = id.slice(6);
    return { id, label: name, icon: 'smart_button', tab: 'Macros', group: 'Macros', noRecord: true, run: (app) => app.exec('dev.runMacro', name) };
  }
  return undefined;
}

export function allCommands(): Command[] {
  return [...registry.values()].filter((c) => !c.internal);
}

export function commandCount(): number {
  return allCommands().length;
}

/** The plan's label for an id, whether or not the command exists yet (menus and the menu map use it). */
export function plannedLabel(id: string): string | undefined {
  return registry.get(id)?.label ?? PLAN_COMMANDS[id]?.label;
}

export function searchCommands(q: string, limit = 60): Command[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const scored: { c: Command; s: number }[] = [];
  for (const c of allCommands()) {
    const hay = `${c.label} ${c.tab} ${c.group || ''} ${c.keywords || ''} ${c.tip || ''} ${c.id}`.toLowerCase();
    let s = 0;
    let ok = true;
    for (const t of terms) {
      const i = hay.indexOf(t);
      if (i < 0) { ok = false; break; }
      s += i === 0 ? 10 : c.label.toLowerCase().startsWith(t) ? 8 : c.label.toLowerCase().includes(t) ? 5 : 1;
    }
    if (ok) scored.push({ c, s });
  }
  scored.sort((a, b) => b.s - a.s || a.c.label.localeCompare(b.c.label));
  return scored.slice(0, limit).map((x) => x.c);
}
