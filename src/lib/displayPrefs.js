// Display preferences for the QUIZ screen only (docs/QUIZ_CONTRACT.md section 9.3).
//
// INTERIM decision: the lecture screen keeps its own unsaved text-size / high-contrast state in
// Explanation.jsx and is not changed here, so the two screens do NOT share settings. Sharing one
// saved setting is future work that needs the owner of Explanation.jsx. The quiz keys are
// separate so that work can migrate them later without touching lecture behaviour.
//
// Same values as the lecture screen: text scale 0.85 to 1.6 in steps of 0.15 (default 1);
// high contrast is a boolean. localStorage is optional: every read and write is guarded and a
// missing, blocked or corrupt value falls back to the default.

export const QUIZ_TEXT_SCALE_KEY = "synapse_quiz_text_scale";
export const QUIZ_HIGH_CONTRAST_KEY = "synapse_quiz_high_contrast";

export const TEXT_SCALE_DEFAULT = 1;
export const TEXT_SCALE_MIN = 0.85;
export const TEXT_SCALE_MAX = 1.6;
export const TEXT_SCALE_STEP = 0.15;

const round2 = (n) => Math.round(n * 100) / 100;

/** Clamp to the allowed range and snap to a step; anything that is not a finite number is the default. */
export function normalizeTextScale(value) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return TEXT_SCALE_DEFAULT;
  const clamped = Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, n));
  const steps = Math.round((clamped - TEXT_SCALE_MIN) / TEXT_SCALE_STEP);
  return Math.min(TEXT_SCALE_MAX, round2(TEXT_SCALE_MIN + steps * TEXT_SCALE_STEP));
}

function storage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

function read(key) {
  try { return storage()?.getItem(key) ?? null; } catch { return null; }
}

function write(key, value) {
  try { storage()?.setItem(key, value); return true; } catch { return false; }
}

export function getQuizDisplayPrefs() {
  const stored = read(QUIZ_TEXT_SCALE_KEY);
  return {
    textScale: stored === null ? TEXT_SCALE_DEFAULT : normalizeTextScale(stored),
    highContrast: read(QUIZ_HIGH_CONTRAST_KEY) === "true",
  };
}

/** Saves the (normalised) text scale; resolves to the value now in effect. Works even if saving fails. */
export function setQuizTextScale(value) {
  const textScale = normalizeTextScale(value);
  write(QUIZ_TEXT_SCALE_KEY, String(textScale));
  return textScale;
}

/** One step up (+1) or down (-1) from the current value. */
export function stepQuizTextScale(direction) {
  const { textScale } = getQuizDisplayPrefs();
  return setQuizTextScale(textScale + (direction >= 0 ? 1 : -1) * TEXT_SCALE_STEP);
}

export function setQuizHighContrast(on) {
  const highContrast = on === true;
  write(QUIZ_HIGH_CONTRAST_KEY, String(highContrast));
  return highContrast;
}
