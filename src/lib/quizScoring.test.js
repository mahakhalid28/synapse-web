import { describe, it, expect } from "vitest";
import { buildResult, conceptsToRevisit, describeScore, progressSummary, questionOutcome, scoreAttempt } from "./quizScoring.js";
import { emptyResponse, parseQuizResponse, validateResponses } from "./quizSchema.js";
import { makeQuiz } from "../test/quizFixtures.js";

// Keys: q1 b, q2 true, q3 b, q4 true, q5 b, q6 true.
const quiz = parseQuizResponse(makeQuiz());
const res = (over = {}) => ({ ...emptyResponse(), ...over });
const checked = (first, last = first, over = {}) => res({ choiceId: last, firstCheckedChoiceId: first, lastCheckedChoiceId: last, ...over });
const asMap = (entries) => validateResponses(quiz, "practice", entries);

describe("Practice scoring: the first checked answer counts", () => {
  it("scores a correct first check as correct and a wrong one as incorrect", () => {
    const score = scoreAttempt(quiz, "practice", asMap({ q1: checked("b"), q2: checked("false") }));
    expect(score.outcomes.slice(0, 2)).toEqual([{ id: "q1", outcome: "correct" }, { id: "q2", outcome: "incorrect" }]);
    expect(score).toMatchObject({ correct: 1, incorrect: 1, unanswered: 4, total: 6 });
  });

  it("is not changed by retries: a wrong first check stays wrong after finding the right answer", () => {
    const retried = asMap({ q1: checked("a", "b", { hintsUsed: 2 }) });
    expect(questionOutcome(quiz.questions[0], "practice", retried.q1)).toBe("incorrect");
  });

  it("is not changed by hints: a correct first check with hints is still correct", () => {
    expect(questionOutcome(quiz.questions[0], "practice", checked("b", "b", { hintsUsed: 2 }))).toBe("correct");
  });

  it("counts a selected but never-checked question as unanswered", () => {
    expect(questionOutcome(quiz.questions[0], "practice", res({ choiceId: "b" }))).toBe("unanswered");
  });
});

describe("Assessment scoring: the final selection counts", () => {
  const map = (entries) => validateResponses(quiz, "assessment", entries);

  it("uses the last selection, however often it changed", () => {
    const score = scoreAttempt(quiz, "assessment", map({ q1: res({ choiceId: "b" }), q2: res({ choiceId: "false" }), q3: res({ choiceId: "a" }) }));
    expect(score.outcomes.slice(0, 3).map((o) => o.outcome)).toEqual(["correct", "incorrect", "incorrect"]);
  });

  it("counts unanswered questions as unanswered, not wrong", () => {
    const score = scoreAttempt(quiz, "assessment", map({ q1: res({ choiceId: "b" }) }));
    expect(score).toMatchObject({ correct: 1, incorrect: 0, unanswered: 5 });
  });

  it("scores true/false questions", () => {
    expect(questionOutcome(quiz.questions[1], "assessment", res({ choiceId: "true" }))).toBe("correct");
    expect(questionOutcome(quiz.questions[1], "assessment", res({ choiceId: "false" }))).toBe("incorrect");
  });
});

describe("derived values", () => {
  it("correct + incorrect + unanswered always equals the total", () => {
    for (const mode of ["practice", "assessment"]) {
      const s = scoreAttempt(quiz, mode, {});
      expect(s.correct + s.incorrect + s.unanswered).toBe(s.total);
    }
  });

  it("describes a score in words, never a bare percentage", () => {
    expect(describeScore({ correct: 4, total: 6, unanswered: 1 })).toBe("4 of 6 correct, 1 unanswered");
    expect(describeScore({ correct: 6, total: 6, unanswered: 0 })).toBe("6 of 6 correct");
  });

  it("lists concepts to revisit in lecture order with their evidence ranges", () => {
    const responses = validateResponses(quiz, "assessment", {
      q1: res({ choiceId: "b" }), q2: res({ choiceId: "true" }), q3: res({ choiceId: "a" }), q4: res({ choiceId: "false" }),
    });
    const { outcomes } = scoreAttempt(quiz, "assessment", responses);
    const revisit = conceptsToRevisit(quiz, outcomes);
    expect(revisit.map((c) => c.id)).toEqual(["concept-3", "concept-4", "concept-5", "concept-6"]); // 3 wrong, 4 wrong, 5 and 6 unanswered
    expect(revisit[0]).toMatchObject({ label: "Concept 3", questionIds: ["q3"], startSeconds: 200 });
    expect(revisit[0].evidence).toEqual([{ start_seconds: 200, end_seconds: 290 }]);
    expect(conceptsToRevisit(quiz, scoreAttempt(quiz, "assessment", validateResponses(quiz, "assessment", {})).outcomes)).toHaveLength(6);
  });

  it("merges questions that share a concept", () => {
    const shared = parseQuizResponse(makeQuiz({ questions: [1, 2, 3, 4, 5, 6].map((n) => {
      const q = JSON.parse(JSON.stringify(makeQuiz().questions[n - 1]));
      if (n === 1 || n === 5) q.concept = { id: "shared", label: "Shared" };
      return q;
    }) }));
    const outcomes = scoreAttempt(shared, "assessment", validateResponses(shared, "assessment", {})).outcomes;
    const revisit = conceptsToRevisit(shared, outcomes);
    const entry = revisit.find((c) => c.id === "shared");
    expect(entry.questionIds).toEqual(["q1", "q5"]);
    expect(entry.startSeconds).toBe(0);
  });

  it("summarises progress for the resume prompt", () => {
    const attempt = { currentIndex: 2, responses: validateResponses(quiz, "practice", {
      q1: checked("a", "a", { hintsUsed: 2, flagged: true }), q2: res({ choiceId: "true" }), q3: res({ flagged: true }),
    }) };
    expect(progressSummary(quiz, attempt)).toEqual({ total: 6, selected: 2, notSelected: 4, flagged: 2, hintsUsed: 2, currentIndex: 2 });
  });

  it("builds the cached result from the same scoring", () => {
    const responses = asMap({ q1: checked("b") });
    expect(buildResult(quiz, "practice", responses, 123)).toEqual({ correct: 1, incorrect: 0, unanswered: 5, total: 6, scoredAt: 123 });
  });
});
