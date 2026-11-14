import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveNote, uploadLocalNote } from "./backendNotes";
import * as drafts from "./notesStore";
import { personalRequest } from "./personalApi";

vi.mock("./notesStore", () => ({ getNote: vi.fn(), saveNote: vi.fn(), deleteNote: vi.fn(), newNoteId: vi.fn(), forOwner: undefined }));
vi.mock("./personalApi", () => ({ personalRequest: vi.fn(), notifyPersonal: vi.fn(), requireLocalBackend: vi.fn(), displaySaved: (item) => item }));
const note = { id: "operation-one", videoId: "abcdefghijk", lectureSeconds: 30, createdAt: 1000, durationMs: 1000, mimeType: "audio/webm" };
const audio = new Blob(["recording"], { type: "audio/webm" });

beforeEach(() => { vi.clearAllMocks(); drafts.getNote.mockResolvedValue(null); drafts.saveNote.mockResolvedValue(note); drafts.deleteNote.mockResolvedValue(true); });

describe("durable note upload", () => {
  it("keeps a local recording until the server confirms the upload", async () => {
    const order = [];
    drafts.saveNote.mockImplementation(async () => order.push("draft"));
    personalRequest.mockImplementation(async () => { order.push("upload"); throw new Error("offline"); });
    await expect(saveNote(note, audio)).rejects.toThrow("offline");
    expect(order).toEqual(["draft", "upload"]);
    expect(drafts.deleteNote).not.toHaveBeenCalled();
    drafts.getNote.mockResolvedValue(note);
    personalRequest.mockResolvedValue({ ...note, id: "server-note", explanations: [] });
    expect((await saveNote(note, audio)).id).toBe("server-note");
    expect(drafts.saveNote).toHaveBeenCalledTimes(1);
    expect(drafts.deleteNote).toHaveBeenCalledWith(note.id);
    const form = personalRequest.mock.calls.at(-1)[1].body;
    expect(JSON.parse(form.get("metadata")).id).toBe(note.id);
  });
  it("does not misreport a committed save if local draft cleanup fails", async () => {
    personalRequest.mockResolvedValue({ ...note, explanations: [] });
    drafts.deleteNote.mockRejectedValue(new Error("disk busy"));
    await expect(saveNote(note, audio)).resolves.toMatchObject({ id: note.id });
  });
  it("explicit legacy import retains the original recording", async () => {
    personalRequest.mockResolvedValue({ ...note, explanations: [] });
    await uploadLocalNote(note, audio);
    expect(drafts.deleteNote).not.toHaveBeenCalled();
  });
  it("can save to the backend when browser recovery storage is unavailable", async () => {
    drafts.getNote.mockRejectedValue(new Error("IndexedDB unavailable"));
    personalRequest.mockResolvedValue({ ...note, explanations: [] });
    await expect(saveNote(note, audio)).resolves.toMatchObject({ id: note.id });
    personalRequest.mockRejectedValue(new Error("Server offline"));
    await expect(saveNote(note, audio)).rejects.toThrow("Keep this window open");
  });
});
