//  Hole outlines for the board: the shape the slab is cut with, the shape a material plate has
//  taken out of it, and the shape the shaft and the moving well follow.
//
//  The region itself — a circle, or a chain swept by the radius — is built by `holeRing` in
//  `src/engine/hole-ring.js`, next to the capture test it has to agree with; this file is only
//  the THREE adapter over it, so the renderer and the tests share one polygon.
//
//  This lives outside `scene.js` so it can be tested without a GPU: `tests/slots.test.js` checks
//  that the outline closes, stays within the chain's reach, and comes out the winding the slab
//  holes need.

export {
  holeRing,
  holeRingPair,
  MAX_CHORD,
  combineHoleRings,
  holeClusters,
  holesOverlap,
  offsetRing,
  ringArea,
} from '../engine/hole-ring.js';

import { holeRing } from '../engine/hole-ring.js';

/**
 * Build a hole's outline into `path` (a THREE.Path or THREE.Shape), at `radius` (default: the
 * hole's own mouth radius).
 * `hole` may be a round pit (`{x, z, r}`) or a slot (`{centers: [[x, z], ...], r}`), in the
 * coordinates of whatever space the caller draws in.
 */
export function holeOutline(THREE, hole, path = new THREE.Path(), radius = hole.r) {
  const pts = holeRing(hole, radius);
  pts.forEach(([x, z], i) => (i === 0 ? path.moveTo(x, z) : path.lineTo(x, z)));
  path.closePath();
  return path;
}

/** The same outline as a filled shape, for a mouth mesh or a shaft cap, at an optional radius. */
export function holeShape(THREE, hole, radius = hole.r) {
  const shape = new THREE.Shape();
  holeOutline(THREE, hole, shape, radius);
  return shape;
}

