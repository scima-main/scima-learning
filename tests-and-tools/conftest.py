"""Shared pytest fixtures for the SCIMA frontend (home/) test suite.

What this gives every test under tests-and-tools/ui/:

  live_server / base_url   A static HTTP server for home/ is started once
                           per session on a random free port (override with
                           SCIMA_BASE_URL=... or pytest --base-url=...).
  seeded(...)              Factory: installs a localStorage seed into the
                           test's browser context BEFORE the first goto.
                           Default presets live in seed.py.
  app                      A page already booted at "/" with the 'empty'
                           preset (tour suppressed).
  demo_app                 Same, with the 'demo' preset (2 decks, 5 due
                           cards, streak 5, 9 days of history, 1 source).
  page_errors              JS exceptions (window.onerror) seen so far —
                           assert this stays empty.
  console_messages         All console messages [{type,text}].
  api_mock(handlers)       Mocks /api/v1/* in-browser (helpers/api_mock.py).
  Failure screenshots      Any failing test leaves a PNG in
                           tests-and-tools/screenshots/failures/.

External requests (Google Fonts, etc.) are aborted by default so tests are
hermetic and fast; set SCIMA_ALLOW_EXTERNAL=1 to let them through.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

import pytest

TESTS_DIR = Path(__file__).resolve().parent
if str(TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(TESTS_DIR))

import seed as seedlib                     # noqa: E402
from helpers import api_mock as api_mock_helpers  # noqa: E402
from helpers import pages, storage         # noqa: E402
from helpers.server import start_static_server, stop_static_server, SITE_DIR  # noqa: E402

FAILURE_SHOTS_DIR = TESTS_DIR / "screenshots" / "failures"


# ── server ───────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def live_server():
    """Base URL of a session-wide static server for home/ (or SCIMA_BASE_URL)."""
    external = os.environ.get("SCIMA_BASE_URL")
    if external:
        yield external.rstrip("/")
        return
    base, httpd = start_static_server()
    yield base
    stop_static_server(httpd)


@pytest.fixture(scope="session")
def base_url(request, live_server):
    """Overrides pytest-playwright's base_url so relative page.goto() works."""
    opt = request.config.getoption("--base-url", default=None)
    return (opt or live_server).rstrip("/")


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args):
    return {**browser_context_args, "viewport": {"width": 1280, "height": 800}}


# ── hermetic network + error capture ────────────────────────────────────────

@pytest.fixture(autouse=True)
def _capture_and_block(page, context, base_url):
    errors: list[str] = []
    messages: list[dict] = []

    def wire(p):
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.on("console", lambda m: messages.append({"type": m.type, "text": m.text}))

    wire(page)
    context.on("page", wire)

    if not os.environ.get("SCIMA_ALLOW_EXTERNAL"):
        base_host = urlparse(base_url).netloc.split(":")[0]

        def blocker(route):
            host = urlparse(route.request.url).netloc.split(":")[0]
            if host in (base_host, "localhost", "127.0.0.1", ""):
                route.continue_()
            else:
                route.abort()

        context.route("**/*", blocker)

    context._test_page_errors = errors
    context._test_console = messages
    yield


@pytest.fixture
def page_errors(context) -> list[str]:
    """JS exceptions (uncaught errors) — assert == [] in smoke tests."""
    return context._test_page_errors


@pytest.fixture
def console_messages(context) -> list[dict]:
    return context._test_console


# ── seeding ──────────────────────────────────────────────────────────────────

@pytest.fixture
def seeded(context):
    """Factory — call BEFORE the first navigation of the test.

        seeded()                                  # 'empty' preset (tour off)
        seeded("preset:demo")
        seeded(mf_state={...}, tracker={...})
        seeded(extra={"my_key": {"a": 1}})
    """
    def _seeded(spec=None, *, mf_state="__unset__", tracker=None, extra=None,
                clear=False):
        if mf_state == "__unset__":
            if clear and spec is None:
                mf_state = None            # pristine profile (tour WILL fire)
            else:
                blob = seedlib.resolve_seed(
                    spec if spec is not None else "preset:empty")
                mf_state, tracker = blob.get("mf_state"), blob.get("SCIMATracker")
        storage.seed_context(context, mf_state=mf_state, tracker=tracker,
                             extra=extra, clear=clear)
    return _seeded


@pytest.fixture
def app(page, base_url, seeded):
    """Booted landing page ("/") on the 'empty' preset, tour suppressed."""
    seeded("preset:empty")
    pages.goto_app(page, base_url, "/")
    return page


@pytest.fixture
def demo_app(page, base_url, seeded):
    """Booted landing page on the 'demo' preset (see seed.preset_demo)."""
    blob = seedlib.preset_demo()
    seeded(mf_state=blob["mf_state"], tracker=blob["SCIMATracker"])
    pages.goto_app(page, base_url, "/")
    return page


@pytest.fixture(scope="session")
def site_base():
    """Static server for the UNMINIFIED source frontend (site/home).

    The default suite runs against the minified deploy bundle; features
    that haven't been re-minified yet (see `minify` run) are tested here
    against the source of truth instead.
    """
    base, httpd = start_static_server(root=SITE_DIR)
    yield base
    stop_static_server(httpd)


@pytest.fixture
def api_mock(page):
    """Factory: api_mock(handlers) → recorded-requests list.

        from helpers import api_mock as m
        recorded = api_mock(m.sample_online_handlers())
    """
    def _mock(handlers, **kw):
        return api_mock_helpers.mock_api(page, handlers, **kw)
    return _mock


# ── failure screenshots ──────────────────────────────────────────────────────

@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    if report.when != "call" or not report.failed:
        return
    page = item.funcargs.get("page")
    if page is None:
        return
    try:
        FAILURE_SHOTS_DIR.mkdir(parents=True, exist_ok=True)
        safe = re.sub(r"[^\w.-]+", "_", item.name)[:120]
        path = FAILURE_SHOTS_DIR / f"{safe}.png"
        page.screenshot(path=str(path))
        print(f"\n📸 failure screenshot → {path}")
    except Exception as e:  # noqa: BLE001
        print(f"\n(failure screenshot unavailable: {e})")
