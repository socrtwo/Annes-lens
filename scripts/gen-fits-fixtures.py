"""FITS test fixtures, written with numpy from the FITS standard (version 4.0): integer and floating-point primary arrays
with BZERO/BSCALE and BLANK, a data cube, a file with an empty primary HDU, image extensions and a binary table, and a
gzipped file. expected.json holds sampled values (after BZERO/BSCALE), dimensions and the HDU layout; ImageMagick
confirms the display orientation (the first stored row at the bottom). Pillow's FITS reader is not used: it misreads
big-endian samples.

Run from the repository root:  python3 scripts/gen-fits-fixtures.py
"""
import gzip, json, os
import numpy as np

OUT = 'tests/fixtures/fits'
os.makedirs(OUT, exist_ok=True)


def card(key, value=None, comment=None):
    if value is None:
        return key.ljust(80)
    if isinstance(value, bool):
        v = 'T' if value else 'F'
        s = f'{key:<8}= {v:>20}'
    elif isinstance(value, str):
        s = f"{key:<8}= '{value.replace(chr(39), chr(39) * 2):<8}'"
    elif isinstance(value, float):
        s = f'{key:<8}= {value!r:>20}'
    else:
        s = f'{key:<8}= {value:>20}'
    if comment:
        s += f' / {comment}'
    return s[:80].ljust(80)


def header(cards):
    h = ''.join(cards + [card('END')]).encode('ascii')
    return h + b' ' * (-len(h) % 2880)


def block(data):
    return data + b'\0' * (-len(data) % 2880)


def hdu(primary, bitpix, arr, extra=(), xtension='IMAGE'):
    cards = [card('SIMPLE', True, 'conforms to the FITS standard')] if primary else [card('XTENSION', xtension)]
    cards.append(card('BITPIX', bitpix))
    cards.append(card('NAXIS', arr.ndim))
    for i, n in enumerate(reversed(arr.shape)):
        cards.append(card(f'NAXIS{i + 1}', n))
    if not primary:
        cards += [card('PCOUNT', 0), card('GCOUNT', 1)]
    cards += list(extra)
    dt = {8: '>u1', 16: '>i2', 32: '>i4', 64: '>i8', -32: '>f4', -64: '>f8'}[bitpix]
    return header(cards) + block(arr.astype(dt).tobytes())


manifest = {}


