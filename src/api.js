const USE_MOCK = true;

// To test Explanation.jsx end-to-end without the real backend: flip
// USE_MOCK to true above, then on Home paste this real, public, embeddable
// video (verified via the same noembed lookup getVideoMetadata() already
// uses): https://www.youtube.com/watch?v=aircAruvnKk
// ("But what is a neural network? | Deep learning chapter 1", 3Blue1Brown,
// ~19 min — comfortably covers every mock intervention timestamp below).
// This ID isn't hardcoded anywhere in the mock logic itself (the real
// videoId always flows through from whatever URL was pasted on Home) —
// it's just the recommended one, since the fake timestamps below assume a
// video at least a couple of minutes long.

const API_BASE_URL = "https://nearby-bankroll-heading.ngrok-free.dev";

let cachedResult = null;

export async function processVideo({ url, videoId, mode }) {
  if (USE_MOCK) {
    console.log("[MOCK] processVideo called with:", { url, videoId, mode });
    await delay(400);
    // Resolve the same way the real backend does — jobId keyed off the
    // actual videoId that was passed in, not a throwaway placeholder string.
    return { jobId: videoId };
  }

  const response = await fetch(`${API_BASE_URL}/video/process`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
    },
    body: JSON.stringify({
      youtube_url: `https://www.youtube.com/watch?v=${videoId}`,
    }),
  });
  if (!response.ok) throw new Error(`Process failed: ${response.status}`);
  const data = await response.json();

  // Cache so Timeline can reuse without calling backend again.
  cachedResult = { videoId, data };
  return { jobId: videoId };
}

/* -------------------------------------------------------------------------- */
/* getJobStatus                                                               */
/* -------------------------------------------------------------------------- */
/**
 * Polls the status of a processing job.
 * Returns: { stage, progress, message, done }
 *   stage: "downloading" | "extracting" | "detecting" | "generating" | "done"
 *   progress: 0–100
 */
let mockJobStartTime = null;

export async function getJobStatus(jobId) {
  if (USE_MOCK) {
    if (!mockJobStartTime) mockJobStartTime = Date.now();
    const elapsed = (Date.now() - mockJobStartTime) / 1000; // seconds
    const totalDuration = 12; // pretend processing takes 12 seconds
    const progress = Math.min(100, Math.round((elapsed / totalDuration) * 100));

    let stage, message;
    if (progress < 20) {
      stage = "downloading";
      message = "Fetching video from YouTube";
    } else if (progress < 45) {
      stage = "extracting";
      message = "Extracting keyframes for analysis";
    } else if (progress < 80) {
      stage = "detecting";
      message = `Qwen is reading frame ${Math.floor(progress * 10)} of 872`;
    } else if (progress < 100) {
      stage = "generating";
      message = "Writing explanations for each point";
    } else {
      stage = "done";
      message = "Complete";
    }

    await delay(150);
    return { stage, progress, message, done: progress >= 100 };
  }

  // --- Real API call ---
  const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}`, {
    headers: { "ngrok-skip-browser-warning": "true" },
  });
  if (!response.ok) throw new Error(`Status fetch failed: ${response.status}`);
  return response.json();
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
  if (USE_MOCK) {
    await delay(300);
    let meta = { title: "Untitled video", author: "Unknown" };
    try {
      meta = await getVideoMetadata(videoId);
    } catch (err) {
      console.error("Metadata fetch failed:", err);
    }
    return {
      jobId,
      videoTitle: meta.title,
      author: meta.author,
      duration: "19:13",
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

  // Real backend
  // Real backend — read from cache populated by processVideo
  if (!cachedResult || cachedResult.videoId !== videoId) {
    throw new Error("No cached result. Process the video first.");
  }
  const raw = cachedResult.data;

  let meta = { title: raw.title, author: "Unknown" };
  try {
    meta = await getVideoMetadata(videoId);
  } catch (err) {
    console.error("Metadata fetch failed:", err);
  }

  let duration = raw.duration_formatted;
  if (raw.duration_seconds === 0 && raw.interventions.length > 0) {
    const lastSeconds =
      raw.interventions[raw.interventions.length - 1].timestamp;
    duration = secondsToMMSS(lastSeconds + 60);
  }

  const points = raw.interventions
    .filter((iv) => iv.content_type !== "non-educational")
    .map((iv) => ({
      id: iv.id,
      category: iv.content_type === "slide" ? "diagram" : iv.content_type,
      timestamp: iv.timestamp_formatted.replace(/^00:/, ""),
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
    points,
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Reset the mock timer (call when starting a new job).
export function resetMockTimer() {
  mockJobStartTime = null;
}
export async function getVideoMetadata(videoId) {
  const url = `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`;
  const response = await fetch(url);
  const data = await response.json();
  console.log("Raw oEmbed response:", data);
  return { title: data.title, author: data.author_name };
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

async function getInterventionExplanation(videoId, interventionId, mode) {
  const key = `${videoId}::${interventionId}::${mode}`;
  if (_explanationCache.has(key)) return _explanationCache.get(key);

  const promise = fetch(`${API_BASE_URL}/video/intervention/explain`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
    },
    body: JSON.stringify({
      video_id: videoId,
      intervention_id: interventionId,
      output_mode: mode,
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
      const data = await res.json();
      let audioBlobUrl = null;
      if (data.audio_file_path) {
        const audioUrl = data.audio_file_path.startsWith("http")
          ? data.audio_file_path
          : `${API_BASE_URL}/${data.audio_file_path}`;
        // Fetch audio as blob so we can include the ngrok header and hand a
        // local blob URL to the Audio element (plain <audio src> can't set headers).
        try {
          const audioRes = await fetch(audioUrl, {
            headers: { "ngrok-skip-browser-warning": "true" },
          });
          if (audioRes.ok) {
            const blob = await audioRes.blob();
            audioBlobUrl = URL.createObjectURL(blob);
          } else {
            console.warn(
              "[Synapse] Audio file not served by backend:",
              audioRes.status,
            );
          }
        } catch (e) {
          console.warn("[Synapse] Could not fetch audio file:", e.message);
        }
      }
      return { ...data, audio_file_path: audioBlobUrl };
    })
    .catch((err) => {
      // Don't cache failures — allow retry on next call
      _explanationCache.delete(key);
      throw err;
    });

  _explanationCache.set(key, promise);
  return promise;
}

export async function getTTSExplanation(interventionId, mode, videoId) {
  if (USE_MOCK) {
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
  if (USE_MOCK) {
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
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Generates a short, sentence-cased title from the transcript snippet.
// Backend doesn't give us titles, so we make readable ones from context.
function titleFromContext(transcript, contentType) {
  if (!transcript)
    return contentType.charAt(0).toUpperCase() + contentType.slice(1);
  const cleaned = transcript.replace(/\s+/g, " ").trim();
  // Take first 6 words, capitalize first letter
  const words = cleaned.split(" ").slice(0, 6).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
