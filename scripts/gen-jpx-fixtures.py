#!/usr/bin/env python3
"""JPEG 2000 fixtures written by OpenJPEG (through imagecodecs and Pillow) and OpenJPH (HTJ2K), with the
expected 8-bit pictures.

Writes to tests/fixtures/jpx/:
  rgb-lossless.jp2     5/3 wavelet, RGB 8-bit                                     expected: rgb.png (exact)
  gray16.jp2           16-bit gray, lossless                                      expected: gray16.png (top 8 bits)
  rgba.jp2             RGB + alpha                                                expected: rgba.png
  lossy-tiled.j2k      9/7 wavelet codestream, 32 × 32 tiles, 4 levels, RPCL, 3 quality layers
                       expected: lossy-tiled.png (OpenJPEG's own decoding)
  sycc.jp2             YCbCr samples tagged sYCC                                  expected: rgb.png (within rounding)
  cmyk.jp2             CMYK                                                        expected: cmyk.png (plain conversion)
  ht.jph               HTJ2K (OpenJPH), lossless, in a JPH file                    expected: rgb.png (exact)
  ht.j2c               the same HTJ2K codestream on its own
  tagged.jp2           rgb-lossless.jp2 with an ICC profile (Adobe RGB, colr method 2), a 300 dpi capture
                       resolution box and an XMP uuid box added
  big.jp2              1024 × 768 gradient, 6 levels (for the reduced-size path)
  icon.icns            an ICNS icon whose 128 px element (ic07) is rgba.jp2 resized to 128 × 128
Needs numpy, Pillow and imagecodecs.
"""
import io, os, struct
import numpy as np
import imagecodecs
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'jpx')
ICC = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'color', 'adobergb.icc')
W, H = 53, 37


def png(a, name):
    Image.fromarray(a).save(os.path.join(OUT, name))


def box(t, payload):
    return struct.pack('>I', 8 + len(payload)) + t + payload


def boxes(b):
    out, p = [], 0
    while p < len(b):
        n = struct.unpack('>I', b[p:p + 4])[0]
        out.append((b[p + 4:p + 8], b[p + 8:p + n])); p += n
    return out


