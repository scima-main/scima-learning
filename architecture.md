# SCIMA Learning — Architecture

(all file paths are relative to `./site/`)

How `./home` (the static frontend served at study.scima-net.com) and
`./backend` (the FastAPI community deck registry) fit together: what each
side owns, how they are mounted and routed, and the exact contracts that
cross the boundary.

Sibling directories not covered here: `./app` (Android client — independent
of the home↔backend boundary described here) and `./tests` (browser test
suite for `home/`; see `tests-and-tools/information.md`).

---

## 1. System overview

```
                        ┌──────────────────────────────────────────────┐
                        │                 browser tab                  │
                        │                                              │
   study.scima-net.com  │  home/  (static HTML+JS, no bundler)         │
 ─────────────────────▶ │  /  /decks/  /study/  /library/              │
      static files      │  /analytics/  /settings/  /about/            │
                        │        │                                     │
                        │        │ plain <script> tags, one global     │
                        │        │ scope; per-page slices (§3.2)       │
                        │        ▼                                     │
                        │  in-memory `state`  ◀── sanitize*() ── localStorage
                        │        │                  mf_state           │
                        │        │                  SCIMATracker       │
                        │        │                  <prefix>_blob_<id> │
                        │        │                                     │
                        │  dashboard-community.js (landing #community) │
                        └────────┼─────────────────────────────────────┘
                                 │  fetch(`${window.SCIMA_API_BASE || '/api/v1'}/…`)
                                 ▼
                        ┌──────────────────────────────────────────────┐
                        │        backend/  (FastAPI, uvicorn)          │
                        │  middleware: TrustedHost → CORS → body-cap   │
                        │            → static revalidation             │
                        │  /api/v1/health|decks|search|…export  (§4.3) │
                        │  mounts: /dashboard  /community  /  (§4.2)   │
                        │  404 policy: deep-link rewrite → /#home      │
                        │        │                                     │
                        │        ▼                                     │
                        │  SQLite /data/study/data/scima.db (index)    │
                        │  deck export JSONs /data/study/data/decks/   │
                        └──────────────────────────────────────────────┘
```

The defining property of the system: **the frontend is a complete,
offline-first product**. Decks, study scheduling, library, analytics,
settings and XP live entirely in the browser's localStorage. The backend
exists for exactly one feature — the *community deck registry* (publish,
discover, download decks) — consumed by a single frontend module
(`home/app/dashboard-community.js`). Everything else in `home/` never
makes a network call.

---

## 2. Repository layout

| Path | Role |
|---|---|
| `site/home/` | Static multi-page frontend (unminified source of truth). Route dirs contain only an `index.html`; all shared assets live at the landing root so every reference can be relative (§3.1). |
| `minified/` | Deploy bundle: `minified/home/` (transfer-size-minified frontend) + `minified/backend/` (a byte-identical GENERATED COPY of `site/backend/`, re-synced by `minify.sh` — never hand-edited; the canonical backend lives in `site/`, §4). `main.py` serves `minified/home` when run from there (§4.2). |
| `home/shared/` | Cross-context libraries: `shared.js` (sanitizers, rich text), `srs-core.js` + `srs.js` (schedulers), `theme.js` (presets/schedule), `scima-schema.js` (interchange schemas), `translate-shared.js` (define/translate/pinyin). |
| `home/app/` | The dashboard split: `dashboard-core.js` (must load first) … `dashboard-bootstrap.js` (must load last), plus per-view modules. |
| `home/lib/` | Vendored bundles: KaTeX (+mhchem), fflate (zip), EPUB/MOBI parsers, process-shim, lazily-loaded pdf.js. |
| `backend/app/` | FastAPI app: `main.py` (routes/mounts/middleware), `db.py` (SQLite), `schemas.py` (pydantic API contract), `scimaschema.py` (server mirror of `scima-schema.js`), `ratelimit.py`, `migrate_db.py`. |
| `backend/tests/` | API sanity tests (`test_api.py`) against a throwaway DB. |
| `community/` | Legacy standalone community page; still mounted at `/community` (§4.2) but superseded by the `#community` hash view inside the landing document. |
| `app/` | Android client (out of scope). |
| `tests-and-tools/` | Playwright/pytest suite + render/serve/seed CLIs for `home/` (`tests-and-tools/information.md`). |

---

## 3. Frontend: `home/`

### 3.1 Routes and the two mount families

One directory per destination; each `index.html` declares itself with
`window.SCIMA_PAGE = { id, root, views }` where `root` is the relative path
back to the landing folder (`''` at the root, `'../'` inside a route dir).

