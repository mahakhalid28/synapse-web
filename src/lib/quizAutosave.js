// Autosave queue for a quiz attempt (docs/QUIZ_CONTRACT.md section 8.3).
//
// A plain module with no React and no timers, so it can be tested alone; a later screen wraps it.
//
//   * Serial: one write at a time, in order.
//   * Coalescing: while a write is running, only the NEWEST snapshot is kept. The older ones are
//     superseded, never lost in a way that matters, because every snapshot holds the whole state.
//   * Revision-aware: each successful write returns the new revision, which the next write uses
//     as its expected revision.
//   * On a "conflict" (the attempt changed in another window) it STOPS and never overwrites;
//     the owner reloads the saved attempt and calls reset(rev) to continue.
//   * On any other failure the newest snapshot is kept in memory and the error is reported once;
//     the next schedule() (or retry()) tries again. Nothing is silently dropped.
//
// `save(snapshot, expectedRev)` must resolve with the saved attempt ({ rev }) or reject with an
// error whose `code` is "conflict" for a revision mismatch (QuizStoreError does).

export function createAutosaver({ save, rev, onSaved, onConflict, onError }) {
  let currentRev = rev;
  let pending = null;
  let running = null;
  let stopped = false;
  let lastError = null;

  async function drain() {
    while (pending !== null && !stopped) {
      const snapshot = pending;
      pending = null;
      try {
        const saved = await save(snapshot, currentRev);
        currentRev = saved.rev;
        lastError = null;
        onSaved?.(saved);
      } catch (error) {
        if (error && error.code === "conflict") {
          stopped = true;
          pending = null;
          lastError = error;
          onConflict?.(error);
          return;
        }
        if (pending === null) pending = snapshot; // keep it; a newer snapshot replaces it
        lastError = error;
        onError?.(error);
        return; // retried by the next schedule() or retry(), not in a tight loop
      }
    }
  }

  function start() {
    if (!running) running = drain().finally(() => { running = null; });
    return running;
  }

  const api = {
    /** Queue the newest state. Resolves when the queue is idle: { ok, conflict, error }. */
    async schedule(snapshot) {
      if (stopped) return api.status();
      pending = snapshot;
      await start();
      return api.status();
    },
    /** Try again after a failure, without a new snapshot. */
    async retry() {
      if (stopped) return api.status();
      await start();
      return api.status();
    },
    /** Resolves when everything queued so far has been written (or has failed). */
    async flush() {
      if (running) await running;
      return api.status();
    },
    /** After a conflict: continue from the revision of the freshly loaded attempt. */
    reset(newRev) {
      currentRev = newRev;
      pending = null;
      stopped = false;
      lastError = null;
    },
    /** Stop for good (the screen closed). Unsaved state is not written. */
    stop() {
      stopped = true;
      pending = null;
    },
    hasPending: () => pending !== null,
    getRev: () => currentRev,
    status: () => ({
      ok: lastError === null && pending === null,
      conflict: stopped && lastError !== null && lastError.code === "conflict",
      error: lastError,
    }),
  };
  return api;
}
