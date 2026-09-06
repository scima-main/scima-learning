'use strict';
/* ═══════════════════════════════════════════════════════════════
   dashboard-core.js — MUST load first of the dashboard-*.js files.

   Was previously the top of one 6,200-line dashboard.js; split into
   dashboard-core/home/decks/study/capture/library/analytics/settings/tracker/
   bootstrap.js (loaded in that order in dashboard.html) for maintainability —
   see documentation/fixes-and-improvements.txt for the rationale. All ten
   files share one global scope (plain <script> tags, no bundler), same as
   srs-core.js/translate-shared.js/popup-logic.js elsewhere in this codebase.
   Only two things about load order actually matter:
     1. This file must load first — it defines `state`, `store`, and the
        generic helpers (el, btn, showToast, the color picker, the command
        palette, navigate/renderView/renderSidebar) every other file uses.
     2. dashboard-bootstrap.js must load last — it's the only one of the ten
        with real top-level executing code (the storage.onChanged listener,
        the final `init()` call that actually starts the app). Every other
        file only *defines* functions, so their relative order doesn't matter.

   Contains: DEBUG flag, NAV_ITEMS, state, store (chrome.storage/localStorage
   abstraction + the tracker write-lock), generic DOM/string helpers, the
   colour picker, XP/streak helpers, scope-set helpers (shared by Study),
   the command palette, and the router (navigate/renderView/renderSidebar).
═══════════════════════════════════════════════════════════════ */

// Sets are always-on regardless of DEBUG: console.error() calls inside catch blocks
// (real, unexpected failures — useful in a bug report's console even in production).
// Everything gated behind DEBUG below is leftover step-by-step tracing from
// developing a specific feature, not intended to run for every user forever.
const DEBUG = false;

// All navigable sidebar tabs. Order here is just the *fallback* — the
// effective order/visibility a user sees comes from
// state.settings.navOrder / hiddenTabs (customizable in Settings → Navigation,
// see getOrderedNavItems()/getVisibleNavItems() below).
const NAV_ITEMS = [
  // ── Flashcards ──────────────────────────────────────
  { id: 'home',                    icon: '🏠', label: 'Home'         },
  { id: 'decks',                   icon: '📚', label: 'Decks'        },
  { id: 'study',                   icon: '🧠', label: 'Study'        },
  { id: 'capture',                 icon: '⚡', label: 'Capture'      },
  { id: 'library',                 icon: '📖', label: 'Library'      },
  { id: 'analytics',               icon: '📊', label: 'Analytics'    },
  { id: 'quests',                  icon: '🎯', label: 'Quests'       },
  { id: 'settings',                icon: '⚙️', label: 'Settings'     },
  // ── Tracker (prefixed tracker-) ──────────────────────
  { id: 'tracker-overview',        icon: '🌟', label: 'XP Overview',     section: 'tracker' },
  { id: 'tracker-logmarks',        icon: '✏️', label: 'Log Marks',        section: 'tracker' },
  { id: 'tracker-subjects',        icon: '📋', label: 'Subjects',         section: 'tracker' },
  { id: 'tracker-history',         icon: '📅', label: 'Mark History',     section: 'tracker' },
  { id: 'tracker-managesubjects',  icon: '🗂️', label: 'Manage Subjects',  section: 'tracker' },
  { id: 'tracker-trackersettings', icon: '🎛️', label: 'Tracker Settings', section: 'tracker' },
];
const NAV_ITEMS_DEFAULT_ORDER = NAV_ITEMS.map(n => n.id);

const state = {
  decks: [],
  folders: [],
  sources: [],
  trackerState: null,
  streak: 0,
  lastStreakDate: null,
  reviewHistory: [],
  achievements: [],
  settings: {
    dailyGoal: 20, newCardsPerDay: 10,
    algorithm: 'fsrs', autoSuspend: true, leechThreshold: 8,
    tts: false, dyslexia: false, highContrast: false, notifications: true, powerSaving: false,
    defineLang: 'en', showPinyin: true, singleWordDefinition: true,
    // Local LLM card generation (Capture → ✨ AI Generate) — talks to an OpenAI-
    // compatible chat-completions server running on the user's own machine (LM
    // Studio, Ollama's OpenAI-compat endpoint, llama.cpp server, etc.), never a
    // hosted API, so there's no key to store. 1234 is LM Studio's default port.
    aiEndpoint: 'http://127.0.0.1:1234', aiModel: '', aiJsonMode: false,
    // Fine-tuned model mode (Capture → AI Generate → "Use fine-tuned
    // flashcard model" toggle). OFF by default. When ON, generateCardsFromText()
    // swaps the normal system+user prompt for the compact FT_PROMPT_TEMPLATE
    // below and (optionally) a separate model id, instead of the long
    // hand-written prompts — see getFineTunedPrompt() further down.
    aiFineTuned: false, aiFineTunedModel: '',
    // 'api' = call aiEndpoint directly (default, above); 'manual' = Capture's
    // "Copy / Paste" mode — build the same prompt but hand it to the user to
    // paste into any chat-based AI (ChatGPT, Claude.ai, Gemini, etc.) instead
    // of calling a local server, then parse whatever they paste back. See
    // buildManualPromptText()/parseManualAIReply() below and the mode toggle
    // in dashboard-capture.js's renderAIGenerate().
    aiCaptureMode: 'api',
    theme: { ...DEFAULT_THEME },          // few reused colors: bg/surface/text/muted/gradient1(blue)/gradient2(pink)
    themeSchedule: { ...DEFAULT_SCHEDULE }, // timed auto-switching — see shared.js resolveScheduledTheme()
    customPresets: [],                     // user-made presets: [{ key, name, theme }] — importable/exportable
    navOrder: [...NAV_ITEMS_DEFAULT_ORDER], // tab order, customizable in Settings → Navigation
    hiddenTabs: [],                       // tabs tucked into the sidebar's hidden-tabs drawer
    onboarding: { completed: false, step: 0, version: 1 }, // guided tour — see dashboard-onboarding.js
  },
  view: 'home',
  studyScope: [{ type: 'all', id: null }],
  recentStudyScopes: [], // persisted quick-access list — see pushRecentScope()
  // ── Study "refine": an extra, finer-grained filter layered on top of
  // studyScope (see applyStudyRefine() below). Not persisted to storage —
  // deliberately resets to 'all' on every dashboard load/reload, same as
  // studySession itself, since it's a one-off narrowing rather than a
  // durable scope choice the way studyScope/recentStudyScopes are.
  //   mode: 'all' | 'cards' | 'stale' | 'ease'
  //   cardIds: explicit hand-picked card ids, used when mode==='cards'
  //   n: how many cards to take, used when mode==='stale' or 'ease'
  //   easeDir: 'hardest' (lowest ease first) | 'easiest' (highest ease first),
  //            used when mode==='ease'
  studyRefine: { mode: 'all', cardIds: [], n: 20, easeDir: 'hardest' },
  deckNav: { view: 'subjects', subjectKey: null, folderId: null },
};

// Serializes all writes to the SCIMATracker storage key. Without this,
// saveTrackerState() (a full-snapshot overwrite of state.trackerState) and
// store.addXPToTracker() (its own independent read-modify-write, called right after
// a study session ends) could interleave — e.g. logging GCSE marks on the tracker
// page at the same moment a study session's XP award lands — and one write would
// silently stomp the other, dropping XP with no error and no trace. Every caller
// below now goes through withTrackerWriteLock(), so a second call always waits for
// the first to fully finish before it starts its own read+write.
let _trackerWriteChain = Promise.resolve();
function withTrackerWriteLock(fn) {
  const result = _trackerWriteChain.then(fn, fn);
  _trackerWriteChain = result.then(() => {}, () => {}); // never lets one failure wedge the chain
  return result;
}

// ── Storage adapter (Phase 0, Step 1) ────────────────────────────────
// Site build: chrome.storage.local never exists here, so isExtension is
// always false and every branch below always takes the localStorage path.
// The chrome.storage.local branches are kept (not deleted) so this same
// file still works unmodified inside the extension build — this is the
// single seam Phase 1 (blobStore, cross-tab sync, etc.) builds on top of.
const isExtension = typeof chrome !== 'undefined' && !!chrome?.storage?.local;

const store = {
  async load() {
    if (isExtension) {
      try {
        return await new Promise(res =>
          chrome.storage.local.get(['mf_state', 'SCIMATracker'], d =>
            res({ mf: d.mf_state || {}, tracker: d.SCIMATracker || {} })
          )
        );
      } catch (e) { console.warn('[SCIMA] chrome.storage.local.get failed, falling back to localStorage:', e); }
    }
    try {
      return {
        mf: JSON.parse(localStorage.getItem('mf_state') || '{}'),
        tracker: JSON.parse(localStorage.getItem('SCIMATracker') || '{}'),
      };
    } catch (e) { console.warn('[SCIMA] localStorage read failed, starting fresh:', e); return { mf: {}, tracker: {} }; }
  },
  async saveMF(data) {
    if (isExtension) {
      try { return await new Promise(res => chrome.storage.local.set({ mf_state: data }, res)); }
      catch (e) { console.warn('[SCIMA] chrome.storage.local.set failed, falling back to localStorage:', e); }
    }
    try { localStorage.setItem('mf_state', JSON.stringify(data)); }
    catch (e) { console.warn('[SCIMA] localStorage save failed — data was NOT saved:', e); }
  },
  async addXPToTracker(amount) {
    return withTrackerWriteLock(async () => {
      if (isExtension) {
        try {
          return await new Promise(res => {
            chrome.storage.local.get('SCIMATracker', d => {
              const t = d.SCIMATracker || state.trackerState || {};
              t.totalXP = (t.totalXP || 0) + amount;
              state.trackerState = t;
              chrome.storage.local.set({ SCIMATracker: t }, res);
            });
          });
        } catch (e) { console.warn('[SCIMA] chrome.storage.local addXPToTracker failed, falling back to localStorage:', e); }
      }
      try {
        const t = JSON.parse(localStorage.getItem('SCIMATracker') || '{}');
        t.totalXP = (t.totalXP || 0) + amount;
        state.trackerState = t;
        localStorage.setItem('SCIMATracker', JSON.stringify(t));
      } catch (e) { console.warn('[SCIMA] localStorage fallback addXPToTracker also failed — XP was NOT saved:', e); }
    });
  },
};

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    store.saveMF({
      decks: state.decks, folders: state.folders, sources: state.sources,
      libraryFolders: state.libraryFolders||[],
      streak: state.streak, lastStreakDate: state.lastStreakDate, reviewHistory: state.reviewHistory,
      achievements: state.achievements, settings: state.settings,
      recentStudyScopes: state.recentStudyScopes,
      sessionLog: state.sessionLog||[],
    });
  }, 600);
}

function uid(p = 'id') { return `${p}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`; }

/** SHA-256 of a UTF-8 string → lowercase hex. Used to fingerprint source content. */
async function hashContent(text) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  } catch(e) { return null; }
}

/** Convert a blob: URL to a data: URL (base64). Returns null on failure. */
async function blobToDataUrl(blobUrl) {
  try {
    const resp = await fetch(blobUrl);
    const blob = await resp.blob();
    return await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(blob);
    });
  } catch(e) { return null; }
}

