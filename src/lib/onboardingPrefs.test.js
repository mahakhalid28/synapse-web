import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The module keeps a session memory of the flags, so each test loads a fresh copy.
async function load() {
  vi.resetModules();
  return import("./onboardingPrefs.js");
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe("the feature flag", () => {
  it("is OFF by default in the test runner (the actual Vite mode here is 'test')", async () => {
    expect(import.meta.env.MODE).toBe("test");
    const { onboardingEnabled, needsWelcome } = await load();
    expect(onboardingEnabled()).toBe(false);
    expect(needsWelcome()).toBe(false);
  });

  it("is ON by default in development and in a production build", async () => {
    const { onboardingEnabled } = await load();
    vi.stubEnv("MODE", "development");
    expect(onboardingEnabled()).toBe(true);
    vi.stubEnv("MODE", "production");
    expect(onboardingEnabled()).toBe(true);
  });

  it("is switched on or off by an explicit value, ignoring case and spaces", async () => {
    const { onboardingEnabled } = await load();
    for (const on of ["1", "true", " TRUE ", "True"]) {
      vi.stubEnv("MODE", "test");
      vi.stubEnv("VITE_ONBOARDING_ENABLED", on);
      expect(onboardingEnabled(), `on: "${on}"`).toBe(true);
    }
    for (const off of ["0", "false", " FALSE ", "False"]) {
      vi.stubEnv("MODE", "production");
      vi.stubEnv("VITE_ONBOARDING_ENABLED", off);
      expect(onboardingEnabled(), `off: "${off}"`).toBe(false);
    }
  });

  it("ignores any other value and falls back to the mode default", async () => {
    const { onboardingEnabled } = await load();
    for (const other of ["", "yes", "no", "off", "2"]) {
      vi.stubEnv("VITE_ONBOARDING_ENABLED", other);
      vi.stubEnv("MODE", "production");
      expect(onboardingEnabled(), `production "${other}"`).toBe(true);
      vi.stubEnv("MODE", "test");
      expect(onboardingEnabled(), `test "${other}"`).toBe(false);
    }
  });
});

describe("Welcome completion", () => {
  beforeEach(() => vi.stubEnv("VITE_ONBOARDING_ENABLED", "1"));

  it("is needed on every launch: completing it does not stop it being needed next time", async () => {
    const { needsWelcome, completeOnboarding, ONBOARDING_COMPLETED_KEY } = await load();
    expect(needsWelcome()).toBe(true);
    expect(completeOnboarding()).toEqual({ persisted: true });
    expect(localStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBe("1");
    expect(needsWelcome()).toBe(true);
    // A fresh launch (a fresh module, the same storage) still needs it.
    const next = await load();
    expect(next.needsWelcome()).toBe(true);
  });

  it("uses its own key, written as exactly '1'", async () => {
    const { completeOnboarding, ONBOARDING_COMPLETED_KEY } = await load();
    completeOnboarding();
    expect(ONBOARDING_COMPLETED_KEY).toBe("synapse_onboarding_completed");
    expect(Object.keys(localStorage)).toEqual(["synapse_onboarding_completed"]);
  });

  it("is still needed when old keys exist: nothing is inferred from them", async () => {
    localStorage.setItem("synapse_library", JSON.stringify([{ id: "a", videoId: "abc" }]));
    localStorage.setItem("synapse_presentation_mode", "study");
    localStorage.setItem("synapse_intro_seen", "1");
    localStorage.setItem("synapse_quiz_text_scale", "1.3");
    const { needsWelcome } = await load();
    expect(needsWelcome()).toBe(true);
  });

  it("never looks at the completion flag, whatever is stored in it", async () => {
    const { needsWelcome, ONBOARDING_COMPLETED_KEY } = await load();
    for (const stored of ["1", "true", "0", "", "yes"]) {
      localStorage.setItem(ONBOARDING_COMPLETED_KEY, stored);
      expect(needsWelcome(), `stored "${stored}"`).toBe(true);
    }
  });

  it("is never needed while the feature is off, whatever is stored", async () => {
    vi.stubEnv("VITE_ONBOARDING_ENABLED", "0");
    const { needsWelcome, ONBOARDING_COMPLETED_KEY } = await load();
    expect(needsWelcome()).toBe(false);
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, "1");
    expect(needsWelcome()).toBe(false);
  });

  it("follows the build-mode default when the flag is not set", async () => {
    vi.stubEnv("VITE_ONBOARDING_ENABLED", "");
    const { needsWelcome } = await load();
    vi.stubEnv("MODE", "production");
    expect(needsWelcome()).toBe(true);
    vi.stubEnv("MODE", "development");
    expect(needsWelcome()).toBe(true);
    vi.stubEnv("MODE", "test");
    expect(needsWelcome()).toBe(false);
  });

  it("does not touch the guide flag, the intro flag or the presentation mode", async () => {
    const { completeOnboarding } = await load();
    completeOnboarding();
    expect(localStorage.getItem("synapse_guide_dismissed")).toBeNull();
    expect(localStorage.getItem("synapse_intro_seen")).toBeNull();
    expect(localStorage.getItem("synapse_presentation_mode")).toBeNull();
  });
});

describe("the lecture guide flag", () => {
  it("starts not dismissed, then is dismissed on its own key", async () => {
    const { isGuideDismissed, dismissGuide, GUIDE_DISMISSED_KEY } = await load();
    expect(isGuideDismissed()).toBe(false);
    expect(dismissGuide()).toEqual({ persisted: true });
    expect(GUIDE_DISMISSED_KEY).toBe("synapse_guide_dismissed");
    expect(localStorage.getItem(GUIDE_DISMISSED_KEY)).toBe("1");
    expect(isGuideDismissed()).toBe(true);
  });

  it("is independent of synapse_intro_seen in both directions", async () => {
    localStorage.setItem("synapse_intro_seen", "1");
    const { isGuideDismissed, dismissGuide } = await load();
    expect(isGuideDismissed()).toBe(false);
    dismissGuide();
    expect(localStorage.getItem("synapse_intro_seen")).toBe("1");
  });
});

describe("when storage fails", () => {
  beforeEach(() => vi.stubEnv("VITE_ONBOARDING_ENABLED", "1"));

  it("a failed write is reported, never throws, and Welcome is still needed", async () => {
    const { needsWelcome, completeOnboarding } = await load();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    expect(completeOnboarding()).toEqual({ persisted: false });
    expect(localStorage.getItem("synapse_onboarding_completed")).toBeNull();
    expect(needsWelcome()).toBe(true);
  });

  it("a guide flag whose write failed holds for the session, and is gone after a restart (a fresh module)", async () => {
    let mod = await load();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    expect(mod.dismissGuide()).toEqual({ persisted: false });
    expect(mod.isGuideDismissed()).toBe(true);
    vi.restoreAllMocks();
    mod = await load();
    expect(mod.isGuideDismissed()).toBe(false);
  });

  it("a throwing read is treated as 'not set' and never throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    const { needsWelcome, isGuideDismissed } = await load();
    expect(needsWelcome()).toBe(true);
    expect(isGuideDismissed()).toBe(false);
  });

  it("missing localStorage is handled for reads and writes", async () => {
    vi.stubGlobal("localStorage", undefined);
    const { needsWelcome, completeOnboarding, isGuideDismissed, dismissGuide } = await load();
    expect(needsWelcome()).toBe(true);
    expect(completeOnboarding()).toEqual({ persisted: false });
    expect(needsWelcome()).toBe(true);
    expect(isGuideDismissed()).toBe(false);
    expect(dismissGuide()).toEqual({ persisted: false });
    expect(isGuideDismissed()).toBe(true);
  });
});

