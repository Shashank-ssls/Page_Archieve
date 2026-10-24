const test = require('node:test');
const assert = require('node:assert');
const R = require('../redact.js');
const kinds = (t, w) => R.findSecrets(t, w).map(h => [t.slice(h.start, h.end), h.kind]);

test('detects seeded secrets', () => {
  const cases = [
    ['mail jane.doe@example.co.uk now', 'jane.doe@example.co.uk', 'email'],
    ['card 4111 1111 1111 1111 ok', '4111 1111 1111 1111', 'card'],
    ['iban GB82 WEST 1234 5698 7654 32 end', 'GB82 WEST 1234 5698 7654 32', 'iban'],
    ['call +1 415-555-0132 today', '+1 415-555-0132', 'phone'],
    ['mobile 9876543210 ok', '9876543210', 'phone'],
    ['key sk-proj-abcDEF1234567890xyzQWE here', 'sk-proj-abcDEF1234567890xyzQWE', 'key'],
    ['aws AKIAIOSFODNN7EXAMPLE x', 'AKIAIOSFODNN7EXAMPLE', 'key'],
    ['gh ghp_aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0iL3oR6 x', 'ghp_aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0iL3oR6', 'key'],
    ['host 192.168.10.24 up', '192.168.10.24', 'ip'],
    ['v6 2001:0db8:85a3:0000:0000:8a2e:0370:7334 up', '2001:0db8:85a3:0000:0000:8a2e:0370:7334', 'ip'],
    ['open https://app.example.com/reset?user=1&token=Zx81kQ now', 'https://app.example.com/reset?user=1&token=Zx81kQ', 'url'],
    ['random Qm9vZ1lYa3pUcE5wR2hJeTRrN2xNcA9 x', 'Qm9vZ1lYa3pUcE5wR2hJeTRrN2xNcA9', 'key']
  ];
  for (const [text, secret, kind] of cases) assert.deepStrictEqual(kinds(text), [[secret, kind]], text);
});

test('leaves ordinary text alone', () => {
  for (const t of ['Released on 2026-10-24 as version 2.3.0', 'Order 1234 shipped', 'card 4111 1111 1111 1112 fails Luhn', 'See https://example.com/docs?page=2', 'internationalization-and-localization-guide', 'Call at 10:30 or 11:45']) {
    assert.deepStrictEqual(kinds(t), [], t);
  }
});

test('user word list matches case-insensitively on word edges', () => {
  assert.deepStrictEqual(kinds('Ask Priya or PRIYANKA', ['priya']), [['Priya', 'word']]);
  assert.deepStrictEqual(R.parseWordList('Priya, Acme Corp\nx'), ['Priya', 'Acme Corp']);
});

test('redactRuns removes words from text and boxes exactly those words', () => {
  const run = [10, 20, 200, 16, 14, 'mail me at a@b.io please', [0, 30, 34, 50, 54, 64, 68, 110, 114, 160]];
  const res = R.redactRuns([run], []);
  assert.deepStrictEqual(res.boxes, [[10 + 68 - 2, 18, 42 + 4, 20, 'email']]);
  assert.deepStrictEqual(res.runs.map(r => r[5]), ['mail me at', 'please']);
  assert.ok(!JSON.stringify(res.runs).includes('a@b.io'));
  assert.deepStrictEqual(res.counts, { email: 1 });
});

test('a run without word edges is covered and dropped whole', () => {
  const res = R.redactRuns([[0, 0, 100, 10, 12, 'x a@b.io']], []);
  assert.strictEqual(res.runs.length, 0);
  assert.deepStrictEqual(res.boxes, [[-2, -2, 104, 14, 'email']]);
});

test('redactString and summary', () => {
  assert.strictEqual(R.redactString('to a@b.io', []).text, 'to [redacted]');
  assert.strictEqual(R.summary({ email: 2, card: 1 }), '2 emails, 1 card number');
});

