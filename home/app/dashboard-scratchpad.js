'use strict';
/* dashboard-scratchpad.js — the Infinite Scratchpad: a per-question drawing
   surface (spec: "infinite scratchpad") available from every study session
   via the circular ✍️ button in the session progress row (top-right, left of
   💡 Show Hint). Infinite pan, finite zoom (10%–1000%, 1% steps), 360°
   rotatable grid, pen/highlighter/shapes/polygon/text/image tools, object
   eraser, undo/redo, PNG/SVG/JSON/clipboard export, and per-question
   autosave.

   LOAD ORDER: after dashboard-study.js (it hooks the session lifecycle —
   spSessionStart/spOnCardRender/spCardDone/spSessionEnd — and reads
   studySession), before dashboard-analytics.js. Also loaded on the Settings
   page (before dashboard-settings.js) so the Scratchpad defaults card can
   read/write SP_DEFAULTS + spSetting()/spSetSetting(). Requires only
   dashboard-core.js helpers (el/btn/showToast/openModal/closeModal/
   openColorPicker) and shared.js (setRichText/formatCardFront) at *call*
   time — at load time this file only defines functions and registers window
   listeners, so it is inert until the user opens the scratchpad.

   PERSISTENCE SCOPE (spec §31 — deliberately offline/ephemeral): a
   scratchpad lives in sessionStorage under `scima_scratch_<cardId>` ONLY
   while its question is being answered. It is deleted the moment the card is
   rated/advanced past (spCardDone) and every key is wiped on session start
   and session end/exit (spSessionStart/spSessionEnd). It never reaches
   localStorage, the mf_state snapshot, or the backend.

   DOCUMENTED SIMPLIFICATIONS vs the spec (kept honest in code comments
   where they bite): object eraser only (no stroke/background eraser), no
   ruler/protractor/shape-recognizer/formula UI/screenshot tool/layer
   panel/history panel/align-distribute/smart guides/minimize-PiP, no
   curved arrows or regular-polygon mode, no PDF export; two-finger twist
   rotates the grid; exports include the question as plain text + images
   (no KaTeX font embedding inside PNG/SVG). */

// ── Constants ──────────────────────────────────────────────────────────────
const SP_ZOOM_MIN = 0.1;            // 10%  (spec §8: finite stops 10%–1000%)
const SP_ZOOM_MAX = 10;             // 1000%
const SP_STORE_PREFIX = 'scima_scratch_';   // sessionStorage key prefix (§31)
const SP_STATE_VERSION = 1;         // bump when the serialized shape changes
const SP_Q_WIDTH = 480;             // world px — question layer default width
const SP_Q_ID = '__q__';            // pseudo-object id for the question group

// Background styles (spec §9). 'dotmatrix' kept one word for the <select>.
const SP_BG_STYLES = [
  { id: 'blank',     label: 'Blank' },
  { id: 'grid',      label: 'Grid' },
  { id: 'dotted',    label: 'Dotted grid' },
  { id: 'lined',     label: 'Lined paper' },
  { id: 'squared',   label: 'Squared paper' },
  { id: 'iso',       label: 'Isometric' },
  { id: 'dotmatrix', label: 'Dot matrix' },
  { id: 'graph',     label: 'Graph paper' },
];

// Tools (spec §10 core list; §26 single-key shortcuts). 'triangle' has no
// single-key binding in the spec map, so it gets none (click only).
const SP_TOOLS = [
  { id: 'select',    icon: '➤', key: 'v', label: 'Select' },
  { id: 'pan',       icon: '✋', key: 'h', label: 'Pan' },
  { id: 'text',      icon: 'T',  key: 't', label: 'Text' },
  { id: 'pen',       icon: '✏️', key: 'p', label: 'Pen' },
  { id: 'highlight', icon: '🖍️', key: 'm', label: 'Highlighter' },
  { id: 'eraser',    icon: '⌫',  key: 'e', label: 'Eraser' },
  { id: 'sep' },
  { id: 'line',      icon: '╱',  key: 'l', label: 'Line' },
  { id: 'arrow',     icon: '↗',  key: 'a', label: 'Arrow' },
  { id: 'rect',      icon: '▭',  key: 'r', label: 'Rectangle' },
  { id: 'ellipse',   icon: '◯',  key: 'o', label: 'Ellipse' },
  { id: 'triangle',  icon: '△',  key: '',  label: 'Triangle' },
  { id: 'polygon',   icon: '⬠',  key: 'u', label: 'Polygon' },
  { id: 'image',     icon: '🖼️', key: 'i', label: 'Insert image' },
];

// Quick palette (spec §21 — black/gray/white/red/orange/yellow/green/blue/
// purple/pink). Ordered light-first because the canvas backdrop is dark.
const SP_SWATCHES = ['#ffffff', '#9aa7b4', '#0b0f14', '#ef4444', '#fb923c',
  '#facc15', '#22c55e', '#5bcefa', '#a78bfa', '#f5a9b8'];
const SP_WIDTHS = [1.5, 3, 5, 9];   // thin/medium/thick/extra-thick presets

// Settings-page defaults (spec §32). Merged over state.settings.scratch —
// the nested object may be absent on old saved states.
const SP_DEFAULTS = {
  color: '#5bcefa', width: 3, bg: 'grid', gridVisible: true, snap: false,
  smoothing: 2, undoSteps: 100, autosave: true, confirmClear: true,
  fullscreen: false, eraserSize: 14, gridSpacing: 24, gridOpacity: 0.55,
};

// ── Pure helpers (no DOM) — unit-tested by harness S28 ────────────────────

/** Clamp a zoom factor into [10%, 1000%] and quantize to 1% steps (§8). */
function spClampZoom(z) {
  const n = Number(z);
  if (!isFinite(n)) return 1;
  return Math.round(Math.min(SP_ZOOM_MAX, Math.max(SP_ZOOM_MIN, n)) * 100) / 100;
}

/**
 * Zoom a viewport so the world point under screen point (sx, sy) stays put
 * (spec §8: "zoom centers on cursor / pinch point"). Returns a NEW view
 * object {x, y, zoom} — never mutates the input.
 */
function spZoomAt(view, zoom2, sx, sy) {
  const z1 = view.zoom || 1;
  const z2 = spClampZoom(zoom2);
  const wx = (sx - view.x) / z1, wy = (sy - view.y) / z1;
  return { x: sx - wx * z2, y: sy - wy * z2, zoom: z2 };
}

/**
 * Snap a world point onto the (optionally rotated) grid (§9: "snapping
 * respects the rotated grid"). Rotates into grid-local space, rounds to the
 * spacing, rotates back.
 */
function spSnapPoint(pt, angleDeg, spacing) {
  const s = Number(spacing);
  if (!isFinite(s) || s <= 0) return { x: pt.x, y: pt.y };
  const a = (Number(angleDeg) || 0) * Math.PI / 180;
  const ca = Math.cos(a), sa = Math.sin(a);
  // world → grid-local (rotate by -a)
  const lx = pt.x * ca + pt.y * sa;
  const ly = -pt.x * sa + pt.y * ca;
  const gx = Math.round(lx / s) * s;
  const gy = Math.round(ly / s) * s;
  // grid-local → world (rotate by +a)
  return { x: gx * ca - gy * sa, y: gx * sa + gy * ca };
}

/** Normalize an angle into [0, 360). */
function spNormAngle(a) {
  let d = (Number(a) || 0) % 360;
  if (d < 0) d += 360;
  return Math.round(d * 100) / 100;
}

function spNormBox(x, y, w, h) {
  return { x: w < 0 ? x + w : x, y: h < 0 ? y + h : y, w: Math.abs(w), h: Math.abs(h) };
}

/** Axis-aligned world bbox of one object (rotation applied at draw/hit time). */
function spBBoxOf(o) {
  if (!o) return { x: 0, y: 0, w: 0, h: 0 };
  switch (o.type) {
    case 'stroke': case 'polygon': {
      const pts = o.pts || [];
      if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of pts) { if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y; if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y; }
      const pad = (o.width || 2) / 2;
      return { x: x0 - pad, y: y0 - pad, w: (x1 - x0) + pad * 2, h: (y1 - y0) + pad * 2 };
    }
    case 'line': case 'arrow': {
      const pad = (o.width || 2) / 2 + (o.type === 'arrow' ? Math.max(8, (o.width || 2) * 2.6) : 0);
      const x0 = Math.min(o.x1, o.x2), x1 = Math.max(o.x1, o.x2);
      const y0 = Math.min(o.y1, o.y2), y1 = Math.max(o.y1, o.y2);
      return { x: x0 - pad, y: y0 - pad, w: (x1 - x0) + pad * 2, h: (y1 - y0) + pad * 2 };
    }
    case 'text':
      return { x: o.x, y: o.y, w: o.w, h: o._h || (o.fontSize || 20) * 1.4 };
    default: // rect / ellipse / triangle / image / qgroup
      return spNormBox(o.x, o.y, o.w, o.h);
  }
}

/** Union bbox of a list of objects (null when empty). */
function spObjectsBBox(objs) {
  let out = null;
  for (const o of (objs || [])) {
    if (o && o.hidden) continue;
    const b = spBBoxOf(o);
    if (!out) out = { x: b.x, y: b.y, w: b.w, h: b.h };
    else {
      const x1 = Math.max(out.x + out.w, b.x + b.w), y1 = Math.max(out.y + out.h, b.y + b.h);
      out.x = Math.min(out.x, b.x); out.y = Math.min(out.y, b.y);
      out.w = x1 - out.x; out.h = y1 - out.y;
    }
  }
  return out;
}

/**
 * View {x, y, zoom} that fits `bbox` inside a vw×vh viewport with `pad` px of
 * breathing room, centered (§6: "fit the question content comfortably inside
 * the viewport … enough padding"). Optional maxZoom cap (initial question
 * fit uses 1 so short questions aren't blown up past 100%).
 */
function spFitZoom(bbox, vw, vh, pad, maxZoom) {
  if (!bbox || !(vw > 0) || !(vh > 0)) return { x: 0, y: 0, zoom: 1 };
  const p = pad == null ? 40 : pad;
  const zx = (vw - p * 2) / Math.max(1e-6, bbox.w);
  const zy = (vh - p * 2) / Math.max(1e-6, bbox.h);
  let zoom = spClampZoom(Math.min(zx, zy));
  if (maxZoom != null) zoom = spClampZoom(Math.min(zoom, maxZoom));
  return {
    x: vw / 2 - (bbox.x + bbox.w / 2) * zoom,
    y: vh / 2 - (bbox.y + bbox.h / 2) * zoom,
    zoom,
  };
}

/**
 * Snapshot-based undo/redo stack with a bounded depth (§19: ≥100 steps,
 * editable default in Settings). push() records the state BEFORE a mutation
 * and clears the redo branch; undo(current)/redo(current) take the state the
 * caller is leaving so the opposite stack can restore it.
 */
function spMakeHistory(cap) {
  let capacity = Math.max(1, Math.round(Number(cap) || 100));
  const undoStack = [], redoStack = [];
  return {
    get cap() { return capacity; },
    setCap(n) { capacity = Math.max(1, Math.round(Number(n) || 100)); while (undoStack.length > capacity) undoStack.shift(); },
    push(snapshot) { undoStack.push(snapshot); if (undoStack.length > capacity) undoStack.shift(); redoStack.length = 0; },
    undo(current) { if (!undoStack.length) return null; redoStack.push(current); return undoStack.pop(); },
    redo(current) { if (!redoStack.length) return null; undoStack.push(current); return redoStack.pop(); },
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    get depth() { return undoStack.length; },
    clear() { undoStack.length = 0; redoStack.length = 0; },
  };
}

/**
 * Greedy word-wrap with explicit \n support and long-word char splitting.
 * `measure(str)` returns a pixel width (canvas measureText in practice; a
 * length heuristic when absent so it stays unit-testable).
 */
function spWrapText(text, maxW, measure) {
  const meas = typeof measure === 'function' ? measure : (s => String(s).length * 8);
  const lines = [];
  for (const para of String(text == null ? '' : text).split('\n')) {
    if (!para.length) { lines.push(''); continue; }
    let cur = '';
    for (const word of para.split(' ')) {
      if (!word.length) continue;
      if (!cur && meas(word) > maxW) {           // single word wider than the box
        let piece = '';
        for (const ch of word) {
          if (piece && meas(piece + ch) > maxW) { lines.push(piece); piece = ch; }
          else piece += ch;
        }
        cur = piece;
      } else if (!cur || meas(cur + ' ' + word) <= maxW) {
        cur = cur ? cur + ' ' + word : word;
      } else { lines.push(cur); cur = word; }
    }
    if (cur) lines.push(cur);
  }
  return lines;
}

/** Serialize a scratchpad state object to its stored/exported JSON form (§24:
 *  JSON = "full editable state"). */
function spSerialize(st) {
  return JSON.stringify({
    v: SP_STATE_VERSION,
    objects: st.objects || [],
    view: st.view || { x: 0, y: 0, zoom: 1 },
    grid: st.grid || {},
    q: st.q || null,
    style: st.style || {},
    tool: st.tool || 'pen',
    ts: st.ts || Date.now(),
  });
}

/** Inverse of spSerialize — null on anything malformed/hostile (§30-ish:
 *  a corrupt autosave must never wedge the session). */
function spParse(str) {
  if (!str) return null;
  try {
    const o = JSON.parse(str);
    if (!o || o.v !== SP_STATE_VERSION || !Array.isArray(o.objects)) return null;
    if (o.view && !(typeof o.view.x === 'number' && typeof o.view.zoom === 'number')) return null;
    return o;
  } catch (e) { return null; }
}

// Small math/geometry kit used by draw + hit-test code.
function spDist2Seg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}
function spInBox(p, b, tol) {
  const t = tol || 0;
  return p.x >= b.x - t && p.x <= b.x + b.w + t && p.y >= b.y - t && p.y <= b.y + b.h + t;
}
function spInPoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function spRotAround(p, c, rad) {
  const dx = p.x - c.x, dy = p.y - c.y, co = Math.cos(rad), si = Math.sin(rad);
  return { x: c.x + dx * co - dy * si, y: c.y + dx * si + dy * co };
}
function spClone(v) { return JSON.parse(JSON.stringify(v)); }
let _spIdSeq = 1;
function spUid() { return 'o' + (Date.now().toString(36)) + (_spIdSeq++).toString(36); }

// ── Mutable module state ───────────────────────────────────────────────────
// EVERYTHING DOM-ish hangs off _sp and is only touched after spBuildPanel()
// has run — the harness loads this file with stub DOM, so load-time must stay
// inert and null-guards must test _sp fields (stub getElementById auto-creates
// elements and never returns null).
const _sp = {
  // lifecycle / binding
  panel: null, built: false, open: false,
  card: null, boundCardId: null, qBuiltFor: null, pendingRestore: null,
  // document model
  objects: [],                       // array order = z-order (§7 object model)
  view: { x: 0, y: 0, zoom: 1 },     // world→screen: s = w*zoom + view.{x,y}
  grid: { angle: 0, spacing: 24, visible: true, style: 'grid', snap: false, opacity: 0.55 },
  q: { x: 0, y: 0, w: SP_Q_WIDTH, h: 0, unlocked: false, present: false },
  style: { color: SP_DEFAULTS.color, width: SP_DEFAULTS.width, fill: null, fontSize: 20, opacity: 1, eraserSize: SP_DEFAULTS.eraserSize },
  tool: 'pen',
  sel: new Set(),
  clipboard: [],
  hist: null,
  // interaction
  draft: null, draftHover: null, editing: null, marquee: null,
  action: null, pointers: new Map(), gesture: null,
  spaceDown: false, hoverScreen: null, longPressTimer: null,
  // render / autosave plumbing
  raf: null, saveTimer: null, dirty: false, fullscreen: false,
  imgCache: Object.create(null),
  // element refs (set by spBuildPanel)
  gridCanvas: null, objCanvas: null, gridCtx: null, objCtx: null,
  qLayer: null, canvasWrap: null, textarea: null, fileInput: null,
  zoomSlider: null, zoomLabel: null, undoBtn: null, redoBtn: null,
  gridToggleBtn: null, fullBtn: null, popover: null, ctxMenu: null,
  toolBtns: [], vw: 0, vh: 0,
};

// ── Settings bridge (Settings page card + in-panel popover share these) ───
function spSettings() {
  const s = (typeof state !== 'undefined' && state && state.settings) ? state.settings : {};
  return Object.assign({}, SP_DEFAULTS, s.scratch || {});
}
function spSetting(key) { return spSettings()[key]; }
function spSetSetting(key, val) {
  if (typeof state === 'undefined' || !state || !state.settings) return;
  state.settings.scratch = Object.assign({}, SP_DEFAULTS, state.settings.scratch || {}, { [key]: val });
  if (typeof scheduleSave === 'function') scheduleSave();
  spApplySettingLive(key, val);
}
/** Live-apply a defaults change to an already-open scratchpad where it makes
 *  sense (grid look, snap, history depth); pen defaults apply to the NEXT
 *  stroke via spStyleSeedFromSettings() at panel build; style changes hit the
 *  selection first (spStylePatch) and the pad defaults second. */
function spApplySettingLive(key, val) {
  if (!_sp.built) return;
  if (key === 'gridVisible') { _sp.grid.visible = !!val; }
  if (key === 'snap') { _sp.grid.snap = !!val; }
  if (key === 'bg') { _sp.grid.style = SP_BG_STYLES.some(s => s.id === val) ? val : 'grid'; }
  if (key === 'undoSteps' && _sp.hist) { _sp.hist.setCap(val); }
  if (key === 'gridSpacing') { _sp.grid.spacing = Math.max(8, Math.min(96, Number(val) || 24)); }
  if (key === 'gridOpacity') { _sp.grid.opacity = Math.max(0.1, Math.min(1, Number(val) || 0.55)); }
  spInvalidate();
}

// Coordinate transforms (world ⇄ canvas-local screen px).
function spW2S(p) { return { x: p.x * _sp.view.zoom + _sp.view.x, y: p.y * _sp.view.zoom + _sp.view.y }; }
function spS2W(p) { return { x: (p.x - _sp.view.x) / _sp.view.zoom, y: (p.y - _sp.view.y) / _sp.view.zoom }; }

