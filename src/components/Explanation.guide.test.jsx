// The "How this lecture works" card on the lecture screen. The real Explanation runs with a fake
// player, fake audio and a stub voice-notes panel (the same stand-ins the other lecture tests use).
//
// NOTE: the last test makes saving fail, and the flag is then kept in memory for the rest of this
// file's module state, so it must stay last.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import Explanation from "./Explanation";
import "../test/domMatchers.js";

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
  }
  class FakeAudio {
    static instances = [];
    constructor(url) {
      this.url = url;
      this.currentTime = 0;
      this.duration = 10;
      this.playbackRate = 1;
      this.paused = true;
      this.play = vi.fn(() => { this.paused = false; return Promise.resolve(); });
      this.pause = vi.fn(() => { this.paused = true; });
      FakeAudio.instances.push(this);
    }
    addEventListener() {}
    removeEventListener() {}
  }
  return { players, FakePlayer, FakeAudio, control: null };
});

vi.mock("../lib/youtubeIframeApi", () => ({
  loadYouTubeIframeAPI: () => Promise.resolve({ Player: h.FakePlayer }),
}));

vi.mock("../api", () => ({
  getInterventionPoints: vi.fn(async () => ({
    videoTitle: "The Animal Cell",
    duration: "19:13",
    author: "A. Teacher",
    points: [
      { id: "p1", category: "diagram", timestamp: "0:10", title: "First diagram" },
      { id: "p2", category: "graph", timestamp: "0:50", title: "Second graph" },
    ],
  })),
  getExplanation: vi.fn(async (pointId) => ({ pointId, subtitle: "A subtitle", paragraphs: ["Paragraph one."], keyInsight: "A key insight." })),
  getTTSExplanation: vi.fn(async () => ({ text_explanation: "x", audio_file_path: "blob:tts", output_mode: "standard" })),
  getExplanationPreparationStatus: vi.fn(async () => ({
    items: [
      { intervention_id: "p1", timestamp: 10, status: "ready", error_code: null, attempt_count: 1 },
      { intervention_id: "p2", timestamp: 50, status: "ready", error_code: null, attempt_count: 1 },
    ],
  })),
  getPreparedExplanation: vi.fn(async (pointId) => ({
    explanation: { pointId, subtitle: "A subtitle", paragraphs: ["Paragraph one."], keyInsight: "A key insight." },
    audio: { audio_file_path: "blob:tts", audio_error: null },
  })),
  retryExplanationPreparation: vi.fn(),
}));

vi.mock("./VoiceNotes", () => ({
  default: function VoiceNotesStub(props) {
    useEffect(() => {
      props.controlRef.current = h.control;
      return () => { props.controlRef.current = null; };
    });
    return <div data-testid="voice-notes-stub" />;
  },
}));

const GUIDE_KEY = "synapse_guide_dismissed";
const INTRO_KEY = "synapse_intro_seen";
const MODE_KEY = "synapse_presentation_mode";

