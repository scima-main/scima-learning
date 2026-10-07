'use strict';
/* dashboard-study.js — the study session: scope picker, flashcard/quiz
   rendering, rating, and session bookkeeping. Part of the dashboard-*.js
   split; see dashboard-core.js's header for the full rationale and
   load-order rules. */

// Interval handle for the Written Quiz's optional countdown (toggled via the
// "⏱️ Timed" checkbox in the study picker). Lives outside `studySession`
// (which gets replaced/nulled wholesale on exit/finish/next-card) so it can
// always be cleared before a new one starts, even across full re-renders.
let quizTimerHandle = null;
function clearQuizTimer(){ if(quizTimerHandle){ clearInterval(quizTimerHandle); quizTimerHandle=null; } }

// ── Session statistics log ────────────────────────────────────────────────
// state.sessionLog is an array of completed-session records, saved alongside
// state. Each entry captures everything interesting about a single study
// session so Analytics can surface trends over time.
//
// Schema (all numeric fields stored as plain numbers; timestamps as ms epoch):
//   { ts, mode, durationSec, totalCards, correct, incorrect, skipped,
//     accuracyPct, maxCombo, timed,
//     // quiz/gap specific (null for flashcard sessions):
//     charsTyped, keystrokes, avgKsPerSec, wpm, timeouts,
//     avgMsPerCard, fastestCardMs, slowestCardMs,
//     // flashcard specific:
//     avgFlipMs,
//     // gap specific:
//     gapCorrect, gapClose, gapWrong,
//     // subject breakdown:
//     subjectKey }
//
// Cap at MAX_SESSION_LOG entries to avoid unbounded storage growth.
const MAX_SESSION_LOG = 500;

/** Called by finishSession() to push a completed record and persist. */
function pushSessionLog(sess, elapsed) {
  if (!state.sessionLog) state.sessionLog = [];
  const total = sess.stats.correct + sess.stats.incorrect;
  const deck = sess.queue[0]
    ? state.decks.find(d => d.cards.some(c => c.id === sess.queue[0].id))
    : null;
  const subjectKey = deck?.subject || DEFAULT_SUBJECT_KEY;

  // Keystroke / typing metrics — only meaningful for quiz/gap modes.
  const ks = sess._keystrokes || 0;
  const ch = sess._charsTyped || 0;
  const avgKsPerSec = elapsed > 0 ? Math.round((ks / elapsed) * 100) / 100 : 0;
  // WPM: assume average word = 5 chars.
  const wpm = elapsed > 0 ? Math.round((ch / 5) / (elapsed / 60)) : 0;

  // Per-card timing arrays.
  const cardTimes = sess._cardTimes || [];
  const avgMsPerCard = cardTimes.length
    ? Math.round(cardTimes.reduce((a, b) => a + b, 0) / cardTimes.length)
    : null;
  const fastestCardMs = cardTimes.length ? Math.min(...cardTimes) : null;
  const slowestCardMs = cardTimes.length ? Math.max(...cardTimes) : null;

  // Flip timing for flashcard mode.
  const flipTimes = sess._flipTimes || [];
  const avgFlipMs = flipTimes.length
    ? Math.round(flipTimes.reduce((a, b) => a + b, 0) / flipTimes.length)
    : null;

  const entry = {
    ts: Date.now(),
    mode: sess.mode,
    durationSec: elapsed,
    totalCards: sess.queue.length,
    cardsAttempted: total + (sess.stats.skipped || 0),
    correct: sess.stats.correct,
    incorrect: sess.stats.incorrect,
    skipped: sess.stats.skipped || 0,
    accuracyPct: total > 0 ? Math.round((sess.stats.correct / total) * 100) : null,
    maxCombo: sess.maxCombo,
    timed: !!sess.timed,
    // typing
    charsTyped: ch || null,
    keystrokes: ks || null,
    avgKsPerSec: ks > 0 ? avgKsPerSec : null,
    wpm: wpm > 0 ? wpm : null,
    timeouts: sess._timeouts || null,
    backspaces: sess._backspaces || null,
    // per-card timing
    avgMsPerCard,
    fastestCardMs,
    slowestCardMs,
    firstCardMs: sess._firstCardMs || null,
    // flashcard flip
    avgFlipMs,
    // gap-fill breakdown
    gapCorrect: sess._gap ? (sess._gap.correct || 0) : null,
    gapClose:   sess._gap ? (sess._gap.close   || 0) : null,
    gapWrong:   sess._gap ? (sess._gap.wrong    || 0) : null,
    // subject
    subjectKey,
  };

  state.sessionLog.unshift(entry);
  if (state.sessionLog.length > MAX_SESSION_LOG)
    state.sessionLog.length = MAX_SESSION_LOG;
  scheduleSave();
}

function renderStudy(c) {
  if(studySession?.active){ renderStudySession(c); return; }
  renderStudyPicker(c);
}

function renderStudyPicker(c) {
  studySession = null;
  c.style.cssText='';
  const scopedCards = getScopeSetCards(state.studyScope);
  if(!state.studyRefine) state.studyRefine = { mode:'all', cardIds:[], n:20, easeDir:'hardest' };
  const refine = state.studyRefine;
  const refinedCards = applyStudyRefine(scopedCards, refine);
  const scopeDue = getDueCards(refinedCards).length;

  const MODES=[
    {id:'review',icon:'🔄',label:'SRS Review',desc:'Due cards, spaced repetition'},
    {id:'cram',icon:'💨',label:'Cram Mode',desc:'All cards, no scheduling'},
    {id:'quiz',icon:'✍️',label:'Written Quiz',desc:'Type your answer, self-mark'},
    {id:'gaps',icon:'🧩',label:'Fill in the Gaps',desc:'Recall the missing word in context'},
    {id:'weakness',icon:'⚠️',label:'Weakness',desc:'Cards you struggle with'},
    {id:'multi',icon:'☑️',label:'Multiple Choice',desc:'Pick the right answer from 4'},
  ];

  // ── Recents: one-click quick access to previously-studied scopes ──
  const recentsRow = el('div',{style:'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px'});
  recentsRow.appendChild(mkScopePill('🌍','All Decks', sameScopeSet(state.studyScope,[{type:'all',id:null}]), ()=>{ state.studyScope=[{type:'all',id:null}]; renderView('study'); }, null));
  orderedRecentScopes().forEach(r=>{
    recentsRow.appendChild(mkScopePill(r.icon, r.label, sameScopeSet(state.studyScope, r.scopes), ()=>{ state.studyScope=r.scopes; renderView('study'); }, { pinned:r.pinned, onToggle:()=>{ toggleRecentPin(r.key); renderView('study'); } }));
  });

  // ── Current scope summary + button to open the full deck explorer overlay ──
  const summary = scopeSetLabel(state.studyScope);
  const scopeSummaryBar = el('div',{style:'display:flex;align-items:center;gap:12px;padding:12px 16px;background:rgba(255,255,255,0.04);border-radius:10px;margin-bottom:14px'},
    el('span',{style:'font-size:22px'},summary.icon),
    el('div',{style:'flex:1;min-width:0'},
      el('div',{style:'font-weight:800;font-size:13px'},summary.label),
      el('div',{class:'u-muted-11'},`${scopedCards.length} total cards · ${scopeDue} due`)
    ),
    btn('📂 Browse Decks…','ghost',{onclick:openStudyScopeExplorer})
  );

  // ── Refine: an extra, finer-grained filter layered on top of the scope
  // above — hand-pick individual cards, or narrow to the N cards studied
  // longest ago / by ease within the current scope. See applyStudyRefine(). ──
  const REFINE_MODES = [
    {id:'all',label:'Full scope'},
    {id:'cards',label:'Hand-picked cards'},
    {id:'stale',label:'Least recently studied'},
    {id:'ease',label:'By ease'},
  ];
  const refineRow = el('div',{style:'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px;padding:10px 14px;background:rgba(255,255,255,0.04);border-radius:10px;'});
  const refineSelect = el('select',{style:'padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-family:inherit;font-weight:700;font-size:12px'});
  REFINE_MODES.forEach(m=>refineSelect.appendChild(el('option',{value:m.id},m.label)));
  refineSelect.value = refine.mode;
  refineSelect.addEventListener('change',()=>{ refine.mode=refineSelect.value; scheduleSave(); renderView('study'); });
  refineRow.append(el('label',{style:'font-size:12px;font-weight:700;color:var(--text)'},'🎯 Refine:'), refineSelect);

  if(refine.mode==='cards'){
    refineRow.append(btn(`📇 Pick Cards… (${refine.cardIds.length} selected)`,'ghost',{small:true,onclick:()=>openCardPickerModal(scopedCards, refine)}));
  } else if(refine.mode==='stale' || refine.mode==='ease'){
    const nInput = el('input',{type:'number',min:'1',max:String(Math.max(1,scopedCards.length)),style:'width:60px;padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-family:inherit;font-weight:700;font-size:12px'});
    nInput.value = refine.n;
    nInput.addEventListener('change',()=>{ refine.n=Math.max(1,parseInt(nInput.value,10)||20); scheduleSave(); renderView('study'); });
    refineRow.append(el('label',{style:'font-size:12px;color:var(--muted);font-weight:700'},'Cards:'), nInput);
    if(refine.mode==='ease'){
      const dirSelect = el('select',{style:'padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-family:inherit;font-weight:700;font-size:12px'});
      [['hardest','Hardest first (lowest ease)'],['easiest','Easiest first (highest ease)']].forEach(([v,l])=>dirSelect.appendChild(el('option',{value:v},l)));
      dirSelect.value = refine.easeDir;
      dirSelect.addEventListener('change',()=>{ refine.easeDir=dirSelect.value; scheduleSave(); renderView('study'); });
      refineRow.append(dirSelect);
    }
  }
  if(refine.mode!=='all') refineRow.append(btn('✕ Clear','ghost',{small:true,onclick:()=>{ refine.mode='all'; scheduleSave(); renderView('study'); }}));
  refineRow.append(el('span',{style:'font-size:11px;color:var(--muted);margin-left:auto'}, refine.mode==='all' ? `${scopedCards.length} cards` : `${refinedCards.length} of ${scopedCards.length} cards selected`));

  if(state.settings.showStudyImages===undefined)state.settings.showStudyImages=true;
  const hasImages=refinedCards.some(c=>c.frontImage||c.backImage);
  const imgToggleRow=el('div',{style:'display:flex;align-items:center;gap:10px;margin-bottom:14px;padding:10px 14px;background:rgba(255,255,255,0.04);border-radius:10px;'+(hasImages?'':'opacity:0.4;pointer-events:none')});
  const imgChk=el('input',{type:'checkbox',id:'img-toggle',style:'width:16px;height:16px;accent-color:var(--blue);cursor:pointer'});
  imgChk.checked=state.settings.showStudyImages;
  imgChk.addEventListener('change',function(){state.settings.showStudyImages=imgChk.checked;scheduleSave();});
  imgToggleRow.append(imgChk,el('label',{for:'img-toggle',style:'font-size:12px;font-weight:700;cursor:pointer;color:var(--text)'},'Show card images during study'),el('span',{style:'font-size:11px;color:var(--muted);margin-left:auto'},hasImages?'Images available':'No images in scope'));

  if(state.settings.timedQuizSeconds===undefined)state.settings.timedQuizSeconds=30;
  if(state.settings.quizTimed===undefined)state.settings.quizTimed=false;
  const timerRow=el('div',{style:'display:flex;align-items:center;gap:10px;margin-bottom:14px;padding:10px 14px;background:rgba(255,255,255,0.04);border-radius:10px;'});
  const timedChk=el('input',{type:'checkbox',id:'quiz-timed',style:'width:16px;height:16px;accent-color:var(--blue);cursor:pointer'});
  timedChk.checked=state.settings.quizTimed;
  const timerInput=el('input',{type:'number',id:'timed-quiz-seconds',min:'5',max:'300',step:'5',style:'width:60px;padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-family:inherit;font-weight:700;font-size:12px'});
  timerInput.value=state.settings.timedQuizSeconds;
  timerInput.disabled=!state.settings.quizTimed;
  timerInput.style.opacity=state.settings.quizTimed?1:0.4;
  timedChk.addEventListener('change',function(){
    state.settings.quizTimed=timedChk.checked;
    timerInput.disabled=!timedChk.checked;
    timerInput.style.opacity=timedChk.checked?1:0.4;
    scheduleSave();
  });
  timerInput.addEventListener('change',function(){
    const v=Math.max(5,Math.min(300,parseInt(timerInput.value,10)||30));
    timerInput.value=v; state.settings.timedQuizSeconds=v; scheduleSave();
  });
  timerRow.append(timedChk,el('label',{for:'quiz-timed',style:'font-size:12px;font-weight:700;color:var(--text);cursor:pointer'},'⏱️ Timed'),el('label',{for:'timed-quiz-seconds',style:'font-size:12px;font-weight:700;color:var(--muted)'},'Seconds per card:'),timerInput,el('span',{style:'font-size:11px;color:var(--muted);margin-left:auto'},'Applies to Written Quiz · auto-submits when time runs out'));

  const modeGrid = el('div',{class:'grid-3'});
  MODES.forEach(m => {
    // Multiple Choice needs a question card plus 3 distractors, all drawn
    // from basic cards (only type with a single plain answer to show as an
    // option) — so it's gated on there being at least 4 in scope, not just
    // any cards, unlike every other mode.
    const hasCards = m.id==='multi'
      ? refinedCards.filter(c=>c.type==='basic').length>=4
      : refinedCards.length>0;
    const startBtn=btn('Start','primary',{full:true,disabled:!hasCards,onclick:()=>startStudySession(state.studyScope,m.id)});
    if(m.id==='review') startBtn.id='tutorial-target-study-start';
    modeGrid.appendChild(el('div',{class:`card${hasCards?' glow':''}`,style:`padding:20px;opacity:${hasCards?1:0.5}`},
      el('div',{style:'font-size:28px;margin-bottom:8px'},m.icon),
      el('div',{style:'font-weight:800;font-size:14px;margin-bottom:4px'},m.label),
      el('div',{style:'font-size:11px;color:var(--muted);margin-bottom:14px'},m.desc),
      startBtn
    ));
  });

  c.append(
    el('div',{},el('div',{class:'section-title'},'Study Mode'),el('div',{class:'section-sub'},'Pick a scope and mode to begin')),
    el('div',{class:'u-section-label'},'Recents'),
    recentsRow,
    scopeSummaryBar,
    refineRow,
    el('div',{class:'u-section-label'},'Options'),
    imgToggleRow,
    timerRow,
    el('div',{style:'font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px'},'Mode'),
    modeGrid
  );
}

