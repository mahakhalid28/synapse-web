// App-level quiz navigation with the lecture screen and the quiz screen replaced by stubs that expose
// their props, so edge cases that the real quiz screen would never produce (a negative time, another
// video, NaN) can be fed straight into the callbacks App hands over. Home, the sidebar, bookmarks and
// the entry bar are real. No server, model or network.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { act } from "react";
import App from "./App";
import { quizEnabled } from "./lib/quizFlag.js";
import { safeStartSeconds } from "./lib/lectureSeek.js";

const h = vi.hoisted(() => ({ explanation: null, quiz: null }));

vi.mock("./api", () => ({
  processVideo: vi.fn(async ({ videoId }) => ({ jobId: videoId })),
  resetMockTimer: vi.fn(),
}));
vi.mock("./lib/notesStore.js", () => ({ listAllNotes: vi.fn(async () => []) }));
vi.mock("./components/Explanation", () => ({
  default: function ExplanationStub(props) {
    h.explanation = props;
    return (
      <main id="main-content">
        <h1>Lecture stub</h1>
        {props.onStartPractice && <button onClick={props.onStartPractice}>Practice this lecture</button>}
      </main>
    );
  },
}));
vi.mock("./components/QuizScreen", () => ({
  default: function QuizScreenStub(props) {
    h.quiz = props;
    return <main id="main-content"><h1>Quiz stub</h1></main>;
  },
}));

const VIDEO = "aaaaaaaaaaa";
const OTHER = "bbbbbbbbbbb";

beforeEach(() => {
  h.explanation = null;
  h.quiz = null;
  try { localStorage.clear(); } catch { /* ignore */ }
  vi.stubEnv("VITE_QUIZ_ENABLED", "1");
});
afterEach(() => vi.unstubAllEnvs());

async function startLecture(videoId = VIDEO) {
  render(<App />);
  fireEvent.change(document.getElementById("lecture-input"), { target: { value: `https://www.youtube.com/watch?v=${videoId}` } });
  fireEvent.click(screen.getByRole("button", { name: /^Start learning/ }));
  await screen.findByRole("heading", { name: "Lecture stub" });
}

async function openQuiz(videoId = VIDEO) {
  await startLecture(videoId);
  fireEvent.click(screen.getByRole("button", { name: "Practice this lecture" }));
  await screen.findByRole("heading", { name: "Quiz stub" });
}

describe("what the quiz screen is given", () => {
  it("is tied to the lecture that was on screen, with working callbacks", async () => {
    await openQuiz();
    expect(h.quiz).toMatchObject({ videoId: VIDEO, jobId: VIDEO });
    expect(typeof h.quiz.onNavigate).toBe("function");
    expect(typeof h.quiz.onOpenLecture).toBe("function");
    expect(typeof h.quiz.onBack).toBe("function");
  });

  it("uses the library's saved lecture title when there is one, and none otherwise", async () => {
    localStorage.setItem("synapse_library", JSON.stringify([{ id: "x", videoId: VIDEO, videoTitle: "The Animal Cell", mode: "deep", savedAt: 1 }]));
    await openQuiz();
    expect(h.quiz.videoTitle).toBe("The Animal Cell");
    cleanupApp();
    await openQuiz(OTHER);
    expect(h.quiz.videoTitle).toBe(""); // the quiz screen then shows "Lecture <id>"; nothing is guessed
  });

  it("Back restores the lecture with its mode and moment, and cues nothing", async () => {
    await openQuiz();
    act(() => h.quiz.onBack());
    await screen.findByRole("heading", { name: "Lecture stub" });
    expect(h.explanation).toMatchObject({ videoId: VIDEO, jobId: VIDEO, autoPlay: false });
    expect(h.explanation.startSeconds ?? null).toBeNull();
  });
});

describe("Check in the lecture: what App does with the time", () => {
  it("opens the quiz's lecture cued at a valid time, in seconds, not auto-playing", async () => {
    localStorage.setItem("synapse_library", JSON.stringify([{ id: "x", videoId: VIDEO, mode: "deep", savedAt: 1 }]));
    await openQuiz();
    act(() => h.quiz.onOpenLecture({ videoId: VIDEO, jobId: VIDEO, startSeconds: 100 }));
    await screen.findByRole("heading", { name: "Lecture stub" });
    expect(h.explanation).toMatchObject({ videoId: VIDEO, jobId: VIDEO, mode: "deep", startSeconds: 100, autoPlay: false });
    expect(h.explanation.pointId).toBeUndefined(); // no moment is guessed; the cue time decides
  });

  it.each([
    ["negative", -5], ["NaN", NaN], ["Infinity", Infinity], ["a string", "100"], ["null", null], ["undefined", undefined],
    ["an object", {}], ["past 48 hours", 172_801],
  ])("a %s time opens the lecture without seeking", async (_label, bad) => {
    await openQuiz();
    act(() => h.quiz.onOpenLecture({ videoId: VIDEO, jobId: VIDEO, startSeconds: bad }));
    await screen.findByRole("heading", { name: "Lecture stub" });
    expect(h.explanation).toMatchObject({ videoId: VIDEO, startSeconds: null, autoPlay: false });
  });

  it("keeps the boundaries: 0 and 48 hours are valid, fractions are floored", async () => {
    for (const [given, expected] of [[0, 0], [172_800, 172_800], [100.9, 100]]) {
      cleanupApp();
      await openQuiz();
      act(() => h.quiz.onOpenLecture({ videoId: VIDEO, startSeconds: given }));
      await screen.findByRole("heading", { name: "Lecture stub" });
      expect(h.explanation.startSeconds, String(given)).toBe(expected);
    }
  });

  it("never opens a different video than the quiz belongs to", async () => {
    await openQuiz();
    act(() => h.quiz.onOpenLecture({ videoId: OTHER, startSeconds: 50 }));
    act(() => h.quiz.onOpenLecture({}));
    act(() => h.quiz.onOpenLecture(undefined));
    expect(screen.getByRole("heading", { name: "Quiz stub" })).toBeTruthy();
    expect(h.explanation.videoId).toBe(VIDEO); // still the props from before the quiz
  });
});

