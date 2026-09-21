// Shared tuning constants. Everything the physics uses is here so tests can reason about it.

export const CELL = 1; // one grid cell, in board units
export const BALL_R = 0.27; // marble radius (a glass marble on a 1-unit grid)
export const GRAVITY = 9.81;
// A solid sphere rolling without slipping on an incline accelerates at g*sin(t)/(1+2/5).
export const ROLL_FACTOR = 5 / 7;

export const MAX_TILT = 0.30; // rad, ~17 degrees; the real toy's stops
export const TILT_RATE = 3.2; // rad/s the player's hands can move the board
export const TILT_RETURN = 3.4; // rad/s spring-back when no input

export const V_MAX = 4.6; // hard speed cap so a fast ball can never tunnel a wall
export const DT = 1 / 180; // fixed physics step

// Visual thickness of the wooden base/slab. A level's rim is sealed all round, so the board's
// own edge never reads from the play camera; the one place its thickness shows is the cut wall
// down inside a routed hole, where it catches a sliver of light at the rim. 1/6 of the standard
// marble's diameter is the guess: thin like a real routed plank, but thick enough to read.
export const BOARD_THICK = (BALL_R * 2) / 6; // the wooden base's visible thickness (1/6 of a marble)
export const WALL_H = 0.62; // raised wall height

// --- the glass lid -------------------------------------------------------------------
//  The toy is sealed: a glass top clamped in a metal collar that stands on the rim wall,
//  with the grip mounted at the centre of the glass. This is what the player actually
//  grips and moves, so the lid tilts with the board. The physics never sees any of it, so
//  these values are pure presentation - but they still have to be physically honest:
//    * the glass must clear the largest marble the tuner allows (ballR max 0.42)
//    * it must clear the tallest obstacle on the level (scene.js measures the real
//      bounding box and raises the lid if a future level needs more room)
//    * the collar stands on the rim wall, which levels.js guarantees is sealed all round
//      (a level with an open edge could not be covered without trapping the marble).
export const LID_Y = 1.12; // glass underside, above the board plane
export const LID_THICK = 0.13; // glass thickness
export const LID_BEZEL = 0.42; // collar width that clamps the glass edge
export const LID_CLEARANCE = 0.24; // air kept between the tallest obstacle and the glass

// The grip, second design. A small knurled knob emerging from the centre of the glass: low
// enough that it never blocks the playfield, small enough to pinch between finger and thumb.
// The visual weight around it comes from a compass rose etched into the pane, which also gives
// the player a fixed reference to read the board's tilt against.
export const KNOB_R = 0.42; // knob radius (25 mm across at the toy's scale)
export const KNOB_H = 0.5; // how far it stands above the glass, collar included
// The etching is a compact dial: concentric rings with tick marks at the eight compass
// points, sized from the board rather than fixed, so it always fits in the ring of clear glass
// between the knob and the level's own holes. It is a marking first and a feature second: no
// part of it may sit over a pit (see rose.js).
// --- the level indicators -------------------------------------------------------------
//  Two ways to read the board's angle, chosen by `INDICATOR`:
//    'bars'   - a solid bar in each trough that slides to show the angle *instantly*. No liquid,
//               no lag, no sloshing: the position of the bar is the angle, recomputed from the
//               board's tilt every frame.
//    'liquid' - the shallow-water vials described below: they tilt immediately, then run, slosh
//               and settle. Slower to read, but alive.
//    'both'   - the liquid with the bars floating over it (the bar reads the angle, the liquid
//               shows the motion).
//    'off'    - bare machined troughs.
export const INDICATOR = 'bars';
// The tilt at which a bar is at the end of its travel. Full scale is the toy's own hard stop, so
// "bar at the end" always means "board at the stop", not an arbitrary number.
export const INDICATOR_FULL_ANGLE = MAX_TILT;
// Every bar is the same length, whichever trough it sits in: they are read as four copies of one
// scale, and bars of different lengths would invite comparing them to each other. The length is tied
// to the marble instead: about one marble's width (2 * BALL_R), long enough to read as a slug in the
// channel and short enough that the trough either side of it still shows how far it has travelled.
export const BAR_LEN = 0.6;
export const BAR_H = 0.17; // height of the bar, so it sits proud of the liquid it replaces

