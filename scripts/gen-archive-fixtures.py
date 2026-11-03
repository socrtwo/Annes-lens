#!/usr/bin/env python3
"""Archive fixtures, made by the reference implementations (liblzma, libbz2 and zlib through Python, and py7zr).

Writes to tests/fixtures/archives/:
  sample.bin                        39 600 bytes: repeated text, 30 000 random bytes, more text
  sample.lzma, sample.xz, sample-lp.xz (lc 1, lp 3, pb 0, 64 KiB dictionary), sample-2streams.xz
  sample.bz2 (level 9), two.bz2 (two streams), big-l1.bz2 (level 1: the sample three times, a run of
                                    3000 bytes of 7, then "ab" 8000 times; over two 100 kB blocks)
  pics.tar (GNU), pics.tar.gz, pics.tbz2, pics.cbt (xz) (pax)   three small pictures (one in a subfolder),
                                    a text file, an empty file and a path longer than 100 characters
  pics-lzma2.7z, pics-lzma.7z, pics-bzip2.7z, pics-deflate.cb7, pics-copy.7z   the same files
  pics-aes.7z                       one picture, encrypted with the password "anne"
Needs numpy, Pillow and py7zr.
"""
import bz2, io, lzma, os, random, tarfile
import numpy as np
import py7zr
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'archives')


def streams():
    random.seed(5)
    txt = (b"Anne's Lens LZMA test. " * 400) + bytes(random.getrandbits(8) for _ in range(30000)) + b"The end." * 50
    open(f'{OUT}/sample.bin', 'wb').write(txt)
    open(f'{OUT}/sample.lzma', 'wb').write(lzma.compress(txt, format=lzma.FORMAT_ALONE, preset=6))
    open(f'{OUT}/sample.xz', 'wb').write(lzma.compress(txt, format=lzma.FORMAT_XZ, check=lzma.CHECK_CRC64, preset=9 | lzma.PRESET_EXTREME))
    open(f'{OUT}/sample-lp.xz', 'wb').write(lzma.compress(txt, format=lzma.FORMAT_XZ, filters=[{'id': lzma.FILTER_LZMA2, 'lc': 1, 'lp': 3, 'pb': 0, 'dict_size': 1 << 16}]))
    open(f'{OUT}/sample-2streams.xz', 'wb').write(lzma.compress(txt[:20000], format=lzma.FORMAT_XZ) + lzma.compress(txt[20000:], format=lzma.FORMAT_XZ))
    open(f'{OUT}/sample.bz2', 'wb').write(bz2.compress(txt, 9))
    open(f'{OUT}/two.bz2', 'wb').write(bz2.compress(txt[:15000], 5) + bz2.compress(txt[15000:], 5))
    big = txt * 3 + bytes([7]) * 3000 + b'ab' * 8000
    open(f'{OUT}/big-l1.bz2', 'wb').write(bz2.compress(big, 1))


def pictures():
    pics = {}
    for name, color in [('page 1.png', (200, 30, 30)), ('page 2.jpg', (30, 160, 60)), ('sub/page 10.png', (40, 60, 210))]:
        a = np.zeros((24, 32, 3), np.uint8) + np.array(color, np.uint8)
        a[4:8, 4:28] = 255
        b = io.BytesIO()
        Image.fromarray(a).save(b, 'PNG' if name.endswith('png') else 'JPEG', quality=95)
        pics[name] = b.getvalue()
    files = {**pics, 'notes.txt': b'not a picture\n', 'empty.png': b''}
    files['a-very-long-folder-name-' * 5 + '/photo with a long name.png'] = pics['page 1.png']
    return pics, files


def archives():
    pics, files = pictures()

    def tar(mode, path, fmt=tarfile.PAX_FORMAT):
        with tarfile.open(path, mode, format=fmt) as t:
            for n, d in files.items():
                ti = tarfile.TarInfo(n)
                ti.size = len(d)
                ti.mtime = 1700000000
                t.addfile(ti, io.BytesIO(d))
    tar('w', f'{OUT}/pics.tar', tarfile.GNU_FORMAT)
    tar('w:gz', f'{OUT}/pics.tar.gz')
    tar('w:bz2', f'{OUT}/pics.tbz2')
    tar('w:xz', f'{OUT}/pics.cbt')
    for name, filters in [('pics-lzma2.7z', [{'id': py7zr.FILTER_LZMA2, 'preset': 9}]), ('pics-lzma.7z', [{'id': py7zr.FILTER_LZMA}]),
                          ('pics-bzip2.7z', [{'id': py7zr.FILTER_BZIP2}]), ('pics-deflate.cb7', [{'id': py7zr.FILTER_DEFLATE}]), ('pics-copy.7z', [{'id': py7zr.FILTER_COPY}])]:
        with py7zr.SevenZipFile(f'{OUT}/{name}', 'w', filters=filters) as z:
            for n, d in files.items():
                z.writestr(d, n)
    with py7zr.SevenZipFile(f'{OUT}/pics-aes.7z', 'w', password='anne') as z:
        z.writestr(pics['page 1.png'], 'page 1.png')


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    streams()
    archives()
    for f in sorted(os.listdir(OUT)):
        print(f, os.path.getsize(f'{OUT}/{f}'))
