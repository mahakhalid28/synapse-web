import { describe, it, expect } from "vitest";
import {
  QuizSchemaError, SCHEMA_VERSION, checkSchemaVersion, emptyResponse, parseQuizResponse, parseStorableQuiz,
  validateAttempt, validatePointer, validateQuizRecord, validateResponses,
} from "./quizSchema.js";
import { QUIZ_ID, VIDEO_ID, deepCopy, insufficientQuiz, makeQuestion, makeQuiz, partialQuiz } from "../test/quizFixtures.js";

const reason = (fn) => { try { fn(); } catch (e) { expect(e).toBeInstanceOf(QuizSchemaError); return e.reason; } throw new Error("expected a QuizSchemaError"); };
const withQuestion = (n, over) => makeQuiz({ questions: [1, 2, 3, 4, 5, 6].map((i) => (i === n ? makeQuestion(i, over) : makeQuestion(i))) });

describe("parseQuizResponse: accepted shapes", () => {
  it("accepts complete, partial and insufficient responses and returns a clean copy", () => {
    for (const quiz of [makeQuiz(), partialQuiz(), insufficientQuiz()]) {
      const parsed = parseQuizResponse(quiz);
      expect(parsed).toEqual(quiz);
      expect(parsed).not.toBe(quiz);
    }
  });

  it("drops unknown fields everywhere so nothing extra can reach storage", () => {
    const dirty = makeQuiz({ api_key: "sk-secret", transcript: "full transcript text", audio: new Blob(["x"]) });
    dirty.questions[0].extra = "x";
    dirty.questions[0].choices[0].html = "<b>";
    dirty.questions[0].evidence[0].intervention_id = "abc";
    dirty.questions[0].concept.note = "n";
    const parsed = parseQuizResponse(dirty);
    expect(JSON.stringify(parsed)).not.toMatch(/sk-secret|full transcript|extra|<b>|intervention_id|note/);
    expect(parsed).toEqual(makeQuiz());
  });

  it("does not mutate its input", () => {
    const quiz = makeQuiz();
    const before = deepCopy(quiz);
    parseQuizResponse(quiz);
    expect(quiz).toEqual(before);
  });

  it("accepts the boundaries of every length and count", () => {
    const ok = withQuestion(1, { prompt: "p".repeat(400), explanation: "e".repeat(600), hints: ["h".repeat(200), "h".repeat(200)],
      concept: { id: "c".repeat(40), label: "l".repeat(60) },
      evidence: [0, 1, 2].map((i) => ({ kind: "transcript", start_seconds: i, end_seconds: i, quote: "q".repeat(240) })) });
    expect(parseQuizResponse(ok).questions[0].evidence).toHaveLength(3);
    expect(parseQuizResponse(makeQuiz({ requested_count: 5, returned_count: 5, questions: [1, 2, 3, 4, 5].map((n) => makeQuestion(n)) })).returned_count).toBe(5);
  });
});

