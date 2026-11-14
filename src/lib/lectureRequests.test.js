import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ request: vi.fn(), transition: null }));
vi.mock("./personalApi", () => ({ personalRequest: (...args) => h.request(...args),
  normalMode: (value) => value === "standard" ? "explanatory" : value }));
vi.mock("./accountSession", () => ({ ACCOUNT_CHANGED: "account-changed",
  registerAccountTransition: (callback) => { h.transition = callback; return () => {}; } }));

let client;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  h.request.mockReset().mockImplementation(async (path) => path === "lecture-sessions" ? { id: "session-1" } : {});
  client = await import("./lectureRequests");
});
afterEach(() => {
  window.dispatchEvent(new Event("account-changed"));
  vi.useRealTimers();
});

it("joins session registration and renews it while the lecture remains open", async () => {
  const first = client.ensureLectureSession("aircAruvnKk");
  expect(client.ensureLectureSession("aircAruvnKk")).toBe(first);
  await first;
  expect(h.request).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(15000);
  expect(h.request).toHaveBeenLastCalledWith("lecture-sessions/session-1/heartbeat", { method: "PUT" });
});

it("retains a failed release so retry targets the same session", async () => {
  await client.ensureLectureSession("aircAruvnKk");
  h.request.mockRejectedValueOnce(new Error("Offline"));
  await expect(client.releaseLectureSession("aircAruvnKk")).rejects.toThrow("Offline");
  expect(await client.ensureLectureSession("aircAruvnKk")).toBe("session-1");
  await client.releaseLectureSession("aircAruvnKk");
  expect(h.request.mock.calls.filter(([path]) => path.endsWith("/release"))).toHaveLength(2);
  expect(vi.getTimerCount()).toBe(0);
});

it("offers reconnection after server expiry and permits a new registration", async () => {
  const expired = vi.fn();
  window.addEventListener(client.LECTURE_SESSION_EXPIRED, expired);
  await client.ensureLectureSession("aircAruvnKk");
  h.request.mockRejectedValueOnce(Object.assign(new Error("Expired"), { status: 409 }));
  await vi.advanceTimersByTimeAsync(15000);
  expect(expired).toHaveBeenCalledTimes(1);
  await client.ensureLectureSession("aircAruvnKk");
  expect(h.request.mock.calls.filter(([path]) => path === "lecture-sessions")).toHaveLength(2);
  window.removeEventListener(client.LECTURE_SESSION_EXPIRED, expired);
});

it("loads older review pages in chronological order", async () => {
  h.request.mockResolvedValueOnce({ items: [{ id: "newer" }], next_cursor: "cursor" })
    .mockResolvedValueOnce({ items: [{ id: "older" }], next_cursor: null });
  expect(await client.listLectureRequests("aircAruvnKk")).toEqual([{ id: "older" }, { id: "newer" }]);
  expect(h.request.mock.calls[1][0]).toContain("before=cursor");
});

it("clears local heartbeat ownership after authenticated logout preserves server work", async () => {
  await client.ensureLectureSession("aircAruvnKk");
  await h.transition({ token: "old-token" }, null);
  window.dispatchEvent(new Event("account-changed"));
  expect(h.request).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
