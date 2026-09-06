"""Sanity tests for the /api/v1 surface - enough to confirm the API
framework itself works end to end (create -> list -> get -> search ->
tags/categories) against a throwaway SQLite DB + decks/ folder."""
import shutil
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

SAMPLE_EXPORT = {
    "version": 2,
    "exportedAt": "2026-08-22T10:22:41.149Z",
    "deck": {
        "id": "d_1787394145845_sdcnm",
        "name": "Spanish Basics",
        "emoji": "📖",
        "image": None,
        "subject": "language",
        "folderId": None,
        "color": "var(--blue)",
        "pinned": False,
        "cards": [
            {
                "id": "c_1787394158843_9qmuu",
                "front": "Hello",
                "back": "Hola",
                "answerCount": 1,
                "requiredAnswers": 1,
                "synonyms": [],
                "type": "basic",
                "ease": 2.5,
                "interval": 0,
                "reps": 0,
                "lapses": 0,
                "due": 1787394158843,
                "state": "new",
                "suspended": False,
                "leech": False,
                "created": 1787394158843,
                "lastRated": None,
            }
        ],
    },
    "citedSources": [],
}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from app import db as db_module
    monkeypatch.setattr(db_module, "DATA_DIR", tmp_path)
    monkeypatch.setattr(db_module, "DECKS_DIR", tmp_path / "decks")
    monkeypatch.setattr(db_module, "DB_PATH", tmp_path / "scima.db")

    from app import ratelimit as ratelimit_module
    ratelimit_module.reset()

    from app.main import app
    with TestClient(app) as c:
        yield c

    ratelimit_module.reset()
    shutil.rmtree(tmp_path, ignore_errors=True)


