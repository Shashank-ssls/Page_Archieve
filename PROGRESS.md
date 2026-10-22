# PROGRESS.md

Update this at the end of every phase. Newest entries at the top of each section.

## Current status
- Version: 2.3.0 (on GitHub: Shashank-ssls/Page_Archieve, private)
- Current phase: Phase 1 - Real-site validation (in progress, owner-assisted rows left)
  and Phase 2 - Store-ready free launch (started early at the owner's request,
  2026-10-22; only parts that do not depend on Phase 1 or the gate)
- Last green run (Windows, GEHRMAN_SPARROW, 2026-10-22): `npm run check` 112/112,
  `npm run e2e` 24/24 (Full), `npm run e2e:lite` 19/19 (Lite), popup-shot and
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
| 2026-10-22 | DeepSeek chat (no preset) | Full (stitch) | Fixed, recapture pending | Composer drawn over the first answer. Live DOM: sticky bottom-0 composer inside the virtual-list scroller; Full render would hide it, so the capture came from scroll-and-stitch, which kept floating UI on the first tile. Stitch now applies the Full render hide rules on every tile (affects Lite on every chat site). |
| 2026-10-22 | itch.io, Higgsfield, Reddit feed, Vercel article (probe only) | Full | Probe OK | Read-only probe in the test Chrome with a Full-render-like tall viewport: all converge (no endless growth), no viewport-sized spacers. Reddit reCAPTCHA badge and a Vercel toast float above the bottom edge: now hidden. Owner captures pending. |
| 2026-10-22 | Chrome Web Store page | Full | Fixed | Capture attempt failed with a confusing double message; store pages are now blocked up front like chrome:// pages. |
| 2026-10-22 | Perplexity | - | Skipped | Thread locked behind sign-in; owner has no account. |
| 2026-10-22 | Gemini long thread with code (DPR 1.2) | Full | Pass (after 2 fixes) | First run: Full render failed (last turn's min-height = panel height - 112) and fell back to stitch with an honest warning. After fix (build 1022-1620): 3 parts, first message to last reply, no blank end. Remaining: "Scroll to bottom" button once at the end; fixed (build 1022-1635), recapture shows it gone. |
| 2026-10-22 | Claude long thread, artifact open (DPR 1.2) | Full | Pass | Conversation only, all turns, composer hidden, header once, seams clean (3 PNG parts); PDF 3 pages, 1,161 runs, 0 unmapped (starts with Claude's hidden screen-reader hint, harmless). Second run had the Progress/Outputs side panel open: kept once at the top, overlaps no text (owner to decide if it should be hidden). With an artifact open (split view): chat column only, artifact excluded, all turns, but ~13,600 px blank at the end (Claude's end spacer is sized to the viewport); fixed; recapture (build 1022-1553) ends about 280 px below the last reply, 2 parts, artifact excluded. |
| 2026-10-22 | Wikipedia, History of the Internet (DPR 1.2) | Full | Pass | PNG: 5 parts, header once, images present, 4 part seams continuous. PDF: 5 pages, 7,587 text runs, 0 unmapped, "Jump to content" to "Mobile view". Honest warnings: image time budget reached, 1 image incomplete once. |
| 2026-10-22 | ChatGPT thread (DPR 1.2) | Full | Pass (after 3 fixes) | All turns, images, no sidebar, no composer/disclaimer, no seams (recapture 3). Fixed: white seam at fractional DPR; outdated preset markers + hidden thread copies; composer and disclaimer inside the scroller. Cosmetic: ~76 px blank band at the end (ChatGPT reserved composer space). PDF (1 page, invisible Unicode text layer, 244 runs, 0 unmapped glyphs) covers first to last line and excludes composer/disclaimer. |

## Decisions log
| Date | Decision | Why |
| --- | --- | --- |
| 2026-10-22 | Rename away from "Page Archive" (owner search found "Archive Page", featured, at the top) | Confusing next to a featured extension; candidates to check: Tallshot, Pagestack |
| 2026-10-22 | Claude Code reviews the store/privacy drafts against the code; owner signs off on facts only | Owner asked; texts verified line by line against manifest and storage keys |
| 2026-10-22 | Small landing site (own public repo or Vercel), after the name is chosen | Owner: "we can make a small site"; main repo stays private |
| 2026-10-22 | Start Phase 2 before Phase 1 is complete | Owner request; only store prep that does not depend on Phase 1 results or the Reddit gate |
| 2026-10-22 | Review prompt link built from the extension's own store id | No hard-coded URL to update after publishing; opens a tab only on click |
| 2026-10-22 | Keep Claude's Progress/Outputs card in captures | Owner: it is on screen and covers no messages |
| 2026-10-22 | Real-site chats: test only sites the owner has accounts for (ChatGPT, Claude, Gemini; Perplexity without login) | No accounts elsewhere; untested sites are listed as such, not claimed |
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
- Real-site matrix runs (Phase 1): DeepSeek fix, Notion, Colab, itch.io, Reddit/X, a dashboard, DevTools open, chrome://extensions, then the main rows on Lite.
- PRIVACY.md, docs/store/permissions.md, docs/store/listing.md: drafts to review (contact line, names).
- Popup shows the requested file name ("Generative AI Learning Plan.png") when Chrome saved it as "... (3).png" on a name clash. Cosmetic honesty issue; fix later (use the final name from chrome.downloads).
- popup-shot: the capturing/done states show the "browser pages" banner and a
  disabled capture button; harness artifact (the popup is opened as an
  extension page, which the popup treats as a browser page). Real popup on
  real sites shows no banner (confirmed in owner screenshots).
