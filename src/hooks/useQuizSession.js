// The logic behind the quiz screen: setup, generation, the attempt, autosave, conflicts, submit.
//
// All persistence goes through the Stage 3 modules: `store` (quizStore: atomic writes, revision
// checks, safe replacement), `createAutosaver` (serial, coalescing, conflict-aware queue) and
// `api` (quizApi). Nothing here talks to IndexedDB, fetch or localStorage directly, and none of
// that logic is repeated; the hook only decides WHEN to call them and what the learner is told.
//
// Phases: init -> setup -> quiz (question | review) -> results.
//
// Rules this hook keeps:
//   * Nothing in storage changes until the new questions have arrived and validated.
//   * A saved attempt is never discarded by leaving the screen: it stays "in progress" in the
//     store and is offered for resume next time. Starting a new set sets it aside, never deletes it.
//   * If saving the new set fails, the old attempt stays active. There is no unsaved mode.
//   * On an autosave conflict it stops, reloads the saved version and never overwrites it.
//   * Practice scores the first checked answer; Assessment the final selection (quizScoring).
//
// Focus is requested by NAME (requestFocus) and carried out by the screen after the next render,
// on the element marked data-focus="<name>". Nothing here moves focus on mount of restored state.

import { useCallback, useEffect, useRef, useState } from "react";
import { createAutosaver } from "../lib/quizAutosave.js";
import { QuizApiError, insufficientMessage } from "../lib/quizApi.js";
import { scoreAttempt } from "../lib/quizScoring.js";
import { SAVE_ERROR_MESSAGES, saveErrorMessage } from "../lib/quizText.js";
import { useAnnouncer } from "./useAnnouncer.js";

const MAX_HINTS = 2;

