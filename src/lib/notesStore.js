// Local-only storage for Voice Notes (IndexedDB).
//
// Nothing here talks to the backend or any network service, and no audio ever
// goes into localStorage. Two object stores, written and deleted together in
// ONE transaction so a note can never exist without its audio (or the reverse):
//
//   notes  keyPath "id"  -> note metadata (plain data only)
//   audio  keyPath "id"  -> { id, blob }   (same id as the note)
//
// Blob URLs are deliberately never stored: they die with the page. Recreate one
// with URL.createObjectURL(blob) when a note is played, and revoke it after.
//
// Saving never overwrites. A second note with an existing id is rejected with
// code "duplicate" and nothing is written. There is no update/edit API yet.
//
// Errors are NotesStoreError with a stable `code`:
//   unavailable  no IndexedDB in this environment
//   invalid      the note or audio failed validation (nothing was written)
//   duplicate    a note with this id already exists
//   quota        not enough storage space
//   not_found    getNoteAudio() for an id with no stored audio
//   failed       anything else (the original error is in `cause`)

export const DB_NAME = "synapse_voice_notes";
export const DB_VERSION = 1;
export const NOTES_STORE = "notes";
export const AUDIO_STORE = "audio";

export const MAX_LECTURE_SECONDS = 172_800; // matches the Ask feature's time limit
export const MAX_LABEL_LENGTH = 200;
// A storage sanity bound only. The product limit for one recording is five
// minutes and is enforced by the recorder; this just stops absurd values.
export const MAX_DURATION_MS = 600_000;
const MAX_FIELD_LENGTH = 500;

export class NotesStoreError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = "NotesStoreError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

const invalid = (message) => new NotesStoreError("invalid", message);

/* ── Validation ──────────────────────────────────────────────────────────── */

function requireString(value, field, max = MAX_FIELD_LENGTH) {
  if (typeof value !== "string" || value.trim() === "") throw invalid(`Voice note field "${field}" must be a non-empty string.`);
  if (value.length > max) throw invalid(`Voice note field "${field}" is too long (maximum ${max} characters).`);
  return value;
}

// Ids are matched exactly, so " a" and "a" would be two different notes.
// Rejected rather than trimmed, so the caller finds out instead of the id
// silently changing.
function requireId(value, field, max = 128) {
  requireString(value, field, max);
  if (value !== value.trim()) throw invalid(`Voice note field "${field}" must not start or end with whitespace.`);
  return value;
}

function optionalString(value, field, max = MAX_FIELD_LENGTH) {
  if (value === undefined || value === null) return null;
  return requireString(value, field, max);
}

function textOrEmpty(value, field, max) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw invalid(`Voice note field "${field}" must be a string.`);
  if (value.length > max) throw invalid(`Voice note field "${field}" is too long (maximum ${max} characters).`);
  return value;
}

function requireNumber(value, field, { min, max = Infinity }) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw invalid(`Voice note field "${field}" must be a number between ${min} and ${max === Infinity ? "infinity" : max}.`);
  }
  return value;
}

// "audio/webm;codecs=opus" -> "audio/webm". Parameters (codecs) are ignored
// because the recorder and the Blob can legitimately report different ones.
const baseType = (type) => String(type).split(";")[0].trim().toLowerCase();

function requireAudio(audio) {
  if (typeof Blob === "undefined" || !(audio instanceof Blob)) throw invalid("Voice note audio must be a Blob.");
  if (audio.size === 0) throw invalid("Voice note audio is empty (0 bytes).");
  return audio;
}

