import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

// The policy lives in electron/ (main-process, CommonJS); load it the way
// Node would so no test-config change is needed.
const require = createRequire(import.meta.url);
const { createPermissionPolicy, installPermissionPolicy, packagedPageUrl } = require("../../electron/permissions.cjs");

const DEV = "http://localhost:5173";
const APP_DIR = path.resolve("C:/apps/Synapse/resources/app");
const PACKAGED = packagedPageUrl(APP_DIR, path);
const YT = "https://www.youtube.com/embed/abc";

const dev = createPermissionPolicy({ isDev: true });
const packaged = createPermissionPolicy({ isDev: false, packagedUrl: PACKAGED });

const checkAudio = (url, over = {}) => ({ requestingUrl: url, isMainFrame: true, mediaType: "audio", ...over });
const requestAudio = (url, over = {}) => ({ requestingUrl: url, isMainFrame: true, mediaTypes: ["audio"], ...over });

describe("microphone: development origin", () => {
  it("allows audio-only check and request from the exact dev origin", () => {
    expect(dev.check("media", checkAudio(DEV + "/"))).toBe(true);
    expect(dev.request("media", requestAudio(DEV + "/#/x?y=1"))).toBe(true);
  });

  it.each([
    ["other port", "http://localhost:5174/"],
    ["other host", "http://127.0.0.1:5173/"],
    ["https lookalike", "https://localhost:5173/"],
    ["suffix lookalike", "http://localhost:5173.evil.test/"],
    ["file page", "file:///C:/x/index.html"],
    ["youtube", YT],
  ])("denies the microphone from %s", (_n, url) => {
    expect(dev.check("media", checkAudio(url))).toBe(false);
    expect(dev.request("media", requestAudio(url))).toBe(false);
  });
});

describe("microphone: packaged file origin", () => {
  it("allows only the exact dist/index.html page (query and hash ignored)", () => {
    expect(packaged.check("media", checkAudio(PACKAGED))).toBe(true);
    expect(packaged.request("media", requestAudio(PACKAGED + "?a=1#b"))).toBe(true);
  });

  it("is not fooled by the casing of a Windows path", () => {
    expect(packaged.request("media", requestAudio(PACKAGED.replace("file:///C:", "file:///c:")))).toBe(true);
  });

  it.each([
    ["another local file", "file:///C:/Users/me/evil.html"],
    ["a sibling of index.html", PACKAGED.replace("index.html", "other.html")],
    ["the dev origin", DEV + "/"],
    ["file scheme with no path", "file:///"],
    ["garbage", "not a url"],
    ["empty", ""],
    ["missing", undefined],
  ])("denies the microphone from %s", (_n, url) => {
    expect(packaged.check("media", checkAudio(url))).toBe(false);
    expect(packaged.request("media", requestAudio(url))).toBe(false);
  });

  it("denies everything when no packaged URL is known (fails closed)", () => {
    const broken = createPermissionPolicy({ isDev: false });
    expect(broken.request("media", requestAudio(PACKAGED))).toBe(false);
  });
});

describe("microphone: what is requested and from which frame", () => {
  it("denies subframes, even on the trusted URL", () => {
    expect(dev.check("media", checkAudio(DEV + "/", { isMainFrame: false }))).toBe(false);
    expect(dev.request("media", requestAudio(DEV + "/", { isMainFrame: false }))).toBe(false);
    expect(dev.request("media", requestAudio(YT, { isMainFrame: false }))).toBe(false);
  });

  it("denies when the main-frame flag is missing", () => {
    expect(dev.request("media", { requestingUrl: DEV + "/", mediaTypes: ["audio"] })).toBe(false);
  });

  it.each([
    ["video only", ["video"]],
    ["audio and video", ["audio", "video"]],
    ["video then audio", ["video", "audio"]],
    ["empty", []],
    ["missing", undefined],
  ])("denies a request for %s", (_n, mediaTypes) => {
    expect(dev.request("media", requestAudio(DEV + "/", { mediaTypes }))).toBe(false);
  });

  it.each([["video"], ["unknown"], [undefined]])("denies a check for mediaType %s", (mediaType) => {
    expect(dev.check("media", checkAudio(DEV + "/", { mediaType }))).toBe(false);
  });

  it("denies when details are missing or malformed", () => {
    for (const bad of [undefined, null, "x", 5]) {
      expect(dev.check("media", bad)).toBe(false);
      expect(dev.request("media", bad)).toBe(false);
    }
  });
});

