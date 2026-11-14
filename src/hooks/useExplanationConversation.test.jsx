import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, useState } from "react";
import { newLectureConversation, useExplanationConversation } from "./useExplanationConversation";

const h = vi.hoisted(() => ({ say: vi.fn(async () => {}), stop: vi.fn(), getStatus: vi.fn(), request: vi.fn(), retry: vi.fn(),
  ownedRequest: vi.fn(), ownedList: vi.fn(async () => []), ownedRetry: vi.fn(), progress: vi.fn(async () => {}) }));
vi.mock("../lib/lectureRequests", () => ({ requestLectureExplanation: (...args) => h.ownedRequest(...args),
  listLectureRequests: (...args) => h.ownedList(...args), retryLectureRequest: (...args) => h.ownedRetry(...args),
  updateLectureRequest: (...args) => h.progress(...args) }));
vi.mock("../voice/voiceSpeech", () => ({ createSpeaker: () => ({ say: h.say, stop: h.stop }) }));
vi.mock("../lib/apiConfig", () => ({ API_MOCK_MODE: false }));
vi.mock("../api", () => ({ getExplanationPreparationStatus: (...args) => h.getStatus(...args), requestExplanationPreparation: (...args) => h.request(...args), retryExplanationPreparation: (...args) => h.retry(...args) }));
const points = [{ id: "p1", title: "Equation", timestamp: "2:15" }, { id: "p2", title: "Graph", timestamp: "5:00" }];
const tick = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
function setup(managed = false) {
  const session = newLectureConversation();
  session.statuses.set("p1::standard", { status: "ready" });
  session.statuses.set("p2::standard", { status: "ready" });
  let position = 135;
  let guard = false;
  let ownedItems = [];
  h.ownedList.mockImplementation(async () => ownedItems);
  h.ownedRequest.mockImplementation(async (_video, _point, depth) => ({ id: "owned-1", output_mode: depth === "standard" ? "explanatory" : depth,
    point: points[0], intervention_id: "p1", status: "pending", heard: false, dismissed: false }));
  const media = { pause: vi.fn(), stop: vi.fn(), play: vi.fn(async () => {}), resume: vi.fn(), announce: vi.fn() };
  h.getStatus.mockImplementation(async (_video, depth) => ({ items: points.map((p) => ({ intervention_id: p.id, ...(session.statuses.get(`${p.id}::${depth}`) || { status: "pending" }) })) }));
  h.request.mockImplementation(async (_video, id, depth) => ({ status: session.statuses.get(`${id}::${depth}`)?.status || "pending" }));
  const view = renderHook(({ lectureState = "paused", audioError = null } = {}) => {
    const [selected, setSelected] = useState({ id: "p1", depth: "standard" });
    return useExplanationConversation({ videoId: "aircAruvnKk", session, points, processing: false, depth: selected.depth, activePointId: selected.id,
      audioUrl: `blob:${selected.id}:${selected.depth}`, lectureState, audioError,
      requestSessionId: managed ? "session-1" : null, prepared: async () => {},
      ...media, guarded: () => guard, playerState: () => 2, position: () => position,
      select: (id, depth) => setSelected((prev) => prev.id === id && prev.depth === depth ? prev : { id, depth }),
    });
  }, { initialProps: {} });
  return { ...view, session, media, position: (value) => { position = value; }, guard: (value) => { guard = value; },
    requests: (items) => { ownedItems = items; } };
}
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => vi.useRealTimers());
describe("permission and satisfaction", () => {
  it("holds the lecture until listening and satisfaction are explicitly answered", async () => {
    const e = setup();
    act(() => e.result.current.encounter(points[0]));
    await tick();
    expect(e.result.current.question.choices).toEqual(["listen", "skip"]);
    expect(e.media.play).not.toHaveBeenCalled();
    act(() => e.result.current.answer("listen"));
    await tick();
    expect(e.media.play).toHaveBeenCalledTimes(1);
    act(() => e.result.current.ended("p1", "standard"));
    expect(e.result.current.question.kind).toBe("satisfaction");
    expect(e.media.resume).not.toHaveBeenCalled();
    act(() => e.result.current.answer("yes"));
    expect(e.media.resume).toHaveBeenCalledWith(135);
  });
  it("repeats an unanswered question after 15 seconds and then 30 without resuming", async () => {
    const e = setup();
    act(() => e.result.current.encounter(points[0]));
    await tick();
    expect(h.say).toHaveBeenCalledTimes(1);
    await tick(15000);
    expect(h.say).toHaveBeenCalledTimes(2);
    await tick(30000);
    expect(h.say).toHaveBeenCalledTimes(3);
    expect(e.media.resume).not.toHaveBeenCalled();
  });
  it("rejects unavailable and stale answers", async () => {
    const e = setup();
    act(() => e.result.current.encounter(points[0]));
    const old = e.result.current.question.id;
    act(() => e.result.current.answer("detailed"));
    expect(e.result.current.question.id).toBe(old);
    act(() => e.result.current.manual(points[1]));
    act(() => e.result.current.answer("listen", old));
    await tick();
    expect(e.media.play).not.toHaveBeenCalled();
  });
  it("does not ask satisfaction for a stale audio completion", async () => {
    const e = setup();
    act(() => e.result.current.requestListen(points[0], "standard"));
    await tick();
    act(() => e.result.current.ended("p2", "standard"));
    expect(e.result.current.question).toBeNull();
    expect(e.session.heard.size).toBe(0);
  });
});
describe("alternative generation", () => {
  it.each([false, true])("admits or promotes a direct request when requested is %s", async (requested) => {
    const e = setup();
    e.session.statuses.set("p1::detailed", { status: "pending", requested });
    act(() => e.result.current.requestListen(points[0], "detailed"));
    await tick();
    expect(h.request).toHaveBeenCalledWith("aircAruvnKk", "p1", "detailed", expect.any(Object));
    expect(e.result.current.question.choices).toEqual(["wait", "resume"]);
    expect(e.media.play).not.toHaveBeenCalled();
    expect(e.media.resume).not.toHaveBeenCalled();
  });
  it("offers recovery for a failed direct request without retrying automatically", async () => {
    const e = setup();
    e.session.statuses.set("p1::standard", { status: "failed", retryable: false });
    act(() => e.result.current.requestListen(points[0], "standard"));
    await tick();
    expect(e.result.current.question.kind).toBe("failed");
    expect(e.result.current.question.choices).toEqual(["resume"]);
    expect(h.request).not.toHaveBeenCalled();
    expect(h.retry).not.toHaveBeenCalled();
  });
  it("discards old playback completion after a new direct request", async () => {
    const e = setup();
    act(() => e.result.current.requestListen(points[0], "standard"));
    await tick();
    act(() => e.result.current.requestListen(points[1], "detailed"));
    await tick();
    const question = e.result.current.question;
    act(() => e.result.current.ended("p1", "standard"));
    expect(e.session.heard.has("p1::standard")).toBe(false);
    expect(e.result.current.question).toBe(question);
  });
  async function chooseDetailed(e) {
    act(() => e.result.current.requestListen(points[0], "standard"));
    await tick();
    act(() => e.result.current.ended("p1", "standard"));
    act(() => e.result.current.answer("no"));
    expect(e.result.current.question.choices).toEqual(["brief", "detailed", "resume"]);
    act(() => e.result.current.answer("detailed"));
    await tick();
  }
  it("requests only the selected depth, waits and then plays ready audio", async () => {
    const e = setup();
    await chooseDetailed(e);
    expect(h.request).toHaveBeenCalledWith("aircAruvnKk", "p1", "detailed", expect.any(Object));
    act(() => e.result.current.answer("wait"));
    expect(e.result.current.waiting.depth).toBe("detailed");
    e.session.statuses.set("p1::detailed", { status: "ready" });
    await tick(5000);
    expect(e.media.play).toHaveBeenCalledTimes(2);
    expect(e.media.resume).not.toHaveBeenCalled();
  });
  it("pauses for a ready notification and resumes from the later return position", async () => {
    const e = setup();
    await chooseDetailed(e);
    act(() => e.result.current.answer("resume"));
    e.position(340);
    e.session.statuses.set("p1::detailed", { status: "ready" });
    await tick(5000);
    expect(e.result.current.question.choices).toEqual(["listen", "later"]);
    expect(e.media.play).toHaveBeenCalledTimes(1);
    act(() => e.result.current.answer("listen"));
    await tick();
    act(() => e.result.current.ended("p1", "detailed"));
    act(() => e.result.current.answer("yes"));
    expect(e.media.resume).toHaveBeenLastCalledWith(340);
  });
  it("defers completion notifications behind an unanswered question", async () => {
    const e = setup();
    await chooseDetailed(e);
    e.session.statuses.set("p1::detailed", { status: "ready" });
    const id = e.result.current.question.id;
    await tick(5000);
    expect(e.result.current.question.id).toBe(id);
  });
  it("keeps the lecture paused when request admission fails", async () => {
    const e = setup();
    h.request.mockRejectedValueOnce(new Error("Backend unavailable."));
    await chooseDetailed(e);
    expect(e.result.current.question.kind).toBe("failed");
    expect(e.result.current.isBlocked()).toBe(true);
    expect(e.media.resume).not.toHaveBeenCalled();
  });
});
describe("owned request completion", () => {
  const ready = { id: "owned-1", output_mode: "explanatory", status: "ready", point: points[0],
    intervention_id: "p1", saved_explanation_id: "saved-1", heard: false, dismissed: false };
  it("announces the completed request after resume and offers listen or later once", async () => {
    const e = setup(true);
    act(() => e.result.current.requestCurrent());
    await tick();
    expect(h.ownedRequest).toHaveBeenCalledWith("aircAruvnKk", expect.objectContaining({ timestampSeconds: 135, unresolved: true }),
      "standard", expect.any(Object));
    act(() => e.result.current.answer("resume"));
    e.position(240);
    e.requests([ready]);
    await tick(5000);
    expect(e.result.current.question.prompt).toContain("Standard explanation is ready");
    expect(e.result.current.question.choices).toEqual(["listen", "later"]);
    expect(e.media.play).not.toHaveBeenCalled();
    act(() => e.result.current.answer("later"));
    await tick(10000);
    expect(e.result.current.question).toBeNull();
    expect(e.media.resume).toHaveBeenLastCalledWith(240);
    expect(h.progress).toHaveBeenCalledWith("owned-1", expect.objectContaining({ dismissed: true }));
  });
  it("plays a ready requested version only while the current intent is wait", async () => {
    const e = setup(true);
    act(() => e.result.current.requestCurrent());
    await tick();
    act(() => e.result.current.answer("wait"));
    e.requests([ready]);
    await tick(5000);
    expect(e.media.play).toHaveBeenCalledTimes(1);
    expect(e.media.resume).not.toHaveBeenCalled();
    act(() => e.result.current.ended("p1", "standard"));
    expect(h.progress).toHaveBeenCalledWith("owned-1", expect.objectContaining({ heard: true }));
    expect(e.result.current.question.kind).toBe("satisfaction");
  });
  it("rehydrates heard progress without starting playback", async () => {
    const e = setup(true);
    e.requests([{ ...ready, heard: true }]);
    await tick(5000);
    expect(e.session.heard.has("p1::standard")).toBe(true);
    expect(e.media.play).not.toHaveBeenCalled();
    expect(e.result.current.question).toBeNull();
  });
});

