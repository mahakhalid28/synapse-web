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
    <header className="h-14 shrink-0 bg-surface border-b border-border-subtle flex items-center px-4 relative z-40 font-sans">
      {/* Right side: gear button + panel */}
      <div ref={panelRef} className="ml-auto relative">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Settings"
          aria-expanded={open}
          className={
            "w-11 h-11 flex items-center justify-center rounded-radius-sm transition-colors focus-ring " +
            (open
              ? "bg-accent-soft text-accent"
              : "text-text-secondary hover:text-text-primary hover:bg-surface-muted")
          }
        >
          <GearIcon />
        </button>

        {open && (
          <div className="absolute top-full right-0 mt-1.5 w-[220px] bg-surface border border-border-subtle rounded-radius-md shadow-[0_2px_8px_rgba(15,23,42,0.08)] overflow-hidden">
            {/* Panel header */}
            <div className="px-4 pt-3 pb-2 border-b border-border-subtle">
              <p className="text-[14px] font-medium text-text-secondary">
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
                    aria-pressed={active}
                    className={
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-radius-sm text-left transition-colors focus-ring " +
                      (active
                        ? "bg-accent-soft"
                        : "hover:bg-surface-muted")
                    }
                  >
                    {/* Color swatch strip — these three colors are the
                    actual theme's own palette being previewed, not
                    decorative chrome, so they stay literal hex rather than
                    semantic tokens (there's nothing to tokenize: showing
                    what each theme looks like is the whole point). */}
                    <span className="flex shrink-0 rounded-radius-sm overflow-hidden w-8 h-5 border border-border-subtle">
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
                      <span className="block text-[14px] font-medium text-text-primary leading-none mb-0.5">
                        {t.label}
                      </span>
                      <span className="block text-[14px] text-text-secondary">
                        {t.desc}
                      </span>
                    </span>

                    {/* Active checkmark */}
                    {active && (
                      <span aria-hidden="true" className="text-[14px] font-medium text-accent shrink-0">✓</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Footer hint */}
            <div className="px-4 py-2.5 border-t border-border-subtle">
              <p className="text-[14px] text-text-muted leading-snug">
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
    <svg aria-hidden="true" width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="3" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42" />
    </svg>
  );
}
