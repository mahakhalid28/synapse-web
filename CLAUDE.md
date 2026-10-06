# Synapse — Project Notes

React + Vite + Tailwind + Electron app. Paste/search a YouTube lecture →
backend detects "intervention points" (equations/diagrams/charts/graphs) →
each point gets an AI text + TTS-audio explanation, synced against real
video playback.

Dev: `npm run dev` (Vite only) or `npm run electron:dev` (Vite + Electron
together). Lint: `npx eslint <file>`.

## Design system (STEM-workspace tokens)

Defined in `src/index.css` (`:root`) + mapped in `tailwind.config.js`.
**Additive** — the old `paper`/`ink`/`accent` (no suffix) editorial tokens
from the original app still exist and are still used by unmigrated screens;
never delete or repurpose them.

New tokens (all support `/opacity` since they use the
`rgb(var(--x) / <alpha-value>)` pattern):
`background`, `surface`, `surface-muted`, `border-default`, `text-primary`,
`text-secondary`, `text-muted`, `accent-primary` (+ `--accent-primary-hover`
CSS var, not a Tailwind key), `accent-subtle`, `radius-sm/md/lg` (as
`rounded-radius-sm` etc. — deliberately not `sm/md/lg`, which are Tailwind's
own built-in scale still used by unmigrated screens).

Reusable component classes (`.ds-*` prefix, in `index.css` `@layer
components`): `.ds-btn-primary`, `.ds-btn-secondary`, `.ds-btn-text`,
`.ds-field` (input wrapper), `.ds-row` (clickable card row), `.ds-nav-item`
/ `.ds-nav-item-active`.

Typography: sans-serif everywhere in migrated screens (`font-sans` on the
root wrapper div beats the global `body { font-serif }` base rule). No
uppercase/letterspaced "eyebrow" labels — plain `text-[12px] font-medium
text-text-secondary` instead.

Every interactive element gets `focus-visible:outline
focus-visible:outline-2 focus-visible:outline-accent-primary
focus-visible:outline-offset-2` (never plain `outline-none` without this
replacement).

### Migration status
- **Migrated**: Home.jsx, Sidebar.jsx, Navbar.jsx, Explanation.jsx.
- **NOT migrated** (still old paper/ink/font-serif/eyebrow tokens):
  Timeline.jsx, BookmarksScreen.jsx, LibraryScreen.jsx. Looking
  inconsistent next to migrated screens is expected/known, not a bug.
  Migrate these the same way Explanation.jsx was done if asked.

## App.jsx — screens & routing

Single `screen` state string: `"home" | "subject" | "timeline" |
"explanation" | "bookmarks" | "library"`. No more `"processing"` screen —
it was removed; `handleProcess()` now goes straight to `"explanation"` with
an in-flight `processVideo()` promise passed down as a prop, and
Explanation.jsx shows an inline "Preparing your lecture… N%" banner itself
(no full-screen blocker). `Processing.jsx` was deleted.

`hasLeftHome` state exists solely so Home's H1 only grabs focus on *return*
navigation, never on the app's very first cold load (which would otherwise
skip the skip-link/sidebar out of tab order for first-time visitors).

## Home.jsx

Sections, in order: H1 → compact "Continue learning" card (bordered,
`bg-surface-muted`, secondary weight, only renders if a `continueLecture`
prop exists) → "Start a new lecture" (the primary section: link/search
input + results list + submit) → "Explore a subject" (5 pills:
Mathematics/Physics/Computer Science/Chemistry/Biology → navigate to
`SubjectLectures`).

