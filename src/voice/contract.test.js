import { describe, it, expect } from "vitest";
import {
  ACTIONS,
  DECISIONS,
  SCREENS,
  MAX_CONTEXT_ITEMS,
  MAX_LABEL_CHARS,
  MAX_UTTERANCE_CHARS,
  buildInterpretRequest,
  buildVoiceContext,
  isActionAllowedOn,
  isKnownAction,
  parseInterpretResponse,
  validateActionArgs,
} from "./contract";

const item = (ref, position, extra = {}) => ({ ref, kind: "moment", label: `Moment ${position}`, position, ...extra });

describe("generated action list", () => {
  it("describes every action with the fields the app relies on", () => {
    expect(Object.keys(ACTIONS).length).toBeGreaterThanOrEqual(30);
    for (const [id, spec] of Object.entries(ACTIONS)) {
      expect(id).toMatch(/^[a-z][a-z0-9_]+$/);
      expect(spec.screens.length).toBeGreaterThan(0);
      for (const screen of spec.screens) expect(screen === "*" || SCREENS.includes(screen)).toBe(true);
      expect(["low", "confirm"]).toContain(spec.risk);
      expect(["existing", "wrapper", "voice"]).toContain(spec.bindingStatus);
    }
  });

  it("knows the decisions the backend can return", () => {
    expect(DECISIONS).toEqual(["execute", "confirm", "clarify", "ask_question", "unsupported", "no_speech"]);
  });

  it("only recognises its own actions (not inherited object keys)", () => {
    expect(isKnownAction("next_moment")).toBe(true);
    expect(isKnownAction("toString")).toBe(false);
    expect(isKnownAction("__proto__")).toBe(false);
    expect(isKnownAction(42)).toBe(false);
  });

  it("knows which screens an action belongs to", () => {
    expect(isActionAllowedOn("navigate_home", "quiz")).toBe(true);
    expect(isActionAllowedOn("play_lecture", "explanation")).toBe(true);
    expect(isActionAllowedOn("play_lecture", "library")).toBe(false);
    expect(isActionAllowedOn("nope", "home")).toBe(false);
  });
});

describe("validateActionArgs", () => {
  it("accepts and cleans valid arguments", () => {
    expect(validateActionArgs("seek_lecture", { direction: "forward", seconds: 30 })).toEqual({
      ok: true,
      args: { direction: "forward", seconds: 30 },
    });
    expect(validateActionArgs("ask_question", { question: "  why?  " })).toEqual({ ok: true, args: { question: "why?" } });
    expect(validateActionArgs("next_moment", {})).toEqual({ ok: true, args: {} });
  });

  it.each([
    ["seek_lecture", { direction: "forward" }],
    ["seek_lecture", { direction: "up", seconds: 5 }],
    ["seek_lecture", { direction: "forward", seconds: 0 }],
    ["seek_lecture", { direction: "forward", seconds: 601 }],
    ["seek_lecture", { direction: "forward", seconds: "30" }],
    ["seek_lecture", { direction: "forward", seconds: 1.5 }],
    ["next_moment", { index: 1 }],
    ["ask_question", { question: "   " }],
    ["ask_question", { question: "x".repeat(501) }],
    ["set_theme", { theme: "neon" }],
    ["go_to_moment", { index: null }],
    ["next_moment", null],
    ["next_moment", []],
    ["not_an_action", {}],
  ])("rejects %s %j", (action, args) => {
    expect(validateActionArgs(action, args).ok).toBe(false);
  });
});

