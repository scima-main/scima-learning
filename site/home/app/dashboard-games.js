'use strict';
/* ═══════════════════════════════════════════════════════════════════
   dashboard-games.js — the hidden /games/ route (Arcade): play runner,
   the P0.5 list+inspector editor MVP, import/export and share strings.
   Not linked from the nav on purpose (pre-launch); reachable only by
   direct URL until the feature graduates into NAV_ITEMS.

   Storage: localStorage `scima_games` = {installed:{id:envelope},
   best:{id:{score,ts,endReason}}, drafts:{id:chart}} — sanitized on read.
   Identity: sha256 of canonical JSON (same algorithm as gamekit.py).
   Remix culture (Scratch/GD style): charts are remixable by default;
   forking appends to the attribution chain and sets remixOf.
═══════════════════════════════════════════════════════════════════ */

const GAMES_STORE_KEY = 'scima_games';

// ── Built-in charts (authored in the same format users emit) ────────────
const SCIMA_BUILTIN_GAMES = [
  { name: 'Pi Recall', version: '1.0.0', grid: { pace: 'input' }, objects: [
    { t: 'prompt.stream', step: 0, props: { source: 'constant:pi.decimals', chunk: 1 } },
    { t: 'input.typed', step: 0, props: { charset: '0-9', commit: 'perChar' } },
    { t: 'match.prefix', step: 0, props: { scorePer: 'char', missCost: 1 } },
    { t: 'rule.lives', step: 0, props: { lives: 3 } },
    { t: 'rule.end', step: 0, props: { when: ['lives==0'] } },
    { t: 'cosmetic.token', step: 0, props: { every: 10, token: '🥧' } },
  ]},
  { name: 'Pi Sudden Shift', version: '1.0.0', grid: { pace: 'input' }, objects: [
    { t: 'prompt.stream', step: 0, props: { source: 'constant:pi.decimals', chunk: 1 } },
    { t: 'input.typed', step: 0, props: { charset: '0-9', commit: 'perChar' } },
    { t: 'match.prefix', step: 0, props: { scorePer: 'char', missCost: 1 } },
    { t: 'rule.lives', step: 0, props: { lives: 3 } },
    { t: 'rule.end', step: 0, props: { when: ['lives==0'] } },
    { t: 'portal.mode', step: 24, props: { commit: 'perChar', chunk: 3 } },   // GD-style portal
    { t: 'cosmetic.token', step: 0, props: { every: 10, token: '🔥' } },
  ]},
  { name: 'Transcription Sprint', version: '1.0.0', grid: { pace: 'time', beatMs: 500 }, objects: [
    { t: 'prompt.rounds', step: 0, props: { source: 'deck:all', order: 'shuffle' } },
    { t: 'input.typed', step: 0, props: { charset: 'any', commit: 'perSubmit' } },
    { t: 'match.exact', step: 0, props: { missCost: 1 } },
    { t: 'rule.timer', step: 0, props: { seconds: 60 } },
    { t: 'rule.end', step: 0, props: { when: ['timer==0', 'source-end'] } },
  ]},
];

