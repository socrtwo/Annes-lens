import { describe, expect, it, afterEach } from 'vitest';
import '../../src/commands';
import { getCommand, allCommands, searchCommands } from '../../src/commands/registry';
import { DEFAULT_TABS } from '../../src/ui/ribbonLayout';
import { CLASSIC_MENUS } from '../../src/ui/classicMenus';
import { applyStrings, englishTable, validateTable, coverage, word } from '../../src/i18n/strings';
import { BUILT_IN, installed, storeTable, tableFor, removeTable } from '../../src/i18n/languages';
import { PLAN_COMMANDS } from '../../src/plan.generated';

const es = BUILT_IN.find((t) => t.language === 'es')!;
afterEach(() => { applyStrings(null); try { localStorage.clear(); } catch { /* */ } });

describe('interface languages', () => {
  it('the template holds every built command, tab, group and menu name in English', () => {
    const t = englishTable();
    expect(Object.keys(t.labels!).length).toBe(allCommands().length);
    expect(t.labels!['file.open']).toBe('Open…');
    expect(t.tabs!.File).toBe('File'); expect(t.groups!['Color management']).toBe('Color management'); expect(t.menus!['Open as']).toBe('Open as');
  });
  it('the built-in Spanish table covers everything except tooltips and is well formed', () => {
    const { table, problems } = validateTable(es);
    expect(problems).toEqual([]);
    const c = coverage(table!);
    for (const s of ['labels', 'tabs', 'groups', 'menus'] as const) expect(c[s][0]).toBe(c[s][1]);
    for (const id of Object.keys(es.labels!)) expect(PLAN_COMMANDS[id]).toBeTruthy();
    // A trailing ellipsis (a command that asks first) survives translation.
    for (const [id, v] of Object.entries(es.labels!)) expect(v.endsWith('…')).toBe(PLAN_COMMANDS[id].label.endsWith('…'));
  });
  it('applies to commands, tabs, groups and menus, keeps English searchable, and switches back', () => {
    applyStrings(es);
    expect(getCommand('file.open')!.label).toBe('Abrir…');
    expect(getCommand('image.rotateRight')!.label).toBe('Girar a la derecha');
    expect(DEFAULT_TABS.find((t) => t.id === 'view')!.label).toBe('Ver');
    expect(DEFAULT_TABS.find((t) => t.id === 'image')!.groups.find((g) => g.id === 'color-management')!.label).toBe('Gestión del color');
    expect(CLASSIC_MENUS.irfanview[0].label).toBe('Archivo');
    expect(word('tabs', 'File')).toBe('Archivo');
    expect(document.documentElement.lang).toBe('es');
    expect(searchCommands('rotate right').some((c) => c.id === 'image.rotateRight')).toBe(true);
    expect(searchCommands('girar derecha').some((c) => c.id === 'image.rotateRight')).toBe(true);
    applyStrings(null);
    expect([getCommand('file.open')!.label, DEFAULT_TABS.find((t) => t.id === 'view')!.label, CLASSIC_MENUS.irfanview[0].label, word('tabs', 'File')]).toEqual(['Open…', 'View', 'File', 'File']);
    expect(searchCommands('girar derecha').some((c) => c.id === 'image.rotateRight')).toBe(false);
  });
  it('validates loaded tables', () => {
    expect(validateTable({ format: 'annes-lens-strings', language: 'xx', labels: { 'file.open': 'X' } }).table).toBeNull();
    expect(validateTable('nope').table).toBeNull();
    const { table, problems } = validateTable({ format: 'annes-lens-strings', version: 1, language: 'de', name: 'Deutsch', labels: { 'file.open': ' Öffnen… ', 'no.such': 'x', 'file.save': 7 }, tips: 'bad' });
    expect(table!.labels).toEqual({ 'file.open': 'Öffnen…' });
    expect(problems).toEqual(['1 labels entry does not match this version and was skipped.', '"tips" is not an object.']);
    expect(validateTable({ format: 'annes-lens-strings', language: 'de', labels: {} }).table).toBeNull();
  });
  it('keeps device tables, which override built-in ones', () => {
    const de = validateTable({ format: 'annes-lens-strings', language: 'de', name: 'Deutsch', labels: { 'file.open': 'Öffnen…' } }).table!;
    storeTable(de);
    expect(installed().map((x) => `${x.language}:${x.where}`)).toEqual(['en-US:English', 'es:built in', 'de:this device']);
    storeTable({ ...es, name: 'Español (mío)', labels: { 'file.open': 'Abrir archivo…' } });
    expect(installed().map((x) => `${x.language}:${x.where}`)).toEqual(['en-US:English', 'de:this device', 'es:this device']);
    expect(tableFor('es')!.labels!['file.open']).toBe('Abrir archivo…');
    removeTable('es'); expect(tableFor('es')!.labels!['file.open']).toBe('Abrir…');
  });
});
