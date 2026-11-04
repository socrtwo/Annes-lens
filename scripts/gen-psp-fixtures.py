#!/usr/bin/env python3
"""Paint Shop Pro (.psp, .pspimage) test files, written here from the PSP file format description (Jasc's
specification for format versions 3–6), and GIMP's PSP reader (written from that specification) as the reference.

Writes to tests/fixtures/psp/ (expected: <name>.png, GIMP's merge of the visible layers):
  rgb-none.psp rgb-rle.psp rgb-lz77.psp   one 24-bit raster layer, uncompressed, RLE and LZ77 (zlib)
  layers.psp     a background layer and a smaller layer placed at an offset, with a transparency mask and 50%
                 opacity
  multiply.psp   a second layer in Multiply blend mode; screen, darken, lighten, difference, hue, saturation, color,
                 luminosity, overlay, hardlight, softlight, dodge, burn, exclusion.psp: those modes;
  hidden.psp     an invisible layer
  pal8.psp       8 bits with a 256-color palette;  gray.psp: 8-bit grayscale
  odd.psp        a width that is not a multiple of four (8-bit rows are not padded)
  pal4.psp       4 bits with a palette (packed rows padded to four bytes), an odd width
  mono.psp       1 bit, the same packing: expected mono.png is the picture written (GIMP shifts its rows)
  psp5.psp       format version 5 (Paint Shop Pro 7);  psp3.psp: format version 3 (Paint Shop Pro 5)
Needs numpy, Pillow and GIMP 2.10 (gimp-console).
"""
import os, struct, subprocess, tempfile, zlib
import numpy as np
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'psp')
SIG = b'Paint Shop Pro Image File\n\x1a'.ljust(32, b'\0')


def block(bid, data):
    return b'~BK\0' + struct.pack('<HI', bid, len(data)) + data


def rle(b):
    """PSP RLE: a count above 128 repeats the next byte (count - 128) times, else count literal bytes follow."""
    o, i, n = bytearray(), 0, len(b)
    while i < n:
        j = i
        while j < n and j - i < 127 and b[j] == b[i]:
            j += 1
        if j - i >= 3:
            o += bytes([128 + (j - i), b[i]])
            i = j
            continue
        j = i
        while j < n and j - i < 128 and not (j + 2 < n and b[j] == b[j + 1] == b[j + 2]):
            j += 1
        o += bytes([j - i]) + bytes(b[i:j])
        i = j
    return bytes(o)


def compress(raw, comp):
    return raw if comp == 0 else rle(raw) if comp == 1 else zlib.compress(raw)


