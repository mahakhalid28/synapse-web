export const ONBOARDING_COMPLETED_KEY = "synapse_onboarding_completed";
export const PRESENTATION_MODE_KEY = "synapse_presentation_mode";
export const GUIDE_DISMISSED_KEY = "synapse_guide_dismissed";

const memory = new Map();

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function read(key) {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    const store = storage();
    if (!store) return false;
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function isSet(key) {
  return memory.get(key) === "1" || read(key) === "1";
}

export function getSavedPresentationMode() {
  const saved = read(PRESENTATION_MODE_KEY);
  return saved === "accessibility" || saved === "study" ? saved : null;
}

export function savePresentationMode(mode) {
  if (mode !== "accessibility" && mode !== "study") return false;
  return write(PRESENTATION_MODE_KEY, mode);
}

export function onboardingEnabled() {
  const explicit = String(import.meta.env.VITE_ONBOARDING_ENABLED ?? "").trim().toLowerCase();
  if (explicit === "1" || explicit === "true") return true;
  if (explicit === "0" || explicit === "false") return false;
  return import.meta.env.MODE !== "test";
}

export function needsWelcome() {
  return onboardingEnabled() && !isSet(ONBOARDING_COMPLETED_KEY);
}

export function completeOnboarding() {
  const persisted = write(ONBOARDING_COMPLETED_KEY, "1");
  if (!persisted) memory.set(ONBOARDING_COMPLETED_KEY, "1");
  return { persisted };
}

export function isGuideDismissed() {
  return isSet(GUIDE_DISMISSED_KEY);
}

export function dismissGuide() {
  const persisted = write(GUIDE_DISMISSED_KEY, "1");
  if (!persisted) memory.set(GUIDE_DISMISSED_KEY, "1");
  return { persisted };
}
