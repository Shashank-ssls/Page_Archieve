# WORKFLOW.md (v2) - Keeping Tallshot working after launch

This is the owner's operating manual. Chat sites like ChatGPT, Claude,
Gemini, Perplexity and DeepSeek change their page code often. This file
explains how to notice breakage early, hear about it from users, fix it,
and ship the fix, without breaking the rules in `CLAUDE.md` section 2.

v2 (2026-10-29) applies three research reports: DOM resilience, Chrome Web
Store (CWS) release facts, and a workflow audit.

Every item is labelled:

- **[EXISTS]** - in the repo and working today.
- **[TO BUILD]** - planned, not built. Goes through `ROADMAP.md` (most of it
  is Phase 5, "Keep-alive and launch-readiness hardening").
- **[VERIFY ON FIRST RUN]** - not tested here, or a store detail that may
  have changed. Check it before relying on it.

---

## 0. Minimum viable workflow

You are one person with exams. Do not build everything at once.

**Must have before launch:**

- [ ] Detection layering with postcondition check and warning codes (sec 3).
- [ ] Zero-turn bookmark warning (sec 3).
- [ ] Lite edition: one full pass (`npm run e2e:lite` plus a manual check).
- [ ] `npm run release-check` covering both editions (sec 8).
- [ ] Report a problem (Copy / Email / GitHub issue) (sec 5).
- [ ] Support email and support repo created (sec 5.2).
- [ ] Known Issues page drafted and hosted (sec 6).
- [ ] RESTORE.md, 2FA backup codes stored, hotfix cheat sheet (sec 13).
- [ ] The "Friday 3" weekly check, done by hand (sec 8).

**After launch (when there are users):**

- Canary on public share links (sec 4).
- Structural fingerprints and selector-count diffs.
- Edge Add-ons listing.
- Rating prompt (if decided).

---

## 1. The rules that never bend

These come from `CLAUDE.md`. Every idea here was checked against them.

1. Local-only. No backend, no analytics, no telemetry, no remote code.
2. The only planned network call is the Pro license check (later: a
   SHA-256 hash to a timestamp authority for Proof Stamp). Anything else
   needs your approval and a line in the privacy policy.
3. Permissions are frozen. Adding one makes Chrome disable the extension for
   existing users until they accept it. Treat that as a disaster. So any
   host permission the license check needs must be in the v1 manifest
   (see sec 16).
4. Never a silent downgrade, never export a known-broken image, always
   restore the page.
5. No private APIs. Many chat exporters stopped reading the page and now
   call private endpoints (for example Claude
   `/api/organizations/.../chat_conversations`, Copilot
   `/c/api/conversations/.../history`) or intercept `fetch`. Tallshot must
   NOT do this. It breaks the network rule and depends on private APIs.
   Tallshot captures pixels, so it only needs the scroll panel and the turns.
6. Every fix, even one selector, is a new version through store review.

Consequence: we cannot push a fix from a server. Speed comes from (a)
noticing early, (b) a tested hotfix routine, (c) code that degrades
gracefully, and (d) rollback for a bad release (sec 9).

---

## 2. How site support works today [EXISTS]

- `content.js` has `SITE_PRESETS`: one entry per chat site, with selectors
  for the conversation area and for turns (used for PDF bookmarks).
- Fixed in 2.5.0: when a known site's markers stop matching, Tallshot now
  warns ("did not recognise this <site> page layout") and uses automatic
  panel detection (`detectPreset` `unmatched`). It is no longer silent.
- Under the presets is a generic detector (semantic tags plus geometry
  scoring). This is the real safety net.
- Still missing [TO BUILD]:
  - Zero turns found -> PDF bookmarks vanish with no warning.
  - Warning codes (`W_*`).
  - Recording which detection layer won.
- Tests: unit tests (`npm run check`), real-browser E2E on local fixtures
  (`npm run e2e`, `npm run e2e:lite`), manual real-site matrix in
  `TESTING.md`.

Risk per site (2026-10):

| Site | Matches on | Risk |
| --- | --- | --- |
| ChatGPT | `data-*` attributes | medium |
| Claude | `data-testid`, font classes | medium-high |
| Gemini | custom tags, `data-test-id` | high (changes very often) |
| Perplexity | `.prose` class today | high |
| DeepSeek | generated classes | high |
| Copilot | `cib-*` tags | dead (UI redesigned Mar 2025); drop |

Plan for a fix on SOME site every 1-2 months. One Gemini exporter
(Gemini2Markdown) needed about 7 DOM fixes in 6 months, 3 in one week.

---

## 3. Making detection harder to break [TO BUILD]

### 3.1 Layers (in this order)

1. **`data-*` anchors** from the preset. The preset only has to find the
   FIRST turn.
