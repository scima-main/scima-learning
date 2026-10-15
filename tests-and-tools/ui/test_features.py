"""Tests for the seven post-suite feature additions:

1. timezone-aware day boundary (streaks / daily goal / history keys)
2. imports fill missing non-content fields with creation defaults
3. moving decks between subjects
4. duplicating cards inside a deck
5. /decks/ deep links that include the deck segment
6. Ctrl+Alt+K / Ctrl+Alt+M card-move shortcut modals
7. Create Deck → 🎴 Quizlet import tab
"""
import json
import re

import pytest
from playwright.sync_api import expect

import seed as seedlib
from helpers import pages, storage

pytestmark = [pytest.mark.decks]


# ── 1. timezone day boundary ────────────────────────────────────────────────

def test_day_key_follows_preferred_timezone(page, base_url, seeded):
    """settings.dayTimezone shifts today() — the key streaks/goal/history use."""
    seeded(mf_state=seedlib.make_mf_state(
        settings={"dayTimezone": "Pacific/Kiritimati"}))   # UTC+14
    pages.goto_app(page, base_url, "/")
    got = page.evaluate("() => today()")
    want = page.evaluate(
        "() => new Intl.DateTimeFormat('en-CA',{timeZone:'Pacific/Kiritimati'}).format(new Date())")
    assert got == want
    utc = page.evaluate("() => new Date().toISOString().split('T')[0]")
    # UTC+14 disagrees with UTC for 14h of every 24h; when it does, prove it
    if page.evaluate("() => new Date().getUTCHours() >= 10"):
        assert got != utc


def test_day_timezone_default_is_utc(page, base_url, seeded):
    seeded("preset:empty")
    pages.goto_app(page, base_url, "/")
    assert page.evaluate("() => today()") == \
        page.evaluate("() => new Date().toISOString().split('T')[0]")


def test_day_timezone_select_persists(page, base_url, seeded):
    seeded("preset:empty")
    pages.goto_app(page, base_url, "/settings/")
    sel = page.locator("#view-settings select.u-input", has=page.locator("option[value='Pacific/Auckland']"))
    expect(sel).to_be_visible()
    sel.select_option("Europe/Berlin")
    assert page.evaluate("() => state.settings.dayTimezone") == "Europe/Berlin"
    assert page.evaluate("() => today()") == page.evaluate(
        "() => new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin'}).format(new Date())")
    page.wait_for_timeout(900)
    assert storage.read_mf_state(page)["settings"]["dayTimezone"] == "Europe/Berlin"


def test_streak_uses_timezone_day_key(page, base_url, seeded):
    """bumpStreak() credits the tz day key, not the UTC one."""
    seeded(mf_state=seedlib.make_mf_state(
        decks=[seedlib.make_deck("D", [seedlib.make_card("a", "b")])],
        settings={"dayTimezone": "Pacific/Kiritimati"}))
    pages.goto_app(page, base_url, "/")
    page.evaluate("() => bumpStreak()")
    key = page.evaluate("() => state.lastStreakDate")
    assert key == page.evaluate("() => today()")
    assert page.evaluate("() => state.streak") == 1


# ── 2. import defaults ──────────────────────────────────────────────────────

BARE_DECK = {
    "version": 2,
    "deck": {
        "name": "Bare Import",
        "cards": [
            {"front": "a", "back": "b"},
            {"front": "c", "back": "d", "ease": None, "due": None, "state": None,
             "tags": None, "hint": None, "created": None, "suspended": None},
        ],
    },
}