def tag(jp2, icc, dpi, xmp):
    """Rebuilds a JP2: jp2h gets an ICC colr box (replacing the enumerated one) and a res/resc box; an XMP uuid box follows."""
    out = b''
    for t, payload in boxes(jp2):
        if t == b'jp2h':
            inner = b''
            for t2, p2 in boxes(payload):
                inner += box(b'colr', bytes([2, 0, 0]) + icc) if t2 == b'colr' else box(t2, p2)
            ppm = round(dpi / 0.0254)  # pixels per metre: num / den * 10^exp
            inner += box(b'res ', box(b'resc', struct.pack('>HHHHbb', ppm // 10, 1, ppm // 10, 1, 1, 1)))
            out += box(b'jp2h', inner)
        else:
            out += box(t, payload)
    return out + box(b'uuid', bytes.fromhex('be7acfcb97a942e89c71999491e3afac') + xmp)


def main():
    os.makedirs(OUT, exist_ok=True)
    y, x = np.mgrid[0:H, 0:W]
    rgb = np.stack([x * 4, y * 6, (x + y) * 2], -1).astype(np.uint8)
    rgb[10:20, 10:30] = [250, 20, 40]
    png(rgb, 'rgb.png')
    rgbjp2 = imagecodecs.jpeg2k_encode(rgb, level=0, codecformat='jp2')
    open(f'{OUT}/rgb-lossless.jp2', 'wb').write(rgbjp2)
    g16 = ((x * 1000 + y * 37) % 65536).astype(np.uint16)
    open(f'{OUT}/gray16.jp2', 'wb').write(imagecodecs.jpeg2k_encode(g16, level=0, codecformat='jp2'))
    png((g16 >> 8).astype(np.uint8), 'gray16.png')
    rgba = np.dstack([rgb, (x * 4 + 30).astype(np.uint8)])
    open(f'{OUT}/rgba.jp2', 'wb').write(imagecodecs.jpeg2k_encode(rgba, level=0, codecformat='jp2'))
    png(rgba, 'rgba.png')
    # Lossy, tiled, layered: Pillow's OpenJPEG writer.
    b = io.BytesIO()
    Image.fromarray(rgb).save(b, 'JPEG2000', no_jp2=True, irreversible=True, tile_size=(32, 32), num_resolutions=4, progression='RPCL', quality_mode='rates', quality_layers=[40, 10, 2])
    open(f'{OUT}/lossy-tiled.j2k', 'wb').write(b.getvalue())
    png(imagecodecs.jpeg2k_decode(b.getvalue()), 'lossy-tiled.png')
    # sYCC: YCbCr samples (full-range BT.601), no multiple-component transform.
    r, g, bb = [rgb[..., i].astype(float) for i in range(3)]
    ycc = np.stack([0.299 * r + 0.587 * g + 0.114 * bb, 128 - 0.168736 * r - 0.331264 * g + 0.5 * bb, 128 + 0.5 * r - 0.418688 * g - 0.081312 * bb], -1)
    open(f'{OUT}/sycc.jp2', 'wb').write(imagecodecs.jpeg2k_encode(np.clip(np.round(ycc), 0, 255).astype(np.uint8), level=0, codecformat='jp2', colorspace='sycc', mct=False))
    cmyk = np.stack([x * 4, y * 6, (x + y) * 2, np.full_like(x, 40)], -1).astype(np.uint8)
    open(f'{OUT}/cmyk.jp2', 'wb').write(imagecodecs.jpeg2k_encode(cmyk, level=0, codecformat='jp2', colorspace='cmyk', mct=False))
    c, m, yy, k = [cmyk[..., i].astype(int) for i in range(4)]
    png(np.stack([255 - np.minimum(255, c + k), 255 - np.minimum(255, m + k), 255 - np.minimum(255, yy + k)], -1).astype(np.uint8), 'cmyk.png')
    # HTJ2K (OpenJPH): a raw codestream, and the same in a JPH file (signature, ftyp 'jph ', jp2h, jp2c).
    ht = imagecodecs.htj2k_encode(rgb)
    open(f'{OUT}/ht.j2c', 'wb').write(ht)
    jp2 = boxes(rgbjp2)
    jph = box(b'jP  ', b'\r\n\x87\n') + box(b'ftyp', b'jph \0\0\0\0jph ')
    jph += box(b'jp2h', next(p for t, p in jp2 if t == b'jp2h')) + box(b'jp2c', ht)
    open(f'{OUT}/ht.jph', 'wb').write(jph)
    # Tagged: ICC profile, resolution, XMP.
    xmp = b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Parish register, folio 117</rdf:li></rdf:Alt></dc:title></rdf:Description></rdf:RDF></x:xmpmeta>'
    open(f'{OUT}/tagged.jp2', 'wb').write(tag(rgbjp2, open(ICC, 'rb').read(), 300, xmp))
    # Big: 1024 × 768, decoded at a reduced level when the limits say so.
    by, bx = np.mgrid[0:768, 0:1024]
    big = np.stack([bx // 4, by // 3, (bx + by) // 7], -1).astype(np.uint8)
    open(f'{OUT}/big.jp2', 'wb').write(imagecodecs.jpeg2k_encode(big, level=0, codecformat='jp2', resolutions=6))
    # ICNS with a JPEG 2000 element.
    icon = np.array(Image.fromarray(rgba).resize((128, 128), Image.NEAREST))
    el = imagecodecs.jpeg2k_encode(icon, level=0, codecformat='jp2')
    png(icon, 'icon-128.png')
    body = b'ic07' + struct.pack('>I', 8 + len(el)) + el
    open(f'{OUT}/icon.icns', 'wb').write(b'icns' + struct.pack('>I', 8 + len(body)) + body)
    for f in sorted(os.listdir(OUT)):
        print(f, os.path.getsize(os.path.join(OUT, f)))


if __name__ == '__main__':
    main()
