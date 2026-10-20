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
import { processVideo, resetMockTimer } from "./api";
import { getLibrary } from "./storage";
import { isValidVideoId } from "./lib/askApi";
import { quizEnabled } from "./lib/quizFlag";
import { safeStartSeconds } from "./lib/lectureSeek";

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
  const handleProcess = ({ url, videoId, mode }) => {
    resetMockTimer();
    const promise = processVideo({ url, videoId, mode });
    setJobInfo({ jobId: videoId, videoId, mode, promise });
    setHasLeftHome(true);
    setScreen("explanation");
  };

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
    });
    setScreen("explanation");
  };

  // ── LIBRARY -> EXPLANATION ─────────────────────────────────────────────────
  const handleOpenLibraryExplanation = ({ pointId, videoId, jobId, mode, autoPlay }) => {
    setJobInfo({ jobId, videoId, pointId, mode, autoPlay: !!autoPlay });
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
        bookmarkData={jobInfo.bookmarkData || null}
        autoPlay={jobInfo.autoPlay || false}
        startSeconds={jobInfo.startSeconds ?? null}
        onNavigate={handleNavigate}
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
