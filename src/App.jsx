import { useState, useEffect, useRef } from "react";
import Home from "./components/Home";
import SubjectLectures from "./components/SubjectLectures";
import Timeline from "./components/Timeline";
import Explanation from "./components/Explanation";
import BookmarksScreen from "./components/BookmarksScreen";
import LibraryScreen from "./components/LibraryScreen";
import NotesScreen from "./components/NotesScreen";
import QuizScreen from "./components/QuizScreen";
import Navbar from "./components/Navbar";
import * as processingApi from "./api";
import { getLibrary } from "./storage";
import { isValidVideoId } from "./lib/askApi";
import { quizEnabled } from "./lib/quizFlag";
import { safeStartSeconds } from "./lib/lectureSeek";

const PROCESSING_SESSION_KEY = "synapse_active_processing_job";

function readProcessingSession() {
  try {
    const value = JSON.parse(sessionStorage.getItem(PROCESSING_SESSION_KEY));
    return value?.processingJobId && value?.videoId ? value : null;
  } catch {
    return null;
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

function App() {
  const [screen,  setScreen]  = useState("home");
  const [jobInfo, setJobInfo] = useState(null);
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
  const [theme, setTheme] = useState(
    () => localStorage.getItem("synapse_theme") || "paper"
  );

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

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("synapse_theme", theme);
  }, [theme]);

  // ── HOME -> EXPLANATION (processing now happens inline, no blocking screen) ─
  const isProcessingRef = useRef(false);
  const processingControllerRef = useRef(null);
  const processingActionControllerRef = useRef(null);
  const processingTokenRef = useRef(null);
  const restoredProcessingRef = useRef(readProcessingSession());
  const [processingAction, setProcessingAction] = useState(null);
  const [processingActionError, setProcessingActionError] = useState(null);

  const startProcessing = (
    { url, videoId, mode, metadata = null },
    { processingJobId = null, retry = false, reconnect = false, resume = false } = {},
  ) => {
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
            sessionStorage.removeItem(PROCESSING_SESSION_KEY);
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
  const handleProcess = (request) => startProcessing(request);

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
      sessionStorage.setItem(PROCESSING_SESSION_KEY, JSON.stringify({
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
    setJobInfo({
      jobId:        bookmark.jobId,
      videoId:      bookmark.videoId,
      pointId:      bookmark.pointId,
      mode:         bookmark.mode,
      bookmarkData: bookmark,
      lectureMetadata: bookmark,
    });
    setScreen("explanation");
  };

  // ── LIBRARY -> EXPLANATION ─────────────────────────────────────────────────
  const handleOpenLibraryExplanation = (item) => {
    const { pointId, videoId, jobId, mode, autoPlay } = item;
    setJobInfo({
      jobId,
      videoId,
      pointId,
      mode,
      autoPlay: !!autoPlay,
      lectureMetadata: item,
    });
    setScreen("explanation");
  };

  // ── VOICE NOTES -> EXPLANATION ─────────────────────────────────────────────
  // Opens the note's lecture cued at the note's time and paused (the learner
  // presses Play), like opening a bookmark. The note doesn't store the depth
  // mode, so it is looked up from the library entry for the same video.
  const handleOpenNote = (note) => {
    const known = getLibrary().find((e) => e.videoId === note.videoId);
    setJobInfo({
      jobId:        note.jobId || note.videoId,
      videoId:      note.videoId,
      pointId:      note.pointId || undefined,
      mode:         known?.mode || "standard",
      startSeconds: note.lectureSeconds,
      lectureMetadata: known || note,
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
      videoId,
      mode:         known?.mode || jobInfo?.mode || "standard",
      startSeconds: safeStartSeconds(startSeconds),
    });
    setScreen("explanation");
  };

  // ── SIDEBAR NAVIGATION ─────────────────────────────────────────────────────
  const handleNavigate = (key) => {
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

  // ── Active screen ──────────────────────────────────────────────────────────
  let activeScreen;

  if (screen === "timeline" && jobInfo) {
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
        jobId={jobInfo.jobId}
        videoId={jobInfo.videoId}
        pointId={jobInfo.pointId}
        mode={jobInfo.mode}
        promise={jobInfo.promise || null}
        processingStatus={jobInfo.processingStatus || null}
        bookmarkData={jobInfo.bookmarkData || null}
        lectureMetadata={jobInfo.lectureMetadata || null}
        autoPlay={jobInfo.autoPlay || false}
        startSeconds={jobInfo.startSeconds ?? null}
        onNavigate={handleNavigate}
        onRetryProcessing={handleRetryProcessing}
        onCancelProcessing={handleCancelProcessing}
        onResumeProcessing={handleResumeProcessing}
        processingAction={processingAction}
        processingActionError={processingActionError}
        onOpenTimeline={handleOpenTimeline}
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
        onProcess={handleProcess}
        onNavigate={handleNavigate}
        onExploreSubject={handleExploreSubject}
        focusHeadingOnMount={hasLeftHome}
      />
    );
  }

  // ── Layout: Navbar (slim top bar) + screen below ───────────────────────────
  return (
    <div className="flex flex-col h-screen">
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
      <Navbar theme={theme} onThemeChange={setTheme} />
      <div className="flex-1 overflow-hidden">
        {activeScreen}
      </div>
    </div>
  );
}

export default App;
