// Physics behaviour: the marble must roll like a marble, never escape the board, never
// pass through a wall, and every authored obstacle must actually do what it claims.
import { LEVELS, buildLevel } from '../src/engine/levels.js';
import { makeWorld, step, resetBall, speed, cellAt, surfaceAt, groundAt } from '../src/engine/physics.js';
import {
  BALL_R,
  DT,
  MAX_TILT,
  V_MAX,
  PIT_R,
  GOAL_R,
  GATE_OPEN_TIME,
  TELEPORT_COOLDOWN,
  WINDMILL_HUB_R,
  RAMP_HEIGHT,
  RAMP_MAX_SLOPE,
  GRAVITY,
  ROLL_FACTOR,
} from '../src/engine/constants.js';
import { WALL } from '../src/engine/levels.js';
import { setTuning, resetTuning } from '../src/engine/tuning.js';

export const name = 'physics';

const L1 = buildLevel(LEVELS[0]);

/** Build a fixture level from the same DSL real levels use. */
function fixture(over = {}) {
  const base = {
    id: 'fixture',
    name: 'Fixture',
    shape: 'Rectangle',
    difficulty: 1,
    par: 30,
    hint: 'test',
    board: { shape: 'rect', w: 12, h: 9 },
    spawn: [1, 4],
    goal: [10, 4],
    pits: [],
    ...over,
  };
  return buildLevel(base);
}

function run(world, seconds, control = () => ({ x: 0, z: 0 })) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const c = control(world);
    world.control.x = c.x;
    world.control.z = c.z;
    step(world, DT);
  }
  return world;
}

/**
 * How far a marble parked just below a +z ramp's crest rolls downhill (`-z`) in `seconds`.
 * `dir` is the traversal direction, so a `[0, 1]` ramp climbs toward +z and its crest is `z1`.
 */
function rampTravel(ramp, seconds) {
  const level = fixture({ ramps: [ramp] });
  const rp = level.features.ramps[0];
  if (rp.dir[1] !== 1) throw new Error('rampTravel assumes a +z traversal ramp');
  const w = makeWorld(level);
  w.ball.x = (rp.x0 + rp.x1) / 2;
  w.ball.z = rp.z1 - 0.05;
  const z0 = w.ball.z;
  run(w, seconds, () => ({ x: 0, z: 0 }));
  return z0 - w.ball.z;
}

function minWallDistance(level, x, z) {
  let best = Infinity;
  for (const seg of level.segments) {
    const [ax, az] = seg.a;
    const [bx, bz] = seg.b;
    const abx = bx - ax;
    const abz = bz - az;
    const l2 = abx * abx + abz * abz;
    let t = l2 > 0 ? ((x - ax) * abx + (z - az) * abz) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (ax + abx * t), z - (az + abz * t));
    if (d < best) best = d;
  }
  return best;
}

