'use strict';
/* ═══════════════════════════════════════════════════════════════════
   dashboard-packs.js — the hidden /packs/ route: official deck packs.

   A deliberately thin sibling of the Community tab: no registry, no
   ratings, no uploads. Pack .json files live in the repo at
   <landing>/assets/packs/ (dropped in by hand); the page lists them and
   offers exactly two actions per pack: ➕ Add to Decks (import into local
   state) and ⬇ Download (the raw file).

   Discovery order:
     1. GET {API_BASE}/packs          — backend scans the dir (always fresh)
     2. GET assets/packs/manifest.json — static-hosting fallback (curated)
     3. empty state with a hint
   Accepts every export shape the app already speaks: stamped scima
   envelopes (kind deck/folder/cards), legacy version-2 deck & folder
   exports, bare {name,cards} decks, {decks:[…]} collections.
═══════════════════════════════════════════════════════════════════ */

const PACKS_DIR_REL = 'assets/packs/';

/** Normalize any supported pack payload into {decks, folders} ready for
 *  state, with fresh ids and sanitized everything. Null = unrecognized. */
function importPackData(data) {
  if (!data || typeof data !== 'object') return null;
  let decks = [], folders = [];
  const cls = (typeof scimaClassify === 'function') ? scimaClassify(data) : null;
  if (cls) {                                   // stamped scima envelope
    if (cls.kind === 'deck' || cls.kind === 'cards') {
      const nd = (typeof scimaToFullDeck === 'function') ? scimaToFullDeck(data) : null;
      if (!nd || !Array.isArray(nd.cards)) return null;
      decks.push(nd);
    } else if (cls.kind === 'folder') {
      if (data.folder) folders.push(data.folder);
      folders.push(...(data.subFolders || []));
      decks.push(...(data.decks || []));
    } else return null;
  } else if (data.deck && Array.isArray(data.deck.cards)) {
    decks.push(data.deck);                     // legacy v2 deck export
  } else if (data.folder && Array.isArray(data.decks)) {
    folders.push(data.folder, ...(data.subFolders || []));
    decks.push(...data.decks);                  // legacy v2 folder export
  } else if (Array.isArray(data)) {
    decks.push(...data);                        // bare deck array
  } else if (Array.isArray(data.decks)) {
    decks.push(...data.decks);                  // collection / backup slice
    folders.push(...(data.folders || []));
  } else if (data.name && Array.isArray(data.cards)) {
    decks.push(data);                           // bare single deck
  } else return null;
  if (!decks.length && !folders.length) return null;
  // Dedupe folders by id: folder exports made before the exportFolder
  // subFolders fix carry the root folder in BOTH `folder` and `subFolders`,
  // which would otherwise import as the folder plus an empty twin.
  const seenFolderIds = new Set();
  folders = folders.filter(f => {
    if (!f || !f.id || seenFolderIds.has(f.id)) return false;
    seenFolderIds.add(f.id);
    return true;
  });

  const fmap = {};
  const newFolders = folders.map(f => {
    const nf = sanitizeFolder({ ...f, id: uid('f') });
    fmap[f.id] = nf.id;
    return nf;
  });
  // re-link nested folders through the id remap
  newFolders.forEach(nf => {
    const orig = folders.find(f => fmap[f.id] === nf.id);
    if (orig && orig.parentId) nf.parentId = fmap[orig.parentId] || null;
  });
  const newDecks = decks.map(d => sanitizeDeck({
    ...d,
    id: uid('d'),
    folderId: (d.folderId && fmap[d.folderId]) || null,
    cards: (d.cards || []).map(c => sanitizeCard({ ...c, id: uid('c') })),
  }));
  return { decks: newDecks, folders: newFolders };
}

function commitPackImport(parsed) {
  state.folders.push(...parsed.folders);
  state.decks.push(...parsed.decks);
  scheduleSave();
  if (typeof checkAchievements === 'function') checkAchievements();
  if (typeof renderSidebar === 'function') renderSidebar();
}

