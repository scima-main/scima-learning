/* ═══════════════════════════════════════════════════════════════
   SCIMATracker — shared.js
   Shared configuration, subject data, XP/level logic, storage.
   Loaded by both popup.js and the dashboard-*.js files.
═══════════════════════════════════════════════════════════════ */

'use strict';

/* Theme tokens, presets, background patterns, applyThemeVars(), and the
   schedule resolver now live in theme.js (loaded right before this file) —
   DEFAULT_THEME, THEME_PRESETS, BG_PATTERNS, DEFAULT_SCHEDULE,
   resolveScheduledTheme(), applyThemeVars(), hexToRgbTriplet(), mixHex(),
   and relLuminance() are all defined there as globals. See that file for
   the "keep both in sync" note about content.js's own --mf-* copy. */


/* ─────────────────────────────────────────────────────────────
   CONFIGURATION  (edit these constants to tune the system)
───────────────────────────────────────────────────────────── */

/** XP per mark formula: XP = XP_COEFFICIENT × grade⁻² */
const XP_COEFFICIENT = 1000;

/** Monthly mark cap = examMarks × MONTHLY_CAP_MULT */
const MONTHLY_CAP_MULT = 5;

/** XP required to go from level 1 → 2 */
const BASE_LEVEL_XP = 100;

/** Per-level XP scaling multiplier = ²√[10]{2} ≈ 1.07177 */
const LEVEL_SCALE = Math.pow(2, 1 / 10);

/** XP multiplier applied once monthly cap is exceeded */
const CAP_PENALTY = 0.5;

/** Maximum history entries stored (older entries are dropped once exceeded) */
const MAX_HISTORY = 5000;


/* ─────────────────────────────────────────────────────────────
   SUBJECT DEFINITIONS
   examMarks = total non-NEA written exam marks only
───────────────────────────────────────────────────────────── */

const SUBJECTS = {
  englishLanguage: {
    name: 'English Language',
    short: 'Eng Lang',
    board: 'AQA',
    // AQA 8700: Paper 1 (80 marks) + Paper 2 (80 marks)
    examMarks: 160,
    defaultColor: '#1B3A6B',
  },
  englishLiterature: {
    name: 'English Literature',
    short: 'Eng Lit',
    board: 'AQA',
    // AQA 8702: Paper 1 (64 marks) + Paper 2 (96 marks)
    examMarks: 160,
    defaultColor: '#5FA820',
  },
  mathematics: {
    name: 'Mathematics',
    short: 'Maths',
    board: 'Edexcel',
    // Edexcel 1MA1: Paper 1 (80) + Paper 2 (80) + Paper 3 (80)
    examMarks: 240,
    defaultColor: '#E07B00',
  },
  furtherMathematics: {
    name: 'Further Mathematics',
    short: 'Further Maths',
    board: 'AQA',
    // AQA Level 2 8365: Paper 1 (80) + Paper 2 (80)
    examMarks: 160,
    defaultColor: '#C93A2A',
  },
  biology: {
    name: 'Biology',
    short: 'Biology',
    board: 'AQA',
    // AQA 8461: Paper 1 (100) + Paper 2 (100); practicals assessed in-exam
    examMarks: 200,
    defaultColor: '#27AE60',
  },
  chemistry: {
    name: 'Chemistry',
    short: 'Chemistry',
    board: 'AQA',
    // AQA 8462: Paper 1 (100) + Paper 2 (100)
    examMarks: 200,
    defaultColor: '#00ACC1',
  },
  physics: {
    name: 'Physics',
    short: 'Physics',
    board: 'AQA',
    // AQA 8463: Paper 1 (100) + Paper 2 (100)
    examMarks: 200,
    defaultColor: '#D32F2F',
  },
  computerScience: {
    name: 'Computer Science',
    short: 'Comp Sci',
    board: 'OCR',
    // OCR J277: Component 01 (80) + Component 02 (80)
    // Component 03 (Programming Project) is NEA — excluded
    examMarks: 160,
    defaultColor: '#7B5EA7',
  },
  economics: {
    name: 'Economics',
    short: 'Economics',
    board: 'OCR',
    // OCR J205: Component 01 (80) + Component 02 (80)
    examMarks: 160,
    defaultColor: '#C8960A',
  },
  french: {
    name: 'French',
    short: 'French',
    board: 'Edexcel',
    // Edexcel 1FR0: Listening (50) + Reading (60) + Writing (60)
    // Speaking (60) excluded — controlled speaking assessment treated as NEA
    examMarks: 170,
    defaultColor: '#C2185B',
  },
  geography: {
    name: 'Geography',
    short: 'Geography',
    board: 'AQA',
    // AQA 8035: Paper 1 (88) + Paper 2 (88) + Paper 3 (76)
    examMarks: 252,
    defaultColor: '#7B1FA2',
  },
  music: {
    name: 'Music',
    short: 'Music',
    board: 'Edexcel',
    // Edexcel 1MU0: Component 3 Appraising (96 marks) only
    // Component 1 (Performing) + Component 2 (Composing) are NEA — excluded
    examMarks: 96,
    defaultColor: '#C5A800',
  },
  misc: {
    name: 'Miscellaneous',
    short: 'Misc',
    board: 'N/A',
    examMarks: 100,
    defaultColor: '#AAAAAA',
  },
};

// The sentinel subject key used whenever a deck/folder has no subject assigned,
// or a chosen subject can no longer be resolved. Always use this constant instead
// of the string literal 'misc', so every call site stays in sync if this ever changes.
// NOTE: content.js does not load shared.js (see manifest.json content_scripts) and
// therefore can't see this constant — its own copy of the literal must be kept in sync
// by hand. Everywhere else (dashboard, popup) loads shared.js first and should use this.
const DEFAULT_SUBJECT_KEY = 'misc';

// A pristine, un-hideable, un-deletable copy of the fallback subject. getEffectiveSubjects()
// lets the user hide/remove DEFAULT_SUBJECT_KEY like any other built-in, which means
// `getEffectiveSubjects(state)[DEFAULT_SUBJECT_KEY]` can legitimately be undefined. Any code
// that needs a *guaranteed* non-undefined subject object (e.g. to read .defaultColor/.name for
// rendering) should fall back to this rather than to the possibly-removed merged entry.
const FALLBACK_SUBJECT = Object.freeze({ ...SUBJECTS.misc });


/* ─────────────────────────────────────────────────────────────
   EFFECTIVE SUBJECTS  (built-in defaults merged with user customisations)
   Always call this instead of referencing SUBJECTS directly.
───────────────────────────────────────────────────────────── */

function getEffectiveSubjects(state) {
  const custom = state?.config?.customSubjects || {};
  // Start with built-ins, then overlay any user edits or additions
  const merged = {};
  // Add built-ins that haven't been removed by user
  for (const [key, s] of Object.entries(SUBJECTS)) {
    if (!custom[key]?._removed) merged[key] = { ...s, ...custom[key] };
  }
  // Add user-created subjects (not in SUBJECTS at all)
  for (const [key, s] of Object.entries(custom)) {
    if (!SUBJECTS[key] && !s._removed) merged[key] = s;
  }
  return merged;
}

const LEVEL_TITLES = [
  [1,  'Rank 1'],
  [5,  'Rank 2'],
  [10, 'Rank 3'],
  [15, 'Rank 4'],
  [20, 'Rank 5'],
  [25, 'Rank 6'],
  [30, 'Rank 7'],
  [35, 'Rank 8'],
  [40, 'Rank 9'],
  [45, 'Rank 10'],
  [50, 'woah youre so tuff'],
];

