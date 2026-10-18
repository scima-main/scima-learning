# SCIMA Game Packages — design brainstorm

Custom study games that users **design outside the app** (text editor, git
repo, generator script), **share outside the app** (files, links, any
registry), and **import** into SCIMA. Worked example throughout: *"type as
many digits of pi as possible; you have three lives."*

Status: P0 + P0.5 IMPLEMENTED (chart engine + catalog in
`site/home/shared/scima-games.js`, hidden `/games/` page with play runner +
list/inspector editor MVP + share strings + remix attribution in
`site/home/app/dashboard-games.js`, CLI authoring in
`tests-and-tools/gamekit.py`, tests in `ui/test_games.py`). Decisions taken:
inspector-first editor (canvas deferred), share strings carry the SKELETAL
grade, remix-by-default with attribution chains. P1 (ZIP/assets/registry)
and P2 (sandboxed scripting) remain open.

---

## 1. What the example actually needs

Decomposed, "pi typing with three lives" is:

| Concern | Value in the example |
|---|---|
| prompt source | a constant sequence (π decimals), revealed progressively |
| input modality | typed characters, restricted charset `0-9` |
| matching | streaming prefix match against the sequence |
| failure model | 3 lives, one lost per wrong character/submit |
| scoring | correct characters this run; personal best persists |
| end states | lives exhausted, or player quits; sequence is unbounded |

None of that requires arbitrary code. It requires a **vocabulary of game
primitives** rich enough to express it — which defines Tier 0 below. Every
additional tier buys expressiveness at security cost; the design question is
where to stop.

---

## 2. The expressiveness ↔ trust ladder (three tiers)

| Tier | What authors write | Execution | Shareable anywhere? | Precedents |
|---|---|---|---|---|
| **0 — recipe** | declarative JSON over built-in primitives (prompts, inputs, matchers, lives, timers, scoring) | interpreted by audited in-app engine; no author code runs | yes — same trust class as deck exports | Anki `.apkg` (data-only), Kahoot/Quizlet JSON, QTI items |
| **1 — package** | recipe **plus** assets: markdown/KaTeX prose, sanitized SVG, audio, data tables, in a ZIP container | still interpreted; assets rendered through existing sanitizers | yes, with container hygiene | **EPUB/OCF** (mimetype + manifest + assets), H5P content packages |
| **2 — programmable** | adds a script (JS) controlling game flow via a capability API | sandboxed: SES `lockdown()` Compartment **or** `sandbox`-ed iframe + postMessage RPC; no DOM/network/timers except endowed | registry-reviewed or signed only | Figma plugins / Google Apps Script (iframe RPC), VSIX (signed), PICO-8 (constrained fantasy console), WASI capability model |

Recommendation: **ship Tiers 0+1 first** (covers the pi game, typing sprints,
arithmetic drills, ordering/sequence games, dictation with audio). Tier 2 is
a separate project with its own threat model and review pipeline; design the
manifest so it can arrive later without breaking Tier 0/1 packages.

---

## 3. File format

### 3.1 Single-file envelope (Tier 0, frictionless)
Reuse the existing interchange system rather than inventing a sibling:
`home/shared/scima-schema.js` already stamps `{"$schema":"scima", "schema":…,
"schemaVersion":1, "kind":…}`. Add **`kind:"game"`** with `schema:"full"` /
`"share"` grades, so `scimaClassify()`, the import modals, and the backend
validator all recognize games for free. Paste-a-JSON import works on day
one, exactly like decks.

### 3.2 Container (Tier 1): `.scimagame` = ZIP, OCF/EPUB discipline
```
mimetype            ← "application/vnd.scima.game+zip", stored UNCOMPRESSED first (OCF rule)
manifest.json       ← identity + tier + entry points + asset list (JSON Schema-validated)
game.json           ← Tier 0 recipe (or game.js for Tier 2)
assets/             ← svg (sanitized), png/webp, ogg/mp3, data csv/json
SIGNATURE.minisig   ← optional detached ed25519 signature (minisign format)
```
ZIP hygiene on import (the existing fflate path needs the same): reject
absolute/`..` paths (zip-slip), cap entry count and per-entry + total
decompressed size (zip-bomb), cap compression ratio, ignore symlinks,
validate every declared MIME by magic bytes, never trust stored names.

