---
name: Synapse
description: "The Accessible Study Desk: calm, colourful and legible."
colors:
  accent: "rgb(54 44 172)"
  accent-hover: "rgb(43 35 140)"
  accent-pressed: "rgb(34 27 112)"
  accent-soft: "rgb(221 218 252)"
  on-accent: "rgb(255 255 255)"
  teal: "rgb(6 78 74)"
  teal-soft: "rgb(200 238 233)"
  bg: "rgb(226 230 248)"
  surface: "rgb(255 255 255)"
  surface-muted: "rgb(236 238 252)"
  text-primary: "rgb(20 23 43)"
  text-secondary: "rgb(55 62 92)"
  text-muted: "rgb(58 65 98)"
  border-subtle: "rgb(200 206 232)"
  border-strong: "rgb(104 112 144)"
  focus: "rgb(20 23 43)"
  success: "rgb(14 88 52)"
  success-soft: "rgb(225 244 233)"
  warning: "rgb(110 66 0)"
  warning-soft: "rgb(253 241 214)"
  error: "rgb(150 22 32)"
  error-soft: "rgb(252 232 232)"
  side-bg: "rgb(32 28 86)"
  side-fg: "rgb(226 224 255)"
  side-muted: "rgb(196 194 240)"
  side-active-bg: "rgb(255 255 255)"
  side-active-fg: "rgb(43 36 150)"
  side-recent-bg: "rgb(47 42 112)"
  side-line: "rgb(58 53 125)"
  side-focus: "rgb(255 255 255)"
  hero-from: "rgb(54 44 172)"
  hero-to: "rgb(6 78 74)"
  hero-fg: "rgb(255 255 255)"
  hero-sub: "rgb(255 255 255)"
typography:
  display:
    fontFamily: '"Atkinson Hyperlegible Next", Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "40px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  headline:
    fontFamily: '"Atkinson Hyperlegible Next", Inter, system-ui, sans-serif'
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.6
    letterSpacing: "-0.025em"
  body:
    fontFamily: '"Atkinson Hyperlegible Next", Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: '"Atkinson Hyperlegible Next", Inter, system-ui, sans-serif'
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.6
  mono:
    fontFamily: '"Atkinson Hyperlegible Mono", "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  radius-sm: "8px"
  radius-md: "12px"
  radius-lg: "18px"
  pill: "9999px"
spacing:
  "1": "4px"
  "1.5": "6px"
  "2": "8px"
  "2.5": "10px"
  "3": "12px"
  "3.5": "14px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "10": "40px"
  "12": "48px"
  "14": "56px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.radius-md}"
    padding: "12px 24px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-primary-active:
    backgroundColor: "{colors.accent-pressed}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.radius-md}"
    padding: "10px 16px"
  button-accent-outline:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.radius-md}"
    padding: "10px 16px"
  button-text:
    textColor: "{colors.accent}"
    rounded: "{rounded.radius-sm}"
    padding: "6px 0"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.radius-md}"
    padding: "12px 16px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.radius-lg}"
  row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.radius-md}"
    padding: "16px 20px"
  chip:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.pill}"
    padding: "4px 12px"
  nav-item:
    textColor: "{colors.side-fg}"
    rounded: "{rounded.radius-md}"
    padding: "8px 14px"
  nav-item-active:
    backgroundColor: "{colors.side-active-bg}"
    textColor: "{colors.side-active-fg}"
---

# Design System: Synapse

## Overview

**Creative North Star: "The Accessible Study Desk"**

Synapse is calm, colourful and legible; clarity leads every decision. Like a well-organised study desk, it gives lecture content, playback and learning actions clear places. Colour distinguishes regions and supports orientation while readable text and explicit controls carry meaning.

Components feel approachable and precise. Rounded boundaries, generous control targets and layered surfaces with soft ambient shadows make the interface easy to scan without turning it into a decorative showcase. Strong focus indicators and non-colour state cues are part of the visual system.

**Key Characteristics:**

- Clear hierarchy with self-hosted, highly legible sans-serif type.
- Study Indigo and Deep Teal, with Lavender Mist and white surfaces.
- Clearly bounded controls and rounded, softly layered panels.
- Consistent interaction cues across Paper, Night and Sepia.

This records the incumbent implementation, not a redesign. Source authority is `src/index.css`, `tailwind.config.js`, `src/main.jsx` and current components. Older parchment/editorial helpers remain in source but do not define the current interface. This pass was checked against source; browser preview access was unavailable, so no rendered or accessibility audit is claimed.

## Colors

The palette combines concentrated indigo and deep teal with cool, light working surfaces. Frontmatter records Paper defaults using CSS RGB notation; source variables store the corresponding space-separated channel triplets.

### Primary

