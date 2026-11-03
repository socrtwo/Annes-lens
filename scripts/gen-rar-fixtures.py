#!/usr/bin/env python3
"""RAR fixtures: libarchive's RAR test archives, and stored (uncompressed) RAR archives of pictures written here.

No RAR compressor is used (RARLAB's rar is proprietary). Compressed data comes from libarchive's test suite
(BSD-2-Clause, see tests/fixtures/rar/LICENSE-libarchive), fetched at a pinned commit and uudecoded; every
file in a RAR archive carries a CRC-32 of its contents, so unpacking them checks itself.

Writes to tests/fixtures/rar/:
  la-*.rar         the libarchive archives listed in LIBARCHIVE below (RAR 2.9 and RAR 5.0: stored, LZ,
                   filters, solid, Unicode names, encryption, damaged and fuzzed files)
  comic4.cbr       RAR 2.x–4.x headers, stored: page-01.png, page-02.jpg, page-10.png, notes.txt, extras/
  comic5.cbr       the same pictures in a RAR 5.0 archive, stored
Needs Pillow and network access to raw.githubusercontent.com.
"""
import binascii, io, os, struct, time, urllib.request, zlib
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'rar')
COMMIT = '2774b74cb7269c9b5fa89e7d876b11d5a729c421'
BASE = f'https://raw.githubusercontent.com/libarchive/libarchive/{COMMIT}'
LIBARCHIVE = [
    # RAR 2.9 (RAR 3.x/4.x)
    'rar', 'rar_compress_normal', 'rar_compress_best', 'rar3_lowdist_reset', 'rar_filter', 'rar_multi_lzss_blocks',
    'rar_unicode', 'rar_windows', 'rar_noeof', 'rar_subblock', 'rar_encryption_data', 'rar_encryption_header', 'rar_invalid1',
    'rar_overflow', 'rar_symlink_huge', 'rar_newsub_huge', 'rar_ppmd_use_after_free',
    # RAR 5.0
    'rar5_stored', 'rar5_compressed', 'rar5_multiple_files', 'rar5_multiple_files_solid', 'rar5_solid', 'rar5_arm',
    'rar5_win32', 'rar5_blake2', 'rar5_unicode', 'rar5_symlink', 'rar5_encrypted', 'rar5_encrypted_filenames',
    'rar5_distance_overflow', 'rar5_invalid_dict_reference', 'rar5_leftshift1', 'rar5_leftshift2', 'rar5_truncated_huff',
    'rar5_readtables_overflow', 'rar5_decode_number_out_of_bounds_read', 'rar5_block_size_is_too_small',
    'rar5_bad_window_sz_in_mltarc_file', 'rar5_window_buf_and_size_desync', 'rar5_different_solid_window_size',
    'rar5_data_ready_pointer_leak', 'rar5_nonempty_dir_stream', 'rar5_dirdata',
]


