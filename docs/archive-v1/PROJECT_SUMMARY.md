# Project Summary — Page Archive Capture

**Current source version:** 1.2.6  
**Project type:** Chrome/Edge Manifest V3 browser extension  
**Primary output:** PNG image(s) of a webpage or scrollable content panel  
**Runtime dependencies:** None  
**Primary goal:** reliable, local-first archiving of long, visually rendered web content, including pages with lazy-loaded images and app-style scrolling regions.

## What it does

Page Archive Capture captures a page by scrolling it through a sequence of overlapping viewport tiles, taking browser screenshots, and stitching those tiles into one or more numbered PNG files. If the page exceeds canvas/browser output limits, it splits the result into multiple PNG parts rather than creating one excessively large canvas.

The user can request:

- **Full page PNG** — inspect and capture a regular document or selected scrollable panel.
- **Visible area PNG** — save only the current viewport; this is the supported option for browser-internal pages that do not permit script injection.

The extension can optionally pre-scroll the page to trigger lazy loading, wait for visible images and fonts to settle, inspect a best-effort set of HTML/CSS/SVG/video image resources, and report warnings when resources appear incomplete or could not be audited.

## Current scope

The target is a small, dependable, dependency-free browser extension—not a full screenshot editor. The build focuses on capture correctness, tiled composition, local processing, bounded resource use, progress/error reporting, and restoring the page after capture.

Implemented capabilities include:

- Manifest V3 extension with no permanent host permissions.
- Full-page and viewport-only capture.
- Smart, Entire document, and Main scrollable panel capture targets.
- Bounded lazy-load preparation and optional bounded auto-load for feeds.
- Vertical/horizontal tile planning, overlap and coverage validation.
- PNG output split dynamically into numbered parts.
- Temporary tile storage in extension-origin IndexedDB.
- Detection of some incomplete images, including best-effort sampled CSS backgrounds, pseudo-element images, SVG `<image>` resources, video posters and image inputs.
- Detection/suppression of selected fixed or sticky overlays after the first tile, to reduce repeated chat composers and headers.
- Progress, cancellation, filename sanitization, scroll/style restoration, and cleanup.
- Local synthetic fixtures and automated regression tests.

## Architecture at a glance

1. **Popup (`popup.html`, `popup.js`, `popup.css`)** collects capture mode/settings and displays progress, warnings and errors.
2. **Service worker (`background.js`)** coordinates the job, checks the active tab, injects the page script, requests captures through `chrome.tabs.captureVisibleTab`, routes tiles to the stitcher, and manages cancellation/cleanup.
3. **Page logic (`content.js`)** measures document/scroll-panel geometry, chooses a capture target, prepares lazy content, scrolls tile-by-tile, makes temporary visual changes, audits image readiness, and restores the source page.
4. **Geometry/protocol/policy helpers (`geometry.js`, `protocol.js`, `url-policy.js`)** hold tile/layout algorithms, separated message namespaces, and restricted-URL decisions.
5. **Stitcher page (`stitcher.html`, `stitcher.js`)** stages tile data in extension-local IndexedDB, validates tile completeness and page coverage, composites bounded canvas parts, downloads PNG files, then cleans temporary data.

## What has been verified

- `npm run check` completed in the handoff-preparation environment on Node.js v22.16.0.
- JavaScript syntax checks passed for all seven JavaScript modules.
- All **72 automated Node tests passed**.
- The project manifest and expected local assets exist in the release ZIP, and ZIP integrity was checked.
- Earlier user-side manual testing established that v1.2.3 downloaded PNGs for long documents and ChatGPT/Claude examples. Subsequent versions contain fixes for repeated fixed composers, image auditing and panel selection, but the complete v1.2.6 browser flow has not yet been confirmed by the user.

## Important status distinction

**v1.2.6 is the latest packaged implementation in this handoff, not a claim of universal site compatibility.** The last build the user explicitly described as stable was v1.2.3. v1.2.6 adds fixes for issues reported later and has strong automated regression coverage, but should be treated as a candidate build until tested in the recipient's Chrome/Edge on the current fixtures and target sites.

## Success definition

A capture is successful only when the expected image part(s) download, open as valid PNGs, cover the intended region without missing strips or accidental duplication, contain the final/end marker where applicable, and restore the original page state. A green “Complete” status confirms export completion; warnings may still mean completeness could not be guaranteed.
