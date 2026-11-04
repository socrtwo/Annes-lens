#!/usr/bin/env python3
"""MacPaint, Amiga IFF (ILBM/PBM) and Kodak Photo CD fixtures, with expected pictures.

Writes to tests/fixtures/retro/:
  paint.mac, paint-macbinary.bin   a MacPaint document (PackBits, written here), plain and in a MacBinary file
  paint.png                        expected: ImageMagick's decoding of paint.mac (it reads MacPaint)
  photo.pcd                        a Photo CD image written by ImageMagick (it writes the Base, Base/4, Base/16 images)
  photo.png                        expected: Pillow's decoding (Kodak's Photo YCC conversion; ImageMagick's own
                                   transform differs from Kodak's, so its decoding is not used)
  ILBM/PBM files written here from the EA IFF-85 and ILBM descriptions (no tool here reads or writes them):
  planes4.iff     4 bitplanes, ByteRun1, 16-color palette                     expected: planes4.png
  mask.iff        5 bitplanes + mask plane, uncompressed                       expected: mask.png (alpha from the mask)
  transparent.iff 3 bitplanes, transparent color 0 (masking 2)                expected: transparent.png
  ehb.iff         Extra Half-Brite (6 planes, 32 colors + their halves)        expected: ehb.png
  ham6.iff, ham8.iff   HAM, encoded from a gradient                            expected: ham6.png, ham8.png (decoded here)
  deep24.iff      24-bit ILBM                                                  expected: deep24.png
  chunky.lbm      PBM (Deluxe Paint II), ByteRun1                              expected: chunky.png
  ocs.iff         4-bit (OCS) palette values in the high nibble                expected: ocs.png (widened: 0xF0 → 0xFF)
  cycle.iff       a CRNG color-cycling range over colors 1–8                   expected: cycle-0.png … cycle-7.png
Needs numpy, Pillow (with PCD support) and ImageMagick (convert).
"""
import os, struct, subprocess
import numpy as np
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'retro')


def png(a, name):
    Image.fromarray(a).save(os.path.join(OUT, name))


def packbits(row: bytes) -> bytes:
    """PackBits / ByteRun1: runs of 3 or more as (1 - n, byte), literals as (n - 1, bytes)."""
    out, i, n = bytearray(), 0, len(row)
    while i < n:
        j = i
        while j + 1 < n and row[j + 1] == row[i] and j - i < 127: j += 1
        if j - i >= 2:
            out += bytes([(257 - (j - i + 1)) & 255, row[i]]); i = j + 1; continue
        k = i
        while k < n and k - i < 128 and not (k + 2 < n and row[k] == row[k + 1] == row[k + 2]): k += 1
        out += bytes([k - i - 1]) + row[i:k]; i = k
    return bytes(out)


def macpaint():
    im = Image.new('1', (576, 720), 1); d = ImageDraw.Draw(im)
    d.rectangle((20, 20, 300, 140), outline=0, width=3); d.ellipse((330, 30, 550, 200), fill=0)
    d.text((40, 60), "MacPaint 1984 - Anne's Lens", fill=0)
    for k in range(0, 576, 12): d.line((k, 260, 575 - k, 420), fill=0)
    a = np.array(im); a[450:700, 40:300] = np.random.default_rng(5).random((250, 260)) > 0.5
    bits = np.packbits(~a, axis=1)  # 1 = black
    header = struct.pack('>I', 2) + bytes(i % 256 for i in range(304)) + bytes(204)  # version, 38 patterns, padding: 512 bytes
    data = header + b''.join(packbits(bytes(r)) for r in bits)
    open(f'{OUT}/paint.mac', 'wb').write(data)
    name = b'Family Tree'
    mb = bytearray(128); mb[1] = len(name); mb[2:2 + len(name)] = name; mb[65:69] = b'PNTG'; mb[69:73] = b'MPNT'
    mb[83:87] = struct.pack('>I', len(data))
    open(f'{OUT}/paint-macbinary.bin', 'wb').write(bytes(mb) + data + bytes((-len(data)) % 128))
    subprocess.run(['convert', f'MAC:{OUT}/paint.mac', f'{OUT}/paint.png'], check=True)
    ref = np.array(Image.open(f'{OUT}/paint.png').convert('L')) > 127
    assert (ref == a).all(), 'ImageMagick and the drawn picture disagree'


