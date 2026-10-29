// How the lecture screen takes part in voice control. The real Explanation runs with the real audio registry
// and the real turn controller; only the YouTube player, the audio element, the API, the Voice Notes panel and
// the microphone are stand-ins. These check that a voice turn pauses what Synapse plays, proves it quiet,
// and afterwards resumes only what was playing, with the lecture's pause ownership intact (so an explanation
// that was holding the lecture paused still resumes it when it finishes). They do not touch a real player,
// speaker or microphone.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect } from "react";
import { render, fireEvent, act } from "@testing-library/react";
import Explanation from "./Explanation";
import { VoiceAudioContext, createVoiceAudioRegistry } from "../voice/voiceAudio";
import { VoiceTurnController } from "../voice/useVoiceTurn";
import { TURN } from "../voice/voiceTurn";

const h = vi.hoisted(() => {
  const players = [];
  class FakePlayer {
    constructor(_el, opts) {
      this.opts = opts;
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
      setTimeout(() => opts.events.onReady({ target: this }), 0);
    }
  }
  // Like a real <audio>: paused is true until play(), and pause() sets it again.
  class FakeAudio {
    static last = null;
    constructor(url) {
      this.url = url;
      this.listeners = {};
      this.currentTime = 0;
      this.duration = 10;
      this.playbackRate = 1;
      this.paused = true;
      this.play = vi.fn(() => { this.paused = false; return Promise.resolve(); });
      this.pause = vi.fn(() => { this.paused = true; });
      FakeAudio.last = this;
    }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    removeEventListener() {}
    emit(type) { (this.listeners[type] || []).forEach((fn) => fn()); }
  }
  return { players, FakePlayer, FakeAudio, notes: { control: null } };
});

