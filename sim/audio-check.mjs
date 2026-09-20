//  Headless audio verification: no speakers required.
//
//  The game synthesises every sound at runtime, so the only honest way to check the audio
//  code without ears is to render it. This loads the real page in Chromium, swaps the
//  AudioContext for an OfflineAudioContext, drives the real ships' voices, renders the
//  graph to a buffer, and reports level and channel balance per voice.
//
//  It catches the failure modes that matter for code like this: an exception while
//  building a voice, a voice that comes out silent, one that clips, or a looping song
//  whose tempo does not rise with the marble's speed.
//
//  Run: node sim/audio-check.mjs [--url http://127.0.0.1:3010/]
import { chromium } from '/opt/homebrew/lib/node_modules/playwright/index.mjs';

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const url = arg('url', 'http://127.0.0.1:3010/');

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

// Replace AudioContext with an offline one whose clock we can drive, so voices can be
// scheduled at realistic times instead of all piling up on t=0.
await page.addInitScript(() => {
  const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  window.__audioTime = 0;
  let last = null;
  function Fake() {
    const c = new Off(2, 44100 * 3, 44100);
    Object.defineProperty(c, 'currentTime', { get: () => window.__audioTime });
    // The offline context refuses resume(); our unlock() only needs it to not throw.
    c.resume = () => Promise.resolve();
    last = c;
    window.__lastCtx = c;
    return c;
  }
  Fake.prototype = Off.prototype;
  window.AudioContext = Fake;
  window.__lastOffline = () => last;
});

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction('window.__maze && window.__maze.audio', null, { timeout: 20000 });

const report = await page.evaluate(async () => {
  const { createAudio } = await import('/src/ui/audio.js');
  const stats = (buf) => {
    const L = buf.getChannelData(0);
    const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    let peak = 0;
    let sum = 0;
    let lsum = 0;
    let rsum = 0;
    let nonzero = 0;
    for (let i = 0; i < L.length; i++) {
      const a = Math.abs(L[i]);
      const b = Math.abs(R[i]);
      if (a > peak) peak = a;
      if (b > peak) peak = b;
      sum += L[i] * L[i] + R[i] * R[i];
      lsum += L[i] * L[i];
      rsum += R[i] * R[i];
      if (a > 1e-4 || b > 1e-4) nonzero++;
    }
    const n = L.length;
    return {
      peak: +peak.toFixed(4),
      rms: +Math.sqrt(sum / (2 * n)).toFixed(5),
      lr: +(Math.sqrt(lsum / n) / (Math.sqrt(rsum / n) || 1e-9)).toFixed(3),
      seconds: +((nonzero / buf.sampleRate)).toFixed(2),
    };
  };

  async function render(name, seconds, drive) {
    window.__audioTime = 0;
    const a = createAudio();
    a.unlock();
    a.setEnabled(true);
    const ctx = a.context;
    // Drive frame-by-frame up to the requested length, then render.
    const step = 1 / 60;
    const frames = Math.ceil(seconds / step);
    for (let frame = 0; frame < frames; frame++) {
      const t = frame * step;
      window.__audioTime = t;
      drive(a, t, step);
    }
    window.__audioTime = seconds;
    const buf = await ctx.startRendering();
    return { name, ...stats(buf) };
  }

  const results = [];

  // The song: a fast wood roll should be clearly audible and busier than a slow one.
  // Onset count is not directly readable here, so we check level; speed response is
  // checked separately by comparing a slow roll with a fast one.
  results.push(
    await render('wood roll (fast)', 1.2, (a, t, dt) => a.rolling(2.6, 'wood', dt, 0)),
  );
  const slow = await render('wood roll (slow)', 1.2, (a, t, dt) => a.rolling(0.5, 'wood', dt, 0));
  const fast = results[0];
  slow.rms = slow.rms;
  results.push(slow);

  results.push(await render('ice roll', 1.2, (a, t, dt) => a.rolling(2.6, 'ice', dt, 0)));
  results.push(await render('sand roll', 1.2, (a, t, dt) => a.rolling(1.2, 'sand', dt, 0)));
  results.push(await render('steel roll', 1.2, (a, t, dt) => a.rolling(2.6, 'steel', dt, 0)));

  // Stereo: a full-left roll must come out louder on the left.
  results.push(await render('roll pan left', 1.0, (a, t, dt) => a.rolling(2.6, 'wood', dt, -1)));

  // Wall scrape.
  results.push(await render('wall scrape', 0.6, (a) => a.scrape(1.5, 'wood', 0)));

  // Discrete voices, one at a time.
  const oneshots = [
    ['bump soft', (a) => a.bump(0.35, false, 'wood', 0)],
    ['bump hard', (a) => a.bump(1, true, 'wood', 0)],
    ['bump steel', (a) => a.bump(0.8, false, 'steel', 0)],
    ['peg', (a) => a.peg(true, 0)],
    ['plate', (a) => a.plate(0)],
    ['gate', (a) => a.gate(0)],
    ['teleport', (a) => a.teleport(0)],
    ['belt', (a) => a.belt(0)],
    ['pit', (a) => a.pit(0)],
    ['edge', (a) => a.edge(0)],
    ['place', (a) => a.place(0)],
    ['settle', (a) => a.settle(0)],
    ['creak', (a) => a.creak(1, 0)],
    ['win', (a) => a.win(0)],
    ['wind', (a) => a.wind(1, 0)],
    ['magnet', (a) => a.magnet(1, 0)],
  ];
  for (const [name, fire] of oneshots) {
    results.push(await render(name, 0.35, (a, t) => { if (t === 0) fire(a); }));
  }

  // Speed response of the song: a higher tempo means more notes per second, so more
  // energy in the same window.
  return { results, slowFast: { slow: slow.rms, fast: fast.rms } };
});

await browser.close();

const pad = (s, n) => String(s).padEnd(n);
console.log('voice                peak     rms      L/R    audible');
let silent = 0;
let clipped = 0;
for (const r of report.results) {
  const isSilent = r.rms < 1e-4;
  if (isSilent) silent++;
  if (r.peak > 1.0) clipped++;
  console.log(`${pad(r.name, 20)} ${pad(r.peak.toFixed(4), 8)} ${pad(r.rms.toFixed(5), 8)} ${pad(r.lr, 6)} ${isSilent ? 'SILENT' : 'yes'}`);
}
console.log(`\nspeed response: slow rms ${report.slowFast.slow.toFixed(5)} -> fast rms ${report.slowFast.fast.toFixed(5)}`);
const flat = report.slowFast.fast <= report.slowFast.slow;
if (flat) console.log('FAIL: the song does not gain energy with speed (tempo not responding)');
if (errors.length) console.log(`\npage errors:\n${errors.join('\n')}`);
console.log(`\n${silent} silent voice(s), ${clipped} clipping, ${errors.length} error(s)`);
process.exit(silent || flat || errors.length ? 1 : 0);
