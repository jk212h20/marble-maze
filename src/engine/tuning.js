//  Live-tuning layer.
//
//  The physics reads its numbers from here, not from constants.js, so every value can be
//  adjusted while the marble is rolling. constants.js now only provides the *defaults*.
//
//  TUNING_SPEC is the single source of truth for the UI: label, range, step, units and a
//  one-line explanation for each knob. The test suite checks that the spec covers every
//  tunable key, so a new physics value cannot quietly ship without a slider.

import * as C from './constants.js';

const DEFAULT_SURFACES = structuredClone(C.SURFACES);

export const DEFAULT_TUNING = {
  gravity: C.GRAVITY,
  roll: C.ROLL_FACTOR,
  vMax: C.V_MAX,
  maxTilt: C.MAX_TILT,
  tiltRate: C.TILT_RATE,
  tiltReturn: C.TILT_RETURN,
  wallRestitution: C.WALL_RESTITUTION,
  wallFriction: C.SURFACES.wood.mu,
  pegRestitution: C.PEG_RESTITUTION,
  kickerImpulse: C.KICKER_IMPULSE,
  windmillSweep: C.WINDMILL_SWEEP,
  pitCapture: C.PIT_CAPTURE,
  goalCapture: C.GOAL_CAPTURE,
  ballR: C.BALL_R,
  surfaces: DEFAULT_SURFACES,
  conveyorSpeed: C.CONVEYOR_SPEED,
  ventAccel: C.VENT_ACCEL,
  magnetStrength: C.MAGNET_STRENGTH,
  teleportR: C.TELEPORT_R,
  teleportCooldown: C.TELEPORT_COOLDOWN,
  gateOpenTime: C.GATE_OPEN_TIME,
  lightLevel: C.LIGHT_LEVEL,
  lightReflect: C.LIGHT_REFLECT,
  lightSize: C.LIGHT_SIZE,
  boardFinish: C.BOARD_FINISH,
  grainProminence: C.GRAIN_PROMINENCE,
  rimGrain: C.RIM_GRAIN,
  rimStain: C.RIM_STAIN,
  marbleLook: C.MARBLE_LOOK,
  marbleTransparency: C.MARBLE_TRANSPARENCY,
  marbleBend: C.MARBLE_BEND,
  marbleFill: C.MARBLE_FILL,
  marbleLampBrightness: C.MARBLE_LAMP_BRIGHTNESS,
  marbleLampHue: C.MARBLE_LAMP_HUE,
  marbleBandContrast: C.MARBLE_BAND_CONTRAST,
  marbleBandCount: C.MARBLE_BAND_COUNT,
  marbleBandWidth: C.MARBLE_BAND_WIDTH,
  marbleSolidColor: C.MARBLE_SOLID_COLOR,
  vialViscosity: 0.06,
  vialSplash: 0.3,
  vialFill: C.VIAL_FILL,
  vialResponse: 4,
  indicator: C.INDICATOR,
};

export const TUNING = structuredClone(DEFAULT_TUNING);

const deg = (rad) => `${((rad * 180) / Math.PI).toFixed(1)}°`;

//  Slider range modes.
//
//  Each spec item carries the range the game considers reasonable (`min`/`max`). That is the
//  range the shipped sliders use, but it is not the whole story: testing an extreme wants a
//  knob to go *well* past reasonable, not to stop politely at the edge. A mode widens every
//  range outward by a fixed factor, so the documented range always sits inside the widened
//  one and no mode can ever hide a shipped value.
//
//  Values are clamped to the widest mode (`extreme`), not to the mode the panel happens to be
//  showing: a profile saved while testing extremes still loads exactly as saved, and switching
//  the panel back to Normal does not silently rewrite the numbers behind it.
export const RANGE_MODES = {
  normal: { label: 'Normal', factor: 1, hint: 'The documented shipping range for every knob.' },
  wide: { label: 'Wide ×3', factor: 3, hint: 'Three times past the shipped range, outward in both directions.' },
  extreme: { label: 'Extreme ×12', factor: 12, hint: 'Twelve times past the shipped range. Most of these numbers stop describing a toy.' },
};

