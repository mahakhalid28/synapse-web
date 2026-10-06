/**
 * CategoryIcon — the neutral, per-type icon paired with a category's text
 * label inside a .ds-chip (design-system spec, category colors: "Display a
 * category as: [neutral icon] + text label... The icon differs per type,
 * the color does not."). Always aria-hidden — the adjacent text label is
 * what actually carries the meaning to a screen reader.
 *
 * Categories are open-ended, driven by backend data (see Timeline's own
 * dynamic-category handling) — any category outside the known set gets a
 * generic fallback icon rather than breaking or rendering nothing.
 */
export default function CategoryIcon({ category, className = "" }) {
  const props = {
    "aria-hidden": "true",
    width: 14,
    height: 14,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: `shrink-0 ${className}`,
  };

  switch (category) {
    case "equation":
      return (
        <svg {...props}>
          <path d="M3 5h10M3 11h6" />
          <path d="M11 9l2 4M13 9l-2 4" />
        </svg>
      );
    case "diagram":
      return (
        <svg {...props}>
          <circle cx="4" cy="4" r="1.5" />
          <circle cx="12" cy="4" r="1.5" />
          <circle cx="8" cy="12.5" r="1.5" />
          <path d="M5.3 5 7.3 11M10.7 5 8.7 11M5.6 4h4.8" />
        </svg>
      );
    case "chart":
      return (
        <svg {...props}>
          <path d="M2.5 13.5h11" />
          <rect x="3.3" y="9" width="2.2" height="4.3" />
          <rect x="6.9" y="6" width="2.2" height="7.3" />
          <rect x="10.5" y="3.3" width="2.2" height="10" />
        </svg>
      );
    case "graph":
      return (
        <svg {...props}>
          <path d="M2.5 13.5h11M2.5 13.5V2.5" />
          <path d="M3.5 11 7 7.3l2 2 3.5-4" />
        </svg>
      );
    case "code":
      return (
        <svg {...props}>
          <path d="M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4" />
        </svg>
      );
    default:
      return (
        <svg {...props}>
          <rect x="3" y="2.5" width="10" height="11" rx="1.2" />
          <path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" />
        </svg>
      );
  }
}
