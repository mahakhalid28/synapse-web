import { useEffect, useRef, useState } from "react";
import { getExplanationPreparationStatus, requestExplanationPreparation, retryExplanationPreparation } from "../api";
import { API_MOCK_MODE } from "../lib/apiConfig";
import { createSpeaker } from "../voice/voiceSpeech";
import { useVoiceAudio } from "../voice/voiceAudio";
import { listLectureRequests, requestLectureExplanation, retryLectureRequest, updateLectureRequest } from "../lib/lectureRequests";

export const DEPTHS = ["brief", "standard", "detailed"];
const title = (value) => value[0].toUpperCase() + value.slice(1);
const keyOf = (id, depth) => `${id}::${depth}`;
export function spokenTimestamp(timestamp = "0:00") {
  const parts = timestamp.split(":").map(Number);
  let seconds = parts.reduce((total, part) => total * 60 + part, 0);
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;
  return `${minutes} minutes ${seconds} seconds`;
}

export function newLectureConversation(videoId = null) {
  const session = { videoId, id: crypto.randomUUID(), heard: new Set(), encountered: new Set(), pending: new Map(), deferred: new Set(), statuses: new Map(),
    triggered: new Set(), selections: new Map(), returnPosition: null, review: null, reviewFinished: false,
    question: null, waiting: null, sequence: 0, requests: new Map(), requestIds: new Map(), progress: new Map() };
  session.selectMoment = (id) => {
    if (session.question?.point.id !== id) {
      session.question = null;
      session.waiting = null;
      session.returnPosition = null;
    }
  };
  session.requestActivation = (point, depth) => { session.activationRequest = { point, depth }; };
  return session;
}

