# Unreleased (after 2.4.0)

- Popup (owner: Saving looked overwhelming): Saving now shows one line, "Saves as Downloads/<name>", with a Change link; the file name, insert chips (title, site, date, time) and folder open only when asked.
- Owner recapture on redesigned Claude: Smart PNG (7 parts) and Smart PDF (37 pages, 42 bookmarks, text layer) complete from first to last message.

- Fix (owner, Claude redesign): the capture saved the Recents list instead of the chat. The expand pass clicked "Show more" under recent chats in the sidebar, a plain button that opens another page. Expand clicks now skip nav, aside, header, footer, menus and dialogs, and with a panel target stay inside the panel. If the page address changes mid-capture, the capture stops and nothing is saved (no stitch fallback). Fixture nav-showmore.html, E2E nav-showmore-skip and nav-showmore-stop.

- Fix (owner, Claude redesign 2026-10): capture failed with "the selected inner scroll area was replaced". Claude rebuilds its chat scroller when the window grows. Tallshot now adopts the one element that takes its place (same tag and classes, laid out, set to scroll) and warns that it did; anything less certain still fails. Fixture rebuilt-panel.html, E2E rebuilt-panel.
- Review: click a word to hide it everywhere on the page (names, IDs, anything no pattern knows). Words under the final boxes are also scrubbed from bookmark titles and the PDF title. E2E redact-review-word.
- Popup: the 2.4.0 Redact card is back (owner preferred it over the segmented row).

- Redact now works with Visible area only (owner request): the page text is read before the screenshot, scaled to screenshot pixels, and goes through the same review screen. Browser pages still refuse. E2E redact-visible.
- Fix (owner, Stripe test-card page): card numbers in tables were missed because each group of digits is its own element. Detection now reads each visual line across elements. NAME=value settings are no longer flagged as keys (GitHub README).
- Review boxes are listed in reading order (Tab goes top to bottom).

# 2.4.0 - Phase 4 Share-safe Redact

- New: redaction review screen. With Redact on, the capture opens in a Tallshot tab with every suggested box before anything is saved: click a box to keep that text visible, drag to cover anything else (names, photos, text in pictures), then Save or Cancel. The final boxes decide the burned pixels and which words leave the PDF text, links and bookmarks. E2E cases redact-review (toggle one box, draw one, check the PDF) and redact-review-cancel (nothing saved).
- Popup cleanup: Redact moved to the main screen ("Redact private info") with a word box that appears when it is on. More options is split into Page, Saving and Advanced, with one-line descriptions. "Auto-load more" is now "Load older messages".
- Removed dead code: the PDF cover page writer (no caller since the option was removed) and its tests.
- Fix: with Engine set to Scroll & stitch, Redact said to close DevTools; it now says to switch the engine. E2E redact-stitch-refused.
- Fix: assembly cleanup also drops redaction boxes for a cancelled capture.
- Version 2.4.0.

- Removed the PDF cover page option (owner: not useful or understandable). pdf.js keeps the cover writer for a later Proof Stamp; nothing calls it.
- Fix (owner, Testaroo page): an email broken across lines in a narrow footer was boxed on its first line only ("solutions.com" stayed visible). Later lines of a wrapped word are now shadow runs that Redact boxes and the PDF text skips. File names with digits (application-for-payment-002-summary.csv) were boxed as keys; random-token detection now needs upper case, lower case and digits (hex: 32+ chars).
- Fix: the Chrome PDF viewer refusal was wrapped in a second "Full render could not complete" message. Refusals that already say "Nothing was saved" are reported as they are.

- Fix (owner, PDF opened in Chrome): a full capture of Chrome's PDF viewer saved one screen, and Redact found nothing because the viewer has no page text. Such tabs are now refused with an explanation (never a silent one-screen capture). Fixture pdf-viewer-shell.html, E2E pdf-viewer-refused.
- Redact (owner, ChatGPT document preview): pages drawn into a canvas, embed or frame cannot be read, so Redact now warns how many such areas it could not check instead of implying the capture is clean. Fixture drawn-preview.html, E2E redact-drawn-warn.

