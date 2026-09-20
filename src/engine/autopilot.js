//  Tilt autopilot.
//
//  A pure-pursuit controller that works the board the way a hand does: it may only set
//  tilt, never the marble's position. It exists twice over —
//    1. tests/solver.test.js drives it headlessly to prove a level is completable by
//       tilting alone, with no falls;
//    2. the game's "Watch a run" button replays it in front of the player.
//
//  Everything here is deterministic: no RNG, no wall-clock, only world.time.

import { MAX_TILT, DT } from './constants.js';
import { worldToCell, waypoints, isWalkable } from './pathfind.js';
import { makeWorld, step, resetBall } from './physics.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * The marble the autopilot is currently steering.
 *
 * A multi-marble level is finished one marble at a time by the same hand: the pilot works the
 * marble still in play, and once it is in the cup the board carries the next one toward the goal.
 * `world.ball` is exactly that marble (the first still rolling), which is why the pilot needs no
 * separate notion of "which marble".
 */
const activeBall = (world) => world.ball;

export function makePilot(world, opts = {}) {
  return {
    world,
    target: opts.targetSpeed ?? 1.35,
    kp: opts.kp ?? 0.42,
    lookahead: opts.lookahead ?? 1.15,
    replanEvery: opts.replanEvery ?? 0.3,
    path: null,
    index: 0,
    sincePlan: 0,
    stuckFor: 0,
    lastCell: null,
    wobble: 0,
    vTarget: opts.targetSpeed ?? 1.35,
    trace: [],
    maxTime: opts.maxTime ?? 120,
  };
}

export function plan(pilot) {
  const w = pilot.world;
  const ball = activeBall(w);
  const from = worldToCell(w.level, ball.x, ball.z);
  if (!isWalkable(w.level, from[0], from[1])) {
    // Nudge out of a wall cell by looking at the neighbouring walkable cell we are closest to.
    let best = null;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const c = from[0] + dc;
        const r = from[1] + dr;
        if (!isWalkable(w.level, c, r)) continue;
        const d = Math.hypot(c + 0.5 - w.w / 2 - ball.x, r + 0.5 - w.h / 2 - ball.z);
        if (!best || d < best.d) best = { c, r, d };
      }
    }
    if (!best) return false;
    pilot.from = [best.c, best.r];
  } else {
    pilot.from = from;
  }
  const pts = waypoints(w.level, pilot.from, w.level.goal.cell);
  if (!pts) return false;
  pilot.path = pts;
  pilot.index = 0;
  pilot.sincePlan = 0;
  return true;
}

function currentTarget(pilot) {
  const w = pilot.world;
  const pts = pilot.path;
  if (!pts) return null;
  const ball = activeBall(w);
  let i = pilot.index;
  // pure pursuit: advance past waypoints we are already close to
  while (i < pts.length - 1) {
    const d = Math.hypot(pts[i][0] - ball.x, pts[i][1] - ball.z);
    if (d < pilot.lookahead) i++;
    else break;
  }
  pilot.index = i;
  return pts[i];
}

/** One control tick. Returns the tilt target it wants. */
export function pilotControl(pilot) {
  const w = pilot.world;
  const wp = currentTarget(pilot);
  const ball = activeBall(w);
  if (!wp) return { x: 0, z: 0 };
  const dx = wp[0] - ball.x;
  const dz = wp[1] - ball.z;
  const dist = Math.hypot(dx, dz) || 1;
  // Ease down near the aim point so we do not slosh past it.
  const want = Math.min(pilot.target, dist * 1.8 + 0.15);
  let desX = (dx / dist) * want;
  let desZ = (dz / dist) * want;

  // Stuck recovery: wriggle in a slow deterministic circle to break free of a corner.
  if (pilot.stuckFor > 0.7) {
    const a = w.time * 5.2;
    desX += Math.cos(a) * 0.9;
    desZ += Math.sin(a) * 0.9;
  }

  return {
    z: clamp(pilot.kp * (desX - ball.vx), -MAX_TILT, MAX_TILT),
    x: clamp(pilot.kp * (desZ - ball.vz), -MAX_TILT, MAX_TILT),
  };
}

/** Advance the world by `seconds` of simulated time using the autopilot. */
export function pilotRun(pilot, seconds, onStep) {
  const w = pilot.world;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const ball = activeBall(w);
    if (!ball || ball.state === 'dead') return { ok: false, reason: 'fell', world: w };
    if (!pilot.path || pilot.sincePlan <= 0 || pilot.ball !== ball) {
      // A fresh marble (its predecessor just reached the cup) needs its own route.
      pilot.ball = ball;
      pilot.index = 0;
      plan(pilot);
    }
    const cell = worldToCell(w.level, ball.x, ball.z);
    if (!pilot.lastCell || pilot.lastCell[0] !== cell[0] || pilot.lastCell[1] !== cell[1]) {
      pilot.lastCell = cell;
      plan(pilot);
    }
    const c = pilotControl(pilot);
    w.control.x = c.x;
    w.control.z = c.z;
    const before = Math.hypot(ball.vx, ball.vz);
    step(w, DT);
    pilot.sincePlan -= DT;
    if (before < 0.16) pilot.stuckFor += DT;
    else pilot.stuckFor = 0;
    pilot.trace.push([ball.x, ball.z]);
    if (onStep && onStep(w, pilot) === false) return { ok: false, reason: 'stopped' };
    if (w.status === 'won') return { ok: true, time: w.time, falls: w.falls, world: w };
    if (ball.state === 'dead') return { ok: false, reason: 'fell', world: w };
  }
  return { ok: false, reason: 'timeout', world: w };
}

/** Convenience for tests: run a whole level from a clean start. */
export function solveLevel(level, opts = {}) {
  const world = makeWorld(level);
  const pilot = makePilot(world, opts);
  plan(pilot);
  const res = pilotRun(pilot, opts.maxSeconds ?? 150);
  return { ...res, world, pilot };
}

export function resetPilot(pilot) {
  resetBall(pilot.world);
  pilot.path = null;
  pilot.index = 0;
  pilot.stuckFor = 0;
  pilot.lastCell = null;
  pilot.trace.length = 0;
  plan(pilot);
}
