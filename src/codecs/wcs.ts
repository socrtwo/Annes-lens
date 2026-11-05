/**
 * FITS World Coordinate System (Greisen & Calabretta 2002, Calabretta & Greisen 2002): the celestial position of a
 * pixel from the header's CTYPE/CRVAL/CRPIX/CDELT, PC or CD matrix (or the legacy CROTA2), LONPOLE/LATPOLE, and the
 * projection: TAN, SIN, ARC, STG, ZEA (zenithal), CAR, MER, CEA (cylindrical), AIT, SFL/GLS (pseudo-cylindrical),
 * with the SIP polynomial distortion (Shupe et al. 2005) when the header carries it. Linear axes without a projection
 * are read too (plain CDELT scaling). Only the primary coordinate description (no alternate letters), two axes.
 * Pixel coordinates here are the app's: x to the right and y down from the top-left corner of the displayed picture,
 * continuous (a pixel's center at +0.5), with the first stored row at the bottom as the FITS reader shows it.
 */
export interface Wcs {
  /** CTYPE of the two axes, and the projection code ('' for linear axes). */
  ctype: [string, string]; proj: string;
  /** The reference pixel (FITS 1-based), reference value and the linear matrix (CD, degrees per pixel). */
  crpix: [number, number]; crval: [number, number]; cd: [number, number, number, number];
  lonpole: number; latpole: number;
  /** Native longitude/latitude of the fiducial point for the projection. */
  phi0: number; theta0: number;
  /** PV2_n projection parameters (CEA's λ, SIN's ξ/η). */
  pv: number[];
  /** SIP forward polynomials: [p, q, coefficient] triples for u (A) and v (B). */
  sipA?: [number, number, number][]; sipB?: [number, number, number][];
  /** Picture height, to turn y-down coordinates into FITS rows. */
  height: number;
  /** Coordinate frame for labels: 'equatorial' (RA/Dec), 'galactic', 'ecliptic', 'helioecliptic', 'supergalactic', 'other'. */
  frame: string; equinox?: string; radesys?: string;
  /** Axis units for linear axes (CUNIT). */
  cunit: [string, string];
}

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const ZENITHAL = new Set(['TAN', 'SIN', 'ARC', 'STG', 'ZEA']), CYLINDRICAL = new Set(['CAR', 'MER', 'CEA']), PSEUDO = new Set(['AIT', 'SFL', 'GLS']);
export const WCS_PROJECTIONS = [...ZENITHAL, ...CYLINDRICAL, ...PSEUDO];

