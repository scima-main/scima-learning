'use strict';
/* dashboard-bootstrap.js — MUST load last of the dashboard-*.js files.
   Theme scheduler, init(), the cross-tab storage.onChanged listener, and the
   final init() call that actually starts the app — this is the only one of
   the ten split files with real top-level executing code, which is why load
   order matters for this one specifically. See dashboard-core.js's header
   for the full rationale. */

// Normally declared in dashboard-tracker.js (not loaded in this
// landing-page-only slice) alongside the rest of the tracker's interval
// handles. Belongs here until dashboard-tracker.js itself is ported in —
// startThemeScheduler() is the only thing in this build that uses it.
let _schedTick = null;

function tickThemeSchedule() {
  const sched = state.settings.themeSchedule;
  const resolved = resolveScheduledTheme(sched, state.settings.customPresets);
  if (resolved) applyThemeVars(resolved);
  else applyThemeVars(state.settings.theme); // fall back to manual
}

function startThemeScheduler() {
  if (_schedTick) clearInterval(_schedTick);
  _schedTick = setInterval(tickThemeSchedule, 60_000); // re-evaluate every minute
  tickThemeSchedule(); // apply immediately on load / toggle
}

/** Fetch the browser's geolocation and store it in the sun schedule config, then re-tick. */
function fetchGeoForSchedule() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Geolocation not supported')); return; }
    navigator.geolocation.getCurrentPosition(pos => {
      if (!state.settings.themeSchedule) state.settings.themeSchedule = { ...DEFAULT_SCHEDULE };
      if (!state.settings.themeSchedule.sun) state.settings.themeSchedule.sun = {};
      state.settings.themeSchedule.sun.lat = +pos.coords.latitude.toFixed(4);
      state.settings.themeSchedule.sun.lng = +pos.coords.longitude.toFixed(4);
      scheduleSave();
      tickThemeSchedule();
      resolve({ lat: state.settings.themeSchedule.sun.lat, lng: state.settings.themeSchedule.sun.lng });
    }, err => reject(err), { timeout: 8000 });
  });
}

async function init() {
  const saved=await store.load();
  const mf = sanitizeMfState(saved.mf);
  if(saved.mf.decks)           state.decks=mf.decks;
  if(saved.mf.folders)         state.folders=mf.folders;
  if(saved.mf.sources)         state.sources=mf.sources;
  if(saved.mf.libraryFolders)  state.libraryFolders=mf.libraryFolders;
  if(saved.mf.streak!=null)    state.streak=mf.streak;
  if(saved.mf.lastStreakDate)  state.lastStreakDate=mf.lastStreakDate;
  if(saved.mf.reviewHistory)   state.reviewHistory=mf.reviewHistory;
  if(saved.mf.achievements)    state.achievements=mf.achievements;
  if(saved.mf.recentStudyScopes) state.recentStudyScopes=mf.recentStudyScopes;
  if(Array.isArray(saved.mf.sessionLog)) state.sessionLog = mf.sessionLog;
  if(saved.mf.settings)        Object.assign(state.settings,mf.settings);
  // Ensure themeSchedule has all required fields (new fields added in updates won't break old saves)
  state.settings.themeSchedule = { ...DEFAULT_SCHEDULE, ...state.settings.themeSchedule };
  if (!state.settings.themeSchedule.sun) state.settings.themeSchedule.sun = { ...DEFAULT_SCHEDULE.sun };
  // Apply theme — schedule takes priority over manual theme when enabled
  startThemeScheduler();
  // Power saving / accessibility modes
  document.documentElement.classList.toggle('power-saving', !!state.settings.powerSaving);
  document.documentElement.classList.toggle('dyslexia-mode', !!state.settings.dyslexia);
  document.documentElement.classList.toggle('a11y-high-contrast', !!state.settings.highContrast);
  state.trackerState = sanitizeState(saved.tracker);
  if (!state.trackerState.config) state.trackerState.config = { xpCoef: XP_COEFFICIENT, capMult: MONTHLY_CAP_MULT, theme: 'dark', customSubjects: {} };
  if (!state.trackerState.config.customSubjects) state.trackerState.config.customSubjects = {};

  const hash=location.hash.replace('#','');
  if(hash&&NAV_ITEMS.some(n=>n.id===hash)) state.view=hash;

  // Sync pending cards from content script — route each to its target deck.
  // Site build: no content script exists to populate 'pendingCards' at all
  // (that flow is inherently extension-only — see Phase 3 in the port plan
  // for whether a bookmarklet/manual-paste replacement is added later), so
  // this is a no-op here. Left as an isExtension-gated block, not deleted,
  // so this file still runs unmodified inside the extension build.
  if (isExtension) {
    try{
      chrome.storage.local.get('pendingCards',async d=>{
        const pending=d.pendingCards||[];
        if(pending.length&&state.decks.length){
          let changed=false;
          pending.forEach(card=>{
            const target=card.deckId
              ? state.decks.find(dk=>dk.id===card.deckId)
              : state.decks[0];
            if(target){ const {deckId:_,...rest}=card; target.cards.push(rest); changed=true; }
          });
          if(changed){
            await chrome.storage.local.set({pendingCards:[]});
            scheduleSave();
          }
        }
      });
    }catch(e){ console.warn('[SCIMA] pendingCards sync failed — cards captured via the popup may not appear:', e); }
    // Migrate legacy 'decks' storage key — only ever existed under
    // chrome.storage.local, so this migration has nothing to do on the site.
    try{
      chrome.storage.local.get('decks',d=>{
        if(d.decks?.length&&!state.decks.length){ state.decks=d.decks; scheduleSave(); chrome.storage.local.remove('decks'); }
      });
    }catch(e){ console.warn('[SCIMA] legacy "decks" key migration failed:', e); }
  }

  renderSidebar();
  navigate(state.view);
  checkAchievements();
  notifyClaimableAchievements();

  // First-run guided tour, or resume mid-tour if the tab was closed partway
  // through. Bumping TUTORIAL_VERSION in dashboard-onboarding.js re-triggers
  // it for everyone after a redesign, even for users who finished it before.
  const ob = state.settings.onboarding;
  if (!ob.completed || (ob.version||0) < TUTORIAL_VERSION) {
    setTimeout(() => startTutorial(ob.completed ? 0 : (ob.step||0)), 300);
  }
}

