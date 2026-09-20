//  Frame-time tracking and phase profiling.
//
//  Smoothness is a promise in this game, and a promise needs a number. This is the number: the
//  frame interval - what the player actually feels - plus a breakdown of where the frame went, so a
//  regression has somewhere to point. It is deliberately small and self-contained, off by default,
//  and turned on with `?perf` (or `?fps`) or the F key while playing.
//
//  Three things it deliberately does NOT do:
//    * it does not infer GPU time. The frame *interval* is the end-to-end truth the eye sees; the
//      phase spans are CPU time around `scene.sync` / `scene.render` and are labelled as CPU.
//      `renderer.info` gives the draw calls and triangles, which is the other half of the story.
//    * it does not touch the DOM every frame. Text and the graph redraw a few times a second,
//      because an FPS meter that costs frames is measuring itself.
//    * it does not allocate per frame: the rings are fixed size and the numbers are formatted in
//      place, so leaving it switched on never turns into a GC stutter of its own.

const PHASES = ['physics', 'sim', 'sync', 'render', 'ui', 'tail'];
const WINDOW = 240; // frames kept for the percentiles and the graph
const REDRAW_MS = 250; // how often the panel text and graph refresh
const HITCH_MS = 20; // a frame slower than this is a hitch the player can feel
const WARMUP_SKIP_MS = 1000; // a first frame this slow is a compile/regain, not steady-state cost
const GRAPH_CAP_MS = 100; // the graph never scales past this, so a spike cannot flatten everything

const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '--');

