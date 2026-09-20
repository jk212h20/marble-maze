//  Marbles: real geometry inside real glass.
//
//  The shipped ball is one textured sphere and nothing here changes that. What this suite pins
//  down is the *structure* the new marbles depend on, because it is easy to get subtly wrong:
//
//    * a symbol read from an SVG path must come back as ONE outline with its counters as HOLES.
//      Get that wrong and the Bitcoin mark extrudes as a solid blob, which still "works" but is
//      not the mark — a failure a screenshot only sometimes catches.
//    * a marble must present a shell named `marble-ball` (the size slider and the smoke checks
//      find the ball by that name) and it must be transparent with depth writing off, or the
//      opaque core inside is drawn after the glass and simply vanishes.
//    * the lantern's embedded light must actually be a light in the scene, and its tick must
//      change that light's intensity, since the whole claim is "a marble that lights the board".
//
//  Designs whose look comes from a canvas texture (cat's-eye, banded) need a document and are
//  exercised in the browser (tools/marbles-shot.mjs), not here.

import * as THREE from 'three';
import {
  MARBLE_DESIGNS,
  DEFAULT_MARBLE,
  designById,
  buildMarble,
  bitcoinShape,
} from '../src/render/marbles.js';
import {
  applyLampDials,
  applyBandDials,
  applyTintDials,
  LAMP_HUE_DEGREES,
  SHIPPED_MARBLE_IDS,
  SHIPPED_BANDS,
  shippedDesigns,
} from '../src/render/marbles.js';
import { parsePathData, polygonArea, pointInPolygon, shapesFromSubpaths } from '../src/render/svg-path.js';
import { MARBLE_LOOK, MARBLE_LOOKS, MARBLE_BAND_COUNT, MARBLE_BAND_WIDTH } from '../src/engine/constants.js';
import { TUNING_SPEC } from '../src/engine/tuning.js';
import { transmissionBufferScale } from '../src/render/scene.js';

/**
 * The transmission buffer is pure arithmetic that lives in the renderer, which is a browser
 * module. Only the exported scale function is reachable from node, and that is the part worth
 * asserting, so the rest of scene.js is exercised in the browser (tools/marble-cost.mjs).
 */

export const name = 'marbles';

const DOM_DESIGNS = new Set(['catseye', 'banded']);

