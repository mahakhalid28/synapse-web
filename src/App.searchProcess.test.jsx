import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App.jsx";

const SAMPLE_SEARCH_RESULTS = [
  {
    videoId: "vid_short_1",
    video_id: "vid_short_1",
    title: "Intro to Calculus Part 1",
    channel: "3Blue1Brown",
    channel_name: "3Blue1Brown",
    duration: "04:13",
    durationSeconds: 253,
    thumbnailUrl: "https://img.youtube.com/vi/vid_short_1/mqdefault.jpg",
    canonicalUrl: "https://www.youtube.com/watch?v=vid_short_1",
  },
];

const h = vi.hoisted(() => {
  const processVideo = vi.fn();
  const getInterventionPoints = vi.fn(async () => ({
    videoTitle: "Intro to Calculus Part 1",
    duration: "4:13",
    author: "3Blue1Brown",
    points: [
      {
        id: "pt-1",
        category: "graph",
        timestamp: "1:15",
        title: "Slope visualization",
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
      setTimeout(() => options.events?.onReady?.({ target: this }), 0);
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
    items: [{ intervention_id: "pt-1", timestamp: 75, status: "ready", error_code: null, attempt_count: 1 }],
  })),
  getPreparedExplanation: vi.fn(async (pointId) => ({
    explanation: { pointId, subtitle: "Saved explanation", paragraphs: ["Explanation text."], keyInsight: "Key insight." },
    audio: { audio_file_path: null, audio_error: null },
  })),
  retryExplanationPreparation: vi.fn(),
}));

vi.mock("./lib/lectureSearch.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    searchVideos: vi.fn(async () => SAMPLE_SEARCH_RESULTS),
  };
});

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

describe("Real YouTube Lecture Search and One-Click Processing Flow", () => {
  beforeEach(() => {
    localStorage.clear();
    h.processVideo.mockReset();
    h.getInterventionPoints.mockClear();
    vi.stubGlobal(
      "Audio",
      vi.fn().mockImplementation(() => ({
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
        load: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  });

  it("searches and selects a result, triggering one-click processing and opening player", async () => {
    h.processVideo.mockResolvedValueOnce({ jobId: "vid_short_1" });

    render(<App />);

    const input = screen.getByLabelText("Lecture link or search");

    // Type query
    fireEvent.change(input, { target: { value: "calculus" } });
    const searchBtn = screen.getByRole("button", { name: /Search lectures/i });
    fireEvent.click(searchBtn);

    // Wait for search result to appear
    await waitFor(() => {
      expect(screen.getByText("Intro to Calculus Part 1")).toBeTruthy();
    });

    expect(screen.getByText(/3Blue1Brown/)).toBeTruthy();
    expect(screen.getAllByText(/04:13/).length).toBeGreaterThanOrEqual(1);

    // Select the search result
    const resultButton = screen.getByRole("button", {
      name: /Intro to Calculus Part 1/i,
    });
    fireEvent.click(resultButton);

    // Verify processVideo was called exactly once with correct videoId, URL, and defaultDepth
    expect(h.processVideo).toHaveBeenCalledTimes(1);
    expect(h.processVideo).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://www.youtube.com/watch?v=vid_short_1",
      videoId: "vid_short_1",
      mode: "standard",
    }));

    // Verify repeated click while submitting is ignored
    fireEvent.click(resultButton);
    expect(h.processVideo).toHaveBeenCalledTimes(1);

    // Transition to Explanation screen and player
    await waitFor(() => {
      expect(h.getInterventionPoints).toHaveBeenCalled();
    });
    expect(screen.getByText(/by 3Blue1Brown/)).toBeTruthy();
  });

  it("displays actionable error UI on processing failure and allows Back to Home", async () => {
    h.processVideo.mockRejectedValueOnce(new Error("Backend processing failed"));

    render(<App />);

    const input = screen.getByLabelText("Lecture link or search");
    fireEvent.change(input, { target: { value: "calculus" } });
    const searchBtn = screen.getByRole("button", { name: /Search lectures/i });
    fireEvent.click(searchBtn);

    await waitFor(() => {
      expect(screen.getByText("Intro to Calculus Part 1")).toBeTruthy();
    });

    const resultButton = screen.getByRole("button", {
      name: /Intro to Calculus Part 1/i,
    });
    fireEvent.click(resultButton);

    // Shows processing error UI
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "Backend processing failed",
      );
    });

    const backHomeBtn = screen.getByRole("button", { name: "Back to Home" });
    fireEvent.click(backHomeBtn);

    // Returns to Home screen
    await waitFor(() => {
      expect(screen.getByText("Start a study session")).toBeTruthy();
    });
  });

  it("announces real backend stages without a percentage and aborts polling on cancel", async () => {
    let finishProcessing;
    h.processVideo.mockImplementationOnce((options) => {
      const pending = new Promise((resolve) => {
        finishProcessing = resolve;
      });
      queueMicrotask(() => options.onStatus({
        jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        status: "running",
        stage: "persisting",
        message: "Saving the lecture and intervention moments.",
      }));
      return pending;
    });

    render(<App />);
    const input = screen.getByLabelText("Lecture link or search");
    fireEvent.change(input, {
      target: { value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Start learning/i }));

    const stage = await screen.findByText("Saving the lecture and intervention moments.");
    expect(stage.getAttribute("role")).toBe("status");
    expect(stage.textContent).not.toContain("%");
    const signal = h.processVideo.mock.calls[0][0].signal;
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(signal.aborted).toBe(true);
    finishProcessing({ jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    await screen.findByText("Start a study session");
  });

  it("retries the same durable job after a processing failure", async () => {
    const failed = new Error("Synapse could not process this lecture. You can retry the job.");
    h.processVideo
      .mockImplementationOnce((options) => Promise.resolve().then(() => {
        options.onStatus({
          jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          status: "failed",
          stage: "failed",
          message: "Lecture processing failed.",
        });
        throw failed;
      }))
      .mockResolvedValueOnce({ jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });

    render(<App />);
    const input = screen.getByLabelText("Lecture link or search");
    fireEvent.change(input, {
      target: { value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Start learning/i }));

    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry processing" }));
    await waitFor(() => expect(h.processVideo).toHaveBeenCalledTimes(2));
    expect(h.processVideo.mock.calls[1][0]).toMatchObject({
      videoId: "dQw4w9WgXcQ",
      jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      retry: true,
    });
  });

  it("preserves URL paste workflow unchanged", async () => {
    h.processVideo.mockResolvedValueOnce({ jobId: "dQw4w9WgXcQ" });

    render(<App />);

    const input = screen.getByLabelText("Lecture link or search");
    fireEvent.change(input, {
      target: { value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    });

    // YouTube lecture detected indicator appears
    expect(screen.getByText("YouTube lecture detected")).toBeTruthy();

    const startBtn = screen.getByRole("button", { name: /Start learning/i });
    fireEvent.click(startBtn);

    expect(h.processVideo).toHaveBeenCalledTimes(1);
    expect(h.processVideo).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      videoId: "dQw4w9WgXcQ",
      mode: "standard",
    }));
  });

  it("shows an accessible validation error for a malformed YouTube URL", async () => {
    render(<App />);

    const input = screen.getByLabelText("Lecture link or search");
    fireEvent.change(input, {
      target: { value: "https://www.youtube.com/watch?v=too-short" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Search lectures/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Enter a valid YouTube video URL.");
    expect(h.processVideo).not.toHaveBeenCalled();
  });
});

