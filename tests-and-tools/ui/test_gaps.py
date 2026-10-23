"""Fill in the Gaps, upgraded: authored deterministic gaps (card.gaps),
automatic multi-gap density (settings.gapPercent / gapMax), one input per
blank with per-gap grading. Lives in site/home until re-minified → site_base.
"""
import pytest
from playwright.sync_api import expect

import seed as seedlib
from helpers import pages, storage

pytestmark = [pytest.mark.study]

BACK = "The mitochondria is the powerhouse of the cell"
WORDS20 = "alpha bravo charlie delta echo foxtrot golf hotel india juliet " \
          "kilo lima mike november oscar papa quebec romeo sierra tango"


def gaps_seed(back=BACK, gaps=None, settings=None):
    card = seedlib.make_card("Q", back)
    if gaps is not None:
        card["gaps"] = gaps
    return seedlib.make_mf_state(
        decks=[seedlib.make_deck("G", [card], deck_id="d_g")],
        settings=settings or {})


def start_gaps(page, site_base, seeded, mf):
    seeded(mf_state=mf)
    pages.goto_app(page, site_base, "/study/")
    pages.start_study_mode(page, "Fill in the Gaps")
    return page.locator(".gap-input")


def test_authored_single_gap(page, site_base, seeded):
    inputs = start_gaps(page, site_base, seeded, gaps_seed(gaps=["mitochondria"]))
    expect(inputs).to_have_count(1)
    ctx = page.locator(".flashcard-back-text").inner_text()
    assert "▁▁▁▁▁" in ctx and "mitochondria" not in ctx
    assert "powerhouse" in ctx                      # rest of sentence intact

    inputs.first.fill("mitochondria")
    page.get_by_role("button", name="Check Answer (↵)").click()
    expect(page.locator("#view-study")).to_contain_text("Correct!", timeout=5000)


def test_authored_two_gaps_partial_credit(page, site_base, seeded):
    inputs = start_gaps(page, site_base, seeded,
                        gaps_seed(gaps=["mitochondria", "powerhouse"]))
    expect(inputs).to_have_count(2)
    expect(page.locator("#view-study")).to_contain_text("2 gaps")

    inputs.nth(0).fill("ribosome")                  # wrong
    inputs.nth(1).fill("powerhouse")                # right
    page.get_by_role("button", name="Check Answer (↵)").click()
    expect(page.locator("#view-study")).to_contain_text("Close — 1/2 gaps", timeout=5000)
    expect(page.locator(".quiz-compare")).to_contain_text("mitochondria")
    expect(page.locator(".quiz-compare")).to_contain_text("powerhouse")


def test_authored_gaps_are_deterministic(page, site_base, seeded):
    mf = gaps_seed(gaps=["mitochondria", "cell"])
    inputs = start_gaps(page, site_base, seeded, mf)
    first = page.locator(".flashcard-back-text").inner_text()
    pages.exit_session(page)

    pages.start_study_mode(page, "Fill in the Gaps")
    second = page.locator(".flashcard-back-text").inner_text()
    assert first == second                          # authored = same blanks


def test_automatic_density_percent_and_cap(page, site_base, seeded):
    # 20 words, 50% → 10 wanted, capped by gapMax=4
    inputs = start_gaps(page, site_base, seeded,
                        gaps_seed(back=WORDS20, settings={"gapPercent": 50, "gapMax": 4}))
    expect(inputs).to_have_count(4)
    pages.exit_session(page)

    # 20 words, 5% → 1 gap
    seeded(mf_state=gaps_seed(back=WORDS20, settings={"gapPercent": 5, "gapMax": 4}))
    pages.goto_app(page, site_base, "/study/")
    pages.start_study_mode(page, "Fill in the Gaps")
    expect(page.locator(".gap-input")).to_have_count(1)


def test_card_editor_gaps_field_persists(page, site_base, seeded):
    seeded(mf_state=gaps_seed())
    pages.goto_app(page, site_base, "/decks/")
    page.locator(".subject-tile", has_text="Miscellaneous").click()
    page.locator(".deck-card").first.get_by_role(
        "button", name="Manage Cards").click()
    page.locator("#card-grid .card-selectable").first.get_by_role(
        "button", name="Edit").click()
    pages.expect_modal(page, "Edit Card")
    page.locator("#card-gaps-input").fill("mitochondria\npowerhouse")
    pages.modal(page).get_by_role("button", name="Save Changes").click()

    page.wait_for_timeout(900)
    mf = storage.read_mf_state(page)
    assert mf["decks"][0]["cards"][0]["gaps"] == ["mitochondria", "powerhouse"]


def test_settings_gap_ranges_persist(page, site_base, seeded):
    seeded("preset:empty")
    pages.goto_app(page, site_base, "/settings/")
    density = page.locator("input[aria-label='Gap density %']")
    expect(density).to_be_visible()
    density.fill("40")
    page.locator("input[aria-label='Max gaps per card']").fill("6")
    page.wait_for_timeout(900)
    mf = storage.read_mf_state(page)
    assert mf["settings"]["gapPercent"] == 40
    assert mf["settings"]["gapMax"] == 6
