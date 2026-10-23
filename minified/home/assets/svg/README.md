# SCIMA icon set (`home/assets/svg/`)

One icon system for the entire frontend. Every glyph the app draws — nav
tabs, buttons, stat cards, empty states, badges, settings panels, study
modes, achievements, quests, scratchpad tools, the favicon — comes from
this directory, so the whole UI shares a single visual language.

## The family

* **24×24 viewBox**, art inside a ~2px safe margin
* **stroke-based line art**, `stroke-width 1.75`, round caps + joins
* **`currentColor`** everywhere (the only exception is `logo.svg`, the
  brand mark, which carries the blue→violet gradient + pink spark)
* icons **size with `font-size`** (1em box) and **colour with the theme**,
  so the same asset works at 11px in a pinned-deck row and 46px in an empty
  state

## Files

| Path | Role |
|---|---|
| `<name>.svg` | standalone icon file (direct embedding, `<img>`, CSS, docs) |
| `icons.svg` | the `<symbol id="i-<name>">` sprite the app actually renders |
| `build.py` | the single source of truth — regenerates both artefacts |
| `../../shared/icons.js` | runtime loader + `scIcon/scLbl/scAuto/scPrefix` API |

**Never hand-edit `<name>.svg` or `icons.svg`.** Edit the path data in
`build.py` and run:

```bash
python3 build.py
```

## How the app renders an icon

`shared/icons.js` (loaded on every page, before `app/dashboard-core.js`)
fetches `icons.svg` once per document and inlines it as a hidden
`<svg id="sc-icon-sprite">`; after that every instance is free:

```js
scIcon('download')              // → <svg class="sc-icon"><use href="#i-download">
scLbl('download', 'Export')     // → <span class="sc-lbl"> icon + text </span>
scAuto(deck.emoji || 'books')   // icon-set name → sprite; user emoji → text
scIconSvg('search')             // markup-string form for innerHTML renderers
scPrefix(emoji)                 // text prefix for <option>-style contexts
```

`.sc-icon` (in `app/dashboard.css`) supplies the shared stroke styling and
the 1em box; `.sc-lbl` pairs an icon with a label at a fixed gap. `<use>`
references resolve live, so markup rendered before the sprite fetch lands
lights up the moment it arrives — and if the fetch ever fails nothing
throws (icons degrade to empty 1em boxes).

Icon fields in app catalogs (`NAV_ITEMS`, `VIEW_TABS`, `PAGE_HELP`, study
`MODES`, `ACHIEVEMENT_DEFS`, quest defs, `sourceTypeIcon()`, …) hold icon
**names**. User-chosen deck/folder emoji travel through the same renderers;
`scIsIconName()` tells the two apart (kebab-case name vs. emoji) so saved
user content always renders verbatim.

## Adding / renaming an icon

1. Add the body markup to `ICONS` in `build.py` (geometry only — stroke
   properties come from the root/sprite consumer).
2. `python3 build.py`.
3. Reference it by name from the app (`scIcon('my-icon')`).
4. Keep the mapping table in `build.py`'s docstring up to date when an
   icon replaces a legacy emoji glyph.
