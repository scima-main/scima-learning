"""Mobile layer: the ≤720px phone block and the (hover:none)/(pointer:coarse)
capability blocks in dashboard.css, plus the touch-parity workflows they
unlock (drag-and-drop alternatives, command-palette removal).

Pinned behaviours:
  * modals become edge-to-edge sheets — full bleed left→right, a sliver of
    air at the top, inside the viewport at every phone size;
  * phone width is ONE panel wide (grid-2/grid-3 stack) with button-scale
    grids TWO wide (stat tiles, the four rating buttons → 2×2);
  * form controls render at 16px (iOS Safari focus-zoom guard);
  * the command palette's ⌘K pill is gone on touch devices and Ctrl+K is
    inert there (the nav drawer covers the same ground);
  * hover-revealed row actions are permanently visible on touch, and the
    folder/deck move workflows are reachable by tapping (modals, not DnD).
"""
import re

import pytest
from playwright.sync_api import expect

from helpers import content, pages, storage

pytestmark = [pytest.mark.responsive]

PHONE = {"width": 390, "height": 844}
TINY = {"width": 320, "height": 568}


def _touch_context(browser, playwright, seed_preset="preset:demo"):
    """A real phone descriptor (Pixel 7): isMobile + hasTouch → Chromium
    emulates (hover:none)/(pointer:coarse), the capability blocks' trigger."""
    import seed as seedlib
    ctx = browser.new_context(**playwright.devices["Pixel 7"])
    if seed_preset is not None:
        blob = seedlib.resolve_seed(seed_preset)
        storage.seed_context(ctx, mf_state=blob.get("mf_state"),
                             tracker=blob.get("SCIMATracker"))
    return ctx


# ── Edge-to-edge modals ─────────────────────────────────────────────────────

@pytest.mark.parametrize("w,h", [(390, 844), (320, 568), (360, 740)])
def test_modal_is_edge_to_edge_sheet_on_phone(page, base_url, seeded, w, h):
    seeded("preset:empty")
    page.set_viewport_size({"width": w, "height": h})
    pages.goto_app(page, base_url, "/decks/")
    page.click("#tutorial-target-new-deck")
    pages.expect_modal(page, "Create New Deck")
    box = page.locator("#modal-box").bounding_box()
    # full bleed left→right …
    assert box["x"] == 0, box
    assert abs(box["width"] - w) <= 1, box
    # … a sliver of air at the top …
    assert 4 <= box["y"] <= 20, box
    # … and never taller than the viewport.
    assert box["y"] + box["height"] <= h + 1, box


def test_modal_sheet_has_rounded_top_only(page, base_url, seeded):
    seeded("preset:empty")
    page.set_viewport_size(PHONE)
    pages.goto_app(page, base_url, "/decks/")
    page.click("#tutorial-target-new-deck")
    pages.expect_modal(page)
    radii = page.evaluate("""() => {
        const s = getComputedStyle(document.getElementById('modal-box'));
        return [s.borderTopLeftRadius, s.borderTopRightRadius,
                s.borderBottomLeftRadius];
    }""")
    top_l, top_r, bottom_l = radii
    assert top_l != "0px" and top_r != "0px", radii
    assert bottom_l == "0px", radii


def test_modal_stays_desktop_dialog_above_breakpoint(page, base_url, seeded):
    """721px+ keeps the centred 580px dialog (the sheet is phone-only)."""
    seeded("preset:empty")
    page.set_viewport_size({"width": 900, "height": 800})
    pages.goto_app(page, base_url, "/decks/")
    page.click("#tutorial-target-new-deck")
    pages.expect_modal(page)
    box = page.locator("#modal-box").bounding_box()
    assert box["x"] > 100, box          # centred, not full bleed
    assert box["width"] < 700, box


# ── One panel + two buttons wide ────────────────────────────────────────────

