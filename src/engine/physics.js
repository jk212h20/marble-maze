//  Marble physics.
//
//  The marble is simulated in *board space*: a 2D plane (x, z) that the board itself
//  tilts. That keeps the simulation exactly deterministic and testable in node, and it
//  matches how the real toy behaves — a heavy glass ball rolling on a wooden board,
//  with tilt as the only input.
//
//  Board space mapping: x = right, z = toward the near edge. Grid cell (c, r) has its
//  centre at (c + 0.5 - w/2, r + 0.5 - h/2), so row 0 is the far edge.
//
//  In-plane acceleration from tilt:
//    rotation about X (tiltX)  -> gravity component along +z of  g*sin(tiltX)
//    rotation about Z (tiltZ)  -> gravity component along +x of  g*sin(tiltZ)
//  A solid sphere rolling without slipping only gets 5/7 of that.

import { DT, BUTTON_R, WINDMILL_HUB_R, WINDMILL_ARM_R, RAMP_LAUNCH, LIFT_SOLID, LIFT_SPEED, LIFT_HALF_W } from './constants.js';
import { makeVials, resetVials as resetVialState, stepVials } from './vials.js';
//  Every feel-relevant number is read live from TUNING, so the in-game slider panel can
//  change the physics mid-roll and tests can solve a level under different feels.
import { TUNING } from './tuning.js';

const T = TUNING;
import { WALL, FLOOR, PIT, ICE, SAND, STEEL, BELT, VENT, PAD, PLATE, SPAWN, GOAL, OUTSIDE, pitDistance } from './levels.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const len2 = (x, z) => Math.hypot(x, z);

/** A fresh marble at a level spawn point. */
function makeBall(spawn, i) {
  return {
    i,
    x: spawn.x,
    z: spawn.z,
    y: 0,
    vx: 0,
    vz: 0,
    vy: 0,
    air: false, // off the ground on a crest's launch, following a ballistic arc
    groundY: 0, // terrain height under the marble (a wedge, or the board)
    state: 'roll', // roll | falling | sinking | dead | won
    spin: [0, 0, 0], // accumulated rotation for the renderer
    dir: [0, 0],
    // Per-marble copies of the few quantities that used to live on the world. With one marble
    // these were indistinguishable from world state; with several, each marble has its own.
    slideT: 0,
    fallCause: null,
  };
}

export function makeWorld(level) {
  const features = structuredClone(level.features);
  const spawns = level.spawns ?? [level.spawn];
  const balls = spawns.map((s, i) => makeBall(s, i));
  const first = balls[0];
  return {
    level,
    grid: level.grid,
    w: level.w,
    h: level.h,
    //  Every marble on the board. `ball` is kept as an alias for the first so the long tail of
    //  single-marble callers (tests, the tuning sheet, the audio mix) keeps working unchanged.
    balls,
    get ball() {
      return balls.find((b) => b.state === 'roll') ?? first;
    },
    tilt: { x: 0, z: 0 },
    control: { x: 0, z: 0 },
    features,
    pits: structuredClone(level.pits),
    pads: features.pads.map(() => 0),
    // A pad only re-arms once the marble has rolled clear of it, so a marble parked on a
    // receiving pad cannot bounce back and forth forever.
    padArmed: features.pads.map(() => true),
    gates: features.gates.map((g) => ({ id: g.id, open: false, timer: 0 })),
    time: 0,
    falls: 0,
    events: [],
    steps: 0,
    status: 'playing', // playing | won | lost
    // The most recent fall's cause, for single-marble callers that have always read it here.
    fallCause: null,
    lastBump: 0,
    lastBelt: -9,
    // Tangential speed at the strongest wall/fixture contact this step: drives the
    // wheel-scrape sound, and is zero whenever the marble is rolling free.
    slideT: 0,
    surface: 'wood',
    maxSpeedSeen: 0,
    // Liquid level vials, one per side. They are stepped with the marble, on the same fixed tick,
    // so they are deterministic - but the coupling is one-way: nothing below ever reads them, so
    // how the liquid happens to be sloshing can never change the marble's path.
    vials: makeVials(level),
  };
}

export function emit(w, type, data = {}) {
  w.events.push({ type, t: w.time, ...data });
}

export function cellAt(world, x, z) {
  const c = Math.floor(x + world.w / 2);
  const r = Math.floor(z + world.h / 2);
  if (c < 0 || r < 0 || c >= world.w || r >= world.h) return OUTSIDE;
  return world.grid[r][c];
}

export function surfaceAt(world, x, z) {
  // A material PLATE is ground laid over the grid, so it answers first. It is authored in
  // cell-edge coordinates, which is what lets a plate stop at an eighth of a cell.
  const plates = world.level?.plates;
  if (plates?.length) {
    const c = x + world.w / 2;
    const r = z + world.h / 2;
    for (let i = plates.length - 1; i >= 0; i--) {
      const p = plates[i];
      if (c >= p.c0 && c <= p.c1 && r >= p.r0 && r <= p.r1) return p.mat;
    }
  }
  const ch = cellAt(world, x, z);
  if (ch === ICE) return 'ice';
  if (ch === SAND) return 'sand';
  if (ch === STEEL) return 'steel';
  return 'wood';
}

