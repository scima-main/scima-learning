"""The hidden /games/ Arcade: chart runner, list+inspector editor MVP,
share strings (skeletal + deflated), remix attribution, and gamekit.py
CLI parity. Pre-launch page → tests run against site/home (`site_base`).
"""
import json
import subprocess
import sys
from pathlib import Path

import pytest
from playwright.sync_api import expect

from helpers import content, pages

pytestmark = [pytest.mark.content]
GAMEKIT = Path(__file__).resolve().parents[1] / "gamekit.py"


def goto_games(page, site_base, seeded, preset="preset:demo"):
    seeded(preset)
    pages.goto_app(page, site_base, "/games/")
    return page


def kit(*args):
    return subprocess.run([sys.executable, str(GAMEKIT), *args],
                          capture_output=True, text=True, check=True)


# ── route & discovery ─────────────────────────────────────────────────────

def test_games_route_hidden_from_nav(page, site_base, seeded):
    goto_games(page, site_base, seeded)
    expect(page.locator("#view-games")).to_be_visible()
    expect(page.locator("#view-games")).to_contain_text("Arcade")
    page.click("#logo-icon")
    expect(page.locator("#nav .nav-btn[data-view='games']")).to_have_count(0)


def test_robots_disallows_games(site_base):
    import urllib.request
    with urllib.request.urlopen(site_base + "/robots.txt", timeout=5) as r:
        assert "Disallow: /games/" in r.read().decode()


# ── playing ────────────────────────────────────────────────────────────────

def test_pi_recall_play_and_lives(page, site_base, seeded):
    goto_games(page, site_base, seeded, "preset:empty")
    page.locator(".card", has_text="Pi Recall").first.get_by_role("button", name="▶ Play").click()
    box = page.locator("#game-controls input")
    expect(box).to_be_visible()
    for ch in "1415":
        box.type(ch, delay=20)
    expect(page.locator("#game-hud")).to_contain_text("⭐ 4")
    box.type("0", delay=20)                     # π continues …926535 — '0' is wrong
    expect(page.locator("#game-hud")).to_contain_text("❤ 2")
    box.type("0", delay=20)
    box.type("0", delay=20)
    expect(page.locator("#game-stage")).to_contain_text("Out of lives", timeout=5000)
    expect(page.locator("#game-stage")).to_contain_text("Score 4")


def test_playtest_from_editor_uses_current_chart(page, site_base, seeded):
    goto_games(page, site_base, seeded, "preset:empty")
    page.get_by_role("button", name="✏ Editor").click()
    page.get_by_role("button", name="▶ Playtest").click()
    expect(page.locator("#game-controls input")).to_be_visible()


# ── editor MVP ─────────────────────────────────────────────────────────────

def test_editor_list_inspector_and_json(page, site_base, seeded):
    goto_games(page, site_base, seeded, "preset:empty")
    page.get_by_role("button", name="✏ Editor").click()
    rows = page.locator("#view-games .card [role='button'][aria-label^='Edit object']")
    expect(rows).to_have_count(6)                       # pi-recall built-in

    page.get_by_role("button", name="+ Object").click()
    expect(page.locator("#view-games .card [role='button'][aria-label^='Edit object']")
           ).to_have_count(7)

    page.locator("[role='button'][aria-label*='rule.lives']").first.click()
    page.locator("input[aria-label='Life count']").fill("5")
    page.locator("input[aria-label='Life count']").dispatch_event("change")
    expect(page.locator("#view-games")).to_contain_text("lives=5")

    page.get_by_role("button", name="JSON").click()
    assert '"lives": 5' in page.locator(
        "textarea[aria-label='Game JSON or share string']").input_value()


# ── share strings ──────────────────────────────────────────────────────────

def test_share_string_roundtrip_installs(page, site_base, seeded):
    goto_games(page, site_base, seeded, "preset:empty")
    page.locator(".card", has_text="Pi Sudden Shift").first.get_by_role(
        "button", name="Share").click()
    box = page.locator("textarea[aria-label='Game JSON or share string']")
    share = box.input_value()
    assert share.startswith("SCIMAGAME1-")

    box.fill("")
    box.fill(share)
    page.get_by_role("button", name="⬇ Import from box").click()
    expect(page.locator("#view-games")).to_contain_text("Installed", timeout=5000)
    page.get_by_role("button", name="▶ Play").first.click()   # back to library
    expect(page.locator(".card", has_text="Pi Sudden Shift")).to_have_count(2)  # builtin + installed


