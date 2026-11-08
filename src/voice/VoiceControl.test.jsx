// Component tests for the Talk control: the shortcut, hold-to-talk on the button, what a screen reader is
// told, and accessibility. The microphone, the converter and the lecture audio are hand-written fakes, so
// these check the control's behaviour, not real recording.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { axe } from "jest-axe";
import VoiceControl from "./VoiceControl";
import { VoiceAudioContext, createVoiceAudioRegistry } from "./voiceAudio";
import "../test/domMatchers.js";

function makePort(initial = {}) {
  const state = { lecture: "paused", explanation: "none", pauseOwner: null, ...initial };
  return {
    state,
    getSnapshot: vi.fn(() => ({ ...state })),
    pause: vi.fn(() => {
      if (state.lecture === "playing") state.lecture = "paused";
      if (state.explanation === "playing") state.explanation = "paused";
      state.pauseOwner = "user";
    }),
    restore: vi.fn(),
    isNoteBusy: vi.fn(() => false),
  };
}

function makeDeps({ durationMs = 2400 } = {}) {
  const capture = {
    open: vi.fn(async () => {}),
    startRecording: vi.fn(),
    stop: vi.fn(async (reason) => ({ blob: new Blob(["clip"]), durationMs: 2000, reason, heardSpeech: true })),
    cancel: vi.fn(),
  };
  return {
    capture,
    deps: {
      createCapture: vi.fn(() => capture),
      toWav16k: vi.fn(async () => ({
        blob: new Blob(["wav"]),
        samples: Float32Array.from({ length: 800 }, (_, i) => Math.sin(i / 4) * 0.4),
        sampleRate: 16000,
        durationMs,
      })),
      playTone: vi.fn(async () => {}),
      wait: vi.fn(async () => {}),
    },
  };
}

function mount({ port = makePort(), onUtterance, durationMs } = {}) {
  const registry = createVoiceAudioRegistry();
  if (port) registry.register(port);
  const { deps, capture } = makeDeps({ durationMs });
  const utils = render(
    <VoiceAudioContext.Provider value={registry}>
      {/* In the app the control sits in the top bar (a banner landmark). */}
      <header>
        <VoiceControl
          deps={deps}
          onUtterance={onUtterance}
          warmUp={() => {}}
          commandDeps={{ transcribeAudio: async () => ({ text: "", no_speech: true }) }}
        />
      </header>
    </VoiceAudioContext.Provider>,
  );
  return { ...utils, registry, port, deps, capture };
}

const settle = (ms = 200) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const press = async (init) => {
  let notPrevented;
  act(() => { notPrevented = fireEvent.keyDown(window, { code: "KeyT", key: "t", altKey: true, ...init }); });
  await settle(10);
  return notPrevented;
};
const talkButton = () => screen.getByRole("button", { name: /^(talk|getting ready|listening|working)/i });
const liveText = () => screen.getByRole("status").textContent;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.setItem("synapse_voice_feedback", "screenreader"); // replies go through the live region
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the Talk button", () => {
  it("is a named button that advertises its shortcut and how to use it", () => {
    mount();
    const button = talkButton();
    expect(button).toHaveAccessibleName("Talk");
    expect(button).toHaveAttribute("aria-keyshortcuts", "Alt+T");
    expect(button).toHaveAccessibleDescription(/Alt\+T.*again to stop.*Space/i);
  });

  it("changes its name as the turn progresses", async () => {
    mount();
    await press();
    expect(talkButton()).toHaveAccessibleName("Listening…");
    await press();
    expect(talkButton()).toHaveAccessibleName("Talk");
  });

  it("starts and stops on click", async () => {
    mount();
    fireEvent.click(talkButton());
    await settle();
    expect(talkButton()).toHaveAccessibleName("Listening…");
    fireEvent.click(talkButton());
    await settle();
    expect(talkButton()).toHaveAccessibleName("Talk");
  });
});

describe("Alt+T", () => {
  it("toggles listening: once to start, once to stop, with no holding", async () => {
    const { deps, capture } = mount();
    await press();
    expect(capture.startRecording).toHaveBeenCalledTimes(1);
    expect(talkButton()).toHaveAccessibleName("Listening…");
    await press();
    expect(capture.stop).toHaveBeenCalledTimes(1);
    expect(deps.toWav16k).toHaveBeenCalledTimes(1);
  });

  it("works while typing in a text field, like Alt+S", async () => {
    mount();
    const field = document.createElement("input");
    field.type = "text";
    document.body.appendChild(field);
    try {
      field.focus();
      act(() => { fireEvent.keyDown(field, { code: "KeyT", key: "t", altKey: true }); });
      await settle(10);
      expect(talkButton()).toHaveAccessibleName("Listening…");
    } finally {
      field.remove();
    }
  });

  it("claims the key so the browser does not also act on it", async () => {
    mount();
    expect(await press()).toBe(false); // fireEvent returns false when preventDefault was called
  });

  it("does not repeat while the key is held down", async () => {
    const { capture } = mount();
    await press();
    await press({ repeat: true });
    await press({ repeat: true });
    expect(talkButton()).toHaveAccessibleName("Listening…");
    expect(capture.stop).not.toHaveBeenCalled();
  });

  it("recognises the typed letter when an assistive technology sends no key code", async () => {
    mount();
    await press({ code: "", key: "T" });
    expect(talkButton()).toHaveAccessibleName("Listening…");
  });

  it.each([
    ["with Shift", { shiftKey: true }],
    ["with Ctrl (AltGr layouts report Ctrl+Alt)", { ctrlKey: true }],
    ["with Meta", { metaKey: true }],
    ["without Alt", { altKey: false }],
    ["on a different letter", { code: "KeyY", key: "y" }],
  ])("is ignored %s", async (_label, init) => {
    mount();
    const notPrevented = await press(init);
    expect(notPrevented).toBe(true);
    expect(talkButton()).toHaveAccessibleName("Talk");
  });
});