describe("the entry point", () => {
  it("is not offered to the lecture screen with the flag off, and the quiz can't be reached", async () => {
    vi.stubEnv("VITE_QUIZ_ENABLED", "");
    await startLecture();
    expect(h.explanation.onStartPractice).toBeUndefined();
    expect(screen.queryByRole("button", { name: "Practice this lecture" })).toBeNull();
    expect(h.quiz).toBeNull();
  });

  it("is offered with the flag on, as a callback, and is the only entry", async () => {
    await startLecture();
    expect(typeof h.explanation.onStartPractice).toBe("function");
    expect(screen.getAllByRole("button", { name: "Practice this lecture" })).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "Practice questions" })).toBeNull(); // the temporary bottom bar is gone
  });

  it("only navigates when pressed; nothing starts by itself", async () => {
    await startLecture();
    expect(h.quiz).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Practice this lecture" }));
    await screen.findByRole("heading", { name: "Quiz stub" });
    expect(h.quiz).toMatchObject({ videoId: VIDEO });
  });
});

describe("existing navigation still works with the flag on", () => {
  it("opening a bookmark still opens its lecture with the bookmark's data, and offers practice for it", async () => {
    const bookmark = {
      id: "bm1", videoId: VIDEO, jobId: "job-A", pointId: "p2", mode: "deep", title: "A diagram", category: "diagram",
      timestamp: "0:10", videoTitle: "The Animal Cell", explanation: { subtitle: "s" }, savedAt: 1_700_000_000_000,
    };
    localStorage.setItem("synapse_bookmarks", JSON.stringify([bookmark]));
    render(<App />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Bookmarks/ })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Open A diagram, from The Animal Cell" }));
    await screen.findByRole("heading", { name: "Lecture stub" });
    expect(h.explanation).toMatchObject({ videoId: VIDEO, jobId: "job-A", pointId: "p2", mode: "deep" });
    expect(h.explanation.bookmarkData).toMatchObject({ id: "bm1" });
    fireEvent.click(screen.getByRole("button", { name: "Practice this lecture" }));
    await screen.findByRole("heading", { name: "Quiz stub" });
    expect(h.quiz).toMatchObject({ videoId: VIDEO, jobId: "job-A" });
  });
});

describe("helpers", () => {
  it("safeStartSeconds accepts only finite numbers between 0 and 48 hours and floors them", () => {
    expect(safeStartSeconds(0)).toBe(0);
    expect(safeStartSeconds(59.99)).toBe(59);
    expect(safeStartSeconds(172_800)).toBe(172_800);
    for (const bad of [-0.001, 172_800.5, NaN, Infinity, -Infinity, "5", null, undefined, true, [], {}]) expect(safeStartSeconds(bad)).toBeNull();
  });

  it("the front-end flag is off unless exactly 1 or true", () => {
    for (const [value, on] of [["1", true], ["true", true], [" 1 ", true], ["", false], ["0", false], ["false", false], ["TRUE", false], ["yes", false], ["on", false]]) {
      vi.stubEnv("VITE_QUIZ_ENABLED", value);
      expect(quizEnabled(), JSON.stringify(value)).toBe(on);
    }
    vi.unstubAllEnvs();
    expect(quizEnabled()).toBe(false); // unset, and the test runner is not "development"
  });

  it("when unset, the default is on in development and off in production and test", () => {
    vi.unstubAllEnvs();
    for (const [mode, on] of [["development", true], ["production", false], ["test", false], ["staging", false]]) {
      vi.stubEnv("MODE", mode);
      expect(quizEnabled(), mode).toBe(on);
    }
    vi.unstubAllEnvs();
  });

  it("an explicit value always wins over the mode", () => {
    for (const mode of ["development", "production"]) {
      vi.stubEnv("MODE", mode);
      for (const [value, on] of [["1", true], ["true", true], ["0", false], ["false", false], ["", false], ["yes", false]]) {
        vi.stubEnv("VITE_QUIZ_ENABLED", value);
        expect(quizEnabled(), `${mode} ${JSON.stringify(value)}`).toBe(on);
      }
      vi.unstubAllEnvs();
    }
  });
});

// Unmounts everything between repeated scenarios inside one test.
function cleanupApp() {
  document.body.innerHTML = "";
}