async function loadPackList() {
  const apiBase = window.SCIMA_API_BASE || '/api/v1';
  try {
    const r = await fetch(`${apiBase}/packs`);
    if (r.ok) {
      const j = await r.json();
      if (Array.isArray(j.packs)) return { source: 'api', packs: j.packs };
    }
  } catch (e) { /* static hosting / offline → manifest fallback */ }
  try {
    const r = await fetch((window.SCIMA_PAGE?.root || '') + PACKS_DIR_REL + 'manifest.json');
    if (r.ok) {
      const j = await r.json();
      const list = Array.isArray(j) ? j : (Array.isArray(j.packs) ? j.packs : []);
      return { source: 'manifest', packs: list.filter(p => p && p.file) };
    }
  } catch (e) { /* no manifest either */ }
  return { source: 'none', packs: [] };
}

let _packsCache = null;

// -- URL deep links: #packs/<pack> -------------------------------------------
// Same shape as the decks/library deep links (dashboard-core.js's scParseHash /
// scReplaceHash / matchName): the payload segment identifies one pack by its
// file stem ("spanish-starter"), full file name, or display name — resolved
// leniently — and opens that pack's detail modal over the grid. The list is
// fetched async, so the applier runs once the list resolves; the mirror below
// never clobbers a payload it hasn't applied yet.
let _scPacksLastHash = null;
let _openPackFile = null;          // file name of the pack whose detail modal is open

/** Stable URL id for a pack: its file name without the .json suffix. */
function packStem(p) { return String(p?.file || '').replace(/\.json$/i, ''); }

/** Absolute shareable URL for a pack deep link (works from any route/mount). */
function packDeepLink(p) {
  const base = location.origin + location.pathname.replace(/index\.html$/, '');
  return `${base}#packs/${encodeURIComponent(packStem(p))}`;
}

function scPacksApplyHash(packs) {
  const h = (typeof scParseHash === 'function') ? scParseHash() : null;
  if (!h || h.segs[0] !== 'packs') return;
  if (_scPacksLastHash === h.raw) return;
  _scPacksLastHash = h.raw;
  const seg = h.segs[1];
  if (!seg) return;
  const entries = (packs || []).filter(p => p && p.file)
    .map(p => ({ id: packStem(p), name: p.name || p.file, file: p.file, pack: p }));
  const hit = entries.find(e => e.id === seg || e.file === seg)
    || (typeof matchName === 'function' ? matchName(entries, seg) : null);
  if (hit) openPackDetail(hit.pack);
}

// State -> URL mirror (renderView calls window.SCIMA_URL_SYNC.packs right after
// renderPacks — which is BEFORE the async list resolves, so a payload still
// waiting to be applied must be left alone instead of truncated to "#packs").
window.SCIMA_URL_SYNC = window.SCIMA_URL_SYNC || {};
window.SCIMA_URL_SYNC.packs = function () {
  const h = (typeof scParseHash === 'function') ? scParseHash() : null;
  if (h && h.segs[0] === 'packs' && h.segs[1] && _scPacksLastHash !== h.raw) return;
  const open = _openPackFile ? (_packsCache?.packs || []).find(p => p.file === _openPackFile) : null;
  const frag = open ? `packs/${scSeg(packStem(open))}` : 'packs';
  scReplaceHash(frag);
  _scPacksLastHash = frag;
};

/** Adds a pack to local decks (shared by the card button and the detail modal);
 *  returns a short summary string, or throws with a user-readable message. */
async function addPackToLocalDecks(p, b) {
  const href = (window.SCIMA_PAGE?.root || '') + PACKS_DIR_REL + encodeURIComponent(p.file);
  b.disabled = true;
  try {
    const r = await fetch(href);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const parsed = importPackData(await r.json());
    if (!parsed) { showToast('Unrecognized pack format'); return null; }
    commitPackImport(parsed);
    const msg = `Added ${parsed.decks.length} deck${parsed.decks.length > 1 ? 's' : ''}` +
      (parsed.folders.length ? ` + ${parsed.folders.length} folder${parsed.folders.length > 1 ? 's' : ''}` : '') + ' ✓';
    showToast(msg);
    return msg;
  } catch (err) {
    showToast('Could not load pack: ' + ((err && err.message) || err));
    return null;
  } finally { b.disabled = false; }
}

