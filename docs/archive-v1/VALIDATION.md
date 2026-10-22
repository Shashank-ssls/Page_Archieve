# Validation report - Page Archive Capture v2.1.0

- `npm run check`: 9 modules syntax-checked, 90/90 tests pass.
- Real Chromium end-to-end (tests/e2e/run.mjs): 12/12 cases done with page state restored, including the new reveal-lazy fixture (all 16 observer-loaded images present, backdrop colour across the full page, 100vh hero at original height). The notebook-reflow fixture still falls back to stitching by design.
- Not verified here: headed Chrome on Windows, HiDPI, live third-party sites.

