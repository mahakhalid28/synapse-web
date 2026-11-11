// Shared result-row presentation for every lecture search surface (Home's
// inline search, subject-scoped views). The action wired to each row differs
// per caller via `onSelect` and `getAriaLabel`; the markup and accessible structure stay identical.
//
// `results` is the CURRENT PAGE only. `pagination` ({ page, totalPages, total,
// offset, onPrev, onNext }) is optional; without it the list renders as before.
import { pageSummary, resultAriaLabel } from "../lib/searchRanking";

export default function LectureResultsList({
  results,
  headingRef,
  heading = "Search results",
  headingLevel = "h3",
  onSelect,
  getAriaLabel,
  showAction = false,
  disabled = false,
  pagination = null,
}) {
  if (!results || results.length === 0) return null;

  const HeadingTag = headingLevel;
  const offset = pagination?.offset ?? 0;
  const total = pagination?.total ?? results.length;
  const paged = Boolean(pagination) && pagination.totalPages > 1;

  return (
    <div className="mb-6">
      <HeadingTag
        id="results-heading"
        ref={headingRef}
        tabIndex={-1}
        className="text-[19px] font-bold tracking-tight text-text-primary mb-3 rounded-radius-sm outline-none focus-ring"
      >
        {heading}
      </HeadingTag>
      <ul className="space-y-3">
        {results.map((r, i) => {
          const thumb = r.thumbnailUrl || r.thumbnail_url;
          return (
            <li key={r.videoId || r.video_id || i}>
              <button
                type="button"
                onClick={() => onSelect(r)}
                disabled={disabled}
                aria-label={getAriaLabel ? getAriaLabel(r, i) : resultAriaLabel(r, offset + i + 1, total)}
                className={`ds-row outline-none flex items-center gap-4 w-full text-left !p-3.5 transition-colors ${
                  disabled ? "opacity-50 cursor-not-allowed" : "hover:border-accent"
                }`}
              >
                {thumb && (
                  <div className="w-[120px] sm:w-[168px] shrink-0 aspect-video rounded-radius-md overflow-hidden bg-surface-muted relative border border-border-subtle">
                    <img
                      src={thumb}
                      alt=""
                      aria-hidden="true"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                    <div className="absolute bottom-1.5 right-1.5 tabular-nums text-[12px] font-semibold bg-black/80 text-white px-2 py-0.5 rounded-md">
                      {r.duration}
                    </div>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <span aria-hidden="true" className="block text-[18px] font-bold leading-snug text-text-primary line-clamp-2">
                    {r.title}
                  </span>
                  <span aria-hidden="true" className="block text-[15px] text-text-secondary mt-0.5">
                    {r.channel || r.channel_name} · {r.duration}
                  </span>
                  {showAction && (
                    <span aria-hidden="true" className="inline-flex items-center gap-1 text-[15px] font-bold text-accent mt-2">
                      Start learning <span aria-hidden="true">→</span>
                    </span>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      {paged && (
        <nav aria-label="Search results pages" className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={pagination.onPrev}
            disabled={disabled || pagination.page <= 1}
            className="ds-btn-secondary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span aria-hidden="true">←</span> Previous results
          </button>
          <button
            type="button"
            onClick={pagination.onNext}
            disabled={disabled || pagination.page >= pagination.totalPages}
            className="ds-btn-secondary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next results <span aria-hidden="true">→</span>
          </button>
          <span className="text-[13px] text-text-secondary">
            {pageSummary(pagination.page, total)} Page {pagination.page} of {pagination.totalPages}.
          </span>
        </nav>
      )}
    </div>
  );
}
