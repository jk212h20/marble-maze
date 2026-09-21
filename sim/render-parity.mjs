//  Renderer parity: boot a small level per mechanic and prove the page actually built something
//  for it.
//
//   node sim/render-parity.mjs                 # every fixture, against a server it starts
//   node sim/render-parity.mjs --url <url>     # against a server you already have
//   node sim/render-parity.mjs --out <dir>     # where to write the screenshots
//   node sim/render-parity.mjs oneway          # one fixture by id
//
//  Why this exists: the node suite can prove a mechanic is *listed* in the renderer, and a
//  one-way flap still shipped with a collider and no picture. This is the check that looks at
//  the built scene and says "the mechanic is on the board". It asserts presence, not beauty —
//  the shot tools are where pixels get reviewed.
//
//  The contexts are released between fixtures on purpose: two software-GL pages at once is
//  enough to stall the second one's load event (sim/smoke.mjs learned the same lesson).

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { FIXTURES } from './render-fixtures.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const out = arg('out', '/tmp/marblemaze-parity');
// Bare arguments name fixtures; none means all of them.
const named = args.filter((a) => !a.startsWith('--') && FIXTURES.some((f) => f.id === a));
const chosen = named.length ? FIXTURES.filter((f) => named.includes(f.id)) : FIXTURES;

fs.mkdirSync(out, { recursive: true });

/** Start the static server unless a URL was given. */
async function resolveUrl() {
  const given = arg('url', null);
  if (given) return { url: given, server: null };
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
        resolve({ url: m[0], server });
      }
    });
    server.stderr.on('data', (d) => process.stderr.write(`[serve] ${d}`));
    server.on('exit', (c) => {
      clearTimeout(timer);
      reject(new Error(`the dev server exited early (code ${c})`));
    });
  });
}

const NAV_TIMEOUT = Number(process.env.MM_NAV_TIMEOUT ?? 150000);

const { url, server } = await resolveUrl();
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});

const DRAFT_KEY = 'marblemaze.level-editor.drafts.v1';
const SESSION_KEY = 'last session (auto)';
const problems = [];
let checked = 0;

