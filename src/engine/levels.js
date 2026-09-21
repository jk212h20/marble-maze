//  Level definitions.
//
//  A level is authored against a grid of unit cells (CELL = 1 board unit) with a small DSL:
//
//    board   : silhouette (rect / hexagon / octagon / diamond / cross / diamondRing / star)
//    walls   : [c0, r0, c1, r1] inclusive rects filled with wall (raised wood)
//    carve   : rects forced back to plain floor (used to open gaps in walls)
//    pits    : [c, r] — a hole.  { c, r, move: [dc, dr], speed, period } slides it.
//              Every coordinate below is in *cell space*: an integer index is the centre of
//              that cell, so 3.5 sits on the edge between cells 3 and 4 and an eighth
//              (3.125) is a legitimate authoring position. A pit may sit anywhere:
//                [c, r]                       round hole on a cell centre
//                { c, r }                     round hole, fractional c/r allowed
//                { centers: [[c, r], ...] }   a SLOT: the union of overlapping circles,
//                                             drawn as a routed slot with rounded ends
//                { ..., radius: 0.42 }        per-pit radius (default spec.pitRadius or PIT_R)
//              Repeating a coordinate in `centers` is ignored; two or more distinct centres
//              make a slot. Everything is checked by tests/levels.test.js and tests/slots.test.js.
//    ice/sand/steel : rects of a different surface
//    belts   : { rect, dir: [dc, dr] } conveyor runs
//    vents   : { rect, dir: [dc, dr] } fans that blow the marble
//    ramps   : { rect, dir: [dc, dr], height } — a wedge. `rect` is a rectangle in cell-EDGE
//              coordinates like a material plate, `dir` is the direction the marble TRAVERSES
//              it — uphill, from the low edge to the crest — and `height` is how tall the wedge
//              stands at that crest. The level editor's arrow points along `dir`. The slope is
//              height over the rect's run along `dir`, so a short tall ramp is steep and a long
//              low one is gentle. The marble climbs it and launches off the crest: the face
//              there is a step, so a ramp is a one-way hill rather than something you can roll
//              back up. Its sloping side walls can be climbed only up to half the tall side
//              (RAMP_STEP_UP), so a side entry is open along the shallow half of the wedge.
//    windmills, pendulums, movers, pegs, magnets, teleports, buttons+gates, plates+lifts
//
//    A LIFT is a wall slab a plate raises or lowers while it is held:
//      lifts: [{ id, seg: [[c0, r0], [c1, r1]], plate: 'p1', mode: 'raise' | 'lower', speed }]
//    `seg` is a segment in cell space (fractions allowed, like a gate); `plate` names a
//    `buttons` entry by its `id`; `mode: 'raise'` (the default) rests flush and lifts into a
//    wall while the plate is stood on, `'lower'` rests raised and sinks while it is. `speed`
//    is how fast the slab travels through its own height, in heights per second. A slab is cut
//    from the metal of the plate that drives it, and it is a wall: as wide as a wall cell and
//    as tall as one, driven the full height out of a routed slot.
//
//    A pressure PLATE is a raised circular metal BUTTON, authored like a pit rather than painted
//    into the grid:
//      buttons: [{ id, cell: [c, r], gate?, hold?, metal?, radius? }]
//    `cell` is in cell space (an integer is a cell centre, so 3.125 is an eighth past cell 3),
//    so a button can sit on a fraction of a cell and on ANY ground - ice, sand, steel or a
//    material plate - without erasing it. `metal` picks the finish of the button and of every
//    lift it drives (see engine/metals.js); `radius` defaults to BUTTON_R. `gate` is optional:
//    a plate that only drives lifts has no gate.
//
//    materials may also be PLATES: `ice: [{ rect: [c0, r0, c1, r1] }]`, a rectangle in cell-EDGE
//    coordinates. Whole cells are still `[c0, r0, c1, r1]` rectangles of cells, exactly as before;
//    an edge-aligned plate covers the same ground, and an eighth of a cell is a legitimate edge.
//    A pit no longer deletes the ground it is cut into: ice stays ice under a pit, and the drawn
//    plate is cut by the hole's true shape (see materials.js).
//
import {
  PIT_R,
  GOAL_R,
  RAMP_HEIGHT,
  RAMP_MAX_SLOPE,
  RAMP_STEP_UP,
  LIFT_SPEED,
  LIFT_SOLID,
  BUTTON_R,
} from './constants.js';
import { makeRegion } from './materials.js';
import { DEFAULT_METAL } from './metals.js';

//  Everything is verified by tests/levels.test.js (silhouette sanity, spawn/goal present,
//  no sealed-off region, no 1-cell-wide choke on a corridor) and tests/solver.test.js
//  (a tilt autopilot actually finishes every level).

/**
 * Board coordinates back to cell space — the exact inverse of the transform `buildLevel` uses.
 *
 * A cell coordinate is a cell CENTRE (that is the authoring convention), while board space puts the
 * board's centre at the origin, so the half cell matters: getting it wrong shifts a pit half a cell
 * away from where it was authored, which is exactly how a hole ends up classified against the
 * wrong piece of ground.
 */
