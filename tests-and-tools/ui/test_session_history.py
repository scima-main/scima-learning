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
    pages.expect_modal(page, "Clear session history?")
    page.locator("#modal-body button", has_text="Clear").click()
    page.wait_for_timeout(300)
    expect(page.locator(f"{PANEL} .card")).to_have_count(0)
    expect(page.locator(PANEL)).to_contain_text("No sessions yet")


# ── Per-answer storage + wrong-only repeat ──────────────────────────────────

def _rate_through_session(page, ratings):
    """Rate the whole due queue (demo: 5 due) with the given rating list."""
    page.click("#tutorial-target-study-start")
    for rating in ratings:
        expect(page.locator(".flashcard.front")).to_be_visible(timeout=8000)
        pages.reveal(page)
        pages.rate(page, rating)
        page.wait_for_timeout(120)
    page.wait_for_function("() => !studySession || !studySession.active",
                           timeout=8000)
    expect(page.locator("#view-study")).to_contain_text("Session Complete!")
    page.get_by_role("button", name="New Session").click()   # back to picker
    expect(page.locator(TOGGLE)).to_be_visible()


def test_session_stores_every_answer_with_correctness(page, site_base, seeded):
    goto_study(page, site_base, seeded)
    _rate_through_session(page, ["Again", "Good", "Again", "Easy", "Good"])
    entry = page.evaluate("() => state.sessionLog[0]")
    assert entry["status"] == "complete"
    assert len(entry["answers"]) == 5, entry["answers"]
    assert [a["ok"] for a in entry["answers"]] == \
        [False, True, False, True, True]
    assert [a["r"] for a in entry["answers"]] == [1, 3, 1, 4, 3]
    assert all(isinstance(a["ms"], int) and a["ms"] >= 0 for a in entry["answers"])
    # answer ids are exactly the queue, in order
    assert [a["id"] for a in entry["answers"]] == entry["queueIds"]


def test_repeat_wrong_replays_only_missed_cards(page, site_base, seeded):
    goto_study(page, site_base, seeded)
    _rate_through_session(page, ["Again", "Good", "Again", "Easy", "Good"])
    entry = page.evaluate("() => state.sessionLog[0]")
    wrong_ids = [a["id"] for a in entry["answers"] if not a["ok"]]
    open_history(page)
    wrong_btn = page.locator(PANEL + " button", has_text="Repeat wrong (2)")
    expect(wrong_btn).to_be_visible()
    wrong_btn.click()
    expect(page.locator(".flashcard.front")).to_be_visible(timeout=8000)
    sess = page.evaluate("() => ({ n: studySession.queue.length,"
                         " ids: studySession.queue.map(c => c.id),"
                         " mode: studySession.mode })")
    assert sess["n"] == 2
    assert sess["ids"] == wrong_ids          # original order kept
    assert sess["mode"] == entry["mode"]


def test_no_repeat_wrong_button_when_nothing_missed(page, site_base, seeded):
    goto_study(page, site_base, seeded)
    _rate_through_session(page, ["Good"] * 5)
    open_history(page)
    expect(page.locator(PANEL + " button",
                        has_text=re.compile(r"Repeat wrong"))).to_have_count(0)
    expect(page.locator(PANEL + " button", has_text="Repeat")).to_be_visible()


def test_answers_survive_reload_and_trim_with_queues(page, site_base, seeded):
    goto_study(page, site_base, seeded)
    _rate_through_session(page, ["Again", "Good", "Again", "Easy", "Good"])
    page.wait_for_timeout(900)                 # debounced save
    page.reload(wait_until="load")
    pages.app_ready(page)
    entry = page.evaluate("() => state.sessionLog[0]")
    assert len(entry["answers"]) == 5
    # sanitizeMfState keeps the records (pass-through for log entries)
    assert all(set(a) >= {"id", "r", "ok"} for a in entry["answers"])


def test_clear_history_asks_and_undoes(page, site_base, seeded):
    goto_study(page, site_base, seeded)
    abort_after_one_rating(page)
    open_history(page)
    page.locator("#session-history-panel button", has_text="Clear history").click()
    pages.expect_modal(page, "Clear session history?")
    expect(page.locator("#modal-body")).to_contain_text("Are you sure")
    page.locator("#modal-body button", has_text="Clear").click()
    page.wait_for_timeout(300)
    assert page.evaluate("() => state.sessionLog.length") == 0
    page.locator("#toast button", has_text="Undo").click()
    page.wait_for_timeout(300)
    assert page.evaluate("() => state.sessionLog.length") == 1
