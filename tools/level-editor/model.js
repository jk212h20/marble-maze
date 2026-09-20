//  Level editor — draft model.
//
//  The editor keeps one authoritative *paint grid* (a char per board cell, exactly the
//  characters `src/engine/levels.js` uses) plus the obstacle lists from the level format.
//  `draftToSpec()` compiles that back into the declarative spec that `buildLevel()` eats,
//  merging painted runs into compact rectangles so an exported level reads like a hand
//  written one instead of one rect per cell.
//
//  Nothing here mutates the game's source; the editor only imports from it.

import {
  insideShape,
  FLOOR,
  WALL,
  PIT,
  ICE,
  SAND,
  STEEL,
  BELT,
  VENT,
  PAD,
  PLATE,
  OUTSIDE,
} from '../../src/engine/levels.js';
import { BALL_R, RAMP_HEIGHT } from '../../src/engine/constants.js';

export const SHAPES = ['rect', 'hexagon', 'octagon', 'diamond', 'cross', 'diamondRing', 'star'];

export const SHAPE_LABEL = {
  rect: 'Rectangle',
  hexagon: 'Hexagon',
  octagon: 'Octagon',
  diamond: 'Diamond',
  cross: 'Plus / Cross',
  diamondRing: 'Diamond ring',
  star: 'Star',
};

/** How finely positions may be placed. An eighth of a cell is the authoring step. */
export const SNAP_STEPS = [
  { id: '1', label: 'whole cells', step: 1 },
  { id: '1/2', label: 'half cells', step: 0.5 },
  { id: '1/4', label: 'quarter cells', step: 0.25 },
  { id: '1/8', label: 'eighths', step: 0.125 },
];

export const DEFAULT_SNAP = 0.125;

/** Snap a cell-space coordinate to the authoring grid. Integer means a cell centre. */
export function snap(v, step = DEFAULT_SNAP) {
  return Math.round(v / step) * step;
}

export const snapPair = ([c, r], step = DEFAULT_SNAP) => [snap(c, step), snap(r, step)];

/** Pits are painted as centres, not as cells: this is the palette entry for that brush. */
export const PIT_TOOL = {
  id: 'pit',
  label: 'Pit / slot',
  hint: 'Click or drag to drop pit centres. Centres that overlap merge into one rounded slot.',
};

/** Paintable cell characters, in palette order. */
export const PAINT_CELLS = [
  { char: FLOOR, id: 'floor', label: 'Floor', hint: 'Plain wood' },
  { char: WALL, id: 'wall', label: 'Wall', hint: 'Raised wall — reflects the marble' },
  { char: ICE, id: 'ice', label: 'Ice', hint: 'Almost no drag' },
  { char: SAND, id: 'sand', label: 'Sand', hint: 'High drag' },
  { char: STEEL, id: 'steel', label: 'Steel', hint: 'Fast, low-friction plate' },
  { char: BELT, id: 'belt', label: 'Conveyor', hint: 'Drags the marble along its direction' },
  { char: VENT, id: 'vent', label: 'Fan / vent', hint: 'Steady push along its direction' },
  { char: PLATE, id: 'plate', label: 'Pressure plate', hint: 'Opens its gate while held' },
];

export const PAINT_BY_ID = Object.fromEntries(PAINT_CELLS.map((p) => [p.id, p.char]));
export const PAINT_BY_CHAR = Object.fromEntries(PAINT_CELLS.map((p) => [p.char, p]));

/**
 * Material plates: a rectangle of ice, sand or steel in cell-EDGE coordinates.
 *
 * Every other position in this editor is a cell CENTRE, where 3.125 is an eighth past cell 3's
 * centre. A plate is authored on cell edges instead, so `whole cells` puts its boundary on a cell
 * boundary — which is what the cell-rect form means — and an eighth of a cell is an eighth.
 */
/** The draft-grid character that means "a ramp's footprint". The game grid never sees it. */
export const RAMP_CHAR = 'R';

export const PLATE_MATERIALS = [
  { id: 'ice', char: ICE, label: 'Ice plate', hint: 'A rectangle of low-friction ice' },
  { id: 'sand', char: SAND, label: 'Sand plate', hint: 'A rectangle of high-drag sand' },
  { id: 'steel', char: STEEL, label: 'Steel plate', hint: 'A rectangle of fast, low-friction steel' },
  {
    id: 'ramp',
    char: RAMP_CHAR,
    swatch: '#c9822f',
    label: 'Ramp (wedge)',
    hint: 'A raised wedge. It is a one-way hill: the arrow points the way the marble climbs it, and it launches off the far crest',
  },
];

/** Obstacle tools that place a small object on a cell. */
export const OBJECT_CELLS = [
  { id: 'spawn', label: 'Marble', glyph: 'S', hint: 'Add a marble: click empty floor to drop one, or drag an existing marble to move it. Every marble must reach the cup.' },
  { id: 'goal', label: 'Goal cup', glyph: 'G', hint: 'The brass-ringed cup (single cell)' },
  { id: 'peg', label: 'Bumper post', glyph: '●', hint: 'A disc the marble bounces off' },
  { id: 'windmill', label: 'Windmill', glyph: '✳', hint: 'Rotating arms that bat the marble' },
  { id: 'pendulum', label: 'Pendulum', glyph: '◍', hint: 'Swings across a lane' },
  { id: 'magnet', label: 'Magnet', glyph: '◎', hint: 'Attracts (or repels) inside its radius' },
  { id: 'button', label: 'Plate → gate', glyph: '▣', hint: 'A plate that opens a named gate' },
  { id: 'erase', label: 'Erase object', glyph: '␡', hint: 'Remove whatever object sits on the cell' },
];