/** Opens the pack's detail modal and mirrors it into the URL hash. Closing the
 *  modal (any route: ×, Esc, backdrop) folds the hash back to #packs — watched
 *  via the backdrop's class flip, the same seam the card-preview overlays use
 *  in dashboard-decks.js. */
function openPackDetail(p) {
  if (!p || !p.file) return;
  _openPackFile = p.file;
  if (typeof scReplaceHash === 'function') {
    const frag = `packs/${scSeg(packStem(p))}`;
    scReplaceHash(frag);
    _scPacksLastHash = frag;
  }
  const href = (window.SCIMA_PAGE?.root || '') + PACKS_DIR_REL + encodeURIComponent(p.file);
  openModal(scLbl('package', p.name || p.file), body => {
    body.appendChild(el('div', { class: 'u-muted-12', style: 'line-height:1.6' },
      p.description || 'No description provided.'));
    body.appendChild(el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;align-items:center' },
      el('span', { class: 'tag', style: 'background:rgba(91,206,250,0.13)' }, p.file),
      p.bytes ? el('span', { class: 'tag', style: 'background:rgba(245,169,184,0.13)' },
        `${Math.max(1, Math.round(p.bytes / 1024))} KB`) : null));
    const contents = el('div', { class: 'u-muted-11', id: 'pack-detail-contents' }, 'Reading pack contents…');
    body.appendChild(contents);
    // Dry-run the real import parser (no state mutation) so the modal shows
    // what the pack actually contains — and surfaces a broken file right here.
    fetch(href).then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(data => {
        const parsed = importPackData(data);
        contents.textContent = parsed
          ? `Contains ${parsed.decks.length} deck${parsed.decks.length !== 1 ? 's' : ''}` +
            `${parsed.folders.length ? ` + ${parsed.folders.length} folder${parsed.folders.length !== 1 ? 's' : ''}` : ''} · ` +
            `${parsed.decks.reduce((n, d) => n + (d.cards?.length || 0), 0)} cards`
          : '⚠ Unrecognized pack format';
      })
      .catch(err => { contents.textContent = '⚠ Could not read pack: ' + ((err && err.message) || err); });
    body.appendChild(el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:4px' },
      btn([scIcon('plus'),' Add to Decks'], 'primary', { onclick: async e => {
        const b = e.currentTarget;
        const msg = await addPackToLocalDecks(p, b);
        if (msg) b.replaceChildren(scIcon('check'), ' Added');
      } }),
      el('a', { class: 'btn btn-ghost', href, download: p.file, style: 'text-decoration:none',
        'aria-label': `Download ${p.name || p.file}` }, [scIcon('download'),' Download']),
      btn([scIcon('link'),' Copy link'], 'ghost', { onclick: async e => {
        const ok = (typeof copyTextToClipboard === 'function') && await copyTextToClipboard(packDeepLink(p));
        showToast(ok ? 'Pack link copied ✓' : 'Copy failed — link: ' + packDeepLink(p), ok ? 2500 : 6000);
        if (ok) e.currentTarget.replaceChildren(scIcon('check'), ' Copied');
      } })));
    body.appendChild(el('div', { class: 'u-muted-11' },
      'Anyone opening this page\'s current link lands straight on this pack.'));
  });
  // Fold the hash back when the modal closes by ANY route (×, Esc, backdrop).
  const backdrop = document.getElementById('modal-backdrop');
  if (backdrop && typeof MutationObserver === 'function') {
    const mo = new MutationObserver(() => {
      if (backdrop.classList.contains('hidden')) {
        mo.disconnect();
        if (_openPackFile === p.file) {
          _openPackFile = null;
          scReplaceHash('packs');
          _scPacksLastHash = 'packs';
        }
      }
    });
    mo.observe(backdrop, { attributes: true, attributeFilter: ['class'] });
  }
}

