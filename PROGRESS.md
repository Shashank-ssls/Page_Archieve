# PROGRESS.md

Update this at the end of every phase. Newest entries at the top of each section.

## Current status
- Version: 2.4.0 (on GitHub: Shashank-ssls/Page_Archieve, private).
- Phase 4 (Share-safe Redact): DONE on 2026-10-24, except on-device name
  detection (skipped, see below). Phase 3 (Living PDF): built and hardened.
- NEXT: Phase 5, Licensing and Pro gating (see "Next phase" below). Start it in
  a new session.
- Store launch (old Phase 2) is the final phase (owner decision). Lite
  real-site repeats and the Lite E2E suite wait until Full is final.
- Last green run (Windows, GEHRMAN_SPARROW, 2026-10-24): `npm run check`
  148/148, `npm run e2e` 50/50 (Full). Lite suite not run (paused by owner).
- Not yet verified: HiDPI screens; real sites other than Claude, ChatGPT,
  Stripe docs, GitHub, Amizone, FreeRedact and Testaroo.

## Next phase: Phase 5 - Licensing and Pro gating (ROADMAP.md)
Goal: turn on paid Pro without breaking the local-only promise.
1. Owner first: open a payment provider account (Dodo Payments preferred:
   merchant of record, INR payouts, license-key API). Confirm fees and payout.
   Without the provider's license API, build against a stub and mark the real
   endpoint [VERIFY ON FIRST RUN].
2. License entry in the popup: paste key, verify online once, cache the
   result in chrome.storage.local, re-check every 30 days with a 14-day
   offline grace. Offline use keeps working.
3. Gating per PRODUCT.md. Pro: Living PDF (links, bookmarks), Share-safe
   Redact, Scroll Reel without watermark (Phase 6), later Library, Breakpoint
   Board, Proof Stamp. Free keeps full-page capture, presets, auto-expand,
   PNG, PDF with text layer, naming and folders. A locked feature shows a
   clear upgrade card, never a broken or silently disabled button.
4. The license check is the ONLY new network call: it needs the owner's
   approval, a host permission decision (permissions are frozen: ask first),
   and a PRIVACY.md line. No page content is ever sent.
