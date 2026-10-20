// TEMPORARY Phase 0 spike. Not part of the app. Delete the spike/ folder when done.
//
// Isolated Electron entry for testing microphone recording. It mirrors the
// relevant webPreferences of the real electron.cjs exactly
// ({ contextIsolation: true, webSecurity: false }) and adds NO privileges:
// no preload, no nodeIntegration, no IPC, no devtools auto-open.
//
// Usage:
//   npx electron spike/mic-spike-main.cjs --origin=dev|file --policy=default|allow-audio|deny
//
//   --origin=dev   loads http://localhost:5173/spike/mic-spike.html (needs `npm run dev`)
//   --origin=file  loads the local file spike/mic-spike.html over file://
//
//   --policy=default      installs NO permission handlers (records Electron's own default)
//   --policy=allow-audio  allows ONLY the audio-only "media" permission from the two
//                         expected origins; every other permission is denied
//   --policy=deny         denies every permission request and check
//
// A denial is never bypassed: the handlers only ever return false for anything
// that is not explicitly allowed by the chosen policy.

const { app, BrowserWindow, session } = require("electron");
const path = require("path");

const DEV_URL = "http://localhost:5173/spike/mic-spike.html";
const DEV_ORIGIN = "http://localhost:5173";

function arg(name, allowed, fallback) {
  const hit = process.argv.find((a) => a.startsWith("--" + name + "="));
  const value = hit ? hit.slice(name.length + 3) : fallback;
  if (!allowed.includes(value)) {
    console.error(`[spike] invalid --${name}=${value}. Allowed: ${allowed.join(", ")}`);
    app.exit(2);
  }
  return value;
}

const origin = arg("origin", ["dev", "file"], "file");
const policy = arg("policy", ["default", "allow-audio", "deny"], "default");

function originIsExpected(url) {
  if (!url) return false;
  if (url.startsWith("file:")) return true;
  return url === DEV_ORIGIN || url.startsWith(DEV_ORIGIN + "/");
}

function log(kind, permission, detail, decision) {
  console.log(`[spike] ${kind} permission=${permission} ${JSON.stringify(detail)} -> ${decision ? "ALLOW" : "DENY"}`);
}

function installPolicy(ses) {
  if (policy === "default") {
    console.log("[spike] policy=default: no permission handlers installed");
    return;
  }

  // Both handlers are required: the request handler answers prompts, the check
  // handler answers synchronous queries (e.g. enumerateDevices labels, permissions.query).
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    let allow = false;
    if (policy === "allow-audio") {
      allow =
        permission === "media" &&
        details && details.mediaType === "audio" &&
        originIsExpected(requestingOrigin || details.requestingUrl);
    }
    log("check", permission, { requestingOrigin, mediaType: details && details.mediaType }, allow);
    return allow;
  });

  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    let allow = false;
    if (policy === "allow-audio") {
      const types = (details && details.mediaTypes) || [];
      allow =
        permission === "media" &&
        types.length === 1 && types[0] === "audio" &&
        originIsExpected(details.requestingUrl);
    }
    log("request", permission, { requestingUrl: details && details.requestingUrl, mediaTypes: details && details.mediaTypes }, allow);
    callback(allow);
  });

  console.log(`[spike] policy=${policy}: permission handlers installed`);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 900,
    backgroundColor: "#F7F4EC",
    title: `Mic spike (origin=${origin}, policy=${policy})`,
    // Identical to the relevant settings in the app's electron.cjs. Nothing added.
    webPreferences: { contextIsolation: true, webSecurity: false },
  });

  installPolicy(win.webContents.session);

  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error(`[spike] load failed: ${code} ${desc} ${url}`);
    if (origin === "dev") {
      console.error("[spike] Is `npm run dev` running in another terminal (http://localhost:5173)?");
    }
  });
  win.webContents.on("console-message", (_e, _level, message) => {
    console.log("[page] " + message);
  });

  const query = { origin, policy };
  if (origin === "dev") {
    win.loadURL(`${DEV_URL}?origin=${origin}&policy=${policy}`);
  } else {
    win.loadFile(path.join(__dirname, "mic-spike.html"), { query });
  }
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