/** Tools that are authored by clicking two cells. */
export const PAIR_OBJECTS = [
  { id: 'teleport', label: 'Teleport pair', hint: 'Click pad A, then pad B' },
  { id: 'mover', label: 'Sliding bar', hint: 'Click the two ends of its track' },
  { id: 'gate', label: 'Gate', hint: 'Click the two ends of the gate segment' },
  { id: 'lift', label: 'Lift wall', hint: 'Click the two ends of a wall slab a plate raises or lowers while it is held' },
  { id: 'oneway', label: 'One-way flap', hint: 'Click the two ends of the flap' },
];

let uid = 0;
const nextId = () => `n${++uid}`;

export function blankDraft({
  id = 'new-level',
  name = 'New Level',
  shape = 'rect',
  w = 16,
  h = 11,
  difficulty = 1,
  par = 40,
  hint = '',
} = {}) {
  const paint = [];
  for (let r = 0; r < h; r++) {
    const row = [];
    for (let c = 0; c < w; c++) row.push(insideShape(shape, c, r, w, h) ? FLOOR : OUTSIDE);
    paint.push(row);
  }
  const draft = {
    id,
    name,
    shape: SHAPE_LABEL[shape] ?? shape,
    difficulty,
    par,
    hint: hint || 'Grip the handle and tilt the board. Get the marble to the glowing cup.',
    board: { shape, w, h },
    paint,
    dirs: {},
    // Pits are authored in *cell space* (an integer is a cell centre, so 3.125 is an eighth
    // of a cell to the right of cell 3's centre). Overlapping centres become one slot.
    pits: [],
    pitRadius: 0.42,
    // Material plates in cell-EDGE coordinates: { mat, c0, r0, c1, r1 }. A ramp is one of them,
    // with `mat: 'ramp'` plus its own `dir` and `height`.
    plates: [],
    // Defaults for the next ramp dragged out.
    rampHeight: RAMP_HEIGHT,
    rampDir: [0, 1],
    //  One marble per entry: every marble must reach the goal to win, so a level with more
    //  than one spawn is a multi-marble level. The first entry is what single-marble code
    //  (and the engine's `level.spawn`) reads as *the* starting point.
    spawns: [[2, h - 3]],
    goal: [2, 2],
    openEdges: false,
    twoRoutes: false,
    movingPitVisual: false,
    pegs: [],
    windmills: [],
    pendulums: [],
    magnets: [],
    movers: [],
    teleports: [],
    buttons: [],
    gates: [],
    // Plate-driven wall slabs: { id, seg, plate, mode: 'raise' | 'lower' }.
    lifts: [],
    oneways: [],
  };
  draft.spawns = draft.spawns.map((s) => (fits(draft, s) ? s : firstFloor(draft)));
  draft.goal = fits(draft, [2, 2]) ? [2, 2] : firstFloor(draft, draft.spawns[0]);
  for (const s of draft.spawns) setCell(draft, s[0], s[1], FLOOR);
  setCell(draft, draft.goal[0], draft.goal[1], FLOOR);
  return draft;
}

export const key = (c, r) => `${c},${r}`;

export function inside(draft, c, r) {
  const { w, h } = draft.board;
  return c >= 0 && r >= 0 && c < w && r < h && draft.paint[r][c] !== OUTSIDE;
}

export function charAt(draft, c, r) {
  if (c < 0 || r < 0 || r >= draft.board.h || c >= draft.board.w) return OUTSIDE;
  return draft.paint[r][c];
}

export function setCell(draft, c, r, char) {
  if (!inside(draft, c, r)) return false;
  draft.paint[r][c] = char;
  if (char !== BELT && char !== VENT) delete draft.dirs[key(c, r)];
  return true;
}

// ---------------------------------------------------------------------------
//  Pits: a chain of centres, merged into slots when they overlap
// ---------------------------------------------------------------------------

/** Distance from a point to a chain of centres (one centre is a circle). */
export function chainDistance(centers, px, pz) {
  if (centers.length === 1) return Math.hypot(px - centers[0][0], pz - centers[0][1]);
  let best = Infinity;
  for (let i = 1; i < centers.length; i++) {
    const [ax, az] = centers[i - 1];
    const [bx, bz] = centers[i];
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0;
    best = Math.min(best, Math.hypot(px - (ax + dx * t), pz - (az + dz * t)));
  }
  return best;
}

/** Drop a middle centre that the slot already covers: it changes nothing, and reads better. */
export function simplifyChain(centers, r) {
  const out = [];
  for (const c of centers) {
    const last = out[out.length - 1];
    if (last && Math.hypot(last[0] - c[0], last[1] - c[1]) < 1e-9) continue;
    out.push([...c]);
  }
  for (let i = 1; i < out.length - 1; ) {
    const [ax, az] = out[i - 1];
    const [bx, bz] = out[i];
    const [cx, cz] = out[i + 1];
    const straight = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) / (Math.hypot(cx - ax, cz - az) || 1);
    if (straight < 1e-9 && Math.hypot(bx - ax, bz - az) <= 2 * r) out.splice(i, 1);
    else i++;
  }
  return out;
}

/** The pit whose chain the point touches, or null. */
export function pitAt(draft, [c, r]) {
  for (let i = 0; i < draft.pits.length; i++) {
    const pit = draft.pits[i];
    if (chainDistance(pit.centers, c, r) <= pit.r + 1e-9) return i;
  }
  return null;
}

/**
 * Drop a pit centre. It joins an existing slot when it overlaps one (the chain grows, the
 * radius becomes the larger of the two), otherwise it starts a new round pit.
 */
