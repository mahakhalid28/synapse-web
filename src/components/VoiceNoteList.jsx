// The list of saved voice notes, shared by the per-lecture panel and the global
// Voice Notes screen. Each note can be played, opened in its lecture, and
// deleted. Deleting asks first, inline (no modal): focus moves to "Cancel", and
// afterwards to the neighbouring note's Delete button so the learner keeps their
// place.

import { useEffect, useRef, useState } from "react";
import { deleteNote as defaultDeleteNote } from "../lib/backendNotes.js";
import { formatClock, formatDuration } from "../hooks/useVoiceRecorder.js";
import { noteTitle } from "../lib/voiceNoteText.js";
import { useVoiceActions } from "../voice/voiceActions";

const savedOn = (createdAt) =>
  new Date(createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * @param {object} props
 * @param {object[]} props.notes
 * @param {{ playingId: string|null, toggle: (note: object) => void, stop: () => void }} props.player
 * @param {(note: object) => void} props.onOpen
 * @param {(note: object) => string} props.openLabel   visible text of the "open" button
 * @param {(id: string, wasLast: boolean) => void} props.onRemoved   the note is gone from storage: drop it from the list
 * @param {(msg: string) => void} props.announce
 * @param {(id: string) => Promise<boolean>} [props.deleteNote]
 * @param {string} props.idPrefix                       keeps element ids unique when two lists exist
 * @param {number} [props.totalCount]                   all notes on the screen, for "N left" (defaults to this list's own count)
 */
export default function VoiceNoteList({
  notes, player, onOpen, openLabel, onRemoved, announce,
  deleteNote = defaultDeleteNote, idPrefix = "vn", totalCount = notes.length,
}) {
  const [confirmingId, setConfirmingId] = useState(null);
  const [busyId, setBusyId] = useState(null); // display only; busyRef is the real guard
  const busyRef = useRef(false);
  const pendingFocus = useRef(null); // element id to focus once the list has re-rendered
  const refocusDelete = useRef(null); // note whose Delete button gets focus once its confirmation closes
  const cancelRefs = useRef({});
  const [page, setPage] = useState(0);
  const lastPage = Math.max(0, Math.ceil(notes.length / 60) - 1);
  const activePage = Math.min(page, lastPage);
  const visible = notes.slice(activePage * 60, activePage * 60 + 60);

  const deleteButtonId = (id) => `${idPrefix}-delete-${id}`;

  // Focus moves by effect, after React has rendered the new state, never by
  // timer: a timer can fire before the buttons it looks for exist.
  useEffect(() => {
    if (confirmingId) {
      cancelRefs.current[confirmingId]?.focus(); // the safe choice
    } else if (refocusDelete.current) {
      document.getElementById(`${idPrefix}-delete-${refocusDelete.current}`)?.focus();
      refocusDelete.current = null;
    }
  }, [confirmingId, idPrefix]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    document.getElementById(target)?.focus();
  }, [notes]);

  const cancelDelete = (note) => {
    refocusDelete.current = note.id;
    setConfirmingId(null);
  };

  const confirmDelete = async (note) => {
    if (busyRef.current) return; // a second click while the first delete is still running
    busyRef.current = true;
    const at = notes.findIndex((n) => n.id === note.id);
    const neighbour = notes[at + 1] ?? notes[at - 1];
    if (player.playingId === note.id) player.stop();
    setBusyId(note.id);
    try {
      await deleteNote(note.id);
    } catch (err) {
      busyRef.current = false;
      setBusyId(null);
      refocusDelete.current = note.id;
      setConfirmingId(null);
      announce(`Could not delete ${noteTitle(note)}. ${(err && err.message) || "Please try again."}`);
      return;
    }
    busyRef.current = false;
    setBusyId(null);
    if (neighbour) pendingFocus.current = deleteButtonId(neighbour.id);
    setConfirmingId(null);
    // The second argument tells the parent this was the last note, so it can
    // move focus somewhere sensible (this list unmounts when it is empty).
    onRemoved(note.id, !notes.some((entry) => entry.id !== note.id && entry.videoId === note.videoId));
    const left = totalCount - 1;
    announce(`Deleted ${noteTitle(note)}. ${left === 0 ? "No voice notes left." : `${left} left.`}`);
  };

  useVoiceActions({
    play_note: ({ index }) => { const note = visible[index - 1]; if (!note) throw new Error("No such note."); return player.toggle(note); },
    stop_note_audio: () => player.stop(),
    open_item: ({ index }) => { const note = visible[index - 1]; if (!note) throw new Error("No such note."); player.stop(); return onOpen(note); },
    open_note: ({ index }) => { const note = visible[index - 1]; if (!note) throw new Error("No such note."); player.stop(); return onOpen(note); },
    delete_note: ({ index }) => { const note = visible[index - 1]; if (!note) throw new Error("No such note."); setConfirmingId(note.id); },
    open_note_explanation: ({ index, explanation }) => {
      const note = visible[index - 1];
      const item = note?.explanations?.[explanation - 1];
      if (!item) throw new Error("No such nearby explanation.");
      player.stop();
      return onOpen({ ...note, savedExplanation: item });
    },
    next_saved_page: () => setPage(Math.min(activePage + 1, lastPage)),
    previous_saved_page: () => setPage(Math.max(activePage - 1, 0)),
    ...(confirmingId ? {
      confirm_note_deletion: () => confirmDelete(notes.find((note) => note.id === confirmingId)),
      cancel_note_deletion: () => cancelDelete(notes.find((note) => note.id === confirmingId)),
      confirm_yes: () => confirmDelete(notes.find((note) => note.id === confirmingId)),
      confirm_no: () => cancelDelete(notes.find((note) => note.id === confirmingId)),
    } : {}),
  }, () => ({ pendingConfirmation: confirmingId ? "confirm_note_deletion" : null,
    confirmationRef: confirmingId || null,
    items: visible.map((note, index) => ({ ref: note.id, kind: "note", label: noteTitle(note), position: index + 1 })) }));

  return (
    <><ul className="space-y-3 list-none p-0 m-0">
      {visible.map((note, index) => {
        const title = noteTitle(note);
        const playing = player.playingId === note.id;
        const confirming = confirmingId === note.id;
        return (
          <li
            key={note.id}
            className="p-4 bg-surface border border-border-subtle rounded-radius-md"
          >
            {note.lectureLabel && visible[index - 1]?.videoId !== note.videoId && <h2 className="text-[18px] font-semibold">{note.lectureLabel}</h2>}
            <div className="text-[16px] font-semibold text-text-primary leading-snug"><span aria-hidden="true">{index + 1}. </span><span>{title}</span></div>
            <div className="text-[14px] text-text-secondary mt-1">
              <span className="font-mono tabular-nums">{formatClock(note.lectureSeconds)}</span>
              {" in the lecture · "}
              {formatDuration(note.durationMs)}
              {" · saved "}
              {savedOn(note.createdAt)}
            </div>
            {note.silentWarning && (
              <div className="text-[14px] text-text-primary mt-1">
                Warning: this recording may be silent.
              </div>
            )}
            {note.explanations?.length > 0 && <div className="mt-2">
              <p>Nearby explanations, within one minute of this note:</p>
              <ul>{note.explanations.map((item, explanationIndex) => <li key={item.id}>
                <button className="ds-btn-text" aria-label={`${title}: open nearby explanation ${explanationIndex + 1} at ${item.timestamp}, ${item.mode} depth`} onClick={() => onOpen({ ...note, savedExplanation: item })}>{explanationIndex + 1}. Open explanation at {item.timestamp}, {item.mode} depth</button>
              </li>)}</ul>
            </div>}

            {confirming ? (
              <div
                role="group"
                aria-label={`Confirm deleting ${title}`}
                className="mt-3 flex flex-wrap items-center gap-3"
              >
                <span className="text-[14px] text-text-primary">
                  Delete this voice note? This can&rsquo;t be undone.
                </span>
                <button
                  type="button"
                  ref={(el) => { cancelRefs.current[note.id] = el; }}
                  onClick={() => cancelDelete(note)}
                  className="ds-btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => confirmDelete(note)}
                  aria-disabled={busyId === note.id ? "true" : undefined}
                  className="ds-btn-text"
                >
                  Yes, delete
                </button>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {/* Constant name + aria-pressed: the screen reader says "pressed" /
                    "not pressed" itself, so nothing is spoken over the recording. */}
                <button
                  type="button"
                  onClick={() => player.toggle(note)}
                  aria-pressed={playing}
                  aria-label={`Play ${title}`}
                  className="ds-btn-secondary"
                >
                  <span aria-hidden="true">{playing ? "■ Stop" : "▶ Play"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpen(note)}
                  aria-label={`${openLabel(note)}, ${title}`}
                  className="ds-btn-secondary"
                >
                  {openLabel(note)}
                </button>
                <button
                  type="button"
                  id={deleteButtonId(note.id)}
                  onClick={() => setConfirmingId(note.id)}
                  aria-label={`Delete ${title}`}
                  className="ds-btn-text"
                >
                  Delete
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
    {lastPage > 0 && <nav aria-label="Voice note pages" className="flex gap-3 mt-3">
      <button className="ds-btn-secondary" disabled={!activePage} onClick={() => setPage(activePage - 1)}>Previous page</button>
      <span>Page {activePage + 1} of {lastPage + 1}</span>
      <button className="ds-btn-secondary" disabled={activePage === lastPage} onClick={() => setPage(activePage + 1)}>Next page</button>
    </nav>}</>
  );
}
