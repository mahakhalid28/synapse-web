// Hand-written fakes of the browser recording environment (microphone,
// MediaRecorder, level meter, tone) and of the notes store, for component tests.
// They check the app's LOGIC. They are not a real microphone or real IndexedDB.

import { vi } from "vitest";

export function makeRecorderEnv(over = {}) {
  const tracks = [{ stop: vi.fn(), onended: null }];
  const stream = { getTracks: () => tracks };

  class FakeRecorder {
    static payload = "voice-bytes";
    static isTypeSupported = (t) => t === "audio/webm;codecs=opus";
    constructor(_s, opts) {
      this.mimeType = opts.mimeType;
      this.state = "inactive";
    }
    start() { this.state = "recording"; }
    stop() {
      if (this.state === "inactive") return;
      this.state = "inactive";
      if (FakeRecorder.payload) this.ondataavailable?.({ data: new Blob([FakeRecorder.payload], { type: this.mimeType }) });
      Promise.resolve().then(() => this.onstop?.());
    }
  }

  const meter = { read: vi.fn(() => ({ peak: 0.4, rms: 0.05 })), close: vi.fn() };
  const deps = {
    getUserMedia: vi.fn(async () => stream),
    hasMediaDevices: () => true,
    MediaRecorderCtor: FakeRecorder,
    createLevelMeter: vi.fn(() => meter),
    playTone: vi.fn(async () => {}),
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    clock: () => Date.now(),
    ...over.deps,
  };

  let counter = 0;
  const saved = [];
  const store = {
    saveNote: vi.fn(async (note, blob) => {
      const stored = { ...note, sizeBytes: blob.size };
      saved.push(stored);
      return stored;
    }),
    newNoteId: vi.fn(() => `new-${++counter}`),
    ...over.store,
  };

  return { tracks, stream, FakeRecorder, meter, deps, store, saved };
}

export const makeNote = (over = {}) => ({
  id: "n1",
  videoId: "5ugDJhmmkFM",
  jobId: "job-1",
  videoTitle: "The Animal Cell",
  pointId: null,
  lectureSeconds: 201.4,
  createdAt: 1_700_000_000_000,
  durationMs: 4980,
  mimeType: "audio/webm;codecs=opus",
  sizeBytes: 10,
  label: "",
  silentWarning: false,
  ...over,
});
