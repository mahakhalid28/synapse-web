import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Explanation from "./Explanation";

const h = vi.hoisted(() => {
  const players = [];
  const getStatus = vi.fn();
  const getPrepared = vi.fn();
  const retry = vi.fn();
  const points = [
    { id: "p1", category: "diagram", timestamp: "0:10", title: "First diagram" },
    { id: "p2", category: "graph", timestamp: "0:50", title: "Second graph" },
  ];

  class FakePlayer {
    constructor(_element, options) {
      this.options = options;
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
    static instances = [];
    constructor(url) {
      this.url = url;
      this.currentTime = 0;
      this.duration = 10;
      this.playbackRate = 1;
      this.listeners = {};
      this.play = vi.fn(() => Promise.resolve());
      this.pause = vi.fn();
      FakeAudio.instances.push(this);
    }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
    removeEventListener() {}
  }

  return { players, getStatus, getPrepared, retry, points, FakePlayer, FakeAudio };
});

const status = (state, id = "p1", timestamp = id === "p1" ? 10 : 50) => ({
  intervention_id: id,
  timestamp,
  status: state,
  error_code: state === "failed" ? "generation_failed" : null,
  attempt_count: state === "pending" ? 0 : 1,
});

vi.mock("../lib/apiConfig", async (importOriginal) => ({
  ...(await importOriginal()),
  API_MOCK_MODE: false,
}));
vi.mock("../lib/youtubeIframeApi", () => ({
  loadYouTubeIframeAPI: () => Promise.resolve({
    Player: h.FakePlayer,
    PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0, BUFFERING: 3 },
  }),
}));
vi.mock("../api", () => ({
  getInterventionPoints: vi.fn(async () => ({
    videoTitle: "Prepared lecture",
    duration: "2:00",
    author: "Teacher",
    points: h.points,
  })),
  getExplanationPreparationStatus: (...args) => h.getStatus(...args),
  getPreparedExplanation: (...args) => h.getPrepared(...args),
  retryExplanationPreparation: (...args) => h.retry(...args),
  getExplanation: vi.fn(),
  getTTSExplanation: vi.fn(),
}));
vi.mock("./VoiceNotes", () => ({ default: () => <div data-testid="voice-notes" /> }));

const readyBundle = (id = "p1", audioError = null) => ({
  explanation: {
    pointId: id,
    subtitle: `${id} prepared subtitle`,
    paragraphs: [`${id} prepared explanation text.`],
    keyInsight: "Prepared insight.",
  },
  audio: {
    audio_file_path: audioError ? null : `blob:${id}`,
    audio_error: audioError,
  },
});

const settle = (ms = 1000) => act(async () => {
  await vi.advanceTimersByTimeAsync(ms);
});

