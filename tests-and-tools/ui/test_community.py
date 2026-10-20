"""Community view (/#community) against a MOCKED /api/v1.

The static test server has no backend, which is exactly the point: these
tests pin the frontend's contract with the registry API (response shapes
from backend/app/schemas.py) using in-browser route mocks — no server
needed, fully deterministic.
"""
import re

import pytest
from playwright.sync_api import expect

from helpers import pages
from helpers.api_mock import sample_online_handlers

pytestmark = [pytest.mark.community]


def open_community(page, base_url, seeded):
    seeded("preset:empty")
    pages.goto_app(page, base_url, "/")
    pages.nav_to(page, "community")
    expect(page.locator("#view-community")).to_be_visible()


def test_offline_state_without_backend(page, base_url, seeded):
    """No API under the static server → graceful offline banner (this is
    also what a real outage looks like)."""
    open_community(page, base_url, seeded)
    expect(page.locator("#view-community")).to_contain_text(
        "Server temporarily offline at /api/v1", timeout=15000)


def test_online_with_mocked_api(page, base_url, seeded, api_mock):
    recorded = api_mock(sample_online_handlers())
    open_community(page, base_url, seeded)

    expect(page.locator("#view-community")).to_contain_text(
        "Server online at /api/v1", timeout=15000)
    expect(page.locator("#view-community")).to_contain_text(
        "GCSE Chemistry — Atomic Structure", timeout=10000)
    expect(page.locator("#view-community")).to_contain_text("French Verbs A-Level")

    # the UI really called the documented endpoints
    paths = [r["path"] for r in recorded]
    assert any(p.endswith("/health") for p in paths), paths
    assert any("/decks" in p for p in paths), paths


def test_mocked_api_error_state(page, base_url, seeded, api_mock):
    """A 500 from the registry → offline/error banner, no uncaught throw."""
    api_mock({"/health": {"status": 500, "json": {"detail": "boom"}}})
    open_community(page, base_url, seeded)
    expect(page.locator("#view-community")).to_contain_text(
        "Server temporarily offline at /api/v1", timeout=15000)


# ── Community deck deep links (#community/<deckId>) ─────────────────────────

def _detail_handlers(deck_id="d_mock_chem"):
    """sample_online_handlers + a real detail payload for one deck.

    The exact-id pattern goes in FIRST: mock_api matches handler patterns in
    insertion order, and the sample set's broad "/decks*" (deck-list shape)
    would otherwise shadow "/decks/<id>" (detail shape)."""
    from helpers import api_mock as m
    detail = m.deck_summary(deck_id, "GCSE Chemistry — Atomic Structure",
                            subject="chemistry", card_count=58, downloads=23)
    handlers = {f"/decks/{deck_id}": {**detail, "export": {
        "version": 2,
        "deck": {"id": "local_x", "name": "GCSE Chemistry — Atomic Structure",
                 "emoji": "🧪", "cards": []},
    }}}
    handlers.update(m.sample_online_handlers())
    return handlers


def test_deck_deep_link_opens_detail(page, base_url, seeded, api_mock):
    """/#community/<deckId> boots straight into that deck's detail screen."""
    api_mock(_detail_handlers())
    seeded("preset:empty")
    pages.goto_app(page, base_url, "/#community/d_mock_chem")
    expect(page.locator("#view-community.active")).to_be_visible(timeout=10000)
    expect(page.locator("#screen-deck")).to_have_class(re.compile(r"\bactive\b"),
                                                       timeout=10000)
    expect(page.locator(".deck-detail-title")).to_contain_text(
        "GCSE Chemistry — Atomic Structure", timeout=10000)
    assert page.evaluate("() => location.hash") == "#community/d_mock_chem"


def test_opening_deck_mirrors_hash_and_back_folds(page, base_url, seeded, api_mock):
    """Clicking a deck card writes #community/<id>; ← Back folds to #community."""
    api_mock(_detail_handlers())
    seeded("preset:empty")
    pages.goto_app(page, base_url, "/")
    pages.nav_to(page, "community")
    card = page.locator(".deck-card", has_text="GCSE Chemistry").first
    expect(card).to_be_visible(timeout=10000)
    card.click()
    page.wait_for_function(
        "() => location.hash === '#community/d_mock_chem'", timeout=10000)
    expect(page.locator(".deck-detail-title")).to_contain_text("GCSE Chemistry")
    page.click("#back-to-search")
    page.wait_for_function("() => location.hash === '#community'", timeout=5000)
    expect(page.locator("#screen-search")).to_have_class(re.compile(r"\bactive\b"))


def test_copy_link_button_shares_deep_link(page, base_url, seeded, api_mock,
                                           context):
    context.grant_permissions(["clipboard-read", "clipboard-write"],
                              origin=base_url)
    api_mock(_detail_handlers())
    seeded("preset:empty")
    pages.goto_app(page, base_url, "/#community/d_mock_chem")
    expect(page.locator(".deck-detail-title")).to_contain_text(
        "GCSE Chemistry", timeout=10000)
    page.locator("#screen-deck button", has_text="Copy link").click()
    expect(page.locator("#toast")).to_contain_text("Deck link copied", timeout=5000)
    clip = page.evaluate("() => navigator.clipboard.readText()")
    assert clip.endswith("/#community/d_mock_chem"), clip


def test_deck_deep_link_offline_shows_error_state(page, base_url, seeded):
    """No API: the deep link still routes into the view and shows the
    detail screen's graceful error + a way back (no uncaught throw)."""
    seeded("preset:empty")
    errors: list = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    pages.goto_app(page, base_url, "/#community/d_whatever")
    expect(page.locator("#view-community.active")).to_be_visible(timeout=10000)
    expect(page.locator("#screen-deck")).to_have_class(re.compile(r"\bactive\b"),
                                                       timeout=10000)
    expect(page.locator("#deck-detail")).to_contain_text("Back to decks",
                                                         timeout=10000)
    assert errors == []
