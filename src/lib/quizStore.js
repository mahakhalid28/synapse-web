// Local-only storage for Accessible Quiz & Practice (IndexedDB database "synapse_quiz").
//
// PROPOSED feature (docs/QUIZ_CONTRACT.md section 8): nothing imports this module yet. It
// talks to no network service and stores no audio, blobs, keys or transcripts (a quiz holds
// only its questions and the short evidence quotes the server chose).
//
// Three object stores, ALL keyed by "id" (the project's fake IndexedDB, like most simple
// stand-ins, is only trustworthy for that; see src/test/fakeIndexedDb.js):
//
//   quizzes   { id: quiz_id, schemaVersion, savedAt, quiz }      IMMUTABLE: add() only, never put()
//   attempts  { id, schemaVersion, quizId, videoId, quizMode, status, rev, startedAt, updatedAt,
//               submittedAt, abandonedAt, currentIndex, responses, result }
//   active    { id: videoId, schemaVersion, attemptId, rev }     the ONE in-progress attempt per video
//
// Attempts are stored apart from quizzes. Invariant: a video has at most one in-progress
// attempt, and it is the one `active` names.
//
// Writes that touch more than one record are ONE readwrite transaction, so they either all
// happen or none do:
//   startAttempt   check pointer, set the previous attempt aside, add quiz + attempt, move pointer
//   saveProgress   compare `rev`, write rev + 1
//   submitAttempt  compare `rev`, final answers + result, clear the pointer if it still names this attempt
//   abandonAttempt compare `rev`, status "abandoned", clear the pointer likewise
// On any mismatch or failure the transaction is aborted and nothing is written. The old attempt
// is therefore never lost because a new quiz failed to save.
//
// Conflicts are detected by compare-and-set: `rev` for an attempt, and the attempt id the pointer
// names (never a counter, so a recycled number can not fool it) for starting a new set. IndexedDB
// serialises overlapping readwrite transactions, so this holds across tabs/windows of the SAME
// browser profile. It does NOT coordinate separate profiles or machines (their databases are
// separate), and what a second app instance on one profile does is unverified.
//
// Reads never throw for bad DATA. A record that fails validation, or was written by a newer
// version, is reported as unreadable (or skipped and counted in lists) and is never modified
// or overwritten. There is deliberately NO delete API: set-aside attempts are kept (contract).
//
// Errors are QuizStoreError with a stable `code`:
//   unavailable          no IndexedDB in this environment
//   invalid              the input failed validation (nothing was written)
//   duplicate            a record with this id already exists (nothing was written)
//   conflict             the attempt or pointer changed since the caller read it (nothing written)
//   not_found            no such attempt
//   not_in_progress      the attempt is already submitted or abandoned
//   corrupt              the stored record failed validation (left untouched)
//   unsupported_version  the stored record is from a newer version (left untouched)
//   quota                not enough storage space
//   failed               anything else (the original error is in `cause`)

import {
  QUIZ_MODES, SCHEMA_VERSION, QuizSchemaError, checkSchemaVersion, parseStorableQuiz, validateAttempt,
  validatePointer, validateQuizRecord, validateResponses,
} from "./quizSchema.js";
import { buildResult, progressSummary, scoreAttempt } from "./quizScoring.js";

export const DB_NAME = "synapse_quiz";
export const DB_VERSION = 1;
export const QUIZZES_STORE = "quizzes";
export const ATTEMPTS_STORE = "attempts";
export const ACTIVE_STORE = "active";

// What getActiveAttempt() reports as `activeAttemptId` when the pointer exists but is unreadable;
// pass it back as `expectedActiveAttemptId` to replace that pointer.
export const CORRUPT_POINTER = "!corrupt";

const ATTEMPT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export class QuizStoreError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = "QuizStoreError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

const MESSAGES = {
  conflict: "This practice was changed in another window.",
  not_found: "That practice could not be found.",
  not_in_progress: "That practice is already finished.",
  corrupt: "A saved practice could not be read.",
  unsupported_version: "A saved practice was made by a newer version of Synapse.",
  duplicate: "That quiz or attempt is already saved.",
  invalid: "The quiz data is not valid.",
};
const storeError = (code, cause) => new QuizStoreError(code, MESSAGES[code] ?? "Could not use saved practice data.", cause);

