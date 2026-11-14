import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createFakeIndexedDB } from "../test/fakeIndexedDb";
import { makeQuiz } from "../test/quizFixtures";

let accounts, notes, quizzes;
const opened = [];
const signIn = async (id) => {
  fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({
    user: { id, displayName: id, isLocalProfile: false }, token: id.padEnd(64, "x"), expiresAt: "2099-01-01T00:00:00Z",
  }) });
  await accounts.login(id, "password");
};

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("indexedDB", createFakeIndexedDB().factory);
  accounts = await import("./accountSession");
  notes = await import("./notesStore");
  quizzes = await import("./quizStore");
});
afterEach(async () => {
  await Promise.all(opened.splice(0).map((store) => store.close()));
  vi.unstubAllGlobals();
});

describe("browser records keep their original owner", () => {
  it("separates development drafts and account drafts, and restores them on login", async () => {
    const note = { id: "note-one", videoId: "abcdefghijk", lectureSeconds: 42, createdAt: 1000,
      durationMs: 1000, mimeType: "audio/webm", label: "private note" };
    const audio = new Blob(["recording"], { type: "audio/webm" });
    const local = notes.bindAccount(); opened.push(local);
    await local.saveNote({ ...note, id: "local-note" }, audio);
    await signIn("alice");
    const alice = notes.bindAccount(); opened.push(alice);
    expect(await notes.listAllNotes()).toEqual([]);
    await alice.saveNote(note, audio);
    await signIn("bob");
    const bob = notes.bindAccount(); opened.push(bob);
    expect(await notes.listAllNotes()).toEqual([]);
    // A delayed draft save stays in the original bound store.
    await alice.saveNote({ ...note, id: "late-alice-note" }, audio);
    expect(await notes.listAllNotes()).toEqual([]);
    await signIn("alice");
    expect((await notes.listAllNotes()).map((entry) => entry.id).sort()).toEqual(["late-alice-note", "note-one"]);
    expect((await local.listAllNotes()).map((entry) => entry.id)).toEqual(["local-note"]);
  });

  it("pins late quiz persistence to the account that opened the quiz", async () => {
    await signIn("alice");
    const alice = quizzes.bindAccount(); opened.push(alice);
    const quiz = makeQuiz();
    await signIn("bob");
    const bob = quizzes.bindAccount(); opened.push(bob);
    await alice.saveQuiz(quiz);
    expect((await bob.listQuizzesForVideo(quiz.video_id)).quizzes).toEqual([]);
    await signIn("alice");
    expect((await quizzes.listQuizzesForVideo(quiz.video_id)).quizzes).toHaveLength(1);
  });
});
