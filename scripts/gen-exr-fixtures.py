#!/usr/bin/env python3
"""OpenEXR fixtures written by the OpenEXR library (Python bindings), each with its expected 8-bit picture.

The expected picture is made from what the library itself decodes (so lossy B44, PXR24 and DWAA are
compared with their own decoded values), tone-mapped the way Anne's Lens shows HDR: × exposure 1,
alpha un-premultiplied, clipped to 0…1, sRGB curve, rounded.

Writes to tests/fixtures/exr/: half-<compression>.exr for none, RLE, ZIPS, ZIP, PIZ, PXR24, B44, B44A;
float-zip.exr, float-piz.exr, float-pxr24.exr; rgba-piz.exr (premultiplied alpha); gray-y.exr (Y only);
layers.exr (diffuse.R/G/B and depth.Z); tiled-zip.exr (16 × 16 tiles), tiled-piz.exr (32 × 32, partial edge tiles);
multipart.exr (two parts); dwaa.exr (refused); and *.png, the expected pictures.
Needs numpy, Pillow and OpenEXR (pip install OpenEXR).
"""
import os
import numpy as np
import OpenEXR
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'exr')
W, H = 70, 50
rng = np.random.default_rng(3)


def scene():
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    r = x / W * 4.0
    g = y / H * 1.5
    b = 0.5 + 0.5 * np.sin(x / 5.0) * np.cos(y / 7.0)
    rgb = np.stack([r, g, b], -1).astype(np.float32)
    rgb[30:40, 5:20] = [-0.2, 0.3, 2.5]
    rgb += rng.random((H, W, 3), dtype=np.float32) * 0.05
    return rgb


def srgb(v):
    v = np.clip(v, 0, 1)
    return np.where(v <= 0.0031308, 12.92 * v, 1.055 * np.power(v, 1 / 2.4) - 0.055)


def reference(path, out_png, keys=('R', 'G', 'B'), alpha=None, part=0):
    f = OpenEXR.File(path, separate_channels=True)
    ch = f.parts[part].channels
    get = lambda k: ch[k].pixels.astype(np.float64)
    if keys == ('Y',):
        y = get('Y'); rgb = np.stack([y, y, y], -1)
    else:
        rgb = np.stack([get(k) for k in keys], -1)
    a = None
    if alpha:
        a = np.clip(get(alpha), 0, 1)
        rgb = np.where(a[..., None] > 0, rgb / np.where(a > 0, a, 1)[..., None], rgb)
    img = np.round(255 * srgb(np.nan_to_num(rgb))).astype(np.uint8)
    if a is not None:
        img = np.concatenate([img, np.round(a * 255).astype(np.uint8)[..., None]], -1)
    Image.fromarray(img).save(out_png)


def tiles(x, y, mode):
    t = OpenEXR.TileDescription(); t.xSize = x; t.ySize = y; t.mode = mode
    return t


def write(path, channels, compression, **header):
    hdr = {'compression': compression, 'type': OpenEXR.scanlineimage, **header}
    OpenEXR.File(hdr, channels).write(path)


def main():
    os.makedirs(OUT, exist_ok=True)
    rgb = scene()
    half = {k: rgb[..., i].astype(np.float16) for i, k in enumerate('RGB')}
    comps = {'none': OpenEXR.NO_COMPRESSION, 'rle': OpenEXR.RLE_COMPRESSION, 'zips': OpenEXR.ZIPS_COMPRESSION, 'zip': OpenEXR.ZIP_COMPRESSION,
             'piz': OpenEXR.PIZ_COMPRESSION, 'pxr24': OpenEXR.PXR24_COMPRESSION, 'b44': OpenEXR.B44_COMPRESSION, 'b44a': OpenEXR.B44A_COMPRESSION}
    for n, c in comps.items():
        p = f'{OUT}/half-{n}.exr'; write(p, half, c); reference(p, p.replace('.exr', '.png'))
    full = {k: rgb[..., i].astype(np.float32) for i, k in enumerate('RGB')}
    for n, c in [('zip', OpenEXR.ZIP_COMPRESSION), ('piz', OpenEXR.PIZ_COMPRESSION), ('pxr24', OpenEXR.PXR24_COMPRESSION)]:
        p = f'{OUT}/float-{n}.exr'; write(p, full, c); reference(p, p.replace('.exr', '.png'))
    # Premultiplied RGBA.
    y, x = np.mgrid[0:H, 0:W]
    a = np.clip((x / W) * 1.2, 0, 1).astype(np.float32)
    rgba = {k: (rgb[..., i] * a).astype(np.float16) for i, k in enumerate('RGB')}; rgba['A'] = a.astype(np.float16)
    p = f'{OUT}/rgba-piz.exr'; write(p, rgba, OpenEXR.PIZ_COMPRESSION); reference(p, p.replace('.exr', '.png'), alpha='A')
    # Luminance only.
    lum = (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]).astype(np.float16)
    p = f'{OUT}/gray-y.exr'; write(p, {'Y': lum}, OpenEXR.ZIP_COMPRESSION); reference(p, p.replace('.exr', '.png'), keys=('Y',))
    # Layers: the first with R, G, B is shown.
    lay = {'depth.Z': (x * 1.0).astype(np.float32), 'diffuse.R': half['R'], 'diffuse.G': half['G'], 'diffuse.B': half['B']}
    p = f'{OUT}/layers.exr'; write(p, lay, OpenEXR.ZIP_COMPRESSION); reference(p, p.replace('.exr', '.png'), keys=('diffuse.R', 'diffuse.G', 'diffuse.B'))
    # Tiled: one level, and a mip map.
    p = f'{OUT}/tiled-zip.exr'
    write(p, half, OpenEXR.ZIP_COMPRESSION, type=OpenEXR.tiledimage, tiles=tiles(16, 16, OpenEXR.ONE_LEVEL)); reference(p, p.replace('.exr', '.png'))
    p = f'{OUT}/tiled-piz.exr'  # 32 × 32 tiles: partial tiles at the right and bottom edges
    write(p, half, OpenEXR.PIZ_COMPRESSION, type=OpenEXR.tiledimage, tiles=tiles(32, 32, OpenEXR.ONE_LEVEL)); reference(p, p.replace('.exr', '.png'))
    # Two parts.
    p = f'{OUT}/multipart.exr'
    parts = [OpenEXR.Part({'compression': OpenEXR.ZIP_COMPRESSION, 'type': OpenEXR.scanlineimage}, half, 'beauty'),
             OpenEXR.Part({'compression': OpenEXR.PIZ_COMPRESSION, 'type': OpenEXR.scanlineimage}, {'Y': lum}, 'luma')]
    OpenEXR.File(parts).write(p)
    reference(p, f'{OUT}/multipart-1.png'); reference(p, f'{OUT}/multipart-2.png', keys=('Y',), part=1)
    write(f'{OUT}/dwaa.exr', half, OpenEXR.DWAA_COMPRESSION)
    for f in sorted(os.listdir(OUT)):
        print(f, os.path.getsize(f'{OUT}/{f}'))


if __name__ == '__main__':
    main()
