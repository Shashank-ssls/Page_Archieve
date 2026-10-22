const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../protocol.js');

test('page content handler accepts only page operations', () => {
  for (const type of ['PAC_VISIBLE_INFO', 'PAC_PREPARE', 'PAC_SET_TILE', 'PAC_RESTORE', 'PAC_CANCEL_PREPARE']) {
    assert.equal(P.isPageCommand(type), true, `${type} should be handled by the page script`);
  }
  for (const type of ['PAC_BEGIN', 'PAC_STORE_TILE', 'PAC_COMPOSE', 'PAC_PROGRESS', 'PAC_START', 'PAC_CANCEL']) {
    assert.equal(P.isPageCommand(type), false, `${type} must not be answered by the page script`);
  }
});

test('stitcher handler accepts only assembly operations', () => {
  for (const type of ['PAC_PING', 'PAC_BEGIN', 'PAC_STORE_TILE', 'PAC_COMPOSE', 'PAC_CANCEL_STITCH', 'PAC_CLEANUP']) {
    assert.equal(P.isStitcherCommand(type), true, `${type} should be handled by the stitcher`);
  }
  for (const type of ['PAC_VISIBLE_INFO', 'PAC_PREPARE', 'PAC_SET_TILE', 'PAC_RESTORE', 'PAC_PROGRESS', 'PAC_START']) {
    assert.equal(P.isStitcherCommand(type), false, `${type} must not be answered by the stitcher`);
  }
});

test('page and stitcher command namespaces do not overlap', () => {
  const known = [
    'PAC_VISIBLE_INFO', 'PAC_PREPARE', 'PAC_SET_TILE', 'PAC_RESTORE', 'PAC_CANCEL_PREPARE',
    'PAC_PING', 'PAC_BEGIN', 'PAC_STORE_TILE', 'PAC_COMPOSE', 'PAC_CANCEL_STITCH', 'PAC_CLEANUP'
  ];
  for (const type of known) assert.notEqual(P.isPageCommand(type) && P.isStitcherCommand(type), true);
});
