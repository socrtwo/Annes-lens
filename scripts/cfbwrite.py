"""A small writer of Microsoft Compound File Binary (OLE2 structured storage) files, for test fixtures: storages and
streams from a dictionary of paths, 512-byte sectors, a mini stream for streams under 4096 bytes, one FAT, a DIFAT
in the header. Written from the format's description; the files are read back with olefile in the fixture scripts.
"""
import struct, uuid

SEC = 512
MINI = 64
ENDOFCHAIN = 0xFFFFFFFE
FREESECT = 0xFFFFFFFF
NOSTREAM = 0xFFFFFFFF


def _entry(name, kind, clsid, start, size, left, right, child):
    n = name.encode('utf-16-le') + b'\0\0'
    e = bytearray(128)
    e[0:len(n)] = n
    struct.pack_into('<H', e, 64, len(n))
    e[66] = kind  # 1 storage, 2 stream, 5 root
    e[67] = 1     # black
    struct.pack_into('<III', e, 68, left, right, child)
    e[80:96] = clsid
    struct.pack_into('<II', e, 116, start, size)
    return bytes(e)


def write(path, streams, root_clsid=None, storage_clsids=None):
    """streams: {"Storage/Sub/Stream": bytes}; storages are created for every path prefix. storage_clsids: {"Storage": uuid}."""
    storage_clsids = storage_clsids or {}
    # The tree: children per storage, in the directory's sort order (shorter names first, then uppercase comparison).
    tree = {'': {}}
    for p in streams:
        parts = p.split('/')
        cur = tree['']
        for i, part in enumerate(parts):
            full = '/'.join(parts[:i + 1])
            if i == len(parts) - 1:
                cur[part] = ('stream', full)
            else:
                if part not in cur:
                    cur[part] = ('storage', full, {})
                    tree[full] = cur[part][2]
                cur = cur[part][2]
    # Sector data: big streams (>= 4096) and the mini stream.
    big = bytearray()
    mini = bytearray()
    starts = {}
    mini_fat = []
    big_chains = []  # (first sector, count) in order of appearance

    def add_big(data):
        first = len(big) // SEC
        n = -(-len(data) // SEC)
        big.extend(data + bytes(n * SEC - len(data)))
        big_chains.append((first, n))
        return first

    def add_mini(data):
        first = len(mini) // MINI
        n = -(-len(data) // MINI)
        mini.extend(data + bytes(n * MINI - len(data)))
        for i in range(n):
            mini_fat.append(first + i + 1 if i < n - 1 else ENDOFCHAIN)
        return first

    for p, data in streams.items():
        if len(data) >= 4096:
            starts[p] = add_big(data)
        else:
            starts[p] = add_mini(data) if data else 0
    mini_first = add_big(bytes(mini)) if mini else ENDOFCHAIN
    # Directory entries, depth first; siblings as a balanced-enough binary tree in sort order (a sorted chain is accepted by readers).
    entries = []

    def key(name):
        return (len(name), name.upper())

    def build(children):
        """Returns the index of the root of the sibling tree for these children."""
        names = sorted(children, key=key)
        idx = []
        for name in names:
            kind, full = children[name][0], children[name][1]
            i = len(entries)
            entries.append(None)
            if kind == 'stream':
                data = streams[full]
                entries[i] = ['stream', name, bytes(16), starts[full], len(data), NOSTREAM, NOSTREAM, NOSTREAM]
            else:
                clsid = storage_clsids.get(full)
                entries[i] = ['storage', name, clsid.bytes_le if clsid else bytes(16), 0, 0, NOSTREAM, NOSTREAM, NOSTREAM]
                entries[i][7] = build(children[name][2])
            idx.append(i)
        # Link as a balanced binary tree.
        def link(lo, hi):
            if lo > hi:
                return NOSTREAM
            mid = (lo + hi) // 2
            entries[idx[mid]][5] = link(lo, mid - 1)
            entries[idx[mid]][6] = link(mid + 1, hi)
            return idx[mid]
        return link(0, len(idx) - 1)

    entries.append(['root', 'Root Entry', root_clsid.bytes_le if root_clsid else bytes(16), mini_first, len(mini), NOSTREAM, NOSTREAM, NOSTREAM])
    entries[0][7] = build(tree[''])
    dir_bytes = b''.join(_entry(e[1], {'root': 5, 'storage': 1, 'stream': 2}[e[0]], e[2], e[3], e[4], e[5], e[6], e[7]) for e in entries)
    dir_bytes += bytes((-len(dir_bytes)) % SEC)
    dir_first = add_big(dir_bytes)
    # Mini FAT sectors.
    mf = b''.join(struct.pack('<I', v) for v in mini_fat)
    mf += bytes((-len(mf)) % SEC)
    minifat_first = add_big(mf) if mini_fat else ENDOFCHAIN
    minifat_count = len(mf) // SEC if mini_fat else 0
    # The FAT: one entry per sector so far, plus the FAT sectors themselves.
    total = len(big) // SEC
    fat_sectors = -(-(total + 1) * 4 // SEC)
    while -(-(total + fat_sectors) * 4 // SEC) > fat_sectors:
        fat_sectors += 1
    fat = [FREESECT] * ((total + fat_sectors) if (total + fat_sectors) * 4 % SEC == 0 else fat_sectors * SEC // 4)
    for first, n in big_chains:
        for i in range(n):
            fat[first + i] = first + i + 1 if i < n - 1 else ENDOFCHAIN
    for i in range(fat_sectors):
        fat[total + i] = 0xFFFFFFFD  # FATSECT
    fat_bytes = b''.join(struct.pack('<I', v) for v in fat)
    fat_bytes += bytes(fat_sectors * SEC - len(fat_bytes))
    header = bytearray(SEC)
    header[0:8] = b'\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1'
    struct.pack_into('<HHHHHHIIIIIIIII', header, 24, 0x003E, 0x0003, 0xFFFE, 9, 6, 0, 0, 0, fat_sectors, dir_first, 0, 4096, minifat_first, minifat_count, ENDOFCHAIN)
    struct.pack_into('<I', header, 72, 0)  # DIFAT count 0 beyond the header
    for i in range(109):
        struct.pack_into('<I', header, 76 + i * 4, total + i if i < fat_sectors else FREESECT)
    with open(path, 'wb') as f:
        f.write(bytes(header) + bytes(big) + fat_bytes)


def read_all(path):
    """Every stream of a compound file as {path: bytes}, with olefile, plus the root and storage class IDs."""
    import olefile
    ole = olefile.OleFileIO(path)
    out = {}
    clsids = {}
    for parts in ole.listdir(streams=True, storages=True):
        p = '/'.join(parts)
        if ole.get_type(parts) == olefile.STGTY_STREAM:
            out[p] = ole.openstream(parts).read()
        else:
            c = ole.getclsid(parts)
            if c:
                clsids[p] = uuid.UUID(c)
    root = uuid.UUID(ole.root.clsid) if ole.root.clsid else None
    ole.close()
    return out, root, clsids
