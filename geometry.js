/* Small dependency-free geometry helpers shared by the extension and Node tests. */
(function (root) {
  'use strict';

  // Use the browser's actual scrolling element as the authoritative document
  // extent. document.body.scrollHeight can exceed the scrollable root in some
  // layouts; using that value can create unreachable final tile coordinates.
  function rootPageSize(viewportWidth, viewportHeight, rootScrollWidth, rootScrollHeight) {
    const vw = Math.max(1, Number(viewportWidth) || 1);
    const vh = Math.max(1, Number(viewportHeight) || 1);
    const rw = Math.max(0, Number(rootScrollWidth) || 0);
    const rh = Math.max(0, Number(rootScrollHeight) || 0);
    return { pageW: Math.max(vw, rw), pageH: Math.max(vh, rh) };
  }

  // Compute how far an element moved relative to a previously recorded
  // viewport anchor. Used to keep a selected inner scroller fixed in the capture
  // viewport while the site animates, collapses headers, or scroll-anchors its shell.
  function anchorCorrection(anchor, current) {
    if (!anchor || !current || ![anchor.left, anchor.top, current.left, current.top].every(Number.isFinite)) {
      return { x: 0, y: 0, valid: false };
    }
    return { x: anchor.left - current.left, y: anchor.top - current.top, valid: true };
  }

  // Smart mode should not mistake a tall child on a normally scrolling document
  // for the page's primary scroller. Only prefer generic inner panels when the
  // root document itself is essentially non-scrollable. Known conversation apps
  // are an intentional exception because many virtualized chats keep the root fixed.
  function isHeavilyClippedPanel(options = {}) {
    const viewportW = Math.max(1, Number(options.viewportWidth) || 1);
    const viewportH = Math.max(1, Number(options.viewportHeight) || 1);
    const clientW = Math.max(1, Number(options.clientWidth) || 1);
    const clientH = Math.max(1, Number(options.clientHeight) || 1);
    const left = Number(options.left) || 0;
    const top = Number(options.top) || 0;
    const right = Number.isFinite(Number(options.right)) ? Number(options.right) : left + clientW;
    const bottom = Number.isFinite(Number(options.bottom)) ? Number(options.bottom) : top + clientH;
    const visibleW = Math.max(0, Math.min(viewportW, right) - Math.max(0, left));
    const visibleH = Math.max(0, Math.min(viewportH, bottom) - Math.max(0, top));
    const visibleFraction = (visibleW * visibleH) / (clientW * clientH);
    const originFarOutside = left < -viewportW * 0.5 || top < -viewportH * 0.5;
    return visibleFraction < 0.45 && originFarOutside;
  }

  function shouldUseInnerScroller(options = {}) {
    const rootHeight = Math.max(0, Number(options.rootHeight) || 0);
    const viewportHeight = Math.max(1, Number(options.viewportHeight) || 1);
    const areaRatio = Math.max(0, Number(options.areaRatio) || 0);
    const semantic = Math.max(0, Number(options.semantic) || 0);
    const conversationHost = options.conversationHost === true;
    if (options.force === true) return true;
    // A huge but mostly off-screen overflow node often belongs to the wrong
    // nested scrolling layer. Prefer the document instead of interpreting the
    // visible bottom sliver as tile zero.
    if (options.severelyClipped === true) return false;
    const rootMostlyStatic = rootHeight <= viewportHeight + 220;
    const rootNearViewport = rootHeight <= viewportHeight + 800;
    const recognizedConversation = conversationHost && semantic > 0 && areaRatio >= 0.22;
    const genericPrimaryPanel = rootMostlyStatic && areaRatio >= 0.30;
    const clearlySemanticPanel = semantic >= 3 && rootNearViewport && areaRatio >= 0.35;
    return recognizedConversation || genericPrimaryPanel || clearlySemanticPanel;
  }

  function axisPositions(totalSize, viewportSize, maxSize, overlapRatio) {
    const total = Math.max(1, Math.floor(Math.min(Number(totalSize) || 1, Number(maxSize) || Number(totalSize) || 1)));
    const viewport = Math.max(1, Math.floor(Number(viewportSize) || 1));
    const maxScroll = Math.max(0, total - viewport);
    if (maxScroll === 0) return [0];
    const overlap = Math.max(1, Math.min(120, Math.floor(viewport * (Number(overlapRatio) || 0.14)), viewport - 1));
    const step = Math.max(1, viewport - overlap);
    const out = [0];
    for (let pos = step; pos < maxScroll; pos += step) out.push(pos);
    if (out[out.length - 1] !== maxScroll) out.push(maxScroll);
    return out;
  }

  // A virtualized or responsive scroll panel can clamp a requested scroll offset
  // by a few CSS pixels after a notebook cell reflows. Permit only a bounded
  // fraction of the tile overlap; the final stitched coverage validator remains
  // authoritative and still rejects actual holes.
  function safeTileDriftTolerance(viewportSize, overlapRatio = 0.14) {
    const viewport = Number(viewportSize);
    if (!Number.isFinite(viewport) || viewport <= 0) return 8;
    const ratio = Number.isFinite(Number(overlapRatio))
      ? Math.max(0.02, Math.min(0.30, Number(overlapRatio))) : 0.14;
    return Math.max(8, Math.min(48, Math.floor(viewport * ratio * 0.5)));
  }

  // Shrink an output only if the final tile reached the panel's live bottom
  // and the measured height loss is within the permitted drift budget. This avoids
  // blank tails when a notebook output settles, while never hiding a large change.
  function adjustedFinalPanelHeight(initialHeight, liveHeight, tileY, tileHeight, tolerance) {
    const initial = Number(initialHeight);
    const live = Number(liveHeight);
    const y = Number(tileY);
    const h = Number(tileHeight);
    const tol = Math.max(0, Number(tolerance) || 0);
    if (![initial, live, y, h, tol].every(Number.isFinite) || initial <= 0 || live <= 0 || y < 0 || h <= 0) return initialHeight;
    const reachedLiveBottom = y >= live - h - 2;
    const shrink = initial - live;
    if (reachedLiveBottom && shrink > 0 && shrink <= tol + 2) return Math.max(1, Math.floor(live));
    return initialHeight;
  }

  function intersectRect(a, b) {
    const left = Math.max(a.x, b.x);
    const top = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.w, b.x + b.w);
    const bottom = Math.min(a.y + a.h, b.y + b.h);
    if (right <= left || bottom <= top) return null;
    return { x: left, y: top, w: right - left, h: bottom - top };
  }

  function partSize(pageWidthCss, pageHeightCss, scale, maxDimensionPx, maxPixels) {
    const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const maxDim = Math.max(1, Math.floor((Number(maxDimensionPx) || 14000) / safeScale));
    const maxAreaCss = Math.max(1, Math.floor((Number(maxPixels) || 30000000) / (safeScale * safeScale)));
    const width = Math.max(1, Math.min(Math.floor(pageWidthCss), maxDim));
    const heightByArea = Math.max(1, Math.floor(maxAreaCss / width));
    const height = Math.max(1, Math.min(Math.floor(pageHeightCss), maxDim, heightByArea));
    return { width, height };
  }

  function filenameBase(raw, fallback) {
    const value = String(raw || '').normalize('NFKC')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
      .replace(/[. ]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120)
      .trim();
    return value || fallback || 'page-capture';
  }

  // ASCII-only fallback for download names (keeps the extension).
  function asciiFilename(name) {
    const raw = String(name || '');
    const m = raw.match(/^(.*?)(\.[A-Za-z0-9]{1,5})?$/);
    const stem = (m && m[1] || '').normalize('NFKD')
      .replace(/[\u2010-\u2015\u2212]/g, '-')
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/[<>:"/\\|?*~]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/g, '');
    return `${stem || 'page-capture'}${(m && m[2]) || ''}`;
  }

  // Expand a file-name template. Tokens: {title} {site} {date} {time} {datetime}.
  function applyNameTemplate(template, values = {}) {
    const now = values.now instanceof Date ? values.now : new Date();
    const pad = n => String(n).padStart(2, '0');
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const map = { title: values.title || '', site: values.site || '', date, time, datetime: `${date}_${time}` };
    const raw = String(template || '{title}').replace(/\{(title|site|date|time|datetime)\}/gi, (_, k) => map[k.toLowerCase()]);
    return raw;
  }

  // A relative Downloads subfolder: each segment sanitized, no traversal.
  function safeFolder(raw) {
    return String(raw || '').split(/[\\/]+/)
      .map(seg => String(seg).normalize('NFKC').replace(/[<>:"|?*\x00-\x1F]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '').slice(0, 60))
      .filter(seg => seg && seg !== '.' && seg !== '..' && !/^\.+$/.test(seg))
      .slice(0, 6)
      .join('/');
  }

  // Convert an overlap in page CSS coordinates into a bounded source rectangle
  // and its proportional destination on a stitched canvas. Returns null when the
  // source bitmap cannot supply a drawable rectangle.
  function tileDrawMapping(tile, overlap, part, outputScale, bitmapWidth, bitmapHeight) {
    const tileScale = Number.isFinite(tile.scale) && tile.scale > 0 ? tile.scale : outputScale;
    if (![tile.cropX, tile.cropY, tile.tileX, tile.tileY, overlap.x, overlap.y, overlap.w, overlap.h,
      part.x, part.y, outputScale, bitmapWidth, bitmapHeight].every(Number.isFinite) ||
      overlap.w <= 0 || overlap.h <= 0 || outputScale <= 0 || bitmapWidth <= 0 || bitmapHeight <= 0) return null;

    const rawSrcX = (tile.cropX + overlap.x - tile.tileX) * tileScale;
    const rawSrcY = (tile.cropY + overlap.y - tile.tileY) * tileScale;
    const rawSrcW = overlap.w * tileScale;
    const rawSrcH = overlap.h * tileScale;
    const sx1 = Math.max(0, rawSrcX);
    const sy1 = Math.max(0, rawSrcY);
    const sx2 = Math.min(bitmapWidth, rawSrcX + rawSrcW);
    const sy2 = Math.min(bitmapHeight, rawSrcY + rawSrcH);
    if (sx2 <= sx1 || sy2 <= sy1 || rawSrcW <= 0 || rawSrcH <= 0) return null;

    const fullDx = (overlap.x - part.x) * outputScale;
    const fullDy = (overlap.y - part.y) * outputScale;
    const fullDw = overlap.w * outputScale;
    const fullDh = overlap.h * outputScale;
    const left = (sx1 - rawSrcX) / rawSrcW;
    const top = (sy1 - rawSrcY) / rawSrcH;
    const right = (rawSrcX + rawSrcW - sx2) / rawSrcW;
    const bottom = (rawSrcY + rawSrcH - sy2) / rawSrcH;
    const dx1 = fullDx + fullDw * left;
    const dy1 = fullDy + fullDh * top;
    const dx2 = fullDx + fullDw * (1 - right);
    const dy2 = fullDy + fullDh * (1 - bottom);
    if (![dx1, dy1, dx2, dy2].every(Number.isFinite) || dx2 <= dx1 || dy2 <= dy1) return null;
    return { sx: sx1, sy: sy1, sw: sx2 - sx1, sh: sy2 - sy1, dx: dx1, dy: dy1, dw: dx2 - dx1, dh: dy2 - dy1 };
  }

  // Verify that every expected tile exists and the tile rectangles cover the full
  // requested page area. This prevents silently exporting blank/partial sections.
  function validateTileCoverage(tiles, pageWidth, pageHeight, expectedCount, tolerance = 1.25) {
    if (!Array.isArray(tiles) || !Number.isFinite(pageWidth) || !Number.isFinite(pageHeight) || pageWidth <= 0 || pageHeight <= 0) {
      return { ok: false, reason: 'invalid-dimensions', missingIndices: [] };
    }
    if (!Number.isInteger(expectedCount) || expectedCount < 1) {
      return { ok: false, reason: 'invalid-expected-count', missingIndices: [] };
    }

    const byIndex = new Map();
    for (const tile of tiles) {
      if (!tile || !Number.isInteger(tile.index) || tile.index < 0 || tile.index >= expectedCount || byIndex.has(tile.index)) {
        return { ok: false, reason: 'invalid-or-duplicate-index', missingIndices: [] };
      }
      byIndex.set(tile.index, tile);
    }
    const missingIndices = [];
    for (let i = 0; i < expectedCount; i++) if (!byIndex.has(i)) missingIndices.push(i);
    if (missingIndices.length || tiles.length !== expectedCount) {
      return { ok: false, reason: 'missing-tiles', missingIndices };
    }

    const rects = [];
    const yBounds = new Set([0, pageHeight]);
    for (const tile of tiles) {
      const values = [tile.tileX, tile.tileY, tile.tileW, tile.tileH];
      if (!values.every(Number.isFinite) || tile.tileW <= 0 || tile.tileH <= 0) {
        return { ok: false, reason: 'invalid-tile-geometry', missingIndices: [] };
      }
      // Scroll coordinates can be fractional CSS pixels, while the document
      // extent and screenshot bitmap are quantized independently by Chromium.
      // A final tile can end about one CSS pixel short because scroll positions,
      // layout extents, and screenshot dimensions are quantized independently.
      // Snap only edges within the configured 1.25px page-boundary tolerance;
      // meaningful gaps remain errors.
      const snapPageEdge = (value, edge) => Math.abs(value - edge) <= tolerance ? edge : value;
      let x1 = Math.max(0, tile.tileX);
      let y1 = Math.max(0, tile.tileY);
      let x2 = Math.min(pageWidth, tile.tileX + tile.tileW);
      let y2 = Math.min(pageHeight, tile.tileY + tile.tileH);
      x1 = snapPageEdge(x1, 0);
      y1 = snapPageEdge(y1, 0);
      x2 = snapPageEdge(x2, pageWidth);
      y2 = snapPageEdge(y2, pageHeight);
      if (x2 <= x1 || y2 <= y1) continue;
      rects.push({ x1, y1, x2, y2 });
      yBounds.add(y1);
      yBounds.add(y2);
    }

    const ys = [...yBounds].sort((a, b) => a - b);
    for (let yi = 0; yi < ys.length - 1; yi++) {
      const y1 = ys[yi];
      const y2 = ys[yi + 1];
      if (y2 - y1 <= 0) continue;
      const midY = (y1 + y2) / 2;
      const intervals = rects
        .filter(r => r.y1 <= midY && r.y2 >= midY)
        .map(r => [r.x1, r.x2])
        .sort((a, b) => a[0] - b[0] || b[1] - a[1]);
      let coveredUntil = 0;
      for (const [x1, x2] of intervals) {
        if (x1 > coveredUntil + tolerance) {
          return { ok: false, reason: 'coverage-gap', missingIndices: [], gap: { x: coveredUntil, y: y1, w: x1 - coveredUntil, h: y2 - y1 } };
        }
        if (x2 > coveredUntil) coveredUntil = x2;
        if (coveredUntil >= pageWidth - tolerance) break;
      }
      if (coveredUntil < pageWidth - tolerance) {
        return { ok: false, reason: 'coverage-gap', missingIndices: [], gap: { x: coveredUntil, y: y1, w: pageWidth - coveredUntil, h: y2 - y1 } };
      }
    }
    return { ok: true, reason: null, missingIndices: [] };
  }

  function buildParts(pageWidthCss, pageHeightCss, scale, maxDimensionPx, maxPixels) {
    if (!(pageWidthCss > 0) || !(pageHeightCss > 0)) return [];
    const size = partSize(pageWidthCss, pageHeightCss, scale, maxDimensionPx, maxPixels);
    const out = [];
    for (let y = 0, row = 0; y < pageHeightCss; y += size.height, row++) {
      for (let x = 0, col = 0; x < pageWidthCss; x += size.width, col++) {
        out.push({ x, y, w: Math.min(size.width, pageWidthCss - x), h: Math.min(size.height, pageHeightCss - y), row, col });
      }
    }
    return out;
  }

  // ---- Render engine planning ------------------------------------------------
  // Height of one render chunk in CSS px so each screenshot stays well inside
  // GPU texture limits (16384 device px) on HiDPI screens.
  function renderChunkHeight(devicePixelRatio, maxDevicePx = 8192) {
    const dpr = Number.isFinite(Number(devicePixelRatio)) && Number(devicePixelRatio) > 0 ? Number(devicePixelRatio) : 1;
    return Math.max(256, Math.floor((Number(maxDevicePx) || 8192) / dpr));
  }

  // Split [0, total) into contiguous, non-overlapping chunks.
  function renderChunks(totalCss, chunkCss) {
    const total = Math.max(0, Math.floor(Number(totalCss) || 0));
    const step = Math.max(1, Math.floor(Number(chunkCss) || 1));
    const out = [];
    for (let y = 0; y < total; y += step) out.push({ y, h: Math.min(step, total - y) });
    return out;
  }

  // How much taller the emulated viewport must become for an inner panel to
  // stop overflowing and to sit fully inside the viewport. Returns 0 when the
  // panel is fully exposed.
  function panelGrowthNeeded(measure) {
    if (!measure || !measure.panel) return 0;
    const p = measure.panel;
    const overflow = Math.max(0, Number(p.overflow) || 0);
    const belowViewport = Math.max(0, (Number(p.bottom) || 0) - (Number(measure.innerH) || 0));
    const need = overflow + belowViewport;
    return need <= 1 ? 0 : Math.ceil(need);
  }

  function panelFullyExposed(measure) {
    if (!measure || !measure.panel) return false;
    const p = measure.panel;
    return panelGrowthNeeded(measure) === 0 && Number(p.top) >= -1 && Number(p.left) >= -1 &&
      (Number(p.ancestorClip) || 0) <= 1 && Number(p.width) > 0 && Number(p.height) > 0;
  }

  // Width actually worth capturing for a document render: the layout content
  // width, but never wider than the document's own scroll width. Off-canvas
  // menus can inflate the layout width with blank space.
  function renderDocumentWidth(contentWidth, docScrollWidth, viewportWidth) {
    const vw = Math.max(1, Math.floor(Number(viewportWidth) || 1));
    const cw = Math.floor(Number(contentWidth) || 0);
    const sw = Math.floor(Number(docScrollWidth) || 0);
    const candidates = [cw, sw].filter(v => v > 0);
    const width = candidates.length ? Math.min(...candidates) : vw;
    return Math.max(1, Math.min(width, 16000));
  }

  const api = { applyNameTemplate, safeFolder, asciiFilename, renderChunkHeight, renderChunks, panelGrowthNeeded, panelFullyExposed, renderDocumentWidth, rootPageSize, anchorCorrection, isHeavilyClippedPanel, shouldUseInnerScroller, axisPositions, safeTileDriftTolerance, adjustedFinalPanelHeight, intersectRect, partSize, filenameBase, buildParts, validateTileCoverage, tileDrawMapping };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PageArchiveGeometry = api;
})(globalThis);
