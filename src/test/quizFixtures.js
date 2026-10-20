// Synthetic quiz data for tests. Entirely made up: nothing here is real transcript data and none
// of it came from a model.

export const QUIZ_ID = "3f2b8c1e-5d4a-4e7b-9a10-2c6d8e9f0a1b";
export const VIDEO_ID = "5ugDJhmmkFM";
export const OTHER_VIDEO_ID = "aircAruvnKk";

const MCQ_TEXTS = [["alpha choice", "bravo choice", "charlie choice", "delta choice"]];

// Question n (1-based). Odd n: multiple choice, key "b", two hints. Even n: true/false, key "true";
// n = 2 has no hints, n = 4 has one hint.
export function makeQuestion(n, over = {}) {
  const base = {
    id: `q${n}`,
    explanation: `Explanation for question ${n}.`,
    concept: { id: `concept-${n}`, label: `Concept ${n}` },
    evidence: [{ kind: "transcript", start_seconds: (n - 1) * 100, end_seconds: (n - 1) * 100 + 90, quote: `Quote ${n} from the lecture.` }],
    grounding: "screened",
  };
  if (n % 2 === 1) {
    return {
      ...base, type: "mcq", prompt: `Which one is correct for ${n}?`,
      choices: MCQ_TEXTS[0].map((text, i) => ({ id: "abcd"[i], text })),
      correct_choice_id: "b", hints: ["Think about the setup.", "Recall the first step."], ...over,
    };
  }
  return {
    ...base, type: "tf", prompt: `Statement number ${n} holds.`,
    choices: [{ id: "true", text: "True" }, { id: "false", text: "False" }],
    correct_choice_id: "true", hints: n === 4 ? ["Listen for the claim."] : [], ...over,
  };
}

export function makeQuiz(over = {}) {
  const count = over.questions ? over.questions.length : 6;
  return {
    contract_version: 1,
    quiz_id: QUIZ_ID,
    video_id: VIDEO_ID,
    generated_at: "2026-01-01T12:00:00Z",
    prompt_version: "quiz-v1",
    model: "fake-model",
    requested_count: 6,
    returned_count: count,
    status: "complete",
    reason: null,
    notice: null,
    omitted: [],
    questions: Array.from({ length: count }, (_, i) => makeQuestion(i + 1)),
    ...over,
  };
}

export const partialQuiz = (over = {}) => makeQuiz({
  quiz_id: "7a1c0d2e-1111-4222-8333-444455556666", status: "partial", requested_count: 6, returned_count: 4,
  notice: "Only 4 of the 6 questions you asked for could be made and checked from this lecture.",
  questions: [1, 2, 3, 4].map((n) => makeQuestion(n)), ...over,
});

export const insufficientQuiz = () => makeQuiz({
  quiz_id: "9b9b9b9b-aaaa-4bbb-8ccc-dddddddddddd", status: "insufficient_material", reason: "too_short",
  notice: "This lecture is too short to make reliable practice questions.", returned_count: 0, questions: [],
});

/** A second, distinct quiz for the same video (new id), for replacement tests. */
export const secondQuiz = () => makeQuiz({ quiz_id: "0d0d0d0d-1234-4abc-9def-0123456789ab" });

export const deepCopy = (value) => JSON.parse(JSON.stringify(value));
