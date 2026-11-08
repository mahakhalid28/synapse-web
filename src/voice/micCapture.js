// Records one short spoken utterance from the microphone and stops by itself.
//
// Two steps so the caller can play a start tone in between:
//   open()            asks for the microphone and measures the room's noise level (nothing is recorded yet)
//   startRecording()  begins recording and watching for the end of speech
// The recording ends when the caller calls stop(), or by itself: a stretch of silence after speech, no
// speech at all for a while, or the maximum length. A toggle shortcut can be forgotten, so the microphone
// must never stay open indefinitely.
//
// Browser APIs are reached through `deps` so tests can replace them.

import { LIMITS, speechThreshold } from "./voiceTurn.js";
import { measureSamples } from "../hooks/useVoiceRecorder.js";

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
const LEVEL_POLL_MS = 50;

/** Reports the microphone's loudness (RMS, 0..1) every 50 ms. Returns { close } or null without Web Audio. */
export function createLevelWatcher(stream, onLevel) {
  const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  try {
    const ctx = new AC();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buffer = new Float32Array(analyser.fftSize);
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buffer);
      onLevel(measureSamples(buffer).rms);
    }, LEVEL_POLL_MS);
    return {
      close: () => {
        clearInterval(timer);
        try { ctx.close(); } catch { /* already closed */ }
      },
    };
  } catch {
    return null;
  }
}

function pickMimeType(Ctor) {
  if (!Ctor || typeof Ctor.isTypeSupported !== "function") return "";
  return MIME_CANDIDATES.find((type) => Ctor.isTypeSupported(type)) ?? "";
}

function defaultDeps() {
  return {
    hasMediaDevices: () =>
      !!(typeof navigator !== "undefined" && navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    MediaRecorderCtor: typeof MediaRecorder === "undefined" ? undefined : MediaRecorder,
    createLevelWatcher,
    now: () => performance.now(),
  };
}

function namedError(name, message) {
  const err = new Error(message);
  err.name = name;
  return err;
}

/**
 * @param {object} [options]
 * @param {(reason: "silence"|"no_speech"|"limit"|"device_lost") => void} [options.onAutoStop]
 *   called once when the capture decides to end by itself; the caller then calls stop(reason)
 * @param {object} [options.deps] test seam
 */
export function createMicCapture({ onAutoStop = () => {}, deps } = {}) {
  const d = { ...defaultDeps(), ...(deps || {}) };

  let stream = null;
  let recorder = null;
  let watcher = null;
  let timer = null;
  let chunks = [];
  let mime = "";
  let cancelled = false;
  let recording = false;
  let autoStopped = false;
  let openedAt = 0;
  let startedAt = 0;
  let lastSpeechAt = 0;
  let heardSpeech = false;
  let level = 0;
  let noiseFloor = Infinity;

  const release = () => {
    clearInterval(timer);
    timer = null;
    try { watcher?.close(); } catch { /* ignore */ }
    watcher = null;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      try { if (recorder.state !== "inactive") recorder.stop(); } catch { /* already stopped */ }
      recorder = null;
    }
    if (stream) {
      stream.getTracks().forEach((track) => {
        track.onended = null;
        try { track.stop(); } catch { /* already stopped */ }
      });
      stream = null;
    }
  };

  const autoStop = (reason) => {
    if (autoStopped || !recording) return;
    autoStopped = true;
    onAutoStop(reason);
  };

  const onLevel = (rms) => {
    level = rms;
    // Before recording starts, the quietest level seen is the room's noise floor.
    if (!recording && d.now() - openedAt <= LIMITS.SETTLE_MS) noiseFloor = Math.min(noiseFloor, rms);
  };

  const tick = () => {
    if (!recording) return;
    const t = d.now();
    const elapsed = t - startedAt;
    if (watcher) {
      if (level >= speechThreshold(Number.isFinite(noiseFloor) ? noiseFloor : 0)) {
        heardSpeech = true;
        lastSpeechAt = t;
      }
      if (!heardSpeech && elapsed >= LIMITS.NO_SPEECH_TIMEOUT_MS) return autoStop("no_speech");
      if (heardSpeech && t - lastSpeechAt >= LIMITS.SILENCE_AFTER_SPEECH_MS) return autoStop("silence");
    }
    if (elapsed >= LIMITS.MAX_UTTERANCE_MS) autoStop("limit");
    return undefined;
  };

  return {
    isOpen: () => stream !== null,

    /** Ask for the microphone. Rejects with an error whose name describeMicError() understands. */
    async open() {
      if (!d.hasMediaDevices() || !d.MediaRecorderCtor) throw namedError("unsupported", "Recording is not supported.");
      cancelled = false;
      const opened = await d.getUserMedia({ audio: true });
      if (cancelled) {
        // cancel() ran while the permission prompt or device was still opening: release it at once.
        opened.getTracks().forEach((track) => { try { track.stop(); } catch { /* ignore */ } });
        throw namedError("Cancelled", "Cancelled before the microphone opened.");
      }
      stream = opened;
      openedAt = d.now();
      watcher = d.createLevelWatcher(opened, onLevel);
      opened.getTracks().forEach((track) => {
        track.onended = () => autoStop("device_lost");
      });
    },

    startRecording() {
      if (!stream || recording) return;
      mime = pickMimeType(d.MediaRecorderCtor);
      recorder = new d.MediaRecorderCtor(stream, mime ? { mimeType: mime } : undefined);
      chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };
      recording = true;
      startedAt = d.now();
      lastSpeechAt = startedAt;
      recorder.start(250);
      timer = setInterval(tick, LEVEL_POLL_MS);
    },

    /**
     * Stop and return what was recorded, or null if nothing was recording. Always releases the microphone.
     * heardSpeech is null when speech could not be measured (no Web Audio).
     */
    async stop(reason = "user") {
      if (!recording || !recorder) {
        release();
        return null;
      }
      recording = false;
      clearInterval(timer);
      const active = recorder;
      const durationMs = Math.round(d.now() - startedAt);
      await new Promise((resolve) => {
        active.onstop = resolve;
        try {
          active.stop();
        } catch {
          resolve();
        }
      });
      const type = active.mimeType || mime;
      const blob = new Blob(chunks, { type });
      const device = stream?.getAudioTracks?.()[0]?.label || "";
      const muted = stream?.getAudioTracks?.()[0]?.muted === true;
      const result = { blob, durationMs, reason, heardSpeech: watcher ? heardSpeech : null, device, muted };
      chunks = [];
      release();
      return result;
    },

    /** Discard everything and release the microphone. Safe at any time, including before open() resolves. */
    cancel() {
      cancelled = true;
      recording = false;
      chunks = [];
      release();
    },
  };
}
