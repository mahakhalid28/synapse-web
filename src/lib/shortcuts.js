// The one list of keyboard shortcuts. Three things read it, so they cannot drift apart:
//   - the lecture screen's key handler (Explanation.jsx looks up an action by the key's `code`),
//   - the "Keyboard shortcuts" list shown on the lecture screen and in the Help dialog,
//   - the spoken list that Alt+K reads aloud.
// It describes shortcuts that already exist. Adding a row here does nothing by itself: a handler for its
// action id must also exist (the drift test fails if a row has none, or a handler has no row).
//
// Alt+S is different: it is bound by hooks/useFocusShortcut.js on Home and the subject pages, which
// still takes its own letter. HOME_SHORTCUT_ROWS documents it, and a test checks the two agree.

/**
 * One row per line shown to the learner. A row can carry more than one action (faster and slower
 * share a line). `code` is KeyboardEvent.code, matched the way the key handler matches it.
 */
export const LECTURE_SHORTCUT_ROWS = [
  { description: "Play, pause or resume the lecture", actions: [{ id: "playPause", code: "KeyP", key: "Alt+P" }] },
  { description: "Listen to or pause the explanation audio", actions: [{ id: "listen", code: "KeyL", key: "Alt+L" }] },
  { description: "Next moment", actions: [{ id: "next", code: "KeyN", key: "Alt+N" }] },
  { description: "Previous moment", actions: [{ id: "previous", code: "KeyB", key: "Alt+B" }] },
  { description: "Read: jump to the start of the explanation", actions: [{ id: "read", code: "KeyR", key: "Alt+R" }] },
  {
    description: "Listen faster / slower",
    actions: [
      { id: "faster", code: "Period", key: "Alt+." },
      { id: "slower", code: "Comma", key: "Alt+," },
    ],
  },
  { description: "Start or stop a voice note", actions: [{ id: "voiceNote", code: "KeyM", key: "Alt+M" }] },
  { description: "Hear this list", actions: [{ id: "hearShortcuts", code: "KeyK", key: "Alt+K" }] },
];

/** Alt+S on Home and the subject pages (bound by hooks/useFocusShortcut.js). */
export const HOME_SHORTCUT_ROWS = [
  { description: "Jump to the lecture link or search field", actions: [{ id: "search", code: "KeyS", key: "Alt+S" }] },
];

/** "Alt+P" -> "Alt plus P", "Alt+." -> "Alt plus period", "Alt+," -> "Alt plus comma". */
export function spokenKey(key) {
  const rest = key.replace(/^Alt\+/, "");
  const name = rest === "." ? "period" : rest === "," ? "comma" : rest;
  return `Alt plus ${name}`;
}

/** The keys of a row as shown: "Alt+P", or "Alt+. / Alt+,". */
export function rowKeys(row) {
  return row.actions.map((a) => a.key).join(" / ");
}

/** The keys of a row as spoken: "Alt plus P", or "Alt plus period, or Alt plus comma". */
export function rowSpokenKeys(row) {
  return row.actions.map((a) => spokenKey(a.key)).join(", or ");
}

/** What Alt+K reads aloud. */
export const LECTURE_SHORTCUTS_SPOKEN =
  "Keyboard shortcuts. " +
  LECTURE_SHORTCUT_ROWS.map((row) => `${rowSpokenKeys(row)}: ${row.description}.`).join(" ");

export const LECTURE_ACTION_IDS = LECTURE_SHORTCUT_ROWS.flatMap((row) => row.actions.map((a) => a.id));

const ACTION_BY_CODE = new Map(
  LECTURE_SHORTCUT_ROWS.flatMap((row) => row.actions.map((a) => [a.code, a.id])),
);
const KEY_BY_ACTION = new Map(
  [...LECTURE_SHORTCUT_ROWS, ...HOME_SHORTCUT_ROWS].flatMap((row) => row.actions.map((a) => [a.id, a.key])),
);

/** The lecture action for a KeyboardEvent.code, or null if that key is not a lecture shortcut. */
export function lectureActionForCode(code) {
  return ACTION_BY_CODE.get(code) ?? null;
}

/** The display key of one action ("playPause" -> "Alt+P"), so copy never retypes it. */
export function keysForAction(id) {
  return KEY_BY_ACTION.get(id);
}
