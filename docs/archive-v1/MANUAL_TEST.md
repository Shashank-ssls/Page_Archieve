# Manual browser test checklist

## Install
1. Extract the ZIP to a permanent folder (for example, `F:\Dev\Page-Archive-Capture`).
2. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge).
3. Enable Developer mode, choose **Load unpacked**, and select the extracted folder containing `manifest.json`.
4. Pin Page Archive Capture to the toolbar.

## Synthetic page

Use the v1.2.6 ZIP and remove or reload any previously loaded unpacked copy first.
1. In PowerShell, change to the extracted folder and run `& "F:\Apps\Python\python.exe" -m http.server 8765`.
2. Open `http://127.0.0.1:8765/tests/site-fixture/`.
3. Capture full page with **Prepare lazy-loaded images** enabled.
4. Verify headings are ordered, the sticky header is not repeated, image blocks render, the last section appears, and the page returns to the initial scroll position.
5. Re-open every downloaded PNG. If a tile is missing, undecodable or leaves a coverage gap, the extension should report an error instead of downloading a silently incomplete image.
6. Run again with **Auto-load more content** enabled; it must stop within the built-in limits.
7. Test visible-area capture; it must not scroll the page.
8. Cancel during image preparation and during tile capture; the original scroll position and temporary styles should be restored.

## Real websites
- Use the supplied Notion page while signed in.
- Test one normal article, one lazy-image gallery, and one app with an inner scrolling panel.
- Verify download file names, dimensions and warnings; open each PNG part.
- Test a restricted browser page: if capture is not permitted, a clear error is expected; if the API permits a visible capture, it must be labeled as visible-only.
- Cancel during capture and confirm the original page scroll/style state is restored.

## Known constraints
- Do not switch tabs or scroll the page while full-page capture is in progress.
- Inner-container capture focuses on the detected scrollable content region; it does not promise to reproduce every surrounding fixed sidebar or application chrome.
- Broken resources, inaccessible cross-origin content, protected browser surfaces, and never-ending feeds cannot be reconstructed perfectly by a screenshot extension.


## Diagnostics added in v1.1.1

If capture fails, reopen the extension popup on the same tab. The last error should remain visible for up to 24 hours. The service worker also logs capture failures. Browser-internal pages such as `chrome://extensions` are deliberately rejected; use the local fixture page or an ordinary website.


## v1.2.0 additions

1. Verify the migrated height setting is 200,000 px. Capture a tall page and confirm it creates however many numbered PNG parts are required (not a fixed count of three). Test 300,000 px on a very long page; the extension has an 800-tile safety ceiling to constrain memory and storage use.
2. Test **Smart** on a normal article, then on ChatGPT and Claude. For chat interfaces, enable **Auto-load more content** to let it revisit the top and bottom to trigger older/newer message loading. If Smart chooses the wrong area, retry with **Main scrollable panel**; use **Entire document** to prioritize the document/app shell.
3. On a chat app whose scroller is clipped by the viewport, verify capture finishes without missing top/bottom sections and that page styles and the original scroll position are restored. Compare panel-only output with the warning that surrounding application chrome is not included.
4. On `chrome://extensions`, verify **Full page PNG** is disabled with an explanation. Choose **Visible area PNG** to capture the viewport. Reduce Chrome zoom before capture if you need more of the internal page to fit on screen.
5. Use a fixture with a delayed lazy image and a delayed web font. Verify visible images are allowed up to the configured wait, late-added images are checked a second time, and original `loading` attributes are restored. If the source URL itself fails, expect a warning; the extension cannot recreate an unavailable image.


## v1.2.1 additions

