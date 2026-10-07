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

   SITE PORT NOTES: ported verbatim, no changes. Purely state/DOM overlay
   logic — no chrome.* APIs anywhere in this file. The sidebar-tour step
   still references 'tracker-overview' as one of its stops; that's fine —
   it'll show the tracker stub's "isn't in this build yet" placeholder like
   any other not-yet-ported tab, same as clicking it directly would. */

const TUTORIAL_VERSION = 1;

// Each step: { title, body, selector (or resolver fn), waitFor: 'click'|'next',
// beforeShow: optional fn run before positioning (e.g. navigate to a view),
// sidebarWalk: optional array for the "sidebar tour" composite step }.
const TUTORIAL_STEPS = [
  {
    title: 'Welcome to SCIMA Learning',
    body: 'Your adaptive flashcard and reading companion. This quick tour covers decks, flashcards, studying, the sidebar, and shortcuts — about a minute, skip anytime.',
    waitFor: 'next',
  },
  {
    title: 'Create a deck',
    body: 'Decks organize your flashcards by topic. Click + New Deck to create your first one.',
    selector: '#tutorial-target-new-deck',
    waitFor: 'click',
    opensModal: true, // just opens the create-deck modal — nothing persisted yet
    beforeShow: () => { state.deckNav = { view: 'subjects', subjectKey: null, folderId: null }; navigate('decks'); },
  },
  {
    title: 'Name your deck',
    body: 'Type a name for your deck here, then click Next.',
    selector: '#tutorial-target-deck-name-input',
    waitFor: 'input',
  },
  {
    title: 'Create the deck',
    body: 'Icon, subject, and folder are optional \u2014 defaults are fine for now. Click Create Deck to finish.',
    selector: '#tutorial-target-create-deck-submit',
    waitFor: 'click',
    waitForModalClose: true,
    irreversible: true, // deck now exists — going Back can't undo that
  },
  {
    title: 'Add a flashcard',
    body: "That's your deck. Now click + Add Card to add your first flashcard.",
    selector: '#tutorial-target-add-card',
    waitFor: 'click',
    opensModal: true, // opens the add-card modal — nothing persisted yet
    beforeShow: () => { const d = state.decks[state.decks.length - 1]; if (d) { navigate('decks'); openDeckDetail(d.id); } },
  },
  {
    title: 'Write the question',
    body: 'Type the front of the card \u2014 the question or prompt \u2014 then click Next.',
    selector: '#tutorial-target-card-front-input',
    waitFor: 'input',
  },
  {
    title: 'Write the answer',
    body: 'Type the back of the card \u2014 the answer \u2014 then click Next.',
    selector: '#tutorial-target-card-back-input',
    waitFor: 'input',
  },
  {
    title: 'Save the card',
    body: 'Click Add Card to save it to the deck.',
    selector: '#modal-box .btn-primary',
    waitFor: 'click',
    waitForModalClose: true,
    irreversible: true, // card now exists — going Back can't undo that
  },
  {
    title: 'Start studying',
    body: 'Click Start on SRS Review to begin a session with the card you just made.',
    selector: '#tutorial-target-study-start',
    waitFor: 'click',
    beforeShow: () => navigate('study'),
    irreversible: true, // session has begun — going Back can't undo that
  },
  {
    title: 'Flip the card',
    body: 'Click the card to reveal the answer.',
    selector: '.flashcard',
    waitFor: 'click',
    irreversible: true, // card is now flipped — going Back can't undo that
  },
  {
    title: 'Rate yourself',
    body: 'Rate how well you knew it — this decides when you\u2019ll see it again.',
    selector: '.rating-grid',
    waitFor: 'click',
    irreversible: true, // rating commits and advances the session — going Back can't undo that
  },
  {
    title: 'Your sidebar',
    body: '',
    waitFor: 'next',
    sidebarWalk: [
      { view: 'home', blurb: 'Home — your daily snapshot: what\u2019s due, streaks, and quick shortcuts into recent decks.' },
      { view: 'decks', blurb: 'Decks — where your flashcard decks and folders live, organized by subject.' },
      { view: 'study', blurb: 'Study — launches a review session across one deck, a folder, or everything due today.' },
      { view: 'library', blurb: 'Library — your imported books and articles, for reading and capturing new cards as you go.' },
      { view: 'analytics', blurb: 'Analytics — charts on retention, streaks, and time studied.' },
      { view: 'quests', blurb: 'Quests — daily and milestone challenges that reward XP for consistent studying.' },
      { view: 'settings', blurb: 'Settings — algorithm, theme, accessibility, data import/export, and sidebar customization.' },
      { view: 'tracker-overview', blurb: 'Mark Tracker — a separate grade tracker: log scores, review history, and manage subjects.' },
    ],
  },
  {
    title: 'Keyboard shortcuts',
    body: '\u2318/Ctrl+K opens the command palette. Alt+Shift+1\u20139 jumps straight to a sidebar tab. Esc closes any dialog. \u2318/Ctrl+Enter submits a typed quiz answer.\nCtrl+Shift+F opens this dashboard. Ctrl+Shift+Z creates a flashcard with the text selected, while Ctrl+Shift+X defines the selected text.',
    waitFor: 'next',
  },
  {
    title: "You're all set",
    body: 'Replay this anytime from Settings \u2192 Help \u2192 Replay tutorial.',
    waitFor: 'next',
  },
];

