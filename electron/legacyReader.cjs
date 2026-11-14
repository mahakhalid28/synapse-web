const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { PACKAGED_ORIGIN } = require("./localFrontend.cjs");

function installLegacyReader({ BrowserWindow, ipcMain, window, appDirectory }) {
  const originalUrl = pathToFileURL(path.join(appDirectory, "dist", "index.html")).href;
  const readerSource = fs.readFileSync(path.join(__dirname, "legacyStorage.js"), "utf8");
  const session = window.webContents.session;
  // Preserve the EXACT previous page URL and session storage key. The file
  // response is a constant read-only helper, never the current app bundle.
  session.protocol.handle("file", (request) => {
    if (request.url !== originalUrl) return new Response("Not found", { status: 404 });
    return new Response(`<!doctype html><title>Previous Synapse storage reader</title><script>${readerSource}</script>`, {
      headers: { "Content-Type": "text/html", "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'" },
    });
  });
  let reader;
  let ready;
  const getReader = () => {
    if (!ready) {
      reader = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
      ready = reader.loadURL(originalUrl).then(() => reader).catch((error) => {
        if (reader && !reader.isDestroyed()) reader.destroy();
        ready = null;
        throw error;
      });
    }
    return ready;
  };
  ipcMain.handle("synapse:legacy-storage", async (event, operation, id) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame ||
        new URL(event.senderFrame.url).origin !== PACKAGED_ORIGIN) {
      throw new Error("Previous storage can only be read by the Synapse main window.");
    }
    const utility = await getReader();
    if (operation === "list") return utility.webContents.executeJavaScript("window.readLegacyMetadata()");
    if (operation === "audio" && typeof id === "string" && id.length <= 128) {
      return utility.webContents.executeJavaScript(`window.readLegacyAudio(${JSON.stringify(id)})`);
    }
    throw new Error("Unknown previous-storage operation.");
  });
  window.on("closed", () => {
    ipcMain.removeHandler("synapse:legacy-storage");
    session.protocol.unhandle("file");
    if (reader && !reader.isDestroyed()) reader.destroy();
  });
}

module.exports = { installLegacyReader };