describe("parseQuizResponse: rejected input", () => {
  it("rejects non-objects and wrong versions", () => {
    for (const bad of [null, undefined, "x", 5, [], true]) expect(reason(() => parseQuizResponse(bad))).toBe("invalid");
    expect(reason(() => parseQuizResponse(makeQuiz({ contract_version: 2 })))).toBe("unsupported_contract_version");
    expect(reason(() => parseQuizResponse(makeQuiz({ contract_version: "1" })))).toBe("unsupported_contract_version");
  });

  it("rejects bad ids, dates and counts", () => {
    const bad = [
      { quiz_id: "not-a-uuid" }, { quiz_id: 5 }, { video_id: "short" }, { video_id: VIDEO_ID + "x" },
      { generated_at: "yesterday" }, { generated_at: 5 }, { requested_count: 4 }, { requested_count: 11 },
      { requested_count: 6.5 }, { requested_count: "6" }, { returned_count: 5 }, { prompt_version: "" },
      { model: "m".repeat(101) }, { status: "done" }, { reason: "other" }, { omitted: "x" },
      { omitted: [{ reason: "Bad Reason", count: 1 }] }, { omitted: [{ reason: "ok_reason", count: 0 }] },
    ];
    for (const over of bad) expect(() => parseQuizResponse(makeQuiz(over)), JSON.stringify(over)).toThrow(QuizSchemaError);
  });

  it("enforces the status invariants", () => {
    const q3 = [1, 2, 3].map((n) => makeQuestion(n));
    const cases = {
      "complete with a notice": makeQuiz({ notice: "n" }),
      "complete with a reason": makeQuiz({ reason: "too_short" }),
      "complete but short": makeQuiz({ returned_count: 4, questions: [1, 2, 3, 4].map((n) => makeQuestion(n)) }),
      "partial without a notice": partialQuiz({ notice: null }),
      "partial with a reason": partialQuiz({ reason: "too_short" }),
      "partial below three": partialQuiz({ returned_count: 2, questions: [1, 2].map((n) => makeQuestion(n)) }),
      "partial with everything": partialQuiz({ returned_count: 6, questions: [1, 2, 3, 4, 5, 6].map((n) => makeQuestion(n)) }),
      "insufficient with questions": makeQuiz({ status: "insufficient_material", reason: "too_short", notice: "n", returned_count: 3, questions: q3 }),
      "insufficient without a reason": { ...insufficientQuiz(), reason: null },
      "insufficient without a notice": { ...insufficientQuiz(), notice: null },
    };
    for (const [name, quiz] of Object.entries(cases)) expect(() => parseQuizResponse(quiz), name).toThrow(QuizSchemaError);
    expect(parseQuizResponse(partialQuiz({ returned_count: 3, questions: q3 })).returned_count).toBe(3);
  });

  it("rejects unsupported question types", () => {
    for (const type of ["short", "short_answer", "MCQ", "essay", "", null, undefined, 3]) {
      expect(reason(() => parseQuizResponse(withQuestion(2, { type }))), String(type)).toBe("question_type_unsupported");
    }
    const shortAnswer = withQuestion(1, { type: "short", choices: [], correct_choice_id: "a", reference_answer: "x" });
    expect(reason(() => parseQuizResponse(shortAnswer))).toBe("question_type_unsupported");
  });

  it("rejects malformed choices and answer keys", () => {
    const abc = (n) => "abcde".slice(0, n).split("").map((id) => ({ id, text: `choice ${id}` }));
    const bad = [
      { choices: abc(2), correct_choice_id: "a" },                       // too few
      { choices: abc(5), correct_choice_id: "a" },                       // too many
      { choices: [{ id: "b", text: "x" }, { id: "a", text: "y" }, { id: "c", text: "z" }], correct_choice_id: "a" }, // order
      { choices: abc(4), correct_choice_id: "e" },                        // key not a choice
      { choices: abc(4), correct_choice_id: null },
      { choices: abc(4), correct_choice_id: 1 },
      { choices: "abcd" },
      { choices: [{ id: "a" }, { id: "b", text: "y" }, { id: "c", text: "z" }] },
      { choices: [{ id: "a", text: "" }, { id: "b", text: "y" }, { id: "c", text: "z" }] },
      { choices: [{ id: "a", text: "x".repeat(201) }, { id: "b", text: "y" }, { id: "c", text: "z" }] },
      { choices: [null, null, null] },
    ];
    for (const over of bad) expect(() => parseQuizResponse(withQuestion(1, over)), JSON.stringify(over).slice(0, 60)).toThrow(QuizSchemaError);
  });

  it("rejects true/false questions whose choices are not exactly True and False", () => {
    const bad = [
      [{ id: "true", text: "True" }],
      [{ id: "false", text: "False" }, { id: "true", text: "True" }],
      [{ id: "true", text: "Yes" }, { id: "false", text: "False" }],
      [{ id: "a", text: "True" }, { id: "b", text: "False" }],
      [{ id: "true", text: "True" }, { id: "false", text: "False" }, { id: "maybe", text: "Maybe" }],
    ];
    for (const choices of bad) expect(() => parseQuizResponse(withQuestion(2, { choices })), JSON.stringify(choices)).toThrow(QuizSchemaError);
    expect(() => parseQuizResponse(withQuestion(2, { correct_choice_id: "a" }))).toThrow(QuizSchemaError);
  });

  it("rejects more than two hints, bad hints, blank text and over-long text", () => {
    const bad = [
      { hints: ["a", "b", "c"] }, { hints: [""] }, { hints: [5] }, { hints: ["h".repeat(201)] }, { hints: "x" },
      { prompt: "" }, { prompt: "   " }, { prompt: "p".repeat(401) }, { explanation: "" }, { explanation: "e".repeat(601) },
      { concept: { id: "Bad ID", label: "x" } }, { concept: { id: "ok", label: "" } }, { concept: null }, { concept: { id: "c".repeat(41), label: "x" } },
    ];
    for (const over of bad) expect(() => parseQuizResponse(withQuestion(1, over)), JSON.stringify(over).slice(0, 60)).toThrow(QuizSchemaError);
  });

  it("rejects moment evidence and malformed evidence", () => {
    const ev = (over = {}) => ({ kind: "transcript", start_seconds: 1, end_seconds: 2, quote: "q", ...over });
    expect(reason(() => parseQuizResponse(withQuestion(1, { evidence: [{ ...ev(), kind: "moment", intervention_id: "x" }] })))).toBe("evidence_kind_unsupported");
    expect(reason(() => parseQuizResponse(withQuestion(1, { evidence: [ev({ kind: "visual" })] })))).toBe("evidence_kind_unsupported");
    const bad = [
      [], [ev(), ev({ start_seconds: 3, end_seconds: 4 }), ev({ start_seconds: 5, end_seconds: 6 }), ev({ start_seconds: 7, end_seconds: 8 })],
      [ev({ start_seconds: -1 })], [ev({ start_seconds: 5, end_seconds: 1 })], [ev({ start_seconds: NaN })],
      [ev({ end_seconds: Infinity })], [ev({ start_seconds: "1" })], [ev({ quote: "" })], [ev({ quote: "q".repeat(241) })],
      [ev({ start_seconds: 9, end_seconds: 10 }), ev({ start_seconds: 1, end_seconds: 2 })], "x", null,
    ];
    for (const evidence of bad) expect(() => parseQuizResponse(withQuestion(1, { evidence })), JSON.stringify(evidence).slice(0, 60)).toThrow(QuizSchemaError);
  });

  it("rejects any grounding other than screened (never 'verified')", () => {
    for (const grounding of ["verified", "", null, undefined]) {
      expect(reason(() => parseQuizResponse(withQuestion(1, { grounding })))).toBe("grounding_unsupported");
    }
  });

  it("rejects non-sequential question ids and non-object questions", () => {
    const quiz = makeQuiz();
    quiz.questions[2].id = "q9";
    expect(() => parseQuizResponse(quiz)).toThrow(QuizSchemaError);
    const swapped = makeQuiz();
    [swapped.questions[0], swapped.questions[1]] = [swapped.questions[1], swapped.questions[0]];
    expect(() => parseQuizResponse(swapped)).toThrow(QuizSchemaError);
    for (const q of [null, "x", 5, []]) expect(() => parseQuizResponse(makeQuiz({ questions: [q, q, q, q, q, q] }))).toThrow(QuizSchemaError);
  });

  it("errors never echo input values", () => {
    const secret = "SECRET-VALUE-123";
    for (const over of [{ model: secret.repeat(20) }, { quiz_id: secret }, { status: secret }]) {
      try { parseQuizResponse(makeQuiz(over)); } catch (e) { expect(e.message).not.toContain("SECRET"); }
    }
  });
});

