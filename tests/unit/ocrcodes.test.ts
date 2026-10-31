import { afterEach, describe, expect, it, vi } from 'vitest';
import { ocrScale, findWords, OCR_LANGS } from '../../src/picture/ocr';
import { classify, parseWifi } from '../../src/picture/barcode';
import { ocrMatch } from '../../src/ui/overlays';
import { localRuntimes, runtimeBase, resetRuntimes } from '../../src/platform/runtimes';

describe('OCR helpers', () => {
  it('enlarges small pictures for OCR and leaves large ones', () => {
    expect(ocrScale(900, 260)).toBe(2); expect(ocrScale(400, 300)).toBe(3); expect(ocrScale(2400, 1600)).toBe(1); expect(ocrScale(1500, 900)).toBeCloseTo(1.2, 9);
  });
  it('finds words case- and accent-insensitively', () => {
    const w = (text: string) => ({ text, conf: 90, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } });
    expect(findWords([w('Müller'), w('mueller'), w('1926.')], 'muller').map((x) => x.text)).toEqual(['Müller']);
    expect(findWords([w('1926.')], '1926').length).toBe(1); expect(findWords([w('a')], '  ').length).toBe(0);
    expect(ocrMatch('Bâth', 'bath')).toBe(true); expect(ocrMatch('Bath', '')).toBe(false);
  });
  it('offers English first and Fraktur among the languages', () => { expect(OCR_LANGS[0].id).toBe('eng'); expect(OCR_LANGS.map((l) => l.id)).toContain('frk'); });
});

describe('barcode content', () => {
  it('classifies what a code holds', () => {
    expect(classify('https://example.org/x')).toBe('url'); expect(classify('WIFI:S:Home;T:WPA;P:pw;;')).toBe('wifi');
    expect(classify('BEGIN:VCARD\nFN:Anne\nEND:VCARD')).toBe('contact'); expect(classify('mailto:a@b.c')).toBe('email');
    expect(classify('tel:+441234')).toBe('phone'); expect(classify('geo:51.38,-2.36')).toBe('geo'); expect(classify('9780140449136')).toBe('text');
    expect(classify('see https://x.org for more')).toBe('text');
  });
  it('parses Wi-Fi codes, including escaped separators', () => {
    expect(parseWifi('WIFI:S:Home Net;T:WPA;P:pa' + String.fromCharCode(92) + ';ss;H:true;;')).toEqual({ ssid: 'Home Net', type: 'WPA', password: 'pa;ss', hidden: true });
    expect(parseWifi('WIFI:S:Open;;')).toEqual({ ssid: 'Open', type: 'nopass', password: '', hidden: false });
    expect(parseWifi('hello')).toBeNull();
  });
});

describe('local runtime manifest', () => {
  afterEach(() => { vi.unstubAllGlobals(); resetRuntimes(); });
  it('uses the local copy when runtimes.json lists it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ort: 'ort/', ocr: 'ocr', ocrLangs: ['eng'] }), { status: 200 })));
    expect((await localRuntimes()).ocrLangs).toEqual(['eng']);
    expect(await runtimeBase('ort', 'https://cdn.example/ort/')).toMatch(/\/ort\/$/);
    expect(await runtimeBase('ocr', 'https://cdn.example/ocr/')).toMatch(/\/ocr\/$/);
    expect(await runtimeBase('zxing', 'https://cdn.example/zx/')).toBe('https://cdn.example/zx/');
  });
  it('falls back to the CDN for a missing manifest or an SPA fallback page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } })));
    expect(await runtimeBase('ort', 'https://cdn.example/ort/')).toBe('https://cdn.example/ort/');
    resetRuntimes();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    expect(await localRuntimes()).toEqual({});
    resetRuntimes();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await localRuntimes()).toEqual({});
  });
});
