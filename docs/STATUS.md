# Status: what is built, what is stubbed

A single place to answer "is this real yet?" for anything the game or the level format
mentions. It records *current state only*; the reason a rule exists belongs in
`DESIGN.md`, and the level prose belongs in `README.md`.

Last checked: 2026-09-20, against `9ea562d` + the README fix.

## Shipped and playable

Levels **1–4** (First Tilt, Peg Board, Twin Track, Both Locks) and exactly the mechanics
they use:

| Mechanic | Engine | Renders | Used by a level | Tuned in the panel |
| --- | --- | --- | --- | --- |
| Raised walls, pits, goal cup | yes | yes | 1–4 | holes/cups |
| Plain bumper pegs | yes | yes | 1, 2 | bumpers |
| Windmill | yes | yes | 2 | bumpers |
| Ramp (wedge + crest launch) | yes | yes | 2 | geometry, not a slider |
| Pressure button → lift wall | yes | yes | 4 | — |
| Multi-marble boards and the all-home win | yes | yes | 3, 4 | — |
| `rect` board shape | yes | yes | 1–4 | — |
| Glass lid, collar, grip, etched rose | — | yes | all | light and glass |
| Angle indicators (bars / liquid vials) | yes | yes | all | level indicators |

Marbles offered by the **Look** dial: cat's-eye, lantern, solid, and the three painted
planets (earth, moon, eight ball).

## Built in the engine, tested, but in no level yet

These are **not** stubs in the engine: each has a physics path, a render path (except one),
a `TUNING_SPEC` entry, and a node test built on a synthetic fixture. What they do not have
is an authored level, so a player can never reach them. This is the list that answers
"magnets and such".

| Mechanic | Engine | Renders | Test | Blocker to shipping |
| --- | --- | --- | --- | --- |
| Ice / sand / steel surfaces | yes | yes (painted cells) | `physics.test.js` | needs a level (slate 5, 10, 11) |
| Conveyor belts | yes | yes (animated ribbed overlay) | `physics.test.js` | needs a level (slate 7) |
| Fans / vents | yes | grille plate only | `physics.test.js` | needs a level (slate 8); **no airstream visual** |
| Magnets (attract / repel) | yes | yes | `physics.test.js` | needs a level (slate 8) |
| Teleport pads | yes | yes | `physics.test.js` | needs a level (slate 9) |
| Button → **gate** with a hold timer | yes | yes | `physics.test.js` | needs a level; Built level 4 wires its button to lifts instead |
| One-way flap | yes | **no renderer at all** | `physics.test.js` | both a level *and* a visual |
| Pendulums | yes | yes | `physics.test.js` | needs a level (slate 10, 12) |
| Sliding bars (movers) | yes | yes | `physics.test.js` | needs a level (slate 11, 12) |
| Kicking pegs (`kick: true`) | yes | yes | `physics.test.js` | needs a level; 1 and 2 use plain pegs |
| Board shapes: hexagon, octagon, diamond, cross, diamond ring, star | yes | yes | `levels.test.js` builds each one; the collar/outline/rose rules are checked for all of them | needs a level (slate 5–7, 10, 12) |

Notes:

- `oneway` appears only in `src/engine/levels.js` and `src/engine/physics.js`. A level that
  authors one today gets an **invisible collider**; the design table marks its readability
  as an explicit dash. This is the one true render-side stub in the vocabulary.
- The fan's airstream is deferred on purpose: `DESIGN.md` calls it "later", and slate level 8
  is not authored until the "readable tell" question is answered.
- `TUNING_SPEC` says the quiet part out loud under *Level machinery*: "Matters on later levels
  (belts, fans, magnets). Tune now so the obstacles are already calibrated when they arrive."

## Deliberately shelved

- Marble designs **bitcoin, geode, helix, gem, banded**: they build and still answer to
  `?marble=…`, but each costs a transmission pass per frame, so they are filtered out of the
  Look dial (`shelved: true` in `src/render/marbles.js`). Visible with `?all=1` in the lab.
- Slate levels **5–12**: concepts only (`src/engine/slate.js`), shown in the in-game
  *levels → Planned slate* menu so the progression can be discussed before it is authored.

## Known stale / unfinished paths

- `tools/level-editor/check.mjs` does **not** run the autopilot. Its own header says the
  solver "has not kept up with the engine (vials, slot pits, sub-unit placement, a growing
  obstacle vocabulary)", so a solved/not-solved verdict there would mislead. `--solve` only
  reports that. Solvability is checked by `tests/run.js` instead.
- The autopilot proof covers single-marble levels. `both-locks` is `coop: true` and is proven
  by a scripted two-marble plan in `tests/lifts.test.js`.

## Test coverage

`npm test` = `node tests/run.js` → **223 checks across 14 suites**, dependency-free, all in
node (no browser, no GPU). Roughly:

| Suite | Checks | Covers |
| --- | --- | --- |
| `physics.test.js` | 40 | rolling, tilt, walls, pits, cup, every surface and every obstacle fixture |
| `marbles.test.js` | 31 | marble geometry/maps, the "nothing outside the sphere" rule |
| `levels.test.js` | 22 | fairness rules for levels 1–4, every board shape, the collar, the rose |
| `slots.test.js` | 21 | slot pits, hole outlines/funnels, sub-unit placement |
| `vials.test.js` | 22 | the liquid angle indicators |
| `materials.test.js` | 17 | plates, cut-outs, polygon-clipping regions |
| `tuning.test.js` | 17 | sliders, range modes, presets, solvable under every preset |
| `editor-marbles.test.js` | 13 | the editor's marble placement checks |
| `lifts.test.js` | 8 | plate/lift coupling, including the scripted `both-locks` plan |
| `multi-marble.test.js` | 8 | marble-vs-marble collision and the all-home win |
| `profiles.test.js` | 8 | saved tuning profiles |
| `drafts.test.js` | 6 | the editor draft store contract |
| `solver.test.js` | 6 | the tilt autopilot finishes every authored level, reproducibly |
| `editor-pits.test.js` | 4 | the editor's pit strokes combining into one hole |

**Not in `npm test`** (needs a running server and a browser, so they are run by hand):

- `node sim/smoke.mjs` — loads the real page, drives it, screenshots, times frames.
- `node sim/tune-check.mjs` — the panel changes the simulation; keys inside it do not tilt.
- `node sim/audio-check.mjs` — renders every voice offline and reports level/balance.
- `npm run perf`, `npm run marble-cost` — **real GPU** frame distribution and glass cost.
- `npm run marbles`, `npm run marble-board`, `npm run materials`, `npm run panel` — lab shots.

**Gaps worth naming:**

1. **The renderer has no unit coverage.** `src/render/scene.js` is the largest file in the
   repo and is exercised only by the browser checks and the shot tools. A feature can have a
   working physics path and a wrong picture without any suite noticing — which is exactly how
   the one-way flap ended up unrendered.
2. **Unbuilt-level mechanics are only tested on fixtures.** `physics.test.js` builds a tiny
   synthetic level per feature; `levels.test.js` and `solver.test.js` iterate only over the
   four authored levels. So there is no end-to-end guard that e.g. a belt reads correctly on a
   real board.
3. **The browser/GPU layer is manual**, so a regression there is caught only when someone
   runs it.