### 3.3 manifest.json (sketch, JSON Schema draft 2020-12, `additionalProperties:false`)
```jsonc
{
  "id": "urn:scima-game:sha256:<content-hash>",   // content-addressed, like OCI digests
  "name": "Pi Recall",
  "version": "1.2.0",                              // semver
  "author": { "name": "…", "url": "…" },
  "license": "CC-BY-4.0",                          // SPDX id
  "tier": 1,
  "minAppVersion": "2026.10.016",
  "entry": "game.json",
  "capabilities": [],                              // Tier 2 only: ["store","audio",…]
  "assets": [{ "path": "assets/pi.svg", "mime": "image/svg+xml", "sha256": "…" }],
  "accessibility": { "keyboard": true, "reducedMotion": true, "inputModality": "typed" },
  "externalUrls": []                               // MUST be empty in Tiers 0–1
}
```
Content-hash id ⇒ dedup, tamper-evidence, share links
(`/#game/<hash>`), and registry keys fall out for free. Canonical JSON
(sorted keys, no insignificant whitespace) keeps hashes and git diffs stable.

---

## 4. Tier 0 primitive vocabulary (the engine contract)

A recipe = {prompt, input, match, rules, scoring, feedback}. Enough
orthogonal primitives beat a long list of bespoke games:

