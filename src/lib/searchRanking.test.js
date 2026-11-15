import { describe, expect, it } from "vitest";
import {
  RESULTS_PER_PAGE,
  pageCount,
  pageSummary,
  parsePreferredChannels,
  rankResults,
  resultAriaLabel,
  spokenDuration,
} from "./searchRanking";

const v = (id, channel, minutes) => ({ videoId: id, channel, durationSeconds: minutes * 60 });

describe("rankResults", () => {
  it("lists lectures up to 30 minutes before longer ones and drops nothing", () => {
    const input = [v("long", "MIT", 80), v("short", "Someone", 12), v("edge", "Someone", 30)];
    const out = rankResults(input, { preferredChannels: [] });
    expect(out.map((r) => r.videoId)).toEqual(["short", "edge", "long"]);
    expect(out).toHaveLength(3);
  });

  it("prefers configured channels inside the same length group, but does not hide others", () => {
    const input = [v("a", "Other", 10), v("khan", "Khan Academy", 15), v("b", "Other", 9)];
    const out = rankResults(input, { preferredChannels: ["khan academy"] });
    expect(out.map((r) => r.videoId)).toEqual(["khan", "a", "b"]);
  });

  it("puts a short non-preferred lecture ahead of a long preferred one", () => {
    const input = [v("longKhan", "Khan Academy", 45), v("short", "Other", 10)];
    expect(rankResults(input, { preferredChannels: ["Khan Academy"] }).map((r) => r.videoId)).toEqual([
      "short",
      "longKhan",
    ]);
  });

  it("keeps the original (YouTube) order when scores tie, and places unknown lengths in between", () => {
    const input = [v("long", "X", 60), { videoId: "unknown", channel: "X" }, v("s1", "X", 5), v("s2", "X", 6)];
    expect(rankResults(input, { preferredChannels: [] }).map((r) => r.videoId)).toEqual([
      "s1",
      "s2",
      "unknown",
      "long",
    ]);
  });

  it("tolerates bad input", () => {
    expect(rankResults(null)).toEqual([]);
  });
});

describe("parsePreferredChannels", () => {
  it("defaults to Khan Academy when unset, and is configurable or switch-off-able", () => {
    expect(parsePreferredChannels(undefined)).toEqual(["Khan Academy"]);
    expect(parsePreferredChannels("Khan Academy, CrashCourse ,")).toEqual(["Khan Academy", "CrashCourse"]);
    expect(parsePreferredChannels(" ")).toEqual([]);
  });
});

describe("paging text", () => {
  it("counts pages and summarises the range", () => {
    expect(RESULTS_PER_PAGE).toBe(6);
    expect(pageCount(0)).toBe(1);
    expect(pageCount(20)).toBe(4);
    expect(pageSummary(1, 20)).toBe("Showing results 1 to 6 of 20.");
    expect(pageSummary(4, 20)).toBe("Showing results 19 to 20 of 20.");
    expect(pageSummary(2, 7)).toBe("Showing result 7 of 7.");
  });
});

describe("spoken wording", () => {
  it("speaks durations in words", () => {
    expect(spokenDuration(750)).toBe("12 minutes 30 seconds");
    expect(spokenDuration(60)).toBe("1 minute");
    expect(spokenDuration(4980)).toBe("1 hour 23 minutes");
    expect(spokenDuration(0, "fallback")).toBe("fallback");
  });

  it("builds a label that starts with the action and ends with the position", () => {
    const label = resultAriaLabel({ title: "Intro", channel: "Khan Academy", durationSeconds: 720 }, 3, 20);
    expect(label).toBe("Start learning: Intro, Khan Academy, 12 minutes. Result 3 of 20.");
  });
});
