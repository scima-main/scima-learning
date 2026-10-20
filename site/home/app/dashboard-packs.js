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

function renderPacks(c) {
  c.innerHTML = '';
  c.append(
    el('div', { style: 'display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px' },
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
  });
}

function packCard(p) {
  const href = (window.SCIMA_PAGE?.root || '') + PACKS_DIR_REL + encodeURIComponent(p.file);
  const card = el('div', { class: 'card', style: 'padding:16px;display:flex;flex-direction:column;gap:10px' },
    el('div', { style: 'display:flex;justify-content:space-between;gap:8px;align-items:flex-start' },
      el('div', { style: 'font-weight:800;font-size:15px' }, `📦 ${p.name || p.file}`),
      p.bytes ? el('span', { class: 'tag', style: 'background:rgba(91,206,250,0.13)' },
        `${Math.max(1, Math.round(p.bytes / 1024))} KB`) : null),
    el('div', { class: 'u-muted-11', style: 'flex:1' }, p.description || p.file),
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
      btn('➕ Add to Decks', 'primary', { small: true, onclick: async e => {
        const b = e.currentTarget; b.disabled = true;
        try {
          const r = await fetch(href);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const parsed = importPackData(await r.json());
          if (!parsed) { showToast('Unrecognized pack format'); return; }
          commitPackImport(parsed);
          showToast(`Added ${parsed.decks.length} deck${parsed.decks.length > 1 ? 's' : ''}` +
            (parsed.folders.length ? ` + ${parsed.folders.length} folder${parsed.folders.length > 1 ? 's' : ''}` : '') + ' ✓');
          b.textContent = '✓ Added';
        } catch (err) {
          showToast('Could not load pack: ' + ((err && err.message) || err));
        } finally { b.disabled = false; }
      } }),
      el('a', { class: 'btn btn-ghost btn-sm', href, download: p.file,
        style: 'text-decoration:none', 'aria-label': `Download ${p.name || p.file}` }, '⬇ Download')));
  return card;
}
