"""JPEG-LS test codestreams, encoded with CharLS (BSD-3-Clause) through pyjpegls from pictures the script draws: 2 to
16 bits, lossless and near-lossless, one component and three in each interleave mode, long runs, noise and alternating
columns (escape codes and byte stuffing). Each .jls comes with the samples CharLS decodes it to (.exp, 16-bit
little-endian, pixel-interleaved) and cases.json describes them.

Run from the repository root:  python3 scripts/gen-jpegls-fixtures.py
"""
import json, os
import numpy as np
import jpeg_ls

OUT = 'tests/fixtures/jpegls'
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)


def pic(h, w, bits, comps=1):
    yy, xx = np.mgrid[0:h, 0:w]
    mx = (1 << bits) - 1
    base = ((xx * 5 + yy * 3) * (mx / (5 * w + 3 * h))).astype(np.int64)
    out = np.zeros((h, w, comps), np.int64)
    for c in range(comps):
        a = base + c * 7
        a[h // 4:h // 2, w // 4:w // 2] = mx // 3 + c * 11                   # a flat block (runs)
        a[h // 2:, :] += rng.integers(0, max(2, mx // 8), size=(h - h // 2, w))  # noise
        a[:3, :] = mx                                                        # a bright band
        a[5, :] = np.arange(w) % 2 * mx                                      # alternating columns (large errors)
        out[..., c] = np.clip(a, 0, mx)
    return out[..., 0] if comps == 1 else out


SPECS = [('g8', 20, 33, 8, 1, 0, None), ('g8near2', 20, 33, 8, 1, 2, None), ('g12', 24, 31, 12, 1, 0, None), ('g16', 16, 40, 16, 1, 0, None), ('g16near5', 16, 40, 16, 1, 5, None), ('g4', 12, 17, 4, 1, 0, None), ('g2', 9, 11, 2, 1, 0, None),
         ('rgb8ilv0', 14, 19, 8, 3, 0, 0), ('rgb8ilv1', 14, 19, 8, 3, 0, 1), ('rgb8ilv2', 14, 19, 8, 3, 0, 2), ('rgb8ilv2near3', 14, 19, 8, 3, 3, 2), ('rgb12ilv1', 10, 15, 12, 3, 0, 1), ('rgb16ilv2', 10, 15, 16, 3, 0, 2), ('big', 100, 130, 8, 1, 0, None)]
cases = {}
for name, h, w, bits, comps, near, ilv in SPECS:
    a = pic(h, w, bits, comps)
    arr = a.astype(np.uint8 if bits <= 8 else np.uint16)
    if comps > 1 and ilv == 0:
        arr = np.ascontiguousarray(arr.transpose(2, 0, 1))  # CharLS takes planar input for separate scans
    enc = jpeg_ls.encode_array(arr, lossy_error=near, interleave_mode=ilv)
    open(os.path.join(OUT, f'{name}.jls'), 'wb').write(enc)
    out, meta = jpeg_ls.decode_buffer(bytes(enc))
    exp = np.frombuffer(out, np.uint8 if bits <= 8 else '<u2')
    if comps > 1 and ilv == 0:
        exp = exp.reshape(comps, h, w).transpose(1, 2, 0)  # to pixel-interleaved
    open(os.path.join(OUT, f'{name}.exp'), 'wb').write(np.ascontiguousarray(exp).astype('<u2').tobytes())
    cases[name] = {'w': w, 'h': h, 'bits': bits, 'comps': comps, 'near': near, 'ilv': ilv if comps > 1 else 0, 'maxErr': int(np.abs(np.asarray(exp).reshape(a.shape).astype(np.int64) - a).max())}
json.dump(cases, open(os.path.join(OUT, 'cases.json'), 'w'), indent=1)
print({k: v['maxErr'] for k, v in cases.items()})
