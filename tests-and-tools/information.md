# SCIMA Learning — frontend test suite (`tests/`)

Browser tests + rendering tools for the static frontend in `home/`
(study.scima-net.com). Python + Playwright; the FastAPI backend is **not**
required — the site is served statically and `/api/v1` is mocked in-browser
when needed. Written to be driven (and extended) by LLM agents as well as
humans.

## Quickstart

```bash
pip install -r tests/requirements.txt
python -m playwright install chromium     # once; add --with-deps on bare Linux

cd tests
pytest                                    # whole suite (174 tests)
pytest -m smoke                           # page-load sanity only
pytest ui/test_study.py -k srs -x         # one file / one test
python render.py scenarios/02-home-demo.json          # → screenshots/02-home-demo.png
python serve.py                                       # manual server at :8013
```

From the repo root: `pytest tests/` works too (`tests/pytest.ini` is picked up).

## Layout

```
tests/
├── information.md        ← this file
├── requirements.txt      playwright + pytest (+ optional backend deps)
├── pytest.ini            markers, default browser
├── conftest.py           fixtures: live_server, seeded(), app, demo_app,
│                         api_mock, page_errors, failure screenshots
├── serve.py              CLI: static server for home/ (or --with-backend)
├── render.py             CLI: scenario JSON → interactions → PHOTO + trace
├── seed.py               CLI+lib: deterministic localStorage seed blobs
├── helpers/              server / storage / pages / api_mock / content
├── scenarios/            11 ready-to-run render.py scenarios (numbered)
├── ui/                   pytest tests: smoke, navigation, home, decks,
│                         study, library, analytics, settings, community,
│                         storage, tour, viewports, content, **features**
└── screenshots/          all output lands here (gitignored)
```

## render.py — arbitrary interactions → a photo

Executes any sequence of steps (clicks, typing, **pauses**, waits, seeding,
API mocking, mid-run screenshots) and writes a PNG plus a JSON trace
(`<out>.trace.json`: per-step timing/result, console log, JS page errors).
On failure it writes `<out>-FAIL.png` and exits 1. This is the fastest way
to *see* the site after a change.

```bash
python render.py scenarios/03-study-session.json     # scenario file
python render.py scenarios/02-home-demo.json --headed --slowmo 200
python render.py --goto /study/ --seed demo --out study.png \
    --steps-json '[{"pause":800},{"click":"#tutorial-target-study-start"},{"pause":600}]'
python render.py --list-steps                        # full step reference
```

Step vocabulary (one action key per object): `goto reload back pause
wait_for click dblclick hover focus fill type press check uncheck select
scroll seed clear_storage eval mock_route set_theme set_viewport screenshot
assert dump`. Defaults: a throwaway static server is auto-started when no
`--base-url`/`SCIMA_BASE_URL` is given, the `empty` seed preset is applied
(tour off), and external requests (Google Fonts) are blocked. Key flags:
`--base-url --out --seed --no-seed --viewport WxH --device "iPhone 13"
--full-page --video --headed --browser firefox`.

Scenario keys: `name description base_url browser viewport device
color_scheme locale timezone_id seed block_external video output full_page
steps`. See `scenarios/*.json` for working examples of every feature.

## Seeding state (deterministic tests)

Everything the site knows lives in two localStorage keys — `mf_state`
(decks/folders/sources/settings/history/streak) and `SCIMATracker` (XP).
Seeds are injected **before page scripts run** (`add_init_script`), so the
app boots straight into them.

```python
import seed as seedlib
blob = seedlib.preset_demo()            # or preset_empty / preset_first_run
seeded(mf_state=blob["mf_state"], tracker=blob["SCIMATracker"])   # fixture
# custom:
deck = seedlib.make_deck("X", [seedlib.make_card("front", "back")])
seeded(mf_state=seedlib.make_mf_state(decks=[deck], streak=3))
```

CLI: `python seed.py --preset demo --print` / `--out file.json` (feed the
file to `render.py --seed file.json`).

Presets: **empty** (no decks, tour off) · **demo** (2 decks / 7 cards / 5
due, folder, 1 library source, streak 5, 9 days history, 1240 XP) ·
**first_run** (tour fires ~300 ms after load).

Key fixtures: `app` (booted `/` on empty), `demo_app` (booted `/` on demo),
`seeded(...)` (call **before** first goto), `page_errors` (assert `== []`),
`api_mock(handlers)` (see `helpers/api_mock.py`).

## Site facts you need to write tests

- **Pages** (static, no build step): `/` (Home + `#community` hash),
  `/decks/`, `/study/`, `/library/`, `/analytics/` (+ `#quests`),
  `/settings/`, `/about/`. Legacy stubs meta-refresh: `/capture/`→`/decks/`,
  `/insights/`→`/analytics/`, `/tracker/`→`/#home`.
