"""Crucible — the in-house adaptive difficulty system (shared/adaptive-core.js).

Covers the four promises made in Settings → Study & Scheduling:
  1. word-level diffing of intended vs submitted answers,
  2. anomaly filtering (misclicks / abandoned tabs / pastes never train it),
  3. the cold-start gate (no personalisation — multiplier exactly 1.0 —
     until 60 valid global samples and 5 per card),
  4. weak-word driven personalisation + wrong-word highlighting in the
     graded answer view.
"""
import pytest
from playwright.sync_api import expect

import seed as seedlib
from helpers import pages, storage

pytestmark = [pytest.mark.study]


# ── pure-logic units, evaluated in the page ──────────────────────────

def test_diff_words_finds_missing_and_extra(page, base_url, seeded):
    seeded("preset:empty")
    pages.goto_app(page, base_url, "/study/")
    out = page.evaluate("""() => {
      const d = scDiffWords('the powerhouse of the cel', 'the mitochondria is the powerhouse of the cell');
      return { missing: d.missing, extra: d.extra, contentMissing: d.contentMissing,
               recall: d.recall, intended: d.intended };
    }""")
    assert "mitochondria" in out["missing"]
    assert "cell" in out["missing"] or "cel" in out["extra"]
    assert "mitochondria" in out["contentMissing"]
    assert 0 < out["recall"] < 1
    assert out["intended"] == "the mitochondria is the powerhouse of the cell"


def test_anomaly_filter_rejects_bad_samples(page, base_url, seeded):
    seeded("preset:empty")
    pages.goto_app(page, base_url, "/study/")
    out = page.evaluate("""() => {
      const ok  = { cardId: 'c1', rating: 3, answerMs: 4200 };
      const fast = { cardId: 'c1', rating: 3, answerMs: 120 };
      const slow = { cardId: 'c1', rating: 3, answerMs: 700000 };
      const hid  = { cardId: 'c1', rating: 1, answerMs: 5000, hiddenDuringAnswer: true };
      const past = { cardId: 'c1', rating: 4, answerMs: 3000, pasted: true };
      return [ok, fast, slow, hid, past].map(s => scCrucibleFilterSample(s) !== null);
    }""")
    assert out == [True, False, False, False, False]


def test_cold_start_gate_keeps_multiplier_neutral(page, base_url, seeded):
    """Below 60 valid samples EVERY modifier is exactly 1 — a new install
    schedules identically to the base algorithm (no initial bias)."""
    seeded("preset:empty")
    pages.goto_app(page, base_url, "/study/")
    out = page.evaluate("""() => {
      const p = scCrucibleDefaults();
      const card = { id: 'c1', front: 'a very long question '.repeat(12), back: 'answer', type: 'basic' };
      // even a horrific-looking card profile must not move intervals pre-gate
      p.cards['c1'] = { n: 40, conf: 0.05, diff: 0.95, feat: scCardFeatures(card), lastTs: Date.now() };
      const preGate = scCrucibleModifier(p, 'c1', card, 'misc');
      // now cross the global gate with the same card profile
      p.samples = 60;
      const postGate = scCrucibleModifier(p, 'c1', card, 'misc');
      // and a card with too few of its own samples stays neutral post-gate
      const fresh = scCrucibleModifier(p, 'c2', card, 'misc');
      return { preGate, postGate, fresh, calibrated: scCrucibleCalibrated(p) };
    }""")
    assert out["preGate"] == 1
    assert out["fresh"] == 1
    assert out["postGate"] < 1            # hard card now shortens intervals
    assert out["calibrated"] is True


def test_weak_words_need_evidence_and_drive_queue(page, base_url, seeded):
    seeded("preset:empty")
    pages.goto_app(page, base_url, "/study/")
    out = page.evaluate("""() => {
      const p = scCrucibleDefaults();
      p.samples = 100;
      p.vocab = {
        mitochondria: { seen: 6, missed: 4 },   // real weak word
        osmosis:      { seen: 2, missed: 2 },   // too few sightings
        cell:         { seen: 9, missed: 1 },   // rarely missed
      };
      const weak = scCrucibleWeakWords(p).map(w => w.word);
      const weakCard = { id: 'w', front: 'what is the mitochondria role?', back: 'mitochondria power', type: 'basic' };
      const plainCard = { id: 'p', front: 'unrelated question', back: 'unrelated answer', type: 'basic' };
      return { weak,
               wWeak: scCrucibleQueueWeight(p, 'w', weakCard),
               wPlain: scCrucibleQueueWeight(p, 'p', plainCard) };
    }""")
    assert out["weak"] == ["mitochondria"]
    assert out["wWeak"] > out["wPlain"]


