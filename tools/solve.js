// Run the tilt autopilot over every authored level and report how it went.
// This is the same solver the test suite uses, exposed for tuning by hand.
import { LEVELS, buildLevel } from '../src/engine/levels.js';
import { solveLevel } from '../src/engine/autopilot.js';

const only = process.argv[2];
let worst = 0;
for (const spec of LEVELS) {
  if (only && spec.id !== only) continue;
  const level = buildLevel(spec);
  if (spec.coop) {
    console.log(`${level.id.padEnd(16)} ${'coop (single-marble pilot N/A)'.padEnd(32)} sees tests/lifts.test.js`);
    continue;
  }
  const res = solveLevel(level, { maxSeconds: 180 });
  const status = res.ok ? 'solved' : `FAILED (${res.reason})`;
  console.log(
    `${level.id.padEnd(16)} ${status.padEnd(18)} ${res.ok ? res.time.toFixed(1) : res.world.time.toFixed(1)}s / par ${level.par}s  falls ${res.world.falls}  top speed ${res.world.maxSpeedSeen.toFixed(2)}`,
  );
  if (res.ok) worst = Math.max(worst, res.time);
}
console.log(`slowest run: ${worst.toFixed(1)}s`);
process.exit(0);
