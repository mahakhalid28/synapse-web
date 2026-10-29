import { useEffect, useMemo } from "react";
import { useAnnouncer } from "../hooks/useAnnouncer.js";
import { useVoiceTurn } from "./useVoiceTurn.js";
import { TURN } from "./voiceTurn.js";
import { useVoiceActionsRegistry } from "./voiceActions.js";
import { createCommandHandler } from "./voiceCommands.js";
import { createSpeaker } from "./voiceSpeech.js";
import { warmUpVoice } from "./voiceApi.js";

// The talk control for voice commands, in the top bar so it is on every screen.
//
//   Alt+T         start listening; press Alt+T again to stop (no need to hold anything)
//   Space (held)  on the focused Talk button: listen while the key is down
//   click / Enter on the button: same as Alt+T
//
// Alt+T follows the app's Alt+letter convention and, like Alt+S, works while typing in a field. Keys with
// Ctrl, Shift or Meta are ignored so AltGr layouts (reported as Ctrl+Alt) do not trigger it.
//
// Nothing is spoken while the microphone is open; messages come after it closes, through one polite live
// region. `onUtterance` receives the recorded clip and may return { playbackCommand } so the turn knows not to
// resume audio after a command that changed playback. Until recognition is connected the default only reports
// how much was recorded.

const LABELS = {
  [TURN.IDLE]: "Talk",
  [TURN.PREPARING]: "Getting ready…",
  [TURN.LISTENING]: "Listening…",
  [TURN.PROCESSING]: "Working…",
};

const HINT = "Press Alt+T to start talking and again to stop, or hold the Space bar while this button is focused.";

export default function VoiceControl({ onUtterance, deps, commandDeps, speakerDeps, warmUp = warmUpVoice }) {
  const { message, announce } = useAnnouncer();
  const registry = useVoiceActionsRegistry();
  const speaker = useMemo(() => createSpeaker({ announce, ...speakerDeps }), [announce, speakerDeps]);
  const handleCommand = useMemo(
    () => createCommandHandler({ registry, speaker, deps: commandDeps }),
    [registry, speaker, commandDeps],
  );

  // Load the server's models in the background so the first command is not slow.
  useEffect(() => {
    warmUp();
  }, [warmUp]);

  const { status, toggle, holdStart, holdEnd } = useVoiceTurn({
    onUtterance: onUtterance ?? handleCommand,
    announce,
    deps,
    onStart: () => speaker.stop(),
  });

  useEffect(() => {
    const onKeyDown = (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      // e.code is empty for some assistive-technology key events, so fall back to the typed letter.
      const pressed = e.code || (e.key?.length === 1 ? `Key${e.key.toUpperCase()}` : "");
      if (pressed !== "KeyT") return;
      e.preventDefault();
      if (!e.repeat) toggle();
    };
    // Capture phase: a screen that stops a key's propagation cannot swallow the shortcut.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  // Keys pressed while the YouTube player has focus go to the player's frame, never to this page, so Alt+T
  // would silently do nothing after the learner clicks the video. When focus moves into a frame, take it back.
  useEffect(() => {
    const takeFocusBack = () => {
      setTimeout(() => {
        const active = document.activeElement;
        if (active && active.tagName === "IFRAME") {
          active.blur();
          window.focus();
        }
      }, 0);
    };
    window.addEventListener("blur", takeFocusBack);
    return () => window.removeEventListener("blur", takeFocusBack);
  }, []);

  const busy = status !== TURN.IDLE;
  return (
    <>
      <button
        type="button"
        onClick={toggle}
        // Space is hold-to-talk when idle; if listening was already started (Alt+T), Space stops it. The
        // browser would also "click" on Space release, so both ends are intercepted.
        onKeyDown={(e) => {
          if (e.key !== " " || e.altKey || e.ctrlKey || e.metaKey) return;
          e.preventDefault();
          if (e.repeat) return;
          if (status === TURN.IDLE) holdStart();
          else toggle();
        }}
        onKeyUp={(e) => {
          if (e.key !== " ") return;
          e.preventDefault();
          holdEnd();
        }}
        aria-keyshortcuts="Alt+T"
        aria-describedby="voice-control-hint"
        className={
          (busy ? "ds-btn-accent-outline" : "ds-btn-secondary") + " mr-2"
        }
      >
        <MicIcon />
        {LABELS[status]}
      </button>
      <span id="voice-control-hint" className="sr-only">{HINT}</span>
      <div role="status" aria-live="polite" className="sr-only">{message}</div>
      {/* The same words on screen, so a sighted helper (or a failed voice) still shows what happened. */}
      {message && <span aria-hidden="true" className="mr-2 max-w-[28ch] truncate text-[13px] text-text-secondary">{message}</span>}
    </>
  );
}

function MicIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <rect x="6" y="2" width="4" height="7" rx="2" />
      <path d="M3.8 7.6 a4.2 4.2 0 0 0 8.4 0" />
      <path d="M8 11.8 V14" />
    </svg>
  );
}