function pushOutOfDisc(ball, x, z, r, restitution, extra, carry = [0, 0], mu = 0.2) {
  let dx = ball.x - x;
  let dz = ball.z - z;
  let d = len2(dx, dz);
  const minD = r + T.ballR;
  if (d >= minD - 1e-9) return 0;
  if (d < 1e-6) {
    dx = 1;
    dz = 0;
    d = 1;
  }
  dx /= d;
  dz /= d;
  const pen = minD - d;
  ball.x += dx * pen;
  ball.z += dz * pen;
  let rvx = ball.vx - carry[0];
  let rvz = ball.vz - carry[1];
  const vn = rvx * dx + rvz * dz;
  if (vn >= 0) return 0;
  const jn = -(1 + restitution) * vn + (extra ?? 0);
  rvx += jn * dx;
  rvz += jn * dz;
  const tx = -dz;
  const tz = dx;
  const vt = rvx * tx + rvz * tz;
  const dvt = -Math.sign(vt) * Math.min(Math.abs(vt), mu * Math.abs(jn));
  rvx += dvt * tx;
  rvz += dvt * tz;
  ball.vx = rvx + carry[0];
  ball.vz = rvz + carry[1];
  return Math.abs(vn);
}

/**
 * Circle vs (moving) segment. `carry` is the surface velocity at the contact point, so a
 * sliding gate or a windmill arm transfers momentum instead of acting like a wall. It may be
 * a fixed `[vx, vz]` (a gate slides as one piece) or a function of `t` (a windmill arm's own
 * speed grows with distance from its hub, and a tip hit must throw harder than a hub hit).
 * `radius` is the segment's half-thickness, so a collider can be the arm you can see rather
 * than a mathematical line.
 */
function pushOutOfSegment(ball, a, b, restitution, carry = [0, 0], mu = 0.2, contact = null, radius = 0) {
  const abx = b[0] - a[0];
  const abz = b[1] - a[1];
  const l2 = abx * abx + abz * abz;
  let t = l2 > 0 ? ((ball.x - a[0]) * abx + (ball.z - a[1]) * abz) / l2 : 0;
  t = clamp(t, 0, 1);
  const px = a[0] + abx * t;
  const pz = a[1] + abz * t;
  const minD = T.ballR + radius;
  let dx = ball.x - px;
  let dz = ball.z - pz;
  let d = len2(dx, dz);
  if (d >= minD - 1e-9) return 0;
  if (d < 1e-6) {
    const l = Math.hypot(abx, abz) || 1;
    dx = -abz / l;
    dz = abx / l;
    d = 1;
  }
  dx /= d;
  dz /= d;
  const pen = minD - d;
  ball.x += dx * pen;
  ball.z += dz * pen;
  const cv = typeof carry === 'function' ? carry(t) : carry;
  let rvx = ball.vx - cv[0];
  let rvz = ball.vz - cv[1];
  const vn = rvx * dx + rvz * dz;
  if (vn >= 0) return 0;
  const jn = -(1 + restitution) * vn;
  rvx += jn * dx;
  rvz += jn * dz;
  const tx = -dz;
  const tz = dx;
  const vt = rvx * tx + rvz * tz;
  // How fast the ball is sliding *along* this surface, before friction takes its bite:
  // this is what the wheel-scrape sound hears. Reported to the caller, not used by physics.
  if (contact && Math.abs(vt) > contact.t) contact.t = Math.abs(vt);
  const dvt = -Math.sign(vt) * Math.min(Math.abs(vt), mu * Math.abs(jn));
  rvx += dvt * tx;
  rvz += dvt * tz;
  ball.vx = rvx + cv[0];
  ball.vz = rvz + cv[1];
  return Math.abs(vn);
}

/** Perpendicular bar of half-length len/2 centred on pos, travelling along dir. */
function moverGeometry(m) {
  const dx = m.to[0] - m.from[0];
  const dz = m.to[1] - m.from[1];
  const l = Math.hypot(dx, dz) || 1;
  const ux = dx / l;
  const uz = dz / l;
  const px = -uz;
  const pz = ux;
  const half = (m.len ?? 1) / 2;
  // sinusoid: t in [0,1]
  const phase = (m.t + (m.phase ?? 0)) % 1;
  const s = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
  const cx = m.from[0] + dx * s;
  const cz = m.from[1] + dz * s;
  const speed = Math.PI * Math.sin(phase * Math.PI * 2) * (m.speed ?? 0.5) * l;
  return {
    a: [cx - px * half, cz - pz * half],
    b: [cx + px * half, cz + pz * half],
    carry: [ux * speed, uz * speed],
  };
}

/**
 * Rotating arms (windmill). Each arm reports its surface velocity as a *function* of the
 * contact point, because a real arm's speed grows with distance from the hub: v = omega x r.
 * Sampling it at the midpoint made a tip strike and a hub strike identical, which is both
 * wrong and the reason a mill never felt like it had any throw in it.
 */
function windmillArms(m) {
  const out = [];
  const n = m.arms ?? 2;
  for (let i = 0; i < n; i++) {
    const ang = m.angle + (i * Math.PI * 2) / n;
    const ux = Math.cos(ang);
    const uz = Math.sin(ang);
    const tip = [m.x + ux * m.len, m.z + uz * m.len];
    // Unit angular direction at angle `ang`, in the (x, z) plane.
    const px = -uz;
    const pz = ux;
    out.push({
      a: [m.x, m.z],
      b: tip,
      carry: (t) => {
        const r = t * m.len;
        const s = T.windmillSweep * m.omega * r;
        return [s * px, s * pz];
      },
    });
  }
  return out;
}

