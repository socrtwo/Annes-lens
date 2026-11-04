#!/usr/bin/env python3
"""Autodesk Animator FLI and FLC test files, written here chunk by chunk from the format's description.

Writes to tests/fixtures/flic/:
  anim.fli   320 x 200, 6 frames: COLOR_64 palette, BYTE_RUN, DELTA_FLI (LC) frames, BLACK, FLI_COPY; then the
             ring frame back to the first        expected: anim-<n>.png (ffmpeg's decoding, 6-bit colors widened
             to the full range; checked against Pillow's color indices)
  anim.flc   95 x 64, 5 frames: COLOR_256, BYTE_RUN, DELTA_FLC (SS2) frames with skips, line skips and the odd
             width's last byte, a palette change in frame 4   expected: flc-<n>.png (Pillow's color indices through
             each frame's palette; checked against ffmpeg's frames, which put the odd width's last byte in their
             row padding, and Pillow keeps only the first frame's palette)
Needs numpy, Pillow and ffmpeg.
"""
import os, struct, subprocess, tempfile
import numpy as np
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'flic')


def chunk(kind, data):
    if len(data) & 1:
        data += b'\0'
    return struct.pack('<IH', 6 + len(data), kind) + data


def color(pal, six):
    sh = 2 if six else 0
    body = struct.pack('<H', 1) + bytes([0, 0]) + bytes(int(v) >> sh for c in pal for v in c)
    return chunk(11 if six else 4, body)


def brun(img):
    out = bytearray()
    for row in img:
        packets, line, x, w = 0, bytearray(), 0, len(row)
        while x < w:
            r = x
            while r < w and r - x < 127 and row[r] == row[x]:
                r += 1
            if r - x >= 2:
                line += bytes([r - x, row[x]])
                x = r
            else:
                e = x
                while e < w and e - x < 127 and not (e + 1 < w and row[e] == row[e + 1]):
                    e += 1
                e = max(e, x + 1)
                line += bytes([(256 - (e - x)) & 255]) + bytes(row[x:e])
                x = e
            packets += 1
        out += bytes([min(packets, 255)]) + line
    return chunk(15, bytes(out))


def lc(prev, cur):
    """DELTA_FLI: skipped lines, a line count, and per line skip/literal/run packets of bytes."""
    rows = [y for y in range(cur.shape[0]) if (cur[y] != prev[y]).any()]
    if not rows:
        return chunk(12, struct.pack('<HH', 0, 0))
    first, last = rows[0], rows[-1]
    out = bytearray(struct.pack('<HH', first, last - first + 1))
    for y in range(first, last + 1):
        packets, line, x, w = 0, bytearray(), 0, cur.shape[1]
        while True:
            s = x
            while x < w and cur[y, x] == prev[y, x]:
                x += 1
            if x >= w:
                break
            while x - s > 255:
                line += bytes([255, 0]); packets += 1; s += 255  # a skip of 255 with nothing written
            e = x
            while e < w and e - x < 127 and cur[y, e] != prev[y, e]:
                e += 1
            run = all(cur[y, x] == cur[y, k] for k in range(x, e))
            if run and e - x >= 3:
                line += bytes([x - s, (256 - (e - x)) & 255, cur[y, x]])
            else:
                line += bytes([x - s, e - x]) + bytes(cur[y, x:e])
            packets += 1
            x = e
        out += bytes([packets]) + line
    return chunk(12, bytes(out))


def ss2(prev, cur):
    """DELTA_FLC: lines of words; line skips (0xC000 | -n), an odd width's last byte (0x8000 | b), packet counts."""
    h, w = cur.shape
    out, lines, y, pending = bytearray(), 0, 0, 0
    while y < h:
        if (cur[y] == prev[y]).all():
            pending += 1
            y += 1
            continue
        words = bytearray()
        if pending:
            words += struct.pack('<H', (0x10000 - pending) & 0xFFFF)  # top bits 11: skip lines
            pending = 0
        if w & 1 and cur[y, w - 1] != prev[y, w - 1]:
            words += struct.pack('<H', 0x8000 | int(cur[y, w - 1]))
        even = w & ~1
        packets, body, x = 0, bytearray(), 0
        while True:
            s = x
            while x < even and cur[y, x] == prev[y, x] and cur[y, x + 1] == prev[y, x + 1]:
                x += 2
            if x >= even:
                break
            e = x
            while e < even and (e - x) // 2 < 127 and (cur[y, e] != prev[y, e] or cur[y, e + 1] != prev[y, e + 1]):
                e += 2
            pairs = [(cur[y, k], cur[y, k + 1]) for k in range(x, e, 2)]
            if len(pairs) >= 2 and all(p == pairs[0] for p in pairs):
                body += bytes([x - s, (256 - len(pairs)) & 255, pairs[0][0], pairs[0][1]])
            else:
                body += bytes([x - s, len(pairs)]) + bytes(v for p in pairs for v in p)
            packets += 1
            x = e
        words += struct.pack('<H', packets) + body
        out += words
        lines += 1
        y += 1
    return chunk(7, struct.pack('<H', lines) + bytes(out))


def frame(chunks):
    body = b''.join(chunks)
    return struct.pack('<IHH8x', 16 + len(body), 0xF1FA, len(chunks)) + body


