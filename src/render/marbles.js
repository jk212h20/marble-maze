//  The marble lab: a small family of marbles, each built as real geometry rather than a
//  painted sphere.
//
//  Why geometry: the shipped cat's-eye is a single textured ball, and that is the right answer
//  for a swirl. It is the wrong answer for "a bit coin floating inside" or "a light in there",
//  because an object embedded in glass has parallax — you see the core slide against the shell
//  as the ball rolls, and the highlight on the glass crawls across it. Faking that with a
//  texture reads flat the moment the marble moves.
//
//  So each marble here is a *group*:
//
//    * an opaque CORE, drawn in the opaque pass (a symbol, a crystal, a helix, a lamp), and
//    * a transparent SHELL over it, drawn afterwards, which is the glass.
//
//  The shell never uses `transmission`: that needs a render target per frame and the board's
//  own glass lid already pays for enough. A clearcoat transparent sphere with a strong env map
//  is the cheap glass that the rest of the toy is built on, and it keeps the marble readable
//  against the timber, which is the whole job.
//
//  Everything is built at radius 1 and scaled by `TUNING.ballR` at pose time, exactly like the
//  original ball, so the size slider moves the picture and the physics together.

import * as THREE from 'three';
import { marbleTexture, earthMaps, moonMaps, eightBallMap } from './textures.js';
import { parsePathData, shapesFromSubpaths, dropEnclosingDisc } from './svg-path.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** The Bitcoin mark's letterform, from the Wikimedia Bitcoin.svg (public domain mark). */
const BITCOIN_PATH =
  'm46.103,27.444c0.637-4.258-2.605-6.547-7.038-8.074l1.438-5.768-3.511-0.875-1.4,5.616c-0.923-0.23-1.871-0.447-2.813-0.662l1.41-5.653-3.509-0.875-1.439,5.766c-0.764-0.174-1.514-0.346-2.242-0.527l0.004-0.018-4.842-1.209-0.934,3.75s2.605,0.597,2.55,0.634c1.422,0.355,1.679,1.296,1.636,2.042l-1.638,6.571c0.098,0.025,0.225,0.061,0.365,0.117-0.117-0.029-0.242-0.061-0.371-0.092l-2.296,9.205c-0.174,0.432-0.615,1.08-1.609,0.834,0.035,0.051-2.552-0.637-2.552-0.637l-1.743,4.019,4.569,1.139c0.85,0.213,1.683,0.436,2.503,0.646l-1.453,5.834,3.507,0.875,1.439-5.772c0.958,0.26,1.888,0.5,2.798,0.726l-1.434,5.745,3.511,0.875,1.453-5.823c5.987,1.133,10.489,0.676,12.384-4.739,1.527-4.36-0.076-6.875-3.226-8.515,2.294-0.529,4.022-2.038,4.483-5.155zm-8.022,11.249c-1.085,4.36-8.426,2.003-10.806,1.412l1.928-7.729c2.38,0.594,10.012,1.77,8.878,6.317zm1.086-11.312c-0.99,3.966-7.1,1.951-9.082,1.457l1.748-7.01c1.982,0.494,8.365,1.416,7.334,5.553z';

/** The Bitcoin mark as a THREE.Shape: outline plus both counters, centred on its own box. */
export function bitcoinShape(size = 1) {
  const subpaths = dropEnclosingDisc(parsePathData(BITCOIN_PATH));
  const { shapes } = shapesFromSubpaths(subpaths, { size });
  return shapes[0] ?? null;
}

// ---------------------------------------------------------------------------------------------
// materials

/**
 * Clear glass, as transmission.
 *
 * Two earlier attempts at this are worth recording, because they were both wrong in instructive
 * ways.
 *
 * The first was a white, ~44%-opaque shell. Every marble came out the same grey cloudy ball:
 * `opacity` multiplies *everything* a material contributes, so the alpha that weakened the white
 * wash also killed the highlight, and with `DoubleSide` the front and back faces composited to
 * roughly 66% white over the core. There is no alpha that gives a clear middle and a bright rim.
 *
 * The second was an additive shell with a black diffuse - reflections only, no wash. It did not
 * cloud the core, but it still did not read as glass, because a marble is a *lens*: what makes a
 * clear ball on a board look like clear glass is the board you can see through it, magnified and
 * bent near the rim. Reflections alone cannot show that, so the ball read as an empty ring with an
 * object floating in it.
 *
 * So the glass really does transmit. This costs one extra render of the opaque scene per frame
 * (`WebGLRenderer` renders `opaqueObjects` into a transmission render target - the transmissive
 * shell itself is excluded, so it cannot refract itself, and tone mapping is switched off for that
 * pass and applied once, to the shell - so the result is consistent with the rest of the board).
 * The scene sets `renderer.transmissionResolutionScale` to keep that buffer small, and the pass only
 * runs while a transmissive marble is actually in view, so a player on the shipped cat's-eye never
 * pays for it at all.
 *
 * `thickness` is in *local* units: three multiplies it by the model matrix's scale, so it keeps its
 * meaning when the marble-size slider changes the ball. It is the volume the refraction travels
 * through, which is what sets how strongly the ball magnifies the board.
 */
function clearGlass(over = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.02,
    ior: 1.5,
    transmission: 1,
    thickness: 0.9,
    specularIntensity: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1.0,
    side: THREE.FrontSide,
    ...over,
  });
}

const shellGeometry = () => new THREE.SphereGeometry(1, 64, 48);

/**
 * A radial falloff, built as pixel data rather than drawn on a canvas.
 *
 * This is the cheap stand-in for a bloom pass. A bright core inside glass needs a halo to read as
 * *light* rather than as a bright bead, and the honest way to fake one without a second render
 * target is an additive billboard behind the core. A DataTexture keeps the module DOM-free, which
 * matters because the tests build these marbles in node.
 */
function glowTexture(size = 64) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = ((x + 0.5) / size) * 2 - 1;
      const dy = ((y + 0.5) / size) * 2 - 1;
      const falloff = Math.max(0, 1 - Math.hypot(dx, dy));
      const i = (y * size + x) * 4;
      const alpha = Math.round(255 * Math.pow(falloff, 2.2));
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = alpha;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

