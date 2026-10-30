import { describe, it, expect } from 'vitest';
import { makeOrder, pickTransition, buildSlideshowHtml, DEFAULT_SLIDESHOW } from '../../src/picture/slideshow';

describe('slideshow', () => {
  it('orders from the start, or shuffles with the start first', () => {
    expect(makeOrder(5, 2, false)).toEqual([2, 3, 4, 0, 1]);
    let s = 7; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    const o = makeOrder(6, 3, true, rnd);
    expect(o[0]).toBe(3); expect([...o].sort()).toEqual([0, 1, 2, 3, 4, 5]); expect(o).not.toEqual([3, 4, 5, 0, 1, 2]);
    expect(pickTransition('fade')).toBe('fade'); expect(['fade', 'wipe', 'slide', 'zoom', 'panzoom']).toContain(pickTransition('random', () => 0.99));
  });
  it('builds a self-contained HTML page', () => {
    const html = buildSlideshowHtml([{ name: 'a.jpg', dataUrl: 'data:image/jpeg;base64,AAA', caption: 'A <b>' }], { ...DEFAULT_SLIDESHOW, seconds: 2, random: true }, 'My "show"');
    expect(html.startsWith('<!doctype html>')).toBe(true); expect(html).toContain('<title>My &quot;show&quot;</title>'); expect(html).toContain('"seconds":2'); expect(html).toContain('"random":true'); expect(html).toContain('data:image/jpeg;base64,AAA'); expect(html).not.toContain('<script src=');
  });
});
