// Help as App wires it: the Navbar button, the modal over the CURRENT screen (which stays mounted),
// the inert background, focus coming back, and the lecture screen's guard reached through App.
// The YouTube player, processing and the voice-notes panel are fakes. jsdom does not implement
// `inert`, so only the attribute is checked here; its real effect needs the Electron run.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.jsx";
import { HELP_BLOCKED_RECORDING } from "./lib/onboardingText";
import "./test/domMatchers.js";

const h = vi.hoisted(() => {
  const players = [];
  class FakePlayer {
    constructor(_el, opts) {
      this.opts = opts;
      this.state = -1;
      this.pauseVideo = vi.fn(() => { this.state = 2; });
      this.playVideo = vi.fn(() => { this.state = 1; });
      this.seekTo = vi.fn();
      this.cueVideoById = vi.fn();
      this.getCurrentTime = vi.fn(() => 0);
      this.getPlayerState = vi.fn(() => this.state);
      this.destroy = vi.fn();
      players.push(this);
      setTimeout(() => opts.events.onReady({ target: this }), 0);
    }
    emit(data) { this.opts.events.onStateChange({ data, target: this }); }
  }
  return {
    players,
    FakePlayer,
    processVideo: vi.fn(),
    stub: { control: null, mounted: false },
  };
});

vi.mock("./api.js", () => ({
  processVideo: h.processVideo,
  resetMockTimer: vi.fn(),
  getInterventionPoints: vi.fn(),
  getExplanation: vi.fn(),
  getTTSExplanation: vi.fn(),
  getExplanationPreparationStatus: vi.fn(),
  getPreparedExplanation: vi.fn(),
  retryExplanationPreparation: vi.fn(),
}));

vi.mock("./lib/youtubeIframeApi.js", () => ({
  loadYouTubeIframeAPI: () => Promise.resolve({ Player: h.FakePlayer }),
}));

vi.mock("./lib/notesStore.js", () => ({
  listAllNotes: vi.fn(async () => []),
  listNotesForVideo: vi.fn(async () => []),
  deleteNote: vi.fn(),
  getNoteAudio: vi.fn(),
  saveNote: vi.fn(),
  newNoteId: vi.fn(() => "note-id"),
}));

vi.mock("./components/VoiceNotes", () => ({
  default: function VoiceNotesStub(props) {
    useEffect(() => {
      props.controlRef.current = h.stub.control;
      h.stub.mounted = true;
      return () => { props.controlRef.current = null; h.stub.mounted = false; };
    });
    return <div data-testid="voice-notes-stub" />;
  },
}));

const DONE_KEY = "synapse_onboarding_completed";
const MODE_KEY = "synapse_presentation_mode";
const HOME = { level: 1, name: "Start a study session" };

let signals;

beforeEach(() => {
  localStorage.clear();
  document.title = "Synapse";
  h.players.length = 0;
  signals = [];
  h.processVideo.mockReset();
  h.processVideo.mockImplementation(({ signal }) => {
    signals.push(signal);
    return new Promise(() => {}); // processing never finishes in these tests
  });
  h.stub.control = {
    toggle: vi.fn(),
    lectureStarted: vi.fn(() => false),
    requestLeave: vi.fn((go) => go()),
    beforeHelp: vi.fn(() => ({ blocked: false, stoppedNote: false })),
  };
  vi.stubGlobal("Audio", vi.fn());
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

const helpButton = () => screen.getByRole("button", { name: "Help" });
const dialog = () => screen.queryByRole("dialog");

async function startLecture() {
  render(<App />);
  fireEvent.change(screen.getByLabelText("Lecture link or search"), {
    target: { value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^Start learning/ }));
  await waitFor(() => expect(h.players.length).toBe(1));
  await waitFor(() => expect(h.stub.mounted).toBe(true));
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); // the player's onReady
  return h.players[0];
}

describe("the Help button", () => {
  it("is in the top bar on Home, after the skip link and before Settings", async () => {
    render(<App />);
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Skip to main content" }));
    await user.tab();
    expect(document.activeElement).toBe(helpButton());
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Settings" }));
  });
});

describe("opening and closing on Home", () => {
  it("opens a dialog, makes everything behind it inert, and puts focus on the title", async () => {
    render(<App />);
    expect(document.querySelector("[inert]")).toBeNull();
    await userEvent.click(helpButton());

    expect(dialog()).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "How Synapse works" }));
    const inert = document.querySelector("[inert]");
    expect(inert).toBeTruthy();
    expect(within(inert).getByRole("heading", HOME)).toBeTruthy();
    expect(within(inert).getByRole("button", { name: "Settings" })).toBeTruthy();
    expect(within(inert).getByRole("link", { name: "Skip to main content" })).toBeTruthy();
    expect(inert.contains(dialog())).toBe(false);
  });

  it("is described by nothing extra when it changed nothing", async () => {
    render(<App />);
    await userEvent.click(helpButton());
    expect(dialog().hasAttribute("aria-describedby")).toBe(false);
  });

  it("Close removes the inert and returns focus to the Help button", async () => {
    render(<App />);
    await userEvent.click(helpButton());
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(dialog()).toBeNull();
    expect(document.querySelector("[inert]")).toBeNull();
    expect(document.activeElement).toBe(helpButton());
  });

  it("Escape does the same", async () => {
    render(<App />);
    await userEvent.click(helpButton());
    await userEvent.keyboard("{Escape}");
    expect(dialog()).toBeNull();
    expect(document.querySelector("[inert]")).toBeNull();
    expect(document.activeElement).toBe(helpButton());
  });

  it("does not navigate: the same screen is there before and after", async () => {
    render(<App />);
    await userEvent.click(helpButton());
    expect(screen.getByRole("heading", HOME)).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("heading", HOME)).toBeTruthy();
    expect(document.title).toBe("Start a study session – Synapse");
  });

  it("can be opened again after closing", async () => {
    render(<App />);
    await userEvent.click(helpButton());
    await userEvent.keyboard("{Escape}");
    await userEvent.click(helpButton());
    expect(dialog()).toBeTruthy();
  });

  it("starts no audio and no speech", async () => {
    const audio = vi.fn();
    const speak = vi.fn();
    vi.stubGlobal("Audio", audio);
    vi.stubGlobal("speechSynthesis", { speak, cancel: vi.fn() });
    render(<App />);
    await userEvent.click(helpButton());
    await userEvent.keyboard("{Escape}");
    expect(audio).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
  });
});

