# Marble Maze

A tilt-controlled wooden marble maze: you tip the board, the marble keeps its momentum,
and holes, bumpers and gates do the rest. Runs in the browser, no build step.

**Status:** the engine, the level format and the obstacle vocabulary are built and tested.
**Levels 1–4 are authored and verified**, under a glass lid with a central grip:
**1 First Tilt**, **2 Peg Board**, **3 Twin Track**, and **4 Both Locks** — the two-marble levels,
where both marbles must reach the cup. Both Locks adds a raised metal pressure button that works
**two metal wall slabs at once**: a marble stands on the button, which sinks one door and raises
the other, so holding the door for your neighbour bars your own. The slabs climb out of routed
slots in the floor, and both of them are cut from the button's own metal — see *Pressure buttons
and lift walls* below. The slate from level 5 on is a proposal (see below and in
game: *levels → Planned slate*) and is deliberately not built yet.

## Multiple marbles

A level may start more than one marble: author `spawn` as a list, `spawn: [[1, 3], [1, 6]]`,
instead of a single cell. Every marble must reach the goal to win the run — one marble in the
cup only lights a `marbles` counter in the HUD, and the win fires when the last one drops in.
The marbles bounce off each other like real glass, a fall only sends that one marble back to
its own spawn (the others keep rolling), and the autopilot plays the level by shepherding them,
one at a time, which is also the proof that a multi-marble level is completable by tilt alone.
`twin-track` in `src/engine/levels.js` is the worked example.

A **cooperative** level (`coop: true`) is the one thing the single-marble autopilot cannot play:
its solution needs one marble to *hold a plate* for another, and the pilot never waits. Those
levels are proven completable by a scripted two-marble plan instead — see `tests/lifts.test.js`
and `both-locks`.

```bash
devports launch --name marblemaze --port 3010 -- node sim/serve.js --port {port}
# then open the URL it prints
```

**Port 3010.** The game's dev server belongs on 3010. Port 3000 is reserved for the
machine-wide Machine Resources dashboard (`~/ActiveProjects/MachineResources`, AGENTS.md
admission signal), so never bind Marble Maze there. `sim/serve.js` takes any free port with
`--port`; the helper scripts under `sim/` and `tools/` default to `http://127.0.0.1:3010/`
and accept `--url` (or `MM_URL`) to point elsewhere.

## How it plays

- **Grip the handle** at the centre of the glass lid and tip the toy. **Drag** anywhere, or
  use **Arrow keys / WASD**; hold **Shift** for fine control.
- Press **tilt** to steer with a device's orientation sensor instead.
- The marble is a steel ball on a real board: it accelerates while tilted and coasts when
  you level the board, so you need to start braking before a corner.
- Holes end the attempt (falls are counted, the marble respawns and the timer keeps running).
  The brass-ringed cup is the goal.
- **show me** (or `D`) hands the board to the tilt autopilot and plays the level in front of you.

## Pressure buttons and lift walls

A **pressure button** is a raised circular metal button — a dark routed seat, a short metal body
and a brighter cap — not a flat plate painted into the floor. It is authored like a pit: in cell
space, so it may sit on a fraction of a cell, and it sits **on** whatever ground is there instead
of replacing it. A button on ice is still ice: the marble feels the ice right up to the button's
edge.

A button drives either or both of:

- a named **gate**, which opens while the button is held; and
- any number of **lift walls** — metal wall slabs that climb out of a routed slot in the floor
  while the button is held (mode `raise`, rest flush) or sink into the floor while it is held
  (mode `lower`, rest raised). A lift has no timer: its height is exactly what the button's state
  says, so a marble standing on the button holds the wall where it is.

A slab is a wall, not a line: as long as its authored segment, as wide as a wall cell and as tall
as a wall, and it runs **along** its segment — the same line the marble collides with, so what you
see is what you hit. Each button and every wall it drives are cut from the same **metal**:
`brass` (the default), `steel`, `copper`, `gunmetal`, `bronze` or `gold`, chosen per button in the
level editor. The table lives in `src/engine/metals.js`.

While a slab is on its way **up**, a marble sitting on it is pushed off toward whichever side of
the slab the marble is more on, instead of being left standing inside it. A slab on its way
**down** does not push; it sinks out from under whatever is riding it.

## Tuning the feel

Press **T** (or the **tune** button) for live physics sliders. Everything applies on the next
physics step, so the marble responds while it is still rolling:

- **Gravity and roll** — gravity, how much of the slope a rolling sphere picks up (`5/7` is the
  physical value), and the speed cap.
- **Marble and board grip** — *rolling drag* (how fast speed bleeds off, which sets the top
  speed for a given lean) and *start friction* (the lean needed to break the marble loose and
  stop it again), plus wall friction, wall bounce and marble size.
- **Board control** — max tilt, how fast the board answers your hands, and how strongly it
  self-centres when you let go.
