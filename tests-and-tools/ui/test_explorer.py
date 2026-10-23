"""Deck-explorer overlay refinements (site/home until re-minified).

The shared explorer (Study → "Browse Decks…", Community upload picker)
gained a filter box, footer selection chips, radio-style single-pick
checkboxes and Esc/focus handling — all asserted here against site_base.
"""
import pytest
from playwright.sync_api import expect

from helpers import pages

pytestmark = [pytest.mark.study]


def open_explorer(page, site_base, seeded):
    seeded("preset:demo")
    pages.goto_app(page, site_base, "/study/")
    page.get_by_role("button", name="Browse Decks…").click()
    overlay = page.locator("#study-scope-overlay")
    expect(overlay).to_be_visible()
    return overlay


def test_search_filters_and_esc_clears_then_closes(page, site_base, seeded):
    overlay = open_explorer(page, site_base, seeded)
    search = overlay.locator("input[type=search]")
    expect(search).to_be_visible()

    search.fill("spanish")
    expect(overlay.get_by_text("Spanish Basics")).to_be_visible()
    expect(overlay.get_by_text("Biology - Cells")).to_have_count(0)

    search.fill("zzz")
    expect(overlay.get_by_text("No matches")).to_be_visible()

    # first Esc clears the filter, the overlay stays (back to browsing)…
    search.press("Escape")
    expect(search).to_have_value("")
    expect(overlay).to_be_visible()
    expect(overlay.get_by_text("All Subjects")).to_be_visible()
    # …the second one closes it (and the search row never swallows it)
    page.keyboard.press("Escape")
    expect(overlay).to_have_count(0)


def test_selection_shows_removable_footer_chips(page, site_base, seeded):
    overlay = open_explorer(page, site_base, seeded)
    overlay.locator("input[type=search]").fill("spanish")
    overlay.locator(".grid-3 .card").first.click()      # tile click toggles

    chip = overlay.locator(".explorer-chip")
    expect(chip).to_have_count(1)
    expect(chip).to_contain_text("Spanish Basics")
    expect(overlay).to_contain_text("1 selected")

    chip.locator("button").click()                      # × drops the scope
    expect(overlay.locator(".explorer-chip")).to_have_count(0)
    expect(overlay).to_contain_text("Nothing selected")


def test_single_mode_uses_radio_checkboxes(page, site_base, seeded):
    """Community's upload picker is the single-deck flavour: radios, no
    Recents row, and picking a second deck replaces the first."""
    seeded("preset:demo")
    pages.goto_app(page, site_base, "/")
    pages.nav_to(page, "community")
    page.locator("#upload-dropzone").click()
    overlay = page.locator("#deck-picker-overlay")
    expect(overlay).to_be_visible()
    search = overlay.locator("input[type=search]")
    search.fill("cells")
    # deck tiles in single mode carry radio-style checkboxes
    expect(overlay.locator(".scope-checkbox.scope-radio").first).to_be_visible()
    overlay.locator(".grid-3 .card").first.click()
    expect(overlay.locator(".scope-radio.checked")).to_have_count(1)
    expect(overlay).to_contain_text("selected ·")
    # picking another deck REPLACES the pick (exactly one, always)
    search.fill("spanish")
    overlay.locator(".grid-3 .card").first.click()
    expect(overlay.locator(".scope-radio.checked")).to_have_count(1)
    expect(overlay).to_contain_text("Spanish Basics\" selected")
    # first Esc clears the still-active filter, second closes the overlay
    page.keyboard.press("Escape")
    expect(overlay).to_be_visible()
    page.keyboard.press("Escape")
    expect(overlay).to_have_count(0)
