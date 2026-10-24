import { useEffect, useRef } from "react";
import Sidebar from "./Sidebar";
import LectureResultsList from "./LectureResultsList";
import useLectureSearch from "../hooks/useLectureSearch";
import useFocusShortcut from "../hooks/useFocusShortcut";

// One reusable view for every subject — SubjectLectures("Mathematics"),
// SubjectLectures("Physics"), etc. all render through this same component
// instead of one page per subject.
export default function SubjectLectures({
  subject,
  onProcess = () => {},
  onNavigate = () => {},
  defaultDepth = "standard",
}) {
  const {
    url,
    results,
    searching,
    searchError,
    validationError,
    submitting,
    statusMessage,
    resultsHeadingRef,
    isValidUrl,
    runSearch,
    retrySearch,
    handleSubmit,
    handleUrlChange,
    selectResult,
  } = useLectureSearch({ onProcess, defaultDepth, initialQuery: subject });

  const h1Ref = useRef(null);
  const inputRef = useRef(null);
  useFocusShortcut(inputRef); // Alt+S: jump to the search field
  const inputId = "subject-lecture-input";

  // Load results relevant to the subject immediately, before the user types
  // anything — refining is then just editing this same field and searching again.
  useEffect(() => {
    runSearch(subject);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject]);

  // This is an in-app view switch, not a full page navigation, so move focus
  // to the new H1 on mount — screen readers announce "<subject> lectures"
  // immediately, the same way the results heading gets focus once loaded.
  useEffect(() => {
    h1Ref.current?.focus();
  }, []);

  return (
    <div className="flex h-full w-full bg-background font-sans overflow-hidden">
      <nav aria-label="Main navigation">
        <Sidebar active="home" onNavigate={onNavigate} />
      </nav>

      <main
        id="main-content"
        tabIndex={-1}
        aria-labelledby="subject-page-title"
        className="flex-1 overflow-y-auto outline-none"
      >
        <div className="w-full max-w-[880px] mx-auto px-10 py-14">
          {/* Empty on load; only ever holds a real, meaningful update. */}
          <div aria-live="polite" aria-atomic="true" className="sr-only">
            {statusMessage}
          </div>

          <h1
            id="subject-page-title"
            ref={h1Ref}
            tabIndex={-1}
            className="text-[32px] font-semibold text-text-primary leading-tight mb-10 outline-none rounded-radius-sm focus-ring"
          >
            {subject} lectures
          </h1>

          <div className="mb-6">
            <label htmlFor={inputId} className="block text-[13px] font-medium text-text-secondary mb-2">
              {`Search ${subject} lectures`}
            </label>
            <div className="ds-field">
              <input
                id={inputId}
                ref={inputRef}
                type="text"
                value={url}
                onChange={handleUrlChange}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                placeholder="Paste a YouTube link or search for a lecture"
                className="flex-1 bg-transparent font-mono text-[13px] text-text-primary placeholder:text-text-muted outline-none"
                spellCheck={false}
              />
              {isValidUrl && (
                <span className="text-[13px] font-medium text-accent shrink-0">
                  YouTube lecture detected
                </span>
              )}
            </div>
          </div>

          {(validationError || searchError) && (
            <div
              role="alert"
              className="mb-6 p-4 bg-surface border border-red-500/40 rounded-radius-md flex items-center justify-between gap-4"
            >
              <span className="text-[14px] text-text-primary">
                {validationError || searchError}
              </span>
              {searchError && (
                <button
                  type="button"
                  onClick={retrySearch}
                  className="ds-btn-secondary text-[13px] shrink-0"
                >
                  Retry
                </button>
              )}
            </div>
          )}

          <LectureResultsList
            results={results}
            headingRef={resultsHeadingRef}
            heading="Search results"
            headingLevel="h2"
            onSelect={selectResult}
            getAriaLabel={(r) => `Start learning: ${r.title}, ${r.channel || r.channel_name}, ${r.duration}`}
            showAction
            disabled={submitting || searching}
          />

          <button
            onClick={handleSubmit}
            disabled={!url.trim() || searching || submitting}
            className={"ds-btn-primary " + (!url.trim() || searching || submitting ? "opacity-40 cursor-not-allowed" : "")}
          >
            {submitting ? "Starting…" : searching ? "Searching…" : isValidUrl ? "Start learning" : "Search lectures"}
            <span className="text-sm">→</span>
          </button>
        </div>
      </main>
    </div>
  );
}
