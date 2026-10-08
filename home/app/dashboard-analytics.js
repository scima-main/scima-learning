'use strict';
/* dashboard-analytics.js — the Home-page stats view, achievement checking,
   and the Quests view. Part of the dashboard-*.js split; see
   dashboard-core.js's header for the full rationale and load-order rules.

   SITE PORT NOTES: ported verbatim, no changes. Purely state/DOM — no
   chrome.* APIs anywhere in this file. */

function renderAnalytics(c) {
  const allCards=state.decks.flatMap(d=>d.cards);
  if(!state.decks.length){
    c.appendChild(el('div',{class:'empty-state',style:'padding-top:80px'},el('div',{class:'empty-icon'},'📊'),el('div',{class:'empty-title'},'No data yet'),el('div',{class:'empty-sub'},'Start studying to see your analytics'),
      btn('Create a Deck','primary',{onclick:()=>navigate('decks')})
    ));
    return;
  }
  const mature=allCards.filter(c=>c.interval>=21).length, young=allCards.filter(c=>c.interval>=7&&c.interval<21).length;
  const newC=allCards.filter(c=>c.state==='new').length, leeches=allCards.filter(c=>c.leech).length;
  const totalRev=state.reviewHistory.reduce((a,r)=>a+(r.total||0),0);
  const retCalc=state.reviewHistory.reduce((a,e)=>({t:a.t+(e.total||0),c:a.c+(e.correct||0)}),{t:0,c:0});
  const ret=retCalc.t>0?Math.round((retCalc.c/retCalc.t)*100):0;

  const statsGrid=el('div',{class:'grid-4',style:'margin-bottom:24px'});
  [{label:'Retention',val:`${ret}%`,icon:'🎯',color:ret>=80?'#22c55e':ret>=60?'var(--blue)':'#ef4444'},
   {label:'Mature Cards',val:mature,icon:'🌳',color:'#22c55e'},
   {label:'Total Reviews',val:totalRev,icon:'🔄',color:'var(--blue)'},
   {label:'Leeches',val:leeches,icon:'⚠️',color:leeches>0?'#FB923C':'var(--muted)'},
  ].forEach(s=>statsGrid.appendChild(el('div',{class:'card stat-card'},el('div',{class:'stat-icon'},s.icon),el('div',{class:'stat-val',style:`color:${s.color}`},String(s.val)),el('div',{class:'stat-lab'},s.label))));

  const heatDays=Array.from({length:28},(_,i)=>{ const d=new Date(Date.now()-(27-i)*86400000); return {key:d.toISOString().split('T')[0],count:0}; });
  heatDays.forEach(d=>{ const r=state.reviewHistory.find(r=>r.date===d.key); if(r) d.count=r.total||0; });
  const heatCard=el('div',{class:'card',style:'padding:20px;margin-bottom:16px'});
  heatCard.appendChild(el('div',{style:'font-weight:800;margin-bottom:14px'},'📅 Review Activity — Last 28 days'));
  const heatGrid=el('div',{class:'heatmap'});
  heatDays.forEach(d=>{ const bg=d.count===0?'rgba(255,255,255,0.04)':d.count<10?'rgba(var(--blue-rgb),0.25)':d.count<25?'rgba(var(--blue-rgb),0.55)':'var(--blue)'; heatGrid.appendChild(el('div',{class:'heat-cell',style:`background:${bg}`,title:`${d.key}: ${d.count}`})); });
  heatCard.appendChild(heatGrid);

  // 7-day accuracy trend — daily reviews vs. % correct, side by side with the heatmap.
  const trendDays=Array.from({length:7},(_,i)=>{ const d=new Date(Date.now()-(6-i)*86400000); const key=d.toISOString().split('T')[0];
    const r=state.reviewHistory.find(r=>r.date===key); const total=r?.total||0, correct=r?.correct||0;
    return { key, label:d.toLocaleDateString(undefined,{weekday:'short'}), total, pct: total?Math.round((correct/total)*100):null }; });
  const maxTrendTotal=Math.max(1,...trendDays.map(d=>d.total));
  const trendCard=el('div',{class:'card',style:'padding:20px;margin-bottom:16px'});
  trendCard.appendChild(el('div',{style:'font-weight:800;margin-bottom:14px'},'📈 7-Day Accuracy Trend'));
  const trendRow=el('div',{style:'display:flex;align-items:flex-end;gap:8px;height:110px'});
  trendDays.forEach(d=>{
    const barH=Math.max(4,(d.total/maxTrendTotal)*80);
    const barColor=d.pct==null?'rgba(255,255,255,0.08)':d.pct>=80?'#22c55e':d.pct>=60?'var(--blue)':'#ef4444';
    trendRow.appendChild(el('div',{style:'flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;justify-content:flex-end;height:100%'},
      el('div',{style:'font-size:10px;color:var(--muted)'},d.pct==null?'—':`${d.pct}%`),
      el('div',{style:`width:100%;max-width:28px;height:${barH}px;background:${barColor};border-radius:4px 4px 0 0`,title:`${d.key}: ${d.total} review${d.total!==1?'s':''}${d.pct!=null?`, ${d.pct}% correct`:''}`}),
      el('div',{style:'font-size:10px;color:var(--muted);font-weight:700'},d.label)
    ));
  });
  trendCard.appendChild(trendRow);

  // Cards by subject distribution.
  const subjectCounts={};
  state.decks.forEach(d=>{ const key=d.subject||DEFAULT_SUBJECT_KEY; subjectCounts[key]=(subjectCounts[key]||0)+d.cards.length; });
  const subjectEntries=Object.entries(subjectCounts).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1]);
  const subjectCard=el('div',{class:'card',style:'padding:20px;margin-bottom:16px'});
  subjectCard.appendChild(el('div',{style:'font-weight:800;margin-bottom:14px'},'🏷️ Cards by Subject'));
  if(!subjectEntries.length){
    subjectCard.appendChild(el('div',{class:'u-muted-12'},'No cards yet'));
  } else {
    subjectEntries.forEach(([key,count])=>{
      const s=getAllSubjects()[key]; const label=s?.name||key; const color=s?.defaultColor||'var(--blue)';
      const pct=allCards.length?(count/allCards.length)*100:0;
      subjectCard.appendChild(el('div',{style:'margin-bottom:10px'},
        el('div',{style:'display:flex;justify-content:space-between;margin-bottom:3px'},el('span',{class:'u-muted-11'},label),el('span',{style:'font-size:11px;font-weight:700'},String(count))),
        el('div',{class:'prog-bar'},el('div',{style:`height:100%;width:${pct}%;background:${color};border-radius:3px`}))
      ));
    });
  }

  // Reading time by subject — split from source.timeSpentSec weighted by citation count.
  // Only shown when at least one source has ≥1 minute of tracked reading time.
  const readingTimes = getReadingTimeBySubject();
  const readingEntries = Object.entries(readingTimes).filter(([,s])=>s>=60).sort((a,b)=>b[1]-a[1]);
  let readingTimeCard = null;
  if (readingEntries.length) {
    const maxReadSec = readingEntries[0][1];
    readingTimeCard = el('div',{class:'card',style:'padding:20px;margin-bottom:16px'});
    readingTimeCard.appendChild(el('div',{style:'font-weight:800;margin-bottom:4px'},'📖 Reading Time by Subject'));
    readingTimeCard.appendChild(el('div',{class:'u-muted-11',style:'margin-bottom:14px'},'Time spent reading library sources, distributed by citation weight'));
    readingEntries.forEach(([key,sec])=>{
      const s=getAllSubjects()[key]; const label=s?.name||key; const color=s?.defaultColor||'var(--blue)';
      const pct=(sec/maxReadSec)*100;
      readingTimeCard.appendChild(el('div',{style:'margin-bottom:10px'},
        el('div',{style:'display:flex;justify-content:space-between;margin-bottom:3px'},
          el('span',{class:'u-muted-11'},label),
          el('span',{style:'font-size:11px;font-weight:700'},fmtReadingTime(sec))
        ),
        el('div',{class:'prog-bar'},el('div',{style:`height:100%;width:${pct}%;background:${color};border-radius:3px`}))
      ));
    });
  }

  const bottomGrid=el('div',{class:'grid-2'});
  const memCard=el('div',{class:'card',style:'padding:20px'},el('div',{style:'font-weight:800;margin-bottom:14px'},'🧠 Memory Distribution'));
  [{label:'Mature (≥21d)',count:mature,color:'#22c55e'},{label:'Young (7–21d)',count:young,color:'var(--blue)'},
   {label:'Learning (<7d)',count:allCards.filter(c=>c.interval>0&&c.interval<7).length,color:'var(--pink)'},
   {label:'New',count:newC,color:'#A78BFA'},{label:'Leeches',count:leeches,color:'#FB923C'},
  ].forEach(s=>{
    const pct=allCards.length?(s.count/allCards.length)*100:0;
    memCard.appendChild(el('div',{style:'margin-bottom:10px'},
      el('div',{style:'display:flex;justify-content:space-between;margin-bottom:3px'},el('span',{class:'u-muted-11'},s.label),el('span',{style:`font-size:11px;font-weight:700;color:${s.color}`},String(s.count))),
      el('div',{class:'prog-bar'},el('div',{style:`height:100%;width:${pct}%;background:${s.color};border-radius:3px`}))
    ));
  });
  const deckCard=el('div',{class:'card',style:'padding:20px'},el('div',{style:'font-weight:800;margin-bottom:14px'},'📚 Decks'));
  state.decks.forEach(d=>{
    const dm=d.cards.filter(c=>c.interval>=21).length;
    deckCard.appendChild(el('div',{style:'margin-bottom:14px'},
      el('div',{style:'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px'},el('span',{style:'font-size:13px;font-weight:600'},`${d.emoji} ${d.name}`),el('span',{class:'u-muted-11'},`${dm}/${d.cards.length} mature`)),
      el('div',{class:'prog-bar'},el('div',{style:`height:100%;width:${d.cards.length?dm/d.cards.length*100:0}%;background:var(--grad);border-radius:3px`}))
    ));
  });
  bottomGrid.append(deckCard,memCard);

  // ── Session Log Analytics ────────────────────────────────────────────────
  // All cards built from state.sessionLog — only shown when there's data.
  const log = state.sessionLog || [];
  const sessionCards = [];

  if (log.length >= 2) {
    // Helper: sparkline bar chart from an array of {label, val} using a given color.
    function mkSparkline(points, color, valFmt, title) {
      const card = el('div',{class:'card',style:'padding:20px;margin-bottom:16px'});
      card.appendChild(el('div',{style:'font-weight:800;margin-bottom:14px'},title));
      if (!points.length) { card.appendChild(el('div',{class:'u-muted-12'},'No data yet')); return card; }
      const maxVal = Math.max(...points.map(p=>p.val), 1);
      const row = el('div',{style:'display:flex;align-items:flex-end;gap:3px;height:80px'});
      points.forEach(p => {
        const h = Math.max(4, (p.val / maxVal) * 64);
        row.appendChild(el('div',{style:'flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;justify-content:flex-end;height:100%'},
          el('div',{style:`width:100%;height:${h}px;background:${color};border-radius:3px 3px 0 0`,title:`${p.label}: ${valFmt(p.val)}`})
        ));
      });
      card.appendChild(row);
      const latest = points[points.length-1];
      const avg = Math.round(points.reduce((a,p)=>a+p.val,0)/points.length*10)/10;
      card.appendChild(el('div',{style:'display:flex;justify-content:space-between;margin-top:10px'},
        el('span',{class:'u-muted-11'},`Latest: ${valFmt(latest.val)}`),
        el('span',{class:'u-muted-11'},`Avg: ${valFmt(avg)}`)
      ));
      return card;
    }

    // Helper: thin dual-value row bar for two-series comparisons.
    function mkDualBar(items, colorA, colorB, title, labelA, labelB) {
      const card = el('div',{class:'card',style:'padding:20px;margin-bottom:16px'});
      card.appendChild(el('div',{style:'font-weight:800;margin-bottom:4px'},title));
      card.appendChild(el('div',{style:'display:flex;gap:12px;margin-bottom:12px'},
        el('div',{style:`width:10px;height:10px;background:${colorA};border-radius:2px;margin-top:1px`}),
        el('span',{class:'u-muted-11'},labelA),
        el('div',{style:`width:10px;height:10px;background:${colorB};border-radius:2px;margin-top:1px;margin-left:6px`}),
        el('span',{class:'u-muted-11'},labelB)
      ));
      const maxVal = Math.max(...items.flatMap(i=>[i.a,i.b]), 1);
      const row = el('div',{style:'display:flex;align-items:flex-end;gap:5px;height:80px'});
      items.forEach(i => {
        const hA = Math.max(2, (i.a/maxVal)*72); const hB = Math.max(2, (i.b/maxVal)*72);
        row.appendChild(el('div',{style:'flex:1;display:flex;align-items:flex-end;gap:1px;justify-content:center;height:100%'},
          el('div',{style:`width:45%;height:${hA}px;background:${colorA};border-radius:2px 2px 0 0`,title:`${i.label} correct: ${i.a}`}),
          el('div',{style:`width:45%;height:${hB}px;background:${colorB};border-radius:2px 2px 0 0`,title:`${i.label} incorrect: ${i.b}`})
        ));
      });
      card.appendChild(row);
      return card;
    }

    // 1. Typing speed over time: WPM (quiz/gap sessions only)
    const wpmPoints = log.filter(e=>e.wpm>0&&e.mode==='quiz').slice(0,20).reverse()
      .map((e,i)=>({label:`Session ${i+1}`,val:e.wpm}));
    if (wpmPoints.length >= 2)
      sessionCards.push(mkSparkline(wpmPoints,'var(--blue)',v=>`${v} wpm`,'⌨️ Quiz Typing Speed (WPM) over time'));

    // 2. Keystrokes per second trend
    const ksPoints = log.filter(e=>e.avgKsPerSec>0).slice(0,20).reverse()
      .map((e,i)=>({label:`Session ${i+1}`,val:e.avgKsPerSec}));
    if (ksPoints.length >= 2)
      sessionCards.push(mkSparkline(ksPoints,'#A78BFA',v=>`${v} ks/s`,'⚡ Avg Keystrokes/sec over time'));

    // 3. Average time per card trend (all modes)
    const atpcPoints = log.filter(e=>e.avgMsPerCard!=null).slice(0,20).reverse()
      .map((e,i)=>({label:`Session ${i+1}`,val:Math.round(e.avgMsPerCard/100)/10}));
    if (atpcPoints.length >= 2)
      sessionCards.push(mkSparkline(atpcPoints,'#FB923C',v=>`${v}s`,'⏱ Avg Time per Card (seconds) over time'));

    // 4. Flashcard flip speed trend
    const flipPoints = log.filter(e=>e.avgFlipMs!=null).slice(0,20).reverse()
      .map((e,i)=>({label:`Session ${i+1}`,val:Math.round(e.avgFlipMs/100)/10}));
    if (flipPoints.length >= 2)
      sessionCards.push(mkSparkline(flipPoints,'#22c55e',v=>`${v}s`,'🃏 Avg Flashcard Flip Speed over time'));

    // 5. Accuracy trend (correct vs incorrect per session — last 14 sessions)
    const accItems = log.slice(0,14).reverse().map((e,i)=>({label:`S${i+1}`,a:e.correct,b:e.incorrect}));
    if (accItems.some(i=>i.a+i.b>0))
      sessionCards.push(mkDualBar(accItems,'#22c55e','#ef4444','✅ Correct vs ❌ Incorrect per Session','Correct','Incorrect'));

    // 6. Backspaces trend (proxy for revision / second-guessing)
    const bsPoints = log.filter(e=>e.backspaces>0).slice(0,20).reverse()
      .map((e,i)=>({label:`Session ${i+1}`,val:e.backspaces}));
    if (bsPoints.length >= 2)
      sessionCards.push(mkSparkline(bsPoints,'var(--muted)',v=>`${v}`,'⌫ Backspaces per Session (revision effort)'));

    // 7. Session duration trend
    const durPoints = log.slice(0,20).reverse()
      .map((e,i)=>({label:`Session ${i+1}`,val:Math.round(e.durationSec/6)/10}));
    if (durPoints.length >= 2)
      sessionCards.push(mkSparkline(durPoints,'var(--pink)',v=>`${v}m`,'⏳ Session Duration (minutes) over time'));

    // 8. Max combo trend
    const comboPoints = log.filter(e=>e.maxCombo>0).slice(0,20).reverse()
      .map((e,i)=>({label:`Session ${i+1}`,val:e.maxCombo}));
    if (comboPoints.length >= 2)
      sessionCards.push(mkSparkline(comboPoints,'#FB923C',v=>`${v}x`,'🔥 Max Combo per Session'));

    // 9. Timed quiz timeouts trend (written quiz timed mode)
    const toPoints = log.filter(e=>e.timed&&e.timeouts!=null).slice(0,20).reverse()
      .map((e,i)=>({label:`Session ${i+1}`,val:e.timeouts}));
    if (toPoints.length >= 2)
      sessionCards.push(mkSparkline(toPoints,'#ef4444',v=>`${v}`,'💀 Timed Quiz Timeouts per Session'));

    // 10. Skips per session
    const skipPoints = log.filter(e=>e.skipped>0).slice(0,20).reverse()
      .map((e,i)=>({label:`Session ${i+1}`,val:e.skipped}));
    if (skipPoints.length >= 2)
      sessionCards.push(mkSparkline(skipPoints,'var(--muted)',v=>`${v}`,'⏭ Skips per Session'));

    // 11. Chars typed total per quiz session
    const charsPoints = log.filter(e=>e.charsTyped>0).slice(0,20).reverse()
      .map((e,i)=>({label:`Session ${i+1}`,val:e.charsTyped}));
    if (charsPoints.length >= 2)
      sessionCards.push(mkSparkline(charsPoints,'var(--blue)',v=>`${v}`,'🔡 Characters Typed per Quiz Session'));

    // 12. Library: characters read per source (top 8 by charsRead)
    const srcWithReads = (state.sources||[]).filter(s=>s.charsRead>0)
      .sort((a,b)=>b.charsRead-a.charsRead).slice(0,8);
    if (srcWithReads.length) {
      const libReadCard = el('div',{class:'card',style:'padding:20px;margin-bottom:16px'});
      libReadCard.appendChild(el('div',{style:'font-weight:800;margin-bottom:4px'},'📚 Characters Read per Library Source'));
      libReadCard.appendChild(el('div',{class:'u-muted-11',style:'margin-bottom:14px'},'High-water mark — estimated chars scrolled into view'));
      const maxCR = srcWithReads[0].charsRead;
      srcWithReads.forEach(src=>{
        const pct=(src.charsRead/maxCR)*100;
        const totalPct=src.content?.length?Math.min(100,Math.round(src.charsRead/src.content.length*100)):0;
        libReadCard.appendChild(el('div',{style:'margin-bottom:10px'},
          el('div',{style:'display:flex;justify-content:space-between;margin-bottom:3px'},
            el('span',{class:'u-muted-11',style:'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70%'},src.name),
            el('span',{style:'font-size:11px;font-weight:700'},`${src.charsRead.toLocaleString()} ch · ${totalPct}%`)
          ),
          el('div',{class:'prog-bar'},el('div',{style:`height:100%;width:${pct}%;background:var(--blue);border-radius:3px`}))
        ));
      });
      sessionCards.push(libReadCard);
    }

    // 13. All-time typing leaderboard (lifetime aggregates from log)
    const quizLog = log.filter(e=>e.mode==='quiz'||e.mode==='gaps');
    if (quizLog.length) {
      const totalKS = quizLog.reduce((a,e)=>a+(e.keystrokes||0),0);
      const totalChars = quizLog.reduce((a,e)=>a+(e.charsTyped||0),0);
      const totalTimeouts = quizLog.reduce((a,e)=>a+(e.timeouts||0),0);
      const totalBackspaces = quizLog.reduce((a,e)=>a+(e.backspaces||0),0);
      const bestWpm = Math.max(...quizLog.map(e=>e.wpm||0));
      const bestKsps = Math.max(...quizLog.map(e=>e.avgKsPerSec||0));
      const lifetimeCard = el('div',{class:'card',style:'padding:20px;margin-bottom:16px'});
      lifetimeCard.appendChild(el('div',{style:'font-weight:800;margin-bottom:14px'},'🏆 Lifetime Typing Stats'));
      const statRows=[
        ['⌨️ Total keystrokes',totalKS.toLocaleString()],
        ['🔡 Total chars submitted',totalChars.toLocaleString()],
        ['🏅 Best WPM',bestWpm>0?`${bestWpm} wpm`:'—'],
        ['⚡ Best KS/s',bestKsps>0?`${bestKsps}`:'—'],
        ['⌫ Total backspaces',totalBackspaces.toLocaleString()],
        ['💀 Total timeouts',totalTimeouts.toLocaleString()],
        ['📋 Quiz sessions logged',quizLog.length],
      ];
      statRows.forEach(([label,val])=>lifetimeCard.appendChild(
        el('div',{style:'display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05)'},
          el('span',{class:'u-muted-11'},label),
          el('span',{style:'font-size:12px;font-weight:800'},val)
        )
      ));
      sessionCards.push(lifetimeCard);
    }

    // 14. Gap-fill breakdown: correct/close/wrong aggregate
    const gapLog = log.filter(e=>e.gapCorrect!=null);
    if (gapLog.length) {
      const gc=gapLog.reduce((a,e)=>a+(e.gapCorrect||0),0);
      const gl=gapLog.reduce((a,e)=>a+(e.gapClose||0),0);
      const gw=gapLog.reduce((a,e)=>a+(e.gapWrong||0),0);
      const gt=gc+gl+gw||1;
      const gapCard=el('div',{class:'card',style:'padding:20px;margin-bottom:16px'});
      gapCard.appendChild(el('div',{style:'font-weight:800;margin-bottom:14px'},'🔠 Gap-Fill Accuracy Breakdown'));
      [{label:'✅ Correct',count:gc,color:'#22c55e'},{label:'🟡 Close',count:gl,color:'#FB923C'},{label:'❌ Wrong',count:gw,color:'#ef4444'}]
        .forEach(s=>{
          const pct=(s.count/gt)*100;
          gapCard.appendChild(el('div',{style:'margin-bottom:10px'},
            el('div',{style:'display:flex;justify-content:space-between;margin-bottom:3px'},
              el('span',{class:'u-muted-11'},s.label),
              el('span',{style:`font-size:11px;font-weight:700;color:${s.color}`},`${s.count} (${Math.round(pct)}%)`)
            ),
            el('div',{class:'prog-bar'},el('div',{style:`height:100%;width:${pct}%;background:${s.color};border-radius:3px`}))
          ));
        });
      sessionCards.push(gapCard);
    }
  }

  c.append(
    el('div',{},el('div',{class:'section-title'},'Analytics'),el('div',{class:'section-sub'},'Your learning performance')),
    statsGrid,heatCard,trendCard,subjectCard,
    ...(readingTimeCard?[readingTimeCard]:[]),
    bottomGrid,
    ...sessionCards
  );
}

