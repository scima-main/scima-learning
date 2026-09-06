'use strict';
/* dashboard-home.js — the default landing view (renderHome). Part of the
   dashboard-*.js split; see dashboard-core.js's header for the full rationale
   and load-order rules. Load order relative to the other view files below
   doesn't matter — only core (must load first) and bootstrap (must load
   last) are order-sensitive. */

function renderHome(c) {
  const allCards = state.decks.flatMap(d => d.cards);
  const due = getDueCards(allCards).length;
  const todayEntry = state.reviewHistory.find(r => r.date === today());
  const todayRev = todayEntry?.total || 0;
  const retCalc = state.reviewHistory.reduce((a,e) => ({ t: a.t+(e.total||0), c: a.c+(e.correct||0) }), {t:0,c:0});
  const ret = retCalc.t > 0 ? Math.round((retCalc.c/retCalc.t)*100) : 0;

  if (!state.decks.length) {
    c.appendChild(el('div', { class: 'empty-state', style:'padding-top:80px' },
      el('div', { class:'empty-icon' }, '✦'),
      el('div', { class:'empty-title' }, 'Welcome to SCIMA Learning'),
      el('div', { class:'empty-sub' }, 'Create your first deck to start forging memories.'),
      btn('Create First Deck', 'primary', { onclick: () => navigate('decks') })
    ));
    return;
  }

  const statsGrid = el('div', { class:'grid-4', style:'margin-bottom:24px' });
  [
    { label:'Due Today', val:due, icon:'📋', color:'var(--pink)' },
    { label:'Reviewed', val:todayRev, icon:'✅', color:'var(--blue)' },
    { label:'Retention', val:`${ret}%`, icon:'🎯', color: ret>=80?'#22c55e':'var(--blue)' },
    { label:'Day Streak', val:state.streak, icon:'🔥', color:'#FB923C' },
  ].forEach(s => {
    statsGrid.appendChild(el('div', { class:'card stat-card' },
      el('div',{class:'stat-icon'},s.icon), el('div',{class:'stat-val',style:`color:${s.color}`},String(s.val)), el('div',{class:'stat-lab'},s.label)));
  });

  const deckGrid = el('div', { class:'grid-3' });
  const homeDecks = [...state.decks].sort((a,b) => (b.pinned?1:0)-(a.pinned?1:0)).slice(0,6);
  homeDecks.forEach(deck => {
    const deckDue = getDueCards(deck.cards).length;
    const sk = deck.subject || DEFAULT_SUBJECT_KEY;
    const mult = subjectXPMultiplier(state.trackerState?.subjects, sk);
    const folder = state.folders.find(f => f.id === deck.folderId);
    deckGrid.appendChild(el('div', { class:`card deck-card${deckDue>0?' glow':''}` },
      el('div',{style:'display:flex;justify-content:space-between;align-items:flex-start'},
        mkIcon(deck.emoji,deck.image,'36px','8px'),
        el('button',{class:`btn btn-ghost btn-sm pin-toggle${deck.pinned?' pinned':''}`,title:deck.pinned?'Unpin from sidebar':'Pin to sidebar',onclick:e=>{e.stopPropagation();togglePinDeck(deck.id);}},'📌')
      ),
      el('div',{class:'deck-name'},deck.name),
      el('div',{class:'deck-meta'},`${deck.cards.length} cards${folder?' · '+folder.name:''}`),
      el('div',{class:'deck-tags'},
        mkTag(getAllSubjects()[sk]?.short||sk, getAllSubjects()[sk]?.defaultColor||'#888'),
        mkTag(`${mult.toFixed(2)}× XP`, mult>=1.5?'var(--pink)':'#22c55e'),
        deckDue>0 ? mkTag(`${deckDue} due`,'var(--pink)') : mkTag('Caught up ✓','#22c55e')
      ),
      btn('Study Now','primary',{ full:true, onclick:()=>{ state.studyScope=[{type:'deck',id:deck.id}]; navigate('study'); }})
    ));
  });

  const goal = state.settings.dailyGoal || 20;
  const goalPct = Math.min(100, Math.round((todayRev/goal)*100));
  const goalCard = el('div',{class:'card',style:'padding:16px 20px;margin-bottom:20px'},
    el('div',{style:'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px'},
      el('div',{style:'font-size:12px;font-weight:700;color:var(--muted)'},'🎯 Daily Goal'),
      el('div',{style:'font-size:12px;font-weight:800'},`${todayRev} / ${goal}${todayRev>=goal?' ✓':''}`)
    ),
    el('div',{class:'prog-bar'},el('div',{style:`height:100%;width:${goalPct}%;background:${todayRev>=goal?'#22c55e':'var(--blue)'};border-radius:3px`}))
  );

  c.append(
    el('div',{style:'margin-bottom:28px'},
      el('div',{style:'font-size:13px;color:var(--muted);margin-bottom:4px'},'Good day, Scholar 👋'),
      el('h1',{style:'font-size:28px;font-weight:900;letter-spacing:-0.03em;line-height:1.1;margin-bottom:8px'},'Ready to forge some ',gradText('memories'),'?'),
      el('p',{style:'font-size:14px;color:var(--muted)'},'You have ',el('span',{style:'color:var(--pink);font-weight:700'},`${due} cards due`),` across ${state.decks.length} deck${state.decks.length!==1?'s':''}`)
    ),
    statsGrid,
    goalCard,
    el('div',{style:'font-weight:800;margin-bottom:12px;font-size:14px'},'📚 Your Decks'),
    deckGrid
  );
}

// --- Drag-and-drop: move decks/folders between folders (HTML5 DnD) ---
let dragData = null; // { type:'deck'|'folder', id }

