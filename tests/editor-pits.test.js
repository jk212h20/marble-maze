//  The level editor's pit brush.
//
//  Two things must hold however a run is drawn. First, the chain of centres a pit carries is a
//  *path*: a stroke drawn back over its own ground must not append centres that double the chain
//  back on itself, because the swept outline of a path that revisits its own middle is not the
//  region the author drew. Second, when a stroke genuinely branches off an existing run the union
//  cannot be one chain, so it becomes its own pit — and the two overlapping pits must combine into
//  one drawn hole (see `combineHoleRings`), not two rims crossing the ground they share.

import { blankDraft, addPitCenter, chainDistance } from '../tools/level-editor/model.js';
import { holeClusters, combineHoleRings, ringArea } from '../src/engine/hole-ring.js';

export const name = 'editor pits';

const draft = () => blankDraft({ w: 16, h: 11 });

/** Does this chain ever come back on itself — a repeated centre, or a turn sharper than 180°? */
function doublesBack(centers) {
  for (let i = 1; i < centers.length; i++) {
    if (Math.hypot(centers[i][0] - centers[i - 1][0], centers[i][1] - centers[i - 1][1]) < 1e-9) return true;
  }
  // Segment directions: a straight run has one direction; a reversal has two opposite ones
  // between consecutive non-degenerate segments.
  const dirs = [];
  for (let i = 1; i < centers.length; i++) {
    const dx = centers[i][0] - centers[i - 1][0];
    const dz = centers[i][1] - centers[i - 1][1];
    const len = Math.hypot(dx, dz);
    if (len > 1e-9) dirs.push([dx / len, dz / len]);
  }
  for (let i = 1; i < dirs.length; i++) {
    const dot = dirs[i - 1][0] * dirs[i][0] + dirs[i - 1][1] * dirs[i][1];
    if (dot < -1 + 1e-9) return true;
  }
  return false;
}

const stroke = (d, from, to, step = 0.125) => {
  const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const n = Math.max(1, Math.round(dist / step));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    addPitCenter(d, [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
  }
};

export function tests(t) {
  t.ok('a drawn run is a path, not centres doubled back on themselves', () => {
    const d = draft();
    stroke(d, [5, 5], [8, 5]);
    if (d.pits.length !== 1) throw new Error(`${d.pits.length} pits for one stroke`);
    if (doublesBack(d.pits[0].centers)) throw new Error(`the chain doubles back: ${JSON.stringify(d.pits[0].centers)}`);
    // The run is still covered end to end.
    for (const x of [5, 6.5, 8]) {
      if (chainDistance(d.pits[0].centers, x, 5) > d.pits[0].r + 1e-9) throw new Error(`the run no longer covers ${x},5`);
    }
  });

  t.ok('drawing back over ground the run already covers changes nothing', () => {
    const d = draft();
    stroke(d, [5, 5], [8, 5]);
    const before = JSON.stringify(d.pits[0].centers);
    stroke(d, [8, 5], [5.5, 5]);
    if (JSON.stringify(d.pits[0].centers) !== before) {
      throw new Error(`retracing changed the chain: ${before} -> ${JSON.stringify(d.pits[0].centers)}`);
    }
    if (doublesBack(d.pits[0].centers)) throw new Error('retracing doubled the chain back');
  });

  t.ok('a centre the slot already covers is not appended again', () => {
    const d = draft();
    addPitCenter(d, [5, 5]);
    addPitCenter(d, [6, 5]);
    const n = d.pits[0].centers.length;
    const res = addPitCenter(d, [5.2, 5]);
    if (d.pits[0].centers.length !== n) throw new Error('a covered centre lengthened the chain');
    if (!res.merged) throw new Error('a covered centre was not reported as merged');
  });

  t.ok('a stroke that branches off a run starts its own pit, and the two combine', () => {
    const d = draft();
    stroke(d, [3, 5], [7, 5]);
    stroke(d, [5, 5.5], [5, 8]);
    if (d.pits.length < 2) throw new Error(`a branch did not start a second pit (${d.pits.length} pits)`);
    for (const pit of d.pits) {
      if (doublesBack(pit.centers)) throw new Error(`a branch doubled a chain back: ${JSON.stringify(pit.centers)}`);
    }
    // The two regions really do overlap, so the board must draw them as one hole.
    const asHoles = d.pits.map((p) => ({ centers: p.centers, r: p.r }));
    const clusters = holeClusters(asHoles);
    if (!clusters.some((g) => g.length > 1)) throw new Error('the branching pits do not overlap');
    const overlapping = clusters.find((g) => g.length > 1);
    const pieces = combineHoleRings(overlapping);
    if (pieces.length !== 1) throw new Error(`${pieces.length} drawn regions for one overlapping cluster`);
    const sum = overlapping.reduce((s, h) => s + Math.abs(ringArea(combineHoleRings([h])[0].outer)), 0);
    const union = Math.abs(ringArea(pieces[0].outer));
    if (!(union < sum - 1e-6)) throw new Error('the combined region did not remove the shared ground');
  });
}
