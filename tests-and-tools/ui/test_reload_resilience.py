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
