// Integration tests for how Explanation.jsx is wired to the Voice Notes panel.
// The real Explanation runs; the YouTube player, the explanation/TTS API, the
// Audio element and the panel itself are stand-ins. These check Explanation's
// side of the contract (Alt+M, blocking playback while recording, the leave
// guard, "go to time", the cue point, and never auto-resuming after a pause for
// recording). They do not touch a real player, microphone or storage.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import Explanation from "./Explanation";

const h = vi.hoisted(() => {
  const players = [];
  class FakePlayer {
    constructor(_el, opts) {
      this.opts = opts;
      this.state = -1; // unstarted
      this.time = 0;
      this.pauseVideo = vi.fn(() => { this.state = 2; });
      this.playVideo = vi.fn(() => { this.state = 1; });
      this.seekTo = vi.fn();
      this.cueVideoById = vi.fn();
      this.getCurrentTime = vi.fn(() => this.time);
      this.getPlayerState = vi.fn(() => this.state);
      this.destroy = vi.fn();
      players.push(this);
      setTimeout(() => opts.events.onReady({ target: this }), 0);
    }
  }
  const stub = {
    props: null,
    control: null,
  };
  class FakeAudio {
    static last = null;
    constructor(url) {
      this.url = url;
      this.listeners = {};
      this.currentTime = 0;
      this.duration = 10;
      this.playbackRate = 1;
      this.play = vi.fn(() => Promise.resolve());
      this.pause = vi.fn();
      FakeAudio.last = this;
    }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    removeEventListener() {}
    emit(type) { (this.listeners[type] || []).forEach((fn) => fn()); }
  }
  return { players, FakePlayer, stub, FakeAudio };
});

vi.mock("../lib/youtubeIframeApi", () => ({
  loadYouTubeIframeAPI: () => Promise.resolve({ Player: h.FakePlayer, PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0, BUFFERING: 3 } }),
}));

vi.mock("../api", () => ({
  getInterventionPoints: vi.fn(async () => ({
    videoTitle: "The Animal Cell",
    duration: "19:13",
    author: "A. Teacher",
    points: [
      { id: "p1", category: "diagram", timestamp: "0:10", title: "First diagram" },
      { id: "p2", category: "graph", timestamp: "0:50", title: "Second graph" },
    ],
  })),
  getExplanation: vi.fn(async (pointId) => ({ pointId, subtitle: "A subtitle", paragraphs: ["Paragraph one."], keyInsight: "A key insight." })),
  getTTSExplanation: vi.fn(async () => ({ text_explanation: "x", audio_file_path: "blob:tts", output_mode: "standard" })),
}));

