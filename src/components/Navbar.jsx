import { useState, useEffect, useRef } from "react";

const THEMES = [
  {
    key:    "paper",
    label:  "Paper",
    desc:   "Warm parchment",
    swatch: ["#F7F4EC", "#2A2520", "#4A5B8C"],
  },
  {
    key:    "night",
    label:  "Night",
    desc:   "Dark mode",
    swatch: ["#1C1A17", "#E8E0D4", "#6B7BAA"],
  },
  {
    key:    "sepia",
    label:  "Sepia",
    desc:   "Amber reading",
    swatch: ["#F2E8D4", "#3C2C18", "#8B5E3C"],
  },
];

export default function Navbar({ theme = "paper", onThemeChange = () => {} }) {
  const [open, setOpen] = useState(false);
  const panelRef        = useRef(null);

  // Close panel on outside click
  useEffect(() => {
    if (!open) return;
    const handle = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  return (
    <header className="h-10 shrink-0 bg-surface border-b border-border-default flex items-center px-4 relative z-40 font-sans">
      {/* Right side: gear button + panel */}
      <div ref={panelRef} className="ml-auto relative">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Settings"
          aria-expanded={open}
          className={
            "w-7 h-7 flex items-center justify-center rounded-radius-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary focus-visible:outline-offset-2 " +
            (open
              ? "bg-accent-subtle text-accent-primary"
              : "text-text-secondary hover:text-text-primary hover:bg-surface-muted")
          }
        >
          <GearIcon />
        </button>

        {open && (
          <div className="absolute top-full right-0 mt-1.5 w-[220px] bg-surface border border-border-default rounded-radius-md shadow-[0_2px_8px_rgba(15,23,42,0.08)] overflow-hidden">
            {/* Panel header */}
            <div className="px-4 pt-3 pb-2 border-b border-border-default">
              <p className="text-[13px] font-medium text-text-secondary">
                Appearance
              </p>
            </div>

            {/* Theme options */}
            <div className="p-3 space-y-1">
              {THEMES.map((t) => {
                const active = theme === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => { onThemeChange(t.key); setOpen(false); }}
                    className={
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-radius-sm text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary focus-visible:outline-offset-2 " +
                      (active
                        ? "bg-accent-subtle"
                        : "hover:bg-surface-muted")
                    }
                  >
                    {/* Color swatch strip */}
                    <span className="flex shrink-0 rounded-radius-sm overflow-hidden w-8 h-5 border border-border-default">
                      {t.swatch.map((c, i) => (
                        <span
                          key={i}
                          className="flex-1"
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </span>

                    {/* Labels */}
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-medium text-text-primary leading-none mb-0.5">
                        {t.label}
                      </span>
                      <span className="block text-[13px] text-text-secondary">
                        {t.desc}
                      </span>
                    </span>

                    {/* Active checkmark */}
                    {active && (
                      <span className="text-[13px] font-medium text-accent-primary shrink-0">✓</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Footer hint */}
            <div className="px-4 py-2.5 border-t border-border-default">
              <p className="text-[13px] text-text-muted leading-snug">
                More settings coming soon.
              </p>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="3" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42" />
    </svg>
  );
}
