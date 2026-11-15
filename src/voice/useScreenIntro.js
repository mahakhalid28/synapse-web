// Speak where the learner is when a screen opens: the screen, what is on it, and what to say next.
//
// A blind learner without a screen reader otherwise hears nothing after navigating. The first visit to a
// screen gets the full introduction and later visits a short one (remembered per browser profile). The
// introduction waits briefly so the screen can register its items (for counts) and is skipped while the
// microphone is busy; any new speech, including the next voice turn, interrupts it.

import { useEffect, useRef } from "react";
import { screenIntro } from "./voiceMessages.js";

export const INTRO_SEEN_KEY = "synapse_voice_intro_seen";
// Stored preference: "off" turns screen introductions off (anything else, or unset, leaves them on).
export const INTROS_KEY = "synapse_voice_intros";
export const INTRO_DELAY_MS = 600;

export function introsEnabled() {
  try {
    return localStorage.getItem(INTROS_KEY) !== "off";
  } catch {
    return true;
  }
}

function readSeen() {
  try {
    const parsed = JSON.parse(localStorage.getItem(INTRO_SEEN_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function markSeen(screen) {
  try {
    const seen = readSeen();
    if (seen.has(screen)) return;
    seen.add(screen);
    localStorage.setItem(INTRO_SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    /* storage unavailable: every visit gets the full introduction */
  }
}

/**
 * Introduce `screen` through `speaker` whenever it changes.
 *   describe()  -> { items?: [] } for counts (the voice action registry's context)
 *   canSpeak()  -> false while a voice turn is listening or working
 */
export function useScreenIntro({ screen, speaker, enabled = true, describe = () => ({}), canSpeak = () => true, delayMs = INTRO_DELAY_MS }) {
  const latest = useRef({ speaker, describe, canSpeak });
  useEffect(() => {
    latest.current = { speaker, describe, canSpeak };
  });

  useEffect(() => {
    if (!enabled || !screen) return undefined;
    const timer = setTimeout(() => {
      const { speaker: current, describe: describeNow, canSpeak: allowed } = latest.current;
      if (!allowed() || !introsEnabled()) return;
      const first = !readSeen().has(screen);
      const text = screenIntro(screen, { first, itemCount: describeNow()?.items?.length ?? 0 });
      if (!text) return;
      markSeen(screen);
      current.say(text);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [screen, enabled, delayMs]);
}
