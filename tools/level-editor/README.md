# Level editor

A standalone authoring tool for Marble Maze levels. It writes the declarative level spec
from [`docs/DESIGN.md`](../../docs/DESIGN.md) and validates it with the game's own engine,
so a level that passes here is a level the headless suite accepts.

Nothing in this directory is imported by the game. It only *reads* `src/engine/*.js`.

## Run it

```bash
cd /Users/nick/ActiveProjects/MarbleMaze
devports launch --name marblemaze-editor -- node sim/serve.js --port {port}
# then open <printed URL>/tools/level-editor/index.html
```

The game and the editor are served by the same static server; only the URL differs. Use the
full `index.html` path — `/tools/level-editor/` on its own is a directory, not a page.

## What it does

- **Paint the board** with the obstacle vocabulary: floor, wall, ice, sand, steel, conveyor,
  fan/vent. Click and drag; right-drag erases. The paint grid is per *cell* — you cannot have
  half a wall cell, and the engine agrees. (A pressure **button** is an object, not a paint:
  see below.)
- **Material plates** place ice, sand or steel on a *rectangle* instead of on cells, with edges
  snapped to the authoring grid — so materials can be aligned to an eighth of a cell too, and a
  plate can end halfway along a cell. See *Materials* below.
- **Pits are painted as positions, not cells.** The pit brush drops centres on the authoring
  grid; drag to lay a run of them. Centres that overlap merge into **one slot**, drawn (here
  and on the board) as a rounded slot, and exported as a single `centers` chain. Right-drag
  removes a centre, splitting the chain when it was in the middle. A pit may be cut into **any
  material** — ice, sand or steel — and the material is cut around the hole rather than erased
  by it.
  Two pit areas that end up overlapping (two runs, or a run drawn across an earlier one) are one
  hole, and are drawn as one: the plan view fills and rims the union, so the rim runs round the
  combined outside only and no rim crosses the ground they share. The board does the same — the
  slab cut, the funnel and the shaft all take the union (`combineHoleRings` in
  `src/engine/hole-ring.js`). Validation still lists an overlap as a problem, because a slot is
  authored as one chain: draw the run as a single stroke where you can.
- **Sub-unit placement.** *snap* picks the authoring step: whole cells, halves, quarters or
  eighths (the default). Everything with a continuous position goes on that grid — pits, pegs,
  magnets, windmills, pendulums, plates, teleport pads, sliding-bar ends, gate and flap
  segments, even the marbles and the cup. `whole cells` reproduces cell-by-cell authoring, so a
  level written the old way still reads the old way.
- **Marbles.** *Marble* is the spawn tool: click empty floor to add one, and every level keeps
  as many marbles as you place. Drag a marble on the board, or type its cell position under
  *Properties*, to reposition it; right-drag (or Alt-click) removes one, and the last marble is
  kept so a level always has a starting point. Two marbles may not share a spot (or start
  closer than one marble apart), because the engine would start them in collision and
  `tests/levels.test.js` rejects it. Adding a second marble exports `spawn` as a list plus
  `multi: true`, exactly the shape `twin-track` uses; with one marble the draft stays the
  familiar `spawn: [c, r]`. Every marble must reach the cup to win, so the ledger checks each
  one: walkable floor, a route to the goal, no pit beneath it, and a par that covers the
  longest marble's route.
- **Place objects**: goal cup, bumper posts, windmills, pendulums, magnets, **pressure buttons**
  (→ a gate, and/or → **lift walls**), sliding bars, teleport pairs, gates, lift walls, one-way
  flaps. The cup and a cell obstacle can be dragged too, so any single-point object repositions
  the same way a marble does.
- **Pressure buttons.** The **Pressure button** object is a raised circular metal button, placed
  on the authoring grid like a pit — so it may sit on a fraction of a cell, and it sits *on* any
  ground (ice, sand, steel, a material plate, plain floor) without erasing it. Its property sheet
  sets its `id`, its optional `gate`, and its **metal** (`brass`, default, or `steel`, `copper`,
  `gunmetal`, `bronze`, `gold`), which is the finish of the button *and* of every lift wall it
  drives. The plan view draws it as a metal disc.
- **Lifts.** The **Lift wall** tool clicks the two ends of a slab, then the property sheet picks
  which button drives it and which way: *lowers (wall rests up)* for a door that sinks while the
  button is held, or *raises (wall rests flush)* for a wall that stands up while it is held. A
  button needs an `id` for a lift to name it — the button tool assigns one (`p1`, `p2`, …) — and a
  button with no gate at all is valid: it just drives its lifts. The plan view draws each slab as
  a **metal** band along its own segment (the line the marble collides with), with a *dashed* core
  line in the mode's cue colour and a dashed link to its button.
