// These tests run notesStore against a small in-memory fake (src/test/
// fakeIndexedDb.js) because jsdom has no IndexedDB. They verify the module's
// logic: atomic writes/deletes, validation, error mapping, reconnecting. They
// do NOT exercise real browser IndexedDB; that needs a manual check in Electron.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createNotesStore, NotesStoreError, DB_NAME, DB_VERSION, NOTES_STORE, AUDIO_STORE,
  MAX_LECTURE_SECONDS, MAX_LABEL_LENGTH, MAX_DURATION_MS, newNoteId,
  listAllNotes as defaultListAllNotes, saveNote as defaultSaveNote,
} from "./notesStore.js";
import { createFakeIndexedDB } from "../test/fakeIndexedDb.js";

const audio = (text = "voice-bytes", type = "audio/webm;codecs=opus") => new Blob([text], { type });

const makeNote = (over = {}) => ({
  id: "note-1",
  videoId: "5ugDJhmmkFM",
  jobId: "job-1",
  videoTitle: "The Animal Cell",
  pointId: "point-1",
  lectureSeconds: 201.4,
  createdAt: 1_700_000_000_000,
  durationMs: 4_980,
  mimeType: "audio/webm;codecs=opus",
  label: "Check the nucleus",
  silentWarning: false,
  ...over,
});

const NOTE_FIELDS = [
  "createdAt", "durationMs", "id", "jobId", "label", "lectureSeconds", "mimeType",
  "pointId", "silentWarning", "sizeBytes", "videoId", "videoTitle",
];

let fake;
let store;
// navigator.sendBeacon does not exist in jsdom; remember exactly what was there
// so it can be put back (or removed again) after every test.
const hadSendBeacon = Object.getOwnPropertyDescriptor(navigator, "sendBeacon");

beforeEach(() => {
  fake = createFakeIndexedDB();
  store = createNotesStore({ indexedDB: fake.factory, storage: undefined });
});
afterEach(async () => {
  // All cleanup lives here, never at the end of a test body, so a failed
  // assertion cannot leave a stubbed global or a replaced navigator.sendBeacon behind.
  try {
    await store.close();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (hadSendBeacon) Object.defineProperty(navigator, "sendBeacon", hadSendBeacon);
    else delete navigator.sendBeacon;
  }
});

const rejection = async (promise) => {
  try { await promise; } catch (e) { return e; }
  throw new Error("expected the promise to reject");
};

describe("schema", () => {
  it("creates a versioned database with separate notes and audio stores keyed by id", async () => {
    await store.listAllNotes();
    expect(fake.version(DB_NAME)).toBe(DB_VERSION);
    expect(fake.storeNames(DB_NAME).sort()).toEqual([AUDIO_STORE, NOTES_STORE].sort());
    expect(fake.keyPath(DB_NAME, NOTES_STORE)).toBe("id");
    expect(fake.keyPath(DB_NAME, AUDIO_STORE)).toBe("id");
  });

  it("opens the database once and reuses the connection", async () => {
    await store.listAllNotes();
    await store.listAllNotes();
    await store.saveNote(makeNote(), audio());
    expect(fake.log.opens).toBe(1);
  });
});

