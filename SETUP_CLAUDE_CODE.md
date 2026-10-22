# SETUP_CLAUDE_CODE.md - owner's setup guide for GEHRMAN_SPARROW

Project folder: `F:\Dev\Claude_folder_project_and_stuff\page-archive`

Everything stays inside the project folder. No global environment variables,
nothing on C:. All commands are PowerShell, run from the project folder.
Items marked [VERIFY ON FIRST RUN] were checked against documentation but not
on this machine.

---

## 1. What lives where (all inside the project, all gitignored)

```
page-archive\
  node_modules\                 npm install (Playwright library)
  .local\ms-playwright\         Playwright's Chromium (npm run browsers)
  .local\chrome-profiles\pac-test\        Chrome profile for real-site testing (you log in here)
  .local\chrome-profiles\playwright-mcp\  Playwright MCP profile
  .e2e\                         test runs: outputs, temporary profiles, downloads
  dist\                         built extensions (npm run build)
```

Every script that uses Playwright sets `PLAYWRIGHT_BROWSERS_PATH` to
`.local\ms-playwright` itself (`scripts/pw-env.mjs`), so you never need to set it.

---

## 2. Tools to have (check; install only what is missing)

| Tool | Check | Needed for |
| --- | --- | --- |
| Node.js 20+ (on F:) | `node -v` | Tests, scripts, MCP servers |
| npm prefix and cache on F: | `npm config get prefix` -> `F:\Dev\npm-global`, `npm config get cache` -> `F:\Dev\npm-cache` | Keeps npx and MCP downloads off C: |
| Git | `git --version` | Version control |
| GitHub CLI `gh` (portable on F:, on PATH) | `gh --version`, then `gh auth status` (run `gh auth login` yourself if needed) | Creating and pushing the repo |
| Google Chrome (already installed) | - | Real-site testing profile |
| Claude Code | `claude --version` | The build |

No Python is needed; this is a pure Node project.

About an older Playwright install: if you installed Playwright browsers before,
they are probably in `%LOCALAPPDATA%\ms-playwright` on C:. This project does not
use them. `npm run browsers` tells you if that folder exists; delete it yourself
if you want the space back.

---

## 3. MCP servers (project scope, saved in the repo's `.mcp.json`)

Run these from the project folder. The `cmd /c` wrapper is the known fix for
npx-based servers failing to start on native Windows. Claude Code asks you to
approve project-scope servers the first time it starts in this folder.

### 3a. Chrome DevTools MCP (required) - eyes on real sites
Connects to the dedicated test Chrome (section 4) instead of launching its own
browser, so it never creates a profile on C:.
```
claude mcp add chrome-devtools --scope project -- cmd /c npx -y chrome-devtools-mcp@latest --browserUrl=http://127.0.0.1:9222
```
[VERIFY ON FIRST RUN] Current docs name the flag `--browserUrl` (short `-u`).
If the server reports an unknown option, run `npx -y chrome-devtools-mcp@latest --help`
and use the name it prints.

### 3b. Playwright MCP (recommended) - screenshots of the landing page and store assets
Uses your installed Chrome (no download) and a profile inside the project; its
default profile would be on C:.
```
claude mcp add playwright --scope project -e PLAYWRIGHT_BROWSERS_PATH=F:\Dev\Claude_folder_project_and_stuff\page-archive\.local\ms-playwright -- cmd /c npx -y @playwright/mcp@latest --browser chrome --user-data-dir F:\Dev\Claude_folder_project_and_stuff\page-archive\.local\chrome-profiles\playwright-mcp --output-dir F:\Dev\Claude_folder_project_and_stuff\page-archive\.e2e\playwright-mcp
```
The `-e` value only applies to this MCP server, so if it ever installs a
browser, that goes into the project too. [VERIFY ON FIRST RUN] the `-e` flag
on your Claude Code version (`claude mcp add --help`).
When you want this server, say "use the Playwright MCP" explicitly.

### Verify
```
claude mcp list
```
chrome-devtools only shows as connected while the test Chrome from section 4 is open.

Note: automated E2E tests use neither MCP. They use the Playwright library
(`npm run e2e`), because branded Chrome ignores `--load-extension`.

---

## 4. Dedicated test Chrome (for real logged-in sites)

