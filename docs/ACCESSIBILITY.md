# Accessibility

Synapse's primary users are blind and low-vision students, so accessibility is a core requirement, not a polish step. This document describes what the code **actually implements**. Tags: **[Verified]** (read from source), **[Inferred]**, **[Unknown / needs verification]**.

> **No compliance claim.** The code comments cite WCAG criteria and contrast checks, but this documentation does not claim WCAG conformance: no full audit evidence exists in the repository. The only automated checks are `jest-axe` tests on the Ask component ([TESTING](./TESTING_AND_DEBUGGING.md)), and axe in jsdom cannot assess colour contrast or real screen-reader output.

## Document structure of a screen [Verified]

- `index.html`: `<html lang="en">`, `<title>Synapse</title>`.
- `App.jsx`: a **skip link** ("Skip to main content", `href="#main-content"`) is the first focusable element on every screen; it is `sr-only` until focused.
- Every screen: `<nav aria-label="Main navigation">` (Sidebar) and `<main id="main-content" tabIndex={-1}>`. Explanation's main has `aria-label="Lecture explanation"`, Timeline's `aria-label="Lecture timeline"`, Home/Subject use `aria-labelledby`.
- Heading levels: one `<h1>` per screen, `<h2>` for sections. Explanation: `<h1>` = moment title; `<h2 id="explanation-heading">` Explanation; `<h3>` Accessible visual information / Key insight (sr-only); `<h2>` Moments in this lecture; `<h2>` Keyboard shortcuts. The Library `h2` "Recent Explanations" was added to fix an h1→h3 gap (comment in `LibraryScreen.jsx`).
- `document.title` is set per screen (`App.jsx`) and per moment (`Explanation.jsx`), so alt-tab / NVDA+T identify the page.

## Focus on navigation

`App.jsx` has a `useEffect` on `screen` that focuses the first `main h1` (adding `tabindex="-1"`, `preventScroll`) whenever the screen **changes** — a view swap is silent to screen readers unless focus moves.

- Skipped on the first render (compares against `handledScreenRef`, because StrictMode runs effects twice in dev and a boolean flag would steal focus on cold start).
- Skipped for `"timeline"`: `Timeline` focuses its `<h1>` itself once data has loaded (the h1 does not exist earlier).
- `Home` focuses its H1 only when `focusHeadingOnMount` (= `hasLeftHome`) is true, so a first-time visitor's first Tab goes to the skip link.
- `SubjectLectures` focuses its H1 on mount.
- `useLectureSearch` focuses the search-results heading (`tabIndex=-1`) when results appear.
- Lecture screen: on an auto-pause or moment change, `focusExplanationStart()` focuses the "Explanation" `<h2>` — **only in Accessibility mode** — so the learner is at the content. Alt+R does the same on demand.
- Removal flows (Bookmarks, Library): after a card is removed, focus goes to the neighbouring card's Remove button, or the screen `<h1>` if none is left (`pendingFocusRef`).
- Navbar settings: Escape closes the panel and returns focus to the gear; choosing a theme also returns focus there.
- "Resume video" (Study mode) unmounts on click, so focus is explicitly moved to the Listen button.
- `Home.handleSelectResult` returns focus to the input when the result list unmounts.

## Live regions and announcements

All speech other than native element semantics goes through a small set of polite regions [Verified; found by grepping `aria-live` / `role="status|alert"`]:

