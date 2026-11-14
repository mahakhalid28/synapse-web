// The voice-notes panel's side of Help: refuse while the microphone is in use, stop a note that is
// playing, and never disturb a recording. The microphone, MediaRecorder and storage are the same
// hand-written fakes the panel's other tests use (src/test/recorderFakes.js); nothing here is real
// audio hardware.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import VoiceNotes from "./VoiceNotes";
import { SETTLE_MS } from "../hooks/useVoiceRecorder.js";
import { makeRecorderEnv, makeNote } from "../test/recorderFakes.js";
import "../test/domMatchers.js";

beforeEach(() => {
  vi.useFakeTimers();
  URL.createObjectURL = vi.fn(() => "blob:fake/1");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
  delete URL.createObjectURL;
  delete URL.revokeObjectURL;
});

const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

async function setup({ notes = [], loadAudio } = {}) {
  const env = makeRecorderEnv();
  const controlRef = { current: null };
  const audios = [];
  const props = {
    videoId: "5ugDJhmmkFM",
    jobId: "job-1",
    videoTitle: "The Animal Cell",
    getLectureSeconds: vi.fn(() => 201.4),
    getPointId: () => null,
    pauseLectureAudio: vi.fn(),
    announce: vi.fn(),
    onGoToTime: vi.fn(),
    controlRef,
    listNotes: vi.fn(async () => notes),
    deleteNote: vi.fn(async () => true),
    recorderOptions: { store: env.store, deps: env.deps },
    playerOptions: {
      loadAudio: loadAudio ?? vi.fn(async () => new Blob(["x"], { type: "audio/webm" })),
      createAudio: vi.fn((url) => {
        const a = { url, play: vi.fn(async () => {}), pause: vi.fn(), onended: null, onerror: null };
        audios.push(a);
        return a;
      }),
    },
  };
  const utils = render(<VoiceNotes {...props} />);
  await advance(0);
  return { ...utils, env, props, controlRef, audios };
}

const recordButton = () =>
  screen.getByRole("button", { name: /^(record voice note|stop recording|cancel recording|saving voice note)$/i });
const said = (props) => props.announce.mock.calls.map((c) => c[0]);

describe("Help while nothing is happening", () => {
  it("is allowed and changes nothing", async () => {
    const { controlRef, props } = await setup();
    expect(controlRef.current.beforeHelp()).toEqual({ blocked: false, stoppedNote: false });
    expect(props.pauseLectureAudio).not.toHaveBeenCalled();
    expect(recordButton()).toHaveAccessibleName("Record voice note");
  });
});

describe("Help during recording preparation or recording is refused, and the recording is left alone", () => {
  it("while preparing: refused; the microphone is not released and recording still starts", async () => {
    const { controlRef } = await setup();
    await act(async () => { fireEvent.click(recordButton()); });
    expect(recordButton()).toHaveAccessibleName("Cancel recording"); // preparing, waiting out the settle

    expect(controlRef.current.beforeHelp()).toEqual({ blocked: true, stoppedNote: false });
    expect(recordButton()).toHaveAccessibleName("Cancel recording");

    await advance(SETTLE_MS);
    expect(recordButton()).toHaveAccessibleName("Stop recording"); // it went on to record
  });

  it("while recording: refused; the recording continues and can still be stopped and saved", async () => {
    const { controlRef, props } = await setup();
    await act(async () => { fireEvent.click(recordButton()); });
    await advance(SETTLE_MS);
    expect(recordButton()).toHaveAccessibleName("Stop recording");

    expect(controlRef.current.beforeHelp()).toEqual({ blocked: true, stoppedNote: false });
    expect(controlRef.current.beforeHelp()).toEqual({ blocked: true, stoppedNote: false });
    expect(recordButton()).toHaveAccessibleName("Stop recording");

    await advance(1500);
    await act(async () => { fireEvent.click(recordButton()); });
    await advance(0);
    expect(said(props).some((m) => /voice note saved/i.test(m))).toBe(true);
  });

  it("refusing says nothing itself: the lecture screen announces the reason", async () => {
    const { controlRef, props } = await setup();
    await act(async () => { fireEvent.click(recordButton()); });
    await advance(SETTLE_MS);
    const before = props.announce.mock.calls.length;
    controlRef.current.beforeHelp();
    expect(props.announce.mock.calls.length).toBe(before);
  });
});

describe("Help while a voice note is playing", () => {
  const NOTE = () => makeNote({ lectureSeconds: 201.4 });

  it("stops it (what its own Stop button does), reports that, and never restarts it", async () => {
    const { controlRef, audios } = await setup({ notes: [NOTE()] });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Play Voice note at 3:21" })); });
    await advance(0);
    expect(audios).toHaveLength(1);
    expect(audios[0].play).toHaveBeenCalledTimes(1);

    let result;
    act(() => { result = controlRef.current.beforeHelp(); });
    expect(result).toEqual({ blocked: false, stoppedNote: true });
    expect(audios[0].pause).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Play Voice note at 3:21" })).toHaveAttribute("aria-pressed", "false");

    await advance(500);
    expect(audios).toHaveLength(1);
    expect(audios[0].play).toHaveBeenCalledTimes(1);
  });

  it("stops a note that is still loading, so it never starts under Help", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { controlRef, audios } = await setup({ notes: [NOTE()], loadAudio: vi.fn(() => gate) });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Play Voice note at 3:21" })); });
    expect(audios).toHaveLength(0);

    let result;
    act(() => { result = controlRef.current.beforeHelp(); });
    expect(result).toEqual({ blocked: false, stoppedNote: true });

    release(new Blob(["x"]));
    await advance(100);
    expect(audios).toHaveLength(0); // no audio element was ever created or played
  });

  it("does nothing to saved notes and does not call the lecture pause", async () => {
    const { controlRef, props } = await setup({ notes: [NOTE()] });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Play Voice note at 3:21" })); });
    await advance(0);
    props.pauseLectureAudio.mockClear();
    act(() => { controlRef.current.beforeHelp(); });
    expect(props.deleteNote).not.toHaveBeenCalled();
    expect(props.pauseLectureAudio).not.toHaveBeenCalled();
    expect(screen.getByText("Voice note at 3:21")).toBeTruthy();
  });
});
