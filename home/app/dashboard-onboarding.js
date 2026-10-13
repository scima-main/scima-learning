'use strict';
/* dashboard-onboarding.js — skippable guided tour: dims the screen, spotlights
   one real UI element at a time, draws an arrow at it, and either waits for
   the user to actually click it or shows a Next button for read-only steps.
   Loads before dashboard-bootstrap.js (see dashboard.html's <script> order /
   dashboard-core.js's load-order comment). Only needs `state`, `el`, `btn`,
   `navigate`, `scheduleSave`, `NAV_ITEMS`/getVisibleNavItems from
   dashboard-core.js — none of this file's own top-level code runs until
   startTutorial() is called (from bootstrap's init(), or later from
   Settings), so it doesn't matter that dashboard-bootstrap.js itself loads
   after this file.

   SITE PORT NOTES: pure state/DOM overlay logic — no chrome.* APIs anywhere in
   this file. Two seams do care about the multi-page site build, where each nav
   tab is its own document:
     • a step that needs another route calls navigate(), which becomes a real
       page load; bootstrap's init() resumes the tour at the saved step on
       arrival (see TUTORIAL_VERSION / onboarding.step below);
     • the tour sandbox (see "TOUR SANDBOX") uses sessionStorage, which is
       per-tab and survives same-tab navigation — exactly the tour's lifetime.
   The nav-walk step opens the nav drawer while it runs (its spotlight targets
   live inside it) and closes it again afterwards — see _renderTutorialStep().

   ── TOUR SANDBOX ───────────────────────────────────────────────────────────
   The tour makes you really click "+ New Deck", really type a card and really
   rate it, because a walkthrough that fakes the clicks teaches nothing. That
   used to leave every new user — and everyone who hit "Replay tutorial" from
   Settings — with a junk deck in their library they then had to find and
   delete. So the tour now snapshots the two storage blobs it can touch
   (mf_state, SCIMATracker) into sessionStorage before its first step, and
     • Finish  → the snapshot is dropped and everything you made is kept;
     • Discard → the snapshot is written back verbatim, so the practice deck
                 and its card vanish (subjects you added are carried across);
     • Skip    → same as Discard, plus the catch-all Miscellaneous subject is
                 auto-created, since you never reached the step that makes it.
   Restoring is a straight setItem() of the exact backed-up string — no parse,
   no merge — so a bug here can't corrupt your data, only decline to clean up.
   If no snapshot exists (tour abandoned by closing the tab, which takes
   sessionStorage with it) every restore path is a no-op. */

// Bumped whenever the step list changes in a way that should re-run the tour
// for people who already finished an older one. Left alone for step insertions
// that only affect mid-tour resumes — onboarding.stepCount (below) catches those
// without making everyone sit through the whole thing again.
const TUTORIAL_VERSION = 1;

// Per-tab sessionStorage key holding { mf, tracker } as raw strings, exactly as
// they were before the tour's first mutation. See the header note.
const TOUR_BACKUP_KEY = 'scima_tour_backup';

// Per-tab sessionStorage key holding { step, stepCount, version, origin } for a
// tour currently in flight. In the multi-page site build a step that needs
// another route is a real page load, so "resume me at step N" has to live
// somewhere that survives the swap. sessionStorage rather than
// state.settings.onboarding because a REPLAYED tour runs for a user whose
// onboarding is already flagged completed — init()'s `!ob.completed` test can't
// distinguish "resume me" from "don't start", which silently killed any replay
// at its first route change. It also gives the right lifetime for free: closing
// the tab abandons the tour, exactly when the sandbox snapshot dies with it.
const TOUR_ACTIVE_KEY = 'scima_tour_active';

// Sidebar-walk blurbs, keyed by nav id. The walk itself is built from
// getVisibleNavItems() rather than a hardcoded list, so it can't drift when a
// tab is added, renamed or reordered (it used to — Community was missing
// entirely) and it respects the user's own tab order and hidden tabs.
const NAV_BLURBS = {
  home:      'Home — your daily snapshot: what\u2019s due, retention, your streak and the daily goal, with Study Now on each deck.',
  decks:     'Decks — your flashcards, grouped by subject and folder. "+ New Deck" also has Import JSON, Import Text and an ✨ AI Capture tab that writes cards from pasted text.',
  study:     'Study — launches a review session across one deck, a folder, a subject or everything due today, in six modes.',
  library:   'Library — imported books, PDFs and articles to read, highlight and cite straight into cards.',
  analytics: 'Analytics — retention, streak and study-time charts, with Quests and achievements on the same page.',
  community: 'Community — search decks other people have shared and add one to your own library in a click.',
  settings:  'Settings — algorithm, subjects, theme and schedule, accessibility, AI card generation, scratchpad defaults, navigation, and data import/export.',
  about:     'About — what this app is and what changed, rendered live from the ABOUT.md file at the site root.',
};

