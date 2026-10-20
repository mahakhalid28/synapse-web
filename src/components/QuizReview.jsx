// Review before finishing: unanswered and flagged questions, then submit.
//
// Assessment always asks before submitting (answers can't be changed afterwards). Practice asks only
// when some questions have not been checked, because those count as unanswered. The confirmation is
// inline, with the SAFE choice ("Go back") focused first; closing it returns focus to the button
// that opened it.

import { useId, useState } from "react";
import { countAnswered, countFlagged, countUnchecked, plural, questionState } from "../lib/quizText.js";

export default function QuizReview({ session, work }) {
  const uid = useId();
  const { quiz, mode, responses, currentIndex } = work;
  const [confirming, setConfirming] = useState(false);
  const practice = mode === "practice";
  const total = quiz.questions.length;

  const entries = quiz.questions.map((q, i) => ({ q, i, r: responses[q.id] }));
  const unanswered = entries.filter(({ r }) => r.choiceId === null);
  const flagged = entries.filter(({ r }) => r.flagged);
  const unchecked = practice ? countUnchecked(quiz, responses) : 0;
  const needsConfirm = !practice || unchecked > 0;
  const finishLabel = practice ? "Finish practice" : "Submit answers";

  const open = () => {
    if (!needsConfirm) { void session.submitAttempt(); return; }
    setConfirming(true);
    session.requestFocus("goback");
  };
  const close = () => { setConfirming(false); session.requestFocus("finish"); };

  const warning = practice
    ? `${plural(unchecked, "question")} ${unchecked === 1 ? "has" : "have"} not been checked and will count as unanswered.`
    : unanswered.length > 0
      ? `You have ${plural(unanswered.length, "unanswered question")}. They will count as unanswered, and you can't change any answer after submitting.`
      : "You can't change any answer after submitting.";

  const link = ({ i, r }, extra) => (
    <li key={i}>
      <button type="button" onClick={() => session.goTo(i)} className="ds-btn-secondary">
        {`Go to question ${i + 1}, ${questionState(mode, r)}${extra ?? ""}`}
      </button>
    </li>
  );

  return (
    <section aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`} tabIndex={-1} data-focus="review-heading" className="text-[1.5em] font-semibold text-text-primary mb-2 outline-none focus-ring">
        Review your answers
      </h2>
      <p className="mb-5 text-text-primary">
        {`${countAnswered(responses)} of ${total} answered, ${countFlagged(responses)} flagged for review.`}
        {practice ? ` ${total - unchecked} of ${total} checked.` : ""}
      </p>

      <h3 className="m-0 mb-2 text-[1.125em] font-semibold text-text-primary">{`Not answered (${unanswered.length})`}</h3>
      {unanswered.length === 0 ? (
        <p className="mb-5 text-text-secondary">Every question has an answer.</p>
      ) : (
        <ul className="list-none m-0 mb-5 p-0 flex flex-wrap gap-2">{unanswered.map((e) => link(e))}</ul>
      )}

      <h3 className="m-0 mb-2 text-[1.125em] font-semibold text-text-primary">{`Flagged for review (${flagged.length})`}</h3>
      {flagged.length === 0 ? (
        <p className="mb-5 text-text-secondary">No questions are flagged.</p>
      ) : (
        <ul className="list-none m-0 mb-5 p-0 flex flex-wrap gap-2">{flagged.map((e) => link(e, ", flagged for review"))}</ul>
      )}

      {session.submit.error && (
        <div role="alert" className="quiz-box mb-4 p-4 rounded-radius-md border border-error bg-error-soft text-text-primary">
          <span className="font-semibold">Error: </span>{session.submit.error} Your answers are still on this screen. Try again.
        </div>
      )}

      {confirming ? (
        <div role="group" aria-labelledby={`${uid}-confirm`} className="quiz-box p-4 rounded-radius-md border-2 border-border-strong bg-surface">
          <h3 id={`${uid}-confirm`} className="m-0 mb-1 text-[1.125em] font-semibold text-text-primary">
            {practice ? "Finish this practice?" : "Submit your answers?"}
          </h3>
          <p className="m-0 mb-3 text-text-primary">{warning}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" data-focus="goback" onClick={close} className="ds-btn-primary">Go back</button>
            <button
              type="button" onClick={() => void session.submitAttempt()} aria-busy={session.submit.busy || undefined}
              aria-disabled={session.submit.busy || undefined} className="ds-btn-secondary"
            >
              {session.submit.busy ? "Saving…" : practice ? "Finish anyway" : "Submit"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => session.goTo(currentIndex)} className="ds-btn-secondary">Back to questions</button>
          <button type="button" data-focus="finish" onClick={open} className="ds-btn-primary">{finishLabel}</button>
        </div>
      )}
    </section>
  );
}
