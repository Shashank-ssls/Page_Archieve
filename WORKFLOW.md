# WORKFLOW.md - Keeping Tallshot working after launch

This is the owner's operating manual for the time after Tallshot is on the
Chrome Web Store (CWS). Chat sites like ChatGPT, Claude, Gemini, Perplexity,
Copilot and DeepSeek change their page code often, sometimes weekly. This
file explains how to notice breakage early, hear about it from users, fix it
fast and ship the fix, without ever breaking the product rules in
`CLAUDE.md` section 2.

Every section is labelled one of these ways:

- **[EXISTS]** - this is in the repo and works today.
- **[TO BUILD]** - planned. It does not exist yet. Each item goes through
  `ROADMAP.md` like any other work.
- **[VERIFY ON FIRST RUN]** - a claim we could not test on this machine, or
  a store or Google detail that may have changed. Check it before relying on it.

---

## 1. The rules that never bend

These come from `CLAUDE.md`. Every idea in this file was checked against them.

1. Local-only. No backend, no analytics, no telemetry, no remote code.
2. The only network call is the Pro license check (later: a SHA-256 hash to
   a timestamp authority for Proof Stamp). Anything else needs your approval
   and a line in the privacy policy.
3. Permissions are frozen. Adding one makes Chrome disable the extension for
   existing users until they accept it. Treat that as a disaster.
4. Never a silent downgrade, never export a known-broken image, always
   restore the page.
5. Remote code is banned by the store. So every fix, even a one-line
   selector change, is a new version that goes through review.

Consequence: we cannot "push a fix to users" from a server. Our speed comes
from (a) noticing early, (b) a tested hotfix routine, (c) code that degrades
gracefully so a site change is an inconvenience, not an outage.

---

## 2. How the site support works today [EXISTS]

- `content.js` has `SITE_PRESETS` (around lines 55-66): one entry per chat
  site with selectors for the conversation area and for each turn (used to
  make PDF bookmarks).
- How fragile each preset is (from a code review, 2026-10):

| Site | What it matches on | Risk of breaking |
| --- | --- | --- |
| ChatGPT | `data-*` attributes | medium |
| Claude | `data-testid`, `.font-claude-message` | medium-high |
| Gemini | custom element tags | medium |
| Perplexity | `.prose` class | high |
| Copilot | `cib-message` tags | probably already dead [VERIFY ON FIRST RUN] |
| DeepSeek | generated class names | high |

- Under the presets there is a generic detector (semantic tags plus geometry
  scoring). This is the real safety net: when a preset misses, capture
  usually still works.
- Known weak spots (silent failures):
  - If the host matches but no marker is found, the preset name is still
    reported and the code falls back to heuristics with no warning
    (around `content.js` line 123).
  - If the turn selector matches zero elements, PDF bookmarks just vanish
    with no warning.
- Tests that exist: unit tests (`npm run check`), the real-browser E2E
  suite on local fixtures (`npm run e2e`, `tests/e2e/run.mjs`,
  `tests/e2e/suite.json`), and the manual real-site matrix in `TESTING.md`.

---

## 3. Making the code harder to break [TO BUILD]

Do these before or soon after launch. Each is a normal roadmap item with a
fixture and a unit test.

- [ ] **Preset is a hint, not a gate.** Try in order: preset selectors ->
      ARIA roles / landmarks -> geometry heuristic -> whole document.
      Record which layer won.
- [ ] **Honest self-check warnings.** If the host is known but the preset
      did not match, show: "Layout not recognised, used automatic
      detection." If turns were expected but zero found: "Chapter bookmarks
      unavailable for this page." These are specific, not scary.
- [ ] **Several selectors per turn**, best first, so one rename does not
      kill bookmarks.
- [ ] **Drop dead and class-only selectors** (Copilot `cib-message`,
      generated DeepSeek classes) or move them behind stabler ones.