def test_import_fills_missing_non_content_fields(page, base_url, seeded, tmp_path):
    """Missing OR null non-content fields become creation defaults — never
    null/undefined — while content (front/back) passes through untouched."""
    f = tmp_path / "bare.json"
    f.write_text(json.dumps(BARE_DECK), encoding="utf-8")

    seeded("preset:empty")
    pages.goto_app(page, base_url, "/decks/")
    page.click("#tutorial-target-new-deck")
    pages.expect_modal(page, "Create New Deck")
    page.get_by_role("button", name="⬆ Import JSON").click()
    page.locator("#modal-backdrop:not(.hidden) input[type='file'][accept='.json']").first \
        .set_input_files(str(f))
    expect(page.locator("#modal-body")).to_contain_text("Bare Import", timeout=5000)
    page.get_by_role("button", name="Import Deck").click()

    page.wait_for_timeout(300)
    st = storage.read_app_state(page)
    deck = next(d for d in st["decks"] if d["name"] == "Bare Import")
    assert len(deck["cards"]) == 2
    now = seedlib.now_ms()
    for c in deck["cards"]:
        assert isinstance(c["id"], str) and c["id"]
        assert c["ease"] == 2.5
        assert c["interval"] == 0 and c["reps"] == 0 and c["lapses"] == 0
        assert c["state"] == "new"
        assert c["suspended"] is False and c["leech"] is False
        assert now - 5000 <= c["due"] <= now + 5000        # due-now default
        assert c["created"] > 0
        assert c["tags"] == [] and c["hint"] == ""          # empty, not null
    assert [c["front"] for c in deck["cards"]] == ["a", "c"]


# ── 3. move decks between subjects ─────────────────────────────────────────

def _select_deck_card(page, name):
    page.locator("#view-decks .deck-card", has_text=name).click()


def test_move_deck_to_other_subject(page, base_url, seeded):
    seeded("preset:demo")
    pages.goto_app(page, base_url, "/decks/")
    page.locator(".subject-tile", has_text="Miscellaneous").click()
    page.locator(".folder-item", has_text="Languages").click()

    _select_deck_card(page, "Spanish Basics")
    page.locator(".selection-bar").get_by_role("button", name="Move to Subject…").click()
    pages.expect_modal(page, "Move 1 Deck to Subject")
    pages.modal(page).locator("select").select_option("biology")
    pages.modal(page).get_by_role("button", name="Move →").click()

    # deck left its misc folder (folders can't straddle subjects)…
    st = storage.read_app_state(page)
    deck = next(d for d in st["decks"] if d["name"] == "Spanish Basics")
    assert deck["subject"] == "biology"
    assert deck["folderId"] is None
    # …and now lives under the Biology tile (breadcrumb back to subjects)
    page.locator(".breadcrumb").get_by_text("Decks").click()
    page.locator(".subject-tile", has_text="Biology").click()
    expect(page.locator("#view-decks .deck-card", has_text="Spanish Basics")).to_be_visible()


# ── 3b. move folders between subjects ──────────────────────────────────────

def _folder_seed():
    langs = seedlib.make_folder("Languages", folder_id="f_seed_lang")
    verbs = seedlib.make_folder("Verbs", folder_id="f_seed_verbs",
                                parent_id="f_seed_lang")
    spanish = seedlib.make_deck("Spanish Basics",
                                [seedlib.make_card("Hello", "Hola")],
                                deck_id="d_seed_spanish", folder_id="f_seed_lang")
    drills = seedlib.make_deck("Verb Drills",
                               [seedlib.make_card("ser", "to be")],
                               deck_id="f_seed_verbs", folder_id="f_seed_verbs")
    bio = seedlib.make_deck("Biology - Cells",
                            [seedlib.make_card("Q", "A")],
                            deck_id="d_seed_bio", subject="biology")
    return seedlib.make_mf_state(decks=[spanish, drills, bio],
                                 folders=[langs, verbs])


