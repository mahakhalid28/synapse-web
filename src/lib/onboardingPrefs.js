// Onboarding state: the feature flag that switches Welcome on, whether the Welcome
// screen has been finished, and whether the "How this lecture works" card has been
// dismissed.
//
// Welcome is shown on EVERY launch while the feature flag is on (a product decision).
// Whether it was completed before no longer decides that; see needsWelcome().
//
// Two dedicated keys, nothing inferred from any other key (Library, presentation
// mode, synapse_intro_seen and the quiz keys are not read here):
//   synapse_onboarding_completed  "1" once Welcome has been finished or skipped.
//                                 Still written, but nothing reads it any more.
//   synapse_guide_dismissed       "1" once the lecture card has been dismissed
//
// localStorage is optional. Every read and write is guarded. When a write FAILS
// (for example a full store) the flag is kept in memory instead, so it still
// holds for the rest of the session; it is not remembered after a restart. When
// a write succeeds, storage is the only record, so clearing storage clears it.

export const ONBOARDING_COMPLETED_KEY = "synapse_onboarding_completed";
export const GUIDE_DISMISSED_KEY = "synapse_guide_dismissed";

const memory = new Map();

function storage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

function read(key) {
  try { return storage()?.getItem(key) ?? null; } catch { return null; }
}

function write(key, value) {
  try {
    const store = storage();
    if (!store) return false;
    store.setItem(key, value);
    return true;
  } catch { return false; }
}

function isSet(key) {
  return memory.get(key) === "1" || read(key) === "1";
}

function setFlag(key) {
  const persisted = write(key, "1");
  if (!persisted) memory.set(key, "1");
  return { persisted };
}

// The lecture screen's own preference (Explanation.jsx owns it and writes it too). Welcome only seeds
// its choice from it and writes it when the learner presses Get started; same key, same two values.
export const PRESENTATION_MODE_KEY = "synapse_presentation_mode";

/** "accessibility" | "study" if one is saved, otherwise null. Anything else saved is ignored. */
export function getSavedPresentationMode() {
  const saved = read(PRESENTATION_MODE_KEY);
  return saved === "accessibility" || saved === "study" ? saved : null;
}

/** Saves the mode; false if it could not be saved (or the value is not a mode). Nothing is kept in memory. */
export function savePresentationMode(mode) {
  if (mode !== "accessibility" && mode !== "study") return false;
  return write(PRESENTATION_MODE_KEY, mode);
}

/**
 * Whether onboarding is switched on at all.
 *
 * VITE_ONBOARDING_ENABLED decides when it is "1"/"true" (on) or "0"/"false" (off), ignoring case and
 * surrounding spaces. Any other value, including a typo, is ignored. When it is not set the default
 * follows the build mode: ON in development and in a production build (so the packaged app shows it),
 * OFF in the test runner. Vite writes VITE_* values into the bundle at build time, so a packaged app
 * cannot change this afterwards. Read on every call so tests can switch it.
 */
export function onboardingEnabled() {
  const explicit = String(import.meta.env.VITE_ONBOARDING_ENABLED ?? "").trim().toLowerCase();
  if (explicit === "1" || explicit === "true") return true;
  if (explicit === "0" || explicit === "false") return false;
  return import.meta.env.MODE !== "test";
}

/**
 * True when the app should open on Welcome: every launch while onboarding is switched on, whether or
 * not it was completed before. Switched off (VITE_ONBOARDING_ENABLED=0, or the test runner by default)
 * means it never opens on Welcome. Welcome is only ever the INITIAL screen, so it cannot reappear within
 * a session. synapse_onboarding_completed is deliberately not consulted.
 */
export function needsWelcome() {
  return onboardingEnabled();
}

/**
 * Marks Welcome finished or skipped. Resolves to { persisted }: false means it holds for this session only.
 * Since Welcome now opens on every launch, nothing reads this flag; it is kept (see docs) until it is
 * decided whether to remove it.
 */
export function completeOnboarding() {
  return setFlag(ONBOARDING_COMPLETED_KEY);
}

export function isGuideDismissed() {
  return isSet(GUIDE_DISMISSED_KEY);
}

/** Hides the "How this lecture works" card. Resolves to { persisted } like completeOnboarding. */
export function dismissGuide() {
  return setFlag(GUIDE_DISMISSED_KEY);
}
