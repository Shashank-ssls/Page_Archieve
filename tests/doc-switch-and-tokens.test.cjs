const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('Document on a non-scrolling app shell captures the panel and says so', () => {
  const src = read('content.js');
  assert.match(src, /target === 'document' && rootMetrics\(\)\.pageH <= window\.innerHeight \+ 1/);
  assert.match(src, /target = 'auto'; documentSwitched = true;/);
  assert.match(src, /Captured the main scroll panel instead/);
});

test('file name tokens are clickable and the preview uses the real tab', () => {
  const html = read('popup.html');
  for (const t of ['title', 'site', 'date', 'time']) assert.ok(html.includes(`data-token="{${t}}"`));
  assert.match(html, /placeholder="e\.g\. Tallshot\/\{site\}"/);
  const js = read('popup.js');
  assert.match(js, /input\.setRangeText\(btn\.dataset\.token/);
  assert.match(js, /previewTab\.title = tab\.title/);
});
