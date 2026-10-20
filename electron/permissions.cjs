// Permission policy for the Synapse Electron window. Pure functions only (no
// Electron imports) so it can be unit tested; electron.cjs wires it to the
// session. Everything not explicitly allowed here is denied, and malformed
// input is denied too.
//
// Allowed:
//   - microphone: "media" with audio ONLY (no video / screen capture), from the
//     main frame of the Synapse app page itself. Never from a subframe.
//   - fullscreen: from the Synapse main frame and from YouTube embed frames,
//     because the lecture player's fullscreen button needs it.
//   - persistent-storage: from the Synapse main frame ONLY (never a subframe),
//     so navigator.storage.persist() can protect saved voice notes from
//     eviction. Electron reports it under this name (seen at runtime; it is
//     not in electron.d.ts's permission list).
// Everything else (camera, display-capture, geolocation, notifications,
// clipboard, midi, hid, ...) is denied.

const { pathToFileURL } = require("node:url");

const DEV_ORIGIN = "http://localhost:5173";
const YOUTUBE_ORIGINS = ["https://www.youtube.com", "https://www.youtube-nocookie.com"];

// Reduce a URL to what identifies the page: query string and hash are dropped.
// Returns null for anything unparsable so callers fail closed.
function pageKey(url) {
  if (typeof url !== "string" || url === "") return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol === "file:") return "file:" + u.pathname.toLowerCase(); // Windows paths are case-insensitive
  return u.origin + u.pathname;
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// The one packaged page we trust: <app>/dist/index.html (the same file
// electron.cjs passes to loadFile), expressed as a file URL.
function packagedPageUrl(appDir, path) {
  return pathToFileURL(path.join(appDir, "dist", "index.html")).href;
}

/**
 * @param {{ isDev: boolean, packagedUrl?: string, devOrigin?: string }} options
 */
function createPermissionPolicy({ isDev, packagedUrl, devOrigin = DEV_ORIGIN }) {
  const trustedPackagedKey = pageKey(packagedUrl);

  // Is this URL the Synapse app page (and not some other page or frame)?
  function isAppPage(url) {
    if (isDev) return originOf(url) === devOrigin; // exactly http://localhost:5173
    return trustedPackagedKey !== null && pageKey(url) === trustedPackagedKey;
  }

  function isYouTube(url) {
    return YOUTUBE_ORIGINS.includes(originOf(url));
  }

  // kind: "check" (details.mediaType) or "request" (details.mediaTypes).
  function decide(kind, permission, details) {
    if (!details || typeof details !== "object") return false;
    const url = details.requestingUrl;

    if (permission === "media") {
      if (details.isMainFrame !== true) return false; // never from a subframe (YouTube etc.)
      if (!isAppPage(url)) return false;
      if (kind === "check") return details.mediaType === "audio";
      const types = details.mediaTypes;
      return Array.isArray(types) && types.length === 1 && types[0] === "audio";
    }

    if (permission === "persistent-storage") {
      return details.isMainFrame === true && isAppPage(url);
    }

    if (permission === "fullscreen") {
      if (details.isMainFrame === true) return isAppPage(url);
      return isYouTube(url);
    }

    return false;
  }

  return {
    // setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => ...)
    check: (permission, details) => decide("check", permission, details),
    // setPermissionRequestHandler((webContents, permission, callback, details) => ...)
    request: (permission, details) => decide("request", permission, details),
  };
}

// Wires both handlers onto a session. onDeny is called for every denial so the
// caller can log it (this is how an unexpectedly blocked permission is spotted).
function installPermissionPolicy(session, policy, onDeny = () => {}) {
  session.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    const allowed = policy.check(permission, details);
    if (!allowed) onDeny("check", permission, requestingOrigin, details);
    return allowed;
  });
  session.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const allowed = policy.request(permission, details);
    if (!allowed) onDeny("request", permission, details && details.requestingUrl, details);
    callback(allowed);
  });
}

module.exports = { createPermissionPolicy, installPermissionPolicy, packagedPageUrl, pageKey, DEV_ORIGIN };
