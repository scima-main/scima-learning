"""Content-integrity checkers across pages, seeds and scripts.

Complements the functional tests: instead of "does the flow work", these
ask "is what's on screen actually sane" — no JS leakage in text, no broken
images, no duplicate ids, no unnamed buttons, no silently clipped text,
rich text / KaTeX / unicode / very long content all survive the pipeline.
"""


import pytest
from playwright.sync_api import expect

import seed as seedlib
from helpers import content, pages
from helpers.api_mock import sample_online_handlers

pytestmark = [pytest.mark.content]

ROUTES = ["/", "/decks/", "/study/", "/library/", "/analytics/", "/settings/"]


@pytest.mark.parametrize("route", ROUTES)
def test_no_bug_marker_text(page, base_url, seeded, route):
    """No rendered 'undefined' / 'NaN' / '[object Object]' anywhere."""
    seeded("preset:demo")
    pages.goto_app(page, base_url, route)
    assert content.bug_markers(page) == []


@pytest.mark.parametrize("route", ROUTES)
def test_no_duplicate_ids(page, base_url, seeded, route):
    seeded("preset:demo")
    pages.goto_app(page, base_url, route)
    assert content.duplicate_ids(page) == []


@pytest.mark.parametrize("route", ROUTES)
def test_no_broken_images(page, base_url, seeded, route):
    seeded("preset:demo")
    pages.goto_app(page, base_url, route)
    assert content.broken_images(page) == []


@pytest.mark.parametrize("route", ROUTES)
def test_every_visible_button_has_accessible_name(page, base_url, seeded, route):
    seeded("preset:demo")
    pages.goto_app(page, base_url, route)
    assert content.unnamed_visible_buttons(page) == []


def test_toggle_switches_expose_switch_semantics(page, base_url, seeded):
    """Settings toggles are proper ARIA switches: named, role=switch, and
    aria-checked tracks (and flips with) the visible state."""
    seeded("preset:empty")
    pages.goto_app(page, base_url, "/settings/")

    toggles = page.locator("#view-settings button.toggle")
    assert toggles.count() >= 5
    for i in range(toggles.count()):
        t = toggles.nth(i)
        assert t.get_attribute("role") == "switch"
        assert (t.get_attribute("aria-label") or "").strip()
        on = "on" in (t.get_attribute("class") or "")
        assert t.get_attribute("aria-checked") == str(on).lower()

    hc = page.locator(".toggle-row", has_text="High Contrast").locator("button.toggle")
    assert hc.get_attribute("aria-checked") == "false"
    hc.click()
    assert hc.get_attribute("aria-checked") == "true"
    expect(hc).to_have_class("toggle on")
    hc.click()
    assert hc.get_attribute("aria-checked") == "false"


@pytest.mark.parametrize("route", ROUTES)
def test_no_silently_clipped_text(page, base_url, seeded, route):
    seeded("preset:demo")
    pages.goto_app(page, base_url, route)
    assert content.clipped_text(page) == []


def test_card_image_data_uri_renders(page, base_url, seeded):
    """A seeded frontImage (data URI) loads in study — image pipeline OK."""
    png = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAf"
           "FcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
    deck = seedlib.make_deck("Image Deck", [
        seedlib.make_card("Look at the image", "A red pixel", frontImage=png),
    ])
    seeded(mf_state=seedlib.make_mf_state(decks=[deck]))
    pages.goto_app(page, base_url, "/study/")
    page.click("#tutorial-target-study-start")
    img = page.locator(".flashcard img")
    expect(img).to_be_visible()
    assert content.broken_images(page) == []


def test_math_and_markdown_render_in_cards(page, base_url, seeded):
    """$…$ → inline KaTeX, $$…$$ → display KaTeX, **…** → <strong>."""
    deck = seedlib.make_deck("Physics", [
        seedlib.make_card("Energy: $E=mc^2$ and **mass–energy** equivalence",
                          "$$\\int_0^1 x^2 dx = \\frac{1}{3}$$"),
    ])
    seeded(mf_state=seedlib.make_mf_state(decks=[deck]))
    pages.goto_app(page, base_url, "/study/")
    page.click("#tutorial-target-study-start")

    front = page.locator(".flashcard-front-text")
    expect(front.locator(".katex")).to_be_visible()       # inline math
    expect(front.locator("strong")).to_have_text("mass–energy")
    pages.reveal(page)
    expect(page.locator(".flashcard.back .katex-display")).to_be_visible()


