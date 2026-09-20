//  Wood surfaces are all one field on the board plane.
//
//  Every piece of timber in the game - the slab, its routed hole bevels, its own edge, the raised
//  walls, the ramps - is cut from the same board, so every piece has to sample the same grain.
//  The slab's caps already did: ExtrudeGeometry builds cap UVs out of the shape's own
//  coordinates, and the shape is in board coordinates. Everything else was left with whatever
//  UVs its primitive came with. A CylinderGeometry funnel wraps its circumference into u and its
//  depth into v, so every hole showed a stretched, unrelated crop of the texture instead of the
//  wood that was routed out of it; the slab's own side walls sampled a single row of the tile,
//  smeared down the board's edge; and the ramp had no UV attribute at all, so it rendered as one
//  texel of flat colour.
//
//  Projecting each vertex straight down onto the board plane - uv = (x, -z), the slab cap's own
//  convention - fixes all three at once, and it is also why this works with a photograph or a
//  generated image without re-rendering one per level: nothing here asks where the holes are. A
//  point on a hole's bevel is directly below a point on the floor, so it gets that point's grain.
//  The grain runs down into the hole instead of stopping at the rim, and a plank joint that
//  crosses a hole shows as a line running down the inside of the wall, because every point on
//  that wall carries the joint's own coordinate.
//
//  The honest limit: this treats the wood as the same at every depth, so only lines that are
//  vertical in the board's frame survive - the grain goes straight down the wall. That is what a
//  routed edge in a plank looks like, and it is why the projection is enough rather than a
//  3D texture.

import * as THREE from 'three';

/**
 * Rewrite a wood geometry's UVs as board coordinates: uv = (x, -z).
 *
 * Works on indexed and non-indexed geometry alike, and adds the attribute when it is missing,
 * which is the case for the ramp wedges. Caps that are already in board coordinates come out
 * unchanged, so calling it on a whole extruded solid is safe.
 */
export function boardProjectUVs(geometry) {
  const position = geometry.attributes.position;
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    uv[i * 2] = position.getX(i);
    uv[i * 2 + 1] = -position.getZ(i);
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}
