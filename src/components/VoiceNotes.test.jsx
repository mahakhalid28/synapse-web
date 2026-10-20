// Component tests for the per-lecture Voice Notes panel. The microphone,
// MediaRecorder and storage are hand-written fakes (src/test/recorderFakes.js),
// so these check the panel's behaviour (announcements, focus, pausing, saving,
// the leave prompt, deleting), not real recording or real IndexedDB.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { axe } from "jest-axe";
import VoiceNotes from "./VoiceNotes";
import { SETTLE_MS } from "../hooks/useVoiceRecorder.js";
import { makeRecorderEnv, makeNote } from "../test/recorderFakes.js";
import "../test/domMatchers.js";

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:fake/1");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
  delete URL.createObjectURL;
  delete URL.revokeObjectURL;
});

const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

async function setup(over = {}) {
  const env = makeRecorderEnv(over.env);
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
    listNotes: vi.fn(async () => over.notes ?? []),
    deleteNote: vi.fn(async () => true),
    recorderOptions: { store: env.store, deps: env.deps },
    playerOptions: {
      loadAudio: vi.fn(async () => new Blob(["x"], { type: "audio/webm" })),
      createAudio: vi.fn((url) => {
        const a = { url, play: vi.fn(async () => {}), pause: vi.fn(), onended: null, onerror: null };
        audios.push(a);
        return a;
      }),
    },
    ...over.props,
  };
  const utils = render(<VoiceNotes {...props} />);
  await advance(0);
  return { ...utils, env, props, controlRef, audios };
}

const recordButton = () => screen.getByRole("button", { name: /^(record voice note|stop recording|cancel recording|saving voice note)$/i });
const said = (props) => props.announce.mock.calls.map((c) => c[0]);

async function startRecording() {
  recordButton().focus();
  await act(async () => { fireEvent.click(recordButton()); });
  await advance(SETTLE_MS);
}

describe("panel basics", () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it("has a heading, local-only and headphones advice, and the record button with its shortcut", async () => {
    await setup();
    expect(screen.getByRole("heading", { level: 2, name: "Voice notes" })).toBeInTheDocument();
    expect(screen.getByText(/stay on this computer/i)).toBeInTheDocument();
    expect(screen.getByText(/headphones/i)).toBeInTheDocument();
    const button = recordButton();
    expect(button).toHaveAccessibleName("Record voice note");
    expect(button).toHaveAttribute("aria-keyshortcuts", "Alt+M");
    expect(screen.getByText("No voice notes for this lecture yet.")).toBeInTheDocument();
  });

  it("lists this lecture's notes, newest first, with readable names", async () => {
    await setup({
      notes: [
        makeNote({ id: "old", createdAt: 100, lectureSeconds: 61 }),
        makeNote({ id: "new", createdAt: 200, lectureSeconds: 125, label: "Ask about the nucleus" }),
      ],
    });
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("Ask about the nucleus")).toBeInTheDocument();
    expect(within(items[1]).getByText("Voice note at 1:01")).toBeInTheDocument();
    expect(screen.getByText("2 voice notes for this lecture.")).toBeInTheDocument();
  });

  it("shows a warning on a note that may be silent", async () => {
    await setup({ notes: [makeNote({ silentWarning: true })] });
    expect(screen.getByText("Warning: this recording may be silent.")).toBeInTheDocument();
  });

  it("explains a load failure and can try again", async () => {
    let fail = true;
    const listNotes = vi.fn(async () => {
      if (fail) throw new Error("Voice notes can't be stored here: this environment has no IndexedDB.");
      return [makeNote()];
    });
    await setup({ props: { listNotes } });
    expect(screen.getByText(/no IndexedDB/)).toBeInTheDocument();
    fail = false;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    await advance(0);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("'Go to' sends the note's lecture time to the lecture", async () => {
    const { props } = await setup({ notes: [makeNote({ lectureSeconds: 201.4 })] });
    fireEvent.click(screen.getByRole("button", { name: "Go to 3:21 in lecture, Voice note at 3:21" }));
    expect(props.onGoToTime).toHaveBeenCalledWith(201.4);
  });
});

