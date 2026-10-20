// The quiz screen end to end, against the REAL Stage 3 store (over the project's in-memory
// IndexedDB stand-in) with a mocked API client. No model, backend or network is involved.
// jsdom has no layout engine: what is verified about size/zoom is that text scales through one
// em-based variable, wraps, and has no fixed widths; real 200% zoom needs a human or Electron check.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { expect as vitestExpect } from "vitest";
import { render, screen, waitFor, within, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import QuizScreen from "./QuizScreen";
import { createQuizStore, ATTEMPTS_STORE, ACTIVE_STORE, DB_NAME, DB_VERSION } from "../lib/quizStore.js";
import { QuizApiError } from "../lib/quizApi.js";
import { QUIZ_HIGH_CONTRAST_KEY, QUIZ_TEXT_SCALE_KEY } from "../lib/displayPrefs.js";
import { createFakeIndexedDB } from "../test/fakeIndexedDb.js";
import { OTHER_VIDEO_ID, VIDEO_ID, deepCopy, insufficientQuiz, makeQuestion, makeQuiz, partialQuiz, secondQuiz } from "../test/quizFixtures.js";
import "../test/domMatchers.js";

// The project's matcher set (src/test/domMatchers.js) has no toHaveTextContent; this is the same idea.
vitestExpect.extend({
  toHaveTextContent(el, expected) {
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    const pass = expected instanceof RegExp ? expected.test(text) : expected === "" ? text === "" : text.includes(expected);
    return { pass, message: () => `expected text content ${pass ? "not " : ""}to contain ${expected}, got "${text}"` };
  },
});

// Keys: q1 B, q2 True, q3 B, q4 True, q5 B, q6 True. Hints: q1 two, q2 none, q3 two, q4 one.
const contexts = [];

function createContext({ quiz = makeQuiz(), indexedDB } = {}) {
  const fake = createFakeIndexedDB();
  let now = 1_700_000_000_000;
  let counter = 0;
  const make = () => createQuizStore({
    indexedDB: indexedDB === undefined ? fake.factory : indexedDB, storage: undefined,
    clock: () => (now += 10), newId: () => `attempt-${String((counter += 1)).padStart(4, "0")}`,
  });
  const ctx = {
    fake, make, store: make(),
    api: { requestQuiz: vi.fn(async () => deepCopy(quiz)) },
    onOpenLecture: vi.fn(), onNavigate: vi.fn(), user: userEvent.setup(),
  };
  contexts.push(ctx);
  return ctx;
}

function mount(ctx, props = {}) {
  return render(
    <QuizScreen
      videoId={VIDEO_ID} jobId="job-1" videoTitle="The Animal Cell"
      store={ctx.store} api={ctx.api} onOpenLecture={ctx.onOpenLecture} onNavigate={ctx.onNavigate} {...props}
    />,
  );
}

beforeEach(() => localStorage.clear());
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.store.close();
  vi.restoreAllMocks();
  localStorage.clear();
});

const q = (n) => new RegExp(`^Question ${n} of`);
const heading = (name) => screen.findByRole("heading", { name });
const button = (name) => screen.getByRole("button", { name });
const radio = (name) => screen.getByRole("radio", { name });
const focused = () => document.activeElement;

async function begin(ctx, { mode = "practice", count } = {}) {
  await heading("Set up your practice");
  if (mode === "assessment") await ctx.user.click(radio("Assessment"));
  if (count) await ctx.user.selectOptions(screen.getByLabelText("Number of questions"), String(count));
  await ctx.user.click(button("Create questions"));
  await heading(q(1));
}

const savedAttempt = async (ctx) => (await ctx.store.getActiveAttempt(VIDEO_ID)).attempt;
const waitSaved = (ctx, test) => waitFor(async () => { expect(test(await savedAttempt(ctx))).toBe(true); });

