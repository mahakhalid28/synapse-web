// How the lecture screen behaves when App's Help dialog opens and closes over it.
// The real Explanation runs; the YouTube player, the Audio element, the explanation API and the
// voice-notes panel are controllable fakes. These test Explanation's side of the contract:
//   - nothing may START the video or the explanation audio while Help is open (three guards),
//   - what is playing is paused, a play() still in flight is cancelled,
//   - closing Help never resumes anything,
//   - the player stays mounted and processing is not touched.
// They do not use a real YouTube player, a real <audio> element or a real screen reader.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import Explanation from "./Explanation";
import { getPreparedExplanation } from "../api";
import { HELP_BLOCKED_RECORDING } from "../lib/onboardingText";

const h = vi.hoisted(() => {
  const players = [];
  class FakePlayer {
    constructor(_el, opts) {
      this.opts = opts;
      this.state = -1; // unstarted
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
    // What YouTube does when the player changes state.
    emit(data) { this.opts.events.onStateChange({ data, target: this }); }
  }
  // An <audio> element that behaves like the real one where it matters here: pause() makes a play()
  // that has not settled yet reject with AbortError.
  class FakeAudio {
    static instances = [];
    static deferPlay = false;
    constructor(url) {
      this.url = url;
      this.listeners = {};
      this.currentTime = 0;
      this.duration = 10;
      this.playbackRate = 1;
      this.paused = true;
      this.pendingPlay = null;
      this.play = vi.fn(() => {
        this.paused = false;
        if (!FakeAudio.deferPlay) return Promise.resolve();
        return new Promise((resolve, reject) => { this.pendingPlay = { resolve, reject }; });
      });
      this.pause = vi.fn(() => {
        this.paused = true;
        if (this.pendingPlay) {
          const pending = this.pendingPlay;
          this.pendingPlay = null;
          pending.reject(Object.assign(new Error("The play() request was interrupted"), { name: "AbortError" }));
        }
      });
      FakeAudio.instances.push(this);
    }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    removeEventListener() {}
    emit(type) { (this.listeners[type] || []).forEach((fn) => fn()); }
  }
  return { players, FakePlayer, FakeAudio, stub: { control: null } };
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
  getPreparedExplanation: vi.fn(),
  retryExplanationPreparation: vi.fn(),
}));

vi.mock("./VoiceNotes", () => ({
  default: function VoiceNotesStub(props) {
    useEffect(() => {
      props.controlRef.current = h.stub.control;
      return () => { props.controlRef.current = null; };
    });
    return <div data-testid="voice-notes-stub" />;
  },
}));

const prepared = (pointId) => ({
  explanation: { pointId, subtitle: "A subtitle", paragraphs: ["Paragraph one."], keyInsight: "A key insight." },
  audio: { audio_file_path: "blob:tts", audio_error: null },
});

let guard;
let registerHelpGuard;