// Live XP sync from tracker dashboard, and live deck/card sync across tabs.
// Without this, two dashboard tabs open at once each hold their own in-memory
// `state` and each debounce-save (scheduleSave(), 600ms after any edit) a full
// snapshot — whichever tab's timer fires last silently overwrites the other tab's
// edits, since neither tab ever finds out about the other's changes. This doesn't
// make concurrent edits merge correctly (that would need real conflict resolution),
// but it does mean both tabs converge on whichever save happened most recently,
// instead of one tab's stale view blindly stomping a newer one it never saw.
// Site build: chrome.storage.onChanged has no equivalent-shaped listener,
// but the browser's native 'storage' event fires on every OTHER tab/window
// on the same origin whenever localStorage changes — same cross-tab-sync
// purpose, just keyed by localStorage key name (event.key) instead of a
// changes object, and only reachable via localStorage (never fires for the
// tab that made the write itself, exactly like chrome.storage.onChanged).
try{
  if(isExtension && chrome?.storage?.onChanged){
    chrome.storage.onChanged.addListener(changes=>{
      if(changes.SCIMATracker?.newValue){ state.trackerState=sanitizeState(changes.SCIMATracker.newValue); renderSidebar(); }
      if(changes.mf_state?.newValue){
        const mf=sanitizeMfState(changes.mf_state.newValue);
        state.decks=mf.decks;
        state.folders=mf.folders;
        state.sources=mf.sources;
        state.libraryFolders=mf.libraryFolders;
        state.reviewHistory=mf.reviewHistory;
        state.achievements=mf.achievements;
        state.recentStudyScopes=mf.recentStudyScopes;
        Object.assign(state.settings, mf.settings);
        renderSidebar();
      }
    });
  } else {
    window.addEventListener('storage', e=>{
      if(e.key==='SCIMATracker' && e.newValue){
        try{ state.trackerState=sanitizeState(JSON.parse(e.newValue)); renderSidebar(); }
        catch(err){ console.warn('[SCIMA] cross-tab SCIMATracker sync: bad JSON', err); }
      }
      if(e.key==='mf_state' && e.newValue){
        try{
          const mf=sanitizeMfState(JSON.parse(e.newValue));
          state.decks=mf.decks;
          state.folders=mf.folders;
          state.sources=mf.sources;
          state.libraryFolders=mf.libraryFolders;
          state.reviewHistory=mf.reviewHistory;
          state.achievements=mf.achievements;
          state.recentStudyScopes=mf.recentStudyScopes;
          Object.assign(state.settings, mf.settings);
          renderSidebar();
        }catch(err){ console.warn('[SCIMA] cross-tab mf_state sync: bad JSON', err); }
      }
    });
  }
}catch(e){ console.warn('[SCIMA] failed to register cross-tab sync listener — changes made in another tab may not appear here until reload:', e); }

init();
