"""FITS files with World Coordinate Systems, written with astropy, and the sky positions astropy's WCS (wcslib) gives
for a set of pixels: the zenithal, cylindrical and pseudo-cylindrical projections the app reads, CD and PC/CDELT and
CROTA2 forms, a non-default LONPOLE, an oblique plate carrée, galactic coordinates, swapped axes, SIP distortion,
linear axes, and a tile-compressed image with a WCS. wcs.json holds the expected positions (astropy's 0-based pixel
convention, converted in the tests to the app's y-down coordinates).

Run from the repository root:  python3 scripts/gen-wcs-fixtures.py
"""
import json, os
import numpy as np
from astropy.io import fits
from astropy.wcs import WCS

OUT = 'tests/fixtures/fits'
os.makedirs(OUT, exist_ok=True)
W, H = 40, 30
rng = np.random.default_rng(1)
data = (rng.normal(100, 5, size=(H, W))).astype(np.float32)
PIXELS = [[0, 0], [W - 1, H - 1], [19.5, 14.5], [3.25, 27.75], [37, 2]]  # 0-based pixel centers (astropy origin 0)
manifest = {}


def write(name, extra, compressed=False, note=''):
    h = fits.Header()
    for k, v in extra.items():
        h[k] = v
    if compressed:
        hdu = fits.CompImageHDU(data=data, header=h, compression_type='RICE_1')
        fits.HDUList([fits.PrimaryHDU(), hdu]).writeto(os.path.join(OUT, name), overwrite=True)
        w = WCS(fits.open(os.path.join(OUT, name))[1].header)
    else:
        hdu = fits.PrimaryHDU(data=data, header=h)
        hdu.writeto(os.path.join(OUT, name), overwrite=True)
        w = WCS(fits.getheader(os.path.join(OUT, name)))
    world = w.all_pix2world(np.array(PIXELS, dtype=float), 0)
    sep = None
    try:
        from astropy.coordinates import SkyCoord
        import astropy.units as u
        if w.has_celestial:
            a = w.pixel_to_world(PIXELS[0][0], PIXELS[0][1]); b = w.pixel_to_world(PIXELS[1][0], PIXELS[1][1])
            sep = float(a.separation(b).deg)
    except Exception:
        pass
    manifest[name] = {'note': note, 'pixels': PIXELS, 'world': [[None if np.isnan(v) else float(v) for v in row] for row in world], 'separation01': sep, 'celestial': bool(w.has_celestial)}


base = {'CTYPE1': 'RA---TAN', 'CTYPE2': 'DEC--TAN', 'CRVAL1': 150.1, 'CRVAL2': -20.5, 'CRPIX1': 20.5, 'CRPIX2': 15.5, 'CD1_1': -0.0003, 'CD1_2': 0.00005, 'CD2_1': 0.00004, 'CD2_2': 0.00031, 'RADESYS': 'ICRS', 'EQUINOX': 2000.0}
write('wcs-tan-cd.fits', base, note='TAN with a CD matrix')
write('wcs-tan-pc.fits', {**{k: v for k, v in base.items() if not k.startswith('CD')}, 'CDELT1': -0.0003, 'CDELT2': 0.0003, 'PC1_1': 0.96, 'PC1_2': -0.28, 'PC2_1': 0.28, 'PC2_2': 0.96}, note='TAN with PC and CDELT')
write('wcs-tan-crota.fits', {**{k: v for k, v in base.items() if not k.startswith('CD')}, 'CDELT1': -0.0003, 'CDELT2': 0.0004, 'CROTA2': 33.0}, note='TAN with the legacy CROTA2')
write('wcs-tan-lonpole.fits', {**base, 'LONPOLE': 120.0}, note='TAN with LONPOLE 120')
for proj in ['SIN', 'ARC', 'STG', 'ZEA']:
    write(f'wcs-{proj.lower()}.fits', {**base, 'CTYPE1': f'RA---{proj}', 'CTYPE2': f'DEC--{proj}'}, note=f'{proj}, zenithal')
write('wcs-sin-slant.fits', {**base, 'CTYPE1': 'RA---SIN', 'CTYPE2': 'DEC--SIN', 'PV2_1': 0.02, 'PV2_2': -0.01}, note='slant orthographic (PV2_1, PV2_2)')
car = {'CTYPE1': 'RA---CAR', 'CTYPE2': 'DEC--CAR', 'CRVAL1': 150.1, 'CRVAL2': 0.0, 'CRPIX1': 20.5, 'CRPIX2': 15.5, 'CDELT1': -0.05, 'CDELT2': 0.05}
write('wcs-car.fits', car, note='plate carrée, reference on the equator')
write('wcs-car-oblique.fits', {**car, 'CRVAL2': 30.0}, note='plate carrée with CRVAL2 30 (oblique)')
write('wcs-mer.fits', {**car, 'CTYPE1': 'RA---MER', 'CTYPE2': 'DEC--MER'}, note='Mercator')
write('wcs-cea.fits', {**car, 'CTYPE1': 'RA---CEA', 'CTYPE2': 'DEC--CEA', 'PV2_1': 0.5}, note='cylindrical equal area, λ = 0.5')
write('wcs-ait.fits', {**car, 'CTYPE1': 'GLON-AIT', 'CTYPE2': 'GLAT-AIT', 'CRVAL1': 0.0, 'CDELT1': -1.0, 'CDELT2': 1.0}, note='Hammer–Aitoff, galactic')
write('wcs-sfl.fits', {**car, 'CTYPE1': 'GLON-SFL', 'CTYPE2': 'GLAT-SFL', 'CRVAL1': 90.0, 'CRVAL2': 0.0, 'CDELT1': -0.5, 'CDELT2': 0.5}, note='Sanson–Flamsteed, galactic')
write('wcs-swapped.fits', {'CTYPE1': 'DEC--TAN', 'CTYPE2': 'RA---TAN', 'CRVAL1': -20.5, 'CRVAL2': 150.1, 'CRPIX1': 15.5, 'CRPIX2': 20.5, 'CD1_1': 0.00031, 'CD1_2': 0.00004, 'CD2_1': 0.00005, 'CD2_2': -0.0003}, note='DEC on axis 1')
write('wcs-sip.fits', {**base, 'CTYPE1': 'RA---TAN-SIP', 'CTYPE2': 'DEC--TAN-SIP', 'A_ORDER': 2, 'A_0_2': 1.2e-5, 'A_1_1': -3.0e-5, 'A_2_0': 2.5e-5, 'B_ORDER': 2, 'B_0_2': -2.0e-5, 'B_1_1': 1.5e-5, 'B_2_0': 3.3e-5}, note='TAN with SIP distortion')
write('wcs-linear.fits', {'CTYPE1': 'WAVE', 'CTYPE2': 'TIME', 'CRVAL1': 500.0, 'CRVAL2': 0.0, 'CRPIX1': 1.0, 'CRPIX2': 1.0, 'CDELT1': 0.25, 'CDELT2': 2.0, 'CUNIT1': 'nm', 'CUNIT2': 's'}, note='linear axes (wavelength, time)')
write('wcs-compressed.fits', base, compressed=True, note='TAN in a tile-compressed image')
write('wcs-north-pole.fits', {**base, 'CTYPE1': 'RA---TAN', 'CTYPE2': 'DEC--TAN', 'CRVAL1': 0.0, 'CRVAL2': 90.0}, note='reference point at the celestial pole')
with open(os.path.join(OUT, 'wcs.json'), 'w') as f:
    json.dump(manifest, f, indent=1, sort_keys=True)
for k, v in manifest.items():
    print(k, v['note'], v['world'][0], v['separation01'])
