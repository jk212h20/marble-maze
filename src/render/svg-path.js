//  A minimal SVG path reader, enough to turn a letterform into real geometry.
//
//  The marble lab embeds three-dimensional symbols inside glass balls, and the honest way to
//  do that is to extrude the *actual* outline of the symbol rather than wrap a picture of it
//  around a sphere. SVG is how those outlines are published (the Bitcoin mark is a Wikimedia
//  path), so this module reads the subset of the path grammar those marks use and hands back
//  THREE.Shape objects an ExtrudeGeometry can eat.
//
//  Supported: M/m L/l H/h V/v C/c S/s Q/q T/t A/a Z/z. Curves and arcs are flattened to
//  polylines on the way in. If a fresh mark ever needs something stranger, extend it here.
//
//  Holes: an SVG glyph may draw its counters (the two enclosed spaces in a "B") as separate
//  subpaths. `shapesFromSubpaths` puts the largest subpath forward as the outline and nests
//  every other subpath inside it as a hole, which is what ExtrudeGeometry wants.

import * as THREE from 'three';

const TOKEN = /[a-zA-Z]|[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g;
const CURVE_STEPS = 14; // per cubic/quadratic segment; small marks, so this is plenty
const ARC_STEPS = 24; // per full ellipse

/**
 * Read a path `d` string into subpaths of flattened [x, y] points.
 *
 * @returns {Array<{ points: Array<[number, number]>, closed: boolean }>}
 */
export function parsePathData(d) {
  const tokens = String(d).match(TOKEN) ?? [];
  let i = 0;
  const has = () => i < tokens.length;
  const isCmd = (t) => /^[a-zA-Z]$/.test(t);
  const num = () => Number(tokens[i++]);
  const numOr = (fallback) => (has() && !isCmd(tokens[i]) ? num() : fallback);

  const subpaths = [];
  let cur = null;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastCtrl = null; // previous cubic control point, absolute, for S/s
  let lastQCtrl = null; // previous quadratic control point, absolute, for T/t
  let cmd = '';

  const ensure = () => {
    if (!cur) {
      cur = { points: [[x, y]], closed: false };
      subpaths.push(cur);
    }
  };
  const moveTo = (X, Y) => {
    x = X;
    y = Y;
    sx = X;
    sy = Y;
    cur = { points: [[X, Y]], closed: false };
    subpaths.push(cur);
    lastCtrl = null;
    lastQCtrl = null;
  };
  const lineTo = (X, Y) => {
    ensure();
    cur.points.push([X, Y]);
    x = X;
    y = Y;
    lastCtrl = null;
    lastQCtrl = null;
  };
  const cubicTo = (c1x, c1y, c2x, c2y, X, Y) => {
    ensure();
    const x0 = x;
    const y0 = y;
    for (let s = 1; s <= CURVE_STEPS; s++) {
      const t = s / CURVE_STEPS;
      const u = 1 - t;
      const a = u * u * u;
      const b = 3 * u * u * t;
      const c = 3 * u * t * t;
      const e = t * t * t;
      cur.points.push([a * x0 + b * c1x + c * c2x + e * X, a * y0 + b * c1y + c * c2y + e * Y]);
    }
    x = X;
    y = Y;
    lastCtrl = [c2x, c2y];
    lastQCtrl = null;
  };
  const quadTo = (c1x, c1y, X, Y) => {
    ensure();
    const x0 = x;
    const y0 = y;
    for (let s = 1; s <= CURVE_STEPS; s++) {
      const t = s / CURVE_STEPS;
      const u = 1 - t;
      const a = u * u;
      const b = 2 * u * t;
      const c = t * t;
      cur.points.push([a * x0 + b * c1x + c * X, a * y0 + b * c1y + c * Y]);
    }
    x = X;
    y = Y;
    lastQCtrl = [c1x, c1y];
    lastCtrl = null;
  };
  const arcTo = (rx, ry, rot, largeArc, sweep, X, Y) => {
    ensure();
    if (rx === 0 || ry === 0) {
      lineTo(X, Y);
      return;
    }
    const phi = (rot * Math.PI) / 180;
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);
    const dx = (x - X) / 2;
    const dy = (y - Y) / 2;
    const x1p = cosP * dx + sinP * dy;
    const y1p = -sinP * dx + cosP * dy;
    let arx = Math.abs(rx);
    let ary = Math.abs(ry);
    const lambda = (x1p * x1p) / (arx * arx) + (y1p * y1p) / (ary * ary);
    if (lambda > 1) {
      const k = Math.sqrt(lambda);
      arx *= k;
      ary *= k;
    }
    const sign = largeArc === sweep ? -1 : 1;
    const numer = arx * arx * ary * ary - arx * arx * y1p * y1p - ary * ary * x1p * x1p;
    const denom = arx * arx * y1p * y1p + ary * ary * x1p * x1p;
    const co = sign * Math.sqrt(Math.max(0, numer / denom));
    const cxp = (co * arx * y1p) / ary;
    const cyp = (-co * ary * x1p) / arx;
    const cx = cosP * cxp - sinP * cyp + (x + X) / 2;
    const cy = sinP * cxp + cosP * cyp + (y + Y) / 2;
    const angle = (ux, uy, vx, vy) => {
      const dot = ux * vx + uy * vy;
      const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
      const a = Math.acos(Math.min(1, Math.max(-1, dot / (len || 1))));
      return ux * vy - uy * vx < 0 ? -a : a;
    };
    const theta = angle(1, 0, (x1p - cxp) / arx, (y1p - cyp) / ary);
    let delta = angle((x1p - cxp) / arx, (y1p - cyp) / ary, (-x1p - cxp) / arx, (-y1p - cyp) / ary);
    if (!sweep && delta > 0) delta -= Math.PI * 2;
    if (sweep && delta < 0) delta += Math.PI * 2;
    const steps = Math.max(2, Math.ceil((Math.abs(delta) / (Math.PI * 2)) * ARC_STEPS));
    for (let s = 1; s <= steps; s++) {
      const t = theta + (delta * s) / steps;
      const ex = arx * Math.cos(t);
      const ey = ary * Math.sin(t);
      cur.points.push([cosP * ex - sinP * ey + cx, sinP * ex + cosP * ey + cy]);
    }
    x = X;
    y = Y;
    lastCtrl = null;
    lastQCtrl = null;
  };

  while (has()) {
    if (isCmd(tokens[i])) cmd = tokens[i++];
    else {
      // A command letter is optional between coordinate sets. After an M this becomes an L.
      if (cmd === 'M') cmd = 'L';
      else if (cmd === 'm') cmd = 'l';
    }
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case 'M': {
        const X = numOr(0) + (rel ? x : 0);
        const Y = numOr(0) + (rel ? y : 0);
        moveTo(X, Y);
        break;
      }
      case 'L': lineTo(numOr(0) + (rel ? x : 0), numOr(0) + (rel ? y : 0)); break;
      case 'H': lineTo(numOr(0) + (rel ? x : 0), y); break;
      case 'V': lineTo(x, numOr(0) + (rel ? y : 0)); break;
      case 'C': {
        const c1x = numOr(0) + (rel ? x : 0);
        const c1y = numOr(0) + (rel ? y : 0);
        const c2x = numOr(0) + (rel ? x : 0);
        const c2y = numOr(0) + (rel ? y : 0);
        cubicTo(c1x, c1y, c2x, c2y, numOr(0) + (rel ? x : 0), numOr(0) + (rel ? y : 0));
        break;
      }
      case 'S': {
        const c1x = lastCtrl ? 2 * x - lastCtrl[0] : x;
        const c1y = lastCtrl ? 2 * y - lastCtrl[1] : y;
        const c2x = numOr(0) + (rel ? x : 0);
        const c2y = numOr(0) + (rel ? y : 0);
        cubicTo(c1x, c1y, c2x, c2y, numOr(0) + (rel ? x : 0), numOr(0) + (rel ? y : 0));
        break;
      }
      case 'Q': {
        const c1x = numOr(0) + (rel ? x : 0);
        const c1y = numOr(0) + (rel ? y : 0);
        quadTo(c1x, c1y, numOr(0) + (rel ? x : 0), numOr(0) + (rel ? y : 0));
        break;
      }
      case 'T': {
        const c1x = lastQCtrl ? 2 * x - lastQCtrl[0] : x;
        const c1y = lastQCtrl ? 2 * y - lastQCtrl[1] : y;
        quadTo(c1x, c1y, numOr(0) + (rel ? x : 0), numOr(0) + (rel ? y : 0));
        break;
      }
      case 'A': {
        const rx = numOr(0);
        const ry = numOr(0);
        const rot = numOr(0);
        const large = numOr(0);
        const sweep = numOr(0);
        arcTo(rx, ry, rot, !!large, !!sweep, numOr(0) + (rel ? x : 0), numOr(0) + (rel ? y : 0));
        break;
      }
      case 'Z':
        if (cur) cur.closed = true;
        x = sx;
        y = sy;
        lastCtrl = null;
        lastQCtrl = null;
        break;
      default:
        // Unknown command: skip its coordinate run rather than spinning forever.
        while (has() && !isCmd(tokens[i])) i++;
        break;
    }
  }
  return subpaths.filter((s) => s.points.length >= 2);
}

