# PROGRESS.md

Update this at the end of every phase. Newest entries at the top of each section.

## Current status
- Version: 2.3.0 (on GitHub: Shashank-ssls/Page_Archieve, private)
- Current phase: Phase 4 (Share-safe Redact) in progress, started 2026-10-24 on the
  owner's request. Done: detectors, word list, pixel burn, PDF text removal,
  fail-closed fallbacks. Left: preview screen (toggle boxes, drag to add),
  on-device name detection (feature-detected; cannot be tested here).
  Phase 3 (Living PDF) is built and hardened; viewer check still pending.
  Store launch (old Phase 2) moved to the final phase by the owner; its finished
  parts stay done. Lite real-site repeats deferred until Full is final.
- Last green run (Windows, GEHRMAN_SPARROW, 2026-10-24, Document switches to the panel on app shells): `npm run check` 139/139,
  `npm run e2e` 40/40 (Full). Lite suite paused until Full is final.
- Not yet verified: any real logged-in site, HiDPI screens.

## Session summary (2026-10-23): Claude incognito and "Show more"
Planned start of Phase 4 (Share-safe Redact) was paused: the owner's captures
of Claude incognito chats and a long Claude thread showed capture bugs, and
incognito chats are a key use case (they are not saved by the chat app).
Diagnosis used read-only console snippets the owner ran on the live pages.

Fixed (commits 42d7853, 5b29aca, 63bb78d):
- "Show more" in long user messages stayed collapsed. Claude keeps about 5
  turns in the DOM, so the expand pass at preparation missed most buttons.
  The render settle step now clicks newly mounted expand buttons again (cap
  80 per capture); panel growth allows 20 rounds. Fixture virtual-showmore.
- End-spacer rule: first changed to keep long runs of empty boxes (virtual
  list rows), which regressed Claude (its list ends in 3 empty boxes; the
  spacer grew to Max height, 199,279 px trimmed). Now a run is hidden when any
  box has min-height or flex-grow, as Claude's spacer does.
