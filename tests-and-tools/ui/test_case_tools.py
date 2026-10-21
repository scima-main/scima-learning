"""Batch case standardization (Aa Case…): ALL CAPS / all lowercase / Title
Case (grammar words kept small), scoped to a card selection, a deck, a
folder subtree or a subject — with preview, math-span protection and an
Undo toast. Lives in site/home until the next `minify` run → `site_base`.
"""
import pytest
from playwright.sync_api import expect

import seed as seedlib
from helpers import pages, storage

pytestmark = [pytest.mark.decks]

CASE_CARDS = [
    # mixed case + a TeX span that must survive every transform untouched
    dict(cid="c_case1", front="the wall of a cell",
         back="THE CELL WALL holds $x^2 + \\textbf{Y}$ stuff"),
    dict(cid="c_case2", front="photosynthesis BY the light-dependent reactions",
         back="mitochondria release energy from glucose"),
]


def _seed_state():
    deck = seedlib.make_deck("Case Deck",
                             [seedlib.make_card(c["front"], c["back"],
                                                card_id=c["cid"])
                              for c in CASE_CARDS],
                             deck_id="d_case")
    return seedlib.make_mf_state(decks=[deck])


def open_deck_detail(page):
    page.evaluate("() => openDeckDetail('d_case')")
    expect(page.locator("#modal-backdrop.hidden"))
    page.wait_for_selector("#card-grid .card", timeout=8000)


def card_fields(page, cid):
    return page.evaluate(
        f"() => {{ const c = state.decks.flatMap(d => d.cards)"
        f".find(c => c.id === '{cid}'); "
        "return {front: c.front, back: c.back}; }")


def goto_deck(page, site_base, seeded):
    seeded(mf_state=_seed_state())
    pages.goto_app(page, site_base, "/decks/")
    open_deck_detail(page)
    return page


def test_title_case_grammar_words(page, site_base, seeded):
    goto_deck(page, site_base, seeded)
    page.locator("#view-decks button", has_text="Aa Case…").first.click()
    pages.expect_modal(page, "Standardize Case")
    expect(page.locator("#modal-body button", has_text="Title Case")).to_be_visible()
    # Title Case is the default tool — preview shows both cards changing
    expect(page.locator("#modal-body")).to_contain_text("the wall of a cell")
    page.locator("#modal-body button", has_text="Apply").click()
    page.wait_for_timeout(400)
    f1 = card_fields(page, "c_case1")
    f2 = card_fields(page, "c_case2")
    assert f1["front"] == "The Wall of a Cell", f1
    # grammar words stay small, first/last capitalized, TeX untouched
    assert f1["back"] == "The Cell Wall Holds $x^2 + \\textbf{Y}$ Stuff", f1
    assert f2["front"] == "Photosynthesis by the Light-dependent Reactions", f2
    assert f2["back"] == "Mitochondria Release Energy from Glucose", f2


def test_all_caps_and_lower_preserve_math(page, site_base, seeded):
    goto_deck(page, site_base, seeded)
    page.locator("#view-decks button", has_text="Aa Case…").first.click()
    pages.expect_modal(page, "Standardize Case")
    page.locator("#modal-body button", has_text="ALL CAPS").click()
    expect(page.locator("#modal-body")).to_contain_text("THE WALL OF A CELL")
    page.locator("#modal-body button", has_text="Apply").click()
    page.wait_for_timeout(400)
    f1 = card_fields(page, "c_case1")
    assert f1["front"] == "THE WALL OF A CELL", f1
    assert f1["back"] == "THE CELL WALL HOLDS $x^2 + \\textbf{Y}$ STUFF", f1
    # undo toast restores the previous values
    page.locator("#toast button", has_text="Undo").click()
    page.wait_for_timeout(400)
    f1 = card_fields(page, "c_case1")
    assert f1["front"] == "the wall of a cell", f1
    # …and all lowercase via a fresh run (re-enter the deck detail first —
    # Apply/Undo return to the deckNav list view)
    open_deck_detail(page)
    page.locator("#view-decks button", has_text="Aa Case…").first.click()
    pages.expect_modal(page, "Standardize Case")
    page.locator("#modal-body button", has_text="all lowercase").click()
    page.locator("#modal-body button", has_text="Apply").click()
    page.wait_for_timeout(400)
    f1 = card_fields(page, "c_case1")
    assert f1["back"] == "the cell wall holds $x^2 + \\textbf{Y}$ stuff", f1