/**
 * The ground a ramp puts under a given point, and the push it adds there.
 *
 * A ramp is a wedge: its ground rises from the low edge to the crest, so the marble climbs and
 * its speed pays for the climb through the same gravity that then hands the speed back on the
 * way down. The slope is the wedge's own geometry - its height over its run - and is clamped so
 * no level can build a launcher. `dir` is the traversal direction, so the push is `dir` reversed.
 * Returns null when the point is off the ramp.
 */
function rampField(rp, x, z) {
  if (x < rp.x0 || x > rp.x1 || z < rp.z0 || z > rp.z1) return null;
  const s = clamp(((x - rp.top.x) * rp.down[0] + (z - rp.top.z) * rp.down[1]) / rp.run, 0, 1);
  const y = rp.height * (1 - s);
  let push = 0;
  if (rp.sin > 0) {
    push = T.gravity * rp.sin * T.roll;
  }
  return { y, ax: rp.down[0] * push, az: rp.down[1] * push };
}

/**
 * How fast the ground under a point climbs along the board: the gradient of `groundAt`. On a
 * wedge it is the wedge's own grade pointing uphill along `dir`; off every wedge it is zero.
 * Used to give the marble the vertical speed the ground has been handing it as it climbs, which
 * is what it is carrying when the ground falls away at a crest.
 */
function groundGradient(world, x, z) {
  let gx = 0;
  let gz = 0;
  let top = 0;
  for (const rp of world.features.ramps) {
    const r = rampField(rp, x, z);
    if (!r || r.y <= top) continue;
    top = r.y;
    gx = (rp.height / rp.run) * rp.dir[0];
    gz = (rp.height / rp.run) * rp.dir[1];
  }
  return [gx, gz];
}

function pendulumArm(p) {
  const ux = Math.sin(p.angle);
  const uz = Math.cos(p.angle);
  const l = p.len;
  const omega = p.amp * Math.PI * 2 * p.freq * Math.cos(Math.PI * 2 * p.freq * p.t0 + p.phase);
  const half = l / 2;
  const carry = [omega * uz * half, -omega * ux * half];
  return { a: [p.x, p.z], b: [p.x + ux * l, p.z + uz * l], carry };
}

function updateFeatures(world, dt) {
  const f = world.features;
  // The mill's angle is a pure function of time, like the pendulums': a phase means a level
  // designer can decide *when* an arm crosses a corridor, and a restart re-syncs exactly.
  for (const m of f.windmills) m.angle = (m.phase ?? 0) + m.omega * world.time;
  for (const p of f.pendulums) {
    p.t0 = world.time;
    p.angle = p.amp * Math.sin(Math.PI * 2 * p.freq * world.time + p.phase);
  }
  for (const m of f.movers) {
    m.t = (m.t + (m.speed ?? 0.5) * dt) % 1;
    const geo = moverGeometry(m);
    m.vel = geo.carry;
    const cxm = (geo.a[0] + geo.b[0]) / 2;
    const czm = (geo.a[1] + geo.b[1]) / 2;
    m.pos = [cxm, czm];
    m.colliders = geo;
  }
  for (let i = 0; i < f.gates.length; i++) {
    const st = world.gates[i];
    if (st.timer > 0) {
      st.timer -= dt;
      if (st.timer <= 0) {
        st.open = false;
        emit(world, 'gate-shut', { gate: st.id });
      }
    }
  }
  //  Lifts. Their plate state was recorded by the *previous* step's ball pass, which is a single
  //  tick of lag - far too short to see, and it keeps a lift a pure read of plate state rather
  //  than a second place the plate is allowed to live. The press flags are cleared once read, so
  //  a marble that has rolled off its plate releases it on the next tick.
  for (const l of f.lifts) {
    const plate = f.plates.find((p) => p.id && p.id === l.plate);
    const held = !!plate?.pressed;
    const target = l.raise ? (held ? 1 : 0) : held ? 0 : 1;
    const step = (l.speed ?? LIFT_SPEED) * dt;
    const before = l.height;
    const next = l.height + clamp(target - l.height, -step, step);
    l.height = next < 0 ? 0 : next > 1 ? 1 : next;
    //  Which way the slab is travelling this tick. A slab on its way UP is a wedge under the
    //  marble: anything sitting on it is pushed off toward the side it is more on (collideMoving).
    //  A slab on its way DOWN must not push, or a marble riding it would be flicked sideways by a
    //  wall that is meant to sink out from under it - so the collider reads this flag.
    l.rising = l.height > before + 1e-9;
    const solid = l.height >= LIFT_SOLID;
    if (solid !== l.solid) {
      l.solid = solid;
      const seg = l.segments[0];
      emit(world, 'lift', { x: (seg.a[0] + seg.b[0]) / 2, z: (seg.a[1] + seg.b[1]) / 2, lift: l.id, up: solid });
    }
  }
  for (const p of f.plates) p.pressed = false;
  for (const pit of world.pits) {
    if (!pit.move) continue;
    const ph = (world.time / (pit.period ?? 4)) * Math.PI * 2 + (pit.phase ?? 0);
    const s = 0.5 - 0.5 * Math.cos(ph);
    pit.x = pit.baseX + pit.move[0] * s;
    pit.z = pit.baseZ + pit.move[1] * s;
  }
}

function applyTilt(world, dt) {
  const rate = world.control.x === 0 && world.control.z === 0 ? T.tiltReturn : T.tiltRate;
  for (const ax of ['x', 'z']) {
    const target = clamp(world.control[ax], -T.maxTilt, T.maxTilt);
    const d = target - world.tilt[ax];
    const step = rate * dt;
    world.tilt[ax] += clamp(d, -step, step);
  }
}

