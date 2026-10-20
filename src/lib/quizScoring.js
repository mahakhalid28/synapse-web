// Scoring and progress for Accessible Quiz & Practice (docs/QUIZ_CONTRACT.md section 6).
//
// Pure functions of the quiz and the stored responses. A score is ALWAYS recomputed from
// the responses when it is shown; the `result` cached on a submitted attempt is only a
// convenience and is never trusted. Only auto-scored question types exist (mcq, tf).
//
//   Practice    scored on the FIRST checked answer of each question. Retries, hints and
//               "show answer" do not change it. A question never checked is unanswered
//               (even if a choice is selected).
//   Assessment  scored on the final selection. No checks and no hints exist.
//   An unanswered question is counted as unanswered, not as wrong.

/** "correct" | "incorrect" | "unanswered" */
export function questionOutcome(question, mode, response) {
  const choice = mode === "practice" ? response?.firstCheckedChoiceId : response?.choiceId;
  if (choice === null || choice === undefined) return "unanswered";
  return choice === question.correct_choice_id ? "correct" : "incorrect";
}

export function scoreAttempt(quiz, mode, responses) {
  const outcomes = quiz.questions.map((q) => ({ id: q.id, outcome: questionOutcome(q, mode, responses?.[q.id]) }));
  const count = (kind) => outcomes.filter((o) => o.outcome === kind).length;
  return {
    correct: count("correct"),
    incorrect: count("incorrect"),
    unanswered: count("unanswered"),
    total: quiz.questions.length,
    outcomes,
  };
}

/**
 * Concepts with at least one wrong or unanswered question, in lecture order, each with the
 * evidence ranges to re-watch. `startSeconds` is the earliest evidence start for the concept.
 */
export function conceptsToRevisit(quiz, outcomes) {
  const byId = new Map(outcomes.map((o) => [o.id, o.outcome]));
  const concepts = new Map();
  for (const q of quiz.questions) {
    if (byId.get(q.id) === "correct") continue;
    const entry = concepts.get(q.concept.id) ?? { id: q.concept.id, label: q.concept.label, questionIds: [], evidence: [] };
    entry.questionIds.push(q.id);
    entry.evidence.push(...q.evidence.map((e) => ({ start_seconds: e.start_seconds, end_seconds: e.end_seconds })));
    concepts.set(q.concept.id, entry);
  }
  return [...concepts.values()]
    .map((c) => ({ ...c, startSeconds: Math.min(...c.evidence.map((e) => e.start_seconds)) }))
    .sort((a, b) => a.startSeconds - b.startSeconds || (a.id < b.id ? -1 : 1));
}

/** Where the learner is: selections, flags and hints, for resume prompts and the question list. */
export function progressSummary(quiz, attempt) {
  const list = quiz.questions.map((q) => attempt.responses[q.id]);
  const selected = list.filter((r) => r.choiceId !== null).length;
  return {
    total: quiz.questions.length,
    selected,
    notSelected: quiz.questions.length - selected,
    flagged: list.filter((r) => r.flagged).length,
    hintsUsed: list.reduce((n, r) => n + r.hintsUsed, 0),
    currentIndex: attempt.currentIndex,
  };
}

/** "4 of 6 correct, 1 unanswered" (a percentage is never shown on its own). */
export function describeScore({ correct, total, unanswered }) {
  const base = `${correct} of ${total} correct`;
  return unanswered > 0 ? `${base}, ${unanswered} unanswered` : base;
}

/** The cached result for a submitted attempt, built from the responses at submit time. */
export function buildResult(quiz, mode, responses, scoredAt) {
  const { correct, incorrect, unanswered, total } = scoreAttempt(quiz, mode, responses);
  return { correct, incorrect, unanswered, total, scoredAt };
}
