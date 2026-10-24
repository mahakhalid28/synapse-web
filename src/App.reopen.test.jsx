import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App.jsx";

const VIDEO_ID = "aircAruvnKk";
const POINT_ID = "3f2b8c1e-5d4a-4e7b-9a10-2c6d8e9f0a1b";

const h = vi.hoisted(() => {
  const processVideo = vi.fn();
  const getInterventionPoints = vi.fn(async () => ({
    videoTitle: "",
    duration: "",
    author: "",
    thumbnailUrl: "",
    metadataError: "Can't reach the Synapse server to load video details.",
    points: [
      {
        id: "3f2b8c1e-5d4a-4e7b-9a10-2c6d8e9f0a1b",
        category: "diagram",
        timestamp: "0:10",
        title: "Saved moment",
      },
    ],
  }));
  class FakePlayer {
    constructor(_element, options) {
      this.pauseVideo = vi.fn();
      this.playVideo = vi.fn();
      this.seekTo = vi.fn();
      this.cueVideoById = vi.fn();
      this.getCurrentTime = vi.fn(() => 0);
      this.getPlayerState = vi.fn(() => -1);
      this.destroy = vi.fn();
      setTimeout(() => options.events.onReady({ target: this }), 0);
    }
  }
  return { processVideo, getInterventionPoints, FakePlayer };
});

vi.mock("./api.js", () => ({
  processVideo: h.processVideo,
  resetMockTimer: vi.fn(),
  getInterventionPoints: h.getInterventionPoints,
  getExplanation: vi.fn(async (pointId) => ({
    pointId,
    subtitle: "Saved explanation",
    paragraphs: ["Explanation text."],
    keyInsight: "Key insight.",
  })),
  getTTSExplanation: vi.fn(async () => ({
    text_explanation: "Saved explanation",
    audio_file_path: null,
    output_mode: "standard",
  })),
  getExplanationPreparationStatus: vi.fn(async () => ({
    items: [{ intervention_id: "3f2b8c1e-5d4a-4e7b-9a10-2c6d8e9f0a1b", timestamp: 10, status: "ready", error_code: null, attempt_count: 1 }],
  })),
  getPreparedExplanation: vi.fn(async (pointId) => ({
    explanation: { pointId, subtitle: "Saved explanation", paragraphs: ["Explanation text."], keyInsight: "Key insight." },
    audio: { audio_file_path: null, audio_error: "Explanation audio is unavailable. You can still read the explanation." },
  })),
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

const savedItem = {
  id: `${VIDEO_ID}-${POINT_ID}`,
  pointId: POINT_ID,
  videoId: VIDEO_ID,
  jobId: VIDEO_ID,
  videoTitle: "Saved lecture",
  videoAuthor: "Saved lecturer",
  videoDuration: "2:05",
  videoThumbnail: "https://i.ytimg.com/saved-thumbnail.jpg",
  title: "Saved moment",
  category: "diagram",
  timestamp: "0:10",
  mode: "standard",
  explanation: {
    pointId: POINT_ID,
    subtitle: "Saved explanation",
    paragraphs: ["Explanation text."],
    keyInsight: "Key insight.",
  },
  savedAt: 1_700_000_000_000,
};

beforeEach(() => {
  localStorage.clear();
  h.processVideo.mockReset();
  h.getInterventionPoints.mockClear();
  vi.stubGlobal(
    "Audio",
    class {
      play = vi.fn(() => Promise.resolve());
      pause = vi.fn();
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
    },
  );
});

describe("saved lecture reopen", () => {
  it("opens a Library entry after restart without processing the video", async () => {
    localStorage.setItem("synapse_library", JSON.stringify([savedItem]));
    render(<App />);

    fireEvent.click(screen.getAllByRole("button", { name: "Library" })[0]);
    await screen.findByRole("heading", { name: "My Library" });
    fireEvent.click(screen.getByRole("button", { name: /Read text: Saved moment/ }));

    await waitFor(() => expect(h.getInterventionPoints).toHaveBeenCalledWith(VIDEO_ID, VIDEO_ID));
    expect(h.processVideo).not.toHaveBeenCalled();
    expect(screen.getByText("Saved lecture")).toBeTruthy();
    expect(screen.getByText(/by Saved lecturer/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Study mode" }));
    expect(document.querySelector('img[src="https://i.ytimg.com/saved-thumbnail.jpg"]')).toBeTruthy();
    expect(
      screen.getAllByRole("alert").some((alert) =>
        alert.textContent.includes("Playback remains available with the saved lecture details."),
      ),
    ).toBe(true);
  });

  it("opens a Bookmark after restart without processing the video", async () => {
    localStorage.setItem("synapse_bookmarks", JSON.stringify([savedItem]));
    render(<App />);

    fireEvent.click(screen.getAllByRole("button", { name: /^Bookmarks/ })[0]);
    await screen.findByRole("heading", { name: "Your saved explanations." });
    fireEvent.click(screen.getByRole("button", { name: /Open Saved moment/ }));

    await waitFor(() => expect(h.getInterventionPoints).toHaveBeenCalledWith(VIDEO_ID, VIDEO_ID));
    expect(h.processVideo).not.toHaveBeenCalled();
  });
});
