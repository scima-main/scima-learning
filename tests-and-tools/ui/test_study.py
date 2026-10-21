"""Study page: picker, SRS session (reveal/rate/progress/exit), cram,
written quiz, multiple choice, session restore across reload."""
import re

import pytest
from playwright.sync_api import expect

import seed as seedlib
from helpers import pages

pytestmark = [pytest.mark.study]

# demo seed → all-decks scope: 7 cards total, 5 due
# (Spanish Basics: 4 new due now; Biology: 1 due review + 2 future)
DUE_TOTAL, ALL_TOTAL = 5, 7

# The session queue is SHUFFLED (study.js: sort(() => Math.random() - 0.5)),
# so every test reads the card actually on screen and looks up its answer.
KNOWN = {
    "Which organelle performs photosynthesis?": "Chloroplast",
    "Which organelle is the powerhouse of the cell?": "Mitochondria",
    "What is the basic unit of life?": "The cell",
    "Hello": "Hola", "Goodbye": "Adiós", "Thank you": "Gracias", "Water": "El agua",
}


def current_card(page):
    """(front, back) of the card currently on screen."""
    front = page.locator(".flashcard-front-text").inner_text().strip()
    assert front in KNOWN, f"unexpected card front: {front!r}"
    return front, KNOWN[front]


def goto_study(page, base_url, seeded, preset="preset:demo"):
    seeded(preset)
    pages.goto_app(page, base_url, "/study/")
    return page


def test_picker_shows_all_six_modes(page, base_url, seeded):
    goto_study(page, base_url, seeded)
    expect(page.locator("#view-study")).to_contain_text("Study Mode")
    for mode in pages.STUDY_MODES:
        expect(page.locator("#view-study .card", has_text=mode).first).to_be_visible()
    # scope summary reflects the seed
    expect(page.locator("#view-study")).to_contain_text(
        f"{ALL_TOTAL} total cards · {DUE_TOTAL} due")


def test_picker_empty_scope_disables_start(page, base_url, seeded):
    """No decks at all → every mode's Start button is disabled."""
    goto_study(page, base_url, seeded, "preset:empty")
    expect(page.locator("#view-study")).to_contain_text("0 total cards · 0 due")
    start = page.locator("#view-study .card", has_text="SRS Review").get_by_role(
        "button", name="Start", exact=True)
    expect(start).to_be_disabled()


def test_srs_session_full_flow(page, base_url, seeded):
    """Start → Reveal → rate Good → progress advances → Exit → picker."""
    goto_study(page, base_url, seeded)
    page.click("#tutorial-target-study-start")   # stable id on SRS Review's Start

    # card 1 of 5, front side
    expect(page.locator(".flashcard.front")).to_be_visible()
    front, back = current_card(page)
    assert pages.session_progress(page) == (1, DUE_TOTAL)
    assert pages.rating_buttons(page).count() == 0   # hidden until revealed

    pages.reveal(page)
    expect(page.locator(".flashcard.back")).to_be_visible()
    expect(page.locator(".flashcard.back")).to_contain_text(back)
    for label in ("Again", "Hard", "Good", "Easy"):
        expect(page.locator(".rating-btn", has_text=label).first).to_be_visible()

    pages.rate(page, "Good")
    expect(page.locator(".flashcard")).to_be_visible(timeout=5000)
    assert pages.session_progress(page) == (2, DUE_TOTAL)

    pages.exit_session(page)
    expect(page.locator("#view-study")).to_contain_text("Study Mode")
    assert not pages.study_session_active(page)


def test_rating_advances_scheduling(page, base_url, seeded):
    """Rating Good pushes the card's due date into the future (SRS works)."""
    goto_study(page, base_url, seeded)
    page.click("#tutorial-target-study-start")
    front, _ = current_card(page)
    js = ("() => state.decks.flatMap(d=>d.cards).find(c=>c.front===%s)"
          % __import__("json").dumps(front))
    before = page.evaluate(js)
    pages.reveal(page)
    pages.rate(page, "Good")
    page.wait_for_timeout(1200)          # let scheduleSave() flush

    after = page.evaluate(js)
    assert after["due"] > before["due"]
    assert after["reps"] == before["reps"] + 1
    assert after["due"] > seedlib.now_ms()      # no longer due now


