import { describe, expect, it } from 'vitest';
import { infoToStore, infoFromStore, catFolderFor } from '../../src/picture/catalog';
import { newOnes } from '../../src/picture/watch';
import { dirUriOf } from '../../src/commands/fileOps';
import { Folder } from '../../src/picture/folder';

const entry = (name: string, size?: number, extra: Record<string, unknown> = {}) => ({ name, uri: `file:///p/${name}`, size, read: async () => new ArrayBuffer(0), ...extra });

describe('catalog', () => {
  it('stores picture facts with their dates and reads them back', () => {
    const info = { name: 'a.jpg', ext: 'jpg', size: 10, date: new Date('2019-06-01T10:00:00Z'), exifDate: true, camera: 'X', lens: '', width: 4, height: 3, orientation: 'landscape' as const, hasGps: false, rating: 4, label: 'red', keywords: ['k'], flag: '', favorite: false };
    const back = infoFromStore(JSON.parse(JSON.stringify(infoToStore(info))));
    expect(back).toEqual(info);
    expect(infoFromStore(infoToStore({ ...info, date: null })).date).toBeNull();
  });
  it('keeps folders by address and refuses ones without', () => {
    expect(catFolderFor(null, 'x', true)).toBeNull();
    expect(catFolderFor('file:///p/Trip', 'Trip', true)).toMatchObject({ uri: 'file:///p/Trip', name: 'Trip', subfolders: true });
    expect(catFolderFor('fsadir:unknown', 'X', false)).toBeNull();
  });
  it('finds the pictures that arrived in a watched folder', () => {
    const known = ['a.jpg|10', 'b.jpg|20'];
    expect(newOnes([entry('a.jpg', 10), entry('b.jpg', 21), entry('c.png', 5), entry('notes.txt', 3)], known).map((e) => e.name)).toEqual(['b.jpg', 'c.png']);
    expect(newOnes([entry('a.jpg', 10)], known)).toEqual([]);
  });
  it('an entry listed from a subfolder knows its own folder', () => {
    const f = new Folder([], 'Top'); f.uri = 'file:///p';
    expect(dirUriOf(entry('a.jpg', 1, { dirUri: 'file:///p/Kids' }), f)).toBe('file:///p/Kids');
    expect(dirUriOf(entry('a.jpg', 1), f)).toBe('file:///p');
  });
});
