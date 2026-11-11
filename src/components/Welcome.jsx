import { useState } from "react";
import { useAnnouncer } from "../hooks/useAnnouncer";
import BrandMark from "./BrandMark";
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
  WELCOME_INTRO,
  WELCOME_MODE_DESCRIPTIONS,
  WELCOME_MODE_HEADING,
  WELCOME_SAVE_FAILED,
  WELCOME_SKIP,
  WELCOME_SWITCH_NOTE,
  WELCOME_TITLE,
} from "../lib/onboardingText";

export default function Welcome({ onDone = () => {} }) {
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
        <div className="w-full max-w-[780px] mx-auto px-4 sm:px-8 py-10">
         <div className="ds-card px-6 sm:px-11 py-9">
          <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {message}
          </div>

          <BrandMark size={46} className="mb-5" />

          <h1
            id="page-title"
            tabIndex={-1}
            className="text-[38px] font-bold tracking-tight text-text-primary leading-tight mb-4 outline-none rounded-radius-sm focus-ring"
          >
            {WELCOME_TITLE}
          </h1>

          <p className="text-[17px] text-text-secondary leading-relaxed mb-8">{WELCOME_INTRO}</p>

          <section aria-labelledby="welcome-mode-heading" className="mb-6">
            <h2 id="welcome-mode-heading" className="text-[22px] font-bold text-text-primary mb-4">
              {WELCOME_MODE_HEADING}
            </h2>

            <div role="group" aria-labelledby="welcome-mode-heading" className="grid gap-4 sm:grid-cols-2">
              {MODE_ORDER.map((mode) => {
                const isSelected = selected === mode;
                return (
                  /* The whole card is the click target (the button's ::after
                     stretches over it); the button + description stay the same
                     two elements, in the same order, with the same names. */
                  <div
                    key={mode}
                    className={
                      "relative p-5 rounded-radius-lg border-2 transition-colors " +
                      (isSelected
                        ? "border-accent bg-accent-soft"
                        : "border-border-strong bg-surface hover:bg-surface-muted")
                    }
                  >
                    <span
                      aria-hidden="true"
                      className="mb-3 grid h-[52px] w-[52px] place-items-center rounded-radius-lg border border-border-subtle bg-surface text-accent"
                    >
                      <ModeIcon mode={mode} />
                    </span>
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      aria-describedby={`welcome-${mode}-desc`}
                      onClick={() => setSelected(mode)}
                      className={
                        "block w-full min-h-[44px] py-1 text-[20px] text-left text-text-primary rounded-radius-sm focus-ring " +
                        "after:absolute after:inset-0 after:rounded-radius-lg after:content-[''] " +
                        (isSelected ? "font-bold" : "font-semibold")
                      }
                    >
                      <span aria-hidden="true" className="text-accent">{isSelected ? "✓ " : ""}</span>
                      {MODE_COPY[mode].label}
                    </button>
                    <p id={`welcome-${mode}-desc`} className="mt-1 text-[15px] text-text-secondary leading-relaxed">
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
          </div>
         </div>
        </div>
      </main>
    </div>
  );
}

// Decorative mode icons (aria-hidden by their wrapper): headphones for
// Accessibility mode, a screen for Study mode.
function ModeIcon({ mode }) {
  const common = { width: 28, height: 28, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", focusable: "false" };
  return mode === "accessibility" ? (
    <svg {...common}>
      <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
      <rect x="3" y="14" width="4" height="7" rx="1.5" />
      <rect x="17" y="14" width="4" height="7" rx="1.5" />
    </svg>
  ) : (
    <svg {...common}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4M10 8.5l5 2.5-5 2.5z" />
    </svg>
  );
}