// Each step: { title, body, selector (or resolver fn), waitFor: 'click'|'input'|'next',
// view: optional route this step must be on (navigated to if we're not there —
//   makes a tour resumed after a manual reload self-heal instead of pointing at
//   a selector that isn't on this page),
// beforeShow: optional fn run before positioning (extra setup after navigating),
// sidebarWalk: true for the composite "your menu" step,
// skipIf: optional fn — when it returns true the step auto-advances instead of
//   rendering (used by the subject-creation group, which is pointless once the
//   catch-all subject already exists — a replay for an existing user would
//   otherwise dead-end on "you already have a subject called Miscellaneous"),
// extraButtons: optional [{ label, variant, onclick }] added to the controls row }.
const TUTORIAL_STEPS = [
  {
    title: 'Welcome to SCIMA Learning',
    body: 'Your adaptive flashcard and reading companion. This quick tour walks you through subjects, decks, flashcards, studying, the menu and the shortcuts \u2014 about two minutes, and you can skip it at any point.',
    waitFor: 'next',
  },

  // ── Subjects ────────────────────────────────────────────────────────────
  // Deliberately first: the create-deck modal has a Subject dropdown, and
  // Miscellaneous is no longer a built-in default (see shared.js's SUBJECTS),
  // so a brand-new user has nothing sensible to file their first deck under
  // until they make one.
  {
    title: 'Set up your subjects',
    body: 'Subjects are how SCIMA groups your decks \u2014 one per course, topic, or anything else you study. They live here in Settings, where you can add, rename, recolour or hide them at any time.',
    selector: '#tutorial-target-subjects-card',
    view: 'settings',
    waitFor: 'next',
     skipIf: _catchAllSubjectExists,
  },
  {
    title: 'Add your first subject',
    body: 'Click + Add Subject. Most people start with a catch-all \u2014 "Miscellaneous" \u2014 for anything that doesn\u2019t belong to a course yet, then add real subjects as they go.',
    selector: '#tutorial-target-add-subject',
    view: 'settings',
    waitFor: 'click',
    opensModal: true, // opens the add-subject modal — nothing persisted yet
     skipIf: _catchAllSubjectExists,
  },
  {
    title: 'Name it',
    body: 'Type a name \u2014 try "Miscellaneous". Short name, exam board, marks and colour are all optional; the defaults are fine for now.',
    selector: '#tutorial-target-subject-name-input',
    view: 'settings',
    waitFor: 'input',
     skipIf: _catchAllSubjectExists,
  },
  {
    title: 'Save the subject',
    body: 'Click Add Subject to save it. It\u2019ll be waiting in the Subject dropdown when you create a deck in a moment.',
    selector: '#tutorial-target-subject-submit',
    view: 'settings',
    waitFor: 'click',
    waitForModalClose: true,
    irreversible: true, // subject now exists — going Back can't undo that
     skipIf: _catchAllSubjectExists,
  },

  // ── Deck + first card ───────────────────────────────────────────────────
  {
    title: 'Create a deck',
    body: 'Decks organize your flashcards by topic. Click + New Deck to create your first one.',
    selector: '#tutorial-target-new-deck',
    view: 'decks',
    waitFor: 'click',
    opensModal: true, // just opens the create-deck modal — nothing persisted yet
    beforeShow: () => { state.deckNav = { view: 'subjects', subjectKey: null, folderId: null }; },
  },
  {
    title: 'Name your deck',
    body: 'Type a name for your deck here, then click Next.',
    selector: '#tutorial-target-deck-name-input',
    view: 'decks',
    waitFor: 'input',
  },
  {
    title: 'Create the deck',
    body: 'Icon and folder are optional. The Subject dropdown is set to the one you just made \u2014 change it if you like. Click Create Deck to finish.',
    selector: '#tutorial-target-create-deck-submit',
    view: 'decks',
    waitFor: 'click',
    waitForModalClose: true,
    irreversible: true, // deck now exists — going Back can't undo that
  },
  {
    title: 'Add a flashcard',
    body: "That's your deck. Now click + Add Card to add your first flashcard.",
    selector: '#tutorial-target-add-card',
    view: 'decks',
    waitFor: 'click',
    opensModal: true, // opens the add-card modal — nothing persisted yet
    beforeShow: () => { const d = state.decks[state.decks.length - 1]; if (d) openDeckDetail(d.id); },
  },
  {
    title: 'Write the question',
    body: 'Type the front of the card \u2014 the question or prompt \u2014 then click Next. The Basic card type is right for most things; Mark scheme, Process, Calculation and Table are there when you need them.',
    selector: '#tutorial-target-card-front-input',
    view: 'decks',
    waitFor: 'input',
  },
  {
    title: 'Write the answer',
    body: 'Type the back of the card \u2014 the answer \u2014 then click Next.',
    selector: '#tutorial-target-card-back-input',
    view: 'decks',
    waitFor: 'input',
  },
  {
    title: 'Save the card',
    body: 'Click Add Card to save it to the deck.',
    selector: '#modal-box .btn-primary',
    view: 'decks',
    waitFor: 'click',
    waitForModalClose: true,
    irreversible: true, // card now exists — going Back can't undo that
  },

  // ── Study ───────────────────────────────────────────────────────────────
  {
    title: 'Start studying',
    body: 'Click Start on SRS Review to begin a session with the card you just made.',
    selector: '#tutorial-target-study-start',
    view: 'study',
    waitFor: 'click',
    irreversible: true, // session has begun — going Back can't undo that
  },
  {
    title: 'Flip the card',
    body: 'Click the card to reveal the answer. The ✍️ button beside the hint opens a scratchpad if you want to work something out first.',
    selector: '.flashcard',
    view: 'study',
    waitFor: 'click',
    irreversible: true, // card is now flipped — going Back can't undo that
  },
  {
    title: 'Rate yourself',
    body: 'Rate how well you knew it \u2014 the label under each button is when the algorithm (FSRS or SM-2, your choice in Settings) will show it to you again.',
    selector: '.rating-grid',
    view: 'study',
    waitFor: 'click',
    irreversible: true, // rating commits and advances the session — going Back can't undo that
  },

  // ── Orientation ─────────────────────────────────────────────────────────
  {
    title: 'Your menu',
    body: '',
    waitFor: 'next',
    sidebarWalk: true, // sub-list built live from getVisibleNavItems()
  },
  {
    title: 'Keyboard shortcuts',
    body: '\u2318/Ctrl+K opens the command palette. Alt+Shift+1\u20139 jumps to a sidebar tab, in your own order. Esc closes any dialog, modal or the menu. \u2318/Ctrl+Enter submits a typed answer in Written Quiz.\nIn a study session, Ctrl/⌘+Alt+S opens the scratchpad; inside it, Ctrl+Z / Ctrl+Shift+Z undo and redo.',
    waitFor: 'next',
  },
  {
    title: "You're all set",
    body: 'Everything you just made is real \u2014 keep it, or throw the practice deck away and start clean. Replay this tour anytime from Settings \u2192 Help.',
    waitFor: 'next',
    extraButtons: [{
      label: 'Discard practice deck',
      variant: 'ghost',
      title: 'Delete the deck and card this tour created, keeping your subject',
      onclick: () => endTutorial('discard'),
    }],
  },
];