/**
 * A latitude-banded alpha mask: opaque rows are bands, clear rows are gaps between them.
 *
 * A DataTexture rather than a canvas, because the marble tests build every design in node, where
 * there is no document - the same reason `glowTexture` is one. The rows are rewritten in place when
 * the band dials move, which is what makes band count and band width live controls instead of
 * build-time constants: redrawing 128 rows of a Uint8Array and setting `needsUpdate` costs nothing
 * next to rebuilding geometry.
 *
 * The sphere's own UVs run v = 0..1 pole to pole, so `count` bands across that range are bands of
 * latitude, which is what makes the marble's roll legible: they sweep and tilt as it turns.
 */
function bandTexture() {
  const height = 128;
  const data = new Uint8Array(height * 4);
  const tex = new THREE.DataTexture(data, 1, height, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;

  /**
   * Which band, if any, covers row `y`. -1 is the gap between bands.
   *
   * The strip is *phased by half a pitch*, so the sphere's two poles fall in the gaps rather than
   * inside a band. That matters because the game's camera looks almost straight down the marble's
   * axis: with a band over the pole, the whole visible cap is one opaque spot and the marble reads
   * as a dark ball however the dials are set - the stripes only appear if the pole is clear. Both
   * marbles share this writer, and an unbanded pole is right for both: a banded pole is a dot, not
   * a stripe you can follow as the ball rolls.
   */
  const bandAt = (y, bands, duty) => {
    const period = height / bands;
    const stripe = Math.max(1, Math.min(period - 1, period * duty));
    const pitch = Math.max(1, Math.round(period));
    const half = Math.round(pitch / 2);
    const within = (y + half) % pitch;
    return within < stripe ? Math.floor((y + half) / pitch) : -1;
  };

  /**
   * Write `colours` (a hex per band, alternating) as opaque rows, with `body` in the gaps.
   *
   * One writer serves both marbles: the solid one draws a band's *colour* here, and the lantern
   * draws white with alpha, which is the same rows read as a mask.
   */
  const redraw = (bands, duty, body, colours, alphaMask) => {
    const bodyColor = new THREE.Color(body);
    for (let y = 0; y < height; y++) {
      const band = bandAt(y, bands, duty);
      const i = y * 4;
      if (band < 0) {
        //  An alpha map is read from the *green channel*, not from alpha - so a gap row has to write
        //  black into RGB. Writing the mask into the alpha channel instead leaves green white
        //  everywhere, which quietly makes the whole shell one opaque sphere: the bands stop being
        //  bands and the marble goes dark. (That is exactly the bug this comment replaces.)
        data[i] = alphaMask ? 0 : Math.round(bodyColor.r * 255);
        data[i + 1] = alphaMask ? 0 : Math.round(bodyColor.g * 255);
        data[i + 2] = alphaMask ? 0 : Math.round(bodyColor.b * 255);
        data[i + 3] = 255;
        continue;
      }
      const c = new THREE.Color(colours[band % colours.length]);
      data[i] = Math.round(c.r * 255);
      data[i + 1] = Math.round(c.g * 255);
      data[i + 2] = Math.round(c.b * 255);
      data[i + 3] = 255;
    }
    tex.needsUpdate = true;
  };

  /**
   * Cut every row to a gap, so a shell wearing this mask draws nothing at all.
   *
   * That is how the lantern reads "band contrast 0": its body is *clear glass*, so sinking the
   * bands into the body cannot be done by matching a colour the way the opaque marble does it -
   * a matte white shell is not clear. Removing the stripe from the mask is the only honest way to
   * make the bands disappear.
   */
  const clear = () => {
    data.fill(0);
    for (let y = 0; y < height; y++) data[y * 4 + 3] = 255; // keep alpha opaque; green (the mask) is 0
    tex.needsUpdate = true;
  };
  return { tex, redraw, clear };
}

/** Track every material/geometry on a group so a marble can be swapped without leaking. */
function track(group, object) {
  group.userData.disposables.push(object);
  return object;
}

// ---------------------------------------------------------------------------------------------
// designs

function buildCatseye(group) {
  // The shipped marble: a painted swirl on a glass ball. Kept first in the list so the game's
  // original look is always one click away from the new ones.
  const tex = track(group, marbleTexture());
  const shell = track(
    group,
    new THREE.Mesh(
      shellGeometry(),
      new THREE.MeshPhysicalMaterial({
        map: tex,
        emissiveMap: tex,
        emissive: 0xffffff,
        emissiveIntensity: 0.22,
        metalness: 0.25,
        roughness: 0.035,
        clearcoat: 1,
        clearcoatRoughness: 0.015,
        envMapIntensity: 2.1,
        ior: 1.5,
      }),
    ),
  );
  return { shell };
}

//  ---------------------------------------------------------------------------------------------
//  The painted planets
//
//  Earth, the Moon and the eight ball are the opposite idea to the lantern: nothing is inside them,
//  there is no glass and no core, and their whole look is one map on one sphere. That is exactly what
//  the shipped cat's-eye is, so they cost what it costs - no transmission pass, no extra draw call -
//  which is why three *painted* designs can ship while the clear-glass ones stay on the shelf.

/**
 * One painted sphere: a map, plus whatever surface the design asks for.
 *
 * `emissive` lifts the whole map very slightly off its own colours. It is not a glow: the board is
 * dark timber and the game's key light rakes across it, so a matte ball lit only by the scene loses
 * its far side entirely and reads as a dark lump. The figure is small on purpose - enough to keep the
 * map legible as it turns, not enough to look like the marble is lit from inside.
 */
function paintedShell(group, { map, emissive = 0.1, ...surface }) {
  const material = track(
    group,
    new THREE.MeshPhysicalMaterial({
      map: track(group, map),
      emissive: 0xffffff,
      emissiveMap: map,
      emissiveIntensity: emissive,
      metalness: 0,
      roughness: 0.6,
      clearcoat: 1,
      clearcoatRoughness: 0.25,
      envMapIntensity: 1.0,
      ...surface,
    }),
  );
  return { shell: track(group, new THREE.Mesh(shellGeometry(), material)) };
}

function buildEarth(group) {
  //  The roughness map is what makes the sea read as water rather than as blue paint: the ocean is
  //  the only glossy part of the globe, so the key light throws a specular sweep that slides across
  //  the ball as it rolls. It is also free - the land mask is already known when the map is painted.
  //
  //  The bump map is the third map and the quietest win: the continents stand slightly proud of the
  //  ocean floor and the mountain belts stand proud of the continents, so the light crosses a globe
  //  with relief on it instead of a flat decal. `bumpScale` is in the marble's own units, where the
  //  radius is 1.
  const { map, roughness, bump } = earthMaps();
  return paintedShell(group, {
    map,
    roughnessMap: track(group, roughness),
    bumpMap: track(group, bump),
    bumpScale: 0.02,
    roughness: 0.72,
    metalness: 0.02,
    clearcoat: 0.9,
    clearcoatRoughness: 0.22,
    envMapIntensity: 1.05,
    emissive: 0.16,
  });
}

function buildMoon(group) {
  //  A bump map rather than a normal map, because the crater field is generated as a height and the
  //  rim highlight is the whole reason it is there: sampled flat, the craters would be stains that
  //  vanish as the light moves off them.
  const { map, bump } = moonMaps();
  return paintedShell(group, {
    map,
    bumpMap: track(group, bump),
    bumpScale: 0.03,
    roughness: 0.95,
    clearcoat: 0.22,
    clearcoatRoughness: 0.7,
    envMapIntensity: 0.7,
    emissive: 0.14,
  });
}

function buildEightBall(group) {
  //  A real pool ball is lacquer over black: low roughness, a strong clearcoat, and no trace of
  //  metalness. The environment does the rest, which is why the black reads as polished rather than
  //  as a hole in the board.
  const { map } = eightBallMap();
  return paintedShell(group, {
    map,
    roughness: 0.07,
    metalness: 0.12,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.5,
    emissive: 0.05,
  });
}

function buildBitcoin(group) {
  const shape = bitcoinShape(0.66);
  const geometry = track(
    group,
    new THREE.ExtrudeGeometry(shape, {
      depth: 0.17,
      bevelEnabled: true,
      bevelSize: 0.012,
      bevelThickness: 0.016,
      bevelSegments: 2,
      curveSegments: 6,
    }),
  );
  geometry.center();
  const symbol = new THREE.Mesh(
    geometry,
    track(
      group,
      new THREE.MeshStandardMaterial({
        color: 0xf7931a,
        emissive: 0xc65a00,
        emissiveIntensity: 0.75,
        metalness: 0.35,
        roughness: 0.3,
        envMapIntensity: 1.1,
      }),
    ),
  );
  // The extruded letter lies in XY; stand it up so it faces the camera's near-top-down view.
  symbol.rotation.x = -Math.PI / 2;
  const core = new THREE.Group();
  core.add(symbol);

  // A faint orange pool of light on the wood under the marble: it is what sells "this ball has
  // something glowing in it" from across the board, since there is no bloom pass to lean on.
  const light = new THREE.PointLight(0xff9a2e, 0.5, 3.2, 2);
  light.position.set(0, -0.15, 0);
  group.add(light);

  const shell = new THREE.Mesh(shellGeometry(), clearGlass());
  return { core, shell, light, symbol };
}

function buildGeode(group) {
  const core = new THREE.Group();
  const rock = new THREE.Mesh(
    track(group, new THREE.IcosahedronGeometry(0.5, 0)),
    track(
      group,
      new THREE.MeshStandardMaterial({
        color: 0x2e6f8e,
        emissive: 0x0d4a63,
        emissiveIntensity: 0.55,
        metalness: 0.2,
        roughness: 0.28,
        flatShading: true,
      }),
    ),
  );
  const inner = new THREE.Mesh(
    track(group, new THREE.OctahedronGeometry(0.26, 0)),
    track(
      group,
      new THREE.MeshStandardMaterial({
        color: 0x9fe6ff,
        emissive: 0x3fb6e0,
        emissiveIntensity: 1.1,
        metalness: 0.1,
        roughness: 0.2,
        flatShading: true,
      }),
    ),
  );
  // A scatter of small crystals on the inside of the shell, like a real geode's druse.
  const shardGeo = track(group, new THREE.TetrahedronGeometry(0.11, 0));
  const shardMat = track(
    group,
    new THREE.MeshStandardMaterial({
      color: 0xdcf6ff,
      emissive: 0x63c7e6,
      emissiveIntensity: 0.7,
      roughness: 0.22,
      metalness: 0.15,
      flatShading: true,
    }),
  );
  for (let i = 0; i < 9; i++) {
    const a = i * 2.399963;
    const y = -0.62 + (i / 8) * 1.24;
    const r = Math.sqrt(Math.max(0, 1 - y * y)) * 0.66;
    const shard = new THREE.Mesh(shardGeo, shardMat);
    shard.position.set(Math.cos(a) * r, y * 0.62, Math.sin(a) * r);
    shard.rotation.set(a * 0.7, a, y * 2);
    shard.scale.setScalar(0.7 + ((i * 37) % 10) / 14);
    core.add(shard);
  }
  core.add(rock);
  core.add(inner);
  return { core, shell: new THREE.Mesh(shellGeometry(), clearGlass()) };
}

function buildHelix(group) {
  const core = new THREE.Group();
  /** One ribbon of glass wrapped pole to pole. */
  const strand = (turns, radius, tube, phase, material) => {
    const pts = [];
    const N = 96;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const a = phase + t * Math.PI * 2 * turns;
      const rr = radius * Math.sin(Math.PI * t) + tube;
      pts.push(new THREE.Vector3(Math.cos(a) * rr, Math.cos(Math.PI * t) * 0.62, Math.sin(a) * rr));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = track(group, new THREE.TubeGeometry(curve, 96, tube, 8, false));
    return new THREE.Mesh(geo, material);
  };
  const orange = track(
    group,
    new THREE.MeshStandardMaterial({ color: 0xf7931a, emissive: 0x7a3600, emissiveIntensity: 0.6, roughness: 0.25, metalness: 0.4, envMapIntensity: 1.3 }),
  );
  const cyan = track(
    group,
    new THREE.MeshStandardMaterial({ color: 0x36c6e8, emissive: 0x0a5a72, emissiveIntensity: 0.7, roughness: 0.22, metalness: 0.45, envMapIntensity: 1.3 }),
  );
  core.add(strand(2.5, 0.42, 0.075, 0, orange));
  core.add(strand(2.5, 0.42, 0.075, Math.PI, cyan));
  const bead = new THREE.Mesh(
    track(group, new THREE.SphereGeometry(0.18, 24, 16)),
    track(group, new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0x9a6a20, emissiveIntensity: 0.5, roughness: 0.15, metalness: 0.6 })),
  );
  core.add(bead);
  return { core, shell: new THREE.Mesh(shellGeometry(), clearGlass({ roughness: 0.03, thickness: 1.0 })) };
}

