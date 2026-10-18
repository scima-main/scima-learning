'use strict';
/* ═══════════════════════════════════════════════════════════════════
   scima-games.js — the Tier-0/Tier-0.5 game engine: catalog, sanitizer,
   deterministic reducer. Loaded by the hidden /games/ page and pinned by
   tests-and-tools (gamekit.py mirrors the catalog; a parity test keeps the
   two in lockstep).

   CHART MODEL (see game-packages-design.md §9): a game is a grid of
   objects at (step, lane). Persistent types (prompt/input/match/rule) take
   effect from their step until a later object of the same family overrides
   them; instant types (portal/event/cosmetic) fire once when the play head
   reaches their step. pace:"input" advances the play head per player
   commit; pace:"time" advances per beatMs via tick events.

   The reducer is pure: (session, event) → session' so games are replayable,
   headlessly testable, and (later) ghost-raceable.
═══════════════════════════════════════════════════════════════════ */

// ── Catalog v1 — one metadata table, four consumers ─────────────────────
// props: {key: {type, default, min?, max?, enum?, label}} — the editor's
// inspector form, the validator, gamekit.py and this sanitizer all derive
// from it. `persist` = family override semantics (see header).
const SCIMA_GAME_CATALOG = {
  'prompt.stream': { lane: 'prompt', persist: true, label: 'Streaming sequence prompt', props: {
    source: { type: 'string', default: 'constant:pi.decimals', label: 'Source (constant:… | data: inline array)' },
    chunk:  { type: 'int', default: 1, min: 1, max: 16, label: 'Chars per round' } } },
  'prompt.rounds': { lane: 'prompt', persist: true, label: 'Round-based prompt', props: {
    source: { type: 'string', default: 'deck:all', label: 'Source (deck:all | data: inline array)' },
    order:  { type: 'enum', default: 'shuffle', enum: ['shuffle', 'seq'], label: 'Order' } } },
  'input.typed': { lane: 'input', persist: true, label: 'Typed input', props: {
    charset: { type: 'string', default: '0-9', label: 'Allowed charset hint' },
    commit:  { type: 'enum', default: 'perChar', enum: ['perChar', 'perSubmit'], label: 'Commit mode' },
    maxLen:  { type: 'int', default: 32, min: 1, max: 256, label: 'Max buffered length' } } },
  'input.choice': { lane: 'input', persist: true, label: 'Multiple-choice input', props: {
    options: { type: 'int', default: 4, min: 2, max: 8, label: 'Option count' } } },
  'match.prefix': { lane: 'effect', persist: true, label: 'Prefix/stream matcher', props: {
    scorePer: { type: 'enum', default: 'char', enum: ['char', 'round'], label: 'Score unit' },
    missCost: { type: 'int', default: 1, min: 0, max: 9, label: 'Lives lost per miss' } } },
  'match.exact': { lane: 'effect', persist: true, label: 'Exact/round matcher', props: {
    missCost: { type: 'int', default: 1, min: 0, max: 9, label: 'Lives lost per miss' } } },
  'rule.lives': { lane: 'hazard', persist: true, label: 'Lives', props: {
    lives: { type: 'int', default: 3, min: 1, max: 99, label: 'Life count' } } },
  'rule.timer': { lane: 'hazard', persist: true, label: 'Countdown timer', props: {
    seconds: { type: 'int', default: 60, min: 5, max: 3600, label: 'Seconds' } } },
  'rule.end': { lane: 'hazard', persist: true, label: 'End conditions', props: {
    when: { type: 'list', default: ['lives==0'], enum: ['lives==0', 'timer==0', 'source-end'], label: 'End when' } } },
  'portal.pace': { lane: 'effect', persist: false, label: 'Pace shift portal', props: {
    pace: { type: 'enum', default: 'time', enum: ['input', 'time'], label: 'New pace' },
    beatMs: { type: 'int', default: 500, min: 50, max: 10000, label: 'Beat (ms) when timed' } } },
  'portal.mode': { lane: 'effect', persist: false, label: 'Input-mode shift portal', props: {
    commit: { type: 'enum', default: 'perSubmit', enum: ['perChar', 'perSubmit'], label: 'New commit mode' },
    chunk: { type: 'int', default: 4, min: 1, max: 16, label: 'New chunk size' } } },
  'event.score': { lane: 'effect', persist: false, label: 'Instant score bonus', props: {
    add: { type: 'int', default: 10, min: -1000, max: 1000, label: 'Points' } } },
  'cosmetic.token': { lane: 'cosmetic', persist: false, label: 'Milestone token', props: {
    every: { type: 'int', default: 10, min: 1, max: 1000, label: 'Every N correct' },
    token: { type: 'string', default: '🔥', label: 'Token' } } },
};