/** Reads the WCS of a two-axis image from its header cards; null when there is none the reader understands. */
export function parseWcs(cards: Map<string, string>, width: number, height: number): Wcs | null {
  const num = (k: string, d: number): number => { const v = cards.get(k); const n = v === undefined ? NaN : +v; return Number.isFinite(n) ? n : d; };
  const has = (k: string) => cards.has(k) && Number.isFinite(+cards.get(k)!);
  const ctype1 = (cards.get('CTYPE1') || '').trim().toUpperCase(), ctype2 = (cards.get('CTYPE2') || '').trim().toUpperCase();
  if (!ctype1 && !ctype2 && !has('CRVAL1') && !has('CDELT1') && !has('CD1_1')) return null;
  if (num('WCSAXES', 2) < 2 && (ctype1 || ctype2) && !(ctype1 && ctype2)) return null;
  const parts1 = ctype1.split('-').filter(Boolean), parts2 = ctype2.split('-').filter(Boolean);
  let proj = '';
  const lonAxis = /^(RA|GLON|ELON|HLON|SLON|[A-Z]LON)$/.test(parts1[0] || '') && !/^(RA|GLON|ELON|HLON|SLON|[A-Z]LON)$/.test(parts2[0] || '') ? 0 : /^(RA|GLON|ELON|HLON|SLON|[A-Z]LON)$/.test(parts2[0] || '') ? 1 : -1;
  if (parts1.length >= 2 && parts2.length >= 2 && parts1[1] === parts2[1] && lonAxis >= 0) proj = parts1[1];
  const sip = /-SIP$/.test(ctype1) || parts1.includes('SIP');
  if (proj && !WCS_PROJECTIONS.includes(proj)) return null;
  // The linear part: CD, else PC × CDELT (with CROTA2 as a rotation of the PC matrix).
  const cdelt1 = num('CDELT1', 1), cdelt2 = num('CDELT2', 1);
  let cd: [number, number, number, number];
  if (has('CD1_1') || has('CD1_2') || has('CD2_1') || has('CD2_2')) cd = [num('CD1_1', 0), num('CD1_2', 0), num('CD2_1', 0), num('CD2_2', 0)];
  else {
    let pc: [number, number, number, number] = [num('PC1_1', 1), num('PC1_2', 0), num('PC2_1', 0), num('PC2_2', 1)];
    if (has('CROTA2') && !has('PC1_1') && !has('PC1_2') && !has('PC2_1') && !has('PC2_2')) {
      const rho = num('CROTA2', 0) * D2R, c = Math.cos(rho), s = Math.sin(rho);
      pc = [c, -s * (cdelt2 / cdelt1), s * (cdelt1 / cdelt2), c];
    }
    cd = [pc[0] * cdelt1, pc[1] * cdelt1, pc[2] * cdelt2, pc[3] * cdelt2];
  }
  if (!cd.some((v) => v !== 0)) return null;
  const crval: [number, number] = [num('CRVAL1', 0), num('CRVAL2', 0)], crpix: [number, number] = [num('CRPIX1', 0), num('CRPIX2', 0)];
  // Swapped axes (DEC first) are turned around so that axis 1 is the longitude.
  const w: Wcs = { ctype: [ctype1, ctype2], proj, crpix, crval, cd, lonpole: NaN, latpole: num('LATPOLE', 90), phi0: 0, theta0: 0, pv: [], height, frame: 'other', cunit: [(cards.get('CUNIT1') || '').trim(), (cards.get('CUNIT2') || '').trim()] };
  if (proj && lonAxis === 1) { w.ctype = [ctype2, ctype1]; w.crval = [crval[1], crval[0]]; w.cd = [cd[2], cd[3], cd[0], cd[1]]; w.pv = []; }
  if (proj) {
    const lonName = w.ctype[0].split('-')[0];
    w.frame = lonName === 'RA' ? 'equatorial' : lonName === 'GLON' ? 'galactic' : lonName === 'ELON' ? 'ecliptic' : lonName === 'HLON' ? 'helioecliptic' : lonName === 'SLON' ? 'supergalactic' : 'other';
    w.theta0 = ZENITHAL.has(proj) ? 90 : 0;
    for (let i = 0; i <= 2; i++) w.pv[i] = num(`PV2_${i}`, i === 1 && proj === 'CEA' ? 1 : 0);
    w.lonpole = has('LONPOLE') ? num('LONPOLE', 0) : w.crval[1] >= w.theta0 ? 0 : 180;
    if (cards.has('EQUINOX')) w.equinox = cards.get('EQUINOX')!.trim();
    if (cards.has('RADESYS')) w.radesys = cards.get('RADESYS')!.trim();
    if (sip) {
      const read = (p: string): [number, number, number][] => { const out: [number, number, number][] = [], order = num(`${p}_ORDER`, 0); for (let i = 0; i <= order; i++) for (let j = 0; j <= order - i; j++) { const k = `${p}_${i}_${j}`; if (has(k)) out.push([i, j, num(k, 0)]); } return out; };
      w.sipA = read('A'); w.sipB = read('B');
    }
  }
  if (!Number.isFinite(w.lonpole)) w.lonpole = 0;
  void width;
  return w;
}