function getLevelTitle(lvl) {
  let title = LEVEL_TITLES[0][1];
  for (const [threshold, name] of LEVEL_TITLES) {
    if (lvl >= threshold) title = name;
    else break;
  }
  return title;
}


/* ─────────────────────────────────────────────────────────────
   DEFAULT STATE
───────────────────────────────────────────────────────────── */

function makeDefaultState() {
  const subjects = {};
  for (const [key, s] of Object.entries(SUBJECTS)) {
    subjects[key] = {
      predictedGrade: null,
      color: s.defaultColor,
      totalXP: 0,
      totalMarks: 0,
    };
  }
  return {
    version: 1,
    totalXP: 0,
    subjects,
    monthlyMarks: {},
    history: [],
    streak: { current: 0, longest: 0, lastDate: null },
    config: {
      xpCoef: XP_COEFFICIENT,
      capMult: MONTHLY_CAP_MULT,
      theme: 'dark',
      customSubjects: {},   // user overrides: { key: {...fields} | { _removed: true } }
    },
  };
}

/**
 * Repairs a single flashcard into the shape srs-core.js's schedulers and
 * srs.js's calcCardXP() actually depend on. `due`/`ease`/`state`/`suspended` are
 * the load-bearing fields — get any of them wrong (missing, wrong type, from a
 * very old export, hand-edited JSON, etc.) and getDueCards()/fsrsSchedule()/
 * calcCardXP() will throw or silently misbehave (e.g. `card.ease - 1.3` on a
 * missing ease is NaN, propagating through every future review of that card).
 * frontImage/backImage/citation are display fields (not scheduling-critical) but
 * are real, actively-used parts of the card schema — see dashboard-study.js's
 * flashcard rendering and the Library citation feature — not incidental extras,
 * so they must be preserved here too. Never throws; truly unrecognized fields
 * (anything not listed below) are dropped.
 */
// ── Rich text for flashcard front/back: basic **bold** / __underline__ /
// *italic* formatting, plus $inline$ and $$block$$ LaTeX (including chemical
// equations via \ce{...}, e.g. $\ce{2H2 + O2 -> 2H2O}$) rendered via the
// bundled KaTeX library + its official mhchem extension (lib/katex/, loaded
// in dashboard.html) rather than a hand-rolled math/chem renderer — both are
// the standard open-source choices for this and need no build step, just
// the static files. Falls back to showing the raw $...$ source untouched if
// KaTeX isn't loaded (e.g. a page that doesn't include it) or a LaTeX
// snippet fails to parse, so a malformed expression never breaks the card.
function escapeHtmlText(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function renderRichText(str) {
  if (str == null || str === '') return '';
  const unescapeHtmlText = t => t.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
  const katexOk = typeof katex !== 'undefined';
  const mathRender = (expr, display) => {
    const raw = unescapeHtmlText(expr);
    if (!katexOk) return escapeHtmlText(display ? `$$${raw}$$` : `$${raw}$`);
    try { return katex.renderToString(raw, { throwOnError: false, displayMode: display }); }
    catch (e) { return escapeHtmlText(display ? `$$${raw}$$` : `$${raw}$`); }
  };
  let s = escapeHtmlText(String(str));
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (m, expr) => mathRender(expr, true));
  s = s.replace(/\$([^$\n]+?)\$/g, (m, expr) => mathRender(expr, false));
  s = s.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([\s\S]+?)__/g, '<u>$1</u>');
  s = s.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/\n/g, '<br>');
  return s;
}
// Sets an element's rendered rich-text content in place of appending it as a
// plain-text child — use wherever card front/back text is displayed.
function setRichText(node, str) { node.innerHTML = renderRichText(str); return node; }

