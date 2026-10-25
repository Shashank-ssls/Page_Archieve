/* URL policy shared by the background worker tests and capture entry point. */
(function (root) {
  'use strict';

  const blockedProtocols = new Set([
    'chrome:',
    'edge:',
    'about:',
    'devtools:',
    'chrome-extension:',
    'view-source:'
  ]);

  // Extension stores: Chrome never lets extensions script these pages ("The
  // extensions gallery cannot be scripted"), so treat them like chrome:// pages.
  const storePages = [
    /^chromewebstore\.google\.com$/,
    /^chrome\.google\.com\/webstore(\/|$)/,
    /^microsoftedge\.microsoft\.com\/addons(\/|$)/
  ];

  const api = {
    isRestrictedUrl(value) {
      try {
        const url = new URL(String(value || ''));
        if (blockedProtocols.has(url.protocol)) return true;
        const hostPath = url.host + url.pathname;
        return storePages.some(re => re.test(url.host) || re.test(hostPath));
      } catch (_) {
        return true;
      }
    },
    // A file or web address that names a .pdf. Used only when the page itself
    // cannot be asked (no file access), so Chrome's PDF viewer still gets the
    // capture buttons switched off before the user clicks.
    looksLikePdfUrl(value) {
      try {
        const url = new URL(String(value || ''));
        return /\.pdf$/i.test(decodeURIComponent(url.pathname));
      } catch (_) {
        return false;
      }
    },
    isStorePage(value) {
      try {
        const url = new URL(String(value || ''));
        const hostPath = url.host + url.pathname;
        return storePages.some(re => re.test(url.host) || re.test(hostPath));
      } catch (_) {
        return false;
      }
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PageArchiveUrlPolicy = api;
})(globalThis);
