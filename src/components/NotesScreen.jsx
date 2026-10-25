// Global Voice Notes screen: every saved voice note, grouped by lecture.
// Opening a note takes the learner to that lecture, cued at the note's time and
// paused (they press Play themselves), exactly like opening a bookmark.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "./Sidebar";
import VoiceNoteList from "./VoiceNoteList";
import { useNotePlayer } from "../hooks/useNotePlayer.js";
import { useAnnouncer } from "../hooks/useAnnouncer.js";
import { formatClock } from "../hooks/useVoiceRecorder.js";
import { listAllNotes as defaultListAll } from "../lib/notesStore.js";
import { groupByLecture } from "../lib/voiceNoteText.js";
import { helpClosedNotice, helpOpenNotice } from "../lib/onboardingText.js";

export default function NotesScreen({
  onNavigate = () => {},
  onOpenNote = () => {},
  listAll = defaultListAll,
  deleteNote,
  playerOptions = {},
  registerHelpGuard = null, // App's Help dialog asks this screen to stop a playing note first
}) {
  const [notes, setNotes] = useState([]);
  const [load, setLoad] = useState({ state: "loading", message: "" });
  const h1Ref = useRef(null);
  const { message, announce } = useAnnouncer();
  const focusHeadingNext = useRef(false);

  // A lecture's list unmounts when its last note is deleted, so focus goes to
  // the page heading once the new state has rendered.
  useEffect(() => {
    if (focusHeadingNext.current) {
      focusHeadingNext.current = false;
      h1Ref.current?.focus();
    }
  }, [notes]);

  const refresh = useCallback(async () => {
    setLoad({ state: "loading", message: "" });
    try {
      setNotes(await listAll());
      setLoad({ state: "ready", message: "" });
    } catch (err) {
      setLoad({ state: "error", message: (err && err.message) || "Voice notes could not be loaded." });
    }
  }, [listAll]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the notes when the screen opens
  useEffect(() => { void refresh(); }, [refresh]);

  const player = useNotePlayer({ announce, ...playerOptions });

  // Help (a modal over this screen). A note that is playing, or still loading, is stopped when Help
  // opens: the same thing its own Play button does, so its position is not kept. Nothing is resumed
  // when Help closes. The "closed" message is announced here once this screen is no longer inert.
  const helpLatest = useRef({});
  useEffect(() => {
    helpLatest.current = { playingId: player.playingId, stop: player.stop, announce };
  });
  const noteStoppedForHelp = useRef(false);
  useEffect(() => {
    if (!registerHelpGuard) return undefined;
    return registerHelpGuard({
      beforeHelp: () => {
        const { playingId, stop } = helpLatest.current;
        const stoppedNote = Boolean(playingId);
        if (stoppedNote) stop();
        noteStoppedForHelp.current = stoppedNote;
        return { blocked: false, notice: helpOpenNotice({ stoppedNote }) };
      },
      afterHelp: () => {
        const message = helpClosedNotice({ stoppedNote: noteStoppedForHelp.current });
        noteStoppedForHelp.current = false;
        if (message) helpLatest.current.announce(message);
      },
    });
  }, [registerHelpGuard]);
  const groups = useMemo(() => groupByLecture(notes), [notes]);

  return (
    <div className="flex h-full w-full bg-background font-sans overflow-hidden">
      <nav aria-label="Main navigation">
        <Sidebar active="notes" onNavigate={onNavigate} />
      </nav>

      <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto outline-none">
        <div className="max-w-[700px] px-12 py-12">
          <div aria-hidden="true" className="text-[14px] font-medium text-text-secondary mb-3">Voice notes</div>
          <h1
            ref={h1Ref}
            tabIndex={-1}
            className="text-[32px] font-bold text-text-primary mb-2 outline-none"
          >
            Your voice notes.
          </h1>
          <div role="status" aria-live="polite" className="sr-only">{message}</div>

          {load.state === "loading" && <p className="text-[15px] text-text-secondary">Loading your voice notes…</p>}

          {load.state === "error" && (
            <div>
              <p className="text-[15px] text-text-primary mb-3">{load.message}</p>
              <button type="button" onClick={refresh} className="ds-btn-secondary">Try again</button>
            </div>
          )}

          {load.state === "ready" && (
            <>
              <p className="text-[15px] text-text-secondary mb-10">
                {notes.length === 0
                  ? "Nothing recorded yet. Open a lecture and press Alt+M to record a note."
                  : `${notes.length} voice note${notes.length === 1 ? "" : "s"} in ${groups.length} lecture${groups.length === 1 ? "" : "s"}. They are stored on this computer only.`}
              </p>

              {groups.map((group) => (
                <section key={group.videoId} aria-labelledby={`vn-group-${group.videoId}`} className="mb-10">
                  <h2
                    id={`vn-group-${group.videoId}`}
                    className="text-[18px] font-semibold text-text-primary mb-3"
                  >
                    {group.title}
                  </h2>
                  <VoiceNoteList
                    idPrefix={`vn-${group.videoId}`}
                    notes={group.notes}
                    totalCount={notes.length}
                    player={player}
                    announce={announce}
                    deleteNote={deleteNote}
                    openLabel={(note) => `Open at ${formatClock(note.lectureSeconds)}`}
                    onOpen={onOpenNote}
                    onRemoved={(id, wasLast) => {
                      if (wasLast) focusHeadingNext.current = true;
                      setNotes((prev) => prev.filter((n) => n.id !== id));
                    }}
                  />
                </section>
              ))}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
