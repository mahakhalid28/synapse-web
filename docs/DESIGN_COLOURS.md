# Design colours and what has (and has not) been checked

Colours live in `src/index.css` as space-separated RGB tokens (`:root` = Light,
`[data-theme="night"]`, `[data-theme="sepia"]`) and are mapped in
`tailwind.config.js`. Themes: **Light** (default "paper"), **Night**, **Sepia**.

## Targets

| What | Target | Why |
|---|---|---|
| Running text (paragraphs, labels, links, chips, status text) | **7:1** | WCAG AAA "enhanced" contrast. Above the usual 4.5:1 AA minimum, chosen for low-vision readers. |
| Borders of inputs, buttons, clickable cards; focus rings; icons | **3:1** | WCAG 1.4.11 non-text contrast |
| Clickable things | Strong border (`border-border-strong`), never a shadow alone | `.ds-row`, `.ds-btn-secondary`, `.ds-field` |
| Static panels | Soft shadow + subtle border (`.ds-card`) | Not controls, so a faint boundary is acceptable |
| Colour as the only signal | Never | Icons, text and weight always accompany colour. Subject tints are decoration only. |

## Measured contrast (calculated from the real tokens in `index.css`)

WCAG relative-luminance formula, computed from the values in the CSS, not
from screenshots. Re-run it whenever a token changes.

| Pair | Light | Night | Sepia |
|---|---|---|---|
| Main text on a card | 17.7:1 | 14.7:1 | 14.9:1 |
| Main text on the page | 14.2:1 | 16.2:1 | 12.4:1 |
| Secondary text on the page | 8.4:1 | 10.7:1 | 8.6:1 |
| Muted text on the page | 8.0:1 | 9.6:1 | 8.3:1 |
| Muted text on a tinted panel | 8.6:1 | 7.8:1 | 9.0:1 |
| Link / accent text on the page | 8.0:1 | 9.8:1 | 8.0:1 |
| Accent text on an accent chip | 7.3:1 | 7.3:1 | 7.5:1 |
| Button label on the accent colour | 9.9:1 | 9.8:1 | 10.2:1 |
| Teal text on a teal chip | 7.7:1 | 8.0:1 | 8.3:1 |
| Sidebar text | 12.0:1 | 9.7:1 | 11.4:1 |
| Sidebar muted text on its panel | 7.3:1 | 7.8:1 | 7.6:1 |
| Error text on its tint | 7.3:1 | 8.1:1 | 7.3:1 |
| Border of inputs, buttons, clickable cards (on the page) | 3.9:1 | 4.8:1 | 4.8:1 |
| Keyboard focus ring on a card | 17.7:1 | 17.0:1 | 14.9:1 |
| Keyboard focus ring on the sidebar | 15.4:1 | 17.0:1 | 13.8:1 |

White text on the header band (Home) is at least 9.6:1 (Light), 8.0:1 (Night)
and 10.2:1 (Sepia) at the worst point along the gradient.

## Keyboard focus and Windows High Contrast

* `.focus-ring` draws a 2 px + 5 px box-shadow ring. On the dark sidebar the
  ring is white (`--side-focus`) via `.ds-side .focus-ring:focus-visible`.
* In forced-colors mode (Windows High Contrast) the browser replaces our
  colours. `index.css` has a `@media (forced-colors: active)` block that
  (a) hides the "transparent" outline on controls that are not focused, which
  otherwise drew a permanent box around everything, (b) gives the primary
  button a heavier border than a secondary one, and (c) gives the current
  sidebar page a bar and an underline.

## NOT verified (do not claim these)

* Conformance to WCAG as a whole. Contrast is one part. This is not an audit.
* Zoom and reflow at 200% and 400%, and text spacing overrides.
* Behaviour with real screen readers after the redesign. The accessibility
  tree (roles, names, structure) was diffed before and after for Welcome,
  Home, search results and both lecture modes and was identical, but that is
  not a screen-reader test.
* Real low-vision users, magnifiers (ZoomText, Windows Magnifier), light
  sensitivity or glare comfort.
* Colour-vision deficiency was only simulated with a standard matrix on the
  mockups, not tested with people.
