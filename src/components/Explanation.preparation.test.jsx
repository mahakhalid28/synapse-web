import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Explanation from "./Explanation";
import { getInterventionPoints } from "../api";
import { createActionRegistry, VoiceActionsContext } from "../voice/voiceActions";
import { createVoiceAudioRegistry, VoiceAudioContext } from "../voice/voiceAudio";
import { getSavedLecture, loadSavedAudio } from "../lib/personalApi";
vi.mock("../lib/personalApi", async (original) => ({
  ...await original(),
  getSavedLecture: vi.fn(async () => []),
  loadSavedAudio: vi.fn(async (item) => item.audioUrl),
}));

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

  return { players, getStatus, getPrepared, retry, points, FakePlayer, FakeAudio,
    streamEnabled: false, streamOptions: null, streamPlayer: null, streamRequests: [] };
});

vi.mock('../lib/ttsStream.js', () => ({
  supportsAudioStreaming: () => h.streamEnabled,
  streamSpeech: (path, _body, options) => {
    h.streamOptions = options;
    return new Promise((_resolve, reject) => h.streamRequests.push({ path, options, reject }));
  },
  createStreamAudio: async () => {
    const audio = new h.FakeAudio('stream');
    audio.streaming = true;
    audio.push = vi.fn(async () => {});
    audio.finish = vi.fn();
    audio.dispose = vi.fn();
    h.streamPlayer = audio;
    return audio;
  },
}));

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
  toBackendExplanationMode: (mode) => mode === 'standard' ? 'explanatory' : mode,
  parseTextExplanation: (text, pointId) => ({ pointId, subtitle: '', paragraphs: [text], keyInsight: '' }),
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

const settle = async (ms = 1000) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  // The player is created after the readiness render, then reports onReady asynchronously.
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
};

