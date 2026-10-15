"""Home view: empty state, stats grid, deck cards, daily goal, pinning."""
import math
import re

import pytest
from playwright.sync_api import expect

import seed as seedlib
from helpers import pages

pytestmark = [pytest.mark.home]


def js_round(x: float) -> int:
    """JS Math.round (half-up), not Python's banker's rounding."""
    return math.floor(x + 0.5)


def test_first_run_empty_state(app):
    """No decks → welcome empty state with the Create First Deck CTA."""
    expect(app.locator("#view-home .empty-state")).to_be_visible()
    expect(app.locator("#view-home .empty-title")).to_have_text(
        "Welcome to SCIMA Learning")
    app.get_by_role("button", name="Create First Deck").click()
    pages.expect_at(app, "decks")
    pages.app_ready(app)


def test_stats_grid_reflects_seed(demo_app):
    """Due Today / Reviewed / Retention / Day Streak come from the seed."""
    hist = seedlib.make_review_history()          # same deterministic generator
    total = sum(h["total"] for h in hist)
    correct = sum(h["correct"] for h in hist)
    today = next(h for h in hist if h["date"] == seedlib.utc_day())

    def stat(label):
        return demo_app.locator(".stat-card", has_text=label).locator(".stat-val").inner_text()

    assert stat("Due Today") == "5"               # 4 Spanish + 1 Biology due
    assert stat("Reviewed") == str(today["total"])
    assert stat("Retention") == f"{js_round(correct / total * 100)}%"
    assert stat("Day Streak") == "5"


def test_deck_cards_listed_with_study_now(demo_app, base_url):
    """Seeded decks render as cards; Study Now jumps to /study/ scoped to it."""
    expect(demo_app.locator("#view-home .deck-card")).to_have_count(2)
    expect(demo_app.locator("#view-home .deck-card", has_text="Spanish Basics")).to_be_visible()

    card = demo_app.locator("#view-home .deck-card", has_text="Spanish Basics")
    expect(card.locator(".deck-tags")).to_contain_text("4 due")
    card.get_by_role("button", name="Study Now").click()

    pages.expect_at(demo_app, "study")
    pages.app_ready(demo_app)
    # the study picker's scope summary now names the deck
    expect(demo_app.locator("#view-study")).to_contain_text("Spanish Basics")
    expect(demo_app.locator("#view-study")).to_contain_text("4 total cards · 4 due")


def test_daily_goal_progress(demo_app):
    """Goal card shows today's reviews vs settings.dailyGoal (20)."""
    goal = demo_app.locator("#view-home .card", has_text="Daily Goal")
    expect(goal).to_contain_text(re.compile(r"\d+ / 20"))


def test_pin_deck_shows_in_sidebar(demo_app):
    """📌 on a home deck card pins it into the drawer's quick-access list."""
    card = demo_app.locator("#view-home .deck-card", has_text="Biology - Cells")
    card.locator(".pin-toggle").click()

    pages.open_nav(demo_app)
    pinned = demo_app.locator("#pinned-decks .pinned-deck-name")
    expect(pinned).to_have_text("Biology - Cells")
    # ...and the pin button reflects the new state
    expect(demo_app.locator("#view-home .deck-card", has_text="Biology - Cells")
           .locator(".pin-toggle.pinned")).to_have_count(1)


def test_sidebar_xp_bar_from_tracker(demo_app):
    """Tracker seed (1240 XP) drives the sidebar level/XP readout."""
    xp_label = demo_app.locator("#xp-label").text_content()
    assert re.match(r"^[\d.,kKmM]+/[\d.,kKmM]+$", xp_label), xp_label
    level = int(demo_app.locator("#xp-level").text_content().removeprefix("Lv."))
    assert level >= 2          # 1240 XP is past level 1 (0–499)


def test_greeting_and_due_copy(demo_app):
    expect(demo_app.locator("#view-home")).to_contain_text("Good day, Scholar")
    expect(demo_app.locator("#view-home")).to_contain_text("5 cards due across 2 decks")