/**
 * Everything that does not move: the board's own walls, shut gates, one-way flaps, the ramps
 * and the fixed round colliders (posts and windmill hubs).
 *
 * This is separated out because it has to be able to run *last*. A moving collider - a windmill
 * arm above all - can sweep the marble into a wall, and since the wall's segments hold the
 * marble on whichever side it is already on, a marble left inside a wall cell is trapped for
 * good: the solver times out and a player has no way back out. The moving parts get their say,
 * then the static world gets the final word.
 */
function collideStatic(world, ball, contact = null) {
  const f = world.features;
  let bump = 0;

  // Walls.
  for (const seg of world.level.segments) {
    bump = Math.max(bump, pushOutOfSegment(ball, seg.a, seg.b, T.wallRestitution, [0, 0], T.wallFriction, contact));
  }

  // Shut gates and one-way flaps.
  for (let i = 0; i < f.gates.length; i++) {
    const g = f.gates[i];
    if (world.gates[i].open) continue;
    for (const seg of g.segments) bump = Math.max(bump, pushOutOfSegment(ball, seg.a, seg.b, 0.45, [0, 0], 0.2, contact));
  }
  for (const ow of f.oneways) {
    for (const seg of ow.segments) {
      const px = (seg.a[0] + seg.b[0]) / 2;
      const pz = (seg.a[1] + seg.b[1]) / 2;
      const side = (ball.x - px) * ow.normal[0] + (ball.z - pz) * ow.normal[1];
      if (side < 0) bump = Math.max(bump, pushOutOfSegment(ball, seg.a, seg.b, 0.3, [0, 0], 0.2, contact));
    }
  }

  // Pegs / bumpers.
  for (const p of f.pegs) {
    const hit = pushOutOfDisc(ball, p.x, p.z, p.r, T.pegRestitution, p.kick ? T.kickerImpulse : 0, [0, 0], 0.15);
    if (hit > 0.35) {
      const pegged = p.kick && hit > 0.7;
      emit(world, 'bump', { x: ball.x, z: ball.z, power: Math.min(1, hit / 3), hard: true, peg: pegged, surface: world.surface });
    }
    bump = Math.max(bump, hit);
  }

  // Ramp crest faces. A wedge has a vertical face at its crest: a marble on the ground cannot
  // climb it, while a marble already up on the wedge crests it and rolls off. Without this the
  // marble would pop up the full height of the wedge from behind. `dir` is the traversal
  // direction, so the marble is on the wrong side of the face when it is *past* the crest.
  for (const rp of f.ramps) {
    if (!rp.face) continue;
    const side = (ball.x - rp.face.x) * rp.dir[0] + (ball.z - rp.face.z) * rp.dir[1];
    if (side <= 0) continue;
    if (ball.y >= rp.height - T.ballR * 0.5) continue;
    bump = Math.max(bump, pushOutOfSegment(ball, rp.face.a, rp.face.b, 0.3, [0, 0], 0.2, contact));
  }

  // The stepped half of each ramp's side walls. A marble can step up onto the wedge only where
  // the wall it meets stands no taller than `RAMP_STEP_UP` of the tall side (see rampFeature);
  // on our linear wedge that is the shallow half of each side, so the crest half is a wall. The
  // segment carries its own surface heights, so a marble already up at that height clears it.
  for (const rp of f.ramps) {
    for (const sg of rp.steps ?? []) {
      const side = (ball.x - sg.a[0]) * sg.n[0] + (ball.z - sg.a[1]) * sg.n[1];
      if (side <= 0) continue; // inside the wedge: nothing to step over
      const ax = sg.b[0] - sg.a[0];
      const az = sg.b[1] - sg.a[1];
      const l2 = ax * ax + az * az;
      let t = l2 > 0 ? ((ball.x - sg.a[0]) * ax + (ball.z - sg.a[1]) * az) / l2 : 0;
      t = clamp(t, 0, 1);
      const surf = sg.ha + (sg.hb - sg.ha) * t;
      if (ball.y >= surf - T.ballR * 0.5) continue; // high enough to clear the step
      bump = Math.max(bump, pushOutOfSegment(ball, sg.a, sg.b, 0.3, [0, 0], 0.2, contact));  // radius 0: wall of ball-thickness, so the open half stays open
    }
  }

  // The windmill post is fixed, so it belongs with the static world.
  for (const m of f.windmills) {
    bump = Math.max(bump, pushOutOfDisc(ball, m.x, m.z, WINDMILL_HUB_R, 0.5, 0, [0, 0], 0.25));
  }
  return bump;
}

