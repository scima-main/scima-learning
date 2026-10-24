'use strict';
/* ═══════════════════════════════════════════════════════════════
   adaptive-core.js — "Crucible", the in-house adaptive difficulty
   system. Pure logic only (no DOM, no state ownership): feature
   extraction, word-level answer diffing, anomaly filtering, the
   cold-start gate, confidence/difficulty maths, the interval
   modifier and the study-queue weakness weight. The dashboard owns
   the persisted profile (state.adaptive, sanitized in shared.js);
   srs-core.js calls scCrucibleInterval() when Settings selects
   "Crucible (adaptive)"; dashboard-study.js feeds samples via
   scCrucibleRecord().

   WHY IN-HOUSE: FSRS-lite/SM-2 see only the 1-4 rating. Crucible
   blends the rating with HOW the answer arrived — hesitation after
   the last keystroke, self-corrections, which words keep going
   wrong, how intrinsically heavy the card is — so two cards rated
   "Good" diverge when one was typed fluently and the other stared
   at for forty seconds. Every personalisation term is gated behind
   a calibration threshold so a brand-new install schedules exactly
   like the base algorithm (no initial bias), and per-sample anomaly
   filters keep abandoned tabs and misclicks out of the maths.

   Dependency-free; loads after srs-core.js and before srs.js on
   every page. module.exports guard for Node test runners, same
   pattern as srs-core.js.
═══════════════════════════════════════════════════════════════ */

// ── Calibration gates & filter constants ──────────────────────────
const CRUCIBLE_VERSION = 1;
// Global gate: personalisation terms stay neutral until this many
// VALID (non-anomalous) samples exist across the whole profile.
const CRUCIBLE_MIN_GLOBAL_SAMPLES = 60;
// Per-card gate: a card's own difficulty estimate only starts moving
// its interval after this many valid samples for that card.
const CRUCIBLE_MIN_CARD_SAMPLES = 5;
// A word only becomes a "weak word" after this many sightings/misses,
// so one typo can never brand a word.
const CRUCIBLE_MIN_WORD_SEEN = 4;
const CRUCIBLE_MIN_WORD_MISSED = 2;
const CRUCIBLE_TOP_WEAK_WORDS = 12;
// Anomaly fences.
const CRUCIBLE_MIN_ANSWER_MS = 250;        // misclick / enter-spam
const CRUCIBLE_MAX_ANSWER_MS = 600000;     // 10 min — abandoned tab
const CRUCIBLE_MAX_PROFILE_CARDS = 20000;
const CRUCIBLE_MAX_VOCAB_WORDS = 5000;

function scCrucibleDefaults() {
  return {
    version: CRUCIBLE_VERSION,
    samples: 0,            // valid global samples
    anomalies: 0,          // rejected samples (lifetime count)
    cards: {},             // cardId -> { n, conf, diff, feat, lastTs }
    vocab: {},             // word   -> { seen, missed }
    baseHesitancy: null,   // personal median hesitation (ms), EWMA-ish
    baseThink: null,       // personal median reveal→first-key (ms)
    typeAcc: {},           // cardType -> { n, correct }
  };
}

