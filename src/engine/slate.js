//  The proposed slate for the levels after the built ones, shown in the in-game menu so the
//  progression can be discussed before it is built. Nothing here is authored yet by design:
//  levels 1-4 are authored; the rest should follow the notes that come back from playing them.

export const SLATE_NOTE =
  'Levels 5 onward are deliberately not built yet. Play Levels 1-4, then tell me which of these directions to keep, cut or reorder.';

export const LEVEL_SLATE = [
  //  1 First Tilt, 2 Peg Board, 3 Twin Track and 4 Both Locks are built: see `levels.js`. Peg Board landed as a
  //  bumper gauntlet, a windmill timing window and a wedge rather than a pendulum and ice, because
  //  those are the three obstacles that were actually finished and testable when it was authored.
  //  Twin Track is the multi-marble proof level; Both Locks is the plate-driven-wall proof.
  {
    n: 5,
    name: 'Hextile',
    shape: 'Hexagon',
    idea: 'Run the outer ring to find one of two doors into the middle chamber, with ice on the far side.',
    ask: 'Is a two-route level more fun, or does the second route make it too forgiving?',
  },
  {
    n: 6,
    name: 'Windmill Hollow',
    shape: 'Octagon',
    idea: 'Two windmills sweeping opposite ways across the only corridors, so the level is a timing puzzle.',
    ask: 'Timing gates (wait for the arm to pass) — good tension, or just annoying on a board you cannot see all at once?',
  },
  {
    n: 7,
    name: 'Conveyor Cross',
    shape: 'Cross',
    idea: 'Open edges and belts that carry the marble toward the pits — falling off is a real risk.',
    ask: 'Do you want levels where the board edge itself is the hazard, with no rim wall to save you?',
  },
  {
    n: 8,
    name: 'Vacuum Works',
    shape: 'Rectangle',
    idea: 'Fans that blow a steady stream across the lanes, plus attracting and repelling magnets.',
    ask: 'Invisible forces need a readable tell — is a visible airstream/glow outline enough, or should fans pulse?',
  },
  {
    n: 9,
    name: 'Two Doors',
    shape: 'Rectangle',
    idea: 'Teleport pads, pressure plates that hold gates open for a few seconds, and a one-way flap.',
    ask: 'Plates that open gates on a timer: keep the hold times generous, or make them tight for pressure?',
  },
  {
    n: 10,
    name: 'Sand Siege',
    shape: 'Diamond',
    idea: 'Sand kills momentum on the spine of the board while two pendulums guard the crossing.',
    ask: 'Is a sand patch (needs a steeper tilt to break free) a satisfying surface, or frustrating?',
  },
  {
    n: 11,
    name: 'Serpentine',
    shape: 'Rectangle',
    idea: 'Five long lanes joined by sliding gates, ice straights and pits at every turn.',
    ask: 'Long levels: is a one-to-two-minute run welcome, or should levels stay around 30 seconds?',
  },
  {
    n: 12,
    name: 'The Gauntlet',
    shape: 'Diamond Ring',
    idea: 'Everything at once: windmill, pendulums, a fan, magnets, kicking pegs and a goal in the middle of the ring.',
    ask: 'What should the final level be called, and what is the one mechanic it should be built around?',
  },
];
