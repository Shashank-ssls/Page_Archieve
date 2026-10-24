# ROADMAP.md - from v2.3 to a paid product

Work one phase at a time. Each phase ends green (`npm run check`, `npm run e2e`,
`npm run e2e:lite`), with `PROGRESS.md` updated, committed and pushed, then STOP
for the owner's review. Phases marked GATE need a business result before the
next phase starts; if a gate fails, stop and discuss, do not push on.

Effort estimates are for evenings alongside college work.

---

## Phase 0 - Repo and environment gate (1 session)

Goal: the project builds and tests on GEHRMAN_SPARROW, backed up on GitHub.

- [ ] `git init`, first commit of v2.3 as delivered, create the private repo
      `Shashank-ssls/page-archive`, push.
- [ ] Confirm npm prefix and cache are on F:, then `npm install` and
      `npm run browsers`. Confirm Chromium is inside `.local\ms-playwright`
      in the project folder.
- [ ] `npm run check` green on Windows.
- [ ] `npm run e2e` and `npm run e2e:lite` green on Windows. Windows paths,
      line endings and download locations are the likely trouble spots.
- [ ] `npm run popup-shot` works; look at the images.
- [ ] Chrome DevTools MCP can attach to the dedicated test Chrome profile
      (see TESTING.md section 4) and take a screenshot of any page.

Acceptance: all boxes ticked, any Windows-only fixes committed with tests.

---

## Phase 1 - Real-site validation (1 to 2 weeks, owner-assisted)

Goal: v2.3 works on the sites people actually use.

- [ ] Run the real-site matrix in TESTING.md section 5 with the owner, using the
      dedicated test profile (he logs in; Claude Code never handles credentials).
- [ ] For each failure: write a minimal local fixture that reproduces it, add it
      to `tests/e2e/suite.json`, fix, re-run the matrix row.
- [ ] Verify site presets on the real ChatGPT, Claude, Gemini, Perplexity, Colab
      DOMs; update markers where needed (stable attributes only).
- [ ] Record results in `PROGRESS.md` (site, edition, result, notes). Never
      commit real captures.

Acceptance: every matrix row passes or has a documented, honest limitation.

OWNER TASK before the final phase: record a 20-second before/after clip of a long Claude
or ChatGPT thread and post it (r/ChatGPT, r/ClaudeAI, X).
GATE: 50+ upvotes or several "link?" replies. If not, revisit the pitch first.

---

## Phase 3 - Living PDF (Pro) (1 week)

- [x] Clickable links: PDF Link annotations from anchor rectangles in the
      captured region (collect `href` and rects alongside text runs).
- [x] Outline (bookmarks): one per heading (h1-h3) or, with a chat preset, one
      per conversation turn.
- [x] Optional cover page: title, URL, capture date/time, SHA-256 of the images.
- [x] Unit tests for the PDF structure; E2E case checks links with a PDF parser
      or `pdftotext`-equivalent available on Windows [VERIFY ON FIRST RUN].

Acceptance: a captured long article and a captured chat open in Chrome's PDF
viewer and Acrobat Reader with working links, bookmarks and selectable text.

---

## Phase 4 - Share-safe Redact (Pro) (1.5 weeks) - DONE 2026-10-24

- [x] Detectors over the collected text runs: emails, phone numbers, card
      numbers (Luhn), IBANs, API keys and tokens (common prefixes plus entropy),
      IP addresses, URLs with tokens in query strings.
- [x] Optional user word list ("always redact these names").
- [x] Preview screen: boxes over the capture, click to toggle each, add a box by drag.
- [x] Redaction burned into pixels AND removed from the PDF text layer; test that
      redacted words are absent from the PDF bytes.
- [ ] (Skipped 2026-10-24, untestable on this GPU) Names via Chrome's on-device Prompt API only when available; the owner's
      GPU cannot run it, so feature-detect and hide gracefully.

