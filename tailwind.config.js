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
        // ── Synapse design system tokens (canonical names) ──
        // "accent" is the bare DEFAULT utility (bg-accent/text-accent/
        // border-accent) used throughout every migrated screen; accent-soft
        // below covers the tinted variant (bg-accent-soft etc.) — kept as a
        // single flat key rather than a nested {DEFAULT, soft} object so
        // there's exactly one definition of each utility name, not two.
        accent: "rgb(var(--accent) / <alpha-value>)",
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
        // rounded-sm (still used by Timeline/LibraryScreen for small
        // timestamp-badge corners) keeps its own, smaller value.
        "radius-sm": "var(--radius-sm)",
        "radius-md": "var(--radius-md)",
        "radius-lg": "var(--radius-lg)",
      },
    },
  },
  plugins: [],
};