// ── LaTeX approximation: converts LaTeX fragments into a plain-text/unicode
// reading, so a written-response answer authored with LaTeX (e.g.
// "$\frac{1}{2}$") can be typed back in plain form ("1/2") and still be
// graded correct — a learner should never be forced to type LaTeX syntax
// themselves just because the card was authored with it. This sits next to
// renderRichText() because both exist to make a card's *display* form
// (LaTeX source) usable elsewhere — renderRichText turns it into markup for
// on-screen display, latexApproximate turns it into plain text for
// comparison/search. Used by quizMatch/quizMatchExact/markschemeMatch/
// tableCellMatch in dashboard-core.js (so Written Quiz, Gap Fill,
// method-marks, and table cards all benefit) and by cardSearchBlob (so the
// deck search box also matches on the plain-text reading).
//
// Not a real LaTeX parser — good enough for the handful of constructs
// GCSE-level cards realistically use ($...$/$$...$$ delimiters, \frac,
// \sqrt, super/subscripts, common operators/greek letters/arrows, \text-like
// wrapper commands, and mhchem's \ce{...}). Deliberately falls back to
// leaving unrecognized commands as their bare word (stripped of backslash
// and braces) rather than throwing, so a malformed or exotic snippet just
// degrades gracefully instead of breaking grading.
function latexApproximate(str) {
  let s = String(str == null ? '' : str);
  if (!s) return s;

  // Delimiters ($...$/$$...$$) are pure structure — content on either side
  // of them is handled by the steps below regardless, so just drop them.
  s = s.replace(/\$/g, '');

  // Finds the '{' at `start` and returns {content, end}: `content` is
  // everything inside the balanced braces, `end` is the index just past the
  // matching '}'. Returns null if `start` isn't a '{' or braces never close
  // (malformed input) so callers can bail out cleanly instead of looping
  // forever.
  const balancedArg = (text, start) => {
    if (text[start] !== '{') return null;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) return { content: text.slice(start + 1, i), end: i + 1 };
      }
    }
    return null;
  };

  // Repeatedly expands the leftmost \frac{a}{b} (and \dfrac/\tfrac/\cfrac
  // variants) into "a/b". Runs to a fixed point so nested fractions
  // (\frac{1}{\frac{2}{3}}) resolve correctly: substituting the outer frac's
  // numerator/denominator back into the string exposes the inner \frac for
  // the next iteration. Capped at 50 iterations so malformed/adversarial
  // input (unbalanced braces) can't hang the page instead of just leaving
  // the rest of the string untouched.
  for (let iter = 0; iter < 50; iter++) {
    const m = /\\(?:d|t|c)?frac\s*(?=\{)/.exec(s);
    if (!m) break;
    const num = balancedArg(s, m.index + m[0].length);
    if (!num) break;
    let denStart = num.end;
    while (s[denStart] === ' ') denStart++;
    const den = balancedArg(s, denStart);
    if (!den) break;
    s = s.slice(0, m.index) + num.content + '/' + den.content + s.slice(den.end);
  }

  // \sqrt{x} -> "sqrt(x)", \sqrt[n]{x} -> "sqrt(x)" (the root index is
  // dropped — cube/nth roots are rare enough on these cards that a simple
  // approximation is fine), and the braceless single-argument form
  // \sqrt2 -> "sqrt(2)".
  for (let iter = 0; iter < 50; iter++) {
    const m = /\\sqrt/.exec(s);
    if (!m) break;
    let i = m.index + m[0].length;
    if (s[i] === '[') {
      const closeIdx = s.indexOf(']', i);
      if (closeIdx === -1) break;
      i = closeIdx + 1;
    }
    while (s[i] === ' ') i++;
    if (s[i] === '{') {
      const arg = balancedArg(s, i);
      if (!arg) break;
      s = s.slice(0, m.index) + 'sqrt(' + arg.content + ')' + s.slice(arg.end);
    } else if (s[i]) {
      s = s.slice(0, m.index) + 'sqrt(' + s[i] + ')' + s.slice(i + 1);
    } else break;
  }

  // "Wrapper" commands whose argument IS the content that matters — unwrap
  // to just the argument. Covers plain-text/font commands (\text, \mathrm,
  // \mathbf, ...), accent commands (\bar, \hat, \vec, \overline,
  // \underline), \boxed, and mhchem's \ce{...} chemical-equation wrapper
  // (whose argument, e.g. "2H2 + O2 -> 2H2O", is already plain-text-ish).
  const wrapperCommands = 'text|mbox|mathrm|mathbf|mathit|mathsf|mathtt|operatorname|overline|underline|bar|hat|vec|boxed|ce';
  for (let iter = 0; iter < 100; iter++) {
    const re = new RegExp('\\\\(?:' + wrapperCommands + ')\\s*(?=\\{)');
    const m = re.exec(s);
    if (!m) break;
    const arg = balancedArg(s, s.indexOf('{', m.index));
    if (!arg) break;
    s = s.slice(0, m.index) + arg.content + s.slice(arg.end);
  }

  // Superscripts/subscripts: strip the ^ / _ marker but keep the exponent's
  // text, since norm() in quizMatch etc. already strips ^ and _ as
  // non-alphanumeric — "x^{2}" and "x^2" both just need to read "x2" to
  // match a learner typing "x2".
  for (let iter = 0; iter < 100; iter++) {
    const m = /[\^_]\s*(?=\{)/.exec(s);
    if (!m) break;
    const arg = balancedArg(s, s.indexOf('{', m.index));
    if (!arg) break;
    s = s.slice(0, m.index) + arg.content + s.slice(arg.end);
  }
  s = s.replace(/[\^_]\s*([a-zA-Z0-9])/g, '$1');

  // Spacing commands carry no textual meaning.
  s = s.replace(/\\[,;:!]/g, ' ').replace(/\\(?:quad|qquad)\b/g, ' ');

  // Common operators/relations/arrows/greek letters, mapped to a plain-text
  // or word reading. Longer/more-specific names are listed before any name
  // they contain as a prefix (leq before le, rightarrow before to, etc.) —
  // regex alternation tries alternatives in order, so this ordering is what
  // makes "\leq" match as "leq" rather than stopping early at "le".
  const SYMBOL_MAP = {
    leftrightarrow: '<->', Leftrightarrow: '<->',
    rightarrow: '->', Rightarrow: '->', leftarrow: '<-', Leftarrow: '<-',
    leq: '<=', geq: '>=', neq: '!=', approx: '~=',
    times: 'x', div: '/', cdot: '*', pm: '+/-', mp: '-/+',
    infty: 'infinity',
    Delta: 'delta', delta: 'delta', Lambda: 'lambda', lambda: 'lambda',
    Omega: 'omega', omega: 'omega', Sigma: 'sigma', sigma: 'sigma',
    Phi: 'phi', phi: 'phi', Gamma: 'gamma', gamma: 'gamma',
    theta: 'theta', alpha: 'alpha', beta: 'beta', mu: 'mu', pi: 'pi',
    degree: 'deg', circ: 'deg',
    gets: '<-', to: '->',
    le: '<=', ge: '>=', ne: '!=',
    left: '', right: '',
  };
  const symbolRe = new RegExp('\\\\(' + Object.keys(SYMBOL_MAP).join('|') + ')(?![a-zA-Z])', 'g');
  s = s.replace(symbolRe, (m, name) => SYMBOL_MAP[name]);

  // Anything left with a command name we don't recognize — drop the
  // backslash but keep the word itself as literal text, rather than losing
  // it entirely.
  s = s.replace(/\\([a-zA-Z]+)/g, '$1');

  // Whatever's left (stray braces, unmatched backslashes from malformed
  // input) carries no meaning on its own.
  s = s.replace(/[{}\\]/g, '');

  return s.replace(/\s+/g, ' ').trim();
}

// Reads card text aloud via the Web Speech API — backs the "Text-to-Speech"
// toggle in Settings (settings.tts). Reuses latexApproximate() to turn any
// LaTeX/math in the text into a plain-text reading first (so "$\frac{1}{2}$"
// is spoken as "1/2" rather than read literally), then strips the
// **bold**/__underline__/*italic* markdown renderRichText() understands,
// since those markers should never be spoken aloud either.
// Callers are responsible for checking state.settings.tts before calling —
// this function itself just speaks whatever text it's given.
function speakText(str) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  let s = latexApproximate(str);
  s = s.replace(/\*\*([\s\S]+?)\*\*/g, '$1').replace(/__([\s\S]+?)__/g, '$1').replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1$2');
  s = s.trim();
  if (!s) return;
  // Cancel any utterance still in flight (e.g. rapid card-to-card navigation)
  // so speech never overlaps or queues up behind stale cards.
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(s));
}