/** True once the catch-all subject exists, i.e. once the four subject-creation
 *  steps have nothing left to teach. Re-evaluated on every render rather than
 *  baked into the step list, so the list (and therefore stepCount, which
 *  bootstrap uses to validate a saved resume index) never changes shape. */
function _catchAllSubjectExists() {
  try { return !!getAllSubjects()[DEFAULT_SUBJECT_KEY]; } catch (e) { return false; }
}

/** Does the step at `idx` want to be skipped right now? Never throws. */
function _shouldSkipStep(idx) {
  const st = TUTORIAL_STEPS[idx];
  if (!st || typeof st.skipIf !== 'function') return false;
  try { return !!st.skipIf(); } catch (e) { return false; }
}

let _tut = null; // { stepIdx, sidebarSub, cleanupFns, modalOpenStepIdx }

/* ── Tour sandbox ───────────────────────────────────────────────────────── */

function _sandboxRead() {
  try { return JSON.parse(sessionStorage.getItem(TOUR_BACKUP_KEY) || 'null'); }
  catch (e) { return null; }
}

/** Snapshots the two blobs the tour can mutate. Idempotent on purpose: a tour
 *  that crosses a route boundary re-enters startTutorial() on the new page and
 *  must not overwrite the original pre-tour snapshot with a half-built one.
 *
 *  Site build only. The extension build's real store is chrome.storage.local
 *  (see dashboard-core.js's storage adapter), so a localStorage snapshot there
 *  would capture nothing and "restore" nothing — the sandbox stays inert and
 *  the tour simply behaves as it did before, keeping whatever you made. */
