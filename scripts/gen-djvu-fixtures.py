#!/usr/bin/env python3
"""DjVu fixtures, written with DjVuLibre's encoders, with DjVuLibre's renderings as the expected pictures.

Writes to tests/fixtures/djvu/:
  color.djvu      a photo-like picture, IW44 (c44), 100 dpi                       expected: color.png
  gray.djvu       a gray picture, IW44 (c44)                                      expected: gray.png
  bitonal.djvu    text, JB2 (cjb2), 300 dpi                                       expected: bitonal.png
  compound.djvu   JB2 mask, a red/blue foreground (FGbz zones) and an IW44 background (djvumake)
                                                                                  expected: compound.png
  book.djvu       the four pages bundled (djvm -c); page 3 (bitonal) has a text layer (djvused set-txt),
                  page 2 is rotated 90° (djvused set-rotation)                    expected: book-2.png
                  (pages 1, 3 and 4 are the single-page files)
  shared.djvu     three bitonal pages whose glyphs come from shared JB2 dictionaries (DJVI files included by
                  the pages, two pages per dictionary; minidjvu -m -p 2)          expected: shared-<n>.png
  indirect.djvu   an indirect document's index (djvm -i); its pages are separate files, not kept
Expected pictures are ddjvu's renderings at full resolution.
Needs numpy, Pillow, DjVuLibre (c44, cjb2, djvumake, djvm, djvused, ddjvu) and minidjvu.
"""
import os, shutil, struct, subprocess, tempfile
import numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'djvu')
TMP = tempfile.mkdtemp()


def run(*a, **k):
    subprocess.run(list(a), check=True, **k)


def tmp(n):
    return os.path.join(TMP, n)


def out(n):
    return os.path.join(OUT, n)


def photo(w, h):
    y, x = np.mgrid[0:h, 0:w].astype(np.float64)
    r = 128 + 100 * np.sin(x / 23.0) * np.cos(y / 31.0)
    g = 255 * x / w
    b = 255 * (1 - y / h)
    d = (x - w * 0.6) ** 2 + (y - h * 0.4) ** 2 < (min(w, h) * 0.2) ** 2
    r[d], g[d], b[d] = 240, 220, 40
    return np.clip(np.stack([r, g, b], -1), 0, 255).astype(np.uint8)


def text_mask(w, h, lines):
    im = Image.new('1', (w, h), 1)
    dr = ImageDraw.Draw(im)
    font = ImageFont.load_default(size=40)
    boxes = []
    for i, line in enumerate(lines):
        x, y = 30, 30 + i * 70
        dr.text((x, y), line, font=font, fill=0)
        words, cx = [], x
        for wd in line.split(' '):
            l, t, r, b = dr.textbbox((cx, y), wd, font=font)
            words.append((wd, l, t, r, b))
            cx = r + dr.textlength(' ', font=font)
        boxes.append(words)
    dr.rectangle((20, h - 60, w - 20, h - 40), fill=0)
    return im, boxes


def iw44(src, dst):
    """The BG44 chunks of a c44 page as an IW44 file (FORM:PM44), the form djvumake takes."""
    d = open(src, 'rb').read()
    p, body = 16, b''
    while p + 8 <= len(d):
        tag, n = d[p:p + 4], struct.unpack('>I', d[p + 4:p + 8])[0]
        if tag == b'BG44':
            body += b'PM44' + d[p + 4:p + 8] + d[p + 8:p + 8 + n] + (b'\0' if n & 1 else b'')
        p += 8 + n + (n & 1)
    with open(dst, 'wb') as f:
        f.write(b'AT&TFORM' + struct.pack('>I', len(body) + 4) + b'PM44' + body)