def pcd():
    y, x = np.mgrid[0:512, 0:768]
    rgb = np.stack([x // 3, y // 2, (x + y) // 5], -1).astype(np.uint8)
    rgb[100:200, 100:300] = [250, 20, 40]
    src = f'{OUT}/pcd-src.png'; Image.fromarray(rgb).save(src)
    subprocess.run(['convert', src, f'PCD:{OUT}/photo.pcd'], check=True); os.remove(src)
    Image.open(f'{OUT}/photo.pcd').convert('RGB').save(f'{OUT}/photo.png')


# IFF -------------------------------------------------------------------------------------------------
def chunk(cid, data):
    return cid + struct.pack('>I', len(data)) + data + (b'\0' if len(data) & 1 else b'')


def bmhd(w, h, planes, masking=0, compression=1, transparent=0):
    return chunk(b'BMHD', struct.pack('>HHhhBBBBHBBhh', w, h, 0, 0, planes, masking, compression, 0, transparent, 10, 11, w, h))


def body_planar(values, planes, compression, mask=None):
    """values: h × w of indexes (or packed RGB for deep); rows of `planes` (+ mask) interleaved bitplanes."""
    h, w = values.shape; rb = ((w + 15) // 16) * 2; out = bytearray()
    for y in range(h):
        rows = []
        for k in range(planes):
            bits = np.zeros(rb * 8, np.uint8); bits[:w] = (values[y] >> k) & 1
            rows.append(np.packbits(bits).tobytes())
        if mask is not None:
            bits = np.zeros(rb * 8, np.uint8); bits[:w] = mask[y]; rows.append(np.packbits(bits).tobytes())
        out += b''.join(packbits(r) if compression else r for r in rows)
    return bytes(out)


def ilbm(name, w, h, planes, body, cmap=None, masking=0, compression=1, camg=None, transparent=0, extra=b'', pbm=False):
    form = (b'PBM ' if pbm else b'ILBM') + bmhd(w, h, planes, masking, compression, transparent)
    if cmap is not None: form += chunk(b'CMAP', bytes(np.array(cmap, np.uint8).ravel()))
    if camg is not None: form += chunk(b'CAMG', struct.pack('>I', camg))
    form += extra + chunk(b'BODY', body)
    open(f'{OUT}/{name}', 'wb').write(b'FORM' + struct.pack('>I', len(form)) + form)


def ham_encode(rgb, bits):
    """A simple HAM encoder: a palette entry when it is exact, else change one component of the previous pixel."""
    pal = [[(i * 255) // 15] * 3 for i in range(16)] if bits == 4 else [[(i * 255) // 63] * 3 for i in range(64)]
    q = lambda v: (v >> (8 - bits))
    h, w, _ = rgb.shape; out = np.zeros((h, w), np.uint32)
    for y in range(h):
        cur = pal[0]
        for x in range(w):
            t = [q(int(v)) for v in rgb[y, x]]; c = [q(v) for v in cur]
            diffs = [abs(t[i] - c[i]) for i in range(3)]
            i = int(np.argmax(diffs)); ctl = [2, 3, 1][i]
            out[y, x] = (ctl << bits) | t[i]
            cur = cur.copy(); cur[i] = (t[i] << (8 - bits)) | (t[i] if bits == 4 else t[i] >> (2 * bits - 8))
    return out, pal


def ham_decode(vals, pal, bits):
    h, w = vals.shape; out = np.zeros((h, w, 3), np.uint8)
    for y in range(h):
        cur = list(pal[0])
        for x in range(w):
            v = int(vals[y, x]); ctl, val = v >> bits, v & ((1 << bits) - 1)
            ext = (val << (8 - bits)) | (val if bits == 4 else val >> (2 * bits - 8))
            if ctl == 0: cur = list(pal[val])
            else: cur = cur.copy(); cur[{1: 2, 2: 0, 3: 1}[ctl]] = ext
            out[y, x] = cur
    return out


def iff():
    rng = np.random.default_rng(9)
    W, H = 50, 30
    y, x = np.mgrid[0:H, 0:W]
    pal16 = [[(i * 17) % 256, (i * 53) % 256, (i * 97) % 256] for i in range(16)]
    idx = ((x // 4 + y // 3) % 16).astype(np.uint32); idx[5:12, 10:30] = 3
    ilbm('planes4.iff', W, H, 4, body_planar(idx, 4, 1), pal16)
    png(np.array(pal16, np.uint8)[idx], 'planes4.png')
    pal32 = [[(i * 8) % 256, 255 - i * 8, (i * 37) % 256] for i in range(32)]
    idx5 = ((x + y) % 32).astype(np.uint32); m = ((x - 25) ** 2 + (y - 15) ** 2 < 140).astype(np.uint8)
    ilbm('mask.iff', W, H, 5, body_planar(idx5, 5, 0, m), pal32, masking=1, compression=0)
    png(np.dstack([np.array(pal32, np.uint8)[idx5], m * 255]).astype(np.uint8), 'mask.png')
    idx3 = ((x // 7 + y // 5) % 8).astype(np.uint32); pal8 = pal16[:8]
    ilbm('transparent.iff', W, H, 3, body_planar(idx3, 3, 1), pal8, masking=2, transparent=0)
    png(np.dstack([np.array(pal8, np.uint8)[idx3], np.where(idx3 == 0, 0, 255)]).astype(np.uint8), 'transparent.png')
    idx6 = ((x + 2 * y) % 64).astype(np.uint32)
    ehbpal = np.array(pal32 + [[v >> 1 for v in c] for c in pal32], np.uint8)
    ilbm('ehb.iff', W, H, 6, body_planar(idx6, 6, 1), pal32, camg=0x80)
    png(ehbpal[idx6], 'ehb.png')
    grad = np.stack([x * 5, y * 8, (x * 3 + y * 4) % 256], -1).astype(np.uint8)
    for bits, planes, name in [(4, 6, 'ham6'), (6, 8, 'ham8')]:
        vals, pal = ham_encode(grad, bits)
        ilbm(f'{name}.iff', W, H, planes, body_planar(vals, planes, 1), pal, camg=0x800)
        png(ham_decode(vals, pal, bits), f'{name}.png')
    rgb = np.stack([x * 5, y * 8, rng.integers(0, 256, (H, W))], -1).astype(np.uint8)
    packed = rgb[..., 0].astype(np.uint32) | (rgb[..., 1].astype(np.uint32) << 8) | (rgb[..., 2].astype(np.uint32) << 16)
    ilbm('deep24.iff', W, H, 24, body_planar(packed, 24, 1))
    png(rgb, 'deep24.png')
    pal256 = [[i, (i * 7) % 256, 255 - i] for i in range(256)]
    chunky = ((x * 5 + y * 3) % 256).astype(np.uint8)
    rows = b''.join(packbits(bytes(r) + (b'\0' if W & 1 else b'')) for r in chunky)
    ilbm('chunky.lbm', W, H, 8, rows, pal256, pbm=True)
    png(np.array(pal256, np.uint8)[chunky], 'chunky.png')
    ocs = [[(i * 16) & 0xF0, ((15 - i) * 16) & 0xF0, 0xF0] for i in range(16)]
    ilbm('ocs.iff', W, H, 4, body_planar(idx, 4, 1), ocs)
    png(np.array([[v | (v >> 4) for v in c] for c in ocs], np.uint8)[idx], 'ocs.png')
    cyc = ((x // 3) % 9).astype(np.uint32)
    crng = chunk(b'CRNG', struct.pack('>hhhBB', 0, 8192, 1, 1, 8))  # pad, rate (30 steps a second), active, low, high
    ilbm('cycle.iff', W, H, 4, body_planar(cyc, 4, 1), pal16, extra=crng)
    pal = [list(c) for c in pal16]
    for k in range(8):
        png(np.array(pal, np.uint8)[cyc], f'cycle-{k}.png')
        seg = pal[1:9]; pal[1:9] = [seg[-1]] + seg[:-1]


def main():
    os.makedirs(OUT, exist_ok=True)
    macpaint(); pcd(); iff()
    for f in sorted(os.listdir(OUT)):
        print(f, os.path.getsize(os.path.join(OUT, f)))


if __name__ == '__main__':
    main()