def rows(plane, bits=8):
    """Channel rows: 8-bit samples as they are; 1- and 4-bit samples packed, each row padded to four bytes."""
    if bits == 8:
        return plane.tobytes()
    h, w = plane.shape
    per = 8 // bits
    out = b''
    for y in range(h):
        line = bytearray((w + per - 1) // per)
        for x in range(w):
            line[x // per] |= int(plane[y, x]) << (8 - bits * (x % per + 1))
        out += bytes(line) + bytes((-len(line)) % 4)
    return out


def channel(plane, bitmap_type, channel_type, comp, bits=8):
    raw = rows(plane, bits)
    data = compress(raw, comp)
    info = struct.pack('<IIIHH', 16, len(data), len(raw), bitmap_type, channel_type)
    return block(5, info + data)


def layer(name, rect, pixels, alpha=None, opacity=255, blend=0, visible=1, comp=2, gray=False, major=6, bits=8):
    """pixels: h × w × 3 (RGB) or h × w (palette or gray); rect: left, top in the image."""
    h, w = pixels.shape[:2]
    left, top = rect
    nm = name.encode('latin-1')
    rect_img = struct.pack('<4i', left, top, left + w, top + h)
    rect_saved = struct.pack('<4i', 0, 0, w, h)
    rect_mask = struct.pack('<4i', 0, 0, 0, 0)
    body = (struct.pack('<H', len(nm)) + nm + bytes([1]) + rect_img + rect_saved
            + bytes([opacity, blend, visible, 0, 0]) + rect_mask + rect_mask + bytes([0, 0, 0]) + struct.pack('<H', 0))
    if major >= 6:
        body += bytes([0]) + struct.pack('<I', 0)  # (version 6) a layer-group link and the graphic contents
    info = struct.pack('<I', 4 + len(body)) + body
    chans = []
    if pixels.ndim == 3:
        for k, ct in ((2, 3), (1, 2), (0, 1)):  # blue, green, red channels
            chans.append(channel(pixels[..., k], 0, ct, comp))
    else:
        chans.append(channel(pixels, 0, 0, comp, bits))
    if alpha is not None:
        chans.append(channel(alpha, 1, 0, comp))
    binfo = struct.pack('<IHH', 8, 1 + (alpha is not None), len(chans))
    return block(4, info + binfo + b''.join(chans))


def image(path, w, h, layers, comp=2, depth=24, gray=False, palette=None, major=6):
    attrs = struct.pack('<iidBHHHIBIiH', w, h, 72.0, 1, comp, depth, 1, 1 << depth if depth <= 8 else 1 << 24, 1 if gray else 0, w * h * (3 if depth == 24 else 1), 0, len(layers))
    if major >= 5:
        attrs += struct.pack('<I', 1)  # graphic contents: raster layers
    out = SIG + struct.pack('<HH', major, 0) + block(0, struct.pack('<I', 4 + len(attrs)) + attrs)
    if palette is not None:
        out += block(2, struct.pack('<II', 8, len(palette)) + b''.join(bytes([b, g, r, 0]) for r, g, b in palette))
    out += block(3, b''.join(layers))
    open(path, 'wb').write(out)


def image_v3(path):
    """Format version 3 (Paint Shop Pro 5): the block header gives the info length, no chunk sizes, 256-byte names."""
    def blk(bid, data, init=None):
        return b'~BK\0' + struct.pack('<HII', bid, len(data) if init is None else init, len(data)) + data

    def chan(plane, bt, ct):
        raw = plane.tobytes(); d = zlib.compress(raw)
        return blk(5, struct.pack('<IIHH', len(d), len(raw), bt, ct) + d, 12)

    def lay(name, left, top_, px, alpha=None):
        h, w = px.shape[:2]
        info = (name.encode().ljust(256, b'\0') + bytes([0]) + struct.pack('<4i', left, top_, left + w, top_ + h) + struct.pack('<4i', 0, 0, w, h)
                + bytes([255, 0, 1, 0, 0]) + bytes(32) + bytes([0, 0, 0]) + struct.pack('<H', 0))
        ch = [chan(px[..., k], 0, ct) for k, ct in ((2, 3), (1, 2), (0, 1))] + ([chan(alpha, 1, 0)] if alpha is not None else [])
        info += struct.pack('<HH', 1 + (alpha is not None), len(ch))
        return blk(4, info + b''.join(ch), len(info))
    y, x = np.mgrid[0:40, 0:64]
    rgb = np.stack([x * 4, y * 6, 255 - x * 4], -1).astype(np.uint8)
    yy, xx = np.mgrid[0:16, 0:24]
    top = np.zeros((16, 24, 3), np.uint8); top[..., 0] = 250; top[..., 1] = 200; top[..., 2] = 20
    mask = np.where((xx - 12) ** 2 + (yy - 8) ** 2 < 49, 255, 0).astype(np.uint8)
    attrs = struct.pack('<iidBHHHIBIiH', 64, 40, 72.0, 1, 2, 24, 1, 1 << 24, 0, 64 * 40 * 3, 0, 2)
    open(path, 'wb').write(SIG + struct.pack('<HH', 3, 0) + blk(0, attrs) + blk(3, lay('Background', 0, 0, rgb) + lay('Sun', 30, 10, top, mask), 0))


def gimp_flatten(names):
    script = ''.join(
        '(let* ((img (car (file-psp-load RUN-NONINTERACTIVE "{0}" "{0}"))) (lay (car (gimp-image-merge-visible-layers img CLIP-TO-IMAGE)))) '
        '(file-png-save RUN-NONINTERACTIVE img lay "{1}" "{1}" 0 9 0 0 0 0 0))'.format(os.path.join(OUT, n + '.psp'), os.path.join(OUT, n + '.png'))
        for n in names)
    subprocess.run(['gimp-console', '-i', '-d', '-f', '-b', script, '-b', '(gimp-quit 0)'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    os.makedirs(OUT, exist_ok=True)
    y, x = np.mgrid[0:40, 0:64]
    rgb = np.stack([x * 4, y * 6, 255 - x * 4], -1).astype(np.uint8)
    for n, comp in (('rgb-none', 0), ('rgb-rle', 1), ('rgb-lz77', 2)):
        image(os.path.join(OUT, n + '.psp'), 64, 40, [layer('Background', (0, 0), rgb, comp=comp)], comp=comp)
    yy, xx = np.mgrid[0:16, 0:24]
    top = np.zeros((16, 24, 3), np.uint8); top[..., 0] = 250; top[..., 1] = 200; top[..., 2] = 20
    mask = np.where((xx - 12) ** 2 + (yy - 8) ** 2 < 49, 255, np.where(xx < 4, 0, 128)).astype(np.uint8)
    image(os.path.join(OUT, 'layers.psp'), 64, 40, [layer('Background', (0, 0), rgb), layer('Sun', (30, 10), top, alpha=mask, opacity=128)])
    for n, mode in (('multiply', 7), ('screen', 8), ('darken', 1), ('lighten', 2), ('difference', 13), ('hue', 3), ('saturation', 4), ('color', 5), ('luminosity', 6), ('overlay', 10), ('hardlight', 11), ('softlight', 12), ('dodge', 14), ('burn', 15), ('exclusion', 16)):
        image(os.path.join(OUT, n + '.psp'), 64, 40, [layer('Background', (0, 0), rgb), layer('Tint', (8, 4), top, blend=mode)])
    image(os.path.join(OUT, 'hidden.psp'), 64, 40, [layer('Background', (0, 0), rgb), layer('Hidden', (8, 4), top, visible=0)])
    pal = [((i * 7) % 256, i, 255 - i) for i in range(256)]
    idx = ((x + y * 3) % 256).astype(np.uint8)
    image(os.path.join(OUT, 'pal8.psp'), 64, 40, [layer('Background', (0, 0), idx)], depth=8, palette=pal)
    gray = ((x * 3 + y * 2) % 256).astype(np.uint8)
    image(os.path.join(OUT, 'gray.psp'), 64, 40, [layer('Background', (0, 0), gray)], depth=8, gray=True, palette=[(i, i, i) for i in range(256)])
    yo, xo = np.mgrid[0:21, 0:37]
    odd = np.stack([xo * 6, yo * 12, (xo + yo) * 4], -1).astype(np.uint8)
    image(os.path.join(OUT, 'odd.psp'), 37, 21, [layer('Background', (0, 0), odd, comp=1)], comp=1)
    # 1 and 4 bits (palettes), odd widths.
    i4 = ((xo + yo) % 16).astype(np.uint8)
    image(os.path.join(OUT, 'pal4.psp'), 37, 21, [layer('Background', (0, 0), i4, bits=4, comp=1)], comp=1, depth=4, palette=[(i * 17, 255 - i * 17, (i * 50) % 256) for i in range(16)])
    i1 = ((xo // 3 + yo // 3) % 2).astype(np.uint8)
    image(os.path.join(OUT, 'mono.psp'), 37, 21, [layer('Background', (0, 0), i1, bits=1, comp=2)], comp=2, depth=1, palette=[(255, 255, 255), (0, 0, 128)])
    image(os.path.join(OUT, 'psp5.psp'), 64, 40, [layer('Background', (0, 0), rgb, major=5), layer('Sun', (30, 10), top, alpha=mask, major=5)], major=5)
    image_v3(os.path.join(OUT, 'psp3.psp'))
    # GIMP reads the 1-bit file with each row after the first shifted by two pixels (no padding rule explains it),
    # so its expected picture is the one written, not GIMP's: 1-bit pictures are checked against this script only.
    gimp_flatten(['rgb-none', 'rgb-rle', 'rgb-lz77', 'layers', 'multiply', 'screen', 'darken', 'lighten', 'difference', 'hue', 'saturation', 'color', 'luminosity', 'overlay', 'hardlight', 'softlight', 'dodge', 'burn', 'exclusion', 'hidden', 'pal8', 'gray', 'odd', 'pal4', 'psp5', 'psp3'])
    Image.fromarray(np.array([(255, 255, 255), (0, 0, 128)], np.uint8)[i1]).save(os.path.join(OUT, 'mono.png'))


if __name__ == '__main__':
    main()
