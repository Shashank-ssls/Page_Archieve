const test = require('node:test');
const assert = require('node:assert/strict');
const { isRestrictedUrl } = require('../url-policy.js');

test('blocks Chrome and Edge internal pages', () => {
  assert.equal(isRestrictedUrl('chrome://extensions/'), true);
  assert.equal(isRestrictedUrl('chrome://downloads/'), true);
  assert.equal(isRestrictedUrl('edge://extensions/'), true);
});

test('blocks extension, devtools, and view-source pages', () => {
  assert.equal(isRestrictedUrl('chrome-extension://abcdefghijklmnop/popup.html'), true);
  assert.equal(isRestrictedUrl('devtools://devtools/bundled/inspector.html'), true);
  assert.equal(isRestrictedUrl('view-source:https://example.com'), true);
  assert.equal(isRestrictedUrl('about:blank'), true);
});

test('blocks the extension stores, which Chrome never lets extensions script', () => {
  const { isStorePage } = require('../url-policy.js');
  assert.equal(isRestrictedUrl('https://chromewebstore.google.com/search/page%20archive'), true);
  assert.equal(isRestrictedUrl('https://chrome.google.com/webstore/detail/abc'), true);
  assert.equal(isRestrictedUrl('https://microsoftedge.microsoft.com/addons/detail/abc'), true);
  assert.equal(isStorePage('https://chromewebstore.google.com/'), true);
  assert.equal(isStorePage('chrome://extensions/'), false);
  // Neighbours stay capturable.
  assert.equal(isRestrictedUrl('https://chrome.google.com/'), false);
  assert.equal(isRestrictedUrl('https://www.google.com/search?q=webstore'), false);
  assert.equal(isRestrictedUrl('https://microsoftedge.microsoft.com/'), false);
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'popup.html'), 'utf8');
  assert.ok(html.indexOf('url-policy.js') > 0 && html.indexOf('url-policy.js') < html.indexOf('popup.js'), 'popup loads the shared policy first');
});

test('allows normal web pages and local fixture pages', () => {
  assert.equal(isRestrictedUrl('https://example.com/article'), false);
  assert.equal(isRestrictedUrl('http://127.0.0.1:8765/tests/site-fixture/'), false);
});

test('fails closed for invalid or empty URL values', () => {
  assert.equal(isRestrictedUrl(''), true);
  assert.equal(isRestrictedUrl(undefined), true);
  assert.equal(isRestrictedUrl('not a url'), true);
});
