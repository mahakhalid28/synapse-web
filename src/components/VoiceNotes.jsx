// Per-lecture Voice Notes panel: record a note at the current lecture moment,
// and list, replay, open and delete this lecture's notes.
//
// This component owns the recorder and the unsaved-recording prompt. The lecture
// screen supplies how to read the lecture time and how to pause the lecture and
// its TTS, and gets back a small control object (controlRef) so it can:
//   toggle()          Alt+M
//   lectureStarted()  the lecture or TTS was started: re-pause while recording
//                     (returns true = blocked), otherwise stop a playing note
//   requestLeave(fn)  run fn only after any recording has been saved/discarded
//
// Everything spoken goes through the screen's single announce(); nothing here is
// its own live region, and nothing is announced while a recording is running
// (the microphone would hear a screen reader).

import { useEffect, useRef, useState, useCallback } from "react";
import VoiceNoteList from "./VoiceNoteList";
import { useVoiceRecorder, formatClock, RECORD_LIMIT_MS } from "../hooks/useVoiceRecorder.js";
import { useNotePlayer } from "../hooks/useNotePlayer.js";
import { listNotesForVideo as defaultListNotes } from "../lib/notesStore.js";
import { newestFirst } from "../lib/voiceNoteText.js";

export default function VoiceNotes({
  videoId,
  jobId = null,
  videoTitle = "",
  getLectureSeconds,
  getPointId = () => null,
  pauseLectureAudio,
  announce,
  onGoToTime,
  controlRef,
  // Test seams (the real store and browser APIs are used when omitted).
  listNotes = defaultListNotes,
  recorderOptions = {},
  playerOptions = {},
  deleteNote,
}) {
  const [notes, setNotes] = useState([]);
  const [load, setLoad] = useState({ state: "loading", message: "" });
  const [pendingLeave, setPendingLeave] = useState(false);
  const pendingLeaveRef = useRef(null);
  const headingRef = useRef(null);
  const promptRef = useRef(null);
  const focusHeadingWhenEmpty = useRef(false);

  // The list unmounts when its last note is deleted, so focus is placed here,
  // after the empty state has rendered, on the panel heading.
  useEffect(() => {
    if (focusHeadingWhenEmpty.current && notes.length === 0) {
      focusHeadingWhenEmpty.current = false;
      headingRef.current?.focus();
    }
  }, [notes]);

  const refresh = useCallback(async () => {
    setLoad({ state: "loading", message: "" });
    try {
      const list = await listNotes(videoId);
      setNotes([...list].sort(newestFirst));
      setLoad({ state: "ready", message: "" });
    } catch (err) {
      setLoad({
        state: "error",
        message: (err && err.message) || "Voice notes could not be loaded.",
      });
    }
  }, [listNotes, videoId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads this lecture's notes on mount / lecture change
  useEffect(() => { void refresh(); }, [refresh]);

  const recorder = useVoiceRecorder({
    videoId, jobId, videoTitle, getPointId, getLectureSeconds,
    pauseForRecording: pauseLectureAudio,
    announce,
    onSaved: (note) => setNotes((prev) => [note, ...prev.filter((n) => n.id !== note.id)].sort(newestFirst)),
    ...recorderOptions,
  });

  const player = useNotePlayer({
    announce,
    beforePlay: () => {
      if (recorder.getStatus() === "preparing" || recorder.getStatus() === "recording") return;
      pauseLectureAudio();
    },
    ...playerOptions,
  });

  const status = recorder.status;
  const showPrompt = status === "draft" || status === "save_failed" || pendingLeave;

  // The unsaved-recording prompt takes focus when it appears.
  useEffect(() => {
    if (showPrompt) promptRef.current?.focus();
  }, [showPrompt]);

  const finishLeave = () => {
    const go = pendingLeaveRef.current;
    pendingLeaveRef.current = null;
    setPendingLeave(false);
    go?.();
  };

  const saveDraft = async () => {
    const note = await recorder.saveDraft();
    if (note && pendingLeaveRef.current) finishLeave();
  };
  const discardDraft = () => {
    recorder.discardDraft();
    if (pendingLeaveRef.current) finishLeave();
  };
  const stayHere = () => {
    pendingLeaveRef.current = null;
    setPendingLeave(false);
  };

  // Called by the lecture screen before it navigates away.
  const requestLeave = async (go) => {
    const current = recorder.getStatus();
    if (current === "idle") { go(); return; }
    if (current === "saving") {
      announce("Saving your voice note. Try again in a moment.");
      return;
    }
    if (current === "preparing" || current === "recording") await recorder.stopForLeaving();
    if (recorder.getStatus() === "idle") { go(); return; } // nothing worth keeping (too short, cancelled)
    pendingLeaveRef.current = go;
    setPendingLeave(true);
  };

  // What the lecture screen is allowed to do to us.
  useEffect(() => {
    if (!controlRef) return undefined;
    controlRef.current = {
      toggle: () => recorder.toggle(),
      lectureStarted: () => {
        const current = recorder.getStatus();
        if (current === "preparing" || current === "recording") {
          recorder.onLecturePlayed();
          return true;
        }
        if (player.playingId) player.stop();
        return false;
      },
      // Called when the learner asks for Help. Refused while the microphone is in use (a screen
      // reader reading Help could be recorded). Otherwise a voice note that is playing (or still
      // loading) is stopped, which is what its own Play button does; its position is not kept.
      // Never touches the recorder or a saved note.
      beforeHelp: () => {
        const current = recorder.getStatus();
        if (current === "preparing" || current === "recording") return { blocked: true, stoppedNote: false };
        const stoppedNote = Boolean(player.playingId);
        if (stoppedNote) player.stop();
        return { blocked: false, stoppedNote };
      },
      requestLeave,
    };
    return () => { controlRef.current = null; };
  });

  const buttonLabel = {
    idle: "Record voice note",
    preparing: "Cancel recording",
    recording: "Stop recording",
    saving: "Saving voice note",
    draft: "Record voice note",
    save_failed: "Record voice note",
  }[status];
  const toggleDisabled = status === "saving" || status === "draft" || status === "save_failed";

  const statusText = {
    idle: "Ready. Press the button or Alt+M to record at this moment.",
    preparing: "The lecture is paused. Recording starts after the tone.",
    recording: `Recording: ${formatClock(recorder.elapsedMs / 1000)} of ${formatClock(RECORD_LIMIT_MS / 1000)}`,
    saving: "Saving your voice note…",
    draft: "You have an unsaved recording. Save or discard it below.",
    save_failed: "The voice note was not saved. Retry or discard it below.",
  }[status];

  const draft = recorder.draft;

  return (
    <section aria-labelledby="voice-notes-heading" className="mt-10">
      <h2
        id="voice-notes-heading"
        ref={headingRef}
        tabIndex={-1}
        className="text-[18px] font-semibold text-text-primary mb-2 outline-none"
      >
        Voice notes
      </h2>
      <p className="text-[14px] text-text-secondary mb-3">
        Record your own thoughts, questions or reminders about this moment. They stay on this
        computer. Use headphones so screen-reader speech isn&rsquo;t recorded.
      </p>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => { if (!toggleDisabled) void recorder.toggle(); }}
          aria-disabled={toggleDisabled ? "true" : undefined}
          aria-keyshortcuts="Alt+M"
          aria-describedby="voice-notes-status"
          className={"ds-btn-primary " + (toggleDisabled ? "opacity-50 cursor-not-allowed" : "")}
        >
          {buttonLabel}
          <span aria-hidden="true" className="ml-2 text-[14px] opacity-80">Alt+M</span>
        </button>
        {/* Not a live region on purpose: the timer would be read out every
            quarter second and a screen reader would be recorded. */}
        <span id="voice-notes-status" className="text-[14px] text-text-secondary">{statusText}</span>
      </div>

      {recorder.error && (
        <p id="voice-notes-error" className="text-[14px] text-text-primary mt-3">
          {recorder.error.message}
        </p>
      )}

      {showPrompt && (
        <div
          role="group"
          aria-labelledby="voice-notes-draft-heading"
          className="mt-4 p-4 bg-surface-muted border border-border-subtle rounded-radius-md"
        >
          <h3
            id="voice-notes-draft-heading"
            ref={promptRef}
            tabIndex={-1}
            className="text-[16px] font-semibold text-text-primary outline-none"
          >
            {pendingLeave ? "Save your voice note before leaving?" : "Unsaved voice note"}
          </h3>
          {draft && (
            <p className="text-[14px] text-text-secondary mt-1">
              Recorded {Math.round(draft.durationMs / 1000)} seconds at {formatClock(draft.lectureSeconds)} in the lecture.
              {draft.silentWarning ? " Warning: this recording may be silent." : ""}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={saveDraft}
              aria-disabled={status === "saving" ? "true" : undefined}
              className="ds-btn-primary"
            >
              {pendingLeave ? "Save and leave" : status === "save_failed" ? "Retry saving" : "Save note"}
            </button>
            <button type="button" onClick={discardDraft} className="ds-btn-secondary">
              {pendingLeave ? "Discard and leave" : "Discard"}
            </button>
            {pendingLeave && (
              <button type="button" onClick={stayHere} className="ds-btn-text">
                Stay on this screen
              </button>
            )}
          </div>
        </div>
      )}

      <h3 className="text-[16px] font-semibold text-text-primary mt-8 mb-2">Notes for this lecture</h3>
      {load.state === "loading" && <p className="text-[14px] text-text-secondary">Loading voice notes…</p>}
      {load.state === "error" && (
        <div>
          <p className="text-[14px] text-text-primary">{load.message}</p>
          <button type="button" onClick={refresh} className="ds-btn-secondary mt-2">
            Try again
          </button>
        </div>
      )}
      {load.state === "ready" && notes.length === 0 && (
        <p className="text-[14px] text-text-secondary">No voice notes for this lecture yet.</p>
      )}
      {load.state === "ready" && notes.length > 0 && (
        <>
          <p className="text-[14px] text-text-secondary mb-3">
            {notes.length} voice note{notes.length === 1 ? "" : "s"} for this lecture.
          </p>
          <VoiceNoteList
            idPrefix="vn-panel"
            notes={notes}
            player={player}
            announce={announce}
            deleteNote={deleteNote}
            openLabel={(note) => `Go to ${formatClock(note.lectureSeconds)} in lecture`}
            onOpen={(note) => onGoToTime(note.lectureSeconds)}
            onRemoved={(id, wasLast) => {
              if (wasLast) focusHeadingWhenEmpty.current = true;
              setNotes((prev) => prev.filter((n) => n.id !== id));
            }}
          />
        </>
      )}
    </section>
  );
}