function sanitizeCard(raw) {
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const r = isObj(raw) ? raw : {};
  const validStates = new Set(['new', 'learning', 'review']);
  // 'markscheme' cards store their question in `front` (marks are derived from
  // requiredAnswers/answerCount and appended at display time, never baked into
  // the stored text) and a pool of mark-scheme keywords/points in `back`, using
  // the exact same answerCount/requiredAnswers pool machinery as ordinary
  // multi-answer cards — see formatCardFront()/markschemeMatch() in
  // dashboard-core.js and renderQuizCard() in dashboard-study.js.
  // 'process' cards are the same pool-in-`back` idea as markscheme, but the
  // pool is an ORDERED chain of steps (e.g. "fertilizer runoff" -> "waterways"
  // -> "algae bloom" -> ...) rather than an unordered set of keywords — see
  // `synonyms` below and processStepMatch()/renderProcessCard() in
  // dashboard-core.js/dashboard-study.js.
  // 'calculation' cards depart from the text/keyword-matching family entirely:
  // `back` holds the canonical numeric answer as typed (e.g. "0.5", "1/2",
  // "50%" are all valid and treated as equivalent by calcMatch()), matched via
  // a numeric comparator (tolerance + unit-aware) instead of quizMatch(). They
  // can additionally carry an optional mark-scheme-style pool of method/
  // working marking points (`methodPool`/`methodRequired`, scored the same way
  // markscheme's pool is) for partial credit on working-out — see calcMatch()/
  // renderQuizCard() in dashboard-core.js/dashboard-study.js.
  // 'table' cards render a 2D grid (grouped/spanning column headers, e.g. a
  // physics data table with "v" split into Before/After sub-columns) where
  // some cells are given and others are blanks the learner fills in — see
  // `tableData` below and tableCellMatch()/pickTableCombination()/renderTableQuizCard() in
  // dashboard-core.js/dashboard-study.js. `front` holds the instruction
  // text ("Complete the table"); `back` is unused for this type.
  const validTypes = new Set(['basic', 'cloze', 'reversal', 'markscheme', 'process', 'calculation', 'table']);
  const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v)) ? v : fallback;
  const nonNegNum = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) && v >= 0) ? v : fallback;
  // citation shape as actually created in dashboard-library.js/dashboard-capture.js/
  // dashboard-decks.js: { sourceId, chapterId, charStart, charEnd }. sourceName/
  // chapterTitle/excerpt are ephemeral, render-time-only enrichments added via
  // spread (see withCitationInfo-style helpers in dashboard-decks.js) — never
  // meant to be persisted, so they're intentionally not preserved here.
  const citation = isObj(r.citation) ? {
    sourceId: typeof r.citation.sourceId === 'string' ? r.citation.sourceId : null,
    chapterId: typeof r.citation.chapterId === 'string' ? r.citation.chapterId : null,
    charStart: nonNegNum(r.citation.charStart, 0),
    charEnd: nonNegNum(r.citation.charEnd, 0),
  } : null;

  const answerCount = (typeof r.answerCount === 'number' && Number.isFinite(r.answerCount)) ? Math.min(8, Math.max(1, Math.round(r.answerCount))) : 1;

  // 'process' cards only: one synonym list per back-pool step, same index/order
  // as getCardAnswers(card) — e.g. synonyms[0] are accepted alternates for the
  // first step. Not length-locked to answerCount here (a step removed in the
  // editor can leave a stale trailing entry); consumers index defensively
  // (`synonyms[i] || []`) rather than relying on this array's length. Capped at
  // 8 lists (matches answerCount's max) x 12 synonyms each so a corrupted/
  // hand-edited export can't blow up the editor/study UI.
  const synonyms = Array.isArray(r.synonyms)
    ? r.synonyms.slice(0, 8).map(list => Array.isArray(list) ? list.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim()).slice(0, 12) : [])
    : [];

  // 'calculation' cards only. calcUnit is optional (null = no unit expected/
  // checked). calcTolerance is interpreted per calcToleranceMode: 'abs' = ±N in
  // the answer's own units, 'pct' = ±N% of the correct value. methodPool/
  // methodRequired mirror markscheme's back-pool/requiredAnswers exactly, just
  // stored separately since `back` is taken by the numeric answer for this
  // type — see calcMatch() in dashboard-core.js.
  const calcUnit = typeof r.calcUnit === 'string' && r.calcUnit.trim() ? r.calcUnit.trim() : null;
  const calcToleranceMode = (r.calcToleranceMode === 'pct' || r.calcToleranceMode === 'sigfig') ? r.calcToleranceMode : 'abs';
  const calcTolerance = nonNegNum(r.calcTolerance, 0);
  const methodPool = Array.isArray(r.methodPool) ? r.methodPool.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim()).slice(0, 8) : [];
  const methodRequired = (typeof r.methodRequired === 'number' && Number.isFinite(r.methodRequired))
    ? Math.min(methodPool.length, Math.max(0, Math.round(r.methodRequired)))
    : methodPool.length;

  // 'table' cards only. `columns` is a flat list of leaf columns in display
  // order — {key, label, group} where `group` is the shared header text for
  // columns that should be visually merged under one spanning header (e.g.
  // "Before"/"After" both with group:"v (m/s)"); leave group null/'' for a
  // column that spans both header rows on its own (e.g. "m (kg)"). `rows` is
  // an array of row objects keyed by each column's `key`, always holding the
  // CORRECT value for every cell (the answer key is never discarded, so a
  // card can be re-edited or a blank's solution shown after grading).
  //
  // A physics-style table only has one solvable set of blanks per row (you
  // can't blank both v-before AND v-change and still derive both from F/t/m
  // alone) — so rather than one fixed blanks list, the creator authors
  // `combinations`: unlimited named variants, each an array of length
  // rows.length where combinations[i].cells[rowIndex] is the (possibly
  // empty, possibly multi-entry) list of column keys blanked in that row for
  // that variant. Study mode picks one combination at random each time the
  // card comes up (see pickTableCombination() below and
  // renderTableQuizCard() in dashboard-study.js), so the same card can pose
  // a different-but-still-solvable question each rep instead of being
  // identical every time — while every variant stays one the creator
  // reviewed (hand-written or auto-generated then edited) rather than a
  // combinatorially-generated one that might be unsolvable.
  const tableData = isObj(r.tableData) ? {
    columns: Array.isArray(r.tableData.columns) ? r.tableData.columns.slice(0, 12).map(c => ({
      key: typeof c?.key === 'string' && c.key.trim() ? c.key.trim() : `col_${Math.random().toString(36).slice(2,7)}`,
      label: typeof c?.label === 'string' ? c.label : '',
      group: typeof c?.group === 'string' && c.group.trim() ? c.group.trim() : null,
    })) : [],
    rows: Array.isArray(r.tableData.rows) ? r.tableData.rows.slice(0, 40).map(row => (isObj(row) ? row : {})) : [],
    combinations: (() => {
      const rows = Array.isArray(r.tableData.rows) ? r.tableData.rows : [];
      let combos = Array.isArray(r.tableData.combinations) ? r.tableData.combinations : null;
      // Migrate a pre-combinations card (single flat `blanks` list) into one
      // combination, so older saved cards keep working unchanged.
      if (!combos && Array.isArray(r.tableData.blanks)) {
        const cells = rows.map(() => []);
        r.tableData.blanks.forEach(b => {
          const ri = (typeof b?.rowIndex === 'number' && Number.isFinite(b.rowIndex)) ? Math.max(0, Math.round(b.rowIndex)) : 0;
          if (ri < cells.length && typeof b?.colKey === 'string' && b.colKey) cells[ri].push(b.colKey);
        });
        combos = [{ name: 'Combination 1', cells }];
      }
      return (Array.isArray(combos) ? combos : []).slice(0, 100).map((combo, i) => ({
        name: typeof combo?.name === 'string' && combo.name.trim() ? combo.name.trim() : `Combination ${i + 1}`,
        cells: Array.isArray(combo?.cells)
          ? rows.map((_, ri) => {
              const raw = combo.cells[ri];
              // Accept both the old single-key-per-row shape and the
              // current array-per-row shape.
              const keys = Array.isArray(raw) ? raw : (typeof raw === 'string' && raw ? [raw] : []);
              return keys.filter(k => typeof k === 'string' && k).slice(0, 12);
            })
          : rows.map(() => []),
      }));

    })(),
  } : { columns: [], rows: [], combinations: [] };
  const tableTolerance = nonNegNum(r.tableTolerance, 0);
  const tableToleranceMode = (r.tableToleranceMode === 'pct' || r.tableToleranceMode === 'sigfig') ? r.tableToleranceMode : 'abs';

  return {
    id: typeof r.id === 'string' && r.id ? r.id : `c_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    front: typeof r.front === 'string' ? r.front : '',
    back: typeof r.back === 'string' ? r.back : '',
    // Multi-answer cards: `back` holds a *pool* of accepted answers, one per line
    // ("\n"-joined) — answerCount is the pool's size. 1 = the classic single-answer
    // card. See openCardModal() in dashboard-decks.js for how the pool is built,
    // and renderQuizCard()/renderGapCard() in dashboard-study.js for how it's
    // consumed during study. Clamped to a sane range so a corrupted/hand-edited
    // value can't make study screens render hundreds of input boxes.
    answerCount,
    // How many of the pool's answers Written Quiz actually asks for (and requires,
    // for full marks) — separate from the pool size so a card can offer e.g. 5
    // valid answers but only demand 2 of them. Defaults to the full pool (require
    // everything) and is always clamped to [1, answerCount] since asking for more
    // answers than exist wouldn't be satisfiable.
    requiredAnswers: (typeof r.requiredAnswers === 'number' && Number.isFinite(r.requiredAnswers)) ? Math.min(answerCount, Math.max(1, Math.round(r.requiredAnswers))) : answerCount,
    synonyms,
    calcUnit,
    calcTolerance,
    calcToleranceMode,
    methodPool,
    methodRequired,
    tableData,
    tableTolerance,
    tableToleranceMode,
    hint: typeof r.hint === 'string' ? r.hint : '',
    tags: Array.isArray(r.tags) ? r.tags.filter(t => typeof t === 'string') : [],
    type: validTypes.has(r.type) ? r.type : 'basic',
    ease: (typeof r.ease === 'number' && Number.isFinite(r.ease)) ? Math.min(3.5, Math.max(1.3, r.ease)) : 2.5,
    interval: nonNegNum(r.interval, 0),
    reps: nonNegNum(r.reps, 0),
    lapses: nonNegNum(r.lapses, 0),
    due: num(r.due, Date.now()),
    state: validStates.has(r.state) ? r.state : 'new',
    suspended: typeof r.suspended === 'boolean' ? r.suspended : false,
    leech: typeof r.leech === 'boolean' ? r.leech : false,
    created: num(r.created, Date.now()),
    lastRated: (typeof r.lastRated === 'number' && Number.isFinite(r.lastRated)) ? r.lastRated : null,
    source: typeof r.source === 'string' ? r.source : null,
    frontImage: typeof r.frontImage === 'string' ? r.frontImage : null,
    backImage: typeof r.backImage === 'string' ? r.backImage : null,
    citation,
  };
}

/**
 * Repairs a single deck. `cards` is run through sanitizeCard() individually
 * (rather than discarding the whole deck if one card is bad) so one corrupted
 * card doesn't take an entire deck's worth of good cards down with it.
 */
function sanitizeDeck(raw) {
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const r = isObj(raw) ? raw : {};
  return {
    id: typeof r.id === 'string' && r.id ? r.id : `d_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    name: typeof r.name === 'string' && r.name ? r.name : 'Untitled deck',
    emoji: typeof r.emoji === 'string' ? r.emoji : '📚',
    image: typeof r.image === 'string' ? r.image : null,
    subject: typeof r.subject === 'string' ? r.subject : DEFAULT_SUBJECT_KEY,
    folderId: typeof r.folderId === 'string' ? r.folderId : null,
    color: typeof r.color === 'string' ? r.color : 'var(--blue)',
    pinned: typeof r.pinned === 'boolean' ? r.pinned : false,
    cards: Array.isArray(r.cards) ? r.cards.map(sanitizeCard) : [],
  };
}

