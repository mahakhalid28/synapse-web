import { useEffect, useMemo, useRef } from "react";
import { useAnnouncer } from "../hooks/useAnnouncer.js";
import { useVoiceTurn } from "./useVoiceTurn.js";
import { TURN } from "./voiceTurn.js";
import { useVoiceActionsRegistry } from "./voiceActions.js";
import { createCommandHandler } from "./voiceCommands.js";
import { createSpeaker } from "./voiceSpeech.js";
import { warmUpVoice } from "./voiceApi.js";
import { useScreenIntro } from "./useScreenIntro.js";
import { useLiveNarrator, IGNORE_ATTR } from "./useLiveNarrator.js";
import { useVoiceAudio } from "./voiceAudio.js";
import { playEarcon as defaultPlayEarcon } from "./earcons.js";
import { anySpeakerBusy, feedbackMode } from "./voiceSpeech.js";
import { autoListenEnabled } from "./voicePrefs.js";
import { progressUpdate } from "./preparationProgress.js";

// Auto-listen is off in screen-reader feedback mode: the microphone would record the screen reader.
const canAutoListen = () => autoListenEnabled() && feedbackMode() !== "screenreader";

// The talk control for voice commands, in the top bar so it is on every screen.
//
//   Alt+T         tap to start listening, tap again to stop; it also works while typing in a field (like Alt+S)
//   click / Enter on the button: toggle
//
// Alt+T ignores Ctrl, Shift and Meta so AltGr layouts (Ctrl+Alt) do not trigger it. It is off while Help is open.
//
// When `screen` changes, the screen is introduced aloud (see useScreenIntro.js). Starting a turn stops it.
// What screens announce in their live regions is also spoken (see useLiveNarrator.js), and when a command's
// screen announces its own result ("This is the last moment."), that replaces the generic "Okay, ...".
//
// Nothing is spoken while the microphone is open; messages come after it closes, through one polite live
// region. `onUtterance` receives the recorded clip and may return { playbackCommand } so the turn knows not to
// resume audio after a command that changed playback.

const LABELS = {
  [TURN.IDLE]: "Talk",
  [TURN.PREPARING]: "Getting ready…",
  [TURN.LISTENING]: "Listening…",
  [TURN.PROCESSING]: "Working…",
};

const HINT = "Press Alt+T to start talking and again to stop. It works even while typing.";

const NON_TEXT_INPUTS = new Set(["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image"]);
const TEXT_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);

/** True when `el` is a text field (kept for callers that must not steal typing). */
export function isTypingTarget(el) {
  if (!el || el === window || el === document) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUTS.has((el.getAttribute("type") || "text").toLowerCase());
  return TEXT_ROLES.has(el.getAttribute?.("role"));
}

// How often the "explanation ready" chime checks the lecture's current question.
export const READY_CUE_POLL_MS = 300;

