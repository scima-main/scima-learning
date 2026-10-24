"""Settings page: theme presets, accessibility toggles, algorithm select,
daily-goal slider persistence, data management buttons."""
import re

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
    # aria-label (set by makeRange) — robust across panel regroupings; it is
    # also still the first range input on the page (Study & Scheduling leads).
    slider = page.locator("input[aria-label='Daily Review Goal']")
    slider.fill("35")
    assert page.evaluate("() => state.settings.dailyGoal") == 35
    page.wait_for_timeout(900)
    assert storage.read_mf_state(page)["settings"]["dailyGoal"] == 35


def test_data_management_buttons_present(page, base_url, seeded):
    goto_settings(page, base_url, seeded)
    for label in ("Export All Data (.zip)", "Export Decks Only", "Import"):
        expect(page.get_by_role("button", name=label, exact=True)).to_be_visible()


def test_replay_tutorial_button_starts_tour(page, base_url, seeded):
    goto_settings(page, base_url, seeded)
    page.get_by_role("button", name="Replay tutorial").click()
    expect(page.locator("#tutorial-overlay")).to_be_visible(timeout=5000)
    pages.dismiss_tour(page)


# ── The regrouped panel layout ──────────────────────────────────────────────
# Settings was reorganized from "one giant Study & Accessibility card + an
# Algorithm & Notifications card + full-width stragglers" into eight domain
# panels in one grid-2 (+ full-width Help on top, Data Management below).
# Every feature survived the move — these pin both the new grouping and the
# presence of each control in its new home.

PANELS = [
    "Study & Scheduling", "Scratchpad",
    "Appearance & Theme", "Subjects",
    "Accessibility & Notifications", "AI & Integrations",
    "Library & Reading", "Navigation",
    "Data Management", "Help",
]


def test_regrouped_panels_present(page, base_url, seeded):
    goto_settings(page, base_url, seeded)
    for label in PANELS:
        expect(page.locator("#view-settings .card",
                            has_text=label).first).to_be_visible()


def test_panel_pairing_is_one_grid(page, base_url, seeded):
    """The eight domain panels live in a single grid-2 (rows of two on
    desktop; the mobile CSS collapses it to one column)."""
    goto_settings(page, base_url, seeded)
    grid = page.locator("#view-settings > .grid-2")
    expect(grid).to_have_count(1)
    assert grid.locator("> .card").count() == 8


def test_theme_schedule_lives_inside_appearance(page, base_url, seeded):
    goto_settings(page, base_url, seeded)
    card = page.locator("#view-settings .card",
                        has_text="Appearance & Theme").first
    expect(card).to_contain_text("Theme Schedule")
    expect(card.locator(
        "button.toggle[aria-label='Enable scheduling']")).to_be_visible()


def test_every_toggle_survived_the_regroup(page, base_url, seeded):
    """All eight feature toggles exist exactly once, in their new panels."""
    goto_settings(page, base_url, seeded)
    homes = {
        "Auto-suspend leeches": "Study & Scheduling",
        "Dyslexia-Friendly Mode": "Accessibility & Notifications",
        "High Contrast": "Accessibility & Notifications",
        "Power Saving Mode": "Accessibility & Notifications",
        "Text-to-Speech": "Accessibility & Notifications",
        "Push Notifications": "Accessibility & Notifications",
        "Show Pinyin": "Library & Reading",
        "Single-Word Definitions": "Library & Reading",
    }
    for label, panel in homes.items():
        rows = page.locator(".toggle-row", has_text=label)
        expect(rows).to_have_count(1)
        card = page.locator("#view-settings .card", has_text=panel).first
        expect(card.locator(".toggle-row", has_text=label)).to_have_count(1)