def test_health(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_empty_list(client):
    r = client.get("/api/v1/decks")
    assert r.status_code == 200
    assert r.json() == {"items": [], "total": 0, "page": 1, "pageSize": 20}


def test_create_and_fetch_deck(client):
    body = {**SAMPLE_EXPORT, "meta": {"description": "Beginner Spanish", "author": "jdoe", "tags": ["spanish", "language"]}}
    r = client.post("/api/v1/decks", json=body)
    assert r.status_code == 201
    created = r.json()
    assert created["id"].startswith("sd_")
    assert created["sourceDeckId"] == "d_1787394145845_sdcnm"
    assert created["name"] == "Spanish Basics"
    assert created["cardCount"] == 1
    assert created["deckVersion"] == 1
    assert set(created["tags"]) == {"spanish", "language"}
    assert created["export"]["deck"]["cards"][0]["back"] == "Hola"

    deck_id = created["id"]
    r2 = client.get(f"/api/v1/decks/{deck_id}")
    assert r2.status_code == 200
    assert r2.json()["export"] == created["export"]

    r3 = client.get("/api/v1/decks")
    assert r3.json()["total"] == 1
    assert r3.json()["items"][0]["id"] == deck_id


def test_fork_style_reupload_creates_new_entry(client):
    body = {**SAMPLE_EXPORT, "meta": {"description": "", "author": "", "tags": []}}
    r1 = client.post("/api/v1/decks", json=body)
    r2 = client.post("/api/v1/decks", json=body)
    assert r1.json()["id"] != r2.json()["id"]
    assert r1.json()["deckVersion"] == 1
    assert r2.json()["deckVersion"] == 1
    assert client.get("/api/v1/decks").json()["total"] == 2


def test_search(client):
    body = {**SAMPLE_EXPORT, "meta": {"description": "", "author": "", "tags": []}}
    client.post("/api/v1/decks", json=body)
    r = client.get("/api/v1/search", params={"q": "Spanish"})
    assert r.status_code == 200
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["name"] == "Spanish Basics"

    r_miss = client.get("/api/v1/search", params={"q": "nonexistent-term-xyz"})
    assert r_miss.json()["total"] == 0


def test_tags_and_categories(client):
    body = {**SAMPLE_EXPORT, "meta": {"description": "", "author": "", "tags": ["spanish", "beginner"]}}
    client.post("/api/v1/decks", json=body)
    tags = client.get("/api/v1/tags").json()["tags"]
    assert {"name": "spanish", "count": 1} in tags
    cats = client.get("/api/v1/categories").json()["categories"]
    assert {"name": "language", "count": 1} in cats


def test_get_missing_deck_404(client):
    r = client.get("/api/v1/decks/sd_doesnotexist")
    assert r.status_code == 404


def test_create_deck_rate_limit(client):
    """5 / hour / IP on POST /api/v1/decks."""
    body = {**SAMPLE_EXPORT, "meta": {"description": "", "author": "", "tags": []}}
    for _ in range(5):
        r = client.post("/api/v1/decks", json=body)
        assert r.status_code == 201
    r6 = client.post("/api/v1/decks", json=body)
    assert r6.status_code == 429
    assert "Retry-After" in r6.headers


def test_search_rate_limit(client):
    """60 / minute / IP on GET /api/v1/search."""
    for _ in range(60):
        r = client.get("/api/v1/search", params={"q": "x"})
        assert r.status_code == 200
    r61 = client.get("/api/v1/search", params={"q": "x"})
    assert r61.status_code == 429


def test_list_decks_rate_limit(client):
    """120 / minute / IP on GET /api/v1/decks."""
    for _ in range(120):
        r = client.get("/api/v1/decks")
        assert r.status_code == 200
    r121 = client.get("/api/v1/decks")
    assert r121.status_code == 429


def test_get_deck_rate_limit(client):
    """120 / minute / IP on GET /api/v1/decks/{id} (no-download requests)."""
    body = {**SAMPLE_EXPORT, "meta": {"description": "", "author": "", "tags": []}}
    deck_id = client.post("/api/v1/decks", json=body).json()["id"]
    for _ in range(119):  # one create already consumed nothing from this bucket
        r = client.get(f"/api/v1/decks/{deck_id}")
        assert r.status_code == 200
    r_last = client.get(f"/api/v1/decks/{deck_id}")
    assert r_last.status_code == 200
    r_over = client.get(f"/api/v1/decks/{deck_id}")
    assert r_over.status_code == 429


def test_download_deck_rate_limit(client):
    """30 / minute / IP on GET /api/v1/decks/{id}?download=true, distinct
    from the 120/minute plain-fetch bucket, and increments downloads only
    on the download=true path."""
    body = {**SAMPLE_EXPORT, "meta": {"description": "", "author": "", "tags": []}}
    deck_id = client.post("/api/v1/decks", json=body).json()["id"]

    # Plain metadata fetches should NOT move the downloads counter.
    for _ in range(3):
        client.get(f"/api/v1/decks/{deck_id}")
    assert client.get(f"/api/v1/decks/{deck_id}").json()["downloads"] == 0

    for i in range(30):
        r = client.get(f"/api/v1/decks/{deck_id}", params={"download": "true"})
        assert r.status_code == 200
        assert r.json()["downloads"] == i + 1
    r_over = client.get(f"/api/v1/decks/{deck_id}", params={"download": "true"})
    assert r_over.status_code == 429


def test_search_query_too_long(client):
    r = client.get("/api/v1/search", params={"q": "x" * 201})
    assert r.status_code == 422


def test_deck_name_too_long_rejected(client):
    bad_deck = {**SAMPLE_EXPORT["deck"], "name": "x" * 201}
    body = {**SAMPLE_EXPORT, "deck": bad_deck, "meta": {"description": "", "author": "", "tags": []}}
    r = client.post("/api/v1/decks", json=body)
    assert r.status_code == 422


def test_too_many_cards_rejected(client):
    cards = [{**SAMPLE_EXPORT["deck"]["cards"][0], "id": f"c_{i}"} for i in range(5001)]
    bad_deck = {**SAMPLE_EXPORT["deck"], "cards": cards}
    body = {**SAMPLE_EXPORT, "deck": bad_deck, "meta": {"description": "", "author": "", "tags": []}}
    r = client.post("/api/v1/decks", json=body)
    assert r.status_code == 422


def test_card_text_field_too_large_rejected(client):
    bad_card = {**SAMPLE_EXPORT["deck"]["cards"][0], "front": "x" * (100 * 1024 + 1)}
    bad_deck = {**SAMPLE_EXPORT["deck"], "cards": [bad_card]}
    body = {**SAMPLE_EXPORT, "deck": bad_deck, "meta": {"description": "", "author": "", "tags": []}}
    r = client.post("/api/v1/decks", json=body)
    assert r.status_code == 422


def test_too_many_tags_rejected(client):
    body = {**SAMPLE_EXPORT, "meta": {"description": "", "author": "", "tags": [f"t{i}" for i in range(31)]}}
    r = client.post("/api/v1/decks", json=body)
    assert r.status_code == 422


def test_tag_too_long_rejected(client):
    body = {**SAMPLE_EXPORT, "meta": {"description": "", "author": "", "tags": ["x" * 51]}}
    r = client.post("/api/v1/decks", json=body)
    assert r.status_code == 422


def test_author_too_long_rejected(client):
    body = {**SAMPLE_EXPORT, "meta": {"description": "", "author": "x" * 201, "tags": []}}
    r = client.post("/api/v1/decks", json=body)
    assert r.status_code == 422


def test_description_too_large_rejected(client):
    body = {**SAMPLE_EXPORT, "meta": {"description": "x" * (25 * 1024 + 1), "author": "", "tags": []}}
    r = client.post("/api/v1/decks", json=body)
    assert r.status_code == 422


def test_request_body_too_large_rejected(client):
    huge_card = {**SAMPLE_EXPORT["deck"]["cards"][0], "front": "x" * (6 * 1024 * 1024)}
    bad_deck = {**SAMPLE_EXPORT["deck"], "cards": [huge_card]}
    body = {**SAMPLE_EXPORT, "deck": bad_deck, "meta": {"description": "", "author": "", "tags": []}}
    r = client.post("/api/v1/decks", json=body)
    assert r.status_code in (413, 422)


def test_deck_internal_fields_not_promoted_to_metadata(client):
    """pinned/ease/interval/etc are stored verbatim in the file but must
    never leak into the community metadata response."""
    body = {**SAMPLE_EXPORT, "meta": {"description": "", "author": "", "tags": []}}
    r = client.post("/api/v1/decks", json=body)
    created = r.json()
    for study_state_field in ("pinned", "ease", "interval", "due", "state", "reps", "lapses"):
        assert study_state_field not in created
    # but it IS preserved untouched in the stored export
    assert created["export"]["deck"]["pinned"] is False
    assert created["export"]["deck"]["cards"][0]["ease"] == 2.5