export const RANGE_MODE_KEYS = Object.keys(RANGE_MODES);

/** The widest factor any value may ever take; the clamp uses this one. */
export const HARD_FACTOR = RANGE_MODES.extreme.factor;

const round6 = (v) => Math.round(v * 1e6) / 1e6;

/** Grow a maximum away from zero: positive values up, negative values toward zero. */
function widenUp(v, factor) {
  if (v > 0) return v * factor;
  if (v < 0) return v / factor;
  return 0;
}

/** Grow a minimum away from zero: positive values down, negative values further down. */
function widenDown(v, factor) {
  if (v > 0) return v / factor;
  if (v < 0) return v * factor;
  return 0;
}

/**
 * Snapping a widened limit back onto the step grid keeps the slider positions whole numbers.
 * The snap is *outward* (down for a minimum, up for a maximum) so rounding can never eat into
 * the margin the mode just bought — a widened range is never narrower than the factor asked for.
 */
function snapToStep(v, step, dir) {
  if (!(step > 0)) return v;
  const fn = dir < 0 ? Math.floor : Math.ceil;
  return round6(fn(v / step) * step);
}

/**
 * The slider limits for one spec item under a range mode. `step` is deliberate: a wider slider
 * keeps the documented step, so the shipped range is still as easy to nudge as it always was.
 */
export function rangeFor(item, mode = 'normal') {
  const factor = RANGE_MODES[mode]?.factor ?? 1;
  if (factor === 1 || item.options) return { min: item.min, max: item.max, step: item.step };
  return {
    min: snapToStep(widenDown(item.min, factor), item.step, -1),
    max: snapToStep(widenUp(item.max, factor), item.step, 1),
    step: item.step,
  };
}

