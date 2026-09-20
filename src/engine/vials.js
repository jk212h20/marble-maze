//  Liquid level vials: four long troughs, one along each side of the board, filled with a thin
//  liquid so the player can read the tilt from any angle.
//
//  Why they are simulated rather than animated: the whole point of a level vial is that the
//  *liquid* stays level while the trough tilts. A decoration whose surface kept its surface
//  parallel to the trough would read as a painted stripe, and a decoration that snapped instantly
//  to the low end would read as a widget. So the liquid is a real, if small, simulation: the
//  surface tilts immediately, the liquid then *runs* to the low end, overshoots, sloshes and
//  settles - which is what a hand-tilted toy does.
//
//  The model is 1D shallow water on a staggered grid: velocity at the faces between cells, depth
//  at the cells. Momentum gets the pressure gradient of the depth plus the along-axis component of
//  gravity; depth is then advected by an upwind flux, which conserves volume exactly by
//  construction. That is the cheapest thing that shows the three behaviours wanted here:
//  transport (it runs to the low end), internal waves (it sloshes and settles), and reflection (a
//  wave reaching an end cap comes back).
//
//  Scale note: board units are about 3 cm, so these troughs are ~40 cm long with ~5 mm of liquid.
//  The resulting slosh takes a second or two to run the length of a trough and a couple of seconds
//  to settle, which is what a real spirit level of that size does - slow enough to watch, fast
//  enough to follow a hand.
//
//  Determinism: stepped from the fixed physics tick (never from wall-clock time or frame rate),
//  with the board's tilt as its only input. The coupling is one-way as well: nothing in the
//  marble's simulation reads any of this, so playability cannot depend on how the liquid happens
//  to be sloshing.

import { TUNING } from './tuning.js';
import {
  LID_BEZEL,
  VIAL_CELLS,
  VIAL_FILL,
  VIAL_WIDTH,
  VIAL_CORNER,
  VIAL_FLOOR,
  WALL_H,
  BAR_LEN,
  INDICATOR_FULL_ANGLE,
} from './constants.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Where the four troughs sit, in board coordinates.
 *
 * They live in the metal collar that clamps the glass - outside the playfield, so a vial can
 * never cover a hole or catch the marble - and run the length of each side between the corner
 * fixings. Deriving them from the level's own footprint means a new shape gets troughs that
 * follow it rather than a hard-coded rectangle from level one.
 */
export function vialLayout(level) {
  const x0 = -level.w / 2;
  const x1 = level.w / 2;
  const z0 = -level.h / 2;
  const z1 = level.h / 2;
  // Centred in the exposed ledge of the collar: inboard of the lip, outboard of the glass.
  const inset = LID_BEZEL - VIAL_WIDTH / 2 - 0.02;
  const xs = [x0 + VIAL_CORNER, x1 - VIAL_CORNER];
  const zs = [z0 + VIAL_CORNER, z1 - VIAL_CORNER];
  return [
    { id: 'far', axis: 'x', at: z0 + inset, side: -1, from: xs[0], to: xs[1] },
    { id: 'near', axis: 'x', at: z1 - inset, side: 1, from: xs[0], to: xs[1] },
    { id: 'left', axis: 'z', at: x0 + inset, side: -1, from: zs[0], to: zs[1] },
    { id: 'right', axis: 'z', at: x1 - inset, side: 1, from: zs[0], to: zs[1] },
  ];
}

/** One trough: its geometry, and the liquid state (cell depths and face velocities). */
export function makeVial(spec, { fill = VIAL_FILL } = {}) {
  const cells = VIAL_CELLS;
  const length = spec.to - spec.from;
  const dx = length / cells;
  const rest = fill * VIAL_FLOOR;
  return {
    id: spec.id,
    axis: spec.axis,
    side: spec.side,
    at: spec.at,
    from: spec.from,
    to: spec.to,
    length,
    dx,
    cells,
    fill,
    rest,
    h: new Array(cells).fill(rest), // depth of liquid in each cell
    u: new Array(cells + 1).fill(0), // velocity at each face; the two end faces are walls
    tilt: 0, // last along-axis gravity, kept for the renderer and the tests
    surface: 0, // where the liquid's centre of mass sits, -1 (from end) .. +1 (to end)
    time: 0,
  };
}

export function makeVials(level, opts = {}) {
  return vialLayout(level).map((spec) => makeVial(spec, opts));
}

/** Total liquid, which the simulation must conserve exactly. */
export function vialVolume(vial) {
  let v = 0;
  for (let i = 0; i < vial.cells; i++) v += vial.h[i];
  return v;
}

/** Centre of mass along the trough, normalised: -1 at `from`, +1 at `to`. */
export function vialCentre(vial) {
  let m = 0;
  let v = 0;
  for (let i = 0; i < vial.cells; i++) {
    m += vial.h[i] * (i + 0.5);
    v += vial.h[i];
  }
  return v > 1e-9 ? (2 * (m / v)) / vial.cells - 1 : 0;
}

