#!/usr/bin/env python3
"""FlashPix test files: ImageMagick's PerlMagick samples (ImageMagick License; tests/fixtures/flashpix/LICENSE-ImageMagick),
made by Kodak's FlashPix toolkit through ImageMagick from its 70 x 46 rose, fetched at a pinned commit.

Writes to tests/fixtures/flashpix/:
  input_bw.fpx input_grayscale.fpx input_256.fpx input_truecolor.fpx   uncompressed tiles (monochrome, NIF RGB)
  input_jpeg.fpx                                                        JPEG tiles with shared tables
  rose.png             the same rose, lossless (PerlMagick's png/input_truecolor.png)
  <name>.pillow.png    Pillow's decoding (with olefile); its edge tiles are wrong (it takes their stored width
                       for 6 pixels, not 64), so only the first tile column is compared with it
  input_truecolor.decoded.png  the whole picture decoded here from the uncompressed tiles (olefile + numpy)
  input_jpeg.libjpeg.png  the JPEG tiles put together here (shared tables + tile) and decoded by libjpeg
                       (Pillow cannot read this file)
  View transforms (Section 7 of the FlashPix specification), written here into copies of input_truecolor.fpx with
  scripts/cfbwrite.py (no tool here writes them; the expected pictures come from numpy operations on the decoded source for
  the pixel-exact cases, and from this script's reading of the specification for the color ones):
    view-roi.fpx       a rectangle of interest alone: the rest transparent            expected: view-roi.png
    view-crop.fpx      the rectangle mapped onto the result rectangle (a crop)        expected: view-crop.png
    view-rot90.fpx     a quarter turn clockwise, result aspect ratio 46/70            expected: view-rot90.png
    view-flip.fpx      a horizontal flip                                             expected: view-flip.png
    view-color.fpx     a colortwist (luma +10 %, chroma -20 %) and contrast 1.2       expected: view-color.png
    view-cached.fpx    a transform with a cached result image object (the gray rose), which readers must show as it is
                                                                                     expected: input_grayscale.pillow.png
Needs Pillow and olefile; downloads with a generic client name.
"""
import io, os, struct, sys, urllib.request, uuid
import numpy as np
import olefile
sys.path.insert(0, os.path.dirname(__file__))
import cfbwrite
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
    views()


# --- View transforms -------------------------------------------------------------------------------------------
FMT_DESC = uuid.UUID('56616080-C154-11CE-8553-00AA00A1F95B')
FMT_TRANSFORM = uuid.UUID('56616A00-C154-11CE-8553-00AA00A1F95B')
FMT_OPERATION = uuid.UUID('56616E00-C154-11CE-8553-00AA00A1F95B')
FMT_GLOBAL = uuid.UUID('56616F00-C154-11CE-8553-00AA00A1F95B')
VT_I2, VT_R4, VT_UI4, VT_CLSID, VT_VECTOR = 2, 4, 19, 72, 0x1000


def propset(fmtid, props):
    """An OLE property set with one section. props: {id: (type, value)}; vectors as lists."""
    body = b''
    entries = []
    for pid, (t, v) in props.items():
        if t & VT_VECTOR:
            base = t & 0xFFF
            data = struct.pack('<I', len(v)) + b''.join(struct.pack('<f', x) if base == VT_R4 else struct.pack('<I', x) for x in v)
        elif t == VT_R4:
            data = struct.pack('<f', v)
        elif t == VT_UI4:
            data = struct.pack('<I', v)
        elif t == VT_I2:
            data = struct.pack('<hxx', v)
        elif t == VT_CLSID:
            data = v.bytes_le
        else:
            raise ValueError(t)
        entries.append((pid, struct.pack('<I', t) + data))
    head = 8 + 8 * len(entries)
    section = b''
    offs = []
    for pid, data in entries:
        offs.append((pid, head + len(section)))
        section += data + bytes((-len(data)) % 4)
    sec = struct.pack('<II', head + len(section), len(entries)) + b''.join(struct.pack('<II', pid, o) for pid, o in offs) + section
    return struct.pack('<HHI', 0xFFFE, 0, 2) + bytes(16) + struct.pack('<I', 1) + fmtid.bytes_le + struct.pack('<I', 48) + sec