- **Holes and cups** — how forgiving the pits and the goal cup are.
- **Bumpers** — the bounce, the kicker punch, and how hard a windmill arm throws — plus
  **other surfaces** (ice / sand / steel) and **level machinery** (belts, fans, magnets, pad
  radius, gate hold) for when those levels arrive.
- **Ramps** have no slider: a wedge's climb, its crest launch and the stepped half of its side
  walls all come from its own geometry (`height` over its run), so a ramp is tuned in the level
  editor rather than in the feel panel. The editor's arrow points the way the marble traverses
  it, and a marble cresting fast flies higher and further than one cresting slowly.

Presets (**Heavy marble**, **Slick and fast**, **Arcade**, **Floaty**) are one click, and
**reset all** returns to the shipped numbers. Tuning is saved in your browser, the tune button
shows a dot while it is custom, and `?physics=default` ignores saved tuning (the automated
checks use that). While the panel is open it shows live speed, tilt, peak speed, surface and
time, and it has a **restart run** button — so you can A/B two settings on the same run.

### Slider range — take a knob past reasonable

The ranges the game ships are not the ranges you are stuck with. **Slider range** switches
every slider at once:

- **Normal** — the documented shipping range, exactly as before.
- **Wide ×3** — three times past it, outward in both directions. This is the default.
- **Extreme ×12** — twelve times past it. Most of these numbers stop describing a toy.

Widening is strictly *outward*, so the shipped range is always still there, and the step is
unchanged — the shipped numbers stay as easy to nudge as they always were. Switching modes is
a view change: it never rewrites a number, so a value taken at Extreme survives a switch back
to Normal (the slider simply sits at the value rather than clipping it). The mode is
remembered in your browser like the rest of the tuning.

### Saved profiles

Type a name and press **save current** to store everything showing right now. Saved profiles
are listed underneath with **load** and **delete**. A profile stores the *difference* from the
shipped defaults plus the slider range it was saved under, so loading one restores both the
numbers and the sliders that showed them — and a profile that only changed gravity leaves
every other value at whatever the game ships. Profiles live in this browser only
(`marblemaze.tuning.profiles.v1`), and saving the same name twice updates that profile.

Arrow keys inside the panel adjust the focused slider and never tilt the board.

When you land on numbers you like, hit **copy JSON**. To bake them into the game:

```
node tools/bake-tuning.js --file /tmp/physics.json         # dry run: shows the diff
node tools/bake-tuning.js --file /tmp/physics.json --write # rewrites constants.js
node tests/run.js                                          # verifies defaults + slider ranges
```

The suite also proves the level is still solvable under **every preset**, so a feel change
cannot quietly make a level unplayable.

## Testing

```bash
npm test                # 219 headless checks: physics, level structure, tuning, profiles, solvability, marbles
node sim/smoke.mjs      # real browser: loads the page, drives it, screenshots, times frames
node sim/tune-check.mjs # real browser: proves the tuning panel changes the simulation,
                        # that the range modes widen the sliders, that profiles reload, that
                        # choosing a marble in the sheet swaps the one actually on the board, and
                        # that the lamp dials and the colour picker reach what they claim to
node sim/audio-check.mjs # real browser: renders every sound offline and reports level/balance
npm run marble-cost     # REAL GPU (not SwiftShader): what the glass costs per frame, and whether
                        # the transmission buffer is sized to the marble rather than the viewport
npm run perf            # REAL GPU: the frame-time distribution, where each frame's time goes,
                        # the hitch count and the draw calls (?perf or F shows the same ring live)
npm run marbles         # lab shots; npm run marble-board for the same marbles on the board
                        # (both are SwiftShader, because the point there is the pixels)
```

The audio check needs the page open over HTTP (`devports launch --name marblemaze --port 3010 -- node sim/serve.js --port {port}`),
then `node sim/audio-check.mjs --url <url>`. It renders the real voices through an OfflineAudioContext,
so it proves each sound is audible and correctly panned without anyone having to listen.

`npm test` includes two checks that matter most:

- **`tests/levels.test.js`** — every level is structurally fair: spawn and goal walkable, pits
  never seal the only route, no one-cell-wide squeeze on an early level, the rendered board
  outline is one clean closed loop matching the footprint, par time is achievable, and **every
  lethal hole is drawn at least as wide as the region that captures the marble** (a hole you
  cannot see is a trap, and a test now refuses to let one ship).
- **`tests/tuning.test.js`** — every tunable has a labelled slider with a sane range and a
  default inside it, values clamp to the widest range mode, the range modes only ever grow
  outward and stay on the step grid, JSON round-trips, and the autopilot still finishes the
  level under all five feel presets.
- **`tests/profiles.test.js`** — saved profiles round-trip, overwrite by name, trim their
  names, and degrade to "no profiles" when storage is missing, corrupt or read-only.
- **`tests/solver.test.js`** — a **tilt-only autopilot** (it may move the board, never the
  marble) finishes the level from the spawn without a single fall, and can still get home
  after being jammed into a corner. This is the honest answer to "is the level playable?".