/**
 * Advance one trough by `dt`, given the board's tilt about each axis (radians).
 *
 * The body force along the trough is the component of gravity the board's slope produces: a tilt
 * about X pushes liquid along z, a tilt about Z pushes it along x. The free surface settles at a
 * slope of (`force` / `g`) across the trough, which *is* a level surface in world space - the
 * whole reason the thing indicates angle.
 */
export function stepVial(vial, tilt, dt) {
  const g = TUNING.gravity;
  const viscosity = clamp(TUNING.vialViscosity, 0, 1);
  const splash = clamp(TUNING.vialSplash, 0, 0.98);

  // The fill level is tunable, so honour a change by topping the troughs up (or drawing some off)
  // in proportion: the slosh already in progress is kept rather than thrown away.
  const wantRest = clamp(TUNING.vialFill ?? vial.fill, 0.05, 0.95) * VIAL_FLOOR;
  if (Math.abs(wantRest - vial.rest) > 1e-6) {
    const k = wantRest / vial.rest;
    for (let i = 0; i < vial.cells; i++) vial.h[i] *= k;
    vial.rest = wantRest;
    vial.fill = wantRest / VIAL_FLOOR;
  }

  // The liquid is allowed its own gravity. At the marble's own (deliberately slow) timescale the
  // liquid would take ~3 s to run the length of a trough, which reads as sluggish for something
  // whose whole job is to say "you are tilted" - so `vialResponse` scales the gravity the *liquid*
  // feels. Everything else about the model stays physical: the same equations, just a faster clock.
  const gl = g * clamp(TUNING.vialResponse ?? 1, 0.1, 40);

  // Along-axis gravity: positive pushes liquid toward increasing cell index.
  const along = vial.axis === 'x' ? gl * Math.sin(tilt.z) : gl * Math.sin(tilt.x);
  vial.tilt = along;
  vial.time += dt;

  const cells = vial.cells;
  const h = vial.h;
  const u = vial.u;
  const dx = vial.dx;

  // Momentum at the interior faces: pressure gradient plus the along-axis body force. Viscosity
  // is a plain drag on that velocity, which is what makes the slosh die out instead of ringing
  // forever.
  const drag = Math.max(0, 1 - viscosity * dt * 4);
  for (let i = 1; i < cells; i++) {
    const dh = (h[i] - h[i - 1]) / dx;
    // +along, not -along: a positive along-axis gravity pushes liquid toward increasing index, so
    // the surface ends up *higher* there. Getting this backwards made both troughs on an axis
    // report the tilt the wrong way round.
    u[i] += dt * (-gl * dh + along);
    u[i] *= drag;
    // CFL guard: with the limit below, no cell can be emptied in one step even if the tuner asks
    // for something extreme.
    const cap = (0.85 * dx) / dt;
    if (u[i] > cap) u[i] = cap;
    else if (u[i] < -cap) u[i] = -cap;
  }

  // End caps. An arriving wave turns round; `splash` is how much of it survives the turn - at 1
  // the end is a hard wall and the wave comes back at full height, at 0 the arrival is swallowed
  // and the liquid simply piles up against the end. Only *arriving* flow is touched, so this is a
  // reflection control rather than a general brake.
  const wallTurn = splash;
  if (u[1] < 0) u[1] *= wallTurn;
  if (u[cells - 1] > 0) u[cells - 1] *= wallTurn;
  u[0] = 0;
  u[cells] = 0;

  // Advect. Continuity is dh/dt = -d(uh)/dx, so a face carrying velocity v across a cell of
  // width dx hands over the fraction (v*dt/dx) of its donor cell's depth. Leaving out that
  // division made the transport dx times too weak - the liquid crept instead of running.
  for (let i = 1; i < cells; i++) {
    const v = u[i];
    if (v === 0) continue;
    const depth = v > 0 ? h[i - 1] : h[i];
    const frac = Math.min((v * dt) / dx, 1); // CFL: never hand over more than the cell holds
    const move = frac * depth;
    h[i - 1] -= move;
    h[i] += move;
  }
  // Bounds. A cell cannot go negative (the upwind flux already prevents it, this is the belt), and
  // it cannot stand above the brim - but the brim clamp *spills* rather than deletes: a fast wave
  // can momentarily heap a cell over the top, and the liquid it displaces has to go somewhere down
  // the channel, not vanish. Deleting that excess was quietly losing 5% of the liquid in the
  // shallow trough.
  for (let i = 0; i < cells; i++) {
    if (h[i] < 0) h[i] = 0;
    let excess = h[i] - VIAL_FLOOR;
    if (excess <= 0) continue;
    h[i] = VIAL_FLOOR;
    // Push it to whichever neighbour has more room; if neither has any, the trough is genuinely
    // full and the excess stays put rather than being invented or destroyed.
    const a = i > 0 ? i - 1 : i + 1;
    const b = i < cells - 1 ? i + 1 : i - 1;
    const roomA = VIAL_FLOOR - h[a];
    const roomB = VIAL_FLOOR - h[b];
    const target = roomA >= roomB ? a : b;
    const room = Math.max(0, Math.max(roomA, roomB));
    const moved = Math.min(excess, room);
    h[target] += moved;
    h[i] += excess - moved; // whatever will not fit stays: mass is never destroyed
  }

  vial.surface = vialCentre(vial);
}

