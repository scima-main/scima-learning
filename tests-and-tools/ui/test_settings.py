"""Settings page: theme presets, accessibility toggles, algorithm select,
daily-goal slider persistence, data management buttons."""
import pytest
from playwright.sync_api import expect

from helpers import pages, storage

pytestmark = [pytest.mark.settings]

# THEME_PRESETS from home/shared/theme.js — name → expected --bg
PRESET_BG = {
    "Light": "#F0F4FA",
    "Midnight": "#0A0A12",
    "Mint": "#0A1612",
    "Paper": "#F4F1EA",
    "High Contrast": "#000000",
}


def goto_settings(page, base_url, seeded, preset="preset:empty"):
    seeded(preset)
    pages.goto_app(page, base_url, "/settings/")
    return page


def root_var(page, name):
    return page.evaluate(
        f"() => document.documentElement.style.getPropertyValue('--{name}').trim()")


def test_theme_preset_swatches_apply(page, base_url, seeded):
    """Clicking a preset swatch repaints the CSS custom properties."""
    goto_settings(page, base_url, seeded)
    page.locator("#view-settings button[title='Light']").click()
    assert root_var(page, "bg") == PRESET_BG["Light"]

    page.locator("#view-settings button[title='Midnight']").click()
    assert root_var(page, "bg") == PRESET_BG["Midnight"]

    # the choice is persisted (debounced save)
    page.wait_for_timeout(900)
    mf = storage.read_mf_state(page)
    assert mf["settings"]["theme"]["bg"] == PRESET_BG["Midnight"]


def test_theme_survives_reload(page, base_url, seeded):
    goto_settings(page, base_url, seeded)
    page.locator("#view-settings button[title='Paper']").click()
    page.wait_for_timeout(900)
    page.reload(wait_until="load")
    pages.app_ready(page)
    assert root_var(page, "bg") == PRESET_BG["Paper"]


def test_high_contrast_toggle(page, base_url, seeded):
    goto_settings(page, base_url, seeded)
    toggle = page.locator(".toggle-row", has_text="High Contrast").locator("button.toggle")
    expect(toggle).to_have_class("toggle")

    toggle.click()
    expect(toggle).to_have_class("toggle on")
    assert toggle.get_attribute("aria-checked") == "true"
    cls = page.evaluate("() => document.documentElement.className")
    assert "a11y-high-contrast" in cls

    page.wait_for_timeout(900)
    assert storage.read_mf_state(page)["settings"]["highContrast"] is True


def test_accessibility_toggles_set_html_classes(page, base_url, seeded):
    goto_settings(page, base_url, seeded)
    page.locator(".toggle-row", has_text="Power Saving").locator("button.toggle").click()
    cls = page.evaluate("() => document.documentElement.className")
    assert "power-saving" in cls

    page.locator(".toggle-row", has_text="Dyslexia").locator("button.toggle").click()
    cls = page.evaluate("() => document.documentElement.className")
    assert "dyslexia-mode" in cls


def test_algorithm_select(page, base_url, seeded):
    goto_settings(page, base_url, seeded)
    algo = page.locator("select:has(option[value='sm2'])")
    algo.select_option("sm2")
    assert page.evaluate("() => state.settings.algorithm") == "sm2"
    page.wait_for_timeout(900)
    assert storage.read_mf_state(page)["settings"]["algorithm"] == "sm2"


def test_daily_goal_slider_persists(page, base_url, seeded):
    goto_settings(page, base_url, seeded)
    slider = page.locator("input[type='range']").first   # Daily Review Goal
    slider.fill("35")
    assert page.evaluate("() => state.settings.dailyGoal") == 35
    page.wait_for_timeout(900)
    assert storage.read_mf_state(page)["settings"]["dailyGoal"] == 35


def test_data_management_buttons_present(page, base_url, seeded):
    goto_settings(page, base_url, seeded)
    for label in ("📤 Export All Data (.zip)", "📦 Export Decks Only", "📥 Import"):
        expect(page.get_by_role("button", name=label, exact=True)).to_be_visible()


def test_replay_tutorial_button_starts_tour(page, base_url, seeded):
    goto_settings(page, base_url, seeded)
    page.get_by_role("button", name="Replay tutorial").click()
    expect(page.locator("#tutorial-overlay")).to_be_visible(timeout=5000)
    pages.dismiss_tour(page)
