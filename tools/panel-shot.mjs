// Refresh docs/tuning-panel.png: the tuning sheet open, scrolled so the Marble group is in view.
//
//   node tools/panel-shot.mjs [--url http://127.0.0.1:3010] [--out docs/tuning-panel.png]
//
// Headless Chromium via the project's playwright with SwiftShader software GL, like the other shot
// tools: the point here is the picture, and the panel is text and controls rather than anything the
// GPU is good at.
//
// This is the one shot that documents the *controls* rather than the board, so it is the one that
// goes stale when a dial is added - which is exactly when it is worth regenerating.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const base = arg('url', 'http://127.0.0.1:3010');
const out = path.resolve(arg('out', 'docs/tuning-panel.png'));
fs.mkdirSync(path.dirname(out), { recursive: true });

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`); });

await page.goto(`${base}/?physics=default`, { waitUntil: 'load', timeout: 180000 });
// A failed load has to say so: this script used to hang for its whole timeout and report nothing,
// which is indistinguishable from a slow machine.
await page
  .waitForFunction(() => window.__maze && window.__maze.version === 1, null, { timeout: 120000 })
  .catch(async () => {
    const seen = await page.evaluate(() => document.title).catch(() => 'unknown');
    throw new Error(`the game never booted at ${base} (page title: "${seen}") - is that really marblemaze?`);
  });
await page.waitForTimeout(1500);
await page.click('#btn-tune');
await page.waitForTimeout(400);
await page.evaluate(() => {
  document.querySelectorAll('#tune-panel details').forEach((d) => { d.open = true; });
  //  Anchor on the *last* row of the Marble group, not the first.
  //
  //  Parking `marbleLook` low in the panel puts every dial that comes after it below the fold, so the
  //  shot documents the Marble group's heading and none of its controls - which is precisely the
  //  thing this picture exists to show after a dial is added. The last row is found by its own path
  //  so adding a dial to the group keeps the shot correct.
  const rows = [...document.querySelectorAll('.tune-row')];
  const marbleRows = rows.filter((r) => (r.dataset.path ?? '').startsWith('marble'));
  (marbleRows[marbleRows.length - 1] ?? marbleRows[0])?.scrollIntoView({ block: 'end' });
});
await page.waitForTimeout(700);
await page.screenshot({ path: out, timeout: 180000 });
console.log(`wrote ${path.relative(process.cwd(), out)}`);
await browser.close();

if (errors.length) {
  console.error(`\n${errors.length} problem(s):`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log('no console errors');
