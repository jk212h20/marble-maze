//  Slot pits and sub-unit placement.
//
//  A slot is the *union* of overlapping circles: authored as a chain of centres, it has to
//  build, block exactly the cells it covers, be cut (and dodged by the rose) as ONE hole with
//  rounded ends, catch the marble anywhere along its length, and never become an invisible
//  trap. Coordinates may be a fraction of a cell anywhere an object sits — an eighth (0.125)
//  is the intended authoring step — and the classic cell-centred pit must be bit for bit what
//  it always was, so nothing already authored changes meaning.

import { buildLevel, pitDistance, cellIndex, chainCellDistance, chainDistance, LEVELS } from '../src/engine/levels.js';
import { makeWorld, step } from '../src/engine/physics.js';
import { slabHoles, holeProblems } from '../src/engine/silhouette.js';
import { roseHoles, roseProblems } from '../src/engine/rose.js';
import { isWalkable } from '../src/engine/pathfind.js';
import { TUNING } from '../src/engine/tuning.js';
import { GOAL_HOLE_R, DT, BOARD_THICK } from '../src/engine/constants.js';
import * as THREE from 'three';
import {
  holeOutline,
  holeShape,
  holeRing,
  holeRingPair,
  MAX_CHORD,
  combineHoleRings,
  holeClusters,
  offsetRing,
  ringArea,
} from '../src/render/hole-shape.js';

/** Shoelace area of a closed outline; the sign says which way it winds. */
const signedArea = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[(i + 1) % pts.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
};

/** Is a point inside a closed ring? (Ray casting; the ring need not repeat its first point.) */
function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export const name = 'slots';

const board = (w = 12, h = 8) => ({ id: 'slots-probe', name: 'Slots probe', board: { shape: 'rect', w, h }, spawn: [1, 1], goal: [w - 2, h - 2] });
// The probe slot sits in the lower-left quadrant on purpose: near the board centre it would
// leave the etched rose no clear glass, which is a rose problem, not a slot problem.
const CHAIN = [[2, 5], [3, 5], [4, 5]];
const slot = (over = {}) => buildLevel({ ...board(), pits: [{ centers: CHAIN, radius: 0.42 }], ...over });
const world = (c, r, w = 12, h = 8) => [c + 0.5 - w / 2, r + 0.5 - h / 2];

/** Step the physics once with the marble parked at a point, and say whether it fell. */
const fallsAt = (lv, x, z) => {
  const w = makeWorld(lv);
  w.ball.x = x;
  w.ball.z = z;
  w.ball.vx = 0;
  w.ball.vz = 0;
  step(w, DT);
  return w.ball.state !== 'roll';
};

