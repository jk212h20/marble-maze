//  Board silhouette extraction.
//
//  The rendered board should be one continuous piece of wood, not a grid of tiles: that
//  is what makes the grain and the light run across it. So we walk the outline of the
//  cell union and hand back closed loops in board coordinates.
//
//  This lives in the engine (not the renderer) so tests can assert that every level
//  produces exactly one clean loop whose area matches its footprint.

import { chainCellDistance, chainDistance } from './levels.js';

export function insideFootprint(level, c, r) {
  if (c < 0 || r < 0 || c >= level.w || r >= level.h) return false;
  return level.grid[r][c] !== ' ';
}

const key = (x, z) => `${x},${z}`;

/** Closed outline loops of the footprint, as [ [x, z], ... ] in board coordinates. */
export function silhouetteLoops(level) {
  const edges = new Map();
  const add = (ax, az, bx, bz) => edges.set(key(ax, az), [bx, bz]);

  for (let r = 0; r < level.h; r++) {
    for (let c = 0; c < level.w; c++) {
      if (!insideFootprint(level, c, r)) continue;
      const x0 = c - level.w / 2;
      const x1 = x0 + 1;
      const z0 = r - level.h / 2;
      const z1 = z0 + 1;
      if (!insideFootprint(level, c, r - 1)) add(x0, z0, x1, z0);
      if (!insideFootprint(level, c + 1, r)) add(x1, z0, x1, z1);
      if (!insideFootprint(level, c, r + 1)) add(x1, z1, x0, z1);
      if (!insideFootprint(level, c - 1, r)) add(x0, z1, x0, z0);
    }
  }

  const loops = [];
  const seen = new Set();
  for (const [start, first] of edges) {
    if (seen.has(start)) continue;
    const loop = [];
    let cur = start;
    let next = first;
    let guard = 0;
    while (guard++ < 4 * (level.w + level.h) * (level.w + level.h) + 64) {
      seen.add(cur);
      const [x, z] = cur.split(',').map(Number);
      loop.push([x, z]);
      const nk = key(next[0], next[1]);
      if (nk === start) break;
      const nxt = edges.get(nk);
      if (!nxt) {
        loop.push([next[0], next[1]]);
        break;
      }
      cur = nk;
      next = nxt;
    }
    if (loop.length >= 4) loops.push(loop);
  }
  return loops;
}

export function loopArea(loop) {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const [x0, z0] = loop[i];
    const [x1, z1] = loop[(i + 1) % loop.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

/**
 * Shrink a closed loop inward by `d` (a miter offset), for shapes like the lid's collar
 * that have to follow the board outline at a fixed width. Works for either winding and
 * clamps the miter so a sharp corner cannot shoot a spike off to infinity.
 *
 * Returns the inset loop, or null if the offset would consume the shape.
 */
export function insetLoop(loop, d) {
  const n = loop.length;
  if (n < 3) return null;
  const winding = loopArea(loop) >= 0 ? 1 : -1; // inward is left-of-travel for CCW
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = loop[(i - 1 + n) % n];
    const cur = loop[i];
    const next = loop[(i + 1) % n];
    const normals = [edgeInwardNormal(prev, cur, winding), edgeInwardNormal(cur, next, winding)];
    let bx = normals[0][0] + normals[1][0];
    let by = normals[0][1] + normals[1][1];
    const len = Math.hypot(bx, by);
    if (len < 1e-9) return null; // a spike: the two edge normals cancel exactly
    bx /= len;
    by /= len;
    // The miter has to travel d / cos(half angle) along the bisector, so a corner that
    // folds back on itself would need an infinite offset - cap it instead.
    const cos = Math.max(0.4, bx * normals[0][0] + by * normals[0][1]);
    out.push([cur[0] + (bx * d) / cos, cur[1] + (by * d) / cos]);
  }
  // A negative `d` deliberately grows the shape (the lid's lip overhangs outward), so the
  // guard is not "did it get smaller" but "is it still a sane polygon of the same winding":
  // a flipped sign means the offset crossed itself and the shape is no longer usable.
  const before = loopArea(loop);
  const after = loopArea(out);
  if (!Number.isFinite(after) || Math.abs(after) < 1e-6 || Math.sign(after) !== Math.sign(before)) return null;
  // Direction check: a positive inset has to make the shape smaller. If it came out bigger,
  // the offset walked through the middle of the shape (which a symmetric rectangle survives
  // as a mirrored copy), so the polygon is no longer the one we asked for.
  const grew = Math.abs(after) > Math.abs(before);
  if (d > 0 && grew) return null;
  if (d < 0 && !grew) return null;
  return out;
}

/** Unit normal of edge a->b pointing into the polygon. */
function edgeInwardNormal(a, b, winding) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  return [(-dz / len) * winding, (dx / len) * winding];
}

export function footprintCellCount(level) {
  let n = 0;
  for (let r = 0; r < level.h; r++) {
    for (let c = 0; c < level.w; c++) if (insideFootprint(level, c, r)) n++;
  }
  return n;
}

/**
 * The round holes that must be cut out of the board slab: every pit and the goal cup.
 *
 * This lives in the engine, next to the outline, because it is a *contract*: the renderer
 * cuts exactly these, and the tests check that what is drawn is always at least as big as
 * what the physics uses to swallow the marble. That contract was broken once — the pits
 * were physically real but visually absent — which is how a player ends up falling into a
 * hole that is not there.
 */
