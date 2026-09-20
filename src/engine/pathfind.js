//  Navigability graph over level cells.
//
//  Used by the tests to prove a level is solvable, and by the in-game demo autopilot.
//  Pits and walls block; every interactive floor type is walkable, and the pads of a
//  teleport pair are linked to each other. Gates and lift walls are assumed openable - a
//  gate has a plate that opens it, and a lift slab can be raised or lowered by one - so a
//  route found here is the route a marble is meant to be able to take, not necessarily one
//  that is open at this instant.

import { WALL, FLOOR, PIT, ICE, SAND, STEEL, BELT, VENT, PAD, PLATE, SPAWN, GOAL, OUTSIDE, isPitCell } from './levels.js';

const BLOCKED = new Set([WALL, OUTSIDE, PIT]);

export function cellKey(c, r) {
  return `${c},${r}`;
}

export function isWalkable(level, c, r) {
  if (c < 0 || r < 0 || c >= level.w || r >= level.h) return false;
  // A pit over a material keeps the material in the grid (so the drawn plate can be cut rather
  // than erased), so the pit mask is what says "blocked", not the character alone.
  if (isPitCell(level, c, r)) return false;
  return !BLOCKED.has(level.grid[r][c]);
}

function neighboursWith(level, c, r) {
  const out = [];
  const push = (nc, nr) => {
    if (isWalkable(level, nc, nr)) out.push([nc, nr]);
  };
  push(c + 1, r);
  push(c - 1, r);
  push(c, r + 1);
  push(c, r - 1);
  // Teleport pads short-circuit the maze.
  const ch = level.grid[r]?.[c];
  if (ch === PAD) {
    for (const pad of level.features.pads) {
      const isA = Math.floor(pad.a.x + level.w / 2) === c && Math.floor(pad.a.z + level.h / 2) === r;
      const isB = Math.floor(pad.b.x + level.w / 2) === c && Math.floor(pad.b.z + level.h / 2) === r;
      if (isA) push(Math.floor(pad.b.x + level.w / 2), Math.floor(pad.b.z + level.h / 2));
      if (isB) push(Math.floor(pad.a.x + level.w / 2), Math.floor(pad.a.z + level.h / 2));
    }
  }
  return out;
}

/** Breadth-first reachable set from a cell. Returns Map(key -> predecessor key). */
export function flood(level, start) {
  const prev = new Map();
  const startKey = cellKey(start[0], start[1]);
  if (!isWalkable(level, start[0], start[1])) return prev;
  prev.set(startKey, null);
  const queue = [start];
  while (queue.length) {
    const [c, r] = queue.shift();
    for (const [nc, nr] of neighboursWith(level, c, r)) {
      const k = cellKey(nc, nr);
      if (prev.has(k)) continue;
      prev.set(k, cellKey(c, r));
      queue.push([nc, nr]);
    }
  }
  return prev;
}

/** Shortest cell path from one cell to another, or null. */
export function cellPath(level, from, to) {
  const prev = flood(level, from);
  const target = cellKey(to[0], to[1]);
  if (!prev.has(target)) return null;
  const path = [];
  let k = target;
  while (k) {
    const [c, r] = k.split(',').map(Number);
    path.push([c, r]);
    k = prev.get(k);
  }
  return path.reverse();
}

export function cellCenter(level, c, r) {
  return [c + 0.5 - level.w / 2, r + 0.5 - level.h / 2];
}

export function worldToCell(level, x, z) {
  return [Math.floor(x + level.w / 2), Math.floor(z + level.h / 2)];
}

/** Cell path expressed as board-space waypoints, plus the goal itself at the end. */
export function waypoints(level, from, to) {
  const path = cellPath(level, from, to);
  if (!path) return null;
  const pts = path.map(([c, r]) => cellCenter(level, c, r));
  pts[pts.length - 1] = [level.goal.x, level.goal.z];
  return pts;
}

export function reachable(level, from, to) {
  return cellPath(level, from, to) !== null;
}

export function walkableCells(level) {
  const cells = [];
  for (let r = 0; r < level.h; r++) {
    for (let c = 0; c < level.w; c++) if (isWalkable(level, c, r)) cells.push([c, r]);
  }
  return cells;
}

export const CHARS = { WALL, FLOOR, PIT, ICE, SAND, STEEL, BELT, VENT, PAD, PLATE, SPAWN, GOAL, OUTSIDE };
