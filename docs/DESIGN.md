# Marble Maze — design notes

## What this is

A tilt maze, the way the physical toy works: the whole unit is sealed under a glass lid with
a grip at its centre, you hold the grip and tip the toy. The marble is a glass cat's-eye, the
board is wood, and every obstacle in the game is something a real builder could put on such a
board — raised walls, routed holes, brass bumper posts, windmill arms,
pendulums, sliding gates, conveyor belts, glued-down timber ramps, fans at the corners, magnets,
pressure plates, plate-driven wall slabs that slide up out of the floor or sink back into it,
teleport "pipes" that just move the marble from one pad to its twin, and pits that move.

Nothing in the game cheats physically: **the player has exactly one control, the tilt of the
board** (held by its handle), and everything else follows. That constraint is the whole design.

## Physics

Simulated in *board space* (x, z), with the board itself tilting in 3D for the camera.

```
tilt about board X  ->  in-plane gravity component  g·sin(tilt.x)  along +z
tilt about board Z  ->  in-plane gravity component  g·sin(tilt.z)  along +x
rolling sphere      ->  only 5/7 of that, because 1/(1+2/5)
```

- **Fixed step** 1/180 s, no RNG, no wall-clock. Same inputs → identical run, bit for bit,
  which is what lets the autopilot double as a proof of playability.
- **Surfaces**: `wood`, `ice`, `sand`, `steel`. Each has drag (sets terminal speed), rolling
  resistance (a *static* threshold plus a decelerating force — a marble parked on sand at a
  shallow tilt stays parked until you lean on it), and wall friction.
- **Colliders**: line segments for walls, gate bars, windmill arms, pendulum rods and sliding
  bars; discs for bumper posts and windmill hubs (which are solid — the marble cannot roll through
  the post the arms turn on). A segment may have a half-thickness, so a windmill arm's collider is
  the arm you can see rather than a mathematical line. Moving colliders report the velocity of the
  surface **at the contact point**, so they carry and bat the marble rather than acting like static
  walls: an arm's tip throws and its hub nudges.
- **Ground height**: the marble has a height as well as a position, because a ramp changes the
  ground under it. The renderer sits the marble on its own height and its contact shadow on the
  terrain under it, and a marble that leaves a crest at speed follows a real ballistic arc back
  down, so a fast crest reads as a launch and a slow one as a drop.
- **Marble**: radius 0.27 on the unit grid, a rolling sphere with `5/7` of the plane gravity.
- **Speed cap** 4.6 units/s, well under the per-step distance that could tunnel a wall
  (tested at full tilt for a minute, hammering every wall).
- **Fall and capture**: a pit captures when the marble's centre is inside 0.76 of the pit
  radius; the cup captures inside 0.8 of its radius; a marble whose centre leaves the
  footprint rolls off the board and is lost. A receiving teleport pad re-arms only after the
  marble has rolled clear, so it cannot ping-pong.

## Level format

A level is a small declarative object against a grid of unit cells (see
`src/engine/levels.js`):

```js
{
  board:  { shape: 'hexagon' | 'rect' | 'octagon' | 'diamond' | 'cross' | 'diamondRing' | 'star', w, h },
  walls:  [[c0, r0, c1, r1], ...],     // inclusive rects filled with raised wall
  carve:  [[c0, r0, c1, r1], ...],     // rects forced back to plain floor (opens gaps)
  spawn,          // one cell [c, r] — or a LIST of cells for a multi-marble level
  goal,           // the one cup every marble must reach
  pits:   [[c, r], { c, r, move: [dc, dr], speed }],
  ice, sand, steel:  [rect, ...],
  belts:  [{ rect, dir }],  vents: [{ rect, dir }],
  windmills: [{ cell, arms, len, omega, phase }],   // negative omega runs the other way
  pendulums: [{ cell, len, amp, freq, phase }],
  movers: [{ from, to, len, speed, phase }], pegs: [{ cell, r, kick }],
  ramps:  [{ rect, dir, height }],     // a wedge; `dir` is the UPHILL traverse, rect in cell EDGES
  magnets: [{ cell, radius, strength }],        // negative strength repels
  teleports: [{ a, b }],  buttons: [{ id, cell, gate, hold }],  gates: [{ id, seg }],
  lifts: [{ id, seg, plate, mode: 'raise' | 'lower', speed }],
  oneways: [{ seg, normal }],
}
```

A **plate** may carry an `id` so a lift can name it, and its `gate` is optional: a plate with no
`gate` is complete on its own and simply drives lifts.

A **lift** is a wall slab a plate raises or lowers *while the plate is held*. Unlike a gate it has
no timer: `mode: 'lower'` rests raised and sinks under a marble on its plate, `mode: 'raise'`
rests flush and stands up while the plate is held. `speed` is how fast it travels its own height
(heights per second; default 6). The slab is solid once it is more than half up, and a raising
slab is a moving collider, so it can never post a marble inside a wall band.

The builder turns that into a grid, wall collision segments, feature lists, a board
silhouette and world-space positions. It **fails closed**: an off-board rect, a surface
painted over a wall, or a pit on the spawn throws at build time rather than producing a
level that half works.

## Design rules the tests enforce

1. **Fair by construction.** Spawn and goal on walkable floor; a pit may never seal the only
   route; the marble must fit every walkable cell (its diameter plus steering room).
2. **Early levels are generous.** Levels with difficulty ≤ 3 may not contain a one-cell-wide
   squeeze anywhere.
3. **The board is one closed piece.** The footprint outline is exactly one loop whose area
   equals the footprint cell count — this is what allows the renderer to draw a single solid
   board with grain running across it, and it catches level-authoring mistakes.
4. **Playable with tilt alone.** The autopilot must finish the level from the spawn with no
   falls, and recover from a jammed corner.
5. **No free rides.** With the board level, the marble does not drift or reach the goal.
6. **Par times are achievable.** Par may not be faster than the route length at terminal speed.

## Obstacle vocabulary

| Feature | What it does to the marble | Readability |
| --- | --- | --- |
| Raised wall | Reflects with 0.42 restitution, tangential friction | Wood blocks with a lit chamfer |
| Pit | Swallows on centre contact; the attempt ends | Real routed hole cut through the slab: a wood bevel around the mouth shows the board's thickness, then a dark shaft below |
| Ice plate | Almost no drag; keeps speed through corners | Pale blue, specular |
| Sand patch | High drag, and it grips at shallow tilt | Gritty speckle |
| Bumper post | High restitution; some posts actively kick | Brass post with a steel collar |
| Windmill | A solid post whose arms bat the marble with the surface velocity *where they touch* — a tip strike throws, a hub strike nudges | Iron arms, red tips, on a real post |
| Ramp | A wedge the marble climbs, launch-off at the crest; the crest face and the stepped half of each side are walls it cannot climb | Paler timber with a brass wear strip along the crest |
| Pendulum | Swings across a corridor, sweeping the marble | Iron rod with a red bob |
| Sliding bar | Blocks a gap on a cycle, carries the marble | Red hazard bar with steel trim |
| Conveyor belt | Drags the marble toward its surface speed | Animated ribbed belt |
| Fan / vent | Steady in-plane push | Grille plate; later: a visible airstream |
| Magnet | Attracts or repels inside its radius | Brass (attract) or iron (repel) disc |
| Pressure plate | Opens its gate for `hold` seconds, and drives any lift that names it | Gold disc, glows when pressed |
| Lift, `lower` | A wall slab that rests raised and sinks while its plate is held | Iron bar with a brass cap, sliding down into its slot |
| Lift, `raise` | A wall slab that rests flush and stands up while its plate is held | The same, sliding up: a bar you can see come |
| One-way flap | Blocks from one side only | — (level 7) |
| Teleport pads | Move the marble to the twin pad, keeping its speed | Cyan disc that re-arms when cleared |