function buildLantern(group) {
  // Embedded light: emissive beads inside, plus a real point light so the marble throws a
  // coloured pool onto the board. The beads keep it legible in a still frame; the light makes
  // it *a lamp* when it rolls.
  const core = new THREE.Group();
  // Saturated rather than pale: a near-white emissive at high intensity tone-maps to a flat white
  // disc, and the beads stop reading as lamps. Amber at a lower intensity keeps its colour.
  const glow = track(
    group,
    new THREE.MeshStandardMaterial({
      color: 0xffd79a,
      emissive: 0xffa235,
      // High enough that the bead's centre clips toward white while its edge stays amber: that
      // rolloff is what a lamp looks like, where a mid-intensity emissive looks like cream paint.
      emissiveIntensity: 3.4,
      roughness: 0.3,
      metalness: 0,
    }),
  );
  const beadGeo = track(group, new THREE.SphereGeometry(0.13, 20, 14));
  //  One mesh for the eight beads, not eight meshes.
  //
  //  They all share one material, so they were eight identical draw calls, and the marble is drawn
  //  twice per frame (once into the transmission buffer, once for real) - sixteen calls for a
  //  cluster of dots. Merging them is the whole trick: same picture, one call. The beads are the
  //  one part of the lantern that *must* stay geometry (they are what the lamp is), so this is
  //  where the saving is.
  const beadParts = [];
  for (let i = 0; i < 8; i++) {
    const a = i * 2.399963;
    const y = 1 - (i / 7) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y)) * 0.42;
    const part = beadGeo.clone();
    part.applyMatrix4(new THREE.Matrix4().makeTranslation(Math.cos(a) * r, y * 0.42, Math.sin(a) * r));
    beadParts.push(part);
  }
  const beads = new THREE.Mesh(track(group, mergeGeometries(beadParts)), glow);
  for (const part of beadParts) part.dispose();
  core.add(beads);
  const filament = new THREE.Mesh(
    track(group, new THREE.TorusGeometry(0.3, 0.028, 10, 40)),
    track(
      group,
      new THREE.MeshStandardMaterial({ color: 0xffd79a, emissive: 0xff8c22, emissiveIntensity: 1.5, roughness: 0.4, metalness: 0 }),
    ),
  );
  filament.rotation.x = Math.PI / 2.4;
  core.add(filament);

  // The halo: one additive billboard per bead (a child of the bead, so it goes where the bead
  // goes) plus one big one at the centre for the ball's overall glow. Without a bloom pass this
  // is what makes a still frame read as "lit" instead of "painted bright".
  const haloTex = track(group, glowTexture());
  const halo = (color, opacity, at, size) => {
    const material = track(
      group,
      new THREE.SpriteMaterial({
        map: haloTex,
        color,
        opacity,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(at);
    sprite.scale.setScalar(size);
    core.add(sprite);
    return sprite;
  };
  //  Two halos, not nine.
  //
  //  Each bead had its own additive quad plus one big one, and additive sprites are pure fill:
  //  they are the most expensive thing here per draw call, and the biggest of them covers a real
  //  area of the board. The cluster is 0.42 of a marble wide, so one tight glow over the cluster
  //  and one broad one for the ball's overall bloom reads the same and costs a ninth of the fill.
  //  (The beads themselves are emissive at 3.4, so the *shape* the eye reads as lamps is geometry
  //  that was never going away; the halos only soften it.)
  //  Both halos are sized to stay *inside* the marble: the texture's falloff reaches zero at its
  //  edge, so a 1.9 quad is spent at the sphere's silhouette and none of the glow escapes the ball.
  //  A halo wider than the marble would be light outside a surface that is supposed to be smooth.
  const glows = [halo(0xffa63a, 0.5, new THREE.Vector3(0, 0, 0), 0.95)];
  glows.push(halo(0xffbe66, 0.32, new THREE.Vector3(0, 0, 0), 1.9));

  // A real light, and a strong one: an embedded lamp should lay a coloured pool on the timber,
  // and the only place that is finally convincing is out on the board. `distance` is world units
  // and is *not* affected by the marble's scale, so this pool is the same size whatever the
  // marble-size slider says.
  // The lamp's strength is set by measurement, not by taste. A point light falls off as 1/d², and the
  // light sits at the marble's centre, so how far it is from the board depends on the marble's radius
  // - which the size slider moves. At the shipped radius it is 0.27 above the board, so this reads as
  // a bright pool; the lab's hero marble floats 1.9 up, where the same light is ~49x weaker and looks
  // like nothing. Measured 2026-09-20 with the same marble on and off: intensity 3 shifted the board
  // by only +6.5 R, which is not a lamp. This is that number scaled to be one.
  const light = new THREE.PointLight(0xffc978, 14, 4.0, 2);
  group.add(light);

  //  Bands that *block* the light, and that stay inside the ball.
  //
  //  Nick, 2026-09-20: "visible surface bands on the lantern that block the emitting light to give
  //  interest and info about which way the marble is rotating", and then, on an earlier attempt:
  //  "nothing can be outside the smooth sphere of the marble's exterior". A bare glowing ball reads
  //  the same whichever way it is turned, so a rolling lantern looks stationary; opaque bands cutting
  //  the glow as they sweep past are what say how it is spinning.
  //
  //  So the bands are *subsurface*: a shell at 0.995, just under the glass at 1.0. The marble's
  //  silhouette is still one smooth sphere of glass - the bands are a layer inside it, near enough to
  //  the surface to look like banding rather than a floating ring, and opaque so they genuinely
  //  occlude the beads behind them. `alphaTest` rather than blending, so they stay in the opaque pass
  //  and cannot sort wrongly against the glass in front of them.
  const bands = bandTexture();
  //  Write the shipped mask now. A DataTexture starts as zeroes, and a mask of zeroes discards every
  //  fragment: the bands are *invisible* until the first dial move, which is the kind of failure that
  //  looks like "the feature does nothing" rather than like a bug.
  bands.redraw(SHIPPED_BANDS.count, SHIPPED_BANDS.width, 0xffffff, [0xffffff], true);
  const bandTex = track(group, bands.tex);
  //  The bands must read dark *through the glass*, and the glass is transmissive: its transmitted
  //  light is the opaque scene the glass samples, so whatever the band shell looks like in that
  //  buffer is what the eye sees in the band rows. A glossy, metallic, env-reflecting band shell is
  //  not dark there - it mirrors the room, which reads as one more reflection on the glass and makes
  //  the bands vanish exactly as Nick described (2026-09-20: "it does not work at any band or light
  //  setting"). Matte, non-metallic, with the environment reflection off, the shell's own diffuse
  //  is all that is left and it is near-black, so the band rows genuinely cut the glow. The polish
  //  the bands still show is the *glass's* own Fresnel highlight, drawn over them at radius 1.0.
  const bandMat = track(
    group,
    new THREE.MeshStandardMaterial({
      color: 0x0b0c10,
      alphaMap: bandTex,
      alphaTest: 0.5,
      roughness: 1,
      metalness: 0,
      envMapIntensity: 0,
    }),
  );
  const bandShell = new THREE.Mesh(track(group, new THREE.SphereGeometry(0.995, 48, 32)), bandMat);
  bandShell.name = 'marble-bands';
  const shell = new THREE.Mesh(shellGeometry(), clearGlass({ roughness: 0.025 }));
  return {
    core,
    shell,
    light,
    beads,
    glow,
    glows,
    bandShell,
    lamp: { light, beadMaterial: glow, halos: glows },
    //  One applier, so the scene never has to know whether a design's bands are stripes on a texture
    //  or rings of geometry: it hands over the dials and the design does the work.
    bands: {
      material: bandMat,
      base: bandMat.color.clone(),
      apply(dials) {
        //  The lantern's bands are a *cut in the glass*, and the glass is what surrounds them, so
        //  the pivot the contrast swings from is that clear glass - not the band colour itself.
        //  (Passing the band colour as its own pivot made this dial a no-op: `p + (l - p) * c === l`
        //  for every c, so the slider moved and nothing changed.) Contrast 1 is the shipped look,
        //  and 2 drives the bands to black.
        const contrast = dials.contrast ?? 1;
        bandMat.color.copy(this.base);
        applyContrast(bandMat.color, _bandWhite, contrast);
        //  At 0 the swing lands on white; a matte white shell is not clear glass, so the bands are
        //  made to vanish by emptying the mask instead (see `clear`).
        if (contrast <= 0.02) {
          bands.clear();
          return;
        }
        bands.redraw(
          Math.max(1, Math.round(dials.count ?? SHIPPED_BANDS.count)),
          Math.min(0.9, Math.max(0.02, dials.width ?? SHIPPED_BANDS.width)),
          0xffffff,
          [0xffffff],
          true, // an alpha mask: white rows are the bands, clear rows are the gaps
        );
      },
    },
  };
}

function buildSolid(group) {
  //  An opaque marble you can colour, and the deliberate opposite of the lantern.
  //
  //  It is the cheapest design in the set: no transmission anywhere, so three skips the transmission
  //  pass entirely and it costs what the painted cat's-eye costs. It is also the only marble whose
  //  silhouette is *darkness* - the bands are polished rather than glowing, so the light comes off
  //  the environment and off its own clearcoat instead of out of the material.
  //  The bands are *paint on the sphere*, not objects around it.
  //
  //  The first version built them as raised rings at 1.004, which pokes out of a marble whose whole
  //  promise is a smooth exterior - Nick, 2026-09-20: "nothing can be outside the smooth sphere of
  //  the marble's exterior". Bands drawn into the sphere's own map sit exactly on the surface: the
  //  marble is one uninterrupted sphere, its silhouette is perfect, and there is no geometry to
  //  catch on anything or to z-fight the body it is drawn on.
  //
  //  It is also cheaper: five rings of geometry become one texture.
  const map = bandTexture();
  const bodyMat = track(
    group,
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff, // the map carries the colour; this only tints it
      map: track(group, map.tex),
      roughness: 0.24,
      metalness: 0.42,
      clearcoat: 1,
      clearcoatRoughness: 0.09,
      envMapIntensity: 1.15,
    }),
  );
  const shell = new THREE.Mesh(track(group, new THREE.SphereGeometry(1, 48, 32)), bodyMat);

  //  One state, three dials, one derivation.
  //
  //  Colour, contrast and the band geometry all decide what the map holds, so letting each applier
  //  write the texture means the last one to move snaps the others' work away. Everything is derived
  //  from the state instead: each band is the body's own lightness displaced by its `lift`, scaled by
  //  the contrast, and the two band colours alternate around the axis. At the shipped colour and
  //  contrast this reproduces the shipped bands exactly, because the lifts are *measured* from the
  //  shipped colours rather than written down here.
  //
  //  The lightness arithmetic is in sRGB rather than the working (linear) space, because these are
  //  the numbers a person reads off a colour picker, and the perceived step is the one that matters.
  //
  //  A first version lifted the light bands from a 0x15171d body to 0x3a3f4b: a 5x difference in
  //  linear terms, about 0.05 in perceived lightness, and on a glossy dark ball under a bright key
  //  light the bands could not be seen at all. The shipped bands are now a real step, so "0.42 of
  //  the surface is banded" is visible rather than theoretical.
  const LIGHT_BAND = 0x6d7484;
  const DARK_BAND = 0x0b0c10; // near-black, so the second colour reads as a seam between bands
  const srgb = THREE.SRGBColorSpace;
  const hsl = { h: 0, s: 0, l: 0 };
  const shippedBody = new THREE.Color(0x15171d);
  const bodyL = shippedBody.getHSL(hsl, srgb).l;
  const liftOf = (hex) => new THREE.Color(hex).getHSL(hsl, srgb).l - bodyL;
  const state = { color: 0x15171d, contrast: 1, count: SHIPPED_BANDS.count, width: SHIPPED_BANDS.width };
  const bodyHsl = { h: 0, s: 0, l: 0 };
  const paint = () => {
    const body = new THREE.Color(state.color);
    body.getHSL(bodyHsl, srgb);
    const band = (hex) => {
      const c = new THREE.Color(state.color);
      const l = THREE.MathUtils.clamp(bodyHsl.l + liftOf(hex) * state.contrast, 0.01, 0.98);
      c.setHSL(bodyHsl.h, bodyHsl.s, l, srgb);
      return c.getHex();
    };
    map.redraw(
      Math.max(1, Math.round(state.count)),
      Math.min(0.9, Math.max(0.02, state.width)),
      state.color,
      [band(LIGHT_BAND), band(DARK_BAND)],
      false,
    );
  };
  paint();
  return {
    core: null, // nothing inside an opaque marble
    shell,
    tint: { apply({ color }) { state.color = color; paint(); } },
    bands: {
      apply(dials) {
        state.contrast = dials.contrast;
        if (dials.count != null) state.count = dials.count;
        if (dials.width != null) state.width = dials.width;
        paint();
      },
    },
  };
}

