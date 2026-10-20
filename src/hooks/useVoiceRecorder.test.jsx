// useVoiceRecorder runs here against hand-written fakes for the microphone,
// MediaRecorder, the level meter and the tone, with fake timers. They check the
// hook's LOGIC (ordering, limits, cleanup, error handling). They do NOT prove
// that a real microphone records: that was shown by the Phase 0 spike, and the
// hook itself still needs a manual run in Electron.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useVoiceRecorder, formatClock, formatDuration, measureSamples, isSilent, describeMicError,
  RECORD_LIMIT_MS, SETTLE_MS, MIN_RECORDING_MS, LIMIT_WARNING_BEFORE_MS,
} from "./useVoiceRecorder.js";

/* ── Fakes ───────────────────────────────────────────────────────────────── */

function makeEnv(over = {}) {
  const order = [];
  const tracks = [{ stop: vi.fn(() => order.push("track.stop")), onended: null }];
  const stream = { getTracks: () => tracks };

  class FakeRecorder {
    static supported = ["audio/webm;codecs=opus"];
    static payload = "voice-bytes";
    static isTypeSupported = (t) => FakeRecorder.supported.includes(t);
    static last = null;
    static startThrows = null;
    constructor(_stream, opts) {
      this.mimeType = opts.mimeType;
      this.state = "inactive";
      FakeRecorder.last = this;
    }
    start() {
      if (FakeRecorder.startThrows) throw FakeRecorder.startThrows;
      order.push("recorder.start");
      this.state = "recording";
    }
    stop() {
      if (this.state === "inactive") return;
      this.state = "inactive";
      if (FakeRecorder.payload) this.ondataavailable?.({ data: new Blob([FakeRecorder.payload], { type: this.mimeType }) });
      Promise.resolve().then(() => this.onstop?.());
    }
  }

  const meter = { read: vi.fn(() => ({ peak: 0.4, rms: 0.05 })), close: vi.fn() };
  const deps = {
    getUserMedia: vi.fn(async () => { order.push("getUserMedia"); return stream; }),
    hasMediaDevices: () => true,
    MediaRecorderCtor: FakeRecorder,
    createLevelMeter: vi.fn(() => meter),
    playTone: vi.fn(async () => { order.push("tone"); }),
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    clock: () => Date.now(),
    ...over.deps,
  };
  const store = {
    saveNote: vi.fn(async (note, blob) => ({ ...note, sizeBytes: blob.size })),
    newNoteId: vi.fn(() => "note-1"),
    ...over.store,
  };
  const options = {
    videoId: "5ugDJhmmkFM",
    jobId: "job-1",
    videoTitle: "The Animal Cell",
    getPointId: vi.fn(() => "point-1"),
    getLectureSeconds: vi.fn(() => { order.push("getLectureSeconds"); return 201.4; }),
    pauseForRecording: vi.fn(() => order.push("pause")),
    announce: vi.fn((msg) => order.push("announce:" + msg)),
    onSaved: vi.fn(),
    store,
    deps,
    ...over.options,
  };
  return { order, tracks, stream, FakeRecorder, meter, deps, store, options };
}

const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const flush = () => advance(0);
const said = (env) => env.options.announce.mock.calls.map((c) => c[0]);

