/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // All colors reference CSS variables so themes swap at runtime.
        // CSS vars hold space-separated RGB triplets (no rgb() wrapper).
        paper: {
          DEFAULT: "rgb(var(--paper) / <alpha-value>)",
          soft: "rgb(var(--paper-soft) / <alpha-value>)",
          warm: "rgb(var(--paper-warm) / <alpha-value>)",
          edge: "rgb(var(--paper-edge) / <alpha-value>)",
          rule: "rgb(var(--paper-rule) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "rgb(var(--ink) / <alpha-value>)",
          soft: "rgb(var(--ink-soft) / <alpha-value>)",
          muted: "rgb(var(--ink-muted) / <alpha-value>)",
          quiet: "rgb(var(--ink-quiet) / <alpha-value>)",
          faded: "rgb(var(--ink-faded) / <alpha-value>)",
          ghost: "rgb(var(--ink-ghost) / <alpha-value>)",
          whisper: "rgb(var(--ink-whisper) / <alpha-value>)",
        },
        // TEMPORARY (migration phase 15): kept pointing at the design
        // system's new tokens rather than the old theme-aware blue — this
        // key is confirmed unused in any JSX today, kept only so nothing
        // that might reference it later silently gets the wrong color.
        // Remove alongside --accent-legacy/--accent-legacy-soft in the
        // cleanup phase.
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          soft: "rgb(var(--accent-soft) / <alpha-value>)",
        },
        // TEMPORARY (migration phase 15, section 3): the old per-category
        // rainbow palette — Timeline no longer reads this (it has its own
        // neutral marker + icon system now), kept only until Bookmarks/
        // Library's own category dots are migrated off it too.
        category: {
          equation: "#6B5F8C",
          diagram: "#8B6B4A",
          chart: "#8C5A47",
        },
        // ── Synapse design system tokens (canonical names from here on) ──
        background: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-muted": "rgb(var(--surface-muted) / <alpha-value>)",
        "text-primary": "rgb(var(--text-primary) / <alpha-value>)",
        "text-secondary": "rgb(var(--text-secondary) / <alpha-value>)",
        "text-muted": "rgb(var(--text-muted) / <alpha-value>)",
        "border-subtle": "rgb(var(--border-subtle) / <alpha-value>)",
        "border-strong": "rgb(var(--border-strong) / <alpha-value>)",
        "accent-hover": "rgb(var(--accent-hover) / <alpha-value>)",
        "accent-pressed": "rgb(var(--accent-pressed) / <alpha-value>)",
        "accent-soft": "rgb(var(--accent-soft) / <alpha-value>)",
        "on-accent": "rgb(var(--on-accent) / <alpha-value>)",
        success: "rgb(var(--success) / <alpha-value>)",
        "success-soft": "rgb(var(--success-soft) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        "warning-soft": "rgb(var(--warning-soft) / <alpha-value>)",
        error: "rgb(var(--error) / <alpha-value>)",
        "error-soft": "rgb(var(--error-soft) / <alpha-value>)",
        focus: "rgb(var(--focus) / <alpha-value>)",
        // TEMPORARY aliases (migration phase 15) — old Tailwind key names,
        // repointed at the new tokens so every existing bg-accent-primary /
        // border-accent-primary / bg-accent-subtle / border-border-default
        // usage (still most of the app) picks up the new values immediately
        // without a JSX edit. border-default aliases to the lighter
        // "subtle" weight, the closer visual match to its current usage;
        // reclassify each usage to border-subtle or border-strong
        // explicitly as its screen migrates, then delete these three keys.
        "accent-primary": "rgb(var(--accent) / <alpha-value>)",
        "accent-primary-hover": "rgb(var(--accent-hover) / <alpha-value>)",
        "accent-subtle": "rgb(var(--accent-soft) / <alpha-value>)",
        "border-default": "rgb(var(--border-subtle) / <alpha-value>)",
      },
      fontFamily: {
        serif: ["ui-serif", '"New York"', "Georgia", "serif"],
        // Single swap point (CSS var, defined in index.css) rather than a
        // literal family list here, so the typeface can change in one place.
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      fontSize: {
        eyebrow: ["11px", { letterSpacing: "0.18em", lineHeight: "1.4" }],
        "eyebrow-sm": ["10px", { letterSpacing: "0.15em", lineHeight: "1.4" }],
      },
      letterSpacing: {
        editorial: "-0.02em",
      },
      borderRadius: {
        editorial: "3px",
        // Named "radius-*" (not "sm"/"md"/"lg") so Tailwind's built-in
        // rounded-sm/rounded-lg used by Timeline/LibraryScreen/Explanation/
        // Navbar keep their current values.
        "radius-sm": "var(--radius-sm)",
        "radius-md": "var(--radius-md)",
        "radius-lg": "var(--radius-lg)",
      },
    },
  },
  plugins: [],
};
