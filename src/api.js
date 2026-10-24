import { API_MOCK_MODE, apiUrl } from "./lib/apiConfig.js";

// To test Explanation.jsx end-to-end without the real backend, set
// VITE_API_MOCK_MODE=true, then on Home paste this real, public, embeddable
// video: https://www.youtube.com/watch?v=aircAruvnKk
// ("But what is a neural network? | Deep learning chapter 1", 3Blue1Brown,
// ~19 min — comfortably covers every mock intervention timestamp below).
// This ID isn't hardcoded anywhere in the mock logic itself (the real
// videoId always flows through from whatever URL was pasted on Home) —
// it's just the recommended one, since the fake timestamps below assume a
// video at least a couple of minutes long.

let cachedResult = null;

const INTERVENTION_ERROR_MESSAGES = {
  notFound: "This processed lecture is no longer available on the Synapse server.",
  network: "Can't reach the Synapse server. Is it running?",
  malformed: "The Synapse server returned unusable intervention data.",
  server: "The Synapse server could not load this lecture's interventions.",
};

const VIDEO_METADATA_ERROR_MESSAGES = {
  invalid: "Enter a valid YouTube video URL.",
  unavailable: "This video is unavailable or has not been processed by Synapse.",
  network: "Can't reach the Synapse server to load video details.",
  malformed: "The Synapse server returned unusable video details.",
  server: "The Synapse server could not load this video's details.",
};

const VIDEO_PROCESSING_ERROR_MESSAGES = {
  invalid: "Enter a valid YouTube video URL.",
  unavailable: "This YouTube video is unavailable, private, or has been removed.",
  network: "Can't reach the Synapse server. Check your connection and try again.",
  failed: "Synapse could not process this lecture. You can retry the job.",
  malformed: "The Synapse server returned unusable processing status.",
  server: "Synapse could not process this lecture. Please try again.",
};

const PROCESSING_STAGE_MESSAGES = {
  queued: "Waiting for lecture processing to start.",
  processing: "Processing the lecture.",
  persisting: "Saving the lecture and intervention moments.",
  preparing_explanations: "Starting background explanations.",
  complete: "Lecture processing is complete.",
  failed: "Lecture processing failed.",
};

const PROCESSING_STATUSES = new Set(["queued", "running", "succeeded", "failed"]);
const PROCESSING_STAGES = new Set(Object.keys(PROCESSING_STAGE_MESSAGES));
const inFlightProcessing = new Map();

export class InterventionPointsError extends Error {
  constructor(kind, status = null) {
    super(INTERVENTION_ERROR_MESSAGES[kind] ?? INTERVENTION_ERROR_MESSAGES.server);
    this.name = "InterventionPointsError";
    this.kind = kind;
    this.status = status;
  }
}

export class VideoMetadataError extends Error {
  constructor(kind, status = null) {
    super(VIDEO_METADATA_ERROR_MESSAGES[kind] ?? VIDEO_METADATA_ERROR_MESSAGES.server);
    this.name = "VideoMetadataError";
    this.kind = kind;
    this.status = status;
  }
}

export class VideoProcessingError extends Error {
  constructor(kind, status = null, { jobId = null, code = null } = {}) {
    super(VIDEO_PROCESSING_ERROR_MESSAGES[kind] ?? VIDEO_PROCESSING_ERROR_MESSAGES.server);
    this.name = "VideoProcessingError";
    this.kind = kind;
    this.status = status;
    this.jobId = jobId;
    this.code = code;
    this.retryable = ["network", "failed", "server"].includes(kind);
  }
}

function notifyProcessing(onStatus, snapshot, extra = {}) {
  onStatus?.({
    ...snapshot,
    jobId: snapshot?.job_id ?? snapshot?.jobId ?? null,
    videoId: snapshot?.video_id ?? snapshot?.videoId ?? null,
    message:
      extra.message ??
      PROCESSING_STAGE_MESSAGES[snapshot?.stage] ??
      "Checking lecture processing status.",
    ...extra,
  });
}

function validateProcessingJob(data, expectedVideoId) {
  if (
    !data ||
    typeof data !== "object" ||
    typeof data.job_id !== "string" ||
    !data.job_id ||
    data.video_id !== expectedVideoId ||
    !PROCESSING_STATUSES.has(data.status) ||
    !PROCESSING_STAGES.has(data.stage) ||
    !Number.isInteger(data.attempt_count) ||
    data.attempt_count < 0
  ) {
    throw new VideoProcessingError("malformed");
  }
  return data;
}

async function readProcessingError(response, jobId = null) {
  let detail = "";
  try {
    const raw = (await response.json())?.detail;
    detail = typeof raw === "string" ? raw.toLowerCase() : "";
  } catch {
    // The response status still provides a safe classification.
  }
  const unavailable =
    response.status === 404 ||
    response.status === 410 ||
    /unavailable|private|removed|copyright/.test(detail);
  const invalid = response.status === 400 || response.status === 422;
  return new VideoProcessingError(
    unavailable ? "unavailable" : invalid ? "invalid" : "server",
    response.status,
    { jobId },
  );
}

