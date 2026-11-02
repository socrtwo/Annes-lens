#!/usr/bin/env python3
"""Synthetic DNG fixtures for Develop RAW, with LibRaw (rawpy) reference conversions.

Writes to tests/fixtures/raw/:
  synth.dng           uncompressed 16-bit CFA (RGGB) in IFD0, per-position black levels, 14-bit white level
  synth-lj92.dng      the same scene, lossless-JPEG tiles (two components per frame), raw in a SubIFD
                      behind an RGB thumbnail, GRBG pattern, a linearization table, Orientation 6
  synth-packed.dng    12-bit packed strips (BGGR)
  *.cfa.bin           LibRaw's raw_image_visible (uint16 little-endian), to check decoding exactly
  *.srgb.png          LibRaw: bilinear demosaic, camera white balance, clip highlights, sRGB, sRGB tone curve, 8-bit
Needs numpy, rawpy and Pillow.
"""
import os, struct, heapq
import numpy as np
import rawpy
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'raw')
W, H = 192, 128
# XYZ -> camera (a Canon-like ColorMatrix for D65) and the scene's as-shot neutral follow from it.
CM = np.array([[0.4716, 0.0603, -0.0830], [-0.7798, 1.5474, 0.2480], [-0.1496, 0.1937, 0.6651]])
SRGB_XYZ = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])


def scene():
    """Linear sRGB scene: gradients, soft colored patches, fine stripes and a blown highlight."""
    y, x = np.mgrid[0:H, 0:W].astype(np.float64)
    r = 0.15 + 0.6 * x / W
    g = 0.2 + 0.5 * y / H
    b = 0.25 + 0.3 * np.sin(x / 9.0) * np.cos(y / 13.0) + 0.2
    img = np.stack([r, g, b], -1)
    for cx, cy, col in [(40, 40, (0.8, 0.1, 0.1)), (100, 70, (0.1, 0.7, 0.2)), (150, 35, (0.15, 0.2, 0.85)), (60, 100, (0.9, 0.8, 0.1))]:
        d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
        a = np.clip((18 - d) / 4, 0, 1)[..., None]
        img = img * (1 - a) + np.array(col) * a
    stripes = (np.sin(x * 0.9) > 0) & (y > 108)
    img[stripes] *= 0.4
    hot = ((x - 170) ** 2 + (y - 100) ** 2) < 12 ** 2
    img[hot] = [3.0, 2.6, 2.2]  # clips on the sensor
    return np.clip(img, 0, None)


def camera_raw(img, black, white, pattern, scale=0.55):
    """Mosaic of camera values for a CFA pattern (2x2 list of color indexes)."""
    xyz = img @ SRGB_XYZ.T
    cam = xyz @ CM.T
    neutral = CM @ SRGB_XYZ @ np.ones(3)
    neutral = neutral / neutral[1]
    cam = cam * scale
    mos = np.zeros((H, W))
    for dy in range(2):
        for dx in range(2):
            mos[dy::2, dx::2] = cam[dy::2, dx::2, pattern[dy][dx]]
    raw = np.clip(np.round(mos * (white - max(black)) + np.array([[black[0], black[1]], [black[2], black[3]]])[np.arange(H)[:, None] % 2, np.arange(W)[None, :] % 2]), 0, white)
    return raw.astype(np.uint16), neutral


# TIFF writing ------------------------------------------------------------------------------------
BYTE, ASCII, SHORT, LONG, RATIONAL, SRATIONAL = 1, 2, 3, 4, 5, 10


def rat(v, signed=False):
    d = 10000
    return (int(round(v * d)), d)


def pack_values(t, vals):
    if t == BYTE:
        return bytes(vals)
    if t == ASCII:
        return vals.encode() + b'\0'
    if t == SHORT:
        return struct.pack('<%dH' % len(vals), *vals)
    if t == LONG:
        return struct.pack('<%dI' % len(vals), *vals)
    if t == RATIONAL:
        return b''.join(struct.pack('<II', *rat(v)) for v in vals)
    if t == SRATIONAL:
        return b''.join(struct.pack('<ii', *rat(v, True)) for v in vals)
    raise ValueError(t)


def count_of(t, vals):
    return len(vals) + 1 if t == ASCII else len(vals)


class Tiff:
    """Little-endian TIFF builder: IFDs with deferred offsets."""

    def __init__(self):
        self.buf = bytearray(b'II*\0\0\0\0\0')

    def blob(self, data):
        if len(self.buf) % 2:
            self.buf += b'\0'
        off = len(self.buf)
        self.buf += data
        return off

    def ifd(self, entries, next_off=0):
        """entries: list of (tag, type, values). Returns the IFD's offset."""
        entries = sorted(entries, key=lambda e: e[0])
        extra = []
        if len(self.buf) % 2:
            self.buf += b'\0'
        off = len(self.buf)
        size = 2 + 12 * len(entries) + 4
        data_at = off + size
        body = bytearray(struct.pack('<H', len(entries)))
        tail = bytearray()
        for tag, t, vals in entries:
            raw = pack_values(t, vals)
            n = count_of(t, vals)
            if len(raw) <= 4:
                body += struct.pack('<HHI', tag, t, n) + raw.ljust(4, b'\0')
            else:
                if (data_at + len(tail)) % 2:
                    tail += b'\0'
                body += struct.pack('<HHII', tag, t, n, data_at + len(tail))
                tail += raw
        body += struct.pack('<I', next_off)
        self.buf += body + tail
        return off

    def set_first(self, off):
        struct.pack_into('<I', self.buf, 4, off)