const ACHIEVEMENT_DEFS=[
  // Streak tiers
  {id:'streak_7',    name:'Week Warrior',     icon:'🔥',desc:'7-day study streak',      xp:200, goal:7,   check:s=>s.streak>=7},
  {id:'streak_14',   name:'Fortnight Flame',  icon:'🔥',desc:'14-day study streak',     xp:250, goal:14,  check:s=>s.streak>=14},
  {id:'streak_30',   name:'Monthly Master',   icon:'🔥',desc:'30-day study streak',     xp:400, goal:30,  check:s=>s.streak>=30},
  {id:'streak_60',   name:'Two-Month Titan',  icon:'🔥',desc:'60-day study streak',     xp:550, goal:60,  check:s=>s.streak>=60},
  {id:'streak_100',  name:'Century Streak',   icon:'💯',desc:'100-day study streak',    xp:750, goal:100, check:s=>s.streak>=100},
  {id:'streak_150',  name:'Relentless',       icon:'🔥',desc:'150-day study streak',    xp:900, goal:150, check:s=>s.streak>=150},
  {id:'streak_200',  name:'Streak Titan',     icon:'🔥',desc:'200-day study streak',    xp:1000,goal:200, check:s=>s.streak>=200},
  {id:'streak_365',  name:'Year of Fire',     icon:'🎆',desc:'365-day study streak',    xp:1500,goal:365, check:s=>s.streak>=365},
  {id:'streak_500',  name:'Legendary Streak', icon:'👑',desc:'500-day study streak',    xp:2000,goal:500, check:s=>s.streak>=500},
  {id:'streak_1000', name:'Streak Immortal',  icon:'🏆',desc:'1000-day study streak',   xp:3500,goal:1000,check:s=>s.streak>=1000},

  // Card-creation tiers
  {id:'first_card',  name:'First Steps',      icon:'🌱',desc:'Create your first flashcard',xp:50,  goal:1,   check:s=>s.totalCards>=1},
  {id:'ten_cards',   name:'Getting Started',  icon:'📝',desc:'Create 10 flashcards',      xp:100, goal:10,  check:s=>s.totalCards>=10},
  {id:'cards_50',    name:'Card Collector',   icon:'🗃️',desc:'Create 50 flashcards',      xp:250, goal:50,  check:s=>s.totalCards>=50},
  {id:'cards_100',   name:'Flashcard Fanatic',icon:'🎴',desc:'Create 100 flashcards',     xp:450, goal:100, check:s=>s.totalCards>=100},
  {id:'cards_250',   name:'Card Hoarder',     icon:'📦',desc:'Create 250 flashcards',     xp:700, goal:250, check:s=>s.totalCards>=250},
  {id:'cards_500',   name:'Card Architect',   icon:'🏗️',desc:'Create 500 flashcards',     xp:1100,goal:500, check:s=>s.totalCards>=500},
  {id:'cards_1000',  name:'Card Legend',      icon:'👑',desc:'Create 1000 flashcards',    xp:2000,goal:1000,check:s=>s.totalCards>=1000},

  // Review-count tiers
  {id:'century',     name:'Century Club',     icon:'💯',desc:'Review 100 cards',         xp:500, goal:100,  check:s=>s.totalReviews>=100},
  {id:'reviews_500', name:'Dedicated Reviewer',icon:'🔁',desc:'Review 500 cards',        xp:900, goal:500,  check:s=>s.totalReviews>=500},
  {id:'reviews_1000',name:'Review Machine',   icon:'⚙️',desc:'Review 1000 cards',        xp:1400,goal:1000, check:s=>s.totalReviews>=1000},
  {id:'reviews_2500',name:'Review Powerhouse',icon:'💪',desc:'Review 2500 cards',        xp:2200,goal:2500, check:s=>s.totalReviews>=2500},
  {id:'reviews_5000',name:'Review Titan',     icon:'🗿',desc:'Review 5000 cards',        xp:3200,goal:5000, check:s=>s.totalReviews>=5000},
  {id:'reviews_10000',name:'Review Immortal', icon:'🏆',desc:'Review 10,000 cards',      xp:5000,goal:10000,check:s=>s.totalReviews>=10000},

  // Deck-count tiers
  {id:'polyglot',    name:'Polyglot',         icon:'🌍',desc:'Create 3 different decks', xp:150, goal:3,  check:s=>s.totalDecks>=3},
  {id:'decks_5',     name:'Subject Explorer', icon:'🧭',desc:'Create 5 different decks', xp:300, goal:5,  check:s=>s.totalDecks>=5},
  {id:'decks_10',    name:'Curriculum Builder',icon:'📚',desc:'Create 10 different decks',xp:600, goal:10, check:s=>s.totalDecks>=10},
  {id:'decks_20',    name:'Knowledge Architect',icon:'🏛️',desc:'Create 20 different decks',xp:1200,goal:20, check:s=>s.totalDecks>=20},

  // Long-term memory tiers — cards that have graduated to mature (interval>=21d).
  // A durable, one-way count (mature cards don't get "un-matured"), unlike a
  // live retention percentage that can rise and fall day to day.
  {id:'mature_10',   name:'Taking Root',      icon:'🌱',desc:'Grow 10 mature cards',      xp:150, goal:10,  check:s=>s.matureCards>=10},
  {id:'mature_50',   name:'Long-Term Memory', icon:'🌳',desc:'Grow 50 mature cards',      xp:400, goal:50,  check:s=>s.matureCards>=50},
  {id:'mature_200',  name:'Deep Roots',       icon:'🌲',desc:'Grow 200 mature cards',     xp:900, goal:200, check:s=>s.matureCards>=200},
  {id:'mature_500',  name:'Evergreen Mind',   icon:'🏔️',desc:'Grow 500 mature cards',     xp:1800,goal:500, check:s=>s.matureCards>=500},

  // Citation tiers — linking cards back to source material.
  {id:'cite_10',     name:'Scholar',          icon:'📖',desc:'Cite sources on 10 cards',  xp:150, goal:10,  check:s=>s.citedCards>=10},
  {id:'cite_50',     name:'Researcher',       icon:'📚',desc:'Cite sources on 50 cards',  xp:400, goal:50,  check:s=>s.citedCards>=50},
  {id:'cite_150',    name:'Archivist',        icon:'🎓',desc:'Cite sources on 150 cards', xp:900, goal:150, check:s=>s.citedCards>=150},

  // Library tiers — books/PDFs/articles imported as sources.
  {id:'library_1',   name:'Bookworm',         icon:'📥',desc:'Import your first source',  xp:50,  goal:1,  check:s=>s.totalSources>=1},
  {id:'library_10',  name:'Bibliophile',      icon:'📕',desc:'Import 10 sources',         xp:300, goal:10, check:s=>s.totalSources>=10},
  {id:'library_25',  name:'Librarian',        icon:'🏛️',desc:'Import 25 sources',         xp:700, goal:25, check:s=>s.totalSources>=25},

  // Best single-day tiers — a personal record that only ever goes up.
  {id:'bestday_50',  name:'Study Sprint',     icon:'⚡',desc:'Review 50 cards in one day', xp:250, goal:50, check:s=>s.bestDay>=50},
  {id:'bestday_150', name:'Study Surge',      icon:'🌩️',desc:'Review 150 cards in one day',xp:600, goal:150,check:s=>s.bestDay>=150},
  {id:'bestday_300', name:'Marathon Session', icon:'🏃',desc:'Review 300 cards in one day',xp:1200,goal:300,check:s=>s.bestDay>=300},
];

