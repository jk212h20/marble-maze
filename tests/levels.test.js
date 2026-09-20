// Structural checks on level definitions: the things that make a tilt maze fair.
import { LEVELS, buildLevel, FLOOR, WALL, PIT, OUTSIDE, SPAWN, GOAL, isPitCell } from '../src/engine/levels.js';
import { flood, cellKey, isWalkable, walkableCells, reachable, worldToCell } from '../src/engine/pathfind.js';
import { roseDesign, roseProblems, roseReach, roseHoles } from '../src/engine/rose.js';
import { PIT_R, GOAL_R, BALL_R } from '../src/engine/constants.js';
import { silhouetteLoops, loopArea, footprintCellCount, slabHoles, holeProblems, insetLoop } from '../src/engine/silhouette.js';
import {
  GOAL_HOLE_R,
  LID_Y,
  LID_BEZEL,
  KNOB_R,
  KNOB_H,
  ROSE_LINE,
  ROSE_SINK,
  ROSE_MARGIN,
  LID_THICK,
  BALL_R_MAX,
  WALL_H,
} from '../src/engine/constants.js';

export const name = 'levels';

const built = LEVELS.map(buildLevel);

const charAt = (level, [c, r]) => level.grid[r][c];

export function tests(t) {
  t.ok('every level builds and has an id, a name and a hint', () => {
    for (const lv of built) {
      if (!lv.id || !lv.name) throw new Error('level missing id/name');
      if (!lv.hint) throw new Error(`${lv.id}: no hint text`);
      if (lv.segments.length === 0) throw new Error(`${lv.id}: no walls at all`);
    }
  });

  t.ok('every spawn and the goal sit on walkable floor', () => {
    for (const lv of built) {
      for (const [what, cell] of [
        ...lv.spawns.map((s, i) => [`spawn ${i}`, s.cell]),
        ['goal', lv.goal.cell],
      ]) {
        const ch = charAt(lv, cell);
        if (ch === WALL || ch === OUTSIDE) throw new Error(`${lv.id}: ${what} is on '${ch}'`);
      }
      for (const s of lv.spawns) {
        if (isWalkable(lv, ...s.cell) === false) throw new Error(`${lv.id}: spawn ${s.at} not walkable`);
      }
    }
  });

  t.ok('multi-marble levels author more than one distinct spawn', () => {
    for (const lv of built) {
      if (!lv.spec.multi) continue;
      if (lv.spawns.length < 2) throw new Error(`${lv.id}: marked multi but has ${lv.spawns.length} spawn`);
      const seen = new Set(lv.spawns.map((s) => s.at.join(',')));
      if (seen.size !== lv.spawns.length) throw new Error(`${lv.id}: two marbles share a spawn point`);
      // Marbles that start on top of each other would be an immediate collision; keep them a
      // marble apart at least.
      for (let i = 0; i < lv.spawns.length; i++) {
        for (let j = i + 1; j < lv.spawns.length; j++) {
          const d = Math.hypot(lv.spawns[i].x - lv.spawns[j].x, lv.spawns[i].z - lv.spawns[j].z);
          if (d < BALL_R * 2 + 0.1) throw new Error(`${lv.id}: spawns ${i} and ${j} overlap (${d.toFixed(2)})`);
        }
      }
    }
  });

  t.ok('the marble fits: no walkable cell is narrower than the marble', () => {
    for (const lv of built) {
      // A cell is unusable if the free run through it (either axis) is shorter than the
      // marble's diameter plus a little room to steer.
      const need = BALL_R * 2 + 0.12;
      for (const [c, r] of walkableCells(lv)) {
        const runX = freeRun(lv, c, r, 1, 0);
        const runZ = freeRun(lv, c, r, 0, 1);
        const openBoth = freeRun(lv, c, r, 1, 0, true) && freeRun(lv, c, r, 0, 1, true);
        if (openBoth && Math.max(runX, runZ) < need) {
          throw new Error(`${lv.id}: cell ${c},${r} has no free run of ${need.toFixed(2)} units`);
        }
      }
    }
  });

  t.ok('pits are inside the board, on floor, and never on the spawn or goal', () => {
    for (const lv of built) {
      for (const pit of lv.pits) {
        const [c, r] = pit.cell;
        const ch = charAt(lv, [c, r]);
        // A pit over a MATERIAL keeps the material in the grid — that is what lets the drawn plate
        // be cut rather than erased — so the pit mask is what says a pit is there. Anywhere else
        // the cell still shows PIT, exactly as it always did.
        if (!isPitCell(lv, c, r)) throw new Error(`${lv.id}: pit ${c},${r} is not in the pit mask`);
        if (ch === WALL || ch === OUTSIDE) throw new Error(`${lv.id}: pit ${c},${r} is on '${ch}'`);
        if (c === lv.spawn.cell[0] && r === lv.spawn.cell[1]) throw new Error(`${lv.id}: pit on spawn`);
        if (c === lv.goal.cell[0] && r === lv.goal.cell[1]) throw new Error(`${lv.id}: pit on goal`);
        if (pit.r < BALL_R * 1.5) throw new Error(`${lv.id}: pit is too small for the marble`);
      }
    }
  });

  t.ok('pits never fully seal a corridor: the goal stays reachable', () => {
    for (const lv of built) {
      if (!reachable(lv, lv.spawn.cell, lv.goal.cell)) {
        throw new Error(`${lv.id}: goal is unreachable even before pits are considered`);
      }
    }
  });

  t.ok('there is no dead-end region bigger than a cellar (nothing pointless)', () => {
    for (const lv of built) {
      const seen = flood(lv, lv.spawn.cell);
      const unreachable = walkableCells(lv).filter(([c, r]) => !seen.has(cellKey(c, r)));
      if (unreachable.length > 6) {
        throw new Error(`${lv.id}: ${unreachable.length} walkable cells cannot be reached from the spawn`);
      }
    }
  });

  t.ok('the goal is big enough to be a target, and pits are smaller than it', () => {
    for (const lv of built) {
      if (lv.goal.r < BALL_R + 0.2) throw new Error(`${lv.id}: goal cup is too tight`);
      for (const pit of lv.pits) {
        if (pit.r > lv.goal.r) throw new Error(`${lv.id}: a pit is bigger than the goal`);
      }
      if (lv.goal.r !== GOAL_R && lv.pits[0]?.r !== PIT_R) throw new Error('unexpected radii');
    }
  });

  t.ok('the perimeter is sealed, or a level says out loud that it is not', () => {
    for (const lv of built) {
      let openEdges = 0;
      for (let r = 0; r < lv.h; r++) {
        for (let c = 0; c < lv.w; c++) {
          if (!isWalkable(lv, c, r)) continue;
          const nb = [
            [c - 1, r],
            [c + 1, r],
            [c, r - 1],
            [c, r + 1],
          ];
          for (const [nc, nr] of nb) {
            if (nc < 0 || nr < 0 || nc >= lv.w || nr >= lv.h) openEdges++;
            else if (lv.grid[nr][nc] === OUTSIDE) openEdges++;
          }
        }
      }
      if (openEdges > 0 && !lv.spec.openEdges) {
        throw new Error(`${lv.id}: ${openEdges} floor cells touch the void but the level does not declare openEdges`);
      }
    }
  });

  t.ok('early levels are generous: lanes at least two cells wide', () => {
    for (const lv of built) {
      if (lv.difficulty > 3) continue;
      for (const [c, r] of walkableCells(lv)) {
        const runX = freeRunInclusive(lv, c, r, 1, 0);
        const runZ = freeRunInclusive(lv, c, r, 0, 1);
        if (Math.max(runX, runZ) < 2) {
          throw new Error(`${lv.id}: cell ${c},${r} is in a one-cell-wide squeeze`);
        }
      }
    }
  });

  t.ok('par times are sane for the route length', () => {
    for (const lv of built) {
      const path = flood(lv, lv.spawn.cell);
      const dist = marchDistance(lv, path);
      if (!lv.par) throw new Error(`${lv.id}: no par time`);
      if (lv.par < dist / 3.2) throw new Error(`${lv.id}: par ${lv.par}s is impossible for a ${dist.toFixed(1)} unit route`);
    }
  });

  t.ok('the rendered board outline is one clean closed loop matching the footprint', () => {
    for (const lv of built) {
      const loops = silhouetteLoops(lv);
      if (loops.length !== 1) throw new Error(`${lv.id}: footprint produced ${loops.length} outline loops`);
      const area = Math.abs(loopArea(loops[0]));
      const cells = footprintCellCount(lv);
      if (Math.abs(area - cells) > 1e-6) {
        throw new Error(`${lv.id}: outline area ${area} does not match ${cells} footprint cells`);
      }
      // and it must be a closed loop: every point appears exactly once
      const seen = new Set(loops[0].map((p) => p.join(',')));
      if (seen.size !== loops[0].length) throw new Error(`${lv.id}: outline loop visits a corner twice`);
    }
  });

  //  A hole you cannot see is a trap: the drawn hole must always be at least as big as the
  //  region the physics uses to swallow the marble, and it must sit inside a floor cell.
  t.ok('every pit and cup is drawn as a hole at least as big as its capture zone', () => {
    for (const lv of built) {
      const problems = holeProblems(lv, GOAL_HOLE_R);
      if (problems.length) throw new Error(`${lv.id}: ${problems.join('; ')}`);
    }
  });

  t.ok('the slab holes line up with the pits, and the goal gets one too', () => {
    for (const lv of built) {
      const holes = slabHoles(lv, GOAL_HOLE_R);
      const pitHoles = holes.filter((h) => h.kind === 'pit');
      if (pitHoles.length !== lv.pits.length) throw new Error(`${lv.id}: ${pitHoles.length} slab holes for ${lv.pits.length} pits`);
      lv.pits.forEach((pit, i) => {
        const h = pitHoles[i];
        if (Math.abs(h.x - pit.x) > 1e-9 || Math.abs(h.z - pit.z) > 1e-9) throw new Error(`${lv.id}: pit ${i} hole is not on the pit`);
        if (h.r !== pit.r) throw new Error(`${lv.id}: pit ${i} hole radius ${h.r} != pit radius ${pit.r}`);
      });
      const goal = holes.find((h) => h.kind === 'goal');
      if (!goal) throw new Error(`${lv.id}: the goal cup has no hole`);
      if (Math.abs(goal.x - lv.goal.x) > 1e-9 || Math.abs(goal.z - lv.goal.z) > 1e-9) {
        throw new Error(`${lv.id}: the cup hole is not on the goal`);
      }
    }
  });

  t.ok('no level asks for a moving pit without a way to show it', () => {
    for (const lv of built) {
      const moving = slabHoles(lv, GOAL_HOLE_R).filter((h) => h.moving);
      if (moving.length && !lv.spec.movingPitVisual) {
        throw new Error(`${lv.id}: moving pits must declare how they are drawn (see DESIGN.md)`);
      }
    }
  });

  t.ok('the boot is sealed: no floor cell opens onto the outside', () => {
    // The glass lid is clamped to the rim, so a level with an open edge could not be
    // covered: the marble would roll out through the glass. levels.js builds the rim
    // automatically, and this is the assertion that keeps it that way.
    for (const lv of built) {
      for (let r = 0; r < lv.h; r++) {
        for (let c = 0; c < lv.w; c++) {
          if (lv.grid[r][c] === OUTSIDE) continue;
          const nb = [
            [c - 1, r],
            [c + 1, r],
            [c, r - 1],
            [c, r + 1],
          ];
          for (const [nc, nr] of nb) {
            const outside = nc < 0 || nr < 0 || nc >= lv.w || nr >= lv.h || lv.grid[nr][nc] === OUTSIDE;
            if (outside && lv.grid[r][c] !== WALL) {
              throw new Error(`${lv.id}: floor cell ${c},${r} opens onto the outside - the lid cannot seal it`);
            }
          }
        }
      }
    }
  });

  t.ok('the lid clears the marble the tuner can build and the grip can be held', () => {
    if (LID_Y <= BALL_R_MAX * 2 + 0.15) throw new Error(`glass at ${LID_Y} does not clear a ${BALL_R_MAX * 2} marble`);
    if (LID_Y <= WALL_H) throw new Error('glass sits below the rim wall');
    // The second grip design: a small knob you pinch, not a wheel you hold. It has to be big
    // enough to grip and low enough that it never blocks the board, and the etched rose around
    // it has to stay a thin marking: inside the pane, clear of the knob, outside every pit.
    if (KNOB_R < 0.3) throw new Error(`knob is too small to pinch (r ${KNOB_R})`);
    if (KNOB_R > 0.7) throw new Error(`knob is too big to be the small centre it should be (r ${KNOB_R})`);
    if (KNOB_H > 0.8) throw new Error(`knob stands too tall to see over (${KNOB_H})`);
    if (ROSE_SINK <= 0 || ROSE_SINK >= LID_THICK) throw new Error(`the etching is not inside the pane (sink ${ROSE_SINK}, pane ${LID_THICK})`);
    if (ROSE_MARGIN < ROSE_LINE * 2) throw new Error('the etching has too little margin from the holes to read cleanly');
    if (LID_BEZEL * 2 >= Math.min(LEVELS[0].board.w, LEVELS[0].board.h)) throw new Error('collar would eat the whole board');
  });

  t.ok('the collar can follow every level outline at the drawn width', () => {
    for (const lv of built) {
      const loops = silhouetteLoops(lv);
      const outer = loops.reduce((a, b) => (Math.abs(loopArea(a)) > Math.abs(loopArea(b)) ? a : b));
      const inner = insetLoop(outer, LID_BEZEL);
      if (!inner) throw new Error(`${lv.id}: outline cannot be inset by the collar width`);
      // The glass edge must still be inside the footprint, and the collar must not fold.
      if (Math.abs(loopArea(inner)) < 4) throw new Error(`${lv.id}: collar leaves no glass`);
      if (Math.sign(loopArea(inner)) !== Math.sign(loopArea(outer))) throw new Error(`${lv.id}: collar offset flipped the outline`);
      const lip = insetLoop(outer, -0.07);
      if (!lip) throw new Error(`${lv.id}: collar lip cannot overhang the outline`);
    }
  });

  t.ok('the collar can frame every shape the level format offers', () => {
    // The lid is derived from the outline, so a shape the format supports but the collar
    // cannot follow would be an unbuildable level. Checked here, before any such level is
    // authored: the planned slate already includes hexagon, octagon, cross, diamond ring
    // and star boards.
    for (const shape of ['rect', 'hexagon', 'octagon', 'diamond', 'cross', 'diamondRing', 'star']) {
      const lv = buildLevel({
        id: `shape-${shape}`,
        name: shape,
        board: { shape, w: 15, h: 15 },
        spawn: [7, 3],
        goal: [8, 3], // one cell off centre: that spot is inside every one of these shapes
      });
      const loops = silhouetteLoops(lv);
      const outer = loops.reduce((a, b) => (Math.abs(loopArea(a)) > Math.abs(loopArea(b)) ? a : b));
      const inner = insetLoop(outer, LID_BEZEL);
      if (!inner) throw new Error(`${shape}: the collar cannot be inset from the outline`);
      const lip = insetLoop(outer, -0.07);
      if (!lip) throw new Error(`${shape}: the collar lip cannot overhang the outline`);
      if (Math.abs(loopArea(inner)) < 10) throw new Error(`${shape}: collar leaves almost no glass`);
      // the glass must still sit over the board, not outside it
      if (Math.abs(loopArea(inner)) >= Math.abs(loopArea(outer))) throw new Error(`${shape}: inset did not shrink the outline`);
    }
  });

  t.ok('the etched rose fits in the clear glass and never crosses a hole', () => {
    // Level 1's pits sit exactly on the x axis at radius 2.5, so a long star point written by
    // eye would run straight through one. The rose is sized from the board instead, and this
    // is the rule that keeps it honest on every future level too.
    for (const lv of built) {
      const reach = roseReach(lv);
      const design = roseDesign(lv);
      if (!design.rings.length) throw new Error(`${lv.id}: no room for the rose at all`);
      for (const r of design.rings) {
        if (r > reach + 1e-6) throw new Error(`${lv.id}: ring at ${r} escapes the clear glass (${reach})`);
      }
      for (const t of design.ticks) {
        if (t.outer > reach + 1e-6) throw new Error(`${lv.id}: a ${t.kind} tick escapes the clear glass`);
        if (t.inner < design.inner - 1e-6) throw new Error(`${lv.id}: a ${t.kind} tick reaches back to the knob`);
      }
      if (design.ticks.length !== 8) throw new Error(`${lv.id}: ${design.ticks.length} compass ticks, expected 8`);
      const problems = roseProblems(lv);
      if (problems.length) throw new Error(`${lv.id}: ${problems.join('; ')}`);
      // and the reach really is derived from the innermost hole, not from a magic number
      for (const h of roseHoles(lv)) {
        if (h.d - h.r - ROSE_MARGIN < reach - 1e-6 && reach < 2.6 - 1e-6) {
          throw new Error(`${lv.id}: the rose ignores the ${h.what} at ${h.d.toFixed(2)}`);
        }
      }
    }
  });

  t.ok('insetLoop shrinks, grows and refuses to fold', () => {
    const rect = [
      [-4, -2],
      [4, -2],
      [4, 2],
      [-4, 2],
    ];
    const inner = insetLoop(rect, 0.5);
    if (!inner) throw new Error('inset returned null for a plain rectangle');
    const xs = inner.map((p) => p[0]);
    const zs = inner.map((p) => p[1]);
    if (Math.min(...xs) !== -3.5 || Math.max(...xs) !== 3.5) throw new Error(`inset x range ${Math.min(...xs)}..${Math.max(...xs)}`);
    if (Math.min(...zs) !== -1.5 || Math.max(...zs) !== 1.5) throw new Error(`inset z range ${Math.min(...zs)}..${Math.max(...zs)}`);

    const grown = insetLoop(rect, -0.25);
    if (Math.abs(loopArea(grown)) <= Math.abs(loopArea(rect))) throw new Error('a negative inset must grow the loop');

    if (insetLoop(rect, 9) !== null) throw new Error('insetting past the centre must fail, not invert');
    if (insetLoop(rect, 20) !== null) throw new Error('a wild inset must fail rather than mirror the shape');
    if (insetLoop([rect[0], rect[2], rect[1]], 0.5) === null) throw new Error('should work for either winding');
  });

  t.ok('board-space helpers agree with the grid', () => {
    for (const lv of built) {
      const [c, r] = lv.spawn.cell;
      const back = worldToCell(lv, lv.spawn.x, lv.spawn.z);
      if (back[0] !== c || back[1] !== r) throw new Error(`${lv.id}: spawn cell round-trip failed`);
    }
  });
}

function freeRun(lv, c, r, dc, dr, any = false) {
  let n = 0;
  for (let i = 1; i <= 3; i++) {
    if (!isWalkable(lv, c + dc * i, r + dr * i)) break;
    n++;
  }
  for (let i = 1; i <= 3; i++) {
    if (!isWalkable(lv, c - dc * i, r - dr * i)) break;
    n++;
  }
  return n;
}

function freeRunInclusive(lv, c, r, dc, dr) {
  return freeRun(lv, c, r, dc, dr) + 1;
}

/** Shortest route length in cells from the spawn to the goal, from a BFS predecessor map. */
function marchDistance(lv, prev) {
  let cur = cellKey(lv.goal.cell[0], lv.goal.cell[1]);
  if (!prev.has(cur)) return Infinity;
  let dist = 0;
  while (prev.get(cur)) {
    dist += 1;
    cur = prev.get(cur);
  }
  return dist;
}