/** The world rect currently visible, expanded by `pad` world px (culling). */
function spWorldViewport(pad) {
  const p = pad || 0;
  const a = spS2W({ x: -p, y: -p });
  const b = spS2W({ x: (_sp.vw || 0) + p, y: (_sp.vh || 0) + p });
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}
function spIntersects(a, b) {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

// ── Panel construction (lazy — first spToggle only) ───────────────────────

function spBuildPanel() {
  if (_sp.built) return;
  _sp.accent = '#5BCEFA';
  _sp.paper = '#0B0F14';
  _sp.inkText = '#FFFFFF';
  _sp.gridInk = '255,255,255';
  try {
    const cs = getComputedStyle(document.documentElement);
    const v = cs.getPropertyValue('--blue');
    if (v && v.trim()) _sp.accent = v.trim();
    const bg = cs.getPropertyValue('--bg');
    if (bg && bg.trim()) _sp.paper = bg.trim();
    const tx = cs.getPropertyValue('--text');
    if (tx && tx.trim()) _sp.inkText = tx.trim();
    const tr = cs.getPropertyValue('--text-rgb');
    if (tr && tr.trim()) _sp.gridInk = tr.trim();
  } catch (e) { /* keep fallbacks */ }

  // Header ─────────────────────────────────────────────────────────────────
  _sp.fullBtn = el('button', {
    type: 'button', class: 'sp-icon-btn', 'aria-label': 'Toggle fullscreen scratchpad',
    title: 'Fullscreen (Esc exits)', onclick: () => spSetFullscreen(!_sp.fullscreen),
  }, '⛶');
  const closeBtn = el('button', {
    type: 'button', class: 'sp-icon-btn', 'aria-label': 'Close scratchpad',
    title: 'Close scratchpad (Esc)', onclick: () => spToggle(_sp.card),
  }, '×');
  const head = el('div', { class: 'sp-head' },
    el('div', { class: 'sp-title' }, '✍️ Scratchpad'),
    el('div', { class: 'spacer' }),
    _sp.fullBtn, closeBtn);

  // Toolbar ────────────────────────────────────────────────────────────────
  const toolbar = el('div', { class: 'sp-toolbar', role: 'toolbar', 'aria-label': 'Scratchpad tools', 'aria-orientation': 'vertical' });
  _sp.toolBtns = [];
  for (const t of SP_TOOLS) {
    if (t.id === 'sep') { toolbar.appendChild(el('div', { class: 'sp-tool-sep' })); continue; }
    const b = el('button', {
      type: 'button', class: 'sp-tool', 'data-tool': t.id,
      'aria-label': `${t.label}${t.key ? ` (${t.key.toUpperCase()})` : ''}`, 'aria-pressed': 'false',
      title: `${t.label}${t.key ? ` — ${t.key.toUpperCase()}` : ''}`,
      onclick: () => spSetTool(t.id),
    }, t.icon);
    _sp.toolBtns.push(b);
    toolbar.appendChild(b);
  }
  toolbar.appendChild(el('div', { class: 'sp-tool-sep' }));
  _sp.colorBtn = el('button', {
    type: 'button', class: 'sp-tool sp-color-btn', 'aria-label': 'Drawing color', title: 'Drawing color',
    onclick: e => spPickColor(e.currentTarget, c => { spStylePatch({ color: c }); }),
  });
  toolbar.appendChild(_sp.colorBtn);
  _sp.widthBtn = el('button', {
    type: 'button', class: 'sp-tool', 'aria-label': 'Stroke width & style options', title: 'Stroke width & more options',
    onclick: () => spShowMorePopover(),
  }, '〰');
  toolbar.appendChild(_sp.widthBtn);

  // Canvas stack: grid (z1) → question DOM layer (z2) → objects (z3) ──────
  _sp.gridCanvas = el('canvas', { id: 'sp-grid-canvas', class: 'sp-canvas', 'aria-hidden': 'true' });
  _sp.objCanvas = el('canvas', {
    id: 'sp-obj-canvas', class: 'sp-canvas', tabindex: '0', role: 'group',
    'aria-label': 'Scratchpad drawing canvas — freehand, shapes, text and images for the current question',
  });
  _sp.qLayer = el('div', { class: 'sp-q-layer', 'aria-hidden': 'true' });
  _sp.textarea = el('textarea', {
    class: 'sp-text-editor', 'aria-label': 'Scratchpad text editor', spellcheck: 'false',
  });
  _sp.textarea.addEventListener('input', () => {
    const o = _sp.editing && _sp.objects.find(x => x.id === _sp.editing.id);
    if (o) { o.text = _sp.textarea.value; spAutosizeEditor(); }
    spInvalidate();
  });
  _sp.textarea.addEventListener('blur', () => spCommitText());
  _sp.textarea.addEventListener('keydown', e => {
    e.stopPropagation();                       // tool shortcuts must not fire while typing
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); spCommitText(); _sp.objCanvas.focus(); }
  });
  _sp.badge = el('div', { class: 'sp-badge-restored', style: 'display:none' }, '✍️ scratchpad restored');
  _sp.popover = el('div', { class: 'sp-popover', role: 'dialog', 'aria-label': 'Scratchpad options' });

  _sp.canvasWrap = el('div', { class: 'sp-canvas-wrap' },
    _sp.gridCanvas, _sp.qLayer, _sp.objCanvas, _sp.textarea, _sp.badge, _sp.popover,
    el('p', { class: 'sp-sr-only' }, 'Drawing scratchpad for the current question. Use the tool buttons to draw, type or insert images; changes autosave until you answer the question.'));

  // Bottom bar ─────────────────────────────────────────────────────────────
  const ico = (label, title, fn, cls) => el('button', {
    type: 'button', class: 'sp-icon-btn' + (cls ? ' ' + cls : ''), 'aria-label': label, title, onclick: fn,
  }, label.includes(' ') ? '' : label);
  _sp.undoBtn = el('button', { type: 'button', class: 'sp-icon-btn', 'aria-label': 'Undo (Ctrl+Z)', title: 'Undo — Ctrl+Z', onclick: () => spUndo() }, '↺');
  _sp.redoBtn = el('button', { type: 'button', class: 'sp-icon-btn', 'aria-label': 'Redo (Ctrl+Shift+Z)', title: 'Redo — Ctrl+Shift+Z', onclick: () => spRedo() }, '↻');
  _sp.zoomSlider = el('input', {
    type: 'range', class: 'sp-zoom-slider', min: '0', max: '1000', step: '1', value: '500',
    'aria-label': 'Zoom (10% to 1000%)',
    oninput: e => { spSetZoom(spZoomFromSlider(Number(e.target.value)), null); },
  });
  _sp.zoomLabel = el('button', {
    type: 'button', class: 'sp-zoom-label', 'aria-label': 'Zoom level — open zoom presets', title: 'Zoom presets',
    onclick: e => { if (_sp.popover.classList.contains('sp-open') && _sp.popKind === 'zoom') spClosePopovers(); else spShowZoomPresets(e.currentTarget); },
  }, '100%');
  _sp.gridToggleBtn = el('button', {
    type: 'button', class: 'sp-icon-btn', 'aria-label': 'Toggle grid background', title: 'Toggle grid', 'aria-pressed': 'true',
    onclick: () => { _sp.grid.visible = !_sp.grid.visible; spUpdateChrome(); spInvalidate(); spTouch(); },
  }, '▦');
  const bottom = el('div', { class: 'sp-bottom' },
    _sp.undoBtn, _sp.redoBtn,
    el('div', { class: 'sp-sep-v' }),
    el('button', { type: 'button', class: 'sp-icon-btn', 'aria-label': 'Zoom out', title: 'Zoom out — Ctrl+Alt+−', onclick: () => spZoomStep(1 / 1.25) }, '−'),
    _sp.zoomSlider,
    _sp.zoomLabel,
    el('button', { type: 'button', class: 'sp-icon-btn', 'aria-label': 'Zoom in', title: 'Zoom in — Ctrl+Alt++', onclick: () => spZoomStep(1.25) }, '+'),
    el('div', { class: 'sp-sep-v' }),
    el('button', { type: 'button', class: 'sp-icon-btn', 'aria-label': 'Return to center', title: 'Return to center — question, or selection', onclick: () => spCenterView() }, '⌖'),
    el('button', { type: 'button', class: 'sp-icon-btn', 'aria-label': 'Fit all content', title: 'Fit content', onclick: () => spFitAll() }, '⤢'),
    _sp.gridToggleBtn,
    el('div', { class: 'sp-sep-v' }),
    el('button', { type: 'button', class: 'sp-icon-btn', 'aria-label': 'More scratchpad options', title: 'More — style, grid rotation, export, clear, help', onclick: e => { if (_sp.popover.classList.contains('sp-open')) spClosePopovers(); else spShowMorePopover(); } }, '⋯'));

  _sp.panel = el('section', {
    id: 'scratch-panel', role: 'region', 'aria-label': 'Infinite scratchpad', 'aria-hidden': 'true',
  }, head, el('div', { class: 'sp-body' }, toolbar, _sp.canvasWrap), bottom);

  _sp.fileInput = el('input', { type: 'file', id: 'sp-file-input', accept: 'image/*', style: 'display:none', 'aria-hidden': 'true' });
  _sp.fileInput.addEventListener('change', () => {
    const f = _sp.fileInput.files && _sp.fileInput.files[0];
    if (f) spInsertImageFile(f);
    _sp.fileInput.value = '';
  });
  _sp.ctxMenu = el('div', { class: 'sp-ctx-menu', role: 'menu', 'aria-label': 'Object actions' });

  document.body.append(_sp.panel, _sp.fileInput, _sp.ctxMenu);
  _sp.gridCtx = _sp.gridCanvas.getContext('2d');
  _sp.objCtx = _sp.objCanvas.getContext('2d');

  // Canvas pointer/wheel/context events (object canvas is the top layer).
  const cv = _sp.objCanvas;
  cv.addEventListener('pointerdown', spOnPointerDown);
  cv.addEventListener('pointermove', spOnPointerMove);
  cv.addEventListener('pointerup', spOnPointerUp);
  cv.addEventListener('pointercancel', spOnPointerUp);
  cv.addEventListener('pointerleave', () => { _sp.hoverScreen = null; spInvalidate(); });
  cv.addEventListener('dblclick', spOnDblClick);
  _sp.canvasWrap.addEventListener('wheel', spOnWheel, { passive: false });
  _sp.canvasWrap.addEventListener('contextmenu', spOnContextMenu);
  // Outside-click dismissal for popover + context menu.
  document.addEventListener('pointerdown', e => {
    if (!_sp.open) return;
    const t = e.target;
    if (_sp.popover.classList.contains('sp-open') && !_sp.popover.contains(t) && !(t.closest && (t.closest('.sp-icon-btn[aria-label="More scratchpad options"]') || t.closest('.sp-zoom-label')))) spClosePopovers();
    if (_sp.ctxMenu.style.display === 'block' && !_sp.ctxMenu.contains(t)) spCloseCtxMenu();
  }, true);

  if (window.ResizeObserver) {
    try { new ResizeObserver(() => { spResizeCanvases(); spInvalidate(); }).observe(_sp.canvasWrap); } catch (e) {}
  }
  window.addEventListener('resize', () => { if (_sp.open) { spResizeCanvases(); spInvalidate(); } });

  _sp.built = true;
  _sp.hist = _sp.hist || spMakeHistory(spSettings().undoSteps);
  spStyleSeedFromSettings();
}

// ── Question layer (spec §6) ───────────────────────────────────────────────
// The question renders as real DOM (KaTeX-crisp text, <img> graphics) on its
// own layer *under* the objects canvas and *over* the grid canvas, so ink
// always covers the question but the grid never crosses it. Locked by
// default (pointer-events:none, skipped by hit-testing); the ⋯ menu can
// unlock it, which turns it into a movable/resizable pseudo-object (SP_Q_ID).
function spBuildQuestionLayer() {
  if (!_sp.built) return;
  const L = _sp.qLayer;
  L.innerHTML = '';
  const card = _sp.card;
  if (!card) { _sp.q.present = false; L.style.display = 'none'; return; }
  const inner = el('div', { class: 'sp-q-inner' });
  inner.appendChild(el('div', { class: 'sp-q-label' }, 'QUESTION'));
  const sess = (typeof studySession !== 'undefined') ? studySession : null;
  if (card.frontImage && (!sess || sess.showImages !== false)) {
    const img = el('img', { src: card.frontImage, alt: 'Question graphic', draggable: 'false' });
    img.addEventListener('load', () => {
      if (_sp.qBuiltFor !== card.id) return;
      spMeasureQuestion();
      if (!_sp.padRestored) {          // fresh pad: keep the question centered + fitted
        _sp.q.y = -_sp.q.h / 2;
        _sp.view = spFitZoom({ x: _sp.q.x, y: _sp.q.y, w: _sp.q.w, h: _sp.q.h }, _sp.vw || 600, _sp.vh || 420, 48, 1);
      }
      spInvalidate();
    });
    inner.appendChild(el('div', { class: 'sp-q-graphics' }, img));
  }
  // NOTE: 'table' cards intentionally show only their instruction text here —
  // the quiz blanks a random cell combination per render (pickTableCombination),
  // so mirroring the grid would either spoil answers or disagree with the live
  // inputs beside us. The full grid stays in the session UI.
  inner.appendChild(setRichText(el('div', { class: 'sp-q-text' }), formatCardFront(card)));
  L.appendChild(inner);
  L.style.display = 'block';
  _sp.q.present = true;
}

function spMeasureQuestion() {
  if (!_sp.built || !_sp.q.present) { _sp.q.h = 0; return; }
  const inner = _sp.qLayer.firstElementChild;
  _sp.q.h = inner ? inner.offsetHeight : 0;
}

function spPositionQuestionLayer() {
  if (!_sp.built) return;
  const L = _sp.qLayer;
  if (!_sp.q.present) { L.style.display = 'none'; return; }
  const z = _sp.view.zoom;
  L.style.display = 'block';          // class default is display:none — must override explicitly
  L.style.width = _sp.q.w + 'px';
  L.style.transform = `translate(${_sp.q.x * z + _sp.view.x}px, ${_sp.q.y * z + _sp.view.y}px) scale(${z})`;
  L.classList.toggle('sp-unlocked', !!_sp.q.unlocked);
}

/** Restore-from-autosave or lay out a fresh pad, then fit/center the view. */
function spPrepareQuestion() {
  if (!_sp.built || !_sp.card) return;
  const r = _sp.pendingRestore;
  _sp.padRestored = !!r;
  _sp.sel.clear();
  _sp.draft = null; _sp.draftHover = null; _sp.marquee = null; _sp.action = null;
  _sp.hist = spMakeHistory(spSettings().undoSteps);
  if (r) {
    _sp.objects = (r.objects || []).filter(o => o && typeof o === 'object' && typeof o.type === 'string').map(o => Object.assign({ id: o.id || spUid() }, o));
    if (r.view) _sp.view = { x: Number(r.view.x) || 0, y: Number(r.view.y) || 0, zoom: spClampZoom(r.view.zoom) };
    if (r.grid) {
      _sp.grid.angle = spNormAngle(r.grid.angle);
      _sp.grid.spacing = Math.max(8, Math.min(96, Number(r.grid.spacing) || _sp.grid.spacing));
      _sp.grid.visible = r.grid.visible !== false;
      if (SP_BG_STYLES.some(s => s.id === r.grid.style)) _sp.grid.style = r.grid.style;
      _sp.grid.snap = !!r.grid.snap;
      _sp.grid.opacity = Math.max(0.1, Math.min(1, Number(r.grid.opacity) || _sp.grid.opacity));
    }
    if (r.style) Object.assign(_sp.style, r.style);
    if (r.tool && SP_TOOLS.some(t => t.id === r.tool)) _sp.tool = r.tool;
    if (r.q && typeof r.q === 'object') {
      _sp.q.x = Number(r.q.x) || 0; _sp.q.y = Number(r.q.y) || 0;
      _sp.q.w = Math.max(160, Number(r.q.w) || SP_Q_WIDTH);
      _sp.q.unlocked = !!r.q.unlocked;
    }
  } else {
    _sp.objects = [];
    _sp.view = { x: 0, y: 0, zoom: 1 };
    _sp.q = { x: 0, y: 0, w: SP_Q_WIDTH, h: 0, unlocked: false, present: false };
  }
  spBuildQuestionLayer();
  spPositionQuestionLayer();          // applies q.w so offsetHeight measures correctly
  spMeasureQuestion();
  if (!r) {
    _sp.q.x = -_sp.q.w / 2;
    _sp.q.y = -_sp.q.h / 2;
    _sp.view = spFitZoom({ x: _sp.q.x, y: _sp.q.y, w: _sp.q.w, h: _sp.q.h }, _sp.vw || 600, _sp.vh || 420, 48, 1);
  }
  _sp.qBuiltFor = _sp.boundCardId;
  _sp.pendingRestore = null;
  if (r) spShowRestoredBadge();
  spUpdateChrome();
  spInvalidate();
}

function spShowRestoredBadge() {
  if (!_sp.built) return;
  const b = _sp.badge;
  b.style.display = '';
  b.style.animation = 'none';
  void b.offsetWidth;                 // restart the fade animation
  b.style.animation = '';
  clearTimeout(_sp.badgeTimer);
  _sp.badgeTimer = setTimeout(() => { b.style.display = 'none'; }, 3200);
}

// ── Canvas sizing + render loop ────────────────────────────────────────────
function spResizeCanvases() {
  if (!_sp.built) return;
  const wrap = _sp.canvasWrap;
  const r = wrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  for (const cv of [_sp.gridCanvas, _sp.objCanvas]) {
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    cv._cssW = w; cv._cssH = h;
  }
  _sp.vw = w; _sp.vh = h;
}

function spInvalidate() {
  if (_sp.raf != null || !_sp.built || !_sp.open) return;
  _sp.raf = requestAnimationFrame(() => { _sp.raf = null; spRender(); });
}

function spRender() {
  if (!_sp.built || !_sp.open) return;
  spDrawGrid();
  spDrawScene();
  spPositionQuestionLayer();
  spPositionTextEditor();
  spUpdateChrome();
}

