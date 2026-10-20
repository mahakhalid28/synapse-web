// Results. The score is recomputed from the final responses (quizScoring); the cached result stored
// with the attempt is never used here. Every outcome is written in words as well as shown with a
// symbol. "Check in the lecture" hands the server-chosen start time to the caller, which opens the
// lecture cued and paused (that wiring is the integration stage; this screen only reports the time).

import { useId } from "react";
import { conceptsToRevisit, describeScore } from "../lib/quizScoring.js";
import { AI_NOTICE, MODE_LABELS, choiceText, evidenceLabel } from "../lib/quizText.js";

const OUTCOME_WORDS = { correct: "Correct", incorrect: "Not correct", unanswered: "Not answered" };
const OUTCOME_MARKS = { correct: "✓", incorrect: "✗", unanswered: "–" };

export default function QuizResults({ session, result, onOpenLecture }) {
  const uid = useId();
  const { quiz, score, attempt } = result;
  const practice = attempt.quizMode === "practice";
  const revisit = conceptsToRevisit(quiz, score.outcomes);

  return (
    <section aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`} tabIndex={-1} data-focus="results-heading" className="text-[1.5em] font-semibold text-text-primary mb-2 outline-none focus-ring">
        Your results
      </h2>
      <p className="m-0 mb-1 text-[1.25em] font-semibold text-text-primary">{describeScore(score)}</p>
      <ul className="list-none m-0 mb-4 p-0 text-text-primary">
        <li>{`Correct: ${score.correct}`}</li>
        <li>{`Not correct: ${score.incorrect}`}</li>
        <li>{`Not answered: ${score.unanswered}`}</li>
      </ul>
      <p className="mb-4 text-[0.875em] text-text-secondary">
        {practice
          ? "Practice score. It counts the first answer you checked for each question; retries and hints do not change it. A question you never checked counts as not answered."
          : "Assessment score. It counts your final answer to each question. This is self-assessment, not a secure test."}
      </p>

      {revisit.length > 0 && (
        <div className="mb-8">
          <h3 className="m-0 mb-2 text-[1.25em] font-semibold text-text-primary">Concepts to revisit</h3>
          <ul className="list-none m-0 p-0 flex flex-col gap-2">
            {revisit.map((c) => (
              <li key={c.id} className="quiz-box p-3 rounded-radius-md border border-border-strong bg-surface text-text-primary">
                <p className="m-0 mb-2 font-medium break-words">{`${c.label} (${c.questionIds.map((id) => `question ${id.slice(1)}`).join(", ")})`}</p>
                <button type="button" onClick={() => onOpenLecture({ start_seconds: c.startSeconds })} className="ds-btn-secondary">
                  {`${evidenceLabel({ start_seconds: c.startSeconds })} for ${c.label}`}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h3 className="m-0 mb-2 text-[1.25em] font-semibold text-text-primary">Every question</h3>
      <ol className="list-none m-0 mb-8 p-0 flex flex-col gap-4">
        {quiz.questions.map((q, i) => {
          const response = attempt.responses[q.id];
          const outcome = score.outcomes[i].outcome;
          const shown = practice ? response.firstCheckedChoiceId : response.choiceId;
          return (
            <li key={q.id} className="quiz-box p-4 rounded-radius-md border border-border-strong bg-surface text-text-primary">
              <h4 className="m-0 mb-2 text-[1.125em] font-semibold">
                <span aria-hidden="true">{OUTCOME_MARKS[outcome]} </span>{`Question ${i + 1}: ${OUTCOME_WORDS[outcome]}`}
              </h4>
              <p className="m-0 mb-2 break-words">{q.prompt}</p>
              <p className="m-0 mb-1 break-words">
                {shown === null
                  ? (practice && response.choiceId !== null ? "You selected an answer but did not check it." : "You did not answer this question.")
                  : `${practice ? "Your first checked answer" : "Your answer"}: ${choiceText(q, shown)}`}
              </p>
              {practice && response.hintsUsed > 0 && (
                <p className="m-0 mb-1 text-[0.875em] text-text-secondary">{`Hints used: ${response.hintsUsed}`}</p>
              )}
              <p className="m-0 mb-1 break-words">{`Correct answer: ${choiceText(q, q.correct_choice_id)}`}</p>
              <p className="m-0 mb-3 break-words">{q.explanation}</p>
              <div className="flex flex-wrap gap-2">
                {q.evidence.map((e, k) => (
                  <button key={k} type="button" onClick={() => onOpenLecture(e)} className="ds-btn-secondary">
                    {`${evidenceLabel(e)} (question ${i + 1})`}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ol>

      <p className="mb-4 text-[0.875em] text-text-secondary">{`${MODE_LABELS[attempt.quizMode]} saved on this computer. ${AI_NOTICE}`}</p>
      <button type="button" data-focus="new-set" onClick={session.startNewSet} className="ds-btn-primary">Start a new set</button>
    </section>
  );
}
