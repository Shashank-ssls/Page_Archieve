// Screenshots the popup in light and dark themes, in three states
// (idle, capturing with options open, done with files and warnings).
// Output: <repo>/.e2e/popup/*.png  (gitignored)
// Usage: node tools/popup-shot.mjs [--edition lite]
// Uses the project-local Playwright Chromium (npm run browsers).
import '../scripts/pw-env.mjs'; // must run before Playwright loads: project-local browsers
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const { chromium } = await import('playwright');

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(REPO, '.e2e', 'popup');
const DIST = path.join(REPO, '.e2e', 'popup-dist');
const edition = process.argv.includes('--edition') && process.argv[process.argv.indexOf('--edition') + 1] === 'lite' ? 'lite' : 'full';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
execFileSync(process.execPath, [path.join(REPO, 'tools', 'build-editions.mjs'), DIST], { stdio: 'ignore' });
const ext = path.join(DIST, edition);

const ctx = await chromium.launchPersistentContext(path.join(REPO, '.e2e', 'popup-profile'), {
  headless: false,
  executablePath: process.env.CHROME || undefined,
  viewport: { width: 372, height: 900 },
  deviceScaleFactor: 2,
  args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`]
});
let [worker] = ctx.serviceWorkers();
if (!worker) worker = await ctx.waitForEvent('serviceworker');
const id = new URL(worker.url()).host;
const page = await ctx.newPage();
for (const scheme of ['light', 'dark']) {
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(`chrome-extension://${id}/popup.html`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${edition}-${scheme}-1-idle.png`), fullPage: true });
  await page.evaluate(() => {
    document.getElementById('more').open = true;
    // eslint-disable-next-line no-undef
    running = true;
    // eslint-disable-next-line no-undef
    renderProgress({ phase: 'capture', percent: 46, message: 'Rendering section 2 of 4...', engineLabel: 'Full render' });
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${edition}-${scheme}-2-capturing.png`), fullPage: true });
  await page.evaluate(() => {
    document.getElementById('more').open = false;
    // eslint-disable-next-line no-undef
    renderProgress({
      phase: 'done', percent: 100, message: 'PDF saved (2 pages).', engineLabel: 'Full render - Claude',
      files: [{ filename: 'claude.ai_Example chat.pdf', bytes: 2483000, width: 1060, height: 19280 }],
      warnings: ['Captured the main scrollable panel, not the surrounding app shell.', 'PDF includes a searchable, selectable text layer (412 lines).']
    });
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${edition}-${scheme}-3-done.png`), fullPage: true });
}
await ctx.close();
console.log(`Popup screenshots written to ${OUT}`);
