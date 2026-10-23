"""Graded answers NEVER auto-advance: a Next/Finish button appears instead,
with an optional visible countdown (settings.autoNextSeconds, 0 = manual).
Lives in site/home until re-minified → `site_base` fixture.
"""
import re

import pytest
from playwright.sync_api import expect

import seed as seedlib
from helpers import pages

pytestmark = [pytest.mark.study]

KNOWN = {
    "Which organelle performs photosynthesis?": "Chloroplast",
    "Which organelle is the powerhouse of the cell?": "Mitochondria",
    "What is the basic unit of life?": "The cell",
    "Hello": "Hola", "Goodbye": "Adiós", "Thank you": "Gracias", "Water": "El agua",
}


def current_answer(page):
    front = page.locator(".flashcard-front-text").inner_text().strip()
    assert front in KNOWN, front
    return KNOWN[front]


def test_quiz_waits_for_next_button(page, site_base, seeded):
    seeded("preset:demo")
    pages.goto_app(page, site_base, "/study/")
    pages.start_study_mode(page, "Written Quiz")
    page.locator(".quiz-input-area").first.fill(current_answer(page))
    page.get_by_role("button", name=re.compile(r"Check Answer")).click()
    expect(page.locator("#view-study")).to_contain_text("Correct!", timeout=5000)

    page.wait_for_timeout(1500)                      # old build auto-advanced here
    assert pages.session_progress(page) == (1, 7)    # still card 1 (quiz = all cards)
    expect(page.locator("#view-study")).not_to_contain_text("Next in")
    page.get_by_role("button", name="Next").click()
    assert pages.session_progress(page) == (2, 7)


def test_gaps_waits_then_finishes(page, site_base, seeded):
    card = seedlib.make_card("chlorophyll makes leaves green", "x",
                             card_id="c_gap")
    card["back"] = "chlorophyll makes leaves green"
    card["gaps"] = ["chlorophyll"]
    seeded(mf_state=seedlib.make_mf_state(
        decks=[seedlib.make_deck("Gap", [card], deck_id="d_gap")]))
    pages.goto_app(page, site_base, "/study/")
    pages.start_study_mode(page, "Fill in the Gaps")
    page.locator(".gap-input").first.fill("chlorophyll")
    page.get_by_role("button", name=re.compile(r"Check Answer")).click()
    expect(page.locator("#view-study")).to_contain_text("Correct!", timeout=5000)

    page.wait_for_timeout(1200)
    expect(page.locator("#view-study")).not_to_contain_text("Session Complete!")
    page.get_by_role("button", name="Finish").click()   # last card
    expect(page.locator("#view-study")).to_contain_text("Session Complete!")


def test_countdown_setting_auto_advances_after_n_seconds(page, site_base, seeded):
    seeded(mf_state=seedlib.make_mf_state(
        decks=[seedlib.make_deck("D", [seedlib.make_card("Hello", "Hola")],
                                 deck_id="d_cd")],
        settings={"autoNextSeconds": 2}))
    pages.goto_app(page, site_base, "/study/")
    pages.start_study_mode(page, "Written Quiz")
    page.locator(".quiz-input-area").first.fill("Hola")
    page.get_by_role("button", name=re.compile(r"Check Answer")).click()
    expect(page.locator("#view-study")).to_contain_text("Next in 2s", timeout=5000)

    page.wait_for_timeout(2600)                          # no clicks at all
    expect(page.locator("#view-study")).to_contain_text("Session Complete!",
                                                        timeout=5000)


def test_multiple_choice_waits_for_next(page, site_base, seeded):
    seeded("preset:demo")
    pages.goto_app(page, site_base, "/study/")
    pages.start_study_mode(page, "Multiple Choice")
    front = page.locator(".flashcard-front-text").inner_text().strip()
    options = page.locator("#view-study button.btn-ghost[style*='text-align']")
    options.filter(has_text=re.compile(f"^{re.escape(KNOWN[front])}$")).first.click()

    page.wait_for_timeout(900)                           # old build: 450ms auto
    assert pages.session_progress(page) == (1, 7)
    page.get_by_role("button", name="Next").click()
    assert pages.session_progress(page) == (2, 7)


def test_settings_auto_next_slider(page, site_base, seeded):
    from helpers import storage
    seeded("preset:empty")
    pages.goto_app(page, site_base, "/settings/")
    slider = page.locator("input[aria-label='Auto-next countdown (s, 0 = manual)']")
    expect(slider).to_be_visible()
    slider.fill("7")
    page.wait_for_timeout(900)
    assert storage.read_mf_state(page)["settings"]["autoNextSeconds"] == 7
