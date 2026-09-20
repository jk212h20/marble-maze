// Level editor — headless validation of an exported level spec, using the game's engine.
//
//   node tools/level-editor/check.mjs <level.json>
//   node tools/level-editor/check.mjs --level <id>
//   node tools/level-editor/check.mjs --list
//
// Exit code 1 when an error-level rule fails.
//
// The autopilot solver is deliberately not wired in here. It has not kept up with the engine
// (vials, slot pits, sub-unit placement, a growing obstacle vocabulary), so a solved or
// not-solved verdict from it would mislead. `--solve` only says so; use the engine's own suite
// (node tests/run.js) if you want the autopilot exercised.

import fs from 'node:fs';
import { specToDraft } from './model.js';
import { validateDraft, summarise } from './validate.js';
import { LEVELS } from '../../src/engine/levels.js';

const args = process.argv.slice(2);

if (args.includes('--list')) {
  for (const l of LEVELS) console.log(`${l.id.padEnd(16)} ${l.name}`);
  process.exit(0);
}

const wantsSolve = args.includes('--solve');
const levelIndex = args.findIndex((a) => a === '--level' || a.startsWith('--level='));
const file = args.find((a) => !a.startsWith('--'));

let spec;
if (levelIndex >= 0) {
  const arg = args[levelIndex];
  const id = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[levelIndex + 1];
  spec = LEVELS.find((l) => l.id === id);
  if (!spec) {
    console.error(`no shipped level with id '${id}'`);
    process.exit(2);
  }
} else if (file) {
  spec = JSON.parse(fs.readFileSync(file, 'utf8'));
} else {
  console.error('usage: node tools/level-editor/check.mjs <level.json>');
  console.error('       node tools/level-editor/check.mjs --level <id>');
  console.error('       node tools/level-editor/check.mjs --list');
  process.exit(2);
}

if (Array.isArray(spec)) {
  console.error('expected one level spec, not an array');
  process.exit(2);
}

const { level, results } = validateDraft(specToDraft(spec));
console.log(`level ${spec.id ?? '(unnamed)'}${spec.name ? ` — ${spec.name}` : ''}`);

for (const r of results) {
  if (r.level === 'ok') continue;
  console.log(`${r.level === 'error' ? 'FAIL' : 'warn'}  ${r.name}`);
  if (r.message) console.log(`      ${r.message}`);
}

const { errors, warnings } = summarise(results);
const passed = results.filter((r) => r.level === 'ok').length;
console.log(`\n${level ? `${level.w}×${level.h} board` : 'no build'} · ${passed} checks passed · ${errors} failed · ${warnings} warning(s)`);

if (wantsSolve) {
  console.log(
    '\nsolver: DISABLED. The autopilot has not caught up with the engine, so its verdict is not\n' +
      '        a playability answer. The rules above are computed from the level geometry.\n' +
      "        To exercise the engine's own autopilot, run: node tests/run.js",
  );
}

process.exit(errors ? 1 : 0);
