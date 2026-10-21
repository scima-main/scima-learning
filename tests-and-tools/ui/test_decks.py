"""Decks page: subject tiles, deck cards, create-deck & create-folder flows,
deck detail, card add, delete."""
import re

import pytest
from playwright.sync_api import expect

import seed as seedlib
from helpers import pages, storage

pytestmark = [pytest.mark.decks]


def goto_decks(page, base_url, seeded, preset="preset:demo"):
    seeded(preset)
    pages.goto_app(page, base_url, "/decks/")
    return page


def test_empty_state(page, base_url, seeded):
    goto_decks(page, base_url, seeded, "preset:empty")
    expect(page.locator("#view-decks .empty-state")).to_contain_text("No decks yet")
    expect(page.get_by_role("button", name="+ New Deck")).to_be_visible()


def open_subject_and_folder(page, subject="Miscellaneous", folder="Languages"):
    """Subject tiles → folder rows → deck cards (demo seed nests the Spanish
    deck inside the Languages folder)."""
    page.locator(".subject-tile", has_text=subject).click()
    page.locator(".folder-item", has_text=folder).click()


def test_subject_tiles_and_drilldown(page, base_url, seeded):
    """Decks view groups by subject: Miscellaneous + Biology tiles from the
    demo seed; drilling subject → folder reveals the deck cards."""
    goto_decks(page, base_url, seeded)
    tiles = page.locator("#view-decks .subject-tile")
    names = tiles.locator(".subject-tile-name").all_inner_texts()
    assert "Miscellaneous" in names and "Biology" in names

    page.locator(".subject-tile", has_text="Miscellaneous").click()
    # the Languages folder is listed with its roll-up counts
    folder = page.locator("#view-decks .folder-item", has_text="Languages")
    expect(folder).to_be_visible()
    expect(folder).to_contain_text("4 due")

    folder.click()
    card = page.locator("#view-decks .deck-card", has_text="Spanish Basics")
    expect(card).to_be_visible()
    expect(card.locator(".deck-name")).to_have_text("Spanish Basics")


def test_create_deck_flow_persists(page, base_url, seeded):
    """+ New Deck → name → Create Deck: lands at the subject level and is
    written through to mf_state."""
    goto_decks(page, base_url, seeded)
    page.click("#tutorial-target-new-deck")
    pages.expect_modal(page, "Create New Deck")
    page.fill("#tutorial-target-deck-name-input", "Playwright Deck")
    pages.modal(page).get_by_role("button", name="Create Deck", exact=True).click()

    expect(pages.modal(page)).to_be_hidden(timeout=5000)
    # creation returns to the subject overview — drill in to see the card
    page.locator(".subject-tile", has_text="Miscellaneous").click()
    expect(page.locator("#view-decks .deck-card",
                        has_text="Playwright Deck")).to_be_visible(timeout=5000)

    # scheduleSave() is debounced ~600ms — then it must be on disk
    page.wait_for_timeout(900)
    mf = storage.read_mf_state(page)
    assert any(d["name"] == "Playwright Deck" for d in mf["decks"])


def test_deck_detail_and_back(page, base_url, seeded):
    """Manage Cards opens the deck detail with its cards; ← Back returns."""
    goto_decks(page, base_url, seeded)
    open_subject_and_folder(page)
    page.locator(".deck-card", has_text="Spanish Basics").get_by_role(
        "button", name="Manage Cards").click()

    expect(page.locator("#view-decks")).to_contain_text("Hello")
    expect(page.locator("#view-decks")).to_contain_text("Hola")
    expect(page.locator("#view-decks")).to_contain_text("El agua")

    page.get_by_role("button", name="← Back").click()
    expect(page.locator("#view-decks .subject-tile, #view-decks .deck-card").first).to_be_visible()


def test_add_card_in_deck_detail(page, base_url, seeded):
    """Deck detail → + Add Card → front/back → saved into the deck."""
    goto_decks(page, base_url, seeded)
    open_subject_and_folder(page)
    page.locator(".deck-card", has_text="Spanish Basics").get_by_role(
        "button", name="Manage Cards").click()

    page.get_by_role("button", name=re.compile(r"\+ Add Card")).click()
    pages.expect_modal(page, "Add Card")
    modal = pages.modal(page)
    modal.locator("#tutorial-target-card-front-input").fill("Good night")
    modal.locator("#tutorial-target-card-back-input").fill("Buenas noches")
    modal.get_by_role("button", name="Add Card", exact=True).click()

    expect(page.locator("#view-decks")).to_contain_text("Good night", timeout=5000)
    page.wait_for_timeout(900)
    st = storage.read_app_state(page)
    deck = next(d for d in st["decks"] if d["name"] == "Spanish Basics")
    assert any(c["front"] == "Good night" and c["back"] == "Buenas noches"
               for c in deck["cards"])


