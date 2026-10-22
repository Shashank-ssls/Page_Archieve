# Testing and QA Guide

## Test layers

1. **Static/syntax checks** — all JavaScript files parse and manifest/assets are present.
2. **Unit/regression tests** — pure geometry, message separation, restricted URL policy, image readiness/audit and capture-entry behavior.
3. **Synthetic browser fixtures** — controlled HTML pages simulate common patterns and regression cases.
4. **Real-browser smoke tests** — the installed unpacked extension is exercised in Chrome/Edge, including screenshot APIs and actual downloads.
5. **Real-site smoke tests** — only after fixture tests pass, test target sites such as ChatGPT, Claude, Notion and Google Colab. Results depend on their current DOM and UI behavior.

Passing levels 1–2 does not prove levels 3–5. A mocked content-script harness is useful but it is not the full extension screenshot/download flow.

## Automated tests

Requires Node.js 20 or newer for tests only. No `npm install` is needed because `package.json` uses Node's built-in test runner and no package dependencies.

From the project root:

```powershell
npm run check
```

This runs syntax checks for `background.js`, `content.js`, `popup.js`, `stitcher.js`, `geometry.js`, `protocol.js`, and `url-policy.js`, then runs `node --test tests/*.test.cjs`.

The v1.2.6 handoff validation observed **72 passing tests**. Re-run the test suite rather than relying on this stored result after code changes.

## Real-browser end-to-end harness (v2.0)

```
npm i -D playwright   # once, outside the extension folder is fine
CHROME=/path/to/chromium node tests/e2e/run.mjs '[{"name":"app","url":"/fx/app-scroll-panel.html"}]'
```

It copies the extension to a temp folder, adds a test-only `<all_urls>` host permission, serves fixtures at `/fx/`, starts captures through the worker test hook and copies the downloads plus `results.json` to the temp output folder.

## Start the local fixture server on Windows

Use a terminal in the extracted project root (the directory containing `manifest.json`). Python is used only to serve fixture HTML files; the extension itself does not require Python.

```powershell
# Stop any previous server with Ctrl+C first.
python -m http.server 8765
```

Open these URLs after starting the server:

| Fixture | URL suffix | Main behavior under test |
|---|---|---|
| Baseline long page | `/tests/site-fixture/` | Long document, section ordering, lazy images, sticky elements, final marker |
| App scroll panel | `/tests/site-fixture/app-scroll-panel.html` | Scrollable panel plus fixed/sticky composer overlay |
| Moving panel | `/tests/site-fixture/moving-panel.html` | Parent/shell shift triggered during panel scrolling |
| Offscreen panel | `/tests/site-fixture/offscreen-panel.html` | Smart target should avoid a severely clipped panel |
| Notebook reflow | `/tests/site-fixture/notebook-reflow.html` | Small page/panel extent changes near capture end |
| Image audit | `/tests/site-fixture/image-audit.html` | Known-good and deliberately broken HTML/CSS/SVG/video/input image resources |

If port 8765 is busy, use another port such as 8766 and change the URL accordingly. Keep the terminal/server open while testing. Check `Test-Path .\manifest.json` and the target fixture file if a URL returns 404; the server serves the terminal's current directory.

## Manual test workflow

For every fixture test:

1. Load the extracted folder through `chrome://extensions` → Developer mode → Load unpacked. Do not test the browser-internal management page as a full-page target.
2. Open the fixture in a regular tab.
3. Choose the target explicitly when testing a known scenario: Smart for general use; Entire document for the root page; Main scrollable panel to force a panel.
4. Begin with Prepare lazy-loaded images on and Auto-load more content off. Use longer waits only for demonstrably slow assets.
5. Do not switch tabs or manually scroll the source page during capture.
6. Wait for Complete or an explicit error. Open every downloaded part.
7. Verify section order, output dimensions, no gaps, no repeated headers/composer after tile one, expected images and the final marker.
8. Confirm the source page returns to the original scroll/style state.
9. Record warnings as distinct categories: confirmed broken resource, audit incomplete/unverified, page truncated by configured height, panel selected instead of entire shell, or layout/coverage failure.

## Real-site smoke test matrix

| Site/type | Recommended initial target | What to inspect |
|---|---|---|
| Ordinary article/document | Smart | Full height, final paragraph, no tile seams |
| Notion document | Smart; compare Entire document if needed | Image blocks, tables, embeds, final content |
| ChatGPT conversation | Smart | Message continuity, no repeated composer, rendered images/code blocks |
| Claude conversation | Smart | Correct conversation region, no panel-offset abort or missing turns |
| Google Colab notebook | Smart; compare Entire document if the document scrolls | Code/output cells, bottom edge, reflow warnings, image outputs |
| Dynamic dashboard/DEX app | Smart, then Entire document | Target warning, clipped widgets, geometry shifts; do not keep retrying without recording error |
| `chrome://` / `edge://` | Visible area only | Viewport screenshot only; full-page DOM capture is not supported |

## Test-report template

Record the following whenever a test fails:

- Extension version and browser/version.
- URL/site category (remove private query parameters/tokens).
- Capture target and relevant settings.
- Popup status and full warning/error text.
- Whether a file downloaded; number of parts and whether each opens.
- First missing/duplicated section or image, and approximate tile/position.
- Whether original scroll position/style was restored.
- Console/service-worker error text when available; do not include private page text unless needed and explicitly approved.

## Release acceptance

A release candidate must pass `npm run check`, all relevant fixture cases, and real-browser smoke tests for any newly changed behaviors. A “Complete” state with warnings is not proof every asset was captured; inspect the actual PNGs.