// ── Full deck file-explorer overlay for picking (multiple) study scopes ──
// Browse Subjects → Folders → Decks exactly like the Decks tab, but every
// level (subject / folder / deck) has its own checkbox so several can be
// combined into one study session at once.
function openStudyScopeExplorer() {
  const selection = new Map(); // scopeKey -> scope object
  (state.studyScope||[]).forEach(s=>selection.set(scopeKey(s), s));
  let nav = { view:'subjects', subjectKey:null, folderId:null };

  const overlay = el('div',{id:'study-scope-overlay',style:'position:fixed;inset:0;z-index:1000;background:var(--bg);display:flex;flex-direction:column;animation:fadeIn 0.2s ease;'});
  const header = el('div',{style:'display:flex;align-items:center;gap:12px;padding:16px 24px;border-bottom:1px solid var(--border);flex-shrink:0'},
    el('div',{style:'font-weight:900;font-size:16px'},'📂 Choose Study Scope'),
    el('div',{style:'margin-left:auto;font-size:11px;color:var(--muted)'},'Click to browse · check a box to select'),
    el('button',{style:'background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer;line-height:1;padding:0 4px',onclick:()=>closeOverlay()},'✕')
  );
  const recentsRow = el('div',{style:'display:flex;gap:8px;flex-wrap:wrap;padding:14px 24px 0;flex-shrink:0'});
  const bodyWrap = el('div',{style:'flex:1;overflow-y:auto;padding:16px 24px 24px'});
  const footer = el('div',{style:'display:flex;align-items:center;gap:12px;padding:14px 24px;background:var(--surface);border-top:1px solid var(--border);flex-shrink:0'});
  overlay.append(header, recentsRow, bodyWrap, footer);
  document.body.appendChild(overlay);

  function closeOverlay(){ overlay.remove(); }

  function isChecked(scope){ return selection.has(scopeKey(scope)); }
  function toggle(scope){
    const k=scopeKey(scope);
    if(scope.type==='all'){
      if(selection.has(k)) selection.clear(); else { selection.clear(); selection.set(k,scope); }
    } else {
      selection.delete(scopeKey({type:'all',id:null}));
      if(selection.has(k)) selection.delete(k); else selection.set(k,scope);
    }
    refreshAll();
  }
  function checkbox(scope){
    return el('div',{class:'scope-checkbox'+(isChecked(scope)?' checked':''),title:'Select',onclick:e=>{ e.stopPropagation(); toggle(scope); }});
  }

  function renderRecents(){
    recentsRow.innerHTML='';
    recentsRow.appendChild(el('div',{style:'width:100%;font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px'},'Recent'));
    const allActive = isChecked({type:'all',id:null}) && selection.size===1;
    recentsRow.appendChild(mkScopePill('🌍','All Decks', allActive, ()=>{ selection.clear(); selection.set(scopeKey({type:'all',id:null}),{type:'all',id:null}); refreshAll(); }, null));
    orderedRecentScopes().forEach(r=>{
      const active = r.scopes.length===selection.size && r.scopes.every(s=>isChecked(s));
      recentsRow.appendChild(mkScopePill(r.icon, r.label, active, ()=>{ selection.clear(); r.scopes.forEach(s=>selection.set(scopeKey(s),s)); refreshAll(); }, { pinned:r.pinned, onToggle:()=>{ toggleRecentPin(r.key); renderRecents(); } }));
    });
  }

  function renderBreadcrumb(){
    const bc = el('div',{class:'breadcrumb',style:'margin-bottom:14px'});
    bc.appendChild(el('span',{class:`breadcrumb-part${nav.view==='subjects'?' active':''}`,onclick:nav.view==='subjects'?null:()=>{ nav={view:'subjects'}; renderBody(); }},'📚 All Subjects'));
    if(nav.view==='subject'||nav.view==='folder'){
      const s=getSubjectSafe(nav.subjectKey);
      bc.append(el('span',{class:'breadcrumb-sep'},'›'), el('span',{class:`breadcrumb-part${nav.view==='subject'?' active':''}`,style:`color:${s.defaultColor}`,onclick:nav.view==='subject'?null:()=>{ nav={view:'subject',subjectKey:nav.subjectKey}; renderBody(); }},s.name));
    }
    if(nav.view==='folder'){
      const chain=[]; let cur=state.folders.find(f=>f.id===nav.folderId);
      while(cur){ chain.unshift(cur); cur=state.folders.find(f=>f.id===cur.parentId); }
      chain.forEach((f,i)=>{
        bc.append(el('span',{class:'breadcrumb-sep'},'›'));
        const isLast=i===chain.length-1;
        bc.append(el('span',{class:`breadcrumb-part${isLast?' active':''}`,onclick:isLast?null:()=>{ nav={view:'folder',subjectKey:f.subjectKey,folderId:f.id}; renderBody(); }},f.name));
      });
    }
    return bc;
  }

  function renderFoldersAndDecks(folders, decks){
    if(folders.length){
      bodyWrap.appendChild(el('div',{class:'u-section-label'},'Folders'));
      const list=el('div',{class:'card',style:'margin-bottom:16px;overflow:hidden'});
      folders.forEach(f=>{
        const fd=state.decks.filter(d=>d.folderId===f.id);
        const sf=state.folders.filter(x=>x.parentId===f.id);
        const due=getDueCards(fd.flatMap(d=>d.cards)).length;
        const row=el('div',{class:'folder-item'+(isChecked({type:'folder',id:f.id})?' explorer-selected':'')},
          checkbox({type:'folder',id:f.id}),
          mkIcon(f.emoji||'📁',f.image,'22px','4px'),
          el('div',{style:'flex:1;min-width:0'},el('div',{class:'folder-name'},f.name),el('div',{class:'folder-meta'},`${fd.length} deck${fd.length!==1?'s':''}${sf.length?` · ${sf.length} subfolder${sf.length!==1?'s':''}`:''}${due>0?` · ${due} due`:''}`)),
          el('span',{style:'color:var(--muted);font-size:16px;margin-left:4px'},'›')
        );
        row.addEventListener('click',e=>{ if(e.target.closest('.scope-checkbox')) return; nav={view:'folder',subjectKey:f.subjectKey,folderId:f.id}; renderBody(); });
        list.appendChild(row);
      });
      bodyWrap.appendChild(list);
    }
    if(decks.length){
      bodyWrap.appendChild(el('div',{class:'u-section-label'},'Decks'));
      const grid=el('div',{class:'grid-3'});
      decks.forEach(d=>{
        const due=getDueCards(d.cards).length;
        const tile=el('div',{class:'card'+(isChecked({type:'deck',id:d.id})?' explorer-selected':''),style:'padding:16px;cursor:pointer'},
          el('div',{style:'display:flex;align-items:center;gap:10px'},
            checkbox({type:'deck',id:d.id}), mkIcon(d.emoji,d.image,'26px','6px'),
            el('div',{style:'flex:1;min-width:0'},el('div',{style:'font-weight:800;font-size:13px'},d.name),el('div',{class:'u-muted-11'},`${d.cards.length} cards${due>0?` · ${due} due`:''}`))
          )
        );
        tile.addEventListener('click',e=>{ if(e.target.closest('.scope-checkbox')) return; toggle({type:'deck',id:d.id}); });
        grid.appendChild(tile);
      });
      bodyWrap.appendChild(grid);
    }
    if(!folders.length && !decks.length) bodyWrap.appendChild(el('div',{class:'empty-state'},el('div',{class:'empty-icon'},'📂'),el('div',{class:'empty-title'},'Empty')));
  }

  function renderBody(){
    bodyWrap.innerHTML='';
    bodyWrap.appendChild(renderBreadcrumb());

    if(nav.view==='subjects'){
      const allChecked=isChecked({type:'all',id:null});
      const allRow = el('div',{class:'card'+(allChecked?' explorer-selected':''),style:'display:flex;align-items:center;gap:12px;padding:14px 16px;margin-bottom:14px;cursor:pointer'},
        checkbox({type:'all',id:null}),
        el('span',{style:'font-size:20px'},'🌍'),
        el('div',{style:'flex:1'},el('div',{style:'font-weight:800;font-size:13px'},'All Decks'),el('div',{class:'u-muted-11'},`${state.decks.length} deck${state.decks.length!==1?'s':''} total`))
      );
      allRow.addEventListener('click',e=>{ if(e.target.closest('.scope-checkbox')) return; toggle({type:'all',id:null}); });
      bodyWrap.appendChild(allRow);

      const subjects = new Set([...state.decks.map(d=>d.subject||DEFAULT_SUBJECT_KEY), ...state.folders.filter(f=>!f.parentId).map(f=>f.subjectKey)]);
      if(!subjects.size){ bodyWrap.appendChild(el('div',{class:'empty-state'},el('div',{class:'empty-icon'},'📚'),el('div',{class:'empty-title'},'No decks yet'))); return; }

      bodyWrap.appendChild(el('div',{class:'u-section-label'},'Subjects'));
      const grid = el('div',{class:'grid-3'});
      subjects.forEach(sk=>{
        const s=getSubjectSafe(sk);
        const subjectDecks=state.decks.filter(d=>(d.subject||DEFAULT_SUBJECT_KEY)===sk);
        const subjectFolders=state.folders.filter(f=>f.subjectKey===sk&&!f.parentId);
        const due=getDueCards(subjectDecks.flatMap(d=>d.cards)).length;
        const tile = el('div',{class:'card subject-tile'+(isChecked({type:'subject',id:sk})?' explorer-selected':'')},
          checkbox({type:'subject',id:sk}),
          el('div',{class:'subject-tile-accent',style:`background:${s.defaultColor}`}),
          el('div',{class:'subject-tile-name',style:`color:${s.defaultColor}`},s.name),
          el('div',{class:'subject-tile-meta'},s.board),
          el('div',{class:'subject-tile-counts'}, mkTag(`${subjectDecks.length} decks`,s.defaultColor), subjectFolders.length?mkTag(`${subjectFolders.length} folders`,'#A78BFA'):null, due>0?mkTag(`${due} due`,'var(--pink)'):null)
        );
        tile.addEventListener('click',e=>{ if(e.target.closest('.scope-checkbox')) return; nav={view:'subject',subjectKey:sk}; renderBody(); });
        grid.appendChild(tile);
      });
      bodyWrap.appendChild(grid);
    } else if(nav.view==='subject'){
      const sk=nav.subjectKey;
      renderFoldersAndDecks(
        state.folders.filter(f=>f.subjectKey===sk&&!f.parentId),
        state.decks.filter(d=>(d.subject||DEFAULT_SUBJECT_KEY)===sk&&!d.folderId)
      );
    } else if(nav.view==='folder'){
      const folder=state.folders.find(f=>f.id===nav.folderId);
      if(!folder){ nav={view:'subjects'}; renderBody(); return; }
      renderFoldersAndDecks(
        state.folders.filter(f=>f.parentId===folder.id),
        state.decks.filter(d=>d.folderId===folder.id)
      );
    }
  }

  function renderFooter(){
    footer.innerHTML='';
    const scopes=[...selection.values()];
    const cardCount = getScopeSetCards(scopes.length?scopes:[{type:'all',id:null}]).length;
    footer.append(
      el('div',{style:'font-size:12px;font-weight:700;color:var(--muted)'}, scopes.length ? `${scopes.length} selected · ${cardCount} cards` : `Nothing selected — defaults to All Decks (${cardCount} cards)`),
      el('div',{style:'margin-left:auto;display:flex;gap:8px'},
        btn('Clear','ghost',{small:true,onclick:()=>{ selection.clear(); refreshAll(); }}),
        btn('Cancel','ghost',{onclick:closeOverlay}),
        btn('Use Selection ✓','primary',{onclick:()=>{
          state.studyScope = scopes.length ? scopes : [{type:'all',id:null}];
          closeOverlay();
          renderView('study');
        }})
      )
    );
  }

  function refreshAll(){ renderRecents(); renderBody(); renderFooter(); }
  refreshAll();
}