def test_record_builds_profile_and_filters(page, base_url, seeded):
    seeded("preset:empty")
    pages.goto_app(page, base_url, "/study/")
    out = page.evaluate("""() => {
      let p = scCrucibleDefaults();
      const card = { id: 'c1', front: 'define osmosis', back: 'water moves down the gradient', type: 'basic' };
      const good = { cardId: 'c1', card, ts: Date.now(), rating: 4, answerMs: 3000,
                     hesitationMs: 400, recall: 1, contentMissingCount: 0, diffWords: [],
                     features: scCardFeatures(card) };
      const bad  = { cardId: 'c1', card, ts: Date.now(), rating: 1, answerMs: 9000,
                     hesitationMs: 3000, recall: 0.4, contentMissingCount: 2,
                     diffWords: [{ intended: 'water moves down the gradient',
                                   missing: ['water', 'gradient'] }],
                     features: scCardFeatures(card) };
      const spam = { cardId: 'c1', card, ts: Date.now(), rating: 3, answerMs: 60 };
      for (let i = 0; i < 3; i++) p = scCrucibleRecord(p, good);
      p = scCrucibleRecord(p, bad);
      p = scCrucibleRecord(p, spam);
      return { samples: p.samples, anomalies: p.anomalies,
               cardN: p.cards['c1'].n,
               gradMissed: p.vocab['gradient'] && p.vocab['gradient'].missed,
               waterMissed: p.vocab['water'] && p.vocab['water'].missed,
               hesitancy: p.baseHesitancy };
    }""")
    assert out["samples"] == 4          # spam rejected
    assert out["anomalies"] == 1
    assert out["cardN"] == pytest.approx(4)
    assert out["gradMissed"] == 1 and out["waterMissed"] == 1
    assert out["hesitancy"] > 0


# ── end-to-end: wrong words get highlighted in the graded view ───────

def test_missed_words_highlighted_in_graded_answer(page, base_url, seeded):
    mf = seedlib.make_mf_state(decks=[
        seedlib.make_deck("Bio", [
            seedlib.make_card("organelle question", "the mitochondria is the powerhouse of the cell",
                              card_id="c_bio")], deck_id="d_bio")])
    mf["settings"] = {"onboarding": {"completed": True, "version": 1},
                      "algorithm": "crucible"}
    seeded(mf_state=mf)
    pages.goto_app(page, base_url, "/study/")
    pages.start_study_mode(page, "Written Quiz")
    page.wait_for_selector(".quiz-input-area")
    page.wait_for_timeout(600)   # humans need >250 ms; the anomaly filter agrees
    box = page.locator(".quiz-input-area").first
    box.fill("the nucleus divides the cell")
    page.wait_for_timeout(150)
    page.get_by_role("button", name="Check Answer").first.click()
    miss = page.locator("#view-study .ans-miss")
    expect(miss.first).to_be_visible()
    marked = miss.all_inner_texts()
    assert any("mitochondria" in m for m in marked), marked
    # rating the card records the review sample into the profile
    rate = page.get_by_role("button", name="Wrong", exact=True)
    if rate.count() == 0:
        rate = page.locator(".rating-btn", has_text="Again").first
    rate.click()
    rec = page.evaluate("() => ({ samples: state.adaptive.samples, "
                        "vocab: Object.keys(state.adaptive.vocab).length, "
                        "algo: state.settings.algorithm })")
    assert rec["algo"] == "crucible"
    assert rec["samples"] == 1
    assert rec["vocab"] >= 1


# ── settings surface ─────────────────────────────────────────────────

def test_settings_offers_crucible_and_profile_card(page, base_url, seeded):
    seeded("preset:empty")
    pages.goto_app(page, base_url, "/settings/")
    opts = page.locator("select[aria-label='SRS scheduling algorithm'] option").all_inner_texts()
    assert any("Crucible" in o for o in opts), opts
    card = page.locator("#view-settings .card", has_text="Study & Scheduling").first
    expect(card).to_contain_text("Learning profile (Crucible)")
    expect(card).to_contain_text("calibrating")
    expect(card).to_contain_text("Personalisation stays off until 60 valid reviews")
