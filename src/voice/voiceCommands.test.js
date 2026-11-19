import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCommandHandler, playingFromSnapshot } from "./voiceCommands";
import { createActionRegistry } from "./voiceActions";
import { chunkText, createSpeaker } from "./voiceSpeech";
import { interpretText, speakText, transcribeAudio } from "./voiceApi";
import { MESSAGES } from "./voiceMessages";
import { decideRestore } from "./voiceTurn";

// ── Command handler ──────────────────────────────────────────────────────────

const reply = (decision, extra = {}) => ({ decision, message_key: "k", confidence: 0.9, ...extra });
const execute = (action, args = {}) => reply("execute", { action, args });

function setup({ handlers = {}, describe = () => ({ screen: "explanation", videoId: "aircAruvnKk" }), responses = [], heard = { text: "x", language: "en" }, announcesScreens = false, screenRepliedSince = null, cue = () => {} } = {}) {
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
  const handle = createCommandHandler({ registry, speaker, deps, announcesScreens, screenRepliedSince, cue });
  return { handle, deps, said, speaker };
}
const utterance = { wav: new Blob(["w"]), before: null };

it("preserves the playback change after skipping a playing explanation by voice", async () => {
  const skip = vi.fn();
  const env = setup({
    handlers: { skip_explanation: skip },
    heard: { text: "skip the explanation", language: "en" },
    responses: [execute("skip_explanation")],
  });
  const outcome = await env.handle(utterance);
  expect(skip).toHaveBeenCalledTimes(1);
  expect(outcome).toEqual({ playbackCommand: "skip_explanation" });
  const restore = decideRestore({ lecture: "paused", explanation: "playing", pauseOwner: "intervention" }, outcome);
  expect(restore.explanation).toBe(false);
  expect(restore.restoreOwner).toBe(false);
  expect(env.said).toEqual([]);
});

describe("reading a list aloud", () => {
  const results = (n) => Array.from({ length: n }, (_, i) => ({ ref: `v${i + 1}`, kind: "result", label: `Lecture ${i + 1}.`, position: i + 1 }));

  it("reads the first page with numbers, says how to choose, and listens for the answer", async () => {
    const env = setup({ describe: () => ({ screen: "home", items: results(8) }), responses: [execute("read_list")] });
    expect(await env.handle(utterance)).toEqual({ followUp: true });
    expect(env.said).toEqual(["There are 8 results. 1: Lecture 1. 2: Lecture 2. 3: Lecture 3. To choose one, say choose, and its number. Or say read more."]);
  });

  it("continues where it stopped, then says the list has ended", async () => {
    const env = setup({ describe: () => ({ screen: "bookmarks", items: results(5) }),
      responses: [execute("read_list"), execute("read_more"), execute("read_more")] });
    await env.handle(utterance);
    await env.handle(utterance);
    expect(env.said[1]).toBe("4: Lecture 4. 5: Lecture 5. That is the end of the list. To choose one, say open, and its number.");
    await env.handle(utterance);
    expect(env.said[2]).toBe("That is the end of the list. Say read the results to hear it again.");
  });

  it("starts again from the top when the list changed since the last reading", async () => {
    let items = results(5);
    const env = setup({ describe: () => ({ screen: "library", items }), responses: [execute("read_list"), execute("read_more")] });
    await env.handle(utterance);
    items = results(2).map((item) => ({ ...item, ref: `new-${item.ref}` }));
    await env.handle(utterance);
    expect(env.said[1]).toMatch(/^There are 2 saved items\. 1: Lecture 1\. 2: Lecture 2\./);
  });

  it("says so when nothing is listed, without listening again", async () => {
    const env = setup({ describe: () => ({ screen: "notes", items: [] }), responses: [execute("read_list")] });
    expect(await env.handle(utterance)).toEqual({});
    expect(env.said).toEqual(["There is nothing listed here yet."]);
  });

  it("is not available on screens without such a list", async () => {
    const env = setup({ describe: () => ({ screen: "quiz", items: results(2) }), responses: [execute("read_list")] });
    await env.handle(utterance);
    expect(env.said).toHaveLength(1);
    expect(env.said[0]).not.toMatch(/Lecture 1/);
  });

  it("offers read_list and read_more to the interpreter on every screen", async () => {
    const env = setup({ describe: () => ({ screen: "home" }), responses: [execute("read_list")] });
    await env.handle(utterance);
    const available = env.deps.interpretText.mock.calls[0][0].context.available_actions;
    expect(available).toEqual(expect.arrayContaining(["read_list", "read_more"]));
  });
});