## Ramps

A ramp is the one obstacle that changes the shape of the board instead of its behaviour, so it
is specified rather than merely listed.

**What it is.** A wedge glued to the board: a rectangle of ground that rises along one axis.
`{ rect, dir, height }`, where `rect` is in cell EDGE coordinates exactly as a material plate is
(so `[5, 1, 9, 3]` covers cells 5..8 by rows 1..2, and an eighth of a cell is a legitimate edge),
`dir` is the direction the marble **traverses** it — uphill, from the low edge to the crest — and
`height` is how tall the wedge stands at that crest. Unlike a belt or a fan, whose `dir` is the way
it pushes, a ramp's `dir` is the way the ride goes, so the level editor's arrow points the way a
marble launched off the crest is already travelling.

**The slope is the wedge's own geometry, never a number.** It is `height` over the rect's run
along `dir`, so a short tall ramp is steep and a long low one is gentle, and the climb the player
feels can never disagree with the wedge they can see. `sin(theta)` is clamped at `RAMP_MAX_SLOPE`
so no level, however tall, can build a climb too steep to ride.

**The marble climbs, and the climb costs it.** Ground height under the marble follows the wedge,
and the wedge pushes back down it at `g·sin(theta)·roll` — the same gravity and the same rolling
factor the board's own tilt uses. So the marble's speed pays for the height it gains and it gets
the speed back on the way down, with no separate ramp physics to keep in tune. The rendered
marble and its contact shadow sit on that same height, from the same numbers the collider uses.

**The crest launches it.** As it climbs, the marble carries the rate the ground rises beneath it;
when the ground falls away past the crest it keeps that rate, and `RAMP_LAUNCH` multiplies it into
a hop you can see. The launch is `RAMP_LAUNCH × grade × speed along dir`, so the faster it
crests the higher and further it flies, and the honest board-scale slope alone (a few thousandths
of a unit) would be invisible — hence the one readability gain, which only ever fires on the step
the marble leaves the ground. A marble in the air is above the holes it passes over until it
lands, and its shadow stays on the terrain below it.

**It is a one-way hill, with a stepped half-wall on each side.** The crest carries a vertical
face: a marble on the ground cannot climb it, while a marble already up on the wedge crests it
and launches. The two sloping side walls are walls too, but a marble may climb a step up to
`RAMP_STEP_UP` (half) of the wedge's tall side; since the wedge is linear, that lands exactly at
the half-way point, so each side is open along its shallow low half and closed along its stepped
crest half. The low edge itself is open across its whole width. A ramp is therefore *not*
something you ride back down.

**Authoring consequences**, which `validate.js` warns about:

- A pit inside the ramp swallows the marble before the slope has done anything.
- If the crest backs onto a wall or the board edge, the marble crests straight into it.
- A belt or fan under a ramp pushes as well, so the marble gets two forces and a surface that
  does not match the wedge's picture.
- A ramp must not point the marble at the cup, because rule 5 below still holds: a level board
  must not be able to finish the level on its own. (A launch needs speed, and speed needs tilt,
  so a crest still cannot be crested on a level board — but a strong launch is worth checking.)

## Levels

**Built and verified**

1. **First Tilt** — rectangle, 16×11. Two routes from the bottom-left spawn to the top-left
   cup, five pits in two-wide lanes, and two brass posts in the middle lane as the first
   taste of an obstacle that pushes back. Par 34 s.

2. **Peg Board** — rectangle, 14×10. A single sweep through three lanes: a bumper gauntlet
   across the bottom, a windmill timing window mid-board, and a wedge across the top lane that
   the marble climbs one way and launches off the crest. Par 48 s. It is the level that exercises
   the three obstacles together, and it is the level that found the marble being shoved inside
   a wall by a windmill arm.

3. **Twin Track** — rectangle, 12×9. **Two marbles**, mirrored about the central lane (rows 3
   and 6), with a funnel of opposing wall bands that deflects each one into the shared lane and
   on to the cup. Every marble must reach the goal: the run is won only when both are home, a
   fall returns just the one that fell, and two marbles collide rather than pass through each
   other. Par 26 s. It is the level that proves the multi-marble path end to end.

4. **Both Locks** — rectangle, 15×11. **Two marbles**, one plate, and **two lift slabs driven
   by it in opposite directions**: standing on the plate sinks the neighbour's door and raises
   the holder's own, so a marble can open the way for its fellow only while barring itself. One
   holds the door, the other goes, and the holder goes last. A `coop` level: it is the one level
   the single-marble autopilot cannot play, and it is checked by a scripted two-marble plan
   instead. Par 34 s.

**Proposed (not built — see `src/engine/slate.js`, and *levels → Planned slate* in game)**

5. Hextile — hexagon with a ring route and two doors into the middle chamber.
6. Windmill Hollow — two windmills sweeping opposite ways; timing puzzle.
7. Conveyor Cross — plus-shaped board with open edges and belts feeding the pits.
8. Vacuum Works — fans and magnets; needs a readable tell for invisible forces.
9. Two Doors — plates and gates, one-way flap, teleport pads.
10. Sand Siege — sand spine, pendulums guarding the crossing.
11. Serpentine — long lanes, sliding gates, ice straights.
12. The Gauntlet — everything, goal in the middle of a diamond ring.

The slate is ordered by *concept introduced*, not decoration: 1 teaches tilt and holes, 2
adds obstacles that push back and the first wedge, 3 adds a second marble and the "all of
them home" win, 4 adds plate-driven walls and cooperation between two marbles, 5 adds
routing, 6 adds timing, then surfaces, then state (gates), then combinations.

## Multiple marbles

A `spawn` list (rather than a single cell) puts more than one marble on the board. The engine
builds one `ball` per spawn, steps them in order, and runs a marble-versus-marble collision
before each step: equal-mass spheres, the overlap pushed out along the line of centres with a
little restitution, and a positional push vetoed if it would shove a marble inside a wall (the
static pass would only undo it). `world.ball` is still the first marble still rolling, so the
camera, audio mix and autopilot need no notion of "which marble" — and the autopilot finishes a
multi-marble level by working the marble in play, then the next, which is what proves the level
is playable by tilt alone.

The win condition is `allHome`: every marble `sinking` or `won`. One marble in the cup sets the
run status only when the last one drops in, so a two-marble level cannot be won by half a job.
A fall is per-marble too: `resetBall(world, ball)` returns one marble to its own spawn without
disturbing the others or recentring the board, while `resetBall(world)` is still the whole-run
restart. Rendering matches the count: `setLevel` builds one marble mesh, contact shadow and pool
per spawn, the transmission buffer is sized to the largest footprint on screen, and the HUD
shows a `marbles` chip (`home / total`) only when there is more than one.