- **`tests/lifts.test.js`** — a button lowers a resting wall, raises a flush one, and lets both
  return to rest when it is left; each wall takes the metal of the button that drives it; a wall
  still on its way up pushes a marble off toward whichever side the marble is more on; and the
  shipped cooperative level `both-locks` is finished by a scripted two-marble plan while the
  greedy order (send the holder home first) is shown to strand the other marble, which is what
  makes the button load-bearing.

Physics tests cover the specifics: no tunnelling at full tilt for a minute, deterministic
replays, pit capture, cup capture, wall bounce, ice vs sand, pegs (including that a peg never
lets the marble through and never adds energy), belts, fans, magnets, teleport pads (including
that a marble parked on a receiving pad does not bounce back), pressure plates and gates,
plate-driven lift walls in both directions, one-way flaps, ramps (that the slope is the wedge's own geometry, that the marble climbs and is
launched off the crest — faster means higher and further — and that it cannot climb back up the
crest face or the stepped half of a side wall), and the moving obstacles carrying
momentum — a windmill arm's throw sampled where it touches, and that a sweeping arm can never
post the marble inside a wall.

## Layout

```
index.html            page + import map (three.js is vendored, no bundler)
styles.css            HUD, menus, overlays
src/engine/           pure, node-testable simulation — no three.js, no DOM
  constants.js        all tuning in one place
  levels.js           level DSL + Levels 1-4
  physics.js          marble on a tilting board, walls, pits, obstacles
  silhouette.js       board outline extraction (used by the renderer and by tests)
  pathfind.js         cell graph: route finding, solvability
  autopilot.js        tilt-only solver: tests + the in-game "show me"
  slate.js            the proposed levels 5-12, shown in the menu
src/render/           three.js presentation (board, obstacles, marble, particles)
  wood-uv.js          projects every wood surface onto the board plane, so the grain runs off
                      the floor and down the inside of a hole (see docs/DESIGN.md)
  wood-image.js       the board's wood, as a picture: albedo, plus the normal and roughness
                      maps derived from it, with the image's own lighting divided out. It takes
                      a grain-prominence knob and colour transforms, which is what the material
                      picker below drives
  board-materials.js  the candidate shelf: birch and cherry as transforms of the shipped
                      picture, a procedural marble slab, and the grain-prominence knob threaded
                      through both families
assets/wood-board.png one generated walnut board, 1536x1056, covering 16x11 board units, no tiling
                      (the same picture the procedural fields were judged against: see
                      docs/wood-krea-vs-procedural.png, and docs/wood-1024-vs-1536.png for why
                      this size)
src/ui/               HUD and runtime-synthesised audio
sim/                  static server and the browser smoke test
tests/                node test runner and suites
vendor/               three.js r180 (module + the two addons used)
  polygon-clipping/   MIT polygon booleans, vendored as ESM — cuts a material plate with the
                      pits it has to go around (see `regionGeometry` in engine/materials.js)
docs/DESIGN.md        how the physics and the level format work, and the design rules
docs/STATUS.md        what is built, what is stubbed, and what the checks cover
docs/*.png            reference renders (board-overhead, glass-lid, pit-beside-bottom-wall,
                      pit-in-material-before/after, tuning-panel) — regenerated by hand when
                      a look changes
docs/materials/       the candidate boards and their close-ups, written by tools/materials-shot.mjs
tools/wood-*.html     wood preview and a side-by-side comparison page (open them over the dev
                      server); the comparison takes ?imgA= and ?imgB=, and 'fields' means the
                      procedural board, so any two sources can be lit side by side
tools/materials.html  the material picker: four candidate boards lit in the game's rig, click
                      one to choose it, drag *grain prominence* to set how loud its grain reads.
                      State is in the URL (?pick=&grain=&size=)
tools/materials-*.mjs screenshots that page (candidate sheet, a close-up and a grain strip per
                      candidate) into docs/materials/, and reports console errors and boot time
tools/rim-shot.mjs    renders the rim options from the game itself (its own rim geometry, not a
                      preview), by driving the debug API and framing the board at an angle where
                      both the rim cap and its body are visible
docs/marbles/         the marble family, a close-up per marble and a shot of each on the real board,
                      written by tools/marbles-shot.mjs and tools/marble-board-shot.mjs
tools/marble-board-shot.mjs  the marbles on the *real board*, driven through the game's own
                      tuning API, and a measurement of the lantern's lamp on the wood
tools/marbles.html    the marble lab: every marble in a row plus a big turning close-up, lit in the
                      game's rig. Click one to select it; state is in the URL (?pick=&glass=&glow=&spin=)
tools/marbles-*.mjs   screenshots that page into docs/marbles/ and reports console errors
src/render/marbles.js the marble factory: one builder per look, each a painted sphere or an opaque
                      core under a transparent clearcoat shell
src/render/svg-path.js a small SVG path reader, so a symbol can be extruded from its real
                      outline instead of textured onto a sphere
```

## Marbles