def test_move_folder_between_subjects_carries_subtree(page, base_url, seeded):
    """Moving a folder retags the folder, every subfolder and every deck
    inside the subtree — nothing is left under the old subject."""
    seeded(mf_state=_folder_seed())
    pages.goto_app(page, base_url, "/decks/")
    page.locator(".subject-tile", has_text="Miscellaneous").click()

    row = page.locator(".folder-item", has_text="Languages")
    row.locator("button[title='Move to Subject…']").click()
    pages.expect_modal(page, "Move Folder to Subject")
    expect(pages.modal(page)).to_contain_text("2 decks")      # spanish + drills
    expect(pages.modal(page)).to_contain_text("1 subfolder")
    pages.modal(page).locator("select").select_option("biology")
    pages.modal(page).get_by_role("button", name="Move →").click()

    st = storage.read_app_state(page)
    folders = {f["id"]: f for f in st["folders"]}
    decks = {d["name"]: d for d in st["decks"]}
    assert folders["f_seed_lang"]["subjectKey"] == "biology"
    assert folders["f_seed_verbs"]["subjectKey"] == "biology"   # subtree follows
    assert decks["Spanish Basics"]["subject"] == "biology"
    assert decks["Verb Drills"]["subject"] == "biology"
    assert decks["Biology - Cells"]["subject"] == "biology"     # untouched

    # the folder now lives under the Biology tile
    page.locator(".breadcrumb").get_by_text("Decks").click()
    page.locator(".subject-tile", has_text="Biology").click()
    expect(page.locator(".folder-item", has_text="Languages")).to_be_visible()

    # …and inside it, subfolder rows and the folder toolbar offer the move too
    page.locator(".folder-item", has_text="Languages").click()
    expect(page.locator(".folder-item", has_text="Verbs")
           .locator("button[title='Move to Subject…']")).to_be_visible()
    expect(page.get_by_role("button", name="Move to Subject…")).to_be_visible()


def test_folder_move_from_toolbar(page, base_url, seeded):
    """The folder view's own toolbar can move the folder you're inside."""
    seeded(mf_state=_folder_seed())
    pages.goto_app(page, base_url, "/decks/")
    page.locator(".subject-tile", has_text="Miscellaneous").click()
    page.locator(".folder-item", has_text="Languages").click()

    page.get_by_role("button", name="Move to Subject…").click()
    pages.expect_modal(page, "Move Folder to Subject")
    pages.modal(page).locator("select").select_option("french")
    pages.modal(page).get_by_role("button", name="Move →").click()

    st = storage.read_app_state(page)
    folders = {f["id"]: f for f in st["folders"]}
    assert folders["f_seed_lang"]["subjectKey"] == "french"
    # the view we stayed in is still coherent (breadcrumb/subject updated)
    expect(page.locator("#view-decks")).to_contain_text("Languages")


# ── 4. duplicate card ───────────────────────────────────────────────────────

def test_duplicate_card(page, base_url, seeded):
    seeded("preset:demo")
    pages.goto_app(page, base_url, "/decks/")
    page.locator(".subject-tile", has_text="Miscellaneous").click()
    page.locator(".folder-item", has_text="Languages").click()
    page.locator(".deck-card", has_text="Spanish Basics").get_by_role(
        "button", name="Manage Cards").click()

    before = page.locator("#card-grid .card-selectable").count()
    first_front = page.locator("#card-grid .card-selectable").first.inner_text()
    page.locator("#card-grid .card-selectable").first.get_by_role(
        "button", name="Duplicate").click()

    cards = page.locator("#card-grid .card-selectable")
    expect(cards).to_have_count(before + 1)
    # the copy sits right after the original with identical content…
    expect(cards.nth(1)).to_contain_text(first_front.split("\n")[0])
    st = storage.read_app_state(page)
    deck = next(d for d in st["decks"] if d["name"] == "Spanish Basics")
    assert len(deck["cards"]) == before + 1
    orig, copy = deck["cards"][0], deck["cards"][1]
    assert orig["id"] != copy["id"]
    assert (orig["front"], orig["back"]) == (copy["front"], copy["back"])
    # …but fresh scheduling
    assert copy["state"] == "new" and copy["reps"] == 0 and copy["ease"] == 2.5


# ── 5. deck deep links ──────────────────────────────────────────────────────

def test_deck_deep_link_opens_detail(page, base_url, seeded):
    seeded("preset:demo")
    pages.goto_app(page, base_url,
                   "/decks/#decks/Miscellaneous/Languages/Spanish%20Basics")
    expect(page.get_by_role("button", name="← Back")).to_be_visible(timeout=8000)
    expect(page.locator("#view-decks")).to_contain_text("Hello")
    expect(page.locator("#view-decks")).to_contain_text("El agua")


