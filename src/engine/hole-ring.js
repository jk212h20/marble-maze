//  The region a pit — or a slot — really is, as a closed ring of points.
//
//  A round pit is a single arc. A **slot** is a chain of centres, and its outline is that chain
//  swept by the radius: both sides offset, a round join at every bend, and a half-circle at each
//  end. That is exactly the region the physics swallows the marble in (see `pitDistance` in
//  `levels.js`), so the hole that is drawn and the trap that is felt are the same region — the
//  project does not allow a hole to be an invisible trap, and "the union of overlapping circles"
//  is only the same thing when the centres are close enough to overlap.
//
//  Every arc here is emitted as a **polyline** whose vertices sit exactly on the arc, with the
//  facet length chosen from the radius (`MAX_CHORD`). That is deliberate, and it replaced
//  `Path.absarc`: the tessellation of a curve is decided by the geometry builder, and every
//  builder in the renderer asked for `curveSegments: 4`, so a pit's circle came out as an
//  **octagon** — the hole read as a straight-sided polygon, not a hole. Emitting the arc here
//  puts the resolution under our control (the same choice `flatRing` makes for the rose) and
//  gives one polygon that the slab cut, the material cut and the mouth mesh all share exactly.
//
//  It lives in the engine, next to the trap it mirrors, because the renderer is not the only
//  thing that needs it: a material plate is cut with the same ring, by a boolean difference, and a
//  hole's funnel is a band lofted between the ring at its mouth radius and the ring at its throat
//  (`holeRingPair` — one walk of the boundary, two radii, matching vertices).
//
//  Everything here is pure points — no THREE, no canvas — so it is testable headlessly.

import polygonClipping from '../../vendor/polygon-clipping/polygon-clipping.esm.js';

const EPS = 1e-9;

/**
 * Longest facet allowed on a hole's arc, in board units.
 *
 * One cell is about 385 screen px at the closest the game ever gets to a pit (the browser
 * close-up used to check this), so 0.03 is ~11 px of chord and a sagitta of 0.0003 — a third
 * of a pixel. Anything finer is invisible; anything coarser starts to read as a facet on the
 * rim, which is what the slab's brass lip and the pit mouth are seen against.
 */
export const MAX_CHORD = 0.03;

/** Facets for a full circle of this radius. */
function circleSteps(r) {
  return Math.max(8, Math.min(512, Math.ceil((Math.PI * 2 * r) / MAX_CHORD)));
}

/**
 * Walk an arc, `a0` → `a1`, in the direction the arc is meant to be walked (three's
 * `absarc(..., clockwise)` convention: a clockwise arc sweeps with a *decreasing* angle).
 * Endpoints are included; a caller that continues with a `lineTo` should drop the last one.
 *
 * Emitted as *units*, not points: `(bx, bz)` is the centre the arc turns about and `(ux, uz)` is
 * the unit direction the point lies in, so the point is `(bx + r*ux, bz + r*uz)`. Every point of
 * an outline is generated that way — an arc sample, a straight-run offset or a bend's inner
 * corner all scale linearly with the radius — and keeping the base and direction means one walk
 * can be evaluated at two radii with the *same* vertices (see `holeRingPair`).
 */
function arcUnits(cx, cz, r, a0, a1, into) {
  let delta = a1 - a0;
  if (delta > 0) delta -= Math.PI * 2; // clockwise, as every arc in this walk is
  const steps = Math.max(1, Math.ceil((Math.abs(delta) / (Math.PI * 2)) * circleSteps(r)));
  for (let i = 1; i <= steps; i++) {
    const a = a0 + delta * (i / steps);
    into(cx, cz, Math.cos(a), Math.sin(a));
  }
}

/**
 * The outline of a hole, as a closed ring of `{bx, bz, ux, uz}` units.
 * `hole` may be a round pit (`{x, z, r}`) or a slot (`{centers: [[x, z], ...], r}`).
 * The tessellation is chosen from `hole.r`, the widest radius this outline is ever drawn at.
 */
