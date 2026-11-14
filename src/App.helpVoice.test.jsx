import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import App from "./App.jsx";
import VoiceAudioProvider from "./voice/VoiceAudioProvider.jsx";

const h = vi.hoisted(() => ({
  captures: [],
  transcribe: vi.fn(),
  interpret: vi.fn(),
  speak: vi.fn(),
}));

vi.mock("./voice/voiceApi.js", () => ({
  warmUpVoice: vi.fn(),
  transcribeAudio: h.transcribe,
  interpretText: h.interpret,
  speakText: h.speak,
}));
vi.mock("./voice/micCapture.js", () => ({
  createMicCapture: () => {
    const capture = {
      open: vi.fn(async () => {}),
      startRecording: vi.fn(),
      stop: vi.fn(async () => ({ blob: new Blob(["clip"]), durationMs: 2000, heardSpeech: true })),
      cancel: vi.fn(),
    };
    h.captures.push(capture);
    return capture;
  },
}));
vi.mock("./voice/wav.js", () => ({
  toWav16k: async () => ({
    blob: new Blob(["wav"]), samples: Float32Array.of(0.4, -0.4), sampleRate: 16000, durationMs: 2000,
  }),
}));
vi.mock("./hooks/useVoiceRecorder.js", async (original) => ({
  ...await original(),
  playTone: vi.fn(async () => {}),
}));

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const settle = (ms = 2000) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const altT = () => fireEvent.keyDown(window, { code: "KeyT", key: "t", altKey: true });
const openHelp = () => fireEvent.click(screen.getByRole("button", { name: "Help" }));
const closeHelp = () => fireEvent.keyDown(document, { key: "Escape" });
const mount = () => render(<StrictMode><VoiceAudioProvider><App /></VoiceAudioProvider></StrictMode>);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("VITE_ONBOARDING_ENABLED", "0");
  vi.stubEnv("VITE_VOICE_CONTROL_ENABLED", "1");
  localStorage.clear();
  localStorage.setItem("synapse_voice_feedback", "screenreader");
  h.captures.length = 0;
  h.transcribe.mockReset().mockResolvedValue({ text: "go to notes", language: "en" });
  h.interpret.mockReset().mockResolvedValue({
    decision: "execute", action: "navigate_notes", args: {}, confidence: 0.99, message_key: "okay",
  });
  h.speak.mockReset().mockResolvedValue("blob:reply");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Help owns voice input and pending commands", () => {
  it("blocks Talk, Alt+T and Space while open, then allows a fresh turn", async () => {
    mount();
    openHelp();
    const talk = screen.getByRole("button", { name: "Talk" });
    expect(talk.disabled).toBe(true);
    altT();
    fireEvent.click(talk);
    fireEvent.keyDown(talk, { key: " " });
    await settle();
    expect(h.captures).toHaveLength(0);
    closeHelp();
    expect(talk.disabled).toBe(false);
    altT();
    await settle();
    expect(h.captures).toHaveLength(1);
    expect(h.captures[0].startRecording).toHaveBeenCalledTimes(1);
  });

  it.each(["preparing", "listening"])("discards %s capture without restarting it on close", async (phase) => {
    mount();
    altT();
    await settle(phase === "preparing" ? 10 : 2000);
    const capture = h.captures[0];
    openHelp();
    expect(capture.cancel).toHaveBeenCalledTimes(1);
    closeHelp();
    await settle();
    expect(h.transcribe).not.toHaveBeenCalled();
    expect(h.captures).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Talk" }).disabled).toBe(false);
  });

  it.each(["transcription", "interpretation"])("invalidates late %s even after Help closes", async (phase) => {
    const gate = deferred();
    if (phase === "transcription") h.transcribe.mockReturnValueOnce(gate.promise);
    else h.interpret.mockReturnValueOnce(gate.promise);
    mount();
    altT();
    await settle();
    altT();
    await settle(10);
    const signal = h.transcribe.mock.calls[0][1].signal;
    expect(signal.aborted).toBe(false);
    openHelp();
    expect(signal.aborted).toBe(true);
    closeHelp();
    gate.resolve(phase === "transcription"
      ? { text: "go to notes", language: "en" }
      : { decision: "execute", action: "navigate_notes", args: {}, confidence: 0.99, message_key: "okay" });
    await settle();
    expect(screen.getByRole("heading", { level: 1, name: "Start a study session" })).toBeTruthy();
    expect(h.speak).not.toHaveBeenCalled();
    if (phase === "transcription") expect(h.interpret).not.toHaveBeenCalled();
  });

  it("stops speech preparation, revokes its late URL and never plays it behind Help", async () => {
    localStorage.setItem("synapse_voice_feedback", "tts");
    const gate = deferred();
    h.speak.mockReturnValueOnce(gate.promise);
    h.interpret.mockResolvedValue({
      decision: "execute", action: "help", args: {}, confidence: 0.99, message_key: "okay",
    });
    const audio = vi.fn();
    const revoke = vi.fn();
    vi.stubGlobal("Audio", audio);
    vi.stubGlobal("URL", { revokeObjectURL: revoke });
    mount();
    altT();
    await settle();
    altT();
    await settle(10);
    expect(h.speak).toHaveBeenCalled();
    openHelp();
    closeHelp();
    gate.resolve("blob:cancelled");
    await settle();
    expect(audio).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith("blob:cancelled");
  });

  it("interrupts an already playing voice reply without resuming it after close", async () => {
    localStorage.setItem("synapse_voice_feedback", "tts");
    h.interpret.mockResolvedValue({
      decision: "execute", action: "help", args: {}, confidence: 0.99, message_key: "okay",
    });
    const player = { play: vi.fn(async () => {}), pause: vi.fn() };
    vi.stubGlobal("Audio", vi.fn(function () { return player; }));
    vi.stubGlobal("URL", { revokeObjectURL: vi.fn() });
    mount();
    altT();
    await settle();
    altT();
    await settle(10);
    expect(player.play).toHaveBeenCalledTimes(1);
    openHelp();
    expect(player.pause).toHaveBeenCalledTimes(1);
    closeHelp();
    await settle();
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Talk" }).disabled).toBe(false);
  });
});
