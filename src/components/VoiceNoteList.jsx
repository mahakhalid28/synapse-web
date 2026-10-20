// The list of saved voice notes, shared by the per-lecture panel and the global
// Voice Notes screen. Each note can be played, opened in its lecture, and
// deleted. Deleting asks first, inline (no modal): focus moves to "Cancel", and
// afterwards to the neighbouring note's Delete button so the learner keeps their
// place.

import { useEffect, useRef, useState } from "react";
import { deleteNote as defaultDeleteNote } from "../lib/notesStore.js";
import { formatClock, formatDuration } from "../hooks/useVoiceRecorder.js";
import { noteTitle } from "../lib/voiceNoteText.js";

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
    onRemoved(note.id, !neighbour);
    const left = totalCount - 1;
    announce(`Deleted ${noteTitle(note)}. ${left === 0 ? "No voice notes left." : `${left} left.`}`);
  };

  return (
    <ul className="space-y-3 list-none p-0 m-0">
      {notes.map((note) => {
        const title = noteTitle(note);
        const playing = player.playingId === note.id;
        const confirming = confirmingId === note.id;
        return (
          <li
            key={note.id}
            className="p-4 bg-surface border border-border-subtle rounded-radius-md"
          >
            <div className="text-[16px] font-semibold text-text-primary leading-snug">{title}</div>
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
  );
}