def dng_ifd0_tags(neutral, orientation=1):
    return [
        (271, ASCII, 'Anne'), (272, ASCII, 'Synthetic'), (274, SHORT, [orientation]),
        (50706, BYTE, [1, 4, 0, 0]), (50707, BYTE, [1, 1, 0, 0]), (50708, ASCII, 'Anne Synthetic'),
        (50721, SRATIONAL, list(CM.flatten())), (50778, SHORT, [21]),
        (50728, RATIONAL, list(neutral)),
    ]


def raw_tags(pattern, black, white, bits=16, compression=1):
    return [
        (254, LONG, [0]), (256, LONG, [W]), (257, LONG, [H]), (258, SHORT, [bits]), (259, SHORT, [compression]),
        (262, SHORT, [32803]), (277, SHORT, [1]), (284, SHORT, [1]),
        (33421, SHORT, [2, 2]), (33422, BYTE, [pattern[0][0], pattern[0][1], pattern[1][0], pattern[1][1]]),
        (50713, SHORT, [2, 2]), (50714, LONG, list(black)), (50717, LONG, [white]),
    ]


# Lossless JPEG (ITU T.81 process 14, predictor 1) ------------------------------------------------
def huff_lengths(freq):
    syms = [s for s in range(17) if freq[s]]
    if len(syms) == 1:
        return {syms[0]: 1}
    heap = [(freq[s], i, [s]) for i, s in enumerate(syms)]
    heapq.heapify(heap)
    depth = {s: 0 for s in syms}
    k = len(heap)
    while len(heap) > 1:
        a, b = heapq.heappop(heap), heapq.heappop(heap)
        for s in a[2] + b[2]:
            depth[s] += 1
        k += 1
        heapq.heappush(heap, (a[0] + b[0], k, a[2] + b[2]))
    assert max(depth.values()) <= 16
    return depth


def lj92(samples, fw, fh, comps, precision):
    """samples: (fh, fw*comps) uint16, interleaved components."""
    s = samples.astype(np.int64)
    pred = np.zeros_like(s)
    pred[0, :comps] = 1 << (precision - 1)
    pred[0, comps:] = s[0, :-comps]
    pred[1:, :comps] = s[:-1, :comps]
    pred[1:, comps:] = s[1:, :-comps]
    diff = (s - pred + 32768) % 65536 - 32768
    cat = np.where(diff == 0, 0, np.floor(np.log2(np.abs(diff) + 0.5)).astype(np.int64) + 1)
    cat = np.where(diff == -32768, 16, cat)
    freq = np.bincount(cat.ravel(), minlength=17)
    lens = huff_lengths(freq)
    order = sorted(lens, key=lambda v: (lens[v], v))
    codes, code, prev = {}, 0, lens[order[0]]
    for i, v in enumerate(order):
        if i:
            code = (code + 1) << (lens[v] - prev)
        codes[v] = (code, lens[v])
        prev = lens[v]
    counts = [sum(1 for v in order if lens[v] == L) for L in range(1, 17)]
    out = bytearray(b'\xff\xd8')
    dht = bytes([0x00]) + bytes(counts) + bytes(order)
    out += b'\xff\xc4' + struct.pack('>H', 2 + len(dht)) + dht
    sof = struct.pack('>BHHB', precision, fh, fw, comps) + b''.join(bytes([i + 1, 0x11, 0]) for i in range(comps))
    out += b'\xff\xc3' + struct.pack('>H', 2 + len(sof)) + sof
    sos = bytes([comps]) + b''.join(bytes([i + 1, 0x00]) for i in range(comps)) + bytes([1, 0, 0])
    out += b'\xff\xda' + struct.pack('>H', 2 + len(sos)) + sos
    acc, nbits, body = 0, 0, bytearray()

    def put(v, n):
        nonlocal acc, nbits
        acc = (acc << n) | (v & ((1 << n) - 1))
        nbits += n
        while nbits >= 8:
            nbits -= 8
            byte = (acc >> nbits) & 0xFF
            body.append(byte)
            if byte == 0xFF:
                body.append(0)
        acc &= (1 << nbits) - 1 if nbits else 0

    for d, c in zip(diff.ravel(), cat.ravel()):
        code, L = codes[int(c)]
        put(code, L)
        if 0 < c < 16:
            put(int(d) if d > 0 else int(d) - 1, int(c))
    if nbits:
        put((1 << (8 - nbits)) - 1, 8 - nbits)
    out += body + b'\xff\xd9'
    return bytes(out)


