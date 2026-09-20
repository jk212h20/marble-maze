//  Where editor drafts live.
//
//  The key is shared *by value* between the level editor (which writes drafts) and the game
//  (which opens one when asked with `?draft=`), so the two can never drift apart. It lives in
//  `src/engine/` because the editor already reads the engine and the game already owns the
//  engine; neither has to reach into the other's directory.
//
//  Drafts are deliberately not levels: they are never compiled into `levels.js`, they live only
//  in the authoring browser, and the game reads them on demand.

/** localStorage key holding `{ [draftName]: spec }`. */
export const STORE_KEY = 'marblemaze.level-editor.drafts.v1';

/** The one slot the editor autosaves into; `?draft=session` in the game means this. */
export const SESSION_KEY = 'last session (auto)';

/** Every draft saved in this browser, or `{}` if storage is unavailable or corrupt. */
export function readDrafts() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

/** One draft spec by name (the session slot is named `session` in a URL). */
export function readDraft(key) {
  const wanted = key === 'session' ? SESSION_KEY : key;
  return readDrafts()[wanted] ?? null;
}
