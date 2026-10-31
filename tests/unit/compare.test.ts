import { describe, expect, it } from 'vitest';
import { fitIn, zoomAbout, panBy, columnsFor, type CompareState } from '../../src/ui/compareView';

/** The picture point (pixels) shown at a pane point. */
const under = (s: CompareState, px: number, py: number, vw: number, vh: number, pw: number, ph: number) => { const z = s.rel * fitIn(pw, ph, vw, vh); return [s.nx * pw + (px - vw / 2) / z, s.ny * ph + (py - vh / 2) / z]; };

describe('compare panes', () => {
  it('fits and lays out panes', () => {
    expect(fitIn(4000, 3000, 800, 600)).toBe(0.2); expect(fitIn(1000, 3000, 800, 600)).toBe(0.2);
    expect([2, 3, 4].map(columnsFor)).toEqual([2, 3, 2]);
  });
  it('keeps the picture point under the pointer while zooming', () => {
    const s0: CompareState = { rel: 1, nx: 0.5, ny: 0.5 }, args = [800, 600, 4000, 3000] as const;
    const before = under(s0, 600, 150, ...args);
    const s1 = zoomAbout(s0, 2, 600, 150, ...args);
    expect(s1.rel).toBe(2);
    const after = under(s1, 600, 150, ...args);
    expect(after[0]).toBeCloseTo(before[0], 6); expect(after[1]).toBeCloseTo(before[1], 6);
    // The same fractional state shows the same place in a picture of another size.
    const small = under(s1, 400, 300, 800, 600, 2000, 1500), large = under(s1, 400, 300, 800, 600, 4000, 3000);
    expect(small[0] / 2000).toBeCloseTo(large[0] / 4000, 9); expect(small[1] / 1500).toBeCloseTo(large[1] / 3000, 9);
  });
  it('clamps the zoom and pans by the drag in picture fractions', () => {
    expect(zoomAbout({ rel: 60, nx: 0.5, ny: 0.5 }, 10, 400, 300, 800, 600, 400, 300).rel).toBe(64);
    const p = panBy({ rel: 2, nx: 0.5, ny: 0.5 }, 80, -60, 800, 600, 4000, 3000); // z = 0.4: 80 px = 200 picture px = 0.05
    expect(p.nx).toBeCloseTo(0.45, 9); expect(p.ny).toBeCloseTo(0.55, 9); expect(p.rel).toBe(2);
  });
});
