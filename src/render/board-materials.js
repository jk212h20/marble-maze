//  Board materials to choose between: the timbers (walnut, birch, cherry) and a stone slab.
//
//  This module is the *candidate* shelf, not the shipped board. The game still draws its one
//  picture of walnut (`assets/wood-board.png`, through `wood-image.js`); everything here is
//  procedural, so a species is a palette plus a set of grain weights over the fields
//  `textures.js` already builds - and a species therefore differs in *structure* as well as in
//  colour, which is the whole point of offering birch next to cherry next to walnut.
//
//  `grain` is the prominence slider, threaded through both families: for wood it scales how far
//  the tone leaves the middle and how hard the normal map is read (so the same fields read as
//  faint or bold grain); for stone it scales the veining the same way. It is the one knob the
//  picker exposes, so a choice is always "this material, at this grain prominence".

import * as THREE from 'three';
import { WOOD_SPAN, WOOD_DEFAULTS, woodMaps, fbm } from './textures.js';
import { woodImageMaps } from './wood-image.js';

/**
 * Three timbers. Palettes are real enough to read as the species (birch is pale and creamy with
 * almost no contrast between its lines and its face; cherry is warm and reddish with a calm
 * cathedral figure and few pores; walnut is the dark, strongly lined board the game ships).
 *
 * `profile` weights the shared grain structure; `plankUnits` is how many board units wide a
 * plank is, which is the one structural number that reads instantly at board scale.
 */
export const WOOD_SPECIES = {
  walnut: {
    label: 'Walnut',
    note: 'the shipped board: dark, strongly lined, open pores',
    palette: { base: '#96602f', dark: '#3f2410', light: '#c98f52' },
    plankUnits: 1.25,
    profile: { ...WOOD_DEFAULTS },
  },
  birch: {
    label: 'Birch',
    note: 'pale and creamy, faint fine grain, almost no pores',
    palette: { base: '#d8c5a0', dark: '#b09a74', light: '#eadfc6' },
    plankUnits: 1.6,
    profile: { line: 0.45, hair: 0.5, pore: 0.28, broad: 0.5, seam: 0.5, knots: 0.35 },
  },
  cherry: {
    label: 'Cherry',
    note: 'warm reddish brown, calm cathedral figure, tight pores',
    palette: { base: '#9e5433', dark: '#5c2b19', light: '#c8845a' },
    plankUnits: 1.9,
    profile: { line: 0.62, hair: 0.6, pore: 0.3, broad: 1.15, seam: 0.7, knots: 0.5 },
  },
};

/** Every timber, in the order the picker shows them. */
export const WOOD_ORDER = ['birch', 'cherry', 'walnut'];

/**
 * The maps for one timber at one grain prominence. `relief` is the material's own normal
 * strength (the board wants its lines to catch the light; the same call at a lower relief is
 * what a wall or a ramp would take).
 */
export function timberMaps(species, { grain = 1, relief = 1.5, size, span = WOOD_SPAN } = {}) {
  const s = WOOD_SPECIES[species] ?? WOOD_SPECIES.walnut;
  return woodMaps({
    ...s.palette,
    plankUnits: s.plankUnits,
    profile: s.profile,
    relief,
    grain,
    size,
    span,
  });
}

/**
 * Stone: a pale slab crossed by veins that wander, thin where they cross the face and slightly
 * wider where the slab was cut through a seam. Built from the same periodic lattice noise as the
 * wood, so it is deterministic and it does not tile-stamp the board.
 *
 * Two vein sets run at different angles and scales - one broad and sweeping, one finer and
 * broken up - plus a soft cloud of grey, which is what stops the slab reading as a white plane
 * with scratches on it.
 */