def uudecode(text: bytes) -> bytes:
    out, started = bytearray(), False
    for line in text.split(b'\n'):
        if line.startswith(b'begin '): started = True; continue
        if not started: continue
        if line.strip() == b'end': break
        if not line.strip() or line.strip() == b'`': continue
        try: out += binascii.a2b_uu(line)
        except binascii.Error: out += binascii.a2b_uu(line[:(((line[0] - 32) & 63) * 4 + 5) // 3])
    return bytes(out)


def fetch():
    for n in LIBARCHIVE:
        name = f'test_read_format_{n}.rar'
        data = uudecode(urllib.request.urlopen(f'{BASE}/libarchive/test/{name}.uu').read())
        open(os.path.join(OUT, f'la-{n.replace("_", "-")}.rar'), 'wb').write(data)
    open(os.path.join(OUT, 'LICENSE-libarchive'), 'wb').write(urllib.request.urlopen(f'{BASE}/COPYING').read())


# Pictures for the comics -------------------------------------------------------------------------------
def pictures():
    files = []
    for name, color, fmt in [('page-01.png', (200, 40, 40), 'PNG'), ('page-02.jpg', (40, 160, 60), 'JPEG'), ('page-10.png', (40, 70, 200), 'PNG')]:
        im = Image.new('RGB', (60, 80), color); d = ImageDraw.Draw(im)
        d.rectangle((10, 10, 49, 29), fill=(255, 255, 255)); d.text((14, 14), name[5:7], fill=(0, 0, 0))
        b = io.BytesIO(); im.save(b, fmt, quality=92); files.append((name, b.getvalue()))
    files.append(('notes.txt', b'Pages 1, 2 and 10.\n'))
    files.append(('extras/cover.png', files[0][1]))
    return files


def dos_time(t):
    lt = time.gmtime(t)
    return ((lt.tm_year - 1980) << 25) | (lt.tm_mon << 21) | (lt.tm_mday << 16) | (lt.tm_hour << 11) | (lt.tm_min << 5) | (lt.tm_sec // 2)


def rar4(files, mtime):
    """RAR 2.x–4.x headers (marker, main, file headers with stored data, end), Unix host, '\\' separators."""
    def block(htype, flags, body, add=b''):
        size = 7 + len(body)
        head = struct.pack('<BHH', htype, flags, size) + body
        return struct.pack('<H', zlib.crc32(head) & 0xffff) + head + add
    out = bytearray(b'Rar!\x1a\x07\x00')
    out += block(0x73, 0, b'\0' * 6)
    dirs = sorted({n.rsplit('/', 1)[0] for n, _ in files if '/' in n})
    for d in dirs:
        name = d.replace('/', '\\').encode()
        body = struct.pack('<IIBIIBBHI', 0, 0, 3, 0, dos_time(mtime), 20, 0x30, len(name), 0o40755) + name
        out += block(0x74, 0x8000 | 0xe0, body)
    for n, data in files:
        name = n.replace('/', '\\').encode()
        body = struct.pack('<IIBIIBBHI', len(data), len(data), 3, zlib.crc32(data), dos_time(mtime), 20, 0x30, len(name), 0o100644) + name
        out += block(0x74, 0x8000, body, data)
    out += block(0x7b, 0x4000, b'')
    return bytes(out)


def vint(v):
    b = bytearray()
    while True:
        c = v & 0x7f; v >>= 7
        b.append(c | (0x80 if v else 0))
        if not v: return bytes(b)


def rar5(files, mtime):
    """RAR 5.0: signature, main header, stored file headers (mtime, CRC-32, Unix host), end of archive."""
    def header(body, data=b''):
        h = vint(len(body)) + body
        return struct.pack('<I', zlib.crc32(h)) + h + data
    out = bytearray(b'Rar!\x1a\x07\x01\x00')
    out += header(vint(1) + vint(0) + vint(0))
    for d in sorted({n.rsplit('/', 1)[0] for n, _ in files if '/' in n}):
        name = d.encode()
        out += header(vint(2) + vint(0) + vint(0x1 | 0x2) + vint(0) + vint(0o40755) + struct.pack('<I', mtime) + vint(0) + vint(1) + vint(len(name)) + name)
    for n, data in files:
        name = n.encode()
        body = vint(2) + vint(0x2) + vint(len(data)) + vint(0x2 | 0x4) + vint(len(data)) + vint(0o100644) + struct.pack('<II', mtime, zlib.crc32(data)) + vint(0) + vint(1) + vint(len(name)) + name
        out += header(body, data)
    out += header(vint(5) + vint(0) + vint(0))
    return bytes(out)


def main():
    os.makedirs(OUT, exist_ok=True)
    fetch()
    files, mtime = pictures(), 1262347200  # 2010-01-01 12:00 UTC
    open(os.path.join(OUT, 'comic4.cbr'), 'wb').write(rar4(files, mtime))
    open(os.path.join(OUT, 'comic5.cbr'), 'wb').write(rar5(files, mtime))
    for f in sorted(os.listdir(OUT)):
        print(f, os.path.getsize(os.path.join(OUT, f)))


if __name__ == '__main__':
    main()