describe("the saved presentation mode (Welcome seeds from it and writes it)", () => {
  it("reads only the two valid values and ignores anything else", async () => {
    const { getSavedPresentationMode, PRESENTATION_MODE_KEY } = await load();
    expect(PRESENTATION_MODE_KEY).toBe("synapse_presentation_mode");
    expect(getSavedPresentationMode()).toBeNull();
    localStorage.setItem(PRESENTATION_MODE_KEY, "study");
    expect(getSavedPresentationMode()).toBe("study");
    localStorage.setItem(PRESENTATION_MODE_KEY, "accessibility");
    expect(getSavedPresentationMode()).toBe("accessibility");
    for (const junk of ["", "Study", "visual", "1"]) {
      localStorage.setItem(PRESENTATION_MODE_KEY, junk);
      expect(getSavedPresentationMode(), `saved "${junk}"`).toBeNull();
    }
  });

  it("saves a valid mode on the lecture screen's own key and nothing else", async () => {
    const { savePresentationMode, getSavedPresentationMode } = await load();
    expect(savePresentationMode("study")).toBe(true);
    expect(getSavedPresentationMode()).toBe("study");
    expect(Object.keys(localStorage)).toEqual(["synapse_presentation_mode"]);
  });

  it("refuses an invalid value and reports a failed write without throwing or remembering it", async () => {
    const { savePresentationMode, getSavedPresentationMode } = await load();
    expect(savePresentationMode("loud")).toBe(false);
    expect(localStorage.getItem("synapse_presentation_mode")).toBeNull();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    expect(savePresentationMode("study")).toBe(false);
    vi.restoreAllMocks();
    expect(getSavedPresentationMode()).toBeNull();
  });

  it("a throwing read gives null", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    const { getSavedPresentationMode } = await load();
    expect(getSavedPresentationMode()).toBeNull();
  });
});

describe("memory is only for failed writes", () => {
  it("clearing storage clears a flag that was saved successfully", async () => {
    const { isGuideDismissed, dismissGuide } = await load();
    expect(dismissGuide()).toEqual({ persisted: true });
    expect(isGuideDismissed()).toBe(true);
    localStorage.clear();
    expect(isGuideDismissed()).toBe(false);
  });
});
