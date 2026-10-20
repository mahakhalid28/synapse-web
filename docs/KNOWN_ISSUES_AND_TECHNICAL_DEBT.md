# Known Issues and Technical Debt

Findings from reading the code and running `npm test` / `npx eslint .` while writing these docs. Nothing here was fixed. **Confirmed** = evidenced directly in source or command output. **Needs verification** = plausible from the code but not reproduced. Severity is a judgement call. Line numbers are as of this writing.

> **Update 2026-10-19 (Voice Notes work).** Entries #3, #14, #19 were revised and #23–#24 added after the Voice Notes feature was built and tested. Where an item states how something was checked it uses the labels defined in [VOICE_NOTES_VALIDATION](./VOICE_NOTES_VALIDATION.md): **AUTOMATED** (unit/component tests with fakes), **SCRIPTED-REAL** (a script drove real Electron/Chromium, using Chromium's *fake* microphone), **HUMAN** (reported by the user, steps not recorded) and **NOT TESTED**. Everything else in this file was not re-checked on that date.

## Summary table

| # | Issue | Status | Impact |
|---|---|---|---|
| 1 | `USE_MOCK = true` committed | Confirmed | High — default run isn't talking to a backend |
| 2 | Hard-coded ngrok `API_BASE_URL`; two clients with two base URLs | Confirmed | High |
| 3 | Stale documentation (`CLAUDE.md`, `requirements.txt`, `docs/manualtestingguide`) | Confirmed | Medium |
| 4 | Lecture search is mock | Confirmed | High for real use |
| 5 | "Export audio" is a placeholder tone | Confirmed | Medium |
| 6 | Dead/unused API pieces | Confirmed | Low |
| 7 | "Continue learning" re-processes the video | Confirmed | Medium |
| 8 | Real-mode reopen from Library/Bookmarks | Needs verification | High (if real mode is used) |
| 9 | Silent failures on moment/explanation load | Confirmed | Medium–High (accessibility) |
| 10 | Blob URLs never revoked | Confirmed | Low |
| 11 | Library auto-save is unbounded; stores mock entries | Confirmed | Medium |
| 12 | Storage robustness gaps | Confirmed | Medium |
| 13 | No error boundary | Confirmed | Medium |
| 14 | Electron security and packaging (partly tested 2026-10-19) | Confirmed | High before release |
| 15 | External network dependencies | Confirmed | Low–Medium |
| 16 | Lint findings | Confirmed | Low–Medium |
| 17 | Timeline gaps | Confirmed | Low–Medium |
| 18 | Small touch/click targets in Study mode | Confirmed | Low |
| 19 | Ask feature caveats | Mixed | Medium |
| 20 | Dead code and duplicated helpers | Confirmed | Low |
| 21 | Dependency vulnerability report | Needs verification | Unknown |
| 22 | Stale `frontend/` in the backend repo | Reported by owner | Medium |
| 23 | Voice Notes: accepted limitations | Confirmed | Low–Medium |
| 24 | Voice Notes: scenarios not yet tested | Needs verification | Medium |

---

### 1. `USE_MOCK = true` is committed
- **Evidence:** `src/api.js:1`. `CLAUDE.md` says it should be `false` outside throwaway local testing.
- **Impact:** A fresh checkout runs in mock mode (fake moments `p1`–`p6`, tone audio); backend integration isn't exercised by default. Mock IDs are not UUIDs, so Ask never sends `intervention_id` in this mode.
- **Next step:** agree with the owner of the explanation/audio code which value is canonical and update the docs; consider an env flag instead of a source constant.

### 2. Hard-coded backend URL; two base URLs
- **Evidence:** `src/api.js:14` (`https://nearby-bankroll-heading.ngrok-free.dev`); Ask uses `VITE_API_BASE_URL || "http://127.0.0.1:8000"` (`src/lib/askApi.js`).
- **Impact:** tunnel URLs change; changing the URL requires editing source; Ask and the rest can point at different servers. `ngrok-skip-browser-warning` headers are ngrok-specific and cause CORS preflights in browsers.
- **Next step:** move `API_BASE_URL` to the same env variable and share one config module.

