'use strict';

(() => {
  const params = new URLSearchParams(location.search);
  const pageCaptureId = params.get('captureId') || '';
  const statusEl = document.getElementById('status');
  const progressEl = document.getElementById('progress');
  const DB_NAME = 'PageArchiveCaptureStore';
  const DB_VERSION = 1;
  const MAX_DIMENSION_PX = 14000;
  const MAX_PART_PIXELS = 24000000;
  const JPEG_QUALITY = 0.92;
  const FORMATS = ['png', 'jpeg', 'pdf'];
  const PDF = window.PageArchivePdf;
  const G = window.PageArchiveGeometry;
  const P = window.PageArchiveProtocol;
  const downloadWaiters = new Map();
  const cancelledCaptures = new Set();
  const textRuns = new Map(); // captureId -> [[x, y, w, h, fs, text], ...] in capture CSS px

  function status(message, percent) {
    statusEl.textContent = message;
    if (Number.isFinite(percent)) progressEl.value = Math.max(0, Math.min(100, percent));
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'captureId' });
        if (!db.objectStoreNames.contains('tiles')) {
          const store = db.createObjectStore('tiles', { keyPath: 'key' });
          store.createIndex('captureId', 'captureId', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB initialization failed.'));
    });
  }

  let dbPromise;
  function db() { return dbPromise || (dbPromise = openDb()); }

  function txRequest(storeName, mode, method, value) {
    return db().then(database => new Promise((resolve, reject) => {
      const tx = database.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const req = value === undefined ? store[method]() : store[method](value);
      let result;
      let requestSucceeded = false;
      let settled = false;
      const fail = error => {
        if (settled) return;
        settled = true;
        reject(error || new Error(`${method} failed.`));
      };
      req.onsuccess = () => {
        result = req.result;
        requestSucceeded = true;
      };
      req.onerror = () => fail(req.error);
      tx.oncomplete = () => {
        if (settled) return;
        if (!requestSucceeded) return fail(new Error(`${method} did not complete successfully.`));
        settled = true;
        resolve(result);
      };
      tx.onerror = () => fail(tx.error);
      tx.onabort = () => fail(tx.error || new Error('IndexedDB transaction was aborted.'));
    }));
  }

  async function getSession(captureId) { return txRequest('sessions', 'readonly', 'get', captureId); }
  async function putSession(session) { return txRequest('sessions', 'readwrite', 'put', session); }
  async function putTile(tile) { return txRequest('tiles', 'readwrite', 'put', tile); }
  async function getAllTiles(captureId) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction('tiles', 'readonly');
      const request = tx.objectStore('tiles').index('captureId').getAll(captureId);
      request.onsuccess = () => resolve((request.result || []).sort((a, b) => a.index - b.index));
      request.onerror = () => reject(request.error || new Error('Could not retrieve capture tiles.'));
    });
  }

  async function cleanup(captureId) {
    const database = await db();
    await new Promise((resolve, reject) => {
      const tx = database.transaction(['sessions', 'tiles'], 'readwrite');
      tx.objectStore('sessions').delete(captureId);
      const index = tx.objectStore('tiles').index('captureId');
      const request = index.openCursor(IDBKeyRange.only(captureId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Could not clean temporary capture data.'));
    });
  }

  // Stale tile blobs can remain if Chrome closes mid-capture. Remove old records
  // during the next assembly-page startup, but never delete recent active captures.
  async function cleanupAbandonedData() {
    const database = await db();
    const cutoff = Date.now() - 12 * 60 * 60 * 1000;
    await new Promise((resolve, reject) => {
      const tx = database.transaction(['sessions', 'tiles'], 'readwrite');
      const sessionCursor = tx.objectStore('sessions').openCursor();
      const tileCursor = tx.objectStore('tiles').openCursor();
      const prune = (cursorRequest, isStale) => {
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          try { if (isStale(cursor.value)) cursor.delete(); } catch (_) {}
          cursor.continue();
        };
        cursorRequest.onerror = () => reject(cursorRequest.error || new Error('Could not check temporary capture records.'));
      };
      prune(sessionCursor, record => !Number.isFinite(record.createdAt) || record.createdAt < cutoff);
      prune(tileCursor, record => !Number.isFinite(record.createdAt) || record.createdAt < cutoff);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Could not clean abandoned capture records.'));
      tx.onabort = () => reject(tx.error || new Error('Temporary capture cleanup was aborted.'));
    });
  }

  function blobFromDataUrl(dataUrl) {
    return fetch(dataUrl).then(response => {
      if (!response.ok) throw new Error('Could not decode a captured tile.');
      return response.blob();
    });
  }

  async function storeTile(message) {
    if (!pageCaptureId || message.captureId !== pageCaptureId) throw new Error('Capture ID does not match this local assembly page.');
    if (typeof message.dataUrl !== 'string' || !message.dataUrl.startsWith('data:image/png')) {
      throw new Error('The screenshot tile is not a valid PNG data URL.');
    }
    const input = message.tile;
    if (!input || !Number.isInteger(input.index) || input.index < 0) throw new Error('Screenshot tile has an invalid index.');

    const blob = await blobFromDataUrl(message.dataUrl);
    const bitmap = await createImageBitmap(blob);
    try {
      const session = await getSession(message.captureId);
      if (!session) throw new Error('Capture session metadata is missing.');
      let tile = { ...input };
      let scale = tile.viewportW > 0 ? bitmap.width / tile.viewportW : 1;

      if (tile.fallbackVisible) {
        session.pageW = bitmap.width;
        session.pageH = bitmap.height;
        session.captureW = bitmap.width;
        session.captureH = bitmap.height;
        session.fallbackVisible = true;
        tile = {
          index: 0, tileX: 0, tileY: 0, tileW: bitmap.width, tileH: bitmap.height,
          cropX: 0, cropY: 0, viewportW: bitmap.width, viewportH: bitmap.height, fallbackVisible: true
        };
        scale = 1;
      }

      const geometry = [tile.tileX, tile.tileY, tile.tileW, tile.tileH, tile.cropX || 0, tile.cropY || 0];
      if (!geometry.every(value => Number.isFinite(Number(value))) || !(Number(tile.tileW) > 0) || !(Number(tile.tileH) > 0)) {
        throw new Error(`Screenshot tile ${tile.index + 1} has invalid geometry.`);
      }
      if (!Number.isFinite(scale) || scale <= 0 || bitmap.width < 1 || bitmap.height < 1) {
        throw new Error(`Screenshot tile ${tile.index + 1} has invalid image dimensions or scale.`);
      }
      const cropX = Number(tile.cropX) || 0;
      const cropY = Number(tile.cropY) || 0;
      const tileW = Number(tile.tileW);
      const tileH = Number(tile.tileH);
      // Refuse crop coordinates outside the captured viewport. A partial decode
      // here would otherwise turn into a blank or stretched section in the PNG.
      if (cropX < -0.5 || cropY < -0.5 || (cropX + tileW) * scale > bitmap.width + 2 || (cropY + tileH) * scale > bitmap.height + 2) {
        throw new Error(`Screenshot tile ${tile.index + 1} crop falls outside its captured image.`);
      }

      const tileRecord = {
        key: `${message.captureId}:${tile.index}`,
        captureId: message.captureId,
        index: tile.index,
        blob,
        bitmapW: bitmap.width,
        bitmapH: bitmap.height,
        scale,
        tileX: Number(tile.tileX),
        tileY: Number(tile.tileY),
        tileW,
        tileH,
        cropX,
        cropY,
        createdAt: Date.now()
      };
      await putTile(tileRecord);
      session.touchedAt = Date.now();
      session.scale = session.scale || scale;
      if (Math.abs(scale - session.scale) > session.scale * 0.01) {
        const warning = 'Screenshot scale varied during capture; minor seams or resampling differences may remain.';
        session.warnings = [...new Set([...(session.warnings || []), warning])];
      }
      session.tileCount = Math.max(session.tileCount || 0, tileRecord.index + 1);
      await putSession(session);
      return { ok: true, scale, warnings: [] };
    } finally {
      bitmap.close();
    }
  }

  function waitForDownload(downloadId, timeoutMs = 90000) {
    return new Promise(resolve => {
      let done = false;
      const finish = result => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        downloadWaiters.delete(downloadId);
        resolve(result);
      };
      const timer = setTimeout(() => finish({ state: 'timeout' }), timeoutMs);
      downloadWaiters.set(downloadId, finish);
      chrome.downloads.search({ id: downloadId }).then(items => {
        if (items && items[0] && items[0].state === 'complete') finish({ state: 'complete' });
        else if (items && items[0] && items[0].state === 'interrupted') finish({ state: 'interrupted', error: items[0].error });
      }).catch(() => {});
    });
  }

  chrome.downloads.onChanged.addListener(delta => {
    if (!delta || !delta.id || !downloadWaiters.has(delta.id)) return;
    if (delta.state && ['complete', 'interrupted'].includes(delta.state.current)) {
      downloadWaiters.get(delta.id)({ state: delta.state.current, error: delta.error && delta.error.current });
    }
  });

  async function startDownload(url, filename) {
    // Some platforms/locales reject non-ASCII punctuation (e.g. an em dash in
    // the page title) with "Invalid filename". Retry with an ASCII-safe name
    // rather than failing a capture that already succeeded.
    const slash = filename.lastIndexOf('/');
    const dir = slash >= 0 ? filename.slice(0, slash + 1) : '';
    const leaf = filename.slice(slash + 1);
    const asciiDir = dir.split('/').filter(Boolean).map(seg => G.asciiFilename(seg)).join('/');
    const candidates = [filename, (asciiDir ? asciiDir + '/' : '') + G.asciiFilename(leaf), `page-capture${(leaf.match(/\.[a-z0-9]+$/i) || [''])[0]}`];
    let lastError = null;
    for (const name of [...new Set(candidates)]) {
      try {
        return await chrome.downloads.download({ url, filename: name, saveAs: false, conflictAction: 'uniquify' });
      } catch (error) {
        lastError = error;
        if (!/invalid filename/i.test(String(error && error.message))) throw error;
      }
    }
    throw lastError || new Error('Download failed.');
  }

  async function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    try {
      const id = await startDownload(url, filename);
      const result = await waitForDownload(id);
      if (result.state === 'interrupted') throw new Error(`Browser download failed for ${filename}: ${result.error || 'interrupted'}`);
      if (result.state === 'timeout') throw new Error(`Timed out waiting for ${filename} to finish downloading.`);
      return id;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function composeOnePart(session, tiles, part, index, partCount, baseName, scale, format, pdfPages, withFolder = n => n) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(part.w * scale));
    canvas.height = Math.max(1, Math.round(part.h * scale));
    if (canvas.width * canvas.height > MAX_PART_PIXELS + 250000 || canvas.width > MAX_DIMENSION_PX + 2 || canvas.height > MAX_DIMENSION_PX + 2) {
      canvas.width = 1; canvas.height = 1;
      throw new Error('A PNG part exceeded the safety limit. Lower the maximum capture height and retry.');
    }
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Could not allocate a PNG canvas. The page may be too large for available memory.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const partRect = { x: part.x, y: part.y, w: part.w, h: part.h };
    // Draw later tiles first so the earliest/top-left tile wins in overlap areas.
    const reverseTiles = [...tiles].sort((a, b) => b.index - a.index);
    let drawn = 0;

    try {
      for (const tile of reverseTiles) {
        const overlap = G.intersectRect(partRect, { x: tile.tileX, y: tile.tileY, w: tile.tileW, h: tile.tileH });
        if (!overlap) continue;
        let bitmap;
        try {
          bitmap = await createImageBitmap(tile.blob);
        } catch (error) {
          throw new Error(`Could not decode screenshot tile ${tile.index + 1}; no PNG was exported from an incomplete tile set.`);
        }
        try {
          const mapping = G.tileDrawMapping(tile, overlap, part, scale, bitmap.width, bitmap.height);
          if (!mapping) throw new Error(`Screenshot tile ${tile.index + 1} does not contain a valid image region for this PNG section.`);
          ctx.drawImage(bitmap, mapping.sx, mapping.sy, mapping.sw, mapping.sh, mapping.dx, mapping.dy, mapping.dw, mapping.dh);
          drawn++;
        } finally {
          bitmap.close();
        }
      }
      if (drawn === 0) throw new Error(`PNG section ${index + 1} did not overlap any captured screenshot tiles.`);
      const mime = format === 'png' ? 'image/png' : 'image/jpeg';
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(result => result ? resolve(result) : reject(new Error('Image encoding failed. The browser may have run out of memory.')), mime, mime === 'image/jpeg' ? JPEG_QUALITY : undefined);
      });
      const ext = format === 'png' ? 'png' : 'jpg';
      const filename = partCount === 1 ? `${baseName}.${ext}` : `${baseName}_part-${String(index + 1).padStart(2, '0')}-of-${String(partCount).padStart(2, '0')}.${ext}`;
      if (format === 'pdf') {
        // Collect JPEG bytes; the PDF is written once after the last part.
        const runs = (textRuns.get(session.captureId) || [])
          .filter(r => r[1] + r[3] > part.y && r[1] < part.y + part.h && r[0] + r[2] > part.x && r[0] < part.x + part.w)
          .map(r => ({ x: r[0] - part.x, y: r[1] - part.y, w: r[2], h: r[3], text: r[5] }));
        pdfPages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), cssWidth: part.w, cssHeight: part.h, text: runs });
        status(`Encoded page ${index + 1} of ${partCount}\u2026`, 80 + ((index + 1) / partCount) * 15);
      } else {
        status(`Downloading ${ext.toUpperCase()} ${index + 1} of ${partCount}\u2026`, 80 + ((index + 1) / partCount) * 18);
        await downloadBlob(blob, withFolder(filename));
      }
      return { filename, width: Math.round(part.w * scale), height: Math.round(part.h * scale), drawnTiles: drawn, bytes: blob.size };
    } finally {
      // Release the potentially large backing store on both success and failure.
      canvas.width = 1;
      canvas.height = 1;
    }
  }

  async function compose(message) {
    if (!pageCaptureId || message.captureId !== pageCaptureId) throw new Error('Capture ID does not match this local assembly page.');
    const session = await getSession(message.captureId);
    if (!session) throw new Error('Capture session was not found.');
    const tiles = await getAllTiles(message.captureId);
    if (!tiles.length) throw new Error('No screenshot tiles were stored.');
    const scale = session.scale || tiles[0].scale || 1;
    const width = Math.max(1, Math.floor(session.pageW || tiles[0].bitmapW));
    const requestedHeightOverride = Number(message.pageHeightOverride);
    const baseHeight = Math.max(1, Math.floor(session.pageH || tiles[0].bitmapH));
    // Only permit a downward override; background.js may shrink the target by a
    // few pixels when a dynamic inner panel's live scroll extent decreases at its
    // final reachable edge. Never let a message enlarge the originally measured
    // capture area or create a false pass for unseen content.
    const height = Number.isFinite(requestedHeightOverride) && requestedHeightOverride > 0
      ? Math.max(1, Math.min(baseHeight, Math.floor(requestedHeightOverride)))
      : baseHeight;
    const expectedTileCount = Number(message.expectedTileCount || session.expectedTileCount || 0);
    const validation = G.validateTileCoverage(tiles, width, height, expectedTileCount);
    if (!validation.ok) {
      if (validation.reason === 'missing-tiles') {
        const sample = validation.missingIndices.slice(0, 8).map(i => i + 1).join(', ');
        const suffix = validation.missingIndices.length > 8 ? ', \u2026' : '';
        throw new Error(`Capture incomplete: ${validation.missingIndices.length} screenshot tile(s) are missing (section ${sample}${suffix}). Nothing was exported.`);
      }
      if (validation.reason === 'coverage-gap') {
        const gap = validation.gap || {};
        const finalTiles = tiles.slice().sort((a, b) => a.tileY - b.tileY || a.tileX - b.tileX).slice(-4)
          .map(tile => `#${tile.index + 1}@(${Math.round(tile.tileX)},${Math.round(tile.tileY)}) ${Math.round(tile.tileW)}x${Math.round(tile.tileH)}`)
          .join('; ');
        const likelyCause = session.scrollerType === 'inner'
          ? 'The selected inner scroll panel may be clipped or replaced during capture.'
          : 'The measured document extent may not match the browser scrolling element; reload the page and retry.';
        throw new Error(`Capture incomplete: screenshot tiles leave a gap near x=${Math.round(gap.x || 0)}, y=${Math.round(gap.y || 0)} CSS pixels (page ${width}x${height}; final tiles: ${finalTiles || 'unavailable'}). Nothing was exported. ${likelyCause}`);
      }
      throw new Error(`Capture incomplete: screenshot tile validation failed (${validation.reason}). Nothing was exported.`);
    }

    const parts = G.buildParts(width, height, scale, MAX_DIMENSION_PX, MAX_PART_PIXELS);
    if (!parts.length) throw new Error('Could not create output PNG dimensions.');
    const baseName = G.filenameBase(message.baseName, 'page-capture');
    const folder = G.safeFolder(message.folder || '');
    const withFolder = name => folder ? `${folder}/${name}` : name;
    const format = FORMATS.includes(message.format) ? message.format : 'png';
    const results = [];
    const pdfPages = [];
    const warnings = [...(session.warnings || [])];
    if (parts.length > 1 && format !== 'pdf') warnings.push(`The page was exported as ${parts.length} numbered ${format === 'png' ? 'PNG' : 'JPEG'} parts to stay within browser image-size limits.`);
    for (let i = 0; i < parts.length; i++) {
      if (cancelledCaptures.has(message.captureId)) throw new Error('Capture cancelled between PNG parts. Any part already downloaded will remain in Downloads.');
      status(`Assembling part ${i + 1} of ${parts.length}\u2026`, 70 + (i / parts.length) * 10);
      results.push(await composeOnePart(session, tiles, parts[i], i, parts.length, baseName, scale, format, pdfPages, withFolder));
    }
    let downloads = results.length;
    if (format === 'pdf') {
      if (!PDF) throw new Error('The PDF writer failed to load.');
      const textCount = pdfPages.reduce((a, p) => a + (p.text ? p.text.length : 0), 0);
      const bytes = PDF.buildPdf(pdfPages, { title: session.title || baseName, subject: session.url || '' });
      if (textCount) warnings.push(`PDF includes a searchable, selectable text layer (${textCount.toLocaleString()} lines).`);
      pdfPages.length = 0;
      const pdfBlob = new Blob([bytes], { type: 'application/pdf' });
      status('Downloading PDF\u2026', 98);
      await downloadBlob(pdfBlob, withFolder(`${baseName}.pdf`));
      downloads = 1;
      results.splice(0, results.length, { filename: `${baseName}.pdf`, width: results[0] ? results[0].width : 0, height: results.reduce((a, r) => a + r.height, 0), bytes: pdfBlob.size });
    }
    textRuns.delete(message.captureId);
    await cleanup(message.captureId).catch(() => {});
    status(`Saved ${downloads} file${downloads === 1 ? '' : 's'}.`, 100);
    return {
      ok: true,
      downloads,
      pages: format === 'pdf' ? parts.length : undefined,
      dimensions: { width, height, scale },
      parts: results.map(r => ({ filename: r.filename, width: r.width, height: r.height, bytes: r.bytes })),
      warnings: [...new Set(warnings)]
    };
  }

  const startupCleanupPromise = cleanupAbandonedData().then(() => {
    status('Local PNG assembly page is ready.', 0);
  }).catch(error => {
    // Cleanup is best-effort; normal captures still report storage errors if the
    // database is genuinely unavailable.
    status(`Ready with temporary-data cleanup warning: ${error.message || error}`, 0);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !P || !P.isStitcherCommand(message.type)) return;
    // Only the stitcher tab opened for this capture may reply. Other assembly
    // tabs must ignore the request rather than race to respond to runtime messages.
    if (!pageCaptureId || message.captureId !== pageCaptureId) return;
    (async () => {
      if (message.type === 'PAC_PING') {
        await startupCleanupPromise;
        return { ok: true, ready: true, captureId: pageCaptureId };
      }
      if (message.type === 'PAC_BEGIN') {
        await putSession({ captureId: message.captureId, ...message.session, warnings: message.session.warnings || [], tileCount: 0, createdAt: Date.now(), touchedAt: Date.now() });
        status('Receiving screenshot tiles\u2026', 2);
        return { ok: true };
      }
      if (message.type === 'PAC_STORE_TILE') {
        const result = await storeTile(message);
        return { ok: true, warnings: result.warnings };
      }
      if (message.type === 'PAC_STORE_TEXT') {
        const runs = Array.isArray(message.runs) ? message.runs.filter(r => Array.isArray(r) && r.length >= 6 && r.slice(0, 4).every(Number.isFinite) && typeof r[5] === 'string') : [];
        textRuns.set(message.captureId, (textRuns.get(message.captureId) || []).concat(runs));
        return { ok: true, stored: runs.length };
      }
      if (message.type === 'PAC_COMPOSE') return await compose(message);
      if (message.type === 'PAC_CANCEL_STITCH') {
        cancelledCaptures.add(message.captureId);
        return { ok: true };
      }
      if (message.type === 'PAC_CLEANUP') {
        cancelledCaptures.delete(message.captureId);
        textRuns.delete(message.captureId);
        await cleanup(message.captureId).catch(() => {});
        return { ok: true };
      }
      return undefined;
    })().then(response => { if (response) sendResponse(response); }).catch(error => sendResponse({ ok: false, error: error && error.message ? error.message : String(error) }));
    return true;
  });

  status('Checking temporary capture data\u2026', 0);
})();
