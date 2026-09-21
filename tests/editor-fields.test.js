//  The editor's rule about fields the board cannot climb.
//
//  A belt, a fan and a magnet push the marble with a steady acceleration the player cannot switch
//  off, and the board can only answer with `g * sin(maxTilt) * roll`. Past that the level is not
//  hard, it is impossible, so the editor says so while the level is being authored rather than
//  leaving it to the solver to time out later. See "Steady fields have a ceiling" in
//  docs/DESIGN.md for the measurement.

import { specToDraft } from '../tools/level-editor/model.js';
import { validateDraft } from '../tools/level-editor/validate.js';
import { TUNING, setTuning, resetTuning } from '../src/engine/tuning.js';

export const name = 'editor fields';

const RULE = 'no field is stronger than the board can climb';

const draft = (extra) =>
  specToDraft({
    id: 'field',
    name: 'field',
    board: { shape: 'rect', w: 12, h: 9 },
    spawn: [1, 4],
    goal: [10, 4],
    ...extra,
  });

const rule = (results) => results.find((r) => r.name === RULE);

export function tests(t) {
  t.ok('the ceiling is the board\'s own maximum, and the shipped fan is above it', () => {
    //  The arithmetic, pinned: this is the number the rule and docs/DESIGN.md both quote.
    const ceiling = TUNING.gravity * Math.sin(TUNING.maxTilt) * TUNING.roll;
    if (Math.abs(ceiling - 2.071) > 0.005) {
      throw new Error(`the ceiling moved to ${ceiling.toFixed(3)} u/s² - update the docs if this was deliberate`);
    }
    if (!(TUNING.ventAccel > ceiling)) {
      throw new Error(`the shipped fan (${TUNING.ventAccel}) is no longer above the ceiling (${ceiling.toFixed(2)})`);
    }
  });

  t.ok('a fan warns, because a marble cannot climb one', () => {
    const { results } = validateDraft(draft({ vents: [{ rect: [4, 1, 8, 7], dir: [-1, 0] }] }));
    const r = rule(results);
    if (r?.level !== 'warning') throw new Error(`a fan did not warn (got ${r?.level ?? 'no result'})`);
    if (!r.message.includes('maximum')) throw new Error(`the warning does not name the ceiling: ${r.message}`);
  });

  t.ok('a gentle magnet passes, and a strong one warns', () => {
    const gentle = rule(validateDraft(draft({ magnets: [{ cell: [6, 4], radius: 3, strength: 1 }] })).results);
    if (gentle?.level !== 'ok') throw new Error(`a 1 u/s² magnet warned (${gentle?.message})`);

    const strong = rule(validateDraft(draft({ magnets: [{ cell: [6, 4], radius: 3, strength: 6 }] })).results);
    if (strong?.level !== 'warning') throw new Error(`a 6 u/s² magnet did not warn (got ${strong?.level})`);
  });

  t.ok('a level with no fields in it passes the rule out loud', () => {
    const r = rule(validateDraft(draft({})).results);
    if (r?.level !== 'ok') throw new Error('a level with no vents or magnets did not pass the rule');
    if (!r.message.includes('no fans')) throw new Error(`the pass message is unclear: ${r.message}`);
  });

  t.ok('the rule follows the player\'s own max tilt', () => {
    //  Tuning the board flatter lowers the ceiling, and a field that was climbable stops being so.
    //  A rule that read the shipped constant instead would say the opposite.
    setTuning('maxTilt', 0.1);
    try {
      const r = rule(validateDraft(draft({ magnets: [{ cell: [6, 4], radius: 3, strength: 3 }] })).results);
      if (r?.level !== 'warning') {
        throw new Error(`at maxTilt 0.1 a 3 u/s² magnet is unbeatable but the rule said '${r?.level}'`);
      }
    } finally {
      resetTuning();
    }
  });
}