function _sandboxBegin() {
  try { if (typeof isExtension !== 'undefined' && isExtension) return; } catch (e) {}
  try {
    if (sessionStorage.getItem(TOUR_BACKUP_KEY)) return;
    sessionStorage.setItem(TOUR_BACKUP_KEY, JSON.stringify({
      mf: localStorage.getItem('mf_state'),
      tracker: localStorage.getItem('SCIMATracker'),
    }));
  } catch (e) { console.warn('[SCIMA] tour sandbox: snapshot failed — Skip/Discard won\u2019t be able to clean up:', e); }
}

function _sandboxDrop() {
  try { sessionStorage.removeItem(TOUR_BACKUP_KEY); } catch (e) {}
}

/* ── Cross-route resume marker ─────────────────────────────────────────── */

function _markTourActive() {
  if (!_tut) return;
  try {
    sessionStorage.setItem(TOUR_ACTIVE_KEY, JSON.stringify({
      step: _tut.stepIdx, stepCount: TUTORIAL_STEPS.length,
      version: TUTORIAL_VERSION, origin: _tut.origin || 'replay',
    }));
  } catch (e) {}
}

function _clearTourActive() {
  try { sessionStorage.removeItem(TOUR_ACTIVE_KEY); } catch (e) {}
}

/** For bootstrap's init(): a tour this tab was mid-way through when the page
 *  swapped underneath it. Returns { step, origin } to resume, or null. A marker
 *  written by a different tour version/shape is dropped rather than resumed,
 *  since its step index would point somewhere else entirely. */
function pendingTourResume() {
  let act = null;
  try { act = JSON.parse(sessionStorage.getItem(TOUR_ACTIVE_KEY) || 'null'); } catch (e) { act = null; }
  if (!act) return null;
  if (act.version !== TUTORIAL_VERSION || act.stepCount !== TUTORIAL_STEPS.length) { _clearTourActive(); return null; }
  return { step: Math.max(0, Math.min(act.step | 0, TUTORIAL_STEPS.length - 1)), origin: act.origin || 'replay' };
}

/** Custom-subject keys that exist now but didn't before the tour. Used by the
 *  discard path so a subject you deliberately created in Settings survives
 *  rolling the rest of your data back. */
function _subjectsAddedSince(snap) {
  const now = state.trackerState?.config?.customSubjects || {};
  let before = {};
  try { before = JSON.parse(snap.tracker || '{}')?.config?.customSubjects || {}; } catch (e) {}
  return Object.keys(now).filter(k => !before[k] && !now[k]?._removed);
}

/** Writes the snapshot back over localStorage. `carrySubjectKeys` re-applies
 *  those custom subjects on top of the restored tracker blob afterwards. */
function _sandboxRestore(carrySubjectKeys) {
  const snap = _sandboxRead();
  if (!snap) return false; // nothing to restore — no-op, never a destructive guess
  const carried = (carrySubjectKeys || []).reduce((acc, k) => {
    const rec = state.trackerState?.config?.customSubjects?.[k];
    if (rec) acc[k] = { ...rec };
    return acc;
  }, {});

  let trackerBlob = snap.tracker;
  if (Object.keys(carried).length) {
    try {
      const t = JSON.parse(snap.tracker || '{}');
      t.config = t.config || {};
      t.config.customSubjects = { ...(t.config.customSubjects || {}), ...carried };
      trackerBlob = JSON.stringify(t);
    } catch (e) { trackerBlob = snap.tracker; } // unparseable: restore verbatim, drop the carry
  }

  // Onboarding flags live inside mf_state, which we're about to overwrite with
  // the pre-tour copy — stamp the finished state back on so the tour doesn't
  // immediately restart on the next load.
  let mfBlob = snap.mf;
  try {
    const mf = JSON.parse(snap.mf || '{}');
    mf.settings = mf.settings || {};
    mf.settings.onboarding = _finishedOnboardingRecord();
    mfBlob = JSON.stringify(mf);
  } catch (e) { mfBlob = snap.mf; }

  try {
    if (mfBlob == null) localStorage.removeItem('mf_state'); else localStorage.setItem('mf_state', mfBlob);
    if (trackerBlob == null) localStorage.removeItem('SCIMATracker'); else localStorage.setItem('SCIMATracker', trackerBlob);
  } catch (e) { console.warn('[SCIMA] tour sandbox: restore failed:', e); return false; }
  return true;
}

function _finishedOnboardingRecord() {
  return { completed: true, step: 0, version: TUTORIAL_VERSION, stepCount: TUTORIAL_STEPS.length };
}

/* ── Public entry points ────────────────────────────────────────────────── */

/** @param {number} fromStep  @param {'first-run'|'replay'} origin — 'first-run'
 *  is the only origin that leaves the catch-all subject out until the tour (or a
 *  skip) creates it; a replay always runs against whatever you already have. */
