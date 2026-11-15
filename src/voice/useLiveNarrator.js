// Speak what the screens announce, so a learner without a screen reader hears it too.
//
// Screens already put every important update (search results, quiz feedback, processing stages, timeline
// selections, voice-note results, errors) into ARIA live regions, which only a screen reader reads. This hook
// watches those regions and speaks new messages through a speaker, so no screen has to change:
//
//   role="alert" / aria-live="assertive"   spoken at once (interrupting other speech)
//   role="status" / aria-live="polite"     queued until nothing is speaking and the microphone is free
//
// It stays quiet in screen-reader feedback mode (the screen reader already reads these), never repeats what a
// speaker has just said, does not read the statuses a screen shows as it opens, and ignores regions marked
// data-voice-ignore (the voice control's own fallback region, which would otherwise echo itself).

import { useEffect, useRef } from "react";
import { anySpeakerBusy, feedbackMode, spokenRecently } from "./voiceSpeech.js";

export const LIVE_SELECTOR = '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]';
export const IGNORE_ATTR = "data-voice-ignore";
export const QUIET_AFTER_SCREEN_MS = 800; // a newly opened screen's initial statuses are not read
const POLL_MS = 250;
const MAX_WAIT_MS = 15000; // a polite message that could not be spoken by then is stale

const textOf = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();
const isUrgent = (el) => el.getAttribute("role") === "alert" || el.getAttribute("aria-live") === "assertive";
const ignored = (el) => Boolean(el.closest(`[${IGNORE_ATTR}], [aria-hidden="true"], [inert]`));

function regionAround(node) {
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  const region = el?.closest?.(LIVE_SELECTOR);
  return region && !ignored(region) ? region : null;
}

/**
 * Narrate live-region changes through `speaker` ({ say(text) }).
 *   canSpeak() -> false while the microphone, a voice note or explanation audio must not be talked over
 *   screen     -> changing it starts a short quiet period for the new screen's initial statuses
 * Returns a ref whose .current.lastAt is when the last screen message was captured (0 if none).
 */
export function useLiveNarrator({ speaker, enabled = true, canSpeak = () => true, screen = null, root = null, onUrgent = () => {} }) {
  const latest = useRef({ speaker, canSpeak, onUrgent });
  useEffect(() => {
    latest.current = { speaker, canSpeak, onUrgent };
  });
  const state = useRef({ lastAt: 0, quietUntil: 0 });

  useEffect(() => {
    state.current.quietUntil = Date.now() + QUIET_AFTER_SCREEN_MS;
  }, [screen]);

  useEffect(() => {
    if (!enabled || typeof MutationObserver === "undefined") return undefined;
    const target = root ?? document.body;
    const lastText = new WeakMap();
    const pending = []; // { text, at }

    const consider = (region, inserted) => {
      const text = textOf(region);
      if (lastText.get(region) === text) return;
      lastText.set(region, text);
      if (!text || feedbackMode() === "screenreader") return;
      const urgent = isUrgent(region);
      if (inserted && !urgent && Date.now() < state.current.quietUntil) return;
      if (spokenRecently(text)) return;
      state.current.lastAt = Date.now();
      if (urgent && latest.current.canSpeak()) {
        try { latest.current.onUrgent(text); } catch { /* a cue is only a hint */ }
        latest.current.speaker.say(text);
        return;
      }
      if (!pending.some((item) => item.text === text)) pending.push({ text, at: Date.now() });
    };

    // What is already on screen was there before the narrator started; only changes are spoken.
    target.querySelectorAll(LIVE_SELECTOR).forEach((region) => lastText.set(region, textOf(region)));

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "childList") {
          for (const node of record.addedNodes) {
            if (node.nodeType !== 1) continue;
            const added = [...(node.matches(LIVE_SELECTOR) ? [node] : []), ...node.querySelectorAll(LIVE_SELECTOR)];
            for (const region of added) if (!ignored(region)) consider(region, true);
          }
        }
        const region = regionAround(record.target);
        if (region) consider(region, false);
      }
    });
    observer.observe(target, { subtree: true, childList: true, characterData: true });

    const timer = setInterval(() => {
      const now = Date.now();
      while (pending.length && now - pending[0].at > MAX_WAIT_MS) pending.shift();
      if (!pending.length || anySpeakerBusy() || !latest.current.canSpeak()) return;
      const next = pending.shift();
      if (!spokenRecently(next.text)) latest.current.speaker.say(next.text);
    }, POLL_MS);

    return () => {
      observer.disconnect();
      clearInterval(timer);
    };
  }, [enabled, root]);

  return state;
}