describe("saveNote and getNoteAudio", () => {
  it("saves a note and returns its audio", async () => {
    const stored = await store.saveNote(makeNote(), audio("abcdef"));
    expect(stored.id).toBe("note-1");
    expect(stored.sizeBytes).toBe(6);

    const blob = await store.getNoteAudio("note-1");
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBe(6);
    expect(blob.type).toBe("audio/webm;codecs=opus");
    expect(await store.getNote("note-1")).toEqual(stored);
  });

  it("writes metadata and audio in ONE readwrite transaction", async () => {
    await store.listAllNotes(); // open first so only the save is counted below
    fake.log.transactions.length = 0;
    await store.saveNote(makeNote(), audio());
    expect(fake.log.transactions).toEqual([
      { stores: [NOTES_STORE, AUDIO_STORE], mode: "readwrite", durability: "strict" },
    ]);
    expect(fake.records(DB_NAME, NOTES_STORE)).toHaveLength(1);
    expect(fake.records(DB_NAME, AUDIO_STORE)).toHaveLength(1);
  });

  it("stores exactly the known fields: no blob, no blob URL, nothing extra", async () => {
    await store.saveNote({ ...makeNote(), blobUrl: "blob:http://x/1", audio: audio(), junk: { a: 1 } }, audio());
    const [record] = fake.records(DB_NAME, NOTES_STORE);
    expect(Object.keys(record).sort()).toEqual(NOTE_FIELDS);
    expect(JSON.stringify(record)).not.toContain("blob:");
  });

  it("fills defaults for optional fields and takes sizeBytes from the audio", async () => {
    const minimal = {
      id: "n2", videoId: "vid", lectureSeconds: 0, createdAt: 5, durationMs: 0, mimeType: "audio/webm",
    };
    const stored = await store.saveNote(minimal, audio("xy"));
    expect(stored).toEqual({
      id: "n2", videoId: "vid", jobId: null, videoTitle: "", pointId: null, lectureSeconds: 0,
      createdAt: 5, durationMs: 0, mimeType: "audio/webm", sizeBytes: 2, label: "", silentWarning: false,
    });
  });

  it("accepts a sizeBytes that matches the audio, and keeps silentWarning true", async () => {
    const stored = await store.saveNote(makeNote({ sizeBytes: 3, silentWarning: true }), audio("abc"));
    expect(stored.sizeBytes).toBe(3);
    expect(stored.silentWarning).toBe(true);
  });

  it("does not mutate the caller's note", async () => {
    const note = Object.freeze(makeNote());
    await store.saveNote(note, audio());
    expect(note).toEqual(makeNote());
  });

  it("round-trips a note after the connection is closed and reopened", async () => {
    await store.saveNote(makeNote(), audio("persist-me"));
    await store.close();
    expect(await store.getNote("note-1")).not.toBeNull();
    expect((await store.getNoteAudio("note-1")).size).toBe(10);
    expect(fake.log.opens).toBe(2);
  });

  it("generates unique, non-empty ids", () => {
    const ids = new Set(Array.from({ length: 50 }, newNoteId));
    expect(ids.size).toBe(50);
    expect([...ids].every((id) => typeof id === "string" && id.length > 0)).toBe(true);
  });
});

describe("listing", () => {
  beforeEach(async () => {
    await store.saveNote(makeNote({ id: "a", videoId: "v1", createdAt: 100 }), audio());
    await store.saveNote(makeNote({ id: "b", videoId: "v2", createdAt: 300 }), audio());
    await store.saveNote(makeNote({ id: "c", videoId: "v1", createdAt: 200 }), audio());
    await store.saveNote(makeNote({ id: "d", videoId: "v1", createdAt: 400 }), audio());
  });

  it("lists all notes newest first", async () => {
    expect((await store.listAllNotes()).map((n) => n.id)).toEqual(["d", "b", "c", "a"]);
  });

  it("lists one lecture's notes newest first and excludes other lectures", async () => {
    expect((await store.listNotesForVideo("v1")).map((n) => n.id)).toEqual(["d", "c", "a"]);
    expect((await store.listNotesForVideo("v2")).map((n) => n.id)).toEqual(["b"]);
  });

  it("returns an empty list for a lecture with no notes, and for an empty database", async () => {
    expect(await store.listNotesForVideo("nope")).toEqual([]);
    const empty = createNotesStore({ indexedDB: createFakeIndexedDB().factory, storage: undefined });
    expect(await empty.listAllNotes()).toEqual([]);
    await empty.close();
  });

  it("orders notes with the same timestamp deterministically", async () => {
    await store.saveNote(makeNote({ id: "x1", videoId: "v3", createdAt: 500 }), audio());
    await store.saveNote(makeNote({ id: "x2", videoId: "v3", createdAt: 500 }), audio());
    const first = (await store.listNotesForVideo("v3")).map((n) => n.id);
    const second = (await store.listNotesForVideo("v3")).map((n) => n.id);
    expect(first).toEqual(second);
    expect(first.sort()).toEqual(["x1", "x2"]);
  });

  it("returns copies: changing a result does not change storage", async () => {
    const list = await store.listAllNotes();
    list[0].label = "tampered";
    expect((await store.listAllNotes())[0].label).toBe("Check the nucleus");
  });

  it("rejects a missing video id", async () => {
    expect((await rejection(store.listNotesForVideo(""))).code).toBe("invalid");
    expect((await rejection(store.listNotesForVideo(undefined))).code).toBe("invalid");
  });
});