// ── "Hand-picked cards" refine mode: search + checklist over the current
// scope's cards, storing the exact set of card ids onto studyRefine. Each
// row shows how long ago that card was last studied, so picking by hand
// and picking by staleness can be combined (e.g. eyeball the list, sorted
// mentally by the 🕒 readout, then tick the ones you want). ──
function openCardPickerModal(scopedCards, refine) {
  const selected = new Set(refine.cardIds||[]);
  let search = '';
  openModal(`Pick Cards to Study (${scopedCards.length} in scope)`, body => {
    const searchInput = el('input',{type:'text',placeholder:'Search cards…',style:'padding:8px 12px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:var(--text);font-size:12px;font-family:inherit;outline:none;width:100%'});
    const countLabel = el('div',{style:'font-size:11px;color:var(--muted);font-weight:700;flex-shrink:0'},`${selected.size} selected`);
    const actionsRow = el('div',{style:'display:flex;gap:8px;align-items:center'},
      btn('All','ghost',{small:true,onclick:()=>{ filteredList().forEach(c=>selected.add(c.id)); renderList(); }}),
      btn('None','ghost',{small:true,onclick:()=>{ filteredList().forEach(c=>selected.delete(c.id)); renderList(); }}),
      countLabel
    );
    const listWrap = el('div',{style:'display:flex;flex-direction:column;gap:2px;max-height:340px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:6px'});
    body.append(searchInput, actionsRow, listWrap);

    function filteredList(){
      return !search ? scopedCards : scopedCards.filter(c=>cardSearchBlob(c).includes(search));
    }
    function renderList(){
      listWrap.innerHTML='';
      countLabel.textContent = `${selected.size} selected`;
      const list = filteredList();
      if(!list.length){ listWrap.appendChild(el('div',{style:'padding:12px;text-align:center;color:var(--muted);font-size:12px'},'No cards match.')); return; }
      list.forEach(card=>{
        const row = el('label',{style:'display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:12px'});
        const chk = el('input',{type:'checkbox',style:'width:15px;height:15px;accent-color:var(--blue);cursor:pointer;flex-shrink:0'});
        chk.checked = selected.has(card.id);
        chk.addEventListener('change',()=>{ if(chk.checked) selected.add(card.id); else selected.delete(card.id); countLabel.textContent = `${selected.size} selected`; });
        row.append(chk,
          el('div',{style:'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'}, formatCardFront(card)),
          el('span',{style:'font-size:10px;color:var(--muted);flex-shrink:0',title:fmtDateTime(card.lastRated)}, `🕒 ${timeAgo(card.lastRated)}`)
        );
        listWrap.appendChild(row);
      });
    }
    renderList();
    searchInput.addEventListener('input', e=>{ search=e.target.value.toLowerCase(); renderList(); });

    body.appendChild(btn('Use Selection ✓','primary',{full:true,onclick:()=>{
      refine.mode='cards';
      refine.cardIds=[...selected];
      scheduleSave();
      closeModal();
      renderView('study');
    }}));
  });
}

function startStudySession(scopes, mode) {
  const scopedCards = getScopeSetCards(scopes);
  let cards = applyStudyRefine(scopedCards, state.studyRefine);
  if(mode==='review'){
    cards=getDueCards(cards);
    const todayEntry=state.reviewHistory.find(r=>r.date===today());
    cards=applyNewCardCap(cards,state.settings.newCardsPerDay,todayEntry?.newSeen);
  }
  if(mode==='weakness') cards=cards.filter(c=>c.lapses>0||c.ease<2.3);
  // Fall back to the refined-but-otherwise-unfiltered set (not the whole
  // scope) — if the person picked "20 cards studied longest ago" they want
  // those 20 regardless of due status, not to silently lose the refinement.
  if(!cards.length) cards=applyStudyRefine(scopedCards, state.studyRefine);
  // 'calculation' and 'table' cards aren't blankable/flippable in a useful
  // way — a numeric answer or a data grid doesn't work as a plain front/back
  // flip, so they're only offered in the interactive modes (Written Quiz,
  // Fill in the Gaps) where they get their proper input-based renderer.
  if(mode!=='quiz' && mode!=='gaps'){
    cards = cards.filter(c=>c.type!=='calculation' && c.type!=='table');
  }
  if(mode==='multi') cards = cards.filter(c=>c.type==='basic');
  pushRecentScope(scopes);
  const timePerCard=state.settings.timedQuizSeconds||30;
  studySession={active:true,scope:scopes,mode,queue:[...cards].sort(()=>Math.random()-0.5),idx:0,flipped:false,showHint:false,showImages:state.settings.showStudyImages!==false,quizAnswer:'',quizAnswers:[],gapChoice:null,stats:{correct:0,incorrect:0,skipped:0},combo:0,maxCombo:0,startTime:Date.now(),matchMode:state.settings.quizMatchMode||'fuzzy',timePerCard,timeLeft:timePerCard,timedOut:false,timed:mode==='quiz'&&!!state.settings.quizTimed,
    // ── per-session stat accumulators (prefixed _ to distinguish from display fields) ──
    _cardStart: Date.now(),   // timestamp when current card was shown
    _firstCardMs: null,       // ms until first card was answered/rated
    _cardTimes: [],           // ms spent per card (question shown → rated)
    _flipTimes: [],           // flashcard: ms from question shown to flip (reveal)
    _keystrokes: 0,           // total keypresses in quiz/gap inputs
    _charsTyped: 0,           // net characters submitted (input.value.length at submit)
    _backspaces: 0,           // backspace/delete keypress count
    _timeouts: 0,             // timed-quiz cards that expired before submit
    _gap: mode==='gaps' ? {correct:0,close:0,wrong:0} : null,
  };
  renderView('study');
}


function renderStudySession(c) {
  const sess=studySession;
  clearQuizTimer();
  if(sess.idx>=sess.queue.length){ finishSession(); return; }
  const card=sess.queue[sess.idx];
  sess._cardStart = Date.now(); // reset per-card timer on every new card

  // Always rebuild from a clean slate — prevents stale flashcards/buttons (and
  // their still-attached click handlers, e.g. a old "Reveal" button) sticking
  // around underneath newly rendered content.
  c.innerHTML='';
  c.style.cssText='display:flex;flex-direction:column;height:100%;overflow:hidden;padding:0';

  const progress=el('div',{style:'display:flex;align-items:center;gap:12px;margin-bottom:20px'},
    btn('← Exit','ghost',{small:true,onclick:()=>{ clearQuizTimer(); if(window.speechSynthesis) window.speechSynthesis.cancel(); studySession=null; renderView('study'); }}),
    el('div',{style:'flex:1'},
      el('div',{style:'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px'},
        el('span',{style:'font-size:12px;font-weight:700;color:var(--muted)'},`${sess.idx+1} / ${sess.queue.length}`),
        sess.combo>=3?mkTag(`🔥 ${sess.combo}x`,'#FB923C'):null
      ),
      el('div',{class:'study-progress'},el('div',{class:'study-prog-fill',style:`width:${(sess.idx/sess.queue.length)*100}%`}))
    ),
    // A hint costs half the card's XP (see rateCard()) — greyed out entirely
    // when the card has no hint to show, so it's not a dead click.
    (() => {
      const hintBtn = btn(sess.showHint?'💡 Hint shown':'💡 Show Hint','ghost',{small:true,disabled:!card.hint,
        onclick:()=>{ sess.showHint=true; renderStudySession(document.getElementById('view-study')); }});
      if(card.hint) hintBtn.style.cssText='color:#22c55e;border-color:color-mix(in srgb, #22c55e 35%, transparent);background:color-mix(in srgb, #22c55e 10%, transparent)';
      return hintBtn;
    })()
  );

  const scrollArea=el('div',{class:'quiz-scroll-area'});
  scrollArea.appendChild(progress);
  const citBadge = card.citation ? el('div',{class:'citation-badge',onclick:()=>openCitationViewer(card.citation)},'📖 Source') : null;
  if(sess.showHint && card.hint) scrollArea.appendChild(setRichText(el('div',{class:'flashcard-hint',style:'margin-bottom:12px'}),`💡 ${card.hint}`));
  const {scrollContent,stickyFooter} = sess.mode==='quiz'
    ? renderQuizCard(card,citBadge,scrollArea)
    : sess.mode==='gaps'
    ? renderGapCard(card,citBadge)
    : sess.mode==='multi'
    ? renderMultiChoiceCard(card,citBadge)
    : renderFlashcard(card,citBadge);
  scrollArea.appendChild(scrollContent);
  c.append(scrollArea,stickyFooter);
}

// Multiple Choice mode ('basic' cards only, see the picker's gating and
// startStudySession()'s queue filter): shows the front, then 4 options — the
// real answer plus 3 distractors preferring the SAME deck as the question
// card, falling back to any other basic card in the study scope (sess.queue
// already IS "every basic card in scope", so that's the fallback pool).
function shuffleArr(arr) { return [...arr].sort(()=>Math.random()-0.5); }
function renderMultiChoiceCard(card, citBadge) {
  const sess=studySession;
  const qChildren=[el('div',{class:'flashcard-side-label'},'QUESTION'),el('div',{class:'flashcard-tags'},...(card.tags||[]).map(t=>mkTag(t)))];
  if(card.frontImage&&sess.showImages!==false)qChildren.push(el('img',{src:card.frontImage,style:'max-width:100%;max-height:160px;object-fit:contain;border-radius:8px;margin-bottom:10px'}));
  qChildren.push(setRichText(el('div',{class:'flashcard-front-text'}),formatCardFront(card)));
  const questionCard=el('div',{class:'flashcard front',style:'cursor:default'},...qChildren);

  const deck = state.decks.find(d=>d.cards.some(c=>c.id===card.id));
  const deckPool = (deck?.cards||[]).filter(c=>c.type==='basic'&&c.id!==card.id&&c.back!==card.back);
  const scopePool = sess.queue.filter(c=>c.id!==card.id&&c.back!==card.back);
  const distractors=[]; const seenBacks=new Set();
  [...shuffleArr(deckPool),...shuffleArr(scopePool)].forEach(c=>{
    if(distractors.length<3 && !seenBacks.has(c.back)){ seenBacks.add(c.back); distractors.push(c.back); }
  });
  const options = shuffleArr([{text:card.back,correct:true},...distractors.map(back=>({text:back,correct:false}))]);

  const optsWrap=el('div',{style:'display:flex;flex-direction:column;gap:8px;margin-top:16px'});
  let answered=false;
  const optBtns = options.map(opt=>{
    const b=el('button',{type:'button',class:'btn btn-ghost',style:'text-align:left;justify-content:flex-start;padding:12px 16px;font-size:14px;white-space:normal'});
    setRichText(b,opt.text);
    b.addEventListener('click',()=>{
      if(answered)return; answered=true;
      const cardMs=Date.now()-(sess._cardStart||Date.now());
      sess._cardTimes.push(cardMs);
      if(sess._firstCardMs===null) sess._firstCardMs=cardMs;
      optBtns.forEach((ob,i)=>{
        ob.disabled=true;
        if(options[i].correct) ob.style.cssText+=';border-color:#22c55e;background:rgba(34,197,94,0.12);color:#22c55e';
      });
      if(!opt.correct) b.style.cssText+=';border-color:#ef4444;background:rgba(239,68,68,0.12);color:#ef4444';
      if(sess._gap===null) sess._gap={correct:0,close:0,wrong:0};
      sess._gap[opt.correct?'correct':'wrong']++;
      setTimeout(()=>rateCard(opt.correct?4:1),450);
    });
    return b;
  });
  optBtns.forEach(b=>optsWrap.appendChild(b));

  const scrollContent=el('div',{style:'padding-bottom:8px'});
  scrollContent.append(questionCard,optsWrap);
  if(citBadge) scrollContent.appendChild(citBadge);
  const stickyFooter=el('div',{class:'quiz-sticky-footer'});
  return {scrollContent,stickyFooter};
}

