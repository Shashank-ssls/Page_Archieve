'use strict';

importScripts('geometry.js', 'url-policy.js', 'cdp.js');

const G = self.PageArchiveGeometry;
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
  captureTarget: 'auto'
};
const ENGINES = ['auto', 'stitch'];
const FORMATS = ['png', 'jpeg', 'pdf'];
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
  await assertOriginalTabStillActive(tab.id, tab.windowId);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  await sendToStitcher(stitcherTabId, {
    type: 'PAC_BEGIN', captureId: job.captureId,
    session: { title, url, mode: 'visible', pageW: 1, pageH: 1, captureW: 1, captureH: 1, truncated: false, warnings, fallbackVisible: true }
  });
  await sendToStitcher(stitcherTabId, {
    type: 'PAC_STORE_TILE', captureId: job.captureId, dataUrl,
    tile: { index: 0, tileX: 0, tileY: 0, tileW: 1, tileH: 1, cropX: 0, cropY: 0, viewportW: 0, fallbackVisible: true }
  });
  progress(tab.id, 'stitch', 82, 'Encoding the visible area\u2026');
  return sendToStitcher(stitcherTabId, {
    type: 'PAC_COMPOSE', captureId: job.captureId, expectedTileCount: 1,
    baseName: cleanBaseName(title, url, job.settings.nameTemplate), folder: job.settings.folder, format: job.settings.format
  });
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