| URL | Page (`SCIMA_PAGE.id`) | Views hosted (`#view-<id>` containers) |
|---|---|---|
| `/` | `home` | `home`, `community` (entered only via the nav tab; hash `#community`) |
| `/decks/` | `decks` | `decks` (subjects → folders → deck detail sub-views) |
| `/study/` | `study` | `study` (picker + session) |
| `/library/` | `library` | `library` (+ reader overlay) |
| `/analytics/` | `analytics` | `analytics`, `quests` (in-page tab bar; `#quests` deep link) |
| `/settings/` | `settings` | `settings` |
| `/about/` | `about` | `about` (changelog markdown) |
| `/capture/`, `/insights/`, `/tracker/` | — | meta-refresh stubs → `/decks/`, `/analytics/`, `/#home` |

Because every in-document reference (scripts, CSS, lazy pdf.js via
`assetUrl()`, cross-route links) is **relative**, the same files work under
any mount prefix: the backend serves them at `/` (canonical) *and*
`/dashboard/` (legacy bookmarks), and any plain static host works too.

### 3.2 Script architecture (no bundler)

Plain `<script>` tags share one global scope; load order is a contract:

1. `dashboard-core.js` **first** — defines `state`, `store`, `el()/btn()`,
   router (`navigate/renderView/gotoViewPage`), nav drawer, command palette,
   XP helpers, scope-set math.
2. View modules in any order (`dashboard-home/decks/study/library/analytics/
   settings/about/community/scratchpad/onboarding`) — definition-only files.
3. `dashboard-bootstrap.js` **last** — the only file with top-level side
   effects: theme scheduler, `init()`, cross-tab `storage` listener,
   pagehide/pageshow persistence seams, first-run tour trigger.

Each page loads only the slice it needs (e.g. `/study/` adds KaTeX +
`dashboard-scratchpad.js`; `/library/` adds process-shim, fflate and the
EPUB/MOBI parsers; `/` adds `dashboard-community.js`). The same files also
run unmodified inside the browser-extension build, gated by
`window.SCIMA_PAGE` / `isExtension` — the extension hosts every view in one
document and none of the cross-page machinery below runs.

### 3.3 Router, URLs and cross-page handoff

- `navigate(view)` → same page: in-document view switch (`renderView`);
  other page: full navigation to `VIEW_ROUTES[view]` (e.g. `quests` →
  `/analytics/`).
- **Hash standardization**: the active view is mirrored in the URL hash
  (`/decks/#decks`, `/#home`, `/analytics/#quests`), giving every state a
  shareable link; `#community` and `#quests` are the only entry points to
  their views on merged pages. `/decks/` deep links carry the full path —
  `#decks/<Subject>/<folder…>/<Deck>` — and re-open the deck detail on load
  (deferred one tick so the containing view renders first); opening a deck
  mirrors its segment back into the hash. `/packs/<pack>` (file stem, full
  file name or display name, resolved leniently) opens that pack's detail
  modal once the async list lands; `#community/<deckId>` (server id) opens
  the registry deck's detail screen, mirrored back by openDeck() and folded
  by "← Back to decks". `#settings/<panel>` (alias-resolved
panel key: study/scratch/appearance/subjects/accessibility/ai/library/
navigation/data/help) scrolls that panel into view and pulses a highlight
ring (`.settings-flash`) — the scratchpad's ⚙ head button opens
`settings/#settings/scratch` in a NEW tab as the canonical feature→its-
setting cross-link, and every panel header carries a 🔗 copy-its-link
button; and bootstrap's init() resolves the hash's FIRST path
  segment into the view (`#community/x` boots the landing page into the
  Community view), so payloads survive a cold load.
- **Page memory**: SPA-only state that must survive "leave and come back"
  (active study session, study scope/refine, decks sub-navigation, quests
  tab) is written to `sessionStorage["scima_pagemem_<page>"]` on `pagehide`
  and restored by `init()` — which is why a reload mid-session resumes the
  flashcard queue.
- Chrome: collapsible nav drawer (`#logo-icon` ↔ `#sidebar`, Esc/outside
  click close), command palette (Ctrl/Cmd+K — desktop pointers only, see
  §3.7), modal host (`#modal-backdrop`), guided tour overlay
  (`#tutorial-overlay`, sandboxed — §3.6).
- Keyboard: Alt+Shift+1…9 jump to nav tabs; study/quiz hotkeys per mode.

### 3.4 State and persistence (the frontend's "database")

