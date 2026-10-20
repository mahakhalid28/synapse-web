// Small pure helpers shared by the Voice Notes screens.

import { formatClock } from "../hooks/useVoiceRecorder.js";

/** What a note is called: its label, or "Voice note at 3:21" when it has none. */
export const noteTitle = (note) => note.label || `Voice note at ${formatClock(note.lectureSeconds)}`;

export const newestFirst = (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1);

/** Lectures ordered by their newest note; notes inside each keep newest-first order. */
export function groupByLecture(notes) {
  const groups = new Map();
  for (const note of [...notes].sort(newestFirst)) {
    if (!groups.has(note.videoId)) groups.set(note.videoId, { videoId: note.videoId, title: "", notes: [] });
    const group = groups.get(note.videoId);
    if (!group.title && note.videoTitle && note.videoTitle.trim()) group.title = note.videoTitle;
    group.notes.push(note);
  }
  // A lecture whose notes carry no title is still named, never blank.
  return [...groups.values()].map((g) => ({ ...g, title: g.title || `Lecture ${g.videoId}` }));
}