function startTutorial(fromStep = 0, origin = 'replay') {
  endTutorial('teardown'); // tear down any stray previous instance first
  _sandboxBegin();
  _tut = {
    stepIdx: Math.max(0, Math.min(fromStep, TUTORIAL_STEPS.length - 1)),
    sidebarSub: 0,
    cleanupFns: [],
    origin,
    modalOpenStepIdx: null, // index of the step whose click opened the currently-open modal, or null
  };
  _buildOverlaySkeleton();
  _renderTutorialStep();
}

/** @param {'finish'|'discard'|'skip'|'teardown'} reason
 *  Async only because the discard/skip paths re-read storage after rolling it
 *  back; every caller is a click handler that doesn't await it. */
async function endTutorial(reason = 'finish') {
  if (reason === 'teardown') { _teardownOverlay(); return; }
  if (!_tut) return;
  _teardownOverlay();
  _clearTourActive();

  const snap = _sandboxRead();
  const addedSubjects = snap ? _subjectsAddedSince(snap) : [];
  let rolledBack = false;

  if (reason === 'finish') {
    // Keep everything the user made; the snapshot has no further use.
    _sandboxDrop();
  } else if (snap) {
    // 'discard' keeps subjects (they were a deliberate Settings change);
    // 'skip' never reached that step, so it seeds the catch-all instead.
    rolledBack = _sandboxRestore(reason === 'discard' ? addedSubjects : []);
    _sandboxDrop();
    if (rolledBack && typeof rehydrateFromStorage === 'function') {
      try { await rehydrateFromStorage(); }
      catch (e) {
        console.warn('[SCIMA] tour sandbox: re-hydrate failed, reloading instead:', e);
        location.reload();
        return;
      }
      // A session started during the tour would still be pointing at cards the
      // rollback just deleted. Declared in dashboard-decks.js, so it only exists
      // on routes that load it.
      try { if (typeof studySession !== 'undefined') studySession = null; } catch (e) {}
      try { state.studyScope = [{ type: 'all', id: null }]; } catch (e) {}
    }
  } else {
    _sandboxDrop();
  }

  if (reason === 'skip' && typeof ensureMiscSubject === 'function') {
    // Skipped before the Subjects step could run — create the catch-all so
    // untagged decks still have somewhere to live (see shared.js's SUBJECTS note).
    ensureMiscSubject();
  }

  state.settings.onboarding = _finishedOnboardingRecord();
  // flushSave, not scheduleSave: the tour is over and nothing else is about to
  // write, so there's no reason to leave the finished flag (and a rollback)
  // sitting in a 600ms debounce that a tab close could swallow.
  flushSave(true);
  try { renderSidebar(); } catch (e) {}
  try { renderView(state.view); } catch (e) {}
  return rolledBack;
}

function _teardownOverlay() {
  if (!_tut) return;
  if (_tut._clickListener) document.removeEventListener('click', _tut._clickListener, true);
  if (_tut._inputListener?.target) _tut._inputListener.target.removeEventListener('input', _tut._inputListener.fn);
  _tut.cleanupFns.forEach(fn => { try { fn(); } catch (e) {} });
  document.getElementById('tutorial-overlay')?.remove();
  const wasTouring = !!_tut;
  _tut = null;
  return wasTouring;
}

function _skipTutorial() {
  endTutorial('skip');
  showToast('Tutorial skipped \u2014 replay anytime in Settings');
}

function _buildOverlaySkeleton() {
  const overlay = el('div', { id: 'tutorial-overlay' },
    el('div', { class: 'tutorial-dim', id: 'tut-dim-top' }),
    el('div', { class: 'tutorial-dim', id: 'tut-dim-bottom' }),
    el('div', { class: 'tutorial-dim', id: 'tut-dim-left' }),
    el('div', { class: 'tutorial-dim', id: 'tut-dim-right' }),
    el('div', { id: 'tutorial-ring' }),
    el('div', { id: 'tutorial-arrow' }),
    el('div', { id: 'tutorial-card' })
  );
  document.body.appendChild(overlay);

  const onResize = () => _positionOverlay();
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onResize, true);
  _tut.cleanupFns.push(() => {
    window.removeEventListener('resize', onResize);
    window.removeEventListener('scroll', onResize, true);
  });

  // The modal can only be closed via Esc. Rather than reacting inside a
  // click handler (which risks re-rendering — and detaching — the very
  // button whose click triggered it, while that click's dispatch is still
  // in flight), just defer one tick after Escape and check the real
  // modal-backdrop state. _reconcileModalState() also runs at the top of
  // every _renderTutorialStep(), so Back navigation self-corrects too.
  const onEscape = (e) => {
    if (e.key !== 'Escape') return;
    setTimeout(() => { if (_tut) _reconcileModalState(); }, 0);
  };
  document.addEventListener('keydown', onEscape);
  _tut.cleanupFns.push(() => document.removeEventListener('keydown', onEscape));
}

