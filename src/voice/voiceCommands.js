// From a recorded utterance to a done thing:  transcribe -> interpret -> validate -> run -> speak.
// Each step is its own function so any can be replaced (a different recogniser, another language).
//
// Safety rules:
//  - nothing runs unless the server's answer validates (contract.parseInterpretResponse) and the action
//    belongs to the current screen
//  - risky actions (and uncertain ones) are only asked about; the learner answers yes or no on the next turn
//  - replies are spoken BEFORE the action runs, so they never overlap audio the action starts
//  - a spoken playback command is reported back so the audio that was paused is not resumed over it

import { buildInterpretRequest, buildVoiceContext, parseInterpretResponse } from "./contract.js";
import { interpretText, transcribeAudio } from "./voiceApi.js";
import { ACTIONS } from "./actions.generated.js";
import { askQuestion } from "../lib/askApi.js";
import { MESSAGES, actionPhrase, helpText, missingMessage, whereAmI } from "./voiceMessages.js";

// Handled here, not by any screen.
export const VOICE_LAYER = ["stop_speaking", "repeat_last_response", "cancel", "help", "app_question", "where_am_i", "confirm_yes", "confirm_no"];

// Commands that change what is playing: after them the paused audio must stay as the command left it.
export const PLAYBACK_COMMANDS = new Set([
  "play_lecture", "pause_lecture", "seek_lecture", "play_explanation", "pause_explanation",
  "replay_explanation", "next_moment", "previous_moment", "go_to_moment", "toggle_voice_note",
]);

// Commands that take the learner to another screen: the lecture they came from must never start again.
// (The screen may not have unmounted yet when the turn ends, so the turn is told directly.)
export const LEAVING_COMMANDS = new Set([
  "navigate_home", "navigate_library", "navigate_bookmarks", "navigate_notes", "open_timeline", "start_practice",
  "explore_subject", "continue_lecture", "start_lecture", "open_item", "quiz_back",
]);

/** What was audibly playing before the turn paused everything ("pause" then means the right thing). */
export function playingFromSnapshot(snapshot) {
  if (!snapshot) return "unknown";
  if ((snapshot.lecture === "playing" || snapshot.lecture === "buffering") && !snapshot.pauseOwner) return "lecture";
  if (snapshot.explanation === "playing") return "explanation";
  return "none";
}

export function createCommandHandler({ registry, speaker, deps = {} }) {
  const api = { transcribeAudio, interpretText, askQuestion, ...deps };
  const say = (text) => speaker.say(text);
  let pending = null; // { action, args } waiting for yes / no
  let lastAction = null;

  const buildContext = (before) =>
    buildVoiceContext({
      ...registry.context(),
      playing: before === undefined ? undefined : playingFromSnapshot(before),
      availableActions: [...Object.keys(registry.handlers()), ...VOICE_LAYER],
      pendingConfirmation: pending?.action ?? null,
      lastAction,
    });

  async function ask(question, ctx) {
    if (!ctx.video_id) {
      await say(MESSAGES.noLecture);
      return {};
    }
    await say(MESSAGES.checking);
    try {
      const answer = await api.askQuestion({
        videoId: ctx.video_id,
        question,
        currentTimeSeconds: ctx.lecture_seconds,
        interventionId: ctx.current_moment_ref,
      });
      await say(answer.answer_text);
    } catch (err) {
      await say(err?.message || MESSAGES.failed);
    }
    return {};
  }

  // "How do I bookmark this?": answered from the action list, with no LLM. The backend names the action the
  // question is about (candidates[1]); we say how to ask for it here, or on which screen it works.
  async function answerAppQuestion(parsed, ctx) {
    const about = parsed.candidates?.find((c) => c.action !== "app_question" && ACTIONS[c.action]);
    if (!about || about.score < 0.4) {
      await say(MESSAGES.appQuestionUnknown);
      return {};
    }
    const spec = ACTIONS[about.action];
    const phrase = actionPhrase(about.action, {});
    const here = spec.screens.includes("*") || spec.screens.includes(ctx.screen);
    await say(here ? MESSAGES.appHowTo(phrase) : MESSAGES.appElsewhere(phrase, spec.screens));
    return {};
  }

  async function execute(action, args, ctx, parsed) {
    switch (action) {
      case "app_question": return answerAppQuestion(parsed, ctx);
      case "where_am_i": await say(whereAmI(ctx.screen, registry.context().items?.length ?? 0)); return {};
      case "stop_speaking": speaker.stop(); return {};
      case "repeat_last_response": await say(speaker.last() || MESSAGES.nothingToRepeat); return {};
      case "cancel": pending = null; await say(MESSAGES.okay); return {};
      case "help": await say(helpText(ctx.screen)); return {};
      case "confirm_no": pending = null; await say(MESSAGES.cancelled); return {};
      case "confirm_yes": {
        if (!pending) { await say(MESSAGES.nothingToConfirm); return {}; }
        const { action: next, args: nextArgs } = pending;
        pending = null;
        return execute(next, nextArgs, ctx);
      }
      default: break;
    }
    const handler = registry.handlers()[action];
    if (!handler) {
      await say(MESSAGES.unavailable);
      return {};
    }
    // Act first, then say so: speech takes seconds and the learner should see the result at once.
    try {
      await handler(args);
    } catch (err) {
      await say(err?.spoken || MESSAGES.failed);
      return {};
    }
    await say(`Okay, ${actionPhrase(action, args)}.`);
    lastAction = action;
    if (PLAYBACK_COMMANDS.has(action)) return { playbackCommand: action };
    return LEAVING_COMMANDS.has(action) ? { leftScreen: true } : {};
  }

  /** The onUtterance callback for the voice turn. Resolves to { playbackCommand? }. */
  return async function handleUtterance(utterance) {
    let heard;
    try {
      heard = await api.transcribeAudio(utterance.wav);
    } catch {
      await say(MESSAGES.offline);
      return {};
    }
    if (heard.no_speech || !heard.text?.trim()) {
      await say(MESSAGES.heardNothing);
      return {};
    }

    let ctx;
    let parsed;
    try {
      ctx = buildContext(utterance.before);
      parsed = parseInterpretResponse(await api.interpretText(buildInterpretRequest(heard.text, ctx, heard.language)), ctx.screen);
    } catch {
      await say(MESSAGES.offline);
      return {};
    }
    if (!parsed) {
      await say(MESSAGES.notUnderstood);
      return {};
    }
    if (pending && parsed.action !== "confirm_yes" && parsed.action !== "confirm_no") pending = null; // moved on

    switch (parsed.decision) {
      case "execute":
        return execute(parsed.action, parsed.args, ctx, parsed);
      case "confirm":
        pending = { action: parsed.action, args: parsed.args };
        await say(`Do you want to ${actionPhrase(parsed.action, parsed.args)}? Press Alt+T and say yes or no.`);
        return {};
      case "clarify": {
        const [a, b] = parsed.candidates;
        await say(`Did you mean ${actionPhrase(a.action, a.args)}, or ${actionPhrase(b.action, b.args)}?`);
        return {};
      }
      case "ask_question":
        return ask(parsed.args.question, ctx);
      default:
        await say(missingMessage(parsed.messageKey));
        return {};
    }
  };
}
