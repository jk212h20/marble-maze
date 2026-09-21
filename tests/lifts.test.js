// Plate-driven wall slabs ("lifts").
//
// A lift is a wall a pressure plate raises out of the floor or sinks back into it *while the
// plate is held*. Unlike a gate it has no timer: its height is exactly what the plate's state
// says, so a marble standing on the plate holds the wall where it is. These checks pin the
// engine half of that - both modes, the return to rest, and the fact that a lift answers to the
// plate itself rather than to a gate - and then prove the shipped cooperative level, both-locks,
// is completable by a two-marble plan and not by a greedy one.
import { LEVELS, buildLevel } from '../src/engine/levels.js';
import { makeWorld, step, allHome } from '../src/engine/physics.js';
import { DT, LIFT_SOLID, LIFT_HALF_W } from '../src/engine/constants.js';

export const name = 'lifts';

/** A one-cell-high corridor along row 4, with a lift bar across col 5 and a plate at col 2. */
function fixture(mode) {
  return buildLevel({
    id: 'fixture',
    name: 'Fixture',
    shape: 'Rectangle',
    difficulty: 1,
    par: 30,
    hint: 'test',
    board: { shape: 'rect', w: 12, h: 9 },
    walls: [
      [5, 1, 5, 3],
      [5, 5, 5, 7],
    ],
    spawn: [1, 4],
    goal: [10, 4],
    // A plate with no gate at all: a lift must read the press, not a gate that does not exist.
    buttons: [{ id: 'p1', cell: [2, 4] }],
    lifts: [{ id: 'w1', seg: [[5, 3], [5, 5]], plate: 'p1', mode }],
  });
}

/** Step for `seconds` with the board level. */
function run(world, seconds) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    world.control.x = 0;
    world.control.z = 0;
    step(world, DT);
  }
}

/** Put the marble exactly on the plate (or off it) and take a step so the press is recorded. */
function place(world, x, z) {
  world.ball.x = x;
  world.ball.z = z;
  world.ball.vx = 0;
  world.ball.vz = 0;
  step(world, DT);
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Steer one marble toward a point with a proportional tilt, the way a hand would, and stop when
 * it is close. `control.z` drives +x and `control.x` drives +z, matching the engine's tilt map.
 */
function drive(world, ball, tx, tz, seconds, tol = 0.24, gain = 1.6) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const dx = tx - ball.x;
    const dz = tz - ball.z;
    world.control.z = clamp(gain * dx, -0.62, 0.62);
    world.control.x = clamp(gain * dz, -0.62, 0.62);
    step(world, DT);
    if (Math.hypot(dx, dz) < tol) return true;
  }
  return Math.hypot(tx - ball.x, tz - ball.z) < tol;
}