describe("recording", () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it("pauses the lecture, announces, waits, records, and saves on stop; focus stays on the same button", async () => {
    const { props, env } = await setup();
    await startRecording();

    expect(props.pauseLectureAudio).toHaveBeenCalledTimes(1);
    expect(said(props)[0]).toBe("Lecture paused. Recording starts after the tone.");
    expect(recordButton()).toHaveAccessibleName("Stop recording");
    expect(document.activeElement).toBe(recordButton());
    expect(screen.getByText(/Recording: 0:0\d of 5:00/)).toBeInTheDocument();

    await advance(5000);
    await act(async () => { fireEvent.click(recordButton()); await vi.advanceTimersByTimeAsync(0); });

    expect(env.saved).toHaveLength(1);
    expect(env.saved[0]).toMatchObject({ videoId: "5ugDJhmmkFM", lectureSeconds: 201.4, durationMs: 5000, label: "" });
    expect(recordButton()).toHaveAccessibleName("Record voice note");
    expect(document.activeElement).toBe(recordButton());
    expect(said(props).at(-1)).toBe("Voice note saved at 3:21, 5 seconds. The lecture is still paused.");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Voice note at 3:21")).toBeInTheDocument();
    expect(props.pauseLectureAudio).toHaveBeenCalledTimes(1); // stopping never touches the lecture
  });

  it("says nothing while the recording is running (a screen reader would be recorded)", async () => {
    const { props } = await setup();
    await startRecording();
    const before = said(props).length;
    await advance(20000);
    expect(said(props)).toHaveLength(before);
  });

  it("the visible status is not a live region", async () => {
    await setup();
    const status = document.getElementById("voice-notes-status");
    expect(status.closest("[aria-live]")).toBeNull();
    expect(status).not.toHaveAttribute("role");
  });

  it("the button is described by the status text", async () => {
    await setup();
    expect(recordButton()).toHaveAccessibleDescription(/Ready\. Press the button or Alt\+M/);
  });

  it("shows a clear message and leaves the lecture paused when the microphone is blocked", async () => {
    const getUserMedia = vi.fn(async () => { throw Object.assign(new Error("x"), { name: "NotAllowedError" }); });
    const { props } = await setup({ env: { deps: { getUserMedia } } });
    await startRecording();
    expect(screen.getByText(/Let desktop apps access your microphone/)).toBeInTheDocument();
    expect(said(props).at(-1)).toMatch(/still paused\.$/);
    expect(recordButton()).toHaveAccessibleName("Record voice note");
  });

  it("refuses to record when the player time is unknown, and says why", async () => {
    const { props } = await setup({ props: { getLectureSeconds: vi.fn(() => undefined) } });
    await startRecording();
    expect(props.pauseLectureAudio).not.toHaveBeenCalled();
    expect(screen.getByText(/lecture player isn't ready/)).toBeInTheDocument();
  });

  it("a failed save keeps the audio and offers Retry or Discard", async () => {
    let failing = true;
    const saveNote = vi.fn(async (note, blob) => {
      if (failing) throw Object.assign(new Error("There is not enough storage space to save this voice note."), { code: "quota" });
      return { ...note, sizeBytes: blob.size };
    });
    const { props } = await setup({ env: { store: { saveNote } } });
    await startRecording();
    await advance(3000);
    await act(async () => { fireEvent.click(recordButton()); await vi.advanceTimersByTimeAsync(0); });

    expect(screen.getByRole("heading", { name: "Unsaved voice note" })).toBeInTheDocument();
    expect(screen.getByText(/not enough storage space/)).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Unsaved voice note" }));
    expect(recordButton()).toHaveAttribute("aria-disabled", "true");
    expect(said(props).at(-1)).toMatch(/Choose Retry or Discard\.$/);

    failing = false;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry saving" })); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.queryByRole("heading", { name: "Unsaved voice note" })).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("Discard after a failed save drops the recording", async () => {
    const saveNote = vi.fn(async () => { throw new Error("nope"); });
    const { props } = await setup({ env: { store: { saveNote } } });
    await startRecording();
    await advance(3000);
    await act(async () => { fireEvent.click(recordButton()); await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByRole("heading", { name: "Unsaved voice note" })).toBeNull();
    expect(said(props).at(-1)).toBe("Recording discarded.");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});

describe("control object used by the lecture screen", () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it("toggle() records and stops (the Alt+M path)", async () => {
    const { controlRef, env } = await setup();
    act(() => { void controlRef.current.toggle(); });
    await advance(SETTLE_MS);
    expect(recordButton()).toHaveAccessibleName("Stop recording");
    await advance(2000);
    await act(async () => { await controlRef.current.toggle(); });
    expect(env.saved).toHaveLength(1);
  });

  it("lectureStarted() while recording pauses again, explains, and reports 'blocked'", async () => {
    const { controlRef, props } = await setup();
    await startRecording();
    let blocked;
    act(() => { blocked = controlRef.current.lectureStarted(); });
    expect(blocked).toBe(true);
    expect(props.pauseLectureAudio).toHaveBeenCalledTimes(2);
    expect(said(props).at(-1)).toBe("The lecture was paused again because it can't play while you record.");
  });

  it("lectureStarted() while idle does not interfere and reports 'not blocked'", async () => {
    const { controlRef, props } = await setup();
    let blocked;
    act(() => { blocked = controlRef.current.lectureStarted(); });
    expect(blocked).toBe(false);
    expect(props.pauseLectureAudio).not.toHaveBeenCalled();
    expect(said(props)).toEqual([]);
  });

  it("lectureStarted() stops a voice note that is playing (the learner chose the lecture)", async () => {
    const { controlRef, audios } = await setup({ notes: [makeNote()] });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Play Voice note at 3:21" })); await vi.advanceTimersByTimeAsync(0); });
    expect(audios[0].play).toHaveBeenCalled();
    act(() => { controlRef.current.lectureStarted(); });
    expect(audios[0].pause).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Play Voice note at 3:21" })).toHaveAttribute("aria-pressed", "false");
  });

  it("clears the control object when the panel unmounts", async () => {
    const { controlRef, unmount } = await setup();
    expect(controlRef.current).not.toBeNull();
    unmount();
    expect(controlRef.current).toBeNull();
  });
});

describe("leaving the screen", () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it("goes straight through when nothing is being recorded", async () => {
    const { controlRef } = await setup();
    const go = vi.fn();
    await act(async () => { await controlRef.current.requestLeave(go); });
    expect(go).toHaveBeenCalledTimes(1);
  });

  async function leaveWhileRecording() {
    const ctx = await setup();
    await startRecording();
    await advance(4000);
    const go = vi.fn();
    await act(async () => { await ctx.controlRef.current.requestLeave(go); });
    return { ...ctx, go };
  }

  it("stops the microphone, does NOT leave yet, saves nothing, and asks with focus on the question", async () => {
    const { go, env, props } = await leaveWhileRecording();
    expect(go).not.toHaveBeenCalled();
    expect(env.saved).toHaveLength(0);
    expect(env.tracks[0].stop).toHaveBeenCalled();
    const heading = screen.getByRole("heading", { name: "Save your voice note before leaving?" });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByRole("button", { name: "Save and leave" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard and leave" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stay on this screen" })).toBeInTheDocument();
    expect(screen.getByText(/Recorded 4 seconds at 3:21/)).toBeInTheDocument();
    expect(said(props).at(-1)).toBe("Recording stopped. Choose Save or Discard.");
  });

  it("'Save and leave' saves, then leaves", async () => {
    const { go, env } = await leaveWhileRecording();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save and leave" })); await vi.advanceTimersByTimeAsync(0); });
    expect(env.saved).toHaveLength(1);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("'Save and leave' does not leave if the save fails", async () => {
    const saveNote = vi.fn(async () => { throw new Error("disk full"); });
    const ctx = await setup({ env: { store: { saveNote } } });
    await startRecording();
    await advance(4000);
    const go = vi.fn();
    await act(async () => { await ctx.controlRef.current.requestLeave(go); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save and leave" })); await vi.advanceTimersByTimeAsync(0); });
    expect(go).not.toHaveBeenCalled();
    expect(screen.getByText("disk full")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save and leave" })).toBeInTheDocument(); // can try again
  });

  it("'Discard and leave' leaves without saving", async () => {
    const { go, env } = await leaveWhileRecording();
    fireEvent.click(screen.getByRole("button", { name: "Discard and leave" }));
    expect(go).toHaveBeenCalledTimes(1);
    expect(env.saved).toHaveLength(0);
  });

  it("'Stay on this screen' keeps the recording as an unsaved note and does not leave", async () => {
    const { go, env } = await leaveWhileRecording();
    fireEvent.click(screen.getByRole("button", { name: "Stay on this screen" }));
    expect(go).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Unsaved voice note" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stay on this screen" })).toBeNull();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save note" })); await vi.advanceTimersByTimeAsync(0); });
    expect(env.saved).toHaveLength(1);
    expect(go).not.toHaveBeenCalled(); // saving after staying never navigates
  });

  it("cancels a recording that has not started yet and leaves", async () => {
    const { controlRef, env } = await setup();
    await act(async () => { fireEvent.click(recordButton()); });
    await advance(300); // still in the settle delay
    const go = vi.fn();
    await act(async () => { await controlRef.current.requestLeave(go); });
    expect(go).toHaveBeenCalledTimes(1);
    expect(env.saved).toHaveLength(0);
    expect(env.tracks[0].stop).toHaveBeenCalled();
  });

  it("an accidental, too-short recording does not block leaving", async () => {
    const ctx = await setup();
    await startRecording();
    await advance(100);
    const go = vi.fn();
    await act(async () => { await ctx.controlRef.current.requestLeave(go); });
    expect(go).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: /Save your voice note/ })).toBeNull();
  });

  it("waits while a note is being saved, and says so", async () => {
    let finish;
    const saveNote = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const ctx = await setup({ env: { store: { saveNote } } });
    await startRecording();
    await advance(3000);
    await act(async () => { fireEvent.click(recordButton()); await vi.advanceTimersByTimeAsync(0); });
    expect(recordButton()).toHaveAccessibleName("Saving voice note");

    const go = vi.fn();
    await act(async () => { await ctx.controlRef.current.requestLeave(go); });
    expect(go).not.toHaveBeenCalled();
    expect(said(ctx.props).at(-1)).toBe("Saving your voice note. Try again in a moment.");

    await act(async () => { finish({ id: "x", lectureSeconds: 201.4, durationMs: 3000 }); await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await ctx.controlRef.current.requestLeave(go); });
    expect(go).toHaveBeenCalledTimes(1);
  });
});