describe("review and guards", () => {
  it("retains review navigation when a waited explanation fails at lecture end", async () => {
    const e = setup();
    e.session.statuses.set("p1::standard", { status: "pending", requested: true });
    e.rerender({ lectureState: "ended" });
    await tick();
    act(() => e.result.current.answer("wait"));
    e.session.statuses.set("p1::standard", { status: "failed", retryable: true });
    e.rerender({ lectureState: "ended", audioError: "Preparation failed" });
    await tick(5000);
    expect(e.result.current.question.kind).toBe("review");
    expect(e.result.current.question.choices).toEqual(["retry", "next", "finish"]);
    act(() => e.result.current.answer("finish"));
    expect(e.session.reviewFinished).toBe(true);
    expect(e.media.resume).not.toHaveBeenCalled();
  });
  it("restores an unanswered question across Timeline remounts, including StrictMode", async () => {
    const e = setup();
    act(() => e.result.current.encounter(points[0]));
    const id = e.result.current.question.id;
    e.unmount();
    const resume = vi.fn();
    const restored = renderHook(() => useExplanationConversation({ videoId: "aircAruvnKk", session: e.session, points,
      pause: vi.fn(), stop: vi.fn(), select: vi.fn(), resume, guarded: () => false, playerState: () => 2,
      announce: vi.fn(), position: () => 135, depth: "standard", lectureState: "paused" }),
      { wrapper: ({ children }) => <StrictMode>{children}</StrictMode> });
    expect(restored.result.current.question.id).toBe(id);
    act(() => restored.result.current.answer("skip"));
    expect(resume).toHaveBeenCalledWith(135);
  });
  it("reviews unheard items by timestamp at lecture end", async () => {
    const e = setup();
    e.session.heard.add("p1::standard");
    e.rerender({ lectureState: "ended" });
    await tick();
    expect(e.result.current.question.kind).toBe("review");
    expect(e.result.current.question.point.id).toBe("p2");
    act(() => e.result.current.answer("finish"));
    expect(e.session.reviewFinished).toBe(true);
    expect(e.media.resume).not.toHaveBeenCalled();
  });
  it("suspends reminders and answers while Help or recording holds the screen", async () => {
    const e = setup();
    act(() => e.result.current.encounter(points[0]));
    await tick();
    e.guard(true);
    await tick(20000);
    act(() => e.result.current.answer("listen"));
    expect(h.say).toHaveBeenCalledTimes(1);
    expect(e.media.play).not.toHaveBeenCalled();
    e.guard(false);
    await tick(500);
    expect(h.say).toHaveBeenCalledTimes(2);
  });
  it("clears reminder timers when leaving", async () => {
    const e = setup();
    act(() => e.result.current.encounter(points[0]));
    await tick();
    e.unmount();
    await tick(60000);
    expect(h.say).toHaveBeenCalledTimes(1);
  });
});
