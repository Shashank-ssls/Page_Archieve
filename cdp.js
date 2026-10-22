/* Thin chrome.debugger wrapper used by the render engine. Loaded by the worker. */
(function (root) {
  'use strict';

  const PROTOCOL_VERSION = '1.3';
  const detachListeners = new Set();

  if (root.chrome && chrome.debugger && chrome.debugger.onDetach) {
    chrome.debugger.onDetach.addListener((source, reason) => {
      for (const fn of [...detachListeners]) {
        try { fn(source, reason); } catch (_) {}
      }
    });
  }

  function withTimeout(promise, ms, label) {
    let timer = null;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s.`)), ms);
      })
    ]).finally(() => { if (timer !== null) clearTimeout(timer); });
  }

  function describeAttachError(error) {
    const raw = String(error && error.message ? error.message : error);
    if (/another debugger|already attached/i.test(raw)) {
      return 'DevTools or another extension is already attached to this tab. Close DevTools for this tab to use the Full render engine.';
    }
    if (/cannot access|cannot attach|chrome:\/\/|chrome-extension:\/\//i.test(raw)) {
      return 'Chrome does not allow the render engine on this page.';
    }
    return raw;
  }

  class Session {
    constructor(tabId) {
      this.tabId = tabId;
      this.target = { tabId };
      this.attached = false;
      this.detachedReason = null;
      this.overridden = false;
      this._onDetach = (source, reason) => {
        if (source && source.tabId === this.tabId) {
          this.attached = false;
          this.detachedReason = reason || 'detached';
        }
      };
    }

    static available() {
      return !!(root.chrome && chrome.debugger && typeof chrome.debugger.attach === 'function');
    }

    async attach() {
      if (!Session.available()) throw new Error('The debugger API is unavailable in this browser.');
      detachListeners.add(this._onDetach);
      try {
        await chrome.debugger.attach(this.target, PROTOCOL_VERSION);
      } catch (error) {
        detachListeners.delete(this._onDetach);
        throw new Error(describeAttachError(error));
      }
      this.attached = true;
      // Keep the tab rendering even if Chrome considers it unfocused; cheap and
      // ignored by builds that do not support it.
      await this.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    }

    async send(method, params = {}, timeoutMs = 30000) {
      if (!this.attached) {
        const why = this.detachedReason === 'canceled_by_user'
          ? 'Capture cancelled from the browser debugging bar.'
          : 'The render engine lost its connection to the tab.';
        throw new Error(why);
      }
      return withTimeout(chrome.debugger.sendCommand(this.target, method, params), timeoutMs, method);
    }

    async layoutMetrics() {
      return this.send('Page.getLayoutMetrics');
    }

    async setViewport(width, height) {
      await this.send('Emulation.setDeviceMetricsOverride', {
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height)),
        deviceScaleFactor: 0,
        mobile: false
      });
      this.overridden = true;
    }

    async clearViewport() {
      if (!this.overridden || !this.attached) return;
      this.overridden = false;
      await this.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
    }

    // Returns a PNG data URL for a CSS-pixel clip rectangle.
    async screenshot(clip, beyondViewport) {
      const params = { format: 'png', fromSurface: true, captureBeyondViewport: !!beyondViewport };
      if (clip) params.clip = { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 };
      const result = await this.send('Page.captureScreenshot', params, 60000);
      if (!result || typeof result.data !== 'string' || !result.data.length) throw new Error('The render engine returned an empty screenshot.');
      return `data:image/png;base64,${result.data}`;
    }

    // Viewport-only screenshot, used as a drop-in for captureVisibleTab.
    async viewportScreenshot() {
      const result = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, 60000);
      if (!result || typeof result.data !== 'string') throw new Error('The render engine returned an empty screenshot.');
      return `data:image/png;base64,${result.data}`;
    }

    async detach() {
      await this.clearViewport().catch(() => {});
      detachListeners.delete(this._onDetach);
      if (!this.attached) return;
      this.attached = false;
      await chrome.debugger.detach(this.target).catch(() => {});
    }
  }

  const api = { Session, withTimeout, describeAttachError };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PageArchiveCdp = api;
})(globalThis);
