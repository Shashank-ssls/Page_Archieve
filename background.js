'use strict';

importScripts('geometry.js', 'url-policy.js', 'cdp.js', 'redact.js');

const G = self.PageArchiveGeometry;
const R = self.PageArchiveRedact;
const URL_POLICY = self.PageArchiveUrlPolicy;
const CDP = self.PageArchiveCdp;
const MAX_CAPTURE_TILES = 800;
const CAPTURE_GAP_MS = 600;
const MAX_CAPTURE_CSS_HEIGHT = 300000;
const DEFAULTS = {
  engine: 'auto',
  format: 'png',
  prepareImages: true,
  autoLoadMore: false,
  hideFloating: true,
  expandContent: true,
  nameTemplate: '{title}',
  folder: '',
  maxHeight: 200000,
  waitMs: 2500,
  captureTarget: 'auto',
  redact: false,
  redactWords: '',
  // Show the review screen before saving a redacted capture. Only the E2E
  // harness turns it off, to test the automatic boxes on their own.
  redactReview: true
};
const REDACT_NEEDS_TEXT = 'Share-safe Redact needs the page text that only the Full render engine reads';
const ENGINES = ['auto', 'stitch'];
// JPEG output was removed (owner, 2026-10-24): lossy text blurs when zoomed.
// A saved 'jpeg' setting falls back to PNG. PDF pages still embed JPEG.
const FORMATS = ['png', 'pdf'];
let activeJob = null;
const IS_FULL_EDITION = ((chrome.runtime.getManifest().permissions) || []).includes('debugger');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function errorText(error) { return String(error && error.message ? error.message : error); }

function progress(tabId, phase, percent, message, extra = {}) {
  const bounded = Math.max(0, Math.min(100, Math.round(percent || 0)));
  const snapshot = {
    type: 'PAC_PROGRESS', tabId, phase, percent: bounded, message, ...extra, updatedAt: Date.now()
  };
  // Persist status so a closed action popup cannot erase the error that explains
  // why a capture failed. Store no page contents or screenshot data here.
  chrome.storage.local.set({ pageArchiveLastProgress: snapshot }).catch(() => {});
  // A plain counter of successful captures, read by the popup's one-time
  // review prompt. Local only.
  if (phase === 'done') {
    chrome.storage.local.get('pageArchiveCaptureCount')
      .then(s => chrome.storage.local.set({ pageArchiveCaptureCount: (Number(s.pageArchiveCaptureCount) || 0) + 1 }))
      .catch(() => {});
  }
  if (phase === 'error') console.error('[Tallshot]', message, extra.warnings || []);
  chrome.action.setBadgeBackgroundColor({ tabId, color: phase === 'error' ? '#c2410c' : phase === 'done' ? '#1c1a16' : '#ff6b1a' }).catch(() => {});
  chrome.action.setBadgeText({ tabId, text: phase === 'done' ? 'OK' : phase === 'error' ? '!' : phase === 'cancelled' ? '' : `${bounded}%` }).catch(() => {});
  chrome.runtime.sendMessage(snapshot).catch(() => {});
  if (activeJob && activeJob.tabId === tabId) {
    activeJob.phase = phase;
    activeJob.percent = bounded;
    activeJob.message = message;
    activeJob.engineLabel = extra.engineLabel || activeJob.engineLabel;
  }
}

function cleanBaseName(title, url, template) {
  let host = 'webpage';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (_) {}
  const safeTitle = G.filenameBase(title, G.filenameBase(host, 'webpage'));
  return G.filenameBase(G.applyNameTemplate(template || '{title}', { title: safeTitle, site: host }), safeTitle);
}

// The page title becomes the file name; with Redact on, secrets in it go too.
function redactTitle(title, settings) {
  if (!settings.redact) return title;
  return R.redactString(title, R.parseWordList(settings.redactWords)).text.replace(/\[redacted\]/g, 'redacted');
}

async function getTab(tabId) {
  try { return await chrome.tabs.get(tabId); }
  catch (_) { throw new Error('The original browser tab is no longer available.'); }
}

async function assertOriginalTabStillActive(tabId, windowId) {
  const tabs = await chrome.tabs.query({ active: true, windowId });
  if (!tabs[0] || tabs[0].id !== tabId) {
    throw new Error('The original page is no longer the active tab. Switch back to it and start the capture again.');
  }
}

