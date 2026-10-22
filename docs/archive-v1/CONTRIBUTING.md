# Developer Handoff and Contribution Guide

## First steps

1. Read `README.md`, then `docs/PROJECT_SUMMARY.md` and `docs/ARCHITECTURE.md`.
2. Install the current ZIP as unpacked in Chrome/Edge and run the manual smoke tests in `docs/TESTING.md`.
3. Run `npm run check` before modifying the source.
4. Reproduce a site bug and, where feasible, encode the minimal behavior as a local HTML fixture plus regression test.
5. Fix the geometry/state issue at the narrowest responsible layer. Do not disable tile coverage or image audit protections just to force an export.
6. Update `CHANGELOG.md`, `VALIDATION.md`, `README.md`, and the roadmap when behavior/limits change.
7. Rerun tests, validate manifest assets, create a ZIP, test ZIP integrity, and record the checksum.

## Source map

| File | Start here for |
|---|---|
| `background.js` | Capture job lifecycle, tile capture loop, state/progress/cancellation, stitcher coordination |
| `content.js` | Target selection, dimensions, lazy loading, image wait/audit, scroll/sticky behavior and restoration |
| `geometry.js` | Offset planning, geometry correction, coverage validation, draw mapping and PNG part layout helpers |
| `stitcher.js` | IndexedDB tile store, tile validation, canvas composition and downloads |
| `protocol.js` | Allowed content/stitcher message types |
| `url-policy.js` | Restricted page URL policy |
| `popup.js` / `popup.html` / `popup.css` | Settings, progress/status UI and actions |
| `tests/*.test.cjs` | Focused automated regression tests |
| `tests/site-fixture/*.html` | Local controlled repro pages |

## Engineering rules

- Keep page, worker and stitcher message contracts explicit. Add tests when adding message types.
- Keep capture operations bounded by time, page height, dimensions, tile count and image-audit budgets.
- Treat actual scroll position and the live final edge as authoritative after reflow; never invent unmeasured tile positions.
- Make small, justified drift corrections but keep meaningful coverage gaps fatal.
- Restore every temporary style/attribute/scroll mutation in a `finally`/cleanup path as far as the current DOM permits.
- Keep UI warnings specific and distinguish “broken”, “unverified”, “truncated”, “multi-part” and “panel capture”.
- Do not include screenshots/page text in bug reports unless necessary and approved; a minimal fixture is preferable.
- Do not add runtime dependencies, a backend, host permissions or `debugger` permission without a documented rationale and explicit review.

## Definition of done for a change

- Regression test added or existing test updated.
- `npm run check` passes.
- A relevant local fixture passes in real Chrome/Edge when browser integration changes.
- Warning/error text accurately describes the behavior.
- Source page state is restored after success, failure and cancellation.
- Release docs and version numbers agree.