/** The world coordinate of an app pixel position (x right, y down, continuous): degrees of longitude and latitude, or linear axis values. */
export function pixelToWorld(w: Wcs, x: number, y: number): [number, number] | null {
  let u = x + 0.5 - w.crpix[0], v = w.height - y + 0.5 - w.crpix[1]; // FITS pixel (x + 0.5, height − y + 0.5) relative to the reference pixel
  if (w.sipA || w.sipB) {
    const poly = (terms: [number, number, number][] | undefined) => { let s = 0; if (terms) for (const [p, q, c] of terms) s += c * u ** p * v ** q; return s; };
    const du = poly(w.sipA), dv = poly(w.sipB);
    u += du; v += dv;
  }
  const ix = w.cd[0] * u + w.cd[1] * v, iy = w.cd[2] * u + w.cd[3] * v; // intermediate world coordinates (degrees)
  if (!w.proj) return [w.crval[0] + ix, w.crval[1] + iy];
  // The projection's inverse: (x, y) → native spherical (φ, θ).
  let phi: number, theta: number;
  const p = w.proj, r = Math.hypot(ix, iy);
  if (ZENITHAL.has(p)) {
    phi = r === 0 ? 0 : Math.atan2(ix, -iy) * R2D;
    if (p === 'TAN') theta = Math.atan2(R2D, r) * R2D;
    else if (p === 'SIN') {
      const xi = w.pv[1] || 0, eta = w.pv[2] || 0;
      if (xi === 0 && eta === 0) { const s = r * D2R; if (s > 1) return null; theta = Math.acos(s) * R2D; }
      else { // the slant orthographic (eq. 56–58 of Calabretta & Greisen 2002)
        const X = ix * D2R, Y = iy * D2R, a = xi * xi + eta * eta + 1, b = xi * (X - xi) + eta * (Y - eta), c = (X - xi) ** 2 + (Y - eta) ** 2 - 1;
        const disc = b * b - a * c; if (disc < 0) return null;
        const t = (-b + Math.sqrt(disc)) / a; // the root nearest θ = 90°
        theta = Math.asin(Math.max(-1, Math.min(1, t))) * R2D;
        phi = Math.atan2(X - xi * (1 - Math.sin(theta * D2R)), -(Y - eta * (1 - Math.sin(theta * D2R)))) * R2D;
      }
    } else if (p === 'ARC') theta = 90 - r;
    else if (p === 'STG') theta = 90 - 2 * Math.atan((r * D2R) / 2) * R2D;
    else { const s = (r * D2R) / 2; if (s > 1) return null; theta = 90 - 2 * Math.asin(s) * R2D; } // ZEA
  } else if (p === 'CAR') { phi = ix; theta = iy; }
  else if (p === 'MER') { phi = ix; theta = 2 * Math.atan(Math.exp(iy * D2R)) * R2D - 90; }
  else if (p === 'CEA') { const lam = w.pv[1] || 1, s = lam * iy * D2R; if (Math.abs(s) > 1) return null; phi = ix; theta = Math.asin(s) * R2D; }
  else if (p === 'AIT') {
    const z2 = 1 - (ix * D2R / 4) ** 2 - (iy * D2R / 2) ** 2; if (z2 < 0.5) return null; // outside the ellipse
    const z = Math.sqrt(z2);
    phi = 2 * Math.atan2((z * ix * D2R) / 2, 2 * z2 - 1) * R2D;
    const s = iy * D2R * z; if (Math.abs(s) > 1) return null; theta = Math.asin(s) * R2D;
  } else { // SFL / GLS
    theta = iy; const c = Math.cos(theta * D2R); if (Math.abs(c) < 1e-12) return null; phi = ix / c;
  }
  if (!Number.isFinite(phi) || !Number.isFinite(theta)) return null;
  return nativeToCelestial(w, phi, theta);
}

/** The spherical rotation from native (φ, θ) to celestial (α, δ), eq. 2 of Calabretta & Greisen 2002. */
function nativeToCelestial(w: Wcs, phi: number, theta: number): [number, number] {
  const [ap, dp] = celestialPole(w), phip = w.lonpole;
  const st = Math.sin(theta * D2R), ct = Math.cos(theta * D2R), sdp = Math.sin(dp * D2R), cdp = Math.cos(dp * D2R);
  const dphi = (phi - phip) * D2R, cdphi = Math.cos(dphi), sdphi = Math.sin(dphi);
  const delta = Math.asin(Math.max(-1, Math.min(1, st * sdp + ct * cdp * cdphi))) * R2D;
  let alpha = ap + Math.atan2(-ct * sdphi, st * cdp - ct * sdp * cdphi) * R2D;
  alpha = ((alpha % 360) + 360) % 360;
  return [alpha, delta];
}

/** The celestial coordinates of the native pole (α_p, δ_p), eq. 8–9 of the paper, from the reference point. */
function celestialPole(w: Wcs): [number, number] {
  const [a0, d0] = w.crval, phip = w.lonpole, phi0 = w.phi0, theta0 = w.theta0;
  if (theta0 === 90) return [a0, d0]; // zenithal: the reference point is the native pole
  const st0 = Math.sin(theta0 * D2R), ct0 = Math.cos(theta0 * D2R), dphi = (phip - phi0) * D2R, cdphi = Math.cos(dphi), sdphi = Math.sin(dphi);
  const sd0 = Math.sin(d0 * D2R), A = st0, B = ct0 * cdphi, R = Math.hypot(A, B);
  let dp: number;
  if (R < 1e-12) dp = w.latpole;
  else {
    const g = Math.atan2(B, A), ratio = Math.max(-1, Math.min(1, sd0 / R)), s1 = Math.asin(ratio);
    const cands = [s1 - g, Math.PI - s1 - g].map((v) => { let d = v * R2D; while (d > 180) d -= 360; while (d < -180) d += 360; return d; }).filter((d) => d >= -90.000001 && d <= 90.000001);
    if (!cands.length) dp = w.latpole;
    else if (cands.length === 1) dp = cands[0];
    else dp = Math.abs(cands[0] - w.latpole) <= Math.abs(cands[1] - w.latpole) ? cands[0] : cands[1];
  }
  const sdp = Math.sin(dp * D2R), cdp = Math.cos(dp * D2R);
  let ap: number;
  if (Math.abs(d0) >= 90 - 1e-9) ap = a0 - (d0 > 0 ? (phip - phi0 - 180) : (phi0 - phip)); // the reference point at a celestial pole
  else ap = a0 - Math.atan2(ct0 * sdphi, st0 * cdp - ct0 * sdp * cdphi) * R2D;
  return [ap, dp];
}

