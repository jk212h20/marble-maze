import polygonClipping from '../../vendor/polygon-clipping/polygon-clipping.esm.js';
import { holeRing } from './hole-ring.js';

//  Materials: which ground is ice, which is sand, which is steel — exactly.
//
//  A material arrives two ways:
//
//    * a CELL RECT painted onto the grid — `ice: [[4, 4, 11, 4]]` covers whole cells, and has
//      done since the first level. Unchanged, so shipped levels build bit-for-bit identically.
//    * a PLATE — `ice: [{ rect: [4, 4.5, 12, 5.5] }]` — a rectangle in cell-EDGE coordinates.
//      Edges, not centres, so an eighth of a cell is a legitimate boundary, exactly as authoring
//      a pit or an object at 3.125 is. Snap `whole cells` puts the edges on cell boundaries,
//      which is what the cell form means, so the two forms agree at whole-cell alignment.
//
//  Everything downstream needs the same answer — "is this ground ice?" — and the answer has to be
//  exact, because the *drawn* plate and the marble's *friction* must agree: a material drawn a
//  hair wider than it behaves is the same class of lie as an invisible hole. So a region is kept
//  as a lattice: the board rasterised at 1/8 of a cell, the finest thing the editor can author, on
//  which every authored rectangle lands exactly. Loops, voids and hole cuts all come off that one
//  representation instead of each re-deriving it.
//
//  This module is deliberately free of imports: it takes cell-space rectangles and hole chains and
//  returns cell-space geometry, so the engine, the renderer, the editor and the tests can all use
//  it without an import cycle. Coordinates are CELL SPACE throughout (cell (c, r) spans [c, c+1] on
//  each axis); the caller converts to board coordinates.

/** Authoring resolution: eighths of a cell. */
export const LATTICE = 8;

export const snap8 = (v) => Math.round(v * LATTICE) / LATTICE;

const toLattice = (v) => Math.round(v * LATTICE);

/**
 * A material region: the set of 1/8-cell squares the rectangles cover.
 * `rects` are cell-edge rectangles `[c0, r0, c1, r1]`; the order within a pair does not matter.
 */
export function makeRegion(w, h, rects = []) {
  const gw = w * LATTICE;
  const gh = h * LATTICE;
  const squares = new Set();
  for (const rect of rects) {
    const c0 = Math.max(0, toLattice(Math.min(rect[0], rect[2])));
    const c1 = Math.min(gw, toLattice(Math.max(rect[0], rect[2])));
    const r0 = Math.max(0, toLattice(Math.min(rect[1], rect[3])));
    const r1 = Math.min(gh, toLattice(Math.max(rect[1], rect[3])));
    for (let lj = r0; lj < r1; lj++) {
      for (let li = c0; li < c1; li++) squares.add(lj * gw + li);
    }
  }
  return { w, h, gw, gh, squares, rects };
}

/** Is a cell-space point over this material? */
export function regionHas(region, c, r) {
  const li = Math.floor(c * LATTICE);
  const lj = Math.floor(r * LATTICE);
  if (li < 0 || lj < 0 || li >= region.gw || lj >= region.gh) return false;
  return region.squares.has(lj * region.gw + li);
}

/** The area a region covers, in cells. */
export function regionArea(region) {
  return region.squares.size / (LATTICE * LATTICE);
}

const edgeKey = (x, z) => `${x},${z}`;

/**
 * Boundary loops of a region, as closed loops of cell-space points on the 1/8 lattice.
 *
 * The same walk as the board outline (silhouette.js): every square edge facing empty space, wound
 * so filled area is on one side. Outer boundaries and the boundaries of interior voids both come
 * out, which is what a shape with holes needs.
 */