beforeEach(() => {
  vi.useFakeTimers();
  h.players.length = 0;
  h.FakeAudio.instances = [];
  h.control = { toggle: vi.fn(), lectureStarted: vi.fn(() => false), requestLeave: vi.fn((go) => go()) };
  vi.stubGlobal("Audio", h.FakeAudio);
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

const settle = (ms = 1000) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

async function open(props = {}) {
  const utils = render(
    <Explanation jobId="job-1" videoId="5ugDJhmmkFM" mode="standard" onNavigate={() => {}} {...props} />,
  );
  await settle();
  return utils;
}

const card = () => screen.queryByRole("region", { name: "How this lecture works" });
const liveText = () => screen.getAllByRole("status").map((el) => el.textContent).join(" | ");

describe("what the card says", () => {
  it("appears once the moments have loaded, as a labelled section with a level-2 heading and two buttons", async () => {
    await open({ onOpenHelp: () => {} });
    expect(card()).toBeTruthy();
    expect(within(card()).getByRole("heading", { level: 2, name: "How this lecture works" })).toBeTruthy();
    expect(within(card()).getByRole("button", { name: "Got it" })).toBeTruthy();
    expect(within(card()).getByRole("button", { name: "Open Help" })).toBeTruthy();
  });

  it("Accessibility mode (the default): step 1 names the Play lecture button", async () => {
    await open();
    const steps = within(card()).getAllByRole("listitem").map((li) => li.textContent);
    expect(steps).toEqual([
      "Press Play lecture (Alt+P) to begin.",
      "Synapse pauses at each diagram, equation or chart and shows the explanation. The explanation audio may start by itself when it is ready. Press the Listen button (Alt+L) to pause or replay it.",
      "Press Alt+K to hear all keyboard shortcuts.",
    ]);
  });

  it("Study mode: only step 1 changes", async () => {
    localStorage.setItem(MODE_KEY, "study");
    await open();
    const steps = within(card()).getAllByRole("listitem").map((li) => li.textContent);
    expect(steps[0]).toBe("Press play on the video, or Alt+P, to begin.");
    expect(steps).toHaveLength(3);
    expect(steps[2]).toBe("Press Alt+K to hear all keyboard shortcuts.");
  });

  it("follows the mode when the learner switches it", async () => {
    await open();
    expect(within(card()).getAllByRole("listitem")[0].textContent).toBe("Press Play lecture (Alt+P) to begin.");
    fireEvent.click(screen.getByRole("button", { name: "Study mode" }));
    await settle(50);
    expect(within(card()).getAllByRole("listitem")[0].textContent).toBe("Press play on the video, or Alt+P, to begin.");
  });

  it("Accessibility mode: sits after the moment's subtitle and before the Presentation mode buttons", async () => {
    await open();
    const subtitle = screen.getByText("A subtitle");
    const modeGroup = screen.getByRole("group", { name: "Presentation mode" });
    expect(subtitle.compareDocumentPosition(card()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card().compareDocumentPosition(modeGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Study mode: sits AFTER the video and before the Visual View tabs, so it does not push the video down", async () => {
    localStorage.setItem(MODE_KEY, "study");
    await open();
    const modeGroup = screen.getByRole("group", { name: "Presentation mode" });
    const video = document.getElementById("lecture-video-region");
    const tabs = screen.getByRole("tablist", { name: "Visual content view" });
    expect(video).toBeTruthy();
    expect(modeGroup.compareDocumentPosition(video) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(video.compareDocumentPosition(card()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card().compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // the card is no longer between the subtitle and the video
    const subtitle = screen.getByText("A subtitle");
    expect(subtitle.compareDocumentPosition(video) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card().compareDocumentPosition(video) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("is rendered exactly once in each mode", async () => {
    await open();
    expect(screen.getAllByRole("region", { name: "How this lecture works" })).toHaveLength(1);
    expect(document.querySelectorAll("#guide-heading")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Study mode" }));
    await settle(50);
    expect(screen.getAllByRole("region", { name: "How this lecture works" })).toHaveLength(1);
    expect(document.querySelectorAll("#guide-heading")).toHaveLength(1);
  });

  it("moves, without being duplicated or lost, each time the mode is switched while it is open", async () => {
    await open({ onOpenHelp: () => {} });
    const video = () => document.getElementById("lecture-video-region");
    const modeGroup = () => screen.getByRole("group", { name: "Presentation mode" });
    const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    for (const round of [1, 2]) {
      // Accessibility: before the mode buttons
      expect(screen.getAllByRole("region", { name: "How this lecture works" }), `round ${round} accessibility`).toHaveLength(1);
      expect(follows(card(), modeGroup())).toBe(true);

      fireEvent.click(screen.getByRole("button", { name: "Study mode" }));
      await settle(50);
      // Study: after the video
      expect(screen.getAllByRole("region", { name: "How this lecture works" }), `round ${round} study`).toHaveLength(1);
      expect(follows(video(), card())).toBe(true);
      expect(within(card()).getByRole("button", { name: "Got it" })).toBeTruthy();
      expect(within(card()).getByRole("button", { name: "Open Help" })).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Accessibility mode" }));
      await settle(50);
    }
    expect(localStorage.getItem(GUIDE_KEY)).toBeNull(); // switching modes never dismisses it
  });

  it("is still dismissible after being moved: Got it in the moved position removes the only card", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Study mode" }));
    await settle(50);
    fireEvent.click(within(card()).getByRole("button", { name: "Got it" }));
    expect(card()).toBeNull();
    expect(screen.queryAllByRole("region", { name: "How this lecture works" })).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Accessibility mode" }));
    await settle(50);
    expect(card()).toBeNull(); // and it does not come back in the other mode
  });

  it("has no accessibility violations", async () => {
    await open({ onOpenHelp: () => {} });
    vi.useRealTimers(); // axe schedules its own timers
    expect(await axe(card())).toHaveNoViolations();
  });
});

describe("when it is shown", () => {
  it("not while the lecture is still being prepared", async () => {
    await open({ promise: new Promise(() => {}), processingStatus: { message: "Preparing." } });
    expect(card()).toBeNull();
  });

  it("not when preparing failed", async () => {
    await open({ promise: Promise.reject(new Error("boom")) });
    expect(screen.getByRole("alert").textContent).toMatch(/boom/);
    expect(card()).toBeNull();
  });

  it("not once it has been dismissed (its own flag)", async () => {
    localStorage.setItem(GUIDE_KEY, "1");
    await open();
    expect(card()).toBeNull();
  });

  it("is not hidden by synapse_intro_seen: that flag belongs to the spoken introduction", async () => {
    localStorage.setItem(INTRO_KEY, "1");
    await open();
    expect(card()).toBeTruthy();
  });
});

describe("it never speaks or moves focus by itself", () => {
  it("takes no focus, adds nothing to the live region, and starts no audio", async () => {
    await open();
    expect(card()).toBeTruthy();
    expect(document.activeElement).toBe(document.body);
    expect(liveText()).not.toMatch(/How this lecture works|Got it/);
    expect(h.FakeAudio.instances.every((a) => a.play.mock.calls.length === 0)).toBe(true);
    expect(h.players[0].playVideo).not.toHaveBeenCalled();
  });

  it("the card itself is not a live region", async () => {
    await open();
    const live = "[aria-live], [role='status'], [role='alert'], [role='log']";
    expect(card().matches(live)).toBe(false);
    expect(card().querySelector(live)).toBeNull();
  });
});

describe("the existing spoken introduction is untouched", () => {
  it("first lecture in Accessibility mode: still said once, and still marked with synapse_intro_seen", async () => {
    await open();
    expect(localStorage.getItem(INTRO_KEY)).toBe("1");
    expect(liveText()).toContain(
      "Press Play lecture to begin. It pauses at each visual; then read the explanation below or use the Listen button. Press Alt plus K for keyboard shortcuts.",
    );
    expect(card()).toBeTruthy(); // the card and the spoken sentence both exist
  });

  it("Study mode: not spoken and not marked, exactly as before", async () => {
    localStorage.setItem(MODE_KEY, "study");
    await open();
    expect(localStorage.getItem(INTRO_KEY)).toBeNull();
    expect(liveText()).not.toContain("Press Play lecture to begin.");
  });

  it("Got it never writes or clears synapse_intro_seen", async () => {
    localStorage.setItem(MODE_KEY, "study"); // no spoken intro in this mode, so the key stays unset
    await open();
    fireEvent.click(within(card()).getByRole("button", { name: "Got it" }));
    expect(localStorage.getItem(INTRO_KEY)).toBeNull();
    localStorage.setItem(INTRO_KEY, "1");
    expect(localStorage.getItem(INTRO_KEY)).toBe("1");
  });
});

describe("Open Help", () => {
  it("is only there when the screen can open Help, and calls it with the click", async () => {
    const { unmount } = await open();
    expect(screen.queryByRole("button", { name: "Open Help" })).toBeNull();
    unmount();

    let clickedButton = null; // React clears event.currentTarget once the handler returns
    const onOpenHelp = vi.fn((event) => { clickedButton = event.currentTarget; });
    await open({ onOpenHelp });
    const button = screen.getByRole("button", { name: "Open Help" });
    fireEvent.click(button);
    expect(onOpenHelp).toHaveBeenCalledTimes(1);
    expect(clickedButton).toBe(button);
    expect(card()).toBeTruthy(); // opening Help does not dismiss it
  });
});

describe("Got it", () => {
  it("saves its own flag, hides the card, moves focus to the Accessibility mode button, and says one short thing", async () => {
    await open();
    await settle(6000); // let the existing "Lecture ready" message clear
    fireEvent.click(within(card()).getByRole("button", { name: "Got it" }));

    expect(localStorage.getItem(GUIDE_KEY)).toBe("1");
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Accessibility mode" }));
    await settle(100);
    expect(liveText()).toContain("Guide hidden. Help has the same information.");
  });

  it("Study mode: focus goes to the SELECTED button, Study mode (not the unselected Accessibility one)", async () => {
    localStorage.setItem(MODE_KEY, "study");
    await open();
    fireEvent.click(within(card()).getByRole("button", { name: "Got it" }));
    expect(card()).toBeNull();
    const study = screen.getByRole("button", { name: "Study mode" });
    expect(study).toHaveAttribute("aria-pressed", "true");
    expect(document.activeElement).toBe(study);
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Accessibility mode" }));
  });

  it("follows the mode that is selected NOW: switch while the card is open, then Got it", async () => {
    await open();
    await settle(6000);
    fireEvent.click(screen.getByRole("button", { name: "Study mode" }));
    await settle(50);
    fireEvent.click(within(card()).getByRole("button", { name: "Got it" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Study mode" }));

    // ...and the other way round, with a fresh lecture screen that starts in Study mode
    cleanup();
    localStorage.clear();
    localStorage.setItem(MODE_KEY, "study");
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Accessibility mode" }));
    await settle(50);
    fireEvent.click(within(card()).getByRole("button", { name: "Got it" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Accessibility mode" }));
  });

  it("the focused button is the one that is pressed, in both modes, and the pressed state is unchanged", async () => {
    for (const mode of ["accessibility", "study"]) {
      cleanup();
      localStorage.clear();
      localStorage.setItem(MODE_KEY, mode);
      await open();
      fireEvent.click(within(card()).getByRole("button", { name: "Got it" }));
      expect(document.activeElement.getAttribute("aria-pressed"), mode).toBe("true");
      expect(localStorage.getItem(MODE_KEY), `${mode}: Got it must not change the mode`).toBe(mode);
    }
  });

  it("stays dismissed when the lecture screen is opened again", async () => {
    const first = await open();
    fireEvent.click(within(card()).getByRole("button", { name: "Got it" }));
    first.unmount();
    await open();
    expect(card()).toBeNull();
  });

  it("does not touch the presentation mode or play anything", async () => {
    localStorage.setItem(MODE_KEY, "study");
    await open();
    fireEvent.click(within(card()).getByRole("button", { name: "Got it" }));
    expect(localStorage.getItem(MODE_KEY)).toBe("study");
    expect(h.players[0].playVideo).not.toHaveBeenCalled();
    expect(h.FakeAudio.instances.every((a) => a.play.mock.calls.length === 0)).toBe(true);
  });
});

describe("when the flag cannot be saved (keep this test last: it leaves the flag in memory)", () => {
  it("the card still goes away, and stays away for the rest of the session", async () => {
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
      if (key === GUIDE_KEY) throw new Error("QuotaExceededError");
      return original.call(this, key, value);
    });
    const first = await open();
    fireEvent.click(within(card()).getByRole("button", { name: "Got it" }));
    expect(card()).toBeNull();
    expect(localStorage.getItem(GUIDE_KEY)).toBeNull();
    first.unmount();
    await open();
    expect(card()).toBeNull();
  });
});