/** Groups ACHIEVEMENT_DEFS into progression tracks for the tiered dot-bar display —
 *  each family is one full-width card with one node per tier, in ascending order. */
const ACHIEVEMENT_FAMILIES=[
  {title:'Day Streaks',      icon:'🔥', statLabel:'day streak',   ids:['streak_7','streak_14','streak_30','streak_60','streak_100','streak_150','streak_200','streak_365','streak_500','streak_1000']},
  {title:'Flashcards Created',icon:'🎴', statLabel:'cards',       ids:['first_card','ten_cards','cards_50','cards_100','cards_250','cards_500','cards_1000']},
  {title:'Cards Reviewed',   icon:'🔁', statLabel:'reviews',      ids:['century','reviews_500','reviews_1000','reviews_2500','reviews_5000','reviews_10000']},
  {title:'Decks Created',    icon:'📚', statLabel:'decks',        ids:['polyglot','decks_5','decks_10','decks_20']},
  {title:'Mature Cards',     icon:'🌳', statLabel:'mature cards', ids:['mature_10','mature_50','mature_200','mature_500']},
  {title:'Cited Cards',      icon:'📖', statLabel:'cited cards',  ids:['cite_10','cite_50','cite_150']},
  {title:'Library Sources',  icon:'📥', statLabel:'sources',      ids:['library_1','library_10','library_25']},
  {title:'Best Study Day',   icon:'⚡', statLabel:'cards in a day',ids:['bestday_50','bestday_150','bestday_300']},
];