def write(name, tiff):
    with open(os.path.join(OUT, name), 'wb') as f:
        f.write(bytes(tiff.buf))


def reference(name):
    path = os.path.join(OUT, name)
    with rawpy.imread(path) as r:
        np.asarray(r.raw_image_visible, dtype='<u2').tofile(os.path.join(OUT, name.replace('.dng', '.cfa.bin')))
        rgb = r.postprocess(demosaic_algorithm=rawpy.DemosaicAlgorithm.LINEAR, use_camera_wb=True, no_auto_bright=True,
                            output_color=rawpy.ColorSpace.sRGB, gamma=(2.4, 12.92), output_bps=8,
                            highlight_mode=rawpy.HighlightMode.Clip, user_flip=0)
    Image.fromarray(rgb).save(os.path.join(OUT, name.replace('.dng', '.srgb.png')))


def main():
    os.makedirs(OUT, exist_ok=True)
    img = scene()
    # 1. Uncompressed, IFD0 only.
    black, white, pat = [512, 514, 510, 512], 15000, [[0, 1], [1, 2]]
    raw, neutral = camera_raw(img, black, white, pat)
    t = Tiff()
    data = t.blob(raw.astype('<u2').tobytes())
    off = t.ifd(dng_ifd0_tags(neutral) + raw_tags(pat, black, white) + [(273, LONG, [data]), (278, LONG, [H]), (279, LONG, [raw.size * 2])])
    t.set_first(off)
    write('synth.dng', t)
    # 2. Lossless JPEG tiles in a SubIFD, GRBG, a linearization table (gamma 2 stored values), Orientation 6.
    black2, white2, pat2 = [256, 256, 256, 256], 4095, [[1, 0], [2, 1]]
    raw2, neutral2 = camera_raw(img, black2, white2, pat2)
    lin = [int(round(i * i / 4095)) for i in range(4096)]  # stored value i means i²/4095
    inv = np.searchsorted(np.array(lin), raw2, side='left').clip(0, 4095).astype(np.uint16)
    t = Tiff()
    TW = TL = 64
    tiles = []
    for ty in range(0, H, TL):
        for tx in range(0, W, TW):
            tile = inv[ty:ty + TL, tx:tx + TW]
            tiles.append(t.blob(lj92(tile, TW // 2, TL, 2, 12)))
    lens_ = [0] * len(tiles)
    blobs = bytes(t.buf)
    # Lengths: each tile runs to the next blob (blobs are contiguous apart from padding).
    ends = tiles[1:] + [len(t.buf)]
    lens_ = [e - s for s, e in zip(tiles, ends)]
    thumb = np.zeros((16, 24, 3), np.uint8) + 128
    th = t.blob(thumb.tobytes())
    raw_ifd = t.ifd(raw_tags(pat2, black2, white2, bits=12, compression=7) + [
        (322, LONG, [TW]), (323, LONG, [TL]), (324, LONG, tiles), (325, LONG, lens_), (50712, SHORT, lin)])
    ifd0 = t.ifd(dng_ifd0_tags(neutral2, 6) + [
        (254, LONG, [1]), (256, LONG, [24]), (257, LONG, [16]), (258, SHORT, [8, 8, 8]), (259, SHORT, [1]), (262, SHORT, [2]),
        (277, SHORT, [3]), (273, LONG, [th]), (278, LONG, [16]), (279, LONG, [thumb.size]), (330, LONG, [raw_ifd])])
    t.set_first(ifd0)
    write('synth-lj92.dng', t)
    # 3. 12-bit packed, BGGR, two strips.
    black3, white3, pat3 = [128, 128, 128, 128], 4000, [[2, 1], [1, 0]]
    raw3, neutral3 = camera_raw(img, black3, white3, pat3)
    v = raw3.astype(np.uint32).ravel()
    packed = bytearray()
    for i in range(0, len(v), 2):
        a, b = int(v[i]), int(v[i + 1])
        packed += bytes([a >> 4, ((a & 15) << 4) | (b >> 8), b & 255])
    half = len(packed) // 2
    t = Tiff()
    s1, s2 = t.blob(bytes(packed[:half])), t.blob(bytes(packed[half:]))
    off = t.ifd(dng_ifd0_tags(neutral3) + raw_tags(pat3, black3, white3, bits=12) + [(273, LONG, [s1, s2]), (278, LONG, [H // 2]), (279, LONG, [half, len(packed) - half])])
    t.set_first(off)
    write('synth-packed.dng', t)
    for n in ['synth.dng', 'synth-lj92.dng', 'synth-packed.dng']:
        reference(n)
        print('wrote', n)


if __name__ == '__main__':
    main()
