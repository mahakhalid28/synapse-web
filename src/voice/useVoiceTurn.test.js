import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VoiceTurnController } from "./useVoiceTurn";
import { createVoiceAudioRegistry } from "./voiceAudio";
import { LIMITS, TURN } from "./voiceTurn";

// A stand-in for the lecture screen's audio port. pause() behaves like the real one: it silences whatever is
// playing and hands the pause to the learner.
function makePort(initial = {}, { stubborn = false } = {}) {
  const state = { lecture: "paused", explanation: "none", pauseOwner: null, ...initial };
  return {
    state,
    getSnapshot: vi.fn(() => ({ ...state })),
    pause: vi.fn(() => {
      if (!stubborn) {
        if (state.lecture === "playing" || state.lecture === "buffering") state.lecture = "paused";
        if (state.explanation === "playing") state.explanation = "paused";
      }
      state.pauseOwner = "user";
    }),
    restore: vi.fn(),
    isNoteBusy: vi.fn(() => false),
  };
}

function makeCapture({ openError = null, result = {} } = {}) {
  const capture = {
    opts: null,
    open: vi.fn(async () => {
      if (openError) throw openError;
    }),
    startRecording: vi.fn(),
    stop: vi.fn(async (reason) => ({
      blob: new Blob(["clip"]),
      durationMs: 2000,
      reason,
      heardSpeech: true,
      ...result,
    })),
    cancel: vi.fn(),
  };
  return capture;
}

const SPEECH = Float32Array.from({ length: 1600 }, (_, i) => Math.sin(i / 5) * 0.4);

function setup({ port, capture = makeCapture(), samples = SPEECH, onUtterance = vi.fn(async () => ({})) } = {}) {
  const order = [];
  const registry = createVoiceAudioRegistry();
  if (port) registry.register(port);
  const announce = vi.fn((message) => order.push(`say:${message}`));
  const statuses = [];

  if (port) {
    const { pause, restore } = port;
    port.pause = vi.fn((...args) => {
      order.push("pause");
      return pause(...args);
    });
    port.restore = vi.fn((...args) => {
      order.push("restore");
      return restore(...args);
    });
  }
  const originalOpen = capture.open;
  capture.open = vi.fn(async () => {
    order.push("open");
    return originalOpen();
  });
  const originalStart = capture.startRecording;
  capture.startRecording = vi.fn(() => {
    order.push("record");
    return originalStart();
  });
  const originalStop = capture.stop;
  capture.stop = vi.fn(async (reason) => {
    order.push("stop");
    return originalStop(reason);
  });

  const deps = {
    createCapture: vi.fn((options) => {
      capture.opts = options;
      return capture;
    }),
    toWav16k: vi.fn(async () => ({ blob: new Blob(["wav"]), samples, sampleRate: 16000, durationMs: 100 })),
    playTone: vi.fn(async (hz) => {
      order.push(`tone:${hz}`);
    }),
    wait: vi.fn(async () => {}),
  };
  const controller = new VoiceTurnController((status) => statuses.push(status));
  controller.configure({ registry, onUtterance, announce, deps });
  return { controller, registry, port, capture, deps, announce, statuses, order, onUtterance };
}