Start it whenever you test real sites (make a desktop shortcut). If Chrome is
installed elsewhere, check `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`.
```
cd F:\Dev\Claude_folder_project_and_stuff\page-archive
New-Item -ItemType Directory -Force .local\chrome-profiles\pac-test | Out-Null
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="F:\Dev\Claude_folder_project_and_stuff\page-archive\.local\chrome-profiles\pac-test"
```
First time in that window:
1. Log in to ChatGPT, Claude, Gemini, Notion, Google (Colab). You do this, never Claude Code.
2. `chrome://extensions` -> Developer mode on -> Load unpacked -> the project's `dist\full`
   folder (it exists after Claude Code runs `npm run build` in Phase 0).
Chrome only allows remote debugging on a separate profile like this one, and it
keeps your personal browsing out of the tests.

---

## 5. Skills and plugins

None required. The Markdown files in this repo are the project's instructions.
Optional later: the frontend-design skill for the landing page in Phase 2.

---

## 6. Model choice

Use `/model` inside Claude Code to see what your plan offers.
- Hard engineering (capture engine, PDF internals, Redact, video encoding):
  the strongest model available to you (Opus-class or above).
- Docs, store listing copy, landing page content, small fixes: a Sonnet-class
  model is enough and saves usage.

---

## 7. Continue prompt (Phase 0 was started and stopped at the environment check)

Copy the updated files from the new zip over your project folder first
(section 9), then restart Claude Code in the project folder and paste:

```
I replaced the project files with an updated version. Re-read CLAUDE.md,
PROGRESS.md and ROADMAP.md. The environment approach changed: Playwright
browsers are now project-local in .local\ms-playwright, set by
scripts/pw-env.mjs. No global PLAYWRIGHT_BROWSERS_PATH is needed, and do not
set one.

Continue Phase 0 from ROADMAP.md:

1. Confirm npm config get prefix and npm config get cache are still on F:.
2. Git: git init, add a .gitattributes that keeps LF line endings for source
   files, first commit "Import Page Archive v2.3.0", then show me the gh command
   to create the PRIVATE repo Shashank-ssls/page-archive and push. Wait for my OK
   before running it.
3. npm install, then npm run browsers. Show me the script output, then list
   .local\ms-playwright to prove Chromium is inside the project. If anything
   downloads outside the project folder, STOP and tell me.
4. npm run check, npm run e2e, npm run e2e:lite, npm run popup-shot,
   npm run build. These passed on Linux; fix anything Windows-specific (paths,
   line endings, download locations) with a test for each fix. Look at the popup
   screenshots.
5. Ask me to start the dedicated test Chrome (SETUP_CLAUDE_CODE.md section 4),
   then use the chrome-devtools MCP to open https://example.com in it and take a
   screenshot, to prove the attachment works.
6. Update PROGRESS.md, commit, push, and STOP with a short summary plus a
   "Needs your check" list. Do not start Phase 1.

Keep everything inside the project folder, keep every file pure ASCII, and
explain before running anything system-level.
```

---

## 8. Prompts for later phases

Phase 1 (real sites):
```
Read PROGRESS.md and ROADMAP.md. Start Phase 1. I have the test Chrome open with
dist\full loaded and I am logged in to the sites. Walk the real-site matrix in
TESTING.md section 5 one row at a time: tell me which page to open and what to
click, or drive it yourself with the chrome-devtools MCP where you can. After each
row, inspect the downloaded file, record the result in PROGRESS.md, and for any
failure build a local fixture that reproduces it before fixing. Never save real
captures in the repo. Stop after the matrix is complete.
```

Every later phase:
```
Read PROGRESS.md and ROADMAP.md. Start Phase N. Follow its checklist and
acceptance criteria. Stop at the end of the phase with a summary and a
"Needs your check" list.
```

If a session gets long or confused:
```
Update PROGRESS.md with exactly where we are, commit and push, then stop.
```
Then start a fresh session with the "Every later phase" prompt.

---

## 9. Applying an updated zip

The zip's top folder is `page-archive`. Extract it somewhere temporary, then copy
its contents over `F:\Dev\Claude_folder_project_and_stuff\page-archive`
(replace files). Your `node_modules`, `.local`, `.e2e` and `.git` folders are not
in the zip, so they are kept. Before git exists, there is nothing else to merge.

---

## 10. Your own checklist before Phase 2

- [ ] Store and trademark search for "Page Archive"; pick a domain.
- [ ] Chrome Web Store developer account ($5 one-time) and Edge Add-ons account.
- [ ] Record and post the before/after clip; note the response in PROGRESS.md.
- [ ] Before Phase 5: payment provider account (Dodo Payments recommended).