function renderFlashcard(card, citBadge) {
  const sess=studySession;
  // Guard against the Reveal button (or its keyboard-triggered click) firing twice —
  // re-rendering replaces the button each time, but this keeps it safe either way.
  function reveal() {
    if(sess.flipped) return;
    // Record how long from card-shown to flip — a proxy for "thinking time".
    const flipMs = Date.now() - (sess._cardStart || Date.now());
    sess._flipTimes.push(flipMs);
    sess.flipped=true;
    renderStudySession(document.getElementById('view-study'));
  }

  // Text-to-Speech: read the card aloud once per side per card. Re-renders of the
  // *same* side (e.g. from an unrelated state change) shouldn't re-trigger speech,
  // so this is gated on a "have we already spoken this exact side of this exact
  // card" marker rather than just "are we flipped".
  if (state.settings.tts) {
    const ttsMarker = card.id + ':' + (sess.flipped ? 'back' : 'front');
    if (sess._ttsSpoken !== ttsMarker) {
      sess._ttsSpoken = ttsMarker;
      speakText(sess.flipped ? formatCardBack(card) : formatCardFront(card));
    }
  }

  const flashcard=el('div',{class:`flashcard ${sess.flipped?'back':'front'}`,onclick:()=>{ if(!sess.flipped) reveal(); }});
  flashcard.appendChild(el('div',{class:'flashcard-side-label'},sess.flipped?'ANSWER':'QUESTION'));
  const tagsEl=el('div',{class:'flashcard-tags'});
  (card.tags||[]).forEach(t=>tagsEl.appendChild(mkTag(t)));
  flashcard.appendChild(tagsEl);

  if(!sess.flipped){
    if(card.frontImage&&sess.showImages!==false)flashcard.appendChild(el('img',{src:card.frontImage,style:'max-width:100%;max-height:160px;object-fit:contain;border-radius:8px;margin-bottom:10px'}));
    flashcard.appendChild(setRichText(el('div',{class:'flashcard-front-text'}),formatCardFront(card)));
    if(!sess.showHint) flashcard.appendChild(el('div',{class:'flashcard-tap'},'Click to reveal'));
  } else {
    if(card.backImage&&sess.showImages!==false)flashcard.appendChild(el('img',{src:card.backImage,style:'max-width:100%;max-height:160px;object-fit:contain;border-radius:8px;margin-bottom:10px'}));
    if(card.type==='markscheme'){
      const marks=Math.min(Math.max(card.answerCount||1,1),Math.max(1,card.requiredAnswers||card.answerCount||1));
      flashcard.appendChild(el('div',{style:'font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px'},`Mark scheme · ${marks} mark${marks===1?'':'s'}`));
      flashcard.appendChild(el('ul',{style:'text-align:left;margin:0 auto;max-width:340px;padding-left:22px;line-height:1.7'},
        ...getCardAnswers(card).map(pt=>setRichText(el('li',{class:'flashcard-back-text',style:'font-size:15px'}),pt))
      ));
    } else if(card.type==='process'){
      const marks=Math.min(Math.max(card.answerCount||1,1),Math.max(1,card.requiredAnswers||card.answerCount||1));
      flashcard.appendChild(el('div',{style:'font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px'},`Process · ${marks} mark${marks===1?'':'s'}`));
      const steps=getCardAnswers(card);
      flashcard.appendChild(el('ol',{style:'text-align:left;margin:0 auto;max-width:340px;padding-left:22px;line-height:1.9'},
        ...steps.map((s,i)=>el('li',{class:'flashcard-back-text',style:'font-size:15px'},setRichText(el('span'),s),i<steps.length-1?el('span',{style:'color:var(--muted);margin-left:6px'},'→'):null))
      ));
    } else if(card.type==='calculation'){
      const marks=1+Math.max(0,card.methodRequired||0);
      flashcard.appendChild(el('div',{style:'font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px'},`Calculation · ${marks} mark${marks===1?'':'s'}`));
      flashcard.appendChild(setRichText(el('div',{class:'flashcard-back-text',style:'font-size:20px;font-weight:800'}),`${card.back}${card.calcUnit?` ${card.calcUnit}`:''}`));
      if((card.methodPool||[]).length){
        flashcard.appendChild(el('div',{style:'font-size:10px;color:var(--muted);margin:10px 0 4px;text-transform:uppercase;letter-spacing:0.05em'},'Method marks:'));
        flashcard.appendChild(el('ul',{style:'text-align:left;margin:0 auto;max-width:340px;padding-left:22px;line-height:1.6'},
          ...card.methodPool.map(pt=>setRichText(el('li',{style:'font-size:13px'}),pt))
        ));
      }
    } else {
      flashcard.appendChild(setRichText(el('div',{class:'flashcard-back-text'}),formatCardBack(card)));
    }
    if(citBadge) flashcard.appendChild(citBadge);
  }

  // Sticky footer (matches written-quiz mode) keeps controls fixed below the
  // scrollable card instead of flowing inline, and is fully rebuilt on every
  // render so a used "Reveal" button can never linger and be pressed again.
  let stickyFooter;
  if(!sess.flipped){
    stickyFooter=el('div',{class:'quiz-sticky-footer',style:'flex-direction:row;justify-content:center'},
      btn('Reveal →','primary',{onclick:reveal}),
      btn('Skip','ghost',{onclick:()=>{ sess.stats.skipped++; sess._cardTimes.push(Date.now()-(sess._cardStart||Date.now())); nextCard(); }})
    );
  } else {
    const ratingGrid=el('div',{class:'rating-grid'});
    // Preview labels used to be hardcoded/approximate guesses ('<1 min', '~1 day',
    // card.interval, card.interval*2) that didn't match what scheduleCard() actually
    // does — e.g. Again always reschedules 1 full day out, never "<1 min" (there's no
    // short-term relearning-steps queue in this algorithm). Call the real scheduler
    // with the same opts rateCard() uses so the preview can never drift from reality,
    // for either algorithm (FSRS or SM-2).
    const schedOpts={algorithm:state.settings.algorithm,leechThreshold:state.settings.leechThreshold,autoSuspend:state.settings.autoSuspend};
    const previewDays=rating=>scheduleCard(card,rating,schedOpts).interval;
    [{label:'Again',rating:1,color:'#ef4444'},{label:'Hard',rating:2,color:'#FB923C'},
     {label:'Good',rating:3,color:'var(--blue)'},{label:'Easy',rating:4,color:'#22c55e'}
    ].forEach(rb=>{
      rb.sub=fmtIntervalPreview(previewDays(rb.rating));
      ratingGrid.appendChild(el('button',{class:'rating-btn',style:`background:color-mix(in srgb, ${rb.color} 8%, transparent);color:${rb.color};border:1px solid color-mix(in srgb, ${rb.color} 27%, transparent)`,onclick:()=>rateCard(rb.rating)},
        rb.label,el('span',{class:'rating-sub',style:`color:color-mix(in srgb, ${rb.color} 60%, transparent)`},rb.sub)));
    });
    stickyFooter=el('div',{class:'quiz-sticky-footer'},el('div',{style:'text-align:center;font-size:12px;color:var(--muted);font-weight:600'},'How well did you know this?'),ratingGrid);
  }
  return {scrollContent:flashcard, stickyFooter};
}

// Formats a scheduler-predicted interval (in whole days — scheduleCard never
// returns less than 1) for the rating-button preview. Mature cards can climb
// into the hundreds/thousands of days (ease compounds up to 3.5x per review),
// so scale the unit rather than printing e.g. "~1247d".
function fmtIntervalPreview(days) {
  if (days === 1) return '~1 day';
  if (days < 30) return `~${days}d`;
  if (days < 365) return `~${Math.round(days / 30)}mo`;
  return `~${(days / 365).toFixed(1)}y`;
}

// Stopwords excluded when picking a word to blank — without this, short filler
// words ("the", "of", "is"...) would frequently get chosen, making the blank
// trivial to guess from context alone rather than testing actual recall.
const GAP_STOPWORDS = new Set(['the','a','an','and','or','but','of','in','on','at','to','for','is','are','was',
  'were','be','been','being','with','as','by','it','its','this','that','these','those','from','into','onto',
  'than','then','so','if','not','no','can','will','would','could','should','may','might','also','which','who',
  'whom','whose','what','when','where','why','how','there','here','their','they','them','you','your','our','we']);

/**
 * Finds the words in `text` worth blanking for Fill in the Gaps, ranked longest
 * first. Prefers non-stopword tokens >=4 chars (longer words tend to be a
 * sentence's most specific/testable term, e.g. "mitochondria" over "is"/"the"/
 * "cell"); falls back to any token >=3 chars if every word is a stopword or too
 * short (e.g. a very short answer like "42" or "yes"). Returns the top two
 * candidates within 2 characters of the longest — in practice most sentences
 * only have one or two words worth blanking anyway — for pickGapWord to choose
 * between, so the same card doesn't always blank the exact same word.
 */
function pickGapCandidates(text) {
  if (!text) return [];
  const tokens = [...text.matchAll(/[A-Za-z0-9]+/g)];
  const candidates = tokens.filter(m => m[0].length >= 4 && !GAP_STOPWORDS.has(m[0].toLowerCase()));
  const pool = candidates.length ? candidates : tokens.filter(m => m[0].length >= 3);
  if (!pool.length) return [];
  const sorted = [...pool].sort((a, b) => b[0].length - a[0].length);
  const maxLen = sorted[0][0].length;
  return sorted.filter(m => m[0].length >= maxLen - 2).slice(0, 2);
}

/**
 * Randomly picks one of pickGapCandidates()'s 1-2 viable words to blank. Not
 * deterministic by design — seeing the same card again should be able to blank
 * a different word than last time. Returns null if `text` has nothing usable,
 * in which case the caller should fall back to a different render. Callers that
 * re-render mid-attempt (e.g. a window resize) must cache the result themselves
 * rather than calling this again, or the blank would jump to a different word
 * out from under a half-typed answer — see renderGapCard's sess.gapChoice cache.
 */
function pickGapWord(text) {
  const candidates = pickGapCandidates(text);
  if (!candidates.length) return null;
  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  return { word: chosen[0], start: chosen.index, end: chosen.index + chosen[0].length };
}

