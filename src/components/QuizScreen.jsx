// Accessible Quiz & Practice: the dedicated screen (docs/QUIZ_CONTRACT.md sections 7, 9, 13).
//
// NOT wired into the app yet: nothing imports this component, App.jsx has no "quiz" screen, and
// the lecture screen has no entry button (that is the integration stage and needs the owner of
// Explanation.jsx). It is self-contained: give it the lecture and two callbacks.
//
//   videoId, jobId, videoTitle   the lecture being practised
//   onNavigate(key)              sidebar navigation, like every other screen
//   onOpenLecture({ videoId, jobId, startSeconds })
//                                "Check in the lecture": the caller opens the lecture CUED AND PAUSED
//                                at the server-chosen time (the Voice Notes route does exactly this)
//   store / api / prefs          injectable for tests; default to the real Stage 3 modules
//
// The attempt is saved as you go (quizStore + quizAutosave). Leaving never discards it: it is
// offered for resume next time, and "Start a new set" only sets it aside.

import { useEffect, useRef, useState } from "react";
import Sidebar from "./Sidebar";
import QuizDisplayControls from "./QuizDisplayControls";
import QuizSetup from "./QuizSetup";
import QuizQuestion from "./QuizQuestion";
import QuizReview from "./QuizReview";
import QuizResults from "./QuizResults";
import { useQuizSession } from "../hooks/useQuizSession.js";
import * as defaultStore from "../lib/quizStore.js";
import * as defaultApi from "../lib/quizApi.js";
import * as defaultPrefs from "../lib/displayPrefs.js";
import { AI_NOTICE, choiceText } from "../lib/quizText.js";
import { useVoiceActions } from "../voice/voiceActions";

export default function QuizScreen(props) {
  // Keyed on the lecture so a different one starts clean (no stale attempt, aborted request).
  return <QuizScreenInner key={props.videoId} {...props} />;
}

