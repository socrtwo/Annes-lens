#!/usr/bin/env python3
"""JBIG (T.82) and JBIG2 (T.88) test files.

Writes to tests/fixtures/jbig/ (expected pictures <name>.png next to each):
  JBIG, made by jbigkit's pbmtojbg, expected: jbigkit's jbgtopbm
    seq.jbg       one layer (-q), three-line template, typical prediction, adaptive template moves, 8-line stripes
    two.jbg       the two-line template (LRLTWO)
    plain.jbg     no typical prediction, no adaptive template (-p 0 -m 0)
    reset.jbg     SDRST after each stripe and a comment (-r -C)
    newlen.jbg    a larger height announced, then NEWLEN (-Y; VLENGTH)
    fax.jbg       the T.85 fax profile (-f)
    gray.jbg      4 bit planes (Gray code), interleaved stripes;   gray-planes.jbg: planes one after another (-o 0)
    layers.jbg    two differential layers: expected layers.png is the lowest layer (jbgtopbm -x)
  JBIG2, written here (a page and an MMR generic region; the MMR data is libtiff's Group 4 stream through Pillow),
  expected: jbig2dec
    page.jb2      sequential organization;  random.jb2: the same page, random-access organization
Needs numpy, Pillow, jbigkit (pbmtojbg, jbgtopbm) and jbig2dec.
"""
import io, os, struct, subprocess, tempfile
import numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'jbig')
TMP = tempfile.mkdtemp()


def run(cmd, out=None):
    with open(out, 'wb') if out else open(os.devnull, 'wb') as f:
        subprocess.run(cmd, check=True, stdout=f, stderr=subprocess.DEVNULL)


def page(w, h, seed=1):
    im = Image.new('1', (w, h), 1)
    d = ImageDraw.Draw(im)
    f = ImageFont.load_default(size=22)
    for i in range(h // 30):
        d.text((10 + (i * 37) % 40, 5 + i * 30), 'Births, marriages and burials %d' % (1840 + i * seed), font=f, fill=0)
    d.ellipse((w - 120, 20, w - 20, 120), outline=0, width=3)
    d.rectangle((w - 200, h - 60, w - 20, h - 20), fill=0)
    return im


def jbg(name, args, src):
    run(['pbmtojbg'] + args + [src, os.path.join(OUT, name + '.jbg')])
    run(['jbgtopbm', os.path.join(OUT, name + '.jbg'), os.path.join(TMP, name + '.pnm')])
    Image.open(os.path.join(TMP, name + '.pnm')).convert('RGB').save(os.path.join(OUT, name + '.png'))


def main():
    os.makedirs(OUT, exist_ok=True)
    src = os.path.join(TMP, 'page.pbm')
    page(600, 380).save(src)
    jbg('seq', ['-q', '-s', '8'], src)
    jbg('two', ['-q', '-p', str(8 + 64)], src)
    jbg('plain', ['-q', '-p', '0', '-m', '0'], src)
    jbg('reset', ['-q', '-s', '64', '-r', '-C', 'Parish register, page 12'], src)
    jbg('newlen', ['-q', '-Y', '1000'], src)
    jbg('fax', ['-f'], src)
    # Four bit planes from a gray picture (pbmtojbg takes a PGM and Gray-codes it).
    y, x = np.mgrid[0:120, 0:160]
    g = ((x + y) * 16 // 280 * 17).astype(np.uint8)
    g[30:90, 40:120] = 255 - g[30:90, 40:120]
    pgm = os.path.join(TMP, 'gray.pgm')
    Image.fromarray(g).save(pgm)
    for name, extra in (('gray', []), ('gray-planes', ['-o', '0'])):
        run(['pbmtojbg', '-q', '-s', '32'] + extra + [pgm, os.path.join(OUT, name + '.jbg')])
        run(['jbgtopbm', os.path.join(OUT, name + '.jbg'), os.path.join(TMP, name + '.pnm')])
        Image.open(os.path.join(TMP, name + '.pnm')).convert('RGB').save(os.path.join(OUT, name + '.png'))
    # Differential layers: the lowest layer only is expected.
    big = os.path.join(TMP, 'big.pbm')
    page(800, 520, 2).save(big)
    run(['pbmtojbg', '-d', '2', big, os.path.join(OUT, 'layers.jbg')])
    run(['jbgtopbm', '-x', '200', os.path.join(OUT, 'layers.jbg'), os.path.join(TMP, 'layers.pnm')])
    Image.open(os.path.join(TMP, 'layers.pnm')).convert('RGB').save(os.path.join(OUT, 'layers.png'))
    jbig2()


def segment(num, kind, page_assoc, data, refs=()):
    flags = kind | (0x40 if page_assoc > 255 else 0)
    head = struct.pack('>IB', num, flags) + bytes([len(refs) << 5]) + bytes(refs)
    head += struct.pack('>I' if page_assoc > 255 else '>B', page_assoc) + struct.pack('>I', len(data))
    return head, data


def jbig2():
    im = page(320, 200, 3)
    b = io.BytesIO()
    # Pillow's Group 4 TIFF codes white as 1 (min-is-black); JBIG2 codes black as 1, so the inverse is encoded.
    Image.fromarray(~np.asarray(im)).save(b, 'TIFF', compression='group4')
    t = Image.open(io.BytesIO(b.getvalue()))
    off, cnt = t.tag_v2[273][0], t.tag_v2[279][0]
    mmr = b.getvalue()[off:off + cnt]
    w, h = im.size
    info = struct.pack('>IIIIBH', w, h, 0, 0, 0, 0)  # width, height, resolution, flags, striping
    region = struct.pack('>IIIIB', w, h, 0, 0, 0) + bytes([0x01]) + mmr  # region info (external combination OR), MMR generic region
    segs = [segment(0, 48, 1, info), segment(1, 38, 1, region), segment(2, 49, 1, b''), segment(3, 51, 0, b'')]
    header = b'\x97JB2\r\n\x1a\n'
    seq = header + bytes([0x01]) + struct.pack('>I', 1) + b''.join(hd + d for hd, d in segs)
    rnd = header + bytes([0x00]) + struct.pack('>I', 1) + b''.join(hd for hd, _ in segs) + b''.join(d for _, d in segs)
    open(os.path.join(OUT, 'page.jb2'), 'wb').write(seq)
    open(os.path.join(OUT, 'random.jb2'), 'wb').write(rnd)
    run(['jbig2dec', '-t', 'png', '-o', os.path.join(OUT, 'page.png'), os.path.join(OUT, 'page.jb2')])
    run(['jbig2dec', '-t', 'png', '-o', os.path.join(TMP, 'random.png'), os.path.join(OUT, 'random.jb2')])
    a, c = np.asarray(Image.open(os.path.join(OUT, 'page.png')).convert('L')), np.asarray(Image.open(os.path.join(TMP, 'random.png')).convert('L'))
    assert (a == c).all() and (a == np.asarray(im.convert('L'))).all()  # jbig2dec reads both, and the picture is the page
    Image.open(os.path.join(OUT, 'page.png')).convert('RGB').save(os.path.join(OUT, 'page.png'))


if __name__ == '__main__':
    main()
