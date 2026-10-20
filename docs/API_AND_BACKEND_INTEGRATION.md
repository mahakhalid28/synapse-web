# API and Backend Integration

What the frontend sends to, and expects from, the Synapse backend. The backend is a separate FastAPI repository that is **not** inspected here: every response shape below is what the *frontend code reads*, not a verified backend contract. Tags: **[Verified]** (read from frontend source), **[Inferred]**, **[Unknown]**. No backend calls were made while writing this document.

## Files

| File | Role |
|---|---|
| `src/api.js` | Main API client + all mock data (`USE_MOCK`). Used by `App.jsx`, `Timeline.jsx`, `Explanation.jsx`. |
| `src/lib/askApi.js` | Independent client for `POST /video/ask`. Never mocked. |
| `src/lib/lectureSearch.js` | Mock lecture search (no network). |
| `src/lib/youtubeIframeApi.js` | Loads the YouTube IFrame API script (not the Synapse backend). |

## Backend URL configuration

| Client | Base URL | How to change |
|---|---|---|
| `src/api.js` | `const API_BASE_URL = "https://nearby-bankroll-heading.ngrok-free.dev"` (line 14) | Edit the source constant. No env var. It is an ngrok tunnel address, so it changes whenever the tunnel is restarted [Inferred]. |
| `src/lib/askApi.js` | `import.meta.env.VITE_API_BASE_URL` or `http://127.0.0.1:8000` (trailing slashes stripped) | Set `VITE_API_BASE_URL` in `.env.local` (template: `.env.example`) and restart Vite. |

The two clients can therefore point at **different servers**. If you test Ask against a local backend while `USE_MOCK = false` and `API_BASE_URL` still points at ngrok, processing/explanations and Ask hit different machines.

Auth: none. No tokens or cookies are sent [Verified]. `src/api.js` sends `ngrok-skip-browser-warning: true` on its requests (a custom header — it triggers a CORS preflight in a browser). `src/lib/askApi.js` sends only `Content-Type: application/json`.

CORS: Electron runs with `webSecurity: false` (`electron.cjs`) so CORS is not enforced there; in a browser tab the backend must allow the page origin (the Ask contract says `http://localhost:5173` and `http://127.0.0.1:5173` are allowed by default; whether the *ngrok-hosted* backend allows them is **[Unknown]**).

## Mock mode

`const USE_MOCK = true;` at the top of `src/api.js` (committed as `true`; project notes say to leave it `false` except for local testing and always revert). When `true`:

| Function | Mock behaviour |
|---|---|
| `processVideo` | Waits 400 ms, resolves `{ jobId: videoId }`. No network. |
| `getJobStatus` | Simulates a 12 s job with stages and progress (unused by the UI). |
| `getInterventionPoints` | Returns `MOCK_INTERVENTIONS` (6 moments: `p1`–`p6`, timestamps `0:10`, `0:14`, `1:30`, `3:00`, `5:45`, `8:20`), duration `"19:13"`, and still calls `noembed.com` for title/author. `p1`/`p2` are deliberately 4 s apart to exercise sequencing. |
| `getExplanation`, `getTTSExplanation` | Content from the same `MOCK_INTERVENTIONS` table; audio is a generated 8 s 220 Hz WAV blob URL. |
| Search | Always mocked, independent of the flag (see below). |
| **Ask** | **Not mocked.** `askQuestion` always calls the real endpoint. |

Recommended real video for manual testing in mock mode: `https://www.youtube.com/watch?v=aircAruvnKk` (noted in `src/api.js` and `CLAUDE.md`).

Mock IDs (`p1`…) are not UUIDs, so Ask never sends them as `intervention_id`.

### Search is mock-only

`src/lib/lectureSearch.js` `searchVideos(query)` returns two hard-coded videos after 500 ms in both mock and real modes. A real search endpoint is a TODO in that file [Verified].

## Endpoints called by `src/api.js` (real mode)

### `POST {API_BASE_URL}/video/process`

- **Called by:** `processVideo({url, videoId, mode})` ← `App.handleProcess`.
- **Headers:** `Content-Type: application/json`, `ngrok-skip-browser-warning: true`.
- **Body:** `{ "youtube_url": "https://www.youtube.com/watch?v=<videoId>" }` (the `mode` argument is accepted but **not sent**).
- **Response fields the frontend reads** (stored whole in module variable `cachedResult = { videoId, data }`):
  `title`, `duration_seconds`, `duration_formatted`, `interventions[]` where each item uses `id`, `content_type`, `timestamp` (seconds; only the last one is used, to estimate duration when `duration_seconds === 0`), `timestamp_formatted`, `transcript_context`, `frame_path`, and optionally `focusRegion`, `structured`. Everything else is **[Unknown]**.
