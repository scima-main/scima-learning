"""SEO layer: robots.txt, sitemap.xml, per-page titles/descriptions,
canonical/OG tags on content routes and noindex on app-only/stub routes.
Served from site/home (source tree) → `site_base` fixture.
"""
import urllib.request
import xml.etree.ElementTree as ET

import pytest
from playwright.sync_api import expect

from helpers import pages

pytestmark = [pytest.mark.content]

HOST = "https://study.scima-net.com"
SITEMAP_ROUTES = ["/", "/decks/", "/study/", "/library/", "/analytics/", "/about/"]


def _get(base, path):
    with urllib.request.urlopen(base + path, timeout=5) as r:
        return r.status, r.read().decode("utf-8")


def test_robots_txt(site_base):
    status, body = _get(site_base, "/robots.txt")
    assert status == 200
    assert f"Sitemap: {HOST}/sitemap.xml" in body
    assert "Disallow: /api/" in body          # registry API is not content
    assert "Disallow: /dashboard/" in body    # legacy duplicate mount
    for stub in ("/capture/", "/insights/", "/tracker/"):
        assert f"Disallow: {stub}" in body


def test_sitemap_xml_is_valid_and_complete(site_base):
    status, body = _get(site_base, "/sitemap.xml")
    assert status == 200
    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    root = ET.fromstring(body)                       # raises if malformed
    locs = [u.find("s:loc", ns).text for u in root.findall("s:url", ns)]
    assert locs == [HOST + r for r in SITEMAP_ROUTES]
    assert f"{HOST}/settings/" not in locs           # app-only view excluded


def test_unique_descriptive_titles(page, site_base, seeded):
    seeded("preset:empty")
    titles = []
    for route, frag in [("/", "Adaptive Flashcard Study"), ("/decks/", "Decks —"),
                        ("/study/", "Study —"), ("/library/", "Library —"),
                        ("/analytics/", "Analytics —"), ("/about/", "About &")]:
        pages.goto_app(page, site_base, route)
        title = page.title()
        assert frag in title, (route, title)
        titles.append(title)
    assert len(set(titles)) == len(titles), titles   # no duplicate titles


def test_landing_head_carries_seo_tags(page, site_base, seeded):
    seeded("preset:empty")
    pages.goto_app(page, site_base, "/")
    head = page.evaluate("() => document.head.innerHTML")
    for frag in ['rel="canonical"', 'property="og:title"', 'property="og:url"',
                 'name="description"', 'name="twitter:card"', 'name="theme-color"']:
        assert frag in head, frag
    assert f'href="{HOST}/"' in head


def test_settings_is_noindex(page, site_base, seeded):
    seeded("preset:empty")
    pages.goto_app(page, site_base, "/settings/")
    content = page.evaluate(
        "() => (document.querySelector('meta[name=robots]') || {}).content || ''")
    assert "noindex" in content


def test_redirect_stubs_are_noindex(site_base):
    """Read raw: the stubs meta-refresh away instantly in a browser."""
    for stub in ("/capture/", "/insights/", "/tracker/"):
        status, body = _get(site_base, stub)
        assert status == 200
        assert 'name="robots" content="noindex"' in body, stub


@pytest.mark.parametrize("tree,minimum", [("site/home", 10), ("minified/home", 10),
                                          ("archive/community-deprecated", 1)])
def test_every_served_page_has_meta_description(tree, minimum):
    """Static audit of every index.html in both served trees (+ legacy
    community under archive/): a scanner-parseable, non-empty description
    must exist. Pins the fix for the 2026-10 site scan (minify had stripped
    the attribute quotes; minify.sh now passes --html-keep-quotes)."""
    import re as _re
    from pathlib import Path as _Path
    root = _Path(__file__).resolve().parents[2] / tree
    audited = 0
    for html in sorted(root.rglob("index.html")):
        txt = html.read_text(encoding="utf-8")
        m = _re.search(r'<meta\s+name=["\']?description["\']?\s+content=["\']([^"\']{20,})',
                       txt, _re.I)
        assert m, f"{html} has no (or too short) meta description"
        audited += 1
    assert audited >= minimum
