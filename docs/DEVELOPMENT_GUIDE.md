# Development Guide

How to work in this codebase safely, with examples based on existing patterns. Tags: **[Verified]**, **[Inferred]**, **[Unknown]**. Read [ARCHITECTURE](./ARCHITECTURE.md) first.

## Recommended workflow

1. `npm install`, then `npm run dev` (browser) or `npm run electron:dev` (Electron — closer to how it is used; recommended for accessibility testing).
2. Decide mock vs real: `USE_MOCK` in `src/api.js` (committed `true`). Flip it **locally only**, and revert before committing — it is owned by whoever works on explanation/audio/interventions. Ask always uses the real endpoint.
3. Make a small change → check it in the app (keyboard first, then NVDA for anything spoken) → `npx eslint <files you touched>` → `npm test`.
4. Compare lint output to the known baseline ([Known issues](./KNOWN_ISSUES_AND_TECHNICAL_DEBT.md#16-lint-findings)); do not introduce new findings.
5. Update the relevant document in `docs/` when you change behaviour, an endpoint, a storage key, a shortcut or a token.
6. Keep new code in new files where possible and touch shared files minimally (this is how Ask was added: `AskLecture.jsx` + `src/lib/askApi.js`, with one small mount point in `Explanation.jsx`).

Repository habits visible in `CLAUDE.md` and git history: small, focused commits with prefixes like `a11y:` and `ux:`; one change at a time; never leave test-only mock edits behind.

## Add a screen

1. Create a new file (example name: `src/components/MyScreen.jsx`) following an existing screen (e.g. `LibraryScreen.jsx`): root `div.flex.h-full.w-full.bg-background.font-sans.overflow-hidden`, `<nav aria-label="Main navigation"><Sidebar active="…" onNavigate={onNavigate}/></nav>`, `<main id="main-content" tabIndex={-1} className="… outline-none">`, one `<h1 ref tabIndex={-1}>`.
2. In `src/App.jsx`: import it; add the new value to the `screen` states; add a branch to the `activeScreen` `if/else` chain; add handler(s) that set data and call `setScreen(...)`; add an entry to the `titles` map for `document.title`; if it should be reachable from the sidebar, add to `Sidebar.jsx` `items` and `handleNavigate`.
3. The shared focus effect will focus your `main h1` automatically. If your `<h1>` renders only after data loads, exclude the screen like `"timeline"` is excluded and focus it yourself once.
4. Pass data via props from `App` state (`jobInfo`) — do not read other screens' state. If you need new fields in `jobInfo`, use the existing names (`jobId`, `videoId`, `pointId`, `mode`) where they apply.
5. Add status/loading/empty/error handling (see below).
6. Document it in [SCREENS_AND_COMPONENTS](./SCREENS_AND_COMPONENTS.md) and the navigation diagram in [ARCHITECTURE](./ARCHITECTURE.md).

## Add a reusable component

1. Put it in `src/components/` (hooks in `src/hooks/`, pure helpers/clients in `src/lib/`).
2. Use semantic tokens and `ds-*` classes ([STYLING](./STYLING_AND_DESIGN_SYSTEM.md)); make every interactive element carry `focus-ring` and be ≥ 44 px where it is a primary control.
3. Decorative SVG/icons: `aria-hidden="true"`; meaning comes from adjacent text (see `CategoryIcon`, `MomentMarker`).
4. Accept behaviour as props (`onSelect`, `getAriaLabel`) rather than hard-coding — see `LectureResultsList`.
5. Write a test next to it (`Name.test.jsx`) including an axe check if it has interactive states.

## Add a keyboard shortcut

*Lecture-screen shortcut:*
1. In `src/components/Explanation.jsx` add the handler to the `shortcutsRef.current = { … }` object, keyed by `e.code` (e.g. `KeyX`, `Period`).
2. Add `["Alt+X", "What it does"]` to the `SHORTCUTS` array at the top of the file — it feeds both the on-page list and the spoken Alt+K list (`SHORTCUTS_SPOKEN`).
3. If the shortcut has a visible button, add `aria-keyshortcuts="Alt+X"` to it.
4. Make the handler announce through `announce(...)` unless the focused element already speaks the change; keep one message per event.
5. Pick a letter that does not collide with Electron's default menu mnemonics (F/E/V/W/H), existing shortcuts, or screen-reader keys; remember the listener ignores Alt combinations with Ctrl/Meta/Shift and ignores text inputs/textareas.
6. Update [KEYBOARD_SHORTCUTS](./KEYBOARD_SHORTCUTS.md) and the NVDA guide.

*Field-focus shortcut on another screen:* use `useFocusShortcut(inputRef, "x")` as `Home.jsx` does.

## Add a backend request

Follow [API doc → Adding a new API request](./API_AND_BACKEND_INTEGRATION.md#adding-a-new-api-request-safely). Use `src/lib/askApi.js` as the model: env-driven base URL, pure body builder, `AbortSignal` + timeout, typed errors with friendly messages, response validation, tests.

## Add or change persisted data

Follow [STORAGE → Guidelines](./STORAGE_AND_PERSISTENCE.md#guidelines-for-adding-persisted-data). New list-like data goes in `src/storage.js` (add the key constant, getter/saver/remover, call `notify()`); simple preferences follow the `synapse_tts_rate` pattern in `Explanation.jsx` (guarded read, guarded write, validated value).

## Integrate with YouTube playback and TTS

Rules to preserve (details in [DATA_FLOW_AND_STATE](./DATA_FLOW_AND_STATE.md#4-youtube-playback-vs-explanation-tts)):

- Control the video only through `playerRef.current` (`seekTo`, `pauseVideo`, `playVideo`, `getCurrentTime`, `getPlayerState`) and always set `pauseOwner` correctly: use `selectPointManually(id)` to jump to a moment; use the `handleAskSeek` pattern (seek + pause + `setPauseOwner("user")` + announce) for arbitrary timestamps.
- Never unmount the player container or hide it with `display: none` (it would stop playback); Accessibility mode uses `sr-only` + `inert`.
- Do not auto-resume the video from your own code; auto-resume belongs to the TTS `ended` handler and requires `pauseOwnerRef.current === "intervention"`.
- To speak a playback outcome, use `expectPlayerState(target, okMsg, failMsg)` so the message is only said once the player confirms it.
- Do not put explanation text in a live region (TTS would double up). Short status messages go through `announce()`.
- If your feature needs the active moment, read `effectiveActivePointId`; if it needs the lecture time, call `playerRef.current?.getCurrentTime?.()` (may be undefined before ready).
- Pass `Explanation` state to a child component through props/callbacks (as with `AskLecture`) rather than growing `Explanation.jsx`.

## Accessible loading and error states

Use the patterns already in the code:

- **Loading:** a short message in a polite region (`role="status"`/`aria-live="polite"`), e.g. Ask's sr-only "Looking for the answer..."; avoid announcing percentages repeatedly (the processing banner is spoken once with the ticking number `aria-hidden`). Reflect busy state with `aria-busy` and prevent double submits; respect reduced motion (spinner uses `animate-spin`, which `src/index.css` disables).
- **Errors:** `role="alert"` region that is mounted before the message is inserted; plain-language text, no raw server output, prefixed with "Error:" so it is not colour-only; keep the user's input; offer "Try again" for retryable failures.
- **Success:** move focus to the new content's heading (`tabIndex={-1}`) only after an action the user initiated; otherwise announce.
- **Empty states:** say what is missing and what to do next as text (see Bookmarks/Library `EmptyState`).
- **Removal flows:** announce the result and remaining count; move focus to the neighbouring control (`pendingFocusRef` pattern).
- Don't leave failures silent: `Explanation` currently only `console.error`s moment/explanation load failures — avoid copying that.

## Code conventions and repository rules

- JavaScript + JSX, function components and hooks, 2-space indentation; no TypeScript; no router; no global state library.
- Comments in the codebase explain *why* (accessibility reasoning in particular). Match that density; don't narrate obvious code.
- Don't delete or repurpose legacy `paper`/`ink`/`accent-legacy` tokens ([STYLING](./STYLING_AND_DESIGN_SYSTEM.md)).
- Sans-serif everywhere (`font-sans` on the screen wrapper); no uppercase/letter-spaced "eyebrow" labels.
- Every interactive element gets a visible focus style (`focus-ring`); never plain `outline-none` without a replacement.
- UI wording: say **"moment"**, not "intervention", in user-visible text (commit `ux: say "moment" consistently`).
- Keep `USE_MOCK` as committed unless you are the owner of that area; never leave mock edits behind.
- Don't commit secrets or tunnel URLs with credentials.

## Risky files and why

| File | Risk |
|---|---|
| `src/components/Explanation.jsx` | ~2,190 lines; `pauseOwner`/refs/intervals/audio/announcements are tightly coupled; timers and effect dependency arrays (some intentionally incomplete, with lint warnings). Changes can cause silent regressions only visible with a screen reader. |
| `src/App.jsx` | The focus-on-navigation effect and `hasLeftHome` prevent focus bugs; `jobInfo` field names are relied on by Timeline/Bookmarks/Library/Explanation. |
| `src/api.js` | Mock and real branches share helpers; `USE_MOCK` is owned by a teammate; hard-coded URL; response parsing heuristics (`parseTextExplanation`). |
| `src/storage.js` | Shape changes affect saved user data (no versioning/migration). |
| `src/index.css` / `tailwind.config.js` | Changing token values affects every screen and themes (contrast was checked against specific values). |
| `electron.cjs` | `webSecurity: false` masks CORS problems; changes affect how the packaged app loads. |

## Pre-commit checklist

- [ ] `USE_MOCK` and `API_BASE_URL` are as you found them (unless intentionally changed with the owner's agreement).
- [ ] `npx eslint` on touched files shows no *new* findings; `npm test` passes.
- [ ] Keyboard-only walk-through of the changed flow; focus never lost or trapped.
- [ ] Anything newly spoken goes through `announce()`/one live region; no duplicated messages.
- [ ] Interactive elements have names, roles/states, visible focus, ≥ 44 px (or a justified exception).
- [ ] Works in Paper and Night themes; no colour-only meaning; reduced motion respected.
- [ ] No new `localStorage` keys without try/catch and documentation; no secrets.
- [ ] Docs updated (endpoints, keys, shortcuts, known issues).
- [ ] No stray debug logs, mock data, or edits to unrelated files.
