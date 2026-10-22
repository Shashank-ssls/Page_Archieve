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

test('allows normal web pages and local fixture pages', () => {
  assert.equal(isRestrictedUrl('https://example.com/article'), false);
  assert.equal(isRestrictedUrl('http://127.0.0.1:8765/tests/site-fixture/'), false);
});

test('fails closed for invalid or empty URL values', () => {
  assert.equal(isRestrictedUrl(''), true);
  assert.equal(isRestrictedUrl(undefined), true);
  assert.equal(isRestrictedUrl('not a url'), true);
});
