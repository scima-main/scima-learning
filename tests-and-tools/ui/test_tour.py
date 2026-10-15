"""First-run guided tour: it fires on a fresh profile, can be skipped, and
leaves the live state clean (the tour runs in a sessionStorage sandbox)."""
import pytest
from playwright.sync_api import expect

import seed as seedlib
from helpers import pages, storage

pytestmark = [pytest.mark.tour]


def test_tour_fires_on_first_run(page, base_url, seeded):
    """Unseeded storage = genuine first run → tutorial overlay appears."""
    seeded(clear=True)                       # pristine localStorage
    pages.goto_app(page, base_url, "/")
    expect(page.locator("#tutorial-overlay")).to_be_visible(timeout=8000)
    expect(page.locator(".tutorial-title").first).not_to_be_empty()
    expect(page.get_by_role("button", name="Skip tutorial")).to_be_visible()


def test_skip_tour_discards_sandbox(page, base_url, seeded):
    """Skip → overlay gone, practice data discarded, onboarding completed."""
    seeded(clear=True)
    pages.goto_app(page, base_url, "/")
    expect(page.locator("#tutorial-overlay")).to_be_visible(timeout=8000)

    pages.dismiss_tour(page)

    expect(page.locator("#tutorial-overlay")).to_have_count(0)
    expect(page.locator("#view-home")).to_be_visible()
    # the tour's sandbox is discarded: no practice decks left behind
    assert storage.read_app_state(page)["decks"] == []
    # ...and it won't fire again (flag persisted)
    mf = storage.read_mf_state(page)
    assert mf["settings"]["onboarding"]["completed"] is True


def test_tour_does_not_refire_after_skip(page, base_url, seeded):
    seeded(clear=True)
    pages.goto_app(page, base_url, "/")
    expect(page.locator("#tutorial-overlay")).to_be_visible(timeout=8000)
    pages.dismiss_tour(page)

    page.reload(wait_until="load")
    pages.app_ready(page)
    page.wait_for_timeout(1000)              # tour would fire at ~300ms
    expect(page.locator("#tutorial-overlay")).to_have_count(0)


def test_pending_first_run_seed_also_tours(page, base_url, seeded):
    """The 'first_run' preset (onboarding NOT completed) behaves like a
    fresh profile even though localStorage is populated."""
    blob = seedlib.preset_first_run()
    seeded(mf_state=blob["mf_state"], tracker=blob["SCIMATracker"])
    pages.goto_app(page, base_url, "/")
    expect(page.locator("#tutorial-overlay")).to_be_visible(timeout=8000)
