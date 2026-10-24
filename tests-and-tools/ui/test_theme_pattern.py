"""Background patterns: adaptive fill + visible defaults.

Regression guard for the "bg mode is always solid" bug: buildBgPatternCss()
used to hardcode the SVG fill/stroke to 'white', so on any light preset the
pattern was white-on-white (invisible → looked solid) and on dark presets it
never followed the theme. The fill now defaults to the theme's text colour
(overridable via Settings → Pattern Color, with an "Auto" reset), and new
pattern selections start at a perceptible 14% opacity instead of 8%.
"""
import pytest

import seed as seedlib
from helpers import pages

pytestmark = [pytest.mark.settings]

_B64_PREFIX = 'url("data:image/svg+xml;base64,'


def _decode(bg_css: str) -> str:
    import base64
    assert bg_css.startswith(_B64_PREFIX), f"not an svg pattern: {bg_css[:40]}"
    return base64.b64decode(bg_css[len(_B64_PREFIX):-2]).decode("utf-8")


def _seed_no_tour(seeded):
    mf = seedlib.make_mf_state(decks=[])
    mf["settings"] = {"onboarding": {"completed": True, "version": 1}}
    seeded(mf_state=mf)


def test_svg_pattern_fill_adapts_to_theme_text(page, base_url, seeded):
    """The data-URI SVG cannot inherit currentColor, so the caller passes the
    theme text colour: dark themes get light dots, light themes dark dots,
    and an explicit pattern.color still wins."""
    _seed_no_tour(seeded)
    pages.goto_app(page, base_url, "/settings/")
    out = page.evaluate("""() => {
      const dark  = buildBgPatternCss({type:'dots', opacity:0.2, scale:1}, '#FFFFFF');
      const light = buildBgPatternCss({type:'dots', opacity:0.2, scale:1}, '#111827');
      const fixed = buildBgPatternCss({type:'dots', opacity:0.2, color:'#ff0000'}, '#111827');
      return { dark, light, fixed };
    }""")
    assert "#FFFFFF" in _decode(out["dark"])
    assert "#111827" in _decode(out["light"])
    assert "#ff0000" in _decode(out["fixed"])
    assert out["dark"] != out["light"]


def test_pattern_tile_applies_visible_pattern_and_persists(page, base_url, seeded):
    _seed_no_tour(seeded)
    pages.goto_app(page, base_url, "/settings/")
    page.get_by_role("button", name="Dots", exact=True).click()
    page.wait_for_timeout(300)
    bg = page.evaluate("getComputedStyle(document.body).backgroundImage || ''")
    svg = _decode(bg)
    # default (dark) theme text is #FFFFFF — the fill must follow it
    assert "#FFFFFF" in svg or "#ffffff" in svg
    # new selections start at the perceptible 14% default, not the old 8%
    assert page.evaluate("state.settings.theme.bgPattern.opacity") == pytest.approx(0.14)

    page.reload(wait_until="load")
    page.wait_for_timeout(800)
    assert page.evaluate("state.settings.theme.bgPattern?.type") == "dots"
    bg2 = page.evaluate("getComputedStyle(document.body).backgroundImage || ''")
    assert bg2.startswith(_B64_PREFIX), "pattern must survive a reload"


def test_light_preset_keeps_pattern_visible(page, base_url, seeded):
    """The original bug: switching to a light preset left white dots on a
    white background (reads as solid). The fill must flip with the theme."""
    _seed_no_tour(seeded)
    pages.goto_app(page, base_url, "/settings/")
    page.get_by_role("button", name="Dots", exact=True).click()
    page.wait_for_timeout(200)
    page.get_by_role("button", name="Light", exact=True).click()
    page.wait_for_timeout(300)
    bg = page.evaluate("getComputedStyle(document.body).backgroundImage || ''")
    svg = _decode(bg)
    assert "#111827" in svg, "light preset must repaint the pattern in the dark text colour"
    assert "#FFFFFF" not in svg


def test_pattern_color_auto_reset(page, base_url, seeded):
    """An explicit Pattern Color sticks until the user presses Auto, which
    returns the fill to following the theme text colour."""
    _seed_no_tour(seeded)
    pages.goto_app(page, base_url, "/settings/")
    page.get_by_role("button", name="Dots", exact=True).click()
    page.wait_for_timeout(200)
    page.evaluate("() => { state.settings.theme.bgPattern.color = '#ff0000'; applyThemeVars(state.settings.theme); }")
    bg = page.evaluate("getComputedStyle(document.body).backgroundImage || ''")
    assert "#ff0000" in _decode(bg)
    page.get_by_role("button", name="Auto").click()
    page.wait_for_timeout(300)
    assert page.evaluate("state.settings.theme.bgPattern.color") in (None, "")
    bg2 = page.evaluate("getComputedStyle(document.body).backgroundImage || ''")
    assert "#FFFFFF" in _decode(bg2) or "#ffffff" in _decode(bg2)
