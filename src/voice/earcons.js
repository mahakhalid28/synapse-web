// Short sound cues ("earcons") that say what happened faster than words, so a learner who cannot see the
// screen knows the outcome before any sentence starts. Each has its own shape, so they are told apart by ear,
// and none uses the microphone tones (880 Hz start, 587 Hz stop):
//
//   done    two quick rising notes      a command worked
//   error   two falling, lower notes    a command failed, was not understood, or the server is unreachable
//   ready   three-note rising chime     an explanation is ready to listen to
//
// Cues are on by default; the stored preference synapse_voice_cues = "off" turns them off. Sound output
// problems never fail anything: a cue is only a hint.

export const CUES_KEY = "synapse_voice_cues";

const NOTE_MS = 90;
const GAP_MS = 25;

export const EARCONS = {
  done: [659, 988],
  error: [392, 262],
  ready: [523, 659, 784],
};

export function cuesEnabled() {
  try {
    return localStorage.getItem(CUES_KEY) !== "off";
  } catch {
    return true;
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Play notes (Hz) one after another. Resolves when finished, or at once without audio output. */
export async function playNotes(frequencies, { noteMs = NOTE_MS, gapMs = GAP_MS, volume = 0.18 } = {}) {
  const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return;
  let ctx;
  try {
    ctx = new AC();
    if (ctx.state === "suspended") await ctx.resume();
    let at = ctx.currentTime + 0.01;
    for (const frequency of frequencies) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(volume, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + noteMs / 1000);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + noteMs / 1000);
      at += (noteMs + gapMs) / 1000;
    }
    await wait(frequencies.length * (noteMs + gapMs) + 30);
  } catch {
    /* no cue is fine */
  } finally {
    try { await ctx?.close(); } catch { /* already closed */ }
  }
}

/** Play the cue for `kind` ("done", "error" or "ready") unless cues are turned off. */
export function playEarcon(kind, { play = playNotes, enabled = cuesEnabled } = {}) {
  const notes = EARCONS[kind];
  if (!notes || !enabled()) return Promise.resolve();
  return play(notes);
}