- **prompt.source**: `constant:<pi|e|sqrt2|fib…>` (engine-bundled, capped
  length) · `data:inline` (string/array in package) · `deck:<scope>` (reuse
  the user's own decks as game data — typing sprint over card fronts) ·
  `generated:<arithmetic|cloze>` with parameters.
- **input.mode**: `typed` (charset/regex, max length) · `choice` (n options,
  distractor pool from data or deck) · `order` (arrange tokens) · `gap`.
- **match**: `exact` · `prefix-stream` (the pi game: consumes input
  character-by-character against the sequence) · `set-coverage` (mark-scheme
  style) · `numeric-tolerance` (reuse `calcMatch`) · `order-prefix`.
- **rules**: `lives` (n, decrement events), `timer` (total | per-round),
  `ramp` (window/speed growth per level), `retryCostsLife` bool.
- **scoring**: metric (`correctChars|rounds|accuracy|time`), aggregation
  (`best|max|sum`), combo multiplier, XP curve (see §7).
- **feedback**: reveal-correct policy, per-round vs per-char, haptics-free
  visual tokens that respect `power-saving`/reduced-motion.

The pi game, complete:
```json
{ "$schema": "scima", "schema": "share", "schemaVersion": 1, "kind": "game",
  "game": {
    "name": "Pi Recall", "version": "1.0.0",
    "prompt": { "source": "constant:pi.decimals", "reveal": "stream" },
    "input":  { "mode": "typed", "charset": "0-9" },
    "match":  { "type": "prefix-stream", "granularity": "char" },
    "rules":  { "lives": 3, "failOn": "wrongChar" },
    "scoring":{ "metric": "correctChars", "aggregate": "best" },
    "feedback": { "revealCorrectOnMiss": true } } }
```

Engine implementation notes: a pure reducer
`(state, event) → state'` (events: input, tick, submit, abort) makes games
deterministic, testable headlessly (the test suite can *play* a game by
feeding event scripts — great fit for `tests-and-tools`), resumable, and
replayable for shareable score proofs.

---

## 5. Security & threat model

| Vector | Mitigation |
|---|---|
| Code execution from imported content | Tiers 0–1: no author code exists — interpreter only. Tier 2: SES `lockdown()` Compartment or `<iframe sandbox>` (no `allow-same-origin`) + postMessage capability RPC; freeze prototypes; watchdog per tick |
| Zip-slip / zip-bomb / symlink | §3.2 container rules; extract to memory, never to disk paths |
| Malicious SVG/HTML in assets | sanitize through the existing escaper + an SVG allowlist (no `<script>`, no event attrs, no `<foreignObject>`); render via `renderRichText` semantics |
| Tracker / exfiltration | `externalUrls` must be empty (Tiers 0–1); assets resolve only from package hashes; no network API in any tier's capability set by default |
| Parse bombs / memory | body-size caps (backend already enforces), JSON depth + key-count caps, asset size caps per manifest |
| Infinite loops / jank (Tier 2) | instruction-time watchdog (e.g. 5 ms budget per event), no synchronous loops in endowed `time`, frame budget enforced by host |
| Storage abuse | namespaced quota per game id (`games_state[<hash>]`), capped like blobstore |
| Impersonation / tampering | content-hash ids; optional minisign detached signatures; registry-side: verified-author badges, revocation list keyed by hash |
| Social engineering via metadata | name/description rendered only through escaped rich text (existing rule); length caps |
| Score cheating (leaderboards) | keep scores local-only at first; if a registry leaderboard ever ships, require deterministic replay seeds + server re-simulation of the reducer (the §4 reducer makes this possible) |
| Accessibility regressions | manifest declares input modality; engine enforces keyboard operability and honours `power-saving`/reduced-motion; WCAG contrast for feedback tokens |

Trust display in UI mirrors the tiers: *Built-in primitives* (no warning) →
*Package with assets* (shows manifest + asset list on import) → *Contains
program* (Tier 2: explicit capability consent dialog, registry-sourced only
at launch).

---

## 6. Sharing & distribution paths

1. **Paste / file** — the envelope or `.scimagame` dropped into an Import
   dialog (day-one, no server involved).
2. **Share links** — `https://study.scima-net.com/#game/<sha256>` resolves
   against the registry; unknown hashes show import-from-file fallback.
3. **Registry** — extend the community backend: `GET/POST /api/v1/games`,
   `GET /api/v1/games/{hash}` (the package), rate-limited like decks;
   server validates schema + tier + container hygiene before storing
   (backend `scimaschema.py` grows a `game` classifier mirror).
4. **Anywhere else** — because Tier 0/1 packages are inert data: git repos,
   Discord files, classroom LMSes, QR codes of the envelope JSON. No
   execution risk means no distribution gatekeeping.
5. **Authoring outside the app** — publish the JSON Schema + a CLI
   validator/simulator in `tests-and-tools` (`gamekit.py validate|play|hash`)
   so authors get offline feedback; a `--repl` that feeds an event script
   through the reducer doubles as the headless test harness.

---

## 7. Integration seams with the existing app

- **Study surface**: an "Arcade" row on the study picker (installed games as
  pills, like Recents); sessions reuse the chrome (progress bar, exit,
  scratchpad) but not SRS scheduling.
- **Results**: `sessionLog` entries with `mode: "game:<hash>"` + score
  fields → Analytics already renders mode-agnostic rows; personal bests in a
  new `games_state` localStorage key (sanitized like everything else:
  `sanitizeGameScore()`).
- **XP/streaks**: optional, capped conversion (e.g. XP = min(score-curve,
  daily game cap)) so games can't farm the tracker; streak credit only if
  the day had ≥1 real review — keep SRS the core loop.
- **Decks as game data** (`prompt.source: deck:<scope>`) turns every existing
  deck into typing-sprint/choice-race material with zero authoring.
- **Schema lockstep**: `scima-schema.js` ↔ `scimaschema.py` ↔ seed/validator
  CLIs, pinned by tests on both sides (the existing pattern).

---

## 8. Standards we're deliberately standing on

JSON Schema (validation) · semver + SPDX (metadata) · EPUB/OCF (container
layout, mimetype rule) · minisign/ed25519 detached signatures (provenance) ·
content-addressing à la OCI/git (ids, dedup) · SES / iframe-sandbox +
postMessage (Tier 2 execution, Figma-plugin pattern) · H5P & SCORM/cmi5
(prior art for packaged interactive learning; we take their packaging ideas
but skip their runtime bloat) · Anki's lesson (data-only packages safe,
code add-ons unsafe) · WCAG 2.2 (operability) · existing scima envelope
(kinds/grades/classifier).

