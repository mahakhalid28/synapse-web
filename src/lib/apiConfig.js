export const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";

export function normalizeApiBaseUrl(value) {
  const configured = typeof value === "string" ? value.trim() : "";
  return (configured || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

export function isEnabled(value) {
  return ["1", "true"].includes(String(value ?? "").trim().toLowerCase());
}

export const API_BASE_URL = normalizeApiBaseUrl(
  import.meta.env.VITE_API_BASE_URL,
);

// Mock behavior is opt-in. An unset, empty, or unrecognized value always uses
// the real backend so integration failures cannot be hidden by sample data.
export const API_MOCK_MODE = isEnabled(import.meta.env.VITE_API_MOCK_MODE);

export function apiUrl(path) {
  return `${API_BASE_URL}/${String(path).replace(/^\/+/, "")}`;
}