| Key (localStorage) | Contents | Writer/reader |
|---|---|---|
| `mf_state` | `{decks, folders, sources, libraryFolders, reviewHistory, achievements, sessionLog, streak, lastStreakDate, settings}` | `store.save()` via debounced `scheduleSave()` (~600 ms) |
| `SCIMATracker` | XP/subject tracker `{version, totalXP, subjects, monthlyMarks, history, streak, config}` (serialized write-lock guards concurrent writers) | same |
| `pdf_blob_<srcId>`, `html_blob_<srcId>` | chunked base64 PDF / parsed-HTML chapters for library sources (`dashboard-blobstore.js`; single key on the site, chunked keys in the extension where chrome.storage has per-item quotas) | library/capture flows |

- `settings` from storage are **merged onto defaults** (`Object.assign`), so
  old saves keep working; every structural field is repaired on load by the
  `sanitize*()` family in `shared.js` (`sanitizeMfState/Deck/Card/Folder/
  Source`, `sanitizeState` for the tracker). These functions are the
  de-facto schema of the frontend and never throw on garbage input.
- Cross-tab sync: native `storage` events re-hydrate other tabs.
- Day keys (`today()` — review history, daily goal, streak window) roll over
  at midnight in `settings.dayTimezone`: `'utc'` (default, historical
  behaviour), `'local'`, or any IANA zone; invalid zones fall back to UTC.
  `bumpStreak()` computes "yesterday" in the same zone.

### 3.5 Domain logic (all client-side)

- **SRS**: `srs-core.js` implements FSRS + SM-2 (`scheduleCard`); `srs.js`
  adds due-set/new-card-cap helpers. Study modes: SRS review, cram, written
  quiz, fill-the-gaps, weakness, multiple choice; session queues are
  shuffled; ratings mutate card ease/interval/due and append
  `reviewHistory`, streaks, XP and achievements.
- **Rich text**: `renderRichText()` — `$…$`/`$$…$$` → KaTeX (currency-aware:
  a `$` opening a plain numeric amount ended by whitespace/sentence
  punctuation/end — `$1.20`, `$1,200` — is money, not a delimiter, and can
  neither open nor close a math span, so "£1 = $1.20 changes to £1 = $1.50"
  renders as typed while `$2\pi r^2$` still renders; `scRichMathSegments()`
  in shared.js is the single splitter, also used by the case tool's TeX
  protection), `**bold**`,
  `__underline__`, `*italic*`, HTML-escaped first (markup can never inject
  nodes). KaTeX+mhchem ship in `home/lib/katex/`.
- **Theming**: `theme.js` presets + timed/sun schedule; `applyThemeVars()`
  writes CSS custom properties on `documentElement`; accessibility modes
  toggle root classes (`power-saving`, `dyslexia-mode`,
  `a11y-high-contrast`).
- **Library parsing**: EPUB/MOBI bundles + lazily fetched pdf.js produce
  chapters/bookmarks/citations; citations (`{sourceId, chapterId, charStart,
  charEnd}`) travel on cards and render as "📖 Source" badges in study.
- **AI Capture** (Create Deck modal): talks to a *user-local*
  OpenAI-compatible server (`settings.aiEndpoint`, e.g. LM Studio) or
  builds a copy/paste prompt — never to the SCIMA backend.
- **Quizlet import** (Create Deck modal, 🎴 tab): paste a set link; the
  ported `quizlet-to-scima` pipeline paginates Quizlet's public
  `studiable-item-documents` webapi, converts rich text/entities, maps
  custom side labels by label-then-position, sends surplus sides to
  `hint`, and runs every card through `sanitizeCard()` on create.
  Quizlet sends no CORS headers and rejects shared public proxies, so
  fetches walk a strategy chain: **1)** same-origin backend proxy
  `GET /api/v1/import/quizlet?set=<digits>` (server-side httpx fetch with
  browser-like headers, rate-limited 30/min, digits-only set id — no CORS
  involved), **2)** optional user proxy template `settings.quizletProxy`
  (`{url}` placeholder), **3)** direct, **4)** public CORS proxies as best
  effort. The winning strategy locks for the whole paging walk. When every
  path fails the tab offers a paste fallback: stamped scima JSON (e.g. the
  `quizlet-to-scima.js` console helper) or tab-separated pairs.
- **Arcade (hidden route)**: `/games/` (noindex, absent from nav until launch)
  hosts the Tier-0/0.5 game system: `shared/scima-games.js` holds the object
  catalog + pure reducer (`createGameSession`/`feedGameSession`), and
  `app/dashboard-games.js` the play runner, the list+inspector editor MVP,
  skeletal `SCIMAGAME1-…` share strings (zlib+base64url, mirrored by
  `tests-and-tools/gamekit.py`), and Scratch/GD-style remix attribution
  (remixable by default; forks extend the chain). Charts are declarative
  data — no author code executes. Design rationale: `game-packages-design.md`.