// Grid canvas (world-space drawing under a rotation around the world origin —
// the grid rotates, objects don't; spec §9).
function spDrawGrid() {
  const ctx = _sp.gridCtx, cv = _sp.gridCanvas;
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cv._cssW || 0, cv._cssH || 0);
  const g = _sp.grid;
  if (!g.visible || g.style === 'blank') return;
  const z = _sp.view.zoom;
  // Thin out spacing when zoomed far out so line count stays bounded (§29).
  let s = Math.max(4, g.spacing);
  while (s * z < 9 && s < 100000) s *= 5;
  const a = g.angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  const W = cv._cssW || 0, H = cv._cssH || 0;
  // Visible world corners → grid-local space (rotate by -a around origin).
  const corners = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: 0, y: H }, { x: W, y: H }].map(spS2W);
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (const p of corners) {
    const lx = p.x * ca + p.y * sa, ly = -p.x * sa + p.y * ca;
    if (lx < mnx) mnx = lx; if (lx > mxx) mxx = lx;
    if (ly < mny) mny = ly; if (ly > mxy) mxy = ly;
  }
  ctx.save();
  ctx.translate(_sp.view.x, _sp.view.y);
  ctx.scale(z, z);
  ctx.rotate(a);
  const op = g.opacity;
  const ink = _sp.gridInk || '255,255,255';
  const faint = `rgba(${ink},${(0.09 * op + 0.03).toFixed(3)})`;
  const mid = `rgba(${ink},${(0.16 * op + 0.05).toFixed(3)})`;
  const strong = `rgba(${ink},${(0.30 * op + 0.08).toFixed(3)})`;

  // One family of parallel lines running along direction θ, spaced `sp`.
  const family = (thetaDeg, sp, color, lw, onlyEvery) => {
    const t = thetaDeg * Math.PI / 180, dx = Math.cos(t), dy = Math.sin(t);
    const nx = -dy, ny = dx;
    const projs = [{ x: mnx, y: mny }, { x: mxx, y: mny }, { x: mnx, y: mxy }, { x: mxx, y: mxy }].map(p => p.x * nx + p.y * ny);
    let k0 = Math.floor(Math.min(...projs) / sp) - 1, k1 = Math.ceil(Math.max(...projs) / sp) + 1;
    if (onlyEvery) { k0 = Math.ceil(k0 / onlyEvery) * onlyEvery; }
    if (k1 - k0 > 800) return;        // perf guard
    const diag = Math.hypot(mxx - mnx, mxy - mny) + sp * 2;
    ctx.strokeStyle = color; ctx.lineWidth = lw;
    ctx.beginPath();
    for (let k = k0; k <= k1; k += (onlyEvery || 1)) {
      const bx = nx * k * sp, by = ny * k * sp;
      ctx.moveTo(bx - dx * diag, by - dy * diag);
      ctx.lineTo(bx + dx * diag, by + dy * diag);
    }
    ctx.stroke();
  };
  const dots = (sp, r, color, offset) => {
    const x0 = Math.floor(mnx / sp) * sp, x1 = mxx, y0 = Math.floor(mny / sp) * sp, y1 = mxy;
    const nx = Math.round((x1 - x0) / sp), ny = Math.round((y1 - y0) / sp);
    if (nx * ny > 12000) return;      // perf guard
    ctx.fillStyle = color;
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) {
      ctx.fillRect(x0 + i * sp - r / 2, y0 + j * sp - r / 2, r, r);
    }
  };
  const lw = 1 / z;                   // hairline at any zoom
  switch (g.style) {
    case 'grid':
      family(0, s, faint, lw); family(90, s, faint, lw);
      family(0, s * 5, mid, lw, 5); family(90, s * 5, mid, lw, 5);
      break;
    case 'squared':
      family(0, s, mid, lw); family(90, s, mid, lw);
      break;
    case 'graph':
      family(0, s, faint, lw); family(90, s, faint, lw);
      family(0, s * 5, mid, lw, 5); family(90, s * 5, mid, lw, 5);
      ctx.strokeStyle = strong;
      ctx.lineWidth = 1.5 / z;
      ctx.beginPath();
      ctx.moveTo(mnx - s, 0); ctx.lineTo(mxx + s, 0);
      ctx.moveTo(0, mny - s); ctx.lineTo(0, mxy + s);
      ctx.stroke();
      break;
    case 'dotted':
      dots(s, Math.max(1.4 / z, s * 0.06), `rgba(${ink},${(0.28 * op + 0.08).toFixed(3)})`);
      break;
    case 'dotmatrix':
      dots(s / 2, Math.max(1 / z, s * 0.035), `rgba(${ink},${(0.22 * op + 0.06).toFixed(3)})`);
      break;
    case 'lined':
      family(0, s * 1.6, `rgba(${ink},${(0.16 * op + 0.05).toFixed(3)})`, lw);
      break;
    case 'iso':
      family(0, s, faint, lw); family(60, s, faint, lw); family(120, s, faint, lw);
      break;
    default: break; // 'blank' handled above
  }
  ctx.restore();
}

// Objects canvas — everything user-drawn, plus selection UI.
function spDrawScene() {
  const ctx = _sp.objCtx, cv = _sp.objCanvas;
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const z = _sp.view.zoom;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cv._cssW || 0, cv._cssH || 0);
  const vp = spWorldViewport(80 / z);
  ctx.save();
  ctx.translate(_sp.view.x, _sp.view.y);
  ctx.scale(z, z);
  for (const o of _sp.objects) {
    if (o.hidden) continue;
    if (_sp.editing && _sp.editing.id === o.id) continue;  // textarea shows it live
    if (!spIntersects(spBBoxOf(o), vp)) continue;          // viewport culling (§29)
    spDrawObject(ctx, o);
  }
  if (_sp.draft) spDrawObject(ctx, _sp.draft);
  if (_sp.draft && _sp.draft.type === 'polygon' && _sp.draftHover) {
    const p0 = _sp.draft.pts[0], h = _sp.draftHover;
    ctx.strokeStyle = _sp.style.color; ctx.lineWidth = _sp.style.width; ctx.setLineDash([6 / z, 5 / z]);
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(h.x, h.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(p0.x, p0.y, 4 / z, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
  spDrawOverlay(ctx, dpr);
}

function spRoundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); return; }
  ctx.rect(x, y, w, h);               // graceful fallback for old engines
}

function spFontFor(o) {
  const weight = o.bold ? '800' : '600';
  return `${o.italic ? 'italic ' : ''}${weight} ${o.fontSize || 20}px Nunito, system-ui, sans-serif`;
}

function spApplyRot(ctx, o, b) {
  if (!o.rot) return;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, r = o.rot * Math.PI / 180;
  ctx.translate(cx, cy); ctx.rotate(r); ctx.translate(-cx, -cy);
}

function spDrawObject(ctx, o) {
  ctx.save();
  const b = spBBoxOf(o);
  spApplyRot(ctx, o, b);
  ctx.globalAlpha = (o.type === 'stroke' && o.hl) ? 0.4 * (o.opacity == null ? 1 : o.opacity)
    : (o.opacity == null ? 1 : o.opacity);
  switch (o.type) {
    case 'stroke': spDrawStroke(ctx, o); break;
    case 'line': spDrawLineShape(ctx, o, false); break;
    case 'arrow': spDrawLineShape(ctx, o, true); break;
    case 'rect':
      spRoundRectPath(ctx, o.x, o.y, o.w, o.h, o.rx || 0);
      spFillStroke(ctx, o);
      break;
    case 'ellipse': {
      const nb = spNormBox(o.x, o.y, o.w, o.h);
      ctx.beginPath();
      ctx.ellipse(nb.x + nb.w / 2, nb.y + nb.h / 2, Math.max(0.1, nb.w / 2), Math.max(0.1, nb.h / 2), 0, 0, Math.PI * 2);
      spFillStroke(ctx, o);
      break;
    }
    case 'triangle': {
      const nb = spNormBox(o.x, o.y, o.w, o.h);
      ctx.beginPath();
      ctx.moveTo(nb.x + nb.w / 2, nb.y); ctx.lineTo(nb.x, nb.y + nb.h); ctx.lineTo(nb.x + nb.w, nb.y + nb.h);
      ctx.closePath();
      spFillStroke(ctx, o);
      break;
    }
    case 'polygon': {
      const pts = o.pts || [];
      if (pts.length > 1) {
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        if (o.closed) ctx.closePath();
        spFillStroke(ctx, o);
      }
      break;
    }
    case 'text': spDrawText(ctx, o); break;
    case 'image': spDrawImageObj(ctx, o); break;
    default: break;
  }
  ctx.restore();
}

function spFillStroke(ctx, o) {
  if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(); }
  if ((o.width || 0) > 0 && o.color !== 'transparent') {
    ctx.strokeStyle = o.color; ctx.lineWidth = o.width; ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

function spDrawStroke(ctx, o) {
  const pts = o.pts || [];
  if (!pts.length) return;
  ctx.strokeStyle = o.color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (pts.length === 1) {             // a click = a dot
    ctx.fillStyle = o.color;
    ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, Math.max(0.6, o.width / 2), 0, Math.PI * 2); ctx.fill();
    return;
  }
  const hasP = pts.some(p => typeof p.p === 'number' && p.p > 0);
  if (!hasP) {                        // smooth single-pass path (quadratic midpoints)
    ctx.lineWidth = o.width;
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.stroke();
    return;
  }
  // Stylus pressure → per-segment variable width (§14/§27).
  for (let i = 1; i < pts.length; i++) {
    const A = pts[i - 1], B = pts[i];
    const pr = (typeof B.p === 'number' && B.p > 0) ? B.p : 0.5;
    ctx.lineWidth = Math.max(0.4, o.width * (0.45 + 1.1 * pr));
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
  }
}

function spDrawLineShape(ctx, o, arrow) {
  ctx.strokeStyle = o.color; ctx.lineWidth = o.width; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); ctx.stroke();
  if (arrow) {
    const size = Math.max(9, o.width * 2.8);
    spArrowHead(ctx, o.x1, o.y1, o.x2, o.y2, size, o.color);
    if (o.double) spArrowHead(ctx, o.x2, o.y2, o.x1, o.y1, size, o.color);
  }
}
function spArrowHead(ctx, x1, y1, x2, y2, size, color) {
  if (x1 === x2 && y1 === y2) return;
  const a = Math.atan2(y2 - y1, x2 - x1);
  ctx.save(); ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(a - 0.42), y2 - size * Math.sin(a - 0.42));
  ctx.lineTo(x2 - size * Math.cos(a + 0.42), y2 - size * Math.sin(a + 0.42));
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function spDrawText(ctx, o) {
  ctx.font = spFontFor(o);
  const padX = 6, padY = 5;
  const lines = spWrapText(o.text, Math.max(20, o.w - padX * 2), s => ctx.measureText(s).width);
  const lh = (o.fontSize || 20) * 1.35;
  const h = lines.length * lh + padY * 2;
  o._h = h;                           // cached for spBBoxOf / hit-testing
  if (o.bg) { ctx.fillStyle = o.bg; spRoundRectPath(ctx, o.x, o.y, o.w, h, 8); ctx.fill(); }
  ctx.fillStyle = o.color;
  ctx.textAlign = o.align || 'left';
  ctx.textBaseline = 'top';
  const tx = o.align === 'center' ? o.x + o.w / 2 : o.align === 'right' ? o.x + o.w - padX : o.x + padX;
  lines.forEach((ln, i) => { if (ln) ctx.fillText(ln, tx, o.y + padY + i * lh); });
}

function spDrawImageObj(ctx, o) {
  let img = _sp.imgCache[o.src];
  if (!img) {
    img = new Image();
    img.onload = () => spInvalidate();
    _sp.imgCache[o.src] = img;
    img.src = o.src;
  }
  if (img.complete && img.naturalWidth) ctx.drawImage(img, o.x, o.y, o.w, o.h);
  else {                              // loading placeholder
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1 / _sp.view.zoom;
    ctx.setLineDash([6 / _sp.view.zoom, 4 / _sp.view.zoom]);
    ctx.strokeRect(o.x, o.y, o.w, o.h);
    ctx.restore();
  }
}

// Screen-space overlay: selection outlines + handles, marquee, eraser cursor.
function spDrawOverlay(ctx, dpr) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const z = _sp.view.zoom;
  if (_sp.marquee) {
    const m = _sp.marquee;
    ctx.save();
    ctx.strokeStyle = _sp.accent; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.fillStyle = 'rgba(91,206,250,0.08)';
    const x = Math.min(m.x0, m.x1), y = Math.min(m.y0, m.y1), w = Math.abs(m.x1 - m.x0), h = Math.abs(m.y1 - m.y0);
    ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }
  const sel = spSelectedObjs();
  const qSel = _sp.sel.has(SP_Q_ID) && _sp.q.unlocked && _sp.q.present;
  if (sel.length || qSel) {
    ctx.save();
    ctx.strokeStyle = _sp.accent; ctx.lineWidth = 1.5;
    for (const o of sel) {
      const b = spBBoxOf(o);
      const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      const corners = [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }]
        .map(p => (o.rot ? spRotAround(p, c, o.rot * Math.PI / 180) : p))
        .map(spW2S);
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath(); ctx.stroke();
    }
    if (qSel) {                       // outline for the unlocked question layer
      const a = spW2S({ x: _sp.q.x, y: _sp.q.y });
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(a.x, a.y, _sp.q.w * z, Math.max(20, _sp.q.h * z));
      ctx.setLineDash([]);
    }
    // Handles only make sense single-selected (or question-only selected).
    const single = sel.length === 1 ? sel[0] : (sel.length === 0 && qSel ? { id: SP_Q_ID } : null);
    if (single) {
      const hp = spSelHandlePts(single);
      const hs = 8;
      for (const k of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
        const p = spW2S(hp[k]);
        ctx.fillStyle = '#fff'; ctx.strokeStyle = _sp.accent; ctx.lineWidth = 1.5;
        ctx.fillRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
        ctx.strokeRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
      }
      if (single.id !== SP_Q_ID) {    // the question never rotates — width only
        const top = spW2S(hp.n), rp = spW2S(hp.rot);
        ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(rp.x, rp.y); ctx.stroke();
        ctx.beginPath(); ctx.arc(rp.x, rp.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
      }
    }
    ctx.restore();
  }
  if (_sp.tool === 'eraser' && _sp.hoverScreen) {
    const r = _sp.style.eraserSize || SP_DEFAULTS.eraserSize;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.arc(_sp.hoverScreen.x, _sp.hoverScreen.y, r, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}

/** World-space handle points for the single selected object (or question). */
function spSelHandlePts(o) {
  const b = o.id === SP_Q_ID ? { x: _sp.q.x, y: _sp.q.y, w: _sp.q.w, h: _sp.q.h } : spBBoxOf(o);
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const r = ((o.id === SP_Q_ID ? 0 : o.rot) || 0) * Math.PI / 180;
  const loc = {
    nw: { x: b.x, y: b.y }, n: { x: c.x, y: b.y }, ne: { x: b.x + b.w, y: b.y },
    e: { x: b.x + b.w, y: c.y }, se: { x: b.x + b.w, y: b.y + b.h }, s: { x: c.x, y: b.y + b.h },
    sw: { x: b.x, y: b.y + b.h }, w: { x: b.x, y: c.y },
  };
  const out = { _b: b, _c: c };
  for (const k in loc) out[k] = r ? spRotAround(loc[k], c, r) : loc[k];
  const top = { x: c.x, y: b.y - 26 / _sp.view.zoom };
  out.rot = r ? spRotAround(top, c, r) : top;
  return out;
}

// ── Chrome sync (buttons, slider, labels) ─────────────────────────────────
function spZoomFromSlider(v) { return SP_ZOOM_MIN * Math.pow(SP_ZOOM_MAX / SP_ZOOM_MIN, Math.max(0, Math.min(1000, v)) / 1000); }
function spSliderFromZoom(z) { return Math.round(1000 * Math.log(Math.max(SP_ZOOM_MIN, z) / SP_ZOOM_MIN) / Math.log(SP_ZOOM_MAX / SP_ZOOM_MIN)); }

function spUpdateChrome() {
  if (!_sp.built) return;
  const pct = Math.round(_sp.view.zoom * 100) + '%';
  if (_sp.zoomLabel.textContent !== pct) _sp.zoomLabel.textContent = pct;
  const sv = String(spSliderFromZoom(_sp.view.zoom));
  if (_sp.zoomSlider.value !== sv) _sp.zoomSlider.value = sv;
  _sp.undoBtn.disabled = !_sp.hist || !_sp.hist.canUndo;
  _sp.redoBtn.disabled = !_sp.hist || !_sp.hist.canRedo;
  _sp.gridToggleBtn.setAttribute('aria-pressed', String(!!_sp.grid.visible));
  _sp.fullBtn.textContent = _sp.fullscreen ? '🗗' : '⛶';
  for (const b of _sp.toolBtns) b.setAttribute('aria-pressed', String(b.getAttribute('data-tool') === _sp.tool));
  if (_sp.colorBtn) {
    _sp.colorBtn.style.background = _sp.style.color;
    _sp.colorBtn.style.border = '1px solid rgba(255,255,255,0.35)';
  }
}

// ── Small shared utilities ─────────────────────────────────────────────────

function spCanvasPt(e) {
  const r = _sp.objCanvas.getBoundingClientRect();
  return { x: (e.clientX || 0) - r.left, y: (e.clientY || 0) - r.top };
}

/** The live objects currently selected (array order = z-order). */
function spSelectedObjs() {
  return _sp.objects.filter(o => _sp.sel.has(o.id));
}

/** Deep clone without `_`-prefixed caches (e.g. text `_h`) so snapshots,
 *  autosaves and exports stay clean JSON. */
function spCleanObj(o) {
  const out = {};
  for (const k in o) if (!k.startsWith('_')) out[k] = o[k];
  return spClone(out);
}

/** Mutate an object's geometry by a world-space delta (per type). */
function spTranslateObjData(o, dx, dy) {
  switch (o.type) {
    case 'stroke': case 'polygon': for (const p of (o.pts || [])) { p.x += dx; p.y += dy; } break;
    case 'line': case 'arrow': o.x1 += dx; o.y1 += dy; o.x2 += dx; o.y2 += dy; break;
    default: o.x += dx; o.y += dy; break;   // rect / ellipse / triangle / text / image
  }
}

/** Moving-average pass over a stroke (keeps endpoints + pressure values).
 *  Applied once on pointer-up for smoothing levels ≥ 2 (spec §14). */
function spWindowSmooth(pts, k) {
  if (!pts || pts.length < 3 || k < 3) return pts;
  const r = Math.floor(k / 2), out = [];
  for (let i = 0; i < pts.length; i++) {
    if (i < r || i >= pts.length - r) { out.push(pts[i]); continue; }
    let sx = 0, sy = 0, n = 0;
    for (let j = i - r; j <= i + r; j++) { sx += pts[j].x; sy += pts[j].y; n++; }
    const p = { x: sx / n, y: sy / n };
    if (typeof pts[i].p === 'number') p.p = pts[i].p;
    out.push(p);
  }
  return out;
}

// ── Undo / redo (spec §19) ─────────────────────────────────────────────────
function spHistoryState() {
  return JSON.stringify({
    objects: _sp.objects.map(spCleanObj),
    q: { x: _sp.q.x, y: _sp.q.y, w: _sp.q.w, unlocked: !!_sp.q.unlocked },
  });
}
function spSnapshot() {
  if (!_sp.hist) _sp.hist = spMakeHistory(spSettings().undoSteps);
  _sp.hist.push(spHistoryState());
  spUpdateChrome();
}
function spApplySnapshot(s) {
  let d; try { d = JSON.parse(s); } catch (e) { return; }
  _sp.objects = Array.isArray(d.objects) ? d.objects : [];
  if (d.q) { _sp.q.x = d.q.x; _sp.q.y = d.q.y; _sp.q.w = d.q.w; _sp.q.unlocked = !!d.q.unlocked; }
  _sp.sel.clear(); _sp.draft = null; _sp.draftHover = null; _sp.marquee = null;
  if (_sp.editing) { _sp.editing = null; _sp.textarea.style.display = 'none'; }
  spPositionQuestionLayer();
  spInvalidate(); spUpdateChrome(); spTouch();
}
function spUndo() {
  if (!_sp.built || !_sp.hist) return;
  if (_sp.editing) spCommitText();
  const s = _sp.hist.undo(spHistoryState());
  if (s != null) spApplySnapshot(s);
}
function spRedo() {
  if (!_sp.built || !_sp.hist) return;
  if (_sp.editing) spCommitText();
  const s = _sp.hist.redo(spHistoryState());
  if (s != null) spApplySnapshot(s);
}

// ── Autosave (spec §20/§31 — sessionStorage only, per question, ephemeral) ─
function spCurrentState() {
  return {
    objects: _sp.objects.map(spCleanObj),
    view: { x: _sp.view.x, y: _sp.view.y, zoom: _sp.view.zoom },
    grid: Object.assign({}, _sp.grid),
    q: { x: _sp.q.x, y: _sp.q.y, w: _sp.q.w, unlocked: !!_sp.q.unlocked },
    style: Object.assign({}, _sp.style),
    tool: _sp.tool,
    ts: Date.now(),
  };
}
function spTouch() {
  if (!spSettings().autosave) return;
  clearTimeout(_sp.saveTimer);
  _sp.saveTimer = setTimeout(() => spFlushSave(), 1200);
}
function spFlushSave() {
  clearTimeout(_sp.saveTimer); _sp.saveTimer = null;
  if (!_sp.boundCardId) return;
  if (!spSettings().autosave) return;   // the toggle means it: nothing persists
  try {
    sessionStorage.setItem(SP_STORE_PREFIX + _sp.boundCardId, spSerialize(spCurrentState()));
  } catch (e) {
    // Quota or private-mode failure must never break the study session.
    if (typeof console !== 'undefined') console.warn('scratchpad autosave failed:', e && e.message);
  }
}
function spReadSaved(cardId) {
  try { return spParse(sessionStorage.getItem(SP_STORE_PREFIX + cardId)); }
  catch (e) { return null; }
}
function spDeleteSaved(cardId) {
  if (!cardId) return;
  try { sessionStorage.removeItem(SP_STORE_PREFIX + cardId); } catch (e) {}
}
/** Spec §31: nothing survives the session — wipe every pad on start AND end. */
function spClearAllSaved() {
  try {
    const keys = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(SP_STORE_PREFIX)) keys.push(k);
    }
    keys.forEach(k => sessionStorage.removeItem(k));
  } catch (e) {}
}

