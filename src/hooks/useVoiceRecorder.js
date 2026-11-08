// Records a voice note about the current lecture moment and saves it locally.
//
// Order of events when the learner starts a note:
//   1. the lecture time is read FIRST (before anything is paused)
//   2. the lecture video and Synapse's TTS are paused, and the pause is announced
//   3. the microphone is opened while screen-reader speech settles
//   4. a short tone plays, THEN recording starts (so the tone is not recorded)
// Stopping never resumes anything: the lecture stays paused until the learner
// resumes it. Only an explicit stop (or reaching the length limit) saves the
// note by itself. Every other way a recording ends (leaving the screen, the
// microphone disappearing) HOLDS the audio as a draft for the learner to
// save or discard; nothing is saved silently.
//
// Audio never leaves the device: it goes to notesStore (IndexedDB) only.
//
// The hook has no UI. Browser APIs are reached through `deps` so tests can
// replace them; the defaults use the real ones.

import { useCallback, useEffect, useRef, useState } from "react";
import { saveNote as defaultSaveNote, newNoteId as defaultNewNoteId } from "../lib/notesStore.js";

export const RECORD_LIMIT_MS = 5 * 60 * 1000; // product limit for one note
export const LIMIT_WARNING_BEFORE_MS = 30 * 1000;
export const SETTLE_MS = 1500; // lets screen-reader speech finish before the tone
export const TONE_MS = 180;
export const MIN_RECORDING_MS = 500; // anything shorter is treated as an accidental press
export const SIGNAL_PEAK_MIN = 0.01; // same thresholds the microphone spike used
export const SIGNAL_RMS_MIN = 0.002;

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

/* ── Pure helpers (exported for tests) ───────────────────────────────────── */

/** 201.4 -> "3:21", 3725 -> "1:02:05" */
export function formatClock(seconds) {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** 4980 -> "5 seconds", 65000 -> "1 minute 5 seconds" (spoken, so words not digits-with-colons) */
export function formatDuration(ms) {
  const total = Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (m === 0) return plural(s, "second");
  return s === 0 ? plural(m, "minute") : `${plural(m, "minute")} ${plural(s, "second")}`;
}

/** Peak and RMS of a block of samples in -1..1. */
export function measureSamples(samples) {
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
    sum += samples[i] * samples[i];
  }
  return { peak, rms: samples.length ? Math.sqrt(sum / samples.length) : 0 };
}

/** true = the recording is silent or nearly so; false = it has signal; null = could not tell. */
export function isSilent(signal) {
  if (!signal || !Number.isFinite(signal.peak) || !Number.isFinite(signal.rms)) return null;
  return !(signal.peak >= SIGNAL_PEAK_MIN && signal.rms >= SIGNAL_RMS_MIN);
}

/** Plain-language message for each way microphone access or recording can fail. */
export function describeMicError(err) {
  const name = (err && err.name) || "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return {
        code: "blocked",
        message:
          "Microphone access was blocked. In Windows Settings, open Privacy and security, then Microphone, and turn on \"Let desktop apps access your microphone\". Then try again.",
      };
    case "NotFoundError":
    case "OverconstrainedError":
      return { code: "no_microphone", message: "No microphone was found. Connect or enable one, then try again." };
    case "NotReadableError":
    case "AbortError":
      return {
        code: "busy",
        message: "The microphone is being used by another app or is not responding. Close other apps that use it, then try again.",
      };
    case "unsupported":
      return { code: "unsupported", message: "This computer can't record audio in Synapse." };
    default:
      return { code: "failed", message: "Recording failed because of an unexpected problem. Please try again." };
  }
}

