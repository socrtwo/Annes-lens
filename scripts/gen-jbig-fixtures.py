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
    layers.jbg    two differential (resolution) layers, default options; layers-plain (no prediction), layers-tp (TPDON
                  only, 3-line stripes), layers-two (two-line template), layers-d3 (three layers), layers-reset (SDRST
                  after each stripe), layers-newlen (NEWLEN), order-<n> (every stripe order of Table 11, including the
                  SEQ and HITOLO ones jbgtopbm cannot read); the coding is lossless, so layers.png (jbgtopbm's decoding
                  of layers.jbg, checked to be the page) is expected of all of them
    gray-layers.jbg   8 bit planes with a differential layer                        expected: gray-layers.png
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
    # Resolution (differential) layers, decoded to the full picture: every option, stripe order, SDRST and NEWLEN.
    big = os.path.join(TMP, 'big.pbm')
    page(800, 520, 2).save(big)
    layered = {'layers': ['-d', '2'], 'layers-plain': ['-d', '2', '-p', '0', '-s', '2'], 'layers-tp': ['-d', '1', '-p', '16', '-s', '3'],
               'layers-two': ['-d', '2', '-p', '92'], 'layers-d3': ['-d', '3'], 'layers-reset': ['-d', '2', '-r', '-s', '30'], 'layers-newlen': ['-d', '2', '-Y', '1000']}
    for o in (0, 2, 4, 5, 6, 8, 10, 11, 12, 13, 14):
        layered['order-%d' % o] = ['-d', '2', '-o', str(o), '-s', '20']
    for name, args in layered.items():
        run(['pbmtojbg'] + args + [big, os.path.join(OUT, name + '.jbg')])
    # jbgtopbm reads the ILEAVE orders (0, 2, 3) and not SEQ or HITOLO; the coding is lossless, so one expected
    # picture serves every file: jbgtopbm's full decoding of layers.jbg, checked here to be the page itself.
    run(['jbgtopbm', os.path.join(OUT, 'layers.jbg'), os.path.join(TMP, 'layers.pnm')])
    assert (np.asarray(Image.open(os.path.join(TMP, 'layers.pnm')).convert('1')) == np.asarray(Image.open(big).convert('1'))).all()
    Image.open(os.path.join(TMP, 'layers.pnm')).convert('RGB').save(os.path.join(OUT, 'layers.png'))
    for name in ('layers-plain', 'layers-tp', 'layers-two', 'layers-d3', 'layers-reset', 'layers-newlen', 'order-0', 'order-2'):
        run(['jbgtopbm', os.path.join(OUT, name + '.jbg'), os.path.join(TMP, 'chk.pnm')])
        assert (np.asarray(Image.open(os.path.join(TMP, 'chk.pnm')).convert('1')) == np.asarray(Image.open(big).convert('1'))).all(), name
    run(['pbmtojbg', '-d', '1', '-s', '16', pgm, os.path.join(OUT, 'gray-layers.jbg')])
    run(['jbgtopbm', os.path.join(OUT, 'gray-layers.jbg'), os.path.join(TMP, 'gray-layers.pnm')])
    Image.open(os.path.join(TMP, 'gray-layers.pnm')).convert('RGB').save(os.path.join(OUT, 'gray-layers.png'))
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
