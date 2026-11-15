// Synapse logo mark: two nodes joined by a curved link, on an indigo-to-teal tile.
// Purely decorative: aria-hidden, no text, so the visible "Synapse" wordmark next
// to it remains the only thing a screen reader announces.
export default function BrandMark({ size = 38, className = "" }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={`shrink-0 ${className}`}
    >
      <defs>
        <linearGradient id="synapse-brand-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#362cac" />
          <stop offset="1" stopColor="#064e4a" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#synapse-brand-gradient)" />
      <circle cx="9" cy="21.5" r="3.4" fill="#ffffff" />
      <circle cx="23" cy="10.5" r="3.4" fill="#ffffff" />
      <path d="M11.6 19.6C15 17.4 16.8 14.6 20.4 12.4" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" fill="none" />
    </svg>
  );
}