export function stepVials(vials, tilt, dt) {
  for (const vial of vials) stepVial(vial, tilt, dt);
}

export function resetVials(vials) {
  for (const vial of vials) {
    for (let i = 0; i < vial.cells; i++) vial.h[i] = vial.rest;
    vial.u.fill(0);
    vial.tilt = 0;
    vial.surface = 0;
  }
}

/** The liquid's free-surface profile, relative to its rest level, as the renderer needs it. */
export function vialProfile(vial) {
  const out = [];
  for (let i = 0; i < vial.cells; i++) out.push(Math.max(0, vial.h[i]) - vial.rest);
  return out;
}

/**
 * How much this stretch of the liquid is frothing, 0..1.
 *
 * The simulation's splashback is physical and fixed: the ends of a trough are walls, so a wave that
 * reaches one comes back. What `vialSplash` controls is the *visible* splash - how much the arriving
 * liquid froths at the end caps. Measured in the simulation, the arrival itself is too gentle for a
 * slider to change it honestly (a shallow seat means a slow arrival), so rather than ship a knob that
 * does nothing, this one drives the froth, and the hint says so.
 */
export function vialFoam(vial, i) {
  const cell = Math.max(0, Math.min(vial.cells - 1, i));
  // The face on either side of the cell: the fastest flow touching it.
  const a = Math.abs(vial.u[cell] ?? 0);
  const b = Math.abs(vial.u[Math.min(vial.u.length - 1, cell + 1)] ?? 0);
  const flow = Math.max(a, b);
  const splash = clamp(TUNING.vialSplash ?? 0, 0, 0.95);
  return Math.min(1, (flow / 3) * (0.35 + splash * 1.3));
}

/**
 * The instant indicator: where each bar sits along its trough, straight from the board's tilt.
 *
 * This is the whole model - no state, no time, no integration. The position is recomputed from the
 * tilt every frame, so the bar *is* the angle: tilt the board and the bar is already there in the
 * same frame, with no lag, no overshoot and nothing to settle. It is deliberately the opposite of
 * the liquid, and having both as options is the point: one is exact and instant, the other is alive.
 *
 * `frac` runs -1 (against the `from` end) to +1 (hard against the `to` end), reaching full travel
 * at INDICATOR_FULL_ANGLE - the toy's own hard stop, so "bar at the end" always means "board at the
 * stop" rather than some invented number.
 */
export function barEntry(vial, tilt) {
  const full = Math.sin(INDICATOR_FULL_ANGLE);
  // The same along-axis gravity the liquid feels, normalised: a tilt about Z pushes toward +x.
  const along = vial.axis === 'x' ? Math.sin(tilt.z) : Math.sin(tilt.x);
  const frac = clamp(full > 1e-6 ? along / full : 0, -1, 1);
  // Travel: the bar runs the full length of the channel, stopping short of the end caps, so its
  // *position* carries the reading. Every bar is the same length (BAR_LEN) whichever trough it is
  // in, so the four read as one scale.
  const travel = Math.max(0, vial.length / 2 - BAR_LEN / 2 - 0.05);
  const centre = (vial.from + vial.to) / 2 + frac * travel;
  return { frac, centre, length: BAR_LEN, travel };
}

export function vialBarState(vials, tilt) {
  const out = {};
  for (const vial of vials) out[vial.id] = barEntry(vial, tilt);
  return out;
}

/** The indicator mode, clamped to the modes the renderer knows. */
export function indicatorMode(value) {
  return INDICATOR_MODES.includes(value) ? value : 'bars';
}

export const INDICATOR_MODES = ['bars', 'liquid', 'both', 'off'];

/** Anything a vial should not do. Empty means they are clean. */
export function vialProblems(level, vials = makeVials(level)) {
  const problems = [];
  if (vials.length !== 4) problems.push(`expected 4 troughs, got ${vials.length}`);
  for (const v of vials) {
    if (!(v.length > 2)) problems.push(`${v.id} trough is too short to level anything (${v.length.toFixed(2)})`);
    if (!(v.rest > 0)) problems.push(`${v.id} trough has no liquid in it`);
    if (v.rest > VIAL_FLOOR * 0.95) problems.push(`${v.id} trough is filled past its brim`);
    if (v.from >= v.to) problems.push(`${v.id} trough runs backwards`);
    // A trough is a lid feature in the collar, so it has to fit inside it.
    if (VIAL_WIDTH >= LID_BEZEL) problems.push('the trough is wider than the collar it is cut into');
    if (VIAL_FLOOR >= WALL_H) problems.push('the trough is deeper than the collar is tall');
  }
  // The two troughs on an axis must agree about the direction the liquid runs, or the two sides
  // of the board would report opposite tilts.
  for (const axis of ['x', 'z']) {
    const pair = vials.filter((v) => v.axis === axis);
    if (pair.length === 2 && Math.abs(pair[0].from - pair[1].from) > 1e-9) {
      problems.push(`the two ${axis} troughs do not line up`);
    }
  }
  return problems;
}
