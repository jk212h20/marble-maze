//  The mechanics registry: one list of everything the level format can express, and which
//  layers actually implement each one.
//
//  Why this file exists. The engine, the renderer, the tuning sheet, the level editor and the
//  docs each grew a copy of the obstacle vocabulary, and copies drift. A one-way flap shipped
//  with a physics collider and no visual and nothing noticed, because no single place said
//  "this mechanic has the physics and not the picture". Every row here makes that state
//  explicit, and tests/mechanics.test.js fails when the code disagrees with the row.
//
//  The rule that falls out of it: **a mechanic a built level uses must be rendered**. A row may
//  say `render: 'none'` only while no authored level uses it; the test enforces exactly that.
//
//  This file is data, not behaviour — the engine never imports it. The test, the status
//  generator (tools/gen-status.mjs) and the plan in docs/PLAN.md are its only readers.

/**
 * How a mechanic reaches the board.
 *
 *   physics  'yes'     the engine simulates it (the needle below is asserted to exist)
 *   render   'mesh'    drawn as its own geometry in src/render/scene.js
 *            'painted' drawn into the board's material/thickness, not as separate geometry
 *            'none'    NOT DRAWN — only legal while no authored level uses the mechanic
 *   tuning   the TUNING_SPEC paths that shape it (empty when geometry decides, not a slider)
 *   editor   the level editor can author it (its tool id is asserted to exist)
 *   status   'shipped'     used by at least one built level
 *            'engine-only' implemented and tested, in no level yet
 *            'shelved'     deliberately not offered
 */
