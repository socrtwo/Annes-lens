"""DICOM test fixtures: a selection of pydicom's test files (MIT; see tests/fixtures/dicom/LICENSE-pydicom) covering the
transfer syntaxes and pixel layouts, plus files written here with pydicom (window/level, MONOCHROME1, signed samples,
multiple frames, encapsulated JPEG and JPEG 2000 made with Pillow, a palette, a raw dataset without the Part 10 header).
The expected pictures are 8-bit PNGs computed from pydicom's pixel decoding (Pillow, GDCM and pylibjpeg as decoders)
with the display rules of the standard (PS3.3 C.11.2.1.2: the LINEAR window function; MONOCHROME1 inverted; the full
range of the frame when no window is given; PALETTE COLOR through its lookup tables).

Run from the repository root:  python3 scripts/gen-dicom-fixtures.py
"""
import io, json, os, shutil
import numpy as np
import pydicom
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.encaps import encapsulate
from pydicom.uid import ExplicitVRLittleEndian, ImplicitVRLittleEndian, JPEGBaseline8Bit, JPEG2000Lossless, RLELossless, generate_uid
from pydicom.pixels import apply_color_lut
from PIL import Image

OUT = 'tests/fixtures/dicom'
PYD = os.path.join(os.path.dirname(pydicom.__file__), 'data', 'test_files')
os.makedirs(OUT, exist_ok=True)

# pydicom's files: (name, what it covers)
PYDICOM_FILES = [
    ('CT_small.dcm', 'explicit VR LE, 16-bit signed CT with a rescale and no window'),
    ('MR_small.dcm', 'explicit VR LE, 16-bit MR with a window'),
    ('MR_small_implicit.dcm', 'implicit VR LE'),
    ('MR_small_bigendian.dcm', 'explicit VR big endian'),
    ('MR_small_RLE.dcm', 'RLE lossless, 16 bits'),
    ('MR_small_jp2klossless.dcm', 'JPEG 2000 lossless, 16 bits'),
    ('MR_small_jpeg_ls_lossless.dcm', 'JPEG-LS (not supported: the error names it)'),
    ('693_J2KI.dcm', 'JPEG 2000 lossy, 14 bits stored, CT window'),
    ('image_dfl.dcm', 'deflated explicit VR LE, 8 bits'),
    ('JPGExtended.dcm', 'JPEG extended (process 2 and 4), 12 bits'),
    ('SC_rgb_jpeg_gdcm.dcm', 'JPEG lossless (process 14, SV1), RGB'),
    ('SC_rgb_dcmtk_+eb+cy+np.dcm', 'JPEG baseline, YBR_FULL_422'),
    ('SC_rgb_dcmtk_+eb+cr.dcm', 'JPEG baseline, RGB without a color transform'),
    ('SC_rgb_jpeg.dcm', 'JPEG baseline, labelled RGB but YCbCr-coded with a JFIF header'),
    ('SC_rgb_rle_16bit_2frame.dcm', 'RLE lossless, RGB 16 bits, 2 frames'),
    ('SC_rgb_small_odd.dcm', 'RGB with an odd row length (padding)'),
    ('SC_ybr_full_422_uncompressed.dcm', 'uncompressed YBR_FULL_422'),
    ('ExplVR_BigEnd.dcm', 'explicit VR big endian, RGB'),
    ('examples_palette.dcm', 'PALETTE COLOR, 16-bit lookup tables'),
    ('liver_1frame.dcm', '1 bit per pixel (a segmentation)'),
    ('rtdose.dcm', '32-bit unsigned, 15 frames, implicit VR'),
]


def window(values, center, width, fn='LINEAR'):
    """PS3.3 C.11.2.1.2.1 (LINEAR and LINEAR_EXACT) and C.11.2.1.3.1 (SIGMOID), to 0..255."""
    x = values.astype(np.float64)
    if fn == 'SIGMOID':
        return np.clip(np.round(255 / (1 + np.exp(-4 * (x - center) / width))), 0, 255)
    if fn == 'LINEAR_EXACT':
        lo, hi = center - width / 2, center + width / 2
        y = (x - lo) / width * 255
    else:
        lo, hi = center - 0.5 - (width - 1) / 2, center - 0.5 + (width - 1) / 2
        y = ((x - (center - 0.5)) / (width - 1) + 0.5) * 255
    y = np.where(x <= lo, 0, np.where(x > hi, 255, y))
    return np.clip(np.round(y), 0, 255)


def first(v):
    return float(v[0]) if isinstance(v, pydicom.multival.MultiValue) else float(v)


