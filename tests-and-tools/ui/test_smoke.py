"""Smoke tests: every page of home/ boots, renders its view, no JS errors.

Run just these first after any change:  pytest tests/ -m smoke
"""
import re

import pytest
from playwright.sync_api import expect

from helpers import pages
from helpers import storage

pytestmark = [pytest.mark.smoke]

# route → (expected SCIMA_PAGE.id, expected visible view container)
PAGES = [
    ("/", "home", "view-home"),
    ("/decks/", "decks", "view-decks"),
    ("/study/", "study", "view-study"),
    ("/library/", "library", "view-library"),
    ("/analytics/", "analytics", "view-analytics"),
    ("/settings/", "settings", "view-settings"),
    ("/about/", "about", "view-about"),
]


@pytest.mark.parametrize("route,page_id,view_id", PAGES,
                         ids=[p[0] or "/" for p in PAGES])
def test_page_boots_and_renders(page, base_url, seeded, route, page_id, view_id,
                                page_errors):
    seeded("preset:empty")            # deterministic: no decks, tour OFF
    pages.goto_app(page, base_url, route)

    # the page declared itself correctly to the router
    assert page.evaluate("() => window.SCIMA_PAGE.id") == page_id
    # its view container rendered content
    view = page.locator(f"#{view_id}")
    expect(view).to_be_visible()
    expect(view).not_to_be_empty()
    # chrome is in place: nav drawer buttons + XP bar
    assert page.locator("#nav .nav-btn").count() == 8
    expect(page.locator("#xp-level")).to_have_text(re.compile(r"^Lv\.\d+$"))
    # no uncaught JS exceptions during boot
    assert page_errors == [], f"JS errors on {route}: {page_errors}"


@pytest.mark.parametrize("route,page_id,view_id", PAGES,
                         ids=[p[0] or "/" for p in PAGES])
def test_page_survives_reload(page, base_url, seeded, route, page_id, view_id,
                              page_errors):
    """Reload = full re-boot from localStorage; must land in the same state."""
    seeded("preset:demo")
    pages.goto_app(page, base_url, route)
    page.reload(wait_until="load")
    pages.app_ready(page)
    expect(page.locator(f"#{view_id}")).to_be_visible()
    assert page_errors == []


def test_state_is_seeded_and_sanitized(app):
    """The seed blob actually reached the app's in-memory `state`."""
    st = storage.read_app_state(app)
    assert st["page"] == "home"
    assert st["settings"]["onboardingCompleted"] is True
    assert st["decks"] == []


def test_assets_load(page, base_url, seeded):
    """Core CSS/JS assets are served (200) — a broken path = blank site."""
    seeded("preset:empty")
    responses = {}

    def record(resp):
        responses[urlparse_path(resp.url)] = resp.status

    from urllib.parse import urlparse
    def urlparse_path(u):
        return urlparse(u).path

    page.on("response", record)
    pages.goto_app(page, base_url, "/")
    for asset in ["/app/dashboard-core.js", "/app/dashboard.css",
                  "/shared/shared.js", "/shared/theme.js"]:
        assert responses.get(asset) == 200, f"{asset} did not load: {responses.get(asset)}"
