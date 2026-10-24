import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractYouTubeId,
  formatDuration,
  normalizeSearchResult,
  searchVideos,
} from "./lectureSearch";

describe("formatDuration", () => {
  it("formats seconds to MM:SS", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(45)).toBe("0:45");
    expect(formatDuration(253)).toBe("4:13");
    expect(formatDuration(600)).toBe("10:00");
  });

  it("formats hours when duration >= 3600", () => {
    expect(formatDuration(3600)).toBe("1:00:00");
    expect(formatDuration(3665)).toBe("1:01:05");
  });

  it("handles non-number or negative values gracefully", () => {
    expect(formatDuration(-10)).toBe("0:00");
    expect(formatDuration(null)).toBe("0:00");
    expect(formatDuration(NaN)).toBe("0:00");
  });
});

describe("extractYouTubeId", () => {
  it("extracts from standard watch URLs", () => {
    expect(extractYouTubeId("https://www.youtube.com/watch?v=NFZtjSeT3XE")).toBe("NFZtjSeT3XE");
    expect(extractYouTubeId("https://youtube.com/watch?v=dQw4w9WgXcQ&t=10s")).toBe("dQw4w9WgXcQ");
  });

  it("extracts from youtu.be short links", () => {
    expect(extractYouTubeId("https://youtu.be/NFZtjSeT3XE")).toBe("NFZtjSeT3XE");
  });

  it("extracts from embed and shorts links", () => {
    expect(extractYouTubeId("https://www.youtube.com/embed/NFZtjSeT3XE")).toBe("NFZtjSeT3XE");
    expect(extractYouTubeId("https://www.youtube.com/shorts/NFZtjSeT3XE")).toBe("NFZtjSeT3XE");
  });

  it("returns null for non-YouTube or invalid strings", () => {
    expect(extractYouTubeId("calculus lecture")).toBeNull();
    expect(extractYouTubeId("")).toBeNull();
    expect(extractYouTubeId(null)).toBeNull();
  });
});

describe("normalizeSearchResult", () => {
  it("normalizes backend snake_case response into dual camelCase/snake_case structure", () => {
    const raw = {
      video_id: "NFZtjSeT3XE",
      title: "MIT Calculus 1",
      channel_name: "MIT OCW",
      thumbnail_url: "https://i.ytimg.com/vi/NFZtjSeT3XE/hqdefault.jpg",
      duration_seconds: 253,
      duration_formatted: "04:13",
      canonical_url: "https://www.youtube.com/watch?v=NFZtjSeT3XE",
    };

    const norm = normalizeSearchResult(raw);
    expect(norm.videoId).toBe("NFZtjSeT3XE");
    expect(norm.video_id).toBe("NFZtjSeT3XE");
    expect(norm.title).toBe("MIT Calculus 1");
    expect(norm.channel).toBe("MIT OCW");
    expect(norm.channel_name).toBe("MIT OCW");
    expect(norm.duration).toBe("04:13");
    expect(norm.durationSeconds).toBe(253);
    expect(norm.thumbnailUrl).toBe("https://i.ytimg.com/vi/NFZtjSeT3XE/hqdefault.jpg");
    expect(norm.canonicalUrl).toBe("https://www.youtube.com/watch?v=NFZtjSeT3XE");
  });

  it("synthesizes duration and thumbnail if missing", () => {
    const raw = {
      videoId: "dQw4w9WgXcQ",
      title: "Title",
      channel: "Channel",
      durationSeconds: 125,
    };

    const norm = normalizeSearchResult(raw);
    expect(norm.duration).toBe("2:05");
    expect(norm.thumbnailUrl).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(norm.canonicalUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });
});

describe("searchVideos API client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty array for empty or whitespace query without network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const results = await searchVideos("   ");
    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls backend /video/search with encoded query and returns normalized items", async () => {
    const mockData = [
      {
        video_id: "NFZtjSeT3XE",
        title: "Calculus Lecture 1",
        channel_name: "MIT",
        thumbnail_url: "https://img.youtube.com/1.jpg",
        duration_seconds: 300,
        canonical_url: "https://www.youtube.com/watch?v=NFZtjSeT3XE",
      },
    ];

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockData,
    });

    const results = await searchVideos("calculus & linear algebra");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/video/search?q=calculus%20%26%20linear%20algebra"),
      expect.objectContaining({ method: "GET" }),
    );
    expect(results).toHaveLength(1);
    expect(results[0].videoId).toBe("NFZtjSeT3XE");
    expect(results[0].title).toBe("Calculus Lecture 1");
    expect(results[0].channel).toBe("MIT");
    expect(results[0].durationSeconds).toBe(300);
  });

  it("handles 503 service unavailable with clear message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ detail: "YouTube search is not configured." }),
    });

    await expect(searchVideos("physics")).rejects.toThrow("YouTube search is not configured.");
  });

  it("handles 429 quota / rate limit error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ detail: "YouTube search rate limit or quota exceeded." }),
    });

    await expect(searchVideos("physics")).rejects.toThrow("rate limit or quota");
  });

  it("handles 504 network timeout error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 504,
      json: async () => ({ detail: "YouTube search request timed out." }),
    });

    await expect(searchVideos("physics")).rejects.toThrow("timed out");
  });
});

