import { useState, useEffect } from "react";
import Home from "./components/Home";
import SubjectLectures from "./components/SubjectLectures";
import Timeline from "./components/Timeline";
import Explanation from "./components/Explanation";
import BookmarksScreen from "./components/BookmarksScreen";
import LibraryScreen from "./components/LibraryScreen";
import Navbar from "./components/Navbar";
import { processVideo, resetMockTimer } from "./api";

function App() {
  const [screen,  setScreen]  = useState("home");
  const [jobInfo, setJobInfo] = useState(null);
  const [exploreSubject, setExploreSubject] = useState(null);
  // False only on the app's very first render, so the skip link and sidebar
  // stay first in tab order for a first-time visitor. Once the user has left
  // Home at least once, any later return is a real in-app navigation and
  // should move focus to the H1 (Fix 6's "reverse direction").
  const [hasLeftHome, setHasLeftHome] = useState(false);

  // ── Theme ──────────────────────────────────────────────────────────────────
  const [theme, setTheme] = useState(
    () => localStorage.getItem("synapse_theme") || "paper"
  );

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

  // ── SIDEBAR NAVIGATION ─────────────────────────────────────────────────────
  const handleNavigate = (key) => {
    if (key === "home") {
      setJobInfo(null);
      setExploreSubject(null);
      setScreen("home");
    } else if (key === "bookmarks" || key === "library") {
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
        onNavigate={handleNavigate}
        onOpenTimeline={handleOpenTimeline}
      />
    );
  } else if (screen === "bookmarks") {
    activeScreen = (
      <BookmarksScreen
        onNavigate={handleNavigate}
        onOpenBookmark={handleOpenBookmark}
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
