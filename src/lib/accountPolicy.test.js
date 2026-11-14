import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("./accountPolicy");
let accounts;
const session = { user: { id: "alice", displayName: "Alice", isLocalProfile: false },
  token: "a".repeat(64), expiresAt: "2099-01-01T00:00:00Z" };
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  vi.stubEnv("DEV", false);
  vi.stubEnv("MODE", "production");
  vi.stubGlobal("fetch", vi.fn());
  accounts = await import("./accountSession");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("account access policy", () => {
  it("blocks private requests without issuing a fetch in built mode", async () => {
    expect((await accounts.initializeAccount()).status).toBe("signed-out");
    expect(accounts.currentAccount().user).toBeNull();
    await expect(accounts.accountRequest("/me/saved-library")).rejects.toMatchObject({ status: 401 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("restores a session before personal reads and returns to signed-out on logout", async () => {
    localStorage.setItem(accounts.SESSION_KEY, JSON.stringify(session));
    fetch.mockResolvedValueOnce(response(session)).mockResolvedValueOnce(response([]));
    await accounts.accountRequest("/me/saved-library");
    expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(["/auth/session", "/me/saved-library"]);
    fetch.mockResolvedValueOnce(response(null, 204));
    await accounts.logout();
    expect(accounts.currentAccount()).toMatchObject({ user: null, status: "signed-out" });
    await expect(accounts.accountRequest("/me/saved-library")).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("keeps a saved session recoverable after a network failure", async () => {
    localStorage.setItem(accounts.SESSION_KEY, JSON.stringify(session));
    fetch.mockRejectedValueOnce(new TypeError("offline"));
    await expect(accounts.initializeAccount()).rejects.toThrow("offline");
    expect(accounts.currentAccount().status).toBe("restoring");
    expect(JSON.parse(localStorage.getItem(accounts.SESSION_KEY)).token).toBe(session.token);
    fetch.mockResolvedValueOnce(response(session));
    expect((await accounts.initializeAccount()).status).toBe("ready");
  });

  it("requires verification even if persisted storage claims to be ready", async () => {
    localStorage.setItem(accounts.SESSION_KEY, JSON.stringify({ ...session, status: "ready" }));
    fetch.mockResolvedValueOnce(response(session));
    await accounts.initializeAccount();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("allows automatic local access only in development, excluding tests", async () => {
    const { developmentAccess } = await import("./accountPolicy");
    vi.stubEnv("DEV", true);
    vi.stubEnv("MODE", "test");
    expect(developmentAccess()).toBe(false);
    vi.stubEnv("MODE", "development");
    expect(developmentAccess()).toBe(true);
    vi.resetModules();
    accounts = await import("./accountSession");
    expect((await accounts.initializeAccount()).user.isLocalProfile).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
