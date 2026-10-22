# Handoff Brief — Page Archive Capture v1.2.6

## One-paragraph brief

Page Archive Capture is an independently authored, local-first Chrome/Edge Manifest V3 extension that captures long rendered webpages and selected app scroll panels as PNG files. It uses an on-demand injected content script to measure and scroll the page, a service worker to orchestrate screenshot tiles and progress, and a local extension-origin stitcher page to validate and composite tiles into one or more bounded PNG outputs. It aims to prepare lazy-loaded content, audit a best-effort subset of image resources, prevent blank gaps/repeated sticky overlays, and restore the source page after capture. It requires no runtime packages or backend and does not upload screenshots by design.

## What to hand over

- `Page-Archive-Capture-v1.2.6.zip` (the source implementation as built).
- The entire repository/folder with `README.md`, `PLAN.md`, `CHANGELOG.md`, `VALIDATION.md`, `RESEARCH.md`, `THIRD_PARTY_NOTICES.md`, the `docs/` directory, and tests/fixtures.
- `docs/Project-Handoff.docx` and `docs/Project-Handoff.pdf` for a concise shareable overview; equivalent standalone files are provided alongside the ZIP.

## Current state

- Latest implementation: v1.2.6.
- Automated test command: `npm run check`.
- Handoff-preparation run: Node v22.16.0; syntax checks passed; 72/72 automated tests passed.
- Manifest and local assets checked; ZIP integrity checked.
- User-confirmed behavior: v1.2.3 downloaded PNGs for several long-document/ChatGPT/Claude examples and passed the moving-panel test. Later builds add new behavior, and v1.2.6 needs a fresh user-side test of fixed-composer suppression and severely clipped panel selection before being labeled stable.
- No complete browser end-to-end automation currently proves every site. Testing includes unit/regression tests and a Chromium DOM harness; manual browser download testing remains a release gate.

## First assignment for the receiving developer

1. Keep v1.2.3 ZIP as rollback; do not overwrite it.
2. Load v1.2.6 unpacked in Chrome/Edge.
3. Run the image-audit, moving-panel, app-scroll-panel and offscreen-panel fixtures using the checklist in `docs/TESTING.md`.
4. Test ChatGPT and Claude: confirm conversation continuity, input/composer appears no more than once across later tiles, capture doesn't abort on a panel far outside the viewport, output PNGs open, and page position/styles restore.
5. Test Notion and Google Colab only after the fixtures pass; record any missing image/section and the precise warning.
6. If a defect exists, reproduce it in a local fixture, add a test, change the smallest relevant code path, update `CHANGELOG.md` and `VALIDATION.md`, and rerun `npm run check`.

## Decisions not to reopen without evidence

- Do not attempt full-page capture of `chrome://extensions` or `edge://extensions`; use Visible area PNG.
- Do not remove coverage validation or silently produce a viewport PNG when full-page capture fails.
- Do not add editor/history/PDF/remote services before core capture reliability is established.
- Do not increase the 800-tile limit without a bounded memory/staging design.

## Read order

1. `README.md` — installation and quick start.
2. `docs/PROJECT_SUMMARY.md` — scope and status.
3. `docs/ARCHITECTURE.md` — runtime components and protocol.
4. `docs/TESTING.md` — test setup, matrix and release acceptance.
5. `docs/SECURITY_AND_PRIVACY.md` and `docs/LIMITATIONS.md` — permissions and boundaries.
6. `docs/IMPLEMENTATION_PLAN.md` — prioritized roadmap.