let _tut = null; // { stepIdx, sidebarSub, cleanupFns }

function startTutorial(fromStep = 0) {
  endTutorial(); // tear down any stray previous instance first
  _tut = {
    stepIdx: fromStep,
    sidebarSub: 0,
    cleanupFns: [],
    modalOpenStepIdx: null, // index of the step whose click opened the currently-open modal, or null
  };
  _buildOverlaySkeleton();
  _renderTutorialStep();
}

function endTutorial() {
  if (!_tut) return;
  if (_tut._clickListener) document.removeEventListener('click', _tut._clickListener, true);
  if (_tut._inputListener?.target) _tut._inputListener.target.removeEventListener('input', _tut._inputListener.fn);
  _tut.cleanupFns.forEach(fn => { try { fn(); } catch (e) {} });
  document.getElementById('tutorial-overlay')?.remove();
  _tut = null;
  state.settings.onboarding = state.settings.onboarding || {};
  state.settings.onboarding.completed = true;
  state.settings.onboarding.step = 0;
  state.settings.onboarding.version = TUTORIAL_VERSION;
  scheduleSave();
}

function _skipTutorial() { endTutorial(); showToast('Tutorial skipped \u2014 replay anytime in Settings'); }

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

function _currentStep() {
  const step = TUTORIAL_STEPS[_tut.stepIdx];
  if (step?.sidebarWalk) {
    const sub = step.sidebarWalk[_tut.sidebarSub];
    return { ...step, body: sub.blurb, selector: `[data-view="${sub.view}"]` };
  }
  return step;
}

function _renderTutorialStep() {
  if (_reconcileModalState()) return; // redirected to the modal-opening step; it already re-rendered
  const step = TUTORIAL_STEPS[_tut.stepIdx];
  if (!step) { endTutorial(); return; }
  step.beforeShow?.();

  // Composite "sidebar tour" step auto-advances through its own sub-list on Next.
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
  const atSubStart = !TUTORIAL_STEPS[_tut.stepIdx].sidebarWalk || _tut.sidebarSub === 0;
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
  if (step?.sidebarWalk && _tut.sidebarSub < step.sidebarWalk.length - 1) {
    _tut.sidebarSub++;
  } else {
    _tut.stepIdx++;
    _tut.sidebarSub = 0;
  }
  if (_tut.stepIdx >= TUTORIAL_STEPS.length) { endTutorial(); return; }
  state.settings.onboarding.step = _tut.stepIdx;
  // Deliberately NOT calling scheduleSave() here: it shares one debounce
  // timer with every real save in the app (creating the deck/card you just
  // made included). Calling it on every tutorial step advance kept resetting
  // that timer, so if you clicked through steps faster than 600ms apart, the
  // save that included your new deck/card kept getting pushed back — and
  // could be lost entirely if the tab closed before it ever got a quiet
  // 600ms. The step number will simply piggyback on the next real save.
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
    const destIdx = _tut.stepIdx - 1;
    _closeModalIfOpenSince(destIdx);
    _tut.stepIdx = destIdx;
    _tut.sidebarSub = 0;
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
