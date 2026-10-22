'use strict';

const $ = id => document.getElementById(id);
const fullButton = $('capture-full');
const visibleButton = $('capture-visible');
const cancelButton = $('cancel');
const folderButton = $('open-folder');
const CELLS = 25;
let currentTabId = null;
let running = false;

const defaults = { engine: 'auto', format: 'png', prepareImages: true, autoLoadMore: false, hideFloating: true, expandContent: true, nameTemplate: '{title}', folder: '', maxHeight: 200000, waitMs: 3500, captureTarget: 'auto' };
let restrictedActiveTab = false;

function isRestrictedBrowserUrl(url) {
  return /^(chrome|edge|devtools|chrome-extension|view-source|about):/i.test(String(url || ''));
}

function updateTargetHint(url) {
  const knownRestricted = isRestrictedBrowserUrl(url);
  const urlHidden = typeof url !== 'string' || url.length === 0;
  // Newer Chrome builds may hide the URL of a restricted browser/extension tab
  // from Tab metadata when only activeTab is requested. Fail closed for Full page
  // instead of offering an operation that is guaranteed to fail after injection.
  restrictedActiveTab = knownRestricted || urlHidden;
  const hint = $('context-hint');
  if (knownRestricted) {
    hint.textContent = 'Browser pages can\u2019t be scrolled by extensions, so full-page capture is off here. Visible area PNG captures the current viewport only.';
    hint.hidden = false;
  } else if (urlHidden) {
    hint.textContent = 'Chrome did not expose this tab\u2019s URL, so full-page capture is off for safety. Use Visible area here, or open a regular website.';
    hint.hidden = false;
  } else {
    hint.hidden = true;
    hint.textContent = '';
  }
  fullButton.disabled = running || restrictedActiveTab;
}

const radioValue = name => (document.querySelector(`input[name="${name}"]:checked`) || {}).value;
const setRadio = (name, value) => {
  const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (el) el.checked = true;
};

function readSettings() {
  return {
    engine: $('engine').value,
    format: radioValue('format') || 'png',
    prepareImages: $('prepare-images').checked,
    autoLoadMore: $('auto-load').checked,
    hideFloating: $('hide-floating').checked,
    expandContent: $('expand-content').checked,
    nameTemplate: $('name-template').value.trim() || '{title}',
    folder: $('folder').value.trim(),
    maxHeight: Number($('max-height').value),
    waitMs: Number($('wait-ms').value),
    captureTarget: radioValue('target') || 'auto'
  };
}

const IS_FULL_EDITION = !!(chrome.debugger && chrome.debugger.attach);

function previewName() {
  const s = readSettings();
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const fill = t => t.replace(/\{title\}/gi, 'Page title').replace(/\{site\}/gi, 'example.com').replace(/\{date\}/gi, date).replace(/\{time\}/gi, time).replace(/\{datetime\}/gi, `${date}_${time}`);
  const ext = s.format === 'jpeg' ? 'jpg' : s.format;
  const folder = fill(s.folder).split(/[\\/]+/).map(x => x.trim()).filter(x => x && x !== '..' && x !== '.').join('/');
  const el = $('name-preview');
  el.replaceChildren('Downloads/', ...(folder ? [folder + '/'] : []));
  const b = document.createElement('b');
  b.textContent = `${fill(s.nameTemplate)}.${ext}`;
  el.append(b);
}

function updateMeta() {
  const s = readSettings();
  previewName();
  const engine = !IS_FULL_EDITION || s.engine === 'stitch' ? 'Scroll & stitch' : 'Full render';
  const fmt = s.format === 'jpeg' ? 'JPEG' : s.format.toUpperCase();
  const target = { auto: 'Smart', document: 'Document', panel: 'Panel' }[s.captureTarget];
  $('cta-meta').textContent = `${engine} \u00b7 ${fmt} \u00b7 ${target}`;
  $('engine-note').textContent = s.engine === 'stitch'
    ? 'Scrolls and screenshots one screen at a time. Slower, and fixed bars can repeat, but Chrome shows no debugging bar.'
    : 'Draws the whole page in one pass. Chrome shows a \u201cdebugging this browser\u201d bar while it runs; falls back to stitching if needed.';
}

async function saveSettings() {
  updateMeta();
  await chrome.storage.local.set({ pageArchiveSettings: readSettings() });
}

function setRunning(value) {
  running = value;
  fullButton.disabled = value || restrictedActiveTab;
  visibleButton.disabled = value;
  cancelButton.hidden = !value;
  cancelButton.disabled = false;
  if (value) folderButton.hidden = true;
}

