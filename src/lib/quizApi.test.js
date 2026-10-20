// quizApi with a mocked fetch. No request ever leaves the test.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_QUESTION_COUNT, QUIZ_BASE_URL, QUIZ_ERROR_MESSAGES, QUIZ_TIMEOUT_MS, QuizApiError, buildQuizBody, insufficientMessage,
  isValidQuestionCount, requestQuiz,
} from "./quizApi.js";
import { VIDEO_ID, insufficientQuiz, makeQuiz, partialQuiz } from "../test/quizFixtures.js";

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const brokenJson = (status = 200) => ({ ok: status < 300, status, json: async () => { throw new SyntaxError("bad json"); } });

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const failure = async (promise) => { try { await promise; } catch (e) { return e; } throw new Error("expected rejection"); };
const call = (over = {}) => requestQuiz({ videoId: VIDEO_ID, questionCount: 6, ...over });

describe("request", () => {
  it("posts the documented body to /video/quiz and returns the validated response", async () => {
    fetchMock.mockResolvedValue(json(200, makeQuiz()));
    const quiz = await call();
    expect(quiz).toEqual(makeQuiz());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${QUIZ_BASE_URL}/video/quiz`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ video_id: VIDEO_ID, question_count: 6 });
  });

  it("defaults to six questions and builds only documented fields", () => {
    expect(DEFAULT_QUESTION_COUNT).toBe(6);
    expect(buildQuizBody({ videoId: VIDEO_ID })).toEqual({ video_id: VIDEO_ID, question_count: 6 });
  });

  it("validates the arguments before sending anything", async () => {
    for (const args of [{ videoId: "short" }, { videoId: null }, { videoId: VIDEO_ID, questionCount: 4 }, { videoId: VIDEO_ID, questionCount: 11 },
      { videoId: VIDEO_ID, questionCount: 6.5 }, { videoId: VIDEO_ID, questionCount: "6" }]) {
      const err = await failure(requestQuiz(args));
      expect(err).toMatchObject({ kind: "invalid", retryable: false });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect([5, 10].every(isValidQuestionCount) && ![4, 11, 5.5, NaN].some(isValidQuestionCount)).toBe(true);
  });

  it("makes no network request at import time and never retries by itself", async () => {
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(json(503, { detail: "x" }));
    await failure(call());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("responses", () => {
  it("returns complete, partial and insufficient responses (insufficient is not an error)", async () => {
    fetchMock.mockResolvedValueOnce(json(200, partialQuiz()));
    expect((await call()).status).toBe("partial");
    fetchMock.mockResolvedValueOnce(json(200, insufficientQuiz()));
    const empty = await call();
    expect(empty).toMatchObject({ status: "insufficient_material", reason: "too_short", questions: [] });
  });

  it("gives plain-language text for each insufficient reason", () => {
    expect(insufficientMessage("no_transcript")).toMatch(/usable transcript/);
    expect(insufficientMessage("too_short")).toMatch(/too short/);
    expect(insufficientMessage("validation_failed")).toMatch(/too few passed/);
    expect(insufficientMessage("anything else")).toBe(insufficientMessage("validation_failed"));
  });

  it("rejects bodies that break the contract as 'unusable' (retryable), and saves nothing", async () => {
    const shortAnswer = makeQuiz();
    shortAnswer.questions[0] = { ...shortAnswer.questions[0], type: "short" };
    const verified = makeQuiz();
    verified.questions[1].grounding = "verified";
    const bad = [
      null, "text", [], {}, { ...makeQuiz(), contract_version: 2 }, shortAnswer, verified,
      { ...makeQuiz(), returned_count: 3 }, { ...makeQuiz(), status: "partial" }, makeQuiz({ questions: "x" }),
    ];
    for (const body of bad) {
      fetchMock.mockResolvedValueOnce(json(200, body));
      expect(await failure(call()), JSON.stringify(body)?.slice(0, 60)).toMatchObject({ kind: "unusable", retryable: true });
    }
    fetchMock.mockResolvedValueOnce(brokenJson());
    expect(await failure(call())).toMatchObject({ kind: "unusable" });
  });

  it("rejects a response for another lecture or another count", async () => {
    fetchMock.mockResolvedValueOnce(json(200, makeQuiz({ video_id: "aircAruvnKk" })));
    expect(await failure(call())).toMatchObject({ kind: "unusable" });
    fetchMock.mockResolvedValueOnce(json(200, partialQuiz()));
    expect(await failure(call({ questionCount: 8 }))).toMatchObject({ kind: "unusable" });
  });

  it("does not return fields the contract does not define", async () => {
    fetchMock.mockResolvedValue(json(200, { ...makeQuiz(), api_key: "sk-secret", transcript: "all of it" }));
    expect(JSON.stringify(await call())).not.toMatch(/sk-secret|all of it/);
  });
});

describe("errors", () => {
  const table = [
    [429, null, "busy", true], [503, null, "unavailable", true], [504, null, "unavailable", true], [502, null, "unusable", true],
    [500, null, "server", false], [403, null, "forbidden", false], [422, null, "invalid", false],
    [404, "Video not found", "videoNotFound", false], [404, "Quiz is not available.", "featureOff", false],
    [404, "something else", "server", false], [404, null, "server", false], [418, null, "server", false],
  ];
  it.each(table)("HTTP %s (%s) -> %s", async (status, detail, kind, retryable) => {
    fetchMock.mockResolvedValue(json(status, detail ? { detail } : {}));
    const err = await failure(call());
    expect(err).toBeInstanceOf(QuizApiError);
    expect(err).toMatchObject({ kind, retryable, status });
    expect(err.message).toBe(QUIZ_ERROR_MESSAGES[kind]);
  });

  it("never shows raw server text", async () => {
    fetchMock.mockResolvedValue(json(500, { detail: "Traceback: sk-SECRET at /srv/app.py" }));
    const err = await failure(call());
    expect(err.message).not.toMatch(/Traceback|SECRET/);
    expect(JSON.stringify(err)).not.toMatch(/SECRET/);
  });

  it("copes with error bodies that are not JSON", async () => {
    fetchMock.mockResolvedValue(brokenJson(500));
    expect(await failure(call())).toMatchObject({ kind: "server" });
  });

  it("maps a network failure to 'network' (retryable)", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await failure(call())).toMatchObject({ kind: "network", retryable: true });
  });

  it("times out as 'unavailable' but stays silent when the caller aborts", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    const pending = failure(call());
    await vi.advanceTimersByTimeAsync(QUIZ_TIMEOUT_MS + 1);
    expect(await pending).toMatchObject({ kind: "unavailable", retryable: true });

    const controller = new AbortController();
    const aborted = failure(call({ signal: controller.signal }));
    controller.abort();
    const err = await aborted;
    expect(err.name).toBe("AbortError");
    expect(err).not.toBeInstanceOf(QuizApiError);
  });

  it("an already-aborted signal sends nothing useful and rejects with AbortError", async () => {
    fetchMock.mockImplementation((_url, { signal }) => (signal.aborted
      ? Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" })) : Promise.resolve(json(200, makeQuiz()))));
    const controller = new AbortController();
    controller.abort();
    expect((await failure(call({ signal: controller.signal }))).name).toBe("AbortError");
  });
});
