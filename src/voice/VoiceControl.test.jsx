// Component tests for the Talk control: the shortcut, hold-to-talk on the button, what a screen reader is
// told, and accessibility. The microphone, the converter and the lecture audio are hand-written fakes, so
// these check the control's behaviour, not real recording.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { axe } from "jest-axe";
import VoiceControl, { SPACE_HOLD_MS, isTypingTarget } from "./VoiceControl";
import { VoiceAudioContext, createVoiceAudioRegistry } from "./voiceAudio";
import { VoiceActionsContext, createActionRegistry } from "./voiceActions";
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

function mount({ port = makePort(), onUtterance, durationMs, disabled = false, screen: screenName = null } = {}) {
  const registry = createVoiceAudioRegistry();
  if (port) registry.register(port);
  const { deps, capture } = makeDeps({ durationMs });
  const element = (props = {}) => (
    <VoiceAudioContext.Provider value={registry}>
      {/* In the app the control sits in the top bar (a banner landmark). */}
      <header>
        <VoiceControl
          deps={deps}
          onUtterance={onUtterance}
          warmUp={() => {}}
          commandDeps={{ transcribeAudio: async () => ({ text: "", no_speech: true }) }}
          disabled={disabled}
          screen={screenName}
          {...props}
        />
      </header>
    </VoiceAudioContext.Provider>
  );
  const utils = render(element());
  return { ...utils, registry, port, deps, capture, rerenderWith: (props) => utils.rerender(element(props)) };
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

const space = async (target = document.body, init = {}) => {
  let notPrevented;
  act(() => { notPrevented = fireEvent.keyDown(target, { key: " ", code: "Space", ...init }); });
  await settle(10);
  return notPrevented;
};
const spaceUp = async (target = document.body, init = {}) => {
  let notPrevented;
  act(() => { notPrevented = fireEvent.keyUp(target, { key: " ", code: "Space", ...init }); });
  await settle(10);
  return notPrevented;
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem("synapse_voice_feedback", "screenreader"); // replies go through the live region
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the Talk button", () => {
  it("prompts for a lecture question and opens the next voice turn before restoring lecture audio", async () => {
    localStorage.setItem("synapse_voice_feedback", "tts");
    const port = makePort({ lecture: "playing", videoId: "aircAruvnKk", lectureSeconds: 42 });
    const registry = createVoiceAudioRegistry();
    registry.register(port);
    const actions = createActionRegistry();
    actions.register({ handlers: () => ({}), context: () => ({ screen: "explanation", videoId: "aircAruvnKk" }) });
    const { deps, capture } = makeDeps();
    const commandDeps = {
      transcribeAudio: vi.fn()
        .mockResolvedValueOnce({ text: "I want to ask a question", language: "en" })
        .mockResolvedValueOnce({ text: "Why is the current opposite?", language: "en" }),
      interpretText: vi.fn(),
      askQuestion: vi.fn(async () => ({ answer_text: "The current follows the conventional direction." })),
    };
    const speakText = vi.fn(async () => "blob:voice");
    const createAudio = () => {
      const audio = { pause: vi.fn(), play: async () => { setTimeout(() => audio.onended(), 10); } };
      return audio;
    };
    render(<VoiceActionsContext.Provider value={actions}><VoiceAudioContext.Provider value={registry}>
      <VoiceControl deps={deps} commandDeps={commandDeps} warmUp={() => {}}
        speakerDeps={{ speakText, createAudio }} />
    </VoiceAudioContext.Provider></VoiceActionsContext.Provider>);
    await press();
    await press();
    await settle(1000);
    expect(speakText).toHaveBeenCalledWith("Ask a question.");
    expect(capture.open).toHaveBeenCalledTimes(2);
    expect(port.restore).not.toHaveBeenCalled();
    expect(commandDeps.askQuestion).not.toHaveBeenCalled();
    await press();
    await settle(200);
    expect(commandDeps.askQuestion).toHaveBeenCalledWith(expect.objectContaining({
      videoId: "aircAruvnKk", question: "Why is the current opposite?", currentTimeSeconds: 42,
    }));
    expect(commandDeps.interpretText).not.toHaveBeenCalled();
    expect(speakText).toHaveBeenCalledWith("The current follows the conventional direction.");
    expect(port.restore).toHaveBeenCalledWith(expect.objectContaining({ lecture: true }));
  });

  it("is a named button that advertises its shortcut and how to use it", () => {
    mount();
    const button = talkButton();
    expect(button).toHaveAccessibleName("Talk");
    expect(button).toHaveAttribute("aria-keyshortcuts", "Space Alt+T");
    expect(button).toHaveAccessibleDescription(/Space.*again to stop.*hold Space.*Alt\+T/i);
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

describe("Space", () => {
  it("toggles listening from anywhere on the page: tap to start, tap to stop", async () => {
    const { capture, deps } = mount();
    await space();
    await spaceUp();
    expect(talkButton()).toHaveAccessibleName("Listening…");
    await space();
    await spaceUp();
    expect(capture.stop).toHaveBeenCalledTimes(1);
    expect(deps.toWav16k).toHaveBeenCalledTimes(1);
    expect(talkButton()).toHaveAccessibleName("Talk");
  });

  it("is push-to-talk when held: releasing after a long press ends the turn", async () => {
    const { capture } = mount();
    await space();
    expect(talkButton()).toHaveAccessibleName("Listening…");
    await settle(SPACE_HOLD_MS + 100);
    await spaceUp();
    expect(capture.stop).toHaveBeenCalledTimes(1);
    expect(talkButton()).toHaveAccessibleName("Talk");
  });

  it("claims the key on a focused button so the button is not pressed", async () => {
    mount();
    const other = document.createElement("button");
    const clicked = vi.fn();
    other.addEventListener("click", clicked);
    document.body.appendChild(other);
    try {
      other.focus();
      expect(await space(other)).toBe(false);
      expect(await spaceUp(other)).toBe(false);
      expect(clicked).not.toHaveBeenCalled();
      expect(talkButton()).toHaveAccessibleName("Listening…");
    } finally {
      other.remove();
    }
  });

  it.each([
    ["a text input", () => Object.assign(document.createElement("input"), { type: "text" })],
    ["a search input", () => Object.assign(document.createElement("input"), { type: "search" })],
    ["a password input", () => Object.assign(document.createElement("input"), { type: "password" })],
    ["a textarea", () => document.createElement("textarea")],
  ])("types a space in %s instead of listening", async (_label, make) => {
    mount();
    const field = make();
    document.body.appendChild(field);
    try {
      field.focus();
      expect(await space(field)).toBe(true);
      expect(await spaceUp(field)).toBe(true);
      expect(talkButton()).toHaveAccessibleName("Talk");
    } finally {
      field.remove();
    }
  });

  it("ignores key repeat while held", async () => {
    const { deps } = mount();
    await space();
    await space(document.body, { repeat: true });
    await space(document.body, { repeat: true });
    expect(deps.createCapture).toHaveBeenCalledTimes(1);
    expect(talkButton()).toHaveAccessibleName("Listening…");
  });

  it("stops a turn that was started with Alt+T", async () => {
    const { capture } = mount();
    await press();
    await space();
    await spaceUp();
    expect(capture.stop).toHaveBeenCalledTimes(1);
  });

  it.each([["Ctrl", { ctrlKey: true }], ["Alt", { altKey: true }], ["Shift", { shiftKey: true }], ["Meta", { metaKey: true }]])(
    "does not react to Space with %s",
    async (_label, init) => {
      mount();
      expect(await space(document.body, init)).toBe(true);
      expect(talkButton()).toHaveAccessibleName("Talk");
    },
  );

  it("leaves Space alone while Help is open (the control is disabled)", async () => {
    mount({ disabled: true });
    expect(await space()).toBe(true);
    expect(await spaceUp()).toBe(true);
    expect(talkButton()).toHaveAccessibleName("Talk");
  });
});

describe("isTypingTarget", () => {
  it("treats only places that take typed text as typing targets", () => {
    const make = (tag, attrs = {}) => Object.assign(document.createElement(tag), attrs);
    expect(isTypingTarget(make("input"))).toBe(true);
    expect(isTypingTarget(make("textarea"))).toBe(true);
    expect(isTypingTarget(make("select"))).toBe(true);
    const box = make("div");
    box.setAttribute("role", "textbox");
    expect(isTypingTarget(box)).toBe(true);
    const radio = make("input");
    radio.setAttribute("type", "radio");
    expect(isTypingTarget(radio)).toBe(false);
    expect(isTypingTarget(make("button"))).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("spoken preparation progress", () => {
  it("holds progress while the lecture plays and says the newest news once it pauses", async () => {
    let context = { videoId: "v1", preparationProgress: { total: 12, ready: 0, preparing: 12, failed: 0 } };
    const actions = createActionRegistry();
    actions.register({ handlers: () => ({}), context: () => context });
    const port = makePort({ lecture: "playing" });
    const audio = createVoiceAudioRegistry();
    audio.register(port);
    const { deps } = makeDeps();
    render(
      <VoiceActionsContext.Provider value={actions}>
        <VoiceAudioContext.Provider value={audio}>
          <VoiceControl deps={deps} warmUp={() => {}} playEarcon={() => {}} />
        </VoiceAudioContext.Provider>
      </VoiceActionsContext.Provider>,
    );
    await settle(1000);
    expect(liveText()).toBe(""); // lecture playing: nothing said over it
    context = { ...context, preparationProgress: { total: 12, ready: 1, preparing: 11, failed: 0 } };
    await settle(1000);
    expect(liveText()).toBe("");
    port.state.lecture = "paused";
    await settle(1000);
    expect(liveText()).toBe("The first explanation is ready. 1 of 12.");
  });
});

describe("the explanation-ready chime", () => {
  it("chimes once when the lecture offers a newly ready explanation, and not for other questions", async () => {
    let context = {};
    const actions = createActionRegistry();
    actions.register({ handlers: () => ({}), context: () => context });
    const audio = createVoiceAudioRegistry();
    audio.register(makePort());
    const { deps } = makeDeps();
    const playEarcon = vi.fn();
    render(
      <VoiceActionsContext.Provider value={actions}>
        <VoiceAudioContext.Provider value={audio}>
          <VoiceControl deps={deps} warmUp={() => {}} playEarcon={playEarcon} />
        </VoiceAudioContext.Provider>
      </VoiceActionsContext.Provider>,
    );
    context = { explanationQuestion: { id: "q1", choices: ["wait", "resume"] },
      questionPrompt: "Lecture paused. The standard explanation for moment 3 is still preparing." };
    await settle(400);
    expect(playEarcon).not.toHaveBeenCalledWith("ready");
    context = { explanationQuestion: { id: "q2", choices: ["listen", "later"] },
      questionPrompt: "Lecture paused. Moment 3. The standard explanation is ready. Would you like to listen now?" };
    await settle(400);
    await settle(1000);
    expect(playEarcon.mock.calls.filter(([kind]) => kind === "ready")).toHaveLength(1);
  });
});

describe("screen introductions", () => {
  it("introduces a screen when it opens, in full the first time and briefly after that", async () => {
    const { rerenderWith } = mount({ screen: "bookmarks" });
    expect(liveText()).toBe("");
    await settle(700);
    expect(liveText()).toMatch(/^Bookmarks, the explanations you saved\..*Press Space/);
    rerenderWith({ screen: "home" });
    await settle(700);
    expect(liveText()).toMatch(/^Home\. Synapse turns lecture videos/);
    rerenderWith({ screen: "bookmarks" });
    await settle(700);
    expect(liveText()).toBe("Bookmarks.");
  });

  it("says how many items the screen registered for voice", async () => {
    const actions = createActionRegistry();
    actions.register({ handlers: () => ({}), context: () => ({ items: [{ position: 1 }, { position: 2 }, { position: 3 }] }) });
    const audio = createVoiceAudioRegistry();
    audio.register(makePort());
    const { deps } = makeDeps();
    render(
      <VoiceActionsContext.Provider value={actions}>
        <VoiceAudioContext.Provider value={audio}>
          <VoiceControl deps={deps} warmUp={() => {}} screen="library" />
        </VoiceAudioContext.Provider>
      </VoiceActionsContext.Provider>,
    );
    await settle(700);
    expect(liveText()).toMatch(/3 items are listed\. Press Space and say read my saved items, or play the audio of the first item\./);
  });

  it("does not talk over the microphone", async () => {
    mount({ screen: "home" });
    await press(); // listening before the introduction is due
    await settle(700);
    expect(liveText()).toBe("");
  });

  it("is not given while Help is open", async () => {
    mount({ screen: "home", disabled: true });
    await settle(700);
    expect(liveText()).toBe("");
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