describe("deleteNote", () => {
  beforeEach(async () => {
    await store.saveNote(makeNote({ id: "keep" }), audio("keep"));
    await store.saveNote(makeNote({ id: "gone" }), audio("gone"));
  });

  it("removes metadata and audio together, in ONE readwrite transaction", async () => {
    fake.log.transactions.length = 0;
    expect(await store.deleteNote("gone")).toBe(true);
    expect(fake.log.transactions).toEqual([
      { stores: [NOTES_STORE, AUDIO_STORE], mode: "readwrite", durability: "strict" },
    ]);
    expect(await store.getNote("gone")).toBeNull();
    expect((await rejection(store.getNoteAudio("gone"))).code).toBe("not_found");
    expect(fake.records(DB_NAME, NOTES_STORE).map((r) => r.id)).toEqual(["keep"]);
    expect(fake.records(DB_NAME, AUDIO_STORE).map((r) => r.id)).toEqual(["keep"]);
  });

  it("leaves other notes and their audio untouched", async () => {
    await store.deleteNote("gone");
    expect((await store.getNoteAudio("keep")).size).toBe(4);
  });

  it("returns false (not an error) when the note does not exist", async () => {
    expect(await store.deleteNote("never-existed")).toBe(false);
    expect(await store.deleteNote("gone")).toBe(true);
    expect(await store.deleteNote("gone")).toBe(false);
  });

  it("rolls back both deletions if one of them fails", async () => {
    fake.failNext({ store: AUDIO_STORE, op: "delete", error: "UnknownError" });
    const err = await rejection(store.deleteNote("gone"));
    expect(err).toBeInstanceOf(NotesStoreError);
    expect(err.code).toBe("failed");
    expect(await store.getNote("gone")).not.toBeNull();
    expect((await store.getNoteAudio("gone")).size).toBe(4);
  });

  it("rejects a missing id", async () => {
    expect((await rejection(store.deleteNote(""))).code).toBe("invalid");
  });
});