describe("holding Space on the focused button", () => {
  it("listens while Space is down and handles the words when it is released", async () => {
    const { capture, deps } = mount();
    const button = talkButton();
    act(() => { fireEvent.keyDown(button, { key: " " }); });
    await settle(10);
    expect(talkButton()).toHaveAccessibleName("Listening…");
    act(() => { fireEvent.keyUp(button, { key: " " }); });
    await settle(10);
    expect(capture.stop).toHaveBeenCalledTimes(1);
    expect(deps.toWav16k).toHaveBeenCalledTimes(1);
    expect(talkButton()).toHaveAccessibleName("Talk");
  });

  it("does not also fire the browser's click on release (that would toggle it back off)", async () => {
    mount();
    const button = talkButton();
    let downPrevented;
    let upPrevented;
    act(() => { downPrevented = !fireEvent.keyDown(button, { key: " " }); });
    await settle(10);
    act(() => { upPrevented = !fireEvent.keyUp(button, { key: " " }); });
    await settle(10);
    expect(downPrevented).toBe(true);
    expect(upPrevented).toBe(true);
  });

  it("ignores key repeat while held", async () => {
    const { deps } = mount();
    const button = talkButton();
    act(() => { fireEvent.keyDown(button, { key: " " }); });
    await settle(10);
    act(() => { fireEvent.keyDown(button, { key: " ", repeat: true }); });
    act(() => { fireEvent.keyDown(button, { key: " ", repeat: true }); });
    await settle(10);
    expect(deps.createCapture).toHaveBeenCalledTimes(1);
    expect(talkButton()).toHaveAccessibleName("Listening…");
  });

  it("stops a turn that was started with Alt+T when Space is pressed on the button", async () => {
    const { capture } = mount();
    await press();
    act(() => { fireEvent.keyDown(talkButton(), { key: " " }); });
    await settle(10);
    expect(capture.stop).toHaveBeenCalledTimes(1);
  });

  it("does not react to Space with a modifier", async () => {
    mount();
    act(() => { fireEvent.keyDown(talkButton(), { key: " ", ctrlKey: true }); });
    await settle(10);
    expect(talkButton()).toHaveAccessibleName("Talk");
  });
});

describe("what is announced", () => {
  it("runs the real command handler by default and speaks its reply through the live region", async () => {
    mount({ durationMs: 2400 });
    await press();
    expect(liveText()).toBe("");
    await press();
    await settle(200);
    expect(liveText()).toBe("I didn't hear anything."); // the test's fake recogniser reports no speech
  });

  it("announces nothing while listening", async () => {
    mount();
    await press();
    await settle(500);
    expect(liveText()).toBe("");
  });

  it("explains why it did not start when a voice note is being recorded", async () => {
    const port = makePort();
    port.isNoteBusy.mockReturnValue(true);
    mount({ port });
    await press();
    await settle(200);
    expect(liveText()).toMatch(/voice note is being recorded/i);
    expect(talkButton()).toHaveAccessibleName("Talk");
  });
});

describe("hand-off of the words", () => {
  it("passes the clip to onUtterance instead of the default handler, and respects a playback command", async () => {
    const onUtterance = vi.fn(async () => ({ playbackCommand: "pause" }));
    const port = makePort({ lecture: "playing" });
    mount({ port, onUtterance });
    await press();
    await press();
    await settle(200);
    expect(onUtterance).toHaveBeenCalledTimes(1);
    expect(onUtterance.mock.calls[0][0]).toMatchObject({ sampleRate: 16000, durationMs: 2400 });
    expect(port.restore).not.toHaveBeenCalled();
    expect(liveText()).toBe(""); // the default "recorded N seconds" message is not used
  });

  it("restores a playing lecture after an ordinary turn", async () => {
    const port = makePort({ lecture: "playing" });
    mount({ port });
    await press();
    expect(port.pause).toHaveBeenCalled();
    await press();
    await settle(200);
    expect(port.restore).toHaveBeenCalledWith(expect.objectContaining({ lecture: true, explanation: false }));
  });
});

describe("accessibility (axe)", () => {
  it("has no violations when idle", async () => {
    vi.useRealTimers();
    const { container } = mount();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no violations while listening", async () => {
    mount();
    await press();
    vi.useRealTimers();
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
