// Runs one voice turn: pause what Synapse is playing, prove it is quiet, listen, hand the utterance on, and
// put things back only when that is the right thing to do. See voiceTurn.js for the rules and voiceAudio.js
// for how it reaches the lecture screen's audio.
//
// Order that matters:
//   1. everything Synapse plays is paused and CONFIRMED quiet before the microphone opens
//   2. a tone, then recording (the tone is never recorded)
//   3. the microphone is closed BEFORE anything is spoken or the audio is restored
//   4. nothing is announced while the microphone is open (it would hear the screen reader)
//
// The logic lives in a class with no React in it so it can be tested directly; useVoiceTurn() is a thin hook.

import { useEffect, useState } from "react";
import { useVoiceAudio } from "./voiceAudio.js";
import { LIMITS, TURN, decideRestore, isQuiet, toggleEvent } from "./voiceTurn.js";
import { createMicCapture } from "./micCapture.js";
import { toWav16k } from "./wav.js";
import { describeMicError, isSilent, measureSamples, playTone } from "../hooks/useVoiceRecorder.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const START_TONE_HZ = 880;
const STOP_TONE_HZ = 587; // lower than the start tone, so the two are told apart by ear

const MESSAGES = {
  noteBusy: "A voice note is being recorded. Stop it before using voice control.",
  notQuiet: "Voice control could not pause the lecture audio, so it did not start. Try again, or use headphones.",
  cancelled: "Voice control cancelled.",
  playbackStarted: "Voice control stopped because audio started playing.",
  tooShort: "I didn't catch that.",
  heardNothing: "I didn't hear anything.",
  deviceLost: "The microphone stopped working.",
  failed: "Something went wrong with voice control.",
};

export class VoiceTurnController {
  constructor(onStatus = () => {}) {
    this.onStatus = onStatus;
    this.status = TURN.IDLE;
    this.run = 0; // bumped whenever the current turn ends, so late async steps know they are stale
    this.turn = null; // { port, snapshot, hold, capture, guard }
    this.settled = Promise.resolve(); // resolves when the last restore has taken effect in the player
    this.opts = {};
    this.disposed = false;
  }

  /** Called after every render with the latest options. */
  configure(opts) {
    this.opts = opts;
    this.disposed = false;
  }

  get deps() {
    return {
      createCapture: (options) => createMicCapture(options),
      toWav16k,
      playTone,
      wait,
      ...(this.opts.deps || {}),
    };
  }

  say(message) {
    if (!this.disposed) this.opts.announce?.(message);
  }

  setStatus(next) {
    this.status = next;
    if (!this.disposed) this.onStatus(next);
  }

  // ── What the learner can do ─────────────────────────────────────────────

  /** The shortcut or a click: start, cancel while getting ready, or stop while listening. */
  toggle() {
    const event = toggleEvent(this.status);
    if (event === "start") return this.begin();
    if (event === "cancel") return this.cancel("cancelled");
    if (event === "stop") return this.endListening(this.run, "user");
    return undefined;
  }

  /** Hold-to-talk start (Space on the focused button). */
  holdStart() {
    if (this.status === TURN.IDLE) return this.begin({ hold: true });
    return undefined;
  }

  /** Hold-to-talk release. Ignored unless this turn was started by holding. */
  holdEnd() {
    if (!this.turn?.hold) return undefined;
    if (this.status === TURN.PREPARING) return this.cancel("cancelled");
    if (this.status === TURN.LISTENING) return this.endListening(this.run, "user");
    return undefined;
  }

  /** The control is going away: close the microphone and put things back. */
  dispose() {
    if (this.status !== TURN.IDLE) {
      this.run += 1;
      this.turn?.capture?.cancel();
      this.finish({});
    }
    this.disposed = true;
  }

  // ── The turn ────────────────────────────────────────────────────────────