vi.mock("../lib/youtubeIframeApi", () => ({
  loadYouTubeIframeAPI: () => Promise.resolve({ Player: h.FakePlayer, PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0, BUFFERING: 3 } }),
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

// The real panel is replaced by a stub that registers a control object, as the real panel does.
vi.mock("./VoiceNotes", () => ({
  default: function VoiceNotesStub(props) {
    useEffect(() => {
      props.controlRef.current = h.notes.control;
      return () => { props.controlRef.current = null; };
    });
    return <div data-testid="voice-notes-stub" />;
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  h.players.length = 0;
  h.FakeAudio.last = null;
  h.notes.control = {
    toggle: vi.fn(),
    isBusy: vi.fn(() => false),
    lectureStarted: vi.fn(() => false),
    requestLeave: vi.fn((go) => go()),
  };
  vi.stubGlobal("Audio", h.FakeAudio);
  try { localStorage.clear(); } catch { /* ignore */ }
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const settle = (ms = 1000) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const altKey = (code, key) => fireEvent.keyDown(window, { code, key, altKey: true });

async function open() {
  const registry = createVoiceAudioRegistry();
  const utils = render(
    <VoiceAudioContext.Provider value={registry}>
      <Explanation jobId="job-1" videoId="5ugDJhmmkFM" mode="standard" onNavigate={vi.fn()} onOpenTimeline={vi.fn()} />
    </VoiceAudioContext.Provider>,
  );
  await settle();
  return { ...utils, registry, player: h.players[0], audio: h.FakeAudio.last };
}

// A fake microphone and converter: the point of these tests is the lecture screen, not the recording.
function makeController(registry, onUtterance = vi.fn(async () => ({}))) {
  const capture = {
    open: vi.fn(async () => {}),
    startRecording: vi.fn(),
    stop: vi.fn(async (reason) => ({ blob: new Blob(["clip"]), durationMs: 2000, reason, heardSpeech: true })),
    cancel: vi.fn(),
  };
  const controller = new VoiceTurnController();
  controller.configure({
    registry,
    onUtterance,
    announce: vi.fn(),
    deps: {
      createCapture: () => capture,
      toWav16k: async () => ({ blob: new Blob(["wav"]), samples: Float32Array.of(0.3, -0.3, 0.3), sampleRate: 16000, durationMs: 100 }),
      playTone: async () => {},
      wait: async () => {},
    },
  });
  return { controller, capture, onUtterance };
}

// Wait for the controller's async steps to run to the end of what is currently possible.
const turn = async (fn) => {
  await act(async () => {
    await fn();
    await vi.advanceTimersByTimeAsync(0);
  });
};

describe("the port the lecture screen offers", () => {
  it("is registered while the screen is open and removed when it closes", async () => {
    const { registry, unmount } = await open();
    expect(registry.getPort()).not.toBeNull();
    unmount();
    expect(registry.getPort()).toBeNull();
  });

  it("reports what is playing", async () => {
    const { registry, player, audio } = await open();
    expect(registry.getPort().getSnapshot()).toEqual({ lecture: "unknown", explanation: "paused", pauseOwner: null });

    player.state = 1;
    audio.paused = false;
    expect(registry.getPort().getSnapshot()).toMatchObject({ lecture: "playing", explanation: "playing" });
    player.state = 3;
    expect(registry.getPort().getSnapshot().lecture).toBe("buffering");
    player.state = 2;
    expect(registry.getPort().getSnapshot().lecture).toBe("paused");
  });

  it("pauses the lecture and the explanation audio and hands the pause to the learner", async () => {
    const { registry, player, audio } = await open();
    player.state = 1;
    audio.paused = false;
    act(() => registry.getPort().pause());
    expect(player.pauseVideo).toHaveBeenCalled();
    expect(audio.pause).toHaveBeenCalled();
    expect(registry.getPort().getSnapshot()).toEqual({ lecture: "paused", explanation: "paused", pauseOwner: "user" });
  });

  it("knows when a voice note is being recorded", async () => {
    const { registry } = await open();
    expect(registry.getPort().isNoteBusy()).toBe(false);
    h.notes.control.isBusy.mockReturnValue(true);
    expect(registry.getPort().isNoteBusy()).toBe(true);
  });

  it("is not busy when the Voice Notes panel is not there", async () => {
    const { registry } = await open();
    h.notes.control = null;
    await settle(50);
    expect(registry.getPort().isNoteBusy()).toBe(false);
  });
});

describe("a voice turn through the real lecture screen", () => {
  it("resumes a lecture that was playing, after the microphone is closed", async () => {
    const { registry, player } = await open();
    player.state = 1;
    const { controller, capture } = makeController(registry);

    await turn(() => controller.toggle()); // start
    expect(controller.status).toBe(TURN.LISTENING);
    expect(player.state).toBe(2); // paused and confirmed quiet before the microphone opened
    expect(capture.open.mock.invocationCallOrder[0]).toBeGreaterThan(player.pauseVideo.mock.invocationCallOrder[0]);

    player.playVideo.mockClear();
    await turn(() => controller.toggle()); // stop
    expect(capture.stop.mock.invocationCallOrder[0]).toBeLessThan(player.playVideo.mock.invocationCallOrder[0]);
    expect(player.playVideo).toHaveBeenCalledTimes(1);
    expect(registry.isTurnActive()).toBe(false);
  });

  it("keeps the explanation's hold on the lecture: after the voice turn, finishing the explanation still resumes the lecture", async () => {
    const { registry, player } = await open();
    // The lecture reaches the first moment (0:10): Synapse pauses it and the explanation audio plays.
    player.state = 1;
    player.time = 10.1;
    await settle(400);
    expect(player.pauseVideo).toHaveBeenCalledTimes(1);
    const audio = h.FakeAudio.last; // a new moment loads a new audio element, which starts by itself
    expect(audio.paused).toBe(false);
    expect(registry.getPort().getSnapshot()).toMatchObject({ lecture: "paused", explanation: "playing", pauseOwner: "intervention" });

    const { controller } = makeController(registry);
    await turn(() => controller.toggle());
    expect(audio.paused).toBe(true); // the explanation is silent while the mic listens
    expect(registry.getPort().getSnapshot().pauseOwner).toBe("user");

    player.playVideo.mockClear();
    await turn(() => controller.toggle());
    expect(audio.paused).toBe(false); // the explanation carries on
    expect(player.playVideo).not.toHaveBeenCalled(); // the lecture stays paused behind it
    expect(registry.getPort().getSnapshot().pauseOwner).toBe("intervention");

    audio.emit("ended"); // the explanation finishes
    await settle(100);
    expect(player.playVideo).toHaveBeenCalledTimes(1); // and the lecture resumes, as it always did
  });

  it("does not resume anything after a spoken playback command", async () => {
    const { registry, player } = await open();
    player.state = 1;
    const { controller } = makeController(registry, vi.fn(async () => ({ playbackCommand: "pause" })));
    await turn(() => controller.toggle());
    player.playVideo.mockClear();
    await turn(() => controller.toggle());
    expect(player.playVideo).not.toHaveBeenCalled();
    expect(player.state).toBe(2);
  });

  it("does not resume anything when the learner pressed play while it listened", async () => {
    const { registry, player } = await open();
    player.state = 1;
    const { controller, capture } = makeController(registry);
    await turn(() => controller.toggle());
    expect(controller.status).toBe(TURN.LISTENING);

    player.state = 1; // the learner started the lecture themselves
    player.playVideo.mockClear();
    await settle(400);
    expect(controller.status).toBe(TURN.IDLE);
    expect(capture.cancel).toHaveBeenCalled();
    expect(player.playVideo).not.toHaveBeenCalled();
  });

  it("does not start while a voice note is being recorded", async () => {
    const { registry, player } = await open();
    player.state = 1;
    h.notes.control.isBusy.mockReturnValue(true);
    const { controller, capture } = makeController(registry);
    await turn(() => controller.toggle());
    expect(controller.status).toBe(TURN.IDLE);
    expect(capture.open).not.toHaveBeenCalled();
    expect(player.pauseVideo).not.toHaveBeenCalled();
  });

  it("does not resume if the learner left the lecture screen while it listened", async () => {
    const { registry, player, unmount } = await open();
    player.state = 1;
    const { controller } = makeController(registry);
    await turn(() => controller.toggle());
    unmount();
    player.playVideo.mockClear();
    await turn(() => controller.toggle());
    expect(player.playVideo).not.toHaveBeenCalled();
    expect(registry.isTurnActive()).toBe(false);
  });
});

describe("Alt+M while voice control is listening", () => {
  it("is ignored, because the microphone is in use", async () => {
    const { registry } = await open();
    registry.setTurnActive(true);
    altKey("KeyM", "m");
    expect(h.notes.control.toggle).not.toHaveBeenCalled();
  });

  it("works as before once voice control is not using the microphone", async () => {
    const { registry } = await open();
    registry.setTurnActive(false);
    altKey("KeyM", "m");
    expect(h.notes.control.toggle).toHaveBeenCalledTimes(1);
  });
});