describe("playing a note", () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it("pauses the lecture first and uses aria-pressed with a constant name", async () => {
    const { props, audios } = await setup({ notes: [makeNote()] });
    const play = screen.getByRole("button", { name: "Play Voice note at 3:21" });
    expect(play).toHaveAttribute("aria-pressed", "false");
    await act(async () => { fireEvent.click(play); await vi.advanceTimersByTimeAsync(0); });
    expect(props.pauseLectureAudio).toHaveBeenCalledTimes(1);
    expect(audios[0].play).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Play Voice note at 3:21" })).toHaveAttribute("aria-pressed", "true");
    expect(props.announce).not.toHaveBeenCalled(); // nothing spoken over the start of the recording
  });

  it("announces when it finishes", async () => {
    const { props, audios } = await setup({ notes: [makeNote()] });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Play Voice note at 3:21" })); await vi.advanceTimersByTimeAsync(0); });
    act(() => { audios[0].onended(); });
    expect(said(props)).toEqual(["Finished playing voice note."]);
  });
});

describe("deleting a note", () => {
  beforeEach(() => { vi.useFakeTimers(); });

  const three = () => [
    makeNote({ id: "a", createdAt: 300, label: "Third" }),
    makeNote({ id: "b", createdAt: 200, label: "Second" }),
    makeNote({ id: "c", createdAt: 100, label: "First" }),
  ];

  it("asks first, inline, with focus on Cancel", async () => {
    const { props } = await setup({ notes: three() });
    fireEvent.click(screen.getByRole("button", { name: "Delete Second" }));
    const group = screen.getByRole("group", { name: "Confirm deleting Second" });
    expect(within(group).getByText(/can.t be undone/)).toBeInTheDocument();
    expect(document.activeElement).toBe(within(group).getByRole("button", { name: "Cancel" }));
    expect(props.deleteNote).not.toHaveBeenCalled();
  });

  it("Cancel puts focus back on that note's Delete button and deletes nothing", async () => {
    const { props } = await setup({ notes: three() });
    fireEvent.click(screen.getByRole("button", { name: "Delete Second" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await advance(0);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete Second" }));
    expect(props.deleteNote).not.toHaveBeenCalled();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("confirming deletes it, announces how many are left, and moves focus to the next note", async () => {
    const { props } = await setup({ notes: three() });
    fireEvent.click(screen.getByRole("button", { name: "Delete Second" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yes, delete" })); await vi.advanceTimersByTimeAsync(0); });

    expect(props.deleteNote).toHaveBeenCalledWith("b");
    expect(screen.queryByText("Second")).toBeNull();
    expect(said(props).at(-1)).toBe("Deleted Second. 2 left.");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete First" }));
  });

  it("deleting the last note in the list moves focus to the previous one", async () => {
    await setup({ notes: three() });
    fireEvent.click(screen.getByRole("button", { name: "Delete First" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yes, delete" })); await vi.advanceTimersByTimeAsync(0); });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete Second" }));
  });

  it("deleting the only note says none are left and focuses the panel heading", async () => {
    const { props } = await setup({ notes: [makeNote({ label: "Only" })] });
    fireEvent.click(screen.getByRole("button", { name: "Delete Only" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yes, delete" })); await vi.advanceTimersByTimeAsync(0); });
    expect(said(props).at(-1)).toBe("Deleted Only. No voice notes left.");
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2, name: "Voice notes" }));
    expect(screen.getByText("No voice notes for this lecture yet.")).toBeInTheDocument();
  });

  it("a failed delete keeps the note, says so, and returns focus to its Delete button", async () => {
    const { props } = await setup({ notes: three(), props: { deleteNote: vi.fn(async () => { throw new Error("Could not delete the voice note."); }) } });
    fireEvent.click(screen.getByRole("button", { name: "Delete Second" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yes, delete" })); await vi.advanceTimersByTimeAsync(0); });
    await advance(0);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(said(props).at(-1)).toBe("Could not delete Second. Could not delete the voice note.");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete Second" }));
  });

  it("a double click on 'Yes, delete' deletes once", async () => {
    const { props } = await setup({ notes: three() });
    fireEvent.click(screen.getByRole("button", { name: "Delete Second" }));
    const yes = screen.getByRole("button", { name: "Yes, delete" });
    await act(async () => { fireEvent.click(yes); fireEvent.click(yes); await vi.advanceTimersByTimeAsync(0); });
    expect(props.deleteNote).toHaveBeenCalledTimes(1);
  });

  it("deleting the note that is playing stops it first", async () => {
    const { audios } = await setup({ notes: three() });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Play Second" })); await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByRole("button", { name: "Delete Second" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yes, delete" })); await vi.advanceTimersByTimeAsync(0); });
    expect(audios[0].pause).toHaveBeenCalled();
  });
});

describe("accessibility (axe)", () => {
  it("has no violations with notes listed", async () => {
    const env = makeRecorderEnv();
    const { container } = render(
      <VoiceNotes
        videoId="v" getLectureSeconds={() => 5} pauseLectureAudio={() => {}} announce={() => {}} onGoToTime={() => {}}
        listNotes={async () => [makeNote({ label: "One" }), makeNote({ id: "n2", label: "Two", silentWarning: true })]}
        recorderOptions={{ store: env.store, deps: env.deps }}
      />,
    );
    await screen.findByText("2 voice notes for this lecture.");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no violations while a delete is being confirmed", async () => {
    const env = makeRecorderEnv();
    const { container } = render(
      <VoiceNotes
        videoId="v" getLectureSeconds={() => 5} pauseLectureAudio={() => {}} announce={() => {}} onGoToTime={() => {}}
        listNotes={async () => [makeNote({ label: "One" })]}
        recorderOptions={{ store: env.store, deps: env.deps }}
      />,
    );
    await screen.findByText("1 voice note for this lecture.");
    fireEvent.click(screen.getByRole("button", { name: "Delete One" }));
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no violations when a load error is shown", async () => {
    const env = makeRecorderEnv();
    const { container } = render(
      <VoiceNotes
        videoId="v" getLectureSeconds={() => 5} pauseLectureAudio={() => {}} announce={() => {}} onGoToTime={() => {}}
        listNotes={async () => { throw new Error("boom"); }}
        recorderOptions={{ store: env.store, deps: env.deps }}
      />,
    );
    await screen.findByText("boom");
    expect(await axe(container)).toHaveNoViolations();
  });
});
