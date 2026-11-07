import { isEnabled } from "./apiConfig";

// Temporary, frontend-only demonstration data copied from the original
// MOCK_INTERVENTIONS vector-field example. It is never merged into API data.
export const STRUCTURED_VIEW_DEMO_ENABLED = isEnabled(
  import.meta.env.VITE_STRUCTURED_VIEW_DEMO,
);

export const STRUCTURED_VIEW_DEMO_LABEL =
  "Demo data — example only, not extracted from this video";

export const STRUCTURED_VIEW_DEMO_ROWS = Object.freeze([
  {
    label: "Arrow direction",
    value: "Shows which way a particle would be pushed at that point",
  },
  {
    label: "Arrow length",
    value: "Represents the relative strength of the field at that point",
  },
  {
    label: "Central region",
    value: "Arrows curve around it rather than passing straight through",
  },
]);

export function resolveStructuredView(point, demoEnabled = STRUCTURED_VIEW_DEMO_ENABLED) {
  const realRows = point?.structured?.rows;
  if (Array.isArray(realRows)) {
    return { rows: realRows, isDemo: false };
  }
  if (!demoEnabled) return null;
  return { rows: STRUCTURED_VIEW_DEMO_ROWS, isDemo: true };
}
