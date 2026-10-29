const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../geometry.js');

const src = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');

test('geometry scroller is the first ancestor that scrolls more than 20 px', () => {
  const chain = [
    { overflowY: 'visible', scrollHeight: 900, clientHeight: 100 },
    { overflowY: 'auto', scrollHeight: 515, clientHeight: 500 },
    { overflowY: 'auto', scrollHeight: 4000, clientHeight: 600 },
    { overflowY: 'scroll', scrollHeight: 9000, clientHeight: 700 }
  ];
  assert.equal(G.firstScrollingAncestor(chain), 2);
  assert.equal(G.firstScrollingAncestor([{ overflowY: 'hidden', scrollHeight: 4000, clientHeight: 600 }]), -1);
  assert.equal(G.firstScrollingAncestor([]), -1);
});

test('geometry scroller skips app chrome such as a sidebar', () => {
  const chain = [
    { overflowY: 'auto', scrollHeight: 4000, clientHeight: 600, chrome: true },
    { overflowY: 'auto', scrollHeight: 3000, clientHeight: 600 }
  ];
  assert.equal(G.firstScrollingAncestor(chain), 1);
});

test('roles roughly alternate unless one role is missing from a long thread', () => {
  assert.equal(G.rolesAlternate(['u', 'a', 'u', 'a']), true);
  assert.equal(G.rolesAlternate(['u', 'a', 'a', 'u', 'a']), true);
  assert.equal(G.rolesAlternate(['u', 'u']), true);
  assert.equal(G.rolesAlternate(['a', 'a', 'a', 'a']), false);
  assert.equal(G.rolesAlternate([]), true);
});

test('detection postcondition reports the first failing check', () => {
  const good = { turnCount: 6, roles: ['u', 'a', 'u', 'a', 'u', 'a'], composerInside: false, isDocument: false, scrollRange: 3000 };
  assert.deepEqual(G.detectionPostcondition(good), { ok: true, reason: null });
  assert.equal(G.detectionPostcondition({ ...good, turnCount: 0 }).reason, 'zero-turns');
  assert.equal(G.detectionPostcondition({ ...good, roles: ['a', 'a', 'a', 'a'] }).reason, 'roles');
  assert.equal(G.detectionPostcondition({ ...good, composerInside: true }).reason, 'composer');
  assert.equal(G.detectionPostcondition({ ...good, scrollRange: 10 }).reason, 'not-scrollable');
  // A page that scrolls as a whole is a valid target even when short.
  assert.equal(G.detectionPostcondition({ ...good, isDocument: true, scrollRange: 0 }).ok, true);
});

test('presets use ordered anchor and turn lists, no Copilot cib-message, no Perplexity .prose', () => {
  assert.match(src, /anchors: \['\[data-turn-key\]'/);
  assert.match(src, /'\[data-message-id\]'/);
  assert.match(src, /'\.font-claude-response'/);
  assert.match(src, /'\[data-test-id="model-line"\]'/);
  assert.match(src, /'\[data-pplx-citation-url\]'/);
  assert.match(src, /'\[data-virtual-list-item-key\]'/);
  assert.doesNotMatch(src, /cib-message/);
  assert.doesNotMatch(src, /'\.prose'/);
  assert.doesNotMatch(src, /\[class\*="message"\]/);
});

test('detection records the winning layer and excludes chrome structurally', () => {
  assert.match(src, /layer: 'preset'/);
  assert.match(src, /layer: 'geometry'/);
  assert.match(src, /CHROME_SELECTOR = 'aside,nav,\[role="navigation"\],\[role="banner"\],textarea,\[contenteditable\],\[class\*="sidebar" i\]'/);
  assert.match(src, /detectionLayer: preset && !preset\.unmatched \? preset\.layer : \(inner \? 'auto' : 'document'\)/);
});

test('screen-reader-only labels are kept out of the PDF text layer', () => {
  assert.match(src, /function isScreenReaderOnly\(el\)/);
  assert.match(src, /screen-reader-user-query-label/);
});