def test_rich_text_escapes_html(page, base_url, seeded):
    """Card text is escaped: markup can't inject elements or run scripts."""
    deck = seedlib.make_deck("XSS Deck", [
        seedlib.make_card('<img src=x onerror="window.__pwned=1"> **safe**',
                          '<script>window.__pwned=2</script> ok'),
    ])
    seeded(mf_state=seedlib.make_mf_state(decks=[deck]))
    pages.goto_app(page, base_url, "/study/")
    page.click("#tutorial-target-study-start")

    front = page.locator(".flashcard-front-text")
    assert front.locator("img").count() == 0
    expect(front.locator("strong")).to_have_text("safe")
    pages.reveal(page)
    assert page.locator(".flashcard.back script").count() == 0
    assert page.evaluate("() => window.__pwned === undefined")


def test_unicode_scripts_and_emoji_roundtrip(page, base_url, seeded):
    """CJK, RTL Arabic and emoji survive seed → render → localStorage."""
    pairs = [("你好", "nǐ hǎo"), ("مرحبا", "marḥaban"), ("🌍 🌎 🌏", "✅ ✅ ✅")]
    deck = seedlib.make_deck("Unicode 语言 لغة",
                             [seedlib.make_card(f, b) for f, b in pairs])
    seeded(mf_state=seedlib.make_mf_state(decks=[deck]))
    pages.goto_app(page, base_url, "/decks/")

    page.locator(".subject-tile", has_text="Miscellaneous").click()
    expect(page.locator(".deck-card .deck-name")).to_have_text("Unicode 语言 لغة")
    page.get_by_role("button", name="Manage Cards").click()
    for front, back in pairs:
        expect(page.locator("#view-decks").get_by_text(front, exact=True).first
               ).to_be_visible()

    from helpers import storage
    mf = storage.read_mf_state(page)
    saved = mf["decks"][0]["cards"]
    assert [(c["front"], c["back"]) for c in saved] == pairs


def test_very_long_content_stays_layout_safe(page, base_url, seeded):
    """1500-char card front + 90-char deck name: renders, scrollable, no
    sideways blow-out on any of the three main pages."""
    long_front = ("Mitochondria perform cellular respiration, " * 30).strip()
    long_name = "Extremely Long Deck Name For Layout Stress Testing Purposes " * 1 + "✦"
    assert len(long_front) > 1000 and len(long_name) > 60
    deck = seedlib.make_deck(long_name, [seedlib.make_card(long_front, "Short back")])
    seeded(mf_state=seedlib.make_mf_state(decks=[deck]))

    for route in ["/", "/decks/", "/study/"]:
        pages.goto_app(page, base_url, route)
        assert content.horizontal_overflow(page) == [], route

    pages.goto_app(page, base_url, "/study/")
    page.click("#tutorial-target-study-start")
    expect(page.locator(".flashcard-front-text")).to_contain_text(
        long_front[:60])
    # tall content lives in the session's scroll area, not the page body
    scrollable = page.evaluate(
        "() => { const e = document.querySelector('.quiz-scroll-area');"
        "       return e.scrollHeight >= e.clientHeight; }")
    assert scrollable


def test_community_content_is_clean(page, base_url, seeded, api_mock):
    """Mocked registry content renders without bug markers or clipping."""
    api_mock(sample_online_handlers())
    seeded("preset:empty")
    pages.goto_app(page, base_url, "/#community")
    expect(page.locator("#view-community")).to_contain_text(
        "Server online at /api/v1", timeout=15000)
    expect(page.locator("#view-community")).to_contain_text(
        "GCSE Chemistry — Atomic Structure")
    assert content.bug_markers(page) == []
    assert content.clipped_text(page) == []


def test_active_view_never_empty(page, base_url, seeded):
    """Whatever the seed, the routed view always renders some content."""
    seeded("preset:empty")
    for route, view in [("/", "home"), ("/decks/", "decks"), ("/study/", "study"),
                        ("/library/", "library"), ("/analytics/", "analytics"),
                        ("/settings/", "settings"), ("/about/", "about")]:
        pages.goto_app(page, base_url, route)
        n = page.locator(f"#view-{view}").evaluate("e => e.children.length")
        assert n > 0, f"{view} rendered empty at {route}"


def test_deck_names_with_regex_chars_are_literal(page, base_url, seeded):
    """Names containing regex/quote characters must match literally in the
    UI (and in our locators) — no accidental pattern interpretation."""
    name = "C++ & C# (pointers*) [ref?]"
    deck = seedlib.make_deck(name, [seedlib.make_card("int* p;", "a pointer")])
    seeded(mf_state=seedlib.make_mf_state(decks=[deck]))
    pages.goto_app(page, base_url, "/decks/")
    page.locator(".subject-tile", has_text="Miscellaneous").click()
    expect(page.locator(".deck-card .deck-name")).to_have_text(name)