/** Replace all blob: src/href attributes in an HTML string with data: URLs. */
async function blobUrlsToDataUrls(html) {
  const blobUrls = new Set();
  const blobRe = /blob:[^\s"')>]+/g;
  for (const m of html.matchAll(blobRe)) blobUrls.add(m[0]);
  const map = {};
  await Promise.all([...blobUrls].map(async url => {
    const data = await blobToDataUrl(url);
    if (data) map[url] = data;
  }));
  return html.replace(blobRe, m => map[m] || m);
}
function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// LANGS / translateText / fetchPinyin now live in translate-shared.js, loaded via
// <script> in dashboard.html immediately before this file — previously a full
// duplicate copy of content.js's versions (see translate-shared.js for why they'd
// drifted apart and which behaviour was kept).

// Looks up `term` against the user's preferences:
//  - Chinese characters → pinyin + translation (if "Show Pinyin" is enabled)
//  - a single word in a space-delimited script (Latin/Cyrillic/Arabic/etc., i.e. not
//    Han) → a definition in the word's OWN language (if "Single-Word Definitions" is
//    enabled), rather than translating it
//  - everything else (phrases, or the toggles above are off) → a dictionary
//    definition if the text is already in the target language, otherwise a
//    translation into the target language
// Returns { kind: 'pinyin'|'definition'|'translation', back, hint, pinyin? }
async function defineTerm(term, targetLang, opts = {}) {
  const { showPinyin = true, singleWordDefinition = true } = opts;
  const isHan = /\p{Script=Han}/u.test(term);
  const { translated, sourceLang } = await translateText(term, targetLang);

  if (isHan && showPinyin) {
    const pinyin = await fetchPinyin(term).catch(() => null);
    return { kind: 'pinyin', pinyin, back: translated, hint: pinyin ? `Pinyin: ${pinyin}` : `Translated from ${LANGS[sourceLang] || sourceLang}` };
  }

  const isSingleWord = !isHan && term.trim().split(/\s+/).filter(Boolean).length === 1;
  if (isSingleWord && singleWordDefinition) {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/${sourceLang}/${encodeURIComponent(term)}`);
    const json = res.ok ? await res.json() : null;
    const m = json?.[0]?.meanings?.[0];
    if (m?.definitions?.[0]?.definition) {
      return { kind: 'definition', back: m.definitions[0].definition, hint: `${m.partOfSpeech ? m.partOfSpeech + ' · ' : ''}${LANGS[sourceLang] || sourceLang}` };
    }
    // No dictionary entry in the word's own language — fall through to translation below.
  }

  const sameLang = sourceLang.split('-')[0] === targetLang.split('-')[0];
  if (sameLang) {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/${targetLang}/${encodeURIComponent(term)}`);
    const json = res.ok ? await res.json() : null;
    const m = json?.[0]?.meanings?.[0];
    return { kind: 'definition', back: m?.definitions?.[0]?.definition || 'No definition found.', hint: m?.partOfSpeech || '' };
  }
  return { kind: 'translation', back: translated, hint: `Translated from ${LANGS[sourceLang] || sourceLang}` };
}

// ── Local LLM card generation (Capture → ✨ AI Generate) ──────────────
// Talks to whatever OpenAI-chat-completions-compatible server is running on
// the user's own machine (state.settings.aiEndpoint, default LM Studio's
// http://127.0.0.1:1234 — see dashboard-core.js's `state` above and the
// "Server Address" field in dashboard-settings.js). Nothing ever leaves the
// user's machine and there's no API key to store.
//
// Two generation modes, toggled by state.settings.aiJsonMode (the "Text" /
// "JSON Schema" button in dashboard-capture.js's AI Generate panel):
//
//  - Text mode (default): we don't ask the model for JSON at all.
//    Small/quantized local models are unreliable JSON writers — a single
//    stray trailing comma or unescaped quote throws away the whole batch —
//    but they're quite reliable at repeating a simple "Card1 / Front: ... /
//    Back: ..." template, which parseAICardText() (shared.js) parses back
//    out. A garbled individual card just gets dropped instead of failing
//    the entire response.
//  - JSON mode: sends LM Studio/llama.cpp's OpenAI-compatible
//    `response_format: { type: 'json_schema', json_schema: {...} }` (see
//    AI_CARD_JSON_SCHEMA below) so the server itself constrains decoding to
//    valid JSON matching the schema — useful for models that are good at
//    following a schema but bad at the freeform template, or just because
//    the server enforces the shape instead of hoping the model complies.
//    Not every local server supports response_format (Ollama's OpenAI-
//    compat endpoint largely ignores it, older llama.cpp builds error on
//    unknown fields), so this is opt-in rather than the default.
//    parseAIJSONCards() (shared.js) parses the result, with the same
//    drop-the-bad-card-not-the-batch tolerance as text mode.

// Strips a trailing slash so callers can freely do `${endpoint}/v1/...`.
function normalizeAIEndpoint(raw) {
  return String(raw || '').trim().replace(/\/+$/, '');
}

function getAISystemPrompt() {
  return `
You are a flashcard generation engine.

Convert ONLY the provided study material into flashcards.

OUTPUT FORMAT:
Output ONLY flashcards in this exact format:

Card1

Front: <short question or term>
Back: <concise answer>
Hint: <optional clue>
Tags: <optional topics>

Card2

Front: ...
Back: ...

STRICT RULES:
- The first line MUST be exactly "Card1".
- Every card starts with Card<number> on its own line.
- Every card MUST have Front: and Back:.
- Do not output anything except cards.
- No explanations, summaries, markdown, JSON, or code blocks.
- Use exactly these field names: Front:, Back:, Hint:, Tags:.

CONTENT RULES:
- Use ONLY facts explicitly stated in the source.
- Do not add outside knowledge or invent details.
- Each card tests ONE specific idea.
- Split multi-part facts into separate cards.
- Prefer important concepts over minor details.
- Keep Front short and specific.
- Keep Back concise and complete.
- Avoid essays and long explanations.
- Only include Hint if it improves recall.
- Only include Tags if useful.

LIST / MULTI-ANSWER QUESTIONS:
- If a question genuinely has several distinct correct answers that must ALL
  be recalled to count as fully correct (e.g. "Name the three branches of
  government", "List the products of photosynthesis"), put each individual
  answer on its own line after "Back:", one item per line, in any order.
- Do NOT prefix those lines with "-", "*", numbers, or any other bullet
  marker — plain text only, one answer per line.
- Do NOT use this for a single answer that merely has multiple words or a
  multi-sentence explanation — that still goes on one line.
- Most cards will have exactly one line under Back:. Only use multiple lines
  when the question truly asks for a list of separate items.

Before responding:
- Check the first line is Card1.
- Check every card has Front and Back.
- Check every answer comes from the source material.
`;
}

// The JSON Schema sent as `response_format.json_schema.schema` in JSON mode.
// Matches the shape parseAIJSONCards() (shared.js) expects back: a top-level
// object with a `cards` array. `additionalProperties:false` + `required` on
// both levels is what LM Studio's structured-output engine (and OpenAI's)
// use to actually constrain decoding, not just validate after the fact.
const AI_CARD_JSON_SCHEMA = {
  name: 'flashcards',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            front: {
              type: 'string',
              description: 'Short question testing one idea.'
            },
            back: {
              type: 'string',
              description: 'Concise answer supported by the source. If the question has several distinct required answers (a list), separate them with \\n, one per line, no bullets.'
            },
            hint: {
              type: 'string',
              description: 'Optional recall clue, otherwise empty.'
            },
            tags: {
              type: 'array',
              items: {
                type: 'string'
              },
              description: 'Short topic labels.'
            }
          },
          required: [
            'front',
            'back',
            'hint',
            'tags'
          ],
          additionalProperties: false
        }
      }
    },
    required: [
      'cards'
    ],
    additionalProperties: false
  }
};

function getAISystemPromptJSON() {
  return `
You are an expert flashcard generator.

Convert the provided study material into high-quality revision flashcards.
Return ONLY valid JSON matching the schema AFTER the </think> tag (or after the reasoning is complete). No markdown, explanations, or extra text.

Rules:
- Use ONLY information explicitly present in the source.
- Use terminology commonplace in the subject e.g. "annihilate" not "destroy" in matter-antimatter annihilation; pay attention to wording, as flashcards are used for learning from.
- Do not add external facts, context, examples, or corrections.
- Prioritize core concepts, definitions, mechanisms, equations, discoveries, and important relationships.
- Ignore minor dates, names, and historical details unless they are central to understanding the topic.
- Each card must test exactly ONE idea.
- Never combine multiple questions into one card.
- Split lists, processes, and multi-step explanations into separate cards where useful.

Card style:
- Front: short natural question.
- Back: direct answer containing only the necessary information.
- **UNDER 20 WORDS unless the extra words are ESSENTIAL**
- Avoid repeating the question in the answer.
- Avoid phrases like "according to the text".
- Do not write paragraphs.
- Hint: use only if it improves recall, otherwise "".
- Tags: 1-3 short topic labels.

List / multi-answer questions:
- If a question genuinely has several distinct correct answers that must ALL
  be recalled to count as fully correct (e.g. "Name the three branches of
  government"), put each individual answer on its own line inside the "back"
  string (use "\\n" between them), with NO bullet/number markers — plain
  text, one answer per line.
- Most cards should have a single-line back. Only use multiple lines when
  the question truly asks for a list of separate items, not for a
  multi-sentence explanation.

Quality filter:
- Remove redundant cards.
- **Remove trivial facts, dates, contributors.**
- Remove duplicates.
- Remove cards whose answer is obvious from the question.
- Preserve important technical terminology.
- Every answer must be directly supported by the source.
- **Every answer MUST be longer than three words.**

Prioritize in this order:
1. Core definitions
2. Overarching concepts
3. Fundamental mechanisms
4. Important equations/theories
5. Major discoveries
6. Supporting historical context

Aim for fewer, higher-quality cards rather than exhaustive extraction. Do **NOT** have trivia questions about dates or people unless it is history-related. Single to Multi-answer cards ratio should be approximately 85:15.
`;
}

// ── Fine-tuned mode (Capture → AI Generate → "Use fine-tuned flashcard
// model" toggle, state.settings.aiFineTuned) ──────────────────────────────
// A QLoRA-style fine-tune has (in principle) already learned the flashcard
// task, so instead of the long hand-written system prompts above, this mode
// sends one short, stable cue plus the raw source text. The cue is just a
// consistent textual prefix the model was trained to condition on — it has
// no special effect on its own; it only "does" anything to the extent the
// same string appeared paired with good flashcard output during training.
// Whatever string is used here MUST exactly match what training used, or
// the model is just seeing an unfamiliar prefix.
//
// Everything about the fine-tuned format lives in these few constants/
// functions so it can be changed in one place if the model is retrained
// with a different marker, template, or output schema — nothing below this
// block should ever hard-code the marker string again.

// The stable conditioning cue sent before the source material. Change this
// single value if a future fine-tune is trained with a different marker —
// nothing else needs to change. Not a special token to the extension itself;
// it's just text the model was (or wasn't) trained to recognize.
const FT_MODE_MARKER = '<FLASHCARD_FT>';

// Compact prompt template for fine-tuned mode: marker + "SOURCE:" + the raw
// captured text, deliberately with none of the dozens of rules from
// getAISystemPrompt()/getAISystemPromptJSON() — those are assumed to already
// be baked into the fine-tune. Kept as its own function (rather than inlined
// in generateCardsFromText) so the template shape can change independently
// of the marker itself.
function getFineTunedPrompt(sourceText) {
  return `${FT_MODE_MARKER}\nSOURCE:\n${sourceText}`;
}

// Fine-tuned mode's expected compact reply shape: {"cards":[{"q":"...","a":"..."}]}.
// Not enforced server-side (no response_format schema is sent for this mode,
// since a fine-tune is expected to already comply reliably) — parseAIJSONCards()
// below handles both this compact q/a shape and the extension's normal
// front/back shape, so no separate normalization pass is needed.
const FT_OUTPUT_SCHEMA_NOTE = '{"cards":[{"q":"...","a":"..."}]}';