/** Twice the signed area of a closed polygon. Positive is counter-clockwise in a y-up frame. */
export function polygonArea(points) {
  let a = 0;
  for (let i = 0, n = points.length; i < n; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % n];
    a += x0 * y1 - x1 * y0;
  }
  return a;
}

/** Is a point inside a polygon? Ray casting, no winding assumptions. */
export function pointInPolygon([px, py], points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Nest subpaths into shapes with holes, and centre them on their own bounding box.
 *
 * SVG y grows downward; the caller flips the shape when it rotates it into place, so this
 * keeps the source orientation and only recentres and rescales.
 *
 * @param {Array<{points: Array<[number,number]>}>} subpaths
 * @param {{ size?: number, flipY?: boolean }} [opts]
 *   `size` scales the longest side of the whole mark to that many units.
 * @returns {{ shapes: THREE.Shape[], width: number, height: number, subpaths: Array<Array<[number,number]>> }}
 */
export function shapesFromSubpaths(subpaths, { size = 1, flipY = true } = {}) {
  const kept = subpaths;
  if (!kept.length) return { shapes: [], width: 0, height: 0, subpaths: [] };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { points } of kept) {
    for (const [px, py] of points) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const scale = size / Math.max(w, h);
  const sx = -((minX + maxX) / 2) * scale;
  const sy = -((minY + maxY) / 2) * scale * (flipY ? -1 : 1);

  const placed = kept
    .map(({ points }) => points.map(([px, py]) => [px * scale + sx, (flipY ? -py : py) * scale + sy]))
    .filter((points) => points.length >= 3);

  // Largest absolute area is the outline; anything that sits inside it is a counter.
  const ranked = placed
    .map((points, index) => ({ points, index, area: Math.abs(polygonArea(points)) }))
    .sort((a, b) => b.area - a.area);

  const shapes = [];
  let outline = null;
  for (const entry of ranked) {
    if (!outline) {
      outline = entry;
      const shape = new THREE.Shape(entry.points.map(([px, py]) => new THREE.Vector2(px, py)));
      shapes.push(shape);
      continue;
    }
    const centroid = entry.points.reduce((acc, [px, py]) => [acc[0] + px / entry.points.length, acc[1] + py / entry.points.length], [0, 0]);
    if (!pointInPolygon(centroid, outline.points)) {
      const shape = new THREE.Shape(entry.points.map(([px, py]) => new THREE.Vector2(px, py)));
      shapes.push(shape);
      continue;
    }
    shapes[0].holes.push(new THREE.Path(entry.points.map(([px, py]) => new THREE.Vector2(px, py))));
  }
  return { shapes, width: w * scale, height: h * scale, subpaths: placed };
}

/** Guess an outline/solid path: drop the outermost subpath when it is a plain disc around the rest. */
export function dropEnclosingDisc(subpaths) {
  if (subpaths.length < 2) return subpaths;
  const areas = subpaths.map((s) => Math.abs(polygonArea(s.points)));
  const biggest = areas.indexOf(Math.max(...areas));
  const outline = subpaths[biggest].points;
  const rest = subpaths.filter((_, idx) => idx !== biggest);
  // A disc encloses every other subpath's centroid; a glyph outline usually does too, so
  // also require it to be markedly larger and to be a near-perfect circle.
  const circle = circularity(outline);
  const enclosesAll = rest.every((s) => {
    const [cx, cy] = s.points.reduce((acc, [px, py]) => [acc[0] + px / s.points.length, acc[1] + py / s.points.length], [0, 0]);
    return pointInPolygon([cx, cy], outline);
  });
  if (circle > 0.985 && enclosesAll && areas[biggest] > Math.max(...areas.filter((_, idx) => idx !== biggest)) * 1.6) {
    return rest;
  }
  return subpaths;
}

/** How close a closed polygon is to a circle: area against the area of its own bounding disc. */
export function circularity(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [px, py] of points) {
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  const rx = (maxX - minX) / 2;
  const ry = (maxY - minY) / 2;
  const circleArea = Math.PI * rx * ry;
  if (circleArea <= 0) return 0;
  return Math.abs(polygonArea(points)) / 2 / circleArea;
}
