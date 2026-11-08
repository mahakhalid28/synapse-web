import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCommandHandler, playingFromSnapshot } from "./voiceCommands";
import { createActionRegistry } from "./voiceActions";
import { chunkText, createSpeaker } from "./voiceSpeech";
import { interpretText, speakText, transcribeAudio } from "./voiceApi";
import { MESSAGES } from "./voiceMessages";

// ── Command handler ──────────────────────────────────────────────────────────

const reply = (decision, extra = {}) => ({ decision, message_key: "k", confidence: 0.9, ...extra });
const execute = (action, args = {}) => reply("execute", { action, args });

function setup({ handlers = {}, describe = () => ({ screen: "explanation", videoId: "aircAruvnKk" }), responses = [], heard = { text: "x", language: "en" } } = {}) {
  const registry = createActionRegistry();
  registry.register({ handlers: () => handlers, context: describe });
  const said = [];
  const speaker = { say: vi.fn(async (t) => { said.push(t); }), stop: vi.fn(), last: () => said.at(-1) ?? "" };
  const queue = [...responses];
  const deps = {
    transcribeAudio: vi.fn(async () => heard),
    interpretText: vi.fn(async () => queue.shift()),
    askQuestion: vi.fn(async () => ({ status: "answered", answer_text: "Because it saturates." })),
  };
  const handle = createCommandHandler({ registry, speaker, deps });
  return { handle, deps, said, speaker };
}
const utterance = { wav: new Blob(["w"]), before: null };

describe("running a command", () => {
  it("runs the registered handler with its arguments, then speaks, and reports no playback change", async () => {
    const order = [];
    const next = vi.fn(() => order.push("handler"));
    const env = setup({ handlers: { set_theme: next }, responses: [execute("set_theme", { theme: "night" })] });
    env.speaker.say.mockImplementation(async () => { order.push("say"); });
    expect(await env.handle(utterance)).toEqual({});
    expect(next).toHaveBeenCalledWith({ theme: "night" });
    expect(order).toEqual(["handler", "say"]);
  });

  it("tells the turn when a command changed playback, so nothing is resumed over it", async () => {
    const env = setup({ handlers: { pause_lecture: vi.fn() }, responses: [execute("pause_lecture")] });
    expect(await env.handle(utterance)).toEqual({ playbackCommand: "pause_lecture" });
  });

  it("tells the turn when a command leaves the screen, so the lecture is never resumed behind it", async () => {
    for (const action of ["start_practice", "navigate_home", "open_timeline"]) {
      const env = setup({ handlers: { [action]: vi.fn() }, responses: [execute(action)] });
      expect([action, await env.handle(utterance)]).toEqual([action, { leftScreen: true }]);
    }
  });

  it("answers a how-to question from the action list: here, elsewhere, or not known", async () => {
    const appQ = (target, score = 0.8) => reply("execute", {
      action: "app_question", args: {},
      candidates: [{ action: "app_question", score: 0.9, args: {} }, { action: target, score, args: {} }],
    });
    const here = setup({ handlers: { toggle_bookmark: vi.fn() }, responses: [appQ("toggle_bookmark")] });
    expect(await here.handle(utterance)).toEqual({});
    expect(here.said.at(-1)).toMatch(/you can do that by voice.*change the bookmark/i);

    const elsewhere = setup({ describe: () => ({ screen: "home" }), responses: [appQ("toggle_bookmark")] });
    await elsewhere.handle(utterance);
    expect(elsewhere.said.at(-1)).toMatch(/works on the lecture screen/i);

    const unknown = setup({ responses: [appQ("toggle_bookmark", 0.2)] });
    await unknown.handle(utterance);
    expect(unknown.said.at(-1)).toBe(MESSAGES.appQuestionUnknown);
  });

  it("asks the lecture Q&A from a screen that is not the lecture, using the last lecture opened", async () => {
    const env = setup({
      describe: () => ({ screen: "library", videoId: "aircAruvnKk" }),
      responses: [reply("ask_question", { action: "ask_question", args: { question: "what is a gradient" } })],
    });
    await env.handle(utterance);
    expect(env.deps.askQuestion).toHaveBeenCalledWith(expect.objectContaining({ videoId: "aircAruvnKk", question: "what is a gradient" }));
  });

  it("says where the learner is, and speaks a handler's own explanation when it fails", async () => {
    const where = setup({ describe: () => ({ screen: "library", items: [{ ref: "1", kind: "x", label: "a", position: 1 }] }), responses: [execute("where_am_i")] });
    await where.handle(utterance);
    expect(where.said.at(-1)).toMatch(/your library.*1 item is listed/i);

    const err = Object.assign(new Error("blocked"), { spoken: "The clipboard is empty." });
    const failing = setup({ describe: () => ({ screen: "home" }), handlers: { paste_url: () => { throw err; } }, responses: [execute("paste_url")] });
    await failing.handle(utterance);
    expect(failing.said.at(-1)).toBe("The clipboard is empty.");
  });

  it("says so, and runs nothing, when the screen has no handler for the action", async () => {
    const env = setup({ handlers: {}, responses: [execute("next_moment")] });
    await env.handle(utterance);
    expect(env.said.at(-1)).toBe(MESSAGES.unavailable);
  });

  it("recovers when a handler fails", async () => {
    const env = setup({ handlers: { next_moment: () => { throw new Error("boom"); } }, responses: [execute("next_moment")] });
    expect(await env.handle(utterance)).toEqual({});
    expect(env.said.at(-1)).toBe(MESSAGES.failed);
  });

  it("refuses a response for an action that does not belong on this screen", async () => {
    const handler = vi.fn();
    const env = setup({ handlers: { play_lecture: handler }, describe: () => ({ screen: "library" }), responses: [execute("play_lecture")] });
    await env.handle(utterance);
    expect(handler).not.toHaveBeenCalled();
    expect(env.said.at(-1)).toBe(MESSAGES.notUnderstood);
  });

  it("sends what is on screen, the actions it can run, and what was playing before the turn", async () => {
    const env = setup({
      handlers: { next_moment: vi.fn() },
      describe: () => ({ screen: "explanation", videoId: "aircAruvnKk", items: [{ ref: "m1", kind: "moment", label: "First", position: 1 }] }),
      responses: [reply("unsupported")],
    });
    await env.handle({ ...utterance, before: { lecture: "playing", explanation: "none", pauseOwner: null } });
    const sent = env.deps.interpretText.mock.calls[0][0];
    expect(sent.text).toBe("x");
    expect(sent.context).toMatchObject({ screen: "explanation", video_id: "aircAruvnKk", playing: "lecture" });
    expect(sent.context.items).toHaveLength(1);
    expect(sent.context.available_actions).toEqual(expect.arrayContaining(["next_moment", "help", "cancel"]));
  });
});