def test_share_string_cross_implementation(page, site_base, seeded, tmp_path):
    """CLI-encoded strings decode in the browser and vice versa (deflate
    levels differ, so parity is at decode level, not byte level)."""
    chart = json.loads(kit("new", "CLI Pi").stdout)
    f = tmp_path / "cli.json"
    f.write_text(json.dumps(chart), encoding="utf-8")
    cli_share = kit("share", str(f)).stdout.strip()

    goto_games(page, site_base, seeded, "preset:empty")
    page.get_by_role("button", name="⇄ Import / Export").click()
    box = page.locator("textarea[aria-label='Game JSON or share string']")
    box.fill(cli_share)                                  # browser decodes CLI string
    page.get_by_role("button", name="⬇ Import from box").click()
    expect(page.locator("#view-games")).to_contain_text("Installed", timeout=5000)

    page.get_by_role("button", name="▶ Play").first.click()
    page.locator(".card", has_text="CLI Pi").first.get_by_role("button", name="Share").click()
    browser_share = box.input_value()
    decoded = json.loads(kit("unshare", browser_share).stdout)   # CLI decodes browser string
    assert decoded["game"]["name"] == "CLI Pi"
    assert len(decoded["game"]["objects"]) == len(chart["game"]["objects"])


# ── remix attribution ──────────────────────────────────────────────────────

def test_remix_attribution_chain(page, site_base, seeded):
    envelope = {
        "$schema": "scima", "schema": "share", "schemaVersion": 1, "kind": "game",
        "game": {
            "name": "Someone's Pi", "version": "1.0.0",
            "attribution": [{"name": "Ada", "role": "creator", "hash": "aa" * 32}],
            "objects": [
                {"t": "prompt.stream", "step": 0, "props": {"source": "constant:pi.decimals"}},
                {"t": "input.typed", "step": 0},
                {"t": "match.prefix", "step": 0},
                {"t": "rule.lives", "step": 0, "props": {"lives": 3}},
                {"t": "rule.end", "step": 0},
            ]}}
    goto_games(page, site_base, seeded, "preset:empty")
    page.get_by_role("button", name="⇄ Import / Export").click()
    box = page.locator("textarea[aria-label='Game JSON or share string']")
    box.fill(json.dumps(envelope))
    page.get_by_role("button", name="⬇ Import from box").click()
    expect(page.locator("#view-games")).to_contain_text("Installed", timeout=5000)

    page.get_by_role("button", name="⑂ Fork selected into editor").click()
    page.locator("input[aria-label='Author name for attribution']").fill("Bo")
    page.get_by_role("button", name="💾 Save").click()
    expect(page.locator("#view-games")).to_contain_text("Ada", timeout=5000)
    expect(page.locator("#view-games")).to_contain_text("Bo (remix)")


# ── gamekit CLI ────────────────────────────────────────────────────────────

def test_gamekit_validate_add_hash_remix(tmp_path):
    chart = json.loads(kit("new", "Kit Game", "--by", "Ada").stdout)
    f = tmp_path / "g.json"
    f.write_text(json.dumps(chart), encoding="utf-8")
    assert "✓" in kit("validate", str(f)).stdout

    h1 = kit("hash", str(f)).stdout.strip()
    assert len(h1) == 64
    kit("add", str(f), "--type", "rule.timer", "--step", "8", "--set", "seconds=45", "--out", str(f))
    listed = kit("list", str(f)).stdout
    assert "rule.timer" in listed and "seconds=45" in listed
    h2 = kit("hash", str(f)).stdout.strip()
    assert h1 != h2                                   # content-addressed

    out = tmp_path / "remix.json"
    kit("remix", str(f), "--by", "Bo", "--out", str(out))
    rem = json.loads(out.read_text(encoding="utf-8"))
    assert rem["game"]["remixOf"]["id"] == h2
    assert [a["role"] for a in rem["game"]["attribution"]] == ["creator", "remixer"]
    assert rem["game"]["version"] == "0.2.0"

    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"game": {"name": "x", "objects": []}}), encoding="utf-8")
    r = subprocess.run([sys.executable, str(GAMEKIT), "validate", str(bad)],
                       capture_output=True, text=True)
    assert r.returncode == 1


def test_catalog_parity_cli_vs_browser(page, site_base, seeded):
    """The python catalog mirror and the JS catalog must never drift."""
    cli_cat = json.loads(kit("catalog").stdout)
    goto_games(page, site_base, seeded, "preset:empty")
    js_cat = page.evaluate("() => SCIMA_GAME_CATALOG")
    assert set(cli_cat) == set(js_cat)
    for t, spec in cli_cat.items():
        assert spec["lane"] == js_cat[t]["lane"]
        assert spec["persist"] == js_cat[t]["persist"]
        for k, ps in spec["props"].items():
            j = js_cat[t]["props"][k]
            assert (ps["type"], ps["default"]) == (j["type"], j["default"]), (t, k)
            if ps["type"] == "int":
                assert (ps["min"], ps["max"]) == (j["min"], j["max"])
            if ps["type"] in ("enum", "list"):
                assert ps["enum"] == j["enum"]


# ── a11y on the new page ───────────────────────────────────────────────────

def test_games_page_a11y_clean(page, site_base, seeded):
    goto_games(page, site_base, seeded, "preset:empty")
    assert content.poorly_named_controls(page) == []
    assert content.unnamed_visible_buttons(page) == []
    page.get_by_role("button", name="✏ Editor").click()
    assert content.poorly_named_controls(page) == []
    assert content.clickables_missing_role(page) == []
