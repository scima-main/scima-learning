'use strict';
/* ═══════════════════════════════════════════════════════════════
   translate-shared.js — Define/Translate/Pinyin primitives shared by
   content.js (runs on arbitrary web pages) and the dashboard-*.js files (run
   as the extension's own tab). These two execution contexts can't share
   modules via import/export, but they CAN both load the same plain
   script: content.js gets it as an extra content-script file (see
   manifest.json's content_scripts.js order), dashboard.html loads it
   with a <script> tag before dashboard-core.js (which is where defineTerm(),
   the function that actually calls translateText/fetchPinyin, lives).

   This used to be two independently-maintained copies that had
   drifted slightly apart (the dashboard's fetchPinyin had a stricter,
   less false-positive-prone pattern match than content.js's) — this
   file keeps the stricter version as the single source of truth.

   Both endpoints used below are unofficial (translate.googleapis.com,
   api.dictionaryapi.dev) and could change/break without notice —
   there's no official free alternative without an API key, so keep
   the try/catch fallbacks at each call site intact.
═══════════════════════════════════════════════════════════════ */

// Common language names for display purposes (codes match Google Translate / dictionaryapi.dev)
const LANGS = { en:'English', es:'Spanish', fr:'French', de:'German', it:'Italian', pt:'Portuguese',
  nl:'Dutch', ru:'Russian', ja:'Japanese', ko:'Korean', 'zh-CN':'Chinese', ar:'Arabic', hi:'Hindi',
  pl:'Polish', tr:'Turkish' };

// Detects the source language of `text` and translates it into `targetLang`, via
// Google's public (key-free) translate endpoint. No extra host permissions needed —
// the extension already has <all_urls> access.
async function translateText(text, targetLang) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  const data = await res.json();
  const translated = (data[0] || []).map(seg => seg[0]).join('');
  const sourceLang = typeof data[2] === 'string' ? data[2] : targetLang;
  return { translated, sourceLang };
}

// Best-effort Mandarin pinyin lookup via the same (undocumented) translate endpoint's
// romanization flag. Because the exact response shape isn't officially documented and
// can change, this scans the whole response for a string that looks like pinyin
// (Latin letters + tone diacritics) rather than trusting one hardcoded array index —
// if nothing matching is found, it returns null and the caller just skips pinyin.
async function fetchPinyin(term) {
  // dt=rm asks Google to return romanisation (pinyin for zh-CN).
  // Response shape: data[0] is an array of segments, each segment is
  //   [translatedSegment, originalSegment, null, pinyinSegment, ...]
  // so pinyin for segment i lives at data[0][i][3].
  // We also do a full-tree walk as fallback since the shape isn't guaranteed.
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=en&dt=t&dt=rm&q=${encodeURIComponent(term)}`;
  const res = await fetch(url);
  const data = await res.json();
  const pinyinRe = /^[\u0101\u00e1\u01ce\u00e0\u0113\u00e9\u011b\u00e8\u012b\u00ed\u01d0\u00ec\u014d\u00f3\u01d2\u00f2\u016b\u00fa\u01d4\u00f9\u01d6\u01d8\u01da\u01dc\u00fc\u00dca-zA-Z\d\s']+$/;
  const hasDiacritic = /[\u0101\u00e1\u01ce\u00e0\u0113\u00e9\u011b\u00e8\u012b\u00ed\u01d0\u00ec\u014d\u00f3\u01d2\u00f2\u016b\u00fa\u01d4\u00f9\u01d6\u01d8\u01da\u01dc\u00fc]/;
  // Try known positions first (data[0][i][3])
  if (Array.isArray(data[0])) {
    const parts = data[0].map(seg => (Array.isArray(seg) && typeof seg[3] === 'string') ? seg[3].trim() : '').filter(Boolean);
    if (parts.length) return parts.join(' ');
  }
  // Fallback: walk entire subtree for anything pinyin-looking
  let found = null;
  (function walk(node) {
    if (found) return;
    if (typeof node === 'string') {
      const s = node.trim();
      if (s && s !== term && pinyinRe.test(s) && hasDiacritic.test(s)) found = s;
    } else if (Array.isArray(node)) node.forEach(walk);
  })(data);
  return found;
}

// Export for Node's test runner — no-op in the browser/content-script contexts this
// file normally loads in (`module` is undefined there). See shared.js for the same
// pattern.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LANGS, translateText, fetchPinyin };
}
