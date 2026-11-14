import { Fragment, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { newLectureConversation } from "./hooks/useExplanationConversation";
import Welcome from "./components/Welcome";
import HelpDialog from "./components/HelpDialog";
import Home from "./components/Home";
import SubjectLectures from "./components/SubjectLectures";
import Timeline from "./components/Timeline";
import Explanation from "./components/Explanation";
import BookmarksScreen from "./components/BookmarksScreen";
import LibraryScreen from "./components/LibraryScreen";
import NotesScreen from "./components/NotesScreen";
import QuizScreen from "./components/QuizScreen";
import Navbar from "./components/Navbar";
import { Login, Signup } from "./components/AccountForm";
import { developmentAccess } from "./lib/accountPolicy";
import * as processingApi from "./api";
import { ensureLectureSession, releaseLectureSession, LECTURE_SESSION_EXPIRED } from "./lib/lectureRequests";
import { getLibrary } from "./storage";
import { isValidVideoId } from "./lib/askApi";
import { quizEnabled } from "./lib/quizFlag";
import { safeStartSeconds } from "./lib/lectureSeek";
import { needsWelcome } from "./lib/onboardingPrefs";
import { voiceControlEnabled } from "./lib/voiceFlag";
import VoiceControl from "./voice/VoiceControl";
import { useVoiceActions } from "./voice/voiceActions";
import { getSavedLibrary, getSavedList, PERSONAL_CHANGED, personalRequest } from "./lib/personalApi";
import { updatePersonalSummary } from "./storage";
import { ACCOUNT_CHANGED, currentAccount, initializeAccount, LOCAL_PROFILE_ID, captureAccount, assertAccount, logout, prepareAccountChange } from "./lib/accountSession";

const PROCESSING_SESSION_KEY = "synapse_active_processing_job";
const processingSessionKey = () => {
  const id = currentAccount().user?.id;
  return id === LOCAL_PROFILE_ID ? PROCESSING_SESSION_KEY : `${PROCESSING_SESSION_KEY}:${id || "signed-out"}`;
};

function readProcessingSession() {
  try {
    const value = JSON.parse(sessionStorage.getItem(processingSessionKey()));
    return value?.processingJobId && value?.videoId ? value : null;
  } catch {
    return null;
  }
}

function readSavedTheme() {
  try {
    return globalThis.localStorage?.getItem("synapse_theme") || "paper";
  } catch {
    return "paper";
  }
}

function saveTheme(theme) {
  try {
    globalThis.localStorage?.setItem("synapse_theme", theme);
  } catch {
    // Theme changes remain usable for this session when storage is unavailable.
  }
}

function shouldAcceptProcessingStatus(current, next) {
  if (!current) return true;
  const currentAttempt = Number(current.attempt_count ?? 0);
  const nextAttempt = Number(next.attempt_count ?? currentAttempt);
  if (nextAttempt !== currentAttempt) return nextAttempt > currentAttempt;
  const terminal = new Set(["cancelled", "succeeded", "failed"]);
  if (terminal.has(current.status)) return terminal.has(next.status);
  if (current.status === "cancelling") {
    return !["queued", "running"].includes(next.status);
  }
  return true;
}

// This subtree is mounted only after identity is resolved. Its personal reads,
// processing restoration and voice navigation cannot run on account screens.
function StudyApp({ theme, setTheme, accountControls, notice }) {
  const [accountRevision, setAccountRevision] = useState(0);
  const [accountNotice, setAccountNotice] = useState("");
  const [startup] = useState(() => {
    const restoredProcessing = readProcessingSession();
    return {
      restoredProcessing,
      initialScreen: restoredProcessing ? "home" : needsWelcome() ? "welcome" : "home",
    };
  });
  const [screen,  setScreen]  = useState(startup.initialScreen);
  const [jobInfo, setJobInfo] = useState(null);
  const [personalSummary, setPersonalSummary] = useState([]);
  const openingToken = useRef(0);
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const account = captureAccount();
      try {
        const [lectures, bookmarks] = await Promise.all([getSavedLibrary(), getSavedList("bookmarks")]);
        if (!alive) return;
        assertAccount(account);
        updatePersonalSummary(lectures, bookmarks);
        setPersonalSummary(lectures);
      } catch { /* Collection screens provide explicit loading/retry errors. */ }
    };
    void refresh();
    window.addEventListener(PERSONAL_CHANGED, refresh);
    window.addEventListener(ACCOUNT_CHANGED, refresh);
    return () => { alive = false; window.removeEventListener(PERSONAL_CHANGED, refresh); window.removeEventListener(ACCOUNT_CHANGED, refresh); };
  }, []);
  const [cleanupFailure, setCleanupFailure] = useState(null);
  const [requestSession, setRequestSession] = useState(null);
  const lastLectureView = useRef(null);
  const lastReadOnly = useRef(false);
  const lectureOperations = useRef(Promise.resolve());
  const activeLectureVideo = ["explanation", "timeline"].includes(screen) ? jobInfo?.videoId : null;
  const lectureConversation = useMemo(() => newLectureConversation(activeLectureVideo), [activeLectureVideo]);
  useEffect(() => {
    const expired = (event) => {
      if (lastLectureView.current !== event.detail.videoId) return;
      setRequestSession(null);
      setCleanupFailure({ videoId: event.detail.videoId, operation: "session" });
    };
    window.addEventListener(LECTURE_SESSION_EXPIRED, expired);
    return () => window.removeEventListener(LECTURE_SESSION_EXPIRED, expired);
  }, []);
  useEffect(() => {
    const current = ["explanation", "timeline"].includes(screen) ? jobInfo?.videoId : null;
    const previous = lastLectureView.current;
    const previousReadOnly = lastReadOnly.current;
    lastReadOnly.current = Boolean(jobInfo?.readOnly);
    lastLectureView.current = current;
    if (previous !== current || previousReadOnly !== Boolean(jobInfo?.readOnly)) {
      const reopen = current && (!jobInfo?.promise || jobInfo?.processingStatus?.status === "succeeded");
      lectureOperations.current = lectureOperations.current.catch(() => {}).then(async () => {
        if (previous && !previousReadOnly) {
          try { await releaseLectureSession(previous); }
          catch { setCleanupFailure({ videoId: previous, operation: "stop" }); return; }
        }
        if (current && !jobInfo?.readOnly) {
          try {
            const id = await ensureLectureSession(current);
            if (lastLectureView.current === current) setRequestSession({ videoId: current, id });
          } catch {
            setCleanupFailure({ videoId: current, operation: "session" });
          }
        }
        if (reopen && !jobInfo?.readOnly && lastLectureView.current === current) {
          try { await processingApi.openLectureExplanations(current); }
          catch { setCleanupFailure({ videoId: current, operation: "open" }); }
        }
      });
    }
  }, [screen, jobInfo?.videoId, jobInfo?.promise, jobInfo?.processingStatus?.status, jobInfo?.readOnly]);
  const [exploreSubject, setExploreSubject] = useState(null);
  // The lecture a quiz belongs to, fixed when "Practice this lecture" is pressed. The quiz screen and
  // every "Check in the lecture" are checked against it, so a quiz is never tied to another video.
  const [quizInfo, setQuizInfo] = useState(null);
  // False only on the app's very first render, so the skip link and sidebar
  // stay first in tab order for a first-time visitor. Once the user has left
  // Home at least once, any later return is a real in-app navigation and
  // should move focus to the H1 (Fix 6's "reverse direction").
  const [hasLeftHome, setHasLeftHome] = useState(false);

  // ── Theme ──────────────────────────────────────────────────────────────────

  // A screen change here is a view swap, not a page load, so a screen reader
  // is told nothing unless focus moves. Land on the new screen's <h1> (made
  // programmatically focusable) so it announces "<title>, heading level 1".
  // Skipped on the very first render so the skip link stays first in tab
  // order for a first-time visitor. Timeline renders its <h1> only after its
  // data loads, so it focuses it itself (see Timeline.jsx).
  // Compares against the screen last handled rather than flipping a "first
  // run" flag: React StrictMode (dev) runs this effect twice on mount, and a
  // flag let the second run steal focus to the H1 on cold load.
  const handledScreenRef = useRef(screen);
  useEffect(() => {
    if (handledScreenRef.current === screen) return;
    handledScreenRef.current = screen;
    if (screen === "timeline") return;
    const h1 = document.querySelector("main h1");
    if (h1) {
      h1.setAttribute("tabindex", "-1");
      h1.focus({ preventScroll: true });
    }
  }, [screen]);

  // Window/tab title per screen (what a screen reader says on alt-tab and
  // NVDA+T). The lecture screen sets its own, naming the current moment.
  useEffect(() => {
    const titles = {
      welcome: "Welcome",
      home: "Start a study session",
      subject: exploreSubject ? `${exploreSubject} lectures` : "Lectures",
      timeline: "Lecture timeline",
      bookmarks: "Bookmarks",
      library: "My Library",
      notes: "Voice notes",
      quiz: "Practice this lecture",
    };
    if (titles[screen]) document.title = `${titles[screen]} – Synapse`;
  }, [screen, exploreSubject]);


  // ── HOME -> EXPLANATION (processing now happens inline, no blocking screen) ─
  const isProcessingRef = useRef(false);
  const processingControllerRef = useRef(null);
  const processingActionControllerRef = useRef(null);
  const processingTokenRef = useRef(null);
  const restoredProcessingRef = useRef(startup.restoredProcessing);
  const [processingAction, setProcessingAction] = useState(null);
  const [processingActionError, setProcessingActionError] = useState(null);

  useEffect(() => {
    const changed = () => {
      openingToken.current++;
      // Dispose private views without invoking lecture open/cancel navigation.
      lastLectureView.current = null;
      lastReadOnly.current = false;
      processingTokenRef.current = null;
      processingControllerRef.current?.abort(); // stop polling, not the server job
      processingActionControllerRef.current?.abort();
      isProcessingRef.current = false;
      restoredProcessingRef.current = null;
      setJobInfo(null);
      setRequestSession(null);
      setQuizInfo(null);
      setPersonalSummary([]);
      setCleanupFailure(null);
      setScreen(needsWelcome() ? "welcome" : "home");
      setAccountRevision((value) => value + 1);
      setAccountNotice(currentAccount().status === "invalid" ? "Your session ended. Sign in again to access your account data." : "");
    };
    window.addEventListener(ACCOUNT_CHANGED, changed);
    return () => window.removeEventListener(ACCOUNT_CHANGED, changed);
  }, []);

  const startProcessing = (
    { url, videoId, mode, metadata = null },
    { processingJobId = null, retry = false, reconnect = false, resume = false } = {},
  ) => {
    const sessionKey = processingSessionKey();
    if (isProcessingRef.current && !resume) return;
    isProcessingRef.current = true;
    processingControllerRef.current?.abort();
    const controller = new AbortController();
    const token = Symbol("processing-request");
    processingControllerRef.current = controller;
    processingTokenRef.current = token;
    processingApi.resetMockTimer();
    const onStatus = (status) => {
        if (resume && status.status !== "cancelled") {
          setProcessingAction(null);
        }
        setJobInfo((current) =>
          current?.processingToken === token &&
          shouldAcceptProcessingStatus(current.processingStatus, status)
            ? {
                ...current,
                jobId: status.jobId || current.jobId,
                processingJobId: status.jobId || current.processingJobId,
                processingStatus: status,
              }
            : current,
        );
      };
    const operation = Promise.resolve().then(() => reconnect
      ? processingApi.reconnectProcessingJob(processingJobId, videoId, {
            signal: controller.signal,
            onStatus,
          })
      : resume
        ? processingApi.resumeProcessingJob(processingJobId, videoId, {
            signal: controller.signal,
            onStatus,
          })
        : processingApi.processVideo({
            url,
            videoId,
            mode,
            signal: controller.signal,
            jobId: processingJobId,
            retry,
            onStatus,
          }));
    const monitoredOperation = resume
      ? operation.catch((error) => {
          if (processingTokenRef.current === token) {
            setProcessingActionError(
              error?.message || "Could not resume processing. Please try again.",
            );
            setProcessingAction(null);
          }
          return { jobId: processingJobId, videoId, status: "cancelled" };
        })
      : operation;
    const promise = monitoredOperation
      .then((result) => {
        if (result?.status !== "cancelled") {
          try {
            sessionStorage.removeItem(sessionKey);
          } catch {
            // Completion is unaffected when session storage is unavailable.
          }
        }
        return result;
      })
      .finally(() => {
        if (processingTokenRef.current === token) {
          isProcessingRef.current = false;
          processingControllerRef.current = null;
          if (resume) setProcessingAction(null);
        }
      });
    setJobInfo({
      jobId: processingJobId || videoId,
      processingJobId,
      videoId,
      url,
      mode,
      promise,
      processingToken: token,
      processingStatus: resume && jobInfo?.processingStatus
        ? jobInfo.processingStatus
        : {
            status: "queued",
            stage: "queued",
            message: reconnect
              ? "Reconnecting to this processing job…"
              : "Creating or joining the shared processing job.",
          },
      lectureMetadata: metadata,
    });
    setHasLeftHome(true);
    setScreen("explanation");
  };
  const handleProcess = (request) => {
    openingToken.current++;
    if (request.resume) return handleOpenLibraryExplanation({ ...request.metadata, videoId: request.videoId, jobId: request.videoId, mode: request.mode, autoPlay: false });
    return startProcessing(request);
  };

  const handleRetryProcessing = () => {
    if (!jobInfo) return;
    startProcessing(
      {
        url: jobInfo.url,
        videoId: jobInfo.videoId,
        mode: jobInfo.mode,
        metadata: jobInfo.lectureMetadata,
      },
      {
        processingJobId: jobInfo.processingJobId,
        retry: Boolean(jobInfo.processingJobId),
      },
    );
  };

  const handleCancelProcessing = async () => {
    const processingJobId = jobInfo?.processingJobId;
    const token = jobInfo?.processingToken;
    if (!processingJobId || processingAction) return;
    setProcessingAction("cancel");
    setProcessingActionError(null);
    processingActionControllerRef.current?.abort();
    const actionController = new AbortController();
    processingActionControllerRef.current = actionController;
    try {
      const status = await processingApi.cancelProcessingJob(
        processingJobId,
        jobInfo.videoId,
        { signal: actionController.signal },
      );
      setJobInfo((current) =>
        current?.processingToken === token &&
        shouldAcceptProcessingStatus(current.processingStatus, status)
          ? { ...current, processingStatus: {
              ...status,
              jobId: status.job_id,
              videoId: status.video_id,
              message: status.status === "cancelled"
                ? "Processing cancelled. Completed explanations are saved."
                : status.status === "succeeded"
                  ? "Initial processing completed. Explanations may still be preparing."
                  : status.status === "failed"
                    ? "Processing failed."
                    : "Cancelling processing…",
            } }
          : current,
      );
    } catch (error) {
      if (actionController.signal.aborted) return;
      setProcessingActionError(
        error?.message || "Could not cancel processing. The current backend status is unchanged.",
      );
    } finally {
      if (processingActionControllerRef.current === actionController) {
        processingActionControllerRef.current = null;
        setProcessingAction(null);
      }
    }
  };

  const handleResumeProcessing = () => {
    if (!jobInfo?.processingJobId || processingAction) return;
    setProcessingAction("resume");
    setProcessingActionError(null);
    startProcessing(
      {
        url: jobInfo.url,
        videoId: jobInfo.videoId,
        mode: jobInfo.mode,
        metadata: jobInfo.lectureMetadata,
      },
      { processingJobId: jobInfo.processingJobId, resume: true },
    );
  };

  useEffect(() => {
    const restored = restoredProcessingRef.current;
    restoredProcessingRef.current = null;
    if (!restored) return;
    startProcessing(restored, {
      processingJobId: restored.processingJobId,
      reconnect: true,
    });
    // The persisted job is intentionally consumed once on mount. Re-running
    // this effect would create competing monitors for the same durable job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const processingJobId = jobInfo?.processingJobId;
    if (!processingJobId) return;
    try {
      sessionStorage.setItem(processingSessionKey(), JSON.stringify({
        processingJobId,
        videoId: jobInfo.videoId,
        url: jobInfo.url,
        mode: jobInfo.mode,
        metadata: jobInfo.lectureMetadata,
      }));
    } catch {
      // Processing remains usable when session storage is unavailable.
    }
  }, [
    jobInfo?.processingJobId,
    jobInfo?.processingStatus?.status,
    jobInfo?.videoId,
    jobInfo?.url,
    jobInfo?.mode,
    jobInfo?.lectureMetadata,
  ]);

  useEffect(() => () => {
    processingTokenRef.current = null;
    processingControllerRef.current?.abort();
    processingActionControllerRef.current?.abort();
    processingControllerRef.current = null;
    processingActionControllerRef.current = null;
  }, []);

  // ── TIMELINE -> EXPLANATION ────────────────────────────────────────────────
  const handleOpenPoint = (point) => {
    lectureConversation.selectMoment(point.id);
    setJobInfo({ ...jobInfo, pointId: point.id });
    setScreen("explanation");
  };

  // ── EXPLANATION -> TIMELINE ────────────────────────────────────────────────
  // Carries the currently-active point over via the same jobInfo.pointId
  // field Explanation/Bookmarks/Library already use — Timeline opens with
  // that point pre-selected instead of always defaulting to the first one,
  // so the active intervention survives the round trip. No second source of
  // truth for "current point" is introduced.
  const handleOpenTimeline = (pointId) => {
    setJobInfo({ ...jobInfo, pointId });
    setScreen("timeline");
  };

  // ── BOOKMARKS -> EXPLANATION ───────────────────────────────────────────────
  const handleOpenBookmark = (bookmark) => {
    if (bookmark.ownerId && bookmark.ownerId !== currentAccount().user?.id) return;
    openingToken.current++;
    setJobInfo({
      jobId:        bookmark.jobId,
      videoId:      bookmark.videoId,
      pointId:      bookmark.pointId,
      mode:         bookmark.mode,
      bookmarkData: bookmark,
      lectureMetadata: bookmark,
      savedVersionId: bookmark.savedVersionId,
      readOnly: true,
      startSeconds: bookmark.lectureSeconds,
      autoPlay: bookmark.autoPlay !== false,
    });
    setScreen("explanation");
  };

  // ── LIBRARY -> EXPLANATION ─────────────────────────────────────────────────
  const handleOpenLibraryExplanation = async (item) => {
    if (item.ownerId && item.ownerId !== currentAccount().user?.id) return;
    const token = ++openingToken.current;
    const { pointId, videoId, jobId, mode, autoPlay } = item;
    let startSeconds = item.lectureSeconds;
    if (!pointId && startSeconds == null) {
      try { startSeconds = (await personalRequest(`playback/${encodeURIComponent(videoId)}`)).position_seconds; }
      catch { /* A new lecture has no playback position yet. */ }
      if (token !== openingToken.current) return;
    }
    setJobInfo({
      jobId,
      videoId,
      pointId,
      mode,
      autoPlay: !!autoPlay,
      lectureMetadata: item,
      savedVersionId: item.savedVersionId,
      readOnly: true,
      startSeconds,
    });
    setScreen("explanation");
  };

  // ── VOICE NOTES -> EXPLANATION ─────────────────────────────────────────────
  // Opens the note's lecture cued at the note's time and paused (the learner
  // presses Play), like opening a bookmark. The note doesn't store the depth
  // mode, so it is looked up from the library entry for the same video.
  const handleOpenNote = (note) => {
    if (note.ownerId && note.ownerId !== currentAccount().user?.id) return;
    openingToken.current++;
    if (note.savedExplanation) { handleOpenBookmark(note.savedExplanation); return; }
    const known = getLibrary().find((e) => e.videoId === note.videoId);
    setJobInfo({
      jobId:        note.jobId || note.videoId,
      videoId:      note.videoId,
      pointId:      note.pointId || undefined,
      mode:         known?.mode || "standard",
      startSeconds: note.lectureSeconds,
      lectureMetadata: known || note,
      readOnly: true,
    });
    setScreen("explanation");
  };

  // ── LECTURE -> QUIZ ────────────────────────────────────────────────────────
  // Opens the quiz screen for the lecture on screen. It only navigates: nothing is requested from the
  // server until the learner presses "Create questions" there. Does nothing when the feature flag is
  // off or the lecture has no valid video id.
  const handleStartQuiz = () => {
    if (!quizEnabled() || !jobInfo || !isValidVideoId(jobInfo.videoId)) return;
    setQuizInfo({ videoId: jobInfo.videoId, jobId: jobInfo.jobId || jobInfo.videoId });
    setScreen("quiz");
  };

  // ── QUIZ -> LECTURE ────────────────────────────────────────────────────────
  // Back: the same lecture, mode and moment as before, with nothing to cue or play. (Leaving the lecture
  // screen always destroys its player, so the playhead itself is not kept; see the contract, section 2.)
  const handleBackFromQuiz = () => {
    if (!jobInfo) { setScreen("home"); return; }
    setJobInfo({ ...jobInfo, startSeconds: undefined, autoPlay: false });
    setScreen("explanation");
  };

  // "Check in the lecture": the quiz's own lecture, cued at the server-chosen time and PAUSED (the
  // learner presses Play), the same route Voice Notes uses. A time that is missing, negative, not a
  // number or out of range becomes "no seek". A request for a different video is ignored.
  const handleOpenQuizLecture = ({ videoId, startSeconds } = {}) => {
    if (!quizInfo || videoId !== quizInfo.videoId) return;
    const known = getLibrary().find((e) => e.videoId === videoId);
    setJobInfo({
      jobId:        quizInfo.jobId,
      readOnly: true,
      videoId,
      mode:         known?.mode || jobInfo?.mode || "standard",
      startSeconds: safeStartSeconds(startSeconds),
    });
    setScreen("explanation");
  };

  // ── SIDEBAR NAVIGATION ─────────────────────────────────────────────────────
  const handleNavigate = (key) => {
    openingToken.current++;
    processingControllerRef.current?.abort();
    processingActionControllerRef.current?.abort();
    processingControllerRef.current = null;
    processingActionControllerRef.current = null;
    processingTokenRef.current = null;
    isProcessingRef.current = false;
    if (key === "home") {
      setJobInfo(null);
      setExploreSubject(null);
      setScreen("home");
    } else if (key === "bookmarks" || key === "library" || key === "notes") {
      setHasLeftHome(true);
      setScreen(key);
    }
  };

  // ── HOME -> SUBJECT LECTURES ───────────────────────────────────────────────
  const handleExploreSubject = (subject) => {
    setHasLeftHome(true);
    setExploreSubject(subject);
    setScreen("subject");
  };

  const handleWelcomeDone = () => {
    setHasLeftHome(true);
    setScreen("home");
  };

  const helpVoiceRef = useRef(null);
  const registerHelpInterruption = useCallback((control) => {
    helpVoiceRef.current = control;
    return () => { if (helpVoiceRef.current === control) helpVoiceRef.current = null; };
  }, []);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpNotice, setHelpNotice] = useState("");
  const helpGuardRef = useRef(null);
  // The screen on show calls this to register its guard; it returns the function that removes it.
  const registerHelpGuard = useCallback((guard) => {
    helpGuardRef.current = guard;
    return () => {
      if (helpGuardRef.current === guard) helpGuardRef.current = null;
    };
  }, []);
  const helpOpenerRef = useRef(null);
  const restoreHelpFocusRef = useRef(false);

  // `source` is the click event from a Help button (its button gets focus back on close) or an element.
  const openHelp = (source) => {
    if (helpOpen) return;
    const result = helpGuardRef.current?.beforeHelp?.() ?? { blocked: false };
    if (result.blocked) return;
    helpVoiceRef.current?.interrupt();
    helpOpenerRef.current = source?.currentTarget ?? source ?? document.activeElement;
    setHelpNotice(result.notice || "");
    setHelpOpen(true);
  };
  const closeHelp = () => {
    helpGuardRef.current?.afterHelp?.();
    restoreHelpFocusRef.current = true;
    setHelpOpen(false);
  };
  // Runs after the screen behind is no longer inert, so focus can go back to where Help was opened
  // (or, if that is gone, to the page heading).
  useEffect(() => {
    if (helpOpen || !restoreHelpFocusRef.current) return;
    restoreHelpFocusRef.current = false;
    const opener = helpOpenerRef.current;
    helpOpenerRef.current = null;
    if (opener && opener.isConnected) {
      opener.focus();
      return;
    }
    const h1 = document.querySelector("main h1");
    if (h1) {
      h1.setAttribute("tabindex", "-1");
      h1.focus({ preventScroll: true });
    }
  }, [helpOpen]);

  // Global voice commands delegate to the same navigation, theme and lecture
  // handlers as the visible controls. Welcome deliberately registers none.
  useVoiceActions(
    screen === "welcome"
      ? {}
      : {
          navigate_home: () => handleNavigate("home"),
          navigate_library: () => handleNavigate("library"),
          navigate_bookmarks: () => handleNavigate("bookmarks"),
          navigate_notes: () => handleNavigate("notes"),
          set_theme: ({ theme: next }) => setTheme(next),
          explore_subject: ({ subject }) => handleExploreSubject(subject),
          ...(screen === "home"
            ? {}
            : {
                continue_lecture: () => {
                  const last = getLibrary().find((entry) => entry.videoId);
                  if (!last) {
                    const error = new Error("nothing to continue");
                    error.spoken = "You haven't opened any lecture yet.";
                    throw error;
                  }
                  handleProcess({
                    url: `https://youtube.com/watch?v=${last.videoId}`,
                    videoId: last.videoId,
                    mode: last.mode || "standard",
                    resume: true,
                    metadata: {
                      title: last.videoTitle || last.title,
                      videoTitle: last.videoTitle || last.title,
                      videoAuthor: last.videoAuthor || "",
                      videoDuration: last.videoDuration || "",
                      videoThumbnail: last.videoThumbnail || "",
                      videoId: last.videoId,
                      lastMoment: last.title,
                      timestamp: last.timestamp,
                    },
                  });
                },
              }),
        },
    () => ({ screen, videoId: jobInfo?.videoId }),
  );

  // ── Active screen ──────────────────────────────────────────────────────────
  let activeScreen;

  if (screen === "welcome") {
    activeScreen = <Welcome onDone={handleWelcomeDone} onOpenHelp={openHelp} />;
  } else if (screen === "timeline" && jobInfo) {
    activeScreen = (
      <Timeline
        jobId={jobInfo.jobId}
        videoId={jobInfo.videoId}
        pointId={jobInfo.pointId}
        mode={jobInfo.mode}
        lectureMetadata={jobInfo.lectureMetadata || null}
        onOpenPoint={handleOpenPoint}
        onNavigate={handleNavigate}
      />
    );
  } else if (screen === "explanation" && jobInfo) {
    activeScreen = (
      <Explanation
        key={`${jobInfo.videoId}-${jobInfo.readOnly ? "saved" : "active"}-${jobInfo.savedVersionId || "live"}`}
        jobId={jobInfo.jobId}
        videoId={jobInfo.videoId}
        pointId={jobInfo.pointId}
        mode={jobInfo.mode}
        conversationSession={lectureConversation}
        promise={jobInfo.promise || null}
        processingStatus={jobInfo.processingStatus || null}
        bookmarkData={jobInfo.bookmarkData || null}
        lectureMetadata={jobInfo.lectureMetadata || null}
        autoPlay={jobInfo.autoPlay || false}
        readOnly={jobInfo.readOnly || false}
        savedVersionId={jobInfo.savedVersionId || null}
        requestSessionId={requestSession?.videoId === jobInfo.videoId ? requestSession.id : null}
        onReconnectSession={async () => {
          const id = await ensureLectureSession(jobInfo.videoId);
          await processingApi.openLectureExplanations(jobInfo.videoId);
          setRequestSession({ videoId: jobInfo.videoId, id });
          setCleanupFailure(null);
        }}
        onActivateProcessing={(point, depth) => {
          startProcessing({ url: `https://www.youtube.com/watch?v=${jobInfo.videoId}`,
            videoId: jobInfo.videoId, mode: depth, metadata: jobInfo.lectureMetadata });
          lectureConversation.requestActivation(point, depth);
        }}
        onOpenSaved={handleOpenBookmark}
        startSeconds={jobInfo.startSeconds ?? null}
        onNavigate={handleNavigate}
        onRetryProcessing={handleRetryProcessing}
        onCancelProcessing={handleCancelProcessing}
        onResumeProcessing={handleResumeProcessing}
        processingAction={processingAction}
        processingActionError={processingActionError}
        onOpenTimeline={handleOpenTimeline}
        registerHelpGuard={registerHelpGuard}
        onOpenHelp={openHelp}
        onStartPractice={quizEnabled() && isValidVideoId(jobInfo.videoId) ? handleStartQuiz : undefined}
      />
    );
  } else if (screen === "bookmarks") {
    activeScreen = (
      <BookmarksScreen
        onNavigate={handleNavigate}
        onOpenBookmark={handleOpenBookmark}
      />
    );
  } else if (screen === "quiz" && quizInfo) {
    activeScreen = (
      <QuizScreen
        videoId={quizInfo.videoId}
        jobId={quizInfo.jobId}
        videoTitle={getLibrary().find((e) => e.videoId === quizInfo.videoId)?.videoTitle || ""}
        onNavigate={handleNavigate}
        onOpenLecture={handleOpenQuizLecture}
        onBack={handleBackFromQuiz}
      />
    );
  } else if (screen === "notes") {
    activeScreen = (
      <NotesScreen
        onNavigate={handleNavigate}
        onOpenNote={handleOpenNote}
        registerHelpGuard={registerHelpGuard}
      />
    );
  } else if (screen === "library") {
    activeScreen = (
      <LibraryScreen
        onNavigate={handleNavigate}
        onOpenExplanation={handleOpenLibraryExplanation}
      />
    );
  } else if (screen === "subject" && exploreSubject) {
    activeScreen = (
      <SubjectLectures
        subject={exploreSubject}
        onProcess={handleProcess}
        onNavigate={handleNavigate}
      />
    );
  } else {
    activeScreen = (
      <Home
        continueLecture={personalSummary[0] ? { ...personalSummary[0], title: personalSummary[0].videoTitle } : undefined}
        onProcess={handleProcess}
        onNavigate={handleNavigate}
        onExploreSubject={handleExploreSubject}
        focusHeadingOnMount={hasLeftHome}
      />
    );
  }

  // ── Layout: Navbar (slim top bar) + screen below ───────────────────────────
  return (
    <>
    <div className="flex flex-col h-screen" inert={helpOpen ? "" : undefined}>
      {/* One shared skip link, rendered before Navbar so it's genuinely
        first in tab order on every screen — previously each screen (Home,
        SubjectLectures, Timeline) rendered its own copy, but since Navbar
        is a sibling mounted above {activeScreen}, its Settings button
        always came first in the DOM regardless of which screen's skip
        link was active, defeating the skip link's purpose. Works via
        native anchor-jump focus (the target needs id="main-content" +
        tabIndex={-1}, already true for every screen's own <main>) rather
        than a per-screen ref + onClick handler, since there's no single
        ref that could span whichever screen happens to be mounted. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:bg-accent focus:text-on-accent focus:px-4 focus:py-2 focus:rounded-radius-md focus:text-[14px] focus:font-medium focus-ring"
      >
        Skip to main content
      </a>
      <Navbar
        theme={theme}
        onThemeChange={setTheme}
        accountControls={accountControls}
        onHelp={openHelp}
        leading={
          voiceControlEnabled() && screen !== "welcome"
            ? <VoiceControl disabled={helpOpen} registerHelpInterruption={registerHelpInterruption} />
            : null
        }
      />
      <div className="flex-1 overflow-hidden">
        {cleanupFailure && <div role="alert" className="p-4 bg-surface border border-border-subtle">
          {cleanupFailure.operation === "stop" ? "Unfinished work for the previous lecture could not be stopped."
            : cleanupFailure.operation === "session" ? "Reconnect this lecture to request explanations. You can also say retry explanation."
            : "Background preparation for this lecture could not be resumed."}
          <button type="button" className="ds-btn-secondary" onClick={async () => {
            try {
              if (cleanupFailure.operation === "stop") {
                await releaseLectureSession(cleanupFailure.videoId);
                if (activeLectureVideo && !jobInfo?.readOnly) {
                  const id = await ensureLectureSession(activeLectureVideo);
                  setRequestSession({ videoId: activeLectureVideo, id });
                }
              }
              else {
                const id = await ensureLectureSession(cleanupFailure.videoId);
                setRequestSession({ videoId: cleanupFailure.videoId, id });
                await processingApi.openLectureExplanations(cleanupFailure.videoId);
              }
              setCleanupFailure(null);
            }
            catch { /* Keep the retry visible. */ }
          }}>{cleanupFailure.operation === "stop" ? "Retry stopping lecture work" : "Retry opening preparation"}</button>
        </div>}
        {(notice || accountNotice) && <p role="status" aria-live="polite" className="p-3 bg-surface text-text-primary">{notice || accountNotice}</p>}
        <Fragment key={accountRevision}>{activeScreen}</Fragment>
      </div>
    </div>
    {helpOpen && <HelpDialog notice={helpNotice} onClose={closeHelp} />}
    </>
  );
}