```bash
# in the game: the tuning sheet's *Marble* group (T), or a link
http://127.0.0.1:3010/?marble=lantern

# the lab, where the shipped marbles sit side by side; ?all=1 brings back the shelved ones
devports launch --name marblemaze --port 3010 -- node sim/serve.js --port {port}
# then open /tools/marbles.html
```

Six marbles ship, chosen from the tuning sheet's **Marble** group or by `?marble=`.

| Marble | What it is | Cost |
| --- | --- | --- |
| **Cat's-eye** | the shipped swirl, painted on one sphere. The reference, and free | — |
| **Lantern** | lights inside — glowing beads, additive halos, a **real point light** — plus subsurface bands that cut its own glow as they turn past | one transmission pass |
| **Solid** | opaque banded stone in **any colour you pick** | — |
| **Earth** | the blue planet, in three maps: coastal turquoise falling away to abyssal dark, desert and rainforest and taiga, mountain belts with real relief, ice caps and Greenland, islands from Britain to New Zealand — and **weather on its own layer**, drifting across the continents as the marble rolls. The sea is the only glossy part, so the key light sweeps across the water | one extra transparent sphere |
| **Moon** | grey highlands under maria under a whole crater field, with the craters cut in as **relief** as well as shade, so a rim catches the light | — |
| **Eight ball** | polished black, the 8 in its white circle | — |

### The three painted planets

**Earth**, **Moon** and **Eight ball** are the same idea as the cat's-eye — one map on one sphere, no
glass, no core — so they cost what it costs and ship for the same reason: the Look dial offers what
the frames allow, and a painted sphere is the cheapest marble in the set.

Their maps are `DataTexture`s built in plain arithmetic, not canvases, so they build *in node* —
which is why the marble checks can hold them to the same rules as the glass ones rather than skipping
them. Three details are worth knowing:

- **A pixel is a place on the globe.** A sphere's UVs are equirectangular, so the coastlines, the
  craters and the eight's rings are written as longitude and latitude, and the shapes that straddle
  the seam are tested at `lon`, `lon - 360` and `lon + 360` so a coastline joins itself across the
  wrap.
- **The eight's circle is not drawn in lat/lon.** A disc written in equirectangular space comes out as
  a lens — fat across the middle, pinched at the sides — with the number sheared inside it. The digit
  is laid out on an azimuthal equidistant projection of the sphere about the disc's centre, which is
  the same shape a printed disc on a real ball has, so the 8 stays round from every angle.
- **The Earth's roughness map is the water.** `roughnessMap` multiplies the material's roughness, and
  the land mask is already known when the map is painted, so the ocean is glossy and the continents
  are matte for the price of one more channel.
- **Its ocean is shaded by distance from the coast, not by noise.** A two-pass chamfer distance
  transform over a 1024×512 land grid says how far every sea pixel is from land, and that single
  number drives coastal turquoise → shelf blue → abyssal dark. It is most of what makes the water
  read as *water* rather than as blue paint, and no amount of coastline detail substitutes for it.
  Its grid is square on the globe (0.3516° both ways), so cells become kilometres with one multiply.
- **Its land has relief, from the same place-not-pixel rule.** Ridged noise gated by a belt mask
  gives mountain chains that stand proud in the bump map. It is a precomputed field sampled
  bilinearly: paying for four fbm octaves at every pixel of a 1536×768 map would be most of a
  second's work for detail no eye could find. The Earth costs about 320 ms to build the first time
  (fields and map together, fields then cached) and ~200 ms to rebuild after that — the same shape as
  the Moon's craters.
- **The weather is its own layer, and it moves.** Cloud is not painted into the albedo, because baked
  cloud is welded to the ground. It is a **second shell over the same sphere at the same radius**,
  carrying cloud white in RGB and coverage in its alpha, that turns at its own speed (~0.1 rad/s, a
  turn a minute) on top of the roll the physics gives the marble it rides in. Two coincident spheres
  would z-fight, so the cloud material is nudged a hair toward the camera in the depth test
  (`polygonOffset`) — a screen-space nudge in the depth buffer, not a change to any geometry. It
  writes no depth and casts no shadow: a shadow map does not read alpha, and a transparent sphere
  would otherwise darken the board a second time. **Cosmetic only**: the marble's radius, its scale
  and everything the engine simulates come from the same numbers as every other marble, and a test
  holds the cloud shell to *exactly* the surface's sphere, so the marble's size can never be read off
  the weather.

### The clear-glass designs are shelved for now

**Bitcoin**, **Geode**, **Helix**, **Gem** and **Banded** are *disabled*, not deleted. Each is clear
glass over a dozen pieces of geometry, so each costs a transmission pass every frame while it is on
the board, and smoothness wins. They are out of the **Look** dial, they still build, and they still
answer to `?marble=bitcoin` and friends — so the lab with `?all=1` and the shots tool can still reach
them.

### Nothing outside the sphere

