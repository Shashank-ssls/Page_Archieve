const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PDF = require('../pdf.js');
const G = require('../geometry.js');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

function fakeJpeg(width, height) {
  return new Uint8Array([
    0xFF, 0xD8,
    0xFF, 0xC0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 3,
    1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0,
    0xFF, 0xD9
  ]);
}

// Parses the writer's uncompressed output into { id: body } and checks the xref.
function objects(bytes) {
  const text = Buffer.from(bytes).toString('latin1');
  const startxref = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(text.slice(startxref, startxref + 4), 'xref');
  const size = Number(text.match(/\/Size (\d+)/)[1]);
  const entries = text.slice(startxref).match(/^(\d{10}) 00000 n $/gm);
  assert.equal(entries.length, size - 1);
  const objs = {};
  entries.forEach((line, i) => {
    const off = Number(line.slice(0, 10));
    const head = `${i + 1} 0 obj\n`;
    assert.equal(text.slice(off, off + head.length), head, `xref entry ${i + 1}`);
    objs[i + 1] = text.slice(off + head.length, text.indexOf('endobj', off));
  });
  return { text, objs };
}

const kidsOf = objs => objs[2].match(/\/Kids \[([^\]]*)\]/)[1].match(/\d+(?= 0 R)/g).map(Number);

test('links become URI and GoTo annotations at the right PDF coordinates', () => {
  const { objs } = objects(PDF.buildPdf([
    { jpeg: fakeJpeg(400, 1000), cssWidth: 400, cssHeight: 1000, links: [
      { x: 10, y: 20, w: 100, h: 16, uri: 'https://example.com/a?b=1' },
      { x: 10, y: 60, w: 50, h: 16, uri: 'javascript:alert(1)' },
      { x: 10, y: 80, w: 50, h: 16, uri: 'https://ex\u00e4mple.com/' },
      { x: 10, y: 100, w: 50, h: 16, dest: { page: 1, y: 200 } }
    ] },
    { jpeg: fakeJpeg(400, 1000), cssWidth: 400, cssHeight: 1000 }
  ]));
  const [first, second] = kidsOf(objs);
  const annots = objs[first].match(/\/Subtype \/Link/g);
  assert.equal(annots.length, 2, 'javascript: and raw non-ASCII links are dropped');
  // y = 20 css -> top 750 - 15 = 735, bottom 750 - 27 = 723 (1 css px = 0.75 pt).
  assert.match(objs[first], /\/Rect \[7\.5 723 82\.5 735\] \/Border \[0 0 0\] \/A << \/S \/URI \/URI \(https:\/\/example\.com\/a\?b=1\) >>/);
  assert.match(objs[first], new RegExp(`/Dest \\[${second} 0 R /XYZ 0 600 null\\]`));
  assert.equal(PDF.safeUri('mailto:a@b.c'), 'mailto:a@b.c');
  assert.equal(PDF.safeUri('data:text/html,x'), null);
});

test('outline nests h1 > h2 > h3 with correct counts and Unicode titles', () => {
  const { objs } = objects(PDF.buildPdf([
    { jpeg: fakeJpeg(400, 1000), cssWidth: 400, cssHeight: 1000 },
    { jpeg: fakeJpeg(400, 1000), cssWidth: 400, cssHeight: 1000 }
  ], { outline: [
    { title: 'Intro', page: 0, y: 0, level: 1 },
    { title: 'Caf\u00e9', page: 0, y: 400, level: 2 },
    { title: 'Deep', page: 1, y: 100, level: 3 },
    { title: 'Next', page: 1, y: 500, level: 1 },
    { title: 'Bad page', page: 9, y: 0, level: 1 },
    { title: '   ', page: 0, y: 0, level: 1 }
  ] }));
  const catalog = objs[1];
  const rootId = Number(catalog.match(/\/Outlines (\d+) 0 R/)[1]);
  assert.match(catalog, /\/PageMode \/UseOutlines/);
  assert.match(objs[rootId], /\/Type \/Outlines .*\/Count 4/);
  const items = Object.entries(objs).filter(([, b]) => /\/Title <feff/.test(b));
  assert.equal(items.length, 4, 'invalid page and blank titles are skipped');
  const byTitle = Object.fromEntries(items.map(([id, b]) => [b.match(/\/Title <([0-9a-f]+)>/)[1], { id: Number(id), b }]));
  const intro = byTitle[PDF.pdfTextHex('Intro').slice(1, -1)];
  const cafe = byTitle['feff00430061006600e9'];
  assert.ok(cafe, 'Unicode title stored as UTF-16BE');
  assert.match(intro.b, /\/Count 2/);
  assert.match(cafe.b, new RegExp(`/Parent ${intro.id} 0 R`));
  assert.match(intro.b, /\/Next \d+ 0 R/);
  assert.equal(PDF.pdfTextHex('\u{1F600}'), '<feffd83dde00>');
});

test('a plain PDF has no outline, annotations or cover', () => {
  const { objs } = objects(PDF.buildPdf([{ jpeg: fakeJpeg(10, 10) }]));
  assert.doesNotMatch(objs[1], /Outlines/);
  assert.ok(!Object.values(objs).some(b => /\/Annots|Helvetica/.test(b)));
});