export function addPitCenter(draft, cell, radius = draft.pitRadius ?? 0.42) {
  const at = [round8(cell[0]), round8(cell[1])];
  const r = round8(radius);
  //  The pit the stroke is on is the one whose region the centre is *closest* to, not merely the
  //  first one it touches: two runs can overlap, and a centre on one of them must extend that
  //  one, or the two runs interleave their centres and each comes out out of order.
  let host = null;
  let hostD = Infinity;
  for (const pit of draft.pits) {
    const d = chainDistance(pit.centers, at[0], at[1]);
    if (d <= pit.r + r - 1e-9 && d < hostD) {
      host = pit;
      hostD = d;
    }
  }
  if (host) {
    // A centre the slot already covers adds nothing, and appending it would double the chain back
    // on itself: a stroke drawn back over its own run would leave centres out of order, and the
    // swept outline of a path that revisits its own middle is not the region the author drew.
    if (hostD <= host.r + 1e-9) return { pit: host, merged: true, grew: false };
    // Extend a slot only at an end, and only when the centre is out beyond that end. A centre
    // that touches the middle of a chain is a *branch*: it makes the swept region wider there,
    // which a path cannot describe, so it starts its own pit. They overlap, and the board (and
    // the plan view) draw the union as the one hole they really are.
    const first = host.centers[0];
    const last = host.centers[host.centers.length - 1];
    const dFirst = Math.hypot(at[0] - first[0], at[1] - first[1]);
    const dLast = Math.hypot(at[0] - last[0], at[1] - last[1]);
    const reach = host.r + r;
    let end = null;
    if (dFirst <= reach && dFirst <= dLast) end = 'first';
    else if (dLast <= reach) end = 'last';
    if (end) {
      if (end === 'first') host.centers.unshift(at);
      else host.centers.push(at);
      const grew = r > host.r;
      host.r = Math.max(host.r, r);
      host.centers = simplifyChain(host.centers, host.r);
      draft.pitRadius = host.r;
      return { pit: host, merged: true, grew };
    }
  }
  const pit = { centers: [at], r, move: null };
  draft.pits.push(pit);
  draft.pitRadius = r;
  return { pit, merged: false };
}

/**
 * Remove a pit centre: the chain splits when the centre was in the middle, so what is left
 * on the board is exactly what was drawn.
 */
export function removePitCenter(draft, cell) {
  const hit = pitAt(draft, cell);
  if (hit === null) return false;
  const pit = draft.pits[hit];
  let nearest = 0;
  let bestD = Infinity;
  pit.centers.forEach((c, i) => {
    const d = Math.hypot(c[0] - cell[0], c[1] - cell[1]);
    if (d < bestD) {
      bestD = d;
      nearest = i;
    }
  });
  const left = pit.centers.slice(0, nearest);
  const right = pit.centers.slice(nearest + 1);
  const keep = [];
  if (left.length) keep.push(simplifyChain(left, pit.r));
  if (right.length) keep.push(simplifyChain(right, pit.r));
  draft.pits.splice(hit, 1, ...keep.map((centers) => ({ centers, r: pit.r, move: pit.move ? { ...pit.move } : null })));
  return true;
}

/** Remove every pit centre inside a cell (used by the erase drag over a cell grid). */
export function removePitsInCell(draft, c, r) {
  const before = draft.pits.length;
  draft.pits = draft.pits.filter((pit) => !pit.centers.some(([pc, pr]) => Math.floor(pc + 0.5) === c && Math.floor(pr + 0.5) === r));
  return draft.pits.length !== before;
}

const round8 = (v) => Math.round(v * 1e6) / 1e6;

/** Is this pit a slot (a chain) rather than a round hole? */
export const isSlot = (pit) => pit.centers.length > 1;

function fits(draft, [c, r]) {
  return inside(draft, c, r);
}

function firstFloor(draft, skip) {
  const { w, h } = draft.board;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (!inside(draft, c, r)) continue;
      if (skip && skip[0] === c && skip[1] === r) continue;
      return [c, r];
    }
  }
  return [0, 0];
}

// ---------------------------------------------------------------------------
//  Marbles (spawn points)
// ---------------------------------------------------------------------------
//
//  One spawn per marble: a draft with more than one spawn authors a multi-marble level, and
//  every marble must reach the goal to win. Adding, moving and removing them is a first-class
//  action (the spawn tool adds on empty floor and picks up an existing marble; the selection
//  can be dragged), so the editor never has to rebuild a level to place a second marble.

/**
 * Two marbles cannot start closer than this (cell units). It mirrors the engine's own rule in
 * `tests/levels.test.js` — spawning them on top of each other would be an immediate collision.
 */
export const MIN_SPAWN_GAP = BALL_R * 2 + 0.1;

/** Every spawn in a draft, tolerating an old draft that still carries a single `spawn`. */
export function spawnsOf(draft) {
  if (Array.isArray(draft.spawns) && draft.spawns.length) return draft.spawns;
  return Array.isArray(draft.spawn) ? [draft.spawn] : [];
}

