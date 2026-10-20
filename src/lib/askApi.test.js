import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  askQuestion,
  buildAskBody,
  formatTimestamp,
  AskError,
  ERROR_MESSAGES,
  ASK_BASE_URL,
  ASK_TIMEOUT_MS,
} from "./askApi";

const VIDEO = "aircAruvnKk";
const UUID = "3f2b8c1e-5d4a-4e7b-9a10-2c6d8e9f0a1b";

const json = (status, body) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });

const ANSWER = {
  status: "answered",
  scope: "lecture",
  answer_text: "The instructor explained it.",
  sources: [{ start_seconds: 42, end_seconds: 80, intervention_id: null }],
};

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const sentBody = (call = 0) => JSON.parse(fetchMock.mock.calls[call][1].body);

describe("formatTimestamp", () => {
  it("formats m:ss and h:mm:ss", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(200)).toBe("3:20");
    expect(formatTimestamp(245.9)).toBe("4:05");
    expect(formatTimestamp(3600)).toBe("1:00:00");
    expect(formatTimestamp(3725)).toBe("1:02:05");
  });
});

describe("buildAskBody", () => {
  it("trims the question and omits optional fields that are absent", () => {
    expect(buildAskBody({ videoId: VIDEO, question: "  hi  " })).toEqual({
      video_id: VIDEO,
      question: "hi",
    });
  });

  it("includes current_time_seconds only when it is a valid number in range", () => {
    const t = (v) =>
      buildAskBody({ videoId: VIDEO, question: "q", currentTimeSeconds: v });
    expect(t(187.5).current_time_seconds).toBe(187.5);
    expect(t(0).current_time_seconds).toBe(0);
    expect(t(172800).current_time_seconds).toBe(172800);
    for (const bad of [-1, 172801, NaN, Infinity, undefined, null, "12"]) {
      expect("current_time_seconds" in t(bad)).toBe(false);
    }
  });

  it("sends real (UUID) intervention ids and never mock-style or empty ones", () => {
    const i = (v) =>
      buildAskBody({ videoId: VIDEO, question: "q", interventionId: v });
    expect(i(UUID).intervention_id).toBe(UUID);
    for (const bad of ["p1", "", null, undefined, "x".repeat(65), "abc_def"]) {
      expect("intervention_id" in i(bad)).toBe(false);
    }
  });
});