describe("validation: nothing is written for bad input", () => {
  const cases = [
    ["a missing note", null],
    ["an array instead of a note", []],
    ["a missing id", { id: undefined }],
    ["an empty id", { id: "  " }],
    ["a non-string id", { id: 5 }],
    ["an id with a leading space", { id: " note-1" }],
    ["an id with a trailing space", { id: "note-1 " }],
    ["an id with a trailing newline", { id: "note-1\n" }],
    ["a videoId with a leading space", { videoId: " 5ugDJhmmkFM" }],
    ["a videoId with a trailing tab", { videoId: "5ugDJhmmkFM\t" }],
    ["a missing videoId", { videoId: undefined }],
    ["a non-string jobId", { jobId: 7 }],
    ["a non-string pointId", { pointId: {} }],
    ["a non-string title", { videoTitle: 3 }],
    ["a negative lectureSeconds", { lectureSeconds: -1 }],
    ["a NaN lectureSeconds", { lectureSeconds: NaN }],
    ["an Infinity lectureSeconds", { lectureSeconds: Infinity }],
    ["a string lectureSeconds", { lectureSeconds: "12" }],
    ["a lectureSeconds beyond the limit", { lectureSeconds: MAX_LECTURE_SECONDS + 1 }],
    ["a missing createdAt", { createdAt: undefined }],
    ["a zero createdAt", { createdAt: 0 }],
    ["a negative durationMs", { durationMs: -5 }],
    ["a durationMs above the 10 minute sanity bound", { durationMs: MAX_DURATION_MS + 1 }],
    ["an infinite durationMs", { durationMs: Infinity }],
    ["a missing durationMs", { durationMs: undefined }],
    ["a missing mimeType", { mimeType: undefined }],
    ["a non-audio mimeType", { mimeType: "video/webm" }],
    ["a sizeBytes that does not match the audio", { sizeBytes: 999 }],
    ["a label that is too long", { label: "x".repeat(MAX_LABEL_LENGTH + 1) }],
    ["a non-boolean silentWarning", { silentWarning: "yes" }],
  ];

  it.each(cases)("rejects %s", async (_name, change) => {
    const note = change === null || Array.isArray(change) ? change : { ...makeNote(), ...change };
    const err = await rejection(store.saveNote(note, audio()));
    expect(err).toBeInstanceOf(NotesStoreError);
    expect(err.code).toBe("invalid");
    expect(err.message.length).toBeGreaterThan(10);
    expect(fake.log.transactions).toHaveLength(0); // never even opened a write
  });

  it.each([
    ["no audio", undefined],
    ["null audio", null],
    ["a string", "audio bytes"],
    ["an ArrayBuffer", new ArrayBuffer(8)],
    ["an object that only looks like a blob", { size: 5, type: "audio/webm" }],
    ["an empty blob", new Blob([], { type: "audio/webm" })],
  ])("rejects audio that is %s", async (_name, bad) => {
    const err = await rejection(store.saveNote(makeNote(), bad));
    expect(err.code).toBe("invalid");
    expect(fake.log.transactions).toHaveLength(0);
  });

  it("accepts the boundary values", async () => {
    await store.saveNote(makeNote({ id: "lo", lectureSeconds: 0, durationMs: 0 }), audio());
    await store.saveNote(makeNote({ id: "hi", lectureSeconds: MAX_LECTURE_SECONDS, label: "x".repeat(MAX_LABEL_LENGTH), durationMs: MAX_DURATION_MS }), audio());
    expect(await store.listAllNotes()).toHaveLength(2);
  });

  it("allows a five minute recording (the product limit is lower than the storage bound)", async () => {
    await store.saveNote(makeNote({ durationMs: 5 * 60 * 1000 }), audio());
    expect((await store.getNote("note-1")).durationMs).toBe(300_000);
  });

  it("explains which rule an id broke", async () => {
    const err = await rejection(store.saveNote(makeNote({ id: " padded" }), audio()));
    expect(err.message).toBe('Voice note field "id" must not start or end with whitespace.');
  });

  it("never trims: an id that is valid as written is stored exactly as given", async () => {
    await store.saveNote(makeNote({ id: "a b" }), audio());
    expect((await store.getNote("a b")).id).toBe("a b");
  });

  it.each([
    ["getNote", (s) => s.getNote(" note-1")],
    ["getNoteAudio", (s) => s.getNoteAudio("note-1 ")],
    ["deleteNote", (s) => s.deleteNote(" note-1")],
    ["listNotesForVideo", (s) => s.listNotesForVideo(" vid")],
  ])("%s rejects an id or video id with surrounding whitespace", async (_n, call) => {
    expect((await rejection(call(store))).code).toBe("invalid");
  });
});