5. Refund policy and terms pages (drafts for the owner).
Acceptance: a test key unlocks Pro, a revoked key locks it after the grace
period, offline use keeps working. Decide with the owner before coding:
- Keep PDF links and bookmarks free, or gate them as Pro?
- Does Lite get Pro at all (Redact needs Full render's text map)?
- Where the license UI sits in the popup.

## Skipped or deferred (with reasons)
- Phase 4: names via Chrome's on-device Prompt API. Skipped: the owner's GTX
  1650 (4 GB) cannot run it, so it cannot be tested here. Click-a-word in the
  review covers names by hand. Revisit on capable hardware.
- Lite edition: real-site repeats and `npm run e2e:lite` paused until Full is
  final (owner, 2026-10-23). Lite then gets one full pass.
- ChatGPT document preview: Redact cannot read text drawn in canvases (it now
  warns); that capture also started at page 2. Not investigated.
- Review screen left open many minutes: cannot be verified by the harness.
  A 5.5-minute E2E hold passed even with the keep-alive ping disabled
  (Playwright's attachment keeps the worker alive), so the case was dropped.
  Owner check on a real Chrome [VERIFY ON FIRST RUN].
- Small scroll boxes inside a message (for example Claude's email draft card)
  are captured as shown: only their visible part, the rest is cut. Seen in
  the owner's Claude PDF, 2026-10-25. Not investigated.
- Store launch items: trademark search for "Tallshot" (IP India, USPTO),
  PRIVACY.md and docs/store drafts review, landing site. Final phase.
- Removed on purpose (owner): JPEG output, PDF cover page option.

## Session summary (2026-10-24): Phase 4 Share-safe Redact and Claude redesign
Built:
- Redact: redact.js detectors (email, phone, card with Luhn, IBAN mod 97,
  keys by prefix and entropy with mixed case, IPv4/IPv6, token URLs, word
  list). Detection reads whole visual lines across elements (Stripe tables),
  form field values, and wrapped words (shadow runs). Boxes are burned before
  encoding; the final boxes strip words from the PDF text, links, bookmarks,
  title and file name. Text-blind paths (stitch, Lite, Chrome PDF viewer)
  refuse instead of saving secrets.
- Review screen in the assembly tab: click a box to keep it, click a word to
  hide it everywhere, drag to cover anything, then Save or Cancel.
- Redact works with Visible area only.
- Popup: Redact card on the main screen; More options split into Page,
  Saving (one line plus Change) and Advanced.
- Capture fixes: Document on app shells captures the panel; a rebuilt
  scroller is followed; expand clicks never touch nav, aside or menus
  (Claude's sidebar "Show more" navigated to Recents); an address change
  stops the capture; Chrome PDF viewer refused; drawn areas warned.
- Removed: JPEG output, PDF cover page and its writer.
Owner-confirmed: Claude incognito and ChatGPT Smart PNG/PDF; redesigned
Claude Smart PNG (7 parts) and PDF (37 pages, 42 bookmarks); Stripe card
tables fully redacted.

## Phase log
| Date | Phase | Result | Notes |
| --- | --- | --- | --- |
| 2026-10-25 | Skipped items | Partly done | Popup shows the name Chrome really saved ("name (3).png"); geometry savedLeaf, unit-tested. Review keep-alive: harness cannot prove it (control run without the ping also passed), left for the owner. New item: inner scroll boxes in messages captured cut. check green, e2e 50/50. |
| 2026-10-25 | Phase 3 viewer check | Done (Chrome) | Owner, Chrome PDF viewer: bookmarks sidebar shows the heading tree, outside links open, in-page links jump, text copies cleanly, Ctrl+F finds words (ARPANET 1/75). Claude PDF: 42 bookmarks. Page breaks checked by Claude from the page images of both PDFs (20 and 33 pages): every break falls between text lines; only tall images may split. Acrobat not installed, dropped. Also: Full page now switched off up front on PDF viewer tabs (owner). |
| 2026-10-24 | Phase 4 complete | Done | Visible-area Redact, line-level detection, click-a-word, rebuilt-scroller follow, sidebar expand guard, address-change stop, Saving collapsed. Owner confirmed Claude and Stripe. Prompt API names skipped (hardware). |
| 2026-10-24 | Phase 4 part 2 (2.4.0) | Done | Review screen, popup regrouped (Redact on the main screen; Page / Saving / Advanced), cover writer removed, version 2.4.0. |
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
| 2026-10-24 | Remove JPEG output and the PDF cover page | Owner: JPEG blurs text when zoomed; cover page not useful |
| 2026-10-24 | Redact always shows a review screen; click a word hides it everywhere | Patterns cannot cover every site; owner wants it to work almost universally |
| 2026-10-24 | Keep the 2.4.0 Redact card in the popup | Owner preferred it over a segmented row |
| 2026-10-24 | Skip Prompt API name detection | Owner GPU cannot run it; untestable |
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
- Phase 5 prerequisites: payment provider account and fees; approve the one
  license-check network call; answer the three gating questions above.
- Optional: open one captured PDF in Firefox (a second PDF engine). Acrobat
  is not installed and is no longer required.
- Review screen: turn on Redact, capture, leave the review tab open 6
  minutes, then Save. Pass if the file saves.
- Save the same page twice: the popup should show "name (1).png" the second
  time [VERIFY ON FIRST RUN].
- Full page switched off on Chrome PDF viewer tabs when the popup opens:
  unit-tested only, confirm once on a real PDF tab [VERIFY ON FIRST RUN].
- Optional rechecks: ChatGPT and Claude Document + PDF; Amizone with Redact
  (word box plus a drawn box over the photo); review tab left open 3-5 min.
- Trademark search for "Tallshot"; PRIVACY.md and docs/store drafts review.
- popup-shot shows the "browser pages" banner in captured states: harness
  artifact, not a bug (the real popup shows none).
