import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

// The module lives in electron/ (main-process, CommonJS); load it the way Node would.
const require = createRequire(import.meta.url);
const { EMBED_REFERER, YOUTUBE_URLS, withEmbedReferer, installYouTubeEmbedReferer } = require("../../electron/youtubeReferer.cjs");

const frame = (headers, resourceType = "subFrame") => ({
  url: "https://www.youtube.com/embed/5ugDJhmmkFM?rel=0&enablejsapi=1",
  resourceType,
  requestHeaders: headers,
});

describe("withEmbedReferer: the one case it changes", () => {
  it("adds the app Referer to the player's frame request when it has none", () => {
    const headers = withEmbedReferer(frame({ "User-Agent": "x", Accept: "text/html" }));
    expect(headers.Referer).toBe(EMBED_REFERER);
  });

  it("keeps every other header exactly as it was", () => {
    const original = { "User-Agent": "ua", Accept: "text/html", "Accept-Language": "en", Cookie: "a=b" };
    const headers = withEmbedReferer(frame(original));
    const { Referer, ...rest } = headers;
    expect(Referer).toBe(EMBED_REFERER);
    expect(rest).toEqual(original);
  });

  it("works when there are no headers at all", () => {
    expect(withEmbedReferer({ url: "https://www.youtube.com/embed/x", resourceType: "subFrame" })).toEqual({ Referer: EMBED_REFERER });
    expect(withEmbedReferer(frame({}))).toEqual({ Referer: EMBED_REFERER });
  });
});

describe("withEmbedReferer: everything it must NOT change", () => {
  it.each(["Referer", "referer", "REFERER", "rEfErEr"])("never overwrites an existing Referer (%s)", (name) => {
    const original = { [name]: "https://www.youtube.com/embed/5ugDJhmmkFM", "User-Agent": "ua" };
    const headers = withEmbedReferer(frame(original));
    expect(headers).toEqual(original);
    expect(Object.keys(headers).filter((k) => k.toLowerCase() === "referer")).toHaveLength(1);
  });

  it("does not replace even an empty-string Referer header that is present", () => {
    expect(withEmbedReferer(frame({ Referer: "" })).Referer).toBe("");
  });

  it.each([
    "mainFrame", "script", "xhr", "image", "stylesheet", "media", "font", "ping", "cspReport", "webSocket", "object", "other",
  ])("leaves a %s request alone", (type) => {
    const original = { "User-Agent": "ua" };
    expect(withEmbedReferer(frame(original, type))).toEqual(original);
  });

  it("does not treat a missing resource type as a frame", () => {
    expect(withEmbedReferer({ requestHeaders: { A: "1" } })).toEqual({ A: "1" });
  });

  it("never mutates the object it was given", () => {
    const original = Object.freeze({ "User-Agent": "ua" });
    const details = Object.freeze({ url: "https://www.youtube.com/embed/x", resourceType: "subFrame", requestHeaders: original });
    const headers = withEmbedReferer(details);
    expect(headers).not.toBe(original);
    expect(original).toEqual({ "User-Agent": "ua" });
  });
});

describe("the Referer value", () => {
  it("is an https URL on the reserved .invalid domain, so it can never be a real website", () => {
    const url = new URL(EMBED_REFERER);
    expect(url.protocol).toBe("https:");
    expect(url.hostname.endsWith(".invalid")).toBe(true);
  });
});

describe("which requests the hook can even see", () => {
  it("is limited to the two YouTube player hosts over https", () => {
    expect(YOUTUBE_URLS).toEqual(["https://www.youtube.com/*", "https://www.youtube-nocookie.com/*"]);
    for (const pattern of YOUTUBE_URLS) {
      expect(pattern.startsWith("https://")).toBe(true);
      expect(pattern).not.toMatch(/\*\.|<all_urls>|\/\/\*/); // no wildcard hosts
    }
  });
});

describe("installYouTubeEmbedReferer", () => {
  function fakeSession() {
    const s = { calls: [] };
    s.webRequest = { onBeforeSendHeaders: vi.fn((filter, handler) => { s.calls.push({ filter, handler }); }) };
    return s;
  }

  it("registers exactly one handler, filtered to the YouTube hosts", () => {
    const session = fakeSession();
    installYouTubeEmbedReferer(session);
    expect(session.webRequest.onBeforeSendHeaders).toHaveBeenCalledTimes(1);
    expect(session.calls[0].filter).toEqual({ urls: YOUTUBE_URLS });
  });

  it("the handler answers Electron's callback with the right headers", () => {
    const session = fakeSession();
    installYouTubeEmbedReferer(session);
    const callback = vi.fn();
    session.calls[0].handler(frame({ "User-Agent": "ua" }), callback);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ requestHeaders: { "User-Agent": "ua", Referer: EMBED_REFERER } });
  });

  it("the handler lets other requests through unchanged and still calls back (so nothing hangs)", () => {
    const session = fakeSession();
    installYouTubeEmbedReferer(session);
    const callback = vi.fn();
    session.calls[0].handler(frame({ "User-Agent": "ua" }, "script"), callback);
    expect(callback).toHaveBeenCalledWith({ requestHeaders: { "User-Agent": "ua" } });
  });

  it("the handler keeps an existing Referer", () => {
    const session = fakeSession();
    installYouTubeEmbedReferer(session);
    const callback = vi.fn();
    session.calls[0].handler(frame({ Referer: "https://www.youtube.com/" }), callback);
    expect(callback).toHaveBeenCalledWith({ requestHeaders: { Referer: "https://www.youtube.com/" } });
  });
});

// A structural check on electron.cjs itself (it cannot be loaded here without Electron):
// the hook must be installed ONLY in the packaged branch, before the page is loaded.
describe("electron.cjs wiring", () => {
  const source = readFileSync(require.resolve("../../electron.cjs"), "utf8").replace(/\r\n/g, "\n");

  it("installs the Referer hook exactly once", () => {
    expect(source.match(/installYouTubeEmbedReferer\(/g)).toHaveLength(1);
  });

  it("installs it only in the packaged (else) branch, not for the dev server", () => {
    const devBranch = source.slice(source.indexOf("if (isDev) {"), source.indexOf("} else {"));
    const packagedBranch = source.slice(source.indexOf("} else {"));
    expect(devBranch).toContain("loadURL");
    expect(devBranch).not.toContain("installYouTubeEmbedReferer");
    expect(packagedBranch).toContain("installYouTubeEmbedReferer(win.webContents.session)");
  });

  it("installs it before the packaged page is loaded", () => {
    expect(source.indexOf("installYouTubeEmbedReferer(win")).toBeLessThan(source.indexOf("win.loadFile("));
  });

  it("leaves the security settings and the permission policy wiring as they were", () => {
    expect(source).toContain("contextIsolation: true");
    expect(source).toContain("webSecurity: false"); // unchanged by this fix (still needed for file:// module scripts)
    expect(source).not.toContain("preload");
    expect(source).toContain("installPermissionPolicy(win.webContents.session, permissionPolicy");
  });
});