describe("mimeType must agree with the audio's own type", () => {
  const save = (mimeType, blob) => store.saveNote(makeNote({ mimeType }), blob);

  it("accepts an identical type", async () => {
    await save("audio/webm;codecs=opus", audio("x", "audio/webm;codecs=opus"));
    expect((await store.getNote("note-1")).mimeType).toBe("audio/webm;codecs=opus");
  });

  it("compares only the base type: codec parameters may differ or be missing", async () => {
    await save("audio/webm;codecs=opus", audio("x", "audio/webm"));
    await store.deleteNote("note-1");
    await save("audio/webm", audio("x", "audio/webm;codecs=opus"));
    await store.deleteNote("note-1");
    await save("audio/ogg;codecs=opus", audio("x", "audio/ogg; codecs=vorbis"));
    expect(await store.listAllNotes()).toHaveLength(1);
  });

  it("ignores case and spaces around the base type", async () => {
    await save("Audio/WebM ; codecs=opus", audio("x", "audio/webm"));
    expect(await store.listAllNotes()).toHaveLength(1);
  });

  it.each([
    ["a different audio type", "audio/ogg", "audio/webm"],
    ["a video type on the Blob", "audio/webm", "video/webm"],
    ["a different subtype only", "audio/webm", "audio/webmx"],
  ])("rejects %s and writes nothing", async (_n, noteType, blobType) => {
    const err = await rejection(save(noteType, audio("x", blobType)));
    expect(err.code).toBe("invalid");
    expect(err.message).toMatch(/does not match the audio's own type/);
    expect(fake.log.transactions).toHaveLength(0);
  });

  it("accepts any audio mimeType when the Blob type is empty", async () => {
    await save("audio/webm;codecs=opus", audio("x", ""));
    await store.deleteNote("note-1");
    await save("audio/mp4", new Blob(["x"])); // no type given at all
    expect((await store.getNote("note-1")).mimeType).toBe("audio/mp4");
  });

  it("still rejects a non-audio mimeType even when the Blob type is empty", async () => {
    expect((await rejection(save("video/webm", audio("x", "")))).code).toBe("invalid");
  });
});

describe("duplicate ids", () => {
  it("rejects a second note with the same id and keeps the original intact", async () => {
    await store.saveNote(makeNote({ label: "original" }), audio("original-audio"));
    const err = await rejection(store.saveNote(makeNote({ label: "replacement" }), audio("different-audio-bytes")));

    expect(err).toBeInstanceOf(NotesStoreError);
    expect(err.code).toBe("duplicate");
    expect((await store.getNote("note-1")).label).toBe("original");
    expect((await store.getNoteAudio("note-1")).size).toBe("original-audio".length);
    expect(fake.records(DB_NAME, NOTES_STORE)).toHaveLength(1);
    expect(fake.records(DB_NAME, AUDIO_STORE)).toHaveLength(1);
  });

  it("still allows saving after a duplicate was rejected", async () => {
    await store.saveNote(makeNote(), audio());
    await rejection(store.saveNote(makeNote(), audio()));
    await store.saveNote(makeNote({ id: "other" }), audio());
    expect(await store.listAllNotes()).toHaveLength(2);
  });
});

describe("failures", () => {
  it("rolls back the metadata when writing the audio fails (quota)", async () => {
    fake.failNext({ store: AUDIO_STORE, op: "add", error: "QuotaExceededError" });
    const err = await rejection(store.saveNote(makeNote(), audio()));

    expect(err.code).toBe("quota");
    expect(err.message).toMatch(/storage space/i);
    expect(err.cause.name).toBe("QuotaExceededError");
    expect(fake.records(DB_NAME, NOTES_STORE)).toHaveLength(0); // no orphan metadata
    expect(fake.records(DB_NAME, AUDIO_STORE)).toHaveLength(0);
    expect(await store.listAllNotes()).toEqual([]);
  });

  it("rolls back the audio when writing the metadata fails", async () => {
    fake.failNext({ store: NOTES_STORE, op: "add", error: "UnknownError" });
    const err = await rejection(store.saveNote(makeNote(), audio()));
    expect(err.code).toBe("failed");
    expect(fake.records(DB_NAME, AUDIO_STORE)).toHaveLength(0);
  });

  it("recovers: the same note can be saved after a failure", async () => {
    fake.failNext({ store: AUDIO_STORE, op: "add" });
    await rejection(store.saveNote(makeNote(), audio()));
    await store.saveNote(makeNote(), audio());
    expect(await store.listAllNotes()).toHaveLength(1);
  });

  it("maps a read failure to 'failed' and keeps the original error as cause", async () => {
    await store.listAllNotes();
    fake.failNext({ store: NOTES_STORE, op: "getAll", error: "UnknownError" });
    const err = await rejection(store.listAllNotes());
    expect(err.code).toBe("failed");
    expect(err.cause).toBeDefined();
    expect(await store.listAllNotes()).toEqual([]); // and the next read works
  });

  it("fails when the database cannot be opened, and does not cache that failure", async () => {
    fake.failOpen("UnknownError");
    const err = await rejection(store.listAllNotes());
    expect(err).toBeInstanceOf(NotesStoreError);
    expect(err.code).toBe("failed");

    await store.saveNote(makeNote(), audio()); // retried and succeeded
    expect(fake.log.opens).toBe(2);
  });

  it("reports a database created by a newer version", async () => {
    await store.listAllNotes(); // the database now exists at DB_VERSION
    // An older build opening it at a lower version gets a VersionError.
    const older = createNotesStore({ indexedDB: { open: (name) => fake.factory.open(name, DB_VERSION - 1) }, storage: undefined });
    const err = await rejection(older.listAllNotes());
    expect(err.code).toBe("failed");
    expect(err.message).toMatch(/newer version/i);
  });

  it("maps a synchronous throw from indexedDB.open()", async () => {
    fake.throwOnOpen(new DOMException("denied", "SecurityError"));
    const err = await rejection(store.listAllNotes());
    expect(err.code).toBe("failed");
    expect(err.cause.name).toBe("SecurityError");
  });

  it("reports 'unavailable' for every operation when there is no IndexedDB", async () => {
    const none = createNotesStore({ indexedDB: undefined, storage: undefined });
    for (const call of [
      () => none.saveNote(makeNote(), audio()),
      () => none.getNote("x"),
      () => none.listAllNotes(),
      () => none.listNotesForVideo("x"),
      () => none.getNoteAudio("x"),
      () => none.deleteNote("x"),
    ]) {
      expect((await rejection(call())).code).toBe("unavailable");
    }
  });

  it("reconnects when the browser closed the connection", async () => {
    await store.saveNote(makeNote(), audio());
    fake.closeConnections();
    expect(await store.listAllNotes()).toHaveLength(1);
    expect(fake.log.opens).toBe(2);
  });

  it("reopens after another tab requests a version change", async () => {
    await store.saveNote(makeNote(), audio());
    fake.simulateVersionChange();
    expect(fake.openConnections()).toBe(0); // we closed our connection
    expect(await store.listAllNotes()).toHaveLength(1);
  });

  it("recovers from a connection that is closed but not yet forgotten (retries the transaction once)", async () => {
    await store.saveNote(makeNote(), audio());
    fake.closeConnectionsSilently(); // db.transaction() will now throw InvalidStateError
    expect(await store.listAllNotes()).toHaveLength(1);
    expect(fake.log.opens).toBe(2);
  });
});

describe("concurrency and transaction edge cases", () => {
  it("shares ONE open operation between concurrent first calls", async () => {
    await Promise.all([
      store.listAllNotes(),
      store.listAllNotes(),
      store.saveNote(makeNote(), audio()),
      store.getNote("note-1"),
    ]);
    expect(fake.log.opens).toBe(1);
    expect(fake.openConnections()).toBe(1);
  });

  it("two concurrent saves of the same id: exactly one succeeds and the data stays consistent", async () => {
    const [a, b] = await Promise.allSettled([
      store.saveNote(makeNote({ label: "first" }), audio("12345")),
      store.saveNote(makeNote({ label: "second" }), audio("1234567890")),
    ]);

    const outcomes = [a, b].map((r) => r.status);
    expect(outcomes.filter((s) => s === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((s) => s === "rejected")).toHaveLength(1);
    const loser = [a, b].find((r) => r.status === "rejected");
    expect(loser.reason.code).toBe("duplicate");

    // Metadata and audio belong to the SAME winner, not a mix of both.
    const winner = [a, b].find((r) => r.status === "fulfilled").value;
    const stored = await store.getNote("note-1");
    expect(stored.label).toBe(winner.label);
    expect((await store.getNoteAudio("note-1")).size).toBe(stored.sizeBytes);
    expect(fake.records(DB_NAME, NOTES_STORE)).toHaveLength(1);
    expect(fake.records(DB_NAME, AUDIO_STORE)).toHaveLength(1);
  });

  it("a concurrent save and delete of different notes both complete", async () => {
    await store.saveNote(makeNote({ id: "old" }), audio());
    await Promise.all([store.saveNote(makeNote({ id: "new" }), audio()), store.deleteNote("old")]);
    expect((await store.listAllNotes()).map((n) => n.id)).toEqual(["new"]);
  });

  it("handles a synchronous exception while queuing the writes (e.g. DataCloneError) and rolls back", async () => {
    await store.listAllNotes();
    // The notes add() is queued first; the audio add() then throws synchronously.
    fake.throwNext({ store: AUDIO_STORE, op: "add", error: "DataCloneError" });
    const err = await rejection(store.saveNote(makeNote(), audio()));

    expect(err).toBeInstanceOf(NotesStoreError);
    expect(err.code).toBe("failed");
    expect(err.message).toBe("Could not save the voice note.");
    expect(err.cause.name).toBe("DataCloneError");
    expect(fake.records(DB_NAME, NOTES_STORE)).toHaveLength(0); // the queued notes write was aborted
    expect(fake.records(DB_NAME, AUDIO_STORE)).toHaveLength(0);

    await store.saveNote(makeNote(), audio()); // and the store is still usable
    expect(await store.listAllNotes()).toHaveLength(1);
  });

  it("a transaction aborted with no error still rejects with a useful, specific message", async () => {
    await store.listAllNotes();
    fake.abortNextTransaction();
    const err = await rejection(store.saveNote(makeNote(), audio()));

    expect(err).toBeInstanceOf(NotesStoreError);
    expect(err.code).toBe("failed");
    expect(err.message).toBe("Could not save the voice note. The database transaction was aborted.");
    expect(err.cause).toBeUndefined();
    expect(fake.records(DB_NAME, NOTES_STORE)).toHaveLength(0);
    expect(fake.records(DB_NAME, AUDIO_STORE)).toHaveLength(0);
  });

  it("an abort with no error also rejects reads and deletes (nothing hangs)", async () => {
    await store.saveNote(makeNote(), audio());
    fake.abortNextTransaction();
    expect((await rejection(store.listAllNotes())).message).toMatch(/transaction was aborted/);
    fake.abortNextTransaction();
    expect((await rejection(store.deleteNote("note-1"))).code).toBe("failed");
    expect(await store.getNote("note-1")).not.toBeNull(); // the delete did not happen
  });

  it("a failed retry does not leave a dead connection cached", async () => {
    await store.saveNote(makeNote(), audio());
    fake.closeConnectionsSilently(); // the store still holds the dead connection
    fake.deadOnOpen(1); // ...and the reconnect it makes for the retry is dead too

    const err = await rejection(store.listAllNotes());
    expect(err).toBeInstanceOf(NotesStoreError);
    expect(err.code).toBe("failed");
    expect(err.cause.name).toBe("InvalidStateError");
    expect(fake.log.closedTransactionStarts).toBe(2); // first try + the retry
    expect(fake.log.opens).toBe(2);

    // Next call: the bad connection was forgotten, so it reopens and works at
    // the FIRST attempt (no further closed-connection failure) with the data intact.
    expect(await store.listAllNotes()).toHaveLength(1);
    expect(fake.log.closedTransactionStarts).toBe(2);
    expect(fake.log.opens).toBe(3);
    expect(fake.openConnections()).toBe(1);
  });

  it("a single dead connection is retried once and succeeds without surfacing an error", async () => {
    await store.saveNote(makeNote(), audio());
    fake.closeConnectionsSilently();
    expect(await store.listAllNotes()).toHaveLength(1);
    expect(fake.log.closedTransactionStarts).toBe(1);
  });

  it("upgrading a database whose stores already exist does not recreate or empty them", async () => {
    await store.saveNote(makeNote(), audio());
    await store.close();
    // Reopen at the same version: no upgrade, nothing lost.
    expect(await store.listAllNotes()).toHaveLength(1);
    expect(fake.storeNames(DB_NAME).sort()).toEqual([AUDIO_STORE, NOTES_STORE].sort());
  });

  it("reports not_found when a note's audio record has no blob (the UI must handle this)", async () => {
    await store.saveNote(makeNote(), audio());
    fake.records(DB_NAME, AUDIO_STORE)[0].blob = undefined;
    expect((await rejection(store.getNoteAudio("note-1"))).code).toBe("not_found");
    expect(await store.getNote("note-1")).not.toBeNull();
  });
});

describe("persistent storage request", () => {
  const nav = (over) => ({ persist: vi.fn().mockResolvedValue(true), persisted: vi.fn().mockResolvedValue(false), ...over });

  it("asks for persistence once when the database first opens", async () => {
    const storage = nav();
    const s = createNotesStore({ indexedDB: fake.factory, storage });
    await s.saveNote(makeNote(), audio());
    await s.listAllNotes();
    expect(storage.persist).toHaveBeenCalledTimes(1);
    expect(await s.requestPersistence()).toBe(true);
    await s.close();
  });

  it("does not call persist() when storage is already persistent", async () => {
    const storage = nav({ persisted: vi.fn().mockResolvedValue(true) });
    const s = createNotesStore({ indexedDB: fake.factory, storage });
    expect(await s.requestPersistence()).toBe(true);
    expect(storage.persist).not.toHaveBeenCalled();
  });

  it("reports false when persistence is refused", async () => {
    const s = createNotesStore({ indexedDB: fake.factory, storage: nav({ persist: vi.fn().mockResolvedValue(false) }) });
    expect(await s.requestPersistence()).toBe(false);
  });

  it("never lets a rejected or throwing persist() break saving", async () => {
    for (const storage of [
      nav({ persist: vi.fn().mockRejectedValue(new Error("boom")) }),
      nav({ persist: vi.fn(() => { throw new Error("sync boom"); }) }),
      nav({ persisted: vi.fn().mockRejectedValue(new Error("boom")) }),
    ]) {
      const s = createNotesStore({ indexedDB: createFakeIndexedDB().factory, storage });
      await s.saveNote(makeNote(), audio());
      expect(await s.requestPersistence()).toBe(false);
      expect(await s.listAllNotes()).toHaveLength(1);
      await s.close();
    }
  });

  it("works when the browser has no storage manager at all", async () => {
    const s = createNotesStore({ indexedDB: fake.factory, storage: undefined });
    await s.saveNote(makeNote(), audio());
    expect(await s.requestPersistence()).toBe(false);
    await s.close();
  });
});

describe("privacy: local only", () => {
  it("never touches localStorage or the network while saving, reading and deleting", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const xhr = vi.spyOn(XMLHttpRequest.prototype, "open");
    const beacon = vi.fn();
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true, writable: true });

    await store.saveNote(makeNote(), audio());
    await store.listAllNotes();
    await store.getNoteAudio("note-1");
    await store.deleteNote("note-1");

    expect(setItem).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
  });

  // The test above deliberately leaves its stubs in place; this one proves
  // afterEach put everything back (so cleanup does not depend on the body).
  it("leaves no stubbed globals or replaced navigator.sendBeacon behind", () => {
    expect(vi.isMockFunction(globalThis.fetch)).toBe(false);
    expect(Object.getOwnPropertyDescriptor(navigator, "sendBeacon")).toEqual(hadSendBeacon);
    expect(vi.isMockFunction(Storage.prototype.setItem)).toBe(false);
  });
});

describe("default instance", () => {
  it("is safe to import where IndexedDB does not exist, and fails with 'unavailable'", async () => {
    expect(globalThis.indexedDB).toBeUndefined(); // this is jsdom: the real thing is not under test here
    expect((await rejection(defaultListAllNotes())).code).toBe("unavailable");
    expect((await rejection(defaultSaveNote(makeNote(), audio()))).code).toBe("unavailable");
  });
});
