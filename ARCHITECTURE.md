# ARCHITECTURE.md - how Tallshot works (v2.3)

Read this before changing capture code. It describes the current design and
the reasons behind each choice, so that fixes do not undo hard-won behaviour.

## 1. Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest. Permissions: activeTab, scripting, downloads, storage, debugger (Full only). |
| `background.js` | Service worker. Job lifecycle, engine choice and fallback, progress, cancel, file naming. Exposes `self.__pageArchiveTest` for the E2E harness. |
| `cdp.js` | Thin `chrome.debugger` wrapper (`Session`): attach, send with timeout, viewport override, screenshot, detach. Lite ships a stub. |
| `content.js` | Injected on demand. Target selection (site presets, then heuristics), page preparation, expand, lazy-load pass, render helpers, text-run collection, restore. |
| `geometry.js` | Pure math shared with tests: tile plans, coverage validation, render chunks, panel growth, name templates, folder sanitising. |
| `protocol.js` | Allow-lists of page commands and stitcher commands. Add every new message type here. |
| `stitcher.html/js` | Hidden extension tab. Stores tiles in IndexedDB, validates coverage, composes parts, encodes PNG/JPEG/PDF, downloads. |
| `pdf.js` | Dependency-free PDF writer: one JPEG per page plus an optional invisible Unicode text layer. |
| `popup.*` | UI. See `DESIGN.md`. |
| `tools/build-editions.mjs` | Builds `dist/full` and `dist/lite` from the one source tree. |

## 2. Capture flow

1. Popup sends `PAC_START` with mode and settings. Visible mode uses
   `captureVisibleTab` and never touches the page.
2. Worker opens the stitcher tab, then (Full edition, engine `auto`) attaches the
   debugger. Attach failure (DevTools open, another debugger) -> stitch with a warning.
3. Content script `PAC_PREPARE`: prepare styles (no transitions, no scrollbars,
   `content-visibility: visible`), auto-expand collapsed content, pick the
   target, optional lazy-load scroll pass.
4. Engine runs (section 3), tiles go to the stitcher with geometry.
5. Worker detaches the debugger and restores the page, then asks the stitcher to
   compose. The stitcher refuses if tiles are missing or coverage has a gap.

Fallback chain: Full render (document grow) -> Full render (captureBeyondViewport)
-> scroll-and-stitch with debugger screenshots -> scroll-and-stitch with
`captureVisibleTab`. Never -> viewport screenshot.

## 3. Engines

### 3a. Full render, document target ("grow")
- Snapshot heights of every non-fixed element (>= 40px).
- Nudge the emulated viewport +240px; elements whose height changed are
  viewport-sized (100vh heroes, height:100% chains) -> pin them to the original
  height. Measure everything first, then pin.