/** Great-circle separation of two (lon, lat) positions in degrees. */
export function angularSeparation(a: [number, number], b: [number, number]): number {
  const [l1, b1] = [a[0] * D2R, a[1] * D2R], [l2, b2] = [b[0] * D2R, b[1] * D2R];
  const dl = l2 - l1, sb1 = Math.sin(b1), cb1 = Math.cos(b1), sb2 = Math.sin(b2), cb2 = Math.cos(b2);
  const num = Math.hypot(cb2 * Math.sin(dl), cb1 * sb2 - sb1 * cb2 * Math.cos(dl)), den = sb1 * sb2 + cb1 * cb2 * Math.cos(dl);
  return Math.atan2(num, den) * R2D;
}

/** An angle in degrees as °, ′ or ″ with sensible precision. */
export function formatAngle(deg: number): string {
  const a = Math.abs(deg);
  if (a >= 1) return `${trim(deg.toFixed(4))}°`;
  if (a >= 1 / 60) return `${trim((deg * 60).toFixed(3))}′`;
  return `${trim((deg * 3600).toFixed(2))}″`;
}
const trim = (s: string) => s.replace(/\.?0+$/, '');
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
/** Right ascension as hh:mm:ss.ss. */
export function formatRa(deg: number): string {
  let h = (((deg % 360) + 360) % 360) / 15;
  let hh = Math.floor(h), mm = Math.floor((h - hh) * 60), ss = ((h - hh) * 60 - mm) * 60;
  ss = Math.round(ss * 100) / 100;
  if (ss >= 60) { ss -= 60; mm++; } if (mm >= 60) { mm -= 60; hh = (hh + 1) % 24; }
  return `${pad(hh)}:${pad(mm)}:${ss.toFixed(2).padStart(5, '0')}`;
}
/** Declination (or any latitude) as ±dd:mm:ss.s. */
export function formatDec(deg: number): string {
  const sign = deg < 0 ? '−' : '+', a = Math.abs(deg);
  let dd = Math.floor(a), mm = Math.floor((a - dd) * 60), ss = ((a - dd) * 60 - mm) * 60;
  ss = Math.round(ss * 10) / 10;
  if (ss >= 60) { ss -= 60; mm++; } if (mm >= 60) { mm -= 60; dd++; }
  return `${sign}${pad(dd)}:${pad(mm)}:${ss.toFixed(1).padStart(4, '0')}`;
}
/** The readout for a position: "RA 10:00:24.00 Dec −20:30:00.0 (J2000)", "l 123.4567° b +12.3456°", or linear axis values. */
export function formatWorld(w: Wcs, pos: [number, number], withFrame = true): string {
  if (!w.proj) return `${w.ctype[0] || 'axis 1'} ${trim(pos[0].toFixed(6))}${w.cunit[0] ? ' ' + w.cunit[0] : ''}, ${w.ctype[1] || 'axis 2'} ${trim(pos[1].toFixed(6))}${w.cunit[1] ? ' ' + w.cunit[1] : ''}`;
  if (w.frame === 'equatorial') return `RA ${formatRa(pos[0])} Dec ${formatDec(pos[1])}${withFrame && (w.radesys || w.equinox) ? ` (${w.radesys ? w.radesys : ''}${w.radesys && w.equinox ? ' ' : ''}${w.equinox ? (/^\d/.test(w.equinox) ? 'J' + trim((+w.equinox).toFixed(1)) : w.equinox) : ''})` : ''}`;
  const [ln, lt] = w.frame === 'galactic' ? ['l', 'b'] : w.frame === 'ecliptic' ? ['λ', 'β'] : w.frame === 'supergalactic' ? ['SGL', 'SGB'] : [w.ctype[0].split('-')[0], w.ctype[1].split('-')[0]];
  return `${ln} ${trim(pos[0].toFixed(5))}° ${lt} ${pos[1] >= 0 ? '+' : '−'}${trim(Math.abs(pos[1]).toFixed(5))}°`;
}
/** The sky scale at a pixel: degrees along a pixel's diagonal neighbour… no: the mean of the two axes' scales, in degrees per pixel. */
export function pixelScale(w: Wcs, x: number, y: number): number | null {
  const a = pixelToWorld(w, x, y), b = pixelToWorld(w, x + 1, y), c = pixelToWorld(w, x, y + 1);
  if (!a || !b || !c) return null;
  return (angularSeparation(a, b) + angularSeparation(a, c)) / 2;
}
