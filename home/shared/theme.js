/* ═══════════════════════════════════════════════════════════════
   SCIMATracker — theme.js
   Theme tokens, presets, background patterns, the schedule resolver,
   and applyThemeVars() — the single source of truth for the app's
   colour palette. Extracted out of shared.js so that any surface
   sharing the mf_state origin (dashboard, community/app.js, etc.)
   can load just this file and apply the user's live theme without
   pulling in the rest of shared.js's XP/subject/storage logic.
   MUST load before shared.js and before anything that calls
   applyThemeVars() / resolveScheduledTheme().
═══════════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────────────────────
   THEME  (the few user-editable colour groups — Settings → Appearance)
   Every reused brand colour across dashboard.css/popup.css ultimately
   reads one of these CSS custom properties (see the "Theme tokens"
   comment at the top of dashboard.css). content.js/content.css have
   their own --mf-* copy (separate execution context, see ARCHITECTURE.md)
   but apply the *same* theme object via their own tiny inline version
   of applyThemeVars — keep both in sync if you add a new colour group.
───────────────────────────────────────────────────────────── */

const DEFAULT_THEME = {
  bg: '#0B0F14', surface: '#121A24', text: '#FFFFFF',
  muted: '#B8C7D9', blue: '#5BCEFA', pink: '#F5A9B8',
  borderColor: null,  // null = use default rgba(255,255,255,0.08)
  bgPattern: null,   // { type, opacity, scale, color } — see BG_PATTERNS below, null = solid colour
};

const THEME_PRESETS = {
  default:       { ...DEFAULT_THEME,                                                                                                    name: 'Default'        },
  midnight:      { bg:'#0A0A12', surface:'#15151F', text:'#FFFFFF', muted:'#A9A9C0', blue:'#8B7CF6', pink:'#F472B6',                   name: 'Midnight'       },
  mint:          { bg:'#0A1612', surface:'#102420', text:'#FFFFFF', muted:'#9FC9BC', blue:'#34D399', pink:'#A7F3D0',                   name: 'Mint'           },
  sunset:        { bg:'#1A0F0A', surface:'#241712', text:'#FFFFFF', muted:'#D9B8A9', blue:'#FB923C', pink:'#F87171',                   name: 'Sunset'         },
  light:         { bg:'#F0F4FA', surface:'#FFFFFF', text:'#111827', muted:'#6B7280', blue:'#2563EB', pink:'#DB2777',                   name: 'Light'          },
  paper:         { bg:'#F4F1EA', surface:'#FFFFFF', text:'#1F2937', muted:'#6B7280', blue:'#3B82F6', pink:'#EC4899',                   name: 'Paper'          },
  highcontrast:  { bg:'#000000', surface:'#111111', text:'#FFFFFF', muted:'#CCCCCC', blue:'#00FFFF', pink:'#FF69B4', bgPattern: null,  name: 'High Contrast'  },
};