- Removed JPEG output (owner: lossy text blurs when zoomed). A saved JPEG setting falls back to PNG; PDF pages still embed JPEG internally. E2E case jpeg-falls-back.
- Fix (owner, Amizone profile page): Redact missed phones, emails and addresses because they were form field values, which have no text node. Visible input, textarea and select values are now collected (one run per field, boxed whole). They also join the PDF text layer. Fixture and E2E cases extended.

- New: Share-safe Redact (More options, Full edition). Detects emails, phone numbers, card numbers (Luhn), IBANs (mod 97), API keys and tokens (known prefixes plus an entropy check), IPv4/IPv6 addresses, URLs with token parameters, and a user word list. Matching words are painted black in the image before encoding and removed from the PDF text layer; links under a box or carrying a secret, bookmark titles, the cover title/URL, the PDF title and the file name are scrubbed too. Word positions come from the page (PAC_COLLECT_TEXT wordEdges), so boxes cover exactly the words. A redacted capture never falls back to scroll-and-stitch or a visible-area shot (they cannot read text); it stops with "Nothing was saved". Pure module redact.js, fixture redact-secrets.html, E2E cases redact-png (no secret pixel left) and redact-pdf (no seeded string in the PDF bytes or text layer). Not yet built: the preview screen (toggle boxes, drag to add) and on-device name detection.

# Phase 3 Living PDF (hardening)

