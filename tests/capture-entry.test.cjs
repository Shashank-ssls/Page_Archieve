const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

test('full-page capture rejects restricted browser pages but visible-area capture may use captureVisibleTab', () => {
  const tabLookup = source.indexOf('const tab = await getTab(tabId);');
  const restrictedGuard = source.indexOf("if (restrictedPage && mode !== 'visible')");
  const visibleBranch = source.indexOf("if (mode === 'visible')");
  const openStitcher = source.indexOf('job.stitcherTabId = await openStitcher', restrictedGuard);
  assert.ok(tabLookup >= 0 && restrictedGuard > tabLookup && openStitcher > restrictedGuard);
  assert.ok(visibleBranch > restrictedGuard);
  assert.match(source, /visible-area screenshot; page scrolling and full-page inspection are restricted/);
});

test('visible-area capture is explicit and full-page failures do not silently fall back', () => {
  assert.match(source, /if \(mode === 'visible'\) \{[\s\S]{0,350}takeVisibleCapture/);
  assert.doesNotMatch(source, /takeVisibleFallback/);
  assert.match(source, /Full-page capture could not inspect this tab:[\s\S]{0,260}No image was exported/);
});

test('large page-height and screenshot-count safety limits allow many split output parts', () => {
  assert.match(source, /const MAX_CAPTURE_TILES = 800/);
  assert.match(source, /const MAX_CAPTURE_CSS_HEIGHT = 300000/);
});

test('capture target selector supports smart, document and panel modes', () => {
  assert.match(source, /\['auto', 'document', 'panel'\]\.includes\(settings\.captureTarget\)/);
  const content = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'content.js'), 'utf8');
  assert.match(content, /\(preset && preset\.scroller\) \|\| getInnerScroller\(target === 'panel'\)/);
  assert.match(content, /normalizeInnerScroller/);
  assert.match(content, /chatgpt\\.com.*claude\\.ai/);
  assert.match(content, /contentFingerprint/);
});

test('panel-only capture hides overlapping fixed overlays outside the selected scroller on later tiles', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  assert.match(content, /function rectsOverlap\(/);
  assert.match(content, /const isInsideScroller = state\.scroller && state\.scroller\.contains\(el\)/);
  assert.match(content, /!isInsideScroller && !overlapsCrop/);
  assert.match(content, /state\.hiddenPinnedElements\.has\(el\)/);
  assert.match(content, /el === state\.scroller \|\| \(typeof el\.contains === 'function' && el\.contains\(state\.scroller\)\)/);
  const fixture = fs.readFileSync(path.join(__dirname, 'site-fixture', 'app-scroll-panel.html'), 'utf8');
  assert.match(fixture, /id="fixed-composer"/);
  assert.match(fixture, /should appear only in the first PNG tile/);
});

test('Smart mode rejects a mostly offscreen inner panel and falls back to the scrolling document when possible', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  const geometry = fs.readFileSync(path.join(__dirname, '..', 'geometry.js'), 'utf8');
  assert.match(geometry, /function isHeavilyClippedPanel\(/);
  assert.match(content, /G\.isHeavilyClippedPanel\(/);
  assert.match(content, /if \(severelyClipped && !force\)/);
  assert.match(content, /lastPanelSelectionIssue/);
  assert.match(content, /rootMetrics\(\)\.pageH <= window\.innerHeight \+ 220/);
  assert.match(content, /Scroll the app until the conversation panel begins within the viewport/);
  const fixture = fs.readFileSync(path.join(__dirname, 'site-fixture', 'offscreen-panel.html'), 'utf8');
  assert.match(fixture, /OUTER DOCUMENT FINAL MARKER/);
  assert.match(fixture, /height: 8000px/);
});

test('popup explains why full-page capture is unavailable on browser-internal pages', () => {
  const popup = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'popup.html'), 'utf8');
  assert.match(popup, /isRestrictedBrowserUrl/);
  assert.match(popup, /fullButton\.disabled = value \|\| restrictedActiveTab/);
  assert.match(html, /id="context-hint"/);
  assert.match(popup, /Visible area PNG captures the current viewport only/);
});

test('popup offers taller capture heights and a 5-second image wait', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'popup.html'), 'utf8');
  const popup = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
  assert.match(html, /value="300000"/);
  assert.match(html, /value="5000"/);
  assert.match(popup, /maxHeight: 200000, waitMs: 3500/);
  assert.match(popup, /pageArchiveSettingsVersion: 5/);
});


