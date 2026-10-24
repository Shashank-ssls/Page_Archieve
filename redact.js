/* Share-safe Redact: dependency-free secret detectors over the text runs the
   Full render engine collects, shared by the stitcher and Node tests.
   Detection only sees text the page exposes in the DOM; text drawn inside
   images or canvases is invisible to it, and the user is told so. */
(function (root) {
  'use strict';

  const LABELS = { email: 'email', phone: 'phone number', card: 'card number', iban: 'IBAN', key: 'key or token', ip: 'IP address', url: 'URL with a token', word: 'listed word' };

  function luhn(digits) {
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = digits.charCodeAt(digits.length - 1 - i) - 48;
      if (i % 2) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
    }
    return sum % 10 === 0;
  }

  // ISO 13616 check: move the first four characters to the end, letters to
  // numbers (A = 10), and the result mod 97 must be 1.
  function ibanValid(raw) {
    const s = raw.replace(/ /g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
    const moved = s.slice(4) + s.slice(0, 4);
    let rest = 0;
    for (const ch of moved) {
      const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
      for (const digit of v) rest = (rest * 10 + (digit.charCodeAt(0) - 48)) % 97;
    }
    return rest === 1;
  }

  function entropy(s) {
    const counts = new Map();
    for (const ch of s) counts.set(ch, (counts.get(ch) || 0) + 1);
    let bits = 0;
    for (const n of counts.values()) { const p = n / s.length; bits -= p * Math.log2(p); }
    return bits;
  }

  const KEY_PREFIXES = /(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abposr]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|glpat-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g;
  const TOKEN_PARAM = /https?:\/\/[^\s?#]+[?#]\S*?\b(?:token|access_token|id_token|api_?key|key|auth|sig|signature|secret|password|pwd|code|session|sid)=[^\s&#]+\S*/gi;

  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Returns [{ start, end, kind }] sorted and merged. `words` is the user's
  // always-redact list (case-insensitive).
  function findSecrets(text, words) {
    const found = [];
    const add = (start, end, kind) => { if (end > start) found.push({ start, end, kind }); };
    const each = (re, fn) => { re.lastIndex = 0; let m; while ((m = re.exec(text))) { fn(m); if (m[0].length === 0) re.lastIndex++; } };

    each(TOKEN_PARAM, m => add(m.index, m.index + m[0].length, 'url'));
    each(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, m => add(m.index, m.index + m[0].length, 'email'));
    each(KEY_PREFIXES, m => add(m.index, m.index + m[0].length, 'key'));
    each(/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, m => add(m.index, m.index + m[0].length, 'key'));
    // Long random-looking tokens without a known prefix.
    // "=" only as trailing padding: NAME=value settings are two words.
    each(/[A-Za-z0-9_\-+/]{24,}={0,2}/g, m => {
      const t = m[0];
      const hex = /^[0-9a-fA-F]+$/.test(t);
      // Hex needs 32+ chars; other tokens need upper, lower and digits, so
      // file names like application-for-payment-002-summary stay readable.
      if (hex ? t.length < 32 || !/[0-9]/.test(t) || !/[a-fA-F]/.test(t) : !/[0-9]/.test(t) || !/[a-z]/.test(t) || !/[A-Z]/.test(t)) return;
      if (entropy(t) >= (hex ? 3.0 : 3.6)) add(m.index, m.index + t.length, 'key');
    });
    each(/(?<![\w])(?:\d[ -]?){12,18}\d(?![\w])/g, m => {
      const digits = m[0].replace(/\D/g, '');
      if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) add(m.index, m.index + m[0].length, 'card');
    });
    each(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g, m => {
      // Trim trailing words the loose pattern swallowed until the check passes.
      let s = m[0];
      while (s.length >= 15 && !ibanValid(s)) s = s.replace(/ ?[A-Z0-9]$/, '');
      if (ibanValid(s)) add(m.index, m.index + s.length, 'iban');
    });
    each(/(?<![\w.])(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,5}\)[ .-]?)?\d{2,5}(?:[ .-]\d{2,5}){1,4}(?![\w])|(?<![\w+])\+?\d{10,13}(?![\w])/g, m => {
      const digits = m[0].replace(/\D/g, '');
      if (digits.length < 9 || digits.length > 15) return;
      // A bare digit run is a phone only with a + or a mobile-like start.
      if (/^\d+$/.test(m[0]) && !/^[6-9]\d{9}$/.test(m[0])) return;
      // Dates and versions (2026-10-24, 1.2.3.4) are not phone numbers.
      if (/^\d{4}-\d{2}-\d{2}/.test(m[0]) || /^\d+(?:\.\d+){2,}$/.test(m[0])) return;
      add(m.index, m.index + m[0].length, 'phone');
    });
    each(/(?<![\w.])(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}(?![\w.]*\d)/g, m => add(m.index, m.index + m[0].length, 'ip'));
    each(/(?<![\w:])(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}(?![\w:])|(?<![\w:])(?:[0-9a-fA-F]{1,4}:){1,6}:(?:[0-9a-fA-F]{1,4}:?){1,6}(?![\w:])/g, m => {
      if ((m[0].match(/[0-9a-fA-F]+/g) || []).length >= 3) add(m.index, m.index + m[0].length, 'ip');
    });
    for (const w of (words || [])) {
      const word = String(w || '').trim();
      if (word.length < 2) continue;
      const pre = /^\w/.test(word) ? '(?<!\\w)' : '';
      const post = /\w$/.test(word) ? '(?!\\w)' : '';
      each(new RegExp(pre + escapeRegex(word) + post, 'gi'), m => add(m.index, m.index + m[0].length, 'word'));
    }

    found.sort((a, b) => a.start - b.start || b.end - a.end);
    const merged = [];
    for (const f of found) {
      const last = merged[merged.length - 1];
      if (last && f.start <= last.end) last.end = Math.max(last.end, f.end);
      else merged.push({ ...f });
    }
    return merged;
  }

  function parseWordList(text) {
    return String(text || '').split(/[,\n]/).map(s => s.trim()).filter(s => s.length >= 2).slice(0, 200);
  }

  // runs: [x, y, w, h, fontSize, text, edges?] where edges holds each word's
  // [start, end] x offset (words are separated by single spaces). Returns the
  // pixel boxes to burn, the runs with redacted words removed, and counts.
  // Runs that sit side by side on one line, in reading order. A page can
  // split one value over several elements (Stripe shows each group of four
  // card digits in its own span, 2026-10), so detection reads a whole line.
  function lineGroups(runs) {
    const groups = [];
    let cur = null;
    for (const run of runs) {
      const [x, y, w, h, fs] = run;
      const last = cur && cur.runs[cur.runs.length - 1];
      const right = last ? last[0] + last[2] : 0;
      if (last && Math.abs(y - last[1]) <= Math.max(2, h * 0.3) && x >= right - 2 && x - right < (fs || 16) * 2) {
        // Touching pieces join without a space ("jane" + "@x.com").
        cur.text += x - right < (fs || 16) * 0.2 ? '' : ' ';
      } else {
        cur = { runs: [], starts: [], text: '' };
        groups.push(cur);
      }
      cur.starts.push(cur.text.length);
      cur.text += run[5];
      cur.runs.push(run);
    }
    return groups;
  }

  function redactRuns(runs, words, pad = 2) {
    const boxes = [];
    const out = [];
    const counts = {};
    const plain = [];
    for (const run of runs || []) {
      // A shadow run is a later line of a wrapped word: boxed when its word
      // is a secret, never written to the PDF text (the first piece is).
      if (run[7]) {
        const hits = findSecrets(run[5], words);
        if (hits.length) boxes.push([run[0] - pad, run[1] - pad, run[2] + pad * 2, run[3] + pad * 2, hits[0].kind]);
      } else plain.push(run);
    }
    for (const group of lineGroups(plain)) {
      const groupHits = findSecrets(group.text, words);
      for (const hit of groupHits) counts[hit.kind] = (counts[hit.kind] || 0) + 1;
      group.runs.forEach((run, k) => {
        const s = group.starts[k], e = s + run[5].length;
        const hits = groupHits.filter(h => h.start < e && h.end > s)
          .map(h => ({ start: Math.max(0, h.start - s), end: Math.min(run[5].length, h.end - s), kind: h.kind }));
        redactOne(run, hits);
      });
    }
    return { boxes, runs: out, counts };

    function redactOne(run, hits) {
      const [x, y, w, h, fs, text, edges] = run;
      if (!hits.length) { out.push([x, y, w, h, fs, text]); return; }
      const list = text.split(' ');
      const ok = Array.isArray(edges) && edges.length === list.length * 2;
      if (!ok) {
        // Without word positions, the whole run is covered and dropped.
        boxes.push([x - pad, y - pad, w + pad * 2, h + pad * 2, hits[0].kind]);
        return;
      }
      const hidden = new Array(list.length).fill(false);
      const kindOf = new Array(list.length).fill('');
      let pos = 0;
      list.forEach((word, i) => {
        const start = pos, end = pos + word.length;
        const hit = hits.find(h => h.start < end && h.end > start);
        if (hit) { hidden[i] = true; kindOf[i] = hit.kind; }
        pos = end + 1;
      });
      let i = 0;
      while (i < list.length) {
        let j = i;
        while (j + 1 < list.length && hidden[j + 1] === hidden[i]) j++;
        const sx = edges[i * 2], ex = edges[j * 2 + 1];
        if (hidden[i]) boxes.push([x + sx - pad, y - pad, ex - sx + pad * 2, h + pad * 2, kindOf[i]]);
        else out.push([x + sx, y, ex - sx, h, fs, list.slice(i, j + 1).join(' ')]);
        i = j + 1;
      }
    }
  }

  // After review the final boxes decide what leaves the PDF text: every word
  // a box touches is removed (a box the user drew too), every word whose
  // suggested box the user turned off stays. Shadow runs never reach the text.
  function stripRunsUnder(runs, boxes) {
    const hit = (x, y, w, h) => (boxes || []).some(b => x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1]);
    const out = [];
    for (const run of runs || []) {
      const [x, y, w, h, fs, text, edges, shadow] = run;
      if (shadow) continue;
      const list = String(text).split(' ');
      if (!(Array.isArray(edges) && edges.length === list.length * 2)) {
        if (!hit(x, y, w, h)) out.push([x, y, w, h, fs, text]);
        continue;
      }
      let i = 0;
      while (i < list.length) {
        const keep = !hit(x + edges[i * 2], y, edges[i * 2 + 1] - edges[i * 2], h);
        let j = i;
        while (j + 1 < list.length && !hit(x + edges[(j + 1) * 2], y, edges[(j + 1) * 2 + 1] - edges[(j + 1) * 2], h) === keep) j++;
        if (keep) out.push([x + edges[i * 2], y, edges[j * 2 + 1] - edges[i * 2], h, fs, list.slice(i, j + 1).join(' ')]);
        i = j + 1;
      }
    }
    return out;
  }

  const normWord = w => String(w).toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

  // The words the final boxes cover, normalised. Bookmarks and the PDF title
  // repeat page text without a position, so they are scrubbed by word.
  function hiddenWords(runs, boxes) {
    const hit = (x, y, w, h) => (boxes || []).some(b => x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1]);
    const out = new Set();
    for (const run of runs || []) {
      const list = String(run[5]).split(' ');
      const edges = run[6];
      list.forEach((word, i) => {
        const covered = Array.isArray(edges) && edges.length === list.length * 2
          ? hit(run[0] + edges[i * 2], run[1], edges[i * 2 + 1] - edges[i * 2], run[3])
          : hit(run[0], run[1], run[2], run[3]);
        const key = normWord(word);
        if (covered && key.length >= 2) out.add(key);
      });
    }
    return out;
  }

  function scrubWords(text, hidden) {
    if (!hidden || !hidden.size) return String(text || '');
    return String(text || '').split(/(\s+)/).map(t => hidden.has(normWord(t)) ? '[redacted]' : t).join('');
  }

  function redactString(text, words) {
    const s = String(text || '');
    const hits = findSecrets(s, words);
    let res = '', at = 0;
    for (const hit of hits) { res += s.slice(at, hit.start) + '[redacted]'; at = hit.end; }
    return { text: res + s.slice(at), count: hits.length };
  }

  function summary(counts) {
    const plural = { key: 'keys or tokens', url: 'URLs with a token', phone: 'phone numbers', card: 'card numbers', ip: 'IP addresses', word: 'listed words' };
    return Object.keys(counts).map(k => `${counts[k]} ${counts[k] === 1 ? (LABELS[k] || k) : (plural[k] || `${LABELS[k] || k}s`)}`).join(', ');
  }

  const api = { findSecrets, redactRuns, stripRunsUnder, hiddenWords, scrubWords, redactString, parseWordList, summary, luhn, ibanValid, entropy };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PageArchiveRedact = api;
})(globalThis);
