const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');

test('image readiness searches open shadow DOM and ordinary document images', () => {
  assert.match(source, /registerImageRoot\(document\)/);
  assert.match(source, /node\.shadowRoot/);
  assert.match(source, /rootNode\.querySelectorAll\('img'\)/);
});

test('lazy loading attributes are promoted only during the capture session and restored', () => {
  assert.match(source, /img\.loading = 'eager'/);
  assert.match(source, /imageLoadingSnapshots/);
  assert.match(source, /img\.removeAttribute\('loading'\)/);
});

test('visible images are awaited and decode is attempted before tile capture', () => {
  assert.match(source, /if \(!img\.complete\) await waitForImage\(img, perImageWait\)/);
  assert.match(source, /await waitForDecode\(img, Math\.min\(2500, Math\.max\(0, deadline - Date\.now\(\)\)\)\)/);
  assert.match(source, /naturalWidth === 0 \|\| img\.naturalHeight === 0/);
});

test('image wait handles dynamic images in two bounded passes and waits for pending fonts', () => {
  assert.match(source, /for \(let pass = 0; pass < 2; pass\+\+\)/);
  assert.match(source, /waitForVisibleFonts/);
  assert.match(source, /Math\.min\(5000, Number\(waitMs\)/);
});


test('default image settle budget is more patient and diagnostics include image source examples', () => {
  const popup = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
  const background = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
  assert.match(popup, /waitMs: 3500/);
  assert.match(background, /Examples: \$\{examples\}/);
  assert.match(background, /pixels cannot be reconstructed by the extension/);
});