  async begin({ hold = false } = {}) {
    const { registry } = this.opts;
    if (registry.getPort()?.stopNote?.()) return; // a note was recording: this press ended it
    if (registry.getPort()?.isNoteBusy()) {
      this.say(MESSAGES.noteBusy);
      return;
    }

    this.opts.onStart?.(); // stop any spoken reply at once: the learner is talking again
    const run = ++this.run;
    this.turn = { port: null, snapshot: null, hold, capture: null, guard: null };
    registry.setTurnActive(true);
    this.setStatus(TURN.PREPARING);

    // A previous turn's resume may still be landing in the player. Start only once it has, so this turn's
    // snapshot and pause are made against a settled player. (Cancelling during this wait is safe: nothing has
    // been paused yet, so there is nothing to put back.)
    await this.settled;
    if (run !== this.run) return;

    // 1. pause everything and confirm it is quiet before the microphone opens
    const port = registry.getPort();
    this.turn.port = port;
    this.turn.snapshot = port ? port.getSnapshot() : null;
    port?.pause();
    const quiet = await this.waitUntilQuiet(port);
    if (run !== this.run) return;
    if (!quiet) return this.abort(run, MESSAGES.notQuiet);

    // 2. open the microphone (still not recording)
    const capture = this.deps.createCapture({ onAutoStop: (reason) => this.endListening(run, reason) });
    this.turn.capture = capture;
    try {
      await capture.open();
    } catch (err) {
      if (run !== this.run) return;
      return this.abort(run, describeMicError(err).message);
    }
    if (run !== this.run) return;

    // 3. let the room settle, play the tone, and only then record
    await this.deps.wait(LIMITS.SETTLE_MS);
    if (run !== this.run) return;
    await this.deps.playTone(START_TONE_HZ);
    if (run !== this.run) return;
    capture.startRecording();
    this.setStatus(TURN.LISTENING);
    this.turn.guard = setInterval(() => this.guard(run), LIMITS.GUARD_POLL_MS);
  }

  // A pause is a request, not an instant fact. The player can still be starting a play it was asked for a
  // moment ago (for example the previous voice turn resuming the lecture), and an explanation can begin just as
  // the lecture is paused. So "quiet" must hold for several checks in a row, and the pause is asked again
  // whenever something is still sounding. Found in a real browser: back-to-back turns left the video playing.
  //
  // YouTube also IGNORES a pause while it is buffering, and resuming after a pause can buffer for seconds on a
  // slow connection (2.2 s in testing). So while the player is buffering the check keeps going (up to
  // QUIET_MAX_MS) and keeps asking, and the pause takes as soon as the player reaches "playing".
  async waitUntilQuiet(port) {
    if (!port) return true;
    const normal = Math.ceil(LIMITS.QUIET_CHECK_MS / LIMITS.QUIET_POLL_MS);
    const longest = Math.ceil(LIMITS.QUIET_MAX_MS / LIMITS.QUIET_POLL_MS);
    let allowed = normal;
    let stable = 0;
    for (let i = 0; i < allowed; i++) {
      const snapshot = port.getSnapshot();
      if (snapshot?.lecture === "buffering") allowed = Math.max(allowed, Math.min(longest, i + normal));
      if (isQuiet(snapshot)) {
        stable += 1;
        if (stable >= LIMITS.QUIET_STABLE_POLLS) return true;
      } else {
        stable = 0;
        port.pause();
      }
      await this.deps.wait(LIMITS.QUIET_POLL_MS);
    }
    return false;
  }

  // While listening: if Synapse's audio starts again (the learner pressed play), the recording would contain
  // it, so the turn is dropped.
  guard(run) {
    if (run !== this.run || this.status !== TURN.LISTENING) return;
    const { port } = this.turn;
    if (port && this.opts.registry.getPort() === port && !isQuiet(port.getSnapshot())) {
      this.cancel("playback_started");
    }
  }