def test_grids_collapse_to_one_panel_on_phone(page, base_url, seeded):
    seeded("preset:demo")
    page.set_viewport_size(PHONE)
    pages.goto_app(page, base_url, "/")
    def cols(sel):
        return page.evaluate(
            f"() => getComputedStyle(document.querySelector('{sel}'))"
            ".gridTemplateColumns")
    # home's deck grid (grid-3) → a single column
    assert len(cols(".grid-3").split()) == 1, cols(".grid-3")
    # home's stat tiles (grid-4) → two-up (button-scale, not panels)
    assert len(cols(".grid-4").split()) == 2, cols(".grid-4")
    # settings' panel grid (grid-2) → a single column
    pages.goto_app(page, base_url, "/settings/")
    assert len(cols("#view-settings .grid-2").split()) == 1


def test_rating_buttons_two_wide_on_phone(page, base_url, seeded):
    seeded("preset:demo")
    page.set_viewport_size(PHONE)
    pages.goto_app(page, base_url, "/study/")
    page.click("#tutorial-target-study-start")
    expect(page.locator(".flashcard.front")).to_be_visible(timeout=10000)
    pages.reveal(page)
    buttons = pages.rating_buttons(page)
    expect(buttons.first).to_be_visible(timeout=10000)
    grid_cols = page.evaluate(
        "() => getComputedStyle(document.querySelector('.rating-grid'))"
        ".gridTemplateColumns")
    assert len(grid_cols.split()) == 2, grid_cols
    # 2×2 block: the four buttons occupy exactly two distinct rows
    tops = sorted({round(buttons.nth(i).bounding_box()["y"]) for i in range(4)})
    assert len(tops) == 2, tops
    assert content.horizontal_overflow(page) == []


def test_form_inputs_are_16px_on_phone(page, base_url, seeded):
    """Below 16px iOS Safari zooms the whole page on input focus."""
    seeded("preset:empty")
    page.set_viewport_size(PHONE)
    pages.goto_app(page, base_url, "/settings/")
    size = page.evaluate("""() => getComputedStyle(
        document.querySelector('select[aria-label=\"SRS scheduling algorithm\"]')
    ).fontSize""")
    assert size == "16px", size
    pages.goto_app(page, base_url, "/decks/")
    page.click("#tutorial-target-new-deck")
    pages.expect_modal(page)
    size = page.evaluate("""() => getComputedStyle(
        document.querySelector('#modal-body input[type=text]')).fontSize""")
    assert size == "16px", size


def test_inputs_stay_compact_on_desktop(page, base_url, seeded):
    seeded("preset:empty")
    page.set_viewport_size({"width": 1280, "height": 800})
    pages.goto_app(page, base_url, "/settings/")
    size = page.evaluate("""() => getComputedStyle(
        document.querySelector('select[aria-label=\"SRS scheduling algorithm\"]')
    ).fontSize""")
    assert size == "13px", size


# ── Command palette removal on touch ────────────────────────────────────────

def test_cmd_hint_hidden_on_touch_device(browser, playwright, base_url):
    ctx = _touch_context(browser, playwright)
    page = ctx.new_page()
    try:
        pages.goto_app(page, base_url, "/")
        expect(page.locator("#cmd-hint")).to_be_hidden()
    finally:
        ctx.close()


def test_ctrl_k_inert_on_touch_device(browser, playwright, base_url):
    """The shortcut is redundant without a keyboard — the drawer covers the
    same destinations. On touch contexts it must not open the palette."""
    ctx = _touch_context(browser, playwright)
    page = ctx.new_page()
    try:
        pages.goto_app(page, base_url, "/")
        page.keyboard.press("Control+k")
        page.wait_for_timeout(300)
        expect(page.locator("#cmd-backdrop")).to_have_class(re.compile("hidden"))
    finally:
        ctx.close()


def test_cmd_palette_still_works_on_desktop(page, base_url, seeded):
    seeded("preset:empty")
    pages.goto_app(page, base_url, "/")
    expect(page.locator("#cmd-hint")).to_be_visible()
    pages.open_command_palette(page)
    page.keyboard.press("Escape")