function renderExplanation(props = {}) {
  return render(
    <Explanation
      jobId="aircAruvnKk"
      videoId="aircAruvnKk"
      mode="standard"
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  h.players.length = 0;
  h.FakeAudio.instances.length = 0;
  h.getStatus.mockReset();
  h.getPrepared.mockReset();
  h.retry.mockReset();
  h.getPrepared.mockImplementation(async (id) => readyBundle(id));
  vi.stubGlobal("Audio", h.FakeAudio);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("P3 explanation preparation playback", () => {
  it("polls one lecture status list and consumes the cached explanation when ready", async () => {
    h.getStatus
      .mockResolvedValueOnce({ items: [status("pending"), status("pending", "p2")] })
      .mockResolvedValueOnce({ items: [status("ready"), status("pending", "p2")] });
    renderExplanation();
    await settle(200);

    expect(screen.getAllByRole("status").some((node) => /being prepared/i.test(node.textContent))).toBe(true);
    expect(h.getPrepared).not.toHaveBeenCalled();

    await settle(600);
    expect(h.getPrepared).toHaveBeenCalledTimes(1);
    expect(h.getPrepared).toHaveBeenCalledWith("p1", "standard", "aircAruvnKk", expect.any(Object));
    expect(screen.getByText("p1 prepared explanation text.")).toBeTruthy();
    expect(h.getStatus.mock.calls.every(([videoId, mode]) => videoId === "aircAruvnKk" && mode === "standard")).toBe(true);
  });

  it("waits at an automatic intervention without launching duplicate inference, then plays ready audio", async () => {
    h.getStatus
      .mockResolvedValueOnce({ items: [status("generating"), status("pending", "p2")] })
      .mockResolvedValueOnce({ items: [status("ready"), status("pending", "p2")] });
    renderExplanation();
    await settle(200);
    const player = h.players[0];
    player.state = 1;
    player.time = 10.1;
    await settle(350);

    expect(player.pauseVideo).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Skip explanation" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resume lecture" })).toBeTruthy();
    expect(h.getPrepared).not.toHaveBeenCalled();

    await settle(600);
    expect(h.getPrepared).toHaveBeenCalledTimes(1);
    expect(h.FakeAudio.instances.at(-1).play).toHaveBeenCalledTimes(1);
  });

  it("plays an already-preloaded ready explanation when its timestamp is reached", async () => {
    h.getStatus.mockResolvedValue({ items: [status("ready"), status("ready", "p2")] });
    renderExplanation();
    await settle(200);
    const player = h.players[0];
    const audio = h.FakeAudio.instances.at(-1);
    expect(audio.play).not.toHaveBeenCalled();

    player.state = 1;
    player.time = 10.1;
    await settle(350);

    expect(player.pauseVideo).toHaveBeenCalledTimes(1);
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it("shows keyboard-accessible failure controls and retries only after activation", async () => {
    h.getStatus.mockResolvedValue({ items: [status("failed"), status("ready", "p2")] });
    h.retry.mockResolvedValue({
      intervention_id: "p1",
      status: "pending",
      error_code: null,
      attempt_count: 1,
    });
    renderExplanation();
    await settle(200);

    const retry = screen.getByRole("button", { name: "Retry explanation" });
    expect(h.retry).not.toHaveBeenCalled();
    retry.focus();
    fireEvent.keyDown(retry, { key: "Enter" });
    fireEvent.click(retry);
    await settle(100);

    expect(h.retry).toHaveBeenCalledTimes(1);
    expect(h.retry).toHaveBeenCalledWith("aircAruvnKk", "p1", "standard");
  });

  it("reports retry exhaustion safely and disables further retry", async () => {
    h.getStatus.mockResolvedValue({ items: [status("failed"), status("ready", "p2")] });
    const exhausted = new Error("This explanation could not be prepared after several attempts.");
    exhausted.kind = "exhausted";
    h.retry.mockRejectedValue(exhausted);
    renderExplanation();
    await settle(200);
    fireEvent.click(screen.getByRole("button", { name: "Retry explanation" }));
    await settle(100);

    expect(screen.getByRole("alert").textContent).toBe(exhausted.message);
    expect(screen.getByRole("button", { name: "Retry explanation" }).disabled).toBe(true);
  });

  it("keeps watching recoverable when status polling fails and never fabricates mock content", async () => {
    h.getStatus.mockRejectedValue(new Error("offline"));
    renderExplanation();
    await settle(200);

    expect(screen.getByText(/status is unavailable/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
    expect(h.getPrepared).not.toHaveBeenCalled();
  });

  it("cancels the obsolete poll when the video or mode changes", async () => {
    h.getStatus.mockImplementation((_video, _mode, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
    );
    const view = renderExplanation();
    await settle(100);
    const firstSignal = h.getStatus.mock.calls[0][2].signal;

    view.rerender(
      <Explanation jobId="otherVideo1" videoId="otherVideo1" mode="detailed" />,
    );
    await settle(100);

    expect(firstSignal.aborted).toBe(true);
    expect(h.getStatus).toHaveBeenLastCalledWith("otherVideo1", "detailed", expect.any(Object));
  });

  it("seeking to another moment cancels automatic playback and preserves user pause ownership", async () => {
    h.getStatus.mockResolvedValue({ items: [status("pending"), status("ready", "p2")] });
    renderExplanation();
    await settle(200);
    const player = h.players[0];
    player.state = 1;
    player.time = 10.1;
    await settle(350);

    fireEvent.click(screen.getByRole("button", { name: /Moment 2.*Second graph/i }));
    await settle(100);

    expect(player.seekTo).toHaveBeenCalledWith(50, true);
    expect(player.pauseVideo).toHaveBeenCalled();
    expect(h.getPrepared).toHaveBeenCalledWith("p2", "standard", "aircAruvnKk", expect.any(Object));
    expect(h.FakeAudio.instances.at(-1).play).not.toHaveBeenCalled();
  });

  it("keeps prepared text readable when audio is unavailable", async () => {
    h.getStatus.mockResolvedValue({ items: [status("ready"), status("ready", "p2")] });
    h.getPrepared.mockResolvedValue(readyBundle(
      "p1",
      "Explanation audio is unavailable. You can still read the explanation.",
    ));
    renderExplanation();
    await settle(200);

    expect(screen.getByText("p1 prepared explanation text.")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/still read the explanation/i);
  });

  it("exports the loaded MP3 for the active intervention and explanation mode", async () => {
    h.getStatus.mockResolvedValue({ items: [status("ready"), status("ready", "p2")] });
    let downloadLink = null;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function captureDownload() { downloadLink = this; });

    try {
      renderExplanation({ mode: "detailed" });
      await settle(200);
      fireEvent.click(screen.getByRole("button", { name: /Moment 2.*Second graph/i }));
      await settle(100);

      const activeAudio = h.FakeAudio.instances.at(-1);
      expect(activeAudio.url).toBe("blob:p2");
      fireEvent.click(screen.getByRole("button", { name: "Export audio" }));

      expect(downloadLink.href).toBe("blob:p2");
      expect(downloadLink.download).toBe("synapse-second-graph-detailed.mp3");
      expect(activeAudio.pause).not.toHaveBeenCalled();
    } finally {
      clickSpy.mockRestore();
    }
  });

  it("reports unavailable export audio through an accessible alert", async () => {
    h.getStatus.mockResolvedValue({ items: [status("ready"), status("ready", "p2")] });
    h.getPrepared.mockResolvedValue(readyBundle(
      "p1",
      "Explanation audio is unavailable. You can still read the explanation.",
    ));
    renderExplanation();
    await settle(200);

    fireEvent.click(screen.getByRole("button", { name: "Export audio" }));

    expect(document.getElementById("audio-export-error").getAttribute("role")).toBe("alert");
    expect(document.getElementById("audio-export-error").textContent).toMatch(
      /not available to download/i,
    );
  });

  it("reports download initiation failures without disrupting playback", async () => {
    h.getStatus.mockResolvedValue({ items: [status("ready"), status("ready", "p2")] });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => { throw new Error("download blocked"); });

    try {
      renderExplanation();
      await settle(200);
      const activeAudio = h.FakeAudio.instances.at(-1);

      fireEvent.click(screen.getByRole("button", { name: "Export audio" }));

      expect(document.getElementById("audio-export-error").textContent).toMatch(
        /could not be downloaded/i,
      );
      expect(activeAudio.url).toBe("blob:p1");
      expect(activeAudio.pause).not.toHaveBeenCalled();
    } finally {
      clickSpy.mockRestore();
    }
  });
});
