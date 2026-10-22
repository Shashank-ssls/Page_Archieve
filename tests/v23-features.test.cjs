const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../geometry.js');
const PDF = require('../pdf.js');
const P = require('../protocol.js');
const root = path.join(__dirname, '..');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

test('name templates expand tokens and folders cannot escape Downloads', () => {
  const now = new Date(2026, 9, 22, 9, 5, 7);
  assert.equal(G.applyNameTemplate('{site}_{title}_{date}', { title: 'Chat', site: 'claude.ai', now }), 'claude.ai_Chat_2026-10-22');
  assert.equal(G.applyNameTemplate('{datetime}', { now }), '2026-10-22_09-05-07');
  assert.equal(G.applyNameTemplate('', { title: 'X' }), 'X');
  assert.equal(G.safeFolder('../../etc/passwd'), 'etc/passwd');
  assert.equal(G.safeFolder('Page Archive/ /a:b/./'), 'Page Archive/a b');
  assert.equal(G.safeFolder('C:\\Windows'), 'C/Windows');
  assert.equal(G.safeFolder(''), '');
});

test('PDF text layer is invisible, Unicode-mapped and present only when text is supplied', () => {
  const jpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0, 100, 0, 200, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 0xFF, 0xD9]);
  const plain = Buffer.from(PDF.buildPdf([{ jpeg }])).toString('latin1');
  assert.doesNotMatch(plain, /Type0/);
  const withText = Buffer.from(PDF.buildPdf([{ jpeg, cssWidth: 200, cssHeight: 100, text: [{ x: 1, y: 2, w: 50, h: 10, text: '\u0928\u092e\u0938\u094d\u0924\u0947 caf\u00e9' }] }])).toString('latin1');
  assert.match(withText, /\/Subtype \/Type0 \/BaseFont \/PageArchiveText \/Encoding \/Identity-H/);
  assert.match(withText, / 3 Tr /);
  assert.match(withText, /\/ToUnicode/);
  assert.equal(PDF.utf16Hex('A\u00e9'), '004100e9');
  assert.equal(PDF.utf16Hex('\u{1F600}'), '003f');
});

