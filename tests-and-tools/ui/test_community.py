"""Community view (/#community) against a MOCKED /api/v1.

The static test server has no backend, which is exactly the point: these
tests pin the frontend's contract with the registry API (response shapes
from backend/app/schemas.py) using in-browser route mocks — no server
needed, fully deterministic.
"""
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