def test_selection_scope_touches_only_selected_cards(page, site_base, seeded):
    goto_deck(page, site_base, seeded)
    # select exactly one card (tap-to-toggle selection)
    page.locator("#card-grid .card", has_text="the wall of a cell").first.click()
    bar = page.locator(".selection-bar")
    expect(bar).to_be_visible()
    bar.locator("button", has_text="Aa Case…").click()
    pages.expect_modal(page, "Standardize Case")
    expect(page.locator("#modal-body")).to_contain_text("1 card")
    page.locator("#modal-body button", has_text="ALL CAPS").click()
    page.locator("#modal-body button", has_text="Apply").click()
    page.wait_for_timeout(400)
    assert card_fields(page, "c_case1")["front"] == "THE WALL OF A CELL"
    assert card_fields(page, "c_case2")["front"] == \
        "photosynthesis BY the light-dependent reactions"   # untouched


def test_folder_and_subject_scopes(page, site_base, seeded):
    folder = seedlib.make_folder("Case Folder", folder_id="f_case")
    deck = seedlib.make_deck("Case Deck",
                             [seedlib.make_card(c["front"], c["back"],
                                                card_id=c["cid"])
                              for c in CASE_CARDS],
                             deck_id="d_case", folder_id="f_case")
    seeded(mf_state=seedlib.make_mf_state(decks=[deck], folders=[folder]))
    pages.goto_app(page, site_base, "/decks/")
    page.evaluate("() => { state.deckNav = {view:'subject', subjectKey:'misc'};"
                  " renderView('decks'); }")
    page.get_by_role("button", name="Aa Case…").first.click()
    pages.expect_modal(page, "Standardize Case")
    expect(page.locator("#modal-body")).to_contain_text("2 cards")
    page.locator("#modal-body button", has_text="all lowercase").click()
    page.locator("#modal-body button", has_text="Apply").click()
    page.wait_for_timeout(400)
    fronts = page.evaluate(
        "() => state.decks.flatMap(d => d.cards).map(c => c.front)")
    assert fronts == ["the wall of a cell",
                      "photosynthesis by the light-dependent reactions"], fronts


def test_persistence_of_case_edit(page, site_base, seeded):
    goto_deck(page, site_base, seeded)
    page.locator("#view-decks button", has_text="Aa Case…").first.click()
    pages.expect_modal(page, "Standardize Case")
    page.locator("#modal-body button", has_text="Apply").click()
    page.wait_for_timeout(900)                     # debounced save
    mf = storage.read_mf_state(page)
    c1 = next(c for d in mf["decks"] for c in d["cards"] if c["id"] == "c_case1")
    assert c1["front"] == "The Wall of a Cell"


# ── End-punctuation transforms + independent scopes ─────────────────────────

def _scope_state():
    cards = [
        seedlib.make_card("the wall of a cell", "THE CELL WALL holds stuff",
                          card_id="c_p1", hint="think plants"),
        seedlib.make_card("already ended.", "ends with bang!",
                          card_id="c_p2"),
    ]
    cards[0]["type"] = "basic"
    cards[1]["type"] = "markscheme"
    deck = seedlib.make_deck("case DECK", cards, deck_id="d_case")
    deck["folderId"] = "f_case"
    folder = seedlib.make_folder("case FOLDER", folder_id="f_case")
    return seedlib.make_mf_state(decks=[deck], folders=[folder])


def _open_deck_modal(page):
    page.evaluate("() => openDeckDetail('d_case')")
    page.wait_for_selector("#card-grid .card", timeout=8000)
    page.locator("#view-decks button", has_text="Aa Case…").first.click()
    pages.expect_modal(page, "Standardize Case")


def _fields(page):
    return page.evaluate("""() => {
        const g = id => { const c = state.decks.flatMap(d => d.cards)
            .find(c => c.id === id);
          return {front: c.front, back: c.back, hint: c.hint}; };
        return {c1: g('c_p1'), c2: g('c_p2'),
                deck: state.decks[0].name, folder: state.folders[0].name};
    }""")


def _undo(page):
    page.locator("#toast button", has_text="Undo").click()
    page.wait_for_timeout(300)


def test_add_period_only_where_missing(page, site_base, seeded):
    seeded(mf_state=_scope_state())
    pages.goto_app(page, site_base, "/decks/")
    _open_deck_modal(page)
    page.locator("#modal-body button", has_text="Keep case").click()
    page.locator("#modal-body button", has_text='Add "." if missing').click()
    page.locator("#modal-body button", has_text="Apply").click()
    page.wait_for_timeout(400)
    f = _fields(page)
    assert f["c1"]["front"] == "the wall of a cell."
    assert f["c1"]["back"] == "THE CELL WALL holds stuff."
    assert f["c1"]["hint"] == "think plants."
    assert f["c2"]["front"] == "already ended."     # already ended → untouched
    assert f["c2"]["back"] == "ends with bang!"     # ! is sentence punctuation
    _undo(page)
    assert _fields(page)["c1"]["front"] == "the wall of a cell"