export function toCellSpace(level, x, z) {
  return [x + level.w / 2 - 0.5, z + level.h / 2 - 0.5];
}

/**
 * Board coordinates in CELL-EDGE space, where an integer is a cell boundary.
 *
 * The level format carries two cell-space conventions and they differ by half a cell:
 *
 *   * a pit, an object, the spawn or the goal is authored at a cell CENTRE — `7` is the middle of
 *     cell 7 (`toCellSpace`), which is what makes `3.125` read as "an eighth past cell 3's centre"
 *   * a material PLATE is authored on cell EDGES — `[4, 4, 12, 5]` covers cells 4..11 — so that
 *     whole-cell alignment and cell rectangles agree, and an eighth of a cell is an eighth of a cell
 *
 * Anything comparing a hole against a material region has to use this one, or every hole lands
 * half a cell from the ground it was cut into.
 */
export function toEdgeSpace(level, x, z) {
  return [x + level.w / 2, z + level.h / 2];
}

export function insideShape(shape, c, r, w, h) {
  const halfW = w / 2;
  const halfH = h / 2;
  const dc = c + 0.5 - halfW;
  const dr = r + 0.5 - halfH;
  switch (shape) {
    case 'rect':
      return true;
    case 'diamond':
      return Math.abs(dc) / halfW + Math.abs(dr) / halfH <= 0.98;
    case 'octagon': {
      const cut = Math.min(halfW, halfH) * 0.42;
      return !(Math.abs(dc) > halfW - cut && Math.abs(dr) > halfH - cut);
    }
    case 'hexagon': {
      const taper = halfH * 0.42; // rows over which the width narrows
      const t = Math.max(0, (Math.abs(dr) - (halfH - taper)) / taper);
      return Math.abs(dc) <= halfW * (1 - 0.62 * t);
    }
    case 'cross': {
      const arm = Math.min(halfW, halfH) * 0.55;
      return Math.abs(dc) <= arm || Math.abs(dr) <= arm;
    }
    case 'diamondRing': {
      const outer = Math.abs(dc) / halfW + Math.abs(dr) / halfH;
      return outer <= 0.98 && outer >= 0.52;
    }
    case 'star': {
      // 4-point star: a diamond crossed with a rotated square-ish body.
      const d1 = Math.abs(dc) / halfW + Math.abs(dr) / halfH;
      const d2 = Math.max(Math.abs(dc) / halfW, Math.abs(dr) / halfH);
      return d1 <= 1.02 && d2 >= 0.3;
    }
    default:
      throw new Error(`unknown board shape: ${shape}`);
  }
}

