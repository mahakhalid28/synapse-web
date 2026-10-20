// One question at a time, with the question list.
//
// Native radio buttons in a fieldset whose legend is the question. Selecting is NOT checking:
// in Practice a separate "Check answer" button gives feedback, and says so. In Assessment there
// is no check, no hint and no feedback until the answers are submitted.
//
// What is spoken (one mechanism per event, so nothing is read twice):
//   next / previous / jump   focus moves to the question heading; nothing else is announced
//   selecting a choice       the radio's own native announcement only
//   Check answer             focus moves to the feedback heading; the text follows as normal content
//   Hint                     one polite message (also shown on the page); focus stays on the button
//   Flag                     aria-pressed only
// Correctness is always written in words ("Correct" / "Not quite") as well as shown with a symbol.

import { useId } from "react";
import { evidenceLabel, questionButtonName, choiceText, choiceLetter, countAnswered, countFlagged } from "../lib/quizText.js";

const MAX_HINTS = 2;

export default function QuizQuestion({ session, work, onOpenLecture }) {
  const uid = useId();
  const { quiz, mode, currentIndex, responses, revealed } = work;
  const total = quiz.questions.length;
  const question = quiz.questions[currentIndex];
  const response = responses[question.id];
  const practice = mode === "practice";

  const feedbackShowing = practice && response.lastCheckedChoiceId !== null && response.lastCheckedChoiceId === response.choiceId;
  const correct = feedbackShowing && response.choiceId === question.correct_choice_id;
  const hintLimit = Math.min(MAX_HINTS, question.hints.length);
  const isLast = currentIndex === total - 1;
  const answered = countAnswered(responses);
  const flagged = countFlagged(responses);

  const check = () => {
    if (response.choiceId === null) {
      session.announce("Choose an answer first, then check it.");
      return;
    }
    session.check(question.id);
  };

  return (
    <section aria-labelledby={`${uid}-h`}>
      {quiz.status === "partial" && (
        <p id={`${uid}-partial`} className="quiz-box mb-4 p-3 rounded-radius-md border border-warning bg-warning-soft text-text-primary">
          {quiz.notice}
        </p>
      )}

      <h2
        id={`${uid}-h`} tabIndex={-1} data-focus="question-heading"
        aria-describedby={quiz.status === "partial" ? `${uid}-partial` : undefined}
        className="text-[1.5em] font-semibold text-text-primary mb-1 outline-none focus-ring"
      >
        {`Question ${currentIndex + 1} of ${total}`}
      </h2>
      <p className="m-0 mb-4 text-[0.875em] text-text-secondary">
        {`${answered} of ${total} answered${flagged > 0 ? `, ${flagged} flagged for review` : ""}. ${practice ? "Practice" : "Assessment"}.`}
      </p>

      <fieldset className="m-0 mb-4 p-0 border-0 min-w-0">
        <legend className="mb-3 text-[1.125em] font-medium text-text-primary break-words">{question.prompt}</legend>
        {question.choices.map((choice) => {
          const selected = response.choiceId === choice.id;
          const letter = choiceLetter(question, choice.id);
          return (
            <label
              key={choice.id}
              className={"quiz-box flex items-start gap-3 mb-2 p-3 rounded-radius-md border cursor-pointer bg-surface min-h-[44px] " +
                (selected ? "border-accent border-2" : "border-border-strong")}
            >
              <input
                type="radio" name={`${uid}-choice`} value={choice.id} checked={selected}
                aria-describedby={practice ? `${uid}-check-help` : undefined}
                onChange={() => session.select(question.id, choice.id)}
                className="mt-1 w-5 h-5 shrink-0 accent-[rgb(var(--accent))] focus-ring"
              />
              <span className="min-w-0 break-words text-text-primary">
                {letter ? `${letter}. ${choice.text}` : choice.text}
              </span>
            </label>
          );
        })}
      </fieldset>

      {practice && (
        <p id={`${uid}-check-help`} className="m-0 mb-3 text-[0.875em] text-text-secondary">
          Choosing an answer does not check it. Press Check answer to see whether it is right.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {practice && !feedbackShowing && (
          <button
            type="button" onClick={check} aria-describedby={`${uid}-check-help`}
            aria-disabled={response.choiceId === null || undefined}
            className={"ds-btn-primary " + (response.choiceId === null ? "opacity-60 cursor-not-allowed" : "")}
          >
            Check answer
          </button>
        )}
        {practice && hintLimit > 0 && (
          <button
            type="button" data-focus="hint" onClick={() => session.revealHint(question.id)}
            aria-disabled={response.hintsUsed >= hintLimit || undefined}
            className={"ds-btn-secondary " + (response.hintsUsed >= hintLimit ? "opacity-60 cursor-not-allowed" : "")}
          >
            {response.hintsUsed >= hintLimit ? "No more hints" : `Show hint ${response.hintsUsed + 1} of ${hintLimit}`}
          </button>
        )}
        <button type="button" onClick={() => session.toggleFlag(question.id)} aria-pressed={response.flagged} className="ds-btn-secondary">
          Flag for review
        </button>
      </div>

      {practice && response.hintsUsed > 0 && (
        <div className="mb-4">
          <h3 className="m-0 mb-1 text-[1em] font-semibold text-text-primary">Hints</h3>
          <ol className="m-0 pl-6 list-decimal text-text-primary">
            {question.hints.slice(0, response.hintsUsed).map((hint, i) => <li key={i} className="break-words">{hint}</li>)}
          </ol>
        </div>
      )}

      {feedbackShowing && (
        <div className="quiz-box mb-4 p-4 rounded-radius-md border-2 border-border-strong bg-surface-muted text-text-primary">
          <h3 tabIndex={-1} data-focus="feedback-heading" className="m-0 mb-2 text-[1.25em] font-semibold outline-none focus-ring">
            <span aria-hidden="true">{correct ? "✓ " : "✗ "}</span>{correct ? "Correct" : "Not quite"}
          </h3>
          <p className="m-0 mb-2 break-words">{`You chose ${choiceText(question, response.choiceId)}.`}</p>
          {(correct || revealed[question.id]) && (
            <p className="m-0 mb-2 break-words">{`The answer is ${choiceText(question, question.correct_choice_id)}.`}</p>
          )}
          <p className="m-0 mb-3 break-words">{question.explanation}</p>
          <div className="flex flex-wrap gap-2">
            {!correct && !revealed[question.id] && (
              <button type="button" onClick={() => session.revealAnswer(question.id)} className="ds-btn-secondary">Show answer</button>
            )}
            {!correct && (
              <p className="m-0 w-full text-[0.875em] text-text-secondary">To try again, choose a different answer and check it. Your score counts your first checked answer.</p>
            )}
            {question.evidence.map((e, i) => (
              <button key={i} type="button" onClick={() => onOpenLecture(e)} className="ds-btn-secondary">{evidenceLabel(e)}</button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-6">
        <button type="button" onClick={() => session.goTo(currentIndex - 1)} disabled={currentIndex === 0} className="ds-btn-secondary disabled:opacity-50">
          Previous question
        </button>
        {isLast ? (
          <button type="button" onClick={session.openReview} className="ds-btn-primary">Review answers</button>
        ) : (
          <button type="button" onClick={() => session.goTo(currentIndex + 1)} className="ds-btn-primary">Next question</button>
        )}
        {!isLast && (
          <button type="button" onClick={session.openReview} className="ds-btn-text">Review answers</button>
        )}
      </div>

      <nav aria-label="Questions">
        <ol className="list-none m-0 p-0 flex flex-wrap gap-2">
          {quiz.questions.map((q, i) => {
            const r = responses[q.id];
            const current = i === currentIndex;
            return (
              <li key={q.id}>
                <button
                  type="button" onClick={() => session.goTo(i)}
                  aria-label={questionButtonName(i, mode, r)} aria-current={current ? "step" : undefined}
                  className={"quiz-box min-w-[44px] min-h-[44px] px-2 rounded-radius-sm border bg-surface text-text-primary focus-ring " +
                    (current ? "border-2 border-accent font-bold" : "border-border-strong")}
                >
                  <span aria-hidden="true">{i + 1}{r.choiceId !== null ? " ✓" : ""}{r.flagged ? " ⚑" : ""}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="m-0 mt-2 text-[0.875em] text-text-secondary"><span aria-hidden="true">✓ answered · ⚑ flagged for review</span></p>
      </nav>
    </section>
  );
}