- [ ] **Warning codes** (short ids like `W_PRESET_MISS`) attached to each
      warning, so a user report can say exactly what happened.

**Remote selector config (JSON fetched from a server): NOT now.** The store
might allow it if it is purely data, but it is a new network call and
weakens "local-only". If you ever want it, it needs: your approval, a signed
static JSON, a kill switch, a privacy policy line. See section 12.

---

## 4. The canary: catching breakage before users do [TO BUILD]

A canary is a small automatic test run against the REAL sites once a week.

### 4.1 Design

- Runs on YOUR Windows laptop with Task Scheduler, not GitHub Actions.
  Reason: cloud machines get blocked by Cloudflare, and storing logins in
  CI is unsafe.
- Uses **public share links** (chatgpt.com/share/..., claude.ai/share/...,
  Gemini share, Perplexity share) created from a throwaway account. No
  login needed, no private chats.
- The list lives in `.local/canary-sites.json` (gitignored). A template
  `tests/e2e/canary-sites.example.json` is committed. Each entry: url,
  expected preset, a start marker string and an end marker string (a word
  near the top and bottom of that conversation).
- If a captcha or "verify you are human" page shows up, the case is
  **SKIPPED**, not FAILED. Never try to bypass it.
- Read each site's terms of service before adding it. One run per week of
  a few pages is gentle; do not increase it.

### 4.2 What each run checks

