// A level may hold more than one marble, and every marble must reach the goal to win.
//
// These checks pin the engine half of that feature: the world builds one marble per authored
// spawn, the run is only won once they are ALL home, a marble that falls returns on its own
// without disturbing the others, and two marbles collide rather than pass through each other.
import { LEVELS, buildLevel } from '../src/engine/levels.js';
import { makeWorld, step, resetBall, homeCount, allHome, speed } from '../src/engine/physics.js';
import { DT, BALL_R } from '../src/engine/constants.js';

export const name = 'multi-marble';

const levels = LEVELS.map(buildLevel);
const twin = levels.find((lv) => lv.id === 'twin-track');
const single = levels.find((lv) => lv.id === 'first-tilt');

/** Step the world for `seconds`, keeping the board level unless a test drives it. */
const run = (world, seconds) => {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) step(world, DT);
};

/** Drop a marble straight onto the goal so the next step captures it. */
const toGoal = (world, ball) => {
  ball.x = world.level.goal.x;
  ball.z = world.level.goal.z;
  ball.vx = 0;
  ball.vz = 0;
  ball.vy = 0;
  ball.air = false;
  ball.y = 0;
};

export function tests(t) {
  t.ok('a multi-marble level builds one marble per authored spawn', () => {
    const world = makeWorld(twin);
    if (world.balls.length !== twin.spawns.length) throw new Error(`${world.balls.length} balls for ${twin.spawns.length} spawns`);
    if (world.balls.length < 2) throw new Error('the twin-track level did not build multiple marbles');
    world.balls.forEach((b, i) => {
      if (b.i !== i) throw new Error('marble index is not its slot');
      if (b.state !== 'roll') throw new Error(`marble ${i} did not start rolling`);
    });
  });

  t.ok('a single-marble level is unchanged: exactly one marble', () => {
    const world = makeWorld(single);
    if (world.balls.length !== 1) throw new Error(`${world.balls.length} marbles on a single-marble level`);
    if (world.ball !== world.balls[0]) throw new Error('`world.ball` is not the sole marble');
  });

  t.ok('one marble in the cup does NOT win a two-marble level', () => {
    const world = makeWorld(twin);
    toGoal(world, world.balls[0]);
    step(world, DT);
    if (world.balls[0].state !== 'sinking' && world.balls[0].state !== 'won') throw new Error('the first marble did not enter the cup');
    if (world.status === 'won') throw new Error('the run was won with a marble still on the board');
    if (allHome(world)) throw new Error('allHome() lied about a marble still in play');
    if (homeCount(world) !== 1) throw new Error(`homeCount should be 1, got ${homeCount(world)}`);
  });

  t.ok('the run is won once every marble is home', () => {
    const world = makeWorld(twin);
    toGoal(world, world.balls[0]);
    step(world, DT);
    toGoal(world, world.balls[1]);
    step(world, DT);
    if (!allHome(world)) throw new Error('both marbles are in the cup but allHome() is false');
    if (world.status !== 'won') throw new Error(`status is ${world.status}, expected won`);
  });

  t.ok('a marble that falls can return on its own without moving its fellows', () => {
    const world = makeWorld(twin);
    const [a, b] = world.balls;
    // Send the second marble on its way down the open central lane, then drop the first.
    b.x = 2.0;
    b.z = world.level.goal.z;
    b.vx = 1.2;
    const bx = b.x;
    const bz = b.z;
    a.x = world.pits[0]?.x ?? -100; // twin-track has no pits, so fall off the board instead
    a.z = world.pits[0]?.z ?? a.z;
    // No pits on this level: simulate the fall directly (a fast sink so it is dead quickly).
    a.state = 'falling';
    a.vy = -3;
    a.fallCause = { type: 'pit', x: a.x, z: a.z };
    run(world, 0.6);
    if (a.state !== 'dead') throw new Error(`the fallen marble is ${a.state}, expected dead`);
    // Put only that one back.
    resetBall(world, a);
    if (a.state !== 'roll') throw new Error('the fallen marble did not return to a roll');
    if (a.x !== twin.spawns[0].x || a.z !== twin.spawns[0].z) throw new Error('the fallen marble did not return to its own spawn');
    // The other marble kept its momentum: it did not get recentred or zeroed by the reset.
    if (b.state !== 'roll') throw new Error('the untouched marble left the roll');
    if (Math.abs(b.vx) < 0.2) throw new Error('the reset zeroed the other marble\'s velocity');
    if (b.x === bx && b.z === bz) throw new Error('the other marble did not keep moving');
  });

  t.ok('a full reset puts every marble back on its own spawn', () => {
    const world = makeWorld(twin);
    world.balls[0].x = 7;
    world.balls[0].vx = 2;
    world.balls[1].z = 1;
    world.balls[1].vz = -3;
    resetBall(world);
    world.balls.forEach((b, i) => {
      if (b.x !== twin.spawns[i].x || b.z !== twin.spawns[i].z) throw new Error(`marble ${i} not on its spawn`);
      if (speed(world) !== 0 && i === 0) throw new Error('reset left speed behind');
      if (b.state !== 'roll') throw new Error(`marble ${i} is ${b.state}`);
    });
    if (world.status !== 'playing') throw new Error('a full reset did not clear the run status');
  });

  t.ok('two marbles collide instead of passing through each other', () => {
    const world = makeWorld(twin);
    const [a, b] = world.balls;
    // Place them overlapping and closing head-on.
    a.x = -1;
    a.z = 0;
    a.vx = 1.5;
    a.vz = 0;
    b.x = -1 + BALL_R * 1.2;
    b.z = 0;
    b.vx = -1.5;
    b.vz = 0;
    step(world, DT);
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    if (d < BALL_R * 2 - 1e-6) throw new Error(`marbles overlapped after a step (d ${d.toFixed(3)} < ${(BALL_R * 2).toFixed(3)})`);
    // Head-on equal masses: the one that was moving right is now moving left, and vice versa.
    if (a.vx > 0) throw new Error('the left marble kept driving right through the other');
    if (b.vx < 0) throw new Error('the right marble kept driving left through the other');
  });

  t.ok('the same two-marble run is reproducible down to the bit', () => {
    const go = () => {
      const world = makeWorld(twin);
      // A fixed, deterministic push so the run exercises collisions and the funnel.
      for (let i = 0; i < 400; i++) {
        world.control.z = 0.22;
        world.control.x = 0;
        step(world, DT);
      }
      return world.balls.map((b) => `${b.x.toFixed(9)},${b.z.toFixed(9)},${b.state}`).join(';');
    };
    if (go() !== go()) throw new Error('two-marble runs diverge');
  });
}