/** Repairs a single folder. subjectKey/parentId/image must be preserved the same way
 *  sanitizeDeck() preserves subject/folderId/image — losing them here silently strips
 *  a folder's subject assignment and un-nests it from its parent on every load/sync. */
function sanitizeFolder(raw) {
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const r = isObj(raw) ? raw : {};
  return {
    id: typeof r.id === 'string' && r.id ? r.id : `f_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    name: typeof r.name === 'string' && r.name ? r.name : 'Untitled folder',
    emoji: typeof r.emoji === 'string' ? r.emoji : '📁',
    image: typeof r.image === 'string' ? r.image : null,
    subjectKey: typeof r.subjectKey === 'string' && r.subjectKey ? r.subjectKey : DEFAULT_SUBJECT_KEY,
    parentId: typeof r.parentId === 'string' ? r.parentId : null,
    color: typeof r.color === 'string' ? r.color : 'var(--blue)',
  };
}

/**
 * Repairs the mf_state blob (decks/folders/etc — everything except the tracker,
 * which sanitizeState() above already covers). Same three real entry points as
 * sanitizeState(): normal startup, cross-tab storage.onChanged sync, and restoring
 * a user-supplied backup file. Only decks/folders get full per-item repair (they're
 * what srs.js's scheduler actually depends on); the other arrays are coerced to
 * arrays of well-formed-looking objects but not deeply validated field-by-field —
 * they're display data, not scheduling-critical, so a malformed entry there is a
 * cosmetic bug rather than a thrown exception. Never throws.
 */
function sanitizeSource(raw) {
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(raw)) return null;
  return {
    ...raw, // preserve all existing fields (bookmarks, content, chapters, etc.)
    // Backfill fields added after initial release — safe no-ops for any source
    // that already has them; provides the correct defaults for older sources.
    subjectKey: (typeof raw.subjectKey === 'string' && raw.subjectKey) ? raw.subjectKey : null,
    timeSpentSec: (typeof raw.timeSpentSec === 'number' && raw.timeSpentSec >= 0) ? raw.timeSpentSec : 0,
    charsRead: (typeof raw.charsRead === 'number' && raw.charsRead >= 0) ? raw.charsRead : 0,
  };
}

function sanitizeMfState(raw) {
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const r = isObj(raw) ? raw : {};
  const arrayOfObjects = v => Array.isArray(v) ? v.filter(isObj) : [];
  // Achievements are stored as plain string IDs (see checkAchievements' state.achievements.push(a.id)),
  // not objects — arrayOfObjects would filter every one of them out.
  const arrayOfStrings = v => Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];

  return {
    decks: Array.isArray(r.decks) ? r.decks.map(sanitizeDeck) : [],
    folders: Array.isArray(r.folders) ? r.folders.map(sanitizeFolder) : [],
    sources: Array.isArray(r.sources) ? r.sources.map(sanitizeSource).filter(Boolean) : [],
    libraryFolders: arrayOfObjects(r.libraryFolders),
    reviewHistory: arrayOfObjects(r.reviewHistory),
    achievements: arrayOfStrings(r.achievements),
    recentStudyScopes: arrayOfObjects(r.recentStudyScopes),
    sessionLog: Array.isArray(r.sessionLog)
      ? r.sessionLog.filter(e => e && typeof e === 'object' && typeof e.ts === 'number').slice(0, 500)
      : [],
    streak: (typeof r.streak === 'number' && Number.isFinite(r.streak) && r.streak >= 0) ? r.streak : 0,
    lastStreakDate: typeof r.lastStreakDate === 'string' ? r.lastStreakDate : null,
    // Not deeply validated field-by-field (see doc comment) — just guaranteed to be
    // a plain object so callers can safely Object.assign/spread it onto defaults
    // without the "Object.assign(target, 'a string')" footgun of copying numeric
    // string-index keys onto state.settings.
    settings: isObj(r.settings) ? r.settings : {},
  };
}

/**
 * Defensively repairs a (possibly missing, corrupted, old-schema, or hand-edited)
 * tracker state object into one guaranteed to match makeDefaultState()'s shape and
 * types. Never throws, no matter what garbage `raw` is — worst case it returns
 * makeDefaultState().
 *
 * Why this exists: this data lives only in chrome.storage.local (no server, no
 * account) and is read from three places where it can't be trusted as-is —
 * (1) normal startup, if a previous version wrote a different shape, (2) the
 * chrome.storage.onChanged listener, which can fire with another tab/device's
 * sync-merged data, and (3) most importantly, restoring a user-supplied .zip/.json
 * backup, which could be hand-edited, from an older export version, or just
 * corrupted. Without this, a single malformed field (e.g. `subjects` being a string,
 * or `history` not being an array) throws inside nearly every function in this file
 * the moment it's touched — silently bricking the entire tracker for that user, with
 * no recovery path short of wiping all their data.
 *
 * Unknown/extra fields are dropped, missing fields get sane defaults, wrong types
 * are coerced or replaced, and known-invalid values (negative XP, NaN, etc.) are
 * clamped or discarded.
 */
function sanitizeState(raw) {
  const def = makeDefaultState();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return def;

  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const isFiniteNonNeg = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const nonNegNum = (v, fallback) => isFiniteNonNeg(v) ? v : fallback;
  const nonNegInt = (v, fallback) => Number.isInteger(v) && v >= 0 ? v : fallback;

  // --- config (sanitize first: getEffectiveSubjects below needs config.customSubjects) ---
  const rawConfig = isObj(raw.config) ? raw.config : {};
  const customSubjects = isObj(rawConfig.customSubjects) ? rawConfig.customSubjects : {};
  const config = {
    xpCoef: nonNegNum(rawConfig.xpCoef, def.config.xpCoef),
    capMult: nonNegNum(rawConfig.capMult, def.config.capMult),
    theme: typeof rawConfig.theme === 'string' ? rawConfig.theme : def.config.theme,
    customSubjects,
  };

  // --- subjects (depends on config above, since getEffectiveSubjects reads it) ---
  const effective = getEffectiveSubjects({ config });
  const rawSubjects = isObj(raw.subjects) ? raw.subjects : {};
  const subjects = {};
  for (const [key, s] of Object.entries(effective)) {
    const r = rawSubjects[key];
    subjects[key] = {
      predictedGrade: (typeof r?.predictedGrade === 'number' && Number.isFinite(r.predictedGrade)) ? r.predictedGrade : null,
      color: typeof r?.color === 'string' ? r.color : s.defaultColor,
      totalXP: nonNegNum(r?.totalXP, 0),
      totalMarks: nonNegNum(r?.totalMarks, 0),
    };
  }

  // --- monthlyMarks: { "YYYY-MM": { subjectKey: marks } } ---
  const rawMM = isObj(raw.monthlyMarks) ? raw.monthlyMarks : {};
  const monthlyMarks = {};
  for (const [mk, bySubject] of Object.entries(rawMM)) {
    if (!isObj(bySubject)) continue;
    const cleaned = {};
    for (const [subjKey, marks] of Object.entries(bySubject)) {
      if (isFiniteNonNeg(marks)) cleaned[subjKey] = marks;
    }
    if (Object.keys(cleaned).length) monthlyMarks[mk] = cleaned;
  }

  // --- history: well-formed entries only, capped at MAX_HISTORY ---
  const rawHistory = Array.isArray(raw.history) ? raw.history : [];
  const history = rawHistory
    .filter(e => isObj(e)
      && typeof e.id === 'string'
      && typeof e.ts === 'number' && Number.isFinite(e.ts)
      && typeof e.subject === 'string'
      && isFiniteNonNeg(e.marks)
      && typeof e.xp === 'number' && Number.isFinite(e.xp))
    .slice(0, MAX_HISTORY)
    .map(e => ({
      id: e.id, ts: e.ts, subject: e.subject, marks: e.marks, xp: e.xp,
      fullMarks: nonNegNum(e.fullMarks, e.marks),
      halfMarks: nonNegNum(e.halfMarks, 0),
      paper: typeof e.paper === 'string' ? e.paper : '',
      notes: typeof e.notes === 'string' ? e.notes : '',
      sourceRef: e.sourceRef ?? null,
    }));

  // --- streak ---
  const rawStreak = isObj(raw.streak) ? raw.streak : {};
  const streak = {
    current: nonNegInt(rawStreak.current, 0),
    longest: nonNegInt(rawStreak.longest, 0),
    lastDate: typeof rawStreak.lastDate === 'string' ? rawStreak.lastDate : null,
  };
  if (streak.longest < streak.current) streak.longest = streak.current; // longest can't be less than current

  return {
    version: 1,
    totalXP: nonNegNum(raw.totalXP, 0),
    subjects,
    monthlyMarks,
    history,
    streak,
    config,
  };
}


/**
 * Merges an imported tracker-state backup into the existing local one, for the
 * Settings -> Import -> "Merge" flow. sanitizeState() alone only repairs one
 * object — naively doing `existing = sanitizeState(imported)` (as Import ->
 * Merge used to) throws away every bit of local Mark Tracker progress that
 * isn't also in the imported file, which contradicts "keep existing + add
 * imported". This instead combines the two:
 *
 *  - history: union by entry id, so re-importing the same backup (or one that
 *    overlaps with local activity, e.g. from another device) can never
 *    double-count a logged session.
 *  - subjects[key].totalXP/totalMarks and monthlyMarks are then recomputed
 *    entirely from that merged history rather than trusting either side's
 *    precomputed sums — both fields are, in this app, only ever written
 *    alongside a matching history entry (see applyLog()/deleteEntry() above),
 *    so this is always exactly reproducible and never double-counts.
 *  - top-level totalXP is *not* purely history-derived, though — flashcard
 *    study also awards tracker XP with no subject/history entry attached (see
 *    store.addXPToTracker() in dashboard-core.js). That "unattributed" portion
 *    (totalXP minus the sum of all subjects' totalXP) is carried forward by
 *    taking whichever side's unattributed amount is larger, which can't lose
 *    progress and can't double-count it either (unlike summing both sides,
 *    which would double-count if one backup is just an older snapshot of the
 *    other's continuous flashcard use).
 *  - predictedGrade/color prefer the existing value, falling back to the
 *    imported one only where the local subject has never been set.
 *  - customSubjects are union'd (existing edits win on a key conflict).
 *  - streak keeps whichever side has the more recent lastDate (a fresher
 *    local streak isn't clobbered by an older backup, and vice versa); ties
 *    fall back to the higher current. longest is the max across both sides
 *    so a personal record already set on either side is never lost.
 */
function mergeTrackerState(existingRaw, importedRaw) {
  const existing = sanitizeState(existingRaw);
  const imported = sanitizeState(importedRaw);

  const byId = new Map(existing.history.map(e => [e.id, e]));
  for (const e of imported.history) if (!byId.has(e.id)) byId.set(e.id, e);
  const history = [...byId.values()].sort((a, b) => a.ts - b.ts).slice(-MAX_HISTORY);

  const subjectTotals = {}; // key -> {totalXP, totalMarks}, derived only from merged history
  const monthlyMarks = {};
  for (const e of history) {
    if (!subjectTotals[e.subject]) subjectTotals[e.subject] = { totalXP: 0, totalMarks: 0 };
    subjectTotals[e.subject].totalXP += e.xp;
    subjectTotals[e.subject].totalMarks += e.marks;
    const mk = new Date(e.ts).toISOString().slice(0, 7);
    if (!monthlyMarks[mk]) monthlyMarks[mk] = {};
    monthlyMarks[mk][e.subject] = (monthlyMarks[mk][e.subject] || 0) + e.marks;
  }
  const sumSubjectXP = raw => Object.values(raw).reduce((s, v) => s + (v?.totalXP || 0), 0);
  const unattributed = Math.max(
    existing.totalXP - sumSubjectXP(existing.subjects),
    imported.totalXP - sumSubjectXP(imported.subjects),
  );
  const historyXP = Object.values(subjectTotals).reduce((s, v) => s + v.totalXP, 0);
  const totalXP = historyXP + Math.max(0, unattributed);

  const customSubjects = { ...imported.config.customSubjects, ...existing.config.customSubjects };
  const config = { ...existing.config, customSubjects };

  const effective = getEffectiveSubjects({ config });
  const subjects = {};
  for (const [key, s] of Object.entries(effective)) {
    const ex = existing.subjects[key], im = imported.subjects[key];
    subjects[key] = {
      predictedGrade: (ex && ex.predictedGrade !== null) ? ex.predictedGrade : (im ? im.predictedGrade : null),
      color: ex?.color || im?.color || s.defaultColor,
      totalXP: subjectTotals[key]?.totalXP ?? 0,
      totalMarks: subjectTotals[key]?.totalMarks ?? 0,
    };
  }

  const importedIsFresher = imported.streak.lastDate && (!existing.streak.lastDate || imported.streak.lastDate > existing.streak.lastDate);
  const streak = {
    current: importedIsFresher ? imported.streak.current : existing.streak.current,
    longest: Math.max(existing.streak.longest, imported.streak.longest, existing.streak.current, imported.streak.current),
    lastDate: importedIsFresher ? imported.streak.lastDate : existing.streak.lastDate,
  };

  return { version: 1, totalXP, subjects, monthlyMarks, history, streak, config };
}



function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}


/* ─────────────────────────────────────────────────────────────
   XP & LEVEL CALCULATIONS
───────────────────────────────────────────────────────────── */

/** Derive level + progress from raw total XP */
function levelFromXP(totalXP) {
  let level = 1;
  let consumed = 0;
  while (true) {
    const needed = BASE_LEVEL_XP * Math.pow(LEVEL_SCALE, level - 1);
    if (consumed + needed > totalXP) {
      return {
        level,
        xpIntoLevel: totalXP - consumed,
        xpForNextLevel: needed,
        progress: (totalXP - consumed) / needed,
      };
    }
    consumed += needed;
    level++;
  }
}

/**
 * Calculate XP earned for logging `marks` for `subjectKey`.
 * Handles monthly cap split (full XP vs half XP).
 */
function calcXP(subjectKey, marks, state) {
  const sub = state.subjects[subjectKey];
  const grade = sub.predictedGrade;
  if (!grade || grade <= 0) return null;

  const coef  = state.config?.xpCoef  ?? XP_COEFFICIENT;
  const cMult = state.config?.capMult ?? MONTHLY_CAP_MULT;

  const xpPerMark  = coef * Math.pow(grade, -2);
  const monthlyCap = getEffectiveSubjects(state)[subjectKey]?.examMarks * cMult || 100 * cMult;
  const monthKey   = getMonthKey();
  const usedThisMonth = (state.monthlyMarks[monthKey]?.[subjectKey]) ?? 0;
  const remaining  = Math.max(0, monthlyCap - usedThisMonth);

  const fullMarks = Math.min(marks, remaining);
  const halfMarks = marks - fullMarks;

  const xp = fullMarks * xpPerMark + halfMarks * xpPerMark * CAP_PENALTY;

  return {
    xp,
    xpPerMark,
    fullMarks,
    halfMarks,
    monthlyCap,
    usedThisMonth,
    remaining,
  };
}

/** Apply a logged session to state, return updated state */
function applyLog(state, subjectKey, marks, paper, notes, sourceRef) {
  const calc = calcXP(subjectKey, marks, state);
  if (!calc) return null;

  const monthKey  = getMonthKey();
  const todayKey  = getTodayKey();

  // Update monthly marks
  if (!state.monthlyMarks[monthKey]) state.monthlyMarks[monthKey] = {};
  state.monthlyMarks[monthKey][subjectKey] =
    (state.monthlyMarks[monthKey][subjectKey] ?? 0) + marks;

  // Update subject totals
  state.subjects[subjectKey].totalXP    += calc.xp;
  state.subjects[subjectKey].totalMarks += marks;

  // Update global XP
  state.totalXP += calc.xp;

  // Update streak
  const last = state.streak.lastDate;
  const yesterday = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  })();

  if (last === todayKey) {
    // same day — no change to streak count
  } else if (last === yesterday) {
    state.streak.current += 1;
  } else {
    state.streak.current = 1;
  }
  state.streak.lastDate  = todayKey;
  state.streak.longest   = Math.max(state.streak.longest, state.streak.current);

  // Append history
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ts: Date.now(),
    subject: subjectKey,
    marks,
    xp: calc.xp,
    fullMarks: calc.fullMarks,
    halfMarks: calc.halfMarks,
    paper: paper || '',
    notes: notes || '',
    sourceRef: sourceRef || null,
  };
  state.history.unshift(entry);
  if (state.history.length > MAX_HISTORY) state.history.length = MAX_HISTORY;

  return { state, calc, entry };
}


/* ─────────────────────────────────────────────────────────────
   FORMATTING HELPERS
───────────────────────────────────────────────────────────── */

function fmtXP(xp) {
  if (xp >= 1_000_000) return (xp / 1_000_000).toFixed(2) + 'M';
  if (xp >= 1_000)     return (xp / 1_000).toFixed(2) + 'K';
  return xp.toFixed(1);
}

function fmtNum(n) {
  return Number(n).toLocaleString('en-GB');
}

function subjectColor(key, state) {
  return state?.subjects?.[key]?.color ?? getEffectiveSubjects(state)[key]?.defaultColor ?? '#888';
}

function todayXP(state) {
  const today = getTodayKey();
  return state.history
    .filter(e => {
      const d = new Date(e.ts);
      const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      return k === today;
    })
    .reduce((s, e) => s + e.xp, 0);
}

function monthXP(state) {
  const now = new Date();
  return state.history
    .filter(e => {
      const d = new Date(e.ts);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((s, e) => s + e.xp, 0);
}

function totalSessions(state) {
  return state.history.length;
}

function monthlyMarksForSubject(subjectKey, state) {
  const mk = getMonthKey();
  return state.monthlyMarks[mk]?.[subjectKey] ?? 0;
}

/** Delete a history entry by id, reversing its XP/marks effects on state */
function deleteEntry(state, entryId) {
  const idx = state.history.findIndex(e => e.id === entryId);
  if (idx === -1) return false;
  const entry = state.history[idx];

  // Reverse subject totals
  state.subjects[entry.subject].totalXP    -= entry.xp;
  state.subjects[entry.subject].totalMarks -= entry.marks;
  if (state.subjects[entry.subject].totalXP    < 0) state.subjects[entry.subject].totalXP    = 0;
  if (state.subjects[entry.subject].totalMarks < 0) state.subjects[entry.subject].totalMarks = 0;

  // Reverse global XP
  state.totalXP -= entry.xp;
  if (state.totalXP < 0) state.totalXP = 0;

  // Reverse monthly marks
  const d  = new Date(entry.ts);
  const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  if (state.monthlyMarks[mk]?.[entry.subject]) {
    state.monthlyMarks[mk][entry.subject] -= entry.marks;
    if (state.monthlyMarks[mk][entry.subject] < 0) state.monthlyMarks[mk][entry.subject] = 0;
  }

  state.history.splice(idx, 1);
  return true;
}

// ─────────────────────────────────────────────────────────────────
// parseAICardText — converts a small local LLM's freeform reply into
// structured card objects. We deliberately DON'T ask the model for JSON:
// small/quantized models routinely emit near-JSON with trailing commas,
// unescaped quotes inside strings, or truncated output when the reply runs
// long, and a single malformed brace throws away the whole batch. Plain
// "Card1 / Front: ... / Back: ..." is something even weak local models
// produce reliably, and it degrades gracefully — a botched card is just a
// dropped card, not a parse failure for everything else. See
// getAISystemPrompt()/generateCardsFromText() in dashboard-capture.js for
// where this is called from.
//
// Tolerates, on top of the canonical format:
//  - missing/markdown-decorated headers ("**Card 1**", "### Card 2", or no
//    header at all — card boundaries are then inferred from repeated
//    Front:/Question: lines)
//  - Question:/Answer: as aliases for Front:/Back:
//  - values that wrap across multiple lines (continues until a blank line
//    or the next recognized field)
//  - a single wrapping ``` code fence and chatty preamble/commentary
//  - **bold**/__underline__ markdown and leading "- "/"1. " list markers
//    inside values
// Cards missing a Front or a Back are dropped rather than kept partial.
function parseAICardText(raw) {
  if (!raw || typeof raw !== 'string') return [];
  let text = raw.trim();
  if (!text) return [];
  // Strip a single wrapping ``` (or ```lang) code fence, if the model put
  // its whole reply inside one.
  text = text.replace(/^```[a-zA-Z0-9]*\s*\n/, '').replace(/\n?```\s*$/, '').trim();
  if (!text) return [];

  const FIELD_RE = /^(front|back|question|answer|hint|tags?)\s*:\s*(.*)$/i;
  const FIELD_ALIAS = { front: 'front', question: 'front', back: 'back', answer: 'back', hint: 'hint', tag: 'tags', tags: 'tags' };

  function normalizeHeaderLine(line) {
    let l = line.trim();
    l = l.replace(/^#+\s*/, '');           // markdown heading ("### Card 2")
    l = l.replace(/^\*+/, '').replace(/\*+$/, ''); // bold wrapping ("**Card 1**")
    l = l.replace(/^_+/, '').replace(/_+$/, '');
    return l.trim();
  }
  function isCardHeader(line) {
    return /^card\s*\d*$/i.test(normalizeHeaderLine(line));
  }
  function cleanValue(v) {
    if (!v) return '';
    let s = String(v).trim();
    s = s.replace(/\*\*(.*?)\*\*/g, '$1').replace(/__(.*?)__/g, '$1');
    s = s.replace(/^(?:[-*]\s+|\d+\.\s+)/, ''); // leading list marker
    return s.trim();
  }
  function parseTags(v) {
    if (!v) return [];
    let s = String(v).trim().replace(/\*\*/g, '').replace(/__/g, '');
    s = s.replace(/^(?:[-*]\s+|\d+\.\s+)/, '');
    return s.split(',').map(t => t.trim()).filter(Boolean).slice(0, 6);
  }

  const lines = text.split(/\r\n|\r|\n/);
  const rawCards = [];
  let current = null;
  let lastField = null;

  function freshCard() { return { front: '', back: '', hint: '', tagsRaw: '' }; }
  function finalize() {
    if (current) rawCards.push(current);
    current = null;
    lastField = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '') { lastField = null; continue; } // blank line ends any field continuation

    if (isCardHeader(line)) {
      finalize();
      current = freshCard();
      continue;
    }

    const m = line.match(FIELD_RE);
    if (m) {
      const key = FIELD_ALIAS[m[1].toLowerCase()];
      const value = m[2];
      if (!current) current = freshCard();
      // Headerless input: a repeated Front:/Question: with the previous
      // Front already filled means a new card has started.
      if (key === 'front' && current.front) {
        finalize();
        current = freshCard();
      }
      if (key === 'tags') current.tagsRaw = value; else current[key] = value;
      lastField = key;
      continue;
    }

    // Continuation of the previous field's value (e.g. a Front: that wraps
    // onto a second line) — anything else (stray commentary between cards)
    // is silently ignored.
    if (current && lastField && lastField !== 'tags') {
      current[lastField] += '\n' + line;
    }
  }
  finalize();

  const cards = [];
  for (const rc of rawCards) {
    const front = cleanValue(rc.front);
    const back = cleanValue(rc.back);
    if (!front || !back) continue; // drop partial cards rather than keep them half-empty
    cards.push({ front, back, hint: cleanValue(rc.hint), tags: parseTags(rc.tagsRaw) });
  }
  return cards;
}

// parseAIJSONCards — companion to parseAICardText for when the local server
// is asked for structured output (LM Studio/llama.cpp's `response_format:
// json_schema`, Ollama's `format: json`, etc. — see AI_CARD_JSON_SCHEMA and
// getAISystemPromptJSON() in dashboard-core.js). A capable model constrained
// by a real JSON Schema is far less likely to emit the stray-comma/unescaped-
// quote breakage the plain-text format was designed to route around, so here
// a single JSON.parse is the primary path — but we still don't trust the
// server/model completely: some wrap the array in commentary or a ```json
// fence even under schema constraints, so we fall back to slicing out the
// outermost {...}/[...] before giving up. Same graceful-degradation rule as
// parseAICardText: a malformed individual card is dropped, not the batch.
function parseAIJSONCards(raw) {
  if (!raw || typeof raw !== 'string') return [];
  let text = raw.trim();
  if (!text) return [];
  text = text.replace(/^```[a-zA-Z0-9]*\s*\n/, '').replace(/\n?```\s*$/, '').trim();
  if (!text) return [];

  function tryParse(s) {
    try { return JSON.parse(s); } catch (e) { return undefined; }
  }

  let parsed = tryParse(text);
  if (parsed === undefined) {
    // Slice out the outermost bracketed structure and retry — tolerates a
    // chatty preamble/postamble the schema constraint didn't quite suppress.
    const first = text.search(/[[{]/);
    const lastCurly = text.lastIndexOf('}');
    const lastSquare = text.lastIndexOf(']');
    const last = Math.max(lastCurly, lastSquare);
    if (first !== -1 && last > first) parsed = tryParse(text.slice(first, last + 1));
  }
  if (parsed === undefined || parsed === null) return [];

  let list;
  if (Array.isArray(parsed)) list = parsed;
  else if (Array.isArray(parsed.cards)) list = parsed.cards;
  else if (Array.isArray(parsed.flashcards)) list = parsed.flashcards;
  else return [];

  function asString(v) { return (typeof v === 'string' || typeof v === 'number') ? String(v).trim() : ''; }
  function asTags(v) {
    if (Array.isArray(v)) return v.map(asString).filter(Boolean).slice(0, 6);
    if (typeof v === 'string') return v.split(',').map(t => t.trim()).filter(Boolean).slice(0, 6);
    return [];
  }

  const cards = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    // `q`/`a` is the compact schema fine-tuned mode is expected to return
    // (see FT_OUTPUT_SCHEMA_NOTE, dashboard-core.js); front/back/question/
    // answer keep working exactly as before for normal mode.
    const front = asString(item.front ?? item.question ?? item.q);
    const back = asString(item.back ?? item.answer ?? item.a);
    if (!front || !back) continue; // drop partial cards rather than keep them half-empty
    cards.push({ front, back, hint: asString(item.hint), tags: asTags(item.tags) });
  }
  return cards;
}

// Export for Node's test runner (tests/shared.test.js) — `module` doesn't exist in
// the browser/service-worker/content-script contexts this file is normally loaded
// in, so this block is always skipped there and has zero effect on the extension.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    XP_COEFFICIENT, MONTHLY_CAP_MULT, BASE_LEVEL_XP, LEVEL_SCALE, CAP_PENALTY, MAX_HISTORY,
    levelFromXP, calcXP, applyLog, fmtXP, fmtNum, todayXP, monthXP, totalSessions,
    monthlyMarksForSubject, deleteEntry, getLevelTitle, getTodayKey, getMonthKey,
    hhmm2min, calcSunTimes, resolveScheduledTheme, hexToRgbTriplet, mixHex, relLuminance,
    getEffectiveSubjects, makeDefaultState, sanitizeState, mergeTrackerState, subjectColor, SUBJECTS, LEVEL_TITLES,
    DEFAULT_SCHEDULE, THEME_PRESETS,
    sanitizeCard, sanitizeDeck, sanitizeFolder, sanitizeMfState,
    renderRichText, setRichText, latexApproximate, parseAICardText, parseAIJSONCards,
  };
}
