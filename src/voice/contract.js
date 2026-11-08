// Voice control contract: what the app sends to the voice backend and what it
// accepts back. The action list itself is generated from the backend catalog
// (actions.generated.js); this file adds the checks around it.
//
// The rule that matters most: the frontend never acts on a response it could
// not validate. A malformed or unknown response is treated as "not understood",
// never guessed at.

import { ACTIONS, DECISIONS, PLAYING_STATES, SCREENS } from "./actions.generated.js";

export { ACTIONS, DECISIONS, PLAYING_STATES, SCREENS };

// Same limits as the backend schemas (voice/schemas.py).
export const MAX_UTTERANCE_CHARS = 300;
export const MAX_CONTEXT_ITEMS = 60;
export const MAX_LABEL_CHARS = 160;
export const MAX_REF_CHARS = 64;

const ITEM_KINDS = ["result", "moment", "bookmark", "library_item", "note", "subject"];
const LANGUAGE_RE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function isKnownAction(actionId) {
  return typeof actionId === "string" && Object.hasOwn(ACTIONS, actionId);
}

/** True when the action may run on this screen ("*" means every screen). */
export function isActionAllowedOn(actionId, screen) {
  if (!isKnownAction(actionId)) return false;
  const { screens } = ACTIONS[actionId];
  return screens.includes("*") || screens.includes(screen);
}

/**
 * Check args against the action's parameter spec.
 * Returns { ok: true, args } with a clean copy, or { ok: false, error }.
 */
export function validateActionArgs(actionId, args) {
  if (!isKnownAction(actionId)) return { ok: false, error: `unknown action: ${actionId}` };
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return { ok: false, error: "args must be an object" };
  }
  const { params } = ACTIONS[actionId];
  const unexpected = Object.keys(args).filter((name) => !Object.hasOwn(params, name));
  if (unexpected.length) return { ok: false, error: `unexpected arguments: ${unexpected.join(", ")}` };

  const clean = {};
  for (const [name, spec] of Object.entries(params)) {
    const value = args[name];
    if (value === undefined || value === null) {
      if (spec.required) return { ok: false, error: `missing argument: ${name}` };
      continue;
    }
    if (spec.type === "int") {
      if (!Number.isInteger(value)) return { ok: false, error: `${name} must be an integer` };
      if (value < spec.min || value > spec.max) {
        return { ok: false, error: `${name} must be between ${spec.min} and ${spec.max}` };
      }
      clean[name] = value;
    } else if (spec.type === "string") {
      if (typeof value !== "string" || !value.trim()) return { ok: false, error: `${name} must be text` };
      const trimmed = value.trim();
      if (trimmed.length > spec.max_length) return { ok: false, error: `${name} is too long` };
      clean[name] = trimmed;
    } else {
      if (!spec.values.includes(value)) return { ok: false, error: `${name} must be one of ${spec.values.join(", ")}` };
      clean[name] = value;
    }
  }
  return { ok: true, args: clean };
}

function parseCandidates(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const entry of list.slice(0, 3)) {
    if (!entry || !isKnownAction(entry.action)) continue;
    if (typeof entry.score !== "number" || !Number.isFinite(entry.score)) continue;
    const checked = validateActionArgs(entry.action, entry.args ?? {});
    out.push({
      action: entry.action,
      score: Math.min(1, Math.max(0, entry.score)),
      // Candidate arguments are advisory (a clarification question may name them); a bad set is dropped.
      args: checked.ok ? checked.args : {},
    });
  }
  return out;
}

/**
 * Turn the backend's /voice/interpret JSON into a response the app can trust,
 * or null when it is malformed, inconsistent or names something unknown.
 * `screen` is where the user is now: an action that does not belong on this
 * screen is refused even if the backend says to run it.
 */