## Tuning

`constants.js` holds the **shipped defaults**; the physics reads every feel-relevant number
from `src/engine/tuning.js`, and `TUNING_SPEC` there is the single source of truth for the
slider panel (label, range, step, units and an explanation per knob). Tests enforce two
invariants: the spec covers every key with defaults inside their ranges, and the level stays
solvable under every preset — so no feel setting can quietly make a level unwinnable.

### Testing past reasonable: range modes and saved profiles

The documented `min`/`max` on a spec item is the range the *game* considers reasonable. It is
not the range a *tester* is allowed: `RANGE_MODES` (Normal / Wide ×3 / Extreme ×12) widens
every slider outward by a factor, and `rangeFor(item, mode)` is the only place that widening
is computed, so the panel and the clamp cannot disagree about it. Widening is strictly
expanding — the documented range always sits inside the widened one, and no mode can hide a
shipped value — and the widened limits are snapped back onto the item's own step grid so the
slider positions stay whole numbers.

Values are clamped to the **widest** mode rather than to whatever the panel is showing. That
is what makes a saved profile safe: a set of numbers taken at Extreme keeps its exact values
when the panel is switched back to Normal, and loading a profile restores a value the
narrower slider could not otherwise express. Narrowing the range is a *view* change and never
rewrites a number.

Profiles live in `src/engine/profiles.js` (localStorage, `marblemaze.tuning.profiles.v1`) as
`{ patch, range, saved }` — a diff from the shipped defaults plus the mode it was saved under,
so a profile that only changed gravity follows whatever the shipped numbers become for
everything else. The store degrades to "no profiles" when storage is unavailable, so private
browsing costs the feature and never the game.

`tools/bake-tuning.js` writes chosen values back into `constants.js`, and the test suite then
verifies that `DEFAULT_TUNING` still agrees with the constants. That agreement check is what
makes "bake it in" safe rather than hopeful.

## Rendering

- A **ramp is real geometry**, not a decal: a wedge prism whose top surface slopes from `height`
  at the crest to the board at the low edge, with the vertical face under the crest and the two
  triangular sides (whose stepped crest halves are walls to the physics, since a marble may only
  step up onto the shallow half). It reads from the playing camera by tone as well as shape — it is a
  paler timber than the board and its raised walls, with a thin brass wear strip along the crest,
  which is the clearest thing a near-top-down view can say about which end is the top. The wedge
  is built from the same `height`/`run` numbers the collider and the marble's height use, so the
  surface drawn and the surface felt cannot drift apart.
- The board is **one extruded solid** built from the footprint outline, with the pits and the
  cup **cut out of it** as circular holes, and a hole shows the real shaft below it rather than a
  painted disc.
- **The wood is one picture of one board** (`assets/wood-board.png`, 1536x1056, generated with Krea
  2 Turbo at 8 steps, mapped in board coordinates and clamped, so it is not tiled: the span is wider
  than the widest board and the board sits inside the middle of the picture). The first board
  generated was 1024x704; it was replaced by the 1536 one because a head-to-head lit comparison
  read the 1024 as *softer and more averaged out* while the 1536 showed finer grain and a knot, and
  the extra pixels cost only **+0.19 to +0.23 s** at load (measured: 7.310/7.311 s ready at 1024
  against 7.542/7.497 s at 1536, cold, under SwiftShader). Detail matters most in the narrow bevel
  annulus a hole exposes, which is a 0.1-unit band of the picture: at 1536 that band is 9.6 px of
  grain rather than 6.4. It was chosen against the procedural
  canvas texture it replaced in a side-by-side lit render (2026-09-19): the procedural grain was
  "too uniform in thickness and spacing, too high contrast, and with no pores". The picture is the
  albedo; the **normal and roughness maps are derived from it**, from a high pass of its luminance,
  so the relief is the grain and not the picture's own soft lighting, which is divided out first
  (`src/render/wood-image.js`). The procedural fields remain as the fallback if the picture cannot
  be loaded - a missing asset is a worse board, not a broken game.
- **The candidate boards** (`tools/materials.html`, `src/render/board-materials.js`) are a decision
  aid, not shipped content, and they are built to be judged honestly rather than to flatter. Birch
  and cherry are the walnut *picture* with a tone curve, a colour cast and a grain contrast applied
  (`PHOTO_TIMBERS`), because the grain structure - pores, cathedral figure, bundles of different
  widths - is the part the procedural fields could not fake and the part a species choice is really
  about; a real board for the winner would be generated, not recoloured. Marble is the one attempt
  to fake stone procedurally: three warped vein families with pale haloes, a slow field choosing
  between a cool and a warm mineral, and crystal speckle. Their close-ups come from a
  native-resolution band of the picture placed with its own `span`/`offset`, so the view runs about
  1:1 with the texels and the grain being judged is the asset's own, not the renderer's
  interpolation. **Grain prominence** is one knob through both families: for a picture it scales the
  fine structure about the mean and carries into the normal strength and the pores, and for stone
  it scales the veining the same way, with the fields themselves generated once and never rebuilt
  per slider step.
- **The finish is a tuning-sheet setting**, in the same place as the light and the glass, because it is
  the same kind of thing: presentation, not physics. `boardFinish` and `grainProminence` therefore live
  in `DEFAULT_TUNING` and `TUNING_SPEC` with the light controls, get saved with every other setting, and
  are ignored by `?physics=default`. The renderer reads them in `applyBoardFinish`, which rebuilds the
  five wood surfaces (board, hole bevel, wall body, wall cap, ramp). That is the expensive control in
  the sheet - five surfaces' worth of maps - so `main.js` debounces it by 220 ms and the board keeps its
  last-built look while the slider is still moving. The map caches are bounded for the same reason: a
  dragged slider would otherwise hold every grain value it passed through, so `wood-image.js` keeps one
  finish's worth of maps per picture and disposes the oldest as new ones are built.
- **The rim is its own decision** (`rimGrain`, `rimStain`): whether the frame around the board continues
  the board's grain (*same*, the shipped look), mirrors it (*book-matched*), or is an independently
  generated grain of the same species (*another board*), plus a stain available on any of the three.
  Only two of those were even possible without leaving the picture: it covers exactly the board, so a
  rotation would put the frame on the image's clamped edge, and there is no spare region to move the
  rim into. A *mirror* stays inside the picture; *another board* deliberately leaves it for the
  procedural fields, and is offered with that stated rather than dressed up as a photograph.
