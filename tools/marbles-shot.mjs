// Screenshot the marble lab: the family sheet once, then the hero view per design, so a design
// that fails to build cannot be mistaken for one that simply looks quiet.
//
//   node tools/marbles-shot.mjs [--url http://127.0.0.1:3010/tools/marbles.html] [--out docs/marbles]
//
// Headless Chromium via the machine's playwright, SwiftShader software GL — the same approach as
// tools/materials-shot.mjs, because the point is the pixels and this is a laptop.
import { chromium } from '/opt/homebrew/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { SHIPPED_MARBLE_IDS } from '../src/render/marbles.js';

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const base = arg('url', 'http://127.0.0.1:3010/tools/marbles.html');
const outDir = arg('out', 'docs/marbles');
//  What ships is what gets documented, for the same reason the game only offers what ships: a folder
//  of reference pictures for marbles nobody can select is a misleading record. The shelved designs
//  still build (and the lab still shows them with ?all=1), they are simply not in the set.
const ids = SHIPPED_MARBLE_IDS;
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1500 }, deviceScaleFactor: 1 });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const t0 = Date.now();
await page.goto(`${base}?pick=${ids[1] ?? ids[0]}`, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
const bootMs = await page.evaluate(() => window.__bootMs ?? null);
console.log(`ready in ${Date.now() - t0} ms (page measured ${bootMs == null ? 'n/a' : Math.round(bootMs) + ' ms'})`);

await page.waitForTimeout(900);

const state = await page.evaluate(() => window.__state());
if (state.designs !== ids.length) errors.push(`page reports ${state.designs} designs, the shot list has ${ids.length}`);

// Prove the draw loop is alive BEFORE freezing - a frozen page is *supposed* to stop drawing, so
// testing this after the freeze can only ever fail. (That mistake cost two runs on 2026-09-20: the
// check reported "still 8 frames after 10s" on a page that was drawing perfectly well.)
//
// And wait for the growth rather than sampling a fixed window: a software-GL page can draw nothing
// for hundreds of milliseconds while another SwiftShader renderer competes for the machine, which
// a fixed window turns into a failure of a run whose pictures are all perfectly good.
const framesA = await page.evaluate(() => window.__state().frames);
const drew = await page
  .waitForFunction((n) => window.__state().frames > n, framesA, { timeout: 10000 })
  .then(() => true)
  .catch(() => false);
if (!drew) errors.push(`the draw loop is not running (still ${framesA} frames after 10s)`);

// Now freeze for the stills: an element screenshot waits for the target to stop changing, and a
// turntable never does.
await page.evaluate(() => window.__freeze(true));

await page.locator('#sheetBox').screenshot({ path: path.join(outDir, 'family.png') });
console.log(`wrote ${path.join(outDir, 'family.png')}`);

for (const id of ids) {
  await page.evaluate((p) => window.__pick(p), id);
  await page.waitForTimeout(250);
  await page.locator('#heroBox').screenshot({ path: path.join(outDir, `hero-${id}.png`) });
  console.log(`wrote ${path.join(outDir, `hero-${id}.png`)}`);
}

// A second lantern frame from a different angle: the design's whole point is that it moves light,
// so keep one turned-on frame in the set rather than judging the lamp from a single pose.
await page.evaluate(() => { window.__freeze(false); window.__pick('lantern'); });
await page.waitForTimeout(1000);
await page.evaluate(() => window.__freeze(true));
await page.locator('#heroBox').screenshot({ path: path.join(outDir, 'hero-lantern-turned.png') });
console.log(`wrote ${path.join(outDir, 'hero-lantern-turned.png')}`);

await browser.close();

//  Report pictures of marbles that no longer exist.
//
//  These files are written per design id, so renaming or shelving a design quietly orphans the old
//  picture - and a stale reference render is worse than a missing one, because the docs then show a
//  marble nobody can select (this happened: Solid was written as "sable" and its files outlived the
//  rename). The tool cannot know whether an orphan matters, so it says so and names the file.
const known = new Set(ids);
const orphans = fs
  .readdirSync(outDir)
  .filter((f) => /^(hero|board)-(.+)\.png$/.test(f))
  .filter((f) => !known.has(f.replace(/^(hero|board)-(.+)\.png$/, '$2')));
if (orphans.length) {
  console.log(`\n${orphans.length} stale picture(s) of marbles that are no longer shot: ${orphans.join(', ')}`);
  console.log('delete them, or shoot those ids with --only to refresh them');
}

if (errors.length) {
  console.error(`\n${errors.length} problem(s):`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log('\nno console errors');
