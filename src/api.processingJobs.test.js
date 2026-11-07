import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VIDEO_ID = "aircAruvnKk";
const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const response = (status, body) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  });

const job = (overrides = {}) => ({
  job_id: JOB_ID,
  video_id: VIDEO_ID,
  status: "running",
  stage: "processing",
  attempt_count: 1,
  joined_existing: false,
  reused_cache: false,
  error_code: null,
  error_message: null,
  ...overrides,
});

const persisted = () => ({
  video_id: VIDEO_ID,
  title: "Neural Networks",
  duration_seconds: 60,
  duration_formatted: "01:00",
  total_interventions: 0,
  interventions: [],
});

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubEnv("VITE_API_MOCK_MODE", "false");
  vi.stubEnv("VITE_API_BASE_URL", "http://127.0.0.1:8000");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("durable video processing jobs", () => {
  it("creates, polls actual stages, then loads persisted interventions", async () => {
    const fetchMock = vi.fn()
      .mockReturnValueOnce(response(202, job({ status: "queued", stage: "queued" })))
      .mockReturnValueOnce(response(200, job({ stage: "persisting" })))
      .mockReturnValueOnce(response(200, job({
        status: "succeeded",
        stage: "complete",
      })))
      .mockReturnValueOnce(response(200, persisted()));
    vi.stubGlobal("fetch", fetchMock);
    const statuses = [];
    const { processVideo } = await import("./api.js");

    const processing = processVideo({
      videoId: VIDEO_ID,
      mode: "detailed",
      onStatus: (status) => statuses.push(status),
    });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(processing).resolves.toMatchObject({ jobId: JOB_ID, videoId: VIDEO_ID });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "http://127.0.0.1:8000/video/processing-jobs",
      `http://127.0.0.1:8000/video/processing-jobs/${JOB_ID}`,
      `http://127.0.0.1:8000/video/processing-jobs/${JOB_ID}`,
      `http://127.0.0.1:8000/video/${VIDEO_ID}/interventions`,
    ]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).output_mode).toBe("detailed");
    expect(statuses.map(({ stage }) => stage)).toEqual(["queued", "persisting", "complete"]);
    expect(statuses.every((status) => !("progress" in status))).toBe(true);
    expect(statuses.at(-1).message).toBe(
      "Initial processing completed. Explanations may still be preparing.",
    );
  });

  it("handles a cache hit without polling but still loads persisted data", async () => {
    const fetchMock = vi.fn()
      .mockReturnValueOnce(response(200, job({
        status: "succeeded",
        stage: "complete",
        reused_cache: true,
      })))
      .mockReturnValueOnce(response(200, persisted()));
    vi.stubGlobal("fetch", fetchMock);
    const { processVideo } = await import("./api.js");

    await expect(processVideo({ videoId: VIDEO_ID, mode: "standard" }))
      .resolves.toMatchObject({ reusedCache: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces a safe failed job and retries its durable job id", async () => {
    const fetchMock = vi.fn()
      .mockReturnValueOnce(response(200, job({
        status: "failed",
        stage: "failed",
        error_code: "pipeline_failed",
        error_message: "safe backend message",
      })))
      .mockReturnValueOnce(response(200, job({
        status: "succeeded",
        stage: "complete",
        attempt_count: 2,
      })))
      .mockReturnValueOnce(response(200, persisted()));
    vi.stubGlobal("fetch", fetchMock);
    const { processVideo, VideoProcessingError } = await import("./api.js");

    const error = await processVideo({ videoId: VIDEO_ID, mode: "standard" })
      .catch((reason) => reason);
    expect(error).toBeInstanceOf(VideoProcessingError);
    expect(error).toMatchObject({ kind: "failed", jobId: JOB_ID, retryable: true });
    expect(error.message).not.toContain("safe backend message");

    await processVideo({
      videoId: VIDEO_ID,
      mode: "standard",
      jobId: JOB_ID,
      retry: true,
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      `http://127.0.0.1:8000/video/processing-jobs/${JOB_ID}/retry`,
    );
    expect(fetchMock.mock.calls[1][1].body).toBeUndefined();
  });

  it("announces an interrupted poll and reconnects to the same job", async () => {
    const fetchMock = vi.fn()
      .mockReturnValueOnce(response(202, job({ status: "queued", stage: "queued" })))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockReturnValueOnce(response(200, job({ status: "succeeded", stage: "complete" })))
      .mockReturnValueOnce(response(200, persisted()));
    vi.stubGlobal("fetch", fetchMock);
    const statuses = [];
    const { processVideo } = await import("./api.js");

    const processing = processVideo({
      videoId: VIDEO_ID,
      mode: "standard",
      onStatus: (status) => statuses.push(status),
    });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(processing).resolves.toBeTruthy();
    expect(statuses.some((status) => status.connectionInterrupted)).toBe(true);
    expect(fetchMock.mock.calls[2][0]).toContain(`/processing-jobs/${JOB_ID}`);
  });

  it("aborts polling on navigation cleanup", async () => {
    const fetchMock = vi.fn()
      .mockReturnValueOnce(response(202, job({ status: "queued", stage: "queued" })));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const { processVideo } = await import("./api.js");
    const processing = processVideo({
      videoId: VIDEO_ID,
      mode: "standard",
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();

    await expect(processing).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("deduplicates identical in-flight submissions", async () => {
    const fetchMock = vi.fn()
      .mockReturnValueOnce(response(200, job({ status: "succeeded", stage: "complete" })))
      .mockReturnValueOnce(response(200, persisted()));
    vi.stubGlobal("fetch", fetchMock);
    const { processVideo } = await import("./api.js");

    const first = processVideo({ videoId: VIDEO_ID, mode: "standard" });
    const second = processVideo({ videoId: VIDEO_ID, mode: "standard" });
    expect(second).toBe(first);
    await first;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("posts video cancellation without a body and accepts a truthful cancelling state", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(response(202, job({
      status: "cancelling",
      stage: "cancelling",
    })));
    vi.stubGlobal("fetch", fetchMock);
    const { cancelProcessingJob } = await import("./api.js");

    await expect(cancelProcessingJob(JOB_ID, VIDEO_ID)).resolves.toMatchObject({
      status: "cancelling",
      stage: "cancelling",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `http://127.0.0.1:8000/video/processing-jobs/${JOB_ID}/cancel`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });

  it("continues polling through cancelling and stops at backend-confirmed cancelled", async () => {
    const fetchMock = vi.fn()
      .mockReturnValueOnce(response(202, job({ status: "running" })))
      .mockReturnValueOnce(response(200, job({ status: "cancelling", stage: "cancelling" })))
      .mockReturnValueOnce(response(200, job({ status: "cancelled", stage: "cancelled" })));
    vi.stubGlobal("fetch", fetchMock);
    const statuses = [];
    const { processVideo } = await import("./api.js");

    const processing = processVideo({
      videoId: VIDEO_ID,
      mode: "standard",
      onStatus: (status) => statuses.push(status),
    });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    await expect(processing).resolves.toMatchObject({ status: "cancelled" });
    expect(statuses.map(({ status }) => status)).toEqual([
      "running",
      "cancelling",
      "cancelled",
    ]);
    expect(statuses.at(-1).message).toBe(
      "Processing cancelled. Completed explanations are saved.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("resumes the same job, polls it, and then loads committed interventions", async () => {
    const fetchMock = vi.fn()
      .mockReturnValueOnce(response(202, job({ status: "queued", stage: "queued" })))
      .mockReturnValueOnce(response(200, job({ status: "succeeded", stage: "complete", attempt_count: 2 })))
      .mockReturnValueOnce(response(200, persisted()));
    vi.stubGlobal("fetch", fetchMock);
    const statuses = [];
    const { resumeProcessingJob } = await import("./api.js");

    const resumed = resumeProcessingJob(JOB_ID, VIDEO_ID, {
      onStatus: (status) => statuses.push(status),
    });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(resumed).resolves.toMatchObject({ jobId: JOB_ID, status: "succeeded" });
    expect(fetchMock.mock.calls[0][0]).toBe(
      `http://127.0.0.1:8000/video/processing-jobs/${JOB_ID}/resume`,
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
    expect(statuses.map(({ status }) => status)).toEqual(["queued", "succeeded"]);
  });

  it("reconnects to a persisted job with GET and never creates a replacement", async () => {
    const fetchMock = vi.fn()
      .mockReturnValueOnce(response(200, job({ status: "cancelled", stage: "cancelled" })));
    vi.stubGlobal("fetch", fetchMock);
    const { reconnectProcessingJob } = await import("./api.js");

    await expect(reconnectProcessingJob(JOB_ID, VIDEO_ID)).resolves.toMatchObject({
      jobId: JOB_ID,
      status: "cancelled",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `http://127.0.0.1:8000/video/processing-jobs/${JOB_ID}`,
    );
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
  });

  it("surfaces the structured single-video busy conflict safely", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(response(409, {
      detail: {
        code: "video_processing_busy",
        active_video_id: "otherVideo1",
        active_job_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { processVideo, VideoProcessingError } = await import("./api.js");

    const error = await processVideo({ videoId: VIDEO_ID, mode: "standard" })
      .catch((reason) => reason);
    expect(error).toBeInstanceOf(VideoProcessingError);
    expect(error).toMatchObject({
      kind: "busy",
      status: 409,
      code: "video_processing_busy",
      retryable: false,
    });
    expect(error.message).toBe("Another video is currently being processed.");
  });

  it("times out a stuck Cancel request without claiming cancellation succeeded", async () => {
    const fetchMock = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { cancelProcessingJob, VideoProcessingError } = await import("./api.js");

    const cancelling = cancelProcessingJob(JOB_ID, VIDEO_ID).catch((reason) => reason);
    await vi.advanceTimersByTimeAsync(15_000);
    const error = await cancelling;
    expect(error).toBeInstanceOf(VideoProcessingError);
    expect(error.kind).toBe("network");
    expect(error.message).not.toContain("cancelled");
  });

  it("accepts completion when Cancel races with an already-completed backend job", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(response(200, job({
      status: "succeeded",
      stage: "complete",
    })));
    vi.stubGlobal("fetch", fetchMock);
    const { cancelProcessingJob } = await import("./api.js");

    await expect(cancelProcessingJob(JOB_ID, VIDEO_ID)).resolves.toMatchObject({
      status: "succeeded",
      stage: "complete",
    });
  });
});
