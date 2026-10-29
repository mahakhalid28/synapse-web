import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMicCapture } from "./micCapture";
import { LIMITS } from "./voiceTurn";

class FakeRecorder {
  static supported = ["audio/webm;codecs=opus"];
  static isTypeSupported = (type) => FakeRecorder.supported.includes(type);
  static last = null;
  constructor(stream, options) {
    this.stream = stream;
    this.options = options;
    this.state = "inactive";
    this.mimeType = options?.mimeType || "";
    FakeRecorder.last = this;
  }
  start = vi.fn(() => {
    this.state = "recording";
  });
  stop = vi.fn(() => {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio-bytes"]) });
    this.onstop?.();
  });
}

function makeEnv({ watcher = true, tracks = 1 } = {}) {
  const env = {
    onLevel: null,
    watcherClose: vi.fn(),
    streamTracks: Array.from({ length: tracks }, () => ({ stop: vi.fn(), onended: null })),
  };
  env.stream = { getTracks: () => env.streamTracks };
  env.deps = {
    hasMediaDevices: () => true,
    getUserMedia: vi.fn(async () => env.stream),
    MediaRecorderCtor: FakeRecorder,
    createLevelWatcher: vi.fn((_stream, onLevel) => {
      env.onLevel = onLevel;
      return watcher ? { close: env.watcherClose } : null;
    }),
    now: () => Date.now(),
  };
  return env;
}

const advance = (ms) => vi.advanceTimersByTime(ms);