// ── View controls (spec §8/§17) ────────────────────────────────────────────
function spSetZoom(z2, screenPt) {
  const pt = screenPt || { x: (_sp.vw || 0) / 2, y: (_sp.vh || 0) / 2 };
  _sp.view = spZoomAt(_sp.view, z2, pt.x, pt.y);
  spInvalidate(); spUpdateChrome(); spTouch();
}
function spZoomStep(f) { spSetZoom(_sp.view.zoom * f); }

/** "Return to center": selection if any, else the question, else world 0,0 —
 *  zoom preserved (spec §17). */
function spCenterView() {
  const sel = spSelectedObjs();
  const b = sel.length ? spObjectsBBox(sel)
    : (_sp.q.present ? { x: _sp.q.x, y: _sp.q.y, w: _sp.q.w, h: _sp.q.h } : { x: 0, y: 0, w: 0, h: 0 });
  _sp.view.x = (_sp.vw || 0) / 2 - (b.x + b.w / 2) * _sp.view.zoom;
  _sp.view.y = (_sp.vh || 0) / 2 - (b.y + b.h / 2) * _sp.view.zoom;
  spInvalidate(); spTouch();
}
function spUnionBoxes(bs) {
  let out = null;
  for (const b of bs) {
    if (!out) out = { x: b.x, y: b.y, w: b.w, h: b.h };
    else {
      const x1 = Math.max(out.x + out.w, b.x + b.w), y1 = Math.max(out.y + out.h, b.y + b.h);
      out.x = Math.min(out.x, b.x); out.y = Math.min(out.y, b.y);
      out.w = x1 - out.x; out.h = y1 - out.y;
    }
  }
  return out;
}
function spFitAll() {
  const boxes = [];
  const bObj = spObjectsBBox(_sp.objects);
  if (bObj) boxes.push(bObj);
  if (_sp.q.present) boxes.push({ x: _sp.q.x, y: _sp.q.y, w: _sp.q.w, h: _sp.q.h });
  _sp.view = spFitZoom(spUnionBoxes(boxes) || { x: 0, y: 0, w: 1, h: 1 }, _sp.vw || 600, _sp.vh || 420, 40);
  spInvalidate(); spTouch();
}
/** Reset view = 100%-capped fit of the question, dead center (spec §17). */
function spResetView() {
  const b = _sp.q.present ? { x: _sp.q.x, y: _sp.q.y, w: _sp.q.w, h: _sp.q.h } : { x: 0, y: 0, w: 0, h: 0 };
  _sp.view = spFitZoom(b, _sp.vw || 600, _sp.vh || 420, 48, 1);
  spInvalidate(); spTouch();
}
function spSetFullscreen(on) {
  _sp.fullscreen = !!on;
  if (_sp.panel) _sp.panel.classList.toggle('sp-full', _sp.fullscreen);
  spClosePopovers();
  // Layout settles after the class flip — re-measure on the next frame.
  requestAnimationFrame(() => { spResizeCanvases(); spInvalidate(); });
}

// ── Style + tools (spec §10/§11/§21) ───────────────────────────────────────
function spStyleSeedFromSettings() {
  const s = spSettings();
  _sp.style.color = s.color || SP_DEFAULTS.color;
  _sp.style.width = s.width || SP_DEFAULTS.width;
  _sp.style.eraserSize = s.eraserSize || SP_DEFAULTS.eraserSize;
  _sp.grid.spacing = Math.max(8, Math.min(96, Number(s.gridSpacing) || SP_DEFAULTS.gridSpacing));
  _sp.grid.opacity = Math.max(0.1, Math.min(1, Number(s.gridOpacity) || SP_DEFAULTS.gridOpacity));
  _sp.grid.style = SP_BG_STYLES.some(b => b.id === s.bg) ? s.bg : 'grid';
  _sp.grid.visible = s.gridVisible !== false;
  _sp.grid.snap = !!s.snap;
}
/** Patch the drawing style; with a selection it restyles the selected objects
 *  (spec §21: style controls affect selection first, defaults second). */
function spStylePatch(patch) {
  Object.assign(_sp.style, patch);
  const sel = spSelectedObjs();
  if (sel.length) {
    spSnapshot();
    for (const o of sel) {
      if (patch.color != null) o.color = patch.color;
      if (patch.width != null && o.type !== 'text') o.width = patch.width;
      if ('fill' in patch) o.fill = patch.fill;
      if (patch.fontSize != null && o.type === 'text') o.fontSize = patch.fontSize;
      if (patch.opacity != null) o.opacity = patch.opacity;
      if (patch.bold !== undefined && o.type === 'text') o.bold = patch.bold;
      if (patch.italic !== undefined && o.type === 'text') o.italic = patch.italic;
    }
    spInvalidate(); spTouch();
  }
  if (_sp.editing) {
    const o = _sp.objects.find(x => x.id === _sp.editing.id);
    if (o) {
      if (patch.color != null) o.color = patch.color;
      if (patch.fontSize != null) o.fontSize = patch.fontSize;
      if (patch.bold !== undefined) o.bold = patch.bold;
      if (patch.italic !== undefined) o.italic = patch.italic;
      spPositionTextEditor(); spInvalidate();
    }
  }
  if (_sp.draft) {
    if (patch.color != null) _sp.draft.color = patch.color;
    if (patch.width != null) _sp.draft.width = patch.width;
    if ('fill' in patch) _sp.draft.fill = patch.fill;
    spInvalidate();
  }
  spUpdateChrome();
}
function spSetTool(id) {
  if (!_sp.built) return;
  if (id === 'image') {                 // image "tool" is really an action (§13)
    try { _sp.fileInput.click(); } catch (e) {}
    return;
  }
  if (_sp.editing) spCommitText();
  if (_sp.draft && _sp.draft.type === 'polygon' && id !== 'polygon') {
    if ((_sp.draft.pts || []).length >= 3) spCommitPolygon();
    else { _sp.draft = null; _sp.draftHover = null; }
  }
  _sp.tool = id;
  const cursors = {
    select: 'default', pan: 'grab', text: 'text', pen: 'crosshair', highlight: 'crosshair',
    eraser: 'none', line: 'crosshair', arrow: 'crosshair', rect: 'crosshair',
    ellipse: 'crosshair', triangle: 'crosshair', polygon: 'crosshair',
  };
  _sp.objCanvas.style.cursor = cursors[id] || 'default';
  spUpdateChrome(); spInvalidate(); spTouch();
}
function spPickColor(anchor, cb) {
  try { openColorPicker(anchor, _sp.style.color, cb); } catch (e) {}
}

// ── Hit-testing (rotation-aware) ───────────────────────────────────────────
function spHitObj(o, wp, tol) {
  const b = spBBoxOf(o);
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const p = o.rot ? spRotAround(wp, c, -o.rot * Math.PI / 180) : wp;
  switch (o.type) {
    case 'stroke': {
      const pts = o.pts || [];
      const r = Math.max(tol, (o.width || 2) / 2 + tol);
      if (!pts.length) return false;
      if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) < r;
      for (let i = 1; i < pts.length; i++)
        if (spDist2Seg(p.x, p.y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) < r) return true;
      return false;
    }
    case 'line': case 'arrow':
      return spDist2Seg(p.x, p.y, o.x1, o.y1, o.x2, o.y2) < Math.max(tol, (o.width || 2) / 2 + tol);
    case 'rect': {
      const nb = spNormBox(o.x, o.y, o.w, o.h);
      if (o.fill && spInBox(p, nb)) return true;
      return spInBox(p, nb) && !spInBox(p, { x: nb.x + tol, y: nb.y + tol, w: Math.max(0, nb.w - 2 * tol), h: Math.max(0, nb.h - 2 * tol) });
    }
    case 'ellipse': {
      const nb = spNormBox(o.x, o.y, o.w, o.h);
      const rx = Math.max(1e-6, nb.w / 2), ry = Math.max(1e-6, nb.h / 2);
      const d = Math.hypot((p.x - (nb.x + rx)) / rx, (p.y - (nb.y + ry)) / ry);
      const tolN = tol / Math.min(rx, ry);
      return o.fill ? d <= 1 + tolN : Math.abs(d - 1) <= tolN;
    }
    case 'triangle': {
      const nb = spNormBox(o.x, o.y, o.w, o.h);
      const A = { x: nb.x + nb.w / 2, y: nb.y }, B = { x: nb.x, y: nb.y + nb.h }, C = { x: nb.x + nb.w, y: nb.y + nb.h };
      if (o.fill && spInPoly(p, [A, B, C])) return true;
      return spDist2Seg(p.x, p.y, A.x, A.y, B.x, B.y) < tol
        || spDist2Seg(p.x, p.y, B.x, B.y, C.x, C.y) < tol
        || spDist2Seg(p.x, p.y, C.x, C.y, A.x, A.y) < tol;
    }
    case 'polygon': {
      const pts = o.pts || [];
      if (pts.length < 2) return false;
      for (let i = 1; i < pts.length; i++)
        if (spDist2Seg(p.x, p.y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) < Math.max(tol, (o.width || 2) / 2)) return true;
      if (o.closed && pts.length > 2) {
        const L = pts[pts.length - 1];
        if (spDist2Seg(p.x, p.y, L.x, L.y, pts[0].x, pts[0].y) < Math.max(tol, (o.width || 2) / 2)) return true;
        if (o.fill && spInPoly(p, pts)) return true;
      }
      return false;
    }
    case 'text': case 'image':
      return spInBox(p, b, tol);
    default: return false;
  }
}
/** Topmost object under a world point; the unlocked question is the floor. */
function spHitTest(wp) {
  const tol = 6 / _sp.view.zoom;
  for (let i = _sp.objects.length - 1; i >= 0; i--) {
    const o = _sp.objects[i];
    if (o.hidden) continue;
    if (spHitObj(o, wp, tol)) return o;
  }
  if (_sp.q.unlocked && _sp.q.present && spInBox(wp, { x: _sp.q.x, y: _sp.q.y, w: _sp.q.w, h: _sp.q.h }))
    return { id: SP_Q_ID };
  return null;
}

// ── Pointer pipeline (spec §10–§15, §26–§27) ──────────────────────────────
function spPressure(e) {
  // Only real pen pressure is recorded — mouse/touch draw the smooth
  // constant-width path (spDrawStroke checks for numeric `p`).
  if (e.pointerType === 'pen' && typeof e.pressure === 'number' && e.pressure > 0)
    return Math.round(e.pressure * 100) / 100;
  return undefined;
}

function spOnPointerDown(e) {
  if (!_sp.built || !_sp.open) return;
  const scr = spCanvasPt(e);
  const wp = spS2W(scr);
  _sp.pointers.set(e.pointerId, scr);
  try { _sp.objCanvas.setPointerCapture(e.pointerId); } catch (err) {}
  spCloseCtxMenu();
  if (_sp.popover.classList.contains('sp-open')) spClosePopovers();
  if (_sp.editing && !(e.target === _sp.textarea)) spCommitText();

  if (_sp.pointers.size === 2) { spBeginGesture(); return; }
  if (_sp.pointers.size > 2) return;

  clearTimeout(_sp.longPressTimer); _sp.longPressTimer = null;
  if (e.pointerType === 'touch' && _sp.tool === 'select' && e.button === 0) {
    _sp.longPressTimer = setTimeout(() => {   // long-press = context menu (§27)
      _sp.longPressTimer = null;
      if (_sp.pointers.size === 1 && !_sp.action) {
        _sp.pointers.clear();
        spOpenCtxMenuAt(scr.x, scr.y, spHitTest(wp));
      }
    }, 550);
  }
  if (e.button === 2) return;                 // right button → contextmenu event

  if (_sp.spaceDown || _sp.tool === 'pan' || e.button === 1) {
    _sp.action = { type: 'pan', last: scr };
    _sp.objCanvas.style.cursor = 'grabbing';
    return;
  }
  if (e.button !== 0) return;

  switch (_sp.tool) {
    case 'select': spSelectDown(scr, wp, e); break;
    case 'pen': case 'highlight': spDrawDown(wp, e); break;
    case 'eraser': spEraseDown(wp); break;
    case 'text': spTextDown(wp); break;
    case 'line': case 'arrow': case 'rect': case 'ellipse': case 'triangle': spShapeDown(wp, e); break;
    case 'polygon': spPolygonDown(wp, e); break;
    default: break;
  }
  spInvalidate();
}

function spOnPointerMove(e) {
  if (!_sp.built || !_sp.open) return;
  const scr = spCanvasPt(e);
  if (_sp.pointers.has(e.pointerId)) _sp.pointers.set(e.pointerId, scr);
  _sp.hoverScreen = scr;
  if (_sp.pointers.size >= 2 && _sp.gesture) { spGestureUpdate(); return; }
  const wp = spS2W(scr);
  const a = _sp.action;
  if (!a) {
    if (_sp.draft && _sp.draft.type === 'polygon') {
      _sp.draftHover = _sp.grid.snap ? spSnapPoint(wp, _sp.grid.angle, _sp.grid.spacing) : wp;
      spInvalidate();
    } else if (_sp.tool === 'eraser') spInvalidate();   // eraser ring follows cursor
    return;
  }
  clearTimeout(_sp.longPressTimer); _sp.longPressTimer = null;
  switch (a.type) {
    case 'pan':
      _sp.view.x += scr.x - a.last.x;
      _sp.view.y += scr.y - a.last.y;
      a.last = scr;
      spInvalidate();
      break;
    case 'draw': spDrawMove(wp, e, a); break;
    case 'erase': spEraseAt(wp); break;
    case 'shape': spShapeMove(wp, e, a); break;
    case 'move': spMoveUpdate(wp, a); break;
    case 'resize': spResizeUpdate(wp, a, e); break;
    case 'rotate': spRotateUpdate(wp, a, e); break;
    case 'marquee':
      a.m.x1 = scr.x; a.m.y1 = scr.y;
      spInvalidate();
      break;
    default: break;
  }
}

