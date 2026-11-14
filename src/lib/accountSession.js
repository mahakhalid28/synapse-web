// Local accounts and the shared authorization boundary for personal requests.
// Tokens are persisted for local HTTP use; never put them in URLs or logs.
import { API_BASE_URL, apiUrl } from "./apiConfig";
import { developmentAccess } from "./accountPolicy";

export const LOCAL_PROFILE_ID = "00000000-0000-4000-8000-000000000001";
export const ACCOUNT_CHANGED = "synapse-account-changed";
export const SESSION_KEY = `synapse_account:${API_BASE_URL}`;
const localUser = { id: LOCAL_PROFILE_ID, displayName: "Local development", isLocalProfile: true };
const signedOut = () => ({ user: developmentAccess() ? localUser : null, token: null,
  status: developmentAccess() ? "ready" : "signed-out", persistent: true });
let state = signedOut();
let loaded = false;
let initialization = null;
let generation = 0;
let changing = false;
const guards = new Set();
const transitions = new Set();
const pending = new Set();

export class AccountError extends Error {
  constructor(message, status = 0) { super(message); this.name = "AccountError"; this.status = status; }
}

function requireLocal() {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(API_BASE_URL).hostname)) {
    throw new AccountError("Accounts require the backend on this computer.");
  }
}

function decode(raw) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (typeof value.token !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(value.token) ||
        typeof value.user?.id !== "string" || value.user.isLocalProfile !== false) throw new Error();
    return value;
  } catch { return { status: "invalid", user: null, token: null }; }
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const saved = decode(globalThis.localStorage?.getItem(SESSION_KEY));
    if (saved) state = { ...saved, status: saved.token ? "restoring" : "invalid", persistent: true };
  } catch { state = { ...state, persistent: false }; }
}

export function currentAccount() { load(); return { ...state, generation }; }
export function accountOwner() {
  const account = currentAccount();
  if (!account.user || account.status === "invalid") throw new AccountError("Your session ended. Sign in again.", 401);
  return account.user.id;
}
export function captureAccount() { return currentAccount(); }
export function assertAccount(snapshot) {
  if (snapshot.generation !== generation || snapshot.token !== state.token) {
    throw new AccountError("The account changed. This operation was stopped.", 409);
  }
  if (!state.user || state.status === "invalid") throw new AccountError("Your session ended. Sign in again.", 401);
}
export function registerAccountGuard(guard) { guards.add(guard); return () => guards.delete(guard); }
export function registerAccountTransition(callback) { transitions.add(callback); return () => transitions.delete(callback); }
export async function prepareAccountChange() {
  for (const guard of guards) await guard(false);
}

function announceChange() {
  for (const controller of pending) controller.abort();
  pending.clear();
  generation++;
  globalThis.window?.dispatchEvent(new CustomEvent(ACCOUNT_CHANGED, { detail: currentAccount() }));
}

function install(value, persist = true) {
  state = value ? { ...value, status: value.status || "ready", persistent: true } :
    signedOut();
  initialization = null;
  if (persist) {
    try {
      // Keep an invalid-session marker; a reload must not silently become the local profile.
      if (value) globalThis.localStorage?.setItem(SESSION_KEY, JSON.stringify(value));
      else globalThis.localStorage?.removeItem(SESSION_KEY);
      if (!globalThis.localStorage) state.persistent = false;
    } catch {
      state.persistent = false;
      // Avoid restoring a previous account when writing the new session failed.
      try { globalThis.localStorage?.removeItem(SESSION_KEY); } catch { /* storage is inaccessible */ }
    }
  }
  announceChange();
}

async function responseError(response) {
  let detail;
  try { detail = (await response.json()).detail; } catch { /* unavailable response body */ }
  return new AccountError(typeof detail === "string" ? detail : "Account request failed. Please try again.", response.status);
}

async function authRequest(path, body, token) {
  requireLocal();
  const headers = new Headers();
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(apiUrl(`/auth/${path}`), { method: body === undefined ? "GET" : "POST",
    headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), cache: "no-store" });
  if (!response.ok) throw await responseError(response);
  return response.status === 204 ? null : response.json();
}

