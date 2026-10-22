# DESIGN.md - Page Archive design system

The UI follows the owner's neo-brutalist "app dialect": warm paper and char
base, one orange accent, hard edges, solid offset shadows, two-font tension.
It must never look like generic SaaS or templated AI output. When in doubt,
subtract. All tokens live at the top of `popup.css`.

## Tokens
| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--paper` | #f2efe8 | #131311 | Page background |
| `--card` | #faf8f2 | #1c1b18 | Panels, inputs |
| `--ink` | #1c1a16 | #f2efe8 | Text and every border |
| `--muted` | #6f6a5c | #a39e8f | Secondary text, labels |
| `--faint` | #d9d4c7 | #34322c | Empty progress cells, dashed rules |
| `--accent` | #ff6b1a | #ff6b1a | The one accent: primary action, active state, warnings |
| `--shadow` | rgba(28,26,22,.85) | rgba(242,239,232,.2) | Solid offset shadows |
Never pure #fff or #000. No gradients anywhere in the UI.

## Type
- Outfit 400/500/600 for all words; slight negative tracking on headings.
- Doto 900 ONLY for numerals (percent counter, version, file sizes). Never for
  words; the "LITE" badge uses Outfit.
- Uppercase 10px labels with 0.09em tracking for group labels and phase titles.
- Fonts are bundled in `fonts/` (OFL). Never load fonts from the network.

## Shape and depth
- `border-radius: 0` everywhere.
- Borders are the ink colour, 1.5px in the dense popup (2px on the toggle).
- Shadows are solid, never blurred: 3px 3px for major surfaces, 2px for small.
- Hover: element moves up-left, shadow grows. Active: moves down-right, shadow
  collapses. That inverse motion is the signature interaction.
- Stacked depth (the logo's offset pages) is the brand motif; reuse it sparingly.

## Components (popup.html)
- Header: stacked-pages logo (SVG, ink + accent), "Page Archive" with "Archive"
  in accent, version chip in Doto, square theme toggle.
- Primary CTA: accent fill, ink border and shadow, title + meta line
  ("Full render - PNG - Smart"), keyboard hint chip.
- Secondary button: card fill, ink border.
- Segmented controls (Format, Target): ink border, selected = ink fill with paper text.
- Toggle: 36x20 box, 2px border, 12px square knob, 2px gutter, accent when on.
- Select: square, ink border, pixel chevron in accent.
- Status card: phase label, big Doto percent, 25-cell block progress bar
  (accent while running, ink when done), message, file list, warnings with a
  pixel "!" icon.
- Icons: hand-drawn pixel art on a 12x12 grid, `shape-rendering: crispEdges`.
  Generate new ones from ASCII art with `node tools/pixel-icon.mjs icon.txt`;
  never import an icon library.

## Rules
- Light and dark both designed, never auto-inverted. Theme follows the system
  unless the user picks one (stored as `pageArchiveTheme`).
- Popup width 372px; scrollbars hidden; content must fit without horizontal scroll.
- Respect `prefers-reduced-motion`.
- Visible text may contain typographic punctuation through escapes, but the
  source stays ASCII (see CLAUDE.md).
- Verify every UI change with `npm run popup-shot` and look at all 6 images.

## Store assets and landing page
Same tokens, fonts and rules. Screenshots 1280x800 show real captures (use
fixtures, never private chats). The promo tile is 440x280: logo, name, one
line of promise, nothing else.
