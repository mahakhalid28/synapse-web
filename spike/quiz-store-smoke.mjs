// Runs inside the Electron page (real Chromium IndexedDB). See quiz-store-smoke-main.cjs.
// Phase "write": exercise the store, then leave known data behind.
// Phase "read": after a REAL app restart, check that data survived and is still valid.

import {
  ACTIVE_STORE, ATTEMPTS_STORE, DB_NAME, DB_VERSION, QUIZZES_STORE, createQuizStore,
} from "../src/lib/quizStore.js";
import { emptyResponse } from "../src/lib/quizSchema.js";
import { makeQuiz, secondQuiz, insufficientQuiz } from "../src/test/quizFixtures.js";

const phase = new URLSearchParams(location.search).get("phase");
const results = [];
const info = {};
const VIDEO = "5ugDJhmmkFM";
const RESTART_VIDEO = "aircAruvnKk";
const RESTART_QUIZ_ID = "aaaaaaaa-1111-4222-8333-444444444444";

async function check(name, fn) {
  try {
    const outcome = await fn();
    results.push({ name, ok: outcome === true, detail: outcome === true ? "" : String(outcome) });
  } catch (err) {
    results.push({ name, ok: false, detail: `threw ${err && (err.code || err.name)}: ${err && err.message}` });
  }
}