Every marble is a **smooth sphere, and only a sphere**. Anything decorative lives at or under the
surface: the cat's-eye is paint, the Earth and Moon and eight ball are paint, the solid marble's bands
are drawn *into* its own map, and the lantern's beads and bands sit *inside* its glass. A test measures the farthest vertex of each shipped
marble against radius 1 and fails if anything reaches past it — an earlier attempt of this work had a
band shell at 1.001 and raised band rings at 1.004, both of which sit outside a surface that is meant
to be featureless.

### How one is built

Each marble is a group with two layers:

- a **solid core** — a symbol, a crystal, a helix, a lamp — drawn in the normal opaque pass, and
- a **clear glass shell** over it, which *transmits*: real `transmission`, a real `ior`, and a
  `thickness` for the light to travel through, which is what makes the ball act as a lens on the
  board behind it. The shell is named `marble-ball`, so the size slider and the smoke checks find it
  exactly as they always did.

### The cost, and why it is measured on the real GPU

Transmitting glass costs one extra render of the opaque scene per frame, into a 4x-MSAA mipmapped
target — that is how three's transmission works. Two things keep that honest:

- the pass only runs while a **transmissive marble is in the render list**, so a player on the
  cat's-eye or on solid never pays for it at all, and
- the buffer is **sized to the marble's own footprint**, not to the viewport.

That second point is worth the paragraph. Sized as a flat fraction of the viewport — the obvious thing
— the buffer held some 600x the pixels the marble can ever display, because the shell only samples it
inside the ball's screen disc and a sphere's refraction *shrinks* what it reads. Measured on the real
GPU (M4 Max, Metal, 1400x875) that flat 0.6-of-viewport cost **+5.8 ms per frame**: 15.1 ms became
20.9 ms, which is felt. `updateTransmissionScale` now projects the marble instead and asks for three
times its own diameter, which is about 0.1 of the viewport for a marble on this board.

[tools/marble-cost.mjs](tools/marble-cost.mjs) exists because the obvious instrument here is the wrong
one. It launches Chromium with the **real** GPU and refuses to report timings from a software
rasteriser; it disables vsync (with vsync on a fast GPU renders both marbles in 8.3 ms and the
measurement reads "0.0 ms" because the ceiling hid the cost); it holds the picture still so the only
difference is the marble; and it warns when the painted baseline is slow enough to mean the *machine*
is busy rather than the game. What it asserts is the buffer, because that is a number rather than a
timing and so cannot flake.

```bash
npm run marble-cost          # MM_LOOKS=catseye,lantern,earth,moon,eightball node tools/marble-cost.mjs
```

The marble is still built at radius 1 and scaled by `TUNING.ballR`, so no look and no dial can move
the physics. Swapping one mid-run rebuilds in place, so the ball stays where the engine has it.

### Frame tracking and profiling

Smoothness is the promise, so it has to have a number. The game carries a small frame-time instrument
([src/ui/perf.js](src/ui/perf.js)) that is off by default and shown with `?perf` or the **F** key. It
reports the frame interval (fps, median / p95 / max), a `> 20 ms` hitch count for the last three
seconds, a frame-time graph with the 60 Hz budget drawn as a guide line, a per-phase CPU breakdown
(`physics / sim / sync / render / ui / tail`) and the renderer's draw-call, triangle and program
counts. It redraws a few times a second and allocates nothing per frame, so it is not measuring
itself.

`window.__maze.perf.snapshot()` returns that same ring, `reset()` clears it, and
`toggle()`/`setEnabled()` drive the overlay — which is what the tool below drives, so the printed
report and the on-screen meter can never be two instruments disagreeing.

```bash
npm run perf                                    # demo, lantern, tier high
node tools/perf-profile.mjs --look solid --tier auto --seconds 8
node tools/perf-profile.mjs --scenario still --json
```

Like `marble-cost`, it uses the **real** GPU, refuses a software rasteriser, and disables vsync. It
pins the quality tier by default (`--tier high`) because the adaptive loop is *designed* to downgrade
under load and would otherwise report its own choice as the feature's cost; `--tier auto` watches the
loop instead. Percentiles are reported rather than just a mean, because a mean hides exactly the
stutter that is felt.

### The Marble dials

All live, in the tuning sheet's **Marble** group. Each is a multiplier or an offset on what the marble
ships, so a design keeps its character as the dials move, and **reset all** puts everything back —
including the marble itself.

| Dial | What it does | Applies to |
| --- | --- | --- |
| **Look** | which marble is on the board | all |
| **Transparency** | how much light the glass passes: `1` clear glass, `0` a solid milky ball | the glass |
| **Glass bend** | how far the refracted ray travels — `0` a flat window, higher magnifies hard | the glass |
| **Solid fill** | the size of the embedded object, i.e. how much clear glass you see at all | the glass |
| **Lamp brightness** | the lantern's lamp, as a multiple of the measured shipped strength | lantern |
| **Lamp hue** | the lamp's colour in degrees: `36` is the shipped amber | lantern |
| **Band contrast** | how far the bands stand out from the body they sit on | lantern, solid |
| **Band count** | how many bands around the ball | lantern, solid |
| **Band width** | how much of each band's pitch is banded | lantern, solid |
| **Solid colour** | the opaque marble's body colour, from a picker; its bands are derived from it | solid |

