//  Procedural textures: painted into a canvas at load time, no asset files. The board's *wood* is
//  the one exception and lives in wood-image.js (a picture, with the relief derived from it);
//  everything else here - marble, ice, sand, steel, belts, brass, glows - is generated, and the
//  wood generator below is kept as the fallback for when that picture cannot be loaded.

import * as THREE from 'three';

function canvas(size = 512) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function noise(ctx, size, amount, alpha) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  void alpha;
}

/**
 * Warm walnut, built from fields rather than drawn as a picture.
 *
 * The board's UVs are board coordinates scaled by 1/WOOD_SPAN, so a plank here is a plank on
 * the screen and one tile spans WOOD_SPAN board units in both directions. Two fields carry the
 * whole surface: a *height* field (which plank seam, grain line, pore or knot a pixel sits on)
 * and a *tone* field (what colour it is there). The albedo, the normal map and the roughness
 * map are all read out of those two, which is the only reason a grain line, the shade of that
 * line and the way light leaves it can agree instead of being three unrelated textures.
 *
 * Both fields are periodic, which the old painted tile was not. Lattice noise wraps by taking
 * its cell indices modulo the lattice size, and a knot measures its distance the short way
 * round the tile, so the tile joins itself with no seam and a board wider than one tile (16x11
 * units against a 12-unit tile) no longer shows a repeating stamp. Nothing is random at load
 * time either - every value comes from a position hash - so the board is byte-identical on
 * every run and one screenshot can be compared against another.
 */
export const WOOD_SPAN = 17;

/**
 * How one timber's grain is weighted. Every number defaults to the shipped walnut board, so a
 * caller that says nothing gets exactly the fields it always got; a species is a set of weights
 * over the same structure (how hard the lines are drawn, how deep the pores are, how much the
 * figure wanders, how much the knots bite), which is what makes birch and cherry differ from
 * walnut in *structure* and not only in colour.
 *
 * `grain` is the prominence knob: it scales the tone's departure from the middle and the height
 * the normal map is read from, so one slider takes any timber from almost flat to pronounced
 * without regenerating the fields.
 */
export const WOOD_DEFAULTS = { line: 1, hair: 1, pore: 1, broad: 1, seam: 1, knots: 1 };

const WOOD_SIZE = 1024; // pixels per tile: 60 px per board unit

/** Position hash in [0,1): the whole texture is a function of where a pixel is. */
export function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(seed, 83492791);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Value noise on an nx-by-ny cell lattice, periodic in both axes because the cell indices are
 * taken modulo the lattice size. `u`/`v` are tile coordinates, so u and u+1 sample the same
 * place and the tile is seamless by construction.
 */
export function latticeNoise(u, v, nx, ny, seed) {
  const x = u * nx;
  const y = v * ny;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let tx = x - ix;
  let ty = y - iy;
  tx = tx * tx * (3 - 2 * tx);
  ty = ty * ty * (3 - 2 * ty);
  const x0 = ((ix % nx) + nx) % nx;
  const y0 = ((iy % ny) + ny) % ny;
  const x1 = (x0 + 1) % nx;
  const y1 = (y0 + 1) % ny;
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  const ab = a + (b - a) * tx;
  const cd = c + (d - c) * tx;
  return ab + (cd - ab) * ty;
}

/** Sum of periodic lattice octaves. Octave frequencies stay integers, so the sum is periodic too. */
export function fbm(u, v, fx, fy, octaves, seed) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * latticeNoise(u, v, fx * (1 << o), fy * (1 << o), seed + o * 131);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

/**
 * Plank widths, in tile fractions, summing to exactly 1 so the band pattern also wraps. The
 * widths are hashed rather than uniform: a run of identical planks is the thing that reads as
 * a texture stamp.
 */
function plankLayout(plankUnits) {
  const count = Math.max(2, Math.round(WOOD_SPAN / plankUnits));
  const raw = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    const w = 1 + (hash2(i, 7, 991) - 0.5) * 0.6;
    raw.push(w);
    total += w;
  }
  const planks = [];
  let v = 0;
  for (let i = 0; i < count; i++) {
    const h = raw[i] / total;
    planks.push({ v0: v, h, tone: hash2(i, 3, 17) });
    v += h;
  }
  return planks;
}

/**
 * Knots, as fixed positions rather than per-load randomness, so the board is reproducible. Each
 * one is elongated along the grain (2.1x in v) the way a real cathedral knot follows the board.
 *
 * WOOD_SPAN is wider than the widest board (16 units), and the tile is centred on the board, so
 * the board uses the middle of the tile - u 0.03..0.97, v 0.18..0.82 for a 16x11 board - and no
 * part of it crosses a tile edge. The knots sit inside that window: outside it they would be
 * paid for and never seen, and a knot on a tile edge would be sliced in half by the join.
 */
const KNOTS = [
  { u: 0.17, v: 0.62, r: 0.052 },
  { u: 0.56, v: 0.25, r: 0.072 },
  { u: 0.79, v: 0.44, r: 0.038 },
];

/**
 * The two shared fields, computed once per plank layout and reused by every wood material: the
 * board, the hole bevels, the walls and the ramp all cut from this one piece of timber, so the
 * grain lines up across them instead of each material looking like a different tree.
 *
 * `v` is constant along a row (planks stack in v), so the plank lookup and the seam distance
 * are done once per row rather than once per pixel.
 */