function buildGem(group) {
  // A cut-crystal ball: flat facets outside, a bright star inside, and a real surface pattern
  // — the raised meridian ribs are geometry, so they catch a specular line as it rolls.
  const core = new THREE.Group();
  const star = new THREE.Mesh(
    track(group, new THREE.OctahedronGeometry(0.34, 0)),
    track(
      group,
      new THREE.MeshStandardMaterial({
        color: 0xb14bff,
        emissive: 0x5a1a9e,
        emissiveIntensity: 1.0,
        flatShading: true,
        roughness: 0.25,
        metalness: 0.3,
      }),
    ),
  );
  core.add(star);
  const ribMat = track(
    group,
    new THREE.MeshPhysicalMaterial({
      color: 0x9fd8ff,
      emissive: 0x1c4a6e,
      emissiveIntensity: 0.45,
      roughness: 0.08,
      metalness: 0.1,
      clearcoat: 1,
      envMapIntensity: 2.2,
    }),
  );
  const ribGeo = track(group, new THREE.TorusGeometry(1.005, 0.028, 8, 64));
  for (let i = 0; i < 3; i++) {
    const rib = new THREE.Mesh(ribGeo, ribMat);
    rib.rotation.y = (i * Math.PI) / 3;
    core.add(rib);
  }
  const bands = new THREE.Mesh(
    track(group, new THREE.TorusGeometry(1.01, 0.045, 8, 64)),
    track(group, new THREE.MeshStandardMaterial({ color: 0xf7931a, emissive: 0x7a3600, emissiveIntensity: 0.55, roughness: 0.25, metalness: 0.6, envMapIntensity: 1.4 })),
  );
  bands.rotation.x = Math.PI / 2;
  core.add(bands);

  // The shell is a low-poly icosahedron: flat shading turns each face into a facet, which is what
  // reads as "cut". Each facet catches the environment at its own angle, so an additive
  // reflection shell over flat faces reads as a faceted jewel rather than as a plain ball.
  // 1.002 so it never z-fights the ribs at the poles.
  const shell = new THREE.Mesh(
    track(group, new THREE.IcosahedronGeometry(1.002, 0)),
    clearGlass({ flatShading: true, roughness: 0.02, envMapIntensity: 1.6, thickness: 1.0 }),
  );
  return { core, shell };
}