function mapError(err, fallbackMessage) {
  if (err instanceof QuizStoreError) return err;
  if (err instanceof QuizSchemaError) {
    return storeError(err.reason === "unsupported_version" ? "unsupported_version" : "invalid", err);
  }
  switch (err && err.name) {
    case "ConstraintError":
      return storeError("duplicate", err);
    case "QuotaExceededError":
      return new QuizStoreError("quota", "There is not enough storage space to save your practice.", err);
    case "VersionError":
      return new QuizStoreError("unsupported_version", "The practice database was created by a newer version of Synapse.", err);
    default:
      return new QuizStoreError("failed", fallbackMessage, err);
  }
}

const UNAVAILABLE = () =>
  new QuizStoreError("unavailable", "Practice can't be saved here: this environment has no IndexedDB.");

/* ── Small helpers ───────────────────────────────────────────────────────── */

export function newAttemptId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `attempt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const newestFirst = (a, b) => b.attempt.startedAt - a.attempt.startedAt || (a.attempt.id < b.attempt.id ? 1 : -1);
const isInt = (v, min = 0) => Number.isInteger(v) && v >= min;
const plain = (value) => JSON.parse(JSON.stringify(value)); // records are JSON-only; this is a deep copy

function requireAttemptId(id) {
  if (typeof id !== "string" || !ATTEMPT_ID_RE.test(id)) throw storeError("invalid");
  return id;
}

function readPointer(raw) {
  if (raw === undefined || raw === null) return { kind: "none" };
  try {
    return { kind: "valid", ...validatePointer(raw) };
  } catch (err) {
    return { kind: err instanceof QuizSchemaError && err.reason === "unsupported_version" ? "unsupported" : "corrupt" };
  }
}

const pointerToken = (p) => (p.kind === "valid" ? p.attemptId : p.kind === "corrupt" ? CORRUPT_POINTER : null);

// Validates a stored attempt together with its quiz. Never throws.
function resolveAttempt(rawAttempt, rawQuiz) {
  if (rawAttempt === undefined || rawAttempt === null) return { ok: false, reason: "not_found" };
  try {
    checkSchemaVersion(rawAttempt);
  } catch (err) {
    return { ok: false, reason: err.reason === "unsupported_version" ? "unsupported_version" : "corrupt" };
  }
  if (rawQuiz === undefined || rawQuiz === null) return { ok: false, reason: "corrupt" };
  let quiz;
  try {
    quiz = validateQuizRecord(rawQuiz).quiz;
  } catch (err) {
    return { ok: false, reason: err.reason === "unsupported_version" ? "unsupported_version" : "corrupt" };
  }
  try {
    return { ok: true, attempt: validateAttempt(rawAttempt, quiz), quiz };
  } catch {
    return { ok: false, reason: "corrupt" };
  }
}

function describe(found) {
  const { attempt, quiz } = found;
  const view = { ok: true, attempt, quiz, progress: progressSummary(quiz, attempt) };
  // Scores are always recomputed from the stored responses; `attempt.result` is not used here.
  if (attempt.status === "submitted") view.score = scoreAttempt(quiz, attempt.quizMode, attempt.responses);
  return view;
}

function openDatabase(factory) {
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = factory.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(mapError(err, "Could not open the practice database."));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of [QUIZZES_STORE, ATTEMPTS_STORE, ACTIVE_STORE]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(mapError(request.error, "Could not open the practice database."));
  });
}

/**
 * Builds a store bound to an IndexedDB factory. The app uses the default instance exported
 * below; tests inject a fake factory, clock and id generator.
 *
 * @param {{ indexedDB?: IDBFactory | undefined, storage?: StorageManager | undefined,
 *           clock?: () => number, newId?: () => string }} [options]
 */
export function createQuizStore(options = {}) {
  const factory = "indexedDB" in options ? options.indexedDB : globalThis.indexedDB;
  const storage = "storage" in options ? options.storage : globalThis.navigator?.storage;
  const clock = options.clock ?? (() => Date.now());
  const newId = options.newId ?? newAttemptId;

  let dbPromise = null;
  let persistPromise = null;

  // Best-effort, same convention as notesStore: never throws, never blocks saving.
  // UNVERIFIED in Electron: persist() may be refused by the session permission handlers
  // (electron/permissions.cjs allowlists it only for the app page); check in a real run.
  function requestPersistence() {
    if (!persistPromise) {
      persistPromise = (async () => {
        try {
          if (!storage || typeof storage.persist !== "function") return false;
          if (typeof storage.persisted === "function" && (await storage.persisted())) return true;
          return (await storage.persist()) === true;
        } catch {
          return false;
        }
      })();
    }
    return persistPromise;
  }

  function getDb() {
    if (!factory) return Promise.reject(UNAVAILABLE());
    if (!dbPromise) {
      const p = openDatabase(factory).then((db) => {
        const forget = () => { if (dbPromise === p) dbPromise = null; };
        db.onversionchange = () => { db.close(); forget(); };
        db.onclose = forget;
        void requestPersistence();
        return db;
      });
      p.catch(() => { if (dbPromise === p) dbPromise = null; }); // a failed open is not cached
      dbPromise = p;
    }
    return dbPromise;
  }

  // Runs `work(ctx)` inside ONE transaction and resolves with the value passed to ctx.done()
  // once the transaction has COMMITTED. ctx:
  //   store(name)        the object store
  //   track(request)     capture a request's error (a failed request aborts the transaction)
  //   read(request, fn)  track + run fn(result) on success; anything fn throws aborts the transaction
  //   fail(error)        abort the transaction; the promise rejects with `error`
  //   done(value)        the value to resolve with after commit
  async function runTransaction(storeNames, mode, work, failMessage) {
    for (let attempt = 0; ; attempt++) {
      const db = await getDb();
      let tx;
      try {
        tx = mode === "readwrite" ? db.transaction(storeNames, mode, { durability: "strict" }) : db.transaction(storeNames, mode);
      } catch (err) {
        // The connection was closed under us (e.g. another tab upgraded): drop it and reopen once.
        if (err && err.name === "InvalidStateError") {
          dbPromise = null;
          try { db.close(); } catch { /* already closed */ }
          if (attempt === 0) continue;
        }
        throw mapError(err, failMessage);
      }
      return new Promise((resolve, reject) => {
        let requestError = null;
        let failure = null;
        let result;
        const fail = (error) => {
          if (failure) return;
          failure = error;
          try { tx.abort(); } catch { /* already finished */ }
        };
        const track = (request) => { request.onerror = () => { requestError = request.error; }; return request; };
        const read = (request, handler) => {
          track(request);
          request.onsuccess = () => { try { handler(request.result); } catch (err) { fail(err); } };
          return request;
        };
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => {
          const cause = failure || tx.error || requestError;
          reject(cause ? mapError(cause, failMessage) : new QuizStoreError("failed", `${failMessage} The database transaction was aborted.`));
        };
        try {
          work({ store: (name) => tx.objectStore(name), track, read, fail, done: (value) => { result = value; } });
        } catch (err) {
          fail(err);
        }
      });
    }
  }

  // Reads an attempt and its quiz inside the current transaction, then calls next(found).
  // Unreadable data fails the transaction with the matching code and writes nothing.
  function loadForWrite(ctx, attemptId, next) {
    ctx.read(ctx.store(ATTEMPTS_STORE).get(attemptId), (rawAttempt) => {
      const quizId = rawAttempt && typeof rawAttempt.quizId === "string" ? rawAttempt.quizId : null;
      const withQuiz = (rawQuiz) => {
        const found = resolveAttempt(rawAttempt, rawQuiz);
        if (!found.ok) return ctx.fail(storeError(found.reason));
        next(found);
      };
      if (quizId === null) return withQuiz(undefined);
      ctx.read(ctx.store(QUIZZES_STORE).get(quizId), withQuiz);
    });
  }

  const touched = (attempt) => Math.max(clock(), attempt.updatedAt); // updatedAt never goes backwards

  /* ── Writes ────────────────────────────────────────────────────────────── */

  /**
   * Saves a generated quiz on its own (add only, never replaces). Most callers use
   * startAttempt(), which saves the quiz and its first attempt together.
   * Rejects with "invalid" or "duplicate" (nothing written).
   */
  async function saveQuiz(rawQuiz) {
    let quiz;
    try { quiz = parseStorableQuiz(rawQuiz); } catch (err) { throw mapError(err, "Could not save the quiz."); }
    const record = { id: quiz.quiz_id, schemaVersion: SCHEMA_VERSION, savedAt: clock(), quiz };
    await runTransaction([QUIZZES_STORE], "readwrite", (ctx) => {
      ctx.track(ctx.store(QUIZZES_STORE).add(record));
      ctx.done(undefined);
    }, "Could not save the quiz.");
    return plain(quiz);
  }

  /**
   * Starts an attempt on a new quiz and makes it the active one, atomically.
   *
   * `expectedActiveAttemptId` is what getActiveAttempt() last reported for this video (null when
   * there was no active attempt). If the pointer changed since, nothing is written ("conflict").
   * A readable in-progress attempt is set aside as "abandoned" (its answers kept) IN THE SAME
   * transaction as the new quiz and attempt, so if the new quiz can not be stored the old attempt
   * stays active and untouched. An unreadable or newer-version attempt is never modified; only the
   * pointer moves.
   *
   * Resolves { attempt, quiz, abandonedAttemptId }.
   */
  async function startAttempt({ quiz: rawQuiz, quizMode, expectedActiveAttemptId = null } = {}) {
    let quiz;
    let responses;
    try {
      quiz = parseStorableQuiz(rawQuiz);
      if (!QUIZ_MODES.includes(quizMode)) throw storeError("invalid");
      if (expectedActiveAttemptId !== null && typeof expectedActiveAttemptId !== "string") throw storeError("invalid");
      responses = validateResponses(quiz, quizMode, {});
    } catch (err) {
      throw mapError(err, "Could not start the practice.");
    }
    const now = clock();
    const attemptId = requireAttemptId(newId());
    const attemptRecord = {
      id: attemptId, schemaVersion: SCHEMA_VERSION, quizId: quiz.quiz_id, videoId: quiz.video_id, quizMode,
      status: "in_progress", rev: 0, startedAt: now, updatedAt: now, submittedAt: null, abandonedAt: null,
      currentIndex: 0, responses, result: null,
    };
    const quizRecord = { id: quiz.quiz_id, schemaVersion: SCHEMA_VERSION, savedAt: now, quiz };

    return runTransaction([QUIZZES_STORE, ATTEMPTS_STORE, ACTIVE_STORE], "readwrite", (ctx) => {
      ctx.read(ctx.store(ACTIVE_STORE).get(quiz.video_id), (rawPointer) => {
        const pointer = readPointer(rawPointer);
        if (pointer.kind === "unsupported") return ctx.fail(storeError("unsupported_version"));
        if (pointerToken(pointer) !== expectedActiveAttemptId) return ctx.fail(storeError("conflict"));

        const finish = (abandonedAttemptId) => {
          ctx.track(ctx.store(QUIZZES_STORE).add(quizRecord));
          ctx.track(ctx.store(ATTEMPTS_STORE).add(attemptRecord));
          ctx.track(ctx.store(ACTIVE_STORE).put({
            id: quiz.video_id, schemaVersion: SCHEMA_VERSION, attemptId, rev: (pointer.kind === "valid" ? pointer.rev : 0) + 1,
          }));
          ctx.done({ attempt: plain(attemptRecord), quiz: plain(quiz), abandonedAttemptId });
        };
        if (pointer.kind !== "valid") return finish(null);

        ctx.read(ctx.store(ATTEMPTS_STORE).get(pointer.attemptId), (rawAttempt) => {
          if (!rawAttempt) return finish(null); // dangling pointer: nothing to set aside
          const quizId = typeof rawAttempt.quizId === "string" ? rawAttempt.quizId : null;
          const setAside = (rawOldQuiz) => {
            const found = resolveAttempt(rawAttempt, rawOldQuiz);
            if (!found.ok || found.attempt.status !== "in_progress") return finish(null); // left exactly as it is
            const old = found.attempt;
            ctx.track(ctx.store(ATTEMPTS_STORE).put({
              ...old, status: "abandoned", abandonedAt: touched(old), updatedAt: touched(old), rev: old.rev + 1,
            }));
            finish(old.id);
          };
          if (quizId === null) return setAside(undefined);
          ctx.read(ctx.store(QUIZZES_STORE).get(quizId), setAside);
        });
      });
    }, "Could not start the practice.");
  }

  function checkWrite({ attemptId, expectedRev }) {
    requireAttemptId(attemptId);
    if (!isInt(expectedRev)) throw storeError("invalid");
  }

  // Validates a progress snapshot against the stored attempt; throws storeError("invalid").
  function nextProgress(found, { currentIndex, responses }) {
    const { attempt, quiz } = found;
    try {
      const index = currentIndex === undefined ? attempt.currentIndex : currentIndex;
      if (!Number.isInteger(index) || index < 0 || index >= quiz.questions.length) throw storeError("invalid");
      const next = responses === undefined ? attempt.responses : validateResponses(quiz, attempt.quizMode, responses, attempt.responses);
      return { currentIndex: index, responses: next };
    } catch (err) {
      throw mapError(err, "Could not save your progress.");
    }
  }

  /**
   * Autosave: stores the current question and the answers, if the attempt is still at revision
   * `expectedRev`. Resolves with the new attempt (rev + 1). Rejects "conflict" (changed elsewhere),
   * "not_in_progress", "not_found", "corrupt", "unsupported_version" or "invalid" (nothing written).
   * Facts already recorded can not be erased: a first-checked answer never changes and hints used
   * never decrease. Assessment attempts can hold no checks and no hints.
   */
  async function saveProgress({ attemptId, expectedRev, currentIndex, responses } = {}) {
    try { checkWrite({ attemptId, expectedRev }); } catch (err) { throw mapError(err, "Could not save your progress."); }
    return runTransaction([ATTEMPTS_STORE, QUIZZES_STORE], "readwrite", (ctx) => {
      loadForWrite(ctx, attemptId, (found) => {
        if (found.attempt.rev !== expectedRev) return ctx.fail(storeError("conflict"));
        if (found.attempt.status !== "in_progress") return ctx.fail(storeError("not_in_progress"));
        const progress = nextProgress(found, { currentIndex, responses });
        const next = { ...found.attempt, ...progress, updatedAt: touched(found.attempt), rev: found.attempt.rev + 1 };
        ctx.track(ctx.store(ATTEMPTS_STORE).put(next));
        ctx.done(plain(next));
      });
    }, "Could not save your progress.");
  }

  // Shared by submit and abandon: write the new attempt, then clear the pointer only if it still
  // names this attempt (otherwise another attempt is active and must stay so).
  function finishWith(ctx, next) {
    ctx.track(ctx.store(ATTEMPTS_STORE).put(next));
    ctx.read(ctx.store(ACTIVE_STORE).get(next.videoId), (rawPointer) => {
      const pointer = readPointer(rawPointer);
      if (pointer.kind === "valid" && pointer.attemptId === next.id) ctx.track(ctx.store(ACTIVE_STORE).delete(next.videoId));
      ctx.done(plain(next));
    });
  }

  /**
   * Submits an attempt (Assessment "Submit" or Practice "Finish"): optional final answers, the
   * result, and the cleared pointer are one transaction. The cached `result` is recomputed from the
   * responses here; display code recomputes it again and never trusts it.
   */
  async function submitAttempt({ attemptId, expectedRev, currentIndex, responses } = {}) {
    try { checkWrite({ attemptId, expectedRev }); } catch (err) { throw mapError(err, "Could not submit your practice."); }
    return runTransaction([ATTEMPTS_STORE, QUIZZES_STORE, ACTIVE_STORE], "readwrite", (ctx) => {
      loadForWrite(ctx, attemptId, (found) => {
        if (found.attempt.rev !== expectedRev) return ctx.fail(storeError("conflict"));
        if (found.attempt.status !== "in_progress") return ctx.fail(storeError("not_in_progress"));
        const progress = nextProgress(found, { currentIndex, responses });
        const now = touched(found.attempt);
        finishWith(ctx, {
          ...found.attempt, ...progress, status: "submitted", submittedAt: now, updatedAt: now, rev: found.attempt.rev + 1,
          result: buildResult(found.quiz, found.attempt.quizMode, progress.responses, now),
        });
      });
    }, "Could not submit your practice.");
  }

  /** Marks an in-progress attempt abandoned (its answers are kept) and clears the pointer if it names it. */
  async function abandonAttempt({ attemptId, expectedRev } = {}) {
    try { checkWrite({ attemptId, expectedRev }); } catch (err) { throw mapError(err, "Could not set the practice aside."); }
    return runTransaction([ATTEMPTS_STORE, QUIZZES_STORE, ACTIVE_STORE], "readwrite", (ctx) => {
      loadForWrite(ctx, attemptId, (found) => {
        if (found.attempt.rev !== expectedRev) return ctx.fail(storeError("conflict"));
        if (found.attempt.status !== "in_progress") return ctx.fail(storeError("not_in_progress"));
        const now = touched(found.attempt);
        finishWith(ctx, { ...found.attempt, status: "abandoned", abandonedAt: now, updatedAt: now, rev: found.attempt.rev + 1 });
      });
    }, "Could not set the practice aside.");
  }

  /* ── Reads (never throw for bad data) ──────────────────────────────────── */

  /**
   * The in-progress attempt for a video, for resume.
   *   { state: "none", activeAttemptId: null }
   *   { state: "ready", activeAttemptId, attempt, quiz, progress }
   *   { state: "unreadable", activeAttemptId, reason }   reason: corrupt | unsupported_version | not_in_progress
   * `activeAttemptId` is what to pass back as `expectedActiveAttemptId` to startAttempt().
   */
  async function getActiveAttempt(videoId) {
    if (typeof videoId !== "string" || videoId === "") throw storeError("invalid");
    return runTransaction([ACTIVE_STORE, ATTEMPTS_STORE, QUIZZES_STORE], "readonly", (ctx) => {
      ctx.read(ctx.store(ACTIVE_STORE).get(videoId), (rawPointer) => {
        const pointer = readPointer(rawPointer);
        if (pointer.kind === "none") return ctx.done({ state: "none", activeAttemptId: null });
        if (pointer.kind !== "valid") {
          return ctx.done({ state: "unreadable", activeAttemptId: pointerToken(pointer), reason: pointer.kind === "unsupported" ? "unsupported_version" : "corrupt" });
        }
        const unreadable = (reason) => ctx.done({ state: "unreadable", activeAttemptId: pointer.attemptId, reason });
        ctx.read(ctx.store(ATTEMPTS_STORE).get(pointer.attemptId), (rawAttempt) => {
          const quizId = rawAttempt && typeof rawAttempt.quizId === "string" ? rawAttempt.quizId : null;
          const withQuiz = (rawQuiz) => {
            const found = resolveAttempt(rawAttempt, rawQuiz);
            if (!found.ok) return unreadable(found.reason === "not_found" ? "corrupt" : found.reason);
            if (found.attempt.status !== "in_progress" || found.attempt.videoId !== videoId) return unreadable("not_in_progress");
            const { attempt, quiz, progress } = describe(found);
            ctx.done({ state: "ready", activeAttemptId: attempt.id, attempt, quiz, progress });
          };
          if (quizId === null) return withQuiz(undefined);
          ctx.read(ctx.store(QUIZZES_STORE).get(quizId), withQuiz);
        });
      });
    }, "Could not read your saved practice.");
  }

  /** One attempt with its quiz: { ok: true, attempt, quiz, progress, score? } or { ok: false, reason }. */
  async function loadAttempt(attemptId) {
    requireAttemptId(attemptId);
    return runTransaction([ATTEMPTS_STORE, QUIZZES_STORE], "readonly", (ctx) => {
      ctx.read(ctx.store(ATTEMPTS_STORE).get(attemptId), (rawAttempt) => {
        const quizId = rawAttempt && typeof rawAttempt.quizId === "string" ? rawAttempt.quizId : null;
        const withQuiz = (rawQuiz) => {
          const found = resolveAttempt(rawAttempt, rawQuiz);
          ctx.done(found.ok ? describe(found) : { ok: false, reason: found.reason });
        };
        if (quizId === null) return withQuiz(undefined);
        ctx.read(ctx.store(QUIZZES_STORE).get(quizId), withQuiz);
      });
    }, "Could not read the saved practice.");
  }

  /** One quiz: { ok: true, quiz } or { ok: false, reason: not_found | corrupt | unsupported_version }. */
  async function getQuiz(quizId) {
    if (typeof quizId !== "string" || quizId === "") throw storeError("invalid");
    return runTransaction([QUIZZES_STORE], "readonly", (ctx) => {
      ctx.read(ctx.store(QUIZZES_STORE).get(quizId), (raw) => {
        if (raw === undefined || raw === null) return ctx.done({ ok: false, reason: "not_found" });
        try {
          ctx.done({ ok: true, quiz: validateQuizRecord(raw).quiz });
        } catch (err) {
          ctx.done({ ok: false, reason: err.reason === "unsupported_version" ? "unsupported_version" : "corrupt" });
        }
      });
    }, "Could not read the saved quiz.");
  }

  /**
   * Every readable attempt for a video, newest first, each with its quiz, progress and (when
   * submitted) a freshly computed score. Unreadable records are skipped, never modified:
   * `skipped` counts corrupt ones and `unsupported` counts newer-version ones.
   */
  async function listAttemptsForVideo(videoId) {
    if (typeof videoId !== "string" || videoId === "") throw storeError("invalid");
    return runTransaction([ATTEMPTS_STORE, QUIZZES_STORE], "readonly", (ctx) => {
      ctx.read(ctx.store(ATTEMPTS_STORE).getAll(), (rawAttempts) => {
        ctx.read(ctx.store(QUIZZES_STORE).getAll(), (rawQuizzes) => {
          const quizzes = new Map((rawQuizzes || []).filter((q) => q && typeof q.id === "string").map((q) => [q.id, q]));
          const attempts = [];
          let skipped = 0;
          let unsupported = 0;
          for (const raw of rawAttempts || []) {
            if (!raw || raw.videoId !== videoId) continue;
            const found = resolveAttempt(raw, quizzes.get(raw.quizId));
            if (found.ok) attempts.push(describe(found));
            else if (found.reason === "unsupported_version") unsupported++;
            else skipped++;
          }
          attempts.sort(newestFirst);
          ctx.done({ attempts, skipped, unsupported });
        });
      });
    }, "Could not read the saved practice.");
  }

  /** Every readable quiz generated for a video, newest first; unreadable ones are counted, not returned. */
  async function listQuizzesForVideo(videoId) {
    if (typeof videoId !== "string" || videoId === "") throw storeError("invalid");
    return runTransaction([QUIZZES_STORE], "readonly", (ctx) => {
      ctx.read(ctx.store(QUIZZES_STORE).getAll(), (rawQuizzes) => {
        const quizzes = [];
        let skipped = 0;
        let unsupported = 0;
        for (const raw of rawQuizzes || []) {
          try {
            const { quiz, savedAt } = validateQuizRecord(raw);
            if (quiz.video_id === videoId) quizzes.push({ quiz, savedAt });
          } catch (err) {
            if (raw && raw.quiz && raw.quiz.video_id === videoId) {
              if (err.reason === "unsupported_version") unsupported++;
              else skipped++;
            }
          }
        }
        quizzes.sort((a, b) => b.savedAt - a.savedAt || (a.quiz.quiz_id < b.quiz.quiz_id ? 1 : -1));
        ctx.done({ quizzes, skipped, unsupported });
      });
    }, "Could not read the saved quizzes.");
  }

  /** Closes the connection (tests, or before deleting the database). */
  async function close() {
    const p = dbPromise;
    dbPromise = null;
    if (p) { try { (await p).close(); } catch { /* never opened */ } }
  }

  return {
    saveQuiz, startAttempt, saveProgress, submitAttempt, abandonAttempt,
    getActiveAttempt, loadAttempt, getQuiz, listAttemptsForVideo, listQuizzesForVideo,
    requestPersistence, close,
  };
}

/* ── Default instance (created on first use, so importing this module is safe where IndexedDB does not exist) ── */

let defaultStore = null;
const store = () => (defaultStore ??= createQuizStore());

export const saveQuiz = (quiz) => store().saveQuiz(quiz);
export const startAttempt = (args) => store().startAttempt(args);
export const saveProgress = (args) => store().saveProgress(args);
export const submitAttempt = (args) => store().submitAttempt(args);
export const abandonAttempt = (args) => store().abandonAttempt(args);
export const getActiveAttempt = (videoId) => store().getActiveAttempt(videoId);
export const loadAttempt = (attemptId) => store().loadAttempt(attemptId);
export const getQuiz = (quizId) => store().getQuiz(quizId);
export const listAttemptsForVideo = (videoId) => store().listAttemptsForVideo(videoId);
export const listQuizzesForVideo = (videoId) => store().listQuizzesForVideo(videoId);
export const requestPersistence = () => store().requestPersistence();
