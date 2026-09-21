// Run the real-browser checks end to end, owning the dev server so the caller does not have to.
//
//   node sim/check-browser.mjs              # all three checks
//   node sim/check-browser.mjs smoke tune   # a subset, by name
//
// The three checks each need the page served over HTTP and a Chromium with SwiftShader, so
// running them by hand meant starting a server in another terminal and remembering three
// commands. This starts `sim/serve.js` on an ephemeral port, reads the URL it prints, runs the
// checks as child processes against it, and always shuts the server down again.
//
// Exit code 1 if any check fails.
//
// This is what `npm run check:browser` runs, and what CI runs after installing Chromium. It is
// NOT part of `npm run check`, which stays browser-free so it works anywhere node does.

import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');

const CHECKS = [
  { name: 'smoke', file: 'smoke.mjs', args: () => ['--out', '/tmp/marblemaze-shots'] },
  { name: 'tune', file: 'tune-check.mjs', args: () => [] },
  { name: 'audio', file: 'audio-check.mjs', args: () => [] },
];

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const selected = wanted.length ? CHECKS.filter((c) => wanted.includes(c.name)) : CHECKS;

if (selected.length === 0) {
  console.error(`no such check. known: ${CHECKS.map((c) => c.name).join(', ')}`);
  process.exit(2);
}

/** Start the static server and resolve with the URL it prints. */
function startServer() {
  return new Promise((resolve, reject) => {
    const server = spawn(process.execPath, ['sim/serve.js', '--port', '0'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    const timer = setTimeout(() => {
      server.kill('SIGKILL');
      reject(new Error('the dev server did not report a URL within 10s'));
    }, 10_000);

    server.stdout.on('data', (d) => {
      buf += d;
      const m = buf.match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (m) {
        clearTimeout(timer);
        resolve({ server, url: m[0] });
      }
    });
    server.stderr.on('data', (d) => process.stderr.write(`[serve] ${d}`));
    server.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`the dev server exited early (code ${code})`));
    });
  });
}

function run(file, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join('sim', file), ...args], {
      cwd: ROOT,
      stdio: 'inherit',
      // A CI runner paints the same pixels on a much slower CPU, so the smoke check runs at
      // device scale 1 there. The assertions are identical; the frame times it prints still
      // describe the machine it ran on, which is why they are reported rather than asserted.
      env: { ...process.env, ...(process.env.CI ? { MM_SCALE: process.env.MM_SCALE ?? '1' } : {}) },
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

const { server, url } = await startServer();
console.log(`browser checks against ${url}\n`);

const failures = [];
try {
  for (const check of selected) {
    console.log(`\n=== ${check.name} ===`);
    const code = await run(check.file, [...check.args(), '--url', url]);
    if (code !== 0) failures.push(check.name);
  }
} finally {
  server.kill('SIGTERM');
}

console.log(
  failures.length
    ? `\n${failures.length} browser check(s) failed: ${failures.join(', ')}`
    : `\nall ${selected.length} browser check(s) passed`,
);
process.exit(failures.length ? 1 : 0);