// Start a turn and wait until it is listening.
async function startListening(env) {
  await env.controller.toggle();
  expect(env.controller.status).toBe(TURN.LISTENING);
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a normal turn", () => {
  it("pauses and checks it is quiet, opens the mic, tones, records, stops, then restores - in that order", async () => {
    const env = setup({ port: makePort({ lecture: "playing" }) });
    await startListening(env);
    expect(env.order).toEqual(["pause", "open", "tone:880", "record"]);

    await env.controller.toggle(); // stop
    expect(env.order).toEqual(["pause", "open", "tone:880", "record", "stop", "tone:587", "restore"]);
    expect(env.controller.status).toBe(TURN.IDLE);
    expect(env.statuses).toEqual([TURN.PREPARING, TURN.LISTENING, TURN.PROCESSING, TURN.IDLE]);
  });

  it("says nothing while the microphone is open", async () => {
    const env = setup({ port: makePort({ lecture: "playing" }) });
    await startListening(env);
    expect(env.announce).not.toHaveBeenCalled();
  });

  it("holds the microphone-in-use flag for exactly the length of the turn", async () => {
    const env = setup({ port: makePort({ lecture: "playing" }) });
    expect(env.registry.isTurnActive()).toBe(false);
    const starting = env.controller.toggle();
    expect(env.registry.isTurnActive()).toBe(true);
    await starting;
    expect(env.registry.isTurnActive()).toBe(true);
    await env.controller.toggle();
    expect(env.registry.isTurnActive()).toBe(false);
  });

  it("hands a 16 kHz WAV and its measurements to onUtterance", async () => {
    const env = setup({ port: makePort() });
    await startListening(env);
    await env.controller.toggle();
    const utterance = env.onUtterance.mock.calls[0][0];
    expect(utterance.wav).toBeInstanceOf(Blob);
    expect(utterance.sampleRate).toBe(16000);
    expect(utterance.durationMs).toBe(100);
    expect(utterance.endedBy).toBe("user");
    expect(utterance.peak).toBeGreaterThan(0.3);
    expect(utterance.silent).toBe(false);
  });

  it("marks a silent clip as silent", async () => {
    const env = setup({ port: makePort(), samples: new Float32Array(1600) });
    await startListening(env);
    await env.controller.toggle();
    expect(env.onUtterance.mock.calls[0][0].silent).toBe(true);
  });

  it("works on screens with no audio at all: nothing to pause or restore", async () => {
    const env = setup({ port: null });
    await startListening(env);
    await env.controller.toggle();
    expect(env.order).toEqual(["open", "tone:880", "record", "stop", "tone:587"]);
    expect(env.onUtterance).toHaveBeenCalledTimes(1);
  });

  it("can run another turn afterwards", async () => {
    const env = setup({ port: makePort({ lecture: "playing" }) });
    for (let i = 0; i < 2; i++) {
      await startListening(env);
      await env.controller.toggle();
      expect(env.controller.status).toBe(TURN.IDLE);
    }
    expect(env.onUtterance).toHaveBeenCalledTimes(2);
  });
});

describe("restoring audio afterwards", () => {
  it("resumes the lecture that was playing", async () => {
    const port = makePort({ lecture: "playing" });
    const env = setup({ port });
    await startListening(env);
    await env.controller.toggle();
    expect(port.restore).toHaveBeenCalledWith({ lecture: true, explanation: false, restoreOwner: true, pauseOwner: null });
  });

  it("resumes only the explanation, and keeps the 'intervention' owner so the lecture resumes when it ends", async () => {
    const port = makePort({ lecture: "paused", explanation: "playing", pauseOwner: "intervention" });
    const env = setup({ port });
    await startListening(env);
    await env.controller.toggle();
    expect(port.restore).toHaveBeenCalledWith({
      lecture: false,
      explanation: true,
      restoreOwner: true,
      pauseOwner: "intervention",
    });
  });

  it("resumes nothing when nothing was playing, but gives the pause back to its owner", async () => {
    const port = makePort({ lecture: "paused", explanation: "paused", pauseOwner: "intervention" });
    const env = setup({ port });
    await startListening(env);
    await env.controller.toggle();
    expect(port.restore).toHaveBeenCalledWith({
      lecture: false,
      explanation: false,
      restoreOwner: true,
      pauseOwner: "intervention",
    });
  });

  it("does not resume after a spoken playback command", async () => {
    const port = makePort({ lecture: "playing" });
    const env = setup({ port, onUtterance: vi.fn(async () => ({ playbackCommand: "pause" })) });
    await startListening(env);
    await env.controller.toggle();
    expect(port.restore).not.toHaveBeenCalled();
  });

  it("does not resume if the learner moved to another screen while it listened", async () => {
    const port = makePort({ lecture: "playing" });
    const env = setup({ port });
    await startListening(env);
    env.registry.unregister(port);
    env.registry.register(makePort());
    await env.controller.toggle();
    expect(port.restore).not.toHaveBeenCalled();
    expect(env.onUtterance).toHaveBeenCalledTimes(1); // the words are still handled
  });

  it("does not resume if the lecture screen was closed while it listened", async () => {
    const port = makePort({ lecture: "playing" });
    const env = setup({ port });
    await startListening(env);
    env.registry.unregister(port);
    await env.controller.toggle();
    expect(port.restore).not.toHaveBeenCalled();
  });
});

