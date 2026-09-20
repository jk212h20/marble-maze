//  The etched compass rose on the glass lid.
//
//  It does two jobs at once: it is the visual weight around the small physical knob, and
//  because it is fixed to the pane it gives the player a reference to read the board's tilt
//  against. Both of those are reasons for it to be *described* rather than drawn inline - the
//  rings and needles are plain data here, so tests can check them without a renderer, the same
//  way slabHoles() describes the holes cut in the board.
//
//  The hard rule: **the rose must not cross a hole.** A bright engraved line running through a
//  pit looks wrong and makes the hole harder to read, and holes are the one thing this project
//  refuses to make ambiguous. Rings are nudged out of a hole's band; points that would cross a
//  hole are reported as problems.

import { KNOB_R, ROSE_RINGS, ROSE_LINE, ROSE_RING_LINE, ROSE_SPREAD, ROSE_MARGIN, ROSE_TICK } from './constants.js';

/** Every hole the rose has to dodge: the pits and the cup, with their distance from centre. */
export function roseHoles(level) {
  return [
    ...level.pits.map((p) => ({ x: p.x, z: p.z, r: p.r, what: 'pit' })),
    { x: level.goal.x, z: level.goal.z, r: level.goal.r, what: 'cup' },
  ].map((h) => ({ ...h, d: Math.hypot(h.x, h.z) }));
}

/**
 * How much clear glass the rose has to work with: from just outside the knob to a margin short
 * of the innermost hole on the level. Keeping every marking inside that one radius is what
 * makes "the rose never crosses a hole" true by construction rather than by luck.
 */
export function roseReach(level) {
  let clear = Infinity;
  for (const h of roseHoles(level)) clear = Math.min(clear, h.d - h.r);
  return Math.max(0, Math.min(clear - ROSE_MARGIN, 2.6));
}

/** The whole marking: concentric rings and the eight compass ticks. */
export function roseDesign(level) {
  const reach = roseReach(level);
  const inner = KNOB_R * 1.55;
  if (reach <= inner + ROSE_LINE * 6) {
    return { rings: [], ticks: [], inner, reach, base: inner };
  }
  // The rings sit on the clear glass outside the knob. `knobClear` is the seat's outer edge plus
  // three ring line-widths of air, so the innermost circle reads as its own mark rather than as
  // part of the knob's rim.
  const knobClear = KNOB_R * 1.45 + ROSE_RING_LINE * 3;
  // Ring spacing. The first cut put a blank 30% middle inside the annulus and split the rest
  // evenly - a gap of 0.35 * (reach - inner). Spread that gap by ROSE_SPREAD (1.5, i.e. rings
  // 50% further apart), then clamp: the innermost ring stays clear of the knob and the outermost
  // stays at `reach`. The clear glass is finite, so on the shipped levels the clamp bites and the
  // rings end up ~1.38x further apart - as wide as the lid holds while all three stay readable.
  const annulus = reach - inner;
  const targetGap = annulus * 0.35 * ROSE_SPREAD;
  const gap = Math.min(targetGap, (reach - knobClear) / (ROSE_RINGS.length - 1));
  const base = reach - gap * (ROSE_RINGS.length - 1);
  const rings = ROSE_RINGS.map((f) => +(base + (reach - base) * f).toFixed(3));
  const ticks = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const long = i % 2 === 0; // cardinals point, intercardinals are short
    const len = long ? ROSE_TICK : ROSE_TICK * 0.52;
    ticks.push({
      angle: a,
      inner: +(reach - len).toFixed(3),
      outer: reach,
      // Tapered, but not to a whisker: a needle-thin point is gone by the time the dial is
      // drawn at playing size, and the eight points are the part of the rose the eye actually
      // uses to read the board's tilt.
      half: long ? ROSE_LINE * 2.0 : ROSE_LINE * 1.4,
      kind: long ? 'cardinal' : 'intercardinal',
    });
  }
  return { rings, ticks, inner, reach, base };
}

/** Anything a rose should not do. Empty means it is clean. */
export function roseProblems(level) {
  const problems = [];
  const holes = roseHoles(level);
  const { rings, ticks, inner, reach } = roseDesign(level);
  if (rings.length < 3) problems.push(`only ${rings.length} rings fit the clear glass`);
  if (reach < inner + ROSE_LINE * 6) problems.push(`only ${reach.toFixed(2)} of clear glass for the rose`);
  for (let i = 1; i < rings.length; i++) {
    if (rings[i] - rings[i - 1] < ROSE_LINE * 4) problems.push(`rings ${i - 1} and ${i} are too close to read apart`);
  }
  if (rings.length && rings[rings.length - 1] > reach + 1e-6) problems.push('a ring runs past the clear glass');
  // Ring radii are rounded to 0.001 in `roseDesign`, so the clearance is checked to that same
  // tolerance - otherwise the exactly-clamped inner ring can read as a hair too close.
  if (rings.length && rings[0] < KNOB_R * 1.45 + ROSE_RING_LINE * 3 - 1e-3) problems.push('the innermost ring runs into the knob');
  for (const t of ticks) {
    if (t.outer <= t.inner) problems.push(`${t.kind} tick has no length`);
    if (t.outer > reach + 1e-6) problems.push(`${t.kind} tick runs past the clear glass`);
  }
  // The reach makes this impossible, but it is the rule the design exists to keep, so it is
  // checked directly as well: nothing the player reads as "glass marking" may sit over a hole.
  const marks = [
    ...rings.map((r) => ({ what: `ring at ${r}`, sample: (a) => [Math.cos(a) * r, Math.sin(a) * r] })),
    ...ticks.map((t) => ({
      what: `${t.kind} tick`,
      sample: (a) => {
        const f = (a / (Math.PI * 2)) * 2;
        const rad = t.inner + (t.outer - t.inner) * Math.min(1, f);
        return [Math.cos(t.angle) * rad, Math.sin(t.angle) * rad];
      },
    })),
  ];
  for (const m of marks) {
    for (let i = 0; i < 36; i++) {
      const [x, z] = m.sample((i / 36) * Math.PI * 2);
      const hit = holes.find((h) => Math.hypot(x - h.x, z - h.z) < h.r + ROSE_LINE / 2);
      if (hit) {
        problems.push(`${m.what} crosses the ${hit.what}`);
        break;
      }
    }
  }
  return problems;
}
