import { describe, it, expect } from 'vitest';
import { makeFilter, groupLabel, stackIds, parseExifDate, type EntryInfo } from '../../src/picture/folderInfo';

const info = (o: Partial<EntryInfo>): EntryInfo => ({ name: 'a.jpg', ext: 'jpg', size: 100, date: null, exifDate: false, camera: '', lens: '', width: 0, height: 0, orientation: '', hasGps: false, rating: 0, label: '', keywords: [], flag: '', favorite: false, ...o });

describe('folder info', () => {
  it('filters by type, rating, label, keyword, text, dates, camera, location, orientation, flag and favorite', () => {
    const a = info({ name: 'IMG_1.JPG', ext: 'jpg', rating: 4, label: 'red', keywords: ['Bath', 'Family'], date: new Date(2020, 4, 6), camera: 'Canon EOS', hasGps: true, orientation: 'landscape', flag: 'pick', favorite: true });
    const b = info({ name: 'scan.png', ext: 'png', rating: 1, orientation: 'portrait' });
    const f = (spec: any) => [a, b].filter(makeFilter(spec)).map((i) => i.name);
    expect(f({})).toEqual(['IMG_1.JPG', 'scan.png']); expect(f({ types: ['jpeg'] })).toEqual(['IMG_1.JPG']); expect(f({ minRating: 2 })).toEqual(['IMG_1.JPG']); expect(f({ label: 'Red' })).toEqual(['IMG_1.JPG']);
    expect(f({ keyword: 'fam' })).toEqual(['IMG_1.JPG']); expect(f({ text: 'scan' })).toEqual(['scan.png']); expect(f({ from: new Date(2020, 0, 1), to: new Date(2020, 11, 31) })).toEqual(['IMG_1.JPG']); expect(f({ from: new Date(2021, 0, 1) })).toEqual([]);
    expect(f({ camera: 'canon' })).toEqual(['IMG_1.JPG']); expect(f({ hasGps: false })).toEqual(['scan.png']); expect(f({ orientation: 'portrait' })).toEqual(['scan.png']); expect(f({ flag: 'pick' })).toEqual(['IMG_1.JPG']); expect(f({ favorite: true })).toEqual(['IMG_1.JPG']);
  });
  it('labels groups and finds bursts and pairs', () => {
    const i = info({ date: new Date(2021, 1, 3, 10, 0, 0), camera: 'X', rating: 3, keywords: ['k'], ext: 'png' });
    expect(groupLabel('date', i)).toBe('2021-02-03'); expect(groupLabel('rating', i)).toBe('★★★'); expect(groupLabel('rating', info({}))).toBe('Unrated'); expect(groupLabel('keyword', i)).toBe('k'); expect(groupLabel('type', i)).toBe('PNG'); expect(groupLabel('camera', info({}))).toBe('Unknown camera');
    const t = (s: number) => new Date(2021, 1, 3, 10, 0, s);
    const infos = [info({ name: 'a.jpg', date: t(0) }), info({ name: 'b.jpg', date: t(2) }), info({ name: 'c.jpg', date: t(4) }), info({ name: 'd.jpg', date: t(30) }), info({ name: 'e.cr2' }), info({ name: 'e.jpg' })];
    const st = stackIds(infos);
    expect(st.get('a.jpg')).toBe('Burst 1'); expect(st.get('b.jpg')).toBe('Burst 1'); expect(st.get('c.jpg')).toBe('Burst 1'); expect(st.get('d.jpg')).toBe('Single pictures'); expect(st.get('e.cr2')).toBe('Pair e'); expect(st.get('e.jpg')).toBe('Pair e');
    expect(parseExifDate('2020:05:06 07:08:09')?.getFullYear()).toBe(2020); expect(parseExifDate('')).toBeNull();
  });
});