/* ─────────────────────────────────────────────────────────────
   BACKGROUND PATTERNS
   Each pattern is an SVG fragment rendered as a data: URI
   and set as --bg-pattern on <html>. The fill colour is
   always currentColor (i.e. var(--text)) at `opacity` so it
   automatically adapts to light/dark. `scale` multiplies the
   tile size. Null bgPattern = plain solid bg (no image layer).
───────────────────────────────────────────────────────────── */
const BG_PATTERNS = {
  none:        { name: 'None (solid)',   svg: null },
  dots:        { name: 'Dots',
    svg: (op, sc, col) => `<svg xmlns='http://www.w3.org/2000/svg' width='${20*sc}' height='${20*sc}'><circle cx='${10*sc}' cy='${10*sc}' r='${1.4*sc}' fill='${col}' opacity='${op}'/></svg>` },
  grid:        { name: 'Grid',
    svg: (op, sc, col) => `<svg xmlns='http://www.w3.org/2000/svg' width='${24*sc}' height='${24*sc}'><path d='M${24*sc} 0H0V${24*sc}' fill='none' stroke='${col}' stroke-width='${0.5*sc}' opacity='${op}'/></svg>` },
  diagonal:    { name: 'Diagonal lines',
    svg: (op, sc, col) => `<svg xmlns='http://www.w3.org/2000/svg' width='${16*sc}' height='${16*sc}'><path d='M-1 1l2-2M0 ${16*sc}L${16*sc} 0M${16*sc-1} ${16*sc+1}l2-2' stroke='${col}' stroke-width='${0.8*sc}' opacity='${op}'/></svg>` },
  crosshatch:  { name: 'Crosshatch',
    svg: (op, sc, col) => `<svg xmlns='http://www.w3.org/2000/svg' width='${16*sc}' height='${16*sc}'><path d='M-1 1l2-2M0 ${16*sc}L${16*sc} 0M${16*sc-1} ${16*sc+1}l2-2' stroke='${col}' stroke-width='${0.5*sc}' opacity='${op}'/><path d='M${16*sc+1} 1l-2-2M${16*sc} ${16*sc}L0 0M1 ${16*sc+1}l-2-2' stroke='${col}' stroke-width='${0.5*sc}' opacity='${op}'/></svg>` },
  hexagons:    { name: 'Hexagons',
    svg: (op, sc, col) => { const s=14*sc, h=s*Math.sqrt(3)/2, cw=1.5*s; return `<svg xmlns='http://www.w3.org/2000/svg' width='${cw}' height='${h*2}'><polygon points='${s*0.5},0 ${s*1.5},0 ${2*s},${h} ${s*1.5},${2*h} ${s*0.5},${2*h} 0,${h}' fill='none' stroke='${col}' stroke-width='${0.6*sc}' opacity='${op}'/></svg>`; } },
  topography:  { name: 'Topography',
    svg: (op, sc, col) => `<svg xmlns='http://www.w3.org/2000/svg' width='${80*sc}' height='${80*sc}'><path d='M0 ${40*sc}Q${20*sc} ${20*sc} ${40*sc} ${40*sc}T${80*sc} ${40*sc}' fill='none' stroke='${col}' stroke-width='${0.7*sc}' opacity='${op}'/><path d='M0 ${60*sc}Q${20*sc} ${40*sc} ${40*sc} ${60*sc}T${80*sc} ${60*sc}' fill='none' stroke='${col}' stroke-width='${0.7*sc}' opacity='${op}'/><path d='M0 ${20*sc}Q${20*sc} ${0} ${40*sc} ${20*sc}T${80*sc} ${20*sc}' fill='none' stroke='${col}' stroke-width='${0.7*sc}' opacity='${op}'/></svg>` },
  noise:       { name: 'Noise',
    svg: (op, sc, col) => { const s=4*sc; const cells=[0.08,0.02,0.12,0.04,0.03,0.10,0.01,0.09,0.11,0.05,0.07,0.02,0.06,0.09,0.03,0.08]; return `<svg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}'>${cells.map((a,i)=>`<rect x='${(i%4)*sc}' y='${Math.floor(i/4)*sc}' width='${sc}' height='${sc}' fill='${col}' opacity='${Math.min(1,a*op*8)}'/>`).join('')}</svg>`; } },
  image:       { name: '🖼 Custom image', svg: null },
};

/**
 * Builds the CSS background-image value for the current pattern setting.
 * - SVG patterns  → tiled data:image/svg+xml;base64 URL at `opacity` / `scale`
 * - Custom image  → data URL stored in pattern.imageDataUrl, tiled at `scale`×,
 *                   composited over a semi-transparent colour overlay so the bg
 *                   colour still shows through at 1 – opacity.
 * Returns '' (empty string) when no pattern / type === 'none'.
 */