function buildBanded(group) {
  // A surface-pattern marble: concentric raised bands with a swirl core showing between them.
  const core = new THREE.Group();
  const tex = track(group, marbleTexture());
  const heart = new THREE.Mesh(
    track(group, new THREE.SphereGeometry(0.72, 48, 32)),
    track(
      group,
      new THREE.MeshPhysicalMaterial({
        map: tex,
        emissiveMap: tex,
        emissive: 0xffffff,
        emissiveIntensity: 0.3,
        roughness: 0.06,
        metalness: 0.3,
        clearcoat: 1,
        envMapIntensity: 1.8,
      }),
    ),
  );
  core.add(heart);
  const bandGeo = track(group, new THREE.TorusGeometry(1.0, 0.055, 10, 72));
  const colors = [0xf7931a, 0x36c6e8, 0xf7d54a];
  [0.0, 0.62, -0.62].forEach((y, i) => {
    const r = Math.sqrt(Math.max(0.0001, 1 - y * y));
    const band = new THREE.Mesh(
      bandGeo,
      track(
        group,
        new THREE.MeshStandardMaterial({
          color: colors[i],
          emissive: colors[i],
          emissiveIntensity: 0.35,
          roughness: 0.25,
          metalness: 0.5,
          envMapIntensity: 1.4,
        }),
      ),
    );
    band.position.y = y;
    band.scale.set(r, r, r);
    band.rotation.x = Math.PI / 2;
    core.add(band);
  });
  return { core, shell: new THREE.Mesh(shellGeometry(), clearGlass()) };
}

