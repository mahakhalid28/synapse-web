// Text size and high contrast for the QUIZ screen only (src/lib/displayPrefs.js). The lecture
// screen has its own, separate controls in this release. These are plain buttons, so they work
// by keyboard and speak their state: "pressed" for contrast, the current size in the name.

import { TEXT_SCALE_MAX, TEXT_SCALE_MIN } from "../lib/displayPrefs.js";

const percent = (scale) => Math.round(scale * 100);

export default function QuizDisplayControls({ textScale, highContrast, onTextSize, onToggleContrast }) {
  const atMin = textScale <= TEXT_SCALE_MIN;
  const atMax = textScale >= TEXT_SCALE_MAX;
  return (
    <div role="group" aria-label="Display settings for this practice" className="flex flex-wrap items-center gap-2 mb-6">
      <button
        type="button"
        onClick={() => { if (!atMin) onTextSize(-1); }}
        aria-disabled={atMin || undefined}
        aria-label={`Make text smaller, currently ${percent(textScale)} percent`}
        className={"ds-btn-secondary " + (atMin ? "opacity-60 cursor-not-allowed" : "")}
      >
        <span aria-hidden="true">A−</span>
      </button>
      <button
        type="button"
        onClick={() => { if (!atMax) onTextSize(1); }}
        aria-disabled={atMax || undefined}
        aria-label={`Make text larger, currently ${percent(textScale)} percent`}
        className={"ds-btn-secondary " + (atMax ? "opacity-60 cursor-not-allowed" : "")}
      >
        <span aria-hidden="true">A+</span>
      </button>
      <span className="text-[0.875em] text-text-secondary">Text size {percent(textScale)}%</span>
      <button type="button" onClick={onToggleContrast} aria-pressed={highContrast} className="ds-btn-secondary">
        High contrast
      </button>
    </div>
  );
}
