#!/usr/bin/env python3
"""Color-management fixtures: a synthetic v2 CMYK printer profile (lut16 A2B/B2A tables, Lab PCS,
a paper white and a raised black) and LittleCMS reference conversions for the unit tests.
Run `npx vite-node scripts/write-spaces.ts` first; needs Pillow (ImageCms = LittleCMS)."""
import io, json, struct, math, warnings
warnings.filterwarnings("ignore", category=DeprecationWarning)
from PIL import Image, ImageCms

D50 = (0.9642, 1.0, 0.82491)
OUT = 'tests/fixtures/color/'

def s15(v): return struct.pack('>i', int(round(v * 65536)))
def srgb_to_lin(c): return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def lin_to_srgb(c):
    c = max(0.0, min(1.0, c))
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
M = [[0.4360747, 0.3850649, 0.1430804], [0.2225045, 0.7168786, 0.0606169], [0.0139322, 0.0971045, 0.7141733]]
MI = None
def inv(m):
    a, b, c = m[0]; d, e, f = m[1]; g, h, i = m[2]
    A, B, C = e * i - f * h, -(d * i - f * g), d * h - e * g
    det = a * A + b * B + c * C
    return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, -(a * f - c * d) / det], [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]]
MI = inv(M)
def f(t): return t ** (1 / 3) if t > 216 / 24389 else (24389 / 27 * t + 16) / 116
def finv(t): return t ** 3 if t ** 3 > 216 / 24389 else (116 * t - 16) / (24389 / 27)
def xyz_lab(x): fx, fy, fz = (f(x[k] / D50[k]) for k in range(3)); return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))
def lab_xyz(l):
    fy = (l[0] + 16) / 116; fx = fy + l[1] / 500; fz = fy - l[2] / 200
    return [finv(fx) * D50[0], finv(fy) * D50[1], finv(fz) * D50[2]]
def rgb_lab(r, g, b):
    lin = [srgb_to_lin(v) for v in (r, g, b)]
    return xyz_lab([sum(M[k][j] * lin[j] for j in range(3)) for k in range(3)])
def lab_rgb(l):
    x = lab_xyz(l); lin = [sum(MI[k][j] * x[j] for j in range(3)) for k in range(3)]
    return [lin_to_srgb(v) for v in lin]

# The press: CMY subtract from sRGB, K darkens; relative L* runs 14..100 and chroma is 80%.
LMIN, CH = 14.0, 0.8
def device_lab(c, m, y, k):
    L, a, b = rgb_lab((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k))
    return (LMIN + L * (100 - LMIN) / 100, a * CH, b * CH)
def lab_device(L, a, b):
    r, g, bb = lab_rgb(((L - LMIN) * 100 / (100 - LMIN), a / CH, b / CH))
    cmy = [1 - max(0.0, min(1.0, v)) for v in (r, g, bb)]
    k = min(cmy) * 0.9
    return [(v - k) / (1 - k) if k < 1 else 0 for v in cmy] + [k]

def enc_lab(l): return [max(0, min(65535, round(l[0] / 100 * 65280))), max(0, min(65535, round((l[1] + 128) * 256))), max(0, min(65535, round((l[2] + 128) * 256)))]
def dec_lab(v): return (v[0] / 65280 * 100, v[1] / 256 - 128, v[2] / 256 - 128)

def mft2(inch, outch, grid, fn):
    out = b'mft2' + b'\0' * 4 + bytes([inch, outch, grid, 0])
    for r in range(3):
        for c in range(3): out += s15(1.0 if r == c else 0.0)
    out += struct.pack('>HH', 2, 2)
    out += b''.join(struct.pack('>HH', 0, 65535) for _ in range(inch))
    import itertools
    for idx in itertools.product(range(grid), repeat=inch):
        out += b''.join(struct.pack('>H', max(0, min(65535, int(round(v))))) for v in fn([i / (grid - 1) for i in idx]))
    out += b''.join(struct.pack('>HH', 0, 65535) for _ in range(outch))
    return out

a2b = mft2(4, 3, 9, lambda v: enc_lab(device_lab(*v)))
b2a = mft2(3, 4, 17, lambda v: [x * 65535 for x in lab_device(*dec_lab([v[0] * 65535, v[1] * 65535, v[2] * 65535]))])
def desc(s):
    b = s.encode('ascii') + b'\0'
    return b'desc' + b'\0' * 4 + struct.pack('>I', len(b)) + b + b'\0' * 4 + b'\0' * 4 + b'\0' * 3 + b'\0' * 67
def xyz(v): return b'XYZ ' + b'\0' * 4 + b''.join(s15(x) for x in v)
def text(s): return b'text' + b'\0' * 4 + s.encode('ascii') + b'\0'
PAPER = (0.9300, 0.9650, 0.7700)
tags = [(b'desc', desc('Anne\'s Lens test press (synthetic CMYK)')), (b'cprt', text('Public domain test data')), (b'wtpt', xyz(PAPER)), (b'A2B0', a2b), (b'A2B1', a2b), (b'B2A0', b2a), (b'B2A1', b2a)]
table_len = 4 + 12 * len(tags)
off = 128 + table_len; body = b''; table = struct.pack('>I', len(tags)); seen = {}
for sig, data in tags:
    if data in seen: table += sig + struct.pack('>II', *seen[data]); continue
    while (off + len(body)) % 4: body += b'\0'
    at = off + len(body); body += data; seen[data] = (at, len(data))
    table += sig + struct.pack('>II', at, len(data))