def test_cram_mode_ignores_due_dates(page, base_url, seeded):
    goto_study(page, base_url, seeded)
    pages.start_study_mode(page, "Cram Mode")
    expect(page.locator(".flashcard")).to_be_visible()
    assert pages.session_progress(page)[1] == ALL_TOTAL   # all 7, due or not


def test_written_quiz_correct_answer(page, base_url, seeded):
    """Type the right answer → Check Answer → 'Correct!' feedback."""
    goto_study(page, base_url, seeded)
    pages.start_study_mode(page, "Written Quiz")

    box = page.locator(".quiz-input-area").first
    expect(box).to_be_visible()
    front, back = current_card(page)
    box.fill(back)
    page.get_by_role("button", name=re.compile(r"Check Answer")).click()
    expect(page.locator("#view-study")).to_contain_text("Correct!", timeout=5000)


def test_multiple_choice_marks_option(page, base_url, seeded):
    """MC shows question + 4 options; clicking the true answer auto-rates
    (Easy) after ~450ms and advances to the next card."""
    goto_study(page, base_url, seeded)
    pages.start_study_mode(page, "Multiple Choice")

    expect(page.locator("#view-study")).to_contain_text("QUESTION")
    options = page.locator("#view-study button.btn-ghost[style*='text-align']")
    expect(options).to_have_count(4)
    assert pages.session_progress(page) == (1, ALL_TOTAL)

    front, back = current_card(page)
    options.filter(has_text=re.compile(f"^{re.escape(back)}$")).first.click()

    # newer builds wait for an explicit Next; older minified bundles still
    # auto-advance — accept either, then assert we're on card 2
    nxt = page.get_by_role("button", name=re.compile(r"^(Next|Finish) →$"))
    if nxt.count():
        nxt.first.click()
    expect(page.locator("#view-study span",
                        has_text=re.compile(r"^2 / 7$")).first).to_be_visible(timeout=8000)


def test_hint_button_matches_card(page, base_url, seeded):
    """The hint button is enabled iff the current card actually has a hint."""
    goto_study(page, base_url, seeded)
    page.click("#tutorial-target-study-start")
    front, _ = current_card(page)
    has_hint = page.evaluate(
        "() => !!studySession.queue[studySession.idx].hint")
    hint = page.get_by_role("button", name=re.compile(r"Hint"))
    expect(hint).to_be_visible()
    if has_hint:
        expect(hint).to_be_enabled()
    else:
        expect(hint).to_be_disabled()


def test_session_survives_reload(page, base_url, seeded):
    """The per-page sessionStorage memory restores an active session."""
    goto_study(page, base_url, seeded)
    page.click("#tutorial-target-study-start")
    expect(page.locator(".flashcard.front")).to_be_visible()

    page.reload(wait_until="load")
    pages.app_ready(page)
    expect(page.locator(".flashcard")).to_be_visible(timeout=8000)
    assert pages.study_session_active(page)


def test_refine_stale_subset(page, base_url, seeded):
    """🎯 Refine → 'Least recently studied' + N=2 narrows the queue."""
    goto_study(page, base_url, seeded)
    page.select_option("#view-study select", "stale")
    n_input = page.locator("#view-study input[type='number']").first
    n_input.fill("2")
    n_input.dispatch_event("change")
    expect(page.locator("#view-study")).to_contain_text("2 of 7 cards selected")