// --- the liquid level vials -----------------------------------------------------------
//  Four long troughs, one per side, cut into the metal collar that clamps the glass. They are
//  the second angle indicator (the first is the etched rose): where the rose says "the glass is
//  turning", four troughs say *which way and how much*, because the liquid stays level in world
//  space while the board tilts under it.
//
//  They live in the collar, outside the playfield, for two reasons: a vial over the playfield
//  could cover a hole (never allowed), and a trough inside the rim would be a gutter for the
//  marble to fall into.
export const VIAL_WIDTH = 0.22; // channel width, across the trough (collar is 0.42)
// Channel depth. Shallow on purpose: this is a vial *seat*, not a well. At 0.34 deep the liquid
// sat far enough below the brim that the trough's own rails hid it from the gameplay camera on the
// two sides nearest the camera (measured: the probe read pure black at the frame's edge while the
// other end of the same trough read 137). At 0.14 the surface sits just under the collar's top face,
// where nothing can occlude it.
export const VIAL_FLOOR = 0.14;
export const VIAL_CORNER = 0.7; // clear space kept at each corner for the collar's fixings
export const VIAL_CELLS = 48; // simulation cells along each trough
// How much of the channel is liquid at rest. This sets how far the surface can migrate: a trough
// filled to the brim can only slosh within its own length (measured: a 0.55 fill saturated with the
// surface at 0.7 of the way to the end), so it is kept low enough that the liquid piles into a
// short pool and the reading has somewhere to go.
export const VIAL_FILL = 0.4;

// The studio, as three independent numbers: how bright the *diffuse* lighting is (the key, the fill
// and the shadows they cast), how bright the studio lights look when they are *reflected* in the
// glass and the marble, and how big the softboxes are. Diffuse and reflection used to share one
// master, which kept the pit/floor contrast the hole check measures from drifting - but it also
// made the mirrored glare impossible to dim on its own. They are separate now: the reflection can
// go to nothing while the board keeps its shading, and either one can be turned down below the old
// floor of 0.25.
export const LIGHT_LEVEL = 0.72;
export const LIGHT_REFLECT = 1.0; // the environment at reflection = 1; see ENV_BASE in scene.js
export const LIGHT_SIZE = 1.0; // softbox size as a multiple of the default

//  What the toy is made of. The board, its raised walls, the hole bevels and the ramp are one
//  timber drawn at different tones, so a finish is a single choice that moves all of them at once
//  (see `src/render/board-materials.js`): the shipped generated walnut picture, the same picture
//  paled to birch or warmed to cherry, or a veined stone slab.
//
//  GRAIN_PROMINENCE is how loud the grain reads: it scales the fine structure of whichever finish
//  is showing, in the colour and in the relief, with 1.0 the finish exactly as it was made.
export const BOARD_FINISH = 'walnut';
export const GRAIN_PROMINENCE = 1;

//  How the rim (the frame around the board, and the walls it carries) is cut relative to the board
//  it frames:
//
//    'same'     - the board's own grain continues into the frame, so the toy reads as one piece of
//                 timber. This is the shipped look.
//    'mirrored' - the same board, book-matched: the figure turns back on itself across the joint.
//    'cut'      - a different board of the same species (an independent grain, not the picture).
//
//  RIM_STAIN darkens whatever the rim is made of, from 0 (none) to 1 (a deep stain).
export const RIM_GRAIN = 'same';
export const RIM_STAIN = 0;