/** Everything that moves and therefore carries the marble: arms, rods and sliding bars. */
function collideMoving(world, ball, contact = null) {
  const f = world.features;
  let bump = 0;

  // Windmill arms. The carry is sampled where the arm actually touches, so the tip throws and
  // the hub nudges.
  for (const m of f.windmills) {
    for (const arm of windmillArms(m)) {
      bump = Math.max(bump, pushOutOfSegment(ball, arm.a, arm.b, 0.6, arm.carry, 0.5, contact, WINDMILL_ARM_R));
    }
  }
  for (const p of f.pendulums) {
    const arm = pendulumArm(p);
    bump = Math.max(bump, pushOutOfSegment(ball, arm.a, arm.b, 0.5, arm.carry, 0.35, contact));
  }
  for (const m of f.movers) {
    const g = m.colliders;
    if (g) bump = Math.max(bump, pushOutOfSegment(ball, g.a, g.b, 0.5, g.carry, 0.4, contact));
  }
  //  Lifts. A raised slab is a wall; it has no in-plane velocity, but it is a *moving* collider
  //  (it is busy rising or sinking under the marble), so it belongs here with the moving parts
  //  and gets their protection: a slab that shoves the marble into a wall band is vetoed rather
  //  than leaving the marble trapped inside it.
  //  Lifts. The slab you can see is what the marble collides with, so the collider is as wide as
  //  the slab, centred on its own segment. A fully raised slab is simply a wall. A slab still on
  //  its way UP collides while it is low, with a half-width that grows as it comes up: that is
  //  what lets a rising wall push a marble off toward whichever side of it the marble is more on,
  //  instead of letting the marble end up standing inside the slab. A slab on its way down does
  //  not collide at all; it is meant to sink out from under whatever is standing on it.
  for (const l of f.lifts) {
    if (l.solid) {
      for (const seg of l.segments) bump = Math.max(bump, pushOutOfSegment(ball, seg.a, seg.b, 0.45, [0, 0], 0.2, contact, LIFT_HALF_W));
      continue;
    }
    if (!l.rising || !(l.height > 0)) continue;
    const grow = Math.min(1, l.height / LIFT_SOLID);
    for (const seg of l.segments) bump = Math.max(bump, pushOutOfSegment(ball, seg.a, seg.b, 0.1, [0, 0], 0.35, contact, LIFT_HALF_W * grow));
  }
  return bump;
}

/** Steady force fields: returns the extra in-plane acceleration they apply. */
function fieldAccel(world, ball) {
  const f = world.features;
  let ax = 0;
  let az = 0;
  const c = Math.floor(ball.x + world.w / 2);
  const r = Math.floor(ball.z + world.h / 2);
  const ch = cellAt(world, ball.x, ball.z);

  if (ch === VENT) {
    const vent = f.vents.find((v) => v.cells.some(([vc, vr]) => vc === c && vr === r));
    if (vent) {
      ax += vent.dir[0] * T.ventAccel;
      az += vent.dir[1] * T.ventAccel;
    }
  }

  for (const m of f.magnets) {
    const dx = m.x - ball.x;
    const dz = m.z - ball.z;
    const d = len2(dx, dz);
    //  `levels.js` defaults the radius, but a hand-built feature must not be able to turn the
    //  marble into NaN: the comparison is written so an absent or NaN radius simply skips the
    //  magnet, and the epsilon keeps the centre (where the direction is undefined) from firing.
    const radius = Number.isFinite(m.radius) ? m.radius : 0;
    if (!(d > 1e-4) || d > radius) continue;
    const falloff = 1 - d / radius;
    const str = (m.strength ?? T.magnetStrength) * falloff;
    ax += (dx / d) * str;
    az += (dz / d) * str;
  }

  // Ramps. Two ramps that overlap both push; the marble rides the higher one.
  for (const rp of f.ramps) {
    const r = rampField(rp, ball.x, ball.z);
    if (!r) continue;
    ax += r.ax;
    az += r.az;
  }
  return [ax, az];
}

/**
 * The terrain height directly under the ball: 0 on the board, the wedge height on a ramp.
 * The renderer sits the marble on this, so a climb is something the player can see.
 */
export function groundAt(world, x, z) {
  let y = 0;
  for (const rp of world.features.ramps) {
    const r = rampField(rp, x, z);
    if (r && r.y > y) y = r.y;
  }
  return y;
}

/** Belts drag toward their surface speed, and pads move the marble outright. */
function fieldContacts(world, ball, dt) {
  const f = world.features;
  const c = Math.floor(ball.x + world.w / 2);
  const r = Math.floor(ball.z + world.h / 2);

  if (cellAt(world, ball.x, ball.z) === BELT) {
    const belt = f.belts.find((b) => b.cells.some(([bc, br]) => bc === c && br === r));
    if (belt) {
      const tx = belt.dir[0] * T.conveyorSpeed;
      const tz = belt.dir[1] * T.conveyorSpeed;
      ball.vx += (tx - ball.vx) * Math.min(1, 7 * dt);
      ball.vz += (tz - ball.vz) * Math.min(1, 7 * dt);
      // One roller pulse every few tenths of a second, so overlapping copies make a
      // continuous belt rumble instead of an isolated tick every couple of seconds.
      if (len2(belt.dir[0], belt.dir[1]) > 0 && world.time - world.lastBelt > 0.4) {
        world.lastBelt = world.time;
        emit(world, 'belt', { x: ball.x, z: ball.z });
      }
    }
  }

  // Teleport pads.
  for (let i = 0; i < f.pads.length; i++) {
    const pad = f.pads[i];
    const dA = len2(ball.x - pad.a.x, ball.z - pad.a.z);
    const dB = len2(ball.x - pad.b.x, ball.z - pad.b.z);
    const near = Math.min(dA, dB);
    if (!world.padArmed[i]) {
      if (near > T.teleportR * 1.8) world.padArmed[i] = true;
      continue;
    }
    if (world.pads[i] > 0) continue;
    let to = null;
    let from = null;
    if (dA < T.teleportR) {
      from = pad.a;
      to = pad.b;
    } else if (dB < T.teleportR) {
      from = pad.b;
      to = pad.a;
    }
    if (!to) continue;
    const vx = ball.vx;
    const vz = ball.vz;
    const n = Math.hypot(vx, vz) || 1;
    const sp = Math.max(0.35, Math.hypot(vx, vz));
    ball.x = to.x + (vx / n) * 0.05;
    ball.z = to.z + (vz / n) * 0.05;
    ball.vx = (vx / n) * sp;
    ball.vz = (vz / n) * sp;
    world.pads[i] = T.teleportCooldown;
    world.padArmed[i] = false;
    emit(world, 'teleport', { x: ball.x, z: ball.z, from, to });
    return;
  }
}