- Freeze window-anchored backgrounds (`background-attachment: fixed`, full-window
  fixed layers): compute the exact size and position they had in the real window
  (cover/contain resolved against the image's natural size) and set them to
  scroll, no-repeat. Otherwise art gets scaled or tiled down the page.
- Grow the viewport to the document height (loop up to 6 rounds while it grows,
  capped at Max height). Now every element is "on screen": IntersectionObserver
  lazy images, reveal animations and virtualised feeds render.
- End spacers: each round compares the document height with the bottom of the
  last visible text or media (`PAC_INK_BANDS`). If that blank tail grows by at
  least half of the viewport growth (a window-sized spacer, Claude 2026-10),
  `PAC_RENDER_TRIM_END` hides paintless end spacers and the capture ends 64 px
  below the content, with a warning.
- Settle (images and fonts, at least 3 s), hide bottom-anchored floating bars,
  screenshot in chunks of 8192 device px.
- PAC_INK_BANDS returns bands and bottom (clipped by every overflow ancestor,
  i.e. what is painted now) and extent (clipped only by overflow hidden/clip,
  not by scrollers or <body>, i.e. what growth can expose). Growth decisions
  use extent; the paint check uses bands. Document mode warns when extent is
  far below the captured height (content lives in a panel).
- Paint check (all render chunks): Chrome can return a tall chunk before it
  has rastered all of it. Each screenshot is reduced to per-row "flat" flags and
  checked against the DOM text bands (`G.unpaintedInk`); flat text bands -> wait
  and retake (4 tries), then throw, which falls back to stitch.
- Failure -> captureBeyondViewport at the original viewport size.

### 3b. Full render, panel target (chat apps, notebooks)
- Grow the viewport by the panel's overflow plus any part below the window.
- If the panel does not grow with the viewport, pin it to its content height
  (measured with the box collapsed to 0, because scrollHeight never reports
  less than the box).
- Verify it is fully exposed (`G.panelFullyExposed`), else fall back to stitch.
- Backstop: `G.endSpacerCut` ends the capture 64 px below the content extent
  when more than 200 px of empty space follows it (warning over 400 px).
- Hide fixed overlays covering the panel (composers), screenshot the panel rect.

### 3c. Scroll-and-stitch
The original v1 engine. Scrolls the target in overlapping tiles, hides pinned
elements after tile 1, stabilises moving panels, validates drift. With the
debugger attached it uses CDP screenshots (no throttle, tab can be in the
background); without it, `captureVisibleTab` (2 per second, tab must stay active).

## 4. Target selection
1. Site presets (`SITE_PRESETS` in content.js): host match, find a message or
   cell by stable markers (data attributes, custom tags), walk up to the nearest
   element that actually scrolls. Never use hashed class names.
2. Heuristics (`getInnerScroller` + `G.shouldUseInnerScroller`): prefer the
   document on normal pages; pick a panel when the root barely scrolls. A
   scrolling `<body>` counts as a panel.
3. Target `document` skips both; `panel` forces the best panel.

## 5. Output
- Stitcher splits output into parts of at most 14000 px per side and 24 MP.
- PNG, JPEG (quality 0.92) or one PDF. PDF pages use `G.pdfPageParts`: A4
  proportion of the capture width, breaks moved up (at most 30%) to a gap
  between text lines, slivers under 15% folded into the last page. Line
  positions come from the text layer, so scroll-and-stitch PDFs (and Lite)
  break at fixed heights and can cut a line.
- PDF text layer (Full render only): `PAC_COLLECT_TEXT` returns word-line runs
  `[x, y, w, h, fontSize, text]`; the worker offsets them into capture
  coordinates and sends `PAC_STORE_TEXT`; `pdf.js` writes invisible text
  (render mode 3), a Type0 Identity-H font and a ToUnicode map, scaling each run
  horizontally to its on-screen width. Emoji become "?".
- Living PDF (Full render only, same pass as the text layer): `PAC_COLLECT_TEXT`
  also returns link rects `[x, y, w, h, href]` (http, https, mailto) or
  `[x, y, w, h, '', destX, destY]` for same-page `#fragment` links, and outline
  marks `[x, y, level, title]`: h1-h3, or one per user prompt when a chat preset
  defines `turns`. The stitcher maps them onto parts with `G.partAt`; `pdf.js`
  writes Link annotations (URI or GoTo), a nested outline (UTF-16 titles) and,
  with the PDF cover page option, a first page with title, URL, capture time and
  the SHA-256 of each page's embedded JPEG (`crypto.subtle`, local). Links whose
  target lies outside the capture are dropped. Stitch-engine PDFs carry none of
  this, as before.
- File name: `G.applyNameTemplate` tokens {title} {site} {date} {time}
  {datetime}; optional Downloads subfolder through `G.safeFolder`; ASCII
  fallback if Chrome rejects the name.

## 6. Auto-expand rules
Opens `<details>` (closed again on restore), lifts CSS line clamps (restored),
clicks at most 40 controls in 3 rounds whose text matches `EXPAND_TEXT` and
which pass `safeToClick`: no real links, no form submits, nothing matching
`NEVER_CLICK` (delete, buy, subscribe, report, log out, ...). Clicked controls
cannot be un-clicked; the user is told.

## 7. Known limits
- DevTools open on the tab blocks the debugger -> stitch fallback.
- Pages that resize content on every window resize cannot converge in grow mode
  (`notebook-reflow.html` reproduces this) -> stitch fallback, by design.
- Background tabs render slower; headed Chrome may throttle them more than tests show.
- Closed shadow roots and cross-origin iframe DOM cannot be audited or text-mapped.
- Chrome on-device AI needs > 4 GB VRAM; the owner's GTX 1650 does not qualify,
  so AI features cannot be tested on this machine.
