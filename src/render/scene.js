//  The three.js presentation layer.
//
//  The physics owns board space (x, z); this module owns the look, and, importantly, the
//  tilt of the board itself: the camera and lights stay world-fixed, so the player sees
//  the whole board rock under the marble.
//
//  Tilt signs (derived from rotating gravity into the board frame, and checked visually):
//    rotation.x = +tilt.x   -> the near edge (+z) dips, and the marble rolls toward +z
//    rotation.z = -tilt.z   -> the right edge (+x) dips, and the marble rolls toward +x

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  BOARD_THICK,
  WALL_H,
  PIT_R,
  GOAL_R,
  GOAL_HOLE_R,
  BALL_R,
  BALL_R_MAX,
  BUTTON_R,
  BUTTON_TRAVEL,
  TELEPORT_R,
  LIFT_HALF_W,
  LIFT_H,
  MAX_TILT,
  LID_Y,
  LID_THICK,
  LID_BEZEL,
  LID_CLEARANCE,
  VIAL_WIDTH,
  VIAL_FLOOR,
  VIAL_CORNER,
  VIAL_CELLS,
  BAR_LEN,
  BAR_H,
  KNOB_R,
  KNOB_H,
  ROSE_LINE,
  ROSE_RING_LINE,
  ROSE_SINK,
  VIEW_SIZE,
  VIEW_ELEV,
  VIEW_FOV,
  PANEL_GUTTER,
} from '../engine/constants.js';
import { WALL, PIT, ICE, SAND, STEEL, BELT, VENT, PAD, PLATE, GOAL as GOAL_CHAR, toEdgeSpace } from '../engine/levels.js';
import { METALS, metalById } from '../engine/metals.js';
import { silhouetteLoops, slabHoles, insetLoop, insideFootprint, loopArea } from '../engine/silhouette.js';
import { holeOutline, holeShape, holeRing, holeRingPair, combineHoleRings, holeClusters, offsetRing } from './hole-shape.js';
import { regionGeometry } from '../engine/materials.js';
import { roseDesign } from '../engine/rose.js';
import { vialLayout, barEntry, indicatorMode, vialFoam } from '../engine/vials.js';
import { boardProjectUVs } from './wood-uv.js';
import { boardSurfaceMaps } from './board-materials.js';
import { etchThicknessTexture, etchNormalTexture, liquidRippleTexture } from './textures.js';
import {
  buildMarble,
  designById,
  DEFAULT_MARBLE,
  MARBLE_DESIGNS,
  LAMP_HUE_DEGREES,
  applyLampDials,
  applyBandDials,
  applyTintDials,
} from './marbles.js';
import { TUNING } from '../engine/tuning.js';
import {
  woodMaps,
  tableTexture,
  WOOD_SPAN,
  steelTexture,
  beltTexture,
  ventTexture,
  sandTexture,
  iceTexture,
  sparkTexture,
  gripTexture,
  blobTexture,
  backdropTexture,
  softGlowTexture,
  liquidEdgeTexture,
  barEdgeTexture,
} from './textures.js';

// Rows across a vial's liquid ribbon: two wall edges plus three across the middle, so the meniscus
// is a curve rather than a flat band.
const VIAL_ACROSS = 5;

// The goal's lap light. The cue is a *light* on the rim, so it is drawn as a soft glow rather than a
// ring of extra metal: a rounded falloff has no edge to read as a second part, and the pivot's own
// z-rotation walks it round without any trigonometry in the frame loop.
const GOAL_LAP_R = GOAL_HOLE_R + 0.07; // the ring's own centreline radius
const GOAL_LAP_Y = 0.03; // the ring's centre height above the board face
const GOAL_LAP_H = 0.075; // how far the glow floats above that centre, clear of the ring's tube
const GOAL_LAP_W = 0.95; // tangential length of the glow: a broad patch of light, not a point
const GOAL_LAP_D = 0.44; // radial depth of the glow, spilling a little past the tube
const GOAL_LAP_RATE = 2.2; // rad/s round the rim
const GOAL_LAP_BREATH = 4.8; // rad/s of the brightness pulse
const GOAL_LAP_BASE = 0.42; // mean opacity; the pulse rides on this
const GOAL_LAP_PULSE = 0.14;

// The radius of the device's own exterior corners. The whole outer stack - the wood slab, the rim
// timber, the collar band, the lip and the screw line - is built from one outline, so one number
// rounds all of it together and the stack stays flush. Kept under the trough's corner clearance
// (VIAL_CORNER) so the corner fillet can never eat into a level channel, and above LID_BEZEL so
// the collar's own inner offset still has a corner to follow rather than folding through itself.
const CORNER_R = 0.6;
// How tightly the indicator track turns the corner: a slight bend, not a square elbow.
const TRACK_CORNER_R = 0.18;

//  Transmission buffer sizing. Exported and pure because it carries the *smoothness* promise: a
//  glass marble must not cost a frame anyone can feel, and the whole cost of transmission that is
//  not the fixed re-draw of the scene is the fill of this buffer. The invariant is that it holds
//  the marble and nothing else.
const TRANSMISSION_OVERSAMPLE = 3; // buffer pixels per marble pixel, so the refracted image stays crisp
const TRANSMISSION_STEP = 0.05; // quantisation in viewport fractions
const TRANSMISSION_MIN = 0.02; // never zero: a zero-sized buffer is not a thing

/**
 * The transmission buffer's size, as a fraction of the viewport.
 *
 * `diameterNdc` is the marble's projected diameter in normalised device coordinates, where the
 * whole viewport spans exactly 2. The fraction of the viewport the marble covers and the scale
 * the renderer wants are the same number, so no resolution, window size, field of view or camera
 * distance appears here - they all cancel. That is the point: at a flat 0.6 of the viewport the
 * buffer held ~600x the pixels a marble can ever display.
 *
 * Rounded *up* to the next step, so the buffer is never undersized, and clamped at both ends: the
 * floor keeps it an actual texture, the cap (per quality tier) stops a marble pressed against the
 * camera from asking for the frame back. Returning the same number for nearby footprints is also
 * load-bearing - `WebGLRenderTarget.setSize` reallocates its texture, so a value that wobbled
 * every frame would cost more than the pass it is managing.
 */
export function transmissionBufferScale(diameterNdc, cap = 1) {
  const want = TRANSMISSION_OVERSAMPLE * Math.max(0, diameterNdc || 0);
  const quantised = Math.ceil(want / TRANSMISSION_STEP) * TRANSMISSION_STEP;
  return Math.min(cap, Math.max(TRANSMISSION_MIN, +quantised.toFixed(3)));
}

