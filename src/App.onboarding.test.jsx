import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.jsx";
import "./test/domMatchers.js";

vi.mock("./api.js", () => ({
  processVideo: vi.fn(),
  resetMockTimer: vi.fn(),
  getInterventionPoints: vi.fn(),
  getExplanation: vi.fn(),
  getTTSExplanation: vi.fn(),
  getExplanationPreparationStatus: vi.fn(),
  getPreparedExplanation: vi.fn(),
  retryExplanationPreparation: vi.fn(),
}));

vi.mock("./lib/notesStore.js", () => ({
  listAllNotes: vi.fn(async () => []),
  listNotesForVideo: vi.fn(async () => []),
  deleteNote: vi.fn(),
  getNoteAudio: vi.fn(),
  saveNote: vi.fn(),
  newNoteId: vi.fn(() => "note-id"),
}));

const DONE_KEY = "synapse_onboarding_completed";
const MODE_KEY = "synapse_presentation_mode";

const WELCOME = { level: 1, name: "Welcome to Synapse" };
const HOME = { level: 1, name: "Start a study session" };

let audioConstructed;
let speak;

beforeEach(() => {
  localStorage.clear();
  document.title = "Synapse";
  audioConstructed = vi.fn();
  speak = vi.fn();
  vi.stubGlobal("Audio", audioConstructed);
  vi.stubGlobal("speechSynthesis", { speak, cancel: vi.fn() });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

const enable = () => vi.stubEnv("VITE_ONBOARDING_ENABLED", "1");

describe("first launch", () => {
  it("shows Welcome, not Home, with the title set and no sidebar", () => {
    enable();
    render(<App />);
    expect(screen.getByRole("heading", WELCOME)).toBeTruthy();
    expect(screen.queryByRole("heading", HOME)).toBeNull();
    expect(document.title).toBe("Welcome – Synapse");
    expect(screen.queryByRole("navigation", { name: "Main navigation" })).toBeNull();
  });

  it("moves no focus on cold load, so the skip link is the first Tab stop", async () => {
    enable();
    render(<App />);
    expect(document.activeElement).toBe(document.body);
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Skip to main content" }));
    expect(document.activeElement.getAttribute("href")).toBe("#main-content");
    expect(document.getElementById("main-content")).toBeTruthy();
  });

  it("starts no audio and no speech on its own", () => {
    enable();
    render(<App />);
    expect(audioConstructed).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
  });

  it("a first-time user sees Accessibility mode selected by default", () => {
    enable();
    render(<App />);
    expect(screen.getByRole("button", { name: "Accessibility mode" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Study mode" })).toHaveAttribute("aria-pressed", "false");
  });

  it("a first-time user's launch writes nothing: no preference is created or reset", () => {
    enable();
    render(<App />);
    // (App itself saves the theme it just read; that is not a Welcome write, and it is not a new value)
    expect(localStorage.getItem(MODE_KEY)).toBeNull();
    expect(localStorage.getItem(DONE_KEY)).toBeNull();
  });
});

describe("leaving Welcome", () => {
  it("Get started goes to Home, focuses its heading, and saves the flag and the mode", async () => {
    enable();
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Study mode" }));
    await userEvent.click(screen.getByRole("button", { name: "Get started" }));

    const home = await screen.findByRole("heading", HOME);
    await waitFor(() => expect(document.activeElement).toBe(home));
    expect(screen.queryByRole("heading", WELCOME)).toBeNull();
    expect(document.title).toBe("Start a study session – Synapse");
    expect(localStorage.getItem(DONE_KEY)).toBe("1");
    expect(localStorage.getItem(MODE_KEY)).toBe("study");
  });

  it("Skip for now goes to Home with the heading focused and saves only the flag", async () => {
    enable();
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Skip for now" }));

    const home = await screen.findByRole("heading", HOME);
    await waitFor(() => expect(document.activeElement).toBe(home));
    expect(localStorage.getItem(DONE_KEY)).toBe("1");
    expect(localStorage.getItem(MODE_KEY)).toBeNull();
  });

  it("changes nothing else that is stored: the lecture intro, the guide and the quiz settings", async () => {
    enable();
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Get started" }));
    await screen.findByRole("heading", HOME);
    expect(localStorage.getItem("synapse_intro_seen")).toBeNull();
    expect(localStorage.getItem("synapse_guide_dismissed")).toBeNull();
    expect(Object.keys(localStorage).filter((k) => k.startsWith("synapse_quiz"))).toEqual([]);
  });

  it("does not come back during the session after Home is revisited", async () => {
    enable();
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    await screen.findByRole("heading", HOME);
    await userEvent.click(screen.getByRole("button", { name: "Library" }));
    await userEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(await screen.findByRole("heading", HOME)).toBeTruthy();
    expect(screen.queryByRole("heading", WELCOME)).toBeNull();
  });

  it("stays on Welcome with a message when the chosen mode cannot be saved, then Continue reaches Home", async () => {
    enable();
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
      if (key === MODE_KEY) throw new Error("QuotaExceededError");
      return original.call(this, key, value);
    });
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Study mode" }));
    await userEvent.click(screen.getByRole("button", { name: "Get started" }));
    expect(screen.getByRole("heading", WELCOME)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    const home = await screen.findByRole("heading", HOME);
    await waitFor(() => expect(document.activeElement).toBe(home));
  });
});

describe("who sees Welcome", () => {
  it("a user who has already completed onboarding still sees it on a fresh launch, with no focus move", () => {
    enable();
    localStorage.setItem(DONE_KEY, "1");
    render(<App />);
    expect(screen.getByRole("heading", WELCOME)).toBeTruthy();
    expect(screen.queryByRole("heading", HOME)).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it("every fresh launch shows it: finishing it, closing the app and opening it again shows it again", async () => {
    enable();
    const first = render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    await screen.findByRole("heading", HOME);
    expect(localStorage.getItem(DONE_KEY)).toBe("1");
    first.unmount(); // the app is closed

    render(<App />); // a fresh launch, the same storage
    expect(screen.getByRole("heading", WELCOME)).toBeTruthy();
    expect(screen.queryByRole("heading", HOME)).toBeNull();
  });

  it("a returning user sees their saved mode preselected, on every launch", async () => {
    enable();
    localStorage.setItem(MODE_KEY, "study");
    const first = render(<App />);
    expect(screen.getByRole("button", { name: "Study mode" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Accessibility mode" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByRole("button", { name: "Get started" }));
    await screen.findByRole("heading", HOME);
    first.unmount();

    render(<App />);
    expect(screen.getByRole("button", { name: "Study mode" })).toHaveAttribute("aria-pressed", "true");
  });

  it("Get started on one launch is what the next launch preselects", async () => {
    enable();
    const first = render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Study mode" }));
    await userEvent.click(screen.getByRole("button", { name: "Get started" }));
    await screen.findByRole("heading", HOME);
    expect(localStorage.getItem(MODE_KEY)).toBe("study");
    first.unmount();

    render(<App />);
    expect(screen.getByRole("button", { name: "Study mode" })).toHaveAttribute("aria-pressed", "true");
  });

  it("Skip for now leaves the saved mode exactly as it was, even after another mode was clicked", async () => {
    enable();
    localStorage.setItem(MODE_KEY, "study");
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Accessibility mode" }));
    await userEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    await screen.findByRole("heading", HOME);
    expect(localStorage.getItem(MODE_KEY)).toBe("study");
  });

  it("a launch resets nothing: every other saved preference is left exactly as it was", () => {
    enable();
    const saved = {
      synapse_theme: "night",
      synapse_tts_rate: "1.5",
      synapse_intro_seen: "1",
      synapse_guide_dismissed: "1",
      synapse_quiz_text_scale: "1.3",
      synapse_quiz_high_contrast: "true",
      synapse_bookmarks: "[]",
      synapse_library: "[]",
      [MODE_KEY]: "study",
      [DONE_KEY]: "1",
    };
    for (const [key, value] of Object.entries(saved)) localStorage.setItem(key, value);
    render(<App />);
    expect(screen.getByRole("heading", WELCOME)).toBeTruthy();
    const after = Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]));
    expect(after).toEqual(saved);
  });

  it("a user with old data sees it with their saved mode preselected: nothing is inferred from other keys", () => {
    enable();
    localStorage.setItem("synapse_library", JSON.stringify([{ id: "a", videoId: "abcdefghijk", title: "Old" }]));
    localStorage.setItem("synapse_bookmarks", "[]");
    localStorage.setItem(MODE_KEY, "study");
    localStorage.setItem("synapse_intro_seen", "1");
    localStorage.setItem("synapse_quiz_text_scale", "1.3");
    localStorage.setItem("synapse_theme", "night");
    render(<App />);
    expect(screen.getByRole("heading", WELCOME)).toBeTruthy();
    // Their saved mode only seeds the choice.
    expect(screen.getByRole("button", { name: "Study mode" })).toHaveAttribute("aria-pressed", "true");
  });

  it("an existing user who skips keeps every setting they had", async () => {
    enable();
    localStorage.setItem(MODE_KEY, "study");
    localStorage.setItem("synapse_intro_seen", "1");
    localStorage.setItem("synapse_theme", "night");
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    await screen.findByRole("heading", HOME);
    expect(localStorage.getItem(MODE_KEY)).toBe("study");
    expect(localStorage.getItem("synapse_intro_seen")).toBe("1");
    expect(localStorage.getItem("synapse_theme")).toBe("night");
  });

  it("does not see it when the feature is switched off, with or without the completion flag", () => {
    vi.stubEnv("VITE_ONBOARDING_ENABLED", "0");
    const { unmount } = render(<App />);
    expect(screen.getByRole("heading", HOME)).toBeTruthy();
    expect(screen.queryByRole("heading", WELCOME)).toBeNull();
    unmount();

    localStorage.setItem(DONE_KEY, "1");
    render(<App />);
    expect(screen.getByRole("heading", HOME)).toBeTruthy();
    expect(screen.queryByRole("heading", WELCOME)).toBeNull();
  });

  it("switching it off writes nothing either", () => {
    vi.stubEnv("VITE_ONBOARDING_ENABLED", "false");
    render(<App />);
    expect(localStorage.getItem(MODE_KEY)).toBeNull();
    expect(localStorage.getItem(DONE_KEY)).toBeNull();
  });

  it("does not see it by default in the test runner, so the other App tests start on Home", () => {
    render(<App />);
    expect(screen.getByRole("heading", HOME)).toBeTruthy();
  });
});
