import { describe, expect, it } from 'vitest';
import { expandToolUrl, splitArgs } from '../../src/commands/libraryTools';

describe('External Tools', () => {
  it('fills web addresses from the picture, encoded, and refuses when something is missing', () => {
    const v = { name: 'Grandma & me.jpg', lat: 51.5, lon: -0.12, date: '1952-06-01', title: undefined };
    expect(expandToolUrl('https://www.openstreetmap.org/?mlat={lat}&mlon={lon}#map=16/{lat}/{lon}', v)).toBe('https://www.openstreetmap.org/?mlat=51.5&mlon=-0.12#map=16/51.5/-0.12');
    expect(expandToolUrl('https://www.google.com/search?q={name}', v)).toBe('https://www.google.com/search?q=Grandma%20%26%20me.jpg');
    expect(expandToolUrl('https://example.org/?t={title}', v)).toBeNull();
    expect(expandToolUrl('javascript:alert({name})', v)).toBeNull();
  });
  it('splits program arguments, keeping quoted parts together', () => {
    expect(splitArgs('--open "{file}" -q 90')).toEqual(['--open', '{file}', '-q', '90']);
    expect(splitArgs('')).toEqual([]);
  });
});
