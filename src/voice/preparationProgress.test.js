import { describe, it, expect } from "vitest";
import { PROGRESS_EVERY_MS, preparationCounts, progressSentence, progressUpdate } from "./preparationProgress";

const prep = (...statuses) => new Map(statuses.map((status, i) => [`p${i}`, typeof status === "string" ? { status } : status]));
const counts = (ready, preparing, failed = 0) => ({ total: ready + preparing + failed, ready, preparing, failed });

describe("preparationCounts", () => {
  it("counts requested explanations by state and ignores ones explained only on request", () => {
    expect(preparationCounts(prep("ready", "generating", "pending", "failed", { status: "pending", requested: false })))
      .toEqual({ total: 4, ready: 1, preparing: 2, failed: 1 });
  });
  it("is null when nothing is being prepared", () => {
    expect(preparationCounts(new Map())).toBeNull();
    expect(preparationCounts(null)).toBeNull();
  });
});

describe("progressSentence", () => {
  it("answers how the explanations are going", () => {
    expect(progressSentence(counts(3, 9))).toBe("3 of 12 explanations are ready. 9 are still being prepared.");
    expect(progressSentence(counts(1, 1, 1))).toBe("1 of 3 explanations is ready. 1 is still being prepared. 1 could not be prepared.");
    expect(progressSentence(counts(12, 0))).toBe("All 12 explanations are ready.");
    expect(progressSentence(counts(10, 0, 2))).toMatch(/^10 of 12 explanations are ready\. 2 could not be prepared/);
  });
  it("reports the processing stage before explanations exist", () => {
    expect(progressSentence(null, "Extracting keyframes…")).toBe("The lecture is still being processed: Extracting keyframes. Explanations are prepared after that.");
    expect(progressSentence(null)).toBe("No explanations are being prepared for this lecture right now.");
  });
});

describe("progressUpdate (when to speak)", () => {
  it("announces the start, the first ready one, then at most once a minute, then the finish", () => {
    const memory = {};
    expect(progressUpdate(memory, counts(0, 12), 0)).toBe("Preparing 12 explanations. I will tell you as they become ready.");
    expect(progressUpdate(memory, counts(0, 12), 1000)).toBeNull();
    expect(progressUpdate(memory, counts(1, 11), 2000)).toBe("The first explanation is ready. 1 of 12.");
    expect(progressUpdate(memory, counts(2, 10), 10_000)).toBeNull(); // too soon after the last update
    expect(progressUpdate(memory, counts(4, 8), 2000 + PROGRESS_EVERY_MS)).toBe("4 of 12 explanations are ready.");
    expect(progressUpdate(memory, counts(12, 0), 2000 + PROGRESS_EVERY_MS + 5000)).toBe("All 12 explanations are ready.");
    expect(progressUpdate(memory, counts(12, 0), 999_999)).toBeNull(); // said once
  });
  it("stays quiet when everything was already prepared before the lecture opened", () => {
    const memory = {};
    expect(progressUpdate(memory, counts(12, 0), 0)).toBeNull();
    expect(progressUpdate(memory, counts(12, 0), 90_000)).toBeNull();
  });
  it("says nothing without progress information", () => {
    expect(progressUpdate({}, null)).toBeNull();
  });
});
