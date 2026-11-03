#!/usr/bin/env python3
"""TIFF fixtures written by libtiff (Pillow, tifffile + imagecodecs), each with the expected picture.

Writes to tests/fixtures/tiff/:
  fax-rle.tif, fax-g3.tif, fax-g3-2d.tif, fax-g4.tif, fax-g4-lsb.tif   a 1000 × 300 page (text, rules, a block,
      noise) as CCITT RLE, Group 3 one- and two-dimensional, Group 4, and Group 4 with FillOrder 2
  fax-wide-g3.tif, fax-wide-g4.tif   2700 × 40 with runs past 2560 (extended make-up codes)
  fax*.png / fax-wide.png            the expected black and white pictures
  planar-rgb.tif (8-bit, Deflate + horizontal predictor), planar-rgb16.tif (16-bit, LZW)   with planar-rgb.png
  float-gray.tif (32-bit, 0…1), float-pred.tif (32-bit RGB, Deflate + floating-point predictor), half-gray.tif
      (16-bit floats), dem-int16.tif (signed, −120…2300)   with *.png: the expected 8-bit pictures
  cmyk-icc.tif (8-bit CMYK with tests/fixtures/color/press-cmyk.icc embedded), cmyk16-icc.tif (16-bit)
  cmyk-icc.png   LittleCMS (ImageCms): press profile → sRGB, relative colorimetric, no black point compensation
  cmyk-plain.tif + cmyk-plain.png    CMYK without a profile: 255 − min(255, C + K) and so on
  zstd-rgb.tif (8-bit, horizontal predictor, 16-row strips), zstd-rgb16.tif, lzma-rgb.tif, webp-rgb.tif
      (lossless WebP, 32 × 32 tiles): the planar-rgb.png picture with other compressions
  lab-cie.tif (CIELab, signed a/b), lab-icc.tif (ICCLab, a/b + 128), lab-icc16.tif (16-bit ICCLab): that
      picture in L*a*b* (D50), computed with the CIE formulas; its expected picture is planar-rgb.png itself
Needs numpy, Pillow (with libtiff), tifffile, imagecodecs.
"""
import io, os
import numpy as np
import tifffile
from PIL import Image, ImageDraw, ImageCms

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'tiff')
PRESS = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'color', 'press-cmyk.icc')
rng = np.random.default_rng(7)


def page():
    im = Image.new('1', (1000, 300), 1)
    d = ImageDraw.Draw(im)
    for i, line in enumerate(['Anne\'s Lens: CCITT fax test page', 'The quick brown fox jumps over the lazy dog 0123456789',
                              'Certificate of Baptism, parish register, folio 117', 'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ']):
        d.text((30, 20 + i * 22), line, fill=0)
    d.line((20, 120, 980, 120), fill=0, width=3)
    d.rectangle((700, 150, 960, 280), fill=0)
    d.rectangle((740, 180, 900, 250), fill=1)
    for x in range(30, 680, 9):
        d.line((x, 140, x + 40, 290), fill=0)
    a = np.array(im)
    a[150:290, 400:640] = rng.random((140, 240)) > 0.5
    return Image.fromarray(a)


def wide():
    a = np.ones((40, 2700), bool)
    a[5:15, 100:2690] = False      # a black run of 2590
    a[20:25, :] = False            # whole rows black
    a[30:35, 2650:2700] = False    # white run of 2650 then black
    return Image.fromarray(a)