def test_create_folder_flow(page, base_url, seeded):
    """+ New Folder → name → Create Folder: folder tile appears."""
    goto_decks(page, base_url, seeded)
    page.locator(".subject-tile", has_text="Miscellaneous").click()
    page.get_by_role("button", name="+ New Folder").first.click()
    pages.expect_modal(page)
    modal = pages.modal(page)
    modal.locator("input[placeholder='e.g. Organic Chemistry']").fill("Verbs")
    modal.get_by_role("button", name="Create Folder").click()
    expect(page.locator("#view-decks")).to_contain_text("Verbs", timeout=5000)

    page.wait_for_timeout(900)
    st = storage.read_app_state(page)
    assert any(f["name"] == "Verbs" for f in st["folders"])


def test_delete_deck_asks_and_undoes(page, site_base, seeded):
    """× on a deck card now asks "are you sure", and the delete toast carries
    an Undo that brings the deck (with its cards) back."""
    goto_decks(page, site_base, seeded)
    page.locator(".subject-tile", has_text="Biology").click()
    card = page.locator(".deck-card", has_text="Biology - Cells")
    expect(card).to_be_visible()

    card.locator("button[title='Delete deck']").click()
    pages.expect_modal(page, "Delete deck?")
    expect(page.locator("#modal-body")).to_contain_text("Are you sure you want to delete")
    # cancel keeps the deck
    page.locator("#modal-body button", has_text="Cancel").click()
    expect(page.locator(".deck-card", has_text="Biology - Cells")).to_be_visible()

    card.locator("button[title='Delete deck']").click()
    pages.expect_modal(page, "Delete deck?")
    page.locator("#modal-body button", has_text="Delete").click()
    expect(page.locator(".deck-card", has_text="Biology - Cells")).to_have_count(0,
                                                                                timeout=5000)
    # undo restores it, cards included
    page.locator("#toast button", has_text="Undo").click()
    page.wait_for_timeout(400)
    expect(page.locator(".deck-card", has_text="Biology - Cells")).to_be_visible()
    st = storage.read_app_state(page)
    deck = next(d for d in st["decks"] if d["name"] == "Biology - Cells")
    assert len(deck["cards"]) == 3

    # …and without undo it persists gone
    page.locator(".deck-card", has_text="Biology - Cells") \
        .locator("button[title='Delete deck']").click()
    pages.expect_modal(page, "Delete deck?")
    page.locator("#modal-body button", has_text="Delete").click()
    page.wait_for_timeout(900)
    st = storage.read_app_state(page)
    assert all(d["name"] != "Biology - Cells" for d in st["decks"])


def test_delete_folder_asks_and_undoes(page, site_base, seeded):
    goto_decks(page, site_base, seeded)
    page.locator(".subject-tile", has_text="x") if False else None
    page.evaluate("() => { state.deckNav = {view:'subject', subjectKey:'misc'};"
                  " renderView('decks'); }")
    page.locator(".folder-item button[title='Delete folder']").first.click()
    pages.expect_modal(page, "Delete folder?")
    expect(page.locator("#modal-body")).to_contain_text("move up to the parent level")
    page.locator("#modal-body button", has_text="Delete").click()
    page.wait_for_timeout(300)
    assert page.evaluate("() => state.folders.length") == 0
    page.locator("#toast button", has_text="Undo").click()
    page.wait_for_timeout(300)
    assert page.evaluate("() => state.folders.length") == 1
    assert page.evaluate(
        "() => state.decks.find(d => d.id === 'd_seed_spanish').folderId"
    ) == "f_seed_lang"


def test_study_now_scopes_to_deck(page, base_url, seeded):
    """▶ Study Now on a deck card → study picker scoped to that deck."""
    goto_decks(page, base_url, seeded)
    open_subject_and_folder(page)
    page.locator(".deck-card", has_text="Spanish Basics").get_by_role(
        "button", name="▶ Study Now").click()

    pages.expect_at(page, "study")
    pages.app_ready(page)
    expect(page.locator("#view-study")).to_contain_text("Spanish Basics")
    expect(page.locator("#view-study")).to_contain_text("4 total cards · 4 due")