export function tests(t) {
  t.ok('every design is addressable and described', () => {
    const ids = MARBLE_DESIGNS.map((d) => d.id);
    if (new Set(ids).size !== ids.length) throw new Error('duplicate design id');
    for (const d of MARBLE_DESIGNS) {
      if (!d.name || !d.blurb || !d.tone) throw new Error(`${d.id} is missing a name, blurb or tone`);
      if (designById(d.id) !== d) throw new Error(`${d.id} did not resolve to itself`);
    }
    if (!ids.includes(DEFAULT_MARBLE)) throw new Error(`default "${DEFAULT_MARBLE}" is not a design`);
    if (designById('no-such-marble') !== MARBLE_DESIGNS[0]) throw new Error('an unknown id should fall back to the first design');
  });

  t.ok('a marble built without a document is a shell named marble-ball with an opaque core', () => {
    for (const d of MARBLE_DESIGNS) {
      if (DOM_DESIGNS.has(d.id)) continue;
      const group = buildMarble(d.id);
      const shell = group.userData.shell;
      if (!shell || shell.name !== 'marble-ball') throw new Error(`${d.id}: no shell named marble-ball`);
      // A transmissive material is bucketed by three before `transparent` is even consulted, so the
      // shell is not required to set that flag; it must simply be the glass (see the next case).
      //  A design that says it has no interior is one solid sphere by design, so a core would be a
      //  hidden mesh drawn for nothing; everything else must have something in it to look at.
      if (d.interior === false) {
        if (group.userData.core) throw new Error(`${d.id} declares no interior but built a core`);
      } else {
        if (!group.userData.core) throw new Error(`${d.id}: no core`);
        if (group.userData.core.children.length === 0) throw new Error(`${d.id}: the core is empty`);
      }
      if (typeof group.userData.dispose !== 'function') throw new Error(`${d.id}: no dispose()`);
      group.userData.dispose();
    }
  });

  t.ok('the glass transmits: the board is visible through the marble, not just reflected off it', () => {
    // The property that actually matters, after two wrong versions of this glass.
    //
    // A white partial-opacity shell clouded every marble into the same grey ball; an additive
    // reflection-only shell fixed the cloud but read as an empty ring, because a clear ball on a
    // board is a *lens* - what sells it is the board seen through the ball, magnified and bent. So
    // the shell is required to transmit, with a real index of refraction and a volume to travel
    // through (three multiplies `thickness` by the model scale, so it survives the size slider).
    //
    // And the mirror of it, for the designs that are deliberately *not* glass: an opaque marble has
    // to be genuinely opaque, or three runs the transmission pass for a ball that shows nothing.
    let glassSeen = 0;
    for (const d of MARBLE_DESIGNS) {
      if (DOM_DESIGNS.has(d.id)) continue;
      const group = buildMarble(d.id);
      const m = group.userData.shell.material;
      if (!d.glass) {
        if (m.transmission !== 0) throw new Error(`${d.id} is marked opaque but transmits ${m.transmission}`);
        if (m.transparent) throw new Error(`${d.id} is marked opaque but is drawn transparent`);
        group.userData.dispose();
        continue;
      }
      glassSeen += 1;
      if (!(m.transmission > 0)) throw new Error(`${d.id}: the glass does not transmit, so nothing shows through it`);
      if (!(m.ior > 1)) throw new Error(`${d.id}: no refraction, so the ball will not act as a lens`);
      if (!(m.thickness > 0)) throw new Error(`${d.id}: no transmission volume, so there is nothing to refract through`);
      if (m.side !== THREE.FrontSide) throw new Error(`${d.id}: a double-sided transmissive shell refracts itself`);
      if (m.blending === THREE.AdditiveBlending) throw new Error(`${d.id}: additive glass cannot transport the board through it`);
      if (m.roughness > 0.06) throw new Error(`${d.id}: roughness ${m.roughness} is frosted, not clear`);
      group.userData.dispose();
    }
    if (!glassSeen) throw new Error('no design was checked as glass, so this case proves nothing');
    if (!shippedDesigns().some((d) => d.glass)) throw new Error('no shipped marble is glass, so a player never sees this');
  });

  t.ok('no marble leaks its geometry: dispose empties the ledger', () => {
    for (const d of MARBLE_DESIGNS) {
      if (DOM_DESIGNS.has(d.id)) continue;
      const group = buildMarble(d.id);
      if (group.userData.disposables.length === 0) throw new Error(`${d.id} tracks nothing`);
      group.userData.dispose();
      if (group.userData.disposables.length !== 0) throw new Error(`${d.id} kept its disposables after dispose`);
    }
  });

  t.ok('the bitcoin mark comes back as one outline with both counters as holes', () => {
    const shape = bitcoinShape(1);
    if (!shape) throw new Error('no shape produced');
    if (shape.holes.length !== 2) throw new Error(`expected 2 counters, got ${shape.holes.length}`);
    const outline = shape.getPoints();
    if (outline.length < 40) throw new Error(`outline only has ${outline.length} points: the curves were not flattened`);
    // The mark is taller than it is wide, which is how you know the proportions survived.
    const xs = outline.map((p) => p.x);
    const ys = outline.map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    if (!(h > w * 1.1)) throw new Error(`mark is ${w.toFixed(3)} x ${h.toFixed(3)}; a bitcoin ₿ is taller than wide`);
    for (const hole of shape.holes) {
      const pts = hole.getPoints();
      if (pts.length < 3) throw new Error('a counter collapsed to fewer than 3 points');
      const cx = pts.reduce((a, p) => a + p.x / pts.length, 0);
      const cy = pts.reduce((a, p) => a + p.y / pts.length, 0);
      if (!pointInPolygon([cx, cy], outline.map((p) => [p.x, p.y]))) throw new Error('a counter is not inside the outline');
    }
  });

  t.ok('the extruded symbol is a real solid, not a flat decal', () => {
    const group = buildMarble('bitcoin');
    let solid = null;
    group.userData.core.traverse((o) => { if (o.isMesh && o.geometry.type === 'ExtrudeGeometry') solid = o; });
    if (!solid) throw new Error('the bitcoin core is not an extruded shape');
    solid.geometry.computeBoundingBox();
    const box = solid.geometry.boundingBox;
    const depth = box.max.z - box.min.z;
    if (!(depth > 0.05)) throw new Error(`the symbol is only ${depth.toFixed(3)} deep`);
    if (solid.material.color.getHex() !== 0xf7931a) throw new Error('the symbol is not bitcoin orange');
    group.userData.dispose();
  });

  t.ok("the lantern's embedded light is a light, and its tick moves it", () => {
    const group = buildMarble('lantern');
    const light = group.userData.light;
    if (!light || !light.isPointLight) throw new Error('no point light in the lantern');
    if (typeof group.userData.tick !== 'function') throw new Error('no tick');
    const seen = new Set();
    for (let i = 0; i < 8; i++) {
      group.userData.tick(i * 0.3);
      seen.add(light.intensity.toFixed(4));
    }
    if (seen.size < 3) throw new Error(`the lamp barely moves (${seen.size} distinct intensities)`);
    if (light.intensity <= 0) throw new Error('the lamp went dark');
    group.userData.dispose();
  });

  t.ok('the engine\'s list of marble ids is the renderer\'s shipped list, in order', () => {
    // The engine cannot import the renderer, so it holds the ids as strings. That is only safe if
    // something checks they still match: a typo would otherwise surface as a silent fallback to
    // the first design, which looks like "the slider does nothing" rather than an error.
    //
    // Compared against the *shipped* list, not every design: shelving a design has to remove it from
    // the dial and from nothing else, so the shelved ones are asserted separately below.
    if (MARBLE_LOOKS.join(',') !== SHIPPED_MARBLE_IDS.join(',')) {
      throw new Error(`constants: [${MARBLE_LOOKS.join(', ')}] vs shipped: [${SHIPPED_MARBLE_IDS.join(', ')}]`);
    }
    if (MARBLE_LOOK !== DEFAULT_MARBLE) throw new Error(`default is "${MARBLE_LOOK}" but the renderer ships "${DEFAULT_MARBLE}"`);
  });

  t.ok('the Look dial offers exactly the shipped marbles, in order', () => {
    // The third copy of the list, and the one that is easiest to forget: the tuning sheet writes its
    // own options out, and `setTuning` *validates* against them. Adding a marble to the renderer but
    // not here does not fail loudly - the dial simply refuses the value and falls back to the
    // default, which is the "the slider did nothing" failure this repo keeps having to design out.
    // (It happened while Earth, Moon and Eight ball were being added: the game applied the cat's-eye
    // instead, and the shots tool was the only thing that noticed.)
    const item = TUNING_SPEC.flatMap((g) => g.items).find((i) => i.path === 'marbleLook');
    if (!item) throw new Error('the tuning spec has no marbleLook item');
    const offered = item.options.map((o) => o.value);
    if (offered.join(',') !== SHIPPED_MARBLE_IDS.join(',')) {
      throw new Error(`the Look dial offers [${offered.join(', ')}], the renderer ships [${SHIPPED_MARBLE_IDS.join(', ')}]`);
    }
  });

  t.ok('the shelved designs are not offered, but still build', () => {
    const shelved = MARBLE_DESIGNS.filter((d) => d.shelved).map((d) => d.id);
    if (!shelved.length) throw new Error('nothing is shelved, so this case is not testing anything');
    for (const id of shelved) {
      if (MARBLE_LOOKS.includes(id)) throw new Error(`"${id}" is shelved but still offered in the Look dial`);
      // Still reachable by URL, which is the whole point of shelving rather than deleting: the lab
      // and the shots tool keep them working. Canvas-textured designs need a document and are
      // exercised in the browser (tools/marbles-shot.mjs), so only the geometry ones build here.
      if (DOM_DESIGNS.has(id)) continue;
      const marble = buildMarble(id);
      if (marble.userData.id !== id) throw new Error(`shelved design "${id}" no longer builds`);
      marble.userData.dispose();
    }
    if (shippedDesigns().length !== SHIPPED_MARBLE_IDS.length) throw new Error('shippedDesigns disagrees with SHIPPED_MARBLE_IDS');
  });

  // --- the lamp dials (the lantern) ------------------------------------------------------------

  t.ok('the lamp dials move the light, the beads and the halos together', () => {
    // They must move as one thing. A brightness that reached only the light would leave painted-
    // looking beads throwing a brighter pool; a hue that reached only the light would put a green
    // pool under an amber marble.
    const marble = buildMarble('lantern');
    const before = {
      light: marble.userData.light.color.clone(),
      intensity: marble.userData.light.intensity,
    };
    if (!applyLampDials(marble, { brightness: 2, hueDegrees: 300 })) throw new Error('the lantern reported no lamp to dial');
    const light = marble.userData.light;
    if (!(light.color.getHex() !== before.light.getHex())) throw new Error('the hue dial did not move the light colour');
    marble.userData.tick(0.3, marble);
    if (!(light.intensity > before.intensity)) throw new Error('the brightness dial did not raise the light intensity');
    // The sprite halos are additive quads; their colour is a tint of the same white texture.
    const haloColors = [];
    marble.traverse((o) => { if (o.isSprite) haloColors.push(o.material.color.getHex()); });
    if (!haloColors.length) throw new Error('the lantern has no halos, so this case is not testing anything');
    if (!haloColors.every((hex) => hex !== 0xffa63a && hex !== 0xffbe66)) throw new Error(`the halos kept their shipped tints: ${haloColors.map((h) => h.toString(16))}`);
    marble.userData.dispose();
  });

  t.ok('the shipped hue is the shipped colour, exactly', () => {
    // The dial is defined as an offset from the shipped colour, so the default must be the identity
    // rather than something close to it. Otherwise every saved profile silently looks slightly off.
    const marble = buildMarble('lantern');
    const shipped = marble.userData.light.color.getHex();
    applyLampDials(marble, { brightness: 1, hueDegrees: LAMP_HUE_DEGREES });
    if (marble.userData.light.color.getHex() !== shipped) {
      throw new Error(`the default hue moved the lamp from ${shipped.toString(16)} to ${marble.userData.light.color.getHex().toString(16)}`);
    }
    if (marble.userData.lampGain !== 1) throw new Error(`the default brightness set a gain of ${marble.userData.lampGain}`);
    marble.userData.tick(0.4, marble);
    if (marble.userData.light.intensity === 0) throw new Error('the default brightness turned the lamp off');
    marble.userData.dispose();
  });

  t.ok('a marble with no lamp tolerates the lamp dials', () => {
    // The dials stay in the panel while any marble is on the board, so a no-op has to be a clean
    // no-op rather than an exception or a stray property.
    for (const id of ['solid', 'bitcoin']) {
      const marble = buildMarble(id);
      if (applyLampDials(marble, { brightness: 3, hueDegrees: 120 })) throw new Error(`"${id}" claims to have a lamp`);
      marble.userData.tick?.(1, marble);
      marble.userData.dispose();
    }
  });

  // --- nothing sticks out of a marble -----------------------------------------------------------

  /**
   * The farthest any vertex of a marble gets from its centre, as a multiple of its radius.
   *
   * Sprites are counted by their quad half-width instead, because a billboard has no vertices to
   * scan: the halo is a square whose *visible* glow reaches zero at its edge.
   */
  const reachOf = (group) => {
    group.updateMatrixWorld(true);
    let worst = 0;
    let who = 'none';
    const v = new THREE.Vector3();
    group.traverse((o) => {
      if (o.isSprite) {
        const reach = o.scale.x / 2;
        if (reach > worst) {
          worst = reach;
          who = 'sprite';
        }
        return;
      }
      if (!o.isMesh) return;
      const position = o.geometry.attributes.position;
      for (let i = 0; i < position.count; i++) {
        const d = v.fromBufferAttribute(position, i).applyMatrix4(o.matrixWorld).length();
        if (d > worst) {
          worst = d;
          who = o.name || o.type;
        }
      }
    });
    return { worst, who };
  };

  t.ok('nothing pokes out of a marble: every one is a smooth sphere', () => {
    // Nick, 2026-09-20: "nothing can be outside the smooth sphere of the marble's exterior."
    //
    // Bands, beads, halos and symbols all have to live *inside* radius 1 (the marble is built at
    // radius 1 and scaled by the size dial, so this is scale-free). Two earlier versions of this
    // work failed exactly here: a band shell at 1.001 and raised band rings at 1.004 were both
    // outside the surface, which is what prompted the rule. The tolerance is for the sphere's own
    // faceting, not a licence to protrude.
    const checked = [];
    for (const d of shippedDesigns()) {
      if (DOM_DESIGNS.has(d.id)) continue;
      const marble = buildMarble(d.id);
      const { worst, who } = reachOf(marble);
      if (worst > 1.0001) throw new Error(`${d.id}: ${who} reaches ${worst.toFixed(4)} of a radius, which is outside the marble`);
      checked.push(d.id);
      marble.userData.dispose();
    }
    if (checked.length < 2) throw new Error(`only checked ${checked.join(', ')}, which is too few to mean anything`);
  });

  // --- solid: the opaque marble -----------------------------------------------------------------

  t.ok('the solid marble transmits nothing, so it never pays for the glass pass', () => {
    // This is the point of the design: an opaque marble costs what the painted cat's-eye costs.
    const marble = buildMarble('solid');
    let transmissive = 0;
    marble.traverse((o) => {
      if (o.material?.transmission > 0) transmissive += 1;
    });
    if (transmissive) throw new Error(`${transmissive} solid material(s) transmit; the pass would run for an opaque marble`);
    // Its bands are its own surface, so there is no band geometry at all: one mesh, one sphere.
    let meshes = 0;
    marble.traverse((o) => { if (o.isMesh) meshes += 1; });
    if (meshes !== 1) throw new Error(`expected one mesh (the sphere), got ${meshes}`);
    if (!marble.userData.shell.material.map) throw new Error('the solid marble has no surface pattern');
    if (!marble.userData.bands) throw new Error('the solid marble exposed no bands for the dials');
    if (!marble.userData.tint) throw new Error('the solid marble exposed no colour for the picker');
    marble.userData.dispose();
  });

  t.ok('the solid marble takes any colour, and keeps its bands relative to it', () => {
    const marble = buildMarble('solid');
    const tex = marble.userData.shell.material.map;
    const sample = () => Array.from(tex.image.data.slice(0, 16));
    const shipped = sample();
    applyTintDials(marble, { color: '#c02040' });
    const red = sample();
    if (red.join() === shipped.join()) throw new Error('the colour picker did not change the surface');
    //  Red, and the bands are still separated from the body: a step lighter and a step darker, so
    //  the pattern survives a recolour instead of vanishing into a flat sphere.
    const rows = (() => {
      const data = tex.image.data;
      const out = [];
      for (let y = 0; y < 128; y++) out.push({ r: data[y * 4], g: data[y * 4 + 1], b: data[y * 4 + 2] });
      return out;
    })();
    const lums = [...new Set(rows.map((c) => (c.r + c.g + c.b).toFixed(0)))].map(Number);
    if (lums.length < 3) throw new Error(`expected the body plus two band shades, saw ${lums.length} distinct rows`);
    if (!rows.every((c) => c.r >= c.g && c.r >= c.b)) throw new Error('the recoloured marble is not warm');
    marble.userData.dispose();
  });

  t.ok('the band dials move the surface, and their defaults are the shipped look', () => {
    const marble = buildMarble('solid');
    const tex = marble.userData.shell.material.map;
    const shipped = Array.from(tex.image.data);
    //  Defaults are the shipped look, byte for byte. This is the "contrast 1 is the identity" rule
    //  again, now that the bands are a texture rather than materials.
    applyBandDials(marble, { contrast: 1, ...SHIPPED_BANDS });
    if (Array.from(tex.image.data).join() !== shipped.join()) throw new Error('the default dials moved the shipped surface');
    applyBandDials(marble, { contrast: 1, count: 11, width: SHIPPED_BANDS.width });
    const many = Array.from(tex.image.data);
    applyBandDials(marble, { contrast: 1, count: SHIPPED_BANDS.count, width: 0.2 });
    const thin = Array.from(tex.image.data);
    if (many.join() === shipped.join()) throw new Error('the band count dial did not redraw the surface');
    if (thin.join() === shipped.join()) throw new Error('the band width dial did not redraw the surface');
    if (thin.join() === many.join()) throw new Error('band count and band width are doing the same thing');
    marble.userData.dispose();
  });

  t.ok('the lantern wears subsurface bands that block its own light', () => {
    // The bands have to be *inside* the glass (that is the smooth-exterior rule) and opaque (that is
    // what cuts the glow). `alphaTest` rather than blending keeps them in the opaque pass, so they
    // cannot sort wrongly against the glass they sit behind.
    const marble = buildMarble('lantern');
    let bandShell = null;
    marble.traverse((o) => { if (o.name === 'marble-bands') bandShell = o; });
    if (!bandShell) throw new Error('the lantern has no band shell');
    if (!(bandShell.geometry.parameters.radius < 1)) throw new Error(`the band shell is outside the glass (${bandShell.geometry.parameters.radius})`);
    //  `undefined` counts as zero: a MeshStandardMaterial has no transmission at all, which is the
    //  point - an opaque material, not a clear one with the dial turned down.
    if (bandShell.material.transmission) throw new Error('the bands transmit, so they do not block anything');
    if (bandShell.material.alphaTest <= 0) throw new Error('the bands are blended rather than cut, so they will sort badly');
    if (!bandShell.material.alphaMap) throw new Error('the bands have no mask');
    if (bandShell.material.transparent) throw new Error('the bands are drawn transparent');
    //  The mask must actually be a *stripe* mask. `alphaMap` reads the green channel, so a mask written
    //  into alpha leaves green white and the shell becomes one opaque sphere - bands gone, marble dark.
    const mask = bandShell.material.alphaMap.image.data;
    let opaque = 0;
    const values = new Set();
    for (let y = 0; y < 128; y++) {
      const green = mask[y * 4 + 1];
      values.add(green);
      if (green > 127) opaque += 1;
    }
    if (values.size < 2) throw new Error(`the band mask has no gaps in it (green is ${[...values]} everywhere)`);
    //  Four bands of 0.45 of a pitch is about 57 rows of 128; the window is wide because the point is
    //  "it is banded, and not one solid shell", not the exact duty cycle.
    if (opaque < 16 || opaque > 100) throw new Error(`the band mask covers ${opaque} of 128 rows, which is not a banded pattern`);
    //  And the dials reach the mask rather than the geometry.
    const before = Array.from(bandShell.material.alphaMap.image.data);
    applyBandDials(marble, { contrast: 1, count: 9, width: 0.7 });
    if (Array.from(bandShell.material.alphaMap.image.data).join() === before.join()) throw new Error('the band dials did not reach the mask');
    marble.userData.dispose();
  });

  t.ok('the lantern\'s bands stay dark through the glass, and the dials reach them', () => {
    //  The bands sit *inside* a transmissive shell, so what the eye sees in a band row is whatever
    //  the band shell looks like in the buffer the glass samples. A glossy, metallic, env-reflecting
    //  shell is bright there - it mirrors the room - and the bands vanish however the dials are set.
    //  (Seen 2026-09-20: "it does not work at any band or light setting".) Matte and non-metallic,
    //  with the environment reflection off, is what makes the glow actually cut.
    const marble = buildMarble('lantern');
    let bandShell = null;
    marble.traverse((o) => { if (o.name === 'marble-bands') bandShell = o; });
    const mat = bandShell.material;
    if (mat.metalness > 0.01) throw new Error(`the bands are metallic (${mat.metalness}), so they mirror the room instead of blocking`);
    if (mat.envMapIntensity > 0.01) throw new Error(`the bands reflect the environment (${mat.envMapIntensity}), so they wash out through the glass`);
    if (mat.roughness < 0.9) throw new Error(`the bands are glossy (${mat.roughness}), so they catch the key light`);

    //  The poles have to be *gaps*. The game looks almost straight down the marble's axis, so a band
    //  over a pole is a single opaque spot that reads as a dark ball, not as stripes; the stripes
    //  only appear once the pole is clear.
    const mask = mat.alphaMap.image.data;
    if (mask[1] > 127 || mask[127 * 4 + 1] > 127) throw new Error('a pole is banded, so the top-down view is one dark cap');

    //  Contrast has to *move the bands*. As its own pivot the swing was `l + (l - l) * c === l`, so
    //  the slider moved and nothing changed - which is exactly what was reported.
    const base = mat.color.getHex();
    applyBandDials(marble, { contrast: 2, count: SHIPPED_BANDS.count, width: SHIPPED_BANDS.width });
    const darker = mat.color.getHex();
    if (darker === base) throw new Error('the band contrast dial did not move the bands');
    if (new THREE.Color(darker).getHSL({ h: 0, s: 0, l: 0 }).l >= new THREE.Color(base).getHSL({ h: 0, s: 0, l: 0 }).l) {
      throw new Error('raising the contrast did not darken the bands');
    }
    //  And 0 has to *remove* them: the body is clear glass, so a band cannot be sunk into it by
    //  matching a colour - an all-gap mask is the only thing that actually disappears.
    applyBandDials(marble, { contrast: 0, count: SHIPPED_BANDS.count, width: SHIPPED_BANDS.width });
    const cleared = mat.alphaMap.image.data;
    for (let y = 0; y < 128; y++) {
      if (cleared[y * 4 + 1] > 127) throw new Error(`band contrast 0 left a band at row ${y}`);
    }
    marble.userData.dispose();
  });

  t.ok('the engine\'s shipped band pattern is the renderer\'s', () => {
    // The marble is built with the shipped pattern before any dial moves, so both layers know it -
    // and if they drift, a fresh marble and a marble that has just been reset stop looking the same.
    if (MARBLE_BAND_COUNT !== SHIPPED_BANDS.count || MARBLE_BAND_WIDTH !== SHIPPED_BANDS.width) {
      throw new Error(
        `constants: ${MARBLE_BAND_COUNT} x ${MARBLE_BAND_WIDTH} vs renderer: ${SHIPPED_BANDS.count} x ${SHIPPED_BANDS.width}`,
      );
    }
  });

  t.ok('the dials are no-ops on the marbles that have nothing to move', () => {
    // The dials stay in the panel whatever is on the board, so a no-op has to be a clean no-op
    // rather than an exception or a stray property.
    const marble = buildMarble('bitcoin');
    if (applyBandDials(marble, { contrast: 2, count: 9 })) throw new Error('the bitcoin marble claims to have bands');
    if (applyTintDials(marble, { color: '#ff0000' })) throw new Error('the bitcoin marble claims to take a colour');
    marble.userData.dispose();
  });

  t.ok('an unknown design resolves to the default rather than throwing', () => {
    // The default is the canvas-textured cat's-eye, so this asserts the *resolution* here; the
    // browser shot of `?pick=nonsense` exercises the build itself.
    if (designById('definitely-not-a-marble').id !== DEFAULT_MARBLE) throw new Error('an unknown id did not fall back to the default');
  });

  // --- the path reader on its own -------------------------------------------------------------
  t.ok('the path reader handles relative commands and the shorthand curves', () => {
    // A square drawn with relative lines, then a second subpath relative to the current point.
    const subs = parsePathData('M0 0 l10 0 l0 10 l-10 0 z');
    if (subs.length !== 1) throw new Error(`expected 1 subpath, got ${subs.length}`);
    if (Math.abs(Math.abs(polygonArea(subs[0].points)) / 2 - 100) > 1e-6) {
      throw new Error(`square area is wrong: ${Math.abs(polygonArea(subs[0].points)) / 2}`);
    }
    const smooth = parsePathData('M0 0 C5 0 10 5 10 10 s10 10 20 0');
    if (smooth[0].points.length < 20) throw new Error('S/s shorthand produced no flattened points');
  });

  t.ok('the path reader closes an arc into a disc', () => {
    // Two half-arcs from (1,0) to (1,0) the long way round, i.e. a circle of radius 1.
    const subs = parsePathData('M1 0 A1 1 0 1 1 -1 0 A1 1 0 1 1 1 0 Z');
    const area = Math.abs(polygonArea(subs[0].points)) / 2;
    if (Math.abs(area - Math.PI) > 0.05) throw new Error(`arc area ${area.toFixed(3)} is not near pi`);
  });

  t.ok('nesting puts the largest subpath outside and the rest inside', () => {
    const { shapes } = shapesFromSubpaths(
      [
        { points: [[0, 0], [10, 0], [10, 10], [0, 10]] },
        { points: [[2, 2], [4, 2], [4, 4], [2, 4]] },
        { points: [[6, 6], [8, 6], [8, 8], [6, 8]] },
      ],
      { size: 10, flipY: false },
    );
    if (shapes.length !== 1) throw new Error(`expected a single shape, got ${shapes.length}`);
    if (shapes[0].holes.length !== 2) throw new Error(`expected 2 holes, got ${shapes[0].holes.length}`);
    const box = new THREE.Box2().setFromPoints(shapes[0].getPoints());
    if (Math.abs(box.max.x - box.min.x - 10) > 1e-6) throw new Error('the shape was not scaled to size');
  });

  //  The transmission buffer. Measured on the real GPU, a flat 0.6-of-viewport buffer cost +5.8ms
  //  per frame (15.1ms -> 20.9ms) while the marble it feeds covers about 4% of the width. These
  //  cases pin the replacement's invariant: hold the marble, and nothing else.

  t.ok('the transmission buffer is sized to the marble, not the viewport', () => {
    // A marble 4% of the viewport wide, at the high tier's cap.
    const scale = transmissionBufferScale(0.04, 0.6);
    if (scale >= 0.2) throw new Error(`a marble covering 4% was given ${scale} of the viewport`);
    if (scale < 0.04) throw new Error(`the buffer (${scale}) is smaller than the marble it feeds`);
  });

  t.ok('the transmission buffer never renders fewer pixels than the marble covers', () => {
    for (const d of [0.02, 0.05, 0.1, 0.3]) {
      const scale = transmissionBufferScale(d, 1);
      if (scale < d) throw new Error(`diameter ${d} got a buffer of ${scale}, which is undersized`);
    }
  });

  t.ok('a marble at the camera is capped, not given the whole frame', () => {
    // Pressed against the lens the projection blows up; the tier cap is what stops that.
    const scale = transmissionBufferScale(1.5, 0.35);
    if (scale !== 0.35) throw new Error(`expected the cap 0.35, got ${scale}`);
  });

  t.ok('a marble behind the camera still gets a real buffer', () => {
    // Projecting a point behind the camera gives a negative or absurd diameter. Either way the
    // buffer must stay an allocatable texture rather than collapsing to zero pixels.
    for (const d of [0, -0.4, NaN]) {
      const scale = transmissionBufferScale(d, 0.6);
      if (!(scale >= 0.02)) throw new Error(`diameter ${d} produced ${scale}`);
    }
  });

  t.ok('nearby footprints share one buffer, so it is not reallocated every frame', () => {
    // `WebGLRenderTarget.setSize` reallocates the texture on any change, so a marble drifting
    // across the board by a fraction of a pixel must not move the scale.
    const steps = new Set();
    for (let d = 0.040; d <= 0.048; d += 0.0005) steps.add(transmissionBufferScale(d, 0.6));
    if (steps.size !== 1) throw new Error(`one small drift produced ${steps.size} different buffers: ${[...steps]}`);
  });
}
