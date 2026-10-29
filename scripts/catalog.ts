/** Builds docs/COMMANDS.md from the live command registry and the plan: what is built, what is still planned. */
import '../src/commands';
import { allCommands, getCommand } from '../src/commands/registry';
import { DEFAULT_TABS, idsInTabs } from '../src/ui/ribbonLayout';
import { PLAN_COMMANDS, PLAN_TABS, PLAN_LAYOUTS } from '../src/plan.generated';
import { classicIds } from '../src/ui/classicMenus';

export function catalog(): string {
  const cmds = allCommands();
  const inTabs = idsInTabs();
  const planned = Object.keys(PLAN_COMMANDS);
  const missing = planned.filter((id) => !getCommand(id));
  const key = (k: string) => k.replace(/Mod/g, 'Ctrl').replace(/-/g, '+').replace(/\+\+$/, '+-');
  const lines: string[] = [];
  lines.push('# Anne\'s Lens Command Reference', '');
  lines.push(`Anne's Lens has **${cmds.length} commands** built, out of the **${planned.length}** in the plan ([COMMANDS-PLAN.md](COMMANDS-PLAN.md)). Every built command can be placed on the Quick Access Bar, added to a custom tab, found in the classic menus, bound to a keyboard shortcut, recorded in a macro, or found with command search (Alt+Q). A command is registered only when it works; the rest of the plan is listed at the end of this file.`, '');
  lines.push(`${cmds.filter((c) => !inTabs.has(c.id)).length} of the built commands are "Commands Not in the Tabs" (reachable through the Quick Access Bar chooser, Customize Tabs, the classic menus and command search), so nothing the app can do is hidden.`, '');
  lines.push('This file is generated from the source by `npm run catalog`; a unit test fails when it is out of date.', '');
  lines.push('## Ribbon', '');
  lines.push('The ribbon mirrors the plan: one tab per plan tab and one group per plan group, in the plan\'s order, plus the Home tab. Groups that have no built command yet are not shown.', '');
  for (const t of DEFAULT_TABS) {
    const built = t.groups.map((g) => ({ g, n: g.items.filter((id) => getCommand(id)).length })).filter((x) => x.n);
    if (built.length) lines.push(`- **${t.label}**${t.contextual ? ' (contextual)' : ''}: ${built.map((x) => `${x.g.label} (${x.n})`).join(' · ')}`);
  }
  lines.push('');
  lines.push('## Classic menu layouts', '');
  lines.push('| Layout | Modeled on | Built commands on the bar |', '|---|---|---|');
  for (const [k, L] of Object.entries(PLAN_LAYOUTS)) lines.push(`| ${L.name} (\`${k}\`) | ${L.modeledOn} | ${[...classicIds(k)].filter((id) => getCommand(id)).length} |`);
  lines.push('');
  for (const t of PLAN_TABS) {
    const list = cmds.filter((c) => c.tab === t.name).sort((a, b) => t.groups.findIndex((g) => g.name === a.group) - t.groups.findIndex((g) => g.name === b.group) || a.label.localeCompare(b.label));
    if (!list.length) continue;
    lines.push(`## ${t.name} (${list.length} of ${t.groups.reduce((s, g) => s + g.commands.length, 0)})`, '', '| Command | Group | Shortcut | ID | Notes |', '|---|---|---|---|---|');
    for (const c of list) lines.push(`| ${c.label.replace(/\|/g, '\\|')} | ${c.group || ''} | ${(c.keys || []).map(key).join(', ')} | \`${c.id}\` | ${[c.kind === 'menu' || c.kind === 'split' ? 'has options menu' : '', c.notInTabs ? 'not in tabs' : '', c.origin ? `from ${c.origin}` : ''].filter(Boolean).join('; ')} |`);
    lines.push('');
  }
  lines.push(`## Planned, not yet built (${missing.length})`, '');
  lines.push('These ids are in the plan but have no command yet; they belong to later milestones ([ROADMAP.md](ROADMAP.md)). Nothing below is a placeholder in the app.', '');
  for (const t of PLAN_TABS) {
    const ids = t.groups.flatMap((g) => g.commands).filter((id) => !getCommand(id));
    if (ids.length) lines.push(`- **${t.name}** (${ids.length}): ${ids.map((i) => `\`${i}\``).join(', ')}`);
  }
  lines.push('');
  return lines.join('\n');
}
