const test = require('node:test');
const assert = require('node:assert/strict');
const PDF = require('../pdf.js');

// Smallest valid baseline JPEG header pieces: SOI, SOF0 (2x3 px, 3 comps), EOI.
function fakeJpeg(width, height, comps = 3) {
  return new Uint8Array([
    0xFF, 0xD8,
    0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00,
    0xFF, 0xC0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, comps,
    1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0,
    0xFF, 0xD9
  ]);
}

test('jpegSize reads SOF dimensions', () => {
  assert.deepEqual(PDF.jpegSize(fakeJpeg(1060, 14000)), { width: 1060, height: 14000, components: 3 });
  assert.throws(() => PDF.jpegSize(new Uint8Array([1, 2, 3, 4])), /Not a JPEG/);
});

test('buildPdf writes a valid xref with one page per image', () => {
  const bytes = PDF.buildPdf([
    { jpeg: fakeJpeg(1000, 2000), cssWidth: 1000, cssHeight: 2000 },
    { jpeg: fakeJpeg(1000, 500) }
  ], { title: 'Caf\u00e9 (test)' });
  const text = Buffer.from(bytes).toString('latin1');
  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /\/Type \/Pages \/Count 2/);
  assert.match(text, /\/MediaBox \[0 0 750 1500\]/);
  assert.match(text, /\/MediaBox \[0 0 750 375\]/);
  assert.match(text, /\/Title \(Caf\? \\\(test\\\)\)/);
  const startxref = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(text.slice(startxref, startxref + 4), 'xref');
  // Every xref offset must point at "<id> 0 obj".
  const entries = text.slice(startxref).match(/^(\d{10}) 00000 n $/gm);
  entries.forEach((line, i) => {
    const off = Number(line.slice(0, 10));
    assert.equal(text.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`);
  });
});

test('oversized pages are scaled within the PDF page-size limit', () => {
  const text = Buffer.from(PDF.buildPdf([{ jpeg: fakeJpeg(1000, 30000) }])).toString('latin1');
  const box = text.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
  assert.ok(Number(box[2]) <= 14400 && Number(box[1]) > 0);
});
