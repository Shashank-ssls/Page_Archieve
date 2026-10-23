const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const content = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');

test('script-set app heights follow the viewport during a panel render', () => {
  // Claude incognito (2026-10): height: calc(var(--app-visual-viewport-height, 100dvh) - ...)
  assert.match(content, /function followViewportHeights\(scroller\)/);
  assert.match(content, /state\.viewportHeightsFreed = followViewportHeights\(state\.scroller\)/);
  // Never taller than the viewport, or growth would never converge.
  assert.match(content, /calc\(100vh - \$\{Math\.max\(0, innerH - h\)\}px\)/);
  // Restored like every other temporary style.
  assert.match(content, /snapshotStyleOnce\(a, 'height'\)/);
});
