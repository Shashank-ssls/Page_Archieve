## v2.0 permission change: `debugger`

The Full render engine uses `chrome.debugger` to call the DevTools protocol on the tab the user is capturing: `Page.getLayoutMetrics`, `Page.captureScreenshot`, `Emulation.setDeviceMetricsOverride` / `clearDeviceMetricsOverride` and `Emulation.setFocusEmulationEnabled`. It attaches only after the user starts a capture, only to that tab, and always detaches in a `finally` path (also when the user dismisses Chrome's debugging bar, which cancels the capture). No network, cookie, storage or script-evaluation domains are used by the worker. Chrome does not allow `debugger` as an optional permission, so it is declared in `permissions`; install shows a stronger warning. Users who do not want it can pick Scroll & stitch, but the permission remains declared.

# Security and Privacy Notes

## Permission model

The manifest requests only:

- `activeTab` — access to the tab after the user invokes the extension.
- `scripting` — inject capture logic into the active, permitted page.
- `downloads` — save the resulting PNG files.
- `storage` — keep user settings and limited status information locally.

The extension declares no permanent website host permissions, analytics permission, externally connectable endpoint, or backend service. The extension is designed to run without uploading screenshots/page text or calling a remote capture service.

## Data handling

- DOM inspection and image readiness checks run in the active page after user initiation.
- Tile images are staged in extension-origin IndexedDB for stitching. The application attempts to delete tiles at completion or handled failure; abandoned records older than 12 hours are pruned on a later stitcher startup.
- PNG downloads are written using Chrome's downloads API and the user's configured browser download location.
- Settings and last progress/error status are kept in `chrome.storage.local`.
- The extension does not deliberately persist page text or build a browsing history.
- The image audit may probe URLs found in the page's visible CSS/embedded image sources in order to verify whether those resources load. Lazy-load preparation can also trigger the source website's ordinary resource requests. These requests should be described to users accurately; “local processing” does not mean the website receives no normal requests.

## Restricted pages

Chrome/Edge browser-internal pages such as `chrome://extensions`, `edge://extensions`, `chrome-extension://`, DevTools and `view-source:` pages are not ordinary scriptable websites. The supported behavior is visible-area capture where Chrome permits `captureVisibleTab`; full-page scrolling/DOM extraction on these pages is intentionally blocked. Do not add `debugger` or broad host permissions as a casual workaround.

## Developer review checklist

- [ ] Confirm no new remote endpoints, telemetry, tracking or screenshot uploads are introduced.
- [ ] Keep permissions minimal and justified in the manifest/release notes.
- [ ] Do not log page content, image bytes, cookies, auth tokens or private URLs in routine diagnostics.
- [ ] Sanitize filenames and constrain heights, tile count, canvas dimensions and waits.
- [ ] Verify cancellation and failure paths restore page mutations and delete temporary tiles where possible.
- [ ] Treat CSS/embedded image audit results as potentially sensitive URLs; keep diagnostic examples minimal and avoid collecting them centrally.
- [ ] Check third-party licenses before copying/adapting external code. This implementation is independently authored; research projects are listed as references, not bundled dependencies.

## Threat/robustness model

The source page is untrusted and can mutate/re-render itself at any time. DOM references may become stale, event handlers may react to synthetic scrolling, and its dimensions may change during capture. Capture logic must validate measured geometry, fail closed on significant gaps, bound work and restore mutations best-effort. It must not treat website text or HTML as code to execute outside the intended page context.
