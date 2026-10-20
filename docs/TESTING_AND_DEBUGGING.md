# Testing and Debugging

Tags: **[Verified]** (read from source, or a command that was actually run — stated explicitly), **[Inferred]**, **[Unknown]**.

## Test framework and configuration

| Item | Detail |
|---|---|
| Runner | **Vitest 5** (`"test": "vitest run"` in `package.json`) |
| Config | `vitest.config.js`: `@vitejs/plugin-react`, `environment: "jsdom"`, `setupFiles: ["./src/test/setup.js"]`, `include: ["src/**/*.test.{js,jsx}"]` |
| Setup file | `src/test/setup.js`: registers jest-axe's `toHaveNoViolations` matcher on Vitest's `expect` and runs RTL `cleanup()` after each test (Vitest globals are *not* enabled, so every test file imports `describe/it/expect/vi` explicitly). |
| Libraries | `@testing-library/react`, `@testing-library/dom`, `@testing-library/user-event`, `jest-axe`, `jsdom` (all devDependencies) |
| Lint | `npm run lint` (ESLint 10 + react-hooks + react-refresh) |

**Last run** (while writing these docs, on the branch `design-system-refactor`): `npm test` → **2 test files passed, 63 tests passed** (some tests are parameterised with `it.each`). `npx eslint .` reported pre-existing findings in `Explanation.jsx`, `BookmarksScreen.jsx`, `LibraryScreen.jsx` and `Timeline.jsx` and none in the Ask files — see [Known issues](./KNOWN_ISSUES_AND_TECHNICAL_DEBT.md#16-lint-findings). Results can change; re-run before relying on them.

## Running tests

```bash
npm test                                   # whole suite, once
npx vitest run src/lib/askApi.test.js      # one file
npx vitest run -t "Intervention not found" # tests matching a name
npx vitest                                 # watch mode
```

## Existing tests and coverage

| File | What it covers |
|---|---|
| `src/lib/askApi.test.js` | `formatTimestamp`; `buildAskBody` (trimming, optional fields, time range, UUID-only `intervention_id`); `askQuestion` request shape and base URL; every error status → `AskError` kind/message/retryable; network failure; non-JSON error body; 90 s timeout (fake timers); caller abort → `AbortError`; the "Intervention not found" retry-once rule and "Video not found" no-retry; malformed 200 bodies; source filtering. |
| `src/components/AskLecture.test.jsx` | Disclosure semantics and focus; label/`input type="text"`/`maxLength`; the three result statuses (headings, no sources for non-answered); source buttons → `onSeek` / `onSelectMoment`; literal rendering of `<b>x</b>`; request body contents (time/intervention rules); empty/over-500 questions; double-submit and `aria-busy`; every error code + Try again; abort on unmount and video change; jest-axe checks (closed, answered, both non-answered statuses, error). |

**Not covered [Verified by absence of test files]:** `Explanation.jsx` (player, pause ownership, announcements, shortcuts), `Home`/`SubjectLectures`/`Timeline`/`Bookmarks`/`Library`/`Sidebar`/`Navbar`, `useLectureSearch`, `useFocusShortcut`, `src/lib/lectureSearch.js` (`extractYouTubeId`), `src/storage.js`, `src/api.js` (mock + real paths), Electron main process, end-to-end flows. All screen-reader behaviour is manual ([ACCESSIBILITY](./ACCESSIBILITY.md#manual-test-checklists)).

## Mocks and utilities used in the existing tests

- `vi.stubGlobal("fetch", vi.fn())` with a small `reply(status, body)` helper returning `{ ok, status, json }`; `vi.unstubAllGlobals()` in `afterEach`.
- A `setup(props)` helper that renders with `onSeek`/`onSelectMoment` spies and sensible defaults.
- `userEvent.setup()` for typing/clicking; `fireEvent.change` to set a value beyond `maxLength`.
- Pending promises (`new Promise(() => {})` / manual `resolve`) to hold a request in flight; `signal.aborted` assertions via `fetchMock.mock.calls[0][1].signal`.
- `vi.useFakeTimers()` + `advanceTimersByTimeAsync` for timeouts.
- `rerender` with a different `videoId` to test the keyed remount.
- `axe(container)` + `toHaveNoViolations`.

## How to write tests for…

**A component** — copy the `AskLecture.test.jsx` pattern: render with props, interact with `userEvent`, query by role/name (`getByRole("button", {name})`), assert ARIA state (`aria-expanded`, `aria-busy`, `aria-disabled`), assert focus via `document.activeElement`, add an axe check per visual state.

**A hook** — `renderHook` from `@testing-library/react`; wrap state changes in `act`; for hooks that attach `window` listeners (`useFocusShortcut`) dispatch `new KeyboardEvent("keydown", { altKey: true, code: "KeyS" })` on `window` and assert `ref.current.focus` was called.

**A storage utility** — `localStorage.clear()` in `beforeEach`; call `saveBookmark`/`getBookmarks`; assert the `synapse-storage-changed` event with `window.addEventListener`; test corrupt data by writing invalid JSON with `localStorage.setItem("synapse_bookmarks", "{")`.

**An API client** — stub `fetch`; assert URL, method, headers, JSON body; test each status → user message; test timeouts with fake timers; test abort; never hit the network. If you touch `src/api.js`, remember `USE_MOCK` is a module constant — to test the real branch you would need to change that constant (or refactor it); there is no test seam today.

**`Explanation.jsx` behaviour** — hard because it needs a fake YouTube player and `Audio`. You would need to: `vi.mock("../lib/youtubeIframeApi")` to resolve a fake `YT.Player` that records calls and lets the test fire `onReady`/`onStateChange`; stub `window.Audio`; `vi.mock("../api")`; use fake timers for the 300 ms watch interval. None of this exists yet.

## What jsdom does not provide

[General jsdom limitations — verify when you hit them.]

- No layout or real CSS cascade: `sr-only`, `hidden`, focus rings, contrast, `inert` effects and viewport behaviour are not meaningfully testable.
- No media playback (`HTMLMediaElement.play` is not implemented), no YouTube iframe/`window.YT`, no `URL.createObjectURL` unless you stub it, no `window.matchMedia` unless you stub it (note `Timeline.jsx` evaluates `window.matchMedia?.(…)` at module load — it is guarded).
- No real assistive technology: axe checks static rules only; colour-contrast rules are not reliable in jsdom.
- No Electron APIs.

## Debugging

### React renderer
- **Browser:** `npm run dev`, open `http://localhost:5173`, use browser DevTools (React DevTools extension optional).
- **Electron:** `npm run electron:dev`. Electron's default application menu is not overridden [Verified], so DevTools should be available from the View menu / Ctrl+Shift+I **[Inferred; not exercised]**.
- StrictMode (`main.jsx`) double-runs effects in development — an effect that appears to run twice is expected; production builds do not.
- `src/api.js` logs `console.error`/`console.warn` with a `[Synapse]` prefix on failures; `getVideoMetadata` logs `Raw oEmbed response:`.
- Stale state suspicion: check module caches in `src/api.js` (`cachedResult`, `_explanationCache`) — reload the page to clear them.

### Electron main process
- `electron.cjs` is ~35 lines; `console.log` there prints to the terminal that ran `npm run electron`/`electron:dev`. No preload/IPC exists to debug.
- Blank window → the Vite dev server is not on port 5173 (see README troubleshooting).

### API calls
- DevTools **Network** tab: filter `video/` to see `/video/process`, `/video/intervention/explain`, `/video/ask`. Check the request body against [API doc](./API_AND_BACKEND_INTEGRATION.md).
- Preflight failures show as `OPTIONS` requests failing in a browser (not in Electron). The ngrok header `ngrok-skip-browser-warning` makes `src/api.js` requests non-simple.
- Check which base URL is in use: `src/api.js` constant vs `VITE_API_BASE_URL` (Ask). Restart Vite after changing env vars.
- Mock vs real: confirm `USE_MOCK` first — most "nothing happens against my backend" reports are mock mode.
- Ask errors: the UI shows friendly text only; inspect the Network response body for the real `detail`.

### YouTube player
- Check `window.YT` in the console and that `https://www.youtube.com/iframe_api` loaded (adblockers/offline break it; `loadYouTubeIframeAPI` never rejects, so failure shows as "Loading lecture player…" forever).
- Playback state: `playerState` in React DevTools on `Explanation`; announcements depend on `onStateChange`, so a non-firing event explains missing "Playing."/"Paused." messages (a 5 s fallback failure message is spoken).
- Some videos disallow embedding; the player would not become ready.
- A `0.5 s` tolerance and 300 ms polling mean seeking exactly over a moment can skip its auto-pause (manual selection marks moments as triggered).

### TTS / explanation audio
- Network tab: the explain POST and then a GET for `audio_file_path` (needs the ngrok header). If the audio GET fails, `audio_file_path` becomes `null` (Listen stays disabled) and a `[Synapse] Audio file not served by backend` warning is logged.
- In mock mode the audio is a generated 220 Hz tone — not speech.
- `audioRef`/`isPlaying` vs `playerState` are independent ([DATA_FLOW_AND_STATE](./DATA_FLOW_AND_STATE.md#4-youtube-playback-vs-explanation-tts)).

## Common failures

| Symptom | Where to look |
|---|---|
| Moments never appear in real mode | `processVideo` failed (red banner) or `getInterventionPoints` threw "No cached result" (console). |
| "Explain failed: 4xx/5xx" in console, subtitle stuck on "Loading this explanation…" | Backend error; no UI error is shown for this — console/Network only. |
| Auto-pause doesn't happen | Video not playing; `pauseOwner` not `null` (user pause); timestamp parse mismatch; moment already in `triggeredPointIdsRef`. |
| Double speech | A new message was routed to two live regions; use `announce()` only (see ACCESSIBILITY). |
| Ask shows "Can't reach the Synapse server" | Backend not running on `VITE_API_BASE_URL`; or CORS in a browser. |
| Tests fail on `getByRole` for the Ask toggle after opening | The toggle's accessible name changes from "+ Ask a question about this lecture" to "− Hide question box". |
| Library has stray entries | Auto-save writes every viewed moment (including mock ones). |

## Missing or unreliable tests

- No coverage for the most complex file (`Explanation.jsx`) or for storage, hooks, search or the mock API.
- No end-to-end test harness (e.g. Playwright) is configured; `CLAUDE.md` mentions ad-hoc Playwright scripts kept in a scratch directory, which are not in the repo.
- Axe in jsdom is limited; real accessibility verification is manual.
- Timers (`announce` 60 ms / 5 s, 300 ms interval) make time-based tests fragile without fake timers.
