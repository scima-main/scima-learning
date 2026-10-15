"""Navigation: drawer, nav tabs, cross-page routing, deep links, redirect
stubs, keyboard shortcuts, command palette."""
import re

import pytest
from playwright.sync_api import expect

from helpers import pages

pytestmark = [pytest.mark.nav]


def test_nav_lists_every_tab(app):
    """All 8 destinations live in the drawer: NAV_ITEMS from dashboard-core.js."""
    ids = app.locator("#nav .nav-btn").evaluate_all(
        "els => els.map(e => e.dataset.view)")
    assert ids == ["home", "decks", "study", "library",
                   "analytics", "community", "settings", "about"]


def test_drawer_toggle_and_escape(app):
    """≡ opens the drawer (aria contract), Esc closes it."""
    expect(app.locator("#logo-icon")).to_have_attribute("aria-expanded", "false")
    app.click("#logo-icon")
    expect(app.locator("#logo-icon")).to_have_attribute("aria-expanded", "true")
    expect(app.locator("#nav .nav-btn").first).to_be_visible()
    app.keyboard.press("Escape")
    expect(app.locator("#logo-icon")).to_have_attribute("aria-expanded", "false")


def test_cross_page_navigation(app, base_url):
    """Clicking a tab for another page performs a real navigation there."""
    pages.nav_to(app, "decks")
    pages.expect_at(app, "decks")
    assert pages.current_view(app) == "decks"
    pages.nav_to(app, "study")
    pages.expect_at(app, "study")
    pages.nav_to(app, "home")
    pages.expect_at(app, "home")


def test_community_lives_on_landing_hash(app, base_url):
    """Community has no page of its own — it's /#community in the landing doc."""
    pages.nav_to(app, "community")
    pages.expect_at(app, "community")
    expect(app.locator("#view-community")).to_be_visible()
    assert app.evaluate("() => window.SCIMA_PAGE.id") == "home"


def test_hash_deep_links(page, base_url, seeded):
    """/#community and /analytics/#quests boot straight into their views."""
    seeded("preset:empty")
    pages.goto_app(page, base_url, "/#community")
    expect(page.locator("#view-community")).to_be_visible()

    pages.goto_app(page, base_url, "/analytics/#quests")
    expect(page.locator("#view-quests")).to_be_visible()


def test_page_tab_bar_switches_analytics_quests(page, base_url, seeded):
    """The Analytics page's in-page tab bar (Quests has no nav tab)."""
    seeded("preset:demo")
    pages.goto_app(page, base_url, "/analytics/")
    expect(page.locator("#page-tabs .tab-btn[data-view='quests']")).to_be_visible()
    page.click("#page-tabs .tab-btn[data-view='quests']")
    expect(page.locator("#view-quests")).to_be_visible()
    expect(page).to_have_url(re.compile(r"#quests"))
    page.click("#page-tabs .tab-btn[data-view='analytics']")
    expect(page.locator("#view-analytics")).to_be_visible()


def test_landing_page_has_no_tab_bar(app):
    """Home+Community both have nav tabs → the in-page bar is suppressed."""
    expect(app.locator("#page-tabs .tab-btn")).to_have_count(0)


@pytest.mark.parametrize("stub,view_id", [("/capture/", "decks"),
                                           ("/insights/", "analytics"),
                                           ("/tracker/", "home")])
def test_legacy_redirect_stubs(page, base_url, seeded, stub, view_id):
    """/capture/ → /decks/, /insights/ → /analytics/, /tracker/ → /#home."""
    seeded("preset:empty")
    page.goto(base_url + stub, wait_until="load")
    pages.expect_at(page, view_id)
    pages.app_ready(page)


def test_alt_shift_number_shortcuts(app, base_url):
    """Alt+Shift+<n> jumps to the nth visible nav tab (here: 3 → Study)."""
    app.press("body", "Alt+Shift+3")
    pages.expect_at(app, "study")
    pages.app_ready(app)
    assert pages.current_view(app) == "study"


def test_command_palette_navigates(app, base_url):
    """Ctrl+K → type a destination → Enter goes there."""
    pages.open_command_palette(app)
    expect(app.locator("#cmd-list .cmd-item").first).to_be_visible()
    app.fill("#cmd-input", "settings")
    visible = app.locator("#cmd-list .cmd-item:visible")
    expect(visible.first).to_contain_text("Go to Settings")
    app.press("#cmd-input", "Enter")
    pages.expect_at(app, "settings")
    pages.app_ready(app)


def test_unknown_route_note(page, base_url):
    """The static server has no SPA catch-all (the prod backend redirects
    unknown routes to /#home); under static serving a 404 is expected.
    This test documents the difference so it never silently changes."""
    resp = page.goto(base_url + "/definitely-not-a-page/", wait_until="load")
    assert resp.status == 404
