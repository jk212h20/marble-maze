//  Level editor — draft validation.
//
//  These checks mirror the rules the headless suite enforces (`tests/levels.test.js`) and
//  call the *same* engine primitives the suite calls, so the editor cannot drift into
//  accepting a level the suite would reject. Each result names the rule it reproduces.
//
//  Errors are things `tests/levels.test.js` fails on. Warnings are authored-data smells the
//  editor adds because it knows the draft's intent — e.g. a pit painted over a wall cell,
//  which `buildLevel` would silently turn into a hole through that wall.

import { buildLevel, FLOOR, WALL, OUTSIDE, PIT, isPitCell } from '../../src/engine/levels.js';
import { isWalkable, walkableCells, reachable, flood, cellKey, cellPath } from '../../src/engine/pathfind.js';
import {
  silhouetteLoops,
  loopArea,
  footprintCellCount,
  slabHoles,
  holeProblems,
  insetLoop,
} from '../../src/engine/silhouette.js';
import { roseDesign, roseReach, roseProblems, roseHoles } from '../../src/engine/rose.js';
import { BALL_R, GOAL_HOLE_R, LID_BEZEL } from '../../src/engine/constants.js';
import { chainCellDistance } from '../../src/engine/levels.js';
import { charAt, draftToSpec, chainDistance, isSlot, pointInPlate, spawnsOf, MIN_SPAWN_GAP } from './model.js';
import { METALS } from '../../src/engine/metals.js';
import { TUNING } from '../../src/engine/tuning.js';

const METAL_IDS = new Set(METALS.map((m) => m.id));

/** The grid cell a fractional cell-space coordinate sits in. */
const cover = ([c, r]) => [Math.floor(c + 0.5), Math.floor(r + 0.5)];
const at2 = ([c, r]) => `${Number(c.toFixed(3))}, ${Number(r.toFixed(3))}`;

const error = (name, message) => ({ level: 'error', name, message });
const warn = (name, message) => ({ level: 'warning', name, message });

/** Same free-run measure as tests/levels.test.js: walkable cells either side within 3. */
function freeRun(lv, c, r, dc, dr) {
  let n = 0;
  for (let i = 1; i <= 3; i++) if (isWalkable(lv, c + dc * i, r + dr * i)) n++;
  for (let i = 1; i <= 3; i++) if (isWalkable(lv, c - dc * i, r - dr * i)) n++;
  return n;
}

const list = (cells, n = 6) => cells.slice(0, n).map((x) => (Array.isArray(x) ? x.join(',') : x)).join('; ') + (cells.length > n ? '…' : '');