describe("askQuestion", () => {
  it("POSTs JSON to /video/ask and returns the parsed answer", async () => {
    fetchMock.mockReturnValue(json(200, ANSWER));
    const out = await askQuestion({
      videoId: VIDEO,
      question: "What?",
      currentTimeSeconds: 12,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${ASK_BASE_URL}/video/ask`);
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(sentBody()).toEqual({
      video_id: VIDEO,
      question: "What?",
      current_time_seconds: 12,
    });
    expect(out).toEqual(ANSWER);
  });

  it("defaults the base URL to the local backend", () => {
    expect(ASK_BASE_URL).toBe("http://127.0.0.1:8000");
  });

  it.each([
    [429, "busy", ERROR_MESSAGES.busy, true],
    [503, "unavailable", ERROR_MESSAGES.unavailable, true],
    [504, "unavailable", ERROR_MESSAGES.unavailable, true],
    [500, "server", ERROR_MESSAGES.server, false],
    [502, "server", ERROR_MESSAGES.server, false],
    [404, "videoNotFound", ERROR_MESSAGES.videoNotFound, false],
    [422, "invalid", ERROR_MESSAGES.invalid, false],
    [403, "forbidden", ERROR_MESSAGES.forbidden, false],
  ])("maps HTTP %i to %s", async (status, kind, message, retryable) => {
    fetchMock.mockReturnValue(
      json(status, { detail: "raw server text that must not be shown" }),
    );
    const err = await askQuestion({ videoId: VIDEO, question: "q" }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(AskError);
    expect(err.kind).toBe(kind);
    expect(err.message).toBe(message);
    expect(err.message).not.toMatch(/raw server text/);
    expect(err.retryable).toBe(retryable);
  });

  it("maps a failed fetch to the network error", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const err = await askQuestion({ videoId: VIDEO, question: "q" }).catch(
      (e) => e,
    );
    expect(err.kind).toBe("network");
    expect(err.message).toBe(ERROR_MESSAGES.network);
    expect(err.retryable).toBe(true);
  });

  it("treats a non-JSON error body as a plain status error", async () => {
    fetchMock.mockReturnValue(
      Promise.resolve({
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error("not json")),
      }),
    );
    const err = await askQuestion({ videoId: VIDEO, question: "q" }).catch(
      (e) => e,
    );
    expect(err.kind).toBe("server");
  });

  it("times out after ~90 s as an 'unavailable' error", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url, { signal }) =>
        new Promise((_res, rej) =>
          signal.addEventListener("abort", () =>
            rej(new DOMException("aborted", "AbortError")),
          ),
        ),
    );
    const p = askQuestion({ videoId: VIDEO, question: "q" }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(ASK_TIMEOUT_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    const err = await p;
    expect(err.kind).toBe("unavailable");
    expect(ASK_TIMEOUT_MS).toBe(90_000);
  });

  it("rejects with AbortError (not an AskError) when the caller aborts", async () => {
    fetchMock.mockImplementation(
      (_url, { signal }) =>
        new Promise((_res, rej) =>
          signal.addEventListener("abort", () =>
            rej(new DOMException("aborted", "AbortError")),
          ),
        ),
    );
    const controller = new AbortController();
    const p = askQuestion({
      videoId: VIDEO,
      question: "q",
      signal: controller.signal,
    }).catch((e) => e);
    controller.abort();
    const err = await p;
    expect(err.name).toBe("AbortError");
    expect(err).not.toBeInstanceOf(AskError);
  });

  it("retries once without intervention_id on 404 'Intervention not found', keeping the time", async () => {
    fetchMock
      .mockReturnValueOnce(json(404, { detail: "Intervention not found" }))
      .mockReturnValueOnce(json(200, ANSWER));
    const out = await askQuestion({
      videoId: VIDEO,
      question: "q",
      currentTimeSeconds: 55,
      interventionId: UUID,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(0).intervention_id).toBe(UUID);
    expect(sentBody(1)).toEqual({
      video_id: VIDEO,
      question: "q",
      current_time_seconds: 55,
    });
    expect(out.status).toBe("answered");
  });

  it("retries at most once", async () => {
    fetchMock.mockReturnValue(json(404, { detail: "Intervention not found" }));
    const err = await askQuestion({
      videoId: VIDEO,
      question: "q",
      interventionId: UUID,
    }).catch((e) => e);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(err.kind).toBe("videoNotFound");
  });

  it("does not retry on 404 'Video not found'", async () => {
    fetchMock.mockReturnValue(json(404, { detail: "Video not found" }));
    const err = await askQuestion({
      videoId: VIDEO,
      question: "q",
      interventionId: UUID,
    }).catch((e) => e);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(err.kind).toBe("videoNotFound");
    expect(err.message).toBe("This video isn't available for questions yet.");
  });

  it("treats a malformed 200 body as a server error", async () => {
    for (const bad of [
      null,
      {},
      { status: "weird", answer_text: "x", sources: [] },
      { status: "answered", answer_text: "", sources: [] },
      { status: "answered", answer_text: 5, sources: [] },
    ]) {
      fetchMock.mockReturnValueOnce(json(200, bad));
      const err = await askQuestion({ videoId: VIDEO, question: "q" }).catch(
        (e) => e,
      );
      expect(err.kind).toBe("server");
    }
  });

  it("drops sources on non-answered statuses and unusable source entries", async () => {
    fetchMock.mockReturnValueOnce(
      json(200, {
        status: "insufficient_context",
        scope: "lecture",
        answer_text: "Not enough.",
        sources: [{ start_seconds: 1, end_seconds: 2, intervention_id: null }],
      }),
    );
    expect(
      (await askQuestion({ videoId: VIDEO, question: "q" })).sources,
    ).toEqual([]);

    fetchMock.mockReturnValueOnce(
      json(200, {
        ...ANSWER,
        sources: [
          { start_seconds: "x", end_seconds: 2 },
          { start_seconds: 5, end_seconds: 5, intervention_id: UUID },
        ],
      }),
    );
    expect(
      (await askQuestion({ videoId: VIDEO, question: "q" })).sources,
    ).toEqual([{ start_seconds: 5, end_seconds: 5, intervention_id: UUID }]);
  });
});