describe("parseStorableQuiz", () => {
  it("accepts complete and partial quizzes only", () => {
    expect(parseStorableQuiz(makeQuiz()).status).toBe("complete");
    expect(parseStorableQuiz(partialQuiz()).status).toBe("partial");
    expect(reason(() => parseStorableQuiz(insufficientQuiz()))).toBe("not_storable");
  });
});

describe("validateResponses", () => {
  const quiz = parseQuizResponse(makeQuiz());
  const res = (over = {}) => ({ ...emptyResponse(), ...over });

  it("fills every question with the empty response", () => {
    const out = validateResponses(quiz, "practice", {});
    expect(Object.keys(out)).toEqual(["q1", "q2", "q3", "q4", "q5", "q6"]);
    expect(out.q1).toEqual(emptyResponse());
  });

  it("rejects unknown questions, unknown choices and unknown fields", () => {
    for (const responses of [{ q99: res() }, { q1: res({ choiceId: "z" }) }, { q1: res({ choiceId: "true" }) }, { q2: res({ choiceId: "a" }) },
      { q1: { ...res(), score: 1 } }, { q1: "x" }, { q1: res({ flagged: "yes" }) }, { q1: res({ hintsUsed: -1 }) }, { q1: res({ hintsUsed: 1.5 }) }]) {
      expect(() => validateResponses(quiz, "practice", responses), JSON.stringify(responses)).toThrow(QuizSchemaError);
    }
    expect(() => validateResponses(quiz, "practice", null)).toThrow(QuizSchemaError);
    expect(() => validateResponses(quiz, "other", {})).toThrow(QuizSchemaError);
  });

  it("limits hints to the question's own hints (q2 has none, q4 has one, q1 has two)", () => {
    expect(validateResponses(quiz, "practice", { q1: res({ hintsUsed: 2 }), q4: res({ hintsUsed: 1 }) }).q1.hintsUsed).toBe(2);
    for (const responses of [{ q1: res({ hintsUsed: 3 }) }, { q2: res({ hintsUsed: 1 }) }, { q4: res({ hintsUsed: 2 }) }]) {
      expect(() => validateResponses(quiz, "practice", responses)).toThrow(QuizSchemaError);
    }
  });

  it("keeps Assessment free of checks and hints", () => {
    expect(validateResponses(quiz, "assessment", { q1: res({ choiceId: "a", flagged: true }) }).q1.choiceId).toBe("a");
    for (const over of [{ hintsUsed: 1 }, { firstCheckedChoiceId: "a", lastCheckedChoiceId: "a" }, { lastCheckedChoiceId: "a" }]) {
      expect(reason(() => validateResponses(quiz, "assessment", { q1: res({ choiceId: "a", ...over }) }))).toBe("response_rule");
    }
  });

  it("requires a Practice first check to come with a last check, and the reverse", () => {
    expect(validateResponses(quiz, "practice", { q1: res({ choiceId: "a", firstCheckedChoiceId: "a", lastCheckedChoiceId: "a" }) }).q1.firstCheckedChoiceId).toBe("a");
    expect(reason(() => validateResponses(quiz, "practice", { q1: res({ firstCheckedChoiceId: "a" }) }))).toBe("response_rule");
    expect(reason(() => validateResponses(quiz, "practice", { q1: res({ lastCheckedChoiceId: "a" }) }))).toBe("response_rule");
  });

  it("does not let recorded facts be erased or rewritten", () => {
    const before = validateResponses(quiz, "practice", { q1: res({ choiceId: "a", firstCheckedChoiceId: "a", lastCheckedChoiceId: "a", hintsUsed: 2 }) });
    const ok = validateResponses(quiz, "practice", { q1: res({ choiceId: "b", firstCheckedChoiceId: "a", lastCheckedChoiceId: "b", hintsUsed: 2, flagged: true }) }, before);
    expect(ok.q1.firstCheckedChoiceId).toBe("a");
    for (const over of [{ firstCheckedChoiceId: "b" }, { firstCheckedChoiceId: null, lastCheckedChoiceId: null }, { hintsUsed: 1 }, { hintsUsed: 0 }]) {
      expect(reason(() => validateResponses(quiz, "practice", { q1: res({ choiceId: "a", firstCheckedChoiceId: "a", lastCheckedChoiceId: "a", hintsUsed: 2, ...over }) }, before)), JSON.stringify(over)).toBe("response_rule");
    }
    expect(() => validateResponses(quiz, "practice", {}, before)).toThrow(QuizSchemaError); // omitting q1 would erase its hints
  });
});