// Open the microphone, measure `floor` as the room's noise during the settle period, then start recording.
async function openAndStart(capture, env, floor = 0.001) {
  await capture.open();
  env.onLevel?.(floor);
  advance(LIMITS.SETTLE_MS + 10);
  capture.startRecording();
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeRecorder.supported = ["audio/webm;codecs=opus"];
  FakeRecorder.last = null;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("opening the microphone", () => {
  it("asks for audio only and measures nothing until recording starts", async () => {
    const env = makeEnv();
    const capture = createMicCapture({ deps: env.deps });
    await capture.open();
    expect(env.deps.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(capture.isOpen()).toBe(true);
    expect(FakeRecorder.last).toBeNull();
  });

  it("rejects as unsupported when the browser cannot record", async () => {
    const env = makeEnv();
    env.deps.hasMediaDevices = () => false;
    await expect(createMicCapture({ deps: env.deps }).open()).rejects.toMatchObject({ name: "unsupported" });

    const noRecorder = makeEnv();
    noRecorder.deps.MediaRecorderCtor = undefined;
    await expect(createMicCapture({ deps: noRecorder.deps }).open()).rejects.toMatchObject({ name: "unsupported" });
  });

  it("passes the browser's permission error through", async () => {
    const env = makeEnv();
    const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    env.deps.getUserMedia = vi.fn(async () => { throw denied; });
    await expect(createMicCapture({ deps: env.deps }).open()).rejects.toBe(denied);
  });

  it("releases the microphone if it was cancelled while still opening", async () => {
    const env = makeEnv();
    let resolveOpen;
    env.deps.getUserMedia = vi.fn(() => new Promise((resolve) => { resolveOpen = resolve; }));
    const capture = createMicCapture({ deps: env.deps });
    const opening = capture.open();
    capture.cancel();
    resolveOpen(env.stream);
    await expect(opening).rejects.toMatchObject({ name: "Cancelled" });
    expect(env.streamTracks[0].stop).toHaveBeenCalled();
    expect(capture.isOpen()).toBe(false);
  });
});

describe("recording", () => {
  it("picks a supported container, falling back to the browser default", async () => {
    const env = makeEnv();
    const capture = createMicCapture({ deps: env.deps });
    await openAndStart(capture, env);
    expect(FakeRecorder.last.options).toEqual({ mimeType: "audio/webm;codecs=opus" });

    FakeRecorder.supported = [];
    const second = makeEnv();
    const other = createMicCapture({ deps: second.deps });
    await openAndStart(other, second);
    expect(FakeRecorder.last.options).toBeUndefined();
  });

  it("returns the clip, the duration and whether speech was heard, and releases everything", async () => {
    const env = makeEnv({ tracks: 2 });
    const capture = createMicCapture({ deps: env.deps });
    await openAndStart(capture, env);
    env.onLevel(0.2);
    advance(1000);
    const result = await capture.stop("user");
    expect(result.reason).toBe("user");
    expect(result.heardSpeech).toBe(true);
    expect(result.durationMs).toBe(1000);
    expect(result.blob.size).toBeGreaterThan(0);
    expect(env.watcherClose).toHaveBeenCalled();
    for (const track of env.streamTracks) expect(track.stop).toHaveBeenCalled();
    expect(capture.isOpen()).toBe(false);
  });

  it("reports silence as not heard", async () => {
    const env = makeEnv();
    const capture = createMicCapture({ deps: env.deps });
    await openAndStart(capture, env);
    env.onLevel(0.002);
    advance(1500);
    expect((await capture.stop("user")).heardSpeech).toBe(false);
  });

  it("returns null and releases the microphone when stopped before recording started", async () => {
    const env = makeEnv();
    const capture = createMicCapture({ deps: env.deps });
    await capture.open();
    expect(await capture.stop("user")).toBeNull();
    expect(env.streamTracks[0].stop).toHaveBeenCalled();
  });

  it("discards everything on cancel", async () => {
    const env = makeEnv();
    const capture = createMicCapture({ deps: env.deps });
    await openAndStart(capture, env);
    capture.cancel();
    expect(env.streamTracks[0].stop).toHaveBeenCalled();
    expect(env.watcherClose).toHaveBeenCalled();
    expect(await capture.stop("user")).toBeNull();
  });
});

describe("ending by itself", () => {
  it("stops after silence once speech has been heard", async () => {
    const env = makeEnv();
    const onAutoStop = vi.fn();
    const capture = createMicCapture({ onAutoStop, deps: env.deps });
    await openAndStart(capture, env);

    env.onLevel(0.2);
    advance(800); // speaking
    expect(onAutoStop).not.toHaveBeenCalled();
    env.onLevel(0.001);
    advance(LIMITS.SILENCE_AFTER_SPEECH_MS - 100);
    expect(onAutoStop).not.toHaveBeenCalled();
    advance(200);
    expect(onAutoStop).toHaveBeenCalledTimes(1);
    expect(onAutoStop).toHaveBeenCalledWith("silence");
  });

  it("stops when nobody speaks at all", async () => {
    const env = makeEnv();
    const onAutoStop = vi.fn();
    const capture = createMicCapture({ onAutoStop, deps: env.deps });
    await openAndStart(capture, env);
    advance(LIMITS.NO_SPEECH_TIMEOUT_MS - 100);
    expect(onAutoStop).not.toHaveBeenCalled();
    advance(200);
    expect(onAutoStop).toHaveBeenCalledWith("no_speech");
  });

  it("stops at the maximum length even while the learner keeps talking", async () => {
    const env = makeEnv();
    const onAutoStop = vi.fn();
    const capture = createMicCapture({ onAutoStop, deps: env.deps });
    await openAndStart(capture, env);
    for (let elapsed = 0; elapsed < LIMITS.MAX_UTTERANCE_MS + 200; elapsed += 50) {
      env.onLevel(0.2);
      advance(50);
    }
    expect(onAutoStop).toHaveBeenCalledWith("limit");
    expect(onAutoStop).toHaveBeenCalledTimes(1);
  });

  it("does not count background noise as speech in a noisy room", async () => {
    const env = makeEnv();
    const onAutoStop = vi.fn();
    const capture = createMicCapture({ onAutoStop, deps: env.deps });
    // Noise floor 0.02 -> speech must exceed 0.06.
    await openAndStart(capture, env, 0.02);
    env.onLevel(0.04);
    advance(LIMITS.NO_SPEECH_TIMEOUT_MS + 100);
    expect(onAutoStop).toHaveBeenCalledWith("no_speech");
    expect((await capture.stop("no_speech")).heardSpeech).toBe(false);
  });

  it("fires once even though the checks keep running", async () => {
    const env = makeEnv();
    const onAutoStop = vi.fn();
    const capture = createMicCapture({ onAutoStop, deps: env.deps });
    await openAndStart(capture, env);
    advance(LIMITS.NO_SPEECH_TIMEOUT_MS + 5000);
    expect(onAutoStop).toHaveBeenCalledTimes(1);
  });

  it("reports a lost microphone while recording, and ignores it otherwise", async () => {
    const env = makeEnv();
    const onAutoStop = vi.fn();
    const capture = createMicCapture({ onAutoStop, deps: env.deps });
    await capture.open();
    env.streamTracks[0].onended?.(); // not recording yet
    expect(onAutoStop).not.toHaveBeenCalled();

    const second = makeEnv();
    const onAutoStop2 = vi.fn();
    const recording = createMicCapture({ onAutoStop: onAutoStop2, deps: second.deps });
    await openAndStart(recording, second);
    second.streamTracks[0].onended();
    expect(onAutoStop2).toHaveBeenCalledWith("device_lost");
  });

  it("falls back to the maximum length alone when loudness cannot be measured", async () => {
    const env = makeEnv({ watcher: false });
    const onAutoStop = vi.fn();
    const capture = createMicCapture({ onAutoStop, deps: env.deps });
    await openAndStart(capture, env);
    advance(LIMITS.NO_SPEECH_TIMEOUT_MS + 1000);
    expect(onAutoStop).not.toHaveBeenCalled(); // cannot tell "no speech" without a level
    advance(LIMITS.MAX_UTTERANCE_MS);
    expect(onAutoStop).toHaveBeenCalledWith("limit");
    expect((await capture.stop("limit")).heardSpeech).toBeNull();
  });
});
