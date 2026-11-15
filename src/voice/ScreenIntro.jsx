import { useEffect, useMemo } from "react";
import { useAnnouncer } from "../hooks/useAnnouncer.js";
import { createSpeaker } from "./voiceSpeech.js";
import { useScreenIntro } from "./useScreenIntro.js";
import { IGNORE_ATTR, useLiveNarrator } from "./useLiveNarrator.js";

// Spoken introduction for screens that have no Talk control (Welcome, sign in, create account, session
// check). Voice commands are not available there, so the introduction explains the keyboard steps instead.
// The screen's own announcements (for example "Incorrect username or password") are spoken too. Escape
// stops speech. The text is also mirrored to a polite live region for screen-reader users and as the
// fallback when speech is unavailable.

export default function ScreenIntro({ screen, speakerDeps, delayMs }) {
  const { message, announce } = useAnnouncer();
  const speaker = useMemo(() => createSpeaker({ announce, ...speakerDeps }), [announce, speakerDeps]);
  useScreenIntro({ screen, speaker, ...(delayMs === undefined ? {} : { delayMs }) });
  useLiveNarrator({ speaker, screen });

  useEffect(() => {
    const onKeyDown = (e) => { if (e.key === "Escape") speaker.stop(); };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      speaker.stop();
    };
  }, [speaker]);

  return <div role="status" aria-live="polite" className="sr-only" {...{ [IGNORE_ATTR]: "" }}>{message}</div>;
}