// ── canonical JSON + hashing + share strings (mirror of gamekit.py) ──────
function gameCanonical(v) {
  if (Array.isArray(v)) return '[' + v.map(gameCanonical).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map(k =>
      JSON.stringify(k) + ':' + gameCanonical(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}
async function gameIdOf(spec) {
  const data = new TextEncoder().encode(gameCanonical(sanitizeGameSpec(spec)));
  if (crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Insecure-context fallback (plain-http LAN): FNV-1a 64 — same ids only
  // within such contexts; gamekit.py always uses SHA-256.
  let h1 = 0x84222325, h2 = 0xcbf29ce4;
  for (const b of data) { h1 = ((h1 ^ b) * 0x100000001b3) % 4294967296; h2 = ((h2 ^ b) * 0x100000001b3) % 4294967296; }
  return 'fnv' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
function gameToSkeletal(spec) {
  const s = sanitizeGameSpec(spec);
  const LANES = s.grid.lanes;
  return {
    n: s.name, v: s.version,
    g: [s.grid.pace === 'time' ? 1 : 0, s.grid.beatMs === 500 ? 0 : s.grid.beatMs],
    o: s.objects.map(o => {
      const cat = SCIMA_GAME_CATALOG[o.t];
      const p = {};
      for (const [k, val] of Object.entries(o.props)) {
        if (gameCanonical(val) !== gameCanonical(cat.props[k].default)) p[k] = val;
      }
      const row = [o.t, o.step, LANES.indexOf(o.lane)];
      if (Object.keys(p).length) row.push(p);
      return row;
    }),
  };
  // attribution/remix intentionally NOT skeletized — provenance travels in full
}
function gameFromSkeletal(sk) {
  const s = sanitizeGameSpec({});
  const lanes = s.grid.lanes;
  return sanitizeGameSpec({
    name: sk.n, version: sk.v,
    grid: { pace: (sk.g && sk.g[0] === 1) ? 'time' : 'input', beatMs: (sk.g && sk.g[1]) || 500 },
    objects: (sk.o || []).map(row => ({
      t: row[0], step: row[1], lane: lanes[row[2]] || 'effect', props: row[3] || {},
    })),
    attribution: sk.a || [], remixOf: sk.r || null, remixable: sk.x !== false,
  });
}
function _b64url(bytes) {
  let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function _b64urlDecode(str) {
  const body = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(body + '='.repeat((4 - (body.length % 4)) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
function gameShareString(spec) {
  const json = gameCanonical(gameToSkeletal(spec));
  return 'SCIMAGAME1-' + _b64url(window.fflate.zlibSync(new TextEncoder().encode(json)));
}
function gameParseShareString(str) {
  const raw = String(str).trim();
  const m = raw.match(/^SCIMAGAME1-([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  const json = new TextDecoder().decode(window.fflate.unzlibSync(_b64urlDecode(m[1])));
  return gameFromSkeletal(JSON.parse(json));
}

// ── store ────────────────────────────────────────────────────────────────
function loadGamesStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(GAMES_STORE_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return { installed: {}, best: {}, drafts: {} };
    const installed = {};
    for (const [id, env] of Object.entries(raw.installed || {})) {
      if (env && env.game) installed[id] = { game: sanitizeGameSpec(env.game) };
    }
    return { installed, best: raw.best || {}, drafts: raw.drafts || {} };
  } catch (e) { return { installed: {}, best: {}, drafts: {} }; }
}
function saveGamesStore(store) {
  try { localStorage.setItem(GAMES_STORE_KEY, JSON.stringify(store)); } catch (e) {}
}

let _gamesTab = 'play';        // play | editor | io
let _gamesSel = null;          // chart currently loaded in editor/playtest
let _gamesPlaySess = null;
let _gamesTickHandle = null;
let _gamesAuthor = '';
let _gamesIOMode = 'share';   // 'share' | 'json' — what the import/export box opens with

function attributionLine(g) {
  const chain = (g.attribution || []);
  if (!chain.length) return g.remixOf ? `remix of ${g.remixOf.name}` : '';
  return chain.map(a => `${a.name}${a.role === 'remixer' ? ' (remix)' : ''}`).join(' → ');
}

// ── view ─────────────────────────────────────────────────────────────────
function renderGames(c) {
  c.innerHTML = '';
  const store = loadGamesStore();
  c.append(
    el('div', { style: 'display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px' },
      el('div', {},
        el('div', { class: 'section-title' }, scLbl('gamepad','Arcade')),
        el('div', { class: 'section-sub' }, 'Custom study games — designed in-app or outside it, shared as JSON')),
      makeHelpBtn('How game charts work', () => openGameHelp(), false)),
    el('div', { class: 'tab-bar', style: 'margin-bottom:16px' },
      ...[['play', 'play', 'Play'], ['editor', 'pencil', 'Editor'], ['io', 'swap', 'Import / Export']].map(([id, ico, label]) =>
        el('button', { class: `tab-btn${_gamesTab === id ? ' active' : ''}`, 'data-view': id,
          onclick: () => { _gamesTab = id; renderView('games'); } }, scLbl(ico,label))))
  );
  if (_gamesTab === 'play') _renderGamesLibrary(c, store);
  else if (_gamesTab === 'editor') _renderGamesEditor(c, store);
  else _renderGamesIO(c, store);
}

function openGameHelp() {
  openModal('Game charts', body => {
    body.appendChild(el('div', { style: 'font-size:13px;line-height:1.6' },
      'Games are declarative charts: objects placed at (step, lane) — prompts, inputs, matchers, rules, portals and cosmetics. ',
      'Persistent objects apply from their step until overridden; portals/events fire once. ',
      'Author them here, with tests-and-tools/gamekit.py, or in any text editor; share as JSON or SCIMAGAME1-… strings. ',
      'Charts are remixable by default — forks keep the attribution chain.'));
  });
}

function _renderGamesLibrary(c, store) {
  const all = [
    ...SCIMA_BUILTIN_GAMES.map(g => ({ builtin: true, game: sanitizeGameSpec(g) })),
    ...Object.entries(store.installed).map(([id, env]) => ({ id, game: env.game })),
  ];
  const grid = el('div', { class: 'grid-2' });
  for (const entry of all) {
    const g = entry.game;
    const best = entry.id ? store.best[entry.id] : null;
    const card = el('div', { class: 'card', style: 'padding:16px' },
      el('div', { style: 'display:flex;justify-content:space-between;gap:8px;align-items:flex-start' },
        el('div', { style: 'font-weight:800;font-size:15px;display:flex;align-items:center;gap:7px' }, scIcon('joystick'), g.name),
        el('span', { class: 'tag', style: 'background:rgba(91,206,250,0.13)' }, `v${g.version}`)),
      el('div', { class: 'u-muted-11', style: 'margin:4px 0 10px' },
        attributionLine(g) || (entry.builtin ? 'built-in' : ''),
        best ? ` · best ${best.score}` : ''),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
        btn([scIcon('play'),' Play'], 'primary', { small: true, onclick: () => _startPlay(g, entry.id) }),
        btn('Edit', 'ghost', { small: true, 'aria-label': `Edit ${g.name}`, onclick: () => { _gamesSel = sanitizeGameSpec({ game: g }); if (entry.id) _gamesSel._originId = entry.id; _gamesTab = 'editor'; renderView('games'); } }),
        btn('Share', 'ghost', { small: true, onclick: () => { _gamesSel = g; _gamesIOMode = 'share'; _gamesTab = 'io'; renderView('games'); } }))
    );
    grid.appendChild(card);
  }
  c.appendChild(grid);
  if (_gamesPlaySess) _renderPlayPanel(c, store);
}

// ── play runner ──────────────────────────────────────────────────────────
function _startPlay(spec, id) {
  _gamesPlaySess = { spec: sanitizeGameSpec(spec), id: id || null, sess: null };
  _gamesPlaySess.sess = createGameSession(_gamesPlaySess.spec, { seed: 7 });
  renderView('games');
}

function _renderPlayPanel(c, store) {
  const wrap = el('div', { class: 'card', style: 'padding:20px;margin-top:20px' });
  const P = _gamesPlaySess; const sess = P.sess;
  if (_gamesTickHandle) { clearInterval(_gamesTickHandle); _gamesTickHandle = null; }
  if (sess.status === 'running' && sess.pace === 'time') {
    _gamesTickHandle = setInterval(() => {
      _gamesPlaySess.sess = feedGameSession(_gamesPlaySess.sess, { type: 'tick', ms: 500 });
      if (_gamesPlaySess.sess.status !== 'running') { clearInterval(_gamesTickHandle); _gamesTickHandle = null; _finishPlay(store); }
      _refreshPlayHud();
    }, 500);
  }
  const hud = el('div', { id: 'game-hud', style: 'display:flex;gap:16px;flex-wrap:wrap;font-weight:800;font-size:14px;margin-bottom:14px' });
  wrap.append(el('div', { style: 'font-weight:900;font-size:18px;margin-bottom:8px;display:flex;align-items:center;gap:8px' }, scIcon('joystick'), P.spec.name), hud);
  const stage = el('div', { id: 'game-stage', style: 'min-height:120px;margin-bottom:14px' });
  wrap.appendChild(stage);
  const controls = el('div', { id: 'game-controls', style: 'display:flex;gap:8px;flex-wrap:wrap' });
  wrap.appendChild(controls);
  c.appendChild(wrap);
  _refreshPlayHud();
  _renderPlayStage(store);
}

function _refreshPlayHud() {
  const hud = document.getElementById('game-hud'); if (!hud) return;
  const s = _gamesPlaySess.sess;
  hud.innerHTML = '';
  hud.append(...[
    el('span', { style: 'display:inline-flex;align-items:center;gap:4px' }, scIcon('star'), String(s.score)),
    el('span', { style: 'color:#FB923C;display:inline-flex;align-items:center;gap:4px' }, scIcon('heart'), String(Math.max(0, s.lives))),
    el('span', { style: 'color:var(--blue);display:inline-flex;align-items:center;gap:4px' }, scIcon('flame'), String(s.combo)),
    s.timeLeft !== null ? el('span', { style: 'display:inline-flex;align-items:center;gap:4px' }, scIcon('stopwatch'), `${Math.ceil(s.timeLeft)}s`) : null,
    el('span', { class: 'u-muted-11' }, `step ${s.step} · ✅${s.correct} ❌${s.misses}`),
    s.tokens.length ? el('span', {}, s.tokens.join('')) : null,
  ].filter(Boolean));
}

// ── Digit/char track renderer (the intuitive bit) ─────────────────────────
// Green = digits you've already typed correctly, blue cursor = the one
// you're on (hidden in recall mode), red wrong chars hang under the cell
// where you missed, and on game-over the next 25 digits fill in red so you
// can see exactly how far the run got. Cells are aria-hidden; the wrapper
// carries a descriptive aria-label for screen readers.
function _trackCellStyle(cls) {
  const base = 'display:inline-flex;flex-direction:column;align-items:center;padding:0 1.5px;border-radius:4px;';
  if (cls === 'done')   return base + 'color:#22c55e;font-weight:700';
  if (cls === 'reveal') return base + 'color:#ef4444;font-weight:700;background:rgba(239,68,68,0.10)';
  if (cls === 'cursor') return base + 'color:var(--text);box-shadow:0 0 0 2px var(--blue);background:rgba(91,206,250,0.10)';
  return base + 'color:rgba(169,185,201,0.30)';
}
function _renderGameTrack(sess, reveal) {
  const seq = sess.seq || [];
  const missAt = {};
  (sess.missLog || []).forEach(m => { (missAt[m.at] = missAt[m.at] || []).push(m.ch); });
  const revealTo = reveal ? Math.min(seq.length, sess.idx + 25) : 0;
  const total = Math.min(seq.length, Math.max(sess.idx + 1, revealTo, 30));
  const wrap = el('div', { id: 'game-track', role: 'img',
    'aria-label': `Digit track: ${sess.idx} correct, ${sess.misses} missed` +
      (reveal ? `. Next digits: ${seq.slice(sess.idx, revealTo).join('')}` : ''),
    style: 'display:flex;flex-wrap:wrap;justify-content:center;gap:1px 0;margin:6px 0 14px;' +
           'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:17px;line-height:1.55' });
  for (let i = 0; i < total; i++) {
    if (i > 0 && i % 5 === 0) wrap.appendChild(el('span', { style: 'width:12px' }, ' '));
    let cls, ch;
    if (i < sess.idx) { cls = 'done'; ch = seq[i]; }
    else if (reveal && i < revealTo) { cls = 'reveal'; ch = seq[i]; }
    else if (i === sess.idx && !reveal) { cls = 'cursor'; ch = '•'; }
    else { cls = 'hidden'; ch = '•'; }
    const misses = missAt[i] || [];
    const cell = el('span', { class: 'gt-' + cls, 'data-i': String(i), 'aria-hidden': 'true',
      style: _trackCellStyle(cls) },
      el('span', {}, ch),
      el('span', { class: 'gt-miss', style: 'font-size:9px;line-height:1;color:#ef4444;min-height:9px;font-weight:800' },
        misses.join('') || '\u00a0'));
    wrap.appendChild(cell);
  }
  if (seq.length > total) wrap.appendChild(el('span', { class: 'u-muted-11', style: 'align-self:center;margin-left:6px' }, `… +${seq.length - total}`));
  return wrap;
}

function _renderPlayStage(store) {
  const stage = document.getElementById('game-stage');
  const controls = document.getElementById('game-controls');
  if (!stage || !controls) return;
  stage.innerHTML = ''; controls.innerHTML = '';
  const s = _gamesPlaySess.sess;
  if (s.status === 'ended') { _finishPlay(store); return; }
  if (_gamesPlaySess.spec && _gamesPlaySess.sess.promptType === 'prompt.rounds') {
    stage.appendChild(el('div', { style: 'font-size:22px;font-weight:900;text-align:center;padding:18px' },
      setRichText(el('div', {}), String(s.expected ?? '—'))));
  } else {
    stage.appendChild(_renderGameTrack(s, false));
    stage.appendChild(el('div', { style: 'text-align:center;color:var(--muted);font-size:12px;margin-bottom:10px' },
      `Recall from digit #${s.idx + 1} — green is banked, the outlined cell is next`));
  }
  if (s.inputType === 'input.choice' && s.choiceOptions) {
    s.choiceOptions.forEach(opt => controls.appendChild(
      btn(String(opt).slice(0, 40), 'ghost', { onclick: () => _playFeed({ type: 'input', v: opt }, store) })));
  } else if (s.commit === 'perChar') {
    const box = el('input', { type: 'text', 'aria-label': 'Game input (one character per key)',
      style: 'padding:10px 14px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid var(--border);color:var(--text);font-size:18px;font-family:inherit;width:120px;text-align:center' });
    box.addEventListener('input', e => {
      const ch = e.target.value.slice(-1);
      e.target.value = '';
      if (ch) _playFeed({ type: 'input', v: ch }, store);
    });
    controls.appendChild(box);
    setTimeout(() => box.focus(), 0);
  } else {
    const box = el('input', { type: 'text', 'aria-label': 'Game input',
      style: 'padding:10px 14px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid var(--border);color:var(--text);font-size:16px;font-family:inherit;flex:1;min-width:180px' });
    box.addEventListener('keydown', e => { if (e.key === 'Enter') { _playFeed({ type: 'commit', buffer: box.value }, store); box.value = ''; } });
    controls.append(box, btn('Submit', 'primary', { onclick: () => { _playFeed({ type: 'commit', buffer: box.value }, store); box.value = ''; } }));
    setTimeout(() => box.focus(), 0);
  }
  controls.appendChild(btn([scIcon('arrow-left'),' Quit'], 'ghost', { small: true, onclick: () => { _playFeed({ type: 'abort' }, store); } }));
}

function _playFeed(event, store) {
  const before = _gamesPlaySess.sess;
  if (event.type === 'commit' && event.buffer !== undefined) { before.buffer = event.buffer; }
  _gamesPlaySess.sess = feedGameSession(before, event);
  _refreshPlayHud();
  if (_gamesPlaySess.sess.status !== 'running') _finishPlay(store);
  else _renderPlayStage(store);
}

function _finishPlay(store) {
  if (_gamesTickHandle) { clearInterval(_gamesTickHandle); _gamesTickHandle = null; }
  const s = _gamesPlaySess.sess;
  const id = _gamesPlaySess.id;
  if (id) {
    const prev = store.best[id];
    if (!prev || s.score > prev.score) {
      store.best[id] = { score: s.score, ts: Date.now(), endReason: s.endReason };
      saveGamesStore(store);
    }
  }
  const stage = document.getElementById('game-stage');
  const controls = document.getElementById('game-controls');
  if (stage) {
    stage.innerHTML = '';
    if ((s.seq || []).length) stage.appendChild(_renderGameTrack(s, true));
    stage.appendChild(el('div', { style: 'text-align:center;padding:10px' },
      el('div', { style: 'font-size:34px;font-weight:900;margin-bottom:6px' },
        scLbl(s.endReason === 'lives' ? 'burst' : s.endReason === 'timer' ? 'stopwatch' : s.endReason === 'abort' ? 'flag' : 'flag-checkered', s.endReason === 'lives' ? ' Out of lives' : s.endReason === 'timer' ? ' Time!' : s.endReason === 'abort' ? ' Quit' : ' Complete')),
      el('div', { style: 'font-size:16px;font-weight:800' }, `Score ${s.score} · ✅${s.correct} ❌${s.misses} · max combo ${s.maxCombo}`),
      s.tokens.length ? el('div', { style: 'font-size:20px;margin-top:6px' }, s.tokens.join(' ')) : null));
  }
  if (controls) {
    controls.innerHTML = '';
    controls.append(
      btn([scIcon('rotate-cw'),' Retry'], 'primary', { onclick: () => _startPlay(_gamesPlaySess.spec, _gamesPlaySess.id) }),
      btn([scIcon('arrow-left'),' Library'], 'ghost', { onclick: () => { _gamesPlaySess = null; renderView('games'); } }));
  }
}

// ── editor MVP: object list + schema-driven inspector (no canvas yet) ────
let _editorSelIdx = -1;
function _renderGamesEditor(c, store) {
  if (!_gamesSel) _gamesSel = sanitizeGameSpec(SCIMA_BUILTIN_GAMES[0]);
  const g = _gamesSel;
  const bar = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px' });
  const nameInput = el('input', { type: 'text', 'aria-label': 'Game name', value: g.name,
    style: 'padding:8px 12px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid var(--border);color:var(--text);font-family:inherit;font-weight:800' });
  nameInput.addEventListener('change', () => { g.name = nameInput.value.slice(0, 80) || 'Untitled game'; });
  const authorInput = el('input', { type: 'text', 'aria-label': 'Author name for attribution', placeholder: 'Author name (for attribution)', value: _gamesAuthor,
    style: 'padding:8px 12px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid var(--border);color:var(--text);font-family:inherit;width:180px' });
  authorInput.addEventListener('change', () => { _gamesAuthor = authorInput.value.slice(0, 80); });
  bar.append(nameInput, authorInput,
    btn('+ Object', 'primary', { small: true, onclick: () => { _editorSelIdx = g.objects.length; g.objects.push(sanitizeGameObject({ t: 'event.score', step: 0 })); renderView('games'); } }),
    btn([scIcon('play'),' Playtest'], 'ghost', { small: true, onclick: () => { _startPlay(g, null); _gamesTab = 'play'; renderView('games'); } }),
    btn([scIcon('save'),' Save'], 'primary', { small: true, onclick: async () => {
      const spec = sanitizeGameSpec({ game: g });
      const id = await gameIdOf(spec);
      const orig = g._originId || null;
      if (orig && orig !== id) {   // forked from something: extend attribution
        const origEnv = store.installed[orig] || SCIMA_BUILTIN_GAMES.find(b => sanitizeGameSpec(b).name === g.name);
        const origGame = origEnv ? (origEnv.game || sanitizeGameSpec(origEnv)) : null;
        spec.remixOf = { id: orig, name: (origGame && origGame.name) || g.name, author: ((origGame && origGame.attribution || [])[0] || {}).name || '' };
        spec.attribution = [...((origGame && origGame.attribution) || [])];
      }
      if (!spec.attribution.length) spec.attribution = [{ name: _gamesAuthor || 'anonymous', role: 'creator', hash: id }];
      else if (_gamesAuthor && orig) spec.attribution.push({ name: _gamesAuthor, role: 'remixer', hash: id });
      store.installed[id] = { game: spec };
      saveGamesStore(store);
      showToast(`Saved "${spec.name}" ✓`);
      _gamesTab = 'play'; renderView('games');
    } }),
    btn('JSON', 'ghost', { small: true, onclick: () => { _gamesIOMode = 'json'; _gamesTab = 'io'; renderView('games'); } }));
  c.append(bar, el('div', { class: 'u-muted-11', style: 'margin-bottom:12px' },
    g.remixOf ? `Remix of "${g.remixOf.name}" by ${g.remixOf.author || 'unknown'} · ` : '',
    attributionLine(g) || 'no attribution yet — saving stamps you as creator'));

  const list = el('div', { class: 'card', style: 'padding:10px;margin-bottom:14px;max-height:280px;overflow:auto' });
  g.objects.forEach((o, i) => {
    list.appendChild(el('div', { style: `display:flex;gap:8px;align-items:center;padding:6px 8px;border-radius:8px;cursor:pointer;${i === _editorSelIdx ? 'background:rgba(91,206,250,0.12);' : ''}`,
      role: 'button', tabindex: '0', 'aria-label': `Edit object ${i + 1}: ${o.t} at step ${o.step}`,
      onclick: () => { _editorSelIdx = i; renderView('games'); },
      onkeydown: clickKeys(() => { _editorSelIdx = i; renderView('games'); }) },
      el('span', { style: 'font-family:monospace;font-size:11px;color:var(--muted);width:70px' }, `s${o.step} ${o.lane.slice(0, 4)}`),
      el('span', { style: 'font-weight:800;font-size:12px;width:130px' }, o.t),
      el('span', { class: 'u-muted-11', style: 'flex:1;font-size:11px' },
        Object.entries(o.props).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('|') : v}`).join(' ')),
      el('span', { style: 'display:flex;gap:4px' },
        btn(scIcon('arrow-up'), 'ghost', { small: true, 'aria-label': `Move object ${i + 1} earlier`, onclick: e => { e.stopPropagation(); if (i > 0) { [g.objects[i - 1], g.objects[i]] = [g.objects[i], g.objects[i - 1]]; _editorSelIdx = i - 1; renderView('games'); } } }),
        btn(scIcon('arrow-down'), 'ghost', { small: true, 'aria-label': `Move object ${i + 1} later`, onclick: e => { e.stopPropagation(); if (i < g.objects.length - 1) { [g.objects[i + 1], g.objects[i]] = [g.objects[i], g.objects[i + 1]]; _editorSelIdx = i + 1; renderView('games'); } } }),
        btn('⧉', 'ghost', { small: true, 'aria-label': `Duplicate object ${i + 1}`, onclick: e => { e.stopPropagation(); g.objects.splice(i + 1, 0, structuredClone(o)); renderView('games'); } }),
        btn('×', 'danger', { small: true, 'aria-label': `Delete object ${i + 1}`, onclick: e => { e.stopPropagation(); g.objects.splice(i, 1); _editorSelIdx = -1; renderView('games'); } }))));
  });
  c.appendChild(list);

  // inspector: generated from the catalog schema
  const insp = el('div', { class: 'card', style: 'padding:16px' });
  insp.appendChild(el('div', { style: 'font-weight:800;margin-bottom:10px' }, 'Inspector'));
  const o = g.objects[_editorSelIdx];
  if (!o) insp.appendChild(el('div', { class: 'u-muted-11' }, 'Select an object (or add one) to edit its properties.'));
  else {
    const typeSel = el('select', { class: 'u-input', 'aria-label': 'Object type', style: 'margin-bottom:10px' });
    Object.keys(SCIMA_GAME_CATALOG).forEach(t => {
      const opt = el('option', { value: t }, `${t} — ${SCIMA_GAME_CATALOG[t].label}`);
      if (t === o.t) opt.selected = true;
      typeSel.appendChild(opt);
    });
    typeSel.addEventListener('change', () => {
      g.objects[_editorSelIdx] = sanitizeGameObject({ t: typeSel.value, step: o.step });
      renderView('games');
    });
    insp.appendChild(typeSel);
    const stepInput = el('input', { type: 'number', min: '0', max: '100000', 'aria-label': 'Step (grid column)', value: String(o.step), style: 'width:90px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-family:inherit;margin-bottom:10px' });
    stepInput.addEventListener('change', () => { o.step = Math.max(0, parseInt(stepInput.value, 10) || 0); g.objects.sort((a, b) => a.step - b.step); renderView('games'); });
    insp.appendChild(el('div', { style: 'display:flex;gap:10px;align-items:center;margin-bottom:10px' },
      el('label', { style: 'font-size:12px;font-weight:700' }, 'Step'), stepInput,
      el('span', { class: 'u-muted-11' }, `lane: ${o.lane} (from catalog)`)));
    for (const [k, ps] of Object.entries(SCIMA_GAME_CATALOG[o.t].props)) {
      const row = el('div', { style: 'display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap' });
      row.appendChild(el('label', { style: 'font-size:12px;font-weight:700;width:110px' }, ps.label || k));
      let input;
      if (ps.type === 'enum') {
        input = el('select', { class: 'u-input', 'aria-label': ps.label || k, style: 'width:auto' });
        ps.enum.forEach(v => { const opt = el('option', { value: v }, v); if (o.props[k] === v) opt.selected = true; input.appendChild(opt); });
        input.addEventListener('change', () => { o.props[k] = input.value; renderView('games'); });
      } else if (ps.type === 'list') {
        input = el('input', { type: 'text', 'aria-label': ps.label || k, value: (o.props[k] || []).join(','), style: 'padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-family:inherit' });
        input.addEventListener('change', () => { o.props[k] = input.value.split(',').map(x => x.trim()).filter(x => ps.enum.includes(x)); renderView('games'); });
      } else if (ps.type === 'int') {
        input = el('input', { type: 'number', min: String(ps.min), max: String(ps.max), 'aria-label': ps.label || k, value: String(o.props[k]), style: 'width:90px;padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-family:inherit' });
        input.addEventListener('change', () => { o.props[k] = sanitizeGameObject({ t: o.t, step: o.step, props: { ...o.props, [k]: parseInt(input.value, 10) } }).props[k]; renderView('games'); });
      } else {
        input = el('input', { type: 'text', 'aria-label': ps.label || k, value: String(o.props[k]), style: 'padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-family:inherit;flex:1;min-width:160px' });
        input.addEventListener('change', () => { o.props[k] = input.value; renderView('games'); });
      }
      row.appendChild(input);
      insp.appendChild(row);
    }
  }
  c.appendChild(insp);
}

// ── import / export / share ──────────────────────────────────────────────
function _renderGamesIO(c, store) {
  const out = el('textarea', { 'aria-label': 'Game JSON or share string', rows: 10,
    style: 'width:100%;padding:12px;border-radius:10px;border:1px solid var(--border);background:rgba(255,255,255,0.04);color:var(--text);font-family:monospace;font-size:12px' });
  if (_gamesSel) out.value = (_gamesIOMode === 'json')
    ? JSON.stringify({ $schema: 'scima', schema: 'share', schemaVersion: 1, kind: 'game', game: sanitizeGameSpec(_gamesSel) }, null, 2)
    : gameShareString(_gamesSel);
  const status = el('div', { class: 'u-muted-11', style: 'margin:8px 0;min-height:18px' });
  c.append(
    el('div', { style: 'font-weight:800;margin-bottom:8px' }, 'Share / import'),
    el('div', { class: 'u-muted-11', style: 'margin-bottom:8px;font-size:12px' },
      'Box holds a SCIMAGAME1-… share string (skeletal, deflated) or full envelope JSON. Paste either to import.'),
    out, status,
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
      btn([scIcon('download'),' Import from box'], 'primary', { small: true, onclick: async () => {
        const raw = out.value.trim();
        let spec = null;
        if (raw.startsWith('{')) {
          try { spec = sanitizeGameSpec(JSON.parse(raw).game ? JSON.parse(raw) : { game: JSON.parse(raw) }); }
          catch (e) { status.textContent = '❌ ' + e.message; return; }
        } else {
          try { spec = gameParseShareString(raw); }
          catch (e) { status.textContent = '❌ ' + ((e && e.message) || 'unparseable share string'); return; }
        }
        if (!spec || !spec.objects.length) { status.textContent = '❌ Unrecognized game payload'; return; }
        const id = await gameIdOf(spec);
        store.installed[id] = { game: spec };
        saveGamesStore(store);
        _gamesSel = spec;
        status.textContent = `✓ Installed "${spec.name}" (${id.slice(0, 12)}…) — ${spec.objects.length} objects`;
      } }),
      btn([scIcon('upload'),' Export selected as JSON'], 'ghost', { small: true, onclick: () => {
        if (!_gamesSel) { status.textContent = 'Pick a game first (Edit or Play tab).'; return; }
        out.value = JSON.stringify({ $schema: 'scima', schema: 'share', schemaVersion: 1, kind: 'game', game: sanitizeGameSpec(_gamesSel) }, null, 2);
      } }),
      btn([scIcon('link'),' Share string of selected'], 'ghost', { small: true, onclick: () => {
        if (!_gamesSel) { status.textContent = 'Pick a game first.'; return; }
        out.value = gameShareString(_gamesSel);
      } }),
      btn('⑂ Fork selected into editor', 'ghost', { small: true, onclick: async () => {
        if (!_gamesSel) { status.textContent = 'Pick a game first.'; return; }
        const clone = structuredClone(sanitizeGameSpec(_gamesSel));
        clone._originId = await gameIdOf(clone);
        _gamesSel = clone; _gamesTab = 'editor'; renderView('games');
      } })));
}
