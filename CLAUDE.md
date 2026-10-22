# CLAUDE.md - Tallshot

Claude Code reads this file automatically at the start of every session.
It holds the standing rules. The other project documents are:

| File | What it holds |
| --- | --- |
| `PROGRESS.md` | Where we are: current phase, what is done, decisions log. Read first. |
| `ROADMAP.md` | The phased build plan with acceptance criteria and gates. |
| `ARCHITECTURE.md` | How the capture engine works today. Read before touching capture code. |
| `PRODUCT.md` | Positioning, editions, Free vs Pro, pricing, store rules. |
| `DESIGN.md` | The popup design system. Read before touching any UI. |
| `TESTING.md` | Unit tests, the real-browser E2E harness, the real-site matrix. |

---

## 0. First action of every session

1. Read `PROGRESS.md`, then `ROADMAP.md` for the current phase.
2. Say in 2-3 lines: which phase we are on, what is done, what you will do next.
3. Read `ARCHITECTURE.md` before changing capture code, `DESIGN.md` before UI work.
4. Then proceed. Do not redo completed work; trust `PROGRESS.md`.

---

## 1. Environment rules (non-negotiable)

- Machine: GEHRMAN_SPARROW, Windows 11, Ryzen 5 4600H, 16 GB RAM, GTX 1650 (4 GB VRAM).
- NEVER install anything to C:. All dev tools, caches and downloads live on F:.
  npm prefix and npm cache are already pointed at F: through environment
  variables; do not override them.
- Project folder: `F:\Dev\Claude_folder_project_and_stuff\page-archive`.
- Everything stays inside the project folder ("local environment"):
  Playwright's browser lives in `.local\ms-playwright` (installed by
  `npm run browsers`; every script sets `PLAYWRIGHT_BROWSERS_PATH` itself through
  `scripts/pw-env.mjs`). Never install Playwright browsers any other way, never
  run a bare `npx playwright install`, and never set global environment variables.
- Browser profiles used for testing live in `.local\chrome-profiles\` and test
  outputs in `.e2e\`. Both are gitignored.
- All source files are PURE ASCII: code, comments, configs, Markdown, commit
  messages. No emoji, smart quotes, em dashes or unicode arrows. User-facing
  strings that need Unicode use escapes (`\u2026` in JS, `&#x2026;` in HTML).
  `npm run check` enforces this through `scripts/check-ascii.mjs`.
- Explain WHY before running anything destructive or system-level (deleting
  files, changing environment variables, installing global tools, git history
  rewrites). The owner reviews such commands before they run.
- Mark anything you could not verify on this machine with `[VERIFY ON FIRST RUN]`
  in docs and summaries, instead of presenting it as tested.

---

## 2. Product invariants (never violate)

- **Local-only.** No backend, no analytics, no telemetry, no remote code, no
  screenshot or page text ever leaves the device. The only allowed network
  calls are: the license check (Pro) and, later, sending a SHA-256 hash to a
  timestamp authority (Proof Stamp). Any new network call needs the owner's
  explicit approval and a line in the privacy policy.
- **Never a silent downgrade.** A failed full-page capture must never be
  exported as a viewport screenshot. Falling back from Full render to
  scroll-and-stitch is allowed and must add a warning.
- **Never export a known-broken image.** Tile-coverage validation in the
  stitcher stays strict. Do not loosen tolerances to make a capture "pass".
- **Always restore the page.** Every temporary style, attribute, scroll offset,
  viewport override and debugger attachment is undone on success, error and
  cancel. The E2E harness checks this; keep it passing.
- **Debugger hygiene.** `chrome.debugger` attaches only after the user starts a
  capture, only to that tab, and detaches in a `finally` path.
- **Two editions from one source.** Full (with `debugger`) and Lite (without).
  Never fork the code; edition differences go through `tools/build-editions.mjs`
  and the `IS_FULL_EDITION` check. Lite must never show a warning about the
  missing engine.
- **Permissions are frozen.** Do not add permissions or host permissions without
  the owner's approval. Chrome does not allow `debugger` as optional.
- **No runtime dependencies** unless approved and vendored into the repo with
  their license in `THIRD_PARTY_NOTICES.md` (Scroll Reel's MP4 muxer is the one
  planned exception). Dev dependencies (Playwright) are fine.
- **Redaction is destructive.** Share-safe Redact must change the pixels and
  remove the words from the PDF text layer. Never just draw a box on top.
- **Store policy.** No competitor names in the store listing or extension UI.

---

## 3. How we work

- One phase at a time, from `ROADMAP.md`. Do not start the next phase early.
  When a phase is done: run the checks, update `PROGRESS.md`, commit, push,
  then STOP and summarize for review.
- Small, focused changes. Fix bugs at the narrowest responsible layer.
- Reproduce before fixing: a capture bug gets a minimal fixture in
  `tests/site-fixture/` plus a case in `tests/e2e/suite.json`, then the fix.
- Every new behaviour gets a unit test in `tests/*.test.cjs`. Note: some older
  tests assert on source text with regexes; when you rename strings, update
  those tests in the same commit rather than weakening them.
- Keep warnings specific and honest. Distinguish "broken", "unverified",
  "truncated", "fell back", "panel only".

---

## 4. Commands

| Command | What it does |
| --- | --- |
| `npm install` | Installs dev dependencies (Playwright library only) |
| `npm run browsers` | Installs Playwright's Chromium into `.local\ms-playwright` (once) |
| `npm run check` | Syntax checks, ASCII check, all unit tests. Must be green to commit. |
| `npm run e2e` | Real-browser suite on the Full edition (Playwright Chromium) |
| `npm run e2e:lite` | Same suite on the Lite edition |
| `npm run e2e -- --only reveal-lazy,fixed-art` | Run selected cases |
| `npm run popup-shot` | Screenshots of the popup, light and dark, 3 states, in `.e2e/popup/` |
| `npm run build` | Builds `dist/full` and `dist/lite` for loading unpacked or zipping |

Set `PAC_HEADED=1` to watch the E2E browser. Outputs land in `.e2e/` (gitignored).
After UI changes, run `npm run popup-shot` and LOOK at the images before saying done.

---

## 5. Git

- Repo: `github.com/Shashank-ssls/Page_Archieve` (private for now; remote `origin`).
- Hard rule: commit AND push at the end of every phase, and before any risky
  refactor. A previous project was lost entirely without a remote backup.
- Commit messages: ASCII, imperative, short subject line, body explaining why.
- Never commit `.e2e/`, `dist/`, `node_modules/`, zips or real-site captures
  (they may contain private chats).

---

## 6. Definition of done for any change

1. `npm run check` is green.
2. `npm run e2e` and `npm run e2e:lite` are green, if capture code changed.
3. `npm run popup-shot` reviewed, if UI changed.
4. `CHANGELOG.md` and `PROGRESS.md` updated; version bumped in `manifest.json`
   and `package.json` together when shipping.
5. Anything only the owner can verify (real logged-in sites, Windows-specific
   behaviour) is listed for him under "Needs your check" in the summary.
