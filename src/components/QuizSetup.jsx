// Setup: resume or start, choose Practice or Assessment and how many questions, generate.
//
// Nothing saved is touched until the new questions have arrived and validated. If an unfinished
// attempt exists, "Start a new set" asks first, with the SAFE choice focused, and says the old
// attempt is kept and set aside (never deleted).

import { useId, useState } from "react";
import { DEFAULT_QUESTION_COUNT, isValidQuestionCount } from "../lib/quizApi.js";
import { MIN_QUESTION_COUNT, MAX_QUESTION_COUNT } from "../lib/quizSchema.js";
import { progressSummary } from "../lib/quizScoring.js";
import { AI_NOTICE, ASSESSMENT_NOTE, MODE_HELP, MODE_LABELS, plural } from "../lib/quizText.js";

const COUNTS = Array.from({ length: MAX_QUESTION_COUNT - MIN_QUESTION_COUNT + 1 }, (_, i) => MIN_QUESTION_COUNT + i);

export default function QuizSetup({ session }) {
  const uid = useId();
  const { resume, earlier, storageProblem, gen, pending, banner } = session;
  const [mode, setMode] = useState("practice");
  const [count, setCount] = useState(DEFAULT_QUESTION_COUNT);
  const [confirmNew, setConfirmNew] = useState(false);
  const [wantsNew, setWantsNew] = useState(false);
  const [countError, setCountError] = useState("");

  const hasResume = resume.state === "ready";
  const showForm = !hasResume || wantsNew;
  const progress = hasResume ? progressSummary(resume.quiz, resume.attempt) : null;
  const canStart = !gen.busy && !storageProblem && !pending;

  const start = () => {
    if (!canStart) return;
    if (!isValidQuestionCount(count)) {
      setCountError(`Please choose between ${MIN_QUESTION_COUNT} and ${MAX_QUESTION_COUNT} questions.`);
      return;
    }
    setCountError("");
    void session.generate({ mode, count });
  };

  return (
    <section aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`} className="text-[1.5em] font-semibold text-text-primary mb-3">Set up your practice</h2>
      <p className="text-text-secondary mb-5">
        Practice questions are made from this lecture&apos;s captions. They are for self-study, and your answers stay on this computer.
      </p>

      {banner && (
        <div role="alert" className="quiz-box mb-5 p-4 rounded-radius-md border border-warning bg-warning-soft text-text-primary">
          <p className="m-0">{banner}</p>
          <button type="button" onClick={session.dismissBanner} className="ds-btn-secondary mt-2">Dismiss</button>
        </div>
      )}

      {storageProblem && (
        <div role="alert" className="quiz-box mb-5 p-4 rounded-radius-md border border-error bg-error-soft text-text-primary">
          <p className="m-0"><span className="font-semibold">Error: </span>{storageProblem}</p>
          <p className="m-0 mt-1 text-[0.875em]">Practice can&apos;t be saved here, and unsaved practice is not offered.</p>
        </div>
      )}

      {resume.state === "unreadable" && (
        <div role="note" className="quiz-box mb-5 p-4 rounded-radius-md border border-border-strong bg-surface text-text-primary">
          <p className="m-0">
            {resume.reason === "unsupported_version"
              ? "A saved practice for this lecture was made by a newer version of Synapse, so it can't be continued. It has been left as it is."
              : "A saved practice for this lecture could not be read, so it can't be continued. It has been left as it is."}
            {" "}Starting a new set will not change it.
          </p>
        </div>
      )}

      {hasResume && (
        <div className="quiz-box mb-6 p-4 rounded-radius-md border border-border-strong bg-surface">
          <h3 className="m-0 mb-1 text-[1.125em] font-semibold text-text-primary">Continue where you left off</h3>
          <p className="m-0 mb-3 text-text-primary">
            {`${MODE_LABELS[resume.attempt.quizMode]}: ${progress.selected} of ${progress.total} questions answered`}
            {progress.flagged > 0 ? `, ${plural(progress.flagged, "question")} flagged` : ""}.
          </p>
          {!confirmNew && !wantsNew && (
            <div className="flex flex-wrap gap-2">
              <button type="button" data-focus="start" onClick={session.continueAttempt} className="ds-btn-primary">Continue</button>
              <button type="button" onClick={() => { setConfirmNew(true); session.requestFocus("confirm-safe"); }} className="ds-btn-secondary">
                Start a new set
              </button>
            </div>
          )}
          {confirmNew && !wantsNew && (
            <div role="group" aria-labelledby={`${uid}-confirm`}>
              <p id={`${uid}-confirm`} className="m-0 mb-3 font-medium text-text-primary">
                {`Your unfinished practice (${progress.selected} of ${progress.total} answered) will be kept and set aside. Start a new set?`}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button" data-focus="confirm-safe" className="ds-btn-primary"
                  onClick={() => { setConfirmNew(false); session.requestFocus("start"); }}
                >
                  Keep my practice
                </button>
                <button
                  type="button" className="ds-btn-secondary"
                  onClick={() => { setConfirmNew(false); setWantsNew(true); session.requestFocus("mode"); }}
                >
                  Yes, start a new set
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showForm && (
        <form onSubmit={(e) => { e.preventDefault(); start(); }} noValidate>
          <fieldset className="m-0 mb-5 p-0 border-0">
            <legend className="mb-2 font-semibold text-text-primary">Mode</legend>
            {["practice", "assessment"].map((value) => (
              <div key={value} className="mb-2">
                <label className="flex items-start gap-3 cursor-pointer min-h-[44px] py-2">
                  <input
                    type="radio" name={`${uid}-mode`} value={value} checked={mode === value}
                    data-focus={value === "practice" ? "mode" : undefined}
                    aria-describedby={`${uid}-${value}-help`}
                    onChange={() => setMode(value)}
                    className="mt-1.5 w-5 h-5 shrink-0 accent-[rgb(var(--accent))] focus-ring"
                  />
                  <span className="min-w-0 font-medium text-text-primary">{MODE_LABELS[value]}</span>
                </label>
                <p id={`${uid}-${value}-help`} className="m-0 ml-8 text-[0.875em] text-text-secondary">{MODE_HELP[value]}</p>
              </div>
            ))}
          </fieldset>
          {mode === "assessment" && <p className="mb-5 text-text-primary">{ASSESSMENT_NOTE}</p>}

          <div className="mb-5">
            <label htmlFor={`${uid}-count`} className="block mb-1 font-semibold text-text-primary">Number of questions</label>
            <select
              id={`${uid}-count`} value={count} onChange={(e) => setCount(Number(e.target.value))}
              aria-describedby={`${uid}-count-help`} aria-invalid={countError ? true : undefined}
              className="min-h-[44px] px-3 py-2 text-[1em] bg-surface border border-border-strong rounded-radius-sm text-text-primary focus-ring"
            >
              {COUNTS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <p id={`${uid}-count-help`} className="m-0 mt-1 text-[0.875em] text-text-secondary">
              Between {MIN_QUESTION_COUNT} and {MAX_QUESTION_COUNT}. Fewer may be made if the lecture doesn&apos;t support more.
            </p>
            {countError && <p role="alert" className="m-0 mt-1 text-text-primary"><span className="font-semibold">Error: </span>{countError}</p>}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit" data-focus="start" aria-busy={gen.busy || undefined} aria-disabled={!canStart || undefined}
              className={"ds-btn-primary " + (canStart ? "" : "opacity-60 cursor-not-allowed")}
            >
              {gen.busy && <span aria-hidden="true" className="inline-block w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />}
              {gen.busy ? "Creating questions…" : "Create questions"}
            </button>
            {gen.busy && (
              <button type="button" onClick={session.cancelGeneration} className="ds-btn-secondary">Cancel</button>
            )}
          </div>
          {gen.busy && (
            <p className="mt-3 text-text-secondary">Creating your questions. This can take up to a minute. You can cancel.</p>
          )}
        </form>
      )}

      <div role="alert" className="mt-4">
        {gen.error && (
          <div className="quiz-box p-4 rounded-radius-md border border-error bg-error-soft text-text-primary">
            <p className="m-0"><span className="font-semibold">Error: </span>{gen.error.message}</p>
            {gen.error.retryable && (
              <button type="button" onClick={start} className="ds-btn-secondary mt-2">Try again</button>
            )}
          </div>
        )}
      </div>

      {pending && (
        <div role="alert" className="quiz-box mt-4 p-4 rounded-radius-md border border-error bg-error-soft text-text-primary">
          <p className="m-0"><span className="font-semibold">Error: </span>The new questions were made but could not be saved. {pending.message}</p>
          <p className="m-0 mt-1 text-[0.875em]">
            {resume.state === "ready" ? "Your earlier practice is still saved and has not changed." : "Nothing was changed."}
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            <button type="button" data-focus="start" onClick={session.retrySave} className="ds-btn-secondary">Try saving again</button>
            <button type="button" onClick={session.discardPending} className="ds-btn-secondary">Discard the new set</button>
          </div>
        </div>
      )}

      {earlier > 0 && (
        <p className="mt-6 text-[0.875em] text-text-secondary">
          {plural(earlier, "earlier practice")} saved on this computer.
        </p>
      )}
      <p className="mt-4 text-[0.875em] text-text-secondary">{AI_NOTICE}</p>
    </section>
  );
}
