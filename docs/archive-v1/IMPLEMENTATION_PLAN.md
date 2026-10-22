# Implementation Plan and Roadmap

## Product goal

Deliver a local-first Chrome/Edge extension that reliably saves the visible rendering of a long webpage or app scroll region as one or more numbered PNG files. Prioritize correct coverage, image readiness, clear warnings, and source-page restoration over adding editor features.

## Current implementation status (v1.2.6)

| Area | Status | Notes |
|---|---|---|
| Manifest V3 load-unpacked installation | Implemented | No build step or runtime packages |
| Full-page scroll-and-stitch capture | Implemented | Requires active regular webpage and scriptable DOM |
| Viewport-only capture | Implemented | Supported option for restricted browser pages |
| Smart/document/panel targets | Implemented, heuristic | Needs ongoing real-site validation |
| Lazy content preparation | Implemented, bounded | Cannot force server/resource success; time budget may be reached |
| Image completeness audit | Implemented, best effort | Sampled visible HTML/CSS/SVG/video/input resources; does not cover every rendering technique |
| Multi-part PNG output | Implemented | Max height 300,000 CSS px; maximum 800 capture tiles |
| Tile/coverage checks | Implemented | Export stops rather than silently accepting a meaningful gap |
| Sticky/fixed overlay handling | Implemented, needs real-site confirmation | v1.2.6 specifically addresses pinned composers outside an inner selected panel |
| Panel reflow/shift handling | Implemented, test fixtures exist | Highly dynamic apps can still replace/reflow panels outside tolerated correction |
| Cancellation and restoration | Implemented | Restoration is best-effort when page removes/replaces elements |
| Real installed-extension end-to-end suite | Incomplete | Unit tests and DOM harness do not cover all screenshot/download APIs in actual user Chrome |

## Priority 0 — Confirm the release candidate

Before more features are added, validate the current build against the manual test matrix in `TESTING.md`.

Acceptance:

- Install via Load unpacked with no errors.
- Capture baseline long page and moving-panel fixture; inspect all outputs.
- ChatGPT: input/composer must not repeat on later tiles; conversation content remains continuous.
- Claude: Smart mode either captures the intended conversation or gives a specific, actionable limitation without outputting a misleading PNG.
- Notion: check image blocks, full content, boundaries and final section.
- Google Colab notebook: ensure reflow warnings are understandable and PNG output has no gaps.
- Image-audit fixture: known-broken resources are reported; known-good resources are not falsely classified as broken; audit-limit warnings are understandable.
- After each capture, confirm the source tab's scroll position and styles are restored.

## Priority 1 — Reliability work after repro evidence

1. **Add site regressions only for reproducible defects.** Create/adjust fixture that demonstrates the exact failure before changing capture logic.
2. **Improve capture diagnostics.** Keep failure cause, target type, tile number and measured/expected offsets visible in the UI; distinguish broken from unverified resources.
3. **Improve large-page memory management.** Measure tile Blob storage, IndexedDB growth, canvas dimensions, and download behavior at several page heights. Do not increase the 800-tile safety limit without an incremental/streaming memory strategy.
4. **Handle site DOM diversity.** Test sticky composer/header behavior, fixed app shells, virtualized chat messages, CSS backgrounds, open shadow roots and image-loading races.
5. **Add real browser automation.** Where permitted, install the unpacked extension in a controlled test profile and validate full start → capture → stitch → download → cleanup. Keep manual Chrome/Edge checks for cases automation cannot reproduce.

## Priority 2 — Release engineering

- Document supported Chrome/Edge versions and permissions.
- Keep version, ZIP name, README, CHANGELOG and validation report synchronized.
- Run syntax/unit tests, manifest checks and ZIP-integrity checks for every package.
- Keep the last known-good ZIP and its checksum.
- Collect minimal diagnostics only with user consent; never upload screenshots or page content as a default troubleshooting mechanism.

## Deferred features

These should not be implemented until capture correctness is acceptable:

- Region/element selector.
- Annotation, blur/redaction, crop/markup editor.
- JPEG/WebP/PDF or searchable PDF exports.
- Capture history or persistent gallery.
- DevTools/debugger/Turbo mode or any broadening of permissions.
- Guaranteed deep cross-origin iframe capture.
- Mobile emulation and automation of browser-internal pages.

## Exit criteria for “stable”

Do not call the release stable solely because unit tests pass. Require: (1) automated tests passing, (2) fixtures passing in a real supported browser, (3) no critical gaps/repeated overlay defects on target-site smoke tests, (4) source-page restoration verified, and (5) known limits documented. A failure must remain visible rather than silently become a partial success.
