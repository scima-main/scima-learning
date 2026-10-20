"""The hidden /packs/ page: lists official packs (API → manifest fallback),
adds them to local decks, offers raw downloads. site/home until re-minified.
"""
import re

import pytest
from playwright.sync_api import expect

from helpers import pages, storage

pytestmark = [pytest.mark.content]


def goto_packs(page, site_base, seeded, preset="preset:empty"):
    seeded(preset)
    pages.goto_app(page, site_base, "/packs/")
    return page


def test_packs_route_hidden_from_nav(page, site_base, seeded):
    goto_packs(page, site_base, seeded)
    expect(page.locator("#view-packs")).to_be_visible()
    expect(page.locator("#view-packs")).to_contain_text("Packs")
    page.click("#logo-icon")
    expect(page.locator("#nav .nav-btn[data-view='packs']")).to_have_count(0)


def test_manifest_fallback_lists_sample_pack(page, site_base, seeded):
    """Static server has no /api/v1/packs → manifest.json drives the list."""
    goto_packs(page, site_base, seeded)
    expect(page.locator("#packs-status")).to_contain_text("listed via manifest",
                                                          timeout=8000)
    card = page.locator("#packs-grid .card", has_text="Spanish Starter Pack")
    expect(card).to_be_visible()
    expect(card).to_contain_text("survival phrases")
    link = card.locator("a[download]")
    expect(link).to_have_attribute("href", re.compile(r"assets/packs/spanish-starter\.json$"))


def test_api_listing_preferred_over_manifest(page, site_base, seeded):
    page.route("**/api/v1/packs", lambda route: route.fulfill(
        status=200, json={"packs": [{"file": "spanish-starter.json",
                                     "name": "From Server", "description": "api",
                                     "bytes": 1234}]}))
    goto_packs(page, site_base, seeded)
    expect(page.locator("#packs-status")).to_contain_text("listed via server",
                                                          timeout=8000)
    expect(page.locator("#packs-grid .card")).to_contain_text("From Server")


def test_add_to_decks_imports_sanitized(page, site_base, seeded):
    goto_packs(page, site_base, seeded)
    card = page.locator("#packs-grid .card", has_text="Spanish Starter Pack")
    card.get_by_role("button", name="➕ Add to Decks").click()
    expect(card.get_by_role("button", name="✓ Added")).to_be_visible(timeout=8000)

    st = storage.read_app_state(page)
    deck = next(d for d in st["decks"] if d["name"] == "Spanish Starter Pack")
    assert len(deck["cards"]) == 6
    assert all(c["id"] not in ("pkes1", "pkes2") for c in deck["cards"])  # fresh ids
    assert all(c["ease"] == 2.5 and c["state"] == "new" for c in deck["cards"])
    # synonyms survived sanitizing
    please = next(c for c in deck["cards"] if c["front"] == "Please")
    assert please["tags"] == [] and please["hint"] == ""


def test_add_twice_creates_second_copy(page, site_base, seeded):
    goto_packs(page, site_base, seeded)
    card = page.locator("#packs-grid .card", has_text="Spanish Starter Pack")
    card.get_by_role("button", name="➕ Add to Decks").click()
    btn = card.get_by_role("button", name="✓ Added")
    expect(btn).to_be_visible(timeout=8000)
    page.wait_for_function(
        "() => (JSON.parse(localStorage.getItem('mf_state')||'{}').decks||[])"
        ".filter(d => d.name === 'Spanish Starter Pack').length === 1", timeout=8000)
    btn.click()
    page.wait_for_function(
        "() => (JSON.parse(localStorage.getItem('mf_state')||'{}').decks||[])"
        ".filter(d => d.name === 'Spanish Starter Pack').length === 2", timeout=8000)
    st = storage.read_app_state(page)
    assert sum(1 for d in st["decks"] if d["name"] == "Spanish Starter Pack") == 2


def test_about_media_resolver_points_at_assets(page, site_base, seeded):
    goto_packs(page, site_base, seeded)   # any page loads about.js? use /about/
    pages.goto_app(page, site_base, "/about/")
    url = page.evaluate("() => mdMediaUrl('logo.png')")
    assert url.endswith("assets/media/logo.png"), url
    url2 = page.evaluate("() => mdMediaUrl('media/banners/x.png')")
    assert url2.endswith("assets/media/banners/x.png"), url2


def test_robots_disallows_packs(site_base):
    import urllib.request
    with urllib.request.urlopen(site_base + "/robots.txt", timeout=5) as r:
        assert "Disallow: /packs/" in r.read().decode()


# ── Pack deep links (#packs/<pack>) ─────────────────────────────────────────

def test_pack_deep_link_opens_detail(page, site_base, seeded):
    """A shared /packs/#packs/<stem> link opens that pack's detail modal."""
    seeded("preset:empty")
    pages.goto_app(page, site_base, "/packs/#packs/spanish-starter")
    pages.expect_modal(page, "Spanish Starter Pack", timeout=10000)
    expect(page.locator("#pack-detail-contents")).to_contain_text("Contains",
                                                                  timeout=8000)
    assert page.evaluate("() => location.hash") == "#packs/spanish-starter"


def test_pack_deep_link_resolves_leniently(page, site_base, seeded):
    """The payload resolves by display name too (matchName), not just the
    file stem — shared links survive small typos and case changes."""
    seeded("preset:empty")
    pages.goto_app(page, site_base, "/packs/#packs/Spanish%20Starter")
    pages.expect_modal(page, "Spanish Starter Pack", timeout=10000)


def test_pack_deep_link_close_folds_hash(page, site_base, seeded):
    seeded("preset:empty")
    pages.goto_app(page, site_base, "/packs/#packs/spanish-starter")
    pages.expect_modal(page, "Spanish Starter Pack", timeout=10000)
    page.click("#modal-close")
    page.wait_for_function("() => location.hash === '#packs'", timeout=5000)
    expect(page.locator("#packs-grid .card")).to_have_count(1)


def test_pack_deep_link_unknown_pack_shows_list(page, site_base, seeded):
    """An unresolvable payload is a no-op: the grid renders, no modal."""
    seeded("preset:empty")
    pages.goto_app(page, site_base, "/packs/#packs/not-a-real-pack")
    expect(page.locator("#packs-grid .card",
                        has_text="Spanish Starter Pack")).to_be_visible(timeout=8000)
    expect(page.locator("#modal-backdrop")).to_have_class(re.compile(r"hidden"))


def test_pack_card_title_opens_detail_and_mirrors_hash(page, site_base, seeded):
    goto_packs(page, site_base, seeded)
    card = page.locator("#packs-grid .card", has_text="Spanish Starter Pack")
    expect(card).to_be_visible(timeout=8000)
    card.locator("div[role='button']").click()
    pages.expect_modal(page, "Spanish Starter Pack")
    page.wait_for_function(
        "() => location.hash === '#packs/spanish-starter'", timeout=5000)


def test_pack_share_button_copies_deep_link(page, site_base, seeded, context):
    context.grant_permissions(["clipboard-read", "clipboard-write"],
                              origin=site_base)
    goto_packs(page, site_base, seeded)
    card = page.locator("#packs-grid .card", has_text="Spanish Starter Pack")
    expect(card).to_be_visible(timeout=8000)
    card.locator("button[title*='shareable link']").click()
    expect(page.locator("#toast")).to_contain_text("Pack link copied", timeout=5000)
    clip = page.evaluate("() => navigator.clipboard.readText()")
    assert clip.endswith("/packs/#packs/spanish-starter"), clip
    assert clip.startswith(site_base), clip