describe("confirmation", () => {
  it("asks first for a risky action, then runs it only after a spoken yes", async () => {
    const remove = vi.fn();
    const env = setup({
      handlers: { remove_item: remove },
      describe: () => ({ screen: "bookmarks" }),
      responses: [reply("confirm", { action: "remove_item", args: { index: 2 } }), execute("confirm_yes")],
    });
    await env.handle(utterance);
    expect(remove).not.toHaveBeenCalled();
    expect(env.said.at(-1)).toMatch(/Do you want to remove item 2\?.*yes or no/);
    await env.handle(utterance);
    expect(remove).toHaveBeenCalledWith({ index: 2 });
    expect(env.deps.interpretText.mock.calls[1][0].context.pending_confirmation).toBe("remove_item");
  });

  it("does nothing on no, and a later yes has nothing to confirm", async () => {
    const remove = vi.fn();
    const env = setup({
      handlers: { remove_item: remove },
      describe: () => ({ screen: "bookmarks" }),
      responses: [reply("confirm", { action: "remove_item", args: { index: 1 } }), execute("confirm_no"), execute("confirm_yes")],
    });
    await env.handle(utterance);
    await env.handle(utterance);
    await env.handle(utterance);
    expect(remove).not.toHaveBeenCalled();
    expect(env.said.at(-1)).toBe(MESSAGES.nothingToConfirm);
  });

  it("forgets the question if the learner asks for something else", async () => {
    const remove = vi.fn();
    const env = setup({
      handlers: { remove_item: remove, navigate_home: vi.fn() },
      describe: () => ({ screen: "bookmarks" }),
      responses: [reply("confirm", { action: "remove_item", args: { index: 1 } }), execute("navigate_home"), execute("confirm_yes")],
    });
    await env.handle(utterance);
    await env.handle(utterance);
    await env.handle(utterance);
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("questions and other decisions", () => {
  it("sends a question to the existing lecture Q&A with the lecture, time and moment, and speaks the answer", async () => {
    const env = setup({
      describe: () => ({ screen: "explanation", videoId: "aircAruvnKk", currentMomentRef: "3f2b8c1e-5d4a-4e7b-9a10-2c6d8e9f0a1b", lectureSeconds: 42.5 }),
      responses: [reply("ask_question", { action: "ask_question", args: { question: "why is it flat" } })],
    });
    expect(await env.handle(utterance)).toEqual({});
    expect(env.deps.askQuestion).toHaveBeenCalledWith({
      videoId: "aircAruvnKk", question: "why is it flat", currentTimeSeconds: 42.5, interventionId: "3f2b8c1e-5d4a-4e7b-9a10-2c6d8e9f0a1b",
    });
    expect(env.said.at(-1)).toBe("Because it saturates.");
  });

  it("speaks the Q&A error instead of failing silently", async () => {
    const env = setup({ responses: [reply("ask_question", { action: "ask_question", args: { question: "q" } })] });
    env.deps.askQuestion.mockRejectedValueOnce(new Error("The AI service is busy right now."));
    await env.handle(utterance);
    expect(env.said.at(-1)).toBe("The AI service is busy right now.");
  });

  it("asks for a detail that is missing, and for a choice when two commands fit", async () => {
    const missing = setup({ responses: [reply("unsupported", { message_key: "missing_index" })] });
    await missing.handle(utterance);
    expect(missing.said.at(-1)).toMatch(/Which one\?/);

    const choice = setup({
      responses: [reply("clarify", { candidates: [{ action: "next_moment", score: 0.6, args: {} }, { action: "previous_moment", score: 0.58, args: {} }] })],
    });
    await choice.handle(utterance);
    expect(choice.said.at(-1)).toBe("Did you mean go to the next moment, or go to the previous moment?");
  });

  it("handles stop, repeat, cancel and help itself", async () => {
    const env = setup({ responses: [execute("help"), execute("repeat_last_response"), execute("stop_speaking"), execute("cancel")] });
    await env.handle(utterance);
    expect(env.said.at(-1)).toMatch(/You can say/);
    await env.handle(utterance);
    expect(env.speaker.say).toHaveBeenLastCalledWith(expect.stringMatching(/You can say/));
    await env.handle(utterance);
    expect(env.speaker.stop).toHaveBeenCalled();
    await env.handle(utterance);
    expect(env.said.at(-1)).toBe(MESSAGES.okay);
  });
});

describe("when things go wrong", () => {
  it("says it heard nothing when there was no speech", async () => {
    const env = setup({ heard: { text: "", no_speech: true } });
    expect(await env.handle(utterance)).toEqual({});
    expect(env.said).toEqual([MESSAGES.heardNothing]);
    expect(env.deps.interpretText).not.toHaveBeenCalled();
  });

  it("says the server cannot be reached if recognition or interpretation fail", async () => {
    const a = setup();
    a.deps.transcribeAudio.mockRejectedValueOnce(new Error("down"));
    await a.handle(utterance);
    expect(a.said).toEqual([MESSAGES.offline]);

    const b = setup();
    b.deps.interpretText.mockRejectedValueOnce(new Error("down"));
    await b.handle(utterance);
    expect(b.said).toEqual([MESSAGES.offline]);
  });

  it("does not understand a malformed response", async () => {
    const env = setup({ responses: [{ decision: "execute" }] });
    await env.handle(utterance);
    expect(env.said).toEqual([MESSAGES.notUnderstood]);
  });
});

describe("playingFromSnapshot", () => {
  it("tells what was audibly playing", () => {
    expect(playingFromSnapshot(null)).toBe("unknown");
    expect(playingFromSnapshot({ lecture: "playing", explanation: "none", pauseOwner: null })).toBe("lecture");
    expect(playingFromSnapshot({ lecture: "buffering", explanation: "none", pauseOwner: null })).toBe("lecture");
    expect(playingFromSnapshot({ lecture: "paused", explanation: "playing", pauseOwner: "intervention" })).toBe("explanation");
    expect(playingFromSnapshot({ lecture: "playing", explanation: "playing", pauseOwner: "intervention" })).toBe("explanation");
    expect(playingFromSnapshot({ lecture: "paused", explanation: "paused", pauseOwner: "user" })).toBe("none");
  });
});

// ── Spoken replies ───────────────────────────────────────────────────────────

describe("chunkText", () => {
  it("keeps every piece within the limit and breaks at sentence ends", () => {
    const text = "First sentence here. ".repeat(40);
    const chunks = chunkText(text, 100);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    expect(chunks.every((c) => c.endsWith("."))).toBe(true);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(text.trim().slice(0, 1500).replace(/\s+/g, " ").trim());
  });

  it("splits a very long sentence, caps the total, and handles short text", () => {
    expect(chunkText("x".repeat(900), 350).every((c) => c.length <= 350)).toBe(true);
    expect(chunkText("y".repeat(5000)).join("").length).toBeLessThanOrEqual(1500);
    expect(chunkText("Hi.")).toEqual(["Hi."]);
  });
});

describe("the speaker", () => {
  const audioFake = () => {
    const made = [];
    return {
      made,
      createAudio: (url) => {
        const a = { url, pause: vi.fn(), play: vi.fn(() => { setTimeout(() => a.onended?.(), 0); return Promise.resolve(); }) };
        made.push(a);
        return a;
      },
    };
  };

  it("plays each piece through the TTS endpoint and does not use the screen reader", async () => {
    const announce = vi.fn();
    const fake = audioFake();
    const speakFn = vi.fn(async (t) => `blob:${t}`);
    const speaker = createSpeaker({ speakText: speakFn, announce, createAudio: fake.createAudio, mode: () => "tts" });
    await speaker.say("One. Two.");
    expect(speakFn).toHaveBeenCalledTimes(1);
    expect(fake.made).toHaveLength(1);
    expect(announce).not.toHaveBeenCalled();
    expect(speaker.last()).toBe("One. Two.");
  });

  it("falls back to the screen reader when speech is unavailable", async () => {
    const announce = vi.fn();
    const speaker = createSpeaker({ speakText: vi.fn(async () => { throw new Error("offline"); }), announce, mode: () => "tts" });
    await speaker.say("Opening your bookmarks.");
    expect(announce).toHaveBeenCalledWith("Opening your bookmarks.");
  });

  it("uses only the screen reader when that is the preference", async () => {
    const announce = vi.fn();
    const speakFn = vi.fn();
    await createSpeaker({ speakText: speakFn, announce, mode: () => "screenreader" }).say("Hello");
    expect(announce).toHaveBeenCalledWith("Hello");
    expect(speakFn).not.toHaveBeenCalled();
  });

  it("stops at once: a reply still being prepared is never played", async () => {
    const announce = vi.fn();
    const fake = audioFake();
    let release;
    const speakFn = vi.fn(() => new Promise((resolve) => { release = () => resolve("blob:x"); }));
    const speaker = createSpeaker({ speakText: speakFn, announce, createAudio: fake.createAudio, mode: () => "tts" });
    const saying = speaker.say("Long reply");
    speaker.stop();
    release();
    await saying;
    expect(fake.made).toHaveLength(0);
    expect(announce).not.toHaveBeenCalled();
  });

  it("stops audio that is playing", async () => {
    const audio = { pause: vi.fn(), play: vi.fn(() => Promise.resolve()) };
    const speaker = createSpeaker({ speakText: async () => "blob:x", announce: vi.fn(), createAudio: () => audio, mode: () => "tts" });
    const saying = speaker.say("Playing now");
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalled());
    speaker.stop();
    await saying;
    expect(audio.pause).toHaveBeenCalled();
  });
});

// ── Backend client ───────────────────────────────────────────────────────────

describe("voice API client", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });
  const ok = (body) => ({ ok: true, status: 200, json: async () => body, blob: async () => new Blob(["mp3"]) });
  const bad = (status, detail) => ({ ok: false, status, json: async () => ({ detail }) });

  it("uploads the clip as multipart form data to /voice/transcribe", async () => {
    fetch.mockResolvedValueOnce(ok({ text: "hi" }));
    await transcribeAudio(new Blob(["w"], { type: "audio/wav" }), { language: "en" });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toMatch(/\/voice\/transcribe$/);
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.body.get("file")).toBeInstanceOf(Blob);
    expect(init.body.get("language")).toBe("en");
  });

  it("posts JSON to /voice/interpret", async () => {
    fetch.mockResolvedValueOnce(ok({ decision: "unsupported" }));
    await interpretText({ text: "x", context: { screen: "home" } });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ text: "x", context: { screen: "home" } });
  });

  it("turns an error response into an error carrying the server's message", async () => {
    fetch.mockResolvedValueOnce(bad(422, "The audio is not a valid WAV file."));
    await expect(transcribeAudio(new Blob(["w"]))).rejects.toMatchObject({ message: "The audio is not a valid WAV file.", status: 422 });
    fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => { throw new Error("no json"); } });
    await expect(interpretText({})).rejects.toThrow(/failed \(500\)/);
  });

  it("returns a playable URL for spoken text", async () => {
    URL.createObjectURL = vi.fn(() => "blob:speech");
    fetch.mockResolvedValueOnce(ok({}));
    expect(await speakText("Hello")).toBe("blob:speech");
    delete URL.createObjectURL;
  });
});
