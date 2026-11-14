import * as drafts from "./notesStore";
import { displaySaved, notifyPersonal, personalRequest, requireLocalBackend } from "./personalApi";
import { accountOwner, accountRequest, captureAccount, assertAccount } from "./accountSession";

const noteFromServer = (note) => ({ ...note, ownerId: accountOwner(), explanations: (note.explanations || []).map(displaySaved) });

export async function uploadLocalNote(note, audio) {
  if (note.ownerId && note.ownerId !== accountOwner()) throw new Error("This recording belongs to another account.");
  const form = new FormData();
  form.append("metadata", JSON.stringify({ id: note.id, videoId: note.videoId,
    lectureSeconds: note.lectureSeconds, createdAt: note.createdAt,
    label: note.label || "", silentWarning: note.silentWarning === true }));
  form.append("file", audio, "recording");
  return noteFromServer(await personalRequest("voice-notes", { method: "POST", body: form }));
}

export async function saveNote(note, audio) {
  const account = captureAccount();
  if (note.ownerId && note.ownerId !== accountOwner()) throw new Error("This recording belongs to another account.");
  // Persist before touching the network. Retry uses the same recording ID.
  const draftStore = drafts.forOwner?.(note.ownerId || accountOwner()) || drafts;
  let recoveryError = null;
  try {
    const existing = await draftStore.getNote(note.id);
    if (!existing) await draftStore.saveNote(note, audio);
  } catch (error) { recoveryError = error; }
  let result;
  try { assertAccount(account); result = await uploadLocalNote(note, audio); }
  catch (error) {
    if (recoveryError) throw new Error(`${error.message} Browser recovery storage is unavailable. Keep this window open to retain the recording and retry.`, { cause: error });
    throw error;
  }
  // A failed local cleanup must not report a successful upload as a failed save.
  try { await draftStore.deleteNote(note.id); } catch { /* explicit import can safely retry */ }
  notifyPersonal();
  return result;
}

export { newNoteId } from "./notesStore";
export const holdDraft = (note, audio) => (drafts.forOwner?.(note.ownerId || accountOwner()) || drafts).saveNote(note, audio);
export const discardStoredDraft = (id) => drafts.deleteNote(id);
export const listAllNotes = async () => (await personalRequest("voice-notes")).map(noteFromServer);
export const listNotesForVideo = async (video) => (await personalRequest(`voice-notes?video_id=${encodeURIComponent(video)}`)).map(noteFromServer);
export async function getNoteAudio(id) {
  requireLocalBackend();
  return accountRequest(`/me/voice-notes/${encodeURIComponent(id)}/audio`, {}, "blob");
}
export async function deleteNote(id) {
  await personalRequest(`voice-notes/${encodeURIComponent(id)}`, { method: "DELETE" });
  notifyPersonal();
  return true;
}
