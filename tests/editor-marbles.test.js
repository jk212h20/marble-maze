//  The level editor's marble handling: one spawn per marble, and as many as the author wants.
//
//  The engine has always accepted a list of spawns (a multi-marble level, where every marble must
//  reach the cup). These cases pin the editor half: adding and moving spawns without stacking them,
//  the draft ⇄ spec round trip for both the single-spawn and the multi-spawn form, and the rules the
//  ledger has to enforce once a level has more than one marble.

import {
  blankDraft,
  draftToSpec,
  specToDraft,
  spawnsOf,
  spawnAt,
  addSpawn,
  moveSpawn,
  removeSpawn,
  MIN_SPAWN_GAP,
} from '../tools/level-editor/model.js';
import { validateDraft, summarise } from '../tools/level-editor/validate.js';
import { LEVELS } from '../src/engine/levels.js';

export const name = 'editor marbles';

const draft = (opts) => blankDraft({ w: 16, h: 11, ...opts });

const levels = (results, level) => results.filter((r) => r.level === level);
const named = (results, name) => results.find((r) => r.name.includes(name));

/** A sealed 8×8 board with a wall column at c=4, splitting it into two halves. */
const splitSpec = (spawn) => ({
  id: 'multi-split',
  name: 'Split',
  shape: 'Rectangle',
  difficulty: 4,
  par: 40,
  hint: 'two halves',
  board: { shape: 'rect', w: 8, h: 8 },
  walls: [
    [0, 0, 7, 0],
    [0, 7, 7, 7],
    [0, 0, 0, 7],
    [7, 0, 7, 7],
    [4, 0, 4, 7],
  ],
  spawn,
  goal: [6, 6],
  multi: Array.isArray(spawn[0]),
});