// True ground-truth check: is a step active that expects the modal open,
// while the modal (#modal-backdrop) is actually closed? Covers Esc plus any
// other way it might close (backdrop click, × button). If so, send the
// tutorial back to the step that opened it instead of rendering a step
// whose field no longer exists on screen. Returns true if it redirected
// (in which case a fresh render is already underway).
function _reconcileModalState() {
  if (_tut.modalOpenStepIdx == null) return false;
  const step = TUTORIAL_STEPS[_tut.stepIdx];
  const insideModal = _tut.stepIdx > _tut.modalOpenStepIdx || !!step?.waitForModalClose;
  if (!insideModal) return false;
  const backdrop = document.getElementById('modal-backdrop');
  if (backdrop && !backdrop.classList.contains('hidden')) return false; // genuinely still open

  const returnTo = _tut.modalOpenStepIdx;
  _tut.modalOpenStepIdx = null;
  _tut.stepIdx = returnTo;
  _tut.sidebarSub = 0;
  _renderTutorialStep();
  return true;
}

/** The nav-walk step's live sub-list. Built from the tabs the user can actually
 *  see, in their order, so the walk can never name a tab that isn't there or
 *  miss one that is. */
function _sidebarWalkItems() {
  const items = (typeof getVisibleNavItems === 'function') ? getVisibleNavItems() : [];
  return items.map(n => ({
    view: n.id,
    blurb: NAV_BLURBS[n.id] || `${n.label} — one of your sidebar tabs.`,
  }));
}

function _currentStep() {
  const step = TUTORIAL_STEPS[_tut.stepIdx];
  if (step?.sidebarWalk) {
    const walk = _sidebarWalkItems();
    const sub = walk[Math.min(_tut.sidebarSub, Math.max(0, walk.length - 1))];
    if (!sub) return { ...step, body: 'Your sidebar tabs are all reachable from the menu button.', selector: null };
    return { ...step, body: sub.blurb, selector: `[data-view="${sub.view}"]` };
  }
  return step;
}

function _renderTutorialStep() {
  if (_reconcileModalState()) return; // redirected to the modal-opening step; it already re-rendered
  if (!TUTORIAL_STEPS[_tut.stepIdx]) { endTutorial('finish'); return; }

  // A step with nothing left to teach (see skipIf) advances instead of
  // rendering. Bounded so a bad predicate can't spin forever.
  let skipped = 0;
  while (_shouldSkipStep(_tut.stepIdx) && skipped++ < TUTORIAL_STEPS.length) {
    _tut.stepIdx++;
    _tut.sidebarSub = 0;
  }
  const step = TUTORIAL_STEPS[_tut.stepIdx];
  if (!step) { endTutorial('finish'); return; }

  // Written before the navigate() below: in the multi-page site build that call
  // is a real page load, and the new document's init() needs this marker to
  // pick the tour back up at this same step.
  _markTourActive();
  // Land on the route this step points at. A cross-route navigate() is a real
  // page load there, so the rest of this function runs on a document that's
  // about to go away and init() re-renders the same step on arrival (where the
  // check is then a no-op). It also self-heals a tour resumed after a manual
  // reload on the wrong page.
  if (step.view && state.view !== step.view) navigate(step.view);
  step.beforeShow?.();
  // The nav-walk step spotlights tabs that live inside the nav drawer, so
  // the drawer opens for it; every other step gets the viewport to itself.
  if (step.sidebarWalk) openNav(); else closeNav();

  const live = _currentStep();
  _renderCard(live);
  _attachWaitFor(live);
  requestAnimationFrame(() => _positionOverlay(live.selector));
}