- Test `https://rubic.exchange/` in **Smart** mode. Because the root document scrolls, Smart should select the full document rather than an unrelated nested panel. If an inner panel is selected anyway, note the selected target warning and capture error.
- Test ChatGPT/Claude in Smart mode; the recognized conversation-panel heuristic remains enabled for those hosts.
- If you deliberately select Main scrollable panel, confirm the reported tile coordinates remain aligned with requested offsets. v1.2.2 attempts to re-anchor a panel that moves; if it is replaced, resizes, or cannot be stabilized, it should stop with a specific error rather than export a gapped image.
- If a broken-image warning occurs, inspect the example host/path in the popup. A genuinely failed resource cannot be repaired from screenshot code alone.
- Test `chrome://extensions` with Visible area PNG; full-page mode is deliberately unavailable there.


## v1.2.2 moving-panel regression

1. Open `http://127.0.0.1:8765/tests/site-fixture/moving-panel.html` using the local server.
2. In Page Archive Capture, select **Main scrollable panel**, keep lazy-image preparation enabled, and start **Full page PNG**.
3. The fixture simulates a collapsible app shell that moves the selected panel parent upward by 152 px below section 1 and resets when returned to the top. The extension should re-anchor the selected panel, complete the export, and include `FINAL MARKER — capture reached the end`.
4. Verify the panel's original styling/position is restored after the capture finishes.
5. A real site may replace its scroll element or change its dimensions; those cases should still produce an actionable error rather than a knowingly incomplete export.


## v1.2.3 anchor-order regression

- On `moving-panel.html`, keep lazy-image preparation enabled and auto-load disabled.
- Confirm the content script records its panel anchor before any preparation scroll, then stabilizes to that baseline after preparation.
- Capture the entire panel; verify the final marker is present and the error does not report a +152px coordinate offset.


## v1.2.4 image-completeness audit

1. Open `http://127.0.0.1:8765/tests/site-fixture/image-audit.html`.
2. Start **Full page PNG** with **Prepare lazy-loaded images** enabled.
3. The fixture intentionally includes one known-good HTML data image and one known-good CSS data background, plus deliberately missing HTML, CSS background, pseudo-element background, SVG `image`, and video poster resources.
4. Verify the PNG is downloaded and the popup's completion message reports the image-audit counts. The known-good sources must not appear as failures; broken source examples should identify the missing host/path when the relevant element was visible and sampled.
5. A timeout message means an asset was not verified within the time budget; it must not claim the asset is definitely broken. Canvas pixels, video frames, closed shadow roots, cross-origin iframe DOM, and CSS `image-set()` variants are outside full audit coverage.
6. Re-run `moving-panel.html` to ensure the image audit did not regress inner-panel stabilization, then test real sites. Keep v1.2.3 as the stable baseline until these checks pass.


## Notebook layout reflow regression (v1.2.5)

Open `/tests/site-fixture/notebook-reflow.html` and capture with **Capture target → Main scrollable panel**. The fixture deliberately shrinks the panel's scrollable content by 11 CSS pixels when the final scroll edge is approached. Expected: the capture completes, output dimensions use the final measured height, the final marker is visible, and no coverage gap is reported. A warning about minor panel position adjustment is acceptable. Real coverage gaps must still prevent export.


## v1.2.6 — chat composers and offscreen scroll panels

1. Open `http://127.0.0.1:8765/tests/site-fixture/app-scroll-panel.html`. Choose **Main scrollable panel** and capture. The synthetic fixed composer overlaps the scroll crop but is outside the scroll container. It may appear in the first tile, but must not repeat in later tiles; after capture it must be visible again on the source page.
2. Open `http://127.0.0.1:8765/tests/site-fixture/offscreen-panel.html`, scroll the outer page down by several thousand pixels, and use **Smart**. Because the root document scrolls and the detected panel is mostly offscreen, Smart should choose the document and capture from its beginning.
3. On ChatGPT or Claude, check the composer appears at most once in a stitched output. If a candidate scroll panel is mostly outside the viewport, Smart should prefer the document when feasible or show an explanatory error instead of reporting a tile beginning thousands of pixels into the panel.
4. Warnings about the image-audit safety cap mean the capture completed but not every possible CSS/embedded asset was checked. A warning about the preparation time budget means some content may still load late; it is not a confirmation that an image is broken.
