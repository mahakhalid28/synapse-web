// Validation for Accessible Quiz & Practice data (docs/QUIZ_CONTRACT.md, contract_version 1).
//
// PROPOSED feature: nothing here is wired into the app. Two jobs:
//   1. parseQuizResponse(): a POST /video/quiz response is untrusted until it passes here.
//   2. validateAttempt() / validateResponses(): stored attempts are untrusted when read back,
//      and every progress write is checked before it is saved.
//
// Everything returns a FRESH object holding only known fields, so nothing extra (an unknown
// key, a blob, a DOM node) can reach storage. Errors are QuizSchemaError with a fixed `reason`
// code and a fixed message: no input value is ever echoed into an error.
//
// Not supported in the first release, and rejected here: short-answer questions, any question
// type other than "mcq" / "tf", "moment" evidence, and grounding other than "screened".

export const QUIZ_CONTRACT_VERSION = 1;
export const SCHEMA_VERSION = 1; // for stored records

export const QUIZ_MODES = ["practice", "assessment"];
export const ATTEMPT_STATUSES = ["in_progress", "submitted", "abandoned"];
export const QUIZ_STATUSES = ["complete", "partial", "insufficient_material"];
export const INSUFFICIENT_REASONS = ["no_transcript", "too_short", "validation_failed"];
export const QUESTION_TYPES = ["mcq", "tf"];

export const MIN_QUESTION_COUNT = 5;
export const MAX_QUESTION_COUNT = 10;
export const MIN_USABLE_QUESTIONS = 3;
export const MAX_HINTS = 2;
export const MAX_EVIDENCE = 3;
export const CHOICE_IDS = ["a", "b", "c", "d"];

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const QUIZ_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONCEPT_ID_RE = /^[a-z0-9-]{1,40}$/;
const OMITTED_REASON_RE = /^[a-z_]{1,40}$/;
const QUESTION_ID_RE = /^q([1-9][0-9]?)$/;
const ATTEMPT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

const MESSAGES = {
  invalid: "The quiz data is not in the expected format.",
  unsupported_version: "The quiz data was saved by a newer version of Synapse.",
  unsupported_contract_version: "The quiz response uses a version this app does not support.",
  question_type_unsupported: "The quiz contains a question type this app does not support.",
  evidence_kind_unsupported: "The quiz contains evidence this app does not support.",
  grounding_unsupported: "The quiz contains a grounding label this app does not support.",
  not_storable: "A quiz with no questions cannot be saved.",
  response_rule: "The answers break a Practice or Assessment rule.",
};

export class QuizSchemaError extends Error {
  constructor(reason = "invalid") {
    super(MESSAGES[reason] ?? MESSAGES.invalid);
    this.name = "QuizSchemaError";
    this.reason = reason;
  }
}

const bad = (reason = "invalid") => new QuizSchemaError(reason);

/* ── Primitives ──────────────────────────────────────────────────────────── */

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);

function text(value, min, max) {
  if (typeof value !== "string" || value.length < min || value.length > max || value.trim() === "") throw bad();
  return value;
}

/* ── Quiz response ───────────────────────────────────────────────────────── */

function parseChoices(raw, type) {
  if (!Array.isArray(raw)) throw bad();
  const choices = raw.map((c) => {
    if (!isObject(c)) throw bad();
    return { id: text(c.id, 1, 5), text: text(c.text, 1, 200) };
  });
  if (type === "tf") {
    if (choices.length !== 2 || choices[0].id !== "true" || choices[0].text !== "True" ||
        choices[1].id !== "false" || choices[1].text !== "False") throw bad();
  } else {
    if (choices.length < 3 || choices.length > 4) throw bad();
    choices.forEach((c, i) => { if (c.id !== CHOICE_IDS[i]) throw bad(); });
  }
  return choices;
}

