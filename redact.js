/* Share-safe Redact: dependency-free secret detectors over the text runs the
   Full render engine collects, shared by the stitcher and Node tests.
   Detection only sees text the page exposes in the DOM; text drawn inside
   images or canvases is invisible to it, and the user is told so. */
(function (root) {
  'use strict';

  const LABELS = { email: 'email', phone: 'phone number', card: 'card number', iban: 'IBAN', key: 'key or token', ip: 'IP address', url: 'URL with a token', word: 'listed word', id: 'ID number', upi: 'UPI ID' };

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

  // The left guard keeps words such as "risk-assessment" from reading as an
  // sk- key. A JWT may have a short (or empty) signature part.
  const KEY_PREFIXES = /(?<![A-Za-z0-9])(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abposr]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|glpat-[A-Za-z0-9_-]{20,}|SG\.[\w-]{16,}\.[\w-]{16,}|npm_[A-Za-z0-9]{30,}|hf_[A-Za-z0-9]{30,}|ya29\.[\w-]{20,}|whsec_[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{30,}|dop_v1_[a-f0-9]{40,}|shp(?:at|ss|ca|pa)_[a-fA-F0-9]{32}|eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g;
  // A parameter name may carry a prefix (refresh_token, client_secret,
  // X-Amz-Signature), so the name is matched after ?, &, # or ; and an
  // optional word ending in _ or -.
  const TOKEN_PARAM = /https?:\/\/[^\s?#]+[?#](?:\S*?[&;#])?(?:[\w.-]*[_-])?(?:token|access_token|id_token|api_?key|key|auth|sig|signature|secret|password|pwd|code|session|sid|credential|jwt|otp|bearer|csrf)=[^\s&#]+\S*/gi;
  // Credentials inside an address: https://user:pass@host, postgres://u:p@h/db.
  const URL_CREDENTIALS = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@[^\s]+/gi;
  // A value written after a secret label: "password: hunter2", "OTP=482913".
  const LABELLED_SECRET = /\b(?:password|passwd|pwd|passcode|pin|secret|api[_ -]?key|access[_ -]?key|token|otp|cvv|cvc|security code|recovery code|client secret)\s*[:=]\s*(\S{4,64})/gi;
  // UPI ids have no dot after the @ (name@okaxis), so the email rule misses them.
  const UPI = /(?<![\w.-])[a-z0-9._-]{2,64}@(?:oksbi|okhdfcbank|okicici|okaxis|ybl|ibl|axl|paytm|upi|apl|sbi|hdfcbank|icici|axisbank|pnb|fbl|ikwik|airtel|jio|slice|freecharge)(?![\w.])/gi;
  const CARD_IIN = /^(?:4|5[1-5]|2(?:2[2-9]|[3-6]\d|7[01]|720)|3[47]|3(?:0[0-5]|[689])|6011|64[4-9]|65|35|60|62|81|82|508)/;

  // Verhoeff checksum, used by Aadhaar numbers.
  const VD = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
  const VP = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
  function verhoeff(digits) {
    let c = 0;
    const d = String(digits).split('').reverse();
    for (let i = 0; i < d.length; i++) c = VD[c][VP[i % 8][Number(d[i])]];
    return c === 0;
  }

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
    each(URL_CREDENTIALS, m => add(m.index, m.index + m[0].length, 'key'));
    each(UPI, m => add(m.index, m.index + m[0].length, 'upi'));
    each(LABELLED_SECRET, m => {
      const v = m[1];
      // Masked or placeholder values are not secrets.
      if (/^(.)\1*$/.test(v) || /^[*\u2022.]+$/.test(v) || /^(?:required|hidden|optional|none|null|undefined|is|was|must|should)\b/i.test(v)) return;
      const at = m.index + m[0].length - v.length;
      add(at, at + v.length, 'key');
    });
    each(/(?<![\w-])Bearer\s+[A-Za-z0-9._~+/=-]{16,}/g, m => add(m.index, m.index + m[0].length, 'key'));
    each(/(?<!\d)[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?![\d])/g, m => {
      if (verhoeff(m[0].replace(/\D/g, ''))) add(m.index, m.index + m[0].length, 'id');
    });
    each(/(?<![A-Za-z0-9])[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z](?![A-Za-z0-9])/g, m => add(m.index, m.index + m[0].length, 'id'));
    each(/-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/g, m => add(m.index, m.index + m[0].length, 'key'));
    // Long random-looking tokens without a known prefix.
    // "=" only as trailing padding: NAME=value settings are two words.
    each(/[A-Za-z0-9_\-+/]{24,}={0,2}/g, m => {
      const t = m[0];
      const hex = /^[0-9a-fA-F]+$/.test(t);
      // Hex needs 32+ chars; other tokens need upper, lower and digits, so
      // file names like application-for-payment-002-summary stay readable.
      if (hex ? t.length < 32 || !/[0-9]/.test(t) || !/[a-fA-F]/.test(t) : !/[0-9]/.test(t) || !/[a-z]/.test(t) || !/[A-Z]/.test(t)) return;
      // A commit id or checksum on a code page is not a secret.
      if (hex && [32, 40, 64].includes(t.length) && /(?:commit|sha\d*|hash|checksum|md5|digest|@|\/commit\/|\/blob\/|\/tree\/)\W{0,3}$/i.test(text.slice(Math.max(0, m.index - 24), m.index))) return;
      if (entropy(t) >= (hex ? 3.0 : 3.6)) add(m.index, m.index + t.length, 'key');
    });
    each(/(?<![\w])(?:\d[ -]?){12,40}\d(?![\w])/g, m => {
      const digits = m[0].replace(/\D/g, '');
      const isCard = d => d.length >= 13 && d.length <= 19 && CARD_IIN.test(d) && luhn(d);
      if (isCard(digits)) { add(m.index, m.index + m[0].length, 'card'); return; }
      // Other digits before or after the card ("Ref 20261028 4111 ...")
      // join the run; look for a valid card inside it.
      const pos = [];
      for (let i = 0; i < m[0].length; i++) if (/\d/.test(m[0][i])) pos.push(i);
      for (let len = Math.min(19, digits.length - 1); len >= 13; len--) {
        for (let i = 0; i + len <= digits.length; i++) {
          if (isCard(digits.slice(i, i + len))) { add(m.index + pos[i], m.index + pos[i + len - 1] + 1, 'card'); return; }
        }
      }
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
    each(/(?<![\w.])(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}(?![\w.]*\d)/g, m => {
      // "Version 10.2.3.4" and "build 1.0.0.12" are versions, not addresses.
      if (/(?:\bv|version|ver|build|release|chrome|firefox|edge|safari)\s*$/i.test(text.slice(Math.max(0, m.index - 12), m.index))) return;
      add(m.index, m.index + m[0].length, 'ip');
    });
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
    // Large type has glyph ink (italic overhang, descenders) beyond its
    // line box, so the margin grows with the font size.
    const padOf = fs => Math.max(pad, Math.round((Number(fs) || 16) * 0.12));
    for (const run of runs || []) {
      // A shadow run is a later line of a wrapped word: boxed when its word
      // is a secret, never written to the PDF text (the first piece is).
      if (run[7]) {
        const hits = findSecrets(run[5], words);
        if (hits.length) { const p = padOf(run[4]); boxes.push([run[0] - p, run[1] - p, run[2] + p * 2, run[3] + p * 2, hits[0].kind]); }
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
      const pad = padOf(fs);
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

  // A hidden word also hides any token that contains it ("Priya's",
  // "priya.sharma", "Priya-Sharma"): over-scrubbing a title is the safe side.
  function containsHidden(text, hidden) {
    const low = String(text || '').toLowerCase();
    for (const w of hidden || []) if (w.length >= 4 && low.includes(w)) return true;
    return false;
  }

  function scrubWords(text, hidden) {
    if (!hidden || !hidden.size) return String(text || '');
    return String(text || '').split(/(\s+)/).map(t => /^\s*$/.test(t) ? t : (hidden.has(normWord(t)) || containsHidden(t, hidden) || leakedWord([t], hidden)) ? '[redacted]' : t).join('');
  }

  // Last check before saving: returns the first hidden word still present in
  // any of the given strings (title, subject, file name, bookmarks, link
  // addresses), or null. These carry no position, so a box cannot cover them.
  function leakedWord(strings, hidden) {
    if (!hidden || !hidden.size) return null;
    for (const s of strings || []) {
      for (const t of String(s || '').split(/[\s/?&=#._-]+/)) {
        const key = normWord(t);
        if (key.length >= 2 && hidden.has(key)) return key;
      }
    }
    return null;
  }

  function redactString(text, words) {
    const s = String(text || '');
    const hits = findSecrets(s, words);
    let res = '', at = 0;
    for (const hit of hits) { res += s.slice(at, hit.start) + '[redacted]'; at = hit.end; }
    return { text: res + s.slice(at), count: hits.length };
  }

  function summary(counts) {
    const plural = { key: 'keys or tokens', url: 'URLs with a token', phone: 'phone numbers', card: 'card numbers', ip: 'IP addresses', word: 'listed words', id: 'ID numbers', upi: 'UPI IDs' };
    return Object.keys(counts).map(k => `${counts[k]} ${counts[k] === 1 ? (LABELS[k] || k) : (plural[k] || `${LABELS[k] || k}s`)}`).join(', ');
  }

  const api = { findSecrets, redactRuns, stripRunsUnder, hiddenWords, containsHidden, leakedWord, scrubWords, redactString, parseWordList, summary, luhn, ibanValid, entropy };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PageArchiveRedact = api;
})(globalThis);
