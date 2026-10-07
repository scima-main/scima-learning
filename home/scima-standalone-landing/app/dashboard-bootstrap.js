'use strict';
/* dashboard-bootstrap.js — MUST load last of the dashboard-*.js files.
   Theme scheduler, init(), the cross-tab storage.onChanged listener, the
   multi-page site build's pagehide/pageshow persistence seams, and the
   final init() call that actually starts the app — this is the only one of
   the split files with real top-level executing code, which is why load
   order matters for this one specifically. See dashboard-core.js's header
   for the full rationale. Every site-only branch here is gated on
   window.SCIMA_PAGE (declared by the site's .html pages only) and/or
   !isExtension, so this file still runs unmodified inside the extension
   build, where all views live in one document and none of the cross-page
   handoff machinery applies. */

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

  // ── Multi-page site build: view routing + carried-over state ──────────
  // (No-ops in the extension build — SCIMA_PAGE is only declared by the
  // site's .html pages, and PAGE_VIEWS defaults to every view there.)
  const isSitePage = !isExtension && !!window.SCIMA_PAGE;
  // This page's in-memory view state, saved on the last pagehide (below):
  // the bits the SPA kept alive across in-document view switches that aren't
  // part of mf_state — the active study session, study scope/refine, the
  // decks sub-navigation position, capture's last-used deck ids, the quests
  // tab. Restored per-page so "leave and come back" behaves like it did when
  // every view shared one document.
  if (isSitePage) {
    state.view = PAGE_VIEWS[0];
    try {
      const mem = JSON.parse(sessionStorage.getItem(`scima_pagemem_${CURRENT_PAGE}`) || 'null');
      if (mem) {
        if (mem.studyScope)  state.studyScope = mem.studyScope;
        if (mem.studyRefine) state.studyRefine = mem.studyRefine;
        if (mem.deckNav)     state.deckNav = mem.deckNav;
        if (mem.studySession && typeof studySession !== 'undefined' && !studySession) studySession = mem.studySession;
        if (mem.lastQuickAddDeckId != null && typeof _lastQuickAddDeckId !== 'undefined') _lastQuickAddDeckId = mem.lastQuickAddDeckId;
        if (mem.lastAIGenerateDeckId != null && typeof _lastAIGenerateDeckId !== 'undefined') _lastAIGenerateDeckId = mem.lastAIGenerateDeckId;
        if (mem.lastQuestsTab && typeof _lastQuestsTab !== 'undefined') _lastQuestsTab = mem.lastQuestsTab;
      }
    } catch (e) { console.warn('[SCIMA] page-memory restore failed — opening with defaults:', e); }
  }

  // Cross-page handoff written by gotoViewPage() on the page we came from
  // (a "Study Now" scope, a tour step's deckNav reset, a deck to open…).
  // Applied after the page memory so an explicit navigation intent wins.
  const navHandoff = isSitePage ? readNavHandoff() : null;
  if (navHandoff && NAV_ITEMS.some(n => n.id === navHandoff.view) && PAGE_VIEWS.includes(navHandoff.view)) {
    if (navHandoff.studyScope)  state.studyScope = navHandoff.studyScope;
    if (navHandoff.studyRefine) state.studyRefine = navHandoff.studyRefine;
    if (navHandoff.deckNav)     state.deckNav = navHandoff.deckNav;
  }

  const hash=location.hash.replace('#','');
  if(hash&&NAV_ITEMS.some(n=>n.id===hash)){
    if (PAGE_VIEWS.includes(hash)) {
      state.view=hash;
    } else if (isSitePage) {
      // Legacy/deep link (e.g. an old index.html#decks bookmark, or a
      // hand-typed URL): this view lives on another page now — send the
      // browser there instead of rendering nothing. replace(), not href=,
      // so the wrong page doesn't stay in the history stack.
      location.replace(urlForView(hash));
      return;
    }
  }

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
  // A cross-page openDeckDetail() (sidebar pinned deck, tour step) asked the
  // decks page to open straight into a deck's detail view — now that the real
  // openDeckDetail() from dashboard-decks.js is loaded and the decks view has
  // rendered, honour it (same end state as the SPA's synchronous
  // navigate('decks') + openDeckDetail(id) one-two).
  if (navHandoff?.openDeckId && PAGE_VIEWS.includes('decks')) openDeckDetail(navHandoff.openDeckId);
  checkAchievements();
  if (!isSitePage) {
    notifyClaimableAchievements();
  } else {
    // The SPA fired this once per tab load (init ran once per document).
    // With one init() per page, gate it to once per tab session so the
    // "achievements ready to claim" toast doesn't re-pop on every navigation.
    try {
      if (!sessionStorage.getItem('scima_achv_notified')) {
        sessionStorage.setItem('scima_achv_notified', '1');
        notifyClaimableAchievements();
      }
    } catch (e) { notifyClaimableAchievements(); }
  }

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

// ── Multi-page site build: persist across the page swap ─────────────────
// Site pages only (never runs in the extension build, whose dashboard.html
// is a single document that keeps all of this in memory):
//  - pagehide: flush any pending debounced save (the 600ms timer dies with
//    the page), then snapshot this page's in-memory view state — the bits
//    the SPA carried across view switches without persisting them to
//    mf_state — so init() above can restore them when the user comes back.
//  - pageshow from the back/forward cache: reload, because a bfcache
//    restore replays a stale document (stale state, dead listeners) where
//    the SPA always had the live one.
if (!isExtension && window.SCIMA_PAGE) {
  window.addEventListener('pagehide', () => {
    flushSave();
    try {
      const mem = {};
      if (PAGE_VIEWS.includes('study')) {
        mem.studyScope = state.studyScope;
        mem.studyRefine = state.studyRefine;
        if (typeof studySession !== 'undefined' && studySession && studySession.active) mem.studySession = studySession;
      }
      if (PAGE_VIEWS.includes('decks')) mem.deckNav = state.deckNav;
      if (PAGE_VIEWS.includes('capture')) {
        if (typeof _lastQuickAddDeckId !== 'undefined') mem.lastQuickAddDeckId = _lastQuickAddDeckId;
        if (typeof _lastAIGenerateDeckId !== 'undefined') mem.lastAIGenerateDeckId = _lastAIGenerateDeckId;
      }
      if (PAGE_VIEWS.includes('quests') && typeof _lastQuestsTab !== 'undefined') mem.lastQuestsTab = _lastQuestsTab;
      const key = `scima_pagemem_${CURRENT_PAGE}`;
      try { sessionStorage.setItem(key, JSON.stringify(mem)); }
      catch (quotaErr) {
        // A study queue full of image-backed cards can outgrow sessionStorage —
        // drop the session (the only bulky field) and keep the lightweight bits.
        delete mem.studySession;
        try { sessionStorage.setItem(key, JSON.stringify(mem)); } catch (e2) {}
      }
    } catch (e) { console.warn('[SCIMA] page-memory save failed:', e); }
  });
  window.addEventListener('pageshow', e => { if (e.persisted) location.reload(); });
}

init();
