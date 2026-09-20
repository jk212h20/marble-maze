// Does level 1 actually *play*? A tilt autopilot — which may only move the board, never
// the marble — has to finish the level from the spawn, without falling in a pit.
import { LEVELS, buildLevel } from '../src/engine/levels.js';
import { makeWorld, step, speed } from '../src/engine/physics.js';
import { makePilot, pilotRun, plan } from '../src/engine/autopilot.js';
import { MAX_TILT, DT } from '../src/engine/constants.js';

export const name = 'solver';

const levels = LEVELS.map(buildLevel);

//  A *cooperative* level (`spec.coop`) is one whose solution needs one marble to hold a plate
//  for another. This autopilot steers whichever marble is still rolling straight at the cup and
//  has no notion of waiting on a plate, so it cannot solve one by construction - it is not a
//  broken level, it is a two-marble plan. Those levels are proven completable by a scripted
//  cooperative run instead (tests/lifts.test.js), which is a stronger probe than the pilot.
const solvable = levels.filter((lv) => !lv.spec.coop);

export function tests(t) {
  t.ok('a tilt autopilot can finish every authored level without a single fall', () => {
    for (const lv of solvable) {
      const world = makeWorld(lv);
      const pilot = makePilot(world, { maxSeconds: 150 });
      if (!plan(pilot)) throw new Error(`${lv.id}: no route found from the spawn`);
      const res = pilotRun(pilot, 150);
      if (!res.ok) {
        throw new Error(
          `${lv.id}: autopilot failed (${res.reason}) with the marble at ${world.ball.x.toFixed(2)},${world.ball.z.toFixed(2)} after ${world.time.toFixed(1)}s`,
        );
      }
      if (world.falls !== 0) throw new Error(`${lv.id}: autopilot fell ${world.falls} time(s)`);
      if (world.time > lv.par * 4) throw new Error(`${lv.id}: took ${world.time.toFixed(1)}s, far over par ${lv.par}`);
    }
  });

  t.ok('the autopilot run is reproducible down to the bit', () => {
    const lv = levels[0];
    const go = () => {
      const world = makeWorld(lv);
      const pilot = makePilot(world, {});
      plan(pilot);
      const res = pilotRun(pilot, 150);
      return `${res.ok}:${world.time.toFixed(6)}:${world.ball.x.toFixed(9)}`;
    };
    if (go() !== go()) throw new Error('autopilot runs diverge');
  });

  t.ok('the level cannot be finished by leaving the board alone', () => {
    const lv = levels[0];
    const world = makeWorld(lv);
    const steps = Math.round(lv.par * 2 / DT);
    for (let i = 0; i < steps; i++) step(world, DT);
    if (world.status === 'won') throw new Error('the marble reached the goal with a level board');
    if (speed(world) > 0.01) throw new Error('the marble drifted on a level board');
  });

  t.ok('the marbles hazards are real: deliberately driving at a pit loses the marble', () => {
    const lv = levels[0];
    const world = makeWorld(lv);
    const pit = world.pits.find((p) => p.cell[1] === 9) ?? world.pits[0];
    // aim straight at the pit from a little to its left along the same lane
    world.ball.x = pit.x - 1.4;
    world.ball.z = pit.z;
    const steps = Math.round(3 / DT);
    let died = false;
    for (let i = 0; i < steps; i++) {
      // steer toward the pit
      const dx = pit.x - world.ball.x;
      const dz = pit.z - world.ball.z;
      world.control.z = Math.sign(dx) * MAX_TILT;
      world.control.x = Math.sign(dz) * MAX_TILT;
      step(world, DT);
      if (world.ball.state === 'dead') died = true;
    }
    if (!died) throw new Error('rolling straight into a pit did not lose the marble');
  });

  t.ok('a marble that is nudged into the corner can always be recovered', () => {
    const lv = levels[0];
    const world = makeWorld(lv);
    // jam it in the bottom-right corner of the playable area, against both walls
    world.ball.x = lv.w / 2 - 1 - 0.26;
    world.ball.z = lv.h / 2 - 1 - 0.26;
    const pilot = makePilot(world, {});
    plan(pilot);
    const res = pilotRun(pilot, 150);
    if (!res.ok) throw new Error(`autopilot could not get a cornered marble home (${res.reason})`);
  });

  t.ok('two authored routes exist on First Tilt, so a mistake is survivable', () => {
    const lv = levels[0];
    // Count distinct first moves from the spawn, which is what "there is another way round" means.
    const exits = new Set();
    const [sc, sr] = lv.spawn.cell;
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const c = sc + dc;
      const r = sr + dr;
      if (c >= 0 && r >= 0 && c < lv.w && r < lv.h) {
        const ch = lv.grid[r][c];
        if (ch !== '#' && ch !== ' ') exits.add(`${c},${r}`);
      }
    }
    if (exits.size < 2) throw new Error(`spawn only has ${exits.size} way out`);
    if (!lv.spec.twoRoutes) throw new Error('level 1 is no longer marked as a two-route level');
  });
}
