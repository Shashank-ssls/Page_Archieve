const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../geometry.js');

test('root page size uses the actual scrolling-element dimensions', () => {
  // content.js passes document.scrollingElement measurements here, not the
  // sometimes-larger body.scrollHeight that can point beyond reachable scroll.
  assert.deepEqual(G.rootPageSize(1200, 700, 1200, 5480), { pageW: 1200, pageH: 5480 });
  assert.deepEqual(G.rootPageSize(1200, 700, 1800, 500), { pageW: 1800, pageH: 700 });
});


test('anchor correction compensates a panel that shifts vertically between capture tiles', () => {
  const correction = G.anchorCorrection({ left: 0, top: 0 }, { left: 0, top: -152 });
  assert.deepEqual(correction, { x: 0, y: 152, valid: true });
});

test('anchor correction compensates horizontal and vertical shell movement together', () => {
  const correction = G.anchorCorrection({ left: 30, top: 100 }, { left: 14, top: -52 });
  assert.deepEqual(correction, { x: 16, y: 152, valid: true });
});

test('anchor correction declines invalid geometry instead of guessing', () => {
  assert.deepEqual(G.anchorCorrection({ left: NaN, top: 0 }, { left: 0, top: 0 }), { x: 0, y: 0, valid: false });
});

test('Smart mode keeps tall ordinary documents on the root even when a large child scrolls', () => {
  assert.equal(G.shouldUseInnerScroller({
    rootHeight: 7949, viewportHeight: 768, areaRatio: 0.82,
    semantic: 3, conversationHost: false
  }), false);
});

test('Smart mode still selects recognized conversation panels on fixed-shell chat hosts', () => {
  assert.equal(G.shouldUseInnerScroller({
    rootHeight: 7949, viewportHeight: 768, areaRatio: 0.72,
    semantic: 2, conversationHost: true
  }), true);
});


test('heavily offscreen panel detection catches panels whose visible slice would start thousands of pixels into tile zero', () => {
  assert.equal(G.isHeavilyClippedPanel({
    left: 0, top: -7639, right: 1500, bottom: 361,
    clientWidth: 1500, clientHeight: 8000, viewportWidth: 1600, viewportHeight: 800
  }), true);
});

test('heavily clipped panel detection does not reject a normal fixed-height app panel below a header', () => {
  assert.equal(G.isHeavilyClippedPanel({
    left: 190, top: 64, right: 1600, bottom: 980,
    clientWidth: 1410, clientHeight: 916, viewportWidth: 1600, viewportHeight: 800
  }), false);
});

test('Smart selection rejects a severe clipped panel while explicit panel mode remains deliberate', () => {
  const options = { rootHeight: 9000, viewportHeight: 800, areaRatio: 0.35, semantic: 3, conversationHost: true, severelyClipped: true };
  assert.equal(G.shouldUseInnerScroller(options), false);
  assert.equal(G.shouldUseInnerScroller({ ...options, force: true }), true);
});

test('Smart mode selects a generic main panel when the document itself does not scroll', () => {
  assert.equal(G.shouldUseInnerScroller({
    rootHeight: 768, viewportHeight: 768, areaRatio: 0.55,
    semantic: 0, conversationHost: false
  }), true);
});

test('Manual Main scrollable panel mode can force an inner scroller', () => {
  assert.equal(G.shouldUseInnerScroller({
    rootHeight: 7949, viewportHeight: 768, areaRatio: 0.2,
    semantic: 0, conversationHost: false, force: true
  }), true);
});

test('root-scroll-height planning reaches the final edge without an unreachable body-height tail', () => {
  const viewportH = 700;
  // 5,480 px is the actual scrollable root extent in this regression model;
  // an unrelated body height must not be used to plan the final offset.
  const metrics = G.rootPageSize(1200, viewportH, 1200, 5480);
  const positions = G.axisPositions(metrics.pageH, viewportH, metrics.pageH, 0.14);
  assert.equal(positions.at(-1), metrics.pageH - viewportH);
  const tiles = positions.map((y, index) => ({ index, tileX: 0, tileY: y, tileW: metrics.pageW, tileH: viewportH }));
  assert.equal(G.validateTileCoverage(tiles, metrics.pageW, metrics.pageH, tiles.length).ok, true);
});

test('tile drift tolerance admits small notebook reflow but remains bounded by overlap', () => {
  const tolerance = G.safeTileDriftTolerance(682, 0.14);
  assert.ok(tolerance >= 11, `expected a small 11px shift to fit tolerance ${tolerance}`);
  assert.ok(tolerance <= 48, 'tolerance must remain capped to protect stitch continuity');
  assert.ok(G.safeTileDriftTolerance(320, 0.14) < 48, 'small viewports get a smaller overlap budget');
  assert.equal(G.safeTileDriftTolerance(0, 0.14), 8, 'invalid sizes return only the minimum conservative tolerance');
});

