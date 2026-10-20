// Client for POST /video/ask (lecture-wide question answering).
//
// Deliberately independent of api.js: it has its own base URL and always
// calls the real endpoint, whatever USE_MOCK is set to there.

export const ASK_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");

export const ASK_TIMEOUT_MS = 90_000;
export const MAX_QUESTION_LENGTH = 500;
export const MAX_TIME_SECONDS = 172_800;

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
// The backend's rule is ^[A-Za-z0-9-]{1,64}$ and its real ids are UUID4
// strings. Only UUIDs are sent, so mock ids such as "p1" (which would satisfy
// the looser rule) never reach the server.
const INTERVENTION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUSES = ["answered", "not_in_lecture", "insufficient_context"];

export const ERROR_MESSAGES = {
  busy: "The AI service is busy right now. Please try again in a minute.",
  unavailable: "The AI service didn't respond. Please try again.",
  server: "Something went wrong on our side. Please try again later.",
  videoNotFound: "This video isn't available for questions yet.",
  network: "Can't reach the Synapse server. Is it running?",
  invalid: "Please check your question (1-500 characters).",
  forbidden: "The Synapse server didn't accept this request.",
};

// Errors a "Try again" button makes sense for.
const RETRYABLE = new Set(["busy", "unavailable", "network"]);

export class AskError extends Error {
  constructor(kind, status = null) {
    super(ERROR_MESSAGES[kind] ?? ERROR_MESSAGES.server);
    this.name = "AskError";
    this.kind = kind;
    this.status = status;
    this.retryable = RETRYABLE.has(kind);
  }
}

export function formatTimestamp(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export function isValidVideoId(id) {
  return typeof id === "string" && VIDEO_ID_RE.test(id);
}

export function isRealInterventionId(id) {
  return typeof id === "string" && INTERVENTION_ID_RE.test(id);
}

// Optional fields are left out entirely (not sent as null) when unavailable
// or invalid.
export function buildAskBody({
  videoId,
  question,
  currentTimeSeconds,
  interventionId,
}) {
  const body = { video_id: videoId, question: String(question ?? "").trim() };
  if (
    typeof currentTimeSeconds === "number" &&
    Number.isFinite(currentTimeSeconds) &&
    currentTimeSeconds >= 0 &&
    currentTimeSeconds <= MAX_TIME_SECONDS
  ) {
    body.current_time_seconds = currentTimeSeconds;
  }
  if (isRealInterventionId(interventionId)) {
    body.intervention_id = interventionId;
  }
  return body;
}

// Anything that doesn't match the documented shape is treated as an unusable
// response rather than rendered. The "sources only when answered" invariant is
// enforced here too, so the UI can rely on it.
function parseAskResponse(data) {
  if (
    !data ||
    typeof data !== "object" ||
    !STATUSES.includes(data.status) ||
    typeof data.answer_text !== "string" ||
    !data.answer_text.trim()
  ) {
    throw new AskError("server");
  }
  const sources =
    data.status === "answered" && Array.isArray(data.sources)
      ? data.sources
          .filter(
            (src) =>
              src &&
              Number.isFinite(src.start_seconds) &&
              Number.isFinite(src.end_seconds),
          )
          .map((src) => ({
            start_seconds: src.start_seconds,
            end_seconds: src.end_seconds,
            intervention_id: src.intervention_id ?? null,
          }))
      : [];
  return {
    status: data.status,
    scope: data.scope === "lecture_with_moment" ? "lecture_with_moment" : "lecture",
    answer_text: data.answer_text,
    sources,
  };
}

function kindForStatus(status) {
  if (status === 429) return "busy";
  if (status === 503 || status === 504) return "unavailable";
  if (status === 403) return "forbidden";
  if (status === 422) return "invalid";
  if (status === 404) return "videoNotFound";
  return "server"; // 500, 502 and anything unexpected
}

async function postAsk(body, signal) {
  // Own timeout, kept separate from the caller's signal so the two can be
  // told apart: a caller abort is silent, a timeout is an error.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ASK_TIMEOUT_MS);
  const onCallerAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onCallerAbort, { once: true });
  }

  try {
    let res;
    try {
      res = await fetch(`${ASK_BASE_URL}/video/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (timedOut) throw new AskError("unavailable");
      if (signal?.aborted || err?.name === "AbortError") throw err;
      throw new AskError("network");
    }

    if (!res.ok) {
      let detail = null;
      try {
        detail = (await res.json())?.detail ?? null;
      } catch {
        // body wasn't JSON — status alone decides
      }
      const err = new AskError(kindForStatus(res.status), res.status);
      err.detail = typeof detail === "string" ? detail : null;
      throw err;
    }

    let data;
    try {
      data = await res.json();
    } catch (err) {
      if (timedOut) throw new AskError("unavailable");
      if (signal?.aborted || err?.name === "AbortError") throw err;
      throw new AskError("server");
    }
    return parseAskResponse(data);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCallerAbort);
  }
}

/**
 * Ask a question about a lecture.
 * Resolves to { status, scope, answer_text, sources } or rejects with an
 * AskError (kind, message, retryable) — or the caller's AbortError if `signal`
 * was aborted, which callers should ignore.
 *
 * A 404 whose detail is exactly "Intervention not found" is retried once
 * without intervention_id (current_time_seconds is kept).
 */
export async function askQuestion({
  videoId,
  question,
  currentTimeSeconds,
  interventionId,
  signal,
}) {
  const body = buildAskBody({
    videoId,
    question,
    currentTimeSeconds,
    interventionId,
  });
  try {
    return await postAsk(body, signal);
  } catch (err) {
    if (
      err instanceof AskError &&
      err.status === 404 &&
      err.detail === "Intervention not found" &&
      body.intervention_id
    ) {
      const { intervention_id: _dropped, ...withoutMoment } = body; // eslint-disable-line no-unused-vars
      return postAsk(withoutMoment, signal);
    }
    throw err;
  }
}
