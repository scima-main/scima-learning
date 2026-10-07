'use strict';
/* dashboard-capture.js — the Capture view: AI Generate (send pasted context
   to a local LLM server, OR copy a prompt into any chat-based AI and paste
   its reply back in — see the mode toggle in renderAIGenerate()) plus the
   manual Quick Add form.

   SITE PORT NOTES: ported verbatim, no changes. Everything here talks to
   state/DOM/clipboard and a user-supplied local server URL (fetch(), via
   generateCardsFromText() in dashboard-core.js) — no chrome.* APIs anywhere
   in this file. */

function renderCapture(c) {
  c.append(el('div',{class:'section-title'},'Capture'),el('div',{class:'section-sub'},'Create flashcards from pasted text with a local LLM or any chat-based AI, or add them by hand'));

  const tabBar=el('div',{class:'tab-bar'});
  const panel=el('div',{class:'card',style:'padding:20px'});
  const tabs=[{id:'ai',label:'AI Generate'},{id:'quick',label:'Quick Add'}];
  let activeTab='ai';

  function renderPanel(){
    panel.innerHTML='';
    if(activeTab==='quick') renderQuickAdd(panel);
    else renderAIGenerate(panel);
  }
  tabs.forEach(t=>{
    tabBar.appendChild(el('button',{class:`tab-btn${activeTab===t.id?' active':''}`,'data-id':t.id,onclick:()=>{
      activeTab=t.id;
      tabBar.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.dataset.id===t.id));
      renderPanel();
    }},t.label));
  });

  renderPanel();
  c.append(tabBar,panel);
}

let _lastAIGenerateDeckId = null;