export function tests(t) {
  t.ok('a blank draft starts with exactly one marble', () => {
    const d = draft();
    const spawns = spawnsOf(d);
    if (spawns.length !== 1) throw new Error(`${spawns.length} spawns in a blank draft`);
  });

  t.ok('marbles are added one at a time, and the same spot is not added twice', () => {
    const d = draft();
    const first = addSpawn(d, [5, 5]);
    if (first !== 1) throw new Error(`first added marble landed at index ${first}`);
    if (addSpawn(d, [5, 5]) !== 1) throw new Error('the same spot added a second marble');
    if (spawnsOf(d).length !== 2) throw new Error(`${spawnsOf(d).length} marbles after one add`);
    if (addSpawn(d, [9, 9]) !== 2) throw new Error('a third marble did not land at index 2');
    if (spawnsOf(d).length !== 3) throw new Error('a third marble was not kept');
  });

  t.ok('a marble is refused a spot on top of another marble, or off the board', () => {
    const d = draft();
    const [sx, sz] = spawnsOf(d)[0];
    // Far enough not to read as "the marble already here", but too close to stand beside it.
    if (addSpawn(d, [sx + MIN_SPAWN_GAP * 0.75, sz]) !== null) throw new Error('a marble was stacked on another');
    // Closer still reads as the same marble, and must not grow the list either.
    if (spawnsOf(d).length !== 1) throw new Error('a near-duplicate changed the marble count');
    if (addSpawn(d, [-3, -3]) !== null) throw new Error('a marble was placed off the board');
    if (spawnsOf(d).length !== 1) throw new Error('a refused placement changed the marble count');
  });

  t.ok('a marble can be moved, but not onto another one', () => {
    const d = draft();
    addSpawn(d, [5, 5]);
    if (!moveSpawn(d, 0, [8, 8])) throw new Error('a legal move was refused');
    if (spawnAt(d, [8, 8]) !== 0) throw new Error('the moved marble is not where it was put');
    if (moveSpawn(d, 0, [5, 5])) throw new Error('a marble was moved onto another');
    if (spawnAt(d, [8, 8]) !== 0) throw new Error('a refused move still displaced the marble');
  });

  t.ok('the last marble cannot be removed', () => {
    const d = draft();
    if (removeSpawn(d, 0)) throw new Error('the only marble was removed');
    addSpawn(d, [5, 5]);
    if (!removeSpawn(d, 0)) throw new Error('a second marble could not be removed');
    if (spawnsOf(d).length !== 1) throw new Error(`${spawnsOf(d).length} marbles left after removing one of two`);
    if (removeSpawn(d, 0)) throw new Error('the last marble was removed after the second went');
  });

  t.ok('one marble exports the single-spawn form; more export a list and mark the level multi', () => {
    const one = draftToSpec(draft());
    if (!Array.isArray(one.spawn) || Array.isArray(one.spawn[0])) throw new Error('a single marble did not stay [c, r]');
    if (one.multi) throw new Error('a single-marble level was marked multi');

    const d = draft();
    addSpawn(d, [6, 6]);
    const many = draftToSpec(d);
    if (!Array.isArray(many.spawn[0])) throw new Error('a multi-marble level did not export a spawn list');
    if (many.spawn.length !== 2) throw new Error(`${many.spawn.length} spawns exported`);
    if (many.multi !== true) throw new Error('a multi-marble level was not marked multi');
  });

  t.ok('a single-spawn spec opens in the editor unchanged', () => {
    const spec = draftToSpec(draft());
    const d = specToDraft(spec);
    if (spawnsOf(d).length !== 1) throw new Error('a single spawn became more than one');
    if (JSON.stringify(spawnsOf(d)[0]) !== JSON.stringify(spec.spawn)) throw new Error('the spawn moved on import');
    if (!d.spawns) throw new Error('the draft did not carry a spawns list');
  });

  t.ok('a multi-spawn spec round-trips through the editor', () => {
    const twin = LEVELS.find((l) => l.id === 'twin-track');
    const d = specToDraft(twin);
    if (spawnsOf(d).length !== twin.spawn.length) throw new Error(`${spawnsOf(d).length} spawns read from twin-track`);
    const spec = draftToSpec(d);
    if (JSON.stringify(spec.spawn) !== JSON.stringify(twin.spawn)) throw new Error('twin-track spawns changed on round trip');
    if (spec.multi !== true) throw new Error('twin-track lost its multi flag');
  });

  t.ok('an old draft that still holds a single `spawn` still reads', () => {
    const legacy = { ...draft(), spawn: [3, 3] };
    delete legacy.spawns;
    if (spawnsOf(legacy).length !== 1) throw new Error('a legacy draft lost its spawn');
    if (spawnsOf(legacy)[0][0] !== 3) throw new Error('a legacy draft read the wrong spawn');
  });

  t.ok('a shipped multi-marble level passes every rule, with one check per marble', () => {
    const twin = LEVELS.find((l) => l.id === 'twin-track');
    const { results } = validateDraft(specToDraft(twin));
    const { errors } = summarise(results);
    if (errors) throw new Error(`${errors} rule(s) failed on twin-track: ${levels(results, 'error').map((r) => r.name).join('; ')}`);
    const floor = named(results, 'every marble starts on walkable floor');
    if (!floor || floor.level !== 'ok') throw new Error('the per-marble floor check did not pass');
    if (!floor.message.includes('2 marbles')) throw new Error('the floor check did not see both marbles');
    if (!named(results, 'the marbles start a marble apart')) throw new Error('the distinctness check did not run');
    if (!named(results, 'the goal is reachable from every marble')) throw new Error('the per-marble reachability check did not run');
  });

  t.ok('two marbles on the same spot fail the ledger', () => {
    const twin = LEVELS.find((l) => l.id === 'twin-track');
    const d = specToDraft(twin);
    d.spawns[1] = [...d.spawns[0]];
    const { results } = validateDraft(d);
    const { errors } = summarise(results);
    if (!errors) throw new Error('overlapping marbles passed validation');
    if (!named(results, 'the marbles start a marble apart')) throw new Error('the clash was not reported by name');
  });

  t.ok('a marble walled off from the cup fails the ledger', () => {
    // One marble on each side of a solid wall column: the left one can never reach the goal.
    const { results } = validateDraft(specToDraft(splitSpec([[1, 1], [6, 1]])));
    const { errors } = summarise(results);
    if (!errors) throw new Error('a stranded marble passed validation');
    const reach = named(results, 'the goal is reachable from every marble');
    if (!reach || reach.level !== 'error') throw new Error(`reachability was not the failing rule: ${reach?.name} ${reach?.level}`);
  });

  t.ok('both marbles reachable from their own side passes the ledger', () => {
    // Two marbles on the goal's side: neither is stranded, so only the reachability check matters.
    const { results } = validateDraft(specToDraft(splitSpec([[5, 1], [6, 2]])));
    const reach = named(results, 'the goal is reachable from every marble');
    if (!reach || reach.level !== 'ok') throw new Error(`reachability did not pass: ${reach?.level} ${reach?.message}`);
  });
}
