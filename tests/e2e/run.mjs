// Real-browser end-to-end harness for Page Archive.
//
// Loads the unpacked extension into Playwright's Chromium, serves the local
// fixtures, starts captures through the worker test hook, waits for the real
// download, and checks that the source page was restored.
//
// Usage:
//   node tests/e2e/run.mjs                      run tests/e2e/suite.json
//   node tests/e2e/run.mjs --only reveal,art    run named cases only
//   node tests/e2e/run.mjs --edition lite       build + test the Lite edition
//   node tests/e2e/run.mjs --cases '<json>'     ad-hoc cases
// Env:
//   PAC_HEADED=1      show the browser window
//   PAC_E2E_DIR=...   output folder (default: <repo>/.e2e, which is gitignored)
//   CHROME=...        optional Chromium executable (default: Playwright's)
//
// Notes:
// - Branded Google Chrome no longer honours --load-extension, so this uses
//   Playwright's Chromium. Browsers are project-local (.local/ms-playwright); run
//   "npm run browsers" once. No global PLAYWRIGHT_BROWSERS_PATH is needed.
// - The test copy gets a test-only <all_urls> host permission, because no
//   popup click is available to grant activeTab.
// - claude.ai and chatgpt.com are mapped to the local fixture server so site
//   presets can be tested offline.

import '../../scripts/pw-env.mjs'; // must run before Playwright loads: project-local browsers
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const { chromium } = await import('playwright');

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_ROOT = path.resolve(process.env.PAC_E2E_DIR || path.join(REPO, '.e2e'));
const PORT = 8791;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

const edition = (arg('edition') || 'full').toLowerCase();
let cases = arg('cases') ? JSON.parse(arg('cases')) : JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'e2e', 'suite.json'), 'utf8'));
const only = arg('only');
if (only) {
  const wanted = new Set(only.split(','));
  cases = cases.filter(c => wanted.has(c.name));
}
if (edition === 'lite') cases = cases.filter(c => c.lite !== false);