export function tests(t) {
  t.ok('a slot builds as one pit with a chain of centres', () => {
    const lv = slot();
    if (lv.pits.length !== 1) throw new Error(`${lv.pits.length} physics pits for one authored slot`);
    const pit = lv.pits[0];
    if (!pit.slot) throw new Error('the slot did not mark itself as a slot');
    if (pit.centers.length !== 3) throw new Error(`${pit.centers.length} centres`);
    // `x, z` is whichever chain point is nearest the board centre: that is what gives the
    // etched rose the true clearance from a slot it knows nothing else about.
    const [x, z] = pit.centers.reduce((best, p) => (Math.hypot(p[0], p[1]) < Math.hypot(best[0], best[1]) ? p : best));
    if (Math.abs(pit.x - x) > 1e-9 || Math.abs(pit.z - z) > 1e-9) throw new Error(`the pit is at ${pit.x},${pit.z}, not the chain point nearest the centre (${x},${z})`);
    if (pit.r !== 0.42) throw new Error(`per-pit radius was ignored (${pit.r})`);
  });

  t.ok('a slot is cut as one hole, with rounded ends, in the slab', () => {
    const lv = slot();
    const holes = slabHoles(lv, GOAL_HOLE_R).filter((h) => h.kind === 'pit');
    if (holes.length !== 1) throw new Error(`${holes.length} slab holes for one slot`);
    if (!holes[0].slot) throw new Error('the slab hole does not know it is a slot');
    if (holes[0].centers.length !== 3) throw new Error('the slab hole lost the chain');
    if (holes[0].r !== 0.42) throw new Error('the slab hole lost the radius');
  });

  t.ok('a slot blocks every cell it covers, and no others', () => {
    const lv = slot();
    for (const c of [2, 3, 4]) {
      if (isWalkable(lv, c, 5)) throw new Error(`cell ${c},5 under the slot is still walkable`);
      if (lv.grid[5][c] !== 'o') throw new Error(`cell ${c},5 is '${lv.grid[5][c]}', not a pit`);
    }
    for (const c of [1, 5]) {
      if (!isWalkable(lv, c, 5)) throw new Error(`cell ${c},5 beside the slot was blocked`);
    }
    if (!isWalkable(lv, 3, 4) || !isWalkable(lv, 3, 6)) throw new Error('the cells either side of the slot were blocked');
  });

  t.ok('a slot catches the marble along its whole length, ends included', () => {
    const lv = slot();
    const capture = 0.42 * TUNING.pitCapture;
    for (const c of [2, 2.5, 3, 3.5, 4]) {
      const [x, z] = world(c, 5);
      if (!fallsAt(lv, x, z)) throw new Error(`the marble rolled over the slot at cell ${c},5`);
    }
    // It reaches exactly as far as it is drawn: caught inside the capture radius, and not a
    // whisker beyond it.
    const [x, z] = world(3, 5);
    if (fallsAt(lv, x, z + capture + 0.06)) throw new Error('the slot caught the marble beyond its capture radius');
    if (!fallsAt(lv, x, z + capture - 0.06)) throw new Error('the slot did not catch the marble inside its capture radius');
  });

  t.ok('a font-filling radius still trips the wall rule, and a lane-width slot does not', () => {
    // r <= 0.5 keeps a hole inside its lane, which is the invariant that matters; the wall
    // rule only speaks up once a hole is wide enough to cross into a neighbouring cell.
    const lane = slot();
    if (holeProblems(lane, GOAL_HOLE_R).length) throw new Error(`a lane-width slot is reported: ${holeProblems(lane, GOAL_HOLE_R).join('; ')}`);
    const fat = buildLevel({ ...board(), walls: [[2, 6, 4, 6]], pits: [{ centers: CHAIN, radius: 0.62 }] });
    if (!holeProblems(fat, GOAL_HOLE_R).some((p) => p.includes('wider than its cell'))) throw new Error('a 0.62-radius slot was accepted');
  });

  t.ok('two separate pits that overlap are still refused', () => {
    const lv = buildLevel({ ...board(), pits: [[3, 4], { c: 3.6, r: 4 }] });
    const problems = holeProblems(lv, GOAL_HOLE_R);
    if (!problems.some((p) => p.includes('overlap'))) throw new Error(`overlapping pits were accepted: ${problems.join('; ') || '(none)'}`);
  });

  t.ok('a slot is one hole for the rose, and the rose still dodges it', () => {
    const lv = slot();
    const pits = roseHoles(lv).filter((h) => h.what === 'pit');
    if (pits.length !== 1) throw new Error(`${pits.length} rose holes for one slot`);
    if (roseProblems(lv).length) throw new Error(`rose problems: ${roseProblems(lv).join('; ')}`);
  });

  t.ok('sub-unit coordinates place objects exactly where they are asked to', () => {
    const lv = buildLevel({
      ...board(),
      pegs: [{ cell: [3.25, 4.5], r: 0.26 }],
      movers: [{ from: [2.125, 2], to: [6.875, 2], len: 1, speed: 1, phase: 0 }],
      teleports: [{ a: [1.125, 4.5], b: [8.5, 3.125] }],
      buttons: [{ cell: [4.625, 2.25], gate: 'g1', hold: 4 }],
      gates: [{ id: 'g1', seg: [[2.375, 2.5], [2.375, 3.5]] }],
      magnets: [{ cell: [8.75, 3.125], radius: 1.5, strength: 1 }],
    });
    const near = (got, want, what) => {
      if (Math.abs(got - want) > 1e-9) throw new Error(`${what}: ${got} != ${want}`);
    };
    near(lv.features.pegs[0].x, world(3.25)[0], 'peg x');
    near(lv.features.pegs[0].z, world(0, 4.5)[1], 'peg z');
    near(lv.features.movers[0].from[0], world(2.125)[0], 'mover from x');
    near(lv.features.movers[0].to[1], world(0, 2)[1], 'mover to z');
    near(lv.features.pads[0].a.x, world(1.125)[0], 'pad a x');
    near(lv.features.pads[0].b.x, world(8.5)[0], 'pad b x');
    near(lv.features.pads[0].b.z, world(0, 3.125)[1], 'pad b z');
    near(lv.features.plates[0].x, world(4.625)[0], 'plate x');
    near(lv.features.magnets[0].z, world(0, 3.125)[1], 'magnet z');
    near(lv.features.gates[0].segments[0].a[0], world(2.375)[0], 'gate segment x');
    // A button is an OBJECT, like a pit, not a painted cell: it sits on whatever ground it was
    // placed on, so it records its own covering cell and leaves the grid's floor alone. The pads
    // are still painted into the grid, exactly as they always were.
    if (lv.features.plates[0].cell[0] !== 5 || lv.features.plates[0].cell[1] !== 2) {
      throw new Error(`the plate's covering cell is ${lv.features.plates[0].cell}`);
    }
    if (lv.grid[2][5] !== '.') throw new Error(`the plate replaced the ground on its own cell ('${lv.grid[2][5]}')`);
    if (lv.grid[5][1] !== 'p' || lv.grid[3][9] !== 'p') throw new Error('the pads did not land on their covering cells');
  });

  t.ok('the spawn and goal may sit on a fraction, and the grid keeps the covering cell', () => {
    const lv = buildLevel({ ...board(), spawn: [1.125, 5.875], goal: [9.25, 1.125] });
    if (Math.abs(lv.spawn.x - world(1.125)[0]) > 1e-9 || Math.abs(lv.spawn.z - world(0, 5.875)[1]) > 1e-9) {
      throw new Error('spawn does not sit on its authored coordinate');
    }
    if (lv.spawn.cell[0] !== 1 || lv.spawn.cell[1] !== 6) throw new Error(`spawn covering cell ${lv.spawn.cell}`);
    if (lv.goal.cell[0] !== 9 || lv.goal.cell[1] !== 1) throw new Error(`goal covering cell ${lv.goal.cell}`);
    if (lv.grid[1][9] !== 'G' || lv.grid[6][1] !== 'S') throw new Error('spawn/goal were not marked on their covering cells');
  });

  t.ok('an eighth-of-a-cell pit builds, blocks what it reaches, and catches the marble', () => {
    const lv = buildLevel({ ...board(), pits: [{ c: 3.125, r: 4.25, radius: 0.42 }] });
    const pit = lv.pits[0];
    if (pit.slot) throw new Error('a single fractional pit was treated as a slot');
    if (pit.cell[0] !== 3 || pit.cell[1] !== 4) throw new Error(`covering cell ${pit.cell}`);
    if (isWalkable(lv, 3, 4)) throw new Error('the covering cell is still walkable');
    // Off-centre, the hole reaches 0.375 into cell 4,1 too, and blocking any cell it reaches
    // is deliberate: a marble path must never be planned through the drawn rim of a hole.
    if (isWalkable(lv, 4, 4)) throw new Error('a cell the pit reaches was left walkable');
    if (!isWalkable(lv, 2, 4)) throw new Error('a cell the pit does not reach (0.625 away) was blocked');
    const [x, z] = world(3.125, 4.25);
    if (!fallsAt(lv, x, z)) throw new Error('the marble did not fall into the fractional pit');
    if (cellIndex(3.125) !== 3 || cellIndex(4.25) !== 4) throw new Error('cellIndex is wrong');
    if (Math.abs(chainCellDistance([[3.125, 4.25]], 3, 4)) > 1e-9) throw new Error('the covering cell is not covered');
  });

  t.ok('a pit on a cell centre still blocks exactly one cell', () => {
    const lv = buildLevel({ ...board(), pits: [[3, 4]] });
    if (isWalkable(lv, 3, 4)) throw new Error('the pit cell is walkable');
    for (const [c, r] of [[2, 4], [4, 4], [3, 3], [3, 5]]) {
      if (!isWalkable(lv, c, r)) throw new Error(`cell ${c},${r} was blocked by a cell-centred pit`);
    }
  });

  t.ok('a fractionally authored pit refuses to build off the board', () => {
    let threw = false;
    try {
      buildLevel({ ...board(), pits: [[11.5, 4]] });
    } catch {
      threw = true;
    }
    if (!threw) throw new Error('an off-board pit built anyway');
  });

  t.ok('a pit outline is fine enough to read as a circle, not as a polygon', () => {
    // The outline used to be built by `Path.absarc` and tessellated by whichever geometry builder
    // consumed it, and every builder here asked for `curveSegments: 4` — so a pit was drawn as an
    // octagon. `holeRing` now emits the arc itself, and this is the check that keeps it that way:
    // no facet may be longer than the chord the ring is built for.
    for (const r of [0.3, 0.42, 0.62]) {
      const ring = holeRing({ x: 0, z: 0, r });
      let longest = 0;
      for (let i = 0; i < ring.length; i++) {
        const [x0, z0] = ring[i];
        const [x1, z1] = ring[(i + 1) % ring.length];
        longest = Math.max(longest, Math.hypot(x1 - x0, z1 - z0));
      }
      if (ring.length < 40) throw new Error(`a radius ${r} pit is drawn with only ${ring.length} facets`);
      if (longest > MAX_CHORD + 1e-9) throw new Error(`a radius ${r} pit has a ${longest.toFixed(4)}-long facet (> ${MAX_CHORD})`);
      // …and every vertex really is on the circle, so the facets only ever cut *inside* the arc.
      for (const [x, z] of ring) {
        if (Math.abs(Math.hypot(x, z) - r) > 1e-9) throw new Error(`a pit vertex is ${Math.hypot(x, z)} from the centre, not ${r}`);
      }
    }
  });

  t.ok('a hole’s funnel is one band round the whole outline, not a rim per centre', () => {
    // The renderer used to stamp a separate funnel at every sampled centre of a slot, so a
    // multi-centre slot showed a row of overlapping circular rims *inside* the routed hole. It is
    // now a single band lofted between the outline at the mouth radius and the same outline at the
    // throat radius. This is the invariant that keeps that band a closed surface: both loops come
    // from one walk of the outline, so they share vertex order and count exactly, at any radius -
    // including a bend's inner corner, where the throat is not a constant normal offset of the
    // mouth and two independent walks would leave a seam or a twist.
    const holes = [
      { x: 0, z: 0, r: 0.42 },
      { centers: [[0, 0], [2, 0]], r: 0.42 },
      { centers: [[0, 0], [1.5, 0], [1.5, 1.5]], r: 0.42 },
    ];
    for (const hole of holes) {
      const centers = hole.centers ?? [[hole.x, hole.z]];
      const throat = Math.max(hole.r * 0.5, hole.r - BOARD_THICK);
      const { outer, inner } = holeRingPair(hole, throat);
      const mouth = holeRing(hole);
      if (outer.length !== inner.length) throw new Error(`the funnel loops differ: ${outer.length} vs ${inner.length}`);
      if (outer.length !== mouth.length) throw new Error('the funnel mouth is not the hole outline');
      outer.forEach(([x, z], i) => {
        if (Math.hypot(x - mouth[i][0], z - mouth[i][1]) > 1e-9) throw new Error('the funnel mouth strays from the hole outline');
      });
      // Both loops really are the outline at their own radius: every vertex sits one radius from
      // the chain, so each is the region's boundary and the band has no overhang into the trap.
      for (const [radius, loop] of [[hole.r, outer], [throat, inner]]) {
        for (const [x, z] of loop) {
          const d = chainDistance(centers, x, z);
          if (Math.abs(d - radius) > 0.02) throw new Error(`a radius-${radius} vertex is ${d.toFixed(3)} from the chain`);
        }
      }
    }
  });

  t.ok('a slot outline is the swept chain: it closes, stays in reach, and winds like a circle', () => {
    const chain = [[0, 0], [2, 0]];
    const slot = holeOutline(THREE, { centers: chain, r: 0.42 });
    const pts = slot.getPoints(24).map((p) => [p.x, p.y]);
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) > 1e-6 && Math.hypot(first[0] - last[0], first[1] - last[1]) > 0.2) {
      throw new Error(`the slot outline does not close: ${first} → ${last}`);
    }
    // Every point of the boundary is on the swept region's edge: distance to the chain == r.
    for (const [x, z] of pts) {
      const d = chainDistance(chain, x, z);
      if (d < 0.42 - 0.02 || d > 0.42 + 0.02) throw new Error(`outline point ${x.toFixed(3)},${z.toFixed(3)} is ${d.toFixed(3)} from the chain, not ${0.42}`);
    }
    // A stadium 2 long and 0.84 wide, with round ends.
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    if (Math.abs(Math.max(...xs) - (2 + 0.42)) > 0.02 || Math.abs(Math.min(...xs) + 0.42) > 0.02) throw new Error('the stadium is not as long as the chain plus a radius at each end');
    if (Math.abs(Math.max(...zs) - 0.42) > 0.02 || Math.abs(Math.min(...zs) + 0.42) > 0.02) throw new Error('the stadium is not a radius wide');
    // Winding must match the circles the slab already cuts, or the hole would cut as a solid.
    const circle = holeOutline(THREE, { x: 0, z: 0, r: 0.42 });
    const circleArea = signedArea(circle.getPoints(24).map((p) => [p.x, p.y]));
    if (Math.sign(signedArea(pts)) !== Math.sign(circleArea)) throw new Error('the slot outline winds the opposite way to a hole');
    if (Math.abs(Math.abs(signedArea(pts)) - (2 * 0.84 + Math.PI * 0.42 * 0.42)) > 0.06) throw new Error(`the slot area is not a stadium (${signedArea(pts).toFixed(3)})`);
  });

  t.ok('a bent slot outline rounds the outside of the bend and never bites inside the trap', () => {
    const chain = [[0, 0], [1.5, 0], [1.5, 1.5]];
    const pts = holeOutline(THREE, { centers: chain, r: 0.42 }).getPoints(16).map((p) => [p.x, p.y]);
    for (const [x, z] of pts) {
      const d = chainDistance(chain, x, z);
      // The outline is the boundary of the region the marble falls into, so *every* point of
      // it is exactly one radius from the chain: the same distance on the straight runs, at
      // the sharp inside of the bend and along the arc on the outside of it. If any point
      // came closer, the hole would be cutting into its own trap.
      if (Math.abs(d - 0.42) > 0.02) throw new Error(`the bent outline is ${d.toFixed(3)} from the chain, not ${0.42}`);
    }
    const shape = holeShape(THREE, { centers: chain, r: 0.42 });
    if (!shape.getPoints(8).length) throw new Error('holeShape produced an empty shape');
  });

  t.ok('a moving slot carries its offset through the capture test', () => {
    const pit = { centers: [[0, 0], [1, 0]], r: 0.42, x: 0.5, z: 0, baseX: 0.5, baseZ: 0 };
    if (pitDistance(pit, 0.5, 0) > 1e-9) throw new Error('the slot does not cover its own middle');
    pit.x = 1.5;
    if (pitDistance(pit, 1.5, 0) > 1e-9) throw new Error('the moved slot does not cover its new middle');
    if (pitDistance(pit, 0.5, 0) > 1.5) throw new Error('the offset was not applied at all');
  });

  t.ok('two pits that overlap are one drawn region, wound the way a hole is', () => {
    const a = { centers: [[2, 5], [3, 5]], r: 0.42 };
    const b = { centers: [[2.5, 5.5], [3.5, 5.5]], r: 0.42 };
    if (!holeClusters([a, b]).some((g) => g.length === 2)) throw new Error('overlapping pits were not clustered');
    const pieces = combineHoleRings([a, b]);
    if (pieces.length !== 1) throw new Error(`${pieces.length} regions for two overlapping pits, not one`);
    const union = pieces[0].outer;
    if (ringArea(union) >= 0) throw new Error('the union is not wound clockwise like every other hole');
    // The union is bigger than either hole, and smaller than both added together.
    const one = Math.abs(ringArea(holeRing(a)));
    const area = Math.abs(ringArea(union));
    if (!(area > one + 1e-9 && area < 2 * one - 1e-9)) throw new Error(`union area ${area.toFixed(3)} is not between ${one.toFixed(3)} and ${(2 * one).toFixed(3)}`);
    // Every point of the union is inside one of the two pits: nothing was added that is not a hole.
    for (const [x, z] of union) {
      const inside = chainDistance(a.centers, x, z) <= a.r + 0.02 || chainDistance(b.centers, x, z) <= b.r + 0.02;
      if (!inside) throw new Error(`the union reaches (${x.toFixed(3)}, ${z.toFixed(3)}), which neither pit covers`);
    }
    // And both pits' own ground is covered: the union swallows each centre.
    for (const c of [...a.centers, ...b.centers]) {
      const covered = pointInRing(union, c[0], c[1]);
      if (!covered) throw new Error(`the union leaves pit centre ${c} outside itself`);
    }
  });

  t.ok('a single hole is returned from combineHoleRings untessellated, bit for bit', () => {
    const slot = { centers: [[2, 5], [3, 5], [4, 5]], r: 0.42 };
    const pieces = combineHoleRings([slot]);
    if (pieces.length !== 1 || pieces[0].voids.length) throw new Error('one hole did not come back as one piece');
    const direct = holeRing(slot);
    if (pieces[0].outer.length !== direct.length) throw new Error('the lone hole was retessellated');
    pieces[0].outer.forEach(([x, z], i) => {
      if (Math.abs(x - direct[i][0]) > 1e-12 || Math.abs(z - direct[i][1]) > 1e-12) throw new Error(`vertex ${i} moved`);
    });
  });

  t.ok('the throat of a combined hole is its outline pulled in, not a second rim', () => {
    const a = { centers: [[2, 5], [3, 5]], r: 0.42 };
    const b = { centers: [[2.5, 5.5], [3.5, 5.5]], r: 0.42 };
    const union = combineHoleRings([a, b])[0].outer;
    const throat = offsetRing(union, BOARD_THICK);
    if (throat.length !== union.length) throw new Error('the throat lost vertices against the mouth');
    const inward = Math.abs(ringArea(throat));
    if (!(inward > 0 && inward < Math.abs(ringArea(union)))) throw new Error(`the throat area ${inward.toFixed(3)} is not inside the mouth`);
    // The mouth of a single round pit pulled in by the board's thickness is the circle the
    // funnel already dropped to, so the combined path agrees with the single-hole one.
    const circle = holeRing({ centers: [[0, 0]], r: 0.42 });
    for (const [x, z] of offsetRing(circle, BOARD_THICK)) {
      // Within a facet of the true throat: the ring is a polygon, so its offset vertices sit a
      // hair outside the circle the chord would leave (0.005 here at MAX_CHORD).
      if (Math.abs(Math.hypot(x, z) - (0.42 - BOARD_THICK)) > 0.01) throw new Error('the offset ring is not the throat radius');
    }
  });

  t.ok('every shipped level keeps exactly the pits it had, to the last bit', () => {
    for (const spec of LEVELS) {
      const lv = buildLevel(spec);
      if (lv.pits.length !== (spec.pits ?? []).length) throw new Error(`${spec.id}: pit count changed`);
      lv.pits.forEach((pit, i) => {
        const src = spec.pits[i];
        const c = Array.isArray(src) ? src[0] : src.c;
        const r = Array.isArray(src) ? src[1] : src.r;
        const [x, z] = world(c, r, lv.w, lv.h);
        if (Math.abs(pit.x - x) > 1e-12 || Math.abs(pit.z - z) > 1e-12) throw new Error(`${spec.id}: pit ${i} moved`);
        if (pit.slot) throw new Error(`${spec.id}: pit ${i} became a slot`);
        if (pit.centers.length !== 1) throw new Error(`${spec.id}: pit ${i} grew a chain`);
        if (pit.r !== (spec.pitRadius ?? 0.42)) throw new Error(`${spec.id}: pit ${i} radius changed to ${pit.r}`);
        if (Math.abs(pitDistance(pit, x, z + 0.2) - 0.2) > 1e-12) throw new Error(`${spec.id}: pit ${i} capture distance changed`);
      });
    }
  });
}