const stoneCache = new Map();
function stoneFields(size) {
  if (stoneCache.has(size)) return stoneCache.get(size);
  const height = new Float32Array(size * size);
  const tone = new Float32Array(size * size);
  const hue = new Float32Array(size * size);

  //  A vein is a *step*, not a ridge: the marble reads when a thin dark core has a paler halo
  //  around it, because that is what the light does through a translucent stone. `line()` returns
  //  the core, `halo()` a softer version of it at the same place.
  const line = (s, p) => Math.pow(1 - Math.abs(Math.sin(s * Math.PI)), p);

  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    const row = y * size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;

      // Cloud: three scales, so the slab has mottling at more than one size. Marble is not even.
      const cloud = fbm(u, v, 3, 3, 3, 71) * 0.55 + fbm(u, v, 7, 7, 2, 97) * 0.3 + fbm(u, v, 17, 17, 2, 131) * 0.15;

      // Broad veins: a warped coordinate, so the lines sweep and bend instead of running straight.
      const wu = fbm(u, v, 2, 3, 3, 11);
      const wv = fbm(u, v, 3, 2, 3, 23);
      const s1 = (u + (wu - 0.5) * 1.1) * 4.6 + (v + (wv - 0.5) * 0.6) * 2.2;
      //  Branching: a slow noise masks the broad veins, so they fade out and come back rather
      //  than running the whole width of the slab, which is what made them read as drawn lines.
      const branch = fbm(u, v, 3, 5, 2, 83);
      const v1 = line(s1, 11) * (0.25 + 0.9 * branch);
      const halo1 = line(s1, 3) * 0.22;

      // Fine veins: a second, tighter set at an angle to the first, broken into dashes by noise.
      const wu2 = fbm(u, v, 4, 4, 2, 37);
      const s2 = (v + (wu2 - 0.5) * 0.8) * 9.5 - u * 3.1;
      const dash = fbm(u, v, 9, 9, 2, 53);
      const v2 = line(s2, 15) * (0.3 + 0.8 * dash);

      // Thread veins: short, thin and nearly straight, at an angle to both other sets. These are
      // the ones that read as crystal when you are close to the slab.
      const s3 = (u * 1.9 - v * 1.25 + (fbm(u, v, 5, 5, 2, 61) - 0.5) * 0.5) * 13.5;
      const thread = line(s3, 20) * (0.2 + 0.85 * fbm(u, v, 11, 11, 2, 89));

      const vein = Math.min(1, v1 + v2 * 0.8 + thread * 0.7) * 1.35;
      const halo = Math.min(1, halo1) * 1.1;
      const broad = (cloud - 0.5) * 0.55;

      const h = 0.5 + broad * 0.1 - vein * 0.18 - halo * 0.03;
      //  The halo lightens the stone either side of a vein; the speckle is the crystal in the face.
      //  The speckle is the crystal in the face, at the finest lattice the tile can carry.
      const speckle = (fbm(u, v, 96, 96, 2, 157) - 0.5) * 0.09;
      const t = 0.5 + broad * 0.62 - vein * 0.5 + halo * 0.06 - halo * vein * 0.12 + speckle;
      const i = row + x;
      height[i] = h < 0 ? 0 : h > 1 ? 1 : h;
      tone[i] = t < 0 ? 0 : t > 1 ? 1 : t;
      //  Which mineral this part of the slab is: a slow field, read as a colour cast on the veins.
      hue[i] = fbm(u, v, 2, 2, 2, 199);
    }
  }
  //  Fields at full vein, and the prominence slider scales the read-out (below), so dragging the
  //  slider never rebuilds a megapixel of noise.
  const fields = { size, height, tone, hue, key: `stone|${size}` };
  stoneCache.set(size, fields);
  return fields;
}