| Where | Region | Content |
|---|---|---|
| `Explanation.jsx` | One `role="status" aria-live="polite" sr-only` div bound to `srAnnouncement` (set via `announce(msg)`: cleared, set after 60 ms so repeats re-announce, cleared after 5 s) | Short transition messages only — never the explanation text. |
| `Explanation.jsx` | `role="status"` sr-only static text in the processing banner; `role="alert"` on the failure banner | "Preparing your lecture. This can take about a minute." (spoken once; the ticking % is `aria-hidden`). |
| `Explanation.jsx` | **Not live:** the visible status line (`statusText`) and the explanation text | Deliberately not live to prevent duplicate/overlapping speech. |
| `Home.jsx`, `SubjectLectures.jsx` | `aria-live="polite" aria-atomic="true" sr-only` bound to `statusMessage` | "Searching.", "N lectures found.", "YouTube lecture detected.", "Selected …", etc. Empty at load. |
| `BookmarksScreen.jsx`, `LibraryScreen.jsx` | `role="status" aria-live="polite" sr-only` | "Removed <title>. N left." |
| `Navbar.jsx` | `role="status" aria-live="polite" sr-only` | "<Theme> theme applied." (cleared after 4 s) |
| `Timeline.jsx` | `role="status"` "Loading…"; sr-only `role="status"` for selection | "Selected <title>, <category>, at <time>. Preview updated." |
| `AskLecture.jsx` | sr-only `role="status"` (loading), `role="alert"` (errors), `aria-live="polite"` (result) | "Looking for the answer..."; error text; the answer block. |

### Announcements on the lecture screen (all via `announce`)

- Lecture ready: "Lecture ready. N moments found. Showing moment K: <title>." (+ one-time hint with `synapse_intro_seen`).
- Auto-pause: "Paused at moment N of M, <time>. <Category>: <title>. The explanation is below; use Listen to hear it."
- Manual selection: "Moment N of M, at <time>. <Category>: <title>. [Video paused.] The explanation is below."
- Playback: "Playing." / "Paused." / "Explanation finished. Lecture resumed." — each spoken **only after** YouTube's `onStateChange` confirms the state (`expectPlayerState`), otherwise a failure message after 5 s ("The lecture did not start. Press Play lecture to try again." etc.).
- Mode switch: "Study mode on. The lecture video is now shown." / "Accessibility mode on. The video is hidden; the lecture audio still plays."
- Focus toggle, listening speed ("Listening speed 1.5 times."), shortcut feedback ("This is the last moment.", "Explanation audio isn't ready yet."), and the whole shortcut list (Alt+K, `SHORTCUTS_SPOKEN`).
- Ask source jump: "Jumped to m:ss. Lecture paused."

## Avoiding duplicate speech

Verified techniques:
1. **One live region per screen for events** on the lecture screen; one message per event.
2. Explanation paragraphs are **never** in a live region; TTS is **never auto-played** (the learner presses Listen / Alt+L; the exception is `autoPlay` when opened from Library "Play audio").
3. Result rows in `LectureResultsList` set one `aria-label` and hide their visible text with `aria-hidden`, so the row is spoken once. Timeline `PointRow` and the Library/Bookmarks buttons also set an explicit `aria-label` (which replaces their visible content for screen readers).
4. Decorative icons are `aria-hidden` (`CategoryIcon`, `MomentMarker`, SVGs); Timeline's stat pills and SVG chart are `aria-hidden` because the filter buttons / list carry the same information. The chart header says so in sr-only text.
5. When the Listen button itself has focus, Alt+L does not additionally announce (its own accessible-name change is spoken).
6. Key insight label: visible "Key insight" is `aria-hidden`, a real sr-only `<h3>` carries the name.
7. Accessibility-mode video region is `sr-only` and **`inert`** so the YouTube player's own controls/titles are removed from the accessibility tree while audio continues (`display:none` would pause the iframe).

**Needs verification with NVDA:** Ask moves focus to the result heading *and* places the result in an `aria-live="polite"` region (requested requirement). This may cause NVDA to speak the heading/answer twice. Test and, if it does, drop one of the two mechanisms in `AskLecture.jsx`.

## Names, roles, states

