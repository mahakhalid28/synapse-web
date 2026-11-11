// Ordering, paging and spoken wording for lecture search results.
//
// YouTube returns many results in its own relevance order. A screen-reader
// user has to hear them one at a time, so we (1) put short, focused lectures
// first, (2) prefer configured channels such as Khan Academy WITHOUT hiding
// anything else, and (3) show a small page at a time.
//
// Nothing here removes a result: ranking only reorders, and it is stable, so
// within a group YouTube's own relevance order is kept.

export const RESULTS_PER_PAGE = 6;

/** Lectures up to this length are listed before longer ones. */
export const PREFERRED_MAX_SECONDS = 30 * 60;

/**
 * Channels to list first, from `VITE_PREFERRED_CHANNELS` (comma-separated,
 * baked in at build time). Unset → Khan Academy. Set it to an empty list
 * (e.g. a single space or ",") to turn channel preference off.
 */
export function parsePreferredChannels(value) {
  if (value === undefined || value === null) return ["Khan Academy"];
  return String(value)
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

export const PREFERRED_CHANNELS = parsePreferredChannels(import.meta.env?.VITE_PREFERRED_CHANNELS);

function channelOf(result) {
  return String(result?.channel || result?.channel_name || "").toLowerCase();
}

function secondsOf(result) {
  const s = result?.durationSeconds ?? result?.duration_seconds;
  return typeof s === "number" && s > 0 ? s : 0; // 0 = unknown
}

/**
 * Order: [short (≤ 30 min), unknown length, longer] and, inside each, preferred
 * channels first. Stable, non-destructive.
 */
export function rankResults(
  results,
  { preferredChannels = PREFERRED_CHANNELS, maxSeconds = PREFERRED_MAX_SECONDS } = {},
) {
  if (!Array.isArray(results)) return [];
  const wanted = preferredChannels.map((name) => name.toLowerCase());

  const score = (result) => {
    const seconds = secondsOf(result);
    const lengthTier = seconds === 0 ? 1 : seconds <= maxSeconds ? 2 : 0;
    const channel = channelOf(result);
    const preferred = wanted.some((name) => channel.includes(name)) ? 1 : 0;
    return lengthTier * 2 + preferred;
  };

  return results
    .map((result, index) => ({ result, index, score: score(result) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.result);
}

/** Number of pages for `total` results (at least 1). */
export function pageCount(total, perPage = RESULTS_PER_PAGE) {
  return Math.max(1, Math.ceil(total / perPage));
}

/** 1-based inclusive range shown on a page, e.g. { from: 7, to: 12 }. */
export function pageRange(page, total, perPage = RESULTS_PER_PAGE) {
  if (total === 0) return { from: 0, to: 0 };
  const from = (page - 1) * perPage + 1;
  return { from, to: Math.min(page * perPage, total) };
}

/** "Showing results 7 to 12 of 20." — also used as the live announcement. */
export function pageSummary(page, total, perPage = RESULTS_PER_PAGE) {
  const { from, to } = pageRange(page, total, perPage);
  if (total === 0) return "No results.";
  if (from === to) return `Showing result ${from} of ${total}.`;
  return `Showing results ${from} to ${to} of ${total}.`;
}

/** 750 → "12 minutes 30 seconds". Spoken form; "12:30" can be read as a clock time. */
export function spokenDuration(seconds, fallback = "") {
  if (typeof seconds !== "number" || isNaN(seconds) || seconds <= 0) return fallback;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const part = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  const parts = [];
  if (h) parts.push(part(h, "hour"));
  if (m) parts.push(part(m, "minute"));
  if (s && !h) parts.push(part(s, "second"));
  return parts.join(" ") || part(total, "second");
}

/**
 * Accessible name for a result button. Starts with the action so the button's
 * purpose is heard first, then what it is, how long it is, and where it sits.
 */
export function resultAriaLabel(result, position, total) {
  const channel = result?.channel || result?.channel_name || "";
  const length = spokenDuration(secondsOf(result), result?.duration || "");
  const details = [result?.title, channel, length].filter(Boolean).join(", ");
  const place = position && total ? ` Result ${position} of ${total}.` : "";
  return `Start learning: ${details}.${place}`;
}
