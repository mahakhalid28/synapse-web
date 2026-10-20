import { describe, it, expect, vi } from "vitest";
import { createAutosaver } from "./quizAutosave.js";
import { QuizStoreError, createQuizStore } from "./quizStore.js";
import { emptyResponse } from "./quizSchema.js";
import { createFakeIndexedDB } from "../test/fakeIndexedDb.js";
import { makeQuiz } from "../test/quizFixtures.js";

// A save() whose calls resolve only when the test says so.
function controllableSave() {
  const calls = [];
  const save = vi.fn((snapshot, expectedRev) => new Promise((resolve, reject) => {
    calls.push({ snapshot, expectedRev, resolve: () => resolve({ rev: expectedRev + 1 }), reject });
  }));
  return { save, calls };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("autosave queue", () => {
  it("writes snapshots one at a time, in order, threading the revision", async () => {
    const order = [];
    const save = vi.fn(async (snapshot, rev) => { order.push([snapshot, rev]); return { rev: rev + 1 }; });
    const saver = createAutosaver({ save, rev: 0 });
    await saver.schedule("a");
    await saver.schedule("b");
    await saver.schedule("c");
    expect(order).toEqual([["a", 0], ["b", 1], ["c", 2]]);
    expect(saver.getRev()).toBe(3);
  });

  it("coalesces: while one write runs, only the newest later snapshot is written", async () => {
    const { save, calls } = controllableSave();
    const saver = createAutosaver({ save, rev: 0 });
    const first = saver.schedule("s1");
    await tick();
    const second = saver.schedule("s2");
    const third = saver.schedule("s3");
    const fourth = saver.schedule("s4");
    expect(calls).toHaveLength(1);
    calls[0].resolve();
    await tick();
    expect(calls.map((c) => c.snapshot)).toEqual(["s1", "s4"]); // s2 and s3 were superseded
    expect(calls[1].expectedRev).toBe(1);
    calls[1].resolve();
    await Promise.all([first, second, third, fourth]);
    expect(saver.hasPending()).toBe(false);
    expect(saver.getRev()).toBe(2);
    expect(saver.status()).toEqual({ ok: true, conflict: false, error: null });
  });

  it("never runs two writes at once", async () => {
    let active = 0;
    let peak = 0;
    const save = async (_s, rev) => { active++; peak = Math.max(peak, active); await tick(); active--; return { rev: rev + 1 }; };
    const saver = createAutosaver({ save, rev: 0 });
    await Promise.all(Array.from({ length: 10 }, (_, i) => saver.schedule(i)));
    expect(peak).toBe(1);
  });

  it("reports each saved attempt", async () => {
    const onSaved = vi.fn();
    const saver = createAutosaver({ save: async (_s, rev) => ({ rev: rev + 1, marker: "saved" }), rev: 4, onSaved });
    await saver.schedule("x");
    expect(onSaved).toHaveBeenCalledWith({ rev: 5, marker: "saved" });
  });

  it("flush waits for the queue to go idle", async () => {
    const { save, calls } = controllableSave();
    const saver = createAutosaver({ save, rev: 0 });
    void saver.schedule("a");
    await tick();
    let flushed = false;
    const flushing = saver.flush().then(() => { flushed = true; });
    await tick();
    expect(flushed).toBe(false);
    calls[0].resolve();
    await flushing;
    expect(flushed).toBe(true);
    expect(await createAutosaver({ save, rev: 0 }).flush()).toEqual({ ok: true, conflict: false, error: null });
  });
});

describe("autosave failures", () => {
  it("keeps the newest snapshot after a failure, reports it once, and retries on the next change", async () => {
    const onError = vi.fn();
    const attempts = [];
    let failures = 1;
    const save = vi.fn(async (snapshot, rev) => {
      attempts.push(snapshot);
      if (failures-- > 0) throw new QuizStoreError("quota", "full");
      return { rev: rev + 1 };
    });
    const saver = createAutosaver({ save, rev: 0, onError });
    const first = await saver.schedule("s1");
    expect(first.ok).toBe(false);
    expect(first.error.code).toBe("quota");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(saver.hasPending()).toBe(true); // not dropped
    await saver.schedule("s2");
    expect(attempts).toEqual(["s1", "s2"]); // the newest state replaced the failed one
    expect(saver.hasPending()).toBe(false);
    expect(saver.getRev()).toBe(1);
    expect(saver.status().ok).toBe(true);
  });

  it("retry() writes the held snapshot without a new change", async () => {
    let fail = true;
    const save = vi.fn(async (_s, rev) => { if (fail) throw new Error("nope"); return { rev: rev + 1 }; });
    const saver = createAutosaver({ save, rev: 0 });
    await saver.schedule("only");
    fail = false;
    expect((await saver.retry()).ok).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("does not spin: one failure, one report, no tight retry loop", async () => {
    const save = vi.fn(async () => { throw new Error("always"); });
    const onError = vi.fn();
    const saver = createAutosaver({ save, rev: 0, onError });
    await saver.schedule("x");
    await tick();
    expect(save).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("stops on a conflict, never overwrites, and continues only after reset()", async () => {
    const onConflict = vi.fn();
    const save = vi.fn(async (_s, rev) => { if (rev === 0) throw new QuizStoreError("conflict", "changed"); return { rev: rev + 1 }; });
    const saver = createAutosaver({ save, rev: 0, onConflict });
    const result = await saver.schedule("mine");
    expect(result).toMatchObject({ ok: false, conflict: true });
    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(saver.hasPending()).toBe(false);
    await saver.schedule("later");
    await saver.retry();
    expect(save).toHaveBeenCalledTimes(1); // nothing more is written while stopped
    saver.reset(7);
    expect((await saver.schedule("after reload")).ok).toBe(true);
    expect(save).toHaveBeenLastCalledWith("after reload", 7);
    expect(saver.getRev()).toBe(8);
  });

  it("stop() ends saving for good", async () => {
    const save = vi.fn(async (_s, rev) => ({ rev: rev + 1 }));
    const saver = createAutosaver({ save, rev: 0 });
    saver.stop();
    await saver.schedule("x");
    expect(save).not.toHaveBeenCalled();
  });

  it("works when its methods are passed around as callbacks", async () => {
    const saver = createAutosaver({ save: async (_s, rev) => ({ rev: rev + 1 }), rev: 0 });
    const { schedule, flush } = saver;
    await schedule("x");
    expect((await flush()).ok).toBe(true);
  });
});

describe("autosave with the real store", () => {
  it("saves a burst of changes to the stored attempt, ending at the newest state", async () => {
    const fake = createFakeIndexedDB();
    let now = 1_700_000_000_000;
    const store = createQuizStore({ indexedDB: fake.factory, storage: undefined, clock: () => (now += 10), newId: () => "attempt-0001" });
    const { attempt } = await store.startAttempt({ quiz: makeQuiz(), quizMode: "practice" });
    const saver = createAutosaver({
      rev: attempt.rev,
      save: (snapshot, rev) => store.saveProgress({ attemptId: attempt.id, expectedRev: rev, ...snapshot }),
    });
    const choices = ["a", "b", "c", "d", "a", "b"];
    await Promise.all(choices.map((choiceId, i) => saver.schedule({ currentIndex: i % 6, responses: { q1: { ...emptyResponse(), choiceId } } })));
    const view = await store.getActiveAttempt("5ugDJhmmkFM");
    expect(view.attempt.responses.q1.choiceId).toBe("b");
    expect(view.attempt.currentIndex).toBe(5);
    expect(view.attempt.rev).toBe(saver.getRev());
    expect(view.attempt.rev).toBeLessThan(6); // fewer writes than changes
    await store.close();
  });

  it("stops cleanly when another window changed the attempt", async () => {
    const fake = createFakeIndexedDB();
    let now = 1_700_000_000_000;
    const make = () => createQuizStore({ indexedDB: fake.factory, storage: undefined, clock: () => (now += 10), newId: () => "attempt-0001" });
    const a = make();
    const b = make();
    const { attempt } = await a.startAttempt({ quiz: makeQuiz(), quizMode: "practice" });
    await b.saveProgress({ attemptId: attempt.id, expectedRev: 0, currentIndex: 3 }); // the other window moves on
    const onConflict = vi.fn();
    const saver = createAutosaver({ rev: 0, onConflict, save: (s, rev) => a.saveProgress({ attemptId: attempt.id, expectedRev: rev, ...s }) });
    expect((await saver.schedule({ currentIndex: 1 })).conflict).toBe(true);
    expect((await a.getActiveAttempt("5ugDJhmmkFM")).attempt.currentIndex).toBe(3); // the other window's work stands
    await a.close();
    await b.close();
  });
});
