import { API_MOCK_MODE, apiUrl } from "./apiConfig.js";

/**
 * Format duration in seconds to MM:SS or H:MM:SS string.
 */
export function formatDuration(seconds) {
  if (typeof seconds !== "number" || isNaN(seconds) || seconds < 0) return "0:00";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Normalizes a raw video search item from either real backend or mock into
 * a consistent object providing both camelCase and snake_case properties.
 */
export function normalizeSearchResult(item) {
  if (!item || typeof item !== "object") return null;

  const videoId =
    item.videoId ||
    item.video_id ||
    extractYouTubeId(item.canonical_url || item.canonicalUrl || item.url) ||
    "";

  const rawSeconds = item.duration_seconds ?? item.durationSeconds;
  const durationSeconds = typeof rawSeconds === "number" && !isNaN(rawSeconds) ? rawSeconds : 0;
  const duration =
    item.duration ||
    item.duration_formatted ||
    formatDuration(durationSeconds);

  const channel = item.channel || item.channel_name || "";
  const title = item.title || "";
  const thumbnailUrl =
    item.thumbnailUrl ||
    item.thumbnail_url ||
    (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null);

  const canonicalUrl =
    item.canonicalUrl ||
    item.canonical_url ||
    (videoId ? `https://www.youtube.com/watch?v=${videoId}` : "");

  return {
    videoId,
    video_id: videoId,
    title,
    channel,
    channel_name: channel,
    duration,
    duration_formatted: duration,
    durationSeconds,
    duration_seconds: durationSeconds,
    thumbnailUrl,
    thumbnail_url: thumbnailUrl,
    canonicalUrl,
    canonical_url: canonicalUrl,
  };
}

/**
 * Search YouTube lectures.
 * In mock mode (VITE_API_MOCK_MODE=true), returns canned mock data.
 * In real mode, queries GET /video/search?q=... on the backend.
 */
export async function searchVideos(query, { signal } = {}) {
  const cleanQuery = typeof query === "string" ? query.trim() : "";
  if (!cleanQuery) return [];

  if (API_MOCK_MODE) {
    await new Promise((r) => setTimeout(r, 100));
    return [
      normalizeSearchResult({
        video_id: "NFZtjSeT3XE",
        title: `${cleanQuery} — full lecture`,
        channel_name: "MIT OpenCourseWare",
        duration_seconds: 1450,
        thumbnail_url: "https://i.ytimg.com/vi/NFZtjSeT3XE/hqdefault.jpg",
        canonical_url: "https://www.youtube.com/watch?v=NFZtjSeT3XE",
      }),
      normalizeSearchResult({
        video_id: "dQw4w9WgXcQ",
        title: `Understanding ${cleanQuery}`,
        channel_name: "Professor Dave Explains",
        duration_seconds: 567,
        thumbnail_url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
        canonical_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      }),
    ].filter(Boolean);
  }

  const endpoint = apiUrl(`/video/search?q=${encodeURIComponent(cleanQuery)}`);
  const response = await fetch(endpoint, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) {
    let detail = "";
    try {
      const errJson = await response.json();
      detail = errJson?.detail;
    } catch {
      // ignore JSON parse error
    }

    if (response.status === 503) {
      throw new Error(detail || "YouTube search is currently unavailable.");
    }
    if (response.status === 429) {
      throw new Error(detail || "YouTube search rate limit or quota exceeded.");
    }
    if (response.status === 504) {
      throw new Error(detail || "YouTube search request timed out.");
    }
    throw new Error(detail || `Search failed with status ${response.status}.`);
  }

  const rawData = await response.json();
  if (!Array.isArray(rawData)) {
    throw new Error("Search service returned an unexpected response format.");
  }

  return rawData.map(normalizeSearchResult).filter(Boolean);
}

export function extractYouTubeId(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const match = trimmed.match(re);
    if (match?.[1]) return match[1];
  }
  return null;
}