export function slabHoles(level, goalHoleR) {
  const holes = [];
  for (const pit of level.pits) {
    const centers = pit.centers ?? [[pit.x, pit.z]];
    holes.push({
      kind: 'pit',
      index: pit.i,
      cell: pit.cell,
      x: pit.x,
      z: pit.z,
      r: pit.r,
      // A slot is *one* hole with a chain of centres: the union of the overlapping circles,
      // so it is cut, validated and dodged by the rose as a single rounded slot.
      centers,
      slot: centers.length > 1,
      moving: !!pit.move,
      capture: pit.r * (level.spec.pitCapture ?? 0.76),
    });
  }
  holes.push({
    kind: 'goal',
    cell: level.goal.cell,
    x: level.goal.x,
    z: level.goal.z,
    r: goalHoleR,
    centers: [[level.goal.x, level.goal.z]],
    slot: false,
    moving: false,
    capture: level.goal.r * (level.spec.goalCapture ?? 0.8),
  });
  return holes;
}

/** Anything wrong with the holes a level asks for, as human-readable reasons. */
export function holeProblems(level, goalHoleR) {
  const problems = [];
  const holes = slabHoles(level, goalHoleR);
  const cellOf = (x, z) => [Math.floor(x + level.w / 2), Math.floor(z + level.h / 2)];
  for (const h of holes) {
    // `r` is the half-width of the hole either way, so a slot must still fit its lane.
    if (h.r > 0.5) problems.push(`${h.kind} at ${h.cell} is wider than its cell (${h.r})`);
    if (!(h.capture < h.r)) {
      problems.push(`${h.kind} at ${h.cell} captures at ${h.capture.toFixed(3)} but is only drawn at ${h.r} — invisible trap`);
    }
    // The cup must sit on its cell. A pit may be authored anywhere, fractions included, so
    // for pits this is not a rule — where they sit is the author's business (see `centers`).
    if (h.kind === 'goal') {
      const [c, r] = cellOf(h.x, h.z);
      if (Math.abs(c + 0.5 - level.w / 2 - h.x) > 1e-6 || Math.abs(r + 0.5 - level.h / 2 - h.z) > 1e-6) {
        problems.push(`${h.kind} at ${h.cell} is not centred in its cell`);
      }
    }
    // A hole must not eat into a wall cell. A hole narrower than its lane cannot reach a
    // neighbour at all, so this only has anything to say once r is past half a cell — the
    // rule that has always kept a wide hole from quietly hollowing out a wall.
    if (h.r - 0.5 > 0) {
      const cellCenters = cellChainSpace(level, h.centers);
      for (const [c, r] of coveredCells(cellCenters, h.r)) {
        if (level.grid[r]?.[c] === '#') problems.push(`${h.kind} at ${h.cell} overlaps the wall cell ${c},${r}`);
      }
    }
  }
  // Holes must not overlap each other — except the pieces of one slot, which are the same
  // hole by construction.
  for (let i = 0; i < holes.length; i++) {
    for (let j = i + 1; j < holes.length; j++) {
      const sameSlot = holes[i].kind === 'pit' && holes[j].kind === 'pit' && holes[i].index === holes[j].index;
      if (sameSlot) continue;
      if (holesOverlap(holes[i], holes[j])) {
        problems.push(`holes at ${holes[i].cell} and ${holes[j].cell} overlap`);
      }
    }
  }
  return problems;
}

/**
 * A hole's centres in *cell space* (where an integer is a cell centre), so hole geometry can
 * be compared with the grid. `slabHoles` reports world coordinates.
 */
function cellChainSpace(level, centers) {
  return centers.map(([x, z]) => [x + level.w / 2 - 0.5, z + level.h / 2 - 0.5]);
}

/** The cells a hole of half-width `r` around a chain reaches, clipped to the board. */
function coveredCells(cellCenters, r) {
  const out = [];
  let c0 = Infinity;
  let c1 = -Infinity;
  let r0 = Infinity;
  let r1 = -Infinity;
  for (const [c, r_] of cellCenters) {
    c0 = Math.min(c0, c);
    c1 = Math.max(c1, c);
    r0 = Math.min(r0, r_);
    r1 = Math.max(r1, r_);
  }
  const span = Math.ceil(r + 1);
  for (let r_ = Math.floor(r0) - span; r_ <= Math.ceil(r1) + span; r_++) {
    for (let c = Math.floor(c0) - span; c <= Math.ceil(c1) + span; c++) {
      if (chainCellDistance(cellCenters, c, r_) <= r) out.push([c, r_]);
    }
  }
  return out;
}

/** Do two holes share any ground? Chains are compared piecewise. */
function holesOverlap(a, b) {
  const as = a.centers ?? [[a.x, a.z]];
  const bs = b.centers ?? [[b.x, b.z]];
  const d = chainDistance(as, bs[0][0], bs[0][1]);
  if (d < a.r + b.r) return true;
  for (let i = 1; i < bs.length; i++) {
    for (const [x, z] of [bs[i], [(bs[i - 1][0] + bs[i][0]) / 2, (bs[i - 1][1] + bs[i][1]) / 2]]) {
      if (chainDistance(as, x, z) < a.r + b.r) return true;
    }
  }
  for (let i = 1; i < as.length; i++) {
    for (const [x, z] of [as[i], [(as[i - 1][0] + as[i][0]) / 2, (as[i - 1][1] + as[i][1]) / 2]]) {
      if (chainDistance(bs, x, z) < a.r + b.r) return true;
    }
  }
  return false;
}
