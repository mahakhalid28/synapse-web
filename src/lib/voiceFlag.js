// Front-end feature flag for voice control (docs/voice-control.md).
//
// An EXPLICIT VITE_VOICE_CONTROL_ENABLED decides: on only when it is exactly "1" or "true" (surrounding
// whitespace ignored); anything else is off.
//
// When it is NOT set, the default follows the build mode, like the quiz flag: ON in development
// (`npm run dev`, `npm run electron:dev`) and OFF in a production build and in the test runner. It is read
// on every call so tests can switch it. The control stays off in production until the feature is complete.

export function voiceControlEnabled() {
  const explicit = import.meta.env.VITE_VOICE_CONTROL_ENABLED;
  if (explicit !== undefined && explicit !== null) return ["1", "true"].includes(String(explicit).trim());
  return import.meta.env.MODE === "development";
}