// ---------------------------------------------------------------------------------------------
// the registry

//  Two fields record the *intent* of each design, so the tests can hold a marble to its own promise
//  instead of a rule that has to be relaxed every time a design is added:
//
//    glass      it is clear, and must really transmit (a `transmission` and a real `ior`)
//    interior   there is something inside it to see; false means the design is one solid sphere, so
//               a core would be a hidden mesh built for nothing
//
//  The painted cat's-eye and the opaque solid marble are `false` for both: neither is glass and
//  neither has anything inside. Everything else is clear glass over a core.
export const MARBLE_DESIGNS = [
  { id: 'catseye', name: "Cat's-eye", blurb: 'the shipped swirl: painted ribbons, no core', build: buildCatseye, tone: '#8fb6de', glass: false, interior: false },
  { id: 'lantern', name: 'Lantern', blurb: 'embedded lights: glowing beads plus a real lamp', build: buildLantern, tone: '#ffcf7a', glass: true },
  { id: 'solid', name: 'Solid', blurb: 'opaque banded stone in any colour you like, blocking the light', build: buildSolid, tone: '#6f7686', glass: false, interior: false },
  //  The painted planets: one map on one sphere, no glass and no core, so they cost what the
  //  cat's-eye costs. They ship for the same reason it does - the look is paint, not a lens.
  { id: 'earth', name: 'Earth', blurb: 'oceans, continents and ice caps painted on one sphere', build: buildEarth, tone: '#2f7bd0', glass: false, interior: false },
  { id: 'moon', name: 'Moon', blurb: 'grey maria and a whole crater field, drawn as relief', build: buildMoon, tone: '#c9c6bf', glass: false, interior: false },
  { id: 'eightball', name: 'Eight ball', blurb: "polished black with the 8 in its white circle", build: buildEightBall, tone: '#e8e6df', glass: false, interior: false },
  //  Shelved, not deleted.
  //
  //  Nick, 2026-09-20: "I like the lantern the best... optimize it and temporarily disable the
  //  complex ones." Each of these is a clear-glass marble - a transmission pass every frame while
  //  it is on the board - and each carries a dozen or so pieces of geometry, so they are the ones
  //  that cost. They still build; `?marble=<id>` still shows them; they are simply not offered in
  //  the Look dial until they are cheap enough to be worth their frames.
  { id: 'bitcoin', name: 'Bitcoin', blurb: 'an extruded orange ₿ standing inside clear glass', build: buildBitcoin, tone: '#f7931a', glass: true, shelved: true },
  { id: 'geode', name: 'Geode', blurb: 'faceted rock inside, crystal druse on the shell', build: buildGeode, tone: '#5fc4e6', glass: true, shelved: true },
  { id: 'helix', name: 'Helix', blurb: 'two glass ribbons wound pole to pole', build: buildHelix, tone: '#ff8f4a', glass: true, shelved: true },
  { id: 'gem', name: 'Gem', blurb: 'cut facets and raised ribs over a violet star', build: buildGem, tone: '#b14bff', glass: true, shelved: true },
  { id: 'banded', name: 'Banded', blurb: 'raised coloured bands around a swirl core', build: buildBanded, tone: '#f7d54a', glass: true, shelved: true },
];