describe("opened from Welcome", () => {
  beforeEach(() => vi.stubEnv("VITE_ONBOARDING_ENABLED", "1"));

  it("the 'How Synapse works' button opens it; closing returns focus there, and Welcome is untouched", async () => {
    render(<App />);
    const opener = screen.getByRole("button", { name: "How Synapse works" });
    await userEvent.click(opener);
    expect(dialog()).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(screen.getByRole("heading", { level: 1, name: "Welcome to Synapse" })).toBeTruthy();
    expect(localStorage.getItem(DONE_KEY)).toBeNull();
    expect(localStorage.getItem(MODE_KEY)).toBeNull();
  });
});

describe("opened over a lecture that is still being prepared", () => {
  it("keeps the lecture screen, the player and the processing job exactly as they were", async () => {
    const player = await startLecture();
    expect(signals).toHaveLength(1);
    const lectureHeading = screen.getByRole("heading", { level: 1 }).textContent;

    await userEvent.click(helpButton());
    expect(dialog()).toBeTruthy();
    expect(signals[0].aborted).toBe(false);
    expect(player.destroy).not.toHaveBeenCalled();
    expect(h.processVideo).toHaveBeenCalledTimes(1);

    await userEvent.keyboard("{Escape}");
    expect(signals[0].aborted).toBe(false);
    expect(player.destroy).not.toHaveBeenCalled();
    expect(h.players).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(lectureHeading);
    expect(document.activeElement).toBe(helpButton());
  });
});

describe("opened over a lecture that is playing", () => {
  it("pauses it through the lecture screen's guard, tells the dialog, and never resumes it", async () => {
    const player = await startLecture();
    player.state = 1;
    act(() => player.emit(1));

    await userEvent.click(helpButton());
    expect(player.pauseVideo).toHaveBeenCalledTimes(1);
    expect(dialog()).toHaveAccessibleDescription("Lecture paused while Help is open.");

    // YouTube starts it anyway while Help is open: it is paused again.
    player.state = 1;
    act(() => player.emit(1));
    expect(player.pauseVideo).toHaveBeenCalledTimes(2);

    await userEvent.keyboard("{Escape}");
    expect(player.playVideo).not.toHaveBeenCalled();
    expect(player.destroy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(helpButton());
    await waitFor(() =>
      expect(
        screen.getAllByRole("status").some((el) => el.textContent === "Help closed. Playback is still paused."),
      ).toBe(true),
    );
  });

  it("the lecture shortcuts do nothing while the dialog is open", async () => {
    const player = await startLecture();
    await userEvent.click(helpButton());
    fireEvent.keyDown(window, { code: "KeyP", key: "p", altKey: true });
    expect(player.playVideo).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    fireEvent.keyDown(window, { code: "KeyP", key: "p", altKey: true });
    expect(player.playVideo).toHaveBeenCalledTimes(1);
  });
});

describe("voice-note recording", () => {
  it("blocks Help: no dialog, nothing inert, focus stays on the button, and the reason is announced", async () => {
    h.stub.control.beforeHelp.mockReturnValue({ blocked: true, stoppedNote: false });
    const player = await startLecture();
    player.state = 1;
    act(() => player.emit(1));

    helpButton().focus();
    await userEvent.click(helpButton());

    expect(dialog()).toBeNull();
    // (the lecture's own hidden video region is already inert in Accessibility mode, so look at the shell)
    expect(helpButton().closest("[inert]")).toBeNull();
    expect(document.activeElement).toBe(helpButton());
    expect(player.pauseVideo).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getAllByRole("status").some((el) => el.textContent === HELP_BLOCKED_RECORDING)).toBe(true),
    );
  });

  it("allows Help again as soon as the recording is over", async () => {
    h.stub.control.beforeHelp.mockReturnValue({ blocked: true, stoppedNote: false });
    await startLecture();
    await userEvent.click(helpButton());
    expect(dialog()).toBeNull();
    h.stub.control.beforeHelp.mockReturnValue({ blocked: false, stoppedNote: false });
    await userEvent.click(helpButton());
    expect(dialog()).toBeTruthy();
  });
});