describe("asking how the explanations are going", () => {
  it("says how many are ready on the lecture screen", async () => {
    const env = setup({ describe: () => ({ screen: "explanation", preparationProgress: { total: 12, ready: 3, preparing: 9, failed: 0 } }),
      responses: [execute("preparation_status")] });
    await env.handle(utterance);
    expect(env.said).toEqual(["3 of 12 explanations are ready. 9 are still being prepared."]);
  });
  it("reports the processing stage while the lecture is still being processed", async () => {
    const env = setup({ describe: () => ({ screen: "explanation", preparationProgress: null, processingMessage: "Transcribing audio" }),
      responses: [execute("preparation_status")] });
    await env.handle(utterance);
    expect(env.said[0]).toMatch(/still being processed: Transcribing audio/);
  });
});

describe("sound cues", () => {
  it("play 'done' when a command works", async () => {
    const cue = vi.fn();
    const env = setup({ handlers: { set_theme: vi.fn() }, responses: [execute("set_theme", { theme: "night" })], cue });
    await env.handle(utterance);
    expect(cue.mock.calls).toEqual([["done"]]);
  });
  it.each([
    ["the command is not on this screen", { responses: [execute("set_theme", { theme: "night" })] }],
    ["the command fails", { handlers: { set_theme: () => { throw new Error("no"); } }, responses: [execute("set_theme", { theme: "night" })] }],
    ["nothing was heard", { heard: { text: "", no_speech: true } }],
    ["the server cannot be reached", { responses: [] }],
  ])("play 'error' when %s", async (_label, options) => {
    const cue = vi.fn();
    const env = setup({ ...options, cue });
    if (_label === "the server cannot be reached") env.deps.interpretText.mockRejectedValueOnce(new Error("down"));
    await env.handle(utterance);
    expect(cue.mock.calls).toEqual([["error"]]);
  });
  it("never let a broken cue stop the reply", async () => {
    const env = setup({ handlers: { set_theme: vi.fn() }, responses: [execute("set_theme", { theme: "night" })],
      cue: () => { throw new Error("no audio device"); } });
    await env.handle(utterance);
    expect(env.said).toEqual(["Okay, switch to the night theme."]);
  });
});

