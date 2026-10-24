import { afterEach, describe, expect, it, vi } from "vitest";
import {
  API_BASE_URL,
  API_MOCK_MODE,
  DEFAULT_API_BASE_URL,
  apiUrl,
  isEnabled,
  normalizeApiBaseUrl,
} from "./apiConfig.js";
import { processVideo } from "../api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API configuration", () => {
  it("defaults every backend client to the local FastAPI server", () => {
    expect(DEFAULT_API_BASE_URL).toBe("http://127.0.0.1:8000");
    expect(API_BASE_URL).toBe(DEFAULT_API_BASE_URL);
    expect(apiUrl("/video/process")).toBe(
      "http://127.0.0.1:8000/video/process",
    );
  });

  it("uses the shared URL for processing without tunnel-specific headers", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          job_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          video_id: "aircAruvnKk",
          status: "succeeded",
          stage: "complete",
          attempt_count: 1,
          reused_cache: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          video_id: "aircAruvnKk",
          duration_seconds: 10,
          duration_formatted: "00:10",
          total_interventions: 0,
          interventions: [],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await processVideo({
      url: "https://www.youtube.com/watch?v=aircAruvnKk",
      videoId: "aircAruvnKk",
      mode: "standard",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://127.0.0.1:8000/video/processing-jobs",
    );
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      "Content-Type": "application/json",
    });
  });

  it("surfaces real processing errors instead of falling back to mock data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    await expect(
      processVideo({ videoId: "aircAruvnKk", mode: "standard" }),
    ).rejects.toThrow("Synapse could not process this lecture. Please try again.");
  });

  it("normalizes configured URLs and route slashes", () => {
    expect(normalizeApiBaseUrl(" https://api.example.test/// ")).toBe(
      "https://api.example.test",
    );
    expect(normalizeApiBaseUrl(" ")).toBe(DEFAULT_API_BASE_URL);
  });

  it("keeps mock mode off unless explicitly enabled", () => {
    expect(API_MOCK_MODE).toBe(false);
    for (const value of [undefined, "", "0", "false", "yes", "enabled"]) {
      expect(isEnabled(value)).toBe(false);
    }
    for (const value of ["1", "true", " TRUE "]) {
      expect(isEnabled(value)).toBe(true);
    }
  });
});