//  MARBLE_LOOK selects which marble is on the board. It is a *renderer* choice, not physics: every
//  look is built at the same radius and scaled by the same size value, so the marble the engine
//  simulates is identical whichever one is showing. See `src/render/marbles.js`.
//
//  The ids are held here as plain strings rather than imported from the renderer, because the
//  engine layer never reaches into the render layer; the two lists are kept in step by a test.
export const MARBLE_LOOK = 'catseye';
//  The designs the Look dial offers. The clear-glass ones (bitcoin, geode, helix, gem, banded) are
//  shelved for now: each costs a transmission pass every frame plus a dozen pieces of geometry, and
//  smoothness comes first. They still build and still answer to `?marble=<id>`; see marbles.js.
//
//  The painted planets (earth, moon, eightball) are one map on one sphere with no glass and no core,
//  so they are offered alongside the cat's-eye: they cost a painted sphere, which is the cheapest
//  marble in the set, and that is the whole reason they ship instead of the clear-glass ones.
export const MARBLE_LOOKS = ['catseye', 'lantern', 'solid', 'earth', 'moon', 'eightball'];

//  The three dials on the glass itself, all multipliers on what a design ships:
//
//    MARBLE_TRANSPARENCY  how much light the glass passes at all (0 is a solid milky ball)
//    MARBLE_BEND          how far the refracted ray travels, i.e. how hard the ball acts as a lens
//    MARBLE_FILL          the size of the thing inside, which is what opens a clear window around it
//
//  FILL matters more than it looks: a sphere only reads as glass where its surface faces you, which
//  is the middle of the ball, so a core big enough to sit there hides the only clear part and leaves
//  a grazing-angle ring that behaves like a mirror.
export const MARBLE_TRANSPARENCY = 1;
export const MARBLE_BEND = 1;
export const MARBLE_FILL = 0.75;

//  The lantern's lamp, and the band pattern, as dials:
//
//    MARBLE_LAMP_BRIGHTNESS  a multiplier on the lamp, 1 being the measured shipped strength
//    MARBLE_LAMP_HUE         the lamp's colour in degrees around the wheel (36 is the shipped amber)
//    MARBLE_BAND_CONTRAST    how far the bands of a patterned marble swing from its body colour
//
//  Brightness and hue move the *whole* lamp - the light, the beads, the halos - so the marble and
//  the pool it throws stay the same colour. They do nothing on a marble with no lamp.
//
//  BAND_COUNT and BAND_WIDTH are the shipped pattern, which the renderer also knows (SHIPPED_BANDS)
//  because a marble has to be built with it before any dial moves; a test keeps the two in step.
export const MARBLE_LAMP_BRIGHTNESS = 1;
export const MARBLE_LAMP_HUE = 36;
export const MARBLE_BAND_CONTRAST = 1;
export const MARBLE_BAND_COUNT = 4;
export const MARBLE_BAND_WIDTH = 0.45; // matched to the renderer's shipped pattern by a test
//  The opaque marble's body colour. Any CSS hex: the picker in the sheet writes straight into this,
//  and the bands are derived from it, so one colour recolours the whole marble coherently.
export const MARBLE_SOLID_COLOR = '#15171d';

export const ROSE_RINGS = [0, 0.5, 1]; // ring radii: evenly spaced across the free annulus
// How much more widely the rings are spaced than the original even split of the clear annulus.
// 1.5 = gaps 50% larger. The annulus is finite, so `roseDesign` clamps the innermost ring just
// outside the knob seat; on the shipped levels that clamps the achieved spread to ~1.44x.
export const ROSE_SPREAD = 1.5;
// Etched line width, shared by the rings and the tick marks. A pale wide line reads as paint on
// the glass; the natural marking is a fine groove, so this is 16% thinner than the first cut. The
// limit is measurement, not taste: at 0.032 the rings rendered as "very faint, almost blending into
// the wood grain" from the playing camera and the tick marks disappeared, which costs the rose
// both of its jobs (weight around the knob, and the reference the player reads the tilt against).
// Making the material darker and specular cost the rings a little more presence at distance, so
// the width came back to 0.042 rather than 0.038. Lines this narrow also need matching
// tessellation (see flatRing) or the ring polygonises into visible facets.
export const ROSE_LINE = 0.042;
// The circles are drawn 25% thinner than the ticks that share their material, so the rings read as
// fine and the eight compass points keep the weight they need to be legible at playing distance.
export const ROSE_RING_LINE = ROSE_LINE * 0.75; // the circles, 25% thinner than the ticks
export const ROSE_SINK = 0.035; // how far below the glass surface the etching sits
export const ROSE_MARGIN = 0.16; // clear air kept between the outermost etching and any hole
export const ROSE_TICK = 0.42; // length of the long (cardinal) ticks