def test_quiz_feedback_renders_latex(page, site_base, seeded):
    """The written-quiz compare panel must render the expected answer as
    rich text (KaTeX), not plain source — site/home until re-minified."""
    card = seedlib.make_card("What is $\\sqrt{16}$?", "$2\\pi r^2$ watts",
                             card_id="c_latex")
    deck = seedlib.make_deck("Latex", [card], deck_id="d_latex")
    seeded(mf_state=seedlib.make_mf_state(decks=[deck]))
    pages.goto_app(page, site_base, "/study/")
    page.locator("#view-study .card", has_text="Written Quiz") \
        .get_by_role("button", name="Start").click()
    page.wait_for_selector(".quiz-input-area")
    page.fill(".quiz-input-area", "wrong answer")
    page.get_by_role("button", name=re.compile("Check Answer")).click()
    page.wait_for_selector(".quiz-compare")
    expect(page.locator(".quiz-compare .katex").first).to_be_visible(
        timeout=8000)
    assert "$" not in page.locator(
        ".quiz-compare .quiz-answer-text").inner_text()


def test_gap_missing_words_render_latex(page, site_base, seeded):
    """Same guarantee for the Fill-in-the-Gaps missing-words list."""
    card = seedlib.make_card("Name the formula", "area is $\\pi r^2$ always",
                             card_id="c_gap")
    deck = seedlib.make_deck("Latex", [card], deck_id="d_latex2")
    seeded(mf_state=seedlib.make_mf_state(decks=[deck]))
    pages.goto_app(page, site_base, "/study/")
    page.locator("#view-study .card", has_text="Fill in the Gaps") \
        .get_by_role("button", name="Start").click()
    page.wait_for_selector(".quiz-input-area")
    page.fill(".quiz-input-area", "wrong")
    page.get_by_role("button", name=re.compile("Check Answer")).click()
    page.wait_for_selector(".quiz-compare")
    expect(page.locator(".quiz-compare .katex").first).to_be_visible(
        timeout=8000)


# ── Quiz parameters: type filter, card limit, global clock, exam mode, ──────
# ── multi-answer required override (site/home until re-minified) ────────────

def _multi_state():
    cards = []
    for i in range(7):
        c = seedlib.make_card(f"Name four {i}", "placeholder", card_id=f"cm{i}")
        c["answerCount"] = 4
        c["requiredAnswers"] = 4
        c["back"] = "alpha\nbeta\ngamma\ndelta"
        cards.append(c)
    for i in range(3):
        cards.append(seedlib.make_card(f"Basic {i}", "single", card_id=f"cb{i}"))
    return seedlib.make_mf_state(
        decks=[seedlib.make_deck("Mix", cards, deck_id="d_mix")])


def _set_qp(page, **kw):
    page.evaluate("(v) => { state.settings.quizParams = Object.assign("
                  "{types:[],limit:0,timeLimitMin:0,exam:false,multiRequired:0,"
                  "shuffle:true}, v); }", kw)


def test_quiz_params_filter_limit_and_override(page, site_base, seeded):
    seeded(mf_state=_multi_state())
    pages.goto_app(page, site_base, "/study/")
    _set_qp(page, types=["multi"], limit=5, multiRequired=2)
    page.evaluate("() => renderView('study')")
    expect(page.locator("#view-study")).to_contain_text("5 cards in queue")
    page.locator("#view-study .card", has_text="Written Quiz") \
        .get_by_role("button", name="Start").click()
    page.wait_for_selector(".quiz-input-area")
    sess = page.evaluate("() => ({n: studySession.queue.length,"
                         " multi: studySession.queue.every(c => (c.answerCount||1) > 1),"
                         " mr: studySession.multiRequired})")
    assert sess == {"n": 5, "multi": True, "mr": 2}, sess
    # override caps the boxes at 2 instead of the card's own 4
    assert page.locator(".quiz-input-area").count() == 2