const fs = require('fs');
const path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('a redacted capture never falls back to an engine without text', () => {
  const bg = src('background.js');
  assert.match(bg, /if \(settings\.redact && !job\.cdp\) throw/);
  assert.match(bg, /if \(settings\.redact\) throw new Error\(`Full render could not complete/);
  assert.match(bg, /if \(job\.settings\.redact\) throw new Error/);
  // Visible area redacts too (owner, 2026-10-24); only browser pages refuse.
  assert.match(bg, /if \(mode === 'visible' && settings\.redact && restrictedPage\) throw/);
  assert.match(bg, /PAC_COLLECT_TEXT', visible: true, wordEdges: true/);
  assert.match(bg, /if \(settings\.redact\) throw new Error\(`Could not read the page text for Share-safe Redact/);
  assert.match(bg, /settings\.redact = settings\.redact === true && IS_FULL_EDITION/);
});

test('the review screen waits for the user and the worker gives it time', () => {
  const st = src('stitcher.js');
  const bg = src('background.js');
  assert.match(st, /if \(message\.review\) \{[\s\S]{0,200}reviewRedactions\(/);
  assert.match(st, /Capture cancelled during the redaction review\. Nothing was saved\./);
  assert.match(st, /PAC_REVIEW_ALIVE/);
  assert.match(st, /extras\.marks = \(extras\.marks \|\| \[\]\)\.filter\(m => !covers\(m\)\)/);
  assert.match(bg, /const review = settings\.redact && settings\.redactReview;/);
  assert.match(bg, /review \? 60 \* 60 \* 1000 : 300000/);
  assert.match(bg, /settings\.redactReview = settings\.redactReview !== false;/);
  const html = src('stitcher.html');
  for (const id of ['review', 'review-stage', 'review-save', 'review-cancel', 'review-stats']) assert.ok(html.includes(`id="${id}"`), id);
});

test('the stitcher burns boxes before encoding and scrubs links, bookmarks and title', () => {
  const st = src('stitcher.js');
  const burn = st.indexOf("ctx.fillStyle = '#000000'");
  const encode = st.indexOf('canvas.toBlob(');
  assert.ok(burn > 0 && burn < encode);
  assert.match(st, /textRuns\.set\(message\.captureId, RD\.stripRunsUnder\(original, boxes\)\)/);
  assert.match(st, /extras\.links = \(extras\.links \|\| \[\]\)\.filter\(l => !hit\(l\)/);
  assert.match(st, /session\.title = RD\.scrubWords\(scrub\(/);
  assert.ok(src('stitcher.html').includes('<script src="redact.js"></script>'));
  assert.ok(src('tools/build-editions.mjs').includes("'redact.js'"));
});

test('form field values are collected so Redact sees them', () => {
  const c = src('content.js');
  assert.match(c, /collectField\(node\);/);
  assert.match(c, /tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT'/);
  assert.match(c, /message\.wordEdges && r\.edges \?/);
});

test('JPEG output is gone from the popup and falls back to PNG', () => {
  assert.ok(!src('popup.html').includes('value="jpeg"'));
  assert.match(src('background.js'), /const FORMATS = \['png', 'pdf'\];/);
  assert.match(src('stitcher.js'), /const FORMATS = \['png', 'pdf'\];/);
});

test('PDF viewer tabs are refused and drawn areas are reported under Redact', () => {
  const c = src('content.js');
  assert.match(c, /document\.contentType === 'application\/pdf'/);
  assert.ok(c.includes('built-in PDF viewer. Chrome draws its pages itself'));
  assert.match(c, /\/\^\(CANVAS\|EMBED\|OBJECT\|IFRAME\)\$\/\.test\(node\.tagName\)/);
  assert.match(src('background.js'), /settings\.redact && collected\.drawn > 0/);
});

test('a wrapped word is boxed on every line; shadows never reach the PDF text', () => {
  const runs = [
    [0, 0, 150, 20, 16, 'examples@novusstreamsolutions.com', [0, 150]],
    [0, 20, 90, 20, 16, 'examples@novusstreamsolutions.com', [0, 90], 1],
    [0, 40, 60, 20, 16, 'harmless', [0, 60], 1]
  ];
  const res = R.redactRuns(runs, []);
  assert.strictEqual(res.boxes.length, 2);
  assert.deepStrictEqual(res.runs, []);
});

test('file names with digits are not mistaken for keys', () => {
  assert.deepStrictEqual(kinds('see application-for-payment-002-summary.csv and certificate-for-payment-002.pdf'), []);
  assert.deepStrictEqual(kinds('DEMO_API_KEY_7f2c9e14a8b6d3f0').map(k => k[1]), ['key']);
});

test('stripRunsUnder follows the final boxes: drawn boxes remove words, turned-off ones keep them', () => {
  const run = [0, 0, 100, 10, 12, 'call Ana now', [0, 20, 25, 45, 50, 70]];
  assert.deepStrictEqual(R.stripRunsUnder([run], [[24, -2, 23, 14]]).map(r => r[5]), ['call', 'now']);
  assert.deepStrictEqual(R.stripRunsUnder([run], []).map(r => r[5]), ['call Ana now']);
  assert.deepStrictEqual(R.stripRunsUnder([[0, 0, 50, 10, 12, 'x y']], [[10, 0, 5, 5]]), []);
  assert.deepStrictEqual(R.stripRunsUnder([[0, 0, 50, 10, 12, 'x', [0, 50], 1]], []), []);
});

test('a value split over several pieces on one line is still found', () => {
  const runs = [[0, 0, 40, 16, 14, '4242', [0, 40]], [48, 0, 40, 16, 14, '4242', [0, 40]], [96, 0, 40, 16, 14, '4242', [0, 40]], [144, 0, 40, 16, 14, '4242', [0, 40]], [200, 0, 60, 16, 14, 'Visa', [0, 60]]];
  const res = R.redactRuns(runs, []);
  assert.strictEqual(res.boxes.length, 4);
  assert.deepStrictEqual(res.runs.map(r => r[5]), ['Visa']);
  assert.deepStrictEqual(res.counts, { card: 1 });
  assert.deepStrictEqual(kinds('STORYWEAVE_LLM_MODEL=qwen2.5:7b'), []);
});

test('words under the final boxes are scrubbed from titles and bookmarks', () => {
  const run = [0, 0, 100, 10, 12, 'Account notes', [0, 50, 55, 100]];
  const hidden = R.hiddenWords([run], [[-2, -2, 54, 14]]);
  assert.deepStrictEqual([...hidden], ['account']);
  assert.strictEqual(R.scrubWords('Account notes', hidden), '[redacted] notes');
  assert.strictEqual(R.scrubWords('Account notes', new Set()), 'Account notes');
});

test('the review hides a clicked word everywhere and the panel follows a rebuilt scroller', () => {
  const st = src('stitcher.js');
  assert.match(st, /if \(r\.w \* scale < 4 \|\| r\.h \* scale < 4\) \{ hideWordAt\(draft0\); return; \}/);
  assert.match(st, /reviewRedactions\(message\.captureId, tiles, width, height, res\.boxes, format, original\)/);
  assert.match(st, /RD\.scrubWords\(scrub\(m\[3\]\), hidden\)/);
  const c = src('content.js');
  assert.match(c, /function liveScroller\(\)/);
  assert.match(c, /if \(twins\.length !== 1\) throw/);
  assert.match(c, /scrollerSig: inner \? \{ tag: inner\.tagName, cls: inner\.className \} : null/);
});