async function requestProcessingJob(
  { videoId, mode, jobId = null, retry = false },
  { signal } = {},
) {
  const path = retry && jobId
    ? `/video/processing-jobs/${encodeURIComponent(jobId)}/retry`
    : "/video/processing-jobs";
  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
  };
  if (!(retry && jobId)) {
    const body = { youtube_url: `https://www.youtube.com/watch?v=${videoId}` };
    if (mode !== undefined) body.output_mode = toBackendExplanationMode(mode);
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(apiUrl(path), init);
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new VideoProcessingError("network", null, { jobId });
  }
  if (!response.ok) throw await readProcessingError(response, jobId);

  let data;
  try {
    data = await response.json();
  } catch {
    throw new VideoProcessingError("malformed", response.status, { jobId });
  }
  return validateProcessingJob(data, videoId);
}

async function waitForProcessingJob(initial, videoId, { signal, onStatus } = {}) {
  let snapshot = initial;
  let networkFailures = 0;
  notifyProcessing(onStatus, snapshot);

  while (snapshot.status === "queued" || snapshot.status === "running") {
    await delay(Math.min(1000 * 2 ** networkFailures, 5000), signal);
    try {
      snapshot = await getJobStatus(snapshot.job_id, videoId, { signal });
      networkFailures = 0;
      notifyProcessing(onStatus, snapshot, { connectionInterrupted: false });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (!(error instanceof VideoProcessingError) || error.kind !== "network") throw error;
      networkFailures += 1;
      if (networkFailures > 5) throw error;
      notifyProcessing(onStatus, snapshot, {
        connectionInterrupted: true,
        message: "Connection interrupted. Reconnecting to this processing job.",
      });
    }
  }

  if (snapshot.status === "failed") {
    throw new VideoProcessingError("failed", null, {
      jobId: snapshot.job_id,
      code: snapshot.error_code ?? null,
    });
  }
  return snapshot;
}

async function runProcessing(
  { videoId, mode, jobId = null, retry = false },
  { signal, onStatus } = {},
) {
  const initial = await requestProcessingJob(
    { videoId, mode, jobId, retry },
    { signal },
  );
  const completed = await waitForProcessingJob(initial, videoId, {
    signal,
    onStatus,
  });
  const data = await fetchPersistedInterventions(videoId, { signal });
  cachedResult = { videoId, data };
  return {
    jobId: completed.job_id,
    videoId,
    reusedCache: Boolean(completed.reused_cache),
  };
}

export function processVideo({
  url,
  videoId,
  mode,
  signal,
  onStatus,
  jobId = null,
  retry = false,
}) {
  if (API_MOCK_MODE) {
    console.log("[MOCK] processVideo called with:", { url, videoId, mode });
    notifyProcessing(onStatus, {
      job_id: videoId,
      video_id: videoId,
      status: "running",
      stage: "processing",
    });
    // Resolve the same way the real backend does — jobId keyed off the
    // actual videoId that was passed in, not a throwaway placeholder string.
    return delay(400, signal).then(() => {
      notifyProcessing(onStatus, {
        job_id: videoId,
        video_id: videoId,
        status: "succeeded",
        stage: "complete",
      });
      return { jobId: videoId, videoId, reusedCache: false };
    });
  }

  const backendMode = mode === undefined
    ? "explanatory"
    : toBackendExplanationMode(mode);
  const key = `${videoId}::${backendMode}`;
  if (!retry && inFlightProcessing.has(key)) return inFlightProcessing.get(key);
  const promise = runProcessing(
    { videoId, mode, jobId, retry },
    { signal, onStatus },
  ).finally(() => {
    if (inFlightProcessing.get(key) === promise) inFlightProcessing.delete(key);
  });
  inFlightProcessing.set(key, promise);
  return promise;
}

/* -------------------------------------------------------------------------- */
/* getJobStatus                                                               */
/* -------------------------------------------------------------------------- */
/**
 * Polls the status of a processing job.
 * Returns the backend's durable status and actual processing stage.
 */
