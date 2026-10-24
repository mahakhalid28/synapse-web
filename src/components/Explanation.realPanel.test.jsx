// Explanation with the REAL Voice Notes panel (only the YouTube player, the API
// and storage are stand-ins). jsdom has no microphone, so this checks the whole
// chain Alt+M -> panel -> recorder up to the point where the browser cannot
// record, and what the learner is told.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import Explanation from "./Explanation";

const h = vi.hoisted(() => {
  const players = [];
  class FakePlayer {
    constructor(_el, opts) {
      this.state = -1;
      this.time = 42.5;
      this.pauseVideo = vi.fn(() => { this.state = 2; });
      this.playVideo = vi.fn();
      this.seekTo = vi.fn();
      this.cueVideoById = vi.fn();
      this.getCurrentTime = vi.fn(() => this.time);
      this.getPlayerState = vi.fn(() => this.state);
      this.destroy = vi.fn();
      players.push(this);
      setTimeout(() => opts.events.onReady({ target: this }), 0);
    }
  }
  return { players, FakePlayer };
});

vi.mock("../lib/youtubeIframeApi", () => ({
  loadYouTubeIframeAPI: () => Promise.resolve({ Player: h.FakePlayer }),
}));
vi.mock("../api", () => ({
  getInterventionPoints: vi.fn(async () => ({
    videoTitle: "The Animal Cell", duration: "19:13", author: "A",
    points: [{ id: "p1", category: "diagram", timestamp: "0:10", title: "First diagram" }],
  })),
  getExplanation: vi.fn(async (pointId) => ({ pointId, subtitle: "S", paragraphs: ["P."], keyInsight: "K." })),
  getTTSExplanation: vi.fn(async () => ({ text_explanation: "x", audio_file_path: "blob:tts", output_mode: "standard" })),
  getExplanationPreparationStatus: vi.fn(async () => ({
    items: [{ intervention_id: "p1", timestamp: 10, status: "ready", error_code: null, attempt_count: 1 }],
  })),
  getPreparedExplanation: vi.fn(async (pointId) => ({
    explanation: { pointId, subtitle: "S", paragraphs: ["P."], keyInsight: "K." },
    audio: { audio_file_path: "blob:tts", audio_error: null },
  })),
  retryExplanationPreparation: vi.fn(),
}));
vi.mock("../lib/notesStore.js", () => ({
  listNotesForVideo: vi.fn(async () => []),
  deleteNote: vi.fn(),
  getNoteAudio: vi.fn(),
  saveNote: vi.fn(),
  newNoteId: vi.fn(() => "id"),
}));

beforeEach(() => {
  vi.useFakeTimers();
  h.players.length = 0;
  vi.stubGlobal("Audio", class { constructor() { this.play = vi.fn(() => Promise.resolve()); this.pause = vi.fn(); this.addEventListener = vi.fn(); this.removeEventListener = vi.fn(); } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const settle = (ms = 1000) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe("Explanation with the real Voice Notes panel", () => {
  it("shows the panel inside the lecture screen", async () => {
    render(<Explanation jobId="j" videoId="5ugDJhmmkFM" mode="standard" />);
    await settle();
    expect(screen.getByRole("heading", { level: 2, name: "Voice notes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Record voice note" })).toBeTruthy();
    expect(screen.getByText("No voice notes for this lecture yet.")).toBeTruthy();
  });

  it("Alt+M reaches the real recorder: on a computer that cannot record, it says so and leaves the lecture alone", async () => {
    render(<Explanation jobId="j" videoId="5ugDJhmmkFM" mode="standard" />);
    await settle();
    const player = h.players[0];
    fireEvent.keyDown(window, { code: "KeyM", key: "m", altKey: true });
    await settle(300);
    // Shown on the page AND spoken once through the screen's single live region.
    expect(document.getElementById("voice-notes-error").textContent).toBe("This computer can't record audio in Synapse.");
    expect(player.pauseVideo).not.toHaveBeenCalled(); // nothing was paused for a recording that cannot happen
    expect(screen.getByRole("status").textContent).toBe("This computer can't record audio in Synapse.");
  });

  it("the record button and Alt+M do the same thing", async () => {
    render(<Explanation jobId="j" videoId="5ugDJhmmkFM" mode="standard" />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Record voice note" }));
    await settle(300);
    expect(document.getElementById("voice-notes-error").textContent).toBe("This computer can't record audio in Synapse.");
  });
});