test('partAt maps capture points to output parts', () => {
  const parts = G.buildParts(1000, 30000, 1, 14000, 24e6);
  assert.equal(G.partAt(parts, 0, 0), 0);
  assert.equal(G.partAt(parts, 10, parts[1].y + 5), 1);
  assert.equal(G.partAt(parts, 10, 30000), -1);
  assert.equal(G.partAt(parts, 10, -1), -1);
});

test('links and outline marks travel content -> worker -> stitcher', () => {
  const content = read('content.js');
  const background = read('background.js');
  const stitcher = read('stitcher.js');
  assert.match(content, /turns: \['\[data-testid="user-message"\]'\]/);
  assert.match(content, /turns: \['\[data-message-author-role="user"\]'/);
  assert.match(content, /\/\^H\[1-3\]\$\/\.test\(tag\)/);
  assert.match(content, /links: links\.map[\s\S]{0,200}marks: marks\.map/);
  assert.match(background, /PAC_STORE_TEXT[\s\S]{0,200}links: pdfLinks, marks: pdfMarks/);
  // The cover page option was removed (owner, 2026-10-24).
  assert.ok(!/pdfCover/.test(background));
  assert.ok(!read('popup.html').includes('pdf-cover'));
  assert.match(stitcher, /PDF\.buildPdf\(pdfPages, \{[^}]*outline \}\)/);
});

test('unpaintedInk flags text bands drawn as flat rows and ignores painted ones', () => {
  const rows = new Uint8Array(8192);
  // Text every 30 px; rows 2080-8192 are flat (never painted), like the Claude capture.
  for (let y = 0; y < 2080; y++) rows[y] = y % 30 < 18 ? 0 : 1;
  for (let y = 2080; y < 8192; y++) rows[y] = 1;
  const bands = [];
  for (let y = 0; y + 18 < 8192; y += 30) bands.push([y, y + 18]);
  const bad = G.unpaintedInk(rows, bands, 1);
  assert.equal(bad.unpainted, true);
  assert.ok(bad.missingBands > 150);
  const good = G.unpaintedInk(rows.map((v, y) => y % 30 < 18 ? 0 : 1), bands, 1);
  assert.equal(good.unpainted, false);
  // One flat band (white-on-white text, an empty code line) is tolerated.
  const one = new Uint8Array(rows.length).map((v, y) => y % 30 < 18 && y >= 30 ? 0 : 1);
  assert.equal(G.unpaintedInk(one, bands, 1).unpainted, false);
  // Scale maps CSS bands onto device rows (DPR 1.25).
  assert.equal(G.unpaintedInk(new Uint8Array(1000).fill(1), [[0, 100], [200, 300], [400, 500]], 1.25).unpainted, true);
});

test('pdfPageParts makes A4-proportioned pages that break between text lines', () => {
  const lines = [];
  for (let y = 10; y < 9000; y += 24) lines.push([y, 20]);
  const parts = G.pdfPageParts(1000, 9000, 1.2, lines, 14000, 24e6);
  assert.equal(parts[0].y, 0);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    assert.ok(p.h <= 1414 && p.h > 1414 * 0.7 - 1 || (i === parts.length - 1 && p.h <= 1414 * 1.15), `page ${i} height ${p.h}`);
    if (i) assert.equal(p.y, parts[i - 1].y + parts[i - 1].h);
    const cut = p.y + p.h;
    if (i < parts.length - 1) assert.ok(!lines.some(l => cut > l[0] && cut < l[0] + l[1]), `page ${i} cuts a line at ${cut}`);
  }
  assert.equal(parts[parts.length - 1].y + parts[parts.length - 1].h, 9000);
  // No text: plain A4 steps. Too wide: the image grid.
  assert.deepEqual(G.pdfPageParts(1000, 3000, 1, [], 14000, 24e6).map(p => p.h), [1414, 1586]);
  assert.ok(G.pdfPageParts(20000, 3000, 1, [], 14000, 24e6).some(p => p.x > 0));
});

test('render screenshots are paint-checked and document growth stops at a chasing end spacer', () => {
  const background = read('background.js');
  assert.match(background, /G\.unpaintedInk\(rows, inChunk/);
  assert.match(background, /attempt >= 3\) throw new Error/);
  assert.match(background, /tail - prev\.tail >= \(viewportH - prev\.viewportH\) \* 0\.5/);
  assert.match(read('stitcher.js'), /format === 'pdf'\s*\? G\.pdfPageParts/);
});

test('endSpacerCut trims empty space after the last panel content', () => {
  assert.equal(G.endSpacerCut(20000, 5000, 200), 5064, 'window-sized spacer');
  assert.equal(G.endSpacerCut(5280, 5000, 200), 5064, 'room reserved for a hidden message box');
  assert.equal(G.endSpacerCut(5150, 5000, 200), 5150, 'a small tail is kept');
  assert.equal(G.endSpacerCut(20000, 0, 200), 20000, 'no measured content: never cut');
  assert.equal(G.endSpacerCut(5050, 5000, 0), 5050, 'slack never goes below the 64 px margin');
});

test('floating-element hiding has a high cap, spares text-heavy boxes and names examples', () => {
  const content = read('content.js');
  assert.match(content, /if \(count >= 400\) \{ state\.hiddenCapReached = true; break; \}/);
  assert.match(content, /textContent \|\| ''\)\.length > 300 && !el\.querySelector\('textarea/);
  assert.match(read('background.js'), /function hiddenDetail\(settled\)/);
});