  async endListening(run, reason) {
    if (run !== this.run || this.status !== TURN.LISTENING) return;
    clearInterval(this.turn.guard);
    this.setStatus(TURN.PROCESSING);
    const { capture } = this.turn;
    const d = this.deps;

    let result;
    try {
      result = await capture.stop(reason);
    } catch {
      result = null;
    }
    // The microphone is closed now. A lower tone tells the learner it stopped listening.
    try { await d.playTone(STOP_TONE_HZ); } catch { /* the tone is only a cue */ }
    if (run !== this.run) return;

    if (result?.reason === "device_lost") return this.end(MESSAGES.deviceLost);
    if (!result || result.durationMs < LIMITS.MIN_UTTERANCE_MS) return this.end(MESSAGES.tooShort);
    // Our own level meter can miss quiet speech, so "no speech heard" is only trusted once the clip itself
    // proves to be flat (below). Otherwise the recogniser, which is far better at this, decides.
    try {
      const wav = await d.toWav16k(result.blob);
      const { peak, rms } = measureSamples(wav.samples);
      const utterance = {
        wav: wav.blob,
        sampleRate: wav.sampleRate,
        durationMs: wav.durationMs,
        peak,
        rms,
        silent: isSilent({ peak, rms }) === true,
        endedBy: result.reason,
        before: this.turn?.snapshot ?? null, // what was playing before the turn paused it
      };
      if (run !== this.run) return;
      console.info("[voice] clip", { ms: Math.round(wav.durationMs), peak: +peak.toFixed(4), rms: +rms.toFixed(5), heardSpeech: result.heardSpeech, endedBy: result.reason });
      // Only a truly flat clip is refused here; the 0.01 "silent" threshold would reject quiet microphones.
      if (result.heardSpeech === false && peak < 0.0015) {
        if (result.muted) {
          return this.end(`${MESSAGES.heardNothing} Windows is muting "${result.device || "the microphone"}". Turn off the mute switch or key, and allow microphone access for desktop apps in Windows privacy settings.`);
        }
        return this.end(`${MESSAGES.heardNothing} The browser recorded silence from "${result.device || "the default microphone"}". Check that it is the right microphone and is not muted.`);
      }
      const outcome = (await this.opts.onUtterance?.(utterance)) || {};
      if (run !== this.run) return;
      this.finish(outcome);
    } catch {
      if (run === this.run) this.end(MESSAGES.failed);
    }
  }

  /** The learner cancelled, or something made the recording unusable. The microphone is closed first. */
  cancel(reason = "cancelled") {
    if (this.status === TURN.IDLE || this.status === TURN.PROCESSING) return;
    this.run += 1;
    this.turn?.capture?.cancel();
    this.finish({ playbackStartedByUser: reason === "playback_started" });
    this.say(reason === "playback_started" ? MESSAGES.playbackStarted : MESSAGES.cancelled);
  }

  abort(run, message) {
    if (run !== this.run) return;
    this.run += 1;
    this.turn?.capture?.cancel();
    this.finish({});
    this.say(message);
  }

  end(message) {
    this.finish({});
    this.say(message);
  }

  /** Put things back (or not), release the turn, and go idle. */
  finish(outcome = {}) {
    const turn = this.turn;
    if (!turn) return;
    clearInterval(turn.guard);
    const { registry } = this.opts;
    const current = registry.getPort();
    const leftScreen = turn.port !== null && current !== turn.port;
    const plan = decideRestore(turn.snapshot, { ...outcome, leftScreen: leftScreen || Boolean(outcome.leftScreen) });
    if (turn.port && plan.restoreOwner) {
      turn.port.restore(plan);
      // Resuming is a request too: the next turn waits until the player confirms it (see begin()).
      if (plan.lecture || plan.explanation) this.settled = this.confirmRestored(turn.port, plan);
    }
    registry.setTurnActive(false);
    this.turn = null;
    this.setStatus(TURN.IDLE);
  }

  /** Resolves once what was resumed is really playing, or after a short time at most. Never rejects. */
  async confirmRestored(port, plan) {
    try {
      const attempts = Math.ceil(LIMITS.RESTORE_CONFIRM_MS / LIMITS.QUIET_POLL_MS);
      for (let i = 0; i < attempts; i++) {
        const snap = port.getSnapshot();
        const lectureOk = !plan.lecture || snap.lecture === "playing" || snap.lecture === "buffering";
        const explanationOk = !plan.explanation || snap.explanation === "playing";
        if (lectureOk && explanationOk) return;
        await this.deps.wait(LIMITS.QUIET_POLL_MS);
      }
    } catch {
      /* the confirmation is only a courtesy to the next turn */
    }
  }
}

export function useVoiceTurn({ onUtterance, announce, deps, onStart } = {}) {
  const registry = useVoiceAudio();
  const [status, setStatus] = useState(TURN.IDLE);
  const [ctl] = useState(() => new VoiceTurnController((next) => setStatus(next)));

  useEffect(() => {
    ctl.configure({ registry, onUtterance, announce, deps, onStart });
  });
  useEffect(() => () => ctl.dispose(), [ctl]);

  return {
    status,
    toggle: () => ctl.toggle(),
    holdStart: () => ctl.holdStart(),
    holdEnd: () => ctl.holdEnd(),
    cancel: () => ctl.cancel("cancelled"),
  };
}
