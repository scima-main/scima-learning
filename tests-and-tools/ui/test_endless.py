"""Endless Drill study method — chunked & unchunked varieties.

Per chunk the session runs three passes (multiple choice → fill in the
gaps → written quiz); within a pass only missed cards repeat until each
card was correct at least once; after the last chunk's written pass the
session enters an endless written loop until Finish/Exit. It is a drill:
no rescheduling, no XP — but Crucible samples are still recorded.
"""
import pytest
from playwright.sync_api import expect

import seed as seedlib
from helpers import pages, storage

pytestmark = [pytest.mark.study]

CARDS = [
    ("capital of France", "Paris"),
    ("capital of Italy", "Rome"),
    ("capital of Spain", "Madrid"),
    ("capital of Germany", "Berlin"),
]


def _seed_capitals(seeded, n=4, settings=None):
    cards = [seedlib.make_card(f, b, card_id=f"c_{i}") for i, (f, b) in enumerate(CARDS[:n])]
    mf = seedlib.make_mf_state(decks=[seedlib.make_deck("Geo", cards, deck_id="d_geo")])
    mf["settings"] = {"onboarding": {"completed": True, "version": 1}}
    if settings:
        mf["settings"].update(settings)
    seeded(mf_state=mf)


def _label(page):
    return page.locator("#view-study span", has_text="Endless ·").first.inner_text()


def _question(page):
    return page.locator("#view-study .flashcard-front-text").first.inner_text()


def _next(page):
    b = page.get_by_role("button", name="Next")
    if b.count() == 0:
        b = page.get_by_role("button", name="Finish")
    b.first.click()


def test_picker_shows_full_width_endless_row(page, base_url, seeded):
    _seed_capitals(seeded)
    pages.goto_app(page, base_url, "/study/")
    card = page.locator("#view-study .card", has_text="Endless Drill").first
    expect(card).to_be_visible()
    expect(card.get_by_role("button", name="Start chunked")).to_be_enabled()
    expect(card.get_by_role("button", name="Start unchunked")).to_be_enabled()
    widths = page.evaluate("""() => {
      const cards = [...document.querySelectorAll('#view-study .grid-3 > .card')];
      const endless = cards.find(c => c.textContent.includes('Endless Drill'));
      const normal = cards.find(c => c !== endless);
      return { endless: endless.offsetWidth, normal: normal.offsetWidth };
    }""")
    assert widths["endless"] > 2.5 * widths["normal"], widths


def test_unchunked_runs_mc_gaps_written_then_endless_loop(page, base_url, seeded):
    _seed_capitals(seeded)
    pages.goto_app(page, base_url, "/study/")
    page.locator("#view-study .card", has_text="Endless Drill").first \
        .get_by_role("button", name="Start unchunked").click()
    page.wait_for_selector("#view-study .flashcard-front-text")
    assert "Multiple choice" in _label(page)

    # MC pass: miss the first card on purpose, then clear the rest; the miss
    # must come back in round 2 before the phase can advance.
    front = _question(page)
    expected = dict(CARDS)[front]
    wrong = page.locator("#view-study .flashcard.front ~ div button, #view-study button.btn-ghost",
                         has_text="Rome" if expected != "Rome" else "Paris").first
    wrong.click()
    _next(page)
    for _ in range(3):
        f = _question(page)
        page.get_by_role("button", name=dict(CARDS)[f], exact=True).first.click()
        _next(page)
    assert "round 2" in _label(page) and "Multiple choice" in _label(page)
    f = _question(page)
    assert f == front, "the missed card must be the one repeating"
    page.get_by_role("button", name=dict(CARDS)[f], exact=True).first.click()
    _next(page)
    assert "Fill in the gaps" in _label(page)

    # Gaps pass: single-word answers, all correct first time
    for _ in range(4):
        f = _question(page)
        page.wait_for_selector(".quiz-input-area")
        page.fill(".quiz-input-area", dict(CARDS)[f])
        page.get_by_role("button", name="Check Answer").first.click()
        page.get_by_role("button", name="Got it").first.click()
    assert "Written quiz" in _label(page)

    # Written pass → unchunked scope done → endless written loop
    for _ in range(4):
        f = _question(page)
        page.wait_for_selector(".quiz-input-area")
        page.fill(".quiz-input-area", dict(CARDS)[f])
        page.get_by_role("button", name="Check Answer").first.click()
        page.get_by_role("button", name="Got it").first.click()
    label = _label(page)
    assert "Endless written loop" in label and "cycle 1" in label

    # the loop keeps serving cards until the user exits
    f = _question(page)
    page.wait_for_selector(".quiz-input-area")
    page.fill(".quiz-input-area", dict(CARDS)[f])
    page.get_by_role("button", name="Check Answer").first.click()
    page.get_by_role("button", name="Got it").first.click()
    assert "Endless written loop" in _label(page)
    page.get_by_role("button", name="Exit").click()
    expect(page.locator("#view-study", has_text="Study Mode")).to_be_visible()