Brightness and hue move the **whole** lamp — the light, the beads and both halos — because a brightness
that reached only the light would leave painted-looking beads, and a hue that reached only the light
would put a green pool under an amber marble. Both are no-ops on a marble with no lamp, and the panel
keeps them anyway rather than hiding controls per marble.

### The bits that are easy to get wrong

**An alpha map is read from the green channel.** The lantern's bands are a stripe mask, and the first
version wrote that mask into the texture's alpha. Green stayed white everywhere, so the mask covered
the whole sphere: the bands vanished and the marble went dark. Two things hold it now — the writer
puts the gaps in *green*, and a test asserts the mask has both opaque and clear rows.

**A DataTexture starts as zeroes.** The same bands were invisible for a second reason: a mask of
zeroes discards every fragment, so the outline has to be written at build time rather than waiting for
the first dial move. The test counts banded rows, which is what catches both bugs.

**A colour is not a number.** The tuning layer clamped every knob numerically, so a colour picker
needed a third kind of control beside the sliders and the mode buttons. `Number('#15171d')` is `NaN`,
and `NaN > 1e-9` is false — which would have made a recoloured marble report itself as *unchanged*.
`clampValue` validates and normalises the hex; `differs` compares strings for string controls.

**Contrast 1 has to be the identity, exactly.** Two separate bugs here: a clamp floor of 0.01 looked
like "don't let the bands go black", but the working-space lightness of a dark band is 0.004, so the
floor *lifted* it; and a fixed mid-grey pivot sat above every band a dark marble has, so raising the
contrast pushed them all the same way and washed the pattern out instead of sharpening it. The pivot
is the design's own mean now, and the clamp is the full range.

**Bands have to be visible, or they are not bands.** The solid marble's first surface pattern was a
0.05 step in perceived lightness on a glossy dark ball, and under the key light it could not be seen
at all. The band colours are derived from the body, so those shipped values are the only place the
contrast is decided — it is a real step now.