def header(magic, n, w, h, speed, size):
    hd = bytearray(128)
    struct.pack_into('<IHHHHHHI', hd, 0, size, magic, n, w, h, 8, 3, speed)
    return hd


def write(path, magic, frames_imgs, pals, speed, w, h, flc):
    frames, prev = [], None
    for i, img in enumerate(frames_imgs):
        ch = []
        if i == 0 or (pals[i] is not pals[i - 1]):
            ch.append(color(pals[i], six=not flc))
        if i == 0:
            ch.append(brun(img))
        elif not img.any():
            ch.append(chunk(13, bytes(4)))  # BLACK (padded: Pillow rejects a chunk under 10 bytes)
        elif i == 4 and not flc:
            ch.append(chunk(16, img.tobytes()))  # FLI_COPY
        else:
            ch.append(ss2(prev, img) if flc else lc(prev, img))
        frames.append(frame(ch))
        prev = img
    # The ring frame: back to the first picture.
    frames.append(frame([ss2(prev, frames_imgs[0]) if flc else lc(prev, frames_imgs[0])]))
    body = b''.join(frames)
    hd = header(magic, len(frames_imgs), w, h, speed, 128 + len(body))
    if flc:
        struct.pack_into('<II', hd, 80, 128, 128 + len(frames[0]))
    open(path, 'wb').write(bytes(hd) + body)


def main():
    os.makedirs(OUT, exist_ok=True)
    # FLI: 320 x 200, a 64-color palette (6-bit values).
    w, h = 320, 200
    y, x = np.mgrid[0:h, 0:w]
    pal = [(i * 4 % 256 & 0xFC, (255 - i * 4) & 0xFC, (i * 9) & 0xFC) for i in range(256)]
    base = ((x // 8 + y // 8) % 64).astype(np.uint8)
    imgs = [base]
    for k in range(1, 6):
        f = imgs[-1].copy()
        if k == 3:
            f[:] = 0
        elif k == 4:
            f = ((x // 4 + y // 4 + 7) % 64).astype(np.uint8)
        else:
            f[20 * k:20 * k + 30, 10 * k:10 * k + 80] = (k * 11) % 64
            f[150:152, 300:302] = 63
        imgs.append(f)
    write(os.path.join(OUT, 'anim.fli'), 0xAF11, imgs, [pal] * 6, 5, w, h, False)
    ffmpeg_frames(os.path.join(OUT, 'anim.fli'), 'anim', 6)
    # Cross-check with Pillow's color indices through the full-range palette (Pillow itself scales 63 to 252).
    full = np.array([[(v >> 2) << 2 | (v >> 2) >> 4 for v in c] for c in pal], np.uint8)
    im = Image.open(os.path.join(OUT, 'anim.fli'))
    for n in range(6):
        im.seek(n)
        assert (full[np.asarray(im)] == np.asarray(Image.open(os.path.join(OUT, 'anim-%d.png' % n)))).all(), n
    # FLC: 96 x 64 (an odd-width case is covered by a 95-pixel run of the last byte), a palette change in frame 4.
    w, h = 95, 64
    y, x = np.mgrid[0:h, 0:w]
    palA = [(i, 255 - i, (i * 3) % 256) for i in range(256)]
    palB = [((i * 7) % 256, i, 128) for i in range(256)]
    imgs = [((x * 2 + y) % 256).astype(np.uint8)]
    for k in range(1, 5):
        f = imgs[-1].copy()
        f[5 * k:5 * k + 6, 3 * k:3 * k + 40] = 200 + k
        f[40:42, :] = (k * 37) % 256
        f[:, w - 1] = (k * 50) % 256
        imgs.append(f)
    pals = [palA, palA, palA, palA, palB]
    write(os.path.join(OUT, 'anim.flc'), 0xAF12, imgs, pals, 80, w, h, True)
    # Expected: Pillow's color indices through each frame's palette (Pillow keeps the first frame's); the same
    # as ffmpeg's frames except the odd width's last column, which ffmpeg writes into its row padding.
    ffmpeg_frames(os.path.join(OUT, 'anim.flc'), 'ffmpeg', 5)
    im = Image.open(os.path.join(OUT, 'anim.flc'))
    for n in range(5):
        im.seek(n)
        exp = np.array(pals[n], np.uint8)[np.asarray(im)]
        ff = np.asarray(Image.open(os.path.join(OUT, 'ffmpeg-%d.png' % n)))
        assert (exp[:, :w - 1] == ff[:, :w - 1]).all(), n
        Image.fromarray(exp).save(os.path.join(OUT, 'flc-%d.png' % n))
        os.remove(os.path.join(OUT, 'ffmpeg-%d.png' % n))


def ffmpeg_frames(src, prefix, n):
    with tempfile.TemporaryDirectory() as t:
        subprocess.run(['ffmpeg', '-v', 'error', '-i', src, '-vsync', '0', os.path.join(t, 'f%d.png')], check=True)
        for k in range(n):
            Image.open(os.path.join(t, 'f%d.png' % (k + 1))).convert('RGB').save(os.path.join(OUT, '%s-%d.png' % (prefix, k)))

if __name__ == '__main__':
    main()