// Fill in the Gaps: shows the front prompt plus the back answer with its single
// most significant word blanked out, and asks for just that word — a lighter
// recall task than Written Quiz's "type the whole answer". Falls back to a plain
// flashcard for cards whose back text has no word worth blanking (e.g. very short
// or numeric answers), rather than presenting a degenerate/trivial gap.
function renderGapCard(card, citBadge) {
  const sess=studySession;
  // Process cards get one random step blanked (context intact, unlike a
  // word yanked out of running text) — see renderProcessGapCard(). Calc and
  // table cards reuse their Written Quiz renderers verbatim: a calculation
  // has nothing "blankable" about it other than the answer itself (it's
  // already just one input), and a table's blanks already come from one of
  // its authored combinations, which is exactly what a gap-fill should do.
  if(card.type==='process') return renderProcessGapCard(card, citBadge);
  if(card.type==='calculation') return renderCalcQuizCard(card, citBadge);
  if(card.type==='table') return renderTableQuizCard(card, citBadge);
  // Multi-answer cards (card.answerCount > 1) don't get a word blanked out of
  // running text — instead one whole answer is *removed* from the list and the
  // rest are shown as given context, and the user fills in just the removed one.
  // A card whose answerCount says >1 but only has one real answer line (bad/edited
  // data) falls back to the classic word-blank flow below.
  const answerCount = Math.min(8, Math.max(1, card.answerCount || 1));
  const multiAnswers = answerCount > 1 ? getCardAnswers(card) : null;
  const isMulti = multiAnswers && multiAnswers.length > 1;

  if(!sess.gapChoice||sess.gapChoice.cardId!==card.id){
    sess.gapChoice = isMulti
      ? {cardId:card.id, removedIndex: Math.floor(Math.random()*multiAnswers.length)}
      : {cardId:card.id, gap: pickGapWord(card.back||'')};
  }

  // answerToCheck: the single value the input is matched against.
  // contextText: what's shown in place of the old "blanked" sentence — for
  // multi-answer cards, the other answers plus a fixed-width blank standing in
  // for the removed one (so its length isn't leaked, same rationale as before).
  const isMarkscheme = card.type === 'markscheme';
  let answerToCheck, contextLabel, contextText, fullAnswerText;
  if(isMulti){
    const removedIndex = sess.gapChoice.removedIndex;
    answerToCheck = multiAnswers[removedIndex];
    contextLabel = isMarkscheme ? 'Other marking points:' : 'Other answers:';
    contextText = [...multiAnswers.filter((_,i)=>i!==removedIndex), '▁▁▁▁▁▁▁'].join(', ');
    fullAnswerText = multiAnswers.join(', ');
  } else {
    const gap = sess.gapChoice.gap;
    if(!gap) return renderFlashcard(card, citBadge);
    answerToCheck = gap.word;
    contextLabel = 'Complete the answer:';
    // Fixed-width blank rather than one sized to the missing word, so the blank
    // itself doesn't leak the answer's length.
    contextText = card.back.slice(0,gap.start)+'▁▁▁▁▁▁▁'+card.back.slice(gap.end);
    fullAnswerText = card.back;
  }

  const qChildren=[el('div',{class:'flashcard-side-label'},'FILL IN THE GAP'),el('div',{class:'flashcard-tags'},...(card.tags||[]).map(t=>mkTag(t)))];
  if(card.frontImage&&sess.showImages!==false)qChildren.push(el('img',{src:card.frontImage,style:'max-width:100%;max-height:140px;object-fit:contain;border-radius:8px;margin-bottom:8px'}));
  qChildren.push(setRichText(el('div',{class:'flashcard-front-text',style:'font-size:18px'}),formatCardFront(card)));
  qChildren.push(el('div',{style:'font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-top:10px'},contextLabel));
  qChildren.push(el('div',{class:'flashcard-back-text',style:'font-size:15px'},contextText));
  const questionCard=el('div',{class:'flashcard front',style:'cursor:default;min-height:160px'},...qChildren);

  const inputArea=el('input',{type:'text',class:'quiz-input-area',style:'min-height:unset',placeholder: isMulti?(isMarkscheme?'Type the missing marking point…':'Type the missing answer…'):'Type the missing word…'});
  inputArea.value=sess.quizAnswer||'';
  inputArea.addEventListener('input',e=>{ sess.quizAnswer=e.target.value; });
  inputArea.addEventListener('keydown',e=>{
    sess._keystrokes++;
    if(e.key==='Backspace'||e.key==='Delete') sess._backspaces++;
  });

  const compareEl=el('div',{style:'display:none'});
  let checked=false;
  const checkBtn=btn('Check Answer (↵)','primary',{full:true,onclick:checkGapAnswer});
  const stickyFooter=el('div',{class:'quiz-sticky-footer'});
  stickyFooter.append(inputArea,checkBtn);

  function checkGapAnswer(){
    if(checked)return; checked=true;
    const cardMs = Date.now() - (sess._cardStart || Date.now());
    sess._cardTimes.push(cardMs);
    if (sess._firstCardMs === null) sess._firstCardMs = cardMs;
    sess._charsTyped += sess.quizAnswer.trim().length;
    const userAnswer=sess.quizAnswer.trim();
    const result=userAnswer?quizMatch(userAnswer,answerToCheck):'wrong';
    if(sess._gap) sess._gap[result==='correct'?'correct':result==='close'?'close':'wrong']++;
    compareEl.style.display=''; compareEl.className=`quiz-compare ${result}`; compareEl.innerHTML='';
    const emoji=result==='correct'?'✅':result==='close'?'🟡':'❌';
    const label=result==='correct'?'Correct!':result==='close'?'Close — review below':'Incorrect';
    compareEl.append(
      el('div',{class:`quiz-label ${result}`},`${emoji} ${label}`),
      el('div',{style:'font-size:10px;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em'},isMulti?(isMarkscheme?'Missing marking point:':'Missing answer:'):'Missing word:'),
      setRichText(el('div',{class:'quiz-answer-text'}),answerToCheck),
      setRichText(el('div',{style:'font-size:12px;color:var(--muted);margin-top:8px'}),fullAnswerText)
    );
    if(citBadge) compareEl.appendChild(citBadge);
    const rateRow=el('div',{class:'quiz-self-rate'});
    [{label:'✅ Got it',rating:4,color:'#22c55e'},{label:'🟡 Close',rating:2,color:'#FB923C'},{label:'❌ Wrong',rating:1,color:'#ef4444'}].forEach(rb=>{
      rateRow.appendChild(el('button',{class:'btn btn-sm',style:`background:color-mix(in srgb, ${rb.color} 8%, transparent);color:${rb.color};border:1px solid color-mix(in srgb, ${rb.color} 20%, transparent)`,onclick:()=>rateCard(rb.rating)},rb.label));
    });
    stickyFooter.appendChild(rateRow);
    if(result==='correct') setTimeout(()=>rateCard(4),50);
    inputArea.disabled=true; checkBtn.style.display='none';
  }
  inputArea.addEventListener('keydown',e=>{ if(e.key==='Enter') checkGapAnswer(); });

  const scrollContent=el('div',{style:'padding-bottom:8px'});
  scrollContent.append(questionCard,compareEl);
  setTimeout(()=>inputArea.focus(),50);
  return {scrollContent,stickyFooter};
}

// Written Quiz for 'process' cards: one input box per step, IN ORDER (unlike
// isMulti's pool, position matters — box i is checked against step i, not the
// whole pool). Auto-graded via processStepMatch (keyword-or-synonym spotting,
// same tolerance as markschemeMatch), but a process/causal-chain step is
// often expressible many ways a fixed keyword+synonym list won't anticipate —
// so a Skip button bails straight to the fully-formed correct answer, and
// even after a normal Check, the self-rate buttons (Got it/Close/Wrong,
// exactly like every other mode) are always offered rather than trusting the
// automatic mark alone.
// Fill in the Gaps for 'process' cards: unlike a word blanked out of running
// text, a process is an ORDERED chain where "what comes next" is the point —
// so rather than hiding the whole thing, one random step is blanked and the
// rest of the ordered list stays visible as context, and the learner only
// has to recall the missing link.
function renderProcessGapCard(card, citBadge) {
  const sess=studySession;
  const steps = getCardAnswers(card);
  const synonymsList = card.synonyms || [];
  if(steps.length < 2) return renderFlashcard(card, citBadge); // nothing to hide with context intact

  if(!sess.gapChoice||sess.gapChoice.cardId!==card.id){
    sess.gapChoice = {cardId:card.id, removedIndex: Math.floor(Math.random()*steps.length)};
  }
  const removedIndex = sess.gapChoice.removedIndex;

  const qChildren=[el('div',{class:'flashcard-side-label'},'FILL IN THE GAP'),el('div',{class:'flashcard-tags'},...(card.tags||[]).map(t=>mkTag(t)))];
  if(card.frontImage&&sess.showImages!==false)qChildren.push(el('img',{src:card.frontImage,style:'max-width:100%;max-height:140px;object-fit:contain;border-radius:8px;margin-bottom:8px'}));
  qChildren.push(setRichText(el('div',{class:'flashcard-front-text',style:'font-size:18px'}),formatCardFront(card)));
  qChildren.push(el('div',{style:'font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-top:10px'},`Step ${removedIndex+1} is missing:`));
  qChildren.push(el('ol',{style:'text-align:left;margin:8px auto 0;max-width:380px;padding-left:22px;line-height:1.8;font-size:14px'},
    ...steps.map((s,i)=>i===removedIndex?el('li',{style:'color:var(--muted);font-style:italic'},'▁▁▁▁▁▁▁'):el('li',{},s))
  ));
  const questionCard=el('div',{class:'flashcard front',style:'cursor:default;min-height:160px'},...qChildren);

  const inputArea=el('input',{type:'text',class:'quiz-input-area',style:'min-height:unset',placeholder:`Step ${removedIndex+1}…`});
  inputArea.value=sess.quizAnswer||'';
  inputArea.addEventListener('input',e=>{ sess.quizAnswer=e.target.value; });
  inputArea.addEventListener('keydown',e=>{ sess._keystrokes++; if(e.key==='Backspace'||e.key==='Delete') sess._backspaces++; });

  const compareEl=el('div',{style:'display:none'});
  let checked=false;
  const checkBtn=btn('Check Answer (↵)','primary',{full:true,onclick:checkStep});
  const stickyFooter=el('div',{class:'quiz-sticky-footer'});
  stickyFooter.append(inputArea,checkBtn);

  function checkStep(){
    if(checked)return; checked=true;
    const cardMs = Date.now() - (sess._cardStart || Date.now());
    sess._cardTimes.push(cardMs);
    if (sess._firstCardMs === null) sess._firstCardMs = cardMs;
    const userAnswer=sess.quizAnswer.trim();
    sess._charsTyped += userAnswer.length;
    const exact = sess.matchMode==='exact';
    const result = userAnswer ? (processStepMatch(userAnswer, steps[removedIndex], synonymsList[removedIndex], exact) ? 'correct' : 'wrong') : 'wrong';
    if(sess._gap) sess._gap[result==='correct'?'correct':'wrong']++;

    compareEl.style.display=''; compareEl.className=`quiz-compare ${result}`; compareEl.innerHTML='';
    const emoji=result==='correct'?'✅':'❌';
    const label=result==='correct'?'Correct!':'Incorrect';
    compareEl.append(
      el('div',{class:`quiz-label ${result}`},`${emoji} ${label}`),
      el('div',{style:'font-size:10px;color:var(--muted);margin:8px 0 6px;text-transform:uppercase;letter-spacing:0.05em'},'Full process:'),
      el('ol',{style:'text-align:left;margin:0 auto;max-width:380px;padding-left:22px;line-height:1.8;font-size:13px'},
        ...steps.map((s,i)=>setRichText(el('li',{style:`color:${i===removedIndex?(result==='correct'?'#22c55e':'#ef4444'):'var(--text)'}`}),s))
      ),
    );
    if(citBadge) compareEl.appendChild(citBadge);
    const rateRow=el('div',{class:'quiz-self-rate'});
    [{label:'✅ Got it',rating:4,color:'#22c55e'},{label:'🟡 Close',rating:2,color:'#FB923C'},{label:'❌ Wrong',rating:1,color:'#ef4444'}].forEach(rb=>{
      rateRow.appendChild(el('button',{class:'btn btn-sm',style:`background:color-mix(in srgb, ${rb.color} 8%, transparent);color:${rb.color};border:1px solid color-mix(in srgb, ${rb.color} 20%, transparent)`,onclick:()=>rateCard(rb.rating)},rb.label));
    });
    stickyFooter.appendChild(rateRow);
    if(result==='correct') setTimeout(()=>rateCard(4),50);
    inputArea.disabled=true; checkBtn.style.display='none';
  }
  inputArea.addEventListener('keydown',e=>{ if(e.key==='Enter') checkStep(); });

  const scrollContent=el('div',{style:'padding-bottom:8px'});
  scrollContent.append(questionCard,compareEl);
  setTimeout(()=>inputArea.focus(),50);
  return {scrollContent,stickyFooter};
}