/** The designs the Look dial offers: everything not shelved, in registry order. */
export const shippedDesigns = () => MARBLE_DESIGNS.filter((d) => !d.shelved);
export const SHIPPED_MARBLE_IDS = shippedDesigns().map((d) => d.id);

export const DEFAULT_MARBLE = 'catseye';

/**
 * The shipped band pattern, and the reason it is not finer.
 *
 * A marble is about 40 px across in play (radius 0.27 on a 16-unit board), and a band's height on
 * screen is its share of the sphere's latitude compressed by the view. Five bands at 0.42 of a pitch
 * is roughly 3 px each at that size - technically banded, and invisible. Four wider bands are about
 * 5 px, which is a stripe the eye can follow as it turns, and that is the whole purpose: the bands
 * are how you read the marble's rotation. The dials go further in both directions.
 */
export const SHIPPED_BANDS = { count: 4, width: 0.45 };

/**
 * The hue of the lantern's shipped lamp colour (0xffc978), in degrees. The dial is defined against
 * this rather than against a fresh colour, so the shipped look is exactly what you get at the
 * default: `applyLampDials` rotates each colour by the *difference*, and at 36 degrees that is zero.
 */
export const LAMP_HUE_DEGREES = 36;

/**
 * Apply the lamp dials to a marble: brightness scales the whole lamp, hue rotates its colour.
 *
 * Everything the lamp is made of moves together - the point light, the beads' body colour and
 * their emissive, and both halo tints - because a "brightness" that moved only the light would
 * leave the beads looking painted while the floor got brighter, and a "hue" that moved only the
 * light would put a green pool under an amber marble. Brightness multiplies the light's intensity
 * (and the emissive/halo strength, so the marble itself reads brighter) and hue rotates every
 * colour by the same offset from the shipped hue.
 *
 * Returns whether the marble has a lamp at all, so a caller can tell "dial did nothing" from "this
 * marble has no lamp to dial" - the painted and dark marbles do not.
 */
export function applyLampDials(group, { brightness = 1, hueDegrees = LAMP_HUE_DEGREES } = {}) {
  const lamp = group?.userData?.lamp;
  //  (`lamp.colours` - not `tint`, which is the *design-level* colour applier below.)
  if (!lamp) return false;
  group.userData.lampGain = Math.max(0, brightness);
  const shift = (hueDegrees - LAMP_HUE_DEGREES) / 360;
  for (const { target, property, base } of lamp.colours) {
    target[property].copy(base);
    if (shift !== 0) target[property].offsetHSL(shift, 0, 0);
  }
  return true;
}

/**
 * Apply the band dial to a marble: contrast, as a lightness swing away from the shipped bands.
 *
 * Contrast rather than thickness, because the bands are geometry: making them thicker means
 * rebuilding a torus and re-uploading it, while contrast is two colours and can move under a
 * slider. 1 is the shipped look, 0 flattens them into the body, 2 drives them apart.
 */
const _bandHsl = { h: 0, s: 0, l: 0 };
/**
 * The pivot the lantern's band contrast swings from: the clear glass itself.
 *
 * Its bands are a cut in the glass, so "less contrast" has to mean "closer to the glass", and the
 * glass is white/transparent - not the band's own near-black, which as a pivot makes the swing a
 * no-op.
 */
const _bandWhite = new THREE.Color(0xffffff);

/**
 * Swing a colour's lightness away from a pivot, in place. `contrast` 1 is the identity.
 *
 * The range is clamped to the whole of [0, 1] and no narrower. These are *linear* lightness values -
 * a dark marble's body sits near 0.007 and its bands near 0.06 - so a floor of 0.01, which reads as
 * "don't let it go black", actually sits *above* the colour it was protecting and silently lifted it.
 * That made contrast 1 not the identity, which is the one thing this function must never do.
 */
export function applyContrast(target, pivotColour, contrast = 1) {
  pivotColour.getHSL(_bandHsl);
  const pivot = _bandHsl.l;
  target.getHSL(_bandHsl);
  target.setHSL(_bandHsl.h, _bandHsl.s, THREE.MathUtils.clamp(pivot + (_bandHsl.l - pivot) * contrast, 0, 1));
  return target;
}

/**
 * Move a simple design's band materials away from its body colour.
 *
 * Used by the geometry-banded marbles, where each band is its own material and the pivot is the mean
 * lightness of the design's own bands. A fixed mid grey does not work: a dark marble's bands all sit
 * far below it, so raising the contrast pushed every band the same way (down) and the pattern washed
 * out instead of sharpening.
 */
function bandSetContrast(bands, contrast) {
  const lights = bands.map(({ base }) => {
    base.getHSL(_bandHsl);
    return _bandHsl.l;
  });
  const pivot = lights.reduce((sum, l) => sum + l, 0) / lights.length;
  bands.forEach(({ material, base }, i) => {
    base.getHSL(_bandHsl);
    material.color.setHSL(_bandHsl.h, _bandHsl.s, THREE.MathUtils.clamp(pivot + (lights[i] - pivot) * contrast, 0, 1));
  });
};

/**
 * Apply the colour dial to a marble, for designs that offer one (the opaque solid marble).
 *
 * Returns whether the design takes a colour, so a caller can tell "this marble has no colour dial"
 * from "the dial did nothing".
 */
