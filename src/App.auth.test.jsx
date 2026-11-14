import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "./test/domMatchers";

vi.unmock("./lib/accountPolicy");
vi.mock("./components/Home", () => ({ default: () => <main id="main-content" tabIndex={-1}><h1 tabIndex={-1}>Study home</h1></main> }));

let App, accounts, listeners;
const session = { user: { id: "alice", displayName: "Alice", isLocalProfile: false },
  token: "a".repeat(64), expiresAt: "2099-01-01T00:00:00Z" };
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const routes = (url) => {
  const path = new URL(url).pathname;
  if (path === "/auth/logout") return Promise.resolve(response(null, 204));
  if (path.startsWith("/auth/")) return Promise.resolve(response(session));
  return Promise.resolve(response([]));
};
const mount = async () => {
  accounts = await import("./lib/accountSession");
  App = (await import("./App")).default;
  return render(<App />);
};
beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  vi.stubEnv("DEV", false);
  vi.stubEnv("MODE", "production");
  vi.stubEnv("VITE_ONBOARDING_ENABLED", "0");
  vi.stubEnv("VITE_VOICE_CONTROL_ENABLED", "0");
  vi.stubGlobal("fetch", vi.fn(routes));
  listeners = vi.spyOn(window, "addEventListener");
});
afterEach(() => {
  cleanup();
  // Modules are reset between policies; dispose their browser subscription too.
  for (const [name, listener] of listeners.mock.calls) if (name === "storage") window.removeEventListener(name, listener);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("application authentication boundary", () => {
  it("opens login in built mode without private reads, job restoration, or a development bypass", async () => {
    sessionStorage.setItem("synapse_active_processing_job", JSON.stringify({ videoId: "abcdefghijk", processingJobId: "old-job" }));
    await mount();
    expect(screen.getByRole("heading", { name: "Sign in to Synapse" })).toBeTruthy();
    expect(screen.queryByText("Study home")).toBeNull();
    expect(screen.queryByText("Back to development app")).toBeNull();
    expect(screen.queryByRole("button", { name: "Help" })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(document.title).toBe("Sign in – Synapse");
    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
    const title = screen.getByRole("heading", { name: "Create your Synapse account" });
    expect(document.activeElement).toBe(title);
    expect(document.title).toBe("Create account – Synapse");
  });

  it("waits for saved-session verification before mounting study screens", async () => {
    let verify;
    accounts = await import("./lib/accountSession");
    localStorage.setItem(accounts.SESSION_KEY, JSON.stringify(session));
    fetch.mockImplementationOnce(() => new Promise((resolve) => { verify = resolve; }));
    await mount();
    expect(screen.getByRole("heading", { name: "Checking your session" })).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new URL(fetch.mock.calls[0][0]).pathname).toBe("/auth/session");
    await act(async () => verify(response(session)));
    expect(await screen.findByRole("heading", { name: "Study home" })).toBeTruthy();
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("retains the saved credential on a verification outage and retries successfully", async () => {
    accounts = await import("./lib/accountSession");
    localStorage.setItem(accounts.SESSION_KEY, JSON.stringify(session));
    fetch.mockRejectedValueOnce(new TypeError("offline"));
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Study home" })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(accounts.SESSION_KEY)).token).toBe(session.token);
  });

  it("allows opening login after a verification outage without dropping the saved token", async () => {
    accounts = await import("./lib/accountSession");
    localStorage.setItem(accounts.SESSION_KEY, JSON.stringify(session));
    fetch.mockRejectedValueOnce(new TypeError("offline"));
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Sign in instead" }));
    expect(screen.getByRole("heading", { name: "Sign in to Synapse" })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(accounts.SESSION_KEY)).token).toBe(session.token);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows onboarding only after successful signup and clears the form credentials", async () => {
    vi.stubEnv("VITE_ONBOARDING_ENABLED", "1");
    await mount();
    expect(screen.queryByText("Welcome to Synapse")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct password" } });
    fireEvent.submit(screen.getByRole("form"));
    const title = await screen.findByRole("heading", { name: "Welcome to Synapse" });
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(localStorage.getItem(accounts.SESSION_KEY)).not.toContain("correct password");
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(screen.getByRole("heading", { name: "Study home" })).toBeTruthy();
  });

  it("keeps a failed logout signed in and navigates to login only after revocation succeeds", async () => {
    accounts = await import("./lib/accountSession");
    localStorage.setItem(accounts.SESSION_KEY, JSON.stringify(session));
    await mount();
    const signOut = await screen.findByRole("button", { name: "Sign out" });
    fetch.mockRejectedValueOnce(new TypeError("offline"));
    fireEvent.click(signOut);
    expect(await screen.findByText(/Couldn't confirm sign-out/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Study home" })).toBeTruthy();
    fireEvent.click(signOut);
    expect(await screen.findByRole("heading", { name: "Sign in to Synapse" })).toBeTruthy();
    expect(localStorage.getItem(accounts.SESSION_KEY)).toBeNull();
  });

  it("opens development without login and guards navigation to account screens", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("MODE", "development");
    await mount();
    expect(screen.getByRole("heading", { name: "Study home" })).toBeTruthy();
    const remove = accounts.registerAccountGuard(() => { throw new Error("Save the recording first."); });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Save the recording first.")).toBeTruthy();
    expect(screen.queryByRole("form")).toBeNull();
    remove();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Sign in to Synapse" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret password" } });
    fireEvent.click(screen.getByRole("button", { name: "Back to development app" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("form");
    expect(screen.getByLabelText("Password").value).toBe("");
  });

  it("reacts to another tab signing out without private requests under a missing identity", async () => {
    accounts = await import("./lib/accountSession");
    localStorage.setItem(accounts.SESSION_KEY, JSON.stringify(session));
    await mount();
    await screen.findByRole("heading", { name: "Study home" });
    fetch.mockClear();
    await act(async () => {
      localStorage.removeItem(accounts.SESSION_KEY);
      window.dispatchEvent(new StorageEvent("storage", { key: accounts.SESSION_KEY }));
    });
    expect(screen.getByRole("heading", { name: "Sign in to Synapse" })).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("routes an expired account to login without falling back to development data", async () => {
    accounts = await import("./lib/accountSession");
    localStorage.setItem(accounts.SESSION_KEY, JSON.stringify(session));
    await mount();
    await screen.findByRole("heading", { name: "Study home" });
    fetch.mockResolvedValueOnce(response({ detail: "Invalid or expired session." }, 401));
    await act(async () => {
      await expect(accounts.accountRequest("/me/voice-notes")).rejects.toMatchObject({ status: 401 });
    });
    expect(screen.getByRole("heading", { name: "Sign in to Synapse" })).toBeTruthy();
    expect(screen.queryByText("Study home")).toBeNull();
    expect(accounts.currentAccount().user).toBeNull();
  });

  it("offers an explicit local recovery after an invalid session in development", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("MODE", "development");
    accounts = await import("./lib/accountSession");
    localStorage.setItem(accounts.SESSION_KEY, "invalid saved credential");
    await mount();
    expect(screen.getByRole("heading", { name: "Sign in to Synapse" })).toBeTruthy();
    expect(screen.queryByText("Study home")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to development app" }));
    expect(await screen.findByRole("heading", { name: "Study home" })).toBeTruthy();
    expect(accounts.currentAccount().user.isLocalProfile).toBe(true);
  });

  it("reports a memory-only login when persistent storage cannot save the session", async () => {
    await mount();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct password" } });
    fireEvent.submit(screen.getByRole("form"));
    expect(await screen.findByRole("heading", { name: "Study home" })).toBeTruthy();
    expect(screen.getByText(/reopening will require sign-in/)).toBeTruthy();
    expect(accounts.currentAccount().persistent).toBe(false);
  });

  it("retains the study screen and recording when expiry cannot preserve a recovery draft", async () => {
    accounts = await import("./lib/accountSession");
    localStorage.setItem(accounts.SESSION_KEY, JSON.stringify(session));
    await mount();
    await screen.findByRole("heading", { name: "Study home" });
    const remove = accounts.registerAccountGuard(() => { throw new Error("draft storage unavailable"); });
    fetch.mockResolvedValueOnce(response({ detail: "Invalid or expired session." }, 401));
    await act(async () => {
      await expect(accounts.accountRequest("/me/voice-notes")).rejects.toThrow("Keep this window open");
    });
    expect(screen.getByRole("heading", { name: "Study home" })).toBeTruthy();
    expect(accounts.currentAccount().status).toBe("recovery-required");
    expect(accounts.currentAccount().user.id).toBe("alice");
    remove();
  });
});
