# TESTING.md

Four layers. Passing a lower layer never proves a higher one.

## 1. Unit tests
`npm run check` runs syntax checks, the ASCII check and `node --test tests/*.test.cjs`
(96 tests at v2.3). Pure logic lives in `geometry.js` and `pdf.js` so it can be
tested without a browser. Some older tests assert on source text with regexes:
when you rename a string, update the test in the same commit.

## 2. Real-browser E2E (automated, offline)
`npm run e2e` / `npm run e2e:lite` (`tests/e2e/run.mjs`, cases in `tests/e2e/suite.json`).

- Uses Playwright's Chromium, because branded Google Chrome ignores
  `--load-extension`. The browser is project-local (`.local\ms-playwright`,
  installed once with `npm run browsers`); the scripts set the path themselves.
- Builds the chosen edition, gives the test copy a test-only `<all_urls>` host
  permission (no popup click exists to grant activeTab), serves
  `tests/site-fixture/` on port 8791, maps claude.ai and chatgpt.com to it.
- Each case: start capture through `self.__pageArchiveTest`, wait for the real
  download, copy outputs to `.e2e/out/`, compare scroll position, html style
  attribute and temporary nodes before and after (must be identical).
- Case options: `settings`, `mode` ("full" | "visible"), `switchAway`,
  `viewport`, `lite: false` (skip in Lite), `expect.engineIncludes`,
  `expect.titleUnchanged`, `expect.phase`.
- Exit code 1 on any failure. Open `.e2e/out/` and look at images when a
  change affects rendering; a pass only proves no error and restored state.

### Fixtures (tests/site-fixture)
| Fixture | Reproduces |
| --- | --- |
| index.html | Long page, lazy images, sticky header, inner scroll region |
| app-scroll-panel.html | Panel taller than the window, fixed composer |
| moving-panel.html | App shell shifting 152px during scroll |
| offscreen-panel.html | Panel mostly outside the viewport |
| notebook-reflow.html | Content that re-sizes on every resize (grow cannot converge -> stitch) |
| image-audit.html | Known-good and deliberately broken images of every kind |
| body-scroller.html | html locked, body scrolls |
| virtual-chat.html | Virtualised chat list, sticky header, in-flow composer |
| viewport-hero.html | 100vh hero, fixed header and composer |
| reveal-lazy.html | IntersectionObserver lazy images + fixed full-screen backdrop |
| fixed-art-backdrop.html | `background-attachment: fixed` cover art |
| chat-preset.html | Claude-like layout where the side panel is the biggest scroller |
| floating-badge.html | Fixed badge 14px above the bottom-right corner (reCAPTCHA on Reddit) |
| end-spacer.html | Chat list ending in a spacer sized to the viewport (Claude split view); `?last=1`: last turn with a script-set min-height (Gemini) |
| expand-content.html | View rest button, details, line clamp, plus traps that must NOT be clicked |

## 3. Popup visual check
`npm run popup-shot` -> `.e2e/popup/` (light and dark x idle, capturing, done).
Look at every image after UI changes.

## 4. Dedicated test Chrome profile (for real sites)
Real sites need a real, logged-in Chrome. Use a separate profile inside the project (`.local\chrome-profiles\pac-test`), never the
owner's main profile, and never handle credentials: the owner logs in himself.

Owner, one-time setup (PowerShell):
```
cd "F:\Dev\Claude_folder_project_and_stuff\page-archive"
New-Item -ItemType Directory -Force .local\chrome-profiles\pac-test | Out-Null
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="F:\Dev\Claude_folder_project_and_stuff\page-archive\.local\chrome-profiles\pac-test"
```
In that window: log in to ChatGPT, Claude, Gemini, Notion; open
`chrome://extensions`, enable Developer mode, Load unpacked `dist\full` (and
later `dist\lite`). Chrome only allows remote debugging on a non-default
profile, which is why this profile exists.

Confirming a reload: every `npm run build` stamps the built copies with the
build time and git commit, e.g. `Build 1022-1301 4f2c9ab`. After clicking the
reload arrow on `chrome://extensions`, the popup footer (and the version line on
`chrome://extensions`) must show the stamp Claude Code reported for the latest
build. A trailing `*` means the build included uncommitted changes. If the
stamp is older, the extension did not reload: click reload again.

Claude Code then attaches with the Chrome DevTools MCP (configured with
`--browser-url=http://127.0.0.1:9222`, see SETUP_CLAUDE_CODE.md) to navigate,
screenshot and read console errors. [VERIFY ON FIRST RUN] whether the MCP's own
attachment conflicts with the extension's `chrome.debugger` on the same tab; if
it does, have the MCP select a different tab before each capture, or let the
owner click Capture, then inspect the downloaded file.

## 5. Real-site matrix (Phase 1)
Run in the test profile with both editions. Record results in PROGRESS.md.
Never commit captures of real accounts.

| Site / type | Target | Check |
| --- | --- | --- |
| Long article (Wikipedia, a news site, a blog) | Smart | Full height, images, no repeated header |
| ChatGPT long thread | Smart (preset) | All turns, no sidebar/composer, PDF text searchable |
| Claude long thread, with an artifact open | Smart (preset) | Conversation only, all turns |
| Gemini, Perplexity | Smart (preset) | All turns |
| Notion page with images and toggles | Smart | Toggles expanded, images present |
| Google Colab notebook | Smart (preset) | Cells and outputs, end of notebook |
| itch.io game page with comments | Smart | Background art once, "View rest" expanded |
| Reddit thread, X profile | Smart | Lazy content, no endless growth past Max height |
| A web app dashboard | Smart, then Document | Honest warnings, no gaps |
| Any page with DevTools open | Smart | Clean fallback to stitch with warning |
| chrome://extensions | Visible | Viewport only, Full disabled |
