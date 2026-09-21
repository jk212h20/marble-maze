// What does the glass marble actually cost to play with?
//
// Every other tool in this folder renders through headless SwiftShader - a CPU rasteriser, which
// is the right instrument for "is the picture correct" and the wrong one for "does it feel smooth".
// A fill-rate pass like transmission looks catastrophic there and fine on a GPU, or the reverse.
// So this tool insists on the *real* device: it launches Chromium with the GPU enabled, reads the
// WebGL renderer string back, and refuses to report timings that came from a software rasteriser.
//
// The marble's cost is a smoothness promise, so the guarantee is asserted rather than admired. The
// cheap, deterministic half of it is the transmission buffer: it must be sized to the ball's
// footprint, not to the viewport. That is a number, not a timing, so it cannot flake. The frame
// deltas are printed alongside for the record and are checked only loosely, because a timing
// threshold tight enough to be meaningful is also tight enough to fail on a busy machine.
//
//   node tools/marble-cost.mjs
import { chromium } from 'playwright';

const URL = process.env.MM_URL || 'http://127.0.0.1:3010/';
const SAMPLE_MS = 2500;
/** The buffer must be a small fraction of the viewport: the marble is the only thing that samples it. */
const MAX_SCALE = 0.25;
/** A tier cap, to catch a footprint calculation that has run away (marble pressed to the lens). */
const MAX_SCALE_ABSOLUTE = 0.6;

//  `--disable-frame-rate-limit` is load-bearing, not a nicety: with vsync on, a fast GPU renders
//  both looks in 8.3ms (the 120Hz cap) and the glass's cost is invisible - the measurement reads
//  "0.0ms" because the ceiling hid it, not because there is no cost. Unthrottled, the frame time
//  is the work the frame actually takes, which is the number that decides whether it feels smooth.
const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-gpu',
    '--use-angle=metal',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--disable-frame-rate-limit',
    '--disable-gpu-vsync',
  ],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 875 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__maze?.scene, null, { timeout: 20000 });
await page.waitForTimeout(2500);

const device = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
const software = /swiftshader|llvmpipe|software/i.test(device);
console.log('renderer: ' + device.slice(0, 90) + (software ? '  [SOFTWARE - timings not meaningful]' : ''));

/** Frame intervals for `ms`, reported as a distribution: a mean hides exactly the stutter that is felt. */
const sampleFrames = (ms) =>
  page.evaluate(async (ms) => {
    const deltas = [];
    await new Promise((resolve) => {
      const t0 = performance.now();
      let last = t0;
      const step = () => {
        const now = performance.now();
        deltas.push(now - last);
        last = now;
        if (now - t0 >= ms) return resolve();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    deltas.shift();
    deltas.sort((a, b) => a - b);
    const at = (q) => deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * q))];
    return { frames: deltas.length, median: at(0.5), p95: at(0.95) };
  }, ms);

/**
 * Measure one marble at one tier.
 *
 * The picture is held still: the ball starts at rest and only moves when the board tilts, so with
 * no input the camera and the geometry are identical between the two looks and the marble's
 * material is the only difference. The tier is forced at the start of the window and re-forced
 * just before sampling, because the game's own adaptive loop fires on a 2.5s clock and would
 * otherwise move the tier underneath us and read as the marble's cost.
 */
async function measure(look, tier) {
  await page.evaluate(([look, tier]) => {
    window.__maze.tuning.set('marbleLook', look);
    window.__maze.lockQuality(tier);
  }, [look, tier]);
  await page.waitForTimeout(700);
  const frames = await sampleFrames(SAMPLE_MS);
  const state = await page.evaluate(() => ({
    tier: window.__maze.scene.quality,
    glass: window.__maze.marbleGlass,
    transmission: window.__maze.transmission,
  }));
  return { look, tier: state.tier, glass: state.glass, transmission: state.transmission, ...frames };
}

/** Which looks to cost out: the painted baseline, then whatever is on trial. */
const LOOKS = (process.env.MM_LOOKS || 'catseye,lantern').split(',').map((s) => s.trim());
const rows = [];
for (const tier of ['high', 'low']) {
  for (const look of LOOKS) rows.push(await measure(look, tier));
}

/**
 * What a player actually gets: no lock, so the game's own adaptive loop is free to choose the tier
 * for each marble. This is the section that answers "does it feel smooth", and it is also where a
 * marble would show up as a *quality* cost - a glass marble that pushed the loop down a tier would
 * make the whole board cheaper and blurrier, which is felt even when the frame rate is fine.
 */
