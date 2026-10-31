/** Edit ▸ Paint Tools (F12) with its fifteen tools, Markup Board (Ctrl+Shift+D) and Flatten Markup. */
import { def, type CommandDef } from './registry';
import type { App } from '../app';
import { paintBar } from '../paint/bar';
import { paint, PAINT_TOOLS, flattenMarkup } from '../paint/session';
import { itemsOf } from '../paint/markup';
import { toast } from '../ui/dialog';

const has = (app: App) => !!app.picture;
const ID: Record<string, string> = { brush: 'paint.brush', pencil: 'paint.pencil', line: 'paint.line', arrow: 'paint.arrow', rect: 'paint.rect', ellipse: 'paint.ellipse', text: 'paint.text', eraser: 'paint.eraser', fill: 'paint.fill', spray: 'paint.spray', clone: 'paint.clone', heal: 'paint.heal', redEye: 'paint.redEye', colorReplace: 'paint.colorReplace', colorPicker: 'paint.colorPicker' };
const TIPS: Record<string, string> = {
  brush: 'Soft round brush: size, opacity and hardness; no build-up where strokes overlap', pencil: 'Hard square tip, no smoothing (pixel art, fixes)', line: 'A straight line', arrow: 'A line with a filled arrowhead',
  rect: 'A rectangle, outlined or filled', ellipse: 'An ellipse, outlined or filled', text: 'Text at a point: font, size, bold, light outline', eraser: 'To transparency, or to the secondary color',
  fill: 'Fills the area of similar color (tolerance; connected area or everywhere)', spray: 'An airbrush spray of dots', clone: 'Copies from a source point (Alt+click) as you paint',
  heal: 'Clone that matches the tone of the area painted (blemishes, dust, scratches)', redEye: 'Paint over red pupils to neutralize them', colorReplace: 'Repaints one color with the paint color, keeping the shading',
  colorPicker: 'Picks a color from the picture (Shift: the secondary color)',
};

def([
  { id: 'edit.paint', icon: 'brush', kind: 'toggle', noRecord: true, isEnabled: has, isActive: () => paint.open && paint.mode === 'paint', tip: 'The paint pane: brush, pencil, shapes, text, eraser, fill, spray, clone, heal, red-eye, color replacer, color picker', run: (app) => { const b = paintBar(app); if (paint.open && paint.mode === 'paint') b.hide(); else b.show('paint'); } },
  { id: 'edit.markup', icon: 'draw', kind: 'toggle', noRecord: true, isEnabled: has, isActive: () => paint.open && paint.mode === 'markup', tip: 'Arrows, lines, shapes, highlighter, text, numbered steps and callouts over the picture; editable until flattened', run: (app) => { const b = paintBar(app); if (paint.open && paint.mode === 'markup') b.hide(); else b.show('markup'); } },
  { id: 'edit.flattenMarkup', icon: 'layers_clear', edits: true, isEnabled: (app) => itemsOf(app.picture).length > 0, tip: 'Draws the markup into the picture (one Undo)', run: (app) => { if (!flattenMarkup(app)) toast('No markup to flatten.'); } },
  ...PAINT_TOOLS.map((t): CommandDef => ({ id: ID[t.id], icon: t.icon, kind: 'toggle', noRecord: true, isEnabled: has, isActive: () => paint.open && paint.mode === 'paint' && paint.tool === t.id, tip: TIPS[t.id], run: (app) => { paint.tool = t.id; paintBar(app).show('paint'); } })),
]);
