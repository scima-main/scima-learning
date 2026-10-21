"""Reverse study orientation: see the back (definition), answer the front
(term). The feature lives in site/home (source of truth) until the next
`minify` run refreshes the deploy bundle, so these tests use `site_base`.

Applies to 'basic' cards only; every mode honors it: flashcard flip,
written quiz, multiple choice, fill-in-the-gap.
"""
import re

import pytest
from playwright.sync_api import expect

import seed as seedlib
from helpers import pages, storage

pytestmark = [pytest.mark.study]

CARDS = [("Hello", "Hola"), ("Goodbye", "Adiós"),
         ("Thank you", "Gracias"), ("Water", "El agua")]


def reverse_seed(**settings_extra):
    deck = seedlib.make_deck(
        "Reverse Me", [seedlib.make_card(f, b) for f, b in CARDS],
        deck_id="d_rev")
    return seedlib.make_mf_state(
        decks=[deck], settings={"studyReverse": True, **settings_extra})


def goto_study(page, site_base, seeded, mf):
    seeded(mf_state=mf)
    pages.goto_app(page, site_base, "/study/")
    return page


def current_front_back(page):
    """(question_text_on_screen) → matching (front, back) from CARDS."""
    q = page.locator(".flashcard-front-text").inner_text().strip()
    for f, b in CARDS:
        if q == b:
            return f, b
    raise AssertionError(f"question {q!r} is not any card back — not reversed?")


def test_toggle_present_off_by_default_and_persists(page, site_base, seeded):
    seeded("preset:empty")
    pages.goto_app(page, site_base, "/study/")
    page.click("#study-opts-btn")          # options live in the drawer now
    page.wait_for_selector("#study-opts-panel.open")
    toggle = page.locator("#reverse-toggle")
    expect(toggle).to_be_visible()
    expect(toggle).not_to_be_checked()

    toggle.check()
    page.wait_for_timeout(900)                       # scheduleSave debounce
    assert storage.read_mf_state(page)["settings"]["studyReverse"] is True
    page.reload(wait_until="load")
    pages.app_ready(page)
    page.click("#study-opts-btn")
    page.wait_for_selector("#study-opts-panel.open")
    expect(page.locator("#reverse-toggle")).to_be_checked()


def test_reverse_flashcard_shows_back_first(page, site_base, seeded):
    goto_study(page, site_base, seeded, reverse_seed())
    page.click("#tutorial-target-study-start")
    expect(page.locator(".flashcard.front")).to_be_visible()

    front, back = current_front_back(page)           # question IS the back
    pages.reveal(page)
    expect(page.locator(".flashcard.back")).to_contain_text(front)


def test_reverse_written_quiz_types_the_term(page, site_base, seeded):
    goto_study(page, site_base, seeded, reverse_seed())
    pages.start_study_mode(page, "Written Quiz")

    front, back = current_front_back(page)
    box = page.locator(".quiz-input-area").first
    box.fill(front)                                   # type the TERM
    page.get_by_role("button", name=re.compile(r"Check Answer")).click()
    expect(page.locator("#view-study")).to_contain_text("Correct!", timeout=5000)
    expect(page.locator(".quiz-answer-text")).to_have_text(front)


def test_reverse_multiple_choice_options_are_terms(page, site_base, seeded):
    goto_study(page, site_base, seeded, reverse_seed())
    pages.start_study_mode(page, "Multiple Choice")

    current_front_back(page)                          # asserts reversed question
    options = page.locator("#view-study button.btn-ghost[style*='text-align']")
    expect(options).to_have_count(4)
    texts = options.all_inner_texts()
    fronts = {f for f, _ in CARDS}
    assert all(t.strip() in fronts for t in texts), texts


def test_reverse_gap_blanks_the_question(page, site_base, seeded):
    goto_study(page, site_base, seeded, reverse_seed())
    pages.start_study_mode(page, "Fill in the Gaps")

    expect(page.locator("#view-study")).to_contain_text("Complete the question:")
    # submit empty → the missing word is revealed; it must come from a FRONT
    page.get_by_role("button", name=re.compile(r"Check Answer")).click()
    missing = page.locator(".quiz-answer-text").first.inner_text().strip()
    missing = re.sub(r"^[⬜✅]\s*", "", missing)
    fronts = " || ".join(f for f, _ in CARDS)
    assert missing and missing in fronts, f"{missing!r} not a term"


def test_forward_orientation_unaffected_when_off(page, site_base, seeded):
    """studyReverse absent/false → classic front-first behaviour."""
    mf = reverse_seed()
    mf["settings"]["studyReverse"] = False
    goto_study(page, site_base, seeded, mf)
    page.click("#tutorial-target-study-start")
    q = page.locator(".flashcard-front-text").inner_text().strip()
    assert q in {f for f, _ in CARDS}, q
    pages.reveal(page)
    expect(page.locator(".flashcard.back")).to_contain_text(
        dict(CARDS)[q])


def test_non_basic_cards_ignore_reverse(page, site_base, seeded):
    """A markscheme card studies forward even with studyReverse on."""
    ms = seedlib.make_card("List two causes of X", "cause one\ncause two",
                           type="markscheme", answer_count=2, required_answers=2)
    basic = seedlib.make_card("Hello", "Hola")
    mf = seedlib.make_mf_state(
        decks=[seedlib.make_deck("Mixed", [ms, basic], deck_id="d_mix")],
        settings={"studyReverse": True})
    goto_study(page, site_base, seeded, mf)
    pages.start_study_mode(page, "Written Quiz")

    ctype = page.evaluate("() => studySession.queue[studySession.idx].type")
    q = page.locator(".flashcard-front-text").inner_text().strip()
    if ctype == "markscheme":
        # forward orientation despite studyReverse: question is its own front
        # (formatCardFront appends the mark count), pool hidden until checked
        assert q.startswith("List two causes of X"), q
        expect(page.locator("#view-study")).not_to_contain_text("cause one")
    else:
        assert q == "Hola"                            # basic card reverses