function buildBgPatternCss(pattern) {
  if (!pattern || !pattern.type || pattern.type === 'none') return '';

  if (pattern.type === 'image') {
    if (!pattern.imageDataUrl) return '';
    // Tile the image; opacity is applied as a CSS filter rather than inline alpha
    // so the data URL itself doesn't need re-encoding on every opacity change.
    // The caller sets backgroundImage; opacity is set separately via --bg-image-opacity.
    return `url("${pattern.imageDataUrl}")`;
  }

  const def = BG_PATTERNS[pattern.type];
  if (!def || !def.svg) return '';
  const op  = Math.max(0, Math.min(1, pattern.opacity ?? 0.08));
  const sc  = Math.max(0.3, Math.min(4, pattern.scale ?? 1));
  const col = pattern.color || 'white';
  const raw = def.svg(op, sc, col);
  const b64 = typeof btoa !== 'undefined' ? btoa(raw) : Buffer.from(raw).toString('base64');
  return `url("data:image/svg+xml;base64,${b64}")`;
}

/* ─────────────────────────────────────────────────────────────
   THEME SCHEDULE — automatic timed theme switching
   ─────────────────────────────────────────────────────────────
   state.settings.themeSchedule holds the config object:
   {
     enabled: bool,
     mode: 'daily' | 'weekly' | 'sun',

     // daily — same slots every day
     daily: [
       { time: 'HH:MM', presetKey: 'light' | 'default' | … | 'custom', theme?: {...} },
       …
     ],

     // weekly — different slots per weekday (0=Sun … 6=Sat)
     weekly: {
       0: [ { time, presetKey, theme? }, … ],
       1: [ … ], …
     },

     // sun — sunrise / sunset with ± minute offsets
     sun: {
       lat: number | null,   // null → geolocation not yet obtained
       lng: number | null,
       riseOffset:  number,  // minutes offset from sunrise (can be negative)
       setOffset:   number,  // minutes offset from sunset
       dayPreset:   string,  // applied at sunrise + riseOffset
       dayTheme?:   object,
       nightPreset: string,  // applied at sunset + setOffset
       nightTheme?: object,
     }
   }
───────────────────────────────────────────────────────────── */

const DEFAULT_SCHEDULE = {
  enabled: false,
  mode: 'daily',
  daily: [
    { time: '07:00', presetKey: 'light'   },
    { time: '20:00', presetKey: 'default' },
  ],
  weekly: { 0:[], 1:[], 2:[], 3:[], 4:[], 5:[], 6:[] },
  sun: {
    lat: null, lng: null,
    riseOffset: 0, setOffset: 0,
    dayPreset: 'light', nightPreset: 'default',
  },
};

