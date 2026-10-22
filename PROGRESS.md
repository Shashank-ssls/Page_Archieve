# PROGRESS.md

Update this at the end of every phase. Newest entries at the top of each section.

## Current status
- Version: 2.3.0 (on GitHub: Shashank-ssls/Page_Archieve, private)
- Current phase: Phase 1 - Real-site validation (in progress)
- Last green run (Windows, GEHRMAN_SPARROW, 2026-10-22): `npm run check` 96/96,
  `npm run e2e` 16/16 (Full), `npm run e2e:lite` 14/14 (Lite), popup-shot and
  build OK. No Windows-specific fixes were needed.
- Not yet verified: any real logged-in site, HiDPI screens.

## Phase log
| Date | Phase | Result | Notes |
| --- | --- | --- | --- |
| 2026-10-22 | Phase 0 | Done | git init + .gitattributes (LF). Chromium in .local/ms-playwright, nothing written to C:. chrome-devtools MCP attached to the test Chrome (example.com screenshot). Pushed with plain git (no gh). |
| 2026-10-22 | v2.3 delivered | Done | Editions, site presets, searchable PDF, auto-expand, naming. |

## Real-site results (Phase 1)
| Date | Site | Edition | Result | Notes |
| --- | --- | --- | --- | --- |
| 2026-10-22 | Claude long thread (DPR 1.2) | Full | Partial pass | Conversation only, all turns, composer hidden, header once, seams clean (3 PNG parts); PDF 3 pages, 1,161 runs, 0 unmapped (starts with Claude's hidden screen-reader hint, harmless). Second run had the Progress/Outputs side panel open: kept once at the top, overlaps no text (owner to decide if it should be hidden). A real artifact (split view) is still untested. |
| 2026-10-22 | Wikipedia, History of the Internet (DPR 1.2) | Full | Pass | PNG: 5 parts, header once, images present, 4 part seams continuous. PDF: 5 pages, 7,587 text runs, 0 unmapped, "Jump to content" to "Mobile view". Honest warnings: image time budget reached, 1 image incomplete once. |
| 2026-10-22 | ChatGPT thread (DPR 1.2) | Full | Pass (after 3 fixes) | All turns, images, no sidebar, no composer/disclaimer, no seams (recapture 3). Fixed: white seam at fractional DPR; outdated preset markers + hidden thread copies; composer and disclaimer inside the scroller. Cosmetic: ~76 px blank band at the end (ChatGPT reserved composer space). PDF (1 page, invisible Unicode text layer, 244 runs, 0 unmapped glyphs) covers first to last line and excludes composer/disclaimer. |

## Decisions log
| Date | Decision | Why |
| --- | --- | --- |
| 2026-10-22 | Remote is Shashank-ssls/Page_Archieve, pushed with plain git | Owner created the repo on the web; gh CLI not installed |
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
- Popup shows the requested file name ("Generative AI Learning Plan.png") when Chrome saved it as "... (3).png" on a name clash. Cosmetic honesty issue; fix later (use the final name from chrome.downloads).
- popup-shot: the capturing/done states show the "browser pages" banner and a
  disabled capture button; probably a harness artifact (popup opened as an
  extension page). Check in Phase 1.
