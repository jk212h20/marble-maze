//  Bake tuned numbers into the shipped defaults.
//
//  Usage:
//    node tools/bake-tuning.js '<json from the copy JSON button>'
//    node tools/bake-tuning.js --file /tmp/physics.json --write
//
//  Without --write it only reports what would change. With --write it rewrites
//  src/engine/constants.js, and `npm test` then verifies the defaults and the slider
//  ranges still agree (tests/tuning.test.js).
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_TUNING, flattenTuning, loadTuningJSON, resetTuning, TUNING, isCustomised, diffFromDefaults } from '../src/engine/tuning.js';

const args = process.argv.slice(2);
const fileIdx = args.indexOf('--file');
const write = args.includes('--write');
let json = null;
if (fileIdx >= 0) json = fs.readFileSync(args[fileIdx + 1], 'utf8');
else json = args.find((a) => a.trim().startsWith('{'));

if (!json) {
  console.error('Give me the JSON from the tuning panel (copy JSON button), or --file <path>.');
  process.exit(2);
}

const res = loadTuningJSON(json);
if (!res.ok) {
  console.error(`Could not read that tuning JSON: ${res.error}`);
  process.exit(2);
}
if (res.unknown?.length) {
  console.error(`Ignoring unknown keys: ${res.unknown.join(', ')}`);
}

const CONST_NAME = {
  gravity: 'GRAVITY',
  roll: 'ROLL_FACTOR',
  vMax: 'V_MAX',
  maxTilt: 'MAX_TILT',
  tiltRate: 'TILT_RATE',
  tiltReturn: 'TILT_RETURN',
  wallRestitution: 'WALL_RESTITUTION',
  wallFriction: 'SURFACES.wood.mu',
  pegRestitution: 'PEG_RESTITUTION',
  kickerImpulse: 'KICKER_IMPULSE',
  windmillSweep: 'WINDMILL_SWEEP',
  pitCapture: 'PIT_CAPTURE',
  goalCapture: 'GOAL_CAPTURE',
  ballR: 'BALL_R',
  conveyorSpeed: 'CONVEYOR_SPEED',
  ventAccel: 'VENT_ACCEL',
  magnetStrength: 'MAGNET_STRENGTH',
  teleportR: 'TELEPORT_R',
  teleportCooldown: 'TELEPORT_COOLDOWN',
  gateOpenTime: 'GATE_OPEN_TIME',
  'surfaces.wood.drag': 'SURFACES.wood.drag',
  'surfaces.wood.roll': 'SURFACES.wood.roll',
  'surfaces.wood.mu': 'SURFACES.wood.mu',
  'surfaces.ice.drag': 'SURFACES.ice.drag',
  'surfaces.ice.roll': 'SURFACES.ice.roll',
  'surfaces.sand.drag': 'SURFACES.sand.drag',
  'surfaces.sand.roll': 'SURFACES.sand.roll',
  'surfaces.steel.drag': 'SURFACES.steel.drag',
};

export function constantFor(path) {
  return CONST_NAME[path] ?? null;
}

const tuned = flattenTuning(TUNING);
const changes = [];
for (const [key, value] of Object.entries(tuned)) {
  const name = constantFor(key);
  if (!name) continue;
  const before = DEFAULT_TUNING[key.split('.')[0]] ?? null;
  const oldValue = key.includes('.') ? key.split('.').reduce((o, k) => o[k], DEFAULT_TUNING) : before;
  if (Number(oldValue) !== Number(value)) changes.push({ key, name, from: oldValue, to: value });
}

if (!changes.length) {
  console.log(isCustomised() ? 'Nothing to bake: your changes are all outside the baked set.' : 'Nothing to bake: these are the shipped numbers.');
  resetTuning();
  process.exit(0);
}

console.log(`${changes.length} value(s) to bake:\n`);
for (const c of changes) console.log(`  ${c.name.padEnd(22)} ${String(c.from).padStart(9)} -> ${c.to}`);
console.log('');

if (!write) {
  console.log('Dry run. Add --write to update src/engine/constants.js.');
  resetTuning();
  process.exit(0);
}

const file = path.join(import.meta.dirname, '..', 'src', 'engine', 'constants.js');
let src = fs.readFileSync(file, 'utf8');
let missed = [];
for (const c of changes) {
  if (c.name.startsWith('SURFACES.')) {
    const [, surface, field] = c.name.split('.');
    const re = new RegExp(`(${surface}:\\\s*\\\{[^}]*?${field}:\\\s*)(-?[\\\d.]+)`, 's');
    if (!re.test(src)) {
      missed.push(c.name);
      continue;
    }
    src = src.replace(re, `$1${c.to}`);
  } else {
    // A number is written bare; a choice (the indicator mode) is written as a quoted string.
    const literal = typeof c.to === 'number' ? String(c.to) : `'${String(c.to)}'`;
    const re = new RegExp(`(export const ${c.name} = )(?:-?[\\d.]+|'[^']*')(;)`);
    if (!re.test(src)) {
      missed.push(c.name);
      continue;
    }
    src = src.replace(re, `$1${literal}$2`);
  }
}
fs.writeFileSync(file, src);
resetTuning();

if (missed.length) {
  console.error(`\nCould not rewrite: ${missed.join(', ')} — patch those by hand.`);
  process.exit(1);
}
console.log('Wrote src/engine/constants.js. Now run: node tests/run.js');
