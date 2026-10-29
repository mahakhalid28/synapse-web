// Voice actions registered by the Voice notes, Timeline and Quiz screens: the handlers exist only where the
// matching buttons exist, and running one does what the button does. Real screens, real quiz store (in-memory
// IndexedDB), fake API.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import NotesScreen from "../components/NotesScreen";
import Timeline from "../components/Timeline";
import QuizScreen from "../components/QuizScreen";
import { VoiceActionsContext, createActionRegistry } from "./voiceActions";
import { makeNote } from "../test/recorderFakes.js";
import { createQuizStore } from "../lib/quizStore.js";
import { createFakeIndexedDB } from "../test/fakeIndexedDb.js";
import { VIDEO_ID, deepCopy, makeQuiz } from "../test/quizFixtures.js";
import "../test/domMatchers.js";

vi.mock("../api", () => ({
  getInterventionPoints: vi.fn(async () => ({
    points: [
      { id: "p1", title: "First idea", category: "Concept", timestamp: "0:10", seconds: 10 },
      { id: "p2", title: "Second idea", category: "Concept", timestamp: "0:50", seconds: 50 },
    ],
    duration: "2:00", videoTitle: "Lecture", author: "", thumbnailUrl: "",
  })),
}));

const withRegistry = (ui, registry) => (
  <VoiceActionsContext.Provider value={registry}>{ui}</VoiceActionsContext.Provider>
);

beforeEach(() => {
  localStorage.clear();
  URL.createObjectURL = vi.fn(() => "blob:fake/1");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  delete URL.createObjectURL;
  delete URL.revokeObjectURL;
});

describe("Voice notes screen", () => {
  it("opens the nth listed note by voice, and refuses one that does not exist", async () => {
    const registry = createActionRegistry();
    const onOpenNote = vi.fn();
    const notes = [
      makeNote({ id: "a1", videoId: "vidAAAAAAAA", videoTitle: "Cells", createdAt: 300, lectureSeconds: 20 }),
      makeNote({ id: "b1", videoId: "vidBBBBBBBB", videoTitle: "Newton", createdAt: 500, lectureSeconds: 62 }),
    ];
    render(withRegistry(<NotesScreen onOpenNote={onOpenNote} listAll={async () => notes} />, registry));
    await screen.findByText(/2 voice notes/);
    await waitFor(() => expect(registry.context().items).toHaveLength(2));
    registry.handlers().open_item({ index: 2 });
    expect(onOpenNote).toHaveBeenCalledTimes(1);
    expect(() => registry.handlers().open_item({ index: 9 })).toThrow();
    expect(onOpenNote).toHaveBeenCalledTimes(1);
  });
});

describe("Timeline screen", () => {
  it("selects a moment by number", async () => {
    const registry = createActionRegistry();
    render(withRegistry(<Timeline jobId="j" videoId="v" />, registry));
    await screen.findByRole("heading", { level: 1 });
    await act(async () => { registry.handlers().go_to_moment({ index: 2 }); });
    expect(screen.getByRole("status").textContent).toMatch(/Second idea/);
    expect(() => registry.handlers().go_to_moment({ index: 5 })).toThrow();
  });

  it("filters by kind, steps through the list, reads it and opens a moment", async () => {
    const registry = createActionRegistry();
    const onOpenPoint = vi.fn();
    render(withRegistry(<Timeline jobId="j" videoId="v" onOpenPoint={onOpenPoint} />, registry));
    await screen.findByRole("heading", { level: 1 });
    const status = () => screen.getByRole("status").textContent;

    await act(async () => { registry.handlers().filter_moments({ category: "graph" }); });
    expect(status()).toMatch(/no graph moments.*concept/i); // not in this lecture: says what it does have

    await act(async () => { registry.handlers().filter_moments({ category: "all" }); });
    expect(status()).toMatch(/all moments: 2/);

    await act(async () => { registry.handlers().go_to_moment({ index: 1 }); });
    await act(async () => { registry.handlers().next_moment(); });
    expect(status()).toMatch(/Second idea/);
    await act(async () => { registry.handlers().next_moment(); });
    expect(status()).toMatch(/last moment/);

    await act(async () => { registry.handlers().read_moments(); });
    expect(status()).toMatch(/1: First idea.*2: Second idea/);

    await act(async () => { registry.handlers().open_moment({}); });
    expect(onOpenPoint).toHaveBeenCalledWith(expect.objectContaining({ id: "p2" }));
    await act(async () => { registry.handlers().open_moment({ index: 1 }); });
    expect(onOpenPoint).toHaveBeenLastCalledWith(expect.objectContaining({ id: "p1" }));
  });
});

describe("Quiz screen", () => {
  it("offers only the actions that match what is on screen, and never submits by itself", async () => {
    const fake = createFakeIndexedDB();
    const store = createQuizStore({ indexedDB: fake.factory, storage: undefined });
    const api = { requestQuiz: vi.fn(async () => deepCopy(makeQuiz())) };
    const registry = createActionRegistry();
    render(withRegistry(<QuizScreen videoId={VIDEO_ID} jobId="j" store={store} api={api} onBack={() => {}} />, registry));

    await screen.findByRole("heading", { name: "Set up your practice" });
    expect(Object.keys(registry.handlers()).sort()).toEqual(["quiz_back", "quiz_start"]);

    await act(async () => { await registry.handlers().quiz_start(); });
    await screen.findByRole("heading", { name: /^Question 1 of/ });
    let keys = Object.keys(registry.handlers());
    expect(keys).toEqual(expect.arrayContaining(["quiz_answer", "quiz_check", "quiz_hint", "quiz_read", "quiz_next", "quiz_review"]));
    expect(keys).not.toContain("quiz_previous"); // first question
    expect(keys).not.toContain("quiz_submit"); // only in the review

    await act(async () => { registry.handlers().quiz_answer({ index: 2 }); });
    expect(screen.getAllByRole("radio")[1].checked).toBe(true);
    expect(() => registry.handlers().quiz_answer({ index: 9 })).toThrow();

    await act(async () => { registry.handlers().quiz_next(); });
    await screen.findByRole("heading", { name: /^Question 2 of/ });
    expect(Object.keys(registry.handlers())).toContain("quiz_previous");

    await act(async () => { registry.handlers().quiz_review(); });
    await waitFor(() => expect(Object.keys(registry.handlers())).toContain("quiz_submit"));
    expect(Object.keys(registry.handlers())).not.toContain("quiz_answer");
    await store.close();
  });
});