// Returns a fresh plain object holding ONLY the known fields, so nothing extra
// (a blob URL, a Blob, a DOM node) can leak into storage by accident.
function normalizeNote(input, audio) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("A voice note must be an object.");
  requireAudio(audio);

  const mimeType = requireString(input.mimeType, "mimeType", 200);
  if (!/^audio\//i.test(mimeType)) throw invalid(`Voice note field "mimeType" must be an audio type, got "${mimeType}".`);
  // When the Blob states its own type it must agree with the note (same base
  // type, case-insensitive). An empty Blob type says nothing, so it is accepted.
  if (audio.type !== "" && baseType(audio.type) !== baseType(mimeType)) {
    throw invalid(`Voice note field "mimeType" ("${mimeType}") does not match the audio's own type ("${audio.type}").`);
  }

  if (input.sizeBytes !== undefined && input.sizeBytes !== null && input.sizeBytes !== audio.size) {
    throw invalid(`Voice note field "sizeBytes" (${input.sizeBytes}) does not match the audio size (${audio.size}).`);
  }
  if (input.silentWarning !== undefined && input.silentWarning !== null && typeof input.silentWarning !== "boolean") {
    throw invalid('Voice note field "silentWarning" must be true or false.');
  }

  return {
    id: requireId(input.id, "id"),
    videoId: requireId(input.videoId, "videoId"),
    jobId: optionalString(input.jobId, "jobId", 128),
    videoTitle: textOrEmpty(input.videoTitle, "videoTitle", MAX_FIELD_LENGTH),
    pointId: optionalString(input.pointId, "pointId", 128),
    lectureSeconds: requireNumber(input.lectureSeconds, "lectureSeconds", { min: 0, max: MAX_LECTURE_SECONDS }),
    createdAt: requireNumber(input.createdAt, "createdAt", { min: 1 }),
    durationMs: requireNumber(input.durationMs, "durationMs", { min: 0, max: MAX_DURATION_MS }),
    mimeType,
    sizeBytes: audio.size,
    label: textOrEmpty(input.label, "label", MAX_LABEL_LENGTH),
    silentWarning: input.silentWarning === true,
  };
}

/* ── Errors ──────────────────────────────────────────────────────────────── */

function mapError(err, fallbackMessage) {
  if (err instanceof NotesStoreError) return err;
  switch (err && err.name) {
    case "ConstraintError":
      return new NotesStoreError("duplicate", "A voice note with this id already exists.", err);
    case "QuotaExceededError":
      return new NotesStoreError("quota", "There is not enough storage space to save this voice note.", err);
    case "VersionError":
      return new NotesStoreError("failed", "The voice notes database was created by a newer version of Synapse.", err);
    default:
      return new NotesStoreError("failed", fallbackMessage, err);
  }
}

const UNAVAILABLE = () =>
  new NotesStoreError("unavailable", "Voice notes can't be stored here: this environment has no IndexedDB.");

/* ── Helpers ─────────────────────────────────────────────────────────────── */

// Newest first. Equal timestamps fall back to id so the order is stable.
const newestFirst = (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

export function newNoteId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function openDatabase(factory) {
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = factory.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(mapError(err, "Could not open the voice notes database."));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(NOTES_STORE)) db.createObjectStore(NOTES_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(AUDIO_STORE)) db.createObjectStore(AUDIO_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(mapError(request.error, "Could not open the voice notes database."));
    // onblocked is not handled: version 1 has no older connection to block it.
  });
}

/**
 * Builds a store bound to an IndexedDB factory. The app uses the default
 * instance exported below; tests inject a fake factory.
 *
 * @param {{ indexedDB?: IDBFactory | undefined, storage?: StorageManager | undefined }} [options]
 */
