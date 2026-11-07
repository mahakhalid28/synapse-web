import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Explanation from "./Explanation";

const h = vi.hoisted(() => {
  const players = [];
  const structured = {
    rows: [
      { label: "X-axis", value: "Time, in seconds" },
      { label: "Curve A", value: "Reaches approximately 40 m/s" },
    ],
  };
  const defaultPoints = [
    {
      id: "p1",
      category: "graph",
      timestamp: "0:10",
      title: "Velocity-time graph",
      structured,
    },
    {
      id: "p2",
      category: "code",
      timestamp: "0:50",
      title: "Gradient descent code",
    },
  ];

  class FakePlayer {
    constructor(_element, options) {
      this.state = -1;
      this.time = 0;
      this.pauseVideo = vi.fn(() => { this.state = 2; });
      this.playVideo = vi.fn(() => { this.state = 1; });
      this.seekTo = vi.fn();
      this.cueVideoById = vi.fn();
      this.getCurrentTime = vi.fn(() => this.time);
      this.getPlayerState = vi.fn(() => this.state);
      this.destroy = vi.fn();
      players.push(this);
      setTimeout(() => options.events.onReady({ target: this }), 0);
    }
  }

  class FakeAudio {
    constructor() {
      this.currentTime = 0;
      this.duration = 10;
      this.playbackRate = 1;
      this.play = vi.fn(() => Promise.resolve());
      this.pause = vi.fn();
    }
    addEventListener() {}
    removeEventListener() {}
  }

  return {
    defaultPoints,
    players,
    structured,
    demoEnabled: false,
    FakeAudio,
    FakePlayer,
  };
});

vi.mock("../lib/apiConfig", async (importOriginal) => ({
  ...(await importOriginal()),
  API_MOCK_MODE: true,
}));

vi.mock("../lib/structuredViewDemo", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveStructuredView: (point) =>
      actual.resolveStructuredView(point, h.demoEnabled),
  };
});

vi.mock("../lib/youtubeIframeApi", () => ({
  loadYouTubeIframeAPI: () => Promise.resolve({
    Player: h.FakePlayer,
    PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0, BUFFERING: 3 },
  }),
}));

vi.mock("../api", () => ({
  getInterventionPoints: vi.fn(async () => ({
    videoTitle: "Structured view fixture",
    duration: "2:00",
    author: "Teacher",
    points: h.defaultPoints,
  })),
  getExplanation: vi.fn(async (pointId) => ({
    pointId,
    subtitle: `${pointId} subtitle`,
    paragraphs: [`${pointId} explanation remains visible.`],
    keyInsight: "Fixture insight.",
  })),
  getTTSExplanation: vi.fn(async () => ({
    text_explanation: "fixture",
    audio_file_path: "blob:tts",
    output_mode: "standard",
  })),
  getExplanationPreparationStatus: vi.fn(),
  getPreparedExplanation: vi.fn(),
  retryExplanationPreparation: vi.fn(),
}));

vi.mock("../storage", () => ({
  STORAGE_CHANGED_EVENT: "synapse-storage-changed",
  getBookmarks: vi.fn(() => []),
  getLibrary: vi.fn(() => []),
  saveBookmark: vi.fn(),
  removeBookmark: vi.fn(),
  isBookmarked: vi.fn(() => false),
  saveToLibrary: vi.fn(),
}));

vi.mock("./AskLecture", () => ({ default: () => null }));
vi.mock("./VoiceNotes", () => ({ default: () => null }));

function renderExplanation(props = {}) {
  return render(
    <Explanation
      jobId="fixture-job"
      videoId="fixture-video"
      pointId="p1"
      mode="standard"
      {...props}
    />,
  );
}

async function renderStudyMode(props = {}) {
  localStorage.setItem("synapse_presentation_mode", "study");
  renderExplanation(props);
  await screen.findByText(`${props.pointId ?? "p1"} explanation remains visible.`);
}