// Prepare the extension copy under test.
const DIST = path.join(OUT_ROOT, 'dist');
const TEST_EXT = path.join(OUT_ROOT, 'ext-under-test');
const OUT = path.join(OUT_ROOT, 'out');
fs.rmSync(OUT_ROOT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
execFileSync(process.execPath, [path.join(REPO, 'tools', 'build-editions.mjs'), DIST], { stdio: 'ignore' });
fs.cpSync(path.join(DIST, edition === 'lite' ? 'lite' : 'full'), TEST_EXT, { recursive: true });
const manifestPath = path.join(TEST_EXT, 'manifest.json');
const mf = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
mf.host_permissions = ['<all_urls>'];
fs.writeFileSync(manifestPath, JSON.stringify(mf));

// Fixture server.
const FIXTURES = path.join(REPO, 'tests', 'site-fixture');
const TYPES = { '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (!urlPath.startsWith('/fx/')) { res.writeHead(404); return res.end(); }
  let file = path.normalize(path.join(FIXTURES, urlPath.slice(4) || 'index.html'));
  if (!file.startsWith(FIXTURES)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
}).listen(PORT);

const headed = process.env.PAC_HEADED === '1';
const results = [];

for (const c of cases) {
  const profile = path.join(OUT_ROOT, `profile-${c.name}`);
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false,
    executablePath: process.env.CHROME || undefined,
    viewport: null,
    acceptDownloads: true,
    // Keep downloads on the repo drive; Playwright's default is the OS temp folder (C: on Windows).
    downloadsPath: path.join(OUT_ROOT, 'downloads'),
    args: [
      ...(headed ? [] : ['--headless=new']),
      `--window-size=${(c.viewport || [1280, 800]).join(',')}`,
      `--host-resolver-rules=MAP claude.ai 127.0.0.1:${PORT}, MAP chatgpt.com 127.0.0.1:${PORT}`,
      `--disable-extensions-except=${TEST_EXT}`,
      `--load-extension=${TEST_EXT}`
    ]
  });
  const r = { name: c.name, ok: false };
  try {
    let [worker] = ctx.serviceWorkers();
    if (!worker) worker = await ctx.waitForEvent('serviceworker');
    const page = ctx.pages()[0] || await ctx.newPage();
    const url = c.url.startsWith('http') ? c.url : `http://127.0.0.1:${PORT}${c.url}`;
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(c.preWait || 500);
    const snap = () => page.evaluate(() => ({
      x: scrollX, y: scrollY,
      htmlStyle: document.documentElement.getAttribute('style'),
      temp: document.querySelectorAll('[data-page-archive-temporary]').length
    }));
    const before = await snap();
    const t0 = Date.now();
    await worker.evaluate(async ({ mode, settings }) => {
      await chrome.storage.local.remove('pageArchiveLastProgress');
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      self.__pageArchiveTest.startCapture(tab.id, mode, settings).catch(e => console.error(e));
    }, { mode: c.mode || 'full', settings: c.settings || {} });
    if (c.switchAway) {
      await page.waitForTimeout(300);
      const other = await ctx.newPage();
      await other.goto(`http://127.0.0.1:${PORT}/fx/body-scroller.html`);
      await other.bringToFront();
    }
    let last = null;
    for (let i = 0; i < 600; i++) {
      await page.waitForTimeout(500);
      last = await worker.evaluate(async () => (await chrome.storage.local.get('pageArchiveLastProgress')).pageArchiveLastProgress);
      const busy = await worker.evaluate(() => !!self.__pageArchiveTest.getActiveJob());
      if (last && ['done', 'error', 'cancelled'].includes(last.phase) && !busy) break;
    }
    const downloads = await worker.evaluate(async () => (await chrome.downloads.search({})).map(d => ({ filename: d.filename, state: d.state })));
    const files = [];
    downloads.slice().reverse().forEach((d, i) => {
      if (d.state !== 'complete' || !fs.existsSync(d.filename)) return;
      const reported = last && last.files && last.files[i] && last.files[i].filename;
      const name = (reported ? path.basename(reported) : path.basename(d.filename)).replace(/[<>:"|?*]/g, '_');
      const dest = path.join(OUT, `${c.name}__${name}`);
      fs.copyFileSync(d.filename, dest);
      files.push(dest);
    });
    const after = await snap();
    Object.assign(r, {
      ms: Date.now() - t0,
      phase: last && last.phase,
      engine: last && last.engineLabel,
      message: last && last.message,
      warnings: (last && last.warnings) || [],
      files,
      restored: JSON.stringify(before) === JSON.stringify(after) ? true : { before, after },
      titleAfter: await page.title(),
      urlAfter: page.url()
    });
    const expect = c.expect || {};
    const problems = [];
    if (r.phase !== (expect.phase || 'done')) problems.push(`phase ${r.phase}`);
    if (r.restored !== true) problems.push('page not restored');
    if ((expect.phase || 'done') === 'done' && !files.length) problems.push('no file downloaded');
    if (expect.engineIncludes && !String(r.engine || '').includes(expect.engineIncludes)) problems.push(`engine "${r.engine}"`);
    if (expect.titleUnchanged && r.titleAfter !== expect.titleUnchanged) problems.push(`title changed to "${r.titleAfter}"`);
    r.problems = problems;
    r.ok = problems.length === 0;
  } catch (error) {
    r.problems = [String(error && error.message || error)];
  } finally {
    await ctx.close().catch(() => {});
  }
  results.push(r);
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(16)} ${String(r.ms || '').padStart(6)}ms  ${r.engine || ''}${r.ok ? '' : '  -> ' + r.problems.join('; ')}`);
}

server.close();
fs.writeFileSync(path.join(OUT_ROOT, 'results.json'), JSON.stringify(results, null, 1));
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed (${edition}). Outputs: ${OUT}`);
process.exit(failed ? 1 : 0);
