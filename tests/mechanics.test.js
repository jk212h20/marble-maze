//  The mechanics registry against the code it describes.
//
//  These cases exist so that the layers can no longer drift apart silently. The one that
//  matters most is "a mechanic a built level uses is rendered": a one-way flap shipped with a
//  collider and no picture, and nothing in the repo said so out loud.

import fs from 'node:fs';
import path from 'node:path';
import {
  MECHANICS,
  FORMAT_ONLY_KEYS,
  MECHANIC_TUNING_PATHS,
  usesMechanic,
  mechanicsOf,
} from '../src/engine/mechanics.js';
import { LEVELS } from '../src/engine/levels.js';
import { TUNING_SPEC } from '../src/engine/tuning.js';

export const name = 'mechanics registry';

const ROOT = path.join(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// The engine files a physics needle may live in. `insideShape` is in levels.js, `WALL` is in
// physics.js, and either is a fair answer to "does the engine implement this".
const ENGINE_SOURCES = ['src/engine/physics.js', 'src/engine/levels.js', 'src/engine/silhouette.js']
  .map(read)
  .join('\n');
const RENDER_SOURCE = read('src/render/scene.js');
const EDITOR_SOURCE = read('tools/level-editor/model.js');
const LEVELS_SOURCE = read('src/engine/levels.js');

/** Every built level's spec, with the id kept alongside for messages. */
const built = LEVELS.map((spec) => ({ id: spec.id ?? spec.name, spec }));

/** Every mechanic any built level uses. */
const usedAnywhere = MECHANICS.filter((m) => built.some(({ spec }) => usesMechanic(m, spec)));

/** All TUNING_SPEC paths, flattened. */
function tuningPaths() {
  const spec = TUNING_SPEC;
  const groups = Array.isArray(spec) ? spec : Object.values(spec);
  const out = [];
  for (const g of groups) {
    const items = g.items ?? g;
    for (const item of Array.isArray(items) ? items : Object.values(items)) {
      if (item && typeof item === 'object' && typeof item.path === 'string') out.push(item.path);
    }
  }
  return out;
}

export function tests(t) {
  t.ok('every mechanic has a unique key and a status the plan understands', () => {
    const keys = new Set();
    for (const m of MECHANICS) {
      if (!m.key) throw new Error('a mechanic has no key');
      if (keys.has(m.key)) throw new Error(`duplicate mechanic key: ${m.key}`);
      keys.add(m.key);
      if (!['shipped', 'engine-only', 'shelved'].includes(m.status)) {
        throw new Error(`${m.key}: unknown status '${m.status}'`);
      }
      if (!['mesh', 'painted', 'none'].includes(m.render)) {
        throw new Error(`${m.key}: unknown render '${m.render}'`);
      }
      if (!m.label || !m.what) throw new Error(`${m.key}: needs a label and a description`);
    }
  });

  t.ok('a mechanic an authored level uses is actually rendered', () => {
    // The whole point of the registry. `render: 'none'` is legal only while nothing uses it.
    for (const m of usedAnywhere) {
      if (m.render === 'none') {
        throw new Error(
          `${m.key} is used by a built level but has no renderer — draw it, or take it out of the level`,
        );
      }
    }
    if (usedAnywhere.length < 8) {
      throw new Error(`only ${usedAnywhere.length} mechanics are in use: the usage scan is wrong`);
    }
  });

  t.ok("a mechanic used by a level is marked 'shipped', and an unused one is not", () => {
    // The status field is a claim about the levels, so it is checked against the levels.
    for (const m of MECHANICS) {
      const users = built.filter(({ spec }) => usesMechanic(m, spec)).map((b) => b.id);
      if (m.status === 'shipped' && users.length === 0) {
        throw new Error(`${m.key} says 'shipped' but no built level uses it`);
      }
      if (m.status !== 'shipped' && users.length > 0) {
        throw new Error(`${m.key} says '${m.status}' but ${users.join(', ')} use it`);
      }
    }
  });

  t.ok('every renderer claim is true in scene.js', () => {
    for (const m of MECHANICS) {
      if (m.render === 'none') {
        // 'none' means no visual, so a needle would be a lie: the row must not carry one.
        if (m.renderNeedle) throw new Error(`${m.key}: render 'none' but a renderNeedle is set`);
        continue;
      }
      if (!m.renderNeedle) throw new Error(`${m.key}: render '${m.render}' needs a renderNeedle`);
      if (!RENDER_SOURCE.includes(m.renderNeedle)) {
        throw new Error(`${m.key}: scene.js no longer mentions '${m.renderNeedle}'`);
      }
    }
  });

  t.ok('every physics claim is true in the engine', () => {
    for (const m of MECHANICS) {
      if (!m.physicsNeedle) throw new Error(`${m.key}: needs a physicsNeedle`);
      if (!ENGINE_SOURCES.includes(m.physicsNeedle)) {
        throw new Error(`${m.key}: the engine no longer mentions '${m.physicsNeedle}'`);
      }
    }
  });

  t.ok('every tuning path a mechanic claims is a real slider', () => {
    const known = new Set(tuningPaths());
    for (const m of MECHANICS) {
      for (const p of m.tuning) {
        if (!known.has(p)) throw new Error(`${m.key}: '${p}' is not a TUNING_SPEC path`);
      }
    }
    if (MECHANIC_TUNING_PATHS.length === 0) throw new Error('no mechanic claims any tuning');
  });

  t.ok('every mechanic the editor offers is a tool the editor has', () => {
    for (const m of MECHANICS) {
      if (!m.editor) throw new Error(`${m.key}: no editor tool id`);
      if (!EDITOR_SOURCE.includes(m.editor)) {
        throw new Error(`${m.key}: the level editor has no '${m.editor}' tool`);
      }
    }
  });

  t.ok('every spec key in the level format is a mechanic or declared format-only', () => {
    // Read the keys levels.js actually consumes, so a new field cannot slip in unregistered.
    const consumed = new Set([...LEVELS_SOURCE.matchAll(/\bspec\.([a-zA-Z]+)/g)].map((m) => m[1]));
    const covered = new Set([...MECHANICS.flatMap((m) => m.specKeys), ...FORMAT_ONLY_KEYS]);
    for (const key of consumed) {
      if (!covered.has(key)) {
        throw new Error(
          `spec.${key} is read by levels.js but is in neither MECHANICS (as a specKeys entry) nor FORMAT_ONLY_KEYS`,
        );
      }
    }
  });

  t.ok('the format-only list does not shadow a real mechanic', () => {
    const mechanicKeys = new Set(MECHANICS.flatMap((m) => m.specKeys));
    for (const key of FORMAT_ONLY_KEYS) {
      if (mechanicKeys.has(key)) throw new Error(`${key} is listed both as a mechanic and as format-only`);
    }
  });

  t.ok('mechanicsOf reports a level the way the registry reads it', () => {
    const bothLocks = built.find((b) => b.id === 'both-locks');
    const keys = mechanicsOf(bothLocks.spec).map((m) => m.key);
    for (const expected of ['plate', 'lift', 'wall', 'goal', 'multi-marble']) {
      if (!keys.includes(expected)) throw new Error(`both-locks should use ${expected}, got ${keys.join(', ')}`);
    }
    if (keys.includes('belt') || keys.includes('oneway')) {
      throw new Error(`both-locks should not use ${keys.join(', ')}`);
    }

    for (const { id, spec } of built) {
      if (mechanicsOf(spec).length === 0) throw new Error(`${id}: uses no mechanic at all`);
    }
  });
}
