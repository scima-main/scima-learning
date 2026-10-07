'use strict';
/* dashboard-decks.js — decks/folders/cards: drag-and-drop, the deck/subject/
   folder views, the card editor modal, citations, and deck import/export.
   Part of the dashboard-*.js split; see dashboard-core.js's header for the
   full rationale and load-order rules. */

function makeDraggable(node, type, id) {
  node.draggable = true;
  node.addEventListener('dragstart', e => {
    dragData = { type, id };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id); // Firefox requires data to be set to allow the drag
    setTimeout(() => { node.style.opacity = '0.4'; }, 0);
  });
  node.addEventListener('dragend', () => { node.style.opacity = ''; dragData = null; });
}

function isDescendantFolder(candidateId, ancestorId) {
  let cur = state.folders.find(f => f.id === candidateId);
  while (cur) { if (cur.id === ancestorId) return true; cur = state.folders.find(f => f.id === cur.parentId); }
  return false;
}

// Moves the currently dragged deck/folder into `targetFolderId` (null = subject root).
function dropOnFolder(targetFolderId, subjectKey) {
  if (!dragData) return;
  if (dragData.type === 'deck') {
    const deck = state.decks.find(d => d.id === dragData.id);
    if (!deck) return;
    deck.folderId = targetFolderId;
    if (subjectKey) deck.subject = subjectKey;
    scheduleSave(); showToast(targetFolderId ? `Moved "${deck.name}" into folder` : `Moved "${deck.name}" to top level`); renderView('decks');
  } else if (dragData.type === 'folder') {
    if (dragData.id === targetFolderId) return;
    if (targetFolderId && isDescendantFolder(targetFolderId, dragData.id)) { showToast("Can't move a folder into its own subfolder"); return; }
    const folder = state.folders.find(f => f.id === dragData.id);
    if (!folder) return;
    folder.parentId = targetFolderId;
    if (subjectKey) folder.subjectKey = subjectKey;
    scheduleSave(); showToast(targetFolderId ? `Moved "${folder.name}" into folder` : `Moved "${folder.name}" to top level`); renderView('decks');
  }
}

function makeDropTarget(node, targetFolderId, subjectKey) {
  node.addEventListener('dragover', e => {
    if (!dragData) return;
    if (dragData.type === 'folder' && (dragData.id === targetFolderId || (targetFolderId && isDescendantFolder(targetFolderId, dragData.id)))) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    node.classList.add('drop-hover');
  });
  node.addEventListener('dragleave', () => node.classList.remove('drop-hover'));
  node.addEventListener('drop', e => {
    e.preventDefault();
    node.classList.remove('drop-hover');
    dropOnFolder(targetFolderId, subjectKey);
  });
}

function renderDecks(c) {
  const nav = state.deckNav;
  if (nav.view === 'folder' && nav.folderId) renderFolderView(c, nav.folderId);
  else if (nav.view === 'subject' && nav.subjectKey) renderSubjectView(c, nav.subjectKey);
  else renderDecksHome(c);
}

function renderDecksHome(c) {
  const topBar = el('div',{style:'display:flex;align-items:center;justify-content:space-between;margin-bottom:24px'},
    el('div',{},
      el('div',{class:'section-title'},'Decks'),
      el('div',{class:'section-sub',style:'margin-bottom:0'},`${state.decks.length} deck${state.decks.length!==1?'s':''} · ${state.folders.length} folder${state.folders.length!==1?'s':''}`)
    ),
    el('div',{style:'display:flex;gap:8px'},
      btn('+ New Folder','ghost',{onclick:()=>openCreateFolderModal(null,null)}),
      (()=>{ const b=btn('+ New Deck','primary',{onclick:()=>openCreateDeckModal()}); b.id='tutorial-target-new-deck'; return b; })()
    )
  );

  const subjects = new Set([
    ...state.decks.map(d => d.subject||DEFAULT_SUBJECT_KEY),
    ...state.folders.filter(f=>!f.parentId).map(f=>f.subjectKey),
  ]);

  if (!subjects.size) {
    c.append(topBar, el('div',{class:'empty-state'},
      el('div',{class:'empty-icon'},'📚'), el('div',{class:'empty-title'},'No decks yet'),
      el('div',{class:'empty-sub'},'Create your first deck to start learning'),
      btn('Create Deck','primary',{onclick:()=>openCreateDeckModal()})
    ));
    return;
  }

  const grid = el('div',{class:'grid-3'});
  for (const sk of subjects) {
    const s = getSubjectSafe(sk);
    const subjectDecks = state.decks.filter(d=>(d.subject||DEFAULT_SUBJECT_KEY)===sk);
    const subjectFolders = state.folders.filter(f=>f.subjectKey===sk&&!f.parentId);
    const due = getDueCards(subjectDecks.flatMap(d=>d.cards)).length;
    grid.appendChild(el('div',{class:'card subject-tile',onclick:()=>{ state.deckNav={view:'subject',subjectKey:sk}; renderView('decks'); }},
      el('div',{class:'subject-tile-accent',style:`background:${s.defaultColor}`}),
      el('div',{class:'subject-tile-name',style:`color:${s.defaultColor}`},s.name),
      el('div',{class:'subject-tile-meta'},s.board),
      el('div',{class:'subject-tile-counts'},
        mkTag(`${subjectDecks.length} decks`,s.defaultColor),
        subjectFolders.length ? mkTag(`${subjectFolders.length} folders`,'#A78BFA') : null,
        due>0 ? mkTag(`${due} due`,'var(--pink)') : null
      )
    ));
  }
  c.append(topBar,grid);
}

function renderSubjectView(c, subjectKey) {
  const s = getSubjectSafe(subjectKey);
  const topFolders = state.folders.filter(f=>f.subjectKey===subjectKey&&!f.parentId);
  const topDecks = state.decks.filter(d=>(d.subject||DEFAULT_SUBJECT_KEY)===subjectKey&&!d.folderId);
  const allDecks = state.decks.filter(d=>(d.subject||DEFAULT_SUBJECT_KEY)===subjectKey);

  const breadcrumb = el('div',{class:'breadcrumb'},
    el('span',{class:'breadcrumb-part',onclick:()=>{ state.deckNav={view:'subjects'}; renderView('decks'); }},'📚 Decks'),
    el('span',{class:'breadcrumb-sep'},'›'),
    el('span',{class:'breadcrumb-part active',style:`color:${s.defaultColor}`},s.name)
  );
  const topBar = el('div',{style:'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px'},
    el('div',{},
      el('div',{style:`font-weight:900;font-size:20px;color:${s.defaultColor}`},s.name),
      el('div',{class:'u-muted-12'},`${allDecks.length} decks total`)
    ),
    el('div',{style:'display:flex;gap:8px'},
      btn('+ New Folder','ghost',{onclick:()=>openCreateFolderModal(subjectKey,null)}),
      btn('+ New Deck','primary',{onclick:()=>openCreateDeckModal(subjectKey)}),
      btn('▶ Study All','ghost',{onclick:()=>{ state.studyScope=[{type:'subject',id:subjectKey}]; navigate('study'); }})
    )
  );
  c.append(breadcrumb,topBar);

  if (topFolders.length) {
    c.appendChild(el('div',{class:'u-section-label'},'Folders'));
    const folderList = el('div',{class:'card',style:'margin-bottom:16px;overflow:hidden'});
    topFolders.forEach(folder => {
      const fd = state.decks.filter(d=>d.folderId===folder.id);
      const sf = state.folders.filter(f=>f.parentId===folder.id);
      const due = getDueCards(fd.flatMap(d=>d.cards)).length;
      const folderEl=el('div',{class:'folder-item',onclick:()=>{ state.deckNav={view:'folder',subjectKey,folderId:folder.id}; renderView('decks'); }},
        mkIcon(folder.emoji||'📁',folder.image,'22px','4px'),
        el('div',{style:'flex:1;min-width:0'},
          el('div',{class:'folder-name'},folder.name),
          el('div',{class:'folder-meta'},`${fd.length} deck${fd.length!==1?'s':''}${sf.length?` · ${sf.length} subfolder${sf.length!==1?'s':''}`:''} ${due>0?`· ${due} due`:''}`)
        ),
        el('div',{class:'folder-actions'},
          btn('▶','ghost',{small:true,onclick:e=>{e.stopPropagation();state.studyScope=[{type:'folder',id:folder.id}];navigate('study');}}),
          btn('⬇','ghost',{small:true,title:'Export folder as JSON',onclick:e=>{e.stopPropagation();exportFolder(folder.id);}}),
          btn('✏','ghost',{small:true,onclick:e=>{e.stopPropagation();openRenameFolderModal(folder.id);}}),
          btn('×','danger',{small:true,onclick:e=>{e.stopPropagation();deleteFolder(folder.id);}})
        ),
        el('span',{style:'color:var(--muted);font-size:16px;margin-left:4px'},'›')
      );
      makeDraggable(folderEl, 'folder', folder.id);
      makeDropTarget(folderEl, folder.id, subjectKey);
      folderList.appendChild(folderEl);
    });
    c.appendChild(folderList);
  }

  if (topDecks.length) {
    c.appendChild(el('div',{class:'u-section-label'},'Decks'));
    renderSelectableDeckGrid(c, topDecks);
  }

  if (!topFolders.length && !topDecks.length)
    c.appendChild(el('div',{class:'empty-state'},el('div',{class:'empty-icon'},'📂'),el('div',{class:'empty-title'},'No content yet'),el('div',{class:'empty-sub'},'Create a folder or deck for this subject'),
      el('div',{style:'display:flex;gap:8px;justify-content:center;margin-top:4px'},
        btn('+ New Folder','ghost',{onclick:()=>openCreateFolderModal(subjectKey,null)}),
        btn('+ New Deck','primary',{onclick:()=>openCreateDeckModal(subjectKey)})
      )
    ));
}

function renderFolderView(c, folderId) {
  const folder = state.folders.find(f=>f.id===folderId);
  if (!folder) { state.deckNav={view:'subjects'}; renderView('decks'); return; }
  const s = getSubjectSafe(folder.subjectKey);

  const chain = [];
  let cur = folder;
  while (cur) { chain.unshift(cur); cur = state.folders.find(f=>f.id===cur.parentId); }

  const subjectCrumb = el('span',{class:'breadcrumb-part',onclick:()=>{ state.deckNav={view:'subject',subjectKey:folder.subjectKey}; renderView('decks'); }},s.name);
  makeDropTarget(subjectCrumb, null, folder.subjectKey); // drop here = move to the subject's top level
  const breadcrumb = el('div',{class:'breadcrumb'},
    el('span',{class:'breadcrumb-part',onclick:()=>{ state.deckNav={view:'subjects'}; renderView('decks'); }},'📚 Decks'),
    el('span',{class:'breadcrumb-sep'},'›'),
    subjectCrumb
  );
  chain.forEach((f,i) => {
    breadcrumb.append(el('span',{class:'breadcrumb-sep'},'›'));
    const isLast = i===chain.length-1;
    const crumbEl=el('span',{class:`breadcrumb-part${isLast?' active':''}`,onclick:isLast?null:()=>{ state.deckNav={view:'folder',subjectKey:f.subjectKey,folderId:f.id}; renderView('decks'); }},f.name);
    if (!isLast) makeDropTarget(crumbEl, f.id, f.subjectKey); // drop here = move into this ancestor folder
    breadcrumb.appendChild(crumbEl);
  });

  const subFolders = state.folders.filter(f=>f.parentId===folderId);
  const folderDecks = state.decks.filter(d=>d.folderId===folderId);
  const topBar = el('div',{style:'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px'},
    el('div',{},el('div',{style:'font-size:22px;font-weight:900'},`📁 ${folder.name}`),el('div',{class:'u-muted-12'},`${folderDecks.length} decks`)),
    el('div',{style:'display:flex;gap:8px'},
      btn('+ Subfolder','ghost',{onclick:()=>openCreateFolderModal(folder.subjectKey,folderId)}),
      btn('+ New Deck','primary',{onclick:()=>openCreateDeckModal(folder.subjectKey,folderId)}),
      btn('▶ Study Folder','ghost',{onclick:()=>{ state.studyScope=[{type:'folder',id:folderId}]; navigate('study'); }}),
      btn('⬇️ Export Folder','ghost',{onclick:()=>exportFolder(folderId)})
    )
  );
  c.append(breadcrumb,topBar);

  if (subFolders.length) {
    c.appendChild(el('div',{class:'u-section-label'},'Subfolders'));
    const subList = el('div',{class:'card',style:'margin-bottom:16px;overflow:hidden'});
    subFolders.forEach(sf => {
      const sfd = state.decks.filter(d=>d.folderId===sf.id);
      const sfEl=el('div',{class:'folder-item',onclick:()=>{ state.deckNav={view:'folder',subjectKey:sf.subjectKey,folderId:sf.id}; renderView('decks'); }},
        mkIcon(sf.emoji||'📁',sf.image,'22px','4px'),
        el('div',{style:'flex:1'},el('div',{class:'folder-name'},sf.name),el('div',{class:'folder-meta'},`${sfd.length} deck${sfd.length!==1?'s':''}`)),
        el('div',{class:'folder-actions'},
          btn('✏','ghost',{small:true,onclick:e=>{e.stopPropagation();openRenameFolderModal(sf.id);}}),
          btn('×','danger',{small:true,onclick:e=>{e.stopPropagation();deleteFolder(sf.id);}})
        ),
        el('span',{style:'color:var(--muted);font-size:16px;margin-left:4px'},'›')
      );
      makeDraggable(sfEl, 'folder', sf.id);
      makeDropTarget(sfEl, sf.id, sf.subjectKey);
      subList.appendChild(sfEl);
    });
    c.appendChild(subList);
  }

  if (folderDecks.length) {
    c.appendChild(el('div',{class:'u-section-label'},'Decks'));
    renderSelectableDeckGrid(c, folderDecks);
  }

  if (!subFolders.length && !folderDecks.length)
    c.appendChild(el('div',{class:'empty-state'},el('div',{class:'empty-icon'},'📂'),el('div',{class:'empty-title'},'Empty folder'),el('div',{class:'empty-sub'},'Add decks or subfolders here'),
      el('div',{style:'display:flex;gap:8px;justify-content:center;margin-top:4px'},
        btn('+ Subfolder','ghost',{onclick:()=>openCreateFolderModal(folder.subjectKey,folderId)}),
        btn('+ New Deck','primary',{onclick:()=>openCreateDeckModal(folder.subjectKey,folderId)})
      )
    ));
}

function openEditDeckModal(deckId) {
  const deck = state.decks.find(d=>d.id===deckId); if(!deck)return;
  openModal('Edit Deck', body => {
    const nameField = createField('Deck Name','text',deck.name);
    nameField.querySelector('input').value = deck.name;
    let _deckEmoji = deck.emoji || '📖', _deckImage = deck.image || null;
    const iconPicker = mkIconPicker(_deckEmoji, _deckImage, v=>{_deckEmoji=v;}, v=>{_deckImage=v;});
    body.append(nameField, iconPicker, btn('Save','primary',{full:true,onclick:()=>{
      const name=nameField.querySelector('input').value.trim(); if(!name)return;
      deck.name=name; deck.emoji=_deckEmoji; deck.image=_deckImage;
      scheduleSave(); closeModal(); renderView('decks'); renderSidebar();
    }}));
  });
}

function renderDeckCard(deck, grid) {
  const deckDue = getDueCards(deck.cards).length;
  const sk = deck.subject||DEFAULT_SUBJECT_KEY;
  const mult = subjectXPMultiplier(state.trackerState?.subjects, sk);
  const pinBtn = el('button',{class:`btn btn-ghost btn-sm pin-toggle${deck.pinned?' pinned':''}`,title:deck.pinned?'Unpin from sidebar':'Pin to sidebar',onclick:e=>{e.stopPropagation();togglePinDeck(deck.id);}},'📌');
  const cardEl = el('div',{class:`card deck-card${deckDue>0?' glow':''}`},
    el('div',{style:'display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px'},
      mkIcon(deck.emoji,deck.image,'36px','8px'),
      el('div',{style:'display:flex;gap:4px'},
        pinBtn,
        btn('✏','ghost',{small:true,onclick:e=>{e.stopPropagation();openEditDeckModal(deck.id);}}),
        btn('×','danger',{small:true,onclick:e=>{e.stopPropagation();deleteDeck(deck.id);}})
      )
    ),
    el('div',{class:'deck-name'},deck.name),
    el('div',{class:'deck-meta'},`${deck.cards.length} cards`),
    el('div',{class:'deck-tags'},
      mkTag(getAllSubjects()[sk]?.short||sk,getAllSubjects()[sk]?.defaultColor||'#888'),
      mkTag(`${mult.toFixed(2)}× XP`,mult>=1.5?'var(--pink)':'#22c55e'),
      deckDue>0 ? mkTag(`${deckDue} due`,'var(--pink)') : mkTag('Caught up','#22c55e')
    ),
    el('div',{style:'display:flex;flex-direction:column;gap:6px'},
      btn('▶ Study Now','primary',{full:true,title:'Study this deck now',onclick:e=>{e.stopPropagation();state.studyScope=[{type:'deck',id:deck.id}];navigate('study');}}),
      el('div',{style:'display:flex;gap:6px'},
        btn('Manage Cards','ghost',{full:true,onclick:()=>openDeckDetail(deck.id)}),
        btn('🖨️','ghost',{small:true,title:'Export double-sided PDF',onclick:e=>{e.stopPropagation();exportDeckPDF(deck.id);}}),
        btn('⬇️','ghost',{small:true,title:'Export deck as JSON',onclick:e=>{e.stopPropagation();exportSingleDeck(deck.id);}})
      )
    )
  );
  makeDraggable(cardEl, 'deck', deck.id);
  grid.appendChild(cardEl);
}

function deleteDeck(id) { state.decks=state.decks.filter(d=>d.id!==id); scheduleSave(); renderView('decks'); renderSidebar(); }

// ── Deck multi-select (subject/folder views) ────────────────────────────
// Same sticky click-to-toggle / shift+click range-select interaction as the
// card grid in openDeckDetail (see "Deck detail: card multi-select" in
// ARCHITECTURE.md), scoped to whichever deck list the caller passes in (a
// subject's top-level decks, or a folder's decks), with a selection bar
// offering Study + "Move to Folder…" instead of card grid's "Move to
// Deck…". Deck tiles stay natively draggable (existing drag-and-drop into
// folders — see makeDraggable/makeDropTarget above), so unlike the card
// grid there's no rubber-band drag-select here: a custom mousedown-drag
// marquee over the same tiles would fight the native HTML5 drag. Click /
// shift+click is enough to build a selection without that conflict.
function renderSelectableDeckGrid(container, decks) {
  const selected = new Set();
  let anchorId = null;
  const deckElById = new Map();
  const ids = decks.map(d=>d.id);

  const selectionBar = el('div',{class:'selection-bar',style:'display:none'});
  const grid = el('div',{class:'grid-3'});
  container.append(selectionBar, grid);

  function selectSingle(id){ selected.clear(); selected.add(id); anchorId=id; }
  function selectToggle(id){ if(selected.has(id)) selected.delete(id); else selected.add(id); anchorId=id; }
  function selectRange(id){
    const from=ids.indexOf(anchorId), to=ids.indexOf(id);
    if(from===-1||to===-1){ selectSingle(id); return; }
    const [lo,hi]=from<to?[from,to]:[to,from];
    for(let i=lo;i<=hi;i++) selected.add(ids[i]);
  }
  function syncVisuals(){
    deckElById.forEach((elm,id)=>elm.classList.toggle('card-selected', selected.has(id)));
    renderSelectionBar();
  }
  function renderSelectionBar(){
    selectionBar.innerHTML='';
    if(!selected.size){ selectionBar.style.display='none'; return; }
    selectionBar.style.display='flex';
    selectionBar.append(
      el('span',{},`${selected.size} deck${selected.size>1?'s':''} selected`),
      el('span',{style:'margin-left:auto;display:flex;gap:8px'},
        btn('Select All','ghost',{small:true,onclick:()=>{ ids.forEach(id=>selected.add(id)); anchorId=ids[ids.length-1]||anchorId; syncVisuals(); }}),
        btn('Clear','ghost',{small:true,onclick:()=>{ selected.clear(); anchorId=null; syncVisuals(); }}),
        btn('▶ Study Selected','ghost',{small:true,onclick:()=>{
          state.studyScope=[...selected].map(id=>({type:'deck',id}));
          navigate('study');
        }}),
        btn('Move to Folder…','primary',{small:true,onclick:()=>openMoveDecksModal([...selected])})
      )
    );
  }

  decks.forEach(deck => {
    renderDeckCard(deck, grid);
    const tile = grid.lastElementChild;
    tile.classList.add('card-selectable');
    tile.addEventListener('click', e => {
      if(e.target.closest('button')) return;
      if(e.shiftKey && anchorId) selectRange(deck.id);
      else selectToggle(deck.id);
      syncVisuals();
    });
    deckElById.set(deck.id, tile);
  });

  renderSelectionBar();
}

// Moves a set of decks (all assumed to share one subject — see call sites,
// which only ever pass ids drawn from a single subject/folder view's grid)
// to an existing folder, a new folder, or the subject's top level. Mirrors
// openMoveCardsModal's shape (existing-destination select + create-new
// fallback) but one level up: decks into folders instead of cards into decks.
function openMoveDecksModal(deckIds) {
  const decks = state.decks.filter(d=>deckIds.includes(d.id));
  if(!decks.length) return;
  const count = decks.length;
  const subjectKey = decks[0].subject||DEFAULT_SUBJECT_KEY;
  openModal(`Move ${count} Deck${count>1?'s':''}`, body => {
    body.appendChild(el('div',{style:'font-size:12px;color:var(--muted);margin-bottom:16px'},`Choose a destination folder for the selected deck${count>1?'s':''}.`));

    const folders = state.folders.filter(f=>f.subjectKey===subjectKey);
    body.appendChild(el('div',{class:'u-section-label'},'Move to Existing Folder'));
    const sel=el('select',{style:'width:100%;padding:9px 12px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid var(--border);color:var(--text);font-size:13px;font-family:inherit;outline:none;margin-bottom:8px'});
    sel.appendChild(el('option',{value:'',class:'u-bg'},'📚 Top level (no folder)'));
    folders.forEach(f=>sel.appendChild(el('option',{value:f.id,class:'u-bg'},`${f.emoji||'📁'} ${f.name}`)));
    body.append(sel, btn('Move →','primary',{full:true,onclick:()=>{
      const targetId=sel.value||null;
      decks.forEach(d=>{ d.folderId=targetId; });
      scheduleSave(); closeModal(); showToast(`Moved ${count} deck${count>1?'s':''} 📦`);
      renderView('decks');
    }}));

    body.appendChild(el('div',{style:'border-top:1px solid var(--border);margin-top:16px;padding-top:14px'}));
    body.appendChild(el('div',{class:'u-section-label'},'Or Move to a New Folder'));
    const nameField = createField('New Folder Name','text','e.g. Chapter 4');
    let _emoji='📁', _img=null;
    const iconPicker = mkIconPicker('📁',null,v=>{_emoji=v;},v=>{_img=v;});
    body.append(nameField, iconPicker, btn('Create & Move','primary',{full:true,onclick:()=>{
      const name=nameField.querySelector('input').value.trim();
      if(!name){ showToast('Enter a folder name'); return; }
      const newFolder={id:uid('f'),name,emoji:_emoji,image:_img||null,subjectKey,parentId:null};
      state.folders.push(newFolder);
      decks.forEach(d=>{ d.folderId=newFolder.id; });
      scheduleSave(); closeModal(); showToast(`Created "${name}" and moved ${count} deck${count>1?'s':''} 📦`);
      renderView('decks');
    }}));
  });
}