function _renderCard(step) {
  const card = document.getElementById('tutorial-card');
  card.innerHTML = '';
  const totalDots = TUTORIAL_STEPS.length;
  const dots = el('div', { class: 'tutorial-dots' });
  for (let i = 0; i < totalDots; i++) dots.appendChild(el('span', { class: `tutorial-dot${i === _tut.stepIdx ? ' active' : ''}` }));

  const isLast = _tut.stepIdx === TUTORIAL_STEPS.length - 1;
  const isFirst = _tut.stepIdx === 0;
  const atSubStart = !step.sidebarWalk || _tut.sidebarSub === 0;
  const prevIrreversible = atSubStart && !!TUTORIAL_STEPS[_tut.stepIdx - 1]?.irreversible;
  const hideBack = isFirst || prevIrreversible;
  const nextBtn = btn(isLast ? 'Finish' : 'Next', 'primary', { small: true, onclick: () => _advance() });
  const backBtn = btn('Back', 'ghost', { small: true, onclick: () => _back() });
  const controls = el('div', { class: 'tutorial-controls' });
  if (!hideBack) controls.appendChild(backBtn);
  if (step.waitFor === 'next') controls.appendChild(nextBtn);
  if (step.waitFor === 'input') {
    const target = step.selector ? document.querySelector(step.selector) : null;
    nextBtn.disabled = !(target && target.value.trim());
    controls.appendChild(nextBtn);
  }
  (step.extraButtons || []).forEach(spec => {
    const b = btn(spec.label, spec.variant || 'ghost', { small: true, onclick: spec.onclick });
    if (spec.title) b.title = spec.title;
    controls.appendChild(b);
  });
  controls.appendChild(btn('Skip tutorial', 'ghost', { small: true, onclick: _skipTutorial }));

  card.append(
    el('div', { class: 'tutorial-title' }, step.title),
    el('div', { class: 'tutorial-body' }, step.body),
    dots,
    controls
  );
}

function _attachWaitFor(step) {
  const prevListener = _tut._clickListener;
  if (prevListener) { document.removeEventListener('click', prevListener, true); _tut._clickListener = null; }
  const prevInputListener = _tut._inputListener;
  if (prevInputListener?.target) prevInputListener.target.removeEventListener('input', prevInputListener.fn);
  _tut._inputListener = null;

  if (step.waitFor === 'input' && step.selector) {
    const target = document.querySelector(step.selector);
    if (!target) return;
    const fn = () => {
      const nextBtn = document.querySelector('#tutorial-card .tutorial-controls .btn-primary');
      if (nextBtn) nextBtn.disabled = !target.value.trim();
    };
    target.addEventListener('input', fn);
    _tut._inputListener = { target, fn };
    return;
  }

  if (step.waitFor !== 'click' || !step.selector) return;

  const listener = (e) => {
    const target = document.querySelector(step.selector);
    if (target && (target === e.target || target.contains(e.target))) {
      if (step.opensModal) _tut.modalOpenStepIdx = _tut.stepIdx;
      if (step.waitForModalClose) {
        // Give the click handler's own validation a beat to run. If it
        // rejected (e.g. empty name) the modal stays open — don't advance,
        // and leave the listener attached so the user can just try again.
        setTimeout(() => {
          const stillOpen = !document.getElementById('modal-backdrop')?.classList.contains('hidden');
          if (stillOpen) return;
          _tut.modalOpenStepIdx = null; // modal is closed and its data is now saved
          document.removeEventListener('click', listener, true);
          _tut._clickListener = null;
          setTimeout(() => _advance(), 30);
        }, 80);
      } else {
        document.removeEventListener('click', listener, true);
        _tut._clickListener = null;
        setTimeout(() => _advance(), 30);
      }
    }
  };
  document.addEventListener('click', listener, true);
  _tut._clickListener = listener;
}

function _advance() {
  const step = TUTORIAL_STEPS[_tut.stepIdx];
  const walkLen = step?.sidebarWalk ? _sidebarWalkItems().length : 0;
  if (step?.sidebarWalk && _tut.sidebarSub < walkLen - 1) {
    _tut.sidebarSub++;
  } else {
    _tut.stepIdx++;
    _tut.sidebarSub = 0;
  }
  if (_tut.stepIdx >= TUTORIAL_STEPS.length) { endTutorial('finish'); return; }
  // stepCount rides along with the step index so bootstrap's init() can tell a
  // resumable mid-tour save from one written by an older, differently-shaped
  // step list (see the comment there).
  state.settings.onboarding = {
    ...(state.settings.onboarding || {}),
    step: _tut.stepIdx,
    stepCount: TUTORIAL_STEPS.length,
    version: TUTORIAL_VERSION,
  };
  // Deliberately NOT calling scheduleSave() here: it shares one debounce
  // timer with every real save in the app (creating the deck/card you just
  // made included). Calling it on every tutorial step advance kept resetting
  // that timer, so if you clicked through steps faster than 600ms apart, the
  // save that included your new deck/card kept getting pushed back — and
  // could be lost entirely if the tab closed before it ever got a quiet
  // 600ms. The step number will simply piggyback on the next real save
  // (and gotoViewPage() force-flushes it before any cross-route hop).
  _renderTutorialStep();
}

// Actually close the app's modal (not just our bookkeeping) when Back is
// taking the user to a step that predates it — otherwise the modal would
// keep sitting open over whatever that earlier step's card is pointing at.
function _closeModalIfOpenSince(destStepIdx) {
  if (_tut.modalOpenStepIdx == null || destStepIdx > _tut.modalOpenStepIdx) return;
  closeModal();
  _tut.modalOpenStepIdx = null;
}