/* ── Real browser dependencies (replaced in tests) ───────────────────────── */

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A short beep. Resolves when it has finished (or immediately if audio output
// is unavailable: the tone is a cue, never a reason to fail).
async function playTone(frequency = 880) {
  const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return;
  let ctx;
  try {
    ctx = new AC();
    if (ctx.state === "suspended") await ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + TONE_MS / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + TONE_MS / 1000);
    await wait(TONE_MS + 40);
  } catch {
    /* no tone is fine */
  } finally {
    try { await ctx?.close(); } catch { /* already closed */ }
  }
}

// Watches the live microphone level and remembers the loudest peak and the
// loudest short-window RMS. Cheap: no decoding of the finished recording.
function createLevelMeter(stream) {
  const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  try {
    const ctx = new AC();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let peak = 0;
    let rms = 0;
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      const m = measureSamples(buf);
      if (m.peak > peak) peak = m.peak;
      if (m.rms > rms) rms = m.rms;
    }, 25);
    return {
      read: () => ({ peak, rms }),
      close: () => {
        clearInterval(timer);
        try { ctx.close(); } catch { /* already closed */ }
      },
    };
  } catch {
    return null;
  }
}

function defaultDeps() {
  return {
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    hasMediaDevices: () => !!(typeof navigator !== "undefined" && navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    MediaRecorderCtor: typeof MediaRecorder === "undefined" ? undefined : MediaRecorder,
    createLevelMeter,
    playTone,
    wait,
    now: () => performance.now(),
    clock: () => Date.now(),
  };
}

/* ── The hook ────────────────────────────────────────────────────────────── */

/**
 * @param {object} options
 * @param {string} options.videoId
 * @param {string|null} [options.jobId]
 * @param {string} [options.videoTitle]
 * @param {() => string|null} [options.getPointId]       moment the learner is on, if any
 * @param {() => number|undefined} options.getLectureSeconds  the YouTube player's current time
 * @param {() => void} options.pauseForRecording          pauses the lecture AND Synapse TTS, keeps the pause owned by the learner
 * @param {(msg: string) => void} [options.announce]      the screen's single live-region announcer
 * @param {(note: object) => void} [options.onSaved]
 * @param {{ saveNote: Function, newNoteId: Function }} [options.store]
 * @param {object} [options.deps]                          test seam, see defaultDeps()
 *
 * status: "idle" | "preparing" | "recording" | "saving" | "draft" | "save_failed"
 */
export function useVoiceRecorder(options) {
  const {
    videoId, jobId = null, videoTitle = "", getPointId = () => null, getLectureSeconds,
    pauseForRecording, announce = () => {}, onSaved, store, deps,
  } = options;

  const [status, setStatusState] = useState("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState(null);
  const [draft, setDraftState] = useState(null);

  // Always-current copies of what the (long-lived) async steps need. Written
  // after each render (not during it) so the long-lived callbacks never see stale props.
  const latest = useRef({ deps: defaultDeps() });
  useEffect(() => {
    latest.current = {
      videoId, jobId, videoTitle, getPointId, getLectureSeconds, pauseForRecording, announce, onSaved,
      store: store || { saveNote: defaultSaveNote, newNoteId: defaultNewNoteId },
      deps: { ...defaultDeps(), ...(deps || {}) },
    };
  });

  const mounted = useRef(true);
  const statusRef = useRef("idle");
  const draftRef = useRef(null);
  const m = useRef({
    run: 0, stream: null, recorder: null, meter: null, chunks: [], mime: "",
    startedAt: 0, stopAt: 0, lectureSeconds: 0, pointId: null, stopReason: null,
    tickTimer: null, warnTimer: null, limitTimer: null, resolveFinished: null,
  });

  const setStatus = useCallback((next) => {
    statusRef.current = next;
    if (mounted.current) setStatusState(next);
  }, []);
  const setDraft = useCallback((next) => {
    draftRef.current = next;
    if (mounted.current) setDraftState(next);
  }, []);
  const say = useCallback((msg) => { if (mounted.current) latest.current.announce(msg); }, []);

  // Stops every timer, the level meter, the recorder and EVERY microphone track.
  const releaseCapture = useCallback(() => {
    const s = m.current;
    clearInterval(s.tickTimer);
    clearTimeout(s.warnTimer);
    clearTimeout(s.limitTimer);
    s.tickTimer = s.warnTimer = s.limitTimer = null;
    try { s.meter?.close(); } catch { /* ignore */ }
    s.meter = null;
    if (s.recorder) {
      s.recorder.ondataavailable = null;
      s.recorder.onstop = null;
      s.recorder.onerror = null;
      try { if (s.recorder.state !== "inactive") s.recorder.stop(); } catch { /* already stopped */ }
      s.recorder = null;
    }
    if (s.stream) {
      s.stream.getTracks().forEach((t) => {
        t.onended = null;
        try { t.stop(); } catch { /* already stopped */ }
      });
      s.stream = null;
    }
  }, []);

  const fail = useCallback((err, extra = "") => {
    const described = describeMicError(err);
    releaseCapture();
    if (mounted.current) setError(described);
    setStatus("idle");
    say(`${described.message}${extra}`);
  }, [releaseCapture, setStatus, say]);

  const persistDraft = useCallback(async (held, label = "") => {
    const { store: st, videoId: vid, jobId: job, videoTitle: title, onSaved: done } = latest.current;
    setStatus("saving");
    if (mounted.current) setError(null);
    try {
      const note = await st.saveNote({
        id: held.id || (held.id = st.newNoteId()),
        videoId: vid, jobId: job, videoTitle: title, pointId: held.pointId,
        lectureSeconds: held.lectureSeconds, createdAt: held.createdAt, durationMs: held.durationMs,
        mimeType: held.mimeType, label, silentWarning: held.silentWarning === true,
      }, held.blob);
      setDraft(null);
      setStatus("idle");
      say(
        `Voice note saved at ${formatClock(note.lectureSeconds)}, ${formatDuration(note.durationMs)}. The lecture is still paused.` +
        (note.silentWarning ? " Warning: this recording may be silent. Check your microphone." : ""),
      );
      done?.(note);
      return note;
    } catch (err) {
      const message = (err && err.message) || "The voice note could not be saved.";
      if (mounted.current) setError({ code: (err && err.code) || "failed", message });
      setDraft(held); // keep the audio so the learner can retry or discard
      setStatus("save_failed");
      say(`${message} Choose Retry or Discard.`);
      return null;
    }
  }, [setStatus, setDraft, say]);

  // Runs when the recorder has delivered its last data.
  const finalise = useCallback(async (run) => {
    const s = m.current;
    if (s.run !== run) return;
    const reason = s.stopReason || "user";
    const { deps: d, getPointId: pointOf } = latest.current;
    const durationMs = Math.round((s.stopAt || d.now()) - s.startedAt);
    const signal = s.meter ? s.meter.read() : null;
    const type = (s.recorder && s.recorder.mimeType) || s.mime;
    const blob = new Blob(s.chunks, { type });
    releaseCapture();
    s.chunks = [];

    if (blob.size === 0) {
      setStatus("idle");
      if (mounted.current) setError({ code: "empty", message: "Nothing was recorded. Please try again." });
      say("Nothing was recorded. Please try again. The lecture is still paused.");
      return;
    }
    if (durationMs < MIN_RECORDING_MS) {
      setStatus("idle");
      say("That recording was too short and was not saved. The lecture is still paused.");
      return;
    }
    const held = {
      blob, durationMs, mimeType: type, lectureSeconds: s.lectureSeconds, pointId: s.pointId ?? pointOf(),
      createdAt: d.clock(), silentWarning: isSilent(signal) === true,
    };
    if (reason === "user" || reason === "limit") {
      await persistDraft(held);
    } else {
      // The recording ended for a reason the learner did not choose: never save it silently.
      setDraft(held);
      setStatus("draft");
      say(
        reason === "device_lost"
          ? "The microphone stopped working. Choose Save or Discard for what was recorded."
          : "Recording stopped. Choose Save or Discard.",
      );
    }
  }, [releaseCapture, persistDraft, setDraft, setStatus, say]);

  // reason: "user" and "limit" save the note; "leave" and "device_lost" hold it as a draft.
  const stop = useCallback((reason = "user") => {
    const s = m.current;
    const { deps: d } = latest.current;
    if (statusRef.current === "preparing") {
      s.run++; // invalidate the pending start()
      releaseCapture();
      setStatus("idle");
      say("Recording cancelled. The lecture is still paused.");
      return Promise.resolve();
    }
    if (statusRef.current !== "recording" || !s.recorder) return Promise.resolve();
    s.stopReason = reason;
    s.stopAt = d.now();
    clearTimeout(s.warnTimer);
    clearTimeout(s.limitTimer);
    clearInterval(s.tickTimer);
    const finished = new Promise((resolve) => { s.resolveFinished = resolve; });
    try {
      s.recorder.stop();
    } catch (err) {
      s.resolveFinished = null;
      fail(err);
      return Promise.resolve();
    }
    return finished;
  }, [releaseCapture, fail, setStatus, say]);

  const start = useCallback(async () => {
    if (statusRef.current !== "idle") return;
    const s = m.current;
    const { deps: d, getLectureSeconds: timeNow, pauseForRecording: pause, getPointId: pointOf } = latest.current;
    if (mounted.current) setError(null);

    const Rec = d.MediaRecorderCtor;
    const mime = Rec && typeof Rec.isTypeSupported === "function" ? MIME_CANDIDATES.find((t) => Rec.isTypeSupported(t)) : undefined;
    if (!d.hasMediaDevices() || !Rec || !mime) {
      fail({ name: "unsupported" });
      return;
    }

    // 1. The lecture time, BEFORE anything is paused. Never guess a time.
    const seconds = timeNow();
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
      const message = "The lecture player isn't ready yet, so a voice note can't be placed in the lecture. Try again in a moment.";
      if (mounted.current) setError({ code: "player_not_ready", message });
      say(message);
      return;
    }

    const run = ++s.run;
    s.lectureSeconds = seconds;
    s.pointId = pointOf();
    s.chunks = [];
    s.mime = mime;
    s.stopReason = null;
    s.stopAt = 0;
    setStatus("preparing");
    setElapsedMs(0);

    // 2. Pause the lecture and TTS, and say so.
    try { pause(); } catch { /* the announcement below still tells the truth about the recorder */ }
    say("Lecture paused. Recording starts after the tone.");

    // 3. Open the microphone while speech settles.
    // The stream is registered the moment it arrives (not after the settle wait),
    // so cancelling or leaving during the wait closes the microphone at once.
    let stream;
    try {
      const opening = d.getUserMedia({ audio: true }).then((opened) => {
        if (s.run === run && statusRef.current === "preparing") {
          s.stream = opened;
        } else {
          // Cancelled or unmounted before the microphone opened: release it.
          opened.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
        }
        return opened;
      });
      [stream] = await Promise.all([opening, d.wait(SETTLE_MS)]);
    } catch (err) {
      if (s.run === run && statusRef.current === "preparing") fail(err, " The lecture is still paused.");
      return;
    }
    if (s.run !== run || statusRef.current !== "preparing") return;

    // 4. Tone, then record.
    await d.playTone();
    if (s.run !== run || statusRef.current !== "preparing") return;

    try {
      const recorder = new Rec(stream, { mimeType: mime });
      s.recorder = recorder;
      s.meter = d.createLevelMeter(stream);
      recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) s.chunks.push(ev.data); };
      recorder.onerror = (ev) => { if (s.run === run) fail((ev && ev.error) || ev, " The lecture is still paused."); };
      recorder.onstop = () => {
        // stop()'s promise settles only once finalise() has completely finished.
        void finalise(run).finally(() => {
          const done = s.resolveFinished;
          s.resolveFinished = null;
          done?.();
        });
      };
      stream.getTracks().forEach((t) => {
        t.onended = () => { if (s.run === run && statusRef.current === "recording") stop("device_lost"); };
      });
      s.startedAt = d.now();
      recorder.start(250);
    } catch (err) {
      if (s.run === run) fail(err, " The lecture is still paused.");
      return;
    }

    setStatus("recording");
    s.tickTimer = setInterval(() => { if (mounted.current) setElapsedMs(Math.round(d.now() - s.startedAt)); }, 250);
    s.warnTimer = setTimeout(() => {
      if (s.run === run && statusRef.current === "recording") {
        say(`${Math.round(LIMIT_WARNING_BEFORE_MS / 1000)} seconds left in this recording.`);
      }
    }, RECORD_LIMIT_MS - LIMIT_WARNING_BEFORE_MS);
    s.limitTimer = setTimeout(() => {
      if (s.run === run && statusRef.current === "recording") {
        say(`Maximum length of ${RECORD_LIMIT_MS / 60000} minutes reached. Recording stopped.`);
        stop("limit");
      }
    }, RECORD_LIMIT_MS);
  }, [fail, finalise, say, setStatus, stop]);

  const toggle = useCallback(() => {
    const current = statusRef.current;
    if (current === "idle") return start();
    if (current === "preparing" || current === "recording") return stop("user");
    return Promise.resolve(); // saving / draft / save_failed: the learner must choose Save, Retry or Discard
  }, [start, stop]);

  /** Call before the screen goes away. Resolves to the held draft, or null if there is nothing to save. */
  const stopForLeaving = useCallback(async () => {
    if (statusRef.current === "preparing") { await stop(); return null; }
    if (statusRef.current === "recording") await stop("leave");
    return draftRef.current;
  }, [stop]);

  const saveDraft = useCallback((label = "") => {
    if ((statusRef.current !== "draft" && statusRef.current !== "save_failed") || !draftRef.current) return Promise.resolve(null);
    return persistDraft(draftRef.current, label);
  }, [persistDraft]);

  const discardDraft = useCallback(() => {
    if (!draftRef.current) return;
    setDraft(null);
    if (mounted.current) setError(null);
    setStatus("idle");
    say("Recording discarded.");
  }, [setDraft, setStatus, say]);

  /** The learner (or an auto-resume) started the lecture or TTS while recording: pause it again and say why. */
  const onLecturePlayed = useCallback(() => {
    if (statusRef.current !== "preparing" && statusRef.current !== "recording") return false;
    try { latest.current.pauseForRecording(); } catch { /* ignore */ }
    say("The lecture was paused again because it can't play while you record.");
    return true;
  }, [say]);

  // Leaving the screen or closing the window: free the microphone no matter what.
  // Audio still in memory is discarded here (never saved silently); callers that
  // want to offer Save/Discard must use stopForLeaving() BEFORE unmounting.
  useEffect(() => {
    mounted.current = true;
    const s = m.current;
    const onPageHide = () => { s.run++; releaseCapture(); };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onPageHide);
      mounted.current = false;
      s.run++;
      releaseCapture();
      s.chunks = [];
      s.resolveFinished?.();
      s.resolveFinished = null;
    };
  }, [releaseCapture]);

  return {
    status, elapsedMs, error, draft,
    isBusy: status !== "idle",
    isRecording: status === "recording",
    // Synchronous reads for event handlers that must not see a stale render.
    getStatus: () => statusRef.current,
    getDraft: () => draftRef.current,
    limitMs: RECORD_LIMIT_MS,
    start, stop, toggle, stopForLeaving, saveDraft, discardDraft, onLecturePlayed,
    clearError: () => setError(null),
  };
}

// Exposed so the real-browser implementations can be exercised outside React.
export { playTone, createLevelMeter, defaultDeps };
