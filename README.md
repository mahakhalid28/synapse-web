# Synapse — Frontend

Synapse is an accessibility-first STEM learning app for **blind and low-vision students**. A student pastes (or searches for) a YouTube lecture; a backend detects the moments where the lecturer shows an equation, diagram, chart, graph or code; each moment gets a text explanation plus a spoken (TTS) version; and the frontend plays the real YouTube video, pauses at each moment, and lets the student read or listen to the explanation. Students can also ask free-text questions about the lecture.

This repository is the **React + Vite + Tailwind renderer, wrapped in Electron**. The FastAPI backend lives in a separate repository (not documented here; the backend repo also contains an older, stale `frontend/` copy — ignore it).

> **Documentation conventions.** Every claim in `docs/` is tagged where it matters: **[Verified]** (read directly from source or a command that was run), **[Inferred]** (follows from the code but was not executed), **[Unknown]** (cannot be established from this repository). Paths are repository-relative.

---

## What is implemented

| Feature | Where | Status |
|---|---|---|
| Home: paste a YouTube link or search, "Continue learning" card, subject shortcuts | `src/components/Home.jsx`, `SubjectLectures.jsx` | Implemented. **Search results are mock data** (`src/lib/lectureSearch.js`). |
| Process a video and show detected "moments" | `src/api.js` → `Explanation.jsx` | Implemented against a backend; **mock mode is on by default** (`USE_MOCK = true`). |
| Lecture screen with a real YouTube player that auto-pauses at each moment | `src/components/Explanation.jsx` | Implemented. |
| Text explanation, key insight, structured "visual information" | `Explanation.jsx` | Implemented (structured data is mock-only today; the real backend does not send it yet). |
| Explanation audio (TTS) with speed control | `Explanation.jsx`, `src/api.js` | Implemented; audio comes from the backend (mock mode synthesises a tone). |
| Accessibility mode vs Study mode | `Explanation.jsx` | Implemented. |
| Keyboard shortcuts (Alt+P/L/N/B/R/K/M/,/. on the lecture screen, Alt+S on Home/subject pages) | `Explanation.jsx`, `src/hooks/useFocusShortcut.js` | Implemented. Alt+M starts/stops a voice note. See [KEYBOARD_SHORTCUTS](docs/KEYBOARD_SHORTCUTS.md). |
| **Ask a question about this lecture** (lecture-wide Q&A) | `src/components/AskLecture.jsx`, `src/lib/askApi.js` | Implemented; always calls the real `POST /video/ask`, even when `USE_MOCK` is on. In the packaged app it was only checked against a local stand-in server, **not** the real backend (see [VOICE_NOTES_VALIDATION](docs/VOICE_NOTES_VALIDATION.md#5-adjacent-check-ask-in-the-packaged-app)). |
| **Voice Notes**: record your own audio note at the current lecture moment (Alt+M or the Record button), replay it, jump back to its time, delete it with confirmation | `src/components/VoiceNotes.jsx` (per lecture), `NotesScreen.jsx` (all notes, sidebar "Voice notes"), `src/hooks/useVoiceRecorder.js`, `src/lib/notesStore.js`, `electron/permissions.cjs` | Implemented. Audio is stored on this computer in **IndexedDB** (not `localStorage`) and the code does not send it anywhere. Recording pauses the lecture and never resumes it. What is verified, and how, is in [VOICE_NOTES_VALIDATION](docs/VOICE_NOTES_VALIDATION.md). |
| Timeline view of all moments | `src/components/Timeline.jsx` | Implemented. |
| Bookmarks and Library (saved explanations) | `BookmarksScreen.jsx`, `LibraryScreen.jsx`, `src/storage.js` | Implemented (browser `localStorage`). |
| Export explanation as PDF | `Explanation.jsx` (`exportToPDF`, jsPDF) | Implemented. |
| Export explanation as audio | `Explanation.jsx` (`exportToAudio`) | **Placeholder** — downloads a 5-second tone, not the real TTS. |
| Three colour themes (Paper, Night, Sepia) | `Navbar.jsx`, `App.jsx`, `src/index.css` | Implemented (Sepia only partially themed — see [STYLING](docs/STYLING_AND_DESIGN_SYSTEM.md)). |
| Electron packaging/installer | — | **Not set up in the repository** (no `build` block, no script). An unpacked packaged build made *outside* the repo was run and checked by scripts (SCRIPTED-REAL, fake microphone); an **installer, code signing and the app icon have not been tried** (NOT TESTED). See [Known issues](docs/KNOWN_ISSUES_AND_TECHNICAL_DEBT.md) #14. |

## Tech stack

- **React 18** (`react`, `react-dom`), plain JavaScript/JSX (no TypeScript), no router library, no state library.
- **Vite 8** (`vite`, `@vitejs/plugin-react`) — dev server on `http://localhost:5173`.
- **Tailwind CSS 3** + PostCSS/Autoprefixer, with CSS-variable design tokens in `src/index.css`.
- **Electron 41** shell (`electron.cjs`), `concurrently` + `wait-on` for the dev workflow.
- **jsPDF** for PDF export; **Fontsource** (Atkinson Hyperlegible) for self-hosted fonts.
- **YouTube IFrame Player API** (script loaded at runtime from `https://www.youtube.com/iframe_api`).
- **Tests:** Vitest 5, Testing Library, jest-axe, jsdom. ESLint 10 for linting.

## Prerequisites

- **Node.js ≥ 18** and npm. (`requirements.txt` states 18+; the exact version used by the team is **[Unknown]**. Some dependencies — e.g. Vite 8, Vitest 5, Electron 41 — may require a newer Node; check the install output if you see engine warnings.)
- A Windows, macOS or Linux machine. Development so far has been on Windows 11 **[Inferred from repo history and tooling]**.
- For real (non-mock) behaviour: the Synapse FastAPI backend running somewhere reachable. Without it, only the mock lecture flow works.
- Internet access: the YouTube player, thumbnails (`i.ytimg.com`), video metadata (`noembed.com`) and a Google Fonts stylesheet are all fetched at runtime.

## Install and run

```bash
npm install            # install dependencies
npm run dev            # Vite only → http://localhost:5173 (use a browser)
npm run electron:dev   # Vite + Electron window together (recommended for NVDA testing)
```

Other scripts (all from `package.json`):

| Command | What it does |
|---|---|
| `npm run build` | `vite build` → static output in `dist/`. |
| `npm run preview` | Serves the built `dist/` with Vite's preview server. |
| `npm run lint` | `eslint .` (currently reports pre-existing findings — see [Known issues](docs/KNOWN_ISSUES_AND_TECHNICAL_DEBT.md)). |
| `npm test` | `vitest run` — 440 tests in 12 files (all passing when last run, 2026-10-19). They use jsdom and fakes; they do not test real hardware. |
| `npm run electron` | `wait-on http://localhost:5173 && electron .` — expects a dev server already running. |

There is **no packaging command**. `electron-builder` is installed as a devDependency but there is no `build` configuration or script for it, and none is needed for day-to-day development (`npm run electron:dev` is the workflow). If you ever need a runnable copy: run `npm run build` first (an existing `dist/` may be stale), and send the packager's output somewhere other than `dist/`, which `vite build` uses. A scratch unpacked build made this way, with its configuration kept outside the repo, was tested; installers, signing and icons were not. The packaged page is loaded from `file://`, which is why `electron/youtubeReferer.cjs` exists (without it YouTube shows "Error 153" and the lecture does not play). Details: [Known issues](docs/KNOWN_ISSUES_AND_TECHNICAL_DEBT.md) #14 and [VOICE_NOTES_VALIDATION](docs/VOICE_NOTES_VALIDATION.md).

## Configuration

| Setting | Where | Notes |
|---|---|---|
| `USE_MOCK` | `src/api.js` (top of file) | `true` = fake processing, fake moments (`p1`–`p6`), tone audio. Currently committed as **`true`**; the project notes (`CLAUDE.md`) say it should normally be `false`. Owned by the explanation/audio code — change only deliberately and revert after local testing. |
| `API_BASE_URL` | `src/api.js` (hard-coded constant) | Backend used by `processVideo`, `getInterventionPoints`/explain endpoints. **Hard-coded to an ngrok URL**; edit the source to change it. |
| `VITE_API_BASE_URL` | environment (see `.env.example`) | Used **only** by the Ask feature (`src/lib/askApi.js`). Defaults to `http://127.0.0.1:8000`. Put overrides in `.env.local` (git-ignored). It is read when Vite starts or builds, so in a built/packaged app it is **fixed at build time**. |

No secrets are stored in this repository. Do not commit tunnel URLs that embed credentials.

## Architecture in one paragraph

`src/main.jsx` mounts `<App>` (`src/App.jsx`), which keeps a single `screen` string (`"home" | "subject" | "timeline" | "explanation" | "bookmarks" | "library" | "notes"`) plus a `jobInfo` object and renders exactly one screen component, with a shared skip link and `Navbar` above it. Screens call `src/api.js` for backend data, `src/storage.js` for saved items (browser `localStorage`), `src/lib/notesStore.js` for voice-note audio (IndexedDB, never `localStorage`), and — on the lecture screen — drive a real YouTube iframe player and an HTML5 `Audio` element for the explanation TTS. Everything spoken to a screen reader goes through a small number of polite live regions. Full detail: [ARCHITECTURE](docs/ARCHITECTURE.md).

## Documentation map

| Document | Read it to… |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Understand subsystems, startup, navigation, boundaries (with diagrams). |
| [docs/SCREENS_AND_COMPONENTS.md](docs/SCREENS_AND_COMPONENTS.md) | Find any screen/component, its props, state and where to change it. |
| [docs/DATA_FLOW_AND_STATE.md](docs/DATA_FLOW_AND_STATE.md) | Follow data from user input to rendered output; YouTube vs TTS state. |
| [docs/API_AND_BACKEND_INTEGRATION.md](docs/API_AND_BACKEND_INTEGRATION.md) | See every backend call, mock mode, and the Ask contract. |
| [docs/STORAGE_AND_PERSISTENCE.md](docs/STORAGE_AND_PERSISTENCE.md) | Know every `localStorage` key and data shape. |
| [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md) | Understand focus, live regions, announcements, and run a manual NVDA check. |
| [docs/STYLING_AND_DESIGN_SYSTEM.md](docs/STYLING_AND_DESIGN_SYSTEM.md) | Use the tokens and `ds-*` classes correctly. |
| [docs/KEYBOARD_SHORTCUTS.md](docs/KEYBOARD_SHORTCUTS.md) | Look up every verified shortcut and its handler (including Alt+M for voice notes). |
| [docs/VOICE_NOTES_VALIDATION.md](docs/VOICE_NOTES_VALIDATION.md) | See what was checked for Voice Notes, by whom and how (AUTOMATED / SCRIPTED-REAL / HUMAN / NOT TESTED), and what is still untested. |
| [docs/TESTING_AND_DEBUGGING.md](docs/TESTING_AND_DEBUGGING.md) | Run/write tests and debug renderer, Electron, API, player, TTS. |
| [docs/DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md) | Add screens, components, shortcuts, requests, persisted data safely. |
| [docs/FEATURE_INTEGRATION_GUIDE.md](docs/FEATURE_INTEGRATION_GUIDE.md) | Step-by-step checklist for a new feature. |
| [docs/KNOWN_ISSUES_AND_TECHNICAL_DEBT.md](docs/KNOWN_ISSUES_AND_TECHNICAL_DEBT.md) | Confirmed issues, stale files, risks. |

Other existing project files: `CLAUDE.md` (notes for AI assistants; **partly out of date**, see Known issues), `docs/manualtestingguide` (a manual NVDA walkthrough; its Ask section is out of date), `requirements.txt` (a plain-text setup note, not a Python file; its API section is out of date).

## Common setup problems

| Symptom | Likely cause / fix |
|---|---|
| Electron window is blank or "connection refused" | `npm run electron` needs the Vite server on port **5173**. Use `npm run electron:dev`, or start `npm run dev` first. `electron.cjs` always loads `http://localhost:5173` unless the app is packaged. |
| `Can't reach the Synapse server. Is it running?` in the Ask box | Nothing is listening on `VITE_API_BASE_URL` (default `http://127.0.0.1:8000`). Start the backend, or set the variable and restart Vite (env vars are read at startup). |
| Browser console shows a CORS error on `/video/ask` | The backend must allow your dev origin (`http://localhost:5173`). Electron has `webSecurity: false` and does not hit CORS; a browser does. |
| Lecture screen says "Loading your lecture" forever in real mode | `getInterventionPoints` only works after `processVideo` ran in the same session (in-memory cache). See [API doc](docs/API_AND_BACKEND_INTEGRATION.md#caching). |
| Search "finds" the same two videos for every query | Search is mocked (`src/lib/lectureSearch.js`). Paste a YouTube URL instead. |
| Fonts look different offline | `src/index.css` imports a Google Fonts stylesheet in addition to the self-hosted Fontsource fonts. |
| `npm test` fails with missing modules | Run `npm install` (test tooling is in `devDependencies`). |
| Port 5173 already in use | Stop the other Vite instance; `electron.cjs` and `wait-on` assume 5173. |
| Voice note: "Microphone access was blocked" | Windows Settings → Privacy and security → Microphone → turn on "Let desktop apps access your microphone", then press Alt+M again. In the scripted test the same button recorded again without a restart once access was restored; with the real Windows switch that recovery has **not been tested**. Messages for a missing or busy microphone are in the panel. |
| Packaged app only: the lecture video shows "Error 153" | YouTube refuses an embed on a page that sends no Referer. `electron/youtubeReferer.cjs` supplies one; make sure it is in the packaged files. |