**A band inside transmissive glass is only as dark as the buffer that glass samples.** The lantern's
bands are real opaque geometry just under the shell, but the eye never sees them directly: the glass
samples the opaque scene and passes it through, so a band row reads as whatever the band shell looks
like *in that buffer*. The shell shipped glossy and metallic with the environment reflection on, and
so it mirrored the room — one more reflection on the glass, indistinguishable from the glass's own,
and the bands were invisible through it at every dial setting (Nick, 2026-09-20: *"it does not work
at any band or light setting"*). Matte, non-metallic, `envMapIntensity: 0`, it has nothing left but
its own near-black diffuse and the glow is genuinely cut; the polish the bands still show is the
glass's own Fresnel highlight, drawn over them at radius 1.0. A test asserts the material cannot go
back to reflecting.

**The poles have to be gaps, not bands.** The game's camera looks almost straight down the marble's
axis, so a band over a pole is a single opaque spot filling the visible cap — a dark ball, not
stripes, whatever the dials say. The band writer is phased half a pitch so both poles land in gaps,
and a test fails if either pole comes back banded.

**The lantern's contrast pivot is the glass, not the band.** `applyContrast` swings a colour away
from a pivot, and the lantern passed its own band colour as that pivot: `p + (l - p) * c` is `l` for
every `c`, so the slider moved and nothing changed. Its bands are a *cut in the glass*, so the pivot
is the clear glass (white) — contrast `0` then lands on clear, which a matte shell cannot become, so
at `0` the mask is emptied instead and the bands actually disappear. A test drives the dial in both
directions.

**The counters have to be holes.** The bitcoin ₿ is read from the Wikimedia path with
`src/render/svg-path.js`, which nests the glyph's two enclosed counters into the outline as
`THREE.Path` holes. Fill them in and you get a solid blob that still renders happily; a test
measures the extruded front cap against `outline − counters` so that cannot ship quietly.

**A flat symbol must not tumble.** A real embedded object turns with the glass, which is right for
a crystal or a ribbon and wrong for a flat mark: seen at a grazing angle the ₿ collapses into a
thin bar. So its core stays level while the glass rolls around it and sways gently, which keeps the
symbol readable from the game's near-top-down camera *and* shows the extrusion's depth. The shell
still tumbles with the physics, so the highlight crawls across the glass as it should.

**Glass is clear only where it faces you.** A sphere transmits best head-on, which is the middle of
the ball, and its reflectance climbs to 1 at the rim — that is real physics, not a bug, and it means
the rim of any glass marble behaves like a mirror. So a core big enough to sit in the middle hides
the *only* part of the ball you can see through, and the marble reads as an empty ring with something
floating in it. `Solid fill` is the dial for that trade, and every design ships with a core small
enough to leave a clear window around it.

**The lamp, and how to measure one.** There is no bloom pass, so a bright bead inside glass reads as
cream paint rather than as a lamp. The lantern carries additive billboards (a `DataTexture` radial
falloff, built as pixel data so the module stays DOM-free) plus a real `PointLight` that pools on the
timber as it rolls. Two things about that light cost real time to get right:

- Its strength is set by measurement, not taste. A point light falls off as 1/d squared and sits at
  the marble's *centre*, so how far it is from the board depends on the marble's radius. At the
  shipped radius it reads as a bright pool; in the lab the hero marble is scaled up and floats, where
  the same light is ~49x weaker.
- The control has to be the same marble with its own lamp off. Comparing the lantern against another
  marble looks reasonable and is not: two designs differ in their core colour and their glass as well
  as their light, so the number measures the marbles. That mistake shipped a confident "+32.7 R" that
  meant nothing, and changing only the *glass* moved it to "+64.8 R" without the light changing at
  all. The tool now also reads the lamp's state back before trusting the pixels, because a toggle
  that silently did nothing is indistinguishable from a lamp that lights nothing — which is exactly
  what happened when the check ran after the shot loop and toggled the lamp on whatever marble was
  shot last.

With the same marble measured on and off: **+49 R, +44 G, +31 B** on a band of board around it.

### Seeing them

```bash
npm run marbles                     # the family and a hero close-up per marble -> docs/marbles/
node tools/marble-board-shot.mjs    # each marble on the real board, plus the lamp measurement
```

`?marble=` picks one by link, and the same swap is on the debug API
(`__maze.tuning.set('marbleLook', 'gem')`), which is how the board shots are taken — the tuning
value is applied through one function whether it came from a slider, a preset or the console, so a
look cannot be live from the sheet and dead everywhere else.

## Candidate boards (birch, cherry, marble) and the grain-prominence knob

```bash
devports launch --name marblemaze --port 3010 -- node sim/serve.js --port {port}
# then open /tools/materials.html
```

Four boards, lit identically with the game's own rig: **birch** and **cherry**, **marble**, and the
shipped **walnut** picture as the reference. Click a board to pick it, drag **grain prominence** to
set how loud its grain reads, and the URL keeps the choice (`?pick=cherry&grain=1.4`).

**The same four finishes are in the game**, in the tuning sheet's *Board finish* group (**T**): the finish
button row and the grain-prominence slider.

### The rim is a separate decision

The frame around the board is cut at its own grain and its own stain, because continuing the board's
grain into the rim is a look you can like or not like - and it is not the only honest way to build a
toy out of timber. Two controls:

- **Rim** - *Same board* continues the board's grain into the frame, so the toy is one piece of timber
  (the shipped look). *Book-matched* is that same board flipped, so the figure turns back on itself at
  the join. *Another board* is an independently generated grain of the same species: a second board of
  the same tree, not a continuation of this one.
- **Rim stain** - darkens the rim alone, from 0 (the board's own colour) to 1 (a deep stain). Any stain
  can be combined with any of the three rim cuts, which is what makes "much darker *and* a different
  board" reachable with two knobs instead of a menu of twenty named looks.

Why there is no "rim rotated 90 degrees" option: the board picture covers exactly the board, so a
rotation would leave the frame sampling the clamped edge of the image, and moving the rim to another
*region* of a 16x11 picture that is already all board is not possible. Mirroring stays inside the
picture, and `Another board` deliberately leaves the picture for an independently generated grain.

Renders of every rim option on the cherry board, taken from the game itself, are in
`docs/materials/rim-*.png`, with all seven side by side in `docs/materials/rim-options.png`
(`node tools/rim-shot.mjs --finish cherry`, or `--sheet` to rebuild just the contact sheet). The
script holds the board level before each shot, because the toy is a physics toy: without that, two
pictures of the *same* setting differ by more than two different settings do.

The rim is rebuilt with the board, so changing either control costs the same one rebuild. One finish moves the board, its walls, the inside of every
hole and the ramp together, because they are one piece of timber at different tones, so the grain keeps
lining up across all of them. It is saved with your tuning and `?physics=default` ignores it, exactly
like every other sheet setting.

Two things this page is honest about, because they are easy to mistake for a defect:

- **Birch and cherry are the shipped walnut picture recoloured**, not photographs of those species.
  Its grain structure, pores and cathedral figure are real, and a species is a tone curve, a colour
  cast and a grain contrast on top (`PHOTO_TIMBERS` in `src/render/board-materials.js`). That is a
  direction to choose between; generating real boards for the winner is a separate step.
- **The close-up is drawn about 1:1 with the picture's own texels**, from a native-resolution band of
  it rather than by magnifying the whole board. At 1152 px across 16 board units the picture's 96 px
  per unit is shown at 72, so what you see is grain, not interpolation.

The **marble** candidate is procedural (`stoneFields`): warped veins in three families with pale
haloes, a slow field choosing between a cool and a warm mineral, and crystal speckle. The **grain
prominence** slider scales the fine structure about the mean and carries into the normal map and the
pores, so a faint grain is faint in relief as well as in tone; at 1.0 every candidate is exactly what
it was generated as. The procedural *fields* board is still the fallback if the picture cannot load - in the game too, where a
missing picture gives a coarser board in every finish rather than a broken toy.

Marble has no picture, so its tone is applied to the slab's own colours: the wall is a shade darker and
the ramp a paler *piece of stone*, which keeps the cue that says "the marble climbs here" without
turning a stone toy into a timber one.

Regenerate the reference renders with:

```bash
node tools/materials-shot.mjs --out docs/materials
```

## The lid

The toy is sealed: a glass pane clamped in a gunmetal collar that stands on the rim wall,
with the grip — a ribbed ring on four spokes over a brass column — at the centre of the
glass. It rocks with the board, because that is the object your hands hold: **grip the
handle and tip it**. Hovering the handle lifts it faintly so it is obvious what to hold.

The handle is now a small knurled knob you pinch, with a **compass rose etched into the glass**
around it: three thin rings and tick marks at the eight compass points, sized from the board so
no part of it ever sits over a hole. The engraving is grey glass rather than white paint - thin
enough to read as a groove, and faintly iridescent along its length the way a real etched line
diffracts. The board draws 10% bigger (`VIEW_SIZE`) and is viewed from
nearly straight above through a long lens, so a level board *looks* level.

The case's own corners are **eased, not mitred**: the wood, the rim timber, the collar and its lip
all come off one rounded outline, so the toy reads as a machined frame rather than a box.

**Four level indicators** run along the sides, one per side, in troughs cut into the metal collar -
and there are two of them, switchable in the tuning sheet under *Indicator*:

- **Bars** (default): a hot red glowing bar in each trough, about one marble's width long, placed
  from the board's tilt every frame. No liquid, no lag, nothing to settle - the bar is the angle, and
  all four bars are the same length. The bar is its own light on a polished silver scale, and the
  scale is **one track laid through all four troughs**: it turns each corner with a slight curve
  rather than stopping short of it, so the four bars read as one instrument.
- **Liquid**: the simulated vials. Slower to read, but alive (below). Its trough end caps - the
  blocks that stop one side's liquid running into the next - are the liquid's alone, and bars mode
  hides them.

Both have feathered edges rather than cut ones: the bar carries a soft additive halo around its base,
and the liquid's surface fades into the channel walls.

There is also **Both** and **Off**.

**The liquid vials** run along the sides, one per side, cut into the metal collar that clamps
the glass. They are the second angle indicator: the rose says the glass is turning, the vials say how
far and which way, because the liquid stays level in world space while the board tilts under it. The
liquid is simulated rather than animated - a 1D shallow-water model stepped on the fixed physics tick
- so it tilts immediately, runs to the low end, overshoots, sloshes and settles, with a little
splashback off the end caps. Its viscosity, splashback, response and fill are all on sliders.

The studio light has three sliders of its own (**Diffuse light**, **Reflection**, **Light size**).
Diffuse drives the key, the fill and the shadows; reflection is how bright the studio lights look
themselves when mirrored in the glass and the marble, and it is independent, so the glare can be
dimmed - or removed - without darkening the board. Both bright sliders run from **0 (nothing) to
1.0, which is the shipped look**: they used to go brighter than the shipped look, and the top of
those ranges is what made a bright setting read as a washed-out one. Size rescales the softboxes,
so one end is a tight harsh pool and the other an even wash. While the tuning sheet is open, the board
is centred in the space the sheet leaves rather than in
the window — the camera is lens-shifted, so its size does not change.

The lid is presentation only; the physics never sees it. But it is not decoration either:
the glass has to stay clear enough to see the pits through, which is why the pane is a
plain thin transparent surface rather than real `transmission` glass (that renders a
lethal pit *brighter* than the floor around it — measured, then removed) and why nothing on
the lid casts a shadow. `docs/DESIGN.md` has the numbers and the invariants.

## Physics in one paragraph

The marble is a glass cat's-eye of radius 0.27 on a unit grid, simulated in **board space** — a 2D plane the board tilts. Tilt about the
board's X axis gives in-plane gravity `g·sin(tilt.x)` along +z, and tilt about Z gives
`g·sin(tilt.z)` along +x. A solid sphere rolling without slipping only receives `5/7` of
that, which is why the marble feels heavy rather than pinball-fast. Walls, gates and
obstacle bars are line segments with restitution and tangential friction; pegs and windmill
hubs are discs, and so is an arm's thickness. Rotating and sliding obstacles pass their
**contact velocity** to the marble, sampled *at the contact point*, so a windmill arm's tip
throws harder than its hub and a sliding gate carries instead of acting like a wall. A ramp is
the one feature that changes the *height* of the ground: the marble climbs its slope, the climb
costs it exactly the speed that gravity hands back on the way down, and a crest turns the climb
rate it was carrying into a ballistic hop whose height and length grow with how fast it crested. Everything is a fixed 1/180 s step with no RNG anywhere, so every run is
reproducible — which is what makes the autopilot test meaningful.
