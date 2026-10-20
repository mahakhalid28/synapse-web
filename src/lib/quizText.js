// Wording and small helpers shared by the quiz screen. Plain text only, no JSX.
// Kept apart from the components so the exact words a screen-reader user hears can be tested.

import { formatTimestamp } from "./askApi.js";

export const AI_NOTICE =
  "These questions were made by AI from the lecture's automatic captions. They were checked only for basic consistency and may contain mistakes. Use \"Check in the lecture\" to confirm.";

export const ASSESSMENT_NOTE =
  "Assessment is self-assessment, not a secure or proctored test. Your answers stay on this computer.";

export const MODE_LABELS = { practice: "Practice", assessment: "Assessment" };
export const MODE_HELP = {
  practice: "Check each answer as you go and get an explanation. Up to two hints per question. Your score counts the first answer you check.",
  assessment: "No hints and no feedback until you submit. You can change answers and review before submitting.",
};

const LETTERS = ["A", "B", "C", "D"];

export function choiceLetter(question, choiceId) {
  const index = question.choices.findIndex((c) => c.id === choiceId);
  return question.type === "mcq" && index >= 0 ? LETTERS[index] : "";
}

/** "B. bravo choice" for multiple choice, "True" / "False" for true/false. */
export function choiceText(question, choiceId) {
  const choice = question.choices.find((c) => c.id === choiceId);
  if (!choice) return "";
  const letter = choiceLetter(question, choiceId);
  return letter ? `${letter}. ${choice.text}` : choice.text;
}

/** "Check in the lecture at 3:21" */
export function evidenceLabel(evidence) {
  return `Check in the lecture at ${formatTimestamp(evidence.start_seconds)}`;
}

/** How a question stands, in words (never colour alone). */
export function questionState(mode, response) {
  if (response.choiceId === null) return "not answered";
  if (mode === "practice") {
    if (response.lastCheckedChoiceId === response.choiceId) return "checked";
    return "answer selected, not checked yet";
  }
  return "answered";
}

/** Accessible name of a question-list button: "Question 4, answered, flagged for review". */
export function questionButtonName(index, mode, response) {
  const parts = [`Question ${index + 1}`, questionState(mode, response)];
  if (response.flagged) parts.push("flagged for review");
  return parts.join(", ");
}

export function countAnswered(responses) {
  return Object.values(responses).filter((r) => r.choiceId !== null).length;
}

export function countFlagged(responses) {
  return Object.values(responses).filter((r) => r.flagged).length;
}

/** Practice questions the learner has not checked (a selection alone does not count). */
export function countUnchecked(quiz, responses) {
  return quiz.questions.filter((q) => responses[q.id].firstCheckedChoiceId === null).length;
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export const SAVE_ERROR_MESSAGES = {
  conflict: "This practice was changed in another window. Showing the latest saved version.",
  gone: "This practice was finished or replaced in another window.",
  quota: "There is not enough storage space to save your progress.",
  unavailable: "Practice can't be saved on this computer, so it can't be started here.",
  default: "Progress could not be saved.",
};

export function saveErrorMessage(error) {
  return SAVE_ERROR_MESSAGES[error && error.code] ?? SAVE_ERROR_MESSAGES.default;
}