function parseEvidence(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_EVIDENCE) throw bad();
  const out = raw.map((e) => {
    if (!isObject(e)) throw bad();
    if (e.kind !== "transcript") throw bad("evidence_kind_unsupported"); // "moment" is reserved, not supported
    if (!isFiniteNumber(e.start_seconds) || !isFiniteNumber(e.end_seconds)) throw bad();
    if (e.start_seconds < 0 || e.end_seconds < e.start_seconds) throw bad();
    return { kind: "transcript", start_seconds: e.start_seconds, end_seconds: e.end_seconds, quote: text(e.quote, 1, 240) };
  });
  for (let i = 1; i < out.length; i++) if (out[i].start_seconds < out[i - 1].start_seconds) throw bad();
  return out;
}

function parseQuestion(raw, index) {
  if (!isObject(raw)) throw bad();
  if (raw.id !== `q${index + 1}`) throw bad();
  if (!QUESTION_ID_RE.test(raw.id)) throw bad();
  if (!QUESTION_TYPES.includes(raw.type)) throw bad("question_type_unsupported");
  if (raw.grounding !== "screened") throw bad("grounding_unsupported"); // never "verified"
  const choices = parseChoices(raw.choices, raw.type);
  if (typeof raw.correct_choice_id !== "string" || !choices.some((c) => c.id === raw.correct_choice_id)) throw bad();
  if (!Array.isArray(raw.hints ?? []) || (raw.hints ?? []).length > MAX_HINTS) throw bad();
  const concept = raw.concept;
  if (!isObject(concept) || typeof concept.id !== "string" || !CONCEPT_ID_RE.test(concept.id)) throw bad();
  return {
    id: raw.id,
    type: raw.type,
    prompt: text(raw.prompt, 1, 400),
    choices,
    correct_choice_id: raw.correct_choice_id,
    explanation: text(raw.explanation, 1, 600),
    hints: (raw.hints ?? []).map((h) => text(h, 1, 200)),
    concept: { id: concept.id, label: text(concept.label, 1, 60) },
    evidence: parseEvidence(raw.evidence),
    grounding: "screened",
  };
}

/**
 * Validates a POST /video/quiz response (any status) and returns a clean copy.
 * Throws QuizSchemaError. The status invariants of the contract are enforced here too.
 */
export function parseQuizResponse(data) {
  if (!isObject(data)) throw bad();
  if (data.contract_version !== QUIZ_CONTRACT_VERSION) throw bad("unsupported_contract_version");
  if (typeof data.quiz_id !== "string" || !QUIZ_ID_RE.test(data.quiz_id)) throw bad();
  if (typeof data.video_id !== "string" || !VIDEO_ID_RE.test(data.video_id)) throw bad();
  if (typeof data.generated_at !== "string" || !Number.isFinite(Date.parse(data.generated_at))) throw bad();
  const requested = data.requested_count;
  if (!isInt(requested, MIN_QUESTION_COUNT, MAX_QUESTION_COUNT)) throw bad();
  if (!QUIZ_STATUSES.includes(data.status)) throw bad();
  if (!Array.isArray(data.questions) || data.questions.length > MAX_QUESTION_COUNT) throw bad();
  const count = data.questions.length;
  if (data.returned_count !== count) throw bad();

  const reason = data.reason ?? null;
  const notice = data.notice ?? null;
  if (reason !== null && !INSUFFICIENT_REASONS.includes(reason)) throw bad();
  if (notice !== null) text(notice, 1, 300);

  if (data.status === "complete") {
    if (count !== requested || reason !== null || notice !== null) throw bad();
  } else if (data.status === "partial") {
    if (count < MIN_USABLE_QUESTIONS || count >= requested || reason !== null || notice === null) throw bad();
  } else if (count !== 0 || reason === null || notice === null) {
    throw bad();
  }

  const omitted = data.omitted ?? [];
  if (!Array.isArray(omitted) || omitted.length > 50) throw bad();

  return {
    contract_version: QUIZ_CONTRACT_VERSION,
    quiz_id: data.quiz_id,
    video_id: data.video_id,
    generated_at: data.generated_at,
    prompt_version: text(data.prompt_version, 1, 40),
    model: text(data.model, 1, 100),
    requested_count: requested,
    returned_count: count,
    status: data.status,
    reason,
    notice,
    omitted: omitted.map((o) => {
      if (!isObject(o) || typeof o.reason !== "string" || !OMITTED_REASON_RE.test(o.reason) || !isInt(o.count, 1, 100)) throw bad();
      return { reason: o.reason, count: o.count };
    }),
    questions: data.questions.map(parseQuestion),
  };
}

