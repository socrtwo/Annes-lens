import { describe, it, expect } from 'vitest';
import { place } from '../../src/commands/editAdd';

describe('placement', () => {
  it('anchors a box by corner, edge or center with a margin', () => {
    expect(place('tl', 100, 50, 10, 5, 2)).toEqual([2, 2]);
    expect(place('br', 100, 50, 10, 5, 2)).toEqual([88, 43]);
    expect(place('mc', 100, 50, 10, 5, 2)).toEqual([45, 22.5]);
    expect(place('tc', 100, 50, 10, 5, 0)).toEqual([45, 0]);
    expect(place('ml', 100, 50, 10, 5, 3)).toEqual([3, 22.5]);
  });
});
