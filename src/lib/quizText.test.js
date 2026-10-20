import { describe, it, expect } from "vitest";
import {
  choiceLetter, choiceText, countAnswered, countFlagged, countUnchecked, evidenceLabel, plural, questionButtonName,
  questionState, saveErrorMessage, SAVE_ERROR_MESSAGES,
} from "./quizText.js";
import { emptyResponse, parseQuizResponse } from "./quizSchema.js";
import { makeQuiz } from "../test/quizFixtures.js";

const quiz = parseQuizResponse(makeQuiz());
const [mcq, tf] = quiz.questions;
const res = (over = {}) => ({ ...emptyResponse(), ...over });

describe("choice wording", () => {
  it("letters multiple-choice options and leaves true/false plain", () => {
    expect(choiceLetter(mcq, "a")).toBe("A");
    expect(choiceLetter(mcq, "d")).toBe("D");
    expect(choiceLetter(tf, "true")).toBe("");
    expect(choiceText(mcq, "b")).toBe("B. bravo choice");
    expect(choiceText(tf, "false")).toBe("False");
    expect(choiceText(mcq, "z")).toBe("");
  });
});

describe("question state in words", () => {
  it("distinguishes not answered, selected-but-unchecked, checked and answered", () => {
    expect(questionState("practice", res())).toBe("not answered");
    expect(questionState("practice", res({ choiceId: "a" }))).toBe("answer selected, not checked yet");
    expect(questionState("practice", res({ choiceId: "a", firstCheckedChoiceId: "a", lastCheckedChoiceId: "a" }))).toBe("checked");
    expect(questionState("practice", res({ choiceId: "b", firstCheckedChoiceId: "a", lastCheckedChoiceId: "a" }))).toBe("answer selected, not checked yet");
    expect(questionState("assessment", res({ choiceId: "a" }))).toBe("answered");
    expect(questionState("assessment", res())).toBe("not answered");
  });

  it("names question buttons with number, state and flag", () => {
    expect(questionButtonName(3, "assessment", res({ choiceId: "a", flagged: true }))).toBe("Question 4, answered, flagged for review");
    expect(questionButtonName(0, "practice", res())).toBe("Question 1, not answered");
  });

  it("counts answered, flagged and unchecked questions", () => {
    const responses = {
      q1: res({ choiceId: "a", firstCheckedChoiceId: "a", lastCheckedChoiceId: "a" }), q2: res({ choiceId: "true", flagged: true }),
      q3: res({ flagged: true }), q4: res(), q5: res(), q6: res(),
    };
    expect(countAnswered(responses)).toBe(2);
    expect(countFlagged(responses)).toBe(2);
    expect(countUnchecked(quiz, responses)).toBe(5);
  });
});

describe("small helpers", () => {
  it("labels evidence with the start time in minutes and seconds", () => {
    expect(evidenceLabel({ start_seconds: 0 })).toBe("Check in the lecture at 0:00");
    expect(evidenceLabel({ start_seconds: 201.9 })).toBe("Check in the lecture at 3:21");
    expect(evidenceLabel({ start_seconds: 3725 })).toBe("Check in the lecture at 1:02:05");
  });

  it("pluralises", () => {
    expect(plural(1, "question")).toBe("1 question");
    expect(plural(2, "question")).toBe("2 questions");
    expect(plural(0, "earlier practice")).toBe("0 earlier practices");
  });

  it("turns store errors into plain messages and never shows raw error text", () => {
    expect(saveErrorMessage({ code: "quota", message: "QuotaExceededError: secret path" })).toBe(SAVE_ERROR_MESSAGES.quota);
    expect(saveErrorMessage({ code: "unavailable" })).toMatch(/can't be saved on this computer/);
    expect(saveErrorMessage({ code: "conflict" })).toMatch(/changed in another window/);
    expect(saveErrorMessage(new Error("raw internal detail"))).toBe("Progress could not be saved.");
    expect(saveErrorMessage(null)).toBe("Progress could not be saved.");
  });
});