// Equality that ignores key order (the store returns normalised objects).
const canon = (v) => (Array.isArray(v) ? v.map(canon)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const res = (over = {}) => ({ ...emptyResponse(), ...over });
const failedWith = async (promise) => { try { await promise; return null; } catch (e) { return e.code; } };

let ids = 0;
const newStore = (extra = {}) => createQuizStore({ newId: () => `smoke-${phase}-${++ids}`, ...extra });

// Raw access to the same real database, to inspect and to plant corrupt records.
function openRaw() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function rawAll(storeName) {
  const db = await openRaw();
  const out = await new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], "readonly");
    const request = tx.objectStore(storeName).getAll();
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
  return out;
}
async function rawPut(storeName, value) {
  const db = await openRaw();
  await new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

async function writePhase() {
  const store = newStore();

  await check("database has three stores keyed by id, version 1", async () => {
    await store.getActiveAttempt(VIDEO);
    const db = await openRaw();
    const names = [...db.objectStoreNames].sort();
    const keyPaths = names.map((n) => db.transaction([n]).objectStore(n).keyPath);
    const version = db.version;
    db.close();
    return same(names, [ACTIVE_STORE, ATTEMPTS_STORE, QUIZZES_STORE].sort()) && keyPaths.every((k) => k === "id") && version === 1 || `${names} ${keyPaths} v${version}`;
  });

  let first;
  await check("start an attempt: quiz, attempt and pointer are saved together", async () => {
    first = (await store.startAttempt({ quiz: makeQuiz(), quizMode: "practice" })).attempt;
    const [quizzes, attempts, active] = await Promise.all([rawAll(QUIZZES_STORE), rawAll(ATTEMPTS_STORE), rawAll(ACTIVE_STORE)]);
    return (quizzes.length === 1 && attempts.length === 1 && active.length === 1 && active[0].attemptId === first.id) || "unexpected store contents";
  });

  await check("immutable quiz: saving the same quiz id again is a duplicate and changes nothing", async () => {
    const before = JSON.stringify(await rawAll(QUIZZES_STORE));
    const altered = makeQuiz();
    altered.questions[0].prompt = "Changed prompt that must not be stored?";
    const code = await failedWith(store.saveQuiz(altered));
    return (code === "duplicate" && JSON.stringify(await rawAll(QUIZZES_STORE)) === before) || `code ${code}`;
  });

  await check("20 concurrent autosaves at one revision: exactly one wins", async () => {
    const outcomes = await Promise.allSettled(Array.from({ length: 20 }, (_, i) =>
      store.saveProgress({ attemptId: first.id, expectedRev: 0, currentIndex: i % 6 })));
    const won = outcomes.filter((o) => o.status === "fulfilled").length;
    const conflicts = outcomes.filter((o) => o.status === "rejected" && o.reason.code === "conflict").length;
    const stored = (await rawAll(ATTEMPTS_STORE))[0];
    return (won === 1 && conflicts === 19 && stored.rev === 1) || `won ${won}, conflicts ${conflicts}, rev ${stored.rev}`;
  });

  await check("a failed replacement (duplicate quiz) leaves the old attempt active and unchanged", async () => {
    const before = JSON.stringify([await rawAll(ATTEMPTS_STORE), await rawAll(ACTIVE_STORE), await rawAll(QUIZZES_STORE)]);
    const code = await failedWith(store.startAttempt({ quiz: makeQuiz(), quizMode: "practice", expectedActiveAttemptId: first.id }));
    const after = JSON.stringify([await rawAll(ATTEMPTS_STORE), await rawAll(ACTIVE_STORE), await rawAll(QUIZZES_STORE)]);
    return (code === "duplicate" && before === after) || `code ${code}, changed ${before !== after}`;
  });

  await check("a stale 'start new' (wrong expected attempt) is a conflict and changes nothing", async () => {
    const before = JSON.stringify([await rawAll(ATTEMPTS_STORE), await rawAll(ACTIVE_STORE)]);
    const code = await failedWith(store.startAttempt({ quiz: secondQuiz(), quizMode: "practice", expectedActiveAttemptId: null }));
    return (code === "conflict" && before === JSON.stringify([await rawAll(ATTEMPTS_STORE), await rawAll(ACTIVE_STORE)])) || `code ${code}`;
  });

  await check("two connections starting the first quiz together: one attempt, one in progress", async () => {
    const other = createQuizStore({ newId: () => `smoke-${phase}-other` });
    const outcomes = await Promise.allSettled([
      store.startAttempt({ quiz: makeQuiz({ video_id: "bbbbbbbbbbb", quiz_id: "bbbbbbbb-1111-4222-8333-444444444444" }), quizMode: "practice" }),
      other.startAttempt({ quiz: makeQuiz({ video_id: "bbbbbbbbbbb", quiz_id: "bbbbbbbb-2222-4222-8333-444444444444" }), quizMode: "practice" }),
    ]);
    await other.close();
    const attempts = (await rawAll(ATTEMPTS_STORE)).filter((a) => a.videoId === "bbbbbbbbbbb");
    const won = outcomes.filter((o) => o.status === "fulfilled").length;
    const quizzes = (await rawAll(QUIZZES_STORE)).filter((q) => q.quiz.video_id === "bbbbbbbbbbb");
    return (won === 1 && attempts.length === 1 && quizzes.length === 1) || `won ${won}, attempts ${attempts.length}, quizzes ${quizzes.length}`;
  });

  await check("'start new' sets the old attempt aside, keeping its answers, in one step", async () => {
    await store.saveProgress({ attemptId: first.id, expectedRev: 1, currentIndex: 2, responses: { q1: res({ choiceId: "a", firstCheckedChoiceId: "a", lastCheckedChoiceId: "a", hintsUsed: 2 }) } });
    const replaced = await store.startAttempt({ quiz: secondQuiz(), quizMode: "assessment", expectedActiveAttemptId: first.id });
    const attempts = (await rawAll(ATTEMPTS_STORE)).filter((a) => a.videoId === VIDEO);
    const old = attempts.find((a) => a.id === first.id);
    return (replaced.abandonedAttemptId === first.id && old.status === "abandoned" && old.responses.q1.hintsUsed === 2
      && attempts.filter((a) => a.status === "in_progress").length === 1) || "old attempt not set aside correctly";
  });

  await check("submit racing 'start new': exactly one wins and the pointer stays valid", async () => {
    const active = await store.getActiveAttempt(VIDEO);
    const id = active.attempt.id;
    const outcomes = await Promise.allSettled([
      store.submitAttempt({ attemptId: id, expectedRev: active.attempt.rev }),
      store.startAttempt({ quiz: makeQuiz({ quiz_id: "cccccccc-1111-4222-8333-444444444444" }), quizMode: "practice", expectedActiveAttemptId: id }),
    ]);
    const attempts = (await rawAll(ATTEMPTS_STORE)).filter((a) => a.videoId === VIDEO);
    const pointer = (await rawAll(ACTIVE_STORE)).find((p) => p.id === VIDEO);
    const inProgress = attempts.filter((a) => a.status === "in_progress");
    const consistent = pointer ? inProgress.length === 1 && inProgress[0].id === pointer.attemptId : inProgress.length === 0;
    return (outcomes.filter((o) => o.status === "fulfilled").length === 1 && consistent) || `fulfilled ${outcomes.filter((o) => o.status === "fulfilled").length}, consistent ${consistent}`;
  });

  await check("submit recomputes the score and a tampered cached result is ignored on read", async () => {
    const quiz = makeQuiz({ video_id: "ddddddddddd", quiz_id: "dddddddd-1111-4222-8333-444444444444" });
    const { attempt } = await store.startAttempt({ quiz, quizMode: "assessment" });
    const done = await store.submitAttempt({ attemptId: attempt.id, expectedRev: 0, responses: { q1: res({ choiceId: "b" }), q2: res({ choiceId: "false" }) } });
    const record = (await rawAll(ATTEMPTS_STORE)).find((a) => a.id === attempt.id);
    await rawPut(ATTEMPTS_STORE, { ...record, result: { ...record.result, correct: 6, incorrect: 0, unanswered: 0 } });
    const loaded = await store.loadAttempt(attempt.id);
    return (done.result.correct === 1 && done.result.incorrect === 1 && loaded.ok && loaded.score.correct === 1 && loaded.score.incorrect === 1) || JSON.stringify(loaded.score);
  });

  await check("a corrupt attempt is reported unreadable, skipped in lists, refused for writes, and left untouched", async () => {
    const { attempt } = await store.startAttempt({ quiz: makeQuiz({ video_id: "eeeeeeeeeee", quiz_id: "eeeeeeee-1111-4222-8333-444444444444" }), quizMode: "practice" });
    const record = (await rawAll(ATTEMPTS_STORE)).find((a) => a.id === attempt.id);
    const broken = { ...record, currentIndex: 99 };
    await rawPut(ATTEMPTS_STORE, broken);
    const view = await store.getActiveAttempt("eeeeeeeeeee");
    const listed = await store.listAttemptsForVideo("eeeeeeeeeee");
    const code = await failedWith(store.saveProgress({ attemptId: attempt.id, expectedRev: 0 }));
    const after = (await rawAll(ATTEMPTS_STORE)).find((a) => a.id === attempt.id);
    return (view.state === "unreadable" && view.reason === "corrupt" && listed.attempts.length === 0 && listed.skipped === 1
      && code === "corrupt" && same(after, broken)) || `${view.state}/${view.reason} skipped ${listed.skipped} code ${code}`;
  });

  await check("a record from a newer schema version is unsupported and never overwritten", async () => {
    const { attempt } = await store.startAttempt({ quiz: makeQuiz({ video_id: "fffffffffff", quiz_id: "ffffffff-1111-4222-8333-444444444444" }), quizMode: "practice" });
    const record = (await rawAll(ATTEMPTS_STORE)).find((a) => a.id === attempt.id);
    const future = { ...record, schemaVersion: 2, futureField: { keep: "me" } };
    await rawPut(ATTEMPTS_STORE, future);
    const code = await failedWith(store.submitAttempt({ attemptId: attempt.id, expectedRev: 0 }));
    const listed = await store.listAttemptsForVideo("fffffffffff");
    const after = (await rawAll(ATTEMPTS_STORE)).find((a) => a.id === attempt.id);
    return (code === "unsupported_version" && listed.unsupported === 1 && same(after, future)) || `code ${code}`;
  });

  await check("invalid input is rejected before anything is written", async () => {
    const before = JSON.stringify(await rawAll(QUIZZES_STORE));
    const shortAnswer = makeQuiz({ quiz_id: "99999999-1111-4222-8333-444444444444" });
    shortAnswer.questions[0] = { ...shortAnswer.questions[0], type: "short" };
    const codes = await Promise.all([store.saveQuiz(shortAnswer), store.saveQuiz(insufficientQuiz()), store.startAttempt({ quiz: null, quizMode: "practice" })].map(failedWith));
    return (codes.every((c) => c === "invalid") && JSON.stringify(await rawAll(QUIZZES_STORE)) === before) || codes.join(",");
  });

  // Leave data for the restart phase: an in-progress Practice attempt with real answers.
  await check("leave an in-progress attempt behind for the restart check", async () => {
    const quiz = makeQuiz({ video_id: RESTART_VIDEO, quiz_id: RESTART_QUIZ_ID });
    const { attempt } = await store.startAttempt({ quiz, quizMode: "practice" });
    await store.saveProgress({
      attemptId: attempt.id, expectedRev: 0, currentIndex: 3,
      responses: {
        q1: res({ choiceId: "a", firstCheckedChoiceId: "a", lastCheckedChoiceId: "b", hintsUsed: 2 }),
        q2: res({ choiceId: "false", flagged: true }),
      },
    });
    return true;
  });

  info.persist = await store.requestPersistence(); // best effort; false is acceptable and is reported, not asserted
  await store.close();
}

async function readPhase() {
  const store = newStore();
  await check("after a real restart the database is still version 1 with its three stores", async () => {
    await store.getActiveAttempt(RESTART_VIDEO);
    const db = await openRaw();
    const names = [...db.objectStoreNames].sort();
    db.close();
    return same(names, [ACTIVE_STORE, ATTEMPTS_STORE, QUIZZES_STORE].sort()) || names.join(",");
  });

  await check("the in-progress attempt resumes with exactly the saved position and answers", async () => {
    const view = await store.getActiveAttempt(RESTART_VIDEO);
    if (view.state !== "ready") return `state ${view.state} ${view.reason}`;
    const r = view.attempt.responses;
    return (view.attempt.rev === 1 && view.attempt.currentIndex === 3 && view.attempt.quizMode === "practice"
      && same(r.q1, { choiceId: "a", firstCheckedChoiceId: "a", lastCheckedChoiceId: "b", hintsUsed: 2, flagged: false })
      && r.q2.choiceId === "false" && r.q2.flagged === true && same(view.quiz, makeQuiz({ video_id: RESTART_VIDEO, quiz_id: RESTART_QUIZ_ID }))
      && view.progress.selected === 2 && view.progress.hintsUsed === 2) || JSON.stringify(view.progress);
  });

  await check("it can be saved to again at the right revision, and submitted", async () => {
    const view = await store.getActiveAttempt(RESTART_VIDEO);
    const saved = await store.saveProgress({ attemptId: view.attempt.id, expectedRev: view.attempt.rev, currentIndex: 4 });
    const done = await store.submitAttempt({ attemptId: view.attempt.id, expectedRev: saved.rev });
    return (saved.rev === 2 && done.status === "submitted" && (await store.getActiveAttempt(RESTART_VIDEO)).state === "none") || "save/submit failed";
  });

  await check("set-aside, submitted and unreadable records from before the restart are still where they were", async () => {
    const main = await store.listAttemptsForVideo(VIDEO);
    const statuses = main.attempts.map((a) => a.attempt.status).sort();
    const corrupt = await store.listAttemptsForVideo("eeeeeeeeeee");
    const future = await store.listAttemptsForVideo("fffffffffff");
    return (statuses.includes("abandoned") && corrupt.skipped === 1 && future.unsupported === 1) || `${statuses} ${corrupt.skipped} ${future.unsupported}`;
  });

  info.persisted = await (navigator.storage && navigator.storage.persisted ? navigator.storage.persisted() : false);
  await store.close();
}

try {
  if (phase === "write") await writePhase();
  else if (phase === "read") await readPhase();
  else throw new Error(`unknown phase ${phase}`);
  window.__smoke = { results, info };
} catch (err) {
  window.__smoke = { results, info, fatal: String(err && (err.stack || err.message)) };
}
