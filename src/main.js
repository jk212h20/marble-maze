//  Marble Maze — game shell.
//
//  Responsibilities: input (keyboard, pointer drag, device tilt), the fixed-step loop,
//  run state (playing / lost attempt / won), best times, sound triggers, and the demo
//  autopilot. The physics and the level data know nothing about any of this.

import { LEVELS, buildLevel, PIT, VENT } from './engine/levels.js';
import { makeWorld, step, resetBall, speed, cellAt, homeCount } from './engine/physics.js';
import { createScene } from './render/scene.js';
import { loadImage } from './render/wood-image.js';
import { createAudio } from './ui/audio.js';
import { createHud } from './ui/hud.js';
import { MAX_TILT, DT, MARBLE_LOOKS } from './engine/constants.js';
import { makePilot, pilotControl, plan } from './engine/autopilot.js';
import { LEVEL_SLATE, SLATE_NOTE } from './engine/slate.js';
import { readDraft } from './engine/drafts.js';
import { profileNames, readProfile, writeProfile, deleteProfile } from './engine/profiles.js';
import {
  TUNING,
  TUNING_SPEC,
  PRESETS,
  RANGE_MODES,
  RANGE_MODE_KEYS,
  rangeFor,
  getTuning,
  setTuning,
  applyTuning,
  resetTuning,
  isCustomised,
  diffFromDefaults,
  tuningToJSON,
  loadTuningJSON,
  applyPreset,
  flattenTuning,
} from './engine/tuning.js';
import { createTuningPanel } from './ui/tuning-panel.js';
import { createPerf } from './ui/perf.js';

//  A draft opened from the level editor is played by *this* game, not by a copy of it:
//  `?draft=session` (the editor's autosaved working draft) or `?draft=<name>` (a named draft).
//  There used to be a second play page inside the editor; it drifted from the game (it never
//  applied the lighting rig, so every material rendered brighter and glossier, and it had no
//  sound) and has been removed. `?draft=` is the only way to play an unshipped level.
function loadDraftLevel(key) {
  const spec = readDraft(key);
  if (!spec) throw new Error(`no saved draft named “${key === 'session' ? 'last session (auto)' : key}” in this browser`);
  // The id is namespaced so a draft cannot share a best-time row with a shipped level, and
  // `isDraft` lets the HUD say plainly that this level is not part of the shipped slate yet.
  return { ...buildLevel(structuredClone(spec)), id: `draft:${key}`, isDraft: true };
}

const params = new URLSearchParams(location.search);
let draftLevel = null;
let draftError = null;
if (params.get('draft')) {
  try {
    draftLevel = loadDraftLevel(params.get('draft'));
  } catch (err) {
    draftError = err;
  }
}

const LEVEL_SOURCES = draftLevel ? [draftLevel, ...LEVELS.map(buildLevel)] : LEVELS.map(buildLevel);
const BEST_KEY = 'marblemaze.best.v1';
const PREFS_KEY = 'marblemaze.prefs.v1';
const TUNING_KEY = 'marblemaze.tuning.v1';

const clampNum = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const qs = {
  level: params.get('level'),
  draft: params.get('draft'),
  demo: params.get('demo') === '1',
  bench: params.get('bench') ? Number(params.get('bench')) : 0,
  quality: params.get('quality'),
  physics: params.get('physics'),
  //  ?marble=bitcoin (or any seen in the tuning sheet) makes a marble look shareable by link,
  //  which is also how the shot tools frame one on the real board.
  marble: params.get('marble'),
  autoplayFirst: params.get('auto') === '1',
  snap: params.get('snap') === '1',
  //  `?perf` (or `?fps`) opens the frame-time overlay on load, so a profiling run needs no key
  //  press; F toggles it while playing either way.
  perf: params.has('perf') || params.get('fps') === '1',
};

function loadBests() {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function saveBests(b) {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(b));
  } catch {
    /* private mode: best times just do not persist */
  }
}

