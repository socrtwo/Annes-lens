#!/usr/bin/env python3
"""FlashPix test files: ImageMagick's PerlMagick samples (ImageMagick License; tests/fixtures/flashpix/LICENSE-ImageMagick),
made by Kodak's FlashPix toolkit through ImageMagick from its 70 x 46 rose, fetched at a pinned commit.

Writes to tests/fixtures/flashpix/:
  input_bw.fpx input_grayscale.fpx input_256.fpx input_truecolor.fpx   uncompressed tiles (monochrome, NIF RGB)
  input_jpeg.fpx                                                        JPEG tiles with shared tables
  rose.png             the same rose, lossless (PerlMagick's png/input_truecolor.png)
  <name>.pillow.png    Pillow's decoding (with olefile); its edge tiles are wrong (it takes their stored width
                       for 6 pixels, not 64), so only the first tile column is compared with it
  input_jpeg.libjpeg.png  the JPEG tiles put together here (shared tables + tile) and decoded by libjpeg
                       (Pillow cannot read this file)
Needs Pillow and olefile; downloads with a generic client name.
"""
import io, os, struct, urllib.request
import numpy as np
import olefile
from PIL import Image

COMMIT = 'd281ca7d48e206d3da610b897e0cf76084df3198'
BASE = f'https://raw.githubusercontent.com/ImageMagick/ImageMagick/{COMMIT}'
OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'flashpix')
UA = 'AnnesLensTests/1.0 (https://github.com/socrtwo/annes-lens; test fixtures)'


def get(path):
    with urllib.request.urlopen(urllib.request.Request(f'{BASE}/{path}', headers={'User-Agent': UA})) as r:
        return r.read()


def main():
    os.makedirs(OUT, exist_ok=True)
    open(os.path.join(OUT, 'LICENSE-ImageMagick'), 'wb').write(get('LICENSE'))
    open(os.path.join(OUT, 'rose.png'), 'wb').write(get('PerlMagick/t/png/input_truecolor.png'))
    for n in ('input_bw', 'input_grayscale', 'input_256', 'input_truecolor', 'input_jpeg'):
        b = get(f'PerlMagick/t/fpx/{n}.fpx')
        open(os.path.join(OUT, n + '.fpx'), 'wb').write(b)
        if n != 'input_jpeg':  # Pillow cannot read the JPEG one
            Image.open(io.BytesIO(b)).convert('RGB').save(os.path.join(OUT, n + '.pillow.png'))
        else:
            jpeg_reference(b)


def jpeg_reference(b):
    ole = olefile.OleFileIO(io.BytesIO(b))
    store = 'Data Object Store 000001'
    props = ole.getproperties([store, '\x05Image Contents'])
    res = 'Resolution %04d' % (props[0x01000000] - 1)
    head = ole.openstream([store, res, 'Subimage 0000 Header']).read()
    data = ole.openstream([store, res, 'Subimage 0000 Data']).read()
    w, h, tiles, tw, th, ch, toff, tlen = struct.unpack('<8I', head[32:64])
    cols = -(-w // tw)
    img = np.zeros((-(-h // th) * th, cols * tw, 3), np.uint8)
    for t in range(tiles):
        off, size, comp, sub = struct.unpack('<4I', head[28 + toff + t * tlen:28 + toff + t * tlen + 16])
        assert comp == 2
        tables = props[0x03000001 | ((sub >> 24) << 16)]
        jpg = tables[:-2] + data[28 + off + 2:28 + off + size]  # tables without EOI, tile without SOI
        tile = np.asarray(Image.open(io.BytesIO(jpg)).convert('RGB'))
        y, x = (t // cols) * th, (t % cols) * tw
        img[y:y + th, x:x + tw] = tile[:th, :tw]
    Image.fromarray(img[:h, :w]).save(os.path.join(OUT, 'input_jpeg.libjpeg.png'))


if __name__ == '__main__':
    main()