- **Study Indigo** (`accent`): primary actions, selected controls and emphasis. Hover and pressed tokens deepen the filled control; `accent-soft` supports selected backgrounds and outline actions.
- **On Accent** (`on-accent`): foreground on filled accent surfaces. Always use the semantic foreground rather than assuming white in every theme.

### Secondary

- **Deep Teal** (`teal`, `teal-soft`): secondary brand colour and decorative subject treatment. The header band blends the hero tokens at 120 degrees; it is an established shared treatment on Home, Welcome and account screens.

### Neutral

- **Lavender Mist** (`bg`): the Paper workspace background.
- **White Surface** (`surface`) and **Soft Lavender** (`surface-muted`): working panels and quiet secondary regions.
- **Deep Ink** (`text-primary`), **Slate Ink** (`text-secondary`) and **Muted Slate** (`text-muted`): content hierarchy.
- **Soft Divider** (`border-subtle`): decorative divisions and static containers.
- **Control Boundary** (`border-strong`): interactive edges, including fields, secondary buttons and clickable rows.
- **Sidebar Indigo** (`side-bg`): navigation ground, with its own foreground, selected, hover, divider and focus tokens.
- **Focus Ink** (`focus`): focus indication on ordinary surfaces; the sidebar uses `side-focus` instead.

Success, warning and error use their semantic foreground/soft-background pairs. Subject tints (`tint-1` through `tint-5`, with matching foregrounds) are decorative; icons and labels identify the subjects.

**The Boundary Rule.** Interactive boundaries use the strong border tier. Soft dividers and shadows must not be the only visible indication that a surface is interactive.

**The Meaning Rule.** Colour supports meaning; text, icons, selection marks, weight or borders must also communicate state.

### Theme behaviour

`data-theme` on the document selects Paper, Night or Sepia. Night uses a deep navy workspace, lighter indigo actions and dark `on-accent` text. Sepia uses warm cream surfaces and brown accent actions while retaining teal. All values come from the matching overrides in `src/index.css`; new UI must use semantic variables so the whole theme follows. Sepia inherits status colours and subject tints where it does not override them; do not imply independently specified values for those roles.

The theme picker swatches in `Navbar.jsx` reflect the background, primary text and accent for each theme. Paper is described as “Light and colourful”; the old parchment palette is legacy, despite the retained theme name.

The sidecar's eight-step OKLCH tonal ramps are generated swatch previews, not additional implementation tokens or approved text/background pairs. Do not substitute them for the source theme values.

## Typography

**Display and Body Font:** Atkinson Hyperlegible Next, with the full fallback stack recorded in frontmatter and owned by `--font-sans`.

**Mono Font:** Atkinson Hyperlegible Mono, with the `--font-mono` fallback stack, for time labels and technical content.

Self-hosted sans weights (400, 500, 600, 700) and mono weights (400, 500) load in `src/main.jsx`. Inter and JetBrains Mono are fallback names, not bundled primary fonts. The character is open and direct: legibility and content hierarchy take priority over expressive type pairing.

### Hierarchy

- **Display:** Home's large heading uses the display role. Welcome reduces it to 34px below the small breakpoint; account headings use 28px/32px instead.
- **Headline:** section headings use the headline role; dialog headings can use semibold with a tighter line height. This is an observed role mapping, not an enforced global heading class.
- **Body:** the base role covers running text; introductions and the lecture search input commonly use 17px with relaxed leading.
- **Label:** primary and secondary button labels use the label role. Supporting labels vary between 13px and 15px; chips and quieter actions use 14px medium.
- **Mono:** timeline timestamps and keyboard references use the mono face. Frontmatter captures the common timestamp size, not a requirement for every code fragment.

Body enables kerning, ligatures and old-style numerals; headings also enable discretionary ligatures. Keep family selection behind the shared font utilities. Current screens do not use the legacy serif headlines or uppercase, widely tracked eyebrow style.

## Layout

The working interface is a full-height flex shell with independently scrolling content. The persistent sidebar is 248px wide; the top navbar is 56px high. Home uses an 880px maximum-width content area with 40px horizontal and 56px vertical padding. The lecture shell caps at 1400px. These are existing desktop layouts, not evidence that every screen is fully responsive.

Welcome uses an 820px maximum width; account forms use 600px. Both change outer padding from 16px to 32px at the small breakpoint. Welcome's two mode cards become two columns there. Home's subject grid uses two columns by default, three at small and five at large. Existing Tailwind breakpoints used here are small (640px), medium (768px) and large (1024px).

Spacing follows the installed Tailwind scale, with common steps captured in frontmatter. Rows use 20px horizontal / 16px vertical padding; fields use 16px / 12px. Static cards intentionally have no universal padding: the containing screen owns it. Preserve wrapping and text scaling in lecture and quiz content; do not infer a mobile drawer or collapsed sidebar that does not exist.

## Elevation & Depth

