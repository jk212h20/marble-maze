// Screenshot the material picker: the candidate sheet, a close-up per candidate, and the grain
// strip per candidate. Headless Chromium via the machine's playwright (the same one sim/smoke.mjs
// uses), SwiftShader software GL, because this is a laptop and the point is the pixels.
//
//   node tools/materials-shot.mjs [--url http://127.0.0.1:3010/tools/materials.html] [--out docs/materials]
//
// It reports the boot time it measured in the page and every console error it saw, so a broken
// candidate cannot be mistaken for a rendered one.
import { chromium } from '/opt/homebrew/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const base = arg('url', 'http://127.0.0.1:3010/tools/materials.html');
const outDir = arg('out', 'docs/materials');
const grain = arg('grain', '1');
const ids = ['birch', 'cherry', 'walnut', 'marble'];
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1600 }, deviceScaleFactor: 2 });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const t0 = Date.now();
await page.goto(`${base}?size=1024&grain=${grain}&pick=cherry`, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
const bootMs = await page.evaluate(() => window.__bootMs ?? null);
console.log(`ready in ${Date.now() - t0} ms (page measured ${bootMs == null ? 'n/a' : Math.round(bootMs) + ' ms'})`);

const shot = async (selector, file) => {
  const el = await page.$(selector);
  if (!el) throw new Error(`no element ${selector}`);
  await el.screenshot({ path: path.join(outDir, file) });
  const box = await el.boundingBox();
  console.log(`wrote ${file} (${Math.round(box.width)}x${Math.round(box.height)})`);
};

await shot('#sheetBox', 'candidates.png');
await shot('main', 'picker-full.png');

for (const id of ids) {
  await page.evaluate((sel) => window.__select(sel), id);
  await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
  await page.waitForTimeout(120);
  await shot('#closeBox', `closeup-${id}.png`);
  await shot('#stripRow', `grain-${id}.png`);
}

console.log(errors.length ? `\n${errors.length} console error(s):\n${errors.join('\n')}` : '\nno console errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
