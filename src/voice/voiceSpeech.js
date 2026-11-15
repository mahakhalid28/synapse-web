// Spoken replies. Two ways to give feedback, behind one function so either can replace the other:
//   "tts"          the backend's existing text-to-speech (played here), falling back to the screen reader
//                  if speech is unavailable (offline, server down)
//   "screenreader" the page's polite live region only (for people who prefer their own screen reader)
// The choice is a stored preference; the default is "tts". Replies are only spoken after the microphone has
// closed, and the next voice turn stops them at once (barge-in).

import { speakText as defaultSpeakText } from "./voiceApi.js";
import { createStreamAudio, streamSpeech, supportsAudioStreaming } from '../lib/ttsStream.js';
import { ACCOUNT_CHANGED } from '../lib/accountSession.js';

export const FEEDBACK_KEY = "synapse_voice_feedback";
const MAX_CHUNK = 350; // the speech endpoint takes up to 400 characters
const MAX_SPOKEN = 1500; // never read out more than this at once

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

export function createSpeaker({ speakText = defaultSpeakText, announce, createAudio = (url) => new Audio(url), mode = feedbackMode }) {
  let token = 0;
  let current = null;
  let last = "";

  const stop = () => {
    token += 1;
    current?.cancel();
    current = null;
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
    stop();
    const mine = token;
    if (mode() === "screenreader") {
      announce(text);
      return;
    }
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
      if (mine === token) announce(text); // speech unavailable: the screen reader says it instead
    }
  };

  return { say, stop, last: () => last };
}
