#!/usr/bin/env python3
"""Windows Clipboard Viewer (.clp) test files, written here from the format's description.

Writes to tests/fixtures/clipboard/:
  dib31.clp    Windows 3.x file: CF_TEXT and a 24-bit CF_DIB           expected: dib.png (Pillow's reading of the DIB as a BMP)
  dib8nt.clp   Windows NT file: an 8-bit CF_DIB with a palette        expected: dib8.png (likewise)
  ddb31.clp    Windows 3.x file: a 1-bit CF_BITMAP only               expected: ddb.png (drawn here)
  wmf31.clp    Windows 3.x file: CF_METAFILEPICT made from tests/fixtures/metafile/shapes.wmf
                                                                     expected: the shapes.wmf rendering (shapes-wmf.png)
  emfnt.clp    Windows NT file: CF_ENHMETAFILE (tests/fixtures/metafile/shapes.emf)
                                                                     expected: shapes-emf.png
Needs numpy and Pillow.
"""
import io, os, struct
import numpy as np
from PIL import Image

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, '..', 'tests', 'fixtures', 'clipboard')
META = os.path.join(HERE, '..', 'tests', 'fixtures', 'metafile')


def clp(entries, nt):
    """entries: (format id, name, data)."""
    per = 4 + 4 + 4 + 158 if nt else 2 + 4 + 4 + 79
    off = 4 + per * len(entries)
    head = struct.pack('<HH', 0xC351 if nt else 0xC350, len(entries))
    body = b''
    for fid, name, data in entries:
        nm = name.encode('utf-16-le' if nt else 'latin-1')[:156 if nt else 78]
        nm += b'\0' * ((158 if nt else 79) - len(nm))
        head += struct.pack('<III' if nt else '<HII', fid, len(data), off + len(body)) + nm
        body += data
    return head + body


def dib_of(img):
    b = io.BytesIO(); img.save(b, 'BMP'); return b.getvalue()[14:]


def main():
    os.makedirs(OUT, exist_ok=True)
    y, x = np.mgrid[0:30, 0:45]
    rgb = np.stack([x * 5, y * 8, 255 - x * 5], -1).astype(np.uint8)
    img = Image.fromarray(rgb)
    open(os.path.join(OUT, 'dib31.clp'), 'wb').write(clp([(1, '', b'Family tree notes\0'), (8, '', dib_of(img))], False))
    img.save(os.path.join(OUT, 'dib.png'))
    p8 = img.quantize(40)
    open(os.path.join(OUT, 'dib8nt.clp'), 'wb').write(clp([(8, '', dib_of(p8)), (13, '', 'x'.encode('utf-16-le'))], True))
    p8.convert('RGB').save(os.path.join(OUT, 'dib8.png'))
    # 1-bit device-dependent bitmap: BITMAP16 header and top-down rows (1 = white).
    bits = ((x // 3 + y // 3) % 2).astype(np.uint8)
    rows = np.packbits(bits, axis=1)
    rb = (rows.shape[1] + 1) & ~1
    rows = np.pad(rows, ((0, 0), (0, rb - rows.shape[1])))
    ddb = struct.pack('<hhhhBBI', 0, 45, 30, rb, 1, 1, 0) + rows.tobytes()
    open(os.path.join(OUT, 'ddb31.clp'), 'wb').write(clp([(2, '', ddb)], False))
    Image.fromarray(bits * 255).convert('RGB').save(os.path.join(OUT, 'ddb.png'))
    # Metafiles: the placeable WMF's size becomes the METAFILEPICT extents (hundredths of a millimeter).
    w = open(os.path.join(META, 'shapes.wmf'), 'rb').read()
    l, t, r, b, inch = struct.unpack('<hhhhH', w[6:16])
    mfp = struct.pack('<hhhH', 8, round((r - l) / inch * 2540), round((b - t) / inch * 2540), 0) + w[22:]
    open(os.path.join(OUT, 'wmf31.clp'), 'wb').write(clp([(3, '', mfp)], False))
    e = open(os.path.join(META, 'shapes.emf'), 'rb').read()
    open(os.path.join(OUT, 'emfnt.clp'), 'wb').write(clp([(14, '', e), (1, '', b'shapes\0')], True))


if __name__ == '__main__':
    main()