export function regionLoops(region) {
  const { gw, gh, squares } = region;
  const filled = (li, lj) => li >= 0 && lj >= 0 && li < gw && lj < gh && squares.has(lj * gw + li);
  //  A point can have more than one outgoing boundary edge, so the walk keeps them all: two
  //  squares that touch only at a corner (a diagonal run of ice, say) both pass through it, and a
  //  single edge per point would silently make the walk wander off into nonsense.
  const outs = new Map();
  const add = (ax, az, bx, bz) => {
    const k = edgeKey(ax, az);
    const list = outs.get(k);
    if (list) list.push([bx, bz]);
    else outs.set(k, [[bx, bz]]);
  };
  const u = (v) => v / LATTICE; // lattice index -> cell-space coordinate

  for (const idx of squares) {
    const li = idx % gw;
    const lj = (idx - li) / gw;
    const x0 = u(li);
    const x1 = u(li + 1);
    const z0 = u(lj);
    const z1 = u(lj + 1);
    if (!filled(li, lj - 1)) add(x0, z0, x1, z0);
    if (!filled(li + 1, lj)) add(x1, z0, x1, z1);
    if (!filled(li, lj + 1)) add(x1, z1, x0, z1);
    if (!filled(li - 1, lj)) add(x0, z1, x0, z0);
  }

  //  East, South, West, North: clockwise, because r grows downwards like z.
  const DIRS = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  const dirOf = (dx, dz) => DIRS.findIndex(([x, z]) => Math.abs(x - dx) < 1e-9 && Math.abs(z - dz) < 1e-9);

  const loops = [];
  const used = new Set();
  const edgeId = (a, b) => `${a[0]},${a[1]}>${b[0]},${b[1]}`;
  for (const [startKey, ends] of outs) {
    const start = startKey.split(',').map(Number);
    for (const firstEnd of ends) {
      if (used.has(edgeId(start, firstEnd))) continue;
      const loop = [];
      let cur = start;
      let next = firstEnd;
      let guard = 0;
      while (guard++ < 8 * gw * gh + 64) {
        used.add(edgeId(cur, next));
        loop.push(cur);
        const dx = next[0] - cur[0];
        const dz = next[1] - cur[1];
        const ahead = (outs.get(edgeKey(next[0], next[1])) ?? []).filter((end) => !used.has(edgeId(next, end)));
        if (!ahead.length) {
          loop.push(next); // back at the start: the loop just closed
          break;
        }
        let pick = ahead[0];
        if (ahead.length > 1) {
          //  At a pinch, turn as far clockwise as the boundary allows: that keeps the walk on the
          //  square it came from instead of cutting the corner into the other one.
          const came = dirOf(dx, dz);
          let best = 9;
          for (const end of ahead) {
            const turn = (dirOf(end[0] - next[0], end[1] - next[1]) - came + 4) % 4;
            const k = turn === 0 ? 4 : turn; // straight on is the last resort, never the first
            if (k < best) {
              best = k;
              pick = end;
            }
          }
        }
        cur = next;
        next = pick;
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

/** Signed area of a loop, in cells. The sign is the winding. */
export function loopArea(loop) {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const [x0, z0] = loop[i];
    const [x1, z1] = loop[(i + 1) % loop.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

/** Is a cell-space point inside a closed loop? Ray casting. */
export function pointInLoop(loop, x, z) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, zi] = loop[i];
    const [xj, zj] = loop[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Group loops into shapes: each filled boundary, with the void boundaries inside it as holes. */
export function loopsToShapes(loops) {
  const outers = loops.filter((l) => loopArea(l) > 0);
  const voids = loops.filter((l) => loopArea(l) <= 0);
  const shapes = outers.map((outer) => ({ outer, voids: [] }));
  for (const loop of voids) {
    const hosts = shapes.filter((s) => pointInLoop(s.outer, loop[0][0], loop[0][1]));
    // A void belongs to the smallest filled boundary containing it, so nested rings nest.
    const host = hosts.sort((a, b) => Math.abs(loopArea(a.outer)) - Math.abs(loopArea(b.outer)))[0];
    if (host) host.voids.push(loop);
  }
  return shapes;
}

/**
 * The drawn geometry of one material: cell-space loops with every hole in it taken out.
 *
 * This is a true **boolean difference** between the material's own outline and the pit outlines,
 * not a path cut into a shape. It has to be, because a hole is not always inside the outline: a
 * pit straddling the edge of a material, or slicing clean through a one-cell strip of it, is a
 * notch in the outline (or two separate pieces of material), and a path crossing an outline is
 * not something a triangulator can have.
 *
 * The version this replaced removed whole 1/8-cell lattice squares around any hole that reached
 * the edge, which drew the material's edge around those pits as a **staircase at eighth-of-a-cell
 * steps** instead of the real arc. Nothing about the friction lattice changes here: the region's
 * own squares still say where the material is, and the plate is now drawn as exactly that region
 * with the holes in it removed.
 *
 * `holes` are `{ chain, r }` in cell space: one centre is a circle, a chain is a capsule. The ring
 * comes from `holeRing` — the same polygon the slab is cut with — so the material's edge and the
 * hole's wall are the same curve, to the last vertex.
 */
export function regionGeometry(region, holes = []) {
  const shapes = loopsToShapes(regionLoops(region));
  const original = regionArea(region);
  if (!shapes.length) return { shapes: [], cut: [], area: 0, original: 0, squares: region.squares };
  if (!holes.length) return { shapes, cut: [], area: original, original, squares: region.squares };

  const cutters = holes.map((hole) => [holeRing({ centers: hole.chain, r: hole.r })]);
  const result = polygonClipping.difference(
    shapes.map((s) => [s.outer, ...s.voids]),
    ...cutters,
  );
  const out = result
    .map((poly) => ({ outer: openRing(poly[0]), voids: poly.slice(1).map(openRing) }))
    .filter((s) => s.outer.length >= 3);

  //  Which holes actually reached this material. Asked of the geometry, not of the lattice: a
  //  hole that only touches squares the region already lacked is not a hole in *this* plate.
  const cut = [];
  holes.forEach((hole, i) => {
    if (holeReaches(shapes, hole)) cut.push(i);
  });

  return { shapes: out, cut, area: loopAreaOf(out), original, squares: region.squares };
}

/** Area of a set of shapes: outer loops minus their voids. */
function loopAreaOf(shapes) {
  return shapes.reduce(
    (sum, s) => sum + Math.abs(loopArea(s.outer)) - s.voids.reduce((v, loop) => v + Math.abs(loopArea(loop)), 0),
    0,
  );
}

/** A ring from the boolean library comes back closed; the rest of the pipeline closes its own. */
function openRing(ring) {
  const pts = ring.map(([x, z]) => [x, z]);
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first && last && Math.abs(first[0] - last[0]) < 1e-12 && Math.abs(first[1] - last[1]) < 1e-12) pts.pop();
  return pts;
}

/** Does a hole overlap any of these shapes at all? */
function holeReaches(shapes, hole) {
  const ring = holeRing({ centers: hole.chain, r: hole.r });
  //  A vertex of the ring inside the shape, or a vertex of the shape inside the ring: either way
  //  they overlap. Both tests are exact for the shapes this produces (no crossing without a
  //  containment on one side or the other that these two probes would see).
  for (const s of shapes) {
    for (const [x, z] of ring) {
      if (pointInLoop(s.outer, x, z) && !s.voids.some((v) => pointInLoop(v, x, z))) return true;
    }
    for (const [x, z] of s.outer) {
      //  `pointInLoop` closes its own walk, so a ring without a repeated first point is fine.
      if (pointInLoop(ring, x, z)) return true;
    }
  }
  return false;
}