while len(body) % 4: body += b'\0'
size = 128 + table_len + len(body)
hdr = struct.pack('>I', size) + b'lcms' + struct.pack('>I', 0x02100000) + b'prtr' + b'CMYK' + b'Lab ' + struct.pack('>6H', 2026, 1, 1, 0, 0, 0) + b'acsp' + b'\0' * 24 + struct.pack('>I', 0) + s15(D50[0]) + s15(D50[1]) + s15(D50[2]) + b'\0' * 4 + b'\0' * 44
assert len(hdr) == 128
icc = hdr + table + body
open(OUT + 'press-cmyk.icc', 'wb').write(icc)

# Reference conversions with LittleCMS.
samples = [(r, g, b) for r in range(0, 256, 51) for g in range(0, 256, 51) for b in range(0, 256, 51)] + [(v, v, v) for v in range(0, 256, 15)] + [(200, 30, 60), (12, 140, 230), (250, 240, 10), (90, 60, 40)]
img = Image.new('RGB', (len(samples), 1)); img.putdata(samples)
prof = lambda n: ImageCms.ImageCmsProfile(OUT + n + '.icc')
press = ImageCms.ImageCmsProfile(io.BytesIO(icc))
def run(src, dst, out_mode, intent=1, flags=0, image=img, in_mode='RGB'):
    t = ImageCms.buildTransform(src, dst, in_mode, out_mode, renderingIntent=intent, flags=flags | ImageCms.Flags.HIGHRESPRECALC)
    return [list(p) if isinstance(p, tuple) else [p] for p in ImageCms.applyTransform(image, t).getdata()]
exp = {'samples': samples, 'convert': {}, 'press': {}}
for n in ['p3', 'adobergb', 'prophoto', 'rec2020', 'srgb-linear']: exp['convert']['srgb>' + n] = run(prof('srgb'), prof(n), 'RGB')
for n in ['gray22', 'graysrgb']: exp['convert']['srgb>' + n] = run(prof('srgb'), prof(n), 'L')
exp['convert']['prophoto>srgb'] = run(prof('prophoto'), prof('srgb'), 'RGB')
exp['convert']['builtin-srgb>p3'] = run(ImageCms.createProfile('sRGB'), prof('p3'), 'RGB')
exp['press']['srgb>press:relative'] = run(prof('srgb'), press, 'CMYK', 1)
exp['press']['srgb>press:perceptual'] = run(prof('srgb'), press, 'CMYK', 0)
exp['press']['srgb>press:relative+bpc'] = run(prof('srgb'), press, 'CMYK', 1, ImageCms.Flags.BLACKPOINTCOMPENSATION)
cm = Image.new('CMYK', (len(samples), 1)); cm.putdata([tuple(p) for p in exp['press']['srgb>press:relative']])
exp['press']['press>srgb:relative'] = run(press, prof('srgb'), 'RGB', 1, 0, cm, 'CMYK')
exp['press']['press>srgb:absolute'] = run(press, prof('srgb'), 'RGB', 3, 0, cm, 'CMYK')
def proof(intent, proof_intent):
    t = ImageCms.buildProofTransform(prof('srgb'), prof('srgb'), press, 'RGB', 'RGB', renderingIntent=intent, proofRenderingIntent=proof_intent, flags=ImageCms.Flags.SOFTPROOFING | ImageCms.Flags.HIGHRESPRECALC)
    return [list(p) for p in ImageCms.applyTransform(img, t).getdata()]
exp['proof'] = {'relative': proof(1, 1), 'paper': proof(1, 3)}
# Tagged pictures for the end-to-end test: left half (180, 60, 60), right half (0, 200, 0) in the Adobe RGB-compatible space.
tagged = Image.new('RGB', (64, 48), (180, 60, 60)); tagged.paste((0, 200, 0), (32, 0, 64, 48))
adobe = open(OUT + 'adobergb.icc', 'rb').read()
tagged.save(OUT + 'tagged-adobergb.png', icc_profile=adobe)
tagged.save(OUT + 'tagged-adobergb.jpg', icc_profile=adobe, quality=100, subsampling=0)
pair = Image.new('RGB', (2, 1)); pair.putdata([(180, 60, 60), (0, 200, 0)])
exp['tagged'] = {'adobergb>srgb': [list(p) for p in ImageCms.applyTransform(pair, ImageCms.buildTransform(prof('adobergb'), prof('srgb'), 'RGB', 'RGB', renderingIntent=1, flags=ImageCms.Flags.HIGHRESPRECALC)).getdata()],
                 'adobergb>gray22': [list(p) if isinstance(p, tuple) else [p] for p in ImageCms.applyTransform(pair, ImageCms.buildTransform(prof('adobergb'), prof('gray22'), 'RGB', 'L', renderingIntent=1)).getdata()]}
json.dump(exp, open(OUT + 'lcms-reference.json', 'w'), separators=(',', ':'))
print('press profile', len(icc), 'bytes;', sum(len(v) for v in exp['convert'].values()) + sum(len(v) for v in exp['press'].values()), 'reference colors')