function loadPrefs() {
  // `range` is the slider range mode. It defaults to *wide*, not normal: the panel exists to
  // test edges, and stopping politely at the shipped range is exactly the complaint that put
  // the modes there. A saved mode always wins over the default.
  const fallback = { sound: true, range: 'wide' };
  try {
    const stored = { ...fallback, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
    if (!RANGE_MODES[stored.range]) stored.range = fallback.range;
    return stored;
  } catch {
    return fallback;
  }
}

function loadSavedTuning() {
  try {
    return JSON.parse(localStorage.getItem(TUNING_KEY) ?? 'null');
  } catch {
    return null;
  }
}

function saveTuning(patch) {
  try {
    localStorage.setItem(TUNING_KEY, JSON.stringify(patch));
  } catch {
    /* ignore */
  }
}

function savePrefs(p) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

function starsFor({ falls, time, par }) {
  if (falls === 0 && time <= par) return 3;
  if (falls <= 1 && time <= par * 1.6) return 2;
  return 1;
}

/** A failure the player can actually see, instead of a frozen board. */
function showFatal(err, where) {
  window.__mazeError = { where, message: String(err?.message ?? err), stack: String(err?.stack ?? '') };
  console.error(`[marble-maze] ${where}:`, err);
  if (document.getElementById('fatal')) return;
  const box = document.createElement('div');
  box.id = 'fatal';
  box.innerHTML = `<b>Marble Maze hit an error</b><span>${where}: ${String(err?.message ?? err)}</span><small>Details are in the browser console. Reload to try again.</small>`;
  document.body.appendChild(box);
}

export async function boot() {
  const canvas = document.getElementById('view');
  const audio = createAudio();
  let prefs = loadPrefs();
  let bests = loadBests();

  //  A `?draft=` that cannot be opened has to say so: this is the editor's *play this draft*
  //  landing here, and quietly falling back to level 1 would look like the draft itself.
  if (draftError) {
    const box = document.createElement('div');
    box.id = 'fatal';
    box.innerHTML = `<b>That draft could not be opened</b><span>${String(draftError.message ?? draftError)}</span><small>Edit it in the level editor and press “play this draft” again.</small>`;
    document.body.appendChild(box);
  }

  let levelIndex = 0;
  if (qs.level) {
    const found = LEVEL_SOURCES.findIndex((l) => l.id === qs.level);
    if (found >= 0) levelIndex = found;
  }

  // Saved tuning is honoured unless a URL asks for the shipping numbers.
  if (qs.physics !== 'default') {
    const saved = loadSavedTuning();
    if (saved) loadTuningJSON(saved);
  }
  // A marble named in the URL wins over saved tuning, exactly as `?level=` beats the last level
  // played. An unknown name is ignored rather than silently resetting the look.
  if (qs.marble && MARBLE_LOOKS.includes(qs.marble)) setTuning('marbleLook', qs.marble);

  let level = LEVEL_SOURCES[levelIndex];
  let world = makeWorld(level);

  //  The board is one picture of walnut, and the loader has it before the scene is built rather
  //  than swapping it in later, so the board never renders as one timber and then changes to
  //  another. If it cannot be loaded the procedural fields are used instead: a missing asset is a
  //  worse board, not a broken game. (The span is the widest board in the game; smaller footprints
  //  take a window out of the middle of the same picture.)
  const wood = await loadImage(new URL('../assets/wood-board.png', import.meta.url)).catch((err) => {
    console.warn('wood-board.png unavailable, using the procedural board:', err.message);
    return null;
  });

  // The saved marble look is applied at build time rather than swapped in after the first frame,
  // so the board never renders with one marble and then changes to another.
  const scene = createScene(canvas, level, { wood, marbleLook: getTuning('marbleLook') });
  if (qs.quality) scene.setQuality(qs.quality);
  // Put the (possibly saved or URL-forced) lighting numbers on the rig before the first frame.
  scene.applyLighting({ immediate: true });
  const pilot = makePilot(world, {});
  plan(pilot);

  const hud = createHud({
    onRestart: () => restart(),
    onNext: () => gotoLevel(levelIndex + 1),
    onMenu: () => openMenu(),
    onCloseMenu: () => closeOverlays(),
    onPause: () => togglePause(),
    onResume: () => togglePause(false),
    onDemo: () => startDemo(),
    onToggleSound: () => {
      prefs.sound = !prefs.sound;
      audio.setEnabled(prefs.sound);
      hud.setSound(prefs.sound);
      savePrefs(prefs);
      if (prefs.sound) audio.unlock();
    },
    onShowSlate: () => {
      hud.state.slate.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      hud.state.slate.classList.add('pulse');
      setTimeout(() => hud.state.slate.classList.remove('pulse'), 1200);
    },
  });

  hud.renderLevels(LEVEL_SOURCES, bests, level.id, (id) => {
    const idx = LEVEL_SOURCES.findIndex((l) => l.id === id);
    if (idx >= 0) gotoLevel(idx);
  });
  hud.renderSlate(LEVEL_SLATE);
  hud.setSound(prefs.sound);
  audio.setEnabled(prefs.sound);

  //  The frame-time instrument. Off unless `?perf` asked for it, and always reachable with F.
  const perf = createPerf({ enabled: qs.perf });

  // Anything that changes tuning has to push the lighting values into the renderer; they are the
  // one part of the tuning sheet the renderer owns rather than the physics.
  const syncLighting = () => scene.applyLighting();

  // The board finish is the other part, and it is the expensive one: five surfaces' worth of maps,
  // rebuilt whenever the finish or the grain prominence moves. Dragging the grain slider fires an
  // event per step, so the rebuild waits for the hand to stop - the board keeps its last-built look
  // until then, which is what a debounced control should do.
  // The marble look has no cost to speak of, so it never needs debouncing - it just follows the
  // tuning value wherever that value came from (a slider, a preset, a reset, a pasted profile).
  const syncMarble = () => scene.setMarbleLook(getTuning('marbleLook'));

  //  The tuning paths that change how the toy looks rather than how it behaves.
  const LOOK_PATHS = new Set(['boardFinish', 'grainProminence', 'rimGrain', 'rimStain']);
  let boardTimer = 0;
  const syncBoard = ({ immediate = false } = {}) => {
    clearTimeout(boardTimer);
    if (immediate) {
      scene.applyBoardFinish();
      return;
    }
    boardTimer = setTimeout(() => scene.applyBoardFinish(), 220);
  };

  /**
   *  The one place a tuning change is pushed into the renderer.
   *
   *  Both the sheet's own handler and the programmatic path (`__maze.tuning.set`) go through this,
   *  which matters more than it looks: when the marble look was wired only into the slider handler,
   *  setting it from the console changed the stored value and left the board showing the old marble
   *  - the kind of "the control does nothing" bug that is invisible until something drives the API.
   *
   *  `path` is the single path that changed, or null when several did at once (a preset, a reset, a
   *  pasted profile), in which case every renderer-owned path is re-applied.
   */
  const MARBLE_PATHS = new Set([
    'marbleLook',
    'marbleTransparency',
    'marbleBend',
    'marbleFill',
    'marbleLampBrightness',
    'marbleLampHue',
    'marbleBandContrast',
    'marbleBandCount',
    'marbleBandWidth',
    'marbleSolidColor',
  ]);
  const applyTuningToRenderer = (path = null, { immediate = false } = {}) => {
    syncLighting();
    //  Two separate calls on purpose: `marbleLook` swaps which marble is on the board (and the fresh
    //  one then needs the dials pushed onto it), while the other marble dials only re-push numbers.
    //  Writing this as an if/else-if left `reset all` swapping the numbers back without rebuilding
    //  the marble, so the board kept showing the old one - caught by the browser check.
    if (path === null || path === 'marbleLook') syncMarble();
    if (path === null || MARBLE_PATHS.has(path)) {
      scene.applyMarbleGlass();
      scene.applyMarbleDials();
    }
    if (path === null || LOOK_PATHS.has(path)) syncBoard({ immediate });
  };

  const tuningPanel = createTuningPanel({
    spec: TUNING_SPEC,
    presets: PRESETS,
    ranges: { modes: RANGE_MODES, keys: RANGE_MODE_KEYS, limitsFor: rangeFor },
    handlers: {
      getValue: (path) => getTuning(path),
      isCustomised,
      onChange: (path, value) => {
        setTuning(path, value);
        saveTuning(flattenTuning());
        updateCustomBadge();
        applyTuningToRenderer(path);
      },
      onPreset: (name) => {
        applyPreset(name);
        saveTuning(flattenTuning());
        updateCustomBadge();
        applyTuningToRenderer();
      },
      onReset: () => {
        resetTuning();
        saveTuning(flattenTuning());
        updateCustomBadge();
        applyTuningToRenderer(null, { immediate: true });
      },
      onCopy: () => tuningToJSON(),
      onLoad: (json) => {
        const res = loadTuningJSON(json);
        if (res.ok) {
          saveTuning(flattenTuning());
          updateCustomBadge();
          applyTuningToRenderer();
        }
        return res;
      },
      // Slider range mode: a browser preference, not part of the physics, so it lives with the
      // other preferences and never in the tuning sheet.
      getRangeMode: () => prefs.range,
      onRangeMode: (mode) => {
        if (!RANGE_MODES[mode]) return prefs.range;
        prefs.range = mode;
        savePrefs(prefs);
        return mode;
      },
      // Saved profiles: a profile is the *diff* from the shipped defaults plus the range mode it
      // was saved under, so loading one restores both the numbers and the sliders that showed
      // them, and a profile that only changed gravity leaves everything else shipped.
      listProfiles: () => profileNames(),
      onSaveProfile: (name, range) => writeProfile(name, { patch: diffFromDefaults(), range }),
      onLoadProfile: (name) => {
        const entry = readProfile(name);
        if (!entry) return { ok: false, error: 'that profile is gone' };
        resetTuning();
        applyTuning(entry.patch ?? {});
        if (RANGE_MODES[entry.range]) {
          prefs.range = entry.range;
          savePrefs(prefs);
        }
        saveTuning(flattenTuning());
        updateCustomBadge();
        applyTuningToRenderer();
        return { ok: true };
      },
      onDeleteProfile: (name) => deleteProfile(name),
      onRestart: () => restart(),
      onLevel: () => {
        world.control.x = 0;
        world.control.z = 0;
        scripted = null;
      },
      onClose: () => {
        tuningPanel.open(false);
        syncPanelLayout();
      },
    },
  });

  // While the tuning sheet is open it covers the right of the window, so the toy is lens-
  // shifted to sit in the space that is left. This is driven from one place and re-run on
  // every resize, because the shift is measured in pixels.
  function syncPanelLayout() {
    const open = tuningPanel.isOpen;
    const el = document.querySelector('.tune-panel');
    const panelPx = open && el ? el.getBoundingClientRect().width : 0;
    scene.setSideShift(panelPx);
  }

  function updateCustomBadge() {
    const on = isCustomised();
    const btn = document.getElementById('btn-tune');
    if (!btn) return;
    btn.classList.toggle('changed', on);
    btn.textContent = on ? 'tune •' : 'tune';
  }

  let mode = 'playing'; // playing | demo | paused | menu | won
  let demo = false;
  let paused = false;
  let overlayOpen = false;
  let runTime = 0;
  let falls = 0;
  //  Marble index -> seconds until that marble is put back on its spawn. A Map rather than one
  //  scalar so two marbles that fall at different times come back on their own clocks.
  const respawnTimers = new Map();
  let lastEvents = 0;
  let resizeQueued = false;

  function currentBest() {
    return bests[level.id] ?? null;
  }

  // How many marbles are home, for the HUD's marbles chip on multi-marble levels.
  const marbleProgress = () => ({ home: homeCount(world), total: world.balls.length });

  function syncLevelChrome() {
    hud.setLevelInfo(level, currentBest(), levelIndex < LEVEL_SOURCES.length - 1);
    hud.setStats(runTime, falls, marbleProgress());
    document.title = `Marble Maze — ${level.name}`;
  }

  function rebuildWorld() {
    world = makeWorld(level);
    pilot.world = world;
    pilot.path = null;
    pilot.lastCell = null;
    plan(pilot);
    runTime = 0;
    falls = 0;
    respawnTimers.clear();
    lastEvents = 0;
    settleArm = false;
    prevTilt = { x: 0, z: 0 };
    syncLevelChrome();
    audio.place(panOf(world.ball.x));
  }

  function gotoLevel(index) {
    if (index < 0 || index >= LEVEL_SOURCES.length) return;
    levelIndex = index;
    level = LEVEL_SOURCES[index];
    scene.setLevel(level);
    rebuildWorld();
    closeOverlays();
    mode = 'playing';
    demo = false;
    hud.showDemo(false);
    hud.hideWin();
    hud.showHint(level.hint, 7);
    audio.unlock();
  }

  function restart() {
    rebuildWorld();
    hud.hideWin();
    closeOverlays();
    mode = 'playing';
    demo = false;
    hud.showDemo(false);
    scene.frameBoard(qs.snap);
    audio.unlock();
  }

  function openMenu() {
    paused = true;
    overlayOpen = true;
    hud.showMenu(true);
    hud.showPause(false);
    hud.renderLevels(LEVEL_SOURCES, bests, level.id, (id) => {
      const idx = LEVEL_SOURCES.findIndex((l) => l.id === id);
      if (idx >= 0) gotoLevel(idx);
    });
    audio.stopRolling();
  }

  function closeOverlays() {
    overlayOpen = false;
    hud.showMenu(false);
    hud.showPause(false);
    if (mode !== 'won') paused = false;
  }

  function togglePause(force) {
    if (overlayOpen) {
      closeOverlays();
      return;
    }
    paused = force === undefined ? !paused : force;
    hud.showPause(paused);
    if (paused) audio.stopRolling();
  }

  function startDemo() {
    closeOverlays();
    demo = true;
    mode = 'demo';
    rebuildWorld();
    hud.showDemo(true);
    hud.showHint('Watching the solver play: it only tilts the board, same as you.', 5);
    audio.unlock();
  }

  // -------------------------------------------------------------------- input
  const keys = new Set();
  let pointer = null;
  let dragTilt = { x: 0, z: 0 };
  let tiltMode = 'keys'; // keys | drag | device
  let deviceTilt = { x: 0, z: 0 };
  const DRAG_RANGE = 150; // pixels for full tilt

  const isEditing = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey) return;
    // A focused slider or text box owns its keys: never tilt the board from inside the panel.
    if (isEditing(e.target)) return;
    const k = e.key.toLowerCase();
    keys.add(k);
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    if (k === 'r') restart();
    if (k === 'escape') {
      if (hud.state.helpPanel.classList.contains('show')) hud.state.helpPanel.classList.remove('show');
      else if (overlayOpen) closeOverlays();
      else togglePause();
    }
    if (k === 'd') startDemo();
    if (k === 'm') hud.state.soundBtn.click();
    if (k === 't') {
      tuningPanel.toggle();
      syncPanelLayout();
    }
    if (k === 'f') perf.toggle();
    audio.unlock();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  canvas.addEventListener('pointerdown', (e) => {
    audio.unlock();
    canvas.setPointerCapture(e.pointerId);
    pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY };
    tiltMode = 'drag';
    hud.setMode('drag');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointer || e.pointerId !== pointer.id) {
      // Not dragging: if the pointer is over the grip, show a grab cursor. That is how the
      // player discovers which part of the toy their hand is supposed to hold.
      const r = canvas.getBoundingClientRect();
      const ndcX = ((e.clientX - r.left) / r.width) * 2 - 1;
      const ndcY = -(((e.clientY - r.top) / r.height) * 2 - 1);
      scene.setHandleHover(scene.overHandle(ndcX, ndcY));
      return;
    }
    const dx = (e.clientX - pointer.sx) / DRAG_RANGE;
    const dy = (e.clientY - pointer.sy) / DRAG_RANGE;
    dragTilt.z = Math.max(-1, Math.min(1, dx)) * MAX_TILT;
    dragTilt.x = Math.max(-1, Math.min(1, dy)) * MAX_TILT;
  });
  const endPointer = (e) => {
    scene.setHandleHover(false);
    if (!pointer || e.pointerId !== pointer.id) return;
    pointer = null;
    dragTilt = { x: 0, z: 0 };
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', endPointer);

  window.addEventListener(
    'deviceorientation',
    (e) => {
      if (e.beta == null || e.gamma == null) return;
      const gamma = Math.max(-1, Math.min(1, e.gamma / 30));
      const beta = Math.max(-1, Math.min(1, (e.beta - 35) / 30));
      deviceTilt.z = gamma * MAX_TILT;
      deviceTilt.x = -beta * MAX_TILT;
    },
    true,
  );

  const requestDeviceTilt = async () => {
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) return false;
    if (typeof DOE.requestPermission === 'function') {
      try {
        const res = await DOE.requestPermission();
        if (res !== 'granted') return false;
      } catch {
        return false;
      }
    }
    tiltMode = 'device';
    hud.setMode('tilt');
    return true;
  };
  document.getElementById('btn-tune').addEventListener('click', () => {
    tuningPanel.toggle();
    syncPanelLayout();
  });

  document.getElementById('btn-device').addEventListener('click', async () => {
    const ok = await requestDeviceTilt();
    if (!ok) hud.flash('Device tilt is not available here — use the keys or drag.', 2.4);
  });

  let scripted = null; // set by the debug API so a test can hold a tilt

  function readInput(dt) {
    if (scripted) {
      world.control.x = scripted.x;
      world.control.z = scripted.z;
      return;
    }
    // keyboard / drag / device -> world.control
    const fine = keys.has('shift');
    const rate = fine ? 0.35 : 1;
    let kx = 0;
    let kz = 0;
    if (keys.has('arrowup') || keys.has('w')) kx -= 1;
    if (keys.has('arrowdown') || keys.has('s')) kx += 1;
    if (keys.has('arrowleft') || keys.has('a')) kz -= 1;
    if (keys.has('arrowright') || keys.has('d')) kz += 1;

    if (kx || kz) {
      tiltMode = 'keys';
      hud.setMode(fine ? 'keys (fine)' : 'keys');
    }

    let tx = 0;
    let tz = 0;
    if (tiltMode === 'drag' && (dragTilt.x || dragTilt.z)) {
      tx = dragTilt.x;
      tz = dragTilt.z;
    } else if (tiltMode === 'device') {
      tx = deviceTilt.x;
      tz = deviceTilt.z;
    } else if (kx || kz) {
      const n = Math.hypot(kx, kz) || 1;
      tx = (kx / n) * MAX_TILT * rate;
      tz = (kz / n) * MAX_TILT * rate;
    }
    // Direct set: the physics engine still ramps the physical tilt toward this target,
    // which is what makes the board feel like it has weight.
    world.control.x = tx;
    world.control.z = tz;
    void dt;
  }

  // --------------------------------------------------------------------- loop
  let acc = 0;
  let last = performance.now();
  let fpsSamples = [];
  let qualityClock = 0;
  let qualityChanges = 0;
  //  A benchmark has to hold the tier still: the loop below is *designed* to move it, so on a fast
  //  machine it upgrades the tier back during the measurement window and reports the tier's cost as
  //  if it were the feature's. Locking is for measurement only - a player never sets this.
  let qualityLocked = false;
  let benchCount = 0;
  let benchStart = 0;
  let settleArm = false; // the marble has been moving this attempt, so a stop is worth a sound
  let lastCreak = 0;
  let prevTilt = { x: 0, z: 0 };

  const queuedFx = [];

  // Board space is about 10-20 units wide, so a marble at the left wall should be heard
  // on the left. Same mapping for rolling, scrape and every one-shot effect.
  const panOf = (x) => clampNum((x / (world.w / 2)) * 0.75, -1, 1);

  function handleEvents() {
    for (; lastEvents < world.events.length; lastEvents++) {
      const e = world.events[lastEvents];
      const fx = {};
      const pan = e.x === undefined ? 0 : panOf(e.x);
      if (e.type === 'bump') {
        if (e.peg) audio.peg(e.hard, pan);
        else audio.bump(e.power, e.hard, e.surface ?? world.surface, pan);
        fx.bump = e;
      } else if (e.type === 'plate') {
        audio.plate(pan);
        fx.spark = e;
      } else if (e.type === 'gate-shut') {
        audio.gate(pan);
      } else if (e.type === 'lift') {
        //  A plate-driven wall slab reaching full height thunks; sinking is a quieter slide.
        if (e.up) audio.gate(pan);
        else audio.creak(0.8, pan);
      } else if (e.type === 'teleport') {
        audio.teleport(pan);
        fx.teleport = e;
      } else if (e.type === 'belt') {
        audio.belt(pan);
      } else if (e.type === 'place') {
        audio.place(pan);
      } else if (e.type === 'pit') {
        audio.pit(pan);
        fx.dust = { x: e.x, z: e.z };
        hud.flash('Down the hole.', 1.6, 'bad');
      } else if (e.type === 'edge') {
        audio.edge(pan);
        hud.flash('Off the board!', 1.6, 'bad');
      } else if (e.type === 'goal') {
        audio.win(pan);
      }
      queuedFx.push(fx);
    }
  }

  let frameErrors = 0;

  function frame() {
    try {
      frameBody();
    } catch (err) {
      frameErrors += 1;
      showFatal(err, 'frame');
      if (frameErrors > 2) return; // stop visibly instead of spamming the console forever
    }
    requestAnimationFrame(frame);
  }

  function frameBody() {
    perf.frameStart();
    const now = performance.now();
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25; // tab was hidden: do not fast-forward the marble

    if (!paused && !overlayOpen) {
      acc += dt;
      let guard = 0;
      while (acc >= DT && guard++ < 400) {
        if (demo) {
          const c = pilotControl(pilot);
          world.control.x = c.x;
          world.control.z = c.z;
        } else {
          readInput(DT);
        }
        step(world, DT);
        acc -= DT;
        if (mode === 'playing') runTime += DT;
        for (const b of world.balls) {
          if (b.state === 'dead' && !respawnTimers.has(b.i)) {
            falls += 1;
            respawnTimers.set(b.i, 0.85);
          }
        }
      }
      //  Fallen marbles come back on their own timer. On a multi-marble board the board is NOT
      //  recentred: the other marbles are still in play and must not be flung around, so only
      //  the one that fell is put back. A single-marble level keeps its original full restart,
      //  which recentres the board with it.
      if (respawnTimers.size) {
        for (const [i, t] of [...respawnTimers]) {
          const left = t - dt;
          if (left > 0) {
            respawnTimers.set(i, left);
            continue;
          }
          respawnTimers.delete(i);
          if (world.balls.length === 1) resetBall(world);
          else resetBall(world, world.balls[i]);
          if (demo) {
            pilot.path = null;
            pilot.lastCell = null;
            plan(pilot);
          }
        }
      }
      const allWon = world.balls.every((b) => b.state === 'won');
      if (allWon && mode === 'demo') {
        // The solver finishing is not the player finishing: no best time, no overlay.
        hud.flash('The solver made it. Your turn.', 2.6, 'good');
        demo = false;
        mode = 'playing';
        hud.showDemo(false);
        window.__maze.lastDemoWin = { level: level.id, solverTime: world.time };
        rebuildWorld();
      } else if (allWon && mode !== 'won') {
        mode = 'won';
        const stars = starsFor({ falls, time: runTime, par: level.par });
        const prev = currentBest();
        const isNewBest = !prev || runTime < prev.time || stars > prev.stars;
        if (isNewBest) {
          bests[level.id] = { time: runTime, falls, stars };
          saveBests(bests);
        }
        hud.showWin({
          stars,
          time: runTime,
          falls,
          best: bests[level.id],
          isNewBest,
          hasNext: levelIndex < LEVEL_SOURCES.length - 1,
        });
        demo = false;
        hud.showDemo(false);
        window.__maze.lastWin = { level: level.id, time: runTime, falls, stars };
      }
    }

    //  The fixed step and everything it triggered (respawn, the solver's finish) is the physics
    //  phase; the mark closes it here, where that whole block has just finished.
    perf.tick('physics');
    handleEvents();
    const fx = Object.assign({}, ...queuedFx.splice(0));

    // Paused or behind an overlay: silence the continuous layers rather than reporting a
    // marble that is still rolling under a frozen board.
    if (!overlayOpen && !paused) {
      const rolling = world.ball.state === 'roll';
      const v = rolling ? speed(world) : 0;
      const bx = world.ball.x;
      const pan = panOf(bx);
      audio.rolling(v, world.surface, dt, pan);
      audio.scrape(rolling ? world.slideT : 0, world.surface, pan);

      // Vent wind and magnet hum are field effects, not events: they rise and fall with
      // the marble's position, so they are read from the world each frame.
      const bc = Math.floor(bx + world.w / 2);
      const br = Math.floor(world.ball.z + world.h / 2);
      const over = rolling && world.features.vents.some((vt) => vt.cells.some(([vc, vr]) => vc === bc && vr === br));
      audio.wind(over ? 0.7 : 0, pan);
      let mag = 0;
      for (const m of world.features.magnets) {
        const d = Math.hypot(m.x - bx, m.z - world.ball.z);
        if (d < m.radius) mag = Math.max(mag, 1 - d / m.radius);
      }
      audio.magnet(rolling ? mag : 0, pan);

      // The marble rolling to a stop deserves one last contact. A fall or a respawn
      // clears it, so a pit does not get a settle click on top of the plunge.
      if (!rolling) settleArm = false;
      else if (v > 0.22) settleArm = true;
      else if (settleArm && v < 0.05) {
        audio.settle(pan);
        settleArm = false;
      }

      // The board itself moves in your hands: a quiet creak on a fast tilt only.
      const tiltRate = Math.hypot(world.tilt.x - prevTilt.x, world.tilt.z - prevTilt.z) / Math.max(dt, 1e-3);
      prevTilt = { x: world.tilt.x, z: world.tilt.z };
      if (tiltRate > 1.1 && now - lastCreak > 700) {
        lastCreak = now;
        audio.creak(clampNum((tiltRate - 1.1) / 1.4, 0.15, 1), pan);
      }
    }

    perf.tick('sim');
    scene.sync(world, dt, { ...fx, winPulse: mode === 'won' ? 1 : 0 });
    perf.tick('sync');
    scene.render();
    perf.tick('render');
    hud.tick(dt);
    hud.setStats(runTime, falls, marbleProgress());
    hud.setTilt(world.tilt, MAX_TILT);

    if (tuningPanel.isOpen) {
      const v = speed(world);
      const deg = (r) => ((r * 180) / Math.PI).toFixed(1);
      tuningPanel.setReadout(
        `speed ${v.toFixed(2)} u/s   tilt ${deg(world.tilt.z)}° / ${deg(world.tilt.x)}°   peak ${world.maxSpeedSeen.toFixed(2)}   ` +
          `state ${world.ball.state}   surface ${world.surface}   falls ${falls}   time ${runTime.toFixed(1)}s`,
      );
    }
    perf.tick('ui');

    //  The perf instrument closes its own last phase and records the interval; the adaptive loop
    //  keeps its own sample ring (it wants *seconds*, and only ever sees the tier's effect).
    perf.frameEnd(scene.stats);
    fpsSamples.push(dt);
    if (fpsSamples.length > 90) fpsSamples.shift();
    //  Adaptive quality: measured, not guessed. Only the renderer tier changes; the
    //  physics timestep never does, so feel is identical on every machine.
    qualityClock += dt;
    if (!qualityLocked && qualityClock > 2.5 && fpsSamples.length >= 60) {
      qualityClock = 0;
      const avg = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
      const current = scene.quality;
      if (avg > 0.026) {
        scene.setQuality(current === 'high' ? 'medium' : 'low');
        qualityChanges += 1;
      } else if (avg < 0.011 && current !== 'high' && qualityChanges < 2) {
        scene.setQuality(current === 'low' ? 'medium' : 'high');
        qualityChanges += 1;
      }
      window.__maze.quality = { tier: scene.quality, avgMs: avg * 1000 };
    }

    if (qs.bench) {
      if (benchStart === 0) benchStart = performance.now();
      benchCount++;
      if (benchCount === qs.bench) {
        const ms = (performance.now() - benchStart) / benchCount;
        document.title = `bench ${ms.toFixed(2)} ms/frame`;
        window.__maze.bench = { frames: benchCount, msPerFrame: ms };
      }
    }
  }

  window.addEventListener('resize', () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      scene.resize();
      syncPanelLayout(); // the sheet's width changes with the window
    });
  });

  // ------------------------------------------------------------------ debug api
  window.__maze = {
    version: 1,
    draft: { key: qs.draft ?? null, loaded: !!draftLevel, error: draftError ? String(draftError.message ?? draftError) : null },
    get world() {
      return world;
    },
    scene,
    audio,
    level,
    get state() {
      return { mode, falls, runTime, demo, paused, overlayOpen, levelId: level.id };
    },
    levels: LEVEL_SOURCES.map((l) => ({ id: l.id, name: l.name, difficulty: l.difficulty })),
    gotoLevel,
    restart,
    startDemo,
    freeCamera(on) {
      scene.setFreeCamera(on);
    },
    /**
     * Switch the marble's embedded lamp off, so a check can measure what it adds to the board. The
     * only honest control for "does the lamp light anything" is the same marble with its own light
     * off - another marble differs in its core colour and its glass as well.
     */
    marbleLamp(on) {
      return scene.setMarbleLamp(on);
    },
    /**
     * Pin the renderer tier, or release it with `null`, so a benchmark measures the feature it
     * means to measure rather than the adaptive loop's reaction to it.
     */
    lockQuality(tier) {
      qualityLocked = !!tier;
      if (tier) scene.setQuality(tier);
      return { locked: qualityLocked, tier: scene.quality };
    },
    /** The transmission pass's buffer, so a check can prove it is sized to the marble. */
    get transmission() {
      return scene.transmission;
    },
    /**
     * The frame-time instrument: `snapshot()` for the numbers, `toggle()`/`setEnabled()` for the
     * overlay, `reset()` to start a clean window. This is what the profiling tool drives, so a
     * smoothness measurement and the on-screen meter read the exact same ring of frames.
     */
    perf,
    /** The glass dials, as the renderer has them, so a check can read the applied state. */
    get marbleGlass() {
      let shell = null;
      scene.scene.traverse((o) => { if (o.name === 'marble-ball') shell = o.material; });
      return shell
        ? { transmission: +shell.transmission.toFixed(3), thickness: +shell.thickness.toFixed(3), roughness: +shell.roughness.toFixed(3) }
        : null;
    },
    probeLocal(points) {
      return scene.probeLocal(points);
    },
    lookFrom(pos, target) {
      scene.setFreeCamera(true);
      scene.camera.position.set(pos[0], pos[1], pos[2]);
      scene.camera.lookAt(target[0], target[1], target[2]);
    },
    setTilt(x, z) {
      world.control.x = x;
      world.control.z = z;
    },
    /** Hold a tilt until released, bypassing the input layer (for tests and demos). */
    holdTilt(x, z) {
      scripted = x === null ? null : { x, z };
      if (scripted) {
        world.control.x = x;
        world.control.z = z;
      }
    },
    get tilt() {
      return { x: world.tilt.x, z: world.tilt.z, controlX: world.control.x, controlZ: world.control.z };
    },
    advance(seconds) {
      const n = Math.round(seconds / DT);
      for (let i = 0; i < n; i++) step(world, DT);
    },
    reachGoal() {
      world.ball.x = level.goal.x;
      world.ball.z = level.goal.z;
      world.ball.vx = 0;
      world.ball.vz = 0;
    },
    /** Every marble on the board, so a check can follow a multi-marble level. */
    get marbles() {
      return world.balls.map((b) => ({ i: b.i, x: b.x, z: b.z, state: b.state }));
    },
    /** Park every marble over the cup, for a check that wants the win state immediately. */
    reachGoalAll() {
      for (const b of world.balls) {
        b.x = level.goal.x;
        b.z = level.goal.z;
        b.vx = 0;
        b.vz = 0;
      }
    },
    api: { makeWorld, step, resetBall, cellAt, speed, PIT, DT, MAX_TILT, LEVEL_SLATE, SLATE_NOTE },
    tuning: {
      spec: TUNING_SPEC,
      presets: Object.keys(PRESETS),
      get: getTuning,
      set: (path, value) => {
        const applied = setTuning(path, value);
        saveTuning(flattenTuning());
        updateCustomBadge();
        tuningPanel.refresh();
        //  Applied at once rather than through the sheet's debounce: this is the programmatic path,
        //  used by the checks, which want the board rebuilt before they look.
        applyTuningToRenderer(path, { immediate: true });
        return applied;
      },
      apply: (patch) => {
        const res = applyTuning(patch);
        saveTuning(flattenTuning());
        updateCustomBadge();
        tuningPanel.refresh();
        applyTuningToRenderer();
        return res;
      },
      preset(name) {
        applyPreset(name);
        saveTuning(flattenTuning());
        updateCustomBadge();
        tuningPanel.refresh();
        applyTuningToRenderer();
      },
      reset() {
        resetTuning();
        saveTuning(flattenTuning());
        updateCustomBadge();
        tuningPanel.refresh();
        applyTuningToRenderer();
      },
      customised: isCustomised,
      diff: diffFromDefaults,
      json: tuningToJSON,
      load: (json) => {
        const res = loadTuningJSON(json);
        updateCustomBadge();
        tuningPanel.refresh();
        if (res.ok) applyTuningToRenderer();
        return res;
      },
      snapshot: () => flattenTuning(),
      open: (on) => {
        tuningPanel.open(on);
        syncPanelLayout(); // the debug path has to move the view too, or checks measure nothing
      },
      values: TUNING,
    },
  };

  syncLevelChrome();
  updateCustomBadge();
  hud.setLevelInfo(level, currentBest(), false);
  hud.showHint(`${level.hint}${qs.demo ? ' (demo mode)' : ''}`, 8);
  if (qs.demo || qs.autoplayFirst) startDemo();
  requestAnimationFrame(frame);
  // let the first frame land before any scripted screenshot
  return window.__maze;
}

await boot();
