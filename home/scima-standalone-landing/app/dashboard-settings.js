'use strict';
/* dashboard-settings.js — the entire Settings view (SRS algorithm, theme,
   accessibility, data import/export, etc.) — one large self-contained
   function. Part of the dashboard-*.js split; see dashboard-core.js's header
   for the full rationale and load-order rules.

   SITE PORT NOTES: this is the flashcard-side Settings only — the Mark
   Tracker has its own separate Tracker Settings view (renderTrackerSettings
   in dashboard-tracker.js, not ported here; still stubbed). One chrome
   dependency removed: Clear All Data's chrome.storage.local.remove('mf_state')
   call — the site build has no chrome.storage.local to begin with (see
   isExtension in dashboard-core.js), so that branch never ran on the site
   anyway; the localStorage.removeItem('mf_state') branch below it (which
   the extension itself also runs, since Phase 0 moved all reads/writes to
   localStorage-first — see dashboard-core.js's storage-adapter comment) is
   unchanged and is what actually clears the site's data. Also requires
   shared/translate-shared.js (LANGS/translateText/fetchPinyin — used by the
   Define Target Language dropdown here, and by Library's Smart Define
   feature) to be loaded before dashboard-core.js; see dashboard.html's
   script order. */

function renderSettings(c) {
  function makeToggle(label,desc,key){
    const knob=el('div',{class:'toggle-knob'});
    const sw=el('button',{class:`toggle${state.settings[key]?' on':''}`,onclick:()=>{
      state.settings[key]=!state.settings[key];
      sw.classList.toggle('on',state.settings[key]);
      if(key==='powerSaving') document.documentElement.classList.toggle('power-saving',state.settings[key]);
      if(key==='dyslexia') document.documentElement.classList.toggle('dyslexia-mode',state.settings[key]);
      if(key==='highContrast') document.documentElement.classList.toggle('a11y-high-contrast',state.settings[key]);
      scheduleSave();
    }},knob);
    return el('div',{class:'toggle-row'},el('div',{class:'toggle-info'},el('div',{class:'toggle-label'},label),desc?el('div',{class:'toggle-desc'},desc):null),sw);
  }
  function makeRange(label,key,min,max,color){
    const valSpan=el('span',{},String(state.settings[key]||0));
    const input=el('input',{type:'range',min:String(min),max:String(max),value:String(state.settings[key]),style:`accent-color:${color}`,oninput:e=>{ state.settings[key]=Number(e.target.value); valSpan.textContent=e.target.value; scheduleSave(); }});
    return el('div',{style:'padding:14px 0;border-bottom:1px solid rgba(255,255,255,0.05)'},el('div',{style:'font-size:13px;font-weight:600;margin-bottom:2px;display:flex;gap:6px'},label,valSpan),input);
  }

  const grid=el('div',{class:'grid-2'});
  const helpCard=el('div',{class:'card',style:'padding:20px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap'},
    el('div',{},
      el('div',{style:'font-weight:800;margin-bottom:4px'},'❓ Help'),
      el('div',{style:'font-size:12px;color:var(--muted)'},'Rewatch the guided walkthrough of decks, flashcards, studying, the sidebar, and shortcuts.')
    ),
    btn('Replay tutorial','primary',{onclick:()=>startTutorial(0)})
  );
  const aiCard=el('div',{class:'card',style:'padding:20px'},el('div',{style:'font-weight:800;margin-bottom:14px;color:var(--blue)'},'🤖 Algorithm & Notifications'));
  const algoSel=el('select',{class:'u-input',onchange:e=>{ state.settings.algorithm=e.target.value; scheduleSave(); }});
  [['fsrs','FSRS (Recommended)'],['sm2','SM-2 (Classic)']].forEach(([v,t])=>{ const o=el('option',{value:v,class:'u-bg'},t); if(state.settings.algorithm===v)o.selected=true; algoSel.appendChild(o); });
  aiCard.append(
    el('div',{style:'padding:14px 0;border-bottom:1px solid rgba(255,255,255,0.05)'},el('div',{style:'font-size:13px;font-weight:600;margin-bottom:8px'},'SRS Algorithm'),algoSel),
    makeToggle('Auto-suspend leeches','Suspend cards after too many lapses','autoSuspend'),
    makeToggle('Text-to-Speech','Read cards aloud during study','tts'),
    makeToggle('Push Notifications','Daily review reminders','notifications'),
    makeToggle('Power Saving Mode','Disables animations and visual effects for better performance','powerSaving')
  );

  const llmCard=el('div',{class:'card',style:'padding:20px;margin-top:16px'},
    el('div',{style:'font-weight:800;margin-bottom:4px;color:var(--blue)'},'✨ AI Card Generation'),
    el('div',{style:'font-size:12px;color:var(--muted);margin-bottom:14px'},'Generate flashcards from pasted text using a local LLM server on your own machine — nothing is sent to a hosted API, and there\u2019s no API key to store. Works with '+'LM Studio, Ollama\u2019s OpenAI-compatible endpoint, llama.cpp server, or anything else that speaks the OpenAI chat-completions format.')
  );
  const endpointInput=el('input',{type:'text',class:'u-input',placeholder:'http://127.0.0.1:1234',value:state.settings.aiEndpoint||'',
    oninput:e=>{ state.settings.aiEndpoint=e.target.value.trim(); scheduleSave(); }});
  const modelInput=el('input',{type:'text',class:'u-input',placeholder:'Leave blank to use whatever model is currently loaded',value:state.settings.aiModel||'',
    oninput:e=>{ state.settings.aiModel=e.target.value.trim(); scheduleSave(); }});
  const testStatus=el('div',{style:'font-size:12px;margin-top:8px'});
  const testBtn=btn('Test Connection','ghost',{onclick:async()=>{
    testBtn.disabled=true; const prevText=testBtn.textContent; testBtn.textContent='Testing…';
    testStatus.textContent=''; testStatus.style.color='var(--muted)';
    const result=await testAIConnection();
    testBtn.disabled=false; testBtn.textContent=prevText;
    if(result.ok){
      testStatus.style.color='#22c55e';
      testStatus.textContent=`✓ Connected${result.model?` — loaded model: ${result.model}`:''}`;
    } else {
      testStatus.style.color='#ef4444';
      testStatus.textContent=`✕ ${result.error}`;
    }
  }});
  llmCard.append(
    el('div',{style:'padding:14px 0;border-bottom:1px solid rgba(255,255,255,0.05)'},
      el('div',{style:'font-size:13px;font-weight:600;margin-bottom:6px'},'Server Address'),
      endpointInput
    ),
    el('div',{style:'padding:14px 0;border-bottom:1px solid rgba(255,255,255,0.05)'},
      el('div',{style:'font-size:13px;font-weight:600;margin-bottom:6px'},'Model ID (optional)'),
      modelInput
    ),
    el('div',{style:'padding-top:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap'},testBtn,testStatus)
  );

  const studyCard=el('div',{class:'card',style:'padding:20px'},el('div',{style:'font-weight:800;margin-bottom:14px;color:var(--pink)'},'📚 Study & Accessibility'));
  const defineLangSel=el('select',{class:'u-input',onchange:e=>{ state.settings.defineLang=e.target.value; scheduleSave(); }});
  Object.entries(LANGS).forEach(([code,name])=>{ const o=el('option',{value:code,class:'u-bg'},name); if((state.settings.defineLang||'en')===code)o.selected=true; defineLangSel.appendChild(o); });
  studyCard.append(
    el('div',{style:'padding:14px 0;border-bottom:1px solid rgba(255,255,255,0.05)'},
      el('div',{style:'font-size:13px;font-weight:600;margin-bottom:2px'},'🔍 Define Target Language'),
      el('div',{style:'font-size:11px;color:var(--muted);margin-bottom:8px'},'Smart Definition translates terms into this language if they aren\u2019t already in it'),
      defineLangSel
    ),
    makeToggle('🀄 Show Pinyin','Display Mandarin pinyin when selecting Chinese characters while reading','showPinyin'),
    makeToggle('🔤 Single-Word Definitions','For a single word in a spaced script (Latin, Cyrillic, Arabic, etc.), show a definition in its own language instead of translating it','singleWordDefinition'),
    makeToggle('🔠 Dyslexia-Friendly Mode','Wider letter/word/line spacing and an evenly-spaced font throughout the app','dyslexia'),
    makeToggle('◐ High Contrast','Boost text contrast and border visibility on top of your current theme','highContrast'),
    (()=>{
      const wrap=el('div',{style:'display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid var(--border);margin-top:4px'});
      const lbl=el('div',{},
        el('div',{style:'font-size:13px;font-weight:600'},'🔖 Open book at…'),
        el('div',{style:'font-size:11px;color:var(--muted);margin-top:2px'},'Where to resume when re-opening a source')
      );
      const sel=el('select',{style:'padding:5px 10px;border-radius:7px;background:rgba(255,255,255,0.06);border:1px solid var(--border);color:var(--text);font-size:12px;font-family:inherit;cursor:pointer'});
      [['auto','Last position (auto)'],['manual','Furthest manual bookmark']].forEach(([v,t])=>{
        const o=el('option',{value:v,class:'u-bg'},t);
        if((state.settings.bookmarkRestore||'auto')===v) o.selected=true;
        sel.appendChild(o);
      });
      sel.addEventListener('change',()=>{ state.settings.bookmarkRestore=sel.value; scheduleSave(); });
      wrap.append(lbl,sel);
      return wrap;
    })(),
    makeRange('Daily Review Goal: ','dailyGoal',5,100,'var(--blue)'),makeRange('New Cards Per Day: ','newCardsPerDay',1,50,'var(--pink)'),makeRange('Leech Threshold: ','leechThreshold',3,20,'#FB923C'));
  grid.append(aiCard,studyCard);

  const dataCard=el('div',{class:'card',style:'padding:20px;margin-top:16px'},
    el('div',{style:'font-weight:800;margin-bottom:6px'},'💾 Data Management'),
    el('div',{style:'font-size:12px;color:var(--muted);margin-bottom:14px'},`${state.decks.length} decks · ${state.decks.flatMap(d=>d.cards).length} cards · ${state.sources.length} sources · ${state.folders.length} folders`)
  );
  const btnRow=el('div',{style:'display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px'});

  btnRow.appendChild(btn('📤 Export All Data (.zip)','ghost',{onclick:()=>{ exportAllDataZip(); }}));
  btnRow.appendChild(btn('📦 Export Decks Only','ghost',{onclick:()=>{
    const a=document.createElement('a');
    const citedSourceIds=new Set(state.decks.flatMap(d=>d.cards).map(c=>c.citation?.sourceId).filter(Boolean));
    const citedSources=(state.sources||[]).filter(s=>citedSourceIds.has(s.id));
    function resolveDecks(decks){
      return decks.map(d=>({...d,cards:d.cards.map(c=>{
        if(!c.citation)return c;
        const src=citedSources.find(s=>s.id===c.citation.sourceId);
        const chap=c.citation.chapterId&&src?.chapters?.find(ch=>ch.id===c.citation.chapterId);
        const excerpt=src?src.content.slice(c.citation.charStart,c.citation.charEnd):'';
        return {...c,citation:{...c.citation,sourceName:src?.name||null,chapterTitle:chap?.title||null,excerpt:excerpt||null}};
      })}));
    }
    a.href='data:application/json,'+encodeURIComponent(JSON.stringify({version:2,decks:resolveDecks(state.decks),folders:state.folders,citedSources},null,2));
    a.download=`SCIMA-decks-${today()}.json`; a.click();
  }}));

  const importInput=el('input',{type:'file',accept:'.zip,.json',style:'display:none',onchange:async e=>{
    const file=e.target.files?.[0]; if(!file)return;
    try{
      let data, pdfFiles={}, htmlFiles={};
      if(file.name.toLowerCase().endsWith('.zip')){
        const buf=new Uint8Array(await file.arrayBuffer());
        const unzipped=fflate.unzipSync(buf);
        const dataBytes=unzipped['data.json'];
        if(!dataBytes) throw new Error('data.json not found in archive');
        data=JSON.parse(new TextDecoder().decode(dataBytes));
        Object.keys(unzipped).forEach(name=>{
          if(name.startsWith('pdf/')&&name.endsWith('.pdf')) pdfFiles[name.slice(4,-4)]=unzipped[name];
          if(name.startsWith('html/')&&name.endsWith('.json')) htmlFiles[name.slice(5,-5)]=unzipped[name];
        });
      } else {
        data=JSON.parse(await file.text());
      }

      openModal('Import Data', body=>{
        const deckCount=data.decks?.length||0, folderCount=data.folders?.length||0, sourceCount=data.sources?.length||0;
        const libFolderCount=data.libraryFolders?.length||0, pdfCount=Object.keys(pdfFiles).length, htmlCount=Object.keys(htmlFiles).length;
        body.appendChild(el('div',{style:'padding:14px;border-radius:10px;background:rgba(var(--blue-rgb),0.08);border:1px solid rgba(var(--blue-rgb),0.2);margin-bottom:16px'},
          el('div',{style:'font-weight:700;color:var(--blue);margin-bottom:8px'},'📦 Import Contents'),
          deckCount?el('div',{class:'u-muted-12'},`📚 ${deckCount} deck${deckCount!==1?'s':''}`):'',
          folderCount?el('div',{class:'u-muted-12'},`📁 ${folderCount} folder${folderCount!==1?'s':''}`):'',
          sourceCount?el('div',{class:'u-muted-12'},`📖 ${sourceCount} source${sourceCount!==1?'s':''}`):'',
          libFolderCount?el('div',{class:'u-muted-12'},`🗂️ ${libFolderCount} library folder${libFolderCount!==1?'s':''}`):'',
          pdfCount?el('div',{class:'u-muted-12'},`📄 ${pdfCount} PDF${pdfCount!==1?'s':''} bundled`):'',
          htmlCount?el('div',{class:'u-muted-12'},`🖼️ ${htmlCount} illustrated book${htmlCount!==1?'s':''} bundled`):'',
          data.reviewHistory?el('div',{class:'u-muted-12'},'📅 Review history included'):'',
          data.trackerState?el('div',{class:'u-muted-12'},'⭐ XP/tracker data included'):'',
          data.streak!==undefined?el('div',{class:'u-muted-12'},'🔥 Streak included'):'',
          data.settings?el('div',{class:'u-muted-12'},'⚙️ Settings/preferences included'):'',
          data.settings?.theme?el('div',{class:'u-muted-12'},'🎨 Appearance/theme included'):''
        ));

        async function restoreBinaries(){
          for(const [srcId,bytes] of Object.entries(pdfFiles)){
            let bin=''; const CH=8192; for(let i=0;i<bytes.length;i+=CH) bin+=String.fromCharCode(...bytes.subarray(i,i+CH));
            await writePdfChunks(srcId, 'data:application/pdf;base64,'+btoa(bin));
          }
          for(const [srcId,bytes] of Object.entries(htmlFiles)){
            try{ await saveHtmlChapters(srcId, JSON.parse(new TextDecoder().decode(bytes))); }
            catch(e){ console.warn(`[SCIMA] import: failed to restore HTML/EPUB content for source ${srcId} — the source entry exists but its content will be empty:`, e); }
          }
        }

        body.append(
          btn('Merge (keep existing + add imported)','primary',{full:true,onclick:async ()=>{
            const mf = sanitizeMfState(data);
            if(data.decks){ const ids=new Set(state.decks.map(d=>d.id)); state.decks.push(...mf.decks.filter(d=>!ids.has(d.id))); }
            if(data.folders){ const ids=new Set(state.folders.map(f=>f.id)); state.folders.push(...mf.folders.filter(f=>!ids.has(f.id))); }
            if(data.libraryFolders){ if(!state.libraryFolders)state.libraryFolders=[]; const ids=new Set(state.libraryFolders.map(f=>f.id)); state.libraryFolders.push(...mf.libraryFolders.filter(f=>!ids.has(f.id))); }
            if(data.sources){ const ids=new Set(state.sources.map(s=>s.id)); state.sources.push(...mf.sources.filter(s=>!ids.has(s.id))); }
            if(data.recentStudyScopes){ const keys=new Set(state.recentStudyScopes.map(r=>r.key)); state.recentStudyScopes.push(...mf.recentStudyScopes.filter(r=>!keys.has(r.key))); }
            // reviewHistory entries are keyed by date — keep the existing entry for any
            // date already present locally, and only add dates the import doesn't overlap.
            if(data.reviewHistory){ if(!state.reviewHistory)state.reviewHistory=[]; const dates=new Set(state.reviewHistory.map(r=>r.date)); state.reviewHistory.push(...mf.reviewHistory.filter(r=>!dates.has(r.date))); }
            // achievements are plain unlocked-id strings — union, don't overwrite.
            if(data.achievements){ if(!state.achievements)state.achievements=[]; const ids=new Set(state.achievements); mf.achievements.forEach(a=>{ if(!ids.has(a)){ state.achievements.push(a); ids.add(a); } }); }
            if(data.settings) Object.assign(state.settings, mf.settings);
            // Daily streak: was previously dropped entirely on Merge (even though the
            // export includes it) — keep whichever side's lastStreakDate is more
            // recent, so a fresher local streak isn't clobbered by an older backup
            // and vice versa; fall back to the higher count if dates tie or are missing.
            if(data.streak!==undefined || data.lastStreakDate!==undefined){
              const importedIsFresher = mf.lastStreakDate && (!state.lastStreakDate || mf.lastStreakDate > state.lastStreakDate);
              if(importedIsFresher){ state.streak=mf.streak; state.lastStreakDate=mf.lastStreakDate; }
              else if(!state.lastStreakDate && !mf.lastStreakDate){ state.streak=Math.max(state.streak||0, mf.streak||0); }
            }
            // Was previously silently dropped on import even though the export
            // includes it (and the summary above literally says "XP/tracker data
            // included") — now a real merge (see mergeTrackerState in shared.js)
            // instead of a blind overwrite, so existing Mark Tracker progress
            // (subject XP/marks, predicted grades, streak) is combined with the
            // imported backup rather than replaced by it.
            if(data.trackerState) state.trackerState=mergeTrackerState(state.trackerState, data.trackerState);
            await restoreBinaries();
            tickThemeSchedule(); scheduleSave(); closeModal(); renderView('settings'); renderSidebar(); showToast('Data merged ✓');
          }}),
          btn('Replace (overwrite all existing data)','danger',{full:true,onclick:async ()=>{
            if(!confirm('Replace ALL your existing data?'))return;
            const mf = sanitizeMfState(data);
            if(data.decks)state.decks=mf.decks; if(data.folders)state.folders=mf.folders;
            if(data.libraryFolders)state.libraryFolders=mf.libraryFolders;
            if(data.sources)state.sources=mf.sources; if(data.reviewHistory)state.reviewHistory=mf.reviewHistory;
            if(data.achievements)state.achievements=mf.achievements; if(data.settings)Object.assign(state.settings,mf.settings);
            if(data.streak!==undefined)state.streak=mf.streak; if(data.lastStreakDate!==undefined)state.lastStreakDate=mf.lastStreakDate;
            if(data.recentStudyScopes)state.recentStudyScopes=mf.recentStudyScopes;
            // Same fix as Merge above: this was silently dropped despite being exported.
            if(data.trackerState) state.trackerState=sanitizeState(data.trackerState);
            await restoreBinaries();
            tickThemeSchedule(); scheduleSave(); closeModal(); renderView('settings'); renderSidebar(); showToast('Data replaced ✓');
          }})
        );
      });
    }catch(err){ showToast('Could not read file: '+(err?.message||String(err))); }
    importInput.value='';
  }});
  btnRow.appendChild(btn('📥 Import','ghost',{onclick:()=>importInput.click()}));
  dataCard.append(btnRow, importInput,
    el('div',{style:'padding-top:14px;border-top:1px solid rgba(255,255,255,0.05)'},
      btn('🗑️ Clear All Data','danger',{onclick:()=>{
        if(confirm('Delete ALL flashcard data? This cannot be undone.')){
          try{localStorage.removeItem('mf_state');}catch(e){ console.warn('[SCIMA] Clear All Data: localStorage.removeItem failed:', e); }
          location.reload();
        }
      }})
    )
  );
  // ── Theme Schedule ────────────────────────────────────────────────────────
  // Timed automatic theme switching. Three modes:
  //  daily  — same time-slots repeat every day
  //  weekly — different slots per weekday (great for "lighter on weekends")
  //  sun    — switch at sunrise/sunset with per-slot offsets (uses browser geolocation)
  const sched = state.settings.themeSchedule || DEFAULT_SCHEDULE;

  const schedCard = el('div', { class:'card', style:'padding:20px;margin-top:16px' });
  schedCard.appendChild(el('div', { style:'font-weight:800;margin-bottom:4px' }, '🕐 Theme Schedule'));
  schedCard.appendChild(el('div', { style:'font-size:12px;color:var(--muted);margin-bottom:14px' }, 'Automatically switch themes at set times or based on sunrise/sunset.'));

  // Enable toggle
  const schedKnob = el('div', { class:'toggle-knob' });
  const schedSw   = el('button', { class:`toggle${sched.enabled?' on':''}`, onclick: () => {
    sched.enabled = !sched.enabled;
    schedSw.classList.toggle('on', sched.enabled);
    scheduleSave(); tickThemeSchedule(); renderSchedBody();
  }}, schedKnob);
  schedCard.appendChild(el('div', { class:'toggle-row', style:'margin-bottom:14px' },
    el('div', { class:'toggle-info' }, el('div', { class:'toggle-label' }, 'Enable scheduling'), el('div', { class:'toggle-desc' }, 'Override manual theme at set times')),
    schedSw
  ));

  // Mode selector tabs
  const modeBar = el('div', { style:'display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap' });
  [['daily','📅 Daily'],['weekly','🗓 Weekly'],['sun','🌅 Sunrise/Sunset']].forEach(([m,label]) => {
    const b = el('button', { class:`btn btn-sm ${sched.mode===m?'btn-primary':'btn-ghost'}`, onclick:()=>{
      sched.mode = m; scheduleSave(); tickThemeSchedule(); renderSchedBody();
    }}, label);
    modeBar.appendChild(b);
  });
  schedCard.appendChild(modeBar);

  const schedBody = el('div');
  schedCard.appendChild(schedBody);

  // ── Shared helpers ───────────────────────────────────────────────────────
  const PRESET_OPTIONS = getAllPresets().map(({ key, name }) => [key, name]);

  function makePresetSel(currentKey, onChange) {
    const s = el('select', { style:'padding:6px 10px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid var(--border);color:var(--text);font-size:12px;font-family:inherit;outline:none', onchange: e => onChange(e.target.value) });
    PRESET_OPTIONS.forEach(([k,name]) => { const o = el('option',{value:k,class:'u-bg'},name); if(k===currentKey)o.selected=true; s.appendChild(o); });
    return s;
  }

  function makeTimePicker(val, onChange) {
    return el('input',{type:'time',value:val||'08:00',style:'padding:6px 10px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:var(--text);font-size:12px;font-family:inherit;outline:none',onchange:e=>onChange(e.target.value)});
  }

  function makeSlotRow(slot, onDelete, onChange) {
    const swatch = el('span', { style:`width:18px;height:18px;border-radius:4px;background:linear-gradient(135deg,${(THEME_PRESETS[slot.presetKey]||THEME_PRESETS.default).blue||'#5BCEFA'},${(THEME_PRESETS[slot.presetKey]||THEME_PRESETS.default).pink||'#F5A9B8'});display:inline-block;flex-shrink:0;border:1px solid rgba(255,255,255,0.15)` });
    const timePick = makeTimePicker(slot.time, v => { slot.time = v; scheduleSave(); tickThemeSchedule(); swatch.style.background = `linear-gradient(135deg,${(THEME_PRESETS[slot.presetKey]||THEME_PRESETS.default).blue},${(THEME_PRESETS[slot.presetKey]||THEME_PRESETS.default).pink})`; });
    const presetSel = makePresetSel(slot.presetKey, k => { slot.presetKey = k; scheduleSave(); tickThemeSchedule(); swatch.style.background = `linear-gradient(135deg,${(THEME_PRESETS[k]||THEME_PRESETS.default).blue},${(THEME_PRESETS[k]||THEME_PRESETS.default).pink})`; });
    const del = el('button', { class:'btn btn-ghost btn-sm', style:'padding:3px 8px;color:var(--muted)', title:'Remove slot', onclick:onDelete }, '×');
    return el('div', { style:'display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid var(--border)' }, swatch, timePick, presetSel, del);
  }

  function addSlotBtn(onClick) {
    return btn('+ Add Slot', 'ghost', { onclick: onClick, style:'margin-top:4px;width:100%' });
  }

  // ── Mode renderers ───────────────────────────────────────────────────────
  function renderSchedBody() {
    schedBody.innerHTML = '';
    if (!sched.enabled) {
      schedBody.appendChild(el('div', { style:'font-size:12px;color:var(--muted);padding:6px 0' }, 'Enable scheduling above to configure time slots.'));
      return;
    }

    if (sched.mode === 'daily') {
      if (!sched.daily) sched.daily = [...DEFAULT_SCHEDULE.daily];
      const slotList = el('div');
      const refresh = () => {
        slotList.innerHTML = '';
        [...sched.daily].sort((a,b) => hhmm2min(a.time)-hhmm2min(b.time)).forEach((slot,i) => {
          slotList.appendChild(makeSlotRow(slot,
            () => { sched.daily.splice(sched.daily.indexOf(slot),1); scheduleSave(); tickThemeSchedule(); refresh(); },
            () => {}
          ));
        });
      };
      refresh();
      schedBody.append(slotList, addSlotBtn(() => {
        sched.daily.push({ time:'12:00', presetKey:'light' });
        scheduleSave(); tickThemeSchedule(); refresh();
      }));
    }

    else if (sched.mode === 'weekly') {
      if (!sched.weekly) sched.weekly = { ...DEFAULT_SCHEDULE.weekly };
      const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      DAY_NAMES.forEach((dayName, d) => {
        if (!sched.weekly[d]) sched.weekly[d] = [];
        const daySection = el('div', { style:'margin-bottom:12px' });
        daySection.appendChild(el('div', { style:'font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);margin-bottom:6px' }, dayName));
        const slotList = el('div');
        const refresh = () => {
          slotList.innerHTML = '';
          [...sched.weekly[d]].sort((a,b)=>hhmm2min(a.time)-hhmm2min(b.time)).forEach(slot => {
            slotList.appendChild(makeSlotRow(slot,
              () => { sched.weekly[d].splice(sched.weekly[d].indexOf(slot),1); scheduleSave(); tickThemeSchedule(); refresh(); },
              () => {}
            ));
          });
          if (!sched.weekly[d].length) slotList.appendChild(el('div',{style:'font-size:11px;color:var(--muted);padding:4px 0;font-style:italic'},'No slots — inherits from previous day'));
        };
        refresh();
        daySection.append(slotList, el('button',{class:'btn btn-ghost btn-sm',style:'font-size:11px;padding:4px 10px',onclick:()=>{ sched.weekly[d].push({time:'08:00',presetKey:'light'}); scheduleSave(); tickThemeSchedule(); refresh(); }},'+ Add'));
        schedBody.appendChild(daySection);
      });
    }

    else if (sched.mode === 'sun') {
      if (!sched.sun) sched.sun = { ...DEFAULT_SCHEDULE.sun };
      const sun = sched.sun;

      // Validate helper
      const validCoord = (v, min, max) => v !== '' && !isNaN(v) && Number(v) >= min && Number(v) <= max;

      // Inline editable lat/lng inputs — always visible, geoBtn fills them automatically
      function makeCoordInput(val, min, max, placeholder, onChange) {
        const inp = el('input', {
          type: 'text', inputmode: 'decimal', placeholder,
          value: val != null ? String(val) : '',
          style: 'width:90px;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:var(--text);font-size:12px;font-family:inherit;outline:none;text-align:right;transition:border-color 0.15s',
          oninput: e => {
            const v = e.target.value;
            inp.style.borderColor = validCoord(v, min, max) ? 'rgba(var(--blue-rgb),0.5)' : 'rgba(239,68,68,0.6)';
            if (validCoord(v, min, max)) onChange(parseFloat(parseFloat(v).toFixed(4)));
          },
          onblur: e => {
            if (!validCoord(e.target.value, min, max)) {
              inp.style.borderColor = 'rgba(239,68,68,0.6)';
              inp.title = `Must be between ${min} and ${max}`;
            }
          }
        });
        return inp;
      }

      const latInput = makeCoordInput(sun.lat, -90, 90, '51.5074', v => {
        sun.lat = v; scheduleSave(); refreshSunPreview();
      });
      const lngInput = makeCoordInput(sun.lng, -180, 180, '-0.1278', v => {
        sun.lng = v; scheduleSave(); refreshSunPreview();
      });

      const geoBtn = el('button', { class:'btn btn-ghost btn-sm', style:'font-size:11px;white-space:nowrap', onclick: async () => {
        geoBtn.textContent = 'Requesting…'; geoBtn.disabled = true;
        try {
          const { lat, lng } = await fetchGeoForSchedule();
          latInput.value = String(lat); lngInput.value = String(lng);
          latInput.style.borderColor = ''; lngInput.style.borderColor = '';
          showToast('Location saved ✓'); refreshSunPreview(); tickThemeSchedule();
        } catch(e) { showToast('Location error: ' + (e.message||'denied')); }
        geoBtn.textContent = '📍 Detect'; geoBtn.disabled = false;
      }}, '📍 Detect');

      // Sun-times preview (updates when inputs change)
      const sunPreviewEl = el('div', { style:'font-size:11px;color:var(--muted);margin:6px 0 12px;min-height:16px' });
      function refreshSunPreview() {
        if (sun.lat == null || sun.lng == null) { sunPreviewEl.textContent = ''; return; }
        const times = calcSunTimes(sun.lat, sun.lng, new Date());
        if (!times) { sunPreviewEl.textContent = '⚠️ Polar day/night — no sunrise/sunset today'; return; }
        const fmt = m => { const mm = ((m%1440)+1440)%1440; return String(Math.floor(mm/60)).padStart(2,'0')+':'+String(Math.round(mm%60)).padStart(2,'0'); };
        const riseM = times.rise + (sun.riseOffset||0), setM = times.set + (sun.setOffset||0);
        sunPreviewEl.textContent = `Today: ☀️ ${fmt(riseM)}  🌙 ${fmt(setM)}`;
      }
      refreshSunPreview();

      // Offset inputs
      function makeOffsetInput(val, onChange) {
        return el('input',{type:'number',value:String(val||0),min:'-180',max:'180',
          style:'width:72px;padding:6px 8px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:var(--text);font-size:12px;font-family:inherit;outline:none;text-align:right',
          oninput:e=>{onChange(Number(e.target.value));scheduleSave();tickThemeSchedule();refreshSunPreview();}});
      }

      schedBody.append(
        // Location row: lat / lng inputs + detect button
        el('div', { style:'margin-bottom:4px' },
          el('div',{style:'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:6px'},'Location'),
          el('div',{style:'display:flex;align-items:center;gap:8px;flex-wrap:wrap'},
            el('label',{style:'font-size:11px;color:var(--muted);display:flex;align-items:center;gap:5px'},'Lat', latInput),
            el('label',{style:'font-size:11px;color:var(--muted);display:flex;align-items:center;gap:5px'},'Lng', lngInput),
            geoBtn,
            el('span',{style:'font-size:10px;color:var(--muted)'},'or enter manually (±90° / ±180°)')
          )
        ),
        sunPreviewEl,
        el('div',{style:'display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:4px'},
          el('div',{style:'padding:12px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid var(--border)'},
            el('div',{style:'font-size:12px;font-weight:700;margin-bottom:8px'},'☀️ Daytime theme'),
            el('div',{style:'font-size:11px;color:var(--muted);margin-bottom:6px'},'Applied at sunrise'),
            makePresetSel(sun.dayPreset||'light', k=>{sun.dayPreset=k;scheduleSave();tickThemeSchedule();}),
            el('div',{style:'font-size:11px;color:var(--muted);margin-top:8px;margin-bottom:4px'},'Offset (min)'),
            makeOffsetInput(sun.riseOffset, v=>sun.riseOffset=v)
          ),
          el('div',{style:'padding:12px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid var(--border)'},
            el('div',{style:'font-size:12px;font-weight:700;margin-bottom:8px'},'🌙 Nighttime theme'),
            el('div',{style:'font-size:11px;color:var(--muted);margin-bottom:6px'},'Applied at sunset'),
            makePresetSel(sun.nightPreset||'default', k=>{sun.nightPreset=k;scheduleSave();tickThemeSchedule();}),
            el('div',{style:'font-size:11px;color:var(--muted);margin-top:8px;margin-bottom:4px'},'Offset (min)'),
            makeOffsetInput(sun.setOffset, v=>sun.setOffset=v)
          )
        )
      );
    }
  }
  renderSchedBody();

  // ── Appearance ────────────────────────────────────────────────────────────
  const thm = state.settings.theme || DEFAULT_THEME;
  const appearCard = el('div', { class:'card', style:'padding:20px;margin-top:16px' });
  appearCard.appendChild(el('div', { style:'font-weight:800;margin-bottom:14px;color:var(--blue)' }, '🎨 Appearance'));

  // Schedule-override notice
  if (sched.enabled && resolveScheduledTheme(sched, state.settings.customPresets)) {
    const scheduledNow = resolveScheduledTheme(sched, state.settings.customPresets);
    const matchKey = getAllPresets().find(p => p.theme.blue === scheduledNow.blue && p.theme.pink === scheduledNow.pink)?.name || 'scheduled';
    appearCard.appendChild(el('div', {
      style:'font-size:11px;color:var(--blue);background:rgba(var(--blue-rgb),0.08);border:1px solid rgba(var(--blue-rgb),0.2);border-radius:8px;padding:8px 12px;margin-bottom:14px;display:flex;align-items:center;gap:6px'
    }, '🕐', ` Schedule active — currently showing "${matchKey}" theme. Manual theme applies when schedule is off.`));
  }

  // ── Preset swatches (built-in + custom) ──────────────────────────────
  appearCard.appendChild(el('div', { style:'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:8px' }, 'Presets'));
  const presetRow = el('div', { style:'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px;align-items:center' });

  function renderPresetSwatches() {
    presetRow.innerHTML = '';
    getAllPresets().forEach(({ key, name, theme: preset, isCustom }) => {
      const active = state.settings.theme?.blue === preset.blue && state.settings.theme?.bg === preset.bg;
      const grad = `linear-gradient(135deg,${preset.blue||'#5BCEFA'},${preset.pink||'#F5A9B8'})`;
      const wrap = el('div', { style:'position:relative;flex-shrink:0' });
      const swatch = el('button', {
        title: name,
        style:`background:${grad};border:2px solid ${active?preset.blue:'transparent'};
          border-radius:99px;width:32px;height:32px;cursor:pointer;transition:all 0.15s;
          box-shadow:${active?`0 0 0 2px var(--bg),0 0 0 4px ${preset.blue}`:'none'}`,
        onclick: () => {
          const { name: _, ...colors } = preset;
          // Preset colours (bg/surface/text/muted/blue/pink) should replace the palette,
          // but borderColor/bgPattern are the user's own customisations and are orthogonal
          // to which preset is active — preserve them unless the preset itself overrides
          // them (built-in presets generally don't; 'highcontrast' deliberately sets
          // bgPattern:null, and custom presets snapshot the full theme including both).
          state.settings.theme = { ...DEFAULT_THEME, ...state.settings.theme, ...colors };
          applyThemeVars(state.settings.theme);
          scheduleSave(); renderView('settings'); renderSidebar();
        }
      });
      wrap.appendChild(swatch);
      // Delete button for custom presets
      if (isCustom) {
        const del = el('button', { title:'Delete preset', style:'position:absolute;top:-4px;right:-4px;width:14px;height:14px;border-radius:50%;background:rgba(239,68,68,0.9);border:none;cursor:pointer;color:#fff;font-size:9px;line-height:14px;text-align:center;padding:0', onclick: e => {
          e.stopPropagation();
          if (!confirm(`Delete preset "${name}"?`)) return;
          state.settings.customPresets = (state.settings.customPresets||[]).filter(p => p.key !== key);
          scheduleSave(); renderView('settings');
        }}, '×');
        wrap.appendChild(del);
      }
      presetRow.appendChild(wrap);
    });

    // "Save current as preset" button
    presetRow.appendChild(el('button', { class:'btn btn-ghost btn-sm', title:'Save current colours as a new preset', style:'border-radius:99px;width:32px;height:32px;padding:0;font-size:16px;flex-shrink:0', onclick: () => {
      const name = prompt('Name for this preset:', 'My Preset');
      if (!name) return;
      const key = 'custom_' + Date.now();
      if (!state.settings.customPresets) state.settings.customPresets = [];
      state.settings.customPresets.push({ key, name, theme: { ...state.settings.theme } });
      scheduleSave(); renderView('settings');
    }}, '+'));
  }
  renderPresetSwatches();
  appearCard.appendChild(presetRow);

  // Export / import custom presets
  const presetIORow = el('div', { style:'display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap' });
  presetIORow.appendChild(el('button', { class:'btn btn-ghost btn-sm', onclick: () => {
    const presets = state.settings.customPresets || [];
    const hasImages = presets.some(p => p.theme?.bgPattern?.type === 'image' && p.theme.bgPattern.imageDataUrl);
    // Strip image data URLs from export by default — they can be MBs each and don't survive JSON share well
    const exportable = presets.map(p => {
      if (!p.theme?.bgPattern?.imageDataUrl) return p;
      return { ...p, theme: { ...p.theme, bgPattern: { ...p.theme.bgPattern, imageDataUrl: null, _imageStripped: true } } };
    });
    const data = JSON.stringify({ scima_presets: exportable }, null, 2);
    const a = document.createElement('a');
    a.href = 'data:application/json,' + encodeURIComponent(data);
    a.download = 'scima-presets.json'; a.click();
    if (hasImages) showToast('Note: image backgrounds were stripped from export (file size)');
  }}, '📤 Export presets'));
  const presetImportInput = el('input', { type:'file', accept:'.json', style:'display:none', onchange: async e => {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      const imported = data.scima_presets || (Array.isArray(data) ? data : []);
      if (!imported.length) { showToast('No presets found in file'); return; }
      const existing = new Set((state.settings.customPresets||[]).map(p=>p.key));
      let added = 0;
      imported.forEach(p => { if (p.key && p.name && p.theme && !existing.has(p.key)) { state.settings.customPresets.push(p); added++; } });
      scheduleSave(); showToast(`Imported ${added} preset${added!==1?'s':''} ✓`); renderView('settings');
    } catch { showToast('Could not read preset file'); }
    presetImportInput.value = '';
  }});
  presetIORow.appendChild(el('button', { class:'btn btn-ghost btn-sm', onclick: () => presetImportInput.click() }, '📥 Import presets'));
  presetIORow.appendChild(presetImportInput);
  appearCard.appendChild(presetIORow);

  // ── Per-group colour pickers ──────────────────────────────────────────
  appearCard.appendChild(el('div', { style:'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:8px' }, 'Colours'));
  const colourGroups = [
    { key:'bg',      label:'Background',   desc:'Main page background'               },
    { key:'surface', label:'Surface',       desc:'Cards & panels'                     },
    { key:'text',    label:'Text',          desc:'Primary text colour'                },
    { key:'muted',   label:'Muted text',    desc:'Secondary / caption text'           },
    { key:'blue',    label:'Gradient 1',    desc:'Primary accent & gradient start'    },
    { key:'pink',    label:'Gradient 2',    desc:'Secondary accent & gradient end'    },
  ];
  const pickerGrid = el('div', { style:'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:18px' });
  colourGroups.forEach(({ key, label, desc }) => {
    const currentVal = (state.settings.theme || DEFAULT_THEME)[key] || DEFAULT_THEME[key];
    const swatch = mkColorSwatch(currentVal, hex => {
      if (!state.settings.theme) state.settings.theme = { ...DEFAULT_THEME };
      state.settings.theme[key] = hex;
      applyThemeVars(state.settings.theme);
      scheduleSave();
    });
    pickerGrid.appendChild(el('div', { style:'display:flex;align-items:center;gap:10px;padding:10px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid var(--border)' },
      swatch,
      el('div', {},
        el('div', { style:'font-size:12px;font-weight:700' }, label),
        el('div', { style:'font-size:10px;color:var(--muted)' }, desc)
      )
    ));
  });
  appearCard.appendChild(pickerGrid);

  // ── Background pattern picker ─────────────────────────────────────────
  appearCard.appendChild(el('div', { style:'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);margin-bottom:8px' }, 'Background Pattern'));

  const patternSection = el('div', { style:'margin-bottom:16px' });
  const curPattern = state.settings.theme?.bgPattern || { type:'none', opacity:0.08, scale:1 };

  function updatePattern(patch) {
    if (!state.settings.theme) state.settings.theme = { ...DEFAULT_THEME };
    if (!state.settings.theme.bgPattern || state.settings.theme.bgPattern.type === 'none') {
      state.settings.theme.bgPattern = { type:'none', opacity:0.08, scale:1, ...patch };
    } else {
      Object.assign(state.settings.theme.bgPattern, patch);
    }
    applyThemeVars(state.settings.theme);
    scheduleSave();
  }

  // Pattern type buttons — SVG presets + custom image
  const patternTiles = el('div', { style:'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px' });
  Object.entries(BG_PATTERNS).forEach(([type, def]) => {
    const isActive = (curPattern.type||'none') === type;
    patternTiles.appendChild(el('button', {
      title: def.name,
      class: `btn btn-sm ${isActive ? 'btn-primary' : 'btn-ghost'}`,
      style: 'font-size:11px;padding:5px 10px;',
      onclick: () => {
        if (!state.settings.theme) state.settings.theme = { ...DEFAULT_THEME };
        if (type === 'none') {
          state.settings.theme.bgPattern = null;
        } else if (type === 'image') {
          // Don't wipe the image if already selected — just re-select
          if (curPattern.type !== 'image') {
            state.settings.theme.bgPattern = { type:'image', opacity:0.5, scale:1, imageSize:null, imageDataUrl: curPattern.imageDataUrl||null };
          }
        } else {
          state.settings.theme.bgPattern = { type, opacity: curPattern.opacity||0.08, scale: curPattern.scale||1 };
        }
        applyThemeVars(state.settings.theme);
        scheduleSave(); renderView('settings');
      }
    }, def.name));
  });
  patternSection.appendChild(patternTiles);

  const isImagePattern = curPattern.type === 'image';
  const hasSvgPattern  = curPattern.type && curPattern.type !== 'none' && !isImagePattern;

  // ── Custom image controls (shown only when type === 'image') ─────────
  if (isImagePattern) {
    const imgBox = el('div', { style:'padding:14px;border-radius:12px;background:rgba(255,255,255,0.04);border:1px solid var(--border);margin-bottom:12px' });

    // Preview thumbnail if an image is loaded
    if (curPattern.imageDataUrl) {
      const thumb = el('div', { style:`height:80px;border-radius:8px;background:url("${curPattern.imageDataUrl}") center/cover no-repeat;margin-bottom:10px;border:1px solid var(--border);position:relative;overflow:hidden` });
      const removeBtn = el('button', { style:'position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.7);border:none;border-radius:6px;color:#fff;font-size:11px;padding:3px 8px;cursor:pointer', onclick: () => {
        updatePattern({ imageDataUrl: null });
        renderView('settings');
      }}, '× Remove');
      thumb.appendChild(removeBtn);
      imgBox.appendChild(thumb);
    } else {
      imgBox.appendChild(el('div', { style:'font-size:12px;color:var(--muted);margin-bottom:10px;text-align:center;padding:16px 0' }, 'No image selected — upload or paste a URL below'));
    }

    // Upload button
    const fileIn = el('input', { type:'file', accept:'image/*', style:'display:none', onchange: e => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { showToast('Image must be under 2 MB'); return; }
      const reader = new FileReader();
      reader.onload = ev => { updatePattern({ imageDataUrl: ev.target.result }); renderView('settings'); };
      reader.readAsDataURL(file);
    }});
    const uploadBtn = btn('📁 Upload image', 'ghost', { onclick: () => fileIn.click(), style:'width:100%;margin-bottom:8px' });

    // URL paste
    const urlRow = el('div', { style:'display:flex;gap:6px;margin-bottom:10px' });
    const urlInput = el('input', { type:'text', placeholder:'https://… or data:image/…', style:'flex:1;padding:7px 10px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:var(--text);font-size:12px;font-family:inherit;outline:none' });
    const urlApply = btn('Use', 'ghost', { onclick: () => {
      const url = urlInput.value.trim();
      if (!url) return;
      if (!url.startsWith('http') && !url.startsWith('data:')) { showToast('Enter a valid http(s) or data: URL'); return; }
      // For http URLs we proxy through the browser's fetch (extension context has no CORS issues)
      if (url.startsWith('http')) {
        fetch(url).then(r => r.blob()).then(blob => {
          if (blob.size > 2 * 1024 * 1024) { showToast('Image at that URL is over 2 MB'); return; }
          const reader = new FileReader();
          reader.onload = ev => { updatePattern({ imageDataUrl: ev.target.result }); renderView('settings'); };
          reader.readAsDataURL(blob);
        }).catch(() => showToast('Could not load image from that URL'));
      } else {
        updatePattern({ imageDataUrl: url }); renderView('settings');
      }
    }});
    urlRow.append(urlInput, urlApply);

    // Image size mode
    const sizeModeRow = el('div', { style:'display:flex;gap:6px;margin-bottom:10px' });
    [['tile','Tile'],['cover','Cover'],['contain','Contain']].forEach(([val, label]) => {
      const active = (curPattern.imageSize||'tile') === val;
      sizeModeRow.appendChild(el('button', {
        class: `btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}`,
        style:'font-size:11px;flex:1',
        onclick: () => { updatePattern({ imageSize: val === 'tile' ? null : val }); renderView('settings'); }
      }, label));
    });

    // Opacity slider (image)
    const imgOpVal = el('span', { style:'min-width:32px;font-size:11px;color:var(--muted);text-align:right' }, Math.round((curPattern.opacity??0.5)*100)+'%');
    const imgOpSlider = el('input', { type:'range', min:'5', max:'100', value:String(Math.round((curPattern.opacity??0.5)*100)),
      oninput: e => { imgOpVal.textContent = e.target.value+'%'; updatePattern({ opacity: Number(e.target.value)/100 }); }
    });

    // Scale slider (only for tile mode)
    let scaleRow = null;
    if (!curPattern.imageSize) {
      const imgScVal = el('span', { style:'min-width:32px;font-size:11px;color:var(--muted);text-align:right' }, (curPattern.scale??1).toFixed(1)+'×');
      const imgScSlider = el('input', { type:'range', min:'10', max:'1000', value:String(Math.round((curPattern.scale??1)*100)),
        oninput: e => { imgScVal.textContent = (Number(e.target.value)/100).toFixed(1)+'×'; updatePattern({ scale: Number(e.target.value)/100 }); }
      });
      scaleRow = el('div', { style:'padding:10px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid var(--border);margin-top:8px' },
        el('div', { style:'display:flex;justify-content:space-between;font-size:11px;font-weight:600;margin-bottom:4px' }, 'Tile size', imgScVal),
        imgScSlider
      );
    }

    imgBox.append(
      fileIn, uploadBtn, urlRow,
      el('div', { style:'font-size:11px;font-weight:600;margin-bottom:6px' }, 'Display mode'), sizeModeRow,
      el('div', { style:'padding:10px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid var(--border)' },
        el('div', { style:'display:flex;justify-content:space-between;font-size:11px;font-weight:600;margin-bottom:4px' }, 'Opacity', imgOpVal),
        imgOpSlider
      ),
      ...(scaleRow ? [scaleRow] : [])
    );
    patternSection.appendChild(imgBox);
  }

  // ── SVG pattern sliders (opacity + scale) ────────────────────────────
  if (hasSvgPattern) {
    const opVal   = el('span', { style:'min-width:30px;font-size:11px;color:var(--muted);text-align:right' }, Math.round((curPattern.opacity??0.08)*100)+'%');
    const scVal   = el('span', { style:'min-width:30px;font-size:11px;color:var(--muted);text-align:right' }, (curPattern.scale??1).toFixed(1)+'×');
    const opSlider = el('input', { type:'range', min:'2', max:'40', value:String(Math.round((curPattern.opacity??0.08)*100)),
      oninput: e => { opVal.textContent = e.target.value+'%'; updatePattern({ opacity: Number(e.target.value)/100 }); }
    });
    const scSlider = el('input', { type:'range', min:'30', max:'300', value:String(Math.round((curPattern.scale??1)*100)),
      oninput: e => { scVal.textContent = (Number(e.target.value)/100).toFixed(1)+'×'; updatePattern({ scale: Number(e.target.value)/100 }); }
    });
    patternSection.appendChild(el('div', { style:'display:grid;grid-template-columns:1fr 1fr;gap:10px' },
      el('div', { style:'padding:10px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid var(--border)' },
        el('div', { style:'display:flex;justify-content:space-between;font-size:11px;font-weight:600;margin-bottom:4px' }, 'Opacity', opVal),
        opSlider
      ),
      el('div', { style:'padding:10px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid var(--border)' },
        el('div', { style:'display:flex;justify-content:space-between;font-size:11px;font-weight:600;margin-bottom:4px' }, 'Scale', scVal),
        scSlider
      )
    ));
    // Pattern color picker
    const patColSwatch = mkColorSwatch(curPattern.color || '#ffffff', hex => updatePattern({ color: hex }));
    patternSection.appendChild(el('div', { style:'display:flex;align-items:center;gap:10px;margin-top:10px;padding:10px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid var(--border)' },
      el('div', { style:'font-size:11px;font-weight:600;flex:1' }, 'Pattern Color'),
      patColSwatch
    ));
  }
  appearCard.appendChild(patternSection);

  // ── Border color picker ───────────────────────────────────────────────────
  const curBorder = state.settings.theme?.borderColor || '';
  const borderColSwatch = mkColorSwatch(curBorder || '#ffffff', hex => {
    if (!state.settings.theme) state.settings.theme = { ...DEFAULT_THEME };
    state.settings.theme.borderColor = hex;
    applyThemeVars(state.settings.theme); scheduleSave();
  });
  const borderReset = el('button', { style:'font-size:11px;color:var(--muted);background:none;border:none;cursor:pointer;padding:0', onclick: () => {
    if (state.settings.theme) state.settings.theme.borderColor = null;
    applyThemeVars(state.settings.theme); scheduleSave(); renderView('settings');
  }}, 'Reset');
  appearCard.appendChild(el('div', { style:'display:flex;align-items:center;gap:10px;margin-top:10px;padding:12px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid var(--border)' },
    el('div', { style:'flex:1' },
      el('div', { style:'font-size:13px;font-weight:600;margin-bottom:2px' }, 'Border Color'),
      el('div', { class:'u-muted-11' }, 'Color of card and panel borders')
    ),
    borderReset, borderColSwatch
  ));

  // Reset button
  appearCard.appendChild(btn('↩ Reset to Default', 'ghost', { onclick: () => {
    state.settings.theme = { ...DEFAULT_THEME };
    applyThemeVars(state.settings.theme);
    scheduleSave(); renderView('settings'); renderSidebar();
  }}));

  // ── Navigation ────────────────────────────────────────────────────────────
  // Reorder sidebar tabs (drag not available here — use up/down arrows) and
  // toggle their visibility. Hidden tabs move to the drawer at the bottom of
  // the sidebar (accessible but not cluttering the main nav list).
  const navCard = el('div', { class:'card', style:'padding:20px;margin-top:16px' });
  navCard.appendChild(el('div', { style:'font-weight:800;margin-bottom:6px' }, '🗂️ Navigation'));
  navCard.appendChild(el('div', { style:'font-size:12px;color:var(--muted);margin-bottom:14px' }, 'Reorder or hide sidebar tabs. Hidden tabs go to the drawer at the bottom of the sidebar.'));

  function renderNavEditor() {
    navCard.querySelectorAll('.nav-edit-row').forEach(r => r.remove());
    const ordered = getOrderedNavItems();
    const hidden = new Set(state.settings.hiddenTabs || []);
    ordered.forEach((item, i) => {
      const isHidden = hidden.has(item.id);
      const row = el('div', { class:'nav-edit-row', style:`display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;margin-bottom:4px;background:rgba(255,255,255,${isHidden?'0.02':'0.04'});border:1px solid var(--border);opacity:${isHidden?0.55:1}` });
      // Up / Down
      const upBtn  = el('button', { class:'btn btn-ghost btn-sm', disabled: i === 0, style:'padding:2px 8px;font-size:11px', onclick: () => {
        const order = getOrderedNavItems().map(n => n.id);
        [order[i-1], order[i]] = [order[i], order[i-1]];
        state.settings.navOrder = order; scheduleSave(); renderSidebar(); renderNavEditor();
      }}, '▲');
      const downBtn = el('button', { class:'btn btn-ghost btn-sm', disabled: i === ordered.length-1, style:'padding:2px 8px;font-size:11px', onclick: () => {
        const order = getOrderedNavItems().map(n => n.id);
        [order[i], order[i+1]] = [order[i+1], order[i]];
        state.settings.navOrder = order; scheduleSave(); renderSidebar(); renderNavEditor();
      }}, '▼');
      // Hide/show toggle
      const eyeBtn = el('button', { class:'btn btn-ghost btn-sm', title: isHidden ? 'Show in sidebar' : 'Hide (move to drawer)', style:'padding:2px 8px;font-size:13px', onclick: () => {
        const h = new Set(state.settings.hiddenTabs || []);
        isHidden ? h.delete(item.id) : h.add(item.id);
        state.settings.hiddenTabs = [...h]; scheduleSave(); renderSidebar(); renderNavEditor();
      }}, isHidden ? '👁' : '🫣');
      row.append(
        el('span', { style:'font-size:15px;width:20px;text-align:center' }, item.icon),
        el('span', { style:`font-size:13px;font-weight:600;flex:1;color:${isHidden?'var(--muted)':'var(--text)'}` }, item.label),
        upBtn, downBtn, eyeBtn
      );
      navCard.appendChild(row);
    });
  }
  renderNavEditor();
  navCard.appendChild(el('div', { style:'margin-top:10px' },
    btn('↩ Reset Tab Order', 'ghost', { onclick: () => {
      state.settings.navOrder = [...NAV_ITEMS_DEFAULT_ORDER];
      state.settings.hiddenTabs = [];
      scheduleSave(); renderSidebar(); renderNavEditor();
    }})
  ));

  c.append(
    el('div', { style:'margin-bottom:24px' }, el('div', { class:'section-title' }, 'Settings')),
    helpCard, grid, llmCard, schedCard, appearCard, navCard, dataCard
  );
}

