"""Study Session History panel (/study/ picker, under the scheduler info
button): past sessions listed newest-first; incomplete ones Resume from
where they stopped, all replayable ones Repeat. Lives in site/home until
the next `minify` run → tests use the `site_base` fixture.
"""
import re

import pytest
from playwright.sync_api import expect

import seed as seedlib
from helpers import pages, storage

pytestmark = [pytest.mark.study]

TOGGLE = "#session-history-toggle"
PANEL = "#session-history-panel"


def goto_study(page, site_base, seeded, preset="preset:demo"):
    seeded(preset)
    pages.goto_app(page, site_base, "/study/")
    return page


def open_history(page):
    page.click(TOGGLE)
    expect(page.locator(PANEL)).to_be_visible()


def abort_after_one_rating(page):
    """Start SRS, rate one card, ← Exit → one 'aborted' history entry."""
    page.click("#tutorial-target-study-start")
    expect(page.locator(".flashcard.front")).to_be_visible()
    pages.reveal(page)
    pages.rate(page, "Good")
    expect(page.locator(".flashcard")).to_be_visible(timeout=5000)
    pages.exit_session(page)
    expect(page.locator("#view-study")).to_contain_text("Study Mode")


def test_history_toggle_sits_under_scheduler_help(page, site_base, seeded):
    goto_study(page, site_base, seeded, "preset:empty")
    help_btn = page.locator("#view-study button[title*='How scheduling works']")
    toggle = page.locator(TOGGLE)
    expect(help_btn).to_be_visible()
    expect(toggle).to_be_visible()
    assert toggle.bounding_box()["y"] > help_btn.bounding_box()["y"]
    # closed by default, opens on click, announces state
    expect(page.locator(PANEL)).to_be_hidden()
    expect(toggle).to_have_attribute("aria-expanded", "false")
    open_history(page)
    expect(toggle).to_have_attribute("aria-expanded", "true")
    expect(page.locator(PANEL)).to_contain_text("No sessions yet")


def test_aborted_session_is_listed_resumable(page, site_base, seeded):
    goto_study(page, site_base, seeded)
    abort_after_one_rating(page)

    open_history(page)
    row = page.locator(f"{PANEL} .card").first
    expect(row).to_contain_text("Incomplete")
    expect(row).to_contain_text("1/5 cards")
    expect(row).to_contain_text("✅1 ❌0")
    expect(row.get_by_role("button", name="Resume")).to_be_visible()
    expect(row.get_by_role("button", name="Repeat")).to_be_visible()


def test_resume_continues_where_it_stopped(page, site_base, seeded):
    goto_study(page, site_base, seeded)
    abort_after_one_rating(page)
    open_history(page)
    page.locator(f"{PANEL} .card").first.get_by_role("button", name="Resume").click()

    expect(page.locator(".flashcard")).to_be_visible(timeout=5000)
    assert pages.session_progress(page) == (2, 5)      # card 1 already rated
    assert pages.study_session_active(page)


def test_repeat_restarts_the_same_queue(page, site_base, seeded):
    goto_study(page, site_base, seeded)
    abort_after_one_rating(page)
    open_history(page)
    page.locator(f"{PANEL} .card").first.get_by_role("button", name="Repeat").click()

    expect(page.locator(".flashcard")).to_be_visible(timeout=5000)
    assert pages.session_progress(page) == (1, 5)       # fresh run
    assert pages.study_session_active(page)


def test_completed_session_offers_repeat_only(page, site_base, seeded):
    """One due card → rating it finishes the session: Complete, no Resume."""
    deck = seedlib.make_deck("Solo", [seedlib.make_card("Q1", "A1")], deck_id="d_solo")
    seeded(mf_state=seedlib.make_mf_state(decks=[deck]))
    pages.goto_app(page, site_base, "/study/")
    page.click("#tutorial-target-study-start")
    pages.reveal(page)
    pages.rate(page, "Good")
    expect(page.locator("#view-study")).to_contain_text("Session Complete!")
    page.get_by_role("button", name="New Session").click()

    open_history(page)
    row = page.locator(f"{PANEL} .card").first
    expect(row).to_contain_text("Complete")
    expect(row.get_by_role("button", name="Resume")).to_have_count(0)
    expect(row.get_by_role("button", name="Repeat")).to_be_visible()


def test_history_survives_reload(page, site_base, seeded):
    goto_study(page, site_base, seeded)
    abort_after_one_rating(page)
    page.wait_for_timeout(900)                            # debounced save
    assert storage.read_mf_state(page)["sessionLog"][0]["status"] == "aborted"

    page.reload(wait_until="load")
    pages.app_ready(page)
    open_history(page)
    expect(page.locator(f"{PANEL} .card").first).to_contain_text("Incomplete")


def test_closed_tab_is_recorded_on_pagehide(page, site_base, seeded):
    """Closing/reloading mid-session (no ← Exit) still leaves a resumable
    entry — and the restored session doesn't double-log on later Exit."""
    goto_study(page, site_base, seeded)
    page.click("#tutorial-target-study-start")
    pages.reveal(page)
    pages.rate(page, "Good")
    page.reload(wait_until="load")                        # pagehide fires
    pages.app_ready(page)
    assert pages.study_session_active(page)               # pagemem restore

    pages.exit_session(page)
    page.wait_for_timeout(900)
    log = storage.read_mf_state(page)["sessionLog"]
    assert len(log) == 1, log                              # no double entry
    assert log[0]["status"] == "aborted"


def test_clear_history(page, site_base, seeded):
    goto_study(page, site_base, seeded)
    abort_after_one_rating(page)
    open_history(page)
    page.get_by_role("button", name="Clear history").click()
    expect(page.locator(f"{PANEL} .card")).to_have_count(0)
    expect(page.locator(PANEL)).to_contain_text("No sessions yet")