describe("version gate, pointer and quiz record", () => {
  it("separates newer versions from invalid ones", () => {
    expect(() => checkSchemaVersion({ schemaVersion: SCHEMA_VERSION })).not.toThrow();
    for (const v of [2, 99]) expect(reason(() => checkSchemaVersion({ schemaVersion: v }))).toBe("unsupported_version");
    for (const v of [0, -1, "1", 1.5, null, undefined, NaN]) expect(reason(() => checkSchemaVersion({ schemaVersion: v })), String(v)).toBe("invalid");
    for (const bad of [null, "x", 5]) expect(reason(() => checkSchemaVersion(bad))).toBe("invalid");
  });

  it("validates the active pointer", () => {
    expect(validatePointer({ id: VIDEO_ID, schemaVersion: 1, attemptId: "attempt-0001", rev: 1 }).attemptId).toBe("attempt-0001");
    for (const over of [{ id: "x" }, { attemptId: "short" }, { attemptId: 5 }, { rev: 0 }, { rev: 1.5 }, { schemaVersion: 0 }]) {
      expect(() => validatePointer({ id: VIDEO_ID, schemaVersion: 1, attemptId: "attempt-0001", rev: 1, ...over }), JSON.stringify(over)).toThrow(QuizSchemaError);
    }
    expect(reason(() => validatePointer({ id: VIDEO_ID, schemaVersion: 2, attemptId: "attempt-0001", rev: 1 }))).toBe("unsupported_version");
  });

  it("validates a stored quiz record against its own id and content", () => {
    const record = { id: QUIZ_ID, schemaVersion: 1, savedAt: 5, quiz: makeQuiz() };
    expect(validateQuizRecord(record).quiz.quiz_id).toBe(QUIZ_ID);
    expect(() => validateQuizRecord({ ...record, id: "other" })).toThrow(QuizSchemaError);
    expect(() => validateQuizRecord({ ...record, savedAt: 0 })).toThrow(QuizSchemaError);
    expect(() => validateQuizRecord({ ...record, quiz: insufficientQuiz(), id: insufficientQuiz().quiz_id })).toThrow(QuizSchemaError);
    expect(reason(() => validateQuizRecord({ ...record, quiz: withQuestion(1, { type: "short" }) }))).toBe("question_type_unsupported");
    expect(reason(() => validateQuizRecord({ ...record, schemaVersion: 2 }))).toBe("unsupported_version");
  });
});

