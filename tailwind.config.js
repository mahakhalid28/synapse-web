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
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          soft: "rgb(var(--accent-soft) / <alpha-value>)",
        },
        category: {
          equation: "#6B5F8C",
          diagram: "#8B6B4A",
          chart: "#8C5A47",
        },
        // ── New STEM-workspace design system tokens (additive) ──
        // Named "accent-primary"/"accent-subtle" rather than "accent" so the
        // existing accent/accent-soft key above (still used by unmigrated
        // screens) is never overwritten.
        background: "rgb(var(--background) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-muted": "rgb(var(--surface-muted) / <alpha-value>)",
        "border-default": "rgb(var(--border-default) / <alpha-value>)",
        "text-primary": "rgb(var(--text-primary) / <alpha-value>)",
        "text-secondary": "rgb(var(--text-secondary) / <alpha-value>)",
        "text-muted": "rgb(var(--text-muted) / <alpha-value>)",
        "accent-primary": "rgb(var(--accent-primary) / <alpha-value>)",
        "accent-subtle": "rgb(var(--accent-subtle) / <alpha-value>)",
      },
      fontFamily: {
        serif: ["ui-serif", '"New York"', "Georgia", "serif"],
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          "sans-serif",
        ],
        mono: [
          '"JetBrains Mono"',
          '"SF Mono"',
          "Menlo",
          "Consolas",
          "monospace",
        ],
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
