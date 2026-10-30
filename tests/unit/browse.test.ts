import { describe, it, expect } from 'vitest';
import { globToRegExp } from '../../src/commands/browse';

describe('select by pattern', () => {
  it('matches wildcards, several patterns and ignores case', () => {
    const re = globToRegExp('IMG_*.jpg; *.png');
    expect(re.test('img_0001.JPG')).toBe(true);
    expect(re.test('photo.png')).toBe(true);
    expect(re.test('photo.jpeg')).toBe(false);
    expect(globToRegExp('DSC?????.NEF').test('DSC01234.nef')).toBe(true);
    expect(globToRegExp('a.b').test('axb')).toBe(false);
  });
});