- **Stable selectors**: `#logo-icon` (drawer toggle), `#sidebar`,
  `#nav .nav-btn[data-view=ID]`, `#view-<id>` containers,
  `#page-tabs .tab-btn[data-view]`, `#modal-backdrop`/`#modal-box`/
  `#modal-title`, `#cmd-backdrop`/`#cmd-input` (Ctrl/Cmd+K),
  `#tutorial-overlay`, `#tutorial-target-new-deck`,
  `#tutorial-target-deck-name-input`, `#tutorial-target-add-card`,
  `#tutorial-target-card-front-input` / `-back-input`,
  `#tutorial-target-study-start`, `.deck-card .deck-name`, `.rating-btn`,
  `.flashcard.front/.back`, `.quiz-input-area`, `.subject-tile`,
  `.stat-card .stat-val`, `.heatmap`, `.source-name`, `.toggle-row
  button.toggle`, theme swatches `#view-settings button[title='Light']`.
- **App globals** (evaluate-able): `state` (live data), `renderView(view)`,
  `navigate(view)`, `scheduleSave()` (~600 ms debounce → then check
  localStorage), `SCIMA_PAGE`, `THEME_PRESETS`, `studySession`.
- **Gotchas**
  - The first-run guided tour covers the UI unless the seed sets
    `settings.onboarding.completed` (all presets except `first_run` do).
  - Persistence is debounced ~600 ms — `wait_for_timeout(900)` before
    reading `mf_state`.
  - Community needs `/api/v1`; under the static server it shows
    “Server temporarily offline at /api/v1”. Mock shapes live in
    `helpers/api_mock.py` (mirrors `backend/app/schemas.py`).
  - External font requests are blocked by default (`SCIMA_ALLOW_EXTERNAL=1`
    to allow) — expect `net::ERR_FAILED` console noise for them; assert on
    `page_errors` (real JS exceptions), not console errors.
  - Review dates use **UTC** (`today()` = `toISOString()`); `seed.utc_day()`
    matches.
  - Prod-only behavior: the FastAPI backend redirects unknown routes to
    `/#home` and serves the legacy `/dashboard/` mount; the static test
    server 404s instead (pinned by `test_unknown_route_note`).

## Display dimensions & content checkers

```bash
pytest -m responsive        # viewport/device matrix
pytest -m content           # content-integrity checkers
```

- `ui/test_viewports.py` boots and exercises the UI at 10 viewport sizes
  (320→2560 wide, landscape, short windows), asserts the 720px CSS gutter
  breakpoint, drawer cycle at every size, rating buttons/modals staying
  inside small viewports, tap-driven flows on real device descriptors
  (iPhone 13 / Pixel 7 / iPad), overflow-free rendering of all 7 routes at
  3 widths, 280px and 3440px extremes, and 2× DPI screenshot dimensions.
- `ui/test_content.py` + `helpers/content.py` provide the checkers:
  `horizontal_overflow`, `clipped_text`, `broken_images`, `duplicate_ids`,
  `unnamed_visible_buttons`, `bug_markers` (undefined/NaN/[object Object])
  and `all_content_checks(page)` for the lot. Plus rich-text/KaTeX
  rendering, HTML-escaping, unicode/emoji round-trips, data-URI card
  images, and 1000+ char layout stress.
- Known a11y gap FIXED in this suite's companion commit: Settings' toggle
  knobs are now `role="switch"` buttons with `aria-checked` + `aria-label`
  (home/app/dashboard-settings.js makeToggle); the checker exempts nothing.
- render.py dimension control: scenario keys `viewport` / `device`,
  steps `set_viewport`, flags `--viewport WxH --device "iPhone 13"`;
  see `scenarios/10-breakpoints.json` and `08-mobile-drawer.json`.

## Full-stack mode (optional)

```bash
pip install fastapi uvicorn          # (already in requirements.txt)
python serve.py --with-backend --port 8013
SCIMA_BASE_URL=http://127.0.0.1:8013 pytest ui/
```

Serves `home/` at `/` **and** `/dashboard/` with the live registry API.
Needs a writable `/data/study/data` (backend's hard-coded `DATA_DIR`).

## Adding a test — template

```python
# tests/ui/test_my_feature.py
import pytest
from playwright.sync_api import expect
from helpers import pages

@pytest.mark.decks                      # marker must exist in pytest.ini
def test_x(page, base_url, seeded, page_errors):
    seeded("preset:demo")               # BEFORE the first goto
    pages.goto_app(page, base_url, "/decks/")
    expect(page.locator("#view-decks")).to_contain_text("Spanish Basics")
    assert page_errors == []
```

`ui/test_features.py` covers the post-suite feature wave: timezone day
boundary (`settings.dayTimezone`), sanitizer-filled imports, move-deck-
between-subjects, card duplication, deck-segment deep links, the
Ctrl+Alt+K / Ctrl+Alt+M card-move modals, and the 🎴 Quizlet import tab
(mock its webapi with `page.route` + an `access-control-allow-origin`
header; `scenarios/11-quizlet-import.json` shows the same in render.py).

Failing tests automatically leave `screenshots/failures/<test>.png`.
Prefer the stable ids/classes above over text where possible; use
`get_by_role("button", name=...)` for labeled buttons.