export async function getJobStatus(jobId, videoId, { signal } = {}) {
  let response;
  try {
    response = await fetch(
      apiUrl(`/video/processing-jobs/${encodeURIComponent(jobId)}`),
      { headers: { Accept: "application/json" }, signal },
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new VideoProcessingError("network", null, { jobId });
  }
  if (!response.ok) throw await readProcessingError(response, jobId);

  let data;
  try {
    data = await response.json();
  } catch {
    throw new VideoProcessingError("malformed", response.status, { jobId });
  }
  return validateProcessingJob(data, videoId);
}

/* -------------------------------------------------------------------------- */
/* getInterventionPoints                                                      */
/* -------------------------------------------------------------------------- */
/**
 * Once a job is done, this returns the detected intervention points.
 * Used by the Timeline screen.
 *
 * Each point is normalized to the agreed intervention contract:
 *   { id, category, timestamp, title, focusRegion?, structured? }
 * (explanation/keyInsight are fetched separately, per point, by
 * getExplanation()/getTTSExplanation() below — same in both mock and real
 * branches, this call never returns them.)
 *
 * Backend contract gap: the real backend does not yet return focusRegion or
 * structured for any intervention (verified against the current raw.interventions
 * shape below) — the mapping passes them through when present so nothing
 * further needs to change here once the backend adds them in this shape.
 */
export async function getInterventionPoints(jobId, videoId) {
  if (API_MOCK_MODE) {
    await delay(300);
    const meta = await getVideoMetadata(videoId);
    return {
      jobId,
      videoTitle: meta.title,
      author: meta.author,
      duration: "19:13",
      thumbnailUrl: meta.thumbnailUrl,
      metadataError: null,
      // Each point carries only what the points-list UI (Timeline, the
      // Lecture Details stepper) needs — focusRegion/structured are included
      // when the underlying intervention has them (see MOCK_INTERVENTIONS
      // below), omitted entirely otherwise, same as a real backend response
      // would do once it supports these fields.
      points: Object.values(MOCK_INTERVENTIONS).map((iv) => ({
        id: iv.id,
        category: iv.category,
        timestamp: iv.timestamp,
        title: iv.title,
        ...(iv.focusRegion ? { focusRegion: iv.focusRegion } : {}),
        ...(iv.structured ? { structured: iv.structured } : {}),
      })),
    };
  }

  // A fresh processing response is reusable, but it is only a performance
  // cache. Saved lectures must remain reopenable after this module is reloaded.
  let raw = null;
  if (cachedResult?.videoId === videoId) {
    try {
      raw = validateInterventionResult(cachedResult.data, videoId);
    } catch (err) {
      if (!(err instanceof InterventionPointsError)) throw err;
      // A bad cache must not hide a valid committed backend result.
    }
  }

  if (!raw) raw = await fetchPersistedInterventions(videoId);

  let meta = {
    title: raw.title || "Untitled video",
    author: "",
    duration: "",
    thumbnailUrl: videoId
      ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
      : "",
  };
  let metadataError = null;
  try {
    const externalMeta = await getVideoMetadata(videoId);
    if (externalMeta.title) meta.title = externalMeta.title;
    if (externalMeta.author) meta.author = externalMeta.author;
    if (externalMeta.duration) meta.duration = externalMeta.duration;
    if (externalMeta.thumbnailUrl) meta.thumbnailUrl = externalMeta.thumbnailUrl;
  } catch (err) {
    console.error("Metadata fetch failed:", err);
    metadataError = err?.message || VIDEO_METADATA_ERROR_MESSAGES.server;
  }

  let duration = meta.duration || raw.duration_formatted || "";
  if (!duration && Number.isFinite(raw.duration_seconds)) {
    duration = secondsToMMSS(raw.duration_seconds);
  }
  if (raw.duration_seconds === 0 && raw.interventions.length > 0) {
    const lastSeconds =
      raw.interventions[raw.interventions.length - 1].timestamp;
    duration = secondsToMMSS(lastSeconds + 60);
  }

  const points = raw.interventions
    .filter((iv) => iv.content_type !== "non-educational")
    .map((iv) => ({
      id: iv.id,
      category:
        iv.content_type === "slide" ? "diagram" : (iv.content_type || "unknown"),
      timestamp: secondsToMMSS(iv.timestamp),
      title: titleFromContext(iv.transcript_context, iv.content_type),
      // Not yet provided by the backend — see the contract-gap note above.
      // Passthrough only (never fabricated): once the backend starts
      // sending these in this exact shape, they flow through automatically
      // with no further changes here, same as the mock branch above.
      ...(iv.focusRegion ? { focusRegion: iv.focusRegion } : {}),
      ...(iv.structured ? { structured: iv.structured } : {}),
      _frame_path: iv.frame_path,
      _transcript: iv.transcript_context,
    }));

  return {
    jobId,
    videoTitle: meta.title,
    author: meta.author,
    duration,
    thumbnailUrl: meta.thumbnailUrl,
    metadataError,
    points,
  };
}

async function fetchPersistedInterventions(videoId, { signal } = {}) {
  let response;
  try {
    response = await fetch(
      apiUrl(`/video/${encodeURIComponent(videoId)}/interventions`),
      signal ? { signal } : undefined,
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new InterventionPointsError("network");
  }

  if (!response.ok) {
    throw new InterventionPointsError(
      response.status === 404 ? "notFound" : "server",
      response.status,
    );
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new InterventionPointsError("malformed", response.status);
  }
  return validateInterventionResult(data, videoId);
}

function validateInterventionResult(data, videoId) {
  const malformed = () => {
    throw new InterventionPointsError("malformed");
  };
  if (
    !data ||
    typeof data !== "object" ||
    data.video_id !== videoId ||
    !Array.isArray(data.interventions) ||
    (data.title !== null && data.title !== undefined && typeof data.title !== "string") ||
    (data.duration_seconds !== null &&
      data.duration_seconds !== undefined &&
      (!Number.isFinite(data.duration_seconds) || data.duration_seconds < 0)) ||
    (data.duration_formatted !== null &&
      data.duration_formatted !== undefined &&
      typeof data.duration_formatted !== "string") ||
    (data.total_interventions !== undefined &&
      data.total_interventions !== data.interventions.length)
  ) {
    malformed();
  }

  const ids = new Set();
  const interventions = data.interventions.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.id !== "string" ||
      !item.id ||
      item.video_id !== videoId ||
      !Number.isFinite(item.timestamp) ||
      item.timestamp < 0 ||
      typeof item.frame_path !== "string" ||
      (item.content_type !== null &&
        item.content_type !== undefined &&
        typeof item.content_type !== "string") ||
      (item.transcript_context !== null &&
        item.transcript_context !== undefined &&
        typeof item.transcript_context !== "string") ||
      ids.has(item.id)
    ) {
      malformed();
    }
    ids.add(item.id);
    return item;
  });

  return {
    ...data,
    interventions: [...interventions].sort(
      (left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id),
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// Reset the mock timer (call when starting a new job).
export function resetMockTimer() {
  // Retained for existing callers. Mock jobs no longer use elapsed time.
}
export async function getVideoMetadata(videoId) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId || "")) {
    throw new VideoMetadataError("invalid");
  }

  if (API_MOCK_MODE) {
    return {
      videoId,
      title: "Sample lecture",
      author: "",
      duration: "19:13",
      durationSeconds: 1153,
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      exists: true,
      processed: true,
    };
  }

  let response;
  try {
    response = await fetch(apiUrl(`/video/meta/${encodeURIComponent(videoId)}`), {
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new VideoMetadataError("network");
  }

  if (!response.ok) {
    throw new VideoMetadataError(
      response.status === 404 || response.status === 410
        ? "unavailable"
        : "server",
      response.status,
    );
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new VideoMetadataError("malformed", response.status);
  }
  if (
    !data ||
    typeof data !== "object" ||
    data.video_id !== videoId ||
    typeof data.exists !== "boolean" ||
    typeof data.processed !== "boolean"
  ) {
    throw new VideoMetadataError("malformed", response.status);
  }
  if (!data.exists) throw new VideoMetadataError("unavailable", response.status);

  const durationSeconds = Number.isFinite(data.duration_seconds)
    ? data.duration_seconds
    : null;
  return {
    videoId,
    title: typeof data.title === "string" ? data.title : "",
    author: typeof data.channel_name === "string" ? data.channel_name : "",
    duration:
      typeof data.duration_formatted === "string"
        ? data.duration_formatted
        : durationSeconds !== null
          ? secondsToMMSS(durationSeconds)
          : "",
    durationSeconds,
    thumbnailUrl:
      typeof data.thumbnail_url === "string" ? data.thumbnail_url : "",
    exists: data.exists,
    processed: data.processed,
  };
}

/**
 * Fetches the TTS audio and text explanation for an intervention point.
 * Current response shape from backend:
 *   { intervention_id, text_explanation, audio_file_path, output_mode }
 *
 * Backend contract gap: no explicit `explanation`/`keyInsight` fields yet
 * (the agreed contract asks for `{ explanation, keyInsight? }`, matching
 * MOCK_INTERVENTIONS below) — getExplanation() falls back to a heuristic
 * split of `text_explanation` until the backend adds them, but will prefer
 * `data.explanation`/`data.keyInsight` automatically the moment they exist,
 * with no further change needed here.
 *
 * Returns the same shape but with audio_file_path as a fully-qualified URL
 * ready to pass to new Audio().
 */

// Cache so parallel calls for the same point share one HTTP request.
const _explanationCache = new Map();

const EXPLANATION_MODE_MAP = Object.freeze({
  brief: "brief",
  standard: "explanatory",
  detailed: "detailed",
});

export function toBackendExplanationMode(mode) {
  const backendMode = EXPLANATION_MODE_MAP[mode];
  if (!backendMode) throw new Error(`Unsupported explanation mode: ${mode}`);
  return backendMode;
}

const PREPARATION_STATUSES = new Set(["pending", "generating", "ready", "failed"]);

export class ExplanationPreparationError extends Error {
  constructor(kind, status = null, details = null) {
    const messages = {
      unavailable: "Explanation preparation is temporarily unavailable.",
      notFound: "This lecture or intervention is no longer available.",
      malformed: "The Synapse server returned unusable preparation status.",
      exhausted: "This explanation could not be prepared after several attempts.",
      notRetryable: "This explanation is not currently eligible for retry.",
      network: "Can't reach the Synapse server to check explanation preparation.",
    };
    super(messages[kind] || messages.unavailable);
    this.name = "ExplanationPreparationError";
    this.kind = kind;
    this.status = status;
    this.details = details;
  }
}

function validatePreparationItem(item, malformed) {
  if (
    !item ||
    typeof item !== "object" ||
    typeof item.intervention_id !== "string" ||
    !/^[A-Za-z0-9-]{1,64}$/.test(item.intervention_id) ||
    !Number.isFinite(item.timestamp) ||
    item.timestamp < 0 ||
    !PREPARATION_STATUSES.has(item.status) ||
    (item.error_code !== null &&
      item.error_code !== undefined &&
      (typeof item.error_code !== "string" || !/^[a-z0-9_]{1,64}$/.test(item.error_code))) ||
    !Number.isInteger(item.attempt_count) ||
    item.attempt_count < 0
  ) {
    malformed();
  }
  return {
    intervention_id: item.intervention_id,
    timestamp: item.timestamp,
    status: item.status,
    error_code: item.error_code ?? null,
    attempt_count: item.attempt_count,
  };
}

function validatePreparationStatus(data, videoId, backendMode) {
  const malformed = () => {
    throw new ExplanationPreparationError("malformed");
  };
  if (
    !data ||
    typeof data !== "object" ||
    data.video_id !== videoId ||
    data.output_mode !== backendMode ||
    !Array.isArray(data.items)
  ) {
    malformed();
  }
  const ids = new Set();
  let previousTimestamp = -1;
  const items = data.items.map((raw) => {
    const item = validatePreparationItem(raw, malformed);
    if (ids.has(item.intervention_id) || item.timestamp < previousTimestamp) malformed();
    ids.add(item.intervention_id);
    previousTimestamp = item.timestamp;
    return item;
  });
  return { video_id: videoId, output_mode: backendMode, items };
}

async function preparationResponseError(response) {
  let details = null;
  try {
    const body = await response.json();
    details = body?.detail ?? body;
  } catch {
    // The status code is enough to produce a safe user-facing error.
  }
  const code = details?.code;
  if (response.status === 404) return new ExplanationPreparationError("notFound", 404);
  if (response.status === 409 && code === "retry_exhausted") {
    return new ExplanationPreparationError("exhausted", 409, details);
  }
  if (response.status === 409) {
    return new ExplanationPreparationError("notRetryable", 409, details);
  }
  return new ExplanationPreparationError("unavailable", response.status);
}

export async function getExplanationPreparationStatus(videoId, mode, { signal } = {}) {
  const backendMode = toBackendExplanationMode(mode);
  let response;
  try {
    response = await fetch(
      apiUrl(`/video/${encodeURIComponent(videoId)}/explanations/status?output_mode=${encodeURIComponent(backendMode)}`),
      { signal },
    );
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new ExplanationPreparationError("network");
  }
  if (!response.ok) throw await preparationResponseError(response);
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ExplanationPreparationError("malformed", response.status);
  }
  return validatePreparationStatus(data, videoId, backendMode);
}

