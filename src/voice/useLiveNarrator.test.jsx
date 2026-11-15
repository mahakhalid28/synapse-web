// The live-region narrator: screen announcements become speech for learners without a screen reader.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useLiveNarrator, QUIET_AFTER_SCREEN_MS } from "./useLiveNarrator";
import { createSpeaker, resetSpeechMemory } from "./voiceSpeech";

const settle = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

function Narrated({ speaker, canSpeak, screen = "home", children }) {
  useLiveNarrator({ speaker, canSpeak, screen });
  return children;
}

function Page({ status = "", alert = "", ignoredText = "", showInserted = false, speaker, canSpeak, screen }) {
  return (
    <Narrated speaker={speaker} canSpeak={canSpeak} screen={screen}>
      <p role="status">{status}</p>
      <div aria-live="assertive">{alert}</div>
      <div role="status" data-voice-ignore="">{ignoredText}</div>
      {showInserted && <p role="status">Saved to your library.</p>}
    </Narrated>
  );
}

let speaker;
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem("synapse_voice_feedback", "tts");
  resetSpeechMemory();
  speaker = { say: vi.fn() };
});
afterEach(() => vi.useRealTimers());

describe("useLiveNarrator", () => {
  it("speaks a new polite status message once nothing else is speaking", async () => {
    const { rerender } = render(<Page speaker={speaker} />);
    await settle(QUIET_AFTER_SCREEN_MS);
    rerender(<Page speaker={speaker} status="8 lectures found." />);
    await settle(300);
    expect(speaker.say).toHaveBeenCalledWith("8 lectures found.");
  });

  it("does not read what was already on screen when it started", async () => {
    render(<Page speaker={speaker} status="Verifying your saved session…" />);
    await settle(1000);
    expect(speaker.say).not.toHaveBeenCalled();
  });

  it("speaks alerts at once", async () => {
    const { rerender } = render(<Page speaker={speaker} />);
    rerender(<Page speaker={speaker} alert="The microphone stopped working." />);
    await settle(0);
    expect(speaker.say).toHaveBeenCalledWith("The microphone stopped working.");
  });

  it("ignores regions marked data-voice-ignore", async () => {
    const { rerender } = render(<Page speaker={speaker} />);
    await settle(QUIET_AFTER_SCREEN_MS);
    rerender(<Page speaker={speaker} ignoredText="Okay, open your bookmarks." />);
    await settle(500);
    expect(speaker.say).not.toHaveBeenCalled();
  });

  it("stays quiet in screen-reader feedback mode", async () => {
    localStorage.setItem("synapse_voice_feedback", "screenreader");
    const { rerender } = render(<Page speaker={speaker} />);
    await settle(QUIET_AFTER_SCREEN_MS);
    rerender(<Page speaker={speaker} status="8 lectures found." alert="Something failed." />);
    await settle(500);
    expect(speaker.say).not.toHaveBeenCalled();
  });

  it("holds a message while the microphone is busy and speaks it afterwards", async () => {
    let busy = true;
    const { rerender } = render(<Page speaker={speaker} canSpeak={() => !busy} />);
    await settle(QUIET_AFTER_SCREEN_MS);
    rerender(<Page speaker={speaker} canSpeak={() => !busy} status="Explanation bookmarked." />);
    await settle(600);
    expect(speaker.say).not.toHaveBeenCalled();
    busy = false;
    await settle(300);
    expect(speaker.say).toHaveBeenCalledWith("Explanation bookmarked.");
  });

  it("waits while any speaker is talking, then speaks", async () => {
    let finish;
    const talking = createSpeaker({
      announce: () => {},
      speakText: () => new Promise((resolve) => { finish = resolve; }),
      createAudio: () => ({ play: async () => {}, pause: () => {} }),
      mode: () => "tts",
    });
    const { rerender } = render(<Page speaker={speaker} />);
    await settle(QUIET_AFTER_SCREEN_MS);
    talking.say("Lecture paused at moment three.");
    rerender(<Page speaker={speaker} status="Generating explanations…" />);
    await settle(600);
    expect(speaker.say).not.toHaveBeenCalled();
    talking.stop();
    finish?.("blob:x");
    await settle(300);
    expect(speaker.say).toHaveBeenCalledWith("Generating explanations…");
  });

  it("does not repeat what a speaker just said", async () => {
    const talking = createSpeaker({ announce: () => {}, mode: () => "screenreader" });
    const { rerender } = render(<Page speaker={speaker} />);
    await settle(QUIET_AFTER_SCREEN_MS);
    await talking.say("This is the last moment.");
    rerender(<Page speaker={speaker} status="This is the last moment." />);
    await settle(500);
    expect(speaker.say).not.toHaveBeenCalled();
  });

  it("does not read a new screen's initial statuses, but does read later ones", async () => {
    const { rerender } = render(<Page speaker={speaker} screen="home" />);
    rerender(<Page speaker={speaker} screen="library" showInserted />);
    await settle(500);
    expect(speaker.say).not.toHaveBeenCalled();
    await settle(QUIET_AFTER_SCREEN_MS);
    rerender(<Page speaker={speaker} screen="library" showInserted status="2 items removed." />);
    await settle(300);
    expect(speaker.say).toHaveBeenCalledWith("2 items removed.");
  });

  it("speaks a status region that appears after the screen has settled", async () => {
    const { rerender } = render(<Page speaker={speaker} />);
    await settle(QUIET_AFTER_SCREEN_MS);
    rerender(<Page speaker={speaker} showInserted />);
    await settle(300);
    expect(speaker.say).toHaveBeenCalledWith("Saved to your library.");
  });

  it("speaks a repeated identical message again after the region was cleared", async () => {
    const { rerender } = render(<Page speaker={speaker} />);
    await settle(QUIET_AFTER_SCREEN_MS);
    rerender(<Page speaker={speaker} status="Finished playing voice note." />);
    await settle(300);
    rerender(<Page speaker={speaker} status="" />);
    await settle(9000); // longer than the "recently said" window
    rerender(<Page speaker={speaker} status="Finished playing voice note." />);
    await settle(300);
    expect(speaker.say).toHaveBeenCalledTimes(2);
  });
});