function buildAIUserPrompt(sourceText, opts = {}) {
  const { count, instructions } = opts;

  let p = count
    ? `Generate approximately ${count} high-quality flashcards`
    : 'Generate high-quality flashcards';

  p += ' using ONLY the study material below.';
  p += ' Prioritize important concepts over minor details.';

  if (instructions && instructions.trim()) {
    p += ` ${instructions.trim()}`;
  }

  p += `\n\n---SOURCE MATERIAL---\n${sourceText}\n---END SOURCE---`;

  return p;
}

// Low-level call to the server's /v1/chat/completions — same request shape
// (POST { model, messages }) as any OpenAI-compatible local server expects.
// `model` is only included if the user set one in Settings; otherwise the
// server falls back to whatever's currently loaded (LM Studio, Ollama, and
// llama.cpp's server all support this).
async function callLocalLLM(messages, opts = {}) {
  const endpoint = normalizeAIEndpoint(state.settings.aiEndpoint);
  if (!endpoint) throw new Error('No AI server address set — add one in Settings → AI Card Generation.');

  const body = { messages, temperature: 0.7, stream: false };
  // Fine-tuned mode uses its own model id when the user has set one (e.g. a
  // separate model loaded in LM Studio/Ollama for the fine-tune), otherwise
  // falls back to the normal aiModel/whatever's currently loaded — same as
  // normal mode.
  const modelOverride = opts.fineTuned ? (state.settings.aiFineTunedModel || state.settings.aiModel) : state.settings.aiModel;
  if (modelOverride) body.model = modelOverride;
  // JSON mode: ask the server to constrain decoding to our schema (LM
  // Studio/llama.cpp's OpenAI-compatible `response_format`). Servers that
  // don't understand the field (e.g. Ollama's OpenAI-compat shim) should
  // just ignore it per the OpenAI request shape, rather than erroring — but
  // see the JSON-mode note in the request handler below if one doesn't.
  if (opts.jsonSchema) body.response_format = { type: 'json_schema', json_schema: opts.jsonSchema };

  let res;
  try {
    res = await fetch(`${endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`Could not reach ${endpoint} — is the local server running?`);
  }

  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j?.error?.message || (typeof j?.error === 'string' ? j.error : ''); } catch (e) {}
    throw new Error(`Server responded ${res.status}${detail ? `: ${detail}` : ''}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('The server returned an empty response.');
  return content.trim();
}

// Pings the configured server so Settings can show a ✓/✕ without the user
// having to run a whole generation first. Tries GET /v1/models (what LM
// Studio/Ollama/llama.cpp all expose) to also surface the loaded model name.
async function testAIConnection() {
  const endpoint = normalizeAIEndpoint(state.settings.aiEndpoint);
  if (!endpoint) return { ok: false, error: 'No server address set.' };
  try {
    const res = await fetch(`${endpoint}/v1/models`, { method: 'GET' });
    if (!res.ok) return { ok: false, error: `Server responded ${res.status}` };
    const data = await res.json();
    const model = state.settings.aiModel || data?.data?.[0]?.id || '';
    return { ok: true, model };
  } catch (e) {
    return { ok: false, error: `Could not reach ${endpoint} — is the local server running?` };
  }
}

// Turns a generated card's `back` into the app's real multi-answer shape
// when the model actually gave a list of distinct answers (see the "LIST /
// MULTI-ANSWER QUESTIONS" rules in the prompts above), rather than leaving
// them jammed into one newline-separated `back` string that the rest of the
// app (getCardAnswers/formatCardBack, dashboard-core.js; the study-mode
// grader; the deck-editor's answer-pool UI, dashboard-decks.js) wouldn't
// recognize as multi-answer at all.
//
// Both generation modes converge on the same convention before reaching
// here: one answer per line within `back`, no bullet markers. This is
// deliberately a post-processing step rather than a change to
// parseAICardText/parseAIJSONCards (shared.js) — those two parsers have
// different jobs (pulling Front/Back/Hint/Tags fields out of two very
// different raw formats) and both already hand back a plain `{front, back,
// hint, tags}` object; this is the one place both paths meet, so it's the
// natural spot to decide "is this actually a list" once, the same way for
// either mode.
//
// A stray bullet/number marker is stripped defensively per line, in case a
// model ignores the "no markers" instruction — this can't be done inside
// parseAICardText's cleanValue(), which only strips a marker from the start
// of the whole (possibly multi-line) string, not from each line.
function splitMultiAnswerBack(back) {
  const MAX_ANSWERS = 12; // matches the deck editor's practical answer-pool size
  const lines = String(back || '')
    .split(/\r\n|\r|\n/)
    .map(l => l.trim().replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, '').trim())
    .filter(Boolean);
  const seen = new Set();
  const unique = [];
  for (const line of lines) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue; // drop an accidental duplicate answer
    seen.add(key);
    unique.push(line);
  }
  return unique.slice(0, MAX_ANSWERS);
}

// Applies splitMultiAnswerBack() to one generated card and reshapes it into
// a multi-answer card (answerCount/requiredAnswers set, `back` rejoined as
// clean lines) whenever that yields 2+ distinct answers. Single-answer
// cards pass through with `back` merely cleaned up (marker-stripped,
// re-trimmed) so a model that added a stray "- " in front of a normal
// one-line answer doesn't leak it into the card. `requiredAnswers` defaults
// to the full count — "list all of them" — since the AI has no way to know
// a partial-credit threshold was intended; that's still adjustable per-card
// afterward in the deck editor (see minPoolSize()/requiredInput,
// dashboard-decks.js) same as a hand-authored multi-answer card.
function applyMultiAnswerShape(card) {
  const answers = splitMultiAnswerBack(card.back);
  if (answers.length >= 2) {
    return { ...card, back: answers.join('\n'), answerCount: answers.length, requiredAnswers: answers.length };
  }
  return { ...card, back: answers[0] || String(card.back || '').trim() };
}

// Full round trip: source text in → parsed card objects out. Throws on a
// hard failure (server unreachable, bad response); returns an empty `cards`
// array (with `raw` still populated) if the model replied but nothing
// parseable came back, so the caller can show the raw reply for debugging.
async function generateCardsFromText(sourceText, opts = {}) {
  const fineTuned = !!state.settings.aiFineTuned;
  let raw;
  if (fineTuned) {
    // Fine-tuned mode: single compact user message, no system prompt, no
    // response_format schema — see getFineTunedPrompt() above for why.
    const messages = [{ role: 'user', content: getFineTunedPrompt(sourceText) }];
    raw = await callLocalLLM(messages, { fineTuned: true });
  } else {
    const jsonMode = !!state.settings.aiJsonMode;
    const messages = [
      { role: 'system', content: jsonMode ? getAISystemPromptJSON() : getAISystemPrompt() },
      { role: 'user', content: buildAIUserPrompt(sourceText, opts) },
    ];
    raw = await callLocalLLM(messages, jsonMode ? { jsonSchema: AI_CARD_JSON_SCHEMA } : {});
  }
  // parseAIJSONCards() handles both the compact {q,a} shape (fine-tuned mode)
  // and the normal {front,back} shape — see shared.js. Fine-tuned mode is
  // always JSON, regardless of the (normal-mode-only) aiJsonMode toggle.
  const parsed = fineTuned ? parseAIJSONCards(raw) : (state.settings.aiJsonMode ? parseAIJSONCards(raw) : parseAICardText(raw));
  const cards = parsed.map(applyMultiAnswerShape);
  return { cards, raw };
}

// ── "Copy / Paste" mode (Capture → ✨ AI Generate, mode toggle) ───────────
// The API-mode helpers above talk to a local OpenAI-compatible server. This
// is the alternative for people who don't run one: build the exact same
// prompt as a single block of text, let the user copy it into whatever
// chat-based AI they already use (ChatGPT, Claude.ai, Gemini, a phone app,
// etc.), and parse whatever they paste back with the same
// parseAICardText()/parseAIJSONCards() + applyMultiAnswerShape() pipeline
// generateCardsFromText() uses — so both modes produce identically-shaped
// cards and share every parsing rule/tolerance.
//
// JSON mode has no response_format to lean on here (that's a server-side
// constraint, not something a chat UI exposes), so the schema itself is
// spelled out in the prompt text and the model is trusted to follow it —
// parseAIJSONCards() still tolerates a chatty preamble/```json fence same
// as API mode, which matters more here since chat AIs are more prone to
// adding commentary than a raw completions endpoint is.
function buildManualPromptText(sourceText, opts = {}) {
  if (state.settings.aiFineTuned) {
    // Fine-tuned mode has no chat-AI equivalent really — the whole point is
    // a model trained on this exact short cue — but Copy/Paste mode still
    // needs *something* to copy, so hand back the same compact prompt a
    // capable general chat AI could plausibly follow if given the schema too.
    return `${getFineTunedPrompt(sourceText)}\n\n(Reply with only JSON matching ${FT_OUTPUT_SCHEMA_NOTE})`;
  }
  const jsonMode = !!state.settings.aiJsonMode;
  let prompt = (jsonMode ? getAISystemPromptJSON() : getAISystemPrompt()).trim();
  if (jsonMode) {
    prompt += `\n\nYour entire reply must be valid JSON matching this schema exactly (no markdown, no code fence, no commentary before or after it):\n${JSON.stringify(AI_CARD_JSON_SCHEMA.schema, null, 2)}`;
  }
  prompt += `\n\n${buildAIUserPrompt(sourceText, opts).trim()}`;
  return prompt;
}

// Copies text to the OS clipboard, trying the modern async API first and
// falling back to a hidden-textarea + execCommand('copy') for contexts
// where navigator.clipboard is unavailable or blocked (e.g. non-HTTPS,
// some older Chromium extension pages). Returns true/false rather than
// throwing so callers can show an inline fallback instead of an error.
async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* fall through to the legacy path below */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) { return false; }
}

// The "Copy / Paste" mode counterpart to generateCardsFromText() — same
// parse + applyMultiAnswerShape() pipeline, just skipping the network call
// entirely since the reply already exists as pasted/imported text. Never
// throws (there's no request that can fail); an empty `cards` array with
// `raw` populated means "nothing parseable was found in what you pasted",
// same convention as the API path uses for its own empty-parse case.
function parseManualAIReply(raw) {
  // Fine-tuned mode is always JSON (same q/a-tolerant parser as the API
  // path) regardless of the normal-mode-only aiJsonMode toggle.
  const jsonMode = state.settings.aiFineTuned || !!state.settings.aiJsonMode;
  const parsed = jsonMode ? parseAIJSONCards(raw) : parseAICardText(raw);
  const cards = parsed.map(applyMultiAnswerShape);
  return { cards, raw };
}

