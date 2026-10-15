// fsrsSchedule / sm2Schedule / scheduleCard / DAY / clamp now live in srs-core.js,
// which dashboard.html loads immediately before this file (same pattern used for
// content.js's translate-shared.js below) — this used to be a full inline copy
// that had to be hand-kept in sync with background.js's own copy of fsrsSchedule;
// srs-core.js is now the single source of truth for both.

function getDueCards(cards) {
  const now = Date.now();
  return cards.filter(c => c.due <= now && !c.suspended);
}

// Caps how many never-before-reviewed cards can enter a session, per
// Settings → "New Cards Per Day". `newSeenToday` is how many new cards have
// already been introduced today (tracked on the reviewHistory entry).
function applyNewCardCap(cards, newCardsPerDay, newSeenToday) {
  const cap = Math.max(0, (newCardsPerDay ?? 10) - (newSeenToday || 0));
  const fresh = cards.filter(c => c.state === 'new');
  const rest = cards.filter(c => c.state !== 'new');
  return [...rest, ...fresh.slice(0, cap)];
}

// Subject XP multiplier: worst subject = 2x, best = 1x, log2-scaled.
// subjectTotals: object mapping subjectKey -> totalXP (from trackerState.subjects)
// deckSubject: the subject key tagged on the deck (or 'misc')
function subjectXPMultiplier(subjectTotals, deckSubject) {
  const entries = Object.entries(subjectTotals || {});
  if (entries.length < 2) return 1;
  const values = entries.map(([, v]) => v.totalXP || 0);
  const minXP = Math.min(...values);
  const maxXP = Math.max(...values);
  if (maxXP === minXP) return 1;
  const subjectXP = subjectTotals[deckSubject]?.totalXP ?? minXP;
  // Linear position 0 (worst) to 1 (best), then map to [2, 1] via log2 curve
  const t = (subjectXP - minXP) / (maxXP - minXP);
  // log2 scaling: at t=0 mult=2, at t=1 mult=1
  return 2 - Math.log2(1 + t);
}
// Base = XP_COEF * difficulty^-2, then decayed by recency.
// difficulty maps ease (1.3–3.5) inversely to a 1–9 grade-like scale.
// recency penalty: cards reviewed more recently earn less XP.
// XP_COEF and RECENCY_HALF_LIFE are adjustable constants.
const XP_COEF = 1000;
const RECENCY_HALF_LIFE_DAYS = 1; // halves XP if reviewed within this many days

function calcCardXP(card, rating) {
  // Map ease (1.3–3.5) to difficulty (1=hardest, 9=easiest) — inverted
  const difficulty = clamp(Math.round(10 - ((card.ease - 1.3) / (3.5 - 1.3)) * 8), 1, 9);
  const baseXP = XP_COEF * Math.pow(difficulty, -2);

  // Recency decay: if lastRated is recent, XP is lower
  const daysSinceLast = card.lastRated ? (Date.now() - card.lastRated) / DAY : 999;
  const recencyMultiplier = 1 - Math.exp(-daysSinceLast / RECENCY_HALF_LIFE_DAYS);

  // Rating multiplier: Again=0.2, Hard=0.6, Good=1.0, Easy=1.3
  const ratingMult = [0.2, 0.6, 1.0, 1.3][rating - 1];

  return Math.max(0.1, baseXP * recencyMultiplier * ratingMult);
}