describe("parseInterpretResponse", () => {
  const ok = (extra) => ({ decision: "execute", action: "next_moment", args: {}, confidence: 0.9, message_key: "done", ...extra });

  it("accepts a valid execute response", () => {
    const parsed = parseInterpretResponse(ok(), "explanation");
    expect(parsed).toMatchObject({ decision: "execute", action: "next_moment", args: {}, confidence: 0.9, messageKey: "done" });
  });

  it("cleans arguments and clamps confidence", () => {
    const parsed = parseInterpretResponse(
      ok({ action: "seek_lecture", args: { direction: "backward", seconds: 15 }, confidence: 7 }),
      "explanation",
    );
    expect(parsed.args).toEqual({ direction: "backward", seconds: 15 });
    expect(parsed.confidence).toBe(1);
  });

  it("refuses an action that does not belong on the current screen", () => {
    expect(parseInterpretResponse(ok(), "library")).toBeNull();
  });

  it.each([
    [null],
    ["text"],
    [{}],
    [{ decision: "dance", message_key: "x" }],
    [{ decision: "execute", action: "next_moment", args: {} }],
    [{ decision: "execute", action: "nope", args: {}, message_key: "x" }],
    [{ decision: "execute", action: "seek_lecture", args: {}, message_key: "x" }],
    [{ decision: "execute", message_key: "x" }],
    [{ decision: "unsupported", action: "next_moment", message_key: "x" }],
    [{ decision: "ask_question", action: "next_moment", args: {}, message_key: "x" }],
    [{ decision: "ask_question", action: "ask_question", args: {}, message_key: "x" }],
    [{ decision: "clarify", candidates: [{ action: "pause_lecture", score: 0.5 }], message_key: "x" }],
  ])("returns null for malformed response %j", (data) => {
    expect(parseInterpretResponse(data, "explanation")).toBeNull();
  });

  it("accepts confirm, with the arguments to confirm", () => {
    const parsed = parseInterpretResponse(
      { decision: "confirm", action: "remove_item", args: { index: 2 }, confidence: 0.6, message_key: "confirm_remove" },
      "bookmarks",
    );
    expect(parsed).toMatchObject({ decision: "confirm", action: "remove_item", args: { index: 2 } });
  });

  it("accepts ask_question only for the ask_question action", () => {
    const parsed = parseInterpretResponse(
      { decision: "ask_question", action: "ask_question", args: { question: "why is it flat" }, message_key: "asking" },
      "explanation",
    );
    expect(parsed.args).toEqual({ question: "why is it flat" });
  });

  it("accepts clarify with two candidates and drops unknown ones", () => {
    const parsed = parseInterpretResponse(
      {
        decision: "clarify",
        message_key: "which_one",
        candidates: [
          { action: "pause_lecture", score: 0.51 },
          { action: "pause_explanation", score: 0.5 },
          { action: "launch_missiles", score: 0.4 },
        ],
      },
      "explanation",
    );
    expect(parsed.candidates.map((c) => c.action)).toEqual(["pause_lecture", "pause_explanation"]);
  });

  it("accepts unsupported and no_speech without an action", () => {
    expect(parseInterpretResponse({ decision: "unsupported", message_key: "not_understood" }, "home").action).toBeNull();
    expect(parseInterpretResponse({ decision: "no_speech", message_key: "heard_nothing" }, "home").decision).toBe("no_speech");
  });

  it("ignores an invalid language but keeps the response", () => {
    const parsed = parseInterpretResponse(ok({ language: "klingon!" }), "explanation");
    expect(parsed.language).toBeNull();
  });
});

describe("buildVoiceContext", () => {
  it("builds a minimal context", () => {
    expect(buildVoiceContext({ screen: "home" })).toEqual({
      screen: "home",
      playing: "unknown",
      items: [],
      available_actions: [],
    });
  });

  it("throws for an unknown screen", () => {
    expect(() => buildVoiceContext({ screen: "settings" })).toThrow();
    expect(() => buildVoiceContext()).toThrow();
  });

  it("includes optional fields only when valid", () => {
    const ctx = buildVoiceContext({
      screen: "explanation",
      videoId: "aircAruvnKk",
      currentMomentRef: "m2",
      playing: "lecture",
      presentationMode: "study",
      lectureSeconds: 187.5,
      pendingConfirmation: "remove_item",
      lastAction: "next_moment",
      languageHint: "en",
    });
    expect(ctx).toMatchObject({
      video_id: "aircAruvnKk",
      current_moment_ref: "m2",
      playing: "lecture",
      presentation_mode: "study",
      lecture_seconds: 187.5,
      pending_confirmation: "remove_item",
      last_action: "next_moment",
      language_hint: "en",
    });

    const bad = buildVoiceContext({
      screen: "explanation",
      videoId: "short",
      playing: "music",
      presentationMode: "fancy",
      lectureSeconds: -3,
      pendingConfirmation: "nope",
      languageHint: "english",
    });
    expect(bad).toEqual({ screen: "explanation", playing: "unknown", items: [], available_actions: [] });
  });

  it("drops duplicate refs, bad items, and clips long labels", () => {
    const ctx = buildVoiceContext({
      screen: "timeline",
      items: [
        item("m1", 1),
        item("m1", 2),
        item("m3", 0),
        item("m4", 3, { kind: "planet" }),
        { ref: "", kind: "moment", label: "x", position: 1 },
        item("m5", 4, { label: "y".repeat(500) }),
      ],
    });
    expect(ctx.items.map((i) => i.ref)).toEqual(["m1", "m5"]);
    expect(ctx.items[1].label).toHaveLength(MAX_LABEL_CHARS);
  });

  it("caps the number of items", () => {
    const items = Array.from({ length: MAX_CONTEXT_ITEMS + 25 }, (_, i) => item(`m${i}`, i + 1));
    expect(buildVoiceContext({ screen: "explanation", items }).items).toHaveLength(MAX_CONTEXT_ITEMS);
  });

  it("lists only known actions that belong on the screen, once each", () => {
    const ctx = buildVoiceContext({
      screen: "library",
      availableActions: ["navigate_home", "navigate_home", "play_item_audio", "play_lecture", "bogus"],
    });
    expect(ctx.available_actions).toEqual(["navigate_home", "play_item_audio"]);
  });
});

describe("buildInterpretRequest", () => {
  const context = buildVoiceContext({ screen: "home" });

  it("trims the text and keeps a valid language", () => {
    expect(buildInterpretRequest("  open bookmarks  ", context, "en")).toEqual({
      text: "open bookmarks",
      context,
      language: "en",
    });
  });

  it("omits an invalid language and clips long text", () => {
    const body = buildInterpretRequest("a".repeat(1000), context, "english");
    expect(body.text).toHaveLength(MAX_UTTERANCE_CHARS);
    expect("language" in body).toBe(false);
  });

  it("refuses an empty utterance", () => {
    expect(() => buildInterpretRequest("   ", context)).toThrow();
  });
});
