#!/usr/bin/env python3
"""PDF fixtures for opening PDFs as pictures, with PDFium (pypdfium2) renders as the reference.

Writes to tests/fixtures/pdf/:
  sample.pdf   page 1 (Letter): RGB and CMYK filled shapes, a thick line, a circle, Helvetica text
               page 2 (A4): a JPEG (DCTDecode), a JPEG 2000 picture (JPXDecode) and a Group 4 fax strip
               (CCITTFaxDecode, from tests/fixtures/tiff/fax-g4.tif)
               page 3: a landscape page stored portrait with /Rotate 90
  sample-<n>.png   PDFium's render of each page at 72 dpi on white (whole pixels for Letter and A4)
  locked.pdf   sample.pdf encrypted with the user password "anne" (AES-256, by qpdf)
Needs numpy, Pillow (with OpenJPEG), pypdfium2 and qpdf.
"""
import io, os, shutil, subprocess, zlib
import numpy as np
from PIL import Image
import pypdfium2 as pdfium

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'pdf')
G4 = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'tiff', 'fax-g4.tif')


def g4_strip():
    """The single Group 4 strip of the TIFF fixture and its size."""
    im = Image.open(G4)
    off, cnt = im.tag_v2[273][0], im.tag_v2[279][0]
    data = open(G4, 'rb').read()[off:off + cnt]
    return data, im.size


def build():
    objs = []

    def add(body):
        objs.append(body)
        return len(objs)

    def stream(dict_items, data):
        d = ' '.join(f'/{k} {v}' for k, v in dict_items.items())
        return b'<< ' + d.encode() + b' /Length ' + str(len(data)).encode() + b' >>\nstream\n' + data + b'\nendstream'

    font = add(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    # Page 1: vector shapes and text.
    c1 = b'\n'.join([
        b'1 0 0 rg 72 600 200 120 re f',
        b'0 0.6 0.2 rg 340 600 200 120 re f',
        b'1 0 0 0 k 72 420 200 120 re f',
        b'0 0 0 1 K 8 w 340 420 m 540 540 l S',
        b'0 0 1 RG 4 w 306 250 m 306 305.2 261.2 350 206 350 c 150.8 350 106 305.2 106 250 c 106 194.8 150.8 150 206 150 c 261.2 150 306 194.8 306 250 c S',
        b'0.2 0.2 0.2 rg BT /F1 28 Tf 72 740 Td (Anne\'s Lens PDF test) Tj ET',
    ])
    s1 = add(stream({}, c1))
    # Page 2: pictures.
    y, x = np.mgrid[0:200, 0:300]
    photo = np.stack([x * 255 / 299, y * 255 / 199, 128 + 60 * np.sin(x / 15.0) * np.cos(y / 11.0)], -1).astype(np.uint8)
    jb = io.BytesIO(); Image.fromarray(photo).save(jb, 'JPEG', quality=92)
    jpg = add(stream({'Type': '/XObject', 'Subtype': '/Image', 'Width': 300, 'Height': 200, 'ColorSpace': '/DeviceRGB', 'BitsPerComponent': 8, 'Filter': '/DCTDecode'}, jb.getvalue()))
    jx = io.BytesIO(); Image.fromarray(photo[::-1, ::-1].copy()).resize((200, 150)).save(jx, 'JPEG2000', irreversible=False)
    jpx = add(stream({'Type': '/XObject', 'Subtype': '/Image', 'Width': 200, 'Height': 150, 'ColorSpace': '/DeviceRGB', 'BitsPerComponent': 8, 'Filter': '/JPXDecode'}, jx.getvalue()))
    g4, (gw, gh) = g4_strip()
    fax = add(stream({'Type': '/XObject', 'Subtype': '/Image', 'Width': gw, 'Height': gh, 'ColorSpace': '/DeviceGray', 'BitsPerComponent': 1, 'Filter': '/CCITTFaxDecode', 'DecodeParms': f'<< /K -1 /Columns {gw} /Rows {gh} /BlackIs1 true >>'}, g4))
    c2 = b'q 300 0 0 200 50 560 cm /Im1 Do Q q 200 0 0 150 360 610 cm /Im2 Do Q q 495 0 0 148.5 50 300 cm /Im3 Do Q'
    s2 = add(stream({}, c2))
    # Page 3: stored portrait, shown landscape.
    c3 = b'0 0 1 rg 50 50 100 300 re f 1 0.5 0 rg 300 600 200 100 re f'
    s3 = add(stream({}, c3))
    pages_id = len(objs) + 4
    p1 = add(f'<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 {font} 0 R >> >> /Contents {s1} 0 R >>'.encode())
    p2 = add(f'<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 {jpg} 0 R /Im2 {jpx} 0 R /Im3 {fax} 0 R >> >> /Contents {s2} 0 R >>'.encode())
    p3 = add(f'<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 612 792] /Rotate 90 /Contents {s3} 0 R >>'.encode())
    pages = add(f'<< /Type /Pages /Kids [{p1} 0 R {p2} 0 R {p3} 0 R] /Count 3 >>'.encode())
    assert pages == pages_id
    info = add(b"<< /Title (Anne's Lens PDF test) /Author (Anne's Lens tests) /Producer (gen-pdf-fixtures.py) >>")
    catalog = add(f'<< /Type /Catalog /Pages {pages} 0 R >>'.encode())
    out = bytearray(b'%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')
    offsets = []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += f'{i} 0 obj\n'.encode() + body + b'\nendobj\n'
    xref = len(out)
    out += f'xref\n0 {len(objs) + 1}\n0000000000 65535 f \n'.encode()
    for o in offsets:
        out += f'{o:010d} 00000 n \n'.encode()
    out += f'trailer\n<< /Size {len(objs) + 1} /Root {catalog} 0 R /Info {info} 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    return bytes(out)


def main():
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'sample.pdf')
    open(path, 'wb').write(build())
    doc = pdfium.PdfDocument(path)
    for i in range(len(doc)):
        img = doc[i].render(scale=1, fill_color=(255, 255, 255, 255)).to_pil().convert('RGB')
        img.save(os.path.join(OUT, f'sample-{i + 1}.png'))
        print('page', i + 1, img.size)
    if not shutil.which('qpdf'):
        raise SystemExit('qpdf is needed for locked.pdf')
    subprocess.run(['qpdf', '--encrypt', 'anne', 'owner', '256', '--', path, os.path.join(OUT, 'locked.pdf')], check=True)


if __name__ == '__main__':
    main()
