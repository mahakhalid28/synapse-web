import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VIDEO_ID = "aircAruvnKk";
const INTERVENTION_ID = "11111111-1111-4111-8111-111111111111";
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");

function response(status, body) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => body),
    text: vi.fn(async () => JSON.stringify(body)),
  });
}

function item(overrides = {}) {
  return {
    intervention_id: INTERVENTION_ID,
    timestamp: 12.5,
    status: "pending",
    error_code: null,
    attempt_count: 0,
    ...overrides,
  };
}

function completedJob() {
  return {
    job_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    video_id: VIDEO_ID,
    status: "succeeded",
    stage: "complete",
    attempt_count: 1,
    reused_cache: false,
  };
}

function persistedVideo() {
  return {
    video_id: VIDEO_ID,
    title: "Lecture",
    duration_seconds: 10,
    duration_formatted: "00:10",
    total_interventions: 0,
    interventions: [],
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_API_MOCK_MODE", "false");
  vi.stubEnv("VITE_API_BASE_URL", "http://127.0.0.1:8000");
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  if (originalCreateObjectURL) {
    Object.defineProperty(URL, "createObjectURL", originalCreateObjectURL);
  } else {
    delete URL.createObjectURL;
  }
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("P3 preparation API", () => {
  it.each([
    ["brief", "brief"],
    ["standard", "explanatory"],
    ["detailed", "detailed"],
  ])("sends selected %s mode while processing", async (frontendMode, backendMode) => {
    fetch
      .mockReturnValueOnce(response(200, completedJob()))
      .mockReturnValueOnce(response(200, persistedVideo()));
    const { processVideo } = await import("./api.js");

    await processVideo({ videoId: VIDEO_ID, mode: frontendMode });

    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      youtube_url: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
      output_mode: backendMode,
    });
  });

  it("keeps the backend default for an older processing caller without a mode", async () => {
    fetch
      .mockReturnValueOnce(response(200, completedJob()))
      .mockReturnValueOnce(response(200, persistedVideo()));
    const { processVideo } = await import("./api.js");
    await processVideo({ videoId: VIDEO_ID });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      youtube_url: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    });
  });

  it("validates and preserves ordered mode-specific status", async () => {
    const later = "22222222-2222-4222-8222-222222222222";
    fetch.mockReturnValueOnce(response(200, {
      video_id: VIDEO_ID,
      output_mode: "explanatory",
      items: [item(), item({ intervention_id: later, timestamp: 20, status: "ready", attempt_count: 1 })],
    }));
    const { getExplanationPreparationStatus } = await import("./api.js");

    const result = await getExplanationPreparationStatus(VIDEO_ID, "standard");

    expect(fetch.mock.calls[0][0]).toContain("output_mode=explanatory");
    expect(result.items.map((entry) => entry.intervention_id)).toEqual([INTERVENTION_ID, later]);
  });

  it.each([
    ["unknown status", [item({ status: "complete" })]],
    ["duplicate IDs", [item(), item({ timestamp: 20 })]],
    ["unordered timestamps", [item({ timestamp: 20 }), item({ intervention_id: "22222222-2222-4222-8222-222222222222", timestamp: 10 })]],
    ["unsafe error code", [item({ status: "failed", error_code: "C:\\private\\file" })]],
  ])("rejects malformed status: %s", async (_name, items) => {
    fetch.mockReturnValueOnce(response(200, {
      video_id: VIDEO_ID,
      output_mode: "explanatory",
      items,
    }));
    const { getExplanationPreparationStatus, ExplanationPreparationError } = await import("./api.js");
    const error = await getExplanationPreparationStatus(VIDEO_ID, "standard").catch((reason) => reason);
    expect(error).toBeInstanceOf(ExplanationPreparationError);
    expect(error.kind).toBe("malformed");
  });

  it("retries only the selected key without waiting for generation", async () => {
    fetch.mockReturnValueOnce(response(202, {
      video_id: VIDEO_ID,
      intervention_id: INTERVENTION_ID,
      output_mode: "detailed",
      status: "pending",
      error_code: null,
      attempt_count: 1,
    }));
    const { retryExplanationPreparation } = await import("./api.js");

    const result = await retryExplanationPreparation(VIDEO_ID, INTERVENTION_ID, "detailed");

    expect(fetch.mock.calls[0][1].method).toBe("POST");
    expect(fetch.mock.calls[0][0]).toContain(`${INTERVENTION_ID}/explanations/retry`);
    expect(result.status).toBe("pending");
  });

  it("reports retry exhaustion without exposing server internals", async () => {
    fetch.mockReturnValueOnce(response(409, {
      detail: { code: "retry_exhausted", attempt_count: 3 },
    }));
    const { retryExplanationPreparation, ExplanationPreparationError } = await import("./api.js");
    const error = await retryExplanationPreparation(VIDEO_ID, INTERVENTION_ID, "standard")
      .catch((reason) => reason);
    expect(error).toBeInstanceOf(ExplanationPreparationError);
    expect(error.kind).toBe("exhausted");
    expect(error.message).not.toContain("file");
  });

  it("uses the cached GET contract and never calls the generation POST", async () => {
    fetch
      .mockReturnValueOnce(response(200, {
        intervention_id: INTERVENTION_ID,
        text_explanation: "Prepared text.\n\nMore context.",
        audio_file_path: "data/example.mp3",
        audio_url: `/video/intervention/${INTERVENTION_ID}/audio?output_mode=explanatory`,
        output_mode: "explanatory",
      }))
      .mockReturnValueOnce(Promise.resolve({
        ok: true,
        status: 200,
        blob: vi.fn(async () => new Blob(["ID3"], { type: "audio/mpeg" })),
      }));
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:prepared"),
    });
    const { getPreparedExplanation } = await import("./api.js");

    const result = await getPreparedExplanation(INTERVENTION_ID, "standard", VIDEO_ID);

    expect(fetch.mock.calls[0][1].method).toBeUndefined();
    expect(fetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    expect(result.explanation.subtitle).toBe("Prepared text.");
    expect(result.audio.audio_file_path).toBe("blob:prepared");
  });
});