test('final panel height adjusts for a small shrink only when the final tile reaches the live bottom', () => {
  assert.equal(G.adjustedFinalPanelHeight(1670, 1659, 973, 686, 48), 1659, '11px notebook reflow is accommodated');
  assert.equal(G.adjustedFinalPanelHeight(1670, 1500, 973, 686, 48), 1670, 'large height changes are not hidden');
  assert.equal(G.adjustedFinalPanelHeight(1670, 1659, 500, 686, 48), 1670, 'not at live bottom, keep original height and let coverage validation decide');
});

test('axis positions cover top, middle and exact final edge with overlap', () => {
  const positions = G.axisPositions(2500, 800, 2500, 0.15);
  assert.equal(positions[0], 0);
  assert.equal(positions.at(-1), 1700);
  assert.ok(positions.every((n, i) => i === 0 || n > positions[i - 1]));
  for (let i = 1; i < positions.length; i++) {
    assert.ok(positions[i] - positions[i - 1] < 800, 'tiles overlap so they cannot leave a vertical gap');
  }
});

test('axis positions returns one tile for a page shorter than the viewport', () => {
  assert.deepEqual(G.axisPositions(500, 900, 500), [0]);
});

test('axis positions respects configured maximum size', () => {
  const positions = G.axisPositions(50000, 900, 12000);
  assert.equal(positions.at(-1), 11100);
  assert.ok(positions.every(n => n <= 11100));
});

test('rectangle intersection returns exact overlap and null when disjoint', () => {
  assert.deepEqual(G.intersectRect({x:0,y:0,w:100,h:100},{x:80,y:20,w:50,h:100}),{x:80,y:20,w:20,h:80});
  assert.equal(G.intersectRect({x:0,y:0,w:100,h:100},{x:101,y:0,w:20,h:20}),null);
});

test('part dimensions keep each output within dimension and area limits', () => {
  const parts = G.buildParts(1920, 50000, 2, 14000, 24000000);
  assert.ok(parts.length > 1);
  for (const p of parts) {
    assert.ok(p.w * 2 <= 14000);
    assert.ok(p.h * 2 <= 14000);
    assert.ok(p.w * p.h * 4 <= 24000000 + 1);
  }
});

test('filename generation removes invalid filename characters and limits length', () => {
  assert.equal(G.filenameBase('  A: <long> / page?.  '), 'A long page');
  assert.equal(G.filenameBase(''), 'page-capture');
  assert.ok(G.filenameBase('x'.repeat(300)).length <= 120);
});

test('part tiling covers all page dimensions without overlapping part rectangles', () => {
  const parts = G.buildParts(3300, 18000, 1.5, 12000, 8000000);
  assert.ok(parts.length > 1);
  assert.equal(Math.max(...parts.map(p => p.x + p.w)), 3300);
  assert.equal(Math.max(...parts.map(p => p.y + p.h)), 18000);
  assert.equal(parts[0].x, 0);
  assert.equal(parts[0].y, 0);
});


test('tile coverage accepts a tiny browser rounding remainder at the final page edge', () => {
  const width = 1601;
  const height = 5480;
  const viewportHeight = 739;
  const positions = G.axisPositions(height, viewportHeight, height, 0.14);
  const tiles = positions.map((y, index) => ({
    index, tileX: 0, tileY: y, tileW: width,
    // Mimic independent fractional CSS-coordinate and screenshot rounding:
    // the last viewport misses the measured document edge by 1 CSS px after independent integer rounding.
    tileH: index === positions.length - 1 ? viewportHeight - 1 : viewportHeight
  }));
  const result = G.validateTileCoverage(tiles, width, height, tiles.length);
  assert.equal(positions.length, 9);
  assert.equal(result.ok, true);
});

test('tile coverage still rejects a meaningful gap at the bottom page edge', () => {
  const width = 1601;
  const height = 5480;
  const viewportHeight = 739;
  const positions = G.axisPositions(height, viewportHeight, height, 0.14);
  const tiles = positions.map((y, index) => ({
    index, tileX: 0, tileY: y, tileW: width,
    tileH: index === positions.length - 1 ? viewportHeight - 2 : viewportHeight
  }));
  const result = G.validateTileCoverage(tiles, width, height, tiles.length);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'coverage-gap');
});

