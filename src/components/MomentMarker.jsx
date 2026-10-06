/**
 * MomentMarker — Synapse's one shared glyph for the recurring pattern:
 * lecture -> moment -> understanding -> resume. A small diamond with a
 * short stem below it, not a plain dot, so the *shape* carries the
 * "this is a detected moment" meaning rather than relying on color.
 *
 * Always aria-hidden: the adjacent text (e.g. "01:32 · Graph detected")
 * is what actually gets announced — this is decoration, not information.
 *
 * Neutral (currentColor) by default. The current/active moment is marked
 * by giving it accent color via className (e.g. "text-accent"), not by a
 * different glyph or a colorful badge — see the design-system spec.
 *
 * Used in: Timeline (active moment), the Study Mode intervention header,
 * the Accessibility Mode moment header.
 */
export default function MomentMarker({ className = "" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 20"
      width="14"
      height="17"
      className={className}
      fill="none"
    >
      <path
        d="M8 1.5 L14 8 L8 14.5 L2 8 Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <line
        x1="8"
        y1="14.5"
        x2="8"
        y2="18.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