async function sendToStitcher(stitcherTabId, message, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const remaining = Math.max(1, timeoutMs - (Date.now() - started));
    let timer = null;
    try {
      const response = await Promise.race([
        chrome.runtime.sendMessage(message),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Timed out waiting for ${message.type} from the local PNG assembly page.`)), remaining);
        })
      ]);
      if (response && response.ok) return response;
      if (response && response.error) throw new Error(response.error);
    } catch (error) {
      const transient = error && /closed|receiving end|message port|Could not establish/i.test(error.message || '');
      const pingTimeout = message.type === 'PAC_PING' && error && /Timed out waiting for PAC_PING/i.test(error.message || '');
      if (transient || pingTimeout) {
        await sleep(200);
        continue;
      }
      throw error;
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
    await sleep(200);
  }
  throw new Error('The local stitching page did not respond. Try reloading the extension and retrying.');
}

async function openStitcher(windowId, captureId) {
  const tab = await chrome.tabs.create({
    url: chrome.runtime.getURL(`stitcher.html?captureId=${encodeURIComponent(captureId)}`),
    active: false,
    windowId
  });
  const start = Date.now();
  while (Date.now() - start < 15000) {
    try {
      await chrome.tabs.get(tab.id);
      const answer = await sendToStitcher(tab.id, { type: 'PAC_PING', captureId }, 1200).catch(() => null);
      if (answer && answer.ready) return tab.id;
    } catch (_) {}
    await sleep(250);
  }
  await chrome.tabs.remove(tab.id).catch(() => {});
  throw new Error('Could not initialize the local PNG stitching page.');
}

function makeOffsets(total, viewport, maxSize) {
  return G.axisPositions(total, viewport, maxSize, 0.14);
}

async function injectContent(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['geometry.js', 'protocol.js', 'content.js'] });
  } catch (error) {
    const raw = errorText(error);
    // Chrome may omit restricted-page URLs from Tab metadata. Normalize the
    // scripting failure so users still get the right explanation even when the
    // popup cannot pre-detect chrome:// or chrome-extension:// from tab.url.
    if (/cannot access contents of url|cannot access a chrome:\/\/ url|extensions gallery cannot be scripted|cannot access .*chrome-extension:\/\//i.test(raw)) {
      throw new Error('Chrome blocked script injection on this browser-internal or extension page. Full-page scrolling is not supported there; choose Visible area for the viewport, or use a regular website for full-page capture.');
    }
    throw error;
  }
}

async function getContentMessage(tabId, message) {
  const response = await chrome.tabs.sendMessage(tabId, message);
  if (!response || response.ok === false) throw new Error((response && response.error) || 'The page inspection script did not return a result.');
  return response;
}

function checkCancel(job) {
  if (job.cancel) throw new Error('Capture cancelled.');
  if (job.cdp && job.cdp.detachedReason === 'canceled_by_user') {
    job.cancel = true;
    throw new Error('Capture cancelled.');
  }
}

async function takeVisibleCapture(tab, job, stitcherTabId, title, url, warnings = []) {
  const { settings } = job;
  // Redact on a visible-area shot: read the page text first (the page does
  // not change between reading and the screenshot), in screenshot pixels.
  let runs = null;
  let drawn = 0;
  if (settings.redact) {
    progress(tab.id, 'prepare', 20, 'Reading page text to find secrets\u2026');
    await injectContent(tab.id);
    let collected;
    try {
      collected = await getContentMessage(tab.id, { type: 'PAC_COLLECT_TEXT', visible: true, wordEdges: true, maxWords: 150000 });
    } catch (error) {
      throw new Error(`Could not read the page text for Share-safe Redact (${errorText(error).slice(0, 120)}). Nothing was saved.`);
    }
    // captureVisibleTab returns device pixels; the stitcher keeps visible
    // shots at scale 1, so the boxes are scaled to match.
    const k = Number(collected.dpr) > 0 ? Number(collected.dpr) : 1;
    runs = (collected.runs || []).map(r => [r[0] * k, r[1] * k, r[2] * k, r[3] * k, r[4] * k, r[5], Array.isArray(r[6]) ? r[6].map(v => v * k) : r[6], r[7]]);
    drawn = collected.drawn || 0;
  }
  await assertOriginalTabStillActive(tab.id, tab.windowId);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  if (drawn > 0) warnings.push(`Share-safe Redact could not check ${drawn} drawn area(s) (canvas, embedded document or frame), such as a PDF or document preview. Text painted there is not redacted: draw a box over it in the review, or check it yourself before sharing.`);
  await sendToStitcher(stitcherTabId, {
    type: 'PAC_BEGIN', captureId: job.captureId,
    session: { title, url, mode: 'visible', pageW: 1, pageH: 1, captureW: 1, captureH: 1, truncated: false, warnings, fallbackVisible: true }
  });
  await sendToStitcher(stitcherTabId, {
    type: 'PAC_STORE_TILE', captureId: job.captureId, dataUrl,
    tile: { index: 0, tileX: 0, tileY: 0, tileW: 1, tileH: 1, cropX: 0, cropY: 0, viewportW: 0, fallbackVisible: true }
  });
  if (runs) await sendToStitcher(stitcherTabId, { type: 'PAC_STORE_TEXT', captureId: job.captureId, runs, links: [], marks: [] }, 60000);
  const review = settings.redact && settings.redactReview;
  if (review) {
    progress(tab.id, 'stitch', 82, 'Check the redactions in the Tallshot tab, then press Save there.');
    await chrome.tabs.update(stitcherTabId, { active: true }).catch(() => {});
  } else {
    progress(tab.id, 'stitch', 82, 'Encoding the visible area\u2026');
  }
  try {
    return await sendToStitcher(stitcherTabId, {
      type: 'PAC_COMPOSE', captureId: job.captureId, expectedTileCount: 1,
      baseName: cleanBaseName(redactTitle(title, settings), url, settings.nameTemplate), folder: settings.folder, format: settings.format,
      capturedAt: job.startedAt, redact: settings.redact, redactWords: settings.redactWords, review
    }, review ? 60 * 60 * 1000 : 15000);
  } finally {
    if (review) await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
  }
}

function normalizeSettings(userSettings, tabId) {
  const settings = { ...DEFAULTS, ...(userSettings || {}) };
  settings.maxHeight = Math.max(2000, Math.min(MAX_CAPTURE_CSS_HEIGHT, Number(settings.maxHeight) || DEFAULTS.maxHeight));
  settings.waitMs = Math.max(250, Math.min(5000, Number(settings.waitMs) || DEFAULTS.waitMs));
  settings.captureTarget = ['auto', 'document', 'panel'].includes(settings.captureTarget) ? settings.captureTarget : 'auto';
  settings.engine = ENGINES.includes(settings.engine) ? settings.engine : 'auto';
  settings.format = FORMATS.includes(settings.format) ? settings.format : 'png';
  settings.prepareImages = settings.prepareImages !== false;
  settings.autoLoadMore = settings.autoLoadMore === true;
  settings.hideFloating = settings.hideFloating !== false;
  settings.expandContent = settings.expandContent !== false;
  // Lite has no text map, so Redact is never on there.
  settings.redact = settings.redact === true && IS_FULL_EDITION;
  settings.redactWords = String(settings.redactWords || '').slice(0, 4000);
  settings.redactReview = settings.redactReview !== false;
  settings.nameTemplate = String(settings.nameTemplate || '{title}').slice(0, 120);
  settings.folder = G.safeFolder(settings.folder);
  settings.tabId = tabId;
  return settings;
}

function auditMessageFrom(latestImageAudit, failedCssImageLabels) {
  if (!latestImageAudit || !(latestImageAudit.htmlImagesSeen || latestImageAudit.cssAssetsSeen)) return '';
  const imageFailureCount = latestImageAudit.htmlImageFailuresDetected || 0;
  const cssFailureCount = latestImageAudit.cssAssetsFailed || failedCssImageLabels.size || 0;
  const incompleteCount = imageFailureCount + cssFailureCount;
  const details = `Image audit: saw ${latestImageAudit.htmlImagesSeen || 0} HTML images and checked ${latestImageAudit.cssAssetsChecked || 0} CSS/embedded image URLs`;
  if (incompleteCount) return `${details}; ${imageFailureCount} HTML image(s) were incomplete at least once and ${cssFailureCount} CSS/embedded asset(s) failed.`;
  if (latestImageAudit.cssAssetsTimedOut || latestImageAudit.auditLimitHit || latestImageAudit.imageSetUnverified) return `${details}; no confirmed failures were found in checked assets, but some images could not be fully verified.`;
  return `${details}; no failures were detected in the checked sources.`;
}

// Shared per-capture accumulator for warnings and image-audit results.
function makeReport() {
  return { warnings: [], latestImageAudit: null, failedCssImageLabels: new Set() };
}

function absorbAudit(report, state, sectionLabel) {
  if (!state) return;
  if (state.auditSummary) report.latestImageAudit = state.auditSummary;
  if (state.auditWarnings) report.warnings.push(...state.auditWarnings);
  if (state.brokenImages && state.brokenImages.length) {
    const examples = state.brokenImages.slice(0, 2).join(', ');
    const suffix = examples ? ` Examples: ${examples}${state.brokenImages.length > 2 ? ', \u2026' : ''}.` : '';
    report.warnings.push(`${state.brokenImages.length} HTML <img> element(s) appeared broken, undecoded, or incomplete ${sectionLabel}.${suffix} The source may still be loading or unavailable; those pixels cannot be reconstructed by the extension.`);
  }
  for (const label of state.cssImageFailures || []) report.failedCssImageLabels.add(label);
}

async function storeTiles(job, tiles) {
  for (const t of tiles) {
    checkCancel(job);
    await sendToStitcher(job.stitcherTabId, { type: 'PAC_STORE_TILE', captureId: job.captureId, dataUrl: t.dataUrl, tile: t.tile }, 60000);
  }
}

// Names a few hidden elements so a capture's warning shows what was removed.
function hiddenDetail(settled) {
  const examples = settled && Array.isArray(settled.hiddenExamples) ? settled.hiddenExamples.slice(0, 4) : [];
  let text = examples.length ? ` Examples: ${examples.join(', ')}.` : '';
  if (settled && settled.hiddenCapReached) text += ' The safety limit of 400 was reached; some floating elements may still show.';
  return text;
}

function floatingWarning(report, settled) {
  const hidden = settled && settled.hidden;
  if (hidden) report.warnings.push(`Hid ${hidden} floating bar(s) pinned to the bottom of the window (composers, cookie banners, chat widgets) so they do not cover content. Turn off \u201cHide floating bars\u201d to keep them.${hiddenDetail(settled)}`);
}

// One flag per device row of a screenshot: 1 when the row is a single flat
// colour. Drawn at reduced width to stay cheap; text strokes keep enough
// contrast after averaging.
async function plainRows(dataUrl) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  try {
    const w = Math.max(1, Math.min(bitmap.width, 480));
    const h = bitmap.height;
    const g = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
    g.drawImage(bitmap, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const rows = new Uint8Array(h);
    for (let y = 0, i = 0; y < h; y++) {
      let lo = 255, hi = 0;
      for (let x = 0; x < w; x++, i += 4) {
        const l = (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10;
        if (l < lo) lo = l;
        if (l > hi) hi = l;
      }
      rows[y] = hi - lo < 10 ? 1 : 0;
    }
    return rows;
  } finally {
    bitmap.close();
  }
}

// Preferred document path: grow the emulated viewport to the full document so
// on-screen-only loaders fire and fixed backdrops cover the whole page. Elements
// sized from the viewport are pinned first so 100vh sections keep their size.
async function renderDocumentGrow(job, report, settleMsg) {
  const { tabId, settings, cdp } = job;
  const lm = await cdp.layoutMetrics();
  const baseW = lm.cssLayoutViewport.clientWidth;
  const baseH = lm.cssLayoutViewport.clientHeight;
  progress(tabId, 'prepare', 7, 'Measuring viewport-sized sections\u2026');
  await getContentMessage(tabId, { type: 'PAC_RENDER_VH_SNAPSHOT' });
  const NUDGE = 240;
  await cdp.setViewport(baseW, baseH + NUDGE);
  await sleep(250);
  let measure = (await getContentMessage(tabId, { type: 'PAC_RENDER_VH_PIN', delta: NUDGE })).measure;
  const cap = settings.maxHeight;
  let viewportH = baseH + NUDGE;
  let grew = false;
  let settled = null;
  // Some apps end the page with empty space sized to the window (Claude's end
  // spacer, 2026-10): every growth round then adds the whole content height
  // again until Max height. When the blank tail after the last visible text
  // or media is taller than a viewport AND grew by at least half of the
  // viewport growth since the last measurement, hide paintless end spacers
  // once and end the capture just below the content. A tall but static
  // section without text is never cut.
  let endCut = 0;
  let lastTail = null;
  const targetHeight = async () => {
    const docH = Math.ceil(measure.docH);
    const ink = await getContentMessage(tabId, { type: 'PAC_INK_BANDS' }).catch(() => null);
    if (!ink || !(ink.extent > 0)) return Math.min(cap, endCut || docH);
    if (!endCut) {
      const tail = docH - ink.extent;
      const prev = lastTail;
      lastTail = { tail, viewportH };
      const chasing = prev && viewportH - prev.viewportH > 200 && tail > baseH + 200 && tail - prev.tail >= (viewportH - prev.viewportH) * 0.5;
      if (!chasing) return Math.min(cap, docH);
      await getContentMessage(tabId, { type: 'PAC_RENDER_TRIM_END' }).catch(() => null);
    }
    // Re-measured every round: images that load during settle may extend the content.
    endCut = Math.max(endCut, baseH, Math.ceil(ink.extent + 64));
    return Math.min(cap, endCut);
  };
  for (let round = 0; round < 6; round++) {
    checkCancel(job);
    const target = await targetHeight();
    if (target > viewportH + 1 || (endCut && target < viewportH - 1) || !grew) {
      viewportH = Math.max(baseH, target);
      grew = true;
      progress(tabId, 'prepare', 8, `Laying out the full page (${viewportH.toLocaleString()} px)\u2026`);
      await cdp.setViewport(baseW, viewportH);
      await sleep(400);
      measure = (await getContentMessage(tabId, { type: 'PAC_RENDER_MEASURE' })).measure;
      continue;
    }
    // Stable: let images that just became "visible" load, then re-check growth.
    settled = await getContentMessage(tabId, { ...settleMsg, imageWaitMs: Math.max(3000, settings.waitMs) });
    noteLateExpand(report, settled);
    measure = settled.measure;
    const after = await targetHeight();
    if (after <= viewportH + 1 && !(endCut && after < viewportH - 1)) break;
    settled = null;
  }
  if (!settled) {
    settled = await getContentMessage(tabId, { ...settleMsg, imageWaitMs: Math.max(3000, settings.waitMs) });
    noteLateExpand(report, settled);
    measure = settled.measure;
  }
  absorbAudit(report, settled, 'in the rendered page');
  floatingWarning(report, settled);
  const lm2 = await cdp.layoutMetrics();
  const content = lm2.cssContentSize || lm2.contentSize;
  const width = G.renderDocumentWidth(content.width, measure.docW, baseW);
  // After an end cut the document height still includes the window-sized
  // spacer, which is not content: do not report the capture as truncated.
  const fullH = endCut ? Math.min(endCut, Math.ceil(Math.max(measure.docH, content.height))) : Math.ceil(Math.max(measure.docH, content.height));
  const height = Math.min(viewportH, fullH, settings.maxHeight);
  if (endCut) report.warnings.push('The page adds empty space that grows with the window after its last content (an end spacer). The capture ends 64 px below the last visible text or image.');
  // An app shell (chat, notebook) does not scroll as a document: its content
  // sits in a scroll panel. Say so instead of handing back one screen silently.
  const inkEnd = await getContentMessage(tabId, { type: 'PAC_INK_BANDS' }).catch(() => null);
  if (job.panelHidden > 200 && !(inkEnd && inkEnd.extent > height + 200)) {
    report.warnings.push(`This page does not scroll as a document: a scroll panel holds about ${Math.round(job.panelHidden).toLocaleString()} px more content that this capture does not include. Choose Smart or Panel in Target to capture it.`);
  }
  if (inkEnd && inkEnd.extent > height + 200) {
    report.warnings.push(`The document itself is only ${height.toLocaleString()} px tall; most of the content (to about ${Math.round(inkEnd.extent).toLocaleString()} px) is inside a scroll panel the document does not grow. Choose Smart or Panel in Target to capture it.`);
  }
  return { width, height, fullH, x: 0, y: 0, beyondViewport: width > baseW + 1, dpr: measure.dpr, title: measure.title, url: measure.url };
}

// Fallback document path: captureBeyondViewport at the original viewport size.
async function renderDocumentBeyondViewport(job, report, settleMsg) {
  const { tabId, settings, cdp } = job;
  progress(tabId, 'prepare', 8, 'Settling images and fonts\u2026');
  const settled = await getContentMessage(tabId, settleMsg);
  noteLateExpand(report, settled);
  absorbAudit(report, settled, 'during preparation');
  floatingWarning(report, settled);
  const lm = await cdp.layoutMetrics();
  const content = lm.cssContentSize || lm.contentSize;
  const measure = settled.measure;
  const width = G.renderDocumentWidth(content.width, measure.docW, measure.innerW);
  const fullH = Math.ceil(Math.max(content.height, measure.docH || 0));
  const height = Math.min(fullH, settings.maxHeight);
  return { width, height, fullH, x: 0, y: 0, beyondViewport: true, dpr: measure.dpr, title: measure.title, url: measure.url };
}

// ---------------------------------------------------------------------------
// Render engine: chrome.debugger screenshots of the fully laid-out page.
// Document targets use captureBeyondViewport, so the page renders at its real
// height with fixed headers drawn once and vh units unchanged. Inner panels
// (chat apps, notebooks) are exposed by growing the emulated viewport until the
// panel no longer overflows, then screenshotting the panel rectangle.
// ---------------------------------------------------------------------------
// Virtualised chats mount messages only once the panel is grown, so the
// render settle step clicks "Show more" again; report those clicks honestly.
function noteLateExpand(report, settled) {
  const boxes = settled && settled.lateBoxes;
  if (boxes) {
    report.lateBoxes = (report.lateBoxes || 0) + boxes;
    report.warnings = report.warnings.filter(w => !w.startsWith('Let inner scroll boxes'));
    report.warnings.push(`Let inner scroll boxes grow to full height while rendering (${report.lateBoxes} inner scroll box${report.lateBoxes === 1 ? '' : 'es'}).`);
  }
  const n = settled && settled.lateExpanded;
  if (!n) return;
  report.lateExpanded = (report.lateExpanded || 0) + n;
  report.warnings = report.warnings.filter(w => !w.startsWith('Expanded more collapsed content'));
  report.warnings.push(`Expanded more collapsed content while rendering (${report.lateExpanded} \u201cshow more\u201d button${report.lateExpanded === 1 ? '' : 's'}). Clicked buttons stay expanded on the page after capture.`);
}

async function runRender(job, report) {
  const { tabId, settings, cdp } = job;
  progress(tabId, 'prepare', 3, 'Preparing the page for a full render\u2026', { engineLabel: 'Full render' });
  await injectContent(tabId);
  checkCancel(job);
  job.contentReady = true;
  const prepared = await getContentMessage(tabId, { type: 'PAC_PREPARE', settings: { ...settings, engine: 'render' } });
  checkCancel(job);
  if (prepared.warnings) report.warnings.push(...prepared.warnings);
  job.panelHidden = prepared.panelHidden || 0;
  if (prepared.preset) progress(tabId, 'prepare', 5, `Detected ${prepared.preset} layout\u2026`, { engineLabel: `Full render \u00b7 ${prepared.preset}` });
  const scrollerType = prepared.metrics && prepared.metrics.scrollerType === 'inner' ? 'inner' : 'root';
  const settleMsg = { type: 'PAC_RENDER_SETTLE', waitMs: Math.min(settings.waitMs, 2500), hideFloating: settings.hideFloating };

  let plan;
  if (scrollerType === 'root') {
    try {
      plan = await renderDocumentGrow(job, report, settleMsg);
    } catch (error) {
      if (job.cancel || /cancelled/i.test(errorText(error))) throw error;
      console.warn('[Tallshot] document grow failed, using beyond-viewport render:', errorText(error));
      await cdp.clearViewport().catch(() => {});
      await sleep(300);
      plan = null;
    }
    if (!plan) plan = await renderDocumentBeyondViewport(job, report, settleMsg);
  } else {
    progress(tabId, 'prepare', 6, 'Expanding the scroll panel\u2026');
    const lm = await cdp.layoutMetrics();
    const baseW = lm.cssLayoutViewport.clientWidth;
    const baseH = lm.cssLayoutViewport.clientHeight;
    const cap = baseH + settings.maxHeight + 4000;
    let measure = (await getContentMessage(tabId, { type: 'PAC_RENDER_MEASURE' })).measure;
    let viewportH = baseH;
    let pinned = false;
    let lastNeed = Infinity;
    let settled = null;
    let truncated = false;
    // 20 rounds: each late "Show more" pass in a virtualised chat costs a
    // grow round and a settle round.
    for (let round = 0; round < 20; round++) {
      checkCancel(job);
      const need = G.panelGrowthNeeded(measure);
      if (need === 0) {
        // Exposed. One full settle lets lazy images load and floating UI hide;
        // if that grows the panel again, keep looping.
        settled = await getContentMessage(tabId, settleMsg);
        noteLateExpand(report, settled);
        measure = settled.measure;
        if (G.panelGrowthNeeded(measure) === 0) break;
        continue;
      }
      // The panel did not grow with the viewport (fixed px height, max-height,
      // calc overshoot). Pin it to its content height once, then keep growing.
      if (!pinned && round >= 1 && need >= lastNeed - 2) {
        pinned = true;
        measure = (await getContentMessage(tabId, { type: 'PAC_RENDER_PIN' })).measure;
        lastNeed = Infinity;
        continue;
      }
      lastNeed = need;
      const next = Math.min(cap, viewportH + need);
      if (next <= viewportH) { truncated = true; break; }
      viewportH = next;
      progress(tabId, 'prepare', 7, `Expanding the scroll panel (${Math.round(viewportH).toLocaleString()} px)\u2026`);
      await cdp.setViewport(baseW, viewportH);
      await sleep(350);
      measure = (await getContentMessage(tabId, { type: 'PAC_RENDER_MEASURE' })).measure;
    }
    if (!settled) {
      settled = await getContentMessage(tabId, settleMsg);
      noteLateExpand(report, settled);
      measure = settled.measure;
    }
    absorbAudit(report, settled, 'in the expanded panel');
    const p = measure.panel;
    if (!p) throw new Error('The selected panel disappeared while it was being expanded.');
    if (!truncated && !G.panelFullyExposed(measure)) {
      throw new Error(`The panel could not be fully exposed (overflow ${Math.round(p.overflow)}px, clipped ${Math.round(p.ancestorClip || 0)}px).`);
    }
    if (settled.hidden) report.warnings.push(`Hid ${settled.hidden} floating element(s) over the captured panel (message boxes, toolbars, floating buttons).${hiddenDetail(settled)}`);
    report.warnings.push('Captured the main scrollable panel, not the surrounding app shell. Choose Document in Target to capture the page shell instead.');
    if (measure.replaced) report.warnings.push('The site rebuilt its scroll panel while the window grew; the capture followed the new panel. Check that the start and end of the conversation are present.');
    const height = Math.min(Math.floor(p.height), settings.maxHeight);
    plan = {
      width: Math.floor(p.width), height, fullH: Math.max(p.height, p.scrollHeight),
      x: Math.max(0, p.left), y: Math.max(0, p.top), beyondViewport: false,
      dpr: measure.dpr, title: measure.title, url: measure.url
    };
  }

  if (!(plan.width > 0) || !(plan.height > 0)) throw new Error('Could not measure the area to render.');
  // Text bands (paint check) and content extent, in viewport CSS px.
  const ink = await getContentMessage(tabId, { type: 'PAC_INK_BANDS' }).catch(() => null);
  if (scrollerType === 'inner' && ink && ink.extent > 0) {
    // Backstop for window-sized end spacers in panels (Claude, 2026-10: 12
    // blank PDF pages up to Max height) that the spacer rules did not hide.
    // Also trims the room a chat keeps for its (hidden) message box.
    const cut = G.endSpacerCut(plan.height, ink.extent - plan.y, 200);
    // Only a large trim is worth a warning; a few hundred px is reserved space.
    if (cut < plan.height - 400) {
      report.warnings.push(`The panel ended in ${Math.round(plan.height - cut).toLocaleString()} px of empty space after its last content (an end spacer); the capture ends 64 px below the last visible text or image.`);
    }
    if (cut < plan.height) {
      plan.height = cut;
      plan.fullH = cut;
    }
  }
  const truncated = plan.fullH > plan.height + 1;
  if (truncated) report.warnings.push(`The capture was limited to ${plan.height.toLocaleString()} CSS pixels (Max height setting) to protect browser memory.`);
  const chunks = G.renderChunks(plan.height, G.renderChunkHeight(plan.dpr));
  let textRuns = null;
  let pdfLinks = [];
  let pdfMarks = [];
  if (settings.format === 'pdf' || settings.redact) {
    progress(tabId, 'prepare', 9, settings.redact ? 'Reading page text to find secrets\u2026' : 'Reading page text and links for the PDF\u2026');
    try {
      const collected = await getContentMessage(tabId, { type: 'PAC_COLLECT_TEXT', maxWords: 150000, wordEdges: settings.redact });
      const inside = (x, y, w, h) => y + h > 0 && y < plan.height && x + w > 0 && x < plan.width;
      textRuns = (collected.runs || [])
        .map(r => r.length > 6 ? [r[0] - plan.x, r[1] - plan.y, r[2], r[3], r[4], r[5], r[6], r[7]] : [r[0] - plan.x, r[1] - plan.y, r[2], r[3], r[4], r[5]])
        .filter(r => inside(r[0], r[1], r[2], r[3]));
      // Same-page links keep their target offset too; the stitcher drops any
      // whose target falls outside the captured area.
      pdfLinks = (collected.links || [])
        .map(l => l.length >= 7 ? [l[0] - plan.x, l[1] - plan.y, l[2], l[3], '', l[5] - plan.x, l[6] - plan.y] : [l[0] - plan.x, l[1] - plan.y, l[2], l[3], l[4]])
        .filter(l => inside(l[0], l[1], l[2], l[3]));
      pdfMarks = (collected.marks || [])
        .map(m => [m[0] - plan.x, m[1] - plan.y, m[2], m[3]])
        .filter(m => m[1] >= -2 && m[1] < plan.height)
        .map(m => [Math.max(0, m[0]), Math.max(0, m[1]), m[2], m[3]]);
      if (settings.redact && collected.drawn > 0) {
        report.warnings.push(`Share-safe Redact could not check ${collected.drawn} drawn area(s) (canvas, embedded document or frame), such as a PDF or document preview. Text painted there is not redacted: check those areas yourself before sharing.`);
      }
    } catch (error) {
      if (settings.redact) throw new Error(`Could not read the page text for Share-safe Redact (${errorText(error).slice(0, 120)}). Nothing was saved.`);
      report.warnings.push(`The PDF text layer was skipped (${errorText(error).slice(0, 120)}).`);
    }
  }
  if (chunks.length > MAX_CAPTURE_TILES) throw new Error('This render would need too many image chunks. Lower Max height and retry.');

  await sendToStitcher(job.stitcherTabId, {
    type: 'PAC_BEGIN', captureId: job.captureId,
    session: {
      title: plan.title, url: plan.url, mode: 'full', engine: 'render',
      pageW: plan.width, pageH: plan.height, captureW: plan.width, captureH: chunks[0] ? chunks[0].h : plan.height,
      truncated, warnings: [], scrollerType
    }
  });
  job.sessionBegun = true;
  if ((textRuns && textRuns.length) || pdfLinks.length || pdfMarks.length) {
    const runs = textRuns || [];
    for (let i = 0; i === 0 || i < runs.length; i += 20000) {
      await sendToStitcher(job.stitcherTabId, {
        type: 'PAC_STORE_TEXT', captureId: job.captureId, runs: runs.slice(i, i + 20000),
        ...(i === 0 ? { links: pdfLinks, marks: pdfMarks } : {})
      }, 60000);
    }
  }

  const bands = ink && Array.isArray(ink.bands) ? ink.bands.map(b => [b[0] - plan.y, b[1] - plan.y]) : [];
  for (let i = 0; i < chunks.length; i++) {
    checkCancel(job);
    const c = chunks[i];
    progress(tabId, 'capture', 10 + (i / Math.max(1, chunks.length)) * 65, `Rendering section ${i + 1} of ${chunks.length}\u2026`, { current: i + 1, total: chunks.length });
    const inChunk = bands.filter(b => b[1] > c.y && b[0] < c.y + c.h).map(b => [b[0] - c.y, b[1] - c.y]);
    let dataUrl;
    for (let attempt = 0; ; attempt++) {
      dataUrl = await cdp.screenshot({ x: plan.x, y: plan.y + c.y, width: plan.width, height: c.h }, plan.beyondViewport);
      if (!inChunk.length) break;
      let check = null;
      try {
        const rows = await plainRows(dataUrl);
        check = G.unpaintedInk(rows, inChunk, rows.length / c.h);
      } catch (error) {
        console.warn('[Tallshot] paint check unavailable:', errorText(error));
      }
      if (!check || !check.unpainted) break;
      // Never export a chunk with text the browser has not drawn yet. Throwing
      // falls back to scroll-and-stitch with a warning.
      if (attempt >= 3) throw new Error(`Chrome returned section ${i + 1} of ${chunks.length} before painting it (${check.missingPx.toLocaleString()} px of text still blank after 4 tries)`);
      progress(tabId, 'capture', 10 + (i / Math.max(1, chunks.length)) * 65, `Waiting for Chrome to paint section ${i + 1} of ${chunks.length}\u2026`, { current: i + 1, total: chunks.length });
      await sleep(600 * (attempt + 1));
    }
    await storeTiles(job, [{
      dataUrl,
      tile: { index: i, tileX: 0, tileY: c.y, tileW: plan.width, tileH: c.h, cropX: 0, cropY: 0, viewportW: plan.width, viewportH: c.h }
    }]);
  }
  return { tileCount: chunks.length, outputPageHeight: plan.height, title: plan.title, url: plan.url };
}

// ---------------------------------------------------------------------------
// Scroll-and-stitch engine (original v1.x pipeline). Uses debugger screenshots
// when attached (no rate limit), otherwise chrome.tabs.captureVisibleTab.
// ---------------------------------------------------------------------------
async function runStitch(job, report) {
  // Backstop: stitching reads no text, so it can never redact.
  if (job.settings.redact) throw new Error(`${REDACT_NEEDS_TEXT}. Nothing was saved.`);
  const { tabId, settings, tab } = job;
  const useCdp = !!(job.cdp && job.cdp.attached);
  const grab = async () => {
    if (useCdp) return job.cdp.viewportScreenshot();
    // captureVisibleTab captures whichever tab is active, so verify the source
    // immediately before the call (the user may have switched tabs meanwhile).
    await assertOriginalTabStillActive(tabId, tab.windowId);
    return chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  };
  progress(tabId, 'prepare', 2, 'Preparing the page\u2026', { engineLabel: useCdp ? 'Scroll & stitch (fast)' : 'Scroll & stitch' });
  let prepared;
  try {
    checkCancel(job);
    await injectContent(tabId);
    checkCancel(job);
    // Mark the content session as potentially modified before awaiting preparation,
    // so even a mid-preparation failure reaches the restore path.
    job.contentReady = true;
    prepared = await getContentMessage(tabId, { type: 'PAC_PREPARE', settings: { ...settings, engine: 'stitch' } });
    // A cancel signal can arrive just before the content script creates its
    // session. Check again after preparation so a missed early signal is safe.
    checkCancel(job);
  } catch (error) {
    if (job.contentReady) {
      await getContentMessage(tabId, { type: 'PAC_RESTORE' }).catch(() => {});
      job.contentReady = false;
    }
    if (job.cancel || /cancelled/i.test(errorText(error))) throw new Error('Capture cancelled.');
    throw new Error(`Full-page capture could not inspect this tab: ${errorText(error).slice(0, 220).replace(/\.+$/, '')}. No image was exported. Try a regular http(s) webpage and reload the extension if necessary.`);
  }

  if (prepared.warnings) report.warnings.push(...prepared.warnings);
  const metrics = prepared.metrics;
  if (!metrics || !(metrics.pageW > 0) || !(metrics.pageH > 0)) throw new Error('Could not measure the page dimensions.');

  const capH = Math.min(metrics.pageH, settings.maxHeight);
  const capW = metrics.pageW;
  let outputPageHeight = capH;
  const truncated = metrics.pageH > capH;
  if (truncated) report.warnings.push(`The page height was limited to ${capH.toLocaleString()} CSS pixels to protect browser memory.`);
  if (metrics.scrollerType === 'inner') {
    report.warnings.push('A main scrollable panel was selected. This captures the panel content, not the entire surrounding application shell. Choose Document in Target to prioritize the page shell.');
  } else if (metrics.pageH <= metrics.captureH + 1 && settings.captureTarget === 'document') {
    report.warnings.push('The document itself does not scroll, so this mode captures only the current viewport. Choose Smart or Panel to capture long content inside an app.');
  }
  if (metrics.cropClipped) {
    report.warnings.push('The selected inner scroll panel is partly outside the viewport; a clipped edge may be incomplete.');
  }

  if (settings.format === 'pdf') report.warnings.push('Scroll & stitch PDFs are image-only; the searchable text layer needs the Full render engine.');
  if (prepared.preset) report.warnings.push(`Detected ${prepared.preset} layout.`);
  const latestTab = await getTab(tabId);
  await sendToStitcher(job.stitcherTabId, {
    type: 'PAC_BEGIN', captureId: job.captureId,
    session: {
      title: metrics.title || latestTab.title || 'Webpage',
      url: metrics.url || latestTab.url || '',
      mode: 'full', engine: 'stitch',
      pageW: capW,
      pageH: capH,
      captureW: metrics.captureW,
      captureH: metrics.captureH,
      truncated,
      warnings: [],
      scrollerType: metrics.scrollerType || 'root'
    }
  });
  job.sessionBegun = true;

  const xs = makeOffsets(capW, metrics.captureW, capW);
  const ys = makeOffsets(capH, metrics.captureH, capH);
  const tiles = [];
  for (const y of ys) for (const x of xs) tiles.push({ x, y });
  if (tiles.length > MAX_CAPTURE_TILES) {
    throw new Error(`This capture would require ${tiles.length} screenshots, above the safety limit of ${MAX_CAPTURE_TILES}. Reduce the maximum capture height, choose a smaller target, or reduce the page width.`);
  }
  let boundedPanelDriftWarned = false;

  for (let i = 0; i < tiles.length; i++) {
    checkCancel(job);
    if (!useCdp) await assertOriginalTabStillActive(tabId, tab.windowId);
    const req = tiles[i];
    progress(tabId, 'capture', 5 + (i / Math.max(1, tiles.length)) * 70,
      `Capturing section ${i + 1} of ${tiles.length}\u2026`, { current: i + 1, total: tiles.length });
    const tileState = await getContentMessage(tabId, {
      type: 'PAC_SET_TILE', x: req.x, y: req.y, index: i, waitMs: settings.waitMs
    });
    checkCancel(job);
    // If a panel moves relative to the viewport while scrolling, its crop
    // offset can shift tile coordinates. Detect that at the source instead of
    // waiting until the stitcher reports an opaque coverage gap.
    if (metrics.scrollerType === 'inner' && tileState.tile) {
      const actualX = Number(tileState.tile.tileX);
      const actualY = Number(tileState.tile.tileY);
      const driftX = Math.abs(actualX - req.x);
      const driftY = Math.abs(actualY - req.y);
      // Colab and other notebook-style UIs can resize cells by a few pixels
      // after images decode or the active output settles. Accept only movement
      // within half the planned overlap, use the actual measured tile coords,
      // and let stitcher coverage validation reject any real gap before export.
      const toleranceX = G.safeTileDriftTolerance(metrics.captureW, 0.14);
      const toleranceY = G.safeTileDriftTolerance(metrics.captureH, 0.14);
      if (driftX > toleranceX || driftY > toleranceY) {
        throw new Error(`The selected inner panel moved too far near section ${i + 1} (requested ${Math.round(req.x)},${Math.round(req.y)}; actual ${Math.round(actualX)},${Math.round(actualY)}; allowed shift ${toleranceX}px horizontally/${toleranceY}px vertically). No PNG was exported because tile coverage may be unsafe. Choose Document if the page itself scrolls, or retry after the app has stopped reflowing.`);
      }
      if ((driftX > 2 || driftY > 2) && !boundedPanelDriftWarned) {
        report.warnings.push(`The selected panel adjusted its scroll position slightly during capture (first observed shift ${Math.round(driftX)}px horizontally and ${Math.round(driftY)}px vertically). The extension used the measured tile coordinates and will still reject the export if the final image has a coverage gap.`);
        boundedPanelDriftWarned = true;
      }
    }
    // Re-check after scrolling/image settling. Capturing while another tab is
    // active would silently stitch the wrong page into this archive.
    const dataUrl = await grab();
    const stored = await sendToStitcher(job.stitcherTabId, {
      type: 'PAC_STORE_TILE', captureId: job.captureId, dataUrl, tile: tileState.tile
    });
    if (stored && stored.warnings) report.warnings.push(...stored.warnings);
    absorbAudit(report, tileState, `around section ${i + 1}`);
    if (tileState.metrics && (tileState.metrics.pageH > metrics.pageH + 100 || tileState.metrics.pageW > metrics.pageW + 100)) {
      report.warnings.push('The page grew while capture was running. Newly inserted content may not be included; enable bounded auto-load and retry if needed.');
    }
    if (i === tiles.length - 1 && metrics.scrollerType === 'inner' && tileState.metrics && tileState.tile) {
      const liveHeight = Number(tileState.metrics.pageH);
      const actualY = Number(tileState.tile.tileY);
      const actualTileH = Number(tileState.tile.tileH);
      const endTolerance = G.safeTileDriftTolerance(metrics.captureH, 0.14);
      const adjustedHeight = G.adjustedFinalPanelHeight(outputPageHeight, liveHeight, actualY, actualTileH, endTolerance);
      if (adjustedHeight < outputPageHeight) {
        const shaved = outputPageHeight - adjustedHeight;
        outputPageHeight = adjustedHeight;
        report.warnings.push(`The selected panel became ${Math.round(shaved)} CSS pixels shorter while the final tile was captured. The PNG height was adjusted to the panel's final measured scroll extent.`);
      }
    }
    // Chrome limits captureVisibleTab to about two calls per second; debugger
    // screenshots have no such quota.
    if (i < tiles.length - 1 && !useCdp) await sleep(CAPTURE_GAP_MS);
  }
  return { tileCount: tiles.length, outputPageHeight, title: metrics.title || latestTab.title, url: metrics.url || latestTab.url };
}