export const TUNING_SPEC = [
  {
    group: 'Board finish',
    note: 'What the toy is made of. One finish moves the board, its walls, the inside of every hole and the ramp together, because they are one piece of timber at different tones - so the grain lines up across all of them. Grain prominence is how loud that grain reads, in the colour and in the relief alike.',
    items: [
      {
        path: 'boardFinish',
        label: 'Finish',
        options: [
          { value: 'walnut', label: 'Walnut' },
          { value: 'birch', label: 'Birch' },
          { value: 'cherry', label: 'Cherry' },
          { value: 'marble', label: 'Marble' },
        ],
        default: C.BOARD_FINISH,
        hint: 'Walnut is the shipped generated board. Birch and cherry are that same picture paled and warmed - its grain, pores and figure are real; only the colour is the species. Marble is a veined stone slab instead of timber.',
      },
      {
        path: 'grainProminence',
        label: 'Grain prominence',
        min: 0.25,
        max: 2.5,
        step: 0.05,
        default: C.GRAIN_PROMINENCE,
        hint: 'Scales the grain about its own average: below 1 the board is calmer and its relief shallower, above 1 the lines and pores are louder. 1.00 is each finish exactly as it was made.',
      },
      {
        path: 'rimGrain',
        label: 'Rim',
        options: [
          { value: 'same', label: 'Same board' },
          { value: 'mirrored', label: 'Book-matched' },
          { value: 'cut', label: 'Another board' },
        ],
        default: C.RIM_GRAIN,
        hint: 'How the frame around the board is cut. Same board continues the board\u2019s own grain into the rim, so the whole toy is one piece of timber. Book-matched is that same board flipped, so the figure turns back on itself at the join. Another board is an independently generated grain of the same species - a second board of the same tree, not a continuation.',
      },
      {
        path: 'rimStain',
        label: 'Rim stain',
        min: 0,
        max: 1,
        step: 0.05,
        default: C.RIM_STAIN,
        hint: 'Darkens the rim only, whatever it is made of. 0 leaves it the board\u2019s own colour; 1 is a deep stain, which separates the frame from the board at a glance.',
      },
    ],
  },
  {
    group: 'Marble',
    note: 'Which marble is on the board. This is a look, not a feel: every marble is built at the same radius and scaled by the same size value, so the one the physics rolls is exactly the one you pick. Six are offered. The shipped cat\'s-eye is paint on a single sphere. The lantern carries real lights inside that lay a coloured pool on the board as it rolls, plus subsurface bands that cut its own glow as they turn past, which is how you read its rotation. Solid is opaque stone in whatever colour you pick. Earth and Moon are painted globes - the sea is the only glossy part of the Earth, and the Moon\'s craters are cut in as relief, so a rim catches the light. Eight ball is polished black with the 8 in its white circle. The clear-glass designs are shelved for now - each one costs a transmission pass every frame - and are still reachable by URL as ?marble=bitcoin, geode, helix, gem or banded.',
    items: [
      {
        path: 'marbleLook',
        label: 'Look',
        options: [
          { value: 'catseye', label: "Cat's-eye" },
          { value: 'lantern', label: 'Lantern' },
          { value: 'solid', label: 'Solid' },
          { value: 'earth', label: 'Earth' },
          { value: 'moon', label: 'Moon' },
          //  "8-ball" rather than "Eight ball": the segmented control divides its width by the number
          //  of options, and six of them at 11px leave about 57 px each. The long label wraps and
          //  makes the row two lines tall, which reads as a layout bug rather than as a choice.
          { value: 'eightball', label: '8-ball' },
        ],
        default: C.MARBLE_LOOK,
        hint: 'The shipped cat\'s-eye is the painted swirl the game has always had and the cheapest thing in the list (no glass, so no extra render). The lantern is the only marble that lights the board, and it wears opaque bands that cut its own glow as it rolls, which is how you read which way it is turning. Solid is opaque stone in whatever colour you pick: no transmission anywhere, so it costs the same as the cat\'s-eye. Earth, Moon and Eight ball are painted spheres too - one map, nothing inside - so they cost the same. Swapping one in mid-run keeps the marble exactly where it is.',
      },
      {
        path: 'marbleTransparency',
        label: 'Transparency',
        min: 0,
        max: 1,
        step: 0.02,
        default: C.MARBLE_TRANSPARENCY,
        hint: 'How much light the glass passes. 1.00 is clear glass, 0 is a solid milky ball. The glass marbles are the only ones this touches - the painted cat\'s-eye has no glass in it at all.',
      },
      {
        path: 'marbleBend',
        label: 'Glass bend',
        min: 0,
        max: 2,
        step: 0.05,
        default: C.MARBLE_BEND,
        hint: 'How far the refracted ray travels through the glass, which is how hard the marble acts as a lens on the board behind it. 0 is a flat window, 2 magnifies hard. Higher settings make the wood under the ball read as a soft blur.',
      },
      {
        path: 'marbleLampBrightness',
        label: 'Lamp brightness',
        min: 0,
        max: 3,
        step: 0.05,
        default: C.MARBLE_LAMP_BRIGHTNESS,
        hint: 'The lantern\'s lamp, as a multiple of the shipped strength (which was set by measuring what it adds to the board, not by eye). It moves the whole lamp together - the light, the glowing beads and their halos - so turning it up brightens the marble and its pool on the wood at once. Nothing happens on a marble with no lamp in it.',
      },
      {
        path: 'marbleLampHue',
        label: 'Lamp hue',
        min: 0,
        max: 360,
        step: 1,
        unit: '°',
        default: C.MARBLE_LAMP_HUE,
        hint: 'The lamp\'s colour, in degrees around the wheel: 36 is the shipped amber, 0 is red, 120 green, 200 blue, 300 violet. The beads and their halos move with the light, so the marble and the pool it throws never disagree with each other.',
      },
      {
        path: 'marbleBandContrast',
        label: 'Band contrast',
        min: 0,
        max: 2,
        step: 0.05,
        default: C.MARBLE_BAND_CONTRAST,
        hint: 'How far the bands stand out from the marble they sit on. 1.00 is the shipped look, 0 sinks them into the body, 2 drives them apart. It moves the lantern\'s bands and the solid marble\'s together, so one dial covers both.',
      },
      {
        path: 'marbleBandCount',
        label: 'Band count',
        min: 2,
        max: 12,
        step: 1,
        default: C.MARBLE_BAND_COUNT,
        hint: 'How many bands around the lantern: few reads as deliberate stripes to follow the roll, many reads as a fine grain. Redrawing the mask is cheap, so this is live rather than a rebuild.',
      },
      {
        path: 'marbleBandWidth',
        label: 'Band width',
        min: 0.05,
        max: 0.85,
        step: 0.01,
        default: C.MARBLE_BAND_WIDTH,
        hint: 'How much of each band\'s pitch is opaque. Thin bands show more glass and cut the glow into bright slivers; wide bands make it a mostly dark marble with bright seams. Only the lantern\'s bands have a width to move.',
      },
      {
        path: 'marbleSolidColor',
        label: 'Solid colour',
        type: 'color',
        default: C.MARBLE_SOLID_COLOR,
        hint: 'The solid marble\'s body colour, any hex you like. Its bands are derived from it - a step lighter and a step darker - so one colour recolours the whole marble and the pattern survives. Nothing happens on the other marbles.',
      },
      {
        path: 'marbleFill',
        label: 'Solid fill',
        min: 0.2,
        max: 1.4,
        step: 0.02,
        default: C.MARBLE_FILL,
        hint: 'The size of what is embedded, so this is how you dial the amount of solid in each marble. It also decides how much clear glass you can see at all: a sphere only looks like glass where its surface faces you, which is the middle, so a big core hides the one clear part of the ball and leaves a ring that behaves like a mirror.',
      },
    ],
  },
  {
    group: 'Gravity and roll',
    note: 'The weight behind everything. Gravity sets how hard the board pulls; roll transfer sets how much of that reaches a rolling sphere.',
    items: [
      { path: 'gravity', label: 'Gravity', min: 1, max: 20, step: 0.1, unit: 'u/s²', hint: '9.81 is real-world. Lower feels like a lighter marble on the Moon.' },
      { path: 'roll', label: 'Roll transfer', min: 0.4, max: 0.95, step: 0.01, hint: 'A solid ball rolling without slipping only gets 5/7 of the slope. Higher = faster pick-up.' },
      { path: 'vMax', label: 'Speed cap', min: 1, max: 8, step: 0.1, unit: 'u/s', hint: 'Safety ceiling. Also the fastest the marble can ever move.' },
    ],
  },
  {
    group: 'Marble and board grip',
    note: 'These two are the classic pair: how quickly a rolling marble is slowed, and how much lean it takes to get it moving at all.',
    items: [
      { path: 'surfaces.wood.drag', label: 'Rolling drag (start)', min: 0.05, max: 3, step: 0.05, unit: '1/s', hint: 'How fast speed bleeds off once moving. This sets the top speed for a given tilt.' },
      { path: 'surfaces.wood.roll', label: 'Start friction', min: 0, max: 1, step: 0.005, hint: 'The lean needed to break the marble loose and the friction that stops it. This is the "sticky start".' },
      { path: 'wallFriction', label: 'Wall friction', min: 0, max: 1, step: 0.01, hint: 'How much speed is scrubbed when scraping along a wall. 0 = the marble keeps every bit of its sideways speed on contact.' },
      { path: 'wallRestitution', label: 'Wall bounce', min: 0, max: 0.9, step: 0.01, hint: '0 = dead thud, 0.9 = pinball.' },
      { path: 'ballR', label: 'Marble size', min: 0.12, max: 0.42, step: 0.005, hint: 'Radius on the unit grid. Physics and the rendered ball both follow it.' },
    ],
  },
  {
    group: 'Board control',
    note: 'How the board answers your hands. Raise the tilt rate if it feels unresponsive, cut max tilt if you are overshooting everything.',
    items: [
      { path: 'maxTilt', label: 'Max tilt', min: 0.05, max: 0.5, step: 0.005, display: deg, unit: '', hint: 'How far the board can lean. Sets your top speed and how tight you can corner.' },
      { path: 'tiltRate', label: 'Tilt speed', min: 0.4, max: 8, step: 0.1, unit: 'rad/s', hint: 'How fast the board reaches the commanded tilt.' },
      { path: 'tiltReturn', label: 'Self-centre', min: 0, max: 8, step: 0.1, unit: 'rad/s', hint: 'How fast the board levels itself when you let go. 0 = it stays where you left it.' },
    ],
  },
  {
    group: 'Holes and cups',
    items: [
      { path: 'pitCapture', label: 'Hole grip', min: 0.4, max: 1.2, step: 0.01, hint: 'Fraction of the hole radius that swallows the marble. Lower = you can clip the rim and survive.' },
      { path: 'goalCapture', label: 'Cup grip', min: 0.4, max: 1.2, step: 0.01, hint: 'How forgiving the goal cup is.' },
    ],
  },
  {
    group: 'Bumpers',
    items: [
      { path: 'pegRestitution', label: 'Bumper bounce', min: 0, max: 1, step: 0.01, hint: 'How hard brass posts throw the marble back.' },
      { path: 'kickerImpulse', label: 'Kicker punch', min: 0, max: 6, step: 0.1, hint: 'Extra shove from posts marked as kickers.' },
      { path: 'windmillSweep', label: 'Windmill throw', min: 0, max: 1.6, step: 0.05, hint: 'How much of an arm\'s swing speed the marble takes. 0 = the arm is just a moving wall.' },
    ],
  },
  {
    group: 'Other surfaces',
    items: [
      { path: 'surfaces.ice.drag', label: 'Ice drag', min: 0.01, max: 1, step: 0.01, unit: '1/s', hint: 'Lower = the marble keeps its speed across ice.' },
      { path: 'surfaces.ice.roll', label: 'Ice start friction', min: 0, max: 0.4, step: 0.005, hint: 'How easily it starts moving on ice.' },
      { path: 'surfaces.sand.drag', label: 'Sand drag', min: 0.5, max: 8, step: 0.1, unit: '1/s', hint: 'How fast sand eats momentum.' },
      { path: 'surfaces.sand.roll', label: 'Sand start friction', min: 0, max: 1.5, step: 0.01, hint: 'Lean needed to break free of sand.' },
      { path: 'surfaces.steel.drag', label: 'Steel drag', min: 0.05, max: 3, step: 0.05, unit: '1/s', hint: 'Polished steel plate.' },
    ],
  },
  {
    group: 'Light and glass',
    note: 'Presentation, not physics. Diffuse light drives the key, the fill and the shadows on the board; reflection is how bright the studio lights look when you see them mirrored in the glass and the marble. They are independent, so the mirrored glare can be dimmed without darkening the board, and either can go all the way to nothing. Size changes how broad the sheen and the highlights are.',
    items: [
      // Both brightness sliders run from *nothing* at the bottom to the shipped look at the top.
      // They used to run out to 1.6x and 2x that look, which is only ever "brighter than it should
      // be": the top of the *documented* range is the bright shipped setting, not something past
      // it. Asking for a wider slider range is the explicit opt-in that gets past it again.
      {
        path: 'lightLevel',
        label: 'Diffuse light',
        min: 0,
        max: 1,
        step: 0.01,
        default: C.LIGHT_LEVEL,
        hint: 'The key light, the fill and the shadows they cast. Zero leaves the board lit only by the studio reflection; the top is the shipped look.',
      },
      {
        path: 'lightReflect',
        label: 'Reflection',
        min: 0,
        max: 1,
        step: 0.02,
        default: C.LIGHT_REFLECT,
        hint: 'The studio lights as they appear mirrored in the glass and the marble, and the lid glass itself. Zero removes every trace of glare; the top is the shipped look.',
      },
      {
        path: 'lightSize',
        label: 'Light size',
        min: 0.3,
        max: 2.4,
        step: 0.02,
        default: C.LIGHT_SIZE,
        hint: 'Softbox size. Bigger gives a broader sheen and softer, wider highlights.',
      },
    ],
  },
  {
    group: 'Level indicators',
    note: 'Two ways to read the angle, both in the metal troughs along the sides. Bars are instant and exact - the bar is the angle. Liquid is alive: it tilts at once, then runs to the low end, sloshes and settles.',
    items: [
      {
        path: 'indicator',
        label: 'Indicator',
        options: [
          { value: 'bars', label: 'Bars' },
          { value: 'liquid', label: 'Liquid' },
          { value: 'both', label: 'Both' },
          { value: 'off', label: 'Off' },
        ],
        default: C.INDICATOR,
        hint: 'Bars: solid bars, positioned from the tilt every frame, no lag. Liquid: the simulated vials. Both draws the bars over the liquid.',
      },
      {
        path: 'vialViscosity',
        label: 'Liquid viscosity',
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.06,
        hint: 'How quickly sloshing dies out. 0 is water; higher is syrup. At 1 it barely moves.',
      },
      {
        path: 'vialSplash',
        label: 'Splashback',
        min: 0,
        max: 0.95,
        step: 0.01,
        default: 0.3,
        hint: 'How much the liquid froths where it slams into the end caps. The reflection itself is fixed; this is the visible splash.',
      },
      {
        path: 'vialResponse',
        label: 'Liquid response',
        min: 0.5,
        max: 12,
        step: 0.1,
        default: 4,
        hint: 'How fast the liquid answers a tilt. It is tuned faster than the marble on purpose: an indicator that moves at the marble\'s own pace reads as sluggish.',
      },
      {
        path: 'vialFill',
        label: 'Trough fill',
        min: 0.15,
        max: 0.9,
        step: 0.01,
        default: C.VIAL_FILL,
        hint: 'How full the troughs are. Less liquid answers smaller tilts but sloshes further.',
      },
    ],
  },
  {
    group: 'Level machinery',
    note: 'Matters on later levels (belts, fans, magnets). Tune now so the obstacles are already calibrated when they arrive.',
    items: [
      { path: 'conveyorSpeed', label: 'Belt speed', min: 0, max: 3, step: 0.1, unit: 'u/s', hint: 'How fast a conveyor drags the marble.' },
      { path: 'ventAccel', label: 'Fan force', min: 0, max: 8, step: 0.1, unit: 'u/s²', hint: 'Push from a vent.' },
      { path: 'magnetStrength', label: 'Magnet pull', min: 0, max: 6, step: 0.1, unit: 'u/s²', hint: 'Strength of an attracting magnet.' },
      { path: 'teleportR', label: 'Pad radius', min: 0.2, max: 0.6, step: 0.01, hint: 'How close counts as standing on a teleport pad.' },
      { path: 'teleportCooldown', label: 'Pad cooldown', min: 0, max: 1.5, step: 0.05, unit: 's', hint: 'Ignore time after a jump.' },
      { path: 'gateOpenTime', label: 'Gate hold', min: 1, max: 12, step: 0.5, unit: 's', hint: 'How long a pressure plate holds its gate open.' },
    ],
  },
];