// Engine-bundled constants (length-capped; authors can also inline data).
const SCIMA_GAME_CONSTANTS = (() => {
  const PI = '3.' + '1415926535897932384626433832795028841971693993751058209749445923078164062862089986280348253421170679821480865132823066470938446095505822317253594081284811174502841027019385211055596446229489549303819644288109756659334461284756482337867831652712019091456485669234603486104543266482133936072602491412737245870066063155881748815209209628292540917153643678925903600113305305488204665213841469519415116094330572703657595919530921861173819326117931051185480744623799627495673518857527248912279381830119491298336733624406566430860213949463952247371907021798609437027705392171762931767523846748184676694051320005681271452635608277857713427577896091736371787214684409012249534301465495853710507922796892589235420199561121290219608640344181598136297747713099605187072113499999983729780499510597317328160963185950244594553469083026425223082533446850352619311881710100031378387528865875332083814206171776691473035982534904287554687311595628638823537875937519577818577805321712268066130019278766111959092164201989';
  const E = '2.7182818284590452353602874713526624977572470936999595749669676277240766303535475945713821785251664274274663919320030599218174135966290435729003342952605956307381323286279434907632338298807531952510190115738341879307021540891499348841675092447614606680822648001684774118537423454424371075390777449920695517027618386062613313845830007520449338265602976067371132007093287091274437470472306969772093101416928368190255151086574637721112523897844250569536967707854499699679468644549059879316368892300987931277361782154249992295763514822082698951936680331825288693984964651058209392398294887933203625094431173012381970684161403970198376793206832823764648042953118023287825098194558153017567173113327755063828206373782453846741861832453642776544627481839147318029384719649327465734627749745369292983239441227254989481684390829262873963823934466289802786833498934914406567540618273383737488498482801473512833164860518646366830198434681464480207146816034314365859101592316034997865846724126274737425891738290423449830534428016861';
  return {
    'constant:pi.decimals': PI.replace('3.', ''),
    'constant:e.decimals': E.replace('2.', ''),
  };
})();
const SCIMA_GAME_CONST_CAP = 1000;
const SCIMA_GAME_OBJECT_CAP = 2000;
const SCIMA_GAME_INLINE_CAP = 500;

// ── Sanitizer (same philosophy as sanitizeCard: never throws, fills defaults) ──
function sanitizeGameObject(raw) {
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const r = isObj(raw) ? raw : {};
  const t = typeof r.t === 'string' && SCIMA_GAME_CATALOG[r.t] ? r.t : null;
  if (!t) return null;
  const spec = SCIMA_GAME_CATALOG[t];
  const props = {};
  for (const [k, ps] of Object.entries(spec.props)) {
    const v = r.props ? r.props[k] : undefined;
    if (ps.type === 'int') {
      const n = (typeof v === 'number' && Number.isFinite(v)) ? Math.round(v)
              : (typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? parseInt(v.trim(), 10)
              : ps.default);
      props[k] = Math.min(ps.max, Math.max(ps.min, n));
    } else if (ps.type === 'enum') {
      props[k] = (ps.enum.includes(v) ? v : ps.default);
    } else if (ps.type === 'list') {
      const arr = Array.isArray(v) ? v.filter(x => ps.enum.includes(x)) : [];
      props[k] = arr.length ? [...new Set(arr)] : [...ps.default];
    } else { // string
      const s = (typeof v === 'string') ? v.slice(0, 5000) : ps.default;
      props[k] = s;
    }
  }
  const step = (typeof r.step === 'number' && Number.isFinite(r.step)) ? Math.max(0, Math.min(100000, Math.round(r.step))) : 0;
  const lane = spec.lane;   // lane is cosmetic but must match the catalog
  return { t, step, lane, props };
}