// ── Card intrinsic features ───────────────────────────────────────
// Longer cards are naturally harder: more content words to recall
// AND more to type. Math/tables add symbolic load; high front/back
// overlap adds interference (reversal-style confusion).
function scCardFeatures(card) {
  const c = card || {};
  const front = String(c.front || ''), back = String(c.back || '');
  const words = s => (s.match(/[\w'’-]+/g) || []);
  const fw = words(front), bw = words(back);
  const chars = front.length + back.length;
  const gapCount = Math.max(1, c.answerCount || 1);
  const hasMath = /\$[^$\n]+\$/.test(front) || /\$[^$\n]+\$/.test(back) || /\\ce\{/.test(front + back);
  const hasTable = c.type === 'table';
  const hasImage = /data:image|\[\[img/.test(front + back);
  const tricky = /[^\x00-\x7F]/.test(front + back);   // diacritics/CJK — typing load
  const overlap = (() => {
    const a = new Set(fw.map(w => w.toLowerCase())), b = new Set(bw.map(w => w.toLowerCase()));
    if (!a.size || !b.size) return 0;
    let hit = 0; a.forEach(w => { if (b.has(w)) hit++; });
    return hit / Math.min(a.size, b.size);
  })();
  return { chars, words: fw.length + bw.length, gapCount, hasMath, hasTable, hasImage, tricky, overlap, type: c.type || 'basic' };
}

// Prior difficulty ∈ (0,1) from features alone — the cold-start belief
// before any personal data exists. Logistic so extra length saturates
// instead of exploding.
function scFeaturePrior(feat) {
  const f = feat || {};
  let z = -0.65
    + 1.15 / (1 + Math.exp(-((f.chars || 0) - 90) / 55))          // length ramp centred ~90 chars
    + 0.10 * Math.min(4, (f.gapCount || 1) - 1)                   // multi-answer load
    + 0.12 * (f.hasMath ? 1 : 0) + 0.10 * (f.hasTable ? 1 : 0)
    + 0.06 * (f.hasImage ? 1 : 0) + 0.08 * (f.tricky ? 1 : 0)
    + 0.15 * (f.overlap || 0);                                    // front/back interference
  const typeAdj = { markscheme: 0.18, process: 0.14, calculation: 0.10, table: 0.12, cloze: -0.05, reversal: 0.04 };
  z += typeAdj[f.type] || 0;
  return 1 / (1 + Math.exp(-z));
}

// ── Word-level diff (intended vs submitted) ───────────────────────
// Normalisation mirrors quizMatch() so "what counted as right" and
// "what we report as missing" never disagree. Content words are
// length>2 (skips "the/of/a" noise); case/punctuation-only misses are
// reported separately because they are typing slips, not recall gaps.
function scNormalizeAnswer(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9\s'’-]/g, ' ').replace(/\s+/g, ' ').trim();
}
function scDiffWords(user, intended) {
  const u = scNormalizeAnswer(user), c = scNormalizeAnswer(intended);
  const uw = u ? u.split(' ') : [], cw = c ? c.split(' ') : [];
  const uSet = {};
  uw.forEach(w => { uSet[w] = (uSet[w] || 0) + 1; });
  const used = {};
  const missing = [], matched = [];
  cw.forEach(w => {
    if (uSet[w] && (used[w] || 0) < uSet[w]) { used[w] = (used[w] || 0) + 1; matched.push(w); }
    else missing.push(w);
  });
  const cSet = {};
  cw.forEach(w => { cSet[w] = (cSet[w] || 0) + 1; });
  const extra = uw.filter(w => !cSet[w]);
  const contentMissing = missing.filter(w => w.length > 2);
  return { missing, extra, matched, contentMissing,
           missingCount: missing.length,
           contentMissingCount: contentMissing.length,
           recall: cw.length ? matched.length / cw.length : (uw.length ? 0 : 1),
           intended: String(intended == null ? '' : intended),
           submitted: String(user == null ? '' : user) };
}

// ── Anomaly filter ────────────────────────────────────────────────
// Returns null (reject) or the sample. Rejected samples never touch
// the profile: an abandoned tab must not teach the scheduler that a
// card is hard.
function scCrucibleFilterSample(s) {
  if (!s || !s.cardId) return null;
  const ms = s.answerMs;
  if (typeof ms === 'number') {
    if (ms < CRUCIBLE_MIN_ANSWER_MS) return null;
    if (ms > CRUCIBLE_MAX_ANSWER_MS) return null;
  }
  if (s.hiddenDuringAnswer) return null;
  if (s.pasted) return null;                 // outcome still graded; timing untrustworthy
  if (s.doubleRated) return null;
  return s;
}

// ── Confidence per review ∈ [0,1] ─────────────────────────────────
// Rating base, then shaped by evidence the rating alone hides:
// partial credit for multi-answer cards, missing CONTENT words even
// on "close" results, and hesitation relative to the user's OWN
// baseline (absolute ms would punish slow typists globally).
function scCrucibleConfidence(s, profile) {
  const base = [0.05, 0.05, 0.45, 0.80, 1.00][s.rating] ?? 0.45;   // 1=Again … 4=Easy
  let c = base;
  if (s.recall != null) c = Math.min(c, 0.15 + 0.85 * s.recall);   // partial credit cap
  if (s.contentMissingCount) c -= Math.min(0.30, 0.06 * s.contentMissingCount);
  const hesBase = profile?.baseHesitancy;
  if (s.hesitationMs != null && hesBase && s.rating >= 2) {
    // 2× your own typical pause = uncertainty even when correct
    const r = s.hesitationMs / Math.max(400, hesBase);
    if (r > 2) c -= Math.min(0.20, 0.05 * (r - 2));
    else if (r < 0.6 && s.rating >= 3) c += 0.05;                  // fluent confidence
  }
  if (s.hintUsed) c -= 0.10;
  return Math.max(0, Math.min(1, c));
}

// ── Profile update (the learning step) ────────────────────────────
// Per-card difficulty = Bayesian blend of the feature prior and the
// card's observed inverse-confidence, recency-decayed; vocabulary
// map counts content-word misses; personal timing baselines track
// the user's own median so hesitation stays relative.
function scCrucibleRecord(profile, sample) {
  const p = profile || scCrucibleDefaults();
  const s = scCrucibleFilterSample(sample);
  if (!s) { p.anomalies = (p.anomalies || 0) + 1; return p; }
  p.samples = (p.samples || 0) + 1;

  const feat = s.features || scCardFeatures(s.card || {});
  const prior = scFeaturePrior(feat);
  const conf = scCrucibleConfidence(s, p);
  const rec = p.cards[s.cardId] || { n: 0, conf: prior, diff: prior, feat, lastTs: 0 };
  const ageDays = rec.lastTs ? Math.max(0, (s.ts - rec.lastTs) / 86400000) : 0;
  const decay = Math.pow(0.97, Math.min(60, ageDays));             // old evidence fades
  const wOld = rec.n * decay, wNew = 1;
  rec.conf = (rec.conf * wOld + conf * wNew) / (wOld + wNew);
  rec.diff = 1 - rec.conf;
  rec.n = Math.min(CRUCIBLE_MIN_CARD_SAMPLES * 40, wOld + wNew);
  rec.feat = feat; rec.lastTs = s.ts;
  p.cards[s.cardId] = rec;
  if (Object.keys(p.cards).length > CRUCIBLE_MAX_PROFILE_CARDS) {
    // evict oldest entries beyond the cap
    Object.entries(p.cards).sort((a, b) => a[1].lastTs - b[1].lastTs)
      .slice(0, Object.keys(p.cards).length - CRUCIBLE_MAX_PROFILE_CARDS)
      .forEach(([k]) => delete p.cards[k]);
  }

  // Vocabulary weakness map: every content word missed this time is a
  // sighting+miss; matched content words are sightings only.
  const vocab = p.vocab || (p.vocab = {});
  const touch = (w, missed) => {
    const e = vocab[w] || (vocab[w] = { seen: 0, missed: 0 });
    e.seen += 1; if (missed) e.missed += 1;
  };
  (s.diffWords || []).forEach(d => {
    const intended = scNormalizeAnswer(d.intended).split(' ').filter(w => w.length > 2);
    const missSet = {};
    (d.missing || []).forEach(w => { missSet[w] = true; });
    intended.forEach(w => touch(w, !!missSet[w]));
  });
  if (Object.keys(vocab).length > CRUCIBLE_MAX_VOCAB_WORDS) {
    Object.entries(vocab).sort((a, b) => a[1].seen - b[1].seen)
      .slice(0, Object.keys(vocab).length - CRUCIBLE_MAX_VOCAB_WORDS)
      .forEach(([k]) => delete vocab[k]);
  }

  // Personal timing baselines (median-ish via damped mean of logs)
  if (s.hesitationMs != null && s.hesitationMs > 0) {
    p.baseHesitancy = p.baseHesitancy == null ? s.hesitationMs
      : Math.exp(0.8 * Math.log(p.baseHesitancy) + 0.2 * Math.log(s.hesitationMs));
  }
  if (s.thinkMs != null && s.thinkMs > 0) {
    p.baseThink = p.baseThink == null ? s.thinkMs
      : Math.exp(0.8 * Math.log(p.baseThink) + 0.2 * Math.log(s.thinkMs));
  }
  const ta = p.typeAcc[feat.type] || (p.typeAcc[feat.type] = { n: 0, correct: 0 });
  ta.n += 1; if (s.rating >= 3) ta.correct += 1;
  return p;
}

// ── Gates & derived signals ───────────────────────────────────────
function scCrucibleCalibrated(profile) {
  return !!profile && (profile.samples || 0) >= CRUCIBLE_MIN_GLOBAL_SAMPLES;
}
function scCrucibleWeakWords(profile, limit) {
  if (!scCrucibleCalibrated(profile)) return [];
  return Object.entries(profile.vocab || {})
    .filter(([, e]) => e.seen >= CRUCIBLE_MIN_WORD_SEEN && e.missed >= CRUCIBLE_MIN_WORD_MISSED)
    .map(([w, e]) => ({ word: w, rate: e.missed / e.seen, seen: e.seen, missed: e.missed }))
    .sort((a, b) => (b.rate * Math.log(1 + b.seen)) - (a.rate * Math.log(1 + a.seen)))
    .slice(0, limit || CRUCIBLE_TOP_WEAK_WORDS);
}
// How much of this card's content sits on the user's weak words.
function scCrucibleWeakLoad(profile, card, weakSet) {
  if (!weakSet || !weakSet.size) return 0;
  const words = scNormalizeAnswer((card?.front || '') + ' ' + (card?.back || '')).split(' ').filter(w => w.length > 2);
  if (!words.length) return 0;
  let hit = 0; words.forEach(w => { if (weakSet.has(w)) hit++; });
  return hit / words.length;
}

// ── The interval modifier ─────────────────────────────────────────
// <1 shortens (weak card), >1 lengthens (strong card). Neutral 1.0
// until both gates pass; relative to the subject mean so an easy
// deck doesn't inflate every card in it.
function scCrucibleModifier(profile, cardId, card, subjectKey) {
  if (!scCrucibleCalibrated(profile)) return 1;
  const rec = profile.cards && profile.cards[cardId];
  if (!rec || rec.n < CRUCIBLE_MIN_CARD_SAMPLES) return 1;
  const prior = scFeaturePrior(rec.feat || scCardFeatures(card));
  // difficulty excess vs what the features alone predicted
  const excess = rec.diff - prior;
  let m = 1 - 0.9 * excess;                                  // ±0.9× the surprise
  const weak = new Set(scCrucibleWeakWords(profile).map(w => w.word));
  const load = scCrucibleWeakLoad(profile, card, weak);
  if (load > 0.15) m *= 0.85;                                // weak-word rich: revisit sooner
  return Math.max(0.60, Math.min(1.25, m));
}

// Applied by srs-core's crucible route: base scheduler first (FSRS-lite
// ease/interval mechanics stay), then the personalisation multiplier.
function scCrucibleInterval(profile, cardId, card, subjectKey, baseIntervalDays) {
  const m = scCrucibleModifier(profile, cardId, card, subjectKey);
  if (m === 1) return baseIntervalDays;
  return Math.max(0, Math.round(baseIntervalDays * m));
}

// ── Study-queue weakness weight ───────────────────────────────────
// Higher = pick sooner among due cards: weak-word-rich and personally
// hard cards surface first so sessions attack weaknesses.
function scCrucibleQueueWeight(profile, cardId, card) {
  if (!scCrucibleCalibrated(profile)) return 1;
  const rec = profile.cards && profile.cards[cardId];
  const weak = new Set(scCrucibleWeakWords(profile).map(w => w.word));
  const load = scCrucibleWeakLoad(profile, card, weak);
  let w = 1 + 1.5 * load;
  if (rec && rec.n >= CRUCIBLE_MIN_CARD_SAMPLES) w += 1.2 * Math.max(0, rec.diff - 0.5);
  return w;
}

// ── Wrong-section highlight helper data ───────────────────────────
// Words to mark up in the shown correct answer after grading.
function scCrucibleMissedWords(sampleDiff) {
  return Array.from(new Set((sampleDiff?.contentMissing?.length ? sampleDiff.contentMissing : sampleDiff?.missing) || []));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CRUCIBLE_VERSION, CRUCIBLE_MIN_GLOBAL_SAMPLES, CRUCIBLE_MIN_CARD_SAMPLES,
    CRUCIBLE_MIN_WORD_SEEN, CRUCIBLE_MIN_WORD_MISSED,
    scCrucibleDefaults, scCardFeatures, scFeaturePrior, scNormalizeAnswer,
    scDiffWords, scCrucibleFilterSample, scCrucibleConfidence, scCrucibleRecord,
    scCrucibleCalibrated, scCrucibleWeakWords, scCrucibleWeakLoad,
    scCrucibleModifier, scCrucibleInterval, scCrucibleQueueWeight, scCrucibleMissedWords,
  };
}
