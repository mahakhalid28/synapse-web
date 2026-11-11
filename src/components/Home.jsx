import { useRef, useEffect, useMemo } from "react";
import Sidebar from "./Sidebar";
import LectureResultsList from "./LectureResultsList";
import useLectureSearch from "../hooks/useLectureSearch";
import useFocusShortcut from "../hooks/useFocusShortcut";
import { getLibrary } from "../storage";
import { useVoiceActions } from "../voice/voiceActions";

const SUBJECTS = ["Mathematics", "Physics", "Computer Science", "Chemistry", "Biology"];

// Decorative tint per subject (full class names so Tailwind generates them).
const SUBJECT_TINTS = [
  "bg-tint-1 text-tint-1-fg",
  "bg-tint-2 text-tint-2-fg",
  "bg-tint-3 text-tint-3-fg",
  "bg-tint-4 text-tint-4-fg",
  "bg-tint-5 text-tint-5-fg",
];

function SubjectIcon({ subject }) {
  const p = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", focusable: "false" };
  switch (subject) {
    case "Physics":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="2" />
          <ellipse cx="12" cy="12" rx="10" ry="4" />
          <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)" />
          <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)" />
        </svg>
      );
    case "Computer Science":
      return (
        <svg {...p} strokeWidth="2">
          <path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />
        </svg>
      );
    case "Chemistry":
      return (
        <svg {...p}>
          <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" />
          <path d="M7.5 15h9" />
        </svg>
      );
    case "Biology":
      return (
        <svg {...p}>
          <path d="M7 3c0 6 10 6 10 12M17 3c0 6-10 6-10 12M7 21c0-6 10-6 10-12M8 8h8M8 16h8" />
        </svg>
      );
    default:
      return (
        <svg {...p}>
          <path d="M4 19l4-14 4 9 4-9 4 14" />
        </svg>
      );
  }
}

