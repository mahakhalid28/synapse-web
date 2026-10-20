// YouTube refuses to embed its player on a page that sends no web Referer: the
// player shows "Error 153 - Video player configuration error". A packaged app is
// loaded from file://, which sends none, so the lecture video would not play.
//
// This gives ONLY the player's own frame request an app-identifying Referer, and
// only when that request has none. Everything else (the YouTube scripts, the
// player's internal requests, other sites) is left exactly as it was.
//
// ".invalid" is a reserved top-level domain (RFC 2606): it can never be a real
// website, so this never claims to be anyone else's site.

const EMBED_REFERER = "https://synapse.invalid/";
const YOUTUBE_URLS = ["https://www.youtube.com/*", "https://www.youtube-nocookie.com/*"];

/** Returns the headers to send: the original ones, plus a Referer for a Referer-less player frame. */
function withEmbedReferer(details) {
  const headers = { ...details.requestHeaders };
  const hasReferer = Object.keys(headers).some((name) => name.toLowerCase() === "referer");
  if (details.resourceType === "subFrame" && !hasReferer) headers.Referer = EMBED_REFERER;
  return headers;
}

function installYouTubeEmbedReferer(session) {
  session.webRequest.onBeforeSendHeaders({ urls: YOUTUBE_URLS }, (details, callback) => {
    callback({ requestHeaders: withEmbedReferer(details) });
  });
}

module.exports = { EMBED_REFERER, YOUTUBE_URLS, withEmbedReferer, installYouTubeEmbedReferer };
