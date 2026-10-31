/**
 * The paint pane (F12) and the Markup Board pane (Ctrl+Shift+D): a floating panel over the picture's
 * top-left corner with the tools and their settings. Keys while it is open: [ and ] change the
 * brush size; with a markup item selected, Delete or Backspace removes it and Esc deselects (the
 * file-delete and previous-picture keys are untouched otherwise).
 */
import type { App } from '../app';
import { h } from '../ui/dom';
import { paint, PAINT_TOOLS, MARKUP_TOOLS, bindApp, deleteSelected, flattenMarkup, editSelectedText, type PaintTool, type MarkupTool } from './session';
import * as M from './markup';
import { toast, confirmDialog } from '../ui/dialog';

const BRUSHY: PaintTool[] = ['brush', 'eraser', 'clone', 'heal', 'redEye', 'colorReplace', 'spray'];

export class PaintBar {
  el: HTMLElement;
  constructor(private app: App) {
    bindApp(app);
    this.el = h('aside', { class: 'qn-paintbar', 'aria-label': 'Paint tools' });
    for (const ev of ['pointerdown', 'wheel', 'dblclick', 'contextmenu']) this.el.addEventListener(ev, (e) => e.stopPropagation());
    paint.onChange = () => { this.render(); app.refresh(); };
    app.onRefresh(() => this.mount());
    window.addEventListener('keydown', (e) => this.key(e), true);
  }
  private key(e: KeyboardEvent): void {
    if (!paint.open || document.querySelector('.ql-dialog')) return;
    const t = e.target as HTMLElement; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (paint.mode === 'markup' && paint.selected && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); e.stopImmediatePropagation(); deleteSelected(this.app); return; }
    if (paint.mode === 'markup' && paint.selected && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); paint.selected = 0; this.app.viewer.draw(); this.render(); return; }
    if (paint.mode === 'paint' && (e.key === '[' || e.key === ']') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopImmediatePropagation(); paint.size = Math.max(1, Math.min(500, Math.round(e.key === ']' ? paint.size * 1.25 + 1 : paint.size / 1.25))); this.render(); this.app.viewer.draw(); }
  }
  show(mode: 'paint' | 'markup'): void { paint.open = true; paint.mode = mode; this.mount(); this.render(); this.app.viewer.draw(); this.app.refresh(); }
  hide(): void { paint.open = false; paint.selected = 0; this.el.remove(); this.app.viewer.draw(); this.app.refresh(); }
  private mount(): void { if (!paint.open) return; const host = this.app.viewer?.el; if (host && this.el.parentElement !== host) { host.appendChild(this.el); this.render(); } }
  render(): void {
    if (!paint.open) return;
    const row = (...kids: (HTMLElement | string)[]) => h('div', { class: 'qn-pb-row' }, ...kids);
    const range = (label: string, min: number, max: number, val: number, set: (v: number) => void, step = 1) => { const out = h('span', { class: 'qn-pb-val' }, String(val)); const inp = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(val), 'aria-label': label, oninput: (ev: Event) => { const v = +(ev.target as HTMLInputElement).value; set(v); out.textContent = String(v); this.app.viewer.draw(); } }); return h('label', { class: 'qn-pb-range' }, h('span', null, label), inp, out); };
    const check = (label: string, val: boolean, set: (v: boolean) => void) => h('label', { class: 'qn-pb-check' }, h('input', { type: 'checkbox', checked: val, onchange: (ev: Event) => { set((ev.target as HTMLInputElement).checked); this.render(); } }), label);
    const color = (label: string, val: string, set: (v: string) => void) => h('label', { class: 'qn-pb-color', title: label }, h('input', { type: 'color', value: val, 'aria-label': label, oninput: (ev: Event) => set((ev.target as HTMLInputElement).value) }));
    const btn = (label: string, onclick: () => void, title = '') => h('button', { class: 'ql-btn', type: 'button', title: title || label, onclick }, label);
    const head = h('div', { class: 'qn-pb-head' },
      h('div', { class: 'qn-pb-tabs' }, ...(['paint', 'markup'] as const).map((m) => h('button', { type: 'button', class: 'qn-pb-tab' + (paint.mode === m ? ' on' : ''), onclick: () => { paint.mode = m; paint.selected = 0; this.render(); this.app.viewer.draw(); this.app.refresh(); } }, m === 'paint' ? 'Paint' : 'Markup'))),
      h('button', { class: 'ql-iconbtn', type: 'button', 'aria-label': 'Close', onclick: () => this.hide() }, '×'));
    const body: HTMLElement[] = [];
    if (paint.mode === 'paint') {
      body.push(h('div', { class: 'qn-pb-tools' }, ...PAINT_TOOLS.map((t) => h('button', { type: 'button', class: 'qn-pb-tool' + (paint.tool === t.id ? ' on' : ''), title: t.label, 'aria-label': t.label, 'data-tool': t.id, onclick: () => { paint.tool = t.id; this.render(); this.app.viewer.draw(); this.app.refresh(); } }, h('span', { class: 'material-symbols-outlined' }, t.icon)))));
      body.push(h('div', { class: 'qn-pb-name' }, PAINT_TOOLS.find((t) => t.id === paint.tool)!.label));
      body.push(row(color('Color', paint.color, (v) => { paint.color = v; }), color('Secondary color', paint.color2, (v) => { paint.color2 = v; }), btn('⇄', () => { [paint.color, paint.color2] = [paint.color2, paint.color]; this.render(); }, 'Swap the colors')));
      if (paint.tool !== 'colorPicker' && paint.tool !== 'fill' && paint.tool !== 'text') body.push(range(paint.tool === 'spray' ? 'Radius' : 'Size', 1, 300, paint.size, (v) => { paint.size = v; }));
      if (paint.tool !== 'colorPicker' && paint.tool !== 'redEye' && paint.tool !== 'colorReplace') body.push(range('Opacity', 1, 100, paint.opacity, (v) => { paint.opacity = v; }));
      if (BRUSHY.includes(paint.tool) && paint.tool !== 'spray') body.push(range('Hardness', 0, 100, paint.hardness, (v) => { paint.hardness = v; }));
      if (paint.tool === 'rect' || paint.tool === 'ellipse') body.push(check('Filled', paint.fillShapes, (v) => { paint.fillShapes = v; }));
      if (paint.tool === 'fill' || paint.tool === 'colorReplace') body.push(range('Tolerance', 0, 255, paint.tolerance, (v) => { paint.tolerance = v; }));
      if (paint.tool === 'fill') body.push(check('Only the connected area', paint.contiguous, (v) => { paint.contiguous = v; }));
      if (paint.tool === 'eraser') body.push(check('Erase to transparency (off: to the secondary color)', paint.eraseToTransparent, (v) => { paint.eraseToTransparent = v; }));
      if (paint.tool === 'clone' || paint.tool === 'heal') body.push(row(btn(paint.settingSource ? 'Click the source…' : 'Set source', () => { paint.settingSource = true; this.render(); }, 'Or Alt+click on the picture'), h('span', { class: 'ql-help' }, paint.cloneSource ? `Source ${Math.round(paint.cloneSource[0])}, ${Math.round(paint.cloneSource[1])}` : 'No source yet')));
      body.push(h('p', { class: 'ql-help' }, ({ colorPicker: 'Click to pick the color; Shift+click picks the secondary color.', fill: 'Click an area to fill it.', text: 'Click where the text starts.', clone: 'Alt+click the source, then paint.', heal: 'Alt+click a clean area, then paint over the blemish.', redEye: 'Paint over the red pupils.', colorReplace: 'Start on the color to replace; it takes the paint color.', line: 'Drag.', arrow: 'Drag from the tail to the tip.', rect: 'Drag.', ellipse: 'Drag.' } as Record<string, string>)[paint.tool] || 'Drag to paint. [ and ] change the size; each stroke is one Undo.'));
    } else {
      const items = M.itemsOf(this.app.picture);
      body.push(h('div', { class: 'qn-pb-tools' }, ...MARKUP_TOOLS.map((t) => h('button', { type: 'button', class: 'qn-pb-tool' + (paint.markupTool === t.id ? ' on' : ''), title: t.label, 'aria-label': t.label, 'data-mtool': t.id, onclick: () => { paint.markupTool = t.id as MarkupTool; if (t.id !== 'select') paint.selected = 0; this.render(); this.app.viewer.draw(); } }, h('span', { class: 'material-symbols-outlined' }, t.icon)))));
      body.push(h('div', { class: 'qn-pb-name' }, MARKUP_TOOLS.find((t) => t.id === paint.markupTool)!.label));
      body.push(row(color('Color', paint.markupColor, (v) => { paint.markupColor = v; const it = items.find((i) => i.id === paint.selected); if (it) { it.color = v; this.app.viewer.draw(); } })));
      body.push(range('Width', 1, 40, paint.markupWidth, (v) => { paint.markupWidth = v; const it = items.find((i) => i.id === paint.selected); if (it) { it.width = v; } }));
      if (paint.markupTool === 'rect' || paint.markupTool === 'ellipse') body.push(check('Tinted fill', paint.markupFill, (v) => { paint.markupFill = v; }));
      const sel = items.find((i) => i.id === paint.selected);
      body.push(row(btn('Edit text', () => editSelectedText(this.app)), btn('Delete', () => { if (!deleteSelected(this.app)) toast('Select an item first (Select and Move).'); })));
      body.push(row(btn('Undo', () => { const p = this.app.picture; if (p && M.undoMarkup(p)) { paint.selected = 0; this.app.viewer.draw(); this.render(); } else toast('Nothing to undo in the markup.'); }), btn('Clear', async () => { const p = this.app.picture; if (p && items.length && (await confirmDialog('Clear markup?', `${items.length} item${items.length === 1 ? '' : 's'} will be removed.`, 'Clear'))) { M.clearBoard(p); paint.selected = 0; this.app.viewer.draw(); this.render(); } }), btn('Flatten', () => { if (!flattenMarkup(this.app)) toast('No markup to flatten.'); }, 'Draw the markup into the picture (one Undo)')));
      body.push(h('p', { class: 'ql-help' }, `${items.length} item${items.length === 1 ? '' : 's'}${sel ? `; ${sel.kind} selected (Delete removes it)` : ''}. Markup stays editable until you flatten it; saving asks.`));
    }
    this.el.replaceChildren(head, ...body);
  }
}

let bar: PaintBar | null = null;
export const paintBar = (app: App): PaintBar => (bar ??= new PaintBar(app));
