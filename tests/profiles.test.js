//  The saved-profile store. A profile is a named patch over the shipped defaults plus the
//  slider range mode it was saved under. These cases pin the contract: the storage key, that
//  names are trimmed and can be overwritten, that a missing profile reads as null, and that a
//  disabled or corrupt store degrades to "no profiles" instead of throwing.

const KEY = 'marblemaze.tuning.profiles.v1';

/** Install a tiny fake localStorage whose contents we can inspect. */
function withStorage(initial, fn) {
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = new Map(Object.entries(initial ?? {}));
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  });
  try {
    return { value: fn(), store };
  } finally {
    if (prev) Object.defineProperty(globalThis, 'localStorage', prev);
    else delete globalThis.localStorage;
  }
}

/** A storage that refuses to write, like private mode. */
function withBrokenStorage(fn) {
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    },
  });
  try {
    return fn();
  } finally {
    if (prev) Object.defineProperty(globalThis, 'localStorage', prev);
    else delete globalThis.localStorage;
  }
}

async function fresh() {
  // The module reads `localStorage` at call time, so one import serves every case.
  return import('../src/engine/profiles.js');
}

export const name = 'saved physics profiles';

export async function tests(t) {
  const { STORE_KEY, readProfiles, profileNames, readProfile, writeProfile, deleteProfile } = await fresh();

  t.ok('the storage key is the one the panel already uses', () => {
    if (STORE_KEY !== KEY) throw new Error(`key drifted: ${STORE_KEY}`);
  });

  t.ok('an empty store reads as no profiles', () => {
    const { value } = withStorage(null, () => ({ names: profileNames(), all: readProfiles(), one: readProfile('x') }));
    if (value.names.length !== 0) throw new Error(`got ${JSON.stringify(value.names)}`);
    if (JSON.stringify(value.all) !== '{}') throw new Error(`got ${JSON.stringify(value.all)}`);
    if (value.one !== null) throw new Error('a missing profile should read as null');
  });

  t.ok('corrupt JSON reads as no profiles rather than throwing', () => {
    const { value } = withStorage({ [KEY]: '{not json' }, () => profileNames());
    if (value.length !== 0) throw new Error(`got ${JSON.stringify(value)}`);
  });

  t.ok('saving, listing, reading back, and deleting a profile', () => {
    let rawAfterSave = null;
    const { value } = withStorage(null, () => {
      const saved = writeProfile('  moon gravity  ', { patch: { gravity: 2 }, range: 'extreme' });
      const names = profileNames();
      const entry = readProfile('moon gravity');
      // Read the raw stored blob *before* the delete, so the save itself is what is being checked.
      rawAfterSave = globalThis.localStorage.getItem(KEY);
      const gone = deleteProfile('moon gravity');
      return { saved, names, entry, after: profileNames(), gone };
    });
    if (!value.saved.ok) throw new Error(`save failed: ${value.saved.error}`);
    if (value.saved.name !== 'moon gravity') throw new Error(`name was not trimmed: ${value.saved.name}`);
    if (JSON.stringify(value.names) !== '["moon gravity"]') throw new Error(`listing was ${JSON.stringify(value.names)}`);
    if (value.entry.patch.gravity !== 2 || value.entry.range !== 'extreme') {
      throw new Error(`entry did not round-trip: ${JSON.stringify(value.entry)}`);
    }
    if (typeof value.entry.saved !== 'string') throw new Error('entry has no saved timestamp');
    if (!value.gone.ok || value.after.length !== 0) throw new Error('delete did not remove the profile');
    if (!rawAfterSave?.includes('moon gravity')) throw new Error(`the store was not written (${rawAfterSave})`);
  });

  t.ok('saving the same name twice updates it instead of duplicating', () => {
    const { value } = withStorage(null, () => {
      writeProfile('fast', { patch: { vMax: 4 }, range: 'normal' });
      writeProfile('fast', { patch: { vMax: 7 }, range: 'wide' });
      return { names: profileNames(), entry: readProfile('fast') };
    });
    if (value.names.length !== 1) throw new Error(`got ${JSON.stringify(value.names)}`);
    if (value.entry.patch.vMax !== 7 || value.entry.range !== 'wide') throw new Error('the second save did not win');
  });

  t.ok('a nameless profile is refused and a missing delete is not an error', () => {
    const { value } = withStorage(null, () => ({
      blank: writeProfile('   ', { patch: {} }),
      gone: deleteProfile('never existed'),
    }));
    if (value.blank.ok) throw new Error('a nameless profile was accepted');
    if (!value.blank.error) throw new Error('a refusal needs a reason');
    if (!value.gone.ok) throw new Error('deleting something already gone should succeed');
  });

  t.ok('a store that cannot write fails visibly instead of pretending', () => {
    const res = withBrokenStorage(() => writeProfile('x', { patch: { gravity: 5 } }));
    if (res.ok) throw new Error('a refused write reported success');
    if (!res.error) throw new Error('a refused write needs a reason');
  });

  t.ok('a profile with no range defaults to normal', () => {
    const { value } = withStorage(null, () => {
      writeProfile('bare', { patch: { gravity: 5 } });
      return readProfile('bare');
    });
    if (value.range !== 'normal') throw new Error(`got ${value.range}`);
  });
}