Shared search logic lives in `src/hooks/useLectureSearch.js` +
`src/lib/lectureSearch.js` (mock `searchVideos`/`extractYouTubeId`) — used
by both Home.jsx and SubjectLectures.jsx so there's one search
implementation, not two. `src/components/LectureResultsList.jsx` is the
shared result-row UI (parameterized by `onSelect`/`getAriaLabel`/
`showAction` so Home's "select fills the field" and Subject's "click →
start learning immediately" can differ without duplicating markup).

`SubjectLectures.jsx` is **one** reusable component for all 5 subjects
(`<SubjectLectures subject="Physics" />`), not 5 separate files/screens.

## Explanation.jsx — the complex one

Real YouTube IFrame Player embed (`src/lib/youtubeIframeApi.js` loads the
`iframe_api` script once app-wide, singleton promise). Player instance
lives in `playerRef`; container div (`playerContainerRef`) is **never**
unmounted — only visually hidden (`sr-only`, not `display:none`, which
would pause YouTube playback) in Accessibility mode.

**`pauseOwner`** state (`null | "user" | "intervention"`) is the single
source of truth for auto-resume eligibility — not a boolean. Set to
`"intervention"` when the timestamp-watching interval auto-pauses for an
explanation point; set to `"user"` on manual sidebar/prev-next selection
(which also calls `seekTo` + `pauseVideo`). Auto-resume only fires from the
TTS `<audio>` "ended" handler when `pauseOwnerRef.current ===
"intervention"` (a ref mirrors the state so the handler isn't stale — the
Audio element/listeners aren't re-bound on every pauseOwner change). The
watch-interval effect only exists while `pauseOwner === null`, which is
itself what prevents two close-together intervention points from
flickering — no extra guard needed. `onStateChange` also resets
`pauseOwner` to `null` on any transition to PLAYING, because it's a real,
natively-controllable embed (user could click YouTube's own play button,
not just our "Resume" button).

**`presentationMode`** (`"accessibility" | "study"`, default
`"accessibility"`) — separate from `pauseOwner` and from `mode` (explanation
depth: brief/standard/detailed — three different variables, never conflate
them). Toggle is a `role="group"` pair of `aria-pressed` buttons. Study
mode = current fully-visible-video behavior. Accessibility mode = same
player (still receiving real audio), video area `sr-only`, replaced by a
plain `aria-live="polite"` status line ("Playing." / "Paused —
explaining." / "Paused."). The "Resume" button relabels itself ("Resume
video" vs "Resume lecture") based on mode but is the same handler. The
explanation paragraph text itself has **no** aria-live — only the status
banner does; don't add one to the paragraph content without being asked
(TTS speaking + a live region announcing the same text simultaneously was
explicitly to be avoided).

## api.js mock testing

`USE_MOCK` at the top (currently `false` — leave it that way except for
throwaway local testing, and always revert before finishing a task). When
`true`: `processVideo` resolves (doesn't reject) with a realistic
`{ jobId: videoId }`; `getInterventionPoints` returns exactly 3 points (id
`p1`/`p2`/`p3`, timestamps `0:10`/`0:14`/`1:30` — p1/p2 deliberately only 4s
apart to keep exercising the sequencing-protection logic); `getExplanation`
+ `getTTSExplanation` both pull complete, distinct content per point from
one shared `MOCK_EXPLANATIONS` lookup (not generic placeholder text).

Recommended real video for manual testing (paste on Home when `USE_MOCK`
is on) — verified live via the same `noembed.com` lookup
`getVideoMetadata()` already uses, so it's confirmed embeddable, not
guessed: `https://www.youtube.com/watch?v=aircAruvnKk` ("But what is a
neural network? | Deep learning chapter 1", 3Blue1Brown, ~19 min).

## Known pre-existing lint findings (not caused by any of the above work — leave alone unless asked to fix)

In `Explanation.jsx` and `Sidebar.jsx`: a few `react-hooks/set-state-in-effect`
errors (synchronous `setState` at the top of certain data-loading effects)
and one `react-hooks/purity` error (`Date.now()` inside `handleBookmark`/
`saveToLibrary`). Verified present before any of the recent changes;
re-verify against current `npx eslint` output before assuming they're still
the same ones if it's been a while.

## Verification habit used throughout this project

For every UI/behavior change: start `npm run dev`, drive it with a
throw-away Playwright script from the scratchpad directory (screenshots +
assertions), confirm via `npx eslint` on touched files, then kill the dev
server. Never leave `USE_MOCK` flipped or test-only mock-data edits in
`api.js` after verifying — always diff/grep to confirm reverted.