// The lecture owns media. This hook owns only questions, requests and review progress.
export function useExplanationConversation(options) {
  const latest = useRef(options);
  latest.current = options;
  const session = options.session;
  const audioRegistry = useVoiceAudio();
  const [question, setQuestionState] = useState(session.question);
  const questionRef = useRef(session.question);
  const [waiting, setWaiting] = useState(session.waiting);
  const waitingRef = useRef(session.waiting);
  const playingRef = useRef(null);
  const playingKey = useRef(null);
  const requestController = useRef(null);
  const [revision, refresh] = useState(0);
  const speaker = useRef(null);
  if (!speaker.current) speaker.current = createSpeaker({ announce: (text) => latest.current.announce(text) });
  const alive = useRef(true);
  const blocked = useRef(Boolean(session.question || session.waiting));
  const promptBusy = useRef(false);
  const preparedRequests = useRef(new Set());
  const guarded = () => latest.current.guarded() || audioRegistry.isTurnActive();
  const update = () => refresh((n) => n + 1);

  function persist(point, depth, values) {
    const id = session.requestIds.get(keyOf(point.id, depth));
    if (!id) return;
    session.progress.set(id, { ...session.progress.get(id), ...values });
    const pending = session.progress.get(id);
    updateLectureRequest(id, pending).then(() => { if (session.progress.get(id) === pending) session.progress.delete(id); })
      .catch(() => latest.current.progressError?.("Explanation progress could not be saved. Synapse will retry while this lecture is open."));
  }

  async function ingest(item, previousPoint = null, signal) {
    if (!alive.current || signal?.aborted) return;
    previousPoint ||= [...session.requests].find(([key]) => session.requestIds.get(key) === item.id)?.[1].point;
    const depth = item.output_mode === "explanatory" ? "standard" : item.output_mode;
    const point = item.point?.id ? item.point : previousPoint;
    if (!point) return;
    const key = keyOf(point.id, depth);
    const previousKey = previousPoint ? keyOf(previousPoint.id, depth) : key;
    const pending = session.pending.get(previousKey);
    if (previousKey !== key) {
      session.pending.delete(previousKey);
      session.requests.delete(previousKey);
      if (pending) session.pending.set(key, { ...pending, point, depth });
      const q = questionRef.current;
      if (q?.point.id === previousPoint.id && q.depth === depth) {
        const next = { ...q, point };
        questionRef.current = next; session.question = next; setQuestionState(next);
        latest.current.select(point.id, depth);
      }
      if (waitingRef.current?.point.id === previousPoint.id && waitingRef.current.depth === depth) {
        setWaitingFor({ ...waitingRef.current, point });
        latest.current.select(point.id, depth);
      }
    }
    latest.current.registerPoint?.(point, previousPoint?.id);
    session.triggered.add(point.id);
    session.encountered.add(point.id);
    const previousRequestId = session.requestIds.get(key);
    session.requestIds.set(key, item.id);
    session.requests.set(key, { point, depth });
    if (item.heard) session.heard.add(key);
    if (session.heard.has(key)) session.pending.delete(key);
    if (item.dismissed) session.deferred.add(key);
    else if (previousRequestId !== item.id) session.deferred.delete(key);
    if (!session.heard.has(key) && !session.pending.has(key)) session.pending.set(key, { ...pending, point, depth,
      waiting: pending?.waiting ?? false, notified: pending?.notified ?? false });
    let state = item.status;
    if (state === "waiting_for_context") state = "pending";
    if (state === "ready" && !item.saved_explanation_id) state = "generating";
    if (item.saved_explanation_id && !preparedRequests.current.has(item.saved_explanation_id)) {
      await latest.current.prepared?.(item, signal);
      if (!alive.current || signal?.aborted) return;
      preparedRequests.current.add(item.saved_explanation_id);
    }
    session.statuses.set(key, { ...item, status: state, requested: true });
    if (session.heard.has(key) && !item.heard) persist(point, depth, { heard: true });
    const current = questionRef.current;
    if ((state === "failed" || state === "cancelled") && current?.kind !== "failed"
      && current?.point.id === point.id && current.depth === depth) offer(point, depth);
    update();
  }

  function clearQuestion() {
    questionRef.current = null;
    session.question = null;
    setQuestionState(null);
    speaker.current.stop();
  }
  function setWaitingFor(value) {
    waitingRef.current = value;
    session.waiting = value;
    setWaiting(value);
    blocked.current = Boolean(value);
  }
  function ask(kind, point, depth, prompt, choices) {
    latest.current.pause();
    blocked.current = true;
    const next = { id: `${options.videoId}:${session.id}:${++session.sequence}`, kind, point, depth, prompt, choices };
    questionRef.current = next;
    session.question = next;
    setQuestionState(next);
  }
  function name(point) {
    return `${point.title || point.category || "Moment"} at ${spokenTimestamp(point.timestamp)}`;
  }
  function status(point, depth) {
    return session.statuses.get(keyOf(point.id, depth))?.status || (API_MOCK_MODE ? "ready" : "pending");
  }
  function offer(point, depth = "standard", notification = false) {
    session.encountered.add(point.id);
    latest.current.select(point.id, depth);
    const state = status(point, depth);
    if (state === "ready") {
      ask("listen", point, depth,
        `Lecture paused. ${name(point)}. The ${title(depth)} explanation is ready. ${notification ? "Would you like to listen now? Say listen or later to continue the lecture." : "Would you like to listen? Say listen or skip."}`,
        notification ? ["listen", "later"] : ["listen", "skip"]);
    } else if (state === "failed" || state === "cancelled") {
      const item = session.statuses.get(keyOf(point.id, depth));
      const retryable = state !== "cancelled" && item?.retryable !== false && item?.error_code !== "retry_exhausted";
      const reviewing = session.review !== null && latest.current.lectureState === "ended";
      const choices = [...(retryable ? ["retry"] : []), ...(reviewing ? ["next", "finish"] : ["resume"])];
      ask(reviewing ? "review" : "failed", point, depth,
        `The ${title(depth)} explanation for ${name(point)} could not be prepared. Say ${choices.join(", ")}.`, choices);
    } else {
      if (session.statuses.get(keyOf(point.id, depth))?.requested === false) {
        request(point, depth);
        return;
      }
      session.pending.set(keyOf(point.id, depth), { point, depth, waiting: false, notified: false });
      ask("prepare", point, depth, `Lecture paused. The ${title(depth)} explanation for ${name(point)} is still preparing. Say wait to stay here, or resume to continue the lecture. I will let you know when it is ready.`, ["wait", "resume"]);
    }
  }
  function resume() {
    clearQuestion();
    setWaitingFor(null);
    playingRef.current = null;
    playingKey.current = null;
    latest.current.stop();
    const position = session.returnPosition;
    session.returnPosition = null;
    blocked.current = false;
    latest.current.resume(position);
  }
  function skip() {
    const item = questionRef.current || waitingRef.current;
    if (item) session.deferred.add(keyOf(item.point.id, item.depth));
    resume();
  }
  function encounter(point) {
    if (questionRef.current || waitingRef.current || playingRef.current) return;
    session.returnPosition = latest.current.position();
    offer(point, "standard");
  }
  function playbackError() {
    const item = playingRef.current || waitingRef.current;
    if (!item) return;
    playingRef.current = null;
    playingKey.current = null;
    setWaitingFor(null);
    ask("listen", item.point, item.depth, "The explanation audio could not be played. The text is available. Say listen to try again, or resume.", ["listen", "resume"]);
  }
  function listen(point, depth) {
    clearQuestion();
    latest.current.select(point.id, depth);
    session.selections.set(point.id, depth);
    session.deferred.delete(keyOf(point.id, depth));
    const pending = session.pending.get(keyOf(point.id, depth));
    if (pending) pending.notified = true;
    setWaitingFor({ point, depth, playback: true });
    if (options.requestSessionId && !session.requestIds.has(keyOf(point.id, depth))) {
      requestLectureExplanation(options.videoId, point, depth).then((item) => ingest(item, point))
        .catch(() => latest.current.progressError?.("This listening request could not be saved."));
    }
  }
  async function request(point, depth, retry = false) {
    if (latest.current.readOnly) {
      if (latest.current.hasSavedVersion?.(point.id, depth)) {
        clearQuestion();
        setWaitingFor(null);
        latest.current.pause();
        latest.current.select(point.id, depth);
        return;
      }
      latest.current.announce("This depth has no saved explanation. Choose an available saved depth, or start processing from Home.");
      if (latest.current.activate) ask("activate", point, depth,
        `The ${title(depth)} version has not been saved. Say process to prepare it, or later to keep using saved content.`, ["process", "later"]);
      return;
    }
    if (!retry && status(point, depth) === "ready") { listen(point, depth); return; }
    latest.current.stop();
    latest.current.select(point.id, depth);
    session.selections.set(point.id, depth);
    const key = keyOf(point.id, depth);
    session.pending.set(key, { point, depth, waiting: false, notified: false });
    ask("prepare", point, depth, `The ${title(depth)} explanation for ${name(point)} has been requested. Say wait to stay here, or resume to continue the lecture while it prepares.`, ["wait", "resume"]);
    const controller = new AbortController();
    requestController.current?.abort();
    requestController.current = controller;
    try {
      let result;
      const requestId = session.requestIds.get(key);
      if (options.requestSessionId) {
        result = retry && requestId
          ? await retryLectureRequest(options.videoId, requestId, { signal: controller.signal })
          : await requestLectureExplanation(options.videoId, point, depth, { signal: controller.signal });
        await ingest(result, point, controller.signal);
      } else result = API_MOCK_MODE ? { status: "ready" } : await (retry ? retryExplanationPreparation : requestExplanationPreparation)(options.videoId, point.id, depth, { signal: controller.signal });
      if (!alive.current || controller.signal.aborted) return;
      if (!options.requestSessionId) session.statuses.set(key, { ...session.statuses.get(key), ...result });
      update();
    } catch (error) {
      if (!alive.current || controller.signal.aborted) return;
      session.statuses.set(key, { status: "failed", error_code: error.kind });
      const current = questionRef.current;
      if ((current?.point.id === point.id && current?.depth === depth)
        || (waitingRef.current?.point.id === point.id && waitingRef.current?.depth === depth)) {
        session.pending.get(key).notified = true;
        setWaitingFor(null);
        const retryable = !["exhausted", "notRetryable"].includes(error.kind);
        ask("failed", point, depth, `${error.message} Say ${retryable ? "retry or " : ""}resume.`, retryable ? ["retry", "resume"] : ["resume"]);
      }
    }
  }
  function reviewNext() {
    const items = session.review || [];
    const item = items.shift();
    if (!item) {
      clearQuestion();
      setWaitingFor(null);
      blocked.current = false;
      session.reviewFinished = true;
      session.returnPosition = null;
      latest.current.announce("Lecture review finished.");
      return;
    }
    const state = status(item.point, item.depth);
    const preparation = session.statuses.get(keyOf(item.point.id, item.depth));
    const exhausted = state === "failed" && (preparation?.retryable === false || preparation?.error_code === "retry_exhausted");
    const choices = state === "ready" ? ["listen", "next", "finish"] : state === "cancelled" || exhausted ? ["next", "finish"] : state === "failed" ? ["retry", "next", "finish"] : ["wait", "next", "finish"];
    ask("review", item.point, item.depth, `The lecture has ended. ${items.length + 1} explanations remain in this review. ${title(item.depth)} explanation for ${name(item.point)} ${state === "ready" ? "is ready" : state === "failed" ? "could not be prepared" : "is still preparing"}. Say ${choices.join(", ")}.`, choices);
  }
  function ended(pointId, endedDepth) {
    const played = playingRef.current;
    if (!played || played.point.id !== pointId || played.depth !== endedDepth) return;
    playingRef.current = null;
    playingKey.current = null;
    const { point, depth } = played;
    session.heard.add(keyOf(point.id, depth));
    persist(point, depth, { heard: true });
    session.pending.delete(keyOf(point.id, depth));
    ask("satisfaction", point, depth, "The explanation has finished. Was it clear? Say yes to resume the lecture, no to choose another version, or replay to listen again.", ["yes", "no", "replay"]);
    update();
  }
  function answer(choice, questionId = questionRef.current?.id) {
    const q = questionRef.current;
    if (!q || q.id !== questionId || !q.choices.includes(choice) || latest.current.guarded()) return;
    clearQuestion();
    if (choice === "yes" || choice === "no") persist(q.point, q.depth, { satisfaction: choice });
    if (choice === "later" || choice === "skip") persist(q.point, q.depth, { dismissed: true });
    if (choice === "process") { latest.current.activate?.(q.point, q.depth); return; }
    if (["skip", "later", "resume", "yes"].includes(choice)) {
      if (choice === "later") session.deferred.add(keyOf(q.point.id, q.depth));
      if (choice === "skip") session.deferred.add(keyOf(q.point.id, q.depth));
      if (session.review && (choice === "yes" || choice === "resume")) reviewNext();
      else resume();
    } else if (choice === "listen" || choice === "replay") listen(q.point, q.depth);
    else if (choice === "wait") {
      if (session.statuses.get(keyOf(q.point.id, q.depth))?.requested === false) { request(q.point, q.depth); return; }
      session.pending.set(keyOf(q.point.id, q.depth), { point: q.point, depth: q.depth, waiting: true, notified: false });
      setWaitingFor({ point: q.point, depth: q.depth });
    } else if (choice === "no") {
      const depths = DEPTHS.filter((depth) => depth !== q.depth);
      ask("depth", q.point, q.depth, `Choose ${depths.map(title).join(" or ")}. Brief is shorter; Detailed gives a fuller explanation. Say ${depths.join(", ")}, or resume.`, [...depths, "resume"]);
    } else if (DEPTHS.includes(choice)) request(q.point, choice);
    else if (choice === "retry") request(q.point, q.depth, true);
    else if (choice === "next") reviewNext();
    else if (choice === "finish") {
      for (const key of session.pending.keys()) session.deferred.add(key);
      session.review = [];
      reviewNext();
    }
  }

  useEffect(() => {
    alive.current = true;
    questionRef.current = session.question;
    waitingRef.current = session.waiting;
    blocked.current = Boolean(session.question || session.waiting || playingRef.current);
    return () => {
      alive.current = false;
      requestController.current?.abort();
      speaker.current.stop();
      if (playingRef.current) {
        const { point, depth } = playingRef.current;
        persist(point, depth, { partial_seconds: latest.current.explanationPosition?.() || 0 });
        session.question = { id: `${options.videoId}:${session.id}:${++session.sequence}`, kind: "listen", point, depth,
          prompt: `The ${title(depth)} explanation for ${name(point)} was interrupted. Say listen to replay it, or skip to continue the lecture.`, choices: ["listen", "skip"] };
      }
      questionRef.current = null;
      blocked.current = false;
    };
  }, []);

  // Observe real work even after the main screen's finite polling period ends.
  useEffect(() => {
    if (options.preparations) {
      for (const [id, item] of options.preparations) session.statuses.set(keyOf(id, options.depth), item);
    }
  }, [options.preparations, options.depth, session]);

  const requestedDepths = [...new Set([...session.pending.values()].map((item) => item.depth))].sort().join("|");
  useEffect(() => {
    if (API_MOCK_MODE || options.requestSessionId || !requestedDepths || !options.points.length || options.processing) return;
    let cancelled = false;
    const controller = new AbortController();
    let timer;
    async function poll() {
      const depths = requestedDepths.split("|").filter((depth) => depth !== latest.current.depth || !["idle", "available"].includes(latest.current.preparationPhase));
      for (const depth of depths) {
        try {
          const result = await getExplanationPreparationStatus(options.videoId, depth, { signal: controller.signal });
          if (cancelled) return;
          for (const item of result.items) session.statuses.set(keyOf(item.intervention_id, depth), item);
        } catch { /* Keep the pending intent; screen status/recheck remains available. */ }
      }
      if (!cancelled) { update(); timer = setTimeout(poll, 5000); }
    }
    poll();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [options.videoId, options.points.length, options.processing, options.requestSessionId, requestedDepths, session]);

  useEffect(() => {
    if (!options.requestSessionId || options.readOnly) return;
    const controller = new AbortController();
    let timer;
    async function poll() {
      try {
        const items = await listLectureRequests(options.videoId, { signal: controller.signal });
        const requests = new Map();
        for (const item of items) requests.set(keyOf(item.point?.id || item.id, item.output_mode), item);
        for (const item of requests.values()) await ingest(item, null, controller.signal);
        for (const [id, values] of session.progress) {
          await updateLectureRequest(id, values);
          if (session.progress.get(id) === values) session.progress.delete(id);
        }
      } catch (error) {
        if (!controller.signal.aborted) latest.current.progressError?.(error.message || "Explanation status could not be checked. Your request is retained.");
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
    }
    poll();
    if (session.activationRequest) {
      const { point, depth } = session.activationRequest;
      session.activationRequest = null;
      request({ ...point, unresolved: true }, depth);
    }
    return () => { controller.abort(); clearTimeout(timer); };
  }, [options.requestSessionId, options.videoId, options.readOnly, session]);

  // One speech channel for this question; reminders never move focus.
  useEffect(() => {
    if (!question) return;
    let cancelled = false;
    let timer;
    let first = true;
    let delay = 15000;
    const id = question.id;
    async function speak() {
      if (cancelled || questionRef.current?.id !== id) return;
      if (guarded()) { timer = setTimeout(speak, 500); return; }
      latest.current.pause();
      // YouTube may still be buffering/playing after a pause request.
      if (![0, 2, -1, undefined].includes(latest.current.playerState())) { timer = setTimeout(speak, 250); return; }
      if (first) { latest.current.questionHeading?.current?.focus({ preventScroll: true }); first = false; }
      promptBusy.current = true;
      await speaker.current.say(question.prompt + " Press Alt plus T to answer in English after the tone.");
      promptBusy.current = false;
      if (!cancelled) { timer = setTimeout(speak, delay); delay = 30000; }
    }
    speak();
    return () => { cancelled = true; clearTimeout(timer); speaker.current.stop(); promptBusy.current = false; };
  }, [question?.id]);

  useEffect(() => {
    const timer = setInterval(() => { if (audioRegistry.isTurnActive() || latest.current.guarded()) speaker.current.stop(); }, 100);
    return () => clearInterval(timer);
  }, [audioRegistry]);

  useEffect(() => {
    if (guarded() || promptBusy.current) return;
    const wait = waitingRef.current;
    if (wait && !questionRef.current) {
      const state = status(wait.point, wait.depth);
      if (state === "failed" || state === "cancelled") {
        setWaitingFor(null);
        offer(wait.point, wait.depth);
      } else if (state === "ready") {
        if (!wait.playback) listen(wait.point, wait.depth);
        else if (options.activePointId === wait.point.id && options.depth === wait.depth && (options.audioError || options.explanationLoadError)) {
          setWaitingFor(null);
          ask("failed", wait.point, wait.depth, "The explanation audio is unavailable. You can read the text, or say resume to continue the lecture.", ["resume"]);
        } else if (options.audioUrl && options.activePointId === wait.point.id && options.depth === wait.depth) {
          setWaitingFor(null);
          blocked.current = true;
          playingRef.current = wait;
          playingKey.current = keyOf(wait.point.id, wait.depth);
          Promise.resolve(latest.current.play()).catch(() => {
            if (!alive.current || playingRef.current !== wait) return;
            playingRef.current = null;
            ask("listen", wait.point, wait.depth, "The explanation audio could not start. Say listen to try again, or resume.", ["listen", "resume"]);
          });
        }
      }
      return;
    }
    if (questionRef.current || playingRef.current || wait) return;
    for (const [key, item] of session.pending) {
      if (item.notified || session.deferred.has(key)) continue;
      const state = status(item.point, item.depth);
      if (state === "ready" || state === "failed") {
        item.notified = true;
        session.returnPosition ??= latest.current.position();
        offer(item.point, item.depth, true);
        return;
      }
    }
    if (options.lectureState === "ended" && !session.review && !session.reviewFinished) {
      const items = new Map();
      for (const point of options.points) {
        if (point.origin === "manual") continue;
        if (!session.heard.has(keyOf(point.id, "standard"))) items.set(keyOf(point.id, "standard"), { point, depth: "standard" });
      }
      for (const [key, item] of session.pending) if (!session.heard.has(key)) items.set(key, item);
      for (const [key, item] of session.requests) if (!session.heard.has(key)) items.set(key, item);
      session.review = [...items.values()].sort((a, b) => spokenTimestamp(a.point.timestamp).localeCompare(spokenTimestamp(b.point.timestamp), undefined, { numeric: true }));
      reviewNext();
    }
  }, [revision, options.preparations, options.audioUrl, options.audioError, options.explanationLoadError, options.activePointId, options.depth, options.lectureState, question, waiting]);

  return { question, waiting, isBlocked: () => blocked.current, encounter, answer, ended, resume, skip, playbackError,
    requestCurrent: (depth = "standard", context = {}) => {
      if (latest.current.guarded()) return;
      requestController.current?.abort();
      const timestamp = context.lectureSeconds ?? latest.current.position();
      const selectedId = options.readOnly ? options.activePointId : context.currentMomentRef;
      const selected = options.readOnly || context.useSelected || context.playing === "explanation"
        ? options.points.find((point) => point.id === selectedId) : null;
      const point = selected || { id: `request-${crypto.randomUUID()}`, timestampSeconds: timestamp,
        timestamp: `${Math.floor(timestamp / 60)}:${String(Math.floor(timestamp % 60)).padStart(2, "0")}`,
        title: "Requested explanation", origin: "manual", unresolved: true };
      latest.current.pause();
      playingRef.current = null; playingKey.current = null; setWaitingFor(null);
      session.returnPosition ??= latest.current.position();
      request(point, depth);
    },
    holdPlayback: () => {
      speaker.current.stop();
      const item = playingRef.current || waitingRef.current;
      if (!item) return;
      playingRef.current = null;
      setWaitingFor(null);
      offer(item.point, item.depth);
    },
    requestListen: (point, depth) => {
      if (!point || latest.current.guarded()) return;
      requestController.current?.abort();
      if (latest.current.readOnly) {
        clearQuestion();
        latest.current.pause();
        latest.current.play().catch(() => latest.current.announce("Audio is unavailable. You can read the saved text."));
        return;
      }
      latest.current.pause();
      session.returnPosition ??= latest.current.position();
      session.encountered.add(point.id);
      playingRef.current = null;
      playingKey.current = null;
      setWaitingFor(null);
      const state = status(point, depth);
      if (state === "ready") listen(point, depth);
      else if (state === "failed" || state === "cancelled") offer(point, depth);
      else request(point, depth);
    },
    stopSpeech: () => speaker.current.stop(),
    context: () => ({ explanationQuestion: questionRef.current ? { id: questionRef.current.id, choices: questionRef.current.choices } : null, questionPrompt: questionRef.current?.prompt }),
    questionId: () => questionRef.current?.id ?? null,
    manual: (point) => {
      requestController.current?.abort();
      latest.current.stop(); clearQuestion(); setWaitingFor(null); playingRef.current = null;
      if (latest.current.readOnly) { latest.current.select(point.id, session.selections.get(point.id) || options.defaultDepth || "standard"); return; }
      session.returnPosition = latest.current.position(); offer(point, session.selections.get(point.id) || options.defaultDepth || "standard");
    },
  };
}
