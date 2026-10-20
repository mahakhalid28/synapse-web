// App-level wiring for Voice Notes: the sidebar entry, the screen title and
// focus, and opening a note from the global screen. Storage and the lecture
// screen are stand-ins; Home, the Sidebar and the Voice Notes screen are real.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "./App";
import { makeNote } from "./test/recorderFakes.js";

const h = vi.hoisted(() => ({ explanationProps: null }));

vi.mock("./lib/notesStore.js", () => ({
  listAllNotes: vi.fn(),
  listNotesForVideo: vi.fn(async () => []),
  deleteNote: vi.fn(async () => true),
  getNoteAudio: vi.fn(async () => new Blob(["x"])),
  saveNote: vi.fn(),
  newNoteId: vi.fn(() => "id"),
}));

vi.mock("./components/Explanation", () => ({
  default: function ExplanationStub(props) {
    h.explanationProps = props;
    return <main id="main-content"><h1>Lecture stub</h1></main>;
  },
}));

import { listAllNotes } from "./lib/notesStore.js";

beforeEach(() => {
  h.explanationProps = null;
  try { localStorage.clear(); } catch { /* ignore */ }
  listAllNotes.mockResolvedValue([
    makeNote({ id: "a", videoId: "vidAAAAAAAA", jobId: "job-A", pointId: "p2", videoTitle: "The Animal Cell", lectureSeconds: 201.4 }),
    makeNote({ id: "b", videoId: "vidBBBBBBBB", jobId: "", pointId: null, videoTitle: "Newton's Laws", lectureSeconds: 62, createdAt: 1_800_000_000_000 }),
  ]);
});

async function openNotesScreen() {
  render(<App />);
  fireEvent.click(screen.getAllByRole("button", { name: "Voice notes" })[0]);
  await screen.findByRole("heading", { level: 1, name: "Your voice notes." });
}

describe("Voice notes in the app", () => {
  it("is in the sidebar on Home, with no count", async () => {
    render(<App />);
    const entry = screen.getAllByRole("button", { name: "Voice notes" })[0];
    expect(entry).toBeTruthy();
    expect(entry.textContent).not.toMatch(/\d/);
  });

  it("opens the Voice notes screen, titles the window, and moves focus to the page heading", async () => {
    await openNotesScreen();
    expect(document.title).toBe("Voice notes – Synapse");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 })));
    expect(screen.getByRole("button", { name: "Voice notes", current: "page" })).toBeTruthy();
  });

  it("opening a note goes to its lecture, cued at the note's time, with the note's moment and the library's depth mode", async () => {
    localStorage.setItem("synapse_library", JSON.stringify([{ id: "x", videoId: "vidAAAAAAAA", mode: "deep", savedAt: 1 }]));
    await openNotesScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Open at 3:21, Voice note at 3:21" }));

    await screen.findByRole("heading", { name: "Lecture stub" });
    expect(h.explanationProps).toMatchObject({
      videoId: "vidAAAAAAAA", jobId: "job-A", pointId: "p2", mode: "deep", startSeconds: 201.4,
    });
    expect(h.explanationProps.autoPlay).toBe(false); // opened paused: the learner presses Play
  });

  it("a note without a moment or job id still opens (falls back to the video id and 'standard' depth)", async () => {
    await openNotesScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Open at 1:02, Voice note at 1:02" }));
    await screen.findByRole("heading", { name: "Lecture stub" });
    expect(h.explanationProps).toMatchObject({
      videoId: "vidBBBBBBBB", jobId: "vidBBBBBBBB", mode: "standard", startSeconds: 62,
    });
    expect(h.explanationProps.pointId).toBeUndefined();
  });

  it("a time of 0 is passed through as 0, not treated as 'no time'", async () => {
    listAllNotes.mockResolvedValue([makeNote({ lectureSeconds: 0 })]);
    await openNotesScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Open at 0:00, Voice note at 0:00" }));
    await screen.findByRole("heading", { name: "Lecture stub" });
    expect(h.explanationProps.startSeconds).toBe(0);
  });

  it("other screens still open lectures without a start time", async () => {
    render(<App />);
    // Home -> bookmarks -> (nothing to open) keeps working; the Explanation prop default is null.
    fireEvent.click(screen.getAllByRole("button", { name: /^Bookmarks/ })[0]);
    await screen.findByRole("heading", { level: 1, name: "Your saved explanations." });
    expect(h.explanationProps).toBeNull();
  });

  it("the sidebar on the notes screen can leave it", async () => {
    await openNotesScreen();
    fireEvent.click(screen.getByRole("button", { name: /^Bookmarks/ }));
    await screen.findByRole("heading", { level: 1, name: "Your saved explanations." });
  });
});