//  Keyed by layout+profile+size and kept as a map rather than a single slot: the picker draws
//  several timbers side by side, and a one-slot cache would regenerate every one of them on
//  every alternate draw. The entry count is tiny and each entry is a few megabytes at most.
const fieldsCache = new Map();
function woodFields(plankUnits, profile = WOOD_DEFAULTS, size = WOOD_SIZE) {
  const P = { ...WOOD_DEFAULTS, ...profile };
  const key = `${plankUnits}|${P.line},${P.hair},${P.pore},${P.broad},${P.seam},${P.knots}|${size}`;
  if (fieldsCache.has(key)) return fieldsCache.get(key);
  const height = new Float32Array(size * size);
  const tone = new Float32Array(size * size);
  const planks = plankLayout(plankUnits);
  const seamHalf = 0.011; // v-units of groove either side of a plank joint (~11 px)

  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    // The plank this row belongs to, and how close the row is to a joint on either side.
    let plank = planks[0];
    let seamDist = 1e9;
    for (const p of planks) {
      if (v >= p.v0 && v < p.v0 + p.h) plank = p;
      const d = Math.abs(v - p.v0);
      const dw = Math.abs(v - (p.v0 + p.h));
      if (d < seamDist) seamDist = d;
      if (dw < seamDist) seamDist = dw;
    }
    // 1 on the joint, falling to 0 across the groove, then a lit lip just outside it.
    const groove = Math.max(0, 1 - seamDist / seamHalf);
    const seam = groove * groove * (3 - 2 * groove);
    const lip = Math.max(0, 1 - Math.abs(seamDist - seamHalf * 1.7) / (seamHalf * 1.2));
    const plankShift = (plank.tone - 0.5) * 0.16;
    const row = y * size;

    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;

      // Grain is sampled through the knots' warp, so the lines bend around a knot instead of
      // running through it - this is most of what makes a knot read as part of the board.
      let warpU = 0;
      let warpV = 0;
      let knotRing = 0;
      let knotCore = 0;
      for (const k of KNOTS) {
        let du = u - k.u;
        du -= Math.round(du); // shortest way round the tile
        let dv = v - k.v;
        dv -= Math.round(dv);
        const r = Math.hypot(du, dv * 2.1) / k.r;
        if (r > 2.8) continue;
        const fall = Math.exp(-r * r * 0.8);
        const inv = 1 / Math.max(r, 1e-4);
        warpU += du * inv * fall * k.r * 2.2 * P.knots;
        warpV += dv * inv * fall * k.r * 1.4 * P.knots;
        knotRing += Math.sin(r * 7.5) * Math.exp(-r * 0.7) * P.knots;
        knotCore += Math.exp(-r * r * 0.55) * P.knots;
      }

      const gu = u + warpU;
      const gv = v + warpV;
      // Broad tone: long, lazy variation along the plank.
      const broad = fbm(gu, gv, 2, 14, 3, 101);
      // The lines themselves: many cells along v, few along u, so each lump is a long streak.
      // Two scales of them, because grain is a bundle of lines of different widths, not one
      // weight repeated: the coarse pass gives a plank its figure, the fine pass is what reads as
      // the grain when you are close enough to the board to see individual lines.
      //  Octave counts are kept low on purpose: the finest lattice here is 340 cells across the
      //  tile, about 3 px, and anything finer than that is aliasing rather than detail - the
      //  mip chain would average it away at any distance the board is actually seen from.
      const fine = fbm(gu, gv, 7, 110, 3, 211);
      const line = Math.pow(1 - Math.abs(2 * fine - 1), 8);
      const hair = fbm(gu, gv, 13, 170, 2, 401);
      const hairline = Math.pow(1 - Math.abs(2 * hair - 1), 7);
      // Pores and ray flecks: high frequency in both axes, thresholded so only the peaks show.
      const pore = fbm(gu, gv, 26, 200, 2, 313);
      const fleck = Math.max(0, (pore - 0.68) / 0.32);
      const fleckSharp = fleck * fleck;

      // Height is shallow on purpose: the albedo carries the figure, and the normal map only has
      // to give the lines an edge. A deep height field turns the board into corrugated iron.
      const h =
        0.5 +
        (broad - 0.5) * 0.22 * P.broad -
        line * 0.2 * P.line -
        hairline * 0.11 * P.hair -
        fleckSharp * 0.3 * P.pore -
        seam * 0.8 * P.seam +
        lip * 0.14 * P.seam -
        knotCore * 0.3 +
        knotRing * 0.08;
      const t =
        0.5 +
        (broad - 0.5) * 0.5 * P.broad +
        plankShift -
        line * 0.26 * P.line -
        hairline * 0.1 * P.hair -
        fleckSharp * 0.22 * P.pore -
        seam * 0.6 * P.seam +
        lip * 0.12 * P.seam -
        knotCore * 0.45 +
        knotRing * 0.06;

      const i = row + x;
      height[i] = h < 0 ? 0 : h > 1 ? 1 : h;
      tone[i] = t < 0 ? 0 : t > 1 ? 1 : t;
    }
  }

  const fields = { key, plankUnits, profile: P, size, height, tone };
  fieldsCache.set(key, fields);
  return fields;
}

/** '#rrggbb' to three channels, so the palettes above stay readable as hex. */
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * The transforms every wood map shares. Three gives each map its own matrix, so the normal and
 * roughness maps have to be told the same thing as the albedo or they sample 12x the scale.
 */
function finishWoodTexture(tex, { srgb = false, span = WOOD_SPAN } = {}) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  //  A bigger span is more board per tile, so a tile of the same pixel count has fewer pixels
  //  per board unit; that is how the previews build faster than the shipped board.
  //  UVs are board coordinates, so scale them to world units, and centre the tile on the board:
  //  with the span wider than the board, the board then sits inside one tile and its grain is
  //  one continuous piece of timber rather than a stamp that repeats across it.
  tex.repeat.set(1 / span, 1 / span);
  tex.offset.set(0.5, 0.5);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Albedo, read out of the tone field: dark below the middle, base at it, light above. The same
 * three palettes as before, so a caller that names a timber still gets that timber.
 */