/** Pure snapshot of the numbers ACHIEVEMENT_DEFS' check() functions read —
 *  shared by the (now manual) claim flow and the Achievements tab render. */
function computeAchievementStats() {
  const allCards=state.decks.flatMap(d=>d.cards);
  const totalRev=state.reviewHistory.reduce((a,r)=>a+(r.total||0),0);
  const matureCards=allCards.filter(c=>c.interval>=21).length;
  const citedCards=allCards.filter(c=>c.citation).length;
  const totalSources=state.sources.length;
  const bestDay=state.reviewHistory.reduce((m,r)=>Math.max(m,r.total||0),0);
  return {totalCards:allCards.length,totalDecks:state.decks.length,streak:state.streak,totalReviews:totalRev,matureCards,citedCards,totalSources,bestDay};
}

// Achievements used to be auto-detected-and-awarded from many call sites scattered
// across the app (bootstrap, capture, decks, study). That background approach kept
// silently losing progress. Achievements are now claimed manually from the Quests >
// Achievements tab (see claimAchievement() below), so this no longer needs to do
// anything — kept as a no-op so the existing call sites don't need to be touched.
function checkAchievements() {}

/** Toasts a heads-up on dashboard load if any achievements are sitting there ready
 *  to claim, so the manual-claim flow doesn't silently go unnoticed. */
