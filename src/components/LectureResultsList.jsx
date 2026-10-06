// Shared result-row presentation for every lecture search surface (Home's
// inline search, subject-scoped views). The action wired to each row differs
// per caller (fill the field vs. start learning immediately) via `onSelect`
// and `getAriaLabel`; the markup and accessible structure stay identical.
export default function LectureResultsList({
  results,
  headingRef,
  heading = "Search results",
  headingLevel = "h3",
  onSelect,
  getAriaLabel,
  showAction = false,
}) {
  if (results.length === 0) return null;

  const HeadingTag = headingLevel;

  return (
    <section aria-labelledby="results-heading" className="mb-6">
      <HeadingTag
        id="results-heading"
        ref={headingRef}
        tabIndex={-1}
        className="text-[15px] font-semibold text-text-primary mb-3 rounded-radius-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary focus-visible:outline-offset-2"
      >
        {heading}
      </HeadingTag>
      <ul className="space-y-2">
        {results.map((r, i) => (
          <li key={r.videoId}>
            <button
              type="button"
              onClick={() => onSelect(r)}
              aria-label={getAriaLabel(r, i)}
              className="ds-row outline-none"
            >
              <span aria-hidden="true" className="block text-[14px] font-medium text-text-primary">
                {r.title}
              </span>
              <span aria-hidden="true" className="block text-[13px] text-text-secondary mt-0.5">
                {r.channel} · {r.duration}
              </span>
              {showAction && (
                <span aria-hidden="true" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-primary mt-2">
                  Start learning <span aria-hidden="true">→</span>
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
