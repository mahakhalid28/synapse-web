import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VIDEO_ID = "aircAruvnKk";

const intervention = (overrides = {}) => ({
  id: "3f2b8c1e-5d4a-4e7b-9a10-2c6d8e9f0a1b",
  video_id: VIDEO_ID,
  timestamp: 10,
  timestamp_formatted: "00:10",
  frame_path: "data/aircAruvnKk/keyframes/frame.jpg",
  content_type: "equation",
  transcript_context: "the instructor writes the divergence formula",
  ...overrides,
});

const backendResult = (overrides = {}) => ({
  video_id: VIDEO_ID,
  title: "Backend lecture title",
  duration_seconds: 125,
  duration_formatted: "02:05",
  total_keyframes: 3,
  total_interventions: 1,
  interventions: [intervention()],
  category_counts: {},
  ...overrides,
});

const completedJob = () => ({
  job_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  video_id: VIDEO_ID,
  status: "succeeded",
  stage: "complete",
  attempt_count: 1,
  reused_cache: false,
});

const jsonResponse = (status, body) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });

const metadataResponse = () =>
  jsonResponse(200, {
    video_id: VIDEO_ID,
    title: "Public lecture title",
    channel_name: "Lecturer",
    duration_seconds: 125,
    duration_formatted: "02:05",
    thumbnail_url: `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`,
    exists: true,
    processed: true,
  });

let fetchMock;
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_API_MOCK_MODE", "false");
  vi.stubEnv("VITE_API_BASE_URL", "http://127.0.0.1:8000");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("persistent intervention retrieval", () => {
  it("reuses a valid processing response from memory", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse(200, completedJob()))
      .mockReturnValueOnce(jsonResponse(200, backendResult()))
      .mockReturnValueOnce(metadataResponse());
    const { getInterventionPoints, processVideo } = await import("./api.js");

    await processVideo({ videoId: VIDEO_ID, mode: "standard" });
    const result = await getInterventionPoints(VIDEO_ID, VIDEO_ID);

    expect(result.points).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://127.0.0.1:8000/video/processing-jobs",
    );
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).includes(`/video/${VIDEO_ID}/interventions`),
      ),
    ).toHaveLength(1);
  });

  it("retrieves persisted interventions when the module cache is empty", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse(200, backendResult()))
      .mockReturnValueOnce(metadataResponse());
    const { getInterventionPoints } = await import("./api.js");

    const result = await getInterventionPoints(VIDEO_ID, VIDEO_ID);

    expect(fetchMock.mock.calls[0][0]).toBe(
      `http://127.0.0.1:8000/video/${VIDEO_ID}/interventions`,
    );
    expect(fetchMock.mock.calls[0][1]).toBeUndefined();
    expect(result.videoTitle).toBe("Public lecture title");
    expect(result.author).toBe("Lecturer");
    expect(result.duration).toBe("02:05");
    expect(result.thumbnailUrl).toContain(VIDEO_ID);
    expect(result.metadataError).toBeNull();
  });

  it("reopens after an application restart without processing again", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse(200, completedJob()))
      .mockReturnValueOnce(jsonResponse(200, backendResult()));
    const firstModule = await import("./api.js");
    await firstModule.processVideo({ videoId: VIDEO_ID, mode: "standard" });

    vi.resetModules(); // a new Electron renderer has no module-level cache
    fetchMock
      .mockReturnValueOnce(jsonResponse(200, backendResult()))
      .mockReturnValueOnce(metadataResponse());
    const reopenedModule = await import("./api.js");
    const result = await reopenedModule.getInterventionPoints(VIDEO_ID, VIDEO_ID);

    expect(result.points).toHaveLength(1);
    const backendCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).startsWith("http://127.0.0.1:8000"),
    );
    expect(backendCalls.map(([url, init]) => [url, init?.method || "GET"])).toEqual([
      ["http://127.0.0.1:8000/video/processing-jobs", "POST"],
      [`http://127.0.0.1:8000/video/${VIDEO_ID}/interventions`, "GET"],
      [`http://127.0.0.1:8000/video/${VIDEO_ID}/interventions`, "GET"],
      [`http://127.0.0.1:8000/video/meta/${VIDEO_ID}`, "GET"],
    ]);
  });

  it("returns a valid empty lecture without inventing mock points", async () => {
    fetchMock
      .mockReturnValueOnce(
        jsonResponse(
          200,
          backendResult({ total_interventions: 0, interventions: [] }),
        ),
      )
      .mockReturnValueOnce(metadataResponse());
    const { getInterventionPoints } = await import("./api.js");

    const result = await getInterventionPoints(VIDEO_ID, VIDEO_ID);

    expect(result.points).toEqual([]);
  });

  it("reports a persisted-video 404 without processing or mock fallback", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse(404, { detail: "Video not found" }));
    const { getInterventionPoints, InterventionPointsError } = await import("./api.js");

    const error = await getInterventionPoints(VIDEO_ID, VIDEO_ID).catch(
      (reason) => reason,
    );

    expect(error).toBeInstanceOf(InterventionPointsError);
    expect(error.kind).toBe("notFound");
    expect(error.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toBeUndefined();
  });

  it("reports network failures without processing or mock fallback", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { getInterventionPoints, InterventionPointsError } = await import("./api.js");

    const error = await getInterventionPoints(VIDEO_ID, VIDEO_ID).catch(
      (reason) => reason,
    );

    expect(error).toBeInstanceOf(InterventionPointsError);
    expect(error.kind).toBe("network");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["wrong video", backendResult({ video_id: "otherVideo1" })],
    ["missing list", backendResult({ interventions: undefined })],
    ["count mismatch", backendResult({ total_interventions: 2 })],
    ["bad timestamp", backendResult({ interventions: [intervention({ timestamp: "10" })] })],
  ])("rejects malformed data: %s", async (_name, body) => {
    fetchMock.mockReturnValueOnce(jsonResponse(200, body));
    const { getInterventionPoints, InterventionPointsError } = await import("./api.js");

    const error = await getInterventionPoints(VIDEO_ID, VIDEO_ID).catch(
      (reason) => reason,
    );

    expect(error).toBeInstanceOf(InterventionPointsError);
    expect(error.kind).toBe("malformed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves IDs and metadata while sorting and transforming timestamps", async () => {
    const laterId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const raw = backendResult({
      duration_seconds: 0,
      duration_formatted: null,
      total_interventions: 4,
      interventions: [
        intervention({ id: laterId, timestamp: 3661, content_type: "slide" }),
        intervention(),
        intervention({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          timestamp: 65,
          content_type: null,
          transcript_context: null,
        }),
        intervention({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          timestamp: 20,
          content_type: "non-educational",
        }),
      ],
    });
    fetchMock
      .mockReturnValueOnce(jsonResponse(200, raw))
      .mockReturnValueOnce(metadataResponse());
    const { getInterventionPoints } = await import("./api.js");

    const result = await getInterventionPoints("saved-job", VIDEO_ID);

    expect(result.jobId).toBe("saved-job");
    expect(result.duration).toBe("1:02:01");
    expect(result.points.map(({ id, timestamp, category }) => ({
      id,
      timestamp,
      category,
    }))).toEqual([
      { id: intervention().id, timestamp: "0:10", category: "equation" },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        timestamp: "1:05",
        category: "unknown",
      },
      { id: laterId, timestamp: "1:01:01", category: "diagram" },
    ]);
    expect(result.points[1].title).toBe("Visual moment");
  });
});