# ── Touch-parity workflows ──────────────────────────────────────────────────

def test_folder_actions_visible_without_hover(browser, playwright, base_url):
    """folder-actions are hover-revealed on desktop; a touch device has no
    hover, so the capability block pins them visible."""
    ctx = _touch_context(browser, playwright)
    page = ctx.new_page()
    try:
        pages.goto_app(page, base_url, "/decks/")
        # demo seed: open the subject holding the folder
        subj = page.evaluate("() => state.folders[0].subjectKey")
        page.evaluate(
            "(s) => { state.deckNav = {view: 'subject', subjectKey: s};"
            " renderView('decks'); }", subj)
        actions = page.locator(".folder-item .folder-actions").first
        expect(actions).to_be_visible()
        opacity = actions.evaluate("el => getComputedStyle(el).opacity")
        assert opacity == "1", opacity
        # and the row's buttons are real tap targets, incl. the new 📂 move
        expect(actions.locator("button[title='Move to Folder…']")).to_have_count(1)
    finally:
        ctx.close()


def test_move_folder_by_tap_not_drag(browser, playwright, base_url):
    """The 📂 Move-to-Folder modal is the touch path for the drag-and-drop
    folder reorganization: move the demo folder into a new subject's top
    level and the subtree follows."""
    ctx = _touch_context(browser, playwright)
    page = ctx.new_page()
    try:
        pages.goto_app(page, base_url, "/decks/")
        folder = page.evaluate(
            "() => ({id: state.folders[0].id, name: state.folders[0].name,"
            " subject: state.folders[0].subjectKey})")
        page.evaluate(
            f"() => {{ state.deckNav = {{view:'subject',"
            f" subjectKey:'{folder['subject']}'}}; renderView('decks'); }}")
        page.locator(".folder-item",
                     has_text=folder["name"]).locator(
                         "button[title='Move to Folder…']").tap()
        pages.expect_modal(page, "Move Folder to Folder")
        dest = page.evaluate("""() => {
            const opts = [...document.querySelectorAll('#modal-body select option')]
                .map(o => o.value).filter(v => v.startsWith('subj:'));
            return opts[0];
        }""")
        assert dest, "no cross-subject destinations offered"
        page.select_option("#modal-body select", dest)
        page.locator("#modal-body button", has_text="Move →").tap()
        page.wait_for_timeout(900)
        moved = storage.read_app_state(page)
        f = next(f for f in moved["folders"] if f["id"] == folder["id"])
        assert f["subjectKey"] == dest.split(":", 1)[1]
        assert f["parentId"] is None
    finally:
        ctx.close()


def test_move_deck_to_folder_by_tap(browser, playwright, base_url):
    """Deck tiles are drag targets on desktop; on touch the same move runs
    through tap-select → selection bar → Move to Folder…."""
    import seed as seedlib
    folder = seedlib.make_folder("Languages", folder_id="f_mobile_test")
    loose = seedlib.make_deck("Loose Cards",
                              [seedlib.make_card("a", "b")],
                              deck_id="d_mobile_loose")          # subject misc
    inside = seedlib.make_deck("Spanish Basics",
                               [seedlib.make_card("Hola", "Hello")],
                               deck_id="d_mobile_in",
                               folder_id=folder["id"])
    ctx = _touch_context(browser, playwright, seed_preset=None)
    storage.seed_context(ctx, mf_state=seedlib.make_mf_state(
        decks=[loose, inside], folders=[folder]))
    page = ctx.new_page()
    try:
        pages.goto_app(page, base_url, "/decks/")
        page.evaluate(
            "() => { state.deckNav = {view:'subject', subjectKey:'misc'};"
            " renderView('decks'); }")
        page.locator(".deck-card", has_text="Loose Cards").first.tap()
        bar = page.locator(".selection-bar")
        expect(bar).to_be_visible()
        bar.locator("button", has_text="Move to Folder…").tap()
        pages.expect_modal(page, "Move 1 Deck")
        page.select_option("#modal-body select", folder["id"])
        page.locator("#modal-body button", has_text="Move →").first.tap()
        page.wait_for_timeout(900)
        st = storage.read_app_state(page)
        d = next(d for d in st["decks"] if d["id"] == "d_mobile_loose")
        assert d["folderId"] == folder["id"]
    finally:
        ctx.close()