def view_file(name, transform, cached=None):
    """A copy of input_truecolor.fpx with a transform property set, the result description, the operation, and the
    global info pointing at the result; `cached`: the streams of a result image object store to include."""
    streams, root, clsids = cfbwrite.read_all(os.path.join(OUT, 'input_truecolor.fpx'))
    t = {0x00010000: (VT_CLSID, uuid.uuid4()), 0x00010001: (VT_CLSID, FMT_TRANSFORM), 0x00010100: (VT_UI4 | VT_VECTOR, [1]), 0x00010101: (VT_UI4 | VT_VECTOR, [2]), 0x00010102: (VT_UI4, 1)}
    t.update(transform)
    streams['\x05Transform 000001'] = propset(FMT_TRANSFORM, t)
    streams['\x05Operation 000001'] = propset(FMT_OPERATION, {0x00010000: (VT_CLSID, FMT_TRANSFORM)})
    result = {0x00010000: (VT_CLSID, uuid.uuid4()), 0x00010100: (VT_UI4, 0x00000001 if cached else 0), 0x00010101: (VT_UI4, 1), 0x00010102: (VT_UI4 | VT_VECTOR, [])}
    if cached:
        for k, v in cached['streams'].items():
            streams['Data Object Store 000002/' + k] = v
        for k, v in cached['clsids'].items():
            clsids['Data Object Store 000002' + k] = v
        result[0x10000000] = (VT_UI4, cached['height']); result[0x10000001] = (VT_UI4, cached['width'])
    streams['\x05Data Object 000002'] = propset(FMT_DESC, result)
    streams['\x05Global Info'] = propset(FMT_GLOBAL, {0x00010100: (VT_UI4 | VT_VECTOR, [2]), 0x00010101: (VT_UI4, 2), 0x00010102: (VT_UI4, 1), 0x00010103: (VT_UI4, 1)})
    cfbwrite.write(os.path.join(OUT, name), streams, root, clsids)


def ycc_twist(rgb, m, contrast):
    """This script's reading of 7.2.4 and 7.2.5: normalized PhotoYCC from the nonlinear RGB (eq. 5.5), the 4 x 4
    colortwist, back to RGB, then the contrast curve of eq. 7.6 on values centered on 0.5."""
    r, g, b = [rgb[..., i] / 255.0 for i in range(3)]
    y = 0.299 * r + 0.587 * g + 0.114 * b; c1 = -0.299 * r - 0.587 * g + 0.886 * b; c2 = 0.701 * r - 0.587 * g - 0.114 * b
    v = np.stack([y, c1, c2, np.ones_like(y)], -1) @ np.array(m).reshape(4, 4).T
    y, c1, c2 = v[..., 0], v[..., 1], v[..., 2]
    r = y + c2; b = y + c1; g = (y - 0.299 * r - 0.114 * b) / 0.587
    out = np.stack([r, g, b], -1)
    if contrast != 1:
        j = out - 0.5; p = 0.43
        out = np.sign(j) * p * (np.abs(j) / p) ** contrast + 0.5
    return np.clip(np.round(out * 255), 0, 255).astype(np.uint8)