describe("refusing and failing safely", () => {
  it("does not start while a voice note is being recorded", async () => {
    const port = makePort({ lecture: "playing" });
    port.isNoteBusy.mockReturnValue(true);
    const env = setup({ port });
    await env.controller.toggle();
    expect(port.pause).not.toHaveBeenCalled();
    expect(env.deps.createCapture).not.toHaveBeenCalled();
    expect(env.controller.status).toBe(TURN.IDLE);
    expect(env.registry.isTurnActive()).toBe(false);
    expect(env.announce).toHaveBeenCalledWith(expect.stringContaining("voice note"));
  });

  it("stops a recording voice note instead of starting a turn", async () => {
    const port = makePort({ lecture: "playing" });
    port.isNoteBusy.mockReturnValue(true);
    port.stopNote = vi.fn(() => true);
    const env = setup({ port });
    await env.controller.toggle();
    expect(port.stopNote).toHaveBeenCalledTimes(1);
    expect(port.pause).not.toHaveBeenCalled();
    expect(env.deps.createCapture).not.toHaveBeenCalled();
    expect(env.controller.status).toBe(TURN.IDLE);
  });

  it("does not open the microphone if the audio cannot be confirmed paused, and puts it back", async () => {
    const port = makePort({ lecture: "playing" }, { stubborn: true });
    const env = setup({ port });
    await env.controller.toggle();
    expect(env.deps.createCapture).not.toHaveBeenCalled();
    expect(env.controller.status).toBe(TURN.IDLE);
    expect(env.announce).toHaveBeenCalledWith(expect.stringContaining("could not pause"));
    expect(env.announce).toHaveBeenCalledWith(expect.stringContaining("headphones"));
    expect(port.restore).toHaveBeenCalled();
    // The tone and the recording never happened.
    expect(env.order).not.toContain("record");
  });

  it("waits for a slow player to confirm the pause", async () => {
    const port = makePort({ lecture: "playing" }, { stubborn: true });
    let polls = 0;
    port.getSnapshot.mockImplementation(() => {
      polls += 1;
      // The first snapshot is the "before" picture; the player reports paused on the third check after pause().
      return polls >= 4 ? { lecture: "paused", explanation: "none", pauseOwner: "user" } : { lecture: "playing", explanation: "none", pauseOwner: null };
    });
    const env = setup({ port });
    await env.controller.toggle();
    expect(env.controller.status).toBe(TURN.LISTENING);
  });

  it("pauses again when the player starts playing just after the pause (back-to-back turns)", async () => {
    // Real browsers: a play asked for a moment ago can still land AFTER the pause. The player reports paused
    // once, then flips to playing; the turn must ask again rather than listen over it.
    const port = makePort({ lecture: "playing" });
    let calls = 0;
    const realPause = port.pause.getMockImplementation();
    port.pause.mockImplementation((...args) => {
      calls += 1;
      realPause(...args);
      if (calls === 1) {
        // the first pause "worked", then the earlier play lands
        setTimeout(() => { port.state.lecture = "playing"; }, 0);
      }
    });
    const env = setup({ port });
    env.deps.wait = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 10)));
    const starting = env.controller.toggle();
    await vi.advanceTimersByTimeAsync(2000);
    await starting;
    expect(env.controller.status).toBe(TURN.LISTENING);
    expect(port.pause.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(port.getSnapshot().lecture).toBe("paused");
  });

  it("does not trust a single quiet reading: quiet must hold for several checks", async () => {
    const port = makePort({ lecture: "paused" });
    const readings = [
      "paused", // taking the snapshot
      "paused", "playing", // one quiet check, then it is playing again: not stable
      "paused", "paused", "paused", // three quiet checks in a row: stable
    ];
    let i = 0;
    port.getSnapshot.mockImplementation(() => ({ lecture: readings[Math.min(i++, readings.length - 1)], explanation: "none", pauseOwner: "user" }));
    const env = setup({ port });
    await env.controller.toggle();
    expect(env.controller.status).toBe(TURN.LISTENING);
    expect(i).toBeGreaterThanOrEqual(readings.length);
    expect(port.pause.mock.calls.length).toBeGreaterThanOrEqual(2); // the initial pause plus one when it flipped to playing
  });

  it("explains a blocked microphone only after everything is closed, and restores the audio", async () => {
    const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    const port = makePort({ lecture: "playing" });
    const env = setup({ port, capture: makeCapture({ openError: denied }) });
    await env.controller.toggle();
    expect(env.controller.status).toBe(TURN.IDLE);
    expect(env.announce).toHaveBeenCalledWith(expect.stringContaining("Microphone access was blocked"));
    expect(env.capture.cancel).toHaveBeenCalled();
    expect(env.order.indexOf("restore")).toBeLessThan(env.order.findIndex((entry) => entry.startsWith("say:")));
    expect(env.registry.isTurnActive()).toBe(false);
  });

  it("closes the microphone before telling the learner it heard nothing", async () => {
    const env = setup({ port: makePort({ lecture: "playing" }), capture: makeCapture({ result: { heardSpeech: false } }) });
    env.deps.toWav16k.mockResolvedValueOnce({ blob: new Blob(["wav"]), samples: new Float32Array(800), sampleRate: 16000, durationMs: 100 });
    await startListening(env);
    await env.controller.toggle();
    expect(env.announce).toHaveBeenCalledWith(expect.stringContaining("I didn't hear anything."));
    expect(env.order.indexOf("stop")).toBeLessThan(env.order.findIndex((entry) => entry.startsWith("say:")));
    expect(env.onUtterance).not.toHaveBeenCalled();
    expect(env.port.restore).toHaveBeenCalled();
  });

  it("still sends a clip our own meter called silent when the clip itself has a signal (quiet microphones)", async () => {
    const env = setup({ port: makePort(), capture: makeCapture({ result: { heardSpeech: false } }) });
    await startListening(env);
    await env.controller.toggle();
    expect(env.onUtterance).toHaveBeenCalledTimes(1);
  });

  it("ignores a clip that is too short", async () => {
    const env = setup({ port: makePort(), capture: makeCapture({ result: { durationMs: LIMITS.MIN_UTTERANCE_MS - 1 } }) });
    await startListening(env);
    await env.controller.toggle();
    expect(env.announce).toHaveBeenCalledWith("I didn't catch that.");
    expect(env.onUtterance).not.toHaveBeenCalled();
  });

  it("reports a microphone that stopped working", async () => {
    const env = setup({ port: makePort({ lecture: "playing" }) });
    await startListening(env);
    await env.capture.opts.onAutoStop("device_lost");
    expect(env.announce).toHaveBeenCalledWith("The microphone stopped working.");
    expect(env.controller.status).toBe(TURN.IDLE);
    expect(env.onUtterance).not.toHaveBeenCalled();
  });

  it("recovers when the clip cannot be converted", async () => {
    const env = setup({ port: makePort({ lecture: "playing" }) });
    env.deps.toWav16k.mockRejectedValueOnce(new Error("cannot decode"));
    await startListening(env);
    await env.controller.toggle();
    expect(env.announce).toHaveBeenCalledWith("Something went wrong with voice control.");
    expect(env.controller.status).toBe(TURN.IDLE);
    expect(env.registry.isTurnActive()).toBe(false);
    expect(env.port.restore).toHaveBeenCalled();
  });

  it("recovers when the handler of the words fails", async () => {
    const env = setup({ port: makePort(), onUtterance: vi.fn(async () => { throw new Error("backend down"); }) });
    await startListening(env);
    await env.controller.toggle();
    expect(env.announce).toHaveBeenCalledWith("Something went wrong with voice control.");
    expect(env.controller.status).toBe(TURN.IDLE);
  });
});