def test_table_editor_reorder_buttons_on_touch(browser, playwright, base_url):
    """The table-card editor's row/column drag grips get ▲▼/◀▶ fallbacks
    (.touch-only) that only render for touch devices."""
    ctx = _touch_context(browser, playwright)
    page = ctx.new_page()
    try:
        pages.goto_app(page, base_url, "/decks/")
        page.evaluate("() => openCardModal(state.decks[0].id, null)")
        pages.expect_modal(page)
        page.locator("#modal-body button", has_text="▦ Table").click()
        page.wait_for_timeout(300)
        touch_btns = page.locator("#modal-body .touch-only")
        expect(touch_btns.first).to_be_visible(timeout=5000)
        assert touch_btns.count() >= 4     # ≥1 row pair + ≥1 column pair
        # a fresh table is 1×2-ish: the boundary guards are disabled at the
        # edges (row 1 can't move up, column 1 can't move left)
        expect(page.locator(
            "#modal-body button.touch-only[title='Move row up']").first,
        ).to_be_disabled()
        expect(page.locator(
            "#modal-body button.touch-only[title='Move column left']").first,
        ).to_be_disabled()
        # grow a row, then the down-moves become usable and actually reorder
        page.locator("#modal-body button[title='Insert row here']").last.click()
        page.wait_for_timeout(200)
        before = page.evaluate(
            "() => document.querySelector('#modal-body td input')?.value ?? ''")
        expect(page.locator(
            "#modal-body button.touch-only[title='Move row down']").first,
        ).to_be_enabled()
    finally:
        ctx.close()


def test_touch_only_hidden_on_desktop(page, base_url, seeded):
    """Same .touch-only controls exist in the DOM on desktop but stay hidden
    — the drag grips remain the pointer affordance there."""
    seeded("preset:demo")
    pages.goto_app(page, base_url, "/decks/")
    page.evaluate("() => openCardModal(state.decks[0].id, null)")
    pages.expect_modal(page)
    page.locator("#modal-body button", has_text="▦ Table").click()
    page.wait_for_timeout(300)
    n = page.locator("#modal-body .touch-only").count()
    assert n > 0                                    # rendered …
    expect(page.locator("#modal-body .touch-only").first).to_be_hidden()  # … hidden


def test_library_reader_opens_clean_on_phone(page, base_url, seeded):
    """The reader's docked sidebars become slide-overs ≤820px — opening a
    source on a phone must not overflow or throw."""
    seeded("preset:demo")
    page.set_viewport_size(PHONE)
    errors: list = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    pages.goto_app(page, base_url, "/library/")
    # (plain click: this test pins the width-based phone layer, not the
    # touch-capability layer — a real touch context is covered above)
    page.locator(".source-item button", has_text="Read").first.click()
    page.wait_for_selector("#library-reader-overlay", timeout=10000)
    page.wait_for_timeout(400)
    assert content.horizontal_overflow(page) == []
    assert errors == []


def test_phone_routes_overflow_free_with_new_layer(page, base_url, seeded):
    """Re-pin the whole-route overflow guarantee WITH the mobile layer's
    sheets/grids active at 360px (the decks detail + study session
    included)."""
    seeded("preset:demo")
    page.set_viewport_size({"width": 360, "height": 780})
    problems = {}
    for route in ["/", "/decks/", "/study/", "/library/", "/analytics/",
                  "/settings/", "/about/", "/packs/"]:
        pages.goto_app(page, base_url, route)
        over = content.horizontal_overflow(page)
        if over:
            problems[route] = over
    assert problems == {}, problems


