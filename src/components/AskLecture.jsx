import { useEffect, useId, useRef, useState } from "react";
import {
  askQuestion,
  formatTimestamp,
  isValidVideoId,
  AskError,
  ERROR_MESSAGES,
  MAX_QUESTION_LENGTH,
} from "../lib/askApi";

const HEADINGS = {
  answered: "Answer",
  insufficient_context: "I couldn't find that",
  not_in_lecture: "Not covered in this lecture",
};

function sourceTimeLabel(src) {
  const start = formatTimestamp(src.start_seconds);
  const end = formatTimestamp(Math.ceil(src.end_seconds));
  return start === end ? start : `${start} to ${end}`;
}

/**
 * "Ask a question about this lecture" — lecture-wide Q&A against POST /video/ask.
 *
 * Props:
 *   videoId               YouTube id of the lecture. Changing it resets everything.
 *   getCurrentTime()      current playback position in seconds (may return
 *                         nothing/NaN if the player can't report it yet)
 *   activeInterventionId  id of the moment the student has selected or paused
 *                         on, or null. Only real (UUID) ids are ever sent.
 *   onSeek(seconds)       jump the player to a time
 *   onSelectMoment(id)    optional; open a known moment (used instead of onSeek
 *                         for sources that carry an intervention_id)
 *   knownMomentIds        optional array of loaded moment ids, so a source is
 *                         only treated as "the moment" if it can be opened
 */
export default function AskLecture(props) {
  // Keyed on the video so a different lecture starts clean (no stale answer,
  // aborted request).
  return <AskLectureInner key={props.videoId} {...props} />;
}