# ── Folder export/import must not duplicate the root folder ─────────────────
# exportFolder used to list the root in BOTH `folder` and `subFolders`;
# importers treat those as disjoint → every import created the folder twice
# (one holding the decks, one empty). Export is fixed AND import dedupes by
# id so files already in the wild still import single.

def _folder_state():
    folder = seedlib.make_folder("Langs", folder_id="f_src")
    deck = seedlib.make_deck("D1", [seedlib.make_card("a", "b"),
                                    seedlib.make_card("c", "d")],
                             deck_id="d_src", folder_id="f_src")
    return seedlib.make_mf_state(decks=[deck], folders=[folder])


def _import_file_via_modal(page, path):
    # folder creation lives in the container bar — enter a subject first
    if page.locator(".subject-tile").count():
        page.locator(".subject-tile").first.click()
        page.wait_for_selector(".container-actions", timeout=8000)
    page.get_by_role("button", name="+ New Folder").first.click()
    pages.expect_modal(page)
    page.locator("#modal-body button", has_text="⬆ Import Folder").click()
    page.locator("#modal-body input[type=file][accept='.json']") \
        .set_input_files(path)
    page.locator("#modal-body button", has_text="Import Folder JSON").click()
    page.wait_for_timeout(400)


def test_folder_export_round_trip_creates_single_folder(page, site_base, seeded,
                                                        tmp_path):
    seeded(mf_state=_folder_state())
    pages.goto_app(page, site_base, "/decks/")
    with page.expect_download(timeout=10000) as dl:
        page.evaluate("() => exportFolder('f_src')")
    path = tmp_path / "folder-export.json"
    dl.value.save_as(str(path))
    import json as _json
    payload = _json.loads(path.read_text())
    body = payload.get("payload", payload)
    # new exports: root lives only in `folder`, never repeated in subFolders
    assert body["folder"]["id"] == "f_src"
    assert all(f["id"] != "f_src" for f in body.get("subFolders", []))

    _import_file_via_modal(page, str(path))
    folders = page.evaluate("() => state.folders")
    named = [f for f in folders if f["name"] == "Langs"]
    assert len(named) == 2, named          # original + exactly one import
    new_id = next(f["id"] for f in named if f["id"] != "f_src")
    decks = page.evaluate("() => state.decks")
    in_new = [d for d in decks if d["folderId"] == new_id]
    assert len(in_new) == 1                # decks travelled with the import
    assert not [f for f in folders if f["name"] == "Langs"
                and f["id"] not in ("f_src", new_id)]


def test_legacy_duplicate_root_file_imports_single_folder(page, site_base,
                                                          seeded, tmp_path):
    """A file exported by the OLD buggy exporter (root in folder AND
    subFolders) must still import as one folder + its child + its decks."""
    import json as _json
    legacy = {
        "version": 2,
        "exportedAt": "2026-10-20T00:00:00.000Z",
        "folder": {"id": "fX", "name": "Legacy", "emoji": "📁", "image": None,
                   "subjectKey": "misc", "parentId": None,
                   "color": "var(--blue)"},
        "subFolders": [
            {"id": "fX", "name": "Legacy", "emoji": "📁", "image": None,
             "subjectKey": "misc", "parentId": None, "color": "var(--blue)"},
            {"id": "fY", "name": "Child", "emoji": "📁", "image": None,
             "subjectKey": "misc", "parentId": "fX", "color": "var(--blue)"},
        ],
        "decks": [{"id": "dX", "name": "LD", "emoji": "📖", "image": None,
                   "subject": "misc", "folderId": "fX",
                   "color": "var(--blue)", "pinned": False,
                   "cards": [{"id": "cX", "front": "q", "back": "a",
                              "type": "basic", "ease": 2.5, "interval": 0,
                              "reps": 0, "lapses": 0, "due": 0,
                              "state": "new", "suspended": False,
                              "leech": False, "created": 0,
                              "lastRated": None}]}],
    }
    path = tmp_path / "legacy-folder.json"
    path.write_text(_json.dumps(legacy))
    # an anchor deck so the root lists a subject to import into
    anchor = seedlib.make_deck("Anchor", [seedlib.make_card("q", "a")],
                               deck_id="d_anchor")
    seeded(mf_state=seedlib.make_mf_state(decks=[anchor]))
    pages.goto_app(page, site_base, "/decks/")
    _import_file_via_modal(page, str(path))
    st = page.evaluate("() => ({folders: state.folders, decks: state.decks})")
    legacy_folders = [f for f in st["folders"] if f["name"] == "Legacy"]
    child = [f for f in st["folders"] if f["name"] == "Child"]
    assert len(legacy_folders) == 1, legacy_folders
    assert len(child) == 1
    root_id = legacy_folders[0]["id"]
    assert child[0]["parentId"] == root_id          # nesting survived
    deck = next(d for d in st["decks"] if d["name"] == "LD")
    assert deck["folderId"] == root_id              # decks in the real folder