function spOnPointerUp(e) {
  if (!_sp.built) return;
  _sp.pointers.delete(e.pointerId);
  try { _sp.objCanvas.releasePointerCapture(e.pointerId); } catch (err) {}
  clearTimeout(_sp.longPressTimer); _sp.longPressTimer = null;
  if (_sp.pointers.size < 2 && _sp.gesture) {
    const g = _sp.gesture; _sp.gesture = null;
    if (g.moved) spTouch();
  }
  const a = _sp.action;
  if (!a) { spInvalidate(); return; }
  _sp.action = null;
  if (a.type === 'pan') {
    _sp.objCanvas.style.cursor = (_sp.tool === 'pan' || _sp.spaceDown) ? 'grab' : (_sp.tool === 'eraser' ? 'none' : (_sp.tool === 'select' ? 'default' : 'crosshair'));
    spTouch();
  }
  else if (a.type === 'draw') spDrawUp(a);
  else if (a.type === 'erase') { if (a.removed.length) { spTouch(); showToast(`Erased ${a.removed.length} object${a.removed.length === 1 ? '' : 's'}`, 1400); } }
  else if (a.type === 'shape') spShapeUp(a);
  else if (a.type === 'move') { if (a.moved) spTouch(); }
  else if (a.type === 'resize' || a.type === 'rotate') spTouch();
  else if (a.type === 'marquee') spMarqueeUp(a);
  spInvalidate();
}

// Two-finger gesture: pan + pinch-zoom + twist-to-rotate-grid (spec §8/§9/§27).
function spBeginGesture() {
  // A second finger abandons whatever the first was doing (drop tiny drafts).
  const a = _sp.action;
  if (a && a.type === 'draw' && a.obj && a.obj.pts.length < 3) {
    const i = _sp.objects.indexOf(a.obj);
    if (i >= 0) _sp.objects.splice(i, 1);
    // the pre-draw snapshot no longer describes anything that happened —
    // pop it (undo/redo pair keeps the stacks balanced).
    if (_sp.hist && _sp.hist.canUndo) { const cur = spHistoryState(); const pre = _sp.hist.undo(cur); if (pre != null) _sp.hist.redo(pre); }
  }
  _sp.action = null; _sp.draft = null; _sp.draftHover = null; _sp.marquee = null;
  const pts = [..._sp.pointers.values()];
  const [p1, p2] = pts;
  _sp.gesture = {
    dist: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1,
    mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
    ang: Math.atan2(p2.y - p1.y, p2.x - p1.x),
    view: Object.assign({}, _sp.view),
    gridAngle: _sp.grid.angle,
    moved: false,
  };
}
function spGestureUpdate() {
  const g = _sp.gesture;
  const pts = [..._sp.pointers.values()];
  if (!g || pts.length < 2) return;
  const [p1, p2] = pts;
  const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1;
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  let v = spZoomAt(g.view, g.view.zoom * dist / g.dist, g.mid.x, g.mid.y);
  v.x += mid.x - g.mid.x; v.y += mid.y - g.mid.y;
  _sp.view = v;
  _sp.grid.angle = spNormAngle(g.gridAngle + (ang - g.ang) * 180 / Math.PI);
  g.moved = true;
  spInvalidate();
}

// ── Pen / highlighter ──────────────────────────────────────────────────────
function spDrawDown(wp, e) {
  spSnapshot();
  const hl = _sp.tool === 'highlight';
  const pr = spPressure(e);
  const pt = { x: wp.x, y: wp.y };
  if (pr !== undefined) pt.p = pr;
  const o = {
    id: spUid(), type: 'stroke', hl,
    color: _sp.style.color,
    width: hl ? Math.max(10, _sp.style.width * 4) : _sp.style.width,
    opacity: _sp.style.opacity == null ? 1 : _sp.style.opacity,
    pts: [pt], rot: 0,
  };
  _sp.objects.push(o);
  _sp.action = { type: 'draw', obj: o, smoothed: pt, pen: pr !== undefined, moved: false };
}
function spDrawMove(wp, e, a) {
  const last = a.smoothed;
  const minD = 1.2 / _sp.view.zoom;                    // ignore sub-pixel jitter
  if (Math.hypot(wp.x - last.x, wp.y - last.y) < minD) return;
  const lvl = Math.max(0, Math.min(3, Number(spSettings().smoothing == null ? 2 : spSettings().smoothing)));
  let pt = { x: wp.x, y: wp.y };
  if (lvl > 0 && a.obj.pts.length > 1) {               // EMA live smoothing (§14)
    const alpha = [1, 0.55, 0.38, 0.26][lvl];
    pt = { x: last.x + (wp.x - last.x) * alpha, y: last.y + (wp.y - last.y) * alpha };
  }
  const pr = spPressure(e);
  if (pr !== undefined) pt.p = pr;
  a.smoothed = pt;
  a.obj.pts.push(pt);
  a.moved = true;
  spInvalidate();
}
function spDrawUp(a) {
  const lvl = Math.max(0, Math.min(3, Number(spSettings().smoothing == null ? 2 : spSettings().smoothing)));
  if (lvl >= 2) a.obj.pts = spWindowSmooth(a.obj.pts, lvl === 2 ? 3 : 5);
  spTouch();
}

// ── Eraser (object eraser — documented simplification vs spec §12's
//    optional stroke-level erasing; whole objects vanish under the ring) ────
function spEraseDown(wp) {
  _sp.action = { type: 'erase', removed: [], snapped: false };
  spEraseAt(wp);
}
function spEraseAt(wp) {
  const a = _sp.action;
  if (!a || a.type !== 'erase') return;
  const r = (_sp.style.eraserSize || SP_DEFAULTS.eraserSize) / _sp.view.zoom;
  let hit = false;
  for (let i = _sp.objects.length - 1; i >= 0; i--) {
    const o = _sp.objects[i];
    if (o.hidden) continue;
    if (spHitObj(o, wp, r)) {
      if (!a.snapped) { spSnapshot(); a.snapped = true; }
      _sp.objects.splice(i, 1);
      a.removed.push(o);
      _sp.sel.delete(o.id);
      hit = true;
    }
  }
  if (hit) spInvalidate();
}

// ── Shape tools (line/arrow/rect/ellipse/triangle) ─────────────────────────
function spShapeDown(wp, e) {
  spSnapshot();
  const p0 = _sp.grid.snap ? spSnapPoint(wp, _sp.grid.angle, _sp.grid.spacing) : wp;
  const base = {
    id: spUid(), type: _sp.tool, color: _sp.style.color, width: _sp.style.width,
    fill: _sp.style.fill || null, rot: 0, opacity: _sp.style.opacity == null ? 1 : _sp.style.opacity,
  };
  _sp.draft = (_sp.tool === 'line' || _sp.tool === 'arrow')
    ? Object.assign(base, { x1: p0.x, y1: p0.y, x2: p0.x, y2: p0.y, double: false })
    : Object.assign(base, { x: p0.x, y: p0.y, w: 0, h: 0, rx: 0 });
  _sp.action = { type: 'shape', p0 };
}
function spShapeMove(wp, e, a) {
  const o = _sp.draft;
  if (!o) return;
  let p = _sp.grid.snap ? spSnapPoint(wp, _sp.grid.angle, _sp.grid.spacing) : wp;
  if (o.type === 'line' || o.type === 'arrow') {
    if (e.shiftKey) {                                   // 15° angle snapping
      const dx = p.x - a.p0.x, dy = p.y - a.p0.y;
      const q = Math.PI / 12;
      const ang = Math.round(Math.atan2(dy, dx) / q) * q;
      const len = Math.hypot(dx, dy);
      p = { x: a.p0.x + Math.cos(ang) * len, y: a.p0.y + Math.sin(ang) * len };
    }
    o.x2 = p.x; o.y2 = p.y;
  } else {
    let x = a.p0.x, y = a.p0.y, w = p.x - a.p0.x, h = p.y - a.p0.y;
    if (e.shiftKey) { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s; }
    if (e.altKey) { x -= w; y -= h; w *= 2; h *= 2; }   // draw from center
    const nb = spNormBox(x, y, w, h);
    o.x = nb.x; o.y = nb.y; o.w = nb.w; o.h = nb.h;
  }
  spInvalidate();
}
function spShapeUp(a) {
  const o = _sp.draft;
  _sp.draft = null;
  if (!o) return;
  const tiny = (o.type === 'line' || o.type === 'arrow')
    ? Math.hypot(o.x2 - o.x1, o.y2 - o.y1) < 3 / _sp.view.zoom
    : (o.w < 3 / _sp.view.zoom && o.h < 3 / _sp.view.zoom);
  if (tiny) {                                           // click = default-size shape (§11)
    if (o.type === 'line' || o.type === 'arrow') { o.x2 = o.x1 + 120; o.y2 = o.y1; }
    else { o.x -= 60; o.y -= 40; o.w = 120; o.h = 80; }
  }
  _sp.objects.push(o);
  _sp.sel.clear(); _sp.sel.add(o.id);
  spUpdateChrome(); spInvalidate(); spTouch();
}

// ── Polygon tool (click-to-vertex; Enter/dblclick/near-first-point commits) ─
function spPolygonDown(wp, e) {
  const p = _sp.grid.snap ? spSnapPoint(wp, _sp.grid.angle, _sp.grid.spacing) : { x: wp.x, y: wp.y };
  if (!_sp.draft || _sp.draft.type !== 'polygon') {
    _sp.draft = {
      id: spUid(), type: 'polygon', pts: [p], color: _sp.style.color, width: _sp.style.width,
      fill: _sp.style.fill || null, closed: false, rot: 0,
      opacity: _sp.style.opacity == null ? 1 : _sp.style.opacity,
    };
    spInvalidate();
    return;
  }
  const p0 = _sp.draft.pts[0];
  if (_sp.draft.pts.length >= 3 && Math.hypot(wp.x - p0.x, wp.y - p0.y) < 10 / _sp.view.zoom) {
    spCommitPolygon();                                  // clicked the start vertex
    return;
  }
  _sp.draft.pts.push(p);
  spInvalidate();
}
function spCommitPolygon() {
  const d = _sp.draft;
  _sp.draft = null; _sp.draftHover = null;
  if (!d) return;
  if ((d.pts || []).length >= 3) {
    spSnapshot();
    d.closed = true;
    _sp.objects.push(d);
    _sp.sel.clear(); _sp.sel.add(d.id);
    spTouch();
  }
  spUpdateChrome(); spInvalidate();
}
function spCancelPolygon() {
  _sp.draft = null; _sp.draftHover = null;
  spInvalidate();
}

// ── Select tool: handles / move / marquee ──────────────────────────────────
function spSelectDown(scr, wp, e) {
  const sel = spSelectedObjs();
  const qOnly = sel.length === 0 && _sp.sel.has(SP_Q_ID) && _sp.q.unlocked;
  const single = sel.length === 1 ? sel[0] : (qOnly ? { id: SP_Q_ID } : null);
  if (single && !e.shiftKey) {
    const hp = spSelHandlePts(single);
    const tol = 10 / _sp.view.zoom;
    if (single.id !== SP_Q_ID && Math.hypot(wp.x - hp.rot.x, wp.y - hp.rot.y) < tol) { spBeginRotate(single, hp, wp); return; }
    for (const k of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
      if (Math.hypot(wp.x - hp[k].x, wp.y - hp[k].y) < tol) { spBeginResize(single, hp, k, wp); return; }
    }
  }
  const hit = spHitTest(wp);
  if (hit) {
    if (e.shiftKey) { if (_sp.sel.has(hit.id)) _sp.sel.delete(hit.id); else _sp.sel.add(hit.id); }
    else if (!_sp.sel.has(hit.id)) { _sp.sel.clear(); _sp.sel.add(hit.id); }
    spBeginMove(wp, e);
  } else {
    const base = e.shiftKey ? new Set(_sp.sel) : new Set();
    if (!e.shiftKey) _sp.sel.clear();
    _sp.marquee = { x0: scr.x, y0: scr.y, x1: scr.x, y1: scr.y };
    _sp.action = { type: 'marquee', m: _sp.marquee, base };
  }
  spUpdateChrome(); spInvalidate();
}

function spBeginMove(wp, e) {
  spSnapshot();
  const items = spSelectedObjs().map(o => ({ id: o.id, orig: spCleanObj(o) }));
  const qMove = _sp.sel.has(SP_Q_ID);
  _sp.action = {
    type: 'move', start: wp, items, qMove,
    qOrig: qMove ? { x: _sp.q.x, y: _sp.q.y } : null,
    moved: false, axis: e.shiftKey,
  };
}
function spMoveUpdate(wp, a) {
  let dx = wp.x - a.start.x, dy = wp.y - a.start.y;
  if (a.axis) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }   // shift = axis lock
  if (_sp.grid.snap) {                                  // delta snapping respects grid rotation
    const sd = spSnapPoint({ x: dx, y: dy }, _sp.grid.angle, _sp.grid.spacing);
    dx = sd.x; dy = sd.y;
  }
  if (!a.moved && Math.hypot(dx, dy) < 1e-9) return;
  a.moved = true;
  for (const it of a.items) {
    const o = _sp.objects.find(x => x.id === it.id);
    if (!o) continue;
    Object.assign(o, spClone(it.orig));
    spTranslateObjData(o, dx, dy);
  }
  if (a.qMove) {
    _sp.q.x = a.qOrig.x + dx; _sp.q.y = a.qOrig.y + dy;
    spPositionQuestionLayer();
  }
  spInvalidate();
}