/** A quiz that can be saved and attempted: complete or partial, with questions. */
export function parseStorableQuiz(data) {
  const quiz = parseQuizResponse(data);
  if (quiz.status === "insufficient_material" || quiz.questions.length === 0) throw bad("not_storable");
  return quiz;
}

/* ── Responses (one per question) ────────────────────────────────────────── */

export const emptyResponse = () => ({
  choiceId: null,
  firstCheckedChoiceId: null,
  lastCheckedChoiceId: null,
  hintsUsed: 0,
  flagged: false,
});

const RESPONSE_KEYS = ["choiceId", "firstCheckedChoiceId", "lastCheckedChoiceId", "hintsUsed", "flagged"];

function choiceOrNull(value, question) {
  if (value === null) return null;
  if (typeof value !== "string" || !question.choices.some((c) => c.id === value)) throw bad();
  return value;
}

/**
 * Validates and normalises the responses map for a quiz and mode. Every question gets an
 * entry (missing ones become the empty response). `previous` (already normalised) adds the
 * monotonic rules: facts recorded earlier can not be erased.
 *
 * Response fields (the contract's `checked` / `firstTryCorrect` are derived from these, so a
 * stored boolean can never disagree with the facts it summarises):
 *   choiceId              the current selection, or null
 *   firstCheckedChoiceId  the selection at the FIRST "Check answer" (Practice), or null; never changes
 *   lastCheckedChoiceId   the selection at the latest check, or null; feedback is showing iff it equals choiceId
 *   hintsUsed             0 to min(2, the question's hints); never decreases; Practice only
 *   flagged               marked for review
 *
 * Assessment: no checks, no hints. Practice: a first check implies a last check.
 */
export function validateResponses(quiz, mode, responses, previous = null) {
  if (!QUIZ_MODES.includes(mode)) throw bad();
  if (!isObject(responses)) throw bad();
  const ids = new Set(quiz.questions.map((q) => q.id));
  for (const key of Object.keys(responses)) if (!ids.has(key)) throw bad();

  const out = {};
  for (const question of quiz.questions) {
    const raw = responses[question.id] ?? emptyResponse();
    if (!isObject(raw)) throw bad();
    for (const key of Object.keys(raw)) if (!RESPONSE_KEYS.includes(key)) throw bad();
    const response = {
      choiceId: choiceOrNull(raw.choiceId ?? null, question),
      firstCheckedChoiceId: choiceOrNull(raw.firstCheckedChoiceId ?? null, question),
      lastCheckedChoiceId: choiceOrNull(raw.lastCheckedChoiceId ?? null, question),
      hintsUsed: raw.hintsUsed ?? 0,
      flagged: raw.flagged ?? false,
    };
    if (!isInt(response.hintsUsed, 0, MAX_HINTS) || typeof response.flagged !== "boolean") throw bad();
    if (response.hintsUsed > question.hints.length) throw bad();

    if (mode === "assessment") {
      if (response.firstCheckedChoiceId !== null || response.lastCheckedChoiceId !== null || response.hintsUsed !== 0) {
        throw bad("response_rule");
      }
    } else if ((response.firstCheckedChoiceId === null) !== (response.lastCheckedChoiceId === null)) {
      throw bad("response_rule");
    }

    const before = previous?.[question.id];
    if (before) {
      if (before.firstCheckedChoiceId !== null && response.firstCheckedChoiceId !== before.firstCheckedChoiceId) throw bad("response_rule");
      if (response.hintsUsed < before.hintsUsed) throw bad("response_rule");
    }
    out[question.id] = response;
  }
  return out;
}

/* ── Stored records ──────────────────────────────────────────────────────── */