function floatingWarning(report, hidden) {
  if (hidden) report.warnings.push(`Hid ${hidden} floating bar(s) pinned to the bottom of the window (composers, cookie banners, chat widgets) so they do not cover content. Turn off \u201cHide floating bars\u201d to keep them.`);
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
  for (let round = 0; round < 6; round++) {
    checkCancel(job);
    const target = Math.min(cap, Math.ceil(measure.docH));
    if (target > viewportH + 1 || !grew) {
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
    measure = settled.measure;
    if (Math.min(cap, Math.ceil(measure.docH)) <= viewportH + 1) break;
    settled = null;
  }
  if (!settled) {
    settled = await getContentMessage(tabId, { ...settleMsg, imageWaitMs: Math.max(3000, settings.waitMs) });
    measure = settled.measure;
  }
  absorbAudit(report, settled, 'in the rendered page');
  floatingWarning(report, settled.hidden);
  const lm2 = await cdp.layoutMetrics();
  const content = lm2.cssContentSize || lm2.contentSize;
  const width = G.renderDocumentWidth(content.width, measure.docW, baseW);
  const fullH = Math.ceil(Math.max(measure.docH, content.height));
  const height = Math.min(viewportH, fullH, settings.maxHeight);
  return { width, height, fullH, x: 0, y: 0, beyondViewport: width > baseW + 1, dpr: measure.dpr, title: measure.title, url: measure.url };
}

// Fallback document path: captureBeyondViewport at the original viewport size.
async function renderDocumentBeyondViewport(job, report, settleMsg) {
  const { tabId, settings, cdp } = job;
  progress(tabId, 'prepare', 8, 'Settling images and fonts\u2026');
  const settled = await getContentMessage(tabId, settleMsg);
  absorbAudit(report, settled, 'during preparation');
  floatingWarning(report, settled.hidden);
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
async function runRender(job, report) {
  const { tabId, settings, cdp } = job;
  progress(tabId, 'prepare', 3, 'Preparing the page for a full render\u2026', { engineLabel: 'Full render' });
  await injectContent(tabId);
  checkCancel(job);
  job.contentReady = true;
  const prepared = await getContentMessage(tabId, { type: 'PAC_PREPARE', settings: { ...settings, engine: 'render' } });
  checkCancel(job);
  if (prepared.warnings) report.warnings.push(...prepared.warnings);
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
    for (let round = 0; round < 10; round++) {
      checkCancel(job);
      const need = G.panelGrowthNeeded(measure);
      if (need === 0) {
        // Exposed. One full settle lets lazy images load and floating UI hide;
        // if that grows the panel again, keep looping.
        settled = await getContentMessage(tabId, settleMsg);
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
      measure = settled.measure;
    }
    absorbAudit(report, settled, 'in the expanded panel');
    const p = measure.panel;
    if (!p) throw new Error('The selected panel disappeared while it was being expanded.');
    if (!truncated && !G.panelFullyExposed(measure)) {
      throw new Error(`The panel could not be fully exposed (overflow ${Math.round(p.overflow)}px, clipped ${Math.round(p.ancestorClip || 0)}px).`);
    }
    if (settled.hidden) report.warnings.push(`Hid ${settled.hidden} floating element(s) over the captured panel (message boxes, toolbars, floating buttons).`);
    report.warnings.push('Captured the main scrollable panel, not the surrounding app shell. Choose Entire document in Target to capture the page shell instead.');
    const height = Math.min(Math.floor(p.height), settings.maxHeight);
    plan = {
      width: Math.floor(p.width), height, fullH: Math.max(p.height, p.scrollHeight),
      x: Math.max(0, p.left), y: Math.max(0, p.top), beyondViewport: false,
      dpr: measure.dpr, title: measure.title, url: measure.url
    };
  }

  if (!(plan.width > 0) || !(plan.height > 0)) throw new Error('Could not measure the area to render.');
  const truncated = plan.fullH > plan.height + 1;
  if (truncated) report.warnings.push(`The capture was limited to ${plan.height.toLocaleString()} CSS pixels (Max height setting) to protect browser memory.`);
  const chunks = G.renderChunks(plan.height, G.renderChunkHeight(plan.dpr));
  let textRuns = null;
  if (settings.format === 'pdf') {
    progress(tabId, 'prepare', 9, 'Reading page text for the PDF text layer\u2026');
    try {
      const collected = await getContentMessage(tabId, { type: 'PAC_COLLECT_TEXT', maxWords: 150000 });
      textRuns = (collected.runs || [])
        .map(r => [r[0] - plan.x, r[1] - plan.y, r[2], r[3], r[4], r[5]])
        .filter(r => r[1] + r[3] > 0 && r[1] < plan.height && r[0] + r[2] > 0 && r[0] < plan.width);
    } catch (error) {
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
  if (textRuns && textRuns.length) {
    for (let i = 0; i < textRuns.length; i += 20000) {
      await sendToStitcher(job.stitcherTabId, { type: 'PAC_STORE_TEXT', captureId: job.captureId, runs: textRuns.slice(i, i + 20000) }, 60000);
    }
  }

  for (let i = 0; i < chunks.length; i++) {
    checkCancel(job);
    const c = chunks[i];
    progress(tabId, 'capture', 10 + (i / Math.max(1, chunks.length)) * 65, `Rendering section ${i + 1} of ${chunks.length}\u2026`, { current: i + 1, total: chunks.length });
    const dataUrl = await cdp.screenshot({ x: plan.x, y: plan.y + c.y, width: plan.width, height: c.h }, plan.beyondViewport);
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
    report.warnings.push('A main scrollable panel was selected. This captures the panel content, not the entire surrounding application shell. Choose Entire document in Capture target to prioritize the page shell.');
  } else if (metrics.pageH <= metrics.captureH + 1 && settings.captureTarget === 'document') {
    report.warnings.push('The document itself does not scroll, so this mode captures only the current viewport. Choose Smart or Main scrollable panel to capture long content inside an app.');
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
        throw new Error(`The selected inner panel moved too far near section ${i + 1} (requested ${Math.round(req.x)},${Math.round(req.y)}; actual ${Math.round(actualX)},${Math.round(actualY)}; allowed shift ${toleranceX}px horizontally/${toleranceY}px vertically). No PNG was exported because tile coverage may be unsafe. Choose Entire document if the page itself scrolls, or retry after the app has stopped reflowing.`);
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
    stitcherTabId: null, contentReady: false, sessionBegun: false, cdp: null, engineLabel: ''
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
    if (mode === 'visible') {
      const visibleWarnings = restrictedPage ? ['Chrome/Edge internal pages allow only a visible-area screenshot; page scrolling and full-page inspection are restricted.'] : [];
      const result = await takeVisibleCapture(tab, job, job.stitcherTabId, tab.title || 'Webpage', tab.url || '', visibleWarnings);
      success = true;
      progress(tabId, 'done', 100, 'Visible area saved.', { warnings: visibleWarnings, downloads: result.downloads || 1, files: result.parts || [], format: settings.format });
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

    let captured = null;
    if (job.cdp) {
      try {
        captured = await runRender(job, report);
      } catch (error) {
        if (job.cancel || /cancelled/i.test(errorText(error))) throw new Error('Capture cancelled.');
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
    progress(tabId, 'stitch', 80, 'Stitching sections and checking coverage\u2026');
    const latestTab = await getTab(tabId).catch(() => tab);
    const result = await sendToStitcher(job.stitcherTabId, {
      type: 'PAC_COMPOSE', captureId: job.captureId, expectedTileCount: captured.tileCount,
      pageHeightOverride: captured.outputPageHeight, format: settings.format,
      folder: settings.folder,
      baseName: cleanBaseName(captured.title || latestTab.title, captured.url || latestTab.url, settings.nameTemplate)
    }, 300000);
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
