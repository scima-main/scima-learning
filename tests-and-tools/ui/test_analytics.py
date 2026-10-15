"""Analytics + Quests views: stat cards, heatmap, tab bar, hash deep link."""
import pytest
from playwright.sync_api import expect

from helpers import pages

pytestmark = [pytest.mark.analytics]


def goto_analytics(page, base_url, seeded, preset="preset:demo", hash=""):
    seeded(preset)
    pages.goto_app(page, base_url, f"/analytics/{hash}")
    return page


def test_analytics_renders_history(page, base_url, seeded):
    """9 days of seeded reviewHistory → stat cards + a heatmap grid."""
    goto_analytics(page, base_url, seeded)
    expect(page.locator("#view-analytics")).to_contain_text("Retention")
    heatmap = page.locator("#view-analytics .heatmap")
    expect(heatmap).to_be_visible()
    assert heatmap.locator("*").count() > 0


def test_analytics_survives_empty_history(page, base_url, seeded, page_errors):
    goto_analytics(page, base_url, seeded, "preset:empty")
    expect(page.locator("#view-analytics")).not_to_be_empty()
    assert page_errors == []


def test_quests_tab_and_deep_link(page, base_url, seeded):
    """#quests deep link boots straight into the Quests view; the tab bar
    switches back to Analytics in-page (no reload)."""
    goto_analytics(page, base_url, seeded, hash="#quests")
    expect(page.locator("#view-quests")).to_be_visible()
    expect(page.locator("#view-quests")).to_contain_text("Level")
    expect(page.locator("#view-quests")).to_contain_text("total XP")

    page.click("#page-tabs .tab-btn[data-view='analytics']")
    expect(page.locator("#view-analytics")).to_be_visible()

    page.click("#page-tabs .tab-btn[data-view='quests']")
    expect(page.locator("#view-quests")).to_be_visible()
    expect(page).to_have_url(page.url.split("#")[0] + "#quests")