def expected_frames(ds, arr):
    """8-bit pictures (H×W×3 uint8) for every frame, by the app's display rules."""
    pi = ds.PhotometricInterpretation
    frames = int(ds.get('NumberOfFrames', 1) or 1)
    if arr.ndim == 2 or (arr.ndim == 3 and pi in ('RGB', 'YBR_FULL', 'YBR_FULL_422', 'PALETTE COLOR') and arr.shape[-1] == 3 and frames == 1):
        arr = arr[None]
    out = []
    for f in range(frames):
        a = arr[f]
        if pi == 'PALETTE COLOR':
            rgb = apply_color_lut(a, ds)
            if rgb.dtype != np.uint8:
                rgb = np.round(rgb.astype(np.float64) * 255 / 65535).astype(np.uint8)
            out.append(rgb)
            continue
        if pi.startswith('MONOCHROME'):
            v = a.astype(np.float64)
            if 'RescaleSlope' in ds and 'RescaleIntercept' in ds:
                v = v * float(ds.RescaleSlope) + float(ds.RescaleIntercept)
            if 'WindowCenter' in ds and 'WindowWidth' in ds and ds.WindowCenter is not None and ds.WindowWidth is not None and first(ds.WindowWidth) >= 1:
                y = window(v, first(ds.WindowCenter), first(ds.WindowWidth), str(ds.get('VOILUTFunction', 'LINEAR') or 'LINEAR'))
            else:
                lo, hi = v.min(), v.max()
                y = np.zeros_like(v) if hi <= lo else np.round((v - lo) / (hi - lo) * 255)
            if pi == 'MONOCHROME1':
                y = 255 - y
            g = y.astype(np.uint8)
            out.append(np.stack([g, g, g], -1))
            continue
        out.append(a.astype(np.uint8) if a.dtype == np.uint8 else (a.astype(np.uint32) * 255 // ((1 << int(ds.BitsStored)) - 1)).astype(np.uint8))
    return out


def save_expected(name, ds, arr):
    ex = expected_frames(ds, arr)
    base = name[:-4]
    for i, rgb in enumerate(ex):
        if len(ex) > 1 and i not in (0, len(ex) - 1):
            continue
        Image.fromarray(rgb, 'RGB').save(os.path.join(OUT, f'{base}.f{i}.png' if len(ex) > 1 else f'{base}.png'), optimize=True)
    return {'frames': len(ex), 'width': int(ex[0].shape[1]), 'height': int(ex[0].shape[0]), 'pi': ds.PhotometricInterpretation, 'ts': str(ds.file_meta.TransferSyntaxUID) if hasattr(ds, 'file_meta') and 'TransferSyntaxUID' in ds.file_meta else None, 'comment': str(ds.get('ImageComments', ''))}


manifest = {}
for name, what in PYDICOM_FILES:
    shutil.copyfile(os.path.join(PYD, name), os.path.join(OUT, name))
    ds = pydicom.dcmread(os.path.join(OUT, name))
    if 'jpeg_ls' in name:
        manifest[name] = {'what': what, 'unsupported': 'JPEG-LS'}
        continue
    manifest[name] = {'what': what, **save_expected(name, ds, ds.pixel_array)}


def base_ds(ts, rows, cols, pi, samples=1, bits=16, stored=None, signed=0, frames=1):
    ds = Dataset()
    ds.file_meta = FileMetaDataset()
    ds.file_meta.TransferSyntaxUID = ts
    ds.file_meta.MediaStorageSOPClassUID = '1.2.840.10008.5.1.4.1.1.7'  # Secondary Capture
    ds.file_meta.MediaStorageSOPInstanceUID = generate_uid(entropy_srcs=[str(rows), str(cols), pi, str(ts), str(frames)])
    ds.SOPClassUID = ds.file_meta.MediaStorageSOPClassUID
    ds.SOPInstanceUID = ds.file_meta.MediaStorageSOPInstanceUID
    ds.SpecificCharacterSet = 'ISO_IR 192'
    ds.PatientName = 'Lens^Anne'
    ds.PatientID = 'AL-0001'
    ds.StudyDate = '20240311'
    ds.Modality = 'OT'
    ds.Manufacturer = "Anne's Lens test fixtures"
    ds.Rows, ds.Columns = rows, cols
    ds.SamplesPerPixel = samples
    ds.PhotometricInterpretation = pi
    if samples == 3:
        ds.PlanarConfiguration = 0
    ds.BitsAllocated = bits
    ds.BitsStored = stored or bits
    ds.HighBit = ds.BitsStored - 1
    ds.PixelRepresentation = signed
    if frames > 1:
        ds.NumberOfFrames = frames
    return ds


def gradient(rows, cols, scale, offset=0):
    yy, xx = np.mgrid[0:rows, 0:cols]
    return (offset + (xx * 3 + yy * 7) * scale).astype(np.int64)


def write(name, ds, arr=None, **save):
    path = os.path.join(OUT, name)
    ds.save_as(path, enforce_file_format=True, **save)
    back = pydicom.dcmread(path)
    manifest[name] = {'what': ds.get('ImageComments', ''), **save_expected(name, back, back.pixel_array)}


# A CT-like picture: 12 bits stored in 16, unsigned, rescale to Hounsfield units, a window (center 40, width 400),
# a second window pair after the first (only the first is used).
ds = base_ds(ExplicitVRLittleEndian, 32, 48, 'MONOCHROME2', bits=16, stored=12)
ds.Modality = 'CT'
ds.ImageComments = '12 bits stored, rescale and a window; two window pairs'
px = np.clip(gradient(32, 48, 12, 700), 0, 4095)
px[8:24, 16:32] = 1064 + 200  # a bright block (+200 HU)
px[12:20, 20:28] = 1064 - 300
ds.PixelData = px.astype('<u2').tobytes()
ds.RescaleIntercept, ds.RescaleSlope = -1024, 1
ds.WindowCenter, ds.WindowWidth = [40, 300], [400, 1500]
ds.WindowCenterWidthExplanation = ['SOFT TISSUE', 'BONE']
ds.PixelSpacing = [0.5, 0.5]
ds.SliceThickness = 2.5
ds.BodyPartExamined = 'CHEST'
ds.StudyDescription = 'Fixture study'
write('ct-window.dcm', ds)

# MONOCHROME1 8-bit without a window: full range, inverted.
ds = base_ds(ExplicitVRLittleEndian, 20, 40, 'MONOCHROME1', bits=8)
ds.ImageComments = 'MONOCHROME1, 8 bits, no window (full range, inverted)'
px = np.clip(gradient(20, 40, 1, 40), 0, 200)
ds.PixelData = px.astype(np.uint8).tobytes()
write('mono1.dcm', ds)

# Signed 16-bit samples, implicit VR, no window; also as RLE.
ds = base_ds(ImplicitVRLittleEndian, 24, 36, 'MONOCHROME2', bits=16, signed=1)
ds.ImageComments = 'signed 16-bit samples, implicit VR, no window'
px = gradient(24, 36, 9, -600)
ds.PixelData = px.astype('<i2').tobytes()
write('signed16-implicit.dcm', ds)
ds2 = pydicom.dcmread(os.path.join(OUT, 'signed16-implicit.dcm'))
ds2.ImageComments = 'signed 16-bit samples, RLE lossless'
ds2.compress(RLELossless, encoding_plugin='pydicom')
write('signed16-rle.dcm', ds2)

# Four 8-bit frames with a window; also as RLE.
ds = base_ds(ExplicitVRLittleEndian, 16, 24, 'MONOCHROME2', bits=8, frames=4)
ds.ImageComments = 'four 8-bit frames with a window'
fr = [np.clip(gradient(16, 24, 2, 20 * f), 0, 255).astype(np.uint8) for f in range(4)]
for f in range(4):
    fr[f][2 + f * 3:6 + f * 3, 4:20] = 255
ds.PixelData = b''.join(a.tobytes() for a in fr)
ds.WindowCenter, ds.WindowWidth = 128, 200
write('frames.dcm', ds)
ds2 = pydicom.dcmread(os.path.join(OUT, 'frames.dcm'))
ds2.ImageComments = 'four 8-bit frames, RLE lossless'
ds2.compress(RLELossless, encoding_plugin='pydicom')
write('frames-rle.dcm', ds2)

# JPEG baseline: one grayscale frame; two YBR_FULL_422 color frames with an offset table.
ds = base_ds(JPEGBaseline8Bit, 40, 56, 'MONOCHROME2', bits=8)
ds.ImageComments = 'JPEG baseline, one grayscale frame'
g = np.clip(gradient(40, 56, 1, 30), 0, 255).astype(np.uint8)
b = io.BytesIO(); Image.fromarray(g, 'L').save(b, format='JPEG', quality=92)
ds.PixelData = encapsulate([b.getvalue()])
ds['PixelData'].VR = 'OB'
write('jpeg-gray.dcm', ds)

ds = base_ds(JPEGBaseline8Bit, 32, 48, 'YBR_FULL_422', samples=3, bits=8, frames=2)
ds.ImageComments = 'JPEG baseline, two color frames (YBR_FULL_422), with a basic offset table'
frames = []
for f in range(2):
    rgb = np.zeros((32, 48, 3), np.uint8)
    rgb[..., 0] = np.clip(gradient(32, 48, 1, 20 + 60 * f), 0, 255)
    rgb[..., 1] = 90 + 40 * f
    rgb[..., 2] = np.clip(255 - gradient(32, 48, 1, 0), 0, 255)
    b = io.BytesIO(); Image.fromarray(rgb, 'RGB').save(b, format='JPEG', quality=95, subsampling='4:2:2')
    frames.append(b.getvalue())
ds.PixelData = encapsulate(frames, has_bot=True)
ds['PixelData'].VR = 'OB'
write('jpeg-color-frames.dcm', ds)

# JPEG 2000 lossless, 16-bit allocated 12 stored, with a window: the decoder reduces the samples to 8 bits.
ds = base_ds(JPEG2000Lossless, 24, 32, 'MONOCHROME2', bits=16, stored=12)
ds.ImageComments = 'JPEG 2000 lossless, 12 bits stored, with a window'
px = np.clip(gradient(24, 32, 20, 100), 0, 4095).astype('<u2')
b = io.BytesIO(); Image.fromarray(px).save(b, format='JPEG2000', no_jp2=True, irreversible=False)
ds.PixelData = encapsulate([b.getvalue()])
ds['PixelData'].VR = 'OB'
ds.WindowCenter, ds.WindowWidth = 2000, 3000
write('j2k-12bit.dcm', ds)

# A palette: 8-bit indices, 16-bit lookup tables (the common layout), 64 entries starting at index 0.
ds = base_ds(ExplicitVRLittleEndian, 16, 64, 'PALETTE COLOR', bits=8)
ds.ImageComments = 'PALETTE COLOR, 8-bit indices, 16-bit lookup tables'
idx = np.tile(np.arange(64, dtype=np.uint8), (16, 1))
ds.PixelData = idx.tobytes()
n = 64
ds.RedPaletteColorLookupTableDescriptor = [n, 0, 16]
ds.GreenPaletteColorLookupTableDescriptor = [n, 0, 16]
ds.BluePaletteColorLookupTableDescriptor = [n, 0, 16]
ds.RedPaletteColorLookupTableData = np.array([i * 1040 for i in range(n)], '<u2').tobytes()
ds.GreenPaletteColorLookupTableData = np.array([65535 - i * 1040 for i in range(n)], '<u2').tobytes()
ds.BluePaletteColorLookupTableData = np.array([(i * 4111) % 65536 for i in range(n)], '<u2').tobytes()
write('palette8.dcm', ds)

# A raw dataset: implicit VR little endian, no preamble, no file meta (as some PACS exports and DICOMDIR-less dumps are).
ds = base_ds(ImplicitVRLittleEndian, 10, 12, 'MONOCHROME2', bits=8)
ds.ImageComments = 'raw dataset without the Part 10 header'
ds.PixelData = np.clip(gradient(10, 12, 3, 0), 0, 255).astype(np.uint8).tobytes()
raw = os.path.join(OUT, 'raw-noheader.dcm')
ds.file_meta = FileMetaDataset()
ds.preamble = None
pydicom.dcmwrite(raw, ds, implicit_vr=True, little_endian=True, enforce_file_format=False)
back = pydicom.dcmread(raw, force=True)
back.file_meta = FileMetaDataset()
back.file_meta.TransferSyntaxUID = ImplicitVRLittleEndian
manifest['raw-noheader.dcm'] = {'what': 'raw dataset without the Part 10 header', **save_expected('raw-noheader.dcm', back, back.pixel_array)}

with open(os.path.join(OUT, 'expected.json'), 'w') as f:
    json.dump(manifest, f, indent=1, sort_keys=True)
with open(os.path.join(OUT, 'LICENSE-pydicom'), 'w') as f:
    f.write("The files listed as pydicom's in expected.json (\"what\" entries) come from pydicom's test suite\n"
            "(https://github.com/pydicom/pydicom, pydicom/data/test_files), distributed under pydicom's MIT license:\n\n")
    lic = open(os.path.join(os.path.dirname(pydicom.__file__), '..', 'pydicom-3.0.2.dist-info', 'licenses', 'LICENSE')).read()
    f.write(lic.split('Portions of pydicom')[0])
    f.write("\nFrom the test files' README: \"images were often downsized ... In some cases, the original files have been binary edited\n"
            "to replace anything that looks like a real patient name. I believe there is no restriction on using any of these files\n"
            "in this manner.\" CT_small.dcm derives from NEMA's WG04 data set CT1_UNC.\n")
print(json.dumps({k: (v.get('frames'), v.get('width'), v.get('height'), v.get('pi')) for k, v in manifest.items()}, indent=0))
