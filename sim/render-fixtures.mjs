//  Fixtures for the renderer-parity check: one small level per mechanic, and what the page must
//  report once it has built that level.
//
//  This file is pure data — no playwright, no browser — so the node suite can import it and
//  check the *coverage* of the check (every mechanic whose registry row claims a visual has a
//  fixture) without launching anything. sim/render-parity.mjs is what actually boots them.
//
//  Why group them: a software-GL browser boot costs seconds, and each extra page risks stalling
//  the next one's load. So related mechanics share a board, and the expectations are still
//  per-mechanic, so a missing one is named rather than lost in a crowd.

/** A 9x9 rectangle with sealed-ish corners: the frame every fixture starts from. */
const base = (extra) => ({
  id: 'parity',
  name: 'render parity',
  board: { shape: 'rect', w: 9, h: 9 },
  spawn: [1, 7],
  goal: [7, 1],
  ...extra,
});

export const FIXTURES = [
  {
    id: 'surfaces',
    what: 'the painted ground: ice, sand, steel, and the belt and vent cells',
    spec: base({
      ice: [{ rect: [1, 1, 3, 2] }],
      sand: [{ rect: [4, 1, 6, 2] }],
      steel: [{ rect: [1, 4, 3, 5] }],
      belts: [{ rect: [4, 4, 6, 5], dir: [1, 0] }],
      vents: [{ rect: [1, 6, 3, 7], dir: [1, 0] }],
    }),
    //  A material plate is not a painted cell: ice, sand and steel go through the region boolean
    //  and come out as their own mesh (`material-ice`), while belt and vent are cell overlays.
    //  So the probes differ, and that difference is the point of checking on the built scene.
    expect: [
      { key: 'ice', objectName: 'material-ice' },
      { key: 'sand', objectName: 'material-sand' },
      { key: 'steel', objectName: 'material-steel' },
      { key: 'belt', gridChar: 'c' },
      { key: 'vent', gridChar: 'v' },
    ],
  },
  {
    id: 'static-metal',
    what: 'the fixed mechanisms: posts, magnets, plates, lifts, gates, flaps, a ramp and a pit',
    spec: base({
      walls: [[4, 4, 4, 6]],
      pits: [[2, 4]],
      pegs: [{ cell: [6, 4], r: 0.26 }, { cell: [6, 6], r: 0.26, kick: true }],
      magnets: [{ cell: [7, 7], strength: 3 }],
      ramps: [{ rect: [1, 5, 3, 7], dir: [1, 0], height: 0.4 }],
      buttons: [{ id: 'p1', cell: [7, 4] }],
      gates: [{ id: 'g1', seg: [[5, 1], [5, 3]] }],
      lifts: [{ id: 'l1', seg: [[3, 1], [3, 3]], plate: 'p1', mode: 'raise' }],
      oneways: [{ seg: [[7, 2], [7, 4]], normal: [1, 0] }],
      teleports: [{ a: [2, 2], b: [2, 6] }],
    }),
    expect: [
      { key: 'wall', gridChar: '#' },
      { key: 'pit', gridChar: 'o' },
      { key: 'peg', obstacle: 'pegs', min: 1 },
      { key: 'kicker', count: (s) => s.counts.pegs >= 2, what: 'both posts, one of them a kicker' },
      { key: 'magnet', obstacle: 'magnets', min: 1 },
      { key: 'ramp', objectName: 'ramps' },
      { key: 'plate', obstacle: 'plates', min: 1 },
      { key: 'gate', obstacle: 'gates', min: 1 },
      { key: 'lift', obstacle: 'lifts', min: 1 },
      { key: 'oneway', obstacle: 'oneways', min: 1 },
      //  Presence is not enough for a flap: the leaf has to stand in the marble's way rather than
      //  float above it, and the arrow is what makes the direction readable.
      { key: 'oneway', flapStands: true },
      { key: 'oneway', objectName: 'oneway-arrow' },
      { key: 'teleport', obstacle: 'pads', min: 1 },
    ],
  },
  {
    id: 'motion',
    what: 'the moving hazards: a windmill, a pendulum and a sliding bar',
    spec: base({
      windmills: [{ cell: [3, 3], arms: 2, len: 0.9, omega: 1.1 }],
      pendulums: [{ cell: [5, 5], len: 1.1, amp: 1, freq: 0.5, phase: 0 }],
      movers: [{ from: [3, 7], to: [6, 7], len: 0.9, speed: 0.5, phase: 0 }],
    }),
    expect: [
      { key: 'windmill', obstacle: 'windmills', min: 1 },
      { key: 'pendulum', obstacle: 'pendulums', min: 1 },
      { key: 'mover', obstacle: 'movers', min: 1 },
    ],
  },
  {
    id: 'multi',
    what: 'two marbles on one board',
    spec: base({ spawn: [[1, 2], [1, 6]] }),
    expect: [{ key: 'multi-marble', count: (s) => s.balls >= 2, what: 'two marbles on the board' }],
  },
  {
    id: 'shape',
    what: 'a hexagon board, so a non-rectangular footprint is really rendered',
    spec: {
      id: 'parity-hex',
      name: 'render parity (hexagon)',
      board: { shape: 'hexagon', w: 11, h: 11 },
      spawn: [3, 5],
      goal: [7, 5],
    },
    expect: [
      { key: 'shape', gridChar: ' ', what: 'cut corners, i.e. cells outside the footprint' },
      { key: 'goal', gridChar: 'G' },
    ],
  },
];

/** Mechanic keys any fixture covers. */
export const COVERED = new Set(FIXTURES.flatMap((f) => f.expect.map((e) => e.key)));
