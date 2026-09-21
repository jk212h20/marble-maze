//  Metals: the finish a pressure-plate button and the walls it drives are cut from.
//
//  This is deliberately a *shared, dependency-free* table: the renderer turns each entry into a
//  three.js material, while the level editor (which has no three.js) reads the same ids and hex
//  colours to draw its swatches and plan view. The engine itself only ever carries the string id,
//  so a level authored before metals existed is simply brass — the default.
//
//  `color` is a 0xRRGGBB number (three.js form); `css` is the same colour as a hex string for the
//  editor, kept next to it so the two can never drift apart.

export const METALS = [
  { id: 'brass', label: 'Brass', color: 0xd9ac52, css: '#d9ac52', roughness: 0.24, metalness: 1, envMapIntensity: 1.3 },
  { id: 'steel', label: 'Steel', color: 0x9aa4b0, css: '#9aa4b0', roughness: 0.3, metalness: 1, envMapIntensity: 1.35 },
  { id: 'copper', label: 'Copper', color: 0xb87333, css: '#b87333', roughness: 0.32, metalness: 1, envMapIntensity: 1.25 },
  { id: 'gunmetal', label: 'Gunmetal', color: 0x4b525c, css: '#4b525c', roughness: 0.34, metalness: 1, envMapIntensity: 1.1 },
  { id: 'bronze', label: 'Bronze', color: 0xa9713b, css: '#a9713b', roughness: 0.36, metalness: 1, envMapIntensity: 1.2 },
  { id: 'gold', label: 'Gold', color: 0xe6c14a, css: '#e6c14a', roughness: 0.2, metalness: 1, envMapIntensity: 1.4 },
];

/** A level that names no metal (everything authored before this existed) is brass. */
export const DEFAULT_METAL = 'brass';

export function metalById(id) {
  return METALS.find((m) => m.id === id) ?? METALS.find((m) => m.id === DEFAULT_METAL);
}

/** The metal id a plate/lift should read, defaulting sensibly. */
export function metalId(id) {
  return metalById(id).id;
}