export function parseInterpretResponse(data, screen) {
  if (!data || typeof data !== "object") return null;
  if (!DECISIONS.includes(data.decision)) return null;
  if (typeof data.message_key !== "string" || !data.message_key) return null;

  const candidates = parseCandidates(data.candidates);
  const confidence =
    typeof data.confidence === "number" && Number.isFinite(data.confidence)
      ? Math.min(1, Math.max(0, data.confidence))
      : 0;
  const base = {
    decision: data.decision,
    action: null,
    args: {},
    confidence,
    candidates,
    messageKey: data.message_key,
    language: typeof data.language === "string" && LANGUAGE_RE.test(data.language) ? data.language : null,
  };

  switch (data.decision) {
    case "execute":
    case "confirm":
    case "ask_question": {
      if (!isActionAllowedOn(data.action, screen)) return null;
      if (data.decision === "ask_question" && data.action !== "ask_question") return null;
      const checked = validateActionArgs(data.action, data.args ?? {});
      if (!checked.ok) return null;
      return { ...base, action: data.action, args: checked.args };
    }
    case "clarify":
      return candidates.length >= 2 ? base : null;
    default: // unsupported, no_speech
      return data.action ? null : base;
  }
}

function clip(text, max) {
  const value = String(text ?? "").trim();
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Build the context object sent with each utterance. Everything is bounded and
 * cleaned here so the backend's validation never rejects a real request:
 * labels are clipped, duplicate refs dropped, only known actions that belong on
 * this screen are listed, and nothing optional is sent when unknown.
 */
export function buildVoiceContext({
  screen,
  videoId = null,
  currentMomentRef = null,
  playing = "unknown",
  presentationMode = null,
  lectureSeconds = null,
  items = [],
  availableActions = [],
  pendingConfirmation = null,
  lastAction = null,
  languageHint = null,
} = {}) {
  if (!SCREENS.includes(screen)) throw new Error(`unknown screen: ${screen}`);

  const seen = new Set();
  const cleanItems = [];
  for (const item of items) {
    if (cleanItems.length >= MAX_CONTEXT_ITEMS) break;
    const ref = clip(item?.ref, MAX_REF_CHARS);
    const label = clip(item?.label, MAX_LABEL_CHARS);
    if (!ref || !label || seen.has(ref)) continue;
    if (!ITEM_KINDS.includes(item.kind) || !Number.isInteger(item.position) || item.position < 1) continue;
    seen.add(ref);
    cleanItems.push({ ref, kind: item.kind, label, position: item.position });
  }

  const context = {
    screen,
    playing: PLAYING_STATES.includes(playing) ? playing : "unknown",
    items: cleanItems,
    available_actions: [...new Set(availableActions)].filter((id) => isActionAllowedOn(id, screen)),
  };
  if (typeof videoId === "string" && VIDEO_ID_RE.test(videoId)) context.video_id = videoId;
  if (currentMomentRef) context.current_moment_ref = clip(currentMomentRef, MAX_REF_CHARS);
  if (presentationMode === "accessibility" || presentationMode === "study") {
    context.presentation_mode = presentationMode;
  }
  if (typeof lectureSeconds === "number" && Number.isFinite(lectureSeconds) && lectureSeconds >= 0 && lectureSeconds <= 172_800) {
    context.lecture_seconds = lectureSeconds;
  }
  if (isKnownAction(pendingConfirmation)) context.pending_confirmation = pendingConfirmation;
  if (isKnownAction(lastAction)) context.last_action = lastAction;
  if (typeof languageHint === "string" && LANGUAGE_RE.test(languageHint)) context.language_hint = languageHint;
  return context;
}

/** Body for POST /voice/interpret. Throws when there is nothing to interpret. */
export function buildInterpretRequest(text, context, language = null) {
  const clean = clip(text, MAX_UTTERANCE_CHARS);
  if (!clean) throw new Error("nothing to interpret");
  const body = { text: clean, context };
  if (typeof language === "string" && LANGUAGE_RE.test(language)) body.language = language;
  return body;
}