// Image/Emoji helpers
function readImageFile(file){return new Promise(function(res,rej){var r=new FileReader();r.onload=function(e){res(e.target.result);};r.onerror=function(){rej(new Error('fail'));};r.readAsDataURL(file);});}
function mkIcon(emoji,image,size,radius){size=size||'28px';radius=radius||'6px';if(image)return el('img',{src:image,style:'width:'+size+';height:'+size+';object-fit:cover;border-radius:'+radius+';flex-shrink:0'});return el('span',{style:'font-size:'+size+';line-height:1;flex-shrink:0'},emoji||'\u{1F4C1}');}
function mkIconPicker(curEmoji,curImg,onEmoji,onImg){
  var wrap=el('div',{style:'display:flex;align-items:center;gap:10px;margin-bottom:8px'});
  var prev=el('div',{style:'width:52px;height:52px;border-radius:10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0;overflow:hidden'});
  var _e=curEmoji||'\u{1F4D6}',_i=curImg||null;
  function up(){prev.innerHTML='';if(_i)prev.appendChild(el('img',{src:_i,style:'width:100%;height:100%;object-fit:cover'}));else prev.textContent=_e;}
  up();
  var ei=el('input',{type:'text',value:_e,style:'width:60px;text-align:center;font-size:22px;padding:6px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:var(--text);font-family:inherit'});
  ei.addEventListener('input',function(e){_e=e.target.value;_i=null;fi.value='';cb.style.display='none';onEmoji(_e);onImg(null);up();});
  var il=el('label',{style:'cursor:pointer;display:inline-flex;align-items:center;gap:4px;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);font-size:11px;font-weight:700;color:var(--muted);white-space:nowrap'},'\uD83D\uDDBC Photo');
  var fi=el('input',{type:'file',accept:'image/*',style:'display:none'});
  fi.addEventListener('change',async function(e){var f=e.target.files&&e.target.files[0];if(!f)return;var d=await readImageFile(f);_i=d;onImg(d);cb.style.display='';up();});
  il.appendChild(fi);
  var cb=el('button',{style:'display:'+(curImg?'':'none')+';padding:4px 8px;border-radius:6px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#ef4444;font-size:11px;cursor:pointer;font-family:inherit'},'\u2715 Clear');
  cb.addEventListener('click',function(){_i=null;fi.value='';onImg(null);cb.style.display='none';up();});
  var right=el('div',{style:'display:flex;flex-direction:column;gap:6px'});
  right.append(el('div',{style:'font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.05em'},'Icon / Emoji'),el('div',{style:'display:flex;align-items:center;gap:6px'},ei,il,cb));
  wrap.append(prev,right);return wrap;
}
function mkCardImagePicker(label,curImg,onChange){
  var wrap=el('div',{style:'display:flex;flex-direction:column;gap:5px'});
  wrap.appendChild(el('div',{style:'font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.05em'},label));
  var row=el('div',{style:'display:flex;align-items:center;gap:8px'});
  var thumb=el('div',{style:'width:48px;height:36px;border-radius:6px;overflow:hidden;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);display:'+(curImg?'block':'none')});
  if(curImg)thumb.appendChild(el('img',{src:curImg,style:'width:100%;height:100%;object-fit:cover'}));
  var fl=el('label',{style:'cursor:pointer;display:inline-flex;align-items:center;gap:4px;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);font-size:11px;font-weight:700;color:var(--muted)'},'\uD83D\uDDBC Add Image');
  var finp=el('input',{type:'file',accept:'image/*',style:'display:none'});
  finp.addEventListener('change',async function(e){var f=e.target.files&&e.target.files[0];if(!f)return;var d=await readImageFile(f);onChange(d);thumb.innerHTML='';thumb.appendChild(el('img',{src:d,style:'width:100%;height:100%;object-fit:cover'}));thumb.style.display='block';clr.style.display='';});
  fl.appendChild(finp);
  var clr=el('button',{style:'display:'+(curImg?'':'none')+';padding:4px 8px;border-radius:6px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#ef4444;font-size:11px;cursor:pointer;font-family:inherit'},'\u2715');
  clr.addEventListener('click',function(){finp.value='';onChange(null);thumb.style.display='none';thumb.innerHTML='';clr.style.display='none';});
  row.append(thumb,fl,clr);wrap.appendChild(row);return wrap;
}
function today() { return new Date().toISOString().split('T')[0]; }

/** Human-readable "how long ago" for a card's `lastRated` timestamp (ms
 *  epoch). A card that's never been reviewed has `lastRated: null` (see
 *  sanitizeCard() in shared.js) — shown as "Never" rather than a bogus
 *  date. Used by the deck detail card grid, the study "refine" card
 *  picker, and anywhere else a last-studied readout is useful. */
function timeAgo(ts) {
  if (!ts) return 'Never';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'Just now';
  const MIN = 60000, HOUR = 3600000, DAY_MS = 86400000;
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m ago`;
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR)}h ago`;
  const days = Math.floor(diff / DAY_MS);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
/** Full date/time for a `lastRated` timestamp — used as a tooltip alongside
 *  the shorter timeAgo() readout so the exact moment is still one hover away. */
function fmtDateTime(ts) {
  if (!ts) return 'Never studied';
  return new Date(ts).toLocaleString('en-GB', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
/** Bumps the flashcard study streak at most once per day, resetting if a day was missed. */
function bumpStreak() {
  const d = today();
  if (state.lastStreakDate === d) return;
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  state.streak = state.lastStreakDate === yesterday ? state.streak + 1 : 1;
  state.lastStreakDate = d;
}
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}
function mkTag(label, color = 'var(--blue)') {
  return el('span', { class: 'tag', style: `background:color-mix(in srgb, ${color} 13%, transparent);color:${color};border:1px solid color-mix(in srgb, ${color} 27%, transparent);` }, label);
}
function gradText(text) { return el('span', { class: 'grad-text' }, text); }
function btn(label, variant = 'primary', opts = {}) {
  const b = el('button', { class: `btn btn-${variant}${opts.small ? ' btn-sm' : ''}${opts.full ? ' btn-full' : ''}` }, label);
  if (opts.onclick) b.addEventListener('click', opts.onclick);
  if (opts.disabled) b.disabled = true;
  return b;
}

// ── Custom color picker ───────────────────────────────────────────────────
// Replaces native <input type="color">, whose popup is positioned by the
// browser/OS and can render partially off-screen with no way for page code
// to move it. This version is a normal DOM element we render and position
// ourselves, so it's always clamped inside the viewport, and it's styled to
// match the rest of the dashboard (var(--surface2)/var(--border)/etc.)
function hexToHsv(hex) {
  hex = (hex || '#ffffff').replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}
function hsvToHex(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = n => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
const CP_SWATCHES = ['#5BCEFA','#F5A9B8','#22c55e','#FB923C','#A78BFA','#ef4444','#facc15','#ffffff','#0B0F14'];
/**
 * Opens a floating colour picker anchored to `anchorEl`, clamped so it never
 * renders off-screen. onChange(hex) fires live as the user drags/types.
 */
// Tracks the currently-open colour-picker popover (if any) so the global Escape
// handler below can close it — previously Escape only closed the command palette
// and the main modal, silently leaving an open colour picker's mouse trap up.
let _openColorPickerClose = null;

function openColorPicker(anchorEl, initialColor, onChange) {
  document.querySelectorAll('.cp-popover').forEach(p => p.remove());
  let { h, s, v } = hexToHsv(initialColor);

  const panel = el('div', { class: 'cp-popover', role: 'dialog', 'aria-label': 'Color picker', tabindex: '-1' });
  const svSquare = el('div', {
    class: 'cp-sv', tabindex: '0', role: 'slider', 'aria-label': 'Saturation and brightness',
    'aria-valuemin': '0', 'aria-valuemax': '100',
  }, el('div', { class: 'cp-sv-cursor' }));
  const hueTrack = el('div', {
    class: 'cp-hue', tabindex: '0', role: 'slider', 'aria-label': 'Hue',
    'aria-valuemin': '0', 'aria-valuemax': '359',
  }, el('div', { class: 'cp-hue-cursor' }));
  const hexInput = el('input', { type: 'text', class: 'cp-hex-input', maxlength: '7', 'aria-label': 'Hex color code' });
  const preview = el('div', { class: 'cp-preview' });
  const swatchRow = el('div', { class: 'cp-swatches' });
  CP_SWATCHES.forEach(sw => {
    const setSwatch = () => { ({ h, s, v } = hexToHsv(sw)); commit(); };
    swatchRow.appendChild(el('div', {
      class: 'cp-swatch', style: `background:${sw}`, tabindex: '0', role: 'button', 'aria-label': `Set color to ${sw}`,
      onclick: setSwatch,
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSwatch(); } },
    }));
  });
  panel.append(svSquare, hueTrack, el('div', { class: 'cp-hex-row' }, preview, hexInput), swatchRow);

  function render() {
    const svCursor = svSquare.firstChild, hueCursor = hueTrack.firstChild;
    svSquare.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${h},100%,50%))`;
    svCursor.style.left = `${s * 100}%`;
    svCursor.style.top = `${(1 - v) * 100}%`;
    hueCursor.style.left = `${(h / 360) * 100}%`;
    const hex = hsvToHex(h, s, v);
    preview.style.background = hex;
    if (document.activeElement !== hexInput) hexInput.value = hex;
    // aria-valuenow/valuetext describe the slider's current position for screen
    // readers — svSquare reports both axes since it's a single 2D control.
    svSquare.setAttribute('aria-valuenow', Math.round(v * 100));
    svSquare.setAttribute('aria-valuetext', `Saturation ${Math.round(s * 100)}%, brightness ${Math.round(v * 100)}%`);
    hueTrack.setAttribute('aria-valuenow', Math.round(h));
  }
  function commit() { render(); onChange(hsvToHex(h, s, v)); }
  render();

  function dragOn(track, handler) {
    track.addEventListener('pointerdown', e => {
      track.setPointerCapture(e.pointerId);
      handler(e);
      const move = ev => handler(ev);
      track.addEventListener('pointermove', move);
      track.addEventListener('pointerup', () => track.removeEventListener('pointermove', move), { once: true });
    });
  }
  dragOn(svSquare, e => {
    const r = svSquare.getBoundingClientRect();
    s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    v = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    commit();
  });
  dragOn(hueTrack, e => {
    const r = hueTrack.getBoundingClientRect();
    h = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * 360;
    commit();
  });
  // Arrow-key control: Left/Right/Up/Down step by a small amount, Shift+arrow steps
  // by 10x for faster large adjustments — same "small step, big step with modifier"
  // convention as native <input type="range">.
  svSquare.addEventListener('keydown', e => {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowLeft')  { s = Math.max(0, s - step); e.preventDefault(); commit(); }
    else if (e.key === 'ArrowRight') { s = Math.min(1, s + step); e.preventDefault(); commit(); }
    else if (e.key === 'ArrowUp')    { v = Math.min(1, v + step); e.preventDefault(); commit(); }
    else if (e.key === 'ArrowDown')  { v = Math.max(0, v - step); e.preventDefault(); commit(); }
  });
  hueTrack.addEventListener('keydown', e => {
    const step = e.shiftKey ? 20 : 5;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown')  { h = (h - step + 360) % 360; e.preventDefault(); commit(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { h = (h + step) % 360; e.preventDefault(); commit(); }
  });
  hexInput.addEventListener('input', () => {
    const val = hexInput.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(val)) { ({ h, s, v } = hexToHsv(val)); onChange(val); }
  });

  document.body.appendChild(panel);
  const r = anchorEl.getBoundingClientRect();
  requestAnimationFrame(() => {
    const pr = panel.getBoundingClientRect();
    let left = r.left, top = r.bottom + 8;
    if (left + pr.width > window.innerWidth - 12) left = window.innerWidth - pr.width - 12;
    if (left < 12) left = 12;
    if (top + pr.height > window.innerHeight - 12) top = r.top - pr.height - 8;
    if (top < 12) top = 12;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.classList.add('open');
    svSquare.focus(); // move focus into the popover so keyboard users land somewhere operable immediately
  });

  function onDocPointer(e) {
    if (!panel.contains(e.target) && e.target !== anchorEl && !anchorEl.contains(e.target)) close();
  }
  function close() {
    document.removeEventListener('pointerdown', onDocPointer);
    panel.remove();
    if (_openColorPickerClose === close) _openColorPickerClose = null;
    anchorEl.focus?.(); // return focus to whatever triggered the picker, per standard dialog-closing convention
  }
  _openColorPickerClose = close;
  setTimeout(() => document.addEventListener('pointerdown', onDocPointer), 0);
  return { close };
}
function rgbStringToHex(rgbStr) {
  const m = rgbStr.match(/\d+/g);
  if (!m) return '#000000';
  const toHex = n => (+n).toString(16).padStart(2, '0');
  return `#${toHex(m[0])}${toHex(m[1])}${toHex(m[2])}`;
}
/** Turns any element into a click-to-open colour swatch wired to openColorPicker. */
function mkColorSwatch(initialColor, onChange, size = '32px') {
  const swatch = el('div', { class: 'cp-trigger', style: `width:${size};height:${size};background:${initialColor}` });
  swatch.addEventListener('click', () => {
    const resolved = /^#[0-9a-fA-F]{3,6}$/.test(initialColor) ? initialColor : rgbStringToHex(getComputedStyle(swatch).backgroundColor);
    openColorPicker(swatch, resolved, hex => { swatch.style.background = hex; onChange(hex); });
  });
  return swatch;
}