export const MECHANICS = [
  {
    key: 'wall',
    label: 'Raised wall',
    what: 'Reflects the marble with restitution and tangential friction. `carve` reopens a gap in a filled rect.',
    specKeys: ['walls', 'carve'],
    physicsNeedle: 'WALL',
    render: 'mesh',
    renderNeedle: 'WALL',
    tuning: ['wallFriction', 'wallRestitution'],
    editor: 'wall',
    status: 'shipped',
  },
  {
    key: 'pit',
    label: 'Pit',
    what: 'Swallows the marble on centre contact; the attempt ends. Round, slot or per-pit radius, and able to slide on a cycle.',
    specKeys: ['pits'],
    physicsNeedle: 'checkPits',
    render: 'mesh',
    renderNeedle: 'PIT',
    tuning: ['pitCapture'],
    editor: 'pit',
    status: 'shipped',
  },
  {
    key: 'goal',
    label: 'Goal cup',
    what: 'The brass-ringed cup. Every marble must reach it.',
    specKeys: ['goal'],
    physicsNeedle: 'goalCapture',
    render: 'mesh',
    renderNeedle: 'GOAL_CHAR',
    tuning: ['goalCapture'],
    editor: 'goal',
    status: 'shipped',
  },
  {
    key: 'multi-marble',
    label: 'More than one marble',
    what: 'A `spawn` list of cells puts several marbles on the board; the run is won only when all of them are home.',
    specKeys: ['spawn'],
    // A single spawn is `[c, r]`; more than one is a list of cells. Only the latter is the mechanic,
    // so `used` overrides the plain "this spec key is non-empty" reading.
    used: (spec) => Array.isArray(spec.spawn?.[0]),
    physicsNeedle: 'world.balls',
    render: 'mesh',
    renderNeedle: 'spawns',
    tuning: ['ballR'],
    editor: 'spawn',
    status: 'shipped',
  },
  {
    key: 'ice',
    label: 'Ice plate',
    what: 'Almost no drag, so the marble keeps its speed through corners.',
    specKeys: ['ice'],
    physicsNeedle: 'surfaces',
    render: 'painted',
    renderNeedle: 'ICE',
    tuning: ['surfaces.ice.drag', 'surfaces.ice.roll'],
    editor: 'ice',
    status: 'engine-only',
  },
  {
    key: 'sand',
    label: 'Sand patch',
    what: 'High drag, and it grips at shallow tilt until the lean breaks it free.',
    specKeys: ['sand'],
    physicsNeedle: 'surfaces',
    render: 'painted',
    renderNeedle: 'SAND',
    tuning: ['surfaces.sand.drag', 'surfaces.sand.roll'],
    editor: 'sand',
    status: 'engine-only',
  },
  {
    key: 'steel',
    label: 'Steel plate',
    what: 'Fast, low-friction, still not ice.',
    specKeys: ['steel'],
    physicsNeedle: 'surfaces',
    render: 'painted',
    renderNeedle: 'STEEL',
    tuning: ['surfaces.steel.drag'],
    editor: 'steel',
    status: 'engine-only',
  },
  {
    key: 'belt',
    label: 'Conveyor belt',
    what: 'Drags the marble toward its surface speed.',
    specKeys: ['belts'],
    physicsNeedle: 'f.belts',
    render: 'painted',
    renderNeedle: 'BELT',
    tuning: ['conveyorSpeed'],
    editor: 'belt',
    status: 'engine-only',
  },
  {
    key: 'vent',
    label: 'Fan / vent',
    what: 'A steady in-plane push. The board shows a grille; the airstream that would explain the push is not drawn.',
    specKeys: ['vents'],
    physicsNeedle: 'f.vents',
    render: 'painted',
    renderNeedle: 'VENT',
    tuning: ['ventAccel'],
    editor: 'vent',
    status: 'engine-only',
    note: 'The design notes call the visible airstream "later" — it is the one deferred visual inside an otherwise rendered mechanic.',
  },
  {
    key: 'magnet',
    label: 'Magnet',
    what: 'Attracts or repels inside its radius; the sign of the strength picks which.',
    specKeys: ['magnets'],
    physicsNeedle: 'f.magnets',
    render: 'mesh',
    renderNeedle: 'f.magnets',
    tuning: ['magnetStrength'],
    editor: 'magnet',
    status: 'engine-only',
  },
  {
    key: 'teleport',
    label: 'Teleport pads',
    what: 'Moves the marble to its twin pad, keeping its speed, then cools down.',
    specKeys: ['teleports'],
    physicsNeedle: 'f.pads',
    render: 'mesh',
    renderNeedle: 'f.pads',
    tuning: ['teleportR', 'teleportCooldown'],
    editor: 'teleport',
    status: 'engine-only',
  },
  {
    key: 'gate',
    label: 'Gate (button-timed)',
    what: 'A bar a pressure button retracts for `gateOpenTime` seconds.',
    specKeys: ['gates'],
    physicsNeedle: 'f.gates',
    render: 'mesh',
    renderNeedle: 'f.gates',
    tuning: ['gateOpenTime'],
    editor: 'gate',
    status: 'engine-only',
    note: 'Both Locks wires its button to lifts instead, so the timed path is unplayed.',
  },
  {
    key: 'lift',
    label: 'Lift wall',
    what: 'A metal wall slab a plate raises out of the floor or sinks, for as long as the plate is stood on. No timer.',
    specKeys: ['lifts'],
    physicsNeedle: 'f.lifts',
    render: 'mesh',
    renderNeedle: 'f.lifts',
    tuning: [],
    editor: 'lift',
    status: 'shipped',
  },
  {
    key: 'oneway',
    label: 'One-way flap',
    what: 'Blocks the marble from one side only.',
    specKeys: ['oneways'],
    physicsNeedle: 'f.oneways',
    render: 'none',
    renderNeedle: null,
    tuning: [],
    editor: 'oneway',
    status: 'engine-only',
    note: 'THE GAP: this is the only mechanic with a collider and no picture. tests/mechanics.test.js fails the moment an authored level uses it.',
  },
  {
    key: 'peg',
    label: 'Bumper post',
    what: 'A disc the marble bounces off, returning less than it was given.',
    specKeys: ['pegs'],
    physicsNeedle: 'f.pegs',
    render: 'mesh',
    renderNeedle: 'f.pegs',
    tuning: ['pegRestitution'],
    editor: 'peg',
    status: 'shipped',
  },
  {
    key: 'kicker',
    label: 'Kicking peg',
    what: 'A peg with `kick: true`: it fires the marble away rather than merely returning it.',
    specKeys: [],
    used: (spec) => (spec.pegs ?? []).some((p) => p.kick),
    physicsNeedle: 'kickerImpulse',
    render: 'mesh',
    renderNeedle: 'f.pegs',
    tuning: ['kickerImpulse'],
    editor: 'peg',
    status: 'engine-only',
  },
  {
    key: 'windmill',
    label: 'Windmill',
    what: 'A solid post whose arms bat the marble with the surface velocity where they touch.',
    specKeys: ['windmills'],
    physicsNeedle: 'f.windmills',
    render: 'mesh',
    renderNeedle: 'f.windmills',
    tuning: ['windmillSweep'],
    editor: 'windmill',
    status: 'shipped',
  },
  {
    key: 'pendulum',
    label: 'Pendulum',
    what: 'Swings across a corridor, sweeping the marble.',
    specKeys: ['pendulums'],
    physicsNeedle: 'f.pendulums',
    render: 'mesh',
    renderNeedle: 'f.pendulums',
    tuning: [],
    editor: 'pendulum',
    status: 'engine-only',
  },
  {
    key: 'mover',
    label: 'Sliding bar',
    what: 'Blocks a gap on a cycle and carries the marble as it goes.',
    specKeys: ['movers'],
    physicsNeedle: 'f.movers',
    render: 'mesh',
    renderNeedle: 'f.movers',
    tuning: [],
    editor: 'mover',
    status: 'engine-only',
  },
  {
    key: 'ramp',
    label: 'Ramp',
    what: 'A wedge the marble climbs, launching off the crest. Geometry decides its slope, not a slider.',
    specKeys: ['ramps'],
    physicsNeedle: 'f.ramps',
    render: 'mesh',
    renderNeedle: 'buildRamps',
    tuning: [],
    editor: 'ramp',
    status: 'shipped',
  },
  {
    key: 'plate',
    label: 'Pressure button',
    what: 'A raised circular metal button. It sits on any ground rather than replacing it, and drives gates and/or lifts.',
    specKeys: ['buttons'],
    physicsNeedle: 'f.plates',
    render: 'mesh',
    renderNeedle: 'f.plates',
    tuning: [],
    editor: 'button',
    status: 'shipped',
  },
  {
    key: 'shape',
    label: 'Non-rectangular board',
    what: 'Hexagon, octagon, diamond, cross, diamond ring or star footprint instead of a rectangle.',
    specKeys: [],
    used: (spec) => (spec.board?.shape ?? 'rect') !== 'rect',
    physicsNeedle: 'insideShape',
    render: 'mesh',
    renderNeedle: 'silhouetteLoops',
    tuning: [],
    editor: 'SHAPES',
    status: 'engine-only',
    note: 'Every built level is a rectangle. levels.test.js proves the collar and the rose fit every shape, so a shape level is authorable, not merely intended.',
  },
];

/**
 * Spec keys that are level metadata or format plumbing rather than mechanics.
 *
 * tests/mechanics.test.js reads every `spec.X` in levels.js and requires each one to be either a
 * mechanic's `specKeys` entry or listed here — so a new field in the level format cannot be added
 * without someone deciding which of the two it is.
 */
export const FORMAT_ONLY_KEYS = [
  'id',
  'name',
  'difficulty',
  'par',
  'hint',
  'board',
  'shape',
  'pitRadius',
  'twoRoutes',
  'multi',
  'coop',
];

/** Every TUNING_SPEC path any mechanic claims, for the tuning-parity check. */
export const MECHANIC_TUNING_PATHS = [
  ...new Set(MECHANICS.flatMap((m) => m.tuning)),
].sort();

export function findMechanic(key) {
  return MECHANICS.find((m) => m.key === key);
}

/** Does this level spec use this mechanic? */
export function usesMechanic(mechanic, spec) {
  if (mechanic.used) return !!mechanic.used(spec);
  return mechanic.specKeys.some((k) => (spec[k]?.length ?? 0) > 0);
}

/** The mechanics a level spec uses, in registry order. */
export function mechanicsOf(spec) {
  return MECHANICS.filter((m) => usesMechanic(m, spec));
}
