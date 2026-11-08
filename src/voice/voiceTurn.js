// The rules of one voice turn, as plain functions with no React and no browser APIs.
//
// A turn is: the learner asks to talk -> everything Synapse is playing is paused -> the microphone listens ->
// the words are handled -> whatever was playing is restored if (and only if) that is the right thing to do.
// Keeping these rules pure is what lets them be tested exhaustively.

export const TURN = Object.freeze({
  IDLE: "idle",
  PREPARING: "preparing", // pausing audio, checking it is quiet, opening the microphone
  LISTENING: "listening",
  PROCESSING: "processing", // microphone closed; the utterance is being converted and handled
});

export const LIMITS = Object.freeze({
  QUIET_CHECK_MS: 1500, // how long to wait for the player to confirm it paused
  QUIET_POLL_MS: 50,
  QUIET_MAX_MS: 8_000, // the longest the quiet check keeps going while the player is buffering (it ignores a pause then)
  QUIET_STABLE_POLLS: 3, // quiet must hold for this many checks in a row (a pause is a request, not an instant fact)
  RESTORE_CONFIRM_MS: 1500, // after resuming, how long the next turn waits for the player to confirm it is playing
  GUARD_POLL_MS: 150, // while listening: has something started playing?
  SETTLE_MS: 250, // microphone open but not recording: the room's noise level is measured now, before the tone
  MAX_UTTERANCE_MS: 12_000,
  NO_SPEECH_TIMEOUT_MS: 6_000,
  SILENCE_AFTER_SPEECH_MS: 1_400,
  MIN_UTTERANCE_MS: 400,
  SPEECH_RMS_MIN: 0.005, // quiet laptop microphones peak low; the server normalises the level
  NOISE_FLOOR_MULTIPLIER: 3,
});

const TRANSITIONS = {
  [TURN.IDLE]: { start: TURN.PREPARING },
  [TURN.PREPARING]: { ready: TURN.LISTENING, cancel: TURN.IDLE, fail: TURN.IDLE },
  [TURN.LISTENING]: { stop: TURN.PROCESSING, cancel: TURN.IDLE, fail: TURN.IDLE },
  [TURN.PROCESSING]: { done: TURN.IDLE },
};

/** The status after `event`; an event that makes no sense in this status changes nothing. */
export function nextStatus(status, event) {
  return TRANSITIONS[status]?.[event] ?? status;
}

/** What pressing the talk shortcut again means right now (null = ignore it). */
export function toggleEvent(status) {
  if (status === TURN.IDLE) return "start";
  if (status === TURN.PREPARING) return "cancel";
  if (status === TURN.LISTENING) return "stop";
  return null;
}

/** true when neither the lecture video nor the explanation audio is making sound. */
export function isQuiet(snapshot) {
  if (!snapshot) return true; // no lecture screen: nothing of Synapse's is playing
  const lecturePlaying = snapshot.lecture === "playing" || snapshot.lecture === "buffering";
  return !lecturePlaying && snapshot.explanation !== "playing";
}

const NO_RESTORE = Object.freeze({ lecture: false, explanation: false, restoreOwner: false, pauseOwner: null });

/**
 * What to put back when a turn ends.
 *
 * snapshot: what was true when the learner asked to talk
 *   { lecture: "playing"|"paused"|"ended"|"buffering"|"unknown",
 *     explanation: "playing"|"paused"|"none",
 *     pauseOwner: null|"user"|"intervention" }
 * outcome: what happened during the turn
 *   playbackCommand       the spoken command was itself a playback command (play, pause, replay, seek, ...)
 *   leftScreen            the lecture screen is gone or was replaced
 *   playbackStartedByUser the learner started audio while Synapse was listening
 *
 * Nothing is resumed after an explicit playback command, after leaving the screen, or after the learner
 * started audio themselves. Otherwise only what was playing before is resumed, and the lecture screen's
 * pause ownership is put back exactly as it was, so an explanation that was holding the lecture paused
 * ("intervention") still resumes it when it ends.
 */
export function decideRestore(snapshot, outcome = {}) {
  const { playbackCommand = null, leftScreen = false, playbackStartedByUser = false } = outcome;
  if (!snapshot || playbackCommand || leftScreen || playbackStartedByUser) return NO_RESTORE;
  // If someone has already asked the lecture to pause (the pause owner is set), it counts as paused even when
  // the player has not caught up and still reports "playing": it must not be resumed from under an explanation
  // that was holding it. Found in a real browser, pressing the shortcut just after an automatic pause.
  const lectureWasPlaying = (snapshot.lecture === "playing" || snapshot.lecture === "buffering") && !snapshot.pauseOwner;
  return {
    lecture: lectureWasPlaying,
    explanation: snapshot.explanation === "playing",
    restoreOwner: true,
    pauseOwner: snapshot.pauseOwner ?? null,
  };
}

/** Level thresholds for deciding whether anyone is speaking, adapting to the room's noise floor. */
export function speechThreshold(noiseFloor) {
  const floor = Number.isFinite(noiseFloor) ? Math.max(0, noiseFloor) : 0;
  return Math.max(LIMITS.SPEECH_RMS_MIN, floor * LIMITS.NOISE_FLOOR_MULTIPLIER);
}