async function asPlayed(look, ms = 4000) {
  await page.evaluate((look) => {
    window.__maze.lockQuality(null);
    window.__maze.tuning.set('marbleLook', look);
  }, look);
  await page.waitForTimeout(ms); // the adaptive loop needs 2.5s of samples before it will move
  const frames = await sampleFrames(SAMPLE_MS);
  return { look, tier: await page.evaluate(() => window.__maze.scene.quality), ...frames };
}

const played = [];
for (const look of LOOKS) played.push(await asPlayed(look));
console.log('\nas played (adaptive tier, no lock)');
for (const r of played) {
  console.log(`${r.look.padEnd(9)} tier=${String(r.tier).padEnd(7)} median ${r.median.toFixed(1)}ms  p95 ${r.p95.toFixed(1)}ms`);
}
await browser.close();

console.log('\nlook      tier  trans  buffer px      viewport px    frames  median  p95');
for (const r of rows) {
  const t = r.transmission;
  console.log(
    r.look.padEnd(9) +
    String(r.tier).padEnd(6) +
    String(r.glass?.transmission ?? '-').padEnd(7) +
    `${t.width}x${t.height}`.padEnd(16) +
    `${t.viewportWidth}x${Math.round(t.viewportWidth * 875 / 1400)}`.padEnd(15) +
    String(r.frames).padEnd(8) +
    (r.median.toFixed(1) + 'ms').padEnd(8) +
    r.p95.toFixed(1) + 'ms',
  );
}

const problems = [];
for (const r of rows) {
  const t = r.transmission;
  //  Whether a look is glass comes from the look itself, never from a hard-coded name: an opaque
  //  dark marble and a clear one have to be told apart by what they report, or the check silently
  //  starts policing the wrong marble as soon as the roster changes.
  const transmissive = (r.glass?.transmission ?? 0) > 0;
  if (t.hasGlassMarble !== transmissive) {
    problems.push(
      t.hasGlassMarble
        ? `${r.look} reports a transmissive material at transmission 0; the pass would run for nothing`
        : `${r.look} transmits ${r.glass?.transmission} but is not registered; nothing is refracting`,
    );
  }
  if (!transmissive) continue;
  if (t.scale > MAX_SCALE) {
    problems.push(
      `the transmission buffer is ${t.scale} of the viewport (${t.width}px wide); a marble covers a few ` +
      `percent of the frame, so the pass is rendering ~${Math.round(t.width / (t.viewportWidth * 0.08))}x the pixels it can show`,
    );
  }
  if (t.scale > MAX_SCALE_ABSOLUTE) problems.push(`the transmission buffer exceeded every tier cap (${t.scale})`);
}

const glassPlayed = played[played.length - 1];
const plainPlayed = played[0];
const TIER_ORDER = { low: 0, medium: 1, high: 2 };
if (TIER_ORDER[glassPlayed.tier] < TIER_ORDER[plainPlayed.tier]) {
  problems.push(
    `the glass marble made the game lower its own quality tier (${plainPlayed.tier} -> ${glassPlayed.tier}); ` +
    `that downgrades the whole board's detail, which is felt even when the frame rate is fine`,
  );
}

/** Cost of each look over the painted baseline, at one tier. */
const lookCost = (tier, look) => {
  const a = rows.find((r) => r.tier === tier && r.look === 'catseye');
  const b = rows.find((r) => r.tier === tier && r.look === look);
  return b.median - a.median;
};
//  A contended machine makes every number above meaningless, and the tempting failure is to quote
//  them anyway. The baseline decides: the painted marble runs a fraction of a millisecond when the
//  machine is quiet, so a slow baseline means the machine is busy, not that the game is slow.
const quiet = rows.find((r) => r.tier === 'high' && r.look === 'catseye');
const contended = quiet && quiet.median > 6;
if (contended) {
  console.log(
    `\nWARNING: the painted baseline measured ${quiet.median.toFixed(1)}ms/frame at the high tier, ` +
    `which is many times its quiet value - the machine is busy, so treat every number below as an upper bound.`,
  );
}

console.log('\ncost over the painted baseline, unthrottled (no vsync):');
for (const look of LOOKS) {
  if (look === 'catseye') continue;
  console.log(`  ${look}: ${lookCost('high', look).toFixed(1)}ms/frame at high tier, ${lookCost('low', look).toFixed(1)}ms at low`);
  if (!software && !contended && lookCost('high', look) > 6) {
    problems.push(`${look} costs ${lookCost('high', look).toFixed(1)}ms/frame at the high tier - enough to be felt, and it is not the buffer`);
  }
}

console.log('');
if (problems.length) {
  console.log(`${problems.length} problem(s):`);
  for (const p of problems) console.log('- ' + p);
  process.exit(1);
}
console.log('no problems');
