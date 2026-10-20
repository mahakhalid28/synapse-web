// quizStore against the project's in-memory IndexedDB stand-in (src/test/fakeIndexedDb.js).
// These tests check the module's LOGIC: atomic multi-store writes, revision checks, safe replacement,
// validation of stored data. They do NOT show real-browser behaviour (quota, durability, crash safety,
// several processes); spike/quiz-store-smoke-main.cjs runs the same store on real IndexedDB in Electron.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ACTIVE_STORE, ATTEMPTS_STORE, CORRUPT_POINTER, DB_NAME, DB_VERSION, QUIZZES_STORE, QuizStoreError, createQuizStore,
  newAttemptId, startAttempt as defaultStartAttempt,
} from "./quizStore.js";
import { emptyResponse } from "./quizSchema.js";
import { createFakeIndexedDB } from "../test/fakeIndexedDb.js";
import { QUIZ_ID, VIDEO_ID, OTHER_VIDEO_ID, deepCopy, insufficientQuiz, makeQuiz, partialQuiz, secondQuiz } from "../test/quizFixtures.js";

let fake;
let store;
let now;
let counter;

const makeStore = (options = {}) => createQuizStore({
  indexedDB: fake.factory, storage: undefined, clock: () => (now += 10), newId: () => `attempt-${String((counter += 1)).padStart(4, "0")}`, ...options,
});

beforeEach(() => {
  fake = createFakeIndexedDB();
  now = 1_700_000_000_000;
  counter = 0;
  store = makeStore();
});
afterEach(async () => { await store.close(); });

const rejection = async (promise) => {
  try { await promise; } catch (e) { return e; }
  throw new Error("expected the promise to reject");
};
const code = async (promise) => {
  const error = await rejection(promise);
  expect(error).toBeInstanceOf(QuizStoreError); // every failure is a typed error with a stable code
  return error.code;
};
const res = (over = {}) => ({ ...emptyResponse(), ...over });
const stored = (name) => fake.records(DB_NAME, name);
const snapshot = () => deepCopy({ quizzes: stored(QUIZZES_STORE), attempts: stored(ATTEMPTS_STORE), active: stored(ACTIVE_STORE) });

