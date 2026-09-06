'use strict';
/* dashboard-stubs.js — NEW file, not part of the extension build.

   This is the Phase-0/1 site slice: dashboard-core.js, dashboard-home.js,
   dashboard-decks.js, dashboard-study.js, dashboard-library.js,
   dashboard-capture.js, dashboard-analytics.js, dashboard-onboarding.js,
   dashboard-settings.js, and dashboard-bootstrap.js are ported, but
   dashboard-tracker.js is not loaded yet (a separate index.html is planned
   for the Mark Tracker). That leaves one gap:

   renderView()'s trMap (dashboard-core.js) references render functions
   (renderTrackerOverview, ...) that don't exist yet in this build —
   referencing an undefined identifier throws immediately. Every entry below
   exists so clicking any tracker sidebar tab shows an honest placeholder
   instead of a crash. renderDecks/renderStudy/renderLibrary/renderCapture/
   renderAnalytics/renderQuests/renderSettings no longer need stubs —
   they're the real ones now, and checkAchievements/
   notifyClaimableAchievements/startTutorial/TUTORIAL_VERSION now come from
   the real dashboard-analytics.js/dashboard-onboarding.js. Note
   renderTrackerSettings is included here too even though it's
   settings-shaped — it's the Mark Tracker's *own* settings view (algorithm-
   agnostic grade-tracker config), defined in dashboard-tracker.js, not
   dashboard-settings.js, so it stays stubbed until the tracker itself is
   ported.

   Load this AFTER dashboard-core.js (needs el/btn/navigate) and BEFORE
   dashboard-bootstrap.js (needs TUTORIAL_VERSION/checkAchievements/etc.
   defined before init() runs). See dashboard.html's script order. */

function renderComingSoon(c, label) {
  c.appendChild(el('div', { class: 'empty-state', style: 'padding-top:80px' },
    el('div', { class: 'empty-icon' }, '🚧'),
    el('div', { class: 'empty-title' }, `${label} isn't in this build yet`),
    el('div', { class: 'empty-sub' }, 'This is the landing-page-only slice of the site port — this view arrives in a later phase.'),
    btn('Back to Home', 'primary', { onclick: () => navigate('home') })
  ));
}

const TRACKER_STUB_LABELS = {
  overview: 'XP Overview', logmarks: 'Log Marks', subjects: 'Subjects',
  history: 'Mark History', managesubjects: 'Manage Subjects', trackersettings: 'Tracker Settings',
};
function renderTrackerOverview(c)       { renderComingSoon(c, TRACKER_STUB_LABELS.overview); }
function renderTrackerLogMarks(c)       { renderComingSoon(c, TRACKER_STUB_LABELS.logmarks); }
function renderTrackerSubjects(c)       { renderComingSoon(c, TRACKER_STUB_LABELS.subjects); }
function renderTrackerHistory(c)        { renderComingSoon(c, TRACKER_STUB_LABELS.history); }
function renderTrackerManageSubjects(c) { renderComingSoon(c, TRACKER_STUB_LABELS.managesubjects); }
function renderTrackerSettings(c)       { renderComingSoon(c, TRACKER_STUB_LABELS.trackersettings); }

// openDeckDetail is now defined in dashboard-decks.js (ported) — no stub needed.
