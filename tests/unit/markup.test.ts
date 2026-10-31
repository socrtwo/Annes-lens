import { describe, expect, it } from 'vitest';
import { addItem, itemsOf, undoMarkup, removeItem, nextStep, clearBoard, hitTest, itemBox, moveItem, snapshot } from '../../src/paint/markup';

const pic = () => ({}) as any;
const base = { color: '#e02020', width: 4 };

describe('markup board', () => {
  it('adds, removes and undoes items per picture', () => {
    const a = pic(), b = pic();
    const arrow = addItem(a, { ...base, kind: 'arrow', pts: [[0, 0], [100, 0]] });
    addItem(a, { ...base, kind: 'rect', pts: [[10, 10], [50, 40]] });
    expect(itemsOf(a).map((i) => i.kind)).toEqual(['arrow', 'rect']); expect(itemsOf(b)).toEqual([]);
    expect(removeItem(a, arrow.id)).toBe(true); expect(itemsOf(a).map((i) => i.kind)).toEqual(['rect']);
    expect(undoMarkup(a)).toBe(true); expect(itemsOf(a).map((i) => i.kind)).toEqual(['arrow', 'rect']);
    clearBoard(a); expect(itemsOf(a)).toEqual([]); expect(undoMarkup(a)).toBe(true); expect(itemsOf(a).length).toBe(2);
    expect(itemsOf(null)).toEqual([]);
  });
  it('numbers steps from one, continuing after the highest', () => {
    const a = pic();
    expect(nextStep(a)).toBe(1); addItem(a, { ...base, kind: 'step', pts: [[5, 5]], n: nextStep(a) });
    addItem(a, { ...base, kind: 'step', pts: [[50, 5]], n: nextStep(a) }); expect(itemsOf(a).map((i) => i.n)).toEqual([1, 2]); expect(nextStep(a)).toBe(3);
  });
  it('moves an item and undoes the move with a snapshot', () => {
    const a = pic(); const it = addItem(a, { ...base, kind: 'line', pts: [[0, 0], [10, 0]] });
    snapshot(a); moveItem(itemsOf(a)[0], 5, 7); expect(itemsOf(a)[0].pts).toEqual([[5, 7], [15, 7]]);
    undoMarkup(a); expect(itemsOf(a)[0].pts).toEqual([[0, 0], [10, 0]]); void it;
  });
  it('hits lines near the stroke, outlines only on their edges, the topmost first', () => {
    const items = [
      { id: 1, ...base, kind: 'rect' as const, pts: [[0, 0], [100, 100]] as [number, number][] },
      { id: 2, ...base, kind: 'line' as const, pts: [[0, 50], [100, 50]] as [number, number][] },
      { id: 3, ...base, kind: 'rect' as const, pts: [[200, 0], [300, 100]] as [number, number][], fill: true },
    ];
    expect(hitTest(items, 50, 52, 3)?.id).toBe(2); // the line, above the rectangle
    expect(hitTest(items, 50, 1, 3)?.id).toBe(1); // the rectangle's top edge
    expect(hitTest(items, 50, 25, 3)).toBeNull(); // inside an outline only: nothing
    expect(hitTest(items, 250, 50, 3)?.id).toBe(3); // a filled shape is hit inside
    expect(hitTest(items, 500, 500, 3)).toBeNull();
  });
  it('boxes text, steps and highlighter strokes', () => {
    const step = itemBox({ id: 1, ...base, kind: 'step', pts: [[50, 50]] });
    expect(step.x).toBeLessThan(50 - 12); expect(step.x + step.w).toBeGreaterThan(50 + 12);
    const text = itemBox({ id: 2, ...base, kind: 'text', pts: [[10, 10]], text: 'Hello\nWorld' }, (t, px) => t.length * px * 0.5);
    expect(text.w).toBeGreaterThan(5 * 24 * 0.5); expect(text.h).toBeGreaterThan(2 * 24);
  });
});
