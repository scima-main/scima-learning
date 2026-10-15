"""Study page: picker, SRS session (reveal/rate/progress/exit), cram,
written quiz, multiple choice, session restore across reload."""
import re

import pytest
from playwright.sync_api import expect

import seed as seedlib
from helpers import pages

pytestmark = [pytest.mark.study]

# demo seed → all-decks scope: 7 cards total, 5 due
# (Spanish Basics: 4 new due now; Biology: 1 due review + 2 future)
DUE_TOTAL, ALL_TOTAL = 5, 7

# The session queue is SHUFFLED (study.js: sort(() => Math.random() - 0.5)),
# so every test reads the card actually on screen and looks up its answer.
KNOWN = {
    "Which organelle performs photosynthesis?": "Chloroplast",
    "Which organelle is the powerhouse of the cell?": "Mitochondria",
    "What is the basic unit of life?": "The cell",
    "Hello": "Hola", "Goodbye": "Adiós", "Thank you": "Gracias", "Water": "El agua",
}


def current_card(page):
    """(front, back) of the card currently on screen."""
    front = page.locator(".flashcard-front-text").inner_text().strip()
    assert front in KNOWN, f"unexpected card front: {front!r}"
    return front, KNOWN[front]


def goto_study(page, base_url, seeded, preset="preset:demo"):
    seeded(preset)
    pages.goto_app(page, base_url, "/study/")
    return page


def test_picker_shows_all_six_modes(page, base_url, seeded):
    goto_study(page, base_url, seeded)
    expect(page.locator("#view-study")).to_contain_text("Study Mode")
    for mode in pages.STUDY_MODES:
        expect(page.locator("#view-study .card", has_text=mode).first).to_be_visible()
    # scope summary reflects the seed
    expect(page.locator("#view-study")).to_contain_text(
        f"{ALL_TOTAL} total cards · {DUE_TOTAL} due")


def test_picker_empty_scope_disables_start(page, base_url, seeded):
    """No decks at all → every mode's Start button is disabled."""
    goto_study(page, base_url, seeded, "preset:empty")
    expect(page.locator("#view-study")).to_contain_text("0 total cards · 0 due")
    start = page.locator("#view-study .card", has_text="SRS Review").get_by_role(
        "button", name="Start", exact=True)
    expect(start).to_be_disabled()


def test_srs_session_full_flow(page, base_url, seeded):
    """Start → Reveal → rate Good → progress advances → Exit → picker."""
    goto_study(page, base_url, seeded)
    page.click("#tutorial-target-study-start")   # stable id on SRS Review's Start

    # card 1 of 5, front side
    expect(page.locator(".flashcard.front")).to_be_visible()
    front, back = current_card(page)
    assert pages.session_progress(page) == (1, DUE_TOTAL)
    assert pages.rating_buttons(page).count() == 0   # hidden until revealed

    pages.reveal(page)
    expect(page.locator(".flashcard.back")).to_be_visible()
    expect(page.locator(".flashcard.back")).to_contain_text(back)
    for label in ("Again", "Hard", "Good", "Easy"):
        expect(page.locator(".rating-btn", has_text=label).first).to_be_visible()

    pages.rate(page, "Good")
    expect(page.locator(".flashcard")).to_be_visible(timeout=5000)
    assert pages.session_progress(page) == (2, DUE_TOTAL)

    pages.exit_session(page)
    expect(page.locator("#view-study")).to_contain_text("Study Mode")
    assert not pages.study_session_active(page)


def test_rating_advances_scheduling(page, base_url, seeded):
    """Rating Good pushes the card's due date into the future (SRS works)."""
    goto_study(page, base_url, seeded)
    page.click("#tutorial-target-study-start")
    front, _ = current_card(page)
    js = ("() => state.decks.flatMap(d=>d.cards).find(c=>c.front===%s)"
          % __import__("json").dumps(front))
    before = page.evaluate(js)
    pages.reveal(page)
    pages.rate(page, "Good")
    page.wait_for_timeout(1200)          # let scheduleSave() flush

    after = page.evaluate(js)
    assert after["due"] > before["due"]
    assert after["reps"] == before["reps"] + 1
    assert after["due"] > seedlib.now_ms()      # no longer due now


def test_cram_mode_ignores_due_dates(page, base_url, seeded):
    goto_study(page, base_url, seeded)
    pages.start_study_mode(page, "Cram Mode")
    expect(page.locator(".flashcard")).to_be_visible()
    assert pages.session_progress(page)[1] == ALL_TOTAL   # all 7, due or not


def test_written_quiz_correct_answer(page, base_url, seeded):
    """Type the right answer → Check Answer → 'Correct!' feedback."""
    goto_study(page, base_url, seeded)
    pages.start_study_mode(page, "Written Quiz")

    box = page.locator(".quiz-input-area").first
    expect(box).to_be_visible()
    front, back = current_card(page)
    box.fill(back)
    page.get_by_role("button", name=re.compile(r"Check Answer")).click()
    expect(page.locator("#view-study")).to_contain_text("Correct!", timeout=5000)


def test_multiple_choice_marks_option(page, base_url, seeded):
    """MC shows question + 4 options; clicking the true answer auto-rates
    (Easy) after ~450ms and advances to the next card."""
    goto_study(page, base_url, seeded)
    pages.start_study_mode(page, "Multiple Choice")

    expect(page.locator("#view-study")).to_contain_text("QUESTION")
    options = page.locator("#view-study button.btn-ghost[style*='text-align']")
    expect(options).to_have_count(4)
    assert pages.session_progress(page) == (1, ALL_TOTAL)

    front, back = current_card(page)
    options.filter(has_text=re.compile(f"^{re.escape(back)}$")).first.click()

    # auto rateCard() after 450ms → progress advances to card 2
    expect(page.locator("#view-study span",
                        has_text=re.compile(r"^2 / 7$")).first).to_be_visible(timeout=8000)


def test_hint_button_matches_card(page, base_url, seeded):
    """The hint button is enabled iff the current card actually has a hint."""
    goto_study(page, base_url, seeded)
    page.click("#tutorial-target-study-start")
    front, _ = current_card(page)
    has_hint = page.evaluate(
        "() => !!studySession.queue[studySession.idx].hint")
    hint = page.get_by_role("button", name=re.compile(r"Hint"))
    expect(hint).to_be_visible()
    if has_hint:
        expect(hint).to_be_enabled()
    else:
        expect(hint).to_be_disabled()


def test_session_survives_reload(page, base_url, seeded):
    """The per-page sessionStorage memory restores an active session."""
    goto_study(page, base_url, seeded)
    page.click("#tutorial-target-study-start")
    expect(page.locator(".flashcard.front")).to_be_visible()

    page.reload(wait_until="load")
    pages.app_ready(page)
    expect(page.locator(".flashcard")).to_be_visible(timeout=8000)
    assert pages.study_session_active(page)


def test_refine_stale_subset(page, base_url, seeded):
    """🎯 Refine → 'Least recently studied' + N=2 narrows the queue."""
    goto_study(page, base_url, seeded)
    page.select_option("#view-study select", "stale")
    n_input = page.locator("#view-study input[type='number']").first
    n_input.fill("2")
    n_input.dispatch_event("change")
    expect(page.locator("#view-study")).to_contain_text("2 of 7 cards selected")
