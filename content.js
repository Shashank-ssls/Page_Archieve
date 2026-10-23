'use strict';

(() => {
  if (window.__pageArchiveContentInstalled) return;
  window.__pageArchiveContentInstalled = true;
  const G = window.PageArchiveGeometry;
  const P = window.PageArchiveProtocol;
  let state = null;
  let lastPanelSelectionIssue = null;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const afterPaint = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

  function rootMetrics() {
    // Measure the node the browser actually scrolls. Including body.scrollHeight
    // here can overstate the reachable document extent on some layouts; the last
    // requested tile is then clamped by Chrome and leaves a false coverage gap.
    const root = document.scrollingElement || document.documentElement || document.body;
    return G.rootPageSize(
      window.innerWidth,
      window.innerHeight,
      root ? root.scrollWidth : 0,
      root ? root.scrollHeight : 0
    );
  }

  function walkOpenDom(maxNodes = 60000) {
    const out = [];
    const stack = [document.documentElement];
    while (stack.length && out.length < maxNodes) {
      const node = stack.pop();
      if (!node || node.nodeType !== 1) continue;
      out.push(node);
      let children = [];
      try { children = Array.from(node.children || []); } catch (_) {}
      try { if (node.shadowRoot) children.push(...Array.from(node.shadowRoot.children || [])); } catch (_) {}
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
    return out;
  }

  function visibleRect(el) {
    const r = el.getBoundingClientRect();
    const left = Math.max(0, r.left);
    const top = Math.max(0, r.top);
    const right = Math.min(window.innerWidth, r.right);
    const bottom = Math.min(window.innerHeight, r.bottom);
    return { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
  }

  // ---- Site presets ----------------------------------------------------------
  // Find a message/cell element by stable markers (data attributes, custom
  // tags), then walk up to the nearest ancestor that genuinely scrolls. This
  // survives most redesigns because it never depends on hashed class names.
  const SITE_PRESETS = [
    // `turns` (optional) matches one element per user prompt; it names the PDF
    // outline entries for chat captures.
    { name: 'ChatGPT', host: /(^|\.)(chatgpt\.com|chat\.openai\.com)$/, turns: '[data-message-author-role="user"]', markers: ['[data-turn-key]', '[data-conversation-role]', '[data-user-message-bubble]', '[data-message-author-role]', 'article[data-testid^="conversation-turn"]', '[data-testid^="conversation-turn"]'] },
    { name: 'Claude', host: /(^|\.)claude\.ai$/, turns: '[data-testid="user-message"]', markers: ['[data-testid="user-message"]', '.font-claude-message', '[data-is-streaming]', '[data-test-render-count]'] },
    { name: 'Gemini', host: /(^|\.)gemini\.google\.com$/, turns: 'user-query', markers: ['user-query', 'model-response', 'message-content'] },
    { name: 'Perplexity', host: /(^|\.)perplexity\.ai$/, markers: ['[data-testid="answer"]', '.prose', '[id^="markdown-content"]'] },
    { name: 'Copilot', host: /(^|\.)copilot\.microsoft\.com$/, turns: '[data-content="user-message"]', markers: ['[data-content="user-message"]', '[data-content="ai-message"]', 'cib-message'] },
    { name: 'DeepSeek', host: /(^|\.)chat\.deepseek\.com$/, markers: ['.ds-markdown', '[class*="message"]'] },
    { name: 'Google Colab', host: /(^|\.)colab\.research\.google\.com$/, markers: ['.cell', 'colab-run-button', '.notebook-cell-list .cell'] },
    { name: 'Jupyter', host: /./, markers: ['.jp-Notebook .jp-Cell', '.jp-Notebook'], requireMarker: true }
  ];

  function isScrollableBox(el) {
    try {
      const cs = getComputedStyle(el);
      return ['auto', 'scroll', 'overlay'].includes(cs.overflowY) && el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 120;
    } catch (_) { return false; }
  }

  // Prefer a match that is actually laid out: apps such as ChatGPT keep hidden
  // (0x0) copies of other threads earlier in the DOM.
  function isLaidOut(el) {
    try { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; } catch (_) { return false; }
  }

  function queryDeep(selector) {
    let first = null;
    try {
      for (const hit of document.querySelectorAll(selector)) {
        if (isLaidOut(hit)) return hit;
        first = first || hit;
      }
    } catch (_) { return null; }
    for (const el of walkOpenDom(30000)) {
      if (!el.shadowRoot) continue;
      try {
        for (const hit of el.shadowRoot.querySelectorAll(selector)) {
          if (isLaidOut(hit)) return hit;
          first = first || hit;
        }
      } catch (_) {}
    }
    return first;
  }

  function scrollableAncestor(el) {
    for (let a = el; a; ) {
      if (a !== document.documentElement && a !== document.body && isScrollableBox(a)) return a;
      if (a.parentElement) a = a.parentElement;
      else { const root = a.getRootNode && a.getRootNode(); a = root && root.host ? root.host : null; }
    }
    return null;
  }

  // Returns { name, scroller|null } when a preset matches this site, else null.
  function detectPreset() {
    const host = String(location.hostname || '').toLowerCase();
    for (const preset of SITE_PRESETS) {
      if (!preset.host.test(host)) continue;
      for (const selector of preset.markers) {
        const marker = queryDeep(selector);
        if (!marker) continue;
        const scroller = scrollableAncestor(marker);
        // A matching marker whose page scrolls as a whole is still a match:
        // the document is the right target there.
        return { name: preset.name, scroller, turns: preset.turns || null };
      }
      if (!preset.requireMarker) return { name: preset.name, scroller: null, turns: preset.turns || null };
    }
    return null;
  }

  function getInnerScroller(force = false) {
    lastPanelSelectionIssue = null;
    const root = document.scrollingElement || document.documentElement;
    const rootM = rootMetrics();
    const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
    const host = String(location.hostname || '').toLowerCase();
    const conversationHost = /(^|\.)(chatgpt\.com|chat\.openai\.com|claude\.ai|gemini\.google\.com|perplexity\.ai|copilot\.microsoft\.com|poe\.com)$/.test(host);
    const semanticSelector = 'main,[role="main"],[id*="conversation" i],[id*="thread" i],[data-testid*="conversation" i],[data-testid*="thread" i],[data-testid*="message" i],[aria-label*="conversation" i],[aria-label*="messages" i],[aria-label*="chat" i]';
    const candidates = [];
    // Some sites lock <html> and scroll <body> instead (height:100% + overflow:auto).
    // document.scrollingElement then reports no overflow, so treat a genuinely
    // scrolling body as a full-viewport panel rather than giving up.
    const bodyScrolls = (() => {
      const body = document.body;
      if (!body || body === root) return false;
      try {
        const css = getComputedStyle(body);
        return ['auto', 'scroll', 'overlay'].includes(css.overflowY) && body.scrollHeight > body.clientHeight + 120 && root.scrollHeight <= window.innerHeight + 2;
      } catch (_) { return false; }
    })();
    for (const el of walkOpenDom()) {
      if (el === document.documentElement || el === root) continue;
      if (el === document.body && !bodyScrolls) continue;
      let css;
      try { css = getComputedStyle(el); } catch (_) { continue; }
      if (!['auto', 'scroll', 'hidden', 'overlay'].includes(css.overflowY) && !['auto', 'scroll', 'hidden', 'overlay'].includes(css.overflow)) continue;
      const clientW = el.clientWidth || 0;
      const clientH = el.clientHeight || 0;
      if (clientW < 240 || clientH < 180 || el.scrollHeight <= clientH + 120) continue;
      const rawRect = el.getBoundingClientRect();
      const r = visibleRect(el);
      const visibleArea = r.w * r.h;
      const areaRatio = visibleArea / viewportArea;
      if (areaRatio < 0.22) continue;
      const severelyClipped = G.isHeavilyClippedPanel({
        left: rawRect.left, top: rawRect.top, right: rawRect.right, bottom: rawRect.bottom,
        clientWidth: clientW, clientHeight: clientH, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight
      });
      if (severelyClipped && !force) {
        lastPanelSelectionIssue = 'The detected conversation panel is mostly outside the visible browser area. Smart mode will prefer the document instead of starting thousands of pixels into that panel.';
        continue;
      }
      // Chat products often keep the document itself fixed and scroll a nested
      // semantic main/thread node. Weight these nodes without hard-coding hashed
      // framework class names; retain generic overflow-area detection for other SPAs.
      let ownSemantic = 0;
      try {
        if (el.matches('main,[role="main"]')) ownSemantic = 3;
        else if (el.matches(semanticSelector)) ownSemantic = 2;
        else if (el.closest('main,[role="main"]')) ownSemantic = 1;
      } catch (_) {}
      const labels = [el.id, el.getAttribute('class'), el.getAttribute('aria-label'), el.getAttribute('data-testid'), el.getAttribute('role')].filter(Boolean).join(' ');
      if (/conversation|chat-thread|transcript|message-list|scroll-container|scroll-area/i.test(labels)) ownSemantic = Math.max(ownSemantic, 2);
      if (conversationHost) {
        try { if (el.closest('aside,[role="complementary"],nav,[role="navigation"]')) continue; } catch (_) {}
      }
      const contentRatio = Math.max(1, el.scrollHeight / Math.max(1, clientH));
      const semanticBoost = 1 + ownSemantic * 0.42;
      const appBoost = conversationHost && ownSemantic > 0 ? 1.18 : 1;
      const score = visibleArea * Math.min(4, Math.sqrt(contentRatio)) * semanticBoost * appBoost;
      candidates.push({ el, score, areaRatio, scrollHeight: el.scrollHeight, rootHeight: rootM.pageH, semantic: ownSemantic, severelyClipped });
    }
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (force) return best ? best.el : null;
    if (!best) return null;
    // Prefer the document on ordinary long webpages. A high-overflow child can
    // be a modal, swap widget, or dashboard panel rather than the whole page (as
    // seen on marketing/DEX sites). Smart mode chooses generic panels only when
    // the root is effectively non-scrollable; known conversation apps remain an
    // explicit exception because their page shell often stays fixed.
    if (G.shouldUseInnerScroller({
      rootHeight: rootM.pageH,
      viewportHeight: window.innerHeight,
      areaRatio: best.areaRatio,
      semantic: best.semantic,
      conversationHost, severelyClipped: best.severelyClipped
    })) return best.el;
    return null;
  }

  function currentMetrics() {
    if (!state) throw new Error('No capture session has been prepared.');
    if (state.scrollerType === 'inner') {
      if (!state.scroller || !state.scroller.isConnected) throw new Error('The selected inner scroll area was replaced by the website during capture. Retry using the root page if this keeps happening.');
      const el = state.scroller;
      const r = el.getBoundingClientRect();
      const contentLeft = r.left + el.clientLeft;
      const contentTop = r.top + el.clientTop;
      const crop = {
        x: Math.max(0, contentLeft),
        y: Math.max(0, contentTop),
        w: 0,
        h: 0
      };
      crop.w = Math.max(0, Math.min(window.innerWidth, contentLeft + el.clientWidth) - crop.x);
      crop.h = Math.max(0, Math.min(window.innerHeight, contentTop + el.clientHeight) - crop.y);
      return {
        pageW: Math.max(el.scrollWidth, el.clientWidth),
        pageH: Math.max(el.scrollHeight, el.clientHeight),
        captureW: Math.max(1, crop.w), captureH: Math.max(1, crop.h),
        viewportW: window.innerWidth, viewportH: window.innerHeight,
        scrollerType: 'inner',
        crop,
        cropClipped: crop.w + 1 < el.clientWidth || crop.h + 1 < el.clientHeight,
        tileX: el.scrollLeft + (crop.x - contentLeft),
        tileY: el.scrollTop + (crop.y - contentTop),
        scrollX: el.scrollLeft,
        scrollY: el.scrollTop,
        title: document.title,
        url: location.href
      };
    }
    const m = rootMetrics();
    const root = document.scrollingElement || document.documentElement || document.body;
    const scrollX = root ? Number(root.scrollLeft) || 0 : Number(window.scrollX) || 0;
    const scrollY = root ? Number(root.scrollTop) || 0 : Number(window.scrollY) || 0;
    return {
      pageW: m.pageW, pageH: m.pageH,
      captureW: window.innerWidth, captureH: window.innerHeight,
      viewportW: window.innerWidth, viewportH: window.innerHeight,
      scrollerType: 'root', crop: { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight },
      tileX: scrollX, tileY: scrollY,
      scrollX, scrollY,
      title: document.title, url: location.href
    };
  }

  function setScroll(x, y) {
    const safeX = Math.max(0, Number(x) || 0);
    const safeY = Math.max(0, Number(y) || 0);
    if (state && state.scrollerType === 'inner') {
      if (!state.scroller || !state.scroller.isConnected) throw new Error('The selected inner scroll area was replaced by the website during capture.');
      state.scroller.scrollLeft = safeX;
      state.scroller.scrollTop = safeY;
    } else {
      window.scrollTo(safeX, safeY);
    }
  }

  function snapshotStyle(el, property) {
    return { el, property, value: el.style.getPropertyValue(property), priority: el.style.getPropertyPriority(property), hadStyleAttr: el.hasAttribute('style') };
  }

  function restoreStyle(entry) {
    if (!entry || !entry.el) return;
    if (entry.value) entry.el.style.setProperty(entry.property, entry.value, entry.priority);
    else entry.el.style.removeProperty(entry.property);
    // Leave no empty style="" behind on elements that had no style attribute.
    if (!entry.hadStyleAttr && entry.el.getAttribute('style') === '') entry.el.removeAttribute('style');
  }

  function snapshotStyleOnce(el, property) {
    if (!state || !el) return;
    if (state.inlineSnapshots.some(entry => entry.el === el && entry.property === property)) return;
    state.inlineSnapshots.push(snapshotStyle(el, property));
  }

  function parseTranslateLength(token, basis) {
    if (!token) return 0;
    const value = String(token).trim();
    if (value === '0' || value === '0px') return 0;
    if (/^-?(?:\d+\.?\d*|\.\d+)px$/i.test(value)) return Number.parseFloat(value);
    if (/^-?(?:\d+\.?\d*|\.\d+)%$/.test(value)) return Number.parseFloat(value) * basis / 100;
    return null;
  }

  function readTranslateVector(el) {
    let raw = 'none';
    try { raw = getComputedStyle(el).translate || 'none'; } catch (_) {}
    if (raw === 'none') return { x: 0, y: 0 };
    // Computed CSS individual translate values are normally resolved to px. This
    // small parser deliberately declines opaque calc()/keyword values rather than
    // clobbering an unparseable author transform while attempting to stabilize it.
    const tokens = raw.match(/(?:calc\([^)]*\)|[^\s]+)/g) || [];
    if (!tokens.length || tokens.length > 2) return null;
    const rect = el.getBoundingClientRect();
    const x = parseTranslateLength(tokens[0], rect.width);
    const y = parseTranslateLength(tokens[1] || '0px', rect.height);
    if (x === null || y === null) return null;
    return { x, y };
  }

  function recordScrollerAnchor() {
    if (!state || state.scrollerType !== 'inner' || !state.scroller || !state.scroller.isConnected) return;
    const el = state.scroller;
    const r = el.getBoundingClientRect();
    state.scrollerAnchor = { left: r.left, top: r.top, width: r.width, height: r.height };
    state.scrollerBaseTranslate = readTranslateVector(el);
    state.scrollerAnchorOffset = { x: 0, y: 0 };
  }

  async function stabilizeInnerScroller() {
    if (!state || state.scrollerType !== 'inner' || !state.scroller) return;
    const el = state.scroller;
    if (!el.isConnected) throw new Error('The selected inner scroll panel was replaced during capture. Retry with Document or after the page settles.');
    if (!state.scrollerAnchor || !state.scrollerBaseTranslate) return;

    // Some application shells scroll or animate the selected panel's parent while
    // the panel itself is being scrolled. Keep the outer document at its original
    // position first, then correct residual element drift with CSS individual
    // translate. This preserves the target crop coordinates for tile stitching.
    const outerX = Number(state.outerOriginalX) || 0;
    const outerY = Number(state.outerOriginalY) || 0;
    if (Math.abs((Number(window.scrollX) || 0) - outerX) > 1 || Math.abs((Number(window.scrollY) || 0) - outerY) > 1) {
      window.scrollTo(outerX, outerY);
      await afterPaint();
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      if (!el.isConnected) throw new Error('The selected inner scroll panel was replaced during capture. Retry with Document or after the page settles.');
      const r = el.getBoundingClientRect();
      if (Math.abs(r.width - state.scrollerAnchor.width) > 3 || Math.abs(r.height - state.scrollerAnchor.height) > 3) {
        throw new Error('The selected inner scroll panel changed size during capture. Its tiles no longer share a stable crop; retry after the page settles or choose Document.');
      }
      const correction = G.anchorCorrection(state.scrollerAnchor, { left: r.left, top: r.top });
      if (!correction.valid || (Math.abs(correction.x) <= 1 && Math.abs(correction.y) <= 1)) return;
      snapshotStyleOnce(el, 'translate');
      state.scrollerAnchorOffset.x += correction.x;
      state.scrollerAnchorOffset.y += correction.y;
      const base = state.scrollerBaseTranslate;
      el.style.setProperty('translate', `${base.x + state.scrollerAnchorOffset.x}px ${base.y + state.scrollerAnchorOffset.y}px`, 'important');
      await afterPaint();
    }

    const finalRect = el.getBoundingClientRect();
    const remainingX = Math.abs(finalRect.left - state.scrollerAnchor.left);
    const remainingY = Math.abs(finalRect.top - state.scrollerAnchor.top);
    if (remainingX > 3 || remainingY > 3) {
      throw new Error(`Could not stabilize the selected inner panel (remaining shift ${Math.round(remainingX)}px horizontally, ${Math.round(remainingY)}px vertically). Choose Document or retry after the page settles.`);
    }
  }

  // Some app shells give their primary scroller a client height larger than the
  // portion visible in the browser viewport (for example, a 100vh panel placed
  // below a fixed app header). Scrolling then cannot expose the final hidden
  // strip, leaving a coverage gap. During panel-only capture, temporarily fit the
  // scrollport to its visible viewport rectangle and translate a clipped top/left
  // edge into view. The original inline styles are restored at the end.
  async function normalizeInnerScroller() {
    if (!state || state.scrollerType !== 'inner' || !state.scroller || !state.scroller.isConnected) return;
    const el = state.scroller;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (G.isHeavilyClippedPanel({
      left: r.left, top: r.top, right: r.right, bottom: r.bottom,
      clientWidth: el.clientWidth, clientHeight: el.clientHeight, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight
    })) {
      throw new Error('The selected scroll panel is mostly outside the browser viewport. Scroll the outer page until the panel begins near the viewport, then retry; alternatively choose Smart or Document if the page itself scrolls.');
    }
    const contentLeft = r.left + el.clientLeft;
    const contentTop = r.top + el.clientTop;
    const visibleLeft = Math.max(0, contentLeft);
    const visibleTop = Math.max(0, contentTop);
    const visibleRight = Math.min(window.innerWidth, contentLeft + el.clientWidth);
    const visibleBottom = Math.min(window.innerHeight, contentTop + el.clientHeight);
    const visibleW = Math.max(0, visibleRight - visibleLeft);
    const visibleH = Math.max(0, visibleBottom - visibleTop);
    if (visibleW < 240 || visibleH < 180) {
      throw new Error('The main scrollable panel is too clipped to capture reliably. Zoom out or resize the browser window, then retry.');
    }
    const clippedX = visibleW + 1 < el.clientWidth || contentLeft < -1;
    const clippedY = visibleH + 1 < el.clientHeight || contentTop < -1;
    if (!clippedX && !clippedY) return;

    const properties = ['translate', 'width', 'max-width', 'min-width', 'height', 'max-height', 'min-height', 'overflow-x', 'overflow-y'];
    for (const property of properties) snapshotStyleOnce(el, property);

    const dx = visibleLeft - contentLeft;
    const dy = visibleTop - contentTop;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      el.style.setProperty('translate', `${dx}px ${dy}px`, 'important');
    }

    const borderX = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
    const borderY = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    const paddingX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const paddingY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const cssWidth = Math.max(1, visibleW + (cs.boxSizing === 'border-box' ? borderX : -paddingX));
    const cssHeight = Math.max(1, visibleH + (cs.boxSizing === 'border-box' ? borderY : -paddingY));

    if (clippedX) {
      el.style.setProperty('width', `${cssWidth}px`, 'important');
      el.style.setProperty('max-width', `${cssWidth}px`, 'important');
      el.style.setProperty('min-width', '0px', 'important');
      el.style.setProperty('overflow-x', 'auto', 'important');
    }
    if (clippedY) {
      el.style.setProperty('height', `${cssHeight}px`, 'important');
      el.style.setProperty('max-height', `${cssHeight}px`, 'important');
      el.style.setProperty('min-height', '0px', 'important');
      el.style.setProperty('overflow-y', 'auto', 'important');
    }
    await afterPaint();
    await sleep(80);
    if (!el.isConnected) throw new Error('The main scrollable panel changed while it was being prepared. Retry after the page settles.');
  }

  function registerImageRoot(rootNode) {
    if (!state || !rootNode || !rootNode.querySelectorAll || state.seenImageRoots.has(rootNode)) return;
    state.seenImageRoots.add(rootNode);
    if (state.imageRoots && !state.imageRoots.includes(rootNode)) state.imageRoots.push(rootNode);
    const registerImg = img => { if (img && img.tagName === 'IMG') state.imageNodes.add(img); };
    try { rootNode.querySelectorAll('img').forEach(registerImg); } catch (_) {}
    const scanHosts = root => {
      try {
        for (const node of root.querySelectorAll('*')) {
          if (node.shadowRoot) registerImageRoot(node.shadowRoot);
        }
      } catch (_) {}
    };
    scanHosts(rootNode);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const added of record.addedNodes || []) {
          if (!added || added.nodeType !== 1) continue;
          registerImg(added);
          try { added.querySelectorAll('img').forEach(registerImg); } catch (_) {}
          const candidates = [added];
          try { candidates.push(...added.querySelectorAll('*')); } catch (_) {}
          for (const candidate of candidates) {
            try { if (candidate.shadowRoot) registerImageRoot(candidate.shadowRoot); } catch (_) {}
          }
        }
      }
    });
    try {
      observer.observe(rootNode, { childList: true, subtree: true });
      state.imageObservers.push(observer);
    } catch (_) { observer.disconnect(); }
  }

  function observePageImages() {
    if (!state) return;
    state.imageNodes = new Set();
    state.imageObservers = [];
    state.seenImageRoots = new WeakSet();
    registerImageRoot(document);
    // document.querySelectorAll does not cross shadow roots, so registerImageRoot
    // adds a separate observer for each open shadow root it finds. Closed shadow
    // roots and cross-origin iframe documents remain outside browser access.
  }

  function pageImages() {
    if (state && state.imageNodes) return [...state.imageNodes];
    return Array.from(document.images || []);
  }

  function promoteLazyImage(img) {
    if (!state || !img || !img.isConnected) return;
    if (!state.imageLoadingSnapshots.has(img)) {
      state.imageLoadingSnapshots.set(img, {
        hadAttribute: img.hasAttribute('loading'),
        value: img.getAttribute('loading')
      });
    }
    if (img.loading === 'lazy' || (img.getAttribute('loading') || '').toLowerCase() === 'lazy') {
      img.loading = 'eager';
    }
  }

  function prepareStyles() {
    const root = document.documentElement;
    const body = document.body;
    const style = document.createElement('style');
    style.dataset.pageArchiveTemporary = 'true';
    style.textContent = `
      html, body { scroll-behavior: auto !important; }
      *, *::before, *::after { scroll-behavior: auto !important; }
      html { scrollbar-width: none !important; }
      *::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
      * { caret-color: transparent !important; }
      * { transition-duration: 0s !important; transition-delay: 0s !important; }
      * { content-visibility: visible !important; }
      [data-page-archive-free-height] { min-height: 0 !important; }
    `;
    (document.head || root).appendChild(style);
    state.tempStyle = style;
    for (const el of [root, body].filter(Boolean)) {
      state.inlineSnapshots.push(snapshotStyle(el, 'scroll-behavior'));
      el.style.setProperty('scroll-behavior', 'auto', 'important');
    }
  }

  function detectPinnedElements() {
    const found = [];
    for (const el of walkOpenDom()) {
      let position = '';
      try { position = getComputedStyle(el).position; } catch (_) {}
      if (position !== 'fixed' && position !== 'sticky') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.right <= 0 || r.top >= window.innerHeight || r.left >= window.innerWidth) continue;
      found.push(el);
      if (found.length >= 400) break;
    }
    return found;
  }

  // contains() across shadow roots: Colab's cells keep their run buttons in
  // shadow DOM, which plain contains() reports as outside the panel.
  function composedContains(ancestor, el) {
    for (let n = el; n; n = n.parentNode || (n instanceof ShadowRoot ? n.host : null)) {
      if (n === ancestor) return true;
    }
    return false;
  }

  function rectsOverlap(a, b) {
    return !!a && !!b && a.right > b.x && a.left < b.x + b.w && a.bottom > b.y && a.top < b.y + b.h;
  }

  function hidePinnedOnLaterTiles() {
    if (!state) return;
    if (!state.hiddenPinnedElements) state.hiddenPinnedElements = new Set();
    let crop = { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    if (state.scrollerType === 'inner' && state.scroller && state.scroller.isConnected) {
      try { crop = currentMetrics().crop; } catch (_) {}
    }
    for (const el of state.pinned || []) {
      if (!el || !el.isConnected || state.hiddenPinnedElements.has(el)) continue;
      if (state.scrollerType === 'inner') {
        // Keep the selected scroller and any ancestor containing it. However,
        // fixed/sticky UI overlays outside the scroller (e.g. ChatGPT's composer)
        // can still overlap the crop and would otherwise repeat in every tile.
        if (el === state.scroller || composedContains(el, state.scroller)) continue;
        const isInsideScroller = state.scroller && composedContains(state.scroller, el);
        let overlapsCrop = false;
        try { overlapsCrop = rectsOverlap(el.getBoundingClientRect(), crop); } catch (_) {}
        if (!isInsideScroller && !overlapsCrop) continue;
      }
      snapshotStyleOnce(el, 'visibility');
      el.style.setProperty('visibility', 'hidden', 'important');
      state.hiddenPinnedElements.add(el);
    }
    state.pinnedHidden = state.hiddenPinnedElements.size > 0;
  }

  // ---- Render engine helpers (chrome.debugger path) ------------------------
  // The worker grows the emulated viewport so the selected panel no longer
  // overflows, then screenshots the panel rectangle directly. These helpers
  // only measure and make reversible inline-style changes.
  function renderMeasure() {
    const m = currentMetrics();
    const out = {
      scrollerType: m.scrollerType,
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
      title: document.title,
      url: location.href
    };
    if (state && state.scrollerType === 'inner' && state.scroller && state.scroller.isConnected) {
      const el = state.scroller;
      const r = el.getBoundingClientRect();
      out.panel = {
        left: r.left + el.clientLeft,
        top: r.top + el.clientTop,
        width: el.clientWidth,
        height: el.clientHeight,
        bottom: r.top + el.clientTop + el.clientHeight,
        scrollHeight: el.scrollHeight,
        scrollWidth: el.scrollWidth,
        scrollTop: el.scrollTop,
        overflow: Math.max(0, el.scrollHeight - el.clientHeight)
      };
      // Detect an ancestor that clips the panel (overflow hidden with a fixed
      // height). Growing the viewport cannot expose content hidden that way.
      // Follows CSS: an absolutely positioned box escapes overflow clipping of
      // every ancestor until its containing block (the next positioned or
      // transformed ancestor). DeepSeek's app is an absolute layer inside a 0px
      // tall overflow:hidden body that does not clip it. A fixed box escapes all.
      let clippedBy = 0;
      let escaping = '';
      try { escaping = getComputedStyle(el).position; } catch (_) {}
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        let cs;
        try { cs = getComputedStyle(a); } catch (_) { continue; }
        if (escaping === 'fixed') break;
        const containing = cs.position !== 'static' || cs.transform !== 'none' || cs.contain.includes('paint') || cs.contain === 'strict' || cs.contain === 'content';
        if (escaping === 'absolute' && !containing) continue;
        escaping = (cs.position === 'absolute' || cs.position === 'fixed') ? cs.position : '';
        if (cs.overflowY === 'visible' && cs.overflowX === 'visible') continue;
        const ar = a.getBoundingClientRect();
        if (ar.bottom + 2 < out.panel.bottom) clippedBy = Math.max(clippedBy, out.panel.bottom - ar.bottom);
      }
      out.panel.ancestorClip = clippedBy;
    } else {
      const root = document.scrollingElement || document.documentElement;
      out.docW = Math.max(window.innerWidth, root ? root.scrollWidth : 0);
      out.docH = Math.max(window.innerHeight, root ? root.scrollHeight : 0);
    }
    return out;
  }

  // ---- Document "grow" mode --------------------------------------------------
  // To make on-screen-only loaders (IntersectionObserver lazy images, reveal
  // animations, virtualized feeds) and fixed full-screen backdrops behave, the
  // worker grows the emulated viewport to the whole document height. Elements
  // sized from the viewport (100vh heroes, height:100% chains) would grow with
  // it, so snapshot heights, nudge the viewport, and pin whatever changed.
  function renderVhSnapshot() {
    if (!state) return 0;
    const snap = [];
    for (const el of walkOpenDom()) {
      if (el === document.documentElement || el === document.body) continue;
      let cs;
      try { cs = getComputedStyle(el); } catch (_) { continue; }
      if (cs.position === 'fixed' || cs.display === 'none' || cs.display === 'contents') continue;
      const r = el.getBoundingClientRect();
      if (r.height < 40 || r.width < 40) continue;
      snap.push({ el, h: r.height });
      if (snap.length >= 12000) break;
    }
    state.vhSnapshot = snap;
    state.baseViewport = { w: window.innerWidth, h: window.innerHeight };
    // Elements whose background is laid out against the window: html/body,
    // anything with background-attachment: fixed, and full-window fixed layers.
    const bgTargets = new Set([document.documentElement, document.body].filter(Boolean));
    for (const el of walkOpenDom(20000)) {
      let cs;
      try { cs = getComputedStyle(el); } catch (_) { continue; }
      if (!/url\(/.test(cs.backgroundImage)) continue;
      if (/fixed/.test(cs.backgroundAttachment)) { bgTargets.add(el); continue; }
      if (cs.position === 'fixed') {
        const r = el.getBoundingClientRect();
        if (r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9) bgTargets.add(el);
      }
    }
    state.bgTargets = [...bgTargets].slice(0, 60);
    return snap.length;
  }

  // A background laid out against the window (attachment: fixed, or on a
  // full-window fixed layer) would be re-sized and tiled against the grown
  // viewport. Freeze it at the exact size/position it had in the real window,
  // drawn once; the background colour still fills the rest of the page.
  const naturalSizeCache = new Map();
  function naturalSize(url) {
    if (naturalSizeCache.has(url)) return naturalSizeCache.get(url);
    const p = new Promise(resolve => {
      const img = new Image();
      const t = setTimeout(() => resolve(null), 2500);
      img.onload = () => { clearTimeout(t); resolve(img.naturalWidth > 0 ? { w: img.naturalWidth, h: img.naturalHeight } : null); };
      img.onerror = () => { clearTimeout(t); resolve(null); };
      img.src = url;
    });
    naturalSizeCache.set(url, p);
    return p;
  }

  function splitLayers(value) {
    const out = []; let depth = 0, cur = '';
    for (const ch of String(value || '')) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  function resolveLength(token, basis, fallback) {
    if (token == null || token === 'auto') return fallback;
    if (/%$/.test(token)) return parseFloat(token) / 100 * basis;
    if (/px$/.test(token)) return parseFloat(token);
    return fallback;
  }

  async function freezeWindowBackgrounds() {
    if (!state || !state.bgTargets || !state.baseViewport) return 0;
    const vw = state.baseViewport.w, vh = state.baseViewport.h;
    let frozen = 0;
    for (const el of state.bgTargets) {
      if (!el || !el.isConnected) continue;
      let cs;
      try { cs = getComputedStyle(el); } catch (_) { continue; }
      const fixedAttach = /fixed/.test(cs.backgroundAttachment);
      const isLayer = cs.position === 'fixed';
      if (!fixedAttach && !isLayer) continue;
      const images = splitLayers(cs.backgroundImage);
      const sizes = splitLayers(cs.backgroundSize);
      const positions = splitLayers(cs.backgroundPosition);
      const outSize = [], outPos = [], outRepeat = [];
      for (let i = 0; i < images.length; i++) {
        const m = images[i].match(/url\(\s*["']?(.*?)["']?\s*\)/);
        const sizeTok = (sizes[i % sizes.length] || 'auto').split(/\s+/);
        const posTok = (positions[i % positions.length] || '0% 0%').split(/\s+/);
        let w = null, h = null;
        const nat = m ? await naturalSize(m[1]) : null;
        if (sizeTok[0] === 'cover' || sizeTok[0] === 'contain') {
          if (nat) {
            const k = sizeTok[0] === 'cover' ? Math.max(vw / nat.w, vh / nat.h) : Math.min(vw / nat.w, vh / nat.h);
            w = nat.w * k; h = nat.h * k;
          }
        } else {
          w = resolveLength(sizeTok[0], vw, null);
          h = resolveLength(sizeTok[1] || 'auto', vh, null);
          if (nat) {
            if (w == null && h == null) { w = nat.w; h = nat.h; }
            else if (w == null) w = nat.w * (h / nat.h);
            else if (h == null) h = nat.h * (w / nat.w);
          }
        }
        if (w == null || h == null) { outSize.push(sizes[i % sizes.length] || 'auto'); outPos.push(positions[i % positions.length] || '0% 0%'); outRepeat.push('no-repeat'); continue; }
        const px = (tok, room) => /%$/.test(tok) ? parseFloat(tok) / 100 * room : parseFloat(tok) || 0;
        outSize.push(`${w}px ${h}px`);
        outPos.push(`${px(posTok[0] || '0%', vw - w)}px ${px(posTok[1] || '0%', vh - h)}px`);
        outRepeat.push('no-repeat');
      }
      for (const p of ['background-attachment', 'background-size', 'background-position', 'background-repeat']) snapshotStyleOnce(el, p);
      el.style.setProperty('background-attachment', images.map(() => 'scroll').join(', '), 'important');
      el.style.setProperty('background-size', outSize.join(', '), 'important');
      el.style.setProperty('background-position', outPos.join(', '), 'important');
      el.style.setProperty('background-repeat', outRepeat.join(', '), 'important');
      frozen++;
    }
    return frozen;
  }

  async function renderVhPin(delta) {
    if (!state || !state.vhSnapshot) return 0;
    const d = Math.max(1, Number(delta) || 1);
    const changed = [];
    for (const entry of state.vhSnapshot) {
      if (!entry.el.isConnected) continue;
      const diff = entry.el.getBoundingClientRect().height - entry.h;
      if (Math.abs(diff) >= d * 0.15 && Math.abs(diff) <= d * 3.5) changed.push(entry);
    }
    // Measure everything first, then pin, so pinning one element cannot
    // disturb the comparison for the next.
    for (const { el, h } of changed) {
      for (const p of ['box-sizing', 'height', 'min-height', 'max-height']) snapshotStyleOnce(el, p);
      el.style.setProperty('box-sizing', 'border-box', 'important');
      el.style.setProperty('height', `${h}px`, 'important');
      el.style.setProperty('min-height', `${h}px`, 'important');
      el.style.setProperty('max-height', `${h}px`, 'important');
    }
    await freezeWindowBackgrounds();
    state.vhSnapshot = null;
    return changed.length;
  }

  // Pin the panel to its full content height when it does not grow with the
  // viewport (fixed px height, max-height, or a calc() that overshoots).
  // An element that paints nothing: no text, no media, no background, border
  // or shadow. Only such elements may be hidden as end spacers.
  function isPaintlessBox(el) {
    if (/^(IMG|SVG|VIDEO|CANVAS|IFRAME|PICTURE|INPUT|TEXTAREA|SELECT|OBJECT|EMBED)$/i.test(el.tagName)) return false;
    if (el.textContent.trim() !== '') return false;
    if (el.querySelector('img, svg, video, canvas, iframe, picture, input, textarea, select, object, embed')) return false;
    const cs = getComputedStyle(el);
    if (cs.backgroundImage !== 'none' || cs.boxShadow !== 'none') return false;
    if (!/rgba\(.*,\s*0\)|transparent/.test(cs.backgroundColor)) return false;
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) if ((parseFloat(cs[`border${side}Width`]) || 0) > 0 && cs[`border${side}Style`] !== 'none') return false;
    return true;
  }

  // Chats (Claude's split view, 2026-10) end the message list with an empty
  // flex-grow spacer whose min-height a script sets to "viewport minus the last
  // turn" so the last turn can scroll to the top. Full render grows the
  // viewport to the panel height, and the spacer grows with it into a huge
  // blank band. Hide paintless in-flow boxes after the last content, walking
  // only through wrappers that hold most of the panel. display:none rather than
  // min-height: the page rewrites min-height on resize.
  // Gemini (2026-10) instead gives the last turn itself an inline min-height of
  // "panel height minus 112px". A turn has content, so it is not hidden; its
  // script-set inline min-height is overridden by an !important rule in the
  // temporary stylesheet (a page script rewriting the inline value on resize
  // cannot beat it). The marker attribute is removed on restore.
  function hideTrailingSpacers(scroller) {
    const contentH = Math.max(1, scroller.scrollHeight);
    let hidden = 0;
    let parent = scroller;
    for (let depth = 0; depth < 5 && parent; depth++) {
      // Notion pads its page column with an inline 30vh; freeze it at the
      // on-screen value before the viewport grows.
      if (/v(h|min|max)\b/.test(parent.style.paddingBottom)) {
        const px = getComputedStyle(parent).paddingBottom;
        snapshotStyleOnce(parent, 'padding-bottom');
        parent.style.setProperty('padding-bottom', px, 'important');
        hidden++;
      }
      let next = null;
      const spacers = [];
      for (let child = parent.lastElementChild; child; child = child.previousElementSibling) {
        const cs = getComputedStyle(child);
        if (cs.display === 'none' || cs.position === 'absolute' || cs.position === 'fixed') continue;
        if (isPaintlessBox(child)) {
          const r = child.getBoundingClientRect();
          if (r.height > 0 || (parseFloat(cs.minHeight) || 0) > 0 || (parseFloat(cs.flexGrow) || 0) > 0) spacers.push(child);
          continue;
        }
        // An empty zero-height box (Notion ends its scroller with one) is not the content end.
        if (child.getBoundingClientRect().height < 1 && !((parseFloat(cs.minHeight) || 0) > 0)) continue;
        if (child.style.minHeight && !child.hasAttribute('data-page-archive-free-height')) {
          child.setAttribute('data-page-archive-free-height', '');
          (state.freedHeights || (state.freedHeights = [])).push(child);
          hidden++;
        }
        if (child.getBoundingClientRect().height >= contentH * 0.5) next = child;
        break;
      }
      // A chat ends in one or two spacers, and a script-sized spacer has a
      // min-height or flex-grow (Claude, 2026-10, whose run can be longer). A
      // longer run of plain fixed-height empty boxes is a virtualised list's
      // unmounted rows (placeholders that fill in once the viewport grows), so
      // it is content, not an end spacer.
      const sized = el => { const c = getComputedStyle(el); return (parseFloat(c.minHeight) || 0) > 0 || (parseFloat(c.flexGrow) || 0) > 0; };
      if (spacers.length <= 2 || spacers.some(sized)) {
        for (const child of spacers) {
          snapshotStyleOnce(child, 'display');
          child.style.setProperty('display', 'none', 'important');
          hidden++;
        }
      }
      parent = next;
    }
    return hidden;
  }

  // Once per capture, before the worker first grows the viewport.
  function renderFreeEndSpacers() {
    if (!state || state.endSpacersChecked || state.scrollerType !== 'inner' || !state.scroller || !state.scroller.isConnected) return;
    state.endSpacersChecked = true;
    state.endSpacersHidden = hideTrailingSpacers(state.scroller);
  }

  function renderPinPanel() {
    if (!state || state.scrollerType !== 'inner' || !state.scroller || !state.scroller.isConnected) return false;
    const el = state.scroller;
    renderFreeEndSpacers();
    for (const p of ['height', 'max-height', 'min-height', 'overflow-y']) snapshotStyleOnce(el, p);
    // scrollHeight never reports less than the box height, so collapse the box
    // first to read the true content height (including padding).
    el.style.setProperty('min-height', '0px', 'important');
    el.style.setProperty('max-height', 'none', 'important');
    el.style.setProperty('height', '0px', 'important');
    el.style.setProperty('overflow-y', 'hidden', 'important');
    const full = el.scrollHeight;
    const cs = getComputedStyle(el);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const borderY = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    const cssHeight = cs.boxSizing === 'border-box' ? full + borderY : Math.max(1, full - padY);
    el.style.setProperty('height', `${cssHeight}px`, 'important');
    el.style.setProperty('max-height', 'none', 'important');
    el.style.setProperty('min-height', '0px', 'important');
    el.style.setProperty('overflow-y', 'hidden', 'important');
    state.renderPinned = true;
    return true;
  }

  // Hide floating UI that is not part of the content being archived:
  //  - panel mode: fixed/sticky elements outside the panel that overlap it
  //    (chat composers, floating buttons);
  //  - document mode: bars pinned to the bottom of the viewport (composers,
  //    cookie banners, chat widgets). Top headers are kept; they render once.
  // A bar-sized sticky or absolute element inside the panel, pinned to its
  // bottom. Sticky ones must be anchored by bottom, not top (Chrome reports
  // unset sticky insets as 'auto') and may sit up to 400px above the panel
  // edge: ChatGPT's disclaimer line ends above the space reserved for the
  // composer. Absolute insets are resolved to pixels, so absolute elements
  // must touch the bottom edge exactly.
  function isBottomPinnedInPanel(el, cs, r, panelRect) {
    if (!(r.height <= 320 && r.height < panelRect.h * 0.5)) return false;
    const panelBottom = panelRect.y + panelRect.h;
    if (cs.position === 'sticky') {
      if (cs.bottom === 'auto' || cs.top !== 'auto') return false;
      return r.bottom <= panelBottom + 4 && r.bottom >= panelBottom - 400;
    }
    if (cs.position !== 'absolute') return false;
    return Math.abs(r.bottom - panelBottom) <= 4;
  }

  function renderHideFloating() {
    if (!state) return 0;
    if (!state.hiddenPinnedElements) state.hiddenPinnedElements = new Set();
    const vh = window.innerHeight;
    let panelRect = null;
    if (state.scrollerType === 'inner' && state.scroller && state.scroller.isConnected) {
      const r = state.scroller.getBoundingClientRect();
      panelRect = { x: r.left, y: r.top, w: r.width, h: r.height };
    }
    let count = 0;
    for (const el of walkOpenDom()) {
      let cs;
      try { cs = getComputedStyle(el); } catch (_) { continue; }
      if (cs.position !== 'fixed' && cs.position !== 'sticky' && cs.position !== 'absolute') continue;
      if (state.hiddenPinnedElements.has(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      // Floating UI is short. A box holding real text is content, unless it is
      // the message box itself (it holds an input).
      if ((el.textContent || '').length > 300 && !el.querySelector('textarea, input, [contenteditable="true"], [contenteditable=""]')) continue;
      if (panelRect) {
        if (el === state.scroller || composedContains(el, state.scroller)) continue;
        if (composedContains(state.scroller, el)) {
          // Bars pinned to the bottom edge inside the panel itself (e.g.
          // ChatGPT's composer: a sticky bottom-0 wrapper inside the thread
          // scroller). Top-pinned headers are kept.
          if (!isBottomPinnedInPanel(el, cs, r, panelRect)) continue;
        } else {
          // Fixed overlays, and button-sized absolute ones such as Gemini's
          // "Scroll to bottom" button, which hangs from the input area over
          // the panel's bottom edge.
          if (cs.position === 'sticky') continue;
          if (cs.position === 'absolute' && !(r.width <= 120 && r.height <= 120)) continue;
          if (!rectsOverlap(r, panelRect)) continue;
        }
      } else {
        if (cs.position !== 'fixed') continue;
        // Within 32px of the bottom: badges and chat bubbles float a little
        // above the edge (reCAPTCHA's badge sits 14px up).
        const bottomAnchored = r.bottom >= vh - 32 && r.top > vh * 0.45 && r.height < vh * 0.5;
        if (!bottomAnchored) continue;
      }
      snapshotStyleOnce(el, 'visibility');
      el.style.setProperty('visibility', 'hidden', 'important');
      state.hiddenPinnedElements.add(el);
      count++;
      if (!state.hiddenExamples) state.hiddenExamples = new Set();
      if (state.hiddenExamples.size < 4) state.hiddenExamples.add(describeElement(el));
      // A generous cap: the walk order is DOM order, and a message box late in
      // the DOM (Claude, 2026-10) was missed when the old cap of 60 was reached.
      if (count >= 400) { state.hiddenCapReached = true; break; }
    }
    return count;
  }

  // Short, human-readable name for a hidden element, for warnings.
  function describeElement(el) {
    // Icon fonts draw from the Private Use Area; those characters mean nothing
    // in a warning (they showed as boxes), so they are dropped.
    const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '')
      .replace(/[\uE000-\uF8FF\u200B-\u200F\uFEFF]|[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
      .replace(/\s+/g, ' ').trim().slice(0, 28);
    const tag = el.tagName.toLowerCase();
    return label ? `${tag} "${label}"` : tag;
  }

  // ---- Expand collapsed content -------------------------------------------
  const EXPAND_TEXT = /^(?:\s*(?:[+\u2026.]+\s*)?(?:view|show|read|see|load|expand|display)\s+(?:the\s+)?(?:more|rest|all|full|entire|whole|remaining)(?:\s+(?:text|comment|comments|replies|reply|content|post|message|answer|review|details))?|more|\u2026\s*more|expand(?:\s+all)?|show\s+\d+\s+more(?:\s+\w+)?|\d+\s+more\s+(?:replies|comments))\s*[.\u2026\u203a>\u2193\u25be]*\s*$/i;
  const NEVER_CLICK = /delete|remove|log\s*out|sign\s*out|unsubscribe|subscribe|buy|purchase|checkout|pay|donate|report|block|follow|like|upvote|downvote|share|send|submit|post\b|reply\b|translate|download|install|accept|agree|close|dismiss|cancel/i;

  const EXPAND_CLICK_CAP = 80;

  function safeToClick(el) {
    const tag = el.tagName;
    if (tag === 'A') {
      const href = (el.getAttribute('href') || '').trim();
      if (href && href !== '#' && !/^javascript:/i.test(href)) return false;
    } else if (tag === 'BUTTON' || tag === 'INPUT') {
      const type = (el.getAttribute('type') || (tag === 'BUTTON' ? 'submit' : '')).toLowerCase();
      if (type === 'submit' && el.form) return false;
      if (tag === 'INPUT' && !['button'].includes(type)) return false;
    } else if (el.getAttribute('role') !== 'button' && tag !== 'SUMMARY') {
      return false;
    }
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    const label = `${el.textContent || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`.replace(/\s+/g, ' ').trim();
    if (!label || label.length > 40 || NEVER_CLICK.test(label)) return false;
    const text = (el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    if (!EXPAND_TEXT.test(text)) return false;
    try {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    } catch (_) { return false; }
    return true;
  }

  async function expandCollapsed() {
    if (!state) return { details: 0, clamps: 0, clicks: 0 };
    let details = 0, clamps = 0, clicks = 0;
    state.openedDetails = state.openedDetails || [];
    for (const el of walkOpenDom()) {
      if (el.tagName === 'DETAILS' && !el.open) {
        el.open = true; state.openedDetails.push(el); details++;
        continue;
      }
      let cs;
      try { cs = getComputedStyle(el); } catch (_) { continue; }
      const clamp = cs.webkitLineClamp || cs.getPropertyValue('-webkit-line-clamp');
      if (clamp && clamp !== 'none' && el.scrollHeight > el.clientHeight + 2) {
        for (const p of ['-webkit-line-clamp', 'line-clamp', 'max-height', 'overflow', 'display']) snapshotStyleOnce(el, p);
        el.style.setProperty('-webkit-line-clamp', 'unset', 'important');
        el.style.setProperty('line-clamp', 'none', 'important');
        el.style.setProperty('max-height', 'none', 'important');
        el.style.setProperty('overflow', 'visible', 'important');
        if (cs.display === '-webkit-box') el.style.setProperty('display', 'block', 'important');
        clamps++;
      }
    }
    state.expandClicks = 0;
    clicks = await clickExpanders();
    return { details, clamps, clicks };
  }

  // Clicks are bounded (EXPAND_CLICK_CAP per capture) and repeated a few rounds
  // because one expansion can reveal another ("show 3 more replies" inside an
  // expanded thread). Also called again after the render engine has grown the
  // panel: virtualised chats (Claude, 2026-10) mount only the messages near the
  // viewport, so most "Show more" buttons do not exist during preparation.
  async function clickExpanders() {
    if (!state) return 0;
    state.clickedExpanders = state.clickedExpanders || new WeakSet();
    const clicked = state.clickedExpanders;
    let clicks = 0;
    for (let round = 0; round < 3 && state.expandClicks < EXPAND_CLICK_CAP; round++) {
      let roundClicks = 0;
      for (const el of walkOpenDom()) {
        if (state.expandClicks >= EXPAND_CLICK_CAP) break;
        if (clicked.has(el) || !['A', 'BUTTON', 'SPAN', 'DIV', 'INPUT', 'SUMMARY'].includes(el.tagName)) continue;
        if (!safeToClick(el)) continue;
        clicked.add(el);
        try { el.click(); clicks++; roundClicks++; state.expandClicks++; } catch (_) {}
      }
      if (!roundClicks) break;
      await sleep(450);
      throwIfCancelled();
    }
    return clicks;
  }

  // Vertical clip [top, bottom] that overflow ancestors apply to an element,
  // memoised per call site. Text in a collapsed "Show more" box still has
  // rects below the box; they never paint, so they are neither ink, nor
  // searchable PDF text, nor clickable. With scrollers = false only
  // overflow hidden/clip boxes count: text inside a scrolling panel is not
  // painted yet but growing the viewport can expose it.
  function makeClipper(scrollers = true) {
    const clips = new WeakMap();
    const clipOf = el => {
      // <body> grows with the viewport, so for the extent its clip does not count.
      if (!el || el === document.documentElement || (!scrollers && el === document.body)) return [-Infinity, Infinity];
      if (clips.has(el)) return clips.get(el);
      const parent = el.parentElement || (el.getRootNode && el.getRootNode().host) || null;
      let clip = clipOf(parent);
      try {
        const cs = getComputedStyle(el);
        const clipsY = scrollers ? cs.overflowY !== 'visible' : (cs.overflowY === 'hidden' || cs.overflowY === 'clip');
        if (clipsY || (scrollers && cs.overflowX !== 'visible')) {
          const r = el.getBoundingClientRect();
          clip = [Math.max(clip[0], r.top), Math.min(clip[1], r.bottom)];
        }
      } catch (_) {}
      clips.set(el, clip);
      return clip;
    };
    return clipOf;
  }

  // ---- Text layer, links and outline ------------------------------------------
  // Collect visible text as positioned runs (one per word group on a line) so
  // the PDF can carry an invisible, searchable/selectable text layer, plus link
  // rectangles and outline marks (h1-h3, or one per user turn on a chat preset).
  // Coordinates are viewport CSS px; the render engine lays the whole page out
  // at scroll 0.
  function collectTextRuns(maxWords = 120000) {
    const runs = [];
    const links = [];
    const headings = [];
    const turns = [];
    const result = { runs, links, marks: headings };
    const rootNode = state && state.scrollerType === 'inner' && state.scroller ? state.scroller : document.body;
    if (!rootNode) return result;
    const turnSelector = state && state.presetTurns;
    const pageBase = location.href.split('#')[0];
    const label = el => String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const firstRect = el => {
      for (const r of el.getClientRects()) if (r.width > 0 && r.height > 0) return r;
      return null;
    };
    let lastTurn = null;
    const clipOf = makeClipper();
    const shown = (r, clip) => r.top >= clip[0] - 1 && r.bottom <= clip[1] + 1;
    let words = 0;
    const range = document.createRange();
    const visible = new WeakMap();
    const isVisible = el => {
      if (!el) return false;
      if (visible.has(el)) return visible.get(el);
      let ok = true;
      try {
        if (typeof el.checkVisibility === 'function') ok = el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
        else { const cs = getComputedStyle(el); ok = cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05; }
      } catch (_) {}
      visible.set(el, ok);
      return ok;
    };
    const roots = [rootNode];
    for (let ri = 0; ri < roots.length && words < maxWords; ri++) {
      const walker = document.createTreeWalker(roots[ri], NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      let node;
      while ((node = walker.nextNode()) && words < maxWords) {
        if (node.nodeType === 1) {
          if (node.shadowRoot) roots.push(node.shadowRoot);
          collectMark(node);
          continue;
        }
        const text = node.nodeValue;
        if (!text || !/\S/.test(text)) continue;
        const parent = node.parentElement;
        if (!parent || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TEXTAREA)$/.test(parent.tagName) || !isVisible(parent)) continue;
        let fontPx = 16;
        try { fontPx = parseFloat(getComputedStyle(parent).fontSize) || 16; } catch (_) {}
        const re = /\S+/g;
        let m, line = null;
        while ((m = re.exec(text)) && words < maxWords) {
          words++;
          range.setStart(node, m.index);
          range.setEnd(node, m.index + m[0].length);
          const rects = range.getClientRects();
          if (!rects.length) continue;
          const r = rects[0];
          if (r.width <= 0 || r.height <= 0 || !shown(r, clipOf(parent))) continue;
          if (line && Math.abs(r.top - line.y) < 1 && r.left >= line.x + line.w - 1 && r.left - (line.x + line.w) < fontPx * 1.5) {
            line.text += ' ' + m[0];
            line.w = r.right - line.x;
          } else {
            if (line) runs.push(line);
            line = { x: r.left, y: r.top, w: r.width, h: r.height, fs: fontPx, text: m[0] };
          }
        }
        if (line) runs.push(line);
      }
    }
    range.detach && range.detach();
    // A chat outline lists the user's turns; headings are the fallback.
    if (turns.length) result.marks = turns;
    return result;

    function collectMark(el) {
      const tag = el.tagName;
      if (tag === 'A') {
        const href = String(el.getAttribute('href') || '');
        if (!href || links.length >= 5000 || !isVisible(el)) return;
        const abs = String(el.href || '');
        let dest = null;
        if (href.startsWith('#') || (abs.includes('#') && abs.split('#')[0] === pageBase)) {
          // Same-page link: resolve its target now, while the page is laid out.
          let id = abs.split('#')[1] || '';
          try { id = decodeURIComponent(id); } catch (_) {}
          const target = id && (document.getElementById(id) || document.getElementsByName(id)[0]);
          dest = target && firstRect(target);
          if (!dest) return;
        } else if (!/^(https?:|mailto:)/i.test(abs)) return;
        const clip = clipOf(el);
        const rects = Array.from(el.getClientRects()).filter(r => r.width > 0 && r.height > 0 && shown(r, clip)).slice(0, 8);
        for (const r of rects) links.push(dest ? [r.left, r.top, r.width, r.height, '', dest.left, dest.top] : [r.left, r.top, r.width, r.height, abs]);
        return;
      }
      if (turnSelector && turns.length < 2000 && !(lastTurn && lastTurn.contains(el))) {
        let hit = false;
        try { hit = el.matches(turnSelector); } catch (_) {}
        if (hit && isVisible(el)) {
          const r = firstRect(el);
          const text = r && label(el);
          if (text) { turns.push([r.left, r.top, 1, `${turns.length + 1}. ${text}`]); lastTurn = el; }
          return;
        }
      }
      if (/^H[1-3]$/.test(tag) && headings.length < 2000 && isVisible(el)) {
        const r = firstRect(el);
        const text = r && label(el);
        if (text) headings.push([r.left, r.top, Number(tag[1]), text]);
      }
    }
  }

  // Vertical bands (viewport CSS px, merged) where visible text is drawn, the
  // bottom of the last visible text or media, and its extent: the same bottom
  // counting text that scrolling panels hide but viewport growth exposes. The worker uses the bands to
  // prove each render screenshot was painted (Chrome can return a tall chunk
  // before it has rastered all of it) and the bottom to spot pages that add
  // blank space growing with the window. Media is left out of the bands: an
  // image may legitimately be one flat colour.
  function inkBands(maxNodes = 80000) {
    const rootNode = state && state.scrollerType === 'inner' && state.scroller ? state.scroller : document.body;
    const raw = [];
    let bottom = 0;
    if (!rootNode) return { bands: [], bottom };
    const range = document.createRange();
    const visible = new WeakMap();
    const isVisible = el => {
      if (visible.has(el)) return visible.get(el);
      let ok = true;
      try { ok = typeof el.checkVisibility === 'function' ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true; } catch (_) {}
      visible.set(el, ok);
      return ok;
    };
    const clipOf = makeClipper();
    const extentClipOf = makeClipper(false);
    let extent = 0;
    const roots = [rootNode];
    let nodes = 0;
    for (let ri = 0; ri < roots.length && nodes < maxNodes; ri++) {
      const walker = document.createTreeWalker(roots[ri], NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      let node;
      while ((node = walker.nextNode()) && nodes < maxNodes) {
        nodes++;
        if (node.nodeType === 1) {
          if (node.shadowRoot) roots.push(node.shadowRoot);
          if (/^(IMG|CANVAS|VIDEO|svg|PICTURE|IFRAME)$/.test(node.tagName) && isVisible(node)) {
            const r = node.getBoundingClientRect();
            if (r.width > 4 && r.height > 4) { bottom = Math.max(bottom, r.bottom); extent = Math.max(extent, r.bottom); }
          }
          continue;
        }
        if (!/\S/.test(node.nodeValue || '')) continue;
        const parent = node.parentElement;
        if (!parent || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TEXTAREA)$/.test(parent.tagName) || !isVisible(parent)) continue;
        range.selectNodeContents(node);
        const clip = clipOf(parent);
        const extentClip = extentClipOf(parent);
        for (const r of range.getClientRects()) {
          // Screen-reader-only text is clipped to 1px; it never paints.
          if (r.height < 6 || r.width < 2) continue;
          if (Math.min(r.bottom, extentClip[1]) - Math.max(r.top, extentClip[0]) >= 6) extent = Math.max(extent, Math.min(r.bottom, extentClip[1]));
          const top = Math.max(r.top, clip[0]), bot = Math.min(r.bottom, clip[1]);
          if (bot - top < 6) continue;
          raw.push([top, bot]);
          bottom = Math.max(bottom, bot);
        }
      }
    }
    raw.sort((a, b) => a[0] - b[0]);
    const bands = [];
    for (const b of raw) {
      const last = bands[bands.length - 1];
      if (last && b[0] <= last[1] + 2) last[1] = Math.max(last[1], b[1]);
      else bands.push([b[0], b[1]]);
    }
    return { bands: bands.slice(0, 20000).map(b => [Math.round(b[0] * 10) / 10, Math.round(b[1] * 10) / 10]), bottom: Math.round(bottom), extent: Math.round(Math.max(bottom, extent)) };
  }

  // Document target: hide paintless end spacers under <body> (same rules as the
  // panel path). Once per capture; the worker calls it only when the page
  // shows more than a viewport of nothing after its last content.
  function renderTrimDocumentEnd() {
    if (!state || state.docEndTrimmed || !document.body) return 0;
    state.docEndTrimmed = true;
    return hideTrailingSpacers(document.body);
  }

  function restoreAll() {
    if (!state) return;
    const previous = state;
    for (const observer of previous.imageObservers || []) {
      try { observer.disconnect(); } catch (_) {}
    }
    // Restore loading hints for every visible lazy image we promoted, including
    // images in open shadow roots, before restoring style/scroll state.
    for (const [img, snapshot] of previous.imageLoadingSnapshots || []) {
      try {
        if (!img || !img.isConnected) continue;
        if (snapshot.hadAttribute) img.setAttribute('loading', snapshot.value ?? '');
        else img.removeAttribute('loading');
      } catch (_) {}
    }
    // Restore each mutation independently. One detached element should not prevent
    // the remaining styles and the original scroll position from being restored.
    for (let i = previous.inlineSnapshots.length - 1; i >= 0; i--) {
      try { restoreStyle(previous.inlineSnapshots[i]); } catch (_) {}
    }
    for (const el of previous.freedHeights || []) { try { el.removeAttribute('data-page-archive-free-height'); } catch (_) {} }
    try { if (previous.tempStyle && previous.tempStyle.isConnected) previous.tempStyle.remove(); } catch (_) {}
    for (const d of previous.openedDetails || []) { try { if (d.isConnected) d.open = false; } catch (_) {} }
    try {
      if (previous.scrollerType === 'inner') {
        // Never apply inner-panel offsets to the document if the website replaced
        // the selected panel while capture was running.
        if (previous.scroller && previous.scroller.isConnected) {
          previous.scroller.scrollLeft = previous.originalX;
          previous.scroller.scrollTop = previous.originalY;
        }
        window.scrollTo(previous.outerOriginalX, previous.outerOriginalY);
      } else {
        window.scrollTo(previous.originalX, previous.originalY);
      }
    } catch (_) {}
    state = null;
  }

  function throwIfCancelled() {
    if (state && state.cancelled) throw new Error('Capture cancelled.');
  }

  function waitForImage(img, timeout) {
    if (img.complete) return Promise.resolve();
    return new Promise(resolve => {
      let done = false;
      let timer = null;
      const finish = () => {
        if (done) return;
        done = true;
        if (timer !== null) clearTimeout(timer);
        img.removeEventListener('load', finish);
        img.removeEventListener('error', finish);
        resolve();
      };
      img.addEventListener('load', finish, { once: true });
      img.addEventListener('error', finish, { once: true });
      timer = setTimeout(finish, timeout);
    });
  }

  async function waitForDecode(img, timeout) {
    if (typeof img.decode !== 'function') return null;
    let timer = null;
    try {
      return await Promise.race([
        img.decode().then(() => true, () => false),
        new Promise(resolve => { timer = setTimeout(() => resolve(null), timeout); })
      ]);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  function intersectsViewportForImage(img, crop) {
    const r = img.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > crop.x && r.left < crop.x + crop.w && r.bottom > crop.y && r.top < crop.y + crop.h;
  }

  function imageDeclaredSource(img) {
    if (!img) return '';
    const directCandidates = [
      img.currentSrc,
      img.getAttribute && img.getAttribute('src'),
      img.getAttribute && img.getAttribute('data-src'),
      img.getAttribute && img.getAttribute('data-lazy-src'),
      img.getAttribute && img.getAttribute('data-original')
    ];
    const direct = directCandidates.find(value => typeof value === 'string' && value.trim());
    if (direct) return String(direct).trim();
    const srcset = [img.getAttribute && img.getAttribute('srcset'), img.getAttribute && img.getAttribute('data-srcset'), img.getAttribute && img.getAttribute('data-lazy-srcset')]
      .find(value => typeof value === 'string' && value.trim());
    if (!srcset) return '';
    // A srcset is a comma-separated candidate list. Keep one candidate for a
    // concise diagnostic rather than printing the entire attribute or sizes.
    return String(srcset).split(',')[0].trim().split(/\s+/)[0] || '';
  }

  function safeAssetLabel(kind, rawUrl) {
    const raw = String(rawUrl || '').trim();
    if (/^data:/i.test(raw)) return `${kind}: embedded data image`;
    if (/^blob:/i.test(raw)) return `${kind}: blob image`;
    try {
      const url = new URL(raw, document.baseURI);
      return `${kind}: ${url.hostname}${url.pathname}`.slice(0, 128);
    } catch (_) {
      return `${kind}: image source`.slice(0, 128);
    }
  }

  function normalizeAuditedUrl(rawUrl) {
    const raw = String(rawUrl || '').trim();
    if (!raw || raw === 'none' || raw.startsWith('#')) return '';
    try {
      const url = new URL(raw, document.baseURI);
      if (!['http:', 'https:', 'data:', 'blob:'].includes(url.protocol)) return '';
      return url.href;
    } catch (_) { return ''; }
  }

  function extractCssImageUrls(value) {
    const text = String(value || '');
    if (!/url\s*\(/i.test(text)) return [];
    // image-set() may contain density/type alternatives where a broken unused
    // candidate is not evidence that the browser's selected image failed. Skip
    // individual probes for that declaration and report it as unverified.
    if (/image-set\s*\(/i.test(text)) {
      if (state && state.imageAudit) state.imageAudit.imageSetUnverified = true;
      return [];
    }
    const urls = [];
    const pattern = /url\(\s*(?:"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|([^)]*?))\s*\)/gi;
    let match;
    while ((match = pattern.exec(text))) {
      const raw = (match[1] ?? match[2] ?? match[3] ?? '').replace(/\\([\\"'()])/g, '$1').trim();
      const normalized = normalizeAuditedUrl(raw);
      if (normalized) urls.push(normalized);
    }
    return urls;
  }

  function collectVisibleCssImageAssets(crop) {
    const assets = new Map();
    if (!crop || !(crop.w > 0) || !(crop.h > 0)) return { assets: [], limitHit: false };
    const roots = state && state.imageRoots && state.imageRoots.length ? state.imageRoots : [document];
    const elements = new Set();
    const totalPointBudget = 2200;
    let totalPoints = 0;
    for (const rootNode of roots) {
      if (!rootNode || typeof rootNode.elementsFromPoint !== 'function') continue;
      let stepX = Math.max(20, Math.min(40, Math.floor(crop.w / 36) || 20));
      let stepY = Math.max(20, Math.min(40, Math.floor(crop.h / 24) || 20));
      // A render-engine crop can be tens of thousands of pixels tall. Spread the
      // fixed sampling budget evenly over the whole area instead of exhausting
      // it near the top and reporting a premature audit limit.
      if (state && state.renderEngine && (crop.w / stepX) * (crop.h / stepY) > totalPointBudget) {
        const step = Math.ceil(Math.sqrt((crop.w * crop.h) / totalPointBudget)) + 1;
        stepX = Math.max(stepX, step);
        stepY = Math.max(stepY, step);
      }
      const rootBudget = Math.max(120, Math.floor(totalPointBudget / Math.max(1, roots.length)));
      let rootPoints = 0;
      for (let y = crop.y + Math.min(stepY / 2, crop.h / 2); y < crop.y + crop.h && rootPoints < rootBudget && totalPoints < totalPointBudget; y += stepY) {
        for (let x = crop.x + Math.min(stepX / 2, crop.w / 2); x < crop.x + crop.w && rootPoints < rootBudget && totalPoints < totalPointBudget; x += stepX) {
          rootPoints++; totalPoints++;
          let hits = [];
          try { hits = rootNode.elementsFromPoint(x, y) || []; } catch (_) {}
          for (const hit of hits.slice(0, 8)) {
            let el = hit;
            for (let depth = 0; el && depth < 18; depth++) {
              if (el.nodeType === 1) elements.add(el);
              if (el.parentElement) el = el.parentElement;
              else {
                let host = null;
                try { host = el.getRootNode && el.getRootNode().host; } catch (_) {}
                el = host || null;
              }
            }
          }
        }
      }
    }

    const visible = [];
    for (const el of elements) {
      try {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || r.right <= crop.x || r.left >= crop.x + crop.w || r.bottom <= crop.y || r.top >= crop.y + crop.h) continue;
        visible.push({ el, area: Math.max(0, Math.min(r.right, crop.x + crop.w) - Math.max(r.left, crop.x)) * Math.max(0, Math.min(r.bottom, crop.y + crop.h) - Math.max(r.top, crop.y)) });
      } catch (_) {}
    }
    // Prioritize the largest visible elements first so the audit budget is spent
    // on hero/card backgrounds before tiny decorative icons.
    visible.sort((a, b) => b.area - a.area);
    const add = (raw, kind) => {
      const url = normalizeAuditedUrl(raw);
      if (url && !assets.has(url)) assets.set(url, { url, label: safeAssetLabel(kind, url) });
    };
    const cssProperties = [
      ['CSS background', 'backgroundImage'],
      ['CSS border image', 'borderImageSource'],
      ['CSS mask image', 'maskImage'],
      ['CSS mask image', 'webkitMaskImage'],
      ['CSS list image', 'listStyleImage']
    ];
    for (const entry of visible.slice(0, 1800)) {
      const el = entry.el;
      let style;
      try { style = getComputedStyle(el); } catch (_) { continue; }
      for (const [kind, prop] of cssProperties) {
        let value = '';
        try { value = style[prop] || ''; } catch (_) {}
        for (const url of extractCssImageUrls(value)) add(url, kind);
      }
      for (const pseudo of ['::before', '::after']) {
        let pseudoStyle;
        try { pseudoStyle = getComputedStyle(el, pseudo); } catch (_) { continue; }
        for (const [kind, prop] of [['CSS generated background', 'backgroundImage'], ['CSS generated content', 'content']]) {
          for (const url of extractCssImageUrls(pseudoStyle[prop] || '')) add(url, kind);
        }
      }
      const tag = String(el.tagName || '').toLowerCase();
      if (tag === 'image') {
        let href = '';
        try { href = (el.href && (el.href.baseVal || el.href.animVal)) || el.getAttribute('href') || el.getAttribute('xlink:href') || ''; } catch (_) {}
        add(href, 'SVG image');
      } else if (tag === 'video') {
        add(el.getAttribute('poster') || '', 'Video poster');
      } else if (tag === 'input' && String(el.type || '').toLowerCase() === 'image') {
        add(el.getAttribute('src') || '', 'Image input');
      }
    }
    const tileLimit = 40;
    return { assets: [...assets.values()].slice(0, tileLimit), limitHit: assets.size > tileLimit || totalPoints >= totalPointBudget };
  }

  function probeImageResource(url, timeoutMs) {
    return new Promise(resolve => {
      let completed = false;
      let timer = null;
      let image = null;
      const finish = result => {
        if (completed) return;
        completed = true;
        if (timer !== null) clearTimeout(timer);
        if (image) { image.onload = null; image.onerror = null; }
        resolve(result);
      };
      try {
        image = new Image();
        image.decoding = 'async';
        image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0 ? 'loaded' : 'broken');
        image.onerror = () => finish('broken');
        timer = setTimeout(() => finish('timeout'), Math.max(50, timeoutMs));
        image.src = url;
        if (image.complete) queueMicrotask(() => finish(image.naturalWidth > 0 && image.naturalHeight > 0 ? 'loaded' : 'broken'));
      } catch (_) { finish('broken'); }
    });
  }

  async function auditVisibleCssImageAssets(collected, deadline) {
    if (!state || !state.imageAudit) return { failures: [], warnings: [] };
    const audit = state.imageAudit;
    if (collected.limitHit) audit.limitHit = true;
    const assets = collected.assets || [];
    const pending = [];
    for (const asset of assets) {
      audit.cssAssetsSeen.add(asset.url);
      if (!audit.cssAssetLabels.has(asset.url)) audit.cssAssetLabels.set(asset.url, asset.label);
      if (audit.cssAssetResults.has(asset.url) || audit.timedOutCssAssets.has(asset.url)) continue;
      if (audit.cssAssetResults.size >= 200) { audit.limitHit = true; continue; }
      if (Date.now() >= deadline + 1) { audit.timedOutCssAssets.add(asset.url); continue; }
      pending.push(asset);
    }
    for (let i = 0; i < pending.length; i += 6) {
      if (Date.now() >= deadline) {
        for (const asset of pending.slice(i)) audit.timedOutCssAssets.add(asset.url);
        break;
      }
      const batch = pending.slice(i, i + 6);
      await Promise.all(batch.map(async asset => {
        const remaining = Math.max(50, Math.min(850, deadline - Date.now()));
        const result = await probeImageResource(asset.url, remaining);
        if (result === 'loaded' || result === 'broken') {
          audit.cssAssetResults.set(asset.url, result);
          audit.timedOutCssAssets.delete(asset.url);
        } else {
          audit.timedOutCssAssets.add(asset.url);
        }
      }));
    }
    // Return all confirmed CSS/embedded failures seen during preparation/capture,
    // not only the URLs visible in the current tile. Virtualized apps may remove
    // an earlier message before its tile is captured, but the audit must retain
    // a failure it already observed.
    const failures = [...audit.cssAssetResults.entries()]
      .filter(([, result]) => result === 'broken')
      .map(([url]) => audit.cssAssetLabels.get(url) || safeAssetLabel('Embedded image', url));
    const warnings = [];
    if (audit.limitHit) warnings.push('The visual image audit reached its safety limit; some CSS or embedded image assets may not have been checked.');
    if (audit.imageSetUnverified) warnings.push('Some CSS image-set alternatives could not be individually verified by the image audit.');
    if (audit.timedOutCssAssets.size) warnings.push('Some CSS or embedded image assets did not finish the verification check in time; these are unverified, not confirmed broken.');
    return { failures, warnings };
  }

  function imageAuditSummary() {
    if (!state || !state.imageAudit) return null;
    const audit = state.imageAudit;
    const seen = [...audit.seenHtmlImages];
    const incomplete = seen.filter(img => {
      const src = imageDeclaredSource(img);
      return src && (!img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0 || audit.decodeFailures.has(img));
    });
    const checkedCss = [...audit.cssAssetResults.values()].filter(status => status === 'loaded' || status === 'broken').length;
    const cssFailed = [...audit.cssAssetResults.values()].filter(status => status === 'broken').length;
    return {
      htmlImagesSeen: audit.seenHtmlImages.size,
      htmlImagesIncomplete: incomplete.length,
      htmlImageFailuresDetected: audit.incompleteHtmlImages.size,
      cssAssetsSeen: audit.cssAssetsSeen.size,
      cssAssetsChecked: checkedCss,
      cssAssetsFailed: cssFailed,
      cssAssetsTimedOut: audit.timedOutCssAssets.size,
      auditLimitHit: audit.limitHit,
      imageSetUnverified: audit.imageSetUnverified
    };
  }

  async function waitForVisibleFonts(timeoutMs) {
    try {
      if (!document.fonts || document.fonts.status !== 'loading') return;
      await Promise.race([
        document.fonts.ready.catch(() => {}),
        sleep(Math.max(0, Math.min(1200, timeoutMs)))
      ]);
    } catch (_) {}
  }

  async function waitForVisibleImages(waitMs) {
    let metrics;
    try { metrics = currentMetrics(); } catch (_) { return { brokenImages: [], cssImageFailures: [], auditWarnings: [], auditSummary: imageAuditSummary() }; }
    const budget = Math.max(0, Math.min(5000, Number(waitMs) || 0));
    const deadline = Date.now() + budget;
    const cssAssets = collectVisibleCssImageAssets(metrics.crop);
    const cssAuditPromise = auditVisibleCssImageAssets(cssAssets, deadline);
    const seen = new Set();
    // Two bounded passes catch images inserted by an SPA while the first visible
    // image batch is loading. Each pass shares one deadline across the visible
    // HTML images, CSS-image verification, and font readiness.
    for (let pass = 0; pass < 2; pass++) {
      try { metrics = currentMetrics(); } catch (_) { break; }
      const visible = pageImages().filter(img => intersectsViewportForImage(img, metrics.crop)).slice(0, 1800);
      visible.forEach(img => {
        seen.add(img);
        if (state && state.imageAudit) state.imageAudit.seenHtmlImages.add(img);
        promoteLazyImage(img);
      });
      const remaining = Math.max(0, deadline - Date.now());
      if (remaining > 0) {
        await Promise.all(visible.map(async img => {
          const perImageWait = Math.min(remaining, 5000);
          if (!img.complete) await waitForImage(img, perImageWait);
          if (img.complete && img.naturalWidth > 0) {
            const decoded = await waitForDecode(img, Math.min(2500, Math.max(0, deadline - Date.now())));
            if (state && state.imageAudit && decoded === false) state.imageAudit.decodeFailures.add(img);
            else if (state && state.imageAudit && decoded === true) state.imageAudit.decodeFailures.delete(img);
          }
        }));
        await waitForVisibleFonts(Math.max(0, deadline - Date.now()));
      }
      await afterPaint();
      const after = pageImages().filter(img => intersectsViewportForImage(img, metrics.crop)).slice(0, 1800);
      const hasNewVisibleImages = after.some(img => !seen.has(img));
      after.forEach(img => {
        seen.add(img);
        if (state && state.imageAudit) state.imageAudit.seenHtmlImages.add(img);
      });
      if (!hasNewVisibleImages || Date.now() >= deadline) break;
    }
    const brokenImageNodes = [...seen].filter(img => {
      const source = imageDeclaredSource(img);
      return source && (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0 || (state && state.imageAudit && state.imageAudit.decodeFailures.has(img)));
    });
    if (state && state.imageAudit) brokenImageNodes.forEach(img => state.imageAudit.incompleteHtmlImages.add(img));
    const brokenImages = brokenImageNodes.map(img => safeAssetLabel('HTML img', imageDeclaredSource(img))).slice(0, 12);
    const cssAudit = await cssAuditPromise;
    return {
      brokenImages,
      cssImageFailures: cssAudit.failures.slice(0, 12),
      auditWarnings: cssAudit.warnings,
      auditSummary: imageAuditSummary()
    };
  }

  async function waitForSettle(waitMs) {
    await afterPaint();
    await sleep(Math.max(80, Math.min(400, Math.floor(waitMs * 0.25))));
    await afterPaint();
  }

  function contentFingerprint() {
    const root = state && state.scrollerType === 'inner' && state.scroller && state.scroller.isConnected
      ? state.scroller : document.body || document.documentElement;
    if (!root) return '';
    const text = String(root.textContent || '').replace(/\s+/g, ' ');
    return [root.scrollHeight || 0, root.childElementCount || 0, pageImages().length, text.length,
      text.slice(0, 300), text.slice(-300)].join('|');
  }

  async function preloadPage(settings) {
    const warnings = [];
    const start = Date.now();
    const maxMs = 22000;
    if (settings.autoLoadMore) {
      let stagnantRounds = 0;
      for (let round = 0; round < 14 && Date.now() - start < 14000; round++) {
        throwIfCancelled();
        const before = currentMetrics();
        const fingerprintBefore = contentFingerprint();
        if (before.pageH >= settings.maxHeight) {
          warnings.push('Auto-load reached the configured maximum capture height.');
          break;
        }
        // Long chat interfaces commonly load older messages when the main pane
        // reaches the top, whereas feeds usually append content at the bottom.
        const atInnerTop = before.scrollerType === 'inner' && round % 2 === 0;
        setScroll(0, atInnerTop ? 0 : Math.max(0, before.pageH - before.captureH));
        await waitForSettle(Math.min(settings.waitMs, 1200));
        throwIfCancelled();
        await waitForVisibleImages(Math.min(settings.waitMs, 1200));
        throwIfCancelled();
        const after = currentMetrics();
        const fingerprintAfter = contentFingerprint();
        const growth = after.pageH - before.pageH;
        const contentChanged = fingerprintAfter !== fingerprintBefore;
        if (growth < 120 && !contentChanged) stagnantRounds++; else stagnantRounds = 0;
        // Two idle rounds are not enough on virtualized chats: the scrollHeight
        // can stay constant while older/newer turns are swapped into the DOM.
        // Keep sampling until four consecutive top/bottom visits show no change.
        if (stagnantRounds >= 4) break;
      }
      if (Date.now() - start >= 14000) warnings.push('Auto-load preparation stopped at its time limit.');
    }
    if (settings.prepareImages) {
      let m = currentMetrics();
      const ys = G.axisPositions(Math.min(m.pageH, settings.maxHeight), m.captureH, settings.maxHeight, 0.20);
      for (let i = 0; i < ys.length; i++) {
        throwIfCancelled();
        if (Date.now() - start > maxMs) {
          warnings.push('Image preparation reached its time budget; some late-loading content may be absent.');
          break;
        }
        setScroll(0, ys[i]);
        await waitForSettle(Math.min(settings.waitMs, 750));
        throwIfCancelled();
        await waitForVisibleImages(Math.min(settings.waitMs, 500));
        throwIfCancelled();
        if (i % 8 === 0) chrome.runtime.sendMessage({ type: 'PAC_CONTENT_PROGRESS', tabId: settings.tabId, percent: 1, message: `Preparing images (${i + 1}/${ys.length})\u2026` }).catch(() => {});
      }
    }
    throwIfCancelled();
    setScroll(0, 0);
    await waitForSettle(250);
    throwIfCancelled();
    return { warnings, metrics: currentMetrics() };
  }

  function tilePayload(index) {
    const m = currentMetrics();
    return {
      index,
      tileX: m.tileX,
      tileY: m.tileY,
      tileW: m.captureW,
      tileH: m.captureH,
      cropX: m.crop.x,
      cropY: m.crop.y,
      viewportW: m.viewportW,
      viewportH: m.viewportH,
      pageW: m.pageW,
      pageH: m.pageH
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Runtime messages are broadcast to extension contexts. The page script must
    // ignore stitcher/progress/control messages it does not own, or it can race
    // the intended listener and return a spurious error response.
    if (!message || !P || !P.isPageCommand(message.type)) return;
    (async () => {
      if (message.type === 'PAC_VISIBLE_INFO') {
        return {
          ok: true,
          metrics: {
            pageW: window.innerWidth, pageH: window.innerHeight,
            captureW: window.innerWidth, captureH: window.innerHeight,
            viewportW: window.innerWidth, viewportH: window.innerHeight,
            scrollerType: 'root', title: document.title, url: location.href
          }
        };
      }
      if (message.type === 'PAC_PREPARE') {
        if (state) restoreAll();
        const settings = message.settings || {};
        const target = ['auto', 'document', 'panel'].includes(settings.captureTarget) ? settings.captureTarget : 'auto';
        const preset = target === 'document' ? null : detectPreset();
        const inner = target === 'document' ? null : ((preset && preset.scroller) || getInnerScroller(target === 'panel'));
        if (target === 'auto' && !inner && lastPanelSelectionIssue && rootMetrics().pageH <= window.innerHeight + 220) {
          throw new Error(`${lastPanelSelectionIssue} The document itself does not scroll enough to capture the hidden content. Scroll the app until the conversation panel begins within the viewport, or choose Panel after repositioning it.`);
        }
        if (target === 'panel' && !inner) {
          throw new Error('No suitable main scrollable panel was detected. Select Smart or Document, or enlarge the browser window and retry.');
        }
        state = {
          settings,
          captureTarget: target,
          presetTurns: preset ? preset.turns : null,
          scroller: inner,
          scrollerType: inner ? 'inner' : 'root',
          originalX: inner ? inner.scrollLeft : window.scrollX,
          originalY: inner ? inner.scrollTop : window.scrollY,
          outerOriginalX: Number(window.scrollX) || 0,
          outerOriginalY: Number(window.scrollY) || 0,
          scrollerAnchor: null, scrollerBaseTranslate: null, scrollerAnchorOffset: { x: 0, y: 0 },
          inlineSnapshots: [], tempStyle: null,
          imageLoadingSnapshots: new Map(), imageNodes: new Set(), imageObservers: [], imageRoots: [], seenImageRoots: new WeakSet(),
          imageAudit: {
            seenHtmlImages: new Set(), incompleteHtmlImages: new Set(), decodeFailures: new Set(), cssAssetsSeen: new Set(), cssAssetLabels: new Map(),
            cssAssetResults: new Map(), timedOutCssAssets: new Set(), limitHit: false, imageSetUnverified: false
          },
          pinned: [], hiddenPinnedElements: new Set(), pinnedHidden: false, cancelled: false
        };
        const renderEngine = settings.engine === 'render';
        state.renderEngine = renderEngine;
        state.hideFloating = settings.hideFloating !== false;
        prepareStyles();
        let expandWarning = null;
        if (settings.expandContent !== false) {
          const ex = await expandCollapsed();
          await waitForSettle(250);
          if (ex.details || ex.clamps || ex.clicks) {
            expandWarning = `Expanded collapsed content (${[ex.clicks && `${ex.clicks} \u201cshow more\u201d button${ex.clicks === 1 ? '' : 's'}`, ex.details && `${ex.details} folded section${ex.details === 1 ? '' : 's'}`, ex.clamps && `${ex.clamps} truncated text block${ex.clamps === 1 ? '' : 's'}`].filter(Boolean).join(', ')}).${ex.clicks ? ' Clicked buttons stay expanded on the page after capture.' : ''}`;
          }
        }
        // The render engine resizes the emulated viewport instead of shrinking a
        // clipped panel to its visible part, so skip normalization there.
        if (inner && !renderEngine) await normalizeInnerScroller();
        observePageImages();
        // Start from a deterministic origin, regardless of where the user was
        // reading. The original offsets are restored when capture ends.
        setScroll(0, 0);
        await waitForSettle(120);
        throwIfCancelled();
        state.pinned = detectPinnedElements();
        let warnings = [];
        // Record the anchor BEFORE any programmatic preparation scroll. Some app
        // shells react to scrolling by collapsing a header or translating an outer
        // container. Recording the anchor after preload would bake that shifted
        // position into the baseline; later tile checks then see a permanent crop
        // offset (e.g. +152px) and cannot correct it. Keep the initial, normalized
        // viewport position as the reference, then re-anchor after preparation and
        // each tile's image settling before reporting tile coordinates.
        if (inner) recordScrollerAnchor();
        // In render mode an inner panel is grown until all of it is on screen,
        // which triggers lazy loaders natively; a scroll pre-pass is only needed
        // for the document (and for explicit auto-load of chat history).
        const needsPreload = renderEngine && inner ? settings.autoLoadMore : (settings.prepareImages || settings.autoLoadMore);
        if (needsPreload) {
          const result = await preloadPage(settings);
          warnings = result.warnings;
        }
        // Preparation may have caused the app shell to move. Return to the
        // captured baseline before calculating the geometry used to plan tiles.
        if (inner) await stabilizeInnerScroller();
        const metrics = currentMetrics();
        if (expandWarning) warnings = [expandWarning, ...warnings];
        // Document target on an app shell: report how much a scroll panel
        // hides, so the worker can say the capture is only the shell. Text
        // clipped inside the panel does not count as ink, so the ink extent
        // alone misses this (Claude incognito, 2026-10).
        let panelHidden = 0;
        if (target === 'document') {
          const panel = getInnerScroller(true);
          if (panel) panelHidden = Math.max(0, panel.scrollHeight - panel.clientHeight);
        }
        return { ok: true, metrics, warnings, pinnedCount: state.pinned.length, preset: preset ? preset.name : null, panelHidden };
      }
      if (message.type === 'PAC_SET_TILE') {
        if (!state) throw new Error('The page capture session is not active.');
        throwIfCancelled();
        setScroll(message.x, message.y);
        await waitForSettle(message.waitMs || 800);
        throwIfCancelled();
        // Scroll-and-stitch (Lite, and the Full fallback) hides the same
        // floating UI as Full render: chat composers inside or over the panel,
        // floating buttons, bottom bars. Before this the first tile kept them,
        // drawn over the first screen of content. Checked on every tile: a
        // sticky bar near the end of a chat (ChatGPT's disclaimer) only pins
        // to the panel bottom once the end scrolls into view.
        if (state.hideFloating && !state.renderEngine) renderHideFloating();
        if (Number(message.index) > 0) hidePinnedOnLaterTiles();
        const imageAudit = await waitForVisibleImages(message.waitMs || 800);
        throwIfCancelled();
        // Image decode and app-level scroll handlers can move an inner panel even
        // after the scroll settles. Re-anchor after image checks and one more paint
        // before reporting the tile's page coordinates to the stitcher.
        await stabilizeInnerScroller();
        await afterPaint();
        await stabilizeInnerScroller();
        throwIfCancelled();
        return {
          ok: true, tile: tilePayload(message.index), metrics: currentMetrics(),
          brokenImages: imageAudit.brokenImages,
          cssImageFailures: imageAudit.cssImageFailures,
          auditWarnings: imageAudit.auditWarnings,
          auditSummary: imageAudit.auditSummary
        };
      }
      if (message.type === 'PAC_RENDER_MEASURE') {
        if (!state) throw new Error('The page capture session is not active.');
        renderFreeEndSpacers();
        return { ok: true, measure: renderMeasure() };
      }
      if (message.type === 'PAC_RENDER_VH_SNAPSHOT') {
        if (!state) throw new Error('The page capture session is not active.');
        setScroll(0, 0);
        await afterPaint();
        return { ok: true, count: renderVhSnapshot() };
      }
      if (message.type === 'PAC_RENDER_VH_PIN') {
        if (!state) throw new Error('The page capture session is not active.');
        await afterPaint();
        const pinned = await renderVhPin(message.delta);
        await waitForSettle(150);
        return { ok: true, pinned, measure: renderMeasure() };
      }
      if (message.type === 'PAC_COLLECT_TEXT') {
        if (!state) throw new Error('The page capture session is not active.');
        const { runs, links, marks } = collectTextRuns(message.maxWords || 120000);
        const r1 = v => Math.round(v * 10) / 10;
        // Compact encoding keeps the message small: runs [x, y, w, h, fontSize, text];
        // links [x, y, w, h, href] or [x, y, w, h, '', destX, destY]; marks [x, y, level, title].
        return {
          ok: true,
          links: links.map(l => l.map(v => typeof v === 'number' ? r1(v) : v)),
          marks: marks.map(m => [r1(m[0]), r1(m[1]), m[2], m[3]]),
          runs: runs.map(r => [r1(r.x), r1(r.y), r1(r.w), r1(r.h), r1(r.fs), r.text])
        };
      }
      if (message.type === 'PAC_INK_BANDS') {
        if (!state) throw new Error('The page capture session is not active.');
        return { ok: true, ...inkBands() };
      }
      if (message.type === 'PAC_RENDER_TRIM_END') {
        if (!state) throw new Error('The page capture session is not active.');
        const hidden = renderTrimDocumentEnd();
        await waitForSettle(150);
        return { ok: true, hidden, measure: renderMeasure() };
      }
      if (message.type === 'PAC_RENDER_PIN') {
        if (!state) throw new Error('The page capture session is not active.');
        const pinned = renderPinPanel();
        await waitForSettle(200);
        return { ok: true, pinned, measure: renderMeasure() };
      }
      if (message.type === 'PAC_RENDER_SETTLE') {
        if (!state) throw new Error('The page capture session is not active.');
        throwIfCancelled();
        setScroll(0, 0);
        await waitForSettle(message.waitMs || 800);
        let lateExpanded = 0;
        if (state.settings.expandContent !== false) {
          lateExpanded = await clickExpanders();
          if (lateExpanded) await waitForSettle(400);
        }
        const hidden = message.hideFloating === false ? 0 : renderHideFloating();
        const audit = await waitForVisibleImages(message.imageWaitMs || message.waitMs || 800);
        await afterPaint();
        throwIfCancelled();
        return {
          ok: true, hidden, lateExpanded, measure: renderMeasure(),
          hiddenExamples: [...(state.hiddenExamples || [])], hiddenCapReached: !!state.hiddenCapReached,
          brokenImages: audit.brokenImages,
          cssImageFailures: audit.cssImageFailures,
          auditWarnings: audit.auditWarnings,
          auditSummary: audit.auditSummary
        };
      }
      if (message.type === 'PAC_CANCEL_PREPARE') {
        if (state) state.cancelled = true;
        return { ok: true };
      }
      if (message.type === 'PAC_RESTORE') {
        restoreAll();
        // Scroll-triggered application-shell listeners are dispatched asynchronously
        // in Chromium. Allow the page one paint after restoring the original offsets
        // so responsive/collapsible shells can return to their own resting state too.
        await afterPaint();
        await sleep(40);
        return { ok: true };
      }
      throw new Error(`Unknown page command: ${message.type}`);
    })().then(sendResponse).catch(error => sendResponse({ ok: false, error: error && error.message ? error.message : String(error) }));
    return true;
  });
})();