def test_opening_deck_mirrors_deck_into_hash(page, base_url, seeded):
    seeded("preset:demo")
    pages.goto_app(page, base_url, "/decks/")
    page.locator(".subject-tile", has_text="Miscellaneous").click()
    page.locator(".folder-item", has_text="Languages").click()
    page.locator(".deck-card", has_text="Spanish Basics").get_by_role(
        "button", name="Manage Cards").click()
    expect(page).to_have_url(re.compile(r"#decks/Miscellaneous/Languages/Spanish(%20|-)Basics$"))

    # ← Back drops the deck segment again
    page.get_by_role("button", name="← Back").click()
    expect(page).to_have_url(re.compile(r"#decks/Miscellaneous/Languages$"))


# ── 6. card-move shortcuts ──────────────────────────────────────────────────

def _select_two_cards(page):
    grid = page.locator("#card-grid .card-selectable")
    grid.nth(0).click(position={"x": 40, "y": 20})
    grid.nth(1).click(position={"x": 40, "y": 20})
    expect(page.locator(".selection-bar")).to_contain_text("2 cards selected")


def test_ctrl_alt_k_moves_to_new_deck(page, base_url, seeded):
    seeded("preset:demo")
    pages.goto_app(page, base_url, "/decks/")
    page.locator(".subject-tile", has_text="Miscellaneous").click()
    page.locator(".folder-item", has_text="Languages").click()
    page.locator(".deck-card", has_text="Spanish Basics").get_by_role(
        "button", name="Manage Cards").click()
    _select_two_cards(page)

    page.keyboard.press("Control+Alt+K")
    pages.expect_modal(page, "New Deck")
    # single-textbox modal: exactly one input, no destination select
    assert pages.modal(page).locator("select").count() == 0
    pages.modal(page).locator("input[type='text']").first.fill("Split Verbs")
    pages.modal(page).get_by_role("button", name="Create & Move").click()

    st = storage.read_app_state(page)
    src = next(d for d in st["decks"] if d["name"] == "Spanish Basics")
    new = next(d for d in st["decks"] if d["name"] == "Split Verbs")
    assert len(src["cards"]) == 2 and len(new["cards"]) == 2


def test_ctrl_alt_m_moves_to_existing_deck(page, base_url, seeded):
    seeded("preset:demo")
    pages.goto_app(page, base_url, "/decks/")
    page.locator(".subject-tile", has_text="Miscellaneous").click()
    page.locator(".folder-item", has_text="Languages").click()
    page.locator(".deck-card", has_text="Spanish Basics").get_by_role(
        "button", name="Manage Cards").click()
    _select_two_cards(page)

    page.keyboard.press("Control+Alt+M")
    pages.expect_modal(page, "Existing Deck")
    pages.modal(page).locator("input[type='text']").first.fill("Biology - Cells")
    pages.modal(page).get_by_role("button", name="Move →").click()

    st = storage.read_app_state(page)
    src = next(d for d in st["decks"] if d["name"] == "Spanish Basics")
    bio = next(d for d in st["decks"] if d["name"] == "Biology - Cells")
    assert len(src["cards"]) == 2 and len(bio["cards"]) == 5


def test_shortcuts_inert_without_selection(page, base_url, seeded):
    seeded("preset:demo")
    pages.goto_app(page, base_url, "/decks/")
    page.locator(".subject-tile", has_text="Miscellaneous").click()
    page.locator(".folder-item", has_text="Languages").click()
    page.locator(".deck-card", has_text="Spanish Basics").get_by_role(
        "button", name="Manage Cards").click()
    page.keyboard.press("Control+Alt+K")
    page.keyboard.press("Control+Alt+M")
    expect(pages.modal(page)).to_be_hidden()


def test_button_still_opens_combined_modal(page, base_url, seeded):
    seeded("preset:demo")
    pages.goto_app(page, base_url, "/decks/")
    page.locator(".subject-tile", has_text="Miscellaneous").click()
    page.locator(".folder-item", has_text="Languages").click()
    page.locator(".deck-card", has_text="Spanish Basics").get_by_role(
        "button", name="Manage Cards").click()
    _select_two_cards(page)
    page.get_by_role("button", name="Move to Deck…").click()
    modal = pages.modal(page)
    expect(modal).to_contain_text("Move to Existing Deck")
    expect(modal).to_contain_text("Or Move to a New Deck")