Acceptance: a fixture with seeded secrets produces outputs where none of the
seeded strings appear in pixels (visual check) or in the PDF text.

---

## Phase 5 - Licensing and Pro gating (1 week)

- [ ] Payment provider account (owner): Dodo Payments recommended; confirm fees,
      INR payout and license-key API.
- [ ] License entry in the popup; verify once online, cache result, re-check every
      30 days with a 14-day offline grace period.
- [ ] Free vs Pro gating per PRODUCT.md; Pro features show a clear upgrade card,
      never a broken button.
- [ ] Refund policy and terms pages.
- [ ] The license check is the only new network call: document it in PRIVACY.md.

Acceptance: a test key unlocks Pro, a revoked key locks it after the grace
period, offline use keeps working.

---

## Phase 6 - Scroll Reel (Free with watermark, Pro without) (1.5 weeks)

- [ ] Render the capture into a 1080x1920 (and 1080x1350) vertical video that
      scrolls smoothly; optional pauses on highlighted lines.
- [ ] Encode locally with WebCodecs (H.264) and a small vendored MP4 muxer;
      license in THIRD_PARTY_NOTICES.md (owner approves the library).
- [ ] Free: small corner watermark "made with Page Archive". Pro: none.
- [ ] Progress UI and cancel; memory stays bounded on 20,000 px captures.

Acceptance: a 60-message chat becomes a playable MP4 under 60 seconds on the
owner's laptop; the file plays on Android and in X/Instagram uploads [VERIFY ON FIRST RUN].

---

## Phase 7 - Pro launch (1 week)

- [ ] Version 3.0.0, store listing update, landing page pricing section
      ($19 launch price for the first 500, then $29; about INR 499 regionally).
- [ ] Launch posts: Product Hunt, Show HN, Indie Hackers, the subreddits.
- [ ] Support email and FAQ live.

---

## Final phase - Store launch (was Phase 2; moved last by the owner, 2026-10-22)

The owner held the store launch until the product is complete, so Phases 3-7
run before it. Work already done here stays done. Phase 7 store and launch
items are done together with this phase.

Goal: Lite public on Chrome and Edge stores, Full available unlisted.

- [x] Rename decision recorded: Tallshot (2026-10-22). "Page Archive" clashed with
      a featured "Archive Page". User-visible names updated; internal ids kept.
- [ ] (PRIVACY.md drafted 2026-10-22; web page pending) `PRIVACY.md` and a matching web page: local-only, the exact network calls,
      what is stored locally, how to delete it.
- [x] Permission justification text for each permission, for the store form (docs/store/permissions.md, draft).
- [ ] (copy drafted in docs/store/listing.md; assets pending) Store listing copy (no competitor names), 5 screenshots at 1280x800, a
      440x280 promo tile, all in the DESIGN.md style.
- [x] One-time rating prompt after the 3rd successful capture, dismissible, never repeated.
- [ ] Simple landing page (GitHub Pages is fine) in the DESIGN.md style, with the
      before/after clip, install links and the privacy page.
- [ ] (zips: `npm run package`; version bump at release) `npm run build` output zipped per edition; version 2.4.0.

Acceptance: both zips pass the store's automated checks; listings ready to submit.
GATE (2 to 3 weeks after publishing): 200 installs and at least 40% still active
after one week (store dashboard). If not, stop and review positioning.

---

## Backlog (after launch, in the order buyers ask)

- Capture Library: local history with thumbnails, tags and full-text search
  (OPFS + IndexedDB, inverted index over text runs).
- Breakpoint Board: desktop/tablet/phone captures with real device emulation,
  laid out on one board.
- Proof Stamp: SHA-256 + RFC 3161 timestamp (only the hash leaves the device) +
  a static verifier page.
- Firefox port of Lite (no debugger API there).
- AI cover page via Chrome's Summarizer API (hardware-gated; cannot be tested on
  the owner's GPU).