describe("settling between turns (races found in a real browser)", () => {
  it("does not resume the lecture when the player had not yet caught up with an automatic pause", async () => {
    // The app paused the lecture for an explanation a moment ago; the player still reports "playing".
    const port = makePort({ lecture: "playing", explanation: "playing", pauseOwner: "intervention" });
    const env = setup({ port });
    await startListening(env);
    await env.controller.toggle();
    expect(port.restore).toHaveBeenCalledWith({ lecture: false, explanation: true, restoreOwner: true, pauseOwner: "intervention" });
  });

  it("keeps asking while the player buffers, because YouTube ignores a pause then", async () => {
    // Real browser: after a resume the player buffered for ~2.2 s (state 3), longer than the normal 1.5 s check,
    // ignoring every pause, then reached "playing".
    const state = { lecture: "buffering", explanation: "none", pauseOwner: null };
    let polls = 0;
    const port = {
      getSnapshot: vi.fn(() => {
        polls += 1;
        if (polls === 60) state.lecture = "playing"; // ~3 s of 50 ms checks later
        return { ...state };
      }),
      pause: vi.fn(() => {
        state.pauseOwner = "user";
        if (state.lecture === "playing") state.lecture = "paused"; // honoured only once it is playing
      }),
      restore: vi.fn(),
      isNoteBusy: vi.fn(() => false),
    };
    const env = setup({ port });
    await env.controller.toggle();
    expect(polls).toBeGreaterThan(60); // it kept going well past the normal 30 checks
    expect(env.controller.status).toBe(TURN.LISTENING);
    expect(state.lecture).toBe("paused");
  });

  it("gives up after the cap if the player never stops buffering", async () => {
    const port = {
      getSnapshot: vi.fn(() => ({ lecture: "buffering", explanation: "none", pauseOwner: "user" })),
      pause: vi.fn(),
      restore: vi.fn(),
      isNoteBusy: vi.fn(() => false),
    };
    const env = setup({ port });
    await env.controller.toggle();
    expect(env.controller.status).toBe(TURN.IDLE);
    expect(env.announce).toHaveBeenCalledWith(expect.stringContaining("could not pause"));
    expect(port.getSnapshot.mock.calls.length).toBeLessThanOrEqual(LIMITS.QUIET_MAX_MS / LIMITS.QUIET_POLL_MS + 3);
  });

  it("makes the next turn wait until the previous resume has really taken effect", async () => {
    const port = makePort({ lecture: "playing" });
    // A resume is a request: the player only starts playing 300 ms later.
    port.restore.mockImplementation(() => {
      setTimeout(() => {
        port.state.lecture = "playing";
        port.state.pauseOwner = null;
      }, 300);
    });
    const env = setup({ port });
    env.deps.wait = vi.fn((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

    // First turn, stopped normally.
    const first = env.controller.toggle();
    await vi.advanceTimersByTimeAsync(1500);
    await first;
    const stopping = env.controller.toggle();
    await vi.advanceTimersByTimeAsync(100);
    await stopping;
    expect(env.controller.status).toBe(TURN.IDLE);
    expect(port.state.lecture).toBe("paused"); // the resume has not landed yet
    const pausesBefore = port.pause.mock.calls.length;

    // Second turn is requested at once. It must not pause (or snapshot) until the player is really playing.
    const second = env.controller.toggle();
    await vi.advanceTimersByTimeAsync(100);
    expect(env.controller.status).toBe(TURN.PREPARING);
    expect(port.pause.mock.calls.length).toBe(pausesBefore);

    await vi.advanceTimersByTimeAsync(2000);
    await second;
    expect(port.pause.mock.calls.length).toBeGreaterThan(pausesBefore);
    expect(env.controller.status).toBe(TURN.LISTENING);
    expect(port.state.lecture).toBe("paused");
  });

  it("can be cancelled while waiting for the previous resume, with nothing to put back", async () => {
    const port = makePort({ lecture: "playing" });
    port.restore.mockImplementation(() => {}); // the player never reports playing
    const env = setup({ port });
    env.deps.wait = vi.fn((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

    const first = env.controller.toggle();
    await vi.advanceTimersByTimeAsync(1500);
    await first;
    const stopping = env.controller.toggle();
    await vi.advanceTimersByTimeAsync(100);
    await stopping;
    port.restore.mockClear();

    const second = env.controller.toggle();
    await vi.advanceTimersByTimeAsync(100);
    expect(env.controller.status).toBe(TURN.PREPARING);
    env.controller.toggle(); // cancel
    await vi.advanceTimersByTimeAsync(3000);
    await second;
    expect(env.controller.status).toBe(TURN.IDLE);
    expect(port.restore).not.toHaveBeenCalled();
    expect(env.registry.isTurnActive()).toBe(false);
  });
});

describe("cancelling", () => {
  it("cancels while getting ready: no recording, mic released, audio restored, user told", async () => {
    const port = makePort({ lecture: "playing" });
    const capture = makeCapture();
    let finishOpen;
    capture.open = vi.fn(() => new Promise((resolve) => { finishOpen = resolve; }));
    const env = setup({ port, capture });
    const starting = env.controller.toggle();
    await vi.advanceTimersByTimeAsync(0);
    expect(env.controller.status).toBe(TURN.PREPARING);

    env.controller.toggle(); // the shortcut again = cancel
    expect(env.controller.status).toBe(TURN.IDLE);
    expect(capture.cancel).toHaveBeenCalled();
    expect(port.restore).toHaveBeenCalled();
    expect(env.announce).toHaveBeenCalledWith("Voice control cancelled.");

    finishOpen();
    await starting;
    expect(capture.startRecording).not.toHaveBeenCalled(); // the stale turn never goes on
    expect(env.controller.status).toBe(TURN.IDLE);
  });

  it("drops the turn if the learner starts audio while it listens, and does not restore anything", async () => {
    const port = makePort({ lecture: "playing" });
    const env = setup({ port });
    await startListening(env);
    port.state.lecture = "playing"; // the learner pressed play
    await vi.advanceTimersByTimeAsync(LIMITS.GUARD_POLL_MS + 10);
    expect(env.controller.status).toBe(TURN.IDLE);
    expect(env.capture.cancel).toHaveBeenCalled();
    expect(port.restore).not.toHaveBeenCalled();
    expect(env.announce).toHaveBeenCalledWith("Voice control stopped because audio started playing.");
    expect(env.onUtterance).not.toHaveBeenCalled();
    expect(env.registry.isTurnActive()).toBe(false);
  });

  it("also drops the turn if the explanation audio starts", async () => {
    const port = makePort({ lecture: "paused", explanation: "paused" });
    const env = setup({ port });
    await startListening(env);
    port.state.explanation = "playing";
    await vi.advanceTimersByTimeAsync(LIMITS.GUARD_POLL_MS + 10);
    expect(env.controller.status).toBe(TURN.IDLE);
    expect(port.restore).not.toHaveBeenCalled();
  });

  it("ignores the shortcut while the words are being handled", async () => {
    let finishHandling;
    const env = setup({
      port: makePort(),
      onUtterance: vi.fn(() => new Promise((resolve) => { finishHandling = resolve; })),
    });
    await startListening(env);
    const stopping = env.controller.toggle();
    await vi.advanceTimersByTimeAsync(0);
    expect(env.controller.status).toBe(TURN.PROCESSING);
    env.controller.toggle();
    env.controller.cancel("cancelled");
    expect(env.controller.status).toBe(TURN.PROCESSING);
    finishHandling({});
    await stopping;
    expect(env.controller.status).toBe(TURN.IDLE);
  });

  it("closes the microphone and restores audio when the control goes away mid-turn", async () => {
    const port = makePort({ lecture: "playing" });
    const env = setup({ port });
    await startListening(env);
    env.controller.dispose();
    expect(env.capture.cancel).toHaveBeenCalled();
    expect(port.restore).toHaveBeenCalled();
    expect(env.registry.isTurnActive()).toBe(false);
    expect(env.controller.status).toBe(TURN.IDLE);
  });

  it("does nothing on dispose when idle", () => {
    const env = setup({ port: makePort() });
    env.controller.dispose();
    expect(env.statuses).toEqual([]);
  });
});

describe("ending by itself", () => {
  it("handles the clip when the capture stops after silence", async () => {
    const env = setup({ port: makePort({ lecture: "playing" }) });
    await startListening(env);
    await env.capture.opts.onAutoStop("silence");
    expect(env.onUtterance).toHaveBeenCalledTimes(1);
    expect(env.onUtterance.mock.calls[0][0].endedBy).toBe("silence");
    expect(env.controller.status).toBe(TURN.IDLE);
  });

  it("tells the learner when no one spoke", async () => {
    const env = setup({ port: makePort(), capture: makeCapture({ result: { heardSpeech: false } }) });
    env.deps.toWav16k.mockResolvedValueOnce({ blob: new Blob(["wav"]), samples: new Float32Array(800), sampleRate: 16000, durationMs: 100 });
    await startListening(env);
    await env.capture.opts.onAutoStop("no_speech");
    expect(env.announce).toHaveBeenCalledWith(expect.stringContaining("I didn't hear anything."));
  });

  it("ignores a late auto-stop from a turn that was already cancelled", async () => {
    const env = setup({ port: makePort() });
    await startListening(env);
    const { onAutoStop } = env.capture.opts;
    env.controller.cancel("cancelled");
    await onAutoStop("silence");
    expect(env.onUtterance).not.toHaveBeenCalled();
  });
});

describe("hold to talk (Space on the button)", () => {
  it("listens while held and handles the words on release", async () => {
    const env = setup({ port: makePort({ lecture: "playing" }) });
    await env.controller.holdStart();
    expect(env.controller.status).toBe(TURN.LISTENING);
    await env.controller.holdEnd();
    expect(env.onUtterance).toHaveBeenCalledTimes(1);
    expect(env.controller.status).toBe(TURN.IDLE);
  });

  it("cancels if released before it was ready", async () => {
    const capture = makeCapture();
    let finishOpen;
    capture.open = vi.fn(() => new Promise((resolve) => { finishOpen = resolve; }));
    const env = setup({ port: makePort({ lecture: "playing" }), capture });
    const starting = env.controller.holdStart();
    await vi.advanceTimersByTimeAsync(0);
    env.controller.holdEnd();
    expect(env.controller.status).toBe(TURN.IDLE);
    finishOpen();
    await starting;
    expect(capture.startRecording).not.toHaveBeenCalled();
  });

  it("does not stop a turn that was started with the toggle shortcut", async () => {
    const env = setup({ port: makePort() });
    await startListening(env);
    env.controller.holdEnd();
    expect(env.controller.status).toBe(TURN.LISTENING);
  });

  it("does not start a second turn while one is running", async () => {
    const env = setup({ port: makePort() });
    await startListening(env);
    await env.controller.holdStart();
    expect(env.deps.createCapture).toHaveBeenCalledTimes(1);
  });
});