export default function Home({
  onProcess = () => {},
  onNavigate = () => {},
  onExploreSubject = () => {},
  focusHeadingOnMount = false,
  continueLecture: continueLectureProp,
  defaultDepth = "standard",
}) {
  const {
    url,
    setUrl,
    setResults,
    pageResults,
    pagination,
    searching,
    searchError,
    validationError,
    submitting,
    statusMessage,
    setStatusMessage,
    resultsHeadingRef,
    isValidUrl,
    handleSubmit,
    handleUrlChange,
    selectResult,
    retrySearch,
  } = useLectureSearch({ onProcess, defaultDepth });

  const inputRef = useRef(null);
  const h1Ref = useRef(null);
  useFocusShortcut(inputRef); // Alt+S: jump to the lecture search field

  // Only focus the H1 when this mount is a real in-app navigation back to
  // Home (e.g. from a subject's results view) — not on the app's very first
  // load, where doing so would skip the skip link and sidebar out of tab order.
  useEffect(() => {
    if (focusHeadingOnMount) {
      h1Ref.current?.focus();
    }
  }, [focusHeadingOnMount]);

  // Real history only: the most recently opened explanation in the Library.
  // A first-time visitor has none, so nothing is shown — never sample data
  // posing as progress they didn't make.
  const continueLecture = useMemo(() => {
    if (continueLectureProp !== undefined) return continueLectureProp;
    const last = getLibrary().find((item) => item.videoId);
    if (!last) return null;
    return {
      title: last.videoTitle || last.title,
      videoTitle: last.videoTitle || last.title,
      videoAuthor: last.videoAuthor || "",
      videoDuration: last.videoDuration || "",
      videoThumbnail: last.videoThumbnail || "",
      videoId: last.videoId,
      lastMoment: last.title,
      timestamp: last.timestamp,
    };
  }, [continueLectureProp]);

  useVoiceActions({
    continue_lecture: () => {
      if (!continueLecture) throw new Error("nothing to continue");
      resumeContinueLecture();
    },
  });

  function resumeContinueLecture() {
    setStatusMessage(`Resuming ${continueLecture.title}.`);
    onProcess({
      url: `https://youtube.com/watch?v=${continueLecture.videoId}`,
      videoId: continueLecture.videoId,
      mode: defaultDepth,
      resume: true,
      metadata: continueLecture,
    });
  }

  const handleSelectResult = (video) => {
    selectResult(video);
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

          {/* Decorative header band (gradient). Text on it is white, >= 9:1 along
              the whole gradient; in forced-colors mode it becomes a plain
              bordered box. The heading and paragraph are unchanged. */}
          <div className="mb-7 rounded-radius-lg bg-hero border border-border-subtle px-8 py-8">
            <h1
              id="page-title"
              ref={h1Ref}
              tabIndex={-1}
              className="text-[40px] font-bold tracking-tight text-hero-fg leading-tight mb-3 outline-none rounded-radius-sm focus-ring"
            >
              Start a study session
            </h1>

            {/* Plain text, read in order — tells a first-time visitor what
                this app does before they have to find out by trial. */}
            <p className="text-[17px] text-hero-sub leading-relaxed max-w-[660px]">
              Synapse plays a YouTube lecture and pauses at diagrams, equations
              and charts to explain them. Choose a lecture below to begin, or press
              Alt plus S at any time to jump to the search field.
            </p>
          </div>

          {continueLecture && (
            <button
              type="button"
              onClick={resumeContinueLecture}
              className="ds-row mb-8 hover:border-accent"
            >
              {/* The visible text is the accessible name (so it always
                  contains what is shown); sr-only separators keep it readable. */}
              <span className="block text-[13px] text-text-muted mb-1">
                Continue learning<span className="sr-only">:</span>
              </span>
              <span className="block text-[14px] font-medium text-text-primary">
                {continueLecture.title}<span className="sr-only">.</span>
              </span>
              <span className="mt-1 block text-[13px] text-text-secondary">
                Last opened: {continueLecture.lastMoment}
                {continueLecture.timestamp ? ` at ${continueLecture.timestamp}` : ""}
              </span>
            </button>
          )}

          <section aria-labelledby="new-lecture-heading" className="mb-12">
            <h2 id="new-lecture-heading" className="text-[22px] font-bold tracking-tight text-text-primary mb-4">
              Start a new lecture
            </h2>

            <div className="mb-6">
              <label htmlFor="lecture-input" className="block text-[13px] font-medium text-text-secondary mb-2">
                Lecture link or search
              </label>
              <div className="ds-field">
                <svg aria-hidden="true" focusable="false" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-text-muted">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-4-4" />
                </svg>
                <input
                  id="lecture-input"
                  ref={inputRef}
                  type="text"
                  value={url}
                  onChange={handleUrlChange}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  placeholder="Paste a YouTube link or search for a lecture"
                  className="flex-1 min-w-0 bg-transparent text-[17px] text-text-primary placeholder:text-text-muted outline-none"
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
              results={pageResults}
              pagination={pagination}
              headingRef={resultsHeadingRef}
              onSelect={handleSelectResult}
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
          </section>

          <section aria-labelledby="explore-heading" className="mb-12">
            <h2 id="explore-heading" className="text-[22px] font-bold tracking-tight text-text-primary mb-4">
              Explore a subject
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
              {SUBJECTS.map((subject, i) => (
                <button
                  key={subject}
                  type="button"
                  onClick={() => onExploreSubject(subject)}
                  className="ds-row flex flex-col items-center gap-2.5 px-2.5 py-4 text-center text-[15px] font-semibold text-text-primary"
                >
                  {/* Decorative icon: colour is decoration only, the text label names the subject. */}
                  <span aria-hidden="true" className={`grid h-[46px] w-[46px] place-items-center rounded-radius-md ${SUBJECT_TINTS[i % SUBJECT_TINTS.length]}`}>
                    <SubjectIcon subject={subject} />
                  </span>
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