function renderProcessQuizCard(card, citBadge) {
  const sess=studySession;
  const steps = getCardAnswers(card);
  const synonymsList = card.synonyms || [];
  const requiredAnswers = Math.min(steps.length, Math.max(1, card.requiredAnswers || steps.length));

  const qChildren=[el('div',{class:'flashcard-side-label'},'QUESTION'),el('div',{class:'flashcard-tags'},...(card.tags||[]).map(t=>mkTag(t)))];
  if(card.frontImage&&sess.showImages!==false)qChildren.push(el('img',{src:card.frontImage,style:'max-width:100%;max-height:140px;object-fit:contain;border-radius:8px;margin-bottom:8px'}));
  qChildren.push(setRichText(el('div',{class:'flashcard-front-text',style:'font-size:18px'}),formatCardFront(card)));
  qChildren.push(el('div',{style:'font-size:12px;color:var(--muted);margin-top:8px'},`Fill in the ${steps.length}-step process, in order.`));
  const questionCard=el('div',{class:'flashcard front',style:'cursor:default;min-height:160px'},...qChildren);

  const inputWrap=el('div',{});
  const boxes=[];
  const onKeystroke=e=>{ sess._keystrokes++; if(e.key==='Backspace'||e.key==='Delete') sess._backspaces++; };
  steps.forEach((_,i)=>{
    const box=el('input',{type:'text',class:'quiz-input-area',style:'min-height:unset;margin-bottom:8px',placeholder:`Step ${i+1}…`});
    box.value=sess.quizAnswers?.[i]||'';
    box.addEventListener('input',e=>{ sess.quizAnswers[i]=e.target.value; });
    box.addEventListener('keydown',onKeystroke);
    inputWrap.appendChild(box);
    boxes.push(box);
  });

  const compareEl=el('div',{style:'display:none'});
  let checked=false;
  const checkBtn=btn('Check Answer (Ctrl+↵)','primary',{full:true,onclick:()=>finish(false)});
  const skipBtn=btn('Skip →','ghost',{onclick:()=>finish(true)});

  function finish(skipped){
    if(checked)return; checked=true;
    const cardMs = Date.now() - (sess._cardStart || Date.now());
    sess._cardTimes.push(cardMs);
    if (sess._firstCardMs === null) sess._firstCardMs = cardMs;
    const exact = sess.matchMode==='exact';
    const userAnswers = boxes.map(b=>b.value.trim());
    userAnswers.forEach(a=>{ sess._charsTyped += a.length; });
    const hits = skipped ? steps.map(()=>false) : userAnswers.map((a,i)=> !!a && processStepMatch(a, steps[i], synonymsList[i], exact));
    const hitCount = hits.filter(Boolean).length;
    const marksAwarded = Math.min(hitCount, requiredAnswers);
    const result = skipped ? 'wrong' : marksAwarded===requiredAnswers ? 'correct' : marksAwarded>0 ? 'close' : 'wrong';

    compareEl.style.display=''; compareEl.className=`quiz-compare ${result}`; compareEl.innerHTML='';
    const emoji=skipped?'⏭️':result==='correct'?'✅':result==='close'?'🟡':'❌';
    const label=skipped?'Skipped — here\'s the full process':result==='correct'?'Correct!':result==='close'?'Close — review below':'Incorrect';
    compareEl.append(
      el('div',{class:`quiz-label ${result}`},`${emoji} ${label}`),
      skipped?null:el('div',{style:'font-size:10px;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em'},`${marksAwarded} / ${requiredAnswers} marks`),
      (card.backImage&&sess.showImages!==false)?el('img',{src:card.backImage,style:'max-width:100%;max-height:120px;object-fit:contain;border-radius:8px;margin-bottom:8px'}):null,
      el('div',{style:'font-size:10px;color:var(--muted);margin:8px 0 6px;text-transform:uppercase;letter-spacing:0.05em'},'Full process:'),
      el('ol',{style:'text-align:left;margin:0;padding-left:20px;line-height:1.8;font-size:13px'},
        ...steps.map((s,i)=>el('li',{style:`color:${skipped?'var(--text)':hits[i]?'#22c55e':'var(--text)'}`},skipped?'':hits[i]?'✅ ':'⬜ ',setRichText(el('span'),s)))
      ),
      el('div',{style:'font-size:11px;color:var(--muted);margin-top:8px;font-style:italic'},'Keyword matching can be too strict for a causal chain — self-rate honestly against the full process above.')
    );
    if(citBadge) compareEl.appendChild(citBadge);
    const rateRow=el('div',{class:'quiz-self-rate'});
    [{label:'✅ Got it',rating:4,color:'#22c55e'},{label:'🟡 Close',rating:2,color:'#FB923C'},{label:'❌ Wrong',rating:1,color:'#ef4444'}].forEach(rb=>{
      rateRow.appendChild(el('button',{class:'btn btn-sm',style:`background:color-mix(in srgb, ${rb.color} 8%, transparent);color:${rb.color};border:1px solid color-mix(in srgb, ${rb.color} 20%, transparent)`,onclick:()=>rateCard(rb.rating)},rb.label));
    });
    stickyFooter.appendChild(rateRow);
    boxes.forEach(b=>b.disabled=true); checkBtn.style.display='none'; skipBtn.style.display='none';
  }
  boxes.forEach(box=>box.addEventListener('keydown',e=>{ if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)) finish(false); }));

  const scrollContent=el('div',{style:'padding-bottom:8px'});
  scrollContent.append(questionCard,compareEl);
  const stickyFooter=el('div',{class:'quiz-sticky-footer'});
  stickyFooter.append(inputWrap,el('div',{style:'display:flex;gap:8px'},checkBtn,skipBtn));
  setTimeout(()=>boxes[0]?.focus(),50);
  return {scrollContent,stickyFooter};
}

// Written Quiz for 'calculation' cards: a numeric comparator (calcMatch, see
// dashboard-core.js) instead of quizMatch/markschemeMatch — the only mode
// that grades by value rather than text similarity. If the card has method
// marks (`methodPool`), an optional "show your working" box is scored the
// exact same way markscheme's pool is (keyword spotting via markschemeMatch),
// so the final tally is "1 mark for the right value + N method marks".
function renderCalcQuizCard(card, citBadge) {
  const sess=studySession;
  const methodRequired = Math.min((card.methodPool||[]).length, Math.max(0, card.methodRequired||0));
  const totalMarks = 1 + methodRequired;

  const qChildren=[el('div',{class:'flashcard-side-label'},'QUESTION'),el('div',{class:'flashcard-tags'},...(card.tags||[]).map(t=>mkTag(t)))];
  if(card.frontImage&&sess.showImages!==false)qChildren.push(el('img',{src:card.frontImage,style:'max-width:100%;max-height:140px;object-fit:contain;border-radius:8px;margin-bottom:8px'}));
  qChildren.push(setRichText(el('div',{class:'flashcard-front-text',style:'font-size:18px'}),formatCardFront(card)));
  const questionCard=el('div',{class:'flashcard front',style:'cursor:default;min-height:160px'},...qChildren);

  const answerInput=el('input',{type:'text',class:'quiz-input-area',style:'min-height:unset',placeholder:card.calcUnit?`Your answer… (e.g. 12.5 ${card.calcUnit})`:'Your answer… (e.g. 12.5, 1/2, 50%)'});
  answerInput.value=sess.quizAnswer||'';
  const onKeystroke=e=>{ sess._keystrokes++; if(e.key==='Backspace'||e.key==='Delete') sess._backspaces++; };
  answerInput.addEventListener('input',e=>{ sess.quizAnswer=e.target.value; });
  answerInput.addEventListener('keydown',onKeystroke);

  const inputWrap=el('div',{},answerInput);
  let workingInput=null;
  if((card.methodPool||[]).length){
    inputWrap.appendChild(el('div',{style:'font-size:11px;color:var(--muted);margin:8px 0 4px'},`Show your working (optional — ${methodRequired} method mark${methodRequired===1?'':'s'} available):`));
    workingInput=el('textarea',{class:'quiz-input-area',style:'min-height:70px',placeholder:'Your working…'});
    workingInput.addEventListener('keydown',onKeystroke);
    inputWrap.appendChild(workingInput);
  }

  const compareEl=el('div',{style:'display:none'});
  let checked=false;
  const checkBtn=btn('Check Answer (Ctrl+↵)','primary',{full:true,onclick:checkCalcAnswer});

  function checkCalcAnswer(){
    if(checked)return; checked=true;
    const cardMs = Date.now() - (sess._cardStart || Date.now());
    sess._cardTimes.push(cardMs);
    if (sess._firstCardMs === null) sess._firstCardMs = cardMs;
    const userVal = answerInput.value.trim();
    sess._charsTyped += userVal.length;
    const finalResult = userVal ? calcMatch(userVal, card) : 'wrong';
    const finalMark = finalResult==='correct' ? 1 : 0;

    let methodHits=[], methodMark=0, workingText='';
    if(workingInput){
      workingText = workingInput.value.trim();
      sess._charsTyped += workingText.length;
      if(finalResult==='correct'){
        // Getting the final value right is itself evidence the method was
        // sound — don't make the learner separately retype working that
        // keyword-matches the mark scheme just to collect marks they've
        // already demonstrated.
        methodHits = card.methodPool.map(()=>true);
        methodMark = methodRequired;
      } else {
        methodHits = workingText ? card.methodPool.map(k=>markschemeMatch(workingText,k,false)) : card.methodPool.map(()=>false);
        methodMark = Math.min(methodHits.filter(Boolean).length, methodRequired);
      }
    }
    const totalAwarded = finalMark + methodMark;
    const result = totalAwarded===totalMarks ? 'correct' : totalAwarded>0 ? 'close' : 'wrong';

    compareEl.style.display=''; compareEl.className=`quiz-compare ${result}`; compareEl.innerHTML='';
    const emoji=result==='correct'?'✅':result==='close'?'🟡':'❌';
    const label=result==='correct'?'Correct!':result==='close'?'Close — review below':'Incorrect';
    const finalNote = finalResult==='close'
      ? el('div',{style:'font-size:11px;color:#FB923C;margin-bottom:6px'},'Right number, but the unit was missing or wrong.')
      : null;
    compareEl.append(
      el('div',{class:`quiz-label ${result}`},`${emoji} ${label}`),
      el('div',{style:'font-size:10px;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em'},`${totalAwarded} / ${totalMarks} marks`),
      finalNote,
      (card.backImage&&sess.showImages!==false)?el('img',{src:card.backImage,style:'max-width:100%;max-height:120px;object-fit:contain;border-radius:8px;margin-bottom:8px'}):null,
      el('div',{style:'font-size:10px;color:var(--muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em'},'Correct answer:'),
      el('div',{class:'quiz-answer-text'},`${card.back}${card.calcUnit?` ${card.calcUnit}`:''}`),
      workingInput?el('div',{style:'font-size:10px;color:var(--muted);margin:10px 0 6px;text-transform:uppercase;letter-spacing:0.05em'},'Method marks:'):null,
      workingInput?el('ul',{style:'text-align:left;margin:0;padding-left:20px;line-height:1.7;font-size:13px'},
        ...card.methodPool.map((k,i)=>el('li',{style:`color:${methodHits[i]?'#22c55e':'var(--text)'}`},`${methodHits[i]?'✅ ':'⬜ '}${k}`))
      ):null
    );
    if(citBadge) compareEl.appendChild(citBadge);
    const rateRow=el('div',{class:'quiz-self-rate'});
    [{label:'✅ Got it',rating:4,color:'#22c55e'},{label:'🟡 Close',rating:2,color:'#FB923C'},{label:'❌ Wrong',rating:1,color:'#ef4444'}].forEach(rb=>{
      rateRow.appendChild(el('button',{class:'btn btn-sm',style:`background:color-mix(in srgb, ${rb.color} 8%, transparent);color:${rb.color};border:1px solid color-mix(in srgb, ${rb.color} 20%, transparent)`,onclick:()=>rateCard(rb.rating)},rb.label));
    });
    stickyFooter.appendChild(rateRow);
    if(result==='correct') setTimeout(()=>rateCard(4),50);
    answerInput.disabled=true; if(workingInput) workingInput.disabled=true; checkBtn.style.display='none';
  }
  answerInput.addEventListener('keydown',e=>{ if(e.key==='Enter') checkCalcAnswer(); });

  const scrollContent=el('div',{style:'padding-bottom:8px'});
  scrollContent.append(questionCard,compareEl);
  const stickyFooter=el('div',{class:'quiz-sticky-footer'});
  stickyFooter.append(inputWrap,checkBtn);
  setTimeout(()=>answerInput.focus(),50);
  return {scrollContent,stickyFooter};
}