async function rawPut(ctx, storeName, value) {
  const db = await new Promise((resolve, reject) => {
    const request = ctx.fake.factory.open(DB_NAME, DB_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

describe("setup", () => {
  it("has the page heading (focused), the lecture, the shared sidebar, and a Practice-by-default form", async () => {
    const ctx = createContext();
    mount(ctx);
    const h1 = await screen.findByRole("heading", { level: 1, name: "Practice this lecture" });
    expect(focused()).toBe(h1);
    expect(screen.getByText("The Animal Cell")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
    await heading("Set up your practice");
    const mode = screen.getByRole("group", { name: "Mode" });
    expect(within(mode).getAllByRole("radio").map((r) => [r.getAttribute("value"), r.checked])).toEqual([["practice", true], ["assessment", false]]);
    expect(radio("Practice")).toHaveAccessibleDescription(/Up to two hints/);
    expect(radio("Assessment")).toHaveAccessibleDescription(/No hints and no feedback until you submit/);
    const count = screen.getByLabelText("Number of questions");
    expect([...count.options].map((o) => o.value)).toEqual(["5", "6", "7", "8", "9", "10"]);
    expect(count.value).toBe("6");
    expect(count).toHaveAccessibleDescription(/Between 5 and 10/);
    expect(screen.getByText(/made by AI from the lecture's automatic captions/)).toBeInTheDocument();
  });

  it("calls the API with the chosen count and says Assessment is self-assessment", async () => {
    const ctx = createContext();
    mount(ctx);
    await heading("Set up your practice");
    expect(screen.queryByText(/not a secure or proctored test/)).toBeNull();
    await ctx.user.click(radio("Assessment"));
    expect(screen.getByText(/self-assessment, not a secure or proctored test/)).toBeInTheDocument();
    await ctx.user.selectOptions(screen.getByLabelText("Number of questions"), "8");
    await ctx.user.click(button("Create questions"));
    await heading(q(1));
    expect(ctx.api.requestQuiz).toHaveBeenCalledTimes(1);
    expect(ctx.api.requestQuiz.mock.calls[0][0]).toMatchObject({ videoId: VIDEO_ID, questionCount: 8 });
    expect(ctx.api.requestQuiz.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
    expect((await savedAttempt(ctx)).quizMode).toBe("assessment");
  });

  it("refuses a question count outside 5 to 10 without calling the API", async () => {
    const ctx = createContext();
    mount(ctx);
    await heading("Set up your practice");
    const select = screen.getByLabelText("Number of questions");
    act(() => { select.value = "4"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await ctx.user.click(button("Create questions"));
    await waitFor(() => expect(screen.getAllByRole("alert").some((a) => a.textContent.includes("Please choose between 5 and 10 questions."))).toBe(true));
    expect(ctx.api.requestQuiz).not.toHaveBeenCalled();
  });

  it("explains that practice can't start where nothing can be saved (no unsaved mode)", async () => {
    const ctx = createContext({ indexedDB: null }); // no IndexedDB in this environment
    mount(ctx);
    expect(await screen.findByText(/can't be saved on this computer/)).toBeInTheDocument();
    expect(button("Create questions")).toHaveAttribute("aria-disabled", "true");
    await ctx.user.click(button("Create questions"));
    expect(ctx.api.requestQuiz).not.toHaveBeenCalled();
  });
});

describe("generating", () => {
  it("shows progress, blocks a second request, announces once, and can be cancelled", async () => {
    const ctx = createContext();
    let signal;
    ctx.api.requestQuiz.mockImplementation((args) => new Promise((resolve, reject) => {
      signal = args.signal;
      args.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    mount(ctx);
    await heading("Set up your practice");
    await ctx.user.click(button("Create questions"));
    const create = button("Creating questions…");
    expect(create).toHaveAttribute("aria-busy", "true");
    expect(create).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/This can take up to a minute/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Creating your questions. This can take up to a minute."));

    await ctx.user.click(create);
    await ctx.user.click(create);
    expect(ctx.api.requestQuiz).toHaveBeenCalledTimes(1);

    await ctx.user.click(button("Cancel"));
    expect(signal.aborted).toBe(true);
    expect(await screen.findByRole("button", { name: "Create questions" })).toBeInTheDocument();
    expect(focused()).toBe(button("Create questions"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Cancelled. No questions were made."));
    expect(screen.queryByRole("alert")?.textContent ?? "").toBe("");
    expect((await ctx.store.getActiveAttempt(VIDEO_ID)).state).toBe("none"); // nothing was saved
  });

  it("two submits in the same instant (before the screen re-renders) still make only one request", async () => {
    const ctx = createContext();
    ctx.api.requestQuiz.mockImplementation(() => new Promise(() => {}));
    const { container } = mount(ctx);
    await heading("Set up your practice");
    const form = container.querySelector("form");
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(ctx.api.requestQuiz).toHaveBeenCalledTimes(1);
  });

  it("ignores an answer that arrives after Cancel", async () => {
    const ctx = createContext();
    let finish;
    ctx.api.requestQuiz.mockImplementation(() => new Promise((resolve) => { finish = () => resolve(makeQuiz()); }));
    mount(ctx);
    await heading("Set up your practice");
    await ctx.user.click(button("Create questions"));
    await ctx.user.click(button("Cancel"));
    await act(async () => { finish(); });
    expect(screen.queryByRole("heading", { name: q(1) })).toBeNull();
    expect((await ctx.store.getActiveAttempt(VIDEO_ID)).state).toBe("none");
  });

  const errors = [
    ["busy", "The AI service is busy right now. Please try again in a minute.", true],
    ["unavailable", "The AI service didn't respond. Please try again.", true],
    ["unusable", "The AI service returned something we couldn't use. Please try again.", true],
    ["network", "Can't reach the Synapse server. Is it running?", true],
    ["server", "Something went wrong on our side. Please try again later.", false],
    ["videoNotFound", "This video isn't available for practice questions yet.", false],
    ["featureOff", "Practice questions aren't available right now.", false],
    ["forbidden", "The Synapse server didn't accept this request.", false],
    ["invalid", "Please check the number of questions (5 to 10).", false],
  ];
  it.each(errors)("explains a %s failure in plain words and offers Try again only when it helps", async (kind, message, retryable) => {
    const ctx = createContext();
    ctx.api.requestQuiz.mockRejectedValueOnce(new QuizApiError(kind));
    mount(ctx);
    await heading("Set up your practice");
    await ctx.user.click(button("Create questions"));
    const alert = await screen.findByRole("alert", {}, { timeout: 2000 }).then(() => screen.getAllByRole("alert").find((a) => a.textContent.includes("Error:")));
    expect(alert).toHaveTextContent(`Error: ${message}`);
    expect(!!within(alert).queryByRole("button", { name: "Try again" })).toBe(retryable);
    expect(button("Create questions")).not.toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("heading", { name: q(1) })).toBeNull();
    if (retryable) {
      await ctx.user.click(within(alert).getByRole("button", { name: "Try again" }));
      await heading(q(1));
      expect(ctx.api.requestQuiz).toHaveBeenCalledTimes(2);
    }
  });

  it.each([
    ["no_transcript", /doesn't have a usable transcript/, false],
    ["too_short", /too short/, false],
    ["validation_failed", /too few passed our checks/, true],
  ])("treats a %s answer as a message, not a quiz", async (reason, pattern, retryable) => {
    const ctx = createContext();
    ctx.api.requestQuiz.mockResolvedValueOnce({ ...insufficientQuiz(), reason });
    mount(ctx);
    await heading("Set up your practice");
    await ctx.user.click(button("Create questions"));
    const alert = await waitFor(() => {
      const found = screen.getAllByRole("alert").find((a) => a.textContent.includes("Error:"));
      expect(found).toBeTruthy();
      return found;
    });
    expect(alert).toHaveTextContent(pattern);
    expect(!!within(alert).queryByRole("button", { name: "Try again" })).toBe(retryable);
    expect((await ctx.store.getActiveAttempt(VIDEO_ID)).state).toBe("none");
  });

  it("starts the quiz with focus on the first question and saves it", async () => {
    const ctx = createContext();
    mount(ctx);
    await begin(ctx);
    expect(focused()).toBe(screen.getByRole("heading", { name: q(1) }));
    expect((await ctx.store.getActiveAttempt(VIDEO_ID)).state).toBe("ready");
  });

  it("shows the partial notice and ties it to the question heading", async () => {
    const ctx = createContext({ quiz: partialQuiz() });
    mount(ctx);
    await begin(ctx);
    const h = screen.getByRole("heading", { name: "Question 1 of 4" });
    expect(h).toHaveAccessibleDescription(/Only 4 of the 6 questions you asked for/);
  });
});

describe("question screen", () => {
  it("shows one question as a labelled group of native radio buttons", async () => {
    const ctx = createContext();
    mount(ctx);
    await begin(ctx);
    const group = screen.getByRole("group", { name: "Which one is correct for 1?" });
    expect(within(group).getAllByRole("radio").map((r) => r.closest("label").textContent)).toEqual(["A. alpha choice", "B. bravo choice", "C. charlie choice", "D. delta choice"]);
    expect(screen.getByText("0 of 6 answered. Practice.")).toBeInTheDocument();
    expect(screen.queryByText("Statement number 2 holds.")).toBeNull(); // one question at a time
  });

  it("selecting a choice saves it but does not check it", async () => {
    const ctx = createContext();
    mount(ctx);
    await begin(ctx);
    await ctx.user.click(radio(/B\. bravo choice/));
    expect(radio(/B\. bravo choice/).checked).toBe(true);
    expect(screen.queryByRole("heading", { name: /Correct|Not quite/ })).toBeNull();
    expect(button("Check answer")).toHaveAccessibleDescription(/Choosing an answer does not check it/);
    await waitSaved(ctx, (a) => a.responses.q1.choiceId === "b" && a.responses.q1.firstCheckedChoiceId === null);
  });

  it("moves between questions with focus on the new heading and keeps answers", async () => {
    const ctx = createContext();
    mount(ctx);
    await begin(ctx);
    await ctx.user.click(radio(/A\. alpha choice/));
    await ctx.user.click(button("Next question"));
    { const target = await heading(q(2)); expect(focused()).toBe(target); }
    expect(button("Previous question").disabled).toBe(false);
    await ctx.user.click(radio("False"));
    await ctx.user.click(button("Previous question"));
    { const target = await heading(q(1)); expect(focused()).toBe(target); }
    expect(radio(/A\. alpha choice/).checked).toBe(true);
    await ctx.user.click(within(screen.getByRole("navigation", { name: "Questions" })).getByRole("button", { name: /^Question 5/ }));
    { const target = await heading(q(5)); expect(focused()).toBe(target); }
    await waitSaved(ctx, (a) => a.currentIndex === 4 && a.responses.q2.choiceId === "false");
  });

  it("flags a question with a pressed button and shows it in the question list in words", async () => {
    const ctx = createContext();
    mount(ctx);
    await begin(ctx);
    const flag = button("Flag for review");
    expect(flag).toHaveAttribute("aria-pressed", "false");
    await ctx.user.click(flag);
    expect(flag).toHaveAttribute("aria-pressed", "true");
    const list = screen.getByRole("navigation", { name: "Questions" });
    expect(within(list).getByRole("button", { name: "Question 1, not answered, flagged for review" })).toHaveAttribute("aria-current", "step");
    expect(within(list).getByRole("button", { name: "Question 2, not answered" })).not.toHaveAttribute("aria-current");
    await ctx.user.click(radio(/C\. charlie choice/));
    expect(within(list).getByRole("button", { name: "Question 1, answer selected, not checked yet, flagged for review" })).toBeInTheDocument();
  });
});

describe("Practice", () => {
  it("checks an answer: feedback heading gets focus, explanation and a lecture link appear", async () => {
    const ctx = createContext();
    mount(ctx);
    await begin(ctx);
    await ctx.user.click(radio(/B\. bravo choice/));
    await ctx.user.click(button("Check answer"));
    const feedback = await screen.findByRole("heading", { name: /Correct/ });
    expect(focused()).toBe(feedback);
    expect(screen.getByText("You chose B. bravo choice.")).toBeInTheDocument();
    expect(screen.getByText("Explanation for question 1.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check answer" })).toBeNull();
    await ctx.user.click(button("Check in the lecture at 0:00"));
    expect(ctx.onOpenLecture).toHaveBeenCalledWith({ videoId: VIDEO_ID, jobId: "job-1", startSeconds: 0 });
    await waitSaved(ctx, (a) => a.responses.q1.firstCheckedChoiceId === "b" && a.responses.q1.lastCheckedChoiceId === "b");
  });

  it("passes the server-chosen start time of each question to the lecture, in whole seconds", async () => {
    const quiz = makeQuiz();
    quiz.questions[1].evidence = [{ kind: "transcript", start_seconds: 100.9, end_seconds: 190, quote: "Q" }];
    const ctx = createContext({ quiz });
    mount(ctx);
    await begin(ctx);
    await ctx.user.click(button("Next question"));
    await ctx.user.click(radio("True"));
    await ctx.user.click(button("Check answer"));
    await ctx.user.click(await screen.findByRole("button", { name: "Check in the lecture at 1:40" }));
    expect(ctx.onOpenLecture).toHaveBeenCalledWith({ videoId: VIDEO_ID, jobId: "job-1", startSeconds: 100 });
  });

  it("says Not quite for a wrong check, can show the answer, and lets the learner try again", async () => {
    const ctx = createContext();
    mount(ctx);
    await begin(ctx);
    await ctx.user.click(radio(/A\. alpha choice/));
    await ctx.user.click(button("Check answer"));
    const feedback = await screen.findByRole("heading", { name: /Not quite/ });
    expect(focused()).toBe(feedback);
    expect(screen.queryByText(/^The answer is/)).toBeNull();
    await ctx.user.click(button("Show answer"));
    expect(screen.getByText("The answer is B. bravo choice.")).toBeInTheDocument();
    expect(focused()).toBe(screen.getByRole("heading", { name: /Not quite/ }));
    await ctx.user.click(radio(/B\. bravo choice/));
    expect(screen.queryByRole("heading", { name: /Not quite/ })).toBeNull();
    await ctx.user.click(button("Check answer"));
    expect(await screen.findByRole("heading", { name: /Correct/ })).toBeInTheDocument();
    await waitSaved(ctx, (a) => a.responses.q1.firstCheckedChoiceId === "a" && a.responses.q1.lastCheckedChoiceId === "b");
  });

  it("will not check with nothing selected, and says so", async () => {
    const ctx = createContext();
    mount(ctx);
    await begin(ctx);
    const check = button("Check answer");
    expect(check).toHaveAttribute("aria-disabled", "true");
    await ctx.user.click(check);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Choose an answer first, then check it."));
    expect(screen.queryByRole("heading", { name: /Correct|Not quite/ })).toBeNull();
  });

  it("offers up to two hints one at a time, announces each, and stops after the last", async () => {
    const ctx = createContext();
    mount(ctx);
    await begin(ctx);
    const hint = button("Show hint 1 of 2");
    await ctx.user.click(hint);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Hint 1: Think about the setup."));
    expect(screen.getByRole("heading", { name: "Hints" })).toBeInTheDocument();
    expect(screen.getByText("Think about the setup.")).toBeInTheDocument();
    expect(focused()).toBe(hint); // focus stays on the button
    expect(hint).toHaveTextContent("Show hint 2 of 2");
    await ctx.user.click(hint);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Hint 2: Recall the first step."));
    expect(hint).toHaveTextContent("No more hints");
    expect(hint).toHaveAttribute("aria-disabled", "true");
    await ctx.user.click(hint); // aria-disabled does not stop a click: nothing may change
    await ctx.user.click(hint);
    expect(screen.getByRole("heading", { name: "Hints" }).nextElementSibling.querySelectorAll("li")).toHaveLength(2);
    await waitSaved(ctx, (a) => a.responses.q1.hintsUsed === 2);
    expect(screen.queryByText(/could not be saved/)).toBeNull(); // no rejected write from a third hint
    expect(screen.getByRole("status").textContent).not.toMatch(/Hint 3/);
  });

  it("offers only the hints a question has", async () => {
    const ctx = createContext();
    mount(ctx);
    await begin(ctx);
    await ctx.user.click(button("Next question"));
    expect(screen.queryByRole("button", { name: /hint/i })).toBeNull(); // q2 has none
    await ctx.user.click(button("Next question"));
    await ctx.user.click(button("Next question"));
    expect(screen.getByRole("button", { name: "Show hint 1 of 1" })).toBeInTheDocument(); // q4 has one
  });

  it("scores the first checked answer: a wrong first check stays wrong after a correct retry", async () => {
    const ctx = createContext();
    mount(ctx);
    await begin(ctx);
    await ctx.user.click(radio(/A\. alpha choice/));
    await ctx.user.click(button("Check answer"));
    await ctx.user.click(radio(/B\. bravo choice/));
    await ctx.user.click(button("Check answer"));
    await ctx.user.click(button("Next question"));
    await ctx.user.click(radio("True"));
    await ctx.user.click(button("Check answer"));
    await ctx.user.click(button("Review answers"));
    await ctx.user.click(await screen.findByRole("button", { name: "Finish practice" }));
    await ctx.user.click(await screen.findByRole("button", { name: "Finish anyway" }));
    await heading("Your results");
    expect(screen.getByText("1 of 6 correct, 4 unanswered")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Question 1: Not correct" })).toBeInTheDocument();
    expect(screen.getByText("Your first checked answer: A. alpha choice")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Question 2: Correct" })).toBeInTheDocument();
  });

  it("a selected but never-checked question counts as not answered in the results", async () => {
    const ctx = createContext();
    mount(ctx);
    await begin(ctx);
    await ctx.user.click(radio(/B\. bravo choice/));
    await ctx.user.click(screen.getAllByRole("button", { name: "Review answers" })[0]);
    await ctx.user.click(await screen.findByRole("button", { name: "Finish practice" }));
    await ctx.user.click(await screen.findByRole("button", { name: "Finish anyway" }));
    await heading("Your results");
    expect(screen.getByText("0 of 6 correct, 6 unanswered")).toBeInTheDocument();
    expect(screen.getByText("You selected an answer but did not check it.")).toBeInTheDocument();
  });
});

describe("Assessment", () => {
  it("has no Check button, no hints and no feedback, and allows changing answers", async () => {
    const ctx = createContext();
    mount(ctx);
    await begin(ctx, { mode: "assessment" });
    expect(screen.queryByRole("button", { name: "Check answer" })).toBeNull();
    expect(screen.queryByRole("button", { name: /hint/i })).toBeNull();
    expect(screen.queryByText(/Choosing an answer does not check it/)).toBeNull();
    await ctx.user.click(radio(/A\. alpha choice/));
    await ctx.user.click(radio(/B\. bravo choice/));
    expect(radio(/B\. bravo choice/).checked).toBe(true);
    expect(screen.queryByRole("heading", { name: /Correct|Not quite/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Check in the lecture/ })).toBeNull(); // evidence would reveal the answer
    await waitSaved(ctx, (a) => a.quizMode === "assessment" && a.responses.q1.choiceId === "b" && a.responses.q1.lastCheckedChoiceId === null);
  });

  it("lists unanswered and flagged questions in the review and jumps to them", async () => {
    const ctx = createContext();
    mount(ctx);
    await begin(ctx, { mode: "assessment" });
    await ctx.user.click(radio(/B\. bravo choice/));
    await ctx.user.click(button("Flag for review"));
    await ctx.user.click(button("Next question"));
    await ctx.user.click(radio("True"));
    await ctx.user.click(screen.getAllByRole("button", { name: "Review answers" })[0]);
    const review = await heading("Review your answers");
    expect(focused()).toBe(review);
    expect(screen.getByText("2 of 6 answered, 1 flagged for review.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Not answered (4)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Flagged for review (1)" })).toBeInTheDocument();
    await ctx.user.click(button("Go to question 1, answered, flagged for review"));
    { const target = await heading(q(1)); expect(focused()).toBe(target); }
  });

  it("asks before submitting, with Go back focused first and focus returning to Submit", async () => {
    const ctx = createContext();
    mount(ctx);
    await begin(ctx, { mode: "assessment" });
    await ctx.user.click(radio(/B\. bravo choice/));
    await ctx.user.click(screen.getAllByRole("button", { name: "Review answers" })[0]);
    const submit = await screen.findByRole("button", { name: "Submit answers" });
    await ctx.user.click(submit);
    const group = screen.getByRole("group", { name: "Submit your answers?" });
    expect(within(group).getByText(/You have 5 unanswered questions\. They will count as unanswered, and you can't change any answer after submitting\./)).toBeInTheDocument();
    expect(focused()).toBe(within(group).getByRole("button", { name: "Go back" }));
    expect(screen.queryByRole("heading", { name: "Your results" })).toBeNull();
    await ctx.user.click(within(group).getByRole("button", { name: "Go back" }));
    expect(screen.queryByRole("group", { name: "Submit your answers?" })).toBeNull();
    expect(focused()).toBe(screen.getByRole("button", { name: "Submit answers" }));
    expect((await ctx.store.getActiveAttempt(VIDEO_ID)).state).toBe("ready"); // nothing was submitted
  });

  it("submits and scores the final answers, counting a question with no final selection as unanswered", async () => {
    const ctx = createContext();
    mount(ctx);
    await begin(ctx, { mode: "assessment" });
    await ctx.user.click(radio(/A\. alpha choice/));
    await ctx.user.click(radio(/B\. bravo choice/)); // changed: final answer is correct
    await ctx.user.click(button("Next question"));
    await ctx.user.click(radio("False")); // wrong
    await ctx.user.click(screen.getAllByRole("button", { name: "Review answers" })[0]);
    await ctx.user.click(await screen.findByRole("button", { name: "Submit answers" }));
    await ctx.user.click(screen.getByRole("button", { name: "Submit" }));
    const results = await heading("Your results");
    expect(focused()).toBe(results);
    expect(screen.getByText("1 of 6 correct, 4 unanswered")).toBeInTheDocument();
    expect(screen.getByText("Correct: 1")).toBeInTheDocument();
    expect(screen.getByText("Not correct: 1")).toBeInTheDocument();
    expect(screen.getByText("Not answered: 4")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Question 3: Not answered" })).toBeInTheDocument();
    expect(screen.getByText(/Assessment score\. It counts your final answer/)).toBeInTheDocument();
    expect((await ctx.store.getActiveAttempt(VIDEO_ID)).state).toBe("none");
    const saved = (await ctx.store.listAttemptsForVideo(VIDEO_ID)).attempts[0];
    expect(saved.attempt.status).toBe("submitted");
    expect(saved.score).toMatchObject({ correct: 1, incorrect: 1, unanswered: 4 });
  });

  it("an answer typed just before Submit is included (the final snapshot travels with the submit)", async () => {
    const ctx = createContext();
    mount(ctx);
    await begin(ctx, { mode: "assessment" });
    await ctx.user.click(radio(/B\. bravo choice/));
    await ctx.user.click(screen.getAllByRole("button", { name: "Review answers" })[0]);
    await ctx.user.click(await screen.findByRole("button", { name: "Submit answers" }));
    await ctx.user.click(screen.getByRole("button", { name: "Submit" }));
    await heading("Your results");
    expect(screen.getByText("1 of 6 correct, 5 unanswered")).toBeInTheDocument();
  });
});

describe("results", () => {
  async function finishAssessment(ctx) {
    mount(ctx);
    await begin(ctx, { mode: "assessment" });
    await ctx.user.click(radio(/A\. alpha choice/)); // wrong
    await ctx.user.click(screen.getAllByRole("button", { name: "Review answers" })[0]);
    await ctx.user.click(await screen.findByRole("button", { name: "Submit answers" }));
    await ctx.user.click(screen.getByRole("button", { name: "Submit" }));
    await heading("Your results");
  }

  it("lists concepts to revisit with a way back to the lecture at the server-chosen time", async () => {
    const ctx = createContext();
    await finishAssessment(ctx);
    const section = screen.getByRole("heading", { name: "Concepts to revisit" }).parentElement;
    expect(within(section).getAllByRole("listitem")).toHaveLength(6);
    await ctx.user.click(within(section).getByRole("button", { name: "Check in the lecture at 3:20 for Concept 3" }));
    expect(ctx.onOpenLecture).toHaveBeenCalledWith({ videoId: VIDEO_ID, jobId: "job-1", startSeconds: 200 });
  });

  it("explains every question: your answer, the correct answer, the explanation and the evidence link", async () => {
    const ctx = createContext();
    await finishAssessment(ctx);
    const item = screen.getByRole("heading", { name: "Question 1: Not correct" }).closest("li");
    expect(within(item).getByText("Your answer: A. alpha choice")).toBeInTheDocument();
    expect(within(item).getByText("Correct answer: B. bravo choice")).toBeInTheDocument();
    expect(within(item).getByText("Explanation for question 1.")).toBeInTheDocument();
    await ctx.user.click(within(item).getByRole("button", { name: "Check in the lecture at 0:00 (question 1)" }));
    expect(ctx.onOpenLecture).toHaveBeenCalledWith(expect.objectContaining({ startSeconds: 0 }));
    expect(screen.getByText(/may contain mistakes/)).toBeInTheDocument();
  });

  it("'Start a new set' returns to setup, and the finished attempt is kept", async () => {
    const ctx = createContext();
    await finishAssessment(ctx);
    await ctx.user.click(button("Start a new set"));
    await heading("Set up your practice");
    expect(focused()).toBe(screen.getByRole("heading", { level: 1 }));
    expect(screen.getByText("1 earlier practice saved on this computer.")).toBeInTheDocument();
    expect(screen.queryByText(/Continue where you left off/)).toBeNull();
  });
});

describe("autosave and resume", () => {
  it("resumes after leaving: position, selections, hints and flags are restored, and feedback is shown again", async () => {
    const ctx = createContext();
    const first = mount(ctx);
    await begin(ctx);
    await ctx.user.click(button("Show hint 1 of 2"));
    await ctx.user.click(radio(/A\. alpha choice/));
    await ctx.user.click(button("Check answer"));
    await ctx.user.click(button("Flag for review"));
    await ctx.user.click(button("Next question"));
    await ctx.user.click(radio("True"));
    await waitSaved(ctx, (a) => a.currentIndex === 1 && a.responses.q2.choiceId === "true" && a.responses.q1.hintsUsed === 1);
    first.unmount(); // leaving the screen

    mount(ctx);
    expect(await screen.findByText("Continue where you left off")).toBeInTheDocument();
    expect(screen.getByText("Practice: 2 of 6 questions answered, 1 question flagged.")).toBeInTheDocument();
    await ctx.user.click(button("Continue"));
    const h = await heading(q(2));
    expect(focused()).toBe(h);
    expect(radio("True").checked).toBe(true);
    await ctx.user.click(button("Previous question"));
    await heading(q(1));
    expect(radio(/A\. alpha choice/).checked).toBe(true);
    expect(screen.getByText("Think about the setup.")).toBeInTheDocument(); // hint 1 still shown
    expect(button("Show hint 2 of 2")).toBeInTheDocument();
    expect(button("Flag for review")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: /Not quite/ })).toBeInTheDocument(); // feedback for the checked choice is back
    expect(screen.queryByRole("button", { name: "Check answer" })).toBeNull();
  });

  it("does not show stale feedback after resuming when the selection changed after the check", async () => {
    const ctx = createContext();
    const first = mount(ctx);
    await begin(ctx);
    await ctx.user.click(radio(/A\. alpha choice/));
    await ctx.user.click(button("Check answer"));
    await ctx.user.click(radio(/C\. charlie choice/));
    await waitSaved(ctx, (a) => a.responses.q1.choiceId === "c" && a.responses.q1.lastCheckedChoiceId === "a");
    first.unmount();
    mount(ctx);
    await ctx.user.click(await screen.findByRole("button", { name: "Continue" }));
    await heading(q(1));
    expect(radio(/C\. charlie choice/).checked).toBe(true);
    expect(screen.queryByRole("heading", { name: /Not quite|Correct/ })).toBeNull();
    expect(button("Check answer")).toBeInTheDocument();
  });

  it("starting a new set asks first, keeps the old attempt, and defaults to the safe choice", async () => {
    const ctx = createContext();
    const first = mount(ctx);
    await begin(ctx);
    await ctx.user.click(radio(/B\. bravo choice/));
    await waitSaved(ctx, (a) => a.responses.q1.choiceId === "b");
    first.unmount();
    ctx.api.requestQuiz.mockResolvedValueOnce(secondQuiz());

    mount(ctx);
    await ctx.user.click(await screen.findByRole("button", { name: "Start a new set" }));
    const group = screen.getByRole("group", { name: /will be kept and set aside/ });
    expect(group).toHaveTextContent("Your unfinished practice (1 of 6 answered) will be kept and set aside. Start a new set?");
    expect(focused()).toBe(within(group).getByRole("button", { name: "Keep my practice" }));
    expect(ctx.api.requestQuiz).toHaveBeenCalledTimes(1); // asking changed nothing: no new request yet
    await ctx.user.click(within(group).getByRole("button", { name: "Keep my practice" }));
    expect(focused()).toBe(button("Continue"));

    await ctx.user.click(button("Start a new set"));
    await ctx.user.click(button("Yes, start a new set"));
    await ctx.user.click(await screen.findByRole("button", { name: "Create questions" }));
    await heading(q(1));
    const { attempts } = await ctx.store.listAttemptsForVideo(VIDEO_ID);
    expect(attempts.map((a) => a.attempt.status).sort()).toEqual(["abandoned", "in_progress"]);
    const old = attempts.find((a) => a.attempt.status === "abandoned");
    expect(old.attempt.responses.q1.choiceId).toBe("b"); // the earlier answers are preserved
  });

  it("keeps the old attempt when the new set can't be saved, and offers to try again or discard", async () => {
    const ctx = createContext();
    const first = mount(ctx);
    await begin(ctx);
    await ctx.user.click(radio(/B\. bravo choice/));
    await waitSaved(ctx, (a) => a.responses.q1.choiceId === "b");
    const oldId = (await savedAttempt(ctx)).id;
    first.unmount();
    ctx.api.requestQuiz.mockResolvedValue(secondQuiz());

    mount(ctx);
    await ctx.user.click(await screen.findByRole("button", { name: "Start a new set" }));
    await ctx.user.click(button("Yes, start a new set"));
    ctx.fake.failNext({ store: "quizzes", op: "add", error: "QuotaExceededError" });
    await ctx.user.click(await screen.findByRole("button", { name: "Create questions" }));
    const alert = await screen.findByText(/could not be saved/);
    expect(alert.closest("[role=alert]")).toHaveTextContent("not enough storage space");
    expect(screen.getByText("Your earlier practice is still saved and has not changed.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: q(1) })).toBeNull();
    const still = await ctx.store.getActiveAttempt(VIDEO_ID);
    expect(still).toMatchObject({ state: "ready", activeAttemptId: oldId });
    expect(still.attempt.status).toBe("in_progress");

    await ctx.user.click(button("Try saving again"));
    await heading(q(1));
    expect((await ctx.store.getActiveAttempt(VIDEO_ID)).activeAttemptId).not.toBe(oldId);
  });

  it("discarding an unsaved new set changes nothing", async () => {
    const ctx = createContext();
    mount(ctx);
    await heading("Set up your practice");
    ctx.fake.failNext({ store: "quizzes", op: "add", error: "QuotaExceededError" });
    await ctx.user.click(button("Create questions"));
    await ctx.user.click(await screen.findByRole("button", { name: "Discard the new set" }));
    expect(screen.getAllByRole("alert").some((a) => a.textContent.includes("could not be saved"))).toBe(false);
    expect(focused()).toBe(button("Create questions"));
    expect((await ctx.store.getActiveAttempt(VIDEO_ID)).state).toBe("none");
  });

  it("tells the learner when progress can't be saved, and recovers", async () => {
    const ctx = createContext();
    mount(ctx);
    await begin(ctx);
    ctx.fake.failNext({ store: ATTEMPTS_STORE, op: "put", error: "QuotaExceededError" });
    await ctx.user.click(radio(/B\. bravo choice/));
    const alert = await screen.findByText(/not enough storage space to save your progress/);
    expect(alert.closest("[role=alert]")).toHaveTextContent("Error:");
    expect(radio(/B\. bravo choice/).checked).toBe(true); // the answer is still on screen
    await ctx.user.click(button("Try saving again"));
    await waitSaved(ctx, (a) => a.responses.q1.choiceId === "b");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Progress saved again."));
    expect(screen.queryByText(/not enough storage space/)).toBeNull();
  });

  it("does not announce each routine save", async () => {
    const ctx = createContext();
    mount(ctx);
    await begin(ctx);
    await ctx.user.click(radio(/B\. bravo choice/));
    await waitSaved(ctx, (a) => a.responses.q1.choiceId === "b");
    expect(screen.getByRole("status").textContent).not.toMatch(/saved|saving/i);
    expect(screen.getByText(/Progress is saved on this computer as you go/)).toBeInTheDocument();
  });

  it("on a conflict shows the newer saved version and never overwrites it", async () => {
    const ctx = createContext();
    mount(ctx);
    await begin(ctx);
    const attempt = await savedAttempt(ctx);
    const other = ctx.make(); // "another window"
    contexts.push({ store: other });
    await other.saveProgress({ attemptId: attempt.id, expectedRev: attempt.rev, currentIndex: 3, responses: { q4: { choiceId: "true", firstCheckedChoiceId: null, lastCheckedChoiceId: null, hintsUsed: 0, flagged: true } } });

    await ctx.user.click(radio(/C\. charlie choice/)); // this window's write is now stale
    const alert = await screen.findByText("This practice was changed in another window. Showing the latest saved version.");
    expect(alert.closest("[role=alert]")).toBeTruthy();
    expect(await heading(q(4))).toBeInTheDocument(); // the other window's position
    expect(radio("True").checked).toBe(true);
    const stored = await savedAttempt(ctx);
    expect(stored.responses.q1.choiceId).toBeNull(); // the stale write did not land
    expect(stored.rev).toBe(attempt.rev + 1);

    await ctx.user.click(radio("False")); // and saving works again from the new revision
    await waitSaved(ctx, (a) => a.responses.q4.choiceId === "false" && a.rev === attempt.rev + 2);
    await ctx.user.click(button("Dismiss"));
    expect(screen.queryByText(/changed in another window/)).toBeNull();
  });

  it("returns to setup when another window finished or replaced the attempt", async () => {
    const ctx = createContext();
    mount(ctx);
    await begin(ctx);
    const attempt = await savedAttempt(ctx);
    const other = ctx.make();
    contexts.push({ store: other });
    await other.abandonAttempt({ attemptId: attempt.id, expectedRev: attempt.rev });
    await ctx.user.click(radio(/C\. charlie choice/));
    await heading("Set up your practice");
    expect(screen.getByText("This practice was finished or replaced in another window.")).toBeInTheDocument();
    expect(focused()).toBe(screen.getByRole("heading", { level: 1 }));
    expect(screen.getByText("1 earlier practice saved on this computer.")).toBeInTheDocument();
  });

  it("a submit on a stale revision is a conflict, not an overwrite", async () => {
    const ctx = createContext();
    mount(ctx);
    await begin(ctx, { mode: "assessment" });
    const attempt = await savedAttempt(ctx);
    const other = ctx.make();
    contexts.push({ store: other });
    await other.saveProgress({ attemptId: attempt.id, expectedRev: attempt.rev, currentIndex: 2 });
    await ctx.user.click(screen.getAllByRole("button", { name: "Review answers" })[0]);
    await ctx.user.click(await screen.findByRole("button", { name: "Submit answers" }));
    await ctx.user.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByText("This practice was changed in another window. Showing the latest saved version.");
    expect(screen.queryByRole("heading", { name: "Your results" })).toBeNull();
    expect((await ctx.store.getActiveAttempt(VIDEO_ID)).attempt.status).toBe("in_progress");
  });

  it("shows an unreadable saved attempt as a notice, leaves it alone, and still lets a new set start", async () => {
    const ctx = createContext();
    const first = mount(ctx);
    await begin(ctx);
    await waitSaved(ctx, () => true);
    const attempt = await savedAttempt(ctx);
    first.unmount();
    const broken = { ...deepCopy((await ctx.fake.records(DB_NAME, ATTEMPTS_STORE))[0]), currentIndex: 99 };
    await rawPut(ctx, ATTEMPTS_STORE, broken);
    ctx.api.requestQuiz.mockResolvedValueOnce(secondQuiz());

    mount(ctx);
    expect(await screen.findByText(/could not be read, so it can't be continued/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    await ctx.user.click(button("Create questions"));
    await heading(q(1));
    expect(ctx.fake.records(DB_NAME, ATTEMPTS_STORE).find((a) => a.id === attempt.id)).toEqual(broken);
    expect(ctx.fake.records(DB_NAME, ACTIVE_STORE)[0].attemptId).not.toBe(attempt.id);
  });

  it("starts fresh for a different lecture", async () => {
    const ctx = createContext();
    const first = mount(ctx);
    await begin(ctx);
    first.unmount();
    mount(ctx, { videoId: OTHER_VIDEO_ID });
    await heading("Set up your practice");
    expect(screen.queryByText(/Continue where you left off/)).toBeNull();
  });
});

describe("accessibility", () => {
  it("has no axe violations on setup, a Practice question with feedback, the review with its confirmation, and the results", async () => {
    const ctx = createContext();
    const { container } = mount(ctx);
    await heading("Set up your practice");
    expect(await axe(container)).toHaveNoViolations();

    await begin(ctx);
    await ctx.user.click(radio(/A\. alpha choice/));
    await ctx.user.click(button("Show hint 1 of 2"));
    await ctx.user.click(button("Check answer"));
    await screen.findByRole("heading", { name: /Not quite/ });
    expect(await axe(container)).toHaveNoViolations();

    await ctx.user.click(screen.getAllByRole("button", { name: "Review answers" })[0]);
    await ctx.user.click(await screen.findByRole("button", { name: "Finish practice" }));
    expect(await axe(container)).toHaveNoViolations();
    await ctx.user.click(screen.getByRole("button", { name: "Finish anyway" }));
    await heading("Your results");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("can be used by keyboard alone from setup to results", async () => {
    const ctx = createContext();
    mount(ctx);
    await heading("Set up your practice");
    const { user } = ctx;
    // Tab order starts in the sidebar and display controls, then the form; reach "Assessment" and choose it.
    await user.tab();
    let guard = 0;
    while (focused() !== radio("Practice") && guard++ < 40) await user.tab();
    expect(focused()).toBe(radio("Practice"));
    await user.keyboard("{ArrowDown}");
    expect(radio("Assessment").checked).toBe(true);
    while (focused() !== button("Create questions") && guard++ < 80) await user.tab();
    await user.keyboard("{Enter}");
    await heading(q(1));
    expect(focused()).toBe(screen.getByRole("heading", { name: q(1) }));

    await user.tab(); // first radio of the group
    expect(focused().type).toBe("radio");
    await user.keyboard("{ArrowDown}{ArrowDown}"); // B -> C
    expect(radio(/C\. charlie choice/).checked).toBe(true);
    while (focused() !== button("Next question") && guard++ < 120) await user.tab();
    await user.keyboard("{Enter}");
    { const target = await heading(q(2)); expect(focused()).toBe(target); }
    while (focused() !== screen.getAllByRole("button", { name: "Review answers" })[0] && guard++ < 160) await user.tab();
    await user.keyboard(" ");
    { const target = await heading("Review your answers"); expect(focused()).toBe(target); }
    while (focused() !== button("Submit answers") && guard++ < 200) await user.tab();
    await user.keyboard("{Enter}");
    expect(focused()).toBe(screen.getByRole("button", { name: "Go back" }));
    await user.tab();
    expect(focused()).toBe(screen.getByRole("button", { name: "Submit" }));
    await user.keyboard("{Enter}");
    { const target = await heading("Your results"); expect(focused()).toBe(target); }
    expect(screen.getByText("0 of 6 correct, 5 unanswered")).toBeInTheDocument();
  });

  it("every interactive control has a visible focus style class and no control relies on colour alone", async () => {
    const ctx = createContext();
    const { container } = mount(ctx);
    await begin(ctx);
    await ctx.user.click(radio(/A\. alpha choice/));
    await ctx.user.click(button("Check answer"));
    await screen.findByRole("heading", { name: /Not quite/ });
    for (const el of container.querySelectorAll("button, input, select")) {
      const classes = el.className.toString();
      expect(classes.includes("focus-ring") || classes.includes("ds-btn-") || classes.includes("ds-nav-item"), `${el.outerHTML.slice(0, 80)}`).toBe(true);
    }
    // correctness is written as words as well as a symbol
    const feedback = screen.getByRole("heading", { name: /Not quite/ });
    expect(feedback.textContent).toMatch(/Not quite/);
    expect(feedback.querySelector("[aria-hidden=true]")).toBeTruthy();
  });

  it("contains no audio, video, recording or timer", async () => {
    const ctx = createContext();
    const { container } = mount(ctx);
    await begin(ctx);
    expect(container.querySelectorAll("audio, video, canvas")).toHaveLength(0);
    expect(screen.queryByText(/timer|time left|seconds remaining|listen|record/i)).toBeNull();
  });

  it("does not take over keyboard shortcuts", async () => {
    const ctx = createContext();
    mount(ctx);
    await begin(ctx);
    const events = [];
    const spy = (e) => events.push(e.defaultPrevented);
    document.addEventListener("keydown", spy);
    for (const key of ["{Alt>}m{/Alt}", "{Alt>}p{/Alt}", "{Alt>}l{/Alt}", "{Escape}", "{Control>}={/Control}"]) await ctx.user.keyboard(key);
    document.removeEventListener("keydown", spy);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((prevented) => prevented === false)).toBe(true);
  });
});

describe("quiz display settings", () => {
  it("scales text through one em-based variable, saves it under the quiz keys, and announces it", async () => {
    const ctx = createContext();
    mount(ctx);
    await heading("Set up your practice");
    const main = screen.getByRole("main");
    expect(main.style.getPropertyValue("--quiz-scale")).toBe("1");
    await ctx.user.click(button("Make text larger, currently 100 percent"));
    expect(main.style.getPropertyValue("--quiz-scale")).toBe("1.15");
    expect(screen.getByText("Text size 115%")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Text size 115 percent."));
    expect(localStorage.getItem(QUIZ_TEXT_SCALE_KEY)).toBe("1.15");
    await ctx.user.click(button("Make text smaller, currently 115 percent"));
    await ctx.user.click(button("Make text smaller, currently 100 percent"));
    expect(main.style.getPropertyValue("--quiz-scale")).toBe("0.85");
    expect(button("Make text smaller, currently 85 percent")).toHaveAttribute("aria-disabled", "true");
    for (let i = 0; i < 6; i++) await ctx.user.click(button(/Make text larger/));
    expect(main.style.getPropertyValue("--quiz-scale")).toBe("1.6");
    expect(button(/Make text larger, currently 160 percent/)).toHaveAttribute("aria-disabled", "true");
  });

  it("toggles high contrast with a pressed button, remembers it, and keeps it on every phase", async () => {
    const ctx = createContext();
    const first = mount(ctx);
    await heading("Set up your practice");
    const toggle = button("High contrast");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await ctx.user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("main").className).toContain("quiz-contrast");
    expect(localStorage.getItem(QUIZ_HIGH_CONTRAST_KEY)).toBe("true");
    await begin(ctx);
    expect(screen.getByRole("main").className).toContain("quiz-contrast");
    first.unmount();
    mount(ctx);
    await screen.findByRole("heading", { name: "Set up your practice" });
    expect(button("High contrast")).toHaveAttribute("aria-pressed", "true");
    await ctx.user.click(button("High contrast"));
    expect(screen.getByRole("main").className).not.toContain("quiz-contrast");
  });

  it("restores the saved text size and does not touch other storage", async () => {
    localStorage.setItem(QUIZ_TEXT_SCALE_KEY, "1.45");
    localStorage.setItem("synapse_bookmarks", "[]");
    const ctx = createContext();
    mount(ctx);
    await heading("Set up your practice");
    expect(screen.getByRole("main").style.getPropertyValue("--quiz-scale")).toBe("1.45");
    await ctx.user.click(button(/Make text larger/));
    expect(localStorage.getItem("synapse_bookmarks")).toBe("[]");
    expect(Object.keys(localStorage).filter((k) => k.startsWith("synapse_quiz")).sort()).toEqual([QUIZ_TEXT_SCALE_KEY]);
  });

  it("lets long questions, choices and explanations wrap instead of overflowing, with no fixed widths", async () => {
    const long = "word ".repeat(70).trim(); // the longest text the contract allows is 400 / 200 / 600 characters
    const quiz = makeQuiz();
    quiz.questions[0] = makeQuestion(1, {
      prompt: `${long}?`, explanation: "word ".repeat(119).trim(), hints: ["hint ".repeat(39).trim(), "hint ".repeat(39).trim()],
      choices: ["a", "b", "c", "d"].map((id) => ({ id, text: `${id}${"x".repeat(150)} ${long}`.slice(0, 200) })),
    });
    const ctx = createContext({ quiz });
    const { container } = mount(ctx);
    await begin(ctx);
    await ctx.user.click(radio(/^A\./));
    await ctx.user.click(button("Check answer"));
    await ctx.user.click(button("Show hint 1 of 2"));
    await screen.findByRole("heading", { name: /Not quite|Correct/ });
    const main = screen.getByRole("main");
    expect(main.className).toContain("quiz-root"); // overflow-wrap: anywhere
    for (const el of container.querySelectorAll("[style]")) expect(el.getAttribute("style")).not.toMatch(/width|height/);
    expect(container.querySelector("legend").className).toContain("break-words");
    for (const label of container.querySelectorAll("fieldset label span")) expect(label.className).toContain("break-words");
    expect(container.querySelector("fieldset").className).toContain("min-w-0");
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("leaving", () => {
  it("never discards a saved attempt when the screen goes away", async () => {
    const ctx = createContext();
    const view = mount(ctx);
    await begin(ctx);
    await ctx.user.click(radio(/B\. bravo choice/));
    view.unmount(); // immediately, before the autosave has necessarily finished
    await waitFor(async () => {
      const active = await ctx.store.getActiveAttempt(VIDEO_ID);
      expect(active.state).toBe("ready");
      expect(active.attempt.responses.q1.choiceId).toBe("b");
    });
  });

  it("the sidebar and the back button report navigation to the caller", async () => {
    const ctx = createContext();
    const onBack = vi.fn();
    mount(ctx, { onBack });
    await heading("Set up your practice");
    await ctx.user.click(button("Library"));
    expect(ctx.onNavigate).toHaveBeenCalledWith("library");
    await ctx.user.click(button("Back to the lecture"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
