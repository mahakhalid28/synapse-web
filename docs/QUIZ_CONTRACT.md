# Accessible Quiz & Practice: Implementation Contract

> **Status (updated 2026-10-20): the backend, the front-end data layer and the quiz screen are built; the screen is not wired into the app, and nothing has run against a real model.**
>
> - **Backend (Stages 1 to 2, in the backend repository):** `POST /video/quiz`, screening and the quiz-only provider exist, tested with fake providers only. The endpoint answers 404 when the flag is off. An explicit `QUIZ_ENABLED` decides (exactly `1` or `true` is on); unset, it is on in development and off when `SYNAPSE_ENV=production` (decision 2026-10-20, section 12).
> - **Front-end data layer (Stage 3):** `src/lib/quizSchema.js`, `quizScoring.js`, `quizStore.js`, `quizAutosave.js`, `quizApi.js` and `displayPrefs.js` exist and are tested. **Nothing imports them**: there is no quiz screen, no `App.jsx` route, no `VITE_QUIZ_ENABLED` flag and no button in `Explanation.jsx`. The text of this document below still reads as a plan wherever it says **Proposed**; that label now means "not yet used by any screen or run with a real model".
> - **Quiz screen (Stage 4):** `src/components/QuizScreen.jsx` (with `QuizSetup`, `QuizQuestion`, `QuizReview`, `QuizResults`, `QuizDisplayControls`), the `src/hooks/useQuizSession.js` hook and `src/lib/quizText.js` exist and are tested.
> - **Integration (Stage 5):** `App.jsx` has a `"quiz"` screen, the return path (`lectureSeek.js`), and a **Practice this lecture** button in the lecture screen's action row (an optional `onStartPractice` prop on `Explanation.jsx`, approved by its owner). Everything is behind the front-end flag `VITE_QUIZ_ENABLED` (`quizFlag.js`): **off unless exactly `1` or `true`, and not set anywhere in this repository**, so by default nothing changes for a user. The only change to `Explanation.jsx` is that prop and one button; the earlier temporary bottom bar was removed.
> - **Not done and not approved:** human checks (NVDA, a person at 200% zoom), turning on either flag, and any evaluation that calls a model. **No model call or spending has been made or authorized.**
>
> Stage 0 text follows. Where a later stage's detail differs from it, the section says so.
>
> **This document authorizes no model calls, no evaluation runs that need model inference, no API spend and no quota use.**

Last updated: 2026-10-19. Written for the Synapse team: front end, backend, and the owner of `src/components/Explanation.jsx`.

## Labels used in this document

| Label | Meaning |
|---|---|
| **Confirmed** | Read in the code, measured, or run locally. The source is named. |
| **Proposed** | An agreed design direction or decision. **Not** implemented, not tested. |
| **Unverified** | An assumption or estimate that has not been checked. |