export const LEVELS = [
  {
    id: 'first-tilt',
    name: 'First Tilt',
    shape: 'Rectangle',
    difficulty: 1,
    par: 34,
    hint: 'Grip the handle and tilt the board. Get the marble to the glowing cup.',
    board: { shape: 'rect', w: 16, h: 11 },
    walls: [
      [3, 3, 12, 3],
      [3, 6, 12, 6],
      [3, 7, 12, 7],
    ],
    spawn: [1, 9],
    goal: [1, 1],
    pits: [
      [7, 9],
      [11, 9],
      [5, 5],
      [10, 5],
      [8, 1],
    ],
    // Two gentle brass pegs in the middle lane: the first taste of an obstacle that
    // pushes back, without anything that can actually trap you.
    pegs: [
      { cell: [7, 4], r: 0.26 },
      { cell: [9, 4], r: 0.26 },
    ],
    twoRoutes: true,
  },
  {
    id: 'peg-board',
    name: 'Peg Board',
    shape: 'Rectangle',
    difficulty: 2,
    par: 48,
    hint: 'Posts push back, so carry some speed into them. The wedge is a one-way hill: climb its long side, launch off the crest (faster means further), and do not expect to come back up it.',
    board: { shape: 'rect', w: 14, h: 10 },
    // Three lanes joined by wide gaps at opposite ends, so the route is one sweep: right along
    // the bottom, up the right-hand gap, left through the middle, up the left-hand gap, then
    // right along the top to the cup.
    walls: [
      [1, 6, 8, 6],
      [5, 3, 12, 3],
    ],
    spawn: [1, 8],
    goal: [12, 1],
    // One hole, in the top lane, with the whole lower row to pass beside it.
    pits: [[3, 1]],
    // A bumper gauntlet across the bottom lane, in its upper row only, so the lower row is a
    // clean run past every post.
    pegs: [
      { cell: [4, 7], r: 0.26 },
      { cell: [7, 7], r: 0.26 },
    ],
    // The mill stands mid-lane with arms that sweep the middle lane's full width and no further,
    // so the way past is a timing window and not a wall: with the arms lying along the lane there
    // is room above and below the hub, and with them stood across it there is not.
    windmills: [{ cell: [7, 4.5], arms: 2, len: 1.0, omega: 1.1, phase: 0 }],
    // A wedge across the top lane: `dir` is the way the marble traverses it, so it climbs going
    // right and launches off its right-hand crest, which it cannot climb back up.
    ramps: [{ rect: [5, 1, 9, 3], dir: [1, 0], height: 0.45 }],
  },
  {
    id: 'twin-track',
    name: 'Twin Track',
    shape: 'Rectangle',
    difficulty: 3,
    par: 26,
    hint: 'Two marbles, one cup — BOTH have to drop in. Tip them together, or shepherd them one at a time: the board only tilts one way at once.',
    multi: true, // the point of the level: every marble must reach the goal
    board: { shape: 'rect', w: 12, h: 9 },
    // A wooden boot: a rim all the way round, so neither marble can leave the board.
    walls: [
      [0, 0, 11, 0],
      [0, 8, 11, 8],
      [0, 0, 0, 8],
      [11, 0, 11, 8],
      // The funnel: two opposing wall bands pinch the upper and lower approaches into the
      // central lane, so any marble driven rightwards is steered toward the cup rather than
      // parked against a side wall.
      [6, 1, 8, 3],
      [6, 6, 8, 8],
    ],
    // Two marbles, mirrored about the lane centre (row 4.5): the upper starts on row 3, the
    // lower on row 6, and the funnel deflects each into the shared lane.
    spawn: [
      [1, 3],
      [1, 6],
    ],
    goal: [9, 4],
    // Only the first built level carries pits so far; this one stays a pure two-marble problem.
  },
  {
    id: 'both-locks',
    name: 'Both Locks',
    shape: 'Rectangle',
    difficulty: 4,
    par: 34,
    hint: 'One plate works two doors: stand on it and your neighbour\u2019s door opens while your own slams shut. So one marble keeps the door for the other \u2014 and then has to go last.',
    multi: true,
    //  The single-marble autopilot steers whichever marble is still rolling straight at the cup,
    //  so it cannot hold a plate for a fellow. That is the whole point of this level, so the
    //  suite runs it through a scripted cooperative plan instead (tests/lifts.test.js).
    coop: true,
    board: { shape: 'rect', w: 15, h: 11 },
    walls: [
      [0, 0, 14, 0],
      [0, 10, 14, 10],
      [0, 0, 0, 10],
      [14, 0, 14, 10],
      //  The central block separates the two lanes above the chamber.
      [4, 1, 10, 6],
      //  The left lane's west wall, leaving the plate's alcove open at the bottom (rows 8-9).
      [1, 1, 1, 7],
      //  Door frames: each pierces a wall band with a single-cell doorway.
      [4, 7, 4, 7],
      [4, 9, 4, 9],
      [10, 7, 10, 7],
      [10, 9, 10, 9],
    ],
    // One marble per lane. Both must reach the cup in the central chamber.
    spawn: [
      [2, 2],
      [12, 2],
    ],
    goal: [7, 8],
    // The plate sits in a blind alcove off the left lane: a marble has to choose to wait there.
    buttons: [{ id: 'p1', cell: [1, 9] }],
    lifts: [
      //  The neighbour's door: raised while the plate is free, sunk while it is held.
      { id: 'door-b', seg: [[10, 7], [10, 9]], plate: 'p1', mode: 'lower' },
      //  The holder's own door: flush while the plate is free, risen into a bar while it is held,
      //  so the marble that holds the plate cannot follow its neighbour through.
      { id: 'door-a', seg: [[4, 7], [4, 9]], plate: 'p1', mode: 'raise' },
    ],
  },
];

// ---------------------------------------------------------------------------
//  Building a level: silhouette -> rim -> wall rects -> carve rects -> features
// ---------------------------------------------------------------------------

export const OUTSIDE = ' ';
export const WALL = '#';
export const FLOOR = '.';
export const PIT = 'o';
export const ICE = 'i';
export const SAND = 's';
export const STEEL = 't';
export const BELT = 'c';
export const VENT = 'v';
export const PAD = 'p';
export const PLATE = 'b';
export const SPAWN = 'S';
export const GOAL = 'G';

/** The ground a pit may be cut into without erasing it: a material, not a mechanism. */
export const MATERIAL_CHARS = new Set([ICE, SAND, STEEL]);

/** Is this cell blocked by a pit? Authoritative even when the cell still shows its material. */
export function isPitCell(level, c, r) {
  return level.pitCells?.has(r * level.w + c) ?? false;
}

export function levelErrors(level) {
  const errs = [];
  if (!level.id) errs.push('missing id');
  if (!level.name) errs.push('missing name');
  if (!level.board?.shape) errs.push('missing board shape');
  return errs;
}