- **Errors:** `!response.ok` → `throw new Error("Process failed: <status>")`. Network errors propagate. No timeout, no abort, no retry. `Explanation` shows a generic `role="alert"` message and discards the error detail.
- **Returns to caller:** `{ jobId: videoId }`.

### `GET {API_BASE_URL}/api/jobs/{jobId}` — defined but unused

`getJobStatus(jobId)`; expected `{ stage, progress, message, done }` per the doc comment (`stage`: downloading/extracting/detecting/generating/done). **Not called by any component** (the old Processing screen that polled it was removed). Errors: `throw new Error("Status fetch failed: <status>")`.

### `POST {API_BASE_URL}/video/intervention/explain`

- **Called by:** internal `getInterventionExplanation(videoId, interventionId, mode)` ← `getExplanation` and `getTTSExplanation` (one shared request via `_explanationCache`).
- **Body:** `{ "video_id": <videoId>, "intervention_id": <interventionId>, "output_mode": <mode> }`, headers as above.
- **Response fields read:** `text_explanation` (string), `audio_file_path` (string path or absolute URL), plus optional `explanation` and `keyInsight` (preferred over the heuristic split when present). Documented current shape: `{ intervention_id, text_explanation, audio_file_path, output_mode }`.
- **Errors:** `!res.ok` → reads body text, `console.error("[Synapse] /video/intervention/explain <status>: …")`, throws `Error("Explain failed: <status> — <body>")`, and removes the cache entry so a later call retries. No timeout or abort.

### `GET {API_BASE_URL}/{audio_file_path}` (audio file)

- Called inside the same function for `audio_file_path` (used as-is if it starts with `http`, else `API_BASE_URL + "/" + path`), with `ngrok-skip-browser-warning: true`.
- On success the response is turned into a blob URL (`URL.createObjectURL`), which replaces `audio_file_path` in the returned object (never revoked — see [Known issues](./KNOWN_ISSUES_AND_TECHNICAL_DEBT.md)). On failure: `console.warn` and `audio_file_path: null`; the explanation text still loads.

### Third-party: `GET https://noembed.com/embed?url=https://www.youtube.com/watch?v=<id>`

`getVideoMetadata(videoId)` reads `title` and `author_name`. No `res.ok` check; a non-JSON or error response would throw/return undefined fields. Callers catch and fall back to defaults (`"Untitled video"`/`raw.title`, author `"Unknown"`). Logs the raw response with `console.log`.

## Ask a question (`POST /video/ask`)

**Where:** `src/lib/askApi.js` (client), `src/components/AskLecture.jsx` (UI), tests in `src/lib/askApi.test.js` and `src/components/AskLecture.test.jsx`.

> The contract below was supplied by the backend owner and is what the frontend implements. It is **not** stored in this repository, and the endpoint's live behaviour has **not** been verified against a running backend from here [Unknown].

**Request** — `POST {ASK_BASE_URL}/video/ask`, `Content-Type: application/json`:

| Field | Type | Required | Frontend rule |
|---|---|---|---|
| `video_id` | string | yes | Must match `^[A-Za-z0-9_-]{11}$` (checked before sending; failure shows the 422 message). |
| `question` | string | yes | Trimmed; 1–500 characters (input `maxLength=500`, submit blocked when empty/too long). |
| `current_time_seconds` | number | no | From `playerRef.current.getCurrentTime()`; omitted if not a finite number in `0..172800`. |
| `intervention_id` | string | no | Sent only if (a) the learner has selected or paused on a moment (`pauseOwner !== null`), (b) the id is UUID-shaped (`isRealInterventionId`), so mock ids are never sent. |

```json
{ "video_id": "aircAruvnKk", "question": "What did the lecturer say about the cost function?",
  "current_time_seconds": 187.5, "intervention_id": "3f2b8c1e-5d4a-4e7b-9a10-2c6d8e9f0a1b" }
```

**Response 200:**

```json
{ "status": "answered",            // or "not_in_lecture" | "insufficient_context"
  "scope": "lecture",              // or "lecture_with_moment"
  "answer_text": "plain text written to be read aloud",
  "sources": [ { "start_seconds": 200, "end_seconds": 245, "intervention_id": null } ] }
```