- Toggle buttons use `aria-pressed` (Bookmark, presentation mode, theme options, High contrast, category filters, focus toggle). Disclosures use `aria-expanded` (+ `aria-controls` in Ask). Current nav item: `aria-current="page"`; current moment: `aria-current="step"`.
- Visual/Structured view uses the WAI-ARIA tabs pattern (`role="tablist"/"tab"/"tabpanel"`, roving `tabIndex`, arrow/Home/End keys in `handleVisualTabKeyDown`).
- Buttons that would otherwise be unnamed have explicit `aria-label`s ("Remove <title> from library", "Open <title>, from <video>", "Settings", "Decrease/Increase text size", "Listen to explanation audio"/"Pause explanation audio").
- The Listen button uses `aria-disabled` (stays focusable) until audio exists; the Ask button uses `aria-disabled` + `aria-busy`. `aria-keyshortcuts` documents Alt+P/L/N/B and Alt+./, .
- Search and Library filter inputs have real `<label>`s; Ask has a visible label and a character count linked with `aria-describedby`, `aria-invalid` when over the limit.
- Some buttons use the native `disabled` attribute (e.g. Home's submit when the field is empty, the Play lecture button until the player is ready, Bookmark/Export until the explanation loads) — these leave the tab order while disabled [Verified; a design choice to be aware of].
- `LectureResultsList` rows: `aria-label` such as "Result 1: <title>, <channel>, <duration>".

## Visual accessibility

- **Visible focus:** the shared `.focus-ring` (`src/index.css`) draws a two-layer box-shadow ring using `--surface`/`--focus`, with a 3px *transparent* outline so Windows forced-colors mode still shows a ring. Inputs use `.ds-field:focus-within`. Hidden-until-hover controls (Library "×") become visible on `focus-visible`. Convention from `CLAUDE.md`: no bare `outline-none` without a replacement — several containers/headings still use `outline-none` + `focus-ring` or tabindex=-1 targets; some `main`/`h1` elements use `outline-none` because they are programmatic focus targets only [Verified].
- **Target size:** `.ds-btn-*`, `.ds-nav-item`, `.ds-field` have `min-h-[44px]`. Exceptions [Verified]: Study-mode text-size/High-contrast buttons are `w-7 h-7`/`h-7` (28 px), the focus-toggle is `h-7`, Listening-speed select `min-h-[36px]`, `.ds-btn-text` is lightweight (≈ `py-1.5`).
- **Text scaling:** Study mode only, `textScale` 0.85–1.6 in steps of 0.15, applied by inline `fontSize` to the title, subtitle, explanation, structured rows, key insight (not the whole page). No equivalent control in Accessibility mode (the video is hidden and the browser/OS zoom is the intended mechanism [Inferred]). Session-only.
- **High contrast:** Study mode only; `highContrast` swaps the explanation card and structured view to white background/black text (`bg-white … text-black`, 2px black border) regardless of theme. Not persisted. Not tied to OS forced-colors.
- **Themes:** Paper (light), Night (dark), Sepia. Token contrast values are described as verified in comments in `src/index.css` (4.5:1 text, 3:1 UI) but this was **not independently checked**. Sepia overrides only the legacy `paper/ink` variables, so it does not recolour the new semantic tokens [Verified].
- **Reduced motion:** `src/index.css` disables `.animate-pulse` and `.animate-spin` under `prefers-reduced-motion: reduce`; Timeline skips its SMIL pulse when reduced motion was set at module load (read once). Button/colour transitions are left on.
- **Colour is not the only signal:** categories are icon + text; selection uses weight, background, checkmark and `aria-pressed/current`; the three Ask result statuses differ by heading text and border style; errors are prefixed "Error:".
- **Video interaction:** `focusActive` zoom uses CSS transforms on a wrapper (the iframe is cross-origin).

## Dialogs, forms, status, deletion

- **No modal dialogs** exist [Verified]; the Settings panel is a disclosure-style popover (no focus trap, Escape + outside click close it).
- **Forms:** Home/Subject search (Enter or button), Library filter, Ask form (a real `<form>`; Enter submits).
- **Deletion:** Bookmarks/Library remove immediately — **no confirmation and no undo** — and announce the result and remaining count, with deliberate focus management.
- **Errors:** processing failure → `role="alert"` banner; Ask errors → `role="alert"`. Explanation/moment fetch failures are **console-only** (no user feedback) [Verified].

## YouTube, TTS and audio controls for screen-reader users

- The learner starts/pauses the lecture with the "Play lecture"/"Pause lecture"/"Resume lecture"/"Replay lecture" button (Alt+P) — the iframe is inert in Accessibility mode.
- Explanation TTS is separate: Listen button / Alt+L; speed select and Alt+./Alt+, ; the audio auto-resumes the lecture only if Synapse paused it. Pressing Resume lecture first stops explanation audio.
- Pause/resume feedback is truthful (see `expectPlayerState`).
- Study mode exposes the real YouTube controls; their accessibility is up to YouTube's player and is **not controlled or tested** here.

## Gaps and unverified behaviour

- Timeline's SVG markers are mouse-click only (`onClick` on an `aria-hidden` SVG group); the list below is the accessible path. Timeline is also not offered from Accessibility mode.
- Study-mode small controls (28–36 px) are below the 44 px target used elsewhere.
- Moment/explanation load failures are silent for users.
- No automated NVDA/JAWS/VoiceOver tests; only the manual checklists. Behaviour on macOS/Linux screen readers is **[Unknown]**.
- The `docs/manualtestingguide` Ask section is outdated (it describes the removed quick-action buttons).
- Math in answers: Ask renders `answer_text` as plain text; there is no MathML/LaTeX renderer. The backend is expected to supply spoken-style text [Unknown whether it does].
- Colour-contrast ratios not independently verified; no testing with Windows High Contrast themes documented.

## Manual test checklists

### A. Keyboard only (no screen reader)

1. Load the app; press Tab once → the "Skip to main content" link appears (visible focus). Enter → focus lands in the main area.
2. Home: Alt+S focuses the search field. Type text, Enter → results; the results heading receives focus; Tab to a result, Enter → the field is filled and focus returns to it; Tab to "Start learning", Enter.
3. Lecture screen: Tab reaches Play lecture (Accessibility mode) → Enter/Alt+P starts it; at the first moment it pauses and focus lands on the "Explanation" heading.
4. Alt+L toggles explanation audio; Alt+. / Alt+, change speed; Alt+N / Alt+B change moment; Alt+R refocuses the explanation; Alt+K announces shortcuts. Verify none fire while typing in a text input (Ask field).
5. Open "+ Ask a question about this lecture" (Enter/Space): focus stays on the button; Tab to the field; type; Enter submits; Tab order reaches Ask, Try again (if shown), the result heading, and each "Jump to…" button; no keyboard trap.
6. Study mode: Visual/Structured tabs respond to arrow keys; focus rings visible everywhere; Settings (gear) opens with Enter and closes with Escape returning focus to the gear.
7. Library/Bookmarks: Tab to Remove, Enter → focus moves to the next card's Remove (or the heading when none).
8. Check at 200% browser/OS zoom and with Windows High Contrast that focus rings are visible.

### B. NVDA on Windows (run `npm run electron:dev`, click the window once, then use only the keyboard)

Follow `docs/manualtestingguide` for the existing flow (it is accurate except for Ask), and additionally:

1. Home → H1 spoken after skip link; Alt+S → "Lecture link or search, edit"; search → "Searching… 2 lectures found."
2. Lecture screen: Play lecture → "Playing." (only once the video actually starts); auto-pause → "Paused at moment 1 of N …"; Listen → "Pause explanation audio"; finish → "Explanation finished. Lecture resumed."
3. Alt+P while the video is paused vs playing → state spoken matches reality.
4. **Ask:** open the disclosure → "collapsed/expanded"; submit → "Looking for the answer..."; result → the "Answer" (or "I couldn't find that"/"Not covered in this lecture") heading is read and the answer text is available with the Down arrow — **check whether it is spoken twice**; Tab to "Jump to 3:20 to 4:05" → Enter → "Jumped to 3:20. Lecture paused." and the video position changed; stop the backend → Ask → "Error: Can't reach the Synapse server…" is announced and "Try again" is reachable.
5. Bookmark → "pressed"/"not pressed". Mode switch → spoken confirmation.
6. Library → Remove → "Removed … N left." and focus stays in the list.
7. Failure criteria: silence after a key that should speak; "Playing." while paused; focus dropping to the page body; unnamed or identically named buttons; a Library entry named "Loading your lecture".