/** Turn a level spec into the concrete grid and feature list the physics/renderer use. */
export function buildLevel(spec) {
  const { w, h } = spec.board;
  const grid = [];
  for (let r = 0; r < h; r++) {
    const row = [];
    for (let c = 0; c < w; c++) row.push(insideShape(spec.board.shape, c, r, w, h) ? FLOOR : OUTSIDE);
    grid.push(row);
  }

  // Rim: any floor cell touching the outside becomes a wall.
  const rim = [];
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (grid[r][c] !== FLOOR) continue;
      const nb = [
        [c - 1, r],
        [c + 1, r],
        [c, r - 1],
        [c, r + 1],
      ];
      if (nb.some(([nc, nr]) => nc < 0 || nr < 0 || nc >= w || nr >= h || grid[nr][nc] === OUTSIDE)) {
        rim.push([c, r]);
      }
    }
  }
  for (const [c, r] of rim) grid[r][c] = WALL;

  // Authored walls must sit on real board cells.
  for (const rect of spec.walls ?? []) {
    let any = false;
    for (let r = rect[1]; r <= rect[3]; r++) {
      for (let c = rect[0]; c <= rect[2]; c++) {
        if (grid[r]?.[c] === undefined) throw new Error(`${spec.id}: wall rect ${rect} is off-board`);
        if (grid[r][c] !== OUTSIDE) any = true;
        if (grid[r][c] !== OUTSIDE) grid[r][c] = WALL;
      }
    }
    if (!any) throw new Error(`${spec.id}: wall rect ${rect} touches no board cells`);
  }

  const paint = (rects, ch) => {
    for (const rect of rects ?? []) {
      for (let r = rect[1]; r <= rect[3]; r++) {
        for (let c = rect[0]; c <= rect[2]; c++) {
          if (grid[r]?.[c] === undefined) throw new Error(`${spec.id}: rect ${rect} is off-board`);
          if (grid[r][c] === OUTSIDE) continue; // outside the silhouette, ignore
          if (grid[r][c] === WALL) throw new Error(`${spec.id}: surface rect ${rect} overlaps a wall at ${c},${r}`);
          grid[r][c] = ch;
        }
      }
    }
  };

  paint(spec.carve, FLOOR);

  // Materials, two ways. A cell rect paints the grid exactly as it always has; a `{ rect }` entry
  // is a PLATE in cell-edge coordinates, so an eighth of a cell is a legitimate edge. Nothing
  // paints the grid for a plate: it is ground over ground, and a plate over a pit must not turn
  // into a pit in the grid or it would erase the hole.
  const plates = []; // { mat, c0, r0, c1, r1 } in cell-edge coordinates
  const addMaterial = (list, id, ch) => {
    for (const entry of list ?? []) {
      if (Array.isArray(entry)) {
        paint([entry], ch);
        continue;
      }
      const rect = entry?.rect;
      if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite)) {
        throw new Error(
          `${spec.id}: ${id} entry ${JSON.stringify(entry)} is neither a cell rect nor { rect: [c0, r0, c1, r1] }`,
        );
      }
      const [c0, r0, c1, r1] = rect;
      for (const v of [c0, r0, c1, r1]) {
        if (Math.abs(v * 8 - Math.round(v * 8)) > 1e-9) {
          throw new Error(`${spec.id}: ${id} plate ${rect} has an edge (${v}) that is not an eighth of a cell`);
        }
      }
      if (!(c1 > c0) || !(r1 > r0)) throw new Error(`${spec.id}: ${id} plate ${rect} has no area`);
      if (c0 < 0 || r0 < 0 || c1 > w || r1 > h) {
        throw new Error(`${spec.id}: ${id} plate ${rect} reaches outside the board`);
      }
      for (let r = Math.floor(r0); r < Math.ceil(r1); r++) {
        for (let c = Math.floor(c0); c < Math.ceil(c1); c++) {
          if (grid[r]?.[c] === WALL) throw new Error(`${spec.id}: ${id} plate ${rect} overlaps the wall cell ${c},${r}`);
          if (grid[r]?.[c] === OUTSIDE) throw new Error(`${spec.id}: ${id} plate ${rect} reaches outside the silhouette at ${c},${r}`);
        }
      }
      plates.push({ mat: id, c0, r0, c1, r1 });
    }
  };
  addMaterial(spec.ice, 'ice', ICE);
  addMaterial(spec.sand, 'sand', SAND);
  addMaterial(spec.steel, 'steel', STEEL);

  paint(spec.belts?.map((b) => b.rect), BELT);
  paint(spec.vents?.map((v) => v.rect), VENT);

  // Everything may be authored on a fraction of a cell; a coordinate lands in the cell
  // that contains it, so an integer behaves exactly as it always did.
  const cover = (c, r) => [cellIndex(c), cellIndex(r)];
  const put = (cell, ch) => {
    const [c, r] = cover(cell[0], cell[1]);
    if (!grid[r] || grid[r][c] === undefined) throw new Error(`${spec.id}: cell ${cell} is off-board`);
    if (grid[r][c] === OUTSIDE) throw new Error(`${spec.id}: cell ${cell} is outside the silhouette`);
    grid[r][c] = ch;
  };

  const toWorld = (c, r) => [c + 0.5 - w / 2, r + 0.5 - h / 2];

  // --- pits ----------------------------------------------------------------
  const pitSpecs = (spec.pits ?? []).map((pit, i) => {
    const raw = Array.isArray(pit) ? [pit] : pit.centers ?? [[pit.c, pit.r]];
    const centers = dedupeChain(
      raw.map(([c, r]) => {
        if (!Number.isFinite(c) || !Number.isFinite(r)) throw new Error(`${spec.id}: pit ${i} has a non-finite centre`);
        const [cc, rr] = cover(c, r);
        if (!grid[rr] || grid[rr][cc] === undefined) throw new Error(`${spec.id}: pit centre ${c},${r} is off-board`);
        if (grid[rr][cc] === OUTSIDE) throw new Error(`${spec.id}: pit centre ${c},${r} is outside the silhouette`);
        return [c, r];
      }),
    );
    if (!centers.length) throw new Error(`${spec.id}: pit ${i} has no centres`);
    const r = Number.isFinite(pit.radius) ? pit.radius : PIT_R_LEVEL(spec);
    if (!(r > 0) || r > 1) throw new Error(`${spec.id}: pit ${i} has an impossible radius ${r}`);
    return {
      i,
      centers,
      cell: cover(centers[0][0], centers[0][1]),
      r,
      move: pit.move ?? null,
      speed: pit.speed ?? 0,
      period: pit.period ?? 4,
      phase: pit.phase ?? 0,
    };
  });

  // Mark every cell a pit reaches, so pathfinding treats the whole slot as blocked. A
  // cell-centred round pit marks exactly its own cell (its centre is 0 away; its
  // neighbours are a full unit away, well past r), so authored levels come out unchanged.
  //
  // A pit is a *hole*, not a paint job, so it does not delete the ground it is cut into: ice
  // stays ice under a pit. The marble never touches that ground — it is falling — and the drawn
  // plate is cut by the hole's true shape (materials.js). Plain floor still becomes PIT, exactly
  // as before, so a level authored the old way builds bit-for-bit the same.
  const pitCells = new Set();
  for (const pit of pitSpecs) {
    let c0 = Infinity;
    let c1 = -Infinity;
    let r0 = Infinity;
    let r1 = -Infinity;
    for (const [c, r] of pit.centers) {
      c0 = Math.min(c0, c);
      c1 = Math.max(c1, c);
      r0 = Math.min(r0, r);
      r1 = Math.max(r1, r);
    }
    const span = Math.ceil(pit.r + 1);
    for (let r = Math.floor(r0) - span; r <= Math.ceil(r1) + span; r++) {
      for (let c = Math.floor(c0) - span; c <= Math.ceil(c1) + span; c++) {
        if (!grid[r] || grid[r][c] === undefined || grid[r][c] === OUTSIDE) continue;
        if (chainCellDistance(pit.centers, c, r) <= pit.r) {
          pitCells.add(r * w + c);
          if (!MATERIAL_CHARS.has(grid[r][c])) grid[r][c] = PIT;
        }
      }
    }
  }

  for (const t of spec.teleports ?? []) {
    put(t.a, PAD);
    put(t.b, PAD);
  }
  //  A pressure PLATE is a circular BUTTON: an obstacle like a pit, not a painted cell. It is
  //  authored in cell space, may sit on a fraction of a cell, and sits ON whatever ground is
  //  there instead of replacing it. So it never touches the grid - a button on ice is a button on
  //  ice, and a level that paints the cell PLATE keeps that paint (the paint is only the flat
  //  inlay; the raised button is built from this list). Validated like a pit: it must land on the
  //  board, inside the silhouette, and not in a wall.
  for (const b of spec.buttons ?? []) {
    const [bc, br] = Array.isArray(b.cell) ? b.cell : [];
    if (!Number.isFinite(bc) || !Number.isFinite(br)) {
      throw new Error(`${spec.id}: plate ${b.id ?? ''} has a non-finite cell`);
    }
    const [c, r] = cover(bc, br);
    if (!grid[r] || grid[r][c] === undefined) throw new Error(`${spec.id}: plate cell ${b.cell} is off-board`);
    if (grid[r][c] === OUTSIDE) throw new Error(`${spec.id}: plate cell ${b.cell} is outside the silhouette`);
    if (grid[r][c] === WALL) throw new Error(`${spec.id}: plate cell ${b.cell} sits in a wall`);
  }
  //  `spawn` is usually a single cell `[c, r]`, but a MULTI-MARBLE level authors a list
  //  `[[c0, r0], [c1, r1], ...]` — every marble must reach the goal to win. Both shapes are
  //  accepted here so a level reads the same to the engine whichever way it was authored.
  const spawnCoords = Array.isArray(spec.spawn[0]) ? spec.spawn : [spec.spawn];
  if (!spawnCoords.length) throw new Error(`${spec.id}: no spawn`);
  for (const s of spawnCoords) put(s, SPAWN);
  put(spec.goal, GOAL);

  // Wall collision segments: every wall-cell edge facing a non-wall cell.
  const segments = [];
  const isWall = (c, r) => c < 0 || r < 0 || c >= w || r >= h || grid[r][c] === WALL;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (grid[r][c] !== WALL) continue;
      const x0 = c - w / 2;
      const x1 = c + 1 - w / 2;
      const z0 = r - h / 2;
      const z1 = r + 1 - h / 2;
      if (!isWall(c, r - 1)) segments.push({ a: [x0, z0], b: [x1, z0], kind: 'wall' });
      if (!isWall(c, r + 1)) segments.push({ a: [x0, z1], b: [x1, z1], kind: 'wall' });
      if (!isWall(c - 1, r)) segments.push({ a: [x0, z0], b: [x0, z1], kind: 'wall' });
      if (!isWall(c + 1, r)) segments.push({ a: [x1, z0], b: [x1, z1], kind: 'wall' });
    }
  }

  // One entry per authored pit — a slot stays *one* pit with a chain of centres, so every
  // consumer that assumed "one pit, one circle" (rose, slab holes, the renderer's wells)
  // keeps working. `x, z` is the chain point nearest the board centre, which is what makes
  // the etched rose read the true clearance from a slot without knowing about chains.
  const pitList = pitSpecs.map((pit) => {
    const centers = pit.centers.map(([c, r]) => toWorld(c, r));
    const [x, z] = nearestOnChain(centers, 0, 0);
    return {
      i: pit.i,
      cell: pit.cell,
      x,
      z,
      baseX: x,
      baseZ: z,
      r: pit.r,
      centers,
      slot: centers.length > 1,
      move: pit.move,
      speed: pit.speed,
      period: pit.period,
      phase: pit.phase,
    };
  });

  const [gx, gz] = toWorld(spec.goal[0], spec.goal[1]);
  const spawns = spawnCoords.map(([c, r]) => {
    const [x, z] = toWorld(c, r);
    return { x, z, cell: cover(c, r), at: [c, r] };
  });

  // Materials as rectangles, from the *finished* grid (so a belt painted over ice wins, as the
  // overlay layers have always assumed) plus every authored plate. A region is only built for a
  // material the level actually uses, and only when something asks — see `materials`.
  const rects = { ice: [], sand: [], steel: [] };
  for (const [id, ch] of [
    ['ice', ICE],
    ['sand', SAND],
    ['steel', STEEL],
  ]) {
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (grid[r][c] === ch) rects[id].push([c, r, c + 1, r + 1]);
    for (const p of plates) if (p.mat === id) rects[id].push([p.c0, p.r0, p.c1, p.r1]);
  }

  const level = {
    id: spec.id,
    name: spec.name,
    shape: spec.shape,
    difficulty: spec.difficulty,
    par: spec.par,
    hint: spec.hint,
    spec,
    w,
    h,
    grid,
    segments,
    // `cell` is always the integer grid cell (the engine indexes grids with it); `at` keeps
    // the exact authored coordinate, fractions included. `spawns` is the full list (one entry
    // for a single-marble level); `spawn` stays as the first, so nobody has to know how many
    // marbles a level has to read its starting point.
    spawn: spawns[0],
    spawns,
    goal: { x: gx, z: gz, r: GOAL_R, cell: cover(spec.goal[0], spec.goal[1]), at: [...spec.goal] },
    pits: pitList,
    // Which cells a pit blocks, even where the cell still shows the material it was cut into.
    pitCells,
    // Authored material plates in cell-edge coordinates (empty for a level that paints cells).
    plates,
    // feature lookups used by the physics
    features: {
      belts: (spec.belts ?? []).map((bl) => ({ ...bl, cells: rectCells(bl.rect) })),
      vents: (spec.vents ?? []).map((v) => ({ ...v, cells: rectCells(v.rect) })),
      ramps: (spec.ramps ?? []).map((r) => rampFeature(r, w, h)),
      magnets: (spec.magnets ?? []).map((m) => {
        const [x, z] = toWorld(m.cell[0], m.cell[1]);
        return { ...m, x, z };
      }),
      pads: (spec.teleports ?? []).map((t, i) => {
        const [ax, az] = toWorld(t.a[0], t.a[1]);
        const [bx, bz] = toWorld(t.b[0], t.b[1]);
        return { i, a: { x: ax, z: az }, b: { x: bx, z: bz } };
      }),
      plates: (spec.buttons ?? []).map((b) => {
        const [x, z] = toWorld(b.cell[0], b.cell[1]);
        return {
          ...b,
          x,
          z,
          // `cell` is the integer grid cell the button sits on (what a validator indexes); `at`
          // keeps the exact authored position, fractions included.
          cell: cover(b.cell[0], b.cell[1]),
          at: [...b.cell],
          metal: b.metal ?? DEFAULT_METAL,
          radius: Number.isFinite(b.radius) ? b.radius : BUTTON_R,
        };
      }),
      gates: (spec.gates ?? []).map((g) => ({
        ...g,
        open: false,
        timer: 0,
        segments: [gateSegment(g.seg, w, h)],
      })),
      //  A lift is a wall slab driven by a plate's state, not by a timer. `mode: 'raise'` means
      //  it rests flush with the floor and a marble on its plate lifts it into a wall; `'lower'`
      //  is the other way round, a wall that sinks while its plate is stood on. `height` is the
      //  live 0..1 position the physics and the renderer both read.
      lifts: (spec.lifts ?? []).map((l, i) => {
        const raise = l.mode !== 'lower';
        //  A lift is cut from the metal of the plate it reads, so the wall you raise looks like
        //  the button that raises it. A level that names no metal gets brass, as it always did.
        const plate = (spec.buttons ?? []).find((b) => b.id && b.id === l.plate);
        return {
          ...l,
          i,
          id: l.id ?? `lift${i + 1}`,
          raise,
          height: raise ? 0 : 1,
          solid: (raise ? 0 : 1) >= LIFT_SOLID,
          //  Which way the slab is travelling this tick; the physics sets it, the collider reads
          //  it so a slab on its way up can shove a marble off, and one on its way down cannot.
          rising: false,
          speed: l.speed ?? LIFT_SPEED,
          metal: plate?.metal ?? DEFAULT_METAL,
          segments: [gateSegment(l.seg, w, h)],
        };
      }),
      oneways: (spec.oneways ?? []).map((o) => ({ ...o, segments: [gateSegment(o.seg, w, h)] })),
      pegs: (spec.pegs ?? []).map((p) => ({ ...p, ...discPos(p.cell, w, h) })),
      windmills: (spec.windmills ?? []).map((m) => ({ ...m, ...discPos(m.cell, w, h), angle: 0 })),
      pendulums: (spec.pendulums ?? []).map((p) => ({ ...p, ...discPos(p.cell, w, h), angle: 0 })),
      movers: (spec.movers ?? []).map((m, i) => {
        const from = toWorld(m.from[0], m.from[1]);
        const to = toWorld(m.to[0], m.to[1]);
        return { ...m, i, from, to, t: 0, pos: [...from], vel: [0, 0] };
      }),
    },
  };
  level.goalCells = [level.goal.cell];
  // One region per material the level actually uses: the rectangles plus the lattice they cover.
  level.materials = {};
  for (const [id, list] of Object.entries(rects)) {
    if (list.length) level.materials[id] = makeRegion(w, h, list);
  }
  return level;
}