function checkPlates(world, ball) {
  const f = world.features;
  for (const plate of f.plates) {
    const d = len2(ball.x - plate.x, ball.z - plate.z);
    if (d > (plate.radius ?? BUTTON_R)) continue;
    //  The press is recorded whether or not the plate owns a gate: a lift reads exactly this
    //  flag, so a plate can drive a raising wall, a timing gate, or both.
    const wasPressed = !!plate.pressed;
    plate.pressed = true;
    if (!wasPressed) emit(world, 'plate', { x: plate.x, z: plate.z, gate: plate.gate });
    const gate = world.gates.find((g) => g.id === plate.gate);
    if (!gate) continue;
    gate.open = true;
    gate.timer = plate.hold ?? T.gateOpenTime;
  }
}

function checkPits(world, ball) {
  for (const pit of world.pits) {
    // pitDistance is exact for a round pit and follows the whole chain of a slot; the
    // capture radius is the same fraction of the drawn radius either way.
    if (pitDistance(pit, ball.x, ball.z) < pit.r * T.pitCapture) return pit;
  }
  return null;
}

function checkGoal(world, ball) {
  const g = world.level.goal;
  return len2(ball.x - g.x, ball.z - g.z) < g.r * T.goalCapture;
}

function checkOffEdge(world, ball) {
  const ch = cellAt(world, ball.x, ball.z);
  if (ch !== OUTSIDE) return false;
  // The ball's centre is already past the board edge, so it is on its way off.
  return true;
}

/** One fixed physics step. */
export function step(world, dt = DT) {
  world.steps++;
  world.time += dt;
  world.lastBump = 0;
  world.slideT = 0; // tangential wall-contact speed, read back each frame for the scrape sound
  applyTilt(world, dt);
  // Before any early return: the liquid has to keep flowing while the marble is falling into a
  // pit, or a vial would freeze mid-slosh exactly when the player is watching it.
  stepVials(world.vials, world.tilt, dt);
  updateFeatures(world, dt);
  for (let i = 0; i < world.pads.length; i++) world.pads[i] = Math.max(0, world.pads[i] - dt);

  //  Marbles push each other apart before any of them moves, so the per-marble step below
  //  always starts from a non-overlapping configuration.
  collideBalls(world);
  for (const ball of world.balls) stepBall(world, ball, dt);

  //  The world-global readbacks for single-marble callers (audio, the tuning readout) follow the
  //  marble still in play rather than whichever happened to be stepped last.
  const primary = world.ball;
  if (primary?.surface) world.surface = primary.surface;
  world.slideT = world.balls.reduce((m, b) => (b.state === 'roll' ? Math.max(m, b.slideT) : m), 0);
  updateStatus(world);
}

