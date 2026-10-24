# CHANGELOG (last updated 24th October 2026, UTC)

#### VERSION 2026.10.27-ALPHA

- new study mode: **Endless**
- it's endless written after you do some multiple choice, then fill in the gaps, then written quiz

#### VERSION 2026.10.26-ALPHA	

- new SRS option: **Crucible** (adaptive, in-house) — personalizes review intervals from various data points.
- legal pages added: Privacy Policy, Terms of Service and Cookies Policy (linked from settings and the no-JS landing page, listed in the sitemap)

#### VERSION 2026.10.25-ALPHA	

- security fixes
- updated dependencies
- quizlet removal due to scraping blocks

#### VERSION 2026.10.24-ALPHA

- Create Deck → Import Text now understands spreadsheets: paste a copy (or drop a .csv/.tsv) and the grid is auto-detected

- deck explorer refined: filter box, footer chips etc.
- library folders restyled into the same explorer visual language
- bug fixes

#### VERSION 2026.10.23-ALPHA

- a full, consistent SVG icon system for the whole app
- icons scale with text and follow theme colours

#### VERSION 2026.10.22-ALPHA

- IA improvements
- bug fixes

#### VERSION 2026.10.21-ALPHA

- more customization of studying
- QoL deck editing (basic -> multi, lower/uppercase, punctuation, etc.)
- rendering fixes

#### VERSION 2026.10.020-ALPHA
- mobile friendly views
- official study packs (more to released, currently in progress)
- more deeplinked URLs
- ui changes
#### VERSION 2026.10.019-ALPHA

- fill in the gaps now customizable with gap count
- optionally deterministic gaps in deck creation

#### VERSION 2026.10.018-ALPHA

- study history and resuming added
- reverse card studying (back as front, front as back) added
- accessibility additions

#### VERSION 2026.10.017-ALPHA

- quizlet integration added
- more intuitive file management workflows
- bug fixes

#### VERSION 2026.10.016-ALPHA

- subjects can now be deleted
- build version shown at the foot of the sidebar nav
- guided tour: the study session is scoped to the card the tour just created, the explanation card is now measured and clamped to the viewport

#### VERSION 2026.10.015-ALPHA

- subjects are now user-managed
- the guided tour no longer leaves any traces behind if the user wishes to discard changes
- guided tour fixes: the menu walk now follows your own sidebar order
- information menus brought up to date

#### VERSION 2026.10.014-ALPHA

- full markdown support in ABOUT (this) tab; added tables, hyperlinks, code blocks, etc.

#### VERSION 2026.10.013-ALPHA

- UI tweaks

#### VERSION 2026.10.012-ALPHA

- community tab now allows selection of decks through decks already on your device/browser without uploading a file

#### VERSION 2026.10.011-ALPHA

- quality of life additions and bug fixes to scratchpad
- community page merged with main page
- URL standardization now allows for session persistence, including inside file browsers (excluding modals)

#### VERSION 2026.10.010-ALPHA

- added new, feature-rich, infinite scratchpad for use in all study modes

#### VERSION 2026.10.009-ALPHA

- standardized internal and exported .json schemas for long-term usage
- bug fixes regarding tags only having a single slot and crashing the backend with multiple
- updated test suite to match the new schema

#### VERSION 2026.10.008-ALPHA

- added about page
- moved ./home/scima-standalone-landing/* to ./home/

*=*
to implement:
- separated quizlet program (likely chrome extension) that outputs .json because scraping blocked at quizlet

  *=*
  source code: https://www.github.com/scima-main/scima-learning