# ── 7. quizlet import ───────────────────────────────────────────────────────

QZ_ITEMS = [
    {"cardSides": [
        {"label": "term", "media": [{"plainText": "Hello"}]},
        {"label": "definition", "media": [{"richText": "<p>Hola &amp; adi&oacute;s</p>"}]},
    ]},
    {"cardSides": [
        {"label": "Country", "media": [{"plainText": "France"}]},
        {"label": "Capital", "media": [{"plainText": "Paris"}]},
        {"label": "Note", "media": [{"plainText": "memo line"}]},
    ]},
]


def test_quizlet_import_tab(page, base_url, seeded):
    calls = []

    def handler(route):
        calls.append(route.request.url)
        route.fulfill(
            status=200,
            headers={"access-control-allow-origin": "*"},
            json={"responses": [{"models": {"studiableItem": QZ_ITEMS},
                                 "paging": {"token": None}}]},
        )

    page.route("**/webapi/3.4/studiable-item-documents*", handler)

    seeded("preset:empty")
    pages.goto_app(page, base_url, "/decks/")
    page.click("#tutorial-target-new-deck")
    pages.expect_modal(page, "Create New Deck")
    page.get_by_role("button", name="🎴 Quizlet").click()

    page.locator("#modal-body input[placeholder^='https://quizlet.com']").fill(
        "https://quizlet.com/987654321/euro-capitals")
    page.get_by_role("button", name="Fetch & Preview").click()
    expect(page.locator("#modal-body")).to_contain_text("2 cards ready", timeout=15000)
    assert calls and "studiableContainerId%5D=987654321" in calls[0]

    page.locator("#modal-body").get_by_role("button", name="Create Deck").click()

    st = storage.read_app_state(page)
    deck = next(d for d in st["decks"] if "987654321" in d["name"])
    assert [c["front"] for c in deck["cards"]] == ["Hello", "France"]
    hello = deck["cards"][0]
    assert hello["back"] == "Hola & adiós"          # entities decoded
    assert hello["ease"] == 2.5 and hello["state"] == "new"   # sanitized defaults
    france = deck["cards"][1]
    assert france["back"] == "Paris" and france["hint"] == "memo line"


def test_quizlet_uses_backend_proxy_first(page, base_url, seeded):
    """Strategy 1 is the same-origin /api/v1/import/quizlet proxy; when it
    answers, quizlet.com is never contacted from the browser."""
    proxied, direct = [], []
    page.route("**/api/v1/import/quizlet*", lambda route: (
        proxied.append(route.request.url),
        route.fulfill(status=200, json={"responses": [{
            "models": {"studiableItem": QZ_ITEMS}, "paging": {"token": None}}]}),
    )[1])
    page.route("**/quizlet.com/**", lambda route: (direct.append(route.request.url),
                                                   route.abort())[1])
    seeded("preset:empty")
    pages.goto_app(page, base_url, "/decks/")
    page.click("#tutorial-target-new-deck")
    page.get_by_role("button", name="🎴 Quizlet").click()
    page.locator("#modal-body input[placeholder^='https://quizlet.com']").fill(
        "https://quizlet.com/424242/proxied-set")
    page.get_by_role("button", name="Fetch & Preview").click()
    expect(page.locator("#modal-body")).to_contain_text("2 cards ready", timeout=15000)
    assert proxied and "set=424242" in proxied[0]
    assert direct == []


