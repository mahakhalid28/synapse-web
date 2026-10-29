// Client for the backend voice endpoints (/voice/transcribe, /voice/interpret, /voice/speak, /voice/warmup).
// The audio goes only to the Synapse server on this computer; nothing is sent to a third party.

import { apiUrl } from "../lib/apiConfig.js";

async function fail(res) {
  let detail = null;
  try {
    detail = (await res.json())?.detail ?? null;
  } catch {
    /* not JSON */
  }
  const err = new Error(typeof detail === "string" ? detail : `Voice request failed (${res.status}).`);
  err.status = res.status;
  throw err;
}

/** 16 kHz WAV blob -> { text, language, language_probability, duration_seconds, no_speech } */
export async function transcribeAudio(wav, { language = null, signal } = {}) {
  const body = new FormData();
  body.append("file", wav, "speech.wav");
  if (language) body.append("language", language);
  const res = await fetch(apiUrl("/voice/transcribe"), { method: "POST", body, signal });
  if (!res.ok) await fail(res);
  return res.json();
}

/** { text, context, language? } -> the raw interpret response (validate it with parseInterpretResponse). */
export async function interpretText(body, { signal } = {}) {
  const res = await fetch(apiUrl("/voice/interpret"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) await fail(res);
  return res.json();
}

/** Short text -> a playable blob URL (the existing TTS engine, cached on the server). */
export async function speakText(text, { signal } = {}) {
  const res = await fetch(apiUrl("/voice/speak"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!res.ok) await fail(res);
  return URL.createObjectURL(await res.blob());
}

/** Ask the server to load its models now (fire and forget) so the first command is not slow. */
export function warmUpVoice() {
  if (typeof fetch !== "function") return;
  fetch(apiUrl("/voice/warmup"), { method: "POST" }).catch(() => {});
}