test('Smart panel selection is conservative on ordinary tall pages', () => {
  const geometry = fs.readFileSync(path.join(__dirname, '..', 'geometry.js'), 'utf8');
  const content = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  assert.match(geometry, /function shouldUseInnerScroller/);
  assert.match(content, /G\.shouldUseInnerScroller\(/);
  assert.doesNotMatch(content, /best\.scrollHeight > rootM\.pageH \* 1\.35/);
});

test('inner-panel movement is corrected before tile coordinates are sent to the stitcher', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  assert.match(content, /function stabilizeInnerScroller\(/);
  assert.match(content, /await stabilizeInnerScroller\(\);[\s\S]{0,160}await afterPaint\(\);[\s\S]{0,100}await stabilizeInnerScroller\(\);/);
  assert.match(content, /G\.anchorCorrection\(/);
  assert.match(content, /window\.scrollTo\(previous\.outerOriginalX, previous\.outerOriginalY\)/);
  assert.match(content, /panel changed size during capture/);
  assert.match(source, /Examples: \$\{examples\}/);
});


test('script-injection failure on restricted pages explains the visible-area alternative', () => {
  assert.match(source, /Chrome blocked script injection on this browser-internal or extension page/);
  assert.match(source, /choose Visible area for the viewport/);
  assert.match(source, /cannot access contents of url/i);
});


test('popup fails closed if Chrome hides a restricted tab URL and leaves visible capture available', () => {
  const popup = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
  assert.match(popup, /const urlHidden = typeof url !== 'string' \|\| url\.length === 0/);
  assert.match(popup, /restrictedActiveTab = knownRestricted \|\| urlHidden/);
  assert.match(popup, /visibleButton\.disabled = value/);
  assert.match(popup, /Chrome did not expose this tab\\u2019s URL/);
});

test('moving-panel regression fixture simulates a 152px parent shift during inner scrolling', () => {
  const fixture = fs.readFileSync(path.join(__dirname, 'site-fixture', 'moving-panel.html'), 'utf8');
  const content = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  assert.match(fixture, /translateY\(-152px\)/);
  assert.match(fixture, /FINAL MARKER/);
  assert.match(content, /recordScrollerAnchor\(\)/);
  assert.match(content, /state\.scrollerAnchorOffset\.y \+= correction\.y/);
  assert.match(content, /style\.setProperty\('translate',[\s\S]{0,150}'important'\)/);
});

test('inner-panel anchor is recorded before preparation scrolling can trigger a shell shift', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  const anchor = content.indexOf('if (inner) recordScrollerAnchor();');
  const preload = content.indexOf('const result = await preloadPage(settings);');
  const postPreloadStabilize = content.indexOf('if (inner) await stabilizeInnerScroller();', preload);
  assert.ok(anchor >= 0 && preload > anchor, 'anchor must be recorded before prepareImages/autoLoadMore scrolls the app');
  assert.ok(postPreloadStabilize > preload, 'panel must be re-anchored after preload before geometry is measured');
  assert.ok(content.indexOf('const metrics = currentMetrics();', postPreloadStabilize) > postPreloadStabilize);
});


test('restore waits for scroll-triggered app-shell handlers after returning the source panel to its origin', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  assert.match(content, /if \(message\.type === 'PAC_RESTORE'\) \{\s*restoreAll\(\);[\s\S]{0,300}await afterPaint\(\);[\s\S]{0,80}await sleep\(40\);/);
});


test('bounded inner-panel drift uses actual tile coordinates and leaves coverage validation authoritative', () => {
  const geometry = fs.readFileSync(path.join(__dirname, '..', 'geometry.js'), 'utf8');
  assert.match(geometry, /function safeTileDriftTolerance/);
  assert.match(source, /G\.safeTileDriftTolerance\(metrics\.captureH, 0\.14\)/);
  assert.match(source, /will still reject the export if the final image has a coverage gap/);
  assert.match(source, /requested \$\{Math\.round\(req\.x\)\},\$\{Math\.round\(req\.y\)\}; actual/);
});

test('a small final panel-height decrease can adjust output extent only when the last tile reaches the live bottom', () => {
  assert.match(source, /G\.adjustedFinalPanelHeight\(outputPageHeight, liveHeight, actualY, actualTileH, endTolerance\)/);
  assert.match(source, /G\.adjustedFinalPanelHeight\(outputPageHeight, liveHeight, actualY, actualTileH, endTolerance\)/);
  assert.match(source, /pageHeightOverride: captured.outputPageHeight/);
  const stitcher = fs.readFileSync(path.join(__dirname, '..', 'stitcher.js'), 'utf8');
  assert.match(stitcher, /requestedHeightOverride > 0/);
  assert.match(stitcher, /Math\.min\(baseHeight, Math\.floor\(requestedHeightOverride\)\)/);
});


test('notebook reflow fixture reproduces an 11px height shrink at the final scroll edge', () => {
  const fixture = fs.readFileSync(path.join(__dirname, 'site-fixture', 'notebook-reflow.html'), 'utf8');
  assert.match(fixture, /panel\.clientHeight \+ 984/);
  assert.match(fixture, /panel\.scrollHeight - 11/);
  assert.match(fixture, /bottomVisits >= 2/);
  assert.match(fixture, /FINAL MARKER &#x2014; capture reached the end/);
  assert.match(source, /G\.adjustedFinalPanelHeight\(outputPageHeight, liveHeight, actualY, actualTileH, endTolerance\)/);
  assert.match(source, /pageHeightOverride: captured.outputPageHeight/);
});
