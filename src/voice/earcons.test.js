import { describe, it, expect, vi, beforeEach } from "vitest";
import { EARCONS, CUES_KEY, playEarcon } from "./earcons";
import { createSpeaker, resetSpeechMemory } from "./voiceSpeech";

beforeEach(() => {
  localStorage.clear();
  resetSpeechMemory();
});

describe("earcons", () => {
  it("give each outcome its own sound, none of them the microphone tones", () => {
    const shapes = Object.values(EARCONS).map((notes) => notes.join(","));
    expect(new Set(shapes).size).toBe(shapes.length);
    for (const notes of Object.values(EARCONS)) {
      expect(notes).not.toContain(880);
      expect(notes).not.toContain(587);
    }
    expect(EARCONS.done[1]).toBeGreaterThan(EARCONS.done[0]); // rising: success
    expect(EARCONS.error[1]).toBeLessThan(EARCONS.error[0]); // falling: failure
  });

  it("play the notes for a known cue", async () => {
    const play = vi.fn(async () => {});
    await playEarcon("ready", { play });
    expect(play).toHaveBeenCalledWith(EARCONS.ready);
  });

  it("stay silent for an unknown cue or when the learner turned cues off", async () => {
    const play = vi.fn(async () => {});
    await playEarcon("fanfare", { play });
    localStorage.setItem(CUES_KEY, "off");
    await playEarcon("done", { play });
    expect(play).not.toHaveBeenCalled();
  });
});

describe("the speaker's fallback voice", () => {
  const failingServer = () => Promise.reject(new Error("server down"));

  it("uses the system voice when the backend voice fails, and does not also announce", async () => {
    const announce = vi.fn();
    const fallbackSpeech = vi.fn(() => ({ done: Promise.resolve(true), cancel: vi.fn() }));
    const speaker = createSpeaker({ announce, speakText: failingServer, fallbackSpeech, mode: () => "tts" });
    await speaker.say("Opening   your bookmarks.");
    expect(fallbackSpeech).toHaveBeenCalledWith("Opening your bookmarks.");
    expect(announce).not.toHaveBeenCalled();
  });

  it("announces to the screen reader when the system voice is missing or fails", async () => {
    const announce = vi.fn();
    const none = createSpeaker({ announce, speakText: failingServer, fallbackSpeech: () => null, mode: () => "tts" });
    await none.say("First.");
    const failing = createSpeaker({ announce, speakText: failingServer,
      fallbackSpeech: () => ({ done: Promise.resolve(false), cancel: vi.fn() }), mode: () => "tts" });
    await failing.say("Second.");
    expect(announce.mock.calls.map(([text]) => text)).toEqual(["First.", "Second."]);
  });

  it("can be stopped like any reply (the next voice turn interrupts it)", async () => {
    const announce = vi.fn();
    let finish;
    const cancel = vi.fn(() => finish(false));
    const fallbackSpeech = () => ({ done: new Promise((resolve) => { finish = resolve; }), cancel });
    const speaker = createSpeaker({ announce, speakText: failingServer, fallbackSpeech, mode: () => "tts" });
    const saying = speaker.say("A long reply.");
    await Promise.resolve();
    await Promise.resolve();
    expect(speaker.isSpeaking()).toBe(true);
    speaker.stop();
    await saying;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(announce).not.toHaveBeenCalled();
    expect(speaker.isSpeaking()).toBe(false);
  });
});