export function tests(t) {
  t.ok('a lowering lift rests as a wall, sinks under a marble on its plate, and rises again', () => {
    const lv = fixture('lower');
    const w = makeWorld(lv);
    const lift = w.features.lifts[0];
    if (!(lift.height >= LIFT_SOLID && lift.solid)) throw new Error('a `lower` lift did not rest raised');

    const p = lv.features.plates[0];
    place(w, p.x, p.z);
    run(w, 0.4);
    if (w.features.lifts[0].solid) throw new Error(`the wall stayed up with the plate held (h=${w.features.lifts[0].height.toFixed(2)})`);

    // Leave the plate: the wall comes back on its own, with no timer to wait out.
    place(w, p.x - 2.5, p.z);
    run(w, 0.6);
    const back = w.features.lifts[0];
    if (!back.solid || back.height < 1 - 1e-6) throw new Error(`the wall did not return to rest (h=${back.height.toFixed(2)})`);
  });

  t.ok('a raising lift rests flush and stands up into a wall while its plate is held', () => {
    const lv = fixture('raise');
    const w = makeWorld(lv);
    const lift = w.features.lifts[0];
    if (lift.height !== 0 || lift.solid) throw new Error('a `raise` lift did not rest flush');

    const p = lv.features.plates[0];
    place(w, p.x, p.z);
    run(w, 0.4);
    const up = w.features.lifts[0];
    if (!up.solid || up.height < 1 - 1e-6) throw new Error(`the slab did not stand up under a held plate (h=${up.height.toFixed(2)})`);

    place(w, p.x - 2.5, p.z);
    run(w, 0.6);
    if (w.features.lifts[0].solid) throw new Error('a raised lift stayed up after the plate was released');
  });

  t.ok('a lift answers to the plate, so a plate with no gate still drives a wall', () => {
    // Both fixtures above give their plate no `gate` at all; if a lift looked for a gate it would
    // never move, so the two checks above already prove this. This one pins the parenthetical:
    // there is no gate in the level for the lift to have found.
    const lv = fixture('lower');
    if ((lv.spec.gates ?? []).length) throw new Error('the fixture grew a gate');
    if (lv.spec.buttons[0].gate) throw new Error('the fixture plate named a gate');
    const w = makeWorld(lv);
    const p = lv.features.plates[0];
    place(w, p.x, p.z);
    run(w, 0.4);
    if (w.features.lifts[0].solid) throw new Error('the wall did not read the gate-less plate');
  });

  t.ok('a lift is cut from the metal of the plate that drives it, and defaults to brass', () => {
    const steel = buildLevel({
      id: 'fixture',
      name: 'Fixture',
      shape: 'Rectangle',
      difficulty: 1,
      par: 30,
      hint: 'test',
      board: { shape: 'rect', w: 12, h: 9 },
      walls: [
        [5, 1, 5, 3],
        [5, 5, 5, 7],
      ],
      spawn: [1, 4],
      goal: [10, 4],
      buttons: [{ id: 'p1', cell: [2, 4], metal: 'gunmetal' }],
      lifts: [{ id: 'w1', seg: [[5, 3], [5, 5]], plate: 'p1', mode: 'raise' }],
    });
    if (steel.features.plates[0].metal !== 'gunmetal') throw new Error('the plate metal was not kept');
    if (steel.features.lifts[0].metal !== 'gunmetal') throw new Error('the wall did not take its plate\u2019s metal');
    // A level authored before metals existed names none, and stays brass.
    if (fixture('raise').features.lifts[0].metal !== 'brass') throw new Error('a silent lift is not brass');
  });

  t.ok('a rising wall pushes a marble off toward whichever side it is more on', () => {
    const lv = fixture('raise');
    const w = makeWorld(lv);
    const seg = w.features.lifts[0].segments[0];
    const line = seg.a[0]; // a raise-mode slab rests flush, so its collision line is what grows
    const midZ = (seg.a[1] + seg.b[1]) / 2;
    const plate = w.features.plates[0];
    const shove = (offset) => {
      for (const l of w.features.lifts) {
        l.height = 0;
        l.solid = false;
        l.rising = false;
      }
      const b = w.ball;
      b.x = line + offset;
      b.z = midZ;
      b.vx = 0;
      b.vz = 0;
      b.y = 0;
      for (let i = 0; i < Math.round(0.6 / DT); i++) {
        plate.pressed = true; // hold the plate for this standing marble
        w.control.x = 0;
        w.control.z = 0;
        step(w, DT);
      }
      return b.x - line;
    };
    const right = shove(0.2);
    if (right < LIFT_HALF_W * 0.8) throw new Error(`a marble on the +x side was not pushed that way (${right.toFixed(3)})`);
    const left = shove(-0.2);
    if (left > -LIFT_HALF_W * 0.8) throw new Error(`a marble on the -x side was not pushed that way (${left.toFixed(3)})`);
  });

  const bothLocks = () => buildLevel(LEVELS.find((l) => l.id === 'both-locks'));

  t.ok('both-locks builds with two marbles, one plate and both lift modes', () => {
    const lv = bothLocks();
    if (lv.spawns.length !== 2) throw new Error(`${lv.spawns.length} spawns`);
    const modes = lv.features.lifts.map((l) => l.mode).sort();
    if (modes.join(',') !== 'lower,raise') throw new Error(`lift modes were ${modes.join(',')}`);
    for (const l of lv.features.lifts) {
      if (!lv.features.plates.some((p) => p.id === l.plate)) throw new Error(`lift ${l.id} names a missing plate ${l.plate}`);
    }
  });

  t.ok('both-locks is solvable: hold the plate for the right marble, then the holder goes last', () => {
    const lv = bothLocks();
    const w = makeWorld(lv);
    const p = lv.features.plates[0];
    const [a, b] = w.balls;

    // A waits on the plate. That first opens B's door and bars A's own.
    if (!drive(w, a, p.x, p.z, 6)) throw new Error(`the left marble did not reach the plate (${a.x.toFixed(2)},${a.z.toFixed(2)})`);
    run(w, 0.4);
    const doors = w.features.lifts;
    const doorB = doors.find((l) => l.id === 'door-b');
    const doorA = doors.find((l) => l.id === 'door-a');
    if (doorB.solid) throw new Error('the neighbour door did not sink with the plate held');
    if (!doorA.solid) throw new Error('the holder door did not rise with the plate held');

    // B rolls through the opened door to the cup while A keeps the plate down.
    if (!drive(w, b, lv.goal.x, lv.goal.z, 14)) throw new Error(`the right marble did not reach the cup (${b.x.toFixed(2)},${b.z.toFixed(2)})`);
    run(w, 1.2);
    if (b.state !== 'won' && b.state !== 'sinking') throw new Error(`the right marble did not settle (${b.state})`);

    // A steps off the plate (release), which drops its own bar, then follows to the cup.
    if (!drive(w, a, -6.2, lv.goal.z, 4)) throw new Error('the left marble did not step out of the alcove');
    if (!drive(w, a, lv.goal.x, lv.goal.z, 10)) throw new Error(`the left marble did not reach the cup (${a.x.toFixed(2)},${a.z.toFixed(2)})`);
    run(w, 2.0);
    if (!allHome(w) || w.status !== 'won') throw new Error(`the run did not win (${w.status})`);
  });

  t.ok('both-locks is a real two-marble plan: send the holder home first and the other is stranded', () => {
    const lv = bothLocks();
    const w = makeWorld(lv);
    const [a, b] = w.balls;
    // Greedy order: A ignores the plate and takes its own (open) door straight to the cup.
    if (!drive(w, a, lv.goal.x, lv.goal.z, 12)) throw new Error('the left marble could not take its own door');
    run(w, 1.2);
    if (a.state !== 'won' && a.state !== 'sinking') throw new Error(`the greedy marble did not settle (${a.state})`);
    // With nobody on the plate, B's door is a wall: B cannot finish, so the run cannot win.
    drive(w, b, lv.goal.x, lv.goal.z, 10);
    if (allHome(w)) throw new Error('the greedy order still won, so the plate is not load-bearing');
    if (b.state === 'won' || b.state === 'sinking') throw new Error('the stranded marble reached the cup through a shut door');
  });
}