def main():
    os.makedirs(OUT, exist_ok=True)
    # Color and gray IW44.
    Image.fromarray(photo(320, 240)).save(tmp('photo.ppm'))
    run('c44', '-dpi', '100', tmp('photo.ppm'), out('color.djvu'))
    Image.fromarray(photo(200, 150)).convert('L').save(tmp('gray.pgm'))
    run('c44', '-dpi', '100', tmp('gray.pgm'), out('gray.djvu'))
    # Bitonal JB2 with text.
    lines = ['Parish register 1851', 'Baptisms and burials']
    im, boxes = text_mask(600, 260, lines)
    im.save(tmp('text.pbm'))
    run('cjb2', '-dpi', '300', tmp('text.pbm'), out('bitonal.djvu'))
    # Compound: the JB2 mask in two colors over a subsampled IW44 background.
    Image.fromarray(photo(200, 87)).save(tmp('bg.ppm'))  # 600x260 / 3
    run('c44', '-dpi', '100', tmp('bg.ppm'), tmp('bg.djvu'))
    iw44(tmp('bg.djvu'), tmp('bg.iw4'))
    run('djvumake', out('compound.djvu'), 'INFO=600,260,300', 'Sjbz=' + out('bitonal.djvu'),
        'FGbz=#ff0000:0,130,600,130#0000ff:0,0,600,130', 'BG44=' + tmp('bg.iw4'))
    # A bundled book, a rotated page and a text layer.
    run('djvm', '-c', out('book.djvu'), out('color.djvu'), out('gray.djvu'), out('bitonal.djvu'), out('compound.djvu'))
    h = 260
    sexp = '(page 0 0 600 260\n' + ''.join(
        ' (line %d %d %d %d %s)\n' % (
            min(b[1] for b in ws), h - max(b[4] for b in ws), max(b[3] for b in ws), h - min(b[2] for b in ws),
            ' '.join('(word %d %d %d %d "%s")' % (l, h - b, r, h - t, wd) for wd, l, t, r, b in ws))
        for ws in boxes) + ')\n'
    with open(tmp('text.dsed'), 'w') as f:
        f.write(sexp)
    run('djvused', out('book.djvu'), '-e', 'select 3; set-txt %s; select 2; set-rotation 1' % tmp('text.dsed'), '-s')
    # References, rendered by ddjvu and kept as PNG.
    for name, fmt in (('color', 'ppm'), ('gray', 'pgm'), ('bitonal', 'pbm'), ('compound', 'ppm')):
        run('ddjvu', '-format=' + fmt, out(name + '.djvu'), tmp(name + '.pnm'))
        Image.open(tmp(name + '.pnm')).save(out(name + '.png'))
    run('ddjvu', '-format=ppm', '-page=2', out('book.djvu'), tmp('book-2.pnm'))
    Image.open(tmp('book-2.pnm')).save(out('book-2.png'))
    # Shared dictionaries.
    texts = [['In the year of our Lord', 'eighteen hundred and fifty one'], ['were baptized in this parish', 'the children named below'],
             ['and their parents and sponsors', 'as written in the register']]
    for i, t in enumerate(texts):
        text_mask(600, 200, t)[0].save(tmp('s%d.pbm' % i))
    run('minidjvu', '-m', '-p', '2', '-d', '300', *[tmp('s%d.pbm' % i) for i in range(3)], out('shared.djvu'))
    for n in range(1, 4):
        run('ddjvu', '-format=pbm', '-page=%d' % n, out('shared.djvu'), tmp('shared.pnm'))
        Image.open(tmp('shared.pnm')).save(out('shared-%d.png' % n))
    # An indirect document: only its index is kept.
    d = tmp('indirect')
    os.makedirs(d)
    run('djvm', '-c', tmp('two.djvu'), out('color.djvu'), out('gray.djvu'))
    run('djvmcvt', '-i', tmp('two.djvu'), d, 'index.djvu')
    shutil.copy(os.path.join(d, 'index.djvu'), out('indirect.djvu'))
    shutil.rmtree(TMP)


if __name__ == '__main__':
    main()