# ── Card editor: 3×2 mode grid + "✂ Create multi-answer" split ──────────────

TAX_BACK = ("income tax, national insurance contributions, inheritance tax, "
            "capital gains tax, corporation tax")


def _tax_state():
    card = seedlib.make_card("Name the five main UK taxes", TAX_BACK,
                             card_id="c_tax")
    deck = seedlib.make_deck("Taxes", [card], deck_id="d_tax")
    return seedlib.make_mf_state(decks=[deck])


def _open_tax_editor(page, site_base, seeded):
    seeded(mf_state=_tax_state())
    pages.goto_app(page, site_base, "/decks/")
    page.evaluate("() => openCardModal('d_tax', 'c_tax')")
    pages.expect_modal(page, "Edit Card")


def test_mode_buttons_are_three_by_two_with_split_button_right(page, site_base,
                                                                seeded):
    _open_tax_editor(page, site_base, seeded)
    cols = page.evaluate("""() => {
        const b = [...document.querySelectorAll('#modal-body button')]
            .find(b => b.textContent === 'Multi-answer');
        return getComputedStyle(b.parentElement).gridTemplateColumns;
    }""")
    assert len(cols.split()) == 3, cols          # 3 wide → 2 tall for 6 modes
    grid_box = page.evaluate("""() => {
        const b = [...document.querySelectorAll('#modal-body button')]
            .find(b => b.textContent === 'Multi-answer');
        const r = b.parentElement.getBoundingClientRect();
        return {x: r.x, w: r.width};
    }""")
    split = page.locator("#modal-body button", has_text="Create multi-answer")
    expect(split).to_be_visible()
    sb = split.bounding_box()
    assert sb["x"] >= grid_box["x"] + grid_box["w"] - 1   # to the RIGHT of grid


def test_create_multi_answer_splits_comma_back(page, site_base, seeded):
    _open_tax_editor(page, site_base, seeded)
    page.locator("#modal-body button", has_text="Create multi-answer").click()
    expect(page.locator("#toast")).to_contain_text("Split into 5 answers")
    pool = page.evaluate(
        "() => [...document.querySelectorAll('#modal-body input')]"
        ".map(i => i.value)"
        ".filter(v => v.includes('tax') || v.includes('contributions'))")
    assert pool == ["income tax", "national insurance contributions",
                    "inheritance tax", "capital gains tax",
                    "corporation tax"], pool
    # required-for-full-marks defaults to the whole list
    req = page.locator(
        "#modal-body input[type=number]").first.input_value()
    assert req == "5", req
    # save → the stored card is a 5-answer multi card
    page.locator("#modal-body button", has_text="Save Changes").click()
    page.wait_for_timeout(900)
    card = storage.read_mf_state(page)["decks"][0]["cards"][0]
    assert card["answerCount"] == 5
    assert card["requiredAnswers"] == 5
    assert card["back"] == "\n".join(TAX_BACK.split(", "))


def test_create_multi_answer_guards(page, site_base, seeded):
    _open_tax_editor(page, site_base, seeded)
    # no commas → nothing to split, mode unchanged
    page.fill("#modal-body textarea >> nth=1", "a single answer")
    page.locator("#modal-body button", has_text="Create multi-answer").click()
    expect(page.locator("#toast")).to_contain_text("nothing to split")
    # non-basic mode → guidance instead of a silent mis-split
    page.get_by_role("button", name="Multi-answer", exact=True).click()
    page.locator("#modal-body button", has_text="Create multi-answer").click()
    expect(page.locator("#toast")).to_contain_text("Switch to Basic first")


# ── Unified decks browser: subjects behave as folders ───────────────────────

