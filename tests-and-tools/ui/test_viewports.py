"""Display-dimension coverage: the same UI across phones, tablets, laptops,
ultrawide, landscape, short windows, touch devices and 2x DPI.

The app is drawer-based at every width (no docked sidebar), and its CSS has
a 720px gutter breakpoint plus auto-fill card grids — these tests pin that
behaviour and guarantee nothing overflows or becomes unusable as the
viewport changes.
"""
import struct

import pytest
from playwright.sync_api import expect

from helpers import content, pages, storage

pytestmark = [pytest.mark.responsive]

# (width, height, label) — label is the pytest id
VIEWPORTS = [
    (320, 568, "tiny-phone"),
    (360, 740, "android"),
    (390, 844, "phone"),
    (768, 1024, "tablet-portrait"),
    (1024, 768, "tablet-landscape"),
    (1280, 800, "laptop"),
    (1600, 900, "desktop"),
    (2560, 1440, "ultrawide"),
    (844, 390, "phone-landscape"),
    (1280, 420, "short-window"),
]
IDS = [v[2] for v in VIEWPORTS]
PHONE_SIZES = [(320, 568), (390, 844), (844, 390)]


@pytest.mark.parametrize("w,h,label", VIEWPORTS, ids=IDS)
def test_boots_clean_at_size(page, base_url, seeded, page_errors, w, h, label):
    """Every page boots, renders home, throws nothing, and (≥320px wide)
    produces no horizontal overflow."""
    seeded("preset:demo")
    page.set_viewport_size({"width": w, "height": h})
    pages.goto_app(page, base_url, "/")
    expect(page.locator("#view-home .deck-card").first).to_be_visible()
    assert page_errors == []
    if w >= 320:
        assert content.horizontal_overflow(page) == []


@pytest.mark.parametrize("w,h,label", VIEWPORTS, ids=IDS)
def test_drawer_cycle_at_size(page, base_url, seeded, w, h, label):
    """The nav drawer is the only chrome at every width: closed at rest,
    ≡ opens, Esc closes."""
    seeded("preset:empty")
    page.set_viewport_size({"width": w, "height": h})
    pages.goto_app(page, base_url, "/")

    expect(page.locator("#nav .nav-btn").first).to_be_hidden()
    page.click("#logo-icon")
    expect(page.locator("#nav .nav-btn").first).to_be_visible()
    # every tab reachable inside the opened drawer
    assert page.locator("#nav .nav-btn").count() == 8
    page.keyboard.press("Escape")
    expect(page.locator("#nav .nav-btn").first).to_be_hidden()


@pytest.mark.parametrize("w,expected", [(390, "14px"), (719, "14px"),
                                        (721, "32px"), (1280, "32px")])
def test_720px_gutter_breakpoint(page, base_url, seeded, w, expected):
    """dashboard.css: `.view` padding is 32px above 720px, 14px below."""
    seeded("preset:empty")
    page.set_viewport_size({"width": w, "height": 900})
    pages.goto_app(page, base_url, "/")
    got = page.evaluate(
        "() => getComputedStyle(document.querySelector('.view.active')).paddingLeft")
    assert got == expected, f"at {w}px: {got} != {expected}"


@pytest.mark.parametrize("w,h", PHONE_SIZES, ids=["tiny", "phone", "landscape"])
def test_study_session_usable_on_small_screens(page, base_url, seeded, w, h):
    """Flashcard + all four rating buttons stay inside the viewport."""
    seeded("preset:demo")
    page.set_viewport_size({"width": w, "height": h})
    pages.goto_app(page, base_url, "/study/")
    page.click("#tutorial-target-study-start")
    expect(page.locator(".flashcard.front")).to_be_visible()
    pages.reveal(page)

    buttons = pages.rating_buttons(page)
    expect(buttons.first).to_be_visible()
    assert buttons.count() == 4
    for i in range(4):
        box = buttons.nth(i).bounding_box()
        assert box, "rating button has no box"
        assert 0 <= box["x"] and box["x"] + box["width"] <= w + 1, \
            f"rating button {i} outside {w}px viewport: {box}"
    card = page.locator(".flashcard").bounding_box()
    assert card["x"] >= 0 and card["x"] + card["width"] <= w + 1


