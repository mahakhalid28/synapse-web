# Voice Notes: validation status

Last updated: 2026-10-19. This file says **what was checked, by whom, and how**, so that
nothing is claimed that was not actually tested. Where a result is a user report it is
labelled as such. Related: [KEYBOARD_SHORTCUTS](./KEYBOARD_SHORTCUTS.md) (Alt+M in detail) and
[KNOWN_ISSUES_AND_TECHNICAL_DEBT](./KNOWN_ISSUES_AND_TECHNICAL_DEBT.md) (#14, #19, #23, #24).

## Legend

| Label | Meaning |
|---|---|
| **AUTOMATED** | `npm test` (Vitest + jsdom). The microphone, `MediaRecorder`, IndexedDB and YouTube player are hand-written fakes, so these check the app's logic, not the real browser. |
| **SCRIPTED-REAL** | A script drove real Electron / real Chromium (real IndexedDB, real `MediaRecorder`, real permission policy). Audio came from Chromium's **fake capture device** (a synthetic beep), not a real microphone. |
| **HUMAN (reported)** | Done by a person and reported in conversation. Claude did not observe it, and the exact steps were not recorded. |
| **NOT TESTED** | No evidence either way. |

## 1. Automated tests: 440 passing (12 files)

| Area | File | Tests |
|---|---|---|
| IndexedDB store (atomic save/delete, duplicates, validation, failures) | `src/lib/notesStore.test.js` | 104 |
| Recorder hook (order of events, 5-minute limit, errors, drafts, cleanup) | `src/hooks/useVoiceRecorder.test.jsx` | 69 |
| Per-lecture panel (record/stop, leave prompt, delete, axe) | `src/components/VoiceNotes.test.jsx` | 40 |
| Notes screen | `src/components/NotesScreen.test.jsx` | 18 |
| Note playback | `src/hooks/useNotePlayer.test.jsx` | 13 |
| Wiring inside `Explanation.jsx` (Alt+M, no auto-resume, leave guard, cue time) | `src/components/Explanation.voiceNotes.test.jsx` + `Explanation.realPanel.test.jsx` | 31 + 3 |
| App routing / opening a note | `src/App.voiceNotes.test.jsx` | 7 |
| Electron permission policy | `src/lib/electronPermissions.test.js` | 60 |
| YouTube Referer fix | `src/lib/youtubeReferer.test.js` | 32 |
| Ask (not Voice Notes) | `AskLecture.test.jsx`, `askApi.test.js` | 40 + 23 |

Microphone errors (`NotAllowedError`, `NotFoundError`, `NotReadableError`, `OverconstrainedError`,
`SecurityError`, `AbortError`) each have a test for the message shown, and the recorder is tested
to start again after a failure without a reload.

Mutation checks were run on the storage, recorder, `Explanation.jsx` wiring and Referer code:
deliberately breaking the code made the tests fail as intended.

## 2. Scripted runs in real Electron (fake microphone device)

| What | Result | Where |
|---|---|---|
| Storage against real IndexedDB, including a restart | 33 / 33 | dev (`localhost:5173`) |
| Real panel: record, save, play, go-to, leave prompt, delete, microphone released | 39 / 39 | dev |
| Packaged app: origin, permissions (mic allowed; camera, audio+video, geolocation denied), `persist()`, IndexedDB | 11 / 11 | packaged (unpacked folder) |
| Packaged app + **real YouTube player**: Alt+P plays; Alt+M pauses and the lecture stays paused; Alt+P blocked while recording; no auto-resume; note stamped with the real time; Go to / Open at; leave prompt | 25 / 25, three runs | packaged |
| Packaged app restarted on the same profile: note and audio intact, plays, delete works | 12 / 12 | packaged |
| Packaged app run from a folder with spaces, ö, Ü, `&`, parentheses | 11 / 11 | packaged |
| **Microphone blocked, then restored in the same session** (clear message, exact error name, nothing saved, lecture stays paused, then the same button records) | 15 / 15 | dev; blocked at the Electron policy layer |

Packaged runs used a scratch build made from the repository's own files, packaged with a configuration
kept outside the repository (`electron-builder --dir`, an **unpacked folder**, not an installer). There is
no `build` block in `package.json`. They ran on Windows with the mock lecture data (`USE_MOCK = true`) and
the real YouTube player (internet required). Keyboard input in these runs (for example Alt+M) was sent as
key events through the DevTools protocol, which reaches the page but does not exercise the native
application menu. The "folder with spaces, ö, Ü, `&`, parentheses" run covered the permission and storage
checks only, not the whole recording flow. All of these were run and read by Claude, not by a person.

## 3. Human-verified (reported by the user, 2026-10-19)

| Check | Status | Not recorded |
|---|---|---|
| Voice notes with a **real Windows microphone** | Working (reported) | which steps, dev or packaged app, microphone model |
| **NVDA** screen reader | Working (reported) | NVDA version, which steps, dev or packaged app |

Not recorded for either row: the Windows version, the NVDA version, whether it was `npm run electron:dev`
or a packaged build, the exact steps, and whether **Alt+M** itself (as opposed to the Record button)
was pressed under NVDA. These are left blank on purpose and must be filled in by the person who ran
the tests; this file does not guess them. Until then, each row only means "the user reported no problem".

| Detail to fill in | Value |
|---|---|
| Windows version | *not recorded* |
| NVDA version | *not recorded* |
| App mode used (`npm run electron:dev` or a packaged build) | *not recorded* |
| Steps run with the real microphone | *not recorded* |
| Steps run with NVDA | *not recorded* |

Claude's own runs (sections 1 and 2) never used a real microphone or a screen reader.

## 4. Not tested

| Scenario | Why it matters |
|---|---|
| Windows "Let desktop apps access your microphone" switched **off** (real `NotAllowedError` from Windows) | The message and recovery are tested with a policy-layer block, not with the real Windows setting |
| No microphone device (real `NotFoundError`) and device busy in another app (real `NotReadableError`) | Messages are unit-tested only |
| A real 5-minute recording reaching the limit | Limit and warning are tested with fake timers only |
| Installer (NSIS), code signing, application icon | Only an unpacked folder was built |
| Ask in the packaged app against the **real** backend | See section 5 |
| Alt+M typed on a physical keyboard through the native application menu (scripted runs injected key events instead) | Whether the real key press is intercepted before the page is not shown by any scripted test; the reported NVDA/microphone tests may have covered it, but the steps were not recorded |
| Reported HUMAN tests: the exact steps, versions and app mode | Not recorded (see section 3) |
| JAWS, Narrator, macOS, Linux | Out of scope so far |
| Low disk space / storage quota exceeded | Unit-tested with an injected error only |

## 5. Adjacent check: Ask in the packaged app

**SCRIPTED-REAL, against a stand-in, not the real backend.** A local stand-in server that encodes the
backend's documented origin rule (no real backend, no pipeline, no model, no Gemini) was used. The
packaged app's `POST /video/ask` arrived with **no `Origin` header** (observed). The backend's guard
allows requests without an `Origin`, so Ask should work from the packaged app. **NOT TESTED:** a real Ask
request to the real backend from the packaged app.

Inferred, not tested: that the missing `Origin` is a result of `webSecurity: false`, and that with
`webSecurity` enabled the page would send `Origin: null`, which the backend rejects with 403 by default
(per its README and its own tests). The API base URL is fixed when the app is built
(default `http://127.0.0.1:8000`).

## 6. Known limitations (by design or accepted)

- Closing the window during a recording stops the microphone and discards the audio. There is no
  Save/Discard prompt for that case (it would need IPC and a preload, which the app does not have).
- Packaged playback depends on `electron/youtubeReferer.cjs` (Error 153 workaround) and on YouTube's
  behaviour. SCRIPTED-REAL: Error 153 appeared without it and not with it.
- **Inferred, not tested:** the packaged page needs `webSecurity: false` to load its module script over
  `file://`. Nobody turned the setting on to check.
- **Expected, not tested:** dev (`http://localhost:5173`) and a packaged build (`file://`) are different
  origins, so their IndexedDB databases should be separate and notes should not carry over. Both were
  tested separately, never against one shared profile.
- Notes are stored unencrypted on this computer. The code does not send them anywhere (AUTOMATED: the
  storage module is tested not to use the network or `localStorage`); no network capture was done.
- An installer, code signing and an application icon do not exist in the repository and have not been tried (NOT TESTED).

## 7. Smallest remaining manual test: microphone permission denied, then recovered

1. Start the app and open a lecture. In Windows, open Settings, Privacy and security, Microphone, and turn
   **off** "Let desktop apps access your microphone".
2. Press Alt+M. Expect: the lecture pauses, a message says access was blocked and names the setting, and
   (with NVDA) the same message is spoken. No note appears.
3. Turn the Windows setting **on** again. Without restarting the app press Alt+M.
   Expect: it records normally. If it still fails, note the exact message and whether a restart fixes it.
4. Turn the setting back on if you left it off.

## 8. Documentation status (2026-10-19)

Updated to describe Voice Notes and the packaged-build findings: `README.md`,
`docs/KEYBOARD_SHORTCUTS.md` (Alt+M), `docs/KNOWN_ISSUES_AND_TECHNICAL_DEBT.md` (#3, #14, #19, #23, #24),
this file, and `CLAUDE.md`.

Not updated and therefore still silent about Voice Notes, IndexedDB, the `"notes"` screen,
`electron/permissions.cjs` and `electron/youtubeReferer.cjs`: `docs/ARCHITECTURE.md`,
`docs/SCREENS_AND_COMPONENTS.md`, `docs/DATA_FLOW_AND_STATE.md`, `docs/STORAGE_AND_PERSISTENCE.md`
(lists `localStorage` keys only), `docs/TESTING_AND_DEBUGGING.md`, `docs/DEVELOPMENT_GUIDE.md`,
`docs/ACCESSIBILITY.md` (its manual NVDA checklists have no voice-note steps) and `docs/manualtestingguide`.