export async function retryExplanationPreparation(videoId, interventionId, mode, { signal } = {}) {
  const backendMode = toBackendExplanationMode(mode);
  let response;
  try {
    response = await fetch(
      apiUrl(
        `/video/${encodeURIComponent(videoId)}/interventions/${encodeURIComponent(interventionId)}/explanations/retry?output_mode=${encodeURIComponent(backendMode)}`,
      ),
      { method: "POST", signal },
    );
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new ExplanationPreparationError("network");
  }
  if (!response.ok) throw await preparationResponseError(response);
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ExplanationPreparationError("malformed", response.status);
  }
  const malformed = () => {
    throw new ExplanationPreparationError("malformed", response.status);
  };
  if (
    data?.video_id !== videoId ||
    data?.intervention_id !== interventionId ||
    data?.output_mode !== backendMode
  ) {
    malformed();
  }
  if (
    !PREPARATION_STATUSES.has(data.status) ||
    (data.error_code !== null &&
      data.error_code !== undefined &&
      (typeof data.error_code !== "string" || !/^[a-z0-9_]{1,64}$/.test(data.error_code))) ||
    !Number.isInteger(data.attempt_count) ||
    data.attempt_count < 0
  ) {
    malformed();
  }
  return {
    video_id: videoId,
    intervention_id: interventionId,
    output_mode: backendMode,
    status: data.status,
    error_code: data.error_code ?? null,
    attempt_count: data.attempt_count,
  };
}