def test_exam_mode_navigates_and_reveals_at_end(page, site_base, seeded):
    seeded(mf_state=_multi_state())
    pages.goto_app(page, site_base, "/study/")
    _set_qp(page, types=["multi"], limit=3, exam=True, multiRequired=2,
            timeLimitMin=5)
    page.evaluate("() => renderView('study')")
    page.locator("#view-study .card", has_text="Written Quiz") \
        .get_by_role("button", name="Start").click()
    page.wait_for_selector(".quiz-input-area")
    # global clock in the progress row
    expect(page.locator("#view-study span", has_text="⏱")).to_be_visible()
    # save, move on, come back — answer prefilled, no feedback shown
    page.locator(".quiz-input-area").first.fill("alpha")
    page.get_by_role("button", name="💾 Save answer").click()
    expect(page.locator("#toast")).to_contain_text("Answer saved")
    expect(page.locator(".quiz-compare")).to_be_hidden()
    page.get_by_role("button", name="Next →").click()
    page.get_by_role("button", name="← Prev").click()
    assert page.locator(".quiz-input-area").first.input_value() == "alpha"
    # finish grades everything and reveals the per-card list
    page.get_by_role("button", name="🏁 Finish & reveal").click()
    expect(page.locator("#view-study")).to_contain_text("Session Complete!")
    expect(page.locator("#view-study")).to_contain_text("Answers revealed")
    expect(page.locator("#view-study")).to_contain_text("Your answer:")
    log = page.evaluate("() => state.sessionLog[0]")
    assert log["exam"] is True and log["timeLimitSec"] == 300
    assert len(log["answers"]) == 3
    assert log["answers"][0]["ok"] is True        # alpha matched, 2 required
    assert sum(1 for a in log["answers"] if a["ok"] is False) == 2
    # the two unanswered cards are repeatable as "wrong"
    page.get_by_role("button", name="New Session").click()
    page.click("#session-history-toggle")
    expect(page.locator("#session-history-panel button",
                        has_text="Repeat wrong (2)")).to_be_visible()


def test_global_time_limit_ends_session(page, site_base, seeded):
    seeded(mf_state=_multi_state())
    pages.goto_app(page, site_base, "/study/")
    _set_qp(page, limit=3, timeLimitMin=1)   # clock exists from start…
    page.evaluate("() => renderView('study')")
    page.locator("#view-study .card", has_text="Written Quiz") \
        .get_by_role("button", name="Start").click()
    page.wait_for_selector(".quiz-input-area")
    page.evaluate("() => { studySession.timeLimitSec = 2; }")   # …then shortened
    page.wait_for_function("() => !studySession || !studySession.active",
                           timeout=8000)
    expect(page.locator("#view-study")).to_contain_text("Session Complete!")


def test_exam_inputs_clear_on_new_card_and_restore_cached(page, site_base,
                                                          seeded):
    """Navigation must never bleed one question's typing into the next, and
    each card's own cached/saved answers come back when you return."""
    seeded(mf_state=_multi_state())
    pages.goto_app(page, site_base, "/study/")
    _set_qp(page, types=["multi"], exam=True, multiRequired=2, shuffle=False)
    page.evaluate("() => renderView('study')")
    page.locator("#view-study .card", has_text="Written Quiz") \
        .get_by_role("button", name="Start").click()
    page.wait_for_selector(".quiz-input-area")
    vals = lambda: page.evaluate(
        "() => [...document.querySelectorAll('.quiz-input-area')]"
        ".map(i => i.value)")
    # type on Q1 WITHOUT saving, move on: Q2's boxes are clear
    page.locator(".quiz-input-area").first.fill("alpha")
    page.locator(".quiz-input-area").nth(1).fill("beta")
    page.get_by_role("button", name="Next →").click()
    page.wait_for_timeout(200)
    assert vals() == ["", ""], vals()
    # …and coming back restores the auto-cached typing
    page.get_by_role("button", name="← Prev").click()
    page.wait_for_timeout(200)
    assert vals() == ["alpha", "beta"], vals()
    # explicit save, wander two cards, return: still restored, and only the
    # answered card counts as recorded
    page.get_by_role("button", name="💾 Save answer").click()
    page.get_by_role("button", name="Next →").click()
    page.get_by_role("button", name="Next →").click()
    page.wait_for_timeout(200)
    assert vals() == ["", ""]
    page.get_by_role("button", name="← Prev").click()
    page.get_by_role("button", name="← Prev").click()
    page.wait_for_timeout(200)
    assert vals() == ["alpha", "beta"]
    assert page.evaluate("() => Object.keys(studySession.recorded)") == \
        [page.evaluate("() => studySession.queue[0].id")]
