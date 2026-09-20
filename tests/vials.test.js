//  The liquid level vials: four troughs of liquid that have to indicate angle, settle like a thin
//  liquid rather than a widget, and never touch the marble's simulation.
import { LEVELS, buildLevel } from '../src/engine/levels.js';
import {
  makeVials,
  vialProblems,
  vialVolume,
  vialCentre,
  stepVial,
  stepVials,
  resetVials,
  vialProfile,
  vialFoam,
} from '../src/engine/vials.js';
import { makeWorld, step, resetVials as resetWorldVials } from '../src/engine/physics.js';
import { barEntry, vialBarState, indicatorMode, INDICATOR_MODES } from '../src/engine/vials.js';
import { DT, MAX_TILT, VIAL_FLOOR, VIAL_FILL, BAR_LEN, INDICATOR_FULL_ANGLE } from '../src/engine/constants.js';
import { TUNING, setTuning, resetTuning } from '../src/engine/tuning.js';

export const name = 'vials';

const L1 = buildLevel(LEVELS[0]);

/** Run one trough for `seconds` at a fixed tilt, returning the surface trace over time. */
function run(vial, tilt, seconds, sample = 0.05) {
  const trace = [];
  const steps = Math.round(seconds / DT);
  const every = Math.max(1, Math.round(sample / DT));
  for (let i = 0; i < steps; i++) {
    stepVial(vial, tilt, DT);
    if (i % every === 0) trace.push(vial.surface);
  }
  return trace;
}

const final = (trace) => trace[trace.length - 1];

