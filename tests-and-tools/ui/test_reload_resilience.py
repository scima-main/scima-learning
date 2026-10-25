"""Ordinary-reload resilience: the stale-cache mix that used to drop the
inline SCIMA_PAGE declaration (summoning the eleven-tab bar), poison the
icon-sprite / ABOUT.md fetches, and misresolve route-relative asset URLs.

These tests simulate each failure mode (stripped inline script, first
request aborted/poisoned) and assert the app self-heals on a normal load —
no hard reload required.
"""
import re

import pytest
from playwright.sync_api import expect

from helpers import pages

pytestmark = [pytest.mark.nav]


def test_missing_scima_page_declaration_degrades_to_page_views(page, base_url, seeded):
    seeded("preset:empty")

    def strip_declaration(route):
        if route.request.resource_type != "document":
            route.continue_()
            return
        res = route.fetch()
        body = re.sub(r"<script>window\.SCIMA_PAGE[^<]*</script>", "",
                      res.text(), count=1)
        route.fulfill(response=res, body=body)

    page.route(base_url + "/study/", strip_declaration)
    page.goto(base_url + "/study/", wait_until="load")
    page.wait_for_timeout(900)
    # No eleven-tab bar across the top: the in-page tab host stays empty
    assert page.evaluate(
        "() => (document.getElementById('page-tabs') || {children: []}).children.length") == 0
    # …and the page still renders its own view
    expect(page.locator("#view-study")).to_contain_text("Study Mode")


def test_sprite_fetch_survives_first_failure(page, base_url, seeded):
    seeded("preset:empty")
    hits = {"n": 0}

    def flaky(route):
        hits["n"] += 1
        if hits["n"] == 1:
            route.abort()
        else:
            route.continue_()

    page.route("**/assets/svg/icons.svg*", flaky)
    pages.goto_app(page, base_url, "/")
    page.wait_for_timeout(1200)
    assert hits["n"] >= 2, "sprite fetch must retry after a failure"
    assert page.evaluate("() => !!document.getElementById('sc-icon-sprite')")
    # …and icons actually render glyphs, not empty boxes
    assert page.evaluate(
        "() => document.querySelectorAll('#sc-icon-sprite symbol').length") > 10


def test_about_markdown_survives_first_failure(page, base_url, seeded):
    seeded("preset:empty")
    hits = {"n": 0}

    def flaky(route):
        hits["n"] += 1
        if hits["n"] == 1:
            route.abort()
        else:
            route.continue_()

    page.route("**/ABOUT.md*", flaky)
    pages.goto_app(page, base_url, "/about/")
    expect(page.locator("#view-about")).to_contain_text("CHANGELOG", timeout=8000)
    assert hits["n"] >= 2
    assert "Couldn’t load ABOUT.md" not in page.locator("#view-about").inner_text()


def test_boot_watchdog_self_heals_stale_script_mix(page, base_url, seeded):
    """Simulate the stale-cache mix: the served document loses one core
    script on the FIRST request only (as a stale cached HTML would). Boot
    cannot complete; the watchdog must cache-bust-reload once and the second
    (clean) document must boot fully — no hard reload, no empty shell."""
    seeded("preset:empty")
    hits = {"n": 0}
    docs = []
    page.on("request", lambda r: docs.append(r.url)
            if r.resource_type == "document" else None)

    def strip_once(route):
        if route.request.resource_type != "document":
            route.continue_()
            return
        hits["n"] += 1
        res = route.fetch()
        body = res.text().replace('<script src="shared/shared.js"></script>', '', 1)
        route.fulfill(response=res, body=body)

    # only the bare "/" document is poisoned; the watchdog's ?sc= retry
    # (different URL) gets the clean document, exactly like a hard reload
    page.route(base_url + "/", strip_once)
    page.goto(base_url + "/", wait_until="load")
    # watchdog fires at ~4s, replaces with ?sc=…, clean doc boots
    # (nav lives in a closed drawer → attached, not visible)
    expect(page.locator("#nav .nav-btn").first).to_be_attached(timeout=20000)
    expect(page.locator("#view-home")).to_contain_text("Create First Deck", timeout=10000)
    assert hits["n"] == 1, "only the first document should be poisoned"
    assert len([u for u in docs if u.split('?')[0] == base_url + "/"]) >= 2, \
        "watchdog must reload a second (clean) document"
    assert "sc=" in page.url
    assert page.evaluate("() => window.__scimaBoot && window.__scimaBoot.ok") is True