function sanitizeGameSpec(raw) {
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const r = isObj(raw) ? raw : {};
  const g = isObj(r.game) ? r.game : r;
  const name = (typeof g.name === 'string' && g.name.trim()) ? g.name.trim().slice(0, 80) : 'Untitled game';
  const grid = isObj(g.grid) ? g.grid : {};
  const pace = (grid.pace === 'time') ? 'time' : 'input';
  const beatMs = (typeof grid.beatMs === 'number' && Number.isFinite(grid.beatMs))
    ? Math.min(10000, Math.max(50, Math.round(grid.beatMs))) : 500;
  let objects = (Array.isArray(g.objects) ? g.objects : []).map(sanitizeGameObject).filter(Boolean);
  objects = objects.slice(0, SCIMA_GAME_OBJECT_CAP)
    .sort((a, b) => a.step - b.step);
  const attribution = Array.isArray(g.attribution)
    ? g.attribution.filter(a => isObj(a) && typeof a.name === 'string')
        .slice(0, 50).map(a => ({ name: a.name.slice(0, 80), role: (a.role === 'remixer' ? 'remixer' : 'creator'), hash: typeof a.hash === 'string' ? a.hash.slice(0, 80) : null }))
    : [];
  return {
    format: 'chart', chartVersion: 1,
    name,
    version: (typeof g.version === 'string' && /^\d+\.\d+\.\d+$/.test(g.version)) ? g.version : '1.0.0',
    remixOf: isObj(g.remixOf) ? { id: String(g.remixOf.id || '').slice(0, 100), name: String(g.remixOf.name || '').slice(0, 80), author: String(g.remixOf.author || '').slice(0, 80) } : null,
    remixable: g.remixable !== false,          // remix-by-default, Scratch/GD style
    attribution,
    grid: { pace, beatMs, lanes: ['prompt', 'input', 'effect', 'hazard', 'cosmetic'] },
    objects,
    inlineData: Array.isArray(g.inlineData) ? g.inlineData.slice(0, SCIMA_GAME_INLINE_CAP).map(String) : [],
  };
}

// ── Source resolution ────────────────────────────────────────────────────
function gameSourceSeq(spec, source) {
  if (typeof source === 'string' && source.startsWith('constant:')) {
    return (SCIMA_GAME_CONSTANTS[source] || '').slice(0, SCIMA_GAME_CONST_CAP).split('');
  }
  if (source === 'data:inline') return spec.inlineData.slice();
  if (typeof source === 'string' && source.startsWith('deck:')) {
    const cards = (typeof state !== 'undefined' ? state.decks : []).flatMap(d => d.cards);
    return cards.map(c => c.front).filter(Boolean);
  }
  return [];
}

