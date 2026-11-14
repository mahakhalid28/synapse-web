import { useState } from "react";
import { useAnnouncer } from "../hooks/useAnnouncer";
import {
  completeOnboarding,
  getSavedPresentationMode,
  savePresentationMode,
} from "../lib/onboardingPrefs";
import {
  MODE_COPY,
  MODE_ORDER,
  WELCOME_CONTINUE,
  WELCOME_EXISTING_NOTE,
  WELCOME_GET_STARTED,
  WELCOME_HELP,
  WELCOME_INTRO,
  WELCOME_MODE_DESCRIPTIONS,
  WELCOME_MODE_HEADING,
  WELCOME_SAVE_FAILED,
  WELCOME_SKIP,
  WELCOME_SWITCH_NOTE,
  WELCOME_TITLE,
} from "../lib/onboardingText";

export default function Welcome({ onDone = () => {}, onOpenHelp = null }) {
  const [savedMode] = useState(getSavedPresentationMode);
  const [selected, setSelected] = useState(savedMode ?? "accessibility");
  const [saveFailed, setSaveFailed] = useState(false);
  const { message, announce } = useAnnouncer();

  const getStarted = () => {
    if (saveFailed) {
      onDone();
      return;
    }

    completeOnboarding();
    if (selected !== savedMode && !savePresentationMode(selected)) {
      setSaveFailed(true);
      announce(WELCOME_SAVE_FAILED);
      return;
    }
    onDone();
  };

  const skip = () => {
    completeOnboarding();
    onDone();
  };

  return (
    <div className="h-full w-full bg-background font-sans overflow-hidden">
      <main
        id="main-content"
        tabIndex={-1}
        aria-labelledby="page-title"
        className="h-full overflow-y-auto outline-none"
      >
        <div className="w-full max-w-[640px] mx-auto px-10 py-14">
          <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {message}
          </div>

          <h1
            id="page-title"
            tabIndex={-1}
            className="text-[32px] font-semibold text-text-primary leading-tight mb-4 outline-none rounded-radius-sm focus-ring"
          >
            {WELCOME_TITLE}
          </h1>

          <p className="text-[15px] text-text-secondary leading-relaxed mb-8">{WELCOME_INTRO}</p>

          <section aria-labelledby="welcome-mode-heading" className="mb-6">
            <h2 id="welcome-mode-heading" className="text-[19px] font-semibold text-text-primary mb-4">
              {WELCOME_MODE_HEADING}
            </h2>

            <div role="group" aria-labelledby="welcome-mode-heading" className="grid gap-4 sm:grid-cols-2">
              {MODE_ORDER.map((mode) => {
                const isSelected = selected === mode;
                return (
                  <div key={mode}>
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      aria-describedby={`welcome-${mode}-desc`}
                      onClick={() => setSelected(mode)}
                      className={
                        "w-full min-h-[44px] px-3.5 py-2 rounded-radius-md border-2 text-[14px] text-left transition-colors focus-ring " +
                        (isSelected
                          ? "bg-accent text-on-accent border-accent font-semibold"
                          : "bg-surface text-text-secondary border-border-strong font-medium hover:bg-surface-muted")
                      }
                    >
                      <span aria-hidden="true">{isSelected ? "✓ " : ""}</span>
                      {MODE_COPY[mode].label}
                    </button>
                    <p id={`welcome-${mode}-desc`} className="mt-2 text-[14px] text-text-secondary leading-relaxed">
                      {WELCOME_MODE_DESCRIPTIONS[mode]}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>

          <p className="text-[14px] text-text-secondary leading-relaxed mb-2">{WELCOME_SWITCH_NOTE}</p>
          <p className="text-[14px] text-text-secondary leading-relaxed mb-6">{WELCOME_EXISTING_NOTE}</p>

          {saveFailed && (
            <p className="mb-6 p-4 bg-surface border border-red-500/40 rounded-radius-md text-[14px] text-text-primary">
              {WELCOME_SAVE_FAILED}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={getStarted} className="ds-btn-primary">
              {saveFailed ? WELCOME_CONTINUE : WELCOME_GET_STARTED}
            </button>
            <button type="button" onClick={skip} className="ds-btn-secondary">
              {WELCOME_SKIP}
            </button>
            {onOpenHelp && (
              <button type="button" onClick={onOpenHelp} className="ds-btn-text">
                {WELCOME_HELP}
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
