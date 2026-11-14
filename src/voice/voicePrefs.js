// Stored voice preferences that change how Synapse talks and listens. Each is on unless set to "off".
// Storage can be unavailable (private window, blocked site data); then the default applies.

export const AUTO_LISTEN_KEY = "synapse_voice_autolisten";

function isOn(key) {
  try {
    return localStorage.getItem(key) !== "off";
  } catch {
    return true;
  }
}

/** After Synapse asks a question (yes or no, which one, an explanation choice), listen without a key press. */
export function autoListenEnabled() {
  return isOn(AUTO_LISTEN_KEY);
}