async function restoreContent(job) {
  if (!job.contentReady) return;
  job.contentReady = false;
  await getContentMessage(job.tabId, { type: 'PAC_RESTORE' }).catch(() => {});
}

async function startCapture(tabId, mode, userSettings) {
  if (activeJob) throw new Error('Another capture is already running. Finish or cancel it first.');
  const tab = await getTab(tabId);
  const restrictedPage = URL_POLICY.isRestrictedUrl(tab.url);
  if (restrictedPage && mode !== 'visible') {
    throw new Error('Full-page capture cannot inspect or scroll Chrome/Edge internal pages or extension store pages. Use Visible area for a viewport screenshot, or open a regular webpage for full-page capture.');
  }
  const settings = normalizeSettings(userSettings, tabId);

  const job = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    captureId: `capture-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    tabId, windowId: tab.windowId, tab, mode, settings,
    cancel: false, phase: 'starting', percent: 0, message: 'Starting capture\u2026',
    startedAt: Date.now(), stitcherTabId: null, contentReady: false, sessionBegun: false, cdp: null, engineLabel: ''
  };
  activeJob = job;
  progress(tabId, 'prepare', 1, 'Starting\u2026');
  let success = false;
  const report = makeReport();

  try {
    job.stitcherTabId = await openStitcher(tab.windowId, job.captureId);

    // Visible-area capture does not need to inject a content script. Keep it a
    // separate, explicit mode; a failed full-page capture must never silently
    // degrade into a viewport screenshot.
    if (mode === 'visible' && settings.redact && restrictedPage) throw new Error('Share-safe Redact cannot read the text of browser pages, so nothing was saved. Turn off Redact to take a plain visible-area screenshot.');
    if (mode === 'visible') {
      const visibleWarnings = restrictedPage ? ['Chrome/Edge internal pages allow only a visible-area screenshot; page scrolling and full-page inspection are restricted.'] : [];
      const result = await takeVisibleCapture(tab, job, job.stitcherTabId, tab.title || 'Webpage', tab.url || '', visibleWarnings);
      success = true;
      progress(tabId, 'done', 100, 'Visible area saved.', { warnings: [...new Set([...visibleWarnings, ...(result.warnings || [])])], downloads: result.downloads || 1, files: result.parts || [], format: settings.format });
      return;
    }

    if (settings.engine === 'auto') {
      if (!CDP.Session.available()) {
        // Lite edition ships without the debugger permission: stitching is the
        // engine there, so this is expected and not worth a warning.
        if (IS_FULL_EDITION) report.warnings.push('The Full render engine is unavailable in this browser; used scroll-and-stitch.');
      } else {
        const session = new CDP.Session(tabId);
        try {
          await session.attach();
          job.cdp = session;
        } catch (error) {
          report.warnings.push(`Full render was unavailable (${errorText(error)}). Used scroll-and-stitch instead.`);
        }
      }
    }

    // A redacted capture must never fall back to an engine that cannot see
    // the text: it would save the secrets unredacted.
    if (settings.redact && !job.cdp) throw new Error(settings.engine === 'stitch'
      ? `${REDACT_NEEDS_TEXT}, and Engine is set to Scroll & stitch. Nothing was saved. Set Engine to Full render under More options, or turn off Redact.`
      : `${REDACT_NEEDS_TEXT}, and it was unavailable. Nothing was saved. Close DevTools on this tab and retry, or turn off Redact.`);
    let captured = null;
    if (job.cdp) {
      try {
        captured = await runRender(job, report);
      } catch (error) {
        if (job.cancel || /cancelled/i.test(errorText(error))) throw new Error('Capture cancelled.');
        // A refusal that already says "Nothing was saved" (Chrome PDF viewer)
        // would fail the same way in stitch mode: report it as it is.
        if (/Nothing was saved/.test(errorText(error))) throw error;
        if (settings.redact) throw new Error(`Full render could not complete (${errorText(error).slice(0, 200)}). ${REDACT_NEEDS_TEXT}, so nothing was saved instead of falling back to scroll-and-stitch.`);
        // Fall back to the stitch engine (still a full-page capture, never a
        // viewport screenshot). Reset everything the render pass touched.
        console.warn('[Tallshot] render engine failed, falling back:', errorText(error));
        report.warnings.push(`Full render could not complete (${errorText(error).slice(0, 200)}). Retried with scroll-and-stitch.`);
        await job.cdp.clearViewport().catch(() => {});
        await restoreContent(job);
        if (job.sessionBegun) {
          await sendToStitcher(job.stitcherTabId, { type: 'PAC_CLEANUP', captureId: job.captureId }).catch(() => {});
          job.sessionBegun = false;
        }
        await sleep(250);
        captured = null;
      }
    }
    if (!captured) captured = await runStitch(job, report);

    checkCancel(job);
    if (report.failedCssImageLabels.size) {
      const examples = [...report.failedCssImageLabels].slice(0, 4).join(', ');
      report.warnings.push(`${report.failedCssImageLabels.size} CSS, SVG, poster, or embedded image asset(s) failed the image-load check. Examples: ${examples}${report.failedCssImageLabels.size > 4 ? ', \u2026' : ''}. The extension cannot reconstruct unavailable source pixels.`);
    }
    if (job.cdp) await job.cdp.detach();
    await restoreContent(job);
    const latestTab = await getTab(tabId).catch(() => tab);
    // With Redact on, the stitcher tab shows the capture and its boxes and
    // waits for the user; bring it forward and give them time.
    const review = settings.redact && settings.redactReview;
    if (review) {
      progress(tabId, 'stitch', 82, 'Check the redactions in the Tallshot tab, then press Save there.');
      await chrome.tabs.update(job.stitcherTabId, { active: true }).catch(() => {});
    } else {
      progress(tabId, 'stitch', 80, 'Stitching sections and checking coverage\u2026');
    }
    let result;
    try {
      result = await sendToStitcher(job.stitcherTabId, {
        type: 'PAC_COMPOSE', captureId: job.captureId, expectedTileCount: captured.tileCount,
        pageHeightOverride: captured.outputPageHeight, format: settings.format,
        folder: settings.folder, capturedAt: job.startedAt,
        redact: settings.redact, redactWords: settings.redactWords, review,
        baseName: cleanBaseName(redactTitle(captured.title || latestTab.title, settings), captured.url || latestTab.url, settings.nameTemplate)
      }, review ? 60 * 60 * 1000 : 300000);
    } finally {
      if (review) await chrome.tabs.update(tabId, { active: true }).catch(() => {});
    }
    success = true;
    const warnings = [...new Set([...report.warnings, ...(result.warnings || [])])];
    const label = settings.format === 'pdf' ? 'PDF' : settings.format.toUpperCase();
    const downloadMessage = settings.format === 'pdf'
      ? `PDF saved (${result.pages || result.downloads || 1} page${(result.pages || 1) === 1 ? '' : 's'}).`
      : result.downloads > 1 ? `Saved ${result.downloads} ${label} parts.` : `${label} saved.`;
    const auditMessage = auditMessageFrom(report.latestImageAudit, report.failedCssImageLabels);
    progress(tabId, 'done', 100,
      [downloadMessage, auditMessage].filter(Boolean).join(' '),
      { warnings, downloads: result.downloads || 1, dimensions: result.dimensions || null, imageAudit: report.latestImageAudit, files: result.parts || [], format: settings.format, engineLabel: job.engineLabel });
  } catch (error) {
    const message = errorText(error);
    const cancelled = job.cancel || /cancelled/i.test(message);
    progress(tabId, cancelled ? 'cancelled' : 'error', 100, cancelled ? 'Capture cancelled.' : message, { warnings: report.warnings });
    if (job.sessionBegun && job.stitcherTabId) {
      await sendToStitcher(job.stitcherTabId, { type: 'PAC_CLEANUP', captureId: job.captureId }).catch(() => {});
    }
  } finally {
    if (job.cdp) await job.cdp.detach().catch(() => {});
    await restoreContent(job);
    if (job.stitcherTabId) {
      if (!success) await sendToStitcher(job.stitcherTabId, { type: 'PAC_CLEANUP', captureId: job.captureId }).catch(() => {});
      // Leave the source tab active. The stitcher tab is inactive and only exists to assemble local tiles and launch downloads.
      await chrome.tabs.remove(job.stitcherTabId).catch(() => {});
    }
    if (activeJob && activeJob.id === job.id) activeJob = null;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return;
  if (message.type === 'PAC_START') {
    if (activeJob) {
      sendResponse({ ok: false, error: 'A capture is already running.' });
      return;
    }
    sendResponse({ ok: true, accepted: true });
    startCapture(message.tabId, message.mode || 'full', message.settings || {}).catch(error => {
      progress(message.tabId, 'error', 100, errorText(error));
    });
    return;
  }
  if (message.type === 'PAC_CANCEL') {
    if (activeJob && (!message.tabId || activeJob.tabId === message.tabId)) {
      activeJob.cancel = true;
      if (activeJob.stitcherTabId) {
        sendToStitcher(activeJob.stitcherTabId, { type: 'PAC_CANCEL_STITCH', captureId: activeJob.captureId }).catch(() => {});
      }
      // If preparation or a tile wait is in progress, let the content script
      // stop at its next cancellation checkpoint instead of waiting out its budget.
      chrome.tabs.sendMessage(activeJob.tabId, { type: 'PAC_CANCEL_PREPARE', captureId: activeJob.captureId }).catch(() => {});
      sendResponse({ ok: true });
    } else sendResponse({ ok: false, error: 'No active capture for this tab.' });
    return;
  }
  // The redaction review can take minutes; its tab pings so the worker is
  // not stopped as idle while it waits for the answer.
  if (message.type === 'PAC_REVIEW_ALIVE') {
    sendResponse({ ok: true });
    return;
  }
  if (message.type === 'PAC_GET_STATUS') {
    if (activeJob && activeJob.tabId === message.tabId) {
      sendResponse({ ok: true, active: true, phase: activeJob.phase, percent: activeJob.percent, message: activeJob.message, engineLabel: activeJob.engineLabel });
    } else sendResponse({ ok: true, active: false });
    return;
  }
  if (message.type === 'PAC_CONTENT_PROGRESS') {
    if (activeJob && activeJob.tabId === message.tabId) {
      progress(activeJob.tabId, 'prepare', Math.min(4, message.percent || 1), message.message || 'Preparing images\u2026');
    }
  }
});

chrome.commands.onCommand.addListener(async command => {
  if (command !== 'capture-full-page' || activeJob) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || typeof tab.id !== 'number') return;
  const stored = await chrome.storage.local.get('pageArchiveSettings').catch(() => ({}));
  const settings = { ...DEFAULTS, ...(stored.pageArchiveSettings || {}) };
  startCapture(tab.id, 'full', settings).catch(error => {
    progress(tab.id, 'error', 100, errorText(error));
  });
});

// Test hook: lets the automated real-browser harness start captures without a
// popup click. Only reachable from extension contexts (never from web pages).
self.__pageArchiveTest = { startCapture, getActiveJob: () => activeJob };
