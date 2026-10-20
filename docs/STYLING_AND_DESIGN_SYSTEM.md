# Styling and Design System

How styling works in Synapse. Tags: **[Verified]** (read from `src/index.css`, `tailwind.config.js`, components), **[Inferred]**, **[Unknown]**. Colour values below are copied from the source; where `src/index.css` comments claim WCAG ratios were checked, that is the original author's statement and was **not** re-measured here.

## Stack

- **Tailwind CSS 3** (`tailwind.config.js`, content globs `./index.html` and `./src/**/*.{js,jsx,ts,tsx}`) + PostCSS/Autoprefixer (`postcss.config.js`). Styling is mostly utility classes in JSX plus a handful of shared component classes.
- **Design tokens** are CSS custom properties on `:root` / `[data-theme="…"]` in `src/index.css`, stored as space-separated RGB triplets (e.g. `--accent: 36 86 166`). `tailwind.config.js` maps them to utilities using `rgb(var(--x) / <alpha-value>)`, so every token supports Tailwind opacity modifiers (`bg-accent/40`).
- **Theme switch:** `data-theme` on `<html>` (`paper` default, `night`, `sepia`), set in `src/main.jsx` before first render and by `App.jsx`; UI in `Navbar.jsx`.
- **Fonts:** self-hosted Fontsource Atkinson Hyperlegible Next (400/500/600/700) and Mono (400/500), imported in `src/main.jsx`. `--font-sans`/`--font-mono` in `src/index.css` are the single swap point; Tailwind's `font-sans`/`font-mono` read them. **Also** `src/index.css` still starts with an `@import` of a Google Fonts stylesheet (Inter, JetBrains Mono), which is a network dependency and is only a fallback in the font stacks.
- **Base:** `html, body, #root { height: 100% }`; `body` uses `bg-paper text-ink-soft font-sans`, 16px, line-height 1.6.

## Two token sets (additive — never delete the old one)

### 1. New semantic tokens (use these)

Defined on `:root` (Paper/default and Sepia fall back to these light values) and overridden for `[data-theme="night"]`.

| Token (CSS var → Tailwind utility) | Light (`:root`) | Night | Use |
|---|---|---|---|
| `--bg` → `bg-background` | 244 245 247 | 16 20 25 | Page background |
| `--surface` → `bg-surface` | 255 255 255 | 23 28 35 | Cards, inputs, panels |
| `--surface-muted` → `bg-surface-muted` | 238 240 243 | 30 36 44 | Subtle fills, hover |
| `--text-primary` → `text-text-primary` | 20 24 31 | 232 235 239 | Main text |
| `--text-secondary` → `text-text-secondary` | 63 72 84 | 182 189 200 | Secondary text |
| `--text-muted` → `text-text-muted` | 86 96 112 | 144 153 166 | Tertiary text |
| `--border-subtle` → `border-border-subtle` | 213 218 225 | 43 50 60 | **Decorative dividers only** |
| `--border-strong` → `border-border-strong` | 123 133 148 | 107 118 134 | Anything interactive (inputs, buttons, toggles) |
| `--accent` → `bg-accent`/`text-accent`/`border-accent` | 36 86 166 | 127 168 240 | Primary action/selection |
| `--accent-hover`, `--accent-pressed` → `bg-accent-hover/-pressed` | 27 68 136 / 21 54 112 | 157 189 245 / 181 206 248 | Hover/active (primary button) |
| `--accent-soft` → `bg-accent-soft` | 232 239 250 | 27 42 69 | Tinted accent surface |
| `--on-accent` → `text-on-accent` | 255 255 255 | 16 20 25 | Text on filled accent |
| `--success`, `--success-soft` | 30 122 80 / 230 243 236 | 111 199 153 / 18 42 30 | Status |
| `--warning`, `--warning-soft` | 138 90 0 / 253 241 216 | 230 173 90 / 46 35 17 | Status |
| `--error`, `--error-soft` → `text-error`, `bg-error-soft`, `border-error` | 179 38 30 / 251 233 231 | 237 128 118 / 46 26 24 | Errors (used by Ask) |
| `--focus` → `focus` | 11 42 102 | 255 255 255 | Focus ring colour |
| `--radius-sm/md/lg` → `rounded-radius-sm/md/lg` | 4px / 8px / 12px | — | Corner radii |

**Naming trap:** the radius utilities are deliberately `rounded-radius-*`, not `rounded-sm/md/lg`. Tailwind's built-in `rounded-sm` is still used for tiny badges in Timeline/Library.

### 2. Legacy editorial tokens (still defined; unused in JSX)

`--paper*`, `--ink*`, `--accent-legacy*`, `--btn-hover`, `--btn-border-hover` (themed for paper/night/sepia), Tailwind keys `paper.*`, `ink.*`, `rounded-editorial`, `font-serif`, `text-eyebrow`, and the component classes `.eyebrow`, `.headline`, `.subtitle`, `.section-marker`, `.btn-primary`, `.btn-secondary` in `src/index.css`. A grep of `src/**/*.jsx` found **no** use of these classes or the `ink`/`paper` utilities (only the global `body { @apply bg-paper text-ink-soft }` rule still uses them) [Verified]. `CLAUDE.md` instructs: **do not delete or repurpose them.** Sepia only themes this legacy set, which is why Sepia looks like the light theme for new-token surfaces.

