"""Tile-compressed FITS fixtures (the FITS 4.0 standard, section 10), written with astropy: RICE_1, GZIP_1, GZIP_2,
PLIO_1 and HCOMPRESS_1 tiles; 8-, 16- and 32-bit integers, 32- and 64-bit floats (quantized without dither, with
SUBTRACTIVE_DITHER_1 and _2, and lossless), partial tiles, a cube, BLANK and NaN nulls. Each file comes with the values
astropy reads back (.bin, float64 little-endian, NaN for nulls) and tiled.json describes them.

Run from the repository root:  python3 scripts/gen-fits-tiled-fixtures.py
"""
import json, os
import numpy as np
from astropy.io import fits

OUT = 'tests/fixtures/fits'
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(5)
manifest = {}


def field(h, w, scale=1.0, noise=0.0):
    yy, xx = np.mgrid[0:h, 0:w]
    a = (np.sin(xx / 4.0) * 20 + yy * 3 + np.exp(-((xx - w * 0.7) ** 2 + (yy - h * 0.4) ** 2) / 12.0) * 300) * scale
    if noise:
        a = a + rng.normal(0, noise, size=a.shape)
    return a


def write(name, data, compression, header=None, **kw):
    hdu = fits.CompImageHDU(data=data, compression_type=compression, **kw)
    if header:
        for k, v in header.items():
            hdu.header[k] = v
    hdul = fits.HDUList([fits.PrimaryHDU(), hdu])
    path = os.path.join(OUT, name)
    hdul.writeto(path, overwrite=True)
    back = fits.open(path)[1]
    got = np.asarray(back.data, dtype=np.float64)
    open(path[:-5] + '.bin', 'wb').write(got.astype('<f8').tobytes())
    hdr = back._bintable.header if hasattr(back, '_bintable') else fits.open(path, disable_image_compression=True)[1].header
    manifest[name] = {'shape': list(got.shape), 'compression': compression, 'zbitpix': int(hdr['ZBITPIX']), 'tiles': [int(hdr[f'ZTILE{i + 1}']) for i in range(int(hdr['ZNAXIS']))],
                      'quantiz': hdr.get('ZQUANTIZ'), 'lossy': bool(data.dtype.kind == 'f' and kw.get('quantize_level', 16.0) != 0) or bool(kw.get('hcomp_scale', 0)),
                      'maxErr': float(np.nanmax(np.abs(got - data))) if data.dtype.kind == 'f' else int(np.nanmax(np.abs(got - data)))}
    return hdr


h, w = 60, 100
i16 = np.round(field(h, w)).astype(np.int16)
hdr = write('rice-i16.fits', i16, 'RICE_1', tile_shape=(7, 13))
print('rice-i16 columns', [hdr[f'TFORM{i + 1}'] for i in range(hdr['TFIELDS'])], 'ZNAME', [hdr.get(f'ZNAME{i + 1}') for i in range(2)], 'THEAP', hdr.get('THEAP'), 'PCOUNT', hdr['PCOUNT'])
write('rice-i32-cube.fits', np.stack([np.round(field(20, 30) * 1000).astype(np.int32) + z * 50000 for z in range(3)]), 'RICE_1', tile_shape=(2, 8, 9))
write('rice-u8.fits', np.clip(np.round(field(24, 40) / 2 + 100), 0, 255).astype(np.uint8), 'RICE_1')
f32 = field(h, w, 0.37, 0.5).astype(np.float32)
f32[5:9, 10:20] = np.nan
write('rice-f32-nodither.fits', f32, 'RICE_1', quantize_level=16, quantize_method=-1)
write('rice-f32-dither1.fits', f32, 'RICE_1', quantize_level=16, quantize_method=1, dither_seed=42)
f32z = f32.copy(); f32z[20:30, 30:50] = 0.0
write('rice-f32-dither2.fits', f32z, 'RICE_1', quantize_level=16, quantize_method=2, dither_seed=777, tile_shape=(10, 50))
write('gzip1-f32-lossless.fits', f32, 'GZIP_1', quantize_level=0)
write('gzip1-f64.fits', field(16, 24).astype(np.float64), 'GZIP_1', quantize_level=0)
write('gzip2-i16.fits', i16, 'GZIP_2', tile_shape=(16, 100))
mask = np.zeros((30, 40), np.int32)
mask[5:15, 8:30] = 3; mask[10:25, 20:35] = 7; mask[2, :] = np.arange(40) % 5
write('plio-mask.fits', mask, 'PLIO_1')
write('hcomp-i16.fits', i16, 'HCOMPRESS_1', tile_shape=(30, 50))
write('hcomp-i32-lossy.fits', np.round(field(40, 64) * 100).astype(np.int32), 'HCOMPRESS_1', hcomp_scale=3, hcomp_smooth=1)
write('hcomp-f32.fits', f32, 'HCOMPRESS_1', quantize_level=16, quantize_method=-1, hcomp_scale=0)
blank = i16.copy(); blank[3:6, 3:9] = -999
write('rice-i16-blank.fits', blank, 'RICE_1', header={'BLANK': -999})
write('gzip1-tiny.fits', np.arange(64, dtype=np.int16).reshape(8, 8) * 100, 'GZIP_1')
write('nocompress-i16.fits', i16[:10, :20], 'NOCOMPRESS')
with open(os.path.join(OUT, 'tiled.json'), 'w') as f:
    json.dump(manifest, f, indent=1, sort_keys=True)
for k, v in manifest.items():
    print(k, v)
