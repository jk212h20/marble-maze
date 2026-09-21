//  Coverage for the renderer-parity check itself.
//
//  sim/render-parity.mjs proves on the built scene that each mechanic is on the board, but it
//  needs a browser, so it runs in the browser job. These cases run in the node suite and hold the
//  fixtures to two things the browser check cannot: that the fixtures are *complete* (every
//  mechanic claiming a visual has one) and that they build, so a broken fixture fails in seconds
//  instead of as a mysterious page error.

import { FIXTURES, COVERED } from '../sim/render-fixtures.mjs';
import { MECHANICS } from '../src/engine/mechanics.js';
import { buildLevel } from '../src/engine/levels.js';

export const name = 'render fixtures';

const PROBES = ['gridChar', 'obstacle', 'objectName', 'count', 'flapStands'];

export function tests(t) {
  t.ok('every mechanic that claims a visual has a fixture that looks for it', () => {
    const missing = MECHANICS.filter((m) => m.render !== 'none' && !COVERED.has(m.key)).map((m) => m.key);
    if (missing.length) {
      throw new Error(
        `these mechanics claim a renderer but nothing checks it on the built board: ${missing.join(', ')}`,
      );
    }
  });

  t.ok('every fixture expectation names a real mechanic and one probe', () => {
    const keys = new Set(MECHANICS.map((m) => m.key));
    for (const fixture of FIXTURES) {
      if (!fixture.id || !fixture.spec) throw new Error('a fixture needs an id and a spec');
      if (!fixture.expect?.length) throw new Error(`${fixture.id}: expects nothing`);
      for (const e of fixture.expect) {
        if (!keys.has(e.key)) throw new Error(`${fixture.id}: '${e.key}' is not a mechanic`);
        const probes = PROBES.filter((p) => e[p] !== undefined);
        if (probes.length !== 1) {
          throw new Error(`${fixture.id}/${e.key}: needs exactly one probe, has ${probes.join(', ') || 'none'}`);
        }
      }
    }
  });

  t.ok('every fixture level still builds', () => {
    for (const fixture of FIXTURES) {
      let level;
      try {
        level = buildLevel(fixture.spec);
      } catch (err) {
        throw new Error(`${fixture.id}: the fixture does not build (${err.message})`);
      }
      if (!level?.features) throw new Error(`${fixture.id}: built no features`);
    }
  });

  t.ok('a fixture that paints a surface really paints it', () => {
    // The grid probes are what the browser check reads, so they have to hold here too - otherwise
    // a renamed constant turns a real check into a passing one.
    for (const fixture of FIXTURES) {
      const level = buildLevel(fixture.spec);
      const grid = level.grid.map((row) => row.join('')).join('');
      for (const e of fixture.expect) {
        if (e.gridChar !== undefined && !grid.includes(e.gridChar)) {
          throw new Error(`${fixture.id}/${e.key}: the built board has no '${e.gridChar}' cell`);
        }
      }
    }
  });
}