function renderAIGenerate(wrap) {
  if(!state.decks.length){
    wrap.appendChild(el('div',{class:'empty-state',style:'padding:24px;text-align:center'},
      el('div',{class:'empty-icon'},'\u{1F4DD}'),
      el('div',{class:'empty-title'},'No decks yet'),
      el('div',{class:'empty-sub'},'Create a deck first, then come back to generate cards.'),
      btn('Create a Deck','primary',{onclick:()=>navigate('decks')})
    ));
    return;
  }

  // Mode toggle: 'api' talks to a local OpenAI-compatible server directly
  // (unchanged behaviour below); 'manual' builds the same prompt for the
  // user to copy into any chat-based AI, then parses whatever they paste
  // back. Persisted so it sticks across sessions, same as aiJsonMode.
  const mode=state.settings.aiCaptureMode==='manual'?'manual':'api';
  const modeBar=el('div',{class:'tab-bar',style:'margin-bottom:16px'});
  [{id:'api',label:'\u{1F50C} Local Server'},{id:'manual',label:'\u{1F4CB} Copy / Paste'}].forEach(m=>{
    modeBar.appendChild(el('button',{class:`tab-btn${mode===m.id?' active':''}`,onclick:()=>{
      if(state.settings.aiCaptureMode===m.id) return;
      state.settings.aiCaptureMode=m.id; scheduleSave();
      wrap.innerHTML=''; renderAIGenerate(wrap);
    }},m.label));
  });
  wrap.appendChild(modeBar);

  if(mode==='api' && !normalizeAIEndpoint(state.settings.aiEndpoint)){
    wrap.appendChild(el('div',{class:'empty-state',style:'padding:24px;text-align:center'},
      el('div',{class:'empty-icon'},'\u{1F50C}'),
      el('div',{class:'empty-title'},'No AI server configured'),
      el('div',{class:'empty-sub'},'Add a local server address (e.g. LM Studio\u2019s http://127.0.0.1:1234) in Settings, or switch to \u{1F4CB} Copy / Paste above to use any chat AI instead.'),
      btn('Go to Settings','primary',{onclick:()=>navigate('settings')})
    ));
    return;
  }

  const deckField=el('div',{class:'field'},el('label',{},'Add generated cards to'));
  const deckSel=el('select',{class:'u-input'});
  state.decks.forEach(d=>{
    const o=el('option',{value:d.id,class:'u-bg'},`${d.emoji||'\u{1F4DA}'} ${d.name}`);
    if(d.id===(_lastAIGenerateDeckId||state.decks[0].id)) o.selected=true;
    deckSel.appendChild(o);
  });
  deckField.appendChild(deckSel);

  const textarea=el('textarea',{placeholder:'Paste lecture notes, an article, a textbook excerpt\u2026',rows:'9',
    style:'width:100%;padding:12px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid var(--border);color:var(--text);font-size:13px;resize:vertical;font-family:inherit;box-sizing:border-box;outline:none'});

  let sourceRow=null;
  if(state.sources.length){
    const srcSel=el('select',{class:'u-input',style:'flex:1'});
    srcSel.appendChild(el('option',{value:'',class:'u-bg'},'Pull in a Library source\u2026'));
    state.sources.forEach(s=>srcSel.appendChild(el('option',{value:s.id,class:'u-bg'},`${(typeof sourceTypeIcon==='function'?sourceTypeIcon(s):'\u{1F4D6}')} ${s.name}`)));
    sourceRow=el('div',{style:'display:flex;gap:8px;margin-bottom:10px'},
      srcSel,
      btn('Insert','ghost',{small:true,onclick:()=>{
        const src=state.sources.find(s=>s.id===srcSel.value);
        if(!src){ showToast('Choose a source first'); return; }
        textarea.value=(textarea.value.trim()?textarea.value.trim()+'\n\n':'')+src.content;
        srcSel.value='';
      }})
    );
  }

  const countField=el('div',{class:'field'},el('label',{},'Approx. number of cards (optional)'),
    el('input',{type:'number',class:'u-input',min:'1',max:'50',placeholder:'let the model decide'}));
  const instructionsField=createField('Extra instructions (optional)','text','e.g. exam-style questions, focus on definitions\u2026');

  // Output format toggle: plain-text "Card1 / Front: ... / Back: ..." (the
  // default — works with basically any local model, see getAISystemPrompt()
  // in dashboard-core.js) vs. LM Studio/llama.cpp's structured-output
  // `response_format: json_schema` (getAISystemPromptJSON()/AI_CARD_JSON_SCHEMA).
  // Persisted in settings so it sticks across sessions, same as the endpoint/model.
  const modeHint=el('div',{style:'font-size:11px;color:var(--muted);margin-top:6px;line-height:1.5'});
  function renderModeHint(){
    if(mode==='manual'){
      modeHint.textContent = state.settings.aiJsonMode
        ? '\u{1F9E9} JSON Schema mode: the copied prompt includes the schema as text and asks the model to reply with only matching JSON. Works well with capable chat AIs (ChatGPT, Claude.ai, Gemini); if the reply won\u2019t parse, switch to Text and try again.'
        : '\u{1F4C4} Text mode: the copied prompt asks for a simple Card1 / Front: / Back: template, which is parsed back out of whatever you paste. The most reliable option for any chat AI.';
    } else {
      modeHint.textContent = state.settings.aiJsonMode
        ? '\u{1F9E9} JSON Schema mode: the request sends a response_format json_schema so the server itself constrains the model\u2019s output. Requires a server that supports Structured Output (LM Studio\u2019s Structured Output toggle, recent llama.cpp). If your server ignores or rejects it, switch back to Text.'
        : '\u{1F4C4} Text mode: the model is asked to reply in a simple Card1 / Front: / Back: template, which is parsed back out. Works with virtually any local model.';
    }
  }
  renderModeHint();
  const modeField=el('div',{class:'field'},
    el('label',{},'Output format'),
    el('div',{class:'tab-bar',style:'display:inline-flex'},
      (function(){
        const textBtn=el('button',{class:`tab-btn${state.settings.aiJsonMode?'':' active'}`,onclick:()=>{
          state.settings.aiJsonMode=false; scheduleSave();
          textBtn.classList.add('active'); jsonBtn.classList.remove('active');
          renderModeHint();
        }},'Text');
        var jsonBtn;
        jsonBtn=el('button',{class:`tab-btn${state.settings.aiJsonMode?' active':''}`,onclick:()=>{
          state.settings.aiJsonMode=true; scheduleSave();
          jsonBtn.classList.add('active'); textBtn.classList.remove('active');
          renderModeHint();
        }},'JSON Schema');
        return [textBtn,jsonBtn];
      })()
    ),
    modeHint
  );

  // Fine-tuned model toggle: swaps generateCardsFromText()/buildManualPromptText()
  // (dashboard-core.js) over to the compact FT_MODE_MARKER + source prompt
  // instead of the normal system prompt above. OFF by default; persisted in
  // settings so it sticks across sessions, same as aiJsonMode/aiCaptureMode.
  const ftToggle=el('input',{type:'checkbox',checked:!!state.settings.aiFineTuned});
  const ftBadge=el('span',{style:`font-size:10px;font-weight:800;letter-spacing:0.03em;padding:2px 8px;border-radius:20px;background:rgba(var(--blue-rgb),0.15);color:var(--blue);display:${state.settings.aiFineTuned?'inline-block':'none'}`},'FINE-TUNED MODE');
  ftToggle.onchange=()=>{
    state.settings.aiFineTuned=ftToggle.checked;
    scheduleSave();
    ftBadge.style.display=ftToggle.checked?'inline-block':'none';
    modeField.style.display=ftToggle.checked?'none':'';
  };
  const ftField=el('div',{class:'field'},
    el('label',{style:'display:flex;align-items:center;gap:8px;cursor:pointer'},
      ftToggle,
      el('span',{},'Use fine-tuned flashcard model'),
      ftBadge
    ),
    el('div',{style:'font-size:11px;color:var(--muted);margin-top:6px;line-height:1.5'},
      'Sends a short, fixed prompt instead of the full instructions above, for a model fine-tuned specifically on this flashcard task.')
  );

  const errEl=el('div',{class:'error-msg',style:'display:none'});
  const rawDetails=el('details',{style:'display:none;margin-top:10px'},
    el('summary',{style:'font-size:11px;color:var(--muted);cursor:pointer'},'Show the model\u2019s raw reply'),
    el('pre',{style:'white-space:pre-wrap;font-size:11px;color:var(--muted);margin-top:6px;max-height:200px;overflow:auto'})
  );

  const generatedSection=el('div',{style:'display:none;margin-top:16px'});
  let generatedCards=[], selectedIdxs=[];

  function renderGenerated(){
    generatedSection.innerHTML='';
    if(!generatedCards.length){ generatedSection.style.display='none'; return; }
    generatedSection.style.display='';
    const selBar=el('div',{style:'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px'},
      el('div',{style:'font-weight:800;font-size:13px'},`\u2728 ${selectedIdxs.length}/${generatedCards.length} selected`),
      el('div',{style:'display:flex;gap:8px'},
        btn('All','ghost',{small:true,onclick:()=>{ selectedIdxs=generatedCards.map((_,i)=>i); renderGenerated(); }}),
        btn('None','ghost',{small:true,onclick:()=>{ selectedIdxs=[]; renderGenerated(); }}),
        btn(`Add ${selectedIdxs.length} Card${selectedIdxs.length===1?'':'s'}`,'primary',{small:true,onclick:()=>{
          const deck=state.decks.find(d=>d.id===deckSel.value);
          if(!deck){ showToast('Select a deck first'); return; }
          const toAdd=generatedCards.filter((_,i)=>selectedIdxs.includes(i));
          if(!toAdd.length){ showToast('Select at least one card'); return; }
          toAdd.forEach(cc=>{
            deck.cards.push({id:uid('c'),front:cc.front,back:cc.back,hint:cc.hint||'',tags:cc.tags||[],citation:null,frontImage:null,backImage:null,
              type:'basic',answerCount:cc.answerCount||1,requiredAnswers:cc.requiredAnswers||cc.answerCount||1,
              ease:2.5,interval:0,reps:0,lapses:0,due:Date.now(),state:'new',created:Date.now()});
            addXP(calcCardXP({ease:2.5,lapses:0},3));
          });
          checkAchievements();
          scheduleSave();
          _lastAIGenerateDeckId=deck.id;
          showToast(`Added ${toAdd.length} card${toAdd.length===1?'':'s'}! \u{1F389}`);
          generatedCards=generatedCards.filter((_,i)=>!selectedIdxs.includes(i));
          selectedIdxs=[];
          renderGenerated();
        }})
      )
    );
    const grid=el('div',{class:'grid-2'});
    generatedCards.forEach((cc,i)=>{
      const sel=selectedIdxs.includes(i);
      grid.appendChild(el('div',{
        style:`padding:12px 14px;border-radius:10px;cursor:pointer;border:1px solid ${sel?'var(--blue)':'var(--border)'};background:${sel?'rgba(var(--blue-rgb),0.1)':'rgba(255,255,255,0.03)'}`,
        onclick:()=>{ if(sel) selectedIdxs=selectedIdxs.filter(x=>x!==i); else selectedIdxs.push(i); renderGenerated(); }
      },
        el('div',{style:'font-weight:700;font-size:13px;margin-bottom:4px'},cc.front),
        (cc.answerCount||1)>1
          ? el('div',{style:'font-size:12px;color:var(--muted)'},...getCardAnswers(cc).map(a=>el('div',{},`\\u2022 ${a}`)))
          : el('div',{style:'font-size:12px;color:var(--muted)'},cc.back),
        (cc.answerCount||1)>1?el('div',{style:'font-size:11px;color:var(--blue);margin-top:2px'},`\\u{1F4CB} all ${cc.answerCount} required`):null,
        cc.hint?el('div',{style:'font-size:11px;color:var(--muted);font-style:italic;margin-top:4px'},`\u{1F4A1} ${cc.hint}`):null,
        (cc.tags&&cc.tags.length)?el('div',{style:'display:flex;gap:4px;flex-wrap:wrap;margin-top:6px'},...cc.tags.map(t=>mkTag(t))):null,
        el('div',{style:`font-size:11px;margin-top:6px;color:${sel?'var(--blue)':'var(--muted)'}`},sel?'\u2713 Selected':'Tap to select')
      ));
    });
    generatedSection.append(selBar,grid);
  }

  let genControls;
  if(mode==='api'){
    const genBtn=btn('\u2728 Generate Cards','primary',{full:true,onclick:async()=>{
      const text=textarea.value.trim();
      if(!text){ showToast('Paste some text first'); return; }
      errEl.style.display='none'; rawDetails.style.display='none';
      genBtn.disabled=true; const prevLabel=genBtn.textContent; genBtn.textContent='\u23F3 Generating\u2026';
      try{
        const count=Number(countField.querySelector('input').value)||null;
        const instructions=instructionsField.querySelector('input').value.trim();
        const {cards,raw}=await generateCardsFromText(text,{count,instructions});
        if(!cards.length){
          errEl.textContent='The model replied, but no cards could be parsed out of it \u2014 try again, or simplify/shorten the source text.';
          errEl.style.display='';
          rawDetails.querySelector('pre').textContent=raw;
          rawDetails.style.display='';
        } else {
          generatedCards=cards; selectedIdxs=cards.map((_,i)=>i);
          renderGenerated();
          showToast(`Generated ${cards.length} card${cards.length===1?'':'s'} \u2728`);
        }
      } catch(e){
        errEl.textContent=e.message||'Generation failed.';
        errEl.style.display='';
      } finally {
        genBtn.disabled=false; genBtn.textContent=prevLabel;
      }
    }});
    genControls=genBtn;
  } else {
    // Manual "Copy / Paste" mode: build the exact same prompt
    // generateCardsFromText() would've sent, hand it to the user to paste
    // into any chat-based AI, then parse whatever they paste (or import)
    // back with parseManualAIReply() — the same parser + multi-answer
    // post-processing the API path uses, so results are identical either way.
    const promptFallback=el('textarea',{readonly:true,rows:'6',
      style:'display:none;width:100%;margin-top:8px;padding:10px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid var(--border);color:var(--text);font-size:11px;font-family:monospace;resize:vertical;box-sizing:border-box'});

    const copyBtn=btn('\u{1F4CB} Copy Prompt','primary',{full:true,onclick:async()=>{
      const text=textarea.value.trim();
      if(!text){ showToast('Paste some text first'); return; }
      const count=Number(countField.querySelector('input').value)||null;
      const instructions=instructionsField.querySelector('input').value.trim();
      const prompt=buildManualPromptText(text,{count,instructions});
      const ok=await copyTextToClipboard(prompt);
      if(ok){
        promptFallback.style.display='none';
        showToast('Prompt copied \u2014 paste it into ChatGPT, Claude, Gemini, etc. \u2728');
      } else {
        promptFallback.value=prompt;
        promptFallback.style.display='';
        promptFallback.select();
        showToast('Couldn\u2019t copy automatically \u2014 select the text below and copy it manually');
      }
    }});

    const pasteArea=el('textarea',{placeholder:'Paste the chat AI\u2019s reply here\u2026',rows:'9',
      style:'width:100%;padding:12px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid var(--border);color:var(--text);font-size:13px;resize:vertical;font-family:inherit;box-sizing:border-box;outline:none'});

    const importInput=el('input',{type:'file',accept:'.txt,.json,.md',style:'display:none',onchange:async e=>{
      const file=e.target.files?.[0]; if(!file) return;
      try{
        const text=await file.text();
        pasteArea.value=(pasteArea.value.trim()?pasteArea.value.trim()+'\n\n':'')+text;
        showToast('File loaded \u2014 review below, then Generate Cards');
      }catch(err){ showToast('Couldn\u2019t read that file'); }
      e.target.value='';
    }});
    const importRow=el('div',{style:'display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap'},
      btn('\u{1F4C1} Import .txt / .json','ghost',{small:true,onclick:()=>importInput.click()}),
      importInput,
      el('div',{style:'font-size:11px;color:var(--muted)'},'or paste the reply above directly')
    );

    const parseBtn=btn('\u2728 Generate Cards from Reply','primary',{full:true,onclick:()=>{
      const raw=pasteArea.value.trim();
      if(!raw){ showToast('Paste the AI\u2019s reply first'); return; }
      errEl.style.display='none'; rawDetails.style.display='none';
      const {cards}=parseManualAIReply(raw);
      if(!cards.length){
        errEl.textContent='No cards could be parsed out of that \u2014 make sure you pasted the model\u2019s full reply, or try the other Output Format.';
        errEl.style.display='';
        rawDetails.querySelector('pre').textContent=raw;
        rawDetails.style.display='';
      } else {
        generatedCards=cards; selectedIdxs=cards.map((_,i)=>i);
        renderGenerated();
        showToast(`Generated ${cards.length} card${cards.length===1?'':'s'} \u2728`);
      }
    }});

    genControls=el('div',{},
      copyBtn,promptFallback,
      el('div',{style:'font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-top:18px;margin-bottom:6px'},'Then paste the reply'),
      pasteArea,
      importRow,
      el('div',{style:'margin-top:12px'},parseBtn)
    );
  }

  modeField.style.display=state.settings.aiFineTuned?'none':'';

  wrap.append(deckField);
  if(sourceRow) wrap.append(sourceRow);
  wrap.append(textarea,
    el('div',{class:'grid-2',style:'margin-top:10px'},countField,instructionsField),
    ftField,
    modeField,
    genControls,errEl,rawDetails,generatedSection);
}