function _resolveDeckCitations(deck) {
  return {...deck, cards: deck.cards.map(c => {
    if (!c.citation) return c;
    const src = (state.sources||[]).find(s=>s.id===c.citation.sourceId);
    const chap = c.citation.chapterId && src?.chapters?.find(ch=>ch.id===c.citation.chapterId);
    const excerpt = src ? src.content.slice(c.citation.charStart, c.citation.charEnd) : '';
    return {...c, citation:{...c.citation, sourceName:src?.name||null, chapterTitle:chap?.title||null, excerpt:excerpt||null}};
  })};
}

function exportSingleDeck(deckId) {
  const deck = state.decks.find(d=>d.id===deckId);
  if (!deck) return;
  const citedSourceIds = new Set(deck.cards.map(c=>c.citation?.sourceId).filter(Boolean));
  const citedSources = (state.sources||[]).filter(s=>citedSourceIds.has(s.id));
  const a = document.createElement('a');
  a.href = 'data:application/json,' + encodeURIComponent(JSON.stringify({version:2, exportedAt:new Date().toISOString(), deck:_resolveDeckCitations(deck), citedSources}, null, 2));
  a.download = `SCIMA-deck-${deck.name.replace(/[^a-z0-9]/gi,'-').toLowerCase()}-${today()}.json`;
  a.click();
  showToast(`"${deck.name}" exported ✓`);
}

function exportFolder(folderId) {
  const folder = state.folders.find(f=>f.id===folderId);
  if (!folder) return;
  const allFolderIds = [folderId, ...getDescendantFolderIds(folderId)];
  const decks = state.decks.filter(d=>allFolderIds.includes(d.folderId));
  const subFolders = state.folders.filter(f=>allFolderIds.includes(f.id));
  const citedSourceIds = new Set(decks.flatMap(d=>d.cards).map(c=>c.citation?.sourceId).filter(Boolean));
  const citedSources = (state.sources||[]).filter(s=>citedSourceIds.has(s.id));
  const a = document.createElement('a');
  a.href = 'data:application/json,' + encodeURIComponent(JSON.stringify({version:2, exportedAt:new Date().toISOString(), folder, subFolders, decks:decks.map(_resolveDeckCitations), citedSources}, null, 2));
  a.download = `SCIMA-folder-${folder.name.replace(/[^a-z0-9]/gi,'-').toLowerCase()}-${today()}.json`;
  a.click();
  showToast(`Folder "${folder.name}" exported — ${decks.length} deck${decks.length!==1?'s':''} ✓`);
}

/**
 * Export a library source as its original file format + a companion modifications JSON.
 *
 * Original file:
 *   - PDF  → reconstructed from the chunked base64 stored in chrome.storage.local → .pdf
 *   - EPUB/MOBI/TXT/other → the extracted text content (original binary is not stored) → .txt
 *
 * Modifications JSON (SCIMA-<name>-modifications.json):
 *   {
 *     version: 1,
 *     scima_source_export: true,
 *     exportedAt: ISO string,
 *     sourceName: string,
 *     sourceType: string,       // 'pdf'|'text'|'file'
 *     bookmarks: [...],         // all manual bookmarks
 *     autoBookmark: {...}|null, // last auto-saved reading position
 *     chapters: [...],          // chapter metadata (offsets + titles)
 *   }
 */
// ── htmlChapters chunked storage (mirrors the PDF chunk pattern) ─────────────
// Site build: reads/writes go through blobStore (dashboard-blobstore.js),
// which uses plain localStorage here instead of chrome.storage.local's
// chunked-keys pattern — see that file's header for why chunking itself
// isn't needed on this backend, only the same call shape.

async function saveHtmlChapters(srcId, htmlChapters) {
  if (!htmlChapters?.length) return;
  try {
    await blobStore.setChunks('html', srcId, JSON.stringify(htmlChapters));
  } catch (e) {
    console.error('[SCIMA] saveHtmlChapters failed:', e);
  }
}

async function loadHtmlChapters(srcId) {
  try {
    const json = await blobStore.getChunks('html', srcId);
    if (!json) return null;
    const parsed = JSON.parse(json);
    // Guard against corrupted storage (old batched set() exceeded Chrome's 8 MB
    // per-call quota): chunk keys exist but all html fields are empty strings.
    // Returning null lets the reader fall back to plain text instead of blank page.
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(p => !p.html)) return null;
    return parsed;
  } catch(e) { return null; }
}

async function deleteHtmlChapters(srcId) {
  try {
    await blobStore.deleteChunks('html', srcId);
  } catch(e) { console.warn('[SCIMA] deleteHtmlChapters cleanup failed — orphaned chunk keys may remain:', e); }
}

// Mirrors the inline PDF-chunk write used when a source is first added — reused
// on import to restore a bundled PDF's raw bytes.
async function writePdfChunks(srcId, dataUrl) {
  await blobStore.setChunks('pdf', srcId, dataUrl);
}

/**
 * Full-backup export as a .zip: data.json (every piece of app state — decks,
 * folders, library folders, sources, review history, achievements, settings,
 * tracker state, streak, recent study scopes) PLUS the raw bytes for any
 * imported PDFs and the chapter/image data for any HTML(EPUB) sources, which
 * live in chrome.storage.local outside `state` and are otherwise lost on a
 * plain JSON export.
 *
 * Every source's plain-text `content`, bookmarks/annotations, chapters, and
 * citations always travel inside `sources` in data.json regardless of what
 * happens below — nothing textual can be lost by this function. The PDF/HTML
 * bundling below is only for the *extra* reconstructable material (original
 * PDF bytes, original EPUB/MOBI HTML+images) layered on top of that text. If
 * bundling one of those fails, the source and its notes are still fully
 * exported — but the user is told which source(s) lost their raw bytes,
 * rather than that being silently swallowed to the console (matches the
 * per-source warning single-source export already gives via
 * exportSourceWithBookmarks, above).
 */
async function exportAllDataZip() {
  try {
    showToast('Preparing full export…');
    function resolveCitations(decks) {
      return decks.map(d=>({...d,cards:d.cards.map(c=>{
        if(!c.citation) return c;
        const src=(state.sources||[]).find(s=>s.id===c.citation.sourceId);
        const chap=c.citation.chapterId&&src?.chapters?.find(ch=>ch.id===c.citation.chapterId);
        const excerpt=src?src.content.slice(c.citation.charStart,c.citation.charEnd):'';
        return {...c,citation:{...c.citation,sourceName:src?.name||null,chapterTitle:chap?.title||null,excerpt:excerpt||null}};
      })}));
    }

    const zipFiles = {};
    const enc = new TextEncoder();
    const pdfSourceIds = [];
    const htmlSourceIds = [];
    const failedSources = []; // [{ name, kind: 'PDF'|'illustrated book', reason }]

    for (const src of state.sources||[]) {
      if (src.hasPdf || src.type==='pdf') {
        try {
          const dataUrl = await blobStore.getChunks('pdf', src.id);
          if (dataUrl) {
            const b64 = dataUrl.split(',')[1];
            if (b64) {
              const bin = atob(b64);
              const bytes = new Uint8Array(bin.length);
              for (let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
              zipFiles[`pdf/${src.id}.pdf`] = bytes;
              pdfSourceIds.push(src.id);
            } else {
              failedSources.push({ name: src.name, kind: 'PDF', reason: 'stored PDF data was empty' });
            }
          } else {
            failedSources.push({ name: src.name, kind: 'PDF', reason: 'no PDF bytes in storage (text still exported)' });
          }
        } catch(e) {
          console.error('[SCIMA] export: failed to read PDF for', src.id, e);
          failedSources.push({ name: src.name, kind: 'PDF', reason: e?.message || String(e) });
        }
      }
      if (src.hasHtml) {
        try {
          const hc = await loadHtmlChapters(src.id);
          if (hc?.length) {
            zipFiles[`html/${src.id}.json`] = enc.encode(JSON.stringify(hc));
            htmlSourceIds.push(src.id);
          } else {
            failedSources.push({ name: src.name, kind: 'illustrated book', reason: 'no HTML/image data in storage (text still exported)' });
          }
        } catch(e) {
          console.error('[SCIMA] export: failed to read HTML chapters for', src.id, e);
          failedSources.push({ name: src.name, kind: 'illustrated book', reason: e?.message || String(e) });
        }
      }
    }

    const data = {
      version: 3,
      exportedAt: new Date().toISOString(),
      decks: resolveCitations(state.decks),
      folders: state.folders,
      libraryFolders: state.libraryFolders||[],
      sources: state.sources,
      reviewHistory: state.reviewHistory,
      achievements: state.achievements,
      settings: state.settings,
      trackerState: state.trackerState,
      streak: state.streak,
      lastStreakDate: state.lastStreakDate,
      recentStudyScopes: state.recentStudyScopes,
      pdfSourceIds, htmlSourceIds,
    };
    zipFiles['data.json'] = enc.encode(JSON.stringify(data, null, 2));

    const zipped = fflate.zipSync(zipFiles, {level:1});
    const blob = new Blob([zipped], {type:'application/zip'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href=url; a.download=`SCIMA-full-export-${today()}.zip`; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),5000);

    if (failedSources.length) {
      // Surfaced in a modal rather than just the toast — there can be several,
      // and the toast auto-dismisses, so a user who wasn't watching the screen
      // shouldn't have to just trust that "everything" was exported.
      openModal('⚠ Full export completed with warnings', body => {
        body.append(
          el('div', { style:'font-size:13px;color:var(--muted);margin-bottom:12px' },
            `Your decks, sources (including their full text, bookmarks, and citations), tracker data, and settings all exported normally. ${failedSources.length} source${failedSources.length!==1?'s':''} couldn\u2019t bundle its original file bytes, so re-importing this backup will restore the text/notes for ${failedSources.length!==1?'them':'it'} but not the original PDF/EPUB formatting:`
          ),
          el('div', { style:'max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:6px' },
            ...failedSources.map(f => el('div', { style:'padding:10px 12px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid var(--border);font-size:12px' },
              el('div', { style:'font-weight:700;margin-bottom:2px' }, `${f.name} (${f.kind})`),
              el('div', { style:'color:var(--muted)' }, f.reason)
            ))
          ),
          el('div', { style:'margin-top:14px' }, btn('Got it', 'primary', { full:true, onclick: closeModal }))
        );
      });
      showToast(`Full export ready ✓ (${pdfSourceIds.length} PDFs, ${htmlSourceIds.length} illustrated books bundled, ${failedSources.length} with warnings)`);
    } else {
      showToast(`Full export ready ✓ (${pdfSourceIds.length} PDFs, ${htmlSourceIds.length} illustrated books bundled)`);
    }
  } catch(e) {
    showToast('⚠ Export failed: ' + (e?.message || String(e)));
  }
}

async function exportSourceWithBookmarks(sourceId) {
  const source = state.sources.find(s => s.id === sourceId);
  if (!source) return;

  const safeName = source.name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  const enc = new TextEncoder();
  // zipFiles: { filename: Uint8Array }
  const zipFiles = {};

  // ── 1. Source content file ─────────────────────────────────────────────
  const isPdf = source.hasPdf || source.type === 'pdf';
  if (isPdf) {
    try {
      const dataUrl = await blobStore.getChunks('pdf', source.id);
      if (dataUrl) {
        // dataUrl = "data:application/pdf;base64,..."
        const b64 = dataUrl.split(',')[1];
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        zipFiles[`${safeName}.pdf`] = bytes;
      } else {
        showToast('⚠ PDF data not found — exporting text + modifications only');
        zipFiles[`${safeName}.txt`] = enc.encode(source.content || '');
      }
    } catch(e) {
      showToast('⚠ Could not retrieve PDF: ' + (e?.message || String(e)));
      zipFiles[`${safeName}.txt`] = enc.encode(source.content || '');
    }
  } else {
    // EPUB/MOBI/TXT: original binary not stored — export extracted text
    zipFiles[`${safeName}.txt`] = enc.encode(source.content || '');
  }

  // ── 2. Compute / stamp content hash ───────────────────────────────────
  if (!source.contentHash && source.content) {
    source.contentHash = await hashContent(source.content);
    if (source.contentHash) scheduleSave();
  }

  // ── 3. modifications.json ──────────────────────────────────────────────
  const modifications = {
    version: 1,
    scima_source_export: true,
    exportedAt: new Date().toISOString(),
    sourceName: source.name,
    sourceType: source.type || 'text',
    hasPdf: !!isPdf,
    hasHtml: !!(source.hasHtml),
    contentHash: source.contentHash || null,
    bookmarks: source.bookmarks || [],
    autoBookmark: source.autoBookmark || null,
    chapters: (source.chapters || []).map(ch => ({
      id: ch.id, title: ch.title, start: ch.start, end: ch.end,
    })),
  };
  zipFiles['modifications.json'] = enc.encode(JSON.stringify(modifications, null, 2));

  // ── 4. images.json (HTML chapters with embedded images) ───────────────
  if (source.hasHtml) {
    try {
      const hc = await loadHtmlChapters(source.id);
      if (hc?.length) {
        const htmlExport = { version: 1, scima_html_export: true, sourceName: source.name, htmlChapters: hc };
        zipFiles['images.json'] = enc.encode(JSON.stringify(htmlExport));
      }
    } catch(e) { /* skip if unavailable */ }
  }

  // ── 5. Pack and download ───────────────────────────────────────────────
  try {
    const zipped = fflate.zipSync(zipFiles, { level: 1 });
    const blob = new Blob([zipped], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}-scima-export.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    const fileList = Object.keys(zipFiles).join(', ');
    showToast(`"${source.name}" exported ✓ (${fileList})`);
  } catch(e) {
    showToast('⚠ Export failed: ' + (e?.message || String(e)));
  }
}


/**
 * Export a deck as a printable double-sided PDF.
 * Layout: front side pages come first (odd physical pages),
 * back side pages come second (even physical pages).
 * Flip on SHORT edge (horizontal flip) so that when printed
 * duplex "flip on short edge" the backs align with their fronts.
 *
 * Each A4 page holds a 2×4 grid of card slots (8 cards per page-face).
 * Fronts are laid out left-to-right, top-to-bottom.
 * Backs are mirrored HORIZONTALLY (col 0↔col 1) so that after
 * short-edge flip, card N front and card N back are on the same physical card.
 */
async function exportDeckPDF(deckId) {
  const deck = state.decks.find(d => d.id === deckId);
  if (!deck || !deck.cards.length) { showToast('No cards to export'); return; }

  const sk = deck.subject || DEFAULT_SUBJECT_KEY;
  const accentColor = (state.trackerState?.subjects?.[sk]?.color) || getAllSubjects()[sk]?.defaultColor || 'var(--blue)';
  const cards = deck.cards;
  const COLS = 2, ROWS = 4, PER_PAGE = COLS * ROWS;
  const totalSheets = Math.ceil(cards.length / PER_PAGE);

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Renders a table card's grid as a compact HTML <table> for the printable
  // PDF — previously table cards had no PDF handling at all (formatCardBack
  // has no 'table' branch, so the cell just printed blank). Picks the card's
  // first authored combination for the front (deterministic — a printed page
  // can't re-roll a random combination per rep the way study mode does) and
  // shows those cells as "?"; the back shows the same grid fully filled in
  // from the answer key so both sides of a physical card line up.
  function buildTablePdfHtml(card, isFront) {
    const td = card.tableData || { columns: [], rows: [], combinations: [] };
    const combo = (td.combinations && td.combinations[0]) || { cells: td.rows.map(() => []) };
    const hasGroups = td.columns.some(c => c.group);
    const spans = [];
    td.columns.forEach(c => {
      if (c.group) {
        const last = spans[spans.length-1];
        if (last && last.isGroup && last.label === c.group) last.colspan++;
        else spans.push({ label: c.group, colspan: 1, isGroup: true });
      } else spans.push({ label: c.label, colspan: 1, isGroup: false });
    });
    let thead = '<tr>' + spans.map(s => `<th colspan="${s.colspan}"${!s.isGroup && hasGroups ? ' rowspan="2"' : ''}>${esc(s.label)}</th>`).join('') + '</tr>';
    if (hasGroups) thead += '<tr>' + td.columns.filter(c => c.group).map(c => `<th>${esc(c.label)}</th>`).join('') + '</tr>';
    const tbody = td.rows.map((row, ri) => {
      const blankCols = new Set(combo.cells?.[ri] || []);
      return '<tr>' + td.columns.map(c => {
        const isBlank = blankCols.has(c.key);
        const shown = (isFront && isBlank) ? '?' : (row?.[c.key] ?? '');
        return `<td${isFront && isBlank ? ' class="tbl-blank"' : ''}>${esc(shown)}</td>`;
      }).join('') + '</tr>';
    }).join('');
    return `<table class="pdf-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
  }

  function buildGrid(pageCards, isFront) {
    let cells = '';
    for (let i = 0; i < PER_PAGE; i++) {
      const renderIdx = isFront ? i : (() => {
        const col = i % COLS, row = Math.floor(i / COLS);
        return row * COLS + (COLS - 1 - col);
      })();
      const card = pageCards[renderIdx];
      if (!card) { cells += '<div class="cell empty"></div>'; continue; }
      const isTable = card.type === 'table';
      const text = isTable ? '' : esc(isFront ? formatCardFront(card) : formatCardBack(card));
      const mainBlock = isTable
        ? `<div class="main-text table-mode">${isFront ? `<div class="tbl-instr">${esc(formatCardFront(card))}</div>` : ''}${buildTablePdfHtml(card, isFront)}</div>`
        : `<div class="main-text">${text}</div>`;
      const src = (!isFront && card.citation) ? (state.sources||[]).find(s => s.id === card.citation?.sourceId) : null;
      const chap = (src && card.citation?.chapterId) ? src.chapters?.find(ch => ch.id === card.citation.chapterId) : null;
      const excerpt = (src && card.citation) ? src.content.slice(card.citation.charStart, card.citation.charEnd) : '';
      const tags = (isFront && card.tags?.length) ? card.tags.slice(0,3).map(t=>`<span class="tag">${esc(t)}</span>`).join('') : '';
      const citBlock = (!isFront && src && excerpt) ? `<div class="cit-block"><span class="cit-label">&#128218; ${esc(src.name.slice(0,20))}${chap?` &rsaquo; ${esc(chap.title.slice(0,18))}`:''}</span><div class="cit-excerpt">&ldquo;${esc(excerpt.trim().slice(0,160))}${excerpt.trim().length>160?'&hellip;':''}&rdquo;</div></div>` : '';
      const cardImg=(isFront&&card.frontImage)||(!isFront&&card.backImage);
      const imgBlock=cardImg?`<div class="card-img-wrap"><img src="${cardImg}" style="max-width:100%;max-height:55pt;object-fit:contain;border-radius:4px;"></div>`:'';
      cells += `<div class="cell"><div class="accent-bar"></div><div class="side-label">${isFront?'QUESTION':'ANSWER'}</div>${imgBlock}${mainBlock}${citBlock}<div class="footer"><div class="tags">${tags}${src?`<span class="src-tag">&#128218; ${esc(src.name.slice(0,22))}</span>`:''}</div><div class="dn">${esc(deck.emoji)} ${esc(deck.name)}</div></div></div>`;
    }
    return `<div class="page"><div class="ph">${esc(deck.emoji)} ${esc(deck.name)} &middot; ${isFront?'FRONT &mdash; print first':'BACK &mdash; flip on short edge'}</div><div class="grid">${cells}</div></div>`;
  }

  let pagesHtml = '';
  for (let p = 0; p < totalSheets; p++) {
    const pc = cards.slice(p * PER_PAGE, (p+1) * PER_PAGE);
    pagesHtml += buildGrid(pc, true) + buildGrid(pc, false);
  }

  const ac = accentColor;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(deck.name)} flashcards</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#e5e7eb;padding:20px}