function AskLectureInner({
  videoId,
  getCurrentTime,
  activeInterventionId = null,
  onSeek,
  onSelectMoment,
  knownMomentIds = [],
}) {
  const uid = useId();
  const panelId = `${uid}-panel`;
  const inputId = `${uid}-input`;
  const countId = `${uid}-count`;

  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null); // { message, retryable }

  const abortRef = useRef(null);
  const busyRef = useRef(false);
  const requestIdRef = useRef(0);
  const headingRef = useRef(null);
  const focusPendingRef = useRef(false);

  // Abort anything still running when the component goes away (including a
  // video change, which remounts it).
  useEffect(() => () => abortRef.current?.abort(), []);

  // Focus moves to the result heading only after a submitted question has
  // produced a result — never on open, never on re-render.
  useEffect(() => {
    if (result && focusPendingRef.current) {
      focusPendingRef.current = false;
      headingRef.current?.focus();
    }
  }, [result]);

  const trimmedLength = question.trim().length;
  const tooLong = trimmedLength > MAX_QUESTION_LENGTH;
  const canSubmit = trimmedLength > 0 && !tooLong && !busy;
  const remaining = MAX_QUESTION_LENGTH - question.length;

  const submit = async () => {
    if (busyRef.current) return; // double submit
    if (trimmedLength === 0) {
      setError({ message: "Please type a question first.", retryable: false });
      return;
    }
    if (tooLong || !isValidVideoId(videoId)) {
      setError({ message: ERROR_MESSAGES.invalid, retryable: false });
      return;
    }

    abortRef.current?.abort(); // defensive: never leave an older request alive
    const controller = new AbortController();
    abortRef.current = controller;
    const myId = ++requestIdRef.current;

    busyRef.current = true;
    setBusy(true);
    setError(null);
    setResult(null);

    let time;
    try {
      time = Number(getCurrentTime?.());
    } catch {
      time = NaN;
    }

    try {
      const answer = await askQuestion({
        videoId,
        question,
        currentTimeSeconds: Number.isFinite(time) ? time : undefined,
        interventionId: activeInterventionId,
        signal: controller.signal,
      });
      if (myId !== requestIdRef.current) return;
      focusPendingRef.current = true;
      setResult(answer);
    } catch (err) {
      if (myId !== requestIdRef.current || err?.name === "AbortError") return;
      const e = err instanceof AskError ? err : new AskError("server");
      setError({ message: e.message, retryable: e.retryable });
    } finally {
      if (myId === requestIdRef.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };

  const onFormSubmit = (e) => {
    e.preventDefault();
    submit();
  };

  const jumpTo = (src) => {
    const id = src.intervention_id;
    if (id && knownMomentIds.includes(id) && onSelectMoment) {
      onSelectMoment(id);
    } else {
      onSeek?.(src.start_seconds);
    }
  };

  return (
    <div className="mt-7 pt-5 border-t border-border-subtle font-sans">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="ds-btn-text"
      >
        {open ? "− Hide question box" : "+ Ask a question about this lecture"}
      </button>

      <div id={panelId} hidden={!open} className="mt-4">
        <form onSubmit={onFormSubmit} noValidate>
          <label
            htmlFor={inputId}
            className="block text-[14px] font-medium text-text-primary mb-1.5"
          >
            Your question about this lecture
          </label>
          <div className="flex gap-2">
            <input
              id={inputId}
              type="text"
              value={question}
              maxLength={MAX_QUESTION_LENGTH}
              onChange={(e) => setQuestion(e.target.value)}
              aria-describedby={countId}
              aria-invalid={tooLong || undefined}
              autoComplete="off"
              className="flex-1 min-w-0 min-h-[44px] px-3 py-2 text-[16px] bg-surface border border-border-strong rounded-radius-sm text-text-primary focus-ring"
            />
            <button
              type="submit"
              aria-disabled={!canSubmit || undefined}
              aria-busy={busy || undefined}
              className={
                "ds-btn-secondary shrink-0 " +
                (busy || !canSubmit ? "opacity-60 cursor-not-allowed" : "")
              }
            >
              {busy && (
                <span
                  aria-hidden="true"
                  className="inline-block w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin"
                />
              )}
              Ask
            </button>
          </div>
          <p id={countId} className="mt-1.5 text-[14px] text-text-secondary">
            {tooLong
              ? `${-remaining} characters too many. The limit is ${MAX_QUESTION_LENGTH}.`
              : `${question.length} of ${MAX_QUESTION_LENGTH} characters`}
          </p>
        </form>

        {/* Loading message — a separate, always-mounted polite region so the
            announcement is reliable; emptied again as soon as the request ends. */}
        <div role="status" aria-live="polite" className="sr-only">
          {busy ? "Looking for the answer..." : ""}
        </div>
        {busy && (
          <p aria-hidden="true" className="mt-3 text-[14px] text-text-secondary">
            Looking for the answer...
          </p>
        )}

        {/* Errors: a role="alert" region that stays mounted so a message
            added later is announced. */}
        <div role="alert" className="mt-3">
          {error && (
            <div className="p-3 rounded-radius-md border border-error bg-error-soft text-text-primary text-[14px] leading-[1.6]">
              <p className="m-0">
                <span className="font-semibold">Error: </span>
                {error.message}
              </p>
              {error.retryable && (
                <button
                  type="button"
                  onClick={submit}
                  className="ds-btn-secondary mt-2"
                >
                  Try again
                </button>
              )}
            </div>
          )}
        </div>

        {/* Result: one polite live region, plus focus moved to its heading
            after a submitted question. Plain text only — never HTML. */}
        <div aria-live="polite" className="mt-3">
          {result && (
            <section
              aria-labelledby={`${uid}-result-heading`}
              className={
                "p-4 rounded-radius-md text-text-primary " +
                (result.status === "answered"
                  ? "bg-surface-muted border border-border-subtle"
                  : "bg-surface border-2 border-dashed border-border-strong")
              }
            >
              <h3
                id={`${uid}-result-heading`}
                ref={headingRef}
                tabIndex={-1}
                className="m-0 mb-2 text-[16px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary focus-visible:outline-offset-2"
              >
                {HEADINGS[result.status]}
              </h3>
              <p className="m-0 text-[15px] leading-[1.65] whitespace-pre-wrap">
                {result.answer_text}
              </p>

              {result.status === "answered" && result.sources.length > 0 && (
                <>
                  <h4 className="mt-4 mb-2 text-[14px] font-semibold">
                    Where in the lecture
                  </h4>
                  <ul className="list-none m-0 p-0 flex flex-col gap-2">
                    {result.sources.map((src, i) => {
                      const isMoment =
                        Boolean(src.intervention_id) &&
                        knownMomentIds.includes(src.intervention_id) &&
                        Boolean(onSelectMoment);
                      return (
                        <li key={i}>
                          <button
                            type="button"
                            onClick={() => jumpTo(src)}
                            className="ds-btn-secondary"
                          >
                            {isMoment
                              ? "Jump to the moment you were viewing"
                              : `Jump to ${sourceTimeLabel(src)}`}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