export function woodTexture({
  base = '#96602f',
  dark = '#3f2410',
  light = '#c98f52',
  plankUnits = 1.25,
  profile = WOOD_DEFAULTS,
  grain = 1,
  size = WOOD_SIZE,
  span = WOOD_SPAN,
} = {}) {
  const { size: fieldSize, tone } = woodFields(plankUnits, profile, size);
  const c = canvas(fieldSize);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(fieldSize, fieldSize);
  const d = img.data;
  const mid = rgb(base);
  const lo = rgb(dark);
  const hi = rgb(light);
  for (let i = 0; i < tone.length; i++) {
    //  Prominence: the tone's distance from the middle is what the grain *is*, so scaling it
    //  turns the same fields into faint grain or bold grain without rebuilding them.
    const t = contrast(tone[i], grain);
    const k = t < 0.5 ? t * 2 : (t - 0.5) * 2;
    const from = t < 0.5 ? lo : mid;
    const to = t < 0.5 ? mid : hi;
    const j = i * 4;
    d[j] = from[0] + (to[0] - from[0]) * k;
    d[j + 1] = from[1] + (to[1] - from[1]) * k;
    d[j + 2] = from[2] + (to[2] - from[2]) * k;
    d[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return finishWoodTexture(new THREE.CanvasTexture(c), { srgb: true, span });
}

/**
 * Tangent-space normals from the height field, by central difference. The differences wrap, so
 * the relief is continuous across the tile join, and `relief` is a per-material strength: a
 * board wants its grain to catch the light, a wall cap does not want to look sanded.
 *
 * Three's canvas textures flip Y on upload, so the row above a pixel is +v: the vertical slope
 * is taken the other way round from the horizontal one.
 */
export function woodNormalTexture({
  plankUnits = 1.25,
  relief = 1,
  profile = WOOD_DEFAULTS,
  grain = 1,
  size = WOOD_SIZE,
  span = WOOD_SPAN,
} = {}) {
  const { size: fieldSize, height } = woodFields(plankUnits, profile, size);
  const c = canvas(fieldSize);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(fieldSize, fieldSize);
  const d = img.data;
  const scale = 17 * relief * grain;
  for (let y = 0; y < fieldSize; y++) {
    const up = ((y - 1 + fieldSize) % fieldSize) * fieldSize;
    const down = ((y + 1) % fieldSize) * fieldSize;
    const row = y * fieldSize;
    for (let x = 0; x < fieldSize; x++) {
      const xl = (x - 1 + fieldSize) % fieldSize;
      const xr = (x + 1) % fieldSize;
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
  return finishWoodTexture(new THREE.CanvasTexture(c), { span });
}

/**
 * How the surface answers light: pores are duller than the polished face between them, and a
 * plank joint is duller still. Centred just under 1.0 so it varies the material's own
 * roughness instead of replacing it - three multiplies the two.
 */
export function woodRoughnessTexture({
  plankUnits = 1.25,
  profile = WOOD_DEFAULTS,
  grain = 1,
  size = WOOD_SIZE,
  span = WOOD_SPAN,
} = {}) {
  const { size: fieldSize, height, tone } = woodFields(plankUnits, profile, size);
  const c = canvas(fieldSize);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(fieldSize, fieldSize);
  const d = img.data;
  for (let i = 0; i < tone.length; i++) {
    const dull = Math.max(0, contrast(tone[i], grain) - height[i]); // where the surface has been eaten into
    let r = 0.955 + (0.5 - height[i]) * 0.09 + dull * 0.05;
    r = r < 0.88 ? 0.88 : r > 1 ? 1 : r;
    const v = Math.round(r * 255);
    const j = i * 4;
    d[j] = v;
    d[j + 1] = v;
    d[j + 2] = v;
    d[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return finishWoodTexture(new THREE.CanvasTexture(c), { span });
}

/**
 * All three maps for one timber, sharing the fields and the UV transform. This is what the
 * renderer should ask for: handing a material only the albedo was why wood used to be a flat
 * colour with lines drawn on it, however good the lines were.
 */
/** Pull a tone field away from the middle by `grain`, clamped so the palette never wraps. */
function contrast(t, grain) {
  const v = 0.5 + (t - 0.5) * grain;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function woodMaps({
  base = '#96602f',
  dark = '#3f2410',
  light = '#c98f52',
  plankUnits = 1.25,
  relief = 1,
  profile = WOOD_DEFAULTS,
  grain = 1,
  size = WOOD_SIZE,
  span = WOOD_SPAN,
} = {}) {
  return {
    map: woodTexture({ base, dark, light, plankUnits, profile, grain, size, span }),
    normalMap: woodNormalTexture({ plankUnits, relief, profile, grain, size, span }),
    roughnessMap: woodRoughnessTexture({ plankUnits, profile, grain, size, span }),
  };
}

/**
 * Cat's-eye marble: pale glass with wide, softly-edged ribbons of colour that taper
 * toward the poles, the way a real swirl marble looks. Deliberately wide and few — thin
 * lines read as baseball stitching from a distance.
 */
export function marbleTexture() {
  const size = 1024;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, '#eff5fc');
  g.addColorStop(0.5, '#ffffff');
  g.addColorStop(1, '#e7eef8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const ribbon = (v0, width, colors, wobble, phase) => {
    for (let x = 0; x < size; x += 4) {
      const t = x / size;
      const y = v0 * size + Math.sin(t * Math.PI * 2 * 0.75 + phase) * wobble * size;
      const taper = 0.55 + 0.45 * Math.cos((t - 0.5) * Math.PI * 1.15);
      const w = (width * size * taper) / 2;
      const grd = ctx.createLinearGradient(0, y - w, 0, y + w);
      grd.addColorStop(0, 'rgba(255,255,255,0)');
      grd.addColorStop(0.5, colors[0]);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(x, y - w, 4.5, w * 2);
      // a brighter core line inside the ribbon, also wide and soft
      const grd2 = ctx.createLinearGradient(0, y - w * 0.34, 0, y + w * 0.34);
      grd2.addColorStop(0, 'rgba(255,255,255,0)');
      grd2.addColorStop(0.5, colors[1]);
      grd2.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grd2;
      ctx.fillRect(x, y - w * 0.34, 4.5, w * 0.68);
    }
  };

  ribbon(0.3, 0.34, ['rgba(58,116,196,0.62)', 'rgba(24,74,152,0.68)'], 0.012, 0);
  ribbon(0.53, 0.22, ['rgba(198,74,62,0.5)', 'rgba(150,40,34,0.6)'], 0.01, 1.7);
  ribbon(0.76, 0.3, ['rgba(58,116,196,0.5)', 'rgba(30,86,164,0.58)'], 0.014, 3.1);

  // faint glass crazing
  ctx.globalAlpha = 0.1;
  ctx.strokeStyle = '#ffffff';
  for (let i = 0; i < 40; i++) {
    ctx.lineWidth = 1 + Math.random() * 1.5;
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 90, y + (Math.random() - 0.5) * 90);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// ---------------------------------------------------------------------------------------------
// Planet marbles: the Earth, the Moon and an eight ball
//
// All three are *painted* marbles - one sphere, one map, nothing inside - which is what keeps them
// free to run: no transmission pass and no core geometry, so one costs exactly what the shipped
// cat's-eye costs.
//
// Their maps are DataTextures rather than canvases, for the reason the lantern's band mask is: the
// marble tests build every design in node, where there is no document, so a design whose look is
// painted there is a design nothing can check. Rasterising coastlines, craters and the eight's
// rings in plain arithmetic keeps all three fully testable, and deterministic besides - the same
// latitude of a noise field always paints the same continent.
//
// A sphere's own UVs are equirectangular: u is longitude once around, v runs pole to pole, so a
// pixel *is* a place on the globe. Everything below is written as a place rather than as a spot on
// a picture, and a shape that straddles the seam at u = 0 is tested at lon, lon - 360 and
// lon + 360 so a coastline joins itself across the wrap.

const DEG = Math.PI / 180;

/** A smooth 0..1 ramp: 0 at or below `a`, 1 at or above `b`, smoothstep in between. */
const ramp = (x, a, b) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** out = a mixed toward b by t, in place. Mixing `out` with itself is legal (b may be out). */
const mix3 = (out, a, b, t) => {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
};

/**
 * Fill `count` equirectangular channels from one writer.
 *
 * `write(lon, lat, out)` puts an [r,g,b] triple in 0..1 into `out[layer]` for that place on the
 * globe. Float channels rather than bytes, because the crater pass *adds* to what the first pass
 * wrote and rounding there would flatten every rim.
 */
function planetBuffers(width, height, count, write) {
  const channels = Array.from({ length: count }, () => new Float32Array(width * height * 3));
  const out = Array.from({ length: count }, () => [0, 0, 0]);
  for (let y = 0; y < height; y++) {
    //  A DataTexture's first row is v = 0, which is the sphere's south pole: `flipY` is false for a
    //  DataTexture (it is the canvas path that flips), so latitude runs bottom-up here.
    const lat = -90 + ((y + 0.5) / height) * 180;
    for (let x = 0; x < width; x++) {
      write(((x + 0.5) / width) * 360 - 180, lat, out, x, y);
      const i = (y * width + x) * 3;
      for (let layer = 0; layer < count; layer++) {
        channels[layer][i] = out[layer][0];
        channels[layer][i + 1] = out[layer][1];
        channels[layer][i + 2] = out[layer][2];
      }
    }
  }
  return channels;
}

/**
 * Wrap one channel as a texture. `colour` is true for an albedo map and false for a mask
 * (roughness or bump): a map that is read as *data* must not have a colour transform applied.
 */
function planetTexture(channel, width, height, colour) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, p = 0; i < channel.length; i += 3, p += 4) {
    data[p] = Math.round(Math.min(1, Math.max(0, channel[i])) * 255);
    data[p + 1] = Math.round(Math.min(1, Math.max(0, channel[i + 1])) * 255);
    data[p + 2] = Math.round(Math.min(1, Math.max(0, channel[i + 2])) * 255);
    data[p + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Angle between two places on the globe, in degrees. The honest distance for a sphere. */
const angularDistance = (lon1, lat1, lon2, lat2) => {
  const d =
    Math.sin(lat1 * DEG) * Math.sin(lat2 * DEG) +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.cos((lon1 - lon2) * DEG);
  return Math.acos(Math.min(1, Math.max(-1, d))) / DEG;
};

// --- the Earth ---------------------------------------------------------------------------------

/**
 * Coastlines as [lon, lat] rings, hand-traced from the shapes everyone carries in their head - the
 * taper of Chile, Africa's horn, the two lobes of the Gulf of Mexico - rather than sampled from a
 * dataset, because the whole picture has to stay a few kilobytes of arithmetic in this module.
 *
 * Detail here is *coastline*, not resolution: a marble is about 40 px across in play, and what makes
 * a globe read as the Earth at that size is that Britain, Japan, Madagascar and New Zealand are all
 * there, not that Africa's outline has one more vertex. So this is denser than it needs to be for the
 * silhouette alone, and it carries the islands separately - they are small enough to vanish under
 * any coarser sampling, and their absence is exactly what makes a drawn planet look like a prop.
 */
const CONTINENTS = [
  // North America, down through Central America
  [[-168, 65], [-163, 69], [-155, 71], [-145, 70], [-136, 70], [-128, 71], [-120, 72],
    [-110, 73], [-100, 73], [-90, 73], [-80, 73], [-70, 68], [-63, 60], [-56, 52], [-53, 47],
    [-60, 45], [-66, 44], [-70, 42], [-74, 40], [-76, 35], [-79, 31], [-80, 25], [-83, 29],
    [-85, 30], [-88, 30], [-92, 29], [-95, 29], [-97, 26], [-98, 20], [-94, 16], [-88, 16],
    [-83, 8], [-80, 9], [-85, 13], [-88, 15], [-92, 15], [-97, 17], [-104, 19], [-106, 23],
    [-110, 26], [-114, 29], [-117, 33], [-121, 35], [-124, 40], [-124, 46], [-124, 49],
    [-128, 53], [-133, 57], [-138, 59], [-145, 60], [-152, 59], [-158, 57], [-164, 60]],
  // South America
  [[-78, 8], [-72, 11], [-62, 10], [-52, 5], [-50, 0], [-44, -2], [-38, -5], [-35, -7],
    [-38, -13], [-40, -20], [-45, -23], [-48, -25], [-53, -32], [-57, -36], [-62, -39],
    [-62, -42], [-66, -45], [-68, -50], [-70, -55], [-75, -52], [-73, -45], [-72, -38],
    [-71, -30], [-70, -22], [-71, -18], [-75, -15], [-77, -10], [-81, -6], [-80, -2], [-80, 2]],
  // Africa and Arabia, with the horn and the Gulf of Guinea
  [[-17, 15], [-16, 20], [-14, 25], [-10, 28], [-5, 34], [0, 36], [8, 37], [11, 34], [20, 32],
    [27, 31], [33, 31], [35, 28], [37, 22], [40, 15], [43, 12], [48, 13], [51, 12], [49, 7],
    [43, 2], [41, -4], [40, -11], [36, -18], [35, -24], [31, -30], [26, -34], [20, -35],
    [16, -29], [12, -18], [9, -5], [9, 4], [3, 6], [-4, 5], [-8, 5], [-13, 8]],
  // Eurasia, with India and south-east Asia hanging off it
  [[-10, 36], [-9, 40], [-9, 44], [-4, 48], [0, 49], [3, 51], [8, 54], [12, 55], [16, 57],
    [19, 59], [21, 62], [22, 66], [26, 70], [30, 70], [38, 68], [45, 68], [52, 70], [60, 71],
    [68, 72], [75, 73], [82, 74], [90, 76], [100, 77], [110, 77], [120, 75], [130, 73],
    [140, 73], [150, 72], [160, 70], [170, 68], [180, 66], [180, 62], [170, 60], [160, 58],
    [150, 55], [142, 52], [138, 48], [135, 45], [132, 42], [130, 35], [124, 32], [122, 30],
    [120, 25], [116, 23], [110, 21], [108, 18], [106, 12], [104, 9], [100, 6], [98, 10],
    [96, 15], [92, 20], [88, 22], [85, 20], [82, 17], [80, 12], [78, 8], [74, 15], [72, 20],
    [68, 23], [64, 25], [60, 25], [57, 25], [54, 27], [50, 30], [47, 30], [45, 38], [42, 42],
    [40, 43], [37, 44], [35, 42], [32, 36], [30, 36], [27, 37], [24, 38], [21, 39], [18, 40],
    [15, 42], [12, 44], [8, 44], [5, 43], [2, 42], [-2, 38], [-6, 36]],
  // Australia
  [[114, -22], [122, -14], [132, -11], [142, -11], [146, -19], [153, -28], [150, -38],
    [140, -38], [130, -32], [120, -34], [115, -30]],
  // The islands. Small, and load-bearing for "is this the Earth?"
  [[-10, 52], [-6, 58], [-2, 58], [0, 53], [-4, 50], [-8, 50]], // Britain and Ireland
  [[-24, 64], [-16, 66], [-14, 64], [-20, 63]], // Iceland
  [[129, 31], [135, 34], [140, 37], [142, 43], [145, 45], [140, 38], [137, 35], [132, 33]], // Japan
  [[43, -13], [50, -16], [49, -22], [45, -25], [43, -20]], // Madagascar
  [[80, 7], [82, 8], [82, 6], [80, 6]], // Sri Lanka
  [[109, 2], [118, 5], [119, -2], [110, -4], [108, 0]], // Borneo
  [[95, 5], [100, 3], [106, -6], [102, -5], [96, 0]], // Sumatra
  [[131, -1], [141, -2], [150, -8], [140, -10], [132, -5]], // New Guinea
  [[120, 18], [124, 13], [126, 7], [122, 8], [120, 13]], // the Philippines
  [[-85, 22], [-77, 20], [-74, 20], [-80, 23]], // Cuba
  [[166, -46], [174, -41], [178, -38], [172, -45], [168, -48]], // New Zealand
];

/** Permanently ice-covered land, which the latitude rule alone would leave green. */
const ICE_SHEETS = [
  [[-45, 60], [-30, 62], [-22, 67], [-18, 72], [-20, 77], [-28, 82], [-40, 84], [-52, 83],
    [-60, 79], [-63, 73], [-58, 68], [-52, 64]], // Greenland
];

/**
 * Turn rings into boxed, seam-padded test sets.
 *
 * A ring is tested three times - as written, and shifted a full turn each way - so a coastline that
 * crosses the seam at u = 0 joins itself instead of ending in a wall down the middle of the Pacific.
 * The bounding box is what makes that affordable: most pixels are rejected on one integer compare.
 */
const boxRings = (rings) => rings.flatMap((ring) =>
  [0, -360, 360].map((shift) => {
    const shifted = ring.map(([lon, lat]) => [lon + shift, lat]);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, y] of shifted) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    return { ring: shifted, minX, maxX, minY, maxY };
  }),
);

const CONTINENT_RINGS = boxRings(CONTINENTS);
const ICE_RINGS = boxRings(ICE_SHEETS);

/** Even-odd point-in-ring, with the bounding box rejected first. */
const inBoxes = (boxes, lon, lat) => {
  for (const box of boxes) {
    if (lon < box.minX || lon > box.maxX || lat < box.minY || lat > box.maxY) continue;
    const ring = box.ring;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
};

const onLand = (lon, lat) => inBoxes(CONTINENT_RINGS, lon, lat);

/**
 * A noise field, computed once and sampled bilinearly.
 *
 * Every field below is low-frequency by nature - continents, cloud belts, mountain belts - so paying
 * for four fbm octaves at every pixel of a two-megapixel map would be pure waste. Each is built at
 * its own resolution instead, and the map reads it with four array lookups and two lerps.
 */
function field(gw, gh, fn) {
  const f = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    const v = (y + 0.5) / gh;
    for (let x = 0; x < gw; x++) f[y * gw + x] = fn((x + 0.5) / gw, v);
  }
  return f;
}

/** Bilinear sample of a field, wrapping in longitude so the seam is continuous. */
function sampleField(f, gw, gh, u, v) {
  const x = u * gw - 0.5;
  const y = Math.min(gh - 1.001, Math.max(0, v * gh - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const xa = ((x0 % gw) + gw) % gw;
  const xb = (xa + 1) % gw;
  const ya = Math.max(0, y0) * gw;
  const yb = Math.min(gh - 1, Math.max(0, y0 + 1)) * gw;
  const top = f[ya + xa] + (f[ya + xb] - f[ya + xa]) * tx;
  const bot = f[yb + xa] + (f[yb + xb] - f[yb + xa]) * tx;
  return top + (bot - top) * ty;
}

/**
 * How far every point of the sea is from the nearest coast, in cells.
 *
 * A two-pass chamfer transform: walk the whole grid forwards propagating distance from every source,
 * then backwards propagating what the first pass could only see from one side. It is approximate -
 * the error is a couple of percent, from measuring diagonals as 1.41 - and that is invisible here,
 * because the whole thing feeds a colour ramp from shelf turquoise to abyssal blue.
 *
 * The point of it: a real ocean is not one colour. It is bright and green over the continental shelf
 * within a couple of hundred kilometres of land, and it falls away to near-black in the middle of
 * the Pacific. That gradient is most of what makes a painted globe look like water rather than blue
 * paint, and no amount of coastline detail substitutes for it.
 */
function distanceFromLand(mask, gw, gh) {
  const INF = 1e6;
  const d = new Float32Array(gw * gh);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : INF;
  const at = (x, y) => d[y * gw + (((x % gw) + gw) % gw)];
  const D1 = 1;
  const D2 = Math.SQRT2;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      let v = d[i];
      if (v === 0) continue;
      if (y > 0) v = Math.min(v, at(x - 1, y - 1) + D2, at(x, y - 1) + D1, at(x + 1, y - 1) + D2);
      if (x > 0) v = Math.min(v, at(x - 1, y) + D1);
      d[i] = v;
    }
  }
  for (let y = gh - 1; y >= 0; y--) {
    for (let x = gw - 1; x >= 0; x--) {
      const i = y * gw + x;
      let v = d[i];
      if (v === 0) continue;
      if (y < gh - 1) v = Math.min(v, at(x + 1, y + 1) + D2, at(x, y + 1) + D1, at(x - 1, y + 1) + D2);
      if (x < gw - 1) v = Math.min(v, at(x + 1, y) + D1);
      d[i] = v;
    }
  }
  return d;
}

/** The land/sea grid the sea's depth shading is measured from, and how wide one of its cells is. */
const LAND_GW = 1024;
const LAND_GH = 512;
//  1024 x 512 is not an accident: 360/1024 and 180/512 are both 0.3516 degrees, so a cell is square
//  on the globe and "cells" converts to kilometres with one multiply at any latitude.
const KM_PER_CELL = (180 / LAND_GH) * 111.2;

let _earthFields = null;

/**
 * The Earth's noise and distance fields, built once and kept.
 *
 * They are shared across every rebuild of the map - a marble is rebuilt in place when the Look dial
 * moves - and they are the expensive part, so they outlive the texture they feed. Nothing here is
 * random at build time: every value comes from the position and a seed, so the continents and the
 * weather are byte-identical on every run and one screenshot can be compared against another.
 */
function earthFields() {
  if (_earthFields) return _earthFields;
  const mask = field(LAND_GW, LAND_GH, (u, v) => (onLand(u * 360 - 180, v * 180 - 90) ? 1 : 0));
  _earthFields = {
    dist: distanceFromLand(mask, LAND_GW, LAND_GH),
    //  Where it is wet and where it is dry, and where the rock is high enough to be mountain.
    veg: field(384, 192, (u, v) => fbm(u, v, 5, 3, 3, 23)),
    dune: field(256, 128, (u, v) => fbm(u, v, 18, 9, 2, 211)),
    //  Ridged noise: 1 - |2n - 1| is creased rather than smooth, which is what a mountain chain is.
    ridge: field(1024, 512, (u, v) => 1 - Math.abs(2 * fbm(u, v, 7, 4, 4, 97) - 1)),
    //  A belt mask, so ranges appear as chains in some places and plains in others instead of
    //  corrugating the entire planet.
    highland: field(256, 128, (u, v) => fbm(u, v, 3, 2, 3, 151)),
    //  Cloud, stretched east-west: weather moves along the parallels, so its blobs are wide.
    cloud: field(512, 256, (u, v) => fbm(u, v, 11, 4, 4, 131)),
  };
  return _earthFields;
}

/**
 * The Earth: shelf water, oceans with depth, mountains, deserts, forest, ice and weather.
 *
 * Returns three maps, and each one carries its own share of the look:
 *
 *   map        the albedo, and the only one the eye reads directly
 *   roughness  the sea, which is the only glossy part of the globe - three multiplies the
 *              material's roughness by this - so the key light throws a specular sweep across the
 *              water that slides as the marble rolls
 *   bump       the continents standing proud of the ocean floor and the mountain belts standing
 *              proud of the continents, so the terminator crosses a surface with relief on it
 *
 * Everything here is a function of *place*, never of pixel: the same latitude of the same noise
 * field paints the same mountain, whether the map is asked for at 512 or 2048 across.
 */
export function earthMaps({ width = 1536, height = 768 } = {}) {
  const { dist, veg, dune, ridge, highland, cloud } = earthFields();
  //  The ocean is lighter than a real one, deliberately. This is a marble 40 px across on dark
  //  timber, and the honest deep blue of the Pacific (about 0.01 of a stop above black) turns the
  //  whole globe into a shadow: the water is *most* of the surface, so its value sets the marble's
  //  value, and it has to sit where the continents still read against it.
  const SHALLOW = [0.20, 0.52, 0.66];
  const SHELF = [0.11, 0.38, 0.62];
  const MID = [0.06, 0.22, 0.46];
  const DEEP = [0.035, 0.115, 0.32];
  const GREEN = [0.15, 0.40, 0.16];
  const RAIN = [0.07, 0.26, 0.11];
  const SAND = [0.66, 0.56, 0.32];
  const TAIGA = [0.19, 0.33, 0.20];
  const ROCK = [0.46, 0.42, 0.36];
  const SNOW = [0.94, 0.95, 0.97];
  const ICE = [0.93, 0.95, 0.98];
  const CLOUD = [0.97, 0.98, 1.0];
  //  Two things in this loop are pure trigonometry of one coordinate each, and at two million pixels
  //  that is where the time goes: the ice edges wobble with longitude and the cloud belt breathes
  //  with latitude. Both are precomputed - one entry per pixel column, one per row - so the loop
  //  below is arithmetic and array reads.
  const edgeN = new Float32Array(width);
  const edgeS = new Float32Array(width);
  const belt = new Float32Array(height);
  for (let x = 0; x < width; x++) {
    const lon = ((x + 0.5) / width) * 360 - 180;
    edgeN[x] = 8 * Math.sin(lon * DEG * 2.3) + 4 * Math.sin(lon * DEG * 5.1);
    edgeS[x] = 6 * Math.sin(lon * DEG * 1.7) + 3 * Math.sin(lon * DEG * 4.3);
  }
  for (let y = 0; y < height; y++) {
    const lat = -90 + ((y + 0.5) / height) * 180;
    belt[y] = 0.40 + 0.60 * (0.5 + 0.5 * Math.cos(lat * DEG * 3.4));
  }
  //  One more row-shaped shortcut, and the biggest one: of the forty-odd boxed rings, only a handful
  //  can possibly cover any one parallel of latitude, so each row of the map carries its own list.
  //  That turns the land test for a pixel in the middle of the Pacific into two compares.
  const rowsOf = (boxes) => {
    const rows = new Array(height);
    for (let y = 0; y < height; y++) {
      const lat = -90 + ((y + 0.5) / height) * 180;
      rows[y] = boxes.filter((b) => lat >= b.minY && lat <= b.maxY);
    }
    return rows;
  };
  const landRows = rowsOf(CONTINENT_RINGS);
  const iceRows = rowsOf(ICE_RINGS);
  const channels = planetBuffers(width, height, 3, (lon, lat, out, x, y) => {
    const u = (lon + 180) / 360;
    const v = (lat + 90) / 180;
    const al = Math.abs(lat);
    const colour = out[0];
    const vegN = sampleField(veg, 384, 192, u, v);
    const duneN = sampleField(dune, 256, 128, u, v);
    //  The polar caps are a latitude with a wobble in it, and the wobble comes from the same noise
    //  the dunes do, which keeps the edge from being a painted line without a second field.
    const northEdge = 66 + edgeN[x] + 12 * (duneN - 0.5);
    const southEdge = -58 + edgeS[x] + 10 * (duneN - 0.5);
    //  Greenland is ice at latitudes where the cap rule would leave it green; it is the one land
    //  mass that has to be white whatever the latitude band says.
    if (lat > northEdge || lat < southEdge || (lat > 58 && inBoxes(iceRows[y], lon, lat))) {
      mix3(colour, ICE, [0.70, 0.79, 0.90], ramp(vegN, 0.3, 0.8) * 0.55);
      out[1] = [0.44, 0.44, 0.44];
      out[2] = [0.50, 0.50, 0.50];
    } else if (inBoxes(landRows[y], lon, lat)) {
      //  Desert and forest are the same rock under different latitudes: the band around 20-30
      //  degrees is dry, and the noise is what stops the boundary becoming a contour line.
      const dry = ramp(vegN * (1 - ramp(al, 18, 55)) + 0.18, 0.34, 0.62);
      mix3(colour, GREEN, SAND, dry);
      //  Rainforest: wet and equatorial, and dark for it.
      const wet = ramp(vegN, 0.48, 0.78) * (1 - ramp(al, 8, 26));
      mix3(colour, colour, RAIN, wet * 0.75);
      mix3(colour, colour, TAIGA, ramp(al, 42, 68));
      //  Relief, and where it is allowed to be: high ground in a belt, flat ground outside it.
      const relief = sampleField(ridge, 1024, 512, u, v) * ramp(sampleField(highland, 256, 128, u, v), 0.44, 0.72);
      mix3(colour, colour, ROCK, ramp(relief, 0.34, 0.8));
      //  Snow on high ground, but only away from the tropics - the Andes are white at the equator
      //  and the Sahara's peaks are not, and the latitude term is what separates them.
      mix3(colour, colour, SNOW, ramp(relief, 0.74, 0.96) * (0.35 + 0.65 * ramp(al, 12, 44)));
      mix3(colour, colour, SNOW, ramp(al, 55, 70) * 0.7);
      //  Grain, strongest where it is driest: bare rock and sand read as texture, forest does not.
      const grain = 1 + (duneN - 0.5) * (0.04 + dry * 0.16);
      colour[0] *= grain;
      colour[1] *= grain;
      colour[2] *= grain;
      const r = 0.90 - wet * 0.14 - ramp(relief, 0.5, 1) * 0.08;
      out[1] = [r, r, r];
      out[2] = [0.56 + relief * 0.40, 0.56 + relief * 0.40, 0.56 + relief * 0.40];
    } else {
      //  Open water. The colour is the distance from land, not a flat blue: turquoise over the
      //  shelf, shelf blue, then the long fall to the abyssal dark that keeps the middle of an
      //  ocean from looking like a swimming pool.
      const km = sampleField(dist, LAND_GW, LAND_GH, u, v) * KM_PER_CELL;
      mix3(colour, SHALLOW, SHELF, ramp(km, 55, 260));
      mix3(colour, colour, MID, ramp(km, 300, 1400));
      mix3(colour, colour, DEEP, ramp(km, 1400, 3600));
      const swell = 1 + (vegN - 0.5) * 0.06;
      colour[0] *= swell;
      colour[1] *= swell;
      colour[2] *= swell;
      const r = 0.04 + 0.10 * ramp(km, 0, 1200);
      out[1] = [r, r, r];
      //  The continental margin, as relief: land sits a little proud of the shelf, and the shelf
      //  stands above the deep floor, so the coast has an edge under a raking light.
      const floor = 0.40 + 0.06 * (1 - ramp(km, 60, 500));
      out[2] = [floor, floor, floor];
    }
    //  Weather last, over everything. The belts are the parts of the planet that are reliably
    //  cloudy - the equatorial convergence and the two storm belts - so the cover follows them
    //  rather than falling evenly, and it stays under half opacity so the ground still reads.
    const cover = sampleField(cloud, 512, 256, u, v);
    const alpha = Math.min(0.42, ramp(cover, 0.52, 0.84) * belt[y]);
    if (alpha > 0.002) mix3(colour, colour, CLOUD, alpha);
  });
  return {
    map: planetTexture(channels[0], width, height, true),
    roughness: planetTexture(channels[1], width, height, false),
    bump: planetTexture(channels[2], width, height, false),
  };
}

// --- the Moon ----------------------------------------------------------------------------------

/**
 * The Moon: grey highlands over dark maria, under a whole crater field.
 *
 * Returns the albedo and a bump map. The craters are added as relief *and* as shading from the same
 * pass, because a crater that is only painted reads as a stain the moment the marble moves; the
 * bump is what lets the key light catch a rim.
 *
 * The maria are the thing that makes a grey ball read as *this* moon rather than as a rock: they
 * cluster on the near side, which is the face everyone knows.
 */
export function moonMaps({ width = 1024, height = 512 } = {}) {
  const MARIA = [
    { lon: -22, lat: 26, r: 26, depth: 0.30 },
    { lon: 14, lat: 22, r: 22, depth: 0.26 },
    { lon: -45, lat: 8, r: 17, depth: 0.24 },
    { lon: 40, lat: 34, r: 15, depth: 0.22 },
    { lon: -8, lat: -12, r: 20, depth: 0.20 },
    { lon: 62, lat: -8, r: 16, depth: 0.18 },
    { lon: -70, lat: 40, r: 13, depth: 0.16 },
  ];
  const BASE = 0.62;
  const channels = planetBuffers(width, height, 2, (lon, lat, out) => {
    const u = (lon + 180) / 360;
    const v = (lat + 90) / 180;
    let albedo = BASE + (fbm(u, v, 9, 5, 4, 71) - 0.5) * 0.14;
    let relief = 0;
    for (const m of MARIA) {
      const inside = 1 - ramp(angularDistance(lon, lat, m.lon, m.lat), m.r * 0.35, m.r);
      if (inside <= 0) continue;
      albedo -= m.depth * inside;
      relief -= 0.012 * inside; // the maria are floods: flat, and slightly lower than the highlands
    }
    out[0] = [albedo, albedo, albedo * 0.985]; // a hair warm, like regolith rather than concrete
    const reliefHeight = 0.5 + relief;
    out[1] = [reliefHeight, reliefHeight, reliefHeight];
  });

  //  A deterministic crater field: equal-area in latitude, mostly small, with a handful of basins.
  //  The size distribution is most of what sells a rocky surface.
  const craters = [];
  for (let i = 0; i < 420; i++) {
    const t = hash2(i, 0, 51);
    const r = 0.7 + t * t * t * 5.5;
    craters.push({
      lon: hash2(i, 1, 52) * 360 - 180,
      lat: Math.asin(hash2(i, 2, 53) * 2 - 1) / DEG,
      r,
      depth: 0.05 + hash2(i, 3, 54) * 0.09,
    });
  }

  const albedo = channels[0];
  const bump = channels[1];
  const add = (channel, index, amount) => {
    for (let c = 0; c < 3; c++) channel[index + c] += amount;
  };
  for (const c of craters) {
    //  Walk the crater's own patch of the map rather than testing every crater at every pixel: the
    //  honest measure is an angular distance, and running 420 of those at half a million pixels is
    //  half a billion roots for a ball 40 px wide.
    const halfLon = c.r / Math.max(0.15, Math.cos(c.lat * DEG));
    const x0 = Math.floor(((c.lon - halfLon + 180) / 360) * width);
    const x1 = Math.ceil(((c.lon + halfLon + 180) / 360) * width);
    const y0 = Math.max(0, Math.floor(((c.lat - c.r + 90) / 180) * height));
    const y1 = Math.min(height - 1, Math.ceil(((c.lat + c.r + 90) / 180) * height));
    for (let y = y0; y <= y1; y++) {
      const lat = -90 + ((y + 0.5) / height) * 180;
      for (let x = x0; x <= x1; x++) {
        const lon = (((x % width) + width) % width) / width * 360 - 180;
        const d = angularDistance(lon, lat, c.lon, c.lat);
        if (d > c.r * 2.4) continue;
        const q = d / c.r;
        //  Roughness in the rim is what keeps 420 circles from looking stamped.
        const rough = 0.7 + 0.6 * hash2(x, y, 77);
        let shade;
        if (q < 1) shade = -c.depth * (1 - q * q) + c.depth * 1.5 * rough * Math.exp(-((q - 0.88) ** 2) / 0.012);
        else shade = c.depth * 0.4 * rough * Math.exp(-((q - 1) ** 2) / 0.09); // the ejecta blanket
        const i = (y * width + x) * 3;
        add(albedo, i, shade);
        add(bump, i, shade * 2.2);
      }
    }
  }
  return {
    map: planetTexture(albedo, width, height, true),
    bump: planetTexture(bump, width, height, false),
  };
}

// --- the eight ball ----------------------------------------------------------------------------

/**
 * The eight ball: polished black, with the 8 in its white circle.
 *
 * The circle and the digit are laid out on an *azimuthal equidistant* projection of the sphere
 * around the disc's centre, not in longitude and latitude, because the two are very different
 * shapes: a white disc drawn in equirectangular space comes out as a lens - fat across the middle
 * and pinched at the sides - and the number inside it shears with it. The projection is the same
 * one a printed disc on a real ball is, so the 8 is round from every angle the board can show.
 */
export function eightBallMap({ width = 512, height = 256 } = {}) {
  const BODY = [0.030, 0.030, 0.036];
  const DISC = [0.94, 0.94, 0.91];
  const centre = { lon: 0, lat: 26 };
  const DISC_R = 23; // angular radius of the white circle, in degrees
  //  Two stacked rings: an 8 *is* a pair of loops touching, and drawing it that way needs no font
  //  (a font would be one more thing that has to exist on the machine that renders the docs).
  const RING_IN = 7.6;
  const RING_OUT = 11;
  const RING_DY = 10.6;
  const channels = planetBuffers(width, height, 1, (lon, lat, out, x, y) => {
    //  A little grain both sides of the print, because a perfectly flat black reads as a hole and a
    //  perfectly flat white reads as a sticker.
    const grain = hash2(x, y, 91);
    const angle = angularDistance(lon, lat, centre.lon, centre.lat);
    if (angle > DISC_R) {
      mix3(out[0], BODY, [0.075, 0.075, 0.09], grain);
      return;
    }
    //  Local coordinates in the tangent plane at the centre, in degrees.
    const dLon = ((((lon - centre.lon) + 540) % 360) - 180) * DEG;
    const lat0 = centre.lat * DEG;
    const latR = lat * DEG;
    const bearing = Math.atan2(
      Math.sin(dLon) * Math.cos(latR),
      Math.cos(lat0) * Math.sin(latR) - Math.sin(lat0) * Math.cos(latR) * Math.cos(dLon),
    );
    const u = angle * Math.sin(bearing);
    const v = angle * Math.cos(bearing);
    const ring = (dy) => {
      const d = Math.hypot(u, v - dy);
      return d > RING_IN && d < RING_OUT;
    };
    if (ring(RING_DY) || ring(-RING_DY)) out[0] = [...BODY];
    else mix3(out[0], DISC, BODY, grain * 0.07);
  });
  return { map: planetTexture(channels[0], width, height, true) };
}

/** Studio backdrop: a soft pool of light rather than a flat void. */
export function backdropTexture() {
  const size = 512;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0a0c10';
  ctx.fillRect(0, 0, size, size);
  const g = ctx.createRadialGradient(size * 0.5, size * 0.42, size * 0.04, size * 0.5, size * 0.5, size * 0.72);
  g.addColorStop(0, '#3d4657');
  g.addColorStop(0.45, '#222833');
  g.addColorStop(1, '#080a0d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Table surface under the board: dark, with a warm pool of light. */
export function tableTexture() {
  const size = 512;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#15171c';
  ctx.fillRect(0, 0, size, size);
  const g = ctx.createRadialGradient(size * 0.5, size * 0.5, size * 0.02, size * 0.5, size * 0.5, size * 0.6);
  g.addColorStop(0, 'rgba(120,96,64,0.55)');
  g.addColorStop(0.4, 'rgba(70,58,44,0.3)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Brushed steel plate for the steel surface. */
export function steelTexture() {
  const size = 256;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, '#9aa6b2');
  g.addColorStop(0.5, '#c3ccd6');
  g.addColorStop(1, '#8e99a6');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 420; i++) {
    ctx.globalAlpha = 0.05 + Math.random() * 0.08;
    ctx.strokeStyle = Math.random() < 0.5 ? '#ffffff' : '#6a7480';
    ctx.lineWidth = 0.5 + Math.random();
    const x = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (Math.random() - 0.5) * 6, size);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Rubber belt: dark ribbed strip with faint chevrons. */
export function beltTexture() {
  const size = 128;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2f3238';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#4a4f58';
  ctx.lineWidth = 3;
  for (let y = 0; y < size; y += 10) {
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = '#8d959f';
  ctx.lineWidth = 2;
  for (let x = -size; x < size * 2; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x, size);
    ctx.lineTo(x + size / 2, 0);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * The grip band: dark rubber with fine transverse ribs, so the ring reads as something
 * you close your hand on rather than a bare metal hoop.
 */
export function gripTexture() {
  const size = 128;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#15171b';
  ctx.fillRect(0, 0, size, size);
  // ribs across the band
  for (let x = 0; x < size; x += 8) {
    const g = ctx.createLinearGradient(x, 0, x + 8, 0);
    g.addColorStop(0, '#0c0e11');
    g.addColorStop(0.45, '#33383f');
    g.addColorStop(1, '#0c0e11');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 8, size);
  }
  // a shallow centre groove, like a tyre
  ctx.fillStyle = '#0a0c0e';
  ctx.globalAlpha = 0.55;
  ctx.fillRect(0, size * 0.46, size, size * 0.08);
  ctx.globalAlpha = 1;
  noise(ctx, size, 0.06, 0.12);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Vent grille with slats. */
export function ventTexture() {
  const size = 128;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4b525b';
  ctx.fillRect(0, 0, size, size);
  for (let y = 4; y < size; y += 14) {
    ctx.fillStyle = '#20242a';
    ctx.fillRect(0, y, size, 8);
    ctx.fillStyle = '#6f7883';
    ctx.fillRect(0, y - 2, size, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Sand / felt pad: gritty speckle. */
export function sandTexture() {
  const size = 256;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d9c08d';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 9000; i++) {
    ctx.globalAlpha = 0.05 + Math.random() * 0.25;
    ctx.fillStyle = Math.random() < 0.5 ? '#a68c5c' : '#f6e6bd';
    const r = 0.6 + Math.random() * 1.6;
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Ice: pale blue with craze lines. */
export function iceTexture() {
  const size = 256;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, '#dff3fb');
  g.addColorStop(0.5, '#bfe2f0');
  g.addColorStop(1, '#d6eef8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#ffffff';
  for (let i = 0; i < 60; i++) {
    ctx.globalAlpha = 0.12 + Math.random() * 0.3;
    ctx.lineWidth = 0.6 + Math.random() * 1.4;
    const x = Math.random() * size;
    const y = Math.random() * size;
    const a = Math.random() * Math.PI * 2;
    const len = 10 + Math.random() * 70;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Soft round sprite used for particle sparks and dust. */
export function sparkTexture() {
  const size = 64;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,236,190,0.75)');
  g.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Thin-film thickness field for the etched rose, written to the green channel (which is the
 * one three reads for iridescenceThicknessMap).
 *
 * This is what turns the etching's iridescence from "a uniform tint" into diffraction: a single
 * thickness over the whole marking shifts the *same* hue everywhere, which just looks like a
 * coloured line. Engraved glass has no such uniformity - the groove depth wanders - so the
 * marking takes a different thin-film colour from one millimetre to the next, and the colour
 * moves as the board tilts. Slow blotches plus a little grain give that variation.
 */
export function etchThicknessTexture() {
  const size = 256;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(120,120,120)';
  ctx.fillRect(0, 0, size, size);
  // Soft overlapping blobs: low-frequency variation, so a line crosses several thicknesses.
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = size * (0.08 + Math.random() * 0.18);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const v = Math.round(40 + Math.random() * 170);
    g.addColorStop(0, `rgba(${v},${v},${v},0.55)`);
    g.addColorStop(1, `rgba(${v},${v},${v},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  noise(ctx, size, 22, 1);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.6, 1.6);
  return tex;
}

/**
 * Normal map for the etched rose: a *ragged* little trench, not a smooth trough.
 *
 * This is the fix for "the etching looks painted on". A smooth line lit from one direction has
 * one brightness, so it reads as a mark printed on the surface no matter how good its colour is.
 * A real engraved groove is full of fine ridges and scratches, and *they* are what catches the
 * light: different parts of the same line glint while others stay dark, and the pattern moves as
 * the board tilts. So: a soft undulation for the trough, plus scratches in mixed directions so no
 * single view angle lights the whole line evenly.
 */
export function etchNormalTexture() {
  const size = 256;
  const h = new Float32Array(size * size);
  const idx = (x, y) => (((y % size) + size) % size) * size + (((x % size) + size) % size);
  // Undulation: long, shallow waves along the groove.
  for (let k = 0; k < 6; k++) {
    const fx = (Math.random() - 0.5) * 3;
    const fy = (Math.random() - 0.5) * 3;
    const ph = Math.random() * Math.PI * 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        h[idx(x, y)] += 0.12 * Math.sin(((x / size) * fx + (y / size) * fy) * Math.PI * 2 + ph);
      }
    }
  }
  // Scratches: the part that glints.
  for (let k = 0; k < 150; k++) {
    const x0 = Math.random() * size;
    const y0 = Math.random() * size;
    const a = Math.random() * Math.PI * 2;
    const len = 10 + Math.random() * 46;
    const w = 0.6 + Math.random() * 1.2;
    const amp = 0.55 + Math.random() * 0.95;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const steps = Math.ceil(len * 2);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = x0 + dx * len * t;
      const cy = y0 + dy * len * t;
      const r = Math.ceil(w * 1.7);
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          const d = Math.hypot(ox, oy);
          if (d > w * 1.7) continue;
          h[idx(Math.round(cx) + ox, Math.round(cy) + oy)] += amp * (1 - d / (w * 1.7));
        }
      }
    }
  }
  // Height field -> tangent-space normals.
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const slope = 1.7;
      let nx = (h[idx(x - 1, y)] - h[idx(x + 1, y)]) * slope;
      let ny = (h[idx(x, y - 1)] - h[idx(x, y + 1)]) * slope;
      let nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;
      const i = (y * size + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

/**
 * Surface ripple normals for the level-vial liquid.
 *
 * A liquid's surface is never optically flat: it carries the last of its own motion as long,
 * shallow ripples, and those ripples are most of what separates "liquid" from "green paint" when
 * you are looking straight down at it. (The etched rose needed the same treatment for the same
 * reason.) The pattern is deliberately low-frequency along the trough and tight across it, so it
 * reads as ripples running the length of the channel.
 */
export function liquidRippleTexture() {
  const size = 128;
  const h = new Float32Array(size * size);
  const idx = (x, y) => (((y % size) + size) % size) * size + (((x % size) + size) % size);
  for (let k = 0; k < 5; k++) {
    const fx = 0.6 + Math.random() * 1.2; // along the channel: long waves
    const fy = 3 + Math.random() * 4; // across it: tight ones
    const ph = Math.random() * Math.PI * 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        h[idx(x, y)] += 0.4 * Math.sin(((x / size) * fx + (y / size) * fy) * Math.PI * 2 + ph);
      }
    }
  }
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const slope = 0.9;
      let nx = (h[idx(x - 1, y)] - h[idx(x + 1, y)]) * slope;
      let ny = (h[idx(x, y - 1)] - h[idx(x, y + 1)]) * slope;
      let nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      d[i] = (nx * inv * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * inv * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1); // the ribbon's own UVs set the ripple scale, in board units
  return tex;
}

/** Radial soft shadow blob for contact shading under the marble. */
export function blobTexture() {
  const size = 128;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.78)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.38)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}


/**
 * A soft, feathered glow: a small bright core inside a wide, gentle tail, with no edge anywhere.
 *
 * Used additively wherever a light has to look like it spills onto a surface instead of ending on a
 * cut line - the goal's rim light and the halo around the indicator bars. A flat colour, or a mesh
 * with a real edge, reads as a decal; a falloff that reaches zero reads as light.
 */
export function softGlowTexture() {
  const size = 256;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.14, 'rgba(255,247,228,0.7)');
  g.addColorStop(0.36, 'rgba(255,229,178,0.28)');
  g.addColorStop(0.62, 'rgba(255,212,148,0.09)');
  g.addColorStop(0.85, 'rgba(255,204,132,0.02)');
  g.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Alpha ramp across a vial's channel: solid through the middle, fading to nothing at each wall.
 *
 * The liquid's ribbon is only five rows wide, so its long edges were a hard cut where the surface
 * met the channel wall. Used as the surface's alphaMap (its UVs run across the channel) the edges
 * feather into the walls instead - which is what a wetted surface does, and it costs one texture.
 * Deliberately left in linear space: alphaMap is sampled as data, not as colour.
 */
export function liquidEdgeTexture() {
  const w = 64;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = 2;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, w, 0);
  // A narrow feather: zero only at the wall row itself, opaque by the next sample inward. A wide
  // ramp would pull the liquid away from the walls and flatten the meniscus, which is the shape that
  // says "wetted surface" rather than "strip of paint".
  g.addColorStop(0, '#000');
  g.addColorStop(0.12, '#fff');
  g.addColorStop(0.88, '#fff');
  g.addColorStop(1, '#000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, 2);
  return new THREE.CanvasTexture(c);
}

/**
 * Edge falloff for the indicator bars, written per box face: opaque through the middle, gone at the
 * border, feathered with a smoothstep between.
 *
 * A machined box has four crisp edges, and from the playing camera that bright rectangle was the
 * first thing the eye landed on - it read as a painted block rather than as a lit element. Applied as
 * the slug's alphaMap, every face's border melts into the channel underneath, so the bar has no
 * boundary anywhere while its centre stays solid enough to read the position off. The falloff is a
 * distance-to-nearest-edge field, not a radial gradient: a radial one fades at the corners first and
 * leaves the middles of the long edges hard, which is exactly the edge the eye notices.
 *
 * Written to RGB (alphaMap is sampled from the green channel) at full alpha, in linear space.
 */
export function barEdgeTexture() {
  const size = 256;
  const feather = 0.3; // fraction of the half-width over which the edge fades
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      const e = Math.min(u, 1 - u, v, 1 - v) / feather; // 0 at the border, 1 once past the feather
      const t = Math.min(1, Math.max(0, e));
      const a = t * t * (3 - 2 * t); // smoothstep, so the fade has no visible start or stop
      const i = (y * size + x) * 4;
      const b = Math.round(a * 255);
      img.data[i] = b;
      img.data[i + 1] = b;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}