/** One marble's fixed step. `world` carries the shared tilt/features; everything else is `ball`. */
function stepBall(world, ball, dt) {
  if (ball.state === 'dead' || ball.state === 'won') return;

  if (ball.state === 'falling' || ball.state === 'sinking') {
    ball.vy -= T.gravity * dt;
    ball.y += ball.vy * dt;
    ball.x += ball.vx * dt;
    ball.z += ball.vz * dt;
    if (ball.state === 'falling' && ball.y < -2.4) {
      ball.state = 'dead';
      if (world.balls.length === 1) world.status = 'lost';
      emit(world, 'dead', { i: ball.i, cause: ball.fallCause });
    }
    if (ball.state === 'sinking' && ball.y < -0.9) {
      ball.state = 'won';
      emit(world, 'settled', { i: ball.i });
    }
    return;
  }

  const surface = surfaceAt(world, ball.x, ball.z);
  ball.surface = surface;
  world.surface = surface;
  const surf = T.surfaces[surface] ?? T.surfaces.wood;
  // The terrain height under the marble, sampled *before* this step's move. A ramp's crest face
  // needs to know whether the marble is still up on the wedge (cresting it) or down on the
  // ground (walking into its vertical face), and this is the height it had while it did. The
  // rate that terrain climbs along the marble's travel is the vertical speed it carries onto
  // whatever comes next: ride that up a wedge and the crest hands it straight into the air.
  ball.groundY = groundAt(world, ball.x, ball.z);
  let surfaceRate = 0;
  if (!ball.air) {
    const [gx, gz] = groundGradient(world, ball.x, ball.z);
    surfaceRate = gx * ball.vx + gz * ball.vz;
    ball.vy = surfaceRate;
  }

  // Tilt -> in-plane gravity, 5/7 of it because the marble rolls; plus whatever the
  // level's fans and magnets are doing.
  const speed0 = len2(ball.vx, ball.vz);
  let ax = T.gravity * Math.sin(world.tilt.z) * T.roll;
  let az = T.gravity * Math.sin(world.tilt.x) * T.roll;
  const [fx, fz] = fieldAccel(world, ball);
  ax += fx;
  az += fz;

  // Static rolling resistance: a parked marble on sand stays parked until the total
  // drive is steep enough to break it loose. Applied to acceleration, not to speed.
  const drive = len2(ax, az);
  if (speed0 < 0.05 && drive <= surf.roll) {
    ax = 0;
    az = 0;
    ball.vx = 0;
    ball.vz = 0;
  } else if (drive <= surf.roll && speed0 > 0) {
    // Rolling resistance alone can stop it, but never reverse it.
    const stop = surf.roll * dt;
    const s = len2(ball.vx, ball.vz);
    if (s <= stop) {
      ball.vx = 0;
      ball.vz = 0;
    }
  }
  ball.vx += ax * dt;
  ball.vz += az * dt;

  // Surface drag, then rolling resistance as a deceleration opposing motion.
  const damp = Math.max(0, 1 - surf.drag * dt);
  ball.vx *= damp;
  ball.vz *= damp;
  const s1 = len2(ball.vx, ball.vz);
  if (s1 > 1e-9) {
    const f = Math.max(0, s1 - surf.roll * dt) / s1;
    ball.vx *= f;
    ball.vz *= f;
  }

  ball.x += ball.vx * dt;
  ball.z += ball.vz * dt;

  // Two resolve passes so corners settle.
  let bump = 0;
  const contact = { t: 0 };
  //  The board's walls are collided as the *edges* of each wall cell, which is what lets the
  //  marble skim along a wall band instead of catching on a grid seam. The price is that the
  //  inside of a wall cell is not solid: its own edges push the marble toward the middle of
  //  whichever cell it is already in, so a marble posted inside a band is held there, out of
  //  reach of every edge, and trapped for good. Nothing may post it there. A moving collider
  //  (an arm above all) is allowed to press the marble against a wall, so its push is applied
  //  and then vetoed if it ended up inside one — the marble keeps the spot the static pass put
  //  it in, and the velocity the push would have given it is dropped.
  for (let i = 0; i < 2; i++) {
    bump = Math.max(bump, collideStatic(world, ball, contact));
    const sx = ball.x;
    const sz = ball.z;
    const svx = ball.vx;
    const svz = ball.vz;
    bump = Math.max(bump, collideMoving(world, ball, contact));
    if (cellAt(world, ball.x, ball.z) === WALL) {
      ball.x = sx;
      ball.z = sz;
      ball.vx = svx;
      ball.vz = svz;
    }
  }
  // Static geometry always gets the last word, so the marble can never be left inside a wall.
  bump = Math.max(bump, collideStatic(world, ball, contact));
  ball.slideT = contact.t;
  world.slideT = Math.max(world.slideT, contact.t);
  // Vertical motion. On a surface the marble's height *is* the surface, and it carries the rate
  // that surface climbs along its travel. When the ground drops away beneath it - off a wedge's
  // crest - it keeps going: it becomes airborne at that climb rate, which is what makes a fast
  // crest a long hop and a slow one a short drop. Gravity brings it back to the ground it lands
  // on. `groundY` is kept separately so the shadow and the shadow's fade can tell the board from
  // the marble's own height.
  const ground = groundAt(world, ball.x, ball.z);
  if (ball.y + (ball.vy - T.gravity * dt) * dt <= ground) {
    ball.y = ground;
    ball.air = false;
  } else {
    // Just left the surface: a cresting marble hands the whole climb rate to the launch, lifted
    // by the readability gain so a board-scale wedge actually throws. That gain only ever fires
    // here, on the step the marble leaves the ground, never while it is climbing.
    if (!ball.air && surfaceRate > 0) ball.vy = surfaceRate * RAMP_LAUNCH;
    ball.air = true;
    ball.vy -= T.gravity * dt;
    ball.y += ball.vy * dt;
  }
  ball.groundY = ground;

  // Speed cap.
  const sp2 = len2(ball.vx, ball.vz);
  if (sp2 > T.vMax) {
    ball.vx = (ball.vx / sp2) * T.vMax;
    ball.vz = (ball.vz / sp2) * T.vMax;
  }
  world.maxSpeedSeen = Math.max(world.maxSpeedSeen, sp2);

  // Rolling visual: rotate the sphere about the axis perpendicular to travel.
  const roll = len2(ball.vx, ball.vz) * dt;
  if (roll > 1e-6) {
    //  The rolling axis is the board normal crossed with travel, w = (vz, 0, -vx) - the
    //  *negative* of a 90-degree turn of the velocity. Getting this sign the other way
    //  makes the ball backspin: the pattern on its surface slides opposite to the way it
    //  travels, which is what the player sees and reads as wrong rolling.
    const nx = ball.vz;
    const nz = -ball.vx;
    const n = Math.hypot(nx, nz) || 1;
    ball.dir = [ball.vx / (sp2 || 1), ball.vz / (sp2 || 1)];
    ball.spin[0] += (nx / n) * (roll / Math.max(0.05, T.ballR));
    ball.spin[2] += (nz / n) * (roll / Math.max(0.05, T.ballR));
  }

  if (bump > 0.25) emit(world, 'bump', { x: ball.x, z: ball.z, power: Math.min(1, bump / 3), hard: bump > 1.2, surface });

  checkPlates(world, ball);

  // A marble in the air is above whatever is under it, so a hole only swallows it once it has
  // come back down. (It lands at the end of the previous step, so the same step that touches
  // down can fall in.)
  const pit = ball.air ? null : checkPits(world, ball);
  if (pit) {
    ball.state = 'falling';
    ball.vy = -0.35;
    ball.fallCause = { type: 'pit', index: pit.i, x: pit.x, z: pit.z };
    world.fallCause = ball.fallCause;
    emit(world, 'pit', { x: pit.x, z: pit.z, index: pit.i, i: ball.i });
    return;
  }

  if (!ball.air && checkGoal(world, ball)) {
    ball.state = 'sinking';
    ball.vy = -1.1;
    emit(world, 'goal', { x: ball.x, z: ball.z, i: ball.i });
    return;
  }

  if (checkOffEdge(world, ball)) {
    ball.state = 'falling';
    ball.vy = -0.2;
    ball.fallCause = { type: 'edge', x: ball.x, z: ball.z };
    world.fallCause = ball.fallCause;
    emit(world, 'edge', { x: ball.x, z: ball.z, i: ball.i });
    return;
  }

  fieldContacts(world, ball, dt);
}