export function useQuizSession({ videoId, store, api }) {
  const { message: announcement, announce } = useAnnouncer();

  const [phase, setPhase] = useState("init");
  const [resume, setResume] = useState({ state: "none", activeAttemptId: null });
  const [earlier, setEarlier] = useState(0);
  const [storageProblem, setStorageProblem] = useState("");
  const [gen, setGen] = useState({ busy: false, error: null });
  const [pending, setPending] = useState(null);
  const [work, setWork] = useState(null);
  const [saveState, setSaveState] = useState({ kind: "idle", message: "" });
  const [result, setResult] = useState(null);
  const [banner, setBanner] = useState("");
  const [submit, setSubmit] = useState({ busy: false, error: "" });
  const [focusTick, setFocusTick] = useState(0);

  const workRef = useRef(null);
  const resumeRef = useRef(resume);
  const saverRef = useRef(null);
  const saveKindRef = useRef("idle");
  const busyRef = useRef(false);
  const submittingRef = useRef(false);
  const abortRef = useRef(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const focusRequest = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort(); // a running generation is cancelled; a running SAVE is left to finish
    };
  }, []);

  const requestFocus = useCallback((name) => {
    focusRequest.current = name;
    setFocusTick((n) => n + 1);
  }, []);

  // The screen calls this after a render; it returns the pending focus target once and clears it.
  const takeFocusRequest = useCallback(() => {
    const name = focusRequest.current;
    focusRequest.current = null;
    return name;
  }, []);

  const setSave = useCallback((next) => {
    saveKindRef.current = next.kind;
    setSaveState(next);
  }, []);

  /* ── Reading what is saved for this lecture ─────────────────────────────── */

  const refreshResume = useCallback(async () => {
    try {
      const [active, list] = await Promise.all([store.getActiveAttempt(videoId), store.listAttemptsForVideo(videoId)]);
      if (!mountedRef.current) return active;
      resumeRef.current = active;
      setResume(active);
      setEarlier(list.attempts.filter((a) => a.attempt.status !== "in_progress").length);
      setStorageProblem("");
      return active;
    } catch (err) {
      if (!mountedRef.current) return null;
      const none = { state: "none", activeAttemptId: null };
      resumeRef.current = none;
      setResume(none);
      setEarlier(0);
      setStorageProblem(saveErrorMessage(err));
      return null;
    }
  }, [store, videoId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the saved state when the screen opens
  useEffect(() => { void refreshResume().then(() => { if (mountedRef.current) setPhase("setup"); }); }, [refreshResume]);

  /* ── The attempt on screen ──────────────────────────────────────────────── */

  const resetToSetup = useCallback(async (message) => {
    saverRef.current?.stop();
    saverRef.current = null;
    workRef.current = null;
    setWork(null);
    setResult(null);
    setSave({ kind: "idle", message: "" });
    setBanner(message || "");
    await refreshResume();
    if (!mountedRef.current) return;
    setPhase("setup");
    requestFocus("heading");
  }, [refreshResume, requestFocus, setSave]);

  const handleConflict = useCallback(async (attemptId) => {
    setSave({ kind: "conflict", message: SAVE_ERROR_MESSAGES.conflict });
    try {
      const active = await store.getActiveAttempt(videoId);
      if (!mountedRef.current) return;
      if (active.state === "ready" && active.attempt.id === attemptId) {
        // Show the latest saved version and carry on from ITS revision; nothing is overwritten.
        const w = {
          attemptId, quiz: active.quiz, mode: active.attempt.quizMode, currentIndex: active.attempt.currentIndex,
          responses: active.attempt.responses, view: "question", revealed: {},
        };
        workRef.current = w;
        setWork(w);
        saverRef.current?.reset(active.attempt.rev);
        setSave({ kind: "saved", message: "" });
        setBanner(SAVE_ERROR_MESSAGES.conflict);
        requestFocus("question-heading");
      } else {
        await resetToSetup(SAVE_ERROR_MESSAGES.gone);
      }
    } catch {
      // The saved version could not be read: stay as we are; the conflict message stays visible.
    }
  }, [store, videoId, requestFocus, resetToSetup, setSave]);

  const startSaver = useCallback((attemptId, rev) => {
    saverRef.current?.stop();
    saverRef.current = createAutosaver({
      rev,
      save: (snapshot, expectedRev) => store.saveProgress({ attemptId, expectedRev, ...snapshot }),
      onSaved: () => {
        if (!mountedRef.current) return;
        const recovered = saveKindRef.current === "error";
        setSave({ kind: "saved", message: "" });
        if (recovered) announce("Progress saved again.");
      },
      onConflict: () => { if (mountedRef.current) void handleConflict(attemptId); },
      onError: (error) => { if (mountedRef.current) setSave({ kind: "error", message: saveErrorMessage(error) }); },
    });
  }, [store, announce, handleConflict, setSave]);

  const enter = useCallback((attempt, quiz) => {
    const w = {
      attemptId: attempt.id, quiz, mode: attempt.quizMode, currentIndex: attempt.currentIndex,
      responses: attempt.responses, view: "question", revealed: {},
    };
    workRef.current = w;
    setWork(w);
    startSaver(attempt.id, attempt.rev);
    setSave({ kind: "saved", message: "" });
    setBanner("");
    setSubmit({ busy: false, error: "" });
    setGen({ busy: false, error: null });
    setPending(null);
    setPhase("quiz");
    requestFocus("question-heading");
  }, [startSaver, requestFocus, setSave]);

  const persist = useCallback((next) => {
    if (saveKindRef.current !== "error") setSave({ kind: "saving", message: "" });
    void saverRef.current?.schedule({ currentIndex: next.currentIndex, responses: next.responses });
  }, [setSave]);

  const update = useCallback((change, { save = true } = {}) => {
    const before = workRef.current;
    if (!before) return;
    const next = change(before);
    if (next === before) return;
    workRef.current = next;
    setWork(next);
    if (save) persist(next);
  }, [persist]);

  /* ── Setup: resume, generate, save ──────────────────────────────────────── */

  const continueAttempt = useCallback(() => {
    const current = resumeRef.current;
    if (current.state === "ready") enter(current.attempt, current.quiz);
  }, [enter]);

  const begin = useCallback(async (quiz, mode) => {
    try {
      const started = await store.startAttempt({
        quiz, quizMode: mode, expectedActiveAttemptId: resumeRef.current.activeAttemptId ?? null,
      });
      if (!mountedRef.current) return;
      enter(started.attempt, started.quiz);
    } catch (err) {
      if (!mountedRef.current) return;
      setGen({ busy: false, error: null });
      setPending({ quiz, mode, message: saveErrorMessage(err) });
      announce("The new questions could not be saved.");
    }
  }, [store, enter, announce]);

  const generate = useCallback(async ({ mode, count }) => {
    if (busyRef.current) return; // never two requests at once
    busyRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    const myId = ++requestIdRef.current;
    setGen({ busy: true, error: null });
    setPending(null);
    setBanner("");
    announce("Creating your questions. This can take up to a minute.");
    try {
      const quiz = await api.requestQuiz({ videoId, questionCount: count, signal: controller.signal });
      if (myId !== requestIdRef.current || !mountedRef.current) return;
      if (quiz.status === "insufficient_material") {
        setGen({
          busy: false,
          error: { kind: "insufficient", message: insufficientMessage(quiz.reason), retryable: quiz.reason === "validation_failed" },
        });
        return;
      }
      await begin(quiz, mode);
    } catch (err) {
      if (myId !== requestIdRef.current || !mountedRef.current || (err && err.name === "AbortError")) return;
      const e = err instanceof QuizApiError ? err : new QuizApiError("server");
      setGen({ busy: false, error: { kind: e.kind, message: e.message, retryable: e.retryable } });
    } finally {
      if (myId === requestIdRef.current) busyRef.current = false;
    }
  }, [api, videoId, begin, announce]);

  const cancelGeneration = useCallback(() => {
    abortRef.current?.abort();
    requestIdRef.current += 1;
    busyRef.current = false;
    setGen({ busy: false, error: null });
    announce("Cancelled. No questions were made.");
    requestFocus("start");
  }, [announce, requestFocus]);

  const retrySave = useCallback(async () => {
    if (!pending || busyRef.current) return;
    busyRef.current = true;
    setGen({ busy: true, error: null });
    try {
      await refreshResume(); // the pointer may have moved since; compare against what is saved NOW
      await begin(pending.quiz, pending.mode);
    } finally {
      busyRef.current = false;
    }
  }, [pending, refreshResume, begin]);

  const discardPending = useCallback(() => {
    setPending(null);
    requestFocus("start");
  }, [requestFocus]);

  /* ── The question loop ──────────────────────────────────────────────────── */

  const select = useCallback((questionId, choiceId) => {
    update((w) => ({ ...w, responses: { ...w.responses, [questionId]: { ...w.responses[questionId], choiceId } } }));
  }, [update]);

  const check = useCallback((questionId) => {
    update((w) => {
      const r = w.responses[questionId];
      if (w.mode !== "practice" || r.choiceId === null) return w;
      return {
        ...w,
        responses: {
          ...w.responses,
          [questionId]: { ...r, firstCheckedChoiceId: r.firstCheckedChoiceId ?? r.choiceId, lastCheckedChoiceId: r.choiceId },
        },
      };
    });
    requestFocus("feedback-heading");
  }, [update, requestFocus]);

  const revealHint = useCallback((questionId) => {
    const w = workRef.current;
    if (!w || w.mode !== "practice") return;
    const question = w.quiz.questions.find((q) => q.id === questionId);
    const r = w.responses[questionId];
    if (r.hintsUsed >= Math.min(MAX_HINTS, question.hints.length)) return;
    update((cur) => ({ ...cur, responses: { ...cur.responses, [questionId]: { ...r, hintsUsed: r.hintsUsed + 1 } } }));
    announce(`Hint ${r.hintsUsed + 1}: ${question.hints[r.hintsUsed]}`);
  }, [update, announce]);

  const toggleFlag = useCallback((questionId) => {
    update((w) => ({ ...w, responses: { ...w.responses, [questionId]: { ...w.responses[questionId], flagged: !w.responses[questionId].flagged } } }));
  }, [update]);

  const revealAnswer = useCallback((questionId) => {
    update((w) => ({ ...w, revealed: { ...w.revealed, [questionId]: true } }), { save: false });
    requestFocus("feedback-heading"); // the button that was pressed is gone; keep focus in the feedback
  }, [update, requestFocus]);

  const goTo = useCallback((index) => {
    update((w) => ({ ...w, currentIndex: Math.max(0, Math.min(w.quiz.questions.length - 1, index)), view: "question" }));
    requestFocus("question-heading");
  }, [update, requestFocus]);

  const openReview = useCallback(() => {
    update((w) => ({ ...w, view: "review" }), { save: false });
    requestFocus("review-heading");
  }, [update, requestFocus]);

  /* ── Submit ─────────────────────────────────────────────────────────────── */

  const submitAttempt = useCallback(async () => {
    if (submittingRef.current || !workRef.current) return;
    submittingRef.current = true;
    setSubmit({ busy: true, error: "" });
    const w = workRef.current;
    const saver = saverRef.current;
    try {
      const status = await saver.flush();
      if (status.conflict) { await handleConflict(w.attemptId); return; }
      const done = await store.submitAttempt({
        attemptId: w.attemptId, expectedRev: saver.getRev(), currentIndex: w.currentIndex, responses: w.responses,
      });
      saver.stop();
      if (!mountedRef.current) return;
      // The score is computed here from the final responses, the same way it is on every later read.
      setResult({ attempt: done, quiz: w.quiz, score: scoreAttempt(w.quiz, w.mode, done.responses) });
      workRef.current = null;
      setWork(null);
      setSave({ kind: "idle", message: "" });
      setPhase("results");
      requestFocus("results-heading");
    } catch (err) {
      if (!mountedRef.current) return;
      if (err && err.code === "conflict") await handleConflict(w.attemptId);
      else setSubmit({ busy: false, error: saveErrorMessage(err) });
      return;
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmit((s) => ({ ...s, busy: false }));
    }
  }, [store, handleConflict, requestFocus, setSave]);

  /* ── Leaving ────────────────────────────────────────────────────────────── */

  const startNewSet = useCallback(async () => {
    await resetToSetup("");
  }, [resetToSetup]);

  const retrySaveProgress = useCallback(() => { void saverRef.current?.retry(); }, []);
  const dismissBanner = useCallback(() => setBanner(""), []);

  return {
    phase, resume, earlier, storageProblem, gen, pending, work, saveState, result, banner, submit,
    announcement, announce, focusTick, takeFocusRequest, requestFocus,
    continueAttempt, generate, cancelGeneration, retrySave, discardPending,
    select, check, revealHint, toggleFlag, revealAnswer, goTo, openReview, submitAttempt,
    startNewSet, retrySaveProgress, dismissBanner,
    hasUnsavedChanges: () => Boolean(saverRef.current && saverRef.current.hasPending()),
  };
}