test('tile validation rejects missing screenshot indices before stitching', () => {
  const result = G.validateTileCoverage([
    { index: 0, tileX: 0, tileY: 0, tileW: 100, tileH: 100 },
    { index: 2, tileX: 0, tileY: 200, tileW: 100, tileH: 100 }
  ], 100, 300, 3);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-tiles');
  assert.deepEqual(result.missingIndices, [1]);
});

test('tile validation rejects geometric gaps even when tile count is complete', () => {
  const result = G.validateTileCoverage([
    { index: 0, tileX: 0, tileY: 0, tileW: 100, tileH: 100 },
    { index: 1, tileX: 0, tileY: 110, tileW: 100, tileH: 90 }
  ], 100, 200, 2);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'coverage-gap');
  assert.equal(result.gap.y, 100);
});

test('tile validation accepts overlapping grid tiles that cover the entire page', () => {
  const result = G.validateTileCoverage([
    { index: 0, tileX: 0, tileY: 0, tileW: 100, tileH: 110 },
    { index: 1, tileX: 0, tileY: 90, tileW: 100, tileH: 110 },
    { index: 2, tileX: 90, tileY: 0, tileW: 110, tileH: 110 },
    { index: 3, tileX: 90, tileY: 90, tileW: 110, tileH: 110 }
  ], 200, 200, 4);
  assert.equal(result.ok, true);
});

test('tile draw mapping applies crop offsets and page-to-canvas scale', () => {
  const mapping = G.tileDrawMapping(
    { tileX: 100, tileY: 200, tileW: 100, tileH: 100, cropX: 5, cropY: 7, scale: 2 },
    { x: 120, y: 230, w: 20, h: 10 },
    { x: 100, y: 200, w: 200, h: 100 },
    2,
    400,
    400
  );
  assert.deepEqual(mapping, { sx: 50, sy: 74, sw: 40, sh: 20, dx: 40, dy: 60, dw: 40, dh: 20 });
});

test('tile draw mapping clips fractional source overrun without stretching the clipped edge', () => {
  const mapping = G.tileDrawMapping(
    { tileX: 0, tileY: 0, tileW: 101, tileH: 50, cropX: 0, cropY: 0, scale: 1 },
    { x: 0, y: 0, w: 101, h: 50 },
    { x: 0, y: 0, w: 101, h: 50 },
    1,
    100,
    50
  );
  assert.ok(mapping);
  assert.equal(mapping.sx, 0);
  assert.equal(mapping.sw, 100);
  assert.equal(mapping.dx, 0);
  assert.equal(mapping.dw, 100);
});

test('tile draw mapping rejects a required source region outside the bitmap', () => {
  const mapping = G.tileDrawMapping(
    { tileX: 0, tileY: 0, tileW: 20, tileH: 20, cropX: 200, cropY: 0, scale: 1 },
    { x: 0, y: 0, w: 20, h: 20 },
    { x: 0, y: 0, w: 20, h: 20 },
    1,
    100,
    100
  );
  assert.equal(mapping, null);
});

test('very tall pages can be split into an arbitrary number of PNG output parts', () => {
  const parts = G.buildParts(1601, 100000, 1, 14000, 24000000);
  assert.ok(parts.length >= 7, `expected multiple parts for 100,000 CSS px, got ${parts.length}`);
  assert.equal(Math.max(...parts.map(p => p.y + p.h)), 100000);
  assert.equal(parts[0].y, 0);
});

test('300,000 CSS-pixel capture plans remain below the 800-tile safety budget on a typical viewport', () => {
  const positions = G.axisPositions(300000, 682, 300000, 0.14);
  assert.ok(positions.length > 500);
  assert.ok(positions.length < 800);
  assert.equal(positions.at(-1), 300000 - 682);
});

test('a multi-part export plan has no vertical or horizontal uncovered edge', () => {
  const width = 1920, height = 300000;
  const parts = G.buildParts(width, height, 1.5, 14000, 24000000);
  for (const part of parts) {
    assert.ok(part.w > 0 && part.h > 0);
    assert.ok(part.x >= 0 && part.y >= 0);
    assert.ok(part.x + part.w <= width + 1e-9);
    assert.ok(part.y + part.h <= height + 1e-9);
  }
  assert.equal(Math.max(...parts.map(p => p.x + p.w)), width);
  assert.equal(Math.max(...parts.map(p => p.y + p.h)), height);
});


test('a 300,000 CSS-pixel page produces many automatically numbered PNG parts', () => {
  const parts = G.buildParts(1601, 300000, 1, 14000, 24000000);
  assert.ok(parts.length >= 20, `expected many output files, received ${parts.length}`);
  assert.equal(Math.min(...parts.map(p => p.y)), 0);
  assert.equal(Math.max(...parts.map(p => p.y + p.h)), 300000);
});
