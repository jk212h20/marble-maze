// The tuning layer: every knob reachable, clamped, serialisable, and — the part that
// matters — the level stays playable across the feel presets.
import { LEVELS, buildLevel } from '../src/engine/levels.js';
import { makeWorld, step, speed } from '../src/engine/physics.js';
import { solveLevel } from '../src/engine/autopilot.js';
import {
  TUNING,
  TUNING_SPEC,
  TUNING_KEYS,
  DEFAULT_TUNING,
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
} from '../src/engine/tuning.js';
import { DT, MAX_TILT, GRAVITY } from '../src/engine/constants.js';

export const name = 'tuning';

const level = () => buildLevel(LEVELS[0]);

function rollWith(seconds, control) {
  const world = makeWorld(level());
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const c = control(world);
    world.control.x = c.x;
    world.control.z = c.z;
    step(world, DT);
  }
  return world;
}

export function tests(t) {
  t.ok('every tunable key has a control with a sane range', () => {
    const items = TUNING_SPEC.flatMap((g) => g.items);
    for (const item of items) {
      if (!item.label) throw new Error(`${item.path} has no label`);
      if (!item.hint) throw new Error(`${item.path} has no explanation for the panel`);
      const def = flattenTuning(DEFAULT_TUNING)[item.path];
      // A choice item (the indicator mode) is a fixed list of words: it has no range to be sane
      // about, but its default still has to be one of the options.
      if (item.options) {
        if (!item.options.length) throw new Error(`${item.path} offers no choices`);
        const values = item.options.map((o) => o.value);
        if (!values.includes(def)) throw new Error(`${item.path} default ${def} is not one of its options`);
        if (typeof getTuning(item.path) !== 'string') throw new Error(`${item.path} is not a string in TUNING`);
        continue;
      }
      //  A colour is the third kind of control: a hex string with no range, but a default that has
      //  to be a valid colour or the marble paints itself black the moment anything resets.
      if (item.type === 'color') {
        if (!/^#[0-9a-f]{6}$/i.test(String(def))) throw new Error(`${item.path} default ${def} is not a hex colour`);
        if (typeof getTuning(item.path) !== 'string') throw new Error(`${item.path} is not a string in TUNING`);
        continue;
      }
      if (typeof getTuning(item.path) !== 'number') throw new Error(`${item.path} is not a number in TUNING`);
      if (!(item.min < item.max)) throw new Error(`${item.path} has a broken range`);
      if (!(item.step > 0)) throw new Error(`${item.path} has no step`);
      if (def < item.min || def > item.max) throw new Error(`${item.path} default ${def} is outside its own range`);
    }
    for (const group of TUNING_SPEC) {
      if (!group.group || !group.items?.length) throw new Error('empty tuning group');
    }
  });

  t.ok('the spec covers every key, so nothing can ship without a slider', () => {
    for (const key of TUNING_KEYS) {
      if (getTuning(key) === undefined) throw new Error(`${key} is in the spec but missing from TUNING`);
    }
    const tunable = ['gravity', 'roll', 'vMax', 'maxTilt', 'tiltRate', 'tiltReturn', 'ballR', 'pitCapture', 'goalCapture'];
    for (const k of tunable) if (!TUNING_KEYS.includes(k)) throw new Error(`${k} has no slider`);
  });

  t.ok('values are clamped to the widest range, not the panel range', () => {
    // The clamp uses the widest mode, so a profile saved while testing extremes round-trips
    // exactly no matter which range the panel happens to be showing. A nonsense value is
    // refused outright and the previous number stands.
    const g = setTuning('gravity', 999);
    if (g !== RANGE_MODES.extreme.factor * 20) throw new Error(`gravity was not clamped (${g})`);
    const r = setTuning('ballR', -5);
    if (r !== 0.12 / RANGE_MODES.extreme.factor) throw new Error(`ballR was not clamped (${r})`);
    setTuning('gravity', 'nonsense');
    if (getTuning('gravity') !== RANGE_MODES.extreme.factor * 20) throw new Error('a non-numeric value was accepted');
    resetTuning();
  });

  t.ok('a wider slider range only ever grows outward', () => {
    for (const key of ['normal', 'wide', 'extreme']) {
      if (!RANGE_MODE_KEYS.includes(key)) throw new Error(`the ${key} range mode is missing`);
    }
    const items = TUNING_SPEC.flatMap((g) => g.items);
    for (const item of items) {
      if (item.options || item.type === 'color') continue; // modes are a list; a colour has no range
      const normal = rangeFor(item, 'normal');
      if (normal.min !== item.min || normal.max !== item.max) {
        throw new Error(`${item.path}: the normal mode is not the documented range`);
      }
      for (const mode of ['wide', 'extreme']) {
        const lim = rangeFor(item, mode);
        if (!(lim.min <= item.min) || !(lim.max >= item.max)) {
          throw new Error(`${item.path}: ${mode} hid the documented range (${lim.min}..${lim.max})`);
        }
        if (lim.max < RANGE_MODES[mode].factor * item.max) {
          throw new Error(`${item.path}: ${mode} did not widen the top past the factor (${lim.max})`);
        }
        if (lim.min > item.min / RANGE_MODES[mode].factor) {
          throw new Error(`${item.path}: ${mode} did not widen the bottom past the factor (${lim.min})`);
        }
        const snapped = Math.abs(lim.min / lim.step - Math.round(lim.min / lim.step)) < 1e-6 &&
          Math.abs(lim.max / lim.step - Math.round(lim.max / lim.step)) < 1e-6;
        if (!snapped) throw new Error(`${item.path}: ${mode} limits (${lim.min}, ${lim.max}) are off the ${lim.step} grid`);
      }
    }
  });

  t.ok('every knob at both extremes of the widest range keeps the simulation finite', () => {
    // The whole point of a widened range is to go where the game would never go, so the
    // engine has to survive it: all knobs pinned to one end at once, then rolled for ten
    // simulated seconds, must never produce a NaN or an infinity on the board.
    const items = TUNING_SPEC.flatMap((g) => g.items).filter((i) => !i.options);
    for (const end of ['min', 'max']) {
      resetTuning();
      for (const item of items) setTuning(item.path, rangeFor(item, 'extreme')[end]);
      const world = makeWorld(level());
      const n = Math.round(10 / DT);
      for (let i = 0; i < n; i++) {
        world.control.x = end === 'max' ? 1 : -1;
        world.control.z = end === 'max' ? 1 : -1;
        step(world, DT);
        const nums = [world.ball.x, world.ball.z, world.ball.vx, world.ball.vz, world.tilt.x, world.tilt.z];
        if (nums.some((v) => !Number.isFinite(v))) {
          resetTuning();
          throw new Error(`all-${end} tuning produced ${nums} at step ${i}`);
        }
      }
    }
    resetTuning();
  });

  t.ok('a value stored under an extreme range survives a round trip', () => {
    resetTuning();
    const hot = setTuning('gravity', 150);
    const json = tuningToJSON();
    resetTuning();
    const res = loadTuningJSON(json);
    if (!res.ok) throw new Error('round-trip load failed');
    if (getTuning('gravity') !== hot) throw new Error(`gravity came back as ${getTuning('gravity')}, expected ${hot}`);
    resetTuning();
  });

  t.ok('defaults match the shipped constants exactly', () => {
    if (DEFAULT_TUNING.gravity !== GRAVITY) throw new Error('gravity default drifted from constants');
    if (DEFAULT_TUNING.maxTilt !== MAX_TILT) throw new Error('maxTilt default drifted from constants');
    resetTuning();
    if (isCustomised()) throw new Error('a fresh reset should not count as customised');
  });

  t.ok('changing gravity changes how fast the marble picks up speed', () => {
    resetTuning();
    const slow = rollWith(1.5, () => ({ x: 0, z: 0.25 })).ball.x;
    setTuning('gravity', 16);
    const fast = rollWith(1.5, () => ({ x: 0, z: 0.25 })).ball.x;
    resetTuning();
    // further along the lane means a larger x (it rolls toward +x)
    if (!(fast > slow)) throw new Error(`more gravity did not mean more distance (${slow.toFixed(2)} vs ${fast.toFixed(2)})`);
  });

  t.ok('rolling drag sets the top speed, and start friction sets the break-away lean', () => {
    resetTuning();
    setTuning('surfaces.wood.drag', 0.3);
    const slick = rollWith(4, () => ({ x: 0, z: MAX_TILT }));
    const slickV = speed(slick);
    resetTuning();
    setTuning('surfaces.wood.drag', 2.5);
    const draggy = speed(rollWith(4, () => ({ x: 0, z: MAX_TILT })));
    resetTuning();
    if (!(slickV > draggy * 1.5)) throw new Error(`drag did not change terminal speed (${slickV.toFixed(2)} vs ${draggy.toFixed(2)})`);

    // start friction: a lean below the threshold must not move a parked marble
    resetTuning();
    setTuning('surfaces.wood.roll', 0.6);
    const stuck = rollWith(2, () => ({ x: 0, z: 0.05 }));
    const stuckSpeed = speed(stuck);
    resetTuning();
    if (stuckSpeed > 0.02) throw new Error(`start friction did not hold the marble (v=${stuckSpeed.toFixed(3)})`);
  });

  t.ok('max tilt and tilt rate are live', () => {
    resetTuning();
    const small = rollWith(3, () => ({ x: 0, z: 0.08 }));
    setTuning('maxTilt', 0.5);
    const big = rollWith(3, () => ({ x: 0, z: 0.5 }));
    resetTuning();
    if (!(big.ball.x > small.ball.x)) throw new Error('max tilt had no effect');

    resetTuning();
    const ramp = makeWorld(level());
    for (let i = 0; i < 5; i++) {
      ramp.control.z = 0.3;
      step(ramp, DT);
    }
    const slowTilt = ramp.tilt.z;
    setTuning('tiltRate', 8);
    const fastBoard = makeWorld(level());
    for (let i = 0; i < 5; i++) {
      fastBoard.control.z = 0.3;
      step(fastBoard, DT);
    }
    const fastTilt = fastBoard.tilt.z;
    resetTuning();
    if (!(fastTilt > slowTilt * 1.5)) throw new Error(`tilt rate had no effect (${slowTilt.toFixed(3)} vs ${fastTilt.toFixed(3)})`);
  });

  t.ok('a marble size change moves the physics, not just the picture', () => {
    resetTuning();
    setTuning('ballR', 0.42);
    const big = makeWorld(level());
    // sits against a wall: the gap left is smaller with a bigger marble
    big.ball.x = -6.5;
    big.ball.z = 4;
    big.control.x = MAX_TILT;
    for (let i = 0; i < Math.round(3 / DT); i++) step(big, DT);
    const bigZ = big.ball.z;
    resetTuning();
    const small = makeWorld(level());
    small.ball.x = -6.5;
    small.ball.z = 4;
    small.control.x = MAX_TILT;
    for (let i = 0; i < Math.round(3 / DT); i++) step(small, DT);
    resetTuning();
    if (!(bigZ < small.ball.z - 0.1)) throw new Error(`marble radius did not change the collision distance (${bigZ.toFixed(2)} vs ${small.ball.z.toFixed(2)})`);
  });

  t.ok('hole and cup grip change capture distances', () => {
    resetTuning();
    const pit = makeWorld(level()).pits[0];
    // A grazing pass: the closest approach to the pit centre is 0.30 units, which is inside
    // the greedy threshold (0.42 * 1.1 = 0.46) but outside the strict one (0.42 * 0.4 = 0.17).
    const graze = () => {
      const w = makeWorld(level());
      w.ball.x = pit.x - 1.3;
      w.ball.z = pit.z + 0.3;
      w.ball.vx = 4.5;
      for (let i = 0; i < Math.round(1.0 / DT); i++) {
        step(w, DT);
        if (w.ball.state !== 'roll') return true;
      }
      return false;
    };
    setTuning('pitCapture', 0.4);
    const strict = graze();
    resetTuning();
    setTuning('pitCapture', 1.1);
    const greedy = graze();
    resetTuning();
    if (strict) throw new Error('a graze was swallowed even with the strictest hole grip');
    if (!greedy) throw new Error('hole grip did not change capture (greedy still let the marble past)');
  });

  t.ok('JSON round-trips, and unknown keys are reported rather than swallowed', () => {
    resetTuning();
    setTuning('gravity', 7.5);
    setTuning('surfaces.wood.drag', 1.5);
    const json = tuningToJSON();
    resetTuning();
    if (isCustomised()) throw new Error('reset failed');
    const res = loadTuningJSON(json);
    if (!res.ok) throw new Error('round-trip load failed');
    if (getTuning('gravity') !== 7.5) throw new Error('gravity did not come back');
    if (getTuning('surfaces.wood.drag') !== 1.5) throw new Error('drag did not come back');
    const bad = loadTuningJSON('{"gravity": 4, "notAThing": 1}');
    if (!bad.ok || bad.unknown.length !== 1) throw new Error('unknown keys were not reported');
    const broken = loadTuningJSON('{oops');
    if (broken.ok) throw new Error('invalid JSON was accepted');
    resetTuning();
  });

  t.ok('diff and customised flags track the shipping defaults', () => {
    resetTuning();
    if (isCustomised()) throw new Error('fresh tuning is already customised');
    applyTuning({ gravity: 5, 'surfaces.wood.roll': 0.2 });
    const d = diffFromDefaults();
    if (Object.keys(d).length !== 2) throw new Error(`diff had ${Object.keys(d).length} keys, expected 2`);
    if (!isCustomised()) throw new Error('customised flag did not flip');
    resetTuning();
    if (isCustomised()) throw new Error('reset did not clear the flag');
  });

  t.ok('every preset is inside its documented ranges and actually changes something', () => {
    resetTuning();
    const base = flattenTuning();
    for (const [key, preset] of Object.entries(PRESETS)) {
      applyPreset(key);
      const now = flattenTuning();
      for (const path of Object.keys(now)) {
        const item = TUNING_SPEC.flatMap((g) => g.items).find((i) => i.path === path);
        if (now[path] < item.min || now[path] > item.max) throw new Error(`${key}: ${path}=${now[path]} is outside its range`);
      }
      if (key !== 'default') {
        const changed = Object.keys(now).filter((k) => now[k] !== base[k]).length;
        if (changed === 0) throw new Error(`preset ${key} does nothing`);
      } else if (isCustomised()) {
        throw new Error('the default preset did not restore the defaults');
      }
    }
    resetTuning();
  });

  t.ok('the level stays solvable under every feel preset', () => {
    for (const key of Object.keys(PRESETS)) {
      applyPreset(key);
      const res = solveLevel(level(), { maxSeconds: 240 });
      if (!res.ok) {
        resetTuning();
        throw new Error(`autopilot could not finish the level with the "${key}" preset (${res.reason})`);
      }
    }
    resetTuning();
  });

  t.ok('two runs under the same tuning are bit-identical', () => {
    resetTuning();
    applyTuning({ gravity: 8.3, 'surfaces.wood.drag': 1.37, maxTilt: 0.27, ballR: 0.3 });
    const script = (w) => ({ x: Math.sin(w.time * 2.7) * 0.2, z: Math.cos(w.time * 1.9) * 0.24 });
    const a = rollWith(6, script);
    const b = rollWith(6, script);
    const fa = `${a.ball.x.toFixed(9)},${a.ball.z.toFixed(9)}`;
    const fb = `${b.ball.x.toFixed(9)},${b.ball.z.toFixed(9)}`;
    resetTuning();
    if (fa !== fb) throw new Error(`tuned simulation is not deterministic: ${fa} vs ${fb}`);
  });
}