---

## 9. P0.5 — the chart layer + in-app editor (the Geometry-Dash compromise)

P0 proves the *vocabulary*; P1 proves *distribution*. The risky unknown sits
between them: is the vocabulary actually **authorable** — expressive and fun
to compose? Geometry Dash answered that for platformers: no scripting, just a
palette of safe objects placed on a scrolling grid, plus *triggers* and
*portals* that reshape state mid-level. P0.5 is that idea as JSON: a
**chart format** (the canonical intermediate representation every game
compiles to) and a **schema-driven in-app editor** that emits it. Packaging
and registries can wait; shareable JSON cannot.

### 9.1 Charts: steps × lanes, objects with per-type semantics

```jsonc
{ "$schema":"scima", "schema":"share", "schemaVersion":1, "kind":"game",
  "game": {
    "name":"Pi Recall — Sudden Death", "version":"1.1.0",
    "format":"chart", "chartVersion":1,
    "grid": { "pace":"input",            // steps advance on player commits
              "lanes":["prompt","input","effect","hazard","cosmetic"] },
    "objects": [
      { "t":"prompt.stream", "step":0, "lane":"prompt",
        "props":{ "source":"constant:pi.decimals", "window":1 } },
      { "t":"input.typed",   "step":0, "lane":"input",
        "props":{ "charset":"0-9", "commit":"perChar" } },
      { "t":"match.prefix",  "step":0, "lane":"effect",
        "props":{ "onHit":{"score":"+1char","combo":"+1"}, "onMiss":{"life":"-1"} } },
      { "t":"rule.lives",    "step":0, "lane":"hazard", "props":{ "lives":3 } },
      { "t":"rule.end",      "step":0, "lane":"hazard", "props":{ "when":["lives==0"] } },
      { "t":"portal.mode",   "step":32, "lane":"effect",          // GD portal: mid-game shift
        "props":{ "commit":"perChunk", "chunk":4 } },
      { "t":"cosmetic.token","step":0, "lane":"cosmetic",
        "props":{ "every":10, "token":"🔥" } }
    ] } }
```

- **step** = grid column. `pace:"input"` → a step advances per player commit
  (round-based feel); `pace:"time"` → steps are beats (e.g. 500 ms) for
  timer-driven games. One grid, both genres.
- **lane** = row, purely organizational (like GD layers) — the reducer reads
  objects by type, lanes keep charts legible.
- **Per-type persistence semantics** (the GD distinction between objects,
  triggers and portals): `rule.*`/`prompt.*` persist from their step until
  overridden; `portal.*`/`event.*` apply instantly at their step;
  `cosmetic.*` decorate only. Authors compose difficulty *curves* by placing
  overrides down the grid — no code, but emergent design space.
- **P0 recipes survive as macros**: `recipe → chart` compilation keeps one
  runtime and one test harness; the pi recipe in §4 is sugar for the chart
  above.

GD mapping, for intuition: object palette → `prompt/input/match` families;
triggers → `rule.*`/`event.*`; portals → `portal.*` (mode/pace/policy
shifts); decorations → `cosmetic.*`; level ID → content-hash id; level
*code* → the share-string below. Deliberately un-GD: discrete steps instead
of continuous scroll, no physics, and a deterministic reducer (replays and
ghost races fall out for free).

### 9.2 One catalog, four consumers (the schema-driven trick)