async function invalidateSession(expected) {
  if (expected.generation !== generation) return;
  try {
    for (const guard of guards) await guard(true);
  } catch {
    // Do not dispose the only in-memory recording if recovery storage failed.
    if (expected.generation === generation) state = { ...state, status: "recovery-required" };
    throw new AccountError("Your session ended. Keep this window open and preserve or discard the recording before changing accounts.", 401);
  }
  if (expected.generation === generation) install({ status: "invalid", user: null, token: null });
}

export async function initializeAccount() {
  load();
  if (state.status === "recovery-required") throw new AccountError("Your session ended. Keep this window open to retain your recording.", 401);
  if (state.status === "invalid") throw new AccountError("Your session ended. Sign in again.", 401);
  if (!state.token || state.status === "ready") return currentAccount();
  if (!initialization) {
    const expected = captureAccount();
    const restoring = authRequest("session", undefined, expected.token).then((data) => {
      assertAccount(expected);
      if (data.user.id !== expected.user.id) throw new AccountError("The saved session is invalid.", 401);
      state = { ...state, ...data, status: "ready" };
      return currentAccount();
    }).catch(async (error) => {
      if (expected.generation === generation && error.status === 401) await invalidateSession(expected);
      throw error;
    }).finally(() => { if (initialization === restoring) initialization = null; });
    initialization = restoring;
  }
  return initialization;
}

async function transition(action) {
  load();
  if (changing) throw new AccountError("An account change is already in progress.", 409);
  changing = true;
  try {
    await prepareAccountChange();
    const expected = captureAccount();
    const result = await action(expected);
    // Invalid/expired accounts may explicitly login or logout.
    if (expected.generation !== generation) throw new AccountError("The account changed. Try again.", 409);
    for (const callback of transitions) await callback(expected, result);
    install(result);
    return currentAccount();
  } finally { changing = false; }
}

export const signup = (username, password, displayName = "") => transition(() =>
  authRequest("signup", { username, password, display_name: displayName }));
export const login = (username, password) => transition(() => authRequest("login", { username, password }));
export const logout = () => transition(async (expected) => {
  if (expected.token) await authRequest("logout", {}, expected.token);
  return null;
});

// Scope request + response-body consumption to the initiating identity.
export async function accountRequest(path, options = {}, format = "json") {
  const { account = captureAccount(), ...init } = options;
  await initializeAccount();
  assertAccount(account);
  requireLocal();
  const headers = new Headers(init.headers);
  if (account.token) headers.set("Authorization", `Bearer ${account.token}`);
  const controller = new AbortController();
  const abort = () => controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  if (init.signal?.aborted) controller.abort();
  pending.add(controller);
  try {
    const response = await fetch(apiUrl(path), { ...init, headers, signal: controller.signal, cache: "no-store" });
    assertAccount(account);
    if (!response.ok) {
      const error = await responseError(response);
      if (response.status === 401 && account.generation === generation) await invalidateSession(account);
      throw error;
    }
    const result = response.status === 204 ? null : await (format === "blob" ? response.blob() : response.json());
    assertAccount(account);
    return result;
  } finally {
    pending.delete(controller);
    init.signal?.removeEventListener("abort", abort);
  }
}

globalThis.window?.addEventListener("storage", async (event) => {
  if (event.storageArea && event.storageArea !== globalThis.localStorage) return;
  if (event.key !== SESSION_KEY && event.key !== null) return;
  const expected = captureAccount();
  try {
    for (const guard of guards) await guard(true);
    if (generation !== expected.generation) return;
    const raw = globalThis.localStorage?.getItem(SESSION_KEY);
    const saved = decode(raw);
    install(saved?.token ? { ...saved, status: "restoring" } : saved, false);
  } catch {
    // A recorder can veto disposal if its recovery draft cannot be persisted.
    // Keep the old identity; never move its in-memory recording to the new user.
  }
});