- **Packs (hidden route)**: `/packs/` lists official deck packs from
  `assets/packs/` — three actions per pack (➕ Add to Decks, ⬇ Download,
  🔗 copy a `#packs/<pack>` share link) plus a detail modal (open a pack's
  title, or follow a share link) that dry-runs `importPackData()` to show
  the pack's decks/folders/cards before import. Discovery:
  `GET /api/v1/packs` (backend dir scan + optional `manifest.json` metadata,
  bucket `packs`) → static `manifest.json` fallback → empty state.
  `importPackData()` accepts stamped scima envelopes and legacy v2 deck/folder
  exports and bare shapes, sanitizes, remaps ids, re-links folder ids. About
  images moved to `assets/media/` (resolver repointed; legacy `media/…` refs
  keep working through prefix stripping).
- **Manual advance**: graded answers (quiz/gaps/multiple-choice) never
  auto-next — a Next/Finish button appears after marking; `settings.
  autoNextSeconds` (0 = off, default) adds a visible countdown to it.
  Countdowns are cleared on re-render/exit/finish.
- **Quiz parameters** (`state.settings.quizParams`, “⚙ Session options”
  drawer off the picker — grouped Display / Time limits (per-card countdown
  and whole-session limit side by side, each with its own toggle) / Queue /
  Exam, with a live queue preview and an active-options summary on the
  picker button row): card-type filter (single/multi-answer/markscheme/process/
  calculation/table via shared.js's `cardTypeKey()` — multi-answer being a
  basic card with answerCount>1), card-count limit, global session time
  limit (progress-row countdown; expiry finishes the session), shuffle
  off/on, a multi-answer required-count override (`sessRequired()` caps a
  card's own requirement), and **exam mode** (Written Quiz & Gaps): big
  ← Prev / Next → buttons hop between questions, inputs auto-cache per
  card on every move (Enter caches and advances; no Save button needed),
  nothing is graded or revealed until “🏁 Finish & reveal” grades every
  recorded answer through the same matchers the live Check buttons use
  (`examGradeAll` — single, multi, mark-scheme, process and calculation
  branches; table cards skip exam queues), applies ratings via
  `applyRating()` and lists your-answer-vs-expected on the summary screen.
  Exam renders no Check/Skip buttons at all, and the per-card countdown
  controls grey out in the options drawer while exam is on.
- **Session history**: `state.sessionLog` records every session —
  completed ones via `finishSession()`, abandoned ones (← Exit, tab closed,
  reload) as `status:'aborted'` with a `queueIds` snapshot — surfaced in the
  picker's 🕘 Session History panel (under the scheduler help button) with
  Resume (incomplete, restores idx + stats) and Repeat (same queue/mode/
  orientation, fresh stats). Replay data kept for the newest 40 entries.
  Every entry also stores `answers: [{id, r, ok, ms}]` — each rated card
  with its rating and correct-ness (`ok = rating >= 3`, the same line
  `stats.correct` uses), recorded in `rateCard()`, the single funnel every
  mode rates through — which powers **Repeat wrong (N)**: a third history
  action that replays exactly the missed cards, original order and mode
  (skips and correct answers stay out; trimmed together with `queueIds`).
- **SEO layer**: `robots.txt` + `sitemap.xml` at the landing root; unique
  per-page titles/descriptions, canonical + OpenGraph tags on the six
  content routes; `noindex` on `/settings/` and the redirect stubs;
  `/api/`, `/dashboard/` and stubs disallowed in robots.
- **Fill in the Gaps, multi-blank**: authored `card.gaps` (exact
  substrings, deterministic, set in the card editor) blank first;
  otherwise `settings.gapPercent` of the answer's words (capped
  `settings.gapMax`) blank at random. One input per blank, graded
  individually (all/some/none → Correct/Close/Incorrect).
- **Reverse study**: `settings.studyReverse` (🔁 picker toggle) is captured
  onto the session at start; basic cards then render back-as-question and
  front-as-answer across flashcard, written quiz, multiple choice and
  fill-the-gap (which blanks the question instead). Directional types
  (cloze/markscheme/process/calculation/table) always study forward.
