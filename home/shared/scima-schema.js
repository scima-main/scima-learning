'use strict';
/* ═══════════════════════════════════════════════════════════════
   scima-schema.js — the three-schema interchange system.

   One envelope, three payload grades, a classifier, and converters:

     skeletal  The bare minimum: text-only cards of every type (basic,
               multi-answer, markscheme, process, calculation, table) under
               one-letter keys — optimised for LLM token efficiency. Used
               ONLY as an import format (AI JSON mode emits it; hand-written
               imports may use it). Never exported, never stored.

     share     Human-readable long keys. Keeps the content features that
               travel between people — card images, deck/folder icons,
               subject, colour, resolved citations + citedSources — and
               strips everything user-specific: per-card scheduling state
               (ease/interval/reps/lapses/due/state/created/lastRated/
               suspended/leech) and deck id/pinned. Used for deck/folder/
               collection exports, community uploads, and everything the
               backend stores and serves.

     full      The app's own storage shape (mf_state), the account-backup
               data.json, and account exports: everything, plus the same
               envelope header.

   The envelope:
     { $schema: 'scima', schema: 'skeletal'|'share'|'full',
       schemaVersion: 1, kind: 'cards'|'deck'|'folder'|'collection'|'account',
       ...payload }

   scimaClassify() recognizes stamped payloads first; unstamped payloads are
   matched against the pre-envelope generations this app has produced
   (version:2 deck/folder/collection exports, version:3 account backups,
   raw mf_state snapshots) and against key-shape heuristics, returning
   'legacy-*' names. Anything unrecognized → null, and importers reject it
   with a clear message instead of guessing.

   scimaToFullDeck()/scimaCardsToLong() normalize skeletal/share/legacy
   payloads into the long-key card objects the existing repair path
   (sanitizeDeck/sanitizeCard/sanitizeMfState in shared.js) consumes — this
   module itself never assigns ids or scheduling defaults; the sanitizers
   remain the single source of truth for those.

   Dependency-free by design: the site loads it on every page (COMMON slice)
   and community/index.html loads it directly; the backend keeps a Python
   mirror (backend/app/scimaschema.py) for the same rules.
═══════════════════════════════════════════════════════════════ */

const SCIMA_SCHEMA_VERSION = 1;
const SCIMA_SCHEMAS = Object.freeze({ SKELETAL: 'skeletal', SHARE: 'share', FULL: 'full' });
// Closed vocabulary for envelope.kind — a stamped payload naming anything
// else is malformed and must be rejected, not guessed at.
const SCIMA_KINDS = Object.freeze(['cards', 'deck', 'folder', 'collection', 'account']);

// skeletal short key ⇄ full card key. Covers EVERY card type's data:
// basic (f/b/h/t), multi-answer (an/rq), markscheme/process pools (sy/mp/mr),
// calculation (cu/ct/cm), table (td/tt/tm). Deliberately no ids, dates,
// scheduling state, citations or images — skeletal is text-only by contract.
const SKELETAL_KEYS = Object.freeze({
  f: 'front', b: 'back', h: 'hint', t: 'tags', ty: 'type',
  an: 'answerCount', rq: 'requiredAnswers', sy: 'synonyms',
  mp: 'methodPool', mr: 'methodRequired',
  cu: 'calcUnit', ct: 'calcTolerance', cm: 'calcToleranceMode',
  td: 'tableData', tt: 'tableTolerance', tm: 'tableToleranceMode',
});

// Fields that are user-specific and must never leave the device in a share
// payload (card-level and deck-level).
const SCIMA_USER_CARD_FIELDS = Object.freeze([
  'id', 'ease', 'interval', 'reps', 'lapses', 'due', 'state',
  'created', 'lastRated', 'suspended', 'leech',
]);
const SCIMA_USER_DECK_FIELDS = Object.freeze(['id', 'pinned']);

/** Expand skeletal short keys to the long-key card shape (long keys win if
 *  both are present; unknown keys are dropped — skeletal is a closed set). */
function scimaSkeletalToCard(s) {
  const out = {};
  for (const [k, v] of Object.entries(s || {})) {
    const long = SKELETAL_KEYS[k] || (Object.values(SKELETAL_KEYS).includes(k) ? k : null);
    if (long != null && v !== undefined) out[long] = v;
  }
  return out;
}

/** Compress a long-key card to skeletal (import-format producer; omits
 *  empty optionals so LLM/file payloads stay minimal). */
function scimaCardToSkeletal(c) {
  const out = {};
  for (const [short, long] of Object.entries(SKELETAL_KEYS)) {
    const v = c?.[long];
    if (v === undefined || v === null || v === '' ||
        (Array.isArray(v) && !v.length)) continue;
    out[short] = v;
  }
  return out;
}

/** Normalize a list of cards that may mix skeletal short keys and long keys
 *  (e.g. a share deck from an LLM pipeline) into long-key objects. */