describe("truthful replies", () => {
  it("let the screen's own message replace the generic Okay when the screen announced its result", async () => {
    vi.useFakeTimers();
    try {
      const bookmark = vi.fn();
      const env = setup({ handlers: { toggle_bookmark: bookmark }, responses: [execute("toggle_bookmark")],
        screenRepliedSince: (since) => Date.now() >= since });
      const done = env.handle(utterance);
      await vi.advanceTimersByTimeAsync(400);
      await done;
      expect(bookmark).toHaveBeenCalledTimes(1);
      expect(env.said).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
  it("still say Okay when the screen announced nothing", async () => {
    vi.useFakeTimers();
    try {
      const env = setup({ handlers: { set_theme: vi.fn() }, responses: [execute("set_theme", { theme: "night" })],
        screenRepliedSince: () => false });
      const done = env.handle(utterance);
      await vi.advanceTimersByTimeAsync(400);
      await done;
      expect(env.said).toEqual(["Okay, switch to the night theme."]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("commands that open another screen", () => {
  it("leave the confirmation to the new screen's spoken introduction", async () => {
    const open = vi.fn();
    const env = setup({ handlers: { navigate_bookmarks: open }, describe: () => ({ screen: "home" }),
      responses: [execute("navigate_bookmarks")], announcesScreens: true });
    expect(await env.handle(utterance)).toEqual({ leftScreen: true });
    expect(open).toHaveBeenCalledTimes(1);
    expect(env.said).toEqual([]);
  });
  it("still confirm when the learner is already on that screen (no introduction follows)", async () => {
    const env = setup({ handlers: { navigate_bookmarks: vi.fn() }, describe: () => ({ screen: "bookmarks" }),
      responses: [execute("navigate_bookmarks")], announcesScreens: true });
    await env.handle(utterance);
    expect(env.said).toEqual(["Okay, open your bookmarks."]);
  });
  it("still confirm when screens are not introduced", async () => {
    const env = setup({ handlers: { navigate_bookmarks: vi.fn() }, describe: () => ({ screen: "home" }),
      responses: [execute("navigate_bookmarks")] });
    await env.handle(utterance);
    expect(env.said).toEqual(["Okay, open your bookmarks."]);
  });
  it("ask risky questions, then listen for the answer by themselves", async () => {
    const env = setup({ handlers: { remove_item: vi.fn() }, describe: () => ({ screen: "bookmarks" }),
      responses: [reply("confirm", { action: "remove_item", args: { index: 1 } })] });
    expect(await env.handle(utterance)).toEqual({ followUp: true });
    expect(env.said.at(-1)).toBe("Do you want to remove item 1? Say yes or no after the tone.");
  });
  it("tell the learner to press Alt+T when auto-listen is turned off", async () => {
    localStorage.setItem("synapse_voice_autolisten", "off");
    try {
      const env = setup({ handlers: { remove_item: vi.fn() }, describe: () => ({ screen: "bookmarks" }),
        responses: [reply("confirm", { action: "remove_item", args: { index: 1 } })] });
      await env.handle(utterance);
      expect(env.said.at(-1)).toBe("Do you want to remove item 1? Press Alt plus T and say yes or no.");
    } finally {
      localStorage.removeItem("synapse_voice_autolisten");
    }
  });
  it("listen again after asking for a missing detail, but not after a plain failure", async () => {
    const missing = setup({ describe: () => ({ screen: "home" }),
      responses: [reply("unsupported", { message_key: "missing_query" })] });
    expect(await missing.handle(utterance)).toEqual({ followUp: true });
    expect(missing.said.at(-1)).toBe("What should I search for?");
  });
  it("say nothing when Synapse listened by itself and nobody answered", async () => {
    const cue = vi.fn();
    const env = setup({ heard: { text: "", no_speech: true }, cue });
    expect(await env.handle({ ...utterance, auto: true })).toEqual({});
    expect(env.said).toEqual([]);
    expect(cue).not.toHaveBeenCalled();
  });
});

describe("saved media commands", () => {
  it("accepts a spoken yes for a confirmation opened by a button", async () => {
    const confirm = vi.fn();
    const env = setup({ handlers: { confirm_yes: confirm }, describe: () => ({ screen: "notes", pendingConfirmation: "confirm_note_deletion" }),
      responses: [execute("confirm_yes")] });
    await env.handle(utterance);
    expect(env.deps.interpretText.mock.calls[0][0].context.pending_confirmation).toBe("confirm_note_deletion");
    expect(confirm).toHaveBeenCalledTimes(1);
  });
  it("does not speak acknowledgement or restore old media over a saved explanation", async () => {
    const open = vi.fn();
    const env = setup({ handlers: { play_item_audio: open }, describe: () => ({ screen: "library" }),
      responses: [execute("play_item_audio", { index: 1 })] });
    expect(await env.handle(utterance)).toEqual({ leftScreen: true });
    expect(open).toHaveBeenCalledWith({ index: 1 });
    expect(env.said).toEqual([]);
  });
  it("refuses a positional deletion when its selected item changes before confirmation", async () => {
    let ref = "first-entry";
    const remove = vi.fn();
    const env = setup({ handlers: { remove_item: remove },
      describe: () => ({ screen: "bookmarks", items: [{ ref, kind: "bookmark", label: "An explanation", position: 1 }] }),
      responses: [reply("confirm", { action: "remove_item", args: { index: 1 } }), execute("confirm_yes")] });
    await env.handle(utterance);
    ref = "different-entry";
    await env.handle(utterance);
    expect(remove).not.toHaveBeenCalled();
    expect(env.said.at(-1)).toContain("list has changed");
  });
});

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
  it("Help clears a pending confirmation so a later yes cannot execute it", async () => {
    const remove = vi.fn();
    const env = setup({
      handlers: { remove_item: remove },
      describe: () => ({ screen: "bookmarks" }),
      responses: [reply("confirm", { action: "remove_item", args: { index: 2 } }), execute("confirm_yes")],
    });
    await env.handle(utterance);
    env.handle.cancel();
    await env.handle(utterance);
    expect(remove).not.toHaveBeenCalled();
    expect(env.said.at(-1)).toBe(MESSAGES.nothingToConfirm);
  });

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
  it("invites a question, then sends the next utterance directly to lecture Q&A at the original position", async () => {
    let lectureSeconds = 42.5;
    const env = setup({
      describe: () => ({ screen: "explanation", videoId: "aircAruvnKk", lectureSeconds }),
      heard: { text: "I want to ask a question", language: "en" },
    });
    expect(await env.handle(utterance)).toEqual({ followUp: true });
    expect(env.said).toEqual(["Ask a question."]);
    expect(env.deps.askQuestion).not.toHaveBeenCalled();
    lectureSeconds = 60;
    env.deps.transcribeAudio.mockResolvedValue({ text: "Why is the direction of current opposite?", language: "en" });
    expect(await env.handle(utterance)).toEqual({});
    expect(env.deps.askQuestion).toHaveBeenCalledWith(expect.objectContaining({
      videoId: "aircAruvnKk", currentTimeSeconds: 42.5, question: "Why is the direction of current opposite?",
    }));
    expect(env.deps.interpretText).not.toHaveBeenCalled();
    expect(env.said.at(-1)).toBe("Because it saturates.");
  });

  it("requires an open lecture before inviting a question", async () => {
    const env = setup({ describe: () => ({ screen: "home" }), heard: { text: "I want to ask a question", language: "en" } });
    expect(await env.handle(utterance)).toEqual({});
    expect(env.said).toEqual([MESSAGES.noLecture]);
    expect(env.deps.askQuestion).not.toHaveBeenCalled();
  });

  it.each(["cancel", "stop", "never mind"])("cancels the question invitation on '%s'", async (text) => {
    const env = setup({ heard: { text: "I want to ask a question", language: "en" } });
    await env.handle(utterance);
    env.deps.transcribeAudio.mockResolvedValue({ text, language: "en" });
    expect(await env.handle(utterance)).toEqual({});
    expect(env.deps.askQuestion).not.toHaveBeenCalled();
    expect(env.said.at(-1)).toBe(MESSAGES.cancelled);
  });

  it("clears a question invitation when voice control is interrupted", async () => {
    const env = setup({ heard: { text: "I want to ask a question", language: "en" }, responses: [execute("help")] });
    await env.handle(utterance);
    env.handle.cancel();
    env.deps.transcribeAudio.mockResolvedValue({ text: "help", language: "en" });
    await env.handle(utterance);
    expect(env.deps.interpretText).toHaveBeenCalledTimes(1);
    expect(env.deps.askQuestion).not.toHaveBeenCalled();
  });

  it("clears a question invitation after an empty follow-up", async () => {
    const env = setup({ heard: { text: "I want to ask a question", language: "en" }, responses: [execute("help")] });
    await env.handle(utterance);
    env.deps.transcribeAudio.mockResolvedValueOnce({ text: "", no_speech: true });
    await env.handle({ ...utterance, auto: true });
    env.deps.transcribeAudio.mockResolvedValue({ text: "help", language: "en" });
    await env.handle(utterance);
    expect(env.deps.interpretText).toHaveBeenCalledTimes(1);
    expect(env.deps.askQuestion).not.toHaveBeenCalled();
  });

  it("does not carry a question invitation into another lecture", async () => {
    let videoId = "aircAruvnKk";
    const env = setup({ describe: () => ({ screen: "explanation", videoId }),
      heard: { text: "I want to ask a question", language: "en" }, responses: [execute("help")] });
    await env.handle(utterance);
    videoId = "otherVideo1";
    env.deps.transcribeAudio.mockResolvedValue({ text: "help", language: "en" });
    await env.handle(utterance);
    expect(env.deps.interpretText).toHaveBeenCalledTimes(1);
    expect(env.deps.askQuestion).not.toHaveBeenCalled();
  });

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

  it("advertises lecture Q&A so the interpreter can route a spoken content question", async () => {
    const question = "why is the direction of current opposite ?";
    const env = setup({ heard: { text: question, language: "en" } });
    env.deps.interpretText.mockImplementation(async (request) => {
      if (!request.context.available_actions.includes("ask_question")) {
        return reply("unsupported", { message_key: "not_understood" });
      }
      return reply("ask_question", { action: "ask_question", args: { question } });
    });
    await env.handle(utterance);
    expect(env.deps.interpretText).toHaveBeenCalledWith(expect.objectContaining({
      text: question,
      context: expect.objectContaining({ available_actions: expect.arrayContaining(["ask_question"]) }),
    }), expect.any(Object));
    expect(env.deps.askQuestion).toHaveBeenCalledWith(expect.objectContaining({ question, videoId: "aircAruvnKk" }));
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

describe("explanation question answers", () => {
  it("sends the active question and executes only an offered choice without an overlapping acknowledgement", async () => {
    const answer = vi.fn();
    const env = setup({
      handlers: { answer_explanation: answer },
      describe: () => ({ screen: "explanation", explanationQuestion: { id: "q1", choices: ["listen", "skip"] }, questionPrompt: "Listen or skip?" }),
      responses: [execute("answer_explanation", { choice: "listen" })],
    });
    expect(await env.handle({ ...utterance, before: { questionId: "q1" } })).toEqual({ playbackCommand: "answer_explanation" });
    expect(answer).toHaveBeenCalledWith({ choice: "listen" });
    expect(env.said).toEqual([]);
    expect(env.deps.interpretText.mock.calls[0][0].context.explanation_question).toEqual({ id: "q1", choices: ["listen", "skip"] });
  });
  it("discards an answer when the active question changed during recording", async () => {
    const answer = vi.fn();
    const env = setup({ handlers: { answer_explanation: answer }, describe: () => ({ screen: "explanation", explanationQuestion: { id: "q2", choices: ["yes", "no"] } }) });
    await env.handle({ ...utterance, before: { questionId: "q1" } });
    expect(env.deps.interpretText).not.toHaveBeenCalled();
    expect(answer).not.toHaveBeenCalled();
  });
  it("discards an interpreted answer if the question changed during interpretation", async () => {
    const answer = vi.fn();
    let id = "q1";
    const env = setup({ handlers: { answer_explanation: answer }, describe: () => ({ screen: "explanation", explanationQuestion: { id, choices: ["listen", "skip"] } }) });
    env.deps.interpretText.mockImplementation(async () => { id = "q2"; return execute("answer_explanation", { choice: "listen" }); });
    await env.handle({ ...utterance, before: { questionId: "q1" } });
    expect(answer).not.toHaveBeenCalled();
  });
  it("does not run a choice absent from the current question", async () => {
    const answer = vi.fn();
    const env = setup({ handlers: { answer_explanation: answer }, describe: () => ({ screen: "explanation", explanationQuestion: { id: "q1", choices: ["listen", "skip"] } }), responses: [execute("answer_explanation", { choice: "detailed" })] });
    await env.handle({ ...utterance, before: { questionId: "q1" } });
    expect(answer).not.toHaveBeenCalled();
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