- **See what the engine sees.** The canvas is drawn from `buildLevel()` output, not from the
  paint grid, so the automatic rim wall, the drawn hole radii and every disc size are honest.
  Board-edge cells always become wall, and the editor says so when it happens.
- **Validate continuously.** Every check names the rule it reproduces from
  `tests/levels.test.js` and calls the same engine primitives (`silhouetteLoops`,
  `holeProblems`, `roseProblems`, `reachable`, …). Red = the suite would fail; yellow = an
  authored-data smell the engine would otherwise paper over silently (a pit painted over a
  wall cell becomes a hole through that wall, a plate naming a gate that does not exist, and
  so on).
- **Playability comes from the geometry, not from the solver.** *Solve* is **disabled** (the
  button is present, greyed, and marked `solver off`, with the reason spelled out in the Rules
  panel). See *Why the solver is off* below.
- **Open an existing level** from *Start from* (level 1, or any level in
  `src/engine/levels.js`) and edit it.
- **Export** a paste-ready `LEVELS` entry, or JSON. The working draft autosaves into one
  browser slot (`last session (auto)`); *save draft* snapshots it under its own id. A saved
  entry whose id equals a shipped level is labelled *(edited)* so a modified copy of level 1
  is never mistaken for the pristine one.

## Playing a draft (do this first)

The **play this draft** button in the editor header saves the working draft into the session
slot and opens the **game itself** at `index.html?draft=session`. So a level can be felt long
before it is anywhere near `src/engine/levels.js` — and what you feel is the shipped game:
same build, same renderer, same lighting rig, same sound, same loop.

```
http://127.0.0.1:<port>/index.html?draft=session   # the draft in the editor
http://127.0.0.1:<port>/index.html?draft=my%20level # one saved draft
http://127.0.0.1:<port>/index.html?level=first-tilt # a shipped level
```

The draft appears as the first card in the game's *levels* menu, with its own best-time row,
and the browser's saved physics tuning is honoured exactly as it is for a shipped level. Use
the browser's back button to return to the editor.

There is deliberately **no second play page**. The editor used to ship one, and it drifted:
it never applied the lighting rig (so every material rendered brighter and glossier than the
game — measured median board luminance 25.9 against the game's 14.1, environment intensity 1
against 0.446) and it had no sound. A draft is played by the game, or not at all.

## Getting a level into the game

1. *Export* → copy the `LEVELS` entry.
2. Paste it into the `LEVELS` array in `src/engine/levels.js`.
3. Check it with the rule ledger here (or `check.mjs`), then with the real suite: `npm test`.
   The suite includes the engine's autopilot test; that is the engine's own probe of
   `src/engine/autopilot.js`, not the editor's playability answer.

The editor deliberately cannot install the level itself. `src/engine/levels.js` is the
single source of truth for the shipped slate, and a level should reach it through the suite.

## Edited obstacles

A pit is selected by its own geometry: a whole slot is one clickable thing, anywhere along
it. Its panel carries the radius, the chain (each centre with its coordinates and a delete
button) and an optional slow slide (`speed`, `period`, `phase`, `dx`, `dy`). The
`movingPitVisual` flag becomes mandatory as soon as a pit slides, and the editor says so.
Teleports, sliding bars, gates, lift walls and one-way flaps are authored by clicking their two
ends; every other obstacle is placed with one click and edited in the property panel.

## Sub-unit coordinates and slots in the format

The palette has two brushes that place a *shape* rather than a cell: **Pit / slot** and the
**material plates** (ice, sand, steel). Both are dragged out on the authoring grid, and
`snap` decides what that grid is. Everything else still paints cells.

Every position in a level spec is in **cell space**, where an integer is the centre of that
cell: `3.5` sits on the edge between cells 3 and 4, and `3.125` is an eighth of a cell past
cell 3's centre. The engine accepts fractions wherever an object sits —
`{ cell: [11.375, 8.625] }`, `{ a: [1.125, 4.5], b: [8.5, 3.125] }` — and rounds to the
containing cell only where it has to mark a grid character (a pad, the spawn, the cup, and the
cells a pit blocks). A pressure **button** is an object like a pit, so it records its own
authored position and never paints the grid — it can sit on any ground without erasing it.

A slot is one pit with a chain of centres:

```js
pits: [
  [7, 9],                                                     // the classic cell-centre pit
  { c: 6.125, r: 8.25 },                                      // round, an eighth off centre
  { centers: [[5, 3.5], [6, 3.5], [7, 3.5]], radius: 0.42 },  // one slot, rounded ends
],
```

