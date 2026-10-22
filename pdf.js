/* Minimal dependency-free PDF writer: one JPEG image per page (DCTDecode). */
(function (root) {
  'use strict';

  const enc = new TextEncoder();
  const MAX_PAGE_UNITS = 14400; // PDF implementation limit for page size in user units.

  function num(n) {
    const v = Math.round(Number(n) * 1000) / 1000;
    return String(Number.isFinite(v) ? v : 0);
  }

  // Reads JPEG pixel dimensions from SOF markers so the writer never trusts
  // caller-provided sizes for the image stream.
  function jpegSize(bytes) {
    if (!bytes || bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) throw new Error('Not a JPEG image.');
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xFF) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      const isSof = marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker);
      if (isSof) {
        const height = (bytes[i + 5] << 8) | bytes[i + 6];
        const width = (bytes[i + 7] << 8) | bytes[i + 8];
        const components = bytes[i + 9];
        return { width, height, components };
      }
      i += 2 + len;
    }
    throw new Error('JPEG dimensions not found.');
  }

  // UTF-16BE hex for Identity-H with a 1:1 ToUnicode map. Astral characters
  // (emoji) become "?" because the identity map covers the BMP only.
  function utf16Hex(text) {
    let out = '';
    for (const ch of String(text)) {
      let code = ch.codePointAt(0);
      if (code > 0xFFFF || (code >= 0xD800 && code <= 0xDFFF)) code = 0x3F;
      out += code.toString(16).padStart(4, '0');
    }
    return out;
  }

  function toUnicodeCMap() {
    const ranges = [];
    for (let hi = 0; hi <= 0xFF; hi++) {
      if (hi >= 0xD8 && hi <= 0xDF) continue;
      const h = hi.toString(16).padStart(2, '0');
      ranges.push(`<${h}00> <${h}ff> <${h}00>`);
    }
    let body = '';
    for (let i = 0; i < ranges.length; i += 100) {
      const chunk = ranges.slice(i, i + 100);
      body += `${chunk.length} beginbfrange\n${chunk.join('\n')}\nendbfrange\n`;
    }
    return '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <ffff>\nendcodespacerange\n' + body + 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n';
  }

  // Invisible text (render mode 3) scaled so each run spans its on-screen width.
  function textOps(runs, k, pageH) {
    let ops = '';
    for (const run of runs || []) {
      const text = String(run.text || '').trim();
      if (!text) continue;
      const n = [...text].length;
      const fs = Math.max(1, run.h * 0.75 * k * 0.82);
      const widthPt = Math.max(0.5, run.w * 0.75 * k);
      const tz = Math.max(1, Math.min(1000, (100 * widthPt) / (0.5 * fs * n)));
      const x = run.x * 0.75 * k;
      const y = pageH - (run.y + run.h * 0.8) * 0.75 * k;
      ops += `BT /F0 ${num(fs)} Tf 3 Tr ${num(tz)} Tz 1 0 0 1 ${num(x)} ${num(y)} Tm <${utf16Hex(text)}> Tj ET\n`;
    }
    return ops;
  }

  /**
   * pages: [{ jpeg: Uint8Array, cssWidth?, cssHeight? }]
   * Optional page.text: [{ x, y, w, h, text }] in the page's CSS px adds an
   * invisible searchable/selectable text layer.
   * cssWidth/cssHeight define the page size (1 CSS px = 0.75 pt); defaults to
   * the image pixel size. Pages that would exceed PDF limits are scaled down.
   */
  function buildPdf(pages, meta = {}) {
    if (!Array.isArray(pages) || !pages.length) throw new Error('No pages to write.');
    const chunks = [];
    const offsets = [];
    let length = 0;
    const push = data => {
      const bytes = typeof data === 'string' ? enc.encode(data) : data;
      chunks.push(bytes);
      length += bytes.length;
    };
    const startObj = id => { offsets[id] = length; push(`${id} 0 obj\n`); };

    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const pageCount = pages.length;
    // Object ids: 1 catalog, 2 pages, 3 info, then 3 per page (page, content, image).
    const pageIds = pages.map((_, i) => 4 + i * 3);
    const hasText = pages.some(p => Array.isArray(p.text) && p.text.length);
    const fontId = 4 + pageCount * 3;

    startObj(1); push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    startObj(2); push(`<< /Type /Pages /Count ${pageCount} /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] >>\nendobj\n`);
    const esc = s => String(s || '').replace(/[^\x20-\x7E]/g, '?').replace(/([\\()])/g, '\\$1').slice(0, 200);
    startObj(3); push(`<< /Title (${esc(meta.title)}) /Producer (Page Archive Capture) /Subject (${esc(meta.subject)}) >>\nendobj\n`);

    pages.forEach((page, i) => {
      const jpeg = page.jpeg instanceof Uint8Array ? page.jpeg : new Uint8Array(page.jpeg);
      const info = jpegSize(jpeg);
      let w = (Number(page.cssWidth) > 0 ? Number(page.cssWidth) : info.width) * 0.75;
      let h = (Number(page.cssHeight) > 0 ? Number(page.cssHeight) : info.height) * 0.75;
      const cssW = Number(page.cssWidth) > 0 ? Number(page.cssWidth) : info.width;
      const shrink = Math.min(1, MAX_PAGE_UNITS / w, MAX_PAGE_UNITS / h);
      w *= shrink; h *= shrink;
      const k = (w / 0.75) / cssW;
      const pageId = pageIds[i], contentId = pageId + 1, imageId = pageId + 2;
      startObj(pageId);
      push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(w)} ${num(h)}] /Resources << /XObject << /Im${i} ${imageId} 0 R >>${hasText ? ` /Font << /F0 ${fontId} 0 R >>` : ''} >> /Contents ${contentId} 0 R >>\nendobj\n`);
      const stream = `q ${num(w)} 0 0 ${num(h)} 0 0 cm /Im${i} Do Q\n` + (hasText ? textOps(page.text, k, h) : '');
      startObj(contentId);
      push(`<< /Length ${enc.encode(stream).length} >>\nstream\n${stream}endstream\nendobj\n`);
      const colorSpace = info.components === 1 ? '/DeviceGray' : info.components === 4 ? '/DeviceCMYK' : '/DeviceRGB';
      startObj(imageId);
      push(`<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
      push(jpeg);
      push('\nendstream\nendobj\n');
    });

    if (hasText) {
      startObj(fontId); push(`<< /Type /Font /Subtype /Type0 /BaseFont /PageArchiveText /Encoding /Identity-H /DescendantFonts [${fontId + 1} 0 R] /ToUnicode ${fontId + 3} 0 R >>\nendobj\n`);
      startObj(fontId + 1); push(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /PageArchiveText /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${fontId + 2} 0 R /DW 500 /CIDToGIDMap /Identity >>\nendobj\n`);
      startObj(fontId + 2); push('<< /Type /FontDescriptor /FontName /PageArchiveText /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 >>\nendobj\n');
      const cmap = toUnicodeCMap();
      startObj(fontId + 3); push(`<< /Length ${enc.encode(cmap).length} >>\nstream\n${cmap}endstream\nendobj\n`);
    }
    const total = 4 + pageCount * 3 + (hasText ? 4 : 0);
    const xrefOffset = length;
    let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (let id = 1; id < total; id++) xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
    push(xref);
    push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

    const out = new Uint8Array(length);
    let pos = 0;
    for (const c of chunks) { out.set(c, pos); pos += c.length; }
    return out;
  }

  const api = { buildPdf, jpegSize, utf16Hex };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PageArchivePdf = api;
})(globalThis);