- [ ] The preset name detected is the expected one.
- [ ] Both marker strings are in the PDF text (so the capture is complete).
- [ ] Bookmark count is above zero (and near last week's).
- [ ] No composer/input-box text in the output.
- [ ] The image is not blank (non-white pixels present).
- [ ] Structural fingerprint: tag names, roles, `data-*` attribute names and
      how many elements each preset selector matched. Diffed against last
      run. **A selector count dropping to zero is the early warning**, even
      if the capture still passed through the fallback.

### 4.3 Files to add

- `tests/e2e/lib.mjs` - shared helpers pulled out of `run.mjs`.
- `tests/e2e/canary.mjs` - the canary runner.
- `tools/snapshot-page.mjs` - saves a DOM snapshot with all text replaced
  by lorem ipsum, for turning into a fixture. Raw snapshots never get
  committed.
- npm scripts: `npm run canary`, `npm run snapshot`.
- A Windows toast notification on failure.
- The weekly Task Scheduler (`schtasks`) entry is a system-level change:
  Claude must show you the exact command and you approve it.

### 4.4 Limit

Share pages have no composer and no sidebar, so they do not test those
parts. That is why there is also a monthly manual logged-in check (section 7).

---

## 5. Hearing from users [TO BUILD unless noted]

### 5.1 "Report a problem" inside the extension

- Builds a short report ON THE DEVICE and SHOWS it to the user first.
- Contains: extension version, edition (Full/Lite), Chrome version, OS,
  engine used, whether it fell back, warning codes, page height bucket
  (for example "10k-20k px"), the error message.
- Hostname only if the user ticks a box (unchecked by default).
- NEVER: page text, URL paths, page titles, screenshots.
- The user sends it themselves with one of: **Copy**, **Email** (mailto
  link, keep under ~1800 characters), **Open GitHub issue** (prefilled
  URL). Opening a link is the user navigating, not the extension making a
  network call, so the local-only rule holds. [VERIFY ON FIRST RUN] that
  the privacy policy wording covers this; suggested line: "If you choose
  to report a problem, Tallshot shows you the report and you decide whether
  to send it by email or GitHub. Nothing is sent automatically."

### 5.2 Channels

| Channel | Use | Status |
| --- | --- | --- |
| Support email (dedicated address) | Primary | [TO BUILD] create it |
| Public repo `tallshot-support`, issues only, form `capture-bug.yml` | Bug reports | [TO BUILD] |
| CWS reviews | Reply within 48 hours | after launch |
| Reddit / forums | Only when someone asks directly | after launch |

Keep the main code repo private. The support repo holds no code.

### 5.3 Canned replies (keep in a text file, edit per case)

- **Ack:** "Thanks, I can see the problem. I am working on it and will
  reply when a fix is published."
- **Fixed:** "Fixed in version X.Y.Z. Chrome updates extensions on its own
  within about a day; you can force it at chrome://extensions with
  Developer mode -> Update."
- **Cannot fix / refused on purpose:** "Tallshot stopped instead of saving
  this page because the image would have been incomplete. It never saves a
  broken capture. Here is what you can try: ..."

### 5.4 Ratings

- Ask for a rating only after a few successful captures, never after a
  failure. "Not quite" button opens Report a problem.
- No incentives for reviews. [VERIFY ON FIRST RUN] current CWS policy on
  review prompts / "review gating" before shipping this.

---

## 6. Triage: how urgent is a report

| Level | What it means | Response |
| --- | --- | --- |
| **P0** | Silent downgrade, broken image exported, data loss, page left modified, crash on a major site | Hotfix in 24-72 hours (section 9) |
| **P1** | A major site (ChatGPT, Claude, Gemini) fails to capture | Fix in the next few days, own release |
| **P2** | A mid site broken, or wrong/missing warnings, bookmarks missing | Fixture + suite case, batch into next release |
| **P3** | Obscure site, cosmetic issue | Add to a known-limits list; fix when convenient |

- 3 or more separate reports of the same thing: promote it one level.
- Every P0-P2 gets a fixture in `tests/site-fixture/` and a case in
  `tests/e2e/suite.json` BEFORE the fix (`CLAUDE.md` section 3).

---

## 7. Cadences

### Weekly (about 30 minutes)

- [ ] Look at the canary result (toast or `.e2e/` output). [TO BUILD]
- [ ] Any selector count dropped? Open a P1/P2 item even if capture passed.
- [ ] Read support email, support repo issues, CWS reviews. Triage each.
- [ ] Reply to every CWS review older than 48 hours.

### Monthly (about 2 hours)

- [ ] Logged-in manual check on ChatGPT, Claude, Gemini with your own
      accounts, following the real-site matrix in `TESTING.md`. Check
      composer and sidebar are not in the output.
- [ ] Check the CWS developer dashboard for policy emails and warnings.
- [ ] Re-read the CWS program policies summary for changes. [VERIFY ON FIRST RUN]
- [ ] Review the known-limits list; close anything now fixed.
- [ ] Refresh redacted fixtures if a site redesigned.

### Per release

- [ ] `npm run check` green.
- [ ] `npm run e2e` green (Full edition only, per `CLAUDE.md` section 6).
- [ ] `npm run popup-shot` reviewed if UI changed.
- [ ] Version bumped in BOTH `manifest.json` and `package.json`.
- [ ] `CHANGELOG.md` and `PROGRESS.md` updated.
- [ ] `manifest.json` permissions unchanged (diff it against the last tag).
- [ ] No new network calls (search the diff for `fetch`, `XMLHttpRequest`,
      `WebSocket`, `sendBeacon`).
- [ ] `npm run build`, zip with `manifest.json` at the zip root.
- [ ] Load the zip contents unpacked in a clean profile and do one capture.
- [ ] Commit, tag (`vX.Y.Z`), push BEFORE submitting.

---

## 8. Releasing on the Chrome Web Store

Facts as researched in 2026-10; all [VERIFY ON FIRST RUN] on your account.

- Review usually takes a few days; Google's doc says most within ~3 days.
  Extensions with `debugger` or permission changes can take longer.
- After publish, Chrome auto-updates users within about a day.
- There is no official expedited review. Plan for the delay.
- **No rollback.** To undo a bad release, ship a higher version with the
  old code.
- **Staged rollout:** you can publish to a percentage of users and only
  increase it. Use 10-20% for risky changes.
- **Defer publish:** submit, and after approval publish manually when you
  are ready. Use this for every release so you control the moment.
- Version numbers: `MAJOR.MINOR.PATCH`. Hotfix = PATCH +1. Each upload must
  be higher than the last.
- Edge Add-ons is a separate account and review. Plan: Lite edition first
  there. [TO BUILD]
- The CWS publish API exists; not worth automating at this size.

---

## 9. Hotfix playbook (P0 or P1)

Follow in order. Do not skip steps under pressure; the steps are the speed.

1. [ ] Reproduce. Write down: site, browser version, what the output looked
       like.
2. [ ] `git checkout -b hotfix/<short-name>` from `main`.
3. [ ] Make a minimal fixture in `tests/site-fixture/` (use
       `npm run snapshot` once it exists, text redacted) and add a case to
       `tests/e2e/suite.json`. Run it: it must FAIL first.
4. [ ] Fix at the narrowest layer (usually a selector or a fallback in
       `content.js`). Do not loosen stitch tolerances.
5. [ ] Add a unit test in `tests/*.test.cjs`.
6. [ ] `npm run check` green.
7. [ ] `npm run e2e` green (Full only). The new case now passes.
8. [ ] Bump PATCH in `manifest.json` and `package.json`.
9. [ ] Update `CHANGELOG.md` and `PROGRESS.md`.
10. [ ] `npm run build`; zip `dist/full` with `manifest.json` at the root.
11. [ ] Load unpacked from the built folder; capture the broken site once.
12. [ ] Merge to `main`, tag, push.
13. [ ] Upload to CWS with "defer publish". Mention in the notes that it is a
        bug fix with no permission changes.
14. [ ] When approved, publish (100% for a P0 fix; staged if the fix itself
        is risky).
15. [ ] Reply to every reporter with the "Fixed" canned reply.

If a site change cannot be fixed quickly: make sure Tallshot shows an honest
warning or refuses, rather than exporting a broken capture. Refusing is a
correct outcome.

---

## 10. Day 0 to launch

1. [ ] Finish the current `ROADMAP.md` phases; Full edition first.
2. [ ] Register a CWS developer account (one-time fee) and verify it.
       [VERIFY ON FIRST RUN] current fee and identity/payment steps for India.
3. [ ] Create the support email and the `tallshot-support` repo.
4. [ ] Write and host the privacy policy (must match section 1 and 5.1).
5. [ ] Prepare listing: description without competitor names, screenshots,
       icon, a clear explanation of why `debugger` is needed.
6. [ ] Make the throwaway account and the canary share links.
7. [ ] Run the per-release checklist (section 7).
8. [ ] Submit with defer publish. Expect a few days of review.
9. [ ] Publish. Install from the store yourself and capture once.

## 11. First week after launch

- Daily: read email, issues and reviews; reply within 24 hours.
- Day 1: install from the store on a second Chrome profile; confirm the
  store build matches your local build.
- Day 2-3: run the logged-in manual check on the three big sites.
- Day 3: run the canary by hand (or the manual matrix if not built yet).
- Day 7: write down what broke and what people asked for in `PROGRESS.md`;
  decide what goes into the first PATCH release.
- Do not ship new features this week. Only P0/P1 fixes.

---

## 12. Decisions for the owner

Each needs your yes or no. Nothing here happens without it.

1. **Build the canary?** Recommended yes. Needs approval for the weekly
   Task Scheduler entry on this laptop.
2. **Report a problem feature** with Copy / Email / GitHub issue, hostname
   opt-in. Recommended yes. Needs a privacy policy line.
3. **Support email address and public support repo**: which address, which
   GitHub account.
4. **Remote selector config**: recommended NO for now. If yes later: signed
   JSON, kill switch, privacy line, it is a new network call.
5. **Drop the Copilot preset** if confirmed dead, or keep it behind the
   fallback.
6. **Rating prompt**: yes or no, and after how many successful captures.
7. **Edge Add-ons**: when, and Lite only at first?
8. **Staged rollout default**: always staged, or only for risky releases.
