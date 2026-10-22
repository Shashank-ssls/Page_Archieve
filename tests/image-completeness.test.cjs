const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const fixture = fs.readFileSync(path.join(__dirname, 'site-fixture', 'image-audit.html'), 'utf8');

test('image auditor probes visible CSS backgrounds and generated pseudo-element images', () => {
  assert.match(content, /function collectVisibleCssImageAssets\(/);
  assert.match(content, /backgroundImage/);
  assert.match(content, /CSS generated background/);
  assert.match(content, /extractCssImageUrls/);
});

test('image auditor checks SVG image sources, video posters, and image-type inputs', () => {
  assert.match(content, /tag === 'image'/);
  assert.match(content, /SVG image/);
  assert.match(content, /getAttribute\('poster'\)/);
  assert.match(content, /tag === 'input'/);
  assert.match(content, /Image input/);
});

test('HTML image source detection uses actual and common lazy-source attributes without img.src fallback', () => {
  assert.match(content, /function imageDeclaredSource\(/);
  assert.match(content, /data-lazy-src/);
  assert.match(content, /data-original/);
  assert.match(content, /data-lazy-srcset/);
  assert.doesNotMatch(content, /img\.currentSrc\s*,\s*img\.src\s*,/);
});

test('decode rejection and incomplete source states are counted in audit summaries', () => {
  assert.match(content, /decodeFailures\.add\(img\)/);
  assert.match(content, /incompleteHtmlImages\.add\(img\)/);
  assert.match(content, /htmlImageFailuresDetected/);
  assert.match(content, /cssAssetsFailed/);
});

test('CSS verification is bounded and records timeout as unverified rather than confirmed broken', () => {
  assert.match(content, /const tileLimit = 40/);
  assert.match(content, /cssAssetResults\.size >= 200/);
  assert.match(content, /result === 'loaded' \|\| result === 'broken'/);
  assert.match(content, /timedOutCssAssets\.add/);
  assert.match(content, /unverified, not confirmed broken/);
});


test('CSS failures discovered during preparation remain reportable after a virtualized element leaves view', () => {
  assert.match(content, /Return all confirmed CSS\/embedded failures seen during preparation\/capture/);
  assert.match(content, /audit\.cssAssetResults\.entries\(\)/);
  assert.match(content, /map\(\(\[url\]\) => audit\.cssAssetLabels\.get\(url\)/);
});

test('image-set alternatives are not falsely flagged independently', () => {
  assert.match(content, /image-set\\s\*\\\(/);
  assert.match(content, /imageSetUnverified = true/);
});

test('capture result includes an aggregate audit summary and CSS failure details', () => {
  assert.match(content, /cssImageFailures: imageAudit\.cssImageFailures/);
  assert.match(content, /auditSummary: imageAudit\.auditSummary/);
  assert.match(background, /failedCssImageLabels/);
  assert.match(background, /Image audit: saw/);
  assert.match(background, /CSS, SVG, poster, or embedded image asset/);
});

test('local fixture includes expected positive and negative image asset types', () => {
  assert.match(fixture, /Valid data image/);
  assert.match(fixture, /missing-html-test-asset/);
  assert.match(fixture, /missing-background-test-asset/);
  assert.match(fixture, /missing-pseudo-test-asset/);
  assert.match(fixture, /missing-svg-test-asset/);
  assert.match(fixture, /missing-poster-test-asset/);
  assert.match(fixture, /missing-input-test-asset/);
  assert.match(fixture, /FINAL MARKER &#x2014; image audit fixture reached the end/);
});