2. **Structure and geometry.** Find the scroller: the first ancestor of a
   turn with `overflowY` auto or scroll and `scrollHeight - clientHeight >
   20`.
3. **Whole document.**

ARIA roles are weak on these sites. Do not rely on them as a layer.
Record which layer won.

### 3.2 Postcondition check

A selector that matches something is NOT success (lesson from Readability).
After detection, check:

- turn count >= 1;
- roles roughly alternate (user, assistant, user...);
- the composer / textarea is outside the target;
- the target is tall and scrollable.

If a check fails: warn with a code and fall through to the next layer.

### 3.3 Selector lists (best first)

- **ChatGPT:** `[data-message-author-role]` -> `[data-message-id]` ->
  `[data-testid^="conversation-turn"]`.
- **Claude:** `[data-testid="user-message"]` -> `.font-claude-response` ->
  `.font-claude-message` (last one probably stale) [VERIFY ON FIRST RUN].
- **Gemini:** custom tags, `[data-test-id="model-line"]`, hidden labels
  `.screen-reader-user-query-label` / `.screen-reader-model-response-label`.
- **Perplexity:** `data-testid` (`answer`, `copy-query-button`),
  `[data-pplx-citation-url]`.
- **DeepSeek:** `ds-*` classes, `[data-virtual-list-item-key]`,
  `[data-message-id]`.
- **Copilot:** drop `cib-message`. Use the generic detector plus a warning
  until checked on a live page.

### 3.4 Other rules

- Exclude page chrome by structure: `aside`, `nav`, `[role=navigation]`,
  `[role=banner]`, `textarea`, `[contenteditable]`, `[class*="sidebar" i]`.
- Never use UI text or `aria-label` strings as main anchors. They change
  with the user's language.
- Strip hidden screen-reader labels from the PDF text.
- Warnings, each with a code: layout not recognised (`W_PRESET_MISS`),
  zero turns ("Chapter bookmarks unavailable for this page"), postcondition
  failed. The layout warning links to the Known Issues page (sec 6).

### 3.5 Remote selector config: NO (product decision)

The store allows remote data if all logic is bundled. We still say no: it
is a new network call and weakens the local-only promise. That is our
choice, not a store ban.

---

## 4. The canary [TO BUILD, after launch]

The canary is NOT the first investment. Most Phase 1 bugs only showed in
the logged-in app (end spacers, composer, Show more, panel height). Share
pages do not have these. Do the manual Friday 3 first (sec 8).

When built:

- Runs on your laptop with Playwright Chromium and `--load-extension`
  (branded Chrome dropped that flag in 139).
- Public share links from a throwaway account. ChatGPT and Claude share
  links are snapshots and stay until deleted.
- ChatGPT is behind Cloudflare. Headed mode on your home connection works
  better [VERIFY ON FIRST RUN].
- Captcha or "verify you are human" = SKIPPED, never bypassed.
- List in `.local/canary-sites.json` (gitignored); template committed.
- Checks: expected preset and layer, start and end markers in the PDF
  text, bookmarks > 0, no composer text, image not blank, selector counts
  (a count dropping to zero is the early warning).
- Task Scheduler entry: "run only when user is logged on". It is a system
  change: Claude shows the command, you approve it.
- If the canary was skipped 2-3 weeks running, alert. Silence is not health.
- Share-page results are partial evidence only.

---

## 5. Hearing from users

### 5.1 Report a problem [TO BUILD]

- Builds a short report on the device and SHOWS it first.
- Contains: version, edition, Chrome version, OS, engine, fallback yes/no,
  warning codes, winning layer, page height bucket, error message.
- Hostname only if the user ticks a box (off by default).
- NEVER: page text, URL paths, titles, screenshots.
- User sends it: **Copy**, **Email** (mailto, under 1800 characters), or
  **Open GitHub issue** (prefilled). The user navigates; the extension makes
  no network call.
- PRIVACY.md line: "If you choose to report a problem, Tallshot shows you
  the report and you decide whether to send it by email or GitHub. Nothing
  is sent automatically."

### 5.2 Channels

| Channel | Use | Status |
| --- | --- | --- |
| Dedicated support email | Primary | [TO BUILD] |
| Public `tallshot-support` repo, issues only | Bug reports | [TO BUILD] |
| CWS reviews | Reply within 48 h | after launch |

A support repo under your personal handle shows your identity. Decide
first (sec 16). The main code repo stays private.

### 5.3 Canned replies

- **Ack:** "Thanks, I can see the problem. A fix is being prepared. Store
  review can take several days. Status: <Known Issues link>."
- **Fixed:** "Fixed in version X.Y.Z. Chrome updates extensions within
  about a day. To force it: chrome://extensions, Developer mode, Update."
- **Refused on purpose:** "Tallshot stopped instead of saving because the
  image would have been incomplete. It never saves a broken capture. You
  can try: ..."

