import { describe, it, expect } from "vitest";
import { LIMITS, TURN, decideRestore, isQuiet, nextStatus, speechThreshold, toggleEvent } from "./voiceTurn";

const playingLecture = { lecture: "playing", explanation: "none", pauseOwner: null };
const playingExplanation = { lecture: "paused", explanation: "playing", pauseOwner: "intervention" };
const allQuiet = { lecture: "paused", explanation: "paused", pauseOwner: "user" };

describe("turn status transitions", () => {
  it("follows the normal path", () => {
    let status = TURN.IDLE;
    status = nextStatus(status, "start");
    expect(status).toBe(TURN.PREPARING);
    status = nextStatus(status, "ready");
    expect(status).toBe(TURN.LISTENING);
    status = nextStatus(status, "stop");
    expect(status).toBe(TURN.PROCESSING);
    status = nextStatus(status, "done");
    expect(status).toBe(TURN.IDLE);
  });

  it("can be cancelled or fail while preparing and listening", () => {
    expect(nextStatus(TURN.PREPARING, "cancel")).toBe(TURN.IDLE);
    expect(nextStatus(TURN.PREPARING, "fail")).toBe(TURN.IDLE);
    expect(nextStatus(TURN.LISTENING, "cancel")).toBe(TURN.IDLE);
    expect(nextStatus(TURN.LISTENING, "fail")).toBe(TURN.IDLE);
  });

  it("ignores events that make no sense in the current status", () => {
    expect(nextStatus(TURN.IDLE, "stop")).toBe(TURN.IDLE);
    expect(nextStatus(TURN.IDLE, "done")).toBe(TURN.IDLE);
    expect(nextStatus(TURN.LISTENING, "start")).toBe(TURN.LISTENING);
    expect(nextStatus(TURN.PROCESSING, "cancel")).toBe(TURN.PROCESSING);
    expect(nextStatus(TURN.PROCESSING, "start")).toBe(TURN.PROCESSING);
    expect(nextStatus("nonsense", "start")).toBe("nonsense");
  });
});

describe("what the shortcut means in each status", () => {
  it("starts when idle, cancels while preparing, stops while listening, and is ignored while working", () => {
    expect(toggleEvent(TURN.IDLE)).toBe("start");
    expect(toggleEvent(TURN.PREPARING)).toBe("cancel");
    expect(toggleEvent(TURN.LISTENING)).toBe("stop");
    expect(toggleEvent(TURN.PROCESSING)).toBeNull();
  });
});

describe("isQuiet", () => {
  it("is quiet when nothing of Synapse's is playing", () => {
    expect(isQuiet(allQuiet)).toBe(true);
    expect(isQuiet({ lecture: "ended", explanation: "none", pauseOwner: null })).toBe(true);
    expect(isQuiet({ lecture: "unknown", explanation: "none" })).toBe(true);
  });

  it("is not quiet while the lecture plays or buffers, or the explanation plays", () => {
    expect(isQuiet(playingLecture)).toBe(false);
    expect(isQuiet({ lecture: "buffering", explanation: "none" })).toBe(false);
    expect(isQuiet(playingExplanation)).toBe(false);
  });

  it("is quiet on screens with no audio port at all", () => {
    expect(isQuiet(null)).toBe(true);
    expect(isQuiet(undefined)).toBe(true);
  });
});

describe("decideRestore", () => {
  it("resumes the lecture that was playing", () => {
    expect(decideRestore(playingLecture)).toEqual({ lecture: true, explanation: false, restoreOwner: true, pauseOwner: null });
  });

  it("does not resume a lecture someone had already asked to pause, even if the player still said 'playing'", () => {
    // Real browsers: just after the app pauses the lecture for an explanation, the player has not caught up yet.
    for (const owner of ["intervention", "user"]) {
      const plan = decideRestore({ lecture: "playing", explanation: "playing", pauseOwner: owner });
      expect(plan).toEqual({ lecture: false, explanation: true, restoreOwner: true, pauseOwner: owner });
    }
  });

  it("resumes a buffering lecture as playing", () => {
    expect(decideRestore({ lecture: "buffering", explanation: "none", pauseOwner: null }).lecture).toBe(true);
  });

  it("resumes the explanation and keeps the lecture paused, restoring the 'intervention' owner", () => {
    // The explanation was holding the lecture paused; its end must still resume the lecture afterwards.
    expect(decideRestore(playingExplanation)).toEqual({
      lecture: false,
      explanation: true,
      restoreOwner: true,
      pauseOwner: "intervention",
    });
  });

  it("resumes nothing when nothing was playing, but still puts the pause owner back", () => {
    expect(decideRestore(allQuiet)).toEqual({ lecture: false, explanation: false, restoreOwner: true, pauseOwner: "user" });
    // An intervention pause with the explanation paused by the learner must stay an intervention pause.
    expect(decideRestore({ lecture: "paused", explanation: "paused", pauseOwner: "intervention" }).pauseOwner).toBe("intervention");
  });

  it("never resumes anything after an explicit playback command", () => {
    for (const playbackCommand of ["play", "pause", "replay", "seek", "next_moment"]) {
      expect(decideRestore(playingLecture, { playbackCommand })).toMatchObject({ lecture: false, explanation: false, restoreOwner: false });
    }
  });

  it("never resumes anything after the learner left the screen", () => {
    expect(decideRestore(playingLecture, { leftScreen: true })).toMatchObject({ lecture: false, explanation: false, restoreOwner: false });
  });

  it("never resumes anything when the learner started audio themselves", () => {
    expect(decideRestore(playingLecture, { playbackStartedByUser: true })).toMatchObject({
      lecture: false,
      explanation: false,
      restoreOwner: false,
    });
  });

  it("restores nothing without a snapshot (a screen with no audio)", () => {
    expect(decideRestore(null)).toMatchObject({ lecture: false, explanation: false, restoreOwner: false });
  });

  it("treats a missing pause owner as none", () => {
    expect(decideRestore({ lecture: "playing", explanation: "none" }).pauseOwner).toBeNull();
  });
});

describe("speechThreshold", () => {
  it("never goes below the minimum speech level", () => {
    expect(speechThreshold(0)).toBe(LIMITS.SPEECH_RMS_MIN);
    expect(speechThreshold(0.001)).toBe(LIMITS.SPEECH_RMS_MIN);
  });

  it("rises with a noisy room", () => {
    expect(speechThreshold(0.02)).toBeCloseTo(0.02 * LIMITS.NOISE_FLOOR_MULTIPLIER);
  });

  it("handles a missing or invalid noise floor", () => {
    expect(speechThreshold(Infinity)).toBe(LIMITS.SPEECH_RMS_MIN);
    expect(speechThreshold(NaN)).toBe(LIMITS.SPEECH_RMS_MIN);
    expect(speechThreshold(-1)).toBe(LIMITS.SPEECH_RMS_MIN);
  });
});
