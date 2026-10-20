// The whole chain with the REAL App, lecture screen and quiz screen:
//   Home -> lecture -> "Practice this lecture" -> quiz -> results -> "Check in the lecture" -> lecture.
// Stand-ins: the YouTube player, the lecture API, the quiz API (a spy that returns a canned quiz) and
// storage (the project's in-memory IndexedDB behind the real quiz store). No server, model or network.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import App from "./App";
import { makeQuiz, makeQuestion } from "./test/quizFixtures.js";

const h = vi.hoisted(() => {
  const players = [];
  class FakePlayer {
    constructor(_el, opts) {
      this.state = -1;
      this.pauseVideo = vi.fn(() => { this.state = 2; });
      this.playVideo = vi.fn();
      this.seekTo = vi.fn();
      this.cueVideoById = vi.fn();
      this.getCurrentTime = vi.fn(() => 0);
      this.getPlayerState = vi.fn(() => this.state);
      this.destroy = vi.fn();
      players.push(this);
      setTimeout(() => opts.events.onReady({ target: this }), 0);
    }
  }
  return { players, FakePlayer, requestQuiz: vi.fn() };
});

vi.mock("./lib/youtubeIframeApi", () => ({ loadYouTubeIframeAPI: () => Promise.resolve({ Player: h.FakePlayer }) }));
vi.mock("./api", () => ({
  processVideo: vi.fn(async ({ videoId }) => ({ jobId: videoId })),
  resetMockTimer: vi.fn(),
  getInterventionPoints: vi.fn(async () => ({
    videoTitle: "The Animal Cell", duration: "19:13", author: "A",
    points: [{ id: "p1", category: "diagram", timestamp: "0:10", title: "First diagram" }],
  })),
  getExplanation: vi.fn(async (pointId) => ({ pointId, subtitle: "S", paragraphs: ["P."], keyInsight: "K." })),
  getTTSExplanation: vi.fn(async () => ({ text_explanation: "x", audio_file_path: "blob:tts", output_mode: "standard" })),
}));
vi.mock("./lib/notesStore.js", () => ({
  listAllNotes: vi.fn(async () => []), listNotesForVideo: vi.fn(async () => []),
  deleteNote: vi.fn(), getNoteAudio: vi.fn(), saveNote: vi.fn(), newNoteId: vi.fn(() => "id"),
}));
vi.mock("./lib/quizApi.js", async (importOriginal) => ({ ...(await importOriginal()), requestQuiz: (...args) => h.requestQuiz(...args) }));
vi.mock("./lib/quizStore.js", async (importOriginal) => {
  const real = await importOriginal();
  const { createFakeIndexedDB } = await import("./test/fakeIndexedDb.js");
  const store = real.createQuizStore({ indexedDB: createFakeIndexedDB().factory, storage: undefined });
  return { ...real, ...Object.fromEntries(Object.entries(store).map(([name, fn]) => [name, fn])) };
});

let counter = 0;
let quizCounter = 0;
const nextQuizId = () => `00000000-0000-4000-8000-${String((quizCounter += 1)).padStart(12, "0")}`; // the store keeps every quiz, so each needs its own id
const nextVideoId = () => `vid${String((counter += 1)).padStart(8, "0")}`; // 11 characters, unique per test