// How large the toy appears: the camera sits 1/VIEW_SIZE as far away, so 1.1 draws the whole
// board 10% bigger on screen with the physics untouched.
export const VIEW_SIZE = 1.1;

// The board is viewed from nearly straight above, through a long lens. Both parts matter: the
// steep angle is what stops a level board from reading as tilted, and the narrow field of view
// flattens the keystone further, because the board's own depth is what makes the near edge
// wider than the far one on screen. Measured on the rendered outline: at the old 39-degree,
// 42-degree-lens view the near edge was 22% wider than the far edge; here it is under 6%.
export const VIEW_ELEV = (9 * Math.PI) / 180;
export const VIEW_FOV = 32;

// The panel is a right-hand sheet, so when it is open the board is centred in what is left
// of the screen rather than in the window. This is the gap the panel keeps from the edge.
export const PANEL_GUTTER = 12;

// Hole and cup geometry. The physics captures the marble strictly inside the drawn hole, and
// the renderer cuts the same shapes out of the board - see slabHoles() in silhouette.js.
export const PIT_R = 0.42; // rendered pit radius (the routed hole in the board)
export const GOAL_HOLE_R = 0.46; // rendered cup mouth, kept inside one cell
export const PIT_CAPTURE = 0.76; // ball falls in when within PIT_R * this
export const GOAL_R = 0.52;
export const GOAL_CAPTURE = 0.8;
export const OFF_EDGE_MARGIN = 0.6; // how far past the rim before the ball is "gone"
export const BALL_R_MAX = 0.42; // the tuner's upper bound; the lid must clear this marble

// Per-surface rolling behaviour, all in board units.
//   drag : linear damping, 1/s  (sets the terminal speed for a given tilt)
//   roll : rolling resistance, units/s^2, and the static threshold that parks a
//          stationary marble until the tilt is steep enough to break it free
//   mu   : tangential friction against walls, pegs and other obstacles
export const SURFACES = {
  wood: { drag: 0.85, roll: 0.06, mu: 0.22, color: 0xc39a63 },
  ice: { drag: 0.06, roll: 0.012, mu: 0.02, color: 0xcfe9f2 },
  sand: { drag: 3.0, roll: 0.52, mu: 0.85, color: 0xd6ba86 },
  steel: { drag: 0.5, roll: 0.03, mu: 0.14, color: 0x9aa2ac },
};

export const WALL_RESTITUTION = 0.42; // bounciness of walls
export const PEG_RESTITUTION = 0.72; // bumpers kick harder
export const KICKER_IMPULSE = 3.4; // pegs that actively fire the ball away

// --- windmill -----------------------------------------------------------------------
//  The mill is a real object: a post the arms turn on, and arms with a thickness. Both are
//  colliders, because a marble that can roll *through* the post or clip the edge of a blade
//  is reading the picture, not the object.
export const WINDMILL_HUB_R = 0.19; // the post at the centre of the arms
// Half-thickness of an arm. The drawn bar is 0.17 wide, so this is its half-width: the
// collider is the arm you can see rather than a mathematical line.
export const WINDMILL_ARM_R = 0.085;
// How much of the arm's own surface speed is handed to the marble at the contact point.
// 0 makes an arm a wall that only shoves by its own approach; 1 is an honest swing; a
// little over 1 gives the mill the snap the drawn arms promise.
export const WINDMILL_SWEEP = 1.15;

