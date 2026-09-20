//  Materials: whole-cell ground, and PLATES aligned to an eighth of a cell.
//
//  Two things had to become true for a pit to work in any material:
//
//    * a pit is a HOLE, not a paint job. It used to overwrite the cell's material character, so a
//      pit in ice deleted the ice over every cell it reached — a round hole in a square bald patch
//      of bare wood, and material removed that the hole never covered.
//    * the drawn plate has to be CUT by the hole. Ice drawn as a row of cell-sized tiles can only
//      lose whole tiles, which is the same square patch by another route.
//
//  A plate is authored in cell-EDGE coordinates, so `whole cells` lands on cell boundaries (which
//  is what the cell-rect form means) and an eighth of a cell is a legitimate edge. Its geometry is
//  exact: regions are kept on a 1/8 lattice, which every authored rectangle lands on.

import { LEVELS, buildLevel, ICE, PIT, isPitCell, toEdgeSpace } from '../src/engine/levels.js';
import { makeWorld, surfaceAt } from '../src/engine/physics.js';
import { isWalkable } from '../src/engine/pathfind.js';
import { slabHoles, holeProblems } from '../src/engine/silhouette.js';
import {
  makeRegion,
  regionGeometry,
  regionLoops,
  regionArea,
  loopsToShapes,
  loopArea,
  pointInLoop,
} from '../src/engine/materials.js';
import { GOAL_HOLE_R } from '../src/engine/constants.js';

export const name = 'materials';

const board = (w = 12, h = 8) => ({
  id: 'materials-probe',
  name: 'Materials probe',
  board: { shape: 'rect', w, h },
  spawn: [1, 1],
  goal: [w - 2, h - 2],
});
const build = (over = {}) => buildLevel({ ...board(), ...over });

/** The surface under a cell centre. */
const surfaceOf = (lv, c, r) => surfaceAt(makeWorld(lv), c + 0.5 - lv.w / 2, r + 0.5 - lv.h / 2);

/** The holes of a level as cell-edge chains, which is what a material region is measured against. */
const edgeHoles = (lv) =>
  slabHoles(lv, GOAL_HOLE_R)
    .filter((h) => !h.moving)
    .map((h) => ({ chain: (h.centers ?? [[h.x, h.z]]).map(([x, z]) => toEdgeSpace(lv, x, z)), r: h.r, cell: h.cell, slot: !!h.slot }));

/** The geometry one material of a level asks the renderer to draw. */
const geometryOf = (lv, id) => regionGeometry(lv.materials[id], edgeHoles(lv));

