// Plays back ONE saved voice note at a time.
//
// The audio is read from notesStore each time and played through a fresh blob
// URL, which is revoked as soon as playback stops (blob URLs are never stored).
// Starting a note first calls `beforePlay`, which the screen uses to pause the
// lecture and Synapse's TTS so nothing overlaps the learner's own voice.
//
// Spoken feedback follows the app's pattern: the Play button is an aria-pressed
// toggle with a constant name, so the screen reader says "pressed" itself and
// nothing is announced over the start of the recording. Only the end of
// playback and problems are announced.

import { useCallback, useEffect, useRef, useState } from "react";
import { getNoteAudio } from "../lib/notesStore.js";

export function useNotePlayer({
  announce = () => {},
  beforePlay = () => {},
  loadAudio = getNoteAudio,
  createAudio = (url) => new Audio(url),
} = {}) {
  const [playingId, setPlayingId] = useState(null); // the note currently loading or playing
  const [error, setError] = useState(null);

  const current = useRef({ token: 0, audio: null, url: null });
  const mounted = useRef(true);
  const latest = useRef({});
  useEffect(() => {
    latest.current = { announce, beforePlay, loadAudio, createAudio };
  });

  const release = useCallback(() => {
    const c = current.current;
    c.token++; // invalidates any load still in flight
    if (c.audio) {
      c.audio.onended = null;
      c.audio.onerror = null;
      try { c.audio.pause(); } catch { /* already stopped */ }
      c.audio = null;
    }
    if (c.url) {
      URL.revokeObjectURL(c.url);
      c.url = null;
    }
  }, []);

  const stop = useCallback(() => {
    release();
    if (mounted.current) setPlayingId(null);
  }, [release]);

  const fail = useCallback((message) => {
    release();
    if (mounted.current) {
      setPlayingId(null);
      setError(message);
    }
    latest.current.announce(message);
  }, [release]);

  const toggle = useCallback(async (note) => {
    if (current.current.audio && playingId === note.id) {
      stop();
      return;
    }
    release();
    const token = current.current.token;
    setError(null);
    setPlayingId(note.id);
    try { latest.current.beforePlay(); } catch { /* pausing the lecture is best effort */ }

    let blob;
    try {
      blob = await latest.current.loadAudio(note.id);
    } catch (err) {
      if (current.current.token !== token) return;
      fail(
        err && err.code === "not_found"
          ? "The recording for this voice note is missing."
          : "This voice note could not be loaded.",
      );
      return;
    }
    if (current.current.token !== token || !mounted.current) return;

    const url = URL.createObjectURL(blob);
    const audio = latest.current.createAudio(url);
    current.current.url = url;
    current.current.audio = audio;
    audio.onended = () => {
      if (current.current.token !== token) return;
      release();
      if (mounted.current) setPlayingId(null);
      latest.current.announce("Finished playing voice note.");
    };
    audio.onerror = () => {
      if (current.current.token === token) fail("This voice note could not be played.");
    };
    try {
      await audio.play();
    } catch {
      if (current.current.token === token) fail("This voice note could not be played.");
    }
  }, [playingId, release, stop, fail]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      release();
    };
  }, [release]);

  return { playingId, error, toggle, stop };
}