### 3. Stale documentation
- **`CLAUDE.md`:** references tokens `accent-primary`, `accent-subtle`, `border-default` (no longer in `tailwind.config.js`); says Timeline/Bookmarks/Library are unmigrated (they use the new tokens now); says `body { font-serif }` (body is `font-sans`); doesn't mention `AskLecture`. Its "Known pre-existing lint findings" section is partly out of date (see #16).
- **`requirements.txt`:** lists a Cloudflare tunnel URL and endpoints `POST /api/tts`, `GET /api/explanation/:id` that do not exist in `src/api.js`; claims JetBrains Mono is "loaded via CDN" (Fontsource Atkinson Hyperlegible is the real primary font); says "Line 3 — API_BASE_URL" (it is line 14).
- **`docs/manualtestingguide`:** the Ask step still describes the removed "Ask a question about this moment" quick-action buttons ("Explain the main trend") and expects a canned answer.
- **Voice Notes (added 2026-10-19):** only `README.md`, `docs/KEYBOARD_SHORTCUTS.md`, `docs/VOICE_NOTES_VALIDATION.md` and `CLAUDE.md` describe the feature. `ARCHITECTURE.md`, `SCREENS_AND_COMPONENTS.md`, `DATA_FLOW_AND_STATE.md`, `STORAGE_AND_PERSISTENCE.md` (which documents `localStorage` keys only, not the IndexedDB database), `TESTING_AND_DEBUGGING.md`, `DEVELOPMENT_GUIDE.md`, `ACCESSIBILITY.md` (its manual NVDA checklists have no voice-note steps) and `docs/manualtestingguide` do not mention Voice Notes, the `"notes"` screen, IndexedDB, `electron/permissions.cjs` or `electron/youtubeReferer.cjs`.
- **Next step:** update or retire these files; this documentation set is the intended replacement.

### 4. Lecture search is mock
- **Evidence:** `src/lib/lectureSearch.js` returns two fixed videos (`NFZtjSeT3XE`, `dQw4w9WgXcQ`) for every query; TODO for `GET /video/search?q=`. The subject pages (`SubjectLectures`) run the same mock.
- **Impact:** searching cannot find real lectures; selecting a result processes a video unrelated to the query. Mock IDs are unlikely to be processed on the backend (Ask would show "This video isn't available for questions yet.").
- **Next step:** confirm the planned search endpoint and wire it into `src/lib/lectureSearch.js`.

### 5. Export audio is a placeholder
- **Evidence:** `exportToAudio` in `Explanation.jsx` generates a 5 s 220 Hz tone; its comment says to replace it with real TTS.
- **Impact:** the "Export audio" button downloads a non-speech file.
- **Next step:** download the real TTS file (the blob URL is already loaded as `audioUrl`) or hide the button.

### 6. Dead or unused API pieces
- `getJobStatus` / `GET /api/jobs/:id` is exported but never called (the Processing screen was removed).
- `processVideo` accepts `mode` but doesn't send it.
- `Timeline` accepts a `mode` prop it never uses (ESLint `no-unused-vars`, `Timeline.jsx:20`).
- `mockAskAboutVisual` in `Explanation.jsx` is unused (kept behind an eslint-disable comment).
- `Sidebar.jsx` falls back to a `processedAt` field no code writes.
- **Next step:** remove or document once the teammate owning that area agrees.

### 7. "Continue learning" re-processes the video
- **Evidence:** `Home.resumeContinueLecture` passes `resume: true`; `App.handleProcess` destructures only `{url, videoId, mode}` and always calls `processVideo` and starts the lecture from the beginning.
- **Impact:** extra backend work and no position resume. The label ("Last opened: <moment> at <time>") implies resuming.
- **Next step:** decide intended behaviour (open the saved moment via the Library path) and use the flag.

### 8. Reopening saved items in real mode
- **Evidence:** `getInterventionPoints` (real branch) throws `"No cached result. Process the video first."` unless `cachedResult` (in memory, set by `processVideo`) matches the video; Bookmarks and Library open `Explanation` without calling `processVideo`.
- **Impact:** after an app restart, opening a saved item may show the single saved moment (Bookmarks) or an unloaded moment list (Library). Exact runtime behaviour not exercised.
- **Status:** needs verification with a real backend.
- **Next step:** fetch interventions for a processed video from a backend endpoint instead of the in-memory cache, or call `processVideo` for cached videos.

