const { app, BrowserWindow } = require("electron");
const path = require("path");
const {
  createPermissionPolicy,
  installPermissionPolicy,
  packagedPageUrl,
} = require("./electron/permissions.cjs");
const { installYouTubeEmbedReferer } = require("./electron/youtubeReferer.cjs");

const isDev = !app.isPackaged;

// Deny-by-default permissions: only audio-only microphone capture from the
// Synapse main frame (and fullscreen for the YouTube player) is allowed.
// See electron/permissions.cjs. Denials are logged so a blocked permission
// that the app genuinely needs shows up in the terminal.
const permissionPolicy = createPermissionPolicy({
  isDev,
  packagedUrl: packagedPageUrl(__dirname, path),
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
      webSecurity: false,
    },
  });

  installPermissionPolicy(win.webContents.session, permissionPolicy, (kind, permission, origin) => {
    console.warn(`[permissions] denied ${kind}: ${permission} from ${origin || "(unknown)"}`);
  });

  if (isDev) {
    win.loadURL("http://localhost:5173");
  } else {
    // The packaged app is a file:// page, which sends no Referer; without one
    // YouTube refuses to play the embedded lecture (Error 153). See youtubeReferer.cjs.
    installYouTubeEmbedReferer(win.webContents.session);
    win.loadFile(path.join(__dirname, "dist", "index.html"));
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