beforeEach(() => {
  localStorage.clear();
  h.players.length = 0;
  h.demoEnabled = false;
  vi.stubGlobal("Audio", h.FakeAudio);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("original Structured View", () => {
  it("renders Study Mode tabs with Visual View selected and preserves the player and explanation", async () => {
    await renderStudyMode();

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Visual View", "Structured View"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[0].getAttribute("aria-controls")).toBe("visual-tabpanel-visual");
    expect(screen.getByRole("tabpanel", { name: "Visual View" })).toBeTruthy();
    expect(screen.getByText("p1 explanation remains visible.")).toBeTruthy();
    await waitFor(() => expect(h.players).toHaveLength(1));
  });

  it("switches to the original factual label/value view with video provenance", async () => {
    await renderStudyMode();
    fireEvent.click(screen.getByRole("tab", { name: "Structured View" }));

    const structuredTab = screen.getByRole("tab", { name: "Structured View" });
    expect(structuredTab.getAttribute("aria-selected")).toBe("true");
    expect(structuredTab.getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("tabpanel", { name: "Structured View" })).toBeTruthy();
    expect(screen.getByText("From the video")).toBeTruthy();
    expect(screen.getByText("X-axis")).toBeTruthy();
    expect(screen.getByText("Time, in seconds")).toBeTruthy();
    expect(screen.getByText("Curve A")).toBeTruthy();
    expect(screen.getByText("Reaches approximately 40 m/s")).toBeTruthy();
    expect(screen.getByText("p1 explanation remains visible.")).toBeTruthy();
  });

  it("implements automatic ARIA tab activation for arrows, Home, and End", async () => {
    await renderStudyMode();
    const visual = screen.getByRole("tab", { name: "Visual View" });
    const structured = screen.getByRole("tab", { name: "Structured View" });

    visual.focus();
    fireEvent.keyDown(visual, { key: "ArrowRight" });
    expect(document.activeElement).toBe(structured);
    expect(structured.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(structured, { key: "Home" });
    expect(document.activeElement).toBe(visual);
    expect(visual.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(visual, { key: "End" });
    expect(document.activeElement).toBe(structured);
    fireEvent.keyDown(structured, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(visual);
    fireEvent.keyDown(visual, { key: "ArrowUp" });
    expect(document.activeElement).toBe(structured);
    fireEvent.keyDown(structured, { key: "ArrowDown" });
    expect(document.activeElement).toBe(visual);
  });

  it("omits Structured View for an intervention without structured rows", async () => {
    await renderStudyMode({ pointId: "p2" });
    await screen.findByText("p2 explanation remains visible.");

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Visual View"]);
    expect(screen.queryByRole("tab", { name: "Structured View" })).toBeNull();
    expect(screen.getByRole("tabpanel", { name: "Visual View" })).toBeTruthy();
  });

  it("presents the same rows as ordinary content in Accessibility Mode and retains high-contrast styling", async () => {
    renderExplanation();
    await screen.findByText("p1 explanation remains visible.");

    expect(screen.queryByRole("tablist", { name: "Visual content view" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Accessible visual information" })).toBeTruthy();
    expect(screen.getByText("From the video")).toBeTruthy();
    expect(screen.getByText("Time, in seconds")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Study mode" }));
    fireEvent.click(screen.getByRole("button", { name: "High contrast" }));
    fireEvent.click(screen.getByRole("tab", { name: "Structured View" }));
    expect(screen.getByText("Time, in seconds").className).toContain("text-black");
  });

  it("uses the original Accessibility Mode fallback when rows are unavailable", async () => {
    renderExplanation({ pointId: "p2" });
    await screen.findByText("p2 explanation remains visible.");

    expect(screen.getByRole("heading", { name: "Accessible visual information" })).toBeTruthy();
    expect(screen.getByText(/A detailed description of this visual isn.t available/)).toBeTruthy();
    expect(screen.queryByText("From the video")).toBeNull();
  });

  it("shows clearly labeled demo rows in both presentations when the dedicated flag is enabled", async () => {
    h.demoEnabled = true;
    await renderStudyMode({ pointId: "p2" });

    fireEvent.click(screen.getByRole("tab", { name: "Structured View" }));
    expect(screen.getByText("Demo data — example only, not extracted from this video")).toBeTruthy();
    expect(screen.getByText("Arrow direction")).toBeTruthy();
    expect(screen.queryByText("From the video")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Accessibility mode" }));
    expect(screen.queryByRole("tablist", { name: "Visual content view" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Accessible visual information" })).toBeTruthy();
    expect(screen.getByText("Demo data — example only, not extracted from this video")).toBeTruthy();
    expect(screen.getByText("Arrow direction")).toBeTruthy();
  });

  it("never replaces valid backend structured rows with demo rows", async () => {
    h.demoEnabled = true;
    await renderStudyMode();
    fireEvent.click(screen.getByRole("tab", { name: "Structured View" }));

    expect(screen.getByText("From the video")).toBeTruthy();
    expect(screen.getByText("X-axis")).toBeTruthy();
    expect(screen.queryByText("Arrow direction")).toBeNull();
    expect(screen.queryByText(/Demo data/)).toBeNull();
  });

  it("does not displace the existing processing Cancel control", () => {
    localStorage.setItem("synapse_presentation_mode", "study");
    const neverSettles = new Promise(() => {});
    renderExplanation({
      promise: neverSettles,
      processingStatus: { status: "running", message: "Processing lecture" },
      onCancelProcessing: vi.fn(),
    });

    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });
});