async function begin(env) {
  const hook = renderHook(() => useVoiceRecorder(env.options));
  act(() => { void hook.result.current.start(); });
  return hook;
}
async function beginRecording(env) {
  const hook = await begin(env);
  await advance(SETTLE_MS);
  return hook;
}
async function stopUser(hook) {
  await act(async () => { await hook.result.current.stop("user"); });
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

/* ── Pure helpers ────────────────────────────────────────────────────────── */

describe("helpers", () => {
  it("formatClock", () => {
    expect([formatClock(0), formatClock(9.9), formatClock(201.4), formatClock(3725), formatClock(-5), formatClock(NaN)])
      .toEqual(["0:00", "0:09", "3:21", "1:02:05", "0:00", "0:00"]);
  });

  it("formatDuration is spoken English", () => {
    expect([formatDuration(1000), formatDuration(4980), formatDuration(60000), formatDuration(65000), formatDuration(120000)])
      .toEqual(["1 second", "5 seconds", "1 minute", "1 minute 5 seconds", "2 minutes"]);
  });

  it("measureSamples finds peak and RMS", () => {
    const m = measureSamples(new Float32Array([0, 0.5, -0.5, 0]));
    expect(m.peak).toBeCloseTo(0.5);
    expect(m.rms).toBeCloseTo(Math.sqrt(0.125));
    expect(measureSamples([])).toEqual({ peak: 0, rms: 0 });
  });

  it.each([
    ["loud speech", { peak: 0.4, rms: 0.05 }, false],
    ["exactly the minimum", { peak: 0.01, rms: 0.002 }, false],
    ["digital silence", { peak: 0, rms: 0 }, true],
    ["a quiet hiss", { peak: 0.004, rms: 0.001 }, true],
    ["one loud click and nothing else", { peak: 0.5, rms: 0.0005 }, true],
    ["no measurement", null, null],
    ["a broken measurement", { peak: NaN, rms: 0 }, null],
  ])("isSilent: %s", (_n, signal, expected) => {
    expect(isSilent(signal)).toBe(expected);
  });

  it.each([
    ["NotAllowedError", "blocked", /Let desktop apps access your microphone/],
    ["SecurityError", "blocked", /blocked/],
    ["NotFoundError", "no_microphone", /No microphone was found/],
    ["OverconstrainedError", "no_microphone", /No microphone/],
    ["NotReadableError", "busy", /another app/],
    ["AbortError", "busy", /not responding/],
    ["unsupported", "unsupported", /can't record audio/],
    ["TypeError", "failed", /unexpected problem/],
    [undefined, "failed", /unexpected problem/],
  ])("describeMicError %s", (name, code, message) => {
    const d = describeMicError(name === undefined ? undefined : { name });
    expect(d.code).toBe(code);
    expect(d.message).toMatch(message);
  });
});

/* ── Start sequence ──────────────────────────────────────────────────────── */

describe("starting a note", () => {
  it("reads the lecture time first, then pauses, announces, opens the mic, plays the tone, and only then records", async () => {
    const env = makeEnv();
    const hook = await beginRecording(env);

    const names = env.order.map((o) => (o.startsWith("announce:") ? "announce" : o));
    expect(names.slice(0, 6)).toEqual(["getLectureSeconds", "pause", "announce", "getUserMedia", "tone", "recorder.start"]);
    expect(env.order[2]).toBe("announce:Lecture paused. Recording starts after the tone.");
    expect(hook.result.current.status).toBe("recording");
    expect(env.options.pauseForRecording).toHaveBeenCalledTimes(1);
  });

  it("does not start recording before the speech-settle delay has passed", async () => {
    const env = makeEnv();
    const hook = await begin(env);
    await advance(SETTLE_MS - 1);
    expect(hook.result.current.status).toBe("preparing");
    expect(env.deps.playTone).not.toHaveBeenCalled();
    expect(env.order).not.toContain("recorder.start");
    await advance(1);
    expect(hook.result.current.status).toBe("recording");
  });

  it("stores the lecture time from BEFORE the pause, even if pausing changes the player time", async () => {
    let t = 201.4;
    const env = makeEnv({ options: { getLectureSeconds: vi.fn(() => t), pauseForRecording: vi.fn(() => { t = 0; }) } });
    const hook = await beginRecording(env);
    await advance(5000);
    await stopUser(hook);
    expect(env.store.saveNote.mock.calls[0][0].lectureSeconds).toBe(201.4);
  });

  it("ignores a second start while one is already in progress", async () => {
    const env = makeEnv();
    const hook = await begin(env);
    act(() => { void hook.result.current.start(); });
    await advance(SETTLE_MS);
    act(() => { void hook.result.current.start(); });
    expect(env.deps.getUserMedia).toHaveBeenCalledTimes(1);
    expect(env.options.pauseForRecording).toHaveBeenCalledTimes(1);
  });

  it("refuses to start when the player time is unknown, without pausing or opening the microphone", async () => {
    for (const bad of [undefined, NaN, -1, Infinity, "12"]) {
      const env = makeEnv({ options: { getLectureSeconds: vi.fn(() => bad) } });
      const hook = await begin(env);
      expect(hook.result.current.status).toBe("idle");
      expect(hook.result.current.error.code).toBe("player_not_ready");
      expect(env.options.pauseForRecording).not.toHaveBeenCalled();
      expect(env.deps.getUserMedia).not.toHaveBeenCalled();
      expect(said(env).join(" ")).toMatch(/player isn't ready/);
      hook.unmount();
    }
  });

  it("falls back to a plain audio/webm type when opus is not supported", async () => {
    const env = makeEnv();
    env.FakeRecorder.supported = ["audio/webm"];
    const hook = await beginRecording(env);
    await advance(2000);
    await stopUser(hook);
    expect(env.store.saveNote.mock.calls[0][0].mimeType).toBe("audio/webm");
  });

  it.each([
    ["no supported audio type", (env) => { env.FakeRecorder.supported = []; }],
    ["no MediaRecorder", (env) => { env.deps.MediaRecorderCtor = undefined; }],
    ["no microphone API", (env) => { env.deps.hasMediaDevices = () => false; }],
  ])("reports 'unsupported' and does nothing else when there is %s", async (_n, breakIt) => {
    const env = makeEnv();
    breakIt(env);
    const hook = await begin(env);
    expect(hook.result.current.error.code).toBe("unsupported");
    expect(hook.result.current.status).toBe("idle");
    expect(env.options.pauseForRecording).not.toHaveBeenCalled();
    expect(env.deps.getUserMedia).not.toHaveBeenCalled();
  });

  it("keeps playing even if the tone cannot be played", async () => {
    const env = makeEnv({ deps: { playTone: vi.fn(async () => undefined) } });
    const hook = await beginRecording(env);
    expect(hook.result.current.status).toBe("recording");
  });
});

/* ── Microphone errors ───────────────────────────────────────────────────── */

describe("microphone errors", () => {
  it.each([
    ["NotAllowedError", "blocked", /Let desktop apps access your microphone/],
    ["NotFoundError", "no_microphone", /No microphone was found/],
    ["NotReadableError", "busy", /another app/],
    ["OverconstrainedError", "no_microphone", /No microphone/],
    ["SecurityError", "blocked", /blocked/],
    ["AbortError", "busy", /not responding/],
  ])("%s: clear message, lecture stays paused, no recording, can retry", async (name, code, message) => {
    let fail = true;
    const env = makeEnv({
      deps: {
        getUserMedia: vi.fn(async () => {
          if (fail) throw Object.assign(new Error("denied by test"), { name });
          return env0.stream;
        }),
      },
    });
    const env0 = env;
    const hook = await begin(env);
    await advance(SETTLE_MS);

    expect(hook.result.current.status).toBe("idle");
    expect(hook.result.current.error.code).toBe(code);
    expect(hook.result.current.error.message).toMatch(message);
    expect(env.options.pauseForRecording).toHaveBeenCalledTimes(1);
    expect(env.deps.playTone).not.toHaveBeenCalled();
    expect(env.order).not.toContain("recorder.start");
    expect(said(env).at(-1)).toMatch(/The lecture is still paused\.$/);

    fail = false; // fixed the problem: a retry works
    act(() => { void hook.result.current.start(); });
    await advance(SETTLE_MS);
    expect(hook.result.current.status).toBe("recording");
    expect(hook.result.current.error).toBeNull();
  });

  it("stops the tracks and reports a failure if the recorder cannot start", async () => {
    const env = makeEnv();
    env.FakeRecorder.startThrows = Object.assign(new Error("boom"), { name: "NotSupportedError" });
    const hook = await beginRecording(env);
    expect(hook.result.current.status).toBe("idle");
    expect(hook.result.current.error.code).toBe("failed");
    expect(env.tracks[0].stop).toHaveBeenCalled();
    expect(env.meter.close).toHaveBeenCalled();
  });

  it("clearError removes the error", async () => {
    const env = makeEnv({ options: { getLectureSeconds: vi.fn(() => undefined) } });
    const hook = await begin(env);
    expect(hook.result.current.error).not.toBeNull();
    act(() => hook.result.current.clearError());
    expect(hook.result.current.error).toBeNull();
  });
});

/* ── Recording and saving ────────────────────────────────────────────────── */

describe("stopping and saving", () => {
  it("saves the note with the lecture time, duration, type and moment, stops every track, and never resumes anything", async () => {
    const env = makeEnv();
    const hook = await beginRecording(env);
    await advance(5000);
    await stopUser(hook);

    expect(env.store.saveNote).toHaveBeenCalledTimes(1);
    const [note, blob] = env.store.saveNote.mock.calls[0];
    expect(note).toMatchObject({
      id: "note-1", videoId: "5ugDJhmmkFM", jobId: "job-1", videoTitle: "The Animal Cell",
      pointId: "point-1", lectureSeconds: 201.4, mimeType: "audio/webm;codecs=opus", label: "", silentWarning: false,
    });
    expect(note.durationMs).toBe(5000);
    expect(note.createdAt).toBeGreaterThan(0);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBe("voice-bytes".length);

    expect(hook.result.current.status).toBe("idle");
    expect(hook.result.current.draft).toBeNull();
    expect(env.options.onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: "note-1" }));
    expect(env.tracks[0].stop).toHaveBeenCalled();
    expect(env.meter.close).toHaveBeenCalled();
    expect(said(env).at(-1)).toBe("Voice note saved at 3:21, 5 seconds. The lecture is still paused.");
    // The only thing the hook ever does to the lecture is pause it: once.
    expect(env.options.pauseForRecording).toHaveBeenCalledTimes(1);
  });

  it("stops the tracks only after the recorder has finished (so the last audio is kept)", async () => {
    const env = makeEnv();
    const hook = await beginRecording(env);
    await advance(2000);
    await stopUser(hook);
    expect(env.order.indexOf("track.stop")).toBeGreaterThan(env.order.indexOf("recorder.start"));
  });

  it("warns without blocking when the recording looks silent", async () => {
    const env = makeEnv();
    env.meter.read.mockReturnValue({ peak: 0.002, rms: 0.0004 });
    const hook = await beginRecording(env);
    await advance(3000);
    await stopUser(hook);
    expect(env.store.saveNote.mock.calls[0][0].silentWarning).toBe(true);
    expect(said(env).at(-1)).toMatch(/Warning: this recording may be silent/);
    expect(env.options.onSaved).toHaveBeenCalled(); // still saved
  });

  it("does not warn when the level could not be measured", async () => {
    const env = makeEnv({ deps: { createLevelMeter: vi.fn(() => null) } });
    const hook = await beginRecording(env);
    await advance(3000);
    await stopUser(hook);
    expect(env.store.saveNote.mock.calls[0][0].silentWarning).toBe(false);
  });

  it("does not save an accidental press (shorter than the minimum) and says so", async () => {
    const env = makeEnv();
    const hook = await beginRecording(env);
    await advance(MIN_RECORDING_MS - 100);
    await stopUser(hook);
    expect(env.store.saveNote).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("idle");
    expect(said(env).at(-1)).toMatch(/too short and was not saved\. The lecture is still paused\.$/);
    expect(env.tracks[0].stop).toHaveBeenCalled();
  });

  it("reports an empty recording instead of saving it", async () => {
    const env = makeEnv();
    env.FakeRecorder.payload = "";
    const hook = await beginRecording(env);
    await advance(3000);
    await stopUser(hook);
    expect(env.store.saveNote).not.toHaveBeenCalled();
    expect(hook.result.current.error.code).toBe("empty");
  });

  it("updates elapsed time while recording", async () => {
    const env = makeEnv();
    const hook = await beginRecording(env);
    await advance(2000);
    expect(hook.result.current.elapsedMs).toBeGreaterThanOrEqual(1750);
    expect(hook.result.current.elapsedMs).toBeLessThanOrEqual(2000);
  });

  it("toggle starts, then stops (the Alt+M behaviour)", async () => {
    const env = makeEnv();
    const hook = renderHook(() => useVoiceRecorder(env.options));
    act(() => { void hook.result.current.toggle(); });
    await advance(SETTLE_MS);
    expect(hook.result.current.status).toBe("recording");
    await advance(2000);
    await act(async () => { await hook.result.current.toggle(); });
    expect(env.store.saveNote).toHaveBeenCalledTimes(1);
    expect(hook.result.current.status).toBe("idle");
  });

  it("toggle does nothing while a draft or a save is waiting on the learner", async () => {
    const env = makeEnv({ store: { saveNote: vi.fn(async () => { throw Object.assign(new Error("Full"), { code: "quota" }); }) } });
    const hook = await beginRecording(env);
    await advance(2000);
    await stopUser(hook);
    expect(hook.result.current.status).toBe("save_failed");
    await act(async () => { await hook.result.current.toggle(); });
    expect(hook.result.current.status).toBe("save_failed");
    expect(env.deps.getUserMedia).toHaveBeenCalledTimes(1);
  });
});

/* ── Limit ───────────────────────────────────────────────────────────────── */

describe("five minute limit", () => {
  it("warns 30 seconds before the limit, then stops and saves at the limit", async () => {
    const env = makeEnv();
    const hook = await beginRecording(env);

    await advance(RECORD_LIMIT_MS - LIMIT_WARNING_BEFORE_MS - 1000);
    expect(said(env).some((m) => /seconds left/.test(m))).toBe(false);
    await advance(1000);
    expect(said(env)).toContain("30 seconds left in this recording.");
    expect(hook.result.current.status).toBe("recording");

    await advance(LIMIT_WARNING_BEFORE_MS);
    expect(said(env)).toContain("Maximum length of 5 minutes reached. Recording stopped.");
    expect(hook.result.current.status).toBe("idle");
    expect(env.store.saveNote).toHaveBeenCalledTimes(1);
    expect(env.store.saveNote.mock.calls[0][0].durationMs).toBe(RECORD_LIMIT_MS);
    expect(env.tracks[0].stop).toHaveBeenCalled();
  });

  it("the limit is exactly five minutes", () => {
    expect(RECORD_LIMIT_MS).toBe(300000);
  });

  it("getStatus() and getDraft() are always current, even before React re-renders", async () => {
    const env = makeEnv();
    const hook = renderHook(() => useVoiceRecorder(env.options));
    expect(hook.result.current.getStatus()).toBe("idle");
    expect(hook.result.current.getDraft()).toBeNull();

    act(() => { void hook.result.current.start(); });
    expect(hook.result.current.getStatus()).toBe("preparing");
    await advance(SETTLE_MS);
    expect(hook.result.current.getStatus()).toBe("recording");

    await advance(3000);
    await act(async () => { await hook.result.current.stopForLeaving(); });
    expect(hook.result.current.getStatus()).toBe("draft");
    expect(hook.result.current.getDraft().durationMs).toBe(3000);

    act(() => hook.result.current.discardDraft());
    expect(hook.result.current.getStatus()).toBe("idle");
    expect(hook.result.current.getDraft()).toBeNull();
  });

  it("does not warn or stop again after the learner already stopped", async () => {
    const env = makeEnv();
    const hook = await beginRecording(env);
    await advance(10000);
    await stopUser(hook);
    const before = said(env).length;
    await advance(RECORD_LIMIT_MS);
    expect(said(env)).toHaveLength(before);
    expect(env.store.saveNote).toHaveBeenCalledTimes(1);
  });
});

/* ── Cancel, leave, device loss ──────────────────────────────────────────── */

describe("cancelling and leaving", () => {
  it("cancelling during the settle delay closes the microphone immediately and records nothing", async () => {
    const env = makeEnv();
    const hook = await begin(env);
    await advance(500);
    expect(env.tracks[0].stop).not.toHaveBeenCalled();
    await act(async () => { await hook.result.current.stop("user"); });

    expect(hook.result.current.status).toBe("idle");
    expect(env.tracks[0].stop).toHaveBeenCalled(); // closed right away, not after the delay
    expect(said(env).at(-1)).toBe("Recording cancelled. The lecture is still paused.");
    await advance(SETTLE_MS * 2);
    expect(env.deps.playTone).not.toHaveBeenCalled();
    expect(env.order).not.toContain("recorder.start");
    expect(env.store.saveNote).not.toHaveBeenCalled();
  });

  it("can start again right after a cancel without the old attempt interfering", async () => {
    const env = makeEnv();
    const hook = await begin(env);
    await advance(300);
    await act(async () => { await hook.result.current.stop("user"); });
    act(() => { void hook.result.current.start(); });
    await advance(SETTLE_MS);
    expect(hook.result.current.status).toBe("recording");
    expect(env.order.filter((o) => o === "recorder.start")).toHaveLength(1);
  });

  it("stopForLeaving while recording stops the microphone and HOLDS the audio; nothing is saved silently", async () => {
    const env = makeEnv();
    const hook = await beginRecording(env);
    await advance(4000);
    let held;
    await act(async () => { held = await hook.result.current.stopForLeaving(); });

    expect(env.store.saveNote).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("draft");
    expect(held.durationMs).toBe(4000);
    expect(held.blob.size).toBeGreaterThan(0);
    expect(hook.result.current.draft).toBe(held);
    expect(env.tracks[0].stop).toHaveBeenCalled();
    expect(said(env).at(-1)).toBe("Recording stopped. Choose Save or Discard.");
  });

  it("saveDraft saves a held draft with the given label", async () => {
    const env = makeEnv();
    const hook = await beginRecording(env);
    await advance(4000);
    await act(async () => { await hook.result.current.stopForLeaving(); });
    await act(async () => { await hook.result.current.saveDraft("Ask about the nucleus"); });

    expect(env.store.saveNote).toHaveBeenCalledTimes(1);
    expect(env.store.saveNote.mock.calls[0][0]).toMatchObject({ label: "Ask about the nucleus", lectureSeconds: 201.4, durationMs: 4000 });
    expect(hook.result.current.status).toBe("idle");
    expect(hook.result.current.draft).toBeNull();
  });

  it("discardDraft drops the audio and announces it", async () => {
    const env = makeEnv();
    const hook = await beginRecording(env);
    await advance(4000);
    await act(async () => { await hook.result.current.stopForLeaving(); });
    act(() => hook.result.current.discardDraft());

    expect(env.store.saveNote).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("idle");
    expect(hook.result.current.draft).toBeNull();
    expect(said(env).at(-1)).toBe("Recording discarded.");
  });

  it("stopForLeaving when idle or preparing returns null", async () => {
    const env = makeEnv();
    const hook = renderHook(() => useVoiceRecorder(env.options));
    let held = "unset";
    await act(async () => { held = await hook.result.current.stopForLeaving(); });
    expect(held).toBeNull();

    act(() => { void hook.result.current.start(); });
    await advance(300);
    await act(async () => { held = await hook.result.current.stopForLeaving(); });
    expect(held).toBeNull();
    expect(hook.result.current.status).toBe("idle");
    expect(env.tracks[0].stop).toHaveBeenCalled();
  });

  it("when the microphone disappears mid-recording the audio is held, not saved", async () => {
    const env = makeEnv();
    const hook = await beginRecording(env);
    await advance(3000);
    await act(async () => { env.tracks[0].onended(); });
    await flush();

    expect(env.store.saveNote).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("draft");
    expect(hook.result.current.draft.durationMs).toBe(3000);
    expect(said(env).at(-1)).toBe("The microphone stopped working. Choose Save or Discard for what was recorded.");
  });
});

/* ── Save failures ───────────────────────────────────────────────────────── */

describe("save failures", () => {
  it("keeps the audio, explains, and lets the learner retry (same id) or discard", async () => {
    let failing = true;
    const saveNote = vi.fn(async (note, blob) => {
      if (failing) throw Object.assign(new Error("There is not enough storage space to save this voice note."), { code: "quota" });
      return { ...note, sizeBytes: blob.size };
    });
    const env = makeEnv({ store: { saveNote } });
    const hook = await beginRecording(env);
    await advance(3000);
    await stopUser(hook);

    expect(hook.result.current.status).toBe("save_failed");
    expect(hook.result.current.draft.blob.size).toBeGreaterThan(0);
    expect(hook.result.current.error).toEqual({ code: "quota", message: "There is not enough storage space to save this voice note." });
    expect(said(env).at(-1)).toBe("There is not enough storage space to save this voice note. Choose Retry or Discard.");
    expect(env.options.onSaved).not.toHaveBeenCalled();

    failing = false;
    await act(async () => { await hook.result.current.saveDraft(); });
    expect(hook.result.current.status).toBe("idle");
    expect(hook.result.current.error).toBeNull();
    expect(saveNote.mock.calls[0][0].id).toBe(saveNote.mock.calls[1][0].id); // a retry never makes a second note
    expect(env.store.newNoteId).toHaveBeenCalledTimes(1);
    expect(env.options.onSaved).toHaveBeenCalledTimes(1);
  });

  it("discarding after a failed save frees the audio", async () => {
    const env = makeEnv({ store: { saveNote: vi.fn(async () => { throw new Error("nope"); }) } });
    const hook = await beginRecording(env);
    await advance(3000);
    await stopUser(hook);
    act(() => hook.result.current.discardDraft());
    expect(hook.result.current.status).toBe("idle");
    expect(hook.result.current.draft).toBeNull();
    expect(hook.result.current.error).toBeNull();
  });

  it("saveDraft and discardDraft are harmless when there is no draft", async () => {
    const env = makeEnv();
    const hook = renderHook(() => useVoiceRecorder(env.options));
    let result = "unset";
    await act(async () => { result = await hook.result.current.saveDraft(); });
    expect(result).toBeNull();
    act(() => hook.result.current.discardDraft());
    expect(env.store.saveNote).not.toHaveBeenCalled();
    expect(said(env)).toEqual([]);
  });
});

/* ── Audio isolation ─────────────────────────────────────────────────────── */

describe("lecture or TTS starting while recording", () => {
  it("pauses again and explains why", async () => {
    const env = makeEnv();
    const hook = await beginRecording(env);
    let handled;
    act(() => { handled = hook.result.current.onLecturePlayed(); });
    expect(handled).toBe(true);
    expect(env.options.pauseForRecording).toHaveBeenCalledTimes(2);
    expect(said(env).at(-1)).toBe("The lecture was paused again because it can't play while you record.");
  });

  it("also applies while preparing", async () => {
    const env = makeEnv();
    const hook = await begin(env);
    await advance(200);
    act(() => { hook.result.current.onLecturePlayed(); });
    expect(env.options.pauseForRecording).toHaveBeenCalledTimes(2);
  });

  it("does nothing when not recording (normal playback is never interfered with)", () => {
    const env = makeEnv();
    const hook = renderHook(() => useVoiceRecorder(env.options));
    let handled;
    act(() => { handled = hook.result.current.onLecturePlayed(); });
    expect(handled).toBe(false);
    expect(env.options.pauseForRecording).not.toHaveBeenCalled();
    expect(said(env)).toEqual([]);
  });

  it("does nothing after recording ended (the learner may resume the lecture)", async () => {
    const env = makeEnv();
    const hook = await beginRecording(env);
    await advance(2000);
    await stopUser(hook);
    act(() => { hook.result.current.onLecturePlayed(); });
    expect(env.options.pauseForRecording).toHaveBeenCalledTimes(1);
  });
});

/* ── Cleanup ─────────────────────────────────────────────────────────────── */

describe("cleanup", () => {
  it("unmounting while recording stops the microphone and the meter and saves nothing", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = makeEnv();
    const hook = await beginRecording(env);
    await advance(2000);
    hook.unmount();
    await advance(RECORD_LIMIT_MS);

    expect(env.tracks[0].stop).toHaveBeenCalled();
    expect(env.meter.close).toHaveBeenCalled();
    expect(env.FakeRecorder.last.state).toBe("inactive");
    expect(env.store.saveNote).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });

  it("unmounting while the microphone is still opening releases it when it arrives", async () => {
    let release;
    const env = makeEnv();
    env.deps.getUserMedia = vi.fn(() => new Promise((resolve) => { release = () => resolve(env.stream); }));
    const hook = await begin(env);
    await advance(SETTLE_MS);
    hook.unmount();
    release();
    await flush();
    expect(env.tracks[0].stop).toHaveBeenCalled();
    expect(env.FakeRecorder.last).toBeNull();
  });

  it("closing the window (pagehide / beforeunload) frees the microphone", async () => {
    for (const type of ["pagehide", "beforeunload"]) {
      const env = makeEnv();
      const hook = await beginRecording(env);
      await advance(1000);
      act(() => { window.dispatchEvent(new Event(type)); });
      expect(env.tracks[0].stop).toHaveBeenCalled();
      expect(env.store.saveNote).not.toHaveBeenCalled();
      hook.unmount();
    }
  });

  it("removes its window listeners on unmount", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const env = makeEnv();
    const hook = renderHook(() => useVoiceRecorder(env.options));
    const added = add.mock.calls.map((c) => c[0]).filter((t) => t === "pagehide" || t === "beforeunload");
    hook.unmount();
    const removed = remove.mock.calls.map((c) => c[0]).filter((t) => t === "pagehide" || t === "beforeunload");
    expect(added.sort()).toEqual(removed.sort());
    expect(added).toHaveLength(2);
  });

  it("a note being saved when the learner leaves still completes (they pressed Stop)", async () => {
    let finish;
    const saveNote = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const env = makeEnv({ store: { saveNote } });
    const hook = await beginRecording(env);
    await advance(2000);
    act(() => { void hook.result.current.stop("user"); });
    await flush();
    hook.unmount();
    finish({ id: "note-1", lectureSeconds: 201.4, durationMs: 2000 });
    await flush();
    expect(saveNote).toHaveBeenCalledTimes(1);
  });
});
