//  Wood from a picture instead of from fields.
//
//  textures.js paints the board procedurally, which is fast, reproducible and needs no asset. A
//  generated image has figure that lattice noise does not fake: real pores, real cathedral figure,
//  real variation in how wide the grain bundles are. Measured against the procedural board in a
//  side-by-side lit render (2026-09-19), the generated one won on both the board view and the
//  close-up - "the procedural grain lines are too uniform in thickness and spacing, the contrast
//  is too high and there are no pores" - which is what this module exists to fix.
//
//  Three things have to be true of the image, and all three are fixed here rather than asked for
//  in the prompt:
//
//    * **It must not carry its own lighting.** A generated image arrives with a soft gradient - a
//      bright corner, a falloff at the edge. Left alone that fights the scene's key light and reads
//      as a stain that never moves when the board tilts, so the low frequencies are measured with a
//      box blur and divided out.
//    * **It must not be treated as a height map.** The relief has to come from the *fine*
//      structure, so the normal map is built from a high pass - the image minus its own blur. A
//      broad dark patch is figure, not a valley.
//    * **It must be mapped the way the procedural tile is.** Board coordinates, centred, clamped at
//      the edges - see wood-uv.js. That is what puts the grain into the holes correctly, and it
//      means one image serves every level whatever its footprint: the projection does that work,
//      not the picture, so nothing has to be re-rendered per hole layout.
//
//  The image is the *board*. The walls, the hole bevels and the ramp are the same board cut up, so
//  they take the same maps and differ by a tone exponent (`tone`) and by their material's own
//  roughness - not by a second picture.

import * as THREE from 'three';

/** Draw an image (or canvas) into an offscreen canvas at its own size. */
function toCanvas(source) {
  const w = source.naturalWidth ?? source.width;
  const h = source.naturalHeight ?? source.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(source, 0, 0, w, h);
  return c;
}

/**
 * Separable box blur of a float field, clamped at the edges - not wrapped: this image covers the
 * whole board and is never tiled, so the left edge has no business seeing the right edge.
 */
function blurField(src, w, h, radius) {
  const r = Math.max(1, Math.round(radius));
  const span = 2 * r + 1;
  const clamp = (v, n) => (v < 0 ? 0 : v >= n ? n - 1 : v);
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[row + clamp(k, w)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / span;
      sum += src[row + clamp(x + r + 1, w)] - src[row + clamp(x - r, w)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[clamp(k, h) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / span;
      sum += tmp[clamp(y + r + 1, h) * w + x] - tmp[clamp(y - r, h) * w + x];
    }
  }
  return out;
}

/**
 * The measurements that do not depend on which cut of the board is being drawn: the pixels, their
 * luminance, the low frequencies to divide out, and the residual. Computed once per image and
 * reused by all five materials, because the blur is the only expensive part.
 */
const prepared = new WeakMap();
function prepare(source, flat) {
  const key = `${flat}`;
  const cached = prepared.get(source);
  if (cached && cached.key === key) return cached;

  const canvas = toCanvas(source);
  const { width: w, height: h } = canvas;
  const px = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const n = w * h;
  const luma = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    luma[i] = (px[i * 4] * 0.2126 + px[i * 4 + 1] * 0.7152 + px[i * 4 + 2] * 0.0722) / 255;
  }
  const low = blurField(luma, w, h, Math.max(w, h) / 12);
  const fine = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    fine[i] = luma[i] - low[i];
    mean += luma[i];
  }
  const out = { key, w, h, n, px, luma, low, fine, mean: mean / n };
  prepared.set(source, out);
  return out;
}

/**
 * The albedo for one tone. `tone` is a brightness exponent multiplier: 1 leaves the picture alone,
 * 1.5 gives the pale timber the ramp is made of, 0.9 the darker boards the walls are. It is applied
 * as a luminance curve with the colour carried along, so it never clips and the grain survives.
 *
 * Three more knobs, all of them for the species variants in `board-materials.js` and none of them
 * changing the shipped board's own call (which passes none of them):
 *
 *   * `grain` scales the *fine* structure (the picture's own luminance minus the low frequencies)
 *     about the mean, so the same board reads with faint grain or bold grain.
 *   * `saturate` blends the pixel toward its luminance and `gain` multiplies the channels, which
 *     together take one walnut photograph to a pale ashen timber or a warm red one. This is a
 *     colour decision on the same grain, and it is labelled as such in the picker - it is a
 *     direction to choose, not a photograph of birch.
 */