- **Every wood surface samples the same board-plane field**, `uv = (x, -z)`, the coordinate the
  slab's own caps have always used (`src/render/wood-uv.js`). This is what makes the grain run
  *into* the depth where a hole exposes it: the bevel of a pit is the wood that was routed out of
  it, read straight down the same axis, so the grain continues off the floor, down the funnel, and
  a plank joint crossing a hole reads as a line running down the inside wall. It also fixed three
  things that were wrong before: a hole's funnel used to sample a stretched, unrelated crop of the
  texture (CylinderGeometry's own UVs), the slab's outer edge sampled one smeared row of the tile,
  and the ramp had no UV attribute at all, so it rendered as a single texel of flat colour. Nothing
  in the projection depends on where the holes are, which is why one picture serves every level and
  nothing has to be re-rendered per hole layout.
- The bevel is the **same tone as the board** for the same reason. It used to be a deliberately
  paler timber, which twice read as "an inlaid ring" around every hole rather than as the board's
  thickness; the leaning cone does the work of making it visible on its own, because it faces up
  into the key light where the slab's own vertical cut faces away from it.
- The board's **thickness reads at the holes**, as `BOARD_THICK` (1/6 of a marble) of wood, and
  it has to be shown as a *bevel*, not the vertical cut wall. The camera sits 9 degrees off
  vertical and a hole's own wood shadows its straight wall, so the wall renders unlit (~32/30/29
  against a 165/110/68 floor) and reads as black at any depth. Each hole therefore gets a
  shallow wood funnel (`assets.woodEdge`, double-sided) from the rim down to a throat one
  `BOARD_THICK` inside, and the shaft starts at that throat, under the slab. The top opening keeps
  the hole's authored radius, so the drawn-hole contract is unchanged; only the decorative bevel
  and the shaft's start move.
- **A slot's funnel is one band round the whole outline, never one funnel per centre.** A slot is a
  single region (a chain swept by the radius), so its bevel and its bore are built as a band between
  the *same outline* at two radii — `holeRingPair` walks the boundary once and evaluates it at the
  mouth radius and at the throat radius, giving the two loops matching vertices. Lofting a funnel at
  every sampled centre instead leaves a row of overlapping circular rims **inside** the slot, each
  reading as a separate hole the board does not have, and a disc under every centre for the bottom.
  `holeRingPair` exists so the two loops cannot drift: at a bend's inner corner the throat is not a
  constant normal offset of the mouth, and two independent walks would leave a seam or a twist there.
  The same band reduces to the old cone for a single round pit.
- **Two holes that overlap are one hole, so they are combined before anything is drawn.** The slot
  fix above is the same rule one level up: two separate pits whose swept regions share ground must
  not each stamp their own rim, or the board shows a seam across the ground they share and reads as
  two overlapping holes instead of the one opening it really has. `holeClusters` groups holes that
  touch (transitively), and `combineHoleRings` returns the union of each group as loops wound like
  every other hole — one outer ring per connected piece, with any enclosed void as a `voids` loop.
  The slab cut, the funnel, the bore, the floor cap and the editor's plan view all take the union,
  so the rim runs round the combined outside only. A group of one hole is returned **untessellated,
  bit for bit**, so a single round pit or a slot that is already one region is drawn exactly as it
  was before this existed; and because no shipped level has two holes that overlap (`holeProblems`
  still refuses it at authoring time), the change is inert for every level that already worked.
- **The hole check reads the board through the lid, and the lid's pane adds a constant.** This is
  now measured rather than suspected. With the lid meshes hidden (`lid-glass` and the `lid-haze-*`
  sheets), the same sample points that the check uses read **pits at 7.4-10.3 against a floor of
  87.1** - a ratio of 0.085-0.118, against a threshold of 0.55, so the holes are *five times* darker
  than the check needs. With the lid drawn, the same points read pits at ~63 against a floor of
  ~114: the pane's additive sheen lifts everything, and it is what took the check from a 5x margin
  to a 1% miss. Several runs on 2026-09-19/20 - three of them on builds a session had not touched -
  read every surface within a few units of the same value (`floor 159.7 / pit 160.5`,
  `floor 160.4 / pit 160.1`, `floor 161.2 / pit 158.8`) and reported 30 errors each; two others
  read pits at 25-32 against a floor of 88-116 and passed. The lighting values in every report are
  identical (`envIntensity 0.4464`, `lights [0.23, 1.512, 0.54, 1.008]`), so this is not a lighting
  parameter but how much of the haze has faded in when the read happens. Settled, the pane's own
  specular is worth about **+16** at that sample point (132,101,82 falling to 116,86,65 when the
  glass's `specularIntensity` is zeroed, with the haze at its resting opacities 0.34 / 0.2 / 0.09);
  a washed run is the same pane caught mid-fade. **A hole-readability failure should be re-taken with
  the lid hidden before it is believed**, and the check would be stronger if it measured the board
  rather than the board seen through a pane.
- Two things that are *not* the cause, both measured, so nobody has to re-derive them: **the wood
  source does not move a pit's dark interior at all** (a profile across one pit is byte-identical -
  centre 62.7 - with the generated board picture, at 1024 and at 1536, and with the procedural
  fallback), and **neither does the bevel's tone** (pits read 10.3/8.6/9.8/7.7/7.4 with the bevel at
  the board's own tone and at 1.06 of it). The pit's centre pixel is the *shaft*, not the bevel; the
  bevel's tone only moves the capture-zone ring, by about two units, which is why the bevel can
  safely be the board's own timber, as it now is.
- **A hole must always be visible where it is lethal.** `slabHoles()` in the engine is the
  contract between physics and rendering: it lists every hole to cut, and `holeProblems()`
  rejects any level whose *drawn* radius is smaller than the radius at which the marble is
  captured. Tests assert the same invariant, and the browser check reads back the rendered
  pixels to confirm each pit centre is dark, the capture zone is dark, and just outside the
  rim is ordinary floor. This exists because a refactor once made the board a single solid
  slab over the pit cells: the pits stayed lethal and stopped being visible, which is how a
  player ends up repeatedly falling into a hole that is not there.
- **The cup is dark, and the cue is on its rim.** The goal's bore is solid near-black, and the
  reading is a soft-edged patch of light that laps the brass ring around it (posed straight off
  `world.time`, so it is frame-rate independent and exactly reproducible in a check). The earlier
  cue was a warm glow *inside* the shaft, which made the one hole the player is aiming for read as
  a lit recess rather than a hole. The light is deliberately not a piece of geometry: a torus arc
  has two cut ends and a hard tube edge, which reads as a second ring of metal laid on the brass
  rather than as light. It is a flat, feathered glow held just clear of the tube, so its falloff
  reaches zero everywhere and it spills onto the brass and the wood the way a lamp on the rim would.
  It laps the rim at `GOAL_LAP_RATE` = 2.2 rad/s (about a 2.9s lap) and breathes at
  `GOAL_LAP_BREATH` = 4.8 rad/s. Measured: the cup renders at 28 against a floor of 94; the light's
  opacity stays in a gentle 0.28-0.56 band. The browser check asserts the cup stays dark, the
  light's angle advances, and its opacity neither sticks nor flashes.
- **A hole's outline is a polyline we generate, not a curve the geometry builder tessellates.**
  `holeRing` (engine/hole-ring.js) walks the pit or slot boundary and emits points *on* the arc,
  one facet per `MAX_CHORD` = 0.03 board units (about 11 screen px at the closest the game gets
  to a pit, so a third of a pixel of sagitta). It replaced `Path.absarc` for a reason worth
  writing down: the tessellation of a path's curves is the *builder's* choice, every builder here
  asked for `curveSegments: 4`, and that drew every pit as an **octagon** — a straight-sided
  polygon where the player is aiming at a hole. It is the same rule `flatRing` already followed
  for the rose's rings (pick the segment count from the geometry, from both ends). Because the
  ring is pure points it also serves as the polygon a material plate is cut with, so the plate's
  edge and the slab's wall are the same curve to the last vertex.