const SP_OPP_HANDLE = { nw: 'se', n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e' };
function spBeginResize(o, hp, key, wp) {
  spSnapshot();
  _sp.action = {
    type: 'resize', key, id: o.id, isQ: o.id === SP_Q_ID,
    orig: o.id === SP_Q_ID ? { x: _sp.q.x, y: _sp.q.y, w: _sp.q.w } : spCleanObj(o),
    anchor: hp[SP_OPP_HANDLE[key]],
    c: hp._c, rot: ((o.id === SP_Q_ID ? 0 : o.rot) || 0) * Math.PI / 180,
    origB: { x: hp._b.x, y: hp._b.y, w: hp._b.w, h: hp._b.h },
  };
}
function spResizeUpdate(wp, a, e) {
  const o = a.isQ ? { id: SP_Q_ID } : _sp.objects.find(x => x.id === a.id);
  if (!o) { _sp.action = null; return; }
  const c = a.c, rot = a.rot;
  const toLocal = p => {
    const dx = p.x - c.x, dy = p.y - c.y;
    return { x: dx * Math.cos(-rot) - dy * Math.sin(-rot), y: dx * Math.sin(-rot) + dy * Math.cos(-rot) };
  };
  const al = toLocal(a.anchor);
  const pl = toLocal(wp);
  const K = a.key;
  const sx = K.includes('e') ? 1 : K.includes('w') ? -1 : 0;
  const sy = K.includes('s') ? 1 : K.includes('n') ? -1 : 0;
  const horiz = sx !== 0, vert = sy !== 0;
  let nw = horiz ? (sx > 0 ? pl.x - al.x : al.x - pl.x) : a.origB.w;
  let nh = vert ? (sy > 0 ? pl.y - al.y : al.y - pl.y) : a.origB.h;
  const orig = a.orig;
  if (horiz && vert && e.shiftKey) {
    if (!a.isQ && orig.type === 'image' && origBPositive(a.origB)) {
      nh = nw * (a.origB.h / a.origB.w);                // image: preserve aspect
    } else {
      const s = Math.max(Math.abs(nw), Math.abs(nh));    // others: square
      nw = Math.sign(nw || 1) * s; nh = Math.sign(nh || 1) * s;
    }
  }
  nw = Math.max(4, nw); nh = Math.max(4, nh);
  const nl = { x: al.x + sx * nw / 2, y: al.y + sy * nh / 2 };
  const wc = { x: c.x + nl.x * Math.cos(rot) - nl.y * Math.sin(rot), y: c.y + nl.x * Math.sin(rot) + nl.y * Math.cos(rot) };
  const nb = { x: wc.x - nw / 2, y: wc.y - nh / 2, w: nw, h: nh };

  if (a.isQ) {                                           // question: width-only resize (§6)
    _sp.q.w = Math.max(160, Math.min(2400, nb.w));
    _sp.q.x = nb.x; _sp.q.y = nb.y;
    spMeasureQuestion();
    spPositionQuestionLayer();
    spInvalidate();
    return;
  }
  Object.assign(o, spClone(orig));
  const ob = a.origB;
  switch (o.type) {
    case 'text': {
      const vScale = vert ? nh / Math.max(1, ob.h) : 1;
      if (horiz && vert) o.fontSize = spClampFont((orig.fontSize || 20) * vScale);
      else if (vert) o.fontSize = spClampFont((orig.fontSize || 20) * vScale);
      if (horiz) o.w = Math.max(40, nb.w);
      o.x = nb.x; o.y = nb.y;
      break;
    }
    case 'image':
      o.x = nb.x; o.y = nb.y; o.w = nb.w; o.h = nb.h;
      break;
    case 'line': case 'arrow': {
      const fx = ob.w > 1e-6 ? nb.w / ob.w : 1, fy = ob.h > 1e-6 ? nb.h / ob.h : 1;
      o.x1 = nb.x + (orig.x1 - ob.x) * fx; o.y1 = nb.y + (orig.y1 - ob.y) * fy;
      o.x2 = nb.x + (orig.x2 - ob.x) * fx; o.y2 = nb.y + (orig.y2 - ob.y) * fy;
      break;
    }
    case 'stroke': case 'polygon': {
      const fx = ob.w > 1e-6 ? nb.w / ob.w : 1, fy = ob.h > 1e-6 ? nb.h / ob.h : 1;
      o.pts = (orig.pts || []).map(p => ({
        x: nb.x + (p.x - ob.x) * fx, y: nb.y + (p.y - ob.y) * fy,
        ...(typeof p.p === 'number' ? { p: p.p } : {}),
      }));
      break;
    }
    default:                                             // rect / ellipse / triangle
      o.x = nb.x; o.y = nb.y; o.w = nb.w; o.h = nb.h;
      break;
  }
  spInvalidate();
}
function origBPositive(b) { return b && b.w > 1e-6 && b.h > 1e-6; }
function spClampFont(f) { return Math.max(6, Math.min(400, Math.round(f * 10) / 10)); }

function spBeginRotate(o, hp, wp) {
  spSnapshot();
  _sp.action = {
    type: 'rotate', id: o.id, c: hp._c,
    origRot: o.rot || 0, orig: spCleanObj(o),
    startAng: Math.atan2(wp.y - hp._c.y, wp.x - hp._c.x) * 180 / Math.PI,
  };
}
function spRotateUpdate(wp, a, e) {
  const o = _sp.objects.find(x => x.id === a.id);
  if (!o) { _sp.action = null; return; }
  const ang = Math.atan2(wp.y - a.c.y, wp.x - a.c.x) * 180 / Math.PI;
  let nr = a.origRot + (ang - a.startAng);
  if (!e.altKey) nr = Math.round(nr / 15) * 15;          // 15° snap unless Alt (§16)
  o.rot = spNormAngle(nr);
  spInvalidate();
}

function spMarqueeUp(a) {
  const m = a.m;
  const s0 = spS2W({ x: Math.min(m.x0, m.x1), y: Math.min(m.y0, m.y1) });
  const s1 = spS2W({ x: Math.max(m.x0, m.x1), y: Math.max(m.y0, m.y1) });
  const box = { x: s0.x, y: s0.y, w: s1.x - s0.x, h: s1.y - s0.y };
  _sp.sel = new Set(a.base);
  if (box.w > 2 / _sp.view.zoom || box.h > 2 / _sp.view.zoom) {
    for (const o of _sp.objects) {
      if (o.hidden) continue;
      if (spIntersects(spBBoxOf(o), box)) _sp.sel.add(o.id);
    }
    if (_sp.q.unlocked && _sp.q.present && spIntersects({ x: _sp.q.x, y: _sp.q.y, w: _sp.q.w, h: _sp.q.h }, box))
      _sp.sel.add(SP_Q_ID);
  }
  _sp.marquee = null;
  spUpdateChrome(); spInvalidate();
}

// ── Double-click: edit text / commit polygon (spec §11/§26) ───────────────
function spOnDblClick(e) {
  if (!_sp.built || !_sp.open) return;
  const scr = spCanvasPt(e);
  const wp = spS2W(scr);
  if (_sp.draft && _sp.draft.type === 'polygon') {
    if (_sp.draft.pts.length > 1) _sp.draft.pts.pop();  // dblclick's 2nd down added one
    spCommitPolygon();
    return;
  }
  const hit = spHitTest(wp);
  if (hit && hit.id !== SP_Q_ID && hit.type === 'text' && (_sp.tool === 'select' || _sp.tool === 'text')) {
    _sp.sel.clear(); _sp.sel.add(hit.id);
    spOpenEditorFor(hit, false);
    spUpdateChrome(); spInvalidate();
  }
}

// ── Wheel: ctrl/meta = zoom at cursor, else pan (spec §27/§29) ────────────
function spOnWheel(e) {
  if (!_sp.built || !_sp.open) return;
  // Let the options popover and the text editor scroll/zoom natively.
  if (e.target && e.target.closest && (e.target.closest('.sp-popover') || e.target.closest('.sp-text-editor'))) return;
  e.preventDefault();
  const r = _sp.canvasWrap.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  const unit = e.deltaMode === 1 ? 16 : 1;
  if (e.ctrlKey || e.metaKey) {
    const f = Math.pow(0.995, e.deltaY * unit);
    _sp.view = spZoomAt(_sp.view, _sp.view.zoom * f, sx, sy);
  } else if (e.shiftKey) {
    _sp.view.x -= (e.deltaY || e.deltaX) * unit;
  } else {
    _sp.view.x -= e.deltaX * unit;
    _sp.view.y -= e.deltaY * unit;
  }
  spInvalidate(); spUpdateChrome(); spTouch();
}

// ── Text tool + in-place editor (spec §11) ─────────────────────────────────
function spTextDown(wp) {
  spSnapshot();                                          // before the object exists — empty commits unwind it
  const o = {
    id: spUid(), type: 'text', x: wp.x, y: wp.y, w: 240, text: '',
    fontSize: _sp.style.fontSize || 20, color: _sp.style.color,
    align: 'left', bold: false, italic: false, bg: null, rot: 0,
    opacity: _sp.style.opacity == null ? 1 : _sp.style.opacity,
  };
  _sp.objects.push(o);
  _sp.sel.clear(); _sp.sel.add(o.id);
  spOpenEditorFor(o, true);
}
function spOpenEditorFor(o, isNew) {
  if (!isNew) spSnapshot();                              // editing existing text: capture pre-edit state
  _sp.editing = { id: o.id, isNew: !!isNew };
  const ta = _sp.textarea;
  ta.value = o.text || '';
  ta.style.display = 'block';
  spPositionTextEditor();
  spAutosizeEditor();
  spInvalidate();
  // Deferred: the browser's default mousedown focus (canvas, tabindex=0)
  // lands AFTER this handler returns — focus() now would be overridden and
  // the typed text would hit the tool shortcuts instead of the editor.
  setTimeout(() => {
    if (!_sp.editing || _sp.editing.id !== o.id) return;
    try {
      ta.focus();
      const n = ta.value.length;
      if (ta.setSelectionRange) ta.setSelectionRange(n, n);
    } catch (e) {}
  }, 0);
}
function spPositionTextEditor() {
  if (!_sp.built) return;
  const ta = _sp.textarea;
  if (!_sp.editing) { ta.style.display = 'none'; return; }
  const o = _sp.objects.find(x => x.id === _sp.editing.id);
  if (!o) { ta.style.display = 'none'; _sp.editing = null; return; }
  const s = spW2S({ x: o.x, y: o.y });
  const z = _sp.view.zoom;
  ta.style.display = 'block';
  ta.style.left = s.x + 'px';
  ta.style.top = s.y + 'px';
  ta.style.width = Math.max(60, o.w * z) + 'px';
  ta.style.fontSize = Math.max(6, (o.fontSize || 20) * z) + 'px';
  ta.style.color = o.color;
  ta.style.fontWeight = o.bold ? '800' : '600';
  ta.style.fontStyle = o.italic ? 'italic' : 'normal';
  ta.style.transform = o.rot ? `rotate(${o.rot}deg)` : '';
}
function spAutosizeEditor() {
  if (!_sp.built || !_sp.editing) return;
  const ta = _sp.textarea;
  ta.style.height = 'auto';
  ta.style.height = (ta.scrollHeight || 40) + 10 + 'px';
}
function spCommitText() {
  if (!_sp.built || !_sp.editing) return;
  const info = _sp.editing;
  _sp.editing = null;
  _sp.textarea.style.display = 'none';
  const i = _sp.objects.findIndex(x => x.id === info.id);
  const o = i >= 0 ? _sp.objects[i] : null;
  if (o) o.text = _sp.textarea.value;
  if (!o || !String(o.text || '').trim()) {
    if (i >= 0) _sp.objects.splice(i, 1);
    _sp.sel.delete(info.id);
    if (info.isNew && _sp.hist && _sp.hist.canUndo) {
      // empty new text = nothing happened — unwind the creation snapshot
      const cur = spHistoryState();
      const pre = _sp.hist.undo(cur);
      if (pre != null) _sp.hist.redo(pre);
    }
  }
  spUpdateChrome(); spInvalidate(); spTouch();
}

// ── Clipboard / edit ops (spec §26: C/V/D/Delete/arrows) ──────────────────
function spCopy() {
  const sel = spSelectedObjs();
  if (!sel.length) return false;
  _sp.clipboard = sel.map(spCleanObj);
  return true;
}
function spPaste() {
  if (!_sp.built || !_sp.clipboard.length) return;
  spSnapshot();
  const off = 24 / _sp.view.zoom;
  const news = _sp.clipboard.map(o => {
    const n = spClone(o);
    n.id = spUid();
    spTranslateObjData(n, off, off);
    return n;
  });
  _sp.objects.push(...news);
  _sp.clipboard = news.map(spCleanObj);                 // successive pastes cascade
  _sp.sel.clear();
  news.forEach(n => _sp.sel.add(n.id));
  spUpdateChrome(); spInvalidate(); spTouch();
}
function spDuplicate() {
  const sel = spSelectedObjs();
  if (!sel.length) return;
  spSnapshot();
  const off = 12 / _sp.view.zoom;
  const news = sel.map(o => {
    const n = spClone(spCleanObj(o));
    n.id = spUid();
    spTranslateObjData(n, off, off);
    return n;
  });
  _sp.objects.push(...news);
  _sp.sel.clear();
  news.forEach(n => _sp.sel.add(n.id));
  spUpdateChrome(); spInvalidate(); spTouch();
}
function spDeleteSelection() {
  const sel = spSelectedObjs();
  const qSel = _sp.sel.has(SP_Q_ID);
  if (!sel.length && !qSel) return;
  if (sel.length) {
    spSnapshot();
    const ids = new Set(sel.map(o => o.id));
    _sp.objects = _sp.objects.filter(o => !ids.has(o.id));
  }
  _sp.sel.clear();
  spUpdateChrome(); spInvalidate(); spTouch();
}
function spSelectAll() {
  _sp.sel.clear();
  _sp.objects.forEach(o => _sp.sel.add(o.id));
  if (_sp.q.unlocked && _sp.q.present) _sp.sel.add(SP_Q_ID);
  spUpdateChrome(); spInvalidate();
}
function spArrange(mode) {
  const sel = spSelectedObjs();
  if (!sel.length) return;
  spSnapshot();
  const ids = new Set(sel.map(o => o.id));
  if (mode === 'front' || mode === 'back') {
    const rest = _sp.objects.filter(o => !ids.has(o.id));
    _sp.objects = mode === 'front' ? rest.concat(sel) : sel.concat(rest);
  } else {
    const arr = _sp.objects;
    if (mode === 'forward') {
      for (let i = arr.length - 2; i >= 0; i--) {
        if (ids.has(arr[i].id) && !ids.has(arr[i + 1].id)) { const t = arr[i]; arr[i] = arr[i + 1]; arr[i + 1] = t; }
      }
    } else {                                             // 'backward'
      for (let i = 1; i < arr.length; i++) {
        if (ids.has(arr[i].id) && !ids.has(arr[i - 1].id)) { const t = arr[i]; arr[i] = arr[i - 1]; arr[i - 1] = t; }
      }
    }
  }
  spInvalidate(); spTouch();
}
function spNudge(dx, dy) {
  const sel = spSelectedObjs();
  const qSel = _sp.sel.has(SP_Q_ID) && _sp.q.unlocked;
  if (!sel.length && !qSel) return;
  const now = Date.now();
  if (!(now - (_sp.lastNudge || 0) < 700)) spSnapshot(); // coalesce held-arrow bursts
  _sp.lastNudge = now;
  sel.forEach(o => spTranslateObjData(o, dx, dy));
  if (qSel) { _sp.q.x += dx; _sp.q.y += dy; spPositionQuestionLayer(); }
  spInvalidate(); spTouch();
}

// ── Image insertion (spec §13) ─────────────────────────────────────────────
function spInsertImageFile(file) {
  if (!file || !/^image\//.test(file.type || '')) { showToast('That file is not an image', 2200); return; }
  const fr = new FileReader();
  fr.onload = () => {
    const src = String(fr.result || '');
    const img = new Image();
    img.onload = () => {
      const natW = img.naturalWidth || 300, natH = img.naturalHeight || 200;
      const scale = Math.min(1, 320 / natW);
      const w = natW * scale, h = natH * scale;
      const cWorld = spS2W({ x: (_sp.vw || 0) / 2, y: (_sp.vh || 0) / 2 });
      spSnapshot();
      const o = {
        id: spUid(), type: 'image', src, x: cWorld.x - w / 2, y: cWorld.y - h / 2,
        w, h, rot: 0, opacity: 1,
      };
      _sp.imgCache[src] = img;
      _sp.objects.push(o);
      _sp.sel.clear(); _sp.sel.add(o.id);
      spSetTool('select');
      spUpdateChrome(); spInvalidate(); spTouch();
      showToast('Image inserted — drag the handles to resize', 2200);
    };
    img.onerror = () => showToast('Could not load that image', 2500);
    img.src = src;
  };
  fr.onerror = () => showToast('Could not read that file', 2500);
  fr.readAsDataURL(file);
}

// ── Popovers (More menu + zoom presets) ────────────────────────────────────
function spShowPopover(anchor, buildFn) {
  spClosePopovers();
  const pop = _sp.popover;
  buildFn(pop);
  pop.classList.add('sp-open');
  const wrapW = _sp.canvasWrap.getBoundingClientRect().width || 600;
  if (anchor && anchor.getBoundingClientRect) {
    const aR = anchor.getBoundingClientRect();
    const wR = _sp.canvasWrap.getBoundingClientRect();
    pop.style.right = 'auto';
    pop.style.left = Math.max(8, Math.min(wrapW - 290, aR.left - wR.left - 110)) + 'px';
  } else { pop.style.left = 'auto'; pop.style.right = '8px'; }
  pop.style.bottom = '8px';
  _sp.popAnchor = anchor || null;
  _sp.popBuild = buildFn;
}
function spRefreshPopover() {
  if (_sp.built && _sp.popBuild && _sp.popover.classList.contains('sp-open'))
    spShowPopover(_sp.popAnchor, _sp.popBuild);
}
function spClosePopovers() {
  if (!_sp.built) return;
  _sp.popover.classList.remove('sp-open');
  _sp.popover.innerHTML = '';
  _sp.popBuild = null; _sp.popAnchor = null; _sp.popKind = null;
  try { document.querySelectorAll('.cp-popover').forEach(p => p.remove()); } catch (e) {}
}
function spPopSection(title) {
  const d = el('div', { class: 'sp-pop-section' });
  if (title) d.appendChild(el('div', { class: 'sp-pop-title' }, title));
  for (let i = 1; i < arguments.length; i++) if (arguments[i]) d.appendChild(arguments[i]);
  return d;
}
function spMiniBtn(label, opts) {
  const o = opts || {};
  const attrs = { type: 'button', class: 'sp-mini-btn' + (o.danger ? ' danger' : '') + (o.active ? ' active' : ''), onclick: o.onclick };
  if (o.aria) attrs['aria-label'] = o.aria;
  if (o.title) attrs.title = o.title;
  if (o.toggle !== undefined) attrs['aria-pressed'] = String(!!o.toggle);
  if (o.disabled) attrs.disabled = 'true';
  return el('button', attrs, label);
}
function spSliderRow(label, min, max, step, value, oninput, fmt) {
  const val = el('span', { class: 'sp-slider-val' }, fmt ? fmt(value) : String(value));
  const inp = el('input', {
    type: 'range', min: String(min), max: String(max), step: String(step), value: String(value),
    'aria-label': label,
    oninput: e => { const v = Number(e.target.value); val.textContent = fmt ? fmt(v) : String(v); oninput(v); },
  });
  return el('div', { class: 'sp-row' }, el('span', { class: 'sp-row-label' }, label), inp, val);
}

/** The ⋯ menu — style, grid & background, question lock, arrange, export,
 *  clear/reset, help (spec §18/§22/§23/§25). */
function spShowMorePopover(anchor) {
  if (!_sp.built) return;
  _sp.popKind = 'more';
  spShowPopover(anchor || null, pop => {
    // ── Style ──
    const swatches = el('div', { class: 'sp-row sp-swatches' });
    for (const c of SP_SWATCHES) {
      swatches.appendChild(el('button', {
        type: 'button', class: 'sp-swatch' + (_sp.style.color.toLowerCase() === c.toLowerCase() ? ' active' : ''),
        'aria-label': 'Drawing color ' + c, title: c, style: `background:${c}`,
        onclick: () => { spStylePatch({ color: c }); spRefreshPopover(); },
      }));
    }
    const widthRow = el('div', { class: 'sp-row' }, el('span', { class: 'sp-row-label' }, 'Stroke'));
    for (const w of SP_WIDTHS) {
      widthRow.appendChild(spMiniBtn(String(w), {
        aria: `Stroke width ${w}px`, active: _sp.style.width === w,
        onclick: () => { spStylePatch({ width: w }); spRefreshPopover(); },
      }));
    }
    widthRow.appendChild(spMiniBtn('🎨', {
      aria: 'Custom color', title: 'Custom color',
      onclick: () => spPickColor(_sp.popover, c => { spStylePatch({ color: c }); spRefreshPopover(); }),
    }));
    const fillRow = el('div', { class: 'sp-row' }, el('span', { class: 'sp-row-label' }, 'Fill'),
      spMiniBtn('None', { active: !_sp.style.fill, onclick: () => { spStylePatch({ fill: null }); spRefreshPopover(); } }),
      spMiniBtn('Color', { active: !!_sp.style.fill, onclick: () => { spStylePatch({ fill: _sp.style.color }); spRefreshPopover(); } }));
    const fontRow = el('div', { class: 'sp-row' }, el('span', { class: 'sp-row-label' }, 'Text'),
      spMiniBtn('A−', { aria: 'Smaller font', onclick: () => { spStylePatch({ fontSize: spClampFont((_sp.style.fontSize || 20) - 2) }); spRefreshPopover(); } }),
      el('span', { class: 'sp-slider-val' }, String(Math.round(_sp.style.fontSize || 20))),
      spMiniBtn('A+', { aria: 'Larger font', onclick: () => { spStylePatch({ fontSize: spClampFont((_sp.style.fontSize || 20) + 2) }); spRefreshPopover(); } }),
      spMiniBtn('B', { aria: 'Bold', active: !!_sp.style.bold, onclick: () => { spStylePatch({ bold: !_sp.style.bold }); spRefreshPopover(); } }),
      spMiniBtn('I', { aria: 'Italic', active: !!_sp.style.italic, onclick: () => { spStylePatch({ italic: !_sp.style.italic }); spRefreshPopover(); } }));
    const opacityRow = spSliderRow('Opacity', 10, 100, 5, Math.round((_sp.style.opacity == null ? 1 : _sp.style.opacity) * 100),
      v => { spStylePatch({ opacity: v / 100 }); }, v => v + '%');
    const eraserRow = spSliderRow('Eraser size', 4, 60, 2, _sp.style.eraserSize || SP_DEFAULTS.eraserSize,
      v => { _sp.style.eraserSize = v; spTouch(); spInvalidate(); }, v => v + 'px');
    pop.appendChild(spPopSection('Style', swatches, widthRow, fillRow, fontRow, opacityRow, eraserRow));

    // ── Grid & background (spec §9) ──
    const bgSel = el('select', {
      class: 'sp-field', 'aria-label': 'Background style',
      onchange: e => { _sp.grid.style = e.target.value; spInvalidate(); spTouch(); },   // pad-local: defaults live in Settings (§32)
    });
    for (const b of SP_BG_STYLES) {
      const opt = el('option', { value: b.id }, b.label);
      if (b.id === _sp.grid.style) opt.selected = true;
      bgSel.appendChild(opt);
    }
    const angleRow = el('div', { class: 'sp-row' }, el('span', { class: 'sp-row-label' }, 'Angle'));
    const angleVal = el('span', { class: 'sp-slider-val' }, Math.round(_sp.grid.angle) + '°');
    const angleNum = el('input', {
      type: 'number', class: 'sp-field sp-angle-num', min: '0', max: '359', step: '1',
      value: String(Math.round(_sp.grid.angle)), 'aria-label': 'Grid rotation degrees',
      onchange: e => { spSetGridAngle(Number(e.target.value)); spRefreshPopover(); },
    });
    angleRow.appendChild(el('input', {
      type: 'range', min: '0', max: '359', step: '1', value: String(Math.round(_sp.grid.angle)),
      'aria-label': 'Grid rotation slider',
      oninput: e => { spSetGridAngle(Number(e.target.value)); angleVal.textContent = Math.round(_sp.grid.angle) + '°'; angleNum.value = String(Math.round(_sp.grid.angle)); },
    }));
    angleRow.append(angleVal, angleNum);
    const anglePresets = el('div', { class: 'sp-row' }, el('span', { class: 'sp-row-label' }, ''));
    for (const a of [0, 15, 30, 45, 60, 90]) {
      anglePresets.appendChild(spMiniBtn(a + '°', {
        active: Math.round(_sp.grid.angle) === a,
        onclick: () => { spSetGridAngle(a); spRefreshPopover(); },
      }));
    }
    anglePresets.appendChild(spMiniBtn('↺', { aria: 'Reset grid rotation', title: 'Reset rotation', onclick: () => { spSetGridAngle(0); spRefreshPopover(); } }));
    const spacingRow = spSliderRow('Spacing', 8, 96, 2, _sp.grid.spacing,
      v => { _sp.grid.spacing = v; spInvalidate(); spTouch(); }, v => v + 'px');
    const gridOpRow = spSliderRow('Grid opacity', 10, 100, 5, Math.round(_sp.grid.opacity * 100),
      v => { _sp.grid.opacity = v / 100; spInvalidate(); spTouch(); }, v => v + '%');
    const gridToggles = el('div', { class: 'sp-row' },
      spMiniBtn('Show grid', { toggle: _sp.grid.visible, onclick: () => { _sp.grid.visible = !_sp.grid.visible; spUpdateChrome(); spInvalidate(); spTouch(); spRefreshPopover(); } }),
      spMiniBtn('Snap', { toggle: _sp.grid.snap, onclick: () => { _sp.grid.snap = !_sp.grid.snap; spInvalidate(); spTouch(); spRefreshPopover(); } }));
    pop.appendChild(spPopSection('Grid & background', bgSel, angleRow, anglePresets, spacingRow, gridOpRow, gridToggles));

    // ── Question layer (spec §6) ──
    if (_sp.q.present) {
      pop.appendChild(spPopSection('Question',
        el('div', { class: 'sp-row' },
          spMiniBtn(_sp.q.unlocked ? '🔓 Unlocked' : '🔒 Locked', {
            toggle: _sp.q.unlocked, aria: 'Toggle question layer lock',
            onclick: () => {
              _sp.q.unlocked = !_sp.q.unlocked;
              if (!_sp.q.unlocked) _sp.sel.delete(SP_Q_ID);
              spInvalidate(); spTouch(); spRefreshPopover();
            },
          }),
          spMiniBtn('Re-center', { aria: 'Re-center question', onclick: () => { spResetView(); spClosePopovers(); } }))));
    }

    // ── Arrange (only with a selection) ──
    if (spSelectedObjs().length) {
      pop.appendChild(spPopSection('Arrange',
        el('div', { class: 'sp-row' },
          spMiniBtn('⬆ Front', { onclick: () => { spArrange('front'); spRefreshPopover(); } }),
          spMiniBtn('↑ Forward', { onclick: () => { spArrange('forward'); spRefreshPopover(); } }),
          spMiniBtn('↓ Backward', { onclick: () => { spArrange('backward'); spRefreshPopover(); } }),
          spMiniBtn('⬇ Back', { onclick: () => { spArrange('back'); spRefreshPopover(); } }))));
    }

    // ── Export (spec §23) ──
    pop.appendChild(spPopSection('Export',
      el('div', { class: 'sp-row' },
        spMiniBtn('PNG', { onclick: () => { spClosePopovers(); spExportPNG(); } }),
        spMiniBtn('SVG', { onclick: () => { spClosePopovers(); spExportSVG(); } }),
        spMiniBtn('JSON', { onclick: () => { spClosePopovers(); spExportJSON(); } }),
        spMiniBtn('📋 Copy', { aria: 'Copy to clipboard', onclick: () => { spClosePopovers(); spExportClipboard(); } }))));

    // ── Clear & reset (spec §25) ──
    pop.appendChild(spPopSection('Clear & reset',
      el('div', { class: 'sp-row' },
        spMiniBtn('🧹 Clear pad', { danger: true, onclick: () => { spClosePopovers(); spClearPad(); } }),
        spMiniBtn('Reset view', { onclick: () => { spResetView(); spClosePopovers(); } }),
        spMiniBtn('Fit content', { onclick: () => { spFitAll(); spClosePopovers(); } }),
        spMiniBtn('100%', { aria: 'Zoom to 100 percent', onclick: () => { spSetZoom(1); spClosePopovers(); } }))));

    // ── Help (spec §26 cheat sheet) ──
    const help = el('details', { class: 'sp-pop-section sp-help' });
    help.appendChild(el('summary', {}, '⌨️ Keyboard shortcuts'));
    const rows = [
      ['Ctrl/⌘+Alt+S', 'open / close scratchpad'], ['Esc', 'close (or cancel current action)'],
      ['V H T P M E', 'select pan text pen highlighter eraser'], ['L A R O U I', 'line arrow rect ellipse polygon image'],
      ['Ctrl+Z / Ctrl+Shift+Z', 'undo / redo'], ['Ctrl+C / V / D', 'copy / paste / duplicate'],
      ['Delete', 'remove selection'], ['Arrows (+Shift ×10)', 'nudge selection'],
      ['Space (hold)', 'temporary pan tool'], ['Shift while drawing', 'constrain (square / 15° / axis)'],
      ['Alt while drawing', 'from center'], ['Alt while rotating', 'free angle (no 15° snap)'],
      ['Two fingers', 'pan + pinch-zoom + twist rotates the grid'],
    ];
    for (const [k, d] of rows) {
      help.appendChild(el('div', { class: 'sp-help-row' }, el('kbd', {}, k), el('span', {}, d)));
    }
    pop.appendChild(help);
  });
}
function spSetGridAngle(a) {
  _sp.grid.angle = spNormAngle(a);
  spInvalidate(); spTouch();
}

function spShowZoomPresets(anchor) {
  if (!_sp.built) return;
  _sp.popKind = 'zoom';
  spShowPopover(anchor, pop => {
    const cur = Math.round(_sp.view.zoom * 100);
    const row = el('div', { class: 'sp-row sp-zoom-presets' });
    for (const p of [10, 25, 50, 75, 100, 150, 200, 400, 1000]) {
      row.appendChild(spMiniBtn(p + '%', { active: cur === p, onclick: () => { spSetZoom(p / 100); spClosePopovers(); } }));
    }
    pop.appendChild(spPopSection('Zoom', row,
      el('div', { class: 'sp-row' },
        spMiniBtn('Fit content', { onclick: () => { spFitAll(); spClosePopovers(); } }),
        spMiniBtn('Re-center', { onclick: () => { spCenterView(); spClosePopovers(); } }))));
  });
}

// ── Context menu (right-click / long-press — spec §26) ─────────────────────
function spOnContextMenu(e) {
  if (!_sp.built || !_sp.open) return;
  e.preventDefault();
  const r = _sp.canvasWrap.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const hit = spHitTest(spS2W({ x, y }));
  if (hit && !_sp.sel.has(hit.id)) { _sp.sel.clear(); _sp.sel.add(hit.id); spUpdateChrome(); spInvalidate(); }
  spOpenCtxMenuAt(x, y, hit);
}
function spOpenCtxMenuAt(x, y, hit) {
  if (!_sp.built) return;
  const m = _sp.ctxMenu;
  m.innerHTML = '';
  const item = (label, fn, opts) => {
    const o = opts || {};
    const attrs = { type: 'button', class: 'sp-ctx-item' + (o.danger ? ' danger' : ''), role: 'menuitem', onclick: () => { spCloseCtxMenu(); fn(); } };
    if (o.disabled) attrs.disabled = 'true';
    m.appendChild(el('button', attrs, label));
  };
  const sep = () => m.appendChild(el('div', { class: 'sp-ctx-sep' }));
  const hasSel = spSelectedObjs().length > 0;
  const selText = spSelectedObjs().filter(o => o.type === 'text');
  if (hasSel || hit) {
    item('📋 Copy', () => spCopy());
    item('📄 Duplicate', () => spDuplicate());
    if (selText.length === 1) item('✏️ Edit text', () => spOpenEditorFor(selText[0], false));
    item('⬆ Bring to front', () => spArrange('front'));
    item('⬇ Send to back', () => spArrange('back'));
    item('🗑 Delete', () => spDeleteSelection(), { danger: true });
    sep();
  }
  item('📥 Paste', () => spPaste(), { disabled: !_sp.clipboard.length });
  item('Select all', () => spSelectAll());
  sep();
  item('⌖ Return to center', () => spCenterView());
  item('⤢ Fit content', () => spFitAll());
  item('🔍 Zoom 100%', () => spSetZoom(1));
  sep();
  item('🧹 Clear pad…', () => spClearPad(), { danger: true });
  // ctxMenu lives on document.body → position:fixed in viewport coords.
  const wR = _sp.canvasWrap.getBoundingClientRect();
  m.style.display = 'block';
  const mw = m.offsetWidth || 200, mh = m.offsetHeight || 320;
  m.style.left = Math.max(4, Math.min(wR.left + x, (window.innerWidth || 800) - mw - 8)) + 'px';
  m.style.top = Math.max(4, Math.min(wR.top + y, (window.innerHeight || 600) - mh - 8)) + 'px';
}
function spCloseCtxMenu() {
  if (_sp.ctxMenu) _sp.ctxMenu.style.display = 'none';
}

// ── Clear / reset (spec §25) ───────────────────────────────────────────────
function spClearPad() {
  if (!_sp.built || !_sp.open) return;
  if (!_sp.objects.length) { showToast('The pad is already empty', 1600); return; }
  if (spSettings().confirmClear && !window.confirm('Clear the entire scratchpad for this question?')) return;
  spSnapshot();
  _sp.objects = [];
  _sp.sel.clear(); _sp.draft = null; _sp.draftHover = null; _sp.marquee = null;
  if (_sp.editing) { _sp.editing = null; _sp.textarea.style.display = 'none'; }
  spUpdateChrome(); spInvalidate(); spTouch();
  showToast('Scratchpad cleared — Ctrl+Z restores it', 2200);
}

// ── Exports (spec §23) ─────────────────────────────────────────────────────
// Content bbox = drawings ∪ question. The question is rendered into exports
// as plain text + its <img> graphics (documented deviation: no KaTeX font
// embedding — math still exports, just as linearized unicode text).
function spContentBBox() {
  const boxes = [];
  const bObj = spObjectsBBox(_sp.objects);
  if (bObj) boxes.push(bObj);
  if (_sp.q.present) boxes.push({ x: _sp.q.x, y: _sp.q.y, w: _sp.q.w, h: Math.max(24, _sp.q.h) });
  return spUnionBoxes(boxes) || { x: -200, y: -100, w: 400, h: 200 };
}
/** hex color -> rgba() string (theme tokens are hex; canvas/SVG want alpha). */
function spRgba(hex, a) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(hex || '').trim());
  if (!m) return `rgba(91,206,250,${a})`;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
}
function spExportName(ext) {
  let base = 'scratchpad';
  if (_sp.card && _sp.card.id) base += '-' + String(_sp.card.id).slice(0, 12);
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${base}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.${ext}`;
}
function spDownload(name, blobOrUrl) {
  try {
    const a = document.createElement('a');
    a.href = blobOrUrl;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); }, 400);
    showToast('Exported ' + name, 2200);
  } catch (e) { showToast('Export failed: ' + (e && e.message || e), 3000); }
}

function spExportPNG() {
  if (!_sp.built) return;
  const b = spContentBBox();
  const padW = 24, scale = 2;                             // 2× for crisp exports
  const W = Math.max(64, Math.ceil((b.w + padW * 2) * scale));
  const H = Math.max(64, Math.ceil((b.h + padW * 2) * scale));
  const cv = document.createElement('canvas');
  cv.width = Math.min(6000, W); cv.height = Math.min(8000, H);
  const ctx = cv.getContext('2d');
  if (!ctx) { showToast('PNG export is unavailable in this browser', 3000); return; }
  const s = Math.min(cv.width / W, cv.height / H) * scale;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.fillStyle = _sp.paper || '#0B0F14';                     // what-you-see paper (theme bg)
  ctx.fillRect(b.x - padW, b.y - padW, cv.width / s, cv.height / s);
  ctx.translate(-(b.x - padW), -(b.y - padW));
  spDrawQuestionToExportCtx(ctx);
  for (const o of _sp.objects) { if (!o.hidden) spDrawObject(ctx, o); }
  try {
    cv.toBlob(blob => {
      if (!blob) { showToast('PNG export failed', 3000); return; }
      const url = URL.createObjectURL(blob);
      spDownload(spExportName('png'), url);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, 'image/png');
  } catch (e) { showToast('PNG export failed: ' + e.message, 3000); }
}

/** Draw the question layer into an export context as plain text + images. */
function spDrawQuestionToExportCtx(ctx) {
  if (!_sp.q.present) return;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  spRoundRectPath(ctx, _sp.q.x, _sp.q.y, _sp.q.w, Math.max(24, _sp.q.h), 14);
  ctx.fill();
  ctx.strokeStyle = spRgba(_sp.accent, 0.35);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const inner = _sp.qLayer.firstElementChild;
  let y = _sp.q.y + 14;
  if (inner) {
    const label = inner.querySelector && inner.querySelector('.sp-q-label');
    if (label) {
      ctx.fillStyle = _sp.accent || '#5BCEFA';
      ctx.font = '700 11px Nunito, system-ui, sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(String(label.textContent || 'QUESTION'), _sp.q.x + 16, y);
      y += 18;
    }
    const imgs = (inner.querySelectorAll && inner.querySelectorAll('img')) || [];
    for (const im of imgs) {
      const natW = im.naturalWidth || 240, natH = im.naturalHeight || 160;
      const w = Math.min(_sp.q.w - 32, natW), h = w * natH / natW;
      try { ctx.drawImage(im, _sp.q.x + 16, y, w, h); } catch (e) {}
      y += h + 10;
    }
    const txt = inner.querySelector && inner.querySelector('.sp-q-text');
    const text = String((txt && txt.textContent) || '');
    if (text.trim()) {
      ctx.fillStyle = _sp.inkText || '#FFFFFF';
      ctx.font = '600 15px Nunito, system-ui, sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      const lines = spWrapText(text, _sp.q.w - 32, str => ctx.measureText(str).width);
      for (const ln of lines) { ctx.fillText(ln, _sp.q.x + 16, y); y += 21; }
    }
  }
  ctx.restore();
}

function spExportSVG() {
  if (!_sp.built) return;
  const b = spContentBBox();
  const padW = 24;
  const vx = b.x - padW, vy = b.y - padW, vw = b.w + padW * 2, vh = b.h + padW * 2;
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx.toFixed(1)} ${vy.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}" width="${Math.round(vw)}" height="${Math.round(vh)}">`);
  out.push(`<rect x="${vx.toFixed(1)}" y="${vy.toFixed(1)}" width="${vw.toFixed(1)}" height="${vh.toFixed(1)}" fill="${esc(_sp.paper || '#0B0F14')}"/>`);
  // Question layer → text lines + images (same simplification as PNG).
  if (_sp.q.present) {
    const qy = _sp.q.y, qw = _sp.q.w, qh = Math.max(24, _sp.q.h);
    out.push(`<g>`);
    out.push(`<rect x="${_sp.q.x}" y="${qy}" width="${qw}" height="${qh}" rx="14" fill="rgba(255,255,255,0.045)" stroke="${spRgba(_sp.accent, 0.35)}" stroke-width="1.5"/>`);
    out.push(`<text x="${_sp.q.x + 16}" y="${qy + 22}" fill="${esc(_sp.accent || '#5BCEFA')}" font-family="Nunito, system-ui, sans-serif" font-size="11" font-weight="700">QUESTION</text>`);
    let ty = qy + 40;
    const inner = _sp.qLayer.firstElementChild;
    if (inner) {
      const imgs = (inner.querySelectorAll && inner.querySelectorAll('img')) || [];
      for (const im of imgs) {
        const natW = im.naturalWidth || 240, natH = im.naturalHeight || 160;
        const w = Math.min(qw - 32, natW), h = w * natH / natW;
        out.push(`<image href="${esc(im.src || '')}" x="${_sp.q.x + 16}" y="${ty}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" preserveAspectRatio="none"/>`);
        ty += h + 10;
      }
      const txt = inner.querySelector && inner.querySelector('.sp-q-text');
      const text = String((txt && txt.textContent) || '');
      const lines = spWrapText(text, qw - 32, str => str.length * 7.6);
      for (const ln of lines) { out.push(`<text x="${_sp.q.x + 16}" y="${ty + 12}" fill="${esc(_sp.inkText || '#FFFFFF')}" font-family="Nunito, system-ui, sans-serif" font-size="15" font-weight="600">${esc(ln)}</text>`); ty += 21; }
    }
    out.push(`</g>`);
  }
  for (const o of _sp.objects) {
    if (o.hidden) continue;
    const rotA = o.rot ? (() => { const bb = spBBoxOf(o); return ` transform="rotate(${o.rot} ${(bb.x + bb.w / 2).toFixed(2)} ${(bb.y + bb.h / 2).toFixed(2)})"`; })() : '';
    const alpha = (o.type === 'stroke' && o.hl) ? 0.4 * (o.opacity == null ? 1 : o.opacity) : (o.opacity == null ? 1 : o.opacity);
    const op = alpha < 1 ? ` opacity="${alpha.toFixed(2)}"` : '';
    const sw = ` stroke="${esc(o.color)}" stroke-width="${o.width || 2}" stroke-linecap="round" stroke-linejoin="round"`;
    const fl = o.fill ? ` fill="${esc(o.fill)}"` : ' fill="none"';
    switch (o.type) {
      case 'stroke': {
        const pts = (o.pts || []).map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        if ((o.pts || []).length === 1) out.push(`<circle cx="${o.pts[0].x.toFixed(1)}" cy="${o.pts[0].y.toFixed(1)}" r="${Math.max(0.6, (o.width || 2) / 2).toFixed(1)}" fill="${esc(o.color)}"${op}${rotA}/>`);
        else out.push(`<polyline points="${pts}"${sw}${op}${rotA}/>`);
        break;
      }
      case 'line': out.push(`<line x1="${o.x1.toFixed(1)}" y1="${o.y1.toFixed(1)}" x2="${o.x2.toFixed(1)}" y2="${o.y2.toFixed(1)}"${sw}${op}${rotA}/>`); break;
      case 'arrow': {
        out.push(`<line x1="${o.x1.toFixed(1)}" y1="${o.y1.toFixed(1)}" x2="${o.x2.toFixed(1)}" y2="${o.y2.toFixed(1)}"${sw}${op}${rotA}/>`);
        const a = Math.atan2(o.y2 - o.y1, o.x2 - o.x1), size = Math.max(9, (o.width || 2) * 2.8);
        const p1 = [o.x2, o.y2];
        const p2 = [o.x2 - size * Math.cos(a - 0.42), o.y2 - size * Math.sin(a - 0.42)];
        const p3 = [o.x2 - size * Math.cos(a + 0.42), o.y2 - size * Math.sin(a + 0.42)];
        out.push(`<polygon points="${p1.concat(p2, p3).map(n => n.toFixed(1)).join(',')}" fill="${esc(o.color)}"${op}${rotA}/>`);
        break;
      }
      case 'rect': { const nb = spNormBox(o.x, o.y, o.w, o.h); out.push(`<rect x="${nb.x.toFixed(1)}" y="${nb.y.toFixed(1)}" width="${nb.w.toFixed(1)}" height="${nb.h.toFixed(1)}" rx="${o.rx || 0}"${fl}${sw}${op}${rotA}/>`); break; }
      case 'ellipse': { const nb = spNormBox(o.x, o.y, o.w, o.h); out.push(`<ellipse cx="${(nb.x + nb.w / 2).toFixed(1)}" cy="${(nb.y + nb.h / 2).toFixed(1)}" rx="${(nb.w / 2).toFixed(1)}" ry="${(nb.h / 2).toFixed(1)}"${fl}${sw}${op}${rotA}/>`); break; }
      case 'triangle': { const nb = spNormBox(o.x, o.y, o.w, o.h); const pts = `${(nb.x + nb.w / 2).toFixed(1)},${nb.y.toFixed(1)} ${nb.x.toFixed(1)},${(nb.y + nb.h).toFixed(1)} ${(nb.x + nb.w).toFixed(1)},${(nb.y + nb.h).toFixed(1)}`; out.push(`<polygon points="${pts}"${fl}${sw}${op}${rotA}/>`); break; }
      case 'polygon': {
        const pts = (o.pts || []).map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        if (o.closed) out.push(`<polygon points="${pts}"${fl}${sw}${op}${rotA}/>`);
        else out.push(`<polyline points="${pts}"${sw}${op}${rotA}/>`);
        break;
      }
      case 'text': {
        const fs = o.fontSize || 20;
        const lines = spWrapText(o.text, Math.max(20, o.w - 12), str => str.length * fs * 0.55);
        if (o.bg) { const nb = { x: o.x, y: o.y, w: o.w, h: lines.length * fs * 1.35 + 10 }; out.push(`<rect x="${nb.x}" y="${nb.y}" width="${nb.w}" height="${nb.h.toFixed(1)}" rx="8" fill="${esc(o.bg)}"${rotA}/>`); }
        const anchor = o.align === 'center' ? 'middle' : o.align === 'right' ? 'end' : 'start';
        const tx = o.align === 'center' ? o.x + o.w / 2 : o.align === 'right' ? o.x + o.w - 6 : o.x + 6;
        lines.forEach((ln, i) => { if (ln) out.push(`<text x="${tx.toFixed(1)}" y="${(o.y + 5 + fs + i * fs * 1.35).toFixed(1)}" fill="${esc(o.color)}" font-family="Nunito, system-ui, sans-serif" font-size="${fs}" font-weight="${o.bold ? 800 : 600}" font-style="${o.italic ? 'italic' : 'normal'}" text-anchor="${anchor}"${op}${rotA}>${esc(ln)}</text>`); });
        break;
      }
      case 'image': out.push(`<image href="${esc(o.src || '')}" x="${o.x.toFixed(1)}" y="${o.y.toFixed(1)}" width="${o.w.toFixed(1)}" height="${o.h.toFixed(1)}" preserveAspectRatio="none"${op}${rotA}/>`); break;
      default: break;
    }
  }
  out.push(`</svg>`);
  const blob = new Blob([out.join('\n')], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  spDownload(spExportName('svg'), url);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function spExportJSON() {
  if (!_sp.built) return;
  const blob = new Blob([spSerialize(spCurrentState())], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  spDownload(spExportName('json'), url);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function spExportClipboard() {
  if (!_sp.built) return;
  try {
    const b = spContentBBox();
    const padW = 24, scale = 2;
    const cv = document.createElement('canvas');
    cv.width = Math.min(6000, Math.ceil((b.w + padW * 2) * scale));
    cv.height = Math.min(8000, Math.ceil((b.h + padW * 2) * scale));
    const ctx = cv.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = _sp.paper || '#0B0F14';
    ctx.fillRect(b.x - padW, b.y - padW, cv.width / scale, cv.height / scale);
    ctx.translate(-(b.x - padW), -(b.y - padW));
    spDrawQuestionToExportCtx(ctx);
    for (const o of _sp.objects) { if (!o.hidden) spDrawObject(ctx, o); }
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    if (blob && navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
      showToast('Copied scratchpad image to the clipboard', 2200);
      return;
    }
    throw new Error('clipboard images unsupported');
  } catch (e) {
    // Fallback: the editable JSON state as text (still useful, documented).
    try {
      await navigator.clipboard.writeText(spSerialize(spCurrentState()));
      showToast('Image clipboard unavailable — copied the editable JSON state instead', 3200);
    } catch (e2) { showToast('Clipboard unavailable in this browser', 3000); }
  }
}

// ── Session lifecycle (spec §5/§20/§31) ────────────────────────────────────
/** The circular ✍️ button study.js drops into the session progress row. */
function spMakeOpenButton(card) {
  const b = el('button', {
    type: 'button', class: 'scratch-open-btn',
    'aria-label': 'open/close scratchpad', 'aria-pressed': String(_sp.open),
    'aria-expanded': String(_sp.open), 'aria-controls': 'scratch-panel',
    title: 'Scratchpad — Ctrl+Alt+S',
    onclick: () => spToggle(card),
  }, '✍️');
  if (!_sp.openBtns) _sp.openBtns = [];
  _sp.openBtns.push(b);
  return b;
}
function spUpdateOpenButtons() {
  for (const b of (_sp.openBtns || [])) {
    try {
      b.setAttribute('aria-pressed', String(_sp.open));
      b.setAttribute('aria-expanded', String(_sp.open));
    } catch (e) {}
  }
}

function spCurrentCard() {
  if (_sp.card) return _sp.card;
  try {
    if (typeof studySession !== 'undefined' && studySession && studySession.queue)
      return studySession.queue[studySession.idx] || null;
  } catch (e) {}
  return null;
}

function spOpen(card) {
  if (card && (!_sp.card || card.id !== _sp.boundCardId)) {
    _sp.card = card;
    _sp.boundCardId = card.id || null;
    _sp.pendingRestore = spReadSaved(card.id);
  }
  if (!_sp.built) spBuildPanel();
  if (_sp.open) return;
  _sp.open = true;
  _sp.panel.classList.add('sp-open');
  _sp.panel.setAttribute('aria-hidden', 'false');
  if (spSettings().fullscreen) spSetFullscreen(true);
  spResizeCanvases();
  // Reopening the SAME card keeps the live pad in memory (closing only hid
  // it) — only (re)prepare when the card changed or an autosave is waiting
  // (fresh page load mid-question). Otherwise the fresh-layout path would
  // wipe the in-memory drawing.
  if (_sp.qBuiltFor !== _sp.boundCardId || _sp.pendingRestore) spPrepareQuestion();
  else { spUpdateChrome(); spInvalidate(); }
  spSetToolSilent(_sp.tool);
  spUpdateOpenButtons();
  requestAnimationFrame(() => { spResizeCanvases(); spInvalidate(); });
  try { _sp.objCanvas.focus(); } catch (e) {}
}
/** Set the cursor for a tool without side effects (used on open / space-up). */
function spSetToolSilent(id) {
  const cursors = { select: 'default', pan: 'grab', text: 'text', eraser: 'none' };
  _sp.objCanvas.style.cursor = cursors[id] || 'crosshair';
}
function spClose() {
  if (!_sp.open) return;
  if (_sp.editing) spCommitText();
  spFlushSave();                                          // closing must not lose work
  _sp.open = false;
  _sp.action = null; _sp.draft = null; _sp.draftHover = null; _sp.marquee = null; _sp.gesture = null;
  _sp.pointers.clear();
  spClosePopovers(); spCloseCtxMenu();
  if (_sp.panel) {
    _sp.panel.classList.remove('sp-open');
    _sp.panel.setAttribute('aria-hidden', 'true');
  }
  spUpdateOpenButtons();
}
/** Circular-button / Ctrl+Alt+S entry point (spec §2/§26). */
function spToggle(card) {
  if (_sp.open) spClose();
  else spOpen(card || spCurrentCard());
}

/** study.js calls this right after it picks the card for a render. */
function spOnCardRender(card) {
  if (!card) return;
  _sp.openBtns = [];
  const isNewCard = _sp.boundCardId !== card.id;
  _sp.card = card;
  _sp.boundCardId = card.id || null;
  if (isNewCard) _sp.pendingRestore = spReadSaved(card.id);
  if (_sp.built && _sp.open) spPrepareQuestion();         // pad was open → rebind live
}
/** study.js calls this at the TOP of nextCard(): the question has been
 *  answered, so per spec §31 its scratchpad is destroyed right now. */
function spCardDone() {
  const doneId = _sp.boundCardId;
  // Clear bindings FIRST so spClose()'s flush-save can't resurrect the pad.
  _sp.card = null; _sp.boundCardId = null; _sp.pendingRestore = null;
  clearTimeout(_sp.saveTimer); _sp.saveTimer = null;
  if (_sp.editing) { _sp.editing = null; if (_sp.built) _sp.textarea.style.display = 'none'; }
  _sp.sel.clear(); _sp.draft = null; _sp.draftHover = null; _sp.marquee = null; _sp.action = null;
  if (_sp.open) spClose();
  spDeleteSaved(doneId);                                  // answered ⇒ pad is gone (§31)
  _sp.objects = [];
  if (_sp.hist) _sp.hist.clear();
}
function spSessionStart() {
  if (_sp.open) spClose();
  _sp.card = null; _sp.boundCardId = null; _sp.pendingRestore = null;
  clearTimeout(_sp.saveTimer); _sp.saveTimer = null;
  _sp.objects = []; _sp.sel.clear();
  _sp.editing = null; _sp.draft = null; _sp.draftHover = null; _sp.marquee = null; _sp.action = null;
  if (_sp.hist) _sp.hist.clear();
  spClearAllSaved();                                      // §31: session start wipes leftovers
}
function spSessionEnd() {
  _sp.card = null; _sp.boundCardId = null; _sp.pendingRestore = null;
  clearTimeout(_sp.saveTimer); _sp.saveTimer = null;
  if (_sp.open) spClose();
  _sp.objects = []; _sp.sel.clear();
  _sp.editing = null; _sp.draft = null; _sp.draftHover = null; _sp.marquee = null; _sp.action = null;
  if (_sp.hist) _sp.hist.clear();
  spClearAllSaved();                                      // §31: session end wipes every pad
}

// ── Keyboard (spec §26) ────────────────────────────────────────────────────
// Capture-phase so Escape/shortcuts reach us before the app-wide bubble
// handler in dashboard-core.js; we stopPropagation ONLY when we actually
// consumed the key (modals/palette keep priority — checked via DOM state).
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('keydown', function (e) {
    const key = e.key;
    // Global toggle: Ctrl+Alt+S / Cmd+Alt+S — works even with the pad closed.
    if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && typeof key === 'string' && key.toLowerCase() === 's') {
      e.preventDefault();
      e.stopPropagation();
      if (_sp.open) spClose();
      else spOpen(spCurrentCard());
      return;
    }
    if (!_sp.open || !_sp.built) return;
    if (typeof key !== 'string') return;
    const t = e.target;
    const editing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    const modalOpen = (() => {
      try { return !document.getElementById('modal-backdrop').classList.contains('hidden'); } catch (err) { return false; }
    })();
    const cmdOpen = (() => {
      try {
        const cb = document.getElementById('cmd-backdrop');
        return cb.classList.contains('show') || getComputedStyle(cb).display !== 'none';
      } catch (err) { return false; }
    })();
    if (modalOpen || cmdOpen) return;                     // let the app close those first

    if (key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (_sp.ctxMenu.style.display === 'block') { spCloseCtxMenu(); return; }
      if (_sp.popover.classList.contains('sp-open')) { spClosePopovers(); return; }
      if (_sp.editing) { spCommitText(); return; }
      if (_sp.draft && _sp.draft.type === 'polygon') { spCancelPolygon(); return; }
      if (_sp.fullscreen) { spSetFullscreen(false); return; }
      spClose();
      return;
    }
    if (editing) return;                                  // the rest needs canvas focus

    const mod = e.ctrlKey || e.metaKey;
    if (mod && typeof key === 'string' && key.toLowerCase() === 'z') {
      e.preventDefault(); e.stopPropagation();
      if (e.shiftKey) spRedo(); else spUndo();
      return;
    }
    if (mod && typeof key === 'string' && key.toLowerCase() === 'y') { e.preventDefault(); e.stopPropagation(); spRedo(); return; }
    if (mod && typeof key === 'string' && key.toLowerCase() === 'c') { e.preventDefault(); e.stopPropagation(); spCopy(); return; }
    if (mod && typeof key === 'string' && key.toLowerCase() === 'v') { e.preventDefault(); e.stopPropagation(); spPaste(); return; }
    if (mod && typeof key === 'string' && key.toLowerCase() === 'd') { e.preventDefault(); e.stopPropagation(); spDuplicate(); return; }
    if (mod && typeof key === 'string' && (key === '=' || key === '+') && e.altKey) { e.preventDefault(); spZoomStep(1.25); return; }
    if (mod && key === '-' && e.altKey) { e.preventDefault(); spZoomStep(1 / 1.25); return; }
    if (mod || e.altKey) return;                          // remaining bindings are plain keys

    if (key === ' ') {
      if (!_sp.spaceDown) {
        _sp.spaceDown = true;
        if (!_sp.action) _sp.objCanvas.style.cursor = 'grab';
      }
      e.preventDefault(); e.stopPropagation();
      return;
    }
    if (key === 'Delete' || key === 'Backspace') {
      if (spSelectedObjs().length || _sp.sel.has(SP_Q_ID)) { e.preventDefault(); e.stopPropagation(); spDeleteSelection(); }
      return;
    }
    if (key.startsWith('Arrow')) {
      if (spSelectedObjs().length || (_sp.sel.has(SP_Q_ID) && _sp.q.unlocked)) {
        e.preventDefault(); e.stopPropagation();
        const d = e.shiftKey ? 10 : 1;
        if (key === 'ArrowLeft') spNudge(-d, 0);
        else if (key === 'ArrowRight') spNudge(d, 0);
        else if (key === 'ArrowUp') spNudge(0, -d);
        else spNudge(0, d);
      }
      return;
    }
    if (key === 'Enter' && _sp.draft && _sp.draft.type === 'polygon') { e.preventDefault(); e.stopPropagation(); spCommitPolygon(); return; }
    if (typeof key === 'string' && key.length === 1) {
      const tool = SP_TOOLS.find(x => x.key && x.key === key.toLowerCase());
      if (tool) { e.preventDefault(); e.stopPropagation(); spSetTool(tool.id); }
    }
  }, true);

  window.addEventListener('keyup', function (e) {
    if (e.key === ' ' && _sp.spaceDown) {
      _sp.spaceDown = false;
      if (_sp.built) spSetToolSilent(_sp.tool);
    }
  });

  // Flush the pad before the page goes away (six-page build swaps pages).
  // Gated on window.SCIMA_PAGE exactly like bootstrap's persistence seams —
  // the extension build (single page, no SCIMA_PAGE) must not grow a
  // pagehide handler (harness S12); its debounce + close/done flushes cover it.
  if (window.SCIMA_PAGE) {
    window.addEventListener('pagehide', function () { try { spFlushSave(); } catch (e) {} });
  }
  window.addEventListener('visibilitychange', function () {
    try { if (document.visibilityState === 'hidden') spFlushSave(); } catch (e) {}
  });
}

// ── Harness / debug exposure ───────────────────────────────────────────────
// The node harness loads this file in a stub-DOM vm context where top-level
// function declarations DO become globals; this explicit copy keeps every
// entry point reachable no matter how the bundle is evaluated, and gives the
// browser console a tidy handle. Never touches the DOM at load time.
if (typeof window !== 'undefined') {
  Object.assign(window, {
    _sp, SP_DEFAULTS, SP_TOOLS, SP_BG_STYLES, SP_SWATCHES, SP_WIDTHS,
    SP_ZOOM_MIN, SP_ZOOM_MAX, SP_STORE_PREFIX, SP_Q_ID, SP_Q_WIDTH,
    spClampZoom, spZoomAt, spSnapPoint, spNormAngle, spNormBox, spBBoxOf,
    spObjectsBBox, spFitZoom, spMakeHistory, spWrapText, spSerialize, spParse,
    spDist2Seg, spInBox, spInPoly, spRotAround,
    spSettings, spSetting, spSetSetting,
    spToggle, spOpen, spClose, spMakeOpenButton, spUpdateOpenButtons,
    spOnCardRender, spCardDone, spSessionStart, spSessionEnd,
    spFlushSave, spCurrentState, spSetTool, spSetZoom, spUndo, spRedo,
    spSelectedObjs, spClearAllSaved,
  });
}