// ── The reducer ──────────────────────────────────────────────────────────
function createGameSession(spec, opts = {}) {
  const s = sanitizeGameSpec(spec);
  const active = {};   // family -> object
  const at = step => t => {
    let cur = null;
    for (const o of s.objects) { if (o.step <= step && o.t === t) cur = o; }
    return cur;
  };
  const sess = {
    spec: s, step: 0, pace: s.grid.pace, beatMs: s.grid.beatMs,
    idx: 0, lives: 3, score: 0, combo: 0, maxCombo: 0,
    correct: 0, misses: 0, elapsedMs: 0,
    status: 'running', endReason: null, buffer: '',
    tokens: [], round: 0,
    missLog: [],            // [{at, ch}] — wrong chars, for the track renderer
    _at: at, _active: active,
    seed: opts.seed || 1,
  };
  // initial lives/timer from step-0 rules
  const livesRule = at(0)('rule.lives'); if (livesRule) sess.lives = livesRule.props.lives;
  const timer = at(0)('rule.timer'); sess.timeLeft = timer ? timer.props.seconds : null;
  _gamePrimeRound(sess);
  return sess;
}

function _gameShuffle(arr, seed) {
  const a = [...arr]; let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function _gamePrimeRound(sess) {
  const s = sess.spec;
  const prompt = sess._at(sess.step)('prompt.stream') || sess._at(sess.step)('prompt.rounds');
  sess.promptType = prompt ? prompt.t : null;
  if (!prompt) { sess.expected = null; return; }
  if (prompt.t === 'prompt.stream') {
    const seq = gameSourceSeq(s, prompt.props.source);
    sess.seq = seq;
    sess.expected = seq.slice(sess.idx, sess.idx + prompt.props.chunk).join('');
  } else {
    if (!sess.roundPool) {
      let pool = gameSourceSeq(s, prompt.props.source);
      if (prompt.props.order === 'shuffle') pool = _gameShuffle(pool, sess.seed);
      sess.roundPool = pool; sess.poolIdx = 0;
    }
    sess.expected = sess.roundPool[sess.poolIdx] ?? null;
    if (sess.expected !== null && !sess.choiceOptions) sess.round++;
  }
  const input = sess._at(sess.step)('input.typed') || sess._at(sess.step)('input.choice');
  sess.inputType = input ? input.t : null;
  sess.commit = input && input.t === 'input.typed' ? input.props.commit : 'perSubmit';
  if (input && input.t === 'input.choice') {
    const pool = (sess.roundPool || gameSourceSeq(s, (sess._at(sess.step)('prompt.rounds') || {}).source || 'deck:all'));
    const wrong = _gameShuffle(pool.filter(x => x !== sess.expected), sess.seed + sess.round).slice(0, input.props.options - 1);
    sess.choiceOptions = _gameShuffle([sess.expected, ...wrong], sess.seed + sess.round * 2);
  } else sess.choiceOptions = null;
}

function _gameEnd(sess, reason) { sess.status = 'ended'; sess.endReason = reason; }

function _gameAfterCommit(sess) {
  const s = sess.spec;
  const end = sess._at(sess.step)('rule.end');
  const when = end ? end.props.when : ['lives==0'];
  if (when.includes('lives==0') && sess.lives <= 0) return _gameEnd(sess, 'lives');
  if (when.includes('timer==0') && sess.timeLeft !== null && sess.timeLeft <= 0) return _gameEnd(sess, 'timer');
  const prompt = sess._at(sess.step)('prompt.stream');
  if (prompt && when.includes('source-end') && sess.idx >= (sess.seq || []).length) return _gameEnd(sess, 'complete');
  if (sess.promptType === 'prompt.rounds' && sess.roundPool && sess.poolIdx >= sess.roundPool.length) return _gameEnd(sess, 'complete');
  // instant objects at the new step
  if (sess.pace === 'input') sess.step += 1;
  for (const o of s.objects) {
    if (o.step !== sess.step) continue;
    if (o.t === 'portal.pace') { sess.pace = o.props.pace; sess.beatMs = o.props.beatMs; }
    if (o.t === 'portal.mode') { sess.commit = o.props.commit; const p = sess._at(sess.step)('prompt.stream'); if (p) sess.expected = (sess.seq || []).slice(sess.idx, sess.idx + o.props.chunk).join(''); }
    if (o.t === 'event.score') sess.score += o.props.add;
    if (o.t === 'cosmetic.token' && sess.correct > 0 && sess.correct % o.props.every === 0) sess.tokens.push(o.props.token);
  }
  if (sess.promptType === 'prompt.rounds') sess.choiceOptions = null;
  _gamePrimeRound(sess);
}

function _gameHit(sess, n) {
  const match = sess._at(sess.step)('match.prefix') || sess._at(sess.step)('match.exact');
  sess.correct += 1; sess.combo += 1; sess.maxCombo = Math.max(sess.maxCombo, sess.combo);
  sess.score += (match && match.props.scorePer === 'round') ? 10 : (n || 1);
  if (sess.promptType === 'prompt.stream') sess.idx += (n || 1);
  else sess.poolIdx = (sess.poolIdx || 0) + 1;
}

function _gameMiss(sess) {
  const match = sess._at(sess.step)('match.prefix') || sess._at(sess.step)('match.exact');
  const cost = match ? match.props.missCost : 1;
  sess.misses += 1; sess.combo = 0; sess.lives -= cost;
  if (sess.missLog.length < 500) sess.missLog.push({ at: sess.idx, ch: sess.lastInput || '' });
}

/** feedGameSession(sess, event) — pure-ish reducer (mutates a copy).
 *  events: {type:'input', v} | {type:'commit'} | {type:'tick', ms} | {type:'abort'} */
function feedGameSession(prev, event) {
  if (prev.status !== 'running') return prev;
  const sess = Object.assign(Object.create(Object.getPrototypeOf(prev)), prev);
  sess.tokens = [...prev.tokens];
  sess.missLog = [...prev.missLog];
  if (event.type === 'abort') { _gameEnd(sess, 'abort'); return sess; }
  if (event.type === 'tick') {
    if (sess.pace !== 'time') return sess;
    sess.elapsedMs += event.ms || sess.beatMs;
    if (sess.timeLeft !== null) {
      sess.timeLeft = Math.max(0, sess.timeLeft - (event.ms || sess.beatMs) / 1000);
      if (sess.timeLeft <= 0) { _gameAfterCommit(sess); return sess; }
    }
    sess.step += 1;
    for (const o of sess.spec.objects) {
      if (o.step !== sess.step) continue;
      if (o.t === 'portal.pace') { sess.pace = o.props.pace; sess.beatMs = o.props.beatMs; }
      if (o.t === 'event.score') sess.score += o.props.add;
    }
    _gamePrimeRound(sess);
    return sess;
  }
  if (event.type === 'input') {
    const input = sess._at(sess.step)('input.typed') || sess._at(sess.step)('input.choice');
    if (sess.inputType === 'input.choice') {
      if (sess.choiceOptions && sess.choiceOptions.includes(event.v)) {
        sess.lastInput = event.v;
        if (event.v === sess.expected) _gameHit(sess, 1); else _gameMiss(sess);
        _gameAfterCommit(sess);
      }
      return sess;
    }
    if (!input) return sess;
    if (sess.commit === 'perChar') {
      const ch = String(event.v || '').slice(0, 1);
      if (!ch) return sess;
      const want = (sess.expected || '').slice(0, 1);
      sess.lastInput = ch;
      if (ch === want) _gameHit(sess, 1); else _gameMiss(sess);
      _gameAfterCommit(sess);
      return sess;
    }
    sess.buffer = (sess.buffer + String(event.v || '')).slice(0, input.props.maxLen || 32);
    return sess;
  }
  if (event.type === 'commit') {
    if (sess.commit === 'perSubmit') {
      const want = sess.expected || '';
      if (sess.buffer.trim() && sess.buffer.trim() === String(want).trim()) _gameHit(sess, want.length || 1);
      else { sess.lastInput = sess.buffer; _gameMiss(sess); }
      sess.buffer = '';
    }
    _gameAfterCommit(sess);
  }
  return sess;
}