async function getInterventionExplanation(videoId, interventionId, mode) {
  const backendMode = toBackendExplanationMode(mode);
  const key = `${videoId}::${interventionId}::${backendMode}`;
  if (_explanationCache.has(key)) return _explanationCache.get(key);

  const promise = fetch(apiUrl("/video/intervention/explain"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      video_id: videoId,
      intervention_id: interventionId,
      output_mode: backendMode,
    }),
  })
    .then(async (res) => {
      if (!res.ok) {
        const errBody = await res.text().catch(() => "(no body)");
        console.error(
          `[Synapse] /video/intervention/explain ${res.status}:`,
          errBody,
        );
        throw new Error(`Explain failed: ${res.status} — ${errBody}`);
      }
      return hydrateExplanationAudio(await res.json());
    })
    .catch((err) => {
      // Don't cache failures — allow retry on next call
      _explanationCache.delete(key);
      throw err;
    });

  _explanationCache.set(key, promise);
  return promise;
}

async function hydrateExplanationAudio(data, { signal } = {}) {
  let audioBlobUrl = null;
  let audioError = null;
  if (data.audio_url) {
    const audioUrl = data.audio_url.startsWith("http")
      ? data.audio_url
      : apiUrl(data.audio_url);
    try {
      const audioRes = await fetch(audioUrl, { signal });
      if (audioRes.ok) {
        const blob = await audioRes.blob();
        audioBlobUrl = URL.createObjectURL(blob);
      } else {
        audioError = "Explanation audio is unavailable. You can still read the explanation.";
        console.warn("[Synapse] Audio file not served by backend:", audioRes.status);
      }
    } catch (error) {
      audioError = "Explanation audio could not be loaded. You can still read the explanation.";
      console.warn("[Synapse] Could not fetch audio file:", error.message);
    }
  } else {
    audioError = "Explanation audio is unavailable. You can still read the explanation.";
  }
  return {
    ...data,
    audio_url: data.audio_url || null,
    audio_file_path: audioBlobUrl,
    audio_error: audioError,
  };
}

