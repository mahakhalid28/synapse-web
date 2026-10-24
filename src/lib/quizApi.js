// Client for POST /video/quiz (docs/QUIZ_CONTRACT.md section 4; PROPOSED endpoint, off by default).
//
// Modelled on askApi.js: its own base URL (the same VITE_API_BASE_URL), always the real endpoint
// (never mocked), typed errors with friendly messages, a timeout, and a caller AbortSignal.
// Nothing imports this module yet and no request is made at import time.
//
// Every 200 response is validated by quizSchema.parseQuizResponse before it is returned; a body that
// does not match, or that answers a different video or count than was asked, is an "unusable" error
// and nothing is saved. A 200 "insufficient_material" is NOT an error: it resolves with the
// response, and insufficientMessage() gives the text to show.
//
// The client never retries by itself: every Retry the user chooses is a new request, and a new
// (paid) model call on the server.

import { API_BASE_URL, apiUrl } from "./apiConfig.js";
import { MAX_QUESTION_COUNT, MIN_QUESTION_COUNT, QuizSchemaError, parseQuizResponse } from "./quizSchema.js";

export const QUIZ_BASE_URL = API_BASE_URL;
export const QUIZ_TIMEOUT_MS = 120_000; // provisional: longer than the server's own ~100 s limit
export const DEFAULT_QUESTION_COUNT = 6;

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export const QUIZ_ERROR_MESSAGES = {
  busy: "The AI service is busy right now. Please try again in a minute.",
  unavailable: "The AI service didn't respond. Please try again.",
  unusable: "The AI service returned something we couldn't use. Please try again.",
  server: "Something went wrong on our side. Please try again later.",
  videoNotFound: "This video isn't available for practice questions yet.",
  featureOff: "Practice questions aren't available right now.",
  invalid: "Please check the number of questions (5 to 10).",
  forbidden: "The Synapse server didn't accept this request.",
  network: "Can't reach the Synapse server. Is it running?",
};

const INSUFFICIENT_MESSAGES = {
  no_transcript: "This lecture doesn't have a usable transcript yet, so practice questions can't be made.",
  too_short: "This lecture is too short to make reliable practice questions.",
  validation_failed: "Questions were made, but too few passed our checks. Please try again.",
};

const RETRYABLE = new Set(["busy", "unavailable", "unusable", "network"]);

export class QuizApiError extends Error {
  constructor(kind, status = null) {
    super(QUIZ_ERROR_MESSAGES[kind] ?? QUIZ_ERROR_MESSAGES.server);
    this.name = "QuizApiError";
    this.kind = kind;
    this.status = status;
    this.retryable = RETRYABLE.has(kind);
  }
}

export function insufficientMessage(reason) {
  return INSUFFICIENT_MESSAGES[reason] ?? INSUFFICIENT_MESSAGES.validation_failed;
}

export function isValidQuestionCount(count) {
  return Number.isInteger(count) && count >= MIN_QUESTION_COUNT && count <= MAX_QUESTION_COUNT;
}

export function buildQuizBody({ videoId, questionCount = DEFAULT_QUESTION_COUNT }) {
  return { video_id: videoId, question_count: questionCount };
}

// 404 is told apart by the server's detail text, as Ask does.
function kindForStatus(status, detail) {
  if (status === 429) return "busy";
  if (status === 503 || status === 504) return "unavailable";
  if (status === 502) return "unusable";
  if (status === 403) return "forbidden";
  if (status === 422) return "invalid";
  if (status === 404) {
    if (detail === "Video not found") return "videoNotFound";
    if (detail === "Quiz is not available.") return "featureOff";
    return "server";
  }
  return "server"; // 500 and anything unexpected
}

async function post(body, signal) {
  // Own timeout, kept apart from the caller's signal: a caller abort is silent, a timeout is an error.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, QUIZ_TIMEOUT_MS);
  const onCallerAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onCallerAbort, { once: true });
  }

  try {
    let res;
    try {
      res = await fetch(apiUrl("/video/quiz"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (timedOut) throw new QuizApiError("unavailable");
      if (signal?.aborted || err?.name === "AbortError") throw err;
      throw new QuizApiError("network");
    }

    if (!res.ok) {
      let detail = null;
      try { detail = (await res.json())?.detail ?? null; } catch { /* status alone decides */ }
      // Raw server text is never shown; only matched against known strings.
      throw new QuizApiError(kindForStatus(res.status, typeof detail === "string" ? detail : null), res.status);
    }

    let data;
    try {
      data = await res.json();
    } catch (err) {
      if (timedOut) throw new QuizApiError("unavailable");
      if (signal?.aborted || err?.name === "AbortError") throw err;
      throw new QuizApiError("unusable");
    }
    try {
      return parseQuizResponse(data);
    } catch (err) {
      if (err instanceof QuizSchemaError) throw new QuizApiError("unusable");
      throw err;
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCallerAbort);
  }
}

/**
 * Ask the server for practice questions about a lecture.
 * Resolves to the validated response (status complete | partial | insufficient_material), or
 * rejects with a QuizApiError (kind, message, retryable) -- or the caller's AbortError if `signal`
 * was aborted, which callers should ignore.
 */
export async function requestQuiz({ videoId, questionCount = DEFAULT_QUESTION_COUNT, signal }) {
  if (typeof videoId !== "string" || !VIDEO_ID_RE.test(videoId) || !isValidQuestionCount(questionCount)) {
    throw new QuizApiError("invalid"); // checked before sending, like Ask
  }
  const quiz = await post(buildQuizBody({ videoId, questionCount }), signal);
  // A response for another lecture or count must never be saved as this one.
  if (quiz.video_id !== videoId || quiz.requested_count !== questionCount) throw new QuizApiError("unusable");
  return quiz;
}