// The real panel is replaced by a stub that exposes the props Explanation gives it
// and registers a control object, exactly as the real panel does.
vi.mock("./VoiceNotes", () => ({
  default: function VoiceNotesStub(props) {
    h.stub.props = props;
    useEffect(() => {
      props.controlRef.current = h.stub.control;
      return () => { props.controlRef.current = null; };
    });
    return <div data-testid="voice-notes-stub" />;
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  h.players.length = 0;
  h.FakeAudio.last = null;
  h.stub.props = null;
  h.stub.control = {
    toggle: vi.fn(),
    lectureStarted: vi.fn(() => false),
    requestLeave: vi.fn((go) => go()),
  };
  vi.stubGlobal("Audio", h.FakeAudio);
  try { localStorage.clear(); } catch { /* ignore */ }
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const settle = (ms = 1000) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

async function open(props = {}) {
  const onNavigate = vi.fn();
  const onOpenTimeline = vi.fn();
  const utils = render(
    <Explanation jobId="job-1" videoId="5ugDJhmmkFM" mode="standard" onNavigate={onNavigate} onOpenTimeline={onOpenTimeline} {...props} />,
  );
  await settle();
  return { ...utils, onNavigate, onOpenTimeline, player: h.players[0] };
}

const altKey = (code, key) => fireEvent.keyDown(window, { code, key, altKey: true });

describe("Alt+M", () => {
  it("is listed with the other shortcuts, on the page", async () => {
    await open();
    expect(screen.getByText("Alt+M")).toBeTruthy();
    expect(screen.getByText(/Start or stop a voice note/)).toBeTruthy();
  });

  it("toggles the voice note recorder", async () => {
    await open();
    altKey("KeyM", "m");
    expect(h.stub.control.toggle).toHaveBeenCalledTimes(1);
  });

  it("works when the browser reports only the typed letter (assistive technology)", async () => {
    await open();
    fireEvent.keyDown(window, { key: "m", altKey: true, code: "" });
    expect(h.stub.control.toggle).toHaveBeenCalledTimes(1);
  });

  it("is ignored while typing in a text field", async () => {
    await open();
    const box = document.createElement("textarea");
    document.body.appendChild(box);
    fireEvent.keyDown(box, { code: "KeyM", key: "m", altKey: true });
    expect(h.stub.control.toggle).not.toHaveBeenCalled();
    box.remove();
  });

  it("does not disturb the existing shortcuts (Alt+K still reads the list, now including Alt+M)", async () => {
    await open();
    altKey("KeyK", "k");
    await settle(200);
    expect(screen.getByRole("status").textContent).toMatch(/Alt plus M: Start or stop a voice note\./);
  });
});

describe("what the panel is given", () => {
  it("reads the lecture time from the player", async () => {
    const { player } = await open();
    player.time = 55.5;
    expect(h.stub.props.getLectureSeconds()).toBe(55.5);
  });

  it("passes the lecture identity", async () => {
    await open();
    expect(h.stub.props).toMatchObject({ videoId: "5ugDJhmmkFM", jobId: "job-1", videoTitle: "The Animal Cell" });
  });

  it("gives the moment's id only while the learner has paused or selected one", async () => {
    const { player } = await open();
    expect(h.stub.props.getPointId()).toBeNull();
    act(() => { h.stub.props.pauseLectureAudio(); });
    expect(player.pauseVideo).toHaveBeenCalled();
    expect(h.stub.props.getPointId()).toBe("p1");
  });

  it("'go to time' seeks, pauses, and says so", async () => {
    const { player } = await open();
    act(() => { h.stub.props.onGoToTime(201.4); });
    await settle(200);
    expect(player.seekTo).toHaveBeenCalledWith(201.4, true);
    expect(player.pauseVideo).toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("Jumped to 3:21. Lecture paused.");
  });
});

describe("pausing for a voice note", () => {
  it("pauses the lecture AND the explanation audio", async () => {
    const { player } = await open();
    const audio = h.FakeAudio.last;
    act(() => { h.stub.props.pauseLectureAudio(); });
    expect(player.pauseVideo).toHaveBeenCalledTimes(1);
    expect(audio.pause).toHaveBeenCalled();
  });

  async function interventionThenAudioEnds({ pauseForRecording }) {
    const { player } = await open();
    const audio = h.FakeAudio.last;
    // The lecture is playing and reaches the first moment (0:10): Synapse auto-pauses it.
    player.state = 1;
    player.time = 10.1;
    await settle(400);
    expect(player.pauseVideo).toHaveBeenCalledTimes(1);
    player.playVideo.mockClear();

    if (pauseForRecording) act(() => { h.stub.props.pauseLectureAudio(); });
    audio.emit("ended"); // the explanation audio finishes
    await settle(100);
    return player;
  }

  it("control: without a voice note, finishing the explanation DOES resume the lecture (proves the test can see a resume)", async () => {
    const player = await interventionThenAudioEnds({ pauseForRecording: false });
    expect(player.playVideo).toHaveBeenCalled();
  });

  it("after pausing for a voice note, finishing the explanation does NOT resume the lecture", async () => {
    const player = await interventionThenAudioEnds({ pauseForRecording: true });
    expect(player.playVideo).not.toHaveBeenCalled();
  });

  it("the watcher does not auto-pause again while a voice note holds the pause", async () => {
    const { player } = await open();
    act(() => { h.stub.props.pauseLectureAudio(); });
    player.pauseVideo.mockClear();
    player.state = 1;
    player.time = 50.1; // at the second moment
    await settle(1000);
    expect(player.pauseVideo).not.toHaveBeenCalled();
  });
});

describe("playback is blocked while recording", () => {
  it("the lecture play control does nothing, and asks the panel (Alt+P)", async () => {
    const { player } = await open();
    h.stub.control.lectureStarted.mockReturnValue(true);
    altKey("KeyP", "p");
    expect(h.stub.control.lectureStarted).toHaveBeenCalled();
    expect(player.playVideo).not.toHaveBeenCalled();
  });

  it("the lecture plays as usual when not recording", async () => {
    const { player } = await open();
    h.stub.control.lectureStarted.mockReturnValue(false);
    altKey("KeyP", "p");
    expect(player.playVideo).toHaveBeenCalledTimes(1);
  });

  it("the explanation audio (Alt+L) does not start while recording", async () => {
    await open();
    const audio = h.FakeAudio.last;
    h.stub.control.lectureStarted.mockReturnValue(true);
    altKey("KeyL", "l");
    expect(audio.play).not.toHaveBeenCalled();
  });

  it("the explanation audio starts as usual when not recording", async () => {
    await open();
    const audio = h.FakeAudio.last;
    altKey("KeyL", "l");
    expect(audio.play).toHaveBeenCalled();
  });

  it("a lecture that starts playing by itself (the YouTube controls) is reported to the panel", async () => {
    const { player } = await open();
    act(() => { player.opts.events.onStateChange({ data: 1 }); });
    expect(h.stub.control.lectureStarted).toHaveBeenCalled();
  });

  it("other player states are not reported as the lecture starting", async () => {
    const { player } = await open();
    h.stub.control.lectureStarted.mockClear();
    act(() => { player.opts.events.onStateChange({ data: 2 }); });
    act(() => { player.opts.events.onStateChange({ data: 3 }); });
    expect(h.stub.control.lectureStarted).not.toHaveBeenCalled();
  });
});

describe("leaving the screen", () => {
  it("every way out goes through the panel first (sidebar)", async () => {
    const { onNavigate } = await open();
    h.stub.control.requestLeave.mockImplementation(() => {}); // the panel is asking the learner
    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    expect(h.stub.control.requestLeave).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("navigates once the panel says it is fine", async () => {
    const { onNavigate } = await open();
    fireEvent.click(screen.getByRole("button", { name: "Voice notes" }));
    expect(onNavigate).toHaveBeenCalledWith("notes");
  });

  it("the panel can hold the navigation and release it later", async () => {
    const { onNavigate } = await open();
    let release;
    h.stub.control.requestLeave.mockImplementation((go) => { release = go; });
    fireEvent.click(screen.getByRole("button", { name: "Bookmarks" }));
    expect(onNavigate).not.toHaveBeenCalled();
    release();
    expect(onNavigate).toHaveBeenCalledWith("bookmarks");
  });

  it("works when the panel is not mounted (navigates directly)", async () => {
    const { onNavigate } = await open();
    h.stub.control = null;
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(onNavigate).toHaveBeenCalledWith("home");
  });
});

describe("opening a lecture at a voice note's time (startSeconds)", () => {
  it("cues the lecture at that exact time, not at the moment's own timestamp", async () => {
    const { player } = await open({ pointId: "p2", startSeconds: 201.4 });
    expect(player.cueVideoById).toHaveBeenCalledWith({ videoId: "5ugDJhmmkFM", startSeconds: 201.4 });
    expect(player.playVideo).not.toHaveBeenCalled(); // cued, never played
  });

  it("without startSeconds the old behaviour is unchanged (cue at the moment's timestamp)", async () => {
    const { player } = await open({ pointId: "p2" });
    expect(player.cueVideoById).toHaveBeenCalledWith({ videoId: "5ugDJhmmkFM", startSeconds: 50 });
  });

  it("opening neither a moment nor a time does not cue anything", async () => {
    const { player } = await open();
    expect(player.cueVideoById).not.toHaveBeenCalled();
  });

  it("works for a note that has no moment (cues at its time once the moments have loaded)", async () => {
    const { player } = await open({ startSeconds: 120 });
    expect(player.cueVideoById).toHaveBeenCalledWith({ videoId: "5ugDJhmmkFM", startSeconds: 120 });
  });

  it("a note taken at a moment's own time does not make the first Play auto-pause there again", async () => {
    const { player } = await open({ pointId: "p2", startSeconds: 50.2 });
    player.state = 1;
    player.time = 50.2;
    await settle(1000);
    expect(player.pauseVideo).not.toHaveBeenCalled();
  });

  it("the same holds for a note opened WITHOUT its moment id (the cue time itself is checked)", async () => {
    const { player } = await open({ startSeconds: 50.2 });
    player.state = 1;
    player.time = 50.2;
    await settle(1000);
    expect(player.pauseVideo).not.toHaveBeenCalled();
  });

  it("but a later moment still pauses normally", async () => {
    const { player } = await open({ pointId: "p1", startSeconds: 10.2 });
    player.state = 1;
    player.time = 50.1; // the second moment
    await settle(400);
    expect(player.pauseVideo).toHaveBeenCalledTimes(1);
  });

  it("cues only once", async () => {
    const { player, rerender } = await open({ pointId: "p2", startSeconds: 201.4 });
    rerender(<Explanation jobId="job-1" videoId="5ugDJhmmkFM" mode="standard" pointId="p2" startSeconds={201.4} />);
    await settle();
    expect(player.cueVideoById).toHaveBeenCalledTimes(1);
  });
});
