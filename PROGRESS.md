# PROGRESS.md

Update this at the end of every phase. Newest entries at the top of each section.

## Current status
- Version: 2.3.0 (delivered from the planning chat, not yet on GitHub)
- Current phase: Phase 0 - Repo and environment gate (started; stopped at the env check, now resolved by project-local browsers)
- Last green run (Linux, planning environment): `npm run check` 96/96,
  `npm run e2e` 16/16 (Full), `npm run e2e:lite` 14/14 (Lite).
- Not yet verified: anything on Windows, any real logged-in site, HiDPI screens.

## Phase log
| Date | Phase | Result | Notes |
| --- | --- | --- | --- |
| 2026-10-22 | v2.3 delivered | Done | Editions, site presets, searchable PDF, auto-expand, naming. |

## Real-site results (Phase 1)
| Date | Site | Edition | Result | Notes |
| --- | --- | --- | --- | --- |

## Decisions log
| Date | Decision | Why |
| --- | --- | --- |
| 2026-10-22 | Lite public listing, Full unlisted | Avoid store duplicate rule; Lite has no scary permission |
| 2026-10-22 | One-time Pro license, $19 then $29, INR 499 regional | Local tool with no server cost; low-price market |
| 2026-10-22 | Dodo Payments preferred | Merchant of record with INR payouts for Indian sellers |
| 2026-10-22 | No analytics | Keeps the local-only promise; use store dashboard |
| 2026-10-22 | Playwright browsers project-local in .local/ms-playwright, set by scripts/pw-env.mjs | Owner wants everything in the local project; no global env vars |
| 2026-10-22 | Playwright Chromium for E2E | Branded Chrome ignores --load-extension |
| 2026-10-22 | Source is pure ASCII, Unicode via escapes | Owner rule; enforced by scripts/check-ascii.mjs |
| 2026-10-21 | chrome.debugger Full render engine | Only way to render lazy/virtualised/fixed content correctly |

## Needs the owner's check
- Store and trademark search for the name "Page Archive".
- Payment provider account and fees.
- Real-site matrix runs (Phase 1).