// Reads an explanation which P2 has already marked ready. Unlike the legacy
// POST client above, this endpoint can never start competing inference.
export async function getPreparedExplanation(interventionId, mode, videoId, { signal } = {}) {
  if (API_MOCK_MODE) {
    const [explanation, audio] = await Promise.all([
      getExplanation(interventionId, mode, videoId),
      getTTSExplanation(interventionId, mode, videoId),
    ]);
    return { explanation, audio };
  }

  const backendMode = toBackendExplanationMode(mode);
  const response = await fetch(
    apiUrl(
      `/video/intervention/${encodeURIComponent(interventionId)}/explanation?output_mode=${encodeURIComponent(backendMode)}`,
    ),
    { signal },
  );
  if (!response.ok) {
    throw new ExplanationPreparationError(
      response.status === 404 ? "notFound" : "unavailable",
      response.status,
    );
  }
  const data = await hydrateExplanationAudio(await response.json(), { signal });
  if (
    data.intervention_id !== interventionId ||
    data.output_mode !== backendMode ||
    typeof data.text_explanation !== "string" ||
    !data.text_explanation.trim()
  ) {
    throw new ExplanationPreparationError("malformed", response.status);
  }
  const parsed = parseTextExplanation(
    data.explanation ?? data.text_explanation,
    interventionId,
  );
  return {
    explanation: { ...parsed, keyInsight: data.keyInsight ?? parsed.keyInsight },
    audio: data,
  };
}

export async function getTTSExplanation(interventionId, mode, videoId) {
  if (API_MOCK_MODE) {
    await delay(600);
    const mock = MOCK_INTERVENTIONS[interventionId] ?? MOCK_INTERVENTIONS.p1;
    return {
      intervention_id: interventionId,
      text_explanation: [mock.explanation, mock.keyInsight]
        .filter(Boolean)
        .join("\n\n"),
      audio_file_path: createMockAudioUrl(),
      output_mode: mode,
    };
  }

  return getInterventionExplanation(videoId, interventionId, mode);
}

