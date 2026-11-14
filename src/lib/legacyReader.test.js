// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url);
const { installLegacyReader } = require("../../electron/legacyReader.cjs");

it("only exposes read-only legacy storage to the trusted main frame at the original file URL", async () => {
  const appDirectory = path.resolve(import.meta.dirname, "../..");
  let handler;
  let fileHandler;
  let loaded;
  const execute = vi.fn(async () => []);
  class Utility {
    webContents = { executeJavaScript: execute };
    loadURL = vi.fn(async (url) => { loaded = url; });
    isDestroyed = () => false;
    destroy = vi.fn();
  }
  const mainFrame = { url: "http://127.0.0.1:5174/index.html" };
  const window = { webContents: { mainFrame, session: { protocol: {
    handle: (_scheme, callback) => { fileHandler = callback; }, unhandle: vi.fn(),
  } } }, on: vi.fn() };
  installLegacyReader({ BrowserWindow: Utility, ipcMain: { handle: (_name, callback) => { handler = callback; }, removeHandler: vi.fn() }, window, appDirectory });
  await expect(handler({ sender: {}, senderFrame: mainFrame }, "list")).rejects.toThrow("main window");
  await expect(handler({ sender: window.webContents, senderFrame: { url: mainFrame.url } }, "list")).rejects.toThrow("main window");
  await handler({ sender: window.webContents, senderFrame: mainFrame }, "list");
  expect(loaded).toBe(pathToFileURL(path.join(appDirectory, "dist/index.html")).href);
  expect(execute).toHaveBeenCalledWith("window.readLegacyMetadata()");
  const page = fileHandler({ url: loaded });
  expect(page.headers.get("content-security-policy")).toContain("connect-src 'none'");
  expect(fileHandler({ url: "file:///unrelated.html" }).status).toBe(404);
  await expect(handler({ sender: window.webContents, senderFrame: mainFrame }, "delete", "id")).rejects.toThrow("Unknown");
});