/** Pull a field away from the middle by `grain`, clamped so the colours never wrap. */
function prominent(v, grain) {
  const x = 0.5 + (v - 0.5) * grain;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** The tone field, read out as the slab's colour: white face, grey cloud, darker grey veins. */
function stoneAlbedo(fields, {
  face = '#f2f1ec',
  cloud = '#cbcac4',
  vein = '#6e7370',
  warmVein = '#857c6e',
  grain = 1,
} = {}) {
  const { size, tone, hue } = fields;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const mid = rgb(cloud);
  const light = rgb(face);
  const cool = rgb(vein);
  const warm = rgb(warmVein);
  for (let i = 0; i < tone.length; i++) {
    const t = prominent(tone[i], grain);
    const k = t < 0.5 ? t * 2 : (t - 0.5) * 2;
    //  One slab, two minerals: the vein colour drifts between a cool grey and a warm stone grey.
    const m = hue[i];
    const dark = [cool[0] + (warm[0] - cool[0]) * m, cool[1] + (warm[1] - cool[1]) * m, cool[2] + (warm[2] - cool[2]) * m];
    const from = t < 0.5 ? dark : mid;
    const to = t < 0.5 ? mid : light;
    const j = i * 4;
    d[j] = from[0] + (to[0] - from[0]) * k;
    d[j + 1] = from[1] + (to[1] - from[1]) * k;
    d[j + 2] = from[2] + (to[2] - from[2]) * k;
    d[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Normals from the stone height field: the veins are cut a hair below the polished face. */
function stoneNormal(fields, relief, grain) {
  const { size, height } = fields;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const scale = 6 * relief * grain;
  for (let y = 0; y < size; y++) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    const row = y * size;
    for (let x = 0; x < size; x++) {
      const xl = (x - 1 + size) % size;
      const xr = (x + 1) % size;
      const dhdu = (height[row + xr] - height[row + xl]) * 0.5;
      const dhdv = (height[up + x] - height[down + x]) * 0.5;
      let nx = -dhdu * scale;
      let ny = -dhdv * scale;
      const len = Math.hypot(nx, ny, 1);
      nx /= len;
      ny /= len;
      const j = (row + x) * 4;
      d[j] = Math.round((nx * 0.5 + 0.5) * 255);
      d[j + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      d[j + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      d[j + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Polished face, slightly duller veins, so the light tells you where the seam is. */
function stoneRoughness(fields, grain) {
  const { size, tone } = fields;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0; i < tone.length; i++) {
    //  Polished: the face is glossy, the veins and their haloes are a touch duller where the
    //  crystal breaks the surface. Marble is a hard polish, so these numbers live low.
    const r = 0.45 + (0.5 - prominent(tone[i], grain)) * 0.4 + (fields.hue[i] - 0.5) * 0.06;
    const v = Math.round(Math.min(1, Math.max(0.4, r)) * 255);
    const j = i * 4;
    d[j] = v;
    d[j + 1] = v;
    d[j + 2] = v;
    d[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Three's canvas textures flip Y on upload; the stone fields are only ever read as pixels. */
function stoneTexture(canvasImage, { srgb = false, span = WOOD_SPAN } = {}) {
  const tex = new THREE.CanvasTexture(canvasImage);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.repeat.set(1 / span, 1 / span);
  tex.offset.set(0.5, 0.5);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Board units the stone covers in one tile. The picture path covers 16x11 board units, so the slab
 * uses the same 16 across: the veins are then at the same board scale as the timber's grain, and a
 * finish switch does not change how big the board's surface features are.
 */
export const STONE_SPAN = 16;

/** The maps for the marble slab at one grain prominence. */
export function stoneMaps({ grain = 1, relief = 1, size = 1024, span = STONE_SPAN, palette } = {}) {
  const fields = stoneFields(size);
  return {
    map: stoneTexture(stoneAlbedo(fields, { grain, ...(palette ?? {}) }), { srgb: true, span }),
    normalMap: stoneTexture(stoneNormal(fields, relief, grain), { span }),
    roughnessMap: stoneTexture(stoneRoughness(fields, grain), { span }),
  };
}

/**
 * The maps for one *surface* of the toy in one finish - the board, a wall, a hole bevel, the ramp.
 *
 * This is what the game asks for, and it is the same information the picker shows, arranged the way
 * the renderer needs it: a finish plus the surface's own tone (the board is 1, a wall is a shade
 * darker, the ramp is the pale separate piece of timber). Wood tones the same picture; stone has no
 * picture, so its tone is applied to the slab's three colours instead - which is how a stone ramp
 * still reads as a paler piece of stone rather than as the board.
 *
 * Returns `null` when a wood finish has no picture to work from, so the caller can fall back to the
 * procedural fields (a missing asset is a worse board, not a broken game - the same rule the
 * shipped board keeps).
 */
/**
 * A flipped copy of a source, made once per source and axis.
 *
 * This is how the rim gets "a different board" out of one picture without sampling outside it: the
 * picture covers exactly the board, so there is no spare region to move the rim into and no room to
 * rotate it (a rotation would leave the frame sampling the clamped edge). A *mirror* stays inside
 * the picture and changes what the rim's grain does relative to the board's - the figure turns back
 * on itself across the joint, the way a book-matched panel does.
 */
const flips = new WeakMap();
function mirrorSource(source, axis = 'v') {
  let per = flips.get(source);
  if (!per) {
    per = new Map();
    flips.set(source, per);
  }
  if (per.has(axis)) return per.get(axis);
  const w = source.naturalWidth ?? source.width;
  const h = source.naturalHeight ?? source.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.translate(axis === 'u' ? w : 0, axis === 'v' ? h : 0);
  ctx.scale(axis === 'u' ? -1 : 1, axis === 'v' ? -1 : 1);
  ctx.drawImage(source, 0, 0, w, h);
  per.set(axis, c);
  return c;
}

/**
 * How the rim is cut relative to the board it frames. `same` continues the board's own grain - the
 * shipped look, and the one that makes the frame read as part of the same piece of timber; the other
 * two deliberately read as another board. `stain` is the depth of a dark stain on top of any of them.
 */
export const RIM_GRAIN = ['same', 'mirrored', 'cut'];

/** The tone a rim surface is cut at, after its stain. */
const stained = (tone, stain) => tone * (1 - 0.62 * Math.min(1, Math.max(0, stain)));

export function surfaceMaps(finish, {
  source,
  grain = 1,
  tone = 1,
  relief = 1.5,
  pores = 0.8,
  flat = 0.6,
  size,
  rimGrain = 'same',
  stain = 0,
} = {}) {
  if (finish === 'marble') {
    //  A hard range: stone at a 1.55 tone would be chalk, and a stone wall darker than 0.7 reads
    //  as a hole rather than as shadowed stone.
    const k = Math.min(1.6, Math.max(0.55, stained(tone, stain)));
    const lift = (hex, f) => {
      const n = parseInt(hex.slice(1), 16);
      const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.min(255, Math.round(v * f)));
      return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    };
    return stoneMaps({
      grain,
      relief: relief * 0.85,
      size: size ?? 1024,
      palette: { face: lift('#f2f1ec', k), cloud: lift('#cbcac4', k), vein: lift('#6e7370', k * 0.96) },
    });
  }
  const spec = PHOTO_TIMBERS[finish] ?? PHOTO_TIMBERS.walnut;
  const t = spec.transform ?? {};
  //  `cut` is the one option with no picture in it at all: an independently generated grain of the
  //  same species, which is what "made from a different board" means when there is only one board
  //  photographed. It is the procedural fields, so it is coarser - and it is offered as such.
  if (rimGrain === 'cut') return fallbackSurfaceMaps(finish, { grain, tone: stained(tone, stain), relief, size });
  if (!source) return null;
  const src = rimGrain === 'mirrored' ? mirrorSource(source, 'v') : source;
  return woodImageMaps(src, {
    spanX: 16,
    spanY: 11,
    relief,
    pores,
    flat,
    offset: [0.5, 0.5],
    //  Exponents compose: a birch wall is birch's own paleness times the wall's own shade, and the
    //  stain darkens whatever that came to.
    tone: (t.tone ?? 1) * stained(tone, stain),
    saturate: t.saturate ?? 1,
    gain: t.gain ?? [1, 1, 1],
    grain: (t.grain ?? 1) * grain,
  });
}

/** '#rrggbb' to three channels. */
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Species as *transforms of the shipped board picture*.
 *
 * This is the honest version of "birch" and "cherry" that one generated board can support: the
 * grain structure - pores, cathedral figure, bundles of different widths - is the picture's own,
 * which is the thing the procedural fields could not fake (see docs/wood-krea-vs-procedural.png),
 * and a species is then a tone curve, a colour cast and a grain contrast on it. It is a direction
 * to choose between, not a photograph of birch, and the picker says so on the card.
 *
 * `tone` is the brightness exponent, `saturate` blends toward luminance, `gain` multiplies the
 * channels (the colour cast), `grain` is the species' own grain contrast before the slider's.
 */
export const PHOTO_TIMBERS = {
  walnut: {
    label: 'Walnut',
    note: 'the shipped board picture itself - the reference',
    transform: {},
  },
  birch: {
    label: 'Birch',
    note: 'the shipped grain, paled and desaturated as birch',
    transform: { tone: 2.05, saturate: 0.3, gain: [1.04, 1.0, 0.9], grain: 0.62 },
  },
  cherry: {
    label: 'Cherry',
    note: 'the shipped grain, warmed to cherry',
    transform: { tone: 1.0, saturate: 1.22, gain: [1.2, 0.8, 0.62], grain: 1.0 },
  },
};

/** The board picture, once it has loaded; `null` until then, and the timbers fall back to fields. */
let picture = null;
/** The whole board: 16x11 board units, mapped at 0.5/0.5 like the game's own slab. */
const WHOLE = { spanX: 16, spanY: 11, offset: [0.5, 0.5] };
/**
 * A native-resolution band of the same picture, for the close-ups.
 *
 * The board picture is 1536 px across 16 board units, about 96 px per unit, and the game draws it
 * at roughly 0.7 of that - so a close-up that magnifies 6x is showing *interpolation*, not grain.
 * A band of the picture at its own resolution, drawn about 1:1, is the honest way to judge the
 * relief and the pores.
 */
let band = null;

export function setBoardPicture(sheetSource, { bandSource = sheetSource, bandFraction = 0.32, bandPx = 400 } = {}) {
  picture = sheetSource;
  const h = bandSource.naturalHeight ?? bandSource.height;
  const w = bandSource.naturalWidth ?? bandSource.width;
  const y0 = Math.round(h * bandFraction);
  const height = Math.min(bandPx, h - y0);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = height;
  c.getContext('2d').drawImage(bandSource, 0, y0, w, height, 0, 0, w, height);
  const unitsPerPx = 11 / h;
  const spanY = height * unitsPerPx;
  //  `uvY0` is where the band starts in board UV (the geometry's own uv.y = -z), which is what
  //  the band plane has to be built against so the crop lands where it belongs on the board.
  const uvY0 = (y0 / h - 0.5) * 11;
  band = { source: c, spanX: 16, spanY, uvY0, offset: [0.5, -uvY0 / spanY] };
}

/** The board units a close-up band covers, so a view can frame it 1:1. */
export function boardBand() {
  return band
    ? { spanX: band.spanX, spanY: band.spanY, uvY0: band.uvY0, kilobyte: Math.round(band.source.width * band.source.height / 1000) }
    : { spanX: 16, spanY: 4, uvY0: -2, kilobyte: 0 };
}

/** One timber: from the picture when there is one, from the procedural fields when there is not. */
export function photoMaps(species, { grain = 1, relief = 1.5, pores = 0.8, flat = 0.6, band: useBand = false } = {}) {
  const t = PHOTO_TIMBERS[species]?.transform ?? {};
  const place = (useBand && band ? band : { ...WHOLE, source: picture }) ?? {};
  const source = place.source ?? picture;
  if (!source) return null;
  return woodImageMaps(source, {
    spanX: place.spanX ?? WHOLE.spanX,
    spanY: place.spanY ?? WHOLE.spanY,
    offset: place.offset ?? WHOLE.offset,
    relief,
    pores,
    flat,
    tone: t.tone ?? 1,
    saturate: t.saturate ?? 1,
    gain: t.gain ?? [1, 1, 1],
    grain: (t.grain ?? 1) * grain,
  });
}

/**
 * The procedural fallback for one surface: the species' own palette, shaded by the surface's tone.
 *
 * Used when the board picture is missing (or is not there yet), where the game used to hand every
 * surface one walnut palette. A sculpted finish with no picture is a worse board, not a board in
 * the wrong timber.
 */
export function fallbackSurfaceMaps(finish, { grain = 1, tone = 1, relief = 1.5, size, span = WOOD_SPAN } = {}) {
  const spec = WOOD_SPECIES[finish] ?? WOOD_SPECIES.walnut;
  const k = Math.pow(tone, 0.7);
  const shade = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.min(255, Math.round(v * k)));
    return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  };
  const palette = Object.fromEntries(Object.entries(spec.palette).map(([key, hex]) => [key, shade(hex)]));
  return woodMaps({
    ...palette,
    plankUnits: spec.plankUnits,
    profile: spec.profile,
    relief,
    grain,
    size,
    span,
  });
}

/** One surface of the toy in one finish: the picture path when there is a picture, the procedural
 *  fallback when there is not. This is the call the renderer makes for each of its five surfaces. */
export function boardSurfaceMaps(finish, opts = {}) {
  return surfaceMaps(finish, opts) ?? fallbackSurfaceMaps(finish, opts);
}

/**
 * The whole shelf: what the picker iterates. Each entry is `{ id, label, note, kind }`, and
 * `mapsFor` builds its three maps at a given grain prominence. The timbers prefer the picture
 * (which is why `setBoardPicture` exists and why the picker loads it before the first draw) and
 * fall back to the procedural fields if it is missing - a missing asset is a worse board, not a
 * broken picker, the same rule the game itself keeps.
 */
export const BOARD_MATERIALS = [
  {
    id: 'birch',
    label: PHOTO_TIMBERS.birch.label,
    note: PHOTO_TIMBERS.birch.note,
    kind: 'photo',
    roughness: 0.66,
    metalness: 0.04,
    mapsFor: ({ grain, size }) =>
      photoMaps('birch', { grain }) ?? timberMaps('birch', { grain, size }),
    cropMapsFor: ({ grain }) => photoMaps('birch', { grain, band: true, relief: 1.1, pores: 0.9 }),
  },
  {
    id: 'cherry',
    label: PHOTO_TIMBERS.cherry.label,
    note: PHOTO_TIMBERS.cherry.note,
    kind: 'photo',
    roughness: 0.66,
    metalness: 0.04,
    mapsFor: ({ grain, size }) =>
      photoMaps('cherry', { grain }) ?? timberMaps('cherry', { grain, size }),
    cropMapsFor: ({ grain }) => photoMaps('cherry', { grain, band: true, relief: 1.1, pores: 0.9 }),
  },
  {
    id: 'marble',
    label: 'Marble',
    note: 'pale stone slab, veined, polished',
    kind: 'stone',
    roughness: 0.42,
    metalness: 0.03,
    mapsFor: ({ grain, size }) => stoneMaps({ grain, size: Math.max(size ?? 0, 1024), relief: 1.2 }),
    //  Stone has no picture to crop: its close-up is simply the same fields generated finer.
    cropMapsFor: ({ grain }) => stoneMaps({ grain, size: 1536, relief: 1.1 }),
  },
  {
    id: 'walnut',
    label: PHOTO_TIMBERS.walnut.label,
    note: PHOTO_TIMBERS.walnut.note,
    kind: 'photo',
    roughness: 0.72,
    metalness: 0.04,
    mapsFor: ({ grain, size }) =>
      photoMaps('walnut', { grain }) ?? timberMaps('walnut', { grain, size }),
    cropMapsFor: ({ grain }) => photoMaps('walnut', { grain, band: true, relief: 1.1, pores: 0.9 }),
  },
];
