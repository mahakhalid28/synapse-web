// Turns a time that came from somewhere else (a quiz result's evidence, a note) into the
// `startSeconds` the lecture screen understands, or null when it can't be trusted.
//
// The lecture screen cues the video at `startSeconds` (the YouTube player takes SECONDS) and leaves it
// paused; null means "do not seek at all", so the lecture simply opens as it normally would. A bad
// value must never become a seek: not a string, NaN, Infinity, a negative time, or anything past the
// same 48-hour bound Ask and Voice Notes already use. Fractions are dropped (whole seconds).

import { MAX_TIME_SECONDS } from "./askApi.js";

export function safeStartSeconds(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > MAX_TIME_SECONDS) return null;
  return Math.floor(value);
}
