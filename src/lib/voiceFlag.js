// Front-end feature flag for voice control (docs/voice-control.md).
//
// An EXPLICIT VITE_VOICE_CONTROL_ENABLED decides: on only when it is exactly "1" or "true" (surrounding
// whitespace ignored); anything else is off.
//
// When unset, voice control is available in development and production. Tests opt in explicitly.

export function voiceControlEnabled() {
  const explicit = import.meta.env.VITE_VOICE_CONTROL_ENABLED;
  if (explicit !== undefined && explicit !== null) return ["1", "true"].includes(String(explicit).trim());
  return import.meta.env.MODE !== "test";
}