/**
 * Put the liquid back to rest. Called wherever the marble is reset: a restart that left the
 * vials mid-slosh would tell the player the board is tilted when it is not.
 */
export function resetVials(world) {
  resetVialState(world.vials);
}

/**
 * Put one marble back on its own spawn point, ready to roll again.
 *
 * This is the per-marble half of a reset: it touches only the marble, so a second marble that is
 * still mid-run on a multi-marble board keeps its position, momentum and the board's tilt. That
 * is what lets a fallen marble respawn without interrupting its fellows.
 */
export function resetMarble(world, ball) {
  const spawn = world.level.spawns?.[ball.i] ?? world.level.spawn;
  ball.x = spawn.x;
  ball.z = spawn.z;
  ball.y = 0;
  ball.vx = 0;
  ball.vz = 0;
  ball.vy = 0;
  ball.air = false;
  ball.groundY = 0;
  ball.slideT = 0;
  ball.fallCause = null;
  ball.state = 'roll';
  emit(world, 'place', { x: ball.x, z: ball.z, i: ball.i });
}

/**
 * A full reset: every marble back to its spawn, the board recentred and the run state cleared.
 *
 * Supports both the historical `resetBall(world)` call (a whole-run restart) and
 * `resetBall(world, ball)`, which resets that one marble and leaves the rest alone.
 */
export function resetBall(world, ball = null) {
  if (ball) {
    resetMarble(world, ball);
    return;
  }
  for (const b of world.balls) resetMarble(world, b);
  world.status = 'playing';
  world.fallCause = null;
  for (let i = 0; i < world.padArmed.length; i++) world.padArmed[i] = true;
  world.control.x = 0;
  world.control.z = 0;
  world.tilt.x = 0;
  world.tilt.z = 0;
  world.slideT = 0;
  for (const b of world.balls) b.slideT = 0;
  for (let i = 0; i < world.pads.length; i++) world.pads[i] = 0;
  //  Lifts go back to rest and forget any press: a restart that left a wall up because a marble
  //  was standing on a plate a moment ago would tell the player the plate is still held.
  for (const l of world.features.lifts) {
    l.height = l.raise ? 0 : 1;
    l.solid = l.height >= LIFT_SOLID;
    l.rising = false;
  }
  for (const p of world.features.plates) p.pressed = false;
}

/** How many marbles have reached the goal (sinking or settled). */
export function homeCount(world) {
  return world.balls.filter((b) => b.state === 'sinking' || b.state === 'won').length;
}

/** True once every marble on the board is in the goal cup — the win condition. */
export function allHome(world) {
  return world.balls.every((b) => b.state === 'sinking' || b.state === 'won');
}

/**
 * Recompute the run status. A multi-marble level is only `won` when every marble is home, so a
 * single marble in the cup does not end the run while its fellows are still rolling.
 */
function updateStatus(world) {
  if (world.status === 'lost') return;
  if (allHome(world)) world.status = 'won';
}

/**
 * Marble-versus-marble collisions.
 *
 * Equal-mass spheres: separate the overlap along the line of centres and exchange the closing
 * velocity with a little restitution, so two marbles bouncing off each other feel like glass on
 * wood rather than pass-throughs. Only rolling marbles take part — a marble already falling into
 * a pit or the cup is out of play. If a separation would shove a marble inside a wall the push
 * is dropped for that marble (the static pass would only undo it): the velocity exchange still
 * happens, so contacts never trap a marble in a wall band.
 */
function collideBalls(world) {
  const minD = T.ballR * 2;
  const e = 0.9;
  for (let i = 0; i < world.balls.length; i++) {
    const a = world.balls[i];
    if (a.state !== 'roll') continue;
    for (let j = i + 1; j < world.balls.length; j++) {
      const b = world.balls[j];
      if (b.state !== 'roll') continue;
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      let d = Math.hypot(dx, dz);
      if (d >= minD - 1e-9) continue;
      if (d < 1e-6) {
        dx = 1;
        dz = 0;
        d = 1;
      }
      const nx = dx / d;
      const nz = dz / d;
      const pen = (minD - d) / 2;
      // Positional separation, each marble half the overlap - unless that lands it in a wall.
      const ax = a.x - nx * pen;
      const az = a.z - nz * pen;
      if (cellAt(world, ax, az) !== WALL) {
        a.x = ax;
        a.z = az;
      }
      const bx = b.x + nx * pen;
      const bz = b.z + nz * pen;
      if (cellAt(world, bx, bz) !== WALL) {
        b.x = bx;
        b.z = bz;
      }
      // Impulse along the normal, only while they are still approaching.
      const rel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
      if (rel <= 0) continue;
      const jimp = ((1 + e) / 2) * rel;
      a.vx -= jimp * nx;
      a.vz -= jimp * nz;
      b.vx += jimp * nx;
      b.vz += jimp * nz;
      if (rel > 0.3) emit(world, 'bump', { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, power: Math.min(1, rel / 3), hard: rel > 1.2, marble: true });
    }
  }
}

export function speed(world) {
  return Math.hypot(world.ball.vx, world.ball.vz);
}