def test_strip_ending_punctuation(page, site_base, seeded):
    seeded(mf_state=_scope_state())
    pages.goto_app(page, site_base, "/decks/")
    _open_deck_modal(page)
    page.locator("#modal-body button", has_text="Keep case").click()
    page.locator("#modal-body button",
                 has_text="Strip ending punctuation").click()
    page.locator("#modal-body button", has_text="Apply").click()
    page.wait_for_timeout(400)
    f = _fields(page)
    assert f["c2"]["front"] == "already ended"
    assert f["c2"]["back"] == "ends with bang"
    assert f["c1"]["front"] == "the wall of a cell"   # nothing to strip


def test_scope_hints_only(page, site_base, seeded):
    seeded(mf_state=_scope_state())
    pages.goto_app(page, site_base, "/decks/")
    _open_deck_modal(page)
    page.locator("#modal-body button", has_text="✓ Fronts").click()
    page.locator("#modal-body button", has_text="✓ Backs").click()
    page.locator("#modal-body button", has_text="Keep case").click()
    page.locator("#modal-body button", has_text='Add "." if missing').click()
    page.locator("#modal-body button", has_text="Apply").click()
    page.wait_for_timeout(400)
    f = _fields(page)
    assert f["c1"]["hint"] == "think plants."
    assert f["c1"]["front"] == "the wall of a cell"   # fronts unchecked
    assert f["c1"]["back"] == "THE CELL WALL holds stuff"


def test_scope_card_type_filter(page, site_base, seeded):
    seeded(mf_state=_scope_state())
    pages.goto_app(page, site_base, "/decks/")
    _open_deck_modal(page)
    page.locator("#modal-body button", has_text="All card types").click()
    page.locator("#modal-body button", has_text="Mark scheme").click()
    expect(page.locator("#modal-body")).to_contain_text("1 card")
    page.locator("#modal-body button", has_text="Apply").click()
    page.wait_for_timeout(400)
    f = _fields(page)
    assert f["c1"]["front"] == "the wall of a cell"      # basic untouched
    assert f["c2"]["front"] == "Already Ended."          # markscheme titled


def test_scope_deck_and_folder_names(page, site_base, seeded):
    seeded(mf_state=_scope_state())
    pages.goto_app(page, site_base, "/decks/")
    page.evaluate("() => { state.deckNav = {view:'folder', subjectKey:'misc',"
                  " folderId:'f_case'}; renderView('decks'); }")
    page.get_by_role("button", name="Aa Case…").first.click()
    pages.expect_modal(page, "Standardize Case")
    # names on, card fields off → only the two names change
    page.locator("#modal-body button", has_text="Deck names").click()
    page.locator("#modal-body button", has_text="Folder names").click()
    page.locator("#modal-body button", has_text="✓ Fronts").click()
    page.locator("#modal-body button", has_text="✓ Backs").click()
    page.locator("#modal-body button", has_text="✓ Hints").click()
    page.locator("#modal-body button", has_text="Apply").click()
    page.wait_for_timeout(400)
    f = _fields(page)
    assert f["deck"] == "Case Deck"
    assert f["folder"] == "Case Folder"
    assert f["c1"]["front"] == "the wall of a cell"      # fields untouched


def test_math_span_survives_punctuation_rules(page, site_base, seeded):
    """A field ending in a TeX span has no trailing punctuation character —
    add/strip must leave it alone rather than mangling the math."""
    deck = seedlib.make_deck("Math", [seedlib.make_card(
        "solve $x^2 + \\textbf{Y}$", "ans", card_id="c_m")], deck_id="d_m")
    seeded(mf_state=seedlib.make_mf_state(decks=[deck]))
    pages.goto_app(page, site_base, "/decks/")
    page.evaluate("() => openDeckDetail('d_m')")
    page.wait_for_selector("#card-grid .card")
    page.locator("#view-decks button", has_text="Aa Case…").first.click()
    pages.expect_modal(page, "Standardize Case")
    page.locator("#modal-body button", has_text="Keep case").click()
    page.locator("#modal-body button", has_text='Add "." if missing').click()
    page.locator("#modal-body button", has_text="Apply").click()
    page.wait_for_timeout(400)
    front = page.evaluate(
        "() => state.decks[0].cards.find(c => c.id === 'c_m').front")
    assert front == "solve $x^2 + \\textbf{Y}$.", front
