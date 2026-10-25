# Keyboard Shortcuts

Every shortcut found in the source, checked against its event handler. Tags: **Implemented** (handler read and traced), **Conditional** (works only under stated conditions), **Unverified** (not exercised in a running app by this documentation effort).

> "Implemented" here means the code path exists and was traced by reading it; none of these were run against a live screen reader while writing this. Test with the [checklists](./ACCESSIBILITY.md#manual-test-checklists).
>
> **Alt+M (Voice Notes) is the one exception to "traced by reading only"**: it has automated tests and scripted runs, and the user reported that Voice Notes work with a real microphone and NVDA. What exactly was tested, and by whom, is listed with the labels AUTOMATED / SCRIPTED-REAL / HUMAN / NOT TESTED in [VOICE_NOTES_VALIDATION](./VOICE_NOTES_VALIDATION.md). Those labels are not used for the other shortcuts.

## Lecture screen (Accessibility and Study mode)

Handler: one `window` `keydown` listener in `src/components/Explanation.jsx` (effect near the end of the component logic). It turns the key's `code` into an **action id** with `lectureActionForCode()` and calls `shortcutsRef.current[actionId]`. The handler map is keyed by action id (`playPause`, `listen`, `next`, `previous`, `read`, `faster`, `slower`, `voiceNote`, `hearShortcuts`) and is rebuilt every render so it always sees current state.

**Single source of truth: `src/lib/shortcuts.js`.** Its `LECTURE_SHORTCUT_ROWS` table (and `HOME_SHORTCUT_ROWS` for Alt+S) feeds the key lookup above, the "Keyboard shortcuts" list on the lecture page, the list in the Help dialog, and the text Alt+K speaks (`LECTURE_SHORTCUTS_SPOKEN`). Help and the first-lecture guide card take their keys from it (`keysForAction`), so no copy retypes a key. `src/lib/shortcuts.test.jsx` fails if the table and the real handlers disagree (**AUTOMATED**; see [Keeping the list accurate](#keeping-the-list-accurate)).

| Shortcut | Action | Handler (in `Explanation.jsx`) | Status / conditions |
|---|---|---|---|
| **Alt+P** | Play, pause or resume the lecture | `KeyP → handleLectureToggle` | Implemented. Does nothing if the YouTube player is not ready (`playerRef.current` null). Spoken result is confirmed by `expectPlayerState`. |
| **Alt+L** | Listen to / pause the explanation audio | `KeyL` → `togglePlay` | Conditional: if `audioRef.current` is missing it announces "Explanation audio isn't ready yet." and stops. Announces "Listening to the explanation."/"Explanation paused." unless the Listen button itself has focus. |
| **Alt+N** | Next moment | `KeyN → selectPointManually(nextPoint.id)` | Conditional: if none, announces "This is the last moment." |
| **Alt+B** | Previous moment | `KeyB → selectPointManually(prevPoint.id)` | Conditional: if none, announces "This is the first moment." |
| **Alt+R** | Jump to the start of the explanation | `KeyR → explanationHeadingRef.current?.focus()` | Implemented (the heading is `tabIndex=-1`). |
| **Alt+.** | Listen faster | `Period → stepRate(1)` | Implemented; announces "Already at the fastest speed." at 2×. Speeds: `RATES = [0.75, 1, 1.25, 1.5, 2]`, persisted in `synapse_tts_rate`. |
| **Alt+,** | Listen slower | `Comma → stepRate(-1)` | Implemented; announces at 0.75×. |
| **Alt+M** | Start or stop a voice note (record your own audio note at the current lecture moment) | `KeyM → voiceControlRef.current.toggle()`, which is the `<VoiceNotes>` panel's recorder (`src/components/VoiceNotes.jsx`, `src/hooks/useVoiceRecorder.js`) | Implemented. **Conditional**: see [Alt+M in detail](#altm-voice-notes-in-detail). If the panel is not mounted yet it announces "Voice notes aren't ready yet." and does nothing else. |
| **Alt+K** | Hear the shortcut list | `KeyK → announce(SHORTCUTS_SPOKEN)` | Implemented. The spoken list includes Alt+M ("Alt plus M: Start or stop a voice note."). |

**Matching rules (listener):** requires `altKey` and **no** Ctrl, Meta or Shift; `preventDefault()` is called when a mapped shortcut fires. The key is identified by `e.code` (`KeyP`, `Period`, `Comma`…), falling back to `e.key` when `e.code` is empty (some assistive-technology key events). On non-US keyboard layouts `e.code` reflects the physical key rather than the printed letter [general browser behaviour; not tested here — **Unverified**].

**Exclusions:** the listener returns early when the event target is a `<textarea>` or `<input type="text">` (so typing in the Ask field and similar fields is never hijacked). Targets such as `<select>` (Listening speed) and buttons are *not* excluded. The listener also returns early, whatever has focus, **while the Help dialog is open** (`helpOpenRef`): none of the lecture shortcuts reach the lecture then (**AUTOMATED**).

**ARIA hints:** `aria-keyshortcuts` is set on the Play lecture button (`Alt+P`), Listen button (`Alt+L`), Previous (`Alt+B`), Next (`Alt+N`), the speed select (`Alt+. Alt+,`) and the Record voice note button (`Alt+M`, which also shows "Alt+M" as visible text).

### Alt+M (voice notes) in detail

What it does, from the handler and the recorder hook (`useVoiceRecorder.js`):

1. **Press when nothing is happening.** The lecture time is read from the YouTube player *first*. If the player is not ready, nothing is paused and the panel says so ("The lecture player isn't ready yet…"). Otherwise the lecture video **and** Synapse's explanation audio are paused, and it announces "Lecture paused. Recording starts after the tone." The microphone is opened while it waits about 1.5 seconds (so screen-reader speech can finish), a short tone plays, and then recording starts.
2. **Press again during that wait.** It cancels ("Recording cancelled. The lecture is still paused.") and the microphone is released.
3. **Press again while recording.** It stops and **saves** the note, stamped with the lecture time from step 1. It announces "Voice note saved at m:ss, N seconds. The lecture is still paused." A recording shorter than half a second is treated as an accident and is not saved.
4. **Limit.** One note is at most 5 minutes. It announces "30 seconds left in this recording." and at the limit stops and saves by itself.
5. **It never resumes the lecture or the explanation audio.** While a note is being recorded, Alt+P and Alt+L do not start playback; the lecture is paused again and it announces "The lecture was paused again because it can't play while you record." The learner resumes on purpose afterwards (for example with Alt+P).
6. **Almost nothing is spoken while recording**: only the 30-second warning, the limit message and the "paused again" message from step 5. A microphone near speakers would record a screen reader, so the panel advises headphones.
7. **No effect while a note is being saved**, or while an unsaved recording is waiting for Save / Discard (shown in the panel, for example after the microphone disappears or after a failed save).
8. **Errors.** A blocked, missing or busy microphone shows a message on the page and announces it; the lecture stays paused and nothing is saved. Pressing Alt+M again tries again; no restart is needed.
9. **Where it works.** Only on the lecture screen, while the Voice Notes panel (below the Ask box) is mounted. Like the other lecture shortcuts it is ignored while focus is in a `<textarea>` or `<input type="text">`, such as the Ask field. Whether the panel is present in every state of the lecture screen (for example while a lecture is still processing) was not separately checked.
10. **Leaving the screen** while a recording is running stops the microphone and offers Save / Discard / Stay. Closing the whole window discards an unsaved recording without asking.

Evidence for Alt+M (labels explained in [VOICE_NOTES_VALIDATION](./VOICE_NOTES_VALIDATION.md)):

| Label | What it covers |
|---|---|
| AUTOMATED | The shortcut reaches the recorder (also when only the typed letter is reported); the pause, the blocking of Alt+P / Alt+L, the leave guard and the cue time; the recorder's order of events, limit and errors. These use fake players and microphones. |
| SCRIPTED-REAL | In the packaged Windows app with the real YouTube player and Chromium's *fake* microphone device, a script sent real Alt+M key events: it started and stopped a recording, the lecture stayed paused and did not resume itself, and the note's time matched the pause (about 3.9 s against 3.92 s in the last run). Key events were injected through the DevTools protocol, which does not exercise the native application menu. |
| HUMAN | The user reported (2026-10-19) that Voice Notes work with a real Windows microphone and with NVDA. Which steps were run, and whether Alt+M specifically was used, was not recorded. |
| NOT TESTED | Non-US keyboard layouts, macOS, JAWS and Narrator; Alt+M with the Windows microphone privacy switch off (the on-page message for that case is covered by AUTOMATED and SCRIPTED-REAL tests only). |

## Home and subject pages

| Shortcut | Action | Handler | Status |
|---|---|---|---|
| **Alt+S** | Focus (and select) the "Lecture link or search" field | `src/hooks/useFocusShortcut.js`, used in `Home.jsx` and `SubjectLectures.jsx` | Implemented. Unlike the lecture-screen handler, this listener does **not** skip text inputs, so it also works while typing in the field. Not active on other screens (the hook is only mounted on those two). It is listed in Help from `HOME_SHORTCUT_ROWS`; the hook still takes its own letter (`"s"`), and a test checks that pressing the row's key focuses the field. |

The Home intro paragraph tells the user: "press Alt plus S at any time to jump to the search field."

## Other keyboard behaviour (not Alt shortcuts)

| Key | Where | Behaviour | Handler |
|---|---|---|---|
| Enter | Home / SubjectLectures search input | Submit (search or start learning) | `onKeyDown` on the input |
| Enter | Ask field | Submit the question (native `<form>` submit) | `AskLecture.jsx` |
| Escape | Navbar settings panel | Close and return focus to the gear | `onKeyDown` on the panel container in `Navbar.jsx` |
| ← → ↑ ↓ / Home / End | Study-mode Visual/Structured tabs | Move and select tab (automatic activation) | `handleVisualTabKeyDown` |
| Escape | Help dialog | Close it and return focus to the button that opened it | Document-level listener in `HelpDialog.jsx` (dialog only; not a new app-wide shortcut) |
| Tab / Shift+Tab | Help dialog | Stay inside the dialog (Close, then the scrollable contents, then back) | Same listener; the screen behind is also `inert` |
| Tab / Shift+Tab / Enter / Space | Everything else | Native button/input behaviour | — |

## Conflicts and notes

- **Electron menu mnemonics:** letters were chosen to avoid Electron's default menu mnemonics F/E/V/W/H (comment in `Explanation.jsx`). Electron's default application menu is not customised (`electron.cjs` sets none) [Verified], so P, L, N, B, R, K, M, S are assumed free (M is not one of F/E/V/W/H) **[Inferred]**; behaviour on macOS (where Option, not Alt, is the modifier) is **Unverified**.
- **Screen readers:** NVDA passes Alt+letter through to the application [per the code comment; not re-tested for the older shortcuts]. The user reported that Voice Notes work with NVDA (2026-10-19; steps not recorded, so it is not documented whether Alt+M itself was pressed under NVDA). JAWS/VoiceOver behaviour is **Unverified**.
- **Browser menus:** in a normal browser tab, some Alt+letter combinations open browser menus; the Electron app is the intended target.
- **No global shortcut** works across screens (the lecture shortcuts are bound only while `Explanation` is mounted; Alt+S only on Home/Subject).
- The lecture handler runs on `window` for the lifetime of `Explanation`; the Ask source-jump buttons and moment lists are ordinary buttons without their own shortcuts.

## Help and onboarding

- There is **no keyboard shortcut for Help** (deliberately: none was invented). It is the **Help** button in the top bar, before Settings in Tab order, and the "How Synapse works" button on Welcome.
- Help is a modal dialog over the current screen, not a navigation. Opening it over a lecture pauses what is playing and stops a playing voice note; closing it never resumes anything; it is refused while a voice note is being recorded. Tests: `Explanation.help.test.jsx`, `App.help.test.jsx` (**AUTOMATED**, fakes only).
- The Help dialog lists every shortcut in this document, by screen, from `src/lib/shortcuts.js`. The first-lecture guide card ("How this lecture works") names Alt+P, Alt+L and Alt+K from the same table.
- **Not verified:** none of the Help or guide-card behaviour has been run in a real window or with a screen reader. Real `inert` behaviour, focus return, and the order of the dialog description and the "Help closed…" announcement against focus-return speech still need an NVDA pass.

## Keeping the list accurate

To add or change a lecture-screen shortcut:

1. Add a row (or an action in an existing row) to `LECTURE_SHORTCUT_ROWS` in `src/lib/shortcuts.js`: a unique `id`, the `code`, and the display `key` (for example `{ id: "x", code: "KeyX", key: "Alt+X" }`). The spoken text and the lists in Help and on the page follow automatically. Pick a letter that avoids Electron's default menu mnemonics F, E, V, W, H (a test enforces this) and existing shortcuts.
2. Add the handler to the `shortcutsRef.current = { … }` object in `Explanation.jsx`, **keyed by the same action id**.
3. If it has a visible button, add `aria-keyshortcuts` with the same key (a test checks that every `aria-keyshortcuts` on the lecture screen is a key in the table).
4. Update the table above and this document.

`shortcuts.test.jsx` fails if the keys the lecture screen reacts to differ from the table, if a row's wording or the spoken text changes, or if Help or guide copy mentions a key the table does not have. `Explanation.jsx` no longer has a `SHORTCUTS` array, so the steps in [DEVELOPMENT_GUIDE](./DEVELOPMENT_GUIDE.md#add-a-keyboard-shortcut) that mention one are out of date; this section supersedes them (that file was not changed).

For a field-focus shortcut on another screen, the DEVELOPMENT_GUIDE note about `useFocusShortcut(inputRef, "x")` still applies; also add a row to `HOME_SHORTCUT_ROWS` so Help lists it.
