import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let prefs;
beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  prefs = await import("./onboardingPrefs.js");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("independent Welcome and guide persistence", () => {
  it("keeps Welcome first-launch-only while the guide has its own dismissal", () => {
    vi.stubEnv("VITE_ONBOARDING_ENABLED", "true");
    expect(prefs.needsWelcome()).toBe(true);
    expect(prefs.isGuideDismissed()).toBe(false);
    prefs.completeOnboarding();
    expect(prefs.needsWelcome()).toBe(false);
    expect(prefs.isGuideDismissed()).toBe(false);
    prefs.dismissGuide();
    expect(prefs.isGuideDismissed()).toBe(true);
    expect(prefs.needsWelcome()).toBe(false);
  });

  it("dismisses only the guide, preserving intro, mode and completion keys", () => {
    localStorage.setItem("synapse_intro_seen", "1");
    localStorage.setItem("synapse_presentation_mode", "study");
    prefs.dismissGuide();
    expect(localStorage.getItem("synapse_intro_seen")).toBe("1");
    expect(prefs.getSavedPresentationMode()).toBe("study");
    expect(localStorage.getItem("synapse_onboarding_completed")).toBeNull();
    expect(localStorage.getItem("synapse_guide_dismissed")).toBe("1");
  });

  it("retains dismissal for the session when storage is unavailable", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(prefs.isGuideDismissed()).toBe(false);
    expect(prefs.dismissGuide()).toEqual({ persisted: false });
    expect(prefs.isGuideDismissed()).toBe(true);
  });

  it("respects explicit onboarding flags and existing build-mode defaults", () => {
    for (const value of ["1", "true", " TRUE "]) {
      vi.stubEnv("VITE_ONBOARDING_ENABLED", value);
      expect(prefs.onboardingEnabled()).toBe(true);
    }
    for (const value of ["0", "false", " FALSE "]) {
      vi.stubEnv("VITE_ONBOARDING_ENABLED", value);
      expect(prefs.onboardingEnabled()).toBe(false);
    }
    vi.stubEnv("VITE_ONBOARDING_ENABLED", undefined);
    for (const [mode, enabled] of [["development", true], ["production", true], ["test", false]]) {
      vi.stubEnv("MODE", mode);
      expect(prefs.onboardingEnabled()).toBe(enabled);
    }
  });
});