function QuizScreenInner({
  videoId,
  jobId,
  videoTitle = "",
  onNavigate = () => {},
  onOpenLecture = () => {},
  onBack,
  store = defaultStore,
  api = defaultApi,
  prefs = defaultPrefs,
}) {
  const session = useQuizSession({ videoId, store, api });
  const [display, setDisplay] = useState(() => prefs.getQuizDisplayPrefs());
  const mainRef = useRef(null);
  const h1Ref = useRef(null);
  const { focusTick, takeFocusRequest, phase, work, result, saveState, banner } = session;

  // Entering the screen: focus the page heading. (App.jsx does the same on a screen change; it is
  // the same element, so nothing is announced twice.)
  useEffect(() => { h1Ref.current?.focus(); }, []);

  // Carry out a focus request made by the session, once the new state has rendered.
  useEffect(() => {
    const name = takeFocusRequest();
    if (!name) return;
    const target = mainRef.current?.querySelector(`[data-focus="${name}"]`);
    target?.focus();
  }, [focusTick, takeFocusRequest]);

  const changeTextSize = (direction) => {
    const textScale = prefs.stepQuizTextScale(direction);
    setDisplay((d) => ({ ...d, textScale }));
    session.announce(`Text size ${Math.round(textScale * 100)} percent.`);
  };
  const toggleContrast = () => {
    const highContrast = prefs.setQuizHighContrast(!display.highContrast);
    setDisplay((d) => ({ ...d, highContrast }));
    session.announce(highContrast ? "High contrast on." : "High contrast off.");
  };

  // By voice: the same actions as the buttons, offered only where the buttons exist. Answering selects;
  // it never checks or submits by itself.
  const voiceHandlers = {};
  if (onBack && (phase === "setup" || phase === "results")) voiceHandlers.quiz_back = onBack;
  if (phase === "setup" && !session.gen.busy) voiceHandlers.quiz_start = () => session.generate({ mode: "practice", count: 5 });
  if (phase === "quiz" && work) {
    const q = work.quiz.questions[work.currentIndex];
    const total = work.quiz.questions.length;
    const practice = work.mode === "practice";
    if (work.view === "review") {
      voiceHandlers.quiz_submit = () => session.submitAttempt();
    } else {
      voiceHandlers.quiz_answer = ({ index }) => {
        const choice = q.choices[index - 1];
        if (!choice) throw new Error("no such choice");
        session.select(q.id, choice.id);
        session.announce(`Selected ${choiceText(q, choice.id)}.`);
      };
      voiceHandlers.quiz_read = () =>
        session.announce(`Question ${work.currentIndex + 1} of ${total}. ${q.prompt} ${q.choices.map((c) => choiceText(q, c.id)).join(". ")}.`);
      if (practice) {
        voiceHandlers.quiz_check = () => {
          if (work.responses[q.id].choiceId === null) session.announce("Choose an answer first, then check it.");
          else session.check(q.id);
        };
        voiceHandlers.quiz_hint = () => session.revealHint(q.id);
      }
      if (work.currentIndex < total - 1) voiceHandlers.quiz_next = () => session.goTo(work.currentIndex + 1);
      if (work.currentIndex > 0) voiceHandlers.quiz_previous = () => session.goTo(work.currentIndex - 1);
      voiceHandlers.quiz_review = () => session.openReview();
    }
    voiceHandlers.change_text_size = ({ change }) => changeTextSize(change === "smaller" ? -1 : 1);
    voiceHandlers.toggle_high_contrast = toggleContrast;
  }
  useVoiceActions(voiceHandlers, () => ({}));

  const openLecture = (evidence) =>
    onOpenLecture({ videoId, jobId, startSeconds: Math.max(0, Math.floor(evidence.start_seconds)) });

  return (
    <div className="flex h-full w-full bg-background font-sans overflow-hidden">
      <nav aria-label="Main navigation">
        <Sidebar active="" onNavigate={onNavigate} />
      </nav>

      <main
        id="main-content" ref={mainRef} tabIndex={-1}
        style={{ "--quiz-scale": display.textScale }}
        className={"quiz-root flex-1 min-w-0 overflow-y-auto outline-none bg-background text-text-primary" + (display.highContrast ? " quiz-contrast" : "")}
      >
        <div className="max-w-[760px] px-6 sm:px-12 py-10 min-w-0">
          <div aria-hidden="true" className="text-[0.875em] font-medium text-text-secondary mb-3">Practice</div>
          <h1 ref={h1Ref} tabIndex={-1} data-focus="heading" className="text-[2em] font-bold text-text-primary mb-1 outline-none focus-ring break-words">
            Practice this lecture
          </h1>
          <p className="m-0 mb-5 text-text-secondary break-words">{videoTitle || `Lecture ${videoId}`}</p>

          <QuizDisplayControls
            textScale={display.textScale} highContrast={display.highContrast}
            onTextSize={changeTextSize} onToggleContrast={toggleContrast}
          />

          {/* One polite region for everything that is announced (hints, creating, cancelled, text size, recovery). */}
          <div role="status" aria-live="polite" className="sr-only">{session.announcement}</div>

          {phase === "init" && <p className="text-text-secondary">Looking for your saved practice…</p>}

          {phase === "setup" && <QuizSetup session={session} />}

          {phase === "quiz" && work && (
            <>
              {banner && (
                <div role="alert" className="quiz-box mb-4 p-4 rounded-radius-md border border-warning bg-warning-soft text-text-primary">
                  <p className="m-0">{banner}</p>
                  <button type="button" onClick={session.dismissBanner} className="ds-btn-secondary mt-2">Dismiss</button>
                </div>
              )}
              {work.view === "review"
                ? <QuizReview session={session} work={work} />
                : <QuizQuestion session={session} work={work} onOpenLecture={openLecture} />}

              <div className="mt-8 pt-4 border-t border-border-subtle">
                {(saveState.kind === "error" || saveState.kind === "conflict") ? (
                  <div role="alert" className="quiz-box p-3 rounded-radius-md border border-error bg-error-soft text-text-primary">
                    <span className="font-semibold">Error: </span>{saveState.message}
                    {saveState.kind === "error" && (
                      <button type="button" onClick={session.retrySaveProgress} className="ds-btn-secondary ml-3">Try saving again</button>
                    )}
                  </div>
                ) : (
                  <p className="m-0 text-[0.875em] text-text-secondary">
                    {saveState.kind === "saving" ? "Saving…" : "Progress is saved on this computer as you go."}
                    {" "}You can leave and continue later.
                  </p>
                )}
                <p className="m-0 mt-2 text-[0.875em] text-text-secondary">{AI_NOTICE}</p>
              </div>
            </>
          )}

          {phase === "results" && result && <QuizResults session={session} result={result} onOpenLecture={openLecture} />}

          {onBack && (phase === "setup" || phase === "results") && (
            <div className="mt-8">
              <button type="button" onClick={onBack} className="ds-btn-text">Back to the lecture</button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