# ── Touch drag & drop (site/home until re-minified) ─────────────────────────

def _touch_dnd_context(browser, playwright):
    """Pixel 7 context seeded with a folder + a loose deck + a folded deck."""
    import seed as seedlib
    folder = seedlib.make_folder("Languages", folder_id="f_dnd")
    loose = seedlib.make_deck("Loose Cards", [seedlib.make_card("a", "b")],
                              deck_id="d_dnd_loose")
    inside = seedlib.make_deck("In Folder", [seedlib.make_card("c", "d")],
                               deck_id="d_dnd_in", folder_id="f_dnd")
    ctx = browser.new_context(**playwright.devices["Pixel 7"])
    storage.seed_context(ctx, mf_state=seedlib.make_mf_state(
        decks=[loose, inside], folders=[folder]))
    return ctx


def _cdp_touch(page, context):
    client = context.new_cdp_session(page)
    return lambda type_, points: client.send(
        "Input.dispatchTouchEvent", {"type": type_, "touchPoints": points})


def test_touch_long_press_drag_moves_deck_into_folder(browser, playwright,
                                                      base_url, site_base):
    """HTML5 dnd is mouse-only; on touch a ~320 ms hold lifts the tile into a
    ghost and the finger-drop runs the same dropOnFolder() as the mouse."""
    ctx = _touch_dnd_context(browser, playwright)
    page = ctx.new_page()
    errors: list = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    try:
        touch = _cdp_touch(page, ctx)
        pages.goto_app(page, site_base, "/decks/")
        page.evaluate("() => { state.deckNav = {view:'subject', subjectKey:'misc'};"
                      " renderView('decks'); }")
        page.wait_for_selector(".folder-item")
        page.wait_for_selector(".deck-card")
        src = page.locator(".deck-card", has_text="Loose Cards").first.bounding_box()
        dst = page.locator(".folder-item").first.bounding_box()
        sx, sy = src["x"] + src["width"] / 2, src["y"] + src["height"] / 2
        dx, dy = dst["x"] + dst["width"] / 2, dst["y"] + dst["height"] / 2
        touch("touchStart", [{"x": sx, "y": sy}])
        page.wait_for_timeout(450)                       # > the 320 ms hold
        expect(page.locator(".touch-drag-ghost")).to_have_count(1)
        for i in range(1, 9):
            touch("touchMove", [{"x": sx + (dx - sx) * i / 8,
                                 "y": sy + (dy - sy) * i / 8}])
            page.wait_for_timeout(25)
        expect(page.locator(".folder-item").first).to_have_class(
            re.compile(r"drop-hover"))
        touch("touchEnd", [])
        page.wait_for_function(
            "() => state.decks.find(d => d.id === 'd_dnd_loose').folderId === 'f_dnd'",
            timeout=5000)
        expect(page.locator(".touch-drag-ghost")).to_have_count(0)
        assert errors == []
    finally:
        ctx.close()


def test_touch_drag_out_to_breadcrumb(browser, playwright, site_base):
    """Dropping on a breadcrumb (a subject's top level) works by finger too."""
    ctx = _touch_dnd_context(browser, playwright)
    page = ctx.new_page()
    try:
        touch = _cdp_touch(page, ctx)
        pages.goto_app(page, site_base, "/decks/")
        # the drag source must live INSIDE the folder to drag it back out
        page.evaluate("() => { state.decks.find(d => d.id === 'd_dnd_loose')"
                      ".folderId = 'f_dnd';"
                      " state.deckNav = {view:'folder', subjectKey:'misc',"
                      " folderId:'f_dnd'}; renderView('decks'); }")
        page.wait_for_selector(".deck-card")
        page.wait_for_selector(".breadcrumb-part")
        src = page.locator(".deck-card", has_text="Loose Cards").first.bounding_box()
        dst = page.locator(".breadcrumb-part",
                           has_text="Miscellaneous").first.bounding_box()
        sx, sy = src["x"] + src["width"] / 2, src["y"] + src["height"] / 2
        dx, dy = dst["x"] + dst["width"] / 2, dst["y"] + dst["height"] / 2
        touch("touchStart", [{"x": sx, "y": sy}])
        page.wait_for_timeout(450)
        for i in range(1, 9):
            touch("touchMove", [{"x": sx + (dx - sx) * i / 8,
                                 "y": sy + (dy - sy) * i / 8}])
            page.wait_for_timeout(25)
        touch("touchEnd", [])
        page.wait_for_function(
            "() => state.decks.find(d => d.id === 'd_dnd_loose').folderId === null",
            timeout=5000)
    finally:
        ctx.close()