Other documents in `docs/` use **[Verified]**, **[Inferred]** and **[Unknown]**. Roughly: Confirmed is Verified, and Unverified covers Inferred and Unknown. The labels for test evidence (AUTOMATED, SCRIPTED-REAL, HUMAN, NOT TESTED) are defined in [VOICE_NOTES_VALIDATION](./VOICE_NOTES_VALIDATION.md) and are used here only for the human checks in [section 10](#10-acceptance-checks).

## Contents

1. [Goal and approved scope](#1-goal-and-approved-scope)
2. [What exists today](#2-what-exists-today)
3. [Overview and planned layout](#3-overview-and-planned-layout)
4. [Backend API contract](#4-backend-api-contract)
5. [Evidence, timestamps and validation](#5-evidence-timestamps-and-validation)
6. [Scoring](#6-scoring)
7. [Practice and Assessment](#7-practice-and-assessment)
8. [Local storage: synapse_quiz](#8-local-storage-synapse_quiz)
9. [Accessibility behaviour](#9-accessibility-behaviour)
10. [Acceptance checks](#10-acceptance-checks)
11. [Release gate and evaluation](#11-release-gate-and-evaluation)
12. [Feature flags](#12-feature-flags)
13. [Lecture screen integration](#13-lecture-screen-integration)
14. [Staged plan](#14-staged-plan)
15. [Risks](#15-risks)
16. [Open ambiguities and unverified items](#16-open-ambiguities-and-unverified-items)

---

## 1. Goal and approved scope

**Goal (Proposed).** Let blind and low-vision STEM students practise a lecture on their own, using a keyboard and a screen reader. The questions must be tied to what the lecture actually says, and every unsupported or weak question must be dropped rather than shown.

**Approved decisions (the Stage 0 task, recorded here).**

| # | Decision |
|---|---|
| 1 | First release: multiple-choice (MCQ) and true/false questions only. Short-answer questions are deferred. |
| 2 | Practice mode: up to **two hints** per question. Assessment mode: no hints; feedback only after submission. |
| 3 | Quiz-specific text-size and high-contrast controls for the first release. Sharing display preferences with the lecture screen is later work. |
| 4 | The human-reviewed quality thresholds in [section 11](#11-release-gate-and-evaluation) are retained. Evaluation results are reported by subject. The feature stays disabled if the gate fails. |
| 5 | No model calls, evaluation runs that need model inference, API spend or quota use are authorized. |
| 6 | The owner of `Explanation.jsx` has **not** approved the integration change. The entry point is documented here and is **not** implemented. |
| 7 | Default requested question count is **6**, configurable from 5 to 10. Fewer than **3** usable questions gives an `insufficient_material` result, never padded or weak questions. |
| 8 | Excluded from the first release: visual-dependent questions, LLM grading, timers, quiz audio or TTS, short-answer questions. |
| 9 | The shared and pinned provider, retrieval, transcript and other protected files stay untouched. |

**First release versus later.**

| In the first release (Proposed) | Not in the first release |
|---|---|
| MCQ and true/false, auto-scored | Short-answer questions and self-marking |
| Practice (hints, per-question feedback) and Assessment (feedback after submit) | Visual-dependent questions; any use of visual (VLM) moment evidence |
| Questions based on spoken lecture content | LLM grading of any kind |
| Local attempts with autosave and resume | Timers |
| Evidence times and "Check in the lecture" | Quiz audio, Synapse TTS, sounds |
| Quiz-owned text-size and high-contrast controls | Display preferences shared with the lecture screen |
| | History screen, reopening set-aside attempts, retaking the same set, pruning |
| | A second "blind answerer" verification model pass |

"Assessment" means **self-assessment**. It is not secure or proctored testing: the answer key is held on the learner's computer. The interface should say so.

---

## 2. What exists today

All items are **Confirmed** unless marked otherwise.

| Fact | Source |
|---|---|
| *(2026-10-19, before Stage 1)* No quiz code, endpoint, screen, store or feature flag existed. Since then: backend endpoint and front-end data layer were added (see the status note at the top); there is still no screen and no `VITE_QUIZ_ENABLED`. | Search of both repositories, 2026-10-19; Stages 1 to 3 |
| Navigation is one `screen` string. A new screen needs `App.jsx`. On every screen change an effect focuses the first `main h1`. | `src/App.jsx`, [ACCESSIBILITY](./ACCESSIBILITY.md#focus-on-navigation) |
| Voice Notes added a screen and a route that opens a lecture **cued and paused** at a time (`handleOpenNote` plus the `startSeconds` prop). | `src/App.jsx`, `src/components/Explanation.jsx` |
| The lecture screen's secondary action row holds Bookmark, Export PDF and Export audio. | `src/components/Explanation.jsx` ("Secondary actions" block) |
| The lecture screen's `mode` prop is the **depth mode** of the explanation, so the quiz must use a different name (`quizMode`). | `src/components/Explanation.jsx`, `src/App.jsx` |
| Leaving the lecture screen destroys the YouTube player and stops explanation audio (effect cleanups). | `src/components/Explanation.jsx` |
| TTS is never auto-played, except `autoPlay` when opened from the Library "Play audio". | [ACCESSIBILITY](./ACCESSIBILITY.md#avoiding-duplicate-speech) |
| The front end never receives transcripts, only a short `transcript_context` snippet per moment. | `src/api.js` |
| Text size and high contrast exist only on the lecture screen: `textScale` (default 1, clamped 0.85 to 1.6 in 0.15 steps) and `highContrast` (white background, black text, 2 px black border). They are local state and are not saved. | `src/components/Explanation.jsx` |
| The Ask client is the template for a new API client: its own base URL (`VITE_API_BASE_URL`, default `http://127.0.0.1:8000`), 90 s timeout, `AbortSignal`, typed errors, friendly messages, strict response validation. Retryable kinds: `busy`, `unavailable`, `network`. | `src/lib/askApi.js` |
| IndexedDB pattern: injectable factory, atomic transactions, typed errors, `add()`-only writes. Test double: `src/test/fakeIndexedDb.js`. Component tests have no `jest-dom`; use `src/test/domMatchers.js`. | `src/lib/notesStore.js`, `src/test/` |
| The front-end suite last ran 440 tests, all passing (2026-10-19). | `npm test` |
| Backend: transcripts come from the `transcripts` table or `data/<video_id>/transcript.json`. Caption `end` times overlap the next start (the loader caps them). A failed transcription is a valid file with no entries. | `qa/transcript.py` |
| Backend: a visual (VLM) snapshot is classified `valid`, `failed`, `invalid` or `missing`. An explanation is used only when the snapshot is `valid`. In sample data a failed snapshot was followed by a 362-word "explanation" of graphs the model never saw. | `qa/moment.py` |
| Backend: Ask labels evidence passages, lets the model cite passage ids, and maps ids to times in the app. The model is told never to state timestamps. Answers are plain text with math in words. An "answered" response must carry at least one source. | `qa/service.py`, `api/schemas.py` |
| Backend: the Ask endpoint is a plain `def`, protected by `enforce_allowed_origin`, with sanitised error messages, and logs counts only. | `api/routers/video.py`, `api/security.py` |
| Backend tests use `FakeProvider`, so tests need no model. | `tests/qa/helpers.py` |
| Provider interface: `GenerationSettings` has only `temperature`, `max_output_tokens`, `system_instruction`. There is no structured-output field. Defaults: model `gemini-3.5-flash-lite`, 60 s per-request timeout. | `llm_interface/providers.py`, `gemini_provider.py` |
| The installed SDK (google-genai 2.29.0) supports `response_mime_type`, `response_schema` and `response_json_schema` in its request configuration (checked by introspection only; no request was made). | local introspection, 2026-10-19 |
| **Pinned files:** `llm_interface/__init__.py`, `gemini_provider.py`, `ollama_client.py`, `providers.py` are hash-pinned by the archival experiment configs `config_b.json`, `config_pf.json` and `config_p1.json`. `qa/retrieval.py`, `qa/transcript.py` and `qa/__init__.py` are hash-pinned by the frozen retrieval benchmark. Editing any of them breaks archival checks. | `experiments/*/config_*.json`, `qa/README.md` |
| A teammate owns the explanation and intervention code. | project notes |

---

## 3. Overview and planned layout

**Planned user flow (Proposed).**

1. On the lecture screen the learner chooses **Practice this lecture** (see [section 13](#13-lecture-screen-integration)).
2. A setup step: choose Practice or Assessment, and 5 to 10 questions (default 6). If an unfinished attempt exists for this lecture: **Continue** or **Start new set**.
3. Generation: a status message, a Cancel button, and Retry on failure.
4. The question loop, with a question list.
5. A review step listing unanswered and flagged questions, then Submit (Assessment) or Finish (Practice).
6. Results: score, concepts to revisit, explanations, and "Check this in the lecture at m:ss", which reopens the lecture cued and paused.

**Why a separate screen (Proposed).** `Explanation.jsx` is large and teammate-owned, and leaving it removes any lecture audio (section 2). A separate screen also gets its own heading, focus order and keyboard map. It follows the route and layout of the Voice Notes screen.

**Planned files. None of these exist yet.**

| Area | Planned file | Role |
|---|---|---|
| Backend | `quiz/` package (schemas, passages, validators, prompt, structured provider, service) | Generation and screening |
| Backend | `api/routers/quiz.py`, plus one `include_router` line in `api/main.py` | `POST /video/quiz` |
| Front end | `src/lib/quizSchema.js`, `quizScoring.js`, `quizStore.js`, `quizApi.js`, `displayPrefs.js` | Validation, scoring, IndexedDB, client, display values |
| Front end | `src/hooks/useQuizAttempt.js` | Attempt state and autosave queue |
| Front end | `src/components/QuizScreen.jsx` and small parts (setup, question, navigator, review, results) | The screen |
| Existing file | `src/App.jsx` | New `"quiz"` screen, entry callback |
| Existing file | `src/components/Explanation.jsx` | One optional prop and one button. **Teammate sign-off was given; done after Stage 5.** |

---

## 4. Backend API contract

Short form: [API_AND_BACKEND_INTEGRATION](./API_AND_BACKEND_INTEGRATION.md#quiz-generation-post-videoquiz-proposed). Everything in this section is **Proposed**.

### 4.1 Request

`POST /video/quiz`, `Content-Type: application/json`, protected by `enforce_allowed_origin`. A plain `def`, like Ask.

| Field | Type | Required | Rule |
|---|---|---|---|
| `video_id` | string | yes | `^[A-Za-z0-9_-]{11}$` |
| `question_count` | integer | no | 5 to 10, default **6** |

Unknown fields are rejected (422). There is no `types` or `include_visual` field in the first release.

### 4.2 Response (HTTP 200)

```json
{
  "contract_version": 1,
  "quiz_id": "3f2b8c1e-5d4a-4e7b-9a10-2c6d8e9f0a1b",
  "video_id": "5ugDJhmmkFM",
  "generated_at": "2026-01-01T12:00:00Z",
  "prompt_version": "quiz-v1",
  "model": "model-name",
  "requested_count": 6,
  "returned_count": 5,
  "status": "partial",
  "reason": null,
  "notice": "Only 5 of the 6 questions you asked for could be made and checked from this lecture.",
  "omitted": [ { "reason": "no_evidence", "count": 1 } ],
  "questions": [ "..." ]
}
```

**Status invariants** (a server-side validator, in the style of `AskResponse`; the client checks them again):

| `status` | Rule |
|---|---|
| `complete` | `returned_count == requested_count`, and `questions` has that many items. `reason` and `notice` are null. |
| `partial` | `3 <= returned_count < requested_count`. `notice` is required. |
| `insufficient_material` | `returned_count < 3`, `questions` is empty, `reason` and `notice` are required. `reason` is one of `no_transcript`, `too_short`, `validation_failed`. |

Always: `returned_count == len(questions)`; `contract_version == 1`.

### 4.3 Question object (first release)

| Field | Rule |
|---|---|
| `id` | `"q1"` to `"qN"` |
| `type` | `"mcq"` or `"tf"` |
| `prompt` | 1 to 400 characters, plain text, math written in words |
| `choices` | MCQ: 3 or 4 items `{ id: "a".."d", text 1..200 }`. True/false: exactly `{ id: "true", text: "True" }` and `{ id: "false", text: "False" }`. |
| `correct_choice_id` | One of the choice ids |
| `explanation` | 1 to 600 characters |
| `hints` | 0 to 2 items, 1 to 200 characters each (Practice only) |
| `concept` | `{ id: slug "^[a-z0-9-]{1,40}$", label: 1..60 }` |
| `evidence` | 1 to 3 items `{ kind: "transcript", start_seconds, end_seconds, quote: up to 240 }` |
| `grounding` | Always `"screened"`. It is never `"verified"` (section 5.3). |

`contract_version: 1` reserves other values for later (`type: "short"`, `evidence.kind: "moment"` with `intervention_id`). The server never produces them in the first release and the client **rejects** them.

### 4.4 Outcomes before any model call

| State | Result |
|---|---|
| `QUIZ_ENABLED` off ([section 12](#12-feature-flags)) | 404 `"Quiz is not available."` |
| Invalid body | 422 |
| Origin not allowed | 403 `"Origin not allowed"` |
| No database row and no transcript file for the video | 404 `"Video not found"` |
| Transcript exists but has no usable segments | 200 `insufficient_material`, `reason: "no_transcript"` |
| Transcript under 300 words (provisional) | 200 `insufficient_material`, `reason: "too_short"` |
| Another generation for this video is running | 429 (busy). An in-memory per-video lock prevents accidental repeat spend. |

### 4.5 Model phase

Rules: at most **2 model calls** per request; **no automatic retry of provider errors**; thresholds are **never relaxed** to reach the requested count. Let A be the number of questions accepted by the screening rules in section 5.

| Call 1 | Next | Result |
|---|---|---|
| Provider error | stop | HTTP error (table 4.6) |
| Unusable output (not JSON, schema-invalid, or truncated) | call 2, same request | see call 2 |
| Usable, A is at least the requested count | none | `complete` |
| Usable, A below the requested count | call 2, a top-up for the shortfall plus 2 (excluding concepts already accepted) | see call 2 |

| After call 2 | Result |
|---|---|
| A at least the requested count | `complete` (extra questions dropped, spread across the lecture kept) |
| A from 3 up to below the requested count | `partial` with the notice |
| A below 3 and both calls were usable | 200 `insufficient_material`, `reason: "validation_failed"` |
| A below 3 and the last call failed | HTTP error: its provider status, or 502 if the output was unusable twice |
| Call 2 failed but A is 3 or more | `partial`. A failed top-up never discards good questions. |

Call 1 asks for the requested count plus 2 candidates, capped at 12 (to absorb rejections). An overall time limit applies across both calls (provisional 100 s): past it, return `partial` if A is 3 or more, otherwise 504. The second call is not started if less than 45 s of that budget remains (provisional).

### 4.6 HTTP errors and the client's messages

The server returns `{"detail": "..."}`. The proposed client never displays raw `detail`.

| HTTP | Client kind | Message shown | Retry offered |
|---|---|---|---|
| 429 | `busy` | The AI service is busy right now. Please try again in a minute. | yes |
| 503, 504, client timeout | `unavailable` | The AI service didn't respond. Please try again. | yes |
| 502 (unusable output after two attempts) | `unusable` | The AI service returned something we couldn't use. Please try again. | yes |
| 500 (not configured), other | `server` | Something went wrong on our side. Please try again later. | no |
| 404 with `detail` `"Video not found"` | `videoNotFound` | This video isn't available for practice questions yet. | no |
| 404 with `detail` `"Quiz is not available."` | `featureOff` | The entry is hidden; no message needed. | no |
| 422 | `invalid` | Please check the number of questions (5 to 10). | no |
| 403 | `forbidden` | The Synapse server didn't accept this request. | no |
| Network failure | `network` | Can't reach the Synapse server. Is it running? | yes |
| Body fails client validation | `unusable` | (as `unusable` above); nothing is saved | yes |

Messages for 200 `insufficient_material` (no error, nothing saved):

| `reason` | Message |
|---|---|
| `no_transcript` | This lecture doesn't have a usable transcript yet, so practice questions can't be made. |
| `too_short` | This lecture is too short to make reliable practice questions. |
| `validation_failed` | Questions were made, but too few passed our checks. Please try again. |

**Retry behaviour.** The client never retries automatically. Each Retry is a new request and a new model call. The server never retries a provider error; its only extra call is the single regeneration or top-up inside one request. The client timeout is 120 s (provisional), longer than the server's overall limit.

**Logging.** Counts and rejection reasons only. Never question, choice or hint text (the same rule as Ask).

**Unverified.** Whether the model reliably returns schema-valid output; real latency; real rejection rates. The first real call (Stage 7, not authorized) will show them.

---

## 5. Evidence, timestamps and validation

Everything here is **Proposed**.

### 5.1 Evidence ids and timestamps

- The server splits the normalised transcript (using the existing loader, whose segment ends are already capped at the next start) into windows of about 300 to 400 tokens, labelled `S1`, `S2`, ….
- The model returns `evidence_ids` such as `["S3"]`. **It never returns timestamps.** The server maps each id to seconds from the segments' own times, merges contiguous ranges, rounds to 2 decimals and sorts by start. Each range must satisfy `0 <= start <= end <= lecture end`, all finite.
- The `quote` is **chosen by the server**, not written by the model: the best-overlapping sentence of the cited passage, at most 240 characters.
- Reserved for a later, separately approved change: a `moment` evidence kind (`M<k>`), allowed only when a moment's snapshot is `valid`, with start equal to end equal to the moment's timestamp and its `intervention_id`. It is not produced in the first release, and a quiz containing it is rejected by the client.

### 5.2 Screening rules (reject-only)

A question is rejected if **any** of these fails:

1. The structure is invalid: wrong types, lengths or counts.
2. There are no evidence ids, or any id is unknown.
3. The model wrote a time (any `m:ss` pattern) in a prompt, choice, explanation or hint.
4. The text contains markdown, HTML, LaTeX markers (`$`, `\`, `^`, `_{`) or emoji. Math must be in words.
5. **MCQ:** 3 or 4 choices; exactly one correct; all distinct after case and punctuation folding; no "all of the above", "none of the above" or "both a and b". The server shuffles choices with a seed derived from `quiz_id`, then assigns the ids.
6. **True/false:** a single clear statement and a boolean key.
7. **Supporting-sentence test:** one sentence within the cited passages must overlap both the question and the correct answer above a threshold. Overlap spread across several passages does not count.
8. **Answer margin (MCQ):** the key's overlap with the evidence must beat every distractor's by a margin. If a distractor is as well supported as the key, the question is ambiguous.
9. Numbers of 10 or more, and decimals, must appear verbatim in the evidence. (Small integers 1 to 9 cannot be checked.)
10. The model must set `relies_on_exact_figure`. A flagged question needs at least 2 distinct evidence ids.
11. **Hints** (Practice, up to two): plain text, no times, and a hint **must not disclose the correct answer**. A hint is rejected if it contains the correct choice's text, or names the correct choice by letter or by "true"/"false", or otherwise states which option is right. Rejection of a hint drops that hint; if hints are then fewer than the model gave, fewer are shown.
12. **Visual dependence:** the model must set `depends_on_visual: false`, and a fixed phrase list rejects prompts, choices and hints that refer to something shown but not said ("as shown", "this graph", "this diagram", "this figure", "this chart", "on the slide", "on the screen", "pictured", "as you can see", and similar).
13. No near-duplicates (token overlap of 0.7 or more), and no passage backs more than `ceil(N/3)` questions.

Thresholds are **provisional** and are configured conservatively. They will reject some good questions; that is intended ("fewer supported questions over weak ones").

### 5.3 What the screen is not

- The automatic checks are **preliminary screening, not proof**. They can only reject. A question that passes is labelled `"screened"`, never `"verified"`, and the interface must not use the word "verified".
- Overlap measures shared words, not truth. A question whose key words appear in the lecture can still be wrong or misleading.
- **Automatic captions** can be wrong, for example "minus" heard for "plus". A faithfully copied caption error passes every rule. The existing lexical grounding check was never calibrated or evaluated, and it cannot catch wrong small numbers. Do not treat any automated check as a safety net.
- The only guard against a wrong key is the human-reviewed release gate in [section 11](#11-release-gate-and-evaluation), plus the learner's own "Check in the lecture" link.
- The interface shows this fixed notice with every quiz: *"These questions were made by AI from the lecture's automatic captions. They were checked only for basic consistency and may contain mistakes. Use 'Check in the lecture' to confirm."*

### 5.4 Structured output and the protected files

- **Confirmed:** the shared provider is hash-pinned (section 2), so it cannot be extended.
- **Proposed:** the quiz package defines `QuizSettings`, a subclass of `GenerationSettings` with a `response_json_schema` field, and `QuizGeminiProvider`, a subclass of `GeminiProvider` that overrides `_build_config` to add `response_mime_type="application/json"` and the schema. Everything else (key, timeout, error mapping, usage reporting) is inherited. No pinned file changes. A test pins the assumption about `_build_config` using the existing `tests/llm_interface/fake_genai.py`.
- If the SDK rejects the schema, the service falls back to a plain-text reply parsed as JSON.
- **Parsing is strict in every case:** `json.loads` of the reply with surrounding whitespace removed, no code-fence stripping, then schema validation, then the screening rules. A truncated reply counts as unusable.
- **Unverified:** that the configured model honours a JSON schema in practice.

---

## 6. Scoring

**Proposed.** Only auto-scored question types exist in the first release.

| Item | Rule |
|---|---|
| Correct | 1 point if the selected choice id equals `correct_choice_id`, else 0. |
| Unanswered | Counted as unanswered, not as wrong. |
| Practice | The score uses the **first checked answer** for each question. Retries and hints are recorded but do not change it. |
| Assessment | The final selection at submit. |
| Display | "N of M correct, K unanswered." A percentage may be shown beside it, never alone. |
| Source of truth | Always recomputed from the saved responses when displayed. A stored result is only a cache. |
| Concepts to revisit | Every concept that has a wrong or unanswered question, with its evidence times, ordered by lecture time. |

Short-answer scoring (self-marking) is deferred; its rules will be written when that increment is approved.

---

## 7. Practice and Assessment

**Proposed.**

| | Practice | Assessment (self-assessment) |
|---|---|---|
| Feedback | After "Check answer": correct or not, explanation, evidence link | None until submit |
| Hints | Up to **two** per question, revealed one at a time, usage recorded | **None** |
| After a wrong answer | "Try again" or "Show answer" | Answers can be changed until submit |
| Lecture access | "Check in the lecture" at any time | Allowed, not blocked |
| Time limit | None | None |
| Saved | After every change (selection, check, hint, flag, move) | After every change, plus the final record on submit |
| Score | Informational, based on first checked answers | Recorded as the attempt result |

Hints do not affect the score. Each hint passes the screening rules in section 5.2, including the rule that a hint never discloses the correct answer. The hint text is spoken once through a polite status message (section 9), and shown on the page.

---

## 8. Local storage: synapse_quiz

Sections 8.1 to 8.5 are **implemented as the data layer** in `src/lib/quizStore.js` (Stage 3) and tested against the project's in-memory IndexedDB stand-in and a real-Electron smoke test (8.6); no screen uses it yet. Stage 3 made the refinements marked **Stage 3** below.

### 8.1 Database

IndexedDB database `synapse_quiz`, version 1, separate from `synapse_voice_notes`. Three stores, **all keyed by `id`**, no indexes (the test double does not model them; filter in JavaScript).

| Store | Key | Content |
|---|---|---|
| `quizzes` | `id` = server `quiz_id` | `{ id, schemaVersion: 1, savedAt, quiz }`, where `quiz` is the validated response. Immutable, written with `add()` only. |
| `attempts` | `id` = client UUID | `{ id, schemaVersion: 1, quizId, videoId, quizMode, status, rev, startedAt, updatedAt, submittedAt, abandonedAt, currentIndex, responses, result }` (`submittedAt`, `abandonedAt` and `result` are `null` until they apply) |
| `active` | `id` = `videoId` | `{ id, schemaVersion: 1, attemptId, rev }`. The single pointer to the in-progress attempt for a video. |

`quizMode` is `"practice"` or `"assessment"`. `status` is `in_progress`, `submitted` or `abandoned`. Invariant: at most **one** `in_progress` attempt per video, and it is the one `active` names.

**Stage 3: response shape.** Each response is `{ choiceId, firstCheckedChoiceId, lastCheckedChoiceId, hintsUsed, flagged }`, not the earlier `{ choiceId, checked, hintsUsed, flagged, firstTryCorrect }`. The raw facts are stored and the rest is derived, so a stored boolean can never disagree with what it summarises: `checked` is `firstCheckedChoiceId !== null`; `firstTryCorrect` is `firstCheckedChoiceId === correct_choice_id`; feedback is showing exactly when `lastCheckedChoiceId === choiceId`, which also lets "resume" restore it. The store enforces: Assessment has no checks and no hints; a first check never changes; hints used never decrease and never exceed the question's own hints; a Practice first check always comes with a last check.

**Stage 3: the cached result.** A submitted attempt stores `result: { correct, incorrect, unanswered, total, scoredAt }` for convenience only. Every score shown is recomputed from the responses (`src/lib/quizScoring.js`); a tampered cache is ignored.

### 8.2 Atomic writes and conflicts

Every write that changes more than one record is **one readwrite transaction**:

- `startAttempt`: read `active`, compare it with the expected attempt id (never a counter, so a recycled number can not fool it), mark the previous attempt `abandoned` (keeping its answers), add the quiz, add the attempt, move the pointer. A previous attempt that is unreadable or from a newer version is left exactly as it is; only the pointer moves.
- `saveProgress` (was `updateAttempt`): read the attempt, compare `rev`, write `rev + 1`.
- `submitAttempt` (was `finishAttempt`) and `abandonAttempt`: compare `rev`, set `submitted` or `abandoned`, remove the pointer only if it still names this attempt. A submit also stores the final answers and the cached result.
- There is **no delete API**: set-aside attempts are kept (8.4).

On any mismatch the transaction is aborted, so no store keeps any part of it. On a conflict the screen stops autosaving, reloads the latest saved version, and announces once (`role="alert"`): "This practice was changed in another window. Showing the latest saved version." It never overwrites. Because the writes are atomic, the first release does **not** need to be limited to one window. (**Confirmed:** `electron.cjs` creates one window and no single-instance lock. **Unverified:** what a second app instance on the same profile does.)

### 8.3 Autosave and resume

- **Autosave:** a serial write queue that keeps only the newest pending state. It writes after every change. It does not announce each save, because writes during page unload are not guaranteed. A failed write keeps the state in memory, shows one `role="alert"` ("Progress could not be saved"), and tries again on the next change.
- **Resume:** opening Practice for a video with an in-progress attempt offers **Continue** ("3 of 6 answered") or **Start new set**. Continue restores the position, answers, flags, hints used, and checked state.
- **Persistent storage:** a best-effort `navigator.storage.persist()` request, as Voice Notes does. The Electron permission policy already allows it for the app page.

### 8.4 Starting a new set, and preserving the old one

- "Start new set" asks inline first, with the safe choice focused: "Your unfinished practice (3 of 6 answered) will be kept and set aside. Start a new set?"
- **Nothing in storage changes until the new questions have arrived and validated.** If generation fails, or returns `insufficient_material`, the old attempt stays active and untouched.
- On success, one `startAttempt` transaction sets the old attempt aside as `abandoned` (never deleted) and creates the new one.
- If saving the new set fails (storage full, or a conflict), the old attempt stays active and the new questions are not used. The message offers "Try saving again" or "Discard the new set". There is **no unsaved mode**.
- Set-aside attempts are preserved indefinitely; there is no automatic pruning. They cannot be reopened in the first release (the data supports it later). The setup screen says how many earlier attempts are saved.
- An active attempt that fails validation is left untouched and is not offered for resume; the learner is told. Starting new then moves the pointer without modifying the unreadable record.

### 8.5 Validation on read

A record is skipped, counted, and never crashes the screen if: `schemaVersion` is unknown (a higher version is never overwritten); an enum or bound is wrong; a response names a question that is not in the quiz, or a choice that does not belong to it; or the quiz or attempt is missing. Scores are recomputed rather than trusted.

### 8.6 Verification so far

**Confirmed, 2026-10-20 (Stage 3).**

- **Unit tests** (`src/lib/quizStore.test.js` and neighbours) run the store against the project's in-memory IndexedDB stand-in: lifecycle, autosave and resume across a closed and reopened store, concurrent and conflicting writes, rollback when any one write of a multi-store transaction fails, duplicate ids, corrupt and newer-version records, invalid API data and unsupported question types.
- **Real-Electron smoke test** (`spike/quiz-store-smoke-main.cjs`, run with `node spike/quiz-store-smoke-main.cjs`): the SAME store code on real Chromium IndexedDB (Electron 41, a `file://` page like the packaged app, a throwaway profile, no network, no backend, no model). Two launches, so there is a real app restart between them. **18 of 18 checks passed**: three stores keyed by `id`; atomic start of quiz + attempt + pointer; an immutable quiz can not be replaced; exactly one of 20 concurrent autosaves wins; a failed replacement leaves the old attempt active and unchanged; a stale "start new" changes nothing; two connections starting the first quiz together leave one attempt; "start new" keeps the old attempt's answers; submit racing "start new" leaves exactly one winner and a valid pointer; a tampered cached score is ignored; a corrupt record and a newer-version record are reported, skipped and never modified; invalid input writes nothing; and after the restart the in-progress attempt resumes with exactly the saved position, answers, hints and flags and can be saved to and submitted.
- **The earlier scratch experiment** (2026-10-19) agreed: the same ten scenarios gave identical results on the stand-in and on real IndexedDB.

**The test double was hardened in Stage 3 (Confirmed).** It used to key every record by `value.id` and ignore a store's `keyPath`, and to share nested objects between the caller and the "stored" data. It now reads the key from the store's `keyPath` (a record without it throws `DataError`), copies plain objects and arrays deeply in and out (Blobs stay by reference, as Voice Notes needs), and has its own regression tests (`src/test/fakeIndexedDb.test.js`). Every quiz store is still keyed by `id`.

**Unverified.**

- A crash or power loss in the middle of a transaction, durability, and running out of quota. Neither the stand-in nor the smoke test can show them; quota failures are only simulated.
- Several app processes on one profile (`electron.cjs` has no single-instance lock). IndexedDB serialises overlapping transactions inside one profile, which is what the compare-and-set relies on; separate profiles have separate databases.
- `navigator.storage.persist()` under the app's real permission policy (`electron/permissions.cjs`). The smoke test's window installs no policy, so its `persist() === true` says nothing about the app.
- Behaviour in the packaged build and in the dev server's `localhost` origin (separate databases, as for Voice Notes).

---

## 9. Accessibility behaviour

**Implemented in Stage 4 as the quiz screen (not wired into the app; the NVDA checks in section 10.1 are still PENDING, so the screen-reader behaviour below is designed to the rules, not yet confirmed by a person).** Project rules followed: `docs/FEATURE_INTEGRATION_GUIDE.md` (describe the screen-reader experience first; focus programmatically only after a user action; no global key interception; polite regions, one mechanism per event) and `docs/ACCESSIBILITY.md` (which already notes that moving focus to a heading *and* filling a live region may double-speak under NVDA).

### 9.1 Structure, focus and announcements

Each question is a `<fieldset>` with a `<legend>` and native radio buttons. A question list is a set of buttons whose names include the state ("Question 4, answered, flagged"), with `aria-current="step"` on the current one.

| Event | Focus | Spoken |
|---|---|---|
| Open from the lecture | App's existing effect focuses the screen's `h1` | The title as a level-1 heading |
| Start generating | Stays on Start (`aria-busy`, `aria-disabled`) | One polite status: "Creating your questions. This can take up to a minute." |
| Error | Stays on Start or Retry | `role="alert"`, plain language, with Retry |
| Questions ready | The question heading | The heading, with a partial notice attached by `aria-describedby`; no extra live message |
| Next, Previous, jump | The new question heading | The heading only |
| Select a choice | Unchanged | Native radio announcement only |
| Check answer (Practice) | The feedback heading ("Correct" or "Not quite") | The heading and the explanation as text; no live region |
| Hint (Practice) | Stays on the Hint button | One polite status with the hint text (also shown on the page) |
| Flag for review | Stays | Native `aria-pressed` |
| Submit with unanswered questions | The safe choice ("Go back") | Inline confirmation text |
| Results | The results heading | The summary as text |

**Stage 4 refinements to the table above.**

- A first-time visitor to setup sees one form: Practice or Assessment (radio group with the help text attached), the number of questions (a native select, 5 to 10), and **Create questions**. Pressing it again while a request is running does nothing; **Cancel** aborts it and announces "Cancelled".
- A saved attempt is offered first (**Continue** or **Start a new set**, which asks inline with **Keep my practice** focused). An unreadable one is explained and left alone.
- Practice: a wrong check shows "Not quite" with the explanation and evidence links (not only after "Show answer"); **Show answer** adds the correct answer. After a resume, feedback is shown again only if the selection still equals the last checked choice.
- Assessment shows no evidence links before submitting (the quote would reveal the answer); they appear in the results.
- The review's **Finish practice** asks first only when some questions have not been checked. **Submit answers** (Assessment) always asks.
- Saving: routine saves are **not** announced (a visible, non-live line says progress is saved). A failed save is a `role="alert"` with **Try saving again**; recovery is announced once ("Progress saved again.").
- Text size and high contrast are quiz-only (`displayPrefs.js`), applied by two CSS classes in `index.css` (`.quiz-root` scales everything in `em` from one variable; `.quiz-contrast` re-points the colour tokens for the quiz area). **High contrast does not restyle the sidebar**, which is outside the quiz area.

### 9.2 Keyboard

Everything works with Tab, Shift+Tab, Space, Enter and the arrow keys. No focus traps. No timers. **No global Alt shortcuts** in the first release, and the lecture screen's Alt shortcuts do nothing on this screen. (A possible Alt+Q to open Practice is a later, separate decision.)

### 9.3 Low vision, and display preferences

- **Interim decision (approved):** the quiz screen has its own **Text size** (A− and A+) and **High contrast** controls, with the same range (default 1, 0.85 to 1.6, steps of 0.15) and the same treatment (white background, black text, 2 px black border) as the lecture screen (section 2). The values live in a new `src/lib/displayPrefs.js` and are saved under guarded `localStorage` keys (proposed names `synapse_quiz_text_scale` and `synapse_quiz_high_contrast`).
- **Known inconsistency:** the lecture screen is not changed in the first release and its settings are not saved, so the two screens do not share state.
- **Future work (not approved yet):** move the lecture screen onto `displayPrefs.js` so both share one saved setting. That edits `Explanation.jsx` and needs its owner's sign-off.
- Also: the global theme tokens (Paper, Night, Sepia); reflow at 200% browser zoom with no horizontal scrolling; controls at least 44 px; correctness never shown by colour alone (words as well as symbols); reduced motion respected.

### 9.4 Competing audio

The quiz screen contains **no** `<audio>` or `<video>` element, no sounds, no chimes and no Synapse TTS. (**Confirmed:** Synapse TTS today is per-moment explanation audio from the backend, so quiz TTS would need a new backend path; it is excluded.) Entering the screen removes the lecture and its audio (section 2). "Check this in the lecture" reopens the lecture **cued and paused** (the `startSeconds` route), and the learner resumes on purpose. Live regions are polite, except error alerts.

---

## 10. Acceptance checks

**Status: PENDING. No person has run any of these.** They are the human checks required by the release gate (section 11). Record, for each run: the date, the Windows version, the NVDA version, whether the app ran in development or packaged, and the result. Do not guess any of these.

### 10.1 NVDA (Windows)

1. Open Practice from the lecture button: the title is read once as a level-1 heading.
2. Setup: mode and count controls read with their group names. "Start" gives one status message, not a repeating one.
3. Questions ready: "Question 1 of 6" as a heading; with a partial result the notice is read with it. Tab to the group: the question text is read with the group name, and each choice reads as "radio button, not checked, 1 of 4".
4. Arrowing radios in focus mode: one spoken change each. In browse mode, arrow reading does not change the selection.
5. Practice "Check answer": focus lands on "Correct" or "Not quite", then the explanation reads in order **once** (no double speech).
6. Hint: the hint is spoken once; focus stays on the Hint button.
7. Flag toggle: spoken as pressed or not pressed.
8. Question list: each button says answered, unanswered or flagged, and which is current.
9. Submit with unanswered questions: focus on "Go back", text read, "Submit anyway" works.
10. Results: the summary reads fully. "Check in the lecture at 3:21" names the question and time. Activating it opens the lecture **paused**, with no sound.
11. Failed generation: one "Error: …" alert; Retry works.
12. Close and reopen mid-quiz: "Continue (N of 6 answered)" with the right count; nothing is spoken about saving.
13. Over a full run, nothing else is spoken: no per-keystroke or timed speech, and no sounds.

### 10.2 Keyboard only (no screen reader), Paper and Night themes

1. Every control is reachable with Tab and Shift+Tab, with a visible focus ring.
2. No focus trap anywhere.
3. Radios work with arrows and Space; buttons with Enter and Space.
4. Focus order matches reading order.
5. After every action, focus lands where section 9.1 says.
6. The lecture's Alt shortcuts (Alt+P, L, N, B, R, M) do nothing on this screen.
7. Escape does nothing harmful.
8. A complete Practice run and a complete Assessment run are possible without a mouse.

### 10.3 200% zoom (window at least 1100 px wide)

**Unverified:** whether Ctrl+= zooms in this Electron app. Confirm it first.

1. At 200% there is no horizontal scrollbar in the main area.
2. No text is clipped or overlapping; long prompts and choices wrap.
3. Focus rings are fully visible and not clipped.
4. Every button stays at least 44 CSS px high and is fully visible.
5. Text size at 160% combined with browser zoom 200% still allows a full run.
6. High contrast on: all text is black on white, and correctness is shown with words as well as symbols.

Checks 1, 2 and 4 can also be scripted in real Electron (set the zoom factor to 2, then measure scroll width and control sizes). The human pass remains the gate.

**SCRIPTED-REAL evidence (2026-10-20), not a human pass.** `spike/quiz-layout-main.cjs` runs the real screen in Electron 41 against the project's own Vite dev server (only that server is reachable) in a 1100 px window. For six screens (setup, question, feedback, review, confirmation, results) in six configurations (normal; 200% zoom; 200% zoom + 160% text + the longest allowed text; high contrast at 160%; high contrast + 200% + 160%; the Night theme) it checked: no horizontal scroll and nothing wider than its column; every button, select and radio row at least 44 CSS px tall; text contrast at least 4.5:1 (3:1 for large text) and at least 7:1 in high contrast. **All 36 scenarios were clean** after two real problems it found were fixed (mode radio rows were 26 px tall; hint numbers were missing). At 200% the quiz column is about 328 px wide (the 200 px sidebar takes the rest), and long words wrap mid-word rather than overflow. A person must still confirm this with a screen magnifier or real zoom.

### 10.4 Automated criteria

Per stage, in [section 14](#14-staged-plan).

---

## 11. Release gate and evaluation

**Proposed. Not approved for execution. No model calls, evaluation runs that need model inference, spending or quota use are authorized.**

### 11.1 Release gate

The feature ships dark (section 12) and may be enabled only if **all** of these hold. Failing any one keeps it disabled.

| # | Criterion |
|---|---|
| a | On the pre-registered human review of 80 questions from the 20 confirmatory lectures: "answerable from the lecture **and** key correct" is at least 90% observed, with the 95% Wilson lower bound at least 80%. (An observed 90% on 80 questions has a lower bound of about 81%.) |
| b | Wrong-key or misleading items: at most 5%. **Any** item whose key is a false statement about the subject blocks release until the cause is fixed and a **new, unseen** sample is reviewed. |
| c | The cited time range contains the supporting statement for at least 90% of reviewed questions, and at least 85% of MCQs have exactly one defensible answer. |
| d | The checks in section 10 all pass, recorded by a person. |

Shortfall and drop rates are reported but are not gate criteria: fewer questions is an acceptable result.

### 11.2 Evaluation protocol (Proposed)

- **Development set:** 5 lectures, one per subject, with at most 2 prompt iterations. Not used for any claim.
- **Confirmatory set:** the other 20 lectures (4 per subject), run once with the prompt and thresholds frozen. No tuning on this set.
- **Human review:** 4 questions per confirmatory lecture, 80 in all (16 per subject), chosen by a rule fixed in advance. Rubric per question: answerable from the lecture; key correct; one defensible answer (MCQ); distractors wrong but plausible; cited range contains the support. An estimated 3 to 4 hours for one reviewer.
- **AI pre-screening,** if used, is labelled non-blind and diagnostic only.
- **Reporting by subject:** for Mathematics, Physics, Chemistry, Biology and Computer science, report each criterion with its counts (n about 16 per subject), alongside the pooled result. Per-subject intervals will be wide; they are descriptive. Whether a weak subject should block enabling is an open decision ([section 16](#16-open-ambiguities-and-unverified-items)).
- If the gate fails: iterate and re-test on a new sample. Never re-tune on the confirmatory set.
- **Not evaluated:** visual questions (excluded), learning outcomes, short answers (deferred), and real-world caption errors beyond the benchmark.

### 11.3 Data available (Confirmed, measured locally on 2026-10-19; counts only)

- The STEM25 benchmark has 25 lectures, 5 per subject (Mathematics, Physics, Chemistry, Biology, Computer science). Transcripts are about 1,200 to 7,500 estimated tokens (median about 2,850, total about 86,700); 12 exceed 3,000 tokens. It has 85 visual accessibility annotations covering all 25 lectures.
- None of the benchmark lectures has moment or visual-snapshot data. It can evaluate **spoken-content questions only**, which matches the first-release scope.
- Sixteen other lectures in the local `data/` folder have usable transcripts (about 1,100 to 4,100 tokens each) and up to 4 moments each, but no human gold.

### 11.4 Budget (Unverified estimate; not approved)

Assumes about 1,500 tokens of prompt overhead per call and about 2,000 output tokens per generation; thinking-token use is unknown.

| Step | Calls | Input tokens | Output tokens |
|---|---|---|---|
| Dry run of prompts and screening with a recorded reply | 0 | exact sizes measurable | none |
| Development set (up to 2 rounds of 5) | 10 | about 43k | about 20k |
| Confirmatory run (20 lectures) | 20 | about 103k | about 40k |
| Optional blind-answerer pass (20) | 20 | about 64k | about 12k |
| **Total** | **50** | **about 210k** | **about 72k** |
| With a 20% retry margin | **about 60** | **about 250k** | **about 90k** |

The model's price is not verified here, so no cost is stated. Quota limits and the earlier 503 errors should be checked first. For comparison, an Ask experiment stage that was declined earlier was about 139 calls.

### 11.5 Authorization

**No model calls, evaluation runs, spending or quota use are authorized by this document or by Stage 0.** Running the protocol needs a separate, explicit approval of the numbers above.

---

## 12. Feature flags

**Both flags exist in code. Default (decision 2026-10-20): explicit value decides; unset means on in development and off in production (details below).**

| Flag | Where | Default | Effect when off |
|---|---|---|---|
| `QUIZ_ENABLED` | Backend environment | off | `POST /video/quiz` returns 404 `"Quiz is not available."` |
| `VITE_QUIZ_ENABLED` | Front-end build or dev environment | off | `App` does not pass `onStartPractice` to the lecture screen, so no entry appears and the lecture screen renders exactly as today |

Parsing: an **explicit** value is on only when it is exactly `1` or `true`; anything else (including an empty value) is off.

**Decision (2026-10-20, project owner): development default.** When a flag is **not set**, it defaults to **on in development** and **off in production**. Front end: on under `npm run dev` / `npm run electron:dev` (Vite mode `development`), off in a production build, the packaged app and the test runner. Backend: on unless `SYNAPSE_ENV=production` (the backend has no other notion of development, so a deployment that must stay dark sets `SYNAPSE_ENV=production` or `QUIZ_ENABLED=0`). This relaxes the "ships dark" rule for development only, so that the feature can be tried while it is built. The release gate in section 11 still applies before any deployment or any use by students outside supervised testing.

---

## 13. Lecture screen integration

**Status: integrated, with the owner of `Explanation.jsx` having approved the change. Behind `VITE_QUIZ_ENABLED`: on by default in development, off in production builds.**

**What is built (Confirmed by tests, flag default: on in development, off in production and tests).**

- `App.jsx` keeps a `quizInfo` (video id and job id), fixed when the entry is pressed, and a `"quiz"` screen. The screen gets `onNavigate` (the sidebar), `onOpenLecture` and `onBack`. The window title is "Practice this lecture – Synapse" and the existing effect focuses the page heading.
- **Entry:** `App` passes `onStartPractice` to the lecture screen only when `VITE_QUIZ_ENABLED` is on and the lecture has a valid 11-character video id; without the prop the button does not exist. The button sits in the action row after Export audio, in the same quiet text-button style, and leaves through the lecture screen's `leaveScreen` like every other exit (so an unsaved voice-note draft is still protected). Pressing it only navigates; no request is made until the learner presses "Create questions". The action row is shown with a moment's details, so the button appears once a moment is selected.
- **Flow:** lecture -> "Practice this lecture" -> setup (resume or new) -> questions -> review -> submit -> results -> "Check in the lecture" -> the SAME video, cued at the evidence time, paused. **Back** returns to the same lecture, mode and moment with nothing cued.
- **Check in the lecture:** `handleOpenQuizLecture` ignores a request for any other video, and passes the time through `safeStartSeconds`: a finite number from 0 to 172 800 (48 hours, the bound Ask and Voice Notes use), floored to whole seconds; anything else (negative, NaN, Infinity, a string, null) becomes "no seek" and the lecture simply opens. The lecture screen's existing `startSeconds` route then calls `cueVideoById({ videoId, startSeconds })` (seconds, cued, not played), the route Voice Notes uses.
- **Verified:** with the real `App`, lecture screen and quiz screen and a fake YouTube player, "Check in the lecture at 1:40" gives `cueVideoById({ videoId, startSeconds: 100 })`, and `playVideo` and `seekTo` are never called, including after longer than the lecture's 300 ms pause watcher interval.
- **Unverified:** the real YouTube player. A time beyond the video's real length is clamped or rejected by YouTube (not tested here); the playhead position is not kept when leaving the lecture screen (its player is destroyed), so Back returns to the lecture's normal starting point.

**The change made in `Explanation.jsx` (approved):** one optional prop, `onStartPractice`, and one button, about 15 lines, no new state. Tests: the lecture screen's other tests pass unchanged.

- The quiz uses `quizMode`, never the lecture's `mode`.
- The quiz endpoint, like Ask, would call the real backend and bypass `USE_MOCK`. Mock lecture ids will report "not available". This must be stated in the interface and documentation.

---

## 14. Staged plan

**Status: not started. Each stage needs its own explicit approval. This document authorizes none of them.**

| Stage | Scope | Acceptance criteria |
|---|---|---|
| **0** | This contract, plus the endpoint section in `API_AND_BACKEND_INTEGRATION.md` | Documentation only. Contract matches the approved decisions; every statement is labelled; links and anchors resolve; nothing implies the feature exists; no other file changes. |
| **1** | Backend core, no model calls: `quiz/` schemas, passage builder and id-to-time mapping, screening rules, prompt, structured provider, service | Each rule in section 5.2 has an accepting and a rejecting test. Mapping matches a fixture exactly; model-written times are rejected. A test confirms the pinned files' hashes are unchanged. At most 2 calls. Logs contain no question text. Structured configuration checked with `fake_genai`. |
| **2** | `api/routers/quiz.py` and one `include_router` line in `api/main.py` | TestClient with `FakeProvider`: `complete`, `partial`, each `insufficient_material` reason; every error row of 4.4 to 4.6; the busy lock; count invariants. The existing backend suite still passes. |
| **3** | Front-end data layer: `quizSchema`, `quizScoring`, `quizStore`, `quizApi`, `displayPrefs`; harden the test double (needs approval) | Table-driven scoring tests for section 6. Store tests on the double: the ten scenarios of 8.6, autosave coalescing, corrupt records skipped, too-new version untouched. API tests: every status maps to the right kind and message; invalid bodies rejected; timeout; abort. |
| **4** | Quiz UI and attempt hook | Component tests per state with `jest-axe`; focus assertions for every row of 9.1; keyboard-only tests; a test that no media element is created and `play()` is never called; text-size and contrast classes applied. |
| **5** | Integration: the button and prop in `Explanation.jsx`, the `"quiz"` screen in `App.jsx`, the return path. **Needs the teammate's sign-off.** | Existing tests pass unchanged. Entry hidden when the flag is off. `Explanation.jsx` diff stays small. |
| **6** | Scripted run in real Electron against a scratch stand-in server for the endpoint (no model) | The quiz renders from the stand-in; autosave and resume survive an app restart on real IndexedDB; the ten store scenarios pass on real IndexedDB; the lecture opens paused; zoom measurements pass. |
| **7** | Human checks (section 10) and the quality evaluation (section 11) | Needs separate approval for any model calls. Release gate decides whether the flags may be turned on. |
| **8** | Documentation updates (shortcuts, accessibility, storage, screens, known issues, validation) | Documentation checks pass. |

---

## 15. Risks

- **Question quality** is the main risk, and screening cannot prove correctness (section 5.3).
- **Automatic captions** can be wrong, and a copied error passes every rule.
- **Model availability and cost:** an earlier Ask experiment stopped on a 503; latency and cost are unmeasured.
- **Structured output:** the model's adherence to a schema is unverified.
- **Teammate-owned code:** `Explanation.jsx` needs sign-off; the change must stay small.
- **Protected files:** editing any pinned file breaks archival checks.
- **Test double fidelity:** it ignores `keyPath` and cannot show crash or cross-process behaviour (section 8.6).
- **Human checks:** screen-reader behaviour is unconfirmed until someone runs section 10.
- **Self-assessment:** the answer key sits on the learner's computer; it must not be presented as secure testing.
- **Mock mode:** the quiz bypasses `USE_MOCK`, so UI work needs the scratch stand-in server.

---

## 16. Open ambiguities and unverified items

**Open decisions**

1. **Per-subject gating:** the gate (section 11.1) is on the pooled sample, and per-subject results are reported. Should a subject that falls below a threshold block enabling, or only be disclosed? *Proposed default:* disclose prominently and require explicit approval.
2. **Moment evidence:** the `moment` kind is reserved in `contract_version: 1` but rejected by the client in the first release. Confirm this reading of "visual-dependent questions excluded".
3. **Question mix:** no minimum of true/false versus MCQ is enforced; the mix is only reported. Confirm.
4. **Hints:** 0 to 2 per question (not a required two). Confirm.
5. **Where "Start new set" lives:** the setup screen only, not mid-question. Confirm.
6. **404 disambiguation:** by `detail` text, as Ask does, rather than separate status codes. Confirm.
7. **Quote selection:** the server's best-overlap sentence (section 5.1). Confirm the approach.
8. **Wording:** the fixed notice (section 5.3) and the "self-assessment" statement.
9. ~~Teammate sign-off for the `Explanation.jsx` change~~ Given; the change is made.

**Provisional numbers (all Unverified):** the 300-word minimum transcript; the "requested + 2" candidate count capped at 12; the 100 s server limit, the 45 s remaining-time rule and the 120 s client timeout (the provider's own per-call timeout defaults to 60 s, **Confirmed**); the overlap thresholds and margin.

**Unverified**

- Whether the configured model honours a JSON schema.
- Real latency, token use (including thinking tokens), cost, and rejection rates.
- NVDA behaviour for every item in section 10.1; whether Ctrl+= zooms this app; quiz behaviour in the packaged app.
- What a second app instance on the same profile does.
- Caption quality across the lectures students will actually use.