- Fix (owner, Claude and ChatGPT, Target Document, PDF): one screen was saved, with the message box floating mid-page. When the document does not scroll and a panel hides more than 200 px, Document now captures the panel (as Smart does) and says so in a warning. E2E cases doc-panel-hidden, doc-shell-hint (updated) and doc-switch-vh-shell (new).
- Popup (owner: "how will other users understand this?"): the file-name tokens are now buttons that insert at the cursor, the help text says what braces do, the folder placeholder reads "e.g. Tallshot/{site}" so it is not mistaken for a value, and the preview uses the current tab's title and site.
- Fix (owner, Claude incognito, Smart PDF): Full render failed ("panel could not be fully exposed, overflow 2159px") and fell back to scroll-and-stitch, without a text layer and with a faded user bubble. Claude's incognito shell sizes the app with an inline height from a script variable (--app-visual-viewport-height) that is not updated when the viewport grows. Script-set inline heights on the panel's ancestors now follow the viewport during the render (never taller than it), and are restored. Fixture script-vh-shell.html, E2E cases script-vh-shell and script-vh-shell-png (both fall back to stitch without the fix).
- Fix (regression from the previous commit, owner's single-PNG Claude capture): Claude ends its message list in three empty boxes, so the "at most two spacers" rule hid none and the window-sized spacer grew to Max height (199,279 px trimmed, messages lost). A run is now hidden when any box in it is script-sized (min-height or flex-grow), as Claude's is; plain fixed-height runs (unmounted virtual rows) stay.
- Fix (owner, long Claude thread): "Show more" in long user messages was not clicked. Claude keeps only about 5 turns in the DOM, so the expand pass during preparation saw only those. The render settle step now clicks newly mounted expand buttons again (same safety rules, cap raised from 40 to 80 per capture) and the panel keeps growing; panel growth allows 20 rounds instead of 10. New warning counts the late clicks. Fixture virtual-showmore.html, E2E case virtual-showmore.
- Fix: the end-spacer rule hid every empty box at the end of a panel. A virtualised list's unmounted rows are such boxes, so they were dropped and the capture ended early. Only one or two trailing empty boxes count as spacers now.
- Fix (owner, Claude incognito, Target Document, PDF): one screen was saved with no warning. The shell-hint warning relied on visible text, and text clipped inside the panel does not count. Document captures now report how much a scroll panel hides and point to Smart or Panel. E2E case doc-panel-hidden. The Smart PDF on the same chat is not yet explained [VERIFY ON FIRST RUN].

- Owner recapture (Smart, PNG and PDF): message box gone, all parts complete, 30-page PDF with 42 bookmarks. Panel captures now also trim more than 200 px of empty space after the last content (the room Claude keeps for its message box, about 280 px), keeping 64 px; only trims over 400 px are reported. Hidden-element examples drop icon-font (Private Use Area) characters, which showed as boxes.

- Correction: the 12-blank-page PDF was a Smart capture (it had one bookmark per prompt, which only the chat preset makes), so the window-sized spacer chased the panel growth, not the document growth. New backstop for panels: when the captured panel ends in more than a viewport of empty space after its last text or media, the capture ends 64 px below the content, with a warning (G.endSpacerCut). Fixture end-spacer.html?paint=1 (a painted spacer the spacer rules cannot hide), E2E case panel-paint-spacer.
- Fix (owner recapture, Target Document, PDF): the capture was cut to one screen. The end-spacer guard measured content with scroll panels' clipping, so content growth would expose looked absent. It now measures the extent: text clipped only by overflow hidden/clip boxes (not scrollers, not <body>).
- New warning in Document mode when the document is far shorter than its content (an app shell with a scroll panel): it names the content height and points to Smart or Panel. E2E case doc-shell-hint.
- Fix: Claude's message box ("Reply" and the model bar) stayed at the end of Smart captures. Floating-element hiding stopped at 60 elements in DOM order, and both owner captures reported exactly 60. The cap is now 400 with a warning if reached, boxes holding more than 300 characters of text are never hidden unless they contain an input, and the warning names up to 4 hidden elements.
- Wording: messages now use the popup's labels (Document, Panel, Target) instead of the old "Entire document", "Main scrollable panel" and "Capture target".

- Fix (owner capture, Claude thread, Target Document, PDF): 19 PDF pages, 12 of them blank, and a false "limited by Max height" warning. The document itself scrolled and ended in a spacer sized to the window, so each growth round added the whole thread again until Max height. Document growth now compares the document height with the bottom of the last visible text or image; when that blank tail grows with the viewport, paintless end spacers are hidden and the capture ends 64 px below the content, with a warning. A tall static section without text is not cut. Fixture end-spacer.html?doc=1, E2E cases doc-end-spacer and doc-end-spacer-pdf.
- Fix (owner capture, same thread, PNG): about 6,100 px of messages were blank in part 1, ending exactly at the first render chunk edge. Chrome returned the first 8192 px screenshot before it had painted all of it. Every render screenshot is now paint-checked against the text positions in the DOM; a chunk with flat rows where text should be is retaken after a wait (up to 4 tries), and if it never paints the capture falls back to scroll-and-stitch with a warning instead of exporting a broken image.
- Accuracy: text hidden by an overflow-clipped ancestor (a collapsed "Show more" message with Expand off) no longer enters the PDF text layer, links or the paint check. It never paints, so it would have been searchable text and clickable areas on top of other content. Fixture clipped-text.html, E2E case clipped-text (fails without the fix: needless stitch fallback).
- Cover page: the SHA-256 list continues on further cover pages instead of stopping at 40 pages.
- PDF quality: pages now have an A4 proportion of the capture width instead of 14000 px strips, and each page break moves up to the nearest gap between text lines, so no line is cut in half. Readable in viewers and printable. PNG and JPEG output is unchanged.

- New: clickable links in PDFs. Web and mail links become PDF link annotations over their on-screen rectangles (multi-line links get one area per line); same-page #links jump to their target page and position. javascript:, data: and other schemes are dropped. Full render only, like the text layer.
- New: PDF bookmarks. One per h1-h3 heading, nested by level; on ChatGPT, Claude, Gemini and Copilot, one per user prompt instead (numbered, prompt text as title). Titles keep full Unicode.
- New option "PDF cover page" (More options, off by default): a first page with title, URL, capture time (local and UTC) and the SHA-256 of each page image as embedded in the PDF. Hashing is local (crypto.subtle). Cover text uses standard PDF fonts, so non-ASCII characters show as "?" there.
- Tests: tests/living-pdf.test.cjs (link coordinates, unsafe links, outline nesting and counts, cover, xref validity, partAt); fixture living-article.html and E2E case living-pdf; claude-preset now checks 20 prompt bookmarks.

# Unreleased - Phase 2 store preparation (started early)

- Renamed the product to Tallshot ("Page Archive" sat next to a featured "Archive Page" in the store). Full edition: "Tallshot Full"; Lite: "Tallshot". Popup header "Tall" + accent "shot", stitcher page, PDF producer, default folder hint, store zips (`tallshot-<edition>-<version>.zip`) and docs. Internal ids (storage keys, data attributes, test hook) are unchanged so saved settings survive.

- New: `PRIVACY.md` (draft): no network requests, exactly what is stored locally, permissions, how to delete.
- New: `docs/store/permissions.md` (single purpose, permission justifications, data-usage answers) and `docs/store/listing.md` (Lite and Full listing copy, screenshot list). Drafts.
- New: `npm run package` builds and zips each edition (`dist/page-archive-<edition>-<version>.zip`) with a dependency-free ZIP writer; the testing build stamp is left out of store zips.
- New: one-time review prompt. After the 3rd successful capture the result card shows a short note with "Leave a review" and "No thanks"; it is marked as shown the first time it appears and never repeats. The link is built from the extension's own id (Chrome Web Store, or Edge Add-ons in Edge) and only opens a tab on click. Stores a local success counter.

# Unreleased - Phase 1 fixes

- Fix: Notion pages ended in about 20,000px of blank space (2 of 6 PNG parts empty). Notion pads the page column with an inline `padding-bottom: 30vh`, which grew with the Full render viewport. Viewport-unit bottom padding on the panel column is now frozen at its on-screen value, and the end-spacer walk skips zero-height boxes. Fixture `end-spacer.html?pad=1`, E2E case `end-vh-padding`.
- Fix: Colab captures hid the notebook's own run buttons, execution markers and show/hide toggles ("Hid 60 floating elements"). Colab keeps them in shadow DOM, and plain contains() reported them as outside the panel. The hide rules now use a shadow-aware composedContains(). Fixture `shadow-cells.html`, E2E case `shadow-cells` with a new "colour must be present" pixel check.
- Fix (popup): a warning with a long unbroken token (an image URL from YouTube's image audit) widened the popup by 179px and clipped its border. Warning text now wraps anywhere; popup-shot covers it.
- Wording: the hide-floating warning now says "over the captured panel (message boxes, toolbars, floating buttons)" instead of "conversation panel", which was wrong on notebooks.

- Fix: Full render gave up on DeepSeek ("panel could not be fully exposed ... clipped 5103px") although nothing was clipped. DeepSeek's app is an absolutely positioned layer inside a 0px tall overflow:hidden body; the clip check now follows CSS containing blocks (absolute boxes escape static ancestors, fixed boxes escape all). Fixture `abs-shell.html`, E2E case `abs-shell`.

- Fix (Lite and the stitch fallback): scroll-and-stitch kept chat composers, floating buttons and bottom bars on the first screen, drawn over content (seen on DeepSeek). It now runs the same hide rules as Full render on every tile. New E2E cases `chatgpt-composer-stitch`, `end-fab-stitch` run on both editions.
- Fix: fixed badges floating up to 32 px above the bottom edge (reCAPTCHA's badge on Reddit, toasts) are hidden in document captures. Fixture `floating-badge.html`.
- Fix: extension store pages (Chrome Web Store, Edge Add-ons) are treated like chrome:// pages: full-page capture is off up front with a clear hint, instead of a failed attempt and a confusing "Full render was unavailable" warning. The popup now uses the shared `url-policy.js`. Removed a doubled period in the inspection error.

- Fix: Claude captures with an artifact open in split view ended in about 13,000 px of blank background. Claude ends the message list with an empty flex-grow spacer sized by script to "viewport minus the last turn"; Full render grows the viewport, so the spacer grew with it. Panel pinning now hides paintless in-flow boxes after the last content (display:none, restored afterwards). Fixture `end-spacer.html`, E2E case `end-spacer` with a new "trailing blank rows" pixel check.
- Fix: Full render failed on Gemini ("The panel could not be fully exposed") and fell back to scroll-and-stitch. Gemini gives the last turn an inline min-height of "panel height minus 112px", so the panel always overflowed by the same amount however far the viewport grew. A script-set inline min-height on the last content box is now overridden by an !important rule in the temporary stylesheet (marker attribute removed on restore), applied before the first viewport growth. Fixture `end-spacer.html?last=1`, E2E case `end-min-height`; the harness now also serves gemini.google.com from fixtures.
- Fix: panel captures now also hide button-sized (at most 120 px) absolute overlays outside the panel that overlap it, such as Gemini's "Scroll to bottom" button, which hangs from the input area over the panel's bottom edge.

- Fix: ChatGPT preset updated for the 2026-10 DOM (`data-turn-key`, `data-conversation-role`, `data-user-message-bubble`; old markers kept as fallbacks). Preset markers now prefer a laid-out match, because ChatGPT keeps hidden 0x0 copies of other threads first in the DOM.
- Fix: panel captures no longer include a composer that lives inside the scroll panel: bar-sized (at most 320 px) absolute elements on the panel's bottom edge, and bottom-anchored sticky bars in its last 400 px (ChatGPT's disclaimer line ends above the space reserved for the composer). Top-pinned headers are kept. Fixture `chatgpt-thread.html`, E2E case `chatgpt-composer` with a new "colour must be absent" pixel check; the harness serves HSTS-preloaded chatgpt.com through request interception.
- Fix: `npm run check` no longer scans `.local/` (Playwright browser and Chrome test profiles).
- New: build stamp. `npm run build` writes `version_name` "2.3.0 build MMDD-HHMM <commit>" into the built manifests (source manifest untouched); the popup footer shows it, so a tester can confirm the extension really reloaded.
- Fix (popup): long file names (e.g. "..._part-01-of-03.png") made the popup 48px wider than its 372px design, so Chrome widened the window and clipped the result card's border and shadow. File names now truncate in the middle and keep the part number and extension visible. The warnings list no longer has a height cap that hid the last warning mid-sentence. `npm run popup-shot` adds a "busy" state and reports horizontal overflow.
- Fix: blank 1-2 px rows between Full render sections at fractional display scaling (Windows 120%/125%). Chunk heights are now whole device pixels, the stitcher takes the scale from the longer bitmap side, and draw edges snap to whole canvas pixels. Coverage validation unchanged. Fixture `dpr-seam.html`, E2E cases `dpr-seam` and `dpr-seam-panel` (DPR 1.2) with a new pixel check on a solid margin.

# Unreleased - Claude Code handoff (tooling only, no behaviour change)

- Source converted to pure ASCII (Unicode via \u escapes and HTML entities); `scripts/check-ascii.mjs` enforces it in `npm run check`.
- Windows-safe E2E harness `tests/e2e/run.mjs` with `tests/e2e/suite.json`, edition switch, pass/fail exit code, all profiles and downloads inside `.e2e/`.
- `tools/popup-shot.mjs` (popup screenshots, light and dark) and `tools/pixel-icon.mjs` (ASCII art to SVG icon).
- New project docs: CLAUDE.md, PROGRESS.md, ROADMAP.md, ARCHITECTURE.md, PRODUCT.md, DESIGN.md, TESTING.md, SETUP_CLAUDE_CODE.md. v1 documents moved to `docs/archive-v1/`.
- Playwright pinned as the only dev dependency.

# Page Archive Capture v2.3.0

## 2.3.0 - Editions, chat presets, searchable PDF, auto-expand, file naming

- **Two editions** (`node tools/build-editions.mjs`): **Full** (Full render engine, `debugger` permission) and **Lite** (no `debugger` permission: no install warning, no debugging bar; scroll-and-stitch only; Engine row hidden; "LITE" badge). Chrome does not allow `debugger` as an optional permission, so a separate build is the only way to offer both.
- **Site presets** for ChatGPT, Claude, Gemini, Perplexity, Copilot, DeepSeek, Google Colab and Jupyter: locate a message/cell by stable markers (data attributes, custom tags), then walk up to the element that really scrolls. Falls back to Smart heuristics. Status shows e.g. "Full render - Claude".
- **Searchable PDF**: Full render PDFs carry an invisible Unicode text layer (Type0/Identity-H + ToUnicode, render mode 3), horizontally scaled to match on-screen text, so text can be searched, selected and copied, including Hindi, CJK and accented text. Stitch PDFs stay image-only (noted in warnings).
- **Expand collapsed text** (default on): opens `<details>` (closed again afterwards), lifts CSS line clamps (restored), and clicks clearly labelled "show more / view rest / read more" controls, max 40 clicks over 3 rounds. Never clicks real links, form submits or labels mentioning delete, remove, buy, subscribe, log out, report and similar.
- **File name template + folder**: tokens `{title}` `{site}` `{date}` `{time}` `{datetime}`; optional subfolder inside Downloads (sanitized, no `..`), with a live preview in the popup.
- New fixtures `chat-preset.html` (served as claude.ai via host mapping) and `expand-content.html` (includes traps that must not be clicked). 96 tests.

# Page Archive Capture v2.2.0

## 2.2.0 - Window-anchored backgrounds, new mark, UI polish

- Fix: backgrounds laid out against the window (`background-attachment: fixed`, or full-window fixed layers) were re-scaled or tiled down the grown page (reported on an itch.io page). They are now frozen at the exact pixel size and position they had in the real window, drawn once, with the background colour filling the rest. New fixture `fixed-art-backdrop.html`.
- New logo: stacked pages with an orange front sheet and download arrow; new 16/32/48/128 icons.
- Toggle switches use integer geometry (2px border, 12px knob, 2px gutters); popup scrollbars hidden.
- Verified: Full render captures continue when the user switches to another tab (classic stitch still requires the tab to stay active).

# Page Archive Capture v2.1.0

## 2.1.0 - Lazy images, fixed backdrops, new logo

- **Document "grow" render.** Documents are now captured by growing the emulated viewport to the full page height, so IntersectionObserver lazy images, scroll-reveal animations and virtualized feeds all load and stay rendered, and full-screen `position: fixed` backdrops (site themes with light text on a dark backdrop) cover the whole page. Viewport-sized elements (100vh heroes, height:100% chains) are found by nudging the viewport 240 px and pinned to their original height first. `background-attachment: fixed` is switched to `scroll` during capture. The v2.0 captureBeyondViewport path remains as an automatic fallback.
- `content-visibility: auto` sections are forced visible during capture (Chrome skips painting them off-screen).
- Grown documents get a longer image settle budget (at least 3 s).
- New fixture `reveal-lazy.html` reproducing both reported failures; 2 new tests (90 total).
- New logo: page inside orange viewfinder corners, drawn on a 16 px pixel grid; new 16/32/48/128 toolbar icons.

# Page Archive Capture v2.0.0

## 2.0.0 - Full render engine, JPEG/PDF output, new UI

- **New default engine: Full render** (`chrome.debugger`, `cdp.js`). Documents are captured with `Page.captureScreenshot` + `captureBeyondViewport` in 8192-device-px chunks: fixed headers render once, `100vh` sections keep their size, cross-origin iframes are painted, and there is no 2-per-second screenshot quota.
- **App panels** (chat apps, notebooks, dashboards) are exposed by growing the *emulated viewport* until the panel stops overflowing, then the panel rectangle is screenshotted. Virtualized lists render every row because every row is on screen. Panels that do not grow with the viewport are pinned to their content height. If a panel still cannot be fully exposed, capture falls back automatically.
- **Fallback chain:** Full render -> scroll-and-stitch using debugger screenshots (no throttle) -> classic `captureVisibleTab` stitching. A failed full-page capture still never becomes a viewport screenshot.
- **Hide floating bars** (default on): bottom-pinned bars on documents and fixed overlays covering a panel (composers, cookie banners, chat bubbles) are hidden during render and restored afterwards.
- `<body>`-as-scroller pages (html locked, body scrolls) are now detected.
- **Output formats:** PNG, JPEG (q 0.92) and single-file PDF via a dependency-free writer (`pdf.js`, one page per image part).
- Downloads retry with an ASCII-safe filename when Chrome rejects non-ASCII punctuation in the page title.
- Restoring styles no longer leaves an empty `style=""` attribute behind.
- **New popup UI**: neo-brutalist app dialect (paper/char palette, single orange accent, hard borders, solid offset shadows), bundled Outfit + Doto fonts, pixel icons, light/dark with toggle, format/target segmented controls, file list and "Show in folder".
- New fixtures: `body-scroller.html`, `virtual-chat.html`, `viewport-hero.html`. New tests: `render-engine.test.cjs`, `pdf.test.cjs` (88 total).
- **Real-browser E2E harness** `tests/e2e/run.mjs` (Playwright + Chromium) loads the unpacked extension and runs start -> capture -> stitch -> download -> restore on every fixture.
- Permission added: `debugger` (required by Chrome; it cannot be optional). See docs/SECURITY_AND_PRIVACY.md.

# Page Archive Capture v1.2.6

## 1.2.6 - Sticky composer overlays and severely clipped panels

- Hide fixed/sticky elements that overlap the selected inner panel's capture crop even when the overlay lives outside the scroller subtree. Preserve the selected scroll container and its ancestors; restore original visibility after capture.
- Move pinned-overlay suppression until after each later tile is scrolled and settled, so the overlap test uses the current crop.
- Add `isHeavilyClippedPanel()` and make Smart reject a nested panel when its origin is far outside the viewport and less than 45% of its area is visible. Use the document if it scrolls; otherwise report an actionable message instead of starting tile zero at a large offset. Explicit Main scrollable panel remains deliberate and reports the clipping issue clearly.
- Add the fixed-composer app-scroll fixture, the offscreen-panel fixture, and regression checks.
- Validation: 72 Node regression tests pass. A Chromium DOM/content-script harness confirmed the fixed composer is visible on tile 1, hidden on tile 2, and restored by `PAC_RESTORE`. This does not substitute for full Chrome screenshot/download testing.

## Previous release history (v1.2.5 and earlier)

- Handles small, bounded scroll-position drift on notebook-style pages such as Google Colab: uses measured tile coordinates, emits a warning, and relies on final coverage validation instead of aborting immediately at a 2px mismatch.
- When the last inner-panel tile reaches the live bottom and the panel shrinks by only a bounded amount, adjusts output height to the final measured scroll extent; real coverage gaps still block export.
- Added safe tile-drift tolerance helper and regression tests.

# Changelog

## 1.2.4 - Best-effort image completeness audit

- Added per-capture tracking of unique visible HTML `img` elements, including whether each source was incomplete/undecodable during capture.
- Added sampled visible-viewport discovery of CSS `background-image`, border/mask/list images, generated pseudo-element images, SVG `image` sources, video posters, and image inputs.
- Added bounded image resource probes for discovered CSS/embedded URLs, with separate confirmed-failure and timeout/unverified results; logs show host/path labels without URL query strings.
- Added final popup status summary reporting the number of HTML images observed and CSS/embedded URLs checked, plus a warning for failed sources.
- Added `tests/site-fixture/image-audit.html` with valid data-image cases and intentionally broken HTML/CSS/pseudo/SVG/poster assets.
- Limits are explicit: the visual audit samples visible element stacks and caps work per tile/capture; canvas pixels, video frames, closed shadow roots, cross-origin iframe internals and CSS `image-set()` variants are not fully verified.

## 1.2.3 - Anchor baseline captured before preparation scrolling

- Fixes a reproduced inner-panel failure where image preparation scrolled the panel far enough to trigger a one-time parent shift (e.g. 152 px) before the anchor was recorded.
- Records the normalized panel anchor before lazy-image/infinite-feed preparation, then re-anchors after preparation before measuring the page and planning tiles.
- Adds regression coverage asserting the anchor is recorded before `preloadPage()` and that stabilization runs after preload. Updates the fixture to model a reversible app-shell collapse and restoration.

## 1.2.2 - Inner-panel position stabilization

- Anchor the selected inner scroller to its settled viewport rectangle after image preparation.
- Re-lock the outer document to its original scroll position while capturing an inner panel; this counters scroll anchoring and app-shell movement caused by nested scroll interactions.
- Re-measure the selected panel after scrolling and image/font settling. When the panel moves, compensate using CSS individual translate before returning tile coordinates to the stitching pipeline.
- Preserve one original inline-style snapshot for each changed property and restore the original panel/document scroll offsets at the end.
- Fail with a specific error if the panel is replaced, changes dimensions materially, or cannot be stabilized; coverage validation remains strict rather than accepting a potentially gapped image.
- Add a moving-panel fixture that deliberately shifts an app shell by 152 CSS pixels, plus regression tests for anchor correction.
- This release has not been verified by a complete Chrome extension screenshot/download run in the build environment. An isolated Chromium DOM harness did verify that the moved panel is re-anchored and the tile coordinate matches the requested offset.

## 1.2.1 - Conservative Smart target and improved diagnostics

- Changed Smart target selection to favor the document on ordinary tall websites, even if a large nested overflow element exists. This prevents app widgets and swap/modal panels from being mistaken for the entire page; known conversation hosts remain an exception.
- Added an early inner-panel coordinate-drift guard so a clipped/repositioned target reports an actionable error before the stitcher reports a difficult-to-diagnose page coverage gap.
- Raised the default screenshot wait to 3.5 seconds and migrated the previous common defaults; the user can still choose waits up to 5 seconds.
- Image warnings now include up to two source host/path examples and clarify that unavailable source pixels cannot be reconstructed.
- Increased the inter-capture delay to 600 ms to stay conservatively below Chrome's documented two `captureVisibleTab` calls-per-second ceiling.
- Added regression tests for tall-root false positives, recognized chat scrollers, manual panel selection, coordinate drift, and image diagnostics.
- Chrome-internal pages: use **Visible area PNG** for the viewport. Full-page scrolling/injection remains restricted by Chrome; this is not fixed by adding more scroll heuristics.

## 1.1.3 - Fractional page-edge coverage fix

- Corrected false `coverage-gap` errors caused by subpixel rounding at the final page edge. Screenshot scroll coordinates and the measured page extent can be represented as fractional CSS pixels; the validator now snaps only a page boundary that is within its existing 0.5 CSS-pixel tolerance.
- Retained strict failure for gaps larger than the boundary tolerance; a regression test checks a 0.25 CSS-pixel bottom remainder is accepted while a 2 CSS-pixel gap is still rejected.
- Added a regression case matching the reported 1601 x 5480 CSS-pixel, nine-tile page.
- This patch addresses the observed validator false-positive. It does not constitute a real-Chrome end-to-end test; repeat the local fixture test to verify the complete capture/download pipeline.

## 1.1.2 - Scroll-extent correction and explicit capture modes

- Measure document dimensions from `document.scrollingElement` instead of combining `html` and `body` dimensions, avoiding unreachable bottom offsets and false coverage-gap failures on layouts where those values diverge.
- Use the scrolling element's actual `scrollTop`/`scrollLeft` as root-tile coordinates.
- Reject Chrome/Edge internal pages before opening the image-assembly tab; never silently convert a full-page capture into a viewport image when full-page inspection fails.
- Make visible-area capture an explicit mode that does not need page-script injection.
- Include page dimensions and final tile positions in coverage-gap errors for easier diagnosis.
- Add regression tests for root-scroll planning and the capture-entry URL/mode guards.

## 1.1.1 - Diagnostics and restricted-page handling

- Persist the last capture status locally so errors remain visible when the popup is reopened.
- Log capture failures in the extension service-worker console for easier diagnosis.
- Added a URL-policy helper and unit tests for Chrome/Edge internal pages; the next release wires that guard into the capture entry point.
- Preserve previous v1.1.0 tile-validation, message-routing, cancellation, and restoration hardening.

# Changelog

## 1.1.0 - Capture integrity hardening

- Fixed message-handler collisions by separating page commands from assembly-page commands.
- Bound assembly-page responses to the capture ID in that page's URL.
- Added complete tile-index and rectangle-coverage validation before any PNG export.
- Changed tile decode/crop errors from silent skips to explicit capture failures.
- Corrected source clipping calculations to preserve destination proportions at scaled edges.
- Ensured canvas and bitmap resources are released on success and error paths.
- Added active-tab checks immediately before screenshot capture to reduce accidental capture of another tab.
- Added cancellation checkpoints during lazy-image preparation and capture waits.
- Improved page scroll/style restoration, including the case where a site replaces an inner scroll element.
- Added protocol and tile-integrity regression tests.

## Validation boundary

The code and unit tests can be checked locally without browser installation, but this release has not passed an end-to-end Chrome/Edge run in the build environment because that environment prohibits loading unpacked extensions. Use `tests/MANUAL_TEST.md` in Chrome to complete integration validation.


## 1.2.0

- Raised the configurable capture-height ceiling to 300,000 CSS px and the hard screenshot tile limit to 800, with a 200,000 px default and migration from old defaults.
- Added Smart / Entire document / Main scrollable panel targets and semantic main/thread/message detection for common chat-style hosts.
- Fixed bounded auto-load stopping too early when virtualized app DOMs changed without increasing scrollHeight.
- Added clipped-panel normalization with restoration, open-shadow-root image tracking, two-pass checks for late-added images, longer image/decode waits, and pending-font settling.
- Restricted browser-internal pages now show guidance in the popup and disable Full page PNG there; Visible area PNG remains available through the supported captureVisibleTab API.
- Raised the page-edge rounding tolerance to 1.25 CSS pixels for independent integer rounding, while retaining hard failure for materially larger gaps.
- Expanded automated coverage for large multi-part exports, internal-page UI behavior, panel detection signals and image readiness.
