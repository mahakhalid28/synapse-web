import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  QUIZ_HIGH_CONTRAST_KEY, QUIZ_TEXT_SCALE_KEY, TEXT_SCALE_DEFAULT, TEXT_SCALE_MAX, TEXT_SCALE_MIN, getQuizDisplayPrefs,
  normalizeTextScale, setQuizHighContrast, setQuizTextScale, stepQuizTextScale,
} from "./displayPrefs.js";

beforeEach(() => localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

describe("quiz display preferences", () => {
  it("defaults to normal size and normal contrast", () => {
    expect(getQuizDisplayPrefs()).toEqual({ textScale: 1, highContrast: false });
  });

  it("uses its own keys, separate from anything on the lecture screen", () => {
    setQuizTextScale(1.3);
    setQuizHighContrast(true);
    expect(Object.keys(localStorage).sort()).toEqual([QUIZ_HIGH_CONTRAST_KEY, QUIZ_TEXT_SCALE_KEY].sort());
    expect(QUIZ_TEXT_SCALE_KEY).toBe("synapse_quiz_text_scale");
    expect(QUIZ_HIGH_CONTRAST_KEY).toBe("synapse_quiz_high_contrast");
  });

  it("saves and restores both settings", () => {
    setQuizTextScale(1.45);
    setQuizHighContrast(true);
    expect(getQuizDisplayPrefs()).toEqual({ textScale: 1.45, highContrast: true });
  });

  it("clamps and snaps to the same steps as the lecture screen (0.85 to 1.6 by 0.15)", () => {
    expect(normalizeTextScale(0.1)).toBe(TEXT_SCALE_MIN);
    expect(normalizeTextScale(9)).toBe(TEXT_SCALE_MAX);
    expect(normalizeTextScale(1.02)).toBe(1);
    expect(normalizeTextScale(1.1)).toBe(1.15);
    const reachable = new Set();
    let value = TEXT_SCALE_MIN;
    for (let i = 0; i < 20; i++) { reachable.add(normalizeTextScale(value)); value += 0.15; }
    expect([...reachable].sort((a, b) => a - b)).toEqual([0.85, 1, 1.15, 1.3, 1.45, 1.6]);
  });

  it("steps up and down and stops at the ends", () => {
    expect(stepQuizTextScale(1)).toBe(1.15);
    expect(stepQuizTextScale(1)).toBe(1.3);
    expect(stepQuizTextScale(-1)).toBe(1.15);
    for (let i = 0; i < 10; i++) stepQuizTextScale(1);
    expect(getQuizDisplayPrefs().textScale).toBe(TEXT_SCALE_MAX);
    for (let i = 0; i < 10; i++) stepQuizTextScale(-1);
    expect(getQuizDisplayPrefs().textScale).toBe(TEXT_SCALE_MIN);
  });

  it("falls back to the default for corrupt stored values", () => {
    for (const bad of ["", "abc", "NaN", "Infinity", "null", "{}", "-5e999x"]) {
      localStorage.setItem(QUIZ_TEXT_SCALE_KEY, bad);
      expect(getQuizDisplayPrefs().textScale, bad).toBe(TEXT_SCALE_DEFAULT);
    }
    localStorage.setItem(QUIZ_HIGH_CONTRAST_KEY, "yes");
    expect(getQuizDisplayPrefs().highContrast).toBe(false);
    for (const bad of [undefined, null, NaN, "x", {}, [], true]) expect(normalizeTextScale(bad)).toBe(TEXT_SCALE_DEFAULT);
  });

  it("only an explicit true turns high contrast on", () => {
    expect(setQuizHighContrast("true")).toBe(false);
    expect(setQuizHighContrast(1)).toBe(false);
    expect(setQuizHighContrast(true)).toBe(true);
    expect(setQuizHighContrast(false)).toBe(false);
    expect(getQuizDisplayPrefs().highContrast).toBe(false);
  });

  it("still works when localStorage is blocked or full", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    expect(getQuizDisplayPrefs()).toEqual({ textScale: 1, highContrast: false });
    expect(setQuizTextScale(1.3)).toBe(1.3); // the value in effect, even though it could not be saved
    expect(setQuizHighContrast(true)).toBe(true);
  });

  it("still works when there is no localStorage at all", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(getQuizDisplayPrefs()).toEqual({ textScale: 1, highContrast: false });
    expect(setQuizTextScale(1.15)).toBe(1.15);
  });

  it("does not touch the lecture screen's or the app's other storage keys", () => {
    localStorage.setItem("synapse_bookmarks", "[]");
    setQuizTextScale(1.6);
    setQuizHighContrast(true);
    expect(localStorage.getItem("synapse_bookmarks")).toBe("[]");
  });
});