function _back() {
  const step = TUTORIAL_STEPS[_tut.stepIdx];
  if (step?.sidebarWalk && _tut.sidebarSub > 0) {
    _tut.sidebarSub--;
  } else if (_tut.stepIdx > 0) {
    // Walk back past any steps that would immediately auto-skip forward again
    // (see _shouldSkipStep), so Back always lands somewhere that renders.
    let destIdx = _tut.stepIdx - 1;
    while (destIdx > 0 && _shouldSkipStep(destIdx)) destIdx--;
    _closeModalIfOpenSince(destIdx);
    _tut.stepIdx = destIdx;
    const dest = TUTORIAL_STEPS[destIdx];
    _tut.sidebarSub = dest?.sidebarWalk ? Math.max(0, _sidebarWalkItems().length - 1) : 0;
  }
  _renderTutorialStep();
}

function _positionOverlay(selectorOverride) {
  if (!_tut) return;
  const step = _currentStep();
  const selector = selectorOverride || step.selector;
  const target = selector ? document.querySelector(selector) : null;
  const card = document.getElementById('tutorial-card');
  const ring = document.getElementById('tutorial-ring');
  const arrow = document.getElementById('tutorial-arrow');

  if (!target) {
    // Centered welcome/summary/shortcuts steps: full dim, no ring/arrow.
    ['tut-dim-top', 'tut-dim-bottom', 'tut-dim-left', 'tut-dim-right'].forEach((id, i) => {
      const d = document.getElementById(id);
      d.style.cssText = i === 0 ? 'top:0;left:0;right:0;height:100%;' : 'display:none;';
    });
    ring.style.display = 'none';
    arrow.style.display = 'none';
    card.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);';
    return;
  }

  target.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r = target.getBoundingClientRect();
  const pad = 6;
  const vw = window.innerWidth, vh = window.innerHeight;

  document.getElementById('tut-dim-top').style.cssText = `top:0;left:0;right:0;height:${Math.max(0, r.top - pad)}px;display:block;`;
  document.getElementById('tut-dim-bottom').style.cssText = `top:${r.bottom + pad}px;left:0;right:0;bottom:0;display:block;`;
  document.getElementById('tut-dim-left').style.cssText = `top:${r.top - pad}px;left:0;width:${Math.max(0, r.left - pad)}px;height:${r.height + pad * 2}px;display:block;`;
  document.getElementById('tut-dim-right').style.cssText = `top:${r.top - pad}px;left:${r.right + pad}px;right:0;height:${r.height + pad * 2}px;display:block;`;

  ring.style.cssText = `display:block;top:${r.top - pad}px;left:${r.left - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px;`;

  // Prefer placing the card to the side of the target with the most room.
  const roomRight = vw - r.right, roomLeft = r.left, roomBelow = vh - r.bottom, roomAbove = r.top;
  const cardW = 300, cardH = 160;
  let cardTop, cardLeft, arrowRotate, arrowTop, arrowLeft;

  if (roomRight > cardW + 40) {
    cardLeft = r.right + 36; cardTop = Math.min(Math.max(r.top, 12), vh - cardH - 12);
    arrowLeft = r.right + 4; arrowTop = r.top + r.height / 2 - 10; arrowRotate = 90;
  } else if (roomLeft > cardW + 40) {
    cardLeft = r.left - cardW - 36; cardTop = Math.min(Math.max(r.top, 12), vh - cardH - 12);
    arrowLeft = r.left - 32; arrowTop = r.top + r.height / 2 - 10; arrowRotate = 270;
  } else if (roomBelow > cardH + 40) {
    cardTop = r.bottom + 36; cardLeft = Math.min(Math.max(r.left, 12), vw - cardW - 12);
    arrowTop = r.bottom + 4; arrowLeft = r.left + r.width / 2 - 10; arrowRotate = 180;
  } else {
    cardTop = r.top - cardH - 36; cardLeft = Math.min(Math.max(r.left, 12), vw - cardW - 12);
    arrowTop = r.top - 32; arrowLeft = r.left + r.width / 2 - 10; arrowRotate = 0;
  }

  card.style.cssText = `position:fixed;top:${cardTop}px;left:${cardLeft}px;width:${cardW}px;transform:none;`;
  arrow.style.cssText = `display:block;position:fixed;top:${arrowTop}px;left:${arrowLeft}px;transform:rotate(${arrowRotate}deg);`;
  arrow.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20"><path d="M10 2 L10 16 M10 16 L4 10 M10 16 L16 10" stroke="var(--blue)" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
