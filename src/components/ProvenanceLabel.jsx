/**
 * ProvenanceLabel — preserves the distinction between what Synapse
 * detected/represents (facts read from the video itself) and what Synapse
 * interprets/explains (meaning added on top). This component never invents
 * that distinction: callers render it only where the underlying data
 * genuinely supports it for that section (e.g. Structured View's factual
 * rows = "video"; the Explanation's conceptual prose = "interpretation").
 * See the design-system report for exactly which sections do and don't —
 * sections without a clear factual/interpretive split don't get this label.
 *
 * Deliberately quiet: sentence case, 14px, text-muted, paired with a small
 * neutral icon — never uppercase, never large, never colored. It should
 * read as a label, not as emphasis.
 */
export default function ProvenanceLabel({ kind, className = "" }) {
  const isVideo = kind === "video";
  return (
    <div
      className={`flex items-center gap-1.5 text-[14px] text-text-muted ${className}`}
    >
      {isVideo ? <FromVideoIcon /> : <InterpretationIcon />}
      <span>{isVideo ? "From the video" : "Synapse interpretation"}</span>
    </div>
  );
}

function FromVideoIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3.5" width="12" height="9" rx="1.2" />
      <path d="M6.5 6.2 L10.5 8 L6.5 9.8 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function InterpretationIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 2.5c-2.2 0-4 1.7-4 3.9 0 1.4.7 2.5 1.7 3.2.3.2.5.6.5 1v.6h3.6v-.6c0-.4.2-.8.5-1 1-.7 1.7-1.8 1.7-3.2 0-2.2-1.8-3.9-4-3.9Z" />
      <line x1="6.2" y1="13.5" x2="9.8" y2="13.5" />
    </svg>
  );
}