Surfaces are layered, with soft ambient shadows rather than theatrical lifting. Card shadows separate white panels from the workspace; the primary action has a smaller accent-tinted shadow. Night strengthens dark card shadows and removes the button shadow; Sepia warms them. Exact shadow definitions and focus-ring recipes are recorded in `.impeccable/design.json` and remain owned by the source theme variables.

Help is a modal layer over a half-opacity black scrim, with an 18px radius, a 640px width cap and an 85vh height cap. Its content scrolls within the dialog. Focus rings override the primary-button or row drop shadow while focused so that the focus cue stays clear.

## Shapes

Use the shared small, medium and large radius tokens for compact details, controls and panels respectively. Chips use a full pill. Some small timestamp badges retain Tailwind's smaller built-in corners; do not confuse those utilities with the explicitly named `radius-*` scale. The supplied app icon uses a proportional quarter-width radius in `BrandMark`.

The common control boundary is 1.5px; static cards use 1px. Onboarding selection cards use a 2px border and a checkmark plus stronger text. Preserve these structural state cues across themes.

## Components

### Buttons

Approachable, clearly bounded actions. Primary buttons are accent-filled with `on-accent` text, medium corners, a 48px minimum height and the primary shadow. Hover and press use their respective semantic accent tokens. Secondary buttons use a surface fill and strong border with the same height; hover uses the muted surface. Accent-outline actions use an accent border and soft fill with 14px medium text and a 44px minimum height. Text actions use 14px medium accent text and underline on hover.

All use the shared visible-focus treatment. Disabled appearance is applied by callers, not by one universal primitive rule: Home dims its primary action to 40%, while account submission uses 60%. Preserve native disabled semantics and the screen's actual state handling.

### Cards / Containers

Static cards use large corners, a subtle border and the card shadow. Clickable rows use medium corners, the strong border and the same shadow; hover changes the surface tone, and focus uses the common ring. A static container is not automatically clickable. Subject tiles and saved-item rows extend these primitives without replacing their boundary and focus semantics.

### Inputs / Fields

The shared field is a 56px-minimum-height surface wrapper with medium corners, a strong boundary and space for an icon or supporting affordance. Focus within changes the border to accent and applies the surface-separated focus ring. Inner text is transparent over the wrapper; search commonly uses 17px, account inputs 16px. Account errors add an error-coloured boundary and visible text associated with the field. Do not remove the focus treatment when suppressing an inner outline.

### Navigation

The dark sidebar has its own colour family and white focus cue. Items use 15px medium type, a 46px minimum height and medium corners. Hover fills with the recent-item background. The current page has a contrasting filled background and bold text, with `aria-current`; forced colours add an inline bar and underline. The header's theme panel closes with Escape and returns focus to its trigger.

### Chips

Chips use a muted surface, strong border, full rounding and 14px medium text. The shared primitive is a labelled status/category treatment, not a complete selectable-chip state machine. An icon and text supply meaning; do not rely on tint alone.

### Lecture and reading controls

Lecture presentation controls use grouped pressed buttons. Accessibility mode retains the same audio-capable player while hiding its visual controls from the accessibility tree. Study mode exposes video and reading controls. Quiz scaling and high contrast are scoped to the quiz subtree; preserve these local overrides rather than claiming app-wide scaling.

### Interaction accessibility

**The Focus Rule.** Visible keyboard focus must survive both themed surfaces and Windows forced colours. The common ring uses a 2px surface separator and a 5px outer spread, with a transparent 3px outline retained for forced-colour rendering. Sidebar focus swaps to its own background and focus tokens.

Colour transitions normally use Tailwind's 150ms easing. Existing 100ms progress transitions are local to the lecture; this is not a system-wide animation duration. Reduced-motion rules disable pulse and spin. Forced colours add a 3px primary-button border and a 5px active-navigation bar. Retain these cues, focus return, readable labels and deliberate status announcements when extending components.

## Do's and Don'ts

### Do:

- **Do** use semantic theme variables and the current shared primitives for new UI.
- **Do** use the strong border tier for interactive boundaries and the subtle tier for static divisions.
- **Do** keep text, icons and structural cues alongside colour-based states.
- **Do** preserve focus rings, forced-colour fallbacks, reduced motion and reading-control overrides.
- **Do** reuse the supplied brand assets and self-hosted typefaces.

### Don't:

- **Don't** hard-code white foregrounds on accent buttons; Night uses a dark foreground.
- **Don't** revive the legacy paper/ink palette, serif headlines or editorial eyebrow helpers for current screens.
- **Don't** give a static card interactive semantics without the corresponding handler, boundary and focus treatment.
- **Don't** treat source inspection or contrast targets as proof of rendered accessibility or WCAG conformance.
- **Don't** invent a mobile navigation pattern or global text-scaling capability when documenting the current system.
