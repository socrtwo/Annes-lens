#!/usr/bin/env node
// Renders the icon sources written by gen-android-icons.mjs to the PNG sizes the other platforms need:
//   resources/icon-1024.png                       desktop installers (electron-builder derives .ico and .icns from it)
//   public/icons/icon-192.png, icon-512.png       web app manifest, purpose "any" (PWA, ChromeOS)
//   public/icons/icon-maskable-512.png            web app manifest, purpose "maskable" (adaptive foreground on
//                                                 the background color, so that every mask shape keeps the artwork)
//   public/icons/apple-touch-icon.png             iOS home-screen bookmark (180x180, opaque)
//   ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png   iOS (1024x1024, opaque)
// Sources: resources/icon.svg (rounded square), resources/icon-square.svg (opaque, full bleed, written by
// gen-android-icons.mjs) and resources/icon-background.txt (the color behind opaque icons).
// Usage: node scripts/gen-platform-icons.mjs   (uses Playwright's Chromium; CHROMIUM_PATH overrides it)
import { readFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rounded = readFileSync(join(root, 'resources/icon.svg'), 'utf8');
const square = readFileSync(join(root, 'resources/icon-square.svg'), 'utf8');
const BG = readFileSync(join(root, 'resources/icon-background.txt'), 'utf8').trim();
const foreground = readFileSync(join(root, 'resources/icon-foreground.svg'), 'utf8');
const exe = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium'].find((p) => p && existsSync(p) && statSync(p).isFile());
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage();
// [size, output, source, transparent background?]
const outputs = [
  [1024, 'resources/icon-1024.png', rounded, true],
  [512, 'public/icons/icon-512.png', rounded, true],
  [192, 'public/icons/icon-192.png', rounded, true],
  [512, 'public/icons/icon-maskable-512.png', foreground, false],
  [180, 'public/icons/apple-touch-icon.png', square, false],
  [1024, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', square, false],
];
for (const [size, rel, svg, transparent] of outputs) {
  const out = join(root, rel);
  if (rel.startsWith('ios/') && !existsSync(dirname(out))) continue;
  mkdirSync(dirname(out), { recursive: true });
  await page.setViewportSize({ width: size, height: size });
  const sized = svg.replace(/\swidth="[\d.]+"/, ` width="${size}"`).replace(/\sheight="[\d.]+"/, ` height="${size}"`);
  await page.setContent(`<!doctype html><html><head><style>svg{display:block}</style></head><body style="margin:0;background:${transparent ? 'transparent' : BG}">${sized}</body></html>`);
  await page.screenshot({ path: out, omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', rel);
}
await browser.close();