/* -------------------------------------------------------------------------- */
/* createMockAudioUrl (mock only)                                             */
/* -------------------------------------------------------------------------- */
function createMockAudioUrl() {
  const sampleRate = 22050;
  const duration = 8;
  const numSamples = sampleRate * duration;
  const samples = new Int16Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    // Simple 220 Hz tone with fade in/out
    samples[i] = Math.sin((i / sampleRate) * 220 * 2 * Math.PI) * 1200;
    if (i < sampleRate * 0.15) samples[i] *= i / (sampleRate * 0.15);
    if (i > numSamples - sampleRate * 0.15)
      samples[i] *= (numSamples - i) / (sampleRate * 0.15);
  }

  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ws = (off, str) => {
    for (let i = 0; i < str.length; i++)
      view.setUint8(off + i, str.charCodeAt(i));
  };
  ws(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ws(8, "WAVE");
  ws(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ws(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++)
    view.setInt16(44 + i * 2, samples[i], true);

  const blob = new Blob([buffer], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}

/* -------------------------------------------------------------------------- */
/* MOCK_INTERVENTIONS — single source of truth for all mock intervention data */
/* -------------------------------------------------------------------------- */
/**
 * One normalized object per mock intervention, matching the agreed
 * intervention contract exactly (the same shape the backend developer has
 * confirmed they'll return once their fields are added):
 *   { id, category, timestamp, title, focusRegion?, structured?, explanation, keyInsight? }
 * getInterventionPoints(), getExplanation(), and getTTSExplanation() above
 * all read from this one table (sliced to what each needs) rather than each
 * keeping separate mock content — one underlying intervention object, not a
 * parallel mock system per feature.
 *
 * focusRegion/structured are genuinely optional per intervention, never
 * fabricated for a category where they wouldn't be meaningful — several
 * categories below (code, and one diagram) deliberately have neither, to
 * keep exercising the "omit the section" paths, not just the "show it"
 * ones. A slide's content_type is normalized to category "diagram" by the
 * real (non-mock) branch below (iv.content_type === "slide" ? "diagram" :
 * ...), so the slide example here uses "diagram" too — this table always
 * mirrors what the frontend will actually receive post-normalization, not
 * raw backend content_type values.
 */
const MOCK_INTERVENTIONS = {
  p1: {
    id: "p1",
    category: "diagram",
    timestamp: "0:10",
    title: "Vector field diagram",
    structured: {
      rows: [
        { label: "Arrow direction", value: "Shows which way a particle would be pushed at that point" },
        { label: "Arrow length", value: "Represents the relative strength of the field at that point" },
        { label: "Central region", value: "Arrows curve around it rather than passing straight through" },
      ],
    },
    explanation:
      "A visual map of how the vector field points and changes across the plane.\n\n" +
      "This diagram shows arrows drawn at many points in the plane, each one representing the direction and relative strength of the field at that location. Longer arrows mean a stronger field; the direction each arrow points shows which way a particle would be pushed if it were placed there.\n\n" +
      "Notice how the arrows curve around the central region rather than pointing straight through it — that curvature is the visual signature of rotation in the field, something that's much harder to see from the raw equations alone.",
    keyInsight:
      "A vector field diagram turns an abstract function of two variables into something you can literally trace with your eye.",
  },
  // Only 4s after p1 — deliberately close together to keep exercising the
  // sequencing protection (p2 must not trigger until p1's explanation has
  // fully finished and the video has resumed).
  p2: {
    id: "p2",
    category: "equation",
    timestamp: "0:14",
    title: "Divergence formula",
    structured: {
      rows: [
        { label: "∇ · F", value: "The divergence operator applied to vector field F" },
        { label: "∂P/∂x + ∂Q/∂y", value: "The partial derivatives of each component, added together" },
        { label: "Positive result", value: "The field is expanding outward from that point (a source)" },
        { label: "Negative result", value: "The field is converging inward toward that point (a sink)" },
      ],
    },
    explanation:
      "The divergence formula measures how much a vector field spreads out from a point.\n\n" +
      "Divergence takes the partial derivatives of each component of the field and adds them together, producing a single number at every point in space. A positive value means the field is expanding outward from that point, like a source; a negative value means it's converging inward, like a sink.\n\n" +
      "This is exactly the same 'spreading out' idea from the diagram a moment ago — the formula is just the precise, computable version of what the arrows were already showing you visually.\n\n" +
      "Once you can compute divergence directly, you no longer need to draw the field by hand to know whether a point behaves like a source or a sink.",
    keyInsight:
      "Divergence is the formula's way of asking: at this exact point, is the field pushing things away or pulling them in?",
  },
  p3: {
    id: "p3",
    category: "chart",
    timestamp: "1:30",
    title: "Field strength chart",
    focusRegion: { x: 58, y: 54, w: 36, h: 34 }, // near bottom-right
    structured: {
      rows: [
        { label: "X-axis", value: "Distance from the source" },
        { label: "Y-axis", value: "Measured field strength" },
        { label: "Data points", value: "Plotted at regular distance intervals" },
      ],
    },
    explanation:
      "This chart plots field strength against distance from the source.\n\n" +
      "The x-axis represents distance from the source, and the y-axis represents the measured strength of the field at that distance. Notice the curve falls off sharply at first, then levels out — a pattern typical of inverse-square relationships.\n\n" +
      "Reading this chart tells you something the equation alone doesn't make obvious: exactly how quickly the field becomes negligible as you move away, which matters a lot for real-world engineering decisions like shielding or safe distances.",
    keyInsight:
      "A chart like this turns an abstract inverse-square law into a concrete, measurable curve you can read values off directly.",
  },
  p4: {
    id: "p4",
    category: "graph",
    timestamp: "3:00",
    title: "Velocity-time graph",
    focusRegion: { x: 6, y: 8, w: 34, h: 30 }, // near top-left, where Curve A's early rise sits
    structured: {
      rows: [
        { label: "X-axis", value: "Time, in seconds" },
        { label: "Y-axis", value: "Velocity, in meters per second" },
        { label: "Curve A", value: "Begins near zero, reaches approximately 40 m/s by 5 seconds" },
        { label: "Curve B", value: "Begins near zero, reaches approximately 25 m/s by 5 seconds" },
      ],
    },
    explanation:
      "This graph plots velocity against time for two different objects released under slightly different conditions.\n\n" +
      "Curve A rises steeply at first and then levels off, while Curve B climbs more slowly but keeps rising over the same interval — the shapes alone tell you which object accelerates faster early on, without needing to read a single number.\n\n" +
      "Comparing the two curves side by side is exactly why a graph is often clearer than a table of raw numbers: the relationship between them is visible at a glance.",
    keyInsight:
      "A velocity-time graph lets you compare how two objects accelerate just by comparing the steepness of their curves.",
  },
  // "code" has no meaningful focusRegion or structured breakdown — a code
  // snippet is read top-to-bottom as text, not scanned as a spatial region
  // or decomposed into labeled parts, so both are correctly omitted rather
  // than fabricated. This is a deliberate example of the "explanation +
  // optional keyInsight only" case.
  p5: {
    id: "p5",
    category: "code",
    timestamp: "5:45",
    title: "Gradient descent update rule",
    explanation:
      "This snippet shows one step of gradient descent: updating a parameter by moving it against the direction of steepest increase in the loss.\n\n" +
      "Each line corresponds to one update — the learning rate controls how big a step is taken, and the gradient tells the code which direction to move. Running this in a loop is what actually trains the network, one small adjustment at a time.",
    keyInsight:
      "Gradient descent is just this one update rule, repeated thousands of times until the loss stops improving.",
  },
  // A summary slide — content_type "slide" from the real backend is already
  // normalized to category "diagram" below, so this mock entry does the
  // same rather than inventing a "slide" category the pipeline never
  // actually produces. Structured rows are a natural fit here since the
  // slide itself is just a short bulleted list — no focusRegion, since no
  // single bullet is more visually important than the others.
  p6: {
    id: "p6",
    category: "diagram",
    timestamp: "8:20",
    title: "Summary slide: Newton's three laws",
    structured: {
      rows: [
        { label: "First law", value: "An object stays at rest or in uniform motion unless acted on by a net force" },
        { label: "Second law", value: "Force equals mass times acceleration (F = ma)" },
        { label: "Third law", value: "For every action there is an equal and opposite reaction" },
      ],
    },
    explanation:
      "This slide condenses Newton's three laws into one screen as a quick reference before moving into examples.\n\n" +
      "Seeing all three laws listed together makes it easier to notice how they build on each other — the first law defines what 'no net force' looks like, the second law quantifies force once it's present, and the third law describes what happens when two objects interact.",
    keyInsight:
      "All three laws describe one connected idea — force and motion — viewed from three different angles.",
  },
};

// Mock-only: splits a stored `explanation` string back into the
// {subtitle, paragraphs} shape the UI renders — the first blank-line-
// separated chunk above is already written as one complete sentence, so it
// doubles as the subtitle verbatim. Deliberately separate from
// parseTextExplanation() below, which derives a subtitle from a *real*
// backend's unstructured text (first sentence of the first paragraph)
// instead — keeping them separate means this refactor can't change real
// (non-mock) parsing behavior.
function splitMockExplanation(text) {
  const chunks = text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  const [subtitle = "", ...paragraphs] = chunks;
  return { subtitle, paragraphs };
}

export async function getExplanation(pointId, mode, videoId) {
  if (API_MOCK_MODE) {
    await delay(300);
    const mock = MOCK_INTERVENTIONS[pointId] ?? MOCK_INTERVENTIONS.p1;
    const { subtitle, paragraphs } = splitMockExplanation(mock.explanation);
    return { pointId, subtitle, paragraphs, keyInsight: mock.keyInsight ?? "" };
  }

  const data = await getInterventionExplanation(videoId, pointId, mode);
  // Prefer the explicit `explanation`/`keyInsight` fields the agreed
  // contract asks for, once the backend sends them; parseTextExplanation's
  // heuristic (unchanged) is the fallback for as long as it only returns
  // text_explanation — see the contract-gap note above getInterventionExplanation.
  const parsed = parseTextExplanation(
    data.explanation ?? data.text_explanation,
    pointId,
  );
  return { ...parsed, keyInsight: data.keyInsight ?? parsed.keyInsight };
}

// Splits the raw text_explanation string into the { subtitle, paragraphs, keyInsight }
// shape the Explanation component expects.
function parseTextExplanation(text, pointId) {
  if (!text) {
    return { pointId, subtitle: "", paragraphs: [], keyInsight: "" };
  }

  const rawParagraphs = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter(Boolean);

  const subtitle =
    rawParagraphs.length > 0
      ? (rawParagraphs[0].split(/[.!?]/)[0] + ".").trim()
      : "";

  const body =
    rawParagraphs.length > 2 ? rawParagraphs.slice(0, -1) : rawParagraphs;

  const keyInsight =
    rawParagraphs.length > 2 ? rawParagraphs[rawParagraphs.length - 1] : "";

  return { pointId, subtitle, paragraphs: body, keyInsight };
}
function secondsToMMSS(seconds) {
  const wholeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(wholeSeconds / 3600);
  const m = Math.floor((wholeSeconds % 3600) / 60);
  const s = String(wholeSeconds % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

// Generates a short, sentence-cased title from the transcript snippet.
// Backend doesn't give us titles, so we make readable ones from context.
function titleFromContext(transcript, contentType) {
  if (!transcript)
    return contentType
      ? contentType.charAt(0).toUpperCase() + contentType.slice(1)
      : "Visual moment";
  const cleaned = transcript.replace(/\s+/g, " ").trim();
  // Take first 6 words, capitalize first letter
  const words = cleaned.split(" ").slice(0, 6).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
