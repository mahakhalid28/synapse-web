import { useState, useEffect, useRef, useCallback } from "react";
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
import { processVideo, resetMockTimer } from "./api";
import { getLibrary } from "./storage";
import { isValidVideoId } from "./lib/askApi";
import { quizEnabled } from "./lib/quizFlag";
import { safeStartSeconds } from "./lib/lectureSeek";
import { needsWelcome } from "./lib/onboardingPrefs";

function App() {
  // Welcome is the first screen on EVERY launch while onboarding is switched on (see onboardingPrefs.js);
  // whether it was completed before does not matter. Decided once, here, so it can never reappear during
  // a session. As the INITIAL screen it gets no
  // focus move on cold load, exactly like Home, so the skip link stays first in tab order.
  const [screen,  setScreen]  = useState(() => (needsWelcome() ? "welcome" : "home"));
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

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("synapse_theme", theme);
  }, [theme]);

  // ── HOME -> EXPLANATION (processing now happens inline, no blocking screen) ─
  const isProcessingRef = useRef(false);
  const processingControllerRef = useRef(null);
  const processingTokenRef = useRef(null);

  const startProcessing = (
    { url, videoId, mode, metadata = null },
    { processingJobId = null, retry = false } = {},
  ) => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    processingControllerRef.current?.abort();
    const controller = new AbortController();
    const token = Symbol("processing-request");
    processingControllerRef.current = controller;
    processingTokenRef.current = token;
    resetMockTimer();
    const promise = processVideo({
      url,
      videoId,
      mode,
      signal: controller.signal,
      jobId: processingJobId,
      retry,
      onStatus: (status) => {
        setJobInfo((current) =>
          current?.processingToken === token
            ? {
                ...current,
                jobId: status.jobId || current.jobId,
                processingJobId: status.jobId || current.processingJobId,
                processingStatus: status,
              }
            : current,
        );
      },
    })
      .finally(() => {
        if (processingTokenRef.current === token) {
          isProcessingRef.current = false;
          processingControllerRef.current = null;
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
      processingStatus: {
        status: "queued",
        stage: "queued",
        message: "Creating or joining the shared processing job.",
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

  useEffect(() => () => processingControllerRef.current?.abort(), []);

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

  // ── WELCOME -> HOME ────────────────────────────────────────────────────────
  // Welcome has already saved its own flag and choice. This only leaves it; the screen change moves
  // focus to Home's <h1> through the same effect every other screen change uses.
  const handleWelcomeDone = () => {
    setHasLeftHome(true);
    setScreen("home");
  };

  // ── HELP (a modal dialog over the current screen) ──────────────────────────
  // Help never navigates, so the screen behind it stays mounted: a lecture's player and its processing
  // job are untouched. The screen on show may register a guard in helpGuardRef (Explanation, NotesScreen):
  // beforeHelp() runs first and may refuse (voice-note recording) or pause/stop what is playing and
  // return a notice for the dialog; afterHelp() runs on close. Closing never resumes anything.
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

  // ── SIDEBAR NAVIGATION ─────────────────────────────────────────────────────
  const handleNavigate = (key) => {
    processingControllerRef.current?.abort();
    processingControllerRef.current = null;
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
        onOpenTimeline={handleOpenTimeline}
        onStartPractice={quizEnabled() && isValidVideoId(jobInfo.videoId) ? handleStartQuiz : undefined}
        registerHelpGuard={registerHelpGuard}
        onOpenHelp={openHelp}
      />
    );
  } else if (screen === "bookmarks") {
    activeScreen = (
      <BookmarksScreen
        onNavigate={handleNavigate}
        onOpenBookmark={handleOpenBookmark}
      />
    );
  } else if (screen === "welcome") {
    activeScreen = <Welcome onDone={handleWelcomeDone} onOpenHelp={openHelp} />;
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
    {/* While Help is open everything behind it is inert (no focus, no clicks, hidden from assistive
      technology); the dialog is a sibling, outside the inert part. */}
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
      <Navbar theme={theme} onThemeChange={setTheme} onHelp={openHelp} />
      <div className="flex-1 overflow-hidden">
        {activeScreen}
      </div>
    </div>
    {helpOpen && <HelpDialog notice={helpNotice} onClose={closeHelp} />}
    </>
  );
}

export default App;