function renderWarnings(warnings) {
  const box = $('warnings');
  box.replaceChildren();
  const unique = [...new Set((warnings || []).filter(Boolean))].slice(0, 8);
  if (!unique.length) { box.hidden = true; return; }
  box.hidden = false;
  const icon = $('bang-icon');
  unique.forEach(item => {
    const row = document.createElement('div');
    row.append(icon.content.cloneNode(true));
    const text = document.createElement('span');
    text.textContent = item;
    row.append(text);
    box.appendChild(row);
  });
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function renderFiles(files) {
  const list = $('files');
  list.replaceChildren();
  const items = (files || []).filter(f => f && f.filename).slice(0, 6);
  list.hidden = !items.length;
  for (const f of items) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'fname';
    name.textContent = f.filename;
    name.title = f.width && f.height ? `${f.width} \u00d7 ${f.height} px` : f.filename;
    const size = document.createElement('span');
    size.className = 'fsize';
    size.textContent = formatBytes(f.bytes);
    li.append(name, size);
    list.append(li);
  }
}

function renderCells(pct, phase) {
  const host = $('cells');
  if (host.childElementCount !== CELLS) {
    host.replaceChildren(...Array.from({ length: CELLS }, () => document.createElement('b')));
  }
  const on = phase === 'ready' ? 0 : Math.round((pct / 100) * CELLS);
  [...host.children].forEach((cell, i) => {
    cell.className = i < on ? 'on' : '';
    if (i === on && running && phase !== 'done') cell.className = 'head';
  });
}

function renderProgress(message) {
  const pct = Math.max(0, Math.min(100, Math.round(message.percent || 0)));
  const phase = message.phase || 'ready';
  $('progress').value = pct;
  $('percent').textContent = String(pct).padStart(3, '0');
  $('status-message').textContent = message.message || '';
  const headings = {
    ready: 'Ready', prepare: 'Preparing', capture: 'Capturing', stitch: 'Assembling',
    done: 'Saved', error: 'Could not capture', cancelled: 'Cancelled'
  };
  $('status-title').textContent = headings[phase] || 'Page Archive';
  $('progress-panel').dataset.phase = phase;
  if (message.engineLabel) $('engine-label').textContent = message.engineLabel;
  if (['done', 'error', 'cancelled'].includes(phase)) setRunning(false);
  renderCells(pct, phase);
  if (message.warnings) renderWarnings(message.warnings);
  renderFiles(phase === 'done' ? message.files : []);
  folderButton.hidden = phase !== 'done';
}

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function begin(mode) {
  if (running) return;
  const tab = await activeTab();
  if (!tab || typeof tab.id !== 'number') {
    renderProgress({ phase: 'error', percent: 100, message: 'No active browser tab was found.' });
    return;
  }
  currentTabId = tab.id;
  updateTargetHint(tab.url);
  if (mode === 'full' && restrictedActiveTab) {
    const message = typeof tab.url === 'string' && tab.url.length
      ? 'Full-page capture is restricted on Chrome/Edge internal pages. Use Visible area or open a regular website.'
      : 'Chrome did not expose this tab URL, so Full page was disabled for safety. Use Visible area or open a regular website.';
    renderProgress({ phase: 'error', percent: 100, message });
    return;
  }
  await saveSettings();
  renderWarnings([]);
  renderFiles([]);
  $('engine-label').textContent = '';
  setRunning(true);
  renderProgress({ phase: 'prepare', percent: 0, message: 'Starting local capture\u2026' });
  setRunning(true);
  const reply = await chrome.runtime.sendMessage({ type: 'PAC_START', tabId: tab.id, mode, settings: readSettings() }).catch(error => ({ ok: false, error: error.message || String(error) }));
  if (!reply || !reply.ok) {
    renderProgress({ phase: 'error', percent: 100, message: reply && reply.error ? reply.error : 'The capture could not start.' });
  }
}

fullButton.addEventListener('click', () => { void begin('full'); });
visibleButton.addEventListener('click', () => { void begin('visible'); });
cancelButton.addEventListener('click', async () => {
  if (!currentTabId) return;
  cancelButton.disabled = true;
  $('status-message').textContent = 'Cancelling and restoring the page\u2026';
  await chrome.runtime.sendMessage({ type: 'PAC_CANCEL', tabId: currentTabId }).catch(() => {});
});
folderButton.addEventListener('click', () => {
  try { chrome.downloads.showDefaultFolder(); } catch (_) {}
});
document.querySelectorAll('input[name="format"], input[name="target"]').forEach(el => {
  el.addEventListener('change', () => { void saveSettings(); });
});
['name-template', 'folder'].forEach(id => $(id).addEventListener('input', () => { updateMeta(); }));
['prepare-images', 'auto-load', 'hide-floating', 'expand-content', 'name-template', 'folder', 'engine', 'max-height', 'wait-ms'].forEach(id => {
  $(id).addEventListener('change', () => { void saveSettings(); });
});
$('more').addEventListener('toggle', () => {
  chrome.storage.local.set({ pageArchiveMoreOpen: $('more').open }).catch(() => {});
});

