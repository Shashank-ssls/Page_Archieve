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
    // Show Redact on, so its hint and word box are reviewed too (Full only).
    const on = document.getElementById('redact');
    if (on && !document.getElementById('redact-group').hidden) { on.checked = true; on.dispatchEvent(new Event('change', { bubbles: true })); }
    document.getElementById('save-edit').click();
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
  // A busy result as seen on a real Claude capture: long part names and many
  // warnings. Chrome widens the popup window to the content, so any horizontal
  // overflow breaks the card; report it.
  await page.evaluate(() => {
    const name = n => `Extension improvement and overhaul - Claude_part-0${n}-of-03.png`;
    // eslint-disable-next-line no-undef
    renderProgress({
      phase: 'done', percent: 100, engineLabel: 'Full render - Claude',
      message: 'Saved 3 PNG parts. Image audit: saw 23 HTML images and checked 0 CSS/embedded image URLs; no confirmed failures were found in checked assets, but some images could not be fully verified.',
      files: [{ filename: name(1), bytes: 5800000 }, { filename: name(2), bytes: 4900000 }, { filename: name(3), bytes: 145000 }],
      warnings: [
        'Expanded collapsed content (1 "show more" button). Clicked buttons stay expanded on the page after capture.',
        'The visual image audit reached its safety limit; some CSS or embedded image assets may not have been checked.',
        'Hid 5 floating element(s) over the captured panel (message boxes, toolbars, floating buttons).',
        'Captured the main scrollable panel, not the surrounding app shell. Choose Document in Target to capture the page shell instead.',
        'The page was exported as 3 numbered PNG parts to stay within browser image-size limits.',
        // A long unbroken image URL (seen on YouTube) must wrap, not widen the popup.
        '1 HTML <img> element(s) appeared broken, undecoded, or incomplete in the rendered page. Examples: HTML img: yt3.ggpht.com/7Cif0ybqMEPYeXAa1OP7fe3_6mupMU878HY1lE0iADsd4KRZVHLGXSR142tQT42px49jdFf-=s88-c-k-c0x00ffffff-no-rj.'
      ]
    });
  });
  await page.waitForTimeout(250);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) console.warn(`${scheme}: popup content is ${overflow}px wider than the 372px popup (horizontal overflow).`);
  await page.screenshot({ path: path.join(OUT, `${edition}-${scheme}-4-busy.png`), fullPage: true });
  // The one-time review prompt under a finished capture.
  await page.evaluate(() => {
    // eslint-disable-next-line no-undef
    renderProgress({ phase: 'done', percent: 100, message: 'PNG saved.', engineLabel: 'Full render', files: [{ filename: 'History of the Internet - Wikipedia.png', bytes: 3100000 }], warnings: [] });
    document.getElementById('rate').hidden = false;
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${edition}-${scheme}-5-rate.png`), fullPage: true });
}
await ctx.close();
console.log(`Popup screenshots written to ${OUT}`);