export default function VoiceControl({ onUtterance, deps, commandDeps, speakerDeps, warmUp = warmUpVoice, disabled = false, registerHelpInterruption = null, screen = null, introDelayMs, playEarcon = defaultPlayEarcon }) {
  const { message, announce } = useAnnouncer();
  const registry = useVoiceActionsRegistry();
  const audio = useVoiceAudio();
  const speaker = useMemo(() => createSpeaker({ announce, ...speakerDeps }), [announce, speakerDeps]);
  const statusRef = useRef(TURN.IDLE);

  // Screen messages wait while the learner is speaking, a voice note records, or an explanation plays.
  const narrator = useLiveNarrator({
    speaker,
    enabled: !disabled,
    screen,
    onUrgent: () => playEarcon("error"),
    canSpeak: () => {
      if (statusRef.current !== TURN.IDLE || audio.isTurnActive()) return false;
      const port = audio.getPort();
      return !(port?.isNoteBusy() || port?.getSnapshot()?.explanation === "playing");
    },
  });

  const handleCommand = useMemo(
    () => createCommandHandler({
      registry, speaker, deps: commandDeps, announcesScreens: true,
      screenRepliedSince: (since) => narrator.current.lastAt >= since,
      cue: playEarcon,
    }),
    [registry, speaker, commandDeps, narrator, playEarcon],
  );

  // Watch the lecture's explanation questions:
  //  - a chime when an explanation has just become ready ("... is ready. Would you like to listen?"), so the
  //    learner notices it even mid-thought
  //  - auto-listen: once the question has been spoken, the microphone opens for the answer by itself
  // Each question is chimed and listened for at most once.
  // Spoken preparation progress on the lecture screen ("The first explanation is ready. 1 of 12."). Only the
  // newest pending sentence is kept, and it waits until nothing is speaking, the microphone is free and
  // neither the lecture nor an explanation is playing: progress never talks over the lecture.
  useEffect(() => {
    if (disabled) return undefined;
    let memory = { videoId: null };
    let pendingProgress = null;
    const timer = setInterval(() => {
      const context = registry.context();
      if (!context.videoId) return;
      if (memory.videoId !== context.videoId) memory = { videoId: context.videoId };
      const update = progressUpdate(memory, context.preparationProgress);
      if (update) pendingProgress = update;
      if (!pendingProgress || context.explanationQuestion) return; // a question to the learner comes first
      if (anySpeakerBusy() || statusRef.current !== TURN.IDLE || audio.isTurnActive()) return;
      const snapshot = audio.getPort()?.getSnapshot?.();
      if (snapshot && (["playing", "buffering"].includes(snapshot.lecture) || snapshot.explanation === "playing")) return;
      const text = pendingProgress;
      pendingProgress = null;
      speaker.say(text);
    }, READY_CUE_POLL_MS);
    return () => clearInterval(timer);
  }, [registry, disabled, audio, speaker]);

  const latestTurn = useRef({ listenAgain: () => {} }); // filled in once the voice turn exists (below)
  useEffect(() => {
    if (disabled) return undefined;
    let lastId = registry.context().explanationQuestion?.id ?? null;
    let awaiting = null; // { id, seenTicks } a question whose answer has not been listened for yet
    const timer = setInterval(() => {
      const context = registry.context();
      const question = context.explanationQuestion;
      const id = question?.id ?? null;
      if (id && id !== lastId) {
        if (question.choices?.includes("listen") && /\bis ready\b/i.test(context.questionPrompt || "")) playEarcon("ready");
        awaiting = { id, seenTicks: 0 };
      }
      lastId = id;
      if (!awaiting) return;
      if (awaiting.id !== id) { awaiting = null; return; }
      awaiting.seenTicks += 1;
      // Wait until the question has actually been spoken (its speaker started and finished) and nothing is
      // happening, then listen once.
      if (awaiting.seenTicks < 2 || anySpeakerBusy() || statusRef.current !== TURN.IDLE || audio.isTurnActive()) return;
      awaiting = null;
      if (canAutoListen()) latestTurn.current.listenAgain();
    }, READY_CUE_POLL_MS);
    return () => clearInterval(timer);
  }, [registry, disabled, playEarcon, audio]);

  // Load the server's models in the background so the first command is not slow.
  useEffect(() => {
    warmUp();
  }, [warmUp]);

  const { status, toggle, interrupt, listenAgain } = useVoiceTurn({
    onUtterance: onUtterance ?? handleCommand,
    announce,
    deps,
    onStart: () => speaker.stop(),
    autoListen: canAutoListen,
  });
  statusRef.current = status;
  latestTurn.current = { listenAgain };

  useScreenIntro({
    screen,
    speaker,
    enabled: !disabled,
    describe: () => registry.context(),
    canSpeak: () => statusRef.current === TURN.IDLE,
    ...(introDelayMs === undefined ? {} : { delayMs: introDelayMs }),
  });

  useEffect(() => {
    if (!registerHelpInterruption) return undefined;
    const control = {
      interrupt: () => {
        interrupt();
        handleCommand.cancel();
        speaker.stop();
      },
    };
    return registerHelpInterruption(control);
  });

  useEffect(() => () => speaker.stop(), [speaker]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (disabled) return;
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      // e.code is empty for some assistive-technology key events, so fall back to the typed letter.
      const pressed = e.code || (e.key?.length === 1 ? `Key${e.key.toUpperCase()}` : "");
      if (pressed !== "KeyT") return;
      e.preventDefault();
      if (!e.repeat) toggle();
    };
    // Capture phase: a screen that stops a key's propagation cannot swallow the shortcut.
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  });

  // Keys pressed while the YouTube player has focus go to the player's frame, never to this page, so a key
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
        disabled={disabled}
        onClick={() => { if (!disabled) toggle(); }}
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
      {/* data-voice-ignore: this region is the speaker's own fallback, so the narrator must not echo it. */}
      <div role="status" aria-live="polite" className="sr-only" {...{ [IGNORE_ATTR]: "" }}>{message}</div>
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