def main():
    os.makedirs(OUT, exist_ok=True)
    p = page()
    p.save(os.path.join(OUT, 'fax.png'))
    for name, comp, info in [('rle', 'tiff_ccitt', {}), ('g3', 'group3', {}), ('g3-2d', 'group3', {292: 1}), ('g4', 'group4', {}), ('g4-lsb', 'group4', {266: 2})]:
        p.save(os.path.join(OUT, f'fax-{name}.tif'), compression=comp, tiffinfo=info, dpi=(200, 200))
    wd = wide()
    wd.save(os.path.join(OUT, 'fax-wide.png'))
    wd.save(os.path.join(OUT, 'fax-wide-g3.tif'), compression='group3')
    wd.save(os.path.join(OUT, 'fax-wide-g4.tif'), compression='group4')

    # Planar RGB.
    y, x = np.mgrid[0:48, 0:64]
    rgb = np.stack([x * 4, y * 5, (x + y) * 2], -1).astype(np.uint8)
    rgb[10:20, 10:30] = [250, 20, 40]
    tifffile.imwrite(os.path.join(OUT, 'planar-rgb.tif'), np.moveaxis(rgb, -1, 0), photometric='rgb', planarconfig='separate', compression='zlib', predictor=True, rowsperstrip=16)
    tifffile.imwrite(os.path.join(OUT, 'planar-rgb16.tif'), np.moveaxis(rgb.astype(np.uint16) * 257, -1, 0), photometric='rgb', planarconfig='separate', compression='lzw')
    Image.fromarray(rgb).save(os.path.join(OUT, 'planar-rgb.png'))

    # Floats and signed integers.
    f = ((x + y * 64) / (64 * 48)).astype(np.float32)
    tifffile.imwrite(os.path.join(OUT, 'float-gray.tif'), f, photometric='minisblack')
    Image.fromarray(np.round(f * 255).astype(np.uint8)).save(os.path.join(OUT, 'float-gray.png'))
    frgb = (rgb.astype(np.float32) / 255)
    tifffile.imwrite(os.path.join(OUT, 'float-pred.tif'), frgb, photometric='rgb', compression='zlib', predictor=3)
    Image.fromarray(np.round(frgb * 255).astype(np.uint8)).save(os.path.join(OUT, 'float-pred.png'))
    tifffile.imwrite(os.path.join(OUT, 'half-gray.tif'), f.astype(np.float16), photometric='minisblack')
    Image.fromarray(np.round(f.astype(np.float16).astype(np.float64) * 255).astype(np.uint8)).save(os.path.join(OUT, 'half-gray.png'))
    dem = (np.sin(x / 9.0) * np.cos(y / 7.0) * 1210 + 1090).astype(np.int16)
    dem[0, 0], dem[0, 1] = -120, 2300
    tifffile.imwrite(os.path.join(OUT, 'dem-int16.tif'), dem, photometric='minisblack')
    lo, hi = float(dem.min()), float(dem.max())
    Image.fromarray(np.round(np.clip((dem - lo) * (255 / (hi - lo)), 0, 255)).astype(np.uint8)).save(os.path.join(OUT, 'dem-int16.png'))

    # CMYK with and without a profile.
    cmyk = np.stack([x * 4, y * 5, ((x * 3 + y * 2) % 256), np.where(x > 48, 120, 0) + (y > 40) * 100], -1).astype(np.uint8)
    icc = open(PRESS, 'rb').read()
    tifffile.imwrite(os.path.join(OUT, 'cmyk-icc.tif'), cmyk, photometric='separated', extratags=[(34675, 7, len(icc), icc, True)])
    tifffile.imwrite(os.path.join(OUT, 'cmyk16-icc.tif'), cmyk.astype(np.uint16) * 257, photometric='separated', extratags=[(34675, 7, len(icc), icc, True)])
    src = ImageCms.ImageCmsProfile(io.BytesIO(icc)); dst = ImageCms.createProfile('sRGB')
    out = ImageCms.profileToProfile(Image.fromarray(cmyk, 'CMYK'), src, dst, renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC, outputMode='RGB')
    out.save(os.path.join(OUT, 'cmyk-icc.png'))
    tifffile.imwrite(os.path.join(OUT, 'cmyk-plain.tif'), cmyk, photometric='separated')
    c, m, yy, k = [cmyk[..., i].astype(int) for i in range(4)]
    plain = np.stack([255 - np.minimum(255, c + k), 255 - np.minimum(255, m + k), 255 - np.minimum(255, yy + k)], -1).astype(np.uint8)
    Image.fromarray(plain).save(os.path.join(OUT, 'cmyk-plain.png'))
    more(rgb)
    for f in sorted(os.listdir(OUT)):
        print(f, os.path.getsize(os.path.join(OUT, f)))


def more(rgb):
    """Newer compressions (libtiff codes 50000 ZSTD, 34925 LZMA, 50001 WebP) and CIE L*a*b*."""
    tifffile.imwrite(os.path.join(OUT, 'zstd-rgb.tif'), rgb, photometric='rgb', compression='zstd', predictor=True, rowsperstrip=16)
    tifffile.imwrite(os.path.join(OUT, 'zstd-rgb16.tif'), rgb.astype(np.uint16) * 257, photometric='rgb', compression='zstd')
    tifffile.imwrite(os.path.join(OUT, 'lzma-rgb.tif'), rgb, photometric='rgb', compression='lzma', rowsperstrip=24)
    tifffile.imwrite(os.path.join(OUT, 'webp-rgb.tif'), rgb, photometric='rgb', compression='webp', compressionargs={'level': 100, 'lossless': True}, tile=(32, 32))
    # L*a*b* computed exactly (standard CIE formulas, sRGB D65 → Bradford → D50) and rounded to 8 and 16 bits; the
    # expected picture is the original (LittleCMS's own 8-bit Lab path interpolates a grid and is less exact near the gamut edge).
    L, a, b = srgb_to_lab(rgb)
    i8 = lambda v: np.clip(np.round(v), -128, 127).astype(np.int8)
    tifffile.imwrite(os.path.join(OUT, 'lab-cie.tif'), np.stack([np.round(L * 255 / 100).astype(np.uint8), i8(a).view(np.uint8), i8(b).view(np.uint8)], -1), photometric='cielab')
    tifffile.imwrite(os.path.join(OUT, 'lab-icc.tif'), np.stack([np.round(L * 255 / 100).astype(np.uint8), (i8(a).astype(int) + 128).astype(np.uint8), (i8(b).astype(int) + 128).astype(np.uint8)], -1), photometric=9)
    u16 = lambda v: np.clip(np.round(v * 256 + 32768), 0, 65535).astype(np.uint16)
    tifffile.imwrite(os.path.join(OUT, 'lab-icc16.tif'), np.stack([np.round(L * 65535 / 100).astype(np.uint16), u16(a), u16(b)], -1), photometric=9)


def srgb_to_lab(rgb):
    c = rgb.astype(np.float64) / 255
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    brad = np.array([[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]])
    d65, d50 = np.array([0.95047, 1.0, 1.08883]), np.array([0.9642, 1.0, 0.82491])
    adapt = np.linalg.inv(brad) @ np.diag((brad @ d50) / (brad @ d65)) @ brad
    xyz = lin @ (adapt @ m).T / d50
    f = np.where(xyz > (6 / 29) ** 3, np.cbrt(xyz), xyz / (3 * (6 / 29) ** 2) + 4 / 29)
    return 116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])

if __name__ == '__main__':
    main()
