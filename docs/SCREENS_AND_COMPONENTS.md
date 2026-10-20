# Screens and Components

Inventory of every screen and significant component. See [ARCHITECTURE](./ARCHITECTURE.md) for how they connect and [DATA_FLOW_AND_STATE](./DATA_FLOW_AND_STATE.md) for state flow. Tags: **[Verified]**, **[Inferred]**, **[Unknown]**. Line numbers drift; search by the function names given.

All components live in `src/components/` unless noted. Every full screen renders `<nav aria-label="Main navigation"><Sidebar/></nav>` plus a `<main id="main-content" tabIndex={-1}>` (the skip-link target).

---

## `src/App.jsx` — root, router, theme

- **Responsibility:** the only router. Owns `screen`, `jobInfo`, `exploreSubject`, `hasLeftHome`, `theme`. Renders the shared skip link, `Navbar`, and the active screen.
- **Rendered by:** `src/main.jsx`.
- **State:** see [ARCHITECTURE](./ARCHITECTURE.md#screen-selection-and-navigation).
- **Handlers:** `handleProcess({url, videoId, mode})` (calls `resetMockTimer()`, starts `processVideo()` un-awaited, stores the promise in `jobInfo`, goes to `"explanation"`), `handleOpenPoint(point)` (Timeline→Explanation), `handleOpenTimeline(pointId)` (Explanation→Timeline), `handleOpenBookmark(bookmark)`, `handleOpenLibraryExplanation({pointId, videoId, jobId, mode, autoPlay})`, `handleNavigate(key)`, `handleExploreSubject(subject)`.
- **Effects:** focus the new screen's first `main h1` on change (skipped on first render and for `timeline`); set `document.title` per screen; persist `theme` to `localStorage["synapse_theme"]` and set `data-theme` on `<html>`.
- **Change here when:** adding a screen or changing what data is carried between screens. Risky: the focus effect and `hasLeftHome` logic exist to avoid focus-stealing bugs ([ACCESSIBILITY](./ACCESSIBILITY.md#focus-on-navigation)).
- **Note [Verified]:** `Home` calls `onProcess({..., resume: true})` for "Continue learning"; `handleProcess` ignores `resume`, so it runs `processVideo` again.

## `src/components/Navbar.jsx` — top bar and theme settings

- **Props:** `theme` (`"paper"|"night"|"sepia"`), `onThemeChange(key)`.
- **State:** `open` (settings panel), `themeMessage` (spoken confirmation).
- **Behaviour:** gear button (`aria-label="Settings"`, `aria-expanded`) toggles a panel of three `aria-pressed` theme buttons; outside `mousedown` closes it; Escape closes and refocuses the gear; choosing a theme announces "<Label> theme applied." via a local `role="status"` region (cleared after 4 s) and returns focus to the gear.
- **Change here to:** add a theme (also add CSS variables in `src/index.css` — see [STYLING](./STYLING_AND_DESIGN_SYSTEM.md)). The panel says "More settings coming soon." — no other settings exist.

## `src/components/Sidebar.jsx` — left navigation

- **Props:** `active` (`"home"|"library"|"bookmarks"`), `onNavigate(key)`.
- **State:** `bookmarkCount`, `recentVideo`. An effect reads `getBookmarks()`/`getLibrary()` on mount/`active` change and subscribes to the `synapse-storage-changed` window event ([STORAGE](./STORAGE_AND_PERSISTENCE.md)).
- **Renders:** wordmark; Home/Library/Bookmarks buttons (`aria-current="page"` on the active one; bookmark count visible plus sr-only ", N saved"); a "Recently processed" footer showing `getLibrary()[0]` (title via `videoTitle || title`, date from `savedAt || processedAt`).
- **Not a second `<nav>`:** the parent screen wraps it in the labelled `<nav>`.
- **Note [Verified]:** "Settings" is deliberately not a sidebar item (Navbar owns it).

## `src/components/Home.jsx` — start a lecture

- **Props:** `onProcess`, `onNavigate`, `onExploreSubject`, `focusHeadingOnMount`, `continueLecture` (optional override; default is derived from the Library), `defaultDepth="standard"`.
- **Uses:** `useLectureSearch`, `useFocusShortcut` (Alt+S), `LectureResultsList`, `getLibrary`.
- **Sections:** H1 "Start a study session" → intro paragraph → optional "Continue learning" button (most recent Library item that has a `videoId`) → "Start a new lecture" (input labelled "Lecture link or search", results list, submit button) → "Explore a subject" (Mathematics, Physics, Computer Science, Chemistry, Biology).
- **Key functions:** `handleSelectResult` (puts the video URL in the field, clears results, announces, refocuses the input), `resumeContinueLecture` (calls `onProcess` with `resume: true`).
- **Live region:** one `aria-live="polite"` div holding `statusMessage` from the hook.
- **Change here to:** add sections or change the primary flow. Search behaviour belongs in `useLectureSearch` / `src/lib/lectureSearch.js`.

## `src/components/SubjectLectures.jsx` — one component for all subjects

- **Props:** `subject`, `onProcess`, `onNavigate`, `defaultDepth`.
- Uses the same hook/list as Home with `initialQuery: subject`; runs a search for the subject on mount (`useEffect` on `subject`); focuses its H1 on mount; result rows start learning immediately (`startLearning`, `showAction`).
- Results are **mock** ([API doc](./API_AND_BACKEND_INTEGRATION.md#search-is-mock-only)).

## `src/components/LectureResultsList.jsx` — shared result rows

- **Props:** `results`, `headingRef`, `heading="Search results"`, `headingLevel="h3"`, `onSelect(video)`, `getAriaLabel(result, index)`, `showAction`.
- Renders a focusable heading (`tabIndex=-1`, receives focus when results arrive via the hook) and a `<ul>` of `ds-row` buttons whose accessible name is `getAriaLabel(...)` (visual text is `aria-hidden` to avoid double reading). Returns `null` for an empty list.

## `src/hooks/useLectureSearch.js` — shared search logic

- **Arguments:** `{ onProcess, defaultDepth="standard", initialQuery="" }`.
- **Returns:** `url, setUrl, results, setResults, searching, statusMessage, setStatusMessage, resultsHeadingRef, videoId, isValidUrl, runSearch, handleSubmit, handleUrlChange, startLearning`.
- **Logic:** `videoId = extractYouTubeId(url)`. `handleSubmit`: valid URL → `onProcess({url, videoId, mode})`; empty → status "Please enter a lecture link or a search term."; otherwise `runSearch`. `handleUrlChange` announces "YouTube lecture detected." only on the not-valid→valid edge. A `useEffect` focuses the results heading when results appear.

## `src/hooks/useFocusShortcut.js` — Alt+letter focuses a field

`useFocusShortcut(inputRef, letter="s")`: window `keydown` listener; Alt (without Ctrl/Meta/Shift) + the letter focuses and selects the input. Used by Home and SubjectLectures. Falls back to `e.key` if `e.code` is empty (some assistive-tech key events).

## `src/lib/lectureSearch.js`

`searchVideos(query)` — **mock**: waits 500 ms and returns two fixed videos (`NFZtjSeT3XE`, `dQw4w9WgXcQ`) with titles built from the query. `extractYouTubeId(raw)` — regex extraction of an 11-character ID from `watch?v=`, `youtu.be/`, `shorts/`, `embed/` URLs. The file's TODO says to swap in a real `GET /video/search?q=` [Unknown whether that endpoint exists].

## `src/lib/youtubeIframeApi.js`

`loadYouTubeIframeAPI()` returns a singleton promise resolving to `window.YT`; injects `https://www.youtube.com/iframe_api` once and chains any pre-existing `window.onYouTubeIframeAPIReady`. No error/timeout handling [Verified: the promise never rejects].

---

## `src/components/Explanation.jsx` — the lecture screen (~2,190 lines)

The most complex file. Treat it by responsibility.

- **Rendered by:** `App` when `screen === "explanation" && jobInfo`.
- **Props:** `jobId`, `videoId`, `pointId=null` (start on this moment), `mode="standard"` (depth), `promise=null` (in-flight `processVideo`), `bookmarkData=null` (pre-populates one point + explanation from a bookmark), `autoPlay=false` (start explanation audio when opened from Library "Play audio"), `onNavigate`, `onOpenTimeline(pointId)`.
- **Child components:** `Sidebar`, `MomentMarker`, `ProvenanceLabel`, `CategoryIcon`, `AskLecture`, `ClockIcon` (local).

### Functional breakdown

| Responsibility | Key state / refs / functions |
|---|---|
| **Announcements** | `srAnnouncement`, `announce(msg)` (clear → set after 60 ms → clear after 5 s), `announceTimerRef`. The single `role="status" aria-live="polite" sr-only` region sits in the video block. |
| **Honest player-state announcements** | `expectPlayerState(target, okMsg, failMsg)` registers an expectation in `expectedStateRef`; the YouTube `onStateChange` calls `confirmPlayerStateRef.current(name)`; a 5 s timer announces `failMsg` if the state never arrives. Ensures "Playing."/"Paused." are only spoken once true. |
| **Processing banner** | `isProcessing`, `processingError`, `processingProgress` (estimated over `ESTIMATED_MS = 90_000`, capped at 95 until the promise resolves). Tracks the `promise` prop. |
| **Loading moments** | Effect calling `getInterventionPoints(jobId, videoId)` once processing finishes → `allPoints`, `videoTitle/Duration/Author`; announces "Lecture ready. N moments found…" (plus a one-time hint on the first-ever lecture, gated by `synapse_intro_seen`). |
| **YouTube player** | Effect on `videoId` calls `loadYouTubeIframeAPI()` and creates `new YT.Player(playerContainerRef.current, {videoId, playerVars:{rel:0}, events})`; `playerRef`, `playerReady`, `playerState` (`"unstarted"|"playing"|"paused"|"buffering"|"ended"`), `PLAYER_STATE_NAMES`. Cleanup destroys the player. An initial-cue effect (`initialCueDoneRef`) cues the video at the opened moment's timestamp. |
| **Auto-pause at moments** | Effect that runs a 300 ms `setInterval` only while `playerReady && pauseOwner === null`; when `|getCurrentTime() − pointSeconds| ≤ 0.5` for an untriggered point (`triggeredPointIdsRef`), it pauses, sets `pauseOwner="intervention"`, sets the active point, announces and focuses the Explanation heading (accessibility mode). |
| **Explanation text + TTS** | Effect on `[effectiveActivePointId, mode, videoId]`: `getExplanation()` → `explanation`; `getTTSExplanation()` → `audioUrl` (shares one HTTP request via `_explanationCache` in `src/api.js`); `cancelled` flag guards stale responses. |
| **TTS playback** | Effect on `audioUrl` builds `new Audio(audioUrl)`, binds `timeupdate`/`loadedmetadata`/`ended`; `onEnded` marks the point as heard (`playedPointIds`) and **auto-resumes the video only if `pauseOwnerRef.current === "intervention"`**. `togglePlay`, `changeRate`/`stepRate` (`RATES = [0.75,1,1.25,1.5,2]`, persisted as `synapse_tts_rate`). |
| **Pause ownership** | `pauseOwner` + `pauseOwnerRef`; `selectPointManually(id)` (seek+pause, owner `"user"`, marks the point triggered, announces, focuses heading), `handleLectureToggle` (Play/Pause button + Alt+P), `handleResumeVideo`, `handleAskSeek(seconds)` (source button seek: seek, pause, owner `"user"`, announce). `onStateChange` resets owner to `null` on any transition to PLAYING. |
| **Presentation mode** | `presentationMode` (persisted `synapse_presentation_mode`, default `"accessibility"`), `presentationModeRef`, `switchPresentationMode`. Accessibility mode: video region `sr-only` + `inert`, status text, "Play lecture" button, "Accessible visual information", "Moments in this lecture" list. Study mode: visible video, Visual/Structured tabs, text-size and High-contrast controls, "Lecture Details" aside with the moments stepper and "View full timeline". |
| **Visual aids (Study)** | `visualTab` / `effectiveVisualTab`, `handleVisualTabKeyDown` (arrow/Home/End), `focusActive` + `computeFocusTransform(region)` (CSS scale/translate of the video wrapper — no pixel access to the cross-origin iframe), `textScale` (0.85–1.6), `highContrast`. |
| **Structured data** | `activePoint.structured?.rows`, `focusRegion` — passthrough only; real backend does not send them yet ([API doc](./API_AND_BACKEND_INTEGRATION.md)). |
| **Bookmark / Library** | `handleBookmark` (+ `bookmarked`), an effect that calls `saveToLibrary` automatically once `explanation` and real point details exist. |
| **Export** | `exportToPDF` (jsPDF; module-level function), `exportToAudio` (**placeholder tone**), `createWavBlob`, `slugify`. |
| **Keyboard shortcuts** | `shortcutsRef` (rebuilt every render) + one window `keydown` listener bound once. See [KEYBOARD_SHORTCUTS](./KEYBOARD_SHORTCUTS.md). |
| **Ask** | Mounts `<AskLecture>` after the key insight; passes `videoId`, `getCurrentTime`, `activeInterventionId`, `onSeek`, `onSelectMoment`, `knownMomentIds`. |

### Derived values worth knowing

`effectiveActivePointId = activePointId ?? allPoints[0]?.id ?? null`; `activePoint` falls back to a placeholder titled "Preparing your lecture"/"Loading your lecture" (the screen's `<h1>`); `currentIndex/prevPoint/nextPoint` come from `allPoints` (arrival order), while the visible lists use `sortedPoints` (by timestamp).

### Where to change things

- Add/alter a spoken message → `announce(...)` call at the relevant handler (keep one message per event; see [ACCESSIBILITY](./ACCESSIBILITY.md#avoiding-duplicate-speech)).
- Change auto-pause tolerance → the `0.5` comparison in the watch-interval effect.
- New shortcut → `shortcutsRef.current` object **and** the `SHORTCUTS` array at the top of the file.
- New control tied to moment navigation → go through `selectPointManually` so pause ownership stays correct.
- Dead code [Verified]: `mockAskAboutVisual` (top of file) is unused and kept only behind an `eslint-disable` comment.

**Risky:** the interaction between `pauseOwner`, `pauseOwnerRef`, `triggeredPointIdsRef`, the 300 ms interval and the audio `ended` handler. Read [DATA_FLOW_AND_STATE](./DATA_FLOW_AND_STATE.md#4-youtube-playback-vs-explanation-tts) before editing.

---

## `src/components/AskLecture.jsx` — lecture-wide Q&A

- **Rendered by:** `Explanation` (after the key insight, before the audio controls). The default export is a thin wrapper that renders `AskLectureInner` with `key={videoId}`, so changing video remounts it (clears answer/input, aborts the request).
- **Props:** `videoId`; `getCurrentTime()` (seconds; may return `undefined`/`NaN`); `activeInterventionId` (string or null — only UUID-shaped ids are ever sent); `onSeek(seconds)`; `onSelectMoment(id)` (optional); `knownMomentIds` (array of loaded moment ids).
- **State:** `open`, `question`, `busy`, `result` (`{status, scope, answer_text, sources}`), `error` (`{message, retryable}`); refs `abortRef`, `busyRef`, `requestIdRef`, `headingRef`, `focusPendingRef`.
- **UI:** disclosure button (`aria-expanded`, `aria-controls`) → `<form>` with a real `<label>`, `input type="text" maxLength=500`, Ask button (uses `aria-disabled`/`aria-busy`, not `disabled`, so focus is not dropped), character count (referenced by `aria-describedby`), sr-only `role="status"` loading region ("Looking for the answer..."), `role="alert"` error region with optional "Try again", and an `aria-live="polite"` result region.
- **Result headings:** `answered` → "Answer" (+ "Where in the lecture" list of source buttons); `insufficient_context` → "I couldn't find that"; `not_in_lecture` → "Not covered in this lecture". Focus moves to the heading only after a submitted question produces a result.
- **Sources:** button label `Jump to m:ss to m:ss` (or a single time); if the source has an `intervention_id` that is in `knownMomentIds` and `onSelectMoment` exists, the label is "Jump to the moment you were viewing" and `onSelectMoment(id)` is called; otherwise `onSeek(start_seconds)`.
- **Race handling:** `requestIdRef` ignores stale responses; double submits are ignored via `busyRef`; the request is aborted on unmount.
- **How `Explanation` feeds it:** `activeInterventionId={pauseOwner !== null ? effectiveActivePointId : null}` — i.e. only while the learner has selected or paused on a moment, not while the lecture merely plays past one. See the [API doc](./API_AND_BACKEND_INTEGRATION.md#ask-a-question-post-videoask).
- **Tests:** `src/components/AskLecture.test.jsx`.

## `src/lib/askApi.js` — Ask client

`askQuestion({videoId, question, currentTimeSeconds, interventionId, signal})`, `buildAskBody`, `formatTimestamp`, `isValidVideoId`, `isRealInterventionId`, `AskError`, `ERROR_MESSAGES`, constants. Full detail in the [API doc](./API_AND_BACKEND_INTEGRATION.md#ask-a-question-post-videoask).

---

## `src/components/Timeline.jsx` — all moments at a glance

- **Props:** `jobId`, `videoId`, `pointId=null` (preselect), `mode` (**accepted but unused** — ESLint reports it), `onOpenPoint(point)`, `onNavigate`.
- **State:** `data` (result of `getInterventionPoints`), `selectedId`, `activeCategory` (`"all"` or a category), `selectionMessage`.
- **Behaviour:** loads points on mount (effect deps `[jobId, pointId]`; note `videoId` is not a dependency); focuses the `<h1>` once data arrives; derives `categories` from the data (open-ended, alphabetical); filter buttons (`aria-pressed`); a vertical list of `PointRow` buttons (accessible names include "selected"); a decorative SVG `LaneTimeline` (`aria-hidden`; markers are mouse-only, the list is the keyboard/screen-reader equivalent); right-hand `PreviewPanel` with an "Open explanation" button.
- **Helpers:** `parseTimeToSeconds`, `secondsToTime`, `getCategoryDescription` (generic text per category).
- **Motion:** SVG pulse ring skipped when `prefers-reduced-motion` matched at module load.

## `src/components/BookmarksScreen.jsx`

- **Props:** `onNavigate`, `onOpenBookmark(bookmark)`.
- **State:** `bookmarks` (read from storage once on mount), `removedMessage`; `pendingFocusRef` implements post-delete focus (neighbouring card's Remove button, or the H1 if none left).
- `BookmarkCard` shows category, timestamp, video title, saved date, depth, subtitle; "Open" and "Remove" have explicit `aria-label`s. Removal announces "Removed <title>. N left." in a `role="status"` region.
- Empty state text: "Nothing saved yet…".

## `src/components/LibraryScreen.jsx`

- **Props:** `onNavigate`, `onOpenExplanation(item+autoPlay)`.
- **State:** `library`, `search` (filter over `title`, `videoTitle`, `category`), `removedMessage`, `pendingFocusRef` (same focus pattern as Bookmarks, using `visible` neighbours).
- `ExplanationCard`: thumbnail from `i.ytimg.com`, "Read text" (`autoPlay:false`) and "Play audio" (`autoPlay:true`), "×" remove button (visible on hover **and** focus). An `<h2>` "Recent Explanations" is shown when the library is non-empty.

## Small shared components

| File | Purpose |
|---|---|
| `src/components/CategoryIcon.jsx` | Neutral icon per category (`equation`, `diagram`, `chart`, `graph`, `code`, default). Always `aria-hidden`; meaning comes from the adjacent text. Unknown categories get a generic icon. |
| `src/components/MomentMarker.jsx` | Diamond-with-stem glyph (aria-hidden) marking "a moment". |
| `src/components/ProvenanceLabel.jsx` | `kind="video"` ("From the video") vs `kind="interpretation"` ("Synapse interpretation"). Callers use it only where the data truly splits that way. |

## Test-only

`src/test/setup.js` — Vitest setup (see [TESTING](./TESTING_AND_DEBUGGING.md)).