Invariant (also enforced client-side by `parseAskResponse`): `sources` is non-empty only when `status === "answered"`; a source with an `intervention_id` has `start_seconds == end_seconds`. A response with an unknown `status` or an empty/non-string `answer_text` is rejected as a server error; sources with non-numeric times are dropped. `scope` is parsed but not displayed.

**Errors** (JSON `{"detail": "..."}` expected; the frontend ignores `detail` except one case) → `AskError.kind` → shown message:

| HTTP | kind | Message shown | Try again |
|---|---|---|---|
| 429 | `busy` | The AI service is busy right now. Please try again in a minute. | yes |
| 503, 504 (and client 90 s timeout) | `unavailable` | The AI service didn't respond. Please try again. | yes |
| 500, 502, other | `server` | Something went wrong on our side. Please try again later. | no |
| 404 | `videoNotFound` | This video isn't available for questions yet. | no |
| 422 | `invalid` | Please check your question (1-500 characters). | no |
| 403 | `forbidden` | The Synapse server didn't accept this request. | no |
| fetch rejects (network) | `network` | Can't reach the Synapse server. Is it running? | yes |

Special case: a 404 whose `detail` is exactly `"Intervention not found"` while an `intervention_id` was sent is **retried once without `intervention_id`** (keeping `current_time_seconds`); a second failure is reported normally. A 404 `"Video not found"` is not retried. Raw server text is never displayed.

**Timeout/cancel:** 90 s (`ASK_TIMEOUT_MS`) via `AbortController`; caller aborts (unmount, video change) reject with `AbortError` which the UI ignores silently.