export function tests(t) {
  t.ok('every level gets four troughs, one per side, with liquid in them', () => {
    for (const spec of LEVELS) {
      const level = buildLevel(spec);
      const problems = vialProblems(level);
      if (problems.length) throw new Error(`${spec.id}: ${problems.join('; ')}`);
      const vials = makeVials(level);
      if (vials.length !== 4) throw new Error(`${spec.id}: ${vials.length} troughs`);
      for (const v of vials) {
        if (Math.abs(v.rest - VIAL_FILL * VIAL_FLOOR) > 1e-9) throw new Error(`${v.id} is not filled to VIAL_FILL`);
      }
    }
  });

  t.ok('the liquid is conserved exactly, including through splashes', () => {
    for (const splash of [0, 0.3, 0.9]) {
      setTuning('vialSplash', splash);
      const vial = makeVials(L1)[0];
      const v0 = vialVolume(vial);
      // A hard, fast tilt sequence: the worst case for a scheme that removes volume.
      for (let i = 0; i < 900; i++) {
        const tilt = Math.sin(i * 0.03) * MAX_TILT;
        stepVial(vial, { x: tilt, z: tilt * 0.4 }, DT);
      }
      const v1 = vialVolume(vial);
        if (Math.abs(v1 - v0) > 1e-6) throw new Error(`splash ${splash}: volume drifted from ${v0} to ${v1}`);
    }
    resetTuning();
  });

  t.ok('the liquid stays inside the trough: never negative, never above the brim, never NaN', () => {
    const vial = makeVials(L1)[0];
    for (let i = 0; i < 1200; i++) {
      const tilt = Math.sin(i * 0.05) * MAX_TILT;
      stepVial(vial, { x: tilt, z: 0 }, DT);
      for (const h of vial.h) {
        if (!Number.isFinite(h)) throw new Error('a cell went non-finite');
        if (h < 0) throw new Error(`a cell went negative (${h})`);
        if (h > VIAL_FLOOR + 1e-9) throw new Error(`a cell overflowed the trough (${h} > ${VIAL_FLOOR})`);
      }
    }
  });

  t.ok('a level board leaves the liquid alone and level', () => {
    const vial = makeVials(L1)[0];
    const trace = run(vial, { x: 0, z: 0 }, 4);
    if (Math.abs(final(trace)) > 1e-6) throw new Error(`the liquid drifted to ${final(trace)} on a level board`);
    const profile = vialProfile(vial);
    if (profile.some((p) => Math.abs(p) > 1e-9)) throw new Error('the surface is not flat on a level board');
  });

  t.ok('a tilted board sends the liquid to the low end, and it gets there quickly', () => {
    // A tilt about Z is the board's +x side going *down* (that is the direction the marble is
    // pulled), so the liquid runs toward +x, the `to` end of the trough, and the surface reads
    // positive.
    const vial = makeVials(L1).find((v) => v.axis === 'x');
    const trace = run(vial, { x: 0, z: 0.16 }, 3);
    for (const [i, s] of trace.entries()) {
      if (i > 40 && s < 0.5) throw new Error(`the liquid was still not halfway after ${(i * 0.05).toFixed(1)}s (${s.toFixed(2)})`);
    }
    if (final(trace) < 0.8) throw new Error(`the liquid settled at ${final(trace)}, not against the low end`);
    // and the sign has to follow the tilt, not be a coin flip
    const flipped = makeVials(L1).find((v) => v.axis === 'x');
    run(flipped, { x: 0, z: -0.16 }, 3);
    if (flipped.surface > -0.8) throw new Error(`tilting the other way left the liquid at ${flipped.surface}`);
  });

  t.ok('the two troughs on an axis agree, and the other axis is unmoved', () => {
    const vials = makeVials(L1);
    const byAxis = (a) => vials.filter((v) => v.axis === a);
    const xv = byAxis('x');
    const zv = byAxis('z');
    for (let i = 0; i < 600; i++) stepVials(vials, { x: 0, z: 0.16 }, DT);
    // A tilt about Z moves liquid along x only.
    if (Math.abs(xv[0].surface - xv[1].surface) > 1e-9) throw new Error('the two x troughs disagree about the tilt');
    if (xv[0].surface < 0.8) throw new Error('the x troughs did not reach the low end');
    for (const v of zv) {
      if (Math.abs(v.surface) > 1e-6) throw new Error(`${v.id} moved although the board only tilted about Z`);
    }
  });

  t.ok('it is a liquid, not a widget: it overshoots the far end before settling', () => {
    // "Low viscosity" still has to mean *liquid*: a thin liquid runs past the level position well
    // down the trough and comes back, rather than sliding to rest.
    const vial = makeVials(L1).find((v) => v.axis === 'x');
    const trace = run(vial, { x: 0, z: 0.16 }, 3, 0.02);
    const deepest = Math.max(...trace);
    if (deepest < 0.85) throw new Error(`it never reached the end (${deepest.toFixed(2)})`);
    if (deepest > 1.01) throw new Error(`it left the trough (${deepest.toFixed(2)})`);
    // and it settles a little short of where it peaked, i.e. it came back slightly
    const settle = trace.slice(-5).reduce((a, b) => a + b, 0) / 5;
    if (!(settle < deepest - 1e-4)) throw new Error(`it never came back off the end (settled ${settle.toFixed(3)} vs peak ${deepest.toFixed(3)})`);
    // and it wobbles on the way: the surface reverses direction at least once
    let reversals = 0;
    for (let i = 2; i < trace.length; i++) {
      const a = trace[i - 1] - trace[i - 2];
      const b = trace[i] - trace[i - 1];
      if (a * b < 0) reversals++;
    }
    if (reversals < 1) throw new Error('the surface never reversed: it slides instead of sloshing');
  });

  t.ok('the surface ripples internally on its way, it does not slide as one block', () => {
    // "Internal dynamics": the liquid must not move like a solid slug. While it is travelling,
    // the surface has to be genuinely uneven - some cells ahead of others.
    const vial = makeVials(L1).find((v) => v.axis === 'x');
    let worst = 0;
    for (let i = 0; i < 200; i++) {
      stepVial(vial, { x: 0, z: 0.16 }, DT);
      const p = vialProfile(vial);
      for (let k = 1; k < p.length; k++) worst = Math.max(worst, Math.abs(p[k] - p[k - 1]));
    }
    if (!(worst > 1e-4)) throw new Error(`the surface stayed flat while travelling (${worst})`);
  });

  t.ok('viscosity is the control that decides how fast the liquid answers', () => {
    // How long until half the liquid has moved to the low end.
    const arrive = (visc) => {
      resetTuning();
      setTuning('vialViscosity', visc);
      const vial = makeVials(L1).find((v) => v.axis === 'x');
      for (let i = 0; i < Math.round(6 / DT); i++) {
        stepVial(vial, { x: 0, z: 0.16 }, DT);
        if (vial.surface > 0.5) return i * DT;
      }
      return Infinity;
    };
    const thin = arrive(0);
    const thick = arrive(0.5);
    resetTuning();
    if (!(thick > thin)) throw new Error(`thick liquid answered no slower than thin (${thick} vs ${thin})`);
  });

  t.ok('the liquid arriving at an end overshoots and eases back, rather than stopping dead', () => {
    // The ends are walls, so the liquid that runs into one piles up and pushes back: the surface
    // must go *past* where it finally settles. It is a small rebound on purpose - a shallow seat
    // means a slow arrival - but it is the difference between a liquid and a slider.
    resetTuning();
    setTuning('vialViscosity', 0.06);
    const vial = makeVials(L1).find((v) => v.axis === 'x');
    for (let i = 0; i < Math.round(3 / DT); i++) stepVial(vial, { x: 0, z: 0.18 }, DT); // pile at the + end
    const trace = [];
    for (let i = 0; i < Math.round(4 / DT); i++) {
      stepVial(vial, { x: 0, z: -0.18 }, DT); // drive it the other way, into the far end cap
      trace.push(vial.surface);
    }
    resetTuning();
    const lowest = Math.min(...trace);
    const settle = trace.slice(-20).reduce((a, b) => a + b, 0) / 20;
    if (!(lowest < -0.75)) throw new Error(`it never reached the far end (${lowest.toFixed(3)})`);
    if (!(settle > lowest + 1e-4)) throw new Error('it stopped dead at the end instead of easing back');
    let turns = 0;
    for (let i = 2; i < trace.length; i++) {
      const a = trace[i - 1] - trace[i - 2];
      const b = trace[i] - trace[i - 1];
      if (a * b < 0) turns++;
    }
    if (turns < 1) throw new Error('the surface never reversed on arrival');
  });

  t.ok('the splash control scales the froth where the liquid arrives', () => {
    const froth = (splash) => {
      resetTuning();
      setTuning('vialSplash', splash);
      const vial = makeVials(L1).find((v) => v.axis === 'x');
      let peak = 0;
      for (let i = 0; i < Math.round(8 / DT); i++) {
        const t = i * DT;
        stepVial(vial, { x: 0, z: 0.16 * Math.sin(t * 2 * Math.PI * 0.5) }, DT);
        for (let c = 0; c < vial.cells; c++) peak = Math.max(peak, vialFoam(vial, c));
      }
      return peak;
    };
    const dry = froth(0);
    const wet = froth(0.95);
    resetTuning();
    if (!(wet > dry * 1.5)) throw new Error(`splashback barely changed the froth (${dry.toFixed(3)} vs ${wet.toFixed(3)})`);
    if (!(dry > 0)) throw new Error('the liquid never froths at all');
  });

  t.ok('the fill control really changes how much liquid is in the troughs', () => {
    const vial = makeVials(L1)[0];
    const v0 = vialVolume(vial);
    setTuning('vialFill', 0.85);
    stepVial(vial, { x: 0, z: 0 }, DT);
    const v1 = vialVolume(vial);
    setTuning('vialFill', 0.3);
    stepVial(vial, { x: 0, z: 0 }, DT);
    const v2 = vialVolume(vial);
    resetTuning();
    if (!(v1 > v0 && v2 < v0)) throw new Error(`fill did not change the volume (${v0} / ${v1} / ${v2})`);
    // and the troughs still hold their liquid after the change
    for (const h of vial.h) if (h < 0 || h > VIAL_FLOOR) throw new Error('a refill escaped the trough');
  });

  t.ok('the same inputs give the same liquid, every time', () => {
    const once = () => {
      resetTuning();
      const vial = makeVials(L1)[0];
      for (let i = 0; i < 400; i++) stepVial(vial, { x: Math.sin(i * 0.04) * 0.2, z: Math.cos(i * 0.03) * 0.2 }, DT);
      return vial.h.join(',');
    };
    const a = once();
    const b = once();
    resetTuning();
    if (a !== b) throw new Error('two identical runs differ');
  });

  t.ok('the marble cannot feel the liquid', () => {
    // One-way coupling, asserted: the same level, rolled with the vials at rest and with them
    // mid-slosh, must produce bit-identical marble positions.
    const trail = (splash) => {
      resetTuning();
      setTuning('vialSplash', splash);
      const world = makeWorld(L1);
      world.control.z = MAX_TILT;
      const out = [];
      for (let i = 0; i < 400; i++) {
        step(world, DT);
        out.push(`${world.ball.x.toFixed(9)},${world.ball.z.toFixed(9)}`);
      }
      return out.join(';');
    };
    const dumb = trail(0);
    const lively = trail(0.9);
    resetTuning();
    if (dumb !== lively) throw new Error('the marble moved differently depending on the liquid');
  });

  t.ok('resetting the world puts the liquid back to rest', () => {
    const world = makeWorld(L1);
    world.control.z = MAX_TILT;
    for (let i = 0; i < 300; i++) step(world, DT);
    if (Math.abs(world.vials[0].surface) < 0.05) throw new Error('the liquid never moved, so this proves nothing');
    resetWorldVials(world);
    for (const v of world.vials) {
      if (Math.abs(v.surface) > 1e-9) throw new Error(`${v.id} did not return to level`);
      if (v.u.some((f) => f !== 0)) throw new Error(`${v.id} still has flow in it`);
    }
  });

  t.ok('the bars read the angle instantly - there is nothing to settle', () => {
    // The whole difference between the two indicators: after one step at full tilt the bar is
    // already at the end of its travel, while the liquid has barely moved. If this ever stops being
    // true, "instant" has quietly become a slower indicator.
    const vials = makeVials(L1);
    // A tilt about Z is read by the two x-axis troughs; the other two must stay put.
    for (const v of vials) {
      const f = barEntry(v, { x: 0, z: MAX_TILT }).frac;
      const want = v.axis === 'x' ? 1 : 0;
      if (Math.abs(f - want) > 1e-9) throw new Error(`the ${v.id} bar read ${f}, wanted ${want}`);
    }
    const liquid = makeVials(L1).find((v) => v.axis === 'x');
    stepVial(liquid, { x: 0, z: MAX_TILT }, DT);
    if (Math.abs(liquid.surface) > 0.02) throw new Error('the liquid apparently moves instantly too, so this proves nothing');
  });

  t.ok('a bar is at the end of its travel exactly at the toy\'s hard stop, and clamped there', () => {
    const vial = makeVials(L1).find((v) => v.axis === 'x');
    const atStop = barEntry(vial, { x: 0, z: INDICATOR_FULL_ANGLE });
    if (Math.abs(atStop.frac - 1) > 1e-6) throw new Error(`full scale is not the hard stop (${atStop.frac})`);
    const beyond = barEntry(vial, { x: 0, z: INDICATOR_FULL_ANGLE * 3 });
    if (beyond.frac !== 1) throw new Error(`a bar ran past the end of its travel (${beyond.frac})`);
    const centre = barEntry(vial, { x: 0, z: 0 });
    if (Math.abs(centre.centre - (vial.from + vial.to) / 2) > 1e-9) throw new Error('a level board does not centre the bar');
  });

  t.ok('bar travel is monotone in the tilt, and turns round with it', () => {
    const vial = makeVials(L1).find((v) => v.axis === 'x');
    let last = -2;
    for (let d = -16; d <= 16; d += 2) {
      const f = barEntry(vial, { x: 0, z: (d * Math.PI) / 180 }).frac;
      if (!(f > last)) throw new Error(`the bar went backwards at ${d} degrees (${f} after ${last})`);
      last = f;
    }
    if (Math.abs(barEntry(vial, { x: 0, z: 0.1 }).frac + barEntry(vial, { x: 0, z: -0.1 }).frac) > 1e-9) {
      throw new Error('the bar does not treat the two directions symmetrically');
    }
  });

  t.ok('every bar is the same length, and the two troughs on an axis agree', () => {
    const vials = makeVials(L1);
    const lens = new Set(vials.map((v) => barEntry(v, { x: 0.1, z: 0.1 }).length));
    if (lens.size !== 1) throw new Error(`the bars differ in length: ${[...lens].join(', ')}`);
    if ([...lens][0] !== BAR_LEN) throw new Error('the bars are not the length the constants ask for');
    const state = vialBarState(vials, { x: 0, z: 0.2 });
    if (Math.abs(state.far.frac - state.near.frac) > 1e-12) throw new Error('the two troughs on the x axis disagree');
    if (state.left.frac !== 0 || state.right.frac !== 0) throw new Error('a tilt about z moved the z-axis bars');
  });

  t.ok('the bars owe nothing to the liquid - they are placed from the tilt alone', () => {
    // Two worlds: one with the liquid still, one mid-slosh. The bars must be identical.
    const vials = makeVials(L1);
    for (let i = 0; i < 300; i++) stepVials(vials, { x: 0, z: 0.2 }, DT);
    const sloshed = vialBarState(vials, { x: 0, z: 0.2 });
    const fresh = vialBarState(makeVials(L1), { x: 0, z: 0.2 });
    for (const id of Object.keys(sloshed)) {
      if (sloshed[id].centre !== fresh[id].centre) throw new Error(`the ${id} bar depends on the liquid's state`);
    }
  });

  t.ok('only the indicator modes the renderer knows are accepted', () => {
    for (const m of INDICATOR_MODES) if (indicatorMode(m) !== m) throw new Error(`${m} was rejected`);
    if (indicatorMode('nonsense') !== 'bars') throw new Error('an unknown mode should fall back to the default');
  });

  t.ok('the liquid keeps flowing while the marble is out of play', () => {
    // A vial that froze the moment the marble fell into a pit would freeze exactly when the
    // player is watching the board rock on its way to a restart.
    const world = makeWorld(L1);
    world.ball.state = 'falling';
    world.ball.vy = -1;
    world.control.z = MAX_TILT;
    for (let i = 0; i < 200; i++) step(world, DT);
    if (Math.abs(world.vials[0].surface) < 0.05) throw new Error('the vials stopped when the marble fell');
  });
}
