// Tiny dependency-free test runner (same shape as MUSTER/Dilation's): imports every
// *.test.js in this directory and runs its exported cases.
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
const only = process.argv[2];
const t = {
  ok(name, fn) {
    try {
      const maybe = fn();
      if (maybe && typeof maybe.then === 'function') throw new Error('async test used t.ok; use t.okAsync');
      pass++;
      console.log(`  ok    ${name}`);
    } catch (err) {
      fail++;
      console.log(`  FAIL  ${name}`);
      console.log(`        ${err.message}`);
    }
  },
  async okAsync(name, fn) {
    try {
      await fn();
      pass++;
      console.log(`  ok    ${name}`);
    } catch (err) {
      fail++;
      console.log(`  FAIL  ${name}`);
      console.log(`        ${err.message}`);
    }
  },
};

for (const f of files) {
  if (only && !f.includes(only)) continue;
  resetTuning();
  const mod = await import(path.join(dir, f));
  console.log(`\n${mod.name ?? f}`);
  await mod.tests(t);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