export function createNotesStore(options = {}) {
  const factory = "indexedDB" in options ? options.indexedDB : globalThis.indexedDB;
  const storage = "storage" in options ? options.storage : globalThis.navigator?.storage;

  let dbPromise = null;
  let persistPromise = null;

  // Best-effort: never throws, never blocks saving. Resolves true only if the
  // browser says the data is now persistent.
  // UNVERIFIED in Electron: persist() may be routed through the session
  // permission handlers (electron/permissions.cjs denies anything unlisted),
  // in which case it resolves false and a "[permissions] denied" line is
  // logged. Check this in a real Electron run before relying on the result.
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
      // A failed open is not cached, so the next call tries again.
      p.catch(() => { if (dbPromise === p) dbPromise = null; });
      dbPromise = p;
    }
    return dbPromise;
  }

  // Runs `work` inside one transaction. `work(tx, track)` issues requests (pass
  // each through track() so its error is captured) and returns a function that
  // yields the result once the transaction has COMMITTED.
  async function runTransaction(storeNames, mode, work, failMessage) {
    for (let attempt = 0; ; attempt++) {
      const db = await getDb();
      let tx;
      try {
        tx = mode === "readwrite" ? db.transaction(storeNames, mode, { durability: "strict" }) : db.transaction(storeNames, mode);
      } catch (err) {
        // The connection was closed under us (e.g. another tab upgraded): drop
        // the cached connection and reopen once. If the retry fails too, the
        // dead connection is still dropped, so the next call starts clean.
        if (err && err.name === "InvalidStateError") {
          dbPromise = null;
          try { db.close(); } catch { /* already closed */ }
          if (attempt === 0) continue;
        }
        throw mapError(err, failMessage);
      }
      return new Promise((resolve, reject) => {
        let requestError = null;
        const track = (request) => { request.onerror = () => { requestError = request.error; }; return request; };
        let getResult;
        tx.oncomplete = () => {
          try { resolve(getResult()); } catch (err) { reject(mapError(err, failMessage)); }
        };
        tx.onabort = () => {
          const cause = tx.error || requestError;
          // An abort can arrive with no error at all (e.g. the browser aborted it).
          reject(cause
            ? mapError(cause, failMessage)
            : new NotesStoreError("failed", `${failMessage} The database transaction was aborted.`));
        };
        try {
          getResult = work(tx, track);
        } catch (err) {
          try { tx.abort(); } catch { /* already finished */ }
          reject(mapError(err, failMessage));
        }
      });
    }
  }

  /**
   * Saves a note and its audio atomically. Resolves with the stored note.
   * Rejects with "invalid" (nothing written), "duplicate" (nothing written),
   * "quota", "unavailable" or "failed".
   */
  async function saveNote(note, audio) {
    const record = normalizeNote(note, audio);
    await runTransaction([NOTES_STORE, AUDIO_STORE], "readwrite", (tx, track) => {
      // add(), never put(): an existing id fails the transaction instead of replacing.
      track(tx.objectStore(NOTES_STORE).add(record));
      track(tx.objectStore(AUDIO_STORE).add({ id: record.id, blob: audio }));
      return () => undefined;
    }, "Could not save the voice note.");
    return { ...record };
  }

  /** One note's metadata, or null if there is none. */
  async function getNote(id) {
    requireId(id, "id");
    return runTransaction([NOTES_STORE], "readonly", (tx, track) => {
      const request = track(tx.objectStore(NOTES_STORE).get(id));
      return () => (request.result ? { ...request.result } : null);
    }, "Could not read the voice note.");
  }

  /** All notes, newest first. */
  async function listAllNotes() {
    return runTransaction([NOTES_STORE], "readonly", (tx, track) => {
      const request = track(tx.objectStore(NOTES_STORE).getAll());
      return () => (request.result || []).map((n) => ({ ...n })).sort(newestFirst);
    }, "Could not read the voice notes.");
  }

  /** Notes for one lecture (video id), newest first. */
  async function listNotesForVideo(videoId) {
    requireId(videoId, "videoId");
    const all = await listAllNotes();
    return all.filter((n) => n.videoId === videoId);
  }

  /** The audio Blob for a note. Rejects with "not_found" if there is none. */
  async function getNoteAudio(id) {
    requireId(id, "id");
    return runTransaction([AUDIO_STORE], "readonly", (tx, track) => {
      const request = track(tx.objectStore(AUDIO_STORE).get(id));
      return () => {
        const blob = request.result && request.result.blob;
        if (!blob) throw new NotesStoreError("not_found", "The audio for this voice note could not be found.");
        return blob;
      };
    }, "Could not read the voice note audio.");
  }

  /**
   * Deletes the note and its audio in one transaction. Resolves true if the
   * note existed, false if it did not (deleting twice is not an error). Any
   * orphaned audio for the id is removed either way.
   */
  async function deleteNote(id) {
    requireId(id, "id");
    return runTransaction([NOTES_STORE, AUDIO_STORE], "readwrite", (tx, track) => {
      const existing = track(tx.objectStore(NOTES_STORE).get(id));
      track(tx.objectStore(NOTES_STORE).delete(id));
      track(tx.objectStore(AUDIO_STORE).delete(id));
      return () => existing.result !== undefined;
    }, "Could not delete the voice note.");
  }

  /** Closes the connection (tests, or before deleting the database). */
  async function close() {
    const p = dbPromise;
    dbPromise = null;
    if (p) { try { (await p).close(); } catch { /* never opened */ } }
  }

  return { saveNote, getNote, listAllNotes, listNotesForVideo, getNoteAudio, deleteNote, requestPersistence, close };
}

/* ── Default instance used by the app (created on first use, so importing
   this module is safe where IndexedDB does not exist) ─────────────────────── */

let defaultStore = null;
const store = () => (defaultStore ??= createNotesStore());

export const saveNote = (note, audio) => store().saveNote(note, audio);
export const getNote = (id) => store().getNote(id);
export const listAllNotes = () => store().listAllNotes();
export const listNotesForVideo = (videoId) => store().listNotesForVideo(videoId);
export const getNoteAudio = (id) => store().getNoteAudio(id);
export const deleteNote = (id) => store().deleteNote(id);
export const requestPersistence = () => store().requestPersistence();