function albedoCanvas(p, { flat, tone, grain = 1, saturate = 1, gain = [1, 1, 1] }) {
  const { w, h, n, px, luma, low, mean } = p;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const gamma = 1 / Math.max(tone, 0.2);
  for (let i = 0; i < n; i++) {
    // Flatten: take out `flat` of the low-frequency deviation from the mean, then put that share
    // of the mean back so the overall brightness survives the operation.
    const flatLuma = Math.max(0.02, luma[i] - low[i] * flat + mean * flat);
    // Grain: the fine structure (what is left after the low frequencies) scaled about the mean.
    const grained = Math.max(0.02, mean + (flatLuma - mean) * grain);
    const wanted = Math.pow(Math.min(grained, 1), gamma);
    const k = wanted / Math.max(luma[i], 0.02);
    const r = Math.min(255, px[i * 4] * k) * gain[0];
    const g = Math.min(255, px[i * 4 + 1] * k) * gain[1];
    const b = Math.min(255, px[i * 4 + 2] * k) * gain[2];
    const l = (r * 0.2126 + g * 0.7152 + b * 0.0722) | 0;
    d[i * 4] = Math.min(255, Math.max(0, l + (r - l) * saturate));
    d[i * 4 + 1] = Math.min(255, Math.max(0, l + (g - l) * saturate));
    d[i * 4 + 2] = Math.min(255, Math.max(0, l + (b - l) * saturate));
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Height, as the fine structure only, into a tangent-space normal map.
 *
 * Cached by image and strength: the normal and the roughness are the same for every cut of the
 * board, only the albedo's tone differs between them, and rebuilding a 1.6-million-pixel map five
 * times at load is work nobody asked for.
 */
const byStrength = new WeakMap();

//  How many maps one picture may keep cached. One finish is five surfaces (board, bevel, wall,
//  cap, ramp) at three maps each, so this holds a finish with room to spare and evicts the oldest
//  as a *different* finish or a different grain prominence is drawn. Without the cap the game's
//  grain slider would hold every value it had ever been dragged through - each one 15 canvases.
const CACHE_LIMIT = 21;

function once(source, key, make) {
  let perSource = byStrength.get(source);
  if (!perSource) {
    perSource = new Map();
    byStrength.set(source, perSource);
  }
  if (!perSource.has(key)) {
    perSource.set(key, make());
    while (perSource.size > CACHE_LIMIT) {
      const oldest = perSource.keys().next().value;
      if (oldest === key) break;
      perSource.get(oldest).dispose();
      perSource.delete(oldest);
    }
  }
  return perSource.get(key);
}

function normalCanvas(p, relief) {
  const { w, h, fine } = p;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  //  Scaled per pixel, so it is a slope rather than a height: 9 is the strength that read as
  //  "grain catching the light" without reading as carved grooves, measured on the close-up.
  const strength = 9 * relief;
  for (let y = 0; y < h; y++) {
    const up = ((y - 1 + h) % h) * w;
    const down = ((y + 1) % h) * w;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const gx = (fine[row + ((x + 1) % w)] - fine[row + ((x - 1 + w) % w)]) * 0.5 * strength;
      const gy = (fine[up + x] - fine[down + x]) * 0.5 * strength;
      const len = Math.hypot(gx, gy, 1);
      const j = (row + x) * 4;
      d[j] = Math.round((-gx / len) * 0.5 * 255 + 127.5);
      d[j + 1] = Math.round((-gy / len) * 0.5 * 255 + 127.5);
      d[j + 2] = Math.round((1 / len) * 0.5 * 255 + 127.5);
      d[j + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** How the surface answers light: the fine structure again, as pores that are duller than the face. */
function roughnessCanvas(p, pores) {
  const { w, h, n, fine } = p;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < n; i++) {
    let v = 0.95 - fine[i] * pores * 1.6;
    v = v < 0.82 ? 0.82 : v > 1 ? 1 : v;
    const b = Math.round(v * 255);
    d[i * 4] = b;
    d[i * 4 + 1] = b;
    d[i * 4 + 2] = b;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * The three maps for one cut of the board.
 *
 * `spanX`/`spanY` are the board units the image covers, and they are what tie it to the UVs the
 * game's geometry already carries: uv = (x, -z) in board units, centred on the board. The image is
 * not tiled (`ClampToEdgeWrapping`): it covers the whole board, so there is nothing to repeat and
 * no seam to hide - which is exactly what a picture of one board should do.
 */
export function woodImageMaps(source, {
  spanX = 16,
  spanY = 11,
  relief = 1.5,
  flat = 0.6,
  pores = 0.8,
  tone = 1,
  grain = 1,
  saturate = 1,
  gain = [1, 1, 1],
  offset = [0.5, 0.5],
} = {}) {
  const p = prepare(source, flat);
  const build = (key, canvas, srgb) =>
    once(source, key, () => {
      const tex = new THREE.CanvasTexture(canvas());
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      //  `spanX`/`spanY` are the board units the image covers and `offset` where it sits: a crop of
      //  the picture is a smaller span placed elsewhere, which is how a close-up can be shown at
      //  the picture's own texel density instead of magnified past it.
      tex.repeat.set(1 / spanX, 1 / spanY);
      tex.offset.set(offset[0], offset[1]);
      tex.needsUpdate = true;
      return tex;
    });
  return {
    map: build(
      `a${flat}-${tone}-${grain}-${saturate}-${gain.join(',')}-${spanX}x${spanY}`,
      () => albedoCanvas(p, { flat, tone, grain, saturate, gain }),
      true,
    ),
    //  Prominence carries into the relief as well: a board whose grain was asked to be faint
    //  should not still have deep grooves in the normal map.
    normalMap: build(`n${relief}-${grain}`, () => normalCanvas(p, relief * grain), false),
    roughnessMap: build(`r${pores}-${grain}`, () => roughnessCanvas(p, pores * grain), false),
  };
}

/** Load an image URL into something that can be drawn to a canvas. */
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}