export default function App() {
  const [account, setAccount] = useState(currentAccount);
  const [authScreen, setAuthScreen] = useState(null);
  const [restoreError, setRestoreError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState(readSavedTheme);
  const alive = useRef(false);
  const permitted = account.status === "ready" && Boolean(account.user) &&
    (!account.user.isLocalProfile || developmentAccess());

  const restore = useCallback(() => {
    const expected = captureAccount();
    return initializeAccount().then(() => {
      const next = currentAccount();
      if (alive.current && expected.generation === next.generation) { setAccount(next); setRestoreError(""); }
    }).catch((error) => {
      const next = currentAccount();
      if (!alive.current || expected.generation !== next.generation) return;
      setAccount(next);
      if (next.status === "restoring") setRestoreError("Can't verify your saved session. Check that Synapse is running on this computer, then retry or sign in.");
      else setNotice(error.message);
    });
  }, []);

  useEffect(() => {
    alive.current = true;
    const changed = () => {
      const next = currentAccount();
      setAccount(next);
      setAuthScreen(null);
      setRestoreError("");
      setNotice(next.status === "invalid" ? "Your session ended. Sign in again to access your account data." :
        next.token && !next.persistent ? "You're signed in for this session only. Your browser could not save the session; reopening will require sign-in." : "");
      if (next.status === "restoring") void restore();
    };
    window.addEventListener(ACCOUNT_CHANGED, changed);
    void restore();
    return () => { alive.current = false; window.removeEventListener(ACCOUNT_CHANGED, changed); };
  }, [restore]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    saveTheme(theme);
  }, [theme]);

  const surface = authScreen || (permitted ? "study" : account.status === "restoring" ? "restoring" : "login");
  const previousSurface = useRef(surface);
  useEffect(() => {
    if (surface !== "study") document.title = `${surface === "signup" ? "Create account" : surface === "restoring" ? "Checking session" : "Sign in"} – Synapse`;
    if (previousSurface.current !== surface) document.querySelector("main h1")?.focus({ preventScroll: true });
    previousSurface.current = surface;
  }, [surface]);

  const openAccount = async (screen) => {
    const expected = captureAccount();
    try {
      await prepareAccountChange();
      assertAccount(expected);
      if (alive.current) { setNotice(""); setAuthScreen(screen); }
    } catch (error) { if (alive.current) setNotice(error.message); }
  };
  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try { await logout(); }
    catch (error) { setNotice(error instanceof TypeError ? "Couldn't confirm sign-out. Check the backend connection and try again. You are still signed in." : error.message); }
    finally { setBusy(false); }
  };
  const backToDevelopment = developmentAccess() ? () => {
    if (permitted && account.user.isLocalProfile) setAuthScreen(null);
    else void signOut(); // An invalid session requires an explicit local switch.
  } : null;
  const accountControls = permitted ? account.user.isLocalProfile ? <>
    <button type="button" className="ds-btn-text" onClick={() => openAccount("login")}>Sign in</button>
    <button type="button" className="ds-btn-text" onClick={() => openAccount("signup")}>Create account</button>
  </> : <>
    <span className="truncate max-w-[180px] text-[14px] text-text-primary">{account.user.displayName}</span>
    <button type="button" disabled={busy} className="ds-btn-text" onClick={signOut}>{busy ? "Signing out…" : "Sign out"}</button>
  </> : null;

  if (surface === "study") return <StudyApp theme={theme} setTheme={setTheme} accountControls={accountControls} notice={notice} />;
  return (
    <div className="flex flex-col h-screen bg-background text-text-primary font-sans">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:bg-accent focus:text-on-accent focus:px-4 focus:py-2 focus:rounded-radius-md focus-ring">Skip to main content</a>
      <Navbar theme={theme} onThemeChange={setTheme} />
      {notice && <p role="status" aria-live="polite" className="p-3">{notice}</p>}
      <div className="flex-1 overflow-hidden">
        {surface === "restoring" ? (
          <main id="main-content" tabIndex={-1} aria-labelledby="page-title" className="max-w-[640px] mx-auto px-6 py-14">
            <h1 id="page-title" tabIndex={-1} className="text-[32px] font-semibold mb-4 focus-ring">Checking your session</h1>
            <p role="status" aria-live="polite">{restoreError || "Verifying your saved session…"}</p>
            {restoreError && <div className="flex flex-wrap gap-3 mt-6">
              <button type="button" className="ds-btn-primary" onClick={() => { setRestoreError(""); void restore(); }}>Retry</button>
              <button type="button" className="ds-btn-secondary" onClick={() => setAuthScreen("login")}>Sign in instead</button>
            </div>}
          </main>
        ) : surface === "signup" ? <Signup onNavigate={setAuthScreen} onBack={busy ? null : backToDevelopment} /> :
          <Login onNavigate={setAuthScreen} onBack={busy ? null : backToDevelopment} />}
      </div>
    </div>
  );
}