// Theme: follow the system unless the user picked one explicitly.
function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
$('theme').addEventListener('click', async () => {
  const systemDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const current = document.documentElement.dataset.theme || (systemDark ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  await chrome.storage.local.set({ pageArchiveTheme: next }).catch(() => {});
});

chrome.runtime.onMessage.addListener(message => {
  if (!message || message.type !== 'PAC_PROGRESS') return;
  if (currentTabId !== null && message.tabId !== currentTabId) return;
  renderProgress(message);
});

(async () => {
  const stored = await chrome.storage.local.get(['pageArchiveSettings', 'pageArchiveSettingsVersion', 'pageArchiveLastProgress', 'pageArchiveTheme', 'pageArchiveMoreOpen']).catch(() => ({}));
  const { pageArchiveSettings, pageArchiveSettingsVersion, pageArchiveLastProgress } = stored;
  applyTheme(stored.pageArchiveTheme);
  const settings = { ...defaults, ...(pageArchiveSettings || {}) };
  // Migrate legacy default limits once. Existing non-default selections are kept;
  // common old defaults move to a taller capture and a more patient image wait.
  // v5 introduces the render engine and output formats with their defaults.
  if (!pageArchiveSettingsVersion || pageArchiveSettingsVersion < 5) {
    if (!pageArchiveSettings || [30000, 100000].includes(Number(settings.maxHeight))) settings.maxHeight = 200000;
    if (!pageArchiveSettings || [1000, 1500, 2500].includes(Number(settings.waitMs))) settings.waitMs = 3500;
    if (!['auto', 'document', 'panel'].includes(settings.captureTarget)) settings.captureTarget = 'auto';
    settings.engine = 'auto';
    if (!['png', 'jpeg', 'pdf'].includes(settings.format)) settings.format = 'png';
    await chrome.storage.local.set({ pageArchiveSettings: settings, pageArchiveSettingsVersion: 5 }).catch(() => {});
  }
  $('engine').value = ['auto', 'stitch'].includes(settings.engine) ? settings.engine : 'auto';
  setRadio('format', ['png', 'jpeg', 'pdf'].includes(settings.format) ? settings.format : 'png');
  setRadio('target', ['auto', 'document', 'panel'].includes(settings.captureTarget) ? settings.captureTarget : 'auto');
  $('prepare-images').checked = settings.prepareImages !== false;
  $('auto-load').checked = settings.autoLoadMore === true;
  $('hide-floating').checked = settings.hideFloating !== false;
  $('expand-content').checked = settings.expandContent !== false;
  $('name-template').value = settings.nameTemplate || '{title}';
  $('folder').value = settings.folder || '';
  if (!IS_FULL_EDITION) {
    $('engine-row').hidden = true;
    const ver = document.querySelector('.ver');
    ver.textContent = 'LITE';
    ver.classList.add('lite');
    ver.title = 'Lite edition: no debugger permission, scroll-and-stitch engine';
  }
  $('max-height').value = ['15000','30000','50000','100000','200000','300000'].includes(String(settings.maxHeight)) ? String(settings.maxHeight) : '200000';
  $('wait-ms').value = ['500','1000','1500','2500','3500','5000'].includes(String(settings.waitMs)) ? String(settings.waitMs) : '3500';
  $('more').open = stored.pageArchiveMoreOpen === true;
  updateMeta();
  renderCells(0, 'ready');
  const tab = await activeTab().catch(() => null);
  currentTabId = tab && tab.id;
  updateTargetHint(tab && tab.url);
  if (typeof currentTabId === 'number') {
    const status = await chrome.runtime.sendMessage({ type: 'PAC_GET_STATUS', tabId: currentTabId }).catch(() => null);
    if (status && status.active) {
      setRunning(true);
      renderProgress(status);
    } else if (pageArchiveLastProgress && pageArchiveLastProgress.tabId === currentTabId &&
               Number.isFinite(pageArchiveLastProgress.updatedAt) && Date.now() - pageArchiveLastProgress.updatedAt < 24 * 60 * 60 * 1000) {
      // Show the last attempt for this tab after the popup is reopened. In
      // particular, retain errors instead of reverting silently to Ready/0%.
      renderProgress(pageArchiveLastProgress);
    }
  }
})();
