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
  "request_explanation",
  "play_lecture", "pause_lecture", "seek_lecture", "play_explanation", "pause_explanation",
  "replay_explanation", "next_moment", "previous_moment", "go_to_moment", "toggle_voice_note",
  "play_item_audio", "play_note", "stop_note_audio", "open_note_explanation",
  "open_item", "read_saved_item",
  "open_note",
]);

// Commands that take the learner to another screen: the lecture they came from must never start again.
// (The screen may not have unmounted yet when the turn ends, so the turn is told directly.)
export const LEAVING_COMMANDS = new Set([
  "navigate_home", "navigate_library", "navigate_bookmarks", "navigate_notes", "open_timeline", "start_practice",
  "explore_subject", "continue_lecture", "start_lecture", "open_item", "quiz_back",
  "read_saved_item", "open_note_explanation", "play_item_audio",
  "open_note",
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
  const say = (text, signal) => signal?.aborted ? undefined : speaker.say(text);
  let pending = null; // { action, args } waiting for yes / no
  let lastAction = null;

  const buildContext = (before) =>
    buildVoiceContext({
      ...registry.context(),
      ...(before?.lectureSeconds !== undefined ? { lectureSeconds: before.lectureSeconds } : {}),
      ...(before?.currentMomentRef !== undefined ? { currentMomentRef: before.currentMomentRef } : {}),
      playing: before === undefined ? undefined : playingFromSnapshot(before),
      availableActions: [...Object.keys(registry.handlers()), ...VOICE_LAYER],
      pendingConfirmation: pending?.action ?? registry.context().pendingConfirmation ?? null,
      lastAction,
    });

  async function ask(question, ctx, signal) {
    if (signal?.aborted) return {};
    if (!ctx.video_id) {
      await say(MESSAGES.noLecture, signal);
      return {};
    }
    await say(MESSAGES.checking, signal);
    if (signal?.aborted) return {};
    try {
      const answer = await api.askQuestion({
        videoId: ctx.video_id,
        question,
        currentTimeSeconds: ctx.lecture_seconds,
        interventionId: ctx.current_moment_ref,
        signal,
      });
      await say(answer.answer_text, signal);
    } catch (err) {
      await say(err?.message || MESSAGES.failed, signal);
    }
    return {};
  }

  // "How do I bookmark this?": answered from the action list, with no LLM. The backend names the action the
  // question is about (candidates[1]); we say how to ask for it here, or on which screen it works.
  async function answerAppQuestion(parsed, ctx, signal) {
    const about = parsed.candidates?.find((c) => c.action !== "app_question" && ACTIONS[c.action]);
    if (!about || about.score < 0.4) {
      await say(MESSAGES.appQuestionUnknown, signal);
      return {};
    }
    const spec = ACTIONS[about.action];
    const phrase = actionPhrase(about.action, {});
    const here = spec.screens.includes("*") || spec.screens.includes(ctx.screen);
    await say(here ? MESSAGES.appHowTo(phrase) : MESSAGES.appElsewhere(phrase, spec.screens), signal);
    return {};
  }

  async function execute(action, args, ctx, parsed, signal) {
    if (signal?.aborted) return {};
    switch (action) {
      case "app_question": return answerAppQuestion(parsed, ctx, signal);
      case "where_am_i": await say(whereAmI(ctx.screen, registry.context().items?.length ?? 0), signal); return {};
      case "stop_speaking": speaker.stop(); return {};
      case "repeat_last_response": await say(registry.context().questionPrompt || speaker.last() || MESSAGES.nothingToRepeat, signal); return {};
      case "cancel": pending = null; await registry.handlers().confirm_no?.(); await say(MESSAGES.okay, signal); return {};
      case "help": await say(helpText(ctx.screen), signal); return {};
      case "confirm_no": pending = null; await registry.handlers().confirm_no?.(); await say(MESSAGES.cancelled, signal); return {};
      case "confirm_yes": {
        if (!pending) {
          const confirm = registry.handlers().confirm_yes;
          if (confirm) {
            try { await confirm(); } catch { await say(MESSAGES.failed, signal); }
          } else await say(MESSAGES.nothingToConfirm, signal);
          return {};
        }
        const { action: next, args: nextArgs, screen: originalScreen, ref, draftRef, confirmationRef } = pending;
        pending = null;
        if (originalScreen && (ctx.screen !== originalScreen || (ref && registry.context().items?.find((item) => item.position === nextArgs.index)?.ref !== ref))) {
          await say("The list has changed. Please select the item again.", signal);
          return {};
        }
        if (draftRef && registry.context().draftRef !== draftRef) {
          await say("The recording draft has changed. Please select it again.", signal);
          return {};
        }
        if ((registry.context().confirmationRef || null) !== confirmationRef) {
          await say("The confirmation has changed. Please confirm the current selection again.", signal);
          return {};
        }
        return execute(next, nextArgs, ctx, undefined, signal);
      }
      default: break;
    }
    const handler = registry.handlers()[action];
    if (!handler) {
      await say(MESSAGES.unavailable, signal);
      return {};
    }
    // Act first, then say so: speech takes seconds and the learner should see the result at once.
    try {
      await handler(action === "request_explanation" ? { ...args, requestContext: {
        lectureSeconds: ctx.lecture_seconds, currentMomentRef: ctx.current_moment_ref,
        playing: ctx.playing, useSelected: Boolean(args.depth || ctx.explanation_question),
      } } : args);
    } catch (err) {
      await say(err?.spoken || MESSAGES.failed, signal);
      return {};
    }
    if (!PLAYBACK_COMMANDS.has(action)) await say(`Okay, ${actionPhrase(action, args)}.`, signal);
    if (signal?.aborted) return {};
    lastAction = action;
    if (LEAVING_COMMANDS.has(action)) return { leftScreen: true };
    return PLAYBACK_COMMANDS.has(action) ? { playbackCommand: action } : {};
  }

  /** The onUtterance callback for the voice turn. Resolves to { playbackCommand? }. */
  const handleUtterance = async (utterance) => {
    const { signal } = utterance;
    if (signal?.aborted) return {};
    if (utterance.before?.videoId && utterance.before.videoId !== registry.context().videoId) return {};
    let heard;
    try {
      heard = await api.transcribeAudio(utterance.wav, { signal });
    } catch {
      await say(MESSAGES.offline, signal);
      return {};
    }
    if (signal?.aborted) return {};
    if (utterance.before?.questionId !== undefined &&
        utterance.before.questionId !== (registry.context().explanationQuestion?.id ?? null)) return {};
    if (heard.language && !heard.language.toLowerCase().startsWith("en") && (heard.language_probability ?? 1) >= 0.8) {
      await say("Please answer in English. " + (registry.context().questionPrompt || ""), signal);
      return {};
    }
    if (heard.no_speech || !heard.text?.trim()) {
      await say(MESSAGES.heardNothing, signal);
      return {};
    }

    let ctx;
    let parsed;
    try {
      ctx = buildContext(utterance.before);
      const language = (heard.language_probability ?? 1) >= 0.8 ? heard.language : "en";
      parsed = parseInterpretResponse(await api.interpretText(buildInterpretRequest(heard.text, ctx, language), { signal }), ctx.screen);
    } catch {
      await say(MESSAGES.offline, signal);
      return {};
    }
    if (signal?.aborted) return {};
    if (!parsed) {
      await say(MESSAGES.notUnderstood, signal);
      return {};
    }
    if (utterance.before?.questionId !== undefined &&
        utterance.before.questionId !== (registry.context().explanationQuestion?.id ?? null)) return {};
    if (utterance.before?.videoId && utterance.before.videoId !== registry.context().videoId) return {};
    if (parsed.action === "answer_explanation" && parsed.decision === "execute") {
      const question = registry.context().explanationQuestion;
      if (!question?.choices.includes(parsed.args.choice)) return {};
      await registry.handlers().answer_explanation?.(parsed.args);
      return { playbackCommand: "answer_explanation" };
    }
    if (pending && parsed.action !== "confirm_yes" && parsed.action !== "confirm_no") pending = null; // moved on

    switch (parsed.decision) {
      case "execute":
        return execute(parsed.action, parsed.args, ctx, parsed, signal);
      case "confirm":
        pending = { action: parsed.action, args: parsed.args, screen: ctx.screen,
          ref: ctx.items?.find((item) => item.position === parsed.args.index)?.ref,
          draftRef: ["save_note_draft", "discard_note_draft"].includes(parsed.action) ? registry.context().draftRef : null,
          confirmationRef: registry.context().confirmationRef || null };
        await say(`Do you want to ${actionPhrase(parsed.action, parsed.args)}? Press Alt+T and say yes or no.`, signal);
        return {};
      case "clarify": {
        const [a, b] = parsed.candidates;
        await say(`Did you mean ${actionPhrase(a.action, a.args)}, or ${actionPhrase(b.action, b.args)}?`, signal);
        return {};
      }
      case "ask_question":
        return ask(parsed.args.question, ctx, signal);
      default:
        await say(parsed.messageKey === "english_only" ? "Please answer in English." :
          (registry.context().questionPrompt ? "I am not sure which option you mean. " + registry.context().questionPrompt : missingMessage(parsed.messageKey)), signal);
        return {};
    }
  };
  handleUtterance.cancel = () => { pending = null; };
  return handleUtterance;
}