/** The index of the spawn within `tol` of an authored position, or null. */
export function spawnAt(draft, at, tol = 0.4) {
  const list = spawnsOf(draft);
  let best = null;
  let bestD = tol;
  for (let i = 0; i < list.length; i++) {
    const d = Math.hypot(list[i][0] - at[0], list[i][1] - at[1]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Can a marble be placed at `at`? On the board, and at least `MIN_SPAWN_GAP` from every *other*
 * marble. `ignore` skips one index, so a marble can be moved without colliding with itself.
 * Returns { ok } plus the blocking index when it is not.
 */
export function spawnFits(draft, at, ignore = null) {
  if (!inside(draft, at[0], at[1])) return { ok: false, reason: 'off the board' };
  const list = spawnsOf(draft);
  for (let i = 0; i < list.length; i++) {
    if (i === ignore) continue;
    const d = Math.hypot(list[i][0] - at[0], list[i][1] - at[1]);
    if (d < MIN_SPAWN_GAP) return { ok: false, reason: `too close to marble ${i + 1}`, index: i };
  }
  return { ok: true };
}

/**
 * Add a marble at `at`. Returns its index, or the index of a marble already at that spot. Returns
 * null when the position is off the board or would overlap another marble.
 */
export function addSpawn(draft, at) {
  const list = (draft.spawns ??= spawnsOf(draft).map((s) => [...s]));
  const existing = spawnAt(draft, at);
  if (existing !== null) return existing;
  if (!spawnFits(draft, at).ok) return null;
  list.push([at[0], at[1]]);
  setCell(draft, Math.floor(at[0] + 0.5), Math.floor(at[1] + 0.5), FLOOR);
  return list.length - 1;
}

/**
 * Move a marble to `at`. Returns true on success. A move that would leave the board or overlap
 * another marble is refused (the editor keeps the last good position instead of drawing a draft
 * the engine will reject).
 */
export function moveSpawn(draft, index, at) {
  const list = (draft.spawns ??= spawnsOf(draft).map((s) => [...s]));
  if (!list[index]) return false;
  if (!spawnFits(draft, at, index).ok) return false;
  list[index] = [at[0], at[1]];
  return true;
}

/** Remove a marble. The last marble is not removable — a level always has somewhere to start. */
export function removeSpawn(draft, index) {
  const list = (draft.spawns ??= spawnsOf(draft).map((s) => [...s]));
  if (!list[index] || list.length <= 1) return false;
  list.splice(index, 1);
  return true;
}

// ---------------------------------------------------------------------------
//  Material plates
// ---------------------------------------------------------------------------

/** Does a point (cell-EDGE space) fall inside a plate? */
export function pointInPlate(plate, c, r) {
  return c >= plate.c0 && c <= plate.c1 && r >= plate.r0 && r <= plate.r1;
}

/** The plate under an authored position, topmost first, or null. */
export function plateAt(draft, [c, r]) {
  const edge = [c + 0.5, r + 0.5]; // plate space is cell edges; authoring space is cell centres
  const list = draft.plates ?? [];
  for (let i = list.length - 1; i >= 0; i--) if (pointInPlate(list[i], edge[0], edge[1])) return i;
  return null;
}

/**
 * Add or replace the plate under this rectangle. Returns the index it landed at.
 *
 * A ramp is a plate with `mat: 'ramp'` and two extra numbers, which is what lets it reuse the
 * whole rectangle brush: the drag, the selection, the property sheet, the delete button and the
 * wall push-out are all the same thing a material plate already had.
 */
export function addPlate(draft, mat, rect, opts = {}) {
  const [c0, r0, c1, r1] = rect;
  const plate = { mat, c0, r0, c1, r1 };
  if (mat === 'ramp') {
    plate.dir = [...(opts.dir ?? draft.rampDir ?? [0, 1])];
    plate.height = opts.height ?? draft.rampHeight ?? RAMP_HEIGHT;
  }
  const same = (draft.plates ?? []).findIndex(
    (p) =>
      p.mat === mat &&
      Math.abs(p.c0 - c0) < 1e-9 &&
      Math.abs(p.r0 - r0) < 1e-9 &&
      Math.abs(p.c1 - c1) < 1e-9 &&
      Math.abs(p.r1 - r1) < 1e-9 &&
      (mat !== 'ramp' || (p.dir?.[0] === plate.dir[0] && p.dir?.[1] === plate.dir[1])),
  );
  if (same >= 0) return same;
  draft.plates.push(plate);
  return draft.plates.length - 1;
}

export function removePlate(draft, index) {
  if (!draft.plates?.[index]) return false;
  draft.plates.splice(index, 1);
  return true;
}

/** Plates that cover a cell, so a wall can push them out of the way. */
export function platesOverCell(draft, c, r) {
  const out = [];
  (draft.plates ?? []).forEach((p, i) => {
    if (pointInPlate(p, c, r) || pointInPlate(p, c + 1, r) || pointInPlate(p, c, r + 1) || pointInPlate(p, c + 1, r + 1)) out.push(i);
  });
  return out;
}

/** Change the board size/shape, preserving every cell that still exists. */
export function resizeDraft(draft, { shape = draft.board.shape, w = draft.board.w, h = draft.board.h }) {
  const old = draft.paint;
  const paint = [];
  for (let r = 0; r < h; r++) {
    const row = [];
    for (let c = 0; c < w; c++) {
      const wasIn = insideShape(draft.board.shape, c, r, draft.board.w, draft.board.h) && old[r]?.[c] !== OUTSIDE;
      row.push(insideShape(shape, c, r, w, h) ? (wasIn ? old[r][c] : FLOOR) : OUTSIDE);
    }
    paint.push(row);
  }
  draft.paint = paint;
  draft.board = { shape, w, h };
  draft.shape = SHAPE_LABEL[shape] ?? shape;
  // Drop anything that fell off the board.
  for (const k of Object.keys(draft.dirs)) {
    const [c, r] = k.split(',').map(Number);
    if (!inside(draft, c, r)) delete draft.dirs[k];
  }
  const onBoard = ([c, r]) => {
    const [ci, ri] = [Math.floor(c + 0.5), Math.floor(r + 0.5)];
    return ci >= 0 && ri >= 0 && ci < w && ri < h && insideShape(shape, ci, ri, w, h);
  };
  draft.pits = draft.pits.filter((pit) => pit.centers.every(onBoard));
  // A plate survives if any of it is still on the board; it is trimmed to the new rectangle so
  // the ledger cannot report a plate that reaches into the void.
  draft.plates = (draft.plates ?? [])
    .map((p) => ({ ...p, c0: Math.max(0, p.c0), r0: Math.max(0, p.r0), c1: Math.min(w, p.c1), r1: Math.min(h, p.r1) }))
    .filter((p) => p.c1 > p.c0 && p.r1 > p.r0);
  const cellOk = ([c, r]) => inside(draft, Math.floor(c + 0.5), Math.floor(r + 0.5));
  // Every marble moves onto the new grid and off the board if it no longer fits; a level must
  // still have at least one, so an emptied list gets a fresh spawn on the nearest floor.
  draft.spawns = spawnsOf(draft).map((s) => snapPair(s)).filter(cellOk);
  if (!draft.spawns.length) draft.spawns = [firstFloor(draft)];
  draft.goal = snapPair(draft.goal);
  if (!cellOk(draft.goal)) draft.goal = firstFloor(draft, draft.spawns[0]);
  const drop = (arr) => arr.filter((o) => (o.cell ? cellOk(o.cell) : true));
  draft.pegs = drop(draft.pegs);
  draft.windmills = drop(draft.windmills);
  draft.pendulums = drop(draft.pendulums);
  draft.magnets = drop(draft.magnets);
  draft.buttons = drop(draft.buttons);
  draft.movers = draft.movers.filter((m) => cellOk(m.from) && cellOk(m.to));
  draft.teleports = draft.teleports.filter((t) => cellOk(t.a) && cellOk(t.b));
  draft.gates = draft.gates.filter((g) => g.seg.every(cellOk));
  draft.lifts = (draft.lifts ?? []).filter((l) => l.seg.every(cellOk));
  draft.oneways = draft.oneways.filter((o) => cellOk(o.seg) || o.seg.every(cellOk));
  return draft;
}

// ---------------------------------------------------------------------------
//  Draft -> level spec
// ---------------------------------------------------------------------------

/**
 * Compile the paint grid into rectangles.
 * `classOf(c, r)` returns a class id string, or null for "nothing to emit".
 * Returns Map<classId, rect[]> with rects as [c0, r0, c1, r1].
 */
export function decompose(w, h, classOf) {
  const grid = [];
  for (let r = 0; r < h; r++) {
    const row = [];
    for (let c = 0; c < w; c++) row.push(classOf(c, r));
    grid.push(row);
  }
  const used = Array.from({ length: h }, () => new Array(w).fill(false));
  const out = new Map();
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (used[r][c]) continue;
      const id = grid[r][c];
      if (id == null) continue;
      let c1 = c;
      while (c1 + 1 < w && !used[r][c1 + 1] && grid[r][c1 + 1] === id) c1++;
      let r1 = r;
      grow: while (r1 + 1 < h) {
        for (let cc = c; cc <= c1; cc++) {
          if (used[r1 + 1][cc] || grid[r1 + 1][cc] !== id) break grow;
        }
        r1++;
      }
      for (let rr = r; rr <= r1; rr++) for (let cc = c; cc <= c1; cc++) used[rr][cc] = true;
      if (!out.has(id)) out.set(id, []);
      out.get(id).push([c, r, c1, r1]);
      c = c1;
    }
  }
  return out;
}

export function dirOf(draft, c, r) {
  return draft.dirs[key(c, r)] ?? [0, 1];
}

export function draftToSpec(draft) {
  const { w, h } = draft.board;
  const spawns = spawnsOf(draft).map((s) => [Number(s[0].toFixed(6)), Number(s[1].toFixed(6))]);
  const spec = {
    id: draft.id,
    name: draft.name,
    shape: draft.shape,
    difficulty: Number(draft.difficulty),
    par: Number(draft.par),
    hint: draft.hint,
    board: { shape: draft.board.shape, w, h },
    walls: [],
    carve: [],
    ice: [],
    sand: [],
    steel: [],
    belts: [],
    vents: [],
    //  The engine accepts a single `[c, r]` spawn or a list of them for a multi-marble level.
    //  Emit the single form when there is one marble, so a plain level still reads the old way,
    //  and mark a multi-marble level so its spawns are checked for distinctness.
    spawn: spawns.length === 1 ? [...spawns[0]] : spawns.map((s) => [...s]),
    goal: [...draft.goal],
    pits: [],
    pegs: draft.pegs.map((p) => ({ ...p, cell: [...p.cell] })),
    windmills: draft.windmills.map((o) => ({ ...o, cell: [...o.cell] })),
    pendulums: draft.pendulums.map((o) => ({ ...o, cell: [...o.cell] })),
    magnets: draft.magnets.map((o) => ({ ...o, cell: [...o.cell] })),
    movers: draft.movers.map((m) => ({ ...m, from: [...m.from], to: [...m.to] })),
    teleports: draft.teleports.map((t) => ({ a: [...t.a], b: [...t.b] })),
    buttons: draft.buttons.map((b) => ({ ...b, cell: [...b.cell] })),
    gates: draft.gates.map((g) => ({ ...g, seg: g.seg.map((s) => [...s]) })),
    lifts: (draft.lifts ?? []).map((l) => ({ ...l, seg: l.seg.map((s) => [...s]) })),
    oneways: draft.oneways.map((o) => ({ ...o, seg: o.seg.map((s) => [...s]) })),
  };

  const classOf = (c, r) => {
    const ch = charAt(draft, c, r);
    if (ch === FLOOR || ch === OUTSIDE || ch === PAD) return null;
    if (ch === WALL) return 'wall';
    if (ch === ICE) return 'ice';
    if (ch === SAND) return 'sand';
    if (ch === STEEL) return 'steel';
    if (ch === BELT) return `belt:${dirOf(draft, c, r).join(',')}`;
    if (ch === VENT) return `vent:${dirOf(draft, c, r).join(',')}`;
    if (ch === PLATE) return null; // plates come from the plate→gate objects
    return null;
  };

  spec.ramps = [];

  // Plates first, then the painted cells: a plate covers ground the cell form does not describe.
  for (const p of draft.plates ?? []) {
    const rect = [p.c0, p.r0, p.c1, p.r1].map((v) => Number(v.toFixed(6)));
    if (p.mat === 'ramp') {
      spec.ramps.push({ rect, dir: [...(p.dir ?? [0, 1])], height: Number((p.height ?? RAMP_HEIGHT).toFixed(6)) });
      continue;
    }
    const entry = { rect };
    if (p.mat === 'ice') spec.ice.push(entry);
    else if (p.mat === 'sand') spec.sand.push(entry);
    else if (p.mat === 'steel') spec.steel.push(entry);
  }

  const rects = decompose(w, h, classOf);
  for (const [id, list] of rects) {
    if (id === 'wall') spec.walls.push(...list);
    else if (id === 'ice') spec.ice.push(...list);
    else if (id === 'sand') spec.sand.push(...list);
    else if (id === 'steel') spec.steel.push(...list);
    else if (id.startsWith('belt:')) {
      const dir = id.slice(5).split(',').map(Number);
      for (const rect of list) spec.belts.push({ rect, dir });
    } else if (id.startsWith('vent:')) {
      const dir = id.slice(5).split(',').map(Number);
      for (const rect of list) spec.vents.push({ rect, dir });
    }
  }

  // Pits. A single centre on a cell centre in the classic shape exports as `[c, r]`, so a
  // level authored the old way still reads the old way; anything fractional or chained
  // exports as a slot with its centres.
  for (const pit of draft.pits) {
    const centers = pit.centers.map(([c, r]) => [Number(c.toFixed(6)), Number(r.toFixed(6))]);
    const simple = centers.length === 1 && Number.isInteger(centers[0][0]) && Number.isInteger(centers[0][1]);
    const radius = Number((pit.r ?? draft.pitRadius ?? 0.42).toFixed(6));
    const mv = pit.move;
    if (simple && !mv && Math.abs(radius - 0.42) < 1e-9) {
      spec.pits.push([centers[0][0], centers[0][1]]);
      continue;
    }
    const entry = centers.length === 1 ? { c: centers[0][0], r: centers[0][1] } : { centers };
    if (Math.abs(radius - 0.42) > 1e-9) entry.radius = radius;
    if (mv) Object.assign(entry, { move: [...mv.move], speed: Number(mv.speed), period: Number(mv.period ?? 4), phase: Number(mv.phase ?? 0) });
    spec.pits.push(entry);
  }

  if (spawns.length > 1) spec.multi = true;
  if (spec.pits.some((p) => !Array.isArray(p) && p.move)) spec.movingPitVisual = true;
  if (draft.openEdges) spec.openEdges = true;
  if (draft.twoRoutes) spec.twoRoutes = true;
  if (spec.movingPitVisual) spec.movingPitVisual = true;
  return spec;
}

/** The inverse of draftToSpec: open an existing level spec in the editor. */
export function specToDraft(spec) {
  const w = spec.board.w;
  const h = spec.board.h;
  const draft = blankDraft({ id: spec.id, name: spec.name, shape: spec.board.shape, w, h });
  draft.shape = spec.shape ?? SHAPE_LABEL[spec.board.shape] ?? spec.board.shape;
  draft.difficulty = spec.difficulty ?? 1;
  draft.par = spec.par ?? 40;
  draft.hint = spec.hint ?? '';
  draft.openEdges = !!spec.openEdges;
  draft.twoRoutes = !!spec.twoRoutes;
  draft.movingPitVisual = !!spec.movingPitVisual;
  draft.pegs = [];
  draft.windmills = [];
  draft.pendulums = [];
  draft.magnets = [];
  draft.movers = [];
  draft.teleports = [];
  draft.buttons = [];
  draft.gates = [];
  draft.lifts = [];
  draft.oneways = [];
  draft.dirs = {};

  const fillRect = (rect, char) => {
    for (let r = rect[1]; r <= rect[3]; r++) for (let c = rect[0]; c <= rect[2]; c++) setCell(draft, c, r, char);
  };
  for (const rect of spec.walls ?? []) fillRect(rect, WALL);
  for (const rect of spec.carve ?? []) fillRect(rect, FLOOR);
  // A material entry is either a cell rect or a `{ rect }` plate; the two are kept apart, because
  // a plate is not a paint job: it may sit over a pit without erasing it.
  draft.plates = [];
  const materials = [
    ['ice', ICE, spec.ice],
    ['sand', SAND, spec.sand],
    ['steel', STEEL, spec.steel],
  ];
  for (const [id, char, list] of materials) {
    for (const entry of list ?? []) {
      if (Array.isArray(entry)) fillRect(entry, char);
      else if (entry?.rect) {
        const [c0, r0, c1, r1] = entry.rect.map(Number);
        draft.plates.push({ mat: id, c0, r0, c1, r1 });
      }
    }
  }
  // Ramps are plates too, so they come back the same way they went out.
  for (const rp of spec.ramps ?? []) {
    const [c0, r0, c1, r1] = rp.rect.map(Number);
    draft.plates.push({ mat: 'ramp', c0, r0, c1, r1, dir: [...(rp.dir ?? [0, 1])], height: rp.height ?? RAMP_HEIGHT });
  }
  if (spec.ramps?.length) {
    draft.rampHeight = spec.ramps[spec.ramps.length - 1].height ?? RAMP_HEIGHT;
    draft.rampDir = [...(spec.ramps[spec.ramps.length - 1].dir ?? [0, 1])];
  }
  for (const b of spec.belts ?? []) {
    fillRect(b.rect, BELT);
    for (let r = b.rect[1]; r <= b.rect[3]; r++) for (let c = b.rect[0]; c <= b.rect[2]; c++) draft.dirs[key(c, r)] = [...b.dir];
  }
  for (const v of spec.vents ?? []) {
    fillRect(v.rect, VENT);
    for (let r = v.rect[1]; r <= v.rect[3]; r++) for (let c = v.rect[0]; c <= v.rect[2]; c++) draft.dirs[key(c, r)] = [...v.dir];
  }
  draft.pits = (spec.pits ?? []).map((pit) => {
    const centers = (Array.isArray(pit) ? [pit] : pit.centers ?? [[pit.c, pit.r]]).map((c) => [Number(c[0]), Number(c[1])]);
    const r = Number.isFinite(pit?.radius) ? pit.radius : spec.pitRadius ?? 0.42;
    const move = pit?.move
      ? { move: [...pit.move], speed: pit.speed ?? 0.6, period: pit.period ?? 4, phase: pit.phase ?? 0 }
      : null;
    if (move) draft.movingPitVisual = true;
    return { centers, r, move };
  });
  draft.pitRadius = draft.pits[draft.pits.length - 1]?.r ?? 0.42;
  // A pit used to be a painted cell; importing an old draft means the cell is plain floor.
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (charAt(draft, c, r) === PIT) setCell(draft, c, r, FLOOR);
  // A spec authors either `spawn: [c, r]` or `spawn: [[c0, r0], [c1, r1], ...]` for a
  // multi-marble level. Read both, and keep a copy so the draft can never alias the spec.
  if (spec.spawn) {
    const coords = Array.isArray(spec.spawn[0]) ? spec.spawn : [spec.spawn];
    draft.spawns = coords.map((s) => [...s]);
  }
  if (spec.goal) draft.goal = [...spec.goal];
  for (const s of draft.spawns) setCell(draft, s[0], s[1], FLOOR);
  setCell(draft, draft.goal[0], draft.goal[1], FLOOR);

  const cell = (o) => [...o.cell];
  draft.pegs = (spec.pegs ?? []).map((p) => ({ ...p, cell: cell(p) }));
  draft.windmills = (spec.windmills ?? []).map((p) => ({ ...p, cell: cell(p) }));
  draft.pendulums = (spec.pendulums ?? []).map((p) => ({ ...p, cell: cell(p) }));
  draft.magnets = (spec.magnets ?? []).map((p) => ({ ...p, cell: cell(p) }));
  draft.buttons = (spec.buttons ?? []).map((p) => ({ ...p, cell: cell(p) }));
  draft.movers = (spec.movers ?? []).map((m) => ({ ...m, from: [...m.from], to: [...m.to] }));
  draft.teleports = (spec.teleports ?? []).map((t) => ({ a: [...t.a], b: [...t.b] }));
  draft.gates = (spec.gates ?? []).map((g) => ({ ...g, seg: g.seg.map((s) => [...s]) }));
  draft.lifts = (spec.lifts ?? []).map((l, i) => ({
    ...l,
    id: l.id ?? `lift${i + 1}`,
    mode: l.mode === 'raise' ? 'raise' : 'lower',
    seg: l.seg.map((s) => [...s]),
  }));
  draft.oneways = (spec.oneways ?? []).map((o) => ({ ...o, seg: o.seg.map((s) => [...s]), normal: [...(o.normal ?? [0, 1])] }));
  return draft;
}

/** Paint every cell of a rect (inclusive). */
export function paintRect(draft, [c0, r0, c1, r1], char) {
  const [x0, x1] = c0 <= c1 ? [c0, c1] : [c1, c0];
  const [y0, y1] = r0 <= r1 ? [r0, r1] : [r1, r0];
  for (let r = y0; r <= y1; r++) for (let c = x0; c <= x1; c++) setCell(draft, c, r, char);
}

export const newId = nextId;

// ---------------------------------------------------------------------------
//  Serialisation helpers
// ---------------------------------------------------------------------------

export function specToJson(spec) {
  return JSON.stringify(spec, null, 2);
}

/** A `LEVELS` entry the author can paste straight into src/engine/levels.js. */
export function specToSource(spec) {
  const s = spec;
  const rect = (r) => `[${r.join(', ')}]`;
  const lines = [];
  lines.push('  {');
  lines.push(`    id: '${s.id}',`);
  lines.push(`    name: ${JSON.stringify(s.name)},`);
  lines.push(`    shape: '${s.shape}',`);
  lines.push(`    difficulty: ${s.difficulty},`);
  lines.push(`    par: ${s.par},`);
  lines.push(`    hint: ${JSON.stringify(s.hint)},`);
  lines.push(`    board: { shape: '${s.board.shape}', w: ${s.board.w}, h: ${s.board.h} },`);
  if (s.walls.length) lines.push(`    walls: [${s.walls.map(rect).join(', ')}],`);
  if (s.carve?.length) lines.push(`    carve: [${s.carve.map(rect).join(', ')}],`);
  //  A single marble stays `spawn: [c, r]`; a multi-marble level lists them and carries the
  //  `multi` flag the headless suite uses to check that they are distinct and a marble apart.
  if (s.multi && Array.isArray(s.spawn[0])) {
    lines.push(`    spawn: [${s.spawn.map((p) => `[${p.join(', ')}]`).join(', ')}],`);
    lines.push('    multi: true, // every marble must reach the goal');
  } else {
    lines.push(`    spawn: [${s.spawn.join(', ')}],`);
  }
  lines.push(`    goal: [${s.goal.join(', ')}],`);
  if (s.pits.length) {
    lines.push('    pits: [');
    for (const p of s.pits) {
      if (Array.isArray(p)) lines.push(`      [${p.join(', ')}],`);
      else if (p.centers) {
        const chain = p.centers.map(([c, r]) => `[${c}, ${r}]`).join(', ');
        const extra = [p.radius ? `radius: ${p.radius}` : '', p.move ? `move: [${p.move.join(', ')}], speed: ${p.speed}` : ''].filter(Boolean).join(', ');
        lines.push(`      { centers: [${chain}]${extra ? `, ${extra}` : ''} },`);
      } else {
        const extra = [p.radius ? `radius: ${p.radius}` : '', p.move ? `move: [${p.move.join(', ')}], speed: ${p.speed}` : ''].filter(Boolean).join(', ');
        lines.push(`      { c: ${p.c}, r: ${p.r}${extra ? `, ${extra}` : ''} },`);
      }
    }
    lines.push('    ],');
  }
  // A material entry is a cell rect or a plate. Both are written as they are meant to be read:
  // whole cells as `[c0, r0, c1, r1]`, a plate as `{ rect: [...] }` in edge coordinates.
  const materialEntry = (e) => (Array.isArray(e) ? rect(e) : `{ rect: ${rect(e.rect)} }`);
  for (const [k] of [['ice'], ['sand'], ['steel']]) {
    if (s[k]?.length) lines.push(`    ${k}: [${s[k].map(materialEntry).join(', ')}],`);
  }
  if (s.belts.length) lines.push(`    belts: [${s.belts.map((b) => `{ rect: ${rect(b.rect)}, dir: [${b.dir.join(', ')}] }`).join(', ')}],`);
  if (s.vents.length) lines.push(`    vents: [${s.vents.map((b) => `{ rect: ${rect(b.rect)}, dir: [${b.dir.join(', ')}] }`).join(', ')}],`);
  if (s.pegs.length) lines.push(`    pegs: [${s.pegs.map((p) => `{ cell: [${p.cell.join(', ')}], r: ${p.r}${p.kick ? `, kick: ${p.kick}` : ''} }`).join(', ')}],`);
  if (s.windmills.length) {
    lines.push(`    windmills: [${s.windmills.map((m) => `{ cell: [${m.cell.join(', ')}], arms: ${m.arms}, len: ${m.len}, omega: ${m.omega} }`).join(', ')}],`);
  }
  if (s.pendulums.length) {
    lines.push(
      `    pendulums: [${s.pendulums.map((p) => `{ cell: [${p.cell.join(', ')}], len: ${p.len}, amp: ${p.amp}, freq: ${p.freq}, phase: ${p.phase} }`).join(', ')}],`,
    );
  }
  if (s.movers.length) {
    lines.push(
      `    movers: [${s.movers.map((m) => `{ from: [${m.from.join(', ')}], to: [${m.to.join(', ')}], len: ${m.len}, speed: ${m.speed}, phase: ${m.phase} }`).join(', ')}],`,
    );
  }
  if (s.magnets.length) {
    lines.push(`    magnets: [${s.magnets.map((m) => `{ cell: [${m.cell.join(', ')}], radius: ${m.radius}, strength: ${m.strength} }`).join(', ')}],`);
  }
  if (s.ramps.length) {
    lines.push(
      `    ramps: [${s.ramps.map((r) => `{ rect: ${rect(r.rect)}, dir: [${r.dir.join(', ')}], height: ${r.height} }`).join(', ')}],`,
    );
  }
  if (s.teleports.length) lines.push(`    teleports: [${s.teleports.map((t) => `{ a: [${t.a.join(', ')}], b: [${t.b.join(', ')}] }`).join(', ')}],`);
  if (s.buttons.length) {
    //  A plate may carry an `id` so a lift can name it; a plain plate→gate plate keeps the old
    //  shape and reads exactly as before.
    lines.push(
      `    buttons: [${s.buttons
        .map((b) => {
          const bits = [`cell: [${b.cell.join(', ')}]`];
          if (b.id) bits.unshift(`id: '${b.id}'`);
          if (b.gate) bits.push(`gate: '${b.gate}'`, `hold: ${b.hold}`);
          return `{ ${bits.join(', ')} }`;
        })
        .join(', ')}],`,
    );
  }
  if (s.gates.length) {
    lines.push(`    gates: [${s.gates.map((g) => `{ id: '${g.id}', seg: [[${g.seg[0].join(', ')}], [${g.seg[1].join(', ')}]] }`).join(', ')}],`);
  }
  if (s.lifts?.length) {
    lines.push(
      `    lifts: [${s.lifts
        .map((l) => `{ id: '${l.id}', seg: [[${l.seg[0].join(', ')}], [${l.seg[1].join(', ')}]], plate: '${l.plate}', mode: '${l.mode}'${l.speed ? `, speed: ${l.speed}` : ''} }`)
        .join(', ')}],`,
    );
  }
  if (s.oneways.length) {
    lines.push(
      `    oneways: [${s.oneways.map((o) => `{ seg: [[${o.seg[0].join(', ')}], [${o.seg[1].join(', ')}]], normal: [${o.normal.join(', ')}] }`).join(', ')}],`,
    );
  }
  if (s.openEdges) lines.push('    openEdges: true,');
  if (s.twoRoutes) lines.push('    twoRoutes: true,');
  if (s.movingPitVisual) lines.push('    movingPitVisual: true,');
  lines.push('  },');
  return lines.join('\n');
}