function holeRingUnits(hole) {
  const centers = hole.centers?.length ? hole.centers : [[hole.x, hole.z]];
  const r = hole.r;
  const units = [];
  const push = (bx, bz, ux, uz) => units.push({ bx, bz, ux, uz });

  if (centers.length === 1 || !(r > 0)) {
    const [cx, cz] = centers[0];
    // Start at angle 0 and sweep a full turn clockwise, so the ring's first point matches the
    // arc's and the winding matches the hole this replaced.
    push(cx, cz, 1, 0);
    arcUnits(cx, cz, r, 0, -Math.PI * 2, push);
    units.pop(); // that sweep closed back on the ring's own first point
    return units;
  }

  // One side of the swept chain: straight runs, then at each bend either a round join (the
  // outward side of the turn — an arc of radius r) or a sharp inner corner (the inward side,
  // where the two offset lines cross short of the vertex). Getting this right is what makes
  // the drawn slot the same region the marble falls into: an arc on the inward side would
  // scoop a bite out of the trap, and a hole smaller than its trap is exactly what this
  // project refuses.
  const side = (list) => {
    const normals = [];
    const dirs = [];
    for (let i = 1; i < list.length; i++) {
      const dx = list[i][0] - list[i - 1][0];
      const dz = list[i][1] - list[i - 1][1];
      const d = Math.hypot(dx, dz) || 1;
      dirs.push([dx / d, dz / d]);
      normals.push([-dz / d, dx / d]);
    }
    const aStart = Math.atan2(normals[0][1], normals[0][0]);
    let a = aStart;
    push(list[0][0], list[0][1], Math.cos(a), Math.sin(a));
    for (let i = 0; i < list.length - 1; i++) {
      const V = list[i + 1];
      if (i === list.length - 2) {
        push(V[0], V[1], Math.cos(a), Math.sin(a));
        break;
      }
      const n0 = normals[i];
      const n1 = normals[i + 1];
      const d0 = dirs[i];
      const d1 = dirs[i + 1];
      // Turning towards this side puts this side on the inside of the bend, where the two
      // offset lines cross: this run stops at their intersection, not at the vertex, or the
      // outline would spike into the region it is supposed to bound. Turning away puts this
      // side on the outside, where the boundary is the arc of the disc sitting on the vertex.
      const turn = d0[0] * d1[1] - d0[1] * d1[0];
      // The sweep is the turn *angle*, not its sine: the cross product only decides which way
      // the bend goes and whether this side is the inside of it.
      const turnAngle = Math.atan2(turn, d0[0] * d1[0] + d0[1] * d1[1]);
      if (turn > EPS) {
        // The corner point is `V + r*(n0 + d0*t/r)`: the parameter is independent of the radius,
        // so the direction alone carries it and the same vertex serves any radius.
        const wx = n1[0] - n0[0];
        const wz = n1[1] - n0[1];
        const t = (wx * d1[1] - wz * d1[0]) / turn;
        push(V[0], V[1], n0[0] + d0[0] * t, n0[1] + d0[1] * t);
        a = Math.atan2(n1[1], n1[0]);
      } else if (turn < -EPS) {
        push(V[0], V[1], Math.cos(a), Math.sin(a));
        arcUnits(V[0], V[1], r, a, a + turnAngle, push);
        a += turnAngle;
      } else {
        push(V[0], V[1], Math.cos(a), Math.sin(a));
      }
    }
    return { a, aStart };
  };

  const forward = side(centers);
  const end = centers[centers.length - 1];
  // The end cap, from this side's normal round the back of the chain to the other side's.
  arcUnits(end[0], end[1], r, forward.a, forward.a - Math.PI, push);
  side([...centers].reverse());
  // The start cap runs from the first segment's right normal round the back of the chain to
  // its left normal, which is where the outline began: that closes the loop.
  const start = centers[0];
  const tail = [];
  arcUnits(start[0], start[1], r, forward.aStart - Math.PI, forward.aStart - Math.PI * 2, (bx, bz, ux, uz) => tail.push({ bx, bz, ux, uz }));
  // The last point of the start cap is the ring's first point again: drop it, so the caller
  // gets a ring with no repeated vertex.
  for (let i = 0; i < tail.length - 1; i++) push(tail[i].bx, tail[i].bz, tail[i].ux, tail[i].uz);
  return units;
}

/**
 * The outline of a hole as a closed ring of points in the caller's own coordinates, at `radius`
 * (default: the hole's own mouth radius). Winding is clockwise (negative signed area).
 */
export function holeRing(hole, radius = hole.r) {
  return holeRingUnits(hole).map(({ bx, bz, ux, uz }) => [bx + ux * radius, bz + uz * radius]);
}

/**
 * The same hole outline at two radii, as loops with **matching vertices**: `outer` at `hole.r`,
 * `inner` at `radiusInner`.
 *
 * A routed hole's wall is a band between those two loops, and a band only closes without seams or
 * a twist if vertex *i* of one loop is the same place on the outline as vertex *i* of the other.
 * Generating both from one walk of `holeRingUnits` is what guarantees that, at any radius ratio
 * and through a bend's inner corner where the two loops are not a constant normal offset of each
 * other. This is the geometry a single funnel is lofted from — one band round the whole slot,
 * inner and outer radius together — rather than a funnel per centre, which leaves a row of
 * overlapping rims along a multi-centre slot.
 */
export function holeRingPair(hole, radiusInner) {
  const units = holeRingUnits(hole);
  const at = (radius) => units.map(({ bx, bz, ux, uz }) => [bx + ux * radius, bz + uz * radius]);
  return { outer: at(hole.r), inner: at(radiusInner) };
}

// ---------------------------------------------------------------------------
//  Combining holes that overlap
//
//  One slot already draws as one region (see `holeRingPair`). Two *separate* pits whose swept
//  areas overlap are the same problem one level up: stamped independently they draw two rims
//  across ground they share, so the board looks like it has two overlapping holes instead of
//  the one hole it really has. The regions are unioned here so the rim runs round the combined
//  outside only — in the slab cut, the material cut, the funnel and the plan view alike.
// ---------------------------------------------------------------------------