function renderPacks(c) {
  c.innerHTML = '';
  c.append(
    el('div', { class: 'ui-action-bar', style: 'display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px' },
      el('div', {},
        el('div', { class: 'section-title' }, ' Packs'),
        el('div', { class: 'section-sub' }, 'Official deck packs — add them to your library or download the raw file')),
      makeHelpBtn('What are packs?', () => openModal('Packs', body => {
        body.appendChild(el('div', { style: 'font-size:13px;line-height:1.6' },
          'Packs are .json exports (decks, folders or full collections) dropped into ',
          el('code', {}, 'assets/packs/'), ' in the repo. This page lists them and imports them ',
          'into YOUR browser only — nothing is uploaded, and adding a pack never touches decks you already have.'));
      }), false)),
    el('div', { id: 'packs-status', class: 'u-muted-11', style: 'margin-bottom:12px' }, 'Loading packs…'),
    el('div', { id: 'packs-grid', class: 'grid-2' })
  );
  (_packsCache ? Promise.resolve(_packsCache) : loadPackList()).then(res => {
    _packsCache = res;
    const status = document.getElementById('packs-status');
    const grid = document.getElementById('packs-grid');
    if (!status || !grid) return;
    status.textContent = res.packs.length
      ? `${res.packs.length} pack${res.packs.length > 1 ? 's' : ''} · listed via ${res.source === 'api' ? 'server' : 'manifest'}`
      : 'No packs yet — drop .json exports into assets/packs/ (optionally list them in assets/packs/manifest.json for static hosting).';
    grid.innerHTML = '';
    res.packs.forEach(p => grid.appendChild(packCard(p)));
    // Deep links resolve only once the list exists (API/manifest are async).
    scPacksApplyHash(res.packs);
  });
}

function packCard(p) {
  const href = (window.SCIMA_PAGE?.root || '') + PACKS_DIR_REL + encodeURIComponent(p.file);
  const title = el('div', { role: 'button', tabindex: '0', title: 'View pack details',
    style: 'font-weight:800;font-size:15px;cursor:pointer',
    onclick: () => openPackDetail(p),
    onkeydown: clickKeys(() => openPackDetail(p)) }, scIcon('package'), ' ' + (p.name || p.file));
  const card = el('div', { class: 'card', style: 'padding:16px;display:flex;flex-direction:column;gap:10px' },
    el('div', { style: 'display:flex;justify-content:space-between;gap:8px;align-items:flex-start' },
      title,
      p.bytes ? el('span', { class: 'tag', style: 'background:rgba(91,206,250,0.13)' },
        `${Math.max(1, Math.round(p.bytes / 1024))} KB`) : null),
    el('div', { class: 'u-muted-11', style: 'flex:1' }, p.description || p.file),
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
      btn([scIcon('plus'),' Add to Decks'], 'primary', { small: true, onclick: async e => {
        const b = e.currentTarget;
        const msg = await addPackToLocalDecks(p, b);
        if (msg) b.replaceChildren(scIcon('check'), ' Added');
      } }),
      el('a', { class: 'btn btn-ghost btn-sm', href, download: p.file,
        style: 'text-decoration:none', 'aria-label': `Download ${p.name || p.file}` }, [scIcon('download'),' Download']),
      btn(scIcon('link'), 'ghost', { small: true, title: 'Copy a shareable link to this pack',
        'aria-label': `Copy shareable link to ${p.name || p.file}`, onclick: async e => {
        const ok = (typeof copyTextToClipboard === 'function') && await copyTextToClipboard(packDeepLink(p));
        showToast(ok ? 'Pack link copied ✓' : 'Copy failed — link: ' + packDeepLink(p), ok ? 2500 : 6000);
        if (ok) e.currentTarget.replaceChildren(scIcon('check'));
      } })));
  return card;
}
