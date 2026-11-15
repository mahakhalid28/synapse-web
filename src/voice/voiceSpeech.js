// Spoken replies. Two ways to give feedback, behind one function so either can replace the other:
//   "tts"          the backend's text-to-speech (played here). If that fails (server down, offline), the
//                  system's own voice speaks it (in Electron on Windows, the offline Windows voices), and
//                  only if that is unavailable too does it go to the screen reader's live region
//   "screenreader" the page's polite live region only (for people who prefer their own screen reader)
// The choice is a stored preference; the default is "tts". Replies are only spoken after the microphone has
// closed, and the next voice turn stops them at once (barge-in).

import { speakText as defaultSpeakText } from "./voiceApi.js";
import { createStreamAudio, streamSpeech, supportsAudioStreaming } from '../lib/ttsStream.js';
import { ACCOUNT_CHANGED } from '../lib/accountSession.js';

export const FEEDBACK_KEY = "synapse_voice_feedback";
const MAX_CHUNK = 350; // the speech endpoint takes up to 400 characters
const MAX_SPOKEN = 1500; // never read out more than this at once

// Shared across every speaker (the Talk control's, the lecture conversation's, screen introductions), so the
// live-region narrator can avoid talking over any of them and never repeats what one of them just said.
const speakingNow = new Set();
const recentlySaid = new Map(); // normalised text -> time it was said
const RECENT_MS = 8000;
const normalise = (text) => String(text).replace(/\s+/g, " ").trim().toLowerCase();

function remember(text) {
  const now = Date.now();
  for (const [said, at] of recentlySaid) if (now - at > RECENT_MS * 4) recentlySaid.delete(said);
  recentlySaid.set(normalise(text), now);
}

/** True while any speaker is preparing or playing speech. */
export function anySpeakerBusy() {
  return speakingNow.size > 0;
}

/** True when `text` (or a sentence containing it, or contained in it) was said in the last few seconds. */
export function spokenRecently(text, withinMs = RECENT_MS) {
  const wanted = normalise(text);
  if (!wanted) return false;
  const now = Date.now();
  for (const [said, at] of recentlySaid) {
    if (now - at > withinMs) continue;
    if (said === wanted) return true;
    if (wanted.length >= 12 && said.length >= 12 && (said.includes(wanted) || wanted.includes(said))) return true;
  }
  return false;
}

/**
 * The browser's built-in speech (Web Speech API), used when the backend voice fails.
 * Returns { done: Promise<boolean>, cancel() } or null when the system has no speech.
 */
export function systemSpeech(text) {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  const Utterance = typeof window !== "undefined" ? window.SpeechSynthesisUtterance : undefined;
  if (!synth || !Utterance) return null;
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  try {
    const utterance = new Utterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.95; // a touch slower than default, closer to the Piper reply pace
    utterance.onend = () => finish(true);
    utterance.onerror = () => finish(false);
    synth.cancel();
    synth.speak(utterance);
  } catch {
    return null;
  }
  return { done, cancel: () => { try { synth.cancel(); } catch { /* ignore */ } finish(false); } };
}

/** Test helper: forget what was said and who is speaking. */
export function resetSpeechMemory() {
  speakingNow.clear();
  recentlySaid.clear();
}

export function feedbackMode() {
  try {
    return localStorage.getItem(FEEDBACK_KEY) === "screenreader" ? "screenreader" : "tts";
  } catch {
    return "tts";
  }
}

/** Split text into pieces of at most `max` characters, breaking at sentence ends where possible. */
export function chunkText(text, max = MAX_CHUNK) {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_SPOKEN);
  const sentences = clean.match(/[^.!?]+[.!?]*\s*/g) || [clean];
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    if ((current + sentence).length > max && current) {
      chunks.push(current.trim());
      current = "";
    }
    let rest = sentence;
    while (rest.length > max) {
      chunks.push(rest.slice(0, max).trim());
      rest = rest.slice(max);
    }
    current += rest;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function createSpeaker({ speakText = defaultSpeakText, announce, createAudio = (url) => new Audio(url), mode = feedbackMode, fallbackSpeech = systemSpeech }) {
  let token = 0;
  let current = null;
  let last = "";
  const self = {}; // identity in the shared "speaking now" set

  const stop = () => {
    token += 1;
    current?.cancel();
    current = null;
    speakingNow.delete(self);
  };

  const play = (url, signal) =>
    new Promise((resolve) => {
      const audio = createAudio(url);
      const finish = (success) => {
        signal?.removeEventListener('abort', cancel);
        resolve(success);
      };
      const cancel = () => { audio.pause?.(); finish(false); };
      current = { cancel };
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) { cancel(); return; }
      audio.onended = () => finish(true);
      audio.onerror = () => finish(false);
      Promise.resolve(audio.play()).catch(() => finish(false));
    });

  const playStream = (text) => new Promise((resolve, reject) => {
    const controller = new AbortController();
    let player = null;
    const accountChanged = () => { dispose(); resolve(false); };
    const dispose = () => {
      controller.abort(); player?.dispose();
      globalThis.removeEventListener?.(ACCOUNT_CHANGED, accountChanged);
    };
    globalThis.addEventListener?.(ACCOUNT_CHANGED, accountChanged);
    current = { cancel: () => { dispose(); resolve(false); } };
    streamSpeech('/voice/speak/stream', { text }, {
      signal: controller.signal,
      onEvent: async (event) => {
        if (controller.signal.aborted) return;
        if (event.type === 'start') {
          player = await createStreamAudio();
          if (controller.signal.aborted) { player.dispose(); return; }
          player.onended = () => { dispose(); resolve(true); };
          await player.play();
        } else if (event.type === 'audio') await player.push(event.samples);
        else if (event.type === 'complete') {
          if (player) player.finish();
          else if (event.cached) {
            const url = await speakText(text, { signal: controller.signal });
            if (controller.signal.aborted) { URL.revokeObjectURL?.(url); return; }
            const finished = await play(url, controller.signal);
            URL.revokeObjectURL?.(url);
            dispose();
            resolve(finished);
          }
        }
      },
    }).catch((error) => { dispose(); reject(error); });
  });

  /** Speak `text`. Resolves when it has been spoken (or handed to the screen reader, or stopped). */
  const say = async (text) => {
    if (!text) return;
    last = text;
    remember(text);
    stop();
    const mine = token;
    if (mode() === "screenreader") {
      announce(text);
      return;
    }
    speakingNow.add(self);
    try {
      for (const piece of chunkText(text)) {
        if (speakText === defaultSpeakText && supportsAudioStreaming()) {
          const finished = await playStream(piece);
          if (mine !== token) return;
          if (!finished) throw new Error('playback failed');
          continue;
        }
        const url = await speakText(piece);
        if (mine !== token) {
          try { URL.revokeObjectURL?.(url); } catch { /* ignore */ }
          return; // stopped while it was being prepared
        }
        const finished = await play(url);
        try { URL.revokeObjectURL?.(url); } catch { /* ignore */ }
        if (mine !== token) return;
        if (!finished) throw new Error("playback failed");
      }
    } catch {
      if (mine !== token) return;
      // The backend voice is unavailable: the system's own voice says it; failing that, the screen reader.
      const spoken = fallbackSpeech?.(text.replace(/\s+/g, " ").trim().slice(0, MAX_SPOKEN));
      if (spoken) {
        current = { cancel: spoken.cancel };
        if (await spoken.done) return;
        if (mine !== token) return;
      }
      announce(text);
    } finally {
      if (mine === token) speakingNow.delete(self);
    }
  };

  return { say, stop, last: () => last, isSpeaking: () => speakingNow.has(self) };
}