/**
 * Version gate shared by every stored record. A record from a NEWER version is
 * "unsupported_version" (callers must skip it and never overwrite it); anything else that is
 * not exactly this version is "invalid".
 */
export function checkSchemaVersion(record) {
  if (!isObject(record)) throw bad();
  const v = record.schemaVersion;
  if (Number.isInteger(v) && v > SCHEMA_VERSION) throw bad("unsupported_version");
  if (v !== SCHEMA_VERSION) throw bad();
}

/** A stored quiz record `{ id, schemaVersion, savedAt, quiz }` -> its validated quiz. */
export function validateQuizRecord(record) {
  checkSchemaVersion(record);
  if (typeof record.id !== "string" || !isFiniteNumber(record.savedAt) || record.savedAt <= 0) throw bad();
  const quiz = parseStorableQuiz(record.quiz);
  if (quiz.quiz_id !== record.id) throw bad();
  return { id: record.id, savedAt: record.savedAt, quiz };
}

/** A stored `active` pointer `{ id: videoId, schemaVersion, attemptId, rev }`. */
export function validatePointer(record) {
  checkSchemaVersion(record);
  if (typeof record.id !== "string" || !VIDEO_ID_RE.test(record.id)) throw bad();
  if (typeof record.attemptId !== "string" || !ATTEMPT_ID_RE.test(record.attemptId)) throw bad();
  if (!isInt(record.rev, 1, Number.MAX_SAFE_INTEGER)) throw bad();
  return { id: record.id, attemptId: record.attemptId, rev: record.rev };
}

function optionalTime(v) {
  if (v === null) return null;
  if (!isFiniteNumber(v) || v <= 0) throw bad();
  return v;
}

/**
 * A stored attempt record, validated against ITS quiz. Returns a clean, normalised copy.
 * The cached `result` is checked for shape only; it is never used for display (see quizScoring).
 */
export function validateAttempt(record, quiz) {
  checkSchemaVersion(record);
  if (typeof record.id !== "string" || !ATTEMPT_ID_RE.test(record.id)) throw bad();
  if (record.quizId !== quiz.quiz_id || record.videoId !== quiz.video_id) throw bad();
  if (!QUIZ_MODES.includes(record.quizMode) || !ATTEMPT_STATUSES.includes(record.status)) throw bad();
  if (!isInt(record.rev, 0, Number.MAX_SAFE_INTEGER)) throw bad();
  if (!isFiniteNumber(record.startedAt) || record.startedAt <= 0) throw bad();
  if (!isFiniteNumber(record.updatedAt) || record.updatedAt < record.startedAt) throw bad();
  const submittedAt = optionalTime(record.submittedAt ?? null);
  const abandonedAt = optionalTime(record.abandonedAt ?? null);
  if ((record.status === "submitted") !== (submittedAt !== null)) throw bad();
  if ((record.status === "abandoned") !== (abandonedAt !== null)) throw bad();
  if (!isInt(record.currentIndex, 0, quiz.questions.length - 1)) throw bad();

  let result = null;
  if (record.result !== null && record.result !== undefined) {
    const r = record.result;
    if (!isObject(r) || !isInt(r.correct, 0, MAX_QUESTION_COUNT) || !isInt(r.incorrect, 0, MAX_QUESTION_COUNT) ||
        !isInt(r.unanswered, 0, MAX_QUESTION_COUNT) || !isInt(r.total, 1, MAX_QUESTION_COUNT) || !isFiniteNumber(r.scoredAt)) throw bad();
    result = { correct: r.correct, incorrect: r.incorrect, unanswered: r.unanswered, total: r.total, scoredAt: r.scoredAt };
  }
  if ((record.status === "submitted") !== (result !== null)) throw bad();

  return {
    id: record.id,
    schemaVersion: SCHEMA_VERSION,
    quizId: record.quizId,
    videoId: record.videoId,
    quizMode: record.quizMode,
    status: record.status,
    rev: record.rev,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    submittedAt,
    abandonedAt,
    currentIndex: record.currentIndex,
    responses: validateResponses(quiz, record.quizMode, record.responses),
    result,
  };
}