// Written Quiz for 'table' cards: a 2D grid with grouped/spanning column
// headers (e.g. "v (m/s)" spanning a "Before"/"After" sub-header pair, like
// an exam data table) where some cells are given and the rest — the card's
// getTableBlanks() list — are inputs the learner fills in. Each blank is
// graded independently with tableCellMatch (same numeric comparator
// calculation cards use), and the tally becomes "N / total marks", exactly
// like renderCalcQuizCard's finalMark+methodMark pattern.
function renderTableQuizCard(card, citBadge) {
  const sess = studySession;
  const cols = card?.tableData?.columns || [];
  const rows = card?.tableData?.rows || [];
  const combo = pickTableCombination(card);
  const blanks = getTableBlanks(card, combo);
  const totalMarks = Math.max(1, blanks.length);

  const qChildren=[el('div',{class:'flashcard-side-label'},'QUESTION'),el('div',{class:'flashcard-tags'},...(card.tags||[]).map(t=>mkTag(t)))];
  if(card.frontImage&&sess.showImages!==false)qChildren.push(el('img',{src:card.frontImage,style:'max-width:100%;max-height:140px;object-fit:contain;border-radius:8px;margin-bottom:8px'}));
  qChildren.push(setRichText(el('div',{class:'flashcard-front-text',style:'font-size:16px'}),formatCardFront(card)));

  // Build a small header-span plan: consecutive columns sharing the same
  // non-null `group` merge into one top-row <th colspan>; a column with no
  // group spans both header rows on its own (rowspan=2), matching how a
  // printed data table groups "Before/After" under one "v (m/s)" heading.
  const spans=[]; // top row cells: {label, colspan, rowspan, isGroup}
  for(let i=0;i<cols.length;i++){
    const c=cols[i];
    if(c.group){
      if(spans.length && spans[spans.length-1].isGroup && spans[spans.length-1].label===c.group){ spans[spans.length-1].colspan++; }
      else spans.push({label:c.group, colspan:1, rowspan:1, isGroup:true});
    } else {
      spans.push({label:c.label, colspan:1, rowspan:2, isGroup:false});
    }
  }
  const thStyle='border:1px solid rgba(255,255,255,0.12);padding:6px 8px;font-size:12px;font-weight:700;color:var(--text);background:rgba(255,255,255,0.04);text-align:center';
  const tdStyle='border:1px solid rgba(255,255,255,0.1);padding:4px 6px;font-size:13px;text-align:center';
  const headRow1=el('tr',{},...spans.map(s=>setRichText(el('th',{style:thStyle,colspan:String(s.colspan),rowspan:String(s.rowspan)}),s.label)));
  const headRow2=el('tr',{},...cols.filter(c=>c.group).map(c=>setRichText(el('th',{style:thStyle+';font-weight:600'}),c.label)));

  const inputRefs=[]; // {rowIndex, colKey, input, expected}
  const bodyRows = rows.map((row,rowIndex)=>el('tr',{},
    ...cols.map(col=>{
      const blank = blanks.find(b=>b.rowIndex===rowIndex && b.colKey===col.key);
      if(!blank) return setRichText(el('td',{style:tdStyle}),String(row[col.key] ?? ''));
      const input=el('input',{type:'text',style:'width:64px;padding:3px 4px;font-size:13px;text-align:center;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:5px;color:var(--text)'});
      input.addEventListener('keydown',e=>{ sess._keystrokes++; if(e.key==='Backspace'||e.key==='Delete') sess._backspaces++; });
      inputRefs.push({rowIndex,colKey:col.key,input,expected:blank.expected});
      return el('td',{style:tdStyle},input);
    })
  ));
  const table=el('table',{style:'border-collapse:collapse;width:100%;margin-top:6px'},
    el('thead',{},headRow1,headRow2),
    el('tbody',{},...bodyRows)
  );
  const questionCard=el('div',{class:'flashcard front',style:'cursor:default;min-height:160px;overflow-x:auto'},...qChildren,table);

  const compareEl=el('div',{style:'display:none'});
  let checked=false;
  const checkBtn=btn('Check Answers (Ctrl+↵)','primary',{full:true,onclick:checkTableAnswers});

  function checkTableAnswers(){
    if(checked)return; checked=true;
    const cardMs = Date.now() - (sess._cardStart || Date.now());
    sess._cardTimes.push(cardMs);
    if (sess._firstCardMs === null) sess._firstCardMs = cardMs;

    let awarded=0;
    inputRefs.forEach(ref=>{
      const userVal=ref.input.value.trim();
      sess._charsTyped += userVal.length;
      const result = userVal ? tableCellMatch(userVal, ref.expected, card) : 'wrong';
      ref.input.disabled=true;
      ref.input.style.borderColor = result==='wrong' ? '#ef4444' : result==='close' ? '#FB923C' : '#22c55e';
      ref.input.style.background = result==='wrong' ? 'rgba(239,68,68,0.1)' : result==='close' ? 'rgba(251,146,60,0.1)' : 'rgba(34,197,94,0.1)';
      if(result==='correct') awarded++; else if(result==='close') awarded += 0.5;
      if(result!=='correct'){
        const solutionTag=setRichText(el('div',{style:'font-size:10px;color:var(--muted);margin-top:2px'}),String(ref.expected ?? ''));
        ref.input.insertAdjacentElement('afterend',solutionTag);
      }
    });
    awarded=Math.round(awarded*10)/10;
    const result = awarded===totalMarks ? 'correct' : awarded>0 ? 'close' : 'wrong';

    compareEl.style.display=''; compareEl.className=`quiz-compare ${result}`; compareEl.innerHTML='';
    const emoji=result==='correct'?'✅':result==='close'?'🟡':'❌';
    const label=result==='correct'?'Correct!':result==='close'?'Partially correct':'Incorrect';
    compareEl.append(
      el('div',{class:`quiz-label ${result}`},`${emoji} ${label}`),
      el('div',{style:'font-size:10px;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em'},`${awarded} / ${totalMarks} marks`),
    );
    if(citBadge) compareEl.appendChild(citBadge);
    const rateRow=el('div',{class:'quiz-self-rate'});
    [{label:'✅ Got it',rating:4,color:'#22c55e'},{label:'🟡 Close',rating:2,color:'#FB923C'},{label:'❌ Wrong',rating:1,color:'#ef4444'}].forEach(rb=>{
      rateRow.appendChild(el('button',{class:'btn btn-sm',style:`background:color-mix(in srgb, ${rb.color} 8%, transparent);color:${rb.color};border:1px solid color-mix(in srgb, ${rb.color} 20%, transparent)`,onclick:()=>rateCard(rb.rating)},rb.label));
    });
    stickyFooter.appendChild(rateRow);
    if(result==='correct') setTimeout(()=>rateCard(4),50);
    checkBtn.style.display='none';
  }
  if(inputRefs.length) inputRefs[inputRefs.length-1].input.addEventListener('keydown',e=>{ if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)) checkTableAnswers(); });

  const scrollContent=el('div',{style:'padding-bottom:8px'});
  scrollContent.append(questionCard,compareEl);
  const stickyFooter=el('div',{class:'quiz-sticky-footer'});
  stickyFooter.append(checkBtn);
  setTimeout(()=>inputRefs[0]?.input.focus(),50);
  return {scrollContent,stickyFooter};
}

function renderQuizCard(card, citBadge, scrollArea) {
  if(card.type==='process') return renderProcessQuizCard(card, citBadge);
  if(card.type==='calculation') return renderCalcQuizCard(card, citBadge);
  if(card.type==='table') return renderTableQuizCard(card, citBadge);
  const sess=studySession;
  const wrap=el('div',{});
  const qChildren=[el('div',{class:'flashcard-side-label'},'QUESTION'),el('div',{class:'flashcard-tags'},...(card.tags||[]).map(t=>mkTag(t)))];
  if(card.frontImage&&sess.showImages!==false)qChildren.push(el('img',{src:card.frontImage,style:'max-width:100%;max-height:140px;object-fit:contain;border-radius:8px;margin-bottom:8px'}));
  qChildren.push(setRichText(el('div',{class:'flashcard-front-text',style:'font-size:18px'}),formatCardFront(card)));
  const questionCard=el('div',{class:'flashcard front',style:'cursor:default;min-height:160px'},...qChildren);

  // Optional Written Quiz timer (⏱️ Timed checkbox): per-card countdown, ticks
  // via setInterval and auto-submits
  // (as an incorrect/empty answer if nothing was typed) when it hits zero.
  let timerBar=null, timerLabel=null;
  const isTimed = !!sess.timed;
  if(isTimed){
    sess.timeLeft = sess.timePerCard;
    sess.timedOut = false;
    timerLabel=el('span',{style:'font-size:11px;font-weight:800;color:var(--text);min-width:28px;text-align:right'},`${sess.timeLeft}s`);
    const timerFill=el('div',{style:'height:100%;width:100%;background:var(--blue);border-radius:3px;transition:width 1s linear, background 0.3s'});
    timerBar=el('div',{style:'display:flex;align-items:center;gap:8px;margin-bottom:12px'},
      el('span',{style:'font-size:14px'},'⏱️'),
      el('div',{style:'flex:1;height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden'},timerFill),
      timerLabel
    );
    const tick=()=>{
      sess.timeLeft--;
      const pct=Math.max(0,(sess.timeLeft/sess.timePerCard)*100);
      timerFill.style.width=`${pct}%`;
      timerFill.style.background = sess.timeLeft<=5 ? '#ef4444' : (sess.timeLeft<=10 ? '#FB923C' : 'var(--blue)');
      if(timerLabel) timerLabel.textContent=`${Math.max(0,sess.timeLeft)}s`;
      if(sess.timeLeft<=0){
        clearQuizTimer();
        sess.timedOut=true;
        checkQuizAnswer();
      }
    };
    quizTimerHandle=setInterval(tick,1000);
  }

  // Match mode toggle
  const modeToggleRow=el('div',{style:'display:flex;align-items:center;gap:8px;margin-bottom:10px'});
  const mkModeBtn=(id,label,title)=>{
    const b=el('button',{title,style:`padding:5px 12px;border-radius:20px;border:1px solid;cursor:pointer;font-size:11px;font-weight:700;font-family:inherit;transition:all 0.15s;`},label);
    function refresh(){
      const active=sess.matchMode===id;
      b.style.background=active?'rgba(var(--blue-rgb),0.2)':'rgba(255,255,255,0.05)';
      b.style.color=active?'var(--blue)':'var(--muted)';
      b.style.borderColor=active?'rgba(var(--blue-rgb),0.4)':'rgba(255,255,255,0.1)';
    }
    b.addEventListener('click',()=>{
      sess.matchMode=id;
      state.settings.quizMatchMode=id;
      scheduleSave();
      modeToggleRow.querySelectorAll('button').forEach(btn=>btn._refresh?.());
    });
    b._refresh=refresh; refresh();
    return b;
  };
  modeToggleRow.append(
    el('span',{style:'font-size:11px;color:var(--muted);font-weight:700;margin-right:2px'},'Match:'),
    mkModeBtn('fuzzy',  '≈ Fuzzy',    'Accept similar answers, partial word matches'),
    mkModeBtn('exact',  '= Exact',    'Must match character-for-character (case-insensitive)')
  );

  // Multi-answer cards (card.answerCount > 1, set during card creation) have a
  // *pool* of valid answers but only ask for `requiredAnswers` of them to earn
  // full marks — e.g. a card with 5 valid answers might only require 2 boxes.
  // The user's answers are still matched against the *entire* pool (not just
  // the first `requiredAnswers` entries), so any valid answer counts no matter
  // which box it lands in. `inputAreas` always holds at least one element so
  // the single-answer path below is just the answerCount===1 case of the same code.
  //
  // Mark-scheme cards (card.type==='markscheme') reuse this exact pool —
  // `back` holds the mark-scheme's keyword/marking points, requiredAnswers is
  // how many marks the question is worth — but the *input* is a single
  // free-text paragraph (an exam answer isn't written box-by-box), scored by
  // spotting which keywords appear in it (see markschemeMatch in
  // dashboard-core.js) rather than matching one box per pool entry.
  const isMarkscheme = card.type === 'markscheme';
  const answerCount = Math.min(8, Math.max(1, card.answerCount || 1));
  const isMulti = !isMarkscheme && answerCount > 1;
  const expectedAnswers = (isMulti || isMarkscheme) ? getCardAnswers(card) : [card.back];
  const requiredAnswers = (isMulti || isMarkscheme) ? Math.min(answerCount, Math.max(1, card.requiredAnswers || answerCount)) : 1;

  const inputWrap=el('div',{});
  if(isMarkscheme) inputWrap.appendChild(el('div',{style:'font-size:12px;font-weight:700;color:var(--muted);margin-bottom:6px'},`Write your answer — cover ${requiredAnswers} key point${requiredAnswers===1?'':'s'} for full marks.`));
  else if(isMulti) inputWrap.appendChild(el('div',{style:'font-size:12px;font-weight:700;color:var(--muted);margin-bottom:6px'},`Give ${requiredAnswers} answer${requiredAnswers===1?'':'s'}.`));
  const inputAreas=[];
  const onKeystroke=e=>{ sess._keystrokes++; if(e.key==='Backspace'||e.key==='Delete') sess._backspaces++; };
  if(isMulti){
    for(let i=0;i<requiredAnswers;i++){
      const box=el('input',{type:'text',class:'quiz-input-area',style:'min-height:unset;margin-bottom:8px',placeholder:`Answer ${i+1}…`});
      box.value=sess.quizAnswers?.[i]||'';
      box.addEventListener('input',e=>{ sess.quizAnswers[i]=e.target.value; });
      box.addEventListener('keydown',onKeystroke);
      inputWrap.appendChild(box);
      inputAreas.push(box);
    }
  } else {
    const box=el('textarea',{class:'quiz-input-area',placeholder: isMarkscheme?'Write your answer here…':'Type your answer here…'});
    box.value=sess.quizAnswer||'';
    box.addEventListener('input',e=>{ sess.quizAnswer=e.target.value; });
    box.addEventListener('keydown',onKeystroke);
    inputWrap.appendChild(box);
    inputAreas.push(box);
  }

  const compareEl=el('div',{style:'display:none'});
  let checked=false;
  const checkBtn=btn('Check Answer (Ctrl+↵)','primary',{full:true,onclick:checkQuizAnswer});

  function checkQuizAnswer(){
    if(checked)return; checked=true;
    clearQuizTimer();
    // Record per-card timing and net chars submitted.
    const cardMs = Date.now() - (sess._cardStart || Date.now());
    sess._cardTimes.push(cardMs);
    if (sess._firstCardMs === null) sess._firstCardMs = cardMs;
    const matcher=sess.matchMode==='exact' ? quizMatchExact : quizMatch;
    const isExact=sess.matchMode==='exact';
    let result, resultChildren;
    if(isMarkscheme){
      const userAnswer=sess.quizAnswer.trim();
      sess._charsTyped += userAnswer.length;
      if (sess.timedOut) sess._timeouts++;
      const hits = (userAnswer && !sess.timedOut) ? expectedAnswers.map(k=>markschemeMatch(userAnswer,k,isExact)) : expectedAnswers.map(()=>false);
      const hitCount = hits.filter(Boolean).length;
      const marksAwarded = Math.min(hitCount, requiredAnswers);
      result = marksAwarded===requiredAnswers ? 'correct' : marksAwarded>0 ? 'close' : 'wrong';
      resultChildren=[
        isExact&&result!=='correct'&&!sess.timedOut
          ? el('div',{style:'font-size:10px;color:var(--muted);margin-bottom:4px;font-style:italic'},'Tip: exact mode requires the keyword phrase verbatim')
          : null,
        el('div',{style:'font-size:10px;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em'},`${marksAwarded} / ${requiredAnswers} marks`),
        (card.backImage&&sess.showImages!==false)?el('img',{src:card.backImage,style:'max-width:100%;max-height:120px;object-fit:contain;border-radius:8px;margin-bottom:8px'}):null,
        el('div',{style:'font-size:10px;color:var(--muted);margin:8px 0 6px;text-transform:uppercase;letter-spacing:0.05em'},'Mark scheme:'),
        el('ul',{style:'text-align:left;margin:0;padding-left:20px;line-height:1.7;font-size:13px'},
          ...expectedAnswers.map((k,i)=>el('li',{style:`color:${hits[i]?'#22c55e':'var(--text)'}`},`${hits[i]?'✅ ':'⬜ '}${k}`))
        )
      ];
    } else if(!isMulti){
      const userAnswer=sess.quizAnswer.trim();
      sess._charsTyped += userAnswer.length;
      if (sess.timedOut) sess._timeouts++;
      result=(userAnswer&&!sess.timedOut)?matcher(userAnswer,card.back):'wrong';
      resultChildren=[
        isExact&&result!=='correct'&&!sess.timedOut
          ? el('div',{style:'font-size:10px;color:var(--muted);margin-bottom:4px;font-style:italic'},'Tip: exact mode requires a perfect match')
          : null,
        el('div',{style:'font-size:10px;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em'},'Expected answer:'),
        (card.backImage&&sess.showImages!==false)?el('img',{src:card.backImage,style:'max-width:100%;max-height:120px;object-fit:contain;border-radius:8px;margin-bottom:8px'}):null,
        el('div',{class:'quiz-answer-text'},card.back)
      ];
    } else {
      // Greedily pair each typed answer with the closest still-unmatched expected
      // answer (order-independent — "France" for box 2 still counts even if the
      // card's first line is "France"). Net chars/timeouts are summed across boxes.
      const userAnswers=sess.quizAnswers.map(a=>(a||'').trim());
      userAnswers.forEach(a=>{ sess._charsTyped += a.length; });
      if (sess.timedOut) sess._timeouts++;
      const remaining=[...expectedAnswers];
      let correctCount=0;
      const rows=userAnswers.map((userAnswer,i)=>{
        let rowResult='wrong', matchedExpected=null;
        if(userAnswer && !sess.timedOut){
          const idx=remaining.findIndex(exp=>matcher(userAnswer,exp)==='correct');
          if(idx>=0){ matchedExpected=remaining.splice(idx,1)[0]; rowResult='correct'; correctCount++; }
        }
        return {userAnswer,rowResult,matchedExpected};
      });
      result = correctCount===requiredAnswers ? 'correct' : correctCount>0 ? 'close' : 'wrong';
      resultChildren=[
        el('div',{style:'font-size:10px;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em'},`${correctCount} / ${requiredAnswers} correct`),
        ...rows.map(r=>el('div',{style:'display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:4px 0'},
          el('span',{},r.userAnswer||'(blank)'),
          el('span',{style:`font-weight:700;color:${r.rowResult==='correct'?'#22c55e':'#ef4444'}`},r.rowResult==='correct'?'✅':'❌')
        )),
        el('div',{style:'font-size:10px;color:var(--muted);margin:8px 0 6px;text-transform:uppercase;letter-spacing:0.05em'},'Expected answers:'),
        (card.backImage&&sess.showImages!==false)?el('img',{src:card.backImage,style:'max-width:100%;max-height:120px;object-fit:contain;border-radius:8px;margin-bottom:8px'}):null,
        el('div',{class:'quiz-answer-text'},expectedAnswers.join(', '))
      ];
    }
    compareEl.style.display=''; compareEl.className=`quiz-compare ${result}`; compareEl.innerHTML='';
    const emoji=sess.timedOut?'⏱️':(result==='correct'?'✅':result==='close'?'🟡':'❌');
    const label=sess.timedOut?"Time's up!"
      :result==='correct'?'Correct!'
      :result==='close'?'Close — review below'
      :(isExact&&!isMulti?'Incorrect — exact match required':'Incorrect');
    compareEl.append(el('div',{class:`quiz-label ${result}`},`${emoji} ${label}`), ...resultChildren);
    if(citBadge) compareEl.appendChild(citBadge);
    const rateRow=el('div',{class:'quiz-self-rate'});
    [{label:'✅ Got it',rating:4,color:'#22c55e'},{label:'🟡 Close',rating:2,color:'#FB923C'},{label:'❌ Wrong',rating:1,color:'#ef4444'}].forEach(rb=>{
      rateRow.appendChild(el('button',{class:'btn btn-sm',style:`background:color-mix(in srgb, ${rb.color} 8%, transparent);color:${rb.color};border:1px solid color-mix(in srgb, ${rb.color} 20%, transparent)`,onclick:()=>rateCard(rb.rating)},rb.label));
    });
    compareEl.appendChild(rateRow);
    if(result==='correct') setTimeout(()=>rateCard(4),50);
    inputAreas.forEach(box=>box.disabled=true); checkBtn.style.display='none';
    // Re-disable mode toggle after check
    modeToggleRow.querySelectorAll('button').forEach(b=>{ b.disabled=true; b.style.opacity='0.5'; b.style.cursor='default'; });
  }
  inputAreas.forEach(box=>box.addEventListener('keydown',e=>{ if(e.key==='Enter'&&(e.ctrlKey||e.metaKey||isMulti)) checkQuizAnswer(); }));
  // scrollContent: question card + compare result (scrollable)
  const scrollContent=el('div',{style:'padding-bottom:8px'});
  if(timerBar) scrollContent.appendChild(timerBar);
  scrollContent.append(questionCard,compareEl);
  // stickyFooter: input + check, swaps to rate buttons after check
  const stickyFooter=el('div',{class:'quiz-sticky-footer'});
  stickyFooter.append(modeToggleRow,inputWrap,checkBtn);
  // Patch rateRow injection: after checkQuizAnswer appends rateRow to compareEl,
  // move it into stickyFooter so it stays visible
  const _origAppendChild=compareEl.appendChild.bind(compareEl);
  compareEl.appendChild=function(node){
    if(node&&node.classList&&node.classList.contains('quiz-self-rate')){
      stickyFooter.appendChild(node);
      if(scrollArea)scrollArea.scrollTop=0;
    } else { _origAppendChild(node); }
    return node;
  };
  setTimeout(()=>inputAreas[0]?.focus(),50);
  return {scrollContent,stickyFooter};
}