`buildLevel` turns a chain into **one** pit (carrying `centers`) and **one** slab hole, so the
etched rose, the hole rules and the slab cutter all see a single rounded slot rather than a
row of circles. `src/render/hole-shape.js` draws that outline — offset runs, a round arc on
the outside of every bend, a sharp corner on the inside, half-circles at the ends — and
`tests/slots.test.js` asserts every point of it sits exactly one radius from the chain, which
is the same region `pitDistance` swallows the marble in. A slot is not a shortcut around the
project's hole rule: what is drawn and what is dangerous are the same shape.

## Materials, and the two cell-space conventions

A material can be authored two ways, and both end up as the same thing: a region of ground the
engine keeps on a **1/8-of-a-cell lattice**.

```js
ice: [
  [4, 4, 11, 4],                       // whole cells, exactly as levels have always written it
  { rect: [4, 4.25, 12, 5.875] },      // a PLATE: cell-EDGE coordinates, to an eighth of a cell
],
```

The two forms differ in one way worth knowing:

- a **pit, object, spawn, goal or teleport pad** is authored at a cell **centre**, where `3.125`
  is an eighth of a cell past cell 3's centre — the convention the rest of this README uses
- a **material plate** is authored on cell **edges**, where `4` is the boundary of cell 4 and
  `[4, 4.25, 12, 5.875]` covers cells 4..11 from a quarter into row 4 to seven eighths into row 5

That is deliberate. Edges are what a rectangle *is*, and on edges `whole cells` lands exactly on
cell boundaries — which is what the cell form means — so the two forms agree at whole-cell
alignment (`tests/materials.test.js` asserts it cell by cell) while an eighth stays an eighth.

**A pit is a hole, not a paint job.** Dropping a pit on ice used to delete the ice under every
cell it reached, leaving a round hole in a square bald patch of bare wood. Now the ground keeps
its material, the pit is recorded in a pit mask instead, and the drawn plate is **cut by the
hole's true shape** — a round hole with ice right up to the rim, or a slot's capsule. A plate
straddled by a pit's edge (rare, and warned about in the Rules panel) is cut out of the lattice
instead of by a path, which draws a fine stepped edge; it fails the safe way, taking material
away rather than leaving any lying over a hole.

## CLI check

```bash
node tools/level-editor/check.mjs path/to/level.json   # the rule ledger
node tools/level-editor/check.mjs --level <id>         # a shipped level, by id
node tools/level-editor/check.mjs --list               # ids of the shipped levels
```

Exit code 1 when an error-level rule fails. `--solve` is accepted only to say that the solver
is disabled.

## Why the solver is off

The editor used to run the tilt autopilot (`solveLevel` from `src/engine/autopilot.js`) over
the draft and replay its trace. That is now **disabled**, deliberately:

- the autopilot has not kept up with the engine — vials, slot pits, sub-unit placement and the
  obstacle vocabulary all keep changing, so the solver needs work every time anything moves;
- a stale solver does not fail safe. It reports *not solved*, which reads as "this level is
  broken" when the truth is "the solver has not caught up with this level";
- that is worse than no answer, because it sends you looking for a bug in the level.

Playability is answered from the geometry instead, in the rule ledger: the goal must be
reachable over walkable cells, a pit must leave the marble room to get past, the floor must be
wide enough for it, and the cup must be wide enough to be a target. Those checks are computed
from the level `buildLevel()` actually produces, so they cannot fall behind the engine — and
none of them is a search that can silently start failing.

Nothing was deleted from the engine: [src/engine/autopilot.js](../../src/engine/autopilot.js),
`tests/solver.test.js` and `tools/solve.js` are untouched and still run in the repo's suite.
The editor simply does not call them.

## Files

| File | Role |
| --- | --- |
| `model.js` | draft ⇄ spec: paint grid, marble spawns, obstacle lists, rectangle decomposition, source export |
| `validate.js` | the rule ledger, mirroring `tests/levels.test.js` (every marble checked) |
| `render.js` | the 2D plan view (engine output, marbles, obstacles, sub-unit grid) |
| `editor.js` | UI wiring: tools, painting, property forms, export, storage |
| `check.mjs` | headless validation of an exported spec |
| — | engine side: `src/engine/materials.js` (regions, loops, hole cuts), `tests/materials.test.js` |
| `editor.js` → *play this draft* | hands off to the game with `index.html?draft=session`; there is no second play page (see *Playing a draft*) |