- **Case & ending standardization**: “Aa Case…” batch editors on the
  subject bar, folder bar, deck-detail bar, card-selection bar and each deck
  card. Two independent transform axes — letter case (Keep case / ALL CAPS /
  all lowercase / Title Case that keeps small grammar words lowercase,
  first/last word always capitalized) and end punctuation (leave / add “.”
  if missing / strip trailing punctuation) — apply to an independently
  chosen scope: fronts (optionally filtered by card type: basic/multi/
  markscheme/process/calculation/table), backs, hints, deck names and
  folder names (the name scopes exist only where the entry point's scope
  carries decks/folders: subject ⊃ folders ⊃ decks ⊃ selection). KaTeX
  spans ($…$ / $$…$$) are segment-skipped by every transform (TeX is
  case-sensitive, and a field ending in a math span has no trailing
  punctuation to match); the modal previews the exact field edits before
  applying, and Apply leaves a 7 s Undo toast holding a snapshot of every
  touched field or name.
- **Unified decks browser**: subjects are folders as far as the browser is
  concerned — the root lists them as folder-style rows (▶ study / ⬇ export
  subject / ✏️ edit-subject row actions, drop targets for the subject top
  level), and subject and folder containers render through ONE view: the
  container name sits on its own line and the actions form ONE merged
  segmented bar (the analytics/quests `.tab-bar` anatomy) with the same
  labels in the same order at every level — and one ordering rule set:
  use → edit → export → move → rename/delete → create, the two most
  important actions at the ENDS, highlighted primary LAST, never mid-bar
  (▶ Study · Aa Case… · ⬇ Export · then folder-only 📂 Move /
  📚 Move-to-subject / ✏ Rename / × Delete, or ✏️ Edit Subject ·
  + New Folder · + New Deck). Child
  folder rows carry the same six actions at both levels; `exportSubject()`
  ships a subject as a stamped `collection` envelope.
- **Destructive-action gate**: every delete (deck, folder, card, library
  source/folder, annotation, session history, theme preset, clear-all)
  runs through `confirmDestructive()` — a modal "are you sure you want to
  delete …" with Delete/Cancel — and pairs with `undoToast()`: a 7 s Undo
  that restores the entity from a pre-mutation snapshot (source blobs are
  cleaned up only after the undo window; annotations, living inside a
  popover, use a two-step armed button instead of the modal).
- **Card/deck/folder surgery**: duplicate-card action, move-decks-between-
  subjects (deck selection bar), move-folder-between-subjects (📚 row action,
  folder toolbar, subtree-aware: subfolders and contained decks are retagged
  together), and Ctrl+Alt+K / Ctrl+Alt+M single-textbox modals moving a card
  selection to a new / existing deck (button keeps the combined modal).
- **Interchange schemas**: `shared/scima-schema.js` defines one envelope
  (`{"$schema":"scima", schema, schemaVersion, kind, …}`) with three payload
  grades — `skeletal` (short-key, import-only, LLM-friendly), `share`
  (what gets published/stored server-side), `full` (account backup).
  Export/import/backup everywhere speaks this format.

### 3.6 Onboarding sandbox

The first-run guided tour (`dashboard-onboarding.js`) runs against a
snapshot: before starting it backs the live blobs to
`sessionStorage["scima_tour_backup"]`, builds a real practice deck, and on
Skip/Discard restores the snapshot (plus marks onboarding complete), so the
tour can never leave residue. `sessionStorage["scima_tour_active"]` carries
a mid-tour replay across route navigations.

### 3.7 Mobile layer (`dashboard.css`'s trailing MOBILE LAYER block)

Phone-width and touch behaviour lives in three keyed blocks at the end of
`app/dashboard.css`, so "mobile" switches on/off in one place:

- **`(hover:none)/(pointer:coarse)` capability block** — hover-revealed row
  actions (`.folder-actions`, `.source-actions`, `.pinned-deck-study`) are
  permanently visible without a pointer to hover with; `.touch-only`
  controls render (the table-card editor's ▲▼/◀▶ row/column reorder buttons
  beside its drag grips); the command palette's `#cmd-hint` pill disappears
  and core.js skips the Ctrl/Cmd+K binding there — the nav drawer reaches
  every destination the palette lists, so on a keyboardless device both are
  redundancy.