@media print{body{background:#fff;padding:0}@page{size:A4 portrait;margin:0}.page{page-break-after:always}.instr{page-break-after:always}.pbtn{display:none!important}}
.instr{background:#fff;width:210mm;margin:0 auto 16px;padding:36px;border-radius:6px}
.instr h1{font-size:20px;margin-bottom:16px;color:#000}
.instr ol{padding-left:22px}
.instr li{font-size:13px;margin-bottom:8px;line-height:1.5;color:#000}
.instr .meta{margin-top:20px;padding:14px 18px;background:#f5f5f5;border-radius:6px;font-size:12px;line-height:1.8;color:#000}
.pbtn{display:block;margin:0 auto 20px;padding:10px 28px;font-size:15px;background:#000;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700}
.page{background:#fff;width:210mm;min-height:297mm;margin:0 auto 16px;padding:7mm;border-radius:6px}
.ph{font-size:7pt;color:#555;text-align:center;margin-bottom:3mm;letter-spacing:.04em}
.grid{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(4,1fr);gap:3mm;height:calc(297mm - 22mm)}
.cell{border:1.5px solid #000;border-radius:4px;display:flex;flex-direction:column;overflow:hidden;background:#fff}
.cell.empty{background:#fff;border-color:#ccc}
.accent-bar{height:2px;background:#000;flex-shrink:0}
.side-label{font-size:6pt;font-weight:700;letter-spacing:.1em;color:#000;text-align:center;padding:3px 0 1px;flex-shrink:0}
.main-text{flex:1;display:flex;align-items:center;justify-content:center;text-align:center;padding:4px 8px;font-size:9pt;color:#000;line-height:1.4;word-break:break-word;overflow:hidden}
.footer{display:flex;justify-content:space-between;align-items:flex-end;padding:2px 5px 3px;flex-shrink:0;gap:3px;border-top:0.5px solid #ddd}
.tags{display:flex;flex-wrap:wrap;gap:2px}
.tag{font-size:5.5pt;padding:1px 3px;border-radius:2px;background:#f0f0f0;color:#000;border:1px solid #bbb}
.src-tag{font-size:5.5pt;padding:1px 3px;border-radius:2px;background:#f0f0f0;color:#000;border:1px solid #bbb}
.dn{font-size:5pt;color:#555;white-space:nowrap}
.card-img-wrap{display:flex;justify-content:center;margin-bottom:4px;flex-shrink:0}
.cit-block{border-top:0.5px solid #e0e0e0;padding:2px 5px 2px;background:#fafafa;flex-shrink:0}
.cit-label{font-size:5pt;font-weight:700;color:#555;display:block;margin-bottom:1px}
.cit-excerpt{font-size:5.5pt;color:#333;line-height:1.35;font-style:italic;word-break:break-word;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}
.main-text.table-mode{display:block;text-align:left;overflow:auto;padding:3px 5px}
.tbl-instr{font-size:7.5pt;font-weight:700;color:#000;margin-bottom:3px;text-align:center}
.pdf-table{border-collapse:collapse;width:100%;table-layout:fixed}
.pdf-table th,.pdf-table td{border:0.75px solid #000;padding:1.5px 3px;font-size:5.5pt;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#000}
.pdf-table th{background:#eee;font-weight:700}
.pdf-table td.tbl-blank{color:#999;font-style:italic}
</style></head><body>
<div class="instr">
  <h1>${esc(deck.emoji)} ${esc(deck.name)}</h1>
  <button class="pbtn" onclick="window.print()">&#128424; Print flashcards</button>
  <ol>
    <li>Click <b>Print flashcards</b> above (or Ctrl+P).</li>
    <li>Enable <b>Two-sided / Duplex</b> printing.</li>
    <li>Set flip to <b>Short Edge</b> (horizontal flip).</li>
    <li>Paper size: <b>A4</b>, margins: <b>None</b>.</li>
    <li>Cut along card borders after printing.</li>
  </ol>
  <div class="meta">
    Deck: <b>${esc(deck.name)}</b><br>
    Cards: <b>${cards.length}</b> &nbsp;&middot;&nbsp; Sheets needed: <b>${totalSheets}</b> &nbsp;&middot;&nbsp; Printed pages: <b>${totalSheets*2}</b>
  </div>
</div>
${pagesHtml}
</body></html>`;

  // Chrome extensions block data: and blob: URLs as top-level navigations.
  // Solution: open a blank tab, then write into it via document.open/write/close.
  const printTab = window.open('', '_blank');
  if (printTab) {
    printTab.document.open();
    printTab.document.write(html);
    printTab.document.close();
    showToast(`Print preview ready — ${cards.length} cards, ${totalSheets} sheet${totalSheets!==1?'s':''} \uD83D\uDDA8\uFE0F`);
  } else {
    showToast('Popup blocked — allow popups for this page in Chrome', 5000);
  }
}
function deleteFolder(id) {
  const folder = state.folders.find(f=>f.id===id);
  const parentId = folder?.parentId||null;
  state.decks.forEach(d=>{ if(d.folderId===id) d.folderId=parentId; });
  state.folders.forEach(f=>{ if(f.parentId===id) f.parentId=parentId; });
  state.folders = state.folders.filter(f=>f.id!==id);
  scheduleSave(); renderView('decks');
}

function openCreateFolderModal(subjectKey, parentId) {
  openModal('Create Folder', body => {
    // Tab bar
    let mode = 'create';
    const tabBar = el('div',{style:'display:flex;gap:0;margin-bottom:10px;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,0.1)'});
    const tabCreate = el('button',{style:'flex:1;padding:8px;font-size:12px;font-weight:700;font-family:inherit;border:none;cursor:pointer;background:var(--blue);color:#fff',onclick:()=>switchTab('create')},'+ New Folder');
    const tabImport = el('button',{style:'flex:1;padding:8px;font-size:12px;font-weight:700;font-family:inherit;border:none;cursor:pointer;background:rgba(255,255,255,0.06);color:var(--muted)',onclick:()=>switchTab('import')},'⬆ Import Folder');
    tabBar.append(tabCreate, tabImport);
    body.appendChild(tabBar);

    const createPane = el('div');
    const importPane = el('div',{style:'display:none'});

    // --- Create pane ---
    const nameField = createField('Folder Name','text','e.g. Organic Chemistry');
    let _folderEmoji='📁',_folderImage=null;
    const folderIconPicker=mkIconPicker('📁',null,function(v){_folderEmoji=v;},function(v){_folderImage=v;});
    let subjectWrap = null;
    let subjectSel = null;
    if (!subjectKey) {
      subjectWrap = el('div',{class:'field'},el('label',{},'Subject'));
      subjectSel = el('select',{class:'u-input'});
      const allSubjects = getAllSubjects();
      Object.entries(allSubjects).forEach(([key,s]) => { const o=el('option',{value:key,class:'u-bg'},s.name); if(key===DEFAULT_SUBJECT_KEY&&allSubjects[DEFAULT_SUBJECT_KEY])o.selected=true; subjectSel.appendChild(o); });
      subjectWrap.appendChild(subjectSel);
    }
    const saveBtn = btn('Create Folder','primary',{full:true,onclick:()=>{
      const name=nameField.querySelector('input').value.trim(); if(!name)return;
      // Read the dropdown's live value rather than a separately-tracked variable, so the
      // folder always gets whatever subject is actually shown as selected (matters when
      // DEFAULT_SUBJECT_KEY has been hidden/removed and isn't a valid fallback anymore).
      const finalSubject = subjectKey || subjectSel?.value || Object.keys(getAllSubjects())[0];
      state.folders.push({id:uid('f'),name,emoji:_folderEmoji,image:_folderImage||null,subjectKey:finalSubject,parentId:parentId||null});
      scheduleSave();closeModal();renderView('decks');showToast('Folder created 📁');
    }});
    createPane.append(nameField,folderIconPicker);
    if(subjectWrap)createPane.append(subjectWrap);
    createPane.append(saveBtn);

    // --- Import pane ---
    const importStatus = el('div',{style:'font-size:12px;color:var(--muted);margin-top:8px;min-height:16px'});
    const importBtn = btn('Import Folder JSON','primary',{full:true});
    importBtn.style.display='none';
    let parsedImport = null;

    const dropZone = el('label',{style:'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:28px;border:2px dashed rgba(255,255,255,0.15);border-radius:10px;cursor:pointer;text-align:center;margin-bottom:10px'},
      el('div',{style:'font-size:28px'},'📂'),
      el('div',{style:'font-size:13px;font-weight:700'},'Click to choose folder JSON'),
      el('div',{class:'u-muted-11'},'.json exported from SCIMA')
    );
    const fileInput = el('input',{type:'file',accept:'.json',style:'display:none',onchange:async e=>{
      const file=e.target.files?.[0]; if(!file)return;
      try {
        const data=JSON.parse(await file.text());
        if(!data.folder||!Array.isArray(data.decks)){importStatus.textContent='❌ Not a valid SCIMA folder export'; return;}
        parsedImport=data;
        const deckCount=data.decks?.length||0, srcCount=data.citedSources?.length||0;
        importStatus.innerHTML=`<span style="color:#22c55e">✓ "${escHtml(data.folder.name)}" — ${deckCount} deck${deckCount!==1?'s':''}, ${srcCount} source${srcCount!==1?'s':''}</span>`;
        importBtn.style.display='';
      } catch { importStatus.textContent='❌ Could not parse file'; }
    }});
    dropZone.appendChild(fileInput);
    importPane.append(dropZone, importStatus, importBtn);

    importBtn.addEventListener('click',()=>{
      if(!parsedImport)return;
      const d=parsedImport;
      // Remap IDs to avoid collisions
      const folderIdMap={};
      const allFolders=[d.folder,...(d.subFolders||[])];
      allFolders.forEach(f=>{ const newId=uid('f'); folderIdMap[f.id]=newId; });
      allFolders.forEach(f=>{
        state.folders.push({...f, id:folderIdMap[f.id], parentId:f.parentId?(folderIdMap[f.parentId]||null):(parentId||null), subjectKey:subjectKey||f.subjectKey});
      });
      // Import cited sources (skip dupes by name)
      const sourceIdMap={};
      (d.citedSources||[]).forEach(src=>{
        const existing=state.sources.find(s=>s.name===src.name);
        if(existing){sourceIdMap[src.id]=existing.id;}
        else{const newId=uid('s');sourceIdMap[src.id]=newId;state.sources.push({...src,id:newId});}
      });
      // Import decks
      (d.decks||[]).forEach(deck=>{
        const newDeckId=uid('d');
        const newFolderId=folderIdMap[deck.folderId]||null;
        state.decks.push({...deck, id:newDeckId, folderId:newFolderId, subject:subjectKey||deck.subject,
          cards:(deck.cards||[]).map(c=>({...c, id:uid('c'),
            citation:c.citation?{...c.citation,sourceId:sourceIdMap[c.citation.sourceId]||c.citation.sourceId,sourceName:undefined,chapterTitle:undefined,excerpt:undefined}:null
          }))
        });
      });
      scheduleSave(); checkAchievements(); closeModal(); renderView('decks');
      showToast(`Folder "${d.folder.name}" imported — ${d.decks?.length||0} decks ✓`);
    });
    body.append(createPane, importPane);

    function switchTab(t) {
      mode=t;
      const activeStyle='background:var(--blue);color:#fff';
      const inactiveStyle='background:rgba(255,255,255,0.06);color:var(--muted)';
      tabCreate.style.cssText=`flex:1;padding:8px;font-size:12px;font-weight:700;font-family:inherit;border:none;cursor:pointer;${t==='create'?activeStyle:inactiveStyle}`;
      tabImport.style.cssText=`flex:1;padding:8px;font-size:12px;font-weight:700;font-family:inherit;border:none;cursor:pointer;${t==='import'?activeStyle:inactiveStyle}`;
      createPane.style.display=t==='create'?'':'none';
      importPane.style.display=t==='import'?'':'none';
    }
  });
}

function openRenameFolderModal(folderId) {
  const folder = state.folders.find(f=>f.id===folderId); if(!folder)return;
  openModal('Edit Folder', body => {
    const nameField = createField('Folder Name','text',folder.name);
    nameField.querySelector('input').value = folder.name;
    let _folderEmoji = folder.emoji || '📁', _folderImage = folder.image || null;
    const iconPicker = mkIconPicker(_folderEmoji, _folderImage, v=>{_folderEmoji=v;}, v=>{_folderImage=v;});
    body.append(nameField, iconPicker, btn('Save','primary',{full:true,onclick:()=>{
      const name=nameField.querySelector('input').value.trim(); if(!name)return;
      folder.name=name; folder.emoji=_folderEmoji; folder.image=_folderImage;
      scheduleSave(); closeModal(); renderView('decks');
    }}));
  });
}

function openCreateDeckModal(subjectKey, folderId) {
  openModal('Create New Deck', body => {
    // Tab bar
    const tabBar = el('div',{style:'display:flex;gap:0;margin-bottom:10px;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,0.1)'});
    const tabCreate = el('button',{style:'flex:1;padding:8px;font-size:12px;font-weight:700;font-family:inherit;border:none;cursor:pointer;background:var(--blue);color:#fff',onclick:()=>switchDeckTab('create')},'+ New Deck');
    const tabImport = el('button',{style:'flex:1;padding:8px;font-size:12px;font-weight:700;font-family:inherit;border:none;cursor:pointer;background:rgba(255,255,255,0.06);color:var(--muted)',onclick:()=>switchDeckTab('import')},'⬆ Import JSON');
    const tabText   = el('button',{style:'flex:1;padding:8px;font-size:12px;font-weight:700;font-family:inherit;border:none;cursor:pointer;background:rgba(255,255,255,0.06);color:var(--muted)',onclick:()=>switchDeckTab('text')},'📄 Import Text');
    tabBar.append(tabCreate, tabImport, tabText);
    body.appendChild(tabBar);

    // --- Community deck browser link ---
    const communityBanner = el('div',{style:'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;margin-bottom:10px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08)'},
      el('div',{style:'font-size:12px;line-height:1.4'},
        el('div',{style:'font-weight:700'},'🌐 Browse Community Decks'),
        el('div',{class:'u-muted-11'},'Find and download decks shared by other users')
      ),
      btn('Open →','ghost',{small:true,onclick:()=>{ window.open('https://study.scima-net.com/community','_blank','noopener'); }})
    );
    body.appendChild(communityBanner);

    const createPane = el('div');
    const importPane = el('div',{style:'display:none'});

    // --- Create pane ---
    const nameField  = createField('Deck Name','text','e.g. Biology 101');
    nameField.querySelector('input').id = 'tutorial-target-deck-name-input';
    let _deckEmoji='📖',_deckImage=null;
    const iconPicker=mkIconPicker('📖',null,function(v){_deckEmoji=v;},function(v){_deckImage=v;});

    const subjectWrap = el('div',{class:'field'},el('label',{},'Subject'));
    const subjectSel = el('select',{class:'u-input'});
    Object.entries(getAllSubjects()).forEach(([key,s]) => { const o=el('option',{value:key,class:'u-bg'},`${s.name} (${s.board})`); if(key===(subjectKey||DEFAULT_SUBJECT_KEY))o.selected=true; subjectSel.appendChild(o); });
    subjectWrap.appendChild(subjectSel);

    const folderWrap = el('div',{class:'field'},el('label',{},'Folder (optional)'));
    const folderSel = el('select',{class:'u-input'});
    folderSel.appendChild(el('option',{value:'',class:'u-bg'},'None (root level)'));
    state.folders.forEach(f => { const o=el('option',{value:f.id,class:'u-bg'},`${f.name} (${getAllSubjects()[f.subjectKey]?.short||f.subjectKey})`); if(f.id===folderId)o.selected=true; folderSel.appendChild(o); });
    folderWrap.appendChild(folderSel);

    const createDeckSubmit = btn('Create Deck','primary',{full:true,onclick:()=>{
      const name=nameField.querySelector('input').value.trim();if(!name)return;
      const fId=folderSel.value||null;
      const finalSubject=fId?(state.folders.find(f=>f.id===fId)?.subjectKey||subjectSel.value):subjectSel.value;
      state.decks.push({id:uid('d'),name,emoji:_deckEmoji,image:_deckImage||null,subject:finalSubject,folderId:fId,color:'var(--blue)',cards:[]});
      scheduleSave();checkAchievements();closeModal();renderView('decks');showToast('Deck created! 📚');
    }});
    createDeckSubmit.id = 'tutorial-target-create-deck-submit';
    createPane.append(nameField,iconPicker,subjectWrap,folderWrap,createDeckSubmit);

    // --- Import pane ---
    const importStatus = el('div',{style:'font-size:12px;color:var(--muted);margin-top:8px;min-height:16px'});
    const importBtn = btn('Import Deck','primary',{full:true});
    importBtn.style.display='none';
    let parsedDeck = null;

    const dropZone = el('label',{style:'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:28px;border:2px dashed rgba(255,255,255,0.15);border-radius:10px;cursor:pointer;text-align:center;margin-bottom:10px'},
      el('div',{style:'font-size:28px'},'🃏'),
      el('div',{style:'font-size:13px;font-weight:700'},'Click to choose deck JSON'),
      el('div',{class:'u-muted-11'},'.json exported from SCIMA')
    );
    const fileInput = el('input',{type:'file',accept:'.json',style:'display:none',onchange:async e=>{
      const file=e.target.files?.[0]; if(!file)return;
      try {
        const data=JSON.parse(await file.text());
        if(!data.deck||!Array.isArray(data.deck.cards)){importStatus.textContent='❌ Not a valid SCIMA deck export'; return;}
        parsedDeck=data;
        const cardCount=data.deck.cards?.length||0, srcCount=data.citedSources?.length||0;
        importStatus.innerHTML=`<span style="color:#22c55e">✓ "${escHtml(data.deck.name)}" — ${cardCount} card${cardCount!==1?'s':''}, ${srcCount} source${srcCount!==1?'s':''}</span>`;
        importBtn.style.display='';
      } catch { importStatus.textContent='❌ Could not parse file'; }
    }});
    dropZone.appendChild(fileInput);
    importPane.append(dropZone, importStatus, importBtn);

    importBtn.addEventListener('click',()=>{
      if(!parsedDeck)return;
      const d=parsedDeck;
      // Import cited sources (skip dupes by name)
      const sourceIdMap={};
      (d.citedSources||[]).forEach(src=>{
        const existing=state.sources.find(s=>s.name===src.name);
        if(existing){sourceIdMap[src.id]=existing.id;}
        else{const newId=uid('s');sourceIdMap[src.id]=newId;state.sources.push({...src,id:newId});}
      });
      // Resolve target folder
      const targetFolderId = folderId || null;
      const targetSubject = targetFolderId ? (state.folders.find(f=>f.id===targetFolderId)?.subjectKey||d.deck.subject||DEFAULT_SUBJECT_KEY) : (subjectKey||d.deck.subject||DEFAULT_SUBJECT_KEY);
      state.decks.push({...d.deck, id:uid('d'), folderId:targetFolderId, subject:targetSubject,
        cards:(d.deck.cards||[]).map(c=>({...c, id:uid('c'),
          citation:c.citation?{...c.citation,sourceId:sourceIdMap[c.citation.sourceId]||c.citation.sourceId,sourceName:undefined,chapterTitle:undefined,excerpt:undefined}:null
        }))
      });
      scheduleSave(); checkAchievements(); closeModal(); renderView('decks');
      showToast(`"${d.deck.name}" imported — ${d.deck.cards?.length||0} cards ✓`);
    });



    // --- Text import pane ---
    const textPane = el('div',{style:'display:none'});

    // Deck name for the imported text deck
    const txtDeckNameField = createField('New Deck Name','text','e.g. Vocab from notes');

    // Delimiter config
    const delimWrap = el('div',{class:'field'});
    delimWrap.appendChild(el('label',{},'Front / Back Delimiter'));
    const delimSelect = el('select',{style:'width:100%;padding:8px 12px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid var(--border);color:var(--text);font-size:13px;font-family:inherit;outline:none;margin-bottom:6px'});
    [
      { label:'Any dash / arrow (— – - →)',  value:'anydash'  },
      { label:'— Em dash (—)',                value:'emdash'   },
      { label:'- Hyphen (-)',                  value:'hyphen'   },
      { label:'– En dash (–)',                 value:'endash'   },
      { label:'→ Arrow (→)',                   value:'arrow'    },
      { label:'| Pipe (|)',                    value:'pipe'     },
      { label:':: Double colon (::)',          value:'dcolon'   },
      { label:': Colon (:)',                   value:'colon'    },
      { label:'\\t Tab',                       value:'tab'      },
      { label:'Custom…',                       value:'custom'   },
    ].forEach(o => { const opt=el('option',{value:o.value},o.label); delimSelect.appendChild(opt); });
    delimWrap.appendChild(delimSelect);

    const customDelimWrap = el('div',{style:'display:none'});
    const customDelimInp = el('input',{type:'text',placeholder:'e.g.  =>',style:'width:100%;padding:8px 12px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:var(--text);font-size:13px;font-family:inherit;outline:none;box-sizing:border-box'});
    customDelimWrap.appendChild(customDelimInp);
    delimWrap.appendChild(customDelimWrap);
    delimSelect.addEventListener('change', () => {
      customDelimWrap.style.display = delimSelect.value === 'custom' ? 'block' : 'none';
      rebuildPreview();
    });

    // File drop zone (accepts .txt, .md, .pdf)
    const txtFileInput = el('input',{type:'file',accept:'.txt,.md,.pdf',style:'display:none'});
    const txtDropZone = el('label',{style:'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:24px;border:2px dashed rgba(255,255,255,0.15);border-radius:10px;cursor:pointer;text-align:center;margin-bottom:10px'},
      el('div',{style:'font-size:28px'},'📄'),
      el('div',{style:'font-size:13px;font-weight:700'},'Click to choose file'),
      el('div',{class:'u-muted-11'},'.txt · .md · .pdf')
    );
    txtDropZone.appendChild(txtFileInput);

    // OR paste textarea
    const pasteLabel = el('div',{style:'font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;margin-top:2px'},'— or paste text —');
    const pasteArea = el('textarea',{rows:'5',placeholder:'Paste your lines here…\ne.g.\nMitosis — Cell division producing identical daughter cells\nMeiosis — Division producing gametes with half the chromosomes',style:'width:100%;padding:8px 12px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:var(--text);font-size:12px;font-family:inherit;outline:none;resize:vertical;box-sizing:border-box'});

    // Preview area
    const previewWrap = el('div',{style:'margin-top:10px;display:none'});
    const previewLabel = el('div',{style:'font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px'},'Preview');
    const previewList = el('div',{style:'max-height:160px;overflow-y:auto;display:flex;flex-direction:column;gap:4px'});
    const previewCount = el('div',{style:'font-size:11px;color:var(--muted);margin-top:6px'});
    previewWrap.append(previewLabel, previewList, previewCount);

    const txtImportBtn = btn('Import into Deck','primary',{full:true});
    txtImportBtn.style.display = 'none';
    const txtStatus = el('div',{style:'font-size:12px;color:var(--muted);margin-top:6px;min-height:14px'});

    let parsedTextCards = [];

    function getDelimiterRegex() {
      const v = delimSelect.value;
      if (v === 'anydash')  return /\s*[—–→]\s*|\s+-\s+/;
      if (v === 'emdash')   return /\s*—\s*/;
      if (v === 'hyphen')  return /\s+-\s+/;
      if (v === 'endash')  return /\s*–\s*/;
      if (v === 'arrow')    return /\s*→\s*/;
      if (v === 'pipe')    return /\s*\|\s*/;
      if (v === 'dcolon')  return /\s*::\s*/;
      if (v === 'colon')   return /\s*:\s*/;
      if (v === 'tab')     return /\t/;
      if (v === 'custom') {
        const raw = customDelimInp.value;
        if (!raw) return null;
        return new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      }
      return null;
    }

    function parseTextToCards(text) {
      const re = getDelimiterRegex();
      if (!re) return [];
      return text.split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('#') && re.test(l))
        .map(l => {
          // Strip leading list numbering: "1. ", "12. ", etc.
          l = l.replace(/^\d+\.\s+/, '');
          const idx = l.search(re);
          const match = l.match(re);
          const front = l.slice(0, idx).trim();
          const back  = l.slice(idx + match[0].length).trim();
          return front && back ? { front, back } : null;
        })
        .filter(Boolean);
    }

    function rebuildPreview() {
      const raw = rawText || pasteArea.value;
      parsedTextCards = parseTextToCards(raw);
      previewList.innerHTML = '';
      if (!parsedTextCards.length) {
        previewWrap.style.display = 'none';
        txtImportBtn.style.display = 'none';
        txtStatus.textContent = raw.trim() ? '⚠️ No cards matched — check your delimiter' : '';
        return;
      }
      previewWrap.style.display = '';
      txtImportBtn.style.display = '';
      txtStatus.textContent = '';
      parsedTextCards.slice(0, 6).forEach(c => {
        previewList.appendChild(el('div',{style:'display:flex;gap:6px;font-size:12px;background:rgba(255,255,255,0.04);border-radius:6px;padding:5px 8px;align-items:flex-start'},
          el('span',{style:'flex:1;color:var(--text)'},c.front),
          el('span',{style:'color:var(--muted);padding:0 4px'},'→'),
          el('span',{style:'flex:1;color:var(--muted)'},c.back)
        ));
      });
      previewCount.textContent = parsedTextCards.length > 6 ? `…and ${parsedTextCards.length - 6} more (${parsedTextCards.length} total)` : `${parsedTextCards.length} card${parsedTextCards.length!==1?'s':''}`;
    }

    let rawText = '';

    // PDF text extraction using the already-bundled pdf.js
    async function extractPdfText(file) {
      const arrayBuffer = await file.arrayBuffer();
      const pdfjsLib = await new Promise(resolve => {
        if (window.pdfjsLib) { resolve(window.pdfjsLib); return; }
        const s = document.createElement('script');
        s.src = assetUrl('lib/pdf.min.js');
        s.onload = () => resolve(window.pdfjsLib);
        document.head.appendChild(s);
      });
      pdfjsLib.GlobalWorkerOptions.workerSrc = assetUrl('lib/pdf.worker.min.js');
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      // Collect all text items with position across all pages
      const allItems = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        // Normalise Y so page 2 items come after page 1
        const pageOffset = (i - 1) * vp.height * 1000;
        for (const item of content.items) {
          if (!item.str.trim()) continue;
          allItems.push({
            str: item.str,
            x: item.transform[4],
            // PDF y is bottom-up; flip it so top of page = small number
            y: pageOffset + (vp.height - item.transform[5]),
            h: item.height || 10,
          });
        }
      }

      // Sort top-to-bottom, left-to-right
      allItems.sort((a, b) => a.y - b.y || a.x - b.x);

      // Group into visual lines by Y proximity (within 40% of item height)
      const visualLines = [];
      for (const item of allItems) {
        const last = visualLines[visualLines.length - 1];
        if (last && Math.abs(item.y - last.y) <= (item.h || 10) * 0.6) {
          last.items.push(item);
        } else {
          visualLines.push({ y: item.y, items: [item] });
        }
      }

      // Render each visual line as text
      const rawLines = visualLines.map(line => {
        line.items.sort((a, b) => a.x - b.x);
        return line.items.map(it => it.str).join('').trim();
      }).filter(Boolean);

      // Detect if this looks like a numbered list (≥30% of non-blank lines start with "N.")
      const numberedRe = /^\d+\.\s/;
      const numberedCount = rawLines.filter(l => numberedRe.test(l)).length;
      const isNumbered = numberedCount / rawLines.length >= 0.25;

      if (isNumbered) {
        // Reconstruct logical entries: join wrapped continuation lines back onto
        // the numbered line they belong to, producing one entry per number.
        const entries = [];
        for (const line of rawLines) {
          if (numberedRe.test(line)) {
            entries.push(line); // start a new logical entry
          } else if (entries.length && line && !line.match(/^(CORE KNOWLEDGE|[A-Z ]{6,})$/)) {
            // Continuation of previous entry — join with a space
            entries[entries.length - 1] += ' ' + line;
          }
          // Skip standalone headers/page labels entirely
        }
        return entries.join('\n');
      }

      // Fallback: return raw visual lines as-is
      return rawLines.join('\n');
    }

    txtFileInput.addEventListener('change', async e => {
      const file = e.target.files?.[0]; if (!file) return;
      txtStatus.textContent = 'Reading file…';
      try {
        if (file.name.endsWith('.pdf')) {
          rawText = await extractPdfText(file);
        } else {
          rawText = await file.text();
        }
        txtDropZone.querySelector('div:nth-child(2)').textContent = `✓ ${file.name}`;
        pasteArea.value = '';
        txtStatus.textContent = '';
        rebuildPreview();
      } catch { txtStatus.textContent = '❌ Could not read file'; }
    });

    pasteArea.addEventListener('input', () => { rawText = ''; rebuildPreview(); });
    delimSelect.addEventListener('change', rebuildPreview);
    customDelimInp.addEventListener('input', rebuildPreview);

    txtImportBtn.addEventListener('click', () => {
      const name = txtDeckNameField.querySelector('input').value.trim();
      if (!name) { txtDeckNameField.querySelector('input').focus(); return; }
      if (!parsedTextCards.length) return;
      const fId = folderId || null;
      const finalSubject = fId ? (state.folders.find(f=>f.id===fId)?.subjectKey || subjectKey || DEFAULT_SUBJECT_KEY) : (subjectKey || DEFAULT_SUBJECT_KEY);
      const newDeck = {
        id: uid('d'), name, emoji: '📄', image: null,
        subject: finalSubject, folderId: fId, color: 'var(--blue)',
        cards: parsedTextCards.map(c => ({
          id: uid('c'), front: c.front, back: c.back, hint: '', tags: [],
          type: 'basic', ease: 2.5, interval: 0, reps: 0, lapses: 0,
          due: Date.now(), state: 'new', created: Date.now(), source: null,
        }))
      };
      state.decks.push(newDeck);
      scheduleSave(); checkAchievements(); closeModal(); renderView('decks');
      showToast(`"${name}" imported — ${parsedTextCards.length} cards 📄`);
    });

    textPane.append(txtDeckNameField, delimWrap, txtDropZone, pasteLabel, pasteArea, txtStatus, previewWrap, txtImportBtn);
    body.append(createPane, importPane, textPane);

    function switchDeckTab(t) {
      const activeStyle='background:var(--blue);color:#fff';
      const inactiveStyle='background:rgba(255,255,255,0.06);color:var(--muted)';
      tabCreate.style.cssText=`flex:1;padding:8px;font-size:12px;font-weight:700;font-family:inherit;border:none;cursor:pointer;${t==='create'?activeStyle:inactiveStyle}`;
      tabImport.style.cssText=`flex:1;padding:8px;font-size:12px;font-weight:700;font-family:inherit;border:none;cursor:pointer;${t==='import'?activeStyle:inactiveStyle}`;
      tabText.style.cssText  =`flex:1;padding:8px;font-size:12px;font-weight:700;font-family:inherit;border:none;cursor:pointer;${t==='text'?activeStyle:inactiveStyle}`;
      createPane.style.display=t==='create'?'':'none';
      importPane.style.display=t==='import'?'':'none';
      textPane.style.display  =t==='text'  ?'':'none';
    }
  });
}

function openDeckDetail(deckId) {
  const deck = state.decks.find(d=>d.id===deckId); if(!deck)return;
  const container = document.getElementById('view-decks');
  container.innerHTML = '';
  let search = '';

  // ── Multiselect state (file-explorer style: click / shift-click / ctrl-click / drag-select) ──
  const selected = new Set();
  let anchorId = null;
  const cardElById = new Map();

  const searchInput = el('input',{type:'text',placeholder:'Search cards…',style:'padding:8px 12px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:var(--text);font-size:12px;font-family:inherit;outline:none;width:200px'});
  let _searchDebounce = null;
  searchInput.addEventListener('input', e => {
    clearTimeout(_searchDebounce);
    _searchDebounce = setTimeout(() => {
      search=e.target.value.toLowerCase(); selected.clear(); anchorId=null; renderCards();
    }, 200);
  });

  const pinToggleBtn = el('button', {
    class: `btn btn-ghost btn-sm pin-toggle${deck.pinned?' pinned':''}`,
    title: deck.pinned ? 'Unpin from sidebar' : 'Pin to sidebar',
    onclick: () => { togglePinDeck(deckId); pinToggleBtn.classList.toggle('pinned', state.decks.find(d=>d.id===deckId)?.pinned); }
  }, '📌');

  container.append(
    el('div',{style:'display:flex;align-items:center;gap:12px;margin-bottom:20px'},
      btn('← Back','ghost',{small:true,onclick:()=>renderView('decks')}),
      mkIcon(deck.emoji,deck.image,'36px','8px'),
      el('div',{},el('div',{style:'font-weight:900;font-size:18px'},deck.name),el('div',{class:'u-muted-12'},`${deck.cards.length} cards`)),
      el('div',{style:'margin-left:auto;display:flex;gap:8px;align-items:center'},pinToggleBtn,searchInput,(()=>{ const b=btn('+ Add Card','primary',{onclick:()=>openCardModal(deckId,null)}); b.id='tutorial-target-add-card'; return b; })())
    )
  );

  const selectionBar = el('div',{class:'selection-bar',style:'display:none'});
  container.appendChild(selectionBar);

  const grid = el('div',{class:'grid-2',id:'card-grid',style:'position:relative'});
  container.appendChild(grid);

  function renderSelectionBar() {
    selectionBar.innerHTML = '';
    if(!selected.size){ selectionBar.style.display='none'; return; }
    selectionBar.style.display='flex';
    selectionBar.append(
      el('span',{},`${selected.size} card${selected.size>1?'s':''} selected`),
      el('span',{style:'margin-left:auto;display:flex;gap:8px'},
        btn('Select All','ghost',{small:true,onclick:()=>{ cardElById.forEach((_,id)=>selected.add(id)); anchorId=[...cardElById.keys()].pop()||anchorId; syncSelectionVisuals(); }}),
        btn('Clear','ghost',{small:true,onclick:()=>{ selected.clear(); anchorId=null; syncSelectionVisuals(); }}),
        btn('▶ Study Selected','ghost',{small:true,onclick:()=>{
          state.studyScope=[{type:'deck',id:deckId}];
          state.studyRefine.mode='cards';
          state.studyRefine.cardIds=[...selected];
          navigate('study');
        }}),
        btn('Move to Deck…','primary',{small:true,onclick:()=>openMoveCardsModal(deckId,[...selected])})
      )
    );
  }

  function syncSelectionVisuals() {
    cardElById.forEach((elm,id)=>elm.classList.toggle('card-selected', selected.has(id)));
    renderSelectionBar();
  }

  function selectSingle(id){ selected.clear(); selected.add(id); anchorId=id; }
  function selectToggle(id){ if(selected.has(id)) selected.delete(id); else selected.add(id); anchorId=id; }
  function selectRange(id, filteredIds, additive){
    const from = filteredIds.indexOf(anchorId), to = filteredIds.indexOf(id);
    if(from===-1||to===-1){ selectSingle(id); return; }
    if(!additive) selected.clear();
    const [lo,hi] = from<to?[from,to]:[to,from];
    for(let i=lo;i<=hi;i++) selected.add(filteredIds[i]);
  }

  // ── Rubber-band drag-select ──
  let dragBox=null, dragStart=null, dragBaseline=null;
  function onDragMove(e){
    if(!dragStart) return;
    const x1=Math.min(dragStart.x,e.clientX), x2=Math.max(dragStart.x,e.clientX);
    const y1=Math.min(dragStart.y,e.clientY), y2=Math.max(dragStart.y,e.clientY);
    dragBox.style.left=x1+'px'; dragBox.style.top=y1+'px'; dragBox.style.width=(x2-x1)+'px'; dragBox.style.height=(y2-y1)+'px';
    selected.clear(); dragBaseline.forEach(id=>selected.add(id));
    cardElById.forEach((elm,id) => {
      const r=elm.getBoundingClientRect();
      const intersects = r.left<x2 && r.right>x1 && r.top<y2 && r.bottom>y1;
      if(intersects) selected.add(id);
    });
    syncSelectionVisuals();
  }
  function onDragEnd(){
    dragStart=null; dragBaseline=null;
    if(dragBox){ dragBox.remove(); dragBox=null; }
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', onDragEnd);
  }
  grid.addEventListener('mousedown', e => {
    if(e.button!==0) return;
    if(e.target.closest('.card')) return; // clicks on cards are handled by their own listener
    dragStart={x:e.clientX,y:e.clientY};
    dragBaseline = new Set((e.shiftKey||e.ctrlKey||e.metaKey) ? selected : []);
    selected.clear(); dragBaseline.forEach(id=>selected.add(id));
    dragBox = el('div',{class:'drag-select-box'});
    document.body.appendChild(dragBox);
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragEnd);
    e.preventDefault();
  });

  function renderCards() {
    grid.innerHTML = '';
    cardElById.clear();
    const d = state.decks.find(dd=>dd.id===deckId); if(!d)return;
    const filtered = d.cards.filter(c=>!search||cardSearchBlob(c).includes(search));
    const filteredIds = filtered.map(c=>c.id);
    if(!filtered.length){
      if(d.cards.length===0){
        grid.appendChild(el('div',{style:'grid-column:1/-1;text-align:center;padding:40px'},
          el('div',{style:'font-size:32px;margin-bottom:8px'},'🃏'),
          el('div',{style:'color:var(--muted);margin-bottom:14px'},'No cards yet'),
          btn('+ Add First Card','primary',{onclick:()=>openCardModal(deckId,null)})
        ));
      } else {
        grid.appendChild(el('div',{style:'grid-column:1/-1;text-align:center;padding:40px;color:var(--muted)'},'No cards match.'));
      }
      renderSelectionBar();
      return;
    }
    filtered.forEach(card => {
      const stateColor = card.suspended?'#6B7280':card.leech?'#FB923C':card.state==='new'?'#A78BFA':card.state==='review'?'var(--blue)':'var(--pink)';
      const source = card.citation ? state.sources.find(s=>s.id===card.citation.sourceId) : null;
      const cardEl = el('div',{class:`card card-selectable${selected.has(card.id)?' card-selected':''}`,style:'padding:16px',onclick:e=>{
        if(e.target.closest('button')) return;
        // Sticky multi-select: a plain click toggles this card in/out of the
        // selection (so clicking a selected card deselects it, and picking
        // several cards doesn't need Ctrl/Cmd held down). Shift+click still
        // does a range-select from the last-clicked card, extending whatever
        // is already selected rather than replacing it.
        if(e.shiftKey && anchorId) selectRange(card.id, filteredIds, true);
        else selectToggle(card.id);
        syncSelectionVisuals();
      }},
        card.frontImage?el('img',{src:card.frontImage,style:'width:100%;height:80px;object-fit:cover;border-radius:6px;margin-bottom:8px'}):null,
        setRichText(el('div',{style:'font-size:13px;font-weight:700;margin-bottom:6px;line-height:1.4'}),formatCardFront(card)),
        setRichText(el('div',{style:'font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.4'}),formatCardBack(card)),
        el('div',{style:'display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px'},
          ...(card.tags||[]).map(t=>mkTag(t)),
          mkTag(card.suspended?'suspended':card.state,stateColor),
          card.leech ? mkTag('🩹 leech','#FB923C') : null,
          source ? mkTag(`📖 ${source.name.slice(0,20)}`,'#A78BFA') : null
        ),
        el('div',{style:'display:flex;gap:6px;align-items:center'},
          btn('Edit','ghost',{small:true,onclick:()=>openCardModal(deckId,card.id)}),
          btn('Delete','danger',{small:true,onclick:()=>{ deleteCard(deckId,card.id); selected.delete(card.id); renderCards(); }}),
          card.leech||card.suspended ? btn(card.suspended?'Unsuspend':'Suspend','ghost',{small:true,onclick:()=>{ card.suspended=!card.suspended; scheduleSave(); renderCards(); }}) : null,
          source ? btn('📖 Source','ghost',{small:true,onclick:()=>openCitationViewer(card.citation)}) : null,
          el('span',{style:'margin-left:auto;font-size:10px;color:var(--muted)',title:fmtDateTime(card.lastRated)},`ease ${card.ease?.toFixed(1)} · ${card.interval}d · 🕒 ${timeAgo(card.lastRated)}`)
        )
      );
      cardElById.set(card.id, cardEl);
      grid.appendChild(cardEl);
    });
    renderSelectionBar();
  }
  renderCards();
}

function moveCardsToDeck(sourceDeckId, targetDeckId, cardIds) {
  const source = state.decks.find(d=>d.id===sourceDeckId);
  const target = state.decks.find(d=>d.id===targetDeckId);
  if(!source||!target||source.id===target.id||!cardIds.length) return;
  const idSet = new Set(cardIds);
  const moving = source.cards.filter(c=>idSet.has(c.id));
  source.cards = source.cards.filter(c=>!idSet.has(c.id));
  target.cards.push(...moving);
  scheduleSave();
}

function openMoveCardsModal(deckId, cardIds) {
  const source = state.decks.find(d=>d.id===deckId); if(!source||!cardIds.length) return;
  const count = cardIds.length;
  openModal(`Move ${count} Card${count>1?'s':''}`, body => {
    body.appendChild(el('div',{style:'font-size:12px;color:var(--muted);margin-bottom:16px'},`Choose a destination deck for the selected card${count>1?'s':''}.`));

    const others = state.decks.filter(d=>d.id!==deckId);
    if(others.length){
      body.appendChild(el('div',{class:'u-section-label'},'Move to Existing Deck'));
      const sel=el('select',{style:'width:100%;padding:9px 12px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid var(--border);color:var(--text);font-size:13px;font-family:inherit;outline:none;margin-bottom:8px'});
      others.forEach(d=>sel.appendChild(el('option',{value:d.id,class:'u-bg'},`${d.emoji||'📚'} ${d.name} (${d.cards.length})`)));
      body.append(sel, btn('Move →','primary',{full:true,onclick:()=>{
        const targetId=sel.value;
        moveCardsToDeck(deckId, targetId, cardIds);
        closeModal(); showToast(`Moved ${count} card${count>1?'s':''} 📦`);
        openDeckDetail(deckId);
      }}));
    } else {
      body.appendChild(el('div',{style:'font-size:12px;color:var(--muted);margin-bottom:16px'},'No other decks yet — create one below.'));
    }

    body.appendChild(el('div',{style:'border-top:1px solid var(--border);margin-top:16px;padding-top:14px'}));
    body.appendChild(el('div',{class:'u-section-label'},'Or Move to a New Deck'));
    const nameField = createField('New Deck Name','text','e.g. Chapter 4 Terms');
    let _emoji='📖', _img=null;
    const iconPicker = mkIconPicker('📖',null,v=>{_emoji=v;},v=>{_img=v;});
    body.append(nameField, iconPicker, btn('Create & Move','primary',{full:true,onclick:()=>{
      const name=nameField.querySelector('input').value.trim();
      if(!name){ showToast('Enter a deck name'); return; }
      const newDeck={id:uid('d'),name,emoji:_emoji,image:_img||null,subject:source.subject,folderId:source.folderId,color:'var(--blue)',cards:[]};
      state.decks.push(newDeck);
      moveCardsToDeck(deckId, newDeck.id, cardIds);
      checkAchievements();
      closeModal(); showToast(`Created "${name}" and moved ${count} card${count>1?'s':''} 📦`);
      openDeckDetail(deckId);
    }}));
  });
}

function deleteCard(deckId, cardId) {
  const deck = state.decks.find(d=>d.id===deckId);
  if(deck){ deck.cards=deck.cards.filter(c=>c.id!==cardId); scheduleSave(); }
}

function openCardModal(deckId, cardId) {
  const deck = state.decks.find(d=>d.id===deckId); if(!deck)return;
  const existing = cardId ? deck.cards.find(c=>c.id===cardId) : null;
  const isEdit = !!existing;
  openModal(isEdit?'Edit Card':'Add Card', body => {
    const frontField = createField('Front (Question)','text','What is…?',true);
    frontField.querySelector('textarea').id = 'tutorial-target-card-front-input';
    let _frontImage=existing&&existing.frontImage||null;
    const frontImgPicker=mkCardImagePicker('Front image (optional)',_frontImage,function(v){_frontImage=v;});
    const backField  = createField('Back (Answer)','text','The answer is…',true);
    backField.querySelector('textarea').id = 'tutorial-target-card-back-input';
    let _backImage=existing&&existing.backImage||null;
    const backImgPicker=mkCardImagePicker('Back image (optional)',_backImage,function(v){_backImage=v;});
    const hintField  = createField('Hint (optional)','text','Brief clue…');
    const tagsField  = createField('Tags (comma-separated)','text','biology, cell');
    if(existing){
      frontField.querySelector('textarea').value = existing.front;
      backField.querySelector('textarea').value  = existing.back;
      hintField.querySelector('input').value     = existing.hint||'';
      tagsField.querySelector('input').value     = (existing.tags||[]).join(', ');
    }

    // ── Card mode: Basic / Multi-answer / Mark scheme / Process / Calculation ──
    // Basic, Multi-answer, Mark scheme and Process all share the same underlying
    // pool+required-count machinery — the pool is stored in `back`, one item per
    // line ("\n"-joined) — see sanitizeCard()/getCardAnswers() in
    // shared.js/dashboard-core.js — so every existing consumer of card.back
    // (search, flashcard rendering, export) keeps working unmodified. They
    // differ only in labels, minimum pool size, and the resulting card.type:
    //  - 'basic': a single answer. back field, no pool.
    //  - 'multi' (card.type stays 'basic'): several equally-weighted valid
    //    answers (e.g. "name a country in the EU" -> France/Germany/Italy),
    //    with `requiredAnswers` of them asked for in Written Quiz to earn full
    //    marks — a card can offer 5 valid answers but only require 2. Fill in
    //    the Gaps ignores the required count entirely — it always blanks
    //    exactly one pool item and shows the rest as context (see
    //    renderGapCard() in dashboard-study.js).
    //  - 'markscheme' (card.type='markscheme'): front is an exam-style
    //    question, `requiredAnswers` is how many marks it's worth (shown as
    //    "(N marks)" appended to the front wherever it's displayed — see
    //    formatCardFront() in dashboard-core.js — never baked into the stored
    //    text), and the pool holds the mark scheme's keyword/marking points.
    //    Written Quiz asks for one free-text paragraph answer and spots which
    //    keywords appear in it, rather than one box per pool item (see
    //    markschemeMatch()/renderQuizCard() in dashboard-study.js/
    //    dashboard-core.js). A question can be worth just 1 mark, so the pool
    //    minimum is 1 here versus 2 for plain multi-answer.
    //  - 'process' (card.type='process'): like markscheme, but the pool is an
    //    ORDERED chain of steps (fertilizer runoff -> waterways -> algae bloom
    //    -> ...), each with its own optional synonym list (`synonyms`, index-
    //    aligned with the pool) so a paraphrase of a step still counts — see
    //    processStepMatch() in dashboard-core.js. Written Quiz shows one box
    //    per step (in order, not a free-text paragraph) plus a Skip button,
    //    since keyword matching on a causal-chain step can be too rigid — see
    //    renderQuizCard()'s process branch in dashboard-study.js.
    // 'calculation' (card.type='calculation') is its own thing, not part of the
    // pool family: `back` holds the canonical numeric answer, matched via
    // calcMatch()'s numeric comparator instead of any text/keyword matching. It
    // has its own fields (calcUnit/calcTolerance/calcToleranceMode) plus an
    // optional separate mark-scheme-style pool of its own for method/working
    // marks (`methodPool`/`methodRequired`) — see the calcSection below.
    function initialCardMode(){
      if(!existing) return 'basic';
      if(existing.type === 'markscheme') return 'markscheme';
      if(existing.type === 'process') return 'process';
      if(existing.type === 'calculation') return 'calculation';
      if(existing.type === 'table') return 'table';
      return (existing.answerCount||1) > 1 ? 'multi' : 'basic';
    }
    let cardMode = initialCardMode();
    function minPoolSize(){ return cardMode==='markscheme' ? 1 : cardMode==='process' ? 2 : 2; }

    const modeRow = el('div',{style:'display:flex;flex-wrap:wrap;flex-shrink:0;gap:0;margin:4px 0 10px;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,0.1)'});
    const modeButtons = {};
    function mkModeBtn(id,label,title){
      const b = el('button',{type:'button',title,style:'flex:1;min-width:96px;padding:8px 4px;font-size:11px;font-weight:700;font-family:inherit;border:none;cursor:pointer;background:rgba(255,255,255,0.06);color:var(--muted)'},label);
      b.addEventListener('click',()=>setCardMode(id));
      modeButtons[id]=b;
      return b;
    }
    modeRow.append(
      mkModeBtn('basic','Basic','One question, one answer'),
      mkModeBtn('multi','Multi-answer','Several valid answers — e.g. "name a country in the EU"'),
      mkModeBtn('markscheme','🧬 Mark scheme','Exam-style: question worth N marks, back is a keyword mark scheme'),
      mkModeBtn('process','🔗 Process','Ordered chain of steps — e.g. fertilizer runoff → waterways → algae bloom'),
      mkModeBtn('calculation','🧮 Calculation','Word problem with a numeric answer — tolerance, units, optional method marks'),
      mkModeBtn('table','▦ Table','A data grid with some cells blanked out for the learner to fill in')
    );
    function refreshModeButtons(){
      Object.entries(modeButtons).forEach(([id,b])=>{
        const active = cardMode===id;
        b.style.background = active ? 'var(--blue)' : 'rgba(255,255,255,0.06)';
        b.style.color = active ? '#fff' : 'var(--muted)';
      });
    }

    const poolLabel = el('div',{style:'font-size:12px;font-weight:600;margin-bottom:6px'},'Valid answers');
    const answerPoolList = el('div',{});
    let poolBoxes = []; // [{row, input, synRow, synInput}]

    function poolNoun(){ return cardMode==='markscheme' ? 'Marking point' : cardMode==='process' ? 'Step' : 'Answer'; }
    function renumberPlaceholders(){
      const noun = poolNoun();
      poolBoxes.forEach((b,i)=>{ b.input.placeholder = `${noun} ${i+1}…`; });
    }
    // syncRequiredMax() clamps the actual field VALUE, and is only called when
    // the pool's size changes structurally (add/remove/init/mode-switch) — at
    // those points the old value may now genuinely be out of range and needs
    // fixing. It must NOT also run on every keystroke in the field itself: an
    // 'input' listener that force-clamps would rewrite the value back to max
    // the instant the user select-all+deletes it to type a smaller number,
    // making it impossible to type anything but the up/down arrows.
    function syncRequiredMax(){
      const max = Math.max(1, poolBoxes.length);
      requiredInput.max = String(max);
      let v = parseInt(requiredInput.value,10);
      if(!Number.isFinite(v) || v<1 || v>max) v = max;
      requiredInput.value = String(v);
      updateRequiredPreview();
    }
    // What the field's value WOULD resolve to right now, without mutating it —
    // used by both previews so they stay consistent while the field is empty
    // or mid-edit (e.g. showing "defaults to all N" while the box is cleared).
    function currentRequiredValue(){
      const max = Math.max(1, poolBoxes.length);
      const raw = requiredInput.value.trim();
      const parsed = raw==='' ? NaN : parseInt(raw,10);
      return Number.isFinite(parsed) ? Math.min(Math.max(parsed,1), max) : max;
    }
    // synValue is only meaningful for cardMode==='process' — a comma-separated
    // string of accepted synonyms for this step, shown as a smaller secondary
    // input directly under the step's own box so it reads as "belonging" to it.
    function addAnswerBox(value, opts={}, synValue) {
      if(poolBoxes.length>=8){ showToast(`Maximum 8 ${poolNoun().toLowerCase()}s`); return; }
      const noun = poolNoun();
      const input = el('input',{type:'text',placeholder:`${noun} ${poolBoxes.length+1}…`,style:'flex:1'});
      input.value = value||'';
      const removeBtn = el('button',{type:'button',class:'btn btn-sm btn-ghost',style:'padding:6px 10px',title:'Remove this'},'✕');
      const row = el('div',{style:'display:flex;gap:6px;margin-bottom:6px'},input,removeBtn);
      let synInput = null, synRow = null;
      if(cardMode==='process'){
        synInput = el('input',{type:'text',placeholder:'Accepted synonyms, comma-separated (optional)…',style:'flex:1;font-size:11px;opacity:0.85'});
        synInput.value = synValue||'';
        synRow = el('div',{style:'display:flex;gap:6px;margin:-2px 0 8px 0;padding-left:2px'},synInput);
      }
      const box = {row,input,synRow,synInput};
      removeBtn.addEventListener('click',()=>{
        if(poolBoxes.length<=minPoolSize()){ showToast(cardMode==='markscheme' ? 'A mark scheme needs at least 1 marking point' : cardMode==='process' ? 'A process needs at least 2 steps' : 'A multi-answer card needs at least 2 answers'); return; }
        const idx=poolBoxes.findIndex(b=>b.row===row);
        if(idx>=0) poolBoxes.splice(idx,1);
        row.remove();
        if(synRow) synRow.remove();
        renumberPlaceholders();
        syncRequiredMax();
      });
      answerPoolList.appendChild(row);
      if(synRow) answerPoolList.appendChild(synRow);
      poolBoxes.push(box);
      if(!opts.silent) syncRequiredMax();
    }
    function initPool(values, synValuesList){
      answerPoolList.innerHTML=''; poolBoxes=[];
      const seed = (values && values.length) ? values : (cardMode==='markscheme' ? [''] : ['','']);
      seed.forEach((v,i)=>addAnswerBox(v,{silent:true},synValuesList?synValuesList[i]:undefined));
    }
    const addAnswerBtn = btn('+ Add','ghost',{small:true,onclick:()=>{ addAnswerBox(''); poolBoxes[poolBoxes.length-1].input.focus(); }});
    const poolSection = el('div',{class:'field'},poolLabel,answerPoolList,addAnswerBtn);

    const requiredField = createField('Answers required for full marks','number','1');
    const requiredLabel = requiredField.querySelector('label');
    const requiredInput = requiredField.querySelector('input');
    requiredInput.min='1'; requiredInput.step='1';
    const requiredPreview = el('div',{style:'font-size:11px;color:var(--muted);margin-top:4px'});
    const frontPreview = el('div',{style:'font-size:11px;color:var(--muted);margin:-6px 0 8px'});
    function updateFrontPreview(){
      if(cardMode!=='markscheme' && cardMode!=='process'){ frontPreview.style.display='none'; return; }
      frontPreview.style.display='';
      const n = currentRequiredValue();
      const frontText = frontField.querySelector('textarea').value.trim() || 'Your question…';
      frontPreview.textContent = `Shown as: "${frontText} (${n} mark${n===1?'':'s'})"`;
    }
    function updateLabels(){
      poolLabel.textContent = cardMode==='markscheme' ? 'Marking points (keywords)' : cardMode==='process' ? 'Steps (in order)' : 'Valid answers';
      requiredLabel.textContent = (cardMode==='markscheme'||cardMode==='process') ? 'Marks available' : 'Answers required for full marks';
    }
    function updateRequiredPreview(){
      const n = currentRequiredValue();
      requiredPreview.textContent = cardMode==='markscheme'
        ? `Written Quiz will award full marks once ${n} keyword${n===1?'':'s'} ${n===1?'is':'are'} found in your answer.`
        : cardMode==='process'
        ? `Written Quiz will award full marks once ${n} of the ${poolBoxes.length} step${poolBoxes.length===1?'':'s'} ${n===1?'is':'are'} answered correctly.`
        : `Written Quiz will show: "Give ${n} answer${n===1?'':'s'}."`;
      updateFrontPreview();
    }
    // Live typing: just keep the max attribute (native up/down arrows) current
    // and refresh the preview text — deliberately does not touch the field's
    // value, so clearing it (select-all + delete) to type a smaller number
    // leaves it genuinely empty instead of snapping back to the max.
    requiredInput.addEventListener('input',()=>{
      requiredInput.max = String(Math.max(1, poolBoxes.length));
      updateRequiredPreview();
    });
    // Leaving the field is when we actually finalize/clamp it — an empty or
    // invalid value defaults to the full pool (same as the original
    // backward-compatible default), same as always leaving it untouched did.
    requiredInput.addEventListener('blur',syncRequiredMax);
    frontField.querySelector('textarea').addEventListener('input',updateFrontPreview);

    // ── Calculation-only fields: numeric answer + tolerance/unit + optional
    // method-marks pool. Kept entirely separate from the pool machinery above
    // (poolSection/requiredField) since a calculation card's `back` is a single
    // canonical value graded by calcMatch()'s numeric comparator, not text/
    // keyword matching — see sanitizeCard()/calcMatch() in shared.js/
    // dashboard-core.js.
    const calcAnswerField = createField('Numeric Answer','text','e.g. 0.5, 1/2, or 50%');
    const calcAnswerInput = calcAnswerField.querySelector('input');
    const calcUnitField = createField('Unit (optional)','text','e.g. m/s, kg, %');
    const calcUnitInput = calcUnitField.querySelector('input');
    const calcToleranceField = createField('Tolerance','number','0');
    const calcToleranceInput = calcToleranceField.querySelector('input');
    const calcToleranceLabel = calcToleranceField.querySelector('label');
    calcToleranceInput.min='0'; calcToleranceInput.step='any';
    const calcToleranceModeSelect = el('select',{style:'padding:8px 10px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:var(--text);font-family:inherit;font-size:12px'},
      el('option',{value:'abs'},'± (absolute)'),
      el('option',{value:'pct'},'± % of correct value'),
      el('option',{value:'sigfig'},'Significant figures')
    );
    const toleranceRow = el('div',{style:'display:flex;gap:8px;align-items:flex-end'},calcToleranceField,calcToleranceModeSelect);
    calcToleranceField.style.flex='1';
    const calcPreview = el('div',{style:'font-size:11px;color:var(--muted);margin:-4px 0 8px'});
    // Switching into sig-figs mode repurposes the same number field to mean
    // "how many sig figs", not an amount — 0 there wouldn't mean anything, so
    // default it to 3 (a very standard GCSE-science default) the moment you
    // switch in, same as the table's tolerance field below.
    function normToleranceMode(v){ return v==='pct' ? 'pct' : v==='sigfig' ? 'sigfig' : 'abs'; }
    function onToleranceModeChange(select,input,label,baseLabel){
      const isSF = select.value==='sigfig';
      input.step = isSF ? '1' : 'any';
      input.min = isSF ? '1' : '0';
      input.max = isSF ? '10' : '';
      if(label) label.textContent = isSF ? 'Significant figures' : baseLabel;
      if(isSF && (!input.value || parseFloat(input.value)===0)) input.value='3';
    }
    calcToleranceModeSelect.addEventListener('change',()=>{ onToleranceModeChange(calcToleranceModeSelect,calcToleranceInput,calcToleranceLabel,'Tolerance'); updateCalcPreview(); });
    function updateCalcPreview(){
      const tol = parseFloat(calcToleranceInput.value)||0;
      const unit = calcUnitInput.value.trim();
      const mode = calcToleranceModeSelect.value;
      let tolTxt = '';
      if(mode==='sigfig'){ tolTxt = ` (rounded to ${Math.max(1,Math.round(tol)||3)} significant figures)`; }
      else if(tol>0){ tolTxt = ` (± ${tol}${mode==='pct'?'%':(unit?` ${unit}`:'')})`; }
      calcPreview.textContent = `Accepted as correct: the numeric value${tolTxt}${unit?`, with unit "${unit}"`:''}. Equivalent forms (e.g. 0.5 / 1/2 / 50%) are all accepted.`;
    }
    [calcToleranceInput,calcUnitInput].forEach(i=>i.addEventListener('input',updateCalcPreview));

    const methodPoolLabel = el('div',{style:'font-size:12px;font-weight:600;margin-bottom:6px'},'Method / working marks (optional)');
    const methodPoolHint = el('div',{style:'font-size:11px;color:var(--muted);margin:-4px 0 8px'},'Marking points for showing correct working — scored the same way as a Mark scheme card, in addition to the final numeric answer.');
    const methodPoolList = el('div',{});
    let methodBoxes = []; // [{row, input}]
    function addMethodBox(value){
      if(methodBoxes.length>=8){ showToast('Maximum 8 method marking points'); return; }
      const input = el('input',{type:'text',placeholder:`Method point ${methodBoxes.length+1}…`,style:'flex:1'});
      input.value = value||'';
      const removeBtn = el('button',{type:'button',class:'btn btn-sm btn-ghost',style:'padding:6px 10px',title:'Remove this'},'✕');
      const row = el('div',{style:'display:flex;gap:6px;margin-bottom:6px'},input,removeBtn);
      removeBtn.addEventListener('click',()=>{
        const idx=methodBoxes.findIndex(b=>b.row===row);
        if(idx>=0) methodBoxes.splice(idx,1);
        row.remove();
        methodBoxes.forEach((b,i)=>{ b.input.placeholder = `Method point ${i+1}…`; });
        syncMethodRequiredMax();
      });
      methodPoolList.appendChild(row);
      methodBoxes.push({row,input});
      syncMethodRequiredMax();
    }
    const addMethodBtn = btn('+ Add method point','ghost',{small:true,onclick:()=>{ addMethodBox(''); methodBoxes[methodBoxes.length-1].input.focus(); }});
    const methodRequiredField = createField('Method marks required for full credit','number','0');
    const methodRequiredInput = methodRequiredField.querySelector('input');
    methodRequiredInput.min='0'; methodRequiredInput.step='1';
    function syncMethodRequiredMax(){
      const max = methodBoxes.length;
      methodRequiredInput.max = String(max);
      let v = parseInt(methodRequiredInput.value,10);
      if(!Number.isFinite(v) || v<0 || v>max) v = max;
      methodRequiredInput.value = String(v);
      updateCalcMarksPreview();
    }
    const calcMarksPreview = el('div',{style:'font-size:11px;color:var(--muted);margin-top:4px'});
    function updateCalcMarksPreview(){
      const m = Math.max(0, Math.min(methodBoxes.length, parseInt(methodRequiredInput.value,10)||0));
      const total = 1 + m;
      calcMarksPreview.textContent = `Shown as: "…(${total} mark${total===1?'':'s'})" — 1 for the correct final value${m?` + ${m} for method`:''}.`;
    }
    methodRequiredInput.addEventListener('input',updateCalcMarksPreview);
    methodRequiredInput.addEventListener('blur',syncMethodRequiredMax);
    const methodSection = el('div',{class:'field'},methodPoolLabel,methodPoolHint,methodPoolList,addMethodBtn,methodRequiredField,calcMarksPreview);

    const calcSection = el('div',{},calcAnswerField,calcUnitField,toleranceRow,calcPreview,methodSection);

    // ── 'table' mode: a single unified grid builder.
    // In-memory state while the modal is open:
    //   tCols  — [{key,label,group}], one per column, in display order
    //   tRows  — [[cellValue,...]], the answer key, tRows[r][c]
    //   tCombos — [{name, cells:[[colIndex,...],...]}], cells[rowIndex] is the
    //             (possibly empty, possibly multi-entry) list of columns
    //             blanked in that row for this combination. Unlimited,
    //             creator-authored/reviewed — see sanitizeCard()'s tableData
    //             docs in shared.js. Answer values and blank-marking both
    //             happen on the same grid: clicking a cell toggles its
    //             membership in whichever combination tab is active, color-
    //             coded per combination (COMBO_COLORS below) so overlapping
    //             combinations stay visually distinct.
    const COMBO_COLORS = ['#60A5FA','#F87171','#34D399','#FBBF24','#C084FC','#F472B6','#38BDF8','#FB923C'];
    const comboColor = i => COMBO_COLORS[i % COMBO_COLORS.length];
    let tCols = (existing?.tableData?.columns||[]).map(c=>({key:c.key,label:c.label||'',group:c.group||null}));
    let tRows = (existing?.tableData?.rows||[]).map(row=>tCols.map(c=>row[c.key]!=null?String(row[c.key]):''));
    let tCombos = (existing?.tableData?.combinations||[]).map(combo=>({
      name: combo.name,
      cells: tRows.map((_,ri)=>{
        const raw = combo.cells[ri];
        const keys = Array.isArray(raw) ? raw : (raw!=null ? [raw] : []);
        return keys.map(k=>tCols.findIndex(c=>c.key===k)).filter(i=>i>=0);
      }),
    }));
    if(!tCols.length){ tCols=[{key:'col_1',label:'Column 1',group:null},{key:'col_2',label:'Column 2',group:null}]; }
    if(!tRows.length){ tRows=[tCols.map(()=>'')]; }
    if(!tCombos.length){ tCombos=[{name:'Combination 1',cells:tRows.map(()=>[])}]; }
    let tComboIdx = 0;

    // Which of the two mutually-exclusive grid tools is active — mirrors the
    // Basic/Multi-answer/etc. mode row's button styling (see mkModeBtn above)
    // rather than inventing a new visual language. 'value' = click a cell to
    // edit its answer-key text; 'combo' = click a cell anywhere (no more
    // hunting for the border sliver) to toggle it blank for the active
    // combination. Only one is ever live at a time, so there's no ambiguity
    // about what a click on a cell will do.
    let tTool = 'value';

    const tableFullscreenWrap = el('div',{});
    let tableFullscreen = false;

    // Toolbar: row/column counts + fullscreen. Insertion at arbitrary
    // positions (not just append) is done via the small "+"/"×" controls
    // woven into the header row and row-label column instead of here.
    const rowsCountInput = el('input',{type:'number',min:'1',max:'40',class:'u-input',style:'width:56px',value:String(tRows.length)});
    const colsCountInput = el('input',{type:'number',min:'1',max:'12',class:'u-input',style:'width:56px',value:String(tCols.length)});
    const fullscreenBtn = el('button',{type:'button',title:'Fullscreen',style:'padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);cursor:pointer;font-size:12px;font-family:inherit;margin-left:auto;background:rgba(255,255,255,0.06);color:var(--text)'},'⛶');

    // Tool toggle — two mutually-exclusive buttons instead of relying on
    // "click the input to edit the value, click the sliver of border around
    // it to toggle blank". Same flat-segmented visual language as the
    // Basic/Multi-answer/etc. mode row (mkModeBtn) above.
    const toolRow = el('div',{style:'display:flex;gap:0;border-radius:6px;overflow:hidden;border:1px solid rgba(255,255,255,0.15)'});
    const toolButtons = {};
    function mkToolBtn(id,label,title){
      const b = el('button',{type:'button',title,style:'padding:5px 10px;font-size:11px;font-weight:700;font-family:inherit;border:none;cursor:pointer;background:rgba(255,255,255,0.06);color:var(--muted)'},label);
      b.addEventListener('click',()=>{ if(tTool===id) return; tTool=id; refreshToolButtons(); renderGrid(); });
      toolButtons[id]=b;
      return b;
    }
    toolRow.append(
      mkToolBtn('value','🖊 Value Editor','Click a cell to edit its answer-key value'),
      mkToolBtn('combo','🎯 Combination Editor','Click a cell anywhere to toggle it blank for the active combination')
    );
    const toolHint = el('span',{style:'font-size:11px;color:var(--muted)'});
    function refreshToolButtons(){
      Object.entries(toolButtons).forEach(([id,b])=>{
        const active = tTool===id;
        b.style.background = active ? 'var(--blue)' : 'rgba(255,255,255,0.06)';
        b.style.color = active ? '#fff' : 'var(--muted)';
      });
      toolHint.textContent = tTool==='value'
        ? 'Click a cell to edit its value'
        : 'Click a cell anywhere to toggle it blank for the active combination';
    }
    refreshToolButtons();
    fullscreenBtn.addEventListener('click',()=>{
      tableFullscreen=!tableFullscreen;
      tableFullscreenWrap.style.position = tableFullscreen ? 'fixed' : '';
      tableFullscreenWrap.style.inset = tableFullscreen ? '0' : '';
      tableFullscreenWrap.style.zIndex = tableFullscreen ? '9999' : '';
      tableFullscreenWrap.style.background = tableFullscreen ? 'var(--bg,#111)' : '';
      tableFullscreenWrap.style.padding = tableFullscreen ? '20px' : '';
      tableFullscreenWrap.style.overflow = tableFullscreen ? 'auto' : '';
      fullscreenBtn.textContent = tableFullscreen ? '✕' : '⛶';
    });
    function applyRowColCounts(){
      const nRows=Math.max(1,Math.min(40,parseInt(rowsCountInput.value,10)||tRows.length));
      const nCols=Math.max(1,Math.min(12,parseInt(colsCountInput.value,10)||tCols.length));
      pushTableHistory();
      resetSelectionState();
      while(tCols.length<nCols) tCols.push({key:`col_${tCols.length+1}_${Math.random().toString(36).slice(2,5)}`,label:`Column ${tCols.length+1}`,group:null});
      tCols.length=nCols;
      tRows.forEach(row=>{ while(row.length<nCols) row.push(''); row.length=nCols; });
      while(tRows.length<nRows) tRows.push(tCols.map(()=>''));
      tRows.length=nRows;
      tCombos.forEach(combo=>{
        while(combo.cells.length<nRows) combo.cells.push([]);
        combo.cells.length=nRows;
        combo.cells=combo.cells.map(arr=>(arr||[]).filter(ci=>ci<nCols));
      });
      renderGrid();
    }
    rowsCountInput.addEventListener('change',applyRowColCounts);
    colsCountInput.addEventListener('change',applyRowColCounts);
    const undoBtn = el('button',{type:'button',title:'Undo (Ctrl+Z)',style:'padding:5px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);cursor:pointer;font-size:12px;font-family:inherit;background:rgba(255,255,255,0.06);color:var(--text)'},'↶ Undo');
    const redoBtn = el('button',{type:'button',title:'Redo (Ctrl+Y)',style:'padding:5px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);cursor:pointer;font-size:12px;font-family:inherit;background:rgba(255,255,255,0.06);color:var(--text)'},'↷ Redo');
    undoBtn.addEventListener('click',()=>{ undoTable(); gridArea.focus({preventScroll:true}); });
    redoBtn.addEventListener('click',()=>{ redoTable(); gridArea.focus({preventScroll:true}); });
    function refreshUndoRedoButtons(){
      undoBtn.disabled = !tHistory.length;
      undoBtn.style.opacity = tHistory.length ? '1' : '0.4';
      undoBtn.style.cursor = tHistory.length ? 'pointer' : 'default';
      redoBtn.disabled = !tRedo.length;
      redoBtn.style.opacity = tRedo.length ? '1' : '0.4';
      redoBtn.style.cursor = tRedo.length ? 'pointer' : 'default';
    }
    const toolbar = el('div',{style:'display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px;border-radius:8px 8px 0 0;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-bottom:none'},
      el('span',{style:'font-size:11px;color:var(--muted)'},'Rows'),rowsCountInput,
      el('span',{style:'font-size:11px;color:var(--muted)'},'Cols'),colsCountInput,
      el('div',{style:'width:1px;align-self:stretch;background:rgba(255,255,255,0.1)'}),
      undoBtn,redoBtn,
      el('div',{style:'width:1px;align-self:stretch;background:rgba(255,255,255,0.1)'}),
      toolRow,
      el('div',{style:'width:1px;align-self:stretch;background:rgba(255,255,255,0.1)'}),
      toolHint,
      fullscreenBtn
    );

    // Row/column structural edits — each also keeps every combination's
    // blank references pointing at the right cells (shifting indices on
    // insert, dropping/shifting on delete) instead of silently corrupting them.
    // Any structural row/column change invalidates whatever tSel/tClipboard
    // currently point at (indices shift or rows/columns disappear), so every
    // one of the functions below starts by dropping the selection rather
    // than risk it silently pointing at the wrong cells afterward.
    function resetSelectionState(){ tSel=null; tSelAnchor=null; tClipboard=null; }

    // ---- Undo / Redo (Ctrl+Z / Ctrl+Y or Ctrl+Shift+Z) ----------------------
    // Snapshots the whole grid (columns, rows, combinations, active tab) before
    // every mutating action, so any move — structural (insert/delete/reorder
    // row or column), blank-toggle, cell edit, paste, or bulk clear — can be
    // stepped back through individually. Cell-value edits are coalesced into
    // one history entry per focus/blur (see the cell input's onfocus below)
    // rather than one per keystroke, so undo steps through meaningful actions.
    let tHistory = [], tRedo = [];
    const T_HISTORY_MAX = 60;
    function snapshotTable(){
      return {
        cols: tCols.map(c=>({...c})),
        rows: tRows.map(r=>r.slice()),
        combos: tCombos.map(c=>({name:c.name, cells:c.cells.map(arr=>(arr||[]).slice())})),
        comboIdx: tComboIdx,
      };
    }
    function pushTableHistory(){
      tHistory.push(snapshotTable());
      if(tHistory.length>T_HISTORY_MAX) tHistory.shift();
      tRedo.length = 0;
    }
    function restoreTableSnapshot(snap){
      tCols = snap.cols.map(c=>({...c}));
      tRows = snap.rows.map(r=>r.slice());
      tCombos = snap.combos.map(c=>({name:c.name, cells:c.cells.map(arr=>(arr||[]).slice())}));
      tComboIdx = Math.min(snap.comboIdx, tCombos.length-1);
      resetSelectionState();
    }
    function undoTable(){
      if(!tHistory.length) return;
      tRedo.push(snapshotTable());
      restoreTableSnapshot(tHistory.pop());
      refreshTablePreview(); renderGrid();
    }
    function redoTable(){
      if(!tRedo.length) return;
      tHistory.push(snapshotTable());
      restoreTableSnapshot(tRedo.pop());
      refreshTablePreview(); renderGrid();
    }

    function insertColumnAt(idx){
      pushTableHistory();
      resetSelectionState();
      tCols.splice(idx,0,{key:`col_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,4)}`,label:`Column ${tCols.length+1}`,group:null});
      tRows.forEach(row=>row.splice(idx,0,''));
      tCombos.forEach(combo=>{ combo.cells=combo.cells.map(arr=>(arr||[]).map(ci=>ci>=idx?ci+1:ci)); });
      renderGrid();
    }
    function deleteColumnAt(idx){
      if(tCols.length<=1) return;
      pushTableHistory();
      resetSelectionState();
      tCols.splice(idx,1);
      tRows.forEach(row=>row.splice(idx,1));
      tCombos.forEach(combo=>{ combo.cells=combo.cells.map(arr=>(arr||[]).filter(ci=>ci!==idx).map(ci=>ci>idx?ci-1:ci)); });
      renderGrid();
    }
    function insertRowAt(idx){
      pushTableHistory();
      resetSelectionState();
      tRows.splice(idx,0,tCols.map(()=>''));
      tCombos.forEach(combo=>combo.cells.splice(idx,0,[]));
      renderGrid();
    }
    function deleteRowAt(idx){
      if(tRows.length<=1) return;
      pushTableHistory();
      resetSelectionState();
      tRows.splice(idx,1);
      tCombos.forEach(combo=>combo.cells.splice(idx,1));
      renderGrid();
    }
    // Drag-and-drop reordering — same idea as insert/delete above (structural
    // edit that must keep tCols/tRows/every combo's blank references in
    // lock-step), just a move instead of an add/remove. Column moves need a
    // full old-index→new-index permutation (not a simple splice) since a
    // blanked cell's column reference has to follow its column wherever it
    // lands, not just shift by one.
    function moveColumnTo(fromIdx,toIdx){
      if(fromIdx===toIdx || fromIdx<0 || toIdx<0 || fromIdx>=tCols.length || toIdx>=tCols.length) return;
      pushTableHistory();
      resetSelectionState();
      const order = tCols.map((_,i)=>i);
      const [moved] = order.splice(fromIdx,1);
      order.splice(toIdx,0,moved);
      const oldToNew = new Array(order.length);
      order.forEach((oldIdx,newIdx)=>{ oldToNew[oldIdx]=newIdx; });
      tCols = order.map(i=>tCols[i]);
      tRows.forEach((row,ri)=>{ tRows[ri] = order.map(i=>row[i]); });
      tCombos.forEach(combo=>{ combo.cells = combo.cells.map(arr=>(arr||[]).map(ci=>oldToNew[ci])); });
      renderGrid();
    }
    function moveRowTo(fromIdx,toIdx){
      if(fromIdx===toIdx || fromIdx<0 || toIdx<0 || fromIdx>=tRows.length || toIdx>=tRows.length) return;
      pushTableHistory();
      resetSelectionState();
      const [row] = tRows.splice(fromIdx,1);
      tRows.splice(toIdx,0,row);
      tCombos.forEach(combo=>{ const [cells]=combo.cells.splice(fromIdx,1); combo.cells.splice(toIdx,0,cells); });
      renderGrid();
    }
    function toggleBlank(ri,ci){
      pushTableHistory();
      const combo=tCombos[tComboIdx];
      const arr=combo.cells[ri]||(combo.cells[ri]=[]);
      const at=arr.indexOf(ci);
      if(at>=0) arr.splice(at,1); else arr.push(ci);
      renderGrid();
    }

    // ---- Selection (cells / whole rows / whole columns) + copy/cut/paste --
    // Orthogonal to tTool: you can select regardless of which tool is
    // active. A plain (non-dragged) click still does whatever the active
    // tool normally does *in addition* to updating the selection — a native
    // 'click' event only fires when mousedown and mouseup land on the same
    // element, so a genuine drag-to-select never also toggles a blank or
    // drops you into edit mode on every cell it passes over.
    let tSel = null;         // {type:'cell'|'row'|'col', r0,c0,r1,c1} — always normalized r0<=r1, c0<=c1
    let tSelDragging = false;
    let tSelAnchor = null;   // {r,c} — fixed start point a shift-click/drag extends from
    let tClipboard = null;   // {mode:'copy'|'cut', payload, srcSel} | {mode:'move-row'|'move-col', index} | null
    let tdGrid = [];         // [ri][ci] -> <td>, rebuilt by renderGrid(); lets selection repaint skip a full re-render
    const CLIP_MARK = 'data-scima-table-clip';

    function selectCells(r0,c0,r1,c1){ tSel={type:'cell',r0:Math.min(r0,r1),r1:Math.max(r0,r1),c0:Math.min(c0,c1),c1:Math.max(c0,c1)}; }
    function selectRow(ri){ tSel={type:'row',r0:ri,r1:ri,c0:0,c1:tCols.length-1}; }
    function selectCol(ci){ tSel={type:'col',r0:0,r1:tRows.length-1,c0:ci,c1:ci}; }
    function refreshSelectionVisual(){
      tdGrid.forEach(row=>row&&row.forEach(td=>{ if(td){ td.classList.remove('tbl-cell-selected'); td.classList.remove('tbl-cell-cut'); } }));
      if(tSel){ for(let r=tSel.r0;r<=tSel.r1;r++) for(let c=tSel.c0;c<=tSel.c1;c++) tdGrid[r]?.[c]?.classList.add('tbl-cell-selected'); }
      if(tClipboard?.mode==='cut' && tClipboard.srcSel){ const s=tClipboard.srcSel; for(let r=s.r0;r<=s.r1;r++) for(let c=s.c0;c<=s.c1;c++) tdGrid[r]?.[c]?.classList.add('tbl-cell-cut'); }
    }

    function selectionPayload(sel){
      const combo=tCombos[tComboIdx];
      const h=sel.r1-sel.r0+1, w=sel.c1-sel.c0+1;
      const values=[], blanks=[];
      for(let r=0;r<h;r++){
        const vRow=[], bRow=[];
        for(let c=0;c<w;c++){
          const ri=sel.r0+r, ci=sel.c0+c;
          vRow.push(tRows[ri]?.[ci] ?? '');
          bRow.push((combo.cells[ri]||[]).includes(ci));
        }
        values.push(vRow); blanks.push(bRow);
      }
      return {values,blanks,h,w};
    }
    function clearSelectionValues(sel,{clearBlanks}={}){
      const combo=tCombos[tComboIdx];
      for(let ri=sel.r0;ri<=sel.r1;ri++){
        for(let ci=sel.c0;ci<=sel.c1;ci++){
          if(tRows[ri]) tRows[ri][ci]='';
          if(clearBlanks && combo.cells[ri]){ const at=combo.cells[ri].indexOf(ci); if(at>=0) combo.cells[ri].splice(at,1); }
        }
      }
    }
    function pastePayloadAt(anchorR,anchorC,payload,{applyBlanks}={}){
      const combo=tCombos[tComboIdx];
      // Excel-style tiling: if the current selection is an exact multiple of
      // the copied block's shape, repeat the block to fill it; otherwise
      // stamp it once, anchored at the destination's top-left. Paste never
      // grows the table — same as everywhere else here, you size the grid
      // with Rows/Cols, and an oversized paste is simply clipped.
      let destH=payload.h, destW=payload.w;
      if(tSel && tSel.type==='cell'){
        const selH=tSel.r1-tSel.r0+1, selW=tSel.c1-tSel.c0+1;
        if(selH%payload.h===0 && selW%payload.w===0){ destH=selH; destW=selW; }
      }
      for(let r=0;r<destH;r++){
        const ri=anchorR+r; if(ri>=tRows.length) break;
        for(let c=0;c<destW;c++){
          const ci=anchorC+c; if(ci>=tCols.length) break;
          tRows[ri][ci]=payload.values[r%payload.h][c%payload.w];
          if(applyBlanks){
            const wantBlank=payload.blanks[r%payload.h][c%payload.w];
            const arr=combo.cells[ri]||(combo.cells[ri]=[]);
            const at=arr.indexOf(ci);
            if(wantBlank && at<0) arr.push(ci);
            if(!wantBlank && at>=0) arr.splice(at,1);
          }
        }
      }
      selectCells(anchorR,anchorC,anchorR+Math.min(destH,tRows.length-anchorR)-1,anchorC+Math.min(destW,tCols.length-anchorC)-1);
    }
    function tsvFromPayload(payload){ return payload.values.map(row=>row.join('\t')).join('\n'); }
    function htmlFromPayload(payload){
      const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
      const rows=payload.values.map((row,r)=>'<tr>'+row.map((v,c)=>`<td${payload.blanks[r][c]?' data-blank="1"':''}>${esc(v)}</td>`).join('')+'</tr>').join('');
      return `<table ${CLIP_MARK}="1">${rows}</table>`;
    }
    function payloadFromHtml(html){
      const doc=new DOMParser().parseFromString(html,'text/html');
      const table=doc.querySelector(`table[${CLIP_MARK}]`);
      if(!table) return null;
      const rows=[...table.querySelectorAll('tr')].map(tr=>[...tr.children].map(td=>({v:td.textContent,b:td.hasAttribute('data-blank')})));
      if(!rows.length || !rows[0].length) return null;
      return {h:rows.length,w:rows[0].length,values:rows.map(r=>r.map(x=>x.v)),blanks:rows.map(r=>r.map(x=>x.b))};
    }
    function payloadFromTsv(text){
      const lines=text.replace(/\r/g,'').split('\n');
      if(lines.length && lines[lines.length-1]==='') lines.pop();
      const rows=lines.map(r=>r.split('\t'));
      if(!rows.length) return null;
      const w=Math.max(...rows.map(r=>r.length));
      return {h:rows.length,w,values:rows.map(r=>{ const row=r.slice(); while(row.length<w) row.push(''); return row; }),blanks:rows.map(r=>r.map(()=>false))};
    }

    async function copySelection(cut){
      if(!tSel) return;
      // Cutting a single whole row/column is a *move*: reuse the drag-and-
      // drop machinery below (moveRowTo/moveColumnTo) so it round-trips
      // every combination's blank references correctly, not just the
      // active one. A cell-range cut/copy instead carries just the active
      // combination's blanks along as data, per how you said this should
      // work.
      if(cut && tSel.type==='row' && tSel.r0===tSel.r1){ tClipboard={mode:'move-row',index:tSel.r0}; showToast('Row cut — select a row and paste to move it there'); return; }
      if(cut && tSel.type==='col' && tSel.c0===tSel.c1){ tClipboard={mode:'move-col',index:tSel.c0}; showToast('Column cut — select a column and paste to move it there'); return; }
      const payload=selectionPayload(tSel);
      tClipboard={mode:cut?'cut':'copy',payload,srcSel:{...tSel}};
      try{
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain':new Blob([tsvFromPayload(payload)],{type:'text/plain'}),
          'text/html':new Blob([htmlFromPayload(payload)],{type:'text/html'})
        })]);
      }catch(err){
        try{ await navigator.clipboard.writeText(tsvFromPayload(payload)); }
        catch(err2){ /* OS clipboard unavailable — tClipboard still lets paste work within this modal */ }
      }
      refreshSelectionVisual();
    }
    async function pasteAtSelection(){
      if(!tSel) return;
      if(tClipboard?.mode==='move-row'){ if(tSel.type==='row') moveRowTo(tClipboard.index,tSel.r0); tClipboard=null; return; }
      if(tClipboard?.mode==='move-col'){ if(tSel.type==='col') moveColumnTo(tClipboard.index,tSel.c0); tClipboard=null; return; }
      let payload=null, richBlanks=false;
      try{
        const items=await navigator.clipboard.read();
        for(const item of items){
          if(item.types.includes('text/html')){
            const parsed=payloadFromHtml(await (await item.getType('text/html')).text());
            if(parsed){ payload=parsed; richBlanks=true; break; }
          }
        }
        if(!payload){
          for(const item of items){
            if(item.types.includes('text/plain')){ payload=payloadFromTsv(await (await item.getType('text/plain')).text()); break; }
          }
        }
      }catch(err){
        try{ payload=payloadFromTsv(await navigator.clipboard.readText()); }
        catch(err2){ /* fall through to the in-app clipboard below */ }
      }
      if(!payload && tClipboard?.payload){ payload=tClipboard.payload; richBlanks=true; }
      if(!payload){ showToast('Clipboard is empty or unavailable'); return; }
      pushTableHistory();
      if(tClipboard?.mode==='cut' && tClipboard.srcSel) clearSelectionValues(tClipboard.srcSel,{clearBlanks:true});
      pastePayloadAt(tSel.r0,tSel.c0,payload,{applyBlanks:richBlanks});
      tClipboard=null;
      refreshTablePreview();
      renderGrid();
    }

    const gridArea = el('div',{tabindex:'-1',style:'border:1px solid rgba(255,255,255,0.1);border-radius:0 0 8px 8px;padding:10px;overflow:auto;outline:none'});
    gridArea.addEventListener('keydown',e=>{
      const mod=e.ctrlKey||e.metaKey;
      const key=e.key.toLowerCase();
      if(mod && key==='z' && !e.shiftKey){ e.preventDefault(); undoTable(); }
      else if(mod && (key==='y' || (key==='z' && e.shiftKey))){ e.preventDefault(); redoTable(); }
      else if(mod && key==='c'){ e.preventDefault(); copySelection(false); }
      else if(mod && key==='x'){ e.preventDefault(); copySelection(true); }
      else if(mod && key==='v'){ e.preventDefault(); pasteAtSelection(); }
      else if((e.key==='Delete'||e.key==='Backspace') && tSel && document.activeElement?.tagName!=='INPUT'){
        e.preventDefault(); pushTableHistory(); clearSelectionValues(tSel,{clearBlanks:false}); refreshTablePreview(); renderGrid();
      } else if(e.key==='Escape' && tClipboard && tClipboard.mode!=='copy'){
        e.stopPropagation(); tClipboard=null; refreshSelectionVisual();
      }
    });
    const tableHint = el('div',{style:'font-size:11px;color:var(--muted);margin:8px 0'},
      'Every cell always holds its correct value (the answer key). Switch to the Combination Editor tool, pick a combination tab, then click cells to mark them blank for that variant — a row can have more than one blank, and each combination is color-coded so overlapping picks stay distinguishable. Drag the ⠿ handles to reorder a row or column. Click a cell (drag to select a range) or a row/column\u2019s header to select it, then Ctrl/⌘+C, +X, +V to copy, cut, or paste — this works with Excel/Sheets too.'
    );
    const tableToleranceRow = el('div',{class:'field',style:'display:flex;gap:8px;align-items:flex-end'});
    const tableToleranceField = createField('Tolerance (applies to every blank)','number','0');
    const tableToleranceLabel = tableToleranceField.querySelector('label');
    const tableToleranceInput = tableToleranceField.querySelector('input');
    const tableToleranceModeSelect = el('select',{class:'u-input',style:'width:150px'},el('option',{value:'abs'},'± absolute'),el('option',{value:'pct'},'± percent'),el('option',{value:'sigfig'},'Sig figs'));
    tableToleranceModeSelect.addEventListener('change',()=>onToleranceModeChange(tableToleranceModeSelect,tableToleranceInput,tableToleranceLabel,'Tolerance (applies to every blank)'));
    tableToleranceRow.append(tableToleranceField,tableToleranceModeSelect);

    // Small read-only preview (shown here and reused as the card-creation
    // modal's table preview) — renders the grouped-header grid with the
    // active combination's blanks shown as dashed placeholders, same
    // header-merge logic as renderTableQuizCard() in dashboard-study.js.
    function renderTablePreview(){
      const combo = tCombos[tComboIdx] || {cells:tRows.map(()=>[])};
      const spans=[];
      tCols.forEach(c=>{
        if(c.group){
          if(spans.length && spans[spans.length-1].isGroup && spans[spans.length-1].label===c.group) spans[spans.length-1].colspan++;
          else spans.push({label:c.group,colspan:1,rowspan:1,isGroup:true});
        } else spans.push({label:c.label,colspan:1,rowspan:2,isGroup:false});
      });
      const thStyle='border:1px solid rgba(255,255,255,0.12);padding:4px 6px;font-size:11px;font-weight:700;background:rgba(255,255,255,0.08);text-align:center';
      const tdStyle='border:1px solid rgba(255,255,255,0.1);padding:3px 5px;font-size:11px;text-align:center;color:var(--text);background:rgba(255,255,255,0.05)';
      const headRow1=el('tr',{},...spans.map(s=>setRichText(el('th',{style:thStyle,colspan:String(s.colspan),rowspan:String(s.rowspan)}),s.label)));
      const headRow2=el('tr',{},...tCols.filter(c=>c.group).map(c=>setRichText(el('th',{style:thStyle}),c.label)));
      const bodyRows=tRows.map((row,ri)=>el('tr',{},...row.map((v,ci)=>{
        const isBlank = (combo.cells[ri]||[]).includes(ci);
        const td=el('td',{style:tdStyle+(isBlank?';color:var(--muted);font-style:italic':'')});
        return isBlank ? (td.textContent='?', td) : setRichText(td, v||'');
      })));
      return el('table',{style:'border-collapse:collapse;width:100%;table-layout:fixed'},el('thead',{},headRow1,headRow2),el('tbody',{},...bodyRows));
    }
    const tablePreviewBox = el('div',{style:'margin-bottom:10px;padding:10px;border:1px solid rgba(167,139,250,0.25);border-radius:8px;background:rgba(167,139,250,0.05);overflow:auto'});
    function refreshTablePreview(){
      tablePreviewBox.innerHTML='';
      tablePreviewBox.append(el('div',{style:'font-size:10px;color:#A78BFA;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px'},'Preview'),renderTablePreview());
    }

    // Uniform, Excel-like cell sizing: table-layout:fixed with an explicit
    // colgroup so every cell in a column shares one width and every cell in
    // a row shares one height, rather than each column stretching to fit
    // its own longest content.
    const ROW_LABEL_W = 88, DATA_COL_W = 96;

    function renderGrid(){
      gridArea.innerHTML='';
      refreshTablePreview();

      const comboTabs=el('div',{style:'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;align-items:center'});
      let activeComboLabelEl=null; // the active tab's name text node — updated live while renaming, see below
      tCombos.forEach((combo,ci)=>{
        const active=ci===tComboIdx;
        const labelSpan=el('span',{},combo.name);
        const tab=el('button',{type:'button',style:`display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:6px;border:1px solid ${active?comboColor(ci):'rgba(255,255,255,0.15)'};cursor:pointer;font-size:11px;font-weight:700;font-family:inherit;background:${active?`color-mix(in srgb, ${comboColor(ci)} 20%, transparent)`:'rgba(255,255,255,0.06)'};color:${active?comboColor(ci):'var(--muted)'}`},
          el('span',{style:`width:9px;height:9px;border-radius:50%;background:${comboColor(ci)};display:inline-block`}),labelSpan
        );
        tab.addEventListener('click',()=>{ tComboIdx=ci; renderGrid(); });
        comboTabs.appendChild(tab);
        if(active) activeComboLabelEl=labelSpan;
      });
      const addComboBtn=el('button',{type:'button',style:'padding:5px 10px;border-radius:6px;border:1px dashed rgba(255,255,255,0.25);cursor:pointer;font-size:11px;font-weight:700;font-family:inherit;background:transparent;color:var(--muted)'},'+ Add combination');
      addComboBtn.addEventListener('click',()=>{ pushTableHistory(); tCombos.push({name:`Combination ${tCombos.length+1}`,cells:tRows.map(()=>[])}); tComboIdx=tCombos.length-1; renderGrid(); });
      comboTabs.appendChild(addComboBtn);
      gridArea.appendChild(comboTabs);

      const combo=tCombos[tComboIdx];
      // Renaming used to call renderGrid() on every keystroke, which tears
      // down and rebuilds this very input — so the browser's focus (and the
      // caret position) was lost after each character, forcing a re-click
      // just to keep typing. Fix: typing only updates the in-memory name and
      // the active tab's label text directly; nothing here gets torn down
      // mid-edit, so focus survives. A full renderGrid() only happens on
      // blur, purely to normalize an empty name back to a placeholder-free
      // state consistently with the rest of the grid's re-render points.
      const comboNameInput=el('input',{type:'text',class:'u-input',style:'font-size:12px;font-weight:700;max-width:220px',value:combo.name,
        onfocus:()=>{ pushTableHistory(); },
        oninput:e=>{ combo.name=e.target.value; if(activeComboLabelEl) activeComboLabelEl.textContent=combo.name||'(unnamed)'; },
        onblur:()=>{ if(!combo.name.trim()){ combo.name=`Combination ${tComboIdx+1}`; renderGrid(); } }
      });
      const actionRow=el('div',{style:'display:flex;gap:8px;align-items:center;margin-bottom:8px'},
        comboNameInput,
        el('button',{type:'button',style:`padding:5px 10px;border-radius:6px;border:none;cursor:pointer;font-size:11px;font-weight:700;font-family:inherit;background:color-mix(in srgb, ${comboColor(tComboIdx)} 15%, transparent);color:${comboColor(tComboIdx)}`},'🎲 Auto-generate'),
        tCombos.length>1?el('button',{type:'button',style:'padding:5px 10px;border-radius:6px;border:none;cursor:pointer;font-size:11px;font-weight:700;font-family:inherit;background:rgba(239,68,68,0.1);color:#ef4444'},'Delete combination'):null
      );
      // Auto-generate: one random cell per row, per the spec — creator can
      // still click any cell afterward to add/remove further blanks.
      actionRow.children[1].addEventListener('click',()=>{
        pushTableHistory();
        combo.cells = tRows.map(()=>[Math.floor(Math.random()*tCols.length)]);
        renderGrid();
      });
      if(tCombos.length>1) actionRow.children[2].addEventListener('click',()=>{
        pushTableHistory();
        tCombos.splice(tComboIdx,1); tComboIdx=Math.max(0,tComboIdx-1); renderGrid();
      });
      gridArea.appendChild(actionRow);

      const colgroup=el('colgroup',{},el('col',{style:`width:${ROW_LABEL_W}px`}),...tCols.map(()=>el('col',{style:`width:${DATA_COL_W}px`})));

      // Column-insert strip: a "+" between every pair of columns (and at
      // both ends) so a new column can be inserted at any position, not
      // just appended.
      const insertColRow=el('tr',{},el('th',{style:'background:transparent;border:none'}),
        ...Array.from({length:tCols.length+1}).map((_,gap)=>el('th',{style:'padding:0;border:none'},
          el('button',{type:'button',title:'Insert column here',style:'width:100%;padding:2px 0;border-radius:4px;border:1px dashed rgba(255,255,255,0.2);cursor:pointer;font-size:10px;background:transparent;color:var(--muted)',onclick:()=>insertColumnAt(gap)},'+')
        ))
      );
      // Group/label header rows, each column with its own delete "×". The
      // label row's grip handle is the drag source for reordering columns
      // (same HTML5 drag-and-drop pattern as the sidebar nav — see
      // renderSidebar() in dashboard-core.js: a module-scoped "source"
      // variable set on dragstart, drop on a sibling header computes the
      // final index and calls the move helper). Dragging from the grip
      // rather than the header cell itself keeps normal text editing/
      // selection in the label input from being hijacked into a drag.
      let dragColFrom=null;
      const groupRow=el('tr',{},el('th',{style:'background:rgba(255,255,255,0.08)'}),...tCols.map((c,ci)=>el('th',{style:'padding:2px;background:rgba(255,255,255,0.08)'},
        el('input',{type:'text',placeholder:'Group (optional)',class:'u-input',style:'width:100%;font-size:10px;padding:3px 4px',value:c.group||'',onfocus:()=>{ pushTableHistory(); },oninput:e=>{ c.group=e.target.value.trim()||null; refreshTablePreview(); }})
      )));
      const labelRow=el('tr',{},el('th',{style:'background:rgba(255,255,255,0.08)'}),...tCols.map((c,ci)=>{
        const th=el('th',{style:'padding:2px;background:rgba(255,255,255,0.08)'},
          el('div',{style:'display:flex;gap:2px;align-items:center'},
            el('span',{draggable:'true',title:'Drag to reorder column',style:'flex-shrink:0;cursor:grab;font-size:10px;color:var(--muted);padding:0 2px;user-select:none'},'⠿'),
            el('input',{type:'text',placeholder:`Column ${ci+1}`,class:'u-input',style:'width:100%;font-size:11px;font-weight:700;padding:3px 4px',value:c.label,onfocus:()=>{ pushTableHistory(); },oninput:e=>{ c.label=e.target.value; refreshTablePreview(); }}),
            tCols.length>1?el('button',{type:'button',title:'Delete column',style:'flex-shrink:0;width:18px;height:18px;border-radius:4px;border:none;cursor:pointer;font-size:10px;background:rgba(239,68,68,0.12);color:#ef4444',onclick:()=>deleteColumnAt(ci)},'×'):null
          )
        );
        const grip=th.querySelector('span[draggable]');
        grip.addEventListener('dragstart',e=>{ dragColFrom=ci; e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain',String(ci)); setTimeout(()=>{ th.style.opacity='0.4'; },0); });
        grip.addEventListener('dragend',()=>{ th.style.opacity=''; dragColFrom=null; });
        th.addEventListener('dragover',e=>{ if(dragColFrom===null) return; e.preventDefault(); e.dataTransfer.dropEffect='move'; th.classList.add('drop-hover'); });
        th.addEventListener('dragleave',()=>th.classList.remove('drop-hover'));
        th.addEventListener('drop',e=>{
          e.preventDefault();
          th.classList.remove('drop-hover');
          if(dragColFrom===null || dragColFrom===ci) return;
          moveColumnTo(dragColFrom,ci);
        });
        th.addEventListener('click',e=>{
          if(e.target.closest('button') || e.target.tagName==='INPUT') return;
          selectCol(ci); refreshSelectionVisual(); gridArea.focus({preventScroll:true});
        });
        return th;
      }));

      // Row-insert strip (one column, spans the row-label gutter) between
      // every pair of rows, plus one above row 1.
      function insertRowStrip(idx){
        return el('tr',{},el('td',{colspan:String(tCols.length+1),style:'padding:1px 0;border:none'},
          el('button',{type:'button',title:'Insert row here',style:'width:100%;padding:1px 0;border-radius:4px;border:1px dashed rgba(255,255,255,0.2);cursor:pointer;font-size:10px;background:transparent;color:var(--muted)',onclick:()=>insertRowAt(idx)},'+')
        ));
      }
      // Row drag source, same shape as the column one above (dragColFrom).
      let dragRowFrom=null;
      tdGrid=[];
      const bodyRows=[insertRowStrip(0)];
      tRows.forEach((row,ri)=>{
        const rowLabelTd=el('td',{style:'padding:2px;background:rgba(255,255,255,0.08)'},
          el('div',{style:'display:flex;align-items:center;gap:3px;font-size:10px;color:var(--muted)'},
            el('span',{draggable:'true',title:'Drag to reorder row',style:'cursor:grab;user-select:none'},'⠿'),
            `R${ri+1}`,
            tRows.length>1?el('button',{type:'button',title:'Delete row',style:'flex-shrink:0;width:16px;height:16px;border-radius:4px;border:none;cursor:pointer;font-size:10px;background:rgba(239,68,68,0.12);color:#ef4444',onclick:()=>deleteRowAt(ri)},'×'):null
          )
        );
        const rowGrip=rowLabelTd.querySelector('span[draggable]');
        rowGrip.addEventListener('dragstart',e=>{ dragRowFrom=ri; e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain',String(ri)); setTimeout(()=>{ tr.style.opacity='0.4'; },0); });
        rowGrip.addEventListener('dragend',()=>{ tr.style.opacity=''; dragRowFrom=null; });
        rowLabelTd.addEventListener('click',e=>{
          if(e.target.closest('button')) return;
          selectRow(ri); refreshSelectionVisual(); gridArea.focus({preventScroll:true});
        });
        const tr=el('tr',{},
          rowLabelTd,
          ...row.map((v,ci)=>{
            const activeBlank = (combo.cells[ri]||[]).includes(ci);
            const otherIdxs = tCombos.map((c,ti)=>ti).filter(ti=>ti!==tComboIdx && (tCombos[ti].cells[ri]||[]).includes(ci));
            const bg = activeBlank ? `color-mix(in srgb, ${comboColor(tComboIdx)} 18%, transparent)` : 'rgba(255,255,255,0.05)';
            const border = activeBlank ? comboColor(tComboIdx) : 'rgba(255,255,255,0.1)';
            // Which of the two tools is live decides what a click on this
            // cell does — checked at click-time (not baked in at render
            // time) so it stays correct even if this ever gets called from
            // somewhere that doesn't re-render on a tool switch. In the
            // Combination Editor tool the input is read-only and ignores
            // pointer events entirely, so the *whole* cell is one
            // unambiguous toggle target — no more needing to land the click
            // on the thin border sliver around the input.
            const input=el('input',{type:'text',class:'u-input',style:`width:100%;font-size:12px;padding:3px 4px;text-align:center;background:transparent;border:none;${tTool==='combo'?'pointer-events:none;':''}`,value:v,
              onfocus:()=>{ pushTableHistory(); },
              oninput:e=>{ tRows[ri][ci]=e.target.value; refreshTablePreview(); }});
            input.readOnly = tTool==='combo';
            const dots = otherIdxs.length ? el('div',{style:'position:absolute;top:2px;right:2px;display:flex;gap:2px'},
              ...otherIdxs.map(ti=>el('span',{style:`width:6px;height:6px;border-radius:50%;background:${comboColor(ti)}`}))
            ) : null;
            const td=el('td',{style:`position:relative;padding:2px;cursor:${tTool==='combo'?'pointer':'text'};border:1.5px solid ${border};background:${bg};border-radius:4px`,
              title:tTool==='combo'?'Click to toggle blank for the active combination':'Click to edit the value',
              onclick:()=>{ if(tTool==='combo') toggleBlank(ri,ci); }},input,dots);
            (tdGrid[ri]=tdGrid[ri]||[])[ci]=td;
            // Range selection lives alongside the tool click above rather
            // than replacing it — mousedown starts (and mouseenter during
            // an actual drag extends) a selection used only by copy/cut/
            // paste; it doesn't interfere with the click-to-edit or click-
            // to-toggle behavior since a real drag never fires a 'click'.
            td.addEventListener('mousedown',e=>{
              if(e.button!==0) return;
              tSelDragging=true;
              if(!e.shiftKey || !tSelAnchor) tSelAnchor={r:ri,c:ci};
              selectCells(tSelAnchor.r,tSelAnchor.c,ri,ci);
              refreshSelectionVisual();
              gridArea.focus({preventScroll:true});
              const onUp=()=>{ tSelDragging=false; window.removeEventListener('mouseup',onUp); };
              window.addEventListener('mouseup',onUp);
            });
            td.addEventListener('mouseenter',()=>{
              if(!tSelDragging || !tSelAnchor) return;
              selectCells(tSelAnchor.r,tSelAnchor.c,ri,ci);
              refreshSelectionVisual();
            });
            return td;
          })
        );
        tr.addEventListener('dragover',e=>{ if(dragRowFrom===null) return; e.preventDefault(); e.dataTransfer.dropEffect='move'; tr.classList.add('drop-hover'); });
        tr.addEventListener('dragleave',()=>tr.classList.remove('drop-hover'));
        tr.addEventListener('drop',e=>{
          e.preventDefault();
          tr.classList.remove('drop-hover');
          if(dragRowFrom===null || dragRowFrom===ri) return;
          moveRowTo(dragRowFrom,ri);
        });
        bodyRows.push(tr);
      });
      bodyRows.push(insertRowStrip(tRows.length));

      // border-separate (not collapse) so every cell always renders its own
      // full 4-sided border regardless of its neighbors — border-collapse
      // merges adjacent cell borders into one shared line, which is why
      // combination highlight boxes used to show 4/3/2 edges inconsistently
      // depending on which neighbors were also highlighted.
      const table=el('table',{style:'border-collapse:separate;border-spacing:2px;table-layout:fixed'},colgroup,
        el('thead',{},insertColRow,groupRow,labelRow),
        el('tbody',{},...bodyRows)
      );
      gridArea.appendChild(table);
      refreshSelectionVisual();
      refreshUndoRedoButtons();
    }
    renderGrid();

    const tableSection = el('div',{},tableFullscreenWrap);
    tableFullscreenWrap.append(tablePreviewBox,toolbar,gridArea,tableHint,tableToleranceRow);


    function syncVisibility() {
      const isPool = cardMode==='multi' || cardMode==='markscheme' || cardMode==='process';
      const isCalc = cardMode==='calculation';
      const isTable = cardMode==='table';
      backField.style.display = (isPool || isCalc || isTable) ? 'none' : '';
      backImgPicker.style.display = (isPool || isCalc || isTable) ? 'none' : '';
      poolSection.style.display = isPool ? '' : 'none';
      requiredField.style.display = isPool ? '' : 'none';
      requiredPreview.style.display = isPool ? '' : 'none';
      calcSection.style.display = isCalc ? '' : 'none';
      tableSection.style.display = isTable ? '' : 'none';
    }
    // Per-mode draft store: whenever we leave a mode, its full field set is
    // snapshotted here so switching through several modes and back restores
    // everything exactly — not just a single carried-over value. Previously
    // only one string ping-ponged between whichever two modes you last
    // visited, so e.g. a multi-answer/process card's 2nd+ answers, or a
    // calculation's unit/tolerance/method marks, were silently dropped the
    // moment a third mode (like Basic or Table) was visited in between.
    const modeDrafts = { basic:null, multi:null, markscheme:null, process:null, calculation:null, table:null };
    function captureDraft(mode){
      if(mode==='basic'){
        return { back: backField.querySelector('textarea').value };
      }
      if(mode==='multi'||mode==='markscheme'||mode==='process'){
        return {
          values: poolBoxes.map(b=>b.input.value),
          synonyms: poolBoxes.map(b=>b.synInput?b.synInput.value:''),
          required: requiredInput.value,
        };
      }
      if(mode==='calculation'){
        return {
          answer: calcAnswerInput.value, unit: calcUnitInput.value,
          tolerance: calcToleranceInput.value, toleranceMode: calcToleranceModeSelect.value,
          methodPool: methodBoxes.map(b=>b.input.value), methodRequired: methodRequiredInput.value,
        };
      }
      // 'table': tCols/tRows/tCombos already live for the whole life of this
      // modal and are never touched by mode switching, so there's nothing to
      // snapshot separately — they're always intact whenever you come back.
      return null;
    }
    function applyDraft(mode, draft){
      if(!draft) return false;
      if(mode==='basic'){ backField.querySelector('textarea').value = draft.back; return true; }
      if(mode==='multi'||mode==='markscheme'||mode==='process'){
        initPool(draft.values, draft.synonyms);
        requiredInput.value = draft.required;
        return true;
      }
      if(mode==='calculation'){
        calcAnswerInput.value = draft.answer;
        calcUnitInput.value = draft.unit;
        calcToleranceInput.value = draft.tolerance;
        calcToleranceModeSelect.value = draft.toleranceMode;
        onToleranceModeChange(calcToleranceModeSelect,calcToleranceInput,calcToleranceLabel,'Tolerance');
        methodBoxes.forEach(b=>b.row.remove());
        methodBoxes=[];
        methodPoolList.innerHTML='';
        (draft.methodPool||[]).forEach(v=>addMethodBox(v));
        methodRequiredInput.value = draft.methodRequired;
        return true;
      }
      return false;
    }

    function setCardMode(newMode){
      if(newMode===cardMode){ return; }
      const prevMode = cardMode;
      modeDrafts[prevMode] = captureDraft(prevMode);

      const wasPool = prevMode==='multi' || prevMode==='markscheme' || prevMode==='process';
      const willPool = newMode==='multi' || newMode==='markscheme' || newMode==='process';
      const wasCalc = prevMode==='calculation';
      const willCalc = newMode==='calculation';
      const prevBackVal = backField.querySelector('textarea').value.trim();
      const prevFirstPoolVal = poolBoxes[0]?.input.value || '';
      const carryVal = wasPool ? prevFirstPoolVal : wasCalc ? calcAnswerInput.value.trim() : prevBackVal;
      cardMode = newMode;

      const draft = modeDrafts[newMode];

      if(willPool){
        if(draft){
          applyDraft(newMode, draft);
        } else if(wasPool){
          // Moving directly between pool submodes with no saved draft for the
          // target (first visit) — reshape in place rather than reseeding
          // from scratch, same as before.
          const enteringOrLeavingProcess = (newMode==='process') !== !!poolBoxes[0]?.synRow;
          if(enteringOrLeavingProcess){
            const vals = poolBoxes.map(b=>b.input.value);
            initPool(vals);
          } else {
            renumberPlaceholders();
          }
          if((newMode==='multi'||newMode==='process') && poolBoxes.length<2) addAnswerBox('');
        } else {
          initPool(newMode==='markscheme' ? [carryVal] : [carryVal,'']);
          requiredInput.value = String(poolBoxes.length);
        }
      } else if(willCalc){
        if(draft) applyDraft('calculation', draft);
        // Other modes are free-text (an answer, a marking keyword, a process
        // step…) so their value usually isn't a number at all — carrying it
        // straight into the numeric answer field just seeds it with text
        // that'll immediately fail the numeric-answer check on submit. Only
        // carry it over when it happens to already parse as a valid number
        // (e.g. hopping basic "42" -> calculation); otherwise leave it blank
        // for the user to type a real value.
        else calcAnswerInput.value = parseNumericAnswer(carryVal) ? carryVal : '';
      } else if(newMode==='table'){
        // Nothing to do — table's own state was never touched by leaving it.
      } else { // basic
        if(draft) applyDraft('basic', draft);
        else backField.querySelector('textarea').value = carryVal;
      }

      updateLabels();
      syncRequiredMax();
      syncVisibility();
      refreshModeButtons();
    }

    const hasPoolInitially = cardMode==='multi' || cardMode==='markscheme' || cardMode==='process';
    initPool(hasPoolInitially ? getCardAnswers(existing) : [], (existing&&existing.synonyms||[]).map(list=>(list||[]).join(', ')));
    requiredInput.value = String(hasPoolInitially ? Math.min(poolBoxes.length, Math.max(1, existing.requiredAnswers||poolBoxes.length)) : 1);
    if(cardMode==='calculation' && existing){
      calcAnswerInput.value = existing.back||'';
      calcUnitInput.value = existing.calcUnit||'';
      calcToleranceInput.value = String(existing.calcTolerance||0);
      calcToleranceModeSelect.value = normToleranceMode(existing.calcToleranceMode);
      onToleranceModeChange(calcToleranceModeSelect,calcToleranceInput,calcToleranceLabel,'Tolerance');
      (existing.methodPool||[]).forEach(v=>addMethodBox(v));
      methodRequiredInput.value = String(existing.methodRequired ?? (existing.methodPool||[]).length);
    }
    if(cardMode==='table' && existing){
      tableToleranceField.querySelector('input').value = String(existing.tableTolerance||0);
      tableToleranceModeSelect.value = normToleranceMode(existing.tableToleranceMode);
      onToleranceModeChange(tableToleranceModeSelect,tableToleranceInput,tableToleranceLabel,'Tolerance (applies to every blank)');
    }
    updateCalcPreview();
    syncMethodRequiredMax();
    updateLabels();
    syncRequiredMax();
    syncVisibility();
    refreshModeButtons();

    let citation = existing?.citation||null;
    const citSection = el('div',{style:'border-top:1px solid var(--border);padding-top:14px;margin-top:4px'});
    citSection.appendChild(el('div',{style:'font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px'},'📖 Source Citation (optional)'));
    const citInfo = el('div',{});
    function renderCitInfo() {
      citInfo.innerHTML = '';
      if(citation){
        const src=state.sources.find(s=>s.id===citation.sourceId);
        const chap=citation.chapterId?src?.chapters?.find(ch=>ch.id===citation.chapterId):null;
        const excerpt=src?src.content.slice(citation.charStart,citation.charEnd):'';
        citInfo.appendChild(el('div',{style:'padding:10px 12px;border-radius:8px;background:rgba(167,139,250,0.1);border:1px solid rgba(167,139,250,0.2);font-size:12px'},
          el('div',{style:'font-weight:700;color:#A78BFA;margin-bottom:4px'},`📖 ${src?.name||'Unknown'}${chap?` — ${chap.title}`:''}`),
          excerpt?el('div',{style:'color:var(--muted);font-style:italic;font-size:11px;line-height:1.5'},`"${excerpt.slice(0,120)}${excerpt.length>120?'…':''}"`):'',
          el('div',{style:'display:flex;gap:6px;margin-top:8px'},
            btn('View','ghost',{small:true,onclick:()=>openCitationViewer(citation)}),
            btn('Remove','danger',{small:true,onclick:()=>{ citation=null; renderCitInfo(); }})
          )
        ));
      } else if(state.sources.length) {
        citInfo.appendChild(btn('+ Add Citation','ghost',{onclick:()=>openCitationPicker(c=>{ citation=c; renderCitInfo(); })}));
      } else {
        citInfo.appendChild(el('div',{style:'font-size:12px;color:var(--muted);margin-bottom:6px'},'No sources in library.'),btn('Go to Library','ghost',{small:true,onclick:()=>{ closeModal(); navigate('library'); }}));
      }
    }
    renderCitInfo();
    citSection.appendChild(citInfo);

    // ── Full card preview — two small floating, draggable windows (Front /
    // Back) you can drag out from under the modal to check LaTeX/formatting
    // renders the way you expect before saving, without a round-trip through
    // Study mode. They're appended to document.body (not modal-body) so they
    // can be dragged anywhere on screen, including outside the modal's own
    // bounds — same convention openColorPicker() uses for its popover in
    // dashboard-core.js, including the pointer-capture drag technique (see
    // dragOn() there): pointer listeners live on the header itself via
    // setPointerCapture, so they need no separate teardown — they're gone the
    // moment the overlay element is removed. What DOES need explicit teardown
    // is the overlay element itself: unlike modal-body's children, it isn't
    // touched by openModal()'s body.innerHTML='' on the next dialog, so a
    // MutationObserver watches #modal-backdrop for the 'hidden' class this
    // modal's closeModal() (Save/×/backdrop-click/Escape all funnel through
    // it) adds, and removes both overlays right then.
    //
    // Content is rebuilt from scratch on every toggle/edit rather than kept
    // continuously live: cardMode's five very different field-sets make
    // targeted change listeners fiddly, and a full rebuild is cheap enough to
    // just always do. Deliberately reuses the *real* formatCardFront()/
    // formatCardBack()/getCardAnswers() (and, for table cards, the exact same
    // renderTablePreview() the table editor itself uses) rather than
    // re-deriving the "(N marks)" suffix or list layout by hand here — so
    // this can never silently drift from what Study mode actually shows, the
    // same reasoning the scheduling preview above uses for calling the real
    // scheduleCard().
    const OVERLAY_MIN_W = 220, OVERLAY_MIN_H = 120;
    function makeDraggableOverlay(label, positionStyle){
      const closeBtn = el('button',{type:'button',title:'Close preview',style:'background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;line-height:1;padding:0'},'✕');
      const header = el('div',{style:'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:rgba(255,255,255,0.04);border-bottom:1px solid var(--border);cursor:grab;flex-shrink:0;user-select:none;touch-action:none'},
        el('span',{style:'font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted)'},label),
        closeBtn
      );
      const content = el('div',{style:'padding:16px;overflow-y:auto;text-align:center;flex:1;min-height:0'});
      const overlay = el('div',{style:`position:fixed;${positionStyle}display:none;flex-direction:column;width:320px;max-height:min(70vh,520px);min-width:${OVERLAY_MIN_W}px;min-height:${OVERLAY_MIN_H}px;z-index:1150;border-radius:12px;overflow:hidden;background:var(--surface);border:1px solid rgba(var(--pink-rgb),0.3);box-shadow:0 0 32px var(--glow),0 8px 32px rgba(0,0,0,0.5)`},header,content);
      closeBtn.addEventListener('click',()=>{ overlay.style.display='none'; });
      header.addEventListener('pointerdown', e=>{
        if(e.target===closeBtn) return;
        header.setPointerCapture(e.pointerId);
        const rect = overlay.getBoundingClientRect();
        const offsetX = e.clientX-rect.left, offsetY = e.clientY-rect.top;
        overlay.style.left = rect.left+'px'; overlay.style.top = rect.top+'px';
        overlay.style.right = 'auto'; overlay.style.bottom = 'auto';
        header.style.cursor = 'grabbing';
        const move = ev=>{
          const maxLeft = window.innerWidth-60, maxTop = window.innerHeight-40;
          overlay.style.left = Math.min(Math.max(ev.clientX-offsetX,-overlay.offsetWidth+60),maxLeft)+'px';
          overlay.style.top = Math.min(Math.max(ev.clientY-offsetY,0),maxTop)+'px';
        };
        header.addEventListener('pointermove',move);
        header.addEventListener('pointerup',()=>{ header.removeEventListener('pointermove',move); header.style.cursor='grab'; },{once:true});
      });

      // ── Resize handles — 8 invisible strips/squares hugging the overlay's
      // own edges/corners (cursor feedback is the only affordance, same as a
      // native OS window's resize border). Since they're position:absolute
      // children of the (position:fixed) overlay, they paint above the
      // in-flow header regardless of DOM order — so the corner squares still
      // grab-to-resize even though they visually sit on top of the header
      // bar, while the rest of the header stays draggable as normal.
      // Registered in n/s/e/w order then corners last so a corner's square
      // (added after, same stacking level) wins hit-testing over the thin
      // edge strip it overlaps at each corner.
      const HANDLE = 8, CORNER = 14;
      const handleSpecs = [
        ['n', `top:0;left:${CORNER}px;right:${CORNER}px;height:${HANDLE}px;cursor:ns-resize`],
        ['s', `bottom:0;left:${CORNER}px;right:${CORNER}px;height:${HANDLE}px;cursor:ns-resize`],
        ['e', `top:${CORNER}px;right:0;bottom:${CORNER}px;width:${HANDLE}px;cursor:ew-resize`],
        ['w', `top:${CORNER}px;left:0;bottom:${CORNER}px;width:${HANDLE}px;cursor:ew-resize`],
        ['ne',`top:0;right:0;width:${CORNER}px;height:${CORNER}px;cursor:nesw-resize`],
        ['nw',`top:0;left:0;width:${CORNER}px;height:${CORNER}px;cursor:nwse-resize`],
        ['se',`bottom:0;right:0;width:${CORNER}px;height:${CORNER}px;cursor:nwse-resize`],
        ['sw',`bottom:0;left:0;width:${CORNER}px;height:${CORNER}px;cursor:nesw-resize`],
      ];
      handleSpecs.forEach(([dir,style])=>{
        const handle = el('div',{style:`position:absolute;${style};touch-action:none`});
        handle.addEventListener('pointerdown', e=>{
          e.stopPropagation();
          handle.setPointerCapture(e.pointerId);
          const rect = overlay.getBoundingClientRect();
          // Height starts content-driven (capped by max-height) so a short
          // preview doesn't default to a big empty box — only pin it to an
          // explicit, independently resizable value the first time a
          // vertical edge actually gets dragged.
          if((dir.includes('n')||dir.includes('s')) && !overlay.style.height){
            overlay.style.height = rect.height+'px';
            overlay.style.maxHeight = 'none';
          }
          const startX=e.clientX, startY=e.clientY;
          const startW=rect.width, startH=rect.height, startLeft=rect.left, startTop=rect.top;
          overlay.style.right = 'auto'; overlay.style.bottom = 'auto';
          const move = ev=>{
            const dx=ev.clientX-startX, dy=ev.clientY-startY;
            if(dir.includes('e')){ overlay.style.width = Math.max(OVERLAY_MIN_W,startW+dx)+'px'; }
            if(dir.includes('w')){
              const newW = Math.max(OVERLAY_MIN_W,startW-dx);
              overlay.style.width = newW+'px';
              overlay.style.left = (startLeft+(startW-newW))+'px';
            }
            if(dir.includes('s')){ overlay.style.height = Math.max(OVERLAY_MIN_H,startH+dy)+'px'; }
            if(dir.includes('n')){
              const newH = Math.max(OVERLAY_MIN_H,startH-dy);
              overlay.style.height = newH+'px';
              overlay.style.top = (startTop+(startH-newH))+'px';
            }
          };
          handle.addEventListener('pointermove',move);
          handle.addEventListener('pointerup',()=>{ handle.removeEventListener('pointermove',move); },{once:true});
        });
        overlay.appendChild(handle);
      });

      document.body.appendChild(overlay);
      return {overlay, content};
    }
    const frontOverlay = makeDraggableOverlay('Front','top:76px;left:24px;');
    const backOverlay = makeDraggableOverlay('Back (revealed)','top:76px;right:24px;');
    let previewVisible = false;
    function refreshPreview(){
      const front = frontField.querySelector('textarea').value.trim();
      const hint = hintField.querySelector('input').value.trim();
      const fc = frontOverlay.content, bc = backOverlay.content;
      fc.innerHTML = ''; bc.innerHTML = '';
      if(_frontImage) fc.appendChild(el('img',{src:_frontImage,style:'max-width:100%;max-height:140px;object-fit:contain;border-radius:8px;margin-bottom:10px'}));
      if(_backImage && cardMode!=='table') bc.appendChild(el('img',{src:_backImage,style:'max-width:100%;max-height:140px;object-fit:contain;border-radius:8px;margin-bottom:10px'}));

      if(cardMode==='table'){
        const draft = {front: front || 'Your question…'};
        const blanks = ((tCombos[tComboIdx]||{}).cells||[]).reduce((sum,arr)=>sum+((arr||[]).length),0);
        const marks = Math.max(1, blanks);
        fc.appendChild(setRichText(el('div',{style:'font-size:16px;line-height:1.5'}),`${draft.front} (${marks} mark${marks===1?'':'s'})`));
        bc.appendChild(renderTablePreview());
      } else if(cardMode==='calculation'){
        const methodRequired = Math.min(methodBoxes.length, Math.max(0, parseInt(methodRequiredInput.value,10)||0));
        const draft = {front: front || 'Your question…', type:'calculation', methodRequired};
        fc.appendChild(setRichText(el('div',{style:'font-size:16px;line-height:1.5'}),formatCardFront(draft)));
        const marks = 1+Math.max(0,methodRequired);
        bc.appendChild(el('div',{style:'font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px'},`Calculation · ${marks} mark${marks===1?'':'s'}`));
        const back = calcAnswerInput.value.trim() || 'Your answer…';
        const unit = calcUnitInput.value.trim();
        bc.appendChild(setRichText(el('div',{style:'font-size:20px;font-weight:800'}),`${back}${unit?` ${unit}`:''}`));
        const methodItems = methodBoxes.map(b=>b.input.value.trim()).filter(Boolean);
        if(methodItems.length){
          bc.appendChild(el('div',{style:'font-size:10px;color:var(--muted);margin:10px 0 4px;text-transform:uppercase;letter-spacing:0.05em'},'Method marks:'));
          bc.appendChild(el('ul',{style:'text-align:left;margin:0 auto;max-width:280px;padding-left:22px;line-height:1.6'},
            ...methodItems.map(pt=>setRichText(el('li',{style:'font-size:13px'}),pt))
          ));
        }
      } else if(cardMode==='markscheme' || cardMode==='process'){
        const items = poolBoxes.map(b=>b.input.value.trim()).filter(Boolean);
        const draft = {front: front || 'Your question…', type:cardMode, answerCount:Math.max(items.length,1), requiredAnswers:currentRequiredValue(), back:items.join('\n')};
        fc.appendChild(setRichText(el('div',{style:'font-size:16px;line-height:1.5'}),formatCardFront(draft)));
        if(!items.length){
          bc.appendChild(el('div',{style:'font-size:13px;color:var(--muted);font-style:italic'},cardMode==='process'?'No steps yet…':'No marking points yet…'));
        } else {
          const marks=Math.min(Math.max(draft.answerCount,1),Math.max(1,draft.requiredAnswers));
          bc.appendChild(el('div',{style:'font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px'},`${cardMode==='markscheme'?'Mark scheme':'Process'} · ${marks} mark${marks===1?'':'s'}`));
          if(cardMode==='process'){
            const steps=getCardAnswers(draft);
            bc.appendChild(el('ol',{style:'text-align:left;margin:0 auto;max-width:280px;padding-left:22px;line-height:1.9'},
              ...steps.map((s,i)=>el('li',{style:'font-size:15px'},setRichText(el('span'),s),i<steps.length-1?el('span',{style:'color:var(--muted);margin-left:6px'},'→'):null))
            ));
          } else {
            bc.appendChild(el('ul',{style:'text-align:left;margin:0 auto;max-width:280px;padding-left:22px;line-height:1.7'},
              ...getCardAnswers(draft).map(pt=>setRichText(el('li',{style:'font-size:15px'}),pt))
            ));
          }
        }
      } else {
        // basic / multi — a single answer, or several comma-joined ones, same
        // as the plain flip-card view (unlike markscheme/process it never gets
        // its own bulleted layout — see formatCardBack()).
        const items = cardMode==='multi' ? poolBoxes.map(b=>b.input.value.trim()).filter(Boolean) : null;
        const draft = {front: front || 'Your question…', type:'basic', answerCount: items?Math.max(items.length,1):1, back: items ? items.join('\n') : (backField.querySelector('textarea').value.trim())};
        fc.appendChild(setRichText(el('div',{style:'font-size:16px;line-height:1.5'}),formatCardFront(draft)));
        if(items && !items.length){
          bc.appendChild(el('div',{style:'font-size:13px;color:var(--muted);font-style:italic'},'No answers yet…'));
        } else {
          bc.appendChild(setRichText(el('div',{style:'font-size:16px;line-height:1.5'}),formatCardBack(draft)||'Your answer…'));
        }
      }
      if(hint) fc.appendChild(setRichText(el('div',{style:'font-size:12px;color:var(--muted);margin-top:10px'}),`💡 ${hint}`));
    }
    const previewToggleBtn = btn('👁 Show Preview','ghost',{full:true,onclick:()=>{
      previewVisible = !previewVisible;
      previewToggleBtn.textContent = previewVisible ? '🙈 Hide Preview' : '👁 Show Preview';
      frontOverlay.overlay.style.display = previewVisible ? 'flex' : 'none';
      backOverlay.overlay.style.display = previewVisible ? 'flex' : 'none';
      if(previewVisible) refreshPreview();
    }});
    // Tears down both overlays the moment this modal actually closes (Save,
    // ×, backdrop click, or Escape all funnel through closeModal(), which
    // only ever adds the 'hidden' class — never removes it outside of
    // openModal() — so watching for that addition is an unambiguous signal
    // this specific card-modal session is over). One-shot in effect: the
    // observer disconnects itself right after firing, so it can't pile up
    // across edits either.
    const modalCloseWatcher = new MutationObserver(()=>{
      if(document.getElementById('modal-backdrop').classList.contains('hidden')){
        frontOverlay.overlay.remove();
        backOverlay.overlay.remove();
        modalCloseWatcher.disconnect();
      }
    });
    modalCloseWatcher.observe(document.getElementById('modal-backdrop'),{attributes:true,attributeFilter:['class']});

    // Keep an open preview in sync while typing, without wiring a listener
    // onto every individual field across every card mode — event delegation
    // catches them all (text inputs/textareas fire 'input' on every
    // keystroke; mode-switch/pool add-remove/image-picker buttons are
    // clicks). Delegated on formWrap (a child of #modal-body created fresh
    // below), not on #modal-body itself — #modal-body is a single persistent
    // DOM node reused by openModal() for every dialog the app ever opens,
    // and only its children get torn down between opens (body.innerHTML=''),
    // so a listener attached directly to it would silently accumulate one
    // extra copy per card edited for the lifetime of the page.
    const formWrap = el('div',{style:'display:flex;flex-direction:column;gap:14px'});
    formWrap.addEventListener('input',()=>{ if(previewVisible) refreshPreview(); });
    formWrap.addEventListener('click',()=>{ if(previewVisible) refreshPreview(); });

    formWrap.append(frontField,frontPreview,frontImgPicker,backField,backImgPicker,modeRow,poolSection,requiredField,requiredPreview,calcSection,tableSection,hintField,tagsField,citSection,
      previewToggleBtn,
      btn(isEdit?'Save Changes':'Add Card','primary',{full:true,onclick:()=>{
        const front=frontField.querySelector('textarea').value.trim();
        let back, answerCount, requiredAnswers, type, synonyms=[], calcUnit=null, calcTolerance=0, calcToleranceMode='abs', methodPool=[], methodRequired=0;
        let tableData=null, tableTolerance=0, tableToleranceMode='abs';
        if(cardMode==='basic'){
          back=backField.querySelector('textarea').value.trim();
          answerCount=1; requiredAnswers=1; type='basic';
        } else if(cardMode==='table'){
          if(tCombos.every(combo=>combo.cells.every(arr=>!arr||!arr.length))){ showToast('Each combination needs at least one blanked cell'); return; }
          tableData = {
            columns: tCols.map(c=>({key:c.key,label:c.label,group:c.group})),
            rows: tRows.map(row=>{ const o={}; tCols.forEach((c,ci)=>{ o[c.key]=row[ci]; }); return o; }),
            combinations: tCombos.map(combo=>({name:combo.name,cells:combo.cells.map(arr=>(arr||[]).map(ci=>tCols[ci].key))})),
          };
          tableTolerance = Math.max(0, parseFloat(tableToleranceField.querySelector('input').value)||0);
          tableToleranceMode = normToleranceMode(tableToleranceModeSelect.value);
          back=''; answerCount=1; requiredAnswers=1; type='table';
        } else if(cardMode==='calculation'){
          back=calcAnswerInput.value.trim();
          if(!parseNumericAnswer(back)){ showToast('Numeric answer must be a number, fraction (1/2), or percentage (50%)'); return; }
          answerCount=1; requiredAnswers=1; type='calculation';
          calcUnit = calcUnitInput.value.trim() || null;
          calcTolerance = Math.max(0, parseFloat(calcToleranceInput.value)||0);
          calcToleranceMode = normToleranceMode(calcToleranceModeSelect.value);
          methodPool = methodBoxes.map(b=>b.input.value.trim()).filter(Boolean);
          methodRequired = Math.min(methodPool.length, Math.max(0, parseInt(methodRequiredInput.value,10)||0));
        } else {
          const answers=poolBoxes.map(b=>b.input.value.trim());
          const minN=minPoolSize();
          if(answers.length<minN){ showToast(cardMode==='markscheme' ? 'A mark scheme needs at least 1 marking point' : cardMode==='process' ? 'A process needs at least 2 steps' : 'A multi-answer card needs at least 2 answers'); return; }
          if(answers.some(a=>!a)){ showToast(cardMode==='markscheme' ? 'Please fill in every marking point, or remove the empty ones' : cardMode==='process' ? 'Please fill in every step, or remove the empty ones' : 'Please fill in every answer, or remove the empty ones'); return; }
          back=answers.join('\n');
          answerCount=answers.length;
          requiredAnswers=Math.min(answerCount,Math.max(1, parseInt(requiredInput.value,10)||answerCount));
          type = cardMode==='markscheme' ? 'markscheme' : cardMode==='process' ? 'process' : 'basic';
          if(cardMode==='process') synonyms = poolBoxes.map(b=>(b.synInput?.value||'').split(',').map(s=>s.trim()).filter(Boolean));
        }
        if(!front||(!back&&cardMode!=='table')){ showToast('Front and back are required'); return; }
        const tags=tagsField.querySelector('input').value.split(',').map(t=>t.trim()).filter(Boolean);
        const hint=hintField.querySelector('input').value.trim();
        const typeFields={front,back,answerCount,requiredAnswers,type,synonyms,calcUnit,calcTolerance,calcToleranceMode,methodPool,methodRequired,tableData,tableTolerance,tableToleranceMode,hint,tags,citation:citation||null};
        if(isEdit){ Object.assign(existing,typeFields,{frontImage:_frontImage,backImage:_backImage}); }
        else {
          deck.cards.push({id:uid('c'),...typeFields,frontImage:_frontImage||null,backImage:_backImage||null,ease:2.5,interval:0,reps:0,lapses:0,due:Date.now(),state:'new',created:Date.now()});
          addXP(calcCardXP({ease:2.5,lapses:0},3));
          checkAchievements();
        }
        scheduleSave(); closeModal(); showToast(isEdit?'Card updated ✓':'Card added! 🎉'); openDeckDetail(deckId);
      }})
    );
    body.appendChild(formWrap);
  });
}

function openCitationPicker(onSelect) {
  openModal('Select Source', body => {
    if(!state.sources.length){
      body.appendChild(el('div',{style:'text-align:center;padding:24px;display:flex;flex-direction:column;align-items:center;gap:10px'},
        el('div',{style:'font-size:13px;color:var(--muted)'},'No sources yet.'),
        btn('Go to Library','primary',{onclick:()=>{ closeModal(); navigate('library'); }})
      ));
      return;
    }
    state.sources.forEach(src => {
      body.appendChild(el('div',{class:'source-item card',style:'margin-bottom:8px;cursor:pointer',onclick:()=>openCitationRangeModal(src,onSelect)},
        el('div',{class:'source-icon'},sourceTypeIcon(src)),
        el('div',{},el('div',{class:'source-name'},src.name),el('div',{class:'source-meta'},`${src.content.length.toLocaleString()} chars · ${src.chapters?.length||0} chapters`))
      ));
    });
  });
}

function openCitationRangeModal(source, onSelect) {
  openModal(`Cite: ${source.name}`, body => {
    const snippetField = createField('Paste the relevant snippet to locate it','text','Paste exact text…',true);
    snippetField.querySelector('textarea').rows = 3;
    let charStart=0, charEnd=0;
    const rangeInfo = el('div',{style:'font-size:11px;margin-top:4px'});
    // Multi-occurrence navigator
    const occNav = el('div',{style:'display:none'});
    let allOccurrences=[], occIdx=0;

    function renderOccNav() {
      occNav.innerHTML='';
      if(allOccurrences.length<2) return;
      const occ=allOccurrences[occIdx];
      const ctxStart=Math.max(0,occ.start-120), ctxEnd=Math.min(source.content.length,occ.end+120);
      const preview=el('div',{style:'font-size:12px;line-height:1.6;padding:10px 12px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid var(--border);margin-top:8px;white-space:pre-wrap;max-height:120px;overflow:hidden'},
        ctxStart>0?el('span',{style:'color:var(--muted);font-size:11px'},'…'):'',
        el('span',{style:'color:var(--muted)'},source.content.slice(ctxStart,occ.start)),
        el('mark',{style:'background:rgba(var(--pink-rgb),0.35);color:var(--text);border-radius:2px;padding:0 2px;border-bottom:2px solid var(--pink)'},source.content.slice(occ.start,occ.end)),
        el('span',{style:'color:var(--muted)'},source.content.slice(occ.end,ctxEnd)),
        ctxEnd<source.content.length?el('span',{style:'color:var(--muted);font-size:11px'},'…'):''
      );
      const counter=el('div',{style:'font-size:11px;color:var(--muted);text-align:center;margin-top:4px'},`Occurrence ${occIdx+1} of ${allOccurrences.length}`);
      const arrows=el('div',{style:'display:flex;align-items:center;justify-content:center;gap:8px;margin-top:6px'},
        btn('◀ Prev','ghost',{small:true,onclick:()=>{ occIdx=(occIdx-1+allOccurrences.length)%allOccurrences.length; charStart=allOccurrences[occIdx].start; charEnd=allOccurrences[occIdx].end; renderOccNav(); }}),
        btn('Next ▶','ghost',{small:true,onclick:()=>{ occIdx=(occIdx+1)%allOccurrences.length; charStart=allOccurrences[occIdx].start; charEnd=allOccurrences[occIdx].end; renderOccNav(); }})
      );
      occNav.append(preview,counter,arrows);
    }

    snippetField.querySelector('textarea').addEventListener('input', e => {
      const snippet = e.target.value.trim(); if(!snippet){ rangeInfo.textContent=''; occNav.style.display='none'; return; }
      allOccurrences=[]; let pos=0;
      while(true){ const idx=source.content.indexOf(snippet,pos); if(idx===-1) break; allOccurrences.push({start:idx,end:idx+snippet.length}); pos=idx+1; }
      if(allOccurrences.length===0){ charStart=0; charEnd=0; rangeInfo.style.color='#ef4444'; rangeInfo.textContent='✗ Snippet not found in source'; occNav.style.display='none'; }
      else {
        occIdx=0; charStart=allOccurrences[0].start; charEnd=allOccurrences[0].end;
        const chap=source.chapters?.find(c=>charStart>=c.start&&charEnd<=c.end);
        if(allOccurrences.length===1){
          rangeInfo.style.color='#22c55e'; rangeInfo.textContent=`✓ Found at ${charStart}–${charEnd}${chap?` (${chap.title})`:''}`;
          occNav.style.display='none';
        } else {
          rangeInfo.style.color='#FBBF24'; rangeInfo.textContent=`⚠ ${allOccurrences.length} occurrences found — select which one:`;
          occNav.style.display='';
          renderOccNav();
        }
      }
    });

    let selectedChapterId = null;
    const chapSection = source.chapters?.length ? el('div',{class:'field',style:'margin-top:10px'},
      el('label',{},'Chapter (optional)'),
      (() => {
        const sel=el('select',{class:'u-input',onchange:e=>{selectedChapterId=e.target.value||null;}});
        sel.appendChild(el('option',{value:'',class:'u-bg'},'Auto-detect from position'));
        source.chapters.forEach(ch=>sel.appendChild(el('option',{value:ch.id,class:'u-bg'},ch.title)));
        return sel;
      })()
    ) : null;

    body.append(snippetField, rangeInfo, occNav);
    if(chapSection) body.append(chapSection);
    body.append(btn('Add Citation','primary',{full:true,onclick:()=>{
      if(!charEnd){ showToast('Paste a snippet to find its position'); return; }
      const chap=selectedChapterId||source.chapters?.find(c=>charStart>=c.start&&charEnd<=c.end)?.id||null;
      onSelect({sourceId:source.id,charStart,charEnd,chapterId:chap}); closeModal();
    }}));
  });
}

function openCitationViewer(citation) {
  if(!citation)return;
  const source=state.sources.find(s=>s.id===citation.sourceId);
  if(!source){ showToast('Source not found'); return; }
  const chap=citation.chapterId?source.chapters?.find(c=>c.id===citation.chapterId):null;
  openModal(`📖 ${source.name}`, body => {
    if(chap) body.appendChild(el('div',{class:'source-chapter-badge'},chap.title));
    const ctx=300;
    const start=Math.max(0,citation.charStart-ctx), end=Math.min(source.content.length,citation.charEnd+ctx);
    const viewer=el('div',{class:'source-text-viewer'},
      start>0?el('span',{style:'color:var(--muted)'},'…'):'',
      document.createTextNode(source.content.slice(start,citation.charStart)),
      el('mark',{class:'source-highlight'},source.content.slice(citation.charStart,citation.charEnd)),
      document.createTextNode(source.content.slice(citation.charEnd,end)),
      end<source.content.length?el('span',{style:'color:var(--muted)'},'…'):''
    );
    body.appendChild(viewer);
    setTimeout(()=>{ const m=body.querySelector('.source-highlight'); if(m)m.scrollIntoView({block:'center',behavior:'smooth'}); },100);
  });
}

let studySession = null;