def test_boot_watchdog_stays_quiet_on_healthy_boot(page, base_url, seeded):
    seeded("preset:empty")
    pages.goto_app(page, base_url, "/")
    expect(page.locator("#nav .nav-btn").first).to_be_attached()
    page.wait_for_timeout(4500)   # past the watchdog window
    assert "sc=" not in page.url, "healthy boots must never trigger a retry"
    assert page.evaluate("() => window.__scimaBoot.ok") is True


def test_crosspage_nav_correct_without_page_declaration(page, base_url, seeded):
    """With the inline SCIMA_PAGE declaration missing (stale-cache mix),
    ROOT_REL must still sniff '../' on route pages: Home from /decks/ must
    cross to /#home (not stick as /decks/#home) and Community must reach the
    landing's #community view, not hash onto the wrong document."""
    seeded("preset:empty")

    def strip_on_decks(route):
        if route.request.resource_type != "document":
            route.continue_()
            return
        res = route.fetch()
        body = re.sub(r"<script>window\.SCIMA_PAGE[^<]*</script>", "",
                      res.text(), count=1)
        route.fulfill(response=res, body=body)

    page.route(base_url + "/decks/", strip_on_decks)
    page.goto(base_url + "/decks/", wait_until="load")
    page.wait_for_timeout(900)
    assert page.evaluate("() => typeof window.SCIMA_PAGE") == "undefined"

    page.locator("#logo-icon").click()
    page.locator("#nav .nav-btn[data-view='home']").click()
    page.wait_for_timeout(1200)
    from urllib.parse import urlparse
    u = urlparse(page.url)
    assert u.path == "/", f"Home from /decks/ must cross to the landing, got {page.url}"
    expect(page.locator("#view-home.active")).to_be_attached()

    # back to the poisoned decks doc, then Community
    page.goto(base_url + "/decks/", wait_until="load")
    page.wait_for_timeout(900)
    page.locator("#logo-icon").click()
    page.locator("#nav .nav-btn[data-view='community']").click()
    page.wait_for_timeout(1200)
    u = urlparse(page.url)
    assert u.path == "/" and u.fragment == "community", \
        f"Community must reach the landing's #community view, got {page.url}"
    expect(page.locator("#view-community.active")).to_be_attached()
    assert page.locator("#view-community").inner_text().strip() != ""


def test_document_served_at_wrong_path_self_corrects(page, base_url, seeded):
    """Edge/deploy mis-serve simulation: the LANDING document answered for
    /decks/. Relative assets and cross-page jumps would all break there, so
    the boot watchdog must relocate to the document's real URL once."""
    seeded("preset:empty")
    landing = {"body": None}

    def misserve(route):
        if route.request.resource_type != "document":
            route.continue_()
            return
        if landing["body"] is None:
            landing["body"] = route.fetch(url=base_url + "/").text()
        route.fulfill(body=landing["body"], headers={"Content-Type": "text/html"})

    # /decks/ will be answered with the LANDING document (mis-serve)
    page.route(base_url + "/decks/", misserve)
    page.goto(base_url + "/decks/", wait_until="load")
    page.wait_for_timeout(1500)
    from urllib.parse import urlparse
    assert urlparse(page.url).path == "/", \
        f"mis-served landing document must relocate to /, got {page.url}"
    expect(page.locator("#view-home.active")).to_be_attached()
    assert page.evaluate("() => document.querySelectorAll('#nav .nav-btn').length") > 0