function addXP(n) {
  if (!n) return;
  store.addXPToTracker(n).then(() => renderSidebar());
}
function showToast(msg, dur = 2500, action = null) {
  const t = document.getElementById('toast');
  t.innerHTML = '';
  const msgSpan = document.createElement('span');
  msgSpan.textContent = msg;
  t.appendChild(msgSpan);
  if (action) {
    const actionBtn = document.createElement('button');
    actionBtn.textContent = action.label;
    actionBtn.className = 'toast-action-btn';
    actionBtn.onclick = () => {
      t.classList.add('hidden');
      clearTimeout(showToast._t);
      action.onClick();
    };
    t.appendChild(actionBtn);
  }
  t.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.add('hidden'), dur);
}

function getDeckCards(scope) {
  if (scope.type === 'deck') return state.decks.find(d => d.id === scope.id)?.cards || [];
  if (scope.type === 'folder') {
    const ids = [scope.id, ...getDescendantFolderIds(scope.id)];
    return state.decks.filter(d => ids.includes(d.folderId)).flatMap(d => d.cards);
  }
  if (scope.type === 'subject') return state.decks.filter(d => (d.subject || DEFAULT_SUBJECT_KEY) === scope.id).flatMap(d => d.cards);
  return state.decks.flatMap(d => d.cards);
}
/** Merges the built-in SUBJECTS with any Mark Tracker custom subjects, so
 *  flashcard decks/folders can be tagged with — and correctly display — a
 *  subject the user only created in the Tracker, keeping the two systems'
 *  subject lists in sync. Always prefer this over the raw SUBJECTS constant
 *  anywhere a deck/folder subject is being looked up or listed. */
function getAllSubjects() {
  return (typeof getEffectiveSubjects === 'function') ? getEffectiveSubjects(state.trackerState) : SUBJECTS;
}
/** Looks up a subject by key and GUARANTEES a real object back, even if `key` doesn't
 *  exist, is undefined/null, or is DEFAULT_SUBJECT_KEY itself but the user has hidden/
 *  removed it from the Mark Tracker. Use this (not `getAllSubjects()[x] || getAllSubjects().misc`)
 *  anywhere a subject is being resolved for display, since that old pattern's own fallback
 *  could resolve to undefined and throw when reading .name/.short/.defaultColor. */
function getSubjectSafe(key) {
  const subjects = getAllSubjects();
  return subjects[key] || subjects[DEFAULT_SUBJECT_KEY] || FALLBACK_SUBJECT;
}
function getDescendantFolderIds(folderId) {
  const children = state.folders.filter(f => f.parentId === folderId).map(f => f.id);
  return children.flatMap(id => [id, ...getDescendantFolderIds(id)]);
}

// ── Multi-scope study selection (Study page 'Recents' + deck explorer overlay) ──
function scopeKey(scope) { return `${scope.type}:${scope.id}`; }
function scopeLabel(scope) {
  if (scope.type === 'all') return { icon:'🌍', label:'All Decks' };
  if (scope.type === 'deck') { const d=state.decks.find(x=>x.id===scope.id); return d?{icon:d.emoji||'📚',label:d.name}:{icon:'🃏',label:'(deleted deck)'}; }
  if (scope.type === 'folder') { const f=state.folders.find(x=>x.id===scope.id); return f?{icon:f.emoji||'📁',label:f.name}:{icon:'📁',label:'(deleted folder)'}; }
  if (scope.type === 'subject') { const s=getSubjectSafe(scope.id); return {icon:'📘',label:s.short||s.name}; }
  return { icon:'❓', label:'Unknown' };
}
function scopeSetLabel(scopes) {
  if (!scopes || !scopes.length) return { icon:'🌍', label:'All Decks' };
  if (scopes.length === 1) return scopeLabel(scopes[0]);
  return { icon:'🧩', label:`${scopes.length} selected` };
}
function sameScopeSet(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  const ak = a.map(scopeKey).sort().join('|'), bk = b.map(scopeKey).sort().join('|');
  return ak === bk;
}
/** Unions the cards covered by a set of scopes, de-duplicated by card id
 *  (so selecting a folder AND a deck inside that folder doesn't double-count). */
function getScopeSetCards(scopes) {
  if (!scopes || !scopes.length || scopes.some(s=>s.type==='all')) return state.decks.flatMap(d=>d.cards);
  const seen = new Map();
  scopes.forEach(s => getDeckCards(s).forEach(c => seen.set(c.id, c)));
  return [...seen.values()];
}
/** Narrows a scope's card set further, per the Study page's "Refine"
 *  control (state.studyRefine) — layered on top of getScopeSetCards()'s
 *  deck/folder/subject scoping, not a replacement for it:
 *   - 'cards': exactly the hand-picked cardIds (via the card picker modal),
 *     intersected with the current scope so stale picks from a scope that's
 *     since changed just silently drop out rather than resurrecting cards
 *     no longer in scope.
 *   - 'stale': the N cards least-recently studied (lowest `lastRated`;
 *     never-studied cards have `lastRated: null`, which sorts first —
 *     i.e. "longest ago" includes "never" at the front, as expected).
 *   - 'ease': the N cards with the lowest ('hardest') or highest
 *     ('easiest') `ease`, per `refine.easeDir`.
 *  Falls through to the untouched card list for mode 'all' or an
 *  unrecognized mode, and for 'cards' before anything's been picked yet
 *  (an empty pick isn't "study nothing", it's "not refining yet"). */
function applyStudyRefine(cards, refine) {
  if (!refine || refine.mode === 'all') return cards;
  if (refine.mode === 'cards') {
    if (!refine.cardIds || !refine.cardIds.length) return cards;
    const idSet = new Set(refine.cardIds);
    return cards.filter(c => idSet.has(c.id));
  }
  if (refine.mode === 'stale') {
    const n = Math.max(1, refine.n || 20);
    return [...cards].sort((a,b) => (a.lastRated||0) - (b.lastRated||0)).slice(0, n);
  }
  if (refine.mode === 'ease') {
    const n = Math.max(1, refine.n || 20);
    const sorted = [...cards].sort((a,b) => refine.easeDir === 'easiest' ? (b.ease - a.ease) : (a.ease - b.ease));
    return sorted.slice(0, n);
  }
  return cards;
}
/** Records an applied scope selection into the persisted Recents quick-access list. */
function pushRecentScope(scopes) {
  if (!scopes || !scopes.length) return;
  const key = scopes.map(scopeKey).sort().join('|');
  const existing = state.recentStudyScopes.find(r => r.key === key);
  const pinned = existing?.pinned || false;
  state.recentStudyScopes = state.recentStudyScopes.filter(r => r.key !== key);
  const { icon, label } = scopeSetLabel(scopes);
  state.recentStudyScopes.unshift({ key, scopes: JSON.parse(JSON.stringify(scopes)), icon, label, ts: Date.now(), pinned });
  // Pinned entries are never evicted; only the unpinned tail is capped.
  const pinnedEntries = state.recentStudyScopes.filter(r => r.pinned);
  const unpinnedEntries = state.recentStudyScopes.filter(r => !r.pinned).slice(0, 8);
  state.recentStudyScopes = [...pinnedEntries, ...unpinnedEntries];
  scheduleSave();
}
/** Pinned recents first (most-recent-first among pinned), then unpinned by recency. */
function orderedRecentScopes() {
  return [...state.recentStudyScopes].sort((a,b) => (b.pinned?1:0)-(a.pinned?1:0) || b.ts-a.ts);
}
function toggleRecentPin(key) {
  const r = state.recentStudyScopes.find(x => x.key === key);
  if (r) { r.pinned = !r.pinned; scheduleSave(); }
}
/** A single scope-pill: main click applies the scope, optional 📌 toggles pinning. */
function mkScopePill(icon, label, active, onClick, pinInfo) {
  const wrap = el('div',{style:`display:inline-flex;align-items:center;border-radius:20px;overflow:hidden;background:${active?'var(--grad)':'rgba(255,255,255,0.08)'}`});
  wrap.appendChild(el('button',{style:`padding:7px 10px;border:none;cursor:pointer;background:transparent;color:${active?'var(--on-gradient)':'var(--text)'};font-family:inherit;font-weight:700;font-size:12px`,onclick:onClick},`${icon} ${label}`));
  if (pinInfo) {
    wrap.appendChild(el('button',{title:pinInfo.pinned?'Unpin':'Pin to keep this at the top',style:`padding:6px 8px 6px 2px;border:none;cursor:pointer;background:transparent;font-size:12px;opacity:${pinInfo.pinned?1:0.5}`,onclick:e=>{ e.stopPropagation(); pinInfo.onToggle(); }},'📌'));
  }
  return wrap;
}
// ── Multi-answer cards ──────────────────────────────────────────────
// A multi-answer card stores each accepted answer on its own line in
// `back` (see sanitizeCard() in shared.js and openCardModal() in
// dashboard-decks.js, which builds/edits that layout). This pulls the
// individual answers back out, trimmed and with blank lines dropped, and
// always returns at least one element (falling back to the raw `back`
// string) so callers never have to special-case an empty array.
function getCardAnswers(card) {
  const lines = (card?.back || '').split('\n').map(s => s.trim()).filter(Boolean);
  return lines.length ? lines : [(card?.back || '').trim()];
}
// Plain-text display form of a card's back, used anywhere it's shown outside
// study mode (flashcard reveal, card list preview). Multi-answer cards store
// each answer on its own line, which HTML collapses to a single run-together
// line by default — join with ", " instead so all answers stay legible.
function formatCardBack(card) {
  if (card?.type === 'process') return getCardAnswers(card).join(' → ');
  if (card?.type === 'calculation') return card.calcUnit ? `${card.back || ''} ${card.calcUnit}` : (card?.back || '');
  return (card?.answerCount || 1) > 1 ? getCardAnswers(card).join(', ') : (card?.back || '');
}
// Front-text display form of a card, used anywhere the question is shown
// outside the card editor (flashcard front, quiz/gaps prompt, deck card-list
// preview, PDF export). Mark-scheme cards store their raw question in `front`
// with no mark count baked in, so editing the marks later can't leave stale
// text behind — the "(N marks)" suffix is appended here from the single
// source of truth (requiredAnswers, i.e. how many marking points are needed
// for full marks), matching how exam papers print "[4 marks]" after a question.
function formatCardFront(card) {
  const front = card?.front || '';
  if (card?.type === 'markscheme' || card?.type === 'process') {
    const marks = Math.min(Math.max(card.answerCount || 1, 1), Math.max(1, card.requiredAnswers || card.answerCount || 1));
    return `${front} (${marks} mark${marks === 1 ? '' : 's'})`;
  }
  if (card?.type === 'calculation') {
    const marks = 1 + Math.max(0, card.methodRequired || 0);
    return `${front} (${marks} mark${marks === 1 ? '' : 's'})`;
  }
  if (card?.type === 'table') {
    const marks = Math.max(1, getTableBlanks(card).length);
    return `${front} (${marks} mark${marks === 1 ? '' : 's'})`;
  }
  return front;
}

