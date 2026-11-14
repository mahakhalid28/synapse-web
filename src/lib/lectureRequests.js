import { normalMode, personalRequest } from "./personalApi";
import { ACCOUNT_CHANGED, registerAccountTransition } from "./accountSession";

const sessions = new Map();
export const LECTURE_SESSION_EXPIRED = "synapse-lecture-session-expired";
const json = (body) => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function ensureLectureSession(videoId) {
  if (!sessions.has(videoId)) {
    const entry = { id: null, timer: null };
    entry.ready = personalRequest("lecture-sessions", { method: "POST", ...json({ video_id: videoId }) })
      .then((item) => {
        if (!item?.id) throw new Error("The lecture session could not be registered.");
        entry.id = item.id;
        entry.timer = setInterval(() => {
          personalRequest(`lecture-sessions/${item.id}/heartbeat`, { method: "PUT" })
            .catch((error) => {
              if (error.status === 409 && sessions.get(videoId) === entry) {
                clearInterval(entry.timer);
                sessions.delete(videoId);
                window.dispatchEvent(new CustomEvent(LECTURE_SESSION_EXPIRED, { detail: { videoId } }));
              }
            });
        }, 15000);
        return item.id;
      }).catch((error) => { if (sessions.get(videoId) === entry) sessions.delete(videoId); throw error; });
    sessions.set(videoId, entry);
  }
  return sessions.get(videoId).ready;
}

export async function releaseLectureSession(videoId, reason = "leave") {
  const entry = sessions.get(videoId);
  if (!entry) return false;
  const identity = await entry.ready;
  await personalRequest(`lecture-sessions/${identity}/release`, { method: "POST", ...json({ reason }) });
  clearInterval(entry.timer);
  if (sessions.get(videoId) === entry) sessions.delete(videoId);
  return true;
}

registerAccountTransition(async (previous, result) => {
  // Successful authenticated logout already preserves linked jobs on the server.
  if (previous.token && result === null) return;
  for (const videoId of [...sessions.keys()]) await releaseLectureSession(videoId, "signout");
});

window.addEventListener(ACCOUNT_CHANGED, () => {
  for (const entry of sessions.values()) clearInterval(entry.timer);
  sessions.clear();
});

export async function requestLectureExplanation(videoId, point, depth, { signal, operationId = crypto.randomUUID() } = {}) {
  const sessionId = await ensureLectureSession(videoId);
  return personalRequest("explanation-requests", { method: "POST", signal,
    ...json({ video_id: videoId, session_id: sessionId, operation_id: operationId,
      timestamp_seconds: point.timestampSeconds ?? point.timestamp.split(":").map(Number).reduce((total, part) => total * 60 + part, 0),
      intervention_id: point.unresolved ? null : point.id, output_mode: normalMode(depth) }) });
}

export async function listLectureRequests(videoId, options = {}) {
  const pages = [];
  let cursor = null;
  do {
    const page = await personalRequest(`explanation-requests?video_id=${encodeURIComponent(videoId)}${cursor ? `&before=${encodeURIComponent(cursor)}` : ""}`, options);
    pages.unshift(page.items);
    cursor = page.next_cursor;
  } while (cursor && !options.signal?.aborted);
  return pages.flat();
}

export function updateLectureRequest(identity, progress) {
  return personalRequest(`explanation-requests/${identity}`, { method: "PATCH", ...json(progress) });
}

export async function retryLectureRequest(videoId, identity, options = {}) {
  const sessionId = await ensureLectureSession(videoId);
  return personalRequest(`explanation-requests/${identity}/retry`, { method: "POST", ...options,
    ...json({ session_id: sessionId }) });
}
