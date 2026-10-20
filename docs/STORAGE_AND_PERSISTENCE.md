# Storage and Persistence

Every persistence mechanism in the frontend. Tags: **[Verified]** (read from source), **[Inferred]**, **[Unknown]**.

## Mechanisms in use

| Mechanism | Used? |
|---|---|
| `window.localStorage` | **Yes** — the only persistent store. |
| `sessionStorage`, IndexedDB, cookies, Electron storage / files | **No** [Verified by grep of `src/` and `electron.cjs`]. |
| In-memory module variables (`src/api.js`) | Yes, but not persistent: `cachedResult`, `_explanationCache`, `mockJobStartTime`. |
| Backend persistence | Not accessed for saved items; Bookmarks/Library are purely local. The backend stores its own processed-lecture data [Unknown]. |

Because there is no Electron file or `userData` usage, "storage" in the Electron app is Chromium's `localStorage` for the page origin (`http://localhost:5173` in dev). A packaged build would load from `file://` — a different origin — so data saved in dev would **not** appear there [Inferred; packaging is not set up, see [Known issues](./KNOWN_ISSUES_AND_TECHNICAL_DEBT.md)]. Likewise, running `npm run dev` in a browser tab and in the Electron window uses separate storage.

## Keys

| Key | Written by | Read by | Value |
|---|---|---|---|
| `synapse_bookmarks` | `src/storage.js` (`saveBookmark`, `removeBookmark`) | `getBookmarks`, `isBookmarked` | JSON array of bookmark objects, newest first. |
| `synapse_library` | `src/storage.js` (`saveToLibrary`, `removeFromLibrary`) | `getLibrary` | JSON array of library items, newest first. |
| `synapse_theme` | `App.jsx` (effect on `theme`) | `main.jsx` (before first render), `App.jsx` (initial state) | `"paper"` (default) \| `"night"` \| `"sepia"`. |
| `synapse_presentation_mode` | `Explanation.jsx` (effect) | `Explanation.jsx` (initial state) | `"accessibility"` (default) \| `"study"`; any other value is ignored. |
| `synapse_tts_rate` | `Explanation.jsx` `changeRate` | `Explanation.jsx` (initial state) | A number string from `RATES` (`0.75, 1, 1.25, 1.5, 2`); anything else falls back to `1`. |
| `synapse_intro_seen` | `Explanation.jsx` (first-lecture hint) | same | `"1"` once the one-time spoken hint about Play/Listen/Alt+K has been given. |

No other keys exist. Not persisted: text scale, high contrast, active tab, Ask content, search text, last position in a video.

## Data shapes

### Bookmark (`synapse_bookmarks` item) — built in `Explanation.handleBookmark`

```js
{
  id: `${videoId}-${pointId}`,   // unique key; saveBookmark replaces an item with the same id
  pointId, videoId, jobId, videoTitle,
  title, category, timestamp, mode,          // mode = depth string
  explanation: { subtitle, paragraphs: string[], keyInsight },
  savedAt: Date.now()
}
```

### Library item (`synapse_library` item) — built by the auto-save effect in `Explanation.jsx`

```js
{
  id: `${videoId}-${pointId}`,
  pointId, videoId, jobId, videoTitle,
  title, category, timestamp, mode,
  explanation,            // the whole explanation object (includes pointId, subtitle, paragraphs, keyInsight)
  savedAt: Date.now()
}
```

`Sidebar.jsx` also reads `processedAt` as a fallback date (`savedAt || processedAt`); no code in this repo writes `processedAt` [Verified], so it is presumably from an older format [Inferred].

## Operations (all in `src/storage.js`)

| Function | Behaviour |
|---|---|
| `getBookmarks()` / `getLibrary()` | `JSON.parse(localStorage.getItem(KEY) || "[]")` inside `try/catch`; any parse error returns `[]`. |
| `saveBookmark(b)` / `saveToLibrary(item)` | Reads the list, removes any entry with the same `id`, `unshift`s the new one, writes the whole array, then calls `notify()`. Re-saving moves the item to the top and refreshes `savedAt`. |
| `removeBookmark(id)` / `removeFromLibrary(id)` | Filters the list, writes, notifies. |
| `isBookmarked(id)` | `getBookmarks().some(b => b.id === id)`. |

### Change notification

`src/storage.js` exports `STORAGE_CHANGED_EVENT = "synapse-storage-changed"` and dispatches `new Event(...)` on `window` after every write. **Only `Sidebar.jsx` listens** (it refreshes the bookmark count and "Recently processed"). `BookmarksScreen` and `LibraryScreen` read storage once on mount and then manage their own state (they call `getBookmarks()`/`getLibrary()` again after their own removals). The native `storage` event (other tabs/windows) is not handled.

### Side effects to be aware of

- **Viewing creates saved data.** Every time a moment's explanation loads on the lecture screen, `saveToLibrary` runs automatically (once the explanation and real point details exist). The Library is therefore a history of viewed moments, not a user-curated list.
- **Auto-save happens in mock mode too**, so mock moments (ids like `<videoId>-p1`) end up in the Library and Home's "Continue learning" card.
- Bookmark/Library items store the full explanation text, so they can be opened without refetching the text.

## Failure behaviour

| Situation | Result |
|---|---|
| Key missing | Lists default to `[]`; theme `"paper"`; presentation mode `"accessibility"`; rate `1`. |
| Corrupt JSON in `synapse_bookmarks`/`synapse_library` | Treated as empty (`catch → []`); the next write overwrites the corrupt value (data loss). |
| Valid JSON that is not an array (e.g. `{}`) | `getBookmarks()` returns that value as-is; `.filter`/`.some` then throws a `TypeError` [Inferred — not guarded]. |
| `setItem` throws (quota, storage disabled) | **Not caught** in `src/storage.js`, `App.jsx` or the presentation-mode effect — an exception would surface in the effect/handler. Only the TTS-rate write and the one-time intro flag are wrapped in `try/catch`. |
| `getItem` throws | `synapse_tts_rate` and `synapse_intro_seen` reads are wrapped; the reads of `synapse_theme` (`main.jsx`, `App.jsx`) and `synapse_presentation_mode` are **not** (an exception before first render would prevent the app from mounting) [Verified]. |
| Items from an older format | Rendering code defends against some missing fields (e.g. optional `explanation.subtitle`, `videoTitle`), but there is no schema version or migration [Verified]. |

## Lifetime and limits

- Data persists until the user clears site data, or the app's origin changes. There is no export/import, no sync and no expiry.
- `localStorage` is typically limited to a few MB per origin [general browser behaviour, not measured here]; items include full explanation text, and the Library grows with every viewed moment with no cap or pruning code [Verified].
- Development vs packaged: see above — different origins mean separate data.

## Guidelines for adding persisted data

1. Prefix keys with `synapse_` and register the key in this document.
2. Wrap **both** `getItem` and `setItem` in `try/catch` and render correctly without the value (see the TTS-rate and intro-flag code in `Explanation.jsx` for the pattern; put new list-like data in `src/storage.js`).
3. Validate on read: `Array.isArray`, expected field types, enum membership (as done for presentation mode and rate).
4. If other components display derived numbers from the data, call `notify()` after writes and subscribe via `STORAGE_CHANGED_EVENT` (as `Sidebar` does) instead of reading once.
5. Use stable, deterministic ids (`${videoId}-${pointId}`) so repeated saves replace rather than duplicate.
6. Consider a version field if you change an object's shape; none exists today.
7. Do not store secrets or personal data without a deliberate decision — the store is plain text and unencrypted.
8. Add unit tests with `localStorage` cleared between tests (jsdom provides `localStorage`).
