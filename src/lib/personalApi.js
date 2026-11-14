import { API_BASE_URL, apiUrl } from "./apiConfig";
import { accountRequest, accountOwner, currentAccount } from "./accountSession";

// Phase one never sends personal recordings/saves to a remote, unauthenticated server.
export function requireLocalBackend() {
  const host = new URL(API_BASE_URL).hostname;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) {
    throw new Error("Personal storage currently requires the Synapse backend on this computer.");
  }
}

export const PERSONAL_CHANGED = "synapse-personal-storage-changed";
export const notifyPersonal = () => window.dispatchEvent(new Event(PERSONAL_CHANGED));

export async function personalRequest(path, options = {}) {
  requireLocalBackend();
  return accountRequest(`/me/${path}`, options);
}

export function normalMode(mode) {
  return ({ standard: "explanatory", deep: "detailed", detailed: "detailed", brief: "brief", explanatory: "explanatory" })[mode] || "explanatory";
}

export function displaySaved(item) {
  const paragraphs = item.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return { ...item, ownerId: accountOwner(), savedVersionId: item.id, mode: item.mode === "explanatory" ? "standard" : item.mode,
    explanation: { subtitle: "", paragraphs, keyInsight: "", savedVersionId: item.id,
      sourceExplanationId: item.sourceExplanationId, pointId: item.pointId, videoId: item.videoId, mode: item.mode },
    audioUrl: apiUrl(item.audioUrl), frameUrl: item.frameUrl ? apiUrl(item.frameUrl) : null };
}

export const getSaved = async (id, options = {}) => displaySaved(await personalRequest(`saved-explanations/${encodeURIComponent(id)}`, options));
export const getSavedLecture = async (video) => (await personalRequest(`saved-lectures/${encodeURIComponent(video)}`)).map(displaySaved);
export const getSavedLibrary = async () => (await personalRequest("saved-library")).map((lecture) => ({ ...lecture, explanations: lecture.explanations.map(displaySaved) }));
export const getSavedList = async (kind) => (await personalRequest(`saved-explanations?kind=${kind}`)).map(displaySaved);

export async function loadSavedAudio(item, options = {}) {
  if (!currentAccount().token) return item.audioUrl;
  if (item.ownerId && item.ownerId !== accountOwner()) throw new Error("This explanation belongs to another account.");
  const blob = await accountRequest(`/me/saved-explanations/${encodeURIComponent(item.id)}/audio`, options, "blob");
  return URL.createObjectURL(blob);
}

export async function preserveExplanation(explanationId, options = {}) {
  return displaySaved(await personalRequest("saved-explanations", { method: "POST",
    ...options, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ explanation_id: explanationId }) }));
}

export async function bookmarkSaved(id, enabled) {
  await personalRequest(`saved-explanations/${encodeURIComponent(id)}/bookmark`, { method: enabled ? "PUT" : "DELETE" });
  notifyPersonal();
}

export async function trackLecture(video, options = {}) {
  await personalRequest(`saved-library/${encodeURIComponent(video)}`, { ...options, method: "PUT" });
  notifyPersonal();
}
