// Where does a frame go, and is the game smooth?
//
//   node tools/perf-profile.mjs [--seconds 6] [--look lantern] [--tier high] [--scenario demo] [--json]
//
// This is the real device, like tools/marble-cost.mjs and for the same reason: SwiftShader is the
// right instrument for "is the picture correct" and the wrong one for "does it feel smooth". The
// tool refuses to report timings from a software rasteriser.
//
// It reads the *game's own* frame-time instrument (`window.__maze.perf`), which is the ring the
// on-screen FPS overlay draws, so the number in the report and the number on screen are the same
// number - not two instruments that can disagree. That ring carries the frame interval (what the
// player feels) and a CPU breakdown per phase (physics / sim / sync / render / ui / tail), plus the
// renderer's draw-call and triangle counts from `scene.stats`.
//
// The adaptive quality loop is pinned by default (`--tier high`), because it is *designed* to move
// the tier under load: measuring the shipped configuration while it quietly downgrades would report
// the tier's cost as if it were the feature's. Pass `--tier auto` to watch the loop's own choice.
import { chromium } from '/opt/homebrew/lib/node_modules/playwright/index.mjs';

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const URL = arg('url', process.env.MM_URL || 'http://127.0.0.1:3010/');
const seconds = Number(arg('seconds', 6));
const look = arg('look', null);
const tier = arg('tier', 'high'); // high | medium | low | auto
const scenario = arg('scenario', 'demo'); // demo (marble rolling) | still
const level = arg('level', null);
const json = args.includes('--json');

//  `--disable-frame-rate-limit` is load-bearing: with vsync on a fast GPU renders every frame inside
//  the 8.3ms cap and a real regression is invisible behind the ceiling. Unthrottled, the frame time
//  is the work the frame takes, which is the number that decides whether it feels smooth.
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
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));

const query = new URLSearchParams();
if (level) query.set('level', level);
if (look) query.set('marble', look);
if (tier !== 'auto') query.set('quality', tier);
await page.goto(`${URL}${query.size ? `?${query}` : ''}`, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction('window.__maze && window.__maze.version === 1', null, { timeout: 60000 });

const device = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
const software = /swiftshader|llvmpipe|software/i.test(device);
if (software) {
  console.error(`renderer: ${device}\nREFUSING to report timings from a software rasteriser.`);
  await browser.close();
  process.exit(2);
}

//  Bring the scene to a steady state before measuring: the first seconds include image decode, env
//  build and shader compiles, which are real but not steady-state frame cost.
await page.evaluate(
  ([look, scenario, tier]) => {
    if (tier !== 'auto') window.__maze.lockQuality(tier);
    if (look) window.__maze.tuning.set('marbleLook', look);
    window.__maze.holdTilt(scenario === 'demo' ? 0.35 : 0, scenario === 'demo' ? -0.2 : 0);
    if (scenario === 'demo') window.__maze.startDemo();
    window.__maze.perf.reset();
  },
  [look, scenario, tier],
);
await page.waitForTimeout(1500);
await page.evaluate(() => window.__maze.perf.reset());

await page.waitForTimeout(seconds * 1000);

const report = await page.evaluate(() => {
  const snap = window.__maze.perf.snapshot();
  return {
    snap,
    tier: window.__maze.scene.quality,
    transmission: window.__maze.transmission,
    state: window.__maze.state,
  };
});

const ms = (n) => (Number.isFinite(n) ? n.toFixed(2) : '--');
const s = report.snap;
if (json) {
  console.log(JSON.stringify({ renderer: device, look, tier, scenario, ...report }, null, 2));
} else {
  console.log(`renderer : ${device}`);
  console.log(`scenario : ${scenario}${look ? ` · ${look}` : ''} · tier ${report.tier}${tier === 'auto' ? ' (auto)' : ' (pinned)'}`);
  console.log(`fps      : ${ms(s.fps)}   frames ${s.frames}`);
  console.log(
    `frame ms : mean ${ms(s.ms.mean)}  median ${ms(s.ms.median)}  p95 ${ms(s.ms.p95)}  p99 ${ms(s.ms.p99)}  max ${ms(s.ms.max)}  hitches ${s.hitches}`,
  );
  console.log('phases   : (CPU ms, mean / p95)');
  for (const [name, v] of Object.entries(s.phases)) {
    if (!Number.isFinite(v.mean)) continue;
    console.log(`  ${name.padEnd(8)} ${ms(v.mean).padStart(6)} / ${ms(v.p95).padStart(6)}`);
  }
  const d = s.draws;
  if (d) console.log(`draws    : calls ${d.calls}  tris ${Math.round((d.triangles || 0) / 1000)}k  progs ${d.programs}  textures ${d.textures}`);
  const tx = report.transmission;
  if (tx) console.log(`glass    : transmission ${tx.hasGlassMarble ? 'on' : 'off'}  buffer ${tx.width}x${tx.height} (scale ${tx.scale})  marble ${tx.marblePx}px`);
}
if (errors.length) console.log(`\nconsole errors:\n${errors.join('\n')}`);

await browser.close();
process.exit(errors.length ? 1 : 0);
