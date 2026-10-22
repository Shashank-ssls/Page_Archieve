const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../geometry.js');
const P = require('../protocol.js');

const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

test('render chunks are contiguous, non-overlapping and cover the full height', () => {
  for (const [total, step] of [[1, 8192], [8192, 8192], [8193, 8192], [63871, 4096], [300000, 8192]]) {
    const chunks = G.renderChunks(total, step);
    assert.equal(chunks[0].y, 0);
    let y = 0;
    for (const c of chunks) {
      assert.equal(c.y, y);
      assert.ok(c.h > 0 && c.h <= step);
      y += c.h;
    }
    assert.equal(y, total);
  }
  assert.deepEqual(G.renderChunks(0, 100), []);
});

test('render chunk height respects device pixel ratio and texture limits', () => {
  assert.equal(G.renderChunkHeight(1), 8192);
  assert.equal(G.renderChunkHeight(2), 4096);
  assert.equal(G.renderChunkHeight(3), 2730);
  assert.equal(G.renderChunkHeight(0), 8192);
  assert.ok(G.renderChunkHeight(64) >= 256);
});

test('panel growth accounts for overflow and for a panel extending below the viewport', () => {
  const base = { innerH: 800, panel: { top: 64, left: 190, width: 900, height: 880, bottom: 944, overflow: 8271, ancestorClip: 0 } };
  assert.equal(G.panelGrowthNeeded(base), 8271 + 144);
  assert.equal(G.panelFullyExposed(base), false);
  const exposed = { innerH: 9300, panel: { top: 64, left: 190, width: 900, height: 9151, bottom: 9215, overflow: 0, ancestorClip: 0 } };
  assert.equal(G.panelGrowthNeeded(exposed), 0);
  assert.equal(G.panelFullyExposed(exposed), true);
  assert.equal(G.panelFullyExposed({ ...exposed, panel: { ...exposed.panel, ancestorClip: 40 } }), false);
  assert.equal(G.panelFullyExposed({ ...exposed, panel: { ...exposed.panel, top: -200 } }), false);
  assert.equal(G.panelGrowthNeeded({ innerH: 800, panel: { overflow: 0.6, bottom: 800.4 } }), 0);
});

test('document render width never exceeds the scroll width (off-canvas menus)', () => {
  assert.equal(G.renderDocumentWidth(3200, 1280, 1280), 1280);
  assert.equal(G.renderDocumentWidth(1600, 1600, 1280), 1600);
  assert.equal(G.renderDocumentWidth(0, 0, 1280), 1280);
  assert.equal(G.renderDocumentWidth(90000, 90000, 1280), 16000);
});

test('ASCII filename fallback keeps the extension and replaces dashes', () => {
  assert.equal(G.asciiFilename('Fixture \u2014 Clipped Panel.png'), 'Fixture - Clipped Panel.png');
  assert.equal(G.asciiFilename('\u65e5\u672c\u8a9e.pdf'), 'page-capture.pdf');
  assert.equal(G.asciiFilename('Caf\u00e9 menu.jpg'), 'Cafe menu.jpg');
});

test('render-engine page commands are registered and distinct from stitcher commands', () => {
  for (const type of ['PAC_RENDER_MEASURE', 'PAC_RENDER_PIN', 'PAC_RENDER_SETTLE']) {
    assert.equal(P.isPageCommand(type), true);
    assert.equal(P.isStitcherCommand(type), false);
    assert.match(content, new RegExp(`message\\.type === '${type}'`));
  }
});

test('manifest declares debugger for the render engine and keeps no host permissions', () => {
  assert.ok(manifest.permissions.includes('debugger'));
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.optional_host_permissions, undefined);
});

test('render failure falls back to full-page stitching, never to a viewport screenshot', () => {
  const fallback = background.indexOf('Retried with scroll-and-stitch');
  const stitch = background.indexOf('captured = await runStitch(job, report)');
  assert.ok(fallback > 0 && stitch > fallback);
  assert.match(background, /PAC_CLEANUP', captureId: job\.captureId \}\)[\s\S]{0,80}job\.sessionBegun = false/);
  assert.doesNotMatch(background, /runRender[\s\S]{0,400}takeVisibleCapture/);
});

test('debugger session is always detached and the viewport override cleared', () => {
  assert.match(background, /finally \{\s*if \(job\.cdp\) await job\.cdp\.detach\(\)/);
  const cdp = fs.readFileSync(path.join(root, 'cdp.js'), 'utf8');
  assert.match(cdp, /async detach\(\) \{\s*await this\.clearViewport\(\)/);
  assert.match(cdp, /canceled_by_user/);
});

test('stitch engine only throttles when using captureVisibleTab', () => {
  assert.match(background, /if \(i < tiles\.length - 1 && !useCdp\) await sleep\(CAPTURE_GAP_MS\)/);
  assert.match(background, /if \(!useCdp\) await assertOriginalTabStillActive/);
});

test('body-as-scroller pages are eligible as a capture panel', () => {
  assert.match(content, /const bodyScrolls = /);
  assert.match(content, /if \(el === document\.body && !bodyScrolls\) continue;/);
  assert.ok(fs.existsSync(path.join(__dirname, 'site-fixture', 'body-scroller.html')));
  assert.ok(fs.existsSync(path.join(__dirname, 'site-fixture', 'virtual-chat.html')));
});

test('panel pin measures content height with the box collapsed', () => {
  const pin = content.slice(content.indexOf('function renderPinPanel'), content.indexOf('function renderHideFloating'));
  const collapse = pin.indexOf("setProperty('height', '0px'");
  const read = pin.indexOf('const full = el.scrollHeight');
  assert.ok(collapse > 0 && read > collapse);
});

test('style restoration removes an empty style attribute it created', () => {
  assert.match(content, /hadStyleAttr: el\.hasAttribute\('style'\)/);
  assert.match(content, /entry\.el\.removeAttribute\('style'\)/);
});

test('document render grows the viewport after pinning viewport-sized elements, with a beyond-viewport fallback', () => {
  const grow = background.slice(background.indexOf('async function renderDocumentGrow'), background.indexOf('async function renderDocumentBeyondViewport'));
  const snap = grow.indexOf("PAC_RENDER_VH_SNAPSHOT");
  const nudge = grow.indexOf('cdp.setViewport(baseW, baseH + NUDGE)');
  const pin = grow.indexOf("PAC_RENDER_VH_PIN");
  const full = grow.indexOf('cdp.setViewport(baseW, viewportH)');
  assert.ok(snap > 0 && nudge > snap && pin > nudge && full > pin);
  assert.match(background, /if \(!plan\) plan = await renderDocumentBeyondViewport/);
  for (const t of ['PAC_RENDER_VH_SNAPSHOT', 'PAC_RENDER_VH_PIN']) assert.equal(P.isPageCommand(t), true);
});

test('vh pinning measures all elements before pinning and neutralises fixed backgrounds', () => {
  const fn = content.slice(content.indexOf('function renderVhPin'), content.indexOf('// Pin the panel to its full content height'));
  assert.ok(fn.indexOf('changed.push(entry)') < fn.indexOf("el.style.setProperty('height'"));
  assert.match(content, /async function freezeWindowBackgrounds/);
  assert.match(content, /await freezeWindowBackgrounds()/);
  assert.match(content, /content-visibility: visible !important/);
  assert.ok(fs.existsSync(path.join(__dirname, 'site-fixture', 'reveal-lazy.html')));
});
