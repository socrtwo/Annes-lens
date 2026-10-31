// Command-line options for the desktop app (Help ▸ Command-Line Help shows the same list):
// open pictures full screen or as a slideshow, or convert them without a window, in the spirit of
// IrfanView's switches. Options are --name, --name=value or --name value; -f, -s, -h, -v for short.
'use strict';
const path = require('path');
const OPTIONS = require('./cli-options.json');

const FORMATS = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp', bmp: 'bmp', tga: 'tga', ppm: 'ppm', pgm: 'ppm', pam: 'ppm', qoi: 'qoi', wbmp: 'wbmp' };

/** Parses argv (after the program and, unpackaged, the app folder). Unknown --options are reported but left to Electron/Chromium. */
function parseCli(args) {
  const o = { inputs: [], errors: [], unknown: [] };
  const byName = new Map(OPTIONS.map((x) => [x.name, x])), byShort = new Map(OPTIONS.filter((x) => x.short).map((x) => [x.short, x]));
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    if (a === '--') { o.inputs.push(...args.slice(i + 1)); break; }
    let opt = null, value;
    if (a.startsWith('--')) { const eq = a.indexOf('='); const name = a.slice(2, eq < 0 ? undefined : eq); opt = byName.get(name); if (eq >= 0) value = a.slice(eq + 1); if (!opt) { o.unknown.push(a); continue; } }
    else if (/^-[a-z]$/i.test(a)) { opt = byShort.get(a[1]); if (!opt) { o.unknown.push(a); continue; } }
    else if (a.startsWith('-')) { o.unknown.push(a); continue; }
    else { o.inputs.push(a); continue; }
    if (opt.value) {
      if (value === undefined) { if (i + 1 < args.length && !String(args[i + 1]).startsWith('-')) value = String(args[++i]); else { o.errors.push(`--${opt.name} needs a value (${opt.value})`); continue; } }
    } else if (value !== undefined) { o.errors.push(`--${opt.name} takes no value`); continue; }
    o[opt.name] = opt.value ? value : true;
  }
  if (o.resize !== undefined) {
    const m = String(o.resize).match(/^(?:(\d+)%|(\d+)?(?:x(\d+))?)$/i);
    if (!m || (!m[1] && !m[2] && !m[3])) o.errors.push(`--resize=${o.resize}: use WxH, W, xH or N%`);
    else o.resizeSpec = m[1] ? { mode: 'percent', value: +m[1] } : m[2] && m[3] ? { mode: 'box', value: +m[2], value2: +m[3] } : m[2] ? { mode: 'width', value: +m[2] } : { mode: 'height', value: +m[3] };
  }
  if (o.long !== undefined) { if (!/^\d+$/.test(o.long) || +o.long < 1) o.errors.push(`--long=${o.long}: a number of pixels`); else if (o.resizeSpec) o.errors.push('Use --resize or --long, not both'); else o.resizeSpec = { mode: 'long', value: +o.long }; }
  if (o.rotate !== undefined && !['90', '180', '270', 'exif'].includes(String(o.rotate))) o.errors.push(`--rotate=${o.rotate}: use 90, 180, 270 or exif`);
  if (o.flip !== undefined && !['h', 'v'].includes(String(o.flip))) o.errors.push(`--flip=${o.flip}: use h or v`);
  if (o.quality !== undefined && !(/^\d+$/.test(o.quality) && +o.quality >= 1 && +o.quality <= 100)) o.errors.push(`--quality=${o.quality}: 1 to 100`);
  if (o.convert !== undefined) {
    const ext = path.extname(String(o.convert)).slice(1).toLowerCase();
    if (!FORMATS[ext]) o.errors.push(`--convert=${o.convert}: end the pattern with .png, .jpg, .webp, .bmp, .tga, .ppm, .qoi or .wbmp`);
    else if (!path.basename(String(o.convert)).includes('*')) o.errors.push(`--convert=${o.convert}: put * where each input's name goes, e.g. out/*.${ext}`);
    else o.format = FORMATS[ext];
  }
  for (const k of ['resize', 'long', 'rotate', 'flip', 'gray', 'quality', 'strip', 'overwrite', 'shrink-only']) if (o[k] !== undefined && o.convert === undefined) o.errors.push(`--${k} works with --convert`);
  return o;
}

/** The options as text, grouped (the terminal help). */
function usageText(version) {
  const lines = [`Anne's Lens ${version || ''}`.trim(), '', 'Usage: annes-lens [options] [pictures or folders]', ''];
  for (const g of ['View', 'Convert', 'Other']) {
    lines.push(`${g}:`);
    for (const x of OPTIONS.filter((y) => y.group === g)) {
      const head = `  ${x.short ? `-${x.short}, ` : '    '}--${x.name}${x.value ? `=${x.value}` : ''}`;
      lines.push(head.length < 34 ? head.padEnd(34) + x.text : head + '\n' + ' '.repeat(34) + x.text);
    }
    lines.push('');
  }
  lines.push('Examples:', '  annes-lens --slideshow ~/Pictures/Trip', '  annes-lens --convert="web/*.jpg" --long=1600 --quality=85 --strip ~/Pictures/Trip', '  annes-lens --convert="*.png" --rotate=exif scan1.tif scan2.tif', '');
  lines.push('Exit status: 0 when every picture was written, 1 when some failed, 2 for a usage error.');
  return lines.join('\n') + '\n';
}

module.exports = { parseCli, usageText, OPTIONS, FORMATS };