def test_every_slider_and_select_survived(page, base_url, seeded):
    goto_settings(page, base_url, seeded)
    for aria in ("Daily Review Goal", "New Cards Per Day", "Leech Threshold",
                 "Gap density %", "Max gaps per card",
                 "Auto-next countdown (s, 0 = manual)"):
        expect(page.locator(f"input[aria-label='{aria}']")).to_have_count(1)
    expect(page.locator("select[aria-label='SRS scheduling algorithm']"),
           ).to_have_count(1)
    expect(page.locator("select[aria-label='Day boundary timezone']"),
           ).to_have_count(1)
    expect(page.locator("select[aria-label='Define target language']"),
           ).to_have_count(1)
    # AI & Integrations keeps the LLM endpoint
    card = page.locator("#view-settings .card",
                        has_text="AI & Integrations").first
    expect(card).to_contain_text("Server Address")
    expect(card.locator("button", has_text="Test Connection")).to_have_count(1)
    # Library & Reading keeps the resume-position select
    expect(page.locator("#view-settings .card", has_text="Library & Reading")
           .first.locator("select")).to_have_count(2)   # define lang + open-book


# ── #settings/<panel> deep links + highlight (site/home until re-minified) ──

def test_settings_deeplink_scrolls_and_flashes(page, site_base, seeded):
    """A cold load of /settings/#settings/<panel> scrolls that panel into
    view and pulses the highlight ring."""
    seeded("preset:empty")
    pages.goto_app(page, site_base, "/settings/#settings/scratch")
    panel = page.locator("[data-settings-panel='scratch']")
    expect(panel).to_have_class(re.compile(r"settings-flash"), timeout=6000)
    page.wait_for_timeout(400)   # let the smooth scroll settle
    scrolled = page.evaluate("() => document.getElementById('main').scrollTop")
    box = panel.bounding_box()
    assert scrolled > 0 and -60 <= box["y"] <= 320, (scrolled, box)


def test_settings_deeplink_aliases(page, site_base, seeded):
    seeded("preset:empty")
    for payload, panel in (("scratchpad", "scratch"), ("a11y", "accessibility"),
                           ("themes", "appearance"), ("integrations", "ai")):
        pages.goto_app(page, site_base, "/settings/")
        page.wait_for_function("() => document.querySelector('[data-settings-panel=study]')")
        page.evaluate(f"() => {{ location.hash = '#settings/{payload}'; }}")
        expect(page.locator(f"[data-settings-panel='{panel}']")).to_have_class(
            re.compile(r"settings-flash"), timeout=6000)


def test_settings_panel_copy_link_button(page, site_base, seeded, context):
    context.grant_permissions(["clipboard-read", "clipboard-write"],
                              origin=site_base)
    seeded("preset:empty")
    pages.goto_app(page, site_base, "/settings/")
    page.locator("[data-settings-panel='study'] button"
                 "[title='Copy link to this section']").click()
    expect(page.locator("#toast")).to_contain_text("Section link copied",
                                                   timeout=5000)
    clip = page.evaluate("() => navigator.clipboard.readText()")
    assert clip.endswith("/settings/#settings/study"), clip


def test_scratchpad_edit_defaults_opens_settings_in_new_tab(page, site_base,
                                                             seeded, context):
    """The scratchpad→Settings cross-link is the "Edit Defaults" button at
    the BOTTOM of the ⋯ preferences popover: the full defaults panel opens in
    a new tab, deep-linked and highlighted, while the session's own tab never
    navigates. (The old header ⚙ is gone — the popover footer is the entry.)"""
    seeded("preset:demo")
    pages.goto_app(page, site_base, "/study/")
    page.click("#tutorial-target-study-start")
    page.wait_for_selector(".scratch-open-btn", timeout=10000)
    page.click(".scratch-open-btn")
    # the header gear no longer exists — window controls only up there
    expect(page.locator(".sp-head button[title*='Scratchpad defaults']")).to_have_count(0)
    # bottom bar ⋯ → preferences popover → footer button
    page.click("button[aria-label='More scratchpad options']")
    page.wait_for_selector(".sp-popover.sp-open", timeout=5000)
    edit = page.locator(".sp-pop-foot .sp-edit-defaults")
    expect(edit).to_be_visible()
    expect(edit).to_contain_text("Edit Defaults")
    url_before = page.url
    with context.expect_page() as new_page:
        edit.click()
    tab = new_page.value
    tab.wait_for_load_state("load")
    assert tab.url.endswith("/settings/#settings/scratch"), tab.url
    expect(tab.locator("[data-settings-panel='scratch']")).to_have_class(
        re.compile(r"settings-flash"), timeout=8000)
    # the study session tab stayed exactly where it was
    assert page.url == url_before
    expect(page.locator("#scratch-panel")).to_be_visible()