export function applyTintDials(group, { color } = {}) {
  const tint = group?.userData?.tint;
  if (!tint?.apply || color == null) return false;
  tint.apply({ color });
  return true;
}

/**
 * Apply the band dials to a marble: contrast, band count and band width.
 *
 * Delegated rather than interpreted here, because a design's bands are its own business: the solid
 * marble's are rings of geometry whose colours move, the lantern's are an alpha-masked stripe shell
 * whose *mask* moves. Both answer to the same three dials.
 */
export function applyBandDials(group, { contrast = 1, count = 5, width = 0.42 } = {}) {
  const bands = group?.userData?.bands;
  if (!bands?.apply) return false;
  bands.apply({ contrast, count, width });
  return true;
}

export const designById = (id) => MARBLE_DESIGNS.find((d) => d.id === id) ?? MARBLE_DESIGNS[0];

/**
 * Build one marble at radius 1.
 *
 * The returned group is ready to add to the board: it is centred on the origin, cast its
 * shadow from the shell, and carries `userData` for the engine:
 *   * `id`           the design built
 *   * `shell`        the glass, named `marble-ball` (the size slider and the checks find it by name)
 *   * `core`         the group drawn inside the glass
 *   * `light`        the embedded THREE.PointLight, if the design has one
 *   * `tick(t, host)` per-frame animation; `host` is the marble group, which the bitcoin mark needs
 *                    so it can hold itself level while the glass rolls (see below)
 *   * `dispose()`    release every geometry/material the marble owns
 *
 * @param {string} id  a MARBLE_DESIGNS id; unknown ids fall back to the first design
 */
export function buildMarble(id) {
  const design = designById(id);
  const group = new THREE.Group();
  group.userData.disposables = [];

  const {
    core = null,
    shell,
    light = null,
    glow = null,
    glows = [],
    symbol = null,
    lamp = null,
    bands = null,
    tint = null,
    bandShell = null,
  } = design.build(group) ?? {};
  if (core) group.add(core);
  //  A design may put a layer *inside* the glass (the lantern's light-blocking bands), and it has to
  //  be a child of the marble so it rolls with it. It is added before the shell so the glass is
  //  drawn over it; the shell's own renderOrder keeps the order right anyway.
  if (bandShell) group.add(bandShell);
  group.add(shell);
  shell.name = 'marble-ball';
  shell.castShadow = true;
  shell.receiveShadow = true;
  //  Remember what this design shipped as, so the tuning sheet's transparency and bend can scale it
  //  rather than overwrite it. Only materials that are actually glass get the record: the painted
  //  cat's-eye has no transmission, and the dials must leave it alone instead of turning it to glass.
  if (shell.material.transmission > 0) {
    shell.material.userData.glassBase = {
      transmission: shell.material.transmission,
      thickness: shell.material.thickness,
    };
  }
  // Transparent objects already draw after opaque ones, but the core is the *point* of these
  // marbles; saying so explicitly keeps the order right whatever else is on the board.
  shell.renderOrder = 1;

  group.userData.id = design.id;
  group.userData.shell = shell;
  group.userData.core = core;
  group.userData.light = light;

  //  Everything the lamp dials are allowed to move, with each colour remembered as it shipped. The
  //  list is built here rather than in the scene so that the renderer never has to know which
  //  parts of a marble *are* the lamp: it applies dials to whatever the marble declared.
  if (lamp) {
    group.userData.lamp = {
      colours: [
        [lamp.light, 'color'],
        [lamp.beadMaterial, 'color'],
        [lamp.beadMaterial, 'emissive'],
        ...lamp.halos.map((sprite) => [sprite.material, 'color']),
      ].map(([target, property]) => ({ target, property, base: target[property].clone() })),
    };
  }
  //  Designs whose look is a pattern rather than a colour expose the materials a band dial may move,
  //  and a design that can be recoloured exposes the applier the colour dial calls. Each is a
  //  *delegate*: the scene hands over dials and never needs to know how a marble is built.
  if (bands) group.userData.bands = bands;
  if (tint) group.userData.tint = tint;

  if (design.id === 'bitcoin' && symbol) {
    //  The one design that must stay LEGIBLE.
    //
    //  A real embedded object tumbles with the glass, and for a crystal or a ribbon that is
    //  exactly right. For a flat symbol it is a disaster: seen at a grazing angle the ₿ collapses
    //  into a thin bar, and from the game's near-top-down camera the symbol is the whole point.
    //
    //  So the mark stays level while the glass rolls around it, like a symbol suspended in the
    //  middle of the ball, and it sways gently so the extrusion's depth reads as three dimensions
    //  rather than as a decal. The shell still tumbles with the physics, so the highlight crawls
    //  across the glass exactly as it should.
    group.userData.tick = (t, host) => {
      if (host) core.quaternion.copy(host.quaternion).invert();
      core.rotateX(0.30);
      core.rotateY(0.5 + 0.45 * Math.sin(t * 0.7));
    };
  } else if (design.id === 'lantern') {
    const base = light ? light.intensity : 0;
    const beadBase = glow ? glow.emissiveIntensity : 0;
    const haloBase = glows.map((s) => s.material.opacity);
    group.userData.tick = (t) => {
      const pulse = 0.72 + 0.28 * Math.sin(t * 2.3);
      //  The lamp's brightness dial rides along with the pulse rather than replacing it: the pulse
      //  is what makes it read as a lamp, and at the default brightness this is the shipped look.
      const gain = group.userData.lampGain ?? 1;
      //  `lampOff` exists so a check can measure what the lamp actually adds to the board: the
      //  honest control is the same marble with its own light on and off, not another marble.
      if (light) light.intensity = (group.userData.lampOff ? 0 : base * gain) * pulse;
      if (glow) glow.emissiveIntensity = beadBase * gain * pulse;
      glows.forEach((s, i) => { s.material.opacity = Math.min(1, haloBase[i] * gain * pulse); });
    };
  } else if (design.id === 'helix' || design.id === 'gem') {
    // A slow independent turn of the core. The marble still rolls as one body — this is the
    // small extra motion that says "there is a thing in there", and it stays subtle on purpose.
    const rotSpeed = design.id === 'helix' ? 0.5 : -0.35;
    group.userData.tick = (t) => {
      if (core) core.rotation.y = t * rotSpeed;
    };
  }

  group.userData.dispose = () => {
    for (const object of group.userData.disposables) object?.dispose?.();
    group.userData.disposables.length = 0;
  };
  return group;
}
