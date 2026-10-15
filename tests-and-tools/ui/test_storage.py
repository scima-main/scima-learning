"""Storage contract: seeding, sanitization of corrupt saves, persistence of
edits through the debounced scheduleSave(), and cross-reload state."""
import pytest
from playwright.sync_api import expect

import seed as seedlib
from helpers import pages, storage

pytestmark = [pytest.mark.storage]


def test_demo_seed_roundtrip(demo_app):
    """Everything seeded lands in the app's live `state` (post-sanitize)."""
    st = storage.read_app_state(demo_app)
    assert [d["name"] for d in st["decks"]] == ["Spanish Basics", "Biology - Cells"]
    assert len(st["decks"][0]["cards"]) == 4
    assert len(st["decks"][1]["cards"]) == 3
    assert st["streak"] == 5
    assert st["reviewHistoryLen"] == 9           # today + 8 past days
    assert [f["name"] for f in st["folders"]] == ["Languages"]
    assert [s["name"] for s in st["sources"]] == ["Cells - A Short Introduction.txt"]
    assert st["trackerXP"] == 1240


def test_corrupt_state_is_sanitized(page, base_url, seeded):
    """sanitizeMfState() repairs garbage instead of bricking the app."""
    seeded(mf_state={
        "decks": [{}, {"name": "OK", "cards": "not-a-list"}],
        "folders": "garbage",
        "streak": -42,
        "reviewHistory": [{"nope": 1}, None, "x"],
        "settings": "also-garbage",
    }, tracker={"totalXP": "lots", "subjects": []})

    pages.goto_app(page, base_url, "/")
    expect(page.locator("#view-home")).to_be_visible()

    st = storage.read_app_state(page)
    assert len(st["decks"]) == 2
    assert st["decks"][0]["name"] == "Untitled deck"    # sanitizeDeck default
    assert st["decks"][0]["cards"] == []
    assert st["decks"][1]["name"] == "OK"
    assert st["streak"] == 0                            # negative → 0
    assert st["settings"]["dailyGoal"] == 20            # defaults re-applied


def test_edit_persists_to_localstorage(demo_app):
    """An in-memory edit + scheduleSave() debounce lands in mf_state and
    survives a reload."""
    demo_app.evaluate("""() => {
        state.decks[0].pinned = true;
        scheduleSave();
    }""")
    demo_app.wait_for_timeout(1000)          # scheduleSave debounce ≈600ms

    mf = storage.read_mf_state(demo_app)
    assert mf["decks"][0]["pinned"] is True

    demo_app.reload(wait_until="load")
    pages.app_ready(demo_app)
    assert storage.read_app_state(demo_app)["decks"][0]["pinned"] is True


def test_tracker_key_separate(demo_app):
    """XP lives in SCIMATracker, never in mf_state."""
    tracker = storage.read_tracker(demo_app)
    mf = storage.read_mf_state(demo_app)
    assert tracker["totalXP"] == 1240
    assert "totalXP" not in mf


def test_tour_suppressed_by_seed(demo_app):
    """Seeds mark onboarding completed → no tutorial overlay, ever."""
    demo_app.wait_for_timeout(1200)          # tour would fire at ~300ms
    expect(demo_app.locator("#tutorial-overlay")).to_have_count(0)


def test_custom_seed_via_factory(page, base_url, seeded):
    """Building a bespoke seed with the seed.py factories works end-to-end."""
    deck = seedlib.make_deck("Custom Deck", [
        seedlib.make_card("Q1", "A1"),
        seedlib.make_card("Q2", "A2", due_offset_ms=seedlib.DAY_MS),  # not due
    ], emoji="🧪", deck_id="d_custom")
    seeded(mf_state=seedlib.make_mf_state(decks=[deck], streak=3),
           tracker=seedlib.make_tracker(total_xp=99))
    pages.goto_app(page, base_url, "/")

    st = storage.read_app_state(page)
    assert st["decks"][0]["id"] == "d_custom"
    assert st["streak"] == 3
    assert st["trackerXP"] == 99
    expect(page.locator("#view-home .deck-card", has_text="Custom Deck")).to_be_visible()
