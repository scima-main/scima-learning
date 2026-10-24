"""Create Deck → Import Text: spreadsheet pasting (grid importer).

Tabs from a LibreOffice/Excel copy, commas from .csv — auto-detected grid,
column mapping, header-row skip. Lives in site/home until re-minified.
"""
import pytest
from playwright.sync_api import expect

from helpers import pages

pytestmark = [pytest.mark.decks]

TSV_SAMPLE = (
    "Page URL with Meta Description tag missing \tPage depth\n"
    "https://study.scima-net.com/about/\t0\n"
    "https://study.scima-net.com/analytics/\t0\n"
    "https://study.scima-net.com/study/\t0\n"
    "https://study.scima-net.com/\t0\n"
    "https://study.scima-net.com/library/\t0\n"
    "https://study.scima-net.com/decks/\t0\n"
)


def open_text_import(page, site_base, seeded):
    seeded("preset:demo")
    pages.goto_app(page, site_base, "/decks/")
    page.get_by_role("button", name="New Deck").click()
    pages.expect_modal(page)
    page.locator("#modal-body button", has_text="Import Text").click()
    return pages.modal(page)


def paste_and_import(modal, page, text, name="Sheet Deck"):
    modal.get_by_placeholder("Paste your lines here…").fill(text)
    modal.locator("input[placeholder='e.g. Vocab from notes']").fill(name)
    modal.get_by_role("button", name="Import into Deck").click()


def test_tsv_paste_autodetects_grid_and_header(page, site_base, seeded):
    modal = open_text_import(page, site_base, seeded)
    modal.get_by_placeholder("Paste your lines here…").fill(TSV_SAMPLE)

    panel = modal.locator("label", has_text="Spreadsheet columns").first
    expect(panel).to_be_visible()
    expect(modal.get_by_text("tab, 2 columns")).to_be_visible()
    # header row auto-detected (text titles above URL/numeric columns)
    expect(modal.get_by_text("First row is a header — skip it")).to_be_visible()
    hdr = modal.locator("input[type=checkbox]").nth(1)
    expect(hdr).to_be_checked()
    expect(modal).to_contain_text("6 cards")

    paste_and_import(modal, page, TSV_SAMPLE)
    cards = page.evaluate(
        "() => state.decks.find(d => d.name === 'Sheet Deck').cards")
    assert len(cards) == 6
    assert cards[0]["front"] == "https://study.scima-net.com/about/"
    assert cards[0]["back"] == "0"


def test_header_toggle_keeps_title_row(page, site_base, seeded):
    modal = open_text_import(page, site_base, seeded)
    modal.get_by_placeholder("Paste your lines here…").fill(TSV_SAMPLE)
    modal.locator("input[type=checkbox]").nth(1).uncheck()
    expect(modal).to_contain_text("7 total")


def test_quoted_csv_columns(page, site_base, seeded):
    modal = open_text_import(page, site_base, seeded)
    modal.get_by_placeholder("Paste your lines here…").fill('Term,Definition\n"Ana, quo","Comma, inside"\nBon,"Say ""hi"" now"')
    expect(modal).to_contain_text("comma, 2 columns")
    expect(modal).to_contain_text("2 cards")
    modal.locator("input[placeholder='e.g. Vocab from notes']").fill("Csv Deck")
    modal.get_by_role("button", name="Import into Deck").click()
    cards = page.evaluate("() => state.decks.find(d => d.name === 'Csv Deck').cards")
    assert [c["front"] for c in cards] == ["Ana, quo", "Bon"]
    assert cards[0]["back"] == "Comma, inside"
    assert cards[1]["back"] == 'Say "hi" now'


def test_third_column_maps_to_hint(page, site_base, seeded):
    modal = open_text_import(page, site_base, seeded)
    modal.get_by_placeholder("Paste your lines here…").fill("Q1\tA1\tremember this\nQ2\tA2\tand that")
    hint_sel = modal.locator("label", has_text="Hint (optional)").locator("select")
    hint_sel.select_option("2")
    expect(modal).to_contain_text("hint: remember this")
    modal.locator("input[placeholder='e.g. Vocab from notes']").fill("Hint Deck")
    modal.get_by_role("button", name="Import into Deck").click()
    cards = page.evaluate("() => state.decks.find(d => d.name === 'Hint Deck').cards")
    assert cards[0]["hint"] == "remember this"


def test_prose_lines_stay_in_delimiter_mode(page, site_base, seeded):
    modal = open_text_import(page, site_base, seeded)
    modal.get_by_placeholder("Paste your lines here…").fill(
        "Mitosis — Cell division producing identical daughter cells\n"
        "Meiosis — Division producing gametes with half the chromosomes")
    # no uniform grid → the spreadsheet panel stays hidden
    expect(modal.get_by_text("Spreadsheet columns")).to_be_hidden()
    expect(modal).to_contain_text("2 cards")