### 5.4 Ratings [TO BUILD only if decided]

- Neutral prompt. Show "Rate" and "Report a problem" side by side, to
  everyone. The old "Not quite -> Report" idea is review gating. Do not
  build it.
- No rewards for reviews.

---

## 6. Telling users while a fix is in review [TO BUILD]

- A static Known Issues page (for example on the landing site or the
  support repo). Plain text: site, symptom, workaround, "fix submitted on
  <date>".
- The layout-mismatch warning shows a "Known issues" link. Clicking opens a
  tab. No fetch. The URL is one constant in the code.
- Update the page when you submit a fix and again when it is live.

---

## 7. Triage

| Level | Meaning | Response |
| --- | --- | --- |
| **P0** | Silent downgrade; broken image exported; page left modified; data loss; crash on a major site; **a secret survived Redact**; **license wrongly locks a paying user**; **a license or Dodo outage affects free features** | Same day: honest warning or refuse in the code path, or rollback if a release caused it. Fix ready in 72 h; live when review ends (often 5-10 days). |
| **P1** | ChatGPT, Claude or Gemini fails to capture | Known Issues entry same day; fix in its own release |
| **P2** | Mid site broken; wrong or missing warnings; bookmarks missing | Fixture + suite case; next release |
| **P3** | Obscure site, cosmetic | Known-limits list |

- 3 separate reports of the same thing: promote one level.
- Every P0-P2 gets a fixture in `tests/site-fixture/` and a case in
  `tests/e2e/suite.json` BEFORE the fix.
- Free features must never depend on the license server.

---

## 8. Cadences (realistic budget)

### Weekly "Friday 3" (about 10 minutes)

- [ ] ChatGPT, Claude, Gemini on your own accounts: one Smart capture each.
      Composer and sidebar not in the output; all turns present.
- [ ] One PDF: bookmarks present.
- [ ] One Redact on a page with a seeded fake secret (for example a fake
      "password: hunter2-test"). It must be boxed and gone from the PDF text.
- [ ] Glance at support email, issues, reviews.

### Monthly (about 1 hour)

- [ ] Early-warning signals (sec 10).
- [ ] 10-minute load + capture on current stable Chrome (E2E uses bundled
      Chromium, which can differ).
- [ ] CWS dashboard for policy emails.
- [ ] Known Issues and known-limits lists: close what is fixed.
- [ ] Check backups (sec 13).

### Before a major release

- [ ] Try it on Chrome Beta.
- [ ] Playwright version stays pinned; upgrade on purpose only.

### Per release [TO BUILD: `npm run release-check`]

The script does the mechanical steps:

- permission diff against the last tag, BOTH manifests;
- grep for new network calls (`fetch`, `XMLHttpRequest`, `WebSocket`,
  `sendBeacon`);
- version sync: `manifest.json`, Lite manifest, `package.json`;
- build both editions; check `manifest.json` is at each zip root.

You still do:

- [ ] `npm run check`, `npm run e2e`, `npm run e2e:lite` green.
- [ ] `npm run popup-shot` reviewed if UI changed.
- [ ] CHANGELOG and PROGRESS updated.
- [ ] Load both zips unpacked in a clean profile; one capture each.
- [ ] Commit, tag `vX.Y.Z`, push BEFORE submitting.

---

## 9. Releasing on the Chrome Web Store

Facts from 2026-10. All [VERIFY ON FIRST RUN] on your account.

- Review: a few days to a few weeks. New developers and powerful
  permissions get more scrutiny (docs do not name `debugger`). No expedite.
  Contact support after 3 weeks.
- **Rollback exists.** It republishes the previous version under a new
  higher version number, with no review, live in about a minute. It cancels
  pending and staged submissions. Test that the older version reads data
  saved by the newer one.
- **Staged rollout** needs more than 10,000 7-day active users. Not
  available at launch.
- **Defer publish:** use it every time. You must publish within 30 days of
  approval or it goes back to draft.
- Publishers start with 2 extension slots (fits Full + Lite).
- Versions: `MAJOR.MINOR.PATCH`; hotfix = PATCH + 1; always higher.
- Edge Add-ons: separate Partner Center, up to 7 business days review, no
  staged rollout. Lite first.

---

## 10. Early-warning signals (monthly)

Other people hit layout changes before you. Check:

- GitHub issues of open-source exporters, for example
  `pionxzh/chatgpt-exporter`.
- Greasy Fork changelog of Gemini2Markdown.
- Any similar exporter for Claude or DeepSeek you find.

A burst of "broken after update" issues means check that site now.

---

## 11. Hotfix playbook (P0 or P1)

