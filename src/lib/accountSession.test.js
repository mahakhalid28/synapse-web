import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

let accounts;
const user = (id) => ({ id, displayName: id, isLocalProfile: false });
const session = (id) => ({ user: user(id), token: id.padEnd(64, "x"), expiresAt: "2099-01-01T00:00:00Z" });
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body,
  blob: async () => new Blob(["audio"], { type: "audio/mpeg" }) });

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn());
  accounts = await import("./accountSession");
});
afterEach(() => vi.unstubAllGlobals());

describe("local account client without UI", () => {
  it("keeps the development workflow available without an account request", async () => {
    expect((await accounts.initializeAccount()).user.id).toBe(accounts.LOCAL_PROFILE_ID);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockResolvedValue(response([]));
    await accounts.accountRequest("/me/saved-library");
    expect(fetch.mock.calls[0][1].headers.has("Authorization")).toBe(false);
  });

  it("signs up, persists only the session and authenticates private requests", async () => {
    fetch.mockResolvedValueOnce(response(session("alice"), 201)).mockResolvedValueOnce(response([]));
    await accounts.signup("alice", "private password");
    await accounts.accountRequest("/me/voice-notes");
    const saved = localStorage.getItem(accounts.SESSION_KEY);
    expect(saved).not.toContain("private password");
    expect(JSON.parse(saved).user.id).toBe("alice");
    expect(fetch.mock.calls[1][1].headers.get("Authorization")).toBe(`Bearer ${session("alice").token}`);
  });

  it("validates a saved session once before loading private data", async () => {
    localStorage.setItem(accounts.SESSION_KEY, JSON.stringify(session("alice")));
    fetch.mockResolvedValueOnce(response({ user: user("alice"), expiresAt: "2099" })).mockResolvedValueOnce(response([]));
    await accounts.accountRequest("/me/saved-library");
    expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(["/auth/session", "/me/saved-library"]);
  });

  it("never falls back to the local profile for an expired session, even after reload", async () => {
    localStorage.setItem(accounts.SESSION_KEY, JSON.stringify(session("alice")));
    fetch.mockResolvedValue(response({ detail: "expired" }, 401));
    await expect(accounts.accountRequest("/me/voice-notes")).rejects.toMatchObject({ status: 401 });
    expect(accounts.currentAccount().status).toBe("invalid");
    vi.resetModules();
    const reopened = await import("./accountSession");
    await expect(reopened.initializeAccount()).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not discard a session if logout cannot reach the backend", async () => {
    fetch.mockResolvedValueOnce(response(session("alice")));
    await accounts.login("alice", "password");
    fetch.mockRejectedValueOnce(new Error("offline"));
    await expect(accounts.logout()).rejects.toThrow("offline");
    expect(accounts.currentAccount().user.id).toBe("alice");
    fetch.mockResolvedValueOnce(response(null, 204));
    await accounts.logout();
    expect(accounts.currentAccount().user.id).toBe(accounts.LOCAL_PROFILE_ID);
    expect(localStorage.getItem(accounts.SESSION_KEY)).toBeNull();
  });

  it("discards a late response after an account switch", async () => {
    fetch.mockResolvedValueOnce(response(session("alice")));
    await accounts.login("alice", "password");
    let resolve;
    fetch.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const oldRequest = accounts.accountRequest("/me/voice-notes");
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    fetch.mockResolvedValueOnce(response(session("bob")));
    await accounts.login("bob", "password");
    resolve(response([{ private: "alice" }]));
    await expect(oldRequest).rejects.toMatchObject({ status: 409 });
    expect(accounts.currentAccount().user.id).toBe("bob");
  });

  it("does not let an old 401 invalidate a newer login", async () => {
    fetch.mockResolvedValueOnce(response(session("alice")));
    await accounts.login("alice", "password");
    let resolve;
    fetch.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const oldRequest = accounts.accountRequest("/me/saved-library");
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    fetch.mockResolvedValueOnce(response(session("bob")));
    await accounts.login("bob", "password");
    resolve(response({ detail: "revoked" }, 401));
    await expect(oldRequest).rejects.toMatchObject({ status: 409 });
    expect(accounts.currentAccount().user.id).toBe("bob");
  });

  it("honors recording guards before sending account changes", async () => {
    const unregister = accounts.registerAccountGuard(() => { throw new Error("Save the draft first"); });
    await expect(accounts.login("alice", "password")).rejects.toThrow("Save the draft first");
    expect(fetch).not.toHaveBeenCalled();
    unregister();
  });

  it("rejects operations pinned to a previous identity", async () => {
    const old = accounts.captureAccount();
    fetch.mockResolvedValueOnce(response(session("alice")));
    await accounts.login("alice", "password");
    await expect(accounts.accountRequest("/me/voice-notes", { account: old })).rejects.toMatchObject({ status: 409 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps tokens out of private media URLs", async () => {
    fetch.mockResolvedValueOnce(response(session("alice")));
    await accounts.login("alice", "password");
    fetch.mockResolvedValueOnce(response(null));
    const blob = await accounts.accountRequest("/me/voice-notes/note/audio", {}, "blob");
    expect(blob.size).toBeGreaterThan(0);
    expect(fetch.mock.calls[1][0]).not.toContain(session("alice").token);
    expect(fetch.mock.calls[1][1].headers.get("Authorization")).toBe(`Bearer ${session("alice").token}`);
  });

  it("synchronizes another tab's account after running its recording guard", async () => {
    fetch.mockResolvedValueOnce(response(session("alice")));
    await accounts.login("alice", "password");
    const guard = vi.fn(async () => {});
    const unregister = accounts.registerAccountGuard(guard);
    localStorage.setItem(accounts.SESSION_KEY, JSON.stringify(session("bob")));
    window.dispatchEvent(new StorageEvent("storage", { key: accounts.SESSION_KEY }));
    await vi.waitFor(() => expect(accounts.currentAccount().user.id).toBe("bob"));
    expect(guard).toHaveBeenCalledWith(true);
    unregister();
  });

  it("reports an in-memory session when browser persistence fails", async () => {
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    fetch.mockResolvedValueOnce(response(session("alice")));
    const result = await accounts.login("alice", "password");
    expect(result.user.id).toBe("alice");
    expect(result.persistent).toBe(false);
    write.mockRestore();
  });

  it("runs account transition cleanup only after guards and successful authentication", async () => {
    const cleanup = vi.fn(async () => {});
    const unregisterCleanup = accounts.registerAccountTransition(cleanup);
    const unregisterGuard = accounts.registerAccountGuard(() => { throw new Error("Keep the draft"); });
    await expect(accounts.login("alice", "password")).rejects.toThrow("Keep the draft");
    expect(cleanup).not.toHaveBeenCalled();
    unregisterGuard();
    fetch.mockResolvedValueOnce(response({ detail: "Invalid password" }, 401));
    await expect(accounts.login("alice", "wrong password")).rejects.toThrow();
    expect(cleanup).not.toHaveBeenCalled();
    fetch.mockResolvedValueOnce(response(session("alice")));
    await accounts.login("alice", "password");
    expect(cleanup).toHaveBeenCalledTimes(1);
    unregisterCleanup();
  });

  it("retains the recording's identity if expiry cannot safely dispose its draft", async () => {
    fetch.mockResolvedValueOnce(response(session("alice")));
    await accounts.login("alice", "password");
    const unregister = accounts.registerAccountGuard(() => { throw new Error("draft storage unavailable"); });
    fetch.mockResolvedValueOnce(response({ detail: "expired" }, 401));
    await expect(accounts.accountRequest("/me/voice-notes")).rejects.toThrow("Keep this window open");
    expect(accounts.currentAccount().user.id).toBe("alice");
    expect(accounts.currentAccount().status).toBe("recovery-required");
    await expect(accounts.accountRequest("/me/voice-notes")).rejects.toThrow("Keep this window open");
    unregister();
  });
});