function renderExplanation(props = {}) {
  const actions = createActionRegistry();
  const media = createVoiceAudioRegistry();
  const view = render(
    <VoiceActionsContext.Provider value={actions}><VoiceAudioContext.Provider value={media}><Explanation
      jobId="aircAruvnKk"
      videoId="aircAruvnKk"
      mode="standard"
      {...props}
    /></VoiceAudioContext.Provider></VoiceActionsContext.Provider>,
  );
  return { ...view, actions, media };
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  h.players.length = 0;
  h.FakeAudio.instances.length = 0;
  h.getStatus.mockReset();
  h.getPrepared.mockReset();
  h.retry.mockReset();
  getSavedLecture.mockReset().mockResolvedValue([]);
  loadSavedAudio.mockReset().mockImplementation(async (item) => item.audioUrl);
  h.streamEnabled = false;
  h.streamOptions = h.streamPlayer = null;
  h.streamRequests.length = 0;
  h.getPrepared.mockImplementation(async (id) => readyBundle(id));
  vi.stubGlobal("Audio", h.FakeAudio);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("P3 explanation preparation playback", () => {
  it("blocks buttons, keyboard, voice play and voice restoration before preparation finishes", async () => {
    h.getStatus.mockResolvedValue({ items: [status("pending"), status("ready", "p2")] });
    const view = renderExplanation({ promise: new Promise(() => {}) });
    await settle(100);
    expect(screen.getByRole("heading", { name: "Preparing your lecture", level: 2 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Play lecture" }).disabled).toBe(true);
    expect(screen.getAllByRole("status").some((node) => /Preparing intervention points/.test(node.textContent))).toBe(true);
    fireEvent.keyDown(window, { code: "KeyP", key: "p", altKey: true });
    act(() => {
      view.actions.handlers().play_lecture();
      view.media.getPort().restore({ lecture: true });
    });
    await settle(100);
    expect(h.players).toHaveLength(0);
  });
  it("waits for the first chronological point even when a later ready point is selected", async () => {
    getInterventionPoints.mockResolvedValueOnce({ points: [...h.points].reverse() });
    h.getStatus.mockResolvedValue({ items: [status("pending"), status("ready", "p2")] });
    renderExplanation({ pointId: "p2" });
    await settle(200);
    expect(h.players).toHaveLength(0);
    expect(screen.getByText("Intervention points loaded")).toBeTruthy();
    expect(screen.getAllByRole("status").some((node) => /Preparing the first explanation/.test(node.textContent))).toBe(true);
    h.getStatus.mockResolvedValue({ items: [status("ready"), status("ready", "p2")] });
    await settle(600);
    expect(h.getPrepared).toHaveBeenCalledWith("p1", "standard", "aircAruvnKk", expect.any(Object));
    expect(h.players).toHaveLength(1);
    expect(h.players[0].playVideo).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Preparing your lecture" })).toBeNull();
    expect(screen.getAllByRole("status").some((node) => /Lecture ready. Press Play to begin/.test(node.textContent))).toBe(true);
  });
  it("does not create the player until the first audio has actually loaded", async () => {
    h.getStatus.mockResolvedValue({ items: [status("ready"), status("ready", "p2")] });
    let finish;
    const audioReady = new Promise((resolve) => { finish = resolve; });
    h.getPrepared.mockImplementation(async () => { await audioReady; return readyBundle(); });
    renderExplanation();
    await settle(200);
    expect(h.players).toHaveLength(0);
    finish();
    await settle(200);
    expect(h.players).toHaveLength(1);
    expect(h.players[0].playVideo).not.toHaveBeenCalled();
  });
  it("keeps playback blocked on missing audio and unlocks only after an explicit successful recheck", async () => {
    h.getStatus.mockResolvedValue({ items: [status("ready"), status("ready", "p2")] });
    h.getPrepared.mockResolvedValue(readyBundle("p1", "Audio missing"));
    renderExplanation();
    await settle(200);
    expect(h.players).toHaveLength(0);
    expect(screen.getAllByText(/first explanation's audio could not be loaded/).length).toBeGreaterThan(0);
    h.getPrepared.mockImplementation(async (id) => readyBundle(id));
    fireEvent.click(screen.getByRole("button", { name: "Check preparation again" }));
    await settle(200);
    expect(h.players).toHaveLength(1);
  });
  it("keeps a failed first explanation blocked and retries generation only on request", async () => {
    h.getStatus.mockResolvedValue({ items: [status("failed"), status("ready", "p2")] });
    h.retry.mockResolvedValue(status("pending"));
    renderExplanation();
    await settle(200);
    expect(h.players).toHaveLength(0);
    expect(h.retry).not.toHaveBeenCalled();
    h.getStatus.mockResolvedValue({ items: [status("ready"), status("ready", "p2")] });
    fireEvent.click(screen.getByRole("button", { name: "Retry preparation" }));
    await settle(200);
    expect(h.retry).toHaveBeenCalledWith("p1", "standard", "aircAruvnKk");
    expect(h.players).toHaveLength(1);
  });
  it("does not treat a bookmarked point as the complete list and allows retrying a failed list load", async () => {
    getInterventionPoints.mockRejectedValueOnce(new Error("Points unavailable"));
    h.getStatus.mockResolvedValue({ items: [status("ready"), status("ready", "p2")] });
    renderExplanation({ bookmarkData: { pointId: "p1", title: "First diagram", timestamp: "0:10" } });
    await settle(200);
    expect(h.players).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Check preparation again" }));
    await settle(200);
    expect(h.players).toHaveLength(1);
  });
  it("does not unlock a saved lecture when the full intervention list is unavailable", async () => {
    getInterventionPoints.mockRejectedValueOnce(new Error("Points unavailable"));
    getSavedLecture.mockResolvedValue([{ id: "save-1", pointId: "p1", mode: "standard", title: "First diagram", timestamp: "0:10",
      explanation: { paragraphs: ["Saved text"] }, audioUrl: "blob:saved" }]);
    renderExplanation({ readOnly: true });
    await settle(200);
    expect(h.players).toHaveLength(0);
    expect(screen.getAllByText(/complete intervention points could not be loaded/).length).toBeGreaterThan(0);
    expect(h.getStatus).not.toHaveBeenCalled();
  });
  it("validates the first saved audio without starting inference and leaves the reopened lecture paused", async () => {
    getSavedLecture.mockResolvedValue([{ id: "save-1", pointId: "p1", mode: "standard", title: "First diagram", timestamp: "0:10",
      explanation: { paragraphs: ["Saved text"] }, audioUrl: "blob:saved" }]);
    renderExplanation({ readOnly: true });
    await settle(200);
    expect(loadSavedAudio).toHaveBeenCalledWith(expect.objectContaining({ id: "save-1" }), expect.any(Object));
    expect(h.players).toHaveLength(1);
    expect(h.players[0].playVideo).not.toHaveBeenCalled();
    expect(h.getStatus).not.toHaveBeenCalled();
    expect(h.retry).not.toHaveBeenCalled();
  });
  it("keeps an unlocked player when a different moment is selected", async () => {
    h.getStatus.mockResolvedValue({ items: [status("ready"), status("pending", "p2")] });
    renderExplanation();
    await settle(200);
    const player = h.players[0];
    fireEvent.click(screen.getByRole("button", { name: /Moment 2.*Second graph/i }));
    await settle(100);
    expect(h.players).toHaveLength(1);
    expect(player.destroy).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Preparing your lecture", level: 2 })).toBeNull();
  });
  it.each(['before start', 'before PCM', 'after PCM'])('retains early text through speech failure %s, failed polling, and retry', async (stage) => {
    h.streamEnabled = true;
    h.getStatus.mockResolvedValue({ items: [status('pending'), status('pending', 'p2')] });
    renderExplanation();
    await settle(200);
    const stream = h.streamRequests.find((request) => request.path.startsWith('/video/'));
    await act(async () => stream.options.onEvent({ type: 'text_ready', text: 'Valid text despite speech failure.' }));
    h.getStatus.mockResolvedValue({ items: [status('generating'), status('pending', 'p2')] });
    await settle(700);
    expect(screen.getByText('Valid text despite speech failure.')).toBeTruthy();
    await act(async () => {
      if (stage !== 'before start') {
        await stream.options.onEvent({ type: 'start', text: 'Valid text despite speech failure.' });
      }
      if (stage === 'after PCM') await stream.options.onEvent({ type: 'audio', samples: new Float32Array(100) });
      stream.reject(new Error('Speech interrupted.'));
    });
    expect(screen.getByText('Valid text despite speech failure.')).toBeTruthy();
    if (stage !== 'before start') expect(h.streamPlayer.dispose).toHaveBeenCalled();
    h.getStatus.mockResolvedValue({ items: [status('failed'), status('pending', 'p2')] });
    await settle(2000);
    expect(screen.getByText('Valid text despite speech failure.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry explanation' }).disabled).toBe(false);
    expect(h.retry).not.toHaveBeenCalled();
    expect(h.getPrepared).not.toHaveBeenCalled();

    h.retry.mockResolvedValue(status('pending'));
    h.getStatus.mockResolvedValue({ items: [status('pending'), status('pending', 'p2')] });
    fireEvent.click(screen.getByRole('button', { name: 'Retry explanation' }));
    await settle(100);
    expect(h.retry).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Valid text despite speech failure.')).toBeTruthy();
    const retry = h.streamRequests.filter((request) => request.path.startsWith('/video/')).at(-1);
    expect(retry).not.toBe(stream);
    await act(async () => retry.options.onEvent({ type: 'text_ready', text: 'New attempt text.' }));
    expect(screen.queryByText('Valid text despite speech failure.')).toBeNull();
    expect(screen.getByText('New attempt text.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Moment 2.*Second graph/i }));
    await settle(100);
    expect(screen.queryByText('New attempt text.')).toBeNull();
  });
  it('clears retained text on account change even after failed polling stops the stream', async () => {
    h.streamEnabled = true;
    h.getStatus.mockResolvedValue({ items: [status('generating'), status('pending', 'p2')] });
    renderExplanation();
    await settle(200);
    const stream = h.streamOptions;
    await act(async () => stream.onEvent({ type: 'text_ready', text: 'Retained private text.' }));
    h.getStatus.mockResolvedValue({ items: [status('failed'), status('pending', 'p2')] });
    await settle(700);
    expect(stream.signal.aborted).toBe(true);
    expect(screen.getByText('Retained private text.')).toBeTruthy();
    act(() => window.dispatchEvent(new Event('synapse-account-changed')));
    await act(async () => stream.onEvent({ type: 'text_ready', text: 'Late account text.' }));
    expect(screen.queryByText('Retained private text.')).toBeNull();
    expect(screen.queryByText('Late account text.')).toBeNull();
  });
  it('releases a failed live player so ready polling can load the durable fallback', async () => {
    h.streamEnabled = true;
    h.getStatus.mockResolvedValue({ items: [status('generating'), status('pending', 'p2')] });
    renderExplanation();
    await settle(200);
    const stream = h.streamRequests.find((request) => request.path.startsWith('/video/'));
    await act(async () => {
      await stream.options.onEvent({ type: 'text_ready', text: 'Early fallback text.' });
      await stream.options.onEvent({ type: 'start', text: 'Early fallback text.' });
      await stream.options.onEvent({ type: 'audio', samples: new Float32Array(100) });
      stream.reject(new Error('Speech interrupted.'));
    });
    h.getStatus.mockResolvedValue({ items: [status('ready'), status('pending', 'p2')] });
    await settle(700);
    expect(h.getPrepared).toHaveBeenCalledWith('p1', 'standard', 'aircAruvnKk', expect.any(Object));
    expect(screen.getByText('p1 prepared explanation text.')).toBeTruthy();
  });
  it('shows early text without a player and waits for PCM before offering Listen', async () => {
    h.streamEnabled = true;
    h.getStatus.mockResolvedValue({ items: [status('generating'), status('pending', 'p2')] });
    renderExplanation();
    await settle(200);
    const stream = h.streamOptions;
    await act(async () => {
      await stream.onEvent({ type: 'text_ready', generation_id: 'one', text: 'Early readable explanation.' });
    });
    expect(screen.getByText('Early readable explanation.')).toBeTruthy();
    expect(h.streamPlayer).toBeNull();
    expect(h.FakeAudio.instances).toHaveLength(0);
    expect(h.getPrepared).not.toHaveBeenCalled();

    await act(async () => {
      await stream.onEvent({ type: 'start', text: 'Early readable explanation.' });
    });
    expect(h.players).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Listen' })).toBeNull();
    expect(h.streamPlayer.play).not.toHaveBeenCalled();

    await act(async () => {
      await stream.onEvent({ type: 'audio', samples: new Float32Array(100) });
    });
    await settle(100);
    fireEvent.click(screen.getByRole('button', { name: /Listen to explanation audio/i }));
    await settle(100);
    expect(h.streamPlayer.play).toHaveBeenCalledTimes(1);
  });
  it('discards early text callbacks after navigation or account changes', async () => {
    h.streamEnabled = true;
    h.getStatus.mockResolvedValue({ items: [status('generating'), status('generating', 'p2')] });
    const view = renderExplanation();
    await settle(200);
    const first = h.streamOptions;
    await act(async () => first.onEvent({ type: 'text_ready', text: 'First private text.' }));
    fireEvent.click(screen.getByRole('button', { name: /Moment 2.*Second graph/i }));
    await settle(100);
    expect(first.signal.aborted).toBe(true);
    await act(async () => first.onEvent({ type: 'text_ready', text: 'Stale first text.' }));
    expect(screen.queryByText('First private text.')).toBeNull();
    expect(screen.queryByText('Stale first text.')).toBeNull();
    const second = h.streamOptions;
    await act(async () => second.onEvent({ type: 'text_ready', text: 'Second private text.' }));
    act(() => window.dispatchEvent(new Event('synapse-account-changed')));
    await act(async () => second.onEvent({ type: 'text_ready', text: 'Stale account text.' }));
    expect(second.signal.aborted).toBe(true);
    expect(screen.queryByText('Second private text.')).toBeNull();
    expect(screen.queryByText('Stale account text.')).toBeNull();
    expect(h.streamPlayer).toBeNull();
    view.unmount();
  });
  it('resets PCM readiness when navigating to another moment', async () => {
    h.streamEnabled = true;
    h.getStatus.mockResolvedValue({ items: [status('generating'), status('generating', 'p2')] });
    renderExplanation();
    await settle(200);
    const first = h.streamOptions;
    await act(async () => {
      await first.onEvent({ type: 'start', text: 'First stream.' });
      await first.onEvent({ type: 'audio', samples: new Float32Array(100) });
    });
    const firstPlayer = h.streamPlayer;
    fireEvent.click(screen.getByRole('button', { name: /Moment 2.*Second graph/i }));
    await settle(100);
    const second = h.streamOptions;
    expect(first.signal.aborted).toBe(true);
    expect(firstPlayer.dispose).toHaveBeenCalled();
    await act(async () => {
      await second.onEvent({ type: 'start', text: 'Second stream without PCM.' });
      await first.onEvent({ type: 'audio', samples: new Float32Array(100) });
    });
    const secondPlayer = h.streamPlayer;
    fireEvent.click(screen.getByRole('button', { name: 'Wait here' }));
    await settle(100);
    expect(secondPlayer.play).not.toHaveBeenCalled();
    await act(async () => second.onEvent({ type: 'audio', samples: new Float32Array(100) }));
    await settle(100);
    expect(secondPlayer.play).toHaveBeenCalledTimes(1);
  });
  it('allows live listening while durable status is generating and keeps the same player at completion', async () => {
    h.streamEnabled = true;
    h.getStatus.mockResolvedValue({ items: [status('generating'), status('pending', 'p2')] });
    const view = renderExplanation();
    await settle(200);
    expect(h.streamOptions).toBeTruthy();
    await act(async () => {
      await h.streamOptions.onEvent({ type: 'start', text: 'Live spoken explanation.' });
      await h.streamOptions.onEvent({ type: 'audio', samples: new Float32Array(100) });
    });
    expect(screen.getByText('Live spoken explanation.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Listen to explanation audio' }).hasAttribute('aria-disabled')).toBe(false);
    expect(h.streamPlayer.play).not.toHaveBeenCalled();
    expect(h.getPrepared).not.toHaveBeenCalled();
    const stream = h.streamPlayer;
    await act(async () => { await h.streamOptions.onEvent({ type: 'complete' }); });
    expect(stream.finish).toHaveBeenCalledOnce();
    h.getStatus.mockResolvedValue({ items: [status('ready'), status('pending', 'p2')] });
    await settle(700);
    expect(stream.dispose).not.toHaveBeenCalled();
    expect(h.FakeAudio.instances.filter((audio) => audio.url === 'blob:p1')).toHaveLength(0);
    view.unmount();
    expect(stream.dispose).toHaveBeenCalled();
    expect(h.streamOptions.signal.aborted).toBe(true);
  });
  it('disposes buffered speech immediately on an account change', async () => {
    h.streamEnabled = true;
    h.getStatus.mockResolvedValue({ items: [status('generating'), status('pending', 'p2')] });
    const view = renderExplanation();
    await settle(200);
    await act(async () => {
      await h.streamOptions.onEvent({ type: 'start', text: 'Private streamed speech.' });
      await h.streamOptions.onEvent({ type: 'audio', samples: new Float32Array(100) });
    });
    const player = h.streamPlayer;
    act(() => window.dispatchEvent(new Event('synapse-account-changed')));
    expect(player.dispose).toHaveBeenCalled();
    expect(h.streamOptions.signal.aborted).toBe(true);
    view.unmount();
  });
  it("presents an accessible question and focuses its heading without autoplay", async () => {
    h.getStatus.mockResolvedValue({ items: [status("ready"), status("ready", "p2")] });
    renderExplanation();
    await settle(200);
    const player = h.players[0];
    player.state = 1;
    player.time = 10.1;
    await settle(350);
    const heading = screen.getByRole("heading", { name: "Explanation question" });
    expect(document.activeElement).toBe(heading);
    expect(h.FakeAudio.instances.every((audio) => audio.play.mock.calls.length === 0)).toBe(true);
    vi.useRealTimers();
    const { axe } = await import("jest-axe");
    expect(await axe(screen.getByRole("region", { name: "Explanation question" }))).toHaveNoViolations();
  });
  it("polls one lecture status list and consumes the cached explanation when ready", async () => {
    h.getStatus
      .mockResolvedValueOnce({ items: [status("pending"), status("pending", "p2")] })
      .mockResolvedValueOnce({ items: [status("ready"), status("pending", "p2")] });
    renderExplanation();
    await settle(200);

    expect(screen.getAllByRole("status").some((node) => /Preparing the first explanation/i.test(node.textContent))).toBe(true);
    expect(h.getPrepared).not.toHaveBeenCalled();

    await settle(600);
    expect(h.getPrepared).toHaveBeenCalledTimes(2);
    expect(h.getPrepared).toHaveBeenCalledWith("p1", "standard", "aircAruvnKk", expect.any(Object));
    expect(screen.getByText("p1 prepared explanation text.")).toBeTruthy();
    expect(h.getStatus.mock.calls.every(([videoId, mode]) => videoId === "aircAruvnKk" && mode === "standard")).toBe(true);
  });

  it("waits before creating the lecture player, then asks before playing ready audio", async () => {
    h.getStatus
      .mockResolvedValueOnce({ items: [status("generating"), status("pending", "p2")] })
      .mockResolvedValueOnce({ items: [status("ready"), status("pending", "p2")] });
    renderExplanation();
    await settle(200);
    expect(h.players).toHaveLength(0);
    expect(h.getPrepared).not.toHaveBeenCalled();

    await settle(600);
    const player = h.players[0];
    player.state = 1;
    player.time = 10.1;
    await settle(350);
    expect(player.pauseVideo).toHaveBeenCalled();
    expect(h.FakeAudio.instances.every((audio) => audio.play.mock.calls.length === 0)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    await settle(100);
    expect(h.FakeAudio.instances.at(-1).play).toHaveBeenCalledTimes(1);
  });

  it("asks permission before playing a preloaded explanation at its timestamp", async () => {
    h.getStatus.mockResolvedValue({ items: [status("ready"), status("ready", "p2")] });
    renderExplanation();
    await settle(200);
    const player = h.players[0];
    const audio = h.FakeAudio.instances.at(-1);
    expect(audio.play).not.toHaveBeenCalled();

    player.state = 1;
    player.time = 10.1;
    await settle(350);

    expect(player.pauseVideo).toHaveBeenCalled();
    expect(audio.play).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    await settle(100);
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

  it("keeps polling throughout the backend VLM recovery window", async () => {
    h.getStatus.mockResolvedValue({
      items: [
        { ...status("pending"), error_code: "vlm_remote_unavailable" },
        status("pending", "p2"),
      ],
    });
    renderExplanation();

    for (let index = 0; index < 31; index += 1) {
      await settle(5_000);
    }

    expect(h.getStatus.mock.calls.length).toBeGreaterThan(30);
    expect(screen.getByText(/visual model is temporarily unavailable/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
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
    h.getStatus.mockResolvedValue({ items: [status("ready"), status("ready", "p2")] });
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