def test_subject_and_folder_bars_share_one_layout(page, site_base, seeded):
    """The container action bar is identical for subjects and folders up to
    the folder-only management actions — same labels, same order."""
    seeded("preset:demo")
    pages.goto_app(page, site_base, "/decks/")
    page.locator(".subject-tile", has_text="Miscellaneous").click()
    page.wait_for_selector(".container-actions", timeout=8000)
    subject_bar = page.locator(".container-actions").first
    subject_labels = subject_bar.locator("button").all_inner_texts()
    page.locator(".folder-item", has_text="Languages").click()
    page.wait_for_timeout(300)
    folder_bar = page.locator(".container-actions").first
    folder_labels = folder_bar.locator("button").all_inner_texts()
    assert subject_labels == ["▶ Study", "Aa Case…", "⬇ Export",
                              "✏️ Edit Subject", "+ New Folder", "+ New Deck"], subject_labels
    assert folder_labels == ["▶ Study", "Aa Case…", "⬇ Export",
                             "📂 Move to Folder…", "📚 Move to Subject…",
                             "✏ Rename", "× Delete",
                             "+ New Folder", "+ New Deck"], folder_labels
    # shared edges: ▶ Study opens the bar, + New Deck (primary) closes it
    assert folder_labels[:3] == subject_labels[:3]
    assert folder_labels[-2:] == subject_labels[-2:]


def test_subject_rows_are_folder_rows_with_export(page, site_base, seeded):
    """Root lists subjects as folder-style rows: open on click, ▶ ⬇ ️
    actions, and a drop target for drag-and-drop into the subject top."""
    seeded("preset:demo")
    pages.goto_app(page, site_base, "/decks/")
    row = page.locator(".subject-tile", has_text="Miscellaneous")
    expect(row).to_have_class(re.compile(r"folder-item"))
    assert row.locator("button[title='Study this subject now']").count() == 1
    assert row.locator("button[title='Export subject as JSON']").count() == 1
    assert row.locator("button[title='Edit subject (Settings)']").count() == 1
    assert row.get_attribute("data-drop-folder") is not None
    with page.expect_download(timeout=10000) as dl:
        row.locator("button[title='Export subject as JSON']").click()
    name = dl.value.suggested_filename
    assert name.startswith("SCIMA-subject-") and name.endswith(".json"), name


def test_action_orders_primary_at_the_ends(page, site_base, seeded):
    """Bars order use → edit → export → move → create, and the highlighted
    primary always sits at an END of the bar — never in the middle."""
    seeded("preset:demo")
    pages.goto_app(page, site_base, "/decks/")
    # root bar: manage → creations, primary closes the bar
    root = [t.strip() for t in page.locator(".container-actions button").all_inner_texts()]
    assert root == ["📚 Manage Subjects", "+ New Folder", "+ New Deck"], root
    assert "primary" in page.locator(".container-actions button").nth(2).get_attribute("class")
    # deck card secondary row (inside a subject): use → edit → exports
    page.locator(".subject-tile", has_text="Miscellaneous").click()
    page.wait_for_timeout(300)
    page.locator(".folder-item", has_text="Languages").click()
    page.wait_for_timeout(400)
    card = page.locator(".deck-card").first
    labels = [t.strip() for t in card.locator("button").all_inner_texts()]
    # …▶ Study Now (primary, full width) then use → edit → exports
    assert labels[-4:] == ["Manage Cards", "Aa", "⬇️", "🖨️"], labels
    # deck-grid selection bar: use → move → utilities → primary LAST
    card.locator(".deck-name").click()          # click the tile itself to select
    page.wait_for_timeout(300)
    sel = page.locator(".selection-bar")
    labels = [b.inner_text().strip() for b in sel.locator("button").all()]
    assert labels == ["▶ Study Selected", "Move to Subject…",
                      "Select All", "Clear", "Move to Folder…"], labels
    assert "primary" in sel.locator("button").nth(len(labels) - 1).get_attribute("class")
    # card-grid selection bar inside deck detail: primary LAST here too
    card.locator("button", has_text="Manage Cards").click()
    page.wait_for_timeout(600)
    page.locator(".card.card-selectable").first.click()
    page.wait_for_timeout(300)
    sel2 = page.locator(".selection-bar")
    labels2 = [b.inner_text().strip() for b in sel2.locator("button").all()]
    assert labels2 == ["▶ Study Selected", "Aa Case…",
                       "Select All", "Clear", "Move to Deck…"], labels2
    assert "primary" in sel2.locator("button").nth(len(labels2) - 1).get_attribute("class")