@pytest.mark.parametrize("w,h", [(320, 568), (390, 844), (768, 1024)])
def test_modal_fits_viewport(page, base_url, seeded, w, h):
    seeded("preset:empty")
    page.set_viewport_size({"width": w, "height": h})
    pages.goto_app(page, base_url, "/decks/")
    page.click("#tutorial-target-new-deck")
    pages.expect_modal(page, "Create New Deck")
    box = page.locator("#modal-box").bounding_box()
    assert box["x"] >= 0 and box["x"] + box["width"] <= w + 1, box
    assert box["y"] >= 0 and box["y"] + box["height"] <= h + 1, box


@pytest.mark.parametrize("device_name", ["iPhone 13", "Pixel 7", "iPad (gen 7)"])
def test_touch_device_emulation(browser, playwright, base_url, device_name):
    """Real device descriptors (is_mobile + has_touch): tap-driven boot and
    navigation, no JS errors. (Param isn't called `device` — that name is
    pytest-playwright's own fixture.)"""
    ctx = browser.new_context(**playwright.devices[device_name])
    storage.seed_context(ctx, mf_state=__import__("seed").preset_demo()["mf_state"],
                         tracker=__import__("seed").preset_demo()["SCIMATracker"])
    page = ctx.new_page()
    errors: list = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    try:
        pages.goto_app(page, base_url, "/")
        expect(page.locator("#view-home .deck-card").first).to_be_visible()

        page.tap("#logo-icon")                      # touch, not click
        expect(page.locator("#nav .nav-btn").first).to_be_visible()
        page.tap("#nav .nav-btn[data-view='study']")
        page.wait_for_function(
            "() => typeof state !== 'undefined' && state.view === 'study'",
            timeout=15000)
        expect(page.locator("#view-study")).to_contain_text("Study Mode")
        assert content.horizontal_overflow(page) == []
        assert errors == []
    finally:
        ctx.close()


@pytest.mark.parametrize("w,h", [(360, 740), (768, 1024), (1440, 900)],
                         ids=["phone", "tablet", "desktop"])
def test_every_page_overflow_free(page, base_url, seeded, w, h):
    """All seven routes, three representative widths: no sideways scroll,
    nothing sticking out."""
    seeded("preset:demo")
    page.set_viewport_size({"width": w, "height": h})
    problems = {}
    for route in ["/", "/decks/", "/study/", "/library/",
                  "/analytics/", "/settings/", "/about/"]:
        pages.goto_app(page, base_url, route)
        over = content.horizontal_overflow(page)
        if over:
            problems[route] = over
    assert problems == {}, problems


def test_extreme_narrow_still_usable(page, base_url, seeded):
    """280px (foldable cover screen): below the supported range, so overflow
    is tolerated — but the app must boot and stay operable."""
    seeded("preset:empty")
    page.set_viewport_size({"width": 280, "height": 650})
    pages.goto_app(page, base_url, "/")
    expect(page.locator("#view-home .empty-state")).to_be_visible()
    page.click("#logo-icon")
    expect(page.locator("#nav .nav-btn").first).to_be_visible()
    page.keyboard.press("Escape")


def test_ultrawide_no_stretch_artifacts(page, base_url, seeded):
    seeded("preset:demo")
    page.set_viewport_size({"width": 3440, "height": 1440})
    pages.goto_app(page, base_url, "/")
    expect(page.locator("#view-home .deck-card").first).to_be_visible()
    assert content.horizontal_overflow(page) == []


def test_device_scale_factor_2_screenshot(browser, base_url, seeded):
    """2x DPI contexts produce 2x pixel screenshots (retina photos)."""
    ctx = browser.new_context(viewport={"width": 400, "height": 300},
                              device_scale_factor=2)
    storage.seed_context(ctx, mf_state=__import__("seed").preset_empty()["mf_state"])
    page = ctx.new_page()
    try:
        pages.goto_app(page, base_url, "/")
        png = page.screenshot()
        assert png[1:4] == b"PNG"
        px_w, px_h = struct.unpack(">II", png[16:24])
        assert (px_w, px_h) == (800, 600), (px_w, px_h)
    finally:
        ctx.close()