const sameCell = (a, b) => Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12;

/** A ring as polygon-clipping wants it: closed, with the first point repeated at the end. */
const closeRing = (ring) => [...ring, ring[0]];

/** The reverse: drop the repeated closing point so the pipeline closes its own rings. */
function openRing(ring) {
  const out = ring.map(([x, z]) => [x, z]);
  while (out.length > 1 && sameCell(out[0], out[out.length - 1])) out.pop();
  return out;
}

/** Shoelace area of a closed ring; the sign says which way it winds. */
export function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % ring.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

/** Distance from a point to a hole's chain of centres (one centre is a circle). */
function chainDistance(centers, px, pz) {
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

const centersOf = (hole) => hole.centers?.length ? hole.centers : [[hole.x, hole.z]];

/** Do two holes' drawn regions share any ground at all? */
export function holesOverlap(a, b) {
  const as = centersOf(a);
  const bs = centersOf(b);
  const rr = a.r + b.r;
  for (let i = 0; i < bs.length; i++) {
    const samples = i === 0 ? [bs[0]] : [bs[i], [(bs[i - 1][0] + bs[i][0]) / 2, (bs[i - 1][1] + bs[i][1]) / 2]];
    for (const [x, z] of samples) if (chainDistance(as, x, z) < rr - 1e-9) return true;
  }
  for (let i = 0; i < as.length; i++) {
    const samples = i === 0 ? [as[0]] : [as[i], [(as[i - 1][0] + as[i][0]) / 2, (as[i - 1][1] + as[i][1]) / 2]];
    for (const [x, z] of samples) if (chainDistance(bs, x, z) < rr - 1e-9) return true;
  }
  return false;
}

/**
 * Group holes into the regions they really are: a run of holes that touch (transitively) is one
 * region, everything else is a region of its own. A single hole comes back as a one-item group,
 * which is the caller's signal to draw it exactly as it always was.
 */
export function holeClusters(holes) {
  const groups = [];
  for (const hole of holes) {
    const touching = groups.filter((g) => g.some((h) => holesOverlap(h, hole)));
    if (!touching.length) {
      groups.push([hole]);
      continue;
    }
    const merged = [hole, ...touching.flat()];
    for (const g of touching) groups.splice(groups.indexOf(g), 1);
    groups.push(merged);
  }
  return groups;
}

/**
 * The union of a set of holes, as loops wound the way `holeRing` winds (clockwise, negative
 * area): one `outer` per connected piece, plus any `voids` enclosed inside it.
 *
 * A single hole returns its own ring unchanged — bit for bit, so a round pit or a slot that is
 * already one region must not move. Overlapping holes become the single region they really are,
 * which is what lets the rim run round the combined outside only.
 */
export function combineHoleRings(holes) {
  if (!holes.length) return [];
  if (holes.length === 1) return [{ outer: holeRing(holes[0]), voids: [] }];
  const merged = polygonClipping.union(...holes.map((hole) => [closeRing(holeRing(hole))]));
  return merged
    .map((poly) => {
      const loops = poly.map(openRing).map((ring) => (ringArea(ring) > 0 ? ring.reverse() : ring));
      return { outer: loops[0], voids: loops.slice(1) };
    })
    .filter((piece) => piece.outer.length >= 3);
}

/**
 * A ring pulled *inward* by a constant `d` — toward the region it bounds — keeping its winding
 * and its vertex count. A clockwise ring keeps its inside on the right of the travel direction,
 * so each edge is pushed along its right normal and neighbouring edges meet at their new
 * intersection. This is how a combined hole gets the throat its funnel drops to: the union's own
 * outline, one board thickness in, the way a single hole's throat was already built.
 */
export function offsetRing(ring, d) {
  const n = ring.length;
  if (!(d > 0) || n < 3) return ring;
  const unit = ([dx, dz]) => {
    const len = Math.hypot(dx, dz) || 1;
    return [dx / len, dz / len];
  };
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = ring[(i - 1 + n) % n];
    const c = ring[i];
    const q = ring[(i + 1) % n];
    const d1 = unit([c[0] - p[0], c[1] - p[1]]);
    const d2 = unit([q[0] - c[0], q[1] - c[1]]);
    const n1 = [d1[1], -d1[0]];
    const n2 = [d2[1], -d2[0]];
    const turn = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(turn) < 1e-9) {
      out.push([c[0] + n1[0] * d, c[1] + n1[1] * d]);
      continue;
    }
    // Intersection of this edge's offset line with the next one's, both `d` inside the ring.
    const wx = n2[0] - n1[0];
    const wz = n2[1] - n1[1];
    const s = (-d * (wx * d2[1] - wz * d2[0])) / turn;
    out.push([c[0] + n1[0] * d + d1[0] * s, c[1] + n1[1] * d + d1[1] * s]);
  }
  return out;
}