/** Convert 'HH:MM' string to total minutes since midnight. */
function hhmm2min(s) {
  const [h, m] = (s || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Pure astronomical sunrise/sunset calculator (no API, good to ±1–2 min).
 * Returns { rise, set } as minutes since midnight (local time), or null if
 * the sun never sets/rises on this day (polar day/night).
 * Algorithm: NOAA simplified / Jean Meeus "Astronomical Algorithms".
 */
function calcSunTimes(lat, lng, date) {
  const rad = x => x * Math.PI / 180;
  const deg = x => x * 180 / Math.PI;
  const d = date || new Date();
  // Julian day
  const JD = Math.floor(d.getTime() / 86400000) + 2440587.5;
  const n  = JD - 2451545.0;
  // Solar mean anomaly
  const M  = (357.5291 + 0.98560028 * n) % 360;
  // Equation of centre
  const C  = 1.9148*Math.sin(rad(M)) + 0.0200*Math.sin(rad(2*M)) + 0.0003*Math.sin(rad(3*M));
  // Ecliptic longitude
  const lam = (M + C + 180 + 102.9372) % 360;
  // Solar transit
  const Jt = 2451545.0 + 0.0009 + ((-lng)/360) + n + 0.0053*Math.sin(rad(M)) - 0.0069*Math.sin(rad(2*lam));
  // Declination
  const dec = Math.asin(Math.sin(rad(lam)) * Math.sin(rad(23.4397)));
  // Hour angle
  const cosH = (Math.sin(rad(-0.833)) - Math.sin(rad(lat))*Math.sin(dec)) / (Math.cos(rad(lat))*Math.cos(dec));
  if (Math.abs(cosH) > 1) return null; // polar day/night
  const H = deg(Math.acos(cosH));
  // Sunrise / sunset as Julian days
  const Jrise = Jt - H/360;
  const Jset  = Jt + H/360;
  // Convert to local clock minutes
  const toLocalMin = jd => {
    const ms = (jd - 2440587.5) * 86400000;
    const local = new Date(ms);
    return local.getHours()*60 + local.getMinutes();
  };
  return { rise: toLocalMin(Jrise), set: toLocalMin(Jset) };
}

/**
 * Resolves which theme should be active RIGHT NOW given the schedule config.
 * Returns a theme object (merged with DEFAULT_THEME), or null if the schedule
 * is disabled or no slot has fired yet today.
 * Pure — reads only `sched`/`customPresets` and the current system clock.
 * `customPresets` is an optional array of { key, name, theme } user presets
 * (stored in state.settings.customPresets) so scheduled slots can reference them.
 */
function resolveScheduledTheme(sched, customPresets = []) {
  if (!sched?.enabled) return null;
  const now  = new Date();
  const nowM = now.getHours()*60 + now.getMinutes();
  const dow  = now.getDay(); // 0=Sun … 6=Sat

  function lookupPreset(key) {
    if (!key) return null;
    if (THEME_PRESETS[key]) return { ...DEFAULT_THEME, ...THEME_PRESETS[key] };
    const cp = customPresets.find(p => p.key === key);
    return cp ? { ...DEFAULT_THEME, ...cp.theme } : null;
  }

  function resolveSlotTheme(slot) {
    if (!slot) return null;
    const base = lookupPreset(slot.presetKey) || { ...DEFAULT_THEME };
    return slot.theme ? { ...base, ...slot.theme } : base;
  }

  if (sched.mode === 'daily') {
    const slots = [...(sched.daily || [])].sort((a,b) => hhmm2min(a.time) - hhmm2min(b.time));
    let active = null;
    for (const s of slots) { if (hhmm2min(s.time) <= nowM) active = s; }
    return resolveSlotTheme(active);
  }

  if (sched.mode === 'weekly') {
    const slots = [...(sched.weekly?.[dow] || [])].sort((a,b) => hhmm2min(a.time) - hhmm2min(b.time));
    let active = null;
    for (const s of slots) { if (hhmm2min(s.time) <= nowM) active = s; }
    if (!active) {
      // Roll back through previous days to find the last-active slot
      for (let d = 1; d <= 6; d++) {
        const prev = (dow - d + 7) % 7;
        const ps = [...(sched.weekly?.[prev] || [])].sort((a,b) => hhmm2min(b.time) - hhmm2min(a.time));
        if (ps.length) { active = ps[0]; break; }
      }
    }
    return resolveSlotTheme(active);
  }

  if (sched.mode === 'sun') {
    const sun = sched.sun || {};
    if (sun.lat == null || sun.lng == null) return null;
    const times = calcSunTimes(sun.lat, sun.lng, now);
    if (!times) return null; // polar
    const riseM = times.rise + (sun.riseOffset || 0);
    const setM  = times.set  + (sun.setOffset  || 0);
    const isDaytime = nowM >= riseM && nowM < setM;
    const slotKey   = isDaytime ? 'day' : 'night';
    const presetKey = isDaytime ? (sun.dayPreset || 'light') : (sun.nightPreset || 'default');
    const custom    = isDaytime ? sun.dayTheme : sun.nightTheme;
    const base = lookupPreset(presetKey) || { ...DEFAULT_THEME };
    return custom ? { ...base, ...custom } : base;
  }

  return null;
}

function hexToRgbTriplet(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return '0,0,0';
  return [1,2,3].map(i => parseInt(m[i], 16)).join(',');
}

/** Mixes `hex` toward white (amt>0) or black (amt<0), amt in [-1,1]. Used to derive --surface2. */
function mixHex(hex, amt) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return hex;
  const target = amt >= 0 ? 255 : 0;
  const t = Math.abs(amt);
  const ch = i => { const v = parseInt(m[i], 16); return Math.round(v + (target - v) * t); };
  return '#' + [1,2,3].map(i => ch(i).toString(16).padStart(2,'0')).join('');
}

/** Relative luminance (0-1, sRGB) — used to auto-pick readable text for gradient buttons. */
function relLuminance(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return 1;
  const [r,g,b] = [1,2,3].map(i => parseInt(m[i],16) / 255).map(c => c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4));
  return 0.2126*r + 0.7152*g + 0.0722*b;
}

