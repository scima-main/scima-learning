"""Decks page: subject tiles, deck cards, create-deck & create-folder flows,
deck detail, card add, delete."""
import re

import pytest
from playwright.sync_api import expect

from helpers import pages, storage

pytestmark = [pytest.mark.decks]


def goto_decks(page, base_url, seeded, preset="preset:demo"):
    seeded(preset)
    pages.goto_app(page, base_url, "/decks/")
    return page


def test_empty_state(page, base_url, seeded):
    goto_decks(page, base_url, seeded, "preset:empty")
    expect(page.locator("#view-decks .empty-state")).to_contain_text("No decks yet")
    expect(page.get_by_role("button", name="+ New Deck")).to_be_visible()


def open_subject_and_folder(page, subject="Miscellaneous", folder="Languages"):
    """Subject tiles → folder rows → deck cards (demo seed nests the Spanish
    deck inside the Languages folder)."""
    page.locator(".subject-tile", has_text=subject).click()
    page.locator(".folder-item", has_text=folder).click()


def test_subject_tiles_and_drilldown(page, base_url, seeded):
    """Decks view groups by subject: Miscellaneous + Biology tiles from the
    demo seed; drilling subject → folder reveals the deck cards."""
    goto_decks(page, base_url, seeded)
    tiles = page.locator("#view-decks .subject-tile")
    names = tiles.locator(".subject-tile-name").all_inner_texts()
    assert "Miscellaneous" in names and "Biology" in names

    page.locator(".subject-tile", has_text="Miscellaneous").click()
    # the Languages folder is listed with its roll-up counts
    folder = page.locator("#view-decks .folder-item", has_text="Languages")
    expect(folder).to_be_visible()
    expect(folder).to_contain_text("4 due")

    folder.click()
    card = page.locator("#view-decks .deck-card", has_text="Spanish Basics")
    expect(card).to_be_visible()
    expect(card.locator(".deck-name")).to_have_text("Spanish Basics")


def test_create_deck_flow_persists(page, base_url, seeded):
    """+ New Deck → name → Create Deck: lands at the subject level and is
    written through to mf_state."""
    goto_decks(page, base_url, seeded)
    page.click("#tutorial-target-new-deck")
    pages.expect_modal(page, "Create New Deck")
    page.fill("#tutorial-target-deck-name-input", "Playwright Deck")
    pages.modal(page).get_by_role("button", name="Create Deck", exact=True).click()

    expect(pages.modal(page)).to_be_hidden(timeout=5000)
    # creation returns to the subject overview — drill in to see the card
    page.locator(".subject-tile", has_text="Miscellaneous").click()
    expect(page.locator("#view-decks .deck-card",
                        has_text="Playwright Deck")).to_be_visible(timeout=5000)

    # scheduleSave() is debounced ~600ms — then it must be on disk
    page.wait_for_timeout(900)
    mf = storage.read_mf_state(page)
    assert any(d["name"] == "Playwright Deck" for d in mf["decks"])


def test_deck_detail_and_back(page, base_url, seeded):
    """Manage Cards opens the deck detail with its cards; ← Back returns."""
    goto_decks(page, base_url, seeded)
    open_subject_and_folder(page)
    page.locator(".deck-card", has_text="Spanish Basics").get_by_role(
        "button", name="Manage Cards").click()

    expect(page.locator("#view-decks")).to_contain_text("Hello")
    expect(page.locator("#view-decks")).to_contain_text("Hola")
    expect(page.locator("#view-decks")).to_contain_text("El agua")

    page.get_by_role("button", name="← Back").click()
    expect(page.locator("#view-decks .subject-tile, #view-decks .deck-card").first).to_be_visible()


def test_add_card_in_deck_detail(page, base_url, seeded):
    """Deck detail → + Add Card → front/back → saved into the deck."""
    goto_decks(page, base_url, seeded)
    open_subject_and_folder(page)
    page.locator(".deck-card", has_text="Spanish Basics").get_by_role(
        "button", name="Manage Cards").click()

    page.get_by_role("button", name=re.compile(r"\+ Add Card")).click()
    pages.expect_modal(page, "Add Card")
    modal = pages.modal(page)
    modal.locator("#tutorial-target-card-front-input").fill("Good night")
    modal.locator("#tutorial-target-card-back-input").fill("Buenas noches")
    modal.get_by_role("button", name="Add Card", exact=True).click()

    expect(page.locator("#view-decks")).to_contain_text("Good night", timeout=5000)
    page.wait_for_timeout(900)
    st = storage.read_app_state(page)
    deck = next(d for d in st["decks"] if d["name"] == "Spanish Basics")
    assert any(c["front"] == "Good night" and c["back"] == "Buenas noches"
               for c in deck["cards"])


def test_create_folder_flow(page, base_url, seeded):
    """+ New Folder → name → Create Folder: folder tile appears."""
    goto_decks(page, base_url, seeded)
    page.locator(".subject-tile", has_text="Miscellaneous").click()
    page.get_by_role("button", name="+ New Folder").first.click()
    pages.expect_modal(page)
    modal = pages.modal(page)
    modal.locator("input[placeholder='e.g. Organic Chemistry']").fill("Verbs")
    modal.get_by_role("button", name="Create Folder").click()
    expect(page.locator("#view-decks")).to_contain_text("Verbs", timeout=5000)

    page.wait_for_timeout(900)
    st = storage.read_app_state(page)
    assert any(f["name"] == "Verbs" for f in st["folders"])


def test_delete_deck(page, base_url, seeded):
    """× on a deck card deletes it immediately (no confirm) and persists."""
    goto_decks(page, base_url, seeded)
    page.locator(".subject-tile", has_text="Biology").click()
    card = page.locator(".deck-card", has_text="Biology - Cells")
    expect(card).to_be_visible()

    card.locator("button[title='Delete deck']").click()

    expect(page.locator(".deck-card", has_text="Biology - Cells")).to_have_count(0,
                                                                                timeout=5000)
    page.wait_for_timeout(900)
    st = storage.read_app_state(page)
    assert all(d["name"] != "Biology - Cells" for d in st["decks"])


def test_study_now_scopes_to_deck(page, base_url, seeded):
    """▶ Study Now on a deck card → study picker scoped to that deck."""
    goto_decks(page, base_url, seeded)
    open_subject_and_folder(page)
    page.locator(".deck-card", has_text="Spanish Basics").get_by_role(
        "button", name="▶ Study Now").click()

    pages.expect_at(page, "study")
    pages.app_ready(page)
    expect(page.locator("#view-study")).to_contain_text("Spanish Basics")
    expect(page.locator("#view-study")).to_contain_text("4 total cards · 4 due")
