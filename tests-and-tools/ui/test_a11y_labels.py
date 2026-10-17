"""Accessible-labelling pass: every visible control has a meaningful
accessible name (aria-label beats emoji content), and every div-based click
target exposes role/tabindex/aria-label so keyboard + AT users can reach it.
Lives in site/home until the next `minify` run → `site_base` fixture.
"""
import pytest
from playwright.sync_api import expect

import seed as seedlib
from helpers import content, pages

pytestmark = [pytest.mark.content]

ROUTES = ["/", "/decks/", "/study/", "/library/", "/analytics/", "/settings/",
          "/about/", "/#community"]


@pytest.mark.parametrize("route", ROUTES)
def test_no_poorly_named_controls(page, site_base, seeded, route):
    seeded("preset:demo")
    pages.goto_app(page, site_base, route)
    assert content.poorly_named_controls(page) == []
    assert content.unnamed_visible_buttons(page) == []


@pytest.mark.parametrize("route", ROUTES)
def test_clickable_rows_expose_role_and_label(page, site_base, seeded, route):
    seeded("preset:demo")
    pages.goto_app(page, site_base, route)
    assert content.clickables_missing_role(page) == []


def test_deck_views_and_flows_fully_labelled(page, site_base, seeded):
    seeded("preset:demo")
    pages.goto_app(page, site_base, "/decks/")
    page.locator(".subject-tile", has_text="Miscellaneous").click()
    assert content.poorly_named_controls(page) == []
    assert content.clickables_missing_role(page) == []

    page.locator(".folder-item", has_text="Languages").click()
    assert content.poorly_named_controls(page) == []
    page.locator(".deck-card", has_text="Spanish Basics").get_by_role(
        "button", name="Manage Cards").click()
    assert content.poorly_named_controls(page) == []
    assert content.clickables_missing_role(page) == []

    # selection bar + modal stay clean too
    page.locator("#card-grid .card-selectable").first.click(position={"x": 40, "y": 20})
    assert content.poorly_named_controls(page) == []
    page.get_by_role("button", name="← Back").click()          # → folder view
    page.locator(".breadcrumb").get_by_text("Decks").click()   # → subjects
    page.click("#tutorial-target-new-deck")
    pages.expect_modal(page, "Create New Deck")
    assert content.poorly_named_controls(page) == []


def test_icon_buttons_carry_descriptive_names(page, site_base, seeded):
    """The old emoji-only names are gone: AT hears real descriptions."""
    seeded("preset:demo")
    pages.goto_app(page, site_base, "/decks/")
    page.locator(".subject-tile", has_text="Miscellaneous").click()
    row = page.locator(".folder-item", has_text="Languages")
    expect(row.get_by_role("button", name="Study folder Languages now")).to_be_visible()
    expect(row.get_by_role("button", name="Rename folder Languages")).to_be_visible()
    expect(row.get_by_role("button", name="Delete folder Languages")).to_be_visible()


def test_keyboard_activation_of_clickable_rows(page, site_base, seeded):
    """role=button divs are focusable and activate with Enter."""
    seeded("preset:demo")
    pages.goto_app(page, site_base, "/decks/")
    tile = page.locator(".subject-tile", has_text="Miscellaneous")
    expect(tile).to_have_attribute("role", "button")
    tile.focus()
    page.keyboard.press("Enter")
    expect(page.locator(".folder-item", has_text="Languages")).to_be_visible()

    page.locator(".folder-item", has_text="Languages").focus()
    page.keyboard.press("Space")
    expect(page.locator(".deck-card", has_text="Spanish Basics")).to_be_visible()


def test_flashcard_is_a_labelled_button(page, site_base, seeded):
    seeded("preset:demo")
    pages.goto_app(page, site_base, "/study/")
    page.click("#tutorial-target-study-start")
    card = page.locator(".flashcard")
    expect(card).to_have_attribute("role", "button")
    expect(card).to_have_attribute("aria-label",
                                   "Question shown — activate to reveal the answer")
    card.focus()
    page.keyboard.press("Enter")            # keyboard reveal
    expect(page.locator(".flashcard.back")).to_be_visible()
    expect(page.locator(".flashcard")).to_have_attribute("aria-label",
                                                         "Answer shown — rate it below")


def test_noscript_fallback_on_indexable_pages(page, site_base, seeded):
    seeded("preset:empty")
    for route in ["/", "/decks/", "/study/", "/library/", "/analytics/", "/about/"]:
        page.goto(site_base + route, wait_until="load")
        html = page.evaluate("() => document.documentElement.outerHTML")
        assert "<noscript>" in html, route