test('site presets locate conversations by stable markers and walk up to the real scroller', () => {
  for (const name of ['ChatGPT', 'Claude', 'Gemini', 'Perplexity', 'Google Colab']) assert.match(content, new RegExp(`name: '${name}'`));
  assert.match(content, /data-message-author-role/);
  assert.match(content, /data-testid="user-message"/);
  assert.match(content, /function scrollableAncestor\(/);
  assert.match(content, /preset: preset \? preset\.name : null/);
});

test('auto-expand never clicks real links, form submits or destructive labels', () => {
  assert.match(content, /if \(href && href !== '#' && !\/\^javascript:\/i\.test\(href\)\) return false;/);
  assert.match(content, /if \(type === 'submit' && el\.form\) return false;/);
  assert.match(content, /const NEVER_CLICK = \/delete\|remove/);
  assert.match(content, /round < 3 && clicks < 40/);
  assert.match(content, /d\.open = false/);
});

test('text runs are collected for PDF only and shipped to the stitcher before tiles', () => {
  assert.equal(P.isPageCommand('PAC_COLLECT_TEXT'), true);
  assert.equal(P.isStitcherCommand('PAC_STORE_TEXT'), true);
  assert.match(background, /if \(settings\.format === 'pdf'\) \{[\s\S]{0,200}PAC_COLLECT_TEXT/);
});

test('Lite build drops the debugger permission and the worker stays quiet about it', () => {
  const build = fs.readFileSync(path.join(root, 'tools', 'build-editions.mjs'), 'utf8');
  assert.match(build, /lite\.permissions = lite\.permissions\.filter\(p => p !== 'debugger'\)/);
  assert.match(background, /const IS_FULL_EDITION = /);
  assert.match(background, /if \(IS_FULL_EDITION\) report\.warnings\.push/);
});

test('ChatGPT preset uses the 2026-10 turn markers first and skips hidden thread copies', () => {
  const chatgpt = content.match(/name: 'ChatGPT'[^\n]*/)[0];
  assert.ok(chatgpt.indexOf("'[data-turn-key]'") >= 0, 'current turn marker missing');
  assert.ok(chatgpt.indexOf("'[data-turn-key]'") < chatgpt.indexOf("'[data-message-author-role]'"), 'current markers must come before the old ones');
  // ChatGPT keeps 0x0 copies of other threads earlier in the DOM.
  assert.match(content, /function isLaidOut\(el\)/);
  assert.match(content, /if \(isLaidOut\(hit\)\) return hit;/);
});

test('panel pin hides paintless end spacers that grow with the viewport', () => {
  const pin = content.slice(content.indexOf('function renderPinPanel'), content.indexOf('function isBottomPinnedInPanel'));
  assert.match(pin, /const el = state\.scroller;\s*renderFreeEndSpacers\(\);/, 'spacers must be hidden before the content height is measured');
  assert.match(content, /state\.endSpacersHidden = hideTrailingSpacers\(state\.scroller\);/);
  const walk = content.slice(content.indexOf('function hideTrailingSpacers'), content.indexOf('function renderPinPanel'));
  assert.match(walk, /if \(isPaintlessBox\(child\)\)/, 'only boxes that paint nothing may be hidden');
  assert.match(walk, /snapshotStyleOnce\(child, 'display'\)/, 'hidden spacers must be restored');
  assert.match(walk, /height >= contentH \* 0\.5\) next = child;\s*break;/, 'the walk stops at the last real content');
  const paint = content.slice(content.indexOf('function isPaintlessBox'), content.indexOf('function hideTrailingSpacers'));
  assert.match(paint, /textContent\.trim\(\) !== ''\) return false/);
  assert.match(paint, /backgroundImage !== 'none'/);
  const suite = JSON.parse(fs.readFileSync(path.join(__dirname, 'e2e', 'suite.json'), 'utf8'));
  assert.ok(suite.some(c => c.name === 'end-spacer' && c.expect.maxTrailingBlank));
  // Gemini: script-set inline min-height on the last turn is overridden by an
  // !important rule, before the first viewport growth, and unmarked on restore.
  assert.match(walk, /child\.style\.minHeight && !child\.hasAttribute\('data-page-archive-free-height'\)/);
  assert.match(content, /\[data-page-archive-free-height\] \{ min-height: 0 !important; \}/);
  assert.match(content, /PAC_RENDER_MEASURE'\) \{\s*if \(!state\)[^\n]*\n\s*renderFreeEndSpacers\(\);/);
  assert.match(content, /el\.removeAttribute\('data-page-archive-free-height'\)/);
  assert.ok(suite.some(c => c.name === 'end-min-height' && c.url.includes('gemini.google.com') && c.expect.maxTrailingBlank));
  // Button-sized absolute overlays outside the panel (Gemini's scroll-to-bottom button) are hidden.
  const hide = content.slice(content.indexOf('function renderHideFloating'), content.indexOf('// ---- Expand collapsed content'));
  assert.match(hide, /cs\.position === 'absolute' && !\(r\.width <= 120 && r\.height <= 120\)\) continue;/);
  assert.ok(suite.some(c => c.name === 'end-min-height' && c.expect.absentColor));
  assert.ok(fs.existsSync(path.join(__dirname, 'site-fixture', 'end-spacer.html')));
});