function scimaCardsToLong(cards) {
  return (Array.isArray(cards) ? cards : []).map(c =>
    (c && typeof c === 'object' && ('f' in c || 'b' in c) && !('front' in c || 'back' in c))
      ? scimaSkeletalToCard(c)
      : c);
}

/** Add the envelope to a payload object (returns a new object). */
function scimaStamp(payload, schema, kind) {
  return { $schema: 'scima', schema, schemaVersion: SCIMA_SCHEMA_VERSION, kind, ...payload };
}

const _isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

/** Classify any payload. Returns { schema, kind, legacy } — schema is one of
 *  'skeletal' | 'share' | 'full' for stamped payloads, or 'legacy-*' for the
 *  recognized pre-envelope generations; null for anything unrecognized. */
function scimaClassify(p) {
  // 0) Bare card arrays (header-less skeletal/share lists)
  if (Array.isArray(p)) {
    if (!p.length || !p.every(c => _isObj(c))) return null;
    const hasShort = p.some(c => ('f' in c || 'b' in c) && !('front' in c || 'back' in c));
    return { schema: hasShort ? 'skeletal' : 'share', kind: 'cards', legacy: hasShort ? false : 'bare-array' };
  }
  if (!_isObj(p)) return null;
  // 1) Stamped envelope
  if (p.$schema === 'scima' && typeof p.schema === 'string') {
    const schema = p.schema;
    if (!Object.values(SCIMA_SCHEMAS).includes(schema)) return null;
    const kind = typeof p.kind === 'string' ? p.kind : (
      _isObj(p.deck) ? 'deck' : p.decks ? (p.sources || p.settings ? 'account' : 'collection') :
      Array.isArray(p.cards) ? 'cards' : null);
    return (kind && SCIMA_KINDS.includes(kind)) ? { schema, kind, legacy: false } : null;
  }
  // 2) Legacy generations (pre-envelope), by shape
  if (p.version === 3 && Array.isArray(p.decks)) return { schema: 'full', kind: 'account', legacy: 'v3-account' };
  if (p.version === 2) {
    if (_isObj(p.deck) && Array.isArray(p.deck.cards)) return { schema: 'share', kind: 'deck', legacy: 'v2-deck' };
    if (_isObj(p.folder) && Array.isArray(p.decks)) return { schema: 'share', kind: 'folder', legacy: 'v2-folder' };
    if (Array.isArray(p.decks)) return { schema: 'share', kind: 'collection', legacy: 'v2-collection' };
  }
  // 3) Header-less shapes
  if (Array.isArray(p.decks) && (p.settings !== undefined || p.reviewHistory !== undefined))
    return { schema: 'full', kind: 'account', legacy: 'mf-state' };           // raw mf_state snapshot
  if (_isObj(p.deck) && Array.isArray(p.deck.cards))
    return { schema: 'share', kind: 'deck', legacy: 'unversioned-deck' };
  if (Array.isArray(p.cards) && p.cards.every(c => _isObj(c)) && p.cards.length) {
    const hasShort = p.cards.some(c => ('f' in c || 'b' in c) && !('front' in c || 'back' in c));
    return hasShort
      ? { schema: 'skeletal', kind: 'cards', legacy: false }
      : { schema: 'share', kind: 'cards', legacy: 'long-cards' };
  }
  return null;
}

/** Strip user-specific fields from one deck, producing a share-grade deck.
 *  Pass an already citation-resolved deck (exportSingleDeck's
 *  _resolveDeckCitations) — citations/citedSources are content and travel. */
function scimaDeckToShare(deck, { keepIds = false } = {}) {
  const out = { ...deck };
  for (const f of SCIMA_USER_DECK_FIELDS) if (!keepIds) delete out[f];
  out.cards = (Array.isArray(deck.cards) ? deck.cards : []).map(c => {
    const card = { ...c };
    for (const f of SCIMA_USER_CARD_FIELDS) delete card[f];
    return card;
  });
  return out;
}

/** Normalize any classified deck-bearing payload (skeletal/share/full/legacy)
 *  into a long-key deck object ready for sanitizeDeck(). Returns null when the
 *  payload isn't deck-bearing. */
function scimaToFullDeck(payload) {
  const cls = scimaClassify(payload);
  if (!cls) return null;
  const raw = cls.kind === 'deck' ? payload.deck
    : cls.kind === 'cards' ? { name: payload.name, cards: Array.isArray(payload) ? payload : payload.cards }
    : null;
  if (!_isObj(raw)) return null;
  return { ...raw, cards: scimaCardsToLong(raw.cards) };
}

// Node/test export guard (no-op in the browser), same pattern as shared.js.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SCIMA_SCHEMA_VERSION, SCIMA_SCHEMAS, SCIMA_KINDS, SKELETAL_KEYS,
    SCIMA_USER_CARD_FIELDS, SCIMA_USER_DECK_FIELDS,
    scimaSkeletalToCard, scimaCardToSkeletal, scimaCardsToLong, scimaStamp,
    scimaClassify, scimaDeckToShare, scimaToFullDeck,
  };
}