let _lastQuickAddDeckId = null;

function renderQuickAdd(wrap) {
  if(!state.decks.length){
    wrap.appendChild(el('div',{class:'empty-state',style:'padding:24px;text-align:center'},
      el('div',{class:'empty-icon'},'\u{1F4DD}'),
      el('div',{class:'empty-title'},'No decks yet'),
      el('div',{class:'empty-sub'},'Create a deck first, then come back to quick-add cards.'),
      btn('Create a Deck','primary',{onclick:()=>navigate('decks')})
    ));
    return;
  }

  const deckField=el('div',{class:'field'},el('label',{},'Deck'));
  const deckSel=el('select',{style:'width:100%;padding:9px 12px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid var(--border);color:var(--text);font-size:13px;font-family:inherit;outline:none'});
  state.decks.forEach(d=>{
    const o=el('option',{value:d.id,class:'u-bg'},`${d.emoji||'\u{1F4DA}'} ${d.name}`);
    if(d.id===(_lastQuickAddDeckId||state.decks[0].id)) o.selected=true;
    deckSel.appendChild(o);
  });
  deckField.appendChild(deckSel);

  const frontField=createField('Front (Question)','text','What is\u2026?',true);
  let _frontImage=null;
  const frontImgPicker=mkCardImagePicker('Front image (optional)',_frontImage,v=>{_frontImage=v;});
  const backField=createField('Back (Answer)','text','The answer is\u2026',true);
  let _backImage=null;
  const backImgPicker=mkCardImagePicker('Back image (optional)',_backImage,v=>{_backImage=v;});
  const hintField=createField('Hint (optional)','text','Brief clue\u2026');
  const tagsField=createField('Tags (comma-separated)','text','biology, cell');

  let citation=null;
  const citSection=el('div',{style:'border-top:1px solid var(--border);padding-top:14px;margin-top:4px'});
  citSection.appendChild(el('div',{style:'font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px'},'\u{1F4D6} Source Citation (optional)'));
  const citInfo=el('div',{});
  function renderCitInfo(){
    citInfo.innerHTML='';
    if(citation){
      const src=state.sources.find(s=>s.id===citation.sourceId);
      const chap=citation.chapterId?src?.chapters?.find(ch=>ch.id===citation.chapterId):null;
      const excerpt=src?src.content.slice(citation.charStart,citation.charEnd):'';
      citInfo.appendChild(el('div',{style:'padding:10px 12px;border-radius:8px;background:rgba(167,139,250,0.1);border:1px solid rgba(167,139,250,0.2);font-size:12px'},
        el('div',{style:'font-weight:700;color:#A78BFA;margin-bottom:4px'},`\u{1F4D6} ${src?.name||'Unknown'}${chap?` \u2014 ${chap.title}`:''}`),
        excerpt?el('div',{style:'color:var(--muted);font-style:italic;font-size:11px;line-height:1.5'},`"${excerpt.slice(0,120)}${excerpt.length>120?'\u2026':''}"`):'',
        el('div',{style:'display:flex;gap:6px;margin-top:8px'},
          btn('View','ghost',{small:true,onclick:()=>openCitationViewer(citation)}),
          btn('Remove','danger',{small:true,onclick:()=>{ citation=null; renderCitInfo(); }})
        )
      ));
    } else if(state.sources.length){
      citInfo.appendChild(btn('+ Add Citation','ghost',{onclick:()=>openCitationPicker(c=>{ citation=c; renderCitInfo(); })}));
    } else {
      citInfo.appendChild(el('div',{class:'u-muted-12'},'No sources in library.'));
    }
  }
  renderCitInfo();
  citSection.appendChild(citInfo);

  wrap.append(deckField,frontField,frontImgPicker,backField,backImgPicker,hintField,tagsField,citSection,
    btn('Add Card','primary',{full:true,onclick:()=>{
      const deck=state.decks.find(d=>d.id===deckSel.value);
      if(!deck){ showToast('Select a deck first'); return; }
      const front=frontField.querySelector('textarea').value.trim();
      const back=backField.querySelector('textarea').value.trim();
      if(!front||!back){ showToast('Front and back are required'); return; }
      const tags=tagsField.querySelector('input').value.split(',').map(t=>t.trim()).filter(Boolean);
      const hint=hintField.querySelector('input').value.trim();
      deck.cards.push({id:uid('c'),front,back,hint,tags,citation:citation||null,frontImage:_frontImage||null,backImage:_backImage||null,type:'basic',ease:2.5,interval:0,reps:0,lapses:0,due:Date.now(),state:'new',created:Date.now()});
      addXP(calcCardXP({ease:2.5,lapses:0},3));
      checkAchievements();
      scheduleSave();
      _lastQuickAddDeckId=deck.id;
      showToast('Card added! \u{1F389}');
      renderView('capture');
    }})
  );
}