// Writes a raw record, bypassing the store, to set up corrupt or newer-version data.
async function rawPut(storeName, value) {
  const db = await new Promise((resolve, reject) => {
    const request = fake.factory.open(DB_NAME, DB_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}
const tamper = async (storeName, id, change) => {
  const record = deepCopy(stored(storeName).find((r) => r.id === id));
  await rawPut(storeName, change(record) ?? record);
};

// Start a practice attempt on the standard quiz and return it.
const begin = async (over = {}) => (await store.startAttempt({ quiz: makeQuiz(), quizMode: "practice", ...over })).attempt;

describe("schema and setup", () => {
  it("creates one versioned database with three stores, all keyed by id", async () => {
    await store.getActiveAttempt(VIDEO_ID);
    expect(DB_NAME).toBe("synapse_quiz");
    expect(fake.version(DB_NAME)).toBe(DB_VERSION);
    expect(fake.storeNames(DB_NAME).sort()).toEqual([ACTIVE_STORE, ATTEMPTS_STORE, QUIZZES_STORE].sort());
    for (const name of [ACTIVE_STORE, ATTEMPTS_STORE, QUIZZES_STORE]) expect(fake.keyPath(DB_NAME, name)).toBe("id");
  });

  it("is a separate database from Voice Notes and opens once", async () => {
    await store.getActiveAttempt(VIDEO_ID);
    await begin();
    await store.getActiveAttempt(VIDEO_ID);
    expect(fake.log.opens).toBe(1);
    expect(fake.storeNames("synapse_voice_notes")).toEqual([]);
  });

  it("exposes no delete API: set-aside attempts are kept", () => {
    expect(Object.keys(store).filter((k) => /delete|remove|clear|prune/i.test(k))).toEqual([]);
  });

  it("requests persistent storage once, best effort, and never fails because of it", async () => {
    const calls = [];
    const storage = { persisted: async () => false, persist: async () => { calls.push("persist"); return true; } };
    const withStorage = makeStore({ storage });
    await withStorage.getActiveAttempt(VIDEO_ID);
    await withStorage.getActiveAttempt(VIDEO_ID);
    expect(await withStorage.requestPersistence()).toBe(true);
    expect(calls).toEqual(["persist"]);
    const broken = makeStore({ storage: { persist: async () => { throw new Error("denied"); } } });
    expect(await broken.requestPersistence()).toBe(false);
    expect((await broken.startAttempt({ quiz: makeQuiz(), quizMode: "practice" })).attempt.rev).toBe(0);
    await withStorage.close();
    await broken.close();
  });

  it("reports 'unavailable' where there is no IndexedDB", async () => {
    const none = createQuizStore({ indexedDB: undefined, storage: undefined });
    expect(await code(none.getActiveAttempt(VIDEO_ID))).toBe("unavailable");
    expect(await code(none.startAttempt({ quiz: makeQuiz(), quizMode: "practice" }))).toBe("unavailable");
  });

  it("generates unique attempt ids by default", () => {
    expect(new Set(Array.from({ length: 50 }, newAttemptId)).size).toBe(50);
    expect(typeof defaultStartAttempt).toBe("function");
  });
});

describe("saving a quiz", () => {
  it("stores a validated copy and reads it back", async () => {
    const saved = await store.saveQuiz(makeQuiz());
    expect(saved).toEqual(makeQuiz());
    expect(await store.getQuiz(QUIZ_ID)).toEqual({ ok: true, quiz: makeQuiz() });
    expect(stored(QUIZZES_STORE)[0]).toMatchObject({ id: QUIZ_ID, schemaVersion: 1 });
  });

  it("is immutable: saving the same id again is rejected and the original is unchanged", async () => {
    await store.saveQuiz(makeQuiz());
    const before = snapshot();
    const changed = makeQuiz();
    changed.questions[0].prompt = "A different prompt entirely?";
    expect(await code(store.saveQuiz(changed))).toBe("duplicate");
    expect(snapshot()).toEqual(before);
    expect((await store.getQuiz(QUIZ_ID)).quiz.questions[0].prompt).not.toBe("A different prompt entirely?");
  });

  it("does not let the caller change a saved quiz through the objects it passed or received", async () => {
    const input = makeQuiz();
    const returned = await store.saveQuiz(input);
    input.questions[0].prompt = "mutated input";
    returned.questions[0].prompt = "mutated return";
    const read = await store.getQuiz(QUIZ_ID);
    read.quiz.questions[0].prompt = "mutated read";
    expect((await store.getQuiz(QUIZ_ID)).quiz.questions[0].prompt).toBe(makeQuiz().questions[0].prompt);
  });

  it("rejects invalid responses and unsupported question types without writing anything", async () => {
    const shortAnswer = makeQuiz();
    shortAnswer.questions[0] = { ...shortAnswer.questions[0], type: "short" };
    const badKey = makeQuiz();
    badKey.questions[0].correct_choice_id = "z";
    const badChoices = makeQuiz();
    badChoices.questions[2].choices = badChoices.questions[2].choices.slice(0, 2);
    const moment = makeQuiz();
    moment.questions[0].evidence[0] = { ...moment.questions[0].evidence[0], kind: "moment" };
    for (const bad of [shortAnswer, badKey, badChoices, moment, insufficientQuiz(), null, "x", { ...makeQuiz(), contract_version: 2 }]) {
      expect(await code(store.saveQuiz(bad))).toBe("invalid");
    }
    expect(snapshot()).toEqual({ quizzes: [], attempts: [], active: [] });
  });

  it("stores only known fields: no transcript, key, audio or other extras", async () => {
    const dirty = makeQuiz({ api_key: "sk-secret", transcript: "the whole lecture", audio: new Blob(["x"]) });
    dirty.questions[0].transcript = "more transcript";
    await store.saveQuiz(dirty);
    const text = JSON.stringify(stored(QUIZZES_STORE));
    expect(text).not.toMatch(/sk-secret|whole lecture|more transcript|audio|api_key/);
    expect(stored(QUIZZES_STORE)[0].quiz.questions[0].evidence[0].quote.length).toBeLessThanOrEqual(240);
  });

  it("stores a partial quiz", async () => {
    await store.saveQuiz(partialQuiz());
    expect(stored(QUIZZES_STORE)).toHaveLength(1);
  });
});

describe("starting an attempt", () => {
  it("saves the quiz, the attempt and the active pointer in one step", async () => {
    const result = await store.startAttempt({ quiz: makeQuiz(), quizMode: "practice" });
    expect(result.abandonedAttemptId).toBeNull();
    expect(result.attempt).toMatchObject({
      id: "attempt-0001", quizId: QUIZ_ID, videoId: VIDEO_ID, quizMode: "practice", status: "in_progress", rev: 0, currentIndex: 0,
      submittedAt: null, abandonedAt: null, result: null, schemaVersion: 1,
    });
    expect(Object.keys(result.attempt.responses)).toHaveLength(6);
    expect(result.attempt.responses.q1).toEqual(emptyResponse());
    expect(stored(QUIZZES_STORE)).toHaveLength(1);
    expect(stored(ATTEMPTS_STORE)).toHaveLength(1);
    expect(stored(ACTIVE_STORE)).toEqual([{ id: VIDEO_ID, schemaVersion: 1, attemptId: "attempt-0001", rev: 1 }]);
  });

  it("keeps Practice and Assessment distinct from the start", async () => {
    const practice = await store.startAttempt({ quiz: makeQuiz(), quizMode: "practice" });
    expect(practice.attempt.quizMode).toBe("practice");
    const assessment = await store.startAttempt({ quiz: secondQuiz(), quizMode: "assessment", expectedActiveAttemptId: practice.attempt.id });
    expect(assessment.attempt.quizMode).toBe("assessment");
    expect(await code(store.startAttempt({ quiz: makeQuiz({ quiz_id: "1a1a1a1a-1234-4abc-9def-0123456789ab" }), quizMode: "exam", expectedActiveAttemptId: assessment.attempt.id }))).toBe("invalid");
  });

  it("rejects invalid input and writes nothing", async () => {
    for (const args of [
      { quiz: insufficientQuiz(), quizMode: "practice" }, { quiz: null, quizMode: "practice" }, { quiz: makeQuiz(), quizMode: undefined },
      { quiz: makeQuiz(), quizMode: "practice", expectedActiveAttemptId: 5 }, undefined,
    ]) {
      expect(await code(store.startAttempt(args))).toBe("invalid");
    }
    expect(snapshot()).toEqual({ quizzes: [], attempts: [], active: [] });
  });

  it("rejects a duplicate quiz id and changes nothing", async () => {
    const first = await begin();
    const before = snapshot();
    expect(await code(store.startAttempt({ quiz: makeQuiz(), quizMode: "practice", expectedActiveAttemptId: first.id }))).toBe("duplicate");
    expect(snapshot()).toEqual(before);
  });

  it("rejects a duplicate attempt id and changes nothing, including the previous attempt", async () => {
    const first = await begin();
    const same = makeStore({ newId: () => first.id });
    const before = snapshot();
    expect(await code(same.startAttempt({ quiz: secondQuiz(), quizMode: "practice", expectedActiveAttemptId: first.id }))).toBe("duplicate");
    expect(snapshot()).toEqual(before);
    await same.close();
  });
});

describe("replacing an active attempt", () => {
  it("sets the old attempt aside with its answers and makes the new one active, in one step", async () => {
    const first = await begin();
    const worked = await store.saveProgress({
      attemptId: first.id, expectedRev: 0, currentIndex: 2,
      responses: { q1: res({ choiceId: "a", firstCheckedChoiceId: "a", lastCheckedChoiceId: "a", hintsUsed: 1 }), q3: res({ choiceId: "b" }) },
    });
    const replaced = await store.startAttempt({ quiz: secondQuiz(), quizMode: "assessment", expectedActiveAttemptId: first.id });
    expect(replaced.abandonedAttemptId).toBe(first.id);

    const old = stored(ATTEMPTS_STORE).find((a) => a.id === first.id);
    expect(old).toMatchObject({ status: "abandoned", rev: worked.rev + 1, currentIndex: 2 });
    expect(old.abandonedAt).toBeGreaterThan(0);
    expect(old.responses.q1).toMatchObject({ choiceId: "a", hintsUsed: 1, firstCheckedChoiceId: "a" }); // answers kept
    expect(stored(ACTIVE_STORE)).toEqual([expect.objectContaining({ attemptId: replaced.attempt.id, rev: 2 })]);
    expect(stored(ATTEMPTS_STORE).filter((a) => a.status === "in_progress")).toHaveLength(1);
    expect(stored(QUIZZES_STORE)).toHaveLength(2); // the old quiz is kept for the set-aside attempt
  });

  it.each([
    ["the quiz", QUIZZES_STORE, "add"],
    ["the attempt", ATTEMPTS_STORE, "add"],
    ["the pointer", ACTIVE_STORE, "put"],
  ])("keeps the existing attempt active and untouched when saving %s fails", async (_label, storeName, op) => {
    const first = await begin();
    await store.saveProgress({ attemptId: first.id, expectedRev: 0, currentIndex: 1, responses: { q1: res({ choiceId: "c" }) } });
    const before = snapshot();
    fake.failNext({ store: storeName, op, error: "QuotaExceededError" });
    expect(await code(store.startAttempt({ quiz: secondQuiz(), quizMode: "practice", expectedActiveAttemptId: first.id }))).toBe("quota");
    expect(snapshot()).toEqual(before);
    const active = await store.getActiveAttempt(VIDEO_ID);
    expect(active.state).toBe("ready");
    expect(active.attempt).toMatchObject({ id: first.id, status: "in_progress", currentIndex: 1 });
    expect(active.attempt.responses.q1.choiceId).toBe("c");
  });

  it("also keeps everything when the browser aborts the transaction with no error", async () => {
    const first = await begin();
    const before = snapshot();
    fake.abortNextTransaction();
    expect(await code(store.startAttempt({ quiz: secondQuiz(), quizMode: "practice", expectedActiveAttemptId: first.id }))).toBe("failed");
    expect(snapshot()).toEqual(before);
  });

  it("refuses to replace when the pointer is not what the caller saw", async () => {
    const first = await begin();
    const before = snapshot();
    expect(await code(store.startAttempt({ quiz: secondQuiz(), quizMode: "practice", expectedActiveAttemptId: null }))).toBe("conflict");
    expect(await code(store.startAttempt({ quiz: secondQuiz(), quizMode: "practice", expectedActiveAttemptId: "attempt-9999" }))).toBe("conflict");
    expect(snapshot()).toEqual(before);
    expect((await store.getActiveAttempt(VIDEO_ID)).activeAttemptId).toBe(first.id);
  });

  it("starts fresh after the previous attempt was submitted or abandoned (nothing active)", async () => {
    const first = await begin();
    await store.submitAttempt({ attemptId: first.id, expectedRev: 0 });
    expect((await store.getActiveAttempt(VIDEO_ID)).state).toBe("none");
    const next = await store.startAttempt({ quiz: secondQuiz(), quizMode: "practice", expectedActiveAttemptId: null });
    expect(next.abandonedAttemptId).toBeNull();
    expect(stored(ATTEMPTS_STORE).find((a) => a.id === first.id).status).toBe("submitted");
  });

  it("keeps different videos independent", async () => {
    const a = await begin();
    const other = makeQuiz({ video_id: OTHER_VIDEO_ID, quiz_id: "5e5e5e5e-1234-4abc-9def-0123456789ab" });
    const b = await store.startAttempt({ quiz: other, quizMode: "practice" });
    expect(b.abandonedAttemptId).toBeNull();
    expect((await store.getActiveAttempt(VIDEO_ID)).activeAttemptId).toBe(a.id);
    expect((await store.getActiveAttempt(OTHER_VIDEO_ID)).activeAttemptId).toBe(b.attempt.id);
  });

  it("leaves a corrupt old attempt exactly as it is, and still moves the pointer", async () => {
    const first = await begin();
    await tamper(ATTEMPTS_STORE, first.id, (r) => ({ ...r, currentIndex: 99 }));
    const corruptCopy = deepCopy(stored(ATTEMPTS_STORE)[0]);
    const replaced = await store.startAttempt({ quiz: secondQuiz(), quizMode: "practice", expectedActiveAttemptId: first.id });
    expect(replaced.abandonedAttemptId).toBeNull();
    expect(stored(ATTEMPTS_STORE).find((a) => a.id === first.id)).toEqual(corruptCopy);
    expect(stored(ACTIVE_STORE)[0].attemptId).toBe(replaced.attempt.id);
  });

  it("leaves a newer-version old attempt exactly as it is", async () => {
    const first = await begin();
    await tamper(ATTEMPTS_STORE, first.id, (r) => ({ ...r, schemaVersion: 2, futureField: { x: 1 } }));
    const futureCopy = deepCopy(stored(ATTEMPTS_STORE)[0]);
    await store.startAttempt({ quiz: secondQuiz(), quizMode: "practice", expectedActiveAttemptId: first.id });
    expect(stored(ATTEMPTS_STORE).find((a) => a.id === first.id)).toEqual(futureCopy);
  });

  it("replaces a dangling pointer (its attempt is gone)", async () => {
    const first = await begin();
    await rawPut(ACTIVE_STORE, { id: VIDEO_ID, schemaVersion: 1, attemptId: "attempt-gone-1", rev: 4 });
    const replaced = await store.startAttempt({ quiz: secondQuiz(), quizMode: "practice", expectedActiveAttemptId: "attempt-gone-1" });
    expect(replaced.abandonedAttemptId).toBeNull();
    expect(stored(ACTIVE_STORE)[0]).toMatchObject({ attemptId: replaced.attempt.id, rev: 5 });
    expect(stored(ATTEMPTS_STORE).find((a) => a.id === first.id).status).toBe("in_progress"); // untouched
  });

  it("replaces a corrupt pointer when told it is corrupt, and refuses a newer-version pointer", async () => {
    await begin();
    await rawPut(ACTIVE_STORE, { id: VIDEO_ID, schemaVersion: 1, attemptId: 42, rev: "x" });
    const view = await store.getActiveAttempt(VIDEO_ID);
    expect(view).toMatchObject({ state: "unreadable", reason: "corrupt", activeAttemptId: CORRUPT_POINTER });
    const replaced = await store.startAttempt({ quiz: secondQuiz(), quizMode: "practice", expectedActiveAttemptId: CORRUPT_POINTER });
    expect(stored(ACTIVE_STORE)[0].attemptId).toBe(replaced.attempt.id);

    await rawPut(ACTIVE_STORE, { id: VIDEO_ID, schemaVersion: 2, attemptId: "attempt-future", rev: 9 });
    const future = deepCopy(stored(ACTIVE_STORE));
    const before = snapshot();
    const third = makeQuiz({ quiz_id: "2c2c2c2c-1234-4abc-9def-0123456789ab" });
    expect(await code(store.startAttempt({ quiz: third, quizMode: "practice", expectedActiveAttemptId: "attempt-future" }))).toBe("unsupported_version");
    expect(snapshot()).toEqual(before);
    expect(stored(ACTIVE_STORE)).toEqual(future);
  });
});

describe("autosave and resume", () => {
  it("saves progress with a new revision and keeps identity fields fixed", async () => {
    const first = await begin();
    const saved = await store.saveProgress({
      attemptId: first.id, expectedRev: 0, currentIndex: 3,
      responses: { q1: res({ choiceId: "a" }), q2: res({ choiceId: "true", flagged: true }) },
    });
    expect(saved).toMatchObject({ id: first.id, rev: 1, currentIndex: 3, quizId: QUIZ_ID, videoId: VIDEO_ID, quizMode: "practice", startedAt: first.startedAt, status: "in_progress" });
    expect(saved.updatedAt).toBeGreaterThan(first.updatedAt);
    expect(saved.responses.q2.flagged).toBe(true);
    expect(saved.responses.q3).toEqual(emptyResponse());
    const again = await store.saveProgress({ attemptId: first.id, expectedRev: 1, currentIndex: 4, responses: { q1: res({ choiceId: "b" }) } });
    expect(again.rev).toBe(2);
    expect(stored(ATTEMPTS_STORE)[0].rev).toBe(2);
  });

  it("resumes the exact state after the store (and so the app) is closed and reopened", async () => {
    const first = await begin();
    await store.saveProgress({
      attemptId: first.id, expectedRev: 0, currentIndex: 4,
      responses: {
        q1: res({ choiceId: "a", firstCheckedChoiceId: "a", lastCheckedChoiceId: "b", hintsUsed: 2 }),
        q2: res({ choiceId: "false", flagged: true }),
      },
    });
    await store.close();

    const reopened = makeStore();
    const view = await reopened.getActiveAttempt(VIDEO_ID);
    expect(view.state).toBe("ready");
    expect(view.activeAttemptId).toBe(first.id);
    expect(view.attempt).toMatchObject({ rev: 1, currentIndex: 4, quizMode: "practice" });
    expect(view.attempt.responses.q1).toEqual({ choiceId: "a", firstCheckedChoiceId: "a", lastCheckedChoiceId: "b", hintsUsed: 2, flagged: false });
    expect(view.attempt.responses.q2).toMatchObject({ choiceId: "false", flagged: true });
    expect(view.quiz).toEqual(makeQuiz());
    expect(view.progress).toEqual({ total: 6, selected: 2, notSelected: 4, flagged: 1, hintsUsed: 2, currentIndex: 4 });
    store = reopened;
  });

  it("reports nothing to resume for a video with no attempt", async () => {
    await begin();
    expect(await store.getActiveAttempt(OTHER_VIDEO_ID)).toEqual({ state: "none", activeAttemptId: null });
  });

  it("rejects invalid snapshots and writes nothing", async () => {
    const first = await begin();
    const before = snapshot();
    const bad = [
      { currentIndex: 6 }, { currentIndex: -1 }, { currentIndex: 1.5 }, { currentIndex: "1" },
      { responses: { q99: res() } }, { responses: { q1: res({ choiceId: "zzz" }) } }, { responses: { q1: res({ choiceId: "true" }) } },
      { responses: { q1: res({ hintsUsed: 3 }) } }, { responses: { q2: res({ hintsUsed: 1 }) } }, { responses: { q1: { choiceId: "a", extra: 1 } } },
      { responses: null }, { responses: [] },
    ];
    for (const patch of bad) expect(await code(store.saveProgress({ attemptId: first.id, expectedRev: 0, ...patch })), JSON.stringify(patch)).toBe("invalid");
    expect(snapshot()).toEqual(before);
  });

  it("will not erase recorded facts: first check, hints used", async () => {
    const first = await begin();
    await store.saveProgress({
      attemptId: first.id, expectedRev: 0,
      responses: { q1: res({ choiceId: "a", firstCheckedChoiceId: "a", lastCheckedChoiceId: "a", hintsUsed: 2 }) },
    });
    const before = snapshot();
    for (const q1 of [
      res({ choiceId: "a", firstCheckedChoiceId: "b", lastCheckedChoiceId: "b", hintsUsed: 2 }),
      res({ choiceId: "a", firstCheckedChoiceId: null, lastCheckedChoiceId: null, hintsUsed: 2 }),
      res({ choiceId: "a", firstCheckedChoiceId: "a", lastCheckedChoiceId: "a", hintsUsed: 1 }),
    ]) {
      expect(await code(store.saveProgress({ attemptId: first.id, expectedRev: 1, responses: { q1 } }))).toBe("invalid");
    }
    expect(snapshot()).toEqual(before);
    const ok = await store.saveProgress({ attemptId: first.id, expectedRev: 1, responses: { q1: res({ choiceId: "b", firstCheckedChoiceId: "a", lastCheckedChoiceId: "b", hintsUsed: 2 }) } });
    expect(ok.responses.q1.firstCheckedChoiceId).toBe("a");
  });

  it("keeps Assessment free of checks and hints", async () => {
    const attempt = (await store.startAttempt({ quiz: makeQuiz(), quizMode: "assessment" })).attempt;
    const before = snapshot();
    for (const q1 of [res({ choiceId: "a", hintsUsed: 1 }), res({ choiceId: "a", firstCheckedChoiceId: "a", lastCheckedChoiceId: "a" }), res({ lastCheckedChoiceId: "a" })]) {
      expect(await code(store.saveProgress({ attemptId: attempt.id, expectedRev: 0, responses: { q1 } }))).toBe("invalid");
    }
    expect(snapshot()).toEqual(before);
    expect((await store.saveProgress({ attemptId: attempt.id, expectedRev: 0, responses: { q1: res({ choiceId: "a", flagged: true }) } })).responses.q1.choiceId).toBe("a");
  });

  it("does not let the caller's objects change what was saved", async () => {
    const first = await begin();
    const responses = { q1: res({ choiceId: "a" }) };
    const saved = await store.saveProgress({ attemptId: first.id, expectedRev: 0, responses });
    responses.q1.choiceId = "d";
    saved.responses.q1.choiceId = "c";
    expect(stored(ATTEMPTS_STORE)[0].responses.q1.choiceId).toBe("a");
  });

  it("rejects bad arguments", async () => {
    for (const args of [{ attemptId: "x", expectedRev: 0 }, { attemptId: "attempt-0001", expectedRev: -1 }, { attemptId: "attempt-0001", expectedRev: 1.5 }, { attemptId: "attempt-0001" }, undefined]) {
      expect(await code(store.saveProgress(args))).toBe("invalid");
    }
    expect(await code(store.saveProgress({ attemptId: "attempt-0404", expectedRev: 0 }))).toBe("not_found");
  });

  it("rolls back an autosave whose write fails", async () => {
    const first = await begin();
    const before = snapshot();
    fake.failNext({ store: ATTEMPTS_STORE, op: "put", error: "QuotaExceededError" });
    expect(await code(store.saveProgress({ attemptId: first.id, expectedRev: 0, currentIndex: 2, responses: { q1: res({ choiceId: "a" }) } }))).toBe("quota");
    expect(snapshot()).toEqual(before);
    const retried = await store.saveProgress({ attemptId: first.id, expectedRev: 0, currentIndex: 2, responses: { q1: res({ choiceId: "a" }) } });
    expect(retried.rev).toBe(1);
  });

  it("maps a request that throws on the spot (DataCloneError) to 'failed' with nothing written", async () => {
    const first = await begin();
    const before = snapshot();
    fake.throwNext({ store: ATTEMPTS_STORE, op: "put", error: "DataCloneError" });
    expect(await code(store.saveProgress({ attemptId: first.id, expectedRev: 0, currentIndex: 2 }))).toBe("failed");
    expect(snapshot()).toEqual(before);
  });
});

describe("conflicting writes", () => {
  it("lets exactly one of two writers using the same revision win", async () => {
    const first = await begin();
    const outcomes = await Promise.allSettled([
      store.saveProgress({ attemptId: first.id, expectedRev: 0, responses: { q1: res({ choiceId: "a" }) } }),
      store.saveProgress({ attemptId: first.id, expectedRev: 0, responses: { q1: res({ choiceId: "b" }) } }),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const lost = outcomes.find((o) => o.status === "rejected");
    expect(lost.reason.code).toBe("conflict");
    expect(stored(ATTEMPTS_STORE)[0].rev).toBe(1);
    const winner = outcomes.find((o) => o.status === "fulfilled").value;
    expect(stored(ATTEMPTS_STORE)[0].responses.q1.choiceId).toBe(winner.responses.q1.choiceId);
  });

  it("lets exactly one of twenty concurrent writers win", async () => {
    const first = await begin();
    const outcomes = await Promise.allSettled(Array.from({ length: 20 }, (_, i) =>
      store.saveProgress({ attemptId: first.id, expectedRev: 0, currentIndex: i % 6 })));
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === "rejected").every((o) => o.reason.code === "conflict")).toBe(true);
    expect(stored(ATTEMPTS_STORE)[0].rev).toBe(1);
  });

  it("accepts writers that refresh their revision, and refuses a stale one", async () => {
    const first = await begin();
    expect((await store.saveProgress({ attemptId: first.id, expectedRev: 0 })).rev).toBe(1);
    expect((await store.saveProgress({ attemptId: first.id, expectedRev: 1 })).rev).toBe(2);
    expect(await code(store.saveProgress({ attemptId: first.id, expectedRev: 1 }))).toBe("conflict");
    expect(stored(ATTEMPTS_STORE)[0].rev).toBe(2);
  });

  it("two windows starting the first quiz together create exactly one in-progress attempt", async () => {
    const other = makeStore({ newId: () => "attempt-window2" });
    const outcomes = await Promise.allSettled([
      store.startAttempt({ quiz: makeQuiz(), quizMode: "practice" }),
      other.startAttempt({ quiz: secondQuiz(), quizMode: "practice" }),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((o) => o.status === "rejected").reason.code).toBe("conflict");
    expect(stored(ATTEMPTS_STORE)).toHaveLength(1);
    expect(stored(QUIZZES_STORE)).toHaveLength(1); // the loser's quiz was not left behind
    expect(stored(ATTEMPTS_STORE)[0].id).toBe(stored(ACTIVE_STORE)[0].attemptId);
    await other.close();
  });

  it("two windows pressing 'start new' over the same attempt: one wins, nothing is lost", async () => {
    const first = await begin();
    const other = makeStore({ newId: () => "attempt-window2" });
    const outcomes = await Promise.allSettled([
      store.startAttempt({ quiz: secondQuiz(), quizMode: "practice", expectedActiveAttemptId: first.id }),
      other.startAttempt({ quiz: makeQuiz({ quiz_id: "6f6f6f6f-1234-4abc-9def-0123456789ab" }), quizMode: "practice", expectedActiveAttemptId: first.id }),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const attempts = stored(ATTEMPTS_STORE);
    expect(attempts).toHaveLength(2);
    expect(attempts.filter((a) => a.status === "in_progress")).toHaveLength(1);
    expect(attempts.filter((a) => a.status === "abandoned")).toHaveLength(1);
    expect(stored(QUIZZES_STORE)).toHaveLength(2);
    await other.close();
  });

  it("a submit racing 'start new': exactly one of them wins and the pointer stays valid", async () => {
    const first = await begin();
    const outcomes = await Promise.allSettled([
      store.submitAttempt({ attemptId: first.id, expectedRev: 0 }),
      store.startAttempt({ quiz: secondQuiz(), quizMode: "practice", expectedActiveAttemptId: first.id }),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const attempts = stored(ATTEMPTS_STORE);
    const active = stored(ACTIVE_STORE);
    const inProgress = attempts.filter((a) => a.status === "in_progress");
    if (active.length === 0) expect(inProgress).toHaveLength(0);
    else expect(inProgress.map((a) => a.id)).toEqual([active[0].attemptId]);
    expect(inProgress.length).toBeLessThanOrEqual(1);
  });

  it("a recycled pointer revision can not fool 'start new' (it compares attempt ids)", async () => {
    const first = await begin();
    await store.submitAttempt({ attemptId: first.id, expectedRev: 0 }); // pointer cleared
    const second = await store.startAttempt({ quiz: secondQuiz(), quizMode: "practice", expectedActiveAttemptId: null });
    expect(stored(ACTIVE_STORE)[0].rev).toBe(1); // same revision number the first pointer had
    const before = snapshot();
    expect(await code(store.startAttempt({
      quiz: makeQuiz({ quiz_id: "3d3d3d3d-1234-4abc-9def-0123456789ab" }), quizMode: "practice", expectedActiveAttemptId: first.id,
    }))).toBe("conflict");
    expect(snapshot()).toEqual(before);
    expect(stored(ATTEMPTS_STORE).find((a) => a.id === second.attempt.id).status).toBe("in_progress");
  });
});

describe("submitting and abandoning", () => {
  it("submits an Assessment: final answers, result and cleared pointer are one step", async () => {
    const attempt = (await store.startAttempt({ quiz: makeQuiz(), quizMode: "assessment" })).attempt;
    await store.saveProgress({ attemptId: attempt.id, expectedRev: 0, responses: { q1: res({ choiceId: "a" }) } });
    const done = await store.submitAttempt({
      attemptId: attempt.id, expectedRev: 1, currentIndex: 5,
      responses: { q1: res({ choiceId: "b" }), q2: res({ choiceId: "false" }), q3: res({ choiceId: "b" }) },
    });
    expect(done).toMatchObject({ status: "submitted", rev: 2, currentIndex: 5 });
    expect(done.submittedAt).toBeGreaterThan(0);
    expect(done.result).toMatchObject({ correct: 2, incorrect: 1, unanswered: 3, total: 6 });
    expect(stored(ACTIVE_STORE)).toEqual([]);
    expect(stored(ATTEMPTS_STORE)[0].result).toEqual(done.result);
    expect((await store.getActiveAttempt(VIDEO_ID)).state).toBe("none");
  });

  it("submits a Practice attempt scored on the FIRST checked answers", async () => {
    const first = await begin();
    const done = await store.submitAttempt({
      attemptId: first.id, expectedRev: 0,
      responses: {
        q1: res({ choiceId: "b", firstCheckedChoiceId: "a", lastCheckedChoiceId: "b", hintsUsed: 1 }), // wrong first, right later
        q2: res({ choiceId: "true", firstCheckedChoiceId: "true", lastCheckedChoiceId: "true" }),
        q3: res({ choiceId: "b" }), // selected, never checked
      },
    });
    expect(done.result).toMatchObject({ correct: 1, incorrect: 1, unanswered: 4, total: 6 });
  });

  it("submits with no new snapshot (keeps the saved answers)", async () => {
    const first = await begin();
    await store.saveProgress({ attemptId: first.id, expectedRev: 0, currentIndex: 2, responses: { q1: res({ choiceId: "b", firstCheckedChoiceId: "b", lastCheckedChoiceId: "b" }) } });
    const done = await store.submitAttempt({ attemptId: first.id, expectedRev: 1 });
    expect(done).toMatchObject({ currentIndex: 2, result: expect.objectContaining({ correct: 1 }) });
  });

  it("recomputes scores from the responses and ignores a tampered cached result", async () => {
    const attempt = (await store.startAttempt({ quiz: makeQuiz(), quizMode: "assessment" })).attempt;
    await store.submitAttempt({ attemptId: attempt.id, expectedRev: 0, responses: { q1: res({ choiceId: "b" }) } });
    await tamper(ATTEMPTS_STORE, attempt.id, (r) => ({ ...r, result: { ...r.result, correct: 6, incorrect: 0, unanswered: 0 } }));
    const loaded = await store.loadAttempt(attempt.id);
    expect(loaded.ok).toBe(true);
    expect(loaded.attempt.result.correct).toBe(6); // the cache is stored as it was...
    expect(loaded.score).toMatchObject({ correct: 1, incorrect: 0, unanswered: 5 }); // ...but the score shown is recomputed
    const listed = await store.listAttemptsForVideo(VIDEO_ID);
    expect(listed.attempts[0].score.correct).toBe(1);
  });

  it("rejects a second submit, a stale revision, and a submit of a missing attempt", async () => {
    const first = await begin();
    expect(await code(store.submitAttempt({ attemptId: first.id, expectedRev: 5 }))).toBe("conflict");
    await store.submitAttempt({ attemptId: first.id, expectedRev: 0 });
    const before = snapshot();
    expect(await code(store.submitAttempt({ attemptId: first.id, expectedRev: 1 }))).toBe("not_in_progress");
    expect(await code(store.saveProgress({ attemptId: first.id, expectedRev: 1 }))).toBe("not_in_progress");
    expect(await code(store.abandonAttempt({ attemptId: first.id, expectedRev: 1 }))).toBe("not_in_progress");
    expect(await code(store.submitAttempt({ attemptId: "attempt-0404", expectedRev: 0 }))).toBe("not_found");
    expect(snapshot()).toEqual(before);
  });

  it("an invalid final snapshot does not submit and writes nothing", async () => {
    const first = await begin();
    const before = snapshot();
    expect(await code(store.submitAttempt({ attemptId: first.id, expectedRev: 0, responses: { q1: res({ choiceId: "nope" }) } }))).toBe("invalid");
    expect(snapshot()).toEqual(before);
  });

  it("rolls the whole submit back when the pointer cannot be cleared", async () => {
    const first = await begin();
    const before = snapshot();
    fake.failNext({ store: ACTIVE_STORE, op: "delete", error: "UnknownError" });
    expect(await code(store.submitAttempt({ attemptId: first.id, expectedRev: 0 }))).toBe("failed");
    expect(snapshot()).toEqual(before);
    expect((await store.getActiveAttempt(VIDEO_ID)).state).toBe("ready");
  });

  it("does not clear a pointer that already names another attempt", async () => {
    const first = await begin();
    // Another window set this attempt aside and started a new one, but this window did not know.
    const second = await store.startAttempt({ quiz: secondQuiz(), quizMode: "practice", expectedActiveAttemptId: first.id });
    expect(await code(store.submitAttempt({ attemptId: first.id, expectedRev: 0 }))).toBe("conflict");
    expect(stored(ACTIVE_STORE)[0].attemptId).toBe(second.attempt.id);
  });

  it("submit and abandon leave a pointer alone when it names a different attempt", async () => {
    for (const finish of ["submitAttempt", "abandonAttempt"]) {
      fake = createFakeIndexedDB();
      store = makeStore();
      counter = 0;
      const first = await begin();
      await rawPut(ACTIVE_STORE, { id: VIDEO_ID, schemaVersion: 1, attemptId: "attempt-someone-else", rev: 5 });
      const done = await store[finish]({ attemptId: first.id, expectedRev: 0 });
      expect(done.status).toBe(finish === "submitAttempt" ? "submitted" : "abandoned");
      expect(stored(ACTIVE_STORE)).toEqual([{ id: VIDEO_ID, schemaVersion: 1, attemptId: "attempt-someone-else", rev: 5 }]);
    }
  });

  it("'start new' never rewrites a finished attempt that a stale pointer still names", async () => {
    const first = await begin();
    const done = await store.submitAttempt({ attemptId: first.id, expectedRev: 0, responses: { q1: res({ choiceId: "b" }) } });
    await rawPut(ACTIVE_STORE, { id: VIDEO_ID, schemaVersion: 1, attemptId: first.id, rev: 2 }); // pointer left behind
    expect(await store.getActiveAttempt(VIDEO_ID)).toMatchObject({ state: "unreadable", reason: "not_in_progress" });
    const replaced = await store.startAttempt({ quiz: secondQuiz(), quizMode: "practice", expectedActiveAttemptId: first.id });
    expect(replaced.abandonedAttemptId).toBeNull();
    const kept = stored(ATTEMPTS_STORE).find((a) => a.id === first.id);
    expect(kept).toMatchObject({ status: "submitted", rev: done.rev, abandonedAt: null });
    expect(kept.result).toEqual(done.result);
    expect(stored(ACTIVE_STORE)[0].attemptId).toBe(replaced.attempt.id);
  });

  it("abandons an attempt, keeps its answers and clears the pointer", async () => {
    const first = await begin();
    await store.saveProgress({ attemptId: first.id, expectedRev: 0, responses: { q1: res({ choiceId: "a" }) } });
    const gone = await store.abandonAttempt({ attemptId: first.id, expectedRev: 1 });
    expect(gone).toMatchObject({ status: "abandoned", rev: 2 });
    expect(gone.abandonedAt).toBeGreaterThan(0);
    expect(gone.responses.q1.choiceId).toBe("a");
    expect(stored(ACTIVE_STORE)).toEqual([]);
    expect(await code(store.abandonAttempt({ attemptId: first.id, expectedRev: 0 }))).toBe("conflict");
  });
});

describe("reading", () => {
  it("lists a video's attempts newest first with progress and recomputed scores, excluding other videos", async () => {
    const a = await begin();
    await store.submitAttempt({ attemptId: a.id, expectedRev: 0 });
    const b = (await store.startAttempt({ quiz: secondQuiz(), quizMode: "assessment" })).attempt;
    await store.startAttempt({ quiz: makeQuiz({ video_id: OTHER_VIDEO_ID, quiz_id: "4b4b4b4b-1234-4abc-9def-0123456789ab" }), quizMode: "practice" });
    const listed = await store.listAttemptsForVideo(VIDEO_ID);
    expect(listed.attempts.map((x) => x.attempt.id)).toEqual([b.id, a.id]);
    expect(listed).toMatchObject({ skipped: 0, unsupported: 0 });
    expect(listed.attempts[0].score).toBeUndefined(); // not submitted
    expect(listed.attempts[1].score).toMatchObject({ unanswered: 6, total: 6 });
    expect(listed.attempts[1].progress.total).toBe(6);
  });

  it("lists a video's quizzes newest first and loads one attempt with its quiz", async () => {
    await begin();
    await store.startAttempt({ quiz: secondQuiz(), quizMode: "practice", expectedActiveAttemptId: "attempt-0001" });
    const quizzes = await store.listQuizzesForVideo(VIDEO_ID);
    expect(quizzes.quizzes.map((q) => q.quiz.quiz_id)).toEqual([secondQuiz().quiz_id, QUIZ_ID]);
    const loaded = await store.loadAttempt("attempt-0001");
    expect(loaded).toMatchObject({ ok: true, attempt: { status: "abandoned" }, quiz: { quiz_id: QUIZ_ID } });
    expect(await store.loadAttempt("attempt-0404")).toEqual({ ok: false, reason: "not_found" });
    expect(await store.getQuiz("no-such-quiz")).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns nothing for a video that has no records", async () => {
    expect(await store.listAttemptsForVideo(VIDEO_ID)).toEqual({ attempts: [], skipped: 0, unsupported: 0 });
    expect(await store.listQuizzesForVideo(VIDEO_ID)).toEqual({ quizzes: [], skipped: 0, unsupported: 0 });
  });

  it("rejects empty ids", async () => {
    expect(await code(store.getActiveAttempt(""))).toBe("invalid");
    expect(await code(store.listAttemptsForVideo(5))).toBe("invalid");
    expect(await code(store.getQuiz(""))).toBe("invalid");
    expect(await code(store.loadAttempt("x"))).toBe("invalid");
  });
});

describe("corrupt and unsupported stored records", () => {
  it("resume reports an unreadable active attempt instead of throwing", async () => {
    const cases = {
      "attempt with a bad enum": (r) => ({ ...r, quizMode: "exam" }),
      "attempt pointing at a question that does not exist": (r) => ({ ...r, responses: { q99: emptyResponse() } }),
      "attempt answering a choice that does not exist": (r) => ({ ...r, responses: { q1: { ...emptyResponse(), choiceId: "zzz" } } }),
      "attempt with the wrong shape": () => ({ id: "attempt-0001", schemaVersion: 1 }),
      "attempt claiming to be submitted": (r) => ({ ...r, status: "submitted" }),
    };
    for (const [name, change] of Object.entries(cases)) {
      fake = createFakeIndexedDB();
      store = makeStore();
      counter = 0;
      const a = await begin();
      await tamper(ATTEMPTS_STORE, a.id, change);
      const view = await store.getActiveAttempt(VIDEO_ID);
      expect(view, name).toMatchObject({ state: "unreadable", reason: "corrupt", activeAttemptId: a.id });
    }
  });

  it("resume reports a missing attempt, a missing quiz and a corrupt quiz as unreadable", async () => {
    const a = await begin();
    await tamper(ACTIVE_STORE, VIDEO_ID, (r) => ({ ...r, attemptId: "attempt-gone-1" }));
    expect(await store.getActiveAttempt(VIDEO_ID)).toMatchObject({ state: "unreadable", reason: "corrupt" });
    await tamper(ACTIVE_STORE, VIDEO_ID, (r) => ({ ...r, attemptId: a.id }));
    await tamper(QUIZZES_STORE, QUIZ_ID, (r) => ({ ...r, quiz: { ...r.quiz, questions: [{ ...r.quiz.questions[0], type: "short" }] } }));
    expect(await store.getActiveAttempt(VIDEO_ID)).toMatchObject({ state: "unreadable", reason: "corrupt" });
    expect(await store.getQuiz(QUIZ_ID)).toEqual({ ok: false, reason: "corrupt" });
  });

  it("an active pointer to a finished attempt is unreadable, not resumable", async () => {
    const a = await begin();
    await store.submitAttempt({ attemptId: a.id, expectedRev: 0 });
    await rawPut(ACTIVE_STORE, { id: VIDEO_ID, schemaVersion: 1, attemptId: a.id, rev: 3 });
    expect(await store.getActiveAttempt(VIDEO_ID)).toMatchObject({ state: "unreadable", reason: "not_in_progress" });
  });

  it("treats a record from a newer version as unsupported and never modifies it", async () => {
    const a = await begin();
    await tamper(ATTEMPTS_STORE, a.id, (r) => ({ ...r, schemaVersion: 2, futureField: { keep: "me" } }));
    const future = deepCopy(stored(ATTEMPTS_STORE));
    expect(await store.getActiveAttempt(VIDEO_ID)).toMatchObject({ state: "unreadable", reason: "unsupported_version" });
    expect(await store.loadAttempt(a.id)).toEqual({ ok: false, reason: "unsupported_version" });
    expect(await code(store.saveProgress({ attemptId: a.id, expectedRev: 0 }))).toBe("unsupported_version");
    expect(await code(store.submitAttempt({ attemptId: a.id, expectedRev: 0 }))).toBe("unsupported_version");
    expect(await code(store.abandonAttempt({ attemptId: a.id, expectedRev: 0 }))).toBe("unsupported_version");
    expect(stored(ATTEMPTS_STORE)).toEqual(future);
    expect(await store.listAttemptsForVideo(VIDEO_ID)).toEqual({ attempts: [], skipped: 0, unsupported: 1 });
  });

  it("a newer-version quiz is unsupported and is never overwritten", async () => {
    await store.saveQuiz(makeQuiz());
    await tamper(QUIZZES_STORE, QUIZ_ID, (r) => ({ ...r, schemaVersion: 3, extra: true }));
    const future = deepCopy(stored(QUIZZES_STORE));
    expect(await store.getQuiz(QUIZ_ID)).toEqual({ ok: false, reason: "unsupported_version" });
    expect(await code(store.saveQuiz(makeQuiz()))).toBe("duplicate");
    expect(stored(QUIZZES_STORE)).toEqual(future);
    expect((await store.listQuizzesForVideo(VIDEO_ID)).unsupported).toBe(1);
  });

  it("writes to a corrupt attempt are refused and leave it untouched", async () => {
    const a = await begin();
    await tamper(ATTEMPTS_STORE, a.id, (r) => ({ ...r, currentIndex: 99 }));
    const before = snapshot();
    expect(await code(store.saveProgress({ attemptId: a.id, expectedRev: 0 }))).toBe("corrupt");
    expect(await code(store.submitAttempt({ attemptId: a.id, expectedRev: 0 }))).toBe("corrupt");
    expect(await code(store.abandonAttempt({ attemptId: a.id, expectedRev: 0 }))).toBe("corrupt");
    expect(snapshot()).toEqual(before);
  });

  it("lists skip bad records, count them, and still return the good ones", async () => {
    const a = await begin();
    const b = (await store.startAttempt({ quiz: secondQuiz(), quizMode: "practice", expectedActiveAttemptId: a.id })).attempt;
    const c = (await store.startAttempt({ quiz: makeQuiz({ quiz_id: "8a8a8a8a-1234-4abc-9def-0123456789ab" }), quizMode: "practice", expectedActiveAttemptId: b.id })).attempt;
    await tamper(ATTEMPTS_STORE, a.id, (r) => ({ ...r, status: "bogus" }));
    await tamper(ATTEMPTS_STORE, b.id, (r) => ({ ...r, schemaVersion: 7 }));
    await rawPut(ATTEMPTS_STORE, { id: "attempt-orphan", schemaVersion: 1, videoId: VIDEO_ID, quizId: "missing-quiz" });
    await rawPut(ATTEMPTS_STORE, { id: "attempt-other-video-junk", videoId: OTHER_VIDEO_ID });
    await rawPut(ATTEMPTS_STORE, { id: "attempt-no-video" });
    const listed = await store.listAttemptsForVideo(VIDEO_ID);
    expect(listed.attempts.map((x) => x.attempt.id)).toEqual([c.id]);
    expect(listed).toMatchObject({ skipped: 2, unsupported: 1 });
  });

  it("quiz lists skip unreadable quizzes without crashing", async () => {
    await store.saveQuiz(makeQuiz());
    await store.saveQuiz(secondQuiz());
    await tamper(QUIZZES_STORE, QUIZ_ID, (r) => ({ ...r, quiz: { ...r.quiz, status: "weird" } }));
    await rawPut(QUIZZES_STORE, { id: "junk" });
    const listed = await store.listQuizzesForVideo(VIDEO_ID);
    expect(listed.quizzes.map((q) => q.quiz.quiz_id)).toEqual([secondQuiz().quiz_id]);
    expect(listed.skipped).toBe(1);
  });
});

describe("transactions and connections", () => {
  it("a failing read inside a write aborts it without partial writes", async () => {
    const first = await begin();
    const before = snapshot();
    fake.failNext({ store: QUIZZES_STORE, op: "get", error: "UnknownError" });
    expect(await code(store.saveProgress({ attemptId: first.id, expectedRev: 0 }))).toBe("failed");
    expect(snapshot()).toEqual(before);
  });

  it("maps a newer database version to unsupported_version", async () => {
    fake.failOpen("VersionError");
    expect(await code(store.getActiveAttempt(VIDEO_ID))).toBe("unsupported_version");
    expect((await store.getActiveAttempt(VIDEO_ID)).state).toBe("none"); // the failed open was not cached
  });

  it("reconnects after the browser closes the connection", async () => {
    await begin();
    fake.closeConnections();
    expect((await store.getActiveAttempt(VIDEO_ID)).state).toBe("ready");
    fake.closeConnectionsSilently(); // the store still holds the dead connection: it reopens once
    expect((await store.getActiveAttempt(VIDEO_ID)).state).toBe("ready");
  });

  it("gives up after one reconnect attempt, then recovers on the next call", async () => {
    await begin();
    fake.closeConnectionsSilently();
    fake.deadOnOpen(1); // the reopened connection is dead too
    expect(await code(store.getActiveAttempt(VIDEO_ID))).toBe("failed");
    expect((await store.getActiveAttempt(VIDEO_ID)).state).toBe("ready");
  });

  it("writes with strict durability", async () => {
    await begin();
    expect(fake.log.transactions.filter((t) => t.mode === "readwrite").every((t) => t.durability === "strict")).toBe(true);
  });

  it("never replaces a quiz record: quizzes are written by add() only", async () => {
    await begin();
    const quizBefore = deepCopy(stored(QUIZZES_STORE));
    const first = stored(ATTEMPTS_STORE)[0];
    for (let rev = 0; rev < 3; rev++) await store.saveProgress({ attemptId: first.id, expectedRev: rev, currentIndex: rev });
    await store.abandonAttempt({ attemptId: first.id, expectedRev: 3 });
    expect(stored(QUIZZES_STORE)).toEqual(quizBefore);
  });
});
