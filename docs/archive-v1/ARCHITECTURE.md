# Architecture and Data Flow

## Runtime components

| Component | Responsibility | Trust boundary |
|---|---|---|
| `manifest.json` | Manifest V3 metadata, popup, service worker, action, shortcut, permissions and icons | Defines what Chrome grants; no persistent host permissions are declared |
| `popup.html`, `popup.css`, `popup.js` | Settings UI, capture target, start/cancel actions, progress/warning/error rendering | Extension UI; does not read page DOM directly |
| `background.js` | Job lifecycle, active-tab checks, script injection, capture loop, progress, cancellation and error handling | Privileged extension service worker; calls Chrome APIs |
| `content.js` | DOM measurement, target selection, preparation, scroll mutations, per-tile state, image checks and restoration | Runs in the active website tab only after invocation and injection |
| `geometry.js` | Pure geometry: scroll offsets, rectangles, output part tiling, tile coverage, source crop/destination mapping | Intended to keep math testable outside Chrome |
| `protocol.js` | Explicit command allow-lists for page and stitcher message handlers | Prevents page/stitcher handlers from replying to unrelated `PAC_*` messages |
| `url-policy.js` | Identifies restricted browser/extension/devtools/view-source URLs | Guards unsupported pages before injection where the URL is available |
| `stitcher.html`, `stitcher.js` | Receives tiles, stores them locally, verifies index/coverage, composites PNG parts, triggers downloads and cleans capture records | Extension-origin page with access to local extension storage and download APIs |
| `tests/` | Unit/regression tests and synthetic pages | Does not by itself prove the entire installed extension flow works end-to-end |

## Main full-page sequence

1. User opens the popup and chooses **Full page PNG** plus settings.
2. Popup sends `PAC_START` to the service worker with the active tab ID, mode and options.
3. The worker rejects restricted browser pages, opens the local `stitcher.html` page, waits for its `PAC_PING` response, and injects `geometry.js`, `protocol.js` and `content.js` into the active page.
4. The worker requests `PAC_PREPARE`. The content script determines the root scrolling element or eligible inner panel; saves scroll/style state; optionally triggers lazy loading; waits a bounded time for image/font readiness; audits sampled image resources; calculates page/tile metrics; and returns a plan plus warnings.
5. The worker starts a stitcher session (`PAC_BEGIN`) with page dimensions, capture dimensions, mode and warnings.
6. For every planned tile, the worker checks the source tab is still active, tells the content script to scroll and settle (`PAC_SET_TILE`), obtains the current viewport screenshot using `chrome.tabs.captureVisibleTab`, and sends the tile data to the stitcher (`PAC_STORE_TILE`). Progress is reported as work proceeds.
7. The stitcher requires the expected tile indices and geometrical coverage to be complete. It then composites tile crops into one or more canvases, bounds each part by browser-safe dimensions/area, encodes PNGs and downloads numbered files.
8. The content script restores original scroll offsets and inline style mutations. The worker requests stitcher cleanup, reports final warnings/status, closes the temporary stitcher tab, and clears the active job.

## Visible-area sequence

Visible-area capture uses `chrome.tabs.captureVisibleTab` without running the full scroll-and-stitch process. It is intentionally separate from full-page capture. If full-page capture fails, the extension must not silently relabel a viewport screenshot as a full-page success.

## Important internal invariants

- Page and stitcher command sets are separate and explicitly tested.
- The originally selected tab must remain the active tab in its window when the viewport screenshot is requested, because `captureVisibleTab` captures the active tab.
- Tile IDs/counts and rectangle coverage must be checked before export.
- No meaningful tile gaps may be ignored just to force an export.
- Large pages are split into bounded PNG parts; the implementation caps page height at 300,000 CSS pixels and tile count at 800.
- Temporary DOM mutations, scroll offsets, image loading attributes and overlay visibility must be restored on success, error and cancellation where the page still exposes the target elements.
- Image audit is best effort; an “unverified” resource is not the same as a confirmed broken resource.

## Message groups

Page-content handler commands (from `protocol.js`): `PAC_VISIBLE_INFO`, `PAC_PREPARE`, `PAC_SET_TILE`, `PAC_RESTORE`, `PAC_CANCEL_PREPARE`.

Stitcher handler commands: `PAC_PING`, `PAC_BEGIN`, `PAC_STORE_TILE`, `PAC_COMPOSE`, `PAC_CANCEL_STITCH`, `PAC_CLEANUP`.

Worker/UI messages also include `PAC_START`, `PAC_CANCEL`, `PAC_GET_STATUS`, `PAC_CONTENT_PROGRESS` and `PAC_PROGRESS`.

## Output files

Downloads use sanitized page-title/host-derived names. Long captures may result in files such as `page_part-01-of-04.png`, `page_part-02-of-04.png`, etc. The exact count depends on the capture's measured dimensions and browser canvas limits; it is not hard-coded to three or four parts.
