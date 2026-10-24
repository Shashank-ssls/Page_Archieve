/* Minimal dependency-free PDF writer: one JPEG image per page (DCTDecode),
   optional invisible text layer, link annotations and an outline. */
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

  // PDF text string as UTF-16BE hex with a BOM, so outline titles keep Unicode.
  function pdfTextHex(text) {
    let out = 'feff';
    for (const ch of String(text)) {
      const code = ch.codePointAt(0);
      if (code > 0xFFFF) {
        const v = code - 0x10000;
        out += (0xD800 + (v >> 10)).toString(16) + (0xDC00 + (v & 0x3FF)).toString(16);
      } else out += code.toString(16).padStart(4, '0');
    }
    return `<${out}>`;
  }

  // Literal string for ASCII-only content (URIs, document info).
  const asciiLit = (s, max = 2000) => '(' + String(s || '').replace(/[^\x20-\x7E]/g, '?').slice(0, max).replace(/([\\()])/g, '\\$1') + ')';

  // Only absolute web and mail links become URI actions; anything else
  // (javascript:, data:, blob:, raw non-ASCII) is dropped.
  function safeUri(uri) {
    const u = String(uri || '');
    if (u.length > 2000 || !/^(https?:\/\/|mailto:)/i.test(u) || /[^\x21-\x7E]/.test(u)) return null;
    return u;
  }

  /**
   * pages: [{ jpeg: Uint8Array, cssWidth?, cssHeight?, text?, links? }]
   * Optional page.text: [{ x, y, w, h, text }] in the page's CSS px adds an
   * invisible searchable/selectable text layer.
   * Optional page.links: [{ x, y, w, h, uri }] or [{ x, y, w, h, dest: { page, y } }]
   * (dest.page indexes `pages`, dest.y is CSS px on that page) adds clickable areas.
   * meta.outline: [{ title, page, y, level }] in reading order adds bookmarks;
   * a higher level nests under the nearest earlier lower one.
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
    const writeStream = (id, stream) => { startObj(id); push(`<< /Length ${enc.encode(stream).length} >>\nstream\n${stream}endstream\nendobj\n`); };

    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    // Measure every page first: links and bookmarks need the scale of the page
    // they point into. k converts the page's CSS px into its (possibly shrunk) size.
    const geo = pages.map(page => {
      const jpeg = page.jpeg instanceof Uint8Array ? page.jpeg : new Uint8Array(page.jpeg);
      const info = jpegSize(jpeg);
      const cssW = Number(page.cssWidth) > 0 ? Number(page.cssWidth) : info.width;
      const cssH = Number(page.cssHeight) > 0 ? Number(page.cssHeight) : info.height;
      const k = Math.min(1, MAX_PAGE_UNITS / (cssW * 0.75), MAX_PAGE_UNITS / (cssH * 0.75));
      return { jpeg, info, w: cssW * 0.75 * k, h: cssH * 0.75 * k, k };
    });
    const destTop = (g, y) => num(Math.max(0, Math.min(g.h, g.h - Number(y || 0) * 0.75 * g.k)));

    // Object ids: 1 catalog, 2 pages, 3 info, then allocated in writing order.
    let nextId = 4;
    const pageIds = pages.map(() => { const id = nextId; nextId += 3; return id; }); // page, content, image
    const hasText = pages.some(p => Array.isArray(p.text) && p.text.length);
    const fontId = hasText ? nextId : 0;
    if (hasText) nextId += 4;
    const outline = (Array.isArray(meta.outline) ? meta.outline : [])
      .filter(o => o && String(o.title || '').trim() && Number.isInteger(o.page) && o.page >= 0 && o.page < pages.length)
      .slice(0, 5000);
    const outlineRoot = outline.length ? nextId++ : 0;
    const outlineIds = outline.map(() => nextId++);
    const total = nextId;
    const kids = pageIds;

    startObj(1); push(`<< /Type /Catalog /Pages 2 0 R${outlineRoot ? ` /Outlines ${outlineRoot} 0 R /PageMode /UseOutlines` : ''} >>\nendobj\n`);
    startObj(2); push(`<< /Type /Pages /Count ${kids.length} /Kids [${kids.map(id => `${id} 0 R`).join(' ')}] >>\nendobj\n`);
    startObj(3); push(`<< /Title ${asciiLit(meta.title, 200)} /Producer (Tallshot) /Subject ${asciiLit(meta.subject, 200)} >>\nendobj\n`);

    pages.forEach((page, i) => {
      const { jpeg, info, w, h, k } = geo[i];
      const pageId = pageIds[i], contentId = pageId + 1, imageId = pageId + 2;
      const annots = [];
      for (const link of (Array.isArray(page.links) ? page.links : []).slice(0, 5000)) {
        if (!link || ![link.x, link.y, link.w, link.h].every(Number.isFinite) || link.w <= 0 || link.h <= 0) continue;
        let action;
        if (link.dest && Number.isInteger(link.dest.page) && geo[link.dest.page]) {
          action = `/Dest [${pageIds[link.dest.page]} 0 R /XYZ 0 ${destTop(geo[link.dest.page], link.dest.y)} null]`;
        } else {
          const uri = safeUri(link.uri);
          if (!uri) continue;
          action = `/A << /S /URI /URI ${asciiLit(uri)} >>`;
        }
        const x1 = link.x * 0.75 * k, x2 = (link.x + link.w) * 0.75 * k;
        const y1 = h - (link.y + link.h) * 0.75 * k, y2 = h - link.y * 0.75 * k;
        annots.push(`<< /Type /Annot /Subtype /Link /Rect [${num(x1)} ${num(y1)} ${num(x2)} ${num(y2)}] /Border [0 0 0] ${action} >>`);
      }
      startObj(pageId);
      push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(w)} ${num(h)}] /Resources << /XObject << /Im${i} ${imageId} 0 R >>${hasText ? ` /Font << /F0 ${fontId} 0 R >>` : ''} >> /Contents ${contentId} 0 R${annots.length ? ` /Annots [${annots.join(' ')}]` : ''} >>\nendobj\n`);
      writeStream(contentId, `q ${num(w)} 0 0 ${num(h)} 0 0 cm /Im${i} Do Q\n` + (hasText ? textOps(page.text, k, h) : ''));
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
      writeStream(fontId + 3, toUnicodeCMap());
    }

    if (outlineRoot) {
      const nodes = outline.map((o, i) => ({ id: outlineIds[i], o, level: Math.max(1, Math.min(6, Number(o.level) || 1)), kids: [] }));
      const top = [];
      const stack = [];
      for (const n of nodes) {
        while (stack.length && stack[stack.length - 1].level >= n.level) stack.pop();
        (stack.length ? stack[stack.length - 1].kids : top).push(n);
        stack.push(n);
      }
      const countAll = list => list.reduce((a, n) => a + 1 + countAll(n.kids), 0);
      const ref = n => `${n.id} 0 R`;
      const writeLevel = (list, parentId) => list.forEach((n, i) => {
        let d = `<< /Title ${pdfTextHex(String(n.o.title).replace(/\s+/g, ' ').trim().slice(0, 200))} /Parent ${parentId} 0 R`;
        if (i > 0) d += ` /Prev ${ref(list[i - 1])}`;
        if (i < list.length - 1) d += ` /Next ${ref(list[i + 1])}`;
        if (n.kids.length) d += ` /First ${ref(n.kids[0])} /Last ${ref(n.kids[n.kids.length - 1])} /Count ${countAll(n.kids)}`;
        d += ` /Dest [${pageIds[n.o.page]} 0 R /XYZ 0 ${destTop(geo[n.o.page], n.o.y)} null] >>`;
        startObj(n.id); push(`${d}\nendobj\n`);
        writeLevel(n.kids, n.id);
      });
      startObj(outlineRoot); push(`<< /Type /Outlines /First ${ref(top[0])} /Last ${ref(top[top.length - 1])} /Count ${countAll(top)} >>\nendobj\n`);
      writeLevel(top, outlineRoot);
    }

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

  const api = { buildPdf, jpegSize, utf16Hex, pdfTextHex, safeUri };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PageArchivePdf = api;
})(globalThis);
