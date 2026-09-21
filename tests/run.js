// Tiny dependency-free test runner (same shape as MUSTER/Dilation's): imports every
// *.test.js in this directory and runs its exported cases.
//
//   node tests/run.js            # everything
//   node tests/run.js marbles    # only suites whose filename contains "marbles"
//   node tests/run.js --report   # also print one JSON line describing the run
//
// `--report` exists so tools/gen-status.mjs can read exact per-suite counts instead of
// parsing this output by eye. The summary line stays last, so nothing that reads the tail
// of this output is disturbed.
import fs from 'node:fs';
import path from 'node:path';

const dir = import.meta.dirname;
// Physics tuning is global state: start every suite from the shipping numbers so one
// suite's experiments can never change another's results.
const { resetTuning } = await import('../src/engine/tuning.js');
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.test.js'))
  .sort();

let pass = 0;
let fail = 0;
const argv = process.argv.slice(2);
const only = argv.find((a) => !a.startsWith('--'));
const wantsReport = argv.includes('--report');
const suites = [];
let current = null;
const t = {
  ok(name, fn) {
    try {
      const maybe = fn();
      if (maybe && typeof maybe.then === 'function') throw new Error('async test used t.ok; use t.okAsync');
      pass++;
      if (current) current.checks++;
      console.log(`  ok    ${name}`);
    } catch (err) {
      fail++;
      if (current) current.failed++;
      console.log(`  FAIL  ${name}`);
      console.log(`        ${err.message}`);
    }
  },
  async okAsync(name, fn) {
    try {
      await fn();
      pass++;
      if (current) current.checks++;
      console.log(`  ok    ${name}`);
    } catch (err) {
      fail++;
      if (current) current.failed++;
      console.log(`  FAIL  ${name}`);
      console.log(`        ${err.message}`);
    }
  },
};

for (const f of files) {
  if (only && !f.includes(only)) continue;
  resetTuning();
  const mod = await import(path.join(dir, f));
  current = { file: f, name: mod.name ?? f, checks: 0, failed: 0 };
  suites.push(current);
  console.log(`\n${mod.name ?? f}`);
  await mod.tests(t);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (wantsReport) console.log(JSON.stringify({ pass, fail, suites }));
process.exit(fail ? 1 : 0);