- **`≤720px` phone block** (same line as the existing gutter breakpoint) —
  modals (`#modal-box`, `#cmd-box`, community's `.sc-modal-box`) become
  edge-to-edge sheets: full bleed left→right, a sliver of air at the top,
  rounded top corners, `100dvh`-clamped height; `grid-2`/`grid-3` panel grids
  collapse to ONE panel wide while button-scale grids stay two-up
  (`grid-4` stat tiles, the `.rating-grid`'s four rating buttons → 2×2);
  form controls jump to 16px (below that iOS Safari zooms the page on
  focus); tap targets grow; `.ui-action-bar`/`.ui-action-group` header rows
  wrap instead of overflowing; `#app` switches to `100dvh`.
- **`≤820px` reader block** (same line as the scratchpad's full-screen
  sheet) — the library reader's docked sidebars (chapter list, PDF
  extracted-text panel) become slide-over panels toggled by the header's
  `.reader-mobile-only` 📑/📄 buttons, and the reader hides the floating
  ≡/ⓘ chrome marks while open (they'd sit on its header).

Touch-parity workflows back the CSS: folder re-parenting (drag-only before)
has the 📂 "Move to Folder…" modal (`openMoveFolderModal`, subtree-aware,
cross-subject moves reuse `moveFolderToSubject`); deck/card selection was
already tap-toggle; text selection in the reader finalizes through a
debounced `selectionchange` on coarse pointers (touch never fires the
`mouseup` the toolbar positions from). And because HTML5 drag events are
mouse-only, `makeTouchDraggable()` (dashboard-decks.js) restores real
drag-and-drop for fingers: a ~320 ms hold on a deck tile or folder row lifts
a floating ghost (`.touch-drag-ghost`), the finger drags over the same target
set as the mouse path (folder rows + breadcrumbs, hit-tested via
`data-drop-folder` attributes that `makeDropTarget()` stamps), edge
nudge-scrolls `#main`, and release drops through the very same
`dropOnFolder()`; taps (too quick) still select/open and scrolls (moving
before the hold) still scroll. CDP touch tests: `ui/test_mobile.py`.

---

## 4. Backend: `backend/`

`site/backend/` is the ONE canonical backend. `minified/backend/` is a
byte-identical generated copy shipped inside the deploy bundle (`minify.sh`
re-syncs it; humans and CI edit only `site/backend/`). The canonical
`main.py` carries the deploy affordances itself — `GZipMiddleware`, the
`SCIMA_STATIC_ROOT`/`STATIC_CANDIDATES` static-root probe (so the same file
runs with `REPO_ROOT` = `site/`, `minified/`, a repo root or any checkout)
and `SCIMA_DATA_DIR` in `db.py` — which is what lets the copy stay identical
instead of drifting.

### 4.1 App assembly (order matters)

1. `TrustedHostMiddleware` — `study.scima-net.com`, `localhost`, `127.0.0.1`.
2. `CORSMiddleware` — open (`*`) for GET/POST/OPTIONS: the API is public-read.
3. Body-size middleware — rejects `Content-Length` > `MAX_REQUEST_BODY_BYTES`
   (`schemas.py`) with 413 and streams-counts actual bodies.
4. Static revalidation middleware — `Cache-Control: no-cache` for
   `.html/.js/.css` so deploys never leave users on heuristic-cached stale
   assets (ETags still yield 304s). Minified names are not content-hashed,
   so this stays no-cache; `GZipMiddleware` (≥1 KiB) provides the transfer-
   size win on top of minification.
5. API routes → specific mounts → catch-all mount → 404 handler (below).

### 4.2 Mounts and URL families

| Mount | Target | Notes |
|---|---|---|
| `/dashboard` | landing dir (StaticFiles, html=True) | legacy family; kept for bookmarks and because old community assets reference `/dashboard/shared/…` root-absolute |
| `/community` | repo `community/` | deprecated standalone page |
| `/` | landing dir | canonical family; directory URLs serve each route's `index.html`; `/study` 307s to `/study/` |
| `/community` | legacy page dir | **conditional**: mounted only if a `community[-deprecated]/` dir exists next to (or above) the backend — the minified bundle ships without it and must still boot |
| 404 handler | — | `/api/*` → honest JSON 404; path-form deep links (`/decks/<subj>/<deck>`, `/library/<a>/<b>`, `/packs/<pack>`) 302 to the hash form the frontend parses, `/community/<deckId>` 302s to the landing `/#community/<deckId>`; dotted last segments (assets) → JSON 404; everything else 302 to `/#home` (or `/dashboard/#home` inside that family) |

### 4.3 API surface (`/api/v1`, all rate-limited per client IP, in-memory)

| Endpoint | Purpose | Limit |
|---|---|---|
| `GET /health` | `{"status":"ok"}` — the frontend's online/offline probe | — |
| `GET /decks` | list (`subject`, `tag`, `sort`, `limit`, `offset`) → `DeckListResponse{items,total,limit,offset}` | 120/min |
| `GET /search?q=` | FTS5-backed full-text search → `DeckSearchResponse` | 60/min |
| `GET /decks/{id}` | one `DeckSummary` | 120/min |
| `GET /decks/{id}/export` | the stored share-grade export JSON (the only endpoint returning full card payloads) | 30/min |
| `POST /decks` | publish a deck (201 → `DeckSummary`) | 5/hour |

Pydantic models in `schemas.py` (`DeckSummary`, `Rating`, list/search
responses, `DeckUploadRequest`) are the wire contract; the community UI
renders exactly these shapes.

### 4.4 Server persistence

- **SQLite** `/data/study/data/scima.db` (schema v5, `db.py`): `decks`
  metadata rows **reference export files**, plus `deck_tags` and an
  external-content FTS5 table `decks_fts` kept in sync by triggers
  (`DECK_TAGS_TRIGGER_SQL`; `migrate_db.py` repairs older databases whose
  triggers mis-deleted FTS rows).
- **Deck files** `/data/study/data/decks/*.json`: every stored payload is a
  stamped `share`-grade envelope (`scimaschema.stamp()`); uploads arrive
  stamped or legacy (`version:2`) and are classified/expanded by
  `scimaschema.classify()` — the Python mirror of `home/shared/scima-schema.js`
  ("keep the rules in lockstep"; both sides pinned by their test suites).
- `migrate_db.py`: one-shot additive migration stamping pre-envelope files.

---

## 5. The home ↔ backend contract

### 5.1 Who talks to whom

Exactly one frontend module calls the API: `dashboard-community.js`, with
`const API_BASE = window.SCIMA_API_BASE || '/api/v1'`. The override exists
so a statically-hosted frontend can point at a separately-deployed API
(CORS is open for this reason). Flows:

| Flow | Calls | Client behaviour |
|---|---|---|
| Boot of `#community` | `GET /health`, `GET /decks?sort=…` | status line "Server online/offline at /api/v1"; renders `items` as deck cards |
| Search/filter | `GET /search?q=…` (+ params) | results replace the list; query length capped client-side first |
| Inspect | `GET /decks/{id}` | detail pane; openDeck() mirrors `#community/<id>` into the hash (shareable), 🔗 Copy link copies the absolute URL |
| Download | `GET /decks/{id}/export` | payload is fed through the same `sanitize*()`/import path as local files → becomes a local deck in `mf_state` (server data never bypasses client sanitization) |
| Publish | `POST /decks` | client serializes a local deck (or chosen file) to an interchange envelope, client-side size-checks it (`MAX_REQUEST_BODY_BYTES` mirror), posts JSON |
| Failure | any | `throwForStatus` → offline/error banner; the rest of the app is unaffected |

Under a static-only host (no API), `/api/v1/health` 404s and the view shows
"Server temporarily offline at /api/v1" — graceful degradation is a tested
behaviour (`tests-and-tools/ui/test_community.py` mocks the API in-browser with the
`schemas.py` shapes).

### 5.2 What the backend never sees

Accounts, decks-in-progress, study sessions, scheduling, library sources,
XP/streaks, settings, themes — all client-only (§3.4). The registry stores
only deliberately-published share-grade decks. Conversely the frontend
never reads server state outside `#community`.

### 5.3 Schema lockstep

One interchange system, three implementations kept honest by tests:

```
home/shared/scima-schema.js  ◀──lockstep──▶  backend/app/scimaschema.py
        │                                            │
        ▼                                            ▼
  tests-and-tools/ (seed factories,                    backend/tests/test_api.py
  community mocks use schemas.py)            (upload/list/search/export)
```

### 5.4 Deployment topology notes

- Production: one uvicorn process serves API **and** both static families;
  relative assets make the mount prefix irrelevant to the frontend.
- Static-only dev/test: any file server over `home/` works
  (`python tests-and-tools/serve.py`); community shows its offline state or a mocked
  API. Full-stack dev: `python tests-and-tools/serve.py --with-backend` (needs a
  writable `/data/study/data`, the backend's hard-coded `DATA_DIR`).
- `TrustedHost` means local testing must use `localhost`/`127.0.0.1` hosts.

---

## 6. Two representative end-to-end flows

**Studying (100% client):** seed/localStorage → `init()` rehydrate →
sanitize → `state` → picker/scope/refine → shuffled queue → reveal → rating
→ `srs-core.scheduleCard` → card fields + `reviewHistory` + streak + XP →
`scheduleSave()` (600 ms debounce) → `mf_state`/`SCIMATracker` →
`pagehide` writes `scima_pagemem_*` → reload resumes. No HTTP involved.

**Sharing (client → server → client):** local deck → `scima-schema.js`
export (share envelope) → size check → `POST /api/v1/decks` →
`scimaschema.classify/validate` → stamp + write file + index row/FTS →
201 `DeckSummary`. Another user: `GET /decks` card → `GET …/export` →
import path → `sanitizeDeck/Card` → merged into their `mf_state`.

---

## 7. Storage key reference (client)

| Store | Key | Purpose |
|---|---|---|
| localStorage | `mf_state`, `SCIMATracker` | main blobs (§3.4) |
| localStorage | `pdf_blob_<id>`, `html_blob_<id>` | library payload chunks |
| sessionStorage | `scima_pagemem_<page>` | per-page SPA memory across navigations |
| sessionStorage | `scima_tour_backup`, `scima_tour_active` | onboarding sandbox (§3.6) |

Server: `/data/study/data/scima.db` + `/data/study/data/decks/` (§4.4).

---

## 8. Design notes & gotchas

- **Settings panel map**: eight domain panels in one `grid-2` (rows pair
  similar heights: Study & Scheduling\|Scratchpad, Appearance & Theme\|
  Subjects, Accessibility & Notifications\|AI & Integrations, Library &
  Reading\|Navigation) between a full-width ❓ Help card and a full-width
  💾 Data Management card; the Theme Schedule is a subsection of
  Appearance. The grid collapses to one column at the phone breakpoint.
- **Debounce**: writes are debounced ~600 ms; tests wait ~900 ms before
  asserting on localStorage.
- **UTC dates** everywhere in history/streak math.
- **Shuffled queues**: study order is random per session — never assert
  card order.
- **Sanitizers are the schema**: hand-edited/corrupt/old saves are repaired,
  never fatal; new fields backfill with defaults.
- **Cache discipline**: static assets are `no-cache`+ETag by middleware;
  the test server mirrors this with `no-store`.
- **Rate limits are process-local** (in-memory deques, per IP with
  X-Forwarded-For last-hop); scaling out needs shared state.
- **Tour sandbox** means a skipped tour restores pre-tour storage — seeding
  tools must account for it (`tests-and-tools/seed.py` presets do).
- **Extension parity**: every `home/app/dashboard-*.js` file must keep
  running inside the extension build; site-only behaviour is gated on
  `window.SCIMA_PAGE` / `!isExtension`.

## 9. Search-engine indexing (ops checklist)

In-repo prerequisites (all served from the landing root): `robots.txt`
(sitemap pointer; `/api/`, `/dashboard/` and redirect stubs disallowed),
`sitemap.xml` (the six canonical content routes), unique per-route
titles/descriptions + canonical + OpenGraph tags, `noindex` on `/settings/`
and the stubs, and a `<noscript>` summary on indexable pages for non-JS
crawlers and link previews.

1. **Deploy & verify serving**: `curl -I https://study.scima-net.com/robots.txt`
   and `/sitemap.xml` must return 200 from the domain root (the backend's
   catch-all static mount serves them; the 404-handler ignores dotted paths
   only when the file is absent).
2. **Prove ownership**: Google Search Console — DNS TXT on `scima-net.com`
   (preferred, covers subdomains) or URL-prefix with an HTML verification
   file dropped into `site/home/` (served at `/`); Bing Webmaster Tools can
   import the GSC property. Commit any verification file so deploys keep it.
3. **Submit the sitemap** in both consoles, then URL-inspection → *Request
   indexing* for `/` and `/about/` (fastest wins); the rest follow.
4. **Keep one canonical host**: https + single hostname; `<link rel=canonical>`
   and sitemap `<loc>` already agree — don't serve the same pages from
   `/dashboard/` to crawlers (robots disallows it).
5. **Set expectations**: Googlebot executes JS (Wave renderer), so the app
   routes can index, but only the six content routes are advertised;
   non-JS engines and social crawlers get the static meta + noscript copy.
   "Discovered – currently not indexed" on app views is normal.
6. **Meta-description safety net**: `minify` strips attribute quotes, which
   broke quote-matching scanners (2026-10 site scan); `minify.sh` now passes
   `--html-keep-quotes` (with fallback), current minified heads were
   re-quoted, every served page (incl. stubs, `/games/`, `/settings/`,
   legacy community under `archive/`) carries a description, and the
   backend's innermost `ensure_meta_description` middleware injects a site
   default into any HTML response that lacks one — future pages can't
   regress. After deploying, purge the Cloudflare cache or scanners keep
   reading stale HTML.
7. **Maintain**: when routes are added/renamed, update `sitemap.xml`
   (`<loc>` + `<lastmod>`), the §3.1 table, and the robots stub list. If a
   truly public content page ever appears (shared deck viewer?), consider
   prerendering it server-side for richer snippets.

For testing this architecture, see `tests-and-tools/information.md` (UI suite,
render/serve/seed CLIs, selector cheat-sheet).
