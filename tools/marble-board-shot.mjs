// Each marble on the *real board*, framed the way the game frames it.
//
//   node tools/marble-board-shot.mjs [--url http://127.0.0.1:3010] [--out docs/marbles]
//
// The lab (tools/marbles.html) judges a marble under its own rig and at hero size. This judges the
// thing that actually matters: the marble against timber, at the size the player sees it, with the
// board's own HUD around it. It drives the game's debug API — `tuning.set('marbleLook', …)`, which
// is the same path the tuning sheet uses, so a swap that works in the game is what gets
// photographed — and it hides the lid, because at this camera height the pane and its collar sit
// between the camera and the marble.
//
// It also measures the one thing a still cannot show: whether the lantern's embedded lamp lights
// the board. The mean brightness of a band of wood across the frame is compared against the same
// band with a marble that carries no light, and the difference is reported. That is the honest
// answer to "does the light do anything", which looking at a warm-brown board cannot settle.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const base = arg('url', 'http://127.0.0.1:3010');
const outDir = arg('out', 'docs/marbles');
const only = arg('only', null);
fs.mkdirSync(outDir, { recursive: true });

import { SHIPPED_MARBLE_IDS } from '../src/render/marbles.js';
//  What ships is what gets documented: the shelved designs are still reachable by URL, and can be
//  shot with `--looks`, but they are not part of the reference set any more.
const IDS = arg('looks', null) ? arg('looks').split(',') : SHIPPED_MARBLE_IDS;
const wanted = only ? IDS.filter((id) => only.split(',').includes(id)) : IDS;
const LIGHT = 'lantern'; // the only marble with an embedded lamp, so the lamp check needs it

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));

const t0 = Date.now();
await page.goto(`${base}/?physics=default`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction('window.__maze && window.__maze.version === 1', null, { timeout: 240000 });
await page.waitForTimeout(1800);
console.log(`game ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// One pose for every shot: lid off, board held level, and the camera just above the marble looking
// down at it. `lookFrom` is in world units and the marble group is a child of the tilting board, so
// the ball's board-space position is the world position it needs (the board group sits at the origin).
async function frame() {
  return page.evaluate(() => {
    const dbg = window.__maze;
    const b = dbg.world.ball;
    dbg.scene.setLidVisible(false);
    dbg.holdTilt(0, 0);
    dbg.lookFrom([b.x + 0.85, 1.5, b.z + 1.15], [b.x, 0.3, b.z]);
    return { ball: [+b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2)], look: dbg.scene.marble.id };
  });
}

async function shoot(id, file) {
  const applied = await page.evaluate((p) => window.__maze.tuning.set('marbleLook', p), id);
  await page.waitForTimeout(700);
  const info = await frame();
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(outDir, file), timeout: 180000 });
  console.log(`${file.padEnd(26)} ${applied === id ? '' : `(applied ${applied}) `}${JSON.stringify(info.ball)}`);
  return path.join(outDir, file);
}

const files = {};
for (const id of wanted) files[id] = await shoot(id, `board-${id}.png`);
void shoot; // the lamp-off control below re-shoots the lantern through the same helper

// Does the lamp light the wood? Measure, do not eyeball a brown-on-brown picture.
//
// The control is the SAME marble with its own lamp switched off. Comparing it with another marble
// looked reasonable and was not: two designs differ in their core colour and their glass as well as
// their light, so the number measured the marbles, not the lamp. (Seen 2026-09-20: changing the
// glass moved the "lamp" reading from +33 to +65 without the light changing at all.)
if (files[LIGHT]) {
  // Park the ball, frame ONCE, and take BOTH lamp shots from that one camera. Re-framing between
  // them lets the marble drift, and the comparison then measures drift instead of light - which is
  // exactly how an earlier version of this check reported a confident +32.7 R that meant nothing.
  // The lit shot becomes the lantern's artifact, so the picture and the number share a frame.
  files.lampOff = path.join(outDir, '.lantern-lamp-off.png');
  await page.evaluate(() => {
    // Back to the lantern first: this runs after the shot loop, so the marble on the board is
    // whatever was shot last, and toggling "the lamp" on a marble that has no lamp is a silent
    // no-op that reads exactly like a lamp that does nothing. (It did, on 2026-09-20.)
    window.__maze.tuning.set('marbleLook', 'lantern');
    const b = window.__maze.world.ball;
    b.vx = 0;
    b.vz = 0;
    window.__maze.marbleLamp(false);
  });
  await frame();
  await page.waitForTimeout(900);
  await page.screenshot({ path: files.lampOff, timeout: 180000 });
  await page.evaluate(() => window.__maze.marbleLamp(true));
  await page.waitForTimeout(700);
  await page.screenshot({ path: files[LIGHT], timeout: 180000 });
}
if (files[LIGHT] && files.lampOff) { const CONTROL = 'lampOff';
  const band = async (file) =>
    page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const y0 = Math.floor(c.height * 0.5);
      const part = ctx.getImageData(0, y0, c.width, Math.floor(c.height * 0.28)).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < part.length; i += 4) { r += part[i]; g += part[i + 1]; b += part[i + 2]; n++; }
      return { r: r / n, g: g / n, b: b / n };
    }, `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`);

  // Read the lamp's state back before trusting the pixels: a toggle that silently did nothing is
  // indistinguishable from a lamp that lights nothing.
  const lampState = await page.evaluate(() => {
    let info = null;
    window.__maze.scene.scene.traverse((o) => {
      if (o.isLight && o.parent?.userData?.id) info = { intensity: +o.intensity.toFixed(2), lampOff: !!o.parent.userData.lampOff };
    });
    return info;
  });
  if (!lampState) {
    errors.push('the marble on the board carries no lamp, so the reading below means nothing');
  } else if (lampState.lampOff || lampState.intensity <= 0) {
    errors.push(`the lamp did not come back on (${JSON.stringify(lampState)})`);
  }
  const lit = await band(files[LIGHT]);
  const dark = await band(files[CONTROL] ?? files.lampOff);
  const warmth = (m) => m.r - m.b;
  console.log(
    `\nlamp on the board: ${LIGHT} R${lit.r.toFixed(0)} G${lit.g.toFixed(0)} B${lit.b.toFixed(0)} vs the same marble with the lamp off R${dark.r.toFixed(0)} G${dark.g.toFixed(0)} B${dark.b.toFixed(0)}` +
      ` | warm shift R+${(lit.r - dark.r).toFixed(1)} G+${(lit.g - dark.g).toFixed(1)} B+${(lit.b - dark.b).toFixed(1)}` +
      ` | warmth(R-B) ${warmth(lit).toFixed(1)} vs ${warmth(dark).toFixed(1)}`,
  );
  if (lit.r - dark.r < 5) {
    errors.push(`the lantern's lamp is not visibly warming the board (R +${(lit.r - dark.r).toFixed(1)})`);
  }
  fs.rmSync(files.lampOff, { force: true }); // a control, not an artifact
}

console.log(errors.length ? `\n${errors.length} problem(s):\n${errors.join('\n')}` : '\nno console errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