describe("other permissions", () => {
  const main = { requestingUrl: DEV + "/", isMainFrame: true };
  it.each([
    "display-capture", "geolocation", "notifications", "clipboard-read", "clipboard-sanitized-write",
    "midi", "midiSysex", "hid", "serial", "openExternal", "pointerLock", "keyboardLock",
    "storage-access", "idle-detection", "fileSystem", "window-management", "unknown", "mediaKeySystem",
  ])("denies %s", (permission) => {
    expect(dev.check(permission, main)).toBe(false);
    expect(dev.request(permission, main)).toBe(false);
  });

  it("allows fullscreen for the app and for YouTube embeds, nothing else", () => {
    expect(dev.request("fullscreen", main)).toBe(true);
    expect(dev.request("fullscreen", { requestingUrl: YT, isMainFrame: false })).toBe(true);
    expect(dev.request("fullscreen", { requestingUrl: "https://www.youtube-nocookie.com/embed/a", isMainFrame: false })).toBe(true);
    expect(dev.request("fullscreen", { requestingUrl: "https://evil.test/", isMainFrame: false })).toBe(false);
    expect(dev.request("fullscreen", { requestingUrl: "https://www.youtube.com.evil.test/", isMainFrame: false })).toBe(false);
    expect(dev.request("fullscreen", { requestingUrl: "https://evil.test/", isMainFrame: true })).toBe(false);
    expect(packaged.request("fullscreen", { requestingUrl: PACKAGED, isMainFrame: true })).toBe(true);
  });
});

describe("persistent-storage (navigator.storage.persist)", () => {
  const ask = (url, over = {}) => ({ requestingUrl: url, isMainFrame: true, ...over });

  it("is allowed for the app main frame, for both check and request", () => {
    expect(dev.check("persistent-storage", ask(DEV + "/"))).toBe(true);
    expect(dev.request("persistent-storage", ask(DEV + "/?x=1#y"))).toBe(true);
    expect(packaged.check("persistent-storage", ask(PACKAGED))).toBe(true);
    expect(packaged.request("persistent-storage", ask(PACKAGED))).toBe(true);
  });

  it("is denied from any subframe, even on the app URL and from YouTube", () => {
    for (const url of [DEV + "/", YT]) {
      expect(dev.check("persistent-storage", ask(url, { isMainFrame: false }))).toBe(false);
      expect(dev.request("persistent-storage", ask(url, { isMainFrame: false }))).toBe(false);
    }
    expect(packaged.request("persistent-storage", ask(PACKAGED, { isMainFrame: false }))).toBe(false);
  });

  it("is denied when the main-frame flag is missing", () => {
    expect(dev.request("persistent-storage", { requestingUrl: DEV + "/" })).toBe(false);
  });

  it.each([
    ["another port", "http://localhost:5174/"],
    ["another host", "http://127.0.0.1:5173/"],
    ["youtube as a top-level page", YT],
    ["a lookalike", "http://localhost:5173.evil.test/"],
    ["garbage", "not a url"],
    ["nothing", undefined],
  ])("is denied from %s", (_n, url) => {
    expect(dev.check("persistent-storage", ask(url))).toBe(false);
    expect(dev.request("persistent-storage", ask(url))).toBe(false);
  });

  it("is denied for a different local file in the packaged app, and fails closed with no packaged URL", () => {
    expect(packaged.request("persistent-storage", ask("file:///C:/Users/me/evil.html"))).toBe(false);
    expect(createPermissionPolicy({ isDev: false }).request("persistent-storage", ask(PACKAGED))).toBe(false);
  });

  it("does not widen anything else: look-alike permission names stay denied", () => {
    for (const name of ["persistent-storage ", "Persistent-Storage", "storage-access", "top-level-storage-access", "durable-storage"]) {
      expect(dev.request(name, ask(DEV + "/"))).toBe(false);
    }
  });
});

describe("installPermissionPolicy", () => {
  function fakeSession() {
    const s = {};
    s.setPermissionCheckHandler = (h) => { s.check = h; };
    s.setPermissionRequestHandler = (h) => { s.request = h; };
    return s;
  }

  it("registers BOTH handlers and answers consistently", () => {
    const s = fakeSession();
    installPermissionPolicy(s, dev);
    expect(typeof s.check).toBe("function");
    expect(typeof s.request).toBe("function");

    expect(s.check(null, "media", DEV, checkAudio(DEV + "/"))).toBe(true);
    const cb = vi.fn();
    s.request(null, "media", cb, requestAudio(DEV + "/"));
    expect(cb).toHaveBeenCalledWith(true);
  });

  it("reports each denial and answers false", () => {
    const s = fakeSession();
    const onDeny = vi.fn();
    installPermissionPolicy(s, dev, onDeny);

    expect(s.check(null, "geolocation", DEV, { requestingUrl: DEV + "/", isMainFrame: true })).toBe(false);
    const cb = vi.fn();
    s.request(null, "media", cb, requestAudio(YT, { isMainFrame: false, mediaTypes: ["audio", "video"] }));
    expect(cb).toHaveBeenCalledWith(false);
    expect(onDeny).toHaveBeenCalledTimes(2);
    expect(onDeny.mock.calls[0][0]).toBe("check");
    expect(onDeny.mock.calls[1][0]).toBe("request");
  });
});
