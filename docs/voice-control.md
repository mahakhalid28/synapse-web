# Voice control (frontend)

The full design, decisions, benchmark results and module status are in the
backend repository: `pipeline_synapse/docs/voice-control.md`. This note covers
only what is in this repository.

## What is here

Module 1 (contract) and module 2 (audio arbiter and capture). Nothing is sent to
the backend yet: pressing the talk shortcut records one short utterance, converts
it to a 16 kHz WAV clip, and reports how many seconds it recorded.

| File | Purpose |
|---|---|
| `src/voice/actions.generated.js` | Action list generated from the backend catalog. **Do not edit by hand.** Regenerate with `python -m voice.catalog export-js --out <this file>` in the backend. |
| `src/voice/contract.js` | Validates backend responses before the app may act on them and builds the bounded context sent with each utterance. |
| `src/voice/voiceTurn.js` | The rules of a turn as pure functions: states, limits, `decideRestore`, `isQuiet`. |
| `src/voice/wav.js` | Mono mix-down, resampling to 16 kHz and WAV encoding. |
| `src/voice/micCapture.js` | Microphone capture, noise-floor measurement and the automatic stops. |
| `src/voice/useVoiceTurn.js` | `VoiceTurnController` (plain class) and the `useVoiceTurn` hook. |
| `src/voice/voiceAudio.js`, `VoiceAudioProvider.jsx` | The registry through which the lecture screen offers pause / check / restore. |
| `src/voice/VoiceControl.jsx` | The Talk button, Alt+T and Space handling, and one polite live region. |
| `src/lib/voiceFlag.js` | Feature flag `VITE_VOICE_CONTROL_ENABLED`. |

## Using it

- **Alt+T** starts listening; **Alt+T again** stops. Nothing to hold.
- **Space, held,** on the focused Talk button listens while the key is down.
- Listening also stops by itself: 1.4 s of silence after speech, 6 s with no
  speech, or 12 s in total.
- The Talk button is in the top bar. It is **on in development and off in a
  production build and in tests** unless `VITE_VOICE_CONTROL_ENABLED` is `true`/`1`.

## Rules

- Everything Synapse plays is paused and confirmed silent before the microphone
  opens; the microphone is closed before anything is announced or restored.
- Nothing is announced while the microphone is open.
- Audio is resumed only if it was playing before, and never after a spoken
  playback command, after leaving the lecture screen, or after the learner
  started audio during the turn. The lecture screen's pause owner is put back as it was.
- The microphone is shared with Voice Notes: voice control will not start while
  a note is recording, and Alt+M is ignored while voice control is listening.
- The app never acts on a response `parseInterpretResponse` returns `null` for,
  and an action is refused when it does not belong on the current screen.
- Voice reuses existing handlers (`pauseLectureAudio`, `handleNavigate`, ...). It
  does not copy them.

## Running the tests

Vitest 5 and jsdom 30 need Node 22.12 or newer. With the default Node 20, `npm test`
fails to start. Run it with Node 22 directly:

```powershell
$node22 = "C:\Users\noorf\AppData\Local\nvm\v22.14.0\node.exe"
& $node22 node_modules\vitest\vitest.mjs run src/voice src/components/Explanation.voicePort.test.jsx
& $node22 node_modules\vitest\vitest.mjs run     # whole suite
npx eslint src/voice
```

Last result: full suite 981 passed in 41 files; ESLint clean on the new files;
a production `vite build` compiles. All of it uses fakes: voice control has not
been run with a real microphone, the real YouTube player, Electron or a screen
reader. See "Limits" in the backend document.

## Voice commands (modules 3 to 8)

Alt+T now sends the recording to the backend (`/voice/transcribe` then `/voice/interpret`), runs the matching existing handler and speaks a reply. Screens register their handlers with `useVoiceActions` (`src/voice/voiceActions.js`): App, `useLectureSearch`, Home, LibraryScreen, BookmarksScreen and Explanation. `voiceCommands.js` is the handler, `voiceSpeech.js` speaks replies (preference `synapse_voice_feedback`: `tts` or `screenreader`). English only so far. See the backend document for measurements and limits.

Module 9: Voice notes (`open_item`), Timeline (`go_to_moment`) and Quiz (`quiz_*`, registered in `QuizScreen.jsx`) now take voice commands. Tests: `src/voice/screens.voice.test.jsx`. Details in the backend document.