Every object type is declared once in a **catalog**: JSON Schema per type
(enum of `t`, `props` with ranges/defaults, lane affinity, persistence
class). That single metadata table generates: the editor **palette**, the
editor **inspector form**, the **import validator**, and the **CLI**
(`gamekit.py validate/play/diff`). New object type = new catalog entry, no
bespoke UI anywhere — the reason a JSON editor can stay as cheap as GD's
visual one.

### 9.3 The editor (in-app, but JSON remains the source of truth)

- **Layout**: palette sidebar (grouped by lane, searchable) · scrollable
  step×lane grid canvas (click/marquee place, snap, copy/paste, undo/redo
  command stack) · inspector panel (schema-generated) · top bar with
  **Playtest** (runs the reducer live over the chart), step-through,
  **JSON view** (pretty + canonical), import/export/share.
- **Keyboard-first a11y** (house rule): cursor-driven placement (arrows +
  Enter), inspector forms are real labelled controls, reduced-motion
  respected — the editor must pass the same `test_a11y_labels.py` checks.
- **Autosave** to localStorage (`games_draft`), export as the §3.1 envelope.
- The editor is *a* client of the format, not the only one: external tools,
  generators and hand-editing stay first-class because everything round-trips
  through canonical JSON.

### 9.4 Sharing without a registry: GD-style share strings

Content-hash id arrives in P0; P0.5 adds a copy-anywhere **share string**:
`SCIMAGAME1-<base64url(deflate(canonical(json)))>` — paste into chats, repos,
QR codes; import accepts envelope JSON *or* share string. No server, no
container, still Tier-0 inert data. (P1's registry and `/#game/<hash>` links
then bolt onto ids that already exist.)

### 9.5 Safety delta in P0.5

Chart validation = catalog schema (type enum ⇒ allowlist), step/lane bounds,
object-count cap (e.g. 2 000), props range-clamped per schema, strings only
ever rendered via the existing escaper, `constant:*` sources engine-bundled
and length-capped, inline data arrays size-capped. The editor cannot emit
outside the catalog, and the importer rejects what the editor cannot emit —
same guarantee in both directions.

## 10. Phasing (revised)

- **P0**: chart IR + reducer runtime + catalog v1 + 3 built-ins authored as
  charts + paste/file envelope import + `gamekit.py` (validate/play/hash) +
  headless play-tests in the suite.
- **P0.5**: the in-app editor (palette/grid/inspector/playtest/JSON view),
  share strings, recipe→chart macros kept as authoring sugar, draft
  autosave. *(The compromise: authoring UX lands before any packaging.)*
- **P1**: `.scimagame` ZIP container + assets (SVG/audio) + share links +
  registry endpoints + import-time manifest review UI.
- **P2**: Tier 2 sandbox (SES compartment first), capability consent UI,
  signing + registry review queue, replay-based leaderboards/ghosts.
- **P3**: marketplace-grade features (collections, ratings, remix forks of
  charts — the format's canonical JSON makes diff/remix natural).

## 11. Open questions

1. Lives semantics: per-mistake (pi example) vs per-round vs time-penalty —
   encode all three as `failOn` variants now, or start with per-mistake?
2. Should game scores influence XP/streaks at all, or stay in a separate
   "Arcade stats" lane?
3. Registry before or after P1 assets? (Data-only registry could ship in P0.)
4. Multiplayer/ghosts (race your own best replay) — P2 candidate given the
   reducer makes replays trivial?
5. License policy for registry uploads: require OSI/CC SPDX ids, or allow
   proprietary?
6. P0.5 scope: ship the editor with grid-canvas placement first, or
   inspector-only editing of a list view (cheaper, still schema-driven) with
   the canvas as a fast-follow?
7. Share strings: include a human-readable name slug (`SCIMAGAME1-pi-recall-…`)
   for chat-friendliness, or keep the payload minimal?
8. Should charts be remix-forkable by default (CC-style remix flag in the
   manifest), given GD's culture is built on remixing?
