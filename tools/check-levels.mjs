// Validate every shipped level with the same rules the level editor applies.
//
// This is the half of `npm run check` that does not need a browser: it compiles each level in
// LEVELS to an editor draft and runs the editor's own validator over it. Keeping it here (rather
// than shelling out to tools/level-editor/check.mjs once per level) means the rules run once, in
// order, and a new level is covered the moment it is added to LEVELS.
//
//   node tools/check-levels.mjs            # every built level
//   node tools/check-levels.mjs first-tilt # one level
//
// Exit code 1 when any level fails an error-level rule.
//
// The autopilot is deliberately not run here. It is exercised by `node tests/run.js`
// (tests/solver.test.js), which is where its verdict is honest; see docs/PLAN.md Phase 4.

import { specToDraft } from './level-editor/model.js';
import { validateDraft, summarise } from './level-editor/validate.js';
import { LEVELS } from '../src/engine/levels.js';

const only = process.argv.slice(2).find((a) => !a.startsWith('--'));
const levels = only ? LEVELS.filter((l) => l.id === only) : LEVELS;

if (only && levels.length === 0) {
  console.error(`no shipped level with id '${only}'`);
  process.exit(2);
}

let failed = 0;
let warned = 0;

for (const spec of levels) {
  const { level, results } = validateDraft(specToDraft(spec));
  const { errors, warnings } = summarise(results);
  const passed = results.filter((r) => r.level === 'ok').length;
  const board = level ? `${level.w}x${level.h}` : 'no build';

  const mark = errors ? 'FAIL' : warnings ? 'warn' : ' ok ';
  console.log(`${mark} ${spec.id.padEnd(16)} ${spec.name ?? ''}`.trimEnd());
  console.log(`     ${board} board - ${passed} rules pass, ${errors} failed, ${warnings} warning(s)`);

  for (const r of results) {
    if (r.level === 'ok') continue;
    console.log(`     ${r.level === 'error' ? 'FAIL' : 'warn'}  ${r.name}`);
    if (r.message) console.log(`           ${r.message}`);
  }

  failed += errors;
  warned += warnings;
}

console.log(
  `\n${levels.length} level(s) checked - ${failed} failed, ${warned} warning(s)`,
);

process.exit(failed ? 1 : 0);