export function createScene(canvas, level, { wood = null, marbleLook = DEFAULT_MARBLE } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.background = backdropTexture();
  const fog = new THREE.Fog(0x0a0c10, 42, 96);
  scene.fog = fog;

  const camera = new THREE.PerspectiveCamera(VIEW_FOV, 1, 0.1, 200);
  camera.position.set(0, 14, 12);
  // A near-top-down camera must not use world +Y as its up reference. The view direction is
  // almost parallel to +Y, so the roll implied by lookAt() is ill-conditioned, and because the
  // aim follows the marble the whole scene visibly *twists* as the marble rolls. Pointing up
  // along -Z gives the top-down view a stable horizon, and screen-up is still the far edge of
  // the board, exactly as it looks now.
  camera.up.set(0, 0, -1);

  // --- environment for the marble's reflections -------------------------------
  //  A small dark studio with two softboxes. This is what gives the marble its
  //  chrome read: a room-lit sphere is flattering, a contrasty studio reads as metal.
  //
  //  The panels are kept so their size can be driven at runtime: the sheen on the glass and on
  //  the wood *is* this environment, so "how big is the light" is answered by rescaling the
  //  panels and re-rendering the probe. (Re-rendering is the expensive half, so it is throttled.)
  const envScene = new THREE.Scene();
  const envPanels = [];
  {
    const room = new THREE.Mesh(
      new THREE.BoxGeometry(24, 16, 24),
      new THREE.MeshBasicMaterial({ color: 0x4a5464, side: THREE.BackSide }),
    );
    envScene.add(room);
    const panel = (w, h, color, pos, rotY = 0, rotX = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color }));
      m.position.set(...pos);
      m.rotation.set(rotX, rotY, 0);
      envScene.add(m);
      envPanels.push({ mesh: m, w: w, h, color, pos });
    };
    panel(18, 5, 0xffffff, [0, 7.6, 0], 0, Math.PI / 2); // big ceiling strip
    panel(11, 8, 0xeef6ff, [-10.5, 0.5, 2], Math.PI / 2, 0); // cool window, left
    panel(9, 6, 0xfff4e2, [10.5, 1.0, -3.5], -Math.PI / 2, 0); // soft warm bounce, right
    panel(24, 6, 0xffffff, [0, 0.2, -11], 0, 0); // bright band opposite the camera
    panel(20, 5, 0xdceaff, [0, 4.2, 11], 0, Math.PI); // big soft panel on the camera side
    panel(14, 3.5, 0xffffff, [0, -1.2, 11], 0, Math.PI); // low fill, also camera side
    // a muted wooden floor: the chrome should pick up the board without turning brown
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshBasicMaterial({ color: 0x3a2a1c }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -7.2;
    envScene.add(floor);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = pmrem.fromScene(envScene, 0.02);
  scene.environment = envRT.texture;

  /**
   * Rescale the softboxes. Only the *area* is changed, and only in the two axes that face the
   * board: scaling a panel's width covers more of the hemisphere, so the highlight it casts is
   * broader and its edges softer, which is what "a bigger light" looks like.
   */
  function setEnvSize(size) {
    for (const p of envPanels) {
      const s2 = new THREE.Vector2(p.w, p.h).multiplyScalar(size);
      p.mesh.geometry.dispose();
      p.mesh.geometry = new THREE.PlaneGeometry(s2.x, s2.y);
      p.mesh.material.color.setHex(p.color); // radiance is fixed: a bigger light, not a dimmer one
    }
    const next = pmrem.fromScene(envScene, 0.02);
    scene.environment = next.texture;
    envRT.dispose();
    envRT = next;
    envBuiltAt = performance.now();
  }

  // --- lights -----------------------------------------------------------------
  const HEMI_BASE = 0.32;
  const hemi = new THREE.HemisphereLight(0xbcd0f0, 0x241a10, HEMI_BASE);
  scene.add(hemi);

  const KEY_BASE = 2.1;
  const key = new THREE.DirectionalLight(0xfff4e2, KEY_BASE);
  key.position.set(7, 16, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  scene.add(key.target);

  const RIM_BASE = 0.75;
  const rim = new THREE.DirectionalLight(0x9fc4ff, RIM_BASE);
  rim.position.set(-8, 7, -9);
  scene.add(rim);

  const UNDER_BASE = 1.4;
  const under = new THREE.PointLight(0xffc37a, UNDER_BASE, 14, 2);
  under.position.set(0, -1.6, 0);
  scene.add(under);

  // The table the board sits over: a dark surface with a pool of light, plus a shadow
  // catcher so the tilting board casts something real onto it.
  const table = new THREE.Mesh(
    new THREE.PlaneGeometry(180, 180),
    new THREE.MeshStandardMaterial({ map: tableTexture(), roughness: 0.95, metalness: 0.05 }),
  );
  table.rotation.x = -Math.PI / 2;
  scene.add(table);

  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.ShadowMaterial({ opacity: 0.4 }));
  catcher.rotation.x = -Math.PI / 2;
  catcher.receiveShadow = true;
  scene.add(catcher);

  // --- the lighting rig, as two tunable numbers -------------------------------
  // What "size" means, and why the panels keep their brightness: a softbox's *radiance* is what
  // you see reflected in the glass, and dimming it to spread the same power over more area pushed
  // the panels below the room walls in brightness, so enlarging the light made the scene go dark
  // and flat (measured median board luminance 120/114/70 across size 0.4/1/2.4). Keeping radiance
  // fixed and taking the extra energy out of the direct lights instead leaves the broad softbox
  // reading as "a big soft light", which is the thing the control is named after. Measured spread
  // across the board: 238 at size 0.4 (a tight, harsh pool) down to 99 at 2.4 (an even wash),
  // which is the effect the slider is for.
  const SIZE_DIRECT_EXP = 0.75;

  // The lid glass's reflection strength (see assets.glass). The pane is additive and specular-only,
  // so this is the whole of its brightness.
  const GLASS_SPEC = 0.85;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  //  Diffuse brightness scales the direct lights; the reflection slider scales
  //  scene.environmentIntensity, which is what the glass sheen and the marble's mirror come from.
  //  They used to be one master precisely so the contrast the hole check measures could not drift
  //  (pits are 15-20% of the floor, and that ratio is a function of how much light reaches both) -
  //  but that made the mirrored glare impossible to dim without darkening the whole board. They are
  //  separable now: bring reflection to zero and the board keeps its key light, shadows and pits;
  //  bring diffuse to zero and the board is lit only by the reflected studio.
  //
  //  ENV_BASE is the environment at reflection = 1, chosen so the shipped look is unchanged: the
  //  old master put it at 0.62 * its 0.72 default.
  const ENV_BASE = 0.62 * 0.72; // 0.4464
  let envBuiltAt = 0;
  let appliedSize = TUNING.lightSize ?? 1;
  let envPending = false;

  function applyLighting({ immediate = false } = {}) {
    const level = TUNING.lightLevel ?? 1;
    const reflect = TUNING.lightReflect ?? 1;
    const size = TUNING.lightSize ?? 1;
    // A bigger environment panel adds illumination on its own, so the direct lights carry the
    // compensation; otherwise the size slider would double as a second brightness control.
    const direct = level * Math.pow(size, -SIZE_DIRECT_EXP);
    key.intensity = KEY_BASE * direct;
    hemi.intensity = HEMI_BASE * direct;
    rim.intensity = RIM_BASE * direct;
    under.intensity = UNDER_BASE * direct;
    scene.environmentIntensity = ENV_BASE * reflect;
    // The pane reflects the key light as well as the environment, and that half is not scaled by
    // environmentIntensity, so without this the glare slider could not keep its promise: at
    // reflection 0 the pane still mirrored the key light. Now zero really does remove every trace
    // of it, and at the shipped 1 it is unchanged.
    assets.glass.specularIntensity = GLASS_SPEC * clamp01(reflect);
    if (Math.abs(size - appliedSize) > 1e-4) {
      appliedSize = size;
      // Dragging the slider fires every frame; the probe render is the costly part, so it waits
      // for a short quiet gap and is otherwise done by render(). Nothing measures the scene while
      // a hand is on the slider, but a check that sets the value then reads luminance does need
      // the probe to be current - hence `immediate`.
      if (immediate || performance.now() - envBuiltAt > 90) setEnvSize(size);
      else envPending = true;
    }
    return { level, reflect, size };
  }

  // --- shared assets ----------------------------------------------------------
  /**
   *  The maps one wood material needs, from whichever source is in play. Every wood material here
   *  reads the same board through the same projection (see wood-uv.js), so the slab, the wood
   *  inside a hole, the walls and the ramp are visibly the same timber.
   *
   *  - **A picture** (the shipped board): one set of maps for the whole game, and the per-material
   *    difference is a tone exponent and the material's own roughness. The ramp gets the pale
   *    timber it is supposed to be by *toning the same grain up*, not by being a second texture.
   *  - **The procedural fields**: a palette per material, as before. Used when the picture is
   *    missing, and by the tools that compare the two.
   */
  const woodSurface = (opts = {}, tone = 1, rim = false) =>
    boardSurfaceMaps(TUNING.boardFinish ?? 'walnut', {
      source: wood,
      grain: TUNING.grainProminence ?? 1,
      relief: opts.relief ?? 1.5,
      flat: 0.6,
      pores: 0.8,
      tone,
      rimGrain: rim ? (TUNING.rimGrain ?? 'same') : 'same',
      stain: rim ? (TUNING.rimStain ?? 0) : 0,
    });

  //  Every wood surface, and the tone it is cut at: the board, the hole bevel, the wall body and
  //  cap, and the ramp. `applyBoardFinish` rebuilds all five from the tuning sheet's finish, so
  //  switching timber never leaves one piece of the toy made of the old one.
  //  `rim: true` marks the surfaces that are the frame around the board rather than the board
  //  itself: they follow the rim's own grain and stain from the tuning sheet.
  const WOOD_SURFACES = {
    wood: { tone: 1, relief: 1.5 },
    woodEdge: { tone: 1, relief: 1.5 },
    wall: { tone: 0.92, relief: 1.4, rim: true },
    wallTop: { tone: 1.02, relief: 1.4, rim: true },
    ramp: { tone: 1.55, relief: 1.3 },
  };
  const surfaceTextures = new Map();

  /**
   *  Put one surface's maps on its material, keeping the texture material itself untouched.
   *
   *  Textures stay cached per (source, parameters) in the two map modules, so a switch back to a
   *  finish already drawn costs nothing; a texture that is genuinely replaced here - the procedural
   *  fallback, which has no cache - is disposed, and a cached one is never disposed while in use.
   */
  const setSurface = (name, mat, maps) => {
    const before = surfaceTextures.get(name) ?? [];
    const now = [maps.map, maps.normalMap, maps.roughnessMap];
    for (const tex of before) if (!now.includes(tex)) tex.dispose();
    surfaceTextures.set(name, now);
    mat.map = maps.map;
    mat.normalMap = maps.normalMap;
    mat.roughnessMap = maps.roughnessMap;
    mat.needsUpdate = true;
  };

  const assets = {
    wood: new THREE.MeshStandardMaterial({ ...woodSurface({ relief: 1.5 }), roughness: 0.72, metalness: 0.04 }),
    //  The routed edge of a hole is a shallow upward funnel, so its surface faces *down* by the
    //  cylinder's own outward normal while the player looks into it from above. Drawn single-sided
    //  it is culled away entirely and the hole stays black; double-sided shows the wood.
    //  The routed edge of a hole is the *same* timber, cut and exposed, and it now says so: the
    //  grain runs off the floor and down the funnel (see wood-uv.js), so the bevel takes the
    //  board's own tone instead of a paler palette of its own. It used to be deliberately lighter,
    //  which read as an inlaid ring around every hole rather than as the board's thickness. The
    //  leaning cone does the work on its own by facing up into the key light, where the slab's
    //  vertical cut faces away from it, and the tone is free: measured with the lid hidden, the
    //  pits read 10.3/8.6/9.8/7.7/7.4 against a floor of 87 at this tone and at 1.06 of it alike -
    //  the pit's centre pixel is the shaft, so only the capture-zone ring moves, by ~2 units.
    //  Kept a hair glossier than the floor, which is what a freshly cut surface is.
    woodEdge: new THREE.MeshStandardMaterial({
      ...woodSurface({ base: '#96602f', dark: '#3f2410', light: '#c98f52', relief: 1.5 }, 1),
      roughness: 0.62,
      metalness: 0.04,
      side: THREE.DoubleSide,
    }),
    wall: new THREE.MeshStandardMaterial({
      ...woodSurface({ base: '#8d5c31', dark: '#57351a', light: '#b98a55', relief: 1.4 }, 0.92),
      roughness: 0.55,
      metalness: 0.05,
    }),
    wallTop: new THREE.MeshStandardMaterial({
      ...woodSurface({ base: '#a8703f', dark: '#784a23', light: '#c9955a', relief: 1.4 }, 1.02),
      roughness: 0.5,
      metalness: 0.05,
    }),
    ice: new THREE.MeshPhysicalMaterial({ map: iceTexture(), roughness: 0.1, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.06 }),
    sand: new THREE.MeshStandardMaterial({ map: sandTexture(), roughness: 1, metalness: 0 }),
    steel: new THREE.MeshStandardMaterial({ map: steelTexture(), roughness: 0.32, metalness: 0.9 }),
    //  The channel floor the instant indicators run along. It used to be `iron`, which is a flat
    //  grey and read as dirty next to the collar's gunmetal; a scale like this wants to look like
    //  polished silver, so it is the brushed-steel map at a tighter roughness and full metalness -
    //  the brightest metal on the toy, which is what makes the red slug read as sitting on it.
    liner: new THREE.MeshStandardMaterial({
      map: steelTexture(),
      roughness: 0.2,
      metalness: 1,
      envMapIntensity: 1.35,
    }),
    belt: new THREE.MeshStandardMaterial({ map: beltTexture(), roughness: 0.85, metalness: 0.1 }),
    //  A ramp is a separate piece of timber glued to the board, so it is a paler, cleaner wood
    //  than the board and its raised walls: from a near-top-down camera that tone difference plus
    //  the shaded slope is what says "the marble climbs here" without a label.
    ramp: new THREE.MeshStandardMaterial({
      ...woodSurface({ base: '#d8b184', dark: '#b08a5c', light: '#f0d8b4', relief: 1.3 }, 1.55),
      roughness: 0.62,
      metalness: 0.05,
    }),
    vent: new THREE.MeshStandardMaterial({ map: ventTexture(), roughness: 0.6, metalness: 0.5 }),
    pad: new THREE.MeshStandardMaterial({ color: 0x2ad4ff, emissive: 0x0d6f96, emissiveIntensity: 1.1, roughness: 0.35, metalness: 0.2 }),
    plate: new THREE.MeshStandardMaterial({ color: 0xe8c14c, emissive: 0x6a4a08, emissiveIntensity: 0.5, roughness: 0.32, metalness: 0.85 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xd9ac52, roughness: 0.22, metalness: 1, envMapIntensity: 1.3 }),
    marbleGlass: new THREE.MeshStandardMaterial({ color: 0xf2f6ff, roughness: 0.05, metalness: 1 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x8f96a3, roughness: 0.3, metalness: 1 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.95, metalness: 0 }),
    shaft: new THREE.MeshStandardMaterial({ color: 0x14100c, roughness: 1, metalness: 0.1, side: THREE.DoubleSide }),
    hazard: new THREE.MeshStandardMaterial({ color: 0xd8483a, emissive: 0x4a0f08, emissiveIntensity: 0.7, roughness: 0.45, metalness: 0.4 }),
    glow: new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
    spark: new THREE.PointsMaterial({
      map: sparkTexture(),
      size: 0.19,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      sizeAttenuation: true,
    }),
    // The lid's glass.
    //
    // This is an *additive, specular-only* pane, which is not the obvious way to draw glass and
    // is the result of measuring it three ways:
    //   * real transmission glass was removed: it blends the scene back through a mip chain and
    //     a refraction offset, which rendered the mid-lane pits *brighter than the floor* (ratio
    //     1.09). An invisible hole. Never again.
    //   * an alpha-blended haze was safe but nearly invisible: alpha scales the reflection too,
    //     so raising envMapIntensity at opacity 0.055 changed the veil by nothing (measured: +14
    //     before and after). It also cannot get more present without either hazing the board or,
    //     with a dark tint, *darkening* it by (1 - opacity).
    //   * additive blending adds the reflection and leaves the board untouched: colour black
    //     contributes nothing, so what lands on the screen is the environment's sheen over the
    //     wood, uniformly, at whatever strength is asked for - tunable without touching the
    //     contrast the hole check measures.
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x000000, // additive: the diffuse term must contribute nothing
      // Frosted, not mirror-sharp. The pane is flat, so with a sharp lobe the whole sheet sits
      // near the key light's mirror direction at once as the board tilts, and a large circle of
      // board is added on top of itself until it clips to flat white. Measured across eight board
      // tilts, area of the frame at near-white / brightest 1% / frame mean: 0.075 roughness gave
      // 3.05% / 255 / 66.8 (clipped), 0.4 gave 14.5% / 255 / 99.3 (worse - a wider lobe brightens
      // more board), 0.6 gave 0.22% / 228 / 79.8, and 0.8 gives 0.09% / 221 / 65.7. So the blowout
      // is not about strength (halving specularIntensity still clipped) but about spreading the
      // reflection of the studio over the sheet, which is also what a pane of glass looks like
      // from a distance. The frame stays exactly as bright as before; only the mirror goes.
      roughness: 0.8,
      metalness: 0,
      specularIntensity: GLASS_SPEC,
      envMapIntensity: 1.7,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    // The etched compass rose: a marking *in* the glass rather than paint on it.
    //
    // A first version was an opaque near-white inlay, which rendered as a bright white line -
    // the look of painted or filled lettering, not of etched glass, and it competed with the
    // board for attention. Real engraving in a pane reads as a fine grey groove: mostly the
    // surface underneath showing through, with the boundary catching light. So this is
    // translucent grey (the wood stays visible through the line), frosted rather than glossy,
    // and thin - ROSE_LINE came down from 0.05 to 0.032.
    //
    // The iridescence is the "diffracting a little": a thin-film term whose hue shifts with the
    // viewing and incident angle, so parts of a ring pick up a faint spectral tint and other
    // parts stay neutral. It is the cheap analogue of the real thing - an etched groove scatters
    // and diffracts light - without a shader of our own or a second render pass.
    etch: new THREE.MeshPhysicalMaterial({
      // Dark and *specular*, not a grey pigment. A pigment has one value under every light, which
      // is exactly why the previous version read as paint: the mark looked the same from all
      // angles. A groove takes its value from what it reflects, so with a dark base and a low
      // roughness the line goes bright where it catches a studio panel and dark where it does not.
      color: 0x3a4043,
      roughness: 0.24,
      normalMap: etchNormalTexture(),
      normalScale: new THREE.Vector2(1.15, 1.15),
      specularIntensity: 1.0,
      metalness: 0.0,
      transparent: true,
      opacity: 0.86,
      depthWrite: false, // leaves the glass sheen behind it instead of cutting a hole in it
      clearcoat: 0.3, // a little, so the groove's edge catches the key light
      clearcoatRoughness: 0.35,
      envMapIntensity: 1.3,
      // The diffraction. Strong, because a *subtle* iridescence is invisible once it is spread
      // over a thin line: at 0.5 with a map-free uniform thickness the marking measured as
      // perfectly neutral grey (channel spread 15 out of 255) and a rendered check read it as
      // "no iridescent tint at all". The thickness map is what makes it read as diffraction
      // rather than as a tinted line.
      iridescence: 1.0,
      iridescenceIOR: 1.42,
      // A *narrow* band, not a wide one: a broad thickness range mixes many interference colours
      // and averages out to grey, which is why the first attempt measured as neutral. Narrow
      // keeps the marking in one colour regime, and the thickness map moves it around *within*
      // that regime - which is the difference between "diffracting" and "tinted".
      iridescenceThicknessRange: [180, 330],
      iridescenceThicknessMap: etchThicknessTexture(),
    }),
    // The liquid in the level vials. A yellow-green like a real spirit level, because it has to
    // read against warm wood, grey metal and a dark channel floor - and because a level should
    // look like a level. Glossy and shallow: almost all of what you see is the surface.
    liquid: new THREE.MeshPhysicalMaterial({
      color: 0x8ed23c,
      roughness: 0.05,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      envMapIntensity: 1.6,
      // The ripples. Without them a flat green surface lit from one direction measures as one
      // colour and reads as paint - the same trap the etched rose fell into.
      normalMap: liquidRippleTexture(),
      normalScale: new THREE.Vector2(0.5, 0.5),
      // The ribbon is only five rows wide, so its long edges were a hard cut against the channel
      // wall. The alpha ramp fades them out instead, so the wetted surface looks like it reaches
      // the wall rather than being clipped by it.
      alphaMap: liquidEdgeTexture(),
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    }),
    // The liquid's own depth, seen through the side of the channel: darker and unlit-looking, so
    // the surface keeps the highlight and the body reads as below it.
    liquidBody: new THREE.MeshStandardMaterial({
      color: 0x51791c,
      roughness: 0.32,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
    // The instant indicator: a hot red slug. It is mostly its own light rather than a reflection -
    // low metalness, mid roughness - so the glow reads evenly from any camera angle instead of
    // flaring at one or two of them the way a polished metal would. The body is a deep red so that
    // what the key light adds is still red, rather than washing the slug back to white; almost all
    // of what you see is the emissive term either way.
    bar: new THREE.MeshStandardMaterial({
      color: 0x5c0800,
      roughness: 0.85,
      metalness: 0,
      envMapIntensity: 0.12,  // a white studio highlight would wash the red out; keep the sheen off it
      // A steady glow, with a clear lift as the bar travels: position carries the reading, and the
      // change in brightness backs it up. No bloom pass in this renderer, so the softness comes from
      // the material - even emission, low specular, no hard highlight. The level is set to a measured
      // contrast against the bare channel floor (see the smoke check), because the whole point of the
      // indicator is that it can be seen. A red light is *dimmer per channel* than a white one, so
      // that check reads colour as well as brightness - see sampleLuminance and the bars probe.
      // The slug itself is a machined box, so the *feathered* edge comes from a soft halo laid
      // around it (see buildVials).
      emissive: new THREE.Color(0xff0000),
      emissiveIntensity: 1.2,
      // The slug's own cut edges are feathered away per face, so there is no bright boundary to read
      // as a painted block. Transparent for the alphaMap, and depthWrite off because a half-faded
      // surface writing depth would cut a hard silhouette back into the very edge this removes.
      alphaMap: barEdgeTexture(),
      transparent: true,
      depthWrite: false,
    }),
    grip: new THREE.MeshStandardMaterial({ map: gripTexture(), roughness: 0.88, metalness: 0.02 }),
    // Gunmetal, not brass: sitting on warm wood, a cold frame is the thing that reads as
    // "this is a frame". The brass is saved for the grip, where it draws the eye.
    collar: new THREE.MeshStandardMaterial({
      map: steelTexture(),
      color: 0x6a7480,
      roughness: 0.32,
      metalness: 0.96,
      envMapIntensity: 1.1,
    }),
    //  The marble's contact shadow and the warm pool of light that sits in it. Both are FLAT
    //  quads lying in the board's own plane - deliberately not camera-facing sprites. A sprite's
    //  quad is always perpendicular to the view, and this camera is only ~10 degrees off vertical,
    //  so a sprite shadow is tilted ~10 degrees to the board and the board plane slices through
    //  it. Everything below the slice is hidden, which drew a hard straight edge across the
    //  contact shadow right where the marble sits (reading as a shadow line bisecting the ball)
    //  with the soft gradient left as a fringe on one side only. A quad bedded in the board has
    //  nothing to slice: it is round from every view, the way a real contact shadow is.
    blob: new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.85 }),
    pool: new THREE.MeshBasicMaterial({
      map: blobTexture(),
      color: 0xffd9a0,
      transparent: true,
      depthWrite: false,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
    }),
  };

  // The grip's ribs should land every few millimetres on the ring rather than once per
  // texture tile, so tile the band around its circumference.
  assets.grip.map.repeat.set(7, 1);

  //  One material per metal, built from the shared METALS table so the editor's swatches and the
  //  board's buttons and lift walls can never name two different colours for "brass". `metalMat`
  //  resolves through metalById, so a level that names an unknown metal still renders as brass.
  const metalAssets = Object.fromEntries(
    METALS.map((m) => [
      m.id,
      new THREE.MeshStandardMaterial({
        color: m.color,
        roughness: m.roughness,
        metalness: m.metalness,
        envMapIntensity: m.envMapIntensity ?? 1.25,
      }),
    ]),
  );
  //  The same metal with a brighter top face, so a button cap or a raised wall reads with a lit
  //  top edge instead of as one flat metal tone from a near-overhead camera.
  const metalTopAssets = Object.fromEntries(
    METALS.map((m) => [
      m.id,
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(m.color).offsetHSL(0, -0.02, 0.12),
        roughness: Math.max(0.12, m.roughness - 0.08),
        metalness: m.metalness,
        envMapIntensity: (m.envMapIntensity ?? 1.25) * 1.2,
      }),
    ]),
  );
  const metalMat = (id) => metalAssets[metalById(id).id];
  const metalTopMat = (id) => metalTopAssets[metalById(id).id];

  const boardGroup = new THREE.Group();
  scene.add(boardGroup);

  //  One entry per marble on the board: the mesh, its contact shadow and its pool of light, and
  //  each marble's own eased rendered height. A single-marble level just has one entry, exactly
  //  as before; a multi-marble level has as many as its `spawns`.
  let marbles = [];
  let marbleLookId = designById(marbleLook).id;
  let board = null;
  let obstacles = null;
  let particles = null;
  let bounds = { w: level.w, h: level.h };
  let camRig = { pos: new THREE.Vector3(0, 14, 12), look: new THREE.Vector3() };
  let shake = 0;
  let levelRoot = null;
  /**
   *  Rebuild the toy's timber from the tuning sheet: the finish, and how loud its grain reads.
   *
   *  Five surfaces, each one call into `surfaceMaps`, which is the picture path when there is a
   *  picture and the procedural fields when there is not - so a missing asset still gives a board
   *  in every finish, just a coarser one. Returns the milliseconds it took, because the tuning
   *  sheet debounces this and a caller measuring a switch should be able to see its real cost.
   */
  function applyBoardFinish() {
    const t0 = performance.now();
    for (const [name, spec] of Object.entries(WOOD_SURFACES)) {
      const mat = assets[name];
      if (!mat) continue;
      setSurface(name, mat, woodSurface({ relief: spec.relief }, spec.tone, !!spec.rim));
    }
    return performance.now() - t0;
  }

  let lid = null;
  let freeCamera = false;

  // Adaptive quality: on a weak GPU (or a software renderer) the game should quietly get
  // cheaper instead of turning into a slideshow.
  const TIERS = {
    high: { pixelRatio: () => Math.min(window.devicePixelRatio || 1, 2), shadows: true, shadowSize: 2048, fog: true },
    medium: { pixelRatio: () => Math.min(window.devicePixelRatio || 1, 1.4), shadows: true, shadowSize: 1024, fog: true },
    low: { pixelRatio: () => 1, shadows: false, shadowSize: 512, fog: false },
  };
  let tier = 'high';

  // Glass marbles transmit, which costs one extra render of the opaque scene per frame - but only
  // while a transmissive marble is actually in view. This starts at the floor rather than at the
  // tier cap: a painted marble transmits nothing, three skips the pass entirely, and the buffer is
  // then never allocated. The first frame with glass sizes it properly, before that frame renders.
  //
  // That buffer only has to hold the *marble*, not the frame. The shell samples it inside the
  // ball's own screen disc, and a sphere's refraction *shrinks* what it reads, so a flat fraction
  // of the viewport is mostly waste: in a 1400x875 window a marble covers about 4% of the width,
  // so a 0.6 scale was rendering some 600x the pixels the marble can ever show. Measured on the
  // real GPU (M4 Max, Metal) the flat 0.6 cost +5.8ms per frame - 15.1ms became 20.9ms - which is
  // the difference between a comfortable frame and a visible stutter. Sizing the buffer to the
  // ball's own footprint removes the fill and keeps the marble.
  //
  // Two constraints shape the code below:
  //   * the pass also re-draws every opaque object, so it is never free - only the fill comes out,
  //     and this takes out the fill;
  //   * `WebGLRenderTarget.setSize` reallocates the texture whenever the size changes, so the
  //     scale is quantised and written only when it really moves. A marble rolling across the
  //     board keeps one buffer for most of its travel.
  const TRANSMISSION_MAX_BY_TIER = { high: 0.6, medium: 0.5, low: 0.35 };
  let transmissionScale = TRANSMISSION_MIN;
  let hasGlassMarble = false;
  renderer.transmissionResolutionScale = transmissionScale;

  function setQuality(next) {
    if (!TIERS[next] || tier === next) return tier;
    tier = next;
    const cfg = TIERS[tier];
    // The cap drops with the tier, but the marble's footprint decides the real value.
    updateTransmissionScale();
    renderer.setPixelRatio(cfg.pixelRatio());
    renderer.shadowMap.enabled = cfg.shadows;
    key.castShadow = cfg.shadows;
    if (key.shadow.mapSize.x !== cfg.shadowSize) {
      key.shadow.mapSize.set(cfg.shadowSize, cfg.shadowSize);
      key.shadow.map?.dispose();
      key.shadow.map = null;
    }
    scene.fog = cfg.fog ? fog : null;
    for (const m of [assets.wood, assets.wall, assets.wallTop, assets.ice, assets.sand, assets.steel, assets.belt, assets.vent]) {
      m.needsUpdate = true;
    }
    resize();
    return tier;
  }

  // ---------------------------------------------------------------------------
  //  Board construction
  // ---------------------------------------------------------------------------

  //  Shape space is (x, -z) so that rotateX(-90 degrees) lays a 2D shape into the board
  //  plane with its extrusion pointing down, and so that the cap UVs come out as board
  //  coordinates. That single convention is what lets the slab, the pit rings and the cup
  //  share one continuous piece of grain.
  const toShape = (x, z) => [x, -z];

  /** A hole's outline in *shape* space: a circle, or a slot's swept chain (see hole-shape.js). */
  const outline = (hole, path) =>
    holeOutline(THREE, { ...hole, centers: (hole.centers ?? [[hole.x, hole.z]]).map(([x, z]) => toShape(x, z)) }, path);

  /** A ring of board-space points as a THREE path in shape space (see `toShape`). */
  function ringToPath(ring, path) {
    ring.forEach(([x, z], i) => {
      const [sx, sz] = toShape(x, z);
      if (i === 0) path.moveTo(sx, sz);
      else path.lineTo(sx, sz);
    });
    path.closePath();
    return path;
  }

  /** The slab: the whole footprint, extruded, holes cut for nothing (rings handle those). */
  function slabGeometry(level, holeClusters, roundedOuter = null) {
    const loops = silhouetteLoops(level);
    if (!loops.length) return null;
    const outer = loops.reduce((a, b) => (Math.abs(loopLen(a)) > Math.abs(loopLen(b)) ? a : b));
    const shape = new THREE.Shape();
    // The slab's own edge is the outside of the toy, so it takes the eased exterior corners; its
    // internal loops are real ground and stay exactly where the tracer put them.
    loopsToPath(roundedOuter ?? outer, shape);
    for (const loop of loops) {
      if (loop === outer) continue;
      const hole = new THREE.Path();
      loopsToPath(loop, hole);
      shape.holes.push(hole);
    }
    // Every pit and the cup are *cut* out of the slab, so the shaft below is what you see.
    // (They used to be painted on top of a solid slab, which made them invisible traps.)
    // A lone hole is cut from its own ring, exactly as it always was; holes that overlap are cut
    // from the union of their regions, so the ground they share is one opening, not a wall.
    for (const cluster of holeClusters) {
      if (cluster.length === 1) {
        shape.holes.push(outline(cluster[0], new THREE.Path()));
        continue;
      }
      // A void *inside* a combined hole (pits arranged in a closed ring around a patch of floor)
      // is not cut back here: the slab is a Shape with holes, and a hole inside a hole is not
      // something its triangulator can hold. A plain opening is the honest drawing of that shape.
      for (const piece of combineHoleRings(cluster)) shape.holes.push(ringToPath(piece.outer, new THREE.Path()));
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: BOARD_THICK, bevelEnabled: false, curveSegments: 4 });
    g.rotateX(-Math.PI / 2);
    // The rotation puts the extrusion in +y, so drop the slab so its top face is y = 0:
    // that is the plane the physics simulates on.
    g.translate(0, -BOARD_THICK, 0);
    //  The caps are already in board coordinates; this brings the slab's own edge into the same
    //  field, so the grain runs over the rim and down the board's thickness instead of stopping
    //  at it and showing a smeared row of the tile.
    return boardProjectUVs(g);
  }

  /** A prepared 2D shape (with its holes), extruded from y0 to y1. Null if there is nothing to draw. */
  function extrudedPlate(shape, y0, y1) {
    if (!shape || y1 <= y0) return null;
    const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 4 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, y0, 0);
    return g;
  }

  /** A closed band between two loops, extruded from y0 to y1. Null if either loop is bad. */
  function extrudedBand(outerLoop, innerLoop, y0, y1, { bevel = 0.02 } = {}) {
    if (!outerLoop || !innerLoop || y1 <= y0) return null;
    const shape = new THREE.Shape();
    loopsToPath(outerLoop, shape);
    const hole = new THREE.Path();
    loopsToPath(innerLoop, hole);
    shape.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: y1 - y0,
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 1,
      curveSegments: 4,
    });
    g.rotateX(-Math.PI / 2);
    g.translate(0, y0, 0);
    return g;
  }

  /**
   * A closed band lofted between two loops with **matching vertices**: `outer` at `yOuter`,
   * `inner` at `yInner`.
   *
   * This is the sloped band `extrudedBand` cannot make — both of its loops sit at both heights, so
   * it builds a vertical wall with a flat cap. A routed hole's funnel leans: its mouth is the
   * hole's outline at full radius and its throat is that *same* outline pulled in, one full board
   * thickness lower, so the band runs diagonally down the wall the whole way round. The loops must
   * come from `holeRingPair` so vertex i of each is the same spot on the outline; otherwise the
   * surface twists or folds, which at an inner corner of a slot is exactly where it would show.
   */
  function loftBand(outer, inner, yOuter, yInner) {
    if (!outer || !inner || outer.length !== inner.length || outer.length < 3) return null;
    const n = outer.length;
    const pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const [ox, oz] = outer[i];
      const [ix, iz] = inner[i];
      pos[i * 6 + 0] = ox;
      pos[i * 6 + 1] = yOuter;
      pos[i * 6 + 2] = oz;
      pos[i * 6 + 3] = ix;
      pos[i * 6 + 4] = yInner;
      pos[i * 6 + 5] = iz;
    }
    const idx = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const oi = i * 2;
      const ii = i * 2 + 1;
      const oj = j * 2;
      const ij = j * 2 + 1;
      idx.push(oi, oj, ii, ii, oj, ij);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /** Screw heads spaced along a closed loop at the given height, merged into one geometry. */
  function screwsAlong(loop, spacing, y, r = 0.09) {
    const parts = [];
    let travelled = 0;
    let next = spacing * 0.5; // start half a spacing in, so fixings land mid-run, not on a corner
    for (let i = 0; i < loop.length; i++) {
      const [x0, z0] = loop[i];
      const [x1, z1] = loop[(i + 1) % loop.length];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 1e-6) continue;
      while (next <= travelled + len) {
        const t = (next - travelled) / len;
        const g = new THREE.CylinderGeometry(r, r * 1.15, 0.05, 10);
        g.translate(x0 + (x1 - x0) * t, y + 0.02, z0 + (z1 - z0) * t);
        parts.push(g);
        next += spacing;
      }
      travelled += len;
    }
    return parts.length ? mergeGeometries(parts, false) : null;
  }

  function loopsToPath(loop, path) {
    loop.forEach(([x, z], i) => {
      const [sx, sy] = toShape(x, z);
      if (i === 0) path.moveTo(sx, sy);
      else path.lineTo(sx, sy);
    });
    path.closePath();
  }

  function loopLen(loop) {
    let n = 0;
    for (let i = 0; i < loop.length; i++) {
      const [x0, z0] = loop[i];
      const [x1, z1] = loop[(i + 1) % loop.length];
      n += Math.hypot(x1 - x0, z1 - z0);
    }
    return n;
  }

  /**
   * Replace a closed loop's convex corners with a small fillet.
   *
   * The footprint tracer walks cell edges, so the board outline it hands back is a staircase of
   * hard mitres. For the device's own exterior corners that reads as a machined-off rectangle;
   * a real toy frame is eased. Every convex corner is rounded by `r` with a quadratic that is
   * tangent to both edges, so the fillet meets the straight runs without a crease, and the arc is
   * sampled rather than left as a curve because every consumer here (extruded shapes, the collar
   * offset, the screw walk) works on polylines.
   *
   * Concave corners are left exactly as they are: a shape with a notch (a cross, a ring) must not
   * have its inside corner filled in, and a fillet there would be a fillet pointing the wrong way.
   */
  function roundedLoop(loop, r, segments = 6) {
    const n = loop.length;
    if (!(r > 0) || n < 3) return loop;
    const winding = loopArea(loop) >= 0 ? 1 : -1;
    const out = [];
    for (let i = 0; i < n; i++) {
      const p = loop[(i - 1 + n) % n];
      const c = loop[i];
      const q = loop[(i + 1) % n];
      const d1 = [c[0] - p[0], c[1] - p[1]];
      const d2 = [q[0] - c[0], q[1] - c[1]];
      const l1 = Math.hypot(d1[0], d1[1]);
      const l2 = Math.hypot(d2[0], d2[1]);
      if (l1 < 1e-9 || l2 < 1e-9) {
        out.push(c);
        continue;
      }
      const cross = d1[0] * d2[1] - d1[1] * d2[0];
      if (cross * winding <= 1e-12) {
        out.push(c); // straight or concave: keep the corner
        continue;
      }
      const u1 = [d1[0] / l1, d1[1] / l1];
      const u2 = [d2[0] / l2, d2[1] / l2];
      const cos = Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1]));
      const turn = Math.acos(cos);
      if (turn < 1e-3) {
        out.push(c);
        continue;
      }
      // Tangent length for a fillet of radius r, clamped so a short edge cannot be overrun.
      const trim = Math.min(r / Math.tan(turn / 2), l1 * 0.5, l2 * 0.5);
      const a = [c[0] - u1[0] * trim, c[1] - u1[1] * trim];
      const b = [c[0] + u2[0] * trim, c[1] + u2[1] * trim];
      out.push(a);
      for (let k = 1; k < segments; k++) {
        const t = k / segments;
        const w0 = (1 - t) * (1 - t);
        const w1 = 2 * (1 - t) * t;
        const w2 = t * t;
        out.push([w0 * a[0] + w1 * c[0] + w2 * b[0], w0 * a[1] + w1 * c[1] + w2 * b[1]]);
      }
      out.push(b);
    }
    return out;
  }

  /** A rounded rectangle as a closed [x, z] loop, for the indicator track's own ring. */
  function roundedRectLoop(hx, hz, r, segments = 5) {
    const rr = Math.max(0, Math.min(r, hx, hz));
    const pts = [];
    const corner = (cx, cz, a0) => {
      for (let k = 0; k <= segments; k++) {
        const a = a0 + (k / segments) * (Math.PI / 2);
        pts.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]);
      }
    };
    corner(hx - rr, -hz + rr, -Math.PI / 2);
    corner(hx - rr, hz - rr, 0);
    corner(-hx + rr, hz - rr, Math.PI / 2);
    corner(-hx + rr, -hz + rr, Math.PI);
    return pts;
  }

  /**
   * The board footprint with the device's exterior corners eased. `raw` is the outline exactly as
   * traced, which is what anything that has to line up with the physics still uses; `rounded` is
   * only ever geometry for the toy's outer skin.
   */
  function outerOutline(level, r = CORNER_R) {
    const loops = silhouetteLoops(level);
    if (!loops.length) return null;
    const raw = loops.reduce((a, b) => (Math.abs(loopLen(a)) > Math.abs(loopLen(b)) ? a : b));
    return { raw, rounded: roundedLoop(raw, r) };
  }

  function boxGeometry(cells, y0, y1, inset = 1, jitter = 0) {
    const parts = [];
    for (const [c, r] of cells) {
      const g = new THREE.BoxGeometry(inset, y1 - y0, inset);
      if (jitter) {
        g.translate((Math.random() - 0.5) * jitter, 0, (Math.random() - 0.5) * jitter);
      }
      g.translate(c + 0.5 - bounds.w / 2, (y0 + y1) / 2, r + 0.5 - bounds.h / 2);
      parts.push(g);
    }
    if (!parts.length) return null;
    // Walls are timbers standing on the board: projected, their grain lines up with the floor at
    // the foot of the wall and runs up the sides.
    return boardProjectUVs(mergeGeometries(parts, false));
  }

  function buildBoard(level) {
    const root = new THREE.Group();
    const holeList = slabHoles(level, GOAL_HOLE_R);
    // Holes that overlap are one region, not several. Where two slots or a slot and a pit share
    // ground, they are cut, bevelled and shafted as the single hole they really are — otherwise
    // each is stamped with its own rim and the board shows a seam across the ground they share.
    const cutClusters = holeClusters(holeList.filter((h) => !h.moving));
    const cellsOf = (pred) => {
      const out = [];
      for (let r = 0; r < level.h; r++) {
        for (let c = 0; c < level.w; c++) if (pred(level.grid[r][c], c, r)) out.push([c, r]);
      }
      return out;
    };

    const wallCells = cellsOf((ch) => ch === WALL);
    const overlay = (ch) => cellsOf((c2) => c2 === ch);

    // The device's own outline, with its exterior corners eased (see roundedLoop). Everything on
    // the toy's outer skin is built from this one loop.
    const outline = outerOutline(level);

    // slab: one solid piece, so the grain runs across the board and the light reads
    const slab = new THREE.Mesh(slabGeometry(level, cutClusters, outline?.rounded), assets.wood);
    slab.receiveShadow = true;
    slab.castShadow = true;
    root.add(slab);

    //  Walls are timbers standing on the board. The rim ring follows the board's own edge, so it
    //  is drawn as a band from the eased outline rather than as cells: cell boxes would leave the
    //  rim's corner square and poking through the rounded collar that clamps it from above. Only
    //  the rim is a band; the level's own interior walls keep the per-cell drawing, because their
    //  carved joinery (a hair narrower than a cell) is exactly what reads as a run of timbers.
    const isRimCell = (c, r) =>
      !insideFootprint(level, c - 1, r) ||
      !insideFootprint(level, c + 1, r) ||
      !insideFootprint(level, c, r - 1) ||
      !insideFootprint(level, c, r + 1);
    const rimCells = wallCells.filter(([c, r]) => isRimCell(c, r));
    const innerWallCells = wallCells.filter(([c, r]) => !isRimCell(c, r));
    // The band is only a faithful replacement when the rim really is one unbroken ring of wall:
    // if a level carves a gap in its own edge the wall would be filled back in, so fall back.
    let rimRing = false;
    if (outline && rimCells.length) {
      rimRing = true;
      for (let r = 0; r < level.h && rimRing; r++) {
        for (let c = 0; c < level.w && rimRing; c++) {
          if (insideFootprint(level, c, r) && isRimCell(c, r) && level.grid[r][c] !== WALL) rimRing = false;
        }
      }
    }
    // A hair inside the slab's own edge, so the rim still shows the shadow line under the collar
    // that the cell boxes' inset gave it.
    const rimOuter = rimRing ? (insetLoop(outline.rounded, 0.015) ?? outline.rounded) : null;
    const rimInner = rimRing ? insetLoop(outline.raw, 1.0) : null;
    if (rimOuter && rimInner) {
      const body = extrudedBand(rimOuter, rimInner, 0, WALL_H - 0.07, { bevel: 0 });
      const cap = extrudedBand(rimOuter, rimInner, WALL_H - 0.07, WALL_H, { bevel: 0 });
      const rimBody = new THREE.Mesh(boardProjectUVs(body), assets.wall);
      rimBody.name = 'wall-rim-body';
      rimBody.castShadow = true;
      rimBody.receiveShadow = true;
      root.add(rimBody);
      const rimCap = new THREE.Mesh(boardProjectUVs(cap), assets.wallTop);
      rimCap.name = 'wall-rim-cap';
      rimCap.castShadow = true;
      root.add(rimCap);
    } else {
      rimRing = false; // nothing was drawn for the rim, so the cell boxes must cover it
    }
    // Subtle carved groove where two wall cells meet, made by drawing the wall cells a
    // hair smaller than a cell: reads as joinery rather than a single lump.
    const boxBody = boxGeometry(rimRing ? innerWallCells : wallCells, 0, WALL_H - 0.07, 0.97);
    const boxCap = boxGeometry(rimRing ? innerWallCells : wallCells, WALL_H - 0.07, WALL_H, 0.85);
    if (boxBody) {
      const wallBody = new THREE.Mesh(boxBody, assets.wall);
      wallBody.castShadow = true;
      wallBody.receiveShadow = true;
      root.add(wallBody);
    }
    if (boxCap) {
      const wallCap = new THREE.Mesh(boxCap, assets.wallTop);
      wallCap.castShadow = true;
      root.add(wallCap);
    }

    // surface overlays: thin inlaid plates
    const overlayLayer = (chars, mat, y = 0.012) => {
      const cells = cellsOf((ch) => chars.includes(ch));
      if (!cells.length) return null;
      const mesh = new THREE.Mesh(boxGeometry(cells, y - 0.012, y, 0.995), mat);
      mesh.receiveShadow = true;
      root.add(mesh);
      return mesh;
    };
    //  A material is ground, not a row of tiles: it is drawn as ONE plate in the slab's own shape
    //  language, with its holes taken out of it by a true boolean difference — the same curve the
    //  slab is cut with, to the last vertex. So a pit cut into ice has ice around a round hole
    //  whether the pit sits inside the ice or straddles its edge, and a pit that slices a material
    //  in two leaves two plates. `regionGeometry` (engine/materials.js) owns that cut.
    const materialLayer = (id, mat, y0 = 0, y1 = 0.012) => {
      const region = level.materials?.[id];
      if (!region) return null;
      const holes = holeList.filter((h) => !h.moving);
      const geo = regionGeometry(
        region,
        holes.map((h) => ({
          chain: (h.centers ?? [[h.x, h.z]]).map(([x, z]) => toEdgeSpace(level, x, z)),
          r: h.r,
        })),
      );
      const parts = [];
      for (const part of geo.shapes) {
        const shape = new THREE.Shape();
        loopsToPath(
          part.outer.map(([c, r]) => [c - level.w / 2, r - level.h / 2]),
          shape,
        );
        for (const loop of part.voids) {
          const path = new THREE.Path();
          loopsToPath(
            loop.map(([c, r]) => [c - level.w / 2, r - level.h / 2]),
            path,
          );
          shape.holes.push(path);
        }
        const g = extrudedPlate(shape, y0, y1);
        if (g) parts.push(g);
      }
      if (!parts.length) return null;
      const mesh = new THREE.Mesh(mergeGeometries(parts, false), mat);
      //  Named so a browser check can read the plate's own triangles and ask where the material
      //  actually reaches, rather than trusting a screenshot to show a hole's edge.
      mesh.name = `material-${id}`;
      mesh.receiveShadow = true;
      root.add(mesh);
      return mesh;
    };

    materialLayer('ice', assets.ice);
    materialLayer('sand', assets.sand);
    materialLayer('steel', assets.steel);
    const beltMesh = overlayLayer([BELT], assets.belt);
    overlayLayer([VENT], assets.vent);
    const padMesh = overlayLayer([PAD], assets.pad, 0.018);
    overlayLayer([PLATE], assets.plate, 0.02);

    // A moving pit cannot be a static cut in the slab, so it gets a drawn well that
    // follows it. Nothing uses one yet; if a level does, it will at least be visible.
    const movingWells = [];
    for (const hole of holeList.filter((h) => h.moving)) {
      const g = new THREE.Group();
      // A moving slot gets the same capsule outline as a cut slot; a moving circle keeps the
      // disc-plus-brass-ring treatment it has always had.
      const slot = (hole.centers ?? []).length > 1;
      const mouth = slot
        ? new THREE.Mesh(new THREE.ShapeGeometry(slotShape(hole)), assets.dark)
        : new THREE.Mesh(new THREE.CircleGeometry(hole.r, 32), assets.dark);
      // (slotShape is declared below; it draws the chain relative to the group, because the
      // group is what carries the hole's position as a moving pit slides.)
      mouth.rotation.x = -Math.PI / 2;
      mouth.position.y = 0.006;
      g.add(mouth);
      if (!slot) {
        const lip = new THREE.Mesh(new THREE.RingGeometry(hole.r, hole.r + 0.05, 32), assets.brass);
        lip.rotation.x = -Math.PI / 2;
        lip.position.y = 0.007;
        g.add(lip);
      }
      g.position.set(hole.x, 0, hole.z);
      root.add(g);
      movingWells.push({ mesh: g, def: hole });
    }

    /** A slot as a filled shape for the moving well's mouth, relative to the well's origin. */
    function slotShape(hole) {
      const local = {
        ...hole,
        centers: (hole.centers ?? [[hole.x, hole.z]]).map(([x, z]) => toShape(x - hole.x, z - hole.z)),
        x: 0,
        z: 0,
      };
      return holeShape(THREE, local);
    }

    //  The board's thickness is shown at every hole as the wood it actually is: a routed edge
    //  the full BOARD_THICK deep. It has to be a *bevel*, not a vertical wall. The vertical cut
    //  wall exists in the slab, but the camera sits almost straight overhead and the hole's own
    //  wood shadows it, so it renders unlit (measured ~32/30/29 against a 165/110/68 floor) and
    //  reads as pure black whatever its depth. A cone that leans out to the rim faces up into the
    //  key light, so the same thickness reads as a warm band of wood around the mouth. The shaft
    //  then starts at the throat the bevel leaves, at the slab's underside.
    const throatOf = (radius) => Math.max(radius * 0.5, radius - BOARD_THICK);
    const mouthGroup = new THREE.Group();
    //  The board's thickness is shown by *one* funnel per hole: a band between the hole's own
    //  outline at its mouth radius and that same outline at the throat radius, one board thickness
    //  down. A slot is a single swept region, so it gets a single funnel that runs round both caps
    //  and both sides of every bend - the board's own edge is then the only rim you see. Stamping a
    //  funnel at every sampled centre, as this used to, leaves a row of overlapping rims *inside*
    //  the slot, each one reading as a separate hole the board does not have.
    const addBevel = (hole) => {
      const { outer, inner } = holeRingPair(hole, throatOf(hole.r));
      const g = loftBand(outer, inner, 0, -BOARD_THICK);
      if (!g) return;
      //  The projection replaces the primitive's own UVs with the board coordinate itself, so a
      //  point on the funnel carries the grain of the floor directly above it. It is the same
      //  outline the slab was cut with, so the grain runs down into the hole from the rim.
      boardProjectUVs(g);
      const mesh = new THREE.Mesh(g, assets.woodEdge);
      mesh.receiveShadow = true;
      mouthGroup.add(mesh);
    };

    // shafts under every hole, continuing the bevel's throat
    const shaftGroup = new THREE.Group();
    const addShaft = (hole, depth, mat = assets.shaft) => {
      const top = -BOARD_THICK;
      const throat = throatOf(hole.r);
      // The bore is one swept band too: same outline, a hair tighter at the bottom, and one cap
      // over the whole slot rather than a disc under every centre.
      const bore = loftBand(holeRing(hole, throat), holeRing(hole, throat * 0.92), top, top - depth);
      if (bore) shaftGroup.add(new THREE.Mesh(bore, mat));
      const bottom = new THREE.Mesh(new THREE.ShapeGeometry(holeShape(THREE, hole, throat * 0.92)), assets.dark);
      bottom.rotation.x = -Math.PI / 2;
      bottom.position.y = top - depth + 0.005;
      shaftGroup.add(bottom);
    };
    //  The same funnel-and-shaft, for a region that is more than one hole: the union's own outline
    //  is the mouth, and the throat is that outline pulled in by the board's thickness, so the
    //  combined hole is bevelled once, round its outside, with no rim across the ground its parts
    //  share. Built the same way as the single-hole path above, on the union ring instead of a
    //  slot's ring.
    const addCombinedBevel = (ring) => {
      const g = loftBand(ring, offsetRing(ring, BOARD_THICK), 0, -BOARD_THICK);
      if (!g) return null;
      boardProjectUVs(g);
      const mesh = new THREE.Mesh(g, assets.woodEdge);
      mesh.receiveShadow = true;
      mouthGroup.add(mesh);
      return mesh;
    };
    const addCombinedShaft = (ring, depth, mat) => {
      const top = -BOARD_THICK;
      const throat = offsetRing(ring, BOARD_THICK);
      const bottomRing = offsetRing(throat, BOARD_THICK * 0.08);
      const bore = loftBand(throat, bottomRing, top, top - depth);
      if (bore) shaftGroup.add(new THREE.Mesh(bore, mat));
      const shape = new THREE.Shape();
      ringToPath(bottomRing, shape);
      const bottom = new THREE.Mesh(new THREE.ShapeGeometry(shape), assets.dark);
      bottom.rotation.x = -Math.PI / 2;
      bottom.position.y = top - depth + 0.005;
      shaftGroup.add(bottom);
    };
    for (const cluster of cutClusters) {
      // The cup's own bore is solid near-black: it is the one hole the player reads as the target,
      // and it should read as depth, not as a lit recess. Pits keep the browner shaft tone.
      const goal = cluster.some((h) => h.kind === 'goal');
      const depth = goal ? 1.1 : 1.5;
      const mat = goal ? assets.dark : assets.shaft;
      if (cluster.length === 1) {
        addBevel(cluster[0]);
        addShaft(cluster[0], depth, mat);
        continue;
      }
      for (const piece of combineHoleRings(cluster)) {
        addCombinedBevel(piece.outer);
        addCombinedShaft(piece.outer, depth, mat);
      }
    }
    root.add(shaftGroup);
    root.add(mouthGroup);

    // goal ring: a brass mouth, a near-black cup, and a soft light that laps the rim.
    // The old cue was a warm disc *inside* the shaft, which made the one hole that matters read as a
    // lit recess instead of a hole. The reading is carried on the rim instead, where it cannot be
    // confused with the floor. The light is a feathered glow rather than a second ring of metal: a
    // torus arc had two cut ends and a hard tube edge, which read as a piece of the toy rather than
    // as light. A rounded falloff that reaches zero everywhere has no edge to read as a part, and it
    // spills past the tube onto the brass and the wood the way a lamp on the rim would.
    const goalRing = new THREE.Mesh(new THREE.TorusGeometry(GOAL_LAP_R, 0.055, 16, 44), assets.brass);
    goalRing.rotation.x = -Math.PI / 2;
    goalRing.position.set(level.goal.x, GOAL_LAP_Y, level.goal.z);
    root.add(goalRing);
    // The glow rides a pivot that shares the ring's own plane, so spinning the pivot about its local
    // z walks the light around the rim: in-plane travel, no trigonometry in the frame loop. The plane
    // is laid flat by that same rotation, and lifted clear of the tube on the pivot's local +z, which
    // is world up once the pivot is turned over.
    const goalRun = new THREE.Object3D();
    goalRun.rotation.x = -Math.PI / 2;
    goalRun.position.set(level.goal.x, GOAL_LAP_Y, level.goal.z);
    const goalLap = new THREE.Mesh(
      new THREE.PlaneGeometry(GOAL_LAP_W, GOAL_LAP_D),
      new THREE.MeshBasicMaterial({
        map: softGlowTexture(),
        color: 0xffe3b6,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    goalLap.material.opacity = GOAL_LAP_BASE;
    goalLap.position.set(GOAL_LAP_R, 0, GOAL_LAP_H);
    goalRun.add(goalLap);
    root.add(goalRun);

    // spawn etching
    const spawnRing = new THREE.Mesh(
      new THREE.RingGeometry(BALL_R * 1.5, BALL_R * 1.9, 32),
      new THREE.MeshBasicMaterial({ color: 0xffe9c4, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    spawnRing.rotation.x = -Math.PI / 2;
    spawnRing.position.set(level.spawn.x, 0.014, level.spawn.z);
    root.add(spawnRing);

    return { root, beltMesh, padMesh, goalRun, shaftGroup, movingWells };
  }

  // ---------------------------------------------------------------------------
  //  Ramps
  // ---------------------------------------------------------------------------

  /** Unit face normal of the triangle p0 -> p1 -> p2, in world xyz. */
  function triNormal(p0, p1, p2) {
    const ax = p1[0] - p0[0];
    const ay = p1[1] - p0[1];
    const az = p1[2] - p0[2];
    const bx = p2[0] - p0[0];
    const by = p2[1] - p0[1];
    const bz = p2[2] - p0[2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  }

  /**
   * Push a triangle, wound so its normal agrees with `want`. Winding by hand is the classic way
   * to get a face that is lit from the wrong side or vanishes under backface culling, and a
   * wedge's faces face four different ways, so the direction is stated and the winding follows.
   */
  function pushTri(out, p0, p1, p2, want) {
    const n = triNormal(p0, p1, p2);
    const flip = n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0;
    const [a, b, c] = flip ? [p0, p2, p1] : [p0, p1, p2];
    out.push(...a, ...b, ...c);
  }

  /**
   * The wedge the physics has been using all along, as geometry: a quad top surface that slopes
   * from `height` at the crest down to the board at the low edge, a vertical face under the crest
   * (the step the marble cannot climb from behind), and two triangular sides. It reads
   * `rp.height` and `rp.dir` (the uphill traverse) from the built level, so the surface the marble
   * is drawn standing on and the surface the engine's ground height comes from are the same one.
   */
  function rampWedge(rp) {
    const { x0, x1, z0, z1, height, dir } = rp;
    // The four corners of the rect, in order, and which of them stand up at `height`.
    const c = [
      { x: x0, z: z0 },
      { x: x1, z: z0 },
      { x: x1, z: z1 },
      { x: x0, z: z1 },
    ];
    //  `dir` is the traversal direction, so the crest (the tall end) is the far edge along it.
    const onUphill = (p) => (dir[0] !== 0 ? (dir[0] > 0 ? p.x === x1 : p.x === x0) : dir[1] > 0 ? p.z === z1 : p.z === z0);
    const yOf = (p) => (onUphill(p) ? height : 0);
    const top = (p) => [p.x, yOf(p), p.z];
    const base = (p) => [p.x, 0, p.z];

    const pos = [];
    // The sloping top: planar, because the two corners of each edge are level with each other.
    pushTri(pos, top(c[0]), top(c[1]), top(c[2]), [0, 1, 0]);
    pushTri(pos, top(c[0]), top(c[2]), top(c[3]), [0, 1, 0]);

    // The uphill face, and the two sides. Which corners form each is decided by the axis the
    // wedge slopes along, so the faces are the actual outline rather than two guesses.
    const alongZ = dir[0] === 0;
    const uphillPair = alongZ ? (dir[1] > 0 ? [2, 3] : [0, 1]) : dir[0] > 0 ? [1, 2] : [3, 0];
    const sidePairs = alongZ
      ? [
          [0, 3],
          [1, 2],
        ]
      : [
          [0, 1],
          [2, 3],
        ];

    const [u0, u1] = uphillPair;
    const backNormal = [dir[0], 0, dir[1]];
    pushTri(pos, base(c[u0]), base(c[u1]), top(c[u1]), backNormal);
    pushTri(pos, base(c[u0]), top(c[u1]), top(c[u0]), backNormal);

    for (const [s0, s1] of sidePairs) {
      // One end of a side edge is up at `height`, the other is on the board; the face is the
      // triangle those two and the raised corner's own foot make.
      const raised = yOf(c[s0]) > 0 ? s0 : s1;
      const other = raised === s0 ? s1 : s0;
      const outward = alongZ ? [c[raised].x === x0 ? -1 : 1, 0, 0] : [0, 0, c[raised].z === z0 ? -1 : 1];
      pushTri(pos, base(c[other]), base(c[raised]), top(c[raised]), outward);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    //  A wedge built from pushed triangles has no UV attribute at all, which meant it sampled one
    //  texel of the wood texture and rendered as a flat colour. Projected, it is a piece of the
    //  same board, and its slope carries the grain up and over the crest.
    return boardProjectUVs(g);
  }

  /** Every ramp in the level: the wedge, plus a brass wear strip along the crest it crests on. */
  function buildRamps(ramps) {
    const root = new THREE.Group();
    root.name = 'ramps';
    for (const rp of ramps) {
      const wedge = new THREE.Mesh(rampWedge(rp), assets.ramp);
      wedge.name = 'ramp-wedge';
      wedge.castShadow = true;
      wedge.receiveShadow = true;
      root.add(wedge);

      // A thin strip along the uphill crest. A ramp's top edge is where the marble's speed and
      // the slope meet, and on a near-top-down camera a raised lip is the clearest thing that
      // says which end is the top; it is decoration only, so it is never a collider.
      const along = rp.dir[0] !== 0 ? rp.z1 - rp.z0 : rp.x1 - rp.x0;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(rp.dir[0] !== 0 ? 0.07 : along, 0.05, rp.dir[0] !== 0 ? along : 0.07), assets.brass);
      const ex = rp.dir[0] !== 0 ? (rp.dir[0] > 0 ? rp.x1 : rp.x0) : (rp.x0 + rp.x1) / 2;
      const ez = rp.dir[0] !== 0 ? (rp.z0 + rp.z1) / 2 : rp.dir[1] > 0 ? rp.z1 : rp.z0;
      strip.position.set(ex, rp.height + 0.02, ez);
      strip.castShadow = true;
      root.add(strip);
    }
    return root;
  }

  // ---------------------------------------------------------------------------
  //  Obstacles
  // ---------------------------------------------------------------------------

  function buildObstacles(level) {
    const f = level.features;
    const root = new THREE.Group();
    const pegs = [];
    const windmills = [];
    const pendulums = [];
    const movers = [];
    const plates = [];
    const pads = [];
    const magnets = [];
    const gates = [];
    const lifts = [];

    for (const p of f.pegs) {
      const g = new THREE.Group();
      const mat = p.kick ? assets.hazard : assets.brass;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r * 1.04, 0.3, 24), mat);
      body.position.y = 0.15;
      body.castShadow = true;
      g.add(body);
      // flat cap with a small dome: a bumper post, not a spare marble
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 1.08, p.r * 1.08, 0.06, 24), assets.iron);
      cap.position.y = 0.33;
      cap.castShadow = true;
      g.add(cap);
      const nub = new THREE.Mesh(new THREE.SphereGeometry(p.r * 0.45, 16, 10), mat);
      nub.position.y = 0.38;
      g.add(nub);
      g.position.set(p.x, 0.02, p.z);
      root.add(g);
      pegs.push(g);
    }

    for (const m of f.windmills) {
      const g = new THREE.Group();
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.34, 20), assets.iron);
      hub.position.y = 0.17;
      hub.castShadow = true;
      g.add(hub);
      const arms = new THREE.Group();
      for (let i = 0; i < (m.arms ?? 2); i++) {
        const a = (i * Math.PI * 2) / (m.arms ?? 2);
        const arm = new THREE.Group();
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.2, m.len), assets.iron);
        bar.position.z = m.len / 2;
        bar.castShadow = true;
        arm.add(bar);
        const tip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 0.24), assets.hazard);
        tip.position.z = m.len - 0.1;
        tip.castShadow = true;
        arm.add(tip);
        arm.rotation.y = -a; // physics angle is (cos, sin) in (x, z)
        arms.add(arm);
      }
      arms.position.y = 0.16;
      g.add(arms);
      g.position.set(m.x, 0.02, m.z);
      root.add(g);
      windmills.push({ mesh: arms, def: m });
    }

    for (const p of f.pendulums) {
      const g = new THREE.Group();
      const arm = new THREE.Group();
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, p.len, 12), assets.iron);
      rod.position.set(0, 0.36, p.len / 2);
      rod.rotation.x = Math.PI / 2;
      rod.castShadow = true;
      arm.add(rod);
      const bob = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 14), assets.hazard);
      bob.position.set(0, 0.36, p.len);
      bob.castShadow = true;
      arm.add(bob);
      const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.62, 14), assets.brass);
      pivot.position.y = 0.31;
      pivot.castShadow = true;
      g.add(pivot);
      g.add(arm);
      g.position.set(p.x, 0.02, p.z);
      root.add(g);
      pendulums.push({ mesh: arm, def: p });
    }

    for (const m of f.movers) {
      const g = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.BoxGeometry(m.len ?? 1, 0.34, 0.18), assets.hazard);
      bar.castShadow = true;
      g.add(bar);
      const trim = new THREE.Mesh(new THREE.BoxGeometry((m.len ?? 1) * 1.04, 0.06, 0.22), assets.iron);
      trim.position.y = 0.17;
      g.add(trim);
      g.position.set(m.pos[0], 0.17, m.pos[1]);
      root.add(g);
      movers.push({ mesh: g, def: m });
    }

    for (const plate of f.plates) {
      const r = plate.radius ?? BUTTON_R;
      const g = new THREE.Group();
      //  A pressure plate is a raised circular BUTTON: a dark routed seat, a short metal body
      //  standing proud of the floor, and a brighter chamfered cap the marble rolls onto. The
      //  cap sinks a little when the button is held, and a soft ring flashes around the seat so
      //  a held plate reads even when the cap is under the marble.
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.05, r + 0.05, 0.05, 32), assets.dark);
      seat.position.y = 0.025;
      seat.receiveShadow = true;
      g.add(seat);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.02, 0.1, 32), metalMat(plate.metal));
      body.position.y = 0.1;
      body.castShadow = true;
      body.receiveShadow = true;
      g.add(body);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.82, r * 0.92, 0.055, 32), metalTopMat(plate.metal));
      cap.castShadow = true;
      const capY = 0.175;
      cap.position.y = capY;
      g.add(cap);
      const halo = new THREE.Mesh(new THREE.RingGeometry(r + 0.005, r + 0.05, 32), assets.glow.clone());
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.052;
      halo.material.opacity = 0;
      //  This material is this button's own (its opacity animates as it is held), so a level
      //  change must dispose it - `assets.glow` itself is shared and must NOT be.
      halo.material.userData.owned = true;
      g.add(halo);
      g.position.set(plate.x, 0, plate.z);
      root.add(g);
      plates.push({ mesh: g, cap, body, halo, def: plate, capY });
    }

    for (const pad of f.pads) {
      for (const side of [pad.a, pad.b]) {
        const g = new THREE.Group();
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(TELEPORT_R, TELEPORT_R, 0.05, 26), assets.pad);
        disc.position.y = 0.035;
        g.add(disc);
        const halo = new THREE.Mesh(new THREE.RingGeometry(TELEPORT_R * 1.1, TELEPORT_R * 1.6, 26), assets.glow);
        halo.rotation.x = -Math.PI / 2;
        halo.position.y = 0.06;
        g.add(halo);
        g.position.set(side.x, 0, side.z);
        root.add(g);
        pads.push({ mesh: g, halo, side });
      }
    }

    for (const m of f.magnets) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.28, 20), m.strength >= 0 ? assets.brass : assets.iron);
      body.position.y = 0.14;
      body.castShadow = true;
      g.add(body);
      g.position.set(m.x, 0.02, m.z);
      root.add(g);
      magnets.push({ mesh: g, def: m });
    }

    for (const gate of f.gates) {
      const seg = gate.segments[0];
      const a = new THREE.Vector3(seg.a[0], 0, seg.a[1]);
      const b = new THREE.Vector3(seg.b[0], 0, seg.b[1]);
      const len = a.distanceTo(b);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      //  The bar is AS LONG AS ITS OWN SEGMENT and runs ALONG it: the collider is the segment
      //  itself, so a bar laid across the segment would draw a barrier the marble ignores and
      //  hide one it cannot pass. `rotation.y` maps the box's local +X onto a->b; `lookAt` would
      //  map its +Z there instead and leave the long axis a quarter turn out.
      const along = Math.atan2(-(b.z - a.z), b.x - a.x);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.42, 0.16), assets.iron);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.18), assets.hazard);
      stripe.position.y = 0.12;
      bar.add(stripe);
      bar.castShadow = true;
      bar.position.copy(mid);
      bar.position.y = 0.21;
      bar.rotation.y = along;
      const g = new THREE.Group();
      g.add(bar);
      root.add(g);
      gates.push({ mesh: g, bar, def: gate, closedY: 0, openY: -0.62 });
    }

    for (const l of f.lifts ?? []) {
      const seg = l.segments[0];
      const a = new THREE.Vector3(seg.a[0], 0, seg.a[1]);
      const b = new THREE.Vector3(seg.b[0], 0, seg.b[1]);
      const len = a.distanceTo(b) || 1;
      const mid = a.clone().add(b).multiplyScalar(0.5);
      //  `rotation.y` maps the slab's local +X onto a->b, so its length runs ALONG its own
      //  segment - the collider's line - and its width sits across it. (A `lookAt` maps +Z onto
      //  the segment and leaves the long axis a quarter turn out: the wall the marble hit and the
      //  wall on screen would be at right angles.)
      const along = Math.atan2(-(b.z - a.z), b.x - a.x);
      const g = new THREE.Group();
      //  The routed slot it rises out of: a dark kerf in the floor along the same line, so the
      //  wall visibly emerges from the board instead of fading up out of nowhere.
      const slot = new THREE.Mesh(new THREE.BoxGeometry(len, 0.02, LIFT_HALF_W * 2 + 0.07), assets.dark);
      slot.position.set(mid.x, 0.009, mid.z);
      slot.rotation.y = along;
      slot.receiveShadow = true;
      g.add(slot);
      //  A wall, cut from the metal of the plate that drives it: as long as the segment, as wide
      //  as a wall cell, as tall as a wall.
      const slab = new THREE.Mesh(new THREE.BoxGeometry(len, LIFT_H, LIFT_HALF_W * 2), metalMat(l.metal));
      slab.castShadow = true;
      slab.receiveShadow = true;
      // A brighter cap, so a wall you can drive up and down reads as a *mechanism*, not a wall.
      const cap = new THREE.Mesh(new THREE.BoxGeometry(len * 1.004, 0.07, LIFT_HALF_W * 2 * 1.004), metalTopMat(l.metal));
      cap.position.y = LIFT_H / 2 - 0.035;
      slab.add(cap);
      //  upY: standing, its base on the floor. downY: fully retracted, its top just under the
      //  floor, so at rest it is hidden inside the board and rising carries it the whole way out.
      //  The slab starts AT its rest height, so a `lower` door does not visibly pop up and a
      //  `raise` wall does not visibly sink on the frame the level loads.
      const upY = LIFT_H / 2;
      const downY = -LIFT_H / 2 - 0.006;
      slab.position.set(mid.x, downY + (upY - downY) * (l.height ?? 0), mid.z);
      slab.rotation.y = along;
      g.add(slab);
      root.add(g);
      lifts.push({ mesh: g, slab, def: l, upY, downY });
    }

    return { root, pegs, windmills, pendulums, movers, plates, pads, magnets, gates, lifts };
  }

  // ---------------------------------------------------------------------------
  //  Particles
  // ---------------------------------------------------------------------------

  function createParticles(count = 260) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    const life = new Float32Array(count);
    const maxLife = new Float32Array(count);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const points = new THREE.Points(geo, assets.spark);
    points.frustumCulled = false;
    for (let i = 0; i < count; i++) positions[i * 3 + 1] = -999;
    return { points, positions, colors, vel, life, maxLife, count, cursor: 0, geo };
  }

  function spawnParticles(particles, x, y, z, n, spread, power, tint = [1, 0.85, 0.55], dirBias = null) {
    for (let i = 0; i < n; i++) {
      const idx = particles.cursor;
      particles.cursor = (particles.cursor + 1) % particles.count;
      const a = Math.random() * Math.PI * 2;
      const up = 0.4 + Math.random() * 1.4;
      const r = spread * (0.3 + Math.random());
      particles.positions[idx * 3] = x + Math.cos(a) * 0.1;
      particles.positions[idx * 3 + 1] = y + 0.12 + Math.random() * 0.1;
      particles.positions[idx * 3 + 2] = z + Math.sin(a) * 0.1;
      const bx = dirBias ? dirBias[0] : 0;
      const bz = dirBias ? dirBias[1] : 0;
      particles.vel[idx * 3] = Math.cos(a) * r + bx;
      particles.vel[idx * 3 + 1] = up * power;
      particles.vel[idx * 3 + 2] = Math.sin(a) * r + bz;
      particles.colors[idx * 3] = tint[0];
      particles.colors[idx * 3 + 1] = tint[1];
      particles.colors[idx * 3 + 2] = tint[2];
      particles.life[idx] = particles.maxLife[idx] = 0.35 + Math.random() * 0.5;
    }
    particles.geo.attributes.position.needsUpdate = true;
    particles.geo.attributes.color.needsUpdate = true;
  }

  function updateParticles(particles, dt) {
    const { positions, colors, vel, life, maxLife, count } = particles;
    let any = false;
    for (let i = 0; i < count; i++) {
      if (life[i] <= 0) continue;
      any = true;
      life[i] -= dt;
      vel[i * 3 + 1] -= 6 * dt;
      positions[i * 3] += vel[i * 3] * dt;
      positions[i * 3 + 1] += vel[i * 3 + 1] * dt;
      positions[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (positions[i * 3 + 1] < 0.03) {
        positions[i * 3 + 1] = 0.03;
        vel[i * 3 + 1] *= -0.3;
      }
      const f = Math.max(0, life[i] / maxLife[i]);
      const c = f * f;
      colors[i * 3] *= 1;
      colors[i * 3] = Math.min(1, colors[i * 3]);
      // fade by scaling the additive colour toward black
      const base = [1, 0.85, 0.55];
      colors[i * 3] = base[0] * c;
      colors[i * 3 + 1] = base[1] * c;
      colors[i * 3 + 2] = base[2] * c;
      if (life[i] <= 0) positions[i * 3 + 1] = -999;
    }
    if (any) {
      particles.geo.attributes.position.needsUpdate = true;
      particles.geo.attributes.color.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------------------
  //  The glass lid and the grip
  // ---------------------------------------------------------------------------

  /**
   * Height of the tallest mesh under `root`, in root-local space. The board is tilted by
   * the time we ask, so measuring a world-space box would lie; this walks the meshes and
   * brings each one's bounds back into the root's frame.
   */
  function localTop(root) {
    root.updateMatrixWorld(true);
    const toLocal = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const m = new THREE.Matrix4();
    const box = new THREE.Box3();
    const piece = new THREE.Box3();
    root.traverse((o) => {
      if (!o.geometry) return;
      o.geometry.computeBoundingBox();
      m.multiplyMatrices(toLocal, o.matrixWorld);
      piece.copy(o.geometry.boundingBox).applyMatrix4(m);
      box.union(piece);
    });
    return box.isEmpty() ? 0 : box.max.y;
  }

  /**
   * The lid: a metal collar standing on the rim wall, the glass clamped inside it, and the
   * grip at the centre of the glass. Everything here is rigid with the board, because this
   * is the object the hands hold - the whole lid rocks with the maze.
   *
   * Returns null for a footprint we cannot frame (no outline, or an outline too narrow to
   * inset), in which case the game simply presents the bare board.
   */
  /**
   * The four level troughs: channel walls cut into the collar, and a liquid surface per trough
   * that is rebuilt from the simulation every frame.
   *
   * The troughs are laid out by the engine (`vialLayout`), so the thing the player sees and the
   * thing the physics moves are the same four channels by construction. The liquid is a ribbon of
   * the simulated depths plus a wall of liquid along the channel's inner face, so it reads as
   * having depth from a raking angle and as a surface from above.
   */
  function buildVials(level, outer, inner, floorY, topY) {
    const specs = vialLayout(level);
    if (!specs.length) return null;
    const group = new THREE.Group();
    group.name = 'lid-vials';
    const wallThick = 0.02;
    const liquids = new Map();
    const bars = new Map();
    const caps = [];
    const boxMesh = (w, h, d, x, y, z, name) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), assets.collar);
      mesh.position.set(x, y, z);
      mesh.name = name;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };

    for (const spec of specs) {
      const along = spec.axis === 'x';
      const len = spec.to - spec.from; // channel length
      const mid = (spec.from + spec.to) / 2;
      const wallH = topY - floorY;
      const wallY = floorY + wallH / 2;
      // `inward` points from the channel toward the playfield, so the two rails can be placed
      // relative to the channel centreline however the level's shape is oriented.
      const inward = -spec.side;
      const railIn = spec.at + inward * (VIAL_WIDTH / 2 + wallThick / 2); // the wall by the glass
      const railOut = spec.at - inward * (VIAL_WIDTH / 2 + 0.09); // the wall by the rim
      for (const [pos, w, name] of [
        [railIn, wallThick, 'lid-vial-rail-in'],
        [railOut, 0.18, 'lid-vial-rail-out'],
      ]) {
        if (along) boxMesh(len, wallH, w, mid, wallY, pos, name);
        else boxMesh(w, wallH, len, pos, wallY, mid, name);
      }
      // End caps: the blocks that stop one side's liquid from running into the next side's, sitting
      // in the corner area between the end of the channel and the corner fixing. They exist only
      // for the liquid - the instant bars never reach them - so they are shown with the liquid and
      // hidden in bars mode, where they would otherwise stand across the track's own corner turn.
      const capW = VIAL_WIDTH + wallThick;
      for (const [end, dir] of [
        [spec.from, -1],
        [spec.to, 1],
      ]) {
        const capCentre = end + dir * (VIAL_CORNER / 2);
        caps.push(
          along
            ? boxMesh(VIAL_CORNER, wallH, capW, capCentre, wallY, spec.at, 'lid-vial-cap')
            : boxMesh(capW, wallH, VIAL_CORNER, spec.at, wallY, capCentre, 'lid-vial-cap'),
        );
      }


      // --- the liquid itself ---------------------------------------------------
      const cells = VIAL_CELLS;
      const n = cells + 1;
      const top = new THREE.BufferGeometry();
      const pos = new Float32Array(n * VIAL_ACROSS * 3);
      const col = new Float32Array(n * VIAL_ACROSS * 3);
      const idx = [];
      for (let i = 0; i < cells; i++) {
        for (let k = 0; k < VIAL_ACROSS - 1; k++) {
          const a = i * VIAL_ACROSS + k;
          const b = a + VIAL_ACROSS;
          idx.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
      // UVs matter here: the ripple normal map is what stops the surface reading as paint, and a
      // geometry with no UV attribute samples a single texel of it - which is exactly how the first
      // attempt came out looking like a flat green stripe. u runs across the channel, v along it in
      // board units, so the ripples keep their size whatever the trough's length.
      const uv = new Float32Array(n * VIAL_ACROSS * 2);
      for (let i = 0; i < n; i++) {
        const v = i * (len / cells) * 3.2;
        for (let k = 0; k < VIAL_ACROSS; k++) {
          uv[i * VIAL_ACROSS * 2 + k * 2] = k / (VIAL_ACROSS - 1);
          uv[i * VIAL_ACROSS * 2 + k * 2 + 1] = v;
        }
      }
      top.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      top.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      top.setAttribute('color', new THREE.BufferAttribute(col, 3));
      top.setIndex(idx);
      const surface = new THREE.Mesh(top, assets.liquid);
      surface.name = `lid-liquid-surface-${spec.id}`;
      surface.frustumCulled = false;

      // The wall of liquid along the channel's inboard face, so the trough has depth from a
      // raking view instead of being a painted strip.
      const body = new THREE.BufferGeometry();
      const bpos = new Float32Array(n * 2 * 3);
      const bidx = [...idx];
      body.setAttribute('position', new THREE.BufferAttribute(bpos, 3));
      body.setIndex(bidx);
      const face = new THREE.Mesh(body, assets.liquidBody);
      face.name = `lid-liquid-body-${spec.id}`;
      face.frustumCulled = false;

      // --- the instant indicator: one solid bar per trough ----------------------
      //  Same length in every trough, so the four bars read as four copies of one scale. It is a
      //  machined slug of brass sitting in the channel: no liquid, nothing to settle, and its
      //  position is recomputed from the board's tilt every frame.
      const barGeom = new THREE.BoxGeometry(along ? BAR_LEN : VIAL_WIDTH * 0.72, BAR_H, along ? VIAL_WIDTH * 0.72 : BAR_LEN);
      const bar = new THREE.Mesh(barGeom, assets.bar.clone()); // own material: its glow is its own
      bar.name = `lid-bar-${spec.id}`;
      bar.position.set(along ? mid : spec.at, floorY + 0.012 + BAR_H / 2, along ? spec.at : mid);
      bar.receiveShadow = true;
      // The soft edge: a feathered glow lying on the channel floor just under the slug's own base,
      // wider than the slug and stretched along the channel. The box's cut edges are hidden inside
      // it, so what the eye reads is a light with no boundary rather than a bright rectangle - the
      // softness a bloom pass would give, put there by the texture instead. It is registered with
      // the bar so it travels with it and hides with it in liquid mode. The slug's own borders are
      // feathered as well (see assets.bar), so the two together give a light that simply stops.
      const halo = new THREE.Mesh(
        // Stretched along the channel and exactly the channel's width across it, so the glow stays
        // inside the trough: a wider halo would spill over the rail onto the collar and read as a
        // second, misplaced light rather than as spill around the slug.
        new THREE.PlaneGeometry(along ? BAR_LEN * 1.7 : VIAL_WIDTH, along ? VIAL_WIDTH : BAR_LEN * 1.7),
        new THREE.MeshBasicMaterial({
          map: softGlowTexture(),
          color: 0xff2a12,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      halo.name = `lid-bar-halo-${spec.id}`;
      halo.rotation.x = -Math.PI / 2;
      halo.position.set(along ? mid : spec.at, floorY + 0.014, along ? spec.at : mid);
      // A centre notch in the channel floor: without a fixed mark, "where the bar is" has nothing
      // to be read against.
      const notch = new THREE.Mesh(new THREE.BoxGeometry(along ? 0.05 : VIAL_WIDTH, 0.012, along ? VIAL_WIDTH : 0.05), assets.iron);
      notch.position.set(along ? mid : spec.at, floorY + 0.014, along ? spec.at : mid);
      notch.name = `lid-bar-mark-${spec.id}`;
      group.add(halo, bar, notch);
      bars.set(spec.id, { spec, bar, halo, cells, floorY });

      group.add(surface, face);
      liquids.set(spec.id, { spec, surface, face, cells, dx: len / cells, floorY });
    }

    // --- the track: one continuous scale around all four sides ----------------
    //  It used to be four separate liner strips, one per channel, which left the corners to the
    //  collar with the strips simply stopping short of them. A single ring run along the four
    //  channel centrelines turns each corner under the collar's own corner, so the scale reads as
    //  one instrument rather than four pieces, and the turn is eased rather than mitred.
    //  Read the channel's inset from the edge back out of the layout rather than re-deriving it,
    //  so the track and the troughs cannot drift apart. `at` is measured from whichever edge the
    //  side sits on, hence the absolute value.
    const sideAt = (id) => specs.find((s) => s.id === id).at;
    const insetX = level.w / 2 - Math.abs(sideAt('right'));
    const insetZ = level.h / 2 - Math.abs(sideAt('far'));
    const halfX = level.w / 2 - insetX;
    const halfZ = level.h / 2 - insetZ;
    //  Outward of the centreline is the +W/2 loop (nearer the device's edge), inward is -W/2.
    const trackShape = new THREE.Shape();
    loopsToPath(roundedRectLoop(halfX + VIAL_WIDTH / 2, halfZ + VIAL_WIDTH / 2, TRACK_CORNER_R + VIAL_WIDTH / 2), trackShape);
    const trackHole = new THREE.Path();
    loopsToPath(
      roundedRectLoop(halfX - VIAL_WIDTH / 2, halfZ - VIAL_WIDTH / 2, Math.max(0, TRACK_CORNER_R - VIAL_WIDTH / 2)).reverse(),
      trackHole,
    );
    trackShape.holes.push(trackHole);
    const trackGeo = new THREE.ExtrudeGeometry(trackShape, { depth: 0.012, bevelEnabled: false, curveSegments: 4 });
    trackGeo.rotateX(-Math.PI / 2);
    trackGeo.translate(0, floorY, 0);
    const track = new THREE.Mesh(trackGeo, assets.liner);
    track.name = 'lid-vial-track';
    track.receiveShadow = true;
    group.add(track);

    return { group, liquids, bars, caps };
  }

  /**
   * Place the bars from the board's tilt, and show whichever indicators are wanted.
   *
   * This runs every frame off `world.tilt`, never off the liquid's simulation state: that is what
   * "instant" means here. The liquid's own meshes are stepped by physics, not by this.
   */
  function updateIndicators(world) {
    const v = lid?.vials;
    if (!v) return;
    const mode = indicatorMode(TUNING.indicator);
    const showBars = mode === 'bars' || mode === 'both';
    const showLiquid = mode === 'liquid' || mode === 'both';
    for (const [id, entry] of v.liquids) {
      entry.surface.visible = showLiquid;
      entry.face.visible = showLiquid;
    }
    // The trough's end caps belong to the liquid only (they stop it running around a corner); in
    // bars mode they are in the way of the track's own turn, so they go with the liquid.
    if (v.caps) for (const cap of v.caps) cap.visible = showLiquid;
    for (const [id, entry] of v.bars) {
      entry.bar.visible = showBars;
      if (entry.halo) entry.halo.visible = showBars;
      if (!showBars) continue;
      const vial = world.vials?.find((x) => x.id === id);
      if (!vial) continue;
      const { frac, centre } = barEntry(vial, world.tilt);
      const along = entry.spec.axis === 'x';
      entry.bar.position.set(along ? centre : entry.spec.at, entry.floorY + 0.012 + BAR_H / 2, along ? entry.spec.at : centre);
      // The halo slides with the slug, but does not lean with it: it is light on the channel floor,
      // and the floor does not lean.
      if (entry.halo) entry.halo.position.set(along ? centre : entry.spec.at, entry.floorY + 0.014, along ? entry.spec.at : centre);
      // The bar leans with the board: at hard tilt it visibly tilts, which is a second, purely
      // visual cue that the reading is live rather than drawn.
      const lean = Math.abs(frac) * 0.12 * Math.sign(frac || 1);
      if (along) entry.bar.rotation.z = -lean;
      else entry.bar.rotation.x = lean;
      // Only this bar's own glow changes, so the four cannot be confused for one another; the
      // material is shared, so the intensity is written per mesh. (Each bar needs its own material
      // for that, which is why they are cloned once at build time.) It is meant to read as its own
      // light rather than as a lit object: the silver track underneath is a bright metal, so a
      // gentle glow would read as a shadow on it. Still a lift at the stop rather than a switch.
      entry.bar.material.emissiveIntensity = 1.2 + Math.abs(frac) * 0.55;
    }
  }

  /** Rebuild one trough's liquid meshes from its simulation state. */
  function updateVial(vial, entry) {
    const { spec, surface, face, cells, dx, floorY } = entry;
    const along = spec.axis === 'x';
    const halfW = VIAL_WIDTH / 2;
    // The inboard edge: the side the liquid's body is visible from, facing the playfield.
    const faceAt = spec.at - spec.side * halfW;
    const sp = surface.geometry.attributes.position.array;
    const sc = surface.geometry.attributes.color.array;
    const fp = face.geometry.attributes.position.array;
    for (let i = 0; i <= cells; i++) {
      const t = spec.from + i * dx;
      const cell = Math.min(vial.cells - 1, i);
      const y = floorY + Math.max(0, vial.h[cell]);
      // The meniscus: liquid climbs the walls and sits lower across the middle, which is the shape
      // that says "wetted surface" rather than "flat panel". Cosmetic only - the simulation's own
      // depth is untouched, and this adds no volume.
      const yWall = y + Math.min(0.02, Math.max(0, vial.h[cell]) * 0.22);
      // Foam: where the liquid is moving hard, its surface whitens - which is what a splash looks
      // like from above, and the only cue that the sloshing is violent. The splash setting scales it.
      const foam = vialFoam(vial, i);
      const mix = 1 - foam;
      // Five rows across: the meniscus rises to each wall and dips through the middle, so the
      // specular highlight is a narrow band that moves with the tilt instead of a flat stripe.
      const a = i * VIAL_ACROSS * 3;
      for (let k = 0; k < VIAL_ACROSS; k++) {
        const f = k / (VIAL_ACROSS - 1); // 0 at the inboard wall, 1 at the rim side
        const across = spec.at - halfW + f * VIAL_WIDTH;
        const dip = Math.sin(Math.PI * f); // 0 at the walls, 1 in the middle
        const yy = yWall - dip * Math.min(0.022, Math.max(0, vial.h[cell]) * 0.25);
        if (along) {
          sp[a + k * 3] = t;
          sp[a + k * 3 + 1] = yy;
          sp[a + k * 3 + 2] = across;
        } else {
          sp[a + k * 3] = across;
          sp[a + k * 3 + 1] = yy;
          sp[a + k * 3 + 2] = t;
        }
        // Foam whitens the surface where the liquid is moving hard: that is what a splash looks
        // like from above, and the only cue that the sloshing is violent.
        sc[a + k * 3] = mix;
        sc[a + k * 3 + 1] = mix;
        sc[a + k * 3 + 2] = mix;
      }
      // The body of the liquid, on the inboard face only: a wall of liquid from the channel floor
      // up to the surface, so the trough has depth from a raking view. Its own buffer, its own
      // stride - writing it at the surface's stride put vertices at the origin and stretched a dark
      // green triangle across the playfield.
      const b = i * 6;
      if (along) {
        fp[b] = t; fp[b + 1] = yWall; fp[b + 2] = faceAt;
        fp[b + 3] = t; fp[b + 4] = floorY; fp[b + 5] = faceAt;
      } else {
        fp[b] = faceAt; fp[b + 1] = yWall; fp[b + 2] = t;
        fp[b + 3] = faceAt; fp[b + 4] = floorY; fp[b + 5] = t;
      }
    }
    surface.geometry.attributes.position.needsUpdate = true;
    surface.geometry.attributes.color.needsUpdate = true;
    face.geometry.attributes.position.needsUpdate = true;
    surface.geometry.computeVertexNormals();
    face.geometry.computeVertexNormals();
  }

  function updateVials(list) {
    if (!lid?.vials || !list) return;
    for (const vial of list) {
      const entry = lid.vials.liquids.get(vial.id);
      if (entry) updateVial(vial, entry);
    }
  }

  function buildLid(level, lidY) {
    const outline = outerOutline(level);
    if (!outline) return null;
    // The collar, lip and the screws that pin them down all sit on the device's outer skin, so
    // they follow the eased outline; the glass is offset from the same loop so the whole lid
    // eases together instead of the glass cornering inside a rounded collar.
    const outer = outline.rounded;
    const inner = insetLoop(outer, LID_BEZEL);
    if (!inner) return null;

    const root = new THREE.Group();
    root.name = 'lid';

    // The glass, inset by the collar width so the collar can clamp its edge.
    const glassShape = new THREE.Shape();
    loopsToPath(inner, glassShape);
    const gg = new THREE.ExtrudeGeometry(glassShape, {
      depth: LID_THICK,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.02,
      bevelSegments: 1,
      curveSegments: 4,
    });
    gg.rotateX(-Math.PI / 2);
    gg.translate(0, lidY, 0);
    const glass = new THREE.Mesh(gg, assets.glass);
    glass.name = 'lid-glass';
    const glassTop = lidY + LID_THICK;

    // The collar: a band standing on the rim wall (outer edge flush with the board outline),
    // topped by a lip that overhangs both ways - outward past the board edge, inward over the
    // glass - so the pane is visibly clamped from above rather than just floating in a hole.
    const collarBottom = WALL_H - 0.04;
    const lipY = glassTop + 0.03;
    // The collar's top face is the *floor* of the level troughs, not the finished top: the channel
    // is the band's own top, and the walls standing on it are what make it a trough. That is how a
    // channel in a real frame would be made, and it means the liquid sits on metal rather than on
    // a painted-looking recess.
    const troughFloorY = lipY - VIAL_FLOOR;
    const band = extrudedBand(outer, inner, collarBottom, troughFloorY, { bevel: 0.02 });
    const lipInner = insetLoop(outer, LID_BEZEL * 0.38) ?? inner;
    const lip = extrudedBand(insetLoop(outer, -0.07) ?? outer, lipInner, lipY, lipY + 0.08, { bevel: 0.015 });
    const collar = new THREE.Group();
    collar.name = 'lid-collar';
    for (const [geo, name] of [[band, 'lid-collar-band'], [lip, 'lid-collar-lip']]) {
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, assets.collar);
      mesh.name = name;
      mesh.receiveShadow = true;
      collar.add(mesh);
    }

    // Where the pane meets the collar, real glass shows a faint haze - the one place glass is
    // visible without a reflection. The bands sit over the rim wall by construction, never
    // over the playfield, so this can add glass without ever hiding a pit. Unlit on purpose:
    // a lighting change must not be able to alter what the hole check measures.
    const hazeMarks = [0.16, 0.34, 0.52, 0.72];
    const hazeAlphas = [0.34, 0.2, 0.09];
    hazeAlphas.forEach((alpha, i) => {
      const band = extrudedBand(
        insetLoop(outer, hazeMarks[i]),
        insetLoop(outer, hazeMarks[i + 1]),
        glassTop + 0.002,
        glassTop + 0.012,
        { bevel: 0 },
      );
      if (!band) return;
      const mesh = new THREE.Mesh(
        band,
        new THREE.MeshBasicMaterial({ color: 0xf2f8f8, transparent: true, opacity: alpha, depthWrite: false, side: THREE.DoubleSide }),
      );
      mesh.name = `lid-haze-${i}`;
      root.add(mesh);
    });

    // Screws along the lip, merged into one mesh: a frame with fixings all round is what
    // makes a lid look fitted instead of implied.
    const screwLine = insetLoop(outer, 0.05);
    const screws = screwLine ? screwsAlong(screwLine, 2.4, lipY + 0.08) : null;
    if (screws) {
      const mesh = new THREE.Mesh(screws, assets.iron);
      mesh.name = 'lid-screws';
      collar.add(mesh);
    }

    root.add(glass, collar);

    // --- the liquid level vials -------------------------------------------------
    //  Four troughs, one along each side, cut into the collar's exposed ledge (inboard of the lip,
    //  outboard of the glass). They are the second angle indicator: the etched rose says the glass
    //  is turning, the vials say how far and which way, because the liquid stays level in world
    //  space while the board tilts under it.
    const vials = buildVials(level, outer, inner, troughFloorY, lipY);
    if (vials) root.add(vials.group);

    // --- the grip: a small knob, and a compass rose etched around it ----------
    const grip = new THREE.Group();
    grip.name = 'lid-grip';
    grip.position.y = glassTop;

    // The knob has to read as a *raised* thing from a camera that is almost directly overhead.
    // Height is invisible from up there, so it is built out of what a top-down view can see: a
    // bright domed cap (its light gradient is what says "rounded"), a darker knurled band
    // around the base, a brass seating collar, and a real shadow on the glass. Its first
    // version was a dark low cylinder, and from above that read as a hole in the glass.
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(KNOB_R * 1.34, KNOB_R * 1.45, 0.07, 44), assets.brass);
    seat.name = 'knob-seat';
    seat.position.y = 0.035;
    const gripBand = new THREE.Mesh(new THREE.CylinderGeometry(KNOB_R * 0.86, KNOB_R, KNOB_H * 0.5, 44), assets.grip);
    gripBand.name = 'knob-band';
    gripBand.position.y = 0.07 + KNOB_H * 0.25;
    const domeTop = 0.07 + KNOB_H * 0.5;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(KNOB_R * 0.86, 44, 22, 0, Math.PI * 2, 0, Math.PI / 2), assets.brass);
    dome.name = 'knob-dome';
    dome.position.y = domeTop;
    dome.scale.y = 0.72;
    // one small dark detail at the very top, so the centre of the dial is marked
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.075, 0.035, 16), assets.dark);
    screw.name = 'knob-screw';
    screw.position.y = domeTop + KNOB_R * 0.86 * 0.72 - 0.006;
    grip.add(seat, gripBand, dome, screw);

    // The knob is the one lid part that casts a shadow, because that shadow is the cue that
    // makes a low nub read as raised from above. It is safe by measurement: the shadow lands
    // about 0.9 units from the centre, and the nearest hole edge is 2.1 units out.
    grip.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });

    root.add(grip);

    // The rose: thin concentric rings with cardinal and intercardinal points, sitting *inside*
    // the glass (ROSE_SINK below its top face) so the pane's own sheen passes over them. It is
    // flat geometry, so it costs nothing to draw and blocks almost nothing of the playfield -
    // and because it is fixed to the glass it reads the board's tilt at a glance.
    const rose = new THREE.Group();
    rose.name = 'lid-rose';
    // Every mesh is drawn before the pane so the sheet of glass reads as lying *over* the
    // engraving. Both are transparent and the pane is additive, so without this the order is
    // whichever the sort happens to produce, and the line would sometimes sit on top of the
    // reflection. (renderOrder is per-object in three - setting it on the group does nothing.)
    const ROSE_ORDER = -1;
    const design = roseDesign(level);
    const roseY = glassTop - ROSE_SINK;
    // A ring is drawn as a polygon, so its facet is a straight chord: `2*pi*r/segments` long. If
    // that chord is comparable to the line width, the ring stops reading as a circle and starts
    // reading as a faceted band - and the thinner the line, the worse it shows (a *thin* line of
    // long chords is a visibly segmented ring). At 148 segments a 1.92-unit ring has 0.08-unit
    // chords, more than twice the new 0.032 line width, so the count is chosen from the geometry
    // instead: enough segments that no facet exceeds half a line width.
    const flatRing = (radius, width) => {
      const segments = Math.min(2048, Math.max(148, Math.ceil((Math.PI * 2 * radius) / (width * 0.5))));
      const g = new THREE.RingGeometry(radius - width / 2, radius + width / 2, segments);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, assets.etch);
      m.name = 'rose-ring';
      m.position.y = roseY;
      m.renderOrder = ROSE_ORDER;
      return m;
    };
    // The outer ring is drawn a touch heavier: it is the edge of the dial, and it is what the
    // eye reads as "this is a scale, not a decoration". All three circles use ROSE_RING_LINE,
    // which is 25% thinner than the tick marks they share a material with.
    design.rings.forEach((r, i) => rose.add(flatRing(r, i === design.rings.length - 1 ? ROSE_RING_LINE * 1.4 : ROSE_RING_LINE)));

    // Tick marks at the eight compass points, tapering inward from the dial's edge. Shape space
    // is (x, -z) after the flattening rotation, so a tick built along +x lands at `angle`.
    for (const t of design.ticks) {
      const shape = new THREE.Shape();
      shape.moveTo(t.inner, -t.half);
      shape.lineTo(t.outer, 0);
      shape.lineTo(t.inner, t.half);
      shape.closePath();
      const g = new THREE.ShapeGeometry(shape);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, assets.etch);
      m.name = `rose-${t.kind}`;
      m.rotation.y = -t.angle;
      m.position.y = roseY;
      m.renderOrder = ROSE_ORDER;
      rose.add(m);
    }
    root.add(rose);

    // The lid never casts a shadow. That is a rule, not an oversight: a shadow band can
    // read as a hole, and the pits have to stay unmistakable from above.
    root.traverse((o) => {
      if (o.isMesh) o.castShadow = false;
    });
    root.add(grip);
    return {
      root,
      glass,
      grip,
      rose,
      vials,
      glassTop,
      knobTop: glassTop + 0.07 + KNOB_H * 0.5 + KNOB_R * 0.86 * 0.72,
      roseReach: design.reach,
      lidY,
    };
  }

  // ---------------------------------------------------------------------------
  //  Level lifecycle
  // ---------------------------------------------------------------------------

  function setLevel(nextLevel) {
    if (levelRoot) {
      //  Detach what belongs to the toy rather than to the level *before* the old root is torn
      //  down. The marble, its contact shadow and pool, and the particles are built once and
      //  kept; the disposal pass below would free their geometry, and re-parenting them into
      //  the new root is what keeps them on screen at all after a level change. (Level 1 was
      //  the only level for a long time, so nothing had ever exercised this.)
      for (const m of marbles) {
        for (const keep of [m.mesh, m.blob, m.pool]) {
          if (keep?.parent === levelRoot) levelRoot.remove(keep);
        }
      }
      if (particles?.points?.parent === levelRoot) levelRoot.remove(particles.points);
      boardGroup.remove(levelRoot);
      levelRoot.traverse((o) => {
        if (o.geometry && o.geometry !== undefined) o.geometry.dispose?.();
        //  Only materials a level built for itself (a button's own halo) are disposed; the shared
        //  `assets.*` materials are reused by the next level and must survive the switch.
        if (o.material?.userData?.owned) o.material.dispose?.();
      });
    }
    level = nextLevel;
    bounds = { w: level.w, h: level.h };

    levelRoot = new THREE.Group();
    board = buildBoard(level);
    obstacles = buildObstacles(level);
    levelRoot.add(board.root);
    levelRoot.add(obstacles.root);
    levelRoot.add(buildRamps(level.features.ramps ?? []));

    //  Match the marble set to this level's spawns: a level with two marbles gets two meshes,
    //  each with its own contact shadow and pool. They are built once and kept across level
    //  changes (only the count changes), the same way the single marble always was.
    const wantMarbles = level.spawns?.length ?? 1;
    while (marbles.length > wantMarbles) {
      const m = marbles.pop();
      m.mesh.removeFromParent();
      m.mesh.userData.dispose?.();
      m.blob.removeFromParent();
      m.pool.removeFromParent();
    }
    while (marbles.length < wantMarbles) {
      const mesh = buildMarble(marbleLookId);
      // One unit quad each, laid flat in the board's plane (normal up), scaled per frame in
      // sync(). Separate geometries, because a level change disposes the children's geometry.
      const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), assets.blob);
      blob.rotation.x = -Math.PI / 2;
      blob.scale.set(1.3, 1.3, 1);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), assets.pool);
      pool.rotation.x = -Math.PI / 2;
      pool.scale.set(1.9, 1.9, 1);
      marbles.push({ mesh, blob, pool, renderedY: 0 });
    }
    applyMarbleGlass();
    applyMarbleDials();
    if (!particles) particles = createParticles();

    //  The keeps are re-attached to *this* root every time, whichever one just built them.
    //  Adding an object to a new parent detaches it from the old one, so this is also the
    //  whole of the re-parenting.
    for (const m of marbles) {
      levelRoot.add(m.mesh);
      levelRoot.add(m.blob);
      levelRoot.add(m.pool);
    }
    levelRoot.add(particles.points);

    boardGroup.add(levelRoot);

    // The lid goes on last, and its height is derived from what is actually under it: the
    // glass must clear the tallest obstacle this level built, and the biggest marble the
    // tuner allows. A future level with a tall pendulum raises its own lid instead of
    // poking a bob through the glass.
    if (lid) {
      boardGroup.remove(lid.root);
      lid.root.traverse((o) => o.geometry?.dispose?.());
      lid = null;
    }
    const tallest = Math.max(localTop(board.root), localTop(obstacles.root));
    const lidY = Math.max(LID_Y, tallest + LID_CLEARANCE, BALL_R_MAX * 2 + 0.18);
    lid = buildLid(level, lidY);
    if (lid) boardGroup.add(lid.root);

    // shadow camera fitted to this board
    const reach = Math.max(level.w, level.h) * 0.9 + 4;
    key.shadow.camera.left = -reach;
    key.shadow.camera.right = reach;
    key.shadow.camera.top = reach;
    key.shadow.camera.bottom = -reach;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 60;
    key.shadow.camera.updateProjectionMatrix();
    key.position.set(level.w * 0.45, 18, level.h * 0.4 + 6);
    key.target.position.set(0, 0, 0);
    key.target.updateMatrixWorld();
    under.position.set(0, -1.9, 0);
    const tableY = -(maxBoardReach(level) * 0.55 + BOARD_THICK + 0.2);
    catcher.position.y = tableY;
    catcher.material.opacity = 0.42;
    table.position.y = tableY - 0.02;
    table.material.map.repeat.set(0.35, 0.35);

    // Camera framing for this board (see framingTarget).
    camRig = { pos: framingTarget(), look: new THREE.Vector3(0, 0, 0) };
    camera.position.copy(camRig.pos);
    camera.lookAt(camRig.look);
    shake = 0;
    introT = 0;
  }

  function maxBoardReach(level) {
    const a = Math.max(level.w, level.h) * 0.7;
    return a;
  }

  let introT = 0;

  // ---------------------------------------------------------------------------
  //  Per-frame sync
  // ---------------------------------------------------------------------------

  /**
   * Where the camera wants to be, for this board and this panel state. The single place the
   * framing is defined: the per-frame follow, the snap used by checks, and level load all come
   * through here, so a check can never measure a framing the player does not actually see.
   *
   * The distance is divided by VIEW_SIZE (the toy draws that much bigger) and by panelZoom
   * (which shrinks it just enough to stay whole in the space the tuning sheet leaves).
   */
  function framingTarget(zoomOut = 0, followX = 0, followZ = 0) {
    const span = Math.max(bounds.w, bounds.h);
    const k = 1 / (VIEW_SIZE * panelZoom);
    // One distance and one elevation, so "how big" and "from what angle" stay independent. The
    // distance is set for the lens: a narrower field of view needs to stand further back to
    // put the same picture on screen, which is exactly how the keystone gets flattened.
    const dist = (span * 1.55 + 9.2) * (1 + zoomOut);
    return new THREE.Vector3(
      followX * 0.6,
      dist * Math.cos(VIEW_ELEV),
      dist * Math.sin(VIEW_ELEV) + followZ * 0.55,
    ).multiplyScalar(k);
  }

  function sync(world, dt, fx = {}) {
    // The liquid is simulation state, so the meshes are rebuilt from it rather than animated;
    // the bars are not state at all and are placed from the tilt.
    updateVials(world.vials);
    updateIndicators(world);
    const ball = world.ball;
    boardGroup.rotation.x = world.tilt.x;
    boardGroup.rotation.z = -world.tilt.z;

    const radius = TUNING.ballR;
    //  Pose every marble on the board. `world.balls` and the built `marbles` are created in the
    //  same order from the same spawn list, so the index pairs them.
    const balls = world.balls ?? [world.ball];
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      const view = marbles[i];
      if (!view) continue;
      view.mesh.scale.setScalar(radius);
      //  Rolling off the crest of a ramp is a real drop off its tall face, and the ground under
      //  the marble goes from the wedge height to the board in a single physics step. Easing the
      //  marble *down* (and never up, or a marble climbing the slope would sink into it) turns
      //  that into the short fall it actually is, with the contact shadow already on the ground
      //  below it. `dt <= 0` means a caller asked for an exact pose (the smoke test does).
      if (dt > 0 && b.state === 'roll' && !b.air && b.y < view.renderedY - 1e-4) {
        view.renderedY = Math.max(b.y, view.renderedY - Math.max(2.2, (view.renderedY - b.y) * 14) * dt);
      } else {
        view.renderedY = b.y;
      }
      view.mesh.position.set(b.x, view.renderedY + radius, b.z);
      view.mesh.rotation.x = b.spin[0];
      view.mesh.rotation.z = b.spin[2];
      //  An embedded core may keep its own motion: the helix and the gem turn slowly, the
      //  lantern's lamp pulses, and the bitcoin mark is held level so it stays readable while the
      //  glass rolls around it. That one needs the marble's own orientation, which is why the
      //  pose is handed in.
      view.mesh.userData.tick?.(world.time, view.mesh);

      //  The contact shadow sits on the terrain under the marble - the board or the wedge - never
      //  on the marble itself, which is why the engine keeps `groundY` apart from `ball.y`. A
      //  marble dropped *below* its ground (down a pit or the cup) fades its shadow out; a marble
      //  in the air keeps it, shrunk a little, with the gap between them reading as the height.
      const ground = Math.max(0, b.groundY ?? b.y);
      const drop = Math.max(0, ground - b.y);
      const air = Math.max(0, b.y - ground);
      view.blob.position.set(b.x, ground + 0.016, b.z);
      view.pool.position.set(b.x, ground + 0.03, b.z);
      const shrink = Math.max(0.25, 1 - drop * 0.5 - air * 0.25) * (radius / BALL_R);
      view.blob.scale.set(1.3 * shrink, 1.3 * shrink, 1);
      view.blob.material.opacity = 0.95 * Math.max(0.25, 1 - drop * 0.5 - air * 0.2);
      view.pool.scale.set(1.9 * shrink, 1.9 * shrink, 1);
      view.pool.material.opacity = 0.22 * Math.max(0.25, 1 - drop * 0.5 - air * 0.2);
    }
    //  Only worth sizing while something actually transmits; without a glass marble three skips the
    //  pass entirely, so this is one projection per frame at worst. Both marbles share one buffer,
    //  so it is sized to the largest footprint on screen.
    if (hasGlassMarble) updateTransmissionScale();

    //  Obstacles are posed from the **live** feature list on the world, never from the level
    //  spec the meshes were built from. `makeWorld` clones the features, so the spec's `angle`
    //  stays at its authored zero forever while the engine turns the clone: reading the spec
    //  here drew windmills, pendulums and sliding bars frozen at rest while physics swung them,
    //  which is a moving hazard the player cannot see. The arrays are in the same order —
    //  `buildObstacles` maps them one for one — so the index *is* the pairing.
    const live = world.features ?? level.features;
    for (let i = 0; i < obstacles.windmills.length; i++) {
      const w = obstacles.windmills[i];
      const def = live.windmills[i];
      if (!def) continue;
      //  The arm is built along local +Z, and the engine's angle is measured in (x, z) as
      //  (cos, sin): a rotation about Y by `pi/2 - angle` sends +Z to exactly that direction.
      //  (`-angle`, which is what this used to be, draws every arm a quarter turn out.)
      w.mesh.rotation.y = Math.PI / 2 - def.angle;
    }
    for (let i = 0; i < obstacles.pendulums.length; i++) {
      const def = live.pendulums[i];
      if (def) obstacles.pendulums[i].mesh.rotation.y = def.angle;
    }
    for (let i = 0; i < obstacles.movers.length; i++) {
      const m = obstacles.movers[i];
      const def = live.movers[i];
      if (!def) continue;
      const pos = def.pos ?? def.from;
      m.mesh.position.set(pos[0], 0.17, pos[1]);
      const dx = def.to[0] - def.from[0];
      const dz = def.to[1] - def.from[1];
      const l = Math.hypot(dx, dz) || 1;
      m.mesh.rotation.y = Math.atan2(-(dx / l), -(dz / l)) + Math.PI / 2;
    }
    for (let i = 0; i < obstacles.plates.length; i++) {
      //  A plate reads as pressed from the plate itself, not from a gate's timer: a plate that
      //  drives a lift (or nothing at all) still lights when a marble is standing on it.
      const def = live.plates[i];
      if (!def) continue;
      const st = def.gate ? world.gates.find((g) => g.id === def.gate) : null;
      const open = !!def.pressed || !!st?.open;
      const plate = obstacles.plates[i];
      //  The cap sinks a hair under the marble, and a soft ring lights around the seat, so a held
      //  button reads even when the marble standing on it hides the cap itself.
      const capWant = open ? plate.capY - BUTTON_TRAVEL : plate.capY;
      plate.cap.position.y += (capWant - plate.cap.position.y) * Math.min(1, dt * 30);
      const haloWant = open ? 0.5 : 0;
      plate.halo.material.opacity += (haloWant - plate.halo.material.opacity) * Math.min(1, dt * 18);
    }
    //  Lifts: the slab's height is the engine's own, so the wall is exactly where the marble
    //  collides with it, and you can watch it climb out of its slot or sink back into the floor.
    //  Fully retracted it sits just under the board, so at rest there is nothing but the kerf.
    for (let i = 0; i < obstacles.lifts.length; i++) {
      const def = live.lifts?.[i];
      if (!def) continue;
      const l = obstacles.lifts[i];
      const want = l.downY + (l.upY - l.downY) * Math.min(1, Math.max(0, def.height ?? 0));
      l.slab.position.y += (want - l.slab.position.y) * Math.min(1, dt * 22);
    }
    for (const pad of obstacles.pads) {
      pad.mesh.rotation.y = world.time * 0.8;
      pad.halo.material.opacity = 0.25 + 0.25 * Math.sin(world.time * 3);
    }
    for (let i = 0; i < obstacles.gates.length; i++) {
      const st = world.gates[i];
      const want = st.open ? obstacles.gates[i].openY : obstacles.gates[i].closedY;
      obstacles.gates[i].bar.position.y += (want - obstacles.gates[i].bar.position.y) * Math.min(1, dt * 12);
    }
    if (board?.movingWells?.length) {
      for (let i = 0; i < board.movingWells.length; i++) {
        const well = board.movingWells[i];
        const pit = world.pits.find((p) => p.i === well.def.index);
        if (pit) well.mesh.position.set(pit.x, 0, pit.z);
      }
    }
    if (board.beltMesh) {
      board.beltMesh.material.map.offset.x += dt * 0.35;
    }
    if (board.goalRun) {
      // One lap of the rim, with the light breathing as it goes: bright enough to read as a lamp on
      // the brass, and quick enough to catch the eye without becoming an alarm. Read straight off
      // `world.time` rather than accumulated, so the light is where the clock says it is whatever
      // frame rate the board is running at - and so a headless check can pose it exactly.
      board.goalRun.rotation.z = world.time * GOAL_LAP_RATE;
      const lap = board.goalRun.children[0];
      if (lap) lap.material.opacity = GOAL_LAP_BASE + GOAL_LAP_PULSE * Math.sin(world.time * GOAL_LAP_BREATH);
    }

    if (freeCamera) {
      updateParticles(particles, dt);
      return;
    }

    // camera: eased follow with a little rope so fast rolls feel fast
    introT = Math.min(1, introT + dt * 0.7);
    const ease = 1 - Math.pow(1 - introT, 3);
    // The camera barely follows the marble now. With a near-top-down view, aiming off-centre
    // turns the board's outline into an asymmetric quad, which reads as a board that is tilted
    // when it is level - and at level 1 the marble *starts* in a corner, so that was the view
    // you got at rest. A small fraction keeps a hint of life without that cost: the view tips
    // by under two degrees, which is a couple of pixels on the outline.
    const follow = 0.14;
    const wantX = ball.x * follow;
    const wantZ = ball.z * follow;
    const zoomOut = (1 - ease) * 1.5 + 0.35 * (fx.winPulse ?? 0);
    const targetPos = framingTarget(zoomOut, wantX, wantZ);
    const lerpRate = fx.snapCamera ? 1 : Math.min(1, dt * 2.6);
    camera.position.lerp(targetPos, lerpRate);
    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake;
      shake = Math.max(0, shake - dt * 1.4);
    }
    camera.lookAt(wantX * 0.85, 0, wantZ * 0.85);

    if (fx.bump) {
      const [bx, bz] = [fx.bump.x, fx.bump.z];
      spawnParticles(particles, bx, 0, bz, fx.bump.hard ? 14 : 7, fx.bump.power * 1.6, 1.2, [1, 0.88, 0.6]);
      shake = Math.min(0.09, (fx.bump.hard ? 0.05 : 0.02) * fx.bump.power + shake * 0.5);
    }
    if (fx.dust) {
      spawnParticles(particles, fx.dust.x, 0, fx.dust.z, 18, 1.1, 1.4, [0.75, 0.62, 0.45]);
    }
    if (fx.spark) {
      spawnParticles(particles, fx.spark.x, 0, fx.spark.z, 26, 2.0, 2.0, [0.6, 0.9, 1]);
    }
    if (fx.teleport) {
      spawnParticles(particles, fx.teleport.x, 0, fx.teleport.z, 22, 1.4, 1.8, [0.4, 1, 1]);
    }
    updateParticles(particles, dt);
  }

  function render() {
    // A softbox resize that was deferred while the slider was moving lands here, once the hand
    // has paused for a moment.
    if (envPending && performance.now() - envBuiltAt > 90) {
      envPending = false;
      setEnvSize(appliedSize);
    }
    renderer.render(scene, camera);
  }

  // The tuning panel is a sheet over the right of the window, so while it is open the toy has
  // to be centred in what is left rather than in the window. A camera view offset is exactly
  // a lens shift: the frustum window slides sideways at the same field of view, so the board
  // moves without changing size.
  let sideShift = 0;
  // How much the framing shrinks while the sheet is open, so the whole toy still fits.
  let panelZoom = 1;

  /**
   * The meshes' bounding box in board-local space: this is what is actually on screen, taken
   * from the geometry rather than hand-modelled. Sprites and points are effects, not toy, so
   * they are left out - a cloud of sparks drifting off the edge is not part of the board.
   */
  function toyBox() {
    boardGroup.updateMatrixWorld(true);
    const toLocal = new THREE.Matrix4().copy(boardGroup.matrixWorld).invert();
    const m = new THREE.Matrix4();
    const box = new THREE.Box3();
    const piece = new THREE.Box3();
    boardGroup.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      o.geometry.computeBoundingBox();
      m.multiplyMatrices(toLocal, o.matrixWorld);
      piece.copy(o.geometry.boundingBox).applyMatrix4(m);
      box.union(piece);
    });
    return box;
  }

  /** The corners of what is on screen, in board space, padded a hair. */
  function toyCorners() {
    const box = toyBox();
    if (box.isEmpty()) return [];
    const pad = 0.05;
    const x0 = box.min.x - pad;
    const x1 = box.max.x + pad;
    const y0 = Math.max(0, box.min.y - pad);
    const y1 = box.max.y + pad;
    const z0 = box.min.z - pad;
    const z1 = box.max.z + pad;
    const out = [];
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) out.push([x, y, z]);
    return out;
  }

  function toyReach() {
    const corners = toyCorners();
    const v = new THREE.Vector3();
    const rotX = boardGroup.rotation.x;
    const rotZ = boardGroup.rotation.z;
    let reach = 0;
    // Every corner of the tilt stops: the board leans toward the camera at full tilt, which is
    // when it is widest on screen. Measuring only the pose it happens to be in would let a
    // tilted board slide off the edge a moment later.
    for (const t of [-MAX_TILT, 0, MAX_TILT]) {
      for (const u of [-MAX_TILT, 0, MAX_TILT]) {
        boardGroup.rotation.x = t;
        boardGroup.rotation.z = u;
        boardGroup.updateMatrixWorld(true);
        camera.updateMatrixWorld(true);
        for (const [x, y, z] of corners) {
          v.set(x, y, z);
          boardGroup.localToWorld(v);
          v.project(camera);
          reach = Math.max(reach, Math.abs(v.x));
        }
      }
    }
    boardGroup.rotation.x = rotX;
    boardGroup.rotation.z = rotZ;
    boardGroup.updateMatrixWorld(true);
    return reach;
  }

  function applyViewShift() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if (!sideShift) {
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
      return;
    }
    // Same size, same field of view: only the window slides.
    camera.setViewOffset(w, h, sideShift, 0, w, h);
    camera.updateProjectionMatrix();
  }

  /**
   * Centre the toy in the space left of a panel `panelPx` wide on the right of the window.
   *
   * The shift itself is always half the covered strip - the toy goes exactly in the middle of
   * what is left. What gives instead is the size: the toy is wider than a sheet leaves on a
   * laptop screen once the board is tilted hard, and the corners of a tilted board are real
   * geometry that the player has to be able to see. So the framing backs off just far enough
   * for the whole toy to fit, at any tilt, inside the gap - and no further.
   */
  function setSideShift(panelPx) {
    const w = canvas.clientWidth || window.innerWidth;
    if (!panelPx) {
      panelZoom = 1;
      sideShift = 0;
      reposition();
      return 0;
    }
    const wanted = (panelPx + PANEL_GUTTER) / 2;
    panelZoom = 1;
    sideShift = 0;
    reposition();
    const reach = toyReach(); // worst case over the tilt stops, at the current zoom
    const available = Math.max(0, w / 2 - wanted - 24); // 24 px clear, enough for the follow
    panelZoom = Math.min(1, Math.max(0.55, available / (reach * (w / 2))));
    sideShift = wanted;
    reposition();
    return sideShift;
  }

  /** Put the camera where the framing says it should be, and re-apply the lens shift. */
  function reposition() {
    frameBoard(true);
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    applyViewShift(); // the shift is in pixels, so it has to be re-applied on a resize
  }

  function frameBoard(snap = false) {
    introT = snap ? 1 : introT;
    camera.position.copy(framingTarget());
    camera.lookAt(0, 0, 0);
    applyViewShift();
  }

  function dispose() {
    for (const m of marbles) m.mesh.userData.dispose?.();
    renderer.dispose();
    envRT?.dispose?.();
    pmrem.dispose?.();
  }

  /**
   * Push the tuning sheet's glass dials onto the marble that is on the board.
   *
   * Cheap enough to call on every change: it is a handful of numbers on two materials plus the
   * core's scale. `marbleFill` scales the embedded core in place, which is what makes "how much
   * solid is in there" a live control instead of a rebuild.
   */
  function applyMarbleGlass() {
    const transparency = TUNING.marbleTransparency ?? 1;
    const bend = TUNING.marbleBend ?? 1;
    const fill = TUNING.marbleFill ?? 1;
    let glass = false;
    for (const m of marbles) {
      m.mesh.traverse((o) => {
        const base = o.material?.userData?.glassBase;
        if (!base) return;
        o.material.transmission = Math.min(1, base.transmission * transparency);
        o.material.thickness = base.thickness * bend;
        if (o.material.transmission > 0) glass = true;
      });
      m.mesh.userData.core?.scale.setScalar(fill);
    }
    //  The cat's-eye is painted, so it never sets this, and three never runs the transmission pass
    //  for it - which is the whole reason a player on the shipped marble pays nothing for this.
    hasGlassMarble = glass;
  }

  /**
   * The lamp and band dials.
   *
   * Kept apart from `applyMarbleGlass` because they answer different questions: the glass dials
   * change how the *shell* is made, these change what is inside it. Both run on every marble edit,
   * and both are no-ops on a marble that has nothing to move - which is why the lantern's sliders
   * are safe to leave in place while the cat's-eye is on the board.
   */
  function applyMarbleDials() {
    for (const m of marbles) {
      applyLampDials(m.mesh, {
        brightness: TUNING.marbleLampBrightness ?? 1,
        hueDegrees: TUNING.marbleLampHue ?? LAMP_HUE_DEGREES,
      });
      applyBandDials(m.mesh, {
        contrast: TUNING.marbleBandContrast ?? 1,
        count: TUNING.marbleBandCount ?? 5,
        width: TUNING.marbleBandWidth ?? 0.42,
      });
      applyTintDials(m.mesh, { color: TUNING.marbleSolidColor ?? '#15171d' });
    }
  }

  /**
   * Switch the marble's embedded lamp off, so a check can measure what it adds to the board.
   */
  function setMarbleLamp(on) {
    for (const m of marbles) m.mesh.userData.lampOff = !on;
    return marbles[0]?.mesh.userData.lampOff !== true;
  }

  /**
   * Swap which marble is on the board, keeping its pose and parent.
   *
   * The look is a *tuning* choice, so it can change while the marble is mid-run; rebuilding in
   * place (rather than rebuilding the scene) is what keeps the ball where the physics has it.
   * Returns the id actually built, which is the design's own id rather than the request, so a
   * caller can trust the fallback without having to know it.
   */
  function setMarbleLook(id) {
    const next = designById(id).id;
    if (!marbles.length || next === marbleLookId) return marbleLookId;
    for (const m of marbles) {
      const parent = m.mesh.parent;
      const renderedY = m.renderedY;
      m.mesh.removeFromParent();
      m.mesh.userData.dispose?.();
      m.mesh = buildMarble(next);
      m.renderedY = renderedY;
      if (parent) parent.add(m.mesh);
    }
    marbleLookId = next;
    applyMarbleGlass();
    applyMarbleDials();
    //  The pose lands on the next sync(); a caller that wants it now can call sync(world, 0).
    return marbleLookId;
  }

  /**
   * Size the transmission buffer to the marble's actual footprint on screen.
   *
   * The arithmetic collapses nicely: `transmissionResolutionScale` is a fraction of the drawing
   * buffer, and the marble's projected diameter is a fraction of that buffer too, so the required
   * scale is simply the projected diameter in NDC units times the oversample - no dependence on
   * resolution, window size, field of view or camera distance, because they cancel. What is left
   * is one projection of one point, per frame.
   *
   * Projected rather than assumed, because the follow camera's distance changes: the same marble
   * is a different number of pixels away from the camera than under it. Quantised, because
   * changing the size reallocates the buffer; rounded up, so it is never undersized.
   */
  const _projCentre = new THREE.Vector3();
  const _projEdge = new THREE.Vector3();
  const _camRight = new THREE.Vector3();
  let marbleNdc = 0; // the marble's projected diameter last frame, for the check that reads this
  function updateTransmissionScale() {
    let diameterNdc = 0;
    const e = camera.matrixWorld.elements;
    _camRight.set(e[0], e[1], e[2]);
    for (const m of marbles) {
      _projCentre.copy(m.mesh.position).project(camera);
      //  One marble-radius to the camera's *right*, projected the same way: the distance between
      //  the two projected points is the marble's radius in NDC, and NDC spans exactly the width.
      _projEdge.copy(m.mesh.position).addScaledVector(_camRight, TUNING.ballR).project(camera);
      diameterNdc = Math.max(diameterNdc, Math.hypot(_projEdge.x - _projCentre.x, _projEdge.y - _projCentre.y));
    }
    marbleNdc = diameterNdc;
    const next = transmissionBufferScale(diameterNdc, TRANSMISSION_MAX_BY_TIER[tier]);
    if (next === transmissionScale) return transmissionScale;
    transmissionScale = next;
    renderer.transmissionResolutionScale = next;
    return transmissionScale;
  }

  setLevel(level);
  resize();

  const pickRay = new THREE.Raycaster();

  return {
    renderer,
    scene,
    camera,
    setQuality,
    /** Apply the lighting sliders: diffuse scales the direct lights, reflection scales the environment. */
    applyLighting,
    /**
     * Rebuild the board's timber from the tuning sheet's finish and grain prominence. This is the
     * expensive one of the two look controls - five surfaces' worth of maps - so the caller
     * debounces it; it returns how long it took, in milliseconds.
     */
    applyBoardFinish,
    /** Slide the view sideways so the toy centres in the space left of a side panel. */
    setSideShift,
    /** The corners of what is on screen, so a check can measure the same thing the shift uses. */
    toyExtent: toyCorners,
    /** Where the shift ended up, in pixels. */
    get sideShift() {
      return sideShift;
    },
    /**
     * Is this pointer position over the grip? The UI uses it to show a grab cursor, which
     * is how the player finds out that the handle is the thing you move.
     */
    overHandle(ndcX, ndcY) {
      if (!lid) return false;
      pickRay.setFromCamera({ x: ndcX, y: ndcY }, camera);
      return pickRay.intersectObject(lid.grip, true).length > 0;
    },
    /**
     * Reaching for the grip gives it a faint warm lift, like a hand taking the light. It is
     * the only feedback needed to say "this is the part you hold".
     */
    setHandleHover(on) {
      assets.grip.emissive.setHex(on ? 0x2b1d09 : 0x000000);
    },
    /**
     * The vials as the renderer built them: the meshes and where the liquid surface sits. Checks
     * use this to measure the thing the player sees rather than the simulation's own numbers.
     */
    get vials() {
      if (!lid?.vials) return null;
      return {
        floorY: lid.vials.liquids.values().next().value?.floorY ?? 0,
        troughs: [...lid.vials.liquids.values()].map((e) => ({
          id: e.spec.id,
          axis: e.spec.axis,
          at: e.spec.at,
          from: e.spec.from,
          to: e.spec.to,
          surfaceMesh: e.surface.name,
          bodyMesh: e.face.name,
        })),
      };
    },
    /** The instant indicator's bars: where each one is, and how far it can travel. */
    get bars() {
      if (!lid?.vials) return null;
      return [...lid.vials.bars.values()].map((e) => ({
        id: e.spec.id,
        axis: e.spec.axis,
        visible: e.bar.visible,
        topY: +(e.floorY + 0.012 + BAR_H).toFixed(3),
        length: +(e.spec.axis === 'x' ? e.bar.geometry.parameters.width : e.bar.geometry.parameters.depth).toFixed(3),
        travel: +barEntry({ ...e.spec, length: e.spec.to - e.spec.from }, { x: 0, z: 0 }).travel.toFixed(3),
        x: +e.bar.position.x.toFixed(3),
        z: +e.bar.position.z.toFixed(3),
      }));
    },
    /** Where in the world a vial's liquid surface is, for a pixel probe. */
    vialProbePoint(id, along = 0) {
      const entry = lid?.vials?.liquids.get(id);
      if (!entry) return null;
      const t = entry.spec.from + (entry.spec.to - entry.spec.from) * ((along + 1) / 2);
      const m = entry.surface.geometry.attributes.position.array;
      // Read the mesh's own surface height at the nearest cross-section: the middle of the ribbon's
      // five rows, which is where the meniscus dips to.
      const i = Math.max(0, Math.min(entry.cells, Math.round((t - entry.spec.from) / entry.dx)));
      const midRow = Math.floor(VIAL_ACROSS / 2);
      const y = m[i * VIAL_ACROSS * 3 + midRow * 3 + 1];
      return entry.spec.axis === 'x' ? [t, y, entry.spec.at] : [entry.spec.at, y, t];
    },
    /**
     * The goal's lap light: where round the ring it is, how bright, how high it sits, and its
     * world-space direction - plus the two rates, so a check poses the crest and the trough from the
     * scene rather than from a remembered number.
     *
     * The direction is the glow's own centre carried through the mesh's world matrix, not a guess
     * from the pivot's Euler angle: a sign error between the pivot's rotation and board coordinates
     * is invisible in the numbers and would silently aim a pixel probe at the wrong side of the rim.
     */
    get goalRim() {
      if (!board?.goalRun) return null;
      const lap = board.goalRun.children[0];
      if (!lap) return null;
      // Board-local, not scene-world: the pivot's own rotation carries the glow, and the board's own
      // tilt is a separate transform that must not leak into the direction the probe is aimed along.
      // Only the pivot's *rotation* is applied to the glow's own offset, so the result is a direction
      // from the ring's centre rather than a point that still carries the goal's position.
      const rot = new THREE.Matrix4().makeRotationFromEuler(board.goalRun.rotation);
      const p = lap.position.clone().applyMatrix4(rot);
      const dx = p.x;
      const dz = p.z;
      const len = Math.hypot(dx, dz) || 1;
      return {
        angle: +board.goalRun.rotation.z.toFixed(4),
        opacity: +lap.material.opacity.toFixed(4),
        radius: GOAL_LAP_R,
        y: +(GOAL_LAP_Y + GOAL_LAP_H).toFixed(3),
        lapRate: GOAL_LAP_RATE,
        breathRate: GOAL_LAP_BREATH,
        dirX: +(dx / len).toFixed(4),
        dirZ: +(dz / len).toFixed(4),
      };
    },
    /** Where the lid ended up, so checks can assert the glass clears the playfield. */
    get lid() {
      return lid
        ? { y: lid.lidY, glassTop: lid.glassTop, knobTop: lid.knobTop, knobR: KNOB_R, roseReach: lid.roseReach }
        : null;
    },
    setFreeCamera(on) {
      freeCamera = !!on;
    },
    /**
     *  Show or hide the whole lid - the pane, its haze sheets, the collar, the vials and the grip.
     *
     *  The pane is additive, so it lifts every dark region of the board by a veil; a check that
     *  wants to know how dark a hole is has to look at the board and not at the board seen through
     *  a pane. Measured 2026-09-20: with the lid drawn, a pit that is five times darker than the
     *  floor read 63 against a floor of 114, which failed the hole check on a 1% miss; with the lid
     *  hidden the same pit reads 10 against a floor of 87. Settled, the veil is worth about +16 at
     *  the board's centre, and much more while the haze is still fading in, which is what makes the
     *  failure intermittent.
     */
    setLidVisible(on) {
      if (lid && lid.root) lid.root.visible = !!on;
      return !!on;
    },
    get lidVisible() {
      return !!(lid && lid.root && lid.root.visible);
    },
    /**
     * Read the actual rendered pixels around board-local points. This is how the browser
     * check proves that a hole looks like a hole instead of trusting the scene graph.
     */
    sampleLuminance(points, half = 5) {
      renderer.render(scene, camera);
      const gl = renderer.getContext();
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      const v = new THREE.Vector3();
      return points.map(([x, y, z]) => {
        v.set(x, y, z);
        boardGroup.localToWorld(v);
        v.project(camera);
        const px = Math.round((v.x * 0.5 + 0.5) * size.x);
        const py = Math.round((1 - (v.y * 0.5 + 0.5)) * size.y);
        const side = half * 2 + 1;
        const buf = new Uint8Array(side * side * 4);
        gl.readPixels(
          Math.max(0, px - half),
          Math.max(0, size.y - py - half),
          side,
          side,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          buf,
        );
        let sum = 0;
        let min = 255;
        let max = 0;
        let sr = 0;
        let sg = 0;
        let sb = 0;
        const n = side * side;
        for (let i = 0; i < n; i++) {
          const r = buf[i * 4];
          const g = buf[i * 4 + 1];
          const b = buf[i * 4 + 2];
          const l = (r + g + b) / 3;
          sum += l;
          sr += r;
          sg += g;
          sb += b;
          min = Math.min(min, l);
          max = Math.max(max, l);
        }
        //  The channel means are carried alongside the luma because a *coloured* light is not judged
        //  by brightness: a red slug is dimmer per channel than the silver track it sits on while
        //  still being unmissable. Callers that only want brightness use `luma`; the indicator probe
        //  uses `rgb` so it can accept a light that reads by hue instead.
        return {
          luma: +(sum / n).toFixed(1),
          min,
          max,
          rgb: [+(sr / n).toFixed(1), +(sg / n).toFixed(1), +(sb / n).toFixed(1)],
        };
      });
    },
    /**
     * Board-local points in world space. The browser check uses this to verify the rendered
     * board's tilt *sign* without the camera's perspective entering the measurement: at the
     * gameplay framing the perspective nearly cancels the screen-space dip of a board tilting
     * about z, so a screen-space test there would be measuring the camera, not the board.
     */
    probeWorld(points) {
      boardGroup.updateMatrixWorld(true);
      const v = new THREE.Vector3();
      return points.map(([x, y, z]) => {
        v.set(x, y, z);
        boardGroup.localToWorld(v);
        return { x: +v.x.toFixed(5), y: +v.y.toFixed(5), z: +v.z.toFixed(5) };
      });
    },
    /**
     * Board-local points projected to normalised device coordinates. Used by the browser
     * smoke test to prove the *visible* board tilts the same way the marble rolls.
     */
    probeLocal(points) {
      // Refresh the camera first: matrixWorldInverse is otherwise only up to date as of the
      // last render, which silently makes these measurements depend on when a frame ran.
      camera.updateMatrixWorld(true);
      boardGroup.updateMatrixWorld(true);
      const v = new THREE.Vector3();
      return points.map(([x, y, z]) => {
        v.set(x, y, z);
        boardGroup.localToWorld(v);
        v.project(camera);
        return { x: +v.x.toFixed(5), y: +v.y.toFixed(5) };
      });
    },
    get quality() {
      return tier;
    },
    /**
     * What the last frame actually asked the GPU to do: draw calls, triangles and live programs.
     *
     * Exposed for the perf overlay and the profiling tool, because a frame-time number says a
     * frame is slow but this says *why* one is: a sudden jump in draw calls is a scene change, a
     * jump in programs is a shader recompile, and neither shows up in a CPU span.
     */
    get stats() {
      const info = renderer.info;
      return {
        calls: info.render.calls,
        triangles: info.render.triangles,
        lines: info.render.lines,
        points: info.render.points,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? 0,
      };
    },
    /**
     * How much of the drawing buffer the transmission pass renders, and how many pixels that is.
     * Exposed because the cost of the glass is a *smoothness* promise: a check can assert that this
     * tracks the marble's footprint instead of the viewport.
     */
    get transmission() {
      const viewportWidth = renderer.domElement.width;
      return {
        scale: +transmissionScale.toFixed(3),
        width: Math.round(viewportWidth * transmissionScale),
        height: Math.round(renderer.domElement.height * transmissionScale),
        viewportWidth,
        //  The marble's own size, so a check can assert the buffer is a multiple of *it* rather
        //  than merely a small number: NDC spans the width, so half of it in pixels is the radius.
        marblePx: Math.round(marbleNdc * 0.5 * viewportWidth),
        hasGlassMarble,
      };
    },
    setLevel,
    /** Swap the marble's look in place; returns the id actually built. */
    setMarbleLook,
    /** Push the tuning sheet's transparency / bend / fill onto the current marble. */
    applyMarbleGlass,
    applyMarbleDials,
    /** Turn the marble's embedded lamp off (or back on) for measurement. */
    setMarbleLamp,
    /** The marble design on the board, and how many there are to choose from. */
    get marble() {
      return { id: marbleLookId, designs: MARBLE_DESIGNS.map((d) => ({ id: d.id, name: d.name, blurb: d.blurb })) };
    },
    sync,
    render,
    resize,
    dispose,
    frameBoard,
    /**
     * The posed fixture meshes, with the level entries they were built from. Exposed so a check
     * can ask the *renderer* where it drew a windmill arm and compare that with where the engine
     * says the arm is — the two agreeing is the whole point of the per-frame pose.
     */
    get obstacles() {
      return obstacles;
    },
    get bounds() {
      return bounds;
    },
    maxTilt: MAX_TILT,
  };
}