- **A material plate is the region *minus* the holes, by a real boolean difference.** A pit that
  sits wholly inside a plate is a hole in it; a pit that straddles the plate's edge notches that
  edge along the pit's own arc; a pit that slices clean across a one-cell strip of material leaves
  **two** plates. `regionGeometry` computes that with `polygon-clipping` (vendored, MIT — the only
  third-party code here besides three.js) and hands back loops the renderer extrudes. The version
  this replaced removed whole 1/8-cell lattice squares around any hole that reached an edge, which
  drew the material's edge as a **staircase at eighth-of-a-cell steps** — visible, and exactly the
  wrong shape (`docs/pit-in-material-before.png` is that staircase, `-after.png` is the same
  pit on the same plate now). The friction lattice is untouched by any of this: the region still
  says where the ground is, and the drawn plate is that region with the holes taken out.
- A **moving** pit cannot be a static cut, so a level that declares one must also say how it
  is drawn (`movingPitVisual`); a test fails a level that forgets.
- **Every posed fixture is read from the live world, never from the level spec.** `makeWorld`
  clones a level's feature list so the authored spec stays pristine, and the engine animates the
  *clone*: windmill angles, pendulum angles, and a sliding bar's position all live on
  `world.features`. The renderer used to pose its meshes from the spec it built them from, so
  windmills, pendulums and sliding bars were drawn **frozen at their authored rest pose** while
  the engine swung them — invisible hazards that still hit the marble. The renderer now poses from
  `world.features` (the arrays are mapped one for one, so the index is the pairing). Measured in
  the browser: the drawn arm's direction matches the engine's arm direction to 0.0000000 of a
  unit vector, at every sampled instant, for a windmill, a pendulum and a sliding bar. Windmill
  arms also needed `rotation.y = pi/2 - angle`, not `-angle`: the arm is built along local +Z and
  the engine measures its angle in (x, z), so the old expression drew every arm a quarter turn
  out (invisible on a four-armed mill by symmetry, plainly wrong on three arms).
- The camera and lights are **world-fixed**; the board rocks under them. `rotation.x = +tilt.x`
  and `rotation.z = −tilt.z` reproduce the physics signs, and the browser smoke test asserts
  that the *visible* +x edge dips when the marble is being pushed +x.
- The marble is a **glass cat's-eye**: a polished glass shell with wide, soft-edged colour
  ribbons painted into its texture map and a whisper of emissive so the swirl survives a
  dark reflection. (An earlier chrome ball read as a stray fastener at gameplay distance;
  thin stripes read as baseball stitching — both were caught by looking at renders, not by
  trusting the code.) The lighting is a purpose-built studio environment: a dark room with
  softboxes and a muted warm floor bounce.
- The marble's **contact shadow and its light pool are flat quads lying in the board's plane**,
  not camera-facing sprites. A sprite's quad is always perpendicular to the view, and this camera
  is only ~10° off vertical, so a sprite shadow is tilted ~10° to the board and the board plane
  slices it: everything below the slice is hidden, which drew a **hard straight edge across the
  contact shadow, right where the marble sits** — a shadow line through the ball with the soft
  gradient left as a fringe on one side. Measured before the change at the shipped view: the
  contact darkening was 64 px wide and 35 px tall with an abrupt step on the near side; after,
  horizontal and vertical profiles match (a round soft blob). Measured, not eyeballed — the
  cut edge's orientation follows the ball's position on screen, which is why it read as though
  it were tied to the roll direction.
- Particles: impact sparks, dust in a pit, a cyan puff on teleports. Audio is entirely
  synthesised at runtime — no audio assets — and is built from contact, not from samples.

### Sound: contact and body

- One-shots are assembled from two primitives: a **click** (a few milliseconds of noise: the
  tick of two hard things touching) and a **struck body** (a set of decaying partials, higher
  ones shorter — what makes wood hollow and brass bright).
- **The roll is a song, not a simulation.** Rather than model contact, the marble drives a
  short step pattern that loops forever. It is deliberately simple: eight steps over a minor
  pentatonic with a bass note on the first and fifth, at a modest level so impacts sit on top.
- **Speed sets the tempo.** The loop's BPM rises with the marble's speed and is floored at
  `SONG.minBpm` (60), so a parked marble still keeps time instead of falling silent. Steps are
  scheduled with a small look-ahead window, so the rhythm holds when frame times wobble.
- **The ground sets the timbre.** The same notes are re-voiced per surface by a filter, a decay
  scale and an optional inharmonic overtone: wood is a soft lowpassed triangle, ice a sine with
  a bright inharmonic partial (which is what reads as glass, not a flute), sand a short muted
  tone, steel a bandpassed triangle that rings without a square wave's buzz.
- **Fullness lives behind the notes, not in them.** Three things keep the pattern from reading
  as a chiptune: a quiet held root-and-fifth pad (two slightly detuned oscillators per tone,
  spread wide, opening up with speed), a short plate reverb on the song bus so each note hangs
  under the next, and two voices a few cents apart on every note.
- Surface also owns the impact body: wood clatters over a hollow mid-range, ice ticks high,
  sand thuds low, steel rings on inharmonic partials. Wall bumps are struck with the same
  surface body, so hitting a steel plate does not sound like hitting wood.
- Field effects that are not events are read from the world each frame: **vent air**, the
  **magnet hum** (two detuned lows beating), and **wall scrape** (driven by the tangential
  contact speed the physics reports for the step).
- Everything is stereo-placed from the marble's board position, and the master bus runs into a
  gentle limiter so a dense passage of the song cannot clip.
- `sim/audio-check.mjs` renders each voice through an OfflineAudioContext and fails on a
  silent voice, a page error, or a song that does not gain energy with speed.

### The glass lid and the grip

The toy is sealed: a glass pane clamped in a gunmetal collar that stands on the rim wall,
with the grip mounted at the centre of the glass. The whole lid is rigid with the board,
because that is the object the hands hold — the player grips the handle and the maze rocks.

- **The lid is presentation only.** The physics never sees it: no collisions, no shadows, no
  effect on the sim. `LID_Y`, `LID_THICK`, `LID_BEZEL` and the handle constants live in
  `constants.js` and are asserted by `tests/levels.test.js`.
- **The glass must clear what is under it.** `scene.js` measures the real local-space top of
  the board and the obstacles (`localTop`) and raises the lid if a level needs the room, so a
  future pendulum cannot poke a bob through the pane. It also has to clear the *largest*
  marble the tuner can build (`BALL_R_MAX`), not just the shipped one.
- **The collar follows the outline** via `insetLoop()` (a miter offset with a clamped corner
  and a direction check). The same helper grows the outline for the lip that overhangs both
  ways, which is what makes the pane look clamped from above rather than dropped into a hole.
  A lid frame has to read as *fitted*: screws are spaced along the lip and merged into one
  mesh, and the frame is cold metal against warm wood so the two never get confused.
- **Nothing on the lid casts a shadow.** A shadow band across the playfield can read as a
  hole, and the pits have to stay unmistakable from above. That is a rule, not an oversight.