export function createPerf({ enabled = false, parent = document.body } = {}) {
  const root = document.createElement('div');
  root.id = 'perf';
  root.className = 'perf';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <div class="perf-head"><b class="perf-fps">--</b><span class="perf-fpsunit">fps</span><span class="perf-ms">-- ms</span></div>
    <canvas class="perf-graph" width="240" height="40"></canvas>
    <div class="perf-phases"></div>
    <div class="perf-draws"></div>`;
  parent.appendChild(root);

  const fpsEl = root.querySelector('.perf-fps');
  const msEl = root.querySelector('.perf-ms');
  const phasesEl = root.querySelector('.perf-phases');
  const drawsEl = root.querySelector('.perf-draws');
  const canvas = root.querySelector('.perf-graph');
  const ctx = canvas.getContext('2d');

  const frames = []; // frame intervals, ms
  const phaseRings = new Map(PHASES.map((p) => [p, []]));
  const hitches = []; // timestamps of recent hitches, for a "recently" count

  let on = !!enabled;
  let started = 0;
  let markAt = 0;
  let lastRedraw = 0;
  let drawInfo = null; // last { calls, triangles, programs } the caller handed us

  root.style.display = on ? '' : 'none';

  const ringPush = (arr, value) => {
    arr.push(value);
    if (arr.length > WINDOW) arr.shift();
  };

  /** The percentile of a *copy* of the ring; never mutates the live order. */
  const percentile = (arr, q) => {
    if (!arr.length) return NaN;
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  };
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN);

  // ------------------------------------------------------------------- the instrument
  function frameStart() {
    started = performance.now();
    markAt = started;
  }

  /**
   * Close the span since the last mark and attribute it to `name`.
   *
   * `name` labels the span that just *ended*, not the one that follows, so the caller reads as
   * "the physics step is done", "the sync is done" in code order. Getting this the other way round
   * shifts every phase by one - a real bug that makes the report name the wrong culprit, which is
   * worse than no report.
   */
  function tick(name) {
    const now = performance.now();
    ringPush(phaseRings.get(name), now - markAt);
    markAt = now;
  }

  function frameEnd(info) {
    const now = performance.now();
    // Whatever is left after the last mark (the quality/bench bookkeeping) is the tail.
    ringPush(phaseRings.get('tail'), now - markAt);
    const total = now - started;
    //  A first frame that includes shader compiles, or a tab regaining focus, can be seconds long.
    //  That is not steady-state frame cost, and letting it into the ring makes one outlier own the
    //  mean, the max and the graph scale - the meter would report a stall that is not the game.
    if (total < WARMUP_SKIP_MS) {
      ringPush(frames, total);
      if (total > HITCH_MS) {
        hitches.push(now);
        if (hitches.length > 64) hitches.shift();
      }
    }
    if (info) drawInfo = info;
    if (on && now - lastRedraw >= REDRAW_MS) {
      lastRedraw = now;
      redraw();
    }
  }

  // ------------------------------------------------------------------- the panel
  function redraw() {
    const ms = mean(frames);
    const median = percentile(frames, 0.5);
    const p95 = percentile(frames, 0.95);
    const fps = median > 0 ? 1000 / median : NaN;
    fpsEl.textContent = fmt(fps, 0);
    msEl.textContent = `${fmt(median)} ms  p95 ${fmt(p95)}  max ${fmt(Math.max(...frames), 1)}`;

    const recent = hitches.filter((t) => performance.now() - t < 3000).length;
    phasesEl.innerHTML = '';

    const totalPhase = PHASES.reduce((sum, p) => sum + mean(phaseRings.get(p)), 0) || 1;
    for (const p of PHASES) {
      const v = mean(phaseRings.get(p));
      if (!Number.isFinite(v)) continue;
      const row = document.createElement('div');
      row.className = 'perf-row';
      const share = Math.round((v / totalPhase) * 100);
      row.innerHTML = `<span class="perf-name">${p}</span><span class="perf-val">${fmt(v, 2)}</span><span class="perf-bar"><i style="width:${Math.min(100, share)}%"></i></span>`;
      phasesEl.appendChild(row);
    }
    const hitchRow = document.createElement('div');
    hitchRow.className = 'perf-row perf-hitch';
    hitchRow.innerHTML = `<span class="perf-name">hitches</span><span class="perf-val">${recent}</span><span class="perf-note">last 3s &gt; ${HITCH_MS}ms</span>`;
    phasesEl.appendChild(hitchRow);

    if (drawInfo) {
      drawsEl.textContent =
        `draws ${drawInfo.calls}  tris ${Math.round((drawInfo.triangles || 0) / 1000)}k  progs ${drawInfo.programs}`;
    }
    drawGraph();
  }

  function drawGraph() {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!frames.length) return;
    // Scale to the worst frame in the window (but never below 2x the 60Hz budget, and never past
    // the cap), so a spike is visible without one outlier flattening the whole graph.
    const peak = Math.min(GRAPH_CAP_MS, Math.max(16.7 * 2, Math.max(...frames)));
    const yOf = (ms) => h - Math.min(h, (ms / peak) * h);
    // the 60Hz budget line, so the graph reads without a legend
    ctx.strokeStyle = 'rgba(120, 200, 140, 0.5)';
    ctx.beginPath();
    const y60 = yOf(16.7);
    ctx.moveTo(0, y60);
    ctx.lineTo(w, y60);
    ctx.stroke();
    // the frame-time line
    ctx.strokeStyle = 'rgba(240, 192, 121, 0.95)';
    ctx.beginPath();
    const n = frames.length;
    for (let i = 0; i < n; i++) {
      const x = n > 1 ? (i / (n - 1)) * w : 0;
      const y = yOf(frames[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function setEnabled(next) {
    on = !!next;
    root.style.display = on ? '' : 'none';
    if (on) {
      lastRedraw = 0;
      redraw();
    }
    return on;
  }

  return {
    frameStart,
    tick,
    frameEnd,
    setEnabled,
    toggle: () => setEnabled(!on),
    get enabled() {
      return on;
    },
    /**
     * A snapshot for tools and tests: the frame-time distribution, the per-phase CPU means and
     * p95s, and the renderer counters. Percentiles rather than a mean, because a mean hides the
     * stutter that is actually felt.
     */
    snapshot() {
      return {
        frames: frames.length,
        fps: mean(frames) > 0 ? 1000 / mean(frames) : NaN,
        ms: {
          mean: mean(frames),
          median: percentile(frames, 0.5),
          p95: percentile(frames, 0.95),
          p99: percentile(frames, 0.99),
          max: frames.length ? Math.max(...frames) : NaN,
        },
        phases: Object.fromEntries(
          PHASES.map((p) => [p, { mean: mean(phaseRings.get(p)), p95: percentile(phaseRings.get(p), 0.95) }]),
        ),
        hitches: hitches.filter((t) => performance.now() - t < 3000).length,
        draws: drawInfo,
      };
    },
    /** Drop the history, so a measurement starts from a clean window. */
    reset() {
      frames.length = 0;
      hitches.length = 0;
      for (const ring of phaseRings.values()) ring.length = 0;
    },
  };
}