function notifyClaimableAchievements() {
  const s=computeAchievementStats();
  const claimableCount=ACHIEVEMENT_DEFS.filter(a=>!state.achievements.includes(a.id)&&a.check(s)).length;
  if(claimableCount>0){
    showToast(
      `🏆 ${claimableCount} achievement${claimableCount===1?'':'s'} ready to claim!`,
      4000,
      { label:'View', onClick:()=>navigate('quests') }
    );
  }
}

/** Manually claim an eligible-but-unclaimed achievement. Called from a "Claim"
 *  button in the Achievements tab — no background process required. */
function claimAchievement(id) {
  const a=ACHIEVEMENT_DEFS.find(d=>d.id===id);
  if(!a || state.achievements.includes(a.id)) return;
  const s=computeAchievementStats();
  if(!a.check(s)) return; // guard against a stale button click
  state.achievements.push(a.id);
  addXP(a.xp);
  showToast(`Achievement claimed: ${a.name} ${a.icon} +${a.xp} XP`);
  scheduleSave();
}

let _lastQuestsTab = 'quests';
function renderQuests(c) {
  const totalXP=state.trackerState?.totalXP||0;
  const {level,xpIntoLevel,xpForNextLevel}=levelFromXP(totalXP);
  const allCards=state.decks.flatMap(d=>d.cards);
  const todayEntry=state.reviewHistory.find(r=>r.date===today());
  const todayStart=new Date(today()).getTime();
  const decksTouchedToday=new Set(state.decks.filter(d=>d.cards.some(c=>c.lastRated&&c.lastRated>=todayStart)).map(d=>d.id)).size;
  const matureCount=allCards.filter(c=>c.interval>=21).length;
  const citedCount=allCards.filter(c=>c.citation).length;
  const QUEST_DEFS=[
    {id:'daily_review',name:'Daily Review',   desc:'Review 20 cards today',          goal:20,icon:'📚',xp:100,prog:(todayEntry?.total||0)},
    {id:'daily_create', name:'Card Creator',   desc:'Create 5 new cards',             goal:5, icon:'✏️',xp:75, prog:allCards.filter(c=>c.created>=todayStart).length},
    {id:'daily_accuracy',name:'Sharp Mind',    desc:'Get 90%+ accuracy on 10+ reviews today', goal:1, icon:'🎯',xp:120,
      prog:(todayEntry&&todayEntry.total>=10&&(todayEntry.correct/todayEntry.total)>=0.9)?1:0},
    {id:'daily_spread', name:'Well Rounded',   desc:'Review cards from 3 different decks today', goal:3, icon:'🗂️',xp:90, prog:decksTouchedToday},
    {id:'weekly_streak', name:'Stay on Track', desc:'Keep a 3-day study streak',      goal:3, icon:'🔥',xp:150, prog:Math.min(state.streak,3)},
    {id:'mature_grower', name:'Long-Term Memory', desc:'Grow your mature cards to 50', goal:50,icon:'🌳',xp:200, prog:matureCount},
    {id:'citation_quest',name:'Cite Your Sources', desc:'Add citations to 10 cards',  goal:10,icon:'📖',xp:80, prog:citedCount},
  ];

  const levelCard=el('div',{class:'card glow',style:'padding:24px;margin-bottom:20px;display:flex;align-items:center;gap:20px'},
    el('div',{style:'width:70px;height:70px;border-radius:16px;background:var(--grad);display:flex;align-items:center;justify-content:center;font-size:32px;flex-shrink:0'},'⭐'),
    el('div',{style:'flex:1'},
      el('div',{style:'display:flex;align-items:center;gap:10px;margin-bottom:4px'},
        el('div',{style:'font-weight:900;font-size:20px'},`Level ${level}`),
        mkTag(level>=10?'Master':level>=5?'Expert':'Learner','var(--blue)')
      ),
      el('div',{style:'font-size:13px;color:var(--muted);margin-bottom:10px'},`${fmtXP(totalXP)} total XP`),
      el('div',{style:'display:flex;align-items:center;gap:8px'},
        el('span',{style:'font-size:11px;color:var(--blue);font-weight:700'},`Lv.${level}`),
        el('div',{style:'flex:1;height:6px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden'},
          el('div',{style:`height:100%;width:${Math.min(100,(xpIntoLevel/xpForNextLevel)*100)}%;background:var(--grad);border-radius:3px`})
        ),
        el('span',{style:'font-size:10px;color:var(--muted)'},`${fmtXP(xpIntoLevel)}/${fmtXP(xpForNextLevel)}`)
      )
    ),
    el('div',{style:'text-align:center'},el('div',{style:'font-size:36px'},'🔥'),el('div',{style:'font-weight:900;font-size:22px;color:#FB923C'},String(state.streak)),el('div',{style:'font-size:10px;color:var(--muted)'},'DAY STREAK'))
  );

  const tabBar=el('div',{class:'tab-bar'});
  let activeTab=_lastQuestsTab;
  const contentEl=el('div',{});

  function renderTab(){
    contentEl.innerHTML='';
    if(activeTab==='quests'){
      QUEST_DEFS.forEach(q=>{
        const pct=Math.min(100,(q.prog/q.goal)*100), done=q.prog>=q.goal;
        contentEl.appendChild(el('div',{class:`card quest-item${done?' glow':''}`,style:'padding:20px;margin-bottom:12px'},
          el('div',{style:'display:flex;align-items:center;gap:14px'},
            el('div',{style:`width:44px;height:44px;border-radius:12px;${done?'background:var(--grad)':'background:rgba(255,255,255,0.06)'};display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0`},done?'✅':q.icon),
            el('div',{style:'flex:1'},
              el('div',{style:'display:flex;justify-content:space-between'},el('div',{style:'font-weight:800;font-size:14px'},q.name),el('span',{style:'font-size:12px;color:#FBBF24;font-weight:700'},`+${q.xp} XP`)),
              el('div',{style:'font-size:12px;color:var(--muted);margin-bottom:8px'},q.desc),
              el('div',{class:'prog-bar'},el('div',{class:'prog-fill',style:`width:${pct}%${done?';background:linear-gradient(90deg,#22c55e,#4ade80)':''}`})),
              el('div',{style:'font-size:11px;color:var(--muted);margin-top:3px'},`${q.prog}/${q.goal}${done?' — Completed! 🎉':''}`)
            )
          )
        ));
      });
    }
    if(activeTab==='achievements'){
      const s=computeAchievementStats();
      const wrap=el('div',{style:'display:flex;flex-direction:column;gap:14px'});
      ACHIEVEMENT_FAMILIES.forEach(fam=>{
        const defs=fam.ids.map(id=>ACHIEVEMENT_DEFS.find(d=>d.id===id));
        const claimedCount=defs.filter(a=>state.achievements.includes(a.id)).length;
        const track=el('div',{class:'tier-track'});
        defs.forEach((a,i)=>{
          const claimed=state.achievements.includes(a.id);
          const claimable=!claimed&&a.check(s);
          if(i>0){
            const prevClaimed=state.achievements.includes(defs[i-1].id);
            track.appendChild(el('div',{class:`tier-line${prevClaimed?' filled':''}`}));
          }
          const nodeAttrs={
            class:`tier-node${claimed?' claimed':''}${claimable?' claimable':''}`,
            title:`${a.name} — ${a.desc} (+${a.xp} XP)${claimed?' · Claimed':claimable?' · Ready to claim!':''}`,
          };
          if(claimable) nodeAttrs.onclick=()=>{ claimAchievement(a.id); renderView('quests'); };
          track.appendChild(el('div',{class:'tier-step'},
            el('div',nodeAttrs, claimed?'✓':''),
            el('div',{class:'tier-goal-label'}, String(a.goal))
          ));
        });
        wrap.appendChild(el('div',{class:`card${claimedCount===defs.length?' glow':''}`,style:'padding:20px 24px;width:100%;box-sizing:border-box'},
          el('div',{style:'display:flex;align-items:center;justify-content:space-between;margin-bottom:2px'},
            el('div',{style:'display:flex;align-items:center;gap:10px'},
              el('span',{style:'font-size:20px'},fam.icon),
              el('span',{style:'font-weight:800;font-size:14px'},fam.title)
            ),
            mkTag(`${claimedCount}/${defs.length} claimed`, claimedCount===defs.length?'#22c55e':'var(--blue)')
          ),
          el('div',{style:'font-size:11px;color:var(--muted);margin-bottom:4px'},`Progress in ${fam.statLabel}`),
          track
        ));
      });
      contentEl.appendChild(wrap);
    }
  }

  [['quests','🎯 Quests'],['achievements','🏆 Achievements']].forEach(([id,label])=>{
    const b=el('button',{class:`tab-btn${activeTab===id?' active':''}`,onclick:()=>{ activeTab=id; _lastQuestsTab=id; tabBar.querySelectorAll('.tab-btn').forEach(tb=>tb.classList.toggle('active',tb===b)); renderTab(); }},label);
    tabBar.appendChild(b);
  });
  renderTab();
  c.append(el('div',{},el('div',{class:'section-title'},'Quests & Achievements'),el('div',{class:'section-sub'},'Level up your learning journey')),levelCard,tabBar,contentEl);
}
