# Feature Integration Guide

A practical path for a developer joining the project and building a new feature. Companion to [DEVELOPMENT_GUIDE](./DEVELOPMENT_GUIDE.md) (how-to recipes). Tags: **[Verified]**, **[Inferred]**, **[Unknown]**.

## 1. Files to read before starting any feature

| Read | Why |
|---|---|
| [README](../README.md), [ARCHITECTURE](./ARCHITECTURE.md) | Mental model: one `screen` string in `App.jsx`, screens as props-driven components, backend = separate repo. |
| `src/App.jsx` | Navigation, `jobInfo`, focus-on-navigation effect. |
| `src/api.js` (top 20 lines + the function you'd touch) | `USE_MOCK`, base URL, existing request/caching patterns. |
| `src/lib/askApi.js` | Best model for a *new* API client (timeouts, abort, typed errors, validation). |
| `src/storage.js` | Anything persisted. |
| The screen that will host the feature (`Explanation.jsx` for anything lecture-related — read the "Functional breakdown" in [SCREENS_AND_COMPONENTS](./SCREENS_AND_COMPONENTS.md) first). |
| [ACCESSIBILITY](./ACCESSIBILITY.md) and [KEYBOARD_SHORTCUTS](./KEYBOARD_SHORTCUTS.md) | Rules for announcements, focus and shortcuts. |
| `src/index.css`, `tailwind.config.js` | Tokens and `ds-*` classes. |
| `CLAUDE.md` | Team rules — but note it is partly stale ([Known issues](./KNOWN_ISSUES_AND_TECHNICAL_DEBT.md#3-stale-documentation)); the code wins. |
| [KNOWN_ISSUES_AND_TECHNICAL_DEBT](./KNOWN_ISSUES_AND_TECHNICAL_DEBT.md) | Avoid building on a known-broken area (mock search, export audio, real-mode reopen). |

## 2. Tracing a feature end to end

Work in this order and write down each hop:

1. **UI trigger** — which component renders the control, and what prop/callback does it call?
2. **State owner** — who holds the state (`App` for cross-screen, `Explanation` for lecture, the feature component for its own)? See the table in [ARCHITECTURE](./ARCHITECTURE.md#state-ownership-summary).
3. **Data source** — mock (`USE_MOCK` branch / `src/lib/lectureSearch.js`), real API (`src/api.js` or a `src/lib/*` client), `localStorage`, or the YouTube player.
4. **Transformation** — mapping/parsing functions (`getInterventionPoints` mapping, `parseTextExplanation`, `parseAskResponse`).
5. **Render + accessibility** — what is displayed, what is announced, where focus goes.
6. **Persistence** — what is saved, under which key, and who is notified.

**Worked example: Ask a question**
- Trigger: disclosure + form in `src/components/AskLecture.jsx` (`submit`).
- State: `AskLecture` local state; inputs from `Explanation` props (`videoId`, `getCurrentTime`, `activeInterventionId` from `pauseOwner`/`effectiveActivePointId`, `knownMomentIds` from `allPoints`).
- Data: `askQuestion()` in `src/lib/askApi.js` → `POST {VITE_API_BASE_URL || http://127.0.0.1:8000}/video/ask` (bypasses `USE_MOCK`).
- Transformation: `buildAskBody` (optional fields), `parseAskResponse` (shape/invariant), `AskError` mapping.
- Render: heading per status, plain-text answer, source buttons → `onSeek`/`onSelectMoment` → `Explanation.handleAskSeek` / `selectPointManually`.
- Accessibility: loading `role="status"`, errors `role="alert"`, focus to the result heading, `aria-busy`.
- Persistence: none (answers aren't saved).
- Tests: `src/lib/askApi.test.js`, `src/components/AskLecture.test.jsx`.

## 3. Avoiding breakage of navigation and shared accessibility behaviour

- **Navigation:** new screens must be added in `App.jsx` (see the recipe). Don't introduce a router or browser history without handling the focus effect, titles and `jobInfo` resets. Use the existing `jobInfo` fields. `handleNavigate("home")` clears `jobInfo`.
- **Focus:** don't call `.focus()` on mount in a way that competes with `App`'s h1 focus (see `hasLeftHome`, the Timeline exception). Focus programmatically only in response to a user action.
- **Announcements on the lecture screen:** go through `announce()`; never add a second live region to `Explanation` for events; never put explanation text in a live region.
- **Playback:** touch the player only via `playerRef`; keep `pauseOwner` truthful; don't resume the video from new code; don't hide the video with `display: none` (see [DATA_FLOW](./DATA_FLOW_AND_STATE.md#4-youtube-playback-vs-explanation-tts)).
- **Keyboard:** don't intercept keys globally; if you add Alt shortcuts, respect the text-input exclusion and update both `SHORTCUTS` and the handler map.
- **Presentation modes:** your feature must work in Accessibility mode (video `sr-only`, controls limited) and Study mode; don't add visual-only affordances to Accessibility mode.
- **Themes:** use tokens so Paper/Night both work.
- **Storage:** don't change the shape of bookmarks/library items without handling old data.
- **Mock vs real:** keep mock mode functional if your feature depends on `src/api.js`; if it can't be mocked (like Ask), say so in the UI/docs.

## 4. Coordinating frontend and backend changes

1. **Write the contract first** (path, method, request fields with types/required/limits, response fields, status codes, error body, invariants). Agree it with the backend owner *before* either side codes. Ask's contract was agreed this way, but it lives in conversation/the backend repo, not here — put new contracts in [API_AND_BACKEND_INTEGRATION](./API_AND_BACKEND_INTEGRATION.md) in the same change.
2. Mark the frontend's assumptions explicitly (what it validates, what it ignores, what it treats as a server error). Decide the user-facing message for each failure mode.
3. Build against a stub (`fetch` mocks in tests; optionally a `USE_MOCK` branch) so the UI can be finished without the server.
4. Confirm **CORS** (browser) and **base URLs** (`VITE_API_BASE_URL` vs the `src/api.js` constant) for every environment you will test in.
5. Verify against a real backend with an already-processed video; record what you could not verify.
6. Don't depend on backend fields the code doesn't read today without adding passthrough + a note (as with `focusRegion`/`structured`).
7. Keep ids stable: persisted items store `videoId`/`pointId` from the backend.
8. Never process videos or call model APIs casually — they cost quota and time; use mock mode or stubs for UI work.

## 5. Step-by-step checklist for a new feature

**Plan**
- [ ] Describe the user behaviour for a screen-reader user *first*: what do they hear, where is focus, which keys do they use?
- [ ] List files you will add vs existing files you will touch; keep edits to shared files minimal (`Explanation.jsx`, `App.jsx`, `src/api.js`, `src/index.css`).
- [ ] Check [Known issues](./KNOWN_ISSUES_AND_TECHNICAL_DEBT.md) and with owners of areas you touch (`USE_MOCK` and explanation/audio code are a teammate's).
- [ ] If a backend change is needed, agree the contract (§4).

**Build**
- [ ] New component/hook/lib files with props-driven design and tokens/`ds-*` classes.
- [ ] State owned at the lowest sensible level; no new global store.
- [ ] Loading, empty, error, success states, each with an accessible announcement or role.
- [ ] Network: timeout, abort on unmount, validated response, friendly messages, no raw server text.
- [ ] Persistence: guarded `localStorage` access, validated reads, documented key.
- [ ] Keyboard: reachable in a sensible tab order; no traps; shortcuts only if justified.
- [ ] Mock support or a clear statement that it bypasses `USE_MOCK`.

**Verify**
- [ ] Unit/component tests (fetch mocked, no network, no model calls) + jest-axe checks for each visual state.
- [ ] `npm test`; `npx eslint` on touched files — no new findings versus the baseline.
- [ ] Manual keyboard walk-through in both presentation modes and both Paper/Night themes.
- [ ] NVDA pass using the checklists in [ACCESSIBILITY](./ACCESSIBILITY.md#manual-test-checklists); specifically look for double announcements and lost focus.
- [ ] If real backend is available: one real-data pass, noting results.

**Finish**
- [ ] `USE_MOCK`/URLs restored; no leftover debug code or test-only mock data.
- [ ] Update docs: SCREENS_AND_COMPONENTS, API, STORAGE, KEYBOARD_SHORTCUTS, ACCESSIBILITY, KNOWN_ISSUES as applicable.
- [ ] Separate, focused commits with the repo's prefix style (`a11y:`, `ux:`, …).