- Incognito Smart PDF fell back to scroll-and-stitch ("panel could not be
  fully exposed, overflow 2159px"): the shell height is
  calc(var(--app-visual-viewport-height, 100dvh) - ...), set once by a script.
  Script-set ancestor heights now follow the viewport during render, capped at
  the viewport. Fixture script-vh-shell. Not yet confirmed on the real page.
- Document target on an app shell now warns how much a scroll panel hides
  (clipped text never counted as ink). E2E case doc-panel-hidden.

Tried and reverted: pinning the panel with flex: none (broke virtual-showmore).
Process: CLAUDE.md now says run only the Full E2E suite until Full is final.
Open: incognito Smart recapture; blurry incognito Document PDF (19 KB, maybe
DevTools device toolbar); long-thread recapture. Then Phase 4.

## Phase log
| Date | Phase | Result | Notes |
| --- | --- | --- | --- |
| 2026-10-24 | Phase 4 part 1 | Done | Share-safe Redact: detectors (redact.js), word list, black boxes burned before encoding, words removed from the PDF text, links/bookmarks/cover/file name scrubbed, no fallback to text-blind engines. E2E redact-png, redact-pdf; a control run without Redact fails both checks. |
| 2026-10-24 | Phase 3 hardening 5 | Done | Document on app shells (Claude, ChatGPT) captured one screen; it now captures the scroll panel with a warning. File-name UI made self-explanatory. |
| 2026-10-23 | Phase 3 hardening 4 | Done | Claude incognito: the app height comes from a script variable that does not follow the viewport, so Full render could not grow the panel (fell back to stitch). Script-set ancestor heights now follow the viewport during render. End-spacer regression from hardening 3 fixed. |
| 2026-10-23 | Phase 3 hardening 3 | Done | Owner: long Claude thread kept "Show more" collapsed (virtualised turns mount late; expand now repeats during render). End-spacer rule no longer drops a virtual list's unmounted rows. Incognito Document PDF now warns that a panel hides content. Incognito Smart PDF (one screen) not reproduced yet. |
| 2026-10-22 | Phase 3 hardening 2 | Done | Owner recaptures: Smart PNG and PDF clean (no blank bands, 30 A4 pages, 42 bookmarks). Document PDF cut to one screen (regression from clipped ink) fixed with an extent measure; Document mode now warns when content lives in a panel. Earlier 12-blank-page PDF re-diagnosed as Smart (panel) and covered by a panel backstop. Claude message box left in captures: floating hide cap of 60 was reached; raised to 400 with examples in the warning. |
| 2026-10-22 | Phase 3 hardening | Done | Owner's Claude capture (Target Document): PDF had 12 blank pages (window-sized end spacer chased to Max height) and PNG part 1 had 6,100 px unpainted (Chrome returned the chunk before painting). Fixed both (end-spacer guard in document grow, paint check with retry then stitch fallback). PDF now paged A4-style with breaks between lines; clipped text excluded; cover hash list unlimited. |
| 2026-10-22 | Phase 3 | Built, green | Links (URI + same-page), bookmarks (headings or one per chat prompt), optional cover page with per-page SHA-256. E2E checks the PDF objects directly (no pdftotext on Windows). Opened in Chrome PDF viewer: cover renders. Acrobat and real sites not yet checked [VERIFY ON FIRST RUN]. Not Pro-gated yet (Phase 5). |
| 2026-10-22 | Phase 1 | Done (Full) | All Full rows pass after fixes; Lite rows deferred. Store launch moved to the final phase. Report: docs/sessions/2026-10-22-phase0-1.md |
| 2026-10-22 | Phase 0 | Done | git init + .gitattributes (LF). Chromium in .local/ms-playwright, nothing written to C:. chrome-devtools MCP attached to the test Chrome (example.com screenshot). Pushed with plain git (no gh). |
| 2026-10-22 | v2.3 delivered | Done | Editions, site presets, searchable PDF, auto-expand, naming. |

## Real-site results (Phase 1)
| Date | Site | Edition | Result | Notes |
| --- | --- | --- | --- | --- |
| 2026-10-23 | Claude recapture 3: Smart PNG and PDF | Full | Pass | 7 PNG parts and a 30-page PDF (17 links, 42 bookmarks), no blank bands, message box hidden (100 floating elements: sidebar, icons). Remaining ~280 px end strip now trimmed. |
| 2026-10-22 | Claude recapture: Smart PNG, Smart PDF, Document PDF | Full | Smart pass; Document fixed | Smart: 7 PNG parts and a 30-page PDF, complete, no blank bands; message box still at the end (fixed, recapture needed). Document: one screen (fixed: now explained by a warning, Smart/Panel is the right target for Claude). |
| 2026-10-22 | Claude long thread, PDF (Smart) and PNG | Full | Fail, fixed | PDF: 19 pages, 12 blank, false Max height warning. PNG: part 1 blank from 2,079 to 8,190 px (first render chunk unpainted). Recapture needed [VERIFY ON FIRST RUN]. |
| 2026-10-22 | DeepSeek chat | Full | Pass (after 3 fixes) | Recapture (build 1022-1902): clean, composer gone, no scrollbar strip. Fixed: stitch kept floating UI on the first tile; false "clipped 5103px" from a 0px overflow:hidden body around the absolute app layer (fixture abs-shell). |
| 2026-10-22 | YouTube watch page | Full | Pass (popup fix) | 1 PNG: player frame, description, 244 comments, recommendations column. Popup was widened by a long image URL in a warning (fixed). Slow on a heavy page (127 images), expected. |
| 2026-10-22 | Colab recapture | Full | Pass | 2 PNG parts; shadow-DOM fix holds, 2 floating elements hidden instead of 60. |
| 2026-10-22 | Dashboard (Amizone), Smart and Document | Full | Pass | 1 PNG each. Smart hides a fixed bottom-right notice; Document keeps it as on screen. |
| 2026-10-22 | Notion page | Full | Fail, fixed | 6 PNG parts, parts 5-6 blank: inline padding-bottom 30vh grew with the viewport. Recapture needed. |
| 2026-10-22 | Notion recapture | Full | Pass | 4 PNG parts (was 6); ends right after the last image and caption with only the on-screen 30vh padding. |
| 2026-10-22 | chrome://extensions, Visible area | Full | Pass | Popup greys out full-page capture (Chrome hides the URL); Visible area PNG correct. |
| 2026-10-22 | Google Colab notebook | Full | Pass (after fix) | 2 parts, all cells, outputs, tables and charts. "Hid 60 floating elements": Colab's own run buttons and toggles (shadow DOM) were wrongly hidden; fixed (fixture shadow-cells). |
| 2026-10-22 | DevTools open (Miruro; ChatGPT share page with device toolbar) | Full | Pass | Full render still worked with DevTools docked (Chrome allows several debugger clients); captures match the emulated layout. TESTING.md expectation updated. |
| 2026-10-22 | itch.io game page (Rulehouse) | Full | Pass | 2 parts, background art once at the top, comments and devlog complete, 1 folded section expanded. Honest note: some CSS assets unverified. |
| 2026-10-22 | Higgsfield blog (Zombie dog prompts) | Full | Pass | 2 parts, 13 "show more" expanded, images and comments present, sticky table of contents once. |
| 2026-10-22 | Reddit thread (r/cyberpunkgame) | Full | Pass | 1 PNG, post, comments (folded sections expanded), sidebars once, reCAPTCHA badge hidden. Honest notes: image time budget and audit limit reached. |
| 2026-10-22 | Vercel article (All my prompts) | Full | Pass | 3 parts, 39 images, sticky header and table of contents once, toast hidden. |
| 2026-10-22 | Chrome Web Store page | Full | Fixed | Capture attempt failed with a confusing double message; store pages are now blocked up front like chrome:// pages. |
| 2026-10-22 | Perplexity | - | Skipped | Thread locked behind sign-in; owner has no account. |
| 2026-10-22 | Gemini long thread with code (DPR 1.2) | Full | Pass (after 2 fixes) | First run: Full render failed (last turn's min-height = panel height - 112) and fell back to stitch with an honest warning. After fix (build 1022-1620): 3 parts, first message to last reply, no blank end. Remaining: "Scroll to bottom" button once at the end; fixed (build 1022-1635), recapture shows it gone. |
| 2026-10-22 | Claude long thread, artifact open (DPR 1.2) | Full | Pass | Conversation only, all turns, composer hidden, header once, seams clean (3 PNG parts); PDF 3 pages, 1,161 runs, 0 unmapped (starts with Claude's hidden screen-reader hint, harmless). Second run had the Progress/Outputs side panel open: kept once at the top, overlaps no text (owner to decide if it should be hidden). With an artifact open (split view): chat column only, artifact excluded, all turns, but ~13,600 px blank at the end (Claude's end spacer is sized to the viewport); fixed; recapture (build 1022-1553) ends about 280 px below the last reply, 2 parts, artifact excluded. |
| 2026-10-22 | Wikipedia, History of the Internet (DPR 1.2) | Full | Pass | PNG: 5 parts, header once, images present, 4 part seams continuous. PDF: 5 pages, 7,587 text runs, 0 unmapped, "Jump to content" to "Mobile view". Honest warnings: image time budget reached, 1 image incomplete once. |
| 2026-10-22 | ChatGPT thread (DPR 1.2) | Full | Pass (after 3 fixes) | All turns, images, no sidebar, no composer/disclaimer, no seams (recapture 3). Fixed: white seam at fractional DPR; outdated preset markers + hidden thread copies; composer and disclaimer inside the scroller. Cosmetic: ~76 px blank band at the end (ChatGPT reserved composer space). PDF (1 page, invisible Unicode text layer, 244 runs, 0 unmapped glyphs) covers first to last line and excludes composer/disclaimer. |

## Decisions log
| Date | Decision | Why |
| --- | --- | --- |
| 2026-10-23 | Run only the Full E2E suite until Full is final; finalize Lite afterwards in one pass | Owner: complete Full first; never run both suites together |
| 2026-10-22 | Product name: Tallshot (Full edition "Tallshot Full", Lite "Tallshot") | "Page Archive" sat next to a featured "Archive Page"; "Stackshot" and "Unscroll" are taken. Only user-visible strings changed; storage keys, data attributes, folder and repo names stay |
| 2026-10-22 | Lite real-site testing deferred to the end | Owner tests Lite once Full is final, to avoid repeat work. Lite still runs in the E2E harness |
| 2026-10-22 | Store launch (old Phase 2) moved to the final phase | Owner wants to launch once, with the product complete. Phases 3-7 run first. The Phase 1 social-post gate and the install gate are deferred with it, so Pro is built before demand is measured |
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
- Owner recapture 2026-10-24: Claude incognito Smart PNG and Smart PDF good; ChatGPT Smart PNG and PDF good. Document + PDF saved one screen on both; fixed (Document now captures the panel on app shells, with a warning). Recapture Document + PDF on both [VERIFY ON FIRST RUN].
- Owner Redact test on Testaroo 2026-10-24: wrapped footer email half-boxed and two file names over-redacted; both fixed. Cover page option removed (owner decision).
- Owner Redact tests 2026-10-24 (FreeRedact page, Chrome PDF viewer, ChatGPT document preview): web page partly redacted (emails, phone, key; name and account ID need the word list or the preview screen; SHA-256 hashes over-redacted as keys). Chrome PDF viewer now refused; drawn previews now warned. ChatGPT preview capture also missed its first page [VERIFY ON FIRST RUN, not yet investigated]. Next: the preview screen.
- Owner Redact test on Amizone (2026-10-24): form field values (mobile, email, address) were missed; fixed. Still not detected by design: names, enrollment numbers, dates of birth and photos. Use the word list for the name and ID until the preview screen (drag to add a box) exists. Retest on Amizone [VERIFY ON FIRST RUN].
- Owner Document + PDF recapture on Claude: full chat, fixed.
- JPEG removed (owner decision 2026-10-24).
- Phase 4: try Share-safe Redact on a real page with an email or key (PNG and PDF); boxes cover the words, PDF search finds nothing [VERIFY ON FIRST RUN].
- Phase 4 decision: Redact is in the Full edition with no Pro gate yet; gating comes in Phase 5.
- Popup file-name section reworded, tokens clickable, preview shows the real tab; check it reads clearly.
- Long Claude thread: recapture (single PNG and parts); long user messages expanded, no 199,279 px end-spacer warning [VERIFY ON FIRST RUN].
- Claude incognito Document PDF (Claude (3).pdf) was blurry at 19 KB; recapture with DevTools closed and send it if still blurry.
- Phase 3: Claude Smart recapture passed (message box gone, examples are UI only). Optional: one more capture to confirm the ~280 px end strip is gone [VERIFY ON FIRST RUN].
- Phase 3: open a captured long article and a captured chat PDF (with cover page) in Chrome and Acrobat Reader; links open, bookmarks jump, text selects [VERIFY ON FIRST RUN].
- Trademark search for "Tallshot" (IP India, USPTO) before publishing.
- Payment provider account and fees.
- Phase 1 Full rows complete (2026-10-22). Lite real-site repeats deferred until Full is final (owner decision).
- PRIVACY.md, docs/store/permissions.md, docs/store/listing.md: drafts to review (contact line, names).
- Popup shows the requested file name ("Generative AI Learning Plan.png") when Chrome saved it as "... (3).png" on a name clash. Cosmetic honesty issue; fix later (use the final name from chrome.downloads).
- popup-shot: the capturing/done states show the "browser pages" banner and a
  disabled capture button; harness artifact (the popup is opened as an
  extension page, which the popup treats as a browser page). Real popup on
  real sites shows no banner (confirmed in owner screenshots).
