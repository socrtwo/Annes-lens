#!/usr/bin/env python3
"""Icons inside Windows programs, DLLs and icon libraries: test files and their expected icons.

Writes to tests/fixtures/iconlib/:
  icons64.dll, icons32.dll   resource-only DLLs (PE32+ and PE32) built with MinGW's windres and ld from two icons
                             (a.ico: 16 px 4-bit, 32 px 8-bit, 48 px 32-bit, 256 px PNG; b.ico: 32 px 32-bit) and a
                             1-bit cursor with its hotspot (c.cur), made by icoutils' icotool
  lib.icl                    the same icons in a 16-bit (NE) icon library, written here from the NE format
  <file>-<type>-<id>.ico/.cur   expected: the icon and cursor files icoutils' wrestool rebuilds from each group
  a.ico b.ico c.cur          the icon files that went in; a256.png and b32.png the pictures
Needs Pillow, icoutils (icotool, wrestool) and binutils-mingw-w64 (windres, ld) with cpp.
"""
import os, struct, subprocess, tempfile
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'iconlib')
TMP = tempfile.mkdtemp()


def run(cmd, **k):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **k)


def pictures():
    for s in (48, 256):
        im = Image.new('RGBA', (s, s), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
        d.ellipse((1, 1, s - 2, s - 2), fill=(200, 40, 40, 255)); d.rectangle((s // 4, s // 4, s // 2, s // 2), fill=(30, 90, 220, 200))
        im.save(os.path.join(TMP, 'a%d.png' % s))
    for s in (16, 32):  # palette pictures with on/off transparency, so icotool can store them at 4 and 8 bits
        im = Image.new('P', (s, s), 0); im.putpalette([0, 0, 0, 200, 40, 40, 30, 90, 220, 250, 250, 0] + [0] * (252 * 3))
        d = ImageDraw.Draw(im); d.ellipse((1, 1, s - 2, s - 2), fill=1); d.rectangle((s // 4, s // 4, s // 2, s // 2), fill=2); d.point((s // 2 + 2, s // 2 + 2), fill=3)
        im.save(os.path.join(TMP, 'p%d.png' % s), transparency=0)
    im = Image.new('RGBA', (32, 32), (0, 0, 0, 0)); d = ImageDraw.Draw(im); d.polygon([(16, 1), (31, 30), (1, 30)], fill=(20, 160, 60, 255))
    im.save(os.path.join(TMP, 'b32.png'))
    t = lambda n: os.path.join(TMP, n)
    run(['icotool', '-c', '-o', t('a.ico'), '-b', '4', t('p16.png'), '-b', '8', t('p32.png'), '-b', '32', t('a48.png'), '-r', t('a256.png')])
    run(['icotool', '-c', '-o', t('b.ico'), t('b32.png')])
    run(['icotool', '-c', '--cursor', '-X', '5', '-Y', '7', '-o', t('c.cur'), t('b32.png')])
    for n in ('a.ico', 'b.ico', 'c.cur', 'a256.png', 'b32.png'):
        open(os.path.join(OUT, n), 'wb').write(open(t(n), 'rb').read())


def dlls():
    open(os.path.join(TMP, 'r.rc'), 'w').write('1 ICON "a.ico"\n7 ICON "b.ico"\n3 CURSOR "c.cur"\n')
    for arch, name in (('x86_64', 'icons64.dll'), ('i686', 'icons32.dll')):
        run([arch + '-w64-mingw32-windres', '--preprocessor=cpp', '--preprocessor-arg=-xc', 'r.rc', '-O', 'coff', '-o', 'r.o'], cwd=TMP)
        run([arch + '-w64-mingw32-ld', '--dll', '-e', '0', '-o', os.path.join(OUT, name), 'r.o'], cwd=TMP)


def ico_entries(path):
    d = open(path, 'rb').read()
    kind, n = struct.unpack('<HH', d[2:6])
    out = []
    for i in range(n):
        w, h, c, r, p1, p2, size, off = struct.unpack('<BBBBHHII', d[6 + i * 16:22 + i * 16])
        out.append(((w, h, c, r, p1, p2), d[off:off + size]))
    return kind, out


def ne_icl(path):
    """A 16-bit Windows (NE) module holding only resources: RT_ICON (3), RT_GROUP_ICON (14), RT_CURSOR (1), RT_GROUP_CURSOR (12)."""
    shift = 4
    icons, groups, cursors, cgroups = [], [], [], []
    nid = 1
    for gid, f in ((1, 'a.ico'), (7, 'b.ico')):
        _, ents = ico_entries(os.path.join(TMP, f))
        grp = struct.pack('<HHH', 0, 1, len(ents))
        for (w, h, c, r, planes, bits), data in ents:
            icons.append((nid, data))
            grp += struct.pack('<BBBBHHIH', w, h, c, r, planes, bits, len(data), nid)
            nid += 1
        groups.append((gid, grp))
    _, ents = ico_entries(os.path.join(TMP, 'c.cur'))
    (w, h, c, r, hx, hy), data = ents[0]
    cursors.append((1, struct.pack('<HH', hx, hy) + data))
    # A cursor group entry: width, height (doubled), planes, bit count, size, id.
    bih = struct.unpack('<IiiHH', data[:16])
    cgroups.append((3, struct.pack('<HHH', 0, 2, 1) + struct.pack('<HHHHIH', w or 256, (h or 256) * 2, 1, bih[4], len(data) + 4, 1)))
    types = [(1, cursors), (3, icons), (12, cgroups), (14, groups)]
    # Layout: MZ header (64), NE header (64), resource table, resident names, then the resources (16-byte aligned).
    rt = struct.pack('<H', shift)
    entries_at = []
    for t, items in types:
        rt += struct.pack('<HHI', 0x8000 | t, len(items), 0)
        for rid, data in items:
            entries_at.append((len(rt), data))
            rt += struct.pack('<HHHHHH', 0, 0, 0x0c30, 0x8000 | rid, 0, 0)
    rt += struct.pack('<H', 0) + b'\0'  # end of types, no resource names
    resident = bytes([5]) + b'ICONS' + struct.pack('<H', 0) + b'\0'
    ne_at, rt_at = 64, 128
    res_at = rt_at + len(rt)
    after = res_at + len(resident)
    entry_table = after
    body = bytearray(rt)
    data_blob = bytearray()
    base = (after + 1 + 15) & ~15
    for (pos, data) in entries_at:
        off = base + len(data_blob)
        struct.pack_into('<HH', body, pos, off >> shift, (len(data) + (1 << shift) - 1) >> shift)
        data_blob += data + bytes((-len(data)) % (1 << shift))
    mz = bytearray(64); mz[0:2] = b'MZ'; struct.pack_into('<H', mz, 0x18, 0x40); struct.pack_into('<I', mz, 0x3c, ne_at)
    ne = bytearray(64)
    ne[0:2] = b'NE'; ne[2] = 5
    struct.pack_into('<HH', ne, 0x04, entry_table - ne_at, 0)       # entry table (empty)
    struct.pack_into('<H', ne, 0x0c, 0x8000)                         # library module
    struct.pack_into('<H', ne, 0x22, rt_at - ne_at)                  # segment table (none)
    struct.pack_into('<H', ne, 0x24, rt_at - ne_at)                  # resource table
    struct.pack_into('<H', ne, 0x26, res_at - ne_at)                 # resident names
    struct.pack_into('<HH', ne, 0x28, after - ne_at, after - ne_at)  # module references, imported names
    struct.pack_into('<I', ne, 0x2c, after + 1)                      # non-resident names (empty)
    struct.pack_into('<H', ne, 0x32, shift)
    ne[0x36] = 2                                                     # Windows
    struct.pack_into('<H', ne, 0x3e, 0x030a)
    out = bytes(mz) + bytes(ne) + bytes(body) + resident + b'\0'
    out += bytes(base - len(out)) + bytes(data_blob)
    open(path, 'wb').write(out)


def references():
    for f in ('icons64.dll', 'icons32.dll', 'lib.icl'):
        for t, ids, ext in ((14, (1, 7), 'ico'), (12, (3,), 'cur')):
            for i in ids:
                dst = os.path.join(OUT, '%s-%d-%d.%s' % (f.split('.')[0], t, i, ext))
                run(['wrestool', '-x', '-t', str(t), '-n', str(i), '-o', dst, os.path.join(OUT, f)])


def main():
    os.makedirs(OUT, exist_ok=True)
    pictures()
    dlls()
    ne_icl(os.path.join(OUT, 'lib.icl'))
    references()


if __name__ == '__main__':
    main()