export const TUNING_KEYS = TUNING_SPEC.flatMap((g) => g.items.map((i) => i.path));

export const PRESETS = {
  default: { label: 'Default', patch: {} },
  heavy: {
    label: 'Heavy marble',
    patch: { gravity: 13.5, roll: 0.6, 'surfaces.wood.drag': 1.0, 'surfaces.wood.roll': 0.11, maxTilt: 0.28, tiltRate: 2.6 },
  },
  slick: {
    label: 'Slick and fast',
    patch: { 'surfaces.wood.drag': 0.45, 'surfaces.wood.roll': 0.015, wallFriction: 0.1, wallRestitution: 0.55, maxTilt: 0.24, tiltRate: 4.2, vMax: 6 },
  },
  arcade: {
    label: 'Arcade',
    patch: { gravity: 12, roll: 0.85, 'surfaces.wood.drag': 0.7, 'surfaces.wood.roll': 0.02, maxTilt: 0.38, tiltRate: 5, tiltReturn: 5, wallRestitution: 0.6, vMax: 6.5 },
  },
  floaty: {
    label: 'Floaty',
    patch: { gravity: 5.5, roll: 0.62, 'surfaces.wood.drag': 0.85, 'surfaces.wood.roll': 0.03, maxTilt: 0.34, tiltRate: 2.2 },
  },
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function getPath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (!isPlainObject(cur) || !(p in cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

export function getTuning(path) {
  return getPath(TUNING, path);
}

export function specFor(path) {
  return TUNING_KEYS.includes(path) ? TUNING_SPEC.flatMap((g) => g.items).find((i) => i.path === path) : null;
}

function clampValue(path, value) {
  const item = specFor(path);
  if (!item) return value;
  // A choice item (the indicator mode) is a string from a fixed list, not a number: it is clamped
  // to the list rather than to a range.
  if (item.options) {
    return item.options.some((o) => o.value === value) ? value : item.default;
  }
  // A colour is also a string, and the only sane clamp is "is this a hex colour at all": anything
  // else would be silently accepted into the JSON and then paint the marble transparent black. Note
  // the *normalising* rather than validating in place - the rest of the tuning layer compares values
  // as numbers, so a value that varies in case or length would read as a custom tuning forever.
  if (item.type === 'color') {
    const hex = typeof value === 'string' ? value.trim().replace(/^#/, '') : '';
    return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : item.default;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return getTuning(path);
  // Clamped to the *widest* mode, not the panel's current one (see RANGE_MODES).
  const hard = rangeFor(item, 'extreme');
  return Math.min(hard.max, Math.max(hard.min, n));
}

/** Set one knob (dotted path). Returns the value actually applied. */
export function setTuning(path, value) {
  const parts = path.split('.');
  let cur = TUNING;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isPlainObject(cur[parts[i]])) return undefined;
    cur = cur[parts[i]];
  }
  const leaf = parts[parts.length - 1];
  if (!(leaf in cur)) return undefined;
  cur[leaf] = clampValue(path, value);
  return cur[leaf];
}

/** Apply a patch of dotted paths (unknown keys are ignored). */
export function applyTuning(patch) {
  if (!isPlainObject(patch)) return TUNING;
  for (const [path, value] of Object.entries(patch)) setTuning(path, value);
  return TUNING;
}

export function resetTuning() {
  const fresh = structuredClone(DEFAULT_TUNING);
  for (const k of Object.keys(TUNING)) delete TUNING[k];
  Object.assign(TUNING, fresh);
  return TUNING;
}

/** Flat {path: value} snapshot of any tuning object — this is what we bake into constants. */
export function flattenTuning(t = TUNING) {
  const out = {};
  for (const path of TUNING_KEYS) out[path] = getPath(t, path);
  //  (Every path here is either a number, a choice or a colour - see clampValue.)
  return out;
}

export function tuningToJSON() {
  return JSON.stringify(flattenTuning(), null, 2);
}

export function loadTuningJSON(json) {
  let patch = json;
  if (typeof json === 'string') {
    try {
      patch = JSON.parse(json);
    } catch {
      return { ok: false, error: 'not valid JSON' };
    }
  }
  if (!isPlainObject(patch)) return { ok: false, error: 'expected an object of path: value' };
  const unknown = Object.keys(patch).filter((k) => !TUNING_KEYS.includes(k));
  for (const [path, value] of Object.entries(patch)) setTuning(path, value);
  return { ok: true, unknown };
}

/** True when anything differs from the shipped defaults. */
/**
 * Whether one knob differs from its shipped value.
 *
 * Numbers are compared with a tolerance because they arrive through sliders and JSON. Anything else
 * - a choice, or a colour - is compared as a string, and that is not a detail: `Number('#15171d')` is
 * NaN, and `NaN > 1e-9` is false, so a purely numeric comparison reports a recoloured marble as
 * *unchanged*. It would look like the picker did nothing while the marble changed colour.
 */
function differs(path, a, b) {
  if (specFor(path)?.type === 'color' || specFor(path)?.options) return String(a) !== String(b);
  return Math.abs(Number(a) - Number(b)) > 1e-9;
}

/** True when anything differs from the shipped defaults. */
export function isCustomised() {
  const t = flattenTuning();
  const d = flattenTuning(DEFAULT_TUNING);
  return TUNING_KEYS.some((k) => differs(k, t[k], d[k]));
}

export function diffFromDefaults() {
  const t = flattenTuning();
  const d = flattenTuning(DEFAULT_TUNING);
  const out = {};
  for (const k of TUNING_KEYS) if (differs(k, t[k], d[k])) out[k] = t[k];
  return out;
}

export function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return TUNING;
  resetTuning();
  return applyTuning(preset.patch);
}
