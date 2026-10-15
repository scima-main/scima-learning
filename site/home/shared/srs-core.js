'use strict';
/* ═══════════════════════════════════════════════════════════════
   srs-core.js — scheduling primitives shared by every execution
   context that needs to schedule a card: the dashboard (via srs.js,
   which loads this first and adds dashboard-only helpers like XP
   calc) and the background service worker (via importScripts, since
   service workers can't use non-module <script> loading).

   Single source of truth for the FSRS-lite / SM-2 math — previously
   background.js carried its own inline copy of fsrsSchedule that had
   to be hand-kept in sync with this file. Don't reintroduce that split.
═══════════════════════════════════════════════════════════════ */

const DAY = 86400000;

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// FSRS-lite — what Settings → "SRS Algorithm: FSRS" selects (also the default).
function fsrsSchedule(card, rating, opts = {}) {
  const leechThreshold = opts.leechThreshold ?? 8;
  const autoSuspend = opts.autoSuspend ?? true;
  // Ease adapts based on this rating — persisted as the "how easy this card
  // has been" signal used on the *next* review.
  const ease = clamp(card.ease + [-0.3, -0.15, 0.0, 0.15][rating - 1], 1.3, 3.5);

  let interval;
  if (rating === 1) {
    // Again always means "see it again right away" — never a day-plus delay.
    interval = 0;
  } else {
    // Tier factors are derived from card.ease *going into* this review (not
    // the just-adjusted `ease` above), so calling this with rating 2, 3, and
    // 4 on the same card — e.g. the study screen computing all three button
    // previews — always agrees on hardFactor < goodFactor < easyFactor, no
    // matter which rating is actually the one being scored. The explicit
    // max(prev + 1, …) floors then guarantee the resulting *intervals* stay
    // strictly ordered too, even where rounding would otherwise tie small
    // values together (e.g. a 1-day card at the ease floor).
    const base = Math.max(card.interval, 1); // a fresh/failed card can't grow from 0
    const hardFactor = clamp(card.ease - 0.5, 1.01, 3.0);
    const goodFactor = card.ease;
    const easyFactor = card.ease * 1.3;
    const hard = Math.max(1, Math.round(base * hardFactor));
    const good = Math.max(hard + 1, Math.round(base * goodFactor));
    const easy = Math.max(good + 1, Math.round(base * easyFactor));
    interval = rating === 2 ? hard : rating === 3 ? good : easy;
  }

  const lapses = rating === 1 ? card.lapses + 1 : card.lapses;
  const isLeech = lapses >= leechThreshold;
  // `state` tracks scheduling bucket only; leech/suspension are tracked as their
  // own flags below so a leech can still be reviewed when auto-suspend is off.
  const state = interval >= 21 ? 'review' : 'learning';
  return {
    ...card, ease, interval,
    reps: card.reps + 1, lapses, state,
    leech: isLeech,
    suspended: isLeech && autoSuspend ? true : (card.suspended || false),
    due: Date.now() + interval * DAY,
    lastRated: Date.now(),
  };
}

// Classic SM-2 (SuperMemo 2) scheduler — what Settings → "SM-2 (Classic)" selects.
// Quality is derived from our 1-4 rating scale (Again/Hard/Good/Easy).
function sm2Schedule(card, rating, opts = {}) {
  const leechThreshold = opts.leechThreshold ?? 8;
  const autoSuspend = opts.autoSuspend ?? true;
  const quality = [2, 3, 4, 5][rating - 1];
  const failed = rating === 1;
  let ease = card.ease;
  let reps = card.reps;
  let interval;
  if (failed) {
    reps = 0;
    // Again always means "see it again right away" — never a day-plus delay.
    interval = 0;
  } else {
    // Classic SM-2 ease-factor adjustment, driven by this rating's quality —
    // persisted for future reviews.
    ease = clamp(ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)), 1.3, 3.5);
    reps = card.reps + 1;
    // Same tier-factor approach as fsrsSchedule (see its comment): derived
    // from card.ease *going into* this review so Hard/Good/Easy stay
    // consistently ordered regardless of which rating was actually picked.
    const base = Math.max(card.interval, 1);
    const hardFactor = clamp(card.ease - 0.5, 1.01, 3.0);
    const goodFactor = card.ease;
    const easyFactor = card.ease * 1.3;
    const hard = Math.max(1, Math.round(base * hardFactor));
    const good = Math.max(hard + 1, Math.round(base * goodFactor));
    const easy = Math.max(good + 1, Math.round(base * easyFactor));
    interval = rating === 2 ? hard : rating === 3 ? good : easy;
  }
  const lapses = failed ? card.lapses + 1 : card.lapses;
  const isLeech = lapses >= leechThreshold;
  const state = interval >= 21 ? 'review' : 'learning';
  return {
    ...card, ease, interval, reps, lapses, state,
    leech: isLeech,
    suspended: isLeech && autoSuspend ? true : (card.suspended || false),
    due: Date.now() + interval * DAY,
    lastRated: Date.now(),
  };
}

// Single entry point: routes to the scheduler the user picked in Settings.
function scheduleCard(card, rating, opts = {}) {
  return opts.algorithm === 'sm2' ? sm2Schedule(card, rating, opts) : fsrsSchedule(card, rating, opts);
}

// Export for Node's test runner — no-op in the browser/service-worker contexts this
// file normally loads in (`module` is undefined there). See shared.js for the same
// pattern.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DAY, clamp, fsrsSchedule, sm2Schedule, scheduleCard };
}
