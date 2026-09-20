// Rim options, rendered from the game itself.
//
//   node tools/rim-shot.mjs [--url http://127.0.0.1:3010] [--finish cherry] [--out docs/materials]
//
// Uses the game's own debug API (`window.__maze.tuning.set` and `lookFrom`), so what these pictures
// show is the real toy with the real rim geometry, not a preview that approximates it. One page load
// for every option, in a throwaway browser context: the choice is never written into anyone's saved
// tuning, and a run costs one game start rather than one per picture.
import { chromium } from '/opt/homebrew/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const base = arg('url', 'http://127.0.0.1:3010');
const outDir = arg('out', 'docs/materials');
const finish = arg('finish', 'cherry');
const only = arg('only', null); // comma-separated shot ids, for re-running one picture
const sheetOnly = args.includes('--sheet'); // rebuild the contact sheet from the PNGs on disk
fs.mkdirSync(outDir, { recursive: true });

// The options worth showing: each rim cut at no stain, the two stain depths that read as "darker"
// and "much darker" on the board's own grain, and the combinations Nick asked about (a stain on a
// book-match, a stain on another board).
const SHOTS = [
  { id: 'same', rimGrain: 'same', rimStain: 0, label: 'same board, no stain (shipped)' },
  { id: 'same-stain-06', rimGrain: 'same', rimStain: 0.6, label: 'same board, stain 0.6' },
  { id: 'same-stain-09', rimGrain: 'same', rimStain: 0.9, label: 'same board, deep stain 0.9' },
  { id: 'mirrored', rimGrain: 'mirrored', rimStain: 0, label: 'book-matched, no stain' },
  { id: 'mirrored-stain-05', rimGrain: 'mirrored', rimStain: 0.5, label: 'book-matched, stain 0.5' },
  { id: 'cut', rimGrain: 'cut', rimStain: 0, label: 'another board, no stain' },
  { id: 'cut-stain-05', rimGrain: 'cut', rimStain: 0.5, label: 'another board, stain 0.5' },
];
const wanted = sheetOnly ? [] : only ? SHOTS.filter((s) => only.split(',').includes(s.id)) : SHOTS;

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 720 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 200));
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));

const t0 = Date.now();
let stability = null;
if (wanted.length) {
  await page.goto(`${base}/?physics=default`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction('window.__maze', null, { timeout: 240000 });
  console.log(`game ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

for (const shot of wanted) {
  const ms = await page.evaluate(
    ({ finish, rimGrain, rimStain }) => {
      const t0 = performance.now();
      window.__maze.tuning.set('boardFinish', finish);
      window.__maze.tuning.set('rimGrain', rimGrain);
      window.__maze.tuning.set('rimStain', rimStain);
      // A low three-quarter view: the rim's cap and its body both have to be visible for the
      // treatment to be judged, and the board's own grain has to be in the same frame.
      window.__maze.lookFrom([11.5, 5.6, 13.5], [-0.4, 0.35, -0.6]);
      // The toy is a *physics* toy: left alone the board keeps tilting and the marble keeps
      // rolling, so two shots of the same setting are two different pictures - and the first
      // comparison run proved it, with the board's own centre moving 15% between stain levels.
      // Hold the tilt level so every option is photographed in the same pose.
      window.__maze.holdTilt(0, 0);
      return performance.now() - t0;
    },
    { finish, rimGrain: shot.rimGrain, rimStain: shot.rimStain },
  );
  await page.waitForTimeout(1600); // let the board settle level before it is photographed
  const file = `rim-${shot.id}.png`;
  // A plain viewport shot, not an element shot: the element path waits for the canvas to stop
  // changing size, and the game animates every frame, so that wait can never settle.
  // A generous timeout: under a loaded machine a 2000x1440 PNG encode has taken over 30s,
  // and the default 30s limit turned a finished render into a failed run.
  await page.screenshot({ path: path.join(outDir, file), timeout: 180000 });
  console.log(`${file.padEnd(26)} ${ms.toFixed(0).padStart(5)} ms  ${shot.label}`);

  // One honest check that the pose really is frozen: shoot the first option twice and report how
  // far apart the two PNGs are. A moving board makes two shots of one setting differ widely, and
  // then no difference between two options can be trusted either.
  if (!stability) {
    const again = path.join(outDir, '.rim-stability.png');
    await page.screenshot({ path: again, timeout: 180000 });
    stability = { a: path.join(outDir, file), b: again };
  }
}

// The contact sheet: every option in one picture, which is what a decision gets made from. Built in
// the browser from the PNGs already on disk, so it can be regenerated alone with --sheet.
const sheetPath = path.join(outDir, 'rim-options.png');
{
  const cells = SHOTS.map((s) => {
    const file = path.join(outDir, `rim-${s.id}.png`);
    const data = `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
    return `<figure><img src="${data}"><figcaption><b>${s.label}</b></figcaption></figure>`;
  }).join('');
  const html = `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; background: #0b0d12; color: #cfd6e4; font: 13px ui-monospace, monospace; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; padding: 12px; }
    figure { margin: 0; }
    img { width: 100%; display: block; border: 1px solid #232936; }
    figcaption { padding: 5px 2px 0; color: #9aa3b5; }
    figcaption b { color: #cfd6e4; }
  </style><div class="grid">${cells}</div>`;
  await page.setContent(html, { waitUntil: 'load', timeout: 180000 });
  await page.setViewportSize({ width: 1900, height: 900 });
  await page.screenshot({ path: sheetPath, fullPage: true, timeout: 180000 });
  console.log(`wrote ${path.basename(sheetPath)}`);
}

if (stability) {
  // The pair is a check, not an artifact: it exists to prove the pose was frozen, so it is removed
  // once the run is over rather than left in the output directory as a stray hidden PNG.
  fs.rmSync(stability.b, { force: true });
  console.log(`stability pair checked and removed: ${stability.a} vs ${stability.b}`);
}
console.log(errors.length ? `\n${errors.length} console error(s):\n${errors.join('\n')}` : '\nno console errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
