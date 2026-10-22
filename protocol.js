/* Explicit message namespaces for the broadcast-based extension runtime. */
(function (root) {
  'use strict';

  const pageCommands = new Set([
    'PAC_VISIBLE_INFO',
    'PAC_PREPARE',
    'PAC_SET_TILE',
    'PAC_RESTORE',
    'PAC_CANCEL_PREPARE',
    'PAC_RENDER_MEASURE',
    'PAC_RENDER_PIN',
    'PAC_RENDER_SETTLE',
    'PAC_RENDER_VH_SNAPSHOT',
    'PAC_RENDER_VH_PIN',
    'PAC_COLLECT_TEXT',
    'PAC_INK_BANDS',
    'PAC_RENDER_TRIM_END'
  ]);
  const stitcherCommands = new Set([
    'PAC_PING',
    'PAC_BEGIN',
    'PAC_STORE_TILE',
    'PAC_STORE_TEXT',
    'PAC_COMPOSE',
    'PAC_CANCEL_STITCH',
    'PAC_CLEANUP'
  ]);

  const api = {
    isPageCommand(type) { return pageCommands.has(type); },
    isStitcherCommand(type) { return stitcherCommands.has(type); }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PageArchiveProtocol = api;
})(globalThis);