// Lowercased blob of every searchable string on a card, for the deck-detail
// card search (see renderCards() in openDeckDetail, dashboard-decks.js).
// Plain/multi-answer/markscheme/process cards are already fully covered by
// front+back (their pool lives in `back`, one line per answer/point/step),
// but two types keep their real content *outside* front/back entirely:
// `table` (front is just the instruction text; the grid lives in
// `tableData`) and `calculation` (`back` is only the bare numeric answer —
// the unit and any method-marks pool aren't in it). Without this, searching
// a deck for e.g. a table's row label or a calc card's unit/method text
// would silently never match, even though that's exactly the content the
// card is "about".
function cardSearchBlob(card) {
  const parts = [card?.front || '', card?.back || ''];
  if (card?.type === 'table' && card.tableData) {
    (card.tableData.columns || []).forEach(c => { if (c.label) parts.push(c.label); if (c.group) parts.push(c.group); });
    (card.tableData.rows || []).forEach(row => {
      (card.tableData.columns || []).forEach(c => { const v = row?.[c.key]; if (v != null && v !== '') parts.push(String(v)); });
    });
  }
  if (card?.type === 'calculation') {
    if (card.calcUnit) parts.push(card.calcUnit);
    (card.methodPool || []).forEach(p => { if (p) parts.push(p); });
  }
  return latexApproximate(parts.join(' \n ')).toLowerCase();
}

// ── Calculation card matching: numeric comparator (tolerance/rounding,
// unit-aware, accepts equivalent forms like `0.5` vs `1/2` vs `50%`) ────────
// Parses a raw string into {value, unit}. Recognizes a fraction ("1/2"), a
// percentage ("50%", value stored as the fraction 0.5 — so a card whose
// answer is "50%" and one whose answer is "0.5" grade identically), or a
// plain decimal, each with an optional unit token stuck to either side
// ("12kg", "$12", "12 m/s"). Returns null if nothing numeric could be found,
// so callers can treat an unparseable answer as simply wrong rather than
// throwing partway through a study session.
function parseNumericAnswer(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  // Percentage: strip a trailing % (with optional space before it) and divide by 100.
  let m = s.match(/^([+-]?[\d,.]+)\s*%$/);
  if (m) {
    const n = parseFloat(m[1].replace(/,/g, ''));
    return Number.isFinite(n) ? { value: n / 100, unit: null } : null;
  }
  // Fraction: a/b, unit (if any) trails the fraction.
  m = s.match(/^([+-]?\d+)\s*\/\s*(\d+)\s*([a-zA-Z°%/]*)$/);
  if (m) {
    const num = parseFloat(m[1]), den = parseFloat(m[2]);
    if (den === 0 || !Number.isFinite(num) || !Number.isFinite(den)) return null;
    return { value: num / den, unit: m[3] ? m[3].trim() : null };
  }
  // Plain number, optionally with a unit stuck to the front ("$12") or back ("12kg", "12 m/s").
  m = s.match(/^([a-zA-Z°$£€]*)\s*([+-]?[\d,]*\.?\d+)\s*([a-zA-Z°%/²³]*)$/);
  if (m) {
    const n = parseFloat(m[2].replace(/,/g, ''));
    if (!Number.isFinite(n)) return null;
    const unit = (m[1] || m[3] || '').trim();
    return { value: n, unit: unit || null };
  }
  return null;
}
// Light unit normalization so trivial formatting differences ("M/S" vs "m/s",
// stray spaces, a handful of common symbol/word aliases) don't fail a
// numerically-correct answer. Not a real unit-conversion system — it compares
// the *label* the card was authored with against the label the user typed,
// it doesn't convert between different units (e.g. cm vs m).
const UNIT_ALIASES = { 'percent': '%', 'pct': '%', 'degrees': '°', 'degree': '°', 'deg': '°', 'metres': 'm', 'meters': 'm', 'seconds': 's', 'secs': 's', 'sec': 's', 'kilograms': 'kg', 'grams': 'g' };
function normalizeUnit(u) {
  if (!u) return '';
  const n = String(u).trim().toLowerCase().replace(/\s+/g, '');
  return UNIT_ALIASES[n] || n;
}
// Rounds `value` to `n` significant figures (n clamped to [1,10] — matches the
// range enforced on the tolerance input in openCardModal). Used by both
// calcMatch() and tableCellMatch() when their tolerance mode is 'sigfig':
// an answer counts as correct if it rounds to the same value as the expected
// answer at that many significant figures, rather than an absolute/percent
// margin. Returns 0 unchanged (toPrecision on 0 is meaningless/throws for
// some inputs) and falls back to the plain value if it isn't finite.
function roundToSigFigs(value, n) {
  if (!Number.isFinite(value) || value === 0) return value;
  const sig = Math.min(10, Math.max(1, Math.round(n) || 3));
  return Number(value.toPrecision(sig));
}
// Grades a calculation card's typed final-answer against card.back/calcUnit,
// returning 'correct' | 'close' | 'wrong'. 'close' covers "right number, unit
// missing/wrong" (calcUnit set) so the UI can show it as partial credit
// rather than flatly wrong, matching every other mode's three-tier result.
function calcMatch(userRaw, card) {
  const expected = parseNumericAnswer(card.back);
  const got = parseNumericAnswer(userRaw);
  if (!expected || !got) return 'wrong';
  let withinTolerance;
  if (card.calcToleranceMode === 'sigfig') {
    withinTolerance = roundToSigFigs(got.value, card.calcTolerance) === roundToSigFigs(expected.value, card.calcTolerance);
  } else {
    const tol = card.calcToleranceMode === 'pct'
      ? Math.abs(expected.value) * ((card.calcTolerance || 0) / 100)
      : (card.calcTolerance || 0);
    // A small fixed epsilon on top of the authored tolerance absorbs floating-
    // point noise (e.g. 0.1+0.2) even when calcTolerance is left at 0.
    withinTolerance = Math.abs(got.value - expected.value) <= (tol + 1e-9);
  }
  if (!withinTolerance) return 'wrong';
  const expectedUnit = normalizeUnit(card.calcUnit || expected.unit);
  if (!expectedUnit) return 'correct';
  return normalizeUnit(got.unit) === expectedUnit ? 'correct' : 'close';
}

// ── Table card matching: a grid (see sanitizeCard()'s tableData in
// shared.js) where some cells are given and some are `null` blanks. Each
// blank is graded independently with the same numeric comparator
// calculation cards use (parseNumericAnswer/normalizeUnit), sharing one
// tolerance/unit setting across the whole table — see
// renderTableQuizCard() in dashboard-study.js.
// Picks which manual combination to pose this rep — random among the
// card's authored/reviewed combinations, so a table card with several
// variants doesn't show the identical blanks every time it's studied while
// never posing an unreviewed (potentially unsolvable) set. Falls back to an
// all-blank-free combo if the card has none yet (e.g. mid-creation preview).
function pickTableCombination(card) {
  const combos = card?.tableData?.combinations || [];
  if (!combos.length) return { name: '', cells: (card?.tableData?.rows || []).map(() => []) };
  return combos[Math.floor(Math.random() * combos.length)];
}
// Flat list of blanks for one specific combination, each carrying its own
// correct answer straight from the answer-key row: {rowIndex, colKey,
// expected}. A row can have more than one blank (cells[rowIndex] is a list
// of column keys, not a single one). Skips any cell reference whose
// row/column no longer exists (e.g. a row deleted after the combination was
// authored) rather than throwing mid-study-session.
function getTableBlanks(card, combo) {
  const rows = card?.tableData?.rows || [];
  const c = combo || pickTableCombination(card);
  const blanks = [];
  (c.cells || []).forEach((colKeys, rowIndex) => {
    (Array.isArray(colKeys) ? colKeys : (colKeys ? [colKeys] : [])).forEach(colKey => {
      if (colKey && rows[rowIndex] && Object.prototype.hasOwnProperty.call(rows[rowIndex], colKey)) {
        blanks.push({ rowIndex, colKey, expected: rows[rowIndex][colKey] });
      }
    });
  });
  return blanks;
}
// Grades one typed value against a blank's correct answer (from
// getTableBlanks()'s `expected`). Returns 'correct' | 'close' | 'wrong',
// exactly like calcMatch().
function tableCellMatch(userRaw, expectedRaw, card) {
  const expected = parseNumericAnswer(expectedRaw);
  const got = parseNumericAnswer(userRaw);
  if (!expected || !got) {
    // Non-numeric cell (e.g. a label) — fall back to lenient text match.
    const norm = s => latexApproximate(String(s ?? '')).toLowerCase().replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ').trim();
    return norm(userRaw) && norm(userRaw) === norm(expectedRaw) ? 'correct' : 'wrong';
  }
  let withinTolerance;
  if (card.tableToleranceMode === 'sigfig') {
    withinTolerance = roundToSigFigs(got.value, card.tableTolerance) === roundToSigFigs(expected.value, card.tableTolerance);
  } else {
    const tol = card.tableToleranceMode === 'pct'
      ? Math.abs(expected.value) * ((card.tableTolerance || 0) / 100)
      : (card.tableTolerance || 0);
    withinTolerance = Math.abs(got.value - expected.value) <= (tol + 1e-9);
  }
  if (!withinTolerance) return 'wrong';
  if (!expected.unit) return 'correct';
  return normalizeUnit(got.unit) === normalizeUnit(expected.unit) ? 'correct' : 'close';
}

// ── Process card matching: like markschemeMatch, but checks a step's
// keyword OR any user-added synonym for that step, since a single required
// keyword is often too rigid for a process/causal-chain answer ("enrichment"
// vs "eutrophication" vs "excess nutrients" should all count as the same
// step). exact mode still requires one of the phrases verbatim.
function processStepMatch(userAnswer, keyword, synonyms, exact) {
  if (markschemeMatch(userAnswer, keyword, exact)) return true;
  return (synonyms || []).some(syn => markschemeMatch(userAnswer, syn, exact));
}
function quizMatch(user, correct) {
  const norm = s => latexApproximate(s).toLowerCase().replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ').trim();
  const u = norm(user), c = norm(correct);
  if (!u) return 'wrong';
  if (u === c || c.includes(u) || u.includes(c)) return 'correct';
  const uw = new Set(u.split(' ')), cw = c.split(' ');
  const ratio = cw.filter(w => uw.has(w)).length / Math.max(cw.length, uw.size);
  return ratio >= 0.75 ? 'correct' : ratio >= 0.4 ? 'close' : 'wrong';
}
function quizMatchExact(user, correct) {
  const norm = s => latexApproximate(s).toLowerCase().replace(/\s+/g,' ').trim();
  return norm(user) === norm(correct) ? 'correct' : 'wrong';
}
// Mark-scheme keyword spotting: unlike quizMatch (which compares two short,
// roughly-equal-length answers), a mark-scheme answer is a full paragraph that
// a single keyword/point should be found *within* — so this checks for the
// keyword phrase as a substring of the (normalized) answer rather than overall
// similarity between the two. Exact mode requires the whole phrase verbatim;
// fuzzy mode also accepts most of a multi-word keyword's significant words
// appearing anywhere in the answer, so a paraphrase of the same point still
// counts (e.g. "moves down its concentration gradient" for keyword "concentration
// gradient").
function markschemeMatch(userAnswer, keyword, exact) {
  const norm = s => latexApproximate(s).toLowerCase().replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ').trim();
  const u = norm(userAnswer), k = norm(keyword);
  if (!u || !k) return false;
  if (u.includes(k)) return true;
  if (exact) return false;
  const words = k.split(' ').filter(w => w.length > 2);
  if (!words.length) return false;
  const hits = words.filter(w => u.includes(w)).length;
  return (hits / words.length) >= 0.7;
}