// --- ramp ---------------------------------------------------------------------------
//  A ramp is a wedge glued to the board: ground that rises along its length. Two things
//  make it a ramp rather than a fan with a picture on it — the marble *climbs* (its height
//  follows the wedge, and climbing costs it speed through the same gravity that made it), and
//  the slope comes from the wedge's own geometry (its height over its run), never a magic
//  number. Its walls are geometry too: the tall face is a step no marble can climb, and the
//  sloping side walls can be climbed only up to `RAMP_STEP_UP` of the tall side. The one
//  number that is not geometry is `RAMP_LAUNCH`, the readability gain on the crest's hop.
//  See "Ramps" in docs/DESIGN.md for the rules the tests hold it to.
export const RAMP_HEIGHT = 0.35; // default wedge height at its crest, board units
// A clamp on sin(theta), not a taste knob: a level must not be able to build a climb so steep it
// is a wall rather than a slope, whatever height and run it was given.
export const RAMP_MAX_SLOPE = 0.75;
// How tall a step the marble can climb onto, as a fraction of a ramp's tall-side height. A
// wedge's vertical side walls are the tall-side height at their crest end and zero at the low
// end, so on the linear wedge we build, "steps up to half the tall side" lands exactly at the
// half-way point: the marble can enter from the side anywhere on the shallow (low) half, and
// nowhere on the stepped half. The tall face itself is a full-height step, so it stays closed.
export const RAMP_STEP_UP = 0.5;
// Readability gain on the vertical speed the marble carries off a crest. The board's wedges are
// shallow and its gravity is board-scale, so the honest `v * tan(theta)` a crest hands over is a
// few thousandths of a unit - an invisible hop. This multiplies that into a launch you can see;
// because it scales the marble's speed, a faster crest means a longer flight.
export const RAMP_LAUNCH = 8.0;

export const CONVEYOR_SPEED = 1.5; // belt surface speed
export const VENT_ACCEL = 3.2; // fan/vent push
export const MAGNET_STRENGTH = 3.0; // signed; negative repels
export const TELEPORT_R = 0.34;
export const TELEPORT_COOLDOWN = 0.45;
export const BUTTON_R = 0.36;
export const BUTTON_R_MAX = 0.48; // the level editor's upper bound for an authored button radius
//  How far a pressed button's cap sinks below its resting height (board units). Small on purpose:
//  the cap is already raised, and the travel only has to read as "held", not as a switch throw.
export const BUTTON_TRAVEL = 0.035;
export const GATE_OPEN_TIME = 4.0; // seconds a button keeps its gate retracted

//  A LIFT is a wall slab that a pressure plate raises out of the floor or sinks back into it,
//  while the plate is held. It is deliberately *not* a gate: it has no timer, so it is exactly
//  as high as the plate's state says (a marble on the plate holds it up or down), and it moves,
//  so you can watch it come. `LIFT_SPEED` is how fast the slab travels through its own height
//  (0 = flush, 1 = full height), and `LIFT_SOLID` is the fullness at which it blocks: a slab
//  less than half raised is a ridge the marble rolls over, more than half is a wall.
export const LIFT_SPEED = 6.0; // height fractions per second (a quarter second, floor to full)
export const LIFT_SOLID = 0.5; // the fraction of full height at which a lift becomes a wall
//  A lift is a WALL, not a mathematical line: its slab is as wide as a wall cell and as tall as
//  a wall, and it is driven the full height out of a routed slot. `LIFT_HALF_W` is half the
//  slab's width, so the physics collider is exactly the slab you can see - a marble stopped by a
//  raised lift stops at the same face a wall would stop it at, and a slab still on its way up
//  pushes a marble off toward whichever side of it the marble is more on.
export const LIFT_HALF_W = 0.485; // half the slab's width (a wall cell is 0.97 across)
export const LIFT_H = WALL_H; // the slab's height: a raised slab stands exactly as tall as a wall
