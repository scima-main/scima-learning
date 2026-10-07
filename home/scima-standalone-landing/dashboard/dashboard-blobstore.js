'use strict';
/* dashboard-blobstore.js — NEW file, not part of the extension build.

   Phase 0 Steps 2-3 from the port plan: the chunked-binary-blob seam and
   the bundled-asset-URL seam, both currently inlined as direct
   chrome.storage.local / chrome.runtime.getURL calls throughout
   dashboard-decks.js (saveHtmlChapters/loadHtmlChapters/deleteHtmlChapters/
   writePdfChunks/exportAllDataZip/exportSourceWithBookmarks/the PDF text
   extractor's pdf.js loader).

   Load this BEFORE dashboard-decks.js (which calls blobStore methods and
   assetUrl() instead of touching chrome.storage.local/chrome.runtime.getURL directly
   in this build) and AFTER dashboard-core.js (uses isExtension). See
   dashboard.html's script order.

   blobStore stores each chunk set as one JSON array under a single
   localStorage key (localStorage has no per-item chunking limit the way
   chrome.storage.local's 8MB-per-set()-call quota does — see the comment
   above the extension's saveHtmlChapters — so chunking itself is no longer
   necessary here), but the get/set/delete *shape* below still matches the
   extension's chunk-count + indexed-keys pattern so dashboard-decks.js's
   call sites don't need to change, only what they call. */

const blobStore = {
  async setChunks(prefix, id, str) {
    if (isExtension) {
      const CHUNK = 3 * 1024 * 1024;
      const chunks = Math.ceil(str.length / CHUNK);
      try {
        await new Promise(res => chrome.storage.local.set({ [`${prefix}_chunks_${id}`]: chunks }, res));
        for (let i = 0; i < chunks; i++) {
          await new Promise(res => chrome.storage.local.set({ [`${prefix}_${id}_${i}`]: str.slice(i * CHUNK, (i + 1) * CHUNK) }, res));
        }
        return;
      } catch (e) { console.warn(`[SCIMA] chrome.storage.local ${prefix} chunk write failed, falling back to localStorage:`, e); }
    }
    try { localStorage.setItem(`${prefix}_blob_${id}`, str); }
    catch (e) { console.error(`[SCIMA] localStorage ${prefix} blob write failed — data was NOT saved:`, e); }
  },

  async getChunks(prefix, id) {
    if (isExtension) {
      try {
        const cr = await new Promise(res => chrome.storage.local.get(`${prefix}_chunks_${id}`, res));
        const count = cr[`${prefix}_chunks_${id}`];
        if (!count) return null;
        const keys = Array.from({ length: count }, (_, i) => `${prefix}_${id}_${i}`);
        const parts = await new Promise(res => chrome.storage.local.get(keys, res));
        return keys.map(k => parts[k] || '').join('');
      } catch (e) { console.warn(`[SCIMA] chrome.storage.local ${prefix} chunk read failed:`, e); return null; }
    }
    try { return localStorage.getItem(`${prefix}_blob_${id}`); }
    catch (e) { console.warn(`[SCIMA] localStorage ${prefix} blob read failed:`, e); return null; }
  },

  async deleteChunks(prefix, id) {
    if (isExtension) {
      try {
        const cr = await new Promise(res => chrome.storage.local.get(`${prefix}_chunks_${id}`, res));
        const count = cr[`${prefix}_chunks_${id}`] || 0;
        const keys = [`${prefix}_chunks_${id}`, ...Array.from({ length: count }, (_, i) => `${prefix}_${id}_${i}`)];
        chrome.storage.local.remove(keys);
        return;
      } catch (e) { console.warn(`[SCIMA] chrome.storage.local ${prefix} chunk cleanup failed — orphaned keys may remain:`, e); }
    }
    try { localStorage.removeItem(`${prefix}_blob_${id}`); }
    catch (e) { console.warn(`[SCIMA] localStorage ${prefix} blob cleanup failed:`, e); }
  },
};

// chrome.runtime.getURL('lib/pdf.min.js') resolver equivalent — on the
// extension this resolves relative to the extension root; on the site it
// resolves relative to the current page's own URL (document.baseURI — none
// of the site pages set a <base>, so that's just the page URL). Deliberately
// NOT domain-root-relative ('/lib/…'): the site isn't guaranteed to be served
// from the domain root — the FastAPI backend mounts this folder at
// /dashboard/ (backend/app/main.py), and a root-relative path would escape
// that mount and 404, breaking the lazy pdf.js load. Relative resolution is
// identical to the old behavior when the site IS at the domain root, and
// stays inside the mount when it isn't. All site pages live at the landing
// folder's root, so 'lib/…' resolves to the same place from every page.
function assetUrl(path) {
  if (isExtension) return chrome.runtime.getURL(path);
  return new URL(path, document.baseURI).href;
}