// ---------------------------------------------------------------------------
//  Cell-space helpers (fractions allowed everywhere a pit or an object sits)
// ---------------------------------------------------------------------------

/** The grid cell a (possibly fractional) cell-space coordinate sits in. */
export function cellIndex(c) {
  return Math.floor(c + 0.5);
}

/** Drop repeated centres, so a slot never carries a zero-length segment. */
export function dedupeChain(centers) {
  const out = [];
  for (const c of centers) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - c[0]) < 1e-9 && Math.abs(last[1] - c[1]) < 1e-9) continue;
    out.push([c[0], c[1]]);
  }
  return out;
}

/** Sample a chain densely enough that point-to-point distance is a fair stand-in. */
export function densifyChain(centers, step = 0.06) {
  if (centers.length < 2) return centers.map((c) => [c[0], c[1]]);
  const out = [[centers[0][0], centers[0][1]]];
  for (let i = 1; i < centers.length; i++) {
    const [x0, z0] = centers[i - 1];
    const [x1, z1] = centers[i];
    const d = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.ceil(d / step));
    for (let k = 1; k <= n; k++) out.push([x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n]);
  }
  return out;
}

function pointSegmentDistance(px, pz, a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / len2)) : 0;
  return Math.hypot(px - (a[0] + dx * t), pz - (a[1] + dz * t));
}