def test_chunked_variants_chunk_the_scope(page, base_url, seeded):
    _seed_capitals(seeded, n=4, settings={"endlessChunk": 5})
    pages.goto_app(page, base_url, "/study/")
    picker = page.locator("#view-study .card", has_text="Endless Drill").first
    picker.locator("select[aria-label='Endless chunk size']").select_option("5")
    picker.get_by_role("button", name="Start chunked").click()
    page.wait_for_selector("#view-study .flashcard-front-text")
    st = page.evaluate("""() => ({ variant: studySession.endless.variant,
        chunks: studySession.endless.chunks.length,
        size: studySession.endless.chunkSize,
        queue: studySession.queue.length,
        chunk: studySession.settings ? 0 : studySession.endless.chunkIdx })""")
    assert st["variant"] == "chunked"
    assert st["size"] == 5
    assert st["chunks"] == 1          # 4 cards ÷ 5 → a single chunk
    assert st["queue"] == 4
    assert "chunk 1/1" in _label(page)
    page.get_by_role("button", name="Exit").click()

    # six cards with chunk size 5 → two chunks
    cards = [seedlib.make_card(f, b, card_id=f"c_{i}") for i, (f, b) in enumerate(CARDS)]
    cards += [seedlib.make_card("capital of Poland", "Warsaw", card_id="c_4"),
              seedlib.make_card("capital of Greece", "Athens", card_id="c_5")]
    mf = seedlib.make_mf_state(decks=[seedlib.make_deck("Geo", cards, deck_id="d_geo")])
    mf["settings"] = {"onboarding": {"completed": True, "version": 1}, "endlessChunk": 5}
    storage.seed_page(page, mf_state=mf)
    page.reload(wait_until="load")     # full reload: hash-only goto is same-document
    page.wait_for_timeout(600)
    page.locator("#view-study .card", has_text="Endless Drill").first \
        .get_by_role("button", name="Start chunked").click()
    page.wait_for_selector("#view-study .flashcard-front-text")
    st = page.evaluate("() => ({ chunks: studySession.endless.chunks.length, queue: studySession.queue.length })")
    assert st["chunks"] == 2 and st["queue"] == 5
    assert "chunk 1/2" in _label(page)


def test_endless_xp_full_then_half_no_reschedule(page, base_url, seeded):
    """First correct per card per pass type pays full XP; the endless written
    loop (same type as the written pass) pays half. Schedules stay frozen."""
    _seed_capitals(seeded)
    pages.goto_app(page, base_url, "/study/")
    snap = "() => JSON.stringify(state.decks[0].cards.map(c => [c.interval, c.due, c.ease, c.reps]))"
    sched_before = page.evaluate(snap)
    full = page.evaluate("() => calcCardXP(state.decks[0].cards[0], 4)")
    xp = lambda: page.evaluate("() => state.trackerState.totalXP")

    page.locator("#view-study .card", has_text="Endless Drill").first \
        .get_by_role("button", name="Start unchunked").click()
    page.wait_for_selector("#view-study .flashcard-front-text")
    page.wait_for_timeout(600)
    x0 = xp()
    f = _question(page)
    page.get_by_role("button", name=dict(CARDS)[f], exact=True).first.click()
    _next(page)
    assert xp() - x0 == pytest.approx(full), "first MC correct pays full XP"

    # clear the MC pass, then gaps, then written → endless loop
    for _ in range(3):
        f = _question(page)
        page.get_by_role("button", name=dict(CARDS)[f], exact=True).first.click()
        _next(page)
    for _pass in range(2):
        for _ in range(4):
            f = _question(page)
            page.wait_for_selector(".quiz-input-area")
            page.wait_for_timeout(300)
            page.fill(".quiz-input-area", dict(CARDS)[f])
            page.get_by_role("button", name="Check Answer").first.click()
            page.get_by_role("button", name="Got it").first.click()
    assert "Endless written loop" in _label(page)

    # endless loop = written type, already paid once per card → half XP
    x1 = xp()
    f = _question(page)
    page.wait_for_selector(".quiz-input-area")
    page.wait_for_timeout(300)
    page.fill(".quiz-input-area", dict(CARDS)[f])
    page.get_by_role("button", name="Check Answer").first.click()
    page.get_by_role("button", name="Got it").first.click()
    assert xp() - x1 == pytest.approx(full / 2), "endless-loop correct pays half XP"

    assert page.evaluate(snap) == sched_before, "endless never reschedules"
    assert page.evaluate("() => state.adaptive.samples") >= 5


