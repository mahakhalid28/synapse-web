// Shared result-row presentation for every lecture search surface (Home's
// inline search, subject-scoped views). The action wired to each row differs
// per caller via `onSelect` and `getAriaLabel`; the markup and accessible structure stay identical.
export default function LectureResultsList({
  results,
  headingRef,
  heading = "Search results",
  headingLevel = "h3",
  onSelect,
  getAriaLabel,
  showAction = false,
  disabled = false,
}) {
  if (!results || results.length === 0) return null;

  const HeadingTag = headingLevel;

  return (
    <div className="mb-6">
      <HeadingTag
        id="results-heading"
        ref={headingRef}
        tabIndex={-1}
        className="text-[15px] font-semibold text-text-primary mb-3 rounded-radius-sm outline-none focus-ring"
      >
        {heading}
      </HeadingTag>
      <ul className="space-y-2">
        {results.map((r, i) => {
          const thumb = r.thumbnailUrl || r.thumbnail_url;
          return (
            <li key={r.videoId || r.video_id || i}>
              <button
                type="button"
                onClick={() => onSelect(r)}
                disabled={disabled}
                aria-label={getAriaLabel ? getAriaLabel(r, i) : `Start learning: ${r.title}, ${r.channel || r.channel_name}, ${r.duration}`}
                className={`ds-row outline-none flex items-start gap-3 w-full text-left transition-colors ${
                  disabled ? "opacity-50 cursor-not-allowed" : "hover:border-accent"
                }`}
              >
                {thumb && (
                  <div className="w-[100px] sm:w-[120px] shrink-0 aspect-video rounded-radius-sm overflow-hidden bg-surface-muted relative border border-border-subtle">
                    <img
                      src={thumb}
                      alt=""
                      aria-hidden="true"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                    <div className="absolute bottom-1 right-1 font-mono tabular-nums text-[11px] bg-black/75 text-white px-1 py-0.5 rounded-xs">
                      {r.duration}
                    </div>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <span aria-hidden="true" className="block text-[14px] font-medium text-text-primary line-clamp-2">
                    {r.title}
                  </span>
                  <span aria-hidden="true" className="block text-[13px] text-text-secondary mt-0.5">
                    {r.channel || r.channel_name} · {r.duration}
                  </span>
                  {showAction && (
                    <span aria-hidden="true" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent mt-2">
                      Start learning <span aria-hidden="true">→</span>
                    </span>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
