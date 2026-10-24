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
  assert.deepStrictEqual(res.boxes, [[10 + 68 - 2, 18, 42 + 4, 20]]);
  assert.deepStrictEqual(res.runs.map(r => r[5]), ['mail me at', 'please']);
  assert.ok(!JSON.stringify(res.runs).includes('a@b.io'));
  assert.deepStrictEqual(res.counts, { email: 1 });
});

test('a run without word edges is covered and dropped whole', () => {
  const res = R.redactRuns([[0, 0, 100, 10, 12, 'x a@b.io']], []);
  assert.strictEqual(res.runs.length, 0);
  assert.deepStrictEqual(res.boxes, [[-2, -2, 104, 14]]);
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
  assert.match(bg, /if \(mode === 'visible' && settings\.redact\) throw new Error\(`\$\{REDACT_NEEDS_TEXT\}; a visible-area screenshot/);
  assert.match(bg, /if \(settings\.redact\) throw new Error\(`Could not read the page text for Share-safe Redact/);
  assert.match(bg, /settings\.redact = settings\.redact === true && IS_FULL_EDITION/);
});

test('the stitcher burns boxes before encoding and scrubs links, bookmarks and cover', () => {
  const st = src('stitcher.js');
  const burn = st.indexOf("ctx.fillStyle = '#000000'");
  const encode = st.indexOf('canvas.toBlob(');
  assert.ok(burn > 0 && burn < encode);
  assert.match(st, /textRuns\.set\(message\.captureId, res\.runs\)/);
  assert.match(st, /extras\.links = \(extras\.links \|\| \[\]\)\.filter\(l => !hit\(l\)/);
  assert.match(st, /session\.title = scrub\(/);
  assert.ok(src('stitcher.html').includes('<script src="redact.js"></script>'));
  assert.ok(src('tools/build-editions.mjs').includes("'redact.js'"));
});