test('panel render hides bars pinned to the bottom edge inside the panel', () => {
  assert.match(content, /if \(state\.scroller\.contains\(el\)\) \{\s*\/\/[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*if \(!isBottomPinnedInPanel\(el, cs, r, panelRect\)\) continue;/);
  const fn = content.slice(content.indexOf('function isBottomPinnedInPanel'), content.indexOf('function renderHideFloating'));
  assert.match(fn, /cs\.bottom === 'auto' \|\| cs\.top !== 'auto'/, 'top-pinned sticky headers must be kept');
  assert.match(fn, /r\.height <= 320 && r\.height < panelRect\.h \* 0\.5/, 'only bar-sized elements may be hidden');
  assert.match(fn, /r\.bottom >= panelBottom - 400/, 'sticky bars may end above the space reserved for the composer');
  assert.match(fn, /Math\.abs\(r\.bottom - panelBottom\) <= 4/, 'absolute elements must touch the bottom edge');
  const suite = JSON.parse(fs.readFileSync(path.join(__dirname, 'e2e', 'suite.json'), 'utf8'));
  assert.ok(suite.some(c => c.name === 'chatgpt-composer' && c.expect.absentColor));
  assert.ok(fs.existsSync(path.join(__dirname, 'site-fixture', 'chatgpt-thread.html')));
});

test('ASCII check skips the gitignored local browser and profile folder', () => {
  const check = fs.readFileSync(path.join(root, 'scripts', 'check-ascii.mjs'), 'utf8');
  const skip = check.match(/const SKIP_DIRS = new Set\(\[([^\]]*)\]\)/)[1];
  for (const dir of ['node_modules', '.e2e', '.local', 'dist']) assert.ok(skip.includes(`'${dir}'`), `${dir} must be skipped`);
});

test('popup file rows truncate in the middle and never widen the popup', () => {
  const popupJs = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'popup.css'), 'utf8');
  const src = popupJs.match(/function splitFileName\(filename\) \{[\s\S]*?\n\}\n/)[0];
  const splitFileName = new Function(`${src}; return splitFileName;`)();
  assert.deepEqual(splitFileName('Extension improvement and overhaul - Claude_part-02-of-03.png'),
    ['Extension improvement and overhaul - Claude', '_part-02-of-03.png']);
  assert.deepEqual(splitFileName('a.png'), ['', 'a.png']);
  assert.equal(splitFileName('History of the Internet - Wikipedia.pdf').join(''), 'History of the Internet - Wikipedia.pdf');
  // Long names once forced the popup 48px wider than 372px and clipped the card.
  assert.match(css, /\.files \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.files li \{ min-width: 0;/);
  assert.match(css, /\.files \.fhead \{ min-width: 0; overflow: hidden; text-overflow: ellipsis; \}/);
  assert.match(css, /\.files \.ftail \{ flex: none; \}/);
  // A height cap with hidden scrollbars cut the last warning mid-sentence.
  assert.doesNotMatch(css.match(/\n\.warnings \{[^}]*\}/)[0], /max-height/);
});

test('built editions carry a build stamp the popup shows, so testers can confirm a reload', () => {
  const build = fs.readFileSync(path.join(root, 'tools', 'build-editions.mjs'), 'utf8');
  const popupJs = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
  assert.match(build, /base\.version_name = `\$\{base\.version\} build \$\{stamp\}`;/);
  assert.match(build, /\['rev-parse', '--short', 'HEAD'\]/);
  // The source manifest stays clean; only built copies are stamped.
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version_name, undefined);
  assert.match(html, /<p class="build" id="build" hidden><\/p>/);
  assert.match(popupJs, /chrome\.runtime\.getManifest\(\)\.version_name/);
  assert.match(popupJs, /\$\('build'\)\.hidden = false;/);
});

test('one-time review prompt: after the 3rd success, shown once, local link only', () => {
  const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
  const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
  assert.match(background, /if \(phase === 'done'\) \{\s*chrome\.storage\.local\.get\('pageArchiveCaptureCount'\)/);
  assert.match(popup, /const RATE_AFTER = 3;/);
  const fn = popup.slice(popup.indexOf('async function maybeShowRating'), popup.indexOf("$('rate-yes')"));
  assert.match(fn, /if \(s\.pageArchiveRatingAsked \|\| \(Number\(s\.pageArchiveCaptureCount\) \|\| 0\) < RATE_AFTER\) return;/);
  assert.ok(fn.indexOf('pageArchiveRatingAsked: true') < fn.indexOf("$('rate').hidden = false"), 'marked as asked before it is shown');
  assert.match(popup, /chromewebstore\.google\.com\/detail\/\$\{id\}\/reviews/);
  assert.match(popup, /if \(phase === 'done'\) maybeShowRating\(\);/);
  assert.match(html, /<div id="rate" class="rate" hidden>/);
  assert.match(fs.readFileSync(path.join(root, 'PRIVACY.md'), 'utf8'), /Capture count and review flag/);
});
