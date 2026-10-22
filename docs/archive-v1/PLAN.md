# Implementation Plan

This file is the project-plan entry point for the v1.2.6 handoff. The prior version's implementation notes are superseded by the current roadmap below; historical release behavior remains in `CHANGELOG.md`.

- **Project purpose and status:** [`docs/PROJECT_SUMMARY.md`](docs/PROJECT_SUMMARY.md)
- **Architecture:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **Prioritized implementation plan and exit criteria:** [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)
- **Testing and acceptance matrix:** [`docs/TESTING.md`](docs/TESTING.md)
- **Security/privacy constraints:** [`docs/SECURITY_AND_PRIVACY.md`](docs/SECURITY_AND_PRIVACY.md)
- **Known limitations:** [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md)

## Immediate plan

1. Treat v1.2.6 as the latest candidate, not automatically as stable.
2. Run `npm run check`; current handoff-preparation result is 72/72 tests passed.
3. Use the real Chrome/Edge manual matrix for app-scroll-panel, offscreen-panel, image-audit, moving-panel and notebook-reflow fixtures.
4. Re-test ChatGPT and Claude for repeated composer/panel-selection defects; then run Notion and Google Colab smoke tests.
5. Only make further behavior changes when a defect is recorded and, where possible, a focused local regression fixture is added.
6. Update `CHANGELOG.md`, `VALIDATION.md`, and the version together for any new package.

**Release gate:** no release is considered stable until the relevant fixtures and target-site smoke tests pass in a real browser. Do not weaken tile coverage checks or silently fall back from full-page to visible-only capture.