def decode_uncompressed(path):
    """The full-resolution picture of a FlashPix file with uncompressed 3-channel tiles, from its raw streams."""
    ole = olefile.OleFileIO(path)
    store = 'Data Object Store 000001'
    props = ole.getproperties([store, '\x05Image Contents'])
    res = 'Resolution %04d' % (props[0x01000000] - 1)
    head = ole.openstream([store, res, 'Subimage 0000 Header']).read()
    data = ole.openstream([store, res, 'Subimage 0000 Data']).read()
    w, h, tiles, tw, th, ch, toff, tlen = struct.unpack('<8I', head[32:64])
    cols = -(-w // tw)
    img = np.zeros((-(-h // th) * th, cols * tw, ch), np.uint8)
    for t in range(tiles):
        off, size, comp, sub = struct.unpack('<4I', head[28 + toff + t * tlen:28 + toff + t * tlen + 16])
        assert comp == 0, comp
        y, x = (t // cols) * th, (t % cols) * tw
        img[y:y + th, x:x + tw] = np.frombuffer(data[28 + off:28 + off + tw * th * ch], np.uint8).reshape(th, tw, ch)
    return img[:h, :w]


def views():
    from PIL import Image as _I
    # The source picture as the file holds it (the toolkit's tiles differ slightly from rose.png); the view
    # expectations are numpy operations on it.
    rose = decode_uncompressed(os.path.join(OUT, 'input_truecolor.fpx'))
    _I.fromarray(rose).save(os.path.join(OUT, 'input_truecolor.decoded.png'))
    H, W = rose.shape[:2]  # 46 x 70; coordinates: height 1, width R = W / H
    R = W / H
    def save(name, arr):
        _I.fromarray(arr).save(os.path.join(OUT, name))
    # Rectangle of interest: columns 14..53, rows 10..33, pixel-aligned (x = 14/46, y = 10/46, w = 40/46, h = 24/46).
    roi = [14 / H, 10 / H, 40 / H, 24 / H]
    view_file('view-roi.fpx', {0x10000001: (VT_R4 | VT_VECTOR, roi)})
    a = np.zeros((H, W, 4), np.uint8); a[10:34, 14:54, :3] = rose[10:34, 14:54]; a[10:34, 14:54, 3] = 255
    save('view-roi.png', a)
    # The crop: the affine maps the result rectangle (0,0)-(40/24,1) onto the rectangle of interest; aspect 40/24.
    k = 24 / H  # result unit -> source units
    view_file('view-crop.fpx', {0x10000001: (VT_R4 | VT_VECTOR, roi), 0x10000000: (VT_R4, 40 / 24),
                                 0x10000003: (VT_R4 | VT_VECTOR, [k, 0, 0, 14 / H, 0, k, 0, 10 / H, 0, 0, 1, 0, 0, 0, 0, 1])})
    save('view-crop.png', np.ascontiguousarray(rose[10:34, 14:54]))
    # A quarter turn clockwise: display (x', y') -> source x = y' * R... x_src = y', y_src = 1 - x' * ... with aspect 1/R.
    # Source x = y' (display height 1 maps onto source width R: x = R * y'); source y = 1 - R * x'? Display width is 1/R.
    view_file('view-rot90.fpx', {0x10000000: (VT_R4, 1 / R), 0x10000003: (VT_R4 | VT_VECTOR, [0, R, 0, 0, -R, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1])})
    save('view-rot90.png', np.ascontiguousarray(np.rot90(rose, -1)))
    # A horizontal flip: x = R - x'.
    view_file('view-flip.fpx', {0x10000003: (VT_R4 | VT_VECTOR, [-1, 0, 0, R, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])})
    save('view-flip.png', np.ascontiguousarray(rose[:, ::-1]))
    # Color: luma x 1.1, chromas x 0.8; contrast 1.2.
    m = [1.1, 0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0.8, 0, 0, 0, 0, 1]
    view_file('view-color.fpx', {0x10000004: (VT_R4 | VT_VECTOR, m), 0x10000005: (VT_R4, 1.2)})
    save('view-color.png', ycc_twist(rose, m, 1.2))
    # A cached result: the gray rose's image object as store 000002; the transform (a flip) must be ignored.
    gs, _, gc = cfbwrite.read_all(os.path.join(OUT, 'input_grayscale.fpx'))
    store = {k[len('Data Object Store 000001/'):]: v for k, v in gs.items() if k.startswith('Data Object Store 000001/')}
    cl = {k[len('Data Object Store 000001'):]: v for k, v in gc.items() if k.startswith('Data Object Store 000001')}
    view_file('view-cached.fpx', {0x10000003: (VT_R4 | VT_VECTOR, [-1, 0, 0, R, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])}, cached={'streams': store, 'clsids': cl, 'width': W, 'height': H})


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