// ── Custom + built-in preset registry ───────────────────────────────
// Returns all presets as { key, name, theme, isCustom } entries,
// built-ins first then user presets. Keys for user presets are
// 'custom_<timestamp>' (stable after creation).
function getAllPresets() {
  const builtIn = Object.entries(THEME_PRESETS).map(([key, p]) => ({ key, name: p.name, theme: p, isCustom: false }));
  const custom  = (state.settings.customPresets || []).map(p => ({ key: p.key, name: p.name, theme: p.theme, isCustom: true }));
  return [...builtIn, ...custom];
}

// ── Tab order / visibility (Settings → Navigation) ──────────────────
// Returns NAV_ITEMS in the user's saved order, tolerating a stale saved
// order (e.g. after an update adds a new tab — it gets appended at the end
// rather than silently disappearing).
function getOrderedNavItems() {
  const byId = Object.fromEntries(NAV_ITEMS.map(n => [n.id, n]));
  const order = (state.settings.navOrder || []).filter(id => byId[id]);
  const ordered = order.map(id => byId[id]);
  NAV_ITEMS.forEach(n => { if (!order.includes(n.id)) ordered.push(n); });
  return ordered;
}
function getVisibleNavItems() {
  const hidden = new Set(state.settings.hiddenTabs || []);
  return getOrderedNavItems().filter(n => !hidden.has(n.id));
}
function getHiddenNavItems() {
  const hidden = new Set(state.settings.hiddenTabs || []);
  return getOrderedNavItems().filter(n => hidden.has(n.id));
}
let navDrawerOpen = false; // hidden-tabs drawer at the bottom of the sidebar, collapsed by default

// ── Pinned decks (top of the left sidebar, above the tab list) ──────
function togglePinDeck(deckId) {
  const deck = state.decks.find(d => d.id === deckId);
  if (!deck) return;
  deck.pinned = !deck.pinned;
  scheduleSave(); renderSidebar();
  if (state.view === 'decks') renderView('decks'); // pin button lives on deck cards too — refresh its icon there
}