- **The grip is a small knob with an etched compass rose around it**, second design. The knob is
  0.42 units in radius and stands 0.5 above the glass: something to pinch and push, with the visual
  weight carried by the etching around it.
- **The knob is built for a top-down view.** Height is invisible from nearly overhead, and material
  alone will not say "raised": the first version was a dark low cylinder and read, in a rendered
  check, as a hole in the glass. What works is a bright domed cap whose light gradient says
  *rounded*, a darker knurled band around its base, a brass seating collar, and a real shadow. The
  knob is therefore **the one lid part that casts a shadow** - safe by measurement, because the
  shadow lands about 0.9 units from the centre while the nearest hole edge is 2.1 units out.
- **The rose is sized from the board, not from taste.** `rose.js` describes it as plain data
  (rings and tapered ticks) so tests can check it without a renderer, and it computes the clear
  radius as the distance to the *innermost hole* minus a margin: every marking fits inside that,
  which makes "the rose never crosses a hole" true by construction. It matters: level 1's mid pits
  sit exactly on the x axis at radius 2.5, so a star point written by eye would run straight through
  one. It is etched *inside* the pane (`ROSE_SINK` below the top face) and drawn before it
  (`renderOrder`), so the sheet of glass reads as lying over the engraving. (In three,
  `renderOrder` is per-object: setting it on the rose's group does nothing.)
- **Ring spacing is a spread factor, clamped by the lid.** The first cut left a blank 30% middle
  inside the clear annulus and split the rest evenly. `roseDesign` now widens that gap by
  `ROSE_SPREAD` (1.5, i.e. 50% further apart), but the clear glass is finite, so it clamps the
  innermost ring three line-widths clear of the knob seat and keeps the outermost at `reach`. On
  the shipped levels the clamp bites and the rings end up ~1.38x further apart - as wide as the lid
  holds while all three stay readable. `roseProblems` fails if an inner ring would run into the
  knob, so a tighter level cannot quietly push a circle under it.
- **The engraving is grey glass, not white paint.** An earlier version was an opaque near-white
  inlay, which rendered as a bright white line - the look of filled lettering, and it competed
  with the board for attention. A second version was a flat mid-grey pigment, which was the right
  colour and still wrong: it looked painted on, because a pigment does not respond to light. The
  marking is now a translucent, desaturated, *specular* groove that measures darker than the wood
  it sits on (99 against 139) and neutral in colour (channel spread 8-20 against the wood's 72) -
  so you read it as a groove in glass rather than as a line of paint.
- **Line width is set by measurement from both ends.** `ROSE_LINE` came down from 0.05 to 0.042
  (16% thinner). Making it thinner still is what stops it reading as a heavy mark, but not thinner
  *than this*: at 0.032 the rings measured as "very faint, almost blending into the wood grain" from
  the playing camera and the tick marks disappeared, which costs the rose both of its jobs. The
  dark, specular material then cost the rings a little more presence at distance, so the width went
  back up from 0.038 to 0.042 - verified there by a rendered check reading the rings "clearly
  visible" with brightness varying along their length. The three *circles* are drawn separately
  at `ROSE_RING_LINE` (0.0315, 25% thinner than the ticks they share a material with), so the
  rings read fine-ruled while the compass points keep their weight. Thin lines also need matching
  tessellation: a ring is a polygon whose facet is `2*pi*r/segments` long, and at the original 148
  segments a 1.92-unit ring has 0.08-unit chords - over twice a 0.032 line width, so the ring
  polygonises. `flatRing` now picks the segment count from the geometry so no facet exceeds half
  a line width.
- **The mark is relief, not pigment.** This was the fix for "it still looks painted on", and the
  reason is worth stating plainly: a pigment has *one* value under every light, so a smooth grey
  line looks the same from every angle no matter how well its colour is chosen. A groove takes its
  value from what it reflects. So the marking is now dark and specular (`specularIntensity` 1.0,
  roughness 0.24, `envMapIntensity` 1.3) with a **procedural normal map** - a soft trough plus 150
  fine scratches in mixed directions - so different parts of one line glint while the rest stays
  dark, and the pattern moves as the board tilts. Measured along a single ring, the brightest pixel
  now ranges 113 to 255 where a smooth line had one value; the marking averages darker than the
  wood (99 against 139) instead of sitting on top of it, with glints on about 6% of its length -
  enough to catch the eye, not enough to read as a white line.
- **The diffraction is a thin-film term with a thickness map.** Real etching scatters and
  diffracts light; what we can afford is `iridescence` on the marking, which shifts the specular
  hue with angle. Three details are load-bearing. It has to be *strong* (0.95-1.0): at 0.5 over a
  thin line the marking measured as perfectly neutral (channel spread 15/255) and a rendered check
  read "no iridescent tint at all". The thickness band has to be *narrow* (180-330nm): a wide one
  mixes many interference colours and averages back to grey. And it needs a **thickness map** -
  a uniform thickness tints the whole marking one colour, which is a coloured line, not
  diffraction. The procedural field in `textures.js` wanders the thickness so a single ring takes
  several hues along its length, and they move as the board tilts.
  Hovering it gives the rubber a faint warm lift; that is the only feedback needed to say
  "this is the part you hold".
- **The pane is additive and specular-only.** Three ways of drawing the glass were built and
  measured, and only the third works:
  1. real `transmission` glass - removed. It renders the scene into its own buffer and blends it
     back through a mip chain and a refraction offset, which turned the mid-lane pits into light
     patches *brighter than the floor around them* (ratio 1.09).
  2. an alpha-blended haze - safe but almost invisible, because alpha scales the reflection too:
     raising `envMapIntensity` from 0.95 to 2.2 changed the veil by nothing at all (measured +14
     both before and after). Raising the opacity instead would haze the board, and tinting it dark
     would *darken* it by (1 - opacity).
  3. **additive, colour black, specular only** - the environment's sheen is added over the wood and
     the wood itself is untouched: a uniform +48 luminance across the whole surface, tunable without
     changing the contrast the hole check measures. Pits still read at 0.32-0.45 of the floor beside
     them.
- Measured, after removal, from the gameplay camera: pit centres render at 34-55 against the
  floor beside them at 117-132, i.e. **at least as legible as they were before the lid
  existed**. The browser check enforces both a global ratio and a *local* one (a hole must be
  darker than the boards right next to it), and keeps its floor reference off the rim so the
  haze band cannot flatter the result.
- The glass still has to *read* as glass, so it is given the cues that do not cover the
  playfield: a specular sheen that blooms at grazing angles, and a faint haze band where the
  pane meets the collar (which sits over the rim wall by construction, never over a pit).
  From straight overhead a clean pane is honestly almost invisible - which is exactly what the
  player wants while aiming at a hole a marble's width away.

### The knobs and dials of the view itself

Three things about the camera that are all consequences of looking down at a physical toy:

- **The view is steep and uses a long lens** (`VIEW_ELEV` 9 degrees, `VIEW_FOV` 32). A perspective
  view keystones the outline - the near edge drawn wider than the far one - and the eye reads that
  as a board that is *tilted* when it is level. Measured on the rendered outline: the old 39-degree
  view through a 42-degree lens drew the near edge 22% wider than the far edge; this draws it under
  6%, with both edges level to 0px. The browser check asserts exactly that, plus that the two sides
  lean by equal amounts.
- **`camera.up` is `-Z`, not `+Y`.** With a near-top-down view the view direction is almost parallel
  to world up, which makes the roll implied by `lookAt()` ill-conditioned: the scene visibly *rolls*
  as the camera's aim swings. Pointing up along -Z gives the view a stable horizon, and screen-up is
  still the board's far edge.
- **The camera barely follows the marble** (`follow = 0.14`). Aiming off-centre turns the outline
  into an asymmetric quad, which again reads as a tilted board - and at level 1 the marble *starts*
  in a corner, so that was the view you got at rest. Measured: the far edge sits within 2px of level
  at the spawn and moves under 4px across a full sweep of the board.

### Two indicators, and why both exist

The board's angle is readable two ways, chosen with the `indicator` setting in the tuning sheet (it is
part of the same system as everything else, so it persists, copies out as JSON and bakes into the
shipped defaults).

- **Bars** (the default): a hot red slug in each trough, positioned from the board's tilt **every
  frame**. No state, no integration, nothing to settle - the bar *is* the angle. Measured: after a
  fifth of a second of hard tilt the bars are at the end of their travel while the liquid has moved
  0.02. Each bar is about one marble's width long (`BAR_LEN` = 0.6, against a 0.54 marble), so the
  channel either side of it still shows how far it has travelled; all four are the same length,
  whichever trough they sit in, because they are read as four copies of one scale and bars of
  different lengths would invite comparing them with each other. Full travel is
  `INDICATOR_FULL_ANGLE` = the toy's own hard stop, so "bar at the end" always means "board at the
  stop" rather than an invented number. The bar is mostly its own light rather than metal - no
  metalness and a rough surface, so no studio highlight sits on it (a white specular would wash the
  red out), and a steady emission that lifts with travel - so it reads evenly from every camera angle
  and never resolves into a shadow or a blown highlight. The slug is a
  machined box, so its edges are softened twice over: an alphaMap feathers every face's border into
  the channel underneath (a distance-to-nearest-edge field, not a radial gradient - a radial one
  leaves the middles of the long edges hard, which is the edge the eye notices), and a soft additive
  halo spills onto the floor around its base. The box's cut edges sit inside all of that, so what the
  eye reads is a light with no boundary rather than a bright rectangle. (The liquid's ribbon gets the
  same treatment from the other side - an alpha ramp across its UVs feathers its long edges into the
  channel walls.)
- **The scale under the bars is one track, not four liners.** It is a single silver ring laid along
  the four channel centrelines, so it turns each corner with a slight curve (`TRACK_CORNER_R`) instead
  of four strips stopping short of the corners and leaving the collar to fill them. Its geometry is
  read back out of `vialLayout`'s own insets rather than re-derived, so the track and the troughs
  cannot drift apart; its colour is measured against the metal it sits under, so the slug is a light
  on the track rather than a dark patch. The **red** slug is the awkward case for that measurement:
  it clears the silver by only about 15 luma (measured 152 against 137), and its real cue is hue, so
  `sampleLuminance` returns per-channel means too and the bars probe passes a slug that is either
  brighter *or* strongly redder than the empty channel. The emission level is set by the redness and
  not by the brightness: this renderer is ACES filmic, which mixes a saturated red toward white as it
  gets brighter - measured on the rendered slug, emissive intensity 2.4 gives rgb(238, 151, 119)
  while 1.2 gives rgb(238, 116, 103), i.e. *more* red at half the level. The bar leans on its hue and
  on the halo around its base, and it still ends up brighter than the metal it sits on. The
  trough **end caps belong to the liquid**: they exist to stop one side's water running into the
  next, they stand exactly where the track turns, and bars mode hides them.
- **The case's corners are eased from one outline.** `roundedLoop` fillets the convex corners of the
  traced footprint and every piece of the outer skin - slab, rim timber, collar band, lip, screw line -
  is built from that loop, so the layers stay flush instead of one of them cornering inside a rounded
  collar. Concave corners are left alone (a notched shape must not have its notch filled in), and the
  radius is kept under the troughs' corner clearance so a fillet can never eat into a channel.
- **Liquid**: the simulated vials. Slower to read and alive.
- **Both**, and **off** for the bare machined troughs.

The bar model is 15 lines of pure function (`barEntry` in `src/engine/vials.js`) and is tested for the
properties that make it worth having: instant, monotone in the tilt, symmetric, clamped at the stop, all
one length, identical on both troughs of an axis, and independent of the liquid's state.

### The liquid level vials

Four troughs of liquid, one per side, in the collar. The rose says the glass is turning; the vials say
how far and which way. They are *simulated*, not animated, because the whole point of a level vial is
that the liquid stays level in world space while the trough tilts under it - an animation that kept
its surface parallel to the trough would read as a painted stripe, and one that snapped to the low end
would read as a widget.

- **The model is 1D shallow water on a staggered grid** (`src/engine/vials.js`): velocity at the faces
  between cells, depth at the cells, momentum driven by the depth gradient plus the along-axis
  component of gravity, then depth advected by an upstream flux, which conserves volume exactly by
  construction rather than nearly. That is the cheapest thing that shows the three behaviours wanted:
  transport (it runs to the low end), internal waves (it sloshes and settles), and reflection (a wave
  reaching an end cap comes back). Tuned defaults: at a 9 degree tilt the surface is halfway along the
  trough in about 1.4s and pinned at the low end by ~2.5s.
- **The trough is a vial seat, not a well.** It started 0.34 deep, which left the liquid far enough
  below the brim that the trough's own rails hid it from the gameplay camera on the two sides nearest
  the camera (measured: a probe at one end of the near trough read pure black while the middle of the
  same trough read 137). At 0.14 deep the surface sits just under the collar's top face, where nothing
  can occlude it.
- **Two bugs found by measuring, both of which made it look broken rather than slow.** The transport
  left out the `1/dx` in the continuity equation, so the liquid crept at a third of its real speed, and
  the along-axis body force had the wrong sign, so both troughs on an axis reported the tilt backwards.
  Neither was visible by eye; both fell straight out of a test that asserts which end the liquid
  reaches.
- **The liquid has its own gravity.** At the marble's own (deliberately slow, par 34s) timescale a
  trough takes ~3s to run down, which reads as sluggish for something whose only job is to say "you
  are tilted". So `vialResponse` scales the gravity the *liquid* feels: the same equations on a faster
  clock.
- **Splashback is honest about what it is.** The physics has it: a closed end reflects, and liquid
  driven into an end cap overshoots and eases back rather than stopping dead - both asserted. But the
  arrival is *gentle* (a shallow seat means a slow arrival), and a slider on the physics measured as
  doing nothing at all (the cap pile was 0.112 with splashback off and 0.112 with it at 0.95). Rather
  than ship a dead knob, `vialSplash` controls the *visible* froth where the liquid arrives, and its
  hint says so.
- **The troughs live in the collar, outside the playfield** - so a vial can never cover a hole (the
  project's hardest rule) and no gutter can catch the marble. The trough floor is the collar band's own
  top face, with rails and end caps standing on it, which is how a channel in a real frame is made.
- **The liquid needed the same lesson as the etching: a flat colour reads as paint.** It is a glossy
  surface with ripples, a meniscus that climbs the walls, a depth-graded body and foam where the flow is
  fast. Two details were load-bearing. The ribbon needs real UVs - without a `uv` attribute the ripple
  normal map samples a single texel, and the first version rendered as a flat green stripe. And the
  cross-section needs several rows, not two, or the specular highlight is a uniform band down the middle
  instead of a curve that moves with the tilt.
- **The brim clamp spills rather than deletes.** A fast wave can heap a cell above the brim; deleting
  that excess lost 5% of the liquid in the shallow trough before the test that asserts exact
  conservation caught it. The excess now moves to whichever neighbour has room, and if neither has any
  it stays put - mass is never invented or destroyed.
- **It cannot touch the marble.** The coupling is one-way and asserted: the same level rolled with the
  liquid at rest and with it mid-slosh produces bit-identical marble positions.

### The light is three sliders, and they are separable

`LIGHT_LEVEL` (diffuse), `LIGHT_REFLECT` (reflection) and `LIGHT_SIZE` (group "Light and glass")
drive the whole studio. The interesting part is what each one is allowed to do.

- **Diffuse and reflection are independent.** Diffuse scales the direct lights - the key, the fill
  and the shadows; reflection scales `scene.environmentIntensity`, which is the studio as it appears
  mirrored in the glass and the marble. An earlier version deliberately fused them into one master
  so the contrast the hole check measures could not drift (the pits read as a ratio against the
  floor, and that ratio is a function of how much light reaches both). That fusion also meant the
  mirrored glare could not be dimmed without darkening the whole board, which is the trap this
  split removes: reflection can be brought to zero while the board keeps its key light and pits, and
  diffuse can be brought to zero while the board is lit only by the reflected studio. Both sliders
  now run the whole way: **0 at the bottom, the shipped look at the top**. They used to run out to
  1.6x and 2x that look, which is only ever "brighter than it should be" - and the old tops are what
  made a bright setting read as a blown-out one. The pane's own reflection strength is scaled with
  the reflection slider too, because it mirrors the *key light* as well as the environment and the
  environment scaling alone could not reach that half; at reflection 0 the pane now contributes
  nothing at all. The three.js renderer overrides every material's
  `envMapIntensity` with `scene.environmentIntensity` when the material has no env map of its own,
  so the reflection slider is genuinely global: one number dims the sheen on the glass, the mirror
  on the marble and the highlights on the brass together.
- **The shipped look is unchanged.** `ENV_BASE` is `0.62 * 0.72`, so the reflection default of 1.0
  reproduces exactly what the old single master produced at its 0.72 default.
- **The lid glass is frosted, and that is a measured decision, not a taste one.** The pane is flat
  and additive, so with a sharp specular lobe the whole sheet sits near the key light's mirror
  direction at once once the board tilts, and a large circle of board adds on top of itself until
  it clips to flat white (the complaint that started this: "washes out a large circle completely at
  certain angles"). Across eight board tilts, area of the frame at near-white / brightest 1% /
  frame mean: roughness 0.075 gave **3.05% / 255 / 66.8** - a blown-out circle - and halving
  `specularIntensity` still clipped, because the problem is the *direction* the whole pane shares,
  not the strength. Widening the lobe is what fixes it: 0.4 gave 14.5% / 255 (worse), 0.6 gave
  0.22% / 228, and 0.8 - the shipped value - gives **0.09% / 221 / 65.7**. The frame stays exactly as
  bright as it was; only the mirror goes. The smallest tilt-drop survives as a soft sheen.
- **Size rescales the environment's softboxes and re-renders the probe.** "How big is the light" is
  answered by the reflected environment: a bigger panel subtends more, so the sheen on the glass and
  the wood gets broader and softer. Two things had to be measured to make it work. First, the panels
  keep their *radiance*: dimming them to conserve power pushed them below the room walls in
  brightness and enlarging the light made the scene go dark and flat (median 120/114/70 across size
  0.4/1/2.4). Second, the direct lights carry the compensation (`SIZE_DIRECT_EXP`) because a bigger
  environment panel adds illumination on its own - without it, "size" is just a second brightness
  slider. With both in place size stays separable from brightness: across size 0.4/1/2.4 the median
  board luminance holds at 109/111/109 while the *spread* across the board runs 161/109/100 - a
  tight harsh pool at one end, an even wash at the other.
- **How these numbers are taken.** Pixel measurements (`readPixels`/screenshots) must **stop the
  animation loop first** (`window.requestAnimationFrame = () => 0`, then wait a beat). Otherwise the
  loop re-renders between the scripted `sync`/`render` and the read, and it usually wins: the live
  input layer is levelling the board back toward 0, so captures come back showing an untilted board
  and a wash that reads 0.2% instead of the real 3.05%. Every number above was re-taken with the
  loop stopped, and the earlier race is why an intermediate run reported the same tilt three
  different ways.
- **The probe render is throttled.** The slider fires every frame while a hand is on it; re-running
  PMREM each event is wasted work, so a resize waits for a ~90ms gap and is otherwise flushed by
  `render()`. `applyLighting({ immediate: true })` forces it, which is what boot and the checks use.

### Framing, and the tuning sheet

Two deliberate presentation choices, both measured rather than eyeballed:

- **`VIEW_SIZE = 1.1`** puts the camera 1/1.1 as far away, so the whole toy draws 10% bigger
  on screen with the physics untouched (the camera cannot change board units). The browser
  check proves it by A/B-ing the projected width against the *un-zoomed* camera distance in
  the same frame, so the claim is verified as a ratio, not against a remembered number.
- The tuning sheet is a right-hand panel, so while it is open the board would sit off-centre
  in what the player can actually see. `setSideShift()` in the renderer slides the camera's
  frustum with `camera.setViewOffset` — a lens shift, which moves the image without changing
  the field of view, so the 10% framing above is preserved. The shift is clamped by the
  board's own projected reach: on a narrow window, where the toy is wider than the gap the
  sheet leaves, the best it can do is sit flush against the left edge while staying entirely
  on screen, and it never clips off the window. Opening and closing the sheet, and every
  resize, re-run it, because the shift is measured in pixels.

Measured: at 1900 px the board lands exactly centred in the gap (centre 744 px, gap centre
744 px, board clear of the sheet). At 1600 px it is centred within the fit. At 1180 px and
below the toy is wider than the gap, so it sits flush left, fully visible.

## Performance

The physics is fixed-step and cheap; the renderer adapts. A rolling average of frame time
degrades the quality tier (pixel ratio → shadows → fog) and will climb back if the machine
can afford it. The physics timestep never changes, so feel is identical everywhere.

`?bench=N` renders N frames and reports honest ms/frame in the page title; `?quality=low|medium|high`
forces a tier; `?demo=1` boots straight into the autopilot.

## Debug API (used by the smoke test)

`window.__maze` exposes `world`, `scene`, `state`, `levels`, `gotoLevel`, `restart`,
`startDemo`, `setTilt(x, z)`, `advance(seconds)`, `reachGoal()`, `probeLocal(points)`,
`lookFrom(pos, target)` and `quality`.
