import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VIDEO_ID = "aircAruvnKk";

const response = (status, body) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  });

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_API_MOCK_MODE", "false");
  vi.stubEnv("VITE_API_BASE_URL", "http://127.0.0.1:8000");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("backend video metadata", () => {
  it("loads and normalizes metadata from /video/meta without using noembed", async () => {
    const fetchMock = vi.fn().mockReturnValue(
      response(200, {
        video_id: VIDEO_ID,
        title: "Neural Networks",
        channel_name: "3Blue1Brown",
        duration_seconds: 1153,
        duration_formatted: "19:13",
        thumbnail_url: "https://i.ytimg.com/custom.jpg",
        exists: true,
        processed: true,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { getVideoMetadata } = await import("./api.js");

    await expect(getVideoMetadata(VIDEO_ID)).resolves.toEqual({
      videoId: VIDEO_ID,
      title: "Neural Networks",
      author: "3Blue1Brown",
      duration: "19:13",
      durationSeconds: 1153,
      thumbnailUrl: "https://i.ytimg.com/custom.jpg",
      exists: true,
      processed: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `http://127.0.0.1:8000/video/meta/${VIDEO_ID}`,
      { headers: { Accept: "application/json" } },
    );
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("noembed.com");
  });

  it("classifies unavailable videos", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(
        response(200, {
          video_id: VIDEO_ID,
          exists: false,
          processed: false,
        }),
      ),
    );
    const { getVideoMetadata, VideoMetadataError } = await import("./api.js");

    const error = await getVideoMetadata(VIDEO_ID).catch((reason) => reason);
    expect(error).toBeInstanceOf(VideoMetadataError);
    expect(error.kind).toBe("unavailable");
  });

  it("classifies metadata network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const { getVideoMetadata, VideoMetadataError } = await import("./api.js");

    const error = await getVideoMetadata(VIDEO_ID).catch((reason) => reason);
    expect(error).toBeInstanceOf(VideoMetadataError);
    expect(error.kind).toBe("network");
  });
});

describe("video processing errors", () => {
  it("classifies unavailable video responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(
        response(500, { detail: "Video unavailable: this upload is private" }),
      ),
    );
    const { processVideo, VideoProcessingError } = await import("./api.js");

    const error = await processVideo({ videoId: VIDEO_ID }).catch((reason) => reason);
    expect(error).toBeInstanceOf(VideoProcessingError);
    expect(error.kind).toBe("unavailable");
    expect(error.message).toContain("unavailable");
  });

  it("classifies processing network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const { processVideo, VideoProcessingError } = await import("./api.js");

    const error = await processVideo({ videoId: VIDEO_ID }).catch((reason) => reason);
    expect(error).toBeInstanceOf(VideoProcessingError);
    expect(error.kind).toBe("network");
  });
});