function rateCard(rating) {
  const sess=studySession, card=sess.queue[sess.idx];
  // For flashcard/review mode, card time = total time on card including flip.
  // Quiz/gap modes record timing inside checkQuizAnswer/checkGapAnswer instead.
  if(sess.mode!=='quiz'&&sess.mode!=='gaps'){
    const cardMs=Date.now()-(sess._cardStart||Date.now());
    sess._cardTimes.push(cardMs);
    if(sess._firstCardMs===null) sess._firstCardMs=cardMs;
  }
  const good=rating>=3;
  const wasNew = card.state==='new';
  sess.stats.correct+=good?1:0; sess.stats.incorrect+=good?0:1;
  sess.combo=good?sess.combo+1:0; sess.maxCombo=Math.max(sess.maxCombo,sess.combo);
  const deck=state.decks.find(d=>d.cards.some(c=>c.id===card.id));
  const sk=deck?.subject||DEFAULT_SUBJECT_KEY;
  addXP(calcCardXP(card,rating)*(sess.showHint?0.5:1)*subjectXPMultiplier(state.trackerState?.subjects,sk));
  const d=today(), ex=state.reviewHistory.find(r=>r.date===d);
  if(ex){ ex.total=(ex.total||0)+1; ex.correct=(ex.correct||0)+(good?1:0); if(wasNew) ex.newSeen=(ex.newSeen||0)+1; }
  else state.reviewHistory.push({date:d,total:1,correct:good?1:0,newSeen:wasNew?1:0});
  bumpStreak();
  const updated=scheduleCard(card,rating,{algorithm:state.settings.algorithm,leechThreshold:state.settings.leechThreshold,autoSuspend:state.settings.autoSuspend});
  if(deck){ const i=deck.cards.findIndex(c=>c.id===card.id); if(i>=0) deck.cards[i]=updated; }
  scheduleSave(); checkAchievements(); nextCard();
}

function nextCard(){
  const sess=studySession;
  sess.flipped=false; sess.showHint=false; sess.quizAnswer=''; sess.quizAnswers=[]; sess.gapChoice=null; sess.idx++;
  if(sess.idx>=sess.queue.length) finishSession();
  else renderStudySession(document.getElementById('view-study'));
}

function finishSession(){
  if(window.speechSynthesis) window.speechSynthesis.cancel();
  const sess=studySession; addXP(50); sess.active=false;
  checkAchievements();
  const elapsed=Math.round((Date.now()-sess.startTime)/1000);
  pushSessionLog(sess, elapsed);
  const c=document.getElementById('view-study'); c.innerHTML=''; c.style.cssText='';
  const total=sess.stats.correct+sess.stats.incorrect;
  const pct=total>0?Math.round((sess.stats.correct/total)*100):0;
  const log=state.sessionLog?.[0]; // the entry we just pushed

  // Extra stat pills for quiz/gap modes
  const extraStats=[];
  if(log?.wpm>0)             extraStats.push(['⌨️ WPM',     log.wpm,          'var(--blue)']);
  if(log?.avgKsPerSec>0)     extraStats.push(['⚡ KS/s',    log.avgKsPerSec,  '#A78BFA']);
  if(log?.avgMsPerCard!=null) extraStats.push(['⏱ Avg/card',`${(log.avgMsPerCard/1000).toFixed(1)}s`,'#FB923C']);
  if(log?.backspaces>0)      extraStats.push(['⌫ Backspaces',log.backspaces,  'var(--muted)']);
  if(log?.timeouts>0)        extraStats.push(['💀 Timeouts', log.timeouts,    '#ef4444']);
  if(log?.avgFlipMs!=null)   extraStats.push(['🃏 Avg flip', `${(log.avgFlipMs/1000).toFixed(1)}s`,'#22c55e']);

  c.appendChild(el('div',{class:'card glow',style:'padding:40px;text-align:center;max-width:480px;margin:80px auto'},
    el('div',{style:'font-size:56px;margin-bottom:12px'},pct>=80?'🎉':pct>=60?'👍':'💪'),
    el('div',{style:'font-size:22px;font-weight:900;margin-bottom:6px'},'Session Complete!'),
    el('div',{style:'font-size:14px;color:var(--muted);margin-bottom:24px'},'Consistency builds mastery.'),
    el('div',{class:'grid-3',style:'margin-bottom:16px'},
      ...[['✅ Correct',sess.stats.correct,'#22c55e'],['❌ Missed',sess.stats.incorrect,'#ef4444'],['⏱️ Seconds',elapsed,'var(--blue)']].map(([l,v,col])=>
        el('div',{style:'background:rgba(255,255,255,0.05);border-radius:12px;padding:14px'},
          el('div',{style:`font-size:22px;font-weight:900;color:${col}`},String(v)),
          el('div',{style:'font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-top:2px'},l))
      )
    ),
    extraStats.length ? el('div',{style:'display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:16px'},
      ...extraStats.map(([l,v,col])=>el('div',{style:`background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:8px 14px;font-size:12px`},
        el('span',{style:`font-weight:800;color:${col}`},String(v)),
        el('span',{style:'color:var(--muted);margin-left:5px'},l)
      ))
    ) : null,
    el('div',{style:'font-size:28px;font-weight:900;margin-bottom:4px'},gradText(`${pct}% Accuracy`)),
    el('div',{style:'color:var(--muted);font-size:12px;margin-bottom:24px'},`Max combo: ${sess.maxCombo} 🔥`),
    el('div',{style:'display:flex;gap:10px;justify-content:center'},
      btn('New Session','primary',{onclick:()=>{ studySession=null; renderView('study'); }}),
      btn('Retry','ghost',{onclick:()=>startStudySession(sess.scope,sess.mode)})
    )
  ));
}

