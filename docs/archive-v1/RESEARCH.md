# Repository research and implementation choice

Research reviewed on 18 October 2026. The code in this package was authored as a new, self-contained extension. Third-party repositories were studied as design references; their source files are not copied into this package.

## 1. Selected technical reference: Screencappy

Repository: https://github.com/smollet-app/screencappy

Its README and capture-related source (`src/content/capture.ts`, `src/lib/capture-common.ts`, `src/editor/stitch.ts`, and tests) demonstrate a modern Manifest V3 architecture and explicit handling for lazy images, adaptive settling, inner scroll containers, sticky/fixed elements, virtualized lists, huge pages, and regression fixtures. It is licensed Apache-2.0. The source package requires a development toolchain to rebuild, but its compiled extension can be loaded in a browser without installing runtime dependencies.

**Decision:** use its documented failure cases and architecture as a benchmark. This new project does not import its source code or build system; it keeps a smaller dependency-free implementation so the ZIP can be loaded unpacked immediately. The trade-off is that this first version does not include Screencappy's mature editor, history, mobile emulation, PDF export, or full debugger-based cross-origin-frame engine.

## 2. Historical capture reference: GoFullPage's public source

Repository: https://github.com/mrcoles/full-page-screen-capture-chrome-extension

The public repository is MIT-licensed and shows a classic scroll/capture/stitch pipeline: calculate page dimensions, scroll in overlapping viewport steps, capture each visible tile, correct scaling, draw into canvas regions, split oversized output and restore page state. Its public manifest is Manifest V2 and the README notes the Web Store version is maintained on a private branch.

**Decision:** use the algorithm as historical context, not as the base code, because it requires modernization and lacks several of the dynamic-page strategies needed here.

## 3. OpenCapture

Repository: https://github.com/Open-Capture/OpenCapture

Its README describes local full-page capture, annotation and export with Chrome/Edge/Firefox support, and its license badge identifies AGPL-3.0-or-later. It is a serious alternative worth studying for future annotation/editor work.

**Decision:** do not copy code into this MVP. Its copyleft obligations and larger Rust/WebAssembly build architecture are unnecessary for a dependency-free personal first release.

## 4. Web Shot

Repository: https://github.com/HelpFreedom/web-shot

Its README documents a modern scroll-and-stitch extension, HiDPI handling, sticky/fixed element treatment, progress badges, local download, state restoration and no network requests. It is GPL-3.0. The same README openly lists limits around inner scroll containers, horizontal scrolling, huge-page scaling and some viewers.

**Decision:** use its explicit limitations and privacy posture as a checklist; no source code was copied because a GPL-derived implementation would impose distribution conditions that are not needed here.

## 5. Original GoFullPage and FireShot

- GoFullPage public repository and license: https://github.com/mrcoles/full-page-screen-capture-chrome-extension
- FireShot official product: https://getfireshot.com/
- FireShot Chrome Web Store: https://chromewebstore.google.com/detail/take-webpage-screenshots/mcbpblocgmgfnpjjppndjkmgjaogfceg?hl=en-GB

FireShot is used as a product-feature reference only. No FireShot source code was located for reuse in this review.

## Decision

Build as a standalone Manifest V3 extension with plain JavaScript and browser APIs. The ZIP has no `node_modules`, runtime libraries, remote script loading, backend, credentials, host permissions, or build dependency. That makes installation friction low and keeps the capture pipeline local. The chosen trade-off is a leaner feature set and a manual-test requirement for difficult sites rather than pretending the extension can guarantee every site's complete rendering.
