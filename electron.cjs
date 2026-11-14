const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const {
  createPermissionPolicy,
  installPermissionPolicy,
} = require("./electron/permissions.cjs");
const { installYouTubeEmbedReferer } = require("./electron/youtubeReferer.cjs");
const { PACKAGED_ORIGIN, startLocalFrontend } = require("./electron/localFrontend.cjs");
const { installLegacyReader } = require("./electron/legacyReader.cjs");

const isDev = !app.isPackaged;

// Deny-by-default permissions: only audio-only microphone capture from the
// Synapse main frame (and fullscreen for the YouTube player) is allowed.
// See electron/permissions.cjs. Denials are logged so a blocked permission
// that the app genuinely needs shows up in the terminal.
const permissionPolicy = createPermissionPolicy({
  isDev,
  packagedUrl: `${PACKAGED_ORIGIN}/index.html`,
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#F7F4EC",
    webPreferences: {
      contextIsolation: true,
      webSecurity: true,
      ...(isDev ? {} : { preload: path.join(__dirname, "electron", "legacyBridge.cjs") }),
    },
  });

  installPermissionPolicy(win.webContents.session, permissionPolicy, (kind, permission, origin) => {
    console.warn(`[permissions] denied ${kind}: ${permission} from ${origin || "(unknown)"}`);
  });

  if (isDev) {
    win.loadURL("http://localhost:5173");
  } else {
    installLegacyReader({ BrowserWindow, ipcMain, window: win, appDirectory: __dirname });
    // The packaged app is a file:// page, which sends no Referer; without one
    // YouTube refuses to play the embedded lecture (Error 153). See youtubeReferer.cjs.
    installYouTubeEmbedReferer(win.webContents.session);
    win.loadURL(`${PACKAGED_ORIGIN}/index.html`);
  }
}

let frontendServer = null;
app.whenReady().then(async () => {
  if (!isDev) frontendServer = await startLocalFrontend(path.join(__dirname, "dist"));
  createWindow();
}).catch((error) => { console.error("Synapse could not start its trusted frontend:", error); app.quit(); });
app.on("will-quit", () => frontendServer?.close());

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