1. [ ] Reproduce. Note site, Chrome version, what the output looked like.
2. [ ] If a release caused it: **rollback now** (sec 9). Then fix calmly.
3. [ ] Add a Known Issues entry.
4. [ ] `git checkout -b hotfix/<name>` from `main`.
5. [ ] Fixture: `npm run snapshot` if built; otherwise by hand: save the
       page DOM, cut it down to the panel and two turns, replace all text
       with lorem ipsum. Add a case to `tests/e2e/suite.json`. It must FAIL.
6. [ ] Fix at the narrowest layer. Do not loosen stitch tolerances.
       Quick option: disable the broken preset. Detection falls back to
       automatic, with a warning.
7. [ ] Unit test. `npm run check`, `npm run e2e`, `npm run e2e:lite` green.
8. [ ] Bump PATCH; `npm run release-check` green.
9. [ ] CHANGELOG, PROGRESS.
10. [ ] Load both built folders unpacked; capture the broken site once.
11. [ ] Merge, tag, push.
12. [ ] Upload BOTH editions with defer publish. Note: "bug fix, no
        permission changes".
13. [ ] When approved, publish. Update Known Issues.
14. [ ] Reply to every reporter.

If it cannot be fixed quickly: make sure Tallshot warns or refuses.
Refusing is a correct outcome.

---

## 12. Day 0 to launch

1. [ ] Finish ROADMAP Phase 5 (keep-alive hardening). Phase 6 (licensing)
       is ON HOLD; decide whether launch waits for it (sec 16).
2. [ ] Lite full pass.
3. [ ] Create a dedicated developer email (cannot be changed later).
4. [ ] Register the CWS account ($5). India eligibility [VERIFY ON FIRST RUN].
       Turn on 2FA and save backup codes.
5. [ ] Trader declaration if selling Pro: an individual trader's ID and
       contact are shown publicly (EU). Decide what to show.
6. [ ] Support email, support repo, Known Issues page.
7. [ ] Privacy policy hosted; matches sec 1 and 5.1.
8. [ ] Listings. Spam policy forbids items with the same experience. The
       Full listing says it is the companion edition (debugger engine +
       Redact), links Lite, and uses different text and screenshots.
       Consider asking CWS support first [VERIFY ON FIRST RUN].
9. [ ] Per-release checklist (sec 8).
10. [ ] Submit with defer publish. Publish. Install from the store; capture.

## 13. Restore and bus factor

You have one laptop (it crashed once) and one GitHub / Google account.

- [ ] `RESTORE.md`: how to rebuild on a new machine (clone, Node version,
      `npm ci`, Playwright into `.local/`, build, where the store zips are).
- [ ] 2FA backup codes for Google (CWS), GitHub and email: printed and in a
      second safe place.
- [ ] `docs/hotfix-cheatsheet.md`: one page. Key line: disabling a broken
      preset falls back to automatic detection with a warning.
- [ ] Push WIP to a branch often (at least after every work package).
- [ ] A second copy of the repo off the laptop (GitHub counts; plus one
      offline backup monthly).

## 14. Exam / away mode

Before exams or travel:

- [ ] Do not ship a release in the 2 weeks before. Ship small or nothing.
- [ ] Know the rollback button (sec 9). It takes a minute from a phone.
- [ ] Known Issues page ready to edit from a phone.
- [ ] Auto-reply on the support email: "Replies may take up to a week."
- [ ] Skip Friday 3 if needed. Do it the first Friday after.
- During exams, respond only to P0. Rollback and a Known Issues line are
  enough; fix later.

## 15. First week after launch

- Daily: email, issues, reviews; reply within 24 h.
- Day 1: install from the store on a second profile; matches local build.
- Day 2-3: Friday 3 on all three big sites.
- Day 7: note what broke and what people asked for in PROGRESS.md.
- No new features this week. P0 / P1 only.

---

## 16. Decisions for the owner

Nothing here happens without your yes or no.

1. **Report a problem** (Copy / Email / GitHub, hostname opt-in).
   Recommended yes. Needs a PRIVACY.md line.
2. **Support email and repo**: which address; which GitHub account (your
   handle shows your identity).
3. **Known Issues page host**: landing site or support repo.
4. **Drop the Copilot preset**: recommended yes (redesigned Mar 2025).
5. **Rating prompt**: neutral only, or not at all; after how many captures.
6. **Canary**: after launch; Task Scheduler entry needs approval.
7. **Remote selector config**: recommended NO (product choice).
8. **Trader declaration**: needed if selling Pro; what ID and contact to show.
9. **Two-edition listing risk**: accept with the companion-edition
   mitigation, and/or ask CWS support before launch.
10. **License host permission in the v1 manifest**: if Pro will ever call a
    license server, its host permission (or an optional one) must be
    decided before the first public release, or adding it later disables
    the extension for users.
11. **Launch before or after licensing** (Phase 6).
12. **Edge Add-ons**: when; Lite first.