def _exit_and_open_history(page):
    page.get_by_role("button", name="Exit").click()
    page.wait_for_timeout(300)
    page.locator("#session-history-toggle").click()
    page.wait_for_timeout(200)


def test_endless_resume_rebuilds_phase_machine(page, base_url, seeded):
    _seed_capitals(seeded)
    pages.goto_app(page, base_url, "/study/")
    page.locator("#view-study .card", has_text="Endless Drill").first \
        .get_by_role("button", name="Start unchunked").click()
    page.wait_for_selector("#view-study .flashcard-front-text")
    # answer two of four MC cards correctly, then bail mid-phase
    for _ in range(2):
        page.wait_for_timeout(400)
        f = _question(page)
        page.get_by_role("button", name=dict(CARDS)[f], exact=True).first.click()
        _next(page)
    answered = page.evaluate("() => Object.keys(studySession._xpGranted || {})")
    _exit_and_open_history(page)

    row = page.locator("#session-history-panel .card", has_text="Endless").first
    expect(row).to_be_visible()
    row.get_by_role("button", name="Resume").click()
    page.wait_for_selector("#view-study .flashcard-front-text")
    st = page.evaluate("""() => ({ mode: studySession.mode, phase: studySession.endless.phase,
        queue: studySession.queue.length, idx: studySession.idx,
        correct: studySession.stats.correct,
        xpKeys: Object.keys(studySession._xpGranted || {}),
        label: document.querySelector('#view-study .ui-action-bar span').textContent })""")
    assert st["mode"] == "endless" and st["phase"] == "mc"
    assert st["queue"] == 4 and st["idx"] == 2          # pending list + walk position restored
    assert st["correct"] == 2                            # stats carried over
    assert sorted(st["xpKeys"]) == sorted(answered)      # XP grants not re-paid
    assert "Multiple choice" in st["label"] and "round 1" in st["label"]

    # finishing the resumed MC pass advances to gaps as usual
    for _ in range(2):
        page.wait_for_timeout(400)
        f = _question(page)
        page.get_by_role("button", name=dict(CARDS)[f], exact=True).first.click()
        _next(page)
    assert "Fill in the gaps" in _label(page)


def test_endless_repeat_restarts_from_scratch(page, base_url, seeded):
    _seed_capitals(seeded)
    pages.goto_app(page, base_url, "/study/")
    page.locator("#view-study .card", has_text="Endless Drill").first \
        .get_by_role("button", name="Start unchunked").click()
    page.wait_for_selector("#view-study .flashcard-front-text")
    page.wait_for_timeout(400)
    f = _question(page)
    page.get_by_role("button", name=dict(CARDS)[f], exact=True).first.click()
    _next(page)
    _exit_and_open_history(page)
    row = page.locator("#session-history-panel .card", has_text="Endless").first
    row.get_by_role("button", name="Repeat", exact=True).click()
    page.wait_for_selector("#view-study .flashcard-front-text")
    st = page.evaluate("""() => ({ phase: studySession.endless.phase,
        queue: studySession.queue.length, done: Object.keys(studySession.endless.done).length,
        xp: Object.keys(studySession._xpGranted || {}).length,
        correct: studySession.stats.correct })""")
    assert st["phase"] == "mc" and st["queue"] == 4
    assert st["done"] == 0 and st["xp"] == 0 and st["correct"] == 0
