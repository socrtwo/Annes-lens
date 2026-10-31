// Writes public/third-party-notices.txt: the license of every runtime npm package Anne's Lens
// ships (dependencies and their dependencies), so the notices the MIT, BSD, SIL OFL and Apache
// licenses ask for travel with the web build and the Android app. Runs before `npm run build`.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** Node's lookup: the nearest node_modules/<name> at or above `from`. */
function resolvePkg(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const p = join(dir, 'node_modules', name);
    if (existsSync(join(p, 'package.json'))) return p;
    if (dir === root || dirname(dir) === dir) return null;
  }
}

const seen = new Map(); // directory -> package.json
// Runtimes the app loads at run time (from the CDN, or copied into the desktop build by
// vite.config.ts) are shipped code too when copied, so their licenses are listed as well.
const RUNTIMES = ['onnxruntime-web', 'tesseract.js', 'tesseract.js-core', '@tesseract.js-data/eng'];
const queue = [...Object.keys(rootPkg.dependencies || {}), ...RUNTIMES].map((n) => [n, root]);
while (queue.length) {
  const [name, from] = queue.shift();
  const dir = resolvePkg(name, from);
  if (!dir || seen.has(dir)) continue;
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  seen.set(dir, pkg);
  for (const dep of Object.keys(pkg.dependencies || {})) queue.push([dep, dir]);
}

const repoUrl = (pkg) => {
  const r = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  if (!r) return pkg.homepage || '';
  return r.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^github:/, 'https://github.com/').replace(/^git:\/\//, 'https://');
};
const licenseText = (dir) => {
  const files = readdirSync(dir);
  const f = files.find((n) => /^(licen[cs]e|copying)(\.(md|markdown|txt))?$/i.test(n));
  if (f) return readFileSync(join(dir, f), 'utf8').trim();
  // Some packages carry the license only in their README's "License" section.
  const readme = files.find((n) => /^readme(\.(md|markdown|txt))?$/i.test(n));
  const m = readme && readFileSync(join(dir, readme), 'utf8').match(/^#+\s*licen[cs]e\s*\n([\s\S]*?)(?=^#+\s|(?![\s\S]))/im);
  return m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() : '';
};

const rule = '-'.repeat(78);
const parts = [
  'Anne\'s Lens third-party notices',
  '',
  'Anne\'s Lens is MIT-licensed. It includes the open-source components below; each one\'s',
  'copyright notice and license follow. The Android app also includes AndroidX libraries',
  '(appcompat, coordinatorlayout, core, core-splashscreen, activity) under the Apache',
  'License 2.0, whose text appears below with Material Symbols.',
  '',
  'Desktop builds also include Electron (MIT) and Chromium, whose licenses ship alongside the',
  'app as LICENSE.electron.txt and LICENSES.chromium.html.',
  '',
  'ONNX Runtime Web and Tesseract (with its English data) are loaded on demand: from the jsDelivr',
  'CDN in the web and Android builds, from a copy inside the desktop build. The on-device AI',
  'models (MODNet, Depth Anything V2 Small, LaMa and Swin2SR under Apache-2.0, CLIP under MIT) and',
  'the other OCR languages are downloaded from their published locations when first used and are',
  'not part of the app.',
  '',
];
const sorted = [...seen.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
for (const [dir, pkg] of sorted) {
  const lic = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type || (pkg.licenses || []).map((l) => l.type || l).join(' OR ') || 'see below';
  parts.push(rule, `${pkg.name} ${pkg.version} - ${lic}`, repoUrl(pkg), rule, '', licenseText(dir) || `License: ${lic} (no license file in the package).`, '');
}
mkdirSync(join(root, 'public'), { recursive: true });
writeFileSync(join(root, 'public', 'third-party-notices.txt'), parts.join('\n'));
console.log(`third-party-notices.txt: ${sorted.length} packages`);
