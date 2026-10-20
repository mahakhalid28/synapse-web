// Front-end feature flag for Accessible Quiz & Practice (docs/QUIZ_CONTRACT.md section 12).
//
// An EXPLICIT VITE_QUIZ_ENABLED decides: on only when it is exactly "1" or "true" (surrounding whitespace
// ignored); "", "0", "TRUE", "yes" and anything else are off.
//
// When it is NOT set, the default follows the build mode (decided 2026-10-20): ON in development
// (`npm run dev`, `npm run electron:dev`) and OFF in a production build (`vite build`, the packaged app) and in
// the test runner. It is read on every call so tests can switch it. The backend has its own, separate
// QUIZ_ENABLED flag (unset: on in development, off when SYNAPSE_ENV=production): turning this one on does NOT make
// the server generate quizzes, and if the server's flag is off the quiz screen tells the learner that practice
// questions are not available.

export function quizEnabled() {
  const explicit = import.meta.env.VITE_QUIZ_ENABLED;
  if (explicit !== undefined && explicit !== null) return ["1", "true"].includes(String(explicit).trim());
  return import.meta.env.MODE === "development";
}
