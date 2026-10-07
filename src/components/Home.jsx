import { useRef, useEffect } from "react";
import Sidebar from "./Sidebar";
import LectureResultsList from "./LectureResultsList";
import useLectureSearch from "../hooks/useLectureSearch";

const SUBJECTS = ["Mathematics", "Physics", "Computer Science", "Chemistry", "Biology"];

export default function Home({
  onProcess = () => {},
  onNavigate = () => {},
  onExploreSubject = () => {},
  focusHeadingOnMount = false,
  continueLecture = {
    title: "Eigenvectors and Eigenvalues",
    videoId: "PFDu9oVAE-g",
    conceptsExplored: 3,
    totalConcepts: 7,
  },
  defaultDepth = "standard",
}) {
  const {
    url,
    setUrl,
    results,
    setResults,
    searching,
    statusMessage,
    setStatusMessage,
    resultsHeadingRef,
    isValidUrl,
    handleSubmit,
    handleUrlChange,
  } = useLectureSearch({ onProcess, defaultDepth });

  const inputRef = useRef(null);
  const h1Ref = useRef(null);

  // Only focus the H1 when this mount is a real in-app navigation back to
  // Home (e.g. from a subject's results view) — not on the app's very first
  // load, where doing so would skip the skip link and sidebar out of tab order.
  useEffect(() => {
    if (focusHeadingOnMount) {
      h1Ref.current?.focus();
    }
  }, [focusHeadingOnMount]);

  const continuePct = continueLecture
    ? Math.round((continueLecture.conceptsExplored / continueLecture.totalConcepts) * 100)
    : 0;

  function resumeContinueLecture() {
    setStatusMessage(`Resuming ${continueLecture.title}.`);
    onProcess({
      url: `https://youtube.com/watch?v=${continueLecture.videoId}`,
      videoId: continueLecture.videoId,
      mode: defaultDepth,
      resume: true,
    });
  }

  const handleSelectResult = (video) => {
    setUrl(`https://youtube.com/watch?v=${video.videoId}`);
    setResults([]);
    setStatusMessage(`Selected ${video.title}. The Start learning button is ready.`);
    // The result button that had focus is unmounting with the list — return
    // focus to the field (press Enter or Tab to Start learning from here).
    inputRef.current?.focus();
  };

  return (
    <div className="flex h-full w-full bg-background font-sans overflow-hidden">
      <nav aria-label="Main navigation">
        <Sidebar active="home" onNavigate={onNavigate} />
      </nav>

      <main
        id="main-content"
        tabIndex={-1}
        aria-labelledby="page-title"
        className="flex-1 overflow-y-auto outline-none"
      >
        <div className="w-full max-w-[880px] mx-auto px-10 py-14">
          {/* Empty on load; only ever holds a real, meaningful update. */}
          <div aria-live="polite" aria-atomic="true" className="sr-only">
            {statusMessage}
          </div>

          <h1
            id="page-title"
            ref={h1Ref}
            tabIndex={-1}
            className="text-[32px] font-semibold text-text-primary leading-tight mb-4 outline-none rounded-radius-sm focus-ring"
          >
            Start a study session
          </h1>

          {continueLecture && (
            <button
              type="button"
              onClick={resumeContinueLecture}
              aria-label={`Continue: ${continueLecture.title}, ${continueLecture.conceptsExplored} of ${continueLecture.totalConcepts} concepts explored`}
              className="mb-8 block w-full text-left px-3.5 py-2.5 bg-surface-muted border border-border-strong/70 rounded-radius-md hover:border-accent outline-none transition-colors focus-ring"
            >
              <span aria-hidden="true" className="block text-[13px] text-text-muted mb-1">
                Continue learning
              </span>
              <span aria-hidden="true" className="block text-[14px] font-medium text-text-primary">
                {continueLecture.title}
              </span>
              <span aria-hidden="true" className="mt-2 flex items-center gap-2">
                <span className="h-1 w-20 rounded-full bg-border-subtle overflow-hidden shrink-0">
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{ width: `${continuePct}%` }}
                  />
                </span>
                <span className="text-[13px] text-text-secondary">
                  {continueLecture.conceptsExplored} of {continueLecture.totalConcepts} concepts explored
                </span>
              </span>
            </button>
          )}

          <section aria-labelledby="new-lecture-heading" className="mb-12">
            <h2 id="new-lecture-heading" className="text-[19px] font-semibold text-text-primary mb-4">
              Start a new lecture
            </h2>

            <div className="mb-6">
              <label htmlFor="lecture-input" className="block text-[13px] font-medium text-text-secondary mb-2">
                Lecture link or search
              </label>
              <div className="ds-field">
                <input
                  id="lecture-input"
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

            <LectureResultsList
              results={results}
              headingRef={resultsHeadingRef}
              onSelect={handleSelectResult}
              getAriaLabel={(r, i) => `Result ${i + 1}: ${r.title}, ${r.channel}, ${r.duration}`}
            />

            <button
              onClick={handleSubmit}
              disabled={!url.trim() || searching}
              className={"ds-btn-primary " + (!url.trim() || searching ? "opacity-40 cursor-not-allowed" : "")}
            >
              {searching ? "Searching…" : isValidUrl ? "Start learning" : "Search lectures"}
              <span className="text-sm">→</span>
            </button>
          </section>

          <section aria-labelledby="explore-heading" className="mb-12">
            <h2 id="explore-heading" className="text-[19px] font-semibold text-text-primary mb-4">
              Explore a subject
            </h2>
            <div className="flex flex-wrap gap-2">
              {SUBJECTS.map((subject) => (
                <button
                  key={subject}
                  type="button"
                  onClick={() => onExploreSubject(subject)}
                  className="ds-btn-secondary"
                >
                  {subject}
                </button>
              ))}
            </div>
          </section>

        </div>
      </main>
    </div>
  );
}