export const tests = (t) => {
  t.ok('a pit no longer deletes the material it is cut into', () => {
    const lv = build({ ice: [[2, 2, 9, 4]], pits: [[5, 3]] });
    if (lv.grid[3][5] !== ICE) throw new Error(`the ice under the pit became '${lv.grid[3][5]}'`);
    if (!isPitCell(lv, 5, 3)) throw new Error('the pit cell is not in the pit mask');
    for (const [c, r] of [[4, 3], [6, 3], [5, 2], [5, 4]]) {
      if (lv.grid[r][c] !== ICE) throw new Error(`ice at ${c},${r} became '${lv.grid[r][c]}'`);
    }
  });

  t.ok('a pit still blocks the cell, mask or no character', () => {
    const lv = build({ ice: [[2, 2, 9, 4]], pits: [[5, 3]] });
    if (isWalkable(lv, 5, 3)) throw new Error('a pit over ice is still walkable');
    if (!isWalkable(lv, 4, 3) || !isWalkable(lv, 6, 3)) throw new Error('the ice beside the pit stopped being walkable');
  });

  t.ok('a pit on plain floor is bit for bit what it always was', () => {
    const lv = build({ pits: [[5, 3]] });
    if (lv.grid[3][5] !== PIT) throw new Error(`floor under a pit is '${lv.grid[3][5]}', not '${PIT}'`);
  });

  t.ok('first-tilt builds the grid it has always built', () => {
    // The strongest statement that nothing already authored changed meaning: every row, literally.
    const want = [
      '################',
      '#G......o......#',
      '#..............#',
      '#..##########..#',
      '#..............#',
      '#....o....o....#',
      '#..##########..#',
      '#..##########..#',
      '#..............#',
      '#S.....o...o...#',
      '################',
    ];
    const lv = buildLevel(LEVELS.find((l) => l.id === 'first-tilt'));
    const got = lv.grid.map((row) => row.join(''));
    for (let r = 0; r < want.length; r++) {
      if (got[r] !== want[r]) throw new Error(`row ${r} is '${got[r]}', expected '${want[r]}'`);
    }
  });

  t.ok('a material plate answers friction at eighth-of-a-cell resolution', () => {
    const lv = build({ sand: [{ rect: [3, 3.125, 9, 3.875] }] });
    if (surfaceOf(lv, 5, 3) !== 'sand') throw new Error('a cell inside the plate is not sand');
    const w = makeWorld(lv);
    const x = 5.5 - lv.w / 2;
    if (surfaceAt(w, x, 3.25 - lv.h / 2) !== 'sand') throw new Error('the plate is not sand just inside its top edge');
    if (surfaceAt(w, x, 3.0 - lv.h / 2) !== 'wood') throw new Error('the plate is sand above its top edge (3.125)');
    if (surfaceAt(w, x, 3.5 - lv.h / 2) !== 'wood' === false) throw new Error('the plate is not sand at its midline');
  });

  t.ok('plates and cell rects agree at whole-cell alignment', () => {
    const cell = build({ ice: [[3, 3, 8, 4]] });
    const plate = build({ ice: [{ rect: [3, 3, 9, 5] }] });
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 12; c++) {
        const a = surfaceOf(cell, c, r);
        const b = surfaceOf(plate, c, r);
        if (a !== b) throw new Error(`cell ${c},${r}: cell form says ${a}, plate form says ${b}`);
      }
    }
  });

  /**Distance from a cell-space point to a hole's chain, the same measure the trap uses. */
  const chainDist = (chain, x, z) => {
    let best = Infinity;
    if (chain.length === 1) return Math.hypot(x - chain[0][0], z - chain[0][1]);
    for (let i = 1; i < chain.length; i++) {
      const [ax, az] = chain[i - 1];
      const [bx, bz] = chain[i];
      const dx = bx - ax;
      const dz = bz - az;
      const l2 = dx * dx + dz * dz;
      let t = l2 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
    }
    return best;
  };

  /** Is this cell-space point drawn as material? */
  const covered = (geo, x, z) =>
    geo.shapes.some((s) => pointInLoop(s.outer, x, z) && !s.voids.some((v) => pointInLoop(v, x, z)));

  t.ok('a pit wholly inside a plate is a hole in it, on the hole\'s own radius', () => {
    const lv = build({ ice: [[2, 2, 10, 5]], pits: [[5, 3.5]] });
    const geo = geometryOf(lv, 'ice');
    if (geo.shapes.length !== 1) throw new Error(`expected one plate shape, got ${geo.shapes.length}`);
    if (geo.shapes[0].voids.length !== 1) throw new Error(`expected one hole in the plate, got ${geo.shapes[0].voids.length}`);
    if (!geo.cut.includes(0)) throw new Error('the pit over the plate was not reported as cut');
    const hole = edgeHoles(lv)[0];
    // Every vertex of the cut is exactly one radius from the pit's centre: the edge is the real
    // arc, and a vertex anywhere else would be a lattice step or a chord across the hole.
    for (const [x, z] of geo.shapes[0].voids[0]) {
      const d = Math.abs(chainDist(hole.chain, x, z) - hole.r);
      if (d > 1e-9) throw new Error(`a hole vertex is ${d.toFixed(4)} off the pit's radius`);
    }
    // And the area it takes is the hole's area, not a ring of whole lattice squares.
    const want = geo.original - Math.PI * hole.r * hole.r;
    if (Math.abs(geo.area - want) > 0.01) throw new Error(`the hole took ${(geo.original - geo.area).toFixed(4)} cells, not ${(geo.original - want).toFixed(4)}`);
  });

  t.ok('a pit straddling a plate\'s edge cuts that edge along the hole\'s arc', () => {
    // The plate's bottom edge is at 4.5 in edge space; cell 4.25 puts this pit's centre at 4.75,
    // a quarter of a cell past that edge, so it pokes out of it.
    const lv = build({ ice: [{ rect: [3, 4, 9, 4.5] }], pits: [{ c: 6, r: 4.25 }] });
    const geo = geometryOf(lv, 'ice');
    const hole = edgeHoles(lv)[0];
    if (geo.shapes.length !== 1) throw new Error(`a straddling hole should leave one plate, got ${geo.shapes.length}`);
    if (geo.shapes[0].voids.length) throw new Error('a straddling hole came out as a void: the plate was not cut by it');
    if (!geo.cut.includes(0)) throw new Error('the straddling hole was not reported as cut');
    // Material left lying over a hole is the one direction that must never happen, and it is the
    // direction the lattice version of this got wrong the other way: it removed the whole 1/8
    // squares the hole reached, drawing the plate's edge as a staircase. So check both sides of
    // the arc: nothing drawn inside the hole, and the plate reaching all the way to the arc.
    for (let i = 0; i < 720; i++) {
      const a = (i / 720) * Math.PI * 2;
      for (const f of [0.8, 0.95]) {
        const [x, z] = [hole.chain[0][0] + Math.cos(a) * hole.r * f, hole.chain[0][1] + Math.sin(a) * hole.r * f];
        if (covered(geo, x, z)) throw new Error(`material is drawn over the hole at ${x.toFixed(3)},${z.toFixed(3)}`);
      }
      // Just outside the arc, and inside the plate: that ground is the plate's.
      const [ox, oz] = [hole.chain[0][0] + Math.cos(a) * hole.r * 1.02, hole.chain[0][1] + Math.sin(a) * hole.r * 1.02];
      const inPlate = ox > 3 && ox < 9 && oz > 4 && oz < 4.5;
      if (inPlate && !covered(geo, ox, oz)) throw new Error(`the plate stops short of the hole at ${ox.toFixed(3)},${oz.toFixed(3)}`);
    }
    // And the bite is exactly the part of the disc that lies inside the plate — measured here by
    // counting a fine grid, so the test is not just repeating the renderer's own arithmetic.
    const [cx, cz] = hole.chain[0];
    const step = 0.001;
    let shared = 0;
    for (let x = cx - hole.r; x <= cx + hole.r; x += step) {
      for (let z = cz - hole.r; z <= cz + hole.r; z += step) {
        if (Math.hypot(x - cx, z - cz) > hole.r) continue;
        if (x > 3 && x < 9 && z > 4 && z < 4.5) shared += step * step;
      }
    }
    const removed = geo.original - geo.area;
    if (Math.abs(removed - shared) > 0.004) throw new Error(`the straddling hole took ${removed.toFixed(4)} cells, but only ${shared.toFixed(4)} of it is inside the plate`);
  });

  t.ok('a pit that slices clean across a thin plate leaves two plates', () => {
    const lv = build({ ice: [{ rect: [3, 4, 9, 4.125] }], pits: [{ c: 6, r: 3.5625 }] });
    const geo = geometryOf(lv, 'ice');
    if (geo.shapes.length !== 2) throw new Error(`a sliced strip should be two plates, got ${geo.shapes.length}`);
    // Both halves are outside the hole, and both are real ground.
    if (geo.area < 0.05) throw new Error(`the two halves came out as ${geo.area} cells`);
    if (Math.abs(geo.area - geo.original) < 0.01) throw new Error('the slice removed nothing');
  });

  t.ok('a plate with a piece missing comes out as one loop with that piece as a void', () => {
    // A 3x3 plate whose middle cell belongs to something else — a belt painted into an ice field,
    // say. The outline is one loop and the missing cell is a void the renderer turns into a hole.
    const withVoid = makeRegion(12, 8, [
      [2, 2, 5, 3],
      [2, 3, 3, 4],
      [4, 3, 5, 4],
      [2, 4, 5, 5],
    ]);
    const shapes = loopsToShapes(regionLoops(withVoid));
    if (shapes.length !== 1) throw new Error(`${shapes.length} loops for a plate with one cell missing`);
    if (shapes[0].voids.length !== 1) throw new Error(`${shapes[0].voids.length} voids for one missing cell`);
    if (Math.abs(loopArea(shapes[0].voids[0]) + 1) > 1e-9) throw new Error('the void is not one cell');
    if (Math.abs(regionArea(withVoid) - 8) > 1e-9) throw new Error(`the plate is ${regionArea(withVoid)} cells, not 8`);
  });

  t.ok('two separate plates are two shapes, not one broken loop', () => {
    const lv = build({ steel: [{ rect: [2, 2, 4, 4] }, { rect: [6, 2, 8, 4] }] });
    const loops = regionLoops(lv.materials.steel);
    if (loops.length !== 2) throw new Error(`two separate plates produced ${loops.length} loops`);
    for (const loop of loops) if (Math.abs(loopArea(loop) - 4) > 1e-9) throw new Error(`a 2x2 plate has area ${loopArea(loop)}`);
  });

  t.ok('a diagonal run of plates stays exact instead of wandering off', () => {
    // Squares touching only at a corner have two boundary edges out of that corner. Getting the
    // turn wrong there used to send the walk into nonsense (loops thousands of cells across).
    const diagonal = (lv) => regionLoops(lv.materials.ice);
    const lv = build({ ice: [{ rect: [2, 2, 3, 3] }, { rect: [3, 3, 4, 4] }] });
    const loops = diagonal(lv);
    if (loops.length !== 2) throw new Error(`${loops.length} loops for two corner-touching cells`);
    for (const loop of loops) if (Math.abs(loopArea(loop) - 1) > 1e-9) throw new Error(`a corner-touching cell has area ${loopArea(loop)}`);
    // And a staircase, which is edge-connected, is one loop.
    const stair = build({ ice: [{ rect: [2, 2, 3, 3] }, { rect: [3, 2, 4, 3] }, { rect: [4, 3, 5, 4] }] });
    const areas = regionLoops(stair.materials.ice).map((l) => loopArea(l));
    const total = areas.filter((a) => a > 0).reduce((a, b) => a + b, 0);
    if (Math.abs(total - 3) > 1e-9) throw new Error(`the staircase covers ${total} cells, not 3`);
  });

  t.ok('a plate cannot be authored off the board, over a wall, or without area', () => {
    const bad = [
      [{ rect: [-1, 2, 4, 4] }, 'off the left edge'],
      [{ rect: [2, 2, 4, 12] }, 'off the bottom edge'],
      [{ rect: [2, 2, 4, 4.3] }, 'not an eighth of a cell'],
      [{ rect: [2, 2, 2, 4] }, 'no width'],
      [{ rect: [2, 2, 4, 2] }, 'no height'],
      [{ nope: 1 }, 'neither a cell rect nor a plate'],
    ];
    for (const [entry, why] of bad) {
      let threw = null;
      try {
        build({ ice: [entry] });
      } catch (err) {
        threw = err.message;
      }
      if (!threw) throw new Error(`a plate ${why} was accepted`);
      if (!threw.includes('ice')) throw new Error(`the error for a plate ${why} does not name the material: ${threw}`);
    }
    let threw = null;
    try {
      build({ walls: [[4, 3, 5, 4]], ice: [{ rect: [3, 3, 6, 5] }] });
    } catch (err) {
      threw = err.message;
    }
    if (!threw || !threw.includes('wall')) throw new Error(`a plate over a wall was accepted (${threw})`);
  });

  t.ok('a plate over a pit leaves the hole a hole', () => {
    const lv = build({ ice: [{ rect: [2, 2, 10, 5] }], pits: [[5, 3]] });
    if (!isPitCell(lv, 5, 3)) throw new Error('the pit under the plate is not blocked');
    if (isWalkable(lv, 5, 3)) throw new Error('the pit under the plate is walkable');
    if (surfaceOf(lv, 5, 3) !== 'ice') throw new Error('the plate does not answer friction under the pit');
    const problems = holeProblems(lv, GOAL_HOLE_R);
    if (problems.length) throw new Error(`the plate introduced a hole problem: ${problems.join('; ')}`);
  });

  t.ok('a plate does not change the ground anywhere it is not', () => {
    const withPlate = build({ ice: [{ rect: [6, 2, 9, 5] }] });
    const without = build({});
    for (const [c, r] of [[2, 5], [3, 6], [4, 3], [10, 6]]) {
      const a = surfaceOf(withPlate, c, r);
      const b = surfaceOf(without, c, r);
      if (a !== b) throw new Error(`a plate changed the ground at ${c},${r} from ${b} to ${a}`);
    }
    if (surfaceOf(withPlate, 7, 3) !== 'ice') throw new Error('the plate is not ice where it says it is');
  });

  t.ok('the plate outline matches its lattice exactly', () => {
    // The outline the renderer extrudes is the region's own boundary, so its area must equal the
    // lattice area it came from — otherwise something is drawn that the marble does not feel.
    for (const rect of [
      [2, 2, 10, 5],
      [3.125, 2.25, 9.875, 4.5],
      [4, 4, 4.125, 4.875],
    ]) {
      const lv = build({ ice: [{ rect }] });
      const geo = geometryOf(lv, 'ice');
      const outline = geo.shapes.reduce((a, s) => a + Math.abs(loopArea(s.outer)) - s.voids.reduce((v, x) => v + Math.abs(loopArea(x)), 0), 0);
      if (Math.abs(outline - geo.area) > 1e-9) {
        throw new Error(`${rect}: outline area ${outline} does not match the region ${geo.area}`);
      }
    }
  });
};