describe("validateAttempt", () => {
  const quiz = parseQuizResponse(makeQuiz());
  const base = (over = {}) => ({
    id: "attempt-0001", schemaVersion: 1, quizId: QUIZ_ID, videoId: VIDEO_ID, quizMode: "practice", status: "in_progress",
    rev: 0, startedAt: 100, updatedAt: 100, submittedAt: null, abandonedAt: null, currentIndex: 0, responses: {}, result: null, ...over,
  });
  const result = { correct: 1, incorrect: 1, unanswered: 4, total: 6, scoredAt: 200 };

  it("accepts each status and returns a normalised copy", () => {
    expect(validateAttempt(base(), quiz).responses.q1).toEqual(emptyResponse());
    expect(validateAttempt(base({ status: "submitted", submittedAt: 200, updatedAt: 200, result }), quiz).result).toEqual(result);
    expect(validateAttempt(base({ status: "abandoned", abandonedAt: 150, updatedAt: 150 }), quiz).status).toBe("abandoned");
    expect(JSON.stringify(validateAttempt({ ...base(), blob: "x", transcript: "t" }, quiz))).not.toMatch(/blob|transcript/);
  });

  it("rejects anything inconsistent", () => {
    const bad = [
      { id: "x" }, { quizId: "other" }, { videoId: "aircAruvnKk" }, { quizMode: "exam" }, { status: "done" }, { rev: -1 }, { rev: 1.5 },
      { startedAt: 0 }, { updatedAt: 50 }, { currentIndex: 6 }, { currentIndex: -1 }, { currentIndex: 1.5 }, { responses: null }, { responses: { q9: {} } },
      { status: "submitted", submittedAt: null, result }, { status: "submitted", submittedAt: 200, result: null },
      { status: "in_progress", submittedAt: 200 }, { status: "abandoned", abandonedAt: null }, { status: "in_progress", abandonedAt: 120 },
      { status: "submitted", submittedAt: 200, result: { ...result, total: 0 } }, { status: "submitted", submittedAt: 200, result: { ...result, correct: -1 } },
      { quizMode: "assessment", responses: { q1: { ...emptyResponse(), hintsUsed: 1 } } },
    ];
    for (const over of bad) expect(() => validateAttempt(base(over), quiz), JSON.stringify(over).slice(0, 70)).toThrow(QuizSchemaError);
  });

  it("reports a newer schema version as unsupported rather than invalid", () => {
    expect(reason(() => validateAttempt(base({ schemaVersion: 2 }), quiz))).toBe("unsupported_version");
  });
});
