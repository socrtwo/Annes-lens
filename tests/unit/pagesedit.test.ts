import { describe, it, expect } from 'vitest';
import { reverseFrames, mergeIdenticalFrames, reorder } from '../../src/commands/pagesEdit';

const f = (id: number, delay = 100) => ({ image: { id } as any, width: 1, height: 1, delay });

describe('frame helpers', () => {
  it('reverses, reorders and merges identical runs with summed delays', () => {
    const frames = [f(1), f(2), f(2), f(3), f(3, 50), f(2)];
    expect(reverseFrames(frames).map((x) => x.image.id)).toEqual([2, 3, 3, 2, 2, 1]);
    const merged = mergeIdenticalFrames(frames, (a, b) => a.image.id === b.image.id);
    expect(merged.map((x) => [x.image.id, x.delay])).toEqual([[1, 100], [2, 200], [3, 150], [2, 100]]);
    expect(reorder(['a', 'b', 'c'], [2, 0, 1, 9])).toEqual(['c', 'a', 'b']);
  });
});