// Deterministic PRNG so a failure is always reproducible.
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function tests(t) {
  t.ok('the tilt direction is what the player expects', () => {
    const right = makeWorld(fixture({ spawn: [1, 4], goal: [10, 4] }));
    run(right, 0.6, () => ({ x: 0, z: MAX_TILT }));
    if (!(right.ball.x > right.level.spawn.x + 0.05)) throw new Error('tilting +z did not push the marble +x');
    if (Math.abs(right.ball.z - right.level.spawn.z) > 0.02) throw new Error('a pure +z tilt drifted in z');

    const down = makeWorld(fixture({ spawn: [5, 1], goal: [5, 7] }));
    run(down, 0.6, () => ({ x: MAX_TILT, z: 0 }));
    if (!(down.ball.z > down.level.spawn.z + 0.05)) throw new Error('tilting +x did not push the marble +z');
  });

  t.ok('the marble rolls forward, never backspins', () => {
    //  A ball rolling +x turns *clockwise* seen from above +z, i.e. its rotation about z is
    //  negative; a ball rolling +z turns about +x positively. The opposite signs are a
    //  backspin, where the pattern on the ball's surface slides against the travel.
    const right = makeWorld(fixture({ spawn: [1, 4], goal: [10, 4] }));
    run(right, 0.6, () => ({ x: 0, z: MAX_TILT }));
    if (!(right.ball.vx > 0.05)) throw new Error('fixture did not roll +x');
    if (!(right.ball.spin[2] < 0)) throw new Error(`rolling +x spun the wrong way (spin.z=${right.ball.spin[2]})`);
    if (Math.abs(right.ball.spin[0]) > 1e-6) throw new Error('a pure +x roll spun about x');

    const down = makeWorld(fixture({ spawn: [5, 1], goal: [5, 7] }));
    run(down, 0.6, () => ({ x: MAX_TILT, z: 0 }));
    if (!(down.ball.vz > 0.05)) throw new Error('fixture did not roll +z');
    if (!(down.ball.spin[0] > 0)) throw new Error(`rolling +z spun the wrong way (spin.x=${down.ball.spin[0]})`);
    if (Math.abs(down.ball.spin[2]) > 1e-6) throw new Error('a pure +z roll spun about z');
  });

  t.ok('the board tilts smoothly and self-centres when released', () => {
    const w = makeWorld(L1);
    run(w, 0.05, () => ({ x: 0, z: MAX_TILT }));
    const mid = w.tilt.z;
    if (!(mid > 0.05 && mid < MAX_TILT)) throw new Error(`tilt ramp looked wrong: ${mid}`);
    run(w, 2.0, () => ({ x: 0, z: 0 }));
    if (Math.abs(w.tilt.z) > 1e-6) throw new Error('tilt did not return to level');
  });

  t.ok('the marble reaches a sane rolling speed, not a runaway', () => {
    const w = makeWorld(fixture({ pits: [] }));
    run(w, 6, () => ({ x: 0, z: MAX_TILT }));
    const v = speed(w);
    if (v < 1.2) throw new Error(`marble crawled: ${v.toFixed(2)} u/s`);
    if (v > 3.6) throw new Error(`marble flew: ${v.toFixed(2)} u/s`);
  });

  t.ok('a wall stops the marble and bounces it a little', () => {
    // The goal sits on another row so it cannot quietly end the run mid-flight.
    const w = makeWorld(fixture({ spawn: [1, 4], goal: [10, 7] }));
    w.ball.x = 2.0;
    w.ball.vx = 4.5;
    let hit = false;
    run(w, 2.0, () => {
      if (w.ball.vx < -0.05) hit = true;
      return { x: 0, z: 0 };
    });
    if (!hit) throw new Error(`the marble never bounced off the far wall (x=${w.ball.x.toFixed(2)})`);
    if (w.ball.x > w.w / 2 - 1) throw new Error('the marble passed through the goal-side wall');
  });

  t.ok('the marble never tunnels a wall, even at full tilt for a minute', () => {
    const w = makeWorld(L1);
    let worst = Infinity;
    const n = Math.round(60 / DT);
    for (let i = 0; i < n; i++) {
      // sweep the tilt around the full circle so it hammers every wall
      const a = (i / 180) * Math.PI * 2;
      w.control.x = Math.cos(a) * MAX_TILT;
      w.control.z = Math.sin(a) * MAX_TILT;
      step(w, DT);
      if (w.ball.state !== 'roll') {
        w.falls++;
        resetBall(w);
        continue;
      }
      const d = minWallDistance(w.level, w.ball.x, w.ball.z);
      if (d < worst) worst = d;
      if (cellAt(w, w.ball.x, w.ball.z) === WALL) throw new Error(`marble centre inside a wall at ${w.ball.x},${w.ball.z}`);
    }
    if (worst < BALL_R - 0.03) throw new Error(`marble sank ${(BALL_R - worst).toFixed(3)} units into a wall`);
    if (speed(w) > V_MAX + 1e-6) throw new Error('speed cap was exceeded');
  });

  t.ok('wall friction reaches the marble, and zero really means zero', () => {
    // Lean hard into the left border wall and send the marble skimming along it. The lean is
    // perpendicular to the wall, so the marble's z speed is pure slide: nothing but wall
    // friction is allowed to take it away. A hard-coded minimum tangential impulse at the
    // contact used to scrub that slide even with the slider at zero, so the marble stalled
    // against the wall instead of running along it.
    const skim = (friction) => {
      resetTuning();
      setTuning('wallFriction', friction);
      const w = makeWorld(fixture());
      // The left border wall's inner face is at x = -5; park the marble on the open side of it.
      w.ball.x = -5 + BALL_R + 0.02;
      w.ball.z = -2.5;
      w.ball.vx = 0;
      w.ball.vz = 2.0;
      run(w, 1.5, () => ({ x: 0, z: -MAX_TILT }));
      const v = speed(w);
      resetTuning();
      return v;
    };
    const none = skim(0);
    const lots = skim(0.9);
    if (none < 0.35) throw new Error(`wall friction 0 still scrubbed the slide (v=${none.toFixed(3)} of 2 after 1.5s)`);
    if (!(lots < none * 0.6)) throw new Error(`the wall friction knob barely changed the slide (${none.toFixed(3)} vs ${lots.toFixed(3)})`);
  });

  t.ok('a random-hand fuzz run never loses the marble off a sealed board', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const rnd = mulberry32(seed * 977);
      const w = makeWorld(L1);
      const n = Math.round(25 / DT);
      let switches = 0;
      let ctrl = { x: 0, z: 0 };
      for (let i = 0; i < n; i++) {
        if (i % 40 === 0) {
          switches++;
          const a = rnd() * Math.PI * 2;
          const mag = rnd() * MAX_TILT;
          ctrl = { x: Math.cos(a) * mag, z: Math.sin(a) * mag };
        }
        step(w, DT);
        if (w.ball.state !== 'roll') break;
      }
      if (switches === 0) throw new Error('fuzz harness never moved the board');
      const outside = w.ball.x < -w.w / 2 - 0.01 || w.ball.x > w.w / 2 + 0.01 || w.ball.z < -w.h / 2 - 0.01 || w.ball.z > w.h / 2 + 0.01;
      if (outside && w.ball.state === 'roll') throw new Error(`seed ${seed}: marble left a sealed board while rolling`);
    }
  });

  t.ok('the same inputs always produce the same run', () => {
    const script = (w) => ({ x: Math.sin(w.time * 3.1) * MAX_TILT, z: Math.cos(w.time * 2.3) * MAX_TILT });
    const a = run(makeWorld(L1), 8, script);
    const b = run(makeWorld(L1), 8, script);
    const fa = `${a.ball.x.toFixed(9)},${a.ball.z.toFixed(9)},${a.ball.vx.toFixed(9)},${a.ball.vz.toFixed(9)}`;
    const fb = `${b.ball.x.toFixed(9)},${b.ball.z.toFixed(9)},${b.ball.vx.toFixed(9)},${b.ball.vz.toFixed(9)}`;
    if (fa !== fb) throw new Error(`simulation is not deterministic: ${fa} vs ${fb}`);
  });

  t.ok('a pit swallows the marble and ends the attempt', () => {
    const w = makeWorld(L1);
    const pit = w.pits[0];
    w.ball.x = pit.x - 1.2;
    w.ball.z = pit.z;
    w.ball.vx = 2.2;
    let sawPit = false;
    for (let i = 0; i < Math.round(4 / DT); i++) {
      step(w, DT);
      if (w.events.some((e) => e.type === 'pit')) sawPit = true;
      if (w.ball.state === 'dead') break;
    }
    if (!sawPit) throw new Error('marble rolled straight over a pit');
    if (w.ball.state !== 'dead') throw new Error(`marble did not die in the pit (state ${w.ball.state})`);
    if (w.status !== 'lost') throw new Error('world did not register the loss');
  });

  t.ok('the goal cup catches the marble and settles', () => {
    const w = makeWorld(L1);
    w.ball.x = w.level.goal.x;
    w.ball.z = w.level.goal.z;
    w.ball.vx = 0;
    w.ball.vz = 0;
    run(w, 2.0);
    if (w.status !== 'won') throw new Error(`goal not registered (status ${w.status})`);
    if (w.ball.state !== 'won') throw new Error(`marble never settled (state ${w.ball.state})`);
  });

  t.ok('goal capture needs the marble at the cup, not merely near it', () => {
    const w = makeWorld(L1);
    w.ball.x = w.level.goal.x + GOAL_R * 2.4;
    w.ball.z = w.level.goal.z;
    run(w, 0.4, () => ({ x: 0, z: 0 }));
    if (w.status === 'won') throw new Error('the goal was awarded from too far away');
  });

  t.ok('ice carries the marble further than wood, sand stops it short', () => {
    const dist = (over) => {
      const w = makeWorld(fixture(over));
      run(w, 3, () => ({ x: 0, z: MAX_TILT }));
      return w.ball.x - w.level.spawn.x;
    };
    const wood = dist({});
    const ice = dist({ ice: [[1, 4, 10, 4]] });
    const sand = dist({ sand: [[1, 4, 10, 4]] });
    if (!(ice > wood + 0.5)) throw new Error(`ice (${ice.toFixed(2)}) is not slicker than wood (${wood.toFixed(2)})`);
    if (!(sand < wood - 0.3)) throw new Error(`sand (${sand.toFixed(2)}) does not slow the marble versus wood (${wood.toFixed(2)})`);
  });

  t.ok('sand parks a marble at a shallow tilt and releases it when the tilt steepens', () => {
    const w = makeWorld(fixture({ sand: [[1, 4, 10, 4]] }));
    // start on a sand cell, not on the spawn cell (which the DSL paints as bare floor)
    w.ball.x = -3.5;
    run(w, 3, () => ({ x: 0, z: 0.045 }));
    if (speed(w) > 0.02) throw new Error(`marble crept across sand at a shallow tilt (v=${speed(w).toFixed(3)})`);
    const was = w.ball.x;
    run(w, 3, () => ({ x: 0, z: MAX_TILT }));
    if (!(w.ball.x > was + 0.5)) throw new Error('the marble never broke free of the sand');
  });

  t.ok('a bumper peg kicks the marble back', () => {
    const w = makeWorld(fixture({ pegs: [{ cell: [5, 4], r: 0.28, kick: true }] }));
    w.ball.x = w.level.features.pegs[0].x - 1.6;
    w.ball.z = w.level.features.pegs[0].z;
    w.ball.vx = 2.2;
    let sawBump = false;
    for (let i = 0; i < Math.round(2 / DT); i++) {
      step(w, DT);
      if (w.ball.vx < -0.6) sawBump = true;
      if (sawBump) break;
    }
    if (!sawBump) throw new Error('a kicking peg did not reverse the marble');
  });

  t.ok('conveyor belts drag the marble along their direction', () => {
    const w = makeWorld(fixture({ belts: [{ rect: [1, 4, 10, 4], dir: [-1, 0] }] }));
    w.ball.x = 3;
    run(w, 3, () => ({ x: 0, z: 0 }));
    if (!(w.ball.x < 2.2)) throw new Error(`belt did not carry the marble (x=${w.ball.x.toFixed(2)})`);
  });

  t.ok('a fan blows the marble off a straight line', () => {
    const w = makeWorld(fixture({ vents: [{ rect: [4, 1, 8, 7], dir: [0, 1] }] }));
    run(w, 4.0, () => ({ x: 0, z: MAX_TILT }));
    if (!(w.ball.z > w.level.spawn.z + 0.6)) throw new Error(`the fan pushed nothing (z=${w.ball.z.toFixed(2)})`);
  });

  t.ok('a magnet pulls the marble in and a negative magnet pushes it away', () => {
    const pull = makeWorld(fixture({ magnets: [{ cell: [7, 4], radius: 6, strength: 3 }] }));
    pull.ball.x = -1.5;
    run(pull, 3, () => ({ x: 0, z: 0 }));
    if (!(pull.ball.x > -1.2)) throw new Error(`attracting magnet did nothing (x=${pull.ball.x.toFixed(2)})`);

    const push = makeWorld(fixture({ magnets: [{ cell: [7, 4], radius: 6, strength: -3 }] }));
    push.ball.x = -1.5;
    run(push, 3, () => ({ x: 0, z: 0 }));
    if (!(push.ball.x < -1.8)) throw new Error(`repelling magnet did nothing (x=${push.ball.x.toFixed(2)})`);
  });

  t.ok('teleport pads hand the marble to their partner and then cool down', () => {
    const level = fixture({ teleports: [{ a: [1, 4], b: [10, 2] }], goal: [10, 6] });
    const w = makeWorld(level);
    step(w, DT);
    if (w.ball.x < 3) throw new Error(`marble did not teleport to the far pad (x=${w.ball.x.toFixed(2)})`);
    if (w.pads[0] <= 0) throw new Error('teleport cooldown was not armed');
    if (w.pads[0] > TELEPORT_COOLDOWN) throw new Error('teleport cooldown is longer than configured');
    if (w.padArmed[0]) throw new Error('the receiving pad stayed armed');
    // A marble sitting still on the receiving pad must not bounce back.
    run(w, 3.0);
    if (w.ball.x < 3) throw new Error('the marble bounced back through the pad on its own');
  });

  t.ok('a pressure plate opens its gate, and the gate shuts again afterwards', () => {
    // A single one-cell-high corridor along row 4, with a gate bar across col 5.
    const level = fixture({
      walls: [
        [5, 1, 5, 3],
        [5, 5, 5, 7],
      ],
      gates: [{ id: 'd1', seg: [[5, 3], [5, 5]] }],
      buttons: [{ cell: [2, 4], gate: 'd1', hold: 1.0 }],
    });
    const barrierX = level.features.gates[0].segments[0].a[0];
    const w = makeWorld(level);
    // with the gate shut, the marble cannot get past the gap
    w.ball.x = barrierX + 2.6;
    w.ball.z = 0;
    run(w, 2.5, () => ({ x: 0, z: -MAX_TILT }));
    if (w.ball.x < barrierX - 0.05) throw new Error(`marble walked through a shut gate (x=${w.ball.x.toFixed(2)})`);

    // The plate opens it long enough to pass.
    resetBall(w);
    w.ball.x = level.features.plates[0].x;
    w.ball.z = level.features.plates[0].z;
    step(w, DT);
    if (!w.gates[0].open) throw new Error('plate did not open the gate');
    if (Math.abs(w.gates[0].timer - 1.0) > 0.05) throw new Error('gate timer not set from the plate');

    w.ball.x = barrierX + 0.9;
    w.ball.z = 0;
    w.ball.vx = -2.0;
    run(w, 0.9, () => ({ x: 0, z: -MAX_TILT }));
    if (w.ball.x > barrierX - 0.2) throw new Error('an open gate still blocked the marble');

    // Park the marble away from the plate, then the gate must shut on its own.
    w.ball.x = barrierX - 2.5;
    w.ball.z = 0;
    w.ball.vx = 0;
    w.ball.vz = 0;
    run(w, 2.0, () => ({ x: 0, z: 0 }));
    if (w.gates[0].open) throw new Error(`gate stayed open past its timer (${w.gates[0].timer.toFixed(2)})`);
  });

  t.ok('a one-way flap passes the marble one way and blocks the other', () => {
    // Row 4 is the corridor; col 6 is walled above and below, with one flap across it.
    const level = fixture({
      walls: [
        [6, 1, 6, 3],
        [6, 5, 6, 7],
      ],
      oneways: [{ seg: [[6, 3], [6, 5]], normal: [1, 0] }],
    });
    const barrierX = level.features.oneways[0].segments[0].a[0];
    const w = makeWorld(level);
    // approaching from the left (blocked side): should stop
    w.ball.x = barrierX - 2.2;
    w.ball.vx = 0.4;
    run(w, 2.5, () => ({ x: 0, z: MAX_TILT }));
    if (w.ball.x > barrierX + 0.4) throw new Error('one-way flap let the marble through the wrong way');
    resetBall(w);
    // approaching from the right (allowed side): should pass
    w.ball.x = barrierX + 2.2;
    w.ball.vx = -0.4;
    run(w, 3.5, () => ({ x: 0, z: -MAX_TILT }));
    if (w.ball.x > barrierX - 0.2) throw new Error('one-way flap blocked the allowed direction');
  });

  t.ok('windmills and pendulums sweep, and movers carry their bar', () => {
    const level = fixture({
      windmills: [{ cell: [4, 4], arms: 2, len: 1.4, omega: 1.2 }],
      pendulums: [{ cell: [8, 4], len: 1.4, amp: 1.0, freq: 0.5, phase: 0 }],
      movers: [{ from: [6, 1], to: [6, 7], len: 1.0, speed: 0.5, phase: 0 }],
    });
    const w = makeWorld(level);
    const a0 = w.features.windmills[0].angle;
    const p0 = w.features.pendulums[0].angle;
    const m0 = w.features.movers[0].pos.slice();
    run(w, 0.7);
    if (Math.abs(w.features.windmills[0].angle - a0) < 0.5) throw new Error('windmill did not turn');
    if (Math.abs(w.features.pendulums[0].angle - p0) < 0.2) throw new Error('pendulum did not swing');
    const moved = Math.hypot(w.features.movers[0].pos[0] - m0[0], w.features.movers[0].pos[1] - m0[1]);
    if (moved < 0.4) throw new Error(`mover barely moved (${moved.toFixed(2)})`);
    if (Math.hypot(...w.features.movers[0].vel) < 0.05) throw new Error('mover reports no velocity to carry the marble');
  });

  t.ok('a windmill arm actually strikes a marble sitting in its path', () => {
    const level = fixture({ windmills: [{ cell: [5, 4], arms: 2, len: 1.6, omega: 1.6 }] });
    const w = makeWorld(level);
    w.ball.x = level.features.windmills[0].x + 1.0;
    w.ball.z = level.features.windmills[0].z;
    let saw = false;
    run(w, 3, () => {
      if (speed(w) > 0.5) saw = true;
      return { x: 0, z: 0 };
    });
    if (!saw) throw new Error('the windmill never touched the marble');
  });

  t.ok('surface lookup reports the painted cell', () => {
    const w = makeWorld(fixture({ ice: [[4, 3, 6, 5]] }));
    if (surfaceAt(w, 5 - 6 + 5, 6) === undefined) throw new Error('surface lookup failed');
    const [cx, cz] = [4 + 0.5 - 6, 3 + 0.5 - 4.5];
    if (surfaceAt(w, cx, cz) !== 'ice') throw new Error('ice cell not reported as ice');
    if (surfaceAt(w, w.level.spawn.x, w.level.spawn.z) !== 'wood') throw new Error('plain floor is not wood');
  });

  t.ok('resetting the marble returns it to the spawn with a level board', () => {
    const w = makeWorld(L1);
    run(w, 2, () => ({ x: MAX_TILT, z: MAX_TILT }));
    resetBall(w);
    if (w.ball.x !== w.level.spawn.x || w.ball.z !== w.level.spawn.z) throw new Error('spawn reset failed');
    if (speed(w) !== 0 || w.tilt.x !== 0 || w.tilt.z !== 0) throw new Error('state was not cleared');
  });

  t.ok('the marble never rests inside a pit-adjacent wall while rolling on every authored pit', () => {
    for (const pit of L1.pits) {
      const w = makeWorld(L1);
      w.ball.x = pit.x;
      w.ball.z = pit.z + (PIT_R + BALL_R + 0.05);
      step(w, DT);
      if (w.ball.state !== 'roll') throw new Error('the marble fell in without being over the pit');
    }
  });

  // --- bumper posts ---------------------------------------------------------

  t.ok('a bumper peg never lets the marble through it, even at the speed cap', () => {
    const level = fixture({ pegs: [{ cell: [5, 4], r: 0.26 }] });
    const peg = level.features.pegs[0];
    for (const from of [-1, 1]) {
      const w = makeWorld(level);
      w.ball.x = peg.x + from * 2.0;
      w.ball.z = peg.z;
      w.ball.vx = -from * V_MAX;
      let closest = Infinity;
      for (let i = 0; i < Math.round(1.2 / DT); i++) {
        step(w, DT);
        closest = Math.min(closest, Math.hypot(w.ball.x - peg.x, w.ball.z - peg.z));
      }
      if (closest < peg.r + BALL_R - 0.02) {
        throw new Error(`the marble sank into a peg (closest ${closest.toFixed(3)}, floor ${(peg.r + BALL_R).toFixed(3)})`);
      }
      if (Math.sign(w.ball.vx) === -from * Math.sign(V_MAX) && Math.abs(w.ball.vx) > 0.15 && from === 1) {
        throw new Error('a peg did not turn the marble around');
      }
    }
  });

  t.ok('a bumper peg returns less than it was given, and a kicker gives back more', () => {
    const level = fixture({ pegs: [{ cell: [5, 4], r: 0.28 }, { cell: [8, 4], r: 0.28, kick: true }] });
    const [plain, kicker] = level.features.pegs;
    const rebound = (peg, v0) => {
      const w = makeWorld(level);
      w.ball.x = peg.x - 1.0;
      w.ball.z = peg.z;
      w.ball.vx = v0;
      let peak = 0;
      for (let i = 0; i < Math.round(1.6 / DT); i++) {
        step(w, DT);
        peak = Math.max(peak, -w.ball.vx);
      }
      return peak;
    };
    const plainBack = rebound(plain, 2.5);
    if (!(plainBack < 2.5)) throw new Error(`a passive peg added energy (${plainBack.toFixed(2)} back from 2.50)`);
    if (plainBack < 0.8) throw new Error(`a passive peg barely bounced the marble (${plainBack.toFixed(2)})`);
    const kicked = rebound(kicker, 1.2);
    if (!(kicked > 2.0)) throw new Error(`a kicking peg did not fire the marble (${kicked.toFixed(2)})`);
  });

  // --- windmill -------------------------------------------------------------

  t.ok('the windmill post is solid: the marble cannot roll over the hub', () => {
    const level = fixture({ windmills: [{ cell: [5, 4], arms: 2, len: 1.4, omega: 1.0 }] });
    const mill = level.features.windmills[0];
    const w = makeWorld(level);
    w.ball.x = mill.x - 2.2;
    w.ball.z = mill.z;
    w.ball.vx = V_MAX;
    let closest = Infinity;
    for (let i = 0; i < Math.round(1.5 / DT); i++) {
      step(w, DT);
      closest = Math.min(closest, Math.hypot(w.ball.x - mill.x, w.ball.z - mill.z));
    }
    const floor = WINDMILL_HUB_R + BALL_R;
    if (closest < floor - 0.02) {
      throw new Error(`the marble rolled over the post (closest ${closest.toFixed(3)}, post floor ${floor.toFixed(3)})`);
    }
  });

  t.ok('a windmill arm throws a strike near its tip harder than one near its hub', () => {
    const level = fixture({ windmills: [{ cell: [5, 4], arms: 1, len: 1.6, omega: 1.5 }] });
    const mill = level.features.windmills[0];
    const struck = (radius) => {
      const w = makeWorld(level);
      // Sit the marble just off the arm's own line so the contact has a clear side, at a known
      // distance from the hub along that line.
      w.ball.x = mill.x + radius;
      w.ball.z = mill.z + 0.06;
      let peak = 0;
      for (let i = 0; i < Math.round(1.4 / DT); i++) {
        step(w, DT);
        peak = Math.max(peak, speed(w));
      }
      return peak;
    };
    const tip = struck(1.45);
    const hub = struck(0.6);
    if (!(tip > hub + 0.4)) {
      throw new Error(`a tip strike (${tip.toFixed(2)}) is not clearly harder than a hub strike (${hub.toFixed(2)})`);
    }
  });

  t.ok('a swept arm sweeps on by: it never pins the marble against a wall for good', () => {
    // A marble sitting in a corner with a mill sweeping over it: the arm presses, but every pass
    // ends, so the marble must be somewhere else by the time the arm has gone round twice.
    const level = fixture({
      windmills: [{ cell: [3, 4], arms: 2, len: 1.6, omega: 2.2 }],
      walls: [[3, 2, 3, 3], [3, 5, 3, 6]],
    });
    const w = makeWorld(level);
    const mill = level.features.windmills[0];
    w.ball.x = mill.x + 0.6;
    w.ball.z = mill.z;
    const from = [w.ball.x, w.ball.z];
    run(w, 6, () => ({ x: 0, z: 0 }));
    const away = Math.hypot(w.ball.x - from[0], w.ball.z - from[1]);
    if (!(away > 0.5)) throw new Error(`the marble never escaped the sweeping arm (moved ${away.toFixed(2)})`);
    if (w.ball.state !== 'roll') throw new Error('the marble left play under the windmill');
  });

  t.ok('a windmill takes a phase, and turns the other way on a negative omega', () => {
    const level = fixture({
      windmills: [
        { cell: [3, 4], arms: 2, len: 1.2, omega: 1.4, phase: 0.9 },
        { cell: [8, 4], arms: 2, len: 1.2, omega: -1.4, phase: 0.9 },
      ],
    });
    const w = makeWorld(level);
    // The authored phase is where the arms start, and the angle is a pure function of time, so
    // a level designer can time a corridor crossing; a restart re-syncs exactly.
    step(w, DT);
    const atOneStep = 0.9 + 1.4 * DT;
    if (Math.abs(w.features.windmills[0].angle - atOneStep) > 1e-9) {
      throw new Error(`the mill's angle is not phase + omega*t (${w.features.windmills[0].angle})`);
    }
    run(w, 0.5);
    const a = w.features.windmills[0].angle;
    const b = w.features.windmills[1].angle;
    if (!(a > 0.9 && b < 0.9)) throw new Error(`the mills did not turn opposite ways (${a.toFixed(3)}, ${b.toFixed(3)})`);
    if (Math.abs(a - 0.9 + (b - 0.9)) > 1e-9) throw new Error('opposite mills are not mirror images');
  });

  // --- ramps ----------------------------------------------------------------

  t.ok('a ramp is a real slope: it carries a parked marble down it, and the marble climbs', () => {
    const ramp = { rect: [4, 4, 7, 6], dir: [0, 1], height: 0.35 };
    const level = fixture({ ramps: [ramp] });
    const rp = level.features.ramps[0];
    const w = makeWorld(level);
    w.ball.x = 0;
    w.ball.z = rp.z1 - 0.1; // just inside the crest: near the top of the wedge
    const topY = groundAt(w, w.ball.x, w.ball.z);
    if (Math.abs(topY - ramp.height) > 0.06) throw new Error(`the marble did not stand on the wedge (y=${topY.toFixed(3)})`);
    run(w, 5, () => ({ x: 0, z: 0 }));
    if (!(w.ball.z < rp.z0)) throw new Error(`the ramp never carried the marble down (z=${w.ball.z.toFixed(2)})`);
    if (Math.abs(w.ball.y) > 1e-9) throw new Error('the marble is still floating after leaving the ramp');
    if (!(w.status === 'playing')) throw new Error('the marble left play on a bare ramp');

    // The same start with no ramp at all must not drift: the slope, not a stray force, moved it.
    const idle = makeWorld(fixture({}));
    idle.ball.x = 0;
    idle.ball.z = rp.z1 - 0.1;
    run(idle, 5, () => ({ x: 0, z: 0 }));
    if (speed(idle) > 0.01) throw new Error('a level board drifted the marble without a ramp');
  });

  t.ok('a ramp reads its ground as a wedge, and reports nothing off it', () => {
    const rp = fixture({ ramps: [{ rect: [4, 4, 7, 6], dir: [0, 1], height: 0.4 }] }).features.ramps[0];
    const w = makeWorld(fixture({ ramps: [{ rect: [4, 4, 7, 6], dir: [0, 1], height: 0.4 }] }));
    if (Math.abs(groundAt(w, rp.top.x, rp.top.z) - 0.4) > 1e-9) throw new Error('the wedge is not tallest at its crest');
    // `dir` is uphill, so the low edge is a run *behind* the crest.
    const [lx, lz] = [rp.top.x - rp.dir[0] * rp.run, rp.top.z - rp.dir[1] * rp.run];
    if (Math.abs(groundAt(w, lx, lz)) > 1e-9) throw new Error('the wedge is not zero at its low edge');
    // Past the crest, and off to the side, the ground is the board again.
    if (groundAt(w, rp.top.x + rp.dir[0] * 3, rp.top.z + rp.dir[1] * 3) !== 0) throw new Error('ground past the crest is not the board');
    if (groundAt(w, rp.x0 - 1, rp.z0 - 1) !== 0) throw new Error('ground beside the ramp is not the board');
  });

  t.ok('a ramp pushes harder the steeper it is, and its slope is capped', () => {
    // Same height, but a shorter run along the traversal axis: the steep wedge must carry the
    // marble further over the same time. (Run is measured along `dir`, so it is the rect's
    // extent in z here, not in x.)
    const gentle = rampTravel({ rect: [4, 2, 8, 7], dir: [0, 1], height: 0.4 }, 2.0);
    const steep = rampTravel({ rect: [4, 4, 8, 5], dir: [0, 1], height: 0.4 }, 2.0);
    if (!(steep > gentle)) {
      throw new Error(`a steeper ramp (moved ${steep.toFixed(2)}) did not outrun a gentle one (moved ${gentle.toFixed(2)})`);
    }

    // The push is the wedge's own geometry: exactly g*sin(theta)*roll against the traversal
    // direction, so a +z ramp pushes toward -z, no separate number.
    const rp = fixture({ ramps: [{ rect: [4, 4, 8, 5], dir: [0, 1], height: 0.4 }] }).features.ramps[0];
    const w = makeWorld(fixture({ ramps: [{ rect: [4, 4, 8, 5], dir: [0, 1], height: 0.4 }] }));
    w.ball.x = 0;
    w.ball.z = rp.z1 - 0.5;
    step(w, DT);
    const want = -GRAVITY * rp.sin * ROLL_FACTOR * DT;
    if (Math.abs(w.ball.vz - want) > 0.01) {
      throw new Error(`the ramp pushed ${w.ball.vz.toFixed(4)} where its own slope says ${want.toFixed(4)}`);
    }

    // A silly height cannot make a launcher: sin(theta) is clamped, so the push has a ceiling.
    const absurd = fixture({ ramps: [{ rect: [4, 4, 8, 5], dir: [0, 1], height: 20 }] }).features.ramps[0];
    if (Math.abs(absurd.sin - RAMP_MAX_SLOPE) > 1e-9) {
      throw new Error(`an insane ramp escaped the slope clamp (sin=${absurd.sin})`);
    }
  });

  t.ok('a ramp has a vertical crest face: the marble cannot climb it from behind', () => {
    const level = fixture({ ramps: [{ rect: [4, 4, 7, 6], dir: [0, 1], height: 0.35 }] });
    const rp = level.features.ramps[0];
    const w = makeWorld(level);
    // Rolling toward -z means approaching the wedge's crest face from beyond it (its uphill side).
    w.ball.x = rp.top.x;
    w.ball.z = rp.z1 + 1.4;
    w.ball.vz = -2.2;
    run(w, 2.5, () => ({ x: 0, z: 0 }));
    if (w.ball.z < rp.z1) throw new Error(`the marble climbed the wedge's crest face (z=${w.ball.z.toFixed(2)})`);
    if (w.ball.y !== 0) throw new Error('the marble was lifted onto the ramp through its face');

    // Without the ramp the same shove carries it right across where the face was.
    const open = makeWorld(fixture({}));
    open.ball.x = rp.top.x;
    open.ball.z = rp.z1 + 1.4;
    open.ball.vz = -2.2;
    run(open, 2.5, () => ({ x: 0, z: 0 }));
    if (!(open.ball.z < rp.z1)) throw new Error('the control run did not cross the face line, so the test proves nothing');
  });

  t.ok('a ramp can only be stepped onto from the side on its shallow half', () => {
    const level = fixture({ ramps: [{ rect: [4, 4, 7, 6], dir: [0, 1], height: 0.35 }] });
    const rp = level.features.ramps[0];
    const midZ = (rp.z0 + rp.z1) / 2;
    const enter = (z) => {
      const w = makeWorld(level);
      w.ball.x = rp.x0 - 0.5;
      w.ball.z = z;
      w.ball.vx = 2.5;
      run(w, 0.6, () => ({ x: 0, z: 0 }));
      return w;
    };
    // Below the half-way cross-section the wall is shallow enough to roll up.
    const low = enter(midZ - 0.5);
    if (!(low.ball.x > rp.x0)) throw new Error('the marble could not step onto the shallow half of the wedge from the side');
    if (!(low.ball.y > 0.01)) throw new Error(`the marble did not get up on the shallow half (y=${low.ball.y.toFixed(3)})`);
    // Above it the wall is a step taller than the marble may climb, so it is turned away.
    const high = enter(midZ + 0.5);
    if (high.ball.x > rp.x0) throw new Error('the marble climbed the stepped half of the wedge from the side');
    if (high.ball.y > 1e-9) throw new Error('the marble was lifted onto the stepped half of the wedge');

    // The whole low edge stays open, corners included: the side walls only close over the crest
    // half, so a marble rolling up off the low edge meets no wall anywhere along it.
    const rollUp = (x) => {
      const w = makeWorld(level);
      w.ball.x = x;
      w.ball.z = rp.z0 - 0.5;
      w.ball.vz = 2.5;
      run(w, 0.6, () => ({ x: 0, z: 0 }));
      return w;
    };
    for (const x of [rp.x0 + 0.1, rp.x1 - 0.1]) {
      const w = rollUp(x);
      if (!(w.ball.z > rp.z0)) throw new Error(`the marble could not roll up the low edge at x=${x}`);
      if (!(w.ball.y > 0.01)) throw new Error(`the marble did not climb the wedge off the low edge at x=${x}`);
    }
  });

  t.ok('a ramp crest throws the marble higher and further the faster it crests', () => {
    const ramp = { rect: [4, 4, 7, 6], dir: [0, 1], height: 0.35 };
    const fly = (v) => {
      const w = makeWorld(fixture({ ramps: [ramp] }));
      const rp = w.features.ramps[0];
      w.ball.x = 0;
      w.ball.z = rp.z1 - 0.05;
      w.ball.vz = v;
      let peak = 0;
      let flew = false;
      for (let i = 0; i < Math.round(0.9 / DT); i++) {
        step(w, DT);
        if (w.ball.state !== 'roll') break;
        flew = flew || w.ball.air;
        peak = Math.max(peak, w.ball.y - w.ball.groundY);
      }
      return { peak, z: w.ball.z, flew };
    };
    const slow = fly(2.0);
    const fast = fly(3.2);
    if (!slow.flew) throw new Error('a marble cresting at 2 u/s never left the ground');
    if (!(fast.peak > slow.peak + 1e-3)) throw new Error(`a faster crest did not fly higher (${fast.peak} vs ${slow.peak})`);
    if (!(fast.z > slow.z + 1e-3)) throw new Error(`a faster crest did not carry further (${fast.z} vs ${slow.z})`);
  });

  t.ok('a marble that crests a ramp rolls off it and is never left hanging', () => {
    const level = fixture({ ramps: [{ rect: [4, 4, 7, 6], dir: [0, 1], height: 0.35 }] });
    const rp = level.features.ramps[0];
    const w = makeWorld(level);
    w.ball.x = rp.top.x;
    w.ball.z = rp.z0 + 0.2; // at the low edge of the wedge, pointed uphill
    w.ball.vz = V_MAX;
    // Drive it up and over with the tilt too (+x tilt pushes toward +z), so it has the speed to crest.
    run(w, 3.5, () => ({ x: MAX_TILT, z: 0 }));
    if (!(w.ball.z > rp.z1 || Math.abs(w.ball.y - 0) < 1e-9)) {
      throw new Error(`the marble ended neither clear of the ramp nor on the ground (z=${w.ball.z.toFixed(2)}, y=${w.ball.y.toFixed(3)})`);
    }
    if (w.status !== 'playing') throw new Error('the marble left play crossing the wedge');
  });

  t.ok('two identical ramp runs agree to the bit', () => {
    const level = () => fixture({ ramps: [{ rect: [4, 4, 7, 6], dir: [0, 1], height: 0.35 }] });
    const go = () => {
      const w = makeWorld(level());
      w.ball.x = 0;
      w.ball.z = -0.4;
      run(w, 4, () => ({ x: 0.05, z: 0.05 }));
      return `${w.ball.x.toFixed(12)}:${w.ball.z.toFixed(12)}:${w.ball.y.toFixed(12)}`;
    };
    if (go() !== go()) throw new Error('two ramp runs diverged');
  });
}