### 9. Silent failures
- **Evidence:** `Explanation.jsx` `.catch` handlers for `getInterventionPoints`, `getExplanation`, `getTTSExplanation` only `console.error`; the processing failure message is generic and the error is discarded.
- **Impact:** a blind user hears nothing about a failed load; subtitle stays "Loading this explanation…" and the heading "Loading your lecture".
- **Next step:** add a `role="alert"` message and retry action using the Ask error pattern.

### 10. Blob URLs never revoked
- **Evidence:** `src/api.js` `getInterventionExplanation` calls `URL.createObjectURL(blob)` and never `revokeObjectURL`; mock `createMockAudioUrl` likewise.
- **Impact:** memory held for the session; each moment adds an audio blob. Low in typical sessions.

### 11. Library auto-save is unbounded and includes mock data
- **Evidence:** the effect in `Explanation.jsx` calls `saveToLibrary` whenever an explanation and real point details are ready; no size cap/pruning in `src/storage.js`.
- **Impact:** every viewed moment becomes a Library entry (also in mock mode: ids like `<videoId>-p1`), growing `localStorage` indefinitely and feeding Home's "Continue learning" with test data.
- **Next step:** cap or dedupe, or only save when the user asks; exclude mock mode.

### 12. Storage robustness
- **Evidence:** `src/storage.js` writes aren't wrapped in `try/catch`; `main.jsx`/`App.jsx` read `synapse_theme` and `Explanation.jsx` reads `synapse_presentation_mode` without `try/catch`; a non-array JSON value in `synapse_bookmarks`/`synapse_library` would break `.filter` (inferred).
- **Impact:** if storage is blocked/full/corrupt the app can throw before or during render. See [STORAGE](./STORAGE_AND_PERSISTENCE.md#failure-behaviour).
- **Next step:** guard reads/writes and validate arrays.

### 13. No React error boundary
- **Evidence:** no `ErrorBoundary`/`componentDidCatch` in `src/`.
- **Impact:** an uncaught render error blanks the whole window — particularly bad for screen-reader users (no announcement).

### 14. Electron security and packaging
- **Evidence:** `electron.cjs` sets `webSecurity: false`; no CSP meta in `index.html`; no preload/IPC; `package.json` has no electron-builder `build` section or packaging script (only `vite build`); `electron-builder` is merely a devDependency; `isDev = !app.isPackaged`. Since the Voice Notes work, `electron/permissions.cjs` applies a deny-by-default permission policy (audio-only microphone, fullscreen and persistent storage from the app page only; AUTOMATED tests, plus SCRIPTED-REAL checks that camera and geolocation are refused in the packaged app) and `electron/youtubeReferer.cjs` adds a Referer for the packaged build (below).
- **Impact:** disabling web security removes same-origin/CORS protections for everything the renderer loads (it embeds YouTube and fetches from a tunnel). There is still no supported way to produce an installer or a packaged copy *from the repository*.
- **What was tested on 2026-10-19** (a scratch **unpacked** build made from the repo's own files, packager configuration kept *outside* the repo, Windows, mock lecture data, real YouTube player, Chromium's fake microphone: SCRIPTED-REAL): `dist/index.html` loads from `app.asar`; the permission policy behaves as above; IndexedDB works and a recorded note survives an app restart; a copy run from a folder with spaces and non-ASCII characters passes the permission and storage checks (the full recording flow was not repeated there). Not tested: an installer (NSIS), code signing, the app icon, auto-update, a second machine, and any request to the real backend.
- **Found while testing, now handled:** a `file://` page sends no Referer, so YouTube showed "Error 153" and the lecture would not play. `electron/youtubeReferer.cjs` adds `Referer: https://synapse.invalid/` to the player's frame request only, when it has none, in the packaged branch only (AUTOMATED unit tests; SCRIPTED-REAL: Error 153 reproduced without it and gone with it). It depends on YouTube's behaviour, which can change.
- **Inferred, not tested:** that the packaged page needs `webSecurity: false` to load its module script over `file://`, and that a packaged app's `localStorage`/IndexedDB are separate from the dev server's (different origins). Neither was checked by changing the setting or by running both against one profile.
- **Next step:** before changing `webSecurity`, re-test the packaged app (module loading and the Ask request's `Origin` header may both change; see #19); add a CSP; define the packaging pipeline (builder config, scripts, icons, code signing) *only if* a distributable is needed. Packaging is not needed for the current development workflow (`npm run electron:dev`).

### 15. External network dependencies
- **Evidence:** `src/index.css` `@import` of Google Fonts; `noembed.com` in `getVideoMetadata`; `i.ytimg.com` thumbnails; `https://www.youtube.com/iframe_api`.
- **Impact:** offline/degraded behaviour (font fallbacks, missing titles, player never ready — `loadYouTubeIframeAPI` has no timeout/rejection) and third-party requests that leak viewing activity.
- **Next step:** remove the redundant Google Fonts import; add a player-load timeout and message.

### 16. Lint findings
Output of `npx eslint .` when this was written (all pre-existing; none in `AskLecture.jsx` or `src/lib/askApi.js`):

| File | Rule | Notes |
|---|---|---|
| `BookmarksScreen.jsx:14` | `react-hooks/set-state-in-effect` | `setBookmarks(getBookmarks())` in an effect on mount |
| `LibraryScreen.jsx:16` | `react-hooks/set-state-in-effect` | same pattern |
| `Explanation.jsx:322`, `:512` | `react-hooks/set-state-in-effect` | synchronous setState at the top of the videoId effect and the explanation-loading effect |
| `Explanation.jsx:728`, `:870` | `react-hooks/purity` | `Date.now()` in `handleBookmark` / the auto-save effect |
| `Explanation.jsx:606`, `:872` | `react-hooks/exhaustive-deps` | audio effect depends only on `audioUrl`; auto-save effect has an incomplete dependency list (intentional, per comments) |
| `Explanation.jsx:856` | unused `eslint-disable` directive | |
| `Timeline.jsx:20` | `no-unused-vars` | unused `mode` prop |
| `Timeline.jsx:56` | `react-hooks/exhaustive-deps` | points effect omits `videoId` |

`CLAUDE.md`'s older list names only Explanation and Sidebar; the Sidebar finding is no longer reported. Fix only when asked (project rule), but don't add new ones.

### 17. Timeline gaps
- SVG marker clicks are mouse-only (`Marker` `onClick` on an `aria-hidden` SVG); the list is the keyboard path.
- The points effect omits `videoId` from its dependencies (harmless today because the screen remounts per lecture).
- Timeline isn't offered from Accessibility mode (`View full timeline` is Study-mode only).
- `prefersReducedMotion` is read once at module load.

### 18. Small targets in Study mode
Text-size (28 px), High contrast (28 px), Focus toggle (28 px) and Listening speed (36 px min) are below the 44 px used for primary controls.

### 19. Ask feature caveats
- The `/video/ask` contract is not stored in this repo and was **not verified against a running backend**; CORS from the ngrok-hosted backend is unknown.
- NVDA may speak the result twice (focus moved to the heading *and* an `aria-live` result region) — needs a real screen-reader check.
- `intervention_id` is sent whenever `pauseOwner !== null`, which includes the case where the learner paused mid-lecture with the Pause button; the "active moment" may then be unrelated to the playhead (the backend returns 404 "Intervention not found" only for unknown ids, which are retried without the id; a *valid but unrelated* moment id would be accepted).
- Because the Ask button uses `aria-disabled` and double submits are ignored, a "newer question aborts the older one" cannot occur through the UI; aborts happen on unmount/video change.
- Math in answers is plain text; no renderer exists.
- `docs/manualtestingguide` still describes the removed mock Ask box.
- **Packaged app (2026-10-19):** the Ask request left the packaged app with **no `Origin` header**, observed against a local *stand-in* server that mimics the backend's documented origin rule (SCRIPTED-REAL; **not** the real backend, no pipeline or model was called). The backend's origin guard lets requests without an `Origin` through, so Ask should work from the packaged app, but this was **not verified against the real backend** (NOT TESTED). The base URL (`VITE_API_BASE_URL`, default `http://127.0.0.1:8000`) is fixed when the app is built.
- **If `webSecurity` is ever enabled** the page is expected to send `Origin: null` (per the backend README; **[Inferred]**, not tested here). The backend answers that with `403 "Origin not allowed"` unless `null` is added to `SYNAPSE_CORS_ORIGINS`, which its README describes as a trade-off.

### 20. Dead code and duplication
- Two timestamp parsers (`parseTimestampToSeconds` in `Explanation.jsx`, `parseTimeToSeconds` in `Timeline.jsx`), three formatters (`formatTime`, `secondsToTime`, `secondsToMMSS`) plus `formatTimestamp` in `src/lib/askApi.js`, and `capitalize` copied into four components.
- `Explanation.jsx` is a ~2,190-line file mixing player control, audio, announcements, layout and PDF/WAV export.

### 21. Dependency vulnerability report
- **Evidence:** `npm install` of the test dependencies (2026-10-14) printed "40 vulnerabilities (1 low, 8 moderate, 28 high, 3 critical)". `npm audit` details were not inspected.
- **Status:** needs verification. Likely concentrated in the Electron/electron-builder toolchain [inferred], but unknown. Run `npm audit` and triage; do not blindly `npm audit fix --force`.

### 22. Stale frontend copy in the backend repository
The backend repository contains an older `frontend/` directory. It is **not** documented here and must not be treated as the current frontend (per the project owner). Avoid editing it; plan its removal separately.

### 23. Voice Notes: accepted limitations
- **Closing the window during a recording discards it, without asking.** The microphone is released and the audio is dropped. Leaving the *screen* does offer Save / Discard / Stay. Offering a prompt on window close would need main-process code (IPC and a preload), which the app deliberately does not have. Confirmed by the code and by an AUTOMATED test.
- **Notes live only on this computer, unencrypted, with no export, backup or sync.** The code does not send them anywhere (the storage module is AUTOMATED-tested not to use the network or `localStorage`). If browser storage is cleared the notes go with it; the app asks for persistent storage, which it was granted in the scripted runs (SCRIPTED-REAL), but that does not protect against deleting the profile folder.
- **Expected, not tested:** dev (`http://localhost:5173`) and a packaged build (`file://`) are different origins and so should not share notes.
- **A note has no title editing**; it is named by its lecture time ("Voice note at 3:21").
- **Opening a note that has no saved moment** shows the lecture's first moment's explanation, cued at the note's time (the explanation text and the video position can then differ).
- The Record button and Alt+M do nothing while a note is being saved or while an unsaved recording is waiting for Save / Discard.

### 24. Voice Notes: scenarios not yet tested
Taken from [VOICE_NOTES_VALIDATION](./VOICE_NOTES_VALIDATION.md); all **NOT TESTED** with the real thing:
- the Windows "Let desktop apps access your microphone" switch turned **off** (the message and recovery are tested only with a block applied inside Electron);
- no microphone device, and a microphone busy in another app;
- a real 5-minute recording reaching the limit (fake timers only);
- the installer, code signing and icon (see #14); JAWS, Narrator, macOS, Linux; Ask against the real backend (see #19);
- the exact steps behind the reported **HUMAN** results (real Windows microphone; NVDA): the Windows and NVDA versions, whether the dev or packaged app was used, and whether Alt+M itself was pressed under NVDA were not recorded.

## Missing information (could not be established from this repo)

- The backend's real response schemas and error bodies beyond what the frontend reads.
- The Node version the team uses; the production/packaging target (an installer, signing and an icon have not been tried).
- Whether `/video/search`, `/api/jobs/:id` exist on the backend.
- Behaviour with JAWS/VoiceOver, on macOS/Linux, and under Windows High Contrast.
- Real-backend behaviour of any flow (no backend calls were made; the 2026-10-19 Ask check in the packaged app used a local stand-in server, not the real backend).