beforeEach(() => {
  vi.useFakeTimers();
  h.players.length = 0;
  h.FakeAudio.instances = [];
  h.FakeAudio.deferPlay = false;
  h.stub.control = {
    toggle: vi.fn(),
    lectureStarted: vi.fn(() => false),
    requestLeave: vi.fn((go) => go()),
    beforeHelp: vi.fn(() => ({ blocked: false, stoppedNote: false })),
  };
  getPreparedExplanation.mockReset();
  getPreparedExplanation.mockImplementation(async (pointId) => prepared(pointId));
  guard = null;
  registerHelpGuard = vi.fn((g) => {
    guard = g;
    return () => { if (guard === g) guard = null; };
  });
  vi.stubGlobal("Audio", h.FakeAudio);
  try { localStorage.clear(); } catch { /* ignore */ }
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const settle = (ms = 1000) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

async function open(props = {}) {
  const onNavigate = vi.fn();
  const utils = render(
    <Explanation
      jobId="job-1"
      videoId="5ugDJhmmkFM"
      mode="standard"
      onNavigate={onNavigate}
      registerHelpGuard={registerHelpGuard}
      {...props}
    />,
  );
  await settle();
  return { ...utils, onNavigate, player: h.players[0] };
}

// What App does around the dialog.
const openHelp = () => {
  let result;
  act(() => { result = guard.beforeHelp(); });
  return result;
};
const closeHelp = () => act(() => { guard.afterHelp(); });

const altKey = (code, key) => fireEvent.keyDown(window, { code, key, altKey: true });
const liveText = () => screen.queryAllByRole("status").map((el) => el.textContent).join(" | ");
const playCalls = () => h.FakeAudio.instances.reduce((n, a) => n + a.play.mock.calls.length, 0);
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

// The lecture is playing and the learner (or YouTube) says so.
const startPlaying = (player) => {
  player.state = 1;
  act(() => player.emit(1));
};
// Playing up to the first moment: the watcher pauses the video there.
async function playToFirstMoment(player) {
  player.time = 10;
  startPlaying(player);
  await settle(400);
}

describe("registration", () => {
  it("registers once, keeps the same guard across re-renders, and unregisters on unmount", async () => {
    const { rerender, unmount } = await open();
    expect(registerHelpGuard).toHaveBeenCalledTimes(1);
    const first = guard;
    rerender(
      <Explanation jobId="job-1" videoId="5ugDJhmmkFM" mode="standard" onNavigate={() => {}} registerHelpGuard={registerHelpGuard} />,
    );
    await settle(100);
    expect(registerHelpGuard).toHaveBeenCalledTimes(1);
    expect(guard).toBe(first);
    unmount();
    expect(guard).toBeNull();
  });

  it("works without a guard registration (Explanation used on its own)", async () => {
    await open({ registerHelpGuard: undefined });
    expect(guard).toBeNull();
  });
});

describe("guard 1: explanation audio that loads while Help is open does not start", () => {
  it("Library autoplay: the audio arrives during Help and is never played, not even after Help closes", async () => {
    const gate = deferred();
    getPreparedExplanation.mockImplementation(async (pointId) => { await gate.promise; return prepared(pointId); });
    await open({ autoPlay: true });
    expect(h.FakeAudio.instances).toHaveLength(0);

    openHelp();
    gate.resolve();
    await settle();
    expect(h.FakeAudio.instances.length).toBeGreaterThan(0);
    expect(playCalls()).toBe(0);

    closeHelp();
    await settle();
    expect(playCalls()).toBe(0);
  });

  it("control: the same Library autoplay DOES play when Help was never opened", async () => {
    const gate = deferred();
    getPreparedExplanation.mockImplementation(async (pointId) => { await gate.promise; return prepared(pointId); });
    await open({ autoPlay: true });
    gate.resolve();
    await settle();
    expect(playCalls()).toBeGreaterThan(0);
  });

  it("after Help, the learner can start the audio themselves with Listen", async () => {
    const gate = deferred();
    getPreparedExplanation.mockImplementation(async (pointId) => { await gate.promise; return prepared(pointId); });
    await open({ autoPlay: true });
    openHelp();
    gate.resolve();
    await settle();
    closeHelp();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Listen to explanation audio" }));
    expect(playCalls()).toBe(1);
  });

  it("intervention autoplay: audio that is still loading when the lecture pauses at a moment does not start under Help", async () => {
    const gate = deferred();
    getPreparedExplanation.mockImplementation(async (pointId) => { await gate.promise; return prepared(pointId); });
    const { player } = await open();
    await playToFirstMoment(player); // the watcher pauses at 0:10; no audio yet
    expect(player.pauseVideo).toHaveBeenCalledTimes(1);

    const result = openHelp();
    expect(result).toEqual({ blocked: false, notice: "" }); // nothing was playing, so nothing was paused
    gate.resolve();
    await settle();
    expect(h.FakeAudio.instances.length).toBeGreaterThan(0);
    expect(playCalls()).toBe(0);

    closeHelp();
    await settle();
    expect(playCalls()).toBe(0);
    expect(player.playVideo).not.toHaveBeenCalled();
  });

  it("control: the same intervention DOES autoplay the audio when Help was never opened", async () => {
    const gate = deferred();
    getPreparedExplanation.mockImplementation(async (pointId) => { await gate.promise; return prepared(pointId); });
    const { player } = await open();
    await playToFirstMoment(player);
    gate.resolve();
    await settle();
    expect(playCalls()).toBe(1);
  });

  it("an intervention pause stays an intervention pause: Listen then finishing still resumes the lecture (a learner's own action)", async () => {
    const gate = deferred();
    getPreparedExplanation.mockImplementation(async (pointId) => { await gate.promise; return prepared(pointId); });
    const { player } = await open();
    await playToFirstMoment(player);
    openHelp();
    gate.resolve();
    await settle();
    closeHelp();
    await settle();
    expect(player.playVideo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Listen to explanation audio" }));
    await settle(10);
    act(() => h.FakeAudio.instances.at(-1).emit("ended"));
    expect(player.playVideo).toHaveBeenCalledTimes(1);
  });
});

describe("guard 2: the moment watcher does nothing while Help is open", () => {
  it("does not pause, switch moment or start audio, and works again once Help closes", async () => {
    const { player } = await open();
    openHelp(); // idle: the lecture has not started
    // The lecture "starts" and reaches the first moment without an event reaching the page yet.
    player.state = 1;
    player.time = 10;
    await settle(1000);
    expect(player.pauseVideo).not.toHaveBeenCalled();
    expect(playCalls()).toBe(0);

    closeHelp();
    await settle(400);
    expect(player.pauseVideo).toHaveBeenCalledTimes(1); // the watcher is back
  });
});

describe("guard 3: a delayed PLAYING event while Help is open is undone", () => {
  it("re-pauses every time, never confirms or announces 'Playing.', and does not release the pause", async () => {
    const { player } = await open();
    startPlaying(player);
    const lectureStartedBefore = h.stub.control.lectureStarted.mock.calls.length;

    const result = openHelp();
    expect(result.notice).toBe("Lecture paused while Help is open.");
    expect(player.pauseVideo).toHaveBeenCalledTimes(1);

    // YouTube finishes starting anyway, twice.
    player.state = 1;
    act(() => player.emit(1));
    expect(player.pauseVideo).toHaveBeenCalledTimes(2);
    player.state = 1;
    act(() => player.emit(1));
    expect(player.pauseVideo).toHaveBeenCalledTimes(3);

    await settle(100);
    expect(liveText()).not.toMatch(/Playing\./);
    expect(h.stub.control.lectureStarted.mock.calls.length).toBe(lectureStartedBefore);

    // The learner's pause was not released: after Help closes, a lecture that reaches a moment is
    // NOT auto-paused by the watcher, because the watcher only runs while nobody owns the pause.
    closeHelp();
    player.state = 1;
    player.time = 10;
    await settle(1000);
    expect(player.pauseVideo).toHaveBeenCalledTimes(3);
    expect(player.playVideo).not.toHaveBeenCalled();
  });

  it("buffering counts as playing: it is paused, and PLAYING events after the buffering are undone", async () => {
    const { player } = await open();
    player.state = 3;
    act(() => player.emit(3));

    const result = openHelp();
    expect(result.notice).toBe("Lecture paused while Help is open.");
    expect(player.pauseVideo).toHaveBeenCalledTimes(1);

    player.state = 1;
    act(() => player.emit(1));
    player.state = 1;
    act(() => player.emit(1));
    expect(player.pauseVideo).toHaveBeenCalledTimes(3);
  });

  it("control: without Help the same PLAYING event is handled normally (pause released, panel told)", async () => {
    const { player } = await open();
    const before = h.stub.control.lectureStarted.mock.calls.length;
    startPlaying(player);
    expect(player.pauseVideo).not.toHaveBeenCalled();
    expect(h.stub.control.lectureStarted.mock.calls.length).toBe(before + 1);
  });
});

describe("what Help does in each state", () => {
  it("idle: nothing is paused and nothing is said, before or after", async () => {
    const { player } = await open();
    await settle(6000); // the existing "Lecture ready…" announcement clears itself after 5 s
    const result = openHelp();
    expect(result).toEqual({ blocked: false, notice: "" });
    expect(player.pauseVideo).not.toHaveBeenCalled();
    closeHelp();
    await settle(200);
    expect(liveText().replace(/[\s|]/g, "")).toBe("");
    expect(player.playVideo).not.toHaveBeenCalled();
  });

  it("processing: Help opens, nothing is navigated, retried or destroyed, and the banner stays", async () => {
    const onRetryProcessing = vi.fn();
    const { player, onNavigate } = await open({
      promise: new Promise(() => {}),
      processingStatus: { message: "Preparing the shared lecture." },
      onRetryProcessing,
    });
    expect(screen.getByText("Preparing the shared lecture.")).toBeTruthy();

    const result = openHelp();
    expect(result).toEqual({ blocked: false, notice: "" });
    closeHelp();
    await settle(200);

    expect(onNavigate).not.toHaveBeenCalled();
    expect(onRetryProcessing).not.toHaveBeenCalled();
    expect(player.destroy).not.toHaveBeenCalled();
    expect(screen.getByText("Preparing the shared lecture.")).toBeTruthy();
    expect(guard).not.toBeNull();
  });

  it("lecture playing: paused, said so, still paused after Help closes, never resumed, player kept", async () => {
    const { player, onNavigate } = await open();
    startPlaying(player);

    const result = openHelp();
    expect(result).toEqual({ blocked: false, notice: "Lecture paused while Help is open." });
    expect(player.pauseVideo).toHaveBeenCalledTimes(1);

    closeHelp();
    await settle(200);
    expect(liveText()).toMatch(/Help closed\. Playback is still paused\./);
    expect(player.playVideo).not.toHaveBeenCalled();
    expect(playCalls()).toBe(0);
    expect(player.destroy).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "First diagram" })).toBeTruthy();
  });

  it("intervention paused with the explanation audio playing: both paused, never resumed, 'ended' does not resume", async () => {
    const { player } = await open();
    await playToFirstMoment(player); // watcher pauses the video and starts the audio (it is ready)
    await settle(10);
    expect(playCalls()).toBe(1);
    const audio = h.FakeAudio.instances.find((a) => a.play.mock.calls.length > 0);

    const result = openHelp();
    expect(result).toEqual({ blocked: false, notice: "Lecture and explanation audio paused while Help is open." });
    expect(audio.pause).toHaveBeenCalled();
    expect(audio.paused).toBe(true);
    expect(player.pauseVideo).toHaveBeenCalledTimes(2);

    closeHelp();
    await settle(200);
    expect(liveText()).toMatch(/Help closed\. Playback is still paused\./);
    expect(playCalls()).toBe(1);
    expect(player.playVideo).not.toHaveBeenCalled();

    // Even a stray 'ended' (the element had been about to finish) cannot resume the lecture now.
    act(() => audio.emit("ended"));
    expect(player.playVideo).not.toHaveBeenCalled();
  });

  it("a play() that has not settled yet is cancelled, and the screen does not claim it is playing", async () => {
    h.FakeAudio.deferPlay = true;
    const { player } = await open();
    await playToFirstMoment(player); // the watcher calls play(); it stays pending
    const audio = h.FakeAudio.instances.find((a) => a.play.mock.calls.length > 0);
    expect(audio.pendingPlay).not.toBeNull();

    const result = openHelp();
    expect(result.notice).toBe("Lecture and explanation audio paused while Help is open.");
    expect(audio.pause).toHaveBeenCalled();
    expect(audio.pendingPlay).toBeNull();
    await settle(50);
    expect(screen.getByRole("button", { name: "Listen to explanation audio" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pause explanation audio" })).toBeNull();
  });

  it("a voice note that was playing is stopped: said on open, and on close, without touching the lecture", async () => {
    h.stub.control.beforeHelp.mockReturnValue({ blocked: false, stoppedNote: true });
    const { player } = await open();
    const result = openHelp();
    expect(result).toEqual({ blocked: false, notice: "Voice note stopped while Help is open." });
    expect(player.pauseVideo).not.toHaveBeenCalled();
    closeHelp();
    await settle(200);
    expect(liveText()).toMatch(/Help closed\. Voice note stopped\./);
    expect(player.playVideo).not.toHaveBeenCalled();
  });
});

describe("voice-note recording blocks Help", () => {
  beforeEach(() => {
    h.stub.control.beforeHelp.mockReturnValue({ blocked: true, stoppedNote: false });
  });

  it("is refused, says why on this screen, and touches no media", async () => {
    const { player } = await open();
    startPlaying(player);
    const result = openHelp();
    expect(result).toEqual({ blocked: true });
    await settle(200);
    expect(liveText()).toContain(HELP_BLOCKED_RECORDING);
    expect(player.pauseVideo).not.toHaveBeenCalled();
    expect(h.FakeAudio.instances.every((a) => a.pause.mock.calls.length === 0)).toBe(true);
  });

  it("leaves no hold behind: the lecture shortcuts still work afterwards", async () => {
    const { player } = await open();
    openHelp();
    altKey("KeyP", "p");
    expect(player.playVideo).toHaveBeenCalledTimes(1);
  });

  it("closing was never needed, and the guard still answers the next request", async () => {
    await open();
    openHelp();
    h.stub.control.beforeHelp.mockReturnValue({ blocked: false, stoppedNote: false });
    expect(openHelp()).toEqual({ blocked: false, notice: "" });
  });
});

describe("the lecture shortcuts are ignored while Help is open", () => {
  it("none of them reaches the lecture, the audio, the recorder or the announcer; they work again after", async () => {
    const { player } = await open();
    await settle(6000); // the existing "Lecture ready…" announcement clears itself after 5 s
    openHelp();
    const keys = [["KeyP", "p"], ["KeyL", "l"], ["KeyN", "n"], ["KeyB", "b"], ["KeyM", "m"], ["KeyK", "k"], ["Period", "."], ["Comma", ","]];
    for (const [code, key] of keys) altKey(code, key);
    await settle(200);
    expect(player.playVideo).not.toHaveBeenCalled();
    expect(playCalls()).toBe(0);
    expect(h.stub.control.toggle).not.toHaveBeenCalled();
    expect(liveText().replace(/[\s|]/g, "")).toBe("");

    closeHelp();
    altKey("KeyP", "p");
    expect(player.playVideo).toHaveBeenCalledTimes(1);
  });

  it("holds even when focus is on the page body, not inside the dialog", async () => {
    const { player } = await open();
    openHelp();
    document.activeElement?.blur?.();
    fireEvent.keyDown(document.body, { code: "KeyP", key: "p", altKey: true });
    expect(player.playVideo).not.toHaveBeenCalled();
  });
});

describe("unmounting while Help is open", () => {
  it("clears the hold and the registration", async () => {
    const { unmount } = await open();
    openHelp();
    unmount();
    expect(guard).toBeNull();
  });
});
