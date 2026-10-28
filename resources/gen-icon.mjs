// Anne's Lens icon, in the Anne's Office family (same tile, same white quill, app-specific white card).
// Matches suite/icons/gen.mjs in Anne's Grid; adds the 'lens' card: a picture with mountains and a sun.
// Writes icon.svg (full tile), icon-foreground.svg (Android adaptive foreground) and icon-background.txt.
import { writeFileSync } from 'node:fs';
const OUT = new URL('.', import.meta.url).pathname;
const a = { color: '#6A3FA8', dark: '#4A2877', light: '#8458C6' };
const c = a.color;
const card = `<rect x="84" y="150" width="288" height="216" rx="24" fill="#fff"/>
  <rect x="108" y="174" width="240" height="168" rx="12" fill="${c}" opacity=".14"/>
  <circle cx="150" cy="212" r="20" fill="${c}" opacity=".85"/>
  <path d="M108 342 L196 246 L240 292 L270 262 L348 342 L348 342 L108 342 Z" fill="${c}"/>`;
const quill = `<g>
    <path d="M436 70 C 376 84 316 140 290 214 C 274 260 268 300 270 338 C 300 300 330 280 360 262 C 330 262 312 262 300 258 C 336 240 368 218 392 188 C 368 190 350 190 336 186 C 378 160 410 120 436 70 Z" fill="#fff" stroke="${a.dark}" stroke-width="8" stroke-linejoin="round"/>
    <path d="M430 78 C 360 150 300 250 262 380" fill="none" stroke="${a.dark}" stroke-width="9" stroke-linecap="round"/>
    <path d="M262 380 L252 420 L276 392 Z" fill="${a.dark}"/>
  </g>`;
const tile = `<defs><linearGradient id="glens" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a.light}"/><stop offset="1" stop-color="${a.dark}"/></linearGradient></defs>
  <rect width="512" height="512" rx="116" fill="url(#glens)"/>`;
const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${inner}</svg>\n`;
writeFileSync(OUT + 'icon.svg', svg(tile + card + quill));
writeFileSync(OUT + 'icon-foreground.svg', svg(`<g transform="translate(256 256) scale(.6) translate(-256 -256)">${card}${quill}</g>`));
writeFileSync(OUT + 'icon-background.txt', a.color + '\n');
console.log('ok');
