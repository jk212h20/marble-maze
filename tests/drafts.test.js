//  The draft store is shared by value between the editor (which writes it) and the game
//  (which opens `?draft=`). These cases pin the contract: the storage key, the `session`
//  alias, and graceful failure when storage is missing or corrupt.

const KEY = 'marblemaze.level-editor.drafts.v1';

function withStorage(value, fn) {
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k) => (k === KEY ? value : null),
      setItem: () => {},
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
  return import('../src/engine/drafts.js');
}

export const name = 'draft store (shared by the editor and the game)';

export async function tests(t) {
  const { STORE_KEY, SESSION_KEY, readDrafts, readDraft } = await fresh();

  t.ok('the storage key is exactly the one saved drafts already use', () => {
    if (STORE_KEY !== KEY) throw new Error(`key drifted: ${STORE_KEY}`);
  });

  t.ok('the session slot is named, and a URL asks for it as "session"', () => {
    if (SESSION_KEY !== 'last session (auto)') throw new Error(`session key drifted: ${SESSION_KEY}`);
  });

  t.ok('readDrafts returns {} when storage holds nothing', () => {
    const got = withStorage(null, () => readDrafts());
    if (JSON.stringify(got) !== '{}') throw new Error(`got ${JSON.stringify(got)}`);
  });

  t.ok('readDrafts returns {} rather than throwing on corrupt JSON', () => {
    const got = withStorage('{not json', () => readDrafts());
    if (JSON.stringify(got) !== '{}') throw new Error(`got ${JSON.stringify(got)}`);
  });

  t.ok('readDraft("session") reads the session slot', () => {
    const store = JSON.stringify({ [SESSION_KEY]: { id: 'x', name: 'X' } });
    const got = withStorage(store, () => readDraft('session'));
    if (got?.id !== 'x') throw new Error(`got ${JSON.stringify(got)}`);
  });

  t.ok('readDraft(name) reads a named draft, and returns null when it is missing', () => {
    const store = JSON.stringify({ 'my level': { id: 'mine' } });
    const got = withStorage(store, () => readDraft('my level'));
    if (got?.id !== 'mine') throw new Error(`got ${JSON.stringify(got)}`);
    const missing = withStorage(store, () => readDraft('nope'));
    if (missing !== null) throw new Error(`expected null, got ${JSON.stringify(missing)}`);
  });
}