beforeEach(() => {
  h.players.length = 0;
  h.requestQuiz.mockReset();
  try { localStorage.clear(); } catch { /* ignore */ }
  vi.stubGlobal("Audio", class { constructor() { this.play = vi.fn(() => Promise.resolve()); this.pause = vi.fn(); this.addEventListener = vi.fn(); this.removeEventListener = vi.fn(); } });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const enableQuiz = () => vi.stubEnv("VITE_QUIZ_ENABLED", "1");

async function openLecture(videoId) {
  render(<App />);
  fireEvent.change(document.getElementById("lecture-input"), { target: { value: `https://www.youtube.com/watch?v=${videoId}` } });
  fireEvent.click(screen.getByRole("button", { name: /^Start learning/ }));
  await waitFor(() => expect(h.players.length).toBeGreaterThan(0));
}

const practiceButton = () => screen.queryByRole("button", { name: "Practice this lecture" });
const radio = (name) => screen.getByRole("radio", { name });
const button = (name) => screen.getByRole("button", { name });

async function takeAssessment(videoId) {
  h.requestQuiz.mockResolvedValue(makeQuiz({ video_id: videoId, quiz_id: nextQuizId() }));
  fireEvent.click(radio("Assessment"));
  fireEvent.click(button("Create questions"));
  await screen.findByRole("heading", { name: /^Question 1 of 6/ });
  fireEvent.click(radio(/A\. alpha choice/));
  fireEvent.click(screen.getAllByRole("button", { name: "Review answers" })[0]);
  fireEvent.click(await screen.findByRole("button", { name: "Submit answers" }));
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  await screen.findByRole("heading", { name: "Your results" });
}

describe("the feature is off by default", () => {
  it("shows no entry point on the lecture screen and never asks the server for a quiz", async () => {
    await openLecture(nextVideoId());
    expect(practiceButton()).toBeNull();
    expect(h.requestQuiz).not.toHaveBeenCalled();
  });

  it("treats anything other than exactly 1 or true as off", async () => {
    for (const value of ["0", "false", "TRUE", "yes", "on", ""]) {
      vi.stubEnv("VITE_QUIZ_ENABLED", value);
      const view = render(<App />);
      fireEvent.change(document.getElementById("lecture-input"), { target: { value: `https://www.youtube.com/watch?v=${nextVideoId()}` } });
      fireEvent.click(screen.getByRole("button", { name: /^Start learning/ }));
      await waitFor(() => expect(h.players.length).toBeGreaterThan(0));
      expect(practiceButton(), JSON.stringify(value)).toBeNull();
      view.unmount();
      h.players.length = 0;
    }
  });
});

describe("with the flag on: lecture -> quiz", () => {
  it("shows the entry point on the lecture screen only", async () => {
    enableQuiz();
    render(<App />);
    expect(practiceButton()).toBeNull(); // Home
    fireEvent.change(document.getElementById("lecture-input"), { target: { value: `https://www.youtube.com/watch?v=${nextVideoId()}` } });
    fireEvent.click(screen.getByRole("button", { name: /^Start learning/ }));
    await waitFor(() => expect(h.players.length).toBeGreaterThan(0));
    const entry = await screen.findByRole("button", { name: "Practice this lecture" });
    // in the lecture's own action row, beside Bookmark and the exports, with the same quiet text-button style
    const row = entry.parentElement;
    expect([...row.querySelectorAll("button")].map((b) => b.textContent.replace(/^[^A-Za-z]+/, "").trim())).toEqual(["Bookmark", "Export PDF", "Export audio", "Practice this lecture"]);
    expect(entry.className).toContain("ds-btn-text");
    expect(screen.getAllByRole("button", { name: "Practice this lecture" })).toHaveLength(1); // one entry only
    fireEvent.click(screen.getAllByRole("button", { name: "Library" })[0]);
    await screen.findByRole("heading", { level: 1 });
    expect(practiceButton()).toBeNull(); // not on other screens
  });

  it("opens the quiz screen for THIS lecture without asking the server for anything", async () => {
    enableQuiz();
    const videoId = nextVideoId();
    await openLecture(videoId);
    fireEvent.click(await screen.findByRole("button", { name: "Practice this lecture" }));

    const h1 = await screen.findByRole("heading", { level: 1, name: "Practice this lecture" });
    await screen.findByRole("heading", { name: "Set up your practice" });
    expect(document.title).toBe("Practice this lecture – Synapse");
    await waitFor(() => expect(document.activeElement).toBe(h1));
    expect(h.requestQuiz).not.toHaveBeenCalled(); // navigating is not generating
    expect(screen.getByRole("button", { name: "Create questions" })).toBeTruthy();
  });

  it("sends the lecture's video id and the chosen question count when the learner creates questions", async () => {
    enableQuiz();
    const videoId = nextVideoId();
    await openLecture(videoId);
    fireEvent.click(await screen.findByRole("button", { name: "Practice this lecture" }));
    await screen.findByRole("heading", { name: "Set up your practice" });
    h.requestQuiz.mockResolvedValue(makeQuiz({ video_id: videoId, quiz_id: nextQuizId(), requested_count: 8, returned_count: 8, questions: Array.from({ length: 8 }, (_, i) => makeQuestion(i + 1)) }));
    fireEvent.change(screen.getByLabelText("Number of questions"), { target: { value: "8" } });
    fireEvent.click(button("Create questions"));
    await screen.findByRole("heading", { name: /^Question 1 of 8/ });
    expect(h.requestQuiz).toHaveBeenCalledTimes(1);
    expect(h.requestQuiz.mock.calls[0][0]).toMatchObject({ videoId, questionCount: 8 });
  });

  it("tells the learner when the server has quizzes switched off, without a misleading success state", async () => {
    enableQuiz();
    const { QuizApiError } = await import("./lib/quizApi.js");
    await openLecture(nextVideoId());
    fireEvent.click(await screen.findByRole("button", { name: "Practice this lecture" }));
    await screen.findByRole("heading", { name: "Set up your practice" });
    h.requestQuiz.mockRejectedValue(new QuizApiError("featureOff", 404));
    fireEvent.click(button("Create questions"));
    const alert = await waitFor(() => {
      const found = screen.getAllByRole("alert").find((a) => a.textContent.includes("Error:"));
      expect(found).toBeTruthy();
      return found;
    });
    expect(alert.textContent).toContain("Practice questions aren't available right now.");
    expect(screen.queryByRole("heading", { name: /^Question 1/ })).toBeNull();
  });
});

describe("returning to the lecture", () => {
  it("Back returns to the same lecture without cueing, seeking or playing anything", async () => {
    enableQuiz();
    const videoId = nextVideoId();
    await openLecture(videoId);
    const before = h.players.length;
    fireEvent.click(await screen.findByRole("button", { name: "Practice this lecture" }));
    await screen.findByRole("heading", { name: "Set up your practice" });
    fireEvent.click(button("Back to the lecture"));

    await waitFor(() => expect(h.players.length).toBeGreaterThan(before)); // the lecture screen is back, with a new player
    expect(await screen.findByRole("button", { name: "Practice this lecture" })).toBeTruthy();
    for (const player of h.players) {
      expect(player.cueVideoById).not.toHaveBeenCalled();
      expect(player.seekTo).not.toHaveBeenCalled();
      expect(player.playVideo).not.toHaveBeenCalled();
    }
  });

  it("the sidebar still leaves the quiz for another screen", async () => {
    enableQuiz();
    await openLecture(nextVideoId());
    fireEvent.click(await screen.findByRole("button", { name: "Practice this lecture" }));
    await screen.findByRole("heading", { name: "Set up your practice" });
    fireEvent.click(screen.getAllByRole("button", { name: "Library" })[0]);
    await waitFor(() => expect(document.title).toBe("My Library – Synapse"));
    expect(screen.queryByRole("heading", { name: "Set up your practice" })).toBeNull();
  });
});

describe("results -> Check in the lecture", () => {
  it("opens the SAME video cued at the evidence time in whole seconds, and leaves it paused", async () => {
    enableQuiz();
    const videoId = nextVideoId();
    await openLecture(videoId);
    fireEvent.click(await screen.findByRole("button", { name: "Practice this lecture" }));
    await screen.findByRole("heading", { name: "Set up your practice" });
    await takeAssessment(videoId);

    const before = h.players.length;
    fireEvent.click(within(screen.getByRole("heading", { name: "Question 2: Not answered" }).closest("li")).getByRole("button", { name: "Check in the lecture at 1:40 (question 2)" }));

    await waitFor(() => expect(h.players.length).toBeGreaterThan(before));
    const player = h.players[h.players.length - 1];
    await waitFor(() => expect(player.cueVideoById).toHaveBeenCalledWith({ videoId, startSeconds: 100 })); // seconds, same video
    await new Promise((resolve) => setTimeout(resolve, 700)); // longer than the lecture's 300 ms watcher
    for (const p of h.players) expect(p.playVideo).not.toHaveBeenCalled(); // never started: the learner presses Play
    expect(player.seekTo).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Your results" })).toBeNull();
  });

  it("a concept's link opens the lecture at that concept's start", async () => {
    enableQuiz();
    const videoId = nextVideoId();
    await openLecture(videoId);
    fireEvent.click(await screen.findByRole("button", { name: "Practice this lecture" }));
    await screen.findByRole("heading", { name: "Set up your practice" });
    await takeAssessment(videoId);
    fireEvent.click(screen.getByRole("button", { name: "Check in the lecture at 3:20 for Concept 3" }));
    await waitFor(() => expect(h.players[h.players.length - 1].cueVideoById).toHaveBeenCalledWith({ videoId, startSeconds: 200 }));
  });
});
