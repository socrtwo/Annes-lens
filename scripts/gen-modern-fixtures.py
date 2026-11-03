#!/usr/bin/env python3
"""JPEG XL and AVIF fixtures written by libjxl and libavif (through imagecodecs and Pillow), with expected pictures.

Writes to tests/fixtures/modern/:
  rgb.png                    the 53 × 37 test picture
  lossless.jxl               lossless JPEG XL codestream            expected: rgb.png (exact)
  alpha.jxl                  lossless with alpha                    expected: rgba.png (exact)
  gray16.jxl                 16-bit gray, lossless                  expected: gray16.png (top 8 bits, rounded)
  lossy.jxl                  VarDCT, distance 1                     expected: lossy-jxl.png (libjxl's decoding)
  anim.jxl                   three-frame lossless animation         expected: anim-0.png … anim-2.png
  recompressed.jxl           a JPEG recompressed losslessly (jbrd box), in a container with an XMP box
                             expected: recompressed.png (libjxl's decoding)
  lossy.avif                 8-bit 4:4:4-capable libavif encoding   expected: lossy-avif.png (libavif's decoding)
  alpha.avif                 with alpha                             expected: alpha-avif.png
  deep.avif                  10-bit                                 expected: deep-avif.png (libavif's, top 8 bits)
  anim.avif                  a two-frame image sequence (Pillow)    expected: its first frame, anim-avif-0.png
Needs numpy, Pillow (with AVIF) and imagecodecs.
"""
import io, os, struct
import numpy as np
import imagecodecs as c
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'modern')


def png(a, name):
    Image.fromarray(a).save(os.path.join(OUT, name))


def box(t, payload):
    return struct.pack('>I', 8 + len(payload)) + t + payload


def main():
    os.makedirs(OUT, exist_ok=True)
    y, x = np.mgrid[0:37, 0:53]
    rgb = np.stack([x * 4, y * 6, (x + y) * 2], -1).astype(np.uint8)
    rgb[10:20, 10:30] = [250, 20, 40]
    png(rgb, 'rgb.png')
    rgba = np.dstack([rgb, (x * 4 + 30).astype(np.uint8)])
    png(rgba, 'rgba.png')
    # JPEG XL
    open(f'{OUT}/lossless.jxl', 'wb').write(c.jpegxl_encode(rgb, lossless=True))
    open(f'{OUT}/alpha.jxl', 'wb').write(c.jpegxl_encode(rgba, lossless=True))
    g16 = ((x * 1000 + y * 37) % 65536).astype(np.uint16)
    open(f'{OUT}/gray16.jxl', 'wb').write(c.jpegxl_encode(g16, lossless=True))
    png(np.round(g16 / 257).astype(np.uint8), 'gray16.png')
    lossy = c.jpegxl_encode(rgb, distance=1.0)
    open(f'{OUT}/lossy.jxl', 'wb').write(lossy)
    png(c.jpegxl_decode(lossy), 'lossy-jxl.png')
    frames = np.stack([np.stack([x * 4, y * 6, np.full_like(x, k * 100)], -1) for k in range(3)]).astype(np.uint8)
    open(f'{OUT}/anim.jxl', 'wb').write(c.jpegxl_encode(frames, lossless=True))
    for k in range(3):
        png(frames[k], f'anim-{k}.png')
    jpeg = io.BytesIO(); Image.fromarray(rgb).save(jpeg, 'JPEG', quality=90)
    rec = c.jpegxl_encode_jpeg(jpeg.getvalue())
    xmp = b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Recompressed JPEG</rdf:li></rdf:Alt></rdf:Description></rdf:RDF></x:xmpmeta>'
    if rec[:12] == b'\0\0\0\x0cJXL \r\n\x87\n':
        rec += box(b'xml ', xmp)
    open(f'{OUT}/recompressed.jxl', 'wb').write(rec)
    png(c.jpegxl_decode(rec), 'recompressed.png')
    # AVIF
    lossy_avif = c.avif_encode(rgb, level=90)
    open(f'{OUT}/lossy.avif', 'wb').write(lossy_avif)
    png(c.avif_decode(lossy_avif), 'lossy-avif.png')
    alpha_avif = c.avif_encode(rgba, level=90)
    open(f'{OUT}/alpha.avif', 'wb').write(alpha_avif)
    png(c.avif_decode(alpha_avif), 'alpha-avif.png')
    deep = c.avif_encode((rgb.astype(np.uint16) * 4), level=90, bitspersample=10)
    open(f'{OUT}/deep.avif', 'wb').write(deep)
    png(np.round(c.avif_decode(deep).astype(np.float64) * 255 / 1023).astype(np.uint8), 'deep-avif.png')
    a0, a1 = Image.fromarray(rgb), Image.fromarray(rgb[::-1].copy())
    b = io.BytesIO(); a0.save(b, 'AVIF', save_all=True, append_images=[a1], duration=200, quality=90)
    open(f'{OUT}/anim.avif', 'wb').write(b.getvalue())
    png(np.array(Image.open(io.BytesIO(b.getvalue())).convert('RGB')), 'anim-avif-0.png')
    for f in sorted(os.listdir(OUT)):
        print(f, os.path.getsize(os.path.join(OUT, f)))


if __name__ == '__main__':
    main()