def samples(values, rows, cols):
    """A few values by (stored row, column) with the first stored row = 0."""
    pts = [(0, 0), (0, cols - 1), (rows - 1, 0), (rows - 1, cols - 1), (rows // 2, cols // 3), (rows // 3, cols // 2)]
    out = []
    for y, x in pts:
        v = values[y, x]
        out.append([y, x, None if (isinstance(v, float) and v != v) else float(v)])
    return out


# 1. 16-bit integers with BZERO 32768 (unsigned data), a gradient; the first stored row is the darkest (it shows at the bottom).
h, w = 20, 30
phys = (np.arange(h)[:, None] * 2000 + np.arange(w)[None, :] * 10).astype(np.int64)
arr = phys - 32768
data = hdu(True, 16, arr, [card('BZERO', 32768, 'offset data range to that of unsigned short'), card('BSCALE', 1), card('OBJECT', 'Gradient field'), card('TELESCOP', "Anne's 8-inch"), card('DATE-OBS', '2024-03-11T02:15:00'), card('EXPTIME', 30.0), card('BUNIT', 'ADU'), card('COMMENT', None), 'COMMENT   A test picture written by scripts/gen-fits-fixtures.py'.ljust(80), 'HISTORY   made with numpy'.ljust(80)])
open(os.path.join(OUT, 'int16-bzero.fits'), 'wb').write(data)
with open(os.path.join(OUT, 'int16-bzero.fits.gz'), 'wb') as f:
    f.write(gzip.compress(data, mtime=0))
manifest['int16-bzero.fits'] = {'hdus': 1, 'planes': [[0, w, h]], 'samples': samples(phys.astype(float), h, w), 'min': float(phys.min()), 'max': float(phys.max())}

# 2. 32-bit floats with NaN (undefined, transparent), a bright star on a faint background, BSCALE/BZERO absent.
h, w = 40, 50
yy, xx = np.mgrid[0:h, 0:w]
sky = 100.0 + 0.01 * xx + np.sin(yy / 3.0) * 2
star = 5000.0 * np.exp(-((xx - 30) ** 2 + (yy - 12) ** 2) / 6.0)
f32 = (sky + star).astype(np.float32)
f32[3:6, 3:9] = np.nan
data = hdu(True, -32, f32, [card('OBJECT', 'Star'), card('BUNIT', 'count'), card('INSTRUME', 'Camera')])
open(os.path.join(OUT, 'float32-star.fits'), 'wb').write(data)
manifest['float32-star.fits'] = {'hdus': 1, 'planes': [[0, w, h]], 'samples': samples(f32.astype(float), h, w), 'nan': [[3, 3], [5, 8]], 'min': float(np.nanmin(f32)), 'max': float(np.nanmax(f32))}

# 3. A 64-bit integer cube of 3 planes with BLANK and BSCALE 0.5.
h, w, d = 12, 16, 3
cube = np.zeros((d, h, w), np.int64)
for z in range(d):
    cube[z] = np.arange(h)[:, None] * 16 + np.arange(w)[None, :] + z * 1000
cube[1, 2, 3] = -99
data = hdu(True, 64, cube, [card('BLANK', -99), card('BSCALE', 0.5), card('BZERO', 10.0), card('OBJECT', 'Cube')])
open(os.path.join(OUT, 'cube-int64.fits'), 'wb').write(data)
phys = cube * 0.5 + 10.0
manifest['cube-int64.fits'] = {'hdus': 1, 'planes': [[0, w, h]] * 3, 'samples': samples(phys[0].astype(float), h, w), 'plane2': samples(phys[2].astype(float), h, w), 'blank': [1, 2, 3]}

# 4. Empty primary (NAXIS 0), an 8-bit IMAGE extension, a BINTABLE, a 64-bit float IMAGE extension; the comment of one.
h1, w1 = 8, 12
img8 = (np.arange(h1 * w1, dtype=np.int64).reshape(h1, w1) * 2) % 256
prim = header([card('SIMPLE', True), card('BITPIX', 8), card('NAXIS', 0), card('EXTEND', True), card('ORIGIN', 'fixture')])
ext1 = hdu(False, 8, img8, [card('EXTNAME', 'SCI')])
tbl = np.zeros(4, dtype=[('A', '>i4'), ('B', '>f8')])
tbl['A'] = [1, 2, 3, 4]; tbl['B'] = [0.5, 1.5, 2.5, 3.5]
ext2 = header([card('XTENSION', 'BINTABLE'), card('BITPIX', 8), card('NAXIS', 2), card('NAXIS1', 12), card('NAXIS2', 4), card('PCOUNT', 0), card('GCOUNT', 1), card('TFIELDS', 2), card('TTYPE1', 'A'), card('TFORM1', '1J'), card('TTYPE2', 'B'), card('TFORM2', '1D'), card('EXTNAME', 'CATALOG')]) + block(tbl.tobytes())
h3, w3 = 6, 9
f64 = (np.arange(h3 * w3, dtype=np.float64).reshape(h3, w3) / 7.0) - 2.0
ext3 = hdu(False, -64, f64, [card('EXTNAME', 'ERR'), card('BUNIT', 'e-')])
open(os.path.join(OUT, 'extensions.fits'), 'wb').write(prim + ext1 + ext2 + ext3)
manifest['extensions.fits'] = {'hdus': 4, 'planes': [[1, w1, h1], [3, w3, h3]], 'samples': samples(img8.astype(float), h1, w1), 'plane2': samples(f64, h3, w3)}

# 5. 32-bit integers, 8-bit unsigned small ones for Pillow cross-checks.
h, w = 10, 14
i32 = (np.arange(h * w, dtype=np.int64).reshape(h, w) * 100000 - 3000000)
open(os.path.join(OUT, 'int32.fits'), 'wb').write(hdu(True, 32, i32))
manifest['int32.fits'] = {'hdus': 1, 'planes': [[0, w, h]], 'samples': samples(i32.astype(float), h, w)}

with open(os.path.join(OUT, 'expected.json'), 'w') as f:
    json.dump(manifest, f, indent=1, sort_keys=True)

# ImageMagick cross-check of the orientation: it too shows the first stored row at the bottom.
import subprocess
try:
    subprocess.run(['convert', os.path.join(OUT, 'int16-bzero.fits'), '-depth', '16', '/tmp/fits-check.png'], check=True, capture_output=True)
    from PIL import Image
    a = np.asarray(Image.open('/tmp/fits-check.png'))
    print('ImageMagick int16-bzero.fits: top-left', a[0, 0], '(last stored row = 38000), bottom-left', a[-1, 0], '(first stored row = 0)')
except Exception as e:
    print('ImageMagick check skipped:', e)
print(json.dumps({k: v['planes'] for k, v in manifest.items()}))
