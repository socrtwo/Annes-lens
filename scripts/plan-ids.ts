/** Command ids planned in docs/COMMANDS-PLAN.md (explicit ids only; `id(arg)` counts as `id`). */
export function plannedIds(md: string): string[] {
  const ids = new Set<string>();
  for (const m of md.matchAll(/`([a-z][a-z0-9]*\.[A-Za-z0-9.]+)(?:\([^)`]*\))?`/g)) {
    const id = m[1].replace(/\.$/, '');
    if (id.endsWith('.*')) continue;
    ids.add(id);
  }
  return [...ids].sort();
}