function navigate(viewId) {
  if (viewId !== 'study' && typeof clearQuizTimer === 'function') clearQuizTimer();
  state.view = viewId;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === viewId));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${viewId}`));
  renderView(viewId);
}
function renderView(id) {
  const c = document.getElementById(`view-${id}`);
  if (!c) return;
  c.innerHTML = '';
  // Flashcard views
  const fcMap = { home: renderHome, decks: renderDecks, study: renderStudy, capture: renderCapture,
    library: renderLibrary, analytics: renderAnalytics, quests: renderQuests, settings: renderSettings };
  if (fcMap[id]) { fcMap[id](c); return; }
  // Tracker views — delegate to tracker render fns that use state.trackerState
  const sub = id.replace('tracker-', '');
  const trMap = {
    overview: renderTrackerOverview, logmarks: renderTrackerLogMarks,
    subjects: renderTrackerSubjects, history: renderTrackerHistory,
    managesubjects: renderTrackerManageSubjects, trackersettings: renderTrackerSettings,
  };
  if (trMap[sub]) trMap[sub](c);
}

function renderSidebar() {
  const totalXP = state.trackerState?.totalXP || 0;
  const { level, xpIntoLevel, xpForNextLevel } = levelFromXP(totalXP);
  document.getElementById('xp-level').textContent = `Lv.${level}`;
  document.getElementById('xp-fill').style.width = `${Math.min(100,(xpIntoLevel/xpForNextLevel)*100)}%`;
  document.getElementById('xp-label').textContent = `${fmtXP(xpIntoLevel)}/${fmtXP(xpForNextLevel)}`;

  const isNarrow = window.innerWidth <= 720;

  // Pinned decks — quick-access shortcuts above the tab list
  const pinWrap = document.getElementById('pinned-decks');
  pinWrap.innerHTML = '';
  const pinned = state.decks.filter(d => d.pinned);
  if (pinned.length) {
    pinWrap.appendChild(el('div', { class: 'nav-section-label', style: 'padding-top:8px' }, isNarrow ? '—' : '📌 Pinned'));
    pinned.forEach(deck => {
      const due = getDueCards(deck.cards).length;
      pinWrap.appendChild(el('div', { class: 'pinned-deck-row', onclick: () => openDeckDetail(deck.id) },
        el('span', { class: 'pinned-deck-emoji' }, deck.emoji || '📚'),
        el('span', { class: 'pinned-deck-name' }, deck.name),
        due > 0 ? el('span', { class: 'pinned-deck-due' }, String(due)) : null,
        el('button', { class: 'pinned-deck-study', title: 'Study now', onclick: e => { e.stopPropagation(); state.studyScope = [{ type:'deck', id:deck.id }]; navigate('study'); } }, '▶')
      ));
    });
  }

  const nav = document.getElementById('nav');
  nav.innerHTML = '';

  // Section dividers — inserted before the first item whose `section` changes
  let inTracker = false;
  let dragSrcId = null;

  getVisibleNavItems().forEach((n, idx) => {
    if (n.section === 'tracker' && !inTracker) {
      inTracker = true;
      // Below the icon-only sidebar breakpoint (720px), "— Mark Tracker —"
      // has no room to read as anything but garbled text, so it collapses
      // to a bare rule instead. Driven from JS (checked against actual
      // window width) rather than a CSS-only override, since a font-size:0
      // media-query rule here wasn't reliably taking effect.
      nav.appendChild(el('div', { class: 'nav-section-label' }, isNarrow ? '—' : '— Mark Tracker —'));
    }
    const shortcutNum = idx < 9 ? idx + 1 : null;
    const btn = el('button', {
      class: `nav-btn${state.view === n.id ? ' active' : ''}`,
      'data-view': n.id,
      draggable: 'true',
      onclick: () => navigate(n.id),
      title: shortcutNum ? `${n.label} (Alt+Shift+${shortcutNum})` : n.label,
    },
      el('span', { class: 'nav-icon' }, n.icon),
      el('span', { class: 'nav-label' }, n.label),
    );

    btn.addEventListener('dragstart', e => {
      dragSrcId = n.id;
      btn.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
    });
    btn.addEventListener('dragend', () => { btn.style.opacity = ''; });
    btn.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; btn.style.background = 'rgba(255,255,255,0.08)'; });
    btn.addEventListener('dragleave', () => { btn.style.background = ''; });
    btn.addEventListener('drop', e => {
      e.preventDefault();
      btn.style.background = '';
      if (!dragSrcId || dragSrcId === n.id) return;
      const order = state.settings.navOrder ? [...state.settings.navOrder] : NAV_ITEMS.map(x => x.id);
      const fromIdx = order.indexOf(dragSrcId);
      const toIdx   = order.indexOf(n.id);
      if (fromIdx === -1 || toIdx === -1) return;
      order.splice(fromIdx, 1);
      order.splice(toIdx, 0, dragSrcId);
      state.settings.navOrder = order;
      scheduleSave();
      renderSidebar();
    });
    nav.appendChild(btn);
  });

  // Hidden-tabs drawer — collapsed by default, tucked at the bottom of the
  // nav list so hiding a tab in Settings never means losing access to it.
  const hiddenItems = getHiddenNavItems();
  if (hiddenItems.length) {
    nav.appendChild(el('button', { class: `nav-drawer-toggle${navDrawerOpen ? ' open' : ''}`, onclick: () => { navDrawerOpen = !navDrawerOpen; renderSidebar(); } },
      el('span', { class: 'nav-drawer-chevron' }, '▸'), `Hidden (${hiddenItems.length})`));
    if (navDrawerOpen) {
      const drawer = el('div', { class: 'nav-drawer' });
      hiddenItems.forEach(n => {
        drawer.appendChild(el('button', { class: `nav-btn nav-btn-hidden${state.view === n.id ? ' active' : ''}`, onclick: () => navigate(n.id) },
          el('span', { class: 'nav-icon' }, n.icon), el('span', { class: 'nav-label' }, n.label)));
      });
      nav.appendChild(drawer);
    }
  }

  const fs = document.getElementById('footer-stats');
  fs.innerHTML = '';
  [['🔥',state.streak,'Streak'],['⭐',fmtXP(totalXP),'XP'],['🏆',level,'Level']].forEach(([ic,val,lab]) => {
    fs.appendChild(el('div', { class: 'foot-stat' },
      el('div', {}, ic), el('div', { class: 'fs-val' }, String(val)), el('div', { class: 'fs-lab' }, lab)));
  });
}

let _modalReturnFocus = null;
function openModal(title, bodyFn) {
  document.getElementById('modal-title').textContent = title;
  const body = document.getElementById('modal-body');
  body.innerHTML = '';
  bodyFn(body);
  document.getElementById('modal-backdrop').classList.remove('hidden');
  _modalReturnFocus = document.activeElement;
  document.getElementById('modal-box').focus();
}
function closeModal() {
  document.getElementById('modal-backdrop').classList.add('hidden');
  _modalReturnFocus?.focus?.();
  _modalReturnFocus = null;
}
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-backdrop').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-backdrop')) closeModal();
});

// ── Page help (the ⓘ button, top-left, on every screen) ─────────────
const PAGE_HELP = {
  home: { icon:'🏠', title:'Home', intro:'Your daily dashboard — a snapshot of what\u2019s due and quick access to your decks.', tips:[
    'The stat cards show cards due today, how many you\u2019ve reviewed, your retention %, and your day streak.',
    'The Daily Goal bar tracks today\u2019s review count against your target (change it in Settings).',
    'Click a deck\u2019s "Study Now" to jump straight into a session for that deck.',
    'Click 📌 on a deck card to pin it to the top of the sidebar for quick access.',
  ]},
  decks: { icon:'📚', title:'Decks', intro:'Organize your flashcards into decks, grouped by subject and folder.', tips:[
    'Browse by subject, then drill into folders and decks.',
    'Use the buttons at the top to create a new deck or folder.',
    'Drag and drop decks or folders onto each other to reorganize them.',
    'Open a deck to add, edit, reorder, or delete individual cards.',
    'Inside a deck: click a card to select it, Shift+click to select a range, Ctrl/Cmd+click to toggle individual cards, or click-and-drag across empty space to rubber-band select several at once.',
    'With cards selected, use "Move to Deck…" to move them into an existing deck or a brand-new one.',
    'Each deck shows how many cards are "mature" (well-learned) out of the total.',
  ]},
  study: { icon:'🧠', title:'Study', intro:'Pick a scope and a mode, then start a review session.', tips:[
    'Recents gives one-click access to scopes you\u2019ve studied before — "All Decks" is always pinned first. Click the 📌 on any recent to pin it too, so it stays put instead of aging out.',
    'Click "📂 Browse Decks…" to open the full deck explorer: browse Subjects → Folders → Decks and check any combination of them (even across different folders) to build a combined study scope.',
    'Modes: SRS Review (due cards, spaced repetition), Cram (all cards, no scheduling), Written Quiz (type your answer), Fill in the Gaps, Weakness (cards you struggle with), and Multiple Choice (pick the right answer from 4, basic cards only). A green Show Hint button in the corner works in any mode — using it halves that card\'s XP.',
    'During a card: click it (or Reveal) to see the answer, use Hint or Skip, then rate how well you knew it — Again / Hard / Good / Easy — which schedules when you\u2019ll see it next.',
    'Toggle "Show card images during study" if your cards have images and you\u2019d rather hide them.',
  ]},
  capture: { icon:'✏️', title:'Quick Add', intro:'Manually create a single flashcard without leaving this page.', tips:[
    'Choose which deck the card belongs to, then fill in Front and Back (both required).',
    'Optionally attach images, a hint, comma-separated tags, and a citation linking back to a Library source.',
    'The form clears itself after each save (keeping the same deck selected) so you can add cards back-to-back.',
  ]},
  library: { icon:'📖', title:'Library', intro:'Import book, PDF, EPUB, or article source texts so you can cite them from your flashcards.', tips:[
    '"+ Add Source" imports a file; "Import" brings in previously exported Library data.',
    'Use "New Folder" to organize sources into folders.',
    'Open a source to read it, and highlight text to cite it directly into a new or existing card.',
    'Cards linked to a citation show a 📖 badge and can jump back to the exact passage.',
  ]},
  analytics: { icon:'📊', title:'Analytics', intro:'Charts and stats on your learning performance over time.', tips:[
    'The heatmap and trend charts show your review activity and accuracy over time.',
    'Deck and subject breakdowns show mature-card progress at a glance.',
    'Use this page to spot which decks or subjects need more attention.',
  ]},
  quests: { icon:'🎯', title:'Quests & Achievements', intro:'Track your level, XP, streak, daily quests, and unlockable achievements.', tips:[
    'The header card shows your level, total XP, and current day streak.',
    'Quests tab: short-lived daily goals (e.g. review 20 cards today) that award bonus XP when completed — they reset each day.',
    'Achievements tab: permanent milestones for card count, review count, deck count, streak length, mature cards, citations, imported sources, and single-day review records. Each one unlocks once and stays unlocked.',
  ]},
  settings: { icon:'⚙️', title:'Settings', intro:'Configure the SRS algorithm, notifications, accessibility, and appearance.', tips:[
    'Algorithm & Notifications: choose FSRS or SM-2, auto-suspend leeches, enable text-to-speech or daily reminders, toggle power-saving mode.',
    'Study & Accessibility: set your Smart Definition language, pinyin display, dyslexia-friendly mode, high contrast, and where a book resumes when reopened.',
    'Further down: daily review goal, new cards per day, leech threshold, theme/appearance presets, and sidebar navigation order.',
    'Data Management: "Export All Data" downloads a complete .zip backup — every deck/card, folder, source (including bundled PDFs and illustrated EPUBs), review history, achievements, tracker data, streak, and recent study scopes. "Import" reads that .zip (or an older .json export) back in, either merging with or replacing your current data.',
  ]},
  'tracker-overview': { icon:'🌟', title:'XP Overview', intro:'The GCSE Mark Tracker\u2019s dashboard — a separate system from flashcards, for tracking exam marks by subject.', tips:[
    'The ring shows your tracker level and progress toward the next level.',
    'The monthly bars show how much of each subject\u2019s capped monthly XP you\u2019ve used.',
    'The recent list shows your latest logged mark sessions.',
  ]},
  'tracker-logmarks': { icon:'✏️', title:'Log Marks', intro:'Log a mark you scored on a paper or session to earn tracker XP.', tips:[
    'Pick a subject (it needs a predicted grade set in Tracker Settings first) and enter the marks scored.',
    'Optionally add the paper/session name, notes, and a linked Library source.',
    'Submitting awards XP based on that subject\u2019s predicted grade and the marks scored.',
  ]},
  'tracker-subjects': { icon:'📋', title:'Subjects', intro:'An overview card per subject: grade, total XP, total marks, sessions logged, and monthly cap usage.', tips:[
    'Use this to see at a glance which subjects you\u2019ve been neglecting.',
    '"XP/mark" shows how efficiently a subject converts marks into XP, based on its predicted grade.',
  ]},
  'tracker-history': { icon:'📅', title:'Mark History', intro:'A full log of every mark session you\u2019ve recorded.', tips:[
    'Filter the list by subject with the dropdown.',
    'Export your history to CSV.',
    'Delete an entry if you logged something by mistake.',
  ]},
  'tracker-managesubjects': { icon:'🗂️', title:'Manage Subjects', intro:'Add, edit, remove, or restore the subjects tracked by the Mark Tracker.', tips:[
    'Built-in subjects can be edited or removed; you can also add fully custom ones.',
    'Set each subject\u2019s name, short code, exam board, and total exam marks.',
    'Any subject you add here also becomes available when tagging a flashcard deck\u2019s subject in Decks, keeping the two systems in sync.',
  ]},
  'tracker-trackersettings': { icon:'🎛️', title:'Tracker Settings', intro:'Fine-tune predicted grades, subject colors, and XP configuration for the tracker.', tips:[
    'Set a predicted grade (1–9, decimals allowed) per subject — this determines how much XP each mark scored is worth.',
    'Customize each subject\u2019s color, used throughout the tracker\u2019s charts.',
    'Adjust XP configuration constants here if you want to change the tracker\u2019s overall XP curve.',
  ]},
};
function openPageHelp() {
  const info = PAGE_HELP[state.view] || PAGE_HELP.home;
  openModal(`${info.icon} ${info.title}`, body => {
    body.appendChild(el('div',{style:'font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:16px'},info.intro));
    const list=el('ul',{style:'padding-left:18px;display:flex;flex-direction:column;gap:10px;margin:0'});
    info.tips.forEach(t=>list.appendChild(el('li',{style:'font-size:13px;line-height:1.6'},t)));
    body.appendChild(list);
  });
}
document.getElementById('info-btn').addEventListener('click', openPageHelp);

let _cmdReturnFocus = null;
function closeCmd() {
  document.getElementById('cmd-backdrop').classList.add('hidden');
  _cmdReturnFocus?.focus?.();
  _cmdReturnFocus = null;
}
document.getElementById('cmd-hint').addEventListener('click', openCmd);
document.getElementById('cmd-backdrop').addEventListener('click', e => { if (e.target === document.getElementById('cmd-backdrop')) closeCmd(); });
const cmdList = document.getElementById('cmd-list');
function populateCmdPalette() {
  cmdList.innerHTML = '';
  const hidden = new Set(state.settings.hiddenTabs || []);
  getOrderedNavItems().forEach((n, idx) => {
    const badge = hidden.has(n.id) ? el('span', { class:'cmd-item-hint', style:'opacity:0.5' }, 'drawer') : el('span', { class:'cmd-item-hint' }, '↵');
    cmdList.appendChild(el('div', {
      class:'cmd-item', id:`cmd-item-${idx}`, role:'option', 'aria-selected':'false',
      'data-label':n.label.toLowerCase(), onclick:()=>{ navigate(n.id); closeCmd(); },
    },
      el('span', { class:'cmd-item-icon' }, n.icon),
      el('span', { class:'cmd-item-label' }, `Go to ${n.label}`),
      badge
    ));
  });
}
// NB: cmdList is intentionally left empty here — populateCmdPalette() (called from
// openCmd() below) is what actually fills it in, every time the palette opens, using
// the live/dynamic getOrderedNavItems() (which accounts for hidden tabs). A static
// NAV_ITEMS-based pre-population used to run here too, but since populateCmdPalette()
// always clears cmdList.innerHTML first, that pre-population was never visible.

// Which visible (non-filtered-out) item is currently highlighted, for ArrowUp/Down
// navigation below — previously the palette had NO keyboard path to actually select
// a filtered item at all, only mouse clicks.
let _cmdHighlightIdx = -1;
function _cmdVisibleItems() {
  return [...cmdList.querySelectorAll('.cmd-item')].filter(row => row.style.display !== 'none');
}
function _cmdSetHighlight(idx) {
  const visible = _cmdVisibleItems();
  visible.forEach(row => { row.classList.remove('cmd-item-highlighted'); row.setAttribute('aria-selected', 'false'); });
  if (!visible.length) { _cmdHighlightIdx = -1; document.getElementById('cmd-input').removeAttribute('aria-activedescendant'); return; }
  _cmdHighlightIdx = Math.max(0, Math.min(idx, visible.length - 1));
  const row = visible[_cmdHighlightIdx];
  row.classList.add('cmd-item-highlighted');
  row.setAttribute('aria-selected', 'true');
  row.scrollIntoView({ block: 'nearest' });
  document.getElementById('cmd-input').setAttribute('aria-activedescendant', row.id);
}
document.getElementById('cmd-input').addEventListener('input', e => {
  const q = e.target.value.toLowerCase();
  cmdList.querySelectorAll('.cmd-item').forEach(row => {
    row.style.display = (row.dataset.label || '').includes(q) ? '' : 'none';
  });
  _cmdSetHighlight(0); // re-highlight the first visible match whenever the filter changes
});
document.getElementById('cmd-input').addEventListener('keydown', e => {
  const visible = _cmdVisibleItems();
  if (e.key === 'ArrowDown') { e.preventDefault(); _cmdSetHighlight(_cmdHighlightIdx + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); _cmdSetHighlight(_cmdHighlightIdx - 1); }
  else if (e.key === 'Enter') { e.preventDefault(); visible[_cmdHighlightIdx]?.click(); }
});
function openCmd() {
  populateCmdPalette();
  document.getElementById('cmd-backdrop').classList.remove('hidden');
  document.getElementById('cmd-input').value = '';
  _cmdReturnFocus = document.activeElement;
  document.getElementById('cmd-input').focus();
  _cmdSetHighlight(0);
}
window.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openCmd(); }
  if (e.key === 'Escape') { closeCmd(); closeModal(); _openColorPickerClose?.(); }

  // Alt+Shift+1..9 → jump to the Nth tab in the sidebar, in the order the user
  // actually sees it (getVisibleNavItems() — respects their custom tab order +
  // hidden tabs). Deliberately not Ctrl/Cmd+1-9 (browsers already bind that to
  // switch between browser tabs) or plain Alt+1-9 (already bound to something in
  // Chrome on at least some platforms/configs).
  // Uses e.code (the physical key, e.g. 'Digit3'), not e.key — with Shift held,
  // e.key for the number row reports the *shifted* character (e.g. '!' for
  // Shift+1 on a US layout), not the digit, so matching on e.key never fired.
  const digitMatch = /^Digit([1-9])$/.exec(e.code);
  if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && digitMatch) {
    const target = document.activeElement;
    const isEditing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
      || target.tagName === 'SELECT' || target.isContentEditable);
    if (!isEditing) {
      const items = getVisibleNavItems();
      const item = items[Number(digitMatch[1]) - 1];
      if (item) { e.preventDefault(); navigate(item.id); }
    }
  }
});

function createField(labelText, type='text', placeholder='', isTextarea=false) {
  const wrap = el('div', { class: 'field' });
  if (labelText) wrap.appendChild(el('label', {}, labelText));
  wrap.appendChild(isTextarea ? el('textarea', { placeholder, rows:'3' }) : el('input', { type, placeholder }));
  return wrap;
}