> `CLAUDE.md` lists tokens named `accent-primary`, `border-default`, `accent-subtle` and says some screens are unmigrated. The current config/CSS no longer has those names and all screens use the new tokens (the `src/index.css` header comment says the bridging aliases were removed). Trust the code; see [Known issues](./KNOWN_ISSUES_AND_TECHNICAL_DEBT.md).

## Shared component classes (`@layer components` in `src/index.css`)

| Class | Purpose |
|---|---|
| `.focus-ring` | Shared focus indicator: transparent 3px outline (so forced-colors mode still shows a ring) + two-layer box-shadow ring on `:focus-visible` (`--surface` then `--focus`). |
| `.ds-btn-primary` | Filled accent button, `min-h-[44px]`; one per major view. Hover/active use `--accent-hover`/`--accent-pressed`. |
| `.ds-btn-secondary` | Surface background, `border-border-strong`, `min-h-[44px]`. |
| `.ds-btn-accent-outline` | Accent-soft background + accent border (Library "Play audio"). |
| `.ds-btn-text` | Quiet accent text button with underline on hover. |
| `.ds-field` | Input wrapper (flex, `min-h-[44px]`, `border-border-strong`), gets the focus ring on `:focus-within`. Inner `<input>` elements use `outline-none`. |
| `.ds-row` | Clickable card row (used for search results). |
| `.ds-nav-item` / `.ds-nav-item-active` | Sidebar items; active = accent text + accent-soft background + semibold (never colour alone). |
| `.ds-chip` | Neutral category chip; the category is shown with an icon + text, not colour. |

## Conventions (from `CLAUDE.md` and the code)

- Migrated screens put **`font-sans` on the root wrapper** and use sans-serif everywhere. No uppercase/letter-spaced "eyebrow" labels — plain `text-[12–14px] font-medium text-text-secondary`.
- Every interactive element needs a visible focus style: use `focus-ring` (or the explicit `focus-visible:outline …` set). Never a bare `outline-none` without a replacement. Programmatic-focus-only targets (headings, `main`) use `outline-none`/`tabIndex={-1}`.
- Minimum target: 44 px (`min-h-[44px]`) for primary controls (small Study-mode controls and the Listening speed select are exceptions — see [ACCESSIBILITY](./ACCESSIBILITY.md#visual-accessibility)).
- Typography sizes are mostly arbitrary pixel values (`text-[14px]`, `text-[32px]` for H1s, 14–15px body, 18px explanation text); there is no named type scale beyond Tailwind's defaults and the unused `text-eyebrow`.
- Spacing: Tailwind's scale (`px-10 py-14`, `gap-2`…); screens use `max-w-[…]` containers (Home 880 px, Explanation 720 px reading column, Bookmarks 700 px, Library 680 px).
- Layout: each screen is `flex h-full w-full` with a fixed 200 px `Sidebar`; Explanation adds a 300 px "Lecture details" aside in Study mode; Timeline has a 300 px preview pane.
- Reduced motion: `src/index.css` `@layer base` disables `.animate-pulse`/`.animate-spin` for `prefers-reduced-motion: reduce`.
- Text scaling and high contrast are implemented per element in `Explanation.jsx` via inline `fontSize` and conditional classes — see [ACCESSIBILITY](./ACCESSIBILITY.md#visual-accessibility). They are **not** global tokens.

## Hard-coded colours that remain (intentional or not)

- `Navbar.jsx`: theme swatch hex values (the swatches *are* the theme palettes).
- Thumbnail placeholders `from-[#3B4870] to-[#8B6B4A]` (Library, Timeline), overlay chips `bg-black/75 text-white`, high-contrast `bg-white … text-black`, and `shadow-[0_2px_8px_rgba(15,23,42,0.08)]` on the settings panel.
- `electron.cjs` `backgroundColor: "#F7F4EC"` (the legacy paper colour, not a new token) — shown briefly before first paint.

## Adding styles without reintroducing deprecated patterns

1. Reach for semantic tokens and `ds-*` classes first; do not use `ink-*`/`paper-*`/`font-serif`/`.btn-*`/`.eyebrow`/`rounded-editorial` in new code.
2. New colour need → add the variable to `:root` **and** `[data-theme="night"]` in `src/index.css` and a Tailwind key in `tailwind.config.js` (`rgb(var(--x) / <alpha-value>)`); verify contrast in both themes (4.5:1 text, 3:1 UI boundaries).
3. New reusable control → add a `.ds-*` class in `@layer components` that includes `focus-ring` and a 44 px minimum.
4. Convey state with text/shape/weight plus ARIA — never colour alone.
5. Keep one `font-sans` wrapper per screen; do not reference literal font names (use the CSS variables).
6. Do not delete the legacy token set (project rule).

## Inconsistencies and migration notes

- Sepia is only partly themed (see above).
- Legacy CSS/Tailwind tokens remain as dead weight.
- Google Fonts `@import` coexists with Fontsource.
- Some small controls are below 44 px; Timeline's SVG uses `rgb(var(--…))` strings directly.
- Several components still use arbitrary pixel font sizes instead of a shared scale.
- `CLAUDE.md`'s description of the design system and migration status is outdated.
