import { describe, it, expect } from 'vitest';
import { playOrder, MAX_BYTES } from '../../src/picture/music';

describe('background music', () => {
  it('plays in list order, or shuffled without repeating the last track first', () => {
    expect(playOrder(4, false)).toEqual([0, 1, 2, 3]);
    let s = 3; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    for (let k = 0; k < 20; k++) { const o = playOrder(5, true, rnd, 2); expect([...o].sort()).toEqual([0, 1, 2, 3, 4]); expect(o[0]).not.toBe(2); }
    expect(playOrder(1, true, rnd, 0)).toEqual([0]);
    expect(playOrder(0, true)).toEqual([]);
    expect(MAX_BYTES).toBe(300 * 1048576);
  });
});