**Rendering rules:** `answer_text` is rendered as plain React text (never `dangerouslySetInnerHTML`); sources become "Jump to m:ss to m:ss" buttons. See [SCREENS_AND_COMPONENTS](./SCREENS_AND_COMPONENTS.md#srccomponentsasklecturejsx--lecture-wide-qa) and [ACCESSIBILITY](./ACCESSIBILITY.md).

**Unverified assumptions to confirm with the backend owner:** real intervention ids are UUID4 strings; CORS allows the origins used; `current_time_seconds` accepts floats; error `detail` strings are exactly as above.

## Quiz generation (`POST /video/quiz`), proposed

> **Status (updated 2026-10-20): built, off by default, never run against a real model.** The backend endpoint exists in the backend repository (answers 404 unless `QUIZ_ENABLED` is exactly `1` or `true`) and is tested with fake providers only. The front-end client `src/lib/quizApi.js` exists and is tested with a mocked `fetch`, and the quiz screen calls it only when the learner presses "Create questions", on a screen reachable only with the front-end flag `VITE_QUIZ_ENABLED` on (off by default and not set anywhere). Tests mock `fetch`; it has never been called against a live backend. Full contract: [QUIZ_CONTRACT](./QUIZ_CONTRACT.md) (see [section 4](./QUIZ_CONTRACT.md#4-backend-api-contract)). **This section authorizes no model calls and no spending.**

**Request** (`POST {base}/video/quiz`, `Content-Type: application/json`):

| Field | Type | Required | Rule |
|---|---|---|---|
| `video_id` | string | yes | `^[A-Za-z0-9_-]{11}$` |
| `question_count` | integer | no | 5 to 10, default 6. Unknown fields are rejected (422). |

**Response 200** (abridged; the full question object is in the contract):

```json
{ "contract_version": 1, "quiz_id": "uuid", "video_id": "5ugDJhmmkFM",
  "requested_count": 6, "returned_count": 5, "status": "partial",
  "reason": null, "notice": "Only 5 of the 6 questions ...", "questions": [ "..." ] }
```

Invariants (checked by the server and again by the client): `complete` means `returned_count == requested_count`; `partial` means `3 <= returned_count < requested_count` and a `notice`; `insufficient_material` means fewer than 3 usable questions, an empty `questions` list, and a `reason` (`no_transcript`, `too_short` or `validation_failed`). Questions are multiple-choice or true/false only. The model returns **evidence ids**; the server maps them to transcript timestamps, and the model never states times. Automatic checks only reject questions; they are screening, not proof, and the quiz is never labelled "verified".

**Errors** (JSON `{"detail": "..."}`; the proposed client never shows raw `detail`):

| HTTP | kind | Message shown | Try again |
|---|---|---|---|
| 429 | `busy` | The AI service is busy right now. Please try again in a minute. | yes |
| 503, 504, client timeout | `unavailable` | The AI service didn't respond. Please try again. | yes |
| 502 | `unusable` | The AI service returned something we couldn't use. Please try again. | yes |
| 500, other | `server` | Something went wrong on our side. Please try again later. | no |
| 404 `"Video not found"` | `videoNotFound` | This video isn't available for practice questions yet. | no |
| 404 `"Quiz is not available."` | `featureOff` | (entry hidden) | no |
| 422 | `invalid` | Please check the number of questions (5 to 10). | no |
| 403 | `forbidden` | The Synapse server didn't accept this request. | no |
| network failure | `network` | Can't reach the Synapse server. Is it running? | yes |

**Retry and timeouts (all provisional, Unverified):** the client never retries automatically; each Retry is a new request. The server makes at most 2 model calls per request and never retries a provider error. Overall server limit about 100 s; client timeout 120 s.

**Not mocked:** like Ask, the quiz client would call the real backend and bypass `USE_MOCK`.

**Unverified:** that the model returns schema-valid output; real latency and rejection rates; CORS for the quiz endpoint; the exact `detail` strings. Integration into `Explanation.jsx` needs its owner's sign-off and is not part of Stage 0.

## Caching

- `cachedResult` (module variable in `src/api.js`): the last `/video/process` response. `getInterventionPoints` reads **only** from it in real mode and throws `"No cached result. Process the video first."` when missing or for another video. It lives in memory only.
- `_explanationCache` (`Map`, key `videoId::interventionId::mode`): stores the in-flight/finished promise of the explain call so text and audio share one request; failed entries are deleted. Never evicted otherwise.

## Frontend assumptions about the backend

1. `/video/process` is synchronous from the frontend's view (it resolves when processing is done; the UI's progress percentage is a time estimate).
2. Interventions come in the order the frontend should treat as sequential, with `timestamp_formatted` in `HH:MM:SS`/`MM:SS` form.
3. Explanation text is paragraph-separated by blank lines; the last paragraph is treated as a key insight if there are more than two.
4. Audio is a file reachable by `GET` (relative path or absolute URL) and playable by an HTML5 `Audio` element.
5. Backend ids are stable between sessions (they are persisted in bookmarks/library).

## Adding a new API request safely

1. Decide the client: add to `src/api.js` only if it needs the same base URL and mock pattern; otherwise create a small module like `src/lib/askApi.js` with its own typed errors.
2. Put the base URL behind a `VITE_*` variable if it is new; document it in `.env.example` and the README.
3. Build the body in a pure function (like `buildAskBody`) and unit-test it.
4. Set a timeout and accept an `AbortSignal`; abort in the component's cleanup.
5. Map HTTP statuses to **friendly, plain-language** messages; never display raw `detail`/stack text; keep retryable vs non-retryable distinct.
6. Validate the response shape before using it; reject malformed JSON as a server error.
7. In the UI, follow [DEVELOPMENT_GUIDE](./DEVELOPMENT_GUIDE.md#accessible-loading-and-error-states) (polite status for loading, `role="alert"` for errors, keep user input after errors).
8. If it should work in mock mode, add a `USE_MOCK` branch next to existing ones; otherwise document that it bypasses `USE_MOCK`.
9. Add fetch-mocked tests (see [TESTING_AND_DEBUGGING](./TESTING_AND_DEBUGGING.md)).
10. Update this document with method, path, body, response fields and unknowns.

## Unverified or missing contracts

- Exact `/video/process` response beyond the fields listed; error body shapes.
- `/video/intervention/explain` response beyond the documented four fields; whether `explanation`/`keyInsight`/`focusRegion`/`structured` will ever be sent (the code has passthrough for them).
- A real search endpoint (`GET /video/search?q=` is only a TODO comment).
- `/api/jobs/{jobId}` is defined but unused; its real availability is **[Unknown]**.
- `POST /video/quiz`: implemented in the backend repository but never called against a live backend or model from here; see [QUIZ_CONTRACT](./QUIZ_CONTRACT.md). Its real latency, schema adherence and error bodies are unverified.
- `requirements.txt` still lists `POST /api/tts` and `GET /api/explanation/:id` and a Cloudflare tunnel URL; none of these appear in `src/api.js` — treat that section as stale.