/** Distance from a point to a chain of centres (a single centre is a circle). */
export function chainDistance(centers, px, pz) {
  if (centers.length === 1) return Math.hypot(px - centers[0][0], pz - centers[0][1]);
  let best = Infinity;
  for (let i = 1; i < centers.length; i++) best = Math.min(best, pointSegmentDistance(px, pz, centers[i - 1], centers[i]));
  return best;
}

/** Distance from a cell's square to a chain, in cell space — which cells a pit blocks. */
export function chainCellDistance(centers, c, r) {
  let best = Infinity;
  for (const [x, z] of densifyChain(centers)) {
    const dx = Math.max(Math.abs(x - c) - 0.5, 0);
    const dz = Math.max(Math.abs(z - r) - 0.5, 0);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

/** The point of a chain nearest to (px, pz), for consumers that only understand circles. */
export function nearestOnChain(centers, px, pz) {
  if (centers.length === 1) return [centers[0][0], centers[0][1]];
  let best = null;
  let bestD = Infinity;
  for (const [x, z] of densifyChain(centers)) {
    const d = Math.hypot(x - px, z - pz);
    if (d < bestD) {
      bestD = d;
      best = [x, z];
    }
  }
  return best;
}

/**
 * Distance from a point to a pit, with a moving pit's current offset applied.
 * This is the capture test the physics uses, so a slot catches the marble along its whole
 * length rather than only at its ends.
 */
export function pitDistance(pit, x, z) {
  const centers = pit.centers ?? [[pit.x, pit.z]];
  const ox = pit.baseX === undefined ? 0 : pit.x - pit.baseX;
  const oz = pit.baseZ === undefined ? 0 : pit.z - pit.baseZ;
  return chainDistance(centers, x - ox, z - oz);
}

// Pit radius can be tuned per level; default is the shared constant.
function PIT_R_LEVEL(spec) {
  return spec.pitRadius ?? PIT_CAPTURE_DEFAULT;
}

const PIT_CAPTURE_DEFAULT = PIT_R;

function rectCells([c0, r0, c1, r1]) {
  const cells = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells.push([c, r]);
  return cells;
}

/**
 * A ramp's geometry, straight from its rect and traversal direction.
 *
 * The rect is in cell-EDGE coordinates, the same convention material plates use, so `[5, 1, 9, 3]`
 * covers cells 5..8 by rows 1..2 and an eighth of a cell is a legitimate edge.
 *
 * The wedge runs the whole length of its rect: the ground is lowest at the low edge and rises to
 * `height` at the crest, so `run` is the rect's extent along `dir`. The crest carries a vertical
 * face (`face`), which the physics uses as a one-way step, and `top` is that face's midpoint,
 * which is where the wedge is tallest.
 *
 * `dir` is the direction the marble traverses the ramp - uphill, low edge to crest - and is
 * normalised onto the dominant axis, because a wedge is a straight prism: a ramp is uphill or
 * downhill along one board axis, never diagonally across one. `down` is its opposite, the way
 * the wedge actually pushes the marble.
 *
 * `sin` is the wedge's slope as a sine. It is derived from the wedge's own height over its own
 * run, never authored directly, so the climb the player feels and the wedge they can see can
 * never disagree. It is clamped so that no level, however tall or short, becomes a launcher.
 *
 * `steps` are the stepped parts of the two side walls: the slices whose surface stands taller
 * than a marble may step up (RAMP_STEP_UP of the tall side). On this linear wedge that is the
 * crest half of each side, so the shallow low half of each side is left open to roll on.
 */
function rampFeature(r, w, h) {
  const [c0, r0, c1, r1] = r.rect;
  const raw = r.dir ?? [0, 1];
  const dir =
    Math.abs(raw[0]) >= Math.abs(raw[1]) ? [Math.sign(raw[0]) || 1, 0] : [0, Math.sign(raw[1]) || 1];
  const x0 = c0 - w / 2;
  const x1 = c1 - w / 2;
  const z0 = r0 - h / 2;
  const z1 = r1 - h / 2;
  const height = r.height ?? RAMP_HEIGHT;
  const run = dir[0] !== 0 ? x1 - x0 : z1 - z0;
  const sin = Math.min(RAMP_MAX_SLOPE, height / Math.hypot(height, run));
  //  The crest is the far end along `dir`; the wedge pushes the other way.
  const edge = dir[0] !== 0 ? (dir[0] > 0 ? x1 : x0) : dir[1] > 0 ? z1 : z0;
  const mid = dir[0] !== 0 ? (z0 + z1) / 2 : (x0 + x1) / 2;
  const top = dir[0] !== 0 ? { x: edge, z: mid } : { x: mid, z: edge };
  const face =
    dir[0] !== 0
      ? { x: edge, z: mid, a: [edge, z0], b: [edge, z1] }
      : { x: mid, z: edge, a: [x0, edge], b: [x1, edge] };
  const down = [-dir[0], -dir[1]];
  //  The stepped slice of each side wall: half-way cross-section (surface `half`) to the crest
  //  (surface `height`). `ha`/`hb` are those two surface heights, so the physics can tell whether
  //  a marble outside the wall is low enough to be stopped by it or high enough to clear it.
  const half = height * RAMP_STEP_UP;
  const mid2x = (x0 + x1) / 2;
  const mid2z = (z0 + z1) / 2;
  const steps = [];
  if (dir[0] !== 0) {
    for (const [ze, n] of [[z0, [0, -1]], [z1, [0, 1]]]) {
      steps.push({ a: [mid2x, ze], b: [edge, ze], ha: half, hb: height, n });
    }
  } else {
    for (const [xe, n] of [[x0, [-1, 0]], [x1, [1, 0]]]) {
      steps.push({ a: [xe, mid2z], b: [xe, edge], ha: half, hb: height, n });
    }
  }
  return { rect: [c0, r0, c1, r1], dir, down, height, run, sin, x0, x1, z0, z1, top, face, steps };
}

function discPos([c, r], w, h) {
  const x = c + 0.5 - w / 2;
  const z = r + 0.5 - h / 2;
  return { x, z };
}

function gateSegment(seg, w, h) {
  const a = [seg[0][0] + 0.5 - w / 2, seg[0][1] + 0.5 - h / 2];
  const b = [seg[1][0] + 0.5 - w / 2, seg[1][1] + 0.5 - h / 2];
  return { a, b, kind: 'gate' };
}

export function builtLevels() {
  return LEVELS.map(buildLevel);
}
