#!/usr/bin/env python3
"""WMF and EMF fixtures with LibreOffice's renderings as the reference.

Writes to tests/fixtures/metafile/:
  shapes.wmf   placeable WMF (2 × 1.5 inches at 1440 units per inch): window org/ext, pens (solid, dashed),
               brushes (solid, hatched, null), rectangle, ellipse, polygon, round rectangle, polyline, pie,
               arc, Arial text, a 24-bit DIB through StretchDIB
  shapes.emf   EMF (frame 50.8 × 38.1 mm): anisotropic window/viewport, SaveDC/RestoreDC, stock objects,
               a rotated world transform, a Bézier path stroked and filled, IntersectClipRect,
               ExtTextOutW with escapement, a 32-bit DIB through StretchDIBits
  drawing.emf, drawing.wmf   LibreOffice's export of drawing.svg (a real producer's records)
  *.png        LibreOffice (GraphicProvider) renderings at the pictures' 96 dpi sizes
Needs LibreOffice with Python UNO (python3-uno).
"""
import os, struct, subprocess, sys, time

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'metafile')


# WMF -----------------------------------------------------------------------------------------------
def wrec(fn, *words, data=b''):
    body = b''.join(struct.pack('<h' if w < 0 else '<H', w) for w in words) + data
    if len(body) % 2: body += b'\0'
    return struct.pack('<IH', 3 + len(body) // 2, fn) + body


def colorref(r, g, b):
    v = r | (g << 8) | (b << 16)
    return v & 0xffff, v >> 16


def dib24(w, h, pixel):
    """BITMAPINFOHEADER + bottom-up 24-bit rows."""
    row = (w * 3 + 3) & ~3
    bits = bytearray()
    for y in range(h - 1, -1, -1):
        r = bytearray()
        for x in range(w):
            R, G, B = pixel(x, y)
            r += bytes([B, G, R])
        bits += r + b'\0' * (row - len(r))
    return struct.pack('<IiiHHIIiiII', 40, w, h, 1, 24, 0, len(bits), 3780, 3780, 0, 0) + bytes(bits)


def wmf():
    recs = []
    recs.append(wrec(0x020B, 0, 0))                    # SetWindowOrg (y, x)
    recs.append(wrec(0x020C, 2160, 2880))              # SetWindowExt (y, x)
    recs.append(wrec(0x0102, 1))                       # SetBkMode TRANSPARENT
    recs.append(wrec(0x0106, 1))                       # SetPolyFillMode ALTERNATE
    recs.append(wrec(0x02FA, 0, 40, 0, *colorref(0, 0, 0)))        # pen 0: solid, 40 units, black
    recs.append(wrec(0x012D, 0))
    recs.append(wrec(0x02FC, 0, *colorref(208, 48, 48), 0))       # brush 1: red
    recs.append(wrec(0x012D, 1))
    recs.append(wrec(0x041B, 1000, 1200, 200, 200))                 # Rectangle (b, r, t, l)
    recs.append(wrec(0x02FC, 0, *colorref(48, 96, 208), 0))       # brush 2: blue
    recs.append(wrec(0x012D, 2))
    recs.append(wrec(0x0418, 1000, 2700, 200, 1500))                # Ellipse
    recs.append(wrec(0x02FC, 2, *colorref(30, 140, 60), 4))       # brush 3: green cross hatch
    recs.append(wrec(0x012D, 3))
    pts = [(200, 2000), (700, 1200), (1200, 2000)]
    recs.append(wrec(0x0324, len(pts), *[c for p in pts for c in p]))  # Polygon
    recs.append(wrec(0x02FC, 1, 0, 0, 0))                          # brush 4: null
    recs.append(wrec(0x012D, 4))
    recs.append(wrec(0x061C, 300, 300, 2000, 2000, 1250, 1400))     # RoundRect (h, w, b, r, t, l)
    recs.append(wrec(0x02FA, 1, 20, 0, *colorref(120, 0, 160)))    # pen 5: dashed purple
    recs.append(wrec(0x012D, 5))
    pl = [(2100, 1300), (2400, 1500), (2200, 1700), (2600, 1950)]
    recs.append(wrec(0x0325, len(pl), *[c for p in pl for c in p]))  # Polyline
    recs.append(wrec(0x012D, 0)); recs.append(wrec(0x012D, 2))
    recs.append(wrec(0x081A, 1300, 2800, 1300, 2300, 2100, 2800, 1300, 2000))  # Pie (yE, xE, yS, xS, b, r, t, l)
    recs.append(wrec(0x0817, 2100, 2000, 2100, 2800, 2100, 2800, 1300, 2000))  # Arc
    face = b'Arial'.ljust(32, b'\0')
    recs.append(wrec(0x02FB, (-200) & 0xffff, 0, 0, 0, 700, data=bytes([0, 0, 0, 0, 0, 0, 0, 0]) + face))  # font 6: Arial bold
    recs.append(wrec(0x012D, 6))
    recs.append(wrec(0x0209, *colorref(20, 20, 20)))
    recs.append(wrec(0x012E, 24))                                   # TA_BASELINE
    text = b'Anne'
    recs.append(wrec(0x0521, len(text), data=text + struct.pack('<hh', 2050, 1500)))  # TextOut (y, x after the string)
    dib = dib24(4, 4, lambda x, y: (255 * (x % 2), 255 * (y % 2), 128))
    recs.append(wrec(0x0F43, 0x0020, 0x00CC, 0, 4, 4, 0, 0, 400, 400, 1150, 1400, data=dib))  # StretchDIB SRCCOPY
    recs.append(wrec(0x01F0, 3))
    recs.append(wrec(0x0000))
    body = b''.join(recs)
    words = len(body) // 2
    maxrec = max(struct.unpack('<I', r[:4])[0] for r in recs)
    header = struct.pack('<HHHIHIH', 1, 9, 0x0300, 9 + words, 7, maxrec, 0)
    placeable = struct.pack('<IHhhhhHI', 0x9AC6CDD7, 0, 0, 0, 2880, 2160, 1440, 0)
    chk = 0
    for i in range(0, 20, 2): chk ^= struct.unpack('<H', placeable[i:i + 2])[0]
    return placeable + struct.pack('<H', chk) + header + body


# EMF -----------------------------------------------------------------------------------------------
def erec(t, data=b''):
    if len(data) % 4: data += b'\0' * (4 - len(data) % 4)
    return struct.pack('<II', t, 8 + len(data)) + data


def emf():
    W, H = 192, 144  # reference device: 96 dpi; frame 50.8 × 38.1 mm
    recs = []
    i = lambda *v: struct.pack('<' + 'i' * len(v), *v)
    u = lambda *v: struct.pack('<' + 'I' * len(v), *v)
    cr = lambda r, g, b: r | (g << 8) | (b << 16)
    recs.append(erec(17, u(8)))                          # SetMapMode MM_ANISOTROPIC
    recs.append(erec(9, i(1920, 1440)))                  # SetWindowExtEx
    recs.append(erec(10, i(0, 0)))
    recs.append(erec(11, i(W, H)))                       # SetViewportExtEx
    recs.append(erec(12, i(0, 0)))
    recs.append(erec(18, u(1)))                          # transparent
    recs.append(erec(39, u(1, 0, cr(208, 48, 48), 0)))   # brush 1: red
    recs.append(erec(38, u(2, 0) + i(30, 0) + u(cr(0, 0, 0))))  # pen 2: 30 units black
    recs.append(erec(37, u(1))); recs.append(erec(37, u(2)))
    recs.append(erec(43, i(100, 100, 700, 600)))         # Rectangle
    recs.append(erec(33))                                # SaveDC
    recs.append(erec(37, u(0x80000005)))                 # NULL_BRUSH stock
    recs.append(erec(37, u(0x80000007)))                 # BLACK_PEN stock (cosmetic)
    recs.append(erec(42, i(800, 100, 1800, 600)))        # Ellipse, outline only
    recs.append(erec(34, i(-1)))                         # RestoreDC: red brush and thick pen again
    # A rotated square (world transform: 30° about its centre at (1350, 1050)).
    import math
    a = math.radians(30); c, s = math.cos(a), math.sin(a); cx, cy = 1350, 1050
    recs.append(erec(35, struct.pack('<6f', c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy)))
    recs.append(erec(39, u(3, 0, cr(48, 96, 208), 0)))
    recs.append(erec(37, u(3)))
    recs.append(erec(43, i(1150, 850, 1550, 1250)))
    recs.append(erec(36, struct.pack('<6f', 1, 0, 0, 1, 0, 0) + u(1)))  # ModifyWorldTransform: identity
    # A path: a lens shape from two Béziers, stroked and filled.
    recs.append(erec(39, u(4, 0, cr(40, 160, 80), 0))); recs.append(erec(37, u(4)))
    recs.append(erec(59))
    recs.append(erec(27, i(150, 1100)))
    recs.append(erec(5, i(0, 0, 0, 0) + u(6) + i(350, 750, 650, 750, 850, 1100, 650, 1450, 350, 1450, 150, 1100)))  # PolyBezierTo
    recs.append(erec(61)); recs.append(erec(60))
    recs.append(erec(63, i(0, 0, 0, 0)))                 # StrokeAndFillPath
    # Clipped ellipse: only its left half shows.
    recs.append(erec(33))
    recs.append(erec(30, i(1000, 700, 1350, 1400)))      # IntersectClipRect
    recs.append(erec(39, u(5, 0, cr(240, 170, 20), 0))); recs.append(erec(37, u(5)))
    recs.append(erec(37, u(0x80000008)))                 # NULL_PEN
    recs.append(erec(42, i(1000, 700, 1700, 1400)))
    recs.append(erec(34, i(-1)))
    # Text, rotated 20°.
    face = 'Arial'.encode('utf-16-le').ljust(64, b'\0')
    logfont = i(-160, 0, 200, 200, 400) + bytes([0, 0, 0, 0, 0, 0, 0, 0]) + face
    recs.append(erec(82, u(6) + logfont + b'\0' * (332 - len(logfont))))
    recs.append(erec(37, u(6)))
    recs.append(erec(24, u(cr(10, 10, 10))))
    recs.append(erec(22, u(24)))                         # TA_BASELINE
    txt = 'Lens'.encode('utf-16-le')
    head = i(0, 0, 0, 0) + u(1) + struct.pack('<ff', 1, 1)
    emrtext = i(950, 600) + u(4) + u(8 + 16 + 12 + 40 + 0) + u(0) + i(0, 0, -1, -1) + u(0)
    rec = head + emrtext
    off = 8 + len(rec)
    rec = head + i(950, 600) + u(4) + u(off) + u(0) + i(0, 0, -1, -1) + u(0) + txt
    recs.append(erec(84, rec))
    # A 32-bit bitmap, 4 × 2, stretched to 300 × 150 units.
    w, h = 4, 2
    px = b''.join(bytes([b, g, r, 255]) for (r, g, b) in [(255, 255, 0), (0, 255, 255), (255, 0, 255), (0, 0, 0), (255, 255, 255), (255, 0, 0), (0, 255, 0), (0, 0, 255)])
    bmi = struct.pack('<IiiHHIIiiII', 40, w, -h, 1, 32, 0, len(px), 0, 0, 0, 0)
    fixed = 8 + 16 + 4 * 6 + 4 * 4 + 4 * 2 + 4 * 2
    rec = i(0, 0, 0, 0) + i(1500, 150, 0, 0, w, h) + u(fixed, len(bmi), fixed + len(bmi), len(px), 0, 0x00CC0020) + i(300, 150) + bmi + px
    recs.append(erec(81, rec))
    recs.append(erec(14, u(0, 16, 20)))                  # EOF
    body = b''.join(recs)
    nrec = len(recs) + 1
    header = struct.pack('<II', 1, 108) + i(0, 0, W - 1, H - 1) + i(0, 0, 5080, 3810) + u(0x464D4520, 0x10000, 108 + len(body), nrec) + struct.pack('<HH', 8, 0) + u(0, 0, 0) + i(W, H) + i(51, 38) + u(0, 0, 0) + i(50800, 38100)
    return header + body


def render(pairs):
    """LibreOffice's GraphicProvider: each metafile to PNG at an exact pixel size."""
    script = os.path.join(os.path.dirname(__file__), 'lo_render.py')
    subprocess.run(['/usr/bin/python3', script, *[str(v) for p in pairs for v in p]], check=True, timeout=300)


def main():
    os.makedirs(OUT, exist_ok=True)
    open(f'{OUT}/shapes.wmf', 'wb').write(wmf())
    open(f'{OUT}/shapes.emf', 'wb').write(emf())
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
<rect x="20" y="20" width="160" height="100" fill="#d03030" stroke="#000" stroke-width="4"/>
<ellipse cx="290" cy="80" rx="80" ry="50" fill="#3060d0"/>
<path d="M30 280 C 80 160, 160 160, 210 280 Z" fill="#30a050" stroke="#202020" stroke-width="3"/>
<text x="230" y="230" font-family="Liberation Sans" font-size="32" fill="#000">Anne</text>
</svg>'''
    open(f'{OUT}/drawing.svg', 'w').write(svg)
    for fmt in ('emf', 'wmf'):
        subprocess.run(['soffice', '--headless', '--convert-to', fmt, '--outdir', OUT, f'{OUT}/drawing.svg'], check=True, timeout=180, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    sizes = {'shapes.wmf': (192, 144), 'shapes.emf': (192, 144)}
    for n in ('drawing.emf', 'drawing.wmf'):
        b = open(f'{OUT}/{n}', 'rb').read()
        if n.endswith('emf'):
            fr = struct.unpack('<4i', b[24:40]); sizes[n] = (round((fr[2] - fr[0]) / 2540 * 96), round((fr[3] - fr[1]) / 2540 * 96))
        else:
            l, t, r, bt, inch = struct.unpack('<hhhhH', b[6:16]); sizes[n] = (round((r - l) / inch * 96), round((bt - t) / inch * 96))
    render([(f'{OUT}/{n}', f'{OUT}/{n.replace(".", "-")}.png', *wh) for n, wh in sizes.items()])
    for n, wh in sizes.items(): print(n, wh)


if __name__ == '__main__':
    main()
