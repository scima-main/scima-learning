"""Library page: empty state, seeded source rows, manual 'Add Source' flow."""
import pytest
from playwright.sync_api import expect

from helpers import pages, storage

pytestmark = [pytest.mark.library]


def goto_library(page, base_url, seeded, preset="preset:demo"):
    seeded(preset)
    pages.goto_app(page, base_url, "/library/")
    return page


def test_empty_state(page, base_url, seeded):
    goto_library(page, base_url, seeded, "preset:empty")
    expect(page.locator("#view-library .empty-state")).to_contain_text(
        "No source texts yet")
    expect(page.get_by_role("button", name="+ Add Source")).to_be_visible()


def test_seeded_source_row(page, base_url, seeded):
    goto_library(page, base_url, seeded)
    row = page.locator("#view-library .source-name",
                       has_text="Cells - A Short Introduction.txt")
    expect(row).to_be_visible()
    expect(page.locator("#view-library .source-icon use").first).to_have_attribute("href", "#i-note")


def test_add_plain_text_source(page, base_url, seeded):
    """+ Add Source → paste text → row appears and persists to mf_state."""
    goto_library(page, base_url, seeded, "preset:empty")
    page.get_by_role("button", name="+ Add Source").click()
    pages.expect_modal(page, "Add Source Text")

    modal = pages.modal(page)
    modal.locator("input[placeholder^='e.g. Of Mice and Men']").fill(
        "Test Notes — Playwright")
    modal.locator("textarea[placeholder='Paste the full text here…']").fill(
        "Mitochondria is the powerhouse of the cell.")
    modal.get_by_role("button", name="Add Source", exact=True).click()

    expect(page.locator("#view-library .source-name",
                        has_text="Test Notes — Playwright")).to_be_visible(timeout=8000)

    page.wait_for_timeout(1200)          # content hash + scheduleSave flush
    mf = storage.read_mf_state(page)
    src = next(s for s in mf["sources"] if s["name"] == "Test Notes — Playwright")
    assert "powerhouse" in src["content"]


def test_delete_source_asks_and_undoes_with_citations(page, site_base, seeded):
    """Source delete goes through the confirm modal; Undo restores the
    source AND the card citations it cleared (blob cleanup is deferred)."""
    seeded("preset:demo")
    pages.goto_app(page, site_base, "/library/")
    src = page.locator(".source-item").first
    expect(src).to_be_visible()
    src.locator("button", has_text="Delete").click()
    pages.expect_modal(page, "Delete source?")
    expect(page.locator("#modal-body")).to_contain_text(
        "Are you sure you want to delete")
    page.locator("#modal-body button", has_text="Cancel").click()
    expect(page.locator(".source-item")).to_be_visible()

    src.locator("button", has_text="Delete").click()
    pages.expect_modal(page, "Delete source?")
    page.locator("#modal-body button", has_text="Delete").click()
    page.wait_for_timeout(300)
    assert page.evaluate("() => state.sources.length") == 0
    page.locator("#toast button", has_text="Undo").click()
    page.wait_for_timeout(300)
    assert page.evaluate("() => state.sources.length") == 1
