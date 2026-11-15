import { useState } from "react";
import { useAnnouncer } from "../hooks/useAnnouncer";
import { useVoiceActions } from "../voice/voiceActions";
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

  // Voice: the same choices as the buttons, so a learner who cannot see the screen gets started by voice.
  useVoiceActions({
    set_presentation_mode: ({ mode }) => {
      if (!MODE_ORDER.includes(mode)) throw new Error("unknown mode");
      setSelected(mode);
    },
    get_started: () => getStarted(),
    skip_onboarding: () => skip(),
  });

  return (
    <div className="h-full w-full bg-background font-sans overflow-hidden">
      <main
        id="main-content"
        tabIndex={-1}
        aria-labelledby="page-title"
        className="h-full overflow-y-auto outline-none"
      >
        <div className="w-full max-w-[820px] mx-auto px-4 sm:px-8 py-8 sm:py-12">
         <div className="ds-card overflow-hidden">
          <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {message}
          </div>

          {/* Header band, the same gradient as Home. Text on it is white, >= 9:1 along the whole gradient;
              in forced-colors mode it becomes a plain bordered box. Nothing in it is focusable except the
              heading's programmatic focus target, so the tab order is unchanged. */}
          <div className="bg-hero px-6 sm:px-11 pt-8 pb-9">
            <div className="flex items-center gap-3 mb-6">
              <BrandMark size={44} className="ring-2 ring-white/30 rounded-[12px]" />
              {/* The heading below already says "Synapse"; the wordmark is visual only. */}
              <span aria-hidden="true" className="text-[20px] font-bold tracking-tight text-hero-fg">Synapse</span>
            </div>

            <h1
              id="page-title"
              tabIndex={-1}
              className="text-[34px] sm:text-[40px] font-bold tracking-tight text-hero-fg leading-tight mb-3 outline-none rounded-radius-sm focus-ring"
            >
              {WELCOME_TITLE}
            </h1>

            <p className="text-[17px] text-hero-sub leading-relaxed max-w-[640px]">{WELCOME_INTRO}</p>
          </div>

          <div className="px-6 sm:px-11 py-8 sm:py-9">
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
                      "relative p-5 sm:p-6 rounded-radius-lg border-2 transition-[background-color,border-color,box-shadow] " +
                      (isSelected
                        ? "border-accent bg-accent-soft shadow-[var(--shadow-card)]"
                        : "border-border-strong bg-surface hover:bg-surface-muted hover:border-accent")
                    }
                  >
                    <span
                      aria-hidden="true"
                      className={
                        "mb-4 grid h-[56px] w-[56px] place-items-center rounded-radius-lg border " +
                        (isSelected ? "border-accent bg-accent text-on-accent" : "border-border-subtle bg-surface text-accent")
                      }
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

          <div className="mb-7 rounded-radius-md bg-surface-muted border border-border-subtle px-4 py-3">
            <p className="text-[14px] text-text-secondary leading-relaxed mb-1">{WELCOME_SWITCH_NOTE}</p>
            <p className="text-[14px] text-text-secondary leading-relaxed">{WELCOME_EXISTING_NOTE}</p>
          </div>

          {saveFailed && (
            <p className="mb-6 p-4 bg-error-soft border border-error rounded-radius-md text-[14px] text-text-primary">
              {WELCOME_SAVE_FAILED}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-6 border-t border-border-subtle">
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
