//  Where saved physics profiles live.
//
//  A profile is a *named patch over the shipped defaults* plus the slider range mode it was
//  saved under. Storing the patch rather than a full flattened sheet means a profile that
//  only changes gravity still follows the shipped numbers for everything else, and it keeps
//  the stored blobs small enough to read at a glance in the JSON box.
//
//  The range mode travels with the profile so a set of numbers taken while testing extremes
//  comes back with the sliders that were showing them, instead of appearing clipped.
//
//  Everything here is best-effort: private mode, a disabled store or corrupt JSON all degrade
//  to "no profiles" rather than throwing into the game loop.

/** localStorage key holding `{ [profileName]: { patch, range, saved } }`. */
export const STORE_KEY = 'marblemaze.tuning.profiles.v1';

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Every saved profile as `{ name: entry }`, or `{}` when storage is unavailable or corrupt. */
export function readProfiles() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    return isPlainObject(raw) ? raw : {};
  } catch {
    return {};
  }
}

/** Saved profile names, alphabetical, so the list does not jump around as it is saved. */
export function profileNames() {
  return Object.keys(readProfiles()).sort((a, b) => a.localeCompare(b));
}

/** One profile entry (`{ patch, range, saved }`) or `null`. */
export function readProfile(name) {
  const entry = readProfiles()[name];
  return isPlainObject(entry) ? entry : null;
}

function persist(store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
    return { ok: true };
  } catch {
    return { ok: false, error: 'this browser will not save profiles' };
  }
}

/**
 * Save (or overwrite) a profile. Returns `{ ok, name }` or `{ ok: false, error }`.
 * Overwriting is intentional: saving the same name twice is how a profile is updated.
 */
export function writeProfile(name, { patch, range } = {}) {
  const clean = String(name ?? '').trim();
  if (!clean) return { ok: false, error: 'a profile needs a name' };
  const store = readProfiles();
  store[clean] = {
    patch: isPlainObject(patch) ? patch : {},
    range: typeof range === 'string' ? range : 'normal',
    saved: new Date().toISOString(),
  };
  const res = persist(store);
  return res.ok ? { ok: true, name: clean } : res;
}

/** Delete a profile. Returns `{ ok }`; deleting something already gone is not an error. */
export function deleteProfile(name) {
  const store = readProfiles();
  if (!(name in store)) return { ok: true };
  delete store[name];
  return persist(store);
}