export function validateDraft(draft) {
  const spec = draftToSpec(draft);
  const results = [];
  const fail = (name, message) => results.push(error(name, message));
  const soft = (name, message) => results.push(warn(name, message));
  const pass = (name, message = '') => results.push({ level: 'ok', name, message });
  const spawns = spawnsOf(draft);

  // --- authored-data smells the engine would silently paper over ---------------
  const plainFloor = (name, points) => {
    const bad = points.map(cover).filter(([c, r]) => charAt(draft, c, r) !== FLOOR);
    if (bad.length) {
      soft(name, `${bad.length} cell(s) are not plain floor (${list(bad.map(([c, r]) => `${c},${r}='${charAt(draft, c, r)}'`))}) — buildLevel will overwrite them`);
    } else pass(name);
  };
  plainFloor('each spawn cell is plain floor', spawns);
  plainFloor('the goal cell is plain floor', [draft.goal]);

  // Every marble needs its own starting point, at least a marble apart from the others — this
  // mirrors the engine suite's multi-marble rule so a draft cannot build a run with two marbles
  // stacked on one cell.
  if (spawns.length > 1) {
    const clash = [];
    for (let i = 0; i < spawns.length; i++) {
      for (let j = i + 1; j < spawns.length; j++) {
        const d = Math.hypot(spawns[i][0] - spawns[j][0], spawns[i][1] - spawns[j][1]);
        if (d < MIN_SPAWN_GAP) clash.push(`marble ${i + 1} and marble ${j + 1} are ${d.toFixed(2)} apart (need ${MIN_SPAWN_GAP.toFixed(2)})`);
      }
    }
    if (clash.length) fail('the marbles start a marble apart, on distinct cells', clash.join('; '));
    else pass('the marbles start a marble apart, on distinct cells', `${spawns.length} marbles`);
  }

  // A pit may be authored anywhere now, so "is a pit on a spawn" is a distance question.
  const underThings = [];
  for (const pit of draft.pits) {
    spawns.forEach((s, i) => {
      if (chainDistance(pit.centers, s[0], s[1]) <= pit.r) underThings.push(`marble ${i + 1} (${at2(s)})`);
    });
    if (chainDistance(pit.centers, draft.goal[0], draft.goal[1]) <= pit.r) underThings.push(`the goal (${at2(draft.goal)})`);
  }
  if (underThings.length) soft('no pit under a spawn or the goal', `a pit reaches ${underThings.join(' and ')}`);
  else pass('no pit under a spawn or the goal');

  // An obstacle standing inside a hole is almost always a slip, and the engine would stack
  // the two without comment.
  const crowded = [];
  for (const pit of draft.pits) {
    for (const [listName, what] of [['pegs', 'a peg'], ['magnets', 'a magnet'], ['windmills', 'a windmill'], ['pendulums', 'a pendulum']]) {
      for (const o of draft[listName] ?? []) {
        if (chainDistance(pit.centers, o.cell[0], o.cell[1]) <= pit.r + 0.05) crowded.push(`${what} at ${at2(o.cell)}`);
      }
    }
  }
  if (crowded.length) soft('no obstacle stands inside a pit', crowded.join('; '));
  else pass('no obstacle stands inside a pit');

  // A pit that reaches a wall cell opens a gap in that wall (the engine builds wall segments
  // from the grid, and a pit cell is no longer wall). Sometimes intended, so: say so.
  const punched = [];
  for (const pit of draft.pits) {
    for (let r = 0; r < draft.board.h; r++) {
      for (let c = 0; c < draft.board.w; c++) {
        if (charAt(draft, c, r) !== WALL) continue;
        if (chainCellDistance(pit.centers, c, r) <= pit.r) punched.push(`${c},${r}`);
      }
    }
  }
  if (punched.length) soft('no pit opens a gap in a wall', `${punched.length} wall cell(s) are covered by a pit: ${list(punched)} — the marble can roll through there`);
  else pass('no pit opens a gap in a wall');

  // --- material plates -------------------------------------------------------
  // A plate is authored on cell edges, so its own rules are about edges: on the board, off the
  // walls, and with some area. A plate over a pit is fine and expected — that is what cutting a
  // hole into ice means.
  const plateProblems = [];
  for (const p of draft.plates ?? []) {
    const where = `${p.mat} plate at ${p.c0}, ${p.r0} → ${p.c1}, ${p.r1}`;
    if (!(p.c1 > p.c0) || !(p.r1 > p.r0)) plateProblems.push(`${where} has no area`);
    else if (p.c0 < 0 || p.r0 < 0 || p.c1 > draft.board.w || p.r1 > draft.board.h) plateProblems.push(`${where} reaches outside the board`);
    else {
      const onWall = [];
      for (let r = Math.floor(p.r0); r < Math.ceil(p.r1); r++) {
        for (let c = Math.floor(p.c0); c < Math.ceil(p.c1); c++) {
          const ch = charAt(draft, c, r);
          if (ch === WALL) onWall.push(`${c},${r}`);
          else if (ch === OUTSIDE) onWall.push(`${c},${r} (outside the board shape)`);
        }
      }
      if (onWall.length) plateProblems.push(`${where} overlaps ${list(onWall)} — a plate cannot lie over a wall or float off the shape`);
    }
  }
  if (plateProblems.length) fail('every material plate is on the board, off the walls, and has some area', plateProblems.join('; '));
  else pass('every material plate is on the board, off the walls, and has some area');

  // --- ramps ---------------------------------------------------------------
  //  A ramp is a one-way hill, and three authored-data smells follow from that. They are all
  //  warnings: each is a ramp that still builds and still works as *something*, just not as the
  //  slope the author was drawing.
  const rampProblems = [];
  for (const p of (draft.plates ?? []).filter((q) => q.mat === 'ramp')) {
    const dir = p.dir ?? [0, 1];
    const where = `ramp ${p.c0}, ${p.r0} → ${p.c1}, ${p.r1}`;
    const cols = [];
    for (let c = Math.floor(p.c0); c < Math.ceil(p.c1); c++) cols.push(c);
    const rows = [];
    for (let r = Math.floor(p.r0); r < Math.ceil(p.r1); r++) rows.push(r);

    //  `dir` is the traversal direction, so the crest is the far end along it. That edge is a
    //  step, so whatever sits just beyond it is where the marble arrives after cresting. A wall
    //  there means the ramp is a dead end: climb it and you hit the wall.
    const beyond = [];
    if (dir[0] !== 0) {
      const c = dir[0] > 0 ? Math.floor(p.c1 + 0.5) : Math.floor(p.c0 - 0.5);
      for (const r of rows) beyond.push([c, r]);
    } else {
      const r = dir[1] > 0 ? Math.floor(p.r1 + 0.5) : Math.floor(p.r0 - 0.5);
      for (const c of cols) beyond.push([c, r]);
    }
    const blocked = beyond.filter(([c, r]) => c < 0 || r < 0 || c >= draft.board.w || r >= draft.board.h || charAt(draft, c, r) !== FLOOR);
    if (blocked.length) {
      rampProblems.push(`${where}: its tall edge backs onto ${blocked.length === beyond.length ? 'a wall or the board edge' : 'a wall'} — the marble crests straight into it`);
    }

    //  A hole inside the wedge swallows the marble before the slope has done anything.
    const holed = draft.pits.filter((pit) =>
      pit.centers.some(([c, r]) => pointInPlate(p, c + 0.5, r + 0.5)),
    );
    if (holed.length) rampProblems.push(`${where} has ${holed.length} pit(s) inside it`);

    //  A belt or fan under a ramp pushes as well, so the marble gets two forces and a surface
    //  that does not match what the wedge looks like.
    const driven = [];
    for (const c of cols) for (const r of rows) {
      const ch = charAt(draft, c, r);
      if (ch === 'c' || ch === 'v') driven.push(`${c},${r}`);
    }
    if (driven.length) rampProblems.push(`${where} sits over a belt or fan at ${list(driven)}`);
  }
  if (rampProblems.length) soft('each ramp is a slope with somewhere to arrive', rampProblems.join('; '));
  else pass('every ramp is a slope with somewhere to arrive');

  // A pit cut into a plate is what we want. A pit that pokes OUT of a plate is drawn with a fine
  // stepped edge instead of the hole's true arc, because a path crossing the plate's outline is a
  // notch rather than a hole. It still never leaves material lying over the hole — but say so.
  const ragged = [];
  for (const p of draft.plates ?? []) {
    for (const pit of draft.pits) {
      const [c, r] = pit.centers[0];
      const over = pointInPlate(p, c + 0.5, r + 0.5);
      if (!over) continue;
      const edge = pit.centers.some(([pc, pr]) => {
        const ec = pc + 0.5;
        const er = pr + 0.5;
        return ec - pit.r < p.c0 - 1e-9 || ec + pit.r > p.c1 + 1e-9 || er - pit.r < p.r0 - 1e-9 || er + pit.r > p.r1 + 1e-9;
      });
      if (edge) ragged.push(`pit at ${at2(pit.centers[0])} pokes out of the ${p.mat} plate`);
    }
  }
  if (ragged.length) soft('a pit cut into a plate sits wholly inside it', `${ragged.join('; ')} — the plate's edge is drawn stepped there rather than as the hole's arc`);
  else pass('a pit cut into a plate sits wholly inside it');

  if (draft.pits.some((p) => p.move) && !spec.movingPitVisual) {
    soft('moving pits declare how they are drawn', 'tick "moving pit visual" in the level panel — the suite requires movingPitVisual');
  }

  // Slots have to reach the slab as *one* hole each, chain and all, or the board would be
  // cut as a row of circles that no longer line up with what the marble falls into.

  // --- build (fail closed) ---------------------------------------------------
  let lv;
  try {
    lv = buildLevel(spec);
    pass('the level builds against buildLevel()');
  } catch (err) {
    fail('the level builds against buildLevel()', err.message);
    return { spec, level: null, results };
  }

  // --- spawn / goal / walls ---------------------------------------------------
  const checkFloor = (what, cell) => {
    const ch = lv.grid[cell[1]]?.[cell[0]];
    if (ch === WALL || ch === OUTSIDE) fail(`${what} sits on walkable floor`, `cell is '${ch}'`);
    else if (!isWalkable(lv, cell[0], cell[1])) fail(`${what} sits on walkable floor`, 'cell is not walkable');
    else pass(`${what} sits on walkable floor`);
  };
  // Every marble must start on a cell it can roll off. The engine marks each authored spawn on
  // its covering grid cell, so this is the same check the suite runs, once per marble.
  const spawnFloor = [];
  lv.spawns.forEach((s, i) => {
    const ch = lv.grid[s.cell[1]]?.[s.cell[0]];
    if (ch === WALL || ch === OUTSIDE) spawnFloor.push(`marble ${i + 1} is on '${ch}'`);
    else if (!isWalkable(lv, s.cell[0], s.cell[1])) spawnFloor.push(`marble ${i + 1} is not walkable`);
  });
  if (spawnFloor.length) fail('every marble starts on walkable floor', spawnFloor.join('; '));
  else pass('every marble starts on walkable floor', lv.spawns.length > 1 ? `${lv.spawns.length} marbles` : '');
  checkFloor('goal', lv.goal.cell);

  if (lv.segments.length === 0) fail('the board has walls at all', 'no collision segments — the marble would roll straight off');
  else pass('the board has walls at all');

  // The marble fits every walkable cell (mirrors "the marble fits").
  const need = BALL_R * 2 + 0.12;
  const tight = [];
  for (const [c, r] of walkableCells(lv)) {
    const openish = isWalkable(lv, c + 1, r) || isWalkable(lv, c - 1, r) || isWalkable(lv, c, r + 1) || isWalkable(lv, c, r - 1);
    if (!openish) continue;
    if (Math.max(freeRun(lv, c, r, 1, 0), freeRun(lv, c, r, 0, 1)) < need) tight.push([c, r]);
  }
  if (tight.length) fail('the marble fits every walkable cell', `${tight.length} cell(s) with no free run of ${need.toFixed(2)}: ${list(tight)}`);
  else pass('the marble fits every walkable cell');

  // Pits land on the floor, off the spawn and goal, and fit the marble.
  const pitProblems = [];
  for (const pit of lv.pits) {
    const [c, r] = pit.cell;
    const ch = lv.grid[r]?.[c];
    // A pit over a material KEEPS the material in the grid (so the hole can be cut out of the
    // drawn plate), so the pit mask — not the character — says whether the cell is a pit.
    if (!isPitCell(lv, c, r)) pitProblems.push(`pit at ${pit.cell} is on '${ch}'`);
    else if (ch === WALL || ch === OUTSIDE) pitProblems.push(`pit at ${pit.cell} is on '${ch}'`);
    if (lv.spawns.some((s) => s.cell[0] === c && s.cell[1] === r)) pitProblems.push(`pit at ${pit.cell} is on a spawn`);
    else if (c === lv.goal.cell[0] && r === lv.goal.cell[1]) pitProblems.push(`pit at ${pit.cell} is on the goal`);
    if (pit.r < BALL_R * 1.5) pitProblems.push(`pit at ${pit.cell} is too small (${pit.r})`);
  }
  if (pitProblems.length) fail('pits are on floor, off the spawn and goal, and big enough', pitProblems.join('; '));
  else pass('pits are on floor, off the spawn and goal, and big enough');

  // Reachability, and no pointless unreachable region. Every marble must have a route home —
  // on a multi-marble board it is not enough that the first one can reach the cup.
  const stranded = lv.spawns.filter((s) => !reachable(lv, s.cell, lv.goal.cell));
  if (stranded.length) {
    fail('the goal is reachable from every marble', `${stranded.length} marble(s) with no route at all: ${list(stranded.map((s) => `spawn ${at2(s.at)}`))}`);
  } else {
    pass('the goal is reachable from every marble', lv.spawns.length > 1 ? `${lv.spawns.length} marbles` : '');
    const seen = flood(lv, lv.spawn.cell);
    const orphan = walkableCells(lv).filter(([c, r]) => !seen.has(cellKey(c, r)));
    if (orphan.length > 6) fail('no dead-end region bigger than a cellar', `${orphan.length} walkable cells cannot be reached from the spawn: ${list(orphan)}`);
    else pass('no dead-end region bigger than a cellar', orphan.length ? `${orphan.length} orphan cell(s)` : '');
  }

  // Cup size vs pits.
  const cupProblems = [];
  if (lv.goal.r < BALL_R + 0.2) cupProblems.push(`cup is too tight (${lv.goal.r})`);
  for (const pit of lv.pits) if (pit.r > lv.goal.r) cupProblems.push(`pit at ${pit.cell} is wider than the cup`);
  if (cupProblems.length) fail('the cup is big enough and wider than a pit', cupProblems.join('; '));
  else pass('the cup is big enough and wider than a pit');

  // Perimeter sealed unless the level says otherwise.
  let openEdges = 0;
  for (let r = 0; r < lv.h; r++) {
    for (let c = 0; c < lv.w; c++) {
      if (!isWalkable(lv, c, r)) continue;
      for (const [nc, nr] of [[c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]]) {
        if (nc < 0 || nr < 0 || nc >= lv.w || nr >= lv.h) openEdges++;
        else if (lv.grid[nr][nc] === OUTSIDE) openEdges++;
      }
    }
  }
  if (openEdges > 0 && !lv.spec.openEdges) {
    fail('the perimeter is sealed or the level says it is not', `${openEdges} floor edge(s) open onto the void — tick "open edges" or close them with wall`);
  } else pass('the perimeter is sealed or the level says it is not', openEdges ? `${openEdges} open edge(s), declared` : '');

  // Early levels stay generous.
  if (lv.difficulty <= 3) {
    const squeeze = [];
    for (const [c, r] of walkableCells(lv)) {
      if (Math.max(freeRun(lv, c, r, 1, 0), freeRun(lv, c, r, 0, 1)) + 1 < 2) squeeze.push([c, r]);
    }
    if (squeeze.length) fail('difficulty ≤ 3 keeps every lane two cells wide', `${squeeze.length} one-cell squeeze(s): ${list(squeeze)}`);
    else pass('difficulty ≤ 3 keeps every lane two cells wide');
  }

  // Par sanity against the route length at terminal speed. With several marbles, par has to
  // cover the *longest* of their routes, since every one of them must make it home.
  const routes = lv.spawns.map((s) => cellPath(lv, s.cell, lv.goal.cell)).filter(Boolean);
  if (routes.length) {
    const dist = Math.max(...routes.map((r) => r.length - 1));
    const minPar = dist / 3.2;
    if (!lv.par) fail('a par time exists', 'par is required');
    else if (lv.par < minPar) fail('par is achievable for the route length', `par ${lv.par}s is impossible for a ${dist} unit route (needs ≥ ${minPar.toFixed(1)}s)`);
    else pass('par is achievable for the route length', `${dist} cells${lv.spawns.length > 1 ? ' (longest marble route)' : ''}, min ${minPar.toFixed(1)}s, par ${lv.par}s`);
  }

  // Board outline: one clean loop, area matching the footprint, collar follows it.
  const loops = silhouetteLoops(lv);
  if (loops.length !== 1) {
    fail('the board outline is one closed loop', `${loops.length} outline loops — the renderer draws one solid slab`);
  } else {
    const area = Math.abs(loopArea(loops[0]));
    const cells = footprintCellCount(lv);
    if (Math.abs(area - cells) > 1e-6) fail('the board outline is one closed loop', `outline area ${area} does not match ${cells} footprint cells`);
    else pass('the board outline is one closed loop', `${cells} cells`);
    const inner = insetLoop(loops[0], LID_BEZEL);
    const lip = insetLoop(loops[0], -0.07);
    if (!inner || Math.abs(loopArea(inner)) < 4) fail('the glass collar can follow this outline', 'the collar leaves no glass');
    else if (Math.sign(loopArea(inner)) !== Math.sign(loopArea(loops[0]))) fail('the glass collar can follow this outline', 'the collar offset flipped the outline');
    else if (!lip) fail('the glass collar can follow this outline', 'the collar lip cannot overhang the outline');
    else pass('the glass collar can follow this outline');
  }

  // Holes: drawn radius must cover the capture radius.
  const holes = holeProblems(lv, GOAL_HOLE_R);
  if (holes.length) fail('every hole is drawn at least as wide as it captures', holes.join('; '));
  else pass('every hole is drawn at least as wide as it captures');

  const goalHole = slabHoles(lv, GOAL_HOLE_R).find((h) => h.kind === 'goal');
  if (goalHole && (Math.abs(goalHole.x - lv.goal.x) > 1e-9 || Math.abs(goalHole.z - lv.goal.z) > 1e-9)) {
    fail('the cup hole sits on the goal', 'the drawn hole is off the goal cell');
  } else pass('the cup hole sits on the goal');

  // The etched rose lives on the lid.
  const design = roseDesign(lv);
  if (!design.rings.length) soft('there is room for the etched rose on the glass', 'no clear annulus between the knob and the innermost hole');
  else {
    const problems = roseProblems(lv);
    if (problems.length) soft('the etched rose never crosses a hole', problems.join('; '));
    else pass('the etched rose never crosses a hole', `reach ${roseReach(lv).toFixed(2)}, innermost hole ${Math.min(...roseHoles(lv).map((h) => h.d - h.r)).toFixed(2)}`);
  }

  // Obstacle references. A plate's gate is optional now: a plate that only drives lifts has no
  // gate, and that is a complete, valid plate rather than an orphan.
  const gateIds = new Set(lv.spec.gates?.map((g) => g.id) ?? []);
  const namedPlates = (lv.spec.buttons ?? []).filter((b) => b.gate);
  const orphanPlates = namedPlates.filter((b) => !gateIds.has(b.gate));
  if (orphanPlates.length) fail('every plate that names a gate names one that exists', `plate(s) at ${list(orphanPlates.map((b) => b.cell))} reference a missing gate id`);
  else pass('every plate that names a gate names one that exists');

  const unusedGates = [...gateIds].filter((id) => !(lv.spec.buttons ?? []).some((b) => b.gate === id));
  if (unusedGates.length) soft('every gate is opened by a plate', `gate(s) ${unusedGates.join(', ')} have no plate`);
  else pass('every gate is opened by a plate');

  // Lifts: each needs a plate to read, a live segment, and a real plate id to read from.
  const plateIds = new Set((lv.spec.buttons ?? []).map((b) => b.id).filter(Boolean));
  const dupPlateIds = [...(lv.spec.buttons ?? []).reduce((m, b) => (b.id ? m.set(b.id, (m.get(b.id) ?? 0) + 1) : m), new Map())].filter(([, n]) => n > 1);
  if (dupPlateIds.length) fail('plate ids are unique', dupPlateIds.map(([id, n]) => `'${id}' appears ${n} times`).join('; '));
  else pass('plate ids are unique');

  //  A button is an object, not a painted cell: it may sit on any ground (ice, sand, steel, a
  //  material plate, plain floor). What must hold is the metal it names - the finish of the button
  //  AND of every wall it drives - because a wall cannot be cut from a metal that does not exist.
  //  (A button buried in a wall is already a buildLevel() error, checked above.)
  const badMetal = (lv.spec.buttons ?? []).filter((b) => b.metal && !METAL_IDS.has(b.metal));
  if (badMetal.length) soft('every button names a metal that exists', badMetal.map((b) => `button ${b.id ?? ''} names '${b.metal}'`).join('; '));
  else pass('every button names a metal that exists');

  const lifts = lv.spec.lifts ?? [];
  const missingPlates = lifts.filter((l) => !l.plate);
  const unknownPlates = lifts.filter((l) => l.plate && !plateIds.has(l.plate));
  if (missingPlates.length) fail('every lift names a plate', `${missingPlates.length} lift(s) name no plate`);
  else if (unknownPlates.length) fail('every lift names a plate that exists', `lift(s) ${unknownPlates.map((l) => l.id).join(', ')} reference a missing plate id`);
  else pass('every lift names a plate that exists', lifts.length ? `${lifts.length} lift(s)` : '');

  const badLifts = lifts.filter((l) => l.seg[0][0] === l.seg[1][0] && l.seg[0][1] === l.seg[1][1]);
  if (badLifts.length) soft('each lift has some length', `${badLifts.length} lift(s) start and end on the same point`);
  else pass('each lift has some length');

  // A lift whose *span* is buried in wall cells is invisible. The ends deliberately sit in the
  // wall bands it spans (that is how a gate segment is authored too), so only the middle counts.
  const wallLifts = [];
  for (const l of lifts) {
    const mid = cover([(l.seg[0][0] + l.seg[1][0]) / 2, (l.seg[0][1] + l.seg[1][1]) / 2]);
    if (charAt(draft, mid[0], mid[1]) === WALL) wallLifts.push(`lift ${l.id} at ${mid.join(',')}`);
  }
  if (wallLifts.length) soft('no lift is buried in a wall', wallLifts.join('; '));
  else pass('no lift is buried in a wall');

  const slotHoles = slabHoles(lv, GOAL_HOLE_R).filter((h) => h.kind === 'pit' && h.slot).length;
  const authoredSlotCount = draft.pits.filter(isSlot).length;
  if (slotHoles !== authoredSlotCount) fail('every slot is drawn as one hole', `${slotHoles} slot holes for ${authoredSlotCount} authored slots`);
  else if (authoredSlotCount) pass('every slot is drawn as one hole', `${authoredSlotCount} slot(s) with rounded ends`);
  else pass('every slot is drawn as one hole', 'no slots in this level');

  const padCells = (lv.spec.teleports ?? []).flatMap((t) => [t.a, t.b]);
  const dupPads = padCells.filter((cell) => padCells.filter((o) => o[0] === cell[0] && o[1] === cell[1]).length > 1);
  if (dupPads.length) soft('teleport pads do not share a cell', list(dupPads));
  else pass('teleport pads do not share a cell');

  // Cells that carry no obstacle at all is fine; cells that carry two are not.
  const objectCells = [];
  for (const [list_, what] of [
    [lv.spec.pegs, 'peg'],
    [lv.spec.windmills, 'windmill'],
    [lv.spec.pendulums, 'pendulum'],
    [lv.spec.magnets, 'magnet'],
    [lv.spec.buttons, 'plate'],
  ]) {
    for (const o of list_ ?? []) objectCells.push({ cell: o.cell, what });
  }
  const collisions = [];
  for (let i = 0; i < objectCells.length; i++) {
    for (let j = i + 1; j < objectCells.length; j++) {
      if (objectCells[i].cell[0] === objectCells[j].cell[0] && objectCells[i].cell[1] === objectCells[j].cell[1]) {
        collisions.push(`${objectCells[i].cell.join(',')} (${objectCells[i].what} + ${objectCells[j].what})`);
      }
    }
  }
  if (collisions.length) soft('no two obstacles share a cell', collisions.join('; '));
  else pass('no two obstacles share a cell');

  // Movers need a track that is not a single cell.
  const badMovers = (lv.spec.movers ?? []).filter((m) => m.from[0] === m.to[0] && m.from[1] === m.to[1]);
  if (badMovers.length) soft('each sliding bar has a track', `${badMovers.length} mover(s) start and end on the same cell`);
  else pass('each sliding bar has a track');

  //  No field is stronger than the board itself. A steady push is answered by at most
  //  `g * sin(maxTilt) * roll`, so a vent or magnet past that cannot be climbed by tilting at all
  //  - the level would not be hard, it would be impossible. Measured with the live tuning, so the
  //  rule follows the player's own max tilt rather than the shipped number.
  //
  //  A warning, not an error: a field the marble is *not* asked to climb is fine, and only the
  //  author knows the route. (If such a level is authored without a scripted plan, the tilt
  //  autopilot in tests/solver.test.js fails on it, which is the enforcing half.)
  const ceiling = TUNING.gravity * Math.sin(TUNING.maxTilt) * TUNING.roll;
  const tooStrong = [
    ...(spec.vents ?? []).map((v, i) => ({ what: `fan ${i + 1} at ${TUNING.ventAccel.toFixed(2)} u/s²`, over: TUNING.ventAccel > ceiling })),
    ...(spec.magnets ?? []).map((m, i) => ({
      what: `magnet ${i + 1} at ${Math.abs(m.strength ?? TUNING.magnetStrength).toFixed(2)} u/s²`,
      over: Math.abs(m.strength ?? TUNING.magnetStrength) > ceiling,
    })),
  ].filter((f) => f.over);
  if (tooStrong.length) {
    soft(
      'no field is stronger than the board can climb',
      `${tooStrong.map((f) => f.what).join(', ')} — the board's own maximum is ${ceiling.toFixed(2)} u/s², so a marble cannot climb one of these however it is steered`,
    );
  } else if ((spec.vents ?? []).length || (spec.magnets ?? []).length) {
    pass('no field is stronger than the board can climb', `ceiling ${ceiling.toFixed(2)} u/s²`);
  } else {
    pass('no field is stronger than the board can climb', 'no fans or magnets in this level');
  }

  return { spec, level: lv, results };
}

export function summarise(results) {
  const errors = results.filter((r) => r.level === 'error').length;
  const warnings = results.filter((r) => r.level === 'warning').length;
  return { errors, warnings, ok: results.filter((r) => r.level === 'ok').length };
}