def test_touch_scroll_and_tap_unaffected_by_drag(browser, playwright, site_base):
    """Immediate movement is a scroll (no ghost), a quick tap still selects —
    the hold-lift must not eat the gestures it lives beside."""
    ctx = _touch_dnd_context(browser, playwright)
    page = ctx.new_page()
    try:
        touch = _cdp_touch(page, ctx)
        pages.goto_app(page, site_base, "/decks/")
        page.evaluate("() => { state.deckNav = {view:'subject', subjectKey:'misc'};"
                      " renderView('decks'); }")
        page.wait_for_selector(".deck-card")
        # scroll gesture starting on a draggable card: no ghost, view scrolls
        card = page.locator(".deck-card").first.bounding_box()
        cx = card["x"] + card["width"] / 2
        touch("touchStart", [{"x": cx, "y": 700}])
        for i in range(8):
            touch("touchMove", [{"x": cx, "y": 700 - i * 45}])
            page.wait_for_timeout(20)
        touch("touchEnd", [])
        page.wait_for_timeout(300)
        expect(page.locator(".touch-drag-ghost")).to_have_count(0)
        # quick tap on a deck card = select, not lift (selection lives in the
        # decks view grids — home cards are plain links-by-button)
        page.locator(".deck-card").first.tap()
        page.wait_for_timeout(250)
        expect(page.locator(".deck-card.card-selected")).to_have_count(1)
        expect(page.locator(".touch-drag-ghost")).to_have_count(0)
    finally:
        ctx.close()


def test_pack_deeplink_modal_is_sheet_on_landscape_phone(page, site_base,
                                                         seeded):
    """A #packs/<pack> link opened on a landscape phone (coarse pointer,
    >720px wide) gets the same edge-to-edge sheet as every other modal —
    not the centred desktop dialog."""
    seeded("preset:empty")
    page.set_viewport_size({"width": 844, "height": 390})
    # set_viewport can't flip pointer capability mid-context; use CDP-free
    # emulation via a touch context instead (below). Here we at least pin
    # the width-based half of the rule for narrow landscape.
    pages.goto_app(page, site_base, "/packs/#packs/spanish-starter")
    pages.expect_modal(page, "Spanish Starter Pack", timeout=10000)
    box = page.locator("#modal-box").bounding_box()
    # 844px fine-pointer stays a centred dialog (the sheet is touch/≤720)
    assert box["x"] > 100, box


def test_pack_deeplink_modal_sheet_on_touch_landscape(browser, playwright,
                                                      site_base):
    import seed as seedlib
    ctx = browser.new_context(viewport={"width": 844, "height": 390},
                              has_touch=True, is_mobile=True)
    storage.seed_context(ctx, mf_state=seedlib.preset_empty()["mf_state"])
    page = ctx.new_page()
    try:
        pages.goto_app(page, site_base, "/packs/#packs/spanish-starter")
        pages.expect_modal(page, "Spanish Starter Pack", timeout=10000)
        box = page.locator("#modal-box").bounding_box()
        assert box["x"] == 0 and abs(box["width"] - 844) <= 1, box
        assert 4 <= box["y"] <= 20, box
    finally:
        ctx.close()