/**
 * Applies a theme object (the few editable colour groups) as inline CSS custom
 * properties on `targetEl` (defaults to <html>), overriding the stylesheet
 * defaults. Also derives the handful of computed tokens (rgb triplets, the
 * gradient, glow, border tint, on-gradient text, and a slightly-raised
 * "surface2") so every reused colour across the UI updates together.
 * `prefix` lets content.js reuse the same derivation logic for its --mf-*
 * namespace if it ever wants to (currently duplicated inline there instead,
 * see content.js — kept that way per the "separate execution context" rule).
 */
function applyThemeVars(theme, targetEl, prefix = '') {
  const t = { ...DEFAULT_THEME, ...(theme || {}) };
  const el = targetEl || document.documentElement;
  const set = (name, val) => el.style.setProperty(`--${prefix}${name}`, val);
  set('bg', t.bg); set('surface', t.surface); set('text', t.text);
  set('muted', t.muted); set('blue', t.blue); set('pink', t.pink);
  set('bg-rgb', hexToRgbTriplet(t.bg));
  set('surface-rgb', hexToRgbTriplet(t.surface));
  set('text-rgb', hexToRgbTriplet(t.text));
  set('blue-rgb', hexToRgbTriplet(t.blue));
  set('pink-rgb', hexToRgbTriplet(t.pink));
  set('surface2', mixHex(t.surface, 0.06));
  set('grad', `linear-gradient(90deg, ${t.blue}, ${t.pink})`);
  set('glow', `rgba(${hexToRgbTriplet(t.pink)}, 0.3)`);
  set('border', t.borderColor || `rgba(${hexToRgbTriplet(t.text)}, 0.07)`);
  // Average the two gradient stops' luminance to decide readable on-gradient text.
  const avgLum = (relLuminance(t.blue) + relLuminance(t.pink)) / 2;
  set('on-gradient', avgLum > 0.6 ? '#0B0F14' : '#FFFFFF');
  // Background pattern — tiled SVG or custom image overlay on top of --bg solid colour.
  const pat = t.bgPattern;
  const patCss = buildBgPatternCss(pat);
  set('bg-pattern', patCss || 'none');
  if (typeof document !== 'undefined' && !prefix) {
    if (pat?.type === 'image' && pat.imageDataUrl) {
      // Custom image: tile at `scale`× the natural size, opacity via CSS opacity filter
      const sc   = Math.max(0.1, Math.min(10, pat.scale ?? 1));
      const op   = Math.max(0, Math.min(1, pat.opacity ?? 0.5));
      const size = pat.imageSize === 'cover' ? 'cover'
                 : pat.imageSize === 'contain' ? 'contain'
                 : `${Math.round(sc * 200)}px`;
      document.body.style.backgroundImage  = patCss;
      document.body.style.backgroundSize   = size;
      document.body.style.backgroundRepeat = pat.imageSize ? 'no-repeat' : 'repeat';
      document.body.style.backgroundPosition = pat.imageSize ? 'center center' : 'top left';
      // Wrap in a pseudo-overlay via --bg-image-opacity so the bg colour remains visible
      document.documentElement.style.setProperty('--bg-image-opacity', String(op));
    } else {
      document.body.style.backgroundImage    = patCss || '';
      document.body.style.backgroundSize     = patCss ? 'auto' : '';
      document.body.style.backgroundRepeat   = '';
      document.body.style.backgroundPosition = '';
      document.documentElement.style.setProperty('--bg-image-opacity', '1');
    }
  }
}
