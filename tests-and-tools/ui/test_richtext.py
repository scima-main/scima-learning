"""Currency-aware TeX delimiters: "$1.20" is money, "$x^2$" is math.

A naive $…$ inline-math pass turned "£1 = $1.20 changes to £1 = $1.50" into
KaTeX soup (the two dollar SIGNS paired up). shared.js's
scRichMathSegments() — used by renderRichText() and the case tool's TeX
protection — treats a "$" opening a plain numeric amount ended by
whitespace/sentence punctuation/end as a literal currency sign that can
neither open nor close math. Lives in site/home until re-minified →
`site_base`.
"""
import pytest
from playwright.sync_api import expect

import seed as seedlib
from helpers import pages

pytestmark = [pytest.mark.content]

CURRENCY = ("a currency buys more of another currency such as "
            "£1 = $1.20 changes to £1 = $1.50")


def _one_card_page(page, site_base, seeded, front, back="answer", cid="c_rt"):
    deck = seedlib.make_deck("RT", [seedlib.make_card(front, back,
                                                      card_id=cid)],
                             deck_id="d_rt")
    seeded(mf_state=seedlib.make_mf_state(decks=[deck]))
    pages.goto_app(page, site_base, "/decks/")
    page.evaluate("() => openDeckDetail('d_rt')")
    page.wait_for_selector("#card-grid .card", timeout=8000)
    return page.locator("#card-grid .card").first


def test_currency_amounts_are_not_latex(page, site_base, seeded):
    card = _one_card_page(page, site_base, seeded, CURRENCY)
    expect(card).to_contain_text("$1.20")
    expect(card).to_contain_text("$1.50")
    assert card.locator(".katex").count() == 0


def test_real_math_still_renders(page, site_base, seeded):
    card = _one_card_page(page, site_base, seeded,
                          "area is $2\\pi r^2$ watts, display $$x=\\frac{1}{2}$$")
    assert card.locator(".katex").count() >= 2
    txt = card.inner_text()
    assert "$" not in txt                        # no raw delimiters left
    assert "area is" in txt and "watts" in txt   # text around math survives
    assert "display" in txt                    # prose between spans


def test_mixed_math_and_money(page, site_base, seeded):
    card = _one_card_page(page, site_base, seeded,
                          "solve $x^2$ then pay $1.50 each")
    assert card.locator(".katex").count() == 1   # only the real math
    txt = card.inner_text()
    expect(card).to_contain_text("$1.50")        # money stays literal
    assert "solve" in txt and "then pay" in txt  # and prose survives too


def test_study_flashcard_shows_currency_literal(page, site_base, seeded):
    deck = seedlib.make_deck("RT", [seedlib.make_card(CURRENCY, "ok",
                                                      card_id="c_rt2")],
                             deck_id="d_rt2")
    seeded(mf_state=seedlib.make_mf_state(decks=[deck]))
    pages.goto_app(page, site_base, "/study/")
    page.click("#tutorial-target-study-start")
    expect(page.locator(".flashcard.front")).to_be_visible(timeout=10000)
    expect(page.locator(".flashcard.front")).to_contain_text("$1.20")
    assert page.locator(".flashcard.front .katex").count() == 0


def test_case_tool_cases_words_not_money(page, site_base, seeded):
    """With money no longer mistaken for a math span, the Title Case tool
    case-changes the words around the amounts and leaves amounts alone."""
    deck = seedlib.make_deck("RT", [seedlib.make_card(
        "£1 = $1.20 changes to £1 = $1.50 today", "b", card_id="c_rt3")],
        deck_id="d_rt3")
    seeded(mf_state=seedlib.make_mf_state(decks=[deck]))
    pages.goto_app(page, site_base, "/decks/")
    page.evaluate("() => openDeckDetail('d_rt3')")
    page.wait_for_selector("#card-grid .card", timeout=8000)
    page.locator("#view-decks button", has_text="Aa Case…").first.click()
    pages.expect_modal(page, "Standardize Case")
    page.locator("#modal-body button", has_text="Apply").click()
    page.wait_for_timeout(400)
    front = page.evaluate(
        "() => state.decks[0].cards.find(c => c.id === 'c_rt3').front")
    assert front == "£1 = $1.20 Changes to £1 = $1.50 Today", front