//  ONE page for every fixture, seeded and navigated again each time.
//
//  The first version gave each fixture its own context and page, which is what sim/smoke.mjs does
//  for its single extra board. Five live software-GL contexts in a row is a different animal: on
//  the CI runner the later boots did not finish, and the job sat in the same step for ten minutes.
//  Re-using the page costs one navigation per fixture and never has two GL contexts alive.
try {
  const context = await browser.newContext({ viewport: { width: 900, height: 620 } });
  const page = await context.newPage();
  page.setDefaultTimeout(Number(process.env.MM_BROWSER_TIMEOUT ?? 180000));
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(m.text());
  });
  const draftUrl = new URL('/index.html?draft=session', url).href;

  for (const fixture of chosen) {
    const names = fixture.expect.map((e) => e.objectName).filter(Boolean);
    process.stdout.write(`\n${fixture.id} ... `);
    //  Seed the draft slot the game reads on load, then navigate again. Written before every
    //  fixture, so one board's spec can never be read by the next one.
    if (page.url().startsWith('http')) {
      await page.evaluate(
        ([key, session, spec]) => localStorage.setItem(key, JSON.stringify({ [session]: spec })),
        [DRAFT_KEY, SESSION_KEY, fixture.spec],
      );
    } else {
      await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT });
      await page.evaluate(
        ([key, session, spec]) => localStorage.setItem(key, JSON.stringify({ [session]: spec })),
        [DRAFT_KEY, SESSION_KEY, fixture.spec],
      );
    }
    pageErrors.length = 0;

    await page.goto(draftUrl, { waitUntil: 'load', timeout: NAV_TIMEOUT });
    await page.waitForFunction('window.__maze && window.__maze.version === 1', null, { timeout: 120000 });
    await page.waitForTimeout(900);

    const snap = await page.evaluate((objectNames) => {
      const m = window.__maze;
      const obs = m.scene.obstacles ?? {};
      const counts = {};
      for (const [k, v] of Object.entries(obs)) counts[k] = Array.isArray(v) ? v.length : v ? 1 : 0;
      const grid = (m.world.level.grid ?? []).map((row) => row.join('')).join('');
      const found = {};
      for (const name of objectNames) found[name] = !!m.scene.scene.getObjectByName(name);

      //  The flap's leaf is measured, not merely found: an object that exists but hangs above
      //  the marble's head is the same bug as one that is not drawn at all.
      const boxOf = (obj) => {
        const V = m.scene.camera.position.constructor;
        const geo = obj.geometry;
        if (!geo.boundingBox) geo.computeBoundingBox();
        const bb = geo.boundingBox;
        obj.updateWorldMatrix(true, false);
        const out = { minY: Infinity, maxY: -Infinity };
        for (const x of [bb.min.x, bb.max.x])
          for (const y of [bb.min.y, bb.max.y])
            for (const z of [bb.min.z, bb.max.z]) {
              const p = new V(x, y, z).applyMatrix4(obj.matrixWorld);
              out.minY = Math.min(out.minY, p.y);
              out.maxY = Math.max(out.maxY, p.y);
            }
        return out;
      };
      const flaps = (m.scene.obstacles?.oneways ?? []).map((o) => boxOf(o.leaf));

      return {
        flaps,
        loaded: !!m.draft?.loaded,
        draftError: m.draft?.error ?? null,
        levelId: m.state?.levelId,
        counts,
        grid,
        balls: m.world.balls?.length ?? 1,
        allVisible: m.scene.scene.children.length,
        found,
      };
    }, names);

    await page.screenshot({ path: path.join(out, `${fixture.id}.png`) });

    if (!snap.loaded) {
      problems.push(`${fixture.id}: the fixture level did not load (${snap.draftError})`);
    }
    if (pageErrors.length) {
      problems.push(`${fixture.id}: ${pageErrors.length} console/page error(s): ${pageErrors[0]}`);
    }

    const lines = [];
    for (const e of fixture.expect) {
      let ok = false;
      let detail = '';
      if (e.gridChar !== undefined) {
        ok = snap.grid.includes(e.gridChar);
        detail = `cell '${e.gridChar}'`;
      } else if (e.obstacle) {
        ok = (snap.counts[e.obstacle] ?? 0) >= (e.min ?? 1);
        detail = `obstacles.${e.obstacle} = ${snap.counts[e.obstacle] ?? 0}`;
      } else if (e.objectName) {
        ok = !!snap.found[e.objectName];
        detail = `scene object '${e.objectName}'`;
      } else if (e.flapStands) {
        const flap = snap.flaps[0];
        ok = !!flap && flap.minY < 0.16 && flap.maxY > 0.3 && flap.maxY - flap.minY > 0.35;
        detail = flap ? `leaf spans y ${flap.minY.toFixed(3)}..${flap.maxY.toFixed(3)}` : 'no flap measured';
      } else if (e.count) {
        ok = !!e.count(snap);
        detail = e.what ?? 'count';
      } else {
        throw new Error(`${fixture.id}: expectation for ${e.key} has nothing to check`);
      }
      checked++;
      lines.push(`    ${ok ? 'ok  ' : 'FAIL'} ${e.key.padEnd(14)} ${detail}`);
      if (!ok) problems.push(`${fixture.id}/${e.key}: not rendered (${detail})`);
    }

    console.log(`— ${fixture.what}`);
    console.log(lines.join('\n'));
  }
} finally {
  await browser.close();
  server?.kill('SIGTERM');
}

console.log(
  problems.length
    ? `\n${problems.length} problem(s):\n${problems.map((p) => `  ${p}`).join('\n')}`
    : `\nall ${checked} mechanic(s) across ${chosen.length} fixture(s) are on the board (shots in ${out})`,
);
process.exit(problems.length ? 1 : 0);
