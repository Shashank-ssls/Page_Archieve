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

  const api = {
    isRestrictedUrl(value) {
      try {
        return blockedProtocols.has(new URL(String(value || '')).protocol);
      } catch (_) {
        return true;
      }
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PageArchiveUrlPolicy = api;
})(globalThis);