def test_quizlet_paste_tsv_fallback(page, base_url, seeded):
    """When every fetch path is blocked, pasted TSV still creates the deck."""
    seeded("preset:empty")
    pages.goto_app(page, base_url, "/decks/")
    page.click("#tutorial-target-new-deck")
    page.get_by_role("button", name="🎴 Quizlet").click()
    page.locator("#modal-body textarea[placeholder^='Paste quizlet-to-scima']").fill(
        "Hello\tHola\nFrance\tParis\tmemo")
    page.get_by_role("button", name="Use pasted data").click()
    expect(page.locator("#modal-body")).to_contain_text("2 cards from paste")
    page.locator("#modal-body input[placeholder^='Leave empty']").fill("Pasted Vocab")
    page.locator("#modal-body").get_by_role("button", name="Create Deck").click()

    st = storage.read_app_state(page)
    deck = next(d for d in st["decks"] if d["name"] == "Pasted Vocab")
    assert [(c["front"], c["back"]) for c in deck["cards"]] == \
        [("Hello", "Hola"), ("France", "Paris")]
    assert deck["cards"][1]["hint"] == "memo"
    assert all(c["ease"] == 2.5 and c["state"] == "new" for c in deck["cards"])


def test_quizlet_paste_scima_json_fallback(page, base_url, seeded):
    """The paste box also accepts stamped scima JSON (quizlet-to-scima.js
    console output)."""
    envelope = {
        "$schema": "scima", "schema": "full", "schemaVersion": 1, "kind": "deck",
        "deck": {"name": "Console Export",
                 "cards": [{"type": "basic", "front": "uno", "back": "one"}]},
    }
    seeded("preset:empty")
    pages.goto_app(page, base_url, "/decks/")
    page.click("#tutorial-target-new-deck")
    page.get_by_role("button", name="🎴 Quizlet").click()
    page.locator("#modal-body textarea[placeholder^='Paste quizlet-to-scima']").fill(
        json.dumps(envelope))
    page.get_by_role("button", name="Use pasted data").click()
    expect(page.locator("#modal-body")).to_contain_text("1 card from paste")
    page.locator("#modal-body").get_by_role("button", name="Create Deck").click()

    st = storage.read_app_state(page)
    deck = next(d for d in st["decks"] if d["name"] == "Console Export")
    assert deck["cards"][0]["front"] == "uno"


def test_quizlet_proxy_template_from_settings(page, base_url, seeded):
    """settings.quizletProxy ('{url}' template) slots in as strategy 2."""
    hits = []
    page.route("**/my-proxy.example/**", lambda route: (
        hits.append(route.request.url),
        route.fulfill(status=200, headers={"access-control-allow-origin": "*"},
                      json={"responses": [{"models": {"studiableItem": QZ_ITEMS},
                                           "paging": {"token": None}}]}),
    )[1])
    seeded(mf_state=seedlib.make_mf_state(
        settings={"quizletProxy": "https://my-proxy.example/?url={url}"}))
    pages.goto_app(page, base_url, "/decks/")
    page.click("#tutorial-target-new-deck")
    page.get_by_role("button", name="🎴 Quizlet").click()
    page.locator("#modal-body input[placeholder^='https://quizlet.com']").fill(
        "https://quizlet.com/777/proxied")
    page.get_by_role("button", name="Fetch & Preview").click()
    expect(page.locator("#modal-body")).to_contain_text("2 cards ready", timeout=15000)
    assert hits and "my-proxy.example" in hits[0]
    assert "quizlet.com%2Fwebapi" in hits[0] or "quizlet.com/webapi" in hits[0]


def test_quizlet_import_error_state(page, base_url, seeded):
    page.route("**/webapi/3.4/studiable-item-documents*",
               lambda route: route.fulfill(status=503, headers={
                   "access-control-allow-origin": "*"}, json={}))
    seeded("preset:empty")
    pages.goto_app(page, base_url, "/decks/")
    page.click("#tutorial-target-new-deck")
    page.get_by_role("button", name="🎴 Quizlet").click()
    page.locator("#modal-body input[placeholder^='https://quizlet.com']").fill(
        "https://quizlet.com/555/nope")
    page.get_by_role("button", name="Fetch & Preview").click()
    expect(page.locator("#modal-body")).to_contain_text("❌", timeout=20000)
    expect(page.locator("#modal-body").get_by_role("button",
                                                   name="Create Deck")).to_be_hidden()
