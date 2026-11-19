// The spoken introduction on screens without a Talk control (Welcome, sign in, create account). Replies go to
// the live region (screen-reader feedback mode), so the test reads what would be spoken.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import ScreenIntro from "./ScreenIntro";
import { INTRO_SEEN_KEY, INTROS_KEY } from "./useScreenIntro";
import { screenIntro } from "./voiceMessages";
import "../test/domMatchers.js";

const settle = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const spoken = () => screen.getByRole("status").textContent;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem("synapse_voice_feedback", "screenreader");
});
afterEach(() => vi.useRealTimers());

describe("ScreenIntro", () => {
  it.each([
    ["welcome", /^Welcome to Synapse\. First, choose how you want to learn\..*say accessibility mode or study mode, then say get started/],
    ["login", /^Sign in to Synapse\. Press Alt plus T and say my username is, and then spell it\. Then type your password.*never taken by voice/],
    ["signup", /^Create a Synapse account\. Press Alt plus T and say my username is.*never taken by voice/],
    ["restoring", /^Checking your saved session\. Please wait\.$/],
  ])("explains what to do on the %s screen", async (name, expected) => {
    render(<ScreenIntro screen={name} />);
    expect(spoken()).toBe("");
    await settle(700);
    expect(spoken()).toMatch(expected);
  });

  it("says nothing when the learner has turned introductions off", async () => {
    localStorage.setItem(INTROS_KEY, "off");
    render(<ScreenIntro screen="login" />);
    await settle(700);
    expect(spoken()).toBe("");
  });

  it("gives the short version once the screen has been introduced before", async () => {
    localStorage.setItem(INTRO_SEEN_KEY, JSON.stringify(["login"]));
    render(<ScreenIntro screen="login" />);
    await settle(700);
    expect(spoken()).toBe("Sign in. Press Alt plus T and say your username, then type your password and press Enter.");
  });

  it("introduces the new screen when the learner moves from sign in to create account", async () => {
    const { rerender } = render(<ScreenIntro screen="login" />);
    await settle(700);
    rerender(<ScreenIntro screen="signup" />);
    await settle(700);
    expect(spoken()).toMatch(/^Create a Synapse account/);
  });

  it("still works when storage is unavailable", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation((key) => {
      if (key === INTRO_SEEN_KEY) throw new Error("blocked");
      return key === "synapse_voice_feedback" ? "screenreader" : null;
    });
    try {
      render(<ScreenIntro screen="welcome" />);
      await settle(700);
      expect(spoken()).toMatch(/^Welcome to Synapse\. First/);
    } finally {
      getItem.mockRestore();
    }
  });
});

describe("screenIntro texts", () => {
  it("mention counts only when the screen has items", () => {
    expect(screenIntro("bookmarks", { first: true, itemCount: 1 })).toMatch(/1 bookmark is listed/);
    expect(screenIntro("bookmarks", { first: true, itemCount: 0 })).toMatch(/say go home to find a lecture/);
    expect(screenIntro("timeline", { first: false, itemCount: 7 })).toBe("Timeline. 7 moments.");
  });

  it("have an introduction for every screen and nothing for unknown ones", () => {
    for (const name of ["welcome", "login", "signup", "restoring", "home", "subject", "explanation", "timeline", "bookmarks", "library", "notes", "quiz"]) {
      expect(screenIntro(name, { first: true })).not.toBe("");
      expect(screenIntro(name, { first: false })).not.toBe("");
    }
    expect(screenIntro("nowhere")).toBe("");
  });

  it("tell the learner to press Alt plus T, never Space", () => {
    for (const name of ["welcome", "home", "subject", "explanation", "timeline", "bookmarks", "library", "notes", "quiz"]) {
      expect(screenIntro(name, { first: true, itemCount: 2 })).not.toMatch(/Space/);
    }
  });
});
