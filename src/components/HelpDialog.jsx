import { useEffect, useRef } from "react";
import { quizEnabled } from "../lib/quizFlag";
import { getHelpSections, HELP_CLOSE, HELP_TITLE } from "../lib/onboardingText";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * HelpDialog — a modal dialog, not a screen: App keeps the screen behind it mounted (so a lecture's
 * player and processing job are untouched) and marks it inert while this is open.
 *
 * Focus goes to the title when it opens. Tab and Shift+Tab stay inside. Escape and Close both call
 * onClose; the caller puts focus back where it came from. Nothing here plays, speaks or pauses anything:
 * whatever Help did to playback happened before it opened, and is passed in as `notice`, which is shown
 * and used as the dialog's description (so it is read when the dialog opens; a live region on the
 * inert screen behind would not be).
 *
 * Props:
 *   - onClose()
 *   - notice   optional text describing what Help paused or stopped
 */
export default function HelpDialog({ onClose = () => {}, notice = "" }) {
  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // One document-level listener, so Escape and Tab are handled even when focus has fallen back to
  // the body (for example after clicking plain text in the dialog).
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const items = Array.from(dialog.querySelectorAll(FOCUSABLE));
      if (items.length === 0) {
        e.preventDefault();
        titleRef.current?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const outside = !dialog.contains(active);
      if (e.shiftKey) {
        if (outside || active === first || active === titleRef.current || active === dialog) {
          e.preventDefault();
          last.focus();
        }
      } else if (outside || active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    // If anything outside ever takes focus, bring it back.
    const onFocusIn = (e) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target)) titleRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, []);

  const sections = getHelpSections({ practice: quizEnabled() });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 font-sans">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        aria-describedby={notice ? "help-notice" : undefined}
        tabIndex={-1}
        className="w-full max-w-[640px] max-h-[85vh] flex flex-col bg-surface border border-border-strong rounded-radius-lg shadow-[0_8px_32px_rgba(15,23,42,0.24)] outline-none"
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3 border-b border-border-subtle">
          <h2
            id="help-title"
            ref={titleRef}
            tabIndex={-1}
            className="text-[22px] font-semibold text-text-primary leading-tight outline-none rounded-radius-sm focus-ring"
          >
            {HELP_TITLE}
          </h2>
          <button type="button" onClick={() => onCloseRef.current()} className="ds-btn-secondary shrink-0">
            {HELP_CLOSE}
          </button>
        </div>

        {notice && (
          <p id="help-notice" className="px-6 pt-3 text-[14px] font-medium text-text-primary">
            {notice}
          </p>
        )}

        {/* Focusable so the keyboard can scroll it; named so it is not an anonymous stop. */}
        <div
          role="region"
          aria-label="Help contents"
          tabIndex={0}
          className="overflow-y-auto px-6 py-4 outline-none focus-ring"
        >
          {sections.map((section) => (
            <section key={section.id} aria-labelledby={`help-${section.id}`} className="mb-6 last:mb-0">
              <h3 id={`help-${section.id}`} className="text-[17px] font-semibold text-text-primary mb-2">
                {section.heading}
              </h3>
              {(section.groups ?? []).map((group) => (
                <div key={group.heading} className="mb-3">
                  <h4 className="text-[15px] font-semibold text-text-primary mb-1">{group.heading}</h4>
                  <ul className="space-y-1 text-[15px] text-text-secondary">
                    {group.items.map((item) => (
                      <li key={item.keys}>
                        <span className="font-mono text-text-primary">{item.keys}</span>
                        {" — "}
                        {item.description}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {section.paragraphs.map((text) => (
                <p key={text} className="text-[15px] text-text-secondary leading-relaxed mb-2 last:mb-0">
                  {text}
                </p>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
